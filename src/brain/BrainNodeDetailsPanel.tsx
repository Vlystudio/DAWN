import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Pin, Trash2, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { COLORS } from './BrainState';

/** Details panel shown when a brain node is clicked in the Explorer. */
export default function BrainNodeDetailsPanel({
  detail,
  onClose,
  onPin,
  onForget,
  onOpen,
}: {
  detail: any;
  onClose: () => void;
  onPin: (node: any) => void;
  onForget: (node: any) => void;
  onOpen: (node: any) => void;
}) {
  return (
    <AnimatePresence>
      {detail && detail.node && (
        <motion.div
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          className="absolute top-3 right-3 bottom-3 w-[330px] glass p-4 overflow-y-auto z-20"
        >
          <Panel detail={detail} onClose={onClose} onPin={onPin} onForget={onForget} onOpen={onOpen} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Panel({ detail, onClose, onPin, onForget, onOpen }: any) {
  const n = detail.node;
  const meta = safe(n.metadata_json);
  const color = (COLORS as any)[n.color_group] || COLORS.cyan;
  const isMemory = n.type === 'memory';
  const isConversation = n.type === 'conversation';
  const isRule = n.type === 'rule';

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
          <span className="text-xs uppercase tracking-wide text-faint">{n.type.replace('_', ' ')}</span>
        </div>
        <button className="text-faint hover:text-ink" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="text-base font-semibold text-ink mb-1">{n.title}</div>
      {n.summary && n.summary !== n.title ? <div className="text-sm text-dim mb-3 whitespace-pre-wrap">{n.summary}</div> : null}

      <div className="space-y-1 text-xs mb-3">
        {n.created_at ? <Row label="Created" value={new Date(n.created_at).toLocaleString()} /> : null}
        {n.updated_at && n.updated_at !== n.created_at ? <Row label="Updated" value={new Date(n.updated_at).toLocaleString()} /> : null}
        <Row label="Importance" value={(n.importance ?? 0).toFixed(2)} />
        <Row label="Confidence" value={(n.confidence ?? 0).toFixed(2)} />
        {meta.protected !== undefined ? <Row label="Rule" value={meta.protected ? 'Protected (system)' : 'Editable'} /> : null}
        {meta.priority ? <Row label="Priority" value={String(meta.priority)} /> : null}
        {meta.last_used_at ? <Row label="Last used" value={new Date(meta.last_used_at).toLocaleString()} /> : null}
      </div>

      {detail.related?.length ? (
        <div className="mb-3">
          <div className="text-xs uppercase tracking-wide text-faint mb-1">Connected</div>
          <div className="flex flex-wrap gap-1.5">
            {detail.related.slice(0, 12).map((r: any) => (
              <span key={r.id} className="text-[11px] px-2 py-0.5 rounded-md bg-panel2/60 border border-border text-dim">
                {r.title?.slice(0, 26) || r.type}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        {isConversation ? (
          <Button size="sm" variant="primary" onClick={() => onOpen(n)}>
            <ExternalLink size={13} /> Open chat
          </Button>
        ) : null}
        {isMemory ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => onPin(n)}>
              <Pin size={13} /> {meta.pinned ? 'Unpin' : 'Pin'}
            </Button>
            <Button size="sm" variant="danger" onClick={() => onForget(n)}>
              <Trash2 size={13} /> Forget
            </Button>
          </>
        ) : null}
        {isRule && meta.protected ? <span className="text-[11px] text-faint self-center">Protected rule — not editable.</span> : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-faint">{label}</span>
      <span className="text-dim text-right">{value}</span>
    </div>
  );
}

function safe(s: string) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}
