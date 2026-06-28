import React, { useEffect, useState } from 'react';
import { Download, Pause, Play, X, Cpu, HardDrive, Zap, CheckCircle2, ExternalLink, Power } from 'lucide-react';
import { Button } from '../ui/button';
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
  const refreshRuntime = useRuntimeStore((s) => s.refresh);

  const reloadInstalled = () => window.dawn.models.list().then(setInstalled);
  useEffect(() => {
    window.dawn.hub.catalog().then(setCatalog);
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
  const isInstalled = (filename: string) => installed.some((m) => m.name === filename);

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
    <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <h1 className="text-xl font-bold">Model Hub</h1>
      <p className="text-sm text-dim mb-4">Browse free / open-weight models and let DAWN download them locally. Nothing is pulled until you choose.</p>

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
                    <div className="text-sm font-semibold">{m.name} <span className="text-faint font-normal">· {m.params}</span></div>
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
                        <span className={`text-[11px] ${fits ? 'text-neural-green' : 'text-neural-amber'}`}>{fits ? 'fits your GPU' : `partial offload (~${f.minVramGB}GB)`}</span>
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
    </div>
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
