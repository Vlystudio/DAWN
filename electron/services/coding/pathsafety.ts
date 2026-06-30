/**
 * coding/pathsafety.ts — pure, electron-free path & content safety for the Coding Agent.
 *
 * The coding boundary is the SELECTED WORKSPACE ROOT. Edits are confined to it, and even
 * inside it certain files/folders are off-limits (secrets, keys, .git, node_modules, OS/
 * credential areas). Everything here is lexical/deterministic and fails closed; the engine
 * (coding.ts) adds a real symlink/realpath check on top with fs.
 *
 * No model output, README, or doc can widen these rules — they are code, not data.
 */
import * as path from 'path';

// Path segments that are off-limits for EDITS anywhere they appear (incl. inside a repo).
export const PROTECTED_SEGMENTS = new Set([
  'windows', 'winnt', 'program files', 'program files (x86)', 'programdata',
  '$recycle.bin', 'system volume information', 'recovery', 'boot', 'perflogs',
  '.ssh', '.aws', '.gnupg', '.gpg', '.kube', '.docker', 'node_modules', '.git',
  '.hg', '.svn',
]);

// Lowercased path fragments protected for read+write (credential stores / browser profiles).
export const PROTECTED_FRAGMENTS = [
  'appdata\\local\\google\\chrome\\user data',
  'appdata\\local\\microsoft\\edge\\user data',
  'appdata\\roaming\\mozilla\\firefox\\profiles',
  'appdata\\local\\bravesoftware',
  'appdata\\roaming\\dawn',
  '\\.config\\google-chrome',
];

// Files whose contents are secrets — never editable, never read into the model.
export const SECRET_FILE_RE = [
  /(^|[\\/])id_rsa/i, /(^|[\\/])id_ed25519/i, /(^|[\\/])id_ecdsa/i, /(^|[\\/])id_dsa/i,
  /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i, /\.ppk$/i, /\.keystore$/i, /\.jks$/i,
  /\.kdbx$/i, /(^|[\\/])\.env(\.|$)/i, /(^|[\\/])\.npmrc$/i, /(^|[\\/])\.pypirc$/i,
  /(^|[\\/])\.netrc$/i, /secrets?\.(json|ya?ml|txt)$/i, /credentials(\.json)?$/i,
];

function lc(p: string): string { return p.replace(/\//g, '\\').toLowerCase(); }
function segs(p: string): string[] { return lc(p).split('\\').filter(Boolean); }

export function isSecretFile(p: string): boolean {
  return SECRET_FILE_RE.some((re) => re.test(p));
}

/** Off-limits for editing (protected OS/credential/VCS area or a secret file). */
export function protectedReason(fullPath: string): string | null {
  const s = segs(fullPath);
  const hit = s.find((seg) => PROTECTED_SEGMENTS.has(seg));
  if (hit) return `protected path segment '${hit}'`;
  const l = lc(fullPath);
  const frag = PROTECTED_FRAGMENTS.find((f) => l.includes(f));
  if (frag) return `protected location '${frag}'`;
  if (isSecretFile(fullPath)) return 'secret/key file';
  return null;
}

export interface Resolved { ok: boolean; full?: string; rel?: string; reason?: string; }

/**
 * Resolve a (relative or absolute) target against the workspace root and prove it stays
 * inside, with no traversal and not a protected/secret file. LEXICAL only — caller adds the
 * realpath/symlink check. Absolute paths must already be inside the root.
 */
export function resolveInWorkspace(workspaceRoot: string, target: string): Resolved {
  const root = path.resolve(workspaceRoot);
  const t = String(target || '').trim();
  if (!t) return { ok: false, reason: 'empty path' };
  if (t.includes('\0')) return { ok: false, reason: 'null byte in path' };
  // A unified-diff/edit target should be relative; allow absolute only if inside the root.
  const full = path.resolve(root, t);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(rootWithSep)) {
    return { ok: false, reason: `path escapes the workspace (${t})` };
  }
  if (full === root) return { ok: false, reason: 'cannot target the workspace root itself' };
  const pr = protectedReason(full);
  if (pr) return { ok: false, reason: pr };
  const rel = path.relative(root, full).replace(/\\/g, '/');
  return { ok: true, full, rel };
}

/** Heuristic binary check on the first bytes of a file. */
export function looksBinary(sample: Uint8Array | Buffer): boolean {
  if (!sample || sample.length === 0) return false;
  let nonText = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) return true;                       // NUL → definitely binary
    if (b === 9 || b === 10 || b === 13) continue;  // tab/LF/CR
    if (b < 32 || b === 127) nonText++;             // other control chars
  }
  return nonText / sample.length > 0.10;
}

export const MAX_EDIT_FILE_BYTES = 2_000_000;       // 2 MB per file
export const EDITABLE_EXT_DENY = /\.(exe|dll|so|dylib|bin|png|jpe?g|gif|webp|ico|pdf|zip|gz|7z|rar|mp[34]|mov|woff2?|ttf|class|o|a|lib|wasm)$/i;

/** Is this a file we're willing to write/edit as text? */
export function isEditableText(fullPath: string): { ok: boolean; reason?: string } {
  if (EDITABLE_EXT_DENY.test(fullPath)) return { ok: false, reason: 'binary/media file type is not editable as text' };
  return { ok: true };
}
