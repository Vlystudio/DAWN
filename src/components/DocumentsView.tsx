import React, { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import {
  FileText, Plus, Trash2, Download, Upload, Eye, Pencil, Sparkles, History, Save,
  Loader2, RotateCcw, Check, ChevronDown,
} from 'lucide-react';
import { useBrainStore } from '../state/brainStore';

/**
 * Documents — create/edit local Markdown documents with live preview, local-model AI
 * actions, import/export, autosave, and version history. Each document is a brain node.
 */

const AI_ACTIONS: [string, string][] = [
  ['rewrite', 'Rewrite'], ['summarize', 'Summarize'], ['expand', 'Expand'], ['shorten', 'Shorten'],
  ['fix_grammar', 'Fix grammar'], ['checklist', 'To checklist'], ['action_items', 'Extract actions'],
];
const EXPORTS = ['md', 'txt', 'html', 'csv'];

export default function DocumentsView() {
  const [docs, setDocs] = useState<any[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState('');
  const [versions, setVersions] = useState<any[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [msg, setMsg] = useState('');
  const setBrain = useBrainStore((s) => s.setBrain);
  const saveTimer = useRef<any>(null);
  const loadedId = useRef<string | null>(null);

  const refresh = () => window.dawn.docs.list().then(setDocs);
  useEffect(() => { refresh(); }, []);

  async function open(docId: string) {
    const d = await window.dawn.docs.get(docId);
    if (!d) return;
    loadedId.current = docId;
    setId(docId); setTitle(d.title || ''); setContent(d.content || ''); setSaved(true); setShowVersions(false); setMsg('');
  }
  async function create() {
    const d = await window.dawn.docs.create({ title: 'Untitled document', content: '' });
    await refresh();
    open(d.id);
  }
  async function importDoc() {
    const r = await window.dawn.docs.import();
    if (r?.ok) { await refresh(); open(r.id); }
    else if (r && !r.canceled) setMsg(r.error || 'Import failed.');
  }
  async function remove(docId: string) {
    if (!confirm('Delete this document?')) return;
    await window.dawn.docs.remove(docId);
    if (id === docId) { setId(null); setContent(''); setTitle(''); }
    refresh();
  }

  // autosave (debounced)
  useEffect(() => {
    if (!id || loadedId.current !== id) return;
    setSaved(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await window.dawn.docs.update(id, { title, content });
      setSaved(true);
      refresh();
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [title, content]);

  async function runAi(action: string) {
    if (!id) return;
    setBusy(action); setBrain('THINKING', 'Working on your document…');
    // flush pending autosave first
    await window.dawn.docs.update(id, { title, content });
    const r = await window.dawn.docs.ai(id, action);
    setBusy(''); setBrain('IDLE');
    if (!r.ok) { setMsg(r.error); return; }
    setContent(r.content); setSaved(true); loadVersions();
  }

  async function loadVersions() { if (id) setVersions(await window.dawn.docs.versions(id)); }
  async function restore(versionId: string) {
    if (!id) return;
    const d = await window.dawn.docs.restore(id, versionId);
    if (d) { setContent(d.content); setSaved(true); loadVersions(); }
  }
  async function exportAs(format: string) {
    if (!id) return;
    const r = await window.dawn.docs.export(id, format);
    if (!r.ok) { setMsg(r.error); return; }
    const blob = new Blob([r.content], { type: r.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = r.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className="h-full flex">
      {/* list */}
      <div className="w-60 shrink-0 border-r border-border bg-bg/40 flex flex-col">
        <div className="p-3 flex gap-2">
          <button onClick={create} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}><Plus size={15} /> New</button>
          <button onClick={importDoc} title="Import .md/.txt/.html/.csv" className="px-3 py-2 rounded-lg border border-border text-dim hover:text-ink"><Upload size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {docs.map((d) => (
            <div key={d.id} onClick={() => open(d.id)} className={`group px-2.5 py-2 rounded-lg cursor-pointer ${id === d.id ? 'bg-panel2/70' : 'hover:bg-panel/50'}`}>
              <div className="flex items-start gap-1.5">
                <FileText size={13} className="text-faint mt-0.5 shrink-0" />
                <span className="flex-1 text-xs text-dim leading-snug line-clamp-2">{d.title || 'Untitled'}</span>
                <button onClick={(e) => { e.stopPropagation(); remove(d.id); }} className="opacity-0 group-hover:opacity-100 text-faint hover:text-neural-red"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {!docs.length ? <div className="text-[11px] text-faint text-center py-8 px-3">No documents yet.<br />Create one or import a file.</div> : null}
        </div>
      </div>

      {/* editor */}
      <div className="flex-1 min-w-0 flex flex-col">
        {!id ? (
          <div className="flex-1 grid place-items-center text-center p-8">
            <div>
              <FileText size={40} className="mx-auto text-faint mb-3" />
              <div className="text-lg font-semibold">Documents</div>
              <p className="text-sm text-dim mt-1 max-w-sm">Write and edit local Markdown documents. Ask DAWN to rewrite, summarize, or extract action items — all on your machine. Each document becomes a brain node.</p>
              <button onClick={create} className="mt-4 px-4 py-2 rounded-lg border font-semibold text-sm inline-flex items-center gap-1.5" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}><Plus size={15} /> New document</button>
            </div>
          </div>
        ) : (
          <>
            {/* header */}
            <div className="border-b border-border px-5 py-3">
              <div className="flex items-center gap-3">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled document" className="flex-1 bg-transparent text-lg font-semibold outline-none" />
                <span className="text-[11px] text-faint inline-flex items-center gap-1">{saved ? <><Check size={12} className="text-neural-green" /> Saved</> : <><Loader2 size={12} className="animate-spin" /> Saving…</>}</span>
                <button onClick={() => setPreview((p) => !p)} className="text-xs px-2.5 py-1 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1">{preview ? <Pencil size={12} /> : <Eye size={12} />} {preview ? 'Edit' : 'Preview'}</button>
                <div className="relative">
                  <button onClick={() => { setShowVersions((v) => !v); loadVersions(); }} className="text-xs px-2.5 py-1 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1"><History size={12} /> History</button>
                  {showVersions ? (
                    <div className="absolute right-0 top-9 z-20 w-64 glass p-2 max-h-72 overflow-y-auto">
                      <button onClick={() => window.dawn.docs.saveVersion(id).then(loadVersions)} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-panel/60 inline-flex items-center gap-1.5"><Save size={12} /> Save a version now</button>
                      <div className="h-px bg-border my-1" />
                      {versions.length ? versions.map((v) => (
                        <div key={v.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-panel/60">
                          <span className="flex-1 truncate text-dim">{v.label} · {new Date(v.created_at).toLocaleString()}</span>
                          <button onClick={() => restore(v.id)} title="Restore" className="text-faint hover:text-neural-cyan"><RotateCcw size={12} /></button>
                        </div>
                      )) : <div className="text-[11px] text-faint px-2 py-2">No versions yet.</div>}
                    </div>
                  ) : null}
                </div>
              </div>
              {/* AI toolbar */}
              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                {AI_ACTIONS.map(([action, label]) => (
                  <button key={action} onClick={() => runAi(action)} disabled={!!busy} className="text-[11px] px-2 py-1 rounded-lg border border-border text-dim hover:text-ink disabled:opacity-40 inline-flex items-center gap-1">
                    {busy === action ? <Loader2 size={11} className="animate-spin" /> : null}{label}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-1">
                  {EXPORTS.map((f) => <button key={f} onClick={() => exportAs(f)} className="text-[11px] px-1.5 py-1 rounded border border-border text-faint hover:text-ink inline-flex items-center gap-0.5"><Download size={10} /> {f}</button>)}
                </div>
              </div>
              {msg ? <div className="text-[11px] text-neural-amber mt-1.5">{msg}</div> : null}
            </div>

            {/* body */}
            <div className="flex-1 overflow-y-auto">
              {preview ? (
                <div className="p-6 max-w-3xl mx-auto"><div className="markdown text-sm"><Markdown>{content || '_Empty document._'}</Markdown></div></div>
              ) : (
                <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Start writing… (Markdown supported)" spellCheck className="w-full h-full resize-none bg-transparent px-6 py-5 text-sm leading-relaxed outline-none font-mono" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
