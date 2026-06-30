import React, { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import {
  Telescope, Search, Play, Pause, Square, Download, Globe, FolderSearch, Layers,
  AlertTriangle, CheckCircle2, Loader2, Trash2, ExternalLink, Sparkles, Shield, Plus, FileText,
} from 'lucide-react';
import { useBrainStore } from '../state/brainStore';

/**
 * Deep Research — DAWN plans a question, gathers web + local sources, summarizes each
 * (through the untrusted-data firewall), scores reliability, flags contradictions, and
 * synthesizes a cited report. Fully local model; web access is opt-in. Runs are saved
 * and reopenable, and each run grows the 3D brain.
 */

type Depth = 'quick' | 'standard' | 'deep';
type SourceMode = 'web' | 'local' | 'both';

const DEPTHS: [Depth, string, string][] = [
  ['quick', 'Quick', '~2 queries · 4 sources'],
  ['standard', 'Standard', '~4 queries · 8 sources'],
  ['deep', 'Deep', '~7 queries · 14 sources'],
];
const MODES: [SourceMode, string, any][] = [
  ['web', 'Web only', Globe],
  ['local', 'Local knowledge only', FolderSearch],
  ['both', 'Web + local', Layers],
];

function relColor(r: number) { return r >= 0.7 ? 'text-neural-green' : r >= 0.45 ? 'text-neural-amber' : 'text-neural-red'; }
function statusColor(s: string) {
  if (s === 'done') return 'text-neural-green';
  if (s === 'error') return 'text-neural-red';
  if (s === 'cancelled') return 'text-faint';
  if (s === 'paused') return 'text-neural-amber';
  return 'text-neural-cyan';
}

export default function ResearchView() {
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);

  const [question, setQuestion] = useState('');
  const [depth, setDepth] = useState<Depth>('standard');
  const [sourceMode, setSourceMode] = useState<SourceMode>('both');
  const [model, setModel] = useState('auto');
  const [models, setModels] = useState<any[]>([]);
  const [allowWeb, setAllowWeb] = useState(false);
  const [showForm, setShowForm] = useState(true);

  const activeRef = useRef<string | null>(null);
  const setBrain = useBrainStore((s) => s.setBrain);

  const refreshRuns = () => window.dawn.research.list().then(setRuns);

  useEffect(() => {
    refreshRuns();
    window.dawn.research.models().then((r: any) => setModels(r.models || []));
    window.dawn.settings.get().then((s: any) => setAllowWeb(!!s.researchAllowWeb));
    const off = window.dawn.research.onProgress((p: any) => {
      if (p.runId !== activeRef.current) return;
      if (p.brain) setBrain(p.brain, p.message);
      if (typeof p.percent === 'number') setPercent(p.percent);
      if (p.status) setStatus(p.status);
      if (p.message) setMessage(p.message);
      if (p.step) setSteps((prev) => [...prev, p.step]);
      if (p.source) setSources((prev) => upsert(prev, p.source));
      setPaused(p.status === 'paused');
      if (p.status === 'done' || p.status === 'cancelled' || p.status === 'error') {
        setRunning(false);
        setBrain('IDLE');
        loadDetail(p.runId);
        refreshRuns();
      }
    });
    return () => { off?.(); };
  }, []);

  async function loadDetail(runId: string) {
    const d = await window.dawn.research.get(runId);
    if (!d) return;
    setStatus(d.run.status);
    setPlan(d.run.plan || '');
    setSteps(d.steps || []);
    setSources(d.sources || []);
    setFindings(d.findings || []);
    setReport(d.report || null);
    setRunning(!!d.running);
    if (d.run.status === 'done' || d.run.status === 'error' || d.run.status === 'cancelled') setPercent(100);
  }

  function selectRun(runId: string) {
    activeRef.current = runId; // so live events for a still-running selected run still apply
    setSelectedId(runId);
    setShowForm(false);
    setReport(null); setSteps([]); setSources([]); setFindings([]); setMessage('');
    loadDetail(runId);
  }

  async function start() {
    const q = question.trim();
    if (!q || running) return;
    const r = await window.dawn.research.start({ question: q, depth, sourceMode, model });
    if (!r.ok) { setMessage(r.error || 'Could not start.'); return; }
    activeRef.current = r.runId;
    setSelectedId(r.runId);
    setSteps([]); setSources([]); setFindings([]); setReport(null); setPlan('');
    setStatus('planning'); setPercent(2); setMessage('Planning…'); setRunning(true); setPaused(false);
    setShowForm(false);
    refreshRuns();
  }

  const pause = () => selectedId && window.dawn.research.pause(selectedId);
  const resume = () => selectedId && window.dawn.research.resume(selectedId);
  const cancel = () => selectedId && window.dawn.research.cancel(selectedId);

  async function remove(runId: string) {
    await window.dawn.research.delete(runId);
    if (selectedId === runId) { setSelectedId(null); setReport(null); setSteps([]); setSources([]); }
    refreshRuns();
  }

  async function exportReport(format: 'md' | 'html') {
    if (!selectedId) return;
    const r = await window.dawn.research.export(selectedId, format);
    if (!r.ok) { setMessage(r.error || 'Nothing to export yet.'); return; }
    const blob = new Blob([r.content], { type: format === 'html' ? 'text/html' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = r.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const webWanted = sourceMode === 'web' || sourceMode === 'both';

  return (
    <div className="h-full flex">
      {/* Runs history */}
      <div className="w-56 shrink-0 border-r border-border bg-bg/40 flex flex-col">
        <div className="p-3">
          <button onClick={() => { setShowForm(true); setSelectedId(null); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border"
            style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}>
            <Plus size={15} /> New research
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {runs.map((r) => (
            <div key={r.id} onClick={() => selectRun(r.id)}
              className={`group px-2.5 py-2 rounded-lg cursor-pointer text-xs ${selectedId === r.id ? 'bg-panel2/70' : 'hover:bg-panel/50'}`}>
              <div className="flex items-start gap-1.5">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(r.status).replace('text-', 'bg-')}`} />
                <span className="flex-1 text-dim leading-snug line-clamp-2">{r.question}</span>
                <button onClick={(e) => { e.stopPropagation(); remove(r.id); }} className="opacity-0 group-hover:opacity-100 text-faint hover:text-neural-red"><Trash2 size={12} /></button>
              </div>
              <div className="text-[10px] text-faint mt-0.5 ml-3">{r.depth} · {r.source_mode} · <span className={statusColor(r.status)}>{r.status}</span></div>
            </div>
          ))}
          {!runs.length ? <div className="text-[11px] text-faint text-center py-6">No research runs yet.</div> : null}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 max-w-3xl mx-auto">
          <div className="flex items-center gap-2 mb-1">
            <Telescope size={18} style={{ color: 'var(--accent)' }} />
            <h1 className="text-xl font-bold">Deep Research</h1>
          </div>
          <p className="text-sm text-dim mb-4">DAWN plans, gathers multiple sources, checks reliability and contradictions, then writes a cited report — all on your local model.</p>

          {/* New-run form */}
          {showForm || !selectedId ? (
            <div className="glass p-4 mb-5">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start(); }}
                rows={2}
                placeholder="Ask a research question…  e.g. compare RTX 4080 Super vs RTX 5090 for local LLMs"
                className="w-full resize-none bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
              <div className="grid md:grid-cols-3 gap-3 mt-3">
                <Field label="Depth">
                  <select value={depth} onChange={(e) => setDepth(e.target.value as Depth)} className="w-full bg-bg border border-border rounded-lg px-2 py-1.5 text-xs">
                    {DEPTHS.map(([v, l, h]) => <option key={v} value={v}>{l} — {h}</option>)}
                  </select>
                </Field>
                <Field label="Sources">
                  <select value={sourceMode} onChange={(e) => setSourceMode(e.target.value as SourceMode)} className="w-full bg-bg border border-border rounded-lg px-2 py-1.5 text-xs">
                    {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Model">
                  <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-bg border border-border rounded-lg px-2 py-1.5 text-xs">
                    <option value="auto">Auto (loaded model)</option>
                    {models.map((m) => <option key={m.path} value={m.path}>{m.name}</option>)}
                  </select>
                </Field>
              </div>

              {webWanted && !allowWeb ? (
                <div className="mt-3 text-[11px] text-neural-amber flex items-start gap-1.5">
                  <Shield size={13} className="mt-0.5 shrink-0" />
                  Web research is off by default. Enable it in <b>Settings → Research</b> to fetch web sources. Local-knowledge mode works offline.
                </div>
              ) : null}

              <div className="mt-3 flex items-center gap-2">
                <button onClick={start} disabled={!question.trim() || running}
                  className="text-sm px-4 py-2 rounded-lg border font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
                  style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>
                  <Search size={15} /> Start research
                </button>
                <span className="text-[11px] text-faint">Ctrl/⌘+Enter</span>
              </div>
            </div>
          ) : null}

          {/* Active run controls + progress */}
          {selectedId ? (
            <>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className={`text-xs font-mono px-2 py-1 rounded-full border border-border ${statusColor(status)}`}>{status || '—'}</span>
                {running ? (
                  <>
                    {paused
                      ? <button onClick={resume} className="text-xs px-2.5 py-1 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1"><Play size={12} /> Resume</button>
                      : <button onClick={pause} className="text-xs px-2.5 py-1 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1"><Pause size={12} /> Pause</button>}
                    <button onClick={cancel} className="text-xs px-2.5 py-1 rounded-lg border border-neural-red/50 text-neural-red inline-flex items-center gap-1"><Square size={12} /> Cancel</button>
                  </>
                ) : null}
                {report ? (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={() => exportReport('md')} className="text-xs px-2.5 py-1 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1"><Download size={12} /> .md</button>
                    <button onClick={() => exportReport('html')} className="text-xs px-2.5 py-1 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1"><Download size={12} /> .html</button>
                  </div>
                ) : null}
              </div>

              {running ? (
                <div className="mb-4">
                  <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                    <div className="h-full transition-all" style={{ width: `${percent}%`, background: 'var(--accent)' }} />
                  </div>
                  <div className="text-[11px] text-faint mt-1 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> {message}</div>
                </div>
              ) : null}

              {/* Report */}
              {report ? (
                <div className="glass p-5 mb-5">
                  <div className="text-sm leading-relaxed">
                    <Markdown>{report.content_md}</Markdown>
                  </div>
                </div>
              ) : null}

              {/* Sources */}
              {sources.length ? (
                <div className="mb-5">
                  <div className="hud-label mb-2">Sources ({sources.length})</div>
                  <div className="space-y-2">
                    {sources.map((s) => (
                      <div key={s.id} className="glass p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate flex items-center gap-1.5">
                              {s.citation_label ? <span className="text-faint font-mono text-xs">{s.citation_label}</span> : null}
                              {s.title || s.domain || 'Source'}
                            </div>
                            <div className="text-[11px] text-faint truncate">
                              {s.source_type === 'web' ? (s.domain || s.url) : `${s.source_type} · ${s.local_ref || ''}`}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            <span className={`text-[11px] ${relColor(s.reliability ?? s.reliability_score ?? 0.5)}`}>{Math.round((s.reliability ?? s.reliability_score ?? 0.5) * 100)}%</span>
                            {s.status === 'error'
                              ? <AlertTriangle size={13} className="text-neural-red" />
                              : <CheckCircle2 size={13} className="text-neural-green" />}
                            {s.url ? <button onClick={() => window.dawn.openExternal(s.url)} className="text-faint hover:text-neural-cyan" title="Open source"><ExternalLink size={13} /></button> : null}
                          </div>
                        </div>
                        {s.summary ? <div className="text-xs text-dim mt-1.5 line-clamp-3">{s.summary}</div> : null}
                        {s.status === 'error' ? <div className="text-[11px] text-neural-red mt-1">Could not read: {s.error}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Contradictions */}
              {findings.filter((f) => f.kind === 'contradiction').length ? (
                <div className="mb-5">
                  <div className="hud-label mb-2 text-neural-amber">Contradictions noted</div>
                  <ul className="space-y-1 text-xs text-dim">
                    {findings.filter((f) => f.kind === 'contradiction').map((f) => (
                      <li key={f.id} className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 text-neural-amber shrink-0" />{f.claim}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Timeline */}
              <div className="mb-6">
                <div className="hud-label mb-2">Research timeline</div>
                {plan ? <div className="text-xs text-dim mb-2 italic border-l-2 border-border pl-3">{plan}</div> : null}
                <div className="space-y-1">
                  {steps.map((st, i) => (
                    <div key={st.id || i} className="flex items-start gap-2 text-xs">
                      <StepIcon status={st.status} />
                      <div className="min-w-0">
                        <span className={st.status === 'error' ? 'text-neural-red' : st.status === 'warning' ? 'text-neural-amber' : 'text-dim'}>{st.title}</span>
                        {st.detail ? <span className="text-faint"> — {truncate(st.detail, 120)}</span> : null}
                      </div>
                    </div>
                  ))}
                  {!steps.length && !running ? <div className="text-[11px] text-faint">Select a run or start a new one.</div> : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 size={12} className="text-neural-cyan animate-spin mt-0.5 shrink-0" />;
  if (status === 'error') return <AlertTriangle size={12} className="text-neural-red mt-0.5 shrink-0" />;
  if (status === 'warning') return <AlertTriangle size={12} className="text-neural-amber mt-0.5 shrink-0" />;
  if (status === 'done') return <CheckCircle2 size={12} className="text-neural-green mt-0.5 shrink-0" />;
  return <Sparkles size={12} className="text-faint mt-0.5 shrink-0" />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-faint">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function upsert(list: any[], item: any) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = list.slice();
  next[i] = { ...next[i], ...item };
  return next;
}
function truncate(s: string, n: number) { return (s || '').length > n ? s.slice(0, n - 1) + '…' : (s || ''); }
