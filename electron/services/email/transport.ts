/**
 * transport.ts — thin IMAP (imapflow) + SMTP (nodemailer) wrappers. Credentials are passed
 * in only at call time (from the Vault), never stored here, never logged. All errors are
 * redacted before they leave this module so a server message can't leak a password.
 */
import emailCore from './emailCore';
const { simpleParser } = require('mailparser');

export interface ImapConfig { host: string; port: number; secure: boolean; user: string; pass: string }
export interface SmtpConfig { host: string; port: number; secure: boolean; startTls?: boolean; user: string; pass: string }

function redactErr(e: any, secrets: string[]): string {
  let m = String(e?.responseText || e?.message || e || 'error');
  for (const s of secrets) if (s) m = m.split(s).join('***');
  return m.replace(/\b(LOGIN|AUTH|PASS)\b[^\n]*/gi, '$1 ***').slice(0, 240);
}

// --- IMAP ------------------------------------------------------------------
async function imapClient(cfg: ImapConfig) {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }, logger: false, emitLogs: false,
  });
  await client.connect();
  return client;
}

export async function imapTest(cfg: ImapConfig): Promise<{ ok: boolean; error?: string }> {
  let client: any;
  try { client = await imapClient(cfg); await client.logout(); return { ok: true }; }
  catch (e: any) { return { ok: false, error: redactErr(e, [cfg.pass]) }; }
  finally { try { await client?.close(); } catch { /* */ } }
}

export async function imapListFolders(cfg: ImapConfig): Promise<{ ok: boolean; folders?: any[]; error?: string }> {
  let client: any;
  try {
    client = await imapClient(cfg);
    const list = await client.list();
    const folders = list.map((f: any) => ({ path: f.path, displayName: f.name, flags: (f.flags ? [...f.flags] : []).join(',') }));
    await client.logout();
    return { ok: true, folders };
  } catch (e: any) { return { ok: false, error: redactErr(e, [cfg.pass]) }; }
  finally { try { await client?.close(); } catch { /* */ } }
}

export interface FetchedMessage {
  uid: string; messageId: string; threadKey: string; subject: string; fromName: string; fromEmail: string;
  to: { name: string; address: string }[]; cc: { name: string; address: string }[]; date: number;
  bodyText: string; bodyHtmlSanitized: string; snippet: string; seen: boolean; flags: string[];
  attachments: { filename: string; mimeType: string; size: number; contentId: string }[];
}

/** Fetch the latest `limit` messages in a folder (envelopes + capped bodies). Bodies sanitized. */
export async function imapSync(cfg: ImapConfig, folder: string, limit: number): Promise<{ ok: boolean; messages?: FetchedMessage[]; total?: number; error?: string }> {
  let client: any;
  try {
    client = await imapClient(cfg);
    const lock = await client.getMailboxLock(folder);
    const out: FetchedMessage[] = [];
    try {
      const total = client.mailbox.exists || 0;
      if (total > 0) {
        const start = Math.max(1, total - limit + 1);
        for await (const msg of client.fetch(`${start}:*`, { uid: true, flags: true, envelope: true, source: true, bodyStructure: true })) {
          const parsed: any = await simpleParser(msg.source).catch(() => ({}));
          const bodyText = (parsed.text || emailCore.htmlToText(parsed.html || '') || '').slice(0, 60000);
          const bodyHtml = parsed.html ? emailCore.sanitizeEmailHtml(parsed.html).slice(0, 80000) : '';
          const subject = parsed.subject || msg.envelope?.subject || '(no subject)';
          const fromObj = (parsed.from?.value?.[0]) || (msg.envelope?.from?.[0]) || {};
          const toArr = (parsed.to?.value || []).map((a: any) => ({ name: a.name || '', address: a.address || '' }));
          const ccArr = (parsed.cc?.value || []).map((a: any) => ({ name: a.name || '', address: a.address || '' }));
          const atts = (parsed.attachments || []).map((a: any) => ({ filename: a.filename || 'attachment', mimeType: a.contentType || 'application/octet-stream', size: a.size || 0, contentId: a.cid || '' }));
          out.push({
            uid: String(msg.uid), messageId: parsed.messageId || msg.envelope?.messageId || String(msg.uid),
            threadKey: emailCore.threadKey(subject, (parsed.references || []).join(' '), parsed.inReplyTo || ''),
            subject, fromName: fromObj.name || '', fromEmail: fromObj.address || '',
            to: toArr, cc: ccArr, date: (parsed.date || msg.envelope?.date || new Date()).valueOf(),
            bodyText, bodyHtmlSanitized: bodyHtml, snippet: emailCore.snippet(bodyText),
            seen: !!(msg.flags && msg.flags.has('\\Seen')), flags: msg.flags ? [...msg.flags] : [], attachments: atts,
          });
        }
      }
      return { ok: true, messages: out.reverse(), total };
    } finally { lock.release(); await client.logout(); }
  } catch (e: any) { return { ok: false, error: redactErr(e, [cfg.pass]) }; }
  finally { try { await client?.close(); } catch { /* */ } }
}

export async function imapSetSeen(cfg: ImapConfig, folder: string, uid: string, seen: boolean): Promise<{ ok: boolean; error?: string }> {
  let client: any;
  try {
    client = await imapClient(cfg);
    const lock = await client.getMailboxLock(folder);
    try { await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true, ...(seen ? {} : {}) }); if (!seen) await client.messageFlagsRemove({ uid }, ['\\Seen'], { uid: true }); }
    finally { lock.release(); await client.logout(); }
    return { ok: true };
  } catch (e: any) { return { ok: false, error: redactErr(e, [cfg.pass]) }; }
  finally { try { await client?.close(); } catch { /* */ } }
}

// --- SMTP ------------------------------------------------------------------
function smtpTransport(cfg: SmtpConfig) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    requireTLS: !cfg.secure && !!cfg.startTls, auth: { user: cfg.user, pass: cfg.pass },
  });
}
export async function smtpTest(cfg: SmtpConfig): Promise<{ ok: boolean; error?: string }> {
  try { await smtpTransport(cfg).verify(); return { ok: true }; }
  catch (e: any) { return { ok: false, error: redactErr(e, [cfg.pass]) }; }
}
export interface SendMessage { from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; inReplyTo?: string; references?: string }
export async function smtpSend(cfg: SmtpConfig, msg: SendMessage): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const info = await smtpTransport(cfg).sendMail({
      from: msg.from, to: msg.to.join(', '), cc: msg.cc?.join(', '), bcc: msg.bcc?.join(', '),
      subject: msg.subject, text: msg.text, inReplyTo: msg.inReplyTo, references: msg.references,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e: any) { return { ok: false, error: redactErr(e, [cfg.pass]) }; }
}

export default { imapTest, imapListFolders, imapSync, imapSetSeen, smtpTest, smtpSend };
