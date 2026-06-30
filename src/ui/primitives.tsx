import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Lock, ShieldCheck, X } from 'lucide-react';
import { badge as badgeOf } from '../lib/uiCore';

/**
 * primitives.tsx — DAWN's shared UI building blocks so every screen looks/behaves
 * consistently: risk/status Badge, EmptyState, Spinner, ErrorCallout, SectionHeader,
 * and an accessible ConfirmDialog (focus trap-ish, Esc to close, danger needs explicit click).
 */

export function Badge({ kind, children }: { kind: string; children?: React.ReactNode }) {
  const b = badgeOf(kind);
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${b.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${b.dot}`} aria-hidden /> {children || b.label}
    </span>
  );
}

export function Spinner({ size = 14, label }: { size?: number; label?: string }) {
  return <span className="inline-flex items-center gap-1.5 text-faint text-xs" role="status" aria-live="polite"><Loader2 size={size} className="animate-spin motion-reduce:animate-none" />{label}</span>;
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="h-full grid place-items-center text-center p-8">
      <div className="max-w-sm">
        {icon ? <div className="text-faint mx-auto mb-3 grid place-items-center" aria-hidden>{icon}</div> : null}
        <div className="text-lg font-semibold">{title}</div>
        {body ? <p className="text-sm text-dim mt-1">{body}</p> : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

export function ErrorCallout({ title = 'Something went wrong', message, detail, onRetry }: { title?: string; message?: string; detail?: string; onRetry?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-neural-red/40 bg-neural-red/10 rounded-lg p-3 text-sm" role="alert">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="text-neural-red mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-neural-red">{title}</div>
          {message ? <div className="text-dim text-xs mt-0.5">{message}</div> : null}
          {detail ? <button onClick={() => setOpen((v) => !v)} className="text-[11px] text-faint hover:text-ink mt-1 underline-offset-2 hover:underline">{open ? 'Hide details' : 'Show details'}</button> : null}
          {open && detail ? <pre className="text-[10px] text-faint mt-1 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{detail}</pre> : null}
        </div>
        {onRetry ? <button onClick={onRetry} className="text-xs px-2 py-1 rounded-lg border border-border text-dim hover:text-ink shrink-0">Retry</button> : null}
      </div>
    </div>
  );
}

export function SectionHeader({ icon, title, hint, right }: { icon?: React.ReactNode; title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {icon ? <span style={{ color: 'var(--accent)' }} aria-hidden>{icon}</span> : null}
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
      {right ? <div className="ml-auto">{right}</div> : null}
    </div>
  );
}

/** A short, dismissible inline help note. Keep the text brief. */
export function HelpNote({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-faint flex items-start gap-1.5 mb-2"><ShieldCheck size={12} className="mt-0.5 shrink-0 opacity-70" aria-hidden />{children}</div>;
}

/**
 * Accessible confirm dialog. Esc closes (unless `danger` — danger requires an explicit click,
 * never Enter). Focus moves to the dialog on open. Color is never the only signal (icon + text).
 */
export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, locked, onConfirm, onClose }: {
  open: boolean; title: string; body?: React.ReactNode; confirmLabel?: string; danger?: boolean; locked?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !danger) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, danger, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()} className={`glass w-full max-w-md p-5 outline-none border ${danger ? 'border-neural-red/50' : 'border-border'}`}>
        <div className="flex items-center gap-2 mb-2">
          {danger ? <AlertTriangle size={16} className="text-neural-red" aria-hidden /> : locked ? <Lock size={16} className="text-neural-amber" aria-hidden /> : null}
          <span className="font-semibold">{title}</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-faint hover:text-ink"><X size={16} /></button>
        </div>
        {body ? <div className="text-sm text-dim mb-4">{body}</div> : null}
        <div className="flex items-center gap-2">
          <button onClick={onConfirm} className={`px-3.5 py-1.5 rounded-lg border font-semibold text-sm ${danger ? 'border-neural-red/60 text-neural-red' : ''}`} style={danger ? undefined : { color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>{confirmLabel}</button>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-faint text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default { Badge, Spinner, EmptyState, ErrorCallout, SectionHeader, HelpNote, ConfirmDialog };
