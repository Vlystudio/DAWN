import React, { useEffect, useState } from 'react';
import { Gauge, PlayCircle, Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * RetrievalPanel — safe, honest view of DAWN's retrieval quality stack in Local Knowledge: reranker
 * mode + the in-app RAG eval (embedded fixture) with a Run button. All data comes from window.dawn.rag.*;
 * only safe metadata (modes, metrics) is shown — no paths, chunk text, or secrets.
 */
export default function RetrievalPanel() {
  const [rerank, setRerank] = useState<any>(null);
  const [evalStatus, setEvalStatus] = useState<any>(null);
  const [reindex, setReindex] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    window.dawn.rag.rerankerStatus().then(setRerank).catch(() => {});
    window.dawn.rag.evalStatus().then(setEvalStatus).catch(() => {});
    window.dawn.rag.reindexInfo().then(setReindex).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  async function runEval() {
    setBusy('eval');
    try { await window.dawn.rag.runEval(); } catch { /* */ }
    setBusy(''); load();
  }
  async function doReindex() {
    setBusy('reindex'); setMsg('');
    try { const r = await window.dawn.rag.reindexOutdated(); setMsg(`Reindexed ${r.reindexed}${r.skipped ? `, skipped ${r.skipped}` : ''}${r.failed ? `, failed ${r.failed}` : ''}.`); } catch { setMsg('Reindex failed.'); }
    setBusy(''); load();
  }

  const sum = evalStatus?.summary;
  return (
    <div className="text-[11px] mb-3 border border-border/60 rounded-lg p-2.5 bg-panel/20">
      <div className="flex items-center gap-1.5 mb-1.5"><Gauge size={12} style={{ color: 'var(--accent)' }} /><span className="text-dim font-medium">Retrieval quality</span></div>
      {rerank ? (
        <div className="text-faint">
          Reranker: <span className="text-dim">{rerank.label}</span>{rerank.reason ? <span className="text-faint"> — {rerank.reason}</span> : null}
          {rerank.providerStatus ? (
            <span className="text-faint">
              {' · '}{rerank.providerStatus.scoreType?.replace('_', ' ')}
              {rerank.providerStatus.id === 'gguf_reranker' && !rerank.providerStatus.ready
                ? <span className="text-neural-amber"> · GGUF unavailable ({(rerank.providerStatus.unavailableReason || '').replace(/^unavailable_/, '').replace(/_/g, ' ')}) → falls back to {String(rerank.providerStatus.fallbackProvider || '').replace('_', ' ')}</span>
                : rerank.providerStatus.id === 'gguf_reranker'
                  ? <span className="text-neural-green"> · GGUF cross-encoder ready</span>
                  : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {reindex ? (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-faint">Chunking: <span className="text-dim">{reindex.strategyVersion}</span></span>
          {reindex.needReindex > 0
            ? <><span className="text-neural-amber">{reindex.needReindex} source(s) on old chunking</span>
                <button onClick={doReindex} disabled={!!busy} className="ml-auto px-2 py-0.5 rounded border border-border text-dim hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">
                  {busy === 'reindex' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Reindex to {reindex.strategyVersion}
                </button></>
            : <span className="text-neural-green inline-flex items-center gap-1"><Check size={11} /> all sources current</span>}
        </div>
      ) : null}

      <div className="flex items-center gap-2 mt-2">
        <span className="text-faint">RAG eval:</span>
        {evalStatus?.hasRun && sum ? (
          <span className="text-dim inline-flex items-center gap-1.5">
            {sum.negativesLeaked > 0 ? <AlertTriangle size={11} className="text-neural-red" /> : <Check size={11} className="text-neural-green" />}
            hit-rate {sum.retrievalHitRate ?? 'n/a'} · groundedness {sum.meanGroundedness ?? 'n/a'} · {sum.valid}/{sum.cases} valid · negatives leaked {sum.negativesLeaked}
          </span>
        ) : (
          <span className="text-faint">not run yet ({evalStatus?.fixtureCount ?? 0}-case embedded fixture)</span>
        )}
        <button onClick={runEval} disabled={!!busy} className="ml-auto px-2 py-0.5 rounded border border-border text-dim hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">
          {busy === 'eval' ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />} Run eval
        </button>
      </div>

      {evalStatus?.strategies?.strategies ? (
        <div className="mt-1.5 border-t border-border/40 pt-1.5">
          <div className="text-faint mb-0.5">Strategy comparison{evalStatus.strategies.best ? <span> · best: <span className="text-dim">{evalStatus.strategies.best}</span></span> : null}</div>
          {evalStatus.strategies.strategies.map((st: any) => (
            <div key={st.strategy} className="flex items-center gap-2">
              <span className="w-32 truncate text-dim">{st.strategy}</span>
              {st.available
                ? <span className="text-neural-green">hit {st.retrievalHitRate} · top1 {st.top1HitRate}</span>
                : <span className="text-faint">unavailable — {st.reason}</span>}
            </div>
          ))}
        </div>
      ) : null}

      {msg ? <div className="text-neural-cyan mt-1">{msg}</div> : null}
      <div className="text-[10px] text-faint mt-1">Deterministic, offline (embedded public fixture) — no model, no network, no your-files scanned. Full set: <code>npm run eval:rag</code>.</div>
    </div>
  );
}
