import React, { useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  FolderLock,
  ImagePlus,
  KeyRound,
  Lock,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  changeVaultPin,
  clearRecoveryQuestion,
  configureRecoveryQuestion,
  decryptVaultPhotoUrl,
  deleteVaultEntry,
  encryptAndStorePhoto,
  getLockoutStatus,
  getRecoveryConfig,
  isPinConfigured,
  listVaultEntries,
  PhotoHandlingMode,
  PublicGalleryPhoto,
  resetEntireVault,
  resetPinWithRecovery,
  setupPin,
  VaultEntryMeta,
  verifyPin,
} from '../lib/vaultWebCrypto';
import { PinPad } from './PinPad';

const INITIAL_PUBLIC_PHOTOS: PublicGalleryPhoto[] = [
  {
    id: 'sample-dolomites',
    name: 'IMG_20261114_1742.jpg',
    folder: 'DCIM/Camera',
    mimeType: 'image/jpeg',
    sizeBytes: 2_840_120,
    capturedAt: 'Nov 14 · 17:42',
    previewUrl: '/src/assets/images/sample_mountain_trail_1794977271128.jpg',
    isSample: true,
  },
  {
    id: 'sample-travel-docs',
    name: 'Passport_Itinerary.jpg',
    folder: 'Pictures/Documents',
    mimeType: 'image/jpeg',
    sizeBytes: 1_912_440,
    capturedAt: 'Nov 15 · 09:18',
    previewUrl: '/src/assets/images/sample_travel_docs_1794977271007.jpg',
    isSample: true,
  },
  {
    id: 'sample-kyoto',
    name: 'Kyoto_Alley_Dusk.jpg',
    folder: 'DCIM/Camera',
    mimeType: 'image/jpeg',
    sizeBytes: 3_190_880,
    capturedAt: 'Nov 16 · 20:04',
    previewUrl: '/src/assets/images/sample_night_street_1794977271751.jpg',
    isSample: true,
  },
  {
    id: 'sample-glasshouse',
    name: 'Botanical_Conservatory.jpg',
    folder: 'Pictures/Downloads',
    mimeType: 'image/jpeg',
    sizeBytes: 2_410_500,
    capturedAt: 'Nov 17 · 11:30',
    previewUrl: '/src/assets/images/sample_botanical_glasshouse_1794977272201.jpg',
    isSample: true,
  },
];

const HANDLING_MODES: {
  id: PhotoHandlingMode;
  label: string;
  shortLabel: string;
  summary: string;
}[] = [
  {
    id: 'both_dual',
    label: 'Both (Dual Lock)',
    shortLabel: 'Both Modes',
    summary: 'AES-256-GCM internal sandbox + .nomedia stealth directory + permanent MediaStore purge.',
  },
  {
    id: 'move_encrypt',
    label: 'Move & Encrypt',
    shortLabel: 'Move & Encrypt',
    summary: 'Encrypts into app-private filesDir and calls MediaStore.createDeleteRequest to delete public file.',
  },
  {
    id: 'stealth_nomedia',
    label: 'Stealth .nomedia',
    shortLabel: 'Stealth .nomedia',
    summary: 'Moves to .SecretGalleryVault/ with .nomedia marker, de-indexes MediaStore, and keeps encrypted backup.',
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const VaultInteractiveWorkbench: React.FC = () => {
  const [setupNeeded, setSetupNeeded] = useState<boolean>(true);
  const [sessionDek, setSessionDek] = useState<CryptoKey | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);
  const [authBusy, setAuthBusy] = useState(false);

  const [handlingMode, setHandlingMode] = useState<PhotoHandlingMode>('both_dual');
  const [publicPhotos, setPublicPhotos] = useState<PublicGalleryPhoto[]>(INITIAL_PUBLIC_PHOTOS);
  const [vaultEntries, setVaultEntries] = useState<VaultEntryMeta[]>([]);
  const [decryptedThumbs, setDecryptedThumbs] = useState<Record<string, string>>({});
  const [galleryTab, setGalleryTab] = useState<'visible' | 'hidden'>('visible');

  const [inspectedPhoto, setInspectedPhoto] = useState<{
    meta: VaultEntryMeta;
    url: string;
  } | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [pinChangeNotice, setPinChangeNotice] = useState<string | null>(null);

  const [recoveryConfigured, setRecoveryConfigured] = useState(false);
  const [recoveryQuestion, setRecoveryQuestion] = useState<string | null>(null);
  const [recQuestionDraft, setRecQuestionDraft] = useState(
    'What was the name of your first school?'
  );
  const [recAnswerDraft, setRecAnswerDraft] = useState('');
  const [recPinConfirmDraft, setRecPinConfirmDraft] = useState('');
  const [recNotice, setRecNotice] = useState<string | null>(null);

  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const decryptedThumbsRef = useRef<Record<string, string>>({});
  decryptedThumbsRef.current = decryptedThumbs;

  useEffect(() => {
    let active = true;
    async function init() {
      const [configured, recCfg] = await Promise.all([
        isPinConfigured(),
        getRecoveryConfig(),
      ]);
      if (!active) return;
      setSetupNeeded(!configured);
      setRecoveryConfigured(recCfg.configured);
      setRecoveryQuestion(recCfg.question);
      if (recCfg.question) setRecQuestionDraft(recCfg.question);
      setLockoutSeconds(getLockoutStatus().remainingSeconds);
    }
    void init();
    return () => {
      active = false;
    };
  }, []);

  // Wipe RAM object URLs and lock when component unmounts
  useEffect(() => {
    return () => {
      Object.values(decryptedThumbsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const refreshVaultFromDb = async (dek: CryptoKey) => {
    const entries = await listVaultEntries();
    setVaultEntries(entries);

    // Hide any sample photos already encrypted in the vault from Public Gallery
    const vaultedNames = new Set(entries.map((e) => e.originalName));
    setPublicPhotos((prev) => prev.filter((p) => !vaultedNames.has(p.name)));

    const thumbMap: Record<string, string> = {};
    for (const entry of entries) {
      const dec = await decryptVaultPhotoUrl(dek, entry.id);
      if (dec) {
        thumbMap[entry.id] = dec.url;
      }
    }
    setDecryptedThumbs((prev) => {
      Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
      return thumbMap;
    });
  };

  const lockVaultNow = () => {
    Object.values(decryptedThumbsRef.current).forEach((url) => URL.revokeObjectURL(url));
    if (inspectedPhoto) {
      URL.revokeObjectURL(inspectedPhoto.url);
    }
    setDecryptedThumbs({});
    setInspectedPhoto(null);
    setShowSettings(false);
    setSessionDek(null);
    setPinError(null);
  };

  const handleSetupComplete = async (pin: string) => {
    setAuthBusy(true);
    try {
      const dek = await setupPin(pin);
      setSetupNeeded(false);
      setSessionDek(dek);
      setPinError(null);
      await refreshVaultFromDb(dek);
      setStatusBanner('Vault PIN configured. Select any public photo on the right to encrypt and hide it.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleUnlockAttempt = async (pin: string) => {
    setAuthBusy(true);
    try {
      const res = await verifyPin(pin);
      if (res.ok) {
        setSessionDek(res.dek);
        setPinError(null);
        setLockoutSeconds(0);
        await refreshVaultFromDb(res.dek);
      } else if (res.lockedSeconds > 0) {
        setLockoutSeconds(res.lockedSeconds);
        setPinError(`Too many attempts. Vault locked for ${res.lockedSeconds}s.`);
      } else {
        setPinError(`Incorrect PIN. ${res.remainingBeforeLockout} attempt(s) remaining before cooldown.`);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleImportPublicPhoto = async (photo: PublicGalleryPhoto) => {
    if (!sessionDek) {
      setStatusBanner('Unlock the Secret Gallery phone vault with your PIN first before importing.');
      return;
    }
    setImportingId(photo.id);
    try {
      const response = await fetch(photo.previewUrl);
      const buffer = await response.arrayBuffer();
      const meta = await encryptAndStorePhoto(sessionDek, photo, buffer, handlingMode);
      const dec = await decryptVaultPhotoUrl(sessionDek, meta.id);

      setVaultEntries((prev) => [meta, ...prev]);
      if (dec) {
        setDecryptedThumbs((prev) => ({ ...prev, [meta.id]: dec.url }));
      }

      // Remove from public gallery visibility immediately
      setPublicPhotos((prev) => prev.filter((item) => item.id !== photo.id));
      if (!photo.isSample && photo.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(photo.previewUrl);
      }

      setStatusBanner(
        `${photo.name} encrypted with AES-256-GCM and purged from public ${photo.folder}.`
      );
    } catch {
      setStatusBanner(`Failed to encrypt ${photo.name}.`);
    } finally {
      setImportingId(null);
    }
  };

  const handleLocalFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: PublicGalleryPhoto[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      added.push({
        id: `upload-${crypto.randomUUID()}`,
        name: file.name,
        folder: 'DCIM/Camera',
        mimeType: file.type || 'image/jpeg',
        sizeBytes: file.size,
        capturedAt: 'Just now',
        previewUrl: URL.createObjectURL(file),
        isSample: false,
      });
    }
    if (added.length > 0) {
      setPublicPhotos((prev) => [...added, ...prev]);
      setGalleryTab('visible');
      setStatusBanner(
        `Added ${added.length} photo(s) to the simulated public gallery. Click "Hide in Vault" to encrypt and purge from public view.`
      );
    }
  };

  const handleRestorePhoto = async (meta: VaultEntryMeta) => {
    if (!sessionDek) return;
    const dec = await decryptVaultPhotoUrl(sessionDek, meta.id);
    if (!dec) return;

    await deleteVaultEntry(meta.id);
    setVaultEntries((prev) => prev.filter((e) => e.id !== meta.id));
    setDecryptedThumbs((prev) => {
      const next = { ...prev };
      if (next[meta.id]) URL.revokeObjectURL(next[meta.id]);
      delete next[meta.id];
      return next;
    });
    setInspectedPhoto(null);

    setPublicPhotos((prev) => [
      {
        id: `restored-${meta.id}`,
        name: meta.originalName,
        folder: 'Pictures/Restored',
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        capturedAt: 'Restored just now',
        previewUrl: dec.url,
        isSample: false,
      },
      ...prev,
    ]);
    setGalleryTab('visible');
    setStatusBanner(`${meta.originalName} decrypted and restored to Pictures/Restored.`);
  };

  const handleDeleteForever = async (meta: VaultEntryMeta) => {
    await deleteVaultEntry(meta.id);
    setVaultEntries((prev) => prev.filter((e) => e.id !== meta.id));
    setDecryptedThumbs((prev) => {
      const next = { ...prev };
      if (next[meta.id]) URL.revokeObjectURL(next[meta.id]);
      delete next[meta.id];
      return next;
    });
    if (inspectedPhoto?.meta.id === meta.id) {
      URL.revokeObjectURL(inspectedPhoto.url);
      setInspectedPhoto(null);
    }
    setStatusBanner(`${meta.originalName} permanently wiped from vault storage.`);
  };

  const handlePinChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinChangeNotice(null);
    if (!/^\d{4,8}$/.test(newPinInput)) {
      setPinChangeNotice('New PIN must be 4 to 8 digits.');
      return;
    }
    const res = await changeVaultPin(currentPinInput, newPinInput);
    if (!res.ok) {
      setPinChangeNotice(res.error);
      return;
    }
    setSessionDek(res.dek);
    setCurrentPinInput('');
    setNewPinInput('');
    setPinChangeNotice('PIN updated and 256-bit DEK re-wrapped.');
  };

  const handleSaveRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecNotice(null);
    const res = await configureRecoveryQuestion(
      recPinConfirmDraft,
      recQuestionDraft,
      recAnswerDraft
    );
    if (!res.ok) {
      setRecNotice(res.error);
      return;
    }
    setRecoveryConfigured(true);
    setRecoveryQuestion(res.question);
    setRecAnswerDraft('');
    setRecPinConfirmDraft('');
    setRecNotice('Encrypted recovery question saved (PBKDF2-SHA256 + DEK wrap).');
  };

  const handleClearRecovery = async () => {
    setRecNotice(null);
    const res = await clearRecoveryQuestion(recPinConfirmDraft);
    if (!res.ok) {
      setRecNotice(res.error);
      return;
    }
    setRecoveryConfigured(false);
    setRecoveryQuestion(null);
    setRecPinConfirmDraft('');
    setRecNotice('Recovery question removed.');
  };

  const handleResetDemo = async () => {
    lockVaultNow();
    await resetEntireVault();
    setSetupNeeded(true);
    setRecoveryConfigured(false);
    setRecoveryQuestion(null);
    setVaultEntries([]);
    setPublicPhotos(INITIAL_PUBLIC_PHOTOS);
    setLockoutSeconds(0);
    setStatusBanner('Vault reset. Create a new PIN to begin.');
  };

  const activeModeObj = HANDLING_MODES.find((m) => m.id === handlingMode)!;

  return (
    <div className="space-y-6">
      {statusBanner && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-700">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
            <span className="truncate">{statusBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-xs font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap shrink-0 px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 5 columns: Android Vault Device Preview */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full max-w-[390px] bg-slate-950 rounded-[28px] border border-slate-800 shadow-xl overflow-hidden flex flex-col h-[660px]">
            {/* Simulated Android Status Bar */}
            <div className="flex items-center justify-between px-6 py-2.5 bg-slate-950 border-b border-slate-900 text-[11px] text-slate-400 font-mono tabular-nums">
              <span>SecretGallery</span>
              <span>{sessionDek ? 'AES-256-GCM Unlocked' : 'FLAG_SECURE Locked'}</span>
            </div>

            {!sessionDek ? (
              <div className="flex-1 min-h-0 relative">
                <PinPad
                  isSetupMode={setupNeeded}
                  recoveryQuestion={recoveryQuestion}
                  lockoutSeconds={lockoutSeconds}
                  errorMessage={pinError}
                  busy={authBusy}
                  onSetupComplete={handleSetupComplete}
                  onUnlockAttempt={handleUnlockAttempt}
                  onRecoverPin={async (answer, newPin) => {
                    setAuthBusy(true);
                    try {
                      const res = await resetPinWithRecovery(answer, newPin);
                      if (res.ok) {
                        setSessionDek(res.dek);
                        setPinError(null);
                        setLockoutSeconds(0);
                        await refreshVaultFromDb(res.dek);
                        setStatusBanner(
                          'PIN reset via encrypted recovery question. All vault photos remain intact.'
                        );
                        return { ok: true };
                      }
                      if (res.lockedSeconds > 0) {
                        setLockoutSeconds(res.lockedSeconds);
                      }
                      return { ok: false, error: res.error };
                    } finally {
                      setAuthBusy(false);
                    }
                  }}
                />
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col bg-[#0B0E14] text-slate-100 relative">
                {/* Vault App Top Bar */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#121722] border-b border-slate-800/80">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">Private Vault</div>
                    <div className="text-[11px] text-slate-400 tabular-nums truncate">
                      {vaultEntries.length} encrypted · {activeModeObj.shortLabel}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowSettings((v) => !v)}
                      aria-label="Vault Settings"
                      className="min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={lockVaultNow}
                      aria-label="Lock Vault"
                      className="min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-teal-400 hover:bg-slate-800 transition-colors"
                    >
                      <Lock className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Handling Mode Quick Switcher */}
                <div className="px-3 py-2.5 bg-[#0F141E] border-b border-slate-800/70">
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 rounded-lg">
                    {HANDLING_MODES.map((mode) => {
                      const active = handlingMode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setHandlingMode(mode.id)}
                          className={`px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap truncate ${
                            active
                              ? 'bg-teal-500 text-slate-950'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {mode.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Vault Grid or Empty State */}
                <div className="flex-1 overflow-y-auto p-3">
                  {vaultEntries.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-5">
                      <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3">
                        <FolderLock className="w-5 h-5 text-teal-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-200">No photos in vault yet</p>
                      <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                        Click Hide in Vault on any photo in the Public Gallery panel to encrypt it here and purge it from MediaStore.
                      </p>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-4 px-4 py-2 rounded-lg bg-teal-500 text-slate-950 text-xs font-semibold hover:bg-teal-400 transition-colors"
                      >
                        Upload Photo from Device
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {vaultEntries.map((entry) => {
                        const thumbUrl = decryptedThumbs[entry.id];
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={async () => {
                              if (!sessionDek) return;
                              const dec = await decryptVaultPhotoUrl(sessionDek, entry.id);
                              if (dec) setInspectedPhoto(dec);
                            }}
                            className="group relative aspect-square rounded-lg overflow-hidden bg-slate-900 border border-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                          >
                            {thumbUrl && !failedImages[entry.id] ? (
                              <img
                                src={thumbUrl}
                                alt={entry.originalName}
                                referrerPolicy="no-referrer"
                                onError={() =>
                                  setFailedImages((prev) => ({ ...prev, [entry.id]: true }))
                                }
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-500 p-2 text-center">
                                Encrypted
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Bottom Vault Action Bar */}
                <div className="px-4 py-3 bg-[#121722] border-t border-slate-800/80 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 min-h-[40px] px-3 py-2 rounded-lg bg-teal-500 text-slate-950 text-xs font-semibold hover:bg-teal-400 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <ImagePlus className="w-4 h-4" />
                    Import Photo
                  </button>
                  <button
                    type="button"
                    onClick={lockVaultNow}
                    className="min-h-[40px] px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-medium hover:bg-slate-700 transition-colors whitespace-nowrap"
                  >
                    Lock Now
                  </button>
                </div>

                {/* In-Phone Settings Overlay */}
                {showSettings && (
                  <div className="absolute inset-0 bg-[#0B0E14]/95 backdrop-blur-sm p-4 flex flex-col justify-between overflow-y-auto z-20 gap-5">
                    <div className="space-y-5">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                        <h4 className="text-sm font-semibold text-white">Security &amp; Recovery</h4>
                        <button
                          type="button"
                          onClick={() => setShowSettings(false)}
                          className="p-1.5 text-slate-400 hover:text-white"
                          aria-label="Close settings"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <form onSubmit={handleSaveRecoverySubmit} className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-200">
                            Encrypted Recovery Question
                          </span>
                          <span className="text-[11px] text-teal-400">
                            {recoveryConfigured ? 'Active' : 'Off'}
                          </span>
                        </div>
                        <input
                          type="text"
                          value={recQuestionDraft}
                          onChange={(e) => setRecQuestionDraft(e.target.value)}
                          placeholder="Recovery question"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
                        />
                        <input
                          type="password"
                          value={recAnswerDraft}
                          onChange={(e) => setRecAnswerDraft(e.target.value)}
                          placeholder="Recovery answer (PBKDF2 hashed)"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
                        />
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={8}
                          value={recPinConfirmDraft}
                          onChange={(e) => setRecPinConfirmDraft(e.target.value.replace(/\D/g, ''))}
                          placeholder="Confirm current PIN"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
                        />
                        {recNotice && <p className="text-[11px] text-teal-300">{recNotice}</p>}
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            className="flex-1 py-2 rounded-lg bg-teal-500 text-slate-950 text-xs font-semibold hover:bg-teal-400 transition-colors"
                          >
                            {recoveryConfigured ? 'Update Recovery' : 'Save Recovery'}
                          </button>
                          {recoveryConfigured && (
                            <button
                              type="button"
                              onClick={() => void handleClearRecovery()}
                              className="px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-medium hover:bg-slate-700 transition-colors"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </form>

                      <form onSubmit={handlePinChangeSubmit} className="pt-4 border-t border-slate-800 space-y-2.5">
                        <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                          <KeyRound className="w-3.5 h-3.5 text-teal-400" />
                          Change Vault PIN (re-wraps 256-bit DEK)
                        </div>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={8}
                          value={currentPinInput}
                          onChange={(e) => setCurrentPinInput(e.target.value.replace(/\D/g, ''))}
                          placeholder="Current PIN"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
                        />
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={8}
                          value={newPinInput}
                          onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, ''))}
                          placeholder="New PIN (4–8 digits)"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
                        />
                        {pinChangeNotice && (
                          <p className="text-[11px] text-teal-300">{pinChangeNotice}</p>
                        )}
                        <button
                          type="submit"
                          className="w-full py-2 rounded-lg bg-slate-800 text-slate-100 text-xs font-semibold hover:bg-slate-700 transition-colors"
                        >
                          Update PIN
                        </button>
                      </form>
                    </div>

                    <div className="pt-3 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => void handleResetDemo()}
                        className="w-full py-2 rounded-lg border border-rose-500/40 text-rose-300 text-xs font-medium hover:bg-rose-950/50 transition-colors"
                      >
                        Reset Vault &amp; Wipe Keys
                      </button>
                    </div>
                  </div>
                )}

                {/* In-Phone Full-Screen Photo Inspector */}
                {inspectedPhoto && (
                  <div className="absolute inset-0 bg-[#0B0E14] p-4 flex flex-col justify-between z-30">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">
                          {inspectedPhoto.meta.originalName}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {formatBytes(inspectedPhoto.meta.sizeBytes)} · Public copy purged
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(inspectedPhoto.url);
                          setInspectedPhoto(null);
                        }}
                        className="p-1.5 text-slate-400 hover:text-white"
                        aria-label="Close photo"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex-1 min-h-0 my-3 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
                      <img
                        src={inspectedPhoto.url}
                        alt={inspectedPhoto.meta.originalName}
                        referrerPolicy="no-referrer"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[10px] text-slate-400 space-y-1 mb-3">
                      <div className="truncate">IV (96-bit): {inspectedPhoto.meta.ivHex}</div>
                      <div className="truncate">
                        Ciphertext: {inspectedPhoto.meta.ciphertextPreviewHex}...
                      </div>
                      {inspectedPhoto.meta.stealthPath && (
                        <div className="truncate text-teal-400">
                          Stealth: {inspectedPhoto.meta.stealthPath}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRestorePhoto(inspectedPhoto.meta)}
                        className="py-2 px-3 rounded-lg bg-slate-800 text-slate-100 text-xs font-medium hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteForever(inspectedPhoto.meta)}
                        className="py-2 px-3 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-500 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Wipe
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right 7 columns: Public Android Gallery & Visibility Verification */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Public Android Gallery Visibility
              </h2>
              <p className="mt-1 text-sm text-slate-600 max-w-xl">
                Test both photo handling strategies live. Photos hidden into the PIN vault are encrypted in your browser via WebCrypto AES-256-GCM and removed from public MediaStore visibility.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  void handleLocalFileUpload(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Add Local Photos
              </button>
            </div>
          </div>

          {/* Active Handling Mode Summary */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                Active Handling Strategy: {activeModeObj.label}
              </span>
              <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
                {HANDLING_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setHandlingMode(m.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      handlingMode === m.id
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {m.shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-600">{activeModeObj.summary}</p>
          </div>

          {/* Public vs Hidden Audit Tabs */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setGalleryTab('visible')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  galleryTab === 'visible'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Visible in Public Gallery ({publicPhotos.length})
              </button>
              <button
                type="button"
                onClick={() => setGalleryTab('hidden')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  galleryTab === 'hidden'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <EyeOff className="w-3.5 h-3.5" />
                Purged &amp; Encrypted ({vaultEntries.length})
              </button>
            </div>

            {publicPhotos.length === 0 && (
              <button
                type="button"
                onClick={() => setPublicPhotos(INITIAL_PUBLIC_PHOTOS)}
                className="text-xs font-medium text-teal-700 hover:text-teal-900 whitespace-nowrap"
              >
                Restore Sample Photos
              </button>
            )}
          </div>

          {galleryTab === 'visible' ? (
            publicPhotos.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-slate-200 rounded-xl">
                <p className="text-sm font-medium text-slate-800">
                  Zero photos visible in public DCIM / Pictures
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Every imported photo has been encrypted and purged from MediaStore.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {publicPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    className="border border-slate-200 rounded-xl overflow-hidden bg-white flex flex-col"
                  >
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      {!failedImages[photo.id] ? (
                        <img
                          src={photo.previewUrl}
                          alt={photo.name}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setFailedImages((prev) => ({ ...prev, [photo.id]: true }))
                          }
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                          {photo.name}
                        </div>
                      )}
                    </div>
                    <div className="p-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {photo.name}
                        </div>
                        <div className="text-xs text-slate-500 tabular-nums truncate">
                          {photo.folder} · {formatBytes(photo.sizeBytes)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={importingId === photo.id}
                        onClick={() => void handleImportPublicPhoto(photo)}
                        className="px-3 py-2 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        {importingId === photo.id ? 'Encrypting...' : 'Hide in Vault'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : vaultEntries.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-slate-200 rounded-xl">
              <p className="text-sm font-medium text-slate-800">No encrypted records yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Unlock the vault with your PIN and hide a photo from the Public Gallery tab to inspect its AES-256-GCM record.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-3 font-medium">Original File</th>
                    <th className="py-2.5 px-3 font-medium">Mode</th>
                    <th className="py-2.5 px-3 font-medium">Public MediaStore</th>
                    <th className="py-2.5 px-3 font-medium font-mono">AES-GCM IV (Hex)</th>
                    <th className="py-2.5 px-3 font-medium text-right">Encrypted Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vaultEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        <div>{entry.originalName}</div>
                        <div className="text-[11px] text-slate-500 font-normal">
                          From {entry.originalFolder}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {HANDLING_MODES.find((m) => m.id === entry.handlingMode)?.shortLabel}
                      </td>
                      <td className="py-2.5 px-3 text-teal-700 font-medium">
                        {entry.stealthPath ? 'Purged + .nomedia' : 'Purged (Deleted)'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 tabular-nums">
                        {entry.ivHex}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700 tabular-nums">
                        {formatBytes(entry.encryptedByteLength)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
