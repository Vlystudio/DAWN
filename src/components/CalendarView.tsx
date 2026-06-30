import React, { useEffect, useState } from 'react';
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Plus, Upload, Download, X, Trash2, MapPin } from 'lucide-react';

/** Calendar-lite — local events + task deadlines in day/week/month views, with
 *  iCalendar (.ics) import/export. All local; no accounts. */

type View = 'month' | 'week' | 'day';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfDay = (ms: number) => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); };
const addDays = (ms: number, n: number) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
function monthGrid(ms: number) { const d = new Date(ms); d.setDate(1); d.setHours(0, 0, 0, 0); const start = addDays(d.getTime(), -d.getDay()); return Array.from({ length: 42 }, (_, i) => addDays(start, i)); }
function weekGrid(ms: number) { const s = startOfDay(addDays(ms, -new Date(ms).getDay())); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
function toInput(ms: number) { const d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }
function fromInput(v: string) { return v ? new Date(v).getTime() : Date.now(); }
const hm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function CalendarView() {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(Date.now());
  const [items, setItems] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null); // event being edited/created
  const [msg, setMsg] = useState('');

  const range = (): [number, number] => {
    if (view === 'month') { const g = monthGrid(cursor); return [g[0], endOfDay(g[41])]; }
    if (view === 'week') { const g = weekGrid(cursor); return [g[0], endOfDay(g[6])]; }
    return [startOfDay(cursor), endOfDay(cursor)];
  };
  const refresh = () => { const [s, e] = range(); window.dawn.cal.list(s, e).then(setItems); };
  useEffect(() => { refresh(); }, [view, cursor]);

  const move = (dir: number) => setCursor((c) => addDays(c, dir * (view === 'month' ? 30 : view === 'week' ? 7 : 1)));
  const itemsOn = (day: number) => items.filter((it) => sameDay(it.start_at, day)).sort((a, b) => a.start_at - b.start_at);

  function newEvent(day?: number) {
    const start = day ? startOfDay(day) + 9 * 3600000 : Date.now();
    setEdit({ title: '', details: '', location: '', start_at: start, end_at: start + 3600000, all_day: false });
  }
  async function save() {
    if (!edit.title.trim()) { setMsg('Add a title.'); return; }
    if (edit.id) await window.dawn.cal.update(edit.id, edit);
    else await window.dawn.cal.create(edit);
    setEdit(null); refresh();
  }
  async function del() { if (edit.id) { await window.dawn.cal.remove(edit.id); setEdit(null); refresh(); } }
  async function importIcs() { const r = await window.dawn.cal.importIcs(); if (r?.ok) { setMsg(`Imported ${r.imported} event(s).`); refresh(); } else if (r && !r.canceled) setMsg(r.error || 'Import failed.'); }
  async function exportIcs() {
    const r = await window.dawn.cal.exportIcs();
    if (!r.ok) return;
    const blob = new Blob([r.content], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = r.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const title = view === 'day'
    ? new Date(cursor).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : new Date(cursor).toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <CalIcon size={18} style={{ color: 'var(--accent)' }} /><h1 className="text-xl font-bold">Calendar</h1>
          <div className="ml-2 flex items-center gap-1">
            <button onClick={() => move(-1)} className="p-1.5 rounded-lg border border-border text-dim hover:text-ink"><ChevronLeft size={15} /></button>
            <button onClick={() => setCursor(Date.now())} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-dim hover:text-ink">Today</button>
            <button onClick={() => move(1)} className="p-1.5 rounded-lg border border-border text-dim hover:text-ink"><ChevronRight size={15} /></button>
          </div>
          <span className="text-sm font-semibold ml-1">{title}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {(['month', 'week', 'day'] as View[]).map((v) => <button key={v} onClick={() => setView(v)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${view === v ? 'border-neural-cyan/60 text-neural-cyan bg-neural-cyan/10' : 'border-border text-dim hover:text-ink'}`}>{v}</button>)}
            <button onClick={importIcs} title="Import .ics" className="p-1.5 rounded-lg border border-border text-dim hover:text-ink"><Upload size={14} /></button>
            <button onClick={exportIcs} title="Export .ics" className="p-1.5 rounded-lg border border-border text-dim hover:text-ink"><Download size={14} /></button>
            <button onClick={() => newEvent()} className="text-xs px-2.5 py-1.5 rounded-lg border font-semibold inline-flex items-center gap-1" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}><Plus size={13} /> Event</button>
          </div>
        </div>
        {msg ? <div className="text-[11px] text-neural-cyan mb-2">{msg}</div> : null}

        {view === 'month' ? (
          <div className="glass overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border">{DOW.map((d) => <div key={d} className="text-[11px] text-faint text-center py-1.5">{d}</div>)}</div>
            <div className="grid grid-cols-7">
              {monthGrid(cursor).map((day, i) => {
                const inMonth = new Date(day).getMonth() === new Date(cursor).getMonth();
                const today = sameDay(day, Date.now());
                return (
                  <div key={i} onClick={() => newEvent(day)} className={`min-h-[92px] border-b border-r border-border/50 p-1 cursor-pointer hover:bg-panel/40 ${inMonth ? '' : 'opacity-40'}`}>
                    <div className={`text-[11px] text-right pr-1 ${today ? 'text-neural-cyan font-bold' : 'text-faint'}`}>{new Date(day).getDate()}</div>
                    <div className="space-y-0.5 mt-0.5">{itemsOn(day).slice(0, 3).map((it) => <Chip key={it.id} it={it} onClick={(e) => { e.stopPropagation(); if (it.kind === 'event') setEdit({ ...it }); }} />)}{itemsOn(day).length > 3 ? <div className="text-[9px] text-faint pl-1">+{itemsOn(day).length - 3} more</div> : null}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {(view === 'week' ? weekGrid(cursor) : [startOfDay(cursor)]).map((day) => (
              <div key={day} className="glass p-3">
                <div className={`text-sm font-semibold mb-1.5 ${sameDay(day, Date.now()) ? 'text-neural-cyan' : ''}`}>{new Date(day).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                <div className="space-y-1">
                  {itemsOn(day).length ? itemsOn(day).map((it) => (
                    <div key={it.id} onClick={() => it.kind === 'event' && setEdit({ ...it })} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg ${it.kind === 'event' ? 'cursor-pointer hover:bg-panel/50' : ''} border-l-2`} style={{ borderColor: it.kind === 'task' ? (it.overdue ? '#ef4444' : '#f59e0b') : 'var(--accent)' }}>
                      <span className="text-faint w-16 shrink-0">{it.all_day ? 'all day' : hm(it.start_at)}</span>
                      <span className="flex-1 truncate">{it.title}</span>
                      {it.kind === 'task' ? <span className="text-[10px] text-faint">task</span> : null}
                      {it.location ? <span className="text-[10px] text-faint inline-flex items-center gap-0.5"><MapPin size={9} />{it.location}</span> : null}
                    </div>
                  )) : <div onClick={() => newEvent(day)} className="text-[11px] text-faint cursor-pointer hover:text-ink py-1">No events — click to add</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* edit/create modal */}
      {edit ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={() => setEdit(null)}>
          <div className="glass p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><span className="font-semibold">{edit.id ? 'Edit event' : 'New event'}</span><button onClick={() => setEdit(null)} className="text-faint hover:text-ink"><X size={16} /></button></div>
            <input autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Event title" className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm mb-2 outline-none focus:border-[var(--accent)]" />
            <div className="grid grid-cols-2 gap-2 mb-2">
              <label className="text-[11px] text-faint">Start<input type="datetime-local" value={toInput(edit.start_at)} onChange={(e) => setEdit({ ...edit, start_at: fromInput(e.target.value) })} className="w-full bg-bg border border-border rounded-lg px-2 py-1.5 text-xs mt-0.5" /></label>
              <label className="text-[11px] text-faint">End<input type="datetime-local" value={toInput(edit.end_at || edit.start_at)} onChange={(e) => setEdit({ ...edit, end_at: fromInput(e.target.value) })} className="w-full bg-bg border border-border rounded-lg px-2 py-1.5 text-xs mt-0.5" /></label>
            </div>
            <label className="text-[11px] text-faint flex items-center gap-2 mb-2"><input type="checkbox" checked={!!edit.all_day} onChange={(e) => setEdit({ ...edit, all_day: e.target.checked })} className="accent-[var(--accent)]" /> All day</label>
            <input value={edit.location || ''} onChange={(e) => setEdit({ ...edit, location: e.target.value })} placeholder="Location (optional)" className="w-full bg-bg border border-border rounded-lg px-3 py-1.5 text-xs mb-2 outline-none" />
            <textarea value={edit.details || ''} onChange={(e) => setEdit({ ...edit, details: e.target.value })} placeholder="Details (optional)" rows={2} className="w-full bg-bg border border-border rounded-lg px-3 py-1.5 text-xs mb-3 outline-none" />
            <div className="flex items-center gap-2">
              <button onClick={save} className="px-3 py-1.5 rounded-lg border font-semibold text-sm" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}>Save</button>
              {edit.id ? <button onClick={del} className="px-3 py-1.5 rounded-lg border border-neural-red/50 text-neural-red text-sm inline-flex items-center gap-1"><Trash2 size={13} /> Delete</button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ it, onClick }: { it: any; onClick: (e: any) => void }) {
  const color = it.kind === 'task' ? (it.overdue ? '#ef4444' : '#f59e0b') : 'var(--accent)';
  return (
    <div onClick={onClick} className="text-[10px] truncate px-1 py-0.5 rounded" style={{ background: `${it.kind === 'task' ? (it.overdue ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)') : 'rgba(var(--accent-rgb),0.15)'}`, color, borderLeft: `2px solid ${color}` }}>
      {it.all_day ? '' : hm(it.start_at) + ' '}{it.title}
    </div>
  );
}
