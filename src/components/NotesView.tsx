import React, { useEffect, useRef, useState } from 'react';
import {
  StickyNote, Plus, Trash2, Pin, Archive, Search, Sparkles, ListPlus, Link2, Loader2, Check, X,
} from 'lucide-react';
import { useBrainStore } from '../state/brainStore';
import { PageShellSplit } from '../ui/system';

/** Notes — quick notes with tags, pin/archive, search, and AI helpers (summarize,
 *  convert-to-task, smart-link to memories/projects/conversations). Each note is a brain node. */
export default function NotesView() {
  const [notes, setNotes] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [links, setLinks] = useState<any[]>([]);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const setBrain = useBrainStore((s) => s.setBrain);
  const timer = useRef<any>(null);
  const loaded = useRef<string | null>(null);

  const refresh = () => (q.trim() ? window.dawn.notes.search(q) : window.dawn.notes.list({ archived })).then(setNotes);
  useEffect(() => { refresh(); }, [q, archived]);

  async function open(nid: string) {
    const n = await window.dawn.notes.get(nid);
    if (!n) return;
    loaded.current = nid;
    setId(nid); setTitle(n.title || ''); setContent(n.content || ''); setTags(n.tags || ''); setPinned(!!n.pinned); setLinks(n.links || []); setMsg('');
  }
  async function create() { const n = await window.dawn.notes.create({}); await refresh(); open(n.id); }
  async function remove(nid: string) { if (!confirm('Delete this note?')) return; await window.dawn.notes.remove(nid); if (id === nid) setId(null); refresh(); }

  useEffect(() => {
    if (!id || loaded.current !== id) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => { await window.dawn.notes.update(id, { title, content, tags }); refresh(); }, 700);
    return () => clearTimeout(timer.current);
  }, [title, content, tags]);

  async function togglePin() { if (!id) return; const v = pinned ? 0 : 1; setPinned(!pinned); await window.dawn.notes.update(id, { pinned: v }); refresh(); }
  async function archive() { if (!id) return; await window.dawn.notes.update(id, { archived: 1 }); setId(null); refresh(); }

  async function ai(kind: 'summarize' | 'toTask' | 'link') {
    if (!id) return;
    setBusy(kind); setMsg(''); if (kind !== 'link') setBrain('THINKING', 'Working on your note…');
    await window.dawn.notes.update(id, { title, content, tags });
    const r = kind === 'summarize' ? await window.dawn.notes.summarize(id) : kind === 'toTask' ? await window.dawn.notes.toTask(id) : await window.dawn.notes.link(id);
    setBusy(''); setBrain('IDLE');
    if (!r.ok) { setMsg(r.error); return; }
    if (kind === 'summarize') setContent(r.content);
    if (kind === 'toTask') setMsg(`Created task: "${r.title}"`);
    if (kind === 'link') { open(id); setMsg(`Linked ${r.links?.length || 0} related item(s).`); }
  }
  async function unlink(linkId: string) { await window.dawn.notes.unlink(linkId); if (id) open(id); }

  return (
    <PageShellSplit
      icon={<StickyNote size={22} />}
      title="Notes"
      subtitle="Quick notes — DAWN can summarize, convert to a task, or smart-link them."
      sidebarWidth="w-60"
      sidebar={<>
        <div className="p-3 space-y-2">
          <button onClick={create} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}><Plus size={15} /> New note</button>
          <div className="relative"><Search size={13} className="absolute left-2.5 top-2.5 text-faint" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full bg-bg border border-border rounded-lg pl-8 pr-2 py-1.5 text-xs outline-none" /></div>
          <button onClick={() => setArchived((a) => !a)} className={`text-[11px] px-2 py-1 rounded-lg border w-full ${archived ? 'border-neural-amber/50 text-neural-amber' : 'border-border text-faint'}`}>{archived ? 'Showing archived' : 'Active notes'}</button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {notes.map((n) => (
            <div key={n.id} onClick={() => open(n.id)} className={`group px-2.5 py-2 rounded-lg cursor-pointer ${id === n.id ? 'bg-panel2/70' : 'hover:bg-panel/50'}`}>
              <div className="flex items-start gap-1.5">
                {n.pinned ? <Pin size={11} className="text-neural-amber mt-0.5 shrink-0" /> : <StickyNote size={11} className="text-faint mt-0.5 shrink-0" />}
                <span className="flex-1 text-xs text-dim leading-snug line-clamp-2">{n.title || n.content || 'Empty note'}</span>
                <button onClick={(e) => { e.stopPropagation(); remove(n.id); }} className="opacity-0 group-hover:opacity-100 text-faint hover:text-neural-red"><Trash2 size={12} /></button>
              </div>
              {n.tags ? <div className="text-[10px] text-faint mt-0.5 ml-4 truncate">{n.tags}</div> : null}
            </div>
          ))}
          {!notes.length ? <div className="text-[11px] text-faint text-center py-8 px-3">No notes.<br />Jot something down.</div> : null}
        </div>
      </>}
    >
        {!id ? (
          <div className="flex-1 grid place-items-center text-center p-8"><div><StickyNote size={40} className="mx-auto text-faint mb-3" /><div className="text-lg font-semibold">Notes</div><p className="text-sm text-dim mt-1 max-w-sm">Capture quick thoughts. DAWN can summarize a note, turn it into a task, or link it to related memories and conversations.</p></div></div>
        ) : (
          <>
            <div className="border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title" className="flex-1 bg-transparent text-lg font-semibold outline-none" />
                <button onClick={togglePin} className={`p-1.5 rounded-lg border ${pinned ? 'border-neural-amber/50 text-neural-amber' : 'border-border text-faint hover:text-ink'}`}><Pin size={14} /></button>
                <button onClick={archive} title="Archive" className="p-1.5 rounded-lg border border-border text-faint hover:text-ink"><Archive size={14} /></button>
              </div>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" className="w-full bg-transparent text-xs text-dim mt-1 outline-none" />
              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                <AiBtn busy={busy === 'summarize'} onClick={() => ai('summarize')} icon={<Sparkles size={11} />}>Summarize</AiBtn>
                <AiBtn busy={busy === 'toTask'} onClick={() => ai('toTask')} icon={<ListPlus size={11} />}>Convert to task</AiBtn>
                <AiBtn busy={busy === 'link'} onClick={() => ai('link')} icon={<Link2 size={11} />}>Smart link</AiBtn>
                {msg ? <span className="text-[11px] text-neural-cyan ml-1">{msg}</span> : null}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write your note… (Markdown supported)" className="w-full min-h-[50%] resize-none bg-transparent px-6 py-5 text-sm leading-relaxed outline-none" />
              {links.length ? (
                <div className="px-6 pb-6">
                  <div className="hud-label mb-2">Linked</div>
                  <div className="flex flex-wrap gap-1.5">
                    {links.map((l) => (
                      <span key={l.id} className="text-[11px] px-2 py-1 rounded-full border border-border text-dim inline-flex items-center gap-1.5">
                        <span className="text-faint">{l.target_type}</span> {l.label}
                        <button onClick={() => unlink(l.id)} className="text-faint hover:text-neural-red"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
    </PageShellSplit>
  );
}

function AiBtn({ busy, onClick, icon, children }: any) {
  return <button onClick={onClick} disabled={busy} className="text-[11px] px-2 py-1 rounded-lg border border-border text-dim hover:text-ink disabled:opacity-40 inline-flex items-center gap-1">{busy ? <Loader2 size={11} className="animate-spin" /> : icon}{children}</button>;
}
