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
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<any>(null);
  const [msg, setMsg] = useState('');

  const load = () => window.dawn.helperRuntime.status().then(setSt).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);

  async function toggle() { setBusy('toggle'); try { const r = await window.dawn.helperRuntime.updateSettings({ enabled: !st?.enabled }); setSt({ ...r.status, roles: st?.roles }); } catch { /* */ } setBusy(''); load(); }
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
    </div>
  );
}
