/**
 * Tests for the credential floor (electron/services/credentialFloor.ts) — the ONE hard limit
 * that holds even in Full Power mode: credentials/secrets are never read, modified, or
 * silently touched. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { credentialFloorReason, isCredentialPath, isSecretFile, mentionsCredentials } from '../electron/services/credentialFloor';

test('floor: blocks secret files + credential/key directories', () => {
  for (const p of [
    'C:\\proj\\.env', 'C:\\proj\\.env.local', 'C:\\Users\\me\\.ssh\\id_rsa', 'C:\\Users\\me\\.ssh\\id_ed25519',
    'C:\\keys\\server.pem', 'C:\\x\\app.key', 'C:\\x\\cert.pfx', 'C:\\secrets.json', 'C:\\credentials.json',
    'C:\\Users\\me\\.aws\\credentials', 'C:\\Users\\me\\.npmrc', 'C:\\Users\\me\\.git-credentials',
    'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data',
    'C:\\Users\\me\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\abc\\key4.db',
    'C:\\wallet.dat',
  ]) {
    assert.ok(credentialFloorReason(p), p);
    assert.equal(isCredentialPath(p), true, p);
  }
});

test('floor: allows ordinary project files', () => {
  for (const p of ['C:\\proj\\src\\index.ts', 'C:\\proj\\README.md', 'C:\\proj\\package.json', 'C:\\notes\\todo.txt']) {
    assert.equal(credentialFloorReason(p), null, p);
  }
});

test('floor: isSecretFile narrowly matches secret files', () => {
  assert.equal(isSecretFile('a/.env'), true);
  assert.equal(isSecretFile('a/id_rsa'), true);
  assert.equal(isSecretFile('a/app.ts'), false);
});

test('floor: mentionsCredentials flags credential-touching commands (forces a fresh prompt)', () => {
  for (const c of ['Get-Content $env:USERPROFILE\\.ssh\\id_rsa', 'cat .env', 'type credentials.json',
    'gci ~\\.aws', 'Copy-Item wallet.dat x', 'echo $env:OPENAI_API_KEY', 'reg query HKCU\\...\\password']) {
    assert.equal(mentionsCredentials(c), true, c);
  }
});

test('floor: mentionsCredentials does not flag ordinary commands', () => {
  for (const c of ['npm test', 'Get-Process', 'Start-Process notepad.exe', 'ipconfig /all', 'git status', 'dir C:\\proj\\src']) {
    assert.equal(mentionsCredentials(c), false, c);
  }
});
