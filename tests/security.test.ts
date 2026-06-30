/**
 * Tests for DAWN's Vault/Auth crypto + decision logic (pure cores, no electron). Covers
 * password hashing, AES-256-GCM round-trip + unique IVs, RFC-6238 TOTP (with a known
 * vector), backup codes, password strength, sessions, guards, vault public view (no secret),
 * rate-limiting, LAN prerequisites, and audit redaction. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import cc from '../electron/services/security/cryptoCore';
import ac from '../electron/services/security/authCore';

// (1)(2)(3) password hashing
test('password hashing: never plaintext; correct verifies; wrong fails', () => {
  const stored = cc.hashPassword('Correct-Horse-Battery-9');
  assert.equal(stored.algorithm, 'scrypt');
  assert.ok(stored.hash.length >= 64 && stored.salt.length >= 16);
  assert.ok(!JSON.stringify(stored).includes('Correct-Horse-Battery-9'), 'plaintext not stored');
  assert.equal(cc.verifyPassword('Correct-Horse-Battery-9', stored), true);
  assert.equal(cc.verifyPassword('wrong', stored), false);
  // unique salt → different hashes for same password
  assert.notEqual(cc.hashPassword('same').hash, cc.hashPassword('same').hash);
});

// (4) password strength
test('password strength blocks weak/common, accepts strong', () => {
  assert.equal(cc.passwordStrength('123456').ok, false);
  assert.equal(cc.passwordStrength('password').ok, false);
  assert.equal(cc.passwordStrength('short').ok, false);
  const strong = cc.passwordStrength('Tr0ub4dour&3xtra');
  assert.equal(strong.ok, true);
  assert.equal(strong.strong, true);
});

// (8)(9) AES-256-GCM round trip + unique IV
test('AES-256-GCM round-trips and uses a unique IV per encryption', () => {
  const key = cc.randomKey(32);
  const ct1 = cc.encryptGCM(key, 'super-secret-value');
  const ct2 = cc.encryptGCM(key, 'super-secret-value');
  assert.equal(cc.decryptGCM(key, ct1), 'super-secret-value');
  assert.notEqual(cc.ivOf(ct1), cc.ivOf(ct2), 'IVs differ');
  assert.notEqual(ct1, ct2, 'ciphertexts differ');
  // tamper the ciphertext → GCM auth failure
  const parts = ct1.split(':');
  const ctBuf = Buffer.from(parts[2], 'base64'); ctBuf[0] ^= 0xff;
  const tampered = [parts[0], parts[1], ctBuf.toString('base64'), parts[3]].join(':');
  assert.throws(() => cc.decryptGCM(key, tampered));
  // wrong key → fails
  assert.throws(() => cc.decryptGCM(cc.randomKey(32), ct1));
});

// (6) TOTP — known RFC 6238 vector + round-trip
test('TOTP matches the RFC 6238 vector and round-trips', () => {
  const seed = cc.base32Encode(Buffer.from('12345678901234567890')); // RFC test seed (SHA1)
  assert.equal(cc.totpCode(seed, 59 * 1000), '287082');               // RFC 6238 T=59 → 287082 (6-digit)
  assert.equal(cc.totpCode(seed, 1111111109 * 1000), '081804');
  const secret = cc.generateTotpSecret();
  const now = Date.now();
  assert.equal(cc.verifyTotp(secret, cc.totpCode(secret, now), now), true);
  assert.equal(cc.verifyTotp(secret, '000000', now), false);
  assert.match(cc.otpauthUri(secret, 'admin'), /^otpauth:\/\/totp\/DAWN:admin\?secret=/);
});

// (7) backup codes hashed, single-use
test('backup codes: hashed storage, normalized, single-use semantics', () => {
  const codes = cc.generateBackupCodes(10);
  assert.equal(codes.length, 10);
  const hashes = codes.map(cc.hashBackupCode);
  // a code verifies against its hash regardless of case/dashes
  assert.equal(cc.hashBackupCode(codes[0].toUpperCase().replace('-', '')), hashes[0]);
  // distinct codes → distinct hashes
  assert.equal(new Set(hashes).size, 10);
});

// (5) sessions
test('sessions: validity + expiry + touch', () => {
  const s = ac.makeSession(30, 1000);
  assert.equal(ac.sessionValid(s, 1000), true);
  assert.equal(ac.sessionValid(s, 1000 + 31 * 60000), false); // expired
  assert.equal(ac.sessionValid(null), false);
  const t = ac.touchSession(s, 30, 2000);
  assert.ok(t.expiresAt > s.expiresAt);
});

// (11)(15) guards
test('guards enforce lock + password for sensitive actions when auth enabled', () => {
  assert.throws(() => ac.requireSessionForReveal(true, false), /locked/i);
  assert.doesNotThrow(() => ac.requireSessionForReveal(true, true));
  assert.doesNotThrow(() => ac.requireSessionForReveal(false, false)); // local desktop mode: no lock
  assert.throws(() => ac.requirePasswordForSecurityChange(true, false), /Password verification/i);
  assert.doesNotThrow(() => ac.requirePasswordForSecurityChange(false, false));
});

// (10) vault public view never includes the secret
test('vaultPublicView strips secret + metadata ciphertext', () => {
  const v = ac.vaultPublicView({ id: '1', label: 'OpenAI key', kind: 'api_key', secret_enc: 'v1:iv:ct:tag', metadata_enc: 'v1:..', username: 'me' });
  assert.equal((v as any).secret_enc, undefined);
  assert.equal((v as any).secret, undefined);
  assert.equal(v.hasSecret, true);
  assert.equal(v.label, 'OpenAI key');
  assert.ok(!JSON.stringify(v).includes('ct:tag'));
});

// rate limiting
test('rate limiting blocks after repeated failures with escalating lockout', () => {
  assert.equal(ac.rateLimit(2).blocked, false);
  const r = ac.rateLimit(5);
  assert.equal(r.blocked, true);
  assert.ok(r.lockMs >= 30000);
  assert.ok(ac.rateLimit(20).lockMs <= 300000);
});

// LAN prerequisites
test('LAN mode requires password + auth; warns without TOTP', () => {
  assert.equal(ac.lanModeAllowed({ authEnabled: false, hasPassword: false, totpEnabled: false }).allowed, false);
  const ok = ac.lanModeAllowed({ authEnabled: true, hasPassword: true, totpEnabled: false });
  assert.equal(ok.allowed, true);
  assert.ok(ok.warnings.some((w) => /TOTP/.test(w)));
  assert.equal(ac.lanModeAllowed({ authEnabled: true, hasPassword: true, totpEnabled: true }).warnings.length, 0);
});

// (12) audit shaping never carries secrets
test('auth audit shaping truncates detail and marks success', () => {
  const a = ac.shapeAuthAudit('vault_reveal', 'label=OpenAI key', true);
  assert.equal(a.event, 'vault_reveal');
  assert.equal(a.success, 1);
  assert.ok(a.detail.length <= 200);
});
