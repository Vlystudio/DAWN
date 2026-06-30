import React, { useState } from 'react';
import { Link2, X, Check, AlertTriangle } from 'lucide-react';
import WorkspaceItemPicker from './WorkspaceItemPicker';

/**
 * WorkspaceLinkDialog — visually link a source item to another. Choose a relationship type, then
 * pick the target via WorkspaceItemPicker (no IDs). Creates the link through window.dawn.workspace.
 * createLink, which blocks self/invalid links and returns a friendly "already linked" result for
 * duplicates (surfaced here, never a crash).
 */

const LINK_TYPES = ['related_to', 'references', 'created_from', 'summarizes', 'expands_on', 'attached_to', 'converted_to', 'uses_source', 'uses_memory', 'uses_tool', 'uses_model', 'generated_by', 'scheduled_as', 'assigned_to', 'exported_to', 'imported_from'];

export default function WorkspaceLinkDialog({ open, sourceItem, onClose, onLinked }: {
  open: boolean; sourceItem: { id: string; label: string } | null; onClose: () => void; onLinked?: () => void;
}) {
  const [type, setType] = useState('related_to');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  if (!open || !sourceItem) return null;

  const pick = async (target: { id: string; label: string }) => {
    setPickerOpen(false);
    try {
      const r = await (window as any).dawn.workspace.createLink({ fromId: sourceItem.id, toId: target.id, type });
      if (r?.ok && r.deduped) setResult({ tone: 'warn', text: `Already linked to “${target.label}”.` });
      else if (r?.ok) { setResult({ tone: 'ok', text: `Linked to “${target.label}”.` }); onLinked?.(); }
      else setResult({ tone: 'err', text: r?.error || 'Could not create the link.' });
    } catch (e: any) { setResult({ tone: 'err', text: String(e?.message || e) }); }
  };

  return (
    <div className="fixed inset-0 z-[84] grid place-items-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Link items">
      <div className="glass w-full max-w-sm border border-border p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Link2 size={16} style={{ color: 'var(--accent)' }} aria-hidden />
          <span className="font-semibold text-sm">Link item</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-faint hover:text-ink"><X size={16} /></button>
        </div>
        <div className="text-xs text-dim mb-2">From <b className="text-ink">{sourceItem.label}</b></div>
        <label className="block text-xs text-dim mb-3">Relationship
          <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full bg-bg/70 border border-border rounded-lg px-2 py-1.5 text-sm">
            {LINK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <button onClick={() => { setResult(null); setPickerOpen(true); }} className="w-full px-3 py-1.5 rounded-lg border text-sm font-semibold" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>
          Choose target item…
        </button>
        {result ? (
          <div className={`mt-3 text-[11px] inline-flex items-start gap-1.5 ${result.tone === 'ok' ? 'text-neural-green' : result.tone === 'warn' ? 'text-neural-amber' : 'text-neural-red'}`}>
            {result.tone === 'ok' ? <Check size={12} className="mt-0.5" /> : <AlertTriangle size={12} className="mt-0.5" />} {result.text}
          </div>
        ) : null}
      </div>
      <WorkspaceItemPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={pick} excludeId={sourceItem.id} title="Pick the item to link to" />
    </div>
  );
}
