import React, { useEffect, useState } from 'react';
import { FlaskConical, PlayCircle, Loader2, Check, AlertTriangle, Trash2, Download, Save } from 'lucide-react';

/**
 * LiveEvalPanel — evaluate DAWN's retrieval strategies against the user's ACTUAL local index, and benchmark
 * whether the GGUF reranker improves ranking over embedding-similarity + baseline hybrid. Honest by
 * construction: shows a preflight (what can run + why each strategy is unavailable), never fabricates a
 * "best" when only one strategy ran or samples are too few, and displays ids/metrics only — never chunk or
 * source text. All data comes from window.dawn.rag.eval.* (local-only).
 */
type QuerySetMode = 'metadata' | 'golden' | 'user';

const STRAT_LABEL: Record<string, string> = {
  keyword: 'Keyword', vector: 'Vector', hybrid: 'Hybrid', rewrite_hybrid: 'Rewrite+Hybrid', hyde_vector: 'HyDE+Vector',
  hyde_hybrid: 'HyDE+Hybrid', embedding_rerank: 'Embed-rerank (kw)', gguf_rerank: 'GGUF-rerank (kw)',
  hybrid_embedding_rerank: 'Hybrid+Embed-rerank', hybrid_gguf_rerank: 'Hybrid+GGUF-rerank',
  rewrite_hybrid_rerank: 'Rewrite+Hybrid+rerank', hyde_hybrid_rerank: 'HyDE+Hybrid+rerank',
};

function fmt(x: any) { return x === null || x === undefined ? '—' : typeof x === 'number' ? x.toFixed(2) : String(x); }
function pctReason(r?: string) { return String(r || '').replace(/^unavailable_/, '').replace(/_/g, ' '); }

export default function LiveEvalPanel() {
  const [pre, setPre] = useState<any>(null);
  const [st, setSt] = useState<any>(null);
  const [mode, setMode] = useState<QuerySetMode>('metadata');
  const [maxQ, setMaxQ] = useState(20);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [userText, setUserText] = useState('');
  const [golden, setGolden] = useState<any[]>([]);
  const [gForm, setGForm] = useState({ query: '', expectedSourceId: '', expectedChunkId: '', label: '' });

  const loadPre = () => window.dawn.rag.eval.preflightLive().then(setPre).catch(() => {});
  const loadSt = () => window.dawn.rag.eval.liveStatus().then(setSt).catch(() => {});
  const loadGolden = () => window.dawn.rag.eval.listGoldenItems().then(setGolden).catch(() => {});
  useEffect(() => { loadPre(); loadSt(); loadGolden(); }, []);

  function userQueries() {
    return userText.split('\n').map((l) => l.trim()).filter(Boolean).map((q) => {
      const [query, sid, cid] = q.split('|').map((x) => x.trim());
      return { query, expectedSourceId: sid || undefined, expectedChunkId: cid || undefined };
    });
  }

  async function runLive() {
    setBusy('live'); setMsg('');
    try { const r = await window.dawn.rag.eval.live({ querySetMode: mode, queries: mode === 'user' ? userQueries() : undefined, maxQueries: maxQ }); if (!r?.ok) setMsg(r?.error || 'Live eval could not run.'); } catch { setMsg('Live eval failed.'); }
    setBusy(''); loadSt();
  }
  async function runBench() {
    setBusy('bench'); setMsg('');
    try { const r = await window.dawn.rag.eval.rerankerBenchmark({ querySetMode: mode, queries: mode === 'user' ? userQueries() : undefined, maxQueries: maxQ }); if (!r?.ok) setMsg(r?.error || 'Benchmark could not run.'); } catch { setMsg('Benchmark failed.'); }
    setBusy(''); loadSt();
  }
  async function saveGolden() {
    if (!gForm.query.trim()) { setMsg('A golden item needs a query.'); return; }
    setBusy('golden'); try { await window.dawn.rag.eval.saveGoldenItem(gForm); setGForm({ query: '', expectedSourceId: '', expectedChunkId: '', label: '' }); } catch { /* */ } setBusy(''); loadGolden();
  }
  async function delGolden(id: string) { setBusy('golden'); try { await window.dawn.rag.eval.deleteGoldenItem(id); } catch { /* */ } setBusy(''); loadGolden(); }
  async function clearLive() { setBusy('clear'); try { await window.dawn.rag.eval.clearLiveResult(); } catch { /* */ } setBusy(''); loadSt(); }
  async function exportSafe() { setBusy('export'); setMsg(''); try { const r = await window.dawn.rag.eval.exportSafeEval(); if (r?.ok) setMsg(`Exported ${r.path}`); } catch { /* */ } setBusy(''); }

  const live = st?.live; const bench = st?.benchmark;
  const bestLabel = (q: string, label: string | null) => q === 'best_available' ? `best available: ${label}` : q === 'only_available' ? `only available strategy: ${label}` : q === 'insufficient_samples' ? 'insufficient samples for a "best"' : q === 'unlabeled' ? 'no labeled queries (coverage only)' : 'no ranking';

  return (
    <div className="text-[11px] mb-3 border border-border/60 rounded-lg p-2.5 bg-panel/20">
      <div className="flex items-center gap-1.5 mb-1.5"><FlaskConical size={12} style={{ color: 'var(--accent)' }} /><span className="text-dim font-medium">Live-index eval + reranker benchmark</span></div>

      {/* Preflight */}
      {pre ? (
        <div className="border border-border/40 rounded p-2 mb-2">
          <div className="flex items-center gap-2">
            {pre.canRunLive ? <Check size={11} className="text-neural-green" /> : <AlertTriangle size={11} className="text-neural-amber" />}
            <span className={pre.canRunLive ? 'text-dim' : 'text-neural-amber'}>{pre.canRunReason}</span>
          </div>
          <div className="text-faint mt-1">
            Index: {pre.index.availableSources} source(s) · {pre.index.chunks} chunk(s) · {pre.index.embeddedChunks} embedded{pre.index.excludedSources ? ` · ${pre.index.excludedSources} excluded` : ''}{pre.index.outdatedSources ? ` · ${pre.index.outdatedSources} outdated` : ''}
            {pre.index.embedModel ? <span> · embed: {pre.index.embedModel}</span> : null}
          </div>
          <div className="text-faint">
            Reranker: <span className={pre.providers.reranker.ready ? 'text-neural-green' : 'text-faint'}>{pre.providers.reranker.ready ? 'GGUF ready' : `${pre.providers.reranker.provider}${pre.providers.reranker.unavailableReason && pre.providers.reranker.unavailableReason !== 'none' ? ` (${pctReason(pre.providers.reranker.unavailableReason)})` : ''}`}</span>
            {' · '}Helper: {pre.providers.helper.rewriteProvider || 'none'} · {pre.eligibleCount}/{pre.strategies.length} strategies eligible
          </div>
        </div>
      ) : null}

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-faint">Query set</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as QuerySetMode)} className="bg-panel2/60 border border-border rounded px-1.5 py-0.5 text-ink">
          <option value="metadata">Metadata-generated</option>
          <option value="golden">Golden set ({golden.length})</option>
          <option value="user">User-provided</option>
        </select>
        <span className="text-faint">max</span>
        <input type="number" value={maxQ} min={1} max={100} onChange={(e) => setMaxQ(Math.max(1, Math.min(100, Number(e.target.value) || 20)))} className="w-14 bg-panel2/60 border border-border rounded px-1.5 py-0.5 text-ink" />
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={runLive} disabled={!!busy || !pre?.canRunLive} className="px-2 py-0.5 rounded border border-border text-dim hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">{busy === 'live' ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />} Run live eval</button>
          <button onClick={runBench} disabled={!!busy || !pre?.canRunLive || !pre?.index.embeddingsAvailable} title={pre?.index.embeddingsAvailable ? '' : 'Needs embeddings'} className="px-2 py-0.5 rounded border border-border text-dim hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">{busy === 'bench' ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} />} Reranker benchmark</button>
        </div>
      </div>

      {mode === 'user' ? (
        <textarea value={userText} onChange={(e) => setUserText(e.target.value)} placeholder="One query per line. Optional expected ids: query | expectedSourceId | expectedChunkId" className="w-full h-16 bg-panel2/60 border border-border rounded px-2 py-1 text-ink text-[11px] mb-2" />
      ) : null}

      {mode === 'golden' ? (
        <div className="border border-border/40 rounded p-2 mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <input value={gForm.query} onChange={(e) => setGForm({ ...gForm, query: e.target.value })} placeholder="golden query" className="flex-1 min-w-[140px] bg-panel2/60 border border-border rounded px-1.5 py-0.5 text-ink" />
            <input value={gForm.expectedSourceId} onChange={(e) => setGForm({ ...gForm, expectedSourceId: e.target.value })} placeholder="expected source id" className="w-32 bg-panel2/60 border border-border rounded px-1.5 py-0.5 text-ink" />
            <input value={gForm.expectedChunkId} onChange={(e) => setGForm({ ...gForm, expectedChunkId: e.target.value })} placeholder="expected chunk id" className="w-32 bg-panel2/60 border border-border rounded px-1.5 py-0.5 text-ink" />
            <button onClick={saveGolden} disabled={!!busy} className="px-2 py-0.5 rounded border border-border text-dim hover:text-ink inline-flex items-center gap-1"><Save size={11} /> Save</button>
          </div>
          {golden.length ? (
            <div className="mt-1.5 space-y-0.5 max-h-24 overflow-auto">
              {golden.map((g) => (
                <div key={g.id} className="flex items-center gap-2 text-faint">
                  <span className="truncate flex-1 text-dim">{g.query}</span>
                  {g.expectedChunkId ? <span className="truncate max-w-[90px]">chunk {g.expectedChunkId.slice(0, 8)}</span> : g.expectedSourceId ? <span className="truncate max-w-[90px]">src {g.expectedSourceId.slice(0, 8)}</span> : <span className="text-neural-amber">no label</span>}
                  <button onClick={() => delGolden(g.id)} className="text-faint hover:text-neural-red"><Trash2 size={11} /></button>
                </div>
              ))}
            </div>
          ) : <div className="text-faint mt-1">No golden items yet — safe fields only (query + expected ids), no chunk text.</div>}
        </div>
      ) : null}

      {msg ? <div className="text-neural-amber mb-2">{msg}</div> : null}

      {/* Live strategy table */}
      {live?.summary ? (
        <div className="border-t border-border/40 pt-1.5 mb-2">
          <div className="text-faint mb-0.5">
            Live strategy eval · {live.summary.totalQueries} quer{live.summary.totalQueries === 1 ? 'y' : 'ies'} ({live.summary.labeledQueries} labeled) · {live.summary.ranStrategies} ran / {live.summary.unavailableStrategies} unavailable
            <span className="text-dim"> · {bestLabel(live.summary.bestQualifier, live.summary.bestLabel)}</span>
          </div>
          <div className="grid grid-cols-7 gap-1 text-faint text-[10px]"><span className="col-span-2">strategy</span><span>status</span><span>hit</span><span>MRR</span><span>top3</span><span>nDCG</span></div>
          {live.summary.strategies.map((s: any) => (
            <div key={s.strategy} className="grid grid-cols-7 gap-1 text-dim">
              <span className="col-span-2 truncate" title={s.label}>{STRAT_LABEL[s.strategy] || s.strategy}</span>
              <span className={s.status === 'ran' ? 'text-neural-green' : s.status === 'unavailable' ? 'text-faint' : 'text-neural-amber'} title={s.unavailableReason || ''}>{s.status}{s.rerankerFallbackCount ? '*' : ''}</span>
              <span>{s.status === 'ran' ? fmt(s.hitRate) : '—'}</span>
              <span>{s.status === 'ran' ? fmt(s.mrr) : '—'}</span>
              <span>{s.status === 'ran' ? fmt(s.top3) : '—'}</span>
              <span>{s.status === 'ran' ? fmt(s.ndcg) : '—'}</span>
            </div>
          ))}
          <div className="text-[10px] text-faint mt-0.5">hit/MRR/nDCG over labeled queries only. * = a reranker fallback was used. Unavailable rows keep their reason (hover status).</div>
        </div>
      ) : null}

      {/* Reranker benchmark */}
      {bench?.summary ? (
        <div className="border-t border-border/40 pt-1.5 mb-2">
          <div className="text-faint mb-0.5">Reranker benchmark · {bench.summary.queries} quer{bench.summary.queries === 1 ? 'y' : 'ies'} · GGUF {bench.summary.ggufRanCount} ran / {bench.summary.ggufUnavailableCount} unavailable / {bench.summary.ggufTimeoutCount} timeout</div>
          <div className="grid grid-cols-6 gap-1 text-faint text-[10px]"><span>order</span><span>MRR</span><span>top1</span><span>top3</span><span>nDCG</span><span>lift</span></div>
          <div className="grid grid-cols-6 gap-1 text-dim"><span>baseline</span><span>{fmt(bench.summary.baseline.mrr)}</span><span>{fmt(bench.summary.baseline.top1)}</span><span>{fmt(bench.summary.baseline.top3)}</span><span>{fmt(bench.summary.baseline.ndcg)}</span><span>—</span></div>
          <div className="grid grid-cols-6 gap-1 text-dim"><span>embedding</span><span>{fmt(bench.summary.embedding.mrr)}</span><span>{fmt(bench.summary.embedding.top1)}</span><span>{fmt(bench.summary.embedding.top3)}</span><span>{fmt(bench.summary.embedding.ndcg)}</span><span className={bench.summary.embeddingLift === 'improves' ? 'text-neural-green' : bench.summary.embeddingLift === 'worsens' ? 'text-neural-red' : 'text-faint'}>{bench.summary.embeddingLift.replace('_', ' ')}</span></div>
          <div className="grid grid-cols-6 gap-1 text-dim">
            <span>GGUF</span>
            {bench.summary.gguf ? <>
              <span>{fmt(bench.summary.gguf.mrr)}</span><span>{fmt(bench.summary.gguf.top1)}</span><span>{fmt(bench.summary.gguf.top3)}</span><span>{fmt(bench.summary.gguf.ndcg)}</span>
              <span className={bench.summary.ggufLift === 'improves' ? 'text-neural-green' : bench.summary.ggufLift === 'worsens' ? 'text-neural-red' : 'text-faint'} title={bench.summary.ggufLiftReason || ''}>{bench.summary.ggufLift.replace('_', ' ')}</span>
            </> : <span className="col-span-5 text-faint" title={bench.summary.ggufLiftReason || ''}>unavailable — {bench.summary.ggufLiftReason || 'GGUF reranker did not run'}</span>}
          </div>
          {bench.summary.gguf ? <div className="text-[10px] text-faint mt-0.5">Rank movement (GGUF vs baseline): {bench.summary.rankMovement.gguf?.improved} improved · {bench.summary.rankMovement.gguf?.worsened} worsened · {bench.summary.rankMovement.gguf?.unchanged} unchanged · avg Δ {fmt(bench.summary.rankMovement.gguf?.avg)}. GGUF avg {fmt(bench.summary.latency.ggufAvgMs)}ms / p95 {fmt(bench.summary.latency.ggufP95Ms)}ms.</div> : null}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 flex-wrap border-t border-border/40 pt-1.5">
        <button onClick={exportSafe} disabled={!!busy} className="px-2 py-0.5 rounded border border-border text-faint hover:text-ink inline-flex items-center gap-1"><Download size={11} /> Export safe JSON</button>
        <button onClick={clearLive} disabled={!!busy} className="px-2 py-0.5 rounded border border-border text-faint hover:text-neural-red inline-flex items-center gap-1"><Trash2 size={11} /> Clear last live eval</button>
        <span className="text-[10px] text-faint ml-auto">Local-only · ids + metrics only, never chunk/source text. Does not modify your index.</span>
      </div>
    </div>
  );
}
