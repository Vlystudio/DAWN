/**
 * attachments.ts — Electron service for CHAT IMAGE ATTACHMENTS (paste / upload / drop). Does the real
 * fs + crypto + SQLite work; all validation/metadata rules live in the pure attachmentsCore. Images
 * are stored in %APPDATA%/DAWN/chat-attachments as <sha256>.<ext> (content-addressed → automatic
 * dedup), and metadata rows live in the chat_attachments table. Only SAFE metadata (via core.toSafeMeta)
 * ever leaves this process — never the storage path, hash, bytes, or any OCR/vision text.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import db from '../db';
import settings from '../settings';
import logger from '../logger';
import core, { AttachmentRow } from './attachmentsCore';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

function dir(): string {
  const d = path.join(app.getPath('userData'), 'chat-attachments');
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* */ }
  return d;
}

export function limits() {
  const s: any = settings.get();
  const mb = Number(s.maxImageAttachmentMB) > 0 ? Number(s.maxImageAttachmentMB) : 10;
  const dim = Number(s.maxImageDimensionPx) > 0 ? Number(s.maxImageDimensionPx) : 4096;
  return { maxBytes: Math.round(mb * 1024 * 1024), maxDimension: dim };
}
export function maxPerMessage(): number {
  const n = Number((settings.get() as any).maxImagesPerMessage);
  return n > 0 ? n : 4;
}

/** Physical file path for a stored row — MAIN PROCESS ONLY (used by visionChat, never sent out). */
function storagePathFor(hash: string, mime: string): string {
  return path.join(dir(), `${hash}.${core.extForMime(mime)}`);
}

export interface AddResult { ok: boolean; error?: string; attachment?: ReturnType<typeof core.toSafeMeta> }

/** Validate + persist raw image bytes as a DRAFT attachment (message_id NULL until the message sends). */
export function addBytes(conversationId: string, bytes: Buffer, hint?: { name?: string; declaredMime?: string }): AddResult {
  try {
    const v = core.validateImage(bytes, limits(), hint);
    if (!v.ok) return { ok: false, error: v.error };
    // draft cap per conversation (defensive; UI enforces per-message too)
    const draftCount = db.all('SELECT id FROM chat_attachments WHERE conversation_id=? AND (message_id IS NULL OR message_id="")', [conversationId]).length;
    if (draftCount >= maxPerMessage()) return { ok: false, error: `You can attach up to ${maxPerMessage()} images per message.` };

    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const mime = v.mime!;
    const storagePath = storagePathFor(hash, mime);
    if (!fs.existsSync(storagePath)) fs.writeFileSync(storagePath, bytes); // content-addressed → dedup
    const id = newId();
    const displayName = core.safeDisplayName(hint?.name, mime);
    db.run(
      `INSERT INTO chat_attachments (id,conversation_id,message_id,kind,mime_type,size_bytes,width,height,storage_key,storage_path,display_name,content_hash,ocr_text,analysis_status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, conversationId, null, 'image', mime, bytes.length, v.width ?? null, v.height ?? null,
        core.storageKey(hash, mime), storagePath, displayName, hash, null, 'attached', now()]
    );
    logger.info('attachments', `attached image ${mime} ${v.width}x${v.height} ${(bytes.length / 1024).toFixed(0)}KB (conv ${String(conversationId).slice(0, 8)})`);
    return { ok: true, attachment: core.toSafeMeta(get(id)!) };
  } catch (e: any) {
    logger.warn('attachments', `add failed: ${e.message}`);
    return { ok: false, error: 'Could not read that image.' };
  }
}

/** Add from a renderer data URL (paste / drop). */
export function addFromDataUrl(conversationId: string, dataUrl: string, name?: string): AddResult {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) return { ok: false, error: 'That clipboard/drop item was not an image.' };
  let buf: Buffer;
  try { buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8'); }
  catch { return { ok: false, error: 'Could not decode that image.' }; }
  return addBytes(conversationId, buf, { name, declaredMime: m[1] });
}

/** Add from a picked file path (upload). Guards size before + after reading. */
export function addFromFile(conversationId: string, filePath: string): AddResult {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'File not found.' };
    const st = fs.statSync(filePath);
    if (st.size > limits().maxBytes * 1.05) return { ok: false, error: `That image is too large (limit ${(limits().maxBytes / 1024 / 1024).toFixed(0)} MB).` };
    const buf = fs.readFileSync(filePath);
    return addBytes(conversationId, buf, { name: path.basename(filePath) });
  } catch (e: any) {
    return { ok: false, error: 'Could not read that file.' };
  }
}

export function get(id: string): AttachmentRow | null {
  return (db.get('SELECT * FROM chat_attachments WHERE id=?', [id]) as AttachmentRow) || null;
}

/** SAFE metadata for one attachment (no path/hash/bytes/OCR). */
export function metadata(id: string) {
  const r = get(id);
  return r ? core.toSafeMeta(r) : null;
}

/** SAFE metadata list for the drafts of a conversation (not yet attached to a message). */
export function listDraft(conversationId: string) {
  return db.all('SELECT * FROM chat_attachments WHERE conversation_id=? AND (message_id IS NULL OR message_id="") ORDER BY created_at ASC', [conversationId])
    .map((r: any) => core.toSafeMeta(r));
}

/** SAFE metadata list for the attachments of a sent message. */
export function listForMessage(messageId: string) {
  if (!messageId) return [];
  return db.all('SELECT * FROM chat_attachments WHERE message_id=? ORDER BY created_at ASC', [messageId])
    .map((r: any) => core.toSafeMeta(r));
}

/** A base64 data URL for previewing an image the user themselves attached (thumbnail/modal). */
export function preview(id: string): { ok: boolean; dataUrl?: string; error?: string } {
  const r = get(id);
  if (!r || !r.storage_path) return { ok: false, error: 'Not found.' };
  try {
    const buf = fs.readFileSync(r.storage_path);
    return { ok: true, dataUrl: `data:${r.mime_type};base64,${buf.toString('base64')}` };
  } catch { return { ok: false, error: 'Preview unavailable.' }; }
}

/** Remove a DRAFT attachment (before send). Deletes the file only if no other row shares its hash. */
export function removeDraft(id: string): { ok: boolean; error?: string } {
  const r = get(id);
  if (!r) return { ok: true };
  if (r.message_id) return { ok: false, error: 'That image is already part of a sent message.' };
  db.run('DELETE FROM chat_attachments WHERE id=?', [id]);
  try {
    const others = db.all('SELECT id FROM chat_attachments WHERE content_hash=?', [r.content_hash]).length;
    if (others === 0 && r.storage_path && fs.existsSync(r.storage_path)) fs.unlinkSync(r.storage_path);
  } catch { /* */ }
  return { ok: true };
}

/** Associate draft attachments with a freshly-created user message + set the message flags. */
export function attachToMessage(conversationId: string, messageId: string, ids: string[]): number {
  if (!messageId || !ids?.length) return 0;
  let n = 0;
  for (const id of ids) {
    const r = get(id);
    if (r && r.conversation_id === conversationId && !r.message_id) {
      db.run('UPDATE chat_attachments SET message_id=? WHERE id=?', [messageId, id]);
      n++;
    }
  }
  if (n > 0) {
    try { db.run('UPDATE messages SET has_images=1, attachment_count=? WHERE id=?', [n, messageId]); } catch { /* columns migrated in db.migrate */ }
  }
  return n;
}

/** MAIN-PROCESS internal: the physical file path (for the local vision model). Never leaves main. */
export function internalRows(messageId: string): AttachmentRow[] {
  if (!messageId) return [];
  return db.all('SELECT * FROM chat_attachments WHERE message_id=? AND kind="image" ORDER BY created_at ASC', [messageId]) as AttachmentRow[];
}

/** Record analysis outcome honestly. `text` (OCR/vision) is stored for status only; never diagnosed. */
export function setStatus(id: string, status: string, text?: string) {
  try {
    db.run('UPDATE chat_attachments SET analysis_status=?, ocr_text=?, analyzed_at=? WHERE id=?',
      [status, text != null ? String(text).slice(0, 4000) : null, now(), id]);
  } catch { /* */ }
}

/** True if a sent message has any image attachments (cheap check for chat/getMessages). */
export function messageHasImages(messageId: string): boolean {
  if (!messageId) return false;
  return db.all('SELECT id FROM chat_attachments WHERE message_id=? LIMIT 1', [messageId]).length > 0;
}

export default {
  limits, maxPerMessage, addBytes, addFromDataUrl, addFromFile, get, metadata, listDraft,
  listForMessage, preview, removeDraft, attachToMessage, internalRows, setStatus, messageHasImages,
};
