import React, { useEffect, useState } from 'react';
import { Check, Delete, KeyRound, Lock, X } from 'lucide-react';

interface PinPadProps {
  isSetupMode: boolean;
  recoveryQuestion: string | null;
  lockoutSeconds: number;
  errorMessage: string | null;
  busy: boolean;
  onSetupComplete: (pin: string) => Promise<void> | void;
  onUnlockAttempt: (pin: string) => Promise<void> | void;
  onRecoverPin: (
    answer: string,
    newPin: string
  ) => Promise<{ ok: boolean; error?: string }>;
}

export const PinPad: React.FC<PinPadProps> = ({
  isSetupMode,
  recoveryQuestion,
  lockoutSeconds,
  errorMessage,
  busy,
  onSetupComplete,
  onUnlockAttempt,
  onRecoverPin,
}) => {
  const [enteredPin, setEnteredPin] = useState('');
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [remainingLock, setRemainingLock] = useState(lockoutSeconds);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recAnswer, setRecAnswer] = useState('');
  const [recNewPin, setRecNewPin] = useState('');
  const [recConfirmPin, setRecConfirmPin] = useState('');
  const [recError, setRecError] = useState<string | null>(null);

  useEffect(() => {
    setRemainingLock(lockoutSeconds);
  }, [lockoutSeconds]);

  useEffect(() => {
    if (remainingLock <= 0) return;
    const timer = window.setInterval(() => {
      setRemainingLock((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remainingLock]);

  const handleDigit = (digit: string) => {
    if (busy || remainingLock > 0 || enteredPin.length >= 8) return;
    setLocalError(null);
    setEnteredPin((prev) => prev + digit);
  };

  const handleBackspace = () => {
    if (busy || remainingLock > 0) return;
    setEnteredPin((prev) => prev.slice(0, -1));
  };

  const handleSubmit = async () => {
    if (busy || remainingLock > 0) return;
    if (enteredPin.length < 4) {
      setLocalError('Enter at least 4 digits.');
      return;
    }

    if (isSetupMode) {
      if (firstPin === null) {
        setFirstPin(enteredPin);
        setEnteredPin('');
        setLocalError(null);
      } else if (firstPin === enteredPin) {
        const finalPin = enteredPin;
        setEnteredPin('');
        setFirstPin(null);
        await onSetupComplete(finalPin);
      } else {
        setLocalError('PINs did not match. Start over.');
        setFirstPin(null);
        setEnteredPin('');
      }
    } else {
      const attempt = enteredPin;
      setEnteredPin('');
      await onUnlockAttempt(attempt);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter' && enteredPin.length >= 4) {
        void handleSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const title = !isSetupMode
    ? 'Enter Vault PIN'
    : firstPin === null
      ? 'Create Vault PIN'
      : 'Confirm Vault PIN';

  const subtitle =
    remainingLock > 0
      ? `Too many failed attempts. Locked for ${remainingLock}s.`
      : localError ??
        errorMessage ??
        (isSetupMode
          ? firstPin === null
            ? 'Choose 4 to 8 digits to wrap your 256-bit AES vault key.'
            : 'Re-enter the same PIN to seal the vault.'
          : 'PBKDF2-SHA256 · 120,000 iterations · Auto-locks on exit');

  const hasError = remainingLock > 0 || Boolean(localError || errorMessage);
  const dotCount = Math.max(4, enteredPin.length);

  return (
    <div className="flex flex-col items-center justify-between h-full px-6 py-8 bg-slate-950 text-slate-100 select-none">
      <div className="flex flex-col items-center text-center mt-2">
        <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-4">
          <Lock className="w-5 h-5 text-teal-400" />
        </div>
        <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
        <p
          className={`mt-1.5 text-xs leading-relaxed max-w-[260px] ${
            hasError ? 'text-rose-400' : 'text-slate-400'
          }`}
        >
          {subtitle}
        </p>

        <div className="flex items-center justify-center gap-3 mt-6 h-5" aria-label={`Entered ${enteredPin.length} digits`}>
          {Array.from({ length: dotCount }).map((_, idx) => {
            const filled = idx < enteredPin.length;
            return (
              <span
                key={idx}
                className={`w-3 h-3 rounded-full transition-transform duration-150 ${
                  filled
                    ? 'bg-teal-400 scale-100'
                    : 'bg-transparent border border-slate-600 scale-95'
                }`}
              />
            );
          })}
        </div>
      </div>

      <div className="w-full max-w-[248px] mt-6 space-y-3">
        {[
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ].map((row, rIdx) => (
          <div key={rIdx} className="grid grid-cols-3 gap-3.5 justify-items-center">
            {row.map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={busy || remainingLock > 0}
                onClick={() => handleDigit(digit)}
                className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 hover:bg-slate-800 active:scale-95 disabled:opacity-40 text-xl font-medium text-slate-100 tabular-nums transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                {digit}
              </button>
            ))}
          </div>
        ))}

        <div className="grid grid-cols-3 gap-3.5 justify-items-center">
          <button
            type="button"
            disabled={busy || remainingLock > 0 || enteredPin.length === 0}
            onClick={handleBackspace}
            aria-label="Backspace"
            className="w-16 h-16 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-900 active:scale-95 disabled:opacity-30 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <Delete className="w-5 h-5" />
          </button>

          <button
            type="button"
            disabled={busy || remainingLock > 0}
            onClick={() => handleDigit('0')}
            className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 hover:bg-slate-800 active:scale-95 disabled:opacity-40 text-xl font-medium text-slate-100 tabular-nums transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            0
          </button>

          <button
            type="button"
            disabled={busy || remainingLock > 0 || enteredPin.length < 4}
            onClick={() => void handleSubmit()}
            aria-label="Submit PIN"
            className={`w-16 h-16 rounded-full flex items-center justify-center active:scale-95 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
              enteredPin.length >= 4 && remainingLock === 0
                ? 'bg-teal-500 text-slate-950 hover:bg-teal-400'
                : 'bg-slate-900 text-slate-600 border border-slate-800'
            }`}
          >
            <Check className="w-5 h-5" />
          </button>
        </div>
      </div>

      {!isSetupMode && recoveryQuestion ? (
        <button
          type="button"
          disabled={remainingLock > 0}
          onClick={() => {
            setRecError(null);
            setShowRecoveryModal(true);
          }}
          className="mt-4 text-xs font-medium text-teal-400 hover:text-teal-300 disabled:opacity-40 transition-colors"
        >
          Forgot PIN? Use Encrypted Recovery
        </button>
      ) : (
        <p className="mt-5 text-[11px] text-slate-500 text-center">
          {isSetupMode ? 'Tip: Keyboard digits & Enter also work' : 'FLAG_SECURE blocks screenshots & Recents'}
        </p>
      )}

      {showRecoveryModal && recoveryQuestion && (
        <div className="fixed inset-0 sm:absolute bg-slate-950/95 backdrop-blur-sm p-5 flex flex-col justify-between z-40">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <KeyRound className="w-4 h-4 text-teal-400" />
                <span>Security &amp; Recovery Reset</span>
              </div>
              <button
                type="button"
                onClick={() => setShowRecoveryModal(false)}
                className="p-1 text-slate-400 hover:text-white"
                aria-label="Close recovery"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setRecError(null);
                if (recAnswer.trim().length < 3) {
                  setRecError('Enter your recovery answer.');
                  return;
                }
                if (!/^\d{4,8}$/.test(recNewPin)) {
                  setRecError('New PIN must be 4 to 8 digits.');
                  return;
                }
                if (recNewPin !== recConfirmPin) {
                  setRecError('New PINs do not match.');
                  return;
                }
                const res = await onRecoverPin(recAnswer, recNewPin);
                if (res.ok) {
                  setShowRecoveryModal(false);
                  setRecAnswer('');
                  setRecNewPin('');
                  setRecConfirmPin('');
                } else {
                  setRecError(res.error ?? 'Recovery failed.');
                }
              }}
              className="mt-4 space-y-3"
            >
              <p className="text-xs font-medium text-slate-200 leading-relaxed">
                {recoveryQuestion}
              </p>
              <input
                type="password"
                value={recAnswer}
                onChange={(e) => setRecAnswer(e.target.value)}
                placeholder="Recovery answer"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={recNewPin}
                onChange={(e) => setRecNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder="New PIN (4–8 digits)"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={recConfirmPin}
                onChange={(e) => setRecConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Confirm new PIN"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
              />
              {recError && <p className="text-xs text-rose-400">{recError}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-teal-500 text-slate-950 text-xs font-semibold hover:bg-teal-400 transition-colors"
              >
                Verify &amp; Reset PIN
              </button>
            </form>
          </div>
          <p className="text-[11px] text-slate-500 text-center">
            Unwraps your 256-bit DEK so all encrypted photos remain intact.
          </p>
        </div>
      )}
    </div>
  );
};
