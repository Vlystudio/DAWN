import React, { useEffect, useState } from 'react';
import {
  Library, RefreshCw, Play, RotateCw, FolderPlus, Search, MessageCircleQuestion,
  Trash2, AlertTriangle, ShieldCheck, ExternalLink, Database,
} from 'lucide-react';
import { StatusDot } from './hud';

/**
 * LocalKnowledgePanel — DAWN's surface for AgentOS local knowledge (RAG) + runtime status.
 * Everything here is LOCAL. Retrieved text is evidence, never instructions. Indexed
 * documents cannot grant permissions, change policy, or override DAWN/AgentOS. Secrets are
 * redacted server-side AND in DAWN before display; we never show raw chunk secrets.
 */

const STATE_COLOR: Record<string, string> = {
  ready: 'var(--neural-green, #34d399)',
  degraded: 'var(--neural-amber, #f59e0b)',
  using_cli_fallback: 'var(--neural-amber, #f59e0b)',
  starting: 'var(--neural-cyan, #38bdf8)',
  failed: 'var(--neural-red, #ef4444)',
  stopped: '#5b6982',
};
const STATE_LABEL: Record<string, string> = {
  ready: 'Ready', degraded: 'Degraded', using_cli_fallback: 'CLI fallback',
  starting: 'Starting…', failed: 'Failed', stopped: 'Stopped',
};

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="glass p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-dim">{label}</div>
    </div>
  );
}
function Btn({ onClick, disabled, children, title }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="px-2.5 py-1.5 rounded-md border border-border/60 bg-panel/40 hover:bg-panel2/60 disabled:opacity-40 disabled:cursor-not-allowed text-xs flex items-center gap-1.5 transition-colors">
      {children}
    </button>
  );
}

export default function LocalKnowledgePanel() {
  const ag = (window as any).dawn?.agentos;
  const [status, setStatus] = useState<any>(null);
  const [collections, setCollections] = useState<any[]>([]);
  const [emb, setEmb] = useState<any>(null);
  const [indexPath, setIndexPath] = useState<string>('');
  const [sel, setSel] = useState<string>('');
  const [sources, setSources] = useState<any[]>([]);
  const [stale, setStale] = useState<any[]>([]);
  const [busy, setBusy] = useState<string>('');
  const [note, setNote] = useState<string>('');

  // ingest
  const [ingPath, setIngPath] = useState('');
  const [ingColl, setIngColl] = useState('default');
  const [ingResult, setIngResult] = useState<string>('');

  // ask / search
  const [q, setQ] = useState('');
  const [askColl, setAskColl] = useState('default');
  const [askOut, setAskOut] = useState<string>('');

  const refreshStatus = async () => { try { setStatus(await ag.status()); } catch { /* */ } };
  const refreshCollections = async () => {
    try {
      const r = await ag.collections();
      setCollections(r?.raw?.collections || []);
      setEmb(r?.raw?.embeddings || null);
      setIndexPath(r?.raw?.db_path || '');
    } catch { /* */ }
  };

  useEffect(() => {
    if (!ag) return;
    refreshStatus();
    refreshCollections();
    const off = ag.onStatus?.((st: any) => setStatus(st));
    const t = setInterval(refreshStatus, 8000);
    return () => { off?.(); clearInterval(t); };
  }, []);

  const selectCollection = async (name: string) => {
    setSel(name); setSources([]); setStale([]);
    setIngColl(name); setAskColl(name);
    try {
      const s = await ag.sources(name); setSources(s?.raw?.sources || []);
      const st = await ag.stale(name); setStale(st?.raw?.stale || []);
    } catch { /* */ }
  };

  const doStart = async () => { setBusy('start'); setNote('Starting AgentOS…'); try { setStatus(await ag.start()); setNote('AgentOS start requested.'); await refreshCollections(); } finally { setBusy(''); } };
  const doRestart = async () => { setBusy('restart'); setNote('Restarting AgentOS…'); try { setStatus(await ag.restart()); setNote('AgentOS restarted.'); } finally { setBusy(''); } };
  const doRefresh = async () => { setBusy('refresh'); try { setStatus(await ag.refresh()); await refreshCollections(); if (sel) await selectCollection(sel); setNote('Status refreshed.'); } finally { setBusy(''); } };

  const pickIngest = async () => { const p = await ag.pickFolder(); if (p) setIngPath(p); };
  const doIngest = async () => {
    if (!ingPath.trim()) { setIngResult('Choose a folder or enter an absolute path first.'); return; }
    setBusy('ingest'); setIngResult('Indexing locally…');
    try {
      const r = await ag.ingest(ingPath.trim(), (ingColl || 'default').trim());
      setIngResult(r?.summary || JSON.stringify(r));
      await refreshCollections();
      if (sel === ingColl) await selectCollection(sel);
    } finally { setBusy(''); }
  };

  const doReindex = async () => {
    if (!sel) return;
    setBusy('reindex'); setNote(`Reindexing "${sel}" from disk…`);
    try { const r = await ag.reindex(sel); setNote(r?.summary?.split('\n').slice(1, 2).join('') || 'Reindexed.'); await selectCollection(sel); } finally { setBusy(''); }
  };
  const delSource = async (sid: string) => {
    if (!sel) return;
    setBusy('del:' + sid);
    try { await ag.deleteSource(sel, sid); await selectCollection(sel); await refreshCollections(); setNote('Removed from index (file untouched).'); } finally { setBusy(''); }
  };

  const doAsk = async (mode: 'search' | 'answer') => {
    if (!q.trim()) return;
    setBusy(mode); setAskOut('Querying local knowledge…');
    try {
      const r = mode === 'answer' ? await ag.answer(q.trim(), (askColl || 'default').trim(), 5)
        : await ag.search(q.trim(), (askColl || 'default').trim(), 5);
      setAskOut(r?.summary || JSON.stringify(r));
    } finally { setBusy(''); }
  };

  if (!ag) return <div className="p-6 text-dim">AgentOS bridge unavailable.</div>;

  const st = status?.state || 'stopped';
  const rag = status?.rag;
  const embProvider = emb?.provider || rag?.embeddingProvider || '—';
  const isTest = (emb?.is_test_backend) || rag?.isTestBackend;
  const embAvail = emb ? emb.available : rag?.available;
  const totalSources = collections.reduce((a, c) => a + (c.sources || 0), 0);
  const totalChunks = collections.reduce((a, c) => a + (c.chunks || 0), 0);
  const totalSusp = collections.reduce((a, c) => a + (c.suspicious_chunks || 0), 0);

  return (
    <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto space-y-4">
      <div className="flex items-center gap-2">
        <Library size={20} className="text-neural-cyan" />
        <h1 className="text-xl font-bold">Local Knowledge</h1>
      </div>
      <p className="text-sm text-dim -mt-2">
        Index your own local files into AgentOS and ask questions with citations — fully local, no cloud.
      </p>

      {/* AgentOS runtime status */}
      <div className="glass p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot live={st === 'ready'} color={STATE_COLOR[st]} />
            <span className="font-semibold">AgentOS</span>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: STATE_COLOR[st], borderColor: STATE_COLOR[st] }}>
              {STATE_LABEL[st] || st}
            </span>
            <span className="text-xs text-faint font-mono">{status?.transport || '—'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Btn onClick={doStart} disabled={!!busy} title="Start AgentOS if not running"><Play size={13} /> Start</Btn>
            <Btn onClick={doRestart} disabled={!!busy} title="Restart the AgentOS process DAWN started"><RotateCw size={13} /> Restart</Btn>
            <Btn onClick={doRefresh} disabled={!!busy} title="Re-check status"><RefreshCw size={13} className={busy === 'refresh' ? 'animate-spin' : ''} /> Refresh</Btn>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[11px] font-mono">
          <Row k="API" v={status?.apiUrl} />
          <Row k="STARTED BY DAWN" v={status?.startedByDawn ? 'yes' : 'no'} />
          <Row k="PID" v={status?.pid ?? '—'} />
          <Row k="VERSION" v={status?.health?.agentosVersion || '—'} />
          <Row k="NETWORK" v={status?.health ? (status.health.networkEnabled ? '⚠ ON' : 'disabled') : '—'} bad={status?.health?.networkEnabled} />
          <Row k="PYTHON_EXEC" v={status?.health ? (status.health.pythonExecEnabled ? '⚠ ON' : 'disabled') : '—'} bad={status?.health?.pythonExecEnabled} />
          <Row k="APPROVAL" v={status?.health ? (status.health.approvalEnabled ? 'enabled' : 'off') : '—'} />
          <Row k="LAST CHECK" v={status?.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleTimeString() : '—'} />
        </div>
        {(status?.warnings || []).map((w: string, i: number) => (
          <div key={i} className="text-xs text-neural-amber flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}</div>
        ))}
        {status?.lastError && !(status?.warnings || []).length ? (
          <div className="text-xs text-neural-red flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {status.lastError}</div>
        ) : null}
        {note ? <div className="text-xs text-dim">{note}</div> : null}
      </div>

      {/* Embedding + index status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="glass p-4 space-y-1.5">
          <div className="hud-label">Embedding backend</div>
          <div className="text-sm font-mono">{embProvider}</div>
          <div className="text-[11px] text-dim font-mono">{emb?.model || rag?.embeddingModel || ''} · {emb?.url || rag?.embeddingUrl || ''}</div>
          {isTest ? (
            <div className="text-xs text-neural-amber flex items-center gap-1.5"><AlertTriangle size={13} /> TEST-ONLY hash backend — not real semantic retrieval.</div>
          ) : embAvail === false ? (
            <div className="text-xs text-neural-red flex items-center gap-1.5"><AlertTriangle size={13} /> No local embedding backend. Run <code className="px-1">ollama pull nomic-embed-text</code>.</div>
          ) : (
            <div className="text-xs text-neural-green flex items-center gap-1.5"><ShieldCheck size={13} /> Real local embeddings.</div>
          )}
        </div>
        <div className="glass p-4 space-y-1.5">
          <div className="hud-label">RAG index</div>
          <div className="text-[11px] text-dim font-mono break-all">{indexPath || rag?.indexPath || '—'}</div>
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Stat label="collections" value={collections.length} />
            <Stat label="sources" value={totalSources} />
            <Stat label="chunks" value={totalChunks} />
            <Stat label="suspicious" value={totalSusp} />
          </div>
        </div>
      </div>

      {/* Ingest */}
      <div className="glass p-4 space-y-2">
        <div className="hud-label">Add documents</div>
        <div className="text-xs text-dim">
          DAWN will index readable local documents into AgentOS’s local RAG database. Retrieved text is treated as
          <b> evidence, never instructions</b>. Protected files (.env, keys, browser/system) are skipped automatically.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={pickIngest} disabled={!!busy}><FolderPlus size={13} /> Choose folder…</Btn>
          <input value={ingPath} onChange={(e) => setIngPath(e.target.value)} placeholder="C:\Users\you\Documents\notes"
            className="flex-1 min-w-[220px] bg-panel/40 border border-border/60 rounded px-2 py-1.5 text-xs font-mono" />
          <input value={ingColl} onChange={(e) => setIngColl(e.target.value)} placeholder="collection"
            className="w-32 bg-panel/40 border border-border/60 rounded px-2 py-1.5 text-xs font-mono" />
          <Btn onClick={doIngest} disabled={!!busy}><Database size={13} /> Index</Btn>
        </div>
        {ingResult ? <pre className="text-[11px] whitespace-pre-wrap bg-panel/30 rounded p-2 max-h-48 overflow-auto">{ingResult}</pre> : null}
      </div>

      {/* Collections + sources */}
      <div className="glass p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="hud-label">Collections</div>
          {sel ? <Btn onClick={doReindex} disabled={!!busy}><RefreshCw size={13} className={busy === 'reindex' ? 'animate-spin' : ''} /> Reindex “{sel}”</Btn> : null}
        </div>
        {!collections.length ? <div className="text-xs text-dim">No collections yet — add documents above.</div> : (
          <div className="flex flex-wrap gap-2">
            {collections.map((c) => (
              <button key={c.collection} onClick={() => selectCollection(c.collection)}
                className={'px-2.5 py-1.5 rounded-md border text-xs ' + (sel === c.collection ? 'border-neural-cyan bg-neural-cyan/10' : 'border-border/60 bg-panel/40 hover:bg-panel2/60')}>
                <span className="font-semibold">{c.collection}</span>
                <span className="text-faint ml-1.5">{c.sources}s · {c.chunks}c{c.suspicious_chunks ? <span className="text-neural-amber"> · ⚠{c.suspicious_chunks}</span> : null}</span>
              </button>
            ))}
          </div>
        )}

        {sel ? (
          <div className="space-y-2 pt-1">
            {stale.length ? (
              <div className="text-xs text-neural-amber flex items-center gap-1.5">
                <AlertTriangle size={13} /> {stale.length} stale source(s) (changed/missing on disk) — Reindex to refresh.
              </div>
            ) : null}
            <div className="space-y-1">
              {sources.map((s) => {
                const isStale = stale.find((x) => x.source_id === s.source_id);
                return (
                  <div key={s.source_id} className="flex items-center gap-2 text-[11px] bg-panel/30 rounded px-2 py-1.5">
                    <span className="font-mono truncate flex-1" title={s.path}>{s.path}</span>
                    <span className="text-faint">[{s.trust_level}]</span>
                    {isStale ? <span className="text-neural-amber">{isStale.status}</span> : null}
                    <button onClick={() => delSource(s.source_id)} disabled={!!busy}
                      title="Remove from index (your file is NOT deleted)"
                      className="text-faint hover:text-neural-red disabled:opacity-40"><Trash2 size={13} /></button>
                  </div>
                );
              })}
              {!sources.length ? <div className="text-xs text-dim">No sources in this collection.</div> : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Ask / Search */}
      <div className="glass p-4 space-y-2">
        <div className="hud-label">Ask your knowledge</div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="when should I wrap the hive for winter?"
            onKeyDown={(e) => { if (e.key === 'Enter') doAsk('answer'); }}
            className="flex-1 min-w-[240px] bg-panel/40 border border-border/60 rounded px-2 py-1.5 text-xs" />
          <input value={askColl} onChange={(e) => setAskColl(e.target.value)} placeholder="collection"
            className="w-32 bg-panel/40 border border-border/60 rounded px-2 py-1.5 text-xs font-mono" />
          <Btn onClick={() => doAsk('answer')} disabled={!!busy}><MessageCircleQuestion size={13} /> Answer</Btn>
          <Btn onClick={() => doAsk('search')} disabled={!!busy}><Search size={13} /> Search</Btn>
        </div>
        {askOut ? <pre className="text-[11px] whitespace-pre-wrap bg-panel/30 rounded p-2 max-h-72 overflow-auto">{askOut}</pre> : null}
      </div>

      {/* Security note */}
      <div className="glass-soft p-3 text-[11px] text-dim flex items-start gap-2">
        <ShieldCheck size={14} className="text-neural-green mt-0.5 shrink-0" />
        <span>
          Indexed documents cannot grant permissions, change policy, or override DAWN/AgentOS instructions. Retrieved
          passages are evidence only; any instructions embedded in them are flagged and never followed. Secrets are
          redacted before display. Deleting a source removes only the index record — never your file.
          {' '}
          <a className="text-neural-cyan inline-flex items-center gap-0.5 cursor-pointer"
            onClick={() => (window as any).dawn?.openExternal?.('https://github.com/')}>docs <ExternalLink size={11} /></a>
        </span>
      </div>
    </div>
  );
}

function Row({ k, v, bad }: { k: string; v: any; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-faint tracking-wider">{k}</span>
      <span className={'truncate ' + (bad ? 'text-neural-red' : 'text-dim')} title={String(v)}>{String(v)}</span>
    </div>
  );
}
