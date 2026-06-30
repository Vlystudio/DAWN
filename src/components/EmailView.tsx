import React, { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import {
  Mail, Plus, RefreshCw, Settings as Cog, Loader2, AlertTriangle, Paperclip, Reply, ListChecks,
  Sparkles, CheckSquare, CalendarPlus, StickyNote, Send, Save, X, Lock, Search, Trash2, ShieldAlert, Tag,
} from 'lucide-react';
import { useBrainStore } from '../state/brainStore';

/**
 * Email — local-first IMAP/SMTP workspace. Credentials live in the Vault; email content is
 * untrusted (firewalled before any AI action); sending always requires explicit confirmation
 * + the approval gateway. Attachments are metadata-only until an explicit download.
 */
export default function EmailView() {
  const [locked, setLocked] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [acct, setAcct] = useState<any>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [folder, setFolder] = useState('INBOX');
  const [messages, setMessages] = useState<any[]>([]);
  const [msg, setMsg] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [setup, setSetup] = useState<any>(null);
  const [compose, setCompose] = useState<any>(null);
  const [ai, setAi] = useState<{ kind: string; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const setBrain = useBrainStore((s) => s.setBrain);

  useEffect(() => {
    window.dawn.auth.status().then((s: any) => setLocked(!!s.authEnabled && !!s.locked));
    window.dawn.email.listAccounts().then((a: any[]) => { setAccounts(a); if (a[0]) selectAccount(a[0]); });
  }, []);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  async function selectAccount(a: any) {
    setAcct(a); setMsg(null); setAi(null);
    window.dawn.email.listFolders(a.id).then((r: any) => setFolders(r.folders || []));
    loadMessages(a.id, 'INBOX');
  }
  function loadMessages(accountId: string, f: string) {
    window.dawn.email.listMessages(accountId, f, { query, unreadOnly }).then(setMessages);
  }
  async function sync() {
    if (!acct) return;
    setSyncing(true); setBrain('SEARCHING_WEB', 'Syncing email…');
    const r = await window.dawn.email.sync(acct.id, folder);
    setSyncing(false); setBrain('IDLE');
    if (!r.ok) flash(r.error || 'Sync failed.');
    loadMessages(acct.id, folder);
  }
  async function openMsg(m: any) { const full = await window.dawn.email.getMessage(m.id); setMsg(full); setAi(null); }

  async function runAi(kind: string) {
    if (!msg) return;
    setBusy(kind); setBrain('THINKING', 'Working on this email…');
    let r: any;
    if (kind === 'summarize') r = await window.dawn.email.summarize(msg.id);
    else if (kind === 'actions') r = await window.dawn.email.extractActions(msg.id);
    else if (kind === 'task') r = await window.dawn.email.createTask(msg.id);
    else if (kind === 'event') r = await window.dawn.email.createCalendar(msg.id);
    else if (kind === 'note') r = await window.dawn.email.saveNote(msg.id);
    setBusy(''); setBrain('IDLE');
    if (!r.ok) { flash(r.error); return; }
    if (kind === 'summarize') setAi({ kind, text: r.summary });
    else if (kind === 'actions') setAi({ kind, text: r.text });
    else if (kind === 'task') flash(`Task created: "${r.title}"`);
    else if (kind === 'event') flash('Calendar event created.');
    else if (kind === 'note') flash('Saved summary to a note.');
  }
  async function draftReply() {
    if (!msg) return;
    setBusy('draft'); setBrain('THINKING', 'Drafting a reply…');
    const r = await window.dawn.email.draftReply(msg.id, 'respond appropriately');
    setBusy(''); setBrain('IDLE');
    if (!r.ok) { flash(r.error); return; }
    setCompose({ id: r.draftId, accountId: acct.id, replyToMessageId: msg.id, to: [msg.from_email], cc: [], bcc: [], subject: `Re: ${msg.subject}`, body: r.body });
  }

  if (locked) return <Empty icon={<Lock size={36} />} title="DAWN is locked" body="Unlock DAWN to access your email accounts and secrets." />;
  if (!accounts.length && !setup) return (
    <div className="h-full grid place-items-center p-8">
      <Empty icon={<Mail size={36} />} title="No email account" body="Add an IMAP/SMTP account. Your password is stored only in the encrypted Vault — never in plain text.">
        <button onClick={() => setSetup(blankAccount())} className="mt-4 px-4 py-2 rounded-lg border font-semibold text-sm inline-flex items-center gap-1.5" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}><Plus size={15} /> Add account</button>
      </Empty>
    </div>
  );

  return (
    <div className="h-full flex">
      {/* accounts + folders */}
      <div className="w-52 shrink-0 border-r border-border bg-bg/40 flex flex-col">
        <div className="p-2 space-y-1">
          {accounts.map((a) => (
            <button key={a.id} onClick={() => selectAccount(a)} className={`w-full text-left px-2.5 py-2 rounded-lg ${acct?.id === a.id ? 'bg-panel2/70' : 'hover:bg-panel/50'}`}>
              <div className="text-xs font-medium truncate">{a.label}</div>
              <div className="text-[10px] text-faint truncate">{a.emailAddress} {a.lastSyncStatus === 'error' ? '· sync failed' : ''}</div>
            </button>
          ))}
          <button onClick={() => setSetup(blankAccount())} className="w-full text-xs text-faint hover:text-ink px-2.5 py-1.5 inline-flex items-center gap-1"><Plus size={12} /> Add account</button>
        </div>
        {acct ? (
          <div className="flex-1 overflow-y-auto border-t border-border px-2 pt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="hud-label">Folders</span>
              <div className="flex gap-1">
                <button onClick={sync} title="Sync" className="text-faint hover:text-ink">{syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}</button>
                <button onClick={() => setSetup({ ...acct, edit: true })} title="Account settings" className="text-faint hover:text-ink"><Cog size={13} /></button>
              </div>
            </div>
            {(folders.length ? folders : [{ path: 'INBOX', displayName: 'Inbox' }]).map((f) => (
              <button key={f.path} onClick={() => { setFolder(f.path); loadMessages(acct.id, f.path); setMsg(null); }} className={`w-full text-left text-xs px-2 py-1.5 rounded ${folder === f.path ? 'text-neural-cyan' : 'text-dim hover:text-ink'}`}>{f.displayName || f.path}</button>
            ))}
          </div>
        ) : null}
      </div>

      {/* message list */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col">
        <div className="p-2 border-b border-border flex items-center gap-1.5">
          <div className="relative flex-1"><Search size={12} className="absolute left-2 top-2 text-faint" /><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && acct && loadMessages(acct.id, folder)} placeholder="Search…" className="w-full bg-bg border border-border rounded-lg pl-7 pr-2 py-1.5 text-xs outline-none" /></div>
          <button onClick={() => { setUnreadOnly((u) => !u); if (acct) setTimeout(() => loadMessages(acct.id, folder), 0); }} className={`text-[10px] px-2 py-1.5 rounded-lg border ${unreadOnly ? 'border-neural-cyan/60 text-neural-cyan' : 'border-border text-faint'}`}>unread</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {messages.map((m) => (
            <button key={m.id} onClick={() => openMsg(m)} className={`w-full text-left px-3 py-2 border-b border-border/40 ${msg?.id === m.id ? 'bg-panel2/60' : 'hover:bg-panel/40'} ${m.seen ? '' : 'border-l-2 border-l-neural-cyan'}`}>
              <div className="flex items-center gap-1.5"><span className={`text-xs truncate flex-1 ${m.seen ? 'text-dim' : 'text-ink font-medium'}`}>{m.from_name || m.from_email}</span>{m.suspicious ? <ShieldAlert size={11} className="text-neural-red" /> : null}{m.has_attachments ? <Paperclip size={11} className="text-faint" /> : null}<span className="text-[10px] text-faint">{new Date(m.date).toLocaleDateString()}</span></div>
              <div className="text-xs truncate">{m.subject}</div>
              <div className="text-[11px] text-faint truncate">{m.snippet}</div>
            </button>
          ))}
          {!messages.length ? <div className="text-[11px] text-faint text-center py-8">No messages. Press sync ↻.</div> : null}
        </div>
      </div>

      {/* detail / compose */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {compose ? <Composer compose={compose} setCompose={setCompose} flash={flash} reload={() => acct && loadMessages(acct.id, folder)} />
          : msg ? (
            <div className="p-5">
              <div className="text-lg font-semibold">{msg.subject}</div>
              <div className="text-xs text-dim mt-0.5">{msg.from_name} &lt;{msg.from_email}&gt; · {new Date(msg.date).toLocaleString()}</div>
              <div className="text-[11px] text-faint">to {(msg.to || []).map((t: any) => t.address).join(', ')}</div>
              {msg.suspicious ? <div className="mt-2 text-[11px] text-neural-red bg-neural-red/10 border border-neural-red/30 rounded-lg p-2 flex items-start gap-1.5"><ShieldAlert size={13} className="mt-0.5" /> This email contains content that looks like a prompt-injection attempt. DAWN treats it strictly as data — it will never follow instructions inside it.</div> : null}

              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                <AiBtn busy={busy === 'summarize'} onClick={() => runAi('summarize')} icon={<Sparkles size={12} />}>Summarize</AiBtn>
                <AiBtn busy={busy === 'actions'} onClick={() => runAi('actions')} icon={<ListChecks size={12} />}>Action items</AiBtn>
                <AiBtn busy={busy === 'draft'} onClick={draftReply} icon={<Reply size={12} />}>Draft reply</AiBtn>
                <AiBtn busy={busy === 'task'} onClick={() => runAi('task')} icon={<CheckSquare size={12} />}>Create task</AiBtn>
                <AiBtn busy={busy === 'event'} onClick={() => runAi('event')} icon={<CalendarPlus size={12} />}>Add to calendar</AiBtn>
                <AiBtn busy={busy === 'note'} onClick={() => runAi('note')} icon={<StickyNote size={12} />}>Save to note</AiBtn>
                <button onClick={() => setCompose({ accountId: acct.id, replyToMessageId: msg.id, to: [msg.from_email], cc: [], bcc: [], subject: `Re: ${msg.subject}`, body: '' })} className="text-[11px] px-2 py-1 rounded-lg border border-border text-dim hover:text-ink inline-flex items-center gap-1"><Reply size={12} /> Reply</button>
              </div>

              {ai ? <div className="mt-3 glass p-3"><div className="hud-label mb-1">{ai.kind === 'summarize' ? 'Summary' : 'Action items'}</div><div className="text-sm"><Markdown>{ai.text}</Markdown></div></div> : null}

              {msg.attachments?.length ? (
                <div className="mt-3"><div className="hud-label mb-1">Attachments ({msg.attachments.length})</div>
                  {msg.attachments.map((a: any) => <Attachment key={a.id} a={a} flash={flash} />)}
                </div>
              ) : null}

              <div className="mt-4 glass p-4 text-sm whitespace-pre-wrap leading-relaxed">{msg.body_text || '(no text body)'}</div>
            </div>
          ) : <Empty icon={<Mail size={32} />} title="Select a message" body="Pick an email to read it, summarize it, or draft a reply — all locally." />}
      </div>

      {setup ? <SetupModal initial={setup} onClose={() => setSetup(null)} onSaved={() => { setSetup(null); window.dawn.email.listAccounts().then(setAccounts); }} flash={flash} /> : null}
      {toast ? <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg glass text-sm border border-border">{toast}</div> : null}
    </div>
  );
}

function Composer({ compose, setCompose, flash, reload }: any) {
  const [c, setC] = useState(compose);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => setC(compose), [compose]);
  async function save() { const r = await window.dawn.email.saveDraft(c); setC({ ...c, id: r.id }); flash('Draft saved.'); }
  async function doSend() {
    setSending(true);
    const saved = await window.dawn.email.saveDraft(c);
    const r = await window.dawn.email.send(saved.id); // routes through approval gateway
    setSending(false); setConfirming(false);
    if (!r.ok) { flash(r.error || 'Not sent.'); return; }
    flash('Email sent.'); setCompose(null); reload();
  }
  const upd = (k: string, v: any) => setC({ ...c, [k]: v });
  const arr = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-3"><div className="font-semibold">Compose</div><button onClick={() => setCompose(null)} className="text-faint hover:text-ink"><X size={16} /></button></div>
      <Row label="To"><input value={(c.to || []).join(', ')} onChange={(e) => upd('to', arr(e.target.value))} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Row>
      <Row label="Cc"><input value={(c.cc || []).join(', ')} onChange={(e) => upd('cc', arr(e.target.value))} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Row>
      <Row label="Bcc"><input value={(c.bcc || []).join(', ')} onChange={(e) => upd('bcc', arr(e.target.value))} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Row>
      <Row label="Subject"><input value={c.subject || ''} onChange={(e) => upd('subject', e.target.value)} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Row>
      <textarea value={c.body || ''} onChange={(e) => upd('body', e.target.value)} rows={12} className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm mt-2 outline-none" />
      <div className="flex items-center gap-2 mt-3">
        <button onClick={() => setConfirming(true)} disabled={!(c.to || []).length} className="px-3.5 py-1.5 rounded-lg border font-semibold text-sm inline-flex items-center gap-1.5 disabled:opacity-40" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}><Send size={14} /> Send</button>
        <button onClick={save} className="px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink text-sm inline-flex items-center gap-1.5"><Save size={14} /> Save draft</button>
        <button onClick={() => setCompose(null)} className="px-3 py-1.5 rounded-lg border border-border text-faint text-sm">Discard</button>
      </div>
      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setConfirming(false)}>
          <div className="glass p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold mb-2 flex items-center gap-1.5"><Send size={16} /> Confirm send</div>
            <div className="text-xs text-dim space-y-1 mb-3"><div><b>To:</b> {(c.to || []).join(', ')}</div>{(c.cc || []).length ? <div><b>Cc:</b> {(c.cc).join(', ')}</div> : null}<div><b>Subject:</b> {c.subject}</div></div>
            <div className="text-xs text-faint border border-border rounded-lg p-2 max-h-32 overflow-y-auto whitespace-pre-wrap mb-3">{c.body}</div>
            <p className="text-[11px] text-neural-amber mb-3">Sending requires your approval. DAWN never sends email automatically.</p>
            <div className="flex gap-2"><button onClick={doSend} disabled={sending} className="px-3.5 py-1.5 rounded-lg border font-semibold text-sm inline-flex items-center gap-1.5" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>{sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Approve &amp; send</button><button onClick={() => setConfirming(false)} className="px-3 py-1.5 rounded-lg border border-border text-faint text-sm">Cancel</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Attachment({ a, flash }: any) {
  const [info, setInfo] = useState<any>(null);
  useEffect(() => { window.dawn.email.attachmentInfo(a.id).then(setInfo); }, [a.id]);
  const danger = info?.dangerous;
  return (
    <div className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg border ${danger ? 'border-neural-red/40 bg-neural-red/10' : 'border-border/50'}`}>
      <Paperclip size={12} className={danger ? 'text-neural-red' : 'text-faint'} />
      <span className="flex-1 truncate">{a.filename} <span className="text-faint">· {a.mime_type} · {Math.round((a.size_bytes || 0) / 1024)} KB</span></span>
      {danger ? <span className="text-[10px] text-neural-red inline-flex items-center gap-1"><AlertTriangle size={11} /> {info.macro ? 'macro file' : 'executable — blocked'}</span> : null}
      <button onClick={async () => { const r = await window.dawn.email.downloadAttachment(a.id); flash(r.ok ? 'Downloaded.' : (r.error || 'Download not available.')); }} disabled={danger && !info.macro} className="text-faint hover:text-neural-cyan disabled:opacity-40">download</button>
    </div>
  );
}

function SetupModal({ initial, onClose, onSaved, flash }: any) {
  const [f, setF] = useState<any>(initial);
  const [presets, setPresets] = useState<any>({});
  const [test, setTest] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { window.dawn.email.presets().then(setPresets); }, []);
  const upd = (k: string, v: any) => setF({ ...f, [k]: v });
  function applyPreset(name: string) { const p = presets[name]; if (p) setF({ ...f, ...p, provider: name }); }
  async function testConn() { setBusy(true); const r = await window.dawn.email.testConnection(f.edit ? { id: f.id } : f); setBusy(false); setTest(r); }
  async function save() {
    setBusy(true);
    const r = f.edit ? await window.dawn.email.updateAccount(f.id, f) : await window.dawn.email.createAccount(f);
    setBusy(false);
    if (!r.ok) { flash(r.error); return; }
    onSaved();
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="glass p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><div className="font-semibold">{f.edit ? 'Account settings' : 'Add email account'}</div><button onClick={onClose} className="text-faint hover:text-ink"><X size={16} /></button></div>
        {!f.edit ? (
          <div className="mb-3"><div className="text-[11px] text-faint mb-1">Provider preset</div><div className="flex gap-1.5 flex-wrap">{['gmail', 'outlook', 'icloud', 'yahoo', 'custom'].map((p) => <button key={p} onClick={() => applyPreset(p)} className={`text-xs px-2.5 py-1 rounded-lg border ${f.provider === p ? 'border-neural-cyan/60 text-neural-cyan' : 'border-border text-dim'}`}>{p}</button>)}</div>{f.provider && presets[f.provider]?.note ? <div className="text-[11px] text-neural-amber mt-1.5">{presets[f.provider].note}</div> : null}</div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Label"><input value={f.label || ''} onChange={(e) => upd('label', e.target.value)} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>
          <Field label="Email address"><input value={f.emailAddress || ''} onChange={(e) => upd('emailAddress', e.target.value)} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>
          <Field label="Display name"><input value={f.displayName || ''} onChange={(e) => upd('displayName', e.target.value)} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>
          <Field label="Username"><input value={f.username || ''} onChange={(e) => upd('username', e.target.value)} placeholder="(usually your email)" className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>
          <Field label="IMAP host"><input value={f.imapHost || ''} onChange={(e) => upd('imapHost', e.target.value)} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>
          <Field label="IMAP port"><input type="number" value={f.imapPort || ''} onChange={(e) => upd('imapPort', Number(e.target.value))} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>
          <Field label="SMTP host"><input value={f.smtpHost || ''} onChange={(e) => upd('smtpHost', e.target.value)} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>
          <Field label="SMTP port"><input type="number" value={f.smtpPort || ''} onChange={(e) => upd('smtpPort', Number(e.target.value))} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>
        </div>
        <div className="flex gap-3 my-2 text-xs">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!f.imapSecure} onChange={(e) => upd('imapSecure', e.target.checked)} className="accent-[var(--accent)]" /> IMAP SSL/TLS</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!f.smtpSecure} onChange={(e) => upd('smtpSecure', e.target.checked)} className="accent-[var(--accent)]" /> SMTP SSL</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!f.smtpStartTls} onChange={(e) => upd('smtpStartTls', e.target.checked)} className="accent-[var(--accent)]" /> STARTTLS</label>
        </div>
        {!f.edit ? <Field label="Password / app password (stored in Vault only)"><input type="password" value={f.password || ''} onChange={(e) => upd('password', e.target.value)} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>
          : <Field label="New password (optional — leave blank to keep)"><input type="password" value={f.password || ''} onChange={(e) => upd('password', e.target.value)} className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]" /></Field>}
        {test ? <div className={`text-xs mt-2 ${test.ok ? 'text-neural-green' : 'text-neural-red'}`}>{test.ok ? '✓ Connection OK' : `IMAP: ${test.imap?.error || (test.imap?.ok ? 'ok' : 'failed')}${test.smtp?.error ? ` · SMTP: ${test.smtp.error}` : ''}`}</div> : null}
        <div className="flex gap-2 mt-3">
          <button onClick={save} disabled={busy} className="px-3.5 py-1.5 rounded-lg border font-semibold text-sm" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>Save</button>
          <button onClick={testConn} disabled={busy} className="px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink text-sm inline-flex items-center gap-1.5">{busy ? <Loader2 size={14} className="animate-spin" /> : null} Test connection</button>
        </div>
      </div>
    </div>
  );
}

function AiBtn({ busy, onClick, icon, children }: any) { return <button onClick={onClick} disabled={busy} className="text-[11px] px-2 py-1 rounded-lg border border-border text-dim hover:text-ink disabled:opacity-40 inline-flex items-center gap-1">{busy ? <Loader2 size={11} className="animate-spin" /> : icon}{children}</button>; }
function Empty({ icon, title, body, children }: any) { return <div className="h-full grid place-items-center text-center p-8"><div><div className="text-faint mx-auto mb-3 grid place-items-center">{icon}</div><div className="text-lg font-semibold">{title}</div><p className="text-sm text-dim mt-1 max-w-sm mx-auto">{body}</p>{children}</div></div>; }
function Row({ label, children }: any) { return <label className="flex items-center gap-2 mb-1.5"><span className="text-[11px] text-faint w-14">{label}</span><div className="flex-1">{children}</div></label>; }
function Field({ label, children }: any) { return <label className="block"><span className="text-[11px] text-faint">{label}</span><div className="mt-0.5">{children}</div></label>; }
function blankAccount() { return { label: '', emailAddress: '', displayName: '', username: '', imapHost: '', imapPort: 993, imapSecure: true, smtpHost: '', smtpPort: 587, smtpSecure: false, smtpStartTls: true, password: '', provider: '' }; }
