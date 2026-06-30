/**
 * authCore.ts — pure (electron-free) decision logic for DAWN's auth/session/vault layer:
 * session validity, the permission/lock guards, vault "public view" (strips secrets),
 * local rate-limiting, LAN-mode prerequisite checks, and audit-event shaping. Kept separate
 * from the electron services so it can be unit-tested without a DB or OS keychain.
 */
import * as crypto from 'crypto';

export interface Session { token: string; createdAt: number; expiresAt: number }

export function makeSession(timeoutMinutes: number, now = Date.now()): Session {
  const mins = Math.max(1, timeoutMinutes || 30);
  return { token: crypto.randomBytes(24).toString('hex'), createdAt: now, expiresAt: now + mins * 60000 };
}
export function sessionValid(s: Session | null, now = Date.now()): boolean {
  return !!s && typeof s.expiresAt === 'number' && s.expiresAt > now;
}
export function touchSession(s: Session, timeoutMinutes: number, now = Date.now()): Session {
  return { ...s, expiresAt: now + Math.max(1, timeoutMinutes || 30) * 60000 };
}

// --- guards (throw on violation) -------------------------------------------
export function requireUnlockedSession(authEnabled: boolean, sessionActive: boolean): void {
  if (authEnabled && !sessionActive) throw new Error('DAWN is locked — unlock to continue.');
}
export function requireSessionForReveal(authEnabled: boolean, sessionActive: boolean): void {
  if (authEnabled && !sessionActive) throw new Error('DAWN is locked — unlock to reveal secrets.');
}
export function requirePasswordForSecurityChange(authEnabled: boolean, passwordValid: boolean): void {
  if (authEnabled && !passwordValid) throw new Error('Password verification is required for this security change.');
}

// --- vault public view (never includes the secret) -------------------------
export interface VaultRow { id: string; label: string; kind: string; username?: string; secret_enc?: string; metadata_enc?: string; tags?: string; created_at?: number; updated_at?: number; last_accessed_at?: number; rotation_reminder_at?: number }
export function vaultPublicView(item: VaultRow) {
  return {
    id: item.id, label: item.label, kind: item.kind, username: item.username || '',
    tags: item.tags || '', createdAt: item.created_at, updatedAt: item.updated_at,
    lastAccessedAt: item.last_accessed_at, rotationReminderAt: item.rotation_reminder_at,
    hasSecret: !!item.secret_enc,
  };
}

// --- rate limiting (local, escalating lockout) -----------------------------
export interface RateState { blocked: boolean; lockMs: number }
export function rateLimit(failedAttempts: number, maxAttempts = 5): RateState {
  if (failedAttempts < maxAttempts) return { blocked: false, lockMs: 0 };
  const over = failedAttempts - maxAttempts;
  return { blocked: true, lockMs: Math.min(300000, 30000 * (over + 1)) }; // 30s → cap 5min
}

// --- LAN mode prerequisites ------------------------------------------------
export interface LanPrereq { allowed: boolean; reasons: string[]; warnings: string[] }
export function lanModeAllowed(opts: { authEnabled: boolean; hasPassword: boolean; totpEnabled: boolean }): LanPrereq {
  const reasons: string[] = []; const warnings: string[] = [];
  if (!opts.hasPassword) reasons.push('Set an admin password first.');
  if (!opts.authEnabled) reasons.push('Enable authentication (Secure mode) first.');
  if (!opts.totpEnabled) warnings.push('TOTP 2FA is strongly recommended before exposing DAWN on a LAN.');
  return { allowed: reasons.length === 0, reasons, warnings };
}

// --- audit-event shaping (pure) --------------------------------------------
export type AuthEvent = 'login_success' | 'login_failure' | 'lock' | 'unlock' | 'session_expired' | 'password_changed' | 'password_set' | 'totp_enabled' | 'totp_disabled' | 'backup_code_used' | 'backup_codes_regenerated' | 'vault_create' | 'vault_update' | 'vault_delete' | 'vault_reveal' | 'security_setting_changed' | 'lan_mode_changed';
export interface AuthAudit { id: string; ts: number; event: AuthEvent; detail: string; success: number }
export function shapeAuthAudit(event: AuthEvent, detail = '', success = true): AuthAudit {
  // Never include secret values; callers pass labels/ids only.
  return { id: crypto.randomUUID(), ts: Date.now(), event, detail: String(detail).slice(0, 200), success: success ? 1 : 0 };
}

export default {
  makeSession, sessionValid, touchSession, requireUnlockedSession, requireSessionForReveal,
  requirePasswordForSecurityChange, vaultPublicView, rateLimit, lanModeAllowed, shapeAuthAudit,
};
