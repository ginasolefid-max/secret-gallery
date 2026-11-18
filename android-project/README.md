# Secret Gallery (Android PIN Photo Vault)

PIN-protected Android photo hider built with Kotlin, Jetpack Compose, `EncryptedSharedPreferences`, AES-256-GCM, and Scoped Storage purge + `.nomedia` stealth folder handling.

## Privacy & Protection Guarantees

1. **Both Photo Handling Modes**
   - **Move & Encrypt (`MOVE_AND_ENCRYPT`)**: Imports the selected image into app-private internal storage (`filesDir/vault/media/<uuid>.enc`) encrypted with AES-256-GCM, then permanently removes the original from Android's public `MediaStore` (`MediaStore.createDeleteRequest` on Android 11+, `RecoverableSecurityException` / `ContentResolver.delete` on Android 8–10).
   - **Stealth `.nomedia` (`STEALTH_NOMEDIA`) & Dual Lock (`BOTH_ENCRYPT_AND_STEALTH`)**: Stores an AES-256-GCM encrypted copy in the private sandbox, places a hidden copy inside `.SecretGalleryVault/` with a `.nomedia` marker file, triggers `MediaScannerConnection` to de-index it from Google Photos / Gallery apps, and purges the original public `MediaStore` row.

2. **Unauthorized Access Prevention**
   - **Salted PBKDF2-HMAC-SHA256 PIN** (120,000 iterations) stored in `EncryptedSharedPreferences` backed by Android Keystore.
   - **Key Wrapping**: Your 256-bit Data Encryption Key (DEK) is wrapped by the PIN-derived Key Encryption Key (KEK). Changing your PIN re-wraps the DEK without re-encrypting every photo.
   - **Rate Limiting**: 5 failed PIN attempts trigger progressive cooldowns (30s, 60s, 300s) persisted across restarts.
   - **`FLAG_SECURE`**: Blocks screenshots, screen recordings, and Android Recents thumbnail snapshots.
   - **Auto-Lock on Background**: `ProcessLifecycleOwner` wipes decrypted bitmaps from RAM and locks the vault immediately on `ON_STOP`.
   - **No Cloud Backups**: `android:allowBackup="false"` and `data_extraction_rules.xml` exclude vault files and keys from ADB/cloud backups.

## Build & Install Directly in Termux (On-Device)

```bash
# 1. Grant Termux storage access
termux-setup-storage

# 2. Extract SecretGallery-Android.zip into ~/SecretGallery
unzip ~/storage/downloads/SecretGallery-Android.zip -d ~/SecretGallery
cd ~/SecretGallery

# 3. Run the automated Termux ARM64 build & installer script
chmod +x build-termux.sh
./build-termux.sh
```

> **Note for ARM64 Devices**: `build-termux.sh` configures `android.aapt2FromMavenOverride=/data/data/com.termux/files/usr/bin/aapt2` in `gradle.properties` because Google's default Maven `aapt2` binary targets x86_64 Linux rather than Android ARM64.
