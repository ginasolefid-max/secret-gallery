import { useState } from 'react';
import { Download } from 'lucide-react';
import { AndroidCodeExplorer } from './components/AndroidCodeExplorer';
import { TermuxGuide } from './components/TermuxGuide';
import { VaultInteractiveWorkbench } from './components/VaultInteractiveWorkbench';
import { downloadAndroidProjectZip } from './data/androidProject';

type ActiveSection = 'vault' | 'code' | 'termux';

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('vault');
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadAndroidProjectZip();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text wordmark */}
          <button
            type="button"
            onClick={() => setActiveSection('vault')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded"
          >
            Secret Gallery
          </button>

          {/* Zone 2: Concise single-line navigation links */}
          <nav
            aria-label="Primary"
            className="flex items-center gap-5 sm:gap-7 text-sm font-medium overflow-x-auto"
          >
            <button
              type="button"
              onClick={() => setActiveSection('vault')}
              className={`py-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'vault'
                  ? 'border-teal-700 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              Vault Preview
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('code')}
              className={`py-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'code'
                  ? 'border-teal-700 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              Android Project
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('termux')}
              className={`py-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'termux'
                  ? 'border-teal-700 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              Termux Guide
            </button>
          </nav>

          {/* Zone 3: Single primary CTA */}
          <div className="shrink-0 hidden sm:block">
            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownload()}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-60 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Packaging...' : 'Download Project ZIP'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>PIN-Locked Android Vault</span>
              <span aria-hidden="true">·</span>
              <span>Move &amp; Encrypt + Stealth .nomedia</span>
              <span aria-hidden="true">·</span>
              <span>Android 8–15</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
              {activeSection === 'vault' && 'Interactive PIN Photo Vault & Gallery Purge'}
              {activeSection === 'code' && 'Complete Android Studio & Kotlin Source'}
              {activeSection === 'termux' && 'Build & Install APK Directly in Termux'}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {activeSection === 'vault' &&
                'Set a PIN to unlock the vault, then hide sample or local photos using Move & Encrypt or Stealth .nomedia to purge them from public gallery visibility.'}
              {activeSection === 'code' &&
                'Browse all 20 Kotlin, Jetpack Compose, Gradle, and security manifest files, or export the ready-to-build SecretGallery-Android.zip archive.'}
              {activeSection === 'termux' &&
                'Run the automated ARM64 build script in Termux to install OpenJDK 17, Android SDK 34, native aapt2 override, and compile your installable APK.'}
            </p>
          </div>

          <div className="sm:hidden">
            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownload()}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Packaging...' : 'Download Project ZIP'}
            </button>
          </div>
        </section>

        {activeSection === 'vault' && <VaultInteractiveWorkbench />}
        {activeSection === 'code' && <AndroidCodeExplorer />}
        {activeSection === 'termux' && <TermuxGuide />}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>Secret Gallery · Local AES-256-GCM &amp; MediaStore Privacy Architecture</span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setActiveSection('vault')}
              className="hover:text-slate-900 transition-colors"
            >
              Vault Preview
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('code')}
              className="hover:text-slate-900 transition-colors"
            >
              Source Files
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('termux')}
              className="hover:text-slate-900 transition-colors"
            >
              Termux Build
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
