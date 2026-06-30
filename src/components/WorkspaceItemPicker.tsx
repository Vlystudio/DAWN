import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Spinner } from '../ui/primitives';

/**
 * WorkspaceItemPicker — a reusable modal that searches real Workspace Graph items (window.dawn.
 * workspace.search) and returns the chosen one via onPick. No IDs to paste. Shows label, type,
 * source feature, updated date, and a safe snippet (from item metadata). Can exclude an id (the
 * source item) and pre-filter by type. The workspace tables hold no secrets, so the vault/auth/
 * audit can never appear here.
 */

type Item = { id: string; type: string; label: string; source_feature: string; updated_at: number; metadata?: string };

function snippetOf(it: Item): string {
  try { const m = JSON.parse(it.metadata || '{}'); return typeof m?.snippet === 'string' ? m.snippet : ''; } catch { return ''; }
}
function when(ts?: number): string {
  if (!ts) return '';
  const d = Math.round((Date.now() - ts) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

export default function WorkspaceItemPicker({ open, onClose, onPick, excludeId, title = 'Pick a workspace item' }: {
  open: boolean; onClose: () => void; onPick: (item: Item) => void; excludeId?: string; title?: string;
}) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const deb = useRef<any>(null);

  useEffect(() => { if (open) { setQ(''); setType('all'); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  useEffect(() => {
    if (!open) return;
    if (deb.current) clearTimeout(deb.current);
    setLoading(true);
    deb.current = setTimeout(async () => {
      try {
        const r = await (window as any).dawn.workspace.search({ q: q.trim() || undefined, type: type === 'all' ? undefined : type, excludeId, limit: 40 });
        setItems(r?.results || []); setActive(0);
      } catch { setItems([]); } finally { setLoading(false); }
    }, 160);
  }, [q, type, open, excludeId]);

  const types = useMemo(() => ['all', ...Array.from(new Set((items || []).map((i) => i.type)))], [items]);
  if (!open) return null;
  const list = items || [];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && list[active]) { e.preventDefault(); onPick(list[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[85] grid place-items-start justify-center bg-black/60 pt-[12vh] p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="glass w-full max-w-lg border border-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search size={15} className="text-faint shrink-0" aria-hidden />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={title} aria-label="Search items" className="flex-1 bg-transparent py-3 text-sm outline-none" />
          <select value={type} onChange={(e) => setType(e.target.value)} className="bg-bg/70 border border-border rounded-lg px-2 py-1 text-xs" aria-label="Filter by type">
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-ink"><X size={16} /></button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto" role="listbox" aria-label="Items">
          {loading && !items ? <div className="px-4 py-6 text-center"><Spinner size={14} label="Searching…" /></div> :
            list.length === 0 ? <div className="px-4 py-6 text-center text-sm text-faint">No items{q ? ` for “${q}”` : ''}. Items auto-register as you use DAWN.</div> :
              list.map((it, i) => {
                const sn = snippetOf(it);
                return (
                  <button key={it.id} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => onPick(it)}
                    className={`w-full text-left px-3 py-2 ${i === active ? 'bg-panel2/70' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink truncate flex-1">{it.label}</span>
                      <span className="text-[10px] text-faint shrink-0">{it.type}</span>
                      <span className="text-[10px] text-faint shrink-0">{when(it.updated_at)}</span>
                    </div>
                    <div className="text-[11px] text-faint truncate">{it.source_feature}{sn ? ` · ${sn}` : ''}</div>
                  </button>
                );
              })}
        </div>
      </div>
    </div>
  );
}
