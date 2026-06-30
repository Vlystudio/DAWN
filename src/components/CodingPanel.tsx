import React, { useEffect, useRef, useState } from 'react';
import {
  Code2, FolderPlus, Play, Square, RotateCcw, Trash2, GitBranch, ShieldCheck,
  AlertTriangle, RefreshCw, CheckCircle2, XCircle, Cpu,
} from 'lucide-react';
import { StatusDot } from './hud';

/**
 * CodingPanel — DAWN's local Coding Autopilot. Select a trusted workspace, choose an
 * autonomy mode + limits, give a task, and DAWN reads/edits/creates files, runs safe tests,
 * iterates, and shows the diff — all confined to the workspace, checkpointed, and reversible.
 */
const MODES = [
  { key: 'chat_only', label: 'Chat only', desc: 'Explain/plan, no edits.' },
  { key: 'propose_patch', label: 'Propose', desc: 'Propose changes; you apply.' },
  { key: 'workspace_autopilot', label: 'Autopilot', desc: 'Edit inside the workspace; checkpointed.' },
  { key: 'batch_review', label: 'Batch + review', desc: 'Iterate, then review the final diff.' },
];
const STATUS_COLOR: Record<string, string> = {
  completed: 'var(--neural-green,#34d399)', failed: 'var(--neural-red,#ef4444)', rolled_back: '#94a3b8',
  awaiting_approval: 'var(--neural-amber,#f59e0b)', planning: 'var(--neural-cyan,#38bdf8)',
  editing: 'var(--neural-cyan,#38bdf8)', testing: 'var(--neural-cyan,#38bdf8)', fixing: 'var(--neural-amber,#f59e0b)', reading: 'var(--neural-cyan,#38bdf8)',
};

function Btn({ onClick, disabled, children, title, danger }: any) {
  return <button onClick={onClick} disabled={disabled} title={title}
    className={'px-2.5 py-1.5 rounded-md border text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed '
      + (danger ? 'border-neural-red/50 text-neural-red hover:bg-neural-red/10' : 'border-border/60 bg-panel/40 hover:bg-panel2/60')}>{children}</button>;
}

export default function CodingPanel() {
  const cg = (window as any).dawn?.coding;
  const [wss, setWss] = useState<any[]>([]);
  const [sel, setSel] = useState<string>('');
  const [info, setInfo] = useState<any>(null);
  const [task, setTask] = useState('');
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [approval, setApproval] = useState<any>(null);
  const [diff, setDiff] = useState('');
  const runningRef = useRef(false);

  const refresh = async () => { const list = await cg.listWorkspaces(); setWss(list); if (!sel && list[0]) selectWs(list[0].workspace_id); };
  const selectWs = async (id: string) => { setSel(id); setInfo(await cg.workspaceInfo(id)); setRun(null); setDiff(''); };

  useEffect(() => {
    if (!cg) return;
    refresh();
    const offU = cg.onUpdate?.((r: any) => { if (r.workspace_id === sel) setRun(r); });
    const offA = cg.onApproval?.((a: any) => setApproval(a));
    return () => { offU?.(); offA?.(); };
  }, [sel]);

  const addWs = async () => {
    const folder = await cg.pickFolder(); if (!folder) return;
    setBusy('add');
    const r = await cg.addWorkspace(folder);
    setBusy('');
    if (!r.ok) { alert('Cannot use this folder: ' + r.reason); return; }
    await refresh(); selectWs(r.workspace.workspace_id);
  };
  const removeWs = async (id: string) => { if (!confirm('Remove this workspace from DAWN? (your files are untouched)')) return; await cg.removeWorkspace(id); setSel(''); refresh(); };
  const patch = async (p: any) => { const w = await cg.updateWorkspace(sel, p); setInfo({ ...info, ...w }); };

  const start = async () => {
    if (!task.trim()) return;
    runningRef.current = true; setBusy('run'); setRun({ status: info.mode === 'chat_only' ? 'planning' : 'editing', files_changed: [], commands_run: [], test_results: [], risk_flags: [], iteration: 0 });
    const r = await cg.run(sel, task.trim());
    runningRef.current = false; setBusy('');
    if (r && r.ok === false) { alert('Could not start: ' + r.error); setRun(null); return; }
    setRun(r); setDiff(r?.diff_summary || '');
  };
  const cancel = async () => { await cg.cancel(sel); };
  const rollback = async () => { if (!run?.run_id) return; if (!confirm('Roll back this coding run?')) return; const r = await cg.rollback(sel, run.run_id); alert(r.ok ? `Rolled back: restored ${r.restored.length}, removed ${r.removed.length}.` : 'Rollback failed: ' + r.reason); setRun({ ...run, status: 'rolled_back' }); };
  const showDiff = async () => { const d = await cg.getDiff(sel, run?.run_id); setDiff(d.diff || '(no changes)'); };
  const resolveApproval = (ok: boolean) => { cg.resolveApproval(approval.id, ok); setApproval(null); };

  if (!cg) return <div className="p-6 text-dim">Coding bridge unavailable.</div>;
  const cm = info?.coding_model;

  return (
    <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto space-y-4">
      <div className="flex items-center gap-2"><Code2 size={20} className="text-neural-cyan" /><h1 className="text-xl font-bold">Coding Autopilot</h1></div>
      <p className="text-sm text-dim -mt-2">A local coding agent that reads, edits, and tests code inside a trusted workspace — checkpointed and reversible. Fully local.</p>

      {/* workspaces */}
      <div className="glass p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="hud-label">Trusted workspaces</div>
          <Btn onClick={addWs} disabled={!!busy}><FolderPlus size={13} /> Add folder…</Btn>
        </div>
        {!wss.length ? <div className="text-xs text-dim">No workspaces yet. Add a project folder (a normal repo — not your drive root, profile, or system folders).</div> : (
          <div className="flex flex-wrap gap-2">
            {wss.map((w) => (
              <button key={w.workspace_id} onClick={() => selectWs(w.workspace_id)}
                className={'px-2.5 py-1.5 rounded-md border text-xs flex items-center gap-1.5 ' + (sel === w.workspace_id ? 'border-neural-cyan bg-neural-cyan/10' : 'border-border/60 bg-panel/40 hover:bg-panel2/60')}>
                {w.is_git ? <GitBranch size={12} /> : null}<span className="font-semibold">{w.name}</span>
                <span className="text-faint">{w.autopilot_enabled ? 'autopilot' : w.mode}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {info ? (
        <>
          {/* workspace config */}
          <div className="glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-neural-green" /><span className="font-semibold">{info.name}</span><span className="text-[11px] text-faint font-mono">{info.root_path}</span></div>
              <Btn onClick={() => removeWs(info.workspace_id)} danger><Trash2 size={13} /> Remove</Btn>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-dim">{info.is_git ? <span className="text-neural-green">git repo</span> : <span>non-git (checkpoint snapshots)</span>}<span>· trust: coding_workspace</span></div>

            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button key={m.key} onClick={() => patch({ mode: m.key, autopilot_enabled: m.key === 'workspace_autopilot' || m.key === 'batch_review' })}
                  title={m.desc} className={'px-2 py-1 rounded text-xs border ' + (info.mode === m.key ? 'border-neural-cyan bg-neural-cyan/10' : 'border-border/60 bg-panel/40')}>{m.label}</button>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
              <Num label="max iterations" value={info.max_iterations} onChange={(v: number) => patch({ max_iterations: v })} />
              <Num label="max files/run" value={info.max_files_per_run} onChange={(v: number) => patch({ max_files_per_run: v })} />
              <Num label="max diff lines" value={info.max_diff_lines_per_run} onChange={(v: number) => patch({ max_diff_lines_per_run: v })} />
              <Chk label="allow tests" value={info.allow_test_commands} onChange={(v: boolean) => patch({ allow_test_commands: v })} />
              <Chk label="allow create" value={info.allow_file_create} onChange={(v: boolean) => patch({ allow_file_create: v })} />
              <Chk label="allow delete (approval)" value={info.allow_file_delete} onChange={(v: boolean) => patch({ allow_file_delete: v })} />
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-dim">
              <Cpu size={12} />
              {cm?.warning ? <span className="text-neural-amber"><AlertTriangle size={11} className="inline mb-0.5" /> {cm.warning}</span>
                : <span className="text-neural-green">Coding model: {cm?.model}</span>}
            </div>
          </div>

          {/* run */}
          <div className="glass p-4 space-y-2">
            <div className="hud-label">Task</div>
            <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder="e.g. Add a dark mode toggle and make the failing tests pass"
              className="w-full bg-panel/40 border border-border/60 rounded px-2 py-1.5 text-xs resize-y min-h-[60px]" />
            <div className="flex items-center gap-2">
              <Btn onClick={start} disabled={!!busy || info.mode === 'chat_only'}><Play size={13} /> Start ({info.mode})</Btn>
              <Btn onClick={cancel} disabled={!busy}><Square size={13} /> Cancel</Btn>
              {run?.run_id ? <Btn onClick={showDiff}><RefreshCw size={13} /> Show diff</Btn> : null}
              {run?.run_id && run.status !== 'rolled_back' ? <Btn onClick={rollback} danger><RotateCcw size={13} /> Rollback</Btn> : null}
            </div>

            {run ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 text-xs">
                  <StatusDot live={['editing', 'testing', 'fixing', 'reading', 'planning'].includes(run.status)} color={STATUS_COLOR[run.status]} />
                  <span style={{ color: STATUS_COLOR[run.status] }}>{run.status}</span>
                  <span className="text-faint">iter {run.iteration}/{run.max_iterations || info.max_iterations}</span>
                  {run.run_id ? <span className="text-faint font-mono">{run.run_id}</span> : null}
                </div>
                {run.files_changed?.length ? <div className="text-[11px]">changed: <span className="text-dim font-mono">{run.files_changed.join(', ')}</span></div> : null}
                {run.test_results?.length ? (
                  <div className="space-y-0.5">
                    {run.test_results.map((t: any, i: number) => (
                      <div key={i} className="text-[11px] flex items-center gap-1.5">
                        {t.ok ? <CheckCircle2 size={12} className="text-neural-green" /> : <XCircle size={12} className="text-neural-red" />}
                        <span className="font-mono">{t.command}</span><span className="text-faint">exit {t.code}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {run.risk_flags?.length ? <div className="text-[11px] text-neural-amber"><AlertTriangle size={11} className="inline mb-0.5" /> {run.risk_flags.join(', ')}</div> : null}
                {run.errors?.length ? <div className="text-[11px] text-neural-red">{run.errors.join('; ')}</div> : null}
              </div>
            ) : null}

            {diff ? <pre className="text-[11px] whitespace-pre-wrap bg-panel/30 rounded p-2 max-h-80 overflow-auto">{diff}</pre> : null}
          </div>
        </>
      ) : null}

      {/* approval modal */}
      {approval ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="glass p-4 max-w-md space-y-3">
            <div className="flex items-center gap-2 text-neural-amber"><AlertTriangle size={16} /><span className="font-semibold">Approval needed ({approval.kind})</span></div>
            <pre className="text-xs whitespace-pre-wrap text-dim">{approval.summary}</pre>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => resolveApproval(false)} danger>Deny</Btn>
              <Btn onClick={() => resolveApproval(true)}>Approve</Btn>
            </div>
          </div>
        </div>
      ) : null}

      <div className="glass-soft p-3 text-[11px] text-dim flex items-start gap-2">
        <ShieldCheck size={14} className="text-neural-green mt-0.5 shrink-0" />
        <span>Edits are confined to the selected workspace. Protected files (.env, keys, .git, node_modules, system/credential areas) are blocked, secrets are redacted from diffs/logs, commands are an allowlisted argv (no shell), and every run is checkpointed so you can roll back. AgentOS network execution and python_exec stay disabled.</span>
      </div>
    </div>
  );
}

function Num({ label, value, onChange }: any) {
  return <label className="flex items-center justify-between gap-2 bg-panel/30 rounded px-2 py-1">
    <span className="text-faint">{label}</span>
    <input type="number" value={value} onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))} className="w-14 bg-transparent text-right text-ink outline-none" />
  </label>;
}
function Chk({ label, value, onChange }: any) {
  return <label className="flex items-center justify-between gap-2 bg-panel/30 rounded px-2 py-1 cursor-pointer">
    <span className="text-faint">{label}</span>
    <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
  </label>;
}
