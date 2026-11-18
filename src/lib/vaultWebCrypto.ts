export type PhotoHandlingMode = 'move_encrypt' | 'stealth_nomedia' | 'both_dual';

export interface PublicGalleryPhoto {
  id: string;
  name: string;
  folder: string;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  previewUrl: string;
  isSample?: boolean;
}

export interface VaultEntryMeta {
  id: string;
  originalName: string;
  originalFolder: string;
  mimeType: string;
  sizeBytes: number;
  importedAtMs: number;
  handlingMode: PhotoHandlingMode;
  publicPurgeVerified: boolean;
  stealthPath: string | null;
  ivHex: string;
  ciphertextPreviewHex: string;
  encryptedByteLength: number;
}

interface AuthRecord {
  id: 'pin_config';
  saltB64: string;
  verifierB64: string;
  wrappedDekB64: string;
  wrappedDekIvB64: string;
  recoveryQuestion?: string;
  recoverySaltB64?: string;
  recoveryVerifierB64?: string;
  recoveryWrappedDekB64?: string;
  recoveryWrappedDekIvB64?: string;
}

interface EncryptedBlobRecord {
  id: string;
  meta: VaultEntryMeta;
  encryptedBuffer: ArrayBuffer;
}

const DB_NAME = 'secret_gallery_vault_v1';
const DB_VERSION = 1;
const AUTH_STORE = 'auth';
const VAULT_STORE = 'vault_blobs';
const LOCKOUT_STORAGE_KEY = 'sg_lockout_state_v1';
const PBKDF2_ITERATIONS = 120_000;
const MAX_FREE_ATTEMPTS = 5;

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AUTH_STORE)) {
        db.createObjectStore(AUTH_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(VAULT_STORE)) {
        db.createObjectStore(VAULT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derivePinMaterial(
  pin: string,
  salt: Uint8Array
): Promise<{ verifier: Uint8Array; kek: CryptoKey }> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const saltCopy = new Uint8Array(salt);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltCopy,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    512
  );

  const full = new Uint8Array(derivedBits);
  const verifier = full.slice(0, 32);
  const kekBytes = full.slice(32, 64);

  const kek = await crypto.subtle.importKey(
    'raw',
    kekBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  kekBytes.fill(0);
  return { verifier, kek };
}

export function getLockoutStatus(): { failedAttempts: number; remainingSeconds: number } {
  try {
    const raw = localStorage.getItem(LOCKOUT_STORAGE_KEY);
    if (!raw) return { failedAttempts: 0, remainingSeconds: 0 };
    const parsed = JSON.parse(raw) as { failedAttempts: number; lockoutUntilMs: number };
    const now = Date.now();
    if (parsed.lockoutUntilMs > now) {
      return {
        failedAttempts: parsed.failedAttempts,
        remainingSeconds: Math.ceil((parsed.lockoutUntilMs - now) / 1000),
      };
    }
    return { failedAttempts: parsed.failedAttempts || 0, remainingSeconds: 0 };
  } catch {
    return { failedAttempts: 0, remainingSeconds: 0 };
  }
}

function recordFailedAttempt(): { remainingBeforeLockout: number; lockedSeconds: number } {
  const current = getLockoutStatus();
  const failures = current.failedAttempts + 1;
  if (failures >= MAX_FREE_ATTEMPTS) {
    const cooldown = failures === MAX_FREE_ATTEMPTS ? 30 : failures === MAX_FREE_ATTEMPTS + 1 ? 60 : 300;
    localStorage.setItem(
      LOCKOUT_STORAGE_KEY,
      JSON.stringify({ failedAttempts: failures, lockoutUntilMs: Date.now() + cooldown * 1000 })
    );
    return { remainingBeforeLockout: 0, lockedSeconds: cooldown };
  }
  localStorage.setItem(
    LOCKOUT_STORAGE_KEY,
    JSON.stringify({ failedAttempts: failures, lockoutUntilMs: 0 })
  );
  return { remainingBeforeLockout: MAX_FREE_ATTEMPTS - failures, lockedSeconds: 0 };
}

function resetFailedAttempts(): void {
  localStorage.removeItem(LOCKOUT_STORAGE_KEY);
}

export async function isPinConfigured(): Promise<boolean> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readonly');
    const req = tx.objectStore(AUTH_STORE).get('pin_config');
    req.onsuccess = () => resolve(Boolean(req.result));
    req.onerror = () => reject(req.error);
  });
}

export async function setupPin(pin: string): Promise<CryptoKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { verifier, kek } = await derivePinMaterial(pin, salt);

  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDekBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: wrapIv },
    kek,
    dekRaw
  );

  const dekKey = await crypto.subtle.importKey(
    'raw',
    dekRaw,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  dekRaw.fill(0);

  const record: AuthRecord = {
    id: 'pin_config',
    saltB64: bytesToB64(salt),
    verifierB64: bytesToB64(verifier),
    wrappedDekB64: bytesToB64(new Uint8Array(wrappedDekBuf)),
    wrappedDekIvB64: bytesToB64(wrapIv),
  };

  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    tx.objectStore(AUTH_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  resetFailedAttempts();
  return dekKey;
}

export async function verifyPin(
  pin: string
): Promise<
  | { ok: true; dek: CryptoKey }
  | { ok: false; remainingBeforeLockout: number; lockedSeconds: number }
> {
  const lockout = getLockoutStatus();
  if (lockout.remainingSeconds > 0) {
    return { ok: false, remainingBeforeLockout: 0, lockedSeconds: lockout.remainingSeconds };
  }

  const db = await openVaultDb();
  const record = await new Promise<AuthRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readonly');
    const req = tx.objectStore(AUTH_STORE).get('pin_config');
    req.onsuccess = () => resolve(req.result as AuthRecord | undefined);
    req.onerror = () => reject(req.error);
  });

  if (!record) {
    return { ok: false, remainingBeforeLockout: MAX_FREE_ATTEMPTS, lockedSeconds: 0 };
  }

  const salt = b64ToBytes(record.saltB64);
  const expectedVerifier = b64ToBytes(record.verifierB64);
  const { verifier, kek } = await derivePinMaterial(pin, salt);

  if (!constantTimeEqual(expectedVerifier, verifier)) {
    const fail = recordFailedAttempt();
    return {
      ok: false,
      remainingBeforeLockout: fail.remainingBeforeLockout,
      lockedSeconds: fail.lockedSeconds,
    };
  }

  const wrappedDek = new Uint8Array(b64ToBytes(record.wrappedDekB64));
  const wrapIv = new Uint8Array(b64ToBytes(record.wrappedDekIvB64));
  const dekBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: wrapIv },
    kek,
    wrappedDek
  );

  const dek = await crypto.subtle.importKey(
    'raw',
    dekBuf,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  resetFailedAttempts();
  return { ok: true, dek };
}

export async function changeVaultPin(
  currentPin: string,
  newPin: string
): Promise<{ ok: true; dek: CryptoKey } | { ok: false; error: string }> {
  const res = await verifyPin(currentPin);
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.lockedSeconds > 0
          ? `Locked out for ${res.lockedSeconds}s.`
          : `Current PIN incorrect (${res.remainingBeforeLockout} attempt(s) left).`,
    };
  }

  const dekRaw = new Uint8Array(await crypto.subtle.exportKey('raw', res.dek));
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  const { verifier, kek } = await derivePinMaterial(newPin, newSalt);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDekBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: wrapIv },
    kek,
    dekRaw
  );
  dekRaw.fill(0);

  const db = await openVaultDb();
  const existing = await new Promise<AuthRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readonly');
    const req = tx.objectStore(AUTH_STORE).get('pin_config');
    req.onsuccess = () => resolve(req.result as AuthRecord | undefined);
    req.onerror = () => reject(req.error);
  });

  const record: AuthRecord = {
    ...(existing ?? {}),
    id: 'pin_config',
    saltB64: bytesToB64(newSalt),
    verifierB64: bytesToB64(verifier),
    wrappedDekB64: bytesToB64(new Uint8Array(wrappedDekBuf)),
    wrappedDekIvB64: bytesToB64(wrapIv),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    tx.objectStore(AUTH_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { ok: true, dek: res.dek };
}

export async function getRecoveryConfig(): Promise<{
  configured: boolean;
  question: string | null;
}> {
  const db = await openVaultDb();
  const record = await new Promise<AuthRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readonly');
    const req = tx.objectStore(AUTH_STORE).get('pin_config');
    req.onsuccess = () => resolve(req.result as AuthRecord | undefined);
    req.onerror = () => reject(req.error);
  });
  if (
    record?.recoveryQuestion &&
    record.recoverySaltB64 &&
    record.recoveryVerifierB64 &&
    record.recoveryWrappedDekB64 &&
    record.recoveryWrappedDekIvB64
  ) {
    return { configured: true, question: record.recoveryQuestion };
  }
  return { configured: false, question: null };
}

export async function configureRecoveryQuestion(
  currentPin: string,
  question: string,
  answer: string
): Promise<{ ok: true; question: string } | { ok: false; error: string }> {
  const cleanQuestion = question.trim();
  const normalizedAnswer = answer.trim().toLowerCase();
  if (cleanQuestion.length < 6) {
    return { ok: false, error: 'Recovery question must be at least 6 characters.' };
  }
  if (normalizedAnswer.length < 3) {
    return { ok: false, error: 'Recovery answer must be at least 3 characters.' };
  }

  const res = await verifyPin(currentPin);
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.lockedSeconds > 0
          ? `Locked out for ${res.lockedSeconds}s.`
          : `Current PIN incorrect (${res.remainingBeforeLockout} attempt(s) left).`,
    };
  }

  const dekRaw = new Uint8Array(await crypto.subtle.exportKey('raw', res.dek));
  const recSalt = crypto.getRandomValues(new Uint8Array(16));
  const { verifier: recVerifier, kek: recKek } = await derivePinMaterial(
    normalizedAnswer,
    recSalt
  );
  const recWrapIv = crypto.getRandomValues(new Uint8Array(12));
  const recWrappedDekBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: recWrapIv },
    recKek,
    dekRaw
  );
  dekRaw.fill(0);

  const db = await openVaultDb();
  const existing = await new Promise<AuthRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readonly');
    const req = tx.objectStore(AUTH_STORE).get('pin_config');
    req.onsuccess = () => resolve(req.result as AuthRecord | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!existing) {
    return { ok: false, error: 'PIN configuration not found.' };
  }

  const updated: AuthRecord = {
    ...existing,
    recoveryQuestion: cleanQuestion,
    recoverySaltB64: bytesToB64(recSalt),
    recoveryVerifierB64: bytesToB64(recVerifier),
    recoveryWrappedDekB64: bytesToB64(new Uint8Array(recWrappedDekBuf)),
    recoveryWrappedDekIvB64: bytesToB64(recWrapIv),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    tx.objectStore(AUTH_STORE).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { ok: true, question: cleanQuestion };
}

export async function clearRecoveryQuestion(
  currentPin: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await verifyPin(currentPin);
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.lockedSeconds > 0
          ? `Locked out for ${res.lockedSeconds}s.`
          : `Current PIN incorrect (${res.remainingBeforeLockout} attempt(s) left).`,
    };
  }

  const db = await openVaultDb();
  const existing = await new Promise<AuthRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readonly');
    const req = tx.objectStore(AUTH_STORE).get('pin_config');
    req.onsuccess = () => resolve(req.result as AuthRecord | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!existing) return { ok: true };

  const updated: AuthRecord = {
    id: 'pin_config',
    saltB64: existing.saltB64,
    verifierB64: existing.verifierB64,
    wrappedDekB64: existing.wrappedDekB64,
    wrappedDekIvB64: existing.wrappedDekIvB64,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    tx.objectStore(AUTH_STORE).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { ok: true };
}

export async function resetPinWithRecovery(
  answer: string,
  newPin: string
): Promise<
  | { ok: true; dek: CryptoKey }
  | { ok: false; error: string; lockedSeconds: number }
> {
  const lockout = getLockoutStatus();
  if (lockout.remainingSeconds > 0) {
    return {
      ok: false,
      error: `Vault locked for ${lockout.remainingSeconds}s.`,
      lockedSeconds: lockout.remainingSeconds,
    };
  }
  if (!/^\d{4,8}$/.test(newPin)) {
    return { ok: false, error: 'New PIN must be 4 to 8 digits.', lockedSeconds: 0 };
  }

  const db = await openVaultDb();
  const record = await new Promise<AuthRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readonly');
    const req = tx.objectStore(AUTH_STORE).get('pin_config');
    req.onsuccess = () => resolve(req.result as AuthRecord | undefined);
    req.onerror = () => reject(req.error);
  });

  if (
    !record?.recoverySaltB64 ||
    !record.recoveryVerifierB64 ||
    !record.recoveryWrappedDekB64 ||
    !record.recoveryWrappedDekIvB64
  ) {
    return { ok: false, error: 'No recovery question configured.', lockedSeconds: 0 };
  }

  const recSalt = b64ToBytes(record.recoverySaltB64);
  const expectedVerifier = b64ToBytes(record.recoveryVerifierB64);
  const { verifier, kek: recKek } = await derivePinMaterial(
    answer.trim().toLowerCase(),
    recSalt
  );

  if (!constantTimeEqual(expectedVerifier, verifier)) {
    const fail = recordFailedAttempt();
    return {
      ok: false,
      error:
        fail.lockedSeconds > 0
          ? `Too many attempts. Vault locked for ${fail.lockedSeconds}s.`
          : `Incorrect recovery answer. ${fail.remainingBeforeLockout} attempt(s) left.`,
      lockedSeconds: fail.lockedSeconds,
    };
  }

  const recWrappedDek = new Uint8Array(b64ToBytes(record.recoveryWrappedDekB64));
  const recWrapIv = new Uint8Array(b64ToBytes(record.recoveryWrappedDekIvB64));
  const dekBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: recWrapIv },
    recKek,
    recWrappedDek
  );

  const dek = await crypto.subtle.importKey(
    'raw',
    dekBuf,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const dekRaw = new Uint8Array(dekBuf);
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  const { verifier: newVerifier, kek: newKek } = await derivePinMaterial(newPin, newSalt);
  const newWrapIv = crypto.getRandomValues(new Uint8Array(12));
  const newWrappedDekBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: newWrapIv },
    newKek,
    dekRaw
  );
  dekRaw.fill(0);

  const updated: AuthRecord = {
    ...record,
    saltB64: bytesToB64(newSalt),
    verifierB64: bytesToB64(newVerifier),
    wrappedDekB64: bytesToB64(new Uint8Array(newWrappedDekBuf)),
    wrappedDekIvB64: bytesToB64(newWrapIv),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    tx.objectStore(AUTH_STORE).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  resetFailedAttempts();
  return { ok: true, dek };
}

export async function encryptAndStorePhoto(
  dek: CryptoKey,
  photo: PublicGalleryPhoto,
  rawBytes: ArrayBuffer,
  handlingMode: PhotoHandlingMode
): Promise<VaultEntryMeta> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    dek,
    rawBytes
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  const id = crypto.randomUUID();
  const safeName = photo.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const stealthPath =
    handlingMode === 'move_encrypt'
      ? null
      : `/storage/emulated/0/Pictures/.SecretGalleryVault/.${id.slice(0, 8)}_${safeName}.sv`;

  const meta: VaultEntryMeta = {
    id,
    originalName: photo.name,
    originalFolder: photo.folder,
    mimeType: photo.mimeType,
    sizeBytes: rawBytes.byteLength,
    importedAtMs: Date.now(),
    handlingMode,
    publicPurgeVerified: true,
    stealthPath,
    ivHex: bytesToHex(iv),
    ciphertextPreviewHex: bytesToHex(new Uint8Array(ciphertext).slice(0, 24)),
    encryptedByteLength: combined.byteLength,
  };

  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readwrite');
    tx.objectStore(VAULT_STORE).put({
      id,
      meta,
      encryptedBuffer: combined.buffer,
    } satisfies EncryptedBlobRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return meta;
}

export async function listVaultEntries(): Promise<VaultEntryMeta[]> {
  const db = await openVaultDb();
  const records = await new Promise<EncryptedBlobRecord[]>((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readonly');
    const req = tx.objectStore(VAULT_STORE).getAll();
    req.onsuccess = () => resolve((req.result as EncryptedBlobRecord[]) || []);
    req.onerror = () => reject(req.error);
  });
  return records
    .map((r) => r.meta)
    .sort((a, b) => b.importedAtMs - a.importedAtMs);
}

export async function decryptVaultPhotoUrl(
  dek: CryptoKey,
  photoId: string
): Promise<{ url: string; meta: VaultEntryMeta } | null> {
  const db = await openVaultDb();
  const record = await new Promise<EncryptedBlobRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readonly');
    const req = tx.objectStore(VAULT_STORE).get(photoId);
    req.onsuccess = () => resolve(req.result as EncryptedBlobRecord | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!record) return null;

  const combined = new Uint8Array(record.encryptedBuffer);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    dek,
    ciphertext
  );

  const blob = new Blob([plaintext], { type: record.meta.mimeType });
  return {
    url: URL.createObjectURL(blob),
    meta: record.meta,
  };
}

export async function deleteVaultEntry(photoId: string): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readwrite');
    tx.objectStore(VAULT_STORE).delete(photoId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function resetEntireVault(): Promise<void> {
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([AUTH_STORE, VAULT_STORE], 'readwrite');
    tx.objectStore(AUTH_STORE).clear();
    tx.objectStore(VAULT_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  resetFailedAttempts();
}
