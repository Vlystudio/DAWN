import React, { useEffect, useState } from 'react';
import { Eye, FolderOpen, Wand2, PlayCircle, Trash2, Loader2, Check, AlertTriangle, EyeOff } from 'lucide-react';

/**
 * VisionSetupPanel — configure a local vision model (VLM GGUF + mmproj) for Vision Chat. Real, honest:
 * all state comes from window.dawn.vision.validate() / autoDetect() / testModel(); full paths never
 * cross the bridge (only basenames + validation states). Nothing is claimed "ready" unless both files
 * validate and the bundled multimodal CLI is present.
 */
type Setup = {
  state: string; ready: boolean; modelConfigured: boolean; mmprojConfigured: boolean; cliPresent: boolean;
  modelName: string; mmprojName: string; message: string; nextAction?: string;
};
type Pair = { modelName: string; mmprojName: string; confidence: 'high' | 'medium' | 'low'; recommended: boolean; sameDir: boolean };

function StateBadge({ setup }: { setup: Setup }) {
  const ready = setup.ready;
  const cls = ready ? 'text-neural-green border-neural-green/40 bg-neural-green/10'
    : setup.state === 'not_configured' ? 'text-faint border-border bg-panel2/40'
    : 'text-neural-amber border-neural-amber/50 bg-neural-amber/10';
  const label = ready ? 'Ready' : setup.state === 'not_configured' ? 'Not configured' : 'Needs setup';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${cls}`}>{ready ? <Check size={11} /> : <AlertTriangle size={11} />}{label}</span>;
}

export default function VisionSetupPanel() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [busy, setBusy] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; state: string; text?: string; error?: string; model?: string } | null>(null);
  const [msg, setMsg] = useState('');

  const refresh = () => window.dawn.vision.validate().then(setSetup).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function pick(kind: 'model' | 'mmproj') {
    setMsg('');
    const r = await window.dawn.vision.pickModel(kind);
    if (r?.ok) { setSetup(r.validation); }
    else if (r && !r.canceled) setMsg(r.error || 'Could not set that file.');
  }
  async function autoDetect() {
    setBusy('detect'); setMsg('');
    const r = await window.dawn.vision.autoDetect();
    setBusy(''); setPairs(r.pairs || []); setScanned(r.scanned || 0);
  }
  async function usePair(p: Pair) {
    if (!confirm(`Use this vision pair?\n\nModel: ${p.modelName}\nmmproj: ${p.mmprojName}`)) return;
    setBusy('apply');
    const r = await window.dawn.vision.applyPair(p.modelName, p.mmprojName);
    setBusy('');
    if (r?.ok) { setSetup(r.validation); setPairs(null); }
    else setMsg(r?.error || 'Could not apply that pair.');
  }
  async function test() {
    setBusy('test'); setTestResult(null); setMsg('');
    const r = await window.dawn.vision.testModel();
    setBusy(''); setTestResult(r);
  }
  async function clear() {
    setBusy('clear');
    const r = await window.dawn.vision.clearSetup();
    setBusy(''); setSetup(r.validation); setPairs(null); setTestResult(null);
  }

  if (!setup) return null;
  const confCls: Record<string, string> = { high: 'text-neural-green', medium: 'text-neural-cyan', low: 'text-faint' };

  return (
    <div className="rounded-lg border border-border bg-panel/20 p-4 mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Eye size={16} style={{ color: 'var(--accent)' }} />
        <h3 className="text-sm font-semibold">Vision Chat model</h3>
        <StateBadge setup={setup} />
        <span className="ml-auto text-[11px] inline-flex items-center gap-1 text-faint">
          {setup.cliPresent ? <><Check size={11} className="text-neural-green" /> multimodal runtime</> : <><EyeOff size={11} className="text-neural-red" /> runtime missing</>}
        </span>
      </div>
      <p className="text-[11px] text-dim mb-3">{setup.message}{setup.nextAction ? <span className="text-faint"> — {setup.nextAction}</span> : null}</p>

      <div className="grid sm:grid-cols-2 gap-2 mb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => pick('model')} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5 shrink-0"><FolderOpen size={13} /> Model</button>
          <span className={`text-[11px] truncate ${setup.modelConfigured ? 'text-ink' : 'text-faint'}`}>{setup.modelName || 'not set'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => pick('mmproj')} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5 shrink-0"><FolderOpen size={13} /> mmproj</button>
          <span className={`text-[11px] truncate ${setup.mmprojConfigured ? 'text-ink' : 'text-faint'}`}>{setup.mmprojName || 'not set'}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={autoDetect} disabled={!!busy} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5 disabled:opacity-40">{busy === 'detect' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Auto-detect</button>
        <button onClick={test} disabled={!!busy || !setup.ready} title={setup.ready ? 'Run the real model on a tiny test image' : 'Configure a valid model first'} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5 disabled:opacity-40">{busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />} Test Vision Model</button>
        {(setup.modelConfigured || setup.mmprojConfigured) ? <button onClick={clear} disabled={!!busy} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-faint hover:text-neural-red inline-flex items-center gap-1.5"><Trash2 size={13} /> Clear</button> : null}
      </div>

      {msg ? <div className="text-[11px] text-neural-amber mt-2">{msg}</div> : null}

      {pairs ? (
        <div className="mt-3 border-t border-border/50 pt-3">
          <div className="text-[11px] text-faint mb-1.5">Auto-detect scanned {scanned} model file(s) in your model folder.</div>
          {pairs.length === 0 ? (
            <div className="text-[11px] text-faint">No vision model + mmproj pair found. Install a VLM GGUF and its mmproj in the Model Hub, then re-scan.</div>
          ) : (
            <div className="space-y-1.5">
              {pairs.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] rounded-lg border border-border px-2.5 py-1.5">
                  <span className={`uppercase font-mono ${confCls[p.confidence]}`}>{p.confidence}</span>
                  {p.recommended ? <span className="text-neural-green">★ recommended</span> : null}
                  <span className="flex-1 truncate text-dim">{p.modelName} <span className="text-faint">+ {p.mmprojName}</span></span>
                  <button onClick={() => usePair(p)} disabled={!!busy} className="px-2 py-0.5 rounded border border-border hover:text-ink shrink-0">Use pair</button>
                </div>
              ))}
              <div className="text-[10px] text-faint">Nothing is applied until you confirm — and DAWN re-validates the files before enabling vision.</div>
            </div>
          )}
        </div>
      ) : null}

      {testResult ? (
        <div className={`mt-3 border-t border-border/50 pt-3 text-[11px] ${testResult.ok ? 'text-neural-green' : 'text-neural-amber'}`}>
          {testResult.ok
            ? <><Check size={12} className="inline mb-0.5" /> Vision model responded{testResult.model ? ` (${testResult.model})` : ''}: <span className="text-dim">“{testResult.text}”</span></>
            : <><AlertTriangle size={12} className="inline mb-0.5" /> {testResult.error || 'Test failed.'}</>}
        </div>
      ) : null}
    </div>
  );
}
