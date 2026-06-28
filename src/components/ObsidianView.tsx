import React, { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Search, Share2, ShieldCheck, FileText } from 'lucide-react';
import { Button } from '../ui/button';

function Toggle({ label, desc, value, onChange }: any) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="pr-4">
        <div className="text-sm">{label}</div>
        {desc ? <div className="text-xs text-faint mt-0.5">{desc}</div> : null}
      </div>
      <button onClick={() => onChange(!value)} className={`w-12 h-6 rounded-full relative shrink-0 transition ${value ? 'bg-neural-cyan/40' : 'bg-panel2'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${value ? 'left-6' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

/** Obsidian integration — connect a vault, index it, search it, export the graph. */
export default function ObsidianView() {
  const [s, setS] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  const refresh = () => window.dawn.vault.status().then(setStatus);
  useEffect(() => {
    window.dawn.settings.get().then(setS);
    refresh();
    const off = window.dawn.vault.onProgress(setStatus);
    return off;
  }, []);
  if (!s) return <div className="p-6 text-dim">Loading…</div>;

  const set = (k: string) => (v: any) => { const ns = { ...s, [k]: v }; setS(ns); window.dawn.settings.save({ [k]: v }); };

  async function pickVault() {
    const folder = await window.dawn.vault.pick();
    if (!folder) return;
    setMsg('Connecting…');
    const r = await window.dawn.vault.connect(folder);
    if (!r.ok) { setMsg(r.error); return; }
    const s2 = await window.dawn.settings.get();
    setS(s2);
    setMsg('Connected. Folder structure created under Dawn/.');
    refresh();
  }
  async function reindex() {
    setMsg('Indexing…');
    const r = await window.dawn.vault.reindex();
    setMsg(r.ok ? `Indexed ${r.notes} notes (${r.chunks} chunks).` : 'Index failed.');
    refresh();
  }
  async function doSearch() {
    if (!query.trim()) return;
    setResults(await window.dawn.vault.search(query));
  }
  async function exportGraph() {
    const r = await window.dawn.vault.graphExport();
    setMsg(r.ok ? `Graph exported: ${r.nodes} nodes → Dawn/Graph/brain_graph.json` : (r.error || 'Export failed.'));
  }

  return (
    <div className="p-6 max-w-2xl mx-auto h-full overflow-y-auto">
      <h1 className="text-xl font-bold">Obsidian</h1>
      <p className="text-sm text-dim mb-4">Use an Obsidian vault as DAWN's long-term memory &amp; knowledge base. Plain local Markdown — Obsidian doesn't need to be running. Nothing is uploaded.</p>

      <div className="glass p-5 mb-4">
        <h3 className="font-semibold mb-3">Vault</h3>
        <div className="flex items-center gap-2 mb-2">
          <input readOnly value={s.vaultPath || ''} placeholder="No vault connected" className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-dim" />
          <Button variant="primary" onClick={pickVault}><FolderOpen size={15} /> {s.vaultPath ? 'Change' : 'Select vault'}</Button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="default" onClick={() => window.dawn.vault.open()} disabled={!status?.connected}><FolderOpen size={14} /> Open</Button>
          <Button variant="default" onClick={reindex} disabled={!status?.connected || status?.indexing}><RefreshCw size={14} /> {status?.indexing ? `Indexing ${status.current}/${status.total}…` : 'Rebuild index'}</Button>
          <Button variant="default" onClick={exportGraph} disabled={!status?.connected}><Share2 size={14} /> Export graph</Button>
          {status?.connected ? <span className="text-xs text-faint">{status.notes} notes · {status.chunks} chunks</span> : null}
        </div>
        {msg ? <div className="text-xs text-neural-cyan mt-2">{msg}</div> : null}
      </div>

      <div className="glass p-5 mb-4">
        <h3 className="font-semibold mb-3">Behavior</h3>
        <Toggle label="Enable Obsidian integration" value={s.obsidianEnabled} onChange={set('obsidianEnabled')} />
        <Toggle label="Search vault during chat" desc="Retrieve relevant notes and cite them in answers." value={s.vaultSearchInChat} onChange={set('vaultSearchInChat')} />
        <Toggle label="Secret detection" desc="Redact API keys, passwords, tokens, keys, SSNs, cards before writing notes." value={s.vaultSecretDetection} onChange={set('vaultSecretDetection')} />
        <Toggle label="Auto-linking" desc="Add [[backlinks]] and tags to written notes." value={s.vaultAutoLinking} onChange={set('vaultAutoLinking')} />
        <Toggle label="Daily notes" value={s.vaultDailyNote} onChange={set('vaultDailyNote')} />
        <div className="mt-3">
          <div className="text-xs text-dim mb-1.5">Memory mode</div>
          <select value={s.vaultMemoryMode} onChange={(e) => set('vaultMemoryMode')(e.target.value)} className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm">
            <option value="off">Off</option>
            <option value="manual">Manual approval (use "Save to Obsidian")</option>
            <option value="auto-important">Auto-save important memories</option>
            <option value="auto-all">Auto-save everything (conversation summaries)</option>
          </select>
        </div>
      </div>

      <div className="glass p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Search size={15} /> Search the vault</h3>
        <div className="flex gap-2 mb-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} placeholder="Search your notes…" className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-neural-cyan" />
          <Button variant="primary" onClick={doSearch}>Search</Button>
        </div>
        <div className="space-y-2">
          {results.map((r, i) => (
            <button key={i} onClick={() => window.dawn.openExternal('file:///' + r.path.replace(/\\/g, '/'))} className="w-full text-left glass-soft p-3 hover:border-neural-cyan/50">
              <div className="text-sm font-medium flex items-center gap-2"><FileText size={13} className="text-neural-green" /> {r.title}{r.heading ? <span className="text-faint"> › {r.heading}</span> : null}</div>
              <div className="text-xs text-dim mt-1 line-clamp-2">{r.content.slice(0, 160)}…</div>
            </button>
          ))}
          {query && results.length === 0 ? <div className="text-xs text-faint">No matches (rebuild the index if you just connected).</div> : null}
        </div>
      </div>

      <div className="glass-soft p-3 mt-4 text-xs text-faint flex items-start gap-2">
        <ShieldCheck size={14} className="text-neural-green mt-0.5 shrink-0" />
        Everything stays local. Vault contents are never sent to any cloud. Secrets are redacted unless you explicitly allow them.
      </div>
    </div>
  );
}
