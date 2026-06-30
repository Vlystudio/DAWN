/**
 * auth.ts — DAWN's local single-admin auth + session manager. Owns the admin password
 * (scrypt-hashed), the in-memory session (token + KEK never persisted), app lock/unlock,
 * TOTP 2FA + one-time backup codes, local rate-limiting, the security guards used by
 * sensitive IPC/tools, and the auth audit log. Builds on cryptoCore + the Vault.
 */
import * as crypto from 'crypto';
import db from '../db';
import logger from '../logger';
import settings from '../settings';
import cc, { StoredHash } from './cryptoCore';
import ac, { Session, AuthEvent } from './authCore';
import vault from './vault';

const now = () => Date.now();

// --- in-memory session state (never persisted) -----------------------------
let session: Session | null = null;
let kek: Buffer | null = null;
let lastPasswordVerifyAt = 0;
let failedAttempts = 0;
let lockUntil = 0;
let pendingTotpSecret: string | null = null;

function config(): any { return db.get('SELECT * FROM auth_config WHERE id=?', ['admin']); }
export function hasPassword(): boolean { return !!config()?.password_hash; }

function audit(event: AuthEvent, detail = '', success = true) {
  const ev = ac.shapeAuthAudit(event, detail, success);
  try { db.run('INSERT INTO auth_audit (id,ts,event,detail,success) VALUES (?,?,?,?,?)', [ev.id, ev.ts, ev.event, ev.detail, ev.success]); } catch { /* */ }
}

export function sessionActive(): boolean { return ac.sessionValid(session); }
export function touch() { if (session) session = ac.touchSession(session, settings.get().sessionTimeoutMinutes); }

export function status() {
  const s = settings.get();
  const active = sessionActive();
  return {
    authEnabled: !!s.authEnabled,
    hasPassword: hasPassword(),
    totpEnabled: !!config()?.totp_enabled,
    lanModeEnabled: !!s.lanModeEnabled,
    sessionActive: active,
    locked: !!s.authEnabled && !active,
    sessionExpiresAt: session?.expiresAt || null,
    osSecureStore: vault.health().osProtected,
  };
}

// --- password --------------------------------------------------------------
export function setPassword(password: string): { ok: boolean; error?: string } {
  const strength = cc.passwordStrength(password);
  if (!strength.ok) return { ok: false, error: strength.warnings[0] || 'Password too weak.' };
  vault.ensureInit();
  const stored = cc.hashPassword(password);
  const saltHex = crypto.randomBytes(16).toString('hex');
  const newKek = cc.deriveKey(password, saltHex);
  vault.attachPassword(newKek, saltHex);           // wrap VMK under the password
  const existing = config();
  db.run('INSERT OR REPLACE INTO auth_config (id,password_hash,password_salt,hash_algorithm,hash_params,totp_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ['admin', stored.hash, stored.salt, stored.algorithm, stored.params, existing?.totp_enabled || 0, existing?.created_at || now(), now()]);
  kek = newKek; session = ac.makeSession(settings.get().sessionTimeoutMinutes); lastPasswordVerifyAt = now();
  audit(existing?.password_hash ? 'password_changed' : 'password_set');
  rebuild();
  return { ok: true };
}

export function changePassword(current: string, next: string): { ok: boolean; error?: string } {
  if (!verifyRaw(current)) { audit('password_changed', 'wrong current password', false); return { ok: false, error: 'Current password is incorrect.' }; }
  const strength = cc.passwordStrength(next);
  if (!strength.ok) return { ok: false, error: strength.warnings[0] || 'New password too weak.' };
  // need the VMK unlocked to re-wrap it under the new password
  const curKek = cc.deriveKey(current, vault.pwSalt() || '');
  if (!vault.unlockWithKek(curKek)) { /* may already be unlocked via OS */ }
  const stored = cc.hashPassword(next);
  const saltHex = crypto.randomBytes(16).toString('hex');
  const newKek = cc.deriveKey(next, saltHex);
  vault.rewrapPassword(newKek, saltHex);
  db.run('UPDATE auth_config SET password_hash=?, password_salt=?, hash_algorithm=?, hash_params=?, updated_at=? WHERE id=?',
    [stored.hash, stored.salt, stored.algorithm, stored.params, now(), 'admin']);
  kek = newKek; session = ac.makeSession(settings.get().sessionTimeoutMinutes); lastPasswordVerifyAt = now();
  audit('password_changed');
  return { ok: true };
}

function verifyRaw(password: string): boolean {
  const c = config();
  if (!c?.password_hash) return false;
  const stored: StoredHash = { algorithm: c.hash_algorithm, salt: c.password_salt, hash: c.password_hash, params: c.hash_params };
  return cc.verifyPassword(password, stored);
}

/** Verify the admin password (rate-limited). Updates recent-verify timestamp on success. */
export function verifyPassword(password: string): { ok: boolean; error?: string } {
  if (now() < lockUntil) return { ok: false, error: `Too many attempts — wait ${Math.ceil((lockUntil - now()) / 1000)}s.` };
  if (!verifyRaw(password)) {
    failedAttempts++;
    db.run('INSERT INTO failed_login_attempts (ts,detail) VALUES (?,?)', [now(), 'password']);
    const r = ac.rateLimit(failedAttempts);
    if (r.blocked) lockUntil = now() + r.lockMs;
    audit('login_failure', 'bad password', false);
    return { ok: false, error: 'Incorrect password.' };
  }
  failedAttempts = 0; lockUntil = 0; lastPasswordVerifyAt = now();
  return { ok: true };
}

// --- unlock / lock ---------------------------------------------------------
export function unlock(password: string, code?: string): { ok: boolean; error?: string } {
  if (now() < lockUntil) return { ok: false, error: `Too many attempts — wait ${Math.ceil((lockUntil - now()) / 1000)}s.` };
  if (!verifyRaw(password)) {
    failedAttempts++;
    db.run('INSERT INTO failed_login_attempts (ts,detail) VALUES (?,?)', [now(), 'unlock']);
    const r = ac.rateLimit(failedAttempts); if (r.blocked) lockUntil = now() + r.lockMs;
    audit('login_failure', 'bad password', false);
    return { ok: false, error: 'Incorrect password.' };
  }
  // unlock the vault VMK so we can check TOTP (secret lives in the vault)
  const tryKek = cc.deriveKey(password, vault.pwSalt() || '');
  vault.unlockWithKek(tryKek);
  if (config()?.totp_enabled) {
    if (!code) return { ok: false, error: 'Enter your 2FA code (or a backup code).' };
    if (!verifyTotpOrBackup(code)) {
      failedAttempts++; const r = ac.rateLimit(failedAttempts); if (r.blocked) lockUntil = now() + r.lockMs;
      audit('login_failure', 'bad 2fa', false);
      vault.clearVMK();
      return { ok: false, error: 'Invalid 2FA code.' };
    }
  }
  kek = tryKek; failedAttempts = 0; lockUntil = 0; lastPasswordVerifyAt = now();
  session = ac.makeSession(settings.get().sessionTimeoutMinutes);
  audit('login_success'); audit('unlock');
  return { ok: true };
}

export function lock() {
  session = null; kek = null; vault.clearVMK();
  audit('lock');
  return { ok: true };
}

// --- guards (used by sensitive IPC/tools) ----------------------------------
export function requireUnlockedSession() { ac.requireUnlockedSession(!!settings.get().authEnabled, sessionActive()); }
export function requireSessionForVault() { ac.requireSessionForReveal(!!settings.get().authEnabled, sessionActive()); }
export function requireRecentPasswordVerification(maxMinutes = 5) {
  if (settings.get().authEnabled && now() - lastPasswordVerifyAt > maxMinutes * 60000) throw new Error('Please verify your password again for this action.');
}

/** Change a security-critical setting; requires password verification when auth is enabled. */
export function setSecuritySetting(key: string, value: any, password?: string): { ok: boolean; error?: string } {
  const s = settings.get();
  const allowed = ['authEnabled', 'lanModeEnabled', 'sessionTimeoutMinutes', 'lockOnSleep', 'requireApprovalForHighRiskTools', 'requirePasswordForVaultReveal', 'requirePasswordForSettingsSecurityChanges'];
  if (!allowed.includes(key)) return { ok: false, error: 'Not a security setting.' };
  // enabling auth requires a password to exist
  if (key === 'authEnabled' && value && !hasPassword()) return { ok: false, error: 'Set an admin password before enabling authentication.' };
  // LAN prerequisites
  if (key === 'lanModeEnabled' && value) {
    const pre = ac.lanModeAllowed({ authEnabled: !!s.authEnabled, hasPassword: hasPassword(), totpEnabled: !!config()?.totp_enabled });
    if (!pre.allowed) return { ok: false, error: pre.reasons.join(' ') };
  }
  // password gate when auth enabled
  if (s.authEnabled) {
    if (!password || !verifyRaw(password)) { audit('security_setting_changed', `${key} (denied: bad password)`, false); return { ok: false, error: 'Password verification required.' }; }
  }
  settings.save({ [key]: value } as any);
  if (key === 'lanModeEnabled') audit('lan_mode_changed', String(value));
  else audit('security_setting_changed', `${key}=${value}`);
  rebuild();
  return { ok: true };
}

// --- TOTP + backup codes ---------------------------------------------------
export function setupTotp(): { ok: boolean; error?: string; secret?: string; uri?: string } {
  if (!hasPassword()) return { ok: false, error: 'Set an admin password first.' };
  if (settings.get().authEnabled && !sessionActive()) return { ok: false, error: 'Unlock DAWN first.' };
  pendingTotpSecret = cc.generateTotpSecret();
  return { ok: true, secret: pendingTotpSecret, uri: cc.otpauthUri(pendingTotpSecret, 'admin') };
}
export function confirmTotp(code: string): { ok: boolean; error?: string; backupCodes?: string[] } {
  if (!pendingTotpSecret) return { ok: false, error: 'Start TOTP setup first.' };
  if (!cc.verifyTotp(pendingTotpSecret, code)) return { ok: false, error: 'That code did not match — try again.' };
  vault.setTotpSecret(pendingTotpSecret);
  pendingTotpSecret = null;
  db.run('UPDATE auth_config SET totp_enabled=1, updated_at=? WHERE id=?', [now(), 'admin']);
  settings.save({ totpEnabled: true });
  const codes = newBackupCodes();
  audit('totp_enabled');
  rebuild();
  return { ok: true, backupCodes: codes };
}
export function disableTotp(password: string): { ok: boolean; error?: string } {
  if (!verifyRaw(password)) return { ok: false, error: 'Incorrect password.' };
  vault.removeTotpSecret();
  db.run('UPDATE auth_config SET totp_enabled=0, updated_at=? WHERE id=?', [now(), 'admin']);
  db.run('DELETE FROM totp_backup_codes');
  settings.save({ totpEnabled: false });
  audit('totp_disabled');
  rebuild();
  return { ok: true };
}
export function regenerateBackupCodes(password: string): { ok: boolean; error?: string; backupCodes?: string[] } {
  if (!verifyRaw(password)) return { ok: false, error: 'Incorrect password.' };
  const codes = newBackupCodes();
  audit('backup_codes_regenerated');
  return { ok: true, backupCodes: codes };
}
function newBackupCodes(): string[] {
  db.run('DELETE FROM totp_backup_codes');
  const codes = cc.generateBackupCodes(10);
  for (const code of codes) db.run('INSERT INTO totp_backup_codes (id,code_hash,used,created_at) VALUES (?,?,0,?)', [crypto.randomUUID(), cc.hashBackupCode(code), now()]);
  return codes;
}
function verifyTotpOrBackup(code: string): boolean {
  const c = String(code || '').replace(/\s/g, '');
  if (/^\d{6}$/.test(c)) {
    const secret = vault.getTotpSecret();
    return !!secret && cc.verifyTotp(secret, c);
  }
  // backup code (single-use)
  const hash = cc.hashBackupCode(c);
  const row: any = db.get('SELECT * FROM totp_backup_codes WHERE code_hash=? AND used=0', [hash]);
  if (!row) return false;
  db.run('UPDATE totp_backup_codes SET used=1, used_at=? WHERE id=?', [now(), row.id]);
  audit('backup_code_used');
  return true;
}
export function backupCodesRemaining(): number {
  return (db.get('SELECT COUNT(*) AS n FROM totp_backup_codes WHERE used=0') as any)?.n || 0;
}

export function recentAudit(limit = 100) { return db.all('SELECT * FROM auth_audit ORDER BY ts DESC LIMIT ?', [Math.min(300, limit)]); }
/** Public audit hook for security actions performed elsewhere (e.g. vault IPC). Detail must never contain secrets. */
export function auditSecurityAction(event: AuthEvent, detail = '', success = true) { audit(event, detail, success); }
export function lanStatus() {
  const s = settings.get();
  const pre = ac.lanModeAllowed({ authEnabled: !!s.authEnabled, hasPassword: hasPassword(), totpEnabled: !!config()?.totp_enabled });
  return { enabled: !!s.lanModeEnabled, serverImplemented: false, bind: '127.0.0.1', prerequisites: pre, note: 'LAN server not implemented yet; security prerequisites are ready. DAWN is not exposed on the network.' };
}

function rebuild() { try { require('../graph').default.rebuild(); } catch { /* */ } }

export default {
  status, hasPassword, sessionActive, touch, setPassword, changePassword, verifyPassword, unlock, lock,
  requireUnlockedSession, requireSessionForVault, requireRecentPasswordVerification, setSecuritySetting,
  setupTotp, confirmTotp, disableTotp, regenerateBackupCodes, backupCodesRemaining, recentAudit, lanStatus, auditSecurityAction,
};
