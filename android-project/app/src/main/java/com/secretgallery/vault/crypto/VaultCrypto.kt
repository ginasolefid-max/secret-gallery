package com.secretgallery.vault.crypto

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class VaultCrypto {

    @Volatile
    private var sessionKey: SecretKey? = null
    private val random = SecureRandom()

    fun unlockWithKey(key: SecretKey) {
        sessionKey = key
    }

    fun lock() {
        sessionKey = null
    }

    fun isUnlocked(): Boolean = sessionKey != null

    fun encryptBytes(plaintext: ByteArray): ByteArray {
        val key = sessionKey ?: error("Vault is locked.")
        val iv = ByteArray(IV_LENGTH_BYTES).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_LENGTH_BITS, iv))
        val ciphertext = cipher.doFinal(plaintext)
        return ByteArray(iv.size + ciphertext.size).apply {
            System.arraycopy(iv, 0, this, 0, iv.size)
            System.arraycopy(ciphertext, 0, this, iv.size, ciphertext.size)
        }
    }

    fun decryptBytes(blob: ByteArray): ByteArray {
        val key = sessionKey ?: error("Vault is locked.")
        require(blob.size > IV_LENGTH_BYTES) { "Corrupted encrypted payload." }
        val iv = blob.copyOfRange(0, IV_LENGTH_BYTES)
        val ciphertext = blob.copyOfRange(IV_LENGTH_BYTES, blob.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_LENGTH_BITS, iv))
        return cipher.doFinal(ciphertext)
    }

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LENGTH_BYTES = 12
        private const val TAG_LENGTH_BITS = 128
    }
}
