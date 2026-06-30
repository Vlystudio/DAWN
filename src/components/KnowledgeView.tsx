import React, { useEffect, useState } from 'react';
import { FolderPlus, Trash2, RefreshCw, Pause, Shield } from 'lucide-react';
import { Button } from '../ui/button';
import { useBrainStore } from '../state/brainStore';

function fmt(n: number) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** Local Knowledge / RAG — index user-approved folders for retrieval in chat. */
export default function KnowledgeView() {
  const [status, setStatus] = useState<any>(null);
  const loadGraph = useBrainStore((s) => s.loadGraph);
  const refresh = () => window.dawn.rag.status().then(setStatus);

  useEffect(() => {
    refresh();
    const off = window.dawn.rag.onProgress(setStatus);
    const t = setInterval(refresh, 4000);
    return () => { off(); clearInterval(t); };
  }, []);

  async function addFolder() {
    const f = await window.dawn.rag.pickFolder();
    if (!f) return;
    const est = await window.dawn.rag.estimate(f);
    if (est.fileCount === 0) {
      alert('No indexable files found there (after privacy/type filters).');
      return;
    }
    if (!confirm(`Index this folder?\n\n${f}\n\nFiles: ${est.fileCount}\nSize: ${fmt(est.bytes)}`)) return;
    const r = await window.dawn.rag.addFolder(f);
    if (!r.ok) { alert(r.error); return; }
    await refresh();
    window.dawn.rag.index();
  }
  async function removeFolder(f: string) {
    if (confirm('Remove this folder and delete its indexed chunks?')) {
      await window.dawn.rag.removeFolder(f);
      refresh();
      loadGraph();
    }
  }
  async function panic() {
    if (confirm('Delete the ENTIRE local knowledge base (all folders + embeddings)? Chats and memories are not affected.')) {
      await window.dawn.rag.deleteAll();
      refresh();
      loadGraph();
    }
  }

  if (!status) return <div className="p-6 text-dim">Loading…</div>;
  const pct = status.indexing && status.total ? Math.round((status.current / status.total) * 100) : 0;

  return (
    <div className="p-6 max-w-3xl mx-auto h-full overflow-y-auto">
      <h1 className="text-xl font-bold">Knowledge Base</h1>
      <p className="text-sm text-dim mb-4">Index folders you approve. Retrieval runs locally with on-device embeddings — no cloud. Toggle “Local knowledge” in chat to use it.</p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Folders" value={status.folders.length} />
        <Stat label="Files" value={status.totals.files} />
        <Stat label="Chunks" value={status.totals.chunks} />
      </div>

      {status.states ? (
        <div className="flex items-center gap-2 mb-2 flex-wrap text-[11px]">
          <span className="text-faint">Sources:</span>
          {status.states.indexed > 0 ? <span className="px-2 py-0.5 rounded-full border border-neural-green/40 bg-neural-green/10 text-neural-green">{status.states.indexed} indexed</span> : null}
          {status.states.failed > 0 ? <span className="px-2 py-0.5 rounded-full border border-neural-red/40 bg-neural-red/10 text-neural-red">{status.states.failed} failed</span> : null}
          {status.states.stale > 0 ? <span className="px-2 py-0.5 rounded-full border border-neural-amber/40 bg-neural-amber/10 text-neural-amber">{status.states.stale} stale</span> : null}
          {status.states.indexed === 0 && status.states.failed === 0 ? <span className="text-faint">none yet</span> : null}
        </div>
      ) : null}
      {status.embedding ? (
        <div className="text-[11px] text-faint mb-2">
          Retrieval: <span className="text-dim">{status.embedding.mode === 'embeddings' ? 'embeddings' : status.embedding.mode === 'keyword fallback' ? 'keyword fallback (local hash — no neural embedding model)' : 'not indexed yet'}</span>
          {status.embedding.configuredModel ? <span> · model {status.embedding.configuredModel}</span> : null}
        </div>
      ) : null}
      {status.skipped && Object.keys(status.skipped).length > 0 ? (
        <div className="text-[11px] text-faint mb-3 border border-border/60 rounded-lg p-2 bg-panel/20">
          <span className="text-dim">Skipped for safety</span> (DAWN never indexes secrets/keys/caches):
          <ul className="mt-1 space-y-0.5">
            {Object.entries(status.skipped as Record<string, number>).slice(0, 8).map(([reason, count]) => (
              <li key={reason} className="flex justify-between gap-2"><span className="truncate">{reason}</span><span className="text-neural-amber shrink-0">{count}</span></li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-3">
        <Button variant="primary" onClick={addFolder} disabled={status.indexing}><FolderPlus size={15} /> Add folder</Button>
        <Button variant="default" onClick={() => window.dawn.rag.index()} disabled={status.indexing || status.folders.length === 0}><RefreshCw size={15} /> Re-index</Button>
        <Button variant="default" onClick={async () => { await window.dawn.rag.validate(); refresh(); }} disabled={status.indexing || status.folders.length === 0}><RefreshCw size={15} /> Check for changes</Button>
        {status.indexing ? <Button variant="default" onClick={() => window.dawn.rag.pause()}><Pause size={15} /> Pause</Button> : null}
        <Button variant="danger" onClick={panic} disabled={status.indexing}><Trash2 size={15} /> Delete all</Button>
      </div>

      {status.indexing ? (
        <div className="glass-soft p-3 mb-3">
          <div className="text-sm mb-1">Indexing {status.current}/{status.total} — {pct}%</div>
          <div className="h-1.5 bg-panel2 rounded-full overflow-hidden"><div className="h-full bg-neural-cyan transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="text-xs text-faint mt-1 truncate">{status.currentFile}</div>
        </div>
      ) : null}

      <div className="glass-soft p-3 mb-4 text-xs text-dim flex items-start gap-2">
        <Shield size={14} className="text-neural-green mt-0.5 shrink-0" />
        <span>For safety the indexer never touches hidden/system folders, AppData, <code>.env</code>, SSH/API keys, password vaults, browser profiles or <code>node_modules</code> — even inside an approved folder. Supported: text, markdown, code, csv, json, yaml, logs (PDF/DOCX next).</span>
      </div>

      <div className="space-y-2">
        {status.folders.length === 0 ? (
          <div className="text-center text-faint py-6">No folders indexed yet.</div>
        ) : (
          status.folders.map((f: any) => (
            <div key={f.path} className="glass p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{f.path}</div>
                <div className="text-xs text-faint">{f.files} files indexed</div>
              </div>
              <button onClick={() => removeFolder(f.path)} className="p-1.5 text-faint hover:text-neural-red"><Trash2 size={15} /></button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-dim">{label}</div>
    </div>
  );
}
