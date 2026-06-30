import React, { useEffect, useMemo, useState } from 'react';
import {
  Cpu, HardDrive, Zap, Gauge, AlertTriangle, CheckCircle2, Sparkles, Settings2,
  Power, RotateCcw, Info, ChevronRight, Layers, Activity,
} from 'lucide-react';
import { useRuntimeStore } from '../state/runtimeStore';

/**
 * Model Optimizer — DAWN understands your hardware, scores every local model, gives it a
 * friendly name, and auto-tunes llama.cpp settings per model. "Select & Load" applies the
 * optimized settings to DAWN's real runtime and hot-swaps the model. The actual GGUF name
 * is always shown alongside the friendly DAWN name.
 */

type Level = 'Excellent' | 'Good' | 'Borderline' | 'CPU-only fallback' | 'Not recommended' | 'Unsupported';

const COMPAT: Record<Level, { cls: string; dot: string }> = {
  'Excellent': { cls: 'border-neural-green/50 text-neural-green bg-neural-green/10', dot: 'bg-neural-green' },
  'Good': { cls: 'border-neural-cyan/50 text-neural-cyan bg-neural-cyan/10', dot: 'bg-neural-cyan' },
  'Borderline': { cls: 'border-neural-amber/50 text-neural-amber bg-neural-amber/10', dot: 'bg-neural-amber' },
  'CPU-only fallback': { cls: 'border-neural-violet/50 text-neural-violet bg-neural-violet/10', dot: 'bg-neural-violet' },
  'Not recommended': { cls: 'border-neural-red/50 text-neural-red bg-neural-red/10', dot: 'bg-neural-red' },
  'Unsupported': { cls: 'border-faint/40 text-faint bg-panel2/40', dot: 'bg-faint' },
};

const MODES = ['Performance', 'Balanced', 'Quality', 'Safe', 'Low VRAM'];
const TASKS = [
  ['code', 'Coding'], ['chat', 'Chat'], ['reasoning', 'Reasoning'], ['research', 'Research'],
  ['summarize', 'Summarize'], ['rag', 'Memory/RAG'], ['vision', 'Vision'], ['cybersecurity', 'Security'], ['low-resource', 'Low-resource'],
];

function Badge({ level }: { level: Level }) {
  const s = COMPAT[level] || COMPAT['Unsupported'];
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {level}
    </span>
  );
}

export default function ModelOptimizer() {
  const [profile, setProfile] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [task, setTask] = useState<string>('');
  const [taskScores, setTaskScores] = useState<Record<string, { score: number; why: string }>>({});
  const [toast, setToast] = useState<string>('');
  const refreshRuntime = useRuntimeStore((s) => s.refresh);

  async function refresh() {
    setLoading(true);
    const r = await window.dawn.optimizer.list();
    setProfile(r.profile);
    setModels(r.models || []);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function pickTask(t: string) {
    if (t === task) { setTask(''); setTaskScores({}); return; }
    setTask(t);
    const r = await window.dawn.optimizer.recommendForTask(t);
    const map: Record<string, { score: number; why: string }> = {};
    (r.ranked || []).forEach((m: any) => { map[m.actualName] = { score: m.taskScore, why: m.taskWhy }; });
    setTaskScores(map);
  }

  const ordered = useMemo(() => {
    if (!task) return models;
    return [...models].sort((a, b) => (taskScores[b.actualName]?.score || 0) - (taskScores[a.actualName]?.score || 0));
  }, [models, task, taskScores]);

  const gpu = profile?.gpus?.[0];
  const detail = models.find((m) => (m.path || m.actualName) === detailId) || null;

  return (
    <div className="p-6 max-w-5xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center gap-2">
        <Sparkles size={18} style={{ color: 'var(--accent)' }} />
        <h1 className="text-xl font-bold">Model Optimizer</h1>
      </div>
      <p className="text-sm text-dim mb-4">DAWN reads your hardware, scores each local model, and auto-tunes its runtime settings. The real model name is always shown — friendly names are just easier to remember.</p>

      {/* Hardware profile */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Hw icon={<Zap size={15} />} label="GPU" value={gpu?.name || (profile ? 'No GPU detected' : '…')} sub={gpu?.vramGB ? `${gpu.vramGB} GB VRAM` : profile ? 'CPU only' : ''} />
        <Hw icon={<Cpu size={15} />} label="CPU" value={profile?.cpuName ? short(profile.cpuName) : (profile ? 'Unknown' : '…')} sub={profile ? `${profile.cpuCores ?? '?'} cores · ${profile.cpuThreads ?? '?'} threads` : ''} />
        <Hw icon={<Activity size={15} />} label="RAM" value={profile ? `${profile.totalRamGB ?? '?'} GB` : '…'} sub={profile ? `~${profile.availableRamGB ?? '?'} GB usable` : ''} />
        <Hw icon={<HardDrive size={15} />} label="Backends" value={profile ? backendList(profile.backends) : '…'} sub={profile ? `${profile.diskFreeGB ?? '?'} GB free disk` : ''} />
      </div>

      {/* Task recommender */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="text-xs text-faint mr-1">Best for:</span>
        {TASKS.map(([key, label]) => (
          <button key={key} onClick={() => pickTask(key)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${task === key ? 'border-neural-cyan/60 text-neural-cyan bg-neural-cyan/10' : 'border-border text-dim hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <div className="text-sm text-faint py-8 text-center">Detecting hardware and analyzing models…</div> : null}
      {!loading && models.length === 0 ? (
        <div className="glass p-6 text-center text-sm text-dim">
          No local models found. Download one in <span className="text-neural-cyan">Model Hub</span>, then come back — DAWN will tune it for your hardware automatically.
        </div>
      ) : null}

      {/* Model cards */}
      <div className="space-y-2.5">
        {ordered.map((m) => {
          const id = m.path || m.actualName;
          const c = m.compatibility; const meta = m.metadata;
          const ts = taskScores[m.actualName];
          return (
            <div key={id} className="glass p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold">{meta.friendlyName}</span>
                    {meta.isMoE ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-faint">MoE</span> : null}
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-border text-dim">{meta.category}</span>
                    <Badge level={c.level} />
                    {!meta.known ? <span className="text-[10px] text-neural-amber inline-flex items-center gap-1"><Info size={11} /> estimated</span> : null}
                    {m.manualOverride ? <span className="text-[10px] text-neural-violet">manual override</span> : null}
                    {m.reoptimizeNeeded ? <span className="text-[10px] text-neural-amber">hardware changed — re-optimize</span> : null}
                  </div>
                  <div className="text-[11px] text-faint mt-0.5 font-mono truncate" title={m.actualName}>{m.actualName}</div>
                  <div className="text-xs text-dim mt-1.5">{meta.purpose}</div>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-faint flex-wrap">
                    <span className="inline-flex items-center gap-1"><Gauge size={12} /> {c.score}/100</span>
                    <span className="inline-flex items-center gap-1"><Zap size={12} /> {c.expectedSpeed}</span>
                    <span className="inline-flex items-center gap-1"><Layers size={12} /> ~{meta.estComfortVramGB} GB VRAM · ~{meta.estRamGB} GB RAM</span>
                    <span>recommends <b className="text-dim">{c.recommendedMode}</b></span>
                    {ts ? <span className="text-neural-cyan">task fit {ts.score}/100</span> : null}
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {m.path === currentModelPath() ? (
                    <span className="text-[11px] text-neural-green inline-flex items-center gap-1"><CheckCircle2 size={13} /> loaded</span>
                  ) : null}
                </div>
              </div>

              {c.warnings?.length ? (
                <div className="mt-2 text-[11px] text-neural-amber flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>{c.warnings[0]}</span>
                </div>
              ) : null}

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button onClick={() => selectAndLoad(m, refresh, refreshRuntime, setToast)}
                  disabled={c.level === 'Unsupported'}
                  className="text-sm px-3.5 py-1.5 rounded-lg border font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.10)' }}>
                  <Power size={14} /> Select &amp; Load
                </button>
                <button onClick={() => optimizeOnly(m, refresh, setToast)}
                  disabled={c.level === 'Unsupported'}
                  className="text-sm px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5 disabled:opacity-40">
                  <Sparkles size={14} /> Optimize
                </button>
                <button onClick={() => setDetailId(detailId === id ? null : id)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5">
                  <ChevronRight size={14} className={detailId === id ? 'rotate-90 transition-transform' : 'transition-transform'} /> Details &amp; Advanced
                </button>
              </div>

              {detailId === id ? <Detail m={m} onChanged={refresh} onToast={setToast} refreshRuntime={refreshRuntime} /> : null}
            </div>
          );
        })}
      </div>

      {toast ? (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg glass text-sm border border-border shadow-lg">{toast}</div>
      ) : null}
    </div>
  );
}

// --- detail / advanced panel ----------------------------------------------
function Detail({ m, onChanged, onToast, refreshRuntime }: any) {
  const id = m.path || m.actualName;
  const [mode, setMode] = useState<string>(m.savedMode || m.compatibility.recommendedMode);
  const [opt, setOpt] = useState<any>(m.optimization);
  const [draft, setDraft] = useState<any>(null); // advanced override draft
  const [busy, setBusy] = useState(false);

  useEffect(() => { setOpt(m.optimization); }, [m]);

  async function changeMode(newMode: string) {
    setMode(newMode);
    setDraft(null);
    const a = await window.dawn.optimizer.analyze(id, newMode);
    setOpt(a.optimization);
  }

  async function apply(load: boolean) {
    setBusy(true);
    const opts: any = { mode, load };
    if (draft) opts.customSettings = draft;
    const r = await window.dawn.optimizer.apply(id, opts);
    setBusy(false);
    if (!r.ok && r.blocked) { onToast(r.reason); return; }
    onToast(load ? `Loaded ${m.metadata.friendlyName} (${mode})` : `Optimized ${m.metadata.friendlyName} (${mode})`);
    if (load) refreshRuntime();
    onChanged();
  }

  async function reset() {
    setBusy(true);
    await window.dawn.optimizer.resetToRecommended(id);
    setBusy(false);
    setDraft(null);
    onToast(`Reset ${m.metadata.friendlyName} to DAWN's recommendation`);
    onChanged();
  }

  const s = draft || opt.settings;
  const meta = m.metadata; const c = m.compatibility;
  const fields: [string, string, number, number, number][] = [
    ['contextLength', 'Context length', 512, 131072, 512],
    ['gpuLayers', 'GPU layers (999 = all)', 0, 999, 1],
    ['threads', 'CPU threads', 1, 64, 1],
    ['batchSize', 'Batch size', 16, 4096, 16],
    ['ubatchSize', 'Micro-batch (ubatch, 0=auto)', 0, 4096, 16],
    ['maxTokens', 'Max output tokens', 16, 32768, 16],
  ];
  const floats: [string, string, number, number, number][] = [
    ['temperature', 'Temperature', 0, 2, 0.05],
    ['topP', 'Top-p', 0, 1, 0.05],
    ['topK', 'Top-k', 0, 200, 1],
    ['repeatPenalty', 'Repeat penalty', 0.8, 2, 0.05],
  ];

  return (
    <div className="mt-3 pt-3 border-t border-border/60 space-y-4">
      {/* full metadata */}
      <div className="grid md:grid-cols-2 gap-3 text-xs">
        <Info2 label="Strengths" items={meta.strengths} />
        <Info2 label="Watch out for" items={meta.weaknesses} />
        <Info2 label="Best for" items={meta.bestFor} />
        <div>
          <div className="text-faint mb-1">Details</div>
          <div className="text-dim space-y-0.5">
            <div>Family: <span className="font-mono">{meta.family}</span> · {meta.paramsB ? `${meta.paramsB}B` : 'size unknown'}{meta.isMoE && meta.activeB ? ` (A${meta.activeB}B active)` : ''} · {meta.quant}</div>
            <div>Backend: {meta.recommendedBackend} · context {meta.recommendedContext.toLocaleString()}</div>
            <div>Est. VRAM min ~{meta.estMinVramGB} GB · comfortable ~{meta.estComfortVramGB} GB · RAM ~{meta.estRamGB} GB</div>
            {meta.tags?.length ? <div className="flex gap-1 flex-wrap pt-0.5">{meta.tags.map((t: string) => <span key={t} className="px-1.5 py-0.5 rounded border border-border text-faint">{t}</span>)}</div> : null}
          </div>
        </div>
      </div>

      {/* compatibility explanation */}
      <div className="rounded-lg border border-border/60 bg-panel/30 p-3 text-xs text-dim">
        <div className="flex items-center gap-2 mb-1"><Badge level={c.level} /> <span className="text-faint">{c.score}/100 · {c.expectedSpeed}</span></div>
        {c.reason}
        {c.warnings?.length ? <ul className="mt-1.5 space-y-0.5">{c.warnings.map((w: string, i: number) => <li key={i} className="text-neural-amber flex items-start gap-1.5"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{w}</li>)}</ul> : null}
      </div>

      {/* mode picker */}
      <div>
        <div className="text-xs text-faint mb-1.5">Optimizer preset</div>
        <div className="flex gap-1.5 flex-wrap">
          {MODES.map((md) => (
            <button key={md} onClick={() => changeMode(md)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${mode === md ? 'border-neural-cyan/60 text-neural-cyan bg-neural-cyan/10' : 'border-border text-dim hover:text-ink'}`}>
              {md}{md === c.recommendedMode ? ' ★' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* explanation panel: what changed + tradeoffs + unsupported */}
      <div className="rounded-lg border border-border/60 bg-panel/20 p-3">
        <div className="text-xs text-dim">{opt.explanation}</div>
        <div className="grid md:grid-cols-2 gap-3 mt-2.5">
          <div>
            <div className="text-[11px] text-faint mb-1">Settings applied</div>
            <ul className="text-[11px] text-dim space-y-0.5">{opt.changed.map((x: string, i: number) => <li key={i} className="font-mono">{x}</li>)}</ul>
          </div>
          <div>
            <div className="text-[11px] text-faint mb-1">Tradeoffs</div>
            <ul className="text-[11px] text-dim space-y-0.5">{opt.tradeoffs.map((x: string, i: number) => <li key={i}>• {x}</li>)}</ul>
            {opt.unsupported?.length ? (
              <>
                <div className="text-[11px] text-faint mt-2 mb-1">Notes</div>
                <ul className="text-[11px] text-faint space-y-0.5">{opt.unsupported.map((x: string, i: number) => <li key={i}>• {x}</li>)}</ul>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* advanced settings (editable) */}
      <details className="rounded-lg border border-border/60 bg-panel/20">
        <summary className="px-3 py-2 text-xs text-dim cursor-pointer inline-flex items-center gap-1.5"><Settings2 size={13} /> Advanced settings {draft ? <span className="text-neural-violet">(overridden)</span> : ''}</summary>
        <div className="p-3 pt-1 grid md:grid-cols-2 gap-x-4 gap-y-2">
          {fields.map(([key, label, min, max, step]) => (
            <Num key={key} label={label} value={s[key]} min={min} max={max} step={step}
              onChange={(v) => setDraft({ ...s, [key]: v })} />
          ))}
          {meta.category !== 'Embeddings' ? floats.map(([key, label, min, max, step]) => (
            <Num key={key} label={label} value={s[key]} min={min} max={max} step={step} float
              onChange={(v) => setDraft({ ...s, [key]: v })} />
          )) : null}
          <Check label="Memory-map weights (mmap)" value={s.mmap !== false} onChange={(v) => setDraft({ ...s, mmap: v })} />
          <Check label="Lock weights in RAM (mlock)" value={!!s.mlock} onChange={(v) => setDraft({ ...s, mlock: v })} />
        </div>
        <div className="px-3 pb-3 text-[11px] text-faint">Maps to llama.cpp: <span className="font-mono">-c {s.contextLength} -ngl {s.gpuLayers} -t {s.threads} -b {s.batchSize}{s.ubatchSize ? ` -ub ${s.ubatchSize}` : ''}{s.mmap === false ? ' --no-mmap' : ''}{s.mlock ? ' --mlock' : ''}</span></div>
      </details>

      {/* actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button disabled={busy || c.level === 'Unsupported'} onClick={() => apply(true)}
          className="text-sm px-3.5 py-1.5 rounded-lg border font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
          style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.10)' }}>
          <Power size={14} /> Apply &amp; Load
        </button>
        <button disabled={busy || c.level === 'Unsupported'} onClick={() => apply(false)}
          className="text-sm px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5 disabled:opacity-40">
          <Sparkles size={14} /> Apply settings only
        </button>
        <button disabled={busy} onClick={reset}
          className="text-sm px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5">
          <RotateCcw size={13} /> Reset to DAWN recommendation
        </button>
        {c.level === 'Not recommended' ? <span className="text-[11px] text-neural-red">force-load — may be very slow</span> : null}
      </div>
    </div>
  );
}

function Num({ label, value, min, max, step, float, onChange }: any) {
  return (
    <label className="text-[11px] text-faint flex items-center justify-between gap-2">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(float ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
        className="w-24 bg-bg border border-border rounded px-2 py-1 text-xs text-ink" />
    </label>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="text-[11px] text-faint flex items-center justify-between gap-2 cursor-pointer">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />
    </label>
  );
}

function Info2({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return <div><div className="text-faint mb-1">{label}</div><div className="text-faint/60">—</div></div>;
  return (
    <div>
      <div className="text-faint mb-1">{label}</div>
      <ul className="text-dim space-y-0.5">{items.map((x, i) => <li key={i}>• {x}</li>)}</ul>
    </div>
  );
}

function Hw({ icon, label, value, sub }: any) {
  return (
    <div className="glass p-3">
      <div className="text-[11px] text-faint flex items-center gap-1.5">{icon} {label}</div>
      <div className="text-sm font-semibold mt-1 truncate" title={value}>{value}</div>
      {sub ? <div className="text-[11px] text-faint truncate">{sub}</div> : null}
    </div>
  );
}

// --- helpers ---------------------------------------------------------------
function short(cpu: string) { return cpu.replace(/\(R\)|\(TM\)|CPU|Processor/gi, '').replace(/\s+/g, ' ').trim(); }
function backendList(b: any) {
  if (!b) return 'Unknown';
  const on = Object.entries(b).filter(([, v]) => v).map(([k]) => ({ cuda: 'CUDA', directML: 'DirectML', metal: 'Metal', rocm: 'ROCm', llamaCpp: 'llama.cpp', ollama: 'Ollama', cpuOnly: 'CPU' } as any)[k]).filter(Boolean);
  return on.length ? on.join(' · ') : 'CPU';
}
function currentModelPath() {
  try { return useRuntimeStore.getState().status?.model || ''; } catch { return ''; }
}

// fire-and-forget actions used by the card buttons
async function selectAndLoad(m: any, refresh: () => void, refreshRuntime: () => void, setToast: (s: string) => void) {
  const id = m.path || m.actualName;
  let opts: any = { load: true };
  if (m.compatibility.level === 'Not recommended') {
    if (!window.confirm(`${m.metadata.friendlyName} is not recommended on this hardware and may be very slow. Load it anyway?`)) return;
    opts.force = true;
  }
  const r = await window.dawn.optimizer.apply(id, opts);
  if (!r.ok && r.blocked) { setToast(r.reason); return; }
  setToast(r.loadError ? r.loadError : `Loaded ${m.metadata.friendlyName} (${r.optimization?.mode})`);
  refreshRuntime();
  refresh();
}
async function optimizeOnly(m: any, refresh: () => void, setToast: (s: string) => void) {
  const id = m.path || m.actualName;
  const r = await window.dawn.optimizer.apply(id, {});
  if (!r.ok && r.blocked) { setToast(r.reason); return; }
  setToast(`Optimized ${m.metadata.friendlyName} (${r.optimization?.mode}) — settings saved`);
  refresh();
}
