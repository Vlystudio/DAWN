import React, { useEffect, useState } from 'react';
import { Layers, FolderOpen, Power, PlayCircle, Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * RerankerRuntimePanel — configure + control DAWN's reranker provider, including the OPTIONAL real local
 * GGUF cross-encoder (a dedicated llama-server --reranking). Honest by construction: "ready" only shows when
 * the /rerank endpoint has actually returned a well-formed relevance score. No cross-encoder is ever claimed
 * when the endpoint isn't proven; unavailable states show the exact reason. Full model paths never cross the
 * bridge (only the file name). Local-only — no cloud, no telemetry.
 */
type ProviderStatus = {
  id: string; displayName: string; ready: boolean; statusLabel: string; unavailableReason: string;
  scoreType: string; scoreSemantics: string; modelSummary: string; endpoint: string | null;
  lastTestOk: boolean | null; lastTestLatencyMs: number | null; lastError: string | null; fallbackProvider: string;
};
type Runtime = {
  state: string; enabled: boolean; configured: boolean; running: boolean; reachable: boolean;
  endpointSupported: boolean | null; apiReason: string; modelName: string; port: number; endpoint: string | null;
  error: string | null; installed: boolean; keepWarm: boolean; lastTestSane: boolean | null; queue?: any;
};
type Status = {
  providerStatus: ProviderStatus; runtime: Runtime; plan: any; topKInput: number; topKOutput: number;
};

const PROVIDERS = [
  { id: 'embedding_similarity', label: 'Embedding similarity (ready, local)' },
  { id: 'gguf_reranker', label: 'GGUF reranker (local cross-encoder)' },
  { id: 'heuristic', label: 'Heuristic (hybrid RRF order)' },
  { id: 'disabled', label: 'Disabled' },
];

function reasonText(r: string): string {
  switch (r) {
    case 'none': return '';
    case 'unavailable_needs_setup': return 'needs setup — choose a reranker model';
    case 'unavailable_model_missing': return 'reranker model file missing';
    case 'unavailable_runtime_missing': return 'llama-server runtime missing';
    case 'unavailable_runtime_not_ready': return 'runtime not running / not reachable';
    case 'unavailable_runtime_unsupported': return 'this llama-server build does not support reranking';
    case 'unavailable_api_not_supported': return 'server reachable but /rerank endpoint not supported';
    case 'unavailable_server_error': return 'reranker returned a malformed / error response';
    case 'unavailable_timeout': return 'reranker timed out';
    default: return r || '';
  }
}

function ProviderBadge({ ps }: { ps: ProviderStatus }) {
  const label = ps.ready ? 'Ready' : ps.statusLabel === 'DISABLED' ? 'Disabled' : ps.statusLabel === 'NEEDS_SETUP' ? 'Needs setup' : 'Unavailable';
  const cls = ps.ready ? 'text-neural-green border-neural-green/40 bg-neural-green/10'
    : ps.statusLabel === 'DISABLED' ? 'text-faint border-border bg-panel2/40'
    : ps.statusLabel === 'NEEDS_SETUP' ? 'text-neural-amber border-neural-amber/50 bg-neural-amber/10'
    : 'text-neural-red border-neural-red/50 bg-neural-red/10';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${cls}`}>{ps.ready ? <Check size={11} /> : <AlertTriangle size={11} />}{label}</span>;
}

export default function RerankerRuntimePanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<any>(null);
  const [msg, setMsg] = useState('');

  const load = () => { window.dawn.reranker.status().then(setSt).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);

  async function setProvider(provider: string) { setBusy('provider'); try { await window.dawn.reranker.updateSettings({ provider }); } catch { /* */ } setBusy(''); load(); }
  async function toggleGguf() { setBusy('toggle'); try { await window.dawn.reranker.updateSettings({ gguf: { enabled: !st?.runtime.enabled } }); } catch { /* */ } setBusy(''); load(); }
  async function toggleWarm() { setBusy('warm'); try { await window.dawn.reranker.updateSettings({ gguf: { keepWarm: !st?.runtime.keepWarm } }); } catch { /* */ } setBusy(''); load(); }
  async function pick() { setBusy('pick'); setMsg(''); const r = await window.dawn.reranker.pickModel(); if (r && !r.ok && !r.canceled) setMsg('Could not set that model.'); setBusy(''); load(); }
  async function ctl(action: 'start' | 'stop' | 'restart') { setBusy(action); try { await window.dawn.reranker[action](); } catch { /* */ } setBusy(''); load(); }
  async function runTest() { setBusy('test'); setTest(null); try { setTest(await window.dawn.reranker.test()); } catch { /* */ } setBusy(''); load(); }
  async function cancelJobs() { setBusy('cancel'); try { await window.dawn.reranker.cancelJobs(); } catch { /* */ } setBusy(''); load(); }
  async function clearQueue() { setBusy('clear'); try { await window.dawn.reranker.clearQueue(); } catch { /* */ } setBusy(''); load(); }

  if (!st) return null;
  const ps = st.providerStatus, rt = st.runtime;
  const isGguf = ps.id === 'gguf_reranker';

  return (
    <div className="rounded-lg border border-border bg-panel/20 p-4 mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Layers size={16} style={{ color: 'var(--accent)' }} />
        <h3 className="text-sm font-semibold">Reranker</h3>
        <ProviderBadge ps={ps} />
        <span className="ml-auto text-[11px] text-faint">{ps.scoreType.replace('_', ' ')} · {ps.scoreSemantics}</span>
      </div>
      <p className="text-[11px] text-dim mb-3">Reorders retrieved candidates. Embedding-similarity is the ready local default; the GGUF reranker is an optional real local cross-encoder (a dedicated llama-server <code>--reranking</code>). No cross-encoder is claimed unless its /rerank endpoint truly works — otherwise it falls back honestly to embedding similarity.</p>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-[11px] text-faint">Provider</span>
        <select value={ps.id} onChange={(e) => setProvider(e.target.value)} disabled={!!busy} className="text-xs bg-panel2/60 border border-border rounded-lg px-2 py-1 text-ink">
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {!ps.ready && ps.unavailableReason !== 'none' ? <span className="text-[11px] text-neural-amber">— {reasonText(ps.unavailableReason)}{ps.id === 'gguf_reranker' ? ` · falls back to ${ps.fallbackProvider.replace('_', ' ')}` : ''}</span> : null}
      </div>

      {isGguf ? (
        <div className="border-t border-border/40 pt-3">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <button onClick={toggleGguf} disabled={!!busy} className={`text-xs px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 disabled:opacity-40 ${rt.enabled ? 'border-neural-green/50 text-neural-green' : 'border-border text-dim hover:text-ink'}`}>{busy === 'toggle' ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />} {rt.enabled ? 'Enabled' : 'Enable GGUF'}</button>
            <button onClick={pick} disabled={!!busy} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5"><FolderOpen size={13} /> Model</button>
            <span className={`text-[11px] truncate max-w-[200px] ${rt.configured ? 'text-ink' : 'text-faint'}`}>{rt.modelName || 'not set'}</span>
            <span className="text-[11px] text-faint">port {rt.port}{rt.installed ? '' : ' · runtime binary missing'}</span>
            {rt.enabled ? (
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={() => ctl('restart')} disabled={!!busy} title="Restart" className="p-1.5 rounded-lg border border-border text-faint hover:text-ink">{busy === 'restart' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}</button>
                {rt.running ? <button onClick={() => ctl('stop')} disabled={!!busy} className="text-xs px-2 py-1.5 rounded-lg border border-border text-dim hover:text-neural-red">Stop</button>
                  : <button onClick={() => ctl('start')} disabled={!!busy} className="text-xs px-2 py-1.5 rounded-lg border border-border text-dim hover:text-ink">Start</button>}
                <button onClick={runTest} disabled={!!busy || !rt.reachable} title={rt.reachable ? 'Synthetic reranking probe (public text only)' : 'Runtime not reachable'} className="text-xs px-2 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">{busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />} Test</button>
              </div>
            ) : null}
          </div>

          <div className="text-[11px] text-faint mb-2">
            Endpoint: {rt.endpointSupported === true ? <span className="text-neural-green">/rerank supported</span> : rt.endpointSupported === false ? <span className="text-neural-red">not supported ({reasonText(rt.apiReason)})</span> : <span className="text-faint">not yet verified</span>}
            {rt.error ? <span className="text-neural-red"> · {rt.error}</span> : null}
            <span className="text-faint"> · topK in {st.topKInput} → out {st.topKOutput}</span>
          </div>

          {test ? (
            <div className={`text-[11px] mb-2 ${test.ok ? 'text-neural-green' : 'text-neural-amber'}`}>
              {test.ok ? <><Check size={11} className="inline mb-0.5" /> OK · {test.latencyMs}ms · relevant&gt;irrelevant: {test.sane === true ? 'yes' : test.sane === false ? 'no' : 'n/a'}{test.scores ? ` · A ${test.scores.a} / B ${test.scores.b}` : ''}</> : <><AlertTriangle size={11} className="inline mb-0.5" /> {test.error}</>}
            </div>
          ) : null}

          {rt.enabled && rt.queue ? (
            <div className="text-[11px] flex items-center gap-2 flex-wrap">
              <span className="text-faint">Queue:</span>
              <span className="text-dim">{rt.queue.active} active · {rt.queue.queued} queued / {rt.queue.capacity} · 1 at a time</span>
              <span className="text-faint">· done {rt.queue.sessionCompleted} · cancelled {rt.queue.sessionCancelled} · timeouts {rt.queue.sessionTimedOut}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={toggleWarm} disabled={!!busy} title="Keep the reranker loaded vs. stop when idle" className={`px-2 py-0.5 rounded border ${rt.keepWarm ? 'border-neural-cyan/50 text-neural-cyan' : 'border-border text-faint hover:text-ink'}`}>Keep warm: {rt.keepWarm ? 'on' : 'off'}</button>
                <button onClick={cancelJobs} disabled={!!busy} className="px-2 py-0.5 rounded border border-border text-faint hover:text-neural-red">Cancel jobs</button>
                <button onClick={clearQueue} disabled={!!busy} className="px-2 py-0.5 rounded border border-border text-faint hover:text-ink">Clear</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-[11px] text-faint border-t border-border/40 pt-2">Embedding-similarity rerank uses your local embeddings — no separate runtime needed. Choose <span className="text-dim">GGUF reranker</span> to set up a real local cross-encoder.</div>
      )}

      {msg ? <div className="text-[11px] text-neural-amber mt-2">{msg}</div> : null}
    </div>
  );
}
