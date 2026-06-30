import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, MessageSquare, StickyNote, CheckSquare, FileText, CalendarDays, Telescope, Brain, Sparkles, Mail } from 'lucide-react';

/**
 * GlobalSearch — cross-workspace search overlay (Ctrl/Cmd+Shift+F, or the "Search everything"
 * command). Queries conversations, messages, memories, notes, tasks, documents, events, research,
 * skills, and email subjects via window.dawn.search — which never touches the vault and redacts
 * snippets. Selecting a result opens its page. Honest about any source that was unavailable.
 */

const ICONS: Record<string, any> = {
  conversation: MessageSquare, message: MessageSquare, memory: Brain, note: StickyNote, task: CheckSquare,
  document: FileText, event: CalendarDays, research: Telescope, skill: Sparkles, email: Mail,
};

type Result = { type: string; label: string; id: string; title: string; snippet: string; route: string };
type Resp = { term: string; results: Result[]; total: number; skipped: { type: string; reason: string }[] };

export default function GlobalSearch({ onNav }: { onNav: (view: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<any>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); setOpen((v) => !v); }
      if ((e as any).__dawnOpenSearch) setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    const openEvt = () => setOpen(true);
    window.addEventListener('dawn:open-search', openEvt as any);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('dawn:open-search', openEvt as any); };
  }, []);

  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 0); } else { setQ(''); setResp(null); setActive(0); } }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setResp(null); return; }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try { const r = await (window as any).dawn.search.query(q.trim()); setResp(r); setActive(0); }
      catch { setResp({ term: q, results: [], total: 0, skipped: [{ type: 'all', reason: 'search failed' }] }); }
      finally { setLoading(false); }
    }, 180);
  }, [q, open]);

  const results = resp?.results || [];
  const open_ = (r: Result) => { onNav(r.route); setOpen(false); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); open_(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-start justify-center bg-black/60 pt-[10vh] p-4" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Global search">
      <div className="glass w-full max-w-xl overflow-hidden border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search size={15} className="text-faint shrink-0" aria-hidden />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search everything — notes, tasks, docs, chats, research, email…"
            aria-label="Search query" className="flex-1 bg-transparent py-3 text-sm outline-none" />
          <button onClick={() => setOpen(false)} aria-label="Close" className="text-faint hover:text-ink"><X size={16} /></button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto" role="listbox" aria-label="Search results">
          {q.trim().length < 2 ? (
            <div className="px-4 py-6 text-center text-sm text-faint">Type at least 2 characters. Vault secrets are never searched.</div>
          ) : loading && !resp ? (
            <div className="px-4 py-6 text-center text-sm text-faint">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-faint">No matches for “{q.trim()}”.</div>
          ) : (
            results.map((r, i) => {
              const Icon = ICONS[r.type] || FileText;
              return (
                <button key={`${r.type}-${r.id}-${i}`} role="option" aria-selected={i === active}
                  onMouseEnter={() => setActive(i)} onClick={() => open_(r)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2 text-left ${i === active ? 'bg-panel2/70' : ''}`}>
                  <Icon size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink truncate">{r.title}</span>
                      <span className="text-[10px] text-faint shrink-0">{r.label}</span>
                    </div>
                    {r.snippet ? <div className="text-[11px] text-dim truncate">{r.snippet}</div> : null}
                  </div>
                </button>
              );
            })
          )}
          {resp && resp.skipped.length > 0 ? (
            <div className="px-3 py-2 text-[11px] text-faint border-t border-border">Some sources were unavailable: {resp.skipped.map((s) => s.type).join(', ')}.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
