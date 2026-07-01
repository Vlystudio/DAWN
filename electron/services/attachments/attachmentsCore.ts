/**
 * attachmentsCore.ts — pure, electron-free core for CHAT IMAGE ATTACHMENTS. It owns every decision
 * that must be safe and testable without touching disk, the DB, or a model:
 *   - which image types are allowed (PNG/JPEG/WebP always; GIF as a static first-frame preview)
 *   - sniffing the real mime + pixel dimensions from magic bytes (never trusts the caller's label)
 *   - size + dimension limits (plain-English rejections; never throws on garbage)
 *   - safe generated storage keys + display names (no path traversal, no full paths)
 *   - the SAFE metadata projection used for chat/search/workspace/diagnostics (no bytes, no path,
 *     no hash, no EXIF — only id/name/mime/size/dims/date)
 *
 * The Electron service (attachments.ts) does the fs/crypto/DB work and calls into this for every
 * validation + projection, so the rules are unit-tested in isolation. Image text (OCR/vision) is
 * NEVER handled here as instructions — the chat layer wraps it via promptSecurity.
 */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** Allowed image mime types. GIF is accepted but only the static first frame is ever previewed. */
export const SUPPORTED_MIME: ImageMime[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
};
const MIME_BY_EXT: Record<string, ImageMime> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

export interface Sniffed { mime: ImageMime; width: number; height: number }

export function isSupportedMime(mime: string): mime is ImageMime {
  return (SUPPORTED_MIME as string[]).includes(String(mime || '').toLowerCase());
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[String(mime || '').toLowerCase()] || 'bin';
}

export function mimeForExt(name: string): ImageMime | null {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? (MIME_BY_EXT[m[1]] || null) : null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/**
 * Sniff the real image type + dimensions from the leading bytes. Returns null for anything that is
 * not a real, recognised image (so a `.png` full of garbage, or a renamed .exe, is rejected). Never
 * throws — malformed/truncated data returns null or dims 0.
 */
export function sniffImage(bytes: Uint8Array | null | undefined): Sniffed | null {
  try {
    const b = bytes;
    if (!b || b.length < 12) return null;

    // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width/height at offset 16/20 (big-endian)
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      const width = b.length >= 24 ? u32be(b, 16) : 0;
      const height = b.length >= 24 ? u32be(b, 20) : 0;
      return { mime: 'image/png', width, height };
    }

    // GIF: 'GIF87a' / 'GIF89a', logical screen width/height at 6/8 (little-endian)
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return { mime: 'image/gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
    }

    // WebP: 'RIFF'....'WEBP'
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
      let width = 0, height = 0;
      const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fourcc === 'VP8 ' && b.length >= 30) { width = (b[26] | (b[27] << 8)) & 0x3fff; height = (b[28] | (b[29] << 8)) & 0x3fff; }
      else if (fourcc === 'VP8L' && b.length >= 25) { const n = u32le(b, 21); width = (n & 0x3fff) + 1; height = ((n >> 14) & 0x3fff) + 1; }
      else if (fourcc === 'VP8X' && b.length >= 30) { width = ((b[24] | (b[25] << 8) | (b[26] << 16)) & 0xffffff) + 1; height = ((b[27] | (b[28] << 8) | (b[29] << 16)) & 0xffffff) + 1; }
      return { mime: 'image/webp', width, height };
    }

    // JPEG: FF D8 ... scan SOF markers for dimensions
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        // SOF0..SOF15 (except DHT=C4, DNL=C8, DAC=CC) carry frame dimensions
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = u16be(b, i + 5);
          const width = u16be(b, i + 7);
          return { mime: 'image/jpeg', width, height };
        }
        const len = u16be(b, i + 2);
        if (len < 2) break;
        i += 2 + len;
      }
      return { mime: 'image/jpeg', width: 0, height: 0 };
    }

    return null;
  } catch {
    return null;
  }
}

export interface Limits { maxBytes: number; maxDimension: number }

export interface ValidateResult {
  ok: boolean;
  error?: string;
  mime?: ImageMime;
  width?: number;
  height?: number;
}

/**
 * The single validation gate for an incoming image: sniffs the real type + dims, then enforces the
 * type allow-list and the size/dimension limits with plain-English errors. `declaredMime`/`name` are
 * only hints — the sniffed type wins. Never throws.
 */
export function validateImage(bytes: Uint8Array | null | undefined, limits: Limits, hint?: { name?: string; declaredMime?: string }): ValidateResult {
  const size = bytes ? bytes.length : 0;
  if (!size) return { ok: false, error: 'That file is empty.' };
  if (size > limits.maxBytes) {
    return { ok: false, error: `That image is ${mib(size)} MB, over the ${mib(limits.maxBytes)} MB limit. Try a smaller screenshot or crop it first.` };
  }
  const sniff = sniffImage(bytes);
  if (!sniff) {
    const looked = hint?.declaredMime || mimeForExt(hint?.name || '') || 'the file';
    return { ok: false, error: `That doesn't look like a supported image (${String(looked)}). DAWN accepts PNG, JPEG, WebP, or GIF.` };
  }
  if (!isSupportedMime(sniff.mime)) {
    return { ok: false, error: `${sniff.mime} isn't supported. DAWN accepts PNG, JPEG, WebP, or GIF.` };
  }
  if (limits.maxDimension > 0 && (sniff.width > limits.maxDimension || sniff.height > limits.maxDimension)) {
    return { ok: false, error: `That image is ${sniff.width}×${sniff.height}px, larger than the ${limits.maxDimension}px limit. Resize or crop it first.` };
  }
  return { ok: true, mime: sniff.mime, width: sniff.width, height: sniff.height };
}

function mib(bytes: number): string { return (Math.round((bytes / (1024 * 1024)) * 10) / 10).toString(); }

/** Internal storage key: `<id>.<ext>`. IDs are opaque; this is NOT a filesystem path. */
export function storageKey(id: string, mime: string): string {
  const safeId = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'attachment';
  return `${safeId}.${extForMime(mime)}`;
}

/** A safe, human display name — strips any path, keeps a sane base, forces the real extension. */
export function safeDisplayName(name: string | undefined, mime: string): string {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const stem = base.replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').trim().slice(0, 80);
  const ext = extForMime(mime);
  return `${stem || 'image'}.${ext}`;
}

export interface AttachmentRow {
  id: string; conversation_id?: string; message_id?: string | null; kind?: string;
  mime_type: string; size_bytes: number; width?: number | null; height?: number | null;
  storage_key?: string; storage_path?: string; display_name: string; content_hash?: string;
  ocr_text?: string | null; analysis_status?: string | null; created_at: number;
}

export interface SafeAttachmentMeta {
  id: string; kind: string; mime: string; size: number;
  width: number | null; height: number | null; name: string;
  status: string; created_at: number;
}

/**
 * Project a stored attachment row down to the ONLY fields that may ever leave the main process or be
 * shown/searched/diagnosed: no bytes, no storage path, no content hash, no OCR/vision text. This is
 * the guard that keeps image paths + contents out of chat metadata, search, workspace, and
 * diagnostics.
 */
export function toSafeMeta(row: AttachmentRow): SafeAttachmentMeta {
  return {
    id: row.id,
    kind: row.kind || 'image',
    mime: row.mime_type,
    size: row.size_bytes,
    width: row.width ?? null,
    height: row.height ?? null,
    name: row.display_name,
    status: row.analysis_status || 'attached',
    created_at: row.created_at,
  };
}

/** Analysis status vocabulary shown in the UI (never invents "analyzed"). */
export const STATUS = {
  attached: 'attached',
  processing: 'processing',
  analyzed: 'analyzed',
  failed: 'failed',
  vision_unavailable: 'vision_unavailable',
} as const;
export type AttachmentStatus = keyof typeof STATUS;

export function statusLabel(status: string): string {
  switch (status) {
    case 'processing': return 'Analyzing…';
    case 'analyzed': return 'Analyzed';
    case 'failed': return 'Analysis failed';
    case 'vision_unavailable': return 'Vision unavailable';
    default: return 'Attached';
  }
}

export default {
  SUPPORTED_MIME, isSupportedMime, extForMime, mimeForExt, sniffImage, validateImage,
  storageKey, safeDisplayName, toSafeMeta, STATUS, statusLabel,
};
