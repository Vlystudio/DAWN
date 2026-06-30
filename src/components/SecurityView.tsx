import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Shield, Lock, KeyRound, Smartphone, Trash2, Plus, Eye, Copy, AlertTriangle, Check, RefreshCw, Wifi, Vault as VaultIcon, ScrollText,
} from 'lucide-react';

/**
 * Security — admin password, app lock, TOTP 2FA + backup codes, LAN-mode status, the
 * encrypted Vault, and the security audit. Default Local Desktop mode stays simple; Secure
 * mode adds a lock. Secrets are never shown by default and never leave this PC.
 */
export default function SecurityView() {
  const [st, setSt] = useState<any>(null);
  const [vault, setVault] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [lan, setLan] = useState<any>(null);
  const [msg, setMsg] = useState('');

  const load = () => {
    window.dawn.auth.status().then(setSt);
    window.dawn.auth.lanStatus().then(setLan);
    window.dawn.auth.audit(40).then(setAudit);
    window.dawn.secrets.list().then(setVault).catch(() => setVault([]));
  };
  useEffect(() => { load(); }, []);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };

  if (!st) return <div className="p-6 text-sm text-faint">Loading…</div>;
  const mode = st.lanModeEnabled ? 'LAN mode' : st.authEnabled ? 'Secure Local mode' : 'Local Desktop mode';

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-1"><Shield size={18} style={{ color: 'var(--accent)' }} /><h1 className="text-xl font-bold">Security</h1></div>
        <p className="text-sm text-dim mb-4">DAWN is local-first. By default no login is required. Turn on Secure mode to lock the app with a password and optional 2FA. Nothing is sent anywhere.</p>
        {msg ? <div className="text-xs text-neural-cyan mb-3">{msg}</div> : null}

        <Card title="Security mode" icon={<Shield size={15} />}>
          <div className="text-sm">Current: <b className="accent-text">{mode}</b></div>
          <div className="text-xs text-faint mt-1">{st.hasPassword ? 'Admin password is set.' : 'No admin password yet.'} {st.totpEnabled ? '2FA on.' : ''} {st.osSecureStore ? 'Vault keys protected by the OS keychain.' : ''}</div>
          {st.authEnabled ? <button onClick={() => window.dawn.auth.lock().then(load)} className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5"><Lock size={13} /> Lock now</button> : null}
        </Card>

        <PasswordCard st={st} onChange={(m: string) => { flash(m); load(); }} />

        {st.hasPassword ? (
          <Card title="Authentication" icon={<KeyRound size={15} />}>
            <Toggle label="Require unlock (Secure mode)" desc="Lock DAWN with your admin password. Local desktop use stays available; this adds a lock screen." value={st.authEnabled}
              onChange={async (v: boolean) => { const pw = st.authEnabled ? prompt('Confirm admin password to change this:') || '' : ''; const r = await window.dawn.auth.setSecuritySetting('authEnabled', v, pw); if (!r.ok) flash(r.error); load(); }} />
            <label className="flex items-center justify-between py-2 text-sm">
              <span>Session timeout</span>
              <select value={st.sessionExpiresAt ? '' : ''} onChange={async (e) => { await window.dawn.auth.setSecuritySetting('sessionTimeoutMinutes', Number(e.target.value), prompt('Confirm password:') || ''); load(); }} className="bg-bg border border-border rounded px-2 py-1 text-xs" defaultValue="">
                <option value="" disabled>change…</option>{[5, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
          </Card>
        ) : null}

        {st.hasPassword ? <TotpCard st={st} onChange={(m: string) => { flash(m); load(); }} /> : null}

        <Card title="LAN mode" icon={<Wifi size={15} />}>
          <div className="text-xs text-dim mb-2">{lan?.note}</div>
          <div className="text-[11px] text-faint">Bind: <span className="font-mono">{lan?.bind}</span> · server: <span className="text-neural-amber">not implemented yet</span></div>
          {lan && !lan.prerequisites.allowed ? <div className="text-[11px] text-neural-amber mt-1">Prerequisites: {lan.prerequisites.reasons.join(' ')}</div> : null}
          {lan?.prerequisites.warnings?.length ? <div className="text-[11px] text-neural-amber mt-1">{lan.prerequisites.warnings.join(' ')}</div> : null}
          <Toggle label="Enable LAN mode (intent)" desc="Records intent + enforces security prerequisites. DAWN is not exposed on the network until the LAN server ships." value={st.lanModeEnabled}
            onChange={async (v: boolean) => { const r = await window.dawn.auth.setSecuritySetting('lanModeEnabled', v, st.authEnabled ? (prompt('Confirm password:') || '') : ''); if (!r.ok) flash(r.error); load(); }} />
        </Card>

        <VaultCard items={vault} authEnabled={st.authEnabled} reqPw={true} onChange={() => { load(); }} flash={flash} />

        <Card title="Security activity" icon={<ScrollText size={15} />}>
          <div className="space-y-0.5 max-h-56 overflow-y-auto text-[11px]">
            {audit.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className={a.success ? 'text-neural-green' : 'text-neural-red'}>●</span>
                <span className="text-dim">{a.event.replace(/_/g, ' ')}</span>
                {a.detail ? <span className="text-faint truncate">{a.detail}</span> : null}
                <span className="text-faint ml-auto">{new Date(a.ts).toLocaleString()}</span>
              </div>
            ))}
            {!audit.length ? <div className="text-faint">No security events yet.</div> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function PasswordCard({ st, onChange }: any) {
  const [pw, setPw] = useState(''); const [cur, setCur] = useState(''); const [strength, setStrength] = useState<any>(null);
  async function save() {
    if (st.hasPassword) { const r = await window.dawn.auth.changePassword(cur, pw); onChange(r.ok ? 'Password changed.' : r.error); }
    else { const r = await window.dawn.auth.setPassword(pw); onChange(r.ok ? 'Admin password set.' : r.error); }
    setPw(''); setCur('');
  }
  return (
    <Card title="Admin password" icon={<KeyRound size={15} />}>
      {!st.hasPassword ? <p className="text-xs text-neural-amber mb-2 flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5" /> If you lose this password, encrypted vault contents protected by it cannot be recovered. Keep it safe.</p> : null}
      {st.hasPassword ? <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm mb-2 outline-none" /> : null}
      <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setStrength(strengthOf(e.target.value)); }} placeholder={st.hasPassword ? 'New password (12+ chars)' : 'Set admin password (12+ chars)'} className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm mb-1 outline-none" />
      {strength ? <div className={`text-[11px] mb-2 ${strength.ok ? 'text-neural-green' : 'text-neural-amber'}`}>{strength.ok ? (strength.strong ? 'Strong' : 'OK') : strength.warning}</div> : null}
      <button onClick={save} disabled={!pw} className="text-xs px-3 py-1.5 rounded-lg border font-semibold disabled:opacity-40" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}>{st.hasPassword ? 'Change password' : 'Set password'}</button>
    </Card>
  );
}

function TotpCard({ st, onChange }: any) {
  const [setup, setSetup] = useState<any>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  async function start() { const r = await window.dawn.auth.setupTotp(); if (r.ok) setSetup(r); else onChange(r.error); }
  async function confirm() { const r = await window.dawn.auth.confirmTotp(code); if (r.ok) { setCodes(r.backupCodes); setSetup(null); setCode(''); onChange('2FA enabled.'); } else onChange(r.error); }
  async function disable() { const r = await window.dawn.auth.disableTotp(prompt('Confirm password:') || ''); onChange(r.ok ? '2FA disabled.' : r.error); }
  async function regen() { const r = await window.dawn.auth.regenerateBackupCodes(prompt('Confirm password:') || ''); if (r.ok) setCodes(r.backupCodes); else onChange(r.error); }
  return (
    <Card title="Two-factor authentication (TOTP)" icon={<Smartphone size={15} />}>
      {!st.totpEnabled && !setup ? <button onClick={start} className="text-xs px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink">Set up 2FA</button> : null}
      {setup ? (
        <div>
          <p className="text-xs text-dim mb-2">Scan with an authenticator app (Google Authenticator, Aegis, 1Password…), then enter a code to confirm.</p>
          <div className="bg-white inline-block p-2 rounded-lg mb-2"><QRCodeSVG value={setup.uri} size={140} /></div>
          <div className="text-[11px] text-faint font-mono break-all mb-2">{setup.secret}</div>
          <div className="flex gap-2"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm w-32 outline-none" /><button onClick={confirm} className="text-xs px-3 py-1.5 rounded-lg border font-semibold" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)' }}>Confirm</button></div>
        </div>
      ) : null}
      {st.totpEnabled ? <div className="flex gap-2"><button onClick={regen} className="text-xs px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1"><RefreshCw size={12} /> Regenerate backup codes</button><button onClick={disable} className="text-xs px-3 py-1.5 rounded-lg border border-neural-red/50 text-neural-red">Disable 2FA</button></div> : null}
      {codes ? (
        <div className="mt-3 border border-neural-amber/40 bg-neural-amber/10 rounded-lg p-3">
          <div className="text-xs font-semibold text-neural-amber mb-1">Backup codes — saved once. Store them safely; each works one time.</div>
          <div className="grid grid-cols-2 gap-1 font-mono text-xs">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <button onClick={() => { navigator.clipboard.writeText(codes.join('\n')); }} className="mt-2 text-[11px] text-faint hover:text-ink inline-flex items-center gap-1"><Copy size={11} /> Copy</button>
          <button onClick={() => setCodes(null)} className="ml-3 mt-2 text-[11px] text-faint hover:text-ink">I've saved them</button>
        </div>
      ) : null}
    </Card>
  );
}

function VaultCard({ items, authEnabled, onChange, flash }: any) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: '', kind: 'api_key', username: '', secret: '', tags: '' });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const KINDS = ['api_key', 'password', 'email_credential', 'provider_token', 'custom'];

  async function create() {
    if (!form.label || !form.secret) return;
    await window.dawn.secrets.create(form);
    setForm({ label: '', kind: 'api_key', username: '', secret: '', tags: '' }); setCreating(false); onChange();
  }
  async function reveal(id: string) {
    const pw = authEnabled ? (prompt('Confirm password to reveal:') || '') : '';
    const r = await window.dawn.secrets.reveal(id, pw);
    if (!r.ok) { flash(r.error); return; }
    setRevealed((s) => ({ ...s, [id]: r.secret }));
    setTimeout(() => setRevealed((s) => { const n = { ...s }; delete n[id]; return n; }), 20000); // auto-hide
  }
  async function copy(id: string) {
    const pw = authEnabled ? (prompt('Confirm password to copy:') || '') : '';
    const r = await window.dawn.secrets.reveal(id, pw);
    if (!r.ok) { flash(r.error); return; }
    await navigator.clipboard.writeText(r.secret);
    flash('Copied — clipboard will auto-clear in 30s.');
    setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}); }, 30000);
  }
  async function del(id: string) { if (confirm('Delete this secret permanently?')) { await window.dawn.secrets.delete(id); onChange(); } }

  return (
    <Card title="Vault (encrypted secrets)" icon={<VaultIcon size={15} />}>
      <p className="text-[11px] text-faint mb-2">Secrets are encrypted (AES-256-GCM) and stored only on this PC. Values are never shown by default and never sent to the model.</p>
      <div className="space-y-1.5 mb-3">
        {items.map((it: any) => (
          <div key={it.id} className="flex items-center gap-2 text-xs border border-border/50 rounded-lg px-2 py-1.5">
            <KeyRound size={12} className="text-faint shrink-0" />
            <span className="flex-1 min-w-0"><span className="text-dim">{it.label}</span><span className="text-faint"> · {it.kind}{it.username ? ` · ${it.username}` : ''}</span></span>
            {revealed[it.id] ? <span className="font-mono text-neural-green truncate max-w-[160px]">{revealed[it.id]}</span> : null}
            <button onClick={() => reveal(it.id)} title="Reveal (auto-hides)" className="text-faint hover:text-neural-cyan"><Eye size={13} /></button>
            <button onClick={() => copy(it.id)} title="Copy (auto-clears)" className="text-faint hover:text-neural-cyan"><Copy size={13} /></button>
            <button onClick={() => del(it.id)} className="text-faint hover:text-neural-red"><Trash2 size={13} /></button>
          </div>
        ))}
        {!items.length ? <div className="text-[11px] text-faint">No secrets stored yet.</div> : null}
      </div>
      {creating ? (
        <div className="border border-border rounded-lg p-2.5 space-y-2">
          <div className="flex gap-2">
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Label (e.g. OpenAI key)" className="flex-1 bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none" />
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="bg-bg border border-border rounded px-2 py-1.5 text-xs">{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
          </div>
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Username (optional)" className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none" />
          <input type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="Secret value" className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none" />
          <div className="flex gap-2"><button onClick={create} disabled={!form.label || !form.secret} className="text-xs px-3 py-1.5 rounded-lg border font-semibold disabled:opacity-40" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)' }}>Save</button><button onClick={() => setCreating(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border text-faint">Cancel</button></div>
        </div>
      ) : <button onClick={() => setCreating(true)} className="text-xs px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1"><Plus size={12} /> Add secret</button>}
    </Card>
  );
}

function Card({ title, icon, children }: any) {
  return (
    <div className="glass p-4 mb-3">
      <div className="font-semibold text-sm mb-2 flex items-center gap-1.5">{icon} {title}</div>
      {children}
    </div>
  );
}
function Toggle({ label, desc, value, onChange }: any) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="pr-4"><div className="text-sm">{label}</div>{desc ? <div className="text-[11px] text-faint mt-0.5">{desc}</div> : null}</div>
      <button onClick={() => onChange(!value)} className={`w-11 h-6 rounded-full relative shrink-0 transition ${value ? 'bg-neural-cyan/40' : 'bg-panel2'}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${value ? 'left-5' : 'left-0.5'}`} /></button>
    </div>
  );
}
function strengthOf(pw: string) {
  let score = 0; const warnings: string[] = [];
  if (pw.length >= 12) score += 2; else if (pw.length >= 8) score += 1; else warnings.push('Use 12+ characters.');
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1; else warnings.push('Mix case.');
  if (/\d/.test(pw)) score += 1; else warnings.push('Add a number.');
  if (/[^A-Za-z0-9]/.test(pw)) score += 1; else warnings.push('Add a symbol.');
  const ok = pw.length >= 8 && score >= 2;
  return { ok, strong: pw.length >= 12 && score >= 4, warning: warnings[0] };
}
