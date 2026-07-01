import React, { useEffect, useState } from 'react';
import { Cpu, FolderOpen, Power, PlayCircle, Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * HelperRuntimePanel — configure + control the DEDICATED helper runtime (a second local llama-server for
 * query rewrite / HyDE / entailment). Honest: "running" is only shown when the server is actually
 * reachable. Full model paths never cross the bridge (only the file name). No cloud, no telemetry.
 */
type Status = {
  state: string; enabled: boolean; configured: boolean; running: boolean; reachable: boolean;
  modelName: string; port: number; error: string | null; installed: boolean;
  roles?: { task: string; provider: string; reason: string }[];
};

function StateBadge({ s }: { s: Status }) {
  const label = !s.enabled ? 'Disabled' : s.reachable ? 'Running' : s.running ? s.state : (s.state === 'ERROR' ? 'Failed' : 'Stopped');
  const cls = s.reachable ? 'text-neural-green border-neural-green/40 bg-neural-green/10'
    : s.state === 'ERROR' ? 'text-neural-red border-neural-red/50 bg-neural-red/10'
    : !s.enabled ? 'text-faint border-border bg-panel2/40' : 'text-neural-amber border-neural-amber/50 bg-neural-amber/10';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${cls}`}>{s.reachable ? <Check size={11} /> : <AlertTriangle size={11} />}{label}</span>;
}

export default function HelperRuntimePanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [ana, setAna] = useState<any>(null);
  const [showPerf, setShowPerf] = useState(false);
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<any>(null);
  const [msg, setMsg] = useState('');

  const load = () => {
    window.dawn.helperRuntime.status().then(setSt).catch(() => {});
    window.dawn.helperRuntime.analytics().then(setAna).catch(() => {});
  };
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);
  async function resetAna() { setBusy('reset'); try { await window.dawn.helperRuntime.resetAnalytics(); } catch { /* */ } setBusy(''); load(); }
  async function exportAna() { setBusy('export'); setMsg(''); try { const r = await window.dawn.helperRuntime.exportAnalytics(); if (r?.ok) setMsg(`Exported ${r.path}`); } catch { /* */ } setBusy(''); }

  async function toggle() { setBusy('toggle'); try { const r = await window.dawn.helperRuntime.updateSettings({ enabled: !st?.enabled }); setSt({ ...r.status, roles: st?.roles }); } catch { /* */ } setBusy(''); load(); }
  async function toggleWarm() { setBusy('warm'); try { await window.dawn.helperRuntime.updateSettings({ keepWarm: !st?.keepWarm }); } catch { /* */ } setBusy(''); load(); }
  async function cancelJobs() { setBusy('cancel'); try { await window.dawn.helperRuntime.cancelJobs(); } catch { /* */ } setBusy(''); load(); }
  async function clearQueue() { setBusy('clear'); try { await window.dawn.helperRuntime.clearQueue(); } catch { /* */ } setBusy(''); load(); }
  async function pick() { setBusy('pick'); setMsg(''); const r = await window.dawn.helperRuntime.pickModel(); if (r?.ok) setSt({ ...r.status, roles: st?.roles }); else if (r && !r.canceled) setMsg('Could not set that model.'); setBusy(''); load(); }
  async function ctl(action: 'start' | 'stop' | 'restart') { setBusy(action); try { setSt(await window.dawn.helperRuntime[action]()); } catch { /* */ } setBusy(''); }
  async function runTest() { setBusy('test'); setTest(null); try { setTest(await window.dawn.helperRuntime.test()); } catch { /* */ } setBusy(''); }

  if (!st) return null;
  const provColor: Record<string, string> = { helper_runtime: 'text-neural-green', chat: 'text-neural-cyan', embedding: 'text-neural-cyan', lexical: 'text-neural-amber', none: 'text-faint', disabled: 'text-faint' };

  return (
    <div className="rounded-lg border border-border bg-panel/20 p-4 mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Cpu size={16} style={{ color: 'var(--accent)' }} />
        <h3 className="text-sm font-semibold">Helper runtime</h3>
        <StateBadge s={st} />
        <span className="ml-auto text-[11px] text-faint">port {st.port}{st.installed ? '' : ' · runtime binary missing'}</span>
      </div>
      <p className="text-[11px] text-dim mb-3">A second local llama-server for query rewrite / HyDE / entailment, so helper tasks don't compete with the chat model. Optional — off by default; helpers fall back to the chat model or lexical when it isn't running.{st.error ? <span className="text-neural-red"> — {st.error}</span> : null}</p>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button onClick={toggle} disabled={!!busy} className={`text-xs px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 disabled:opacity-40 ${st.enabled ? 'border-neural-green/50 text-neural-green' : 'border-border text-dim hover:text-ink'}`}>{busy === 'toggle' ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />} {st.enabled ? 'Enabled' : 'Enable'}</button>
        <button onClick={pick} disabled={!!busy} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1.5"><FolderOpen size={13} /> Model</button>
        <span className={`text-[11px] truncate max-w-[200px] ${st.configured ? 'text-ink' : 'text-faint'}`}>{st.modelName || 'not set'}</span>
        {st.enabled ? (
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => ctl('restart')} disabled={!!busy} title="Restart" className="p-1.5 rounded-lg border border-border text-faint hover:text-ink">{busy === 'restart' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}</button>
            {st.running ? <button onClick={() => ctl('stop')} disabled={!!busy} className="text-xs px-2 py-1.5 rounded-lg border border-border text-dim hover:text-neural-red">Stop</button>
              : <button onClick={() => ctl('start')} disabled={!!busy} className="text-xs px-2 py-1.5 rounded-lg border border-border text-dim hover:text-ink">Start</button>}
            <button onClick={runTest} disabled={!!busy || !st.reachable} title={st.reachable ? 'Tiny live request' : 'Runtime not reachable'} className="text-xs px-2 py-1.5 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">{busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />} Test</button>
          </div>
        ) : null}
      </div>

      {msg ? <div className="text-[11px] text-neural-amber mb-2">{msg}</div> : null}
      {test ? (
        <div className={`text-[11px] mb-2 ${test.ok ? 'text-neural-green' : 'text-neural-amber'}`}>
          {test.ok ? <><Check size={11} className="inline mb-0.5" /> OK · {test.latencyMs}ms · {test.provider} · {test.model}</> : <><AlertTriangle size={11} className="inline mb-0.5" /> {test.error}</>}
        </div>
      ) : null}

      {st.enabled && (st as any).queue ? (
        <div className="border-t border-border/40 pt-2 mb-2 text-[11px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-faint">Queue:</span>
            <span className="text-dim">{(st as any).queue.active} active · {(st as any).queue.queued} queued / {(st as any).queue.capacity} · 1 at a time</span>
            <span className="text-faint">· done {(st as any).queue.sessionCompleted} · cancelled {(st as any).queue.sessionCancelled} · timeouts {(st as any).queue.sessionTimedOut}</span>
            {(st as any).queue.lastCancelled ? <span className="text-neural-amber">· last cancel: {(st as any).queue.lastCancelled.reason}</span> : null}
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={toggleWarm} disabled={!!busy} title="Keep the helper server loaded (uses memory/CPU) vs. stop it when idle" className={`px-2 py-0.5 rounded border ${(st as any).keepWarm ? 'border-neural-cyan/50 text-neural-cyan' : 'border-border text-faint hover:text-ink'}`}>Keep warm: {(st as any).keepWarm ? 'on' : 'off'}</button>
              <button onClick={cancelJobs} disabled={!!busy} className="px-2 py-0.5 rounded border border-border text-faint hover:text-neural-red">Cancel jobs</button>
              <button onClick={clearQueue} disabled={!!busy} className="px-2 py-0.5 rounded border border-border text-faint hover:text-ink">Clear</button>
            </div>
          </div>
          {!(st as any).keepWarm ? <div className="text-[10px] text-faint mt-0.5">Stops after {Math.round(((st as any).idleStopMs || 300000) / 60000)} min idle (keep-warm off).</div> : null}
        </div>
      ) : null}

      {st.roles?.length ? (
        <div className="border-t border-border/40 pt-2 text-[11px] space-y-0.5">
          <div className="text-faint mb-0.5">Per-role provider</div>
          {st.roles.map((r) => (
            <div key={r.task} className="flex items-center gap-2">
              <span className="w-28 text-dim">{r.task}</span>
              <span className={provColor[r.provider] || 'text-dim'}>{r.provider}</span>
              <span className="text-faint truncate">— {r.reason}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Helper performance analytics (safe metadata only — no prompt/response/chunk text) */}
      {ana ? (
        <div className="border-t border-border/40 pt-2 mt-2 text-[11px]">
          <button onClick={() => setShowPerf((v) => !v)} className="inline-flex items-center gap-1.5 text-dim hover:text-ink">
            <span className={healthColor(ana.global?.health)}>●</span> Performance: {healthLabel(ana.global?.health)}
            <span className="text-faint">· {ana.global?.totalJobs || 0} jobs · {showPerf ? 'hide' : 'details'}</span>
          </button>
          {ana.hints?.length ? <div className="text-faint mt-0.5">{ana.hints[0]}</div> : null}
          {showPerf ? (
            <div className="mt-1.5 border-l-2 border-border pl-2 space-y-1.5">
              {ana.roles?.length ? (
                <div>
                  <div className="grid grid-cols-6 gap-1 text-faint text-[10px]"><span>role</span><span>jobs</span><span>success</span><span>timeout</span><span>p50 lat</span><span>p95 lat</span></div>
                  {ana.roles.map((r: any) => (
                    <div key={r.role} className="grid grid-cols-6 gap-1 text-dim">
                      <span className="truncate">{r.role.replace('_', ' ')}</span>
                      <span>{r.jobs}</span>
                      <span>{Math.round(r.successRate * 100)}%</span>
                      <span className={r.timeoutRate > 0.2 ? 'text-neural-amber' : ''}>{Math.round(r.timeoutRate * 100)}%</span>
                      <span>{r.p50TotalMs}ms</span>
                      <span>{r.p95TotalMs}ms</span>
                    </div>
                  ))}
                  <div className="text-[10px] text-faint">p50/p95 = median / 95th-percentile total latency (queue wait + run). "insufficient data" until ≥8 samples.</div>
                </div>
              ) : <div className="text-faint">No helper jobs recorded this session yet.</div>}
              {ana.recent?.length ? (
                <div>
                  <div className="text-faint text-[10px] mb-0.5">Recent (safe metadata only)</div>
                  {ana.recent.slice(0, 8).map((e: any, i: number) => (
                    <div key={i} className="text-faint truncate">{new Date(e.ts).toLocaleTimeString()} · {e.role.replace('_', ' ')} · <span className={provColor[e.provider] || ''}>{e.provider}</span> · {e.status} · {e.totalLatencyMs}ms{e.reason ? ` · ${e.reason}` : ''}</div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <button onClick={resetAna} disabled={!!busy} className="px-2 py-0.5 rounded border border-border text-faint hover:text-ink">Reset session</button>
                <button onClick={exportAna} disabled={!!busy} className="px-2 py-0.5 rounded border border-border text-faint hover:text-ink">Export JSON (safe)</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function healthColor(h?: string): string {
  return h === 'healthy' ? 'text-neural-green' : h === 'slow' ? 'text-neural-amber' : h === 'timeout_prone' ? 'text-neural-red' : h === 'mostly_unavailable' ? 'text-neural-red' : 'text-faint';
}
function healthLabel(h?: string): string {
  return h === 'healthy' ? 'healthy' : h === 'slow' ? 'slow' : h === 'timeout_prone' ? 'timeout-prone' : h === 'mostly_unavailable' ? 'mostly unavailable' : 'insufficient data';
}
