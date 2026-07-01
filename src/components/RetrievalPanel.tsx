import React, { useEffect, useState } from 'react';
import { Gauge, PlayCircle, Loader2, Check, AlertTriangle } from 'lucide-react';

/**
 * RetrievalPanel — safe, honest view of DAWN's retrieval quality stack in Local Knowledge: reranker
 * mode + the in-app RAG eval (embedded fixture) with a Run button. All data comes from window.dawn.rag.*;
 * only safe metadata (modes, metrics) is shown — no paths, chunk text, or secrets.
 */
export default function RetrievalPanel() {
  const [rerank, setRerank] = useState<any>(null);
  const [evalStatus, setEvalStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    window.dawn.rag.rerankerStatus().then(setRerank).catch(() => {});
    window.dawn.rag.evalStatus().then(setEvalStatus).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  async function runEval() {
    setBusy(true);
    try { await window.dawn.rag.runEval(); } catch { /* */ }
    setBusy(false);
    load();
  }

  const sum = evalStatus?.summary;
  return (
    <div className="text-[11px] mb-3 border border-border/60 rounded-lg p-2.5 bg-panel/20">
      <div className="flex items-center gap-1.5 mb-1.5"><Gauge size={12} style={{ color: 'var(--accent)' }} /><span className="text-dim font-medium">Retrieval quality</span></div>
      {rerank ? (
        <div className="text-faint">Reranker: <span className="text-dim">{rerank.label}</span>{rerank.reason ? <span className="text-faint"> — {rerank.reason}</span> : null}</div>
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
        <button onClick={runEval} disabled={busy} className="ml-auto px-2 py-0.5 rounded border border-border text-dim hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />} Run eval
        </button>
      </div>
      <div className="text-[10px] text-faint mt-1">Deterministic, offline (embedded public fixture) — no model, no network, no your-files scanned. Full set: <code>npm run eval:rag</code>.</div>
    </div>
  );
}
