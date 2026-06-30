/**
 * credentialFloor.ts — the ONE safety floor that holds even in Full Power mode.
 *
 * Full Power lets DAWN run any command, install anything, and edit files anywhere — but it
 * must NEVER silently read or modify your credentials/secrets, so that a hijacked prompt
 * (from a web page / doc / repo the model reads) can't quietly exfiltrate your keys. This
 * module is pure (no electron) and deterministic so it can be unit-tested and reused by the
 * file agent + chat tools. Fails closed.
 */

// Secret files: contents must never be read into the model and never modified.
const SECRET_FILE_RE: RegExp[] = [
  /(^|[\\/])id_rsa/i, /(^|[\\/])id_ed25519/i, /(^|[\\/])id_ecdsa/i, /(^|[\\/])id_dsa/i,
  /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i, /\.ppk$/i, /\.keystore$/i, /\.jks$/i, /\.kdbx$/i,
  /(^|[\\/])\.env(\.|$)/i, /(^|[\\/])\.npmrc$/i, /(^|[\\/])\.pypirc$/i, /(^|[\\/])\.netrc$/i,
  /(^|[\\/])\.git-credentials$/i, /secrets?\.(json|ya?ml|txt)$/i, /credentials(\.json)?$/i,
  /(^|[\\/])wallet\.dat$/i,
];

// Credential / browser-profile / key directories: never read or modified.
const CRED_FRAGMENTS = [
  'appdata\\local\\google\\chrome\\user data',
  'appdata\\local\\microsoft\\edge\\user data',
  'appdata\\roaming\\mozilla\\firefox\\profiles',
  'appdata\\local\\bravesoftware',
  'appdata\\roaming\\dawn',
  '\\.config\\google-chrome',
  '\\.mozilla\\firefox',
];
const CRED_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.gpg', '.azure', '.kube']);

function lc(p: string): string { return String(p || '').replace(/\//g, '\\').toLowerCase(); }

export function isSecretFile(p: string): boolean {
  return SECRET_FILE_RE.some((re) => re.test(String(p || '')));
}

/** Returns a reason if this path is a credential/secret that the floor protects, else null. */
export function credentialFloorReason(p: string): string | null {
  if (!p) return null;
  if (isSecretFile(p)) return 'secret/key file (protected even in Full Power mode)';
  const l = lc(p);
  if (CRED_FRAGMENTS.some((f) => l.includes(f))) return 'credential/browser-profile area (protected even in Full Power mode)';
  if (l.split('\\').some((s) => CRED_SEGMENTS.has(s))) return 'credential directory (protected even in Full Power mode)';
  return null;
}

export function isCredentialPath(p: string): boolean { return credentialFloorReason(p) !== null; }

// Heuristic: does a raw command/text reference credentials/secrets? Used to force a fresh
// (never session-cached) approval for credential-touching shell commands in Full Power mode,
// so secret access is never silent. Over-flagging is fine — it just means "ask again".
const CRED_MENTION_RE = /(\.ssh\b|id_rsa|id_ed25519|id_ecdsa|\.env\b|\.aws\b|\.gnupg|\.azure\b|\.kube\b|credentials?\b|\.npmrc\b|\.pypirc\b|\.git-credentials|\bnetrc\b|private[\s_-]?key|api[_-]?key|access[_-]?token|auth[_-]?token|\.pem\b|\.key\b|\.pfx\b|\.p12\b|\.kdbx\b|user\s*data|firefox.*profiles|wallet\.dat|password|passwd|secret)/i;
export function mentionsCredentials(text: string): boolean { return CRED_MENTION_RE.test(String(text || '')); }
