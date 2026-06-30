import React, { useEffect, useState } from 'react';
import { Link2, ArrowRight, ArrowLeft, X } from 'lucide-react';
import { Spinner, EmptyState } from '../ui/primitives';

/**
 * RelatedItemsPanel — shows the workspace items linked to a given item (both directions) with the
 * relationship type, and lets you unlink. Reusable across feature detail views. Reads via
 * window.dawn.workspace.related; never shows secrets (workspace labels are non-secret handles).
 */

type Related = { link: { id: string; type: string; from_id: string; to_id: string }; direction: 'in' | 'out'; item: { id: string; type: string; label: string } | null };

export default function RelatedItemsPanel({ itemId, onOpenItem, onChanged }: { itemId: string; onOpenItem?: (id: string) => void; onChanged?: () => void }) {
  const [items, setItems] = useState<Related[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    setLoading(true);
    try { setItems(await (window as any).dawn.workspace.related(itemId)); } catch { setItems([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (itemId) load(); }, [itemId]);

  const unlink = async (linkId: string) => {
    try { await (window as any).dawn.workspace.deleteLink(linkId); await load(); onChanged?.(); } catch { /* */ }
  };

  if (loading && !items) return <div className="p-3"><Spinner size={14} label="Loading related…" /></div>;
  if (!items || items.length === 0) return <div className="p-4 text-xs text-faint text-center">No related items yet. Use “+ Link…” to connect items.</div>;

  const relTypes = ['all', ...Array.from(new Set(items.map((r) => r.link.type)))];
  const shown = items.filter((r) => filter === 'all' || r.link.type === filter);

  return (
    <div className="space-y-1">
      {relTypes.length > 2 ? (
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-1 w-full bg-bg/70 border border-border rounded-lg px-2 py-1 text-[11px]" aria-label="Filter by relationship">
          {relTypes.map((t) => <option key={t} value={t}>{t === 'all' ? 'All relationships' : t.replace(/_/g, ' ')}</option>)}
        </select>
      ) : null}
      {shown.map((r) => (
        <div key={r.link.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-panel/40 group">
          {r.direction === 'out' ? <ArrowRight size={12} className="text-faint shrink-0" aria-hidden /> : <ArrowLeft size={12} className="text-faint shrink-0" aria-hidden />}
          <span className="text-[10px] text-faint shrink-0 w-24 truncate" title={r.link.type}>{r.link.type.replace(/_/g, ' ')}</span>
          <button onClick={() => r.item && onOpenItem?.(r.item.id)} className="flex-1 min-w-0 text-left text-sm text-dim hover:text-ink truncate">
            {r.item ? r.item.label : <span className="italic text-faint">(removed)</span>}
            {r.item ? <span className="text-[10px] text-faint ml-1.5">{r.item.type}</span> : null}
          </button>
          <button onClick={() => unlink(r.link.id)} aria-label="Unlink" className="opacity-0 group-hover:opacity-100 text-faint hover:text-neural-red shrink-0"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}
