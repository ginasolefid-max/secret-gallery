#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

echo "=== Secret Gallery: Termux ARM64 Android Build Script ==="

if [ ! -d "/data/data/com.termux/files/usr" ]; then
  echo "Warning: Not running inside Termux. Continuing with standard Linux/Android SDK paths."
fi

# 1. Install Termux build dependencies
echo "[1/6] Installing OpenJDK 17, Gradle, native ARM64 aapt2, wget, and unzip..."
pkg update -y
pkg install -y openjdk-17 gradle wget unzip aapt2 apksigner

# 2. Provision Android SDK Command-Line Tools inside Termux $HOME
export ANDROID_HOME="$HOME/android-sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]; then
  echo "[2/6] Downloading Android Command-Line Tools..."
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  CMDLINE_ZIP="$HOME/commandlinetools-linux.zip"
  wget -q --show-progress -O "$CMDLINE_ZIP" \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  unzip -q "$CMDLINE_ZIP" -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -f "$CMDLINE_ZIP"
else
  echo "[2/6] Android Command-Line Tools already present."
fi

# 3. Accept SDK licenses and install Android 14 (API 34) Platform + Build-Tools
echo "[3/6] Installing Android SDK Platform 34 & Build-Tools 34.0.0..."
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# 4. Write local.properties & enable Termux native ARM64 aapt2 override
echo "[4/6] Configuring local.properties and gradle.properties for ARM64..."
echo "sdk.dir=$ANDROID_HOME" > local.properties

NATIVE_AAPT2="$(command -v aapt2 || true)"
if [ -n "$NATIVE_AAPT2" ]; then
  if grep -q "^# android.aapt2FromMavenOverride=" gradle.properties; then
    sed -i "s|^# android.aapt2FromMavenOverride=.*|android.aapt2FromMavenOverride=$NATIVE_AAPT2|" gradle.properties
  elif ! grep -q "^android.aapt2FromMavenOverride=" gradle.properties; then
    echo "android.aapt2FromMavenOverride=$NATIVE_AAPT2" >> gradle.properties
  fi
  echo "Using native aapt2: $NATIVE_AAPT2"
fi

# 5. Build Debug APK with Termux system Gradle
echo "[5/6] Compiling Secret Gallery APK (this takes ~2-4 minutes on first run)..."
gradle assembleDebug --no-daemon

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK_PATH" ]; then
  echo "Build failed: APK not found at $APK_PATH"
  exit 1
fi

echo "[6/6] APK built successfully: $APK_PATH"
echo "Opening Android package installer..."
if command -v termux-open >/dev/null 2>&1; then
  termux-open "$APK_PATH"
else
  echo "Copy $APK_PATH to /sdcard/Download/ and tap it to install:"
  echo "  cp $APK_PATH /sdcard/Download/SecretGallery-debug.apk"
fi
