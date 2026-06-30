/**
 * knowledgeGuardCore.ts — pure, electron-free safety gate for Local Knowledge indexing. It decides
 * whether a directory/file may be indexed and, crucially, WHY it was skipped (so the UI can be honest
 * about what DAWN refuses to touch). A superset of services/safety.ts with structured reasons + a
 * size limit + an indexable-type allowlist. No filesystem, no I/O — fully unit-tested.
 *
 * Never indexes: secrets/keys/.env, vault/auth/audit DBs, browser profiles, password managers, VCS,
 * caches, node_modules, system folders. No whole-disk scan (folders are opt-in elsewhere).
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Directories that are never descended into (case-insensitive). */
export const PROTECTED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.cache', '.npm', '__pycache__', 'venv', '.venv', 'env',
  'dist', 'build', 'out', '.next', '.idea', '.vscode', 'target', 'bin', 'obj',
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker',
  'appdata', 'localappdata', 'library', 'system volume information', '$recycle.bin', 'windows', 'system32',
  'cookies', 'cache', 'caches', 'code cache', 'gpucache', 'service worker', 'indexeddb', 'local storage',
]);

/** Exact file names that are credentials/secrets/secret-stores. */
export const SECRET_NAMES = new Set([
  '.env', '.netrc', '.pgpass', 'credentials', 'secrets.json', 'secrets.yaml', 'secrets.yml',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'authorized_keys', 'known_hosts',
  'login data', 'cookies', 'web data', 'key3.db', 'key4.db', 'logins.json', 'signons.sqlite',
  'dawn.db', 'settings.json', // DAWN's own DB/settings (vault/auth/audit + config) — never index
]);

/** Extensions that are keys / certs / encrypted stores / password managers. */
export const SECRET_EXTS = new Set([
  '.pem', '.key', '.pfx', '.p12', '.crt', '.cer', '.der', '.gpg', '.pgp', '.asc', '.ppk',
  '.keystore', '.jks', '.kdbx', '.kdb', '.1pux', '.1pif', '.agilekeychain', '.opvault', '.ovpn',
]);

/** Text-ish files DAWN can actually extract + index (others are skipped as unsupported). */
export const INDEXABLE_EXTS = new Set([
  '.txt', '.md', '.markdown', '.mdx', '.rst', '.text', '.log',
  '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.html', '.htm', '.xml',
  '.pdf', '.docx', '.rtf', '.odt',
  '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.sql',
]);

function baseName(p: string): string { return String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''; }
function extOf(name: string): string { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i).toLowerCase() : ''; }

/** Should a directory be skipped? Returns the reason if so. */
export function classifyDir(name: string): { blocked: boolean; reason?: string } {
  const l = String(name || '').toLowerCase();
  if (!l || l.startsWith('.') && PROTECTED_DIRS.has(l)) return { blocked: true, reason: 'protected/hidden directory' };
  if (PROTECTED_DIRS.has(l)) return { blocked: true, reason: 'protected directory (caches/VCS/system/secret store)' };
  return { blocked: false };
}

export interface FileVerdict { index: boolean; reason?: string }

/** Decide whether a file may be indexed; `reason` explains a skip in plain language. */
export function classifyFile(filePath: string, sizeBytes?: number, maxBytes: number = MAX_FILE_BYTES): FileVerdict {
  const base = baseName(filePath).toLowerCase();
  const ext = extOf(base);

  if (base.startsWith('.env') || base.includes('.env.')) return { index: false, reason: 'environment/secret file (.env)' };
  if (SECRET_NAMES.has(base)) return { index: false, reason: 'credential/secret/vault/auth file' };
  if (SECRET_EXTS.has(ext)) return { index: false, reason: 'private key / certificate / password store' };
  if (/(^|[._-])(secret|secrets|credential|credentials|password|passwd|token|apikey|api_key)([._-]|$)/i.test(base)) return { index: false, reason: 'name looks like a secret' };
  if (typeof sizeBytes === 'number' && sizeBytes > maxBytes) return { index: false, reason: `too large (${(sizeBytes / 1048576).toFixed(1)} MB > ${(maxBytes / 1048576).toFixed(0)} MB limit)` };
  if (ext && !INDEXABLE_EXTS.has(ext)) return { index: false, reason: `unsupported file type (${ext})` };
  if (!ext) return { index: false, reason: 'no file extension (unsupported)' };
  return { index: true };
}

export default { MAX_FILE_BYTES, PROTECTED_DIRS, SECRET_NAMES, SECRET_EXTS, INDEXABLE_EXTS, classifyDir, classifyFile };
