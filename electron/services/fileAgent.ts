import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { app, net } from 'electron';
import logger from './logger';
import settings from './settings';
import { credentialFloorReason, isSecretFile as isCredSecretFile } from './credentialFloor';

/**
 * fileAgent.ts — DAWN's "computer access": scanning, organizing, and downloading.
 *
 * Safety model (non-negotiable, enforced here regardless of what the model asks):
 *  - READS are broad, but secret files (keys, .env, password stores) are never
 *    read into the model.
 *  - MODIFICATIONS are confined to allowed roots (the user's profile by default)
 *    and NEVER touch protected system / credential areas.
 *  - DELETIONS go to the Recycle Bin, never a permanent wipe.
 *  - Every change is recorded to an undo journal so it can be reversed.
 *  - DOWNLOADS land in a quarantine folder and are never executed.
 *
 * The chat tool-loop (chat.ts) adds the approval gate on top of this.
 */

const HOME = os.homedir(); // e.g. C:\Users\benma

// ---- Guardrails -----------------------------------------------------------

// Path segments that are off-limits for modification anywhere they appear.
const PROTECTED_SEGMENTS = new Set([
  'windows', 'winnt', 'program files', 'program files (x86)', 'programdata',
  '$recycle.bin', 'system volume information', 'recovery', 'boot', 'perflogs',
  '.ssh', '.aws', '.gnupg', '.gpg', '.kube', '.docker', 'node_modules', '.git',
]);

// Lowercased path fragments that are protected for BOTH read and write
// (credential stores / browser profiles / DAWN's own data).
const PROTECTED_FRAGMENTS = [
  'appdata\\local\\google\\chrome\\user data',
  'appdata\\local\\microsoft\\edge\\user data',
  'appdata\\roaming\\mozilla\\firefox\\profiles',
  'appdata\\local\\bravesoftware',
  'appdata\\roaming\\dawn',
  '\\.config\\google-chrome',
];

// Files whose CONTENTS must never be read into the model and never moved.
const SECRET_FILE_RE = [
  /(^|[\\/])id_rsa/i, /(^|[\\/])id_ed25519/i, /(^|[\\/])id_ecdsa/i,
  /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i, /\.ppk$/i, /\.keystore$/i,
  /\.kdbx$/i, /(^|[\\/])\.env(\.|$)/i, /secrets?\.(json|ya?ml|txt)$/i,
];

function norm(p: string): string {
  return path.resolve(p);
}
function lc(p: string): string {
  return norm(p).toLowerCase().replace(/\//g, '\\');
}
function segments(p: string): string[] {
  return lc(p).split('\\').filter(Boolean);
}

export function isSecretFile(p: string): boolean {
  return SECRET_FILE_RE.some((re) => re.test(p));
}

/** Protected for modification (and, for credential fragments, for reading too). */
function isProtectedPath(p: string): boolean {
  const segs = segments(p);
  if (segs.some((s) => PROTECTED_SEGMENTS.has(s))) return true;
  const l = lc(p);
  if (PROTECTED_FRAGMENTS.some((f) => l.includes(f))) return true;
  return false;
}

/** May DAWN READ this path's contents? (metadata listing is always allowed) */
export function canRead(p: string): boolean {
  if (credentialFloorReason(p)) return false;   // secrets/credentials never read — even in Full Power
  if (isSecretFile(p)) return false;
  const l = lc(p);
  // Block reading inside credential fragments specifically.
  if (PROTECTED_FRAGMENTS.some((f) => l.includes(f))) return false;
  if (segments(p).some((s) => ['.ssh', '.aws', '.gnupg', '.gpg'].includes(s))) return false;
  return true;
}

/** May DAWN MODIFY (move/delete/rename/create at) this path? */
export function canModify(p: string): { ok: boolean; reason?: string } {
  const target = norm(p);
  // The credential/secret FLOOR is absolute — it holds even in Full Power mode.
  const floor = credentialFloorReason(target);
  if (floor) return { ok: false, reason: floor };

  // Full Power: edit files ANYWHERE (system folders included, approval-gated at the tool
  // layer) — only the credential floor above is off-limits, plus a bare drive root.
  if (settings.get().fullPowerMode) {
    if (segments(target).length < 2) return { ok: false, reason: 'refusing to modify a drive root' };
    return { ok: true };
  }

  if (isProtectedPath(target)) return { ok: false, reason: 'protected system/credential area' };
  if (isSecretFile(target)) return { ok: false, reason: 'looks like a secret/key file' };
  const scope = settings.get().fileModifyScope || 'user';
  if (scope === 'user') {
    if (lc(target).startsWith(lc(HOME) + '\\') || lc(target) === lc(HOME)) return { ok: true };
    return { ok: false, reason: 'outside your user folder (modify scope = user folders only)' };
  }
  // scope === 'anywhere': allow on real drives, but not a drive root itself.
  const segs = segments(target);
  if (segs.length < 2) return { ok: false, reason: 'refusing to modify a drive root' };
  return { ok: true };
}

// ---- Categories -----------------------------------------------------------

const CATEGORIES: Record<string, string[]> = {
  Documents: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'epub'],
  Images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'svg', 'tiff', 'ico', 'raw'],
  Audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma'],
  Video: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  Installers: ['exe', 'msi', 'appx', 'msix'],
  Code: ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'html', 'css', 'json', 'sh', 'ps1', 'rb', 'php'],
};
function categoryOf(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  for (const [cat, exts] of Object.entries(CATEGORIES)) if (exts.includes(ext)) return cat;
  return 'Other';
}
export function humanBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// ---- Path resolution -----------------------------------------------------
// The model often guesses paths ("C:\Users\YourUsername\Desktop"), and Windows
// known folders may be redirected into OneDrive. Resolve friendly names and
// placeholders to the REAL on-disk paths so a simple request just works.

function knownFolders(): Record<string, string> {
  const g = (n: string) => { try { return app.getPath(n as any); } catch { return ''; } };
  return {
    home: HOME, '~': HOME, userprofile: HOME,
    desktop: g('desktop'), documents: g('documents'), docs: g('documents'),
    downloads: g('downloads'), download: g('downloads'),
    music: g('music'), pictures: g('pictures'), photos: g('pictures'), videos: g('videos'),
  };
}

/** Human-readable list of real folders, injected into the tool prompt. */
export function knownFoldersText(): string {
  const kf = knownFolders();
  const pick = ['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'];
  return pick.filter((k) => kf[k]).map((k) => `${k}=${kf[k]}`).join('; ');
}

/** Turn whatever the user/model gave us into a real absolute path. */
export function resolvePath(input: string): string {
  let p = String(input || '').trim().replace(/^["']|["']$/g, '');
  if (!p) return p;
  const kf = knownFolders();
  p = p.replace(/%userprofile%/gi, HOME).replace(/^~(?=[\\/]|$)/, HOME);
  // Bare friendly name, e.g. "Desktop" or "downloads".
  const low = p.toLowerCase();
  if (kf[low]) return kf[low];
  // Swap obvious placeholder usernames for the real one.
  p = p.replace(/(\\users\\)(yourusername|username|<username>|<user>|user|me)(\\|$)/i, `$1${path.basename(HOME)}$3`);
  // If it still doesn't exist but ends in a known-folder name, use the real one
  // (handles OneDrive-redirected Desktop/Documents/etc.).
  if (!fs.existsSync(p)) {
    const leaf = p.toLowerCase().split(/[\\/]/).filter(Boolean).pop() || '';
    if (kf[leaf]) return kf[leaf];
  }
  return p;
}

// ---- Read-only: list / scan / find / read --------------------------------

export function list(dir: string): { ok: boolean; error?: string; path?: string; items?: { name: string; path: string; dir: boolean; size: number; mtime: number }[] } {
  const d = resolvePath(dir);
  if (!fs.existsSync(d)) return { ok: false, error: 'path not found' };
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(d, { withFileTypes: true }); }
  catch (e: any) { return { ok: false, error: e.message }; }
  const items = entries.map((e) => {
    const full = path.join(d, e.name);
    let size = 0; let mtime = 0;
    try { const st = fs.statSync(full); size = st.size; mtime = st.mtimeMs; } catch { /* */ }
    return { name: e.name, path: full, dir: e.isDirectory(), size, mtime };
  });
  return { ok: true, path: d, items };
}

export interface ScanReport {
  ok: boolean;
  error?: string;
  root?: string;
  totalFiles?: number;
  totalDirs?: number;
  totalBytes?: number;
  byCategory?: { category: string; count: number; bytes: number }[];
  largest?: { path: string; bytes: number }[];
  oldest?: { path: string; mtime: number }[];
  duplicates?: { name: string; bytes: number; count: number; paths: string[] }[];
  truncated?: boolean;
}

/** Read-only recursive scan → a summary report. Never reads file contents. */
export function scan(dir: string, opts: { maxDepth?: number; maxEntries?: number } = {}): ScanReport {
  const root = resolvePath(dir);
  if (!fs.existsSync(root)) return { ok: false, error: 'path not found' };
  const maxDepth = opts.maxDepth ?? 8;
  const maxEntries = opts.maxEntries ?? 400000;
  logger.info('fileagent', `Scan » ${root}`);

  const cat: Record<string, { count: number; bytes: number }> = {};
  const largest: { path: string; bytes: number }[] = [];
  const sizeKey = new Map<string, string[]>(); // "name|size" -> paths (dup heuristic)
  let totalFiles = 0; let totalDirs = 0; let totalBytes = 0; let seen = 0; let truncated = false;

  const walk = (d: string, depth: number) => {
    if (truncated || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > maxEntries) { truncated = true; return; }
      const full = path.join(d, e.name);
      const segs = e.name.toLowerCase();
      if (e.isDirectory()) {
        totalDirs++;
        // Don't descend into protected/system/credential noise.
        if (PROTECTED_SEGMENTS.has(segs) || isProtectedPath(full)) continue;
        walk(full, depth + 1);
      } else if (e.isFile()) {
        let size = 0; let mtime = 0;
        try { const st = fs.statSync(full); size = st.size; mtime = st.mtimeMs; } catch { continue; }
        totalFiles++; totalBytes += size;
        const c = categoryOf(e.name);
        (cat[c] ||= { count: 0, bytes: 0 }).count++; cat[c].bytes += size;
        // top-20 largest
        if (largest.length < 20 || size > largest[largest.length - 1].bytes) {
          largest.push({ path: full, bytes: size });
          largest.sort((a, b) => b.bytes - a.bytes);
          if (largest.length > 20) largest.pop();
        }
        if (size > 1024) {
          const k = `${e.name.toLowerCase()}|${size}`;
          const arr = sizeKey.get(k) || [];
          arr.push(full); sizeKey.set(k, arr);
        }
      }
    }
  };
  walk(root, 0);

  const duplicates = [...sizeKey.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([k, paths]) => ({ name: k.split('|')[0], bytes: +k.split('|')[1], count: paths.length, paths: paths.slice(0, 8) }))
    .sort((a, b) => b.bytes * b.count - a.bytes * a.count)
    .slice(0, 25);

  return {
    ok: true,
    root,
    totalFiles, totalDirs, totalBytes,
    byCategory: Object.entries(cat).map(([category, v]) => ({ category, count: v.count, bytes: v.bytes })).sort((a, b) => b.bytes - a.bytes),
    largest,
    duplicates,
    truncated,
  };
}

export function find(rootDir: string, query: string, opts: { kind?: string; minBytes?: number; olderThanDays?: number; limit?: number } = {}): { ok: boolean; error?: string; items: { path: string; bytes: number; mtime: number }[] } {
  const root = resolvePath(rootDir);
  if (!fs.existsSync(root)) return { ok: false, error: 'path not found', items: [] };
  const limit = opts.limit ?? 200;
  const q = (query || '').toLowerCase();
  const cutoff = opts.olderThanDays ? Date.now() - opts.olderThanDays * 86400000 : 0;
  const out: { path: string; bytes: number; mtime: number }[] = [];
  let seen = 0;
  const walk = (d: string, depth: number) => {
    if (out.length >= limit || depth > 8 || ++seen > 300000) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!isProtectedPath(full)) walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (q && !e.name.toLowerCase().includes(q)) continue;
      if (opts.kind && categoryOf(e.name) !== opts.kind) continue;
      let size = 0; let mtime = 0;
      try { const st = fs.statSync(full); size = st.size; mtime = st.mtimeMs; } catch { continue; }
      if (opts.minBytes && size < opts.minBytes) continue;
      if (cutoff && mtime > cutoff) continue;
      out.push({ path: full, bytes: size, mtime });
      if (out.length >= limit) return;
    }
  };
  walk(root, 0);
  return { ok: true, items: out };
}

export function readText(file: string, maxBytes = 200000): { ok: boolean; error?: string; path?: string; bytes?: number; truncated?: boolean; text?: string } {
  const f = resolvePath(file);
  if (!fs.existsSync(f)) return { ok: false, error: 'not found' };
  if (!canRead(f)) return { ok: false, error: 'reading this file is blocked (looks like a secret/credential)' };
  try {
    const st = fs.statSync(f);
    if (st.isDirectory()) return { ok: false, error: 'is a directory' };
    const fd = fs.openSync(f, 'r');
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd);
    return { ok: true, path: f, bytes: st.size, truncated: st.size > maxBytes, text: buf.toString('utf-8') };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ---- Organize planning (no side effects) ---------------------------------

export interface FileOp { action: 'move' | 'mkdir' | 'recycle' | 'rename'; from?: string; to?: string }

/** Propose moving the loose files directly under `dir` into category subfolders.
 *  Returns ops + a human summary; does NOT touch the disk. */
export function planOrganize(dir: string, by: 'type' = 'type'): { ok: boolean; error?: string; ops: FileOp[]; summary: string } {
  const d = resolvePath(dir);
  const cm = canModify(d);
  if (!cm.ok) return { ok: false, error: `Can't organize here — ${cm.reason}.`, ops: [], summary: '' };
  if (!fs.existsSync(d)) return { ok: false, error: 'path not found', ops: [], summary: '' };

  const known = new Set([...Object.keys(CATEGORIES), 'Other']);
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e: any) { return { ok: false, error: e.message, ops: [], summary: '' }; }

  const buckets: Record<string, string[]> = {};
  for (const e of entries) {
    if (!e.isFile()) continue;
    const full = path.join(d, e.name);
    if (isSecretFile(full)) continue; // never move secrets
    const c = categoryOf(e.name);
    (buckets[c] ||= []).push(e.name);
  }
  // Drop buckets that would just shuffle a single Other file, etc. Keep it useful.
  const ops: FileOp[] = [];
  const lines: string[] = [];
  for (const [cat, files] of Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)) {
    if (!files.length) continue;
    const destDir = path.join(d, cat);
    // Skip if every file is already inside a same-named category folder (can't be — these are loose files)
    ops.push({ action: 'mkdir', to: destDir });
    for (const name of files) ops.push({ action: 'move', from: path.join(d, name), to: path.join(destDir, name) });
    lines.push(`  • ${files.length} ${cat} → ${cat}/`);
  }
  if (!ops.length) return { ok: true, error: undefined, ops: [], summary: 'Nothing loose to organize here.' };
  const moveCount = ops.filter((o) => o.action === 'move').length;
  const summary = `Organize ${moveCount} files in ${d} by type:\n${lines.join('\n')}`;
  return { ok: true, ops, summary };
}

// ---- Mutations (guardrailed + journaled) ---------------------------------

function journalPath() {
  const d = path.join(app.getPath('userData'), 'file-agent');
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, 'undo-journal.json');
}
function readJournal(): any[] {
  try { return JSON.parse(fs.readFileSync(journalPath(), 'utf-8')); } catch { return []; }
}
function writeJournal(j: any[]) {
  try { fs.writeFileSync(journalPath(), JSON.stringify(j.slice(-50), null, 2)); } catch { /* */ }
}

function recycle(paths: string[]): Promise<{ ok: boolean; error?: string }> {
  // Send to the Windows Recycle Bin via VB.FileIO (recoverable, never permanent).
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; foreach($p in @(${list})){ if(Test-Path -LiteralPath $p){ if((Get-Item -LiteralPath $p) -is [System.IO.DirectoryInfo]){ [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') } } }`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let err = '';
    ps.stderr.on('data', (d: any) => { err += d; });
    ps.on('close', (code: number) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim() || `exit ${code}` }));
    ps.on('error', (e: any) => resolve({ ok: false, error: e.message }));
  });
}

function moveOne(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // Avoid clobbering: if dest exists, suffix it.
  let dest = to;
  if (fs.existsSync(dest)) {
    const ext = path.extname(to);
    const base = to.slice(0, to.length - ext.length);
    let i = 1;
    while (fs.existsSync(dest)) { dest = `${base} (${i})${ext}`; i++; }
  }
  try { fs.renameSync(from, dest); }
  catch { fs.copyFileSync(from, dest); fs.unlinkSync(from); } // cross-volume
  return dest;
}

/** Execute a validated batch of ops. Returns results and records an undo entry. */
export async function applyOps(ops: FileOp[], label: string): Promise<{ ok: boolean; done: number; failed: { op: FileOp; error: string }[]; undoId?: string }> {
  const done: FileOp[] = [];
  const failed: { op: FileOp; error: string }[] = [];
  const recycleBatch: string[] = [];

  for (const op of ops) {
    try {
      if (op.action === 'mkdir') {
        const cm = canModify(op.to!); if (!cm.ok) throw new Error(cm.reason);
        fs.mkdirSync(op.to!, { recursive: true });
        done.push(op);
      } else if (op.action === 'move' || op.action === 'rename') {
        const a = canModify(op.from!); const b = canModify(op.to!);
        if (!a.ok) throw new Error(`source ${a.reason}`);
        if (!b.ok) throw new Error(`dest ${b.reason}`);
        const dest = moveOne(op.from!, op.to!);
        done.push({ action: 'move', from: op.from, to: dest });
      } else if (op.action === 'recycle') {
        const cm = canModify(op.from!); if (!cm.ok) throw new Error(cm.reason);
        recycleBatch.push(op.from!);
        done.push(op);
      }
    } catch (e: any) {
      failed.push({ op, error: e.message });
    }
  }
  if (recycleBatch.length) {
    const r = await recycle(recycleBatch);
    if (!r.ok) { for (const p of recycleBatch) failed.push({ op: { action: 'recycle', from: p }, error: r.error || 'recycle failed' }); }
  }

  // Journal only reversible ops (moves). Recycled items live in the Recycle Bin.
  const reversible = done.filter((o) => o.action === 'move' && o.from && o.to);
  let undoId: string | undefined;
  if (reversible.length) {
    undoId = crypto.randomUUID();
    const j = readJournal();
    j.push({ id: undoId, ts: Date.now(), label, ops: reversible });
    writeJournal(j);
  }
  logger.warn('fileagent', `Applied "${label}": ${done.length} ok, ${failed.length} failed.`);
  return { ok: failed.length === 0, done: done.length, failed, undoId };
}

/** Reverse the most recent journaled batch (moves back to their origins). */
export function undoLast(): { ok: boolean; reversed: number; label?: string; error?: string } {
  const j = readJournal();
  const batch = j.pop();
  if (!batch) return { ok: false, reversed: 0, error: 'nothing to undo' };
  let reversed = 0;
  const touchedDirs = new Set<string>();
  for (const op of [...batch.ops].reverse()) {
    try {
      if (op.action === 'move' && fs.existsSync(op.to)) { moveOne(op.to, op.from); reversed++; touchedDirs.add(path.dirname(op.to)); }
    } catch { /* best effort */ }
  }
  // Remove category folders we emptied out (only if truly empty + modifiable).
  for (const d of touchedDirs) {
    try { if (canModify(d).ok && fs.readdirSync(d).length === 0) fs.rmdirSync(d); } catch { /* */ }
  }
  writeJournal(j);
  logger.warn('fileagent', `Undo "${batch.label}": reversed ${reversed}/${batch.ops.length}.`);
  return { ok: true, reversed, label: batch.label };
}

// ---- Downloads (quarantined, never executed) -----------------------------

export function downloadDir(): string {
  const d = settings.get().downloadDir || path.join(HOME, 'Downloads', 'DAWN');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function download(url: string, filename?: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }> {
  return new Promise((resolve) => {
    let u: URL;
    try { u = new URL(url); } catch { return resolve({ ok: false, error: 'invalid URL' }); }
    if (!/^https?:$/.test(u.protocol)) return resolve({ ok: false, error: 'only http(s) downloads allowed' });
    const name = (filename || path.basename(u.pathname) || 'download.bin').replace(/[<>:"/\\|?*]/g, '_').slice(0, 180) || 'download.bin';
    let dest = path.join(downloadDir(), name);
    if (fs.existsSync(dest)) { const ext = path.extname(name); const base = dest.slice(0, dest.length - ext.length); let i = 1; while (fs.existsSync(dest)) { dest = `${base} (${i})${ext}`; i++; } }
    logger.warn('fileagent', `Download » ${url} → ${dest}`);

    const req = net.request(url);
    const out = fs.createWriteStream(dest);
    let bytes = 0;
    let settled = false;
    const fail = (error: string) => { if (settled) return; settled = true; try { out.close(); fs.existsSync(dest) && fs.unlinkSync(dest); } catch { /* */ } resolve({ ok: false, error }); };
    req.on('response', (res: any) => {
      if (res.statusCode >= 400) return fail(`HTTP ${res.statusCode}`);
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > 5_000_000_000) { req.abort(); return fail('file too large (>5 GB)'); }
        out.write(c);
      });
      res.on('end', () => { if (settled) return; settled = true; out.end(() => resolve({ ok: true, path: dest, bytes })); });
      res.on('error', (e: any) => fail(e.message));
    });
    req.on('error', (e: any) => fail(e.message));
    req.end();
  });
}

export default {
  HOME, list, scan, find, readText, planOrganize, applyOps, undoLast,
  download, downloadDir, canModify, canRead, isSecretFile, humanBytes,
  resolvePath, knownFoldersText,
};
