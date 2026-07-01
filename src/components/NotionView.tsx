import React, { useEffect, useState } from 'react';
import { RefreshCw, Plug, ExternalLink, Search } from 'lucide-react';
import { Button } from '../ui/button';
import { PageShellPanel } from '../ui/system';

/** Notion integration page — connect a Notion integration token, sync shared
 *  pages locally, and use them in chat + the brain (mirrors the Obsidian page). */
export default function NotionView() {
  const [token, setToken] = useState('');
  const [s, setS] = useState<any>(null);
  const [status, setStatus] = useState<any>({ connected: false, pages: 0, chunks: 0 });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);

  const refresh = () => window.dawn.notion.status().then(setStatus);

  useEffect(() => {
    window.dawn.settings.get().then((cfg: any) => { setS(cfg); setToken(cfg.notionToken || ''); });
    refresh();
    const off = window.dawn.notion.onProgress((st: any) => setStatus(st));
    return off;
  }, []);

  async function connect() {
    setBusy('connect'); setMsg('');
    const r = await window.dawn.notion.connect(token.trim());
    setBusy('');
    if (r.ok) { setMsg(`Connected as "${r.user}". Syncing shared pages…`); refresh(); }
    else setMsg(`Connection failed: ${r.error}`);
    window.dawn.settings.get().then(setS);
  }
  async function sync() {
    setBusy('sync'); setMsg('');
    const r = await window.dawn.notion.sync();
    setBusy('');
    setMsg(r.ok ? `Synced ${r.pages} pages (${r.chunks} chunks).` : `Sync failed: ${r.error}`);
    refresh();
  }
  async function search() {
    if (!query.trim()) return;
    setResults(await window.dawn.notion.search(query));
  }
  async function setChat(v: boolean) {
    const next = await window.dawn.settings.save({ notionSearchInChat: v });
    setS(next);
  }
  async function disconnect() {
    await window.dawn.notion.disconnect();
    window.dawn.settings.get().then(setS);
    refresh();
  }

  return (
    <PageShellPanel
      width="max-w-2xl"
      icon={<Plug size={22} />}
      title="Notion"
      subtitle={<>Connect your Notion workspace. DAWN reads the pages you share with the integration, indexes them <b>locally</b>, and uses them in chat &amp; the brain. It only ever reads from Notion — your local data is never uploaded.</>}
    >
      <div className="glass p-5 mt-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Plug size={16} /> Connection</h3>
        <div className="flex items-center gap-2 text-xs mb-3">
          <span className={`w-2 h-2 rounded-full ${status.connected ? 'bg-neural-green' : 'bg-faint'}`} />
          {status.connected ? <span className="text-neural-green">Connected · {status.pages} pages · {status.chunks} chunks</span> : <span className="text-faint">Not connected</span>}
          {status.indexing ? <span className="text-neural-amber ml-2">syncing {status.current}/{status.total}…</span> : null}
        </div>
        <label className="text-xs text-faint">Integration token (starts with <code>ntn_</code> or <code>secret_</code>)</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ntn_…"
          className="field-accent w-full bg-bg/80 border border-border rounded-lg px-3 py-2 text-sm outline-none mt-1 mb-2 font-mono transition-shadow"
        />
        <div className="flex gap-2 flex-wrap">
          <Button variant="primary" onClick={connect} disabled={!token.trim() || busy === 'connect'}>
            <Plug size={15} /> {busy === 'connect' ? 'Connecting…' : 'Connect'}
          </Button>
          <Button variant="default" onClick={sync} disabled={!status.connected || !!status.indexing || busy === 'sync'}>
            <RefreshCw size={15} className={status.indexing ? 'animate-spin' : ''} /> Sync now
          </Button>
          {status.connected ? <Button variant="ghost" onClick={disconnect}>Disconnect</Button> : null}
          <a href="#" onClick={(e) => { e.preventDefault(); window.dawn.openExternal('https://www.notion.so/my-integrations'); }} className="text-xs text-neural-cyan inline-flex items-center gap-1 self-center ml-auto">
            Create / manage integration <ExternalLink size={12} />
          </a>
        </div>
        {msg ? <p className="text-xs text-dim mt-2">{msg}</p> : null}
      </div>

      <div className="glass-soft p-4 mt-3 text-xs text-dim leading-relaxed">
        <b className="text-ink">One-time setup:</b>
        <ol className="list-decimal ml-4 mt-1 space-y-0.5">
          <li>At <span className="text-neural-cyan">notion.so/my-integrations</span>, create an internal integration (any name) and copy its <i>Internal Integration Secret</i>.</li>
          <li>Paste it above and click <b>Connect</b>.</li>
          <li>In Notion, open each page/database you want DAWN to see → <b>•••</b> (top-right) → <b>Connections</b> → add your integration. Child pages are included automatically.</li>
          <li>Click <b>Sync now</b>. Re-sync anytime to pull updates.</li>
        </ol>
      </div>

      <div className="glass p-5 mt-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Use in chat</h3>
          <button onClick={() => setChat(!s?.notionSearchInChat)} className={`text-xs rounded-full px-3 py-1 border ${s?.notionSearchInChat ? 'border-neural-green/60 text-neural-green bg-neural-green/10' : 'border-border text-faint'}`}>
            {s?.notionSearchInChat ? 'On' : 'Off'}
          </button>
        </div>
        <p className="text-xs text-faint">When on, DAWN pulls relevant Notion pages into chat answers and cites them.</p>

        <div className="relative mt-3">
          <Search size={14} className="absolute left-2.5 top-2.5 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Test search your Notion…"
            className="field-accent w-full bg-bg/80 border border-border rounded-lg pl-8 pr-2 py-2 text-sm outline-none transition-shadow"
          />
        </div>
        <div className="mt-2 space-y-1">
          {results.map((r, i) => (
            <button key={i} onClick={() => window.dawn.notion.open(r.url)} className="w-full text-left glass-soft px-3 py-2 hover:ring-1 hover:ring-neural-cyan/40">
              <div className="text-sm font-medium truncate">{r.title} <span className="text-faint text-xs">· {r.score}</span></div>
              <div className="text-xs text-dim truncate">{r.content}</div>
            </button>
          ))}
        </div>
      </div>
    </PageShellPanel>
  );
}
