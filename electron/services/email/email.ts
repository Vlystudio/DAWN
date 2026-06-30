/**
 * email.ts — DAWN's Email workspace service. Accounts store their password ONLY in the
 * encrypted Vault (kind email_credential); email tables/IPC/logs/audit never carry the
 * credential. All email content is untrusted (wrapped via PromptSecurity). Sync is
 * conservative; attachments are metadata-only until an explicit download; SMTP send is
 * gated by an explicit user action + the approval gateway + an active session.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import db from '../db';
import logger from '../logger';
import settings from '../settings';
import runtime from '../runtime';
import * as llama from '../llama';
import security from '../security/promptSecurity';
import { redactPreview } from '../security/promptSecurityCore';
import vault from '../security/vault';
import auth from '../security/auth';
import core, { EmailLike } from './emailCore';
import transport, { ImapConfig, SmtpConfig } from './transport';

const newId = () => crypto.randomUUID();
const now = () => Date.now();
const rebuild = () => { try { require('../graph').default.rebuild(); } catch { /* */ } };

function audit(action: string, status: string, accountId?: string, messageId?: string, error = '', metadata = '') {
  db.run('INSERT INTO email_audit (id,ts,account_id,message_id,action,status,error,metadata) VALUES (?,?,?,?,?,?,?,?)',
    [newId(), now(), accountId || null, messageId || null, action, status, redactPreview(error, 200), metadata]);
}

// --- credentials (Vault) ---------------------------------------------------
function getCredential(account: any): { user: string; pass: string } | null {
  auth.requireSessionForVault(); // locked → throws
  if (!account.credential_vault_item_id) return null;
  const r = vault.reveal(account.credential_vault_item_id);
  if (!r.ok) return null;
  return { user: account.username || account.email_address, pass: r.secret || '' };
}
function imapCfg(account: any, cred: { user: string; pass: string }): ImapConfig { return { host: account.imap_host, port: account.imap_port, secure: !!account.imap_secure, user: cred.user, pass: cred.pass }; }
function smtpCfg(account: any, cred: { user: string; pass: string }): SmtpConfig { return { host: account.smtp_host, port: account.smtp_port, secure: !!account.smtp_secure, startTls: !!account.smtp_start_tls, user: cred.user, pass: cred.pass }; }

// --- accounts --------------------------------------------------------------
export function listAccounts() { return db.all('SELECT * FROM email_accounts ORDER BY created_at ASC').map(core.accountPublicView); }
export function getAccount(id: string) { const r = db.get('SELECT * FROM email_accounts WHERE id=?', [id]); return r ? core.accountPublicView(r) : null; }
function rawAccount(id: string): any { return db.get('SELECT * FROM email_accounts WHERE id=?', [id]); }

export function createAccount(cfg: any): { ok: boolean; error?: string; id?: string } {
  const v = core.validateAccountConfig(cfg);
  if (!v.ok) return { ok: false, error: v.error };
  if (!cfg.password) return { ok: false, error: 'A password / app password is required.' };
  try {
    auth.requireUnlockedSession();
    // store the password ONLY in the vault
    const item: any = vault.create({ label: `Email: ${cfg.label || cfg.emailAddress}`, kind: 'email_credential', username: cfg.username || cfg.emailAddress, secret: cfg.password });
    const id = newId();
    db.run('INSERT INTO email_accounts (id,label,email_address,display_name,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,smtp_start_tls,username,credential_vault_item_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, cfg.label || cfg.emailAddress, cfg.emailAddress, cfg.displayName || '', cfg.imapHost, cfg.imapPort, cfg.imapSecure ? 1 : 0, cfg.smtpHost || '', cfg.smtpPort || 0, cfg.smtpSecure ? 1 : 0, cfg.smtpStartTls ? 1 : 0, cfg.username || cfg.emailAddress, item.id, 1, now(), now()]);
    audit('account_create', 'ok', id, undefined, '', core.buildAuditMeta('account', {}));
    rebuild();
    return { ok: true, id };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export function updateAccount(id: string, patch: any): { ok: boolean; error?: string } {
  const acc = rawAccount(id);
  if (!acc) return { ok: false, error: 'Account not found.' };
  try {
    auth.requireUnlockedSession();
    if (patch.password) { vault.update(acc.credential_vault_item_id, { secret: patch.password }); auth.auditSecurityAction('vault_update', `email credential ${id}`); }
    const f = (k: string, col: string) => (patch[k] !== undefined ? patch[k] : acc[col]);
    db.run('UPDATE email_accounts SET label=?, display_name=?, imap_host=?, imap_port=?, imap_secure=?, smtp_host=?, smtp_port=?, smtp_secure=?, smtp_start_tls=?, username=?, enabled=?, updated_at=? WHERE id=?',
      [f('label', 'label'), f('displayName', 'display_name'), f('imapHost', 'imap_host'), f('imapPort', 'imap_port'), patch.imapSecure !== undefined ? (patch.imapSecure ? 1 : 0) : acc.imap_secure, f('smtpHost', 'smtp_host'), f('smtpPort', 'smtp_port'), patch.smtpSecure !== undefined ? (patch.smtpSecure ? 1 : 0) : acc.smtp_secure, patch.smtpStartTls !== undefined ? (patch.smtpStartTls ? 1 : 0) : acc.smtp_start_tls, f('username', 'username'), patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : acc.enabled, now(), id]);
    rebuild();
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export function deleteAccount(id: string, deleteCredential = true): { ok: boolean } {
  const acc = rawAccount(id);
  if (acc) {
    if (deleteCredential && acc.credential_vault_item_id) { try { vault.remove(acc.credential_vault_item_id); } catch { /* */ } }
    for (const t of ['email_accounts', 'email_folders', 'email_messages', 'email_drafts']) db.run(`DELETE FROM ${t} WHERE ${t === 'email_accounts' ? 'id' : 'account_id'}=?`, [id]);
    audit('account_delete', 'ok', id);
    rebuild();
  }
  return { ok: true };
}

// --- connection test -------------------------------------------------------
export async function testConnection(cfg: any): Promise<{ ok: boolean; imap?: any; smtp?: any }> {
  // cfg may be a new (unsaved) account with a plaintext password, or an existing account id
  let imapC: ImapConfig, smtpC: SmtpConfig | null = null;
  if (cfg.id) {
    const acc = rawAccount(cfg.id); if (!acc) return { ok: false };
    const cred = getCredential(acc); if (!cred) return { ok: false, imap: { ok: false, error: 'No credential (locked?).' } };
    imapC = imapCfg(acc, cred); smtpC = acc.smtp_host ? smtpCfg(acc, cred) : null;
  } else {
    const cred = { user: cfg.username || cfg.emailAddress, pass: cfg.password };
    imapC = { host: cfg.imapHost, port: cfg.imapPort, secure: !!cfg.imapSecure, ...cred };
    smtpC = cfg.smtpHost ? { host: cfg.smtpHost, port: cfg.smtpPort, secure: !!cfg.smtpSecure, startTls: !!cfg.smtpStartTls, ...cred } : null;
  }
  const imap = await transport.imapTest(imapC);
  const smtp = smtpC ? await transport.smtpTest(smtpC) : { ok: true, skipped: true };
  logger.info('email', `Connection test imap=${imap.ok} smtp=${(smtp as any).ok}`); // no secrets
  return { ok: imap.ok && (smtp as any).ok !== false, imap, smtp };
}

// --- sync ------------------------------------------------------------------
export async function listFolders(accountId: string): Promise<{ ok: boolean; folders?: any[]; error?: string }> {
  const acc = rawAccount(accountId); if (!acc) return { ok: false, error: 'Account not found.' };
  try {
    const cred = getCredential(acc); if (!cred) return { ok: false, error: 'Unlock DAWN to access this account.' };
    const r = await transport.imapListFolders(imapCfg(acc, cred));
    if (r.ok) for (const f of r.folders!) db.run('INSERT OR REPLACE INTO email_folders (id,account_id,path,display_name,flags,updated_at) VALUES (?,?,?,?,?,?)', [`${accountId}:${f.path}`, accountId, f.path, f.displayName, f.flags, now()]);
    audit('list_folders', r.ok ? 'ok' : 'error', accountId, undefined, r.error || '');
    return r;
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function sync(accountId: string, folder = 'INBOX'): Promise<{ ok: boolean; synced?: number; error?: string }> {
  const acc = rawAccount(accountId); if (!acc) return { ok: false, error: 'Account not found.' };
  if (!acc.enabled) return { ok: false, error: 'Account is disabled.' };
  try {
    const cred = getCredential(acc); if (!cred) return { ok: false, error: 'Unlock DAWN to sync this account.' };
    const limit = Math.max(10, Math.min(300, settings.get().emailSyncLimit || 50));
    const r = await transport.imapSync(imapCfg(acc, cred), folder, limit);
    if (!r.ok) { db.run('UPDATE email_accounts SET last_sync_at=?, last_sync_status=? WHERE id=?', [now(), 'error', accountId]); audit('sync', 'error', accountId, undefined, r.error || ''); return { ok: false, error: r.error }; }
    let synced = 0;
    for (const m of r.messages!) {
      const id = `${accountId}:${folder}:${m.uid}`;
      const risk = core.riskScore(m.subject, m.bodyText);
      db.run('INSERT OR REPLACE INTO email_messages (id,account_id,folder_path,uid,provider_message_id,thread_key,subject,from_name,from_email,to_json,cc_json,date,snippet,body_text,body_html_sanitized,flags_json,seen,has_attachments,attachment_count,content_hash,prompt_risk_score,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, accountId, folder, m.uid, m.messageId, m.threadKey, m.subject, m.fromName, m.fromEmail, JSON.stringify(m.to), JSON.stringify(m.cc), m.date, m.snippet, m.bodyText, m.bodyHtmlSanitized, JSON.stringify(m.flags), m.seen ? 1 : 0, m.attachments.length ? 1 : 0, m.attachments.length, core.contentHash(m.bodyText), risk, now(), now()]);
      db.run('DELETE FROM email_attachments WHERE message_id=?', [id]);
      for (const a of m.attachments) { const sn = core.safeAttachmentName(a.filename); db.run('INSERT INTO email_attachments (id,message_id,filename,mime_type,size_bytes,content_id,downloaded,created_at) VALUES (?,?,?,?,?,?,0,?)', [newId(), id, sn.name, a.mimeType, a.size, a.contentId, now()]); }
      if (risk >= 25) security.inspect(`email: ${m.subject}`, `${m.subject}\n${m.bodyText}`, 'email', id);
      synced++;
    }
    db.run('UPDATE email_accounts SET last_sync_at=?, last_sync_status=? WHERE id=?', [now(), 'ok', accountId]);
    audit('sync', 'ok', accountId, undefined, '', `folder=${folder} count=${synced}`);
    rebuild();
    return { ok: true, synced };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// --- read / list -----------------------------------------------------------
export function listMessages(accountId: string, folder = 'INBOX', opts: { query?: string; tagId?: string; unreadOnly?: boolean; limit?: number } = {}) {
  let rows = db.all('SELECT id,account_id,folder_path,subject,from_name,from_email,date,snippet,seen,has_attachments,attachment_count,thread_key,prompt_risk_score FROM email_messages WHERE account_id=? AND folder_path=? ORDER BY date DESC LIMIT ?', [accountId, folder, Math.min(500, opts.limit || 200)]);
  if (opts.unreadOnly) rows = rows.filter((m: any) => !m.seen);
  if (opts.query) rows = rows.filter((m: any) => core.matchSearch(m, opts.query!));
  if (opts.tagId) { const tagged = new Set(db.all('SELECT message_id FROM email_message_tags WHERE tag_id=?', [opts.tagId]).map((r: any) => r.message_id)); rows = rows.filter((m: any) => tagged.has(m.id)); }
  return rows.map((m: any) => ({ ...m, suspicious: (m.prompt_risk_score || 0) >= 25, tags: messageTagIds(m.id) }));
}
export function getMessage(id: string) {
  const m: any = db.get('SELECT * FROM email_messages WHERE id=?', [id]);
  if (!m) return null;
  return { ...m, to: safe(m.to_json), cc: safe(m.cc_json), flags: safe(m.flags_json), suspicious: (m.prompt_risk_score || 0) >= 25, attachments: db.all('SELECT * FROM email_attachments WHERE message_id=?', [id]), tags: messageTagIds(id) };
}
export function thread(threadKey: string) { return db.all('SELECT * FROM email_messages WHERE thread_key=? ORDER BY date ASC', [threadKey]); }

// --- AI actions ------------------------------------------------------------
async function ask(messages: llama.ChatMsg[], opts: { temperature?: number; max_tokens?: number } = {}): Promise<string> {
  if (!runtime.isReady()) throw new Error('Turn DAWN ON and load a model first.');
  security.assertNoUntrustedSystemRole(messages); // email content must never be in the system role
  return llama.chat(runtime.baseUrl(), messages, { temperature: opts.temperature ?? 0.4, top_p: 0.9, max_tokens: opts.max_tokens ?? 700 });
}
function asEmailLike(m: any): EmailLike { return { subject: m.subject, fromName: m.from_name, fromEmail: m.from_email, bodyText: m.body_text, date: m.date }; }

export async function summarize(id: string): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const m: any = db.get('SELECT * FROM email_messages WHERE id=?', [id]); if (!m) return { ok: false, error: 'Not found.' };
  security.inspect(`email: ${m.subject}`, m.body_text, 'email', id);
  try { return { ok: true, summary: (await ask(core.buildSummarizeMessages(asEmailLike(m)))).trim() }; } catch (e: any) { return { ok: false, error: e.message }; }
}
export async function summarizeThread(threadKey: string): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const msgs = thread(threadKey); if (!msgs.length) return { ok: false, error: 'No thread.' };
  for (const m of msgs) security.inspect(`email: ${m.subject}`, m.body_text, 'email', m.id);
  try { return { ok: true, summary: (await ask(core.buildThreadSummaryMessages(msgs.map(asEmailLike)), { max_tokens: 1000 })).trim() }; } catch (e: any) { return { ok: false, error: e.message }; }
}
export async function extractActions(id: string): Promise<{ ok: boolean; error?: string; text?: string }> {
  const m: any = db.get('SELECT * FROM email_messages WHERE id=?', [id]); if (!m) return { ok: false, error: 'Not found.' };
  security.inspect(`email: ${m.subject}`, m.body_text, 'email', id);
  try { return { ok: true, text: (await ask(core.buildExtractActionsMessages(asEmailLike(m)))).trim() }; } catch (e: any) { return { ok: false, error: e.message }; }
}

// --- drafts (never send) ---------------------------------------------------
export async function draftReply(id: string, instruction = 'respond appropriately'): Promise<{ ok: boolean; error?: string; draftId?: string; body?: string }> {
  const m: any = db.get('SELECT * FROM email_messages WHERE id=?', [id]); if (!m) return { ok: false, error: 'Not found.' };
  const acc = rawAccount(m.account_id);
  security.inspect(`email: ${m.subject}`, m.body_text, 'email', id);
  try {
    const body = (await ask(core.buildDraftReplyMessages(asEmailLike(m), instruction), { max_tokens: 900 })).trim();
    const draftId = newId();
    db.run('INSERT INTO email_drafts (id,account_id,reply_to_message_id,to_json,subject,body,in_reply_to,refs,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [draftId, m.account_id, id, JSON.stringify([m.from_email]), `Re: ${core.normalizeSubject(m.subject)}`, body, m.provider_message_id || '', m.provider_message_id || '', 'draft', 'ai', now(), now()]);
    audit('draft_reply', 'ok', m.account_id, id);
    return { ok: true, draftId, body }; // explicitly NOT sent
  } catch (e: any) { return { ok: false, error: e.message }; }
}
export function saveDraft(draft: any): { ok: boolean; id?: string } {
  const id = draft.id || newId();
  db.run('INSERT OR REPLACE INTO email_drafts (id,account_id,reply_to_message_id,to_json,cc_json,bcc_json,subject,body,in_reply_to,refs,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, draft.accountId, draft.replyToMessageId || null, JSON.stringify(draft.to || []), JSON.stringify(draft.cc || []), JSON.stringify(draft.bcc || []), draft.subject || '', draft.body || '', draft.inReplyTo || '', draft.refs || '', 'draft', draft.createdBy || 'user', now(), now()]);
  return { ok: true, id };
}
export function getDraft(id: string) { const d: any = db.get('SELECT * FROM email_drafts WHERE id=?', [id]); return d ? { ...d, to: safe(d.to_json), cc: safe(d.cc_json), bcc: safe(d.bcc_json) } : null; }
export function deleteDraft(id: string) { db.run('DELETE FROM email_drafts WHERE id=?', [id]); return { ok: true }; }

// --- send (explicit only; callers gate via the approval gateway) -----------
export async function sendDraft(draftId: string): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const d: any = db.get('SELECT * FROM email_drafts WHERE id=?', [draftId]); if (!d) return { ok: false, error: 'Draft not found.' };
  const acc = rawAccount(d.account_id); if (!acc) return { ok: false, error: 'Account not found.' };
  if (!acc.smtp_host) return { ok: false, error: 'No SMTP server configured for this account.' };
  try {
    auth.requireUnlockedSession();
    const cred = getCredential(acc); if (!cred) return { ok: false, error: 'Unlock DAWN to send.' };
    const to = safe(d.to_json), cc = safe(d.cc_json), bcc = safe(d.bcc_json);
    const r = await transport.smtpSend(smtpCfg(acc, cred), { from: acc.display_name ? `${acc.display_name} <${acc.email_address}>` : acc.email_address, to, cc, bcc, subject: d.subject, text: d.body, inReplyTo: d.in_reply_to || undefined, references: d.refs || undefined });
    db.run('UPDATE email_drafts SET status=? WHERE id=?', [r.ok ? 'sent' : 'error', draftId]);
    audit('send', r.ok ? 'ok' : 'error', d.account_id, d.reply_to_message_id, r.error || '', core.buildAuditMeta('send', { to, subject: d.subject }));
    return r.ok ? { ok: true, messageId: r.messageId } : { ok: false, error: r.error };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// --- attachments -----------------------------------------------------------
export function attachmentInfo(id: string) {
  const a: any = db.get('SELECT * FROM email_attachments WHERE id=?', [id]); if (!a) return null;
  const risk = core.attachmentRisk(a.filename, a.mime_type);
  return { ...a, ...risk };
}
export async function downloadAttachment(id: string): Promise<{ ok: boolean; error?: string; path?: string; warning?: string }> {
  // Metadata-only by design in this build: re-fetch raw bytes from IMAP would be added here.
  const a = attachmentInfo(id); if (!a) return { ok: false, error: 'Not found.' };
  const sn = core.safeAttachmentName(a.filename); if (!sn.ok) return { ok: false, error: sn.error };
  const dir = path.join(app.getPath('userData'), 'email-attachments'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${id.slice(0, 8)}-${sn.name}`);
  if (path.dirname(dest) !== dir) return { ok: false, error: 'unsafe path' };
  return { ok: false, error: 'Attachment download requires a live re-fetch (not enabled in this build).', warning: a.dangerous ? a.reason : undefined };
}

// --- tags / search ---------------------------------------------------------
export function listTags() { return db.all('SELECT * FROM email_tags ORDER BY name'); }
export function createTag(name: string, color = '') { const id = newId(); db.run('INSERT INTO email_tags (id,name,color) VALUES (?,?,?)', [id, name, color]); return { id, name, color }; }
export function tagMessage(messageId: string, tagId: string) { if (!db.get('SELECT 1 FROM email_message_tags WHERE message_id=? AND tag_id=?', [messageId, tagId])) db.run('INSERT INTO email_message_tags (message_id,tag_id) VALUES (?,?)', [messageId, tagId]); return { ok: true }; }
export function untagMessage(messageId: string, tagId: string) { db.run('DELETE FROM email_message_tags WHERE message_id=? AND tag_id=?', [messageId, tagId]); return { ok: true }; }
function messageTagIds(messageId: string): string[] { return db.all('SELECT tag_id FROM email_message_tags WHERE message_id=?', [messageId]).map((r: any) => r.tag_id); }

// --- workspace integration (task / calendar / note / document) -------------
export async function createTaskFromEmail(id: string): Promise<{ ok: boolean; error?: string; taskId?: string; title?: string }> {
  const m: any = db.get('SELECT * FROM email_messages WHERE id=?', [id]); if (!m) return { ok: false, error: 'Not found.' };
  security.inspect(`email: ${m.subject}`, m.body_text, 'email', id);
  try {
    const raw = await ask(core.buildEmailToTaskMessages(asEmailLike(m)), { temperature: 0.3 });
    const wsCore = require('../workspace/wsCore').default;
    const t = wsCore.parseTask(raw, m.subject || 'Follow up on email');
    const tasks = require('../workspace/tasks').default;
    const task: any = tasks.create({ title: t.title, details: `${t.details}\n\nFrom email: ${core.maskEmail(m.from_email)} — "${m.subject}"`, priority: t.priority, source_type: 'email', source_id: id });
    audit('create_task', 'ok', m.account_id, id);
    return { ok: true, taskId: task.id, title: t.title };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
export async function createCalendarFromEmail(id: string): Promise<{ ok: boolean; error?: string; eventId?: string }> {
  const m: any = db.get('SELECT * FROM email_messages WHERE id=?', [id]); if (!m) return { ok: false, error: 'Not found.' };
  try {
    const cal = require('../calendar/calendar').default;
    const ev: any = cal.create({ title: `Email: ${core.normalizeSubject(m.subject)}`, start_at: now() + 86400000, details: `Follow up on email from ${core.maskEmail(m.from_email)}`, source_type: 'email', source_id: id });
    audit('create_calendar', 'ok', m.account_id, id);
    return { ok: true, eventId: ev.id };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
export async function saveSummaryToNote(id: string): Promise<{ ok: boolean; error?: string; noteId?: string }> {
  const r = await summarize(id); if (!r.ok) return { ok: false, error: r.error };
  const m: any = db.get('SELECT * FROM email_messages WHERE id=?', [id]);
  const notes = require('../workspace/notes').default;
  const note: any = notes.create({ title: `Email summary: ${m.subject}`, content: `> From ${core.maskEmail(m.from_email)}\n\n${r.summary}`, tags: 'email' });
  audit('save_note', 'ok', m.account_id, id);
  return { ok: true, noteId: note.id };
}

export function recentAudit(limit = 100) { return db.all('SELECT * FROM email_audit ORDER BY ts DESC LIMIT ?', [Math.min(300, limit)]); }

function safe(s: string): any[] { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }

export default {
  listAccounts, getAccount, createAccount, updateAccount, deleteAccount, testConnection,
  listFolders, sync, listMessages, getMessage, thread,
  summarize, summarizeThread, extractActions, draftReply, saveDraft, getDraft, deleteDraft, sendDraft,
  attachmentInfo, downloadAttachment, listTags, createTag, tagMessage, untagMessage,
  createTaskFromEmail, createCalendarFromEmail, saveSummaryToNote, recentAudit, presets: core.PROVIDER_PRESETS,
};
