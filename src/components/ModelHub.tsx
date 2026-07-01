import React, { useEffect, useState } from 'react';
import { Download, Pause, Play, X, Cpu, HardDrive, Zap, CheckCircle2, ExternalLink, Power } from 'lucide-react';
import { Button } from '../ui/button';
import { PageShellPanel } from '../ui/system';
import { useRuntimeStore } from '../state/runtimeStore';

function fmt(n: number) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 2 ? 1 : 0)} ${u[i]}`;
}

const ROLES = [
  { key: 'fast', label: 'Fast chat' },
  { key: 'coding', label: 'Coding' },
  { key: 'reasoning', label: 'Reasoning' },
  { key: 'embedding', label: 'Embedding' },
  { key: 'vision', label: 'Vision' },
];

/**
 * Model Hub — discover, download (resumable), organize, and route open-weight
 * GGUF models. DAWN downloads them for you; you never handle files manually.
 */
export default function ModelHub() {
  const [catalog, setCatalog] = useState<any[]>([]);
  const [hw, setHw] = useState<any>(null);
  const [installed, setInstalled] = useState<any[]>([]);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [roles, setRoles] = useState<any>({});
  const [nicks, setNicks] = useState<Record<string, string>>({});
  const refreshRuntime = useRuntimeStore((s) => s.refresh);

  const reloadInstalled = () => window.dawn.models.list().then(setInstalled);
  useEffect(() => {
    window.dawn.hub.catalog().then((c: any[]) => {
      setCatalog(c);
      // DAWN nicknames for each catalog file (preserves the real name; adds a function label).
      const files = c.flatMap((m) => (m.files || []).map((f: any) => f.url.split('/').pop()));
      window.dawn.optimizer?.names?.(files).then((map: any) => setNicks(map || {})).catch(() => {});
    });
    window.dawn.hub.hardware().then(setHw);
    window.dawn.hub.roles().then(setRoles);
    window.dawn.hub.downloads().then(setDownloads);
    reloadInstalled();
    const off = window.dawn.hub.onProgress((list: any) => {
      setDownloads(list);
      if (list.some((d: any) => d.status === 'done')) reloadInstalled();
    });
    return off;
  }, []);

  const vram = hw?.gpus?.[0]?.vramGB || 0;
  const ramGB = hw?.ramGB || 0;
  const isInstalled = (filename: string) => installed.some((m) => m.name === filename);

  // True health label for a candidate file (4 states) — matches the Optimizer's model.
  function health(f: any): { label: string; cls: string } {
    const weightsGB = (f.approxBytes || 0) / 1024 ** 3;
    if (vram > 0 && f.minVramGB <= vram) return { label: 'fits fully on GPU', cls: 'text-neural-green' };
    if (vram > 0 && weightsGB <= vram + 2) return { label: 'partial GPU offload', cls: 'text-neural-amber' };
    if (ramGB === 0 || weightsGB <= ramGB) return { label: 'CPU only / slow', cls: 'text-neural-violet' };
    return { label: 'not recommended', cls: 'text-neural-red' };
  }

  function install(model: any, file: any) {
    window.dawn.hub.download({ modelId: model.id, family: model.family, filename: file.url.split('/').pop(), url: file.url });
  }

  // One-button: auto-pick the best quant — the largest that fits the GPU (quality),
  // else the smallest (so it still installs).
  function bestFile(m: any) {
    if (!m.files?.length) return null;
    const fit = m.files.filter((f: any) => vram === 0 || f.minVramGB <= vram + 1);
    if (fit.length) return [...fit].sort((a, b) => b.approxBytes - a.approxBytes)[0];
    return [...m.files].sort((a, b) => a.approxBytes - b.approxBytes)[0];
  }

  async function setRole(role: string, path: string) {
    setRoles(await window.dawn.hub.setRole(role, path));
  }
  async function useNow(path: string) {
    await window.dawn.hub.switchTo(path);
    refreshRuntime();
  }

  const families = [...new Set(catalog.map((m) => m.family))];

  return (
    <PageShellPanel width="max-w-4xl" icon={<Download size={22} />} title="Model Hub" subtitle="Browse free / open-weight models and let DAWN download them locally. Nothing is pulled until you choose.">
      {/* Hardware */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <HwCard icon={<Zap size={16} />} label="GPU" value={hw ? (hw.gpus[0]?.name || 'No CUDA GPU') : '…'} sub={vram ? `${vram} GB VRAM · ${hw.cuda ? 'CUDA' : 'CPU'}` : ''} />
        <HwCard icon={<Cpu size={16} />} label="RAM" value={hw ? `${hw.ramGB} GB` : '…'} />
        <HwCard icon={<HardDrive size={16} />} label="Free disk" value={hw ? `${hw.diskFreeGB} GB` : '…'} />
      </div>

      {/* Active downloads */}
      {downloads.length > 0 ? (
        <div className="glass p-4 mb-5">
          <div className="text-sm font-semibold mb-2">Downloads</div>
          <div className="space-y-2">
            {downloads.map((d) => {
              const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
              return (
                <div key={d.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="truncate">{d.filename}</span>
                    <span className="text-faint flex items-center gap-2">
                      {fmt(d.received)} / {fmt(d.total)} · {d.status}
                      {d.status === 'downloading' ? <button onClick={() => window.dawn.hub.pause(d.id)}><Pause size={13} /></button> : null}
                      {d.status === 'paused' || d.status === 'error' ? <button onClick={() => window.dawn.hub.resume(d.id)}><Play size={13} /></button> : null}
                      {d.status !== 'done' ? <button onClick={() => window.dawn.hub.cancel(d.id)}><X size={13} /></button> : null}
                    </span>
                  </div>
                  <div className="h-1.5 bg-panel2 rounded-full overflow-hidden"><div className="h-full bg-neural-cyan transition-all" style={{ width: `${pct}%` }} /></div>
                  {d.error ? <div className="text-[11px] text-neural-red mt-0.5">{d.error}</div> : null}
                  {d.status === 'done' && d.sha256 ? <div className="text-[10px] text-neural-green mt-0.5 font-mono">{d.verified ? '✓ verified' : 'installed'} · sha256 {d.sha256.slice(0, 16)}…</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Catalog */}
      {families.map((fam) => (
        <div key={fam} className="mb-5">
          <div className="text-xs uppercase tracking-wide text-faint mb-2">{fam}</div>
          <div className="space-y-2">
            {catalog.filter((m) => m.family === fam).map((m) => (
              <div key={m.id} className="glass p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                      {m.name} <span className="text-faint font-normal">· {m.params}</span>
                      {(() => { const f = bestFile(m); const nick = f && nicks[f.url.split('/').pop()]; return nick ? <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-neural-cyan/40 text-neural-cyan">{nick}</span> : null; })()}
                    </div>
                    <div className="text-xs text-dim mt-0.5">{m.description}</div>
                    <div className="text-[11px] text-faint mt-1">License: {m.license} · roles: {m.roles.join(', ')}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  {(() => {
                    const f = bestFile(m);
                    if (!f) return <span className="text-xs text-faint">No downloadable file.</span>;
                    const filename = f.url.split('/').pop();
                    const done = isInstalled(filename);
                    const fits = vram === 0 || f.minVramGB <= vram + 1;
                    if (done) return <span className="text-sm px-3 py-1.5 rounded-lg border border-neural-green/50 text-neural-green inline-flex items-center gap-1"><CheckCircle2 size={14} /> Installed</span>;
                    return (
                      <>
                        <button onClick={() => install(m, f)} className="text-sm px-4 py-2 rounded-lg border border-neural-cyan/60 text-neural-cyan inline-flex items-center gap-1.5 hover:bg-neural-cyan/10 font-semibold">
                          <Download size={14} /> Install
                        </button>
                        <span className="text-xs text-faint">{f.quant} · {fmt(f.approxBytes)}</span>
                        {(() => { const h = health(f); return <span className={`text-[11px] ${h.cls}`}>{h.label}</span>; })()}
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Routing */}
      {installed.length > 0 ? (
        <div className="glass p-4 mb-4">
          <div className="text-sm font-semibold mb-1">Task routing</div>
          <p className="text-xs text-faint mb-3">Assign installed models to roles. "Use now" loads it into the runtime (restarts to switch).</p>
          {ROLES.map((r) => (
            <div key={r.key} className="flex items-center gap-2 py-1.5">
              <span className="text-sm w-28">{r.label}</span>
              <select value={roles[r.key] || ''} onChange={(e) => setRole(r.key, e.target.value)} className="flex-1 bg-bg border border-border rounded-lg px-2 py-1.5 text-xs">
                <option value="">— none —</option>
                {installed.map((m) => <option key={m.path} value={m.path}>{m.name}</option>)}
              </select>
              {roles[r.key] ? (
                <Button size="sm" variant="ghost" onClick={() => useNow(roles[r.key])}><Power size={13} /> Use now</Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </PageShellPanel>
  );
}

function HwCard({ icon, label, value, sub }: any) {
  return (
    <div className="glass p-3">
      <div className="text-xs text-faint flex items-center gap-1.5">{icon} {label}</div>
      <div className="text-sm font-semibold mt-1 truncate">{value}</div>
      {sub ? <div className="text-[11px] text-faint">{sub}</div> : null}
    </div>
  );
}
