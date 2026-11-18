package com.secretgallery.vault.crypto

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

sealed class PinVerifyResult {
    data class Success(val vaultKey: SecretKey) : PinVerifyResult()
    data class InvalidPin(val remainingBeforeLockout: Int) : PinVerifyResult()
    data class LockedOut(val remainingSeconds: Long) : PinVerifyResult()
}

class PinManager(context: Context) {

    private val prefs: SharedPreferences
    private val random = SecureRandom()

    init {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        prefs = EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun isPinConfigured(): Boolean {
        return prefs.contains(KEY_PIN_HASH) && prefs.contains(KEY_WRAPPED_DEK)
    }

    fun isRecoveryConfigured(): Boolean {
        return prefs.contains(KEY_RECOVERY_QUESTION) &&
            prefs.contains(KEY_RECOVERY_HASH) &&
            prefs.contains(KEY_RECOVERY_WRAPPED_DEK)
    }

    fun getRecoveryQuestion(): String? {
        return prefs.getString(KEY_RECOVERY_QUESTION, null)
    }

    fun getPinLength(): Int = prefs.getInt(KEY_PIN_LENGTH, 0)

    fun getLockoutRemainingSeconds(): Long {
        val untilMs = prefs.getLong(KEY_LOCKOUT_UNTIL_MS, 0L)
        val now = System.currentTimeMillis()
        return if (untilMs > now) ((untilMs - now) / 1000L) + 1L else 0L
    }

    fun setupPin(pin: String): SecretKey {
        require(pin.length in 4..8 && pin.all { it.isDigit() }) {
            "PIN must be 4 to 8 digits."
        }

        val salt = ByteArray(16).also { random.nextBytes(it) }
        val derived = deriveSecretMaterial(pin, salt)
        val verifierHash = derived.copyOfRange(0, 32)
        val kekBytes = derived.copyOfRange(32, 64)

        val dekBytes = ByteArray(32).also { random.nextBytes(it) }
        val wrappedDek = wrapDekWithKek(dekBytes, kekBytes)

        prefs.edit()
            .putString(KEY_PIN_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
            .putString(KEY_PIN_HASH, Base64.encodeToString(verifierHash, Base64.NO_WRAP))
            .putString(KEY_WRAPPED_DEK, Base64.encodeToString(wrappedDek, Base64.NO_WRAP))
            .putInt(KEY_PIN_LENGTH, pin.length)
            .putInt(KEY_FAILED_ATTEMPTS, 0)
            .putLong(KEY_LOCKOUT_UNTIL_MS, 0L)
            .apply()

        val key = SecretKeySpec(dekBytes.copyOf(), "AES")
        derived.fill(0)
        dekBytes.fill(0)
        kekBytes.fill(0)
        return key
    }

    fun verifyPin(pin: String): PinVerifyResult {
        val lockoutRemaining = getLockoutRemainingSeconds()
        if (lockoutRemaining > 0L) {
            return PinVerifyResult.LockedOut(lockoutRemaining)
        }

        val saltB64 = prefs.getString(KEY_PIN_SALT, null) ?: return PinVerifyResult.InvalidPin(MAX_FREE_ATTEMPTS)
        val hashB64 = prefs.getString(KEY_PIN_HASH, null) ?: return PinVerifyResult.InvalidPin(MAX_FREE_ATTEMPTS)
        val wrappedDekB64 = prefs.getString(KEY_WRAPPED_DEK, null) ?: return PinVerifyResult.InvalidPin(MAX_FREE_ATTEMPTS)

        val salt = Base64.decode(saltB64, Base64.NO_WRAP)
        val expectedHash = Base64.decode(hashB64, Base64.NO_WRAP)
        val wrappedDek = Base64.decode(wrappedDekB64, Base64.NO_WRAP)

        val derived = deriveSecretMaterial(pin, salt)
        val actualHash = derived.copyOfRange(0, 32)
        val kekBytes = derived.copyOfRange(32, 64)

        val matches = MessageDigest.isEqual(expectedHash, actualHash)
        if (!matches) {
            derived.fill(0)
            actualHash.fill(0)
            kekBytes.fill(0)
            return recordFailedAttempt()
        }

        val dekBytes = unwrapDekWithKek(wrappedDek, kekBytes)
        prefs.edit()
            .putInt(KEY_PIN_LENGTH, pin.length)
            .putInt(KEY_FAILED_ATTEMPTS, 0)
            .putLong(KEY_LOCKOUT_UNTIL_MS, 0L)
            .apply()

        val vaultKey = SecretKeySpec(dekBytes.copyOf(), "AES")
        derived.fill(0)
        actualHash.fill(0)
        kekBytes.fill(0)
        dekBytes.fill(0)
        return PinVerifyResult.Success(vaultKey)
    }

    fun changePin(currentPin: String, newPin: String): PinVerifyResult {
        require(newPin.length in 4..8 && newPin.all { it.isDigit() }) {
            "New PIN must be 4 to 8 digits."
        }
        return when (val verify = verifyPin(currentPin)) {
            is PinVerifyResult.Success -> {
                val dekBytes = verify.vaultKey.encoded
                persistNewPinForDek(newPin, dekBytes)
                dekBytes.fill(0)
                PinVerifyResult.Success(verify.vaultKey)
            }
            else -> verify
        }
    }

    /**
     * Configures an encrypted secondary recovery question inside Hardware-backed
     * EncryptedSharedPreferences. The recovery answer derives a separate KEK via
     * PBKDF2-HMAC-SHA256 that wraps the Vault's 256-bit DEK with AES-256-GCM.
     */
    fun configureRecoveryQuestion(
        currentPin: String,
        question: String,
        answer: String
    ): PinVerifyResult {
        val cleanQuestion = question.trim()
        val normalizedAnswer = normalizeRecoveryAnswer(answer)
        require(cleanQuestion.length >= 6) {
            "Recovery question must be at least 6 characters."
        }
        require(normalizedAnswer.length >= 3) {
            "Recovery answer must be at least 3 characters."
        }

        return when (val verify = verifyPin(currentPin)) {
            is PinVerifyResult.Success -> {
                val recSalt = ByteArray(16).also { random.nextBytes(it) }
                val recDerived = deriveSecretMaterial(normalizedAnswer, recSalt)
                val recVerifier = recDerived.copyOfRange(0, 32)
                val recKek = recDerived.copyOfRange(32, 64)
                val dekBytes = verify.vaultKey.encoded
                val recoveryWrappedDek = wrapDekWithKek(dekBytes, recKek)

                prefs.edit()
                    .putString(KEY_RECOVERY_QUESTION, cleanQuestion)
                    .putString(KEY_RECOVERY_SALT, Base64.encodeToString(recSalt, Base64.NO_WRAP))
                    .putString(KEY_RECOVERY_HASH, Base64.encodeToString(recVerifier, Base64.NO_WRAP))
                    .putString(KEY_RECOVERY_WRAPPED_DEK, Base64.encodeToString(recoveryWrappedDek, Base64.NO_WRAP))
                    .apply()

                recDerived.fill(0)
                recVerifier.fill(0)
                recKek.fill(0)
                dekBytes.fill(0)
                PinVerifyResult.Success(verify.vaultKey)
            }
            else -> verify
        }
    }

    fun clearRecoveryQuestion(currentPin: String): PinVerifyResult {
        return when (val verify = verifyPin(currentPin)) {
            is PinVerifyResult.Success -> {
                prefs.edit()
                    .remove(KEY_RECOVERY_QUESTION)
                    .remove(KEY_RECOVERY_SALT)
                    .remove(KEY_RECOVERY_HASH)
                    .remove(KEY_RECOVERY_WRAPPED_DEK)
                    .apply()
                PinVerifyResult.Success(verify.vaultKey)
            }
            else -> verify
        }
    }

    /**
     * Verifies the recovery answer with constant-time comparison and progressive
     * rate limiting, unwraps the existing 256-bit DEK, and re-wraps it under newPin
     * so all encrypted photos remain accessible.
     */
    fun resetPinWithRecovery(answer: String, newPin: String): PinVerifyResult {
        require(newPin.length in 4..8 && newPin.all { it.isDigit() }) {
            "New PIN must be 4 to 8 digits."
        }

        val lockoutRemaining = getLockoutRemainingSeconds()
        if (lockoutRemaining > 0L) {
            return PinVerifyResult.LockedOut(lockoutRemaining)
        }

        val saltB64 = prefs.getString(KEY_RECOVERY_SALT, null)
            ?: return PinVerifyResult.InvalidPin(MAX_FREE_ATTEMPTS)
        val hashB64 = prefs.getString(KEY_RECOVERY_HASH, null)
            ?: return PinVerifyResult.InvalidPin(MAX_FREE_ATTEMPTS)
        val wrappedDekB64 = prefs.getString(KEY_RECOVERY_WRAPPED_DEK, null)
            ?: return PinVerifyResult.InvalidPin(MAX_FREE_ATTEMPTS)

        val salt = Base64.decode(saltB64, Base64.NO_WRAP)
        val expectedHash = Base64.decode(hashB64, Base64.NO_WRAP)
        val wrappedDek = Base64.decode(wrappedDekB64, Base64.NO_WRAP)

        val normalizedAnswer = normalizeRecoveryAnswer(answer)
        val derived = deriveSecretMaterial(normalizedAnswer, salt)
        val actualHash = derived.copyOfRange(0, 32)
        val recKek = derived.copyOfRange(32, 64)

        val matches = MessageDigest.isEqual(expectedHash, actualHash)
        if (!matches) {
            derived.fill(0)
            actualHash.fill(0)
            recKek.fill(0)
            return recordFailedAttempt()
        }

        val dekBytes = unwrapDekWithKek(wrappedDek, recKek)
        persistNewPinForDek(newPin, dekBytes)
        prefs.edit()
            .putInt(KEY_FAILED_ATTEMPTS, 0)
            .putLong(KEY_LOCKOUT_UNTIL_MS, 0L)
            .apply()

        val vaultKey = SecretKeySpec(dekBytes.copyOf(), "AES")
        derived.fill(0)
        actualHash.fill(0)
        recKek.fill(0)
        dekBytes.fill(0)
        return PinVerifyResult.Success(vaultKey)
    }

    private fun persistNewPinForDek(newPin: String, dekBytes: ByteArray) {
        val newSalt = ByteArray(16).also { random.nextBytes(it) }
        val newDerived = deriveSecretMaterial(newPin, newSalt)
        val newVerifier = newDerived.copyOfRange(0, 32)
        val newKek = newDerived.copyOfRange(32, 64)
        val rewrappedDek = wrapDekWithKek(dekBytes, newKek)

        prefs.edit()
            .putString(KEY_PIN_SALT, Base64.encodeToString(newSalt, Base64.NO_WRAP))
            .putString(KEY_PIN_HASH, Base64.encodeToString(newVerifier, Base64.NO_WRAP))
            .putString(KEY_WRAPPED_DEK, Base64.encodeToString(rewrappedDek, Base64.NO_WRAP))
            .putInt(KEY_PIN_LENGTH, newPin.length)
            .apply()

        newDerived.fill(0)
        newVerifier.fill(0)
        newKek.fill(0)
    }

    private fun recordFailedAttempt(): PinVerifyResult {
        val failures = prefs.getInt(KEY_FAILED_ATTEMPTS, 0) + 1
        val editor = prefs.edit().putInt(KEY_FAILED_ATTEMPTS, failures)
        return if (failures >= MAX_FREE_ATTEMPTS) {
            val cooldownSec = when {
                failures == MAX_FREE_ATTEMPTS -> 30L
                failures == MAX_FREE_ATTEMPTS + 1 -> 60L
                else -> 300L
            }
            val until = System.currentTimeMillis() + cooldownSec * 1000L
            editor.putLong(KEY_LOCKOUT_UNTIL_MS, until).apply()
            PinVerifyResult.LockedOut(cooldownSec)
        } else {
            editor.apply()
            PinVerifyResult.InvalidPin(MAX_FREE_ATTEMPTS - failures)
        }
    }

    private fun normalizeRecoveryAnswer(raw: String): String {
        return raw.trim().lowercase()
    }

    private fun deriveSecretMaterial(secret: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(secret.toCharArray(), salt, PBKDF2_ITERATIONS, 512)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return try {
            factory.generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    private fun wrapDekWithKek(dek: ByteArray, kek: ByteArray): ByteArray {
        val iv = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(kek, "AES"), GCMParameterSpec(128, iv))
        val encrypted = cipher.doFinal(dek)
        return iv + encrypted
    }

    private fun unwrapDekWithKek(wrapped: ByteArray, kek: ByteArray): ByteArray {
        val iv = wrapped.copyOfRange(0, 12)
        val ciphertext = wrapped.copyOfRange(12, wrapped.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(kek, "AES"), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext)
    }

    companion object {
        private const val PREFS_NAME = "secret_gallery_auth"
        private const val KEY_PIN_SALT = "pin_salt"
        private const val KEY_PIN_HASH = "pin_hash"
        private const val KEY_WRAPPED_DEK = "wrapped_dek"
        private const val KEY_PIN_LENGTH = "pin_length"
        private const val KEY_RECOVERY_QUESTION = "recovery_question"
        private const val KEY_RECOVERY_SALT = "recovery_salt"
        private const val KEY_RECOVERY_HASH = "recovery_hash"
        private const val KEY_RECOVERY_WRAPPED_DEK = "recovery_wrapped_dek"
        private const val KEY_FAILED_ATTEMPTS = "failed_attempts"
        private const val KEY_LOCKOUT_UNTIL_MS = "lockout_until_ms"
        private const val PBKDF2_ITERATIONS = 120_000
        private const val MAX_FREE_ATTEMPTS = 5
    }
}
