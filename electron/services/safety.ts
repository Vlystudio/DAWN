import * as path from 'path';

/**
 * safety.ts — keeps the indexer away from sensitive/system data. The knowledge
 * base only scans folders the user explicitly approves; on top of that these
 * rules block hidden/system locations, secrets, keys, browser profiles, AppData,
 * .env, node_modules, etc. — even inside an approved folder.
 */

const BLOCKED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.cache', '.npm', '__pycache__', 'venv', '.venv', 'env', 'dist', 'build', 'out', '.next',
  'appdata', 'application data', 'local settings', '$recycle.bin', 'system volume information',
  'windows', 'winnt', 'program files', 'program files (x86)', 'programdata',
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.config', '.docker',
  'google', 'chrome', 'chromium', 'mozilla', 'firefox', 'microsoft', 'edge', 'brave-browser', 'opera software',
]);
const BLOCKED_NAMES = new Set(['.env', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials', '.netrc', '.pgpass', 'secrets.json']);
const BLOCKED_EXTS = new Set(['.env', '.pem', '.key', '.pfx', '.p12', '.crt', '.cer', '.gpg', '.pgp', '.ppk', '.keystore', '.jks', '.kdbx', '.1pux']);

export function isBlockedDir(name: string): boolean {
  const l = name.toLowerCase();
  if (l.startsWith('.')) return true;
  return BLOCKED_DIRS.has(l);
}

export function isBlockedFile(file: string, allowed: string[]): boolean {
  const base = path.basename(file).toLowerCase();
  const ext = path.extname(file).toLowerCase();
  if (base.startsWith('.')) return true;
  if (BLOCKED_NAMES.has(base)) return true;
  if (BLOCKED_EXTS.has(ext)) return true;
  if (base.startsWith('.env') || base.includes('.env.')) return true;
  if (/(^|[-_.])(secret|secrets|password|passwords|credential|credentials|apikey|api_key)([-_.]|$)/i.test(base)) return true;
  if (allowed && !allowed.includes(ext)) return true;
  return false;
}

export default { isBlockedDir, isBlockedFile };
