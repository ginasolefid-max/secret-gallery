import JSZip from 'jszip';

import settingsGradle from '../../android-project/settings.gradle.kts?raw';
import rootBuildGradle from '../../android-project/build.gradle.kts?raw';
import gradleProperties from '../../android-project/gradle.properties?raw';
import appBuildGradle from '../../android-project/app/build.gradle.kts?raw';
import proguardRules from '../../android-project/app/proguard-rules.pro?raw';
import androidManifest from '../../android-project/app/src/main/AndroidManifest.xml?raw';
import stringsXml from '../../android-project/app/src/main/res/values/strings.xml?raw';
import themesXml from '../../android-project/app/src/main/res/values/themes.xml?raw';
import dataExtractionRules from '../../android-project/app/src/main/res/xml/data_extraction_rules.xml?raw';
import backupRules from '../../android-project/app/src/main/res/xml/backup_rules.xml?raw';
import mainActivityKt from '../../android-project/app/src/main/java/com/secretgallery/vault/MainActivity.kt?raw';
import pinManagerKt from '../../android-project/app/src/main/java/com/secretgallery/vault/crypto/PinManager.kt?raw';
import vaultCryptoKt from '../../android-project/app/src/main/java/com/secretgallery/vault/crypto/VaultCrypto.kt?raw';
import galleryMediaHandlerKt from '../../android-project/app/src/main/java/com/secretgallery/vault/media/GalleryMediaHandler.kt?raw';
import vaultRepositoryKt from '../../android-project/app/src/main/java/com/secretgallery/vault/data/VaultRepository.kt?raw';
import pinLockScreenKt from '../../android-project/app/src/main/java/com/secretgallery/vault/ui/PinLockScreen.kt?raw';
import vaultScreenKt from '../../android-project/app/src/main/java/com/secretgallery/vault/ui/VaultScreen.kt?raw';
import themeKt from '../../android-project/app/src/main/java/com/secretgallery/vault/ui/Theme.kt?raw';
import buildTermuxSh from '../../android-project/build-termux.sh?raw';
import readmeMd from '../../android-project/README.md?raw';

export interface AndroidFileEntry {
  path: string;
  category: 'Security & Crypto' | 'Media & Storage' | 'Compose UI' | 'Gradle & Manifest' | 'Termux & Docs';
  language: string;
  summary: string;
  content: string;
  executable?: boolean;
}

export const ANDROID_PROJECT_FILES: AndroidFileEntry[] = [
  {
    path: 'app/src/main/java/com/secretgallery/vault/crypto/PinManager.kt',
    category: 'Security & Crypto',
    language: 'kotlin',
    summary: 'PBKDF2-HMAC-SHA256 PIN & encrypted recovery question verification, dual-wrapped 256-bit DEK, EncryptedSharedPreferences storage, and progressive lockout.',
    content: pinManagerKt,
  },
  {
    path: 'app/src/main/java/com/secretgallery/vault/crypto/VaultCrypto.kt',
    category: 'Security & Crypto',
    language: 'kotlin',
    summary: 'In-memory AES-256-GCM encryption with per-file 12-byte random IV and immediate session key wipe on lock.',
    content: vaultCryptoKt,
  },
  {
    path: 'app/src/main/java/com/secretgallery/vault/media/GalleryMediaHandler.kt',
    category: 'Media & Storage',
    language: 'kotlin',
    summary: 'Implements both Move & Encrypt (MediaStore.createDeleteRequest public purge) and Stealth .nomedia folder de-indexing plus Gallery Restore.',
    content: galleryMediaHandlerKt,
  },
  {
    path: 'app/src/main/java/com/secretgallery/vault/data/VaultRepository.kt',
    category: 'Media & Storage',
    language: 'kotlin',
    summary: 'Encrypted vault index, app-private sandbox media/thumb blobs, and RAM-only thumbnail bitmap cache cleared on lock.',
    content: vaultRepositoryKt,
  },
  {
    path: 'app/src/main/java/com/secretgallery/vault/MainActivity.kt',
    category: 'Compose UI',
    language: 'kotlin',
    summary: 'Enforces FLAG_SECURE anti-screenshot protection, ProcessLifecycleOwner background auto-lock, Photo Picker, MediaStore delete consent, and recovery PIN reset.',
    content: mainActivityKt,
  },
  {
    path: 'app/src/main/java/com/secretgallery/vault/ui/PinLockScreen.kt',
    category: 'Compose UI',
    language: 'kotlin',
    summary: 'Tactile Compose PIN keypad supporting 4–8 digit setup confirmation, masked dots, progressive lockout countdown, and encrypted recovery reset dialog.',
    content: pinLockScreenKt,
  },
  {
    path: 'app/src/main/java/com/secretgallery/vault/ui/VaultScreen.kt',
    category: 'Compose UI',
    language: 'kotlin',
    summary: 'Decrypted-in-RAM vault photo grid, Photo Handling & Security & Recovery settings tabs, full-screen image viewer, and restore/delete actions.',
    content: vaultScreenKt,
  },
  {
    path: 'app/src/main/java/com/secretgallery/vault/ui/Theme.kt',
    category: 'Compose UI',
    language: 'kotlin',
    summary: 'Material 3 dark obsidian vault color scheme.',
    content: themeKt,
  },
  {
    path: 'app/src/main/AndroidManifest.xml',
    category: 'Gradle & Manifest',
    language: 'xml',
    summary: 'Declares Scoped Storage image permissions, disables cloud/ADB backup, and references data extraction exclusions.',
    content: androidManifest,
  },
  {
    path: 'app/build.gradle.kts',
    category: 'Gradle & Manifest',
    language: 'kotlin',
    summary: 'Android Gradle module config targeting API 34 with Jetpack Compose, Lifecycle Process, and Security Crypto.',
    content: appBuildGradle,
  },
  {
    path: 'build.gradle.kts',
    category: 'Gradle & Manifest',
    language: 'kotlin',
    summary: 'Root Gradle plugin declarations (AGP 8.5.2, Kotlin 1.9.24).',
    content: rootBuildGradle,
  },
  {
    path: 'settings.gradle.kts',
    category: 'Gradle & Manifest',
    language: 'kotlin',
    summary: 'Google & Maven Central repository resolution.',
    content: settingsGradle,
  },
  {
    path: 'gradle.properties',
    category: 'Gradle & Manifest',
    language: 'properties',
    summary: 'JVM memory tuning for Termux ARM64 and native aapt2 override configuration.',
    content: gradleProperties,
  },
  {
    path: 'app/proguard-rules.pro',
    category: 'Gradle & Manifest',
    language: 'text',
    summary: 'ProGuard/R8 keep rules for release builds.',
    content: proguardRules,
  },
  {
    path: 'app/src/main/res/values/strings.xml',
    category: 'Gradle & Manifest',
    language: 'xml',
    summary: 'App display name resource.',
    content: stringsXml,
  },
  {
    path: 'app/src/main/res/values/themes.xml',
    category: 'Gradle & Manifest',
    language: 'xml',
    summary: 'System status and navigation bar theme styling.',
    content: themesXml,
  },
  {
    path: 'app/src/main/res/xml/data_extraction_rules.xml',
    category: 'Gradle & Manifest',
    language: 'xml',
    summary: 'Excludes encrypted vault files and keys from Android 12+ cloud backups and device transfers.',
    content: dataExtractionRules,
  },
  {
    path: 'app/src/main/res/xml/backup_rules.xml',
    category: 'Gradle & Manifest',
    language: 'xml',
    summary: 'Excludes private vault files from legacy Android Auto Backup.',
    content: backupRules,
  },
  {
    path: 'build-termux.sh',
    category: 'Termux & Docs',
    language: 'bash',
    summary: 'One-command Termux script installing OpenJDK 17, Android SDK 34, native ARM64 aapt2 override, and building/opening the APK.',
    content: buildTermuxSh,
    executable: true,
  },
  {
    path: 'README.md',
    category: 'Termux & Docs',
    language: 'markdown',
    summary: 'Architecture overview, privacy guarantees, and Termux build instructions.',
    content: readmeMd,
  },
];

export async function downloadAndroidProjectZip(): Promise<void> {
  const zip = new JSZip();
  for (const file of ANDROID_PROJECT_FILES) {
    zip.file(file.path, file.content, {
      unixPermissions: file.executable ? '755' : '644',
    });
  }
  const blob = await zip.generateAsync({ type: 'blob', platform: 'UNIX' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'SecretGallery-Android.zip';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
