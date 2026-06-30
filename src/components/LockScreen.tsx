import React, { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';

/**
 * LockScreen — full-screen unlock gate shown when Secure mode is on and the session is
 * locked. Password (+ TOTP/backup code if enabled). Leaks no secret names, values, or audit
 * detail — only the unlock form.
 */
export default function LockScreen({ totpEnabled, onUnlocked }: { totpEnabled: boolean; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function unlock() {
    if (!password) return;
    setBusy(true); setError('');
    const r = await window.dawn.auth.unlock(password, code);
    setBusy(false);
    if (r.ok) { setPassword(''); setCode(''); onUnlocked(); }
    else setError(r.error || 'Unlock failed.');
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-bg">
      <div className="scanlines absolute inset-0 pointer-events-none" aria-hidden />
      <div className="glass p-7 w-full max-w-sm text-center relative">
        <div className="w-14 h-14 mx-auto rounded-2xl grid place-items-center mb-3" style={{ background: 'rgba(var(--accent-rgb),0.12)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}>
          <Lock size={24} style={{ color: 'var(--accent)' }} />
        </div>
        <div className="font-bold tracking-[0.18em] text-lg accent-text">DAWN LOCKED</div>
        <p className="text-xs text-dim mt-1 mb-4">Enter your admin password to unlock. Everything stays on this PC.</p>
        <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (totpEnabled ? document.getElementById('lk-code')?.focus() : unlock())} placeholder="Admin password" className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm mb-2 outline-none focus:border-[var(--accent)]" />
        {totpEnabled ? (
          <input id="lk-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} placeholder="2FA code or backup code" inputMode="numeric" className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm mb-2 outline-none focus:border-[var(--accent)]" />
        ) : null}
        {error ? <div className="text-xs text-neural-red mb-2">{error}</div> : null}
        <button onClick={unlock} disabled={busy || !password} className="w-full px-4 py-2.5 rounded-lg border font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-40" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} Unlock
        </button>
      </div>
    </div>
  );
}
