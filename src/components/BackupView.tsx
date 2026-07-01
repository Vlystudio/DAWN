import React, { useEffect, useState } from 'react';
import {
  Archive, Download, ShieldCheck, RotateCcw, FolderOpen, Loader2, AlertTriangle, CheckCircle2, Trash2, FileCheck2, X,
} from 'lucide-react';
import { PageShellPanel } from '../ui/system';

/**
 * Backup / Restore — create a verified .dawnbackup of DAWN's state, verify archives, and
 * restore. Restore is critical: it makes a pre-restore safety snapshot first, requires a typed
 * confirmation + (when Secure mode is on) your password, and an approval. Secrets stay
 * encrypted; nothing leaves your PC.
 */
function fmt(n: number) { if (!n) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0, v = n; while (v >= 1024 && i < 3) { v /= 1024; i++; } return `${v.toFixed(v < 10 && i ? 1 : 0)} ${u[i]}`; }

export default function BackupView() {
  const [opts, setOpts] = useState({ emailCache: false, attachments: false, auditLogs: false });
  const [estimate, setEstimate] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [verify, setVerify] = useState<any>(null);
  const [restore, setRestore] = useState<any>(null);
  const [authOn, setAuthOn] = useState(false);

  const load = () => { window.dawn.backup.history().then(setHistory); window.dawn.auth.status().then((s: any) => setAuthOn(!!s.authEnabled)); };
  useEffect(() => { load(); window.dawn.backup.estimateSize(opts).then(setEstimate); }, []);
  useEffect(() => { window.dawn.backup.estimateSize(opts).then(setEstimate); }, [opts]);
  useEffect(() => window.dawn.backup.onRestored?.(() => { setMsg('Restore complete — reloading…'); setTimeout(() => location.reload(), 1200); }), []);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 5000); };

  async function create(choose: boolean) {
    setBusy('create');
    const destination = choose ? await window.dawn.backup.chooseDestination() : undefined;
    if (choose && !destination) { setBusy(''); return; }
    const r = await window.dawn.backup.create({ ...opts, destination });
    setBusy('');
    if (!r.ok) { flash(r.error); return; }
    flash(`Backup created (${fmt(r.sizeBytes)}).`); load();
  }
  async function pickAndVerify() {
    const p = await window.dawn.backup.chooseArchive(); if (!p) return;
    setBusy('verify'); const r = await window.dawn.backup.verify(p); setBusy('');
    setVerify({ ...r, path: p });
  }
  async function startRestore(p: string) {
    const r = await window.dawn.backup.verify(p);
    setRestore({ path: p, verify: r, confirmText: '', password: '' });
  }
  async function doRestore() {
    if (restore.confirmText !== 'RESTORE') { flash('Type RESTORE to confirm.'); return; }
    setBusy('restore');
    const r = await window.dawn.backup.restore(restore.path, restore.password);
    setBusy('');
    if (!r.ok) { flash(r.error); return; }
    setRestore(null); flash('Restore approved — applying… DAWN will reload.');
  }

  return (
    <PageShellPanel
      width="max-w-2xl"
      icon={<Archive size={22} />}
      title="Backup & Restore"
      subtitle={<>Snapshot DAWN's state to a local <code>.dawnbackup</code> file. Vault secrets are included only in encrypted form. Restores always create a recoverable safety snapshot first.</>}
    >
        {msg ? <div className="text-xs text-neural-cyan mb-3">{msg}</div> : null}

        <div className="glass p-4 mb-4">
          <div className="font-semibold text-sm mb-2 flex items-center gap-1.5"><Download size={15} /> Create backup</div>
          <div className="space-y-1 mb-3">
            <Toggle label="Include cached email messages" desc="Synced message bodies + attachment metadata." value={opts.emailCache} onChange={(v: boolean) => setOpts({ ...opts, emailCache: v })} />
            <Toggle label="Include downloaded attachments" desc="Files DAWN saved from email." value={opts.attachments} onChange={(v: boolean) => setOpts({ ...opts, attachments: v })} />
            <Toggle label="Include audit logs" desc="Tool / security / auth / email audit history." value={opts.auditLogs} onChange={(v: boolean) => setOpts({ ...opts, auditLogs: v })} />
          </div>
          <div className="text-[11px] text-faint mb-2">Estimated size: ~{fmt(estimate)} · always includes the encrypted vault, settings, documents, notes, tasks, calendar, research, models, skills, brain.</div>
          <div className="flex gap-2">
            <button onClick={() => create(false)} disabled={!!busy} className="text-sm px-3.5 py-1.5 rounded-lg border font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>{busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Create backup</button>
            <button onClick={() => create(true)} disabled={!!busy} className="text-sm px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink">Save to…</button>
            <button onClick={() => window.dawn.backup.openFolder()} className="text-sm px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5"><FolderOpen size={14} /> Folder</button>
          </div>
        </div>

        <div className="glass p-4 mb-4">
          <div className="font-semibold text-sm mb-2 flex items-center gap-1.5"><ShieldCheck size={15} /> Verify / Restore</div>
          <div className="flex gap-2">
            <button onClick={pickAndVerify} disabled={!!busy} className="text-sm px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5">{busy === 'verify' ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />} Verify a backup…</button>
            <button onClick={async () => { const p = await window.dawn.backup.chooseArchive(); if (p) startRestore(p); }} className="text-sm px-3 py-1.5 rounded-lg border border-neural-red/50 text-neural-red inline-flex items-center gap-1.5"><RotateCcw size={14} /> Restore from a backup…</button>
          </div>
          {verify ? <VerifyResult v={verify} onRestore={() => { startRestore(verify.path); setVerify(null); }} /> : null}
        </div>

        <div className="glass p-4">
          <div className="font-semibold text-sm mb-2">History</div>
          <div className="space-y-1.5">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${h.kind === 'safety_snapshot' ? 'bg-neural-violet/20 text-neural-violet' : h.kind === 'restore' ? 'bg-neural-amber/20 text-neural-amber' : 'bg-neural-cyan/20 text-neural-cyan'}`}>{h.kind === 'safety_snapshot' ? 'safety' : h.kind}</span>
                <span className="flex-1 truncate text-dim" title={h.path}>{h.path.split(/[\\/]/).pop()}</span>
                <span className={h.exists ? 'text-faint' : 'text-neural-red'}>{h.exists ? fmt(h.size_bytes) : 'missing'}</span>
                <span className="text-faint">{new Date(h.created_at).toLocaleString()}</span>
                {h.kind === 'safety_snapshot' && h.exists ? <button onClick={() => window.dawn.backup.deleteSafetySnapshot(h.id).then(load)} className="text-faint hover:text-neural-red"><Trash2 size={12} /></button> : null}
              </div>
            ))}
            {!history.length ? <div className="text-[11px] text-faint">No backups yet.</div> : null}
          </div>
        </div>

      {restore ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setRestore(null)}>
          <div className="glass p-5 w-full max-w-md border border-neural-red/50" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2"><div className="font-semibold flex items-center gap-1.5 text-neural-red"><AlertTriangle size={16} /> Restore DAWN</div><button onClick={() => setRestore(null)} className="text-faint hover:text-ink"><X size={16} /></button></div>
            <p className="text-xs text-dim mb-2">This replaces your current DAWN state with the backup. A <b>pre-restore safety snapshot</b> is created first, so you can recover. DAWN will reload afterward.</p>
            {restore.verify ? <VerifyResult v={restore.verify} compact /> : null}
            {restore.verify?.level === 'invalid' ? <div className="text-xs text-neural-red mt-2">This archive failed verification and cannot be restored.</div> : (
              <>
                <div className="text-[11px] text-faint mt-3 mb-1">Type <b className="text-neural-red">RESTORE</b> to confirm</div>
                <input value={restore.confirmText} onChange={(e) => setRestore({ ...restore, confirmText: e.target.value })} className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm mb-2 outline-none" />
                {authOn ? <input type="password" value={restore.password} onChange={(e) => setRestore({ ...restore, password: e.target.value })} placeholder="Admin password" className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm mb-2 outline-none" /> : null}
                <p className="text-[11px] text-neural-amber mb-3">You'll also be asked to approve this critical action.</p>
                <button onClick={doRestore} disabled={busy === 'restore' || restore.confirmText !== 'RESTORE'} className="w-full px-4 py-2 rounded-lg border border-neural-red/60 text-neural-red font-semibold text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-40">{busy === 'restore' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Restore now</button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </PageShellPanel>
  );
}

function VerifyResult({ v, onRestore, compact }: any) {
  const color = v.level === 'valid' ? 'text-neural-green' : v.level === 'warnings' ? 'text-neural-amber' : 'text-neural-red';
  const Icon = v.level === 'invalid' ? AlertTriangle : CheckCircle2;
  return (
    <div className={`${compact ? '' : 'mt-3'} border border-border/60 rounded-lg p-3 text-xs`}>
      <div className={`flex items-center gap-1.5 font-semibold ${color}`}><Icon size={14} /> {v.level === 'valid' ? 'Valid' : v.level === 'warnings' ? 'Valid (with warnings)' : 'Invalid'}</div>
      {v.manifest ? <div className="text-faint mt-1">DAWN {v.manifest.appVersion || '?'} · {new Date(v.manifest.createdAt).toLocaleString()} · {(v.manifest.includedSections || []).length} sections · {fmt(v.manifest.totalSizeBytes)} · vault {v.manifest.encryptedVaultIncluded ? 'encrypted ✓' : 'no'}</div> : null}
      {v.issues?.length ? <ul className="text-neural-red mt-1">{v.issues.map((i: string, k: number) => <li key={k}>• {i}</li>)}</ul> : null}
      {v.warnings?.length ? <ul className="text-neural-amber mt-1">{v.warnings.map((w: string, k: number) => <li key={k}>• {w}</li>)}</ul> : null}
      {onRestore && v.level !== 'invalid' ? <button onClick={onRestore} className="mt-2 text-[11px] px-2.5 py-1 rounded-lg border border-neural-red/50 text-neural-red inline-flex items-center gap-1"><RotateCcw size={12} /> Restore this</button> : null}
    </div>
  );
}
function Toggle({ label, desc, value, onChange }: any) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="pr-4"><div className="text-sm">{label}</div>{desc ? <div className="text-[11px] text-faint mt-0.5">{desc}</div> : null}</div>
      <button onClick={() => onChange(!value)} className={`w-10 h-5 rounded-full relative shrink-0 transition ${value ? 'bg-neural-cyan/40' : 'bg-panel2'}`}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${value ? 'left-5' : 'left-0.5'}`} /></button>
    </div>
  );
}
