import React, { useEffect, useState } from 'react';
import { FolderOpen, Plus, Trash2, CheckCircle2, AlertTriangle, HardDrive } from 'lucide-react';
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
  const refresh = useRuntimeStore((s) => s.refresh);

  const load = () => {
    window.dawn.models.list().then(setModels);
    window.dawn.models.systemRam().then(setRam);
  };
  useEffect(load, []);

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
                </div>
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

      <div className="glass-soft p-3 mt-4 text-xs text-faint">
        Selecting a model <b>loads it immediately</b> — DAWN swaps it in the background, no power toggle or restart needed.
        You can also switch right from the model dropdown in Chat. Browse &amp; download more in the Model Hub.
      </div>
    </div>
  );
}
