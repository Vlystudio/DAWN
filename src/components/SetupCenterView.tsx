import React, { useEffect, useMemo, useState } from 'react';
import { ListChecks, RefreshCw } from 'lucide-react';
import { SectionHeader, EmptyState } from '../ui/primitives';
import { PageShell, LoadingState, ErrorState, Button } from '../ui/system';
import SetupChecklist, { SetupRow } from './SetupChecklist';

/**
 * SetupCenterView — a setup-focused lens over the honest System Health data. It groups the areas
 * that benefit from setup (model, knowledge, security, backup, email, integrations) into a checklist
 * with real status + deep links. It never marks anything complete on its own — status comes straight
 * from featureMaturity (maturity:list). Reachable from the sidebar and the command palette.
 */

const CATEGORIES: { title: string; ids: string[]; required?: boolean }[] = [
  { title: 'Essentials', ids: ['chat', 'models', 'optimizer', 'knowledge', 'backup'], required: true },
  { title: 'Security', ids: ['security', 'totp', 'vault'], required: true },
  { title: 'Communication', ids: ['email', 'calendar'] },
  { title: 'Integrations', ids: ['obsidian', 'notion', 'voice', 'vision', 'companion', 'dcd'] },
];

export default function SetupCenterView({ onNav }: { onNav?: (view: string) => void }) {
  const [reports, setReports] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (run = false) => {
    run ? setChecking(true) : setLoading(true); setError(null);
    try { const res = run ? await (window as any).dawn.maturity.check() : await (window as any).dawn.maturity.list(); setReports(res?.reports || []); }
    catch (e: any) { setError(String(e?.message || e)); }
    finally { setLoading(false); setChecking(false); }
  };
  useEffect(() => { load(false); }, []);

  const byId = useMemo(() => Object.fromEntries((reports || []).map((r) => [r.id, r])), [reports]);
  const groups = useMemo(() => CATEGORIES.map((cat) => ({
    title: cat.title,
    rows: cat.ids.map((id) => byId[id]).filter(Boolean).map((r: any): SetupRow => ({
      id: r.id, name: r.name, summary: r.summary, status: r.status, required: cat.required,
      requiredSetup: r.requiredSetup, nextAction: r.nextAction, route: r.route, settingsRoute: r.settingsRoute,
    })),
  })), [byId]);

  const needsAttention = (reports || []).filter((r) => ['BLOCKED_BY_SETUP', 'BROKEN'].includes(r.status) && CATEGORIES.some((c) => c.ids.includes(r.id))).length;

  return (
    <PageShell
      width="max-w-3xl"
      icon={<ListChecks size={22} />}
      title="Setup Center"
      subtitle={<>What's configured, what needs attention, and what's optional — pulled live from System Health. {needsAttention > 0 ? <span className="text-neural-amber">{needsAttention} item{needsAttention === 1 ? '' : 's'} need setup.</span> : <span className="text-neural-green">Essentials look good.</span>}</>}
      actions={<Button variant="primary" onClick={() => load(true)} disabled={checking}><RefreshCw size={14} className={checking ? 'animate-spin' : ''} aria-hidden /> {checking ? 'Checking…' : 'Check again'}</Button>}
    >
      {error ? <ErrorState title="Couldn't load setup status" message={error} onRetry={() => load(false)} /> : null}
      {loading && !reports ? <LoadingState label="Loading setup status…" /> :
        !reports ? <EmptyState title="No data" body="Run a health check to populate setup status." /> :
          groups.map((g) => g.rows.length ? (
            <div key={g.title} className="mt-5">
              <SectionHeader title={g.title} hint={`${g.rows.filter((r) => r.status === 'COMPLETE').length}/${g.rows.length} ready`} />
              <SetupChecklist rows={g.rows} onNav={onNav} />
            </div>
          ) : null)}

      <div className="mt-6 text-[11px] text-faint">First-run setup covers model + memory + knowledge. Per-feature setup (email, security, integrations) lives here and in each feature's page. This page never marks anything complete on its own — it reflects real System Health.</div>
    </PageShell>
  );
}
