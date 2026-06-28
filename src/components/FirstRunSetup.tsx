import React, { useEffect, useState } from 'react';
import { Brain, ChevronRight, ChevronLeft, Plus, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';

const PERF = [
  { id: 'balanced', label: 'Balanced', desc: 'Sensible defaults for most PCs.' },
  { id: 'high', label: 'High Performance', desc: 'Offload all layers to GPU (needs a CUDA/Vulkan build).' },
  { id: 'lowvram', label: 'Low VRAM', desc: 'Keep the model mostly on CPU/RAM.' },
  { id: 'cpu', label: 'CPU Safe Mode', desc: 'No GPU. Slow but works anywhere.' },
];

/** First-run wizard — pick a local model, performance mode, and preferences. */
export default function FirstRunSetup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [models, setModels] = useState<any[]>([]);
  const [modelPath, setModelPath] = useState('');
  const [perf, setPerf] = useState('balanced');
  const [ctx, setCtx] = useState(4096);
  const [mem, setMem] = useState(true);
  const [know, setKnow] = useState(false);

  const loadModels = () => window.dawn.models.list().then((m: any[]) => { setModels(m); setModelPath((p) => p || (m[0]?.path ?? '')); });
  useEffect(loadModels, []);

  async function importModel() {
    const r = await window.dawn.models.import();
    if (r?.ok) {
      await loadModels();
      setModelPath(r.path);
    } else if (r && !r.canceled && r.error) alert(r.error);
  }

  async function finish() {
    const perfMap: any = {
      balanced: { performanceMode: 'balanced', gpuLayers: 0, lowVram: false, highPerformance: false },
      high: { performanceMode: 'high', gpuLayers: 999, highPerformance: true, lowVram: false },
      lowvram: { performanceMode: 'lowvram', lowVram: true, gpuLayers: 0, highPerformance: false },
      cpu: { performanceMode: 'cpu', gpuLayers: 0, lowVram: true, highPerformance: false },
    };
    if (modelPath) await window.dawn.models.select(modelPath);
    await window.dawn.setup.complete({ modelPath, contextLength: ctx, memoryEnabled: mem, knowledgeEnabled: know, ...perfMap[perf] });
    onDone();
  }

  const next = () => setStep((s) => Math.min(4, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-bg">
      <div className="glass w-[640px] max-w-[92vw] p-7">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl grid place-items-center bg-gradient-to-br from-neural-cyan to-neural-violet shadow-glow">
            <Brain size={22} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-lg leading-none">Welcome to DAWN</div>
            <div className="text-xs text-faint">Digitally Autonomous Workspace Node — fully local setup</div>
          </div>
        </div>

        {step === 0 && (
          <div>
            <p className="text-sm text-dim leading-relaxed">
              DAWN runs <b>entirely on your computer</b>. Your AI runs through a bundled llama.cpp runtime on local GGUF
              model files. No Ollama, no Docker, no cloud — nothing leaves your PC. Let's get you set up.
            </p>
            <ul className="text-sm text-dim mt-3 space-y-1 list-disc pl-5">
              <li>Pick a local model file</li>
              <li>Choose a performance mode</li>
              <li>Decide on memory &amp; local knowledge</li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <div>
            <h3 className="font-semibold mb-1">Choose a model</h3>
            <p className="text-xs text-dim mb-3">Import a <code>.gguf</code> file (Qwen, Llama, Mistral, …). It's copied into DAWN's local models folder.</p>
            <Button variant="primary" onClick={importModel} className="mb-2"><Plus size={15} /> Import GGUF</Button>
            <p className="text-xs text-faint mb-3">No file to import? Skip this — after setup, open the <b>Model Hub</b> and DAWN will download an open-weight model for you.</p>
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {models.length === 0 ? <div className="text-sm text-faint">No models yet — import one above.</div> : null}
              {models.map((m) => (
                <button
                  key={m.path}
                  onClick={() => setModelPath(m.path)}
                  className={`w-full text-left glass-soft p-2.5 flex items-center gap-2 ${modelPath === m.path ? 'ring-1 ring-neural-cyan' : ''}`}
                >
                  {modelPath === m.path ? <CheckCircle2 size={15} className="text-neural-cyan shrink-0" /> : <span className="w-4" />}
                  <span className="text-sm truncate flex-1">{m.name}</span>
                  <span className="text-xs text-faint">{m.quant}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 className="font-semibold mb-2">Performance mode</h3>
            <div className="grid grid-cols-2 gap-2">
              {PERF.map((p) => (
                <button key={p.id} onClick={() => setPerf(p.id)} className={`text-left glass-soft p-3 ${perf === p.id ? 'ring-1 ring-neural-cyan' : ''}`}>
                  <div className="text-sm font-semibold">{p.label}</div>
                  <div className="text-xs text-faint mt-0.5">{p.desc}</div>
                </button>
              ))}
            </div>
            <label className="block mt-4 text-sm">
              Default context length
              <select value={ctx} onChange={(e) => setCtx(Number(e.target.value))} className="ml-2 bg-bg border border-border rounded-lg px-2 py-1 text-sm">
                {[2048, 4096, 8192, 16384, 32768].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
        )}

        {step === 3 && (
          <div>
            <h3 className="font-semibold mb-2">Memory &amp; knowledge</h3>
            <Toggle label="Enable local memory" desc="DAWN can remember facts/preferences you approve (stored locally)." v={mem} set={setMem} />
            <Toggle label="Enable local knowledge indexing" desc="Index folders you choose for retrieval. Nothing is scanned automatically." v={know} set={setKnow} />
            <p className="text-xs text-faint mt-3">You can change all of this later in Settings.</p>
          </div>
        )}

        {step === 4 && (
          <div>
            <h3 className="font-semibold mb-2">You're ready</h3>
            <p className="text-sm text-dim">
              Model: <b>{modelPath ? modelPath.split(/[\\/]/).pop() : 'none selected'}</b><br />
              Mode: <b>{PERF.find((p) => p.id === perf)?.label}</b> · Context: <b>{ctx}</b><br />
              Memory: <b>{mem ? 'on' : 'off'}</b> · Knowledge: <b>{know ? 'on' : 'off'}</b>
            </p>
            <p className="text-xs text-faint mt-3">
              After finishing, press the <b>power switch</b> in the sidebar to launch the local runtime and load your model.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between mt-6">
          <Button variant="ghost" onClick={back} disabled={step === 0}><ChevronLeft size={15} /> Back</Button>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`w-2 h-2 rounded-full ${i === step ? 'bg-neural-cyan' : 'bg-border'}`} />)}
          </div>
          {step < 4 ? (
            <Button variant="primary" onClick={next}>Next <ChevronRight size={15} /></Button>
          ) : (
            <Button variant="primary" onClick={finish}>Finish</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, desc, v, set }: any) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="pr-4">
        <div className="text-sm">{label}</div>
        <div className="text-xs text-faint mt-0.5">{desc}</div>
      </div>
      <button onClick={() => set(!v)} className={`w-12 h-6 rounded-full relative shrink-0 transition ${v ? 'bg-neural-cyan/40' : 'bg-panel2'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${v ? 'left-6' : 'left-0.5'}`} />
      </button>
    </div>
  );
}
