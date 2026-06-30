import React, { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import {
  Swords, Play, Square, Trophy, Eye, EyeOff, Trash2, Scale, Loader2, Gauge, Zap, Cpu, Clock, Plus,
} from 'lucide-react';
import { useBrainStore } from '../state/brainStore';

/**
 * Model Arena (Compare) — run the same prompt across 2–4 installed models, see outputs
 * side-by-side with real metrics (latency, tokens/sec, backend), optionally blind, and
 * ask a judge model to pick a winner and synthesize a merged best answer. DAWN loads
 * each model in turn (sequential for stability) and restores your chat model afterward.
 */

interface Out {
  position: number; label: string; modelName: string; output: string;
  metrics?: any; status?: string; error?: string; oom?: boolean;
}

export default function CompareView() {
  const [models, setModels] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [blind, setBlind] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [running, setRunning] = useState(false);
  const [outs, setOuts] = useState<Out[]>([]);
  const [judge, setJudge] = useState<any>(null);
  const [judging, setJudging] = useState(false);
  const [judgeModel, setJudgeModel] = useState('auto');
  const [runs, setRuns] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  const runIdRef = useRef<string | null>(null);
  const setBrain = useBrainStore((s) => s.setBrain);

  const refreshRuns = () => window.dawn.compare.list().then(setRuns);
  useEffect(() => {
    window.dawn.models.list().then(setModels);
    refreshRuns();
    const off = window.dawn.compare.onProgress((p: any) => {
      if (p.runId !== runIdRef.current) return;
      if (p.phase === 'model_start') {
        setOuts((prev) => upsert(prev, { position: p.position, label: p.label, modelName: p.modelName, output: '', status: 'running' }));
        setBrain('THINKING', `Running ${p.modelName}…`);
      } else if (p.phase === 'token') {
        setBrain('RESPONDING');
        setOuts((prev) => prev.map((o) => o.position === p.position ? { ...o, output: o.output + p.delta } : o));
      } else if (p.phase === 'model_done') {
        setOuts((prev) => prev.map((o) => o.position === p.position ? { ...o, modelName: p.modelName, metrics: p.metrics, status: p.status, error: p.error, oom: p.oom } : o));
      } else if (p.phase === 'restoring') {
        setBrain('BOOTING', 'Restoring your chat model…');
      } else if (p.phase === 'done' || p.phase === 'cancelled' || p.phase === 'error') {
        setRunning(false); setBrain('IDLE'); refreshRuns();
        if (p.phase === 'error') setMsg(p.message || 'Compare failed.');
      }
    });
    return () => { off?.(); };
  }, []);

  function toggle(path: string) {
    setSelected((prev) => prev.includes(path) ? prev.filter((p) => p !== path) : prev.length >= 4 ? prev : [...prev, path]);
  }

  async function run() {
    setMsg('');
    if (!prompt.trim()) { setMsg('Enter a prompt.'); return; }
    if (selected.length < 2) { setMsg('Select at least 2 models.'); return; }
    const r = await window.dawn.compare.start({ prompt: prompt.trim(), modelPaths: selected, blind, maxTokens: 512 });
    if (!r.ok) { setMsg(r.error); return; }
    runIdRef.current = r.runId;
    setRunning(true); setRevealed(!blind); setOuts([]); setJudge(null);
  }
  function stop() { if (runIdRef.current) window.dawn.compare.cancel(runIdRef.current); }

  async function reveal() {
    if (!runIdRef.current) return;
    const d = await window.dawn.compare.get(runIdRef.current);
    if (d) setOuts((prev) => prev.map((o) => { const real = d.outputs.find((x: any) => x.position === o.position); return real ? { ...o, modelName: real.model_name } : o; }));
    setRevealed(true);
  }

  async function doJudge() {
    if (!runIdRef.current) return;
    setJudging(true); setBrain('SYNTHESIZING', 'Judging…');
    const r = await window.dawn.compare.judge(runIdRef.current, judgeModel);
    setJudging(false); setBrain('IDLE');
    if (!r.ok) { setMsg(r.error); return; }
    setJudge(r.verdict);
    if (blind) reveal();
  }

  async function openRun(runId: string) {
    const d = await window.dawn.compare.get(runId);
    if (!d) return;
    runIdRef.current = runId;
    setPrompt(d.run.prompt);
    setBlind(!!d.run.blind);
    setRevealed(!d.run.blind);
    setRunning(false);
    setOuts(d.outputs.map((o: any) => ({ position: o.position, label: o.label, modelName: o.model_name, output: o.output || '', metrics: o, status: o.status, error: o.error, oom: !!o.oom })));
    setJudge(d.score ? { winnerLabel: d.score.winner_label, reasoning: d.score.analysis_md, strengths: safe(d.score.strengths_json), weaknesses: safe(d.score.weaknesses_json), mergedAnswer: d.score.merged_answer, winnerModel: d.score.winner_model } : null);
  }
  async function removeRun(runId: string) {
    await window.dawn.compare.delete(runId);
    if (runIdRef.current === runId) { runIdRef.current = null; setOuts([]); setJudge(null); }
    refreshRuns();
  }

  const cols = Math.min(outs.length || selected.length || 2, 4);

  return (
    <div className="h-full flex">
      {/* history */}
      <div className="w-52 shrink-0 border-r border-border bg-bg/40 flex flex-col">
        <div className="p-3"><button onClick={() => { runIdRef.current = null; setOuts([]); setJudge(null); setPrompt(''); }} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}><Plus size={15} /> New compare</button></div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {runs.map((r) => (
            <div key={r.id} onClick={() => openRun(r.id)} className={`group px-2.5 py-2 rounded-lg cursor-pointer text-xs ${runIdRef.current === r.id ? 'bg-panel2/70' : 'hover:bg-panel/50'}`}>
              <div className="flex items-start gap-1.5">
                <span className="flex-1 text-dim leading-snug line-clamp-2">{r.prompt}</span>
                <button onClick={(e) => { e.stopPropagation(); removeRun(r.id); }} className="opacity-0 group-hover:opacity-100 text-faint hover:text-neural-red"><Trash2 size={12} /></button>
              </div>
              <div className="text-[10px] text-faint mt-0.5">{r.winner_label ? <span className="text-neural-green">winner {r.winner_label}</span> : r.status}{r.blind ? ' · blind' : ''}</div>
            </div>
          ))}
          {!runs.length ? <div className="text-[11px] text-faint text-center py-6">No comparisons yet.</div> : null}
        </div>
      </div>

      {/* main */}
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
        <div className="flex items-center gap-2 mb-1"><Swords size={18} style={{ color: 'var(--accent)' }} /><h1 className="text-xl font-bold">Model Arena</h1></div>
        <p className="text-sm text-dim mb-4">Run one prompt across 2–4 local models and compare them head-to-head. DAWN loads each in turn and restores your chat model afterward.</p>

        {/* setup */}
        <div className="glass p-4 mb-4">
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="Prompt to send to every model…" className="w-full resize-none bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" />
          <div className="mt-3">
            <div className="text-[11px] text-faint mb-1.5">Models ({selected.length}/4 — pick 2 to 4)</div>
            <div className="grid md:grid-cols-2 gap-1.5">
              {models.map((m) => {
                const on = selected.includes(m.path);
                const idx = selected.indexOf(m.path);
                return (
                  <button key={m.path} onClick={() => toggle(m.path)} className={`text-left text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-2 ${on ? 'border-neural-cyan/60 bg-neural-cyan/10 text-ink' : 'border-border text-dim hover:text-ink'}`}>
                    <span className={`w-4 h-4 rounded grid place-items-center text-[10px] font-bold shrink-0 ${on ? 'bg-neural-cyan/30 text-neural-cyan' : 'bg-panel2'}`}>{on ? String.fromCharCode(65 + idx) : ''}</span>
                    <span className="truncate">{m.name}</span>
                  </button>
                );
              })}
              {!models.length ? <div className="text-xs text-faint">No models installed — add some in Model Hub.</div> : null}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button onClick={() => setBlind((b) => !b)} className={`text-xs px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${blind ? 'border-neural-violet/60 text-neural-violet bg-neural-violet/10' : 'border-border text-dim'}`}>{blind ? <EyeOff size={13} /> : <Eye size={13} />} Blind mode</button>
            {!running ? (
              <button onClick={run} disabled={selected.length < 2 || !prompt.trim()} className="text-sm px-4 py-1.5 rounded-lg border font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}><Play size={14} /> Run</button>
            ) : (
              <button onClick={stop} className="text-sm px-4 py-1.5 rounded-lg border border-neural-red/50 text-neural-red inline-flex items-center gap-1.5"><Square size={14} /> Stop</button>
            )}
            {msg ? <span className="text-[11px] text-neural-amber">{msg}</span> : null}
          </div>
        </div>

        {/* results side-by-side */}
        {outs.length ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="hud-label">Results</div>
              <div className="flex items-center gap-2">
                {blind && !revealed ? <button onClick={reveal} className="text-xs px-2.5 py-1 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1"><Eye size={12} /> Reveal models</button> : null}
                <button onClick={doJudge} disabled={judging || running || outs.filter((o) => o.status === 'ok').length < 2} className="text-xs px-2.5 py-1 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">{judging ? <Loader2 size={12} className="animate-spin" /> : <Scale size={12} />} Judge / Synthesize</button>
              </div>
            </div>
            <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {outs.sort((a, b) => a.position - b.position).map((o) => (
                <div key={o.position} className={`glass p-3 ${judge?.winnerLabel === o.label ? 'ring-1 ring-neural-green/60' : ''}`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-5 h-5 rounded grid place-items-center text-[11px] font-bold bg-panel2 text-neural-cyan">{o.label}</span>
                    <span className="text-sm font-medium truncate">{revealed || !blind ? o.modelName : `Model ${o.label}`}</span>
                    {judge?.winnerLabel === o.label ? <Trophy size={13} className="text-neural-green ml-auto" /> : null}
                  </div>
                  {o.status === 'error' ? (
                    <div className="text-xs text-neural-red flex items-start gap-1.5">{o.oom ? 'Out of memory — ' : 'Failed — '}{o.error}</div>
                  ) : (
                    <div className="text-xs text-dim max-h-72 overflow-y-auto"><Markdown>{o.output || (o.status === 'running' ? '…' : '')}</Markdown></div>
                  )}
                  {o.metrics ? <Metrics m={o.metrics} /> : null}
                </div>
              ))}
            </div>

            {/* judge verdict */}
            {judge ? (
              <div className="glass p-4 mb-5">
                <div className="flex items-center gap-2 mb-2"><Trophy size={15} className="text-neural-green" /><span className="font-semibold text-sm">Winner: {revealed || !blind ? (judge.winnerModel || `Model ${judge.winnerLabel}`) : `Model ${judge.winnerLabel}`}</span></div>
                {judge.reasoning ? <p className="text-xs text-dim mb-3">{judge.reasoning}</p> : null}
                <div className="grid md:grid-cols-2 gap-3 text-xs">
                  <SW title="Strengths" map={judge.strengths} color="text-neural-green" />
                  <SW title="Weaknesses" map={judge.weaknesses} color="text-neural-amber" />
                </div>
                {judge.mergedAnswer ? (<div className="mt-3"><div className="hud-label mb-1">Merged best answer</div><div className="text-sm"><Markdown>{judge.mergedAnswer}</Markdown></div></div>) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Metrics({ m }: { m: any }) {
  const items: [any, string][] = [
    [<Zap size={11} key="z" />, `${m.tokensPerSec ?? 0} tok/s`],
    [<Clock size={11} key="c" />, `first ${ms(m.firstTokenMs)} · total ${ms(m.totalMs)}`],
    [<Gauge size={11} key="g" />, `load ${ms(m.loadMs)}`],
    [<Cpu size={11} key="b" />, `${m.backend} · ngl ${m.gpuLayers}`],
  ];
  return (
    <div className="mt-2 pt-2 border-t border-border/50 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-faint">
      {items.map(([ic, t], i) => <span key={i} className="inline-flex items-center gap-1">{ic}{t}</span>)}
      <span className="col-span-2">{m.promptTokens}+{m.completionTokens} tok · ctx {m.contextLength} · T{m.temperature} · ~{m.estRamGB}GB</span>
    </div>
  );
}
function SW({ title, map, color }: { title: string; map: any; color: string }) {
  const keys = Object.keys(map || {});
  return (
    <div>
      <div className={`text-faint mb-1`}>{title}</div>
      {keys.length ? keys.map((k) => (
        <div key={k} className="mb-1"><span className={`font-mono ${color}`}>{k}</span>: <span className="text-dim">{(map[k] || []).join('; ')}</span></div>
      )) : <div className="text-faint/60">—</div>}
    </div>
  );
}
function ms(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n || 0}ms`; }
function upsert(list: Out[], item: Out) { const i = list.findIndex((x) => x.position === item.position); if (i < 0) return [...list, item]; const n = list.slice(); n[i] = { ...n[i], ...item }; return n; }
function safe(s: string) { try { return JSON.parse(s || '{}'); } catch { return {}; } }
