/**
 * cryptoCore.ts — pure cryptography for DAWN's Vault/Auth (Node crypto only, no electron,
 * no dependencies). Password hashing (scrypt), authenticated encryption (AES-256-GCM),
 * RFC-6238 TOTP, backup codes, base32, and password-strength checks. Carefully written and
 * unit-tested (incl. an RFC-6238 vector) so the homegrown bits are verifiable, not fragile.
 */
import * as crypto from 'crypto';

// --- password hashing (scrypt) ---------------------------------------------
export interface ScryptParams { N: number; r: number; p: number; keylen: number }
export const SCRYPT: ScryptParams = { N: 16384, r: 8, p: 1, keylen: 32 };
const MAXMEM = 64 * 1024 * 1024;

export interface StoredHash { algorithm: string; salt: string; hash: string; params: string }

export function hashPassword(password: string, params: ScryptParams = SCRYPT): StoredHash {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM });
  return { algorithm: 'scrypt', salt: salt.toString('hex'), hash: hash.toString('hex'), params: JSON.stringify(params) };
}

export function verifyPassword(password: string, stored: StoredHash): boolean {
  try {
    const params: ScryptParams = JSON.parse(stored.params);
    const expected = Buffer.from(stored.hash, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(stored.salt, 'hex'), expected.length, { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

/** Derive a 32-byte key from a password + salt (for wrapping the vault master key). */
export function deriveKey(password: string, saltHex: string, params: ScryptParams = SCRYPT): Buffer {
  return crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32, { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM });
}

// --- AES-256-GCM (authenticated encryption) --------------------------------
/** Encrypt a UTF-8 string with a 32-byte key. Output: "v1:iv:ct:tag" (base64), unique IV each call. */
export function encryptGCM(key: Buffer, plaintext: string): string {
  if (key.length !== 32) throw new Error('key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), ct.toString('base64'), c.getAuthTag().toString('base64')].join(':');
}
export function decryptGCM(key: Buffer, payload: string): string {
  const [v, ivb, ctb, tagb] = String(payload).split(':');
  if (v !== 'v1') throw new Error('unsupported ciphertext');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivb, 'base64'));
  d.setAuthTag(Buffer.from(tagb, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ctb, 'base64')), d.final()]).toString('utf8');
}
/** Extract the IV from a "v1:iv:ct:tag" payload (for uniqueness checks/tests). */
export function ivOf(payload: string): string { return String(payload).split(':')[1] || ''; }

export function randomKey(bytes = 32): Buffer { return crypto.randomBytes(bytes); }

// --- password strength -----------------------------------------------------
const COMMON = new Set(['password', '123456', '12345678', '123456789', 'qwerty', 'letmein', 'admin', 'dawn', '111111', 'password1', 'iloveyou', 'welcome', 'monkey', 'abc123', 'changeme']);
export interface Strength { ok: boolean; strong: boolean; score: number; warnings: string[] }
export function passwordStrength(pw: string): Strength {
  const warnings: string[] = [];
  let score = 0;
  const p = String(pw || '');
  if (p.length >= 12) score += 2; else if (p.length >= 8) score += 1; else warnings.push('Use at least 12 characters (8 minimum).');
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1; else warnings.push('Mix upper- and lower-case letters.');
  if (/\d/.test(p)) score += 1; else warnings.push('Add a number.');
  if (/[^A-Za-z0-9]/.test(p)) score += 1; else warnings.push('Add a symbol.');
  const common = COMMON.has(p.toLowerCase());
  if (common) { warnings.push('This is a very common password — choose something unique.'); score = 0; }
  const ok = p.length >= 8 && !common && score >= 2;       // blocked when very weak
  const strong = p.length >= 12 && score >= 4 && !common;
  return { ok, strong, score, warnings };
}

// --- base32 (RFC 4648, no padding) -----------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = String(s).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// --- TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30s) -----------------------------
export function generateTotpSecret(bytes = 20): string { return base32Encode(crypto.randomBytes(bytes)); }

function hotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}
export function totpCode(secretBase32: string, timeMs: number = Date.now(), step = 30): string {
  return hotp(secretBase32, Math.floor(timeMs / 1000 / step));
}
export function verifyTotp(secretBase32: string, code: string, timeMs: number = Date.now(), window = 1): boolean {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const counter = Math.floor(timeMs / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    const cand = hotp(secretBase32, counter + i);
    if (cand.length === c.length && crypto.timingSafeEqual(Buffer.from(cand), Buffer.from(c))) return true;
  }
  return false;
}
export function otpauthUri(secret: string, label: string, issuer = 'DAWN'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// --- backup codes ----------------------------------------------------------
export function generateBackupCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const raw = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
export function normalizeBackupCode(code: string): string { return String(code || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
export function hashBackupCode(code: string): string { return crypto.createHash('sha256').update(normalizeBackupCode(code)).digest('hex'); }

export default {
  SCRYPT, hashPassword, verifyPassword, deriveKey, encryptGCM, decryptGCM, ivOf, randomKey,
  passwordStrength, base32Encode, base32Decode, generateTotpSecret, totpCode, verifyTotp, otpauthUri,
  generateBackupCodes, normalizeBackupCode, hashBackupCode,
};
