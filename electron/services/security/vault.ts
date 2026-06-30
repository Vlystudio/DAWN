/**
 * vault.ts — DAWN's local encrypted secret store.
 *
 * Each secret is encrypted with AES-256-GCM under a 32-byte Vault Master Key (VMK). The VMK
 * is NEVER stored in plaintext: it is wrapped by the OS keychain (Electron safeStorage →
 * Windows DPAPI, tied to the OS user) so the vault works in local-desktop mode, and ALSO
 * wrapped by an admin-password-derived key (when a password is set) so it works in secure/LAN
 * mode and survives across machines. Secrets are never logged, never put into model prompts,
 * and always redacted in IPC/audit. Reveal requires an unlocked session when auth is enabled.
 */
import * as crypto from 'crypto';
import { safeStorage } from 'electron';
import db from '../db';
import logger from '../logger';
import settings from '../settings';
import cc from './cryptoCore';
import ac from './authCore';

const newId = () => crypto.randomUUID();
const now = () => Date.now();
const KEY_ID = 'vault';

let VMK: Buffer | null = null; // in-memory only

function meta(): any { return db.get('SELECT * FROM vault_key_metadata WHERE id=?', [KEY_ID]); }
function osAvailable(): boolean { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } }

function osWrap(vmk: Buffer): string | null {
  if (!osAvailable()) return null;
  try { return safeStorage.encryptString(vmk.toString('base64')).toString('base64'); } catch { return null; }
}
function osUnwrap(osWrapped: string): Buffer {
  const buf = safeStorage.decryptString(Buffer.from(osWrapped, 'base64'));
  return Buffer.from(buf, 'base64');
}

/** Initialize the vault key on first use (generate VMK, wrap with the OS keychain). */
export function ensureInit(): { ok: boolean; error?: string } {
  if (meta()) return { ok: true };
  if (!osAvailable() && !db.get('SELECT id FROM auth_config WHERE password_hash IS NOT NULL')) {
    return { ok: false, error: 'The OS secure store is unavailable. Set an admin password to use the Vault.' };
  }
  const vmk = cc.randomKey(32);
  const os_wrapped = osWrap(vmk);
  db.run('INSERT OR REPLACE INTO vault_key_metadata (id,os_wrapped,pw_wrapped,pw_salt,kdf_params,algorithm,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [KEY_ID, os_wrapped, null, null, JSON.stringify(cc.SCRYPT), 'aes-256-gcm', now(), now()]);
  VMK = vmk;
  return { ok: true };
}

/** Wrap the VMK with an admin-password-derived key (auth derives the KEK + owns the salt). */
export function attachPassword(kek: Buffer, saltHex: string): boolean {
  ensureInit();
  const pw_wrapped = cc.encryptGCM(kek, getVMK().toString('base64'));
  db.run('UPDATE vault_key_metadata SET pw_wrapped=?, pw_salt=?, updated_at=? WHERE id=?', [pw_wrapped, saltHex, now(), KEY_ID]);
  return true;
}
export function pwSalt(): string | null { return meta()?.pw_salt || null; }

/** Re-wrap the VMK with a new password-derived key (change-password / attach). */
export function rewrapPassword(kek: Buffer, saltHex: string): boolean {
  const vmk = getVMK();
  const pw_wrapped = cc.encryptGCM(kek, vmk.toString('base64'));
  db.run('UPDATE vault_key_metadata SET pw_wrapped=?, pw_salt=?, updated_at=? WHERE id=?', [pw_wrapped, saltHex, now(), KEY_ID]);
  return true;
}

/** Unlock the in-memory VMK using a password-derived key (called by auth.unlock). */
export function unlockWithKek(kek: Buffer): boolean {
  const m = meta();
  if (!m?.pw_wrapped) return false;
  try { VMK = Buffer.from(cc.decryptGCM(kek, m.pw_wrapped), 'base64'); return true; } catch { return false; }
}
export function clearVMK() { VMK = null; }

/** Get the VMK: in-memory, else (local-desktop mode only) via the OS keychain. */
function getVMK(): Buffer {
  if (VMK) return VMK;
  ensureInit();
  if (VMK) return VMK;
  const m = meta();
  if (!settings.get().authEnabled && m?.os_wrapped) {
    VMK = osUnwrap(m.os_wrapped);
    return VMK;
  }
  throw new Error('Vault is locked — unlock DAWN to access secrets.');
}

// --- items -----------------------------------------------------------------
export function list() {
  return db.all('SELECT * FROM vault_items ORDER BY updated_at DESC').map(ac.vaultPublicView);
}
export function health() {
  const m = meta();
  return { initialized: !!m, osProtected: !!m?.os_wrapped, passwordProtected: !!m?.pw_wrapped, locked: isLocked(), itemCount: (db.get('SELECT COUNT(*) AS n FROM vault_items') as any)?.n || 0, algorithm: 'aes-256-gcm' };
}
export function isLocked(): boolean {
  if (VMK) return false;
  if (!settings.get().authEnabled && meta()?.os_wrapped) return false; // OS-unwrap available
  return true;
}

export function create(opts: { label: string; kind?: string; username?: string; secret: string; metadata?: any; tags?: string; rotationReminderAt?: number }) {
  const vmk = getVMK();
  const id = newId();
  const secret_enc = cc.encryptGCM(vmk, String(opts.secret || ''));
  const metadata_enc = opts.metadata ? cc.encryptGCM(vmk, JSON.stringify(opts.metadata)) : null;
  db.run('INSERT INTO vault_items (id,label,kind,username,secret_enc,metadata_enc,tags,created_at,updated_at,rotation_reminder_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, opts.label || 'Secret', opts.kind || 'custom', opts.username || '', secret_enc, metadata_enc, opts.tags || '', now(), now(), opts.rotationReminderAt || null]);
  rebuild();
  return ac.vaultPublicView(db.get('SELECT * FROM vault_items WHERE id=?', [id]));
}
export function update(id: string, patch: { label?: string; username?: string; secret?: string; tags?: string; rotationReminderAt?: number }) {
  const row: any = db.get('SELECT * FROM vault_items WHERE id=?', [id]);
  if (!row) return null;
  let secret_enc = row.secret_enc;
  if (patch.secret !== undefined) secret_enc = cc.encryptGCM(getVMK(), String(patch.secret));
  const f = (k: string, col = k) => (patch[k as keyof typeof patch] !== undefined ? (patch as any)[k] : row[col]);
  db.run('UPDATE vault_items SET label=?, username=?, secret_enc=?, tags=?, rotation_reminder_at=?, updated_at=? WHERE id=?',
    [f('label'), f('username'), secret_enc, f('tags'), patch.rotationReminderAt !== undefined ? patch.rotationReminderAt : row.rotation_reminder_at, now(), id]);
  rebuild();
  return ac.vaultPublicView(db.get('SELECT * FROM vault_items WHERE id=?', [id]));
}
export function remove(id: string) { db.run('DELETE FROM vault_items WHERE id=?', [id]); rebuild(); return true; }

/** Reveal a secret value. Enforces an unlocked session when auth is enabled (defense-in-depth). */
export function reveal(id: string): { ok: boolean; error?: string; secret?: string; username?: string } {
  const s = settings.get();
  try { ac.requireSessionForReveal(s.authEnabled, !isLocked() && sessionActive()); } catch (e: any) { return { ok: false, error: e.message }; }
  const row: any = db.get('SELECT * FROM vault_items WHERE id=?', [id]);
  if (!row) return { ok: false, error: 'Not found.' };
  try {
    const secret = cc.decryptGCM(getVMK(), row.secret_enc);
    db.run('UPDATE vault_items SET last_accessed_at=? WHERE id=?', [now(), id]);
    return { ok: true, secret, username: row.username };
  } catch (e: any) { return { ok: false, error: 'Could not decrypt (vault locked?).' }; }
}

function sessionActive(): boolean { try { return require('./auth').default.sessionActive(); } catch { return false; } }

/** Rotate the master key: re-encrypt every item under a fresh VMK, then re-wrap. */
export function rotateMasterKey(kek?: Buffer, saltHex?: string): { ok: boolean; error?: string } {
  try {
    const oldVmk = getVMK();
    const newVmk = cc.randomKey(32);
    for (const row of db.all('SELECT * FROM vault_items') as any[]) {
      const plain = cc.decryptGCM(oldVmk, row.secret_enc);
      db.run('UPDATE vault_items SET secret_enc=?, updated_at=? WHERE id=?', [cc.encryptGCM(newVmk, plain), now(), row.id]);
    }
    VMK = newVmk;
    const os_wrapped = osWrap(newVmk);
    const pw_wrapped = kek ? cc.encryptGCM(kek, newVmk.toString('base64')) : meta()?.pw_wrapped || null;
    db.run('UPDATE vault_key_metadata SET os_wrapped=?, pw_wrapped=?, pw_salt=?, updated_at=? WHERE id=?',
      [os_wrapped, pw_wrapped, saltHex || meta()?.pw_salt || null, now(), KEY_ID]);
    logger.info('vault', 'Master key rotated; all items re-encrypted.');
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// --- TOTP secret (stored as a vault item) ----------------------------------
const TOTP_ID = 'totp-secret';
export function setTotpSecret(secretBase32: string) {
  const vmk = getVMK();
  const enc = cc.encryptGCM(vmk, secretBase32);
  db.run('INSERT OR REPLACE INTO vault_items (id,label,kind,username,secret_enc,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [TOTP_ID, 'TOTP 2FA secret', 'totp_secret', '', enc, 'system', now(), now()]);
}
export function getTotpSecret(): string | null {
  const row: any = db.get('SELECT * FROM vault_items WHERE id=?', [TOTP_ID]);
  if (!row) return null;
  try { return cc.decryptGCM(getVMK(), row.secret_enc); } catch { return null; }
}
export function removeTotpSecret() { db.run('DELETE FROM vault_items WHERE id=?', [TOTP_ID]); }

function rebuild() { try { require('../graph').default.rebuild(); } catch { /* */ } }

export default {
  ensureInit, attachPassword, pwSalt, rewrapPassword, unlockWithKek, clearVMK, isLocked,
  list, health, create, update, remove, reveal, rotateMasterKey, setTotpSecret, getTotpSecret, removeTotpSecret,
};
