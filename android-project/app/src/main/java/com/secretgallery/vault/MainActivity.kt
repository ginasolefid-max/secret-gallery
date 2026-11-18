package com.secretgallery.vault

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import com.secretgallery.vault.crypto.PinManager
import com.secretgallery.vault.crypto.PinVerifyResult
import com.secretgallery.vault.crypto.VaultCrypto
import com.secretgallery.vault.data.PhotoHandlingMode
import com.secretgallery.vault.data.VaultPhoto
import com.secretgallery.vault.data.VaultRepository
import com.secretgallery.vault.media.GalleryMediaHandler
import com.secretgallery.vault.media.PurgeResult
import com.secretgallery.vault.ui.PinLockScreen
import com.secretgallery.vault.ui.SecretGalleryTheme
import com.secretgallery.vault.ui.VaultScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private lateinit var pinManager: PinManager
    private lateinit var vaultCrypto: VaultCrypto
    private lateinit var repository: VaultRepository
    private lateinit var mediaHandler: GalleryMediaHandler

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Block screenshots, screen recording, and Android Recents task-switcher previews
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        pinManager = PinManager(applicationContext)
        vaultCrypto = VaultCrypto()
        repository = VaultRepository(applicationContext, vaultCrypto)
        mediaHandler = GalleryMediaHandler(applicationContext)

        setContent {
            SecretGalleryTheme {
                val scope = rememberCoroutineScope()
                var isSetupMode by remember { mutableStateOf(!pinManager.isPinConfigured()) }
                var isUnlocked by remember { mutableStateOf(false) }
                var pinError by remember { mutableStateOf<String?>(null) }
                var photos by remember { mutableStateOf<List<VaultPhoto>>(emptyList()) }
                var selectedMode by remember { mutableStateOf(PhotoHandlingMode.BOTH_ENCRYPT_AND_STEALTH) }
                var statusMessage by remember { mutableStateOf<String?>(null) }
                var pendingPurgeMap by remember { mutableStateOf<Map<String, Uri>>(emptyMap()) }
                var hasAllFilesAccess by remember { mutableStateOf(mediaHandler.hasAllFilesAccess()) }
                var hasRecoveryConfigured by remember { mutableStateOf(pinManager.isRecoveryConfigured()) }
                var recoveryQuestion by remember { mutableStateOf(pinManager.getRecoveryQuestion()) }

                // Lock immediately whenever the app moves to background or screen locks
                DisposableEffect(Unit) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_STOP) {
                            vaultCrypto.lock()
                            repository.clearRamCaches()
                            photos = emptyList()
                            isUnlocked = false
                            pinError = null
                        } else if (event == Lifecycle.Event.ON_RESUME) {
                            hasAllFilesAccess = mediaHandler.hasAllFilesAccess()
                        }
                    }
                    ProcessLifecycleOwner.get().lifecycle.addObserver(observer)
                    onDispose {
                        ProcessLifecycleOwner.get().lifecycle.removeObserver(observer)
                    }
                }

                val deleteConsentLauncher = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.StartIntentSenderForResult()
                ) { result ->
                    if (result.resultCode == Activity.RESULT_OK) {
                        val confirmedIds = pendingPurgeMap.filterValues { uri ->
                            !mediaHandler.isMediaStoreUriAlive(uri)
                        }.keys
                        if (confirmedIds.isNotEmpty()) {
                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    repository.markPublicPurged(confirmedIds)
                                }
                                photos = withContext(Dispatchers.IO) { repository.loadPhotos() }
                                statusMessage = "${confirmedIds.size} photo(s) encrypted and permanently removed from public gallery."
                            }
                        }
                    } else {
                        statusMessage = "Photos encrypted in vault, but original public gallery deletion was cancelled."
                    }
                    pendingPurgeMap = emptyMap()
                }

                val photoPickerLauncher = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.PickMultipleVisualMedia()
                ) { uris ->
                    if (uris.isEmpty()) return@rememberLauncherForActivityResult
                    scope.launch {
                        val importedIds = mutableMapOf<String, Uri>()
                        withContext(Dispatchers.IO) {
                            for (uri in uris) {
                                val staged = mediaHandler.readImportPayload(uri, selectedMode)
                                repository.savePhoto(
                                    id = staged.photoId,
                                    originalName = staged.originalName,
                                    mimeType = staged.mimeType,
                                    rawBytes = staged.rawBytes,
                                    handlingMode = selectedMode,
                                    publicPurgeVerified = false,
                                    stealthPath = staged.stealthPath
                                )
                                staged.rawBytes.fill(0)
                                importedIds[staged.photoId] = uri
                            }
                        }

                        photos = withContext(Dispatchers.IO) { repository.loadPhotos() }

                        when (val purge = mediaHandler.purgeOriginalFromPublicGallery(uris)) {
                            PurgeResult.Deleted -> {
                                withContext(Dispatchers.IO) {
                                    repository.markPublicPurged(importedIds.keys)
                                }
                                photos = withContext(Dispatchers.IO) { repository.loadPhotos() }
                                statusMessage = "${importedIds.size} photo(s) encrypted and purged from public gallery."
                            }
                            is PurgeResult.NeedsSystemConsent -> {
                                pendingPurgeMap = importedIds
                                deleteConsentLauncher.launch(
                                    IntentSenderRequest.Builder(purge.intentSender).build()
                                )
                            }
                            is PurgeResult.Failed -> {
                                statusMessage = "Encrypted in vault. Public removal notice: ${purge.reason}"
                            }
                        }
                    }
                }

                if (!isUnlocked) {
                    PinLockScreen(
                        isSetupMode = isSetupMode,
                        recoveryQuestion = recoveryQuestion,
                        lockoutSecondsInitial = pinManager.getLockoutRemainingSeconds(),
                        errorMessage = pinError,
                        onSetupComplete = { newPin ->
                            val key = pinManager.setupPin(newPin)
                            vaultCrypto.unlockWithKey(key)
                            isSetupMode = false
                            isUnlocked = true
                            pinError = null
                            scope.launch {
                                photos = withContext(Dispatchers.IO) { repository.loadPhotos() }
                            }
                        },
                        onUnlockAttempt = { pin ->
                            when (val result = pinManager.verifyPin(pin)) {
                                is PinVerifyResult.Success -> {
                                    vaultCrypto.unlockWithKey(result.vaultKey)
                                    isUnlocked = true
                                    pinError = null
                                    scope.launch {
                                        photos = withContext(Dispatchers.IO) { repository.loadPhotos() }
                                    }
                                }
                                is PinVerifyResult.InvalidPin -> {
                                    pinError = "Incorrect PIN. ${result.remainingBeforeLockout} attempt(s) left before cooldown."
                                }
                                is PinVerifyResult.LockedOut -> {
                                    pinError = "Vault locked for ${result.remainingSeconds}s."
                                }
                            }
                        },
                        onRecoverPin = { answer, newPin ->
                            when (val result = pinManager.resetPinWithRecovery(answer, newPin)) {
                                is PinVerifyResult.Success -> {
                                    vaultCrypto.unlockWithKey(result.vaultKey)
                                    isUnlocked = true
                                    pinError = null
                                    statusMessage = "PIN reset via encrypted recovery question. All vault photos remain intact."
                                    scope.launch {
                                        photos = withContext(Dispatchers.IO) { repository.loadPhotos() }
                                    }
                                    true to null
                                }
                                is PinVerifyResult.InvalidPin -> {
                                    false to "Incorrect recovery answer. ${result.remainingBeforeLockout} attempt(s) left before cooldown."
                                }
                                is PinVerifyResult.LockedOut -> {
                                    false to "Vault locked for ${result.remainingSeconds}s."
                                }
                            }
                        }
                    )
                } else {
                    VaultScreen(
                        photos = photos,
                        selectedMode = selectedMode,
                        hasAllFilesAccess = hasAllFilesAccess,
                        hasRecoveryConfigured = hasRecoveryConfigured,
                        currentRecoveryQuestion = recoveryQuestion,
                        statusMessage = statusMessage,
                        repository = repository,
                        onModeChange = { selectedMode = it },
                        onImportClick = {
                            photoPickerLauncher.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                            )
                        },
                        onRequestAllFilesAccess = {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                                val intent = Intent(
                                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                    Uri.parse("package:$packageName")
                                )
                                startActivity(intent)
                            }
                        },
                        onConfigureRecovery = { currentPin, question, answer ->
                            if (question.trim().length < 6) {
                                false to "Recovery question must be at least 6 characters."
                            } else if (answer.trim().length < 3) {
                                false to "Recovery answer must be at least 3 characters."
                            } else {
                                when (val result = pinManager.configureRecoveryQuestion(currentPin, question, answer)) {
                                    is PinVerifyResult.Success -> {
                                        hasRecoveryConfigured = pinManager.isRecoveryConfigured()
                                        recoveryQuestion = pinManager.getRecoveryQuestion()
                                        true to "Encrypted recovery question saved."
                                    }
                                    is PinVerifyResult.InvalidPin -> {
                                        false to "Current PIN incorrect (${result.remainingBeforeLockout} attempt(s) left)."
                                    }
                                    is PinVerifyResult.LockedOut -> {
                                        false to "Locked out for ${result.remainingSeconds}s."
                                    }
                                }
                            }
                        },
                        onClearRecovery = { currentPin ->
                            when (val result = pinManager.clearRecoveryQuestion(currentPin)) {
                                is PinVerifyResult.Success -> {
                                    hasRecoveryConfigured = false
                                    recoveryQuestion = null
                                    true to "Recovery question removed."
                                }
                                is PinVerifyResult.InvalidPin -> {
                                    false to "Current PIN incorrect (${result.remainingBeforeLockout} attempt(s) left)."
                                }
                                is PinVerifyResult.LockedOut -> {
                                    false to "Locked out for ${result.remainingSeconds}s."
                                }
                            }
                        },
                        onChangePin = { currentPin, newPin ->
                            if (newPin.length !in 4..8 || !newPin.all { it.isDigit() }) {
                                false to "New PIN must be 4 to 8 digits."
                            } else {
                                when (val result = pinManager.changePin(currentPin, newPin)) {
                                    is PinVerifyResult.Success -> {
                                        true to "PIN updated and 256-bit DEK re-wrapped."
                                    }
                                    is PinVerifyResult.InvalidPin -> {
                                        false to "Current PIN incorrect (${result.remainingBeforeLockout} attempt(s) left)."
                                    }
                                    is PinVerifyResult.LockedOut -> {
                                        false to "Locked out for ${result.remainingSeconds}s."
                                    }
                                }
                            }
                        },
                        onRestorePhoto = { photo ->
                            scope.launch {
                                val restored = withContext(Dispatchers.IO) {
                                    val bytes = repository.decryptFullImageBytes(photo.id) ?: return@withContext false
                                    val ok = mediaHandler.restoreToPublicGallery(photo, bytes)
                                    bytes.fill(0)
                                    if (ok) {
                                        mediaHandler.deleteStealthCopyIfPresent(photo.stealthPath)
                                        repository.deletePhoto(photo.id)
                                    }
                                    ok
                                }
                                photos = withContext(Dispatchers.IO) { repository.loadPhotos() }
                                statusMessage = if (restored) {
                                    "${photo.originalName} restored to Pictures/Restored."
                                } else {
                                    "Could not restore ${photo.originalName}."
                                }
                            }
                        },
                        onDeletePhoto = { photo ->
                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    mediaHandler.deleteStealthCopyIfPresent(photo.stealthPath)
                                    repository.deletePhoto(photo.id)
                                }
                                photos = withContext(Dispatchers.IO) { repository.loadPhotos() }
                                statusMessage = "${photo.originalName} permanently wiped."
                            }
                        },
                        onLockNow = {
                            vaultCrypto.lock()
                            repository.clearRamCaches()
                            photos = emptyList()
                            isUnlocked = false
                        },
                        onDismissStatus = { statusMessage = null }
                    )
                }
            }
        }
    }
}
