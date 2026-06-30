import React, { useEffect, useState } from 'react';
import { FolderOpen, Plus, Trash2, CheckCircle2, AlertTriangle, HardDrive, Gauge, Zap, Loader2, Trophy } from 'lucide-react';
import { Button } from '../ui/button';
import { useRuntimeStore } from '../state/runtimeStore';

function fmtBytes(n: number) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 1 ? 1 : 0)} ${u[i]}`;
}

/** Model Manager — local GGUF files in %APPDATA%/DAWN/models. */
export default function ModelManager() {
  const [models, setModels] = useState<any[]>([]);
  const [ram, setRam] = useState(0);
  const [benches, setBenches] = useState<Record<string, any>>({});
  const [best, setBest] = useState<any[]>([]);
  const [benching, setBenching] = useState('');
  const refresh = useRuntimeStore((s) => s.refresh);

  const loadBench = () => {
    window.dawn.bench.history().then((rows: any[]) => {
      const byModel: Record<string, any> = {};
      for (const r of rows) if (!byModel[r.model_path]) byModel[r.model_path] = r; // newest first
      setBenches(byModel);
    });
    window.dawn.bench.best().then(setBest);
  };
  const load = () => {
    window.dawn.models.list().then(setModels);
    window.dawn.models.systemRam().then(setRam);
    loadBench();
  };
  useEffect(load, []);

  async function benchmark(p: string) {
    setBenching(p);
    await window.dawn.bench.run(p);
    setBenching('');
    loadBench();
    refresh();
  }

  async function importModel() {
    const r = await window.dawn.models.import();
    if (r?.ok) load();
    else if (r && !r.canceled && r.error) alert(r.error);
  }
  async function select(p: string) {
    await window.dawn.runtime.switchModel(p); // seamless swap — no manual power toggle
    load();
    refresh();
  }
  async function remove(p: string) {
    if (confirm('Remove this model from DAWN? (Deletes the file from the models folder.)')) {
      await window.dawn.models.remove(p);
      load();
      refresh();
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto h-full overflow-y-auto">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Model Manager</h1>
          <p className="text-sm text-dim">Local GGUF models. Nothing is downloaded automatically — import your own.</p>
          <p className="text-xs text-faint mt-1 flex items-center gap-1"><HardDrive size={12} /> System RAM: {ram} GB</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => window.dawn.models.openFolder()}><FolderOpen size={15} /> Folder</Button>
          <Button variant="primary" onClick={importModel}><Plus size={15} /> Import GGUF</Button>
        </div>
      </div>

      <div className="space-y-2">
        {models.length === 0 ? (
          <div className="glass p-8 text-center text-dim">
            No models yet. Click <b>Import GGUF</b> to add a <code>.gguf</code> file (e.g. a Qwen / Llama / Mistral quant).
          </div>
        ) : (
          models.map((m) => {
            const tooBig = ram > 0 && m.estRamGB > ram;
            const b = benches[m.path];
            return (
              <div key={m.path} className={`glass p-4 flex items-center gap-4 ${m.loaded ? 'ring-1 ring-neural-green/50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate flex items-center gap-2">
                    {m.loaded ? <CheckCircle2 size={15} className="text-neural-green shrink-0" /> : null}
                    {m.name}
                  </div>
                  <div className="text-xs text-faint mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{fmtBytes(m.size)}</span>
                    <span>quant: {m.quant}</span>
                    <span>~{m.estRamGB} GB RAM</span>
                    {tooBig ? <span className="text-neural-amber flex items-center gap-1"><AlertTriangle size={11} /> may exceed your RAM</span> : null}
                  </div>
                  {b ? (
                    <div className="text-[11px] mt-1 flex flex-wrap gap-x-3">
                      {b.status === 'ok'
                        ? <span className="text-neural-cyan inline-flex items-center gap-1"><Zap size={11} /> {b.tokens_per_sec} tok/s · load {(b.load_ms / 1000).toFixed(1)}s · {b.backend} · max ctx ~{(b.est_max_context / 1024).toFixed(0)}k</span>
                        : <span className="text-neural-red inline-flex items-center gap-1"><AlertTriangle size={11} /> {b.oom ? 'OOM' : 'benchmark failed'}: {b.error}</span>}
                    </div>
                  ) : null}
                </div>
                <button onClick={() => benchmark(m.path)} disabled={!!benching} title="Benchmark this model on your PC" className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">
                  {benching === m.path ? <Loader2 size={13} className="animate-spin" /> : <Gauge size={13} />} Benchmark
                </button>
                {m.loaded ? (
                  <span className="text-xs text-neural-green">Selected</span>
                ) : (
                  <Button size="sm" variant="default" onClick={() => select(m.path)}>Select</Button>
                )}
                <button onClick={() => remove(m.path)} className="p-1.5 text-faint hover:text-neural-red"><Trash2 size={15} /></button>
              </div>
            );
          })
        )}
      </div>

      {best.filter((b) => b.status === 'ok').length ? (
        <div className="glass p-4 mt-4">
          <div className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Trophy size={15} className="text-neural-amber" /> Best for this PC</div>
          <div className="space-y-1.5">
            {best.slice(0, 6).map((b) => (
              <div key={b.model_path} className="flex items-center gap-2 text-xs">
                <span className="w-5 text-faint font-mono">#{b.rank}</span>
                <span className="flex-1 truncate text-dim">{b.model_name}</span>
                <span className={b.status === 'ok' ? 'text-neural-cyan' : 'text-neural-red'}>{b.note}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-faint mt-2">Ranked by your benchmark runs (throughput, load time, backend). Benchmark more models to complete the ranking.</p>
        </div>
      ) : null}

      <div className="glass-soft p-3 mt-4 text-xs text-faint">
        Selecting a model <b>loads it immediately</b> — DAWN swaps it in the background, no power toggle or restart needed.
        <b> Benchmark</b> loads a model, times a fixed prompt, then restores your current chat model. Browse &amp; download more in the Model Hub.
      </div>
    </div>
  );
}
