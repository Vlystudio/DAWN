import React, { useEffect, useState } from 'react';
import { BookOpen, RefreshCw, Cpu } from 'lucide-react';
import { PageShell, StatusBadge, LoadingState, ErrorState, EmptyState, Button, DataTable } from '../ui/system';

/**
 * ModelCookbookView — "which installed model is best for what, and will it run here." Pulls real data
 * from window.dawn.models.cookbook (optimizer compatibility + detected hardware + catalog roles +
 * real benchmark tok/s). Nothing is invented: missing hardware → "Unknown hardware", no benchmark →
 * "Needs benchmark", unknown role → blank. Built on the shared design system (PageShell/DataTable).
 */

type Entry = { modelId: string; friendlyName: string; actualName: string; roles: string[]; level: string; fitLabel: string; recommended: boolean; needsBenchmark: boolean; benchmarkTps?: number | null; why: string };
type Cookbook = { hardware: { gpu: string | null; vramGB: number | null; detected: boolean }; entries: Entry[]; bestForRole: Record<string, Entry>; roleLabels: Record<string, string> };

const FIT_TONE: Record<string, string> = { 'Fits in VRAM': 'ok', 'Partial offload': 'warning', 'CPU fallback': 'warning', 'Too large / not recommended': 'error', 'Unknown hardware': 'disabled' };

export default function ModelCookbookView({ onNav }: { onNav?: (view: string) => void }) {
  const [data, setData] = useState<Cookbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { setData(await (window as any).dawn.models.cookbook()); }
    catch (e: any) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const hw = data?.hardware;
  const best = data?.bestForRole || {};
  const roleLabels = data?.roleLabels || {};

  return (
    <PageShell
      icon={<BookOpen size={22} />}
      title="Model Cookbook"
      subtitle={hw ? (hw.detected ? <>Hardware: <span className="text-ink">{hw.gpu || 'GPU'}{hw.vramGB ? ` · ${hw.vramGB} GB VRAM` : ''}</span> — recommendations below reflect what fits.</> : <span className="text-neural-amber inline-flex items-center gap-1"><Cpu size={12} /> Hardware not fully detected — fit labels show “Unknown hardware”. Run a benchmark to confirm.</span>) : 'Which installed model is best for what, and what your hardware can run.'}
      actions={<Button variant="primary" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</Button>}
    >
      {error ? <ErrorState title="Couldn't load the cookbook" message={error} onRetry={load} /> : null}
      {loading && !data ? <LoadingState label="Analyzing installed models…" /> :
        !data || data.entries.length === 0 ? (
          <EmptyState icon={<BookOpen size={28} />} title="No installed models" body="Download or import a GGUF model, then come back." action={onNav ? <Button variant="primary" onClick={() => onNav('hub')}>Open Model Hub</Button> : undefined} />
        ) : (
          <>
            {/* best-for-role cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
              {Object.entries(best).map(([role, e]) => (
                <div key={role} className="rounded-lg border border-border bg-panel/20 p-3">
                  <div className="text-[10px] text-faint uppercase tracking-wide">Best for {roleLabels[role] || role}</div>
                  <div className="text-sm font-medium truncate mt-0.5" title={e.actualName}>{e.friendlyName}</div>
                  <div className="mt-1"><StatusBadge status={e.recommended ? 'COMPLETE' : 'PARTIAL'}>{e.fitLabel}</StatusBadge></div>
                </div>
              ))}
              {Object.keys(best).length === 0 ? <div className="col-span-full text-xs text-faint">No role recommendations yet — add models with known roles, or run a benchmark.</div> : null}
            </div>

            {/* all installed models */}
            <DataTable<Entry>
              rowKey={(e) => e.modelId}
              empty="No installed models."
              columns={[
                { key: 'name', header: 'Model', render: (e) => <div><div className="font-medium truncate max-w-[220px]" title={e.actualName}>{e.friendlyName}</div><div className="text-[10px] text-faint truncate max-w-[220px]">{e.actualName}</div></div> },
                { key: 'roles', header: 'Good for', render: (e) => <span className="text-xs text-dim">{e.roles.map((r) => roleLabels[r] || r).join(', ') || <span className="text-faint">unknown</span>}</span> },
                { key: 'fit', header: 'Hardware fit', render: (e) => <span className={`text-[11px] px-2 py-0.5 rounded-full border ${tone(FIT_TONE[e.fitLabel])}`}>{e.fitLabel}</span> },
                { key: 'bench', header: 'Speed', render: (e) => e.benchmarkTps != null ? <span className="text-xs text-neural-green">{e.benchmarkTps.toFixed(1)} tok/s</span> : <span className="text-[11px] text-neural-amber">Needs benchmark</span> },
                { key: 'why', header: 'Why', render: (e) => <span className="text-[11px] text-faint">{e.why}</span>, className: 'max-w-[260px]' },
              ]}
              rows={data.entries}
            />
            <div className="mt-3 text-[11px] text-faint">Recommendations come from real compatibility analysis on your detected hardware and any real benchmark you've run — nothing here is faked. Apply settings in <button className="underline-offset-2 hover:underline" onClick={() => onNav?.('optimizer')}>Optimizer</button>.</div>
          </>
        )}
    </PageShell>
  );
}

function tone(kind?: string): string {
  switch (kind) {
    case 'ok': return 'text-neural-green border-neural-green/40 bg-neural-green/10';
    case 'warning': return 'text-neural-amber border-neural-amber/50 bg-neural-amber/10';
    case 'error': return 'text-neural-red border-neural-red/50 bg-neural-red/10';
    default: return 'text-faint border-border bg-panel2/40';
  }
}
