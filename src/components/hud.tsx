import React from 'react';
import { cn } from '../lib/cn';

/**
 * hud.tsx — small reusable HUD primitives so the futuristic styling stays
 * consistent (and functional) across the app.
 */

/** A pulsing status indicator dot. `live` rings it; `color` overrides accent. */
export function StatusDot({ live = false, color, className }: { live?: boolean; color?: string; className?: string }) {
  const c = color || 'var(--accent)';
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)}>
      {live ? (
        <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: c }} />
      ) : null}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
    </span>
  );
}

/** A labelled readout: a faint mono label above a value. */
export function Readout({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="hud-label leading-none">{label}</div>
      <div className="text-xs text-ink/90 truncate mt-1 font-mono">{value}</div>
    </div>
  );
}

/** Wrap children in a corner-bracket HUD frame. */
export function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('relative hud-corners', className)}>{children}</div>;
}
