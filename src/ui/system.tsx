import React from 'react';
import { Badge, Spinner, ErrorCallout, EmptyState } from './primitives';
import { resolveStatus } from '../lib/statusMap';

/**
 * system.tsx — DAWN's shared "design system" layer built on top of primitives.tsx. These give every
 * screen the same page header, status/health badges, loading/error states, action bars, and a simple
 * data table. Additive and presentational only — adopting them never changes business logic. New
 * screens use these; legacy screens are migrated incrementally (System Health tracks adoption).
 */

/** Consistent page wrapper: centered max-width column with a standard header (title + subtitle + actions). */
export function PageShell({ icon, title, subtitle, actions, children, width = 'max-w-5xl' }: {
  icon?: React.ReactNode; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; width?: string;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={`${width} mx-auto p-6`}>
        <div className="flex items-start gap-3 mb-4">
          {icon ? <span style={{ color: 'var(--accent)' }} className="mt-0.5 shrink-0" aria-hidden>{icon}</span> : null}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{title}</h1>
            {subtitle ? <p className="text-sm text-dim">{subtitle}</p> : null}
          </div>
          {actions ? <div className="shrink-0 flex items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Maturity/feature status → a labelled badge, from the central status map (one source of truth). */
export function StatusBadge({ status, group = 'feature', children }: { status: string; group?: import('../lib/statusMap').StatusGroup; children?: React.ReactNode }) {
  const d = resolveStatus(group, status);
  return <Badge kind={d.tone}>{children || d.label}</Badge>;
}

/** Health badge: ok/warning/error/locked/disabled with an optional label. */
export function HealthBadge({ tone, children }: { tone: string; children?: React.ReactNode }) {
  return <Badge kind={tone}>{children}</Badge>;
}

/** Consistent loading + error states (thin wrappers so every screen looks the same). */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="py-8 grid place-items-center"><Spinner size={18} label={label} /></div>;
}
export function ErrorState({ title, message, detail, onRetry }: { title?: string; message?: string; detail?: string; onRetry?: () => void }) {
  return <div className="py-2"><ErrorCallout title={title} message={message} detail={detail} onRetry={onRetry} /></div>;
}
export { EmptyState };

/** A right-aligned action bar for buttons. */
export function ActionBar({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex items-center gap-2 flex-wrap ${className}`}>{children}</div>;
}

/** A primary/secondary button with consistent styling + visible focus ring. */
export function Button({ variant = 'secondary', children, ...props }: { variant?: 'primary' | 'secondary' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] outline-none disabled:opacity-50';
  if (variant === 'primary') return <button {...props} className={`${base} font-semibold`} style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>{children}</button>;
  if (variant === 'danger') return <button {...props} className={`${base} border-neural-red/60 text-neural-red`}>{children}</button>;
  return <button {...props} className={`${base} border-border text-dim hover:text-ink`}>{children}</button>;
}

/** A simple, consistent data table. Columns map a row → cell; `empty` shows when there are no rows. */
export interface Column<T> { key: string; header: string; render: (row: T) => React.ReactNode; className?: string }
export function DataTable<T>({ columns, rows, empty = 'No rows.', rowKey, onRowClick }: {
  columns: Column<T>[]; rows: T[]; empty?: string; rowKey: (row: T, i: number) => string; onRowClick?: (row: T) => void;
}) {
  if (!rows.length) return <div className="text-sm text-faint text-center py-6">{empty}</div>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left">{columns.map((c) => <th key={c.key} className={`px-3 py-2 text-[11px] font-medium text-faint uppercase tracking-wide ${c.className || ''}`}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className={`border-b border-border/50 ${onRowClick ? 'cursor-pointer hover:bg-panel/40' : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.className || ''}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default { PageShell, StatusBadge, HealthBadge, LoadingState, ErrorState, EmptyState, ActionBar, Button, DataTable };
