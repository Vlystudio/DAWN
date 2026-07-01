import React from 'react';
import { Check, AlertTriangle, Circle, ArrowRight, Settings as Cog } from 'lucide-react';
import { Badge } from '../ui/primitives';
import { resolveStatus } from '../lib/statusMap';

/**
 * SetupChecklist — a reusable, design-system checklist row list used by the Setup Center (and
 * usable by onboarding). Each row reflects a real status from System Health and offers next-step
 * actions (open / set up). No fake "complete" — status comes from the caller, which derives it from
 * featureMaturity.
 */

export type SetupStatus = 'COMPLETE' | 'PARTIAL' | 'BLOCKED_BY_SETUP' | 'BROKEN' | 'MISSING' | string;

export interface SetupRow {
  id: string; name: string; summary: string; status: SetupStatus; required?: boolean;
  requiredSetup?: string; nextAction?: string; route?: string; settingsRoute?: string;
}

function Icon({ status }: { status: SetupStatus }) {
  if (status === 'COMPLETE') return <Check size={15} className="text-neural-green" aria-hidden />;
  if (status === 'BROKEN') return <AlertTriangle size={15} className="text-neural-red" aria-hidden />;
  return <Circle size={15} className="text-faint" aria-hidden />;
}

export default function SetupChecklist({ rows, onNav }: { rows: SetupRow[]; onNav?: (view: string) => void }) {
  if (!rows.length) return <div className="text-sm text-faint text-center py-6">Nothing to set up here.</div>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="rounded-lg border border-border bg-panel/20 p-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5"><Icon status={r.status} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{r.name}</span>
                <Badge kind={resolveStatus('feature', r.status).tone}>{resolveStatus('feature', r.status).label}</Badge>
                <span className="text-[10px] text-faint">{r.required ? 'recommended' : 'optional'}</span>
              </div>
              <p className="text-xs text-dim mt-0.5">{r.summary}</p>
              {r.requiredSetup ? <div className="text-[11px] text-neural-amber/90 mt-1"><span className="font-medium">Setup:</span> {r.requiredSetup}</div> : null}
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              {r.status !== 'COMPLETE' && (r.settingsRoute || r.route) && onNav ? (
                <button onClick={() => onNav((r.settingsRoute || r.route)!)} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border text-sm font-medium" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}><Cog size={11} /> Set up</button>
              ) : null}
              {r.route && onNav ? <button onClick={() => onNav(r.route!)} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border text-faint hover:text-ink">Open <ArrowRight size={10} /></button> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
