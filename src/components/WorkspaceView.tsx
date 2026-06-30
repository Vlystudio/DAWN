import React, { useEffect, useMemo, useState } from 'react';
import { Share2, Plus, Trash2, CheckSquare, Link2, X, RefreshCw } from 'lucide-react';
import { Badge, Spinner, EmptyState, ErrorCallout, SectionHeader, ConfirmDialog } from '../ui/primitives';
import RelatedItemsPanel from './RelatedItemsPanel';

/**
 * WorkspaceView — the Workspace Graph: a filterable list of typed items, an item detail drawer with
 * its related items + link creator, and real cross-feature actions (Convert to Task). Everything is
 * wired to window.dawn.workspace (items/links/search/related). No mock data; empty until you create
 * items or features register them.
 */

type Item = { id: string; type: string; ref_id: string | null; label: string; source_feature: string; metadata: string; created_at: number; updated_at: number };

const LINK_TYPES = ['related_to', 'references', 'created_from', 'summarizes', 'expands_on', 'attached_to', 'converted_to', 'uses_source', 'uses_memory', 'uses_tool', 'uses_model', 'generated_by', 'scheduled_as', 'assigned_to', 'exported_to', 'imported_from'];
const ITEM_TYPES = ['note', 'task', 'document', 'conversation', 'research_run', 'memory', 'email_message', 'model', 'benchmark', 'skill', 'dcd_operation', 'coding_run'];

export default function WorkspaceView() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState<Item | null>(null);
  const [confirmDel, setConfirmDel] = useState<Item | null>(null);
  const [linkTarget, setLinkTarget] = useState(''); const [linkType, setLinkType] = useState('related_to');
  const [creating, setCreating] = useState(false); const [newLabel, setNewLabel] = useState(''); const [newType, setNewType] = useState('note');
  const [notice, setNotice] = useState<string | null>(null);

  const load = async (reconcile = false) => {
    setLoading(true); setError(null);
    try {
      if (reconcile) { try { await (window as any).dawn.workspace.reconcile(); } catch { /* non-fatal */ } }
      setItems(await (window as any).dawn.workspace.listItems({ q, type: typeFilter === 'all' ? undefined : typeFilter }));
    }
    catch (e: any) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };
  // Reconcile once on mount so the graph reflects real notes/tasks/docs/etc.; plain reloads on filter.
  useEffect(() => { load(true); }, []);
  useEffect(() => { load(false); }, [q, typeFilter]);

  const create = async () => {
    if (!newLabel.trim()) return;
    try { const r = await (window as any).dawn.workspace.createItem({ type: newType, label: newLabel.trim(), sourceFeature: 'workspace' }); if (r?.ok) { setNewLabel(''); setCreating(false); await load(); } else setNotice(r?.error || 'create failed'); }
    catch (e: any) { setNotice(String(e?.message || e)); }
  };
  const del = async (it: Item) => {
    try { await (window as any).dawn.workspace.deleteItem(it.id); setConfirmDel(null); if (selected?.id === it.id) setSelected(null); await load(); } catch (e: any) { setNotice(String(e?.message || e)); }
  };
  const convert = async (it: Item) => {
    try { const r = await (window as any).dawn.workspace.convertToTask(it.id); setNotice(r?.ok ? `Created task “${r.task?.title}”` : (r?.error || 'failed')); await load(); } catch (e: any) { setNotice(String(e?.message || e)); }
  };
  const addLink = async () => {
    if (!selected || !linkTarget.trim()) return;
    try { const r = await (window as any).dawn.workspace.createLink({ fromId: selected.id, toId: linkTarget.trim(), type: linkType }); setNotice(r?.ok ? (r.deduped ? 'Link already existed' : 'Linked') : (r?.error || 'link failed')); setLinkTarget(''); } catch (e: any) { setNotice(String(e?.message || e)); }
  };

  const types = useMemo(() => ['all', ...Array.from(new Set((items || []).map((i) => i.type)))], [items]);

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6">
          <div className="flex items-start gap-3 mb-3">
            <Share2 size={22} style={{ color: 'var(--accent)' }} className="mt-0.5" aria-hidden />
            <div className="flex-1">
              <h1 className="text-xl font-bold">Workspace Graph</h1>
              <p className="text-sm text-dim">Typed items linked across features — searchable and shown in the Brain. Create items or let features register them.</p>
            </div>
            <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}><Plus size={14} /> New item</button>
          </div>

          {creating ? (
            <div className="mb-3 rounded-lg border border-border bg-panel/30 p-3 flex items-center gap-2 flex-wrap">
              <select value={newType} onChange={(e) => setNewType(e.target.value)} className="bg-bg/70 border border-border rounded-lg px-2 py-1.5 text-sm">
                {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="Label…" className="flex-1 min-w-[180px] bg-bg/70 border border-border rounded-lg px-2 py-1.5 text-sm outline-none" />
              <button onClick={create} className="px-3 py-1.5 rounded-lg border border-border text-sm">Create</button>
            </div>
          ) : null}

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…" className="flex-1 min-w-[160px] bg-bg/70 border border-border rounded-lg px-3 py-1.5 text-sm outline-none" />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-bg/70 border border-border rounded-lg px-2 py-1.5 text-sm">
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={() => load(true)} className="p-2 rounded-lg border border-border text-faint hover:text-ink" aria-label="Refresh + sync from features"><RefreshCw size={14} /></button>
          </div>

          {notice ? <div className="mb-3 text-xs text-neural-green">{notice}</div> : null}
          {error ? <ErrorCallout title="Couldn't load workspace" message={error} onRetry={load} /> : null}

          {loading && !items ? <Spinner size={16} label="Loading…" /> :
            !items || items.length === 0 ? (
              <EmptyState icon={<Share2 size={28} />} title="No workspace items yet" body="Create one above, or convert chat replies / notes into linked items as you work." />
            ) : (
              <div className="space-y-1.5">
                {items.map((it) => (
                  <div key={it.id} className={`rounded-lg border p-3 cursor-pointer ${selected?.id === it.id ? 'border-[var(--accent)]/50 bg-panel2/40' : 'border-border bg-panel/20'}`} onClick={() => setSelected(it)}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate flex-1">{it.label}</span>
                      <Badge kind="ok">{it.type}</Badge>
                      <button onClick={(e) => { e.stopPropagation(); convert(it); }} title="Convert to task" className="text-faint hover:text-ink"><CheckSquare size={14} /></button>
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDel(it); }} aria-label="Delete" className="text-faint hover:text-neural-red"><Trash2 size={14} /></button>
                    </div>
                    <div className="text-[10px] text-faint mt-0.5">{it.source_feature} · {new Date(it.updated_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>

      {/* detail drawer */}
      {selected ? (
        <div className="w-80 shrink-0 border-l border-border bg-bg/40 overflow-y-auto">
          <div className="p-4">
            <div className="flex items-start gap-2 mb-2">
              <div className="flex-1 min-w-0"><div className="font-semibold text-sm">{selected.label}</div><div className="text-[10px] text-faint">{selected.type} · {selected.source_feature}</div></div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-faint hover:text-ink"><X size={16} /></button>
            </div>
            <SectionHeader icon={<Link2 size={14} />} title="Related items" />
            <RelatedItemsPanel itemId={selected.id} onOpenItem={(id) => { const it = items?.find((x) => x.id === id); if (it) setSelected(it); }} onChanged={load} />
            <div className="mt-3 pt-3 border-t border-border/60">
              <div className="text-[11px] text-faint mb-1.5">Link to another item (by id):</div>
              <div className="flex items-center gap-1.5">
                <input value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} placeholder="target item id" className="flex-1 min-w-0 bg-bg/70 border border-border rounded-lg px-2 py-1 text-xs outline-none" />
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <select value={linkType} onChange={(e) => setLinkType(e.target.value)} className="flex-1 bg-bg/70 border border-border rounded-lg px-2 py-1 text-xs">
                  {LINK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
                <button onClick={addLink} className="px-2.5 py-1 rounded-lg border border-border text-xs">Link</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog open={!!confirmDel} title="Delete workspace item?" danger
        body={<>This removes <b>{confirmDel?.label}</b> and its links. The underlying note/task/etc. is not deleted.</>}
        confirmLabel="Delete" onConfirm={() => confirmDel && del(confirmDel)} onClose={() => setConfirmDel(null)} />
    </div>
  );
}
