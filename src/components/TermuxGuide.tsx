import React, { useState } from 'react';
import { Check, Copy, Download, Terminal } from 'lucide-react';
import { downloadAndroidProjectZip } from '../data/androidProject';

interface CommandStep {
  number: string;
  title: string;
  explanation: string;
  command: string;
}

const AUTOMATED_STEPS: CommandStep[] = [
  {
    number: '01.',
    title: 'Grant Termux Storage Access & Extract Project',
    explanation:
      'Download SecretGallery-Android.zip onto your phone (Downloads folder), open Termux (from F-Droid), and extract it into your Termux home directory (Gradle runs fastest inside ~/ rather than /sdcard).',
    command: `termux-setup-storage
unzip ~/storage/downloads/SecretGallery-Android.zip -d ~/SecretGallery
cd ~/SecretGallery`,
  },
  {
    number: '02.',
    title: 'Run the Automated ARM64 Build & Installer Script',
    explanation:
      'build-termux.sh installs OpenJDK 17, Gradle, Android SDK Command-Line Tools (Platform 34 + Build-Tools 34.0.0), sets android.aapt2FromMavenOverride to Termux native ARM64 aapt2, compiles app-debug.apk, and opens the Android installer.',
    command: `chmod +x build-termux.sh
./build-termux.sh`,
  },
  {
    number: '03.',
    title: 'Enable All-Files Access for Stealth .nomedia Mode (Optional)',
    explanation:
      'After installing Secret Gallery, Move & Encrypt works out of the box via MediaStore.createDeleteRequest. To also use Stealth .nomedia folder locking on /sdcard/Pictures/.SecretGalleryVault/, tap Settings inside Secret Gallery and enable All-Files Access.',
    command: `# Optional: verify installed package via ADB / Termux if needed
cp app/build/outputs/apk/debug/app-debug.apk ~/storage/downloads/SecretGallery-debug.apk`,
  },
];

const MANUAL_STEPS: CommandStep[] = [
  {
    number: '01.',
    title: 'Install Termux Build Packages',
    explanation:
      'Install OpenJDK 17, Gradle, wget, unzip, and Termux-compiled ARM64 aapt2 (required because Google Maven ships an x86_64 aapt2 binary that cannot execute on ARM64 phones).',
    command: `pkg update && pkg upgrade -y
pkg install -y openjdk-17 gradle wget unzip aapt2 apksigner`,
  },
  {
    number: '02.',
    title: 'Install Android SDK Command-Line Tools (API 34)',
    explanation:
      'Download Android cmdline-tools into ~/android-sdk and accept licenses for Platform 34 and Build-Tools 34.0.0.',
    command: `mkdir -p ~/android-sdk/cmdline-tools
wget -O ~/cmdline.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q ~/cmdline.zip -d ~/android-sdk/cmdline-tools
mv ~/android-sdk/cmdline-tools/cmdline-tools ~/android-sdk/cmdline-tools/latest
rm ~/cmdline.zip
export ANDROID_HOME="$HOME/android-sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"`,
  },
  {
    number: '03.',
    title: 'Configure ARM64 aapt2 Override & Build APK',
    explanation:
      'Point local.properties to your Termux Android SDK and override aapt2 in gradle.properties before assembling the debug APK.',
    command: `cd ~/SecretGallery
echo "sdk.dir=$HOME/android-sdk" > local.properties
echo "android.aapt2FromMavenOverride=$(command -v aapt2)" >> gradle.properties
gradle assembleDebug --no-daemon
termux-open app/build/outputs/apk/debug/app-debug.apk`,
  },
];

export const TermuxGuide: React.FC = () => {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const steps = mode === 'auto' ? AUTOMATED_STEPS : MANUAL_STEPS;

  const copyCommand = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1800);
  };

  return (
    <div className="space-y-8">
      {/* Header & Mode Switcher */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Termux On-Device Build &amp; Installation Guide
          </h2>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Compile Secret Gallery directly on your Android phone using Termux (F-Droid build recommended over legacy Play Store Termux).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('auto')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'auto'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Automated Script
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'manual'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Manual Commands
            </button>
          </div>

          <button
            type="button"
            onClick={() => void downloadAndroidProjectZip()}
            className="px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download Project ZIP
          </button>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step) => {
          const key = `${mode}-${step.number}`;
          return (
            <div
              key={key}
              className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
            >
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {step.number} {step.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed max-w-3xl">
                  {step.explanation}
                </p>
              </div>

              <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
                <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                    <Terminal className="w-3.5 h-3.5 text-teal-400" />
                    <span>Termux bash</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyCommand(key, step.command)}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 transition-colors"
                  >
                    {copiedKey === key ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-teal-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-6">
                  {step.command}
                </pre>
              </div>
            </div>
          );
        })}
      </div>

      {/* Android Storage & Security Architecture Table */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            How Gallery Visibility Removal &amp; PIN Protection Work on Android
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Technical summary of how Secret Gallery prevents gallery leaks across Android 8 through Android 15.
          </p>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-medium">Protection Layer</th>
                <th className="py-3 px-4 font-medium">Android Implementation</th>
                <th className="py-3 px-4 font-medium">Threat Mitigated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="py-3 px-4 font-medium text-slate-900">Move &amp; Encrypt</td>
                <td className="py-3 px-4 font-mono text-[11px]">
                  filesDir/vault/*.enc + MediaStore.createDeleteRequest()
                </td>
                <td className="py-3 px-4">
                  Deletes original public DCIM/Pictures entry so Google Photos, Samsung Gallery, and USB MTP cannot see it.
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium text-slate-900">Stealth .nomedia</td>
                <td className="py-3 px-4 font-mono text-[11px]">
                  .SecretGalleryVault/.nomedia + MediaScannerConnection
                </td>
                <td className="py-3 px-4">
                  Prevents MediaProvider indexing for hidden directory files while maintaining an encrypted vault copy.
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium text-slate-900">PIN Key Wrapping</td>
                <td className="py-3 px-4 font-mono text-[11px]">
                  PBKDF2WithHmacSHA256 (120k) + EncryptedSharedPreferences
                </td>
                <td className="py-3 px-4">
                  PIN never stored in plaintext; 256-bit DEK cannot be unwrapped without valid PIN + hardware Keystore.
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium text-slate-900">Anti-Capture &amp; RAM Wipe</td>
                <td className="py-3 px-4 font-mono text-[11px]">
                  FLAG_SECURE + ProcessLifecycleOwner (ON_STOP)
                </td>
                <td className="py-3 px-4">
                  Blocks screenshots, screen recordings, Recents app snapshots, and clears decrypted bitmaps on app switch.
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium text-slate-900">Backup Exclusion</td>
                <td className="py-3 px-4 font-mono text-[11px]">
                  android:allowBackup=&quot;false&quot; + data_extraction_rules.xml
                </td>
                <td className="py-3 px-4">
                  Prevents ADB backup or Google Drive cloud sync from copying encrypted vault blobs off-device.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
