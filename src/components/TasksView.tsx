import React, { useEffect, useState } from 'react';
import {
  CheckSquare, Square, Plus, Trash2, AlertTriangle, Bot, Loader2, ChevronDown, ChevronRight, Clock, Repeat, Bell,
} from 'lucide-react';
import { useBrainStore } from '../state/brainStore';
import { PageShellPanel } from '../ui/system';

/** Tasks — title/details/due/priority/status, recurrence, reminders, history, and
 *  "Ask DAWN to work on this" (local-model plan). Overdue tasks are flagged (and glow red in the brain). */
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
const RECUR = ['none', 'daily', 'weekly', 'monthly'];
const priColor: any = { low: 'text-faint', normal: 'text-dim', high: 'text-neural-amber', urgent: 'text-neural-red' };

function toLocalInput(ms?: number | null) { if (!ms) return ''; const d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }
function fromLocalInput(v: string) { return v ? new Date(v).getTime() : null; }
function fmtDue(ms?: number | null) { return ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }

export default function TasksView() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [done, setDone] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [recurrence, setRecurrence] = useState('none');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const setBrain = useBrainStore((s) => s.setBrain);

  const refresh = () => {
    window.dawn.tasks.list().then(setTasks);
    if (showDone) window.dawn.tasks.list({ status: 'done' }).then(setDone);
  };
  useEffect(() => { refresh(); }, [showDone]);

  async function add() {
    if (!title.trim()) return;
    await window.dawn.tasks.create({ title: title.trim(), priority, due_at: fromLocalInput(due), remind_at: fromLocalInput(due), recurrence });
    setTitle(''); setDue(''); setPriority('normal'); setRecurrence('none');
    refresh();
  }
  async function complete(t: any) { await window.dawn.tasks.complete(t.id); refresh(); }
  async function uncomplete(t: any) { await window.dawn.tasks.setStatus(t.id, 'todo'); refresh(); }
  async function setField(id: string, patch: any) { await window.dawn.tasks.update(id, patch); refresh(); if (expanded === id) loadDetail(id); }
  async function remove(id: string) { await window.dawn.tasks.remove(id); refresh(); }

  async function expand(id: string) { if (expanded === id) { setExpanded(null); return; } setExpanded(id); loadDetail(id); }
  async function loadDetail(id: string) { setDetail(await window.dawn.tasks.get(id)); }

  async function ask(id: string) {
    setBusy(id); setBrain('THINKING', 'Planning your task…');
    const r = await window.dawn.tasks.askDawn(id);
    setBusy(''); setBrain('IDLE');
    if (r.ok) { setPlan((p) => ({ ...p, [id]: r.plan })); loadDetail(id); }
    else setPlan((p) => ({ ...p, [id]: 'Error: ' + r.error }));
  }

  const overdue = tasks.filter((t) => t.overdue);
  const active = tasks.filter((t) => !t.overdue);

  return (
    <PageShellPanel
      width="max-w-3xl"
      icon={<CheckSquare size={22} />}
      title="Tasks"
      subtitle="Track what needs doing. Set due dates and reminders, make tasks recurring, and ask DAWN to plan any task."
    >
        {/* add */}
        <div className="glass p-3 mb-4">
          <div className="flex gap-2 items-center flex-wrap">
            <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a task…" className="flex-1 min-w-[180px] bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" />
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} title="Due / reminder" className="bg-bg border border-border rounded-lg px-2 py-2 text-xs text-dim" />
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="bg-bg border border-border rounded-lg px-2 py-2 text-xs">{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} title="Repeat" className="bg-bg border border-border rounded-lg px-2 py-2 text-xs">{RECUR.map((r) => <option key={r} value={r}>{r === 'none' ? 'once' : r}</option>)}</select>
            <button onClick={add} disabled={!title.trim()} className="px-3 py-2 rounded-lg border font-semibold text-sm inline-flex items-center gap-1 disabled:opacity-40" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}><Plus size={14} /> Add</button>
          </div>
        </div>

        {overdue.length ? (
          <div className="mb-3">
            <div className="text-xs font-semibold text-neural-red mb-1.5 flex items-center gap-1.5"><AlertTriangle size={13} /> Overdue ({overdue.length})</div>
            <div className="space-y-1.5">{overdue.map((t) => <Row key={t.id} t={t} {...{ complete, uncomplete, setField, remove, expand, expanded, detail, ask, busy, plan }} />)}</div>
          </div>
        ) : null}

        <div className="space-y-1.5">{active.map((t) => <Row key={t.id} t={t} {...{ complete, uncomplete, setField, remove, expand, expanded, detail, ask, busy, plan }} />)}</div>
        {!tasks.length ? <div className="glass p-8 text-center text-sm text-dim">No open tasks. Add one above, or convert a note into a task.</div> : null}

        <button onClick={() => setShowDone((s) => !s)} className="mt-4 text-xs text-faint hover:text-ink inline-flex items-center gap-1">{showDone ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Completed</button>
        {showDone ? <div className="space-y-1.5 mt-2 opacity-70">{done.map((t) => <Row key={t.id} t={t} {...{ complete, uncomplete, setField, remove, expand, expanded, detail, ask, busy, plan }} />)}</div> : null}
    </PageShellPanel>
  );
}

function Row({ t, complete, uncomplete, setField, remove, expand, expanded, detail, ask, busy, plan }: any) {
  const isDone = t.status === 'done';
  const open = expanded === t.id;
  return (
    <div className={`glass p-3 ${t.overdue ? 'ring-1 ring-neural-red/40' : ''}`}>
      <div className="flex items-center gap-2.5">
        <button onClick={() => (isDone ? uncomplete(t) : complete(t))} className="shrink-0">{isDone ? <CheckSquare size={17} className="text-neural-green" /> : <Square size={17} className="text-faint hover:text-ink" />}</button>
        <div className="flex-1 min-w-0">
          <div className={`text-sm truncate ${isDone ? 'line-through text-faint' : ''}`}>{t.title}</div>
          <div className="flex items-center gap-2 text-[11px] mt-0.5">
            <span className={priColor[t.priority]}>{t.priority}</span>
            {t.due_at ? <span className={`inline-flex items-center gap-1 ${t.overdue ? 'text-neural-red' : 'text-faint'}`}><Clock size={10} />{fmtDue(t.due_at)}</span> : null}
            {t.recurrence && t.recurrence !== 'none' ? <span className="text-faint inline-flex items-center gap-0.5"><Repeat size={10} />{t.recurrence}</span> : null}
            {t.remind_at && !isDone ? <span className="text-faint inline-flex items-center gap-0.5"><Bell size={10} /></span> : null}
          </div>
        </div>
        <select value={t.status} onChange={(e) => setField(t.id, { status: e.target.value })} className="bg-bg border border-border rounded px-1.5 py-1 text-[11px] text-dim">{['todo', 'in_progress', 'blocked', 'done'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
        <button onClick={() => ask(t.id)} disabled={busy === t.id} title="Ask DAWN to work on this" className="p-1.5 rounded-lg border border-border text-dim hover:text-ink disabled:opacity-40">{busy === t.id ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}</button>
        <button onClick={() => expand(t.id)} className="p-1.5 text-faint hover:text-ink">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <button onClick={() => remove(t.id)} className="p-1.5 text-faint hover:text-neural-red"><Trash2 size={14} /></button>
      </div>
      {open ? (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
          <textarea defaultValue={t.details} onBlur={(e) => setField(t.id, { details: e.target.value })} placeholder="Details…" rows={2} className="w-full bg-bg border border-border rounded-lg px-2.5 py-2 text-xs outline-none" />
          {plan[t.id] ? <div className="text-xs text-dim bg-panel/30 border border-border/50 rounded-lg p-2.5 whitespace-pre-wrap"><div className="hud-label mb-1">DAWN's plan</div>{plan[t.id]}</div> : null}
          {detail?.id === t.id && detail.events?.length ? (
            <div className="text-[11px] text-faint"><div className="hud-label mb-1">History</div>{detail.events.slice(0, 6).map((ev: any) => <div key={ev.id}>{new Date(ev.created_at).toLocaleString()} — {ev.kind}{ev.kind === 'dawn_plan' ? '' : ev.detail ? `: ${ev.detail}` : ''}</div>)}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
