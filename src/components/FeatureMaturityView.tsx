import React, { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, ArrowRight, ExternalLink } from 'lucide-react';
import { Badge, Spinner, ErrorCallout, SectionHeader, EmptyState } from '../ui/primitives';

/** Status → badge kind (mirrors featureMaturityCore.statusTone; kept local to avoid a cross-boundary import). */
const STATUS_TONE: Record<string, string> = {
  COMPLETE: 'ok', PARTIAL: 'warning', BLOCKED_BY_SETUP: 'locked', BROKEN: 'error', STUB: 'disabled', MISSING: 'disabled',
};
const statusTone = (s: string) => STATUS_TONE[s] || 'disabled';

/**
 * FeatureMaturityView — DAWN's honest internal completion dashboard ("System Health"). It shows,
 * per feature area: status, what works, what's missing, required setup, last health check, last
 * error, and a next-action button that deep-links to the relevant page. Never fabricates state —
 * every row comes from a live evaluation of real persisted data (electron/services/featureMaturity).
 */

type Report = {
  id: string; name: string; group: string; route?: string; settingsRoute?: string; docs?: string;
  summary: string; status: string; works: string[]; missing: string[]; requiredSetup?: string;
  nextAction?: string; lastError?: string | null; lastCheckedAt?: number | null;
};
type Payload = { reports: Report[]; summary: { total: number; byStatus: Record<string, number>; completionPct: number }; checkedAt?: number };

const STATUS_LABEL: Record<string, string> = {
  COMPLETE: 'Complete', PARTIAL: 'Partial', BLOCKED_BY_SETUP: 'Needs setup',
  STUB: 'Stub', BROKEN: 'Broken', MISSING: 'Missing',
};

function when(ts?: number | null): string {
  if (!ts) return 'never';
  const d = Math.round((Date.now() - ts) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function FeatureMaturityView({ onNav }: { onNav?: (view: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const load = async (run = false) => {
    try {
      run ? setChecking(true) : setLoading(true);
      setError(null);
      const res = run ? await (window as any).dawn.maturity.check() : await (window as any).dawn.maturity.list();
      setData(res);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false); setChecking(false);
    }
  };
  useEffect(() => { load(false); }, []);

  const groups = useMemo(() => {
    const reports = (data?.reports || []).filter((r) => filter === 'all' || r.status === filter);
    const by: Record<string, Report[]> = {};
    for (const r of reports) (by[r.group] ||= []).push(r);
    return by;
  }, [data, filter]);

  const s = data?.summary;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-start gap-3 mb-1">
          <Activity size={22} style={{ color: 'var(--accent)' }} className="mt-0.5" aria-hidden />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">System Health</h1>
            <p className="text-sm text-dim">An honest, live map of every DAWN feature — status, what works, what's missing, and the next step. Nothing here is mocked.</p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={checking}
            className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold disabled:opacity-60"
            style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}
          >
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} aria-hidden /> {checking ? 'Checking…' : 'Run health checks'}
          </button>
        </div>

        {error ? <div className="mt-4"><ErrorCallout title="Couldn't load System Health" message={error} onRetry={() => load(false)} /></div> : null}

        {loading && !data ? (
          <div className="mt-8"><Spinner size={18} label="Loading feature map…" /></div>
        ) : !data ? (
          <EmptyState icon={<Activity size={28} />} title="No data" body="Run health checks to populate the feature map." />
        ) : (
          <>
            {/* summary bar */}
            <div className="mt-4 rounded-xl border border-border bg-panel/30 p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm">
                  <span className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>{s?.completionPct ?? 0}%</span>
                  <span className="text-dim ml-2">overall completion · {s?.total ?? 0} areas{data.checkedAt ? ` · checked ${when(data.checkedAt)}` : ''}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(['all', 'COMPLETE', 'PARTIAL', 'BLOCKED_BY_SETUP', 'BROKEN', 'MISSING'] as const).map((k) => {
                    const cnt = k === 'all' ? (s?.total ?? 0) : (s?.byStatus?.[k] ?? 0);
                    const active = filter === k;
                    return (
                      <button key={k} onClick={() => setFilter(k)}
                        className={`text-[11px] px-2 py-1 rounded-lg border transition-colors ${active ? 'bg-panel2/70 text-ink border-border' : 'text-dim border-border/60 hover:text-ink'}`}>
                        {k === 'all' ? 'All' : STATUS_LABEL[k]} <span className="text-faint">({cnt})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* completion meter */}
              <div className="mt-3 h-1.5 rounded-full bg-panel2/60 overflow-hidden" role="progressbar" aria-valuenow={s?.completionPct ?? 0} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full" style={{ width: `${s?.completionPct ?? 0}%`, background: 'var(--accent)' }} />
              </div>
            </div>

            {Object.keys(groups).length === 0 ? (
              <div className="mt-6"><EmptyState title="Nothing matches this filter" body="Try a different status filter." /></div>
            ) : (
              Object.entries(groups).map(([group, reports]) => (
                <div key={group} className="mt-6">
                  <SectionHeader title={group} hint={`${reports.length} area${reports.length === 1 ? '' : 's'}`} />
                  <div className="grid gap-2">
                    {reports.map((r) => (
                      <div key={r.id} className="rounded-lg border border-border bg-panel/20 p-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm">{r.name}</span>
                              <Badge kind={statusTone(r.status as any)}>{STATUS_LABEL[r.status] || r.status}</Badge>
                              <span className="text-[11px] text-faint">checked {when(r.lastCheckedAt)}</span>
                            </div>
                            <p className="text-xs text-dim mt-0.5">{r.summary}</p>

                            {r.works.length > 0 ? (
                              <ul className="mt-1.5 text-[11px] text-dim space-y-0.5">
                                {r.works.map((w, i) => <li key={i} className="flex items-start gap-1.5"><span className="text-neural-green mt-0.5" aria-hidden>✓</span><span>{w}</span></li>)}
                              </ul>
                            ) : null}
                            {r.missing.length > 0 ? (
                              <ul className="mt-1 text-[11px] text-faint space-y-0.5">
                                {r.missing.map((m, i) => <li key={i} className="flex items-start gap-1.5"><span className="text-neural-amber mt-0.5" aria-hidden>•</span><span>{m}</span></li>)}
                              </ul>
                            ) : null}
                            {r.requiredSetup ? <div className="mt-1.5 text-[11px] text-neural-amber/90"><span className="font-medium">Setup:</span> {r.requiredSetup}</div> : null}
                            {r.lastError ? <div className="mt-1.5 text-[11px] text-neural-red">Last error: {r.lastError}</div> : null}
                          </div>
                          <div className="shrink-0 flex flex-col items-end gap-1.5">
                            {r.route && onNav ? (
                              <button onClick={() => onNav(r.route!)} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border text-dim hover:text-ink">
                                Open <ArrowRight size={11} aria-hidden />
                              </button>
                            ) : null}
                            {r.settingsRoute && r.settingsRoute !== r.route && onNav ? (
                              <button onClick={() => onNav(r.settingsRoute!)} className="text-[11px] px-2 py-1 rounded-lg border border-border/60 text-faint hover:text-ink">Setup</button>
                            ) : null}
                            {r.docs ? (
                              <button onClick={() => (window as any).dawn.openExternal?.(`https://github.com/Vlystudio/DAWN/blob/main/docs/${r.docs}`)} className="inline-flex items-center gap-1 text-[11px] text-faint hover:text-ink" title={`docs/${r.docs}`}>
                                Docs <ExternalLink size={10} aria-hidden />
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {r.nextAction && !r.route ? <div className="mt-2 text-[11px] text-faint italic">Next: {r.nextAction}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
