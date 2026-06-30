/**
 * Tests for the install_software command builders (electron/services/installCmd.ts).
 * These are the security-sensitive boundary: a crafted model output must not be able to
 * smuggle a second shell command past the approval preview. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { buildWingetCommand, buildRunInstallerCommand } from '../electron/services/installCmd';

// --- winget ----------------------------------------------------------------
test('winget: install by display name', () => {
  const r = buildWingetCommand('Advanced IP Scanner');
  assert.equal(r.ok, true);
  assert.match(r.command!, /^winget install --name "Advanced IP Scanner"/);
  assert.match(r.command!, /--accept-package-agreements --accept-source-agreements/);
  assert.match(r.command!, /--silent$/);
});

test('winget: install by id uses --id --exact', () => {
  const r = buildWingetCommand('Famatech.AdvancedIPScanner');
  assert.equal(r.ok, true);
  assert.match(r.command!, /--id "Famatech\.AdvancedIPScanner" --exact/);
});

test('winget: silent:false omits --silent', () => {
  const r = buildWingetCommand('7zip.7zip', { silent: false });
  assert.ok(r.ok && !/--silent/.test(r.command!));
});

test('winget: rejects shell-metacharacter injection in the name', () => {
  for (const bad of ['7zip; rm -rf /', 'x && calc', 'a | b', '$(whoami)', 'a`b`', 'pkg\nrm', 'a & start evil']) {
    const r = buildWingetCommand(bad);
    assert.equal(r.ok, false, bad);
  }
});

test('winget: rejects empty name', () => {
  assert.equal(buildWingetCommand('').ok, false);
});

// --- run installer ---------------------------------------------------------
test('installer: builds Start-Process for an .exe with -Wait', () => {
  const r = buildRunInstallerCommand('C:\\Users\\benma\\Downloads\\DAWN\\setup.exe');
  assert.equal(r.ok, true);
  assert.match(r.command!, /^Start-Process -FilePath 'C:\\Users\\benma\\Downloads\\DAWN\\setup\.exe' -Wait$/);
});

test('installer: passes validated silent args', () => {
  const r = buildRunInstallerCommand('C:\\q\\app.msi', '/S /D=C:\\Program Files\\App');
  assert.ok(r.ok);
  assert.match(r.command!, /-ArgumentList '\/S \/D=C:\\Program Files\\App'/);
});

test('installer: rejects non-installer extensions', () => {
  assert.equal(buildRunInstallerCommand('C:\\q\\notes.txt').ok, false);
  assert.equal(buildRunInstallerCommand('C:\\q\\script.ps1').ok, false);
});

test('installer: rejects unsafe argument injection', () => {
  for (const bad of ['/S; rm', '/S && calc', '$(evil)', '`whoami`', '/S | x', '/S\nstart evil']) {
    const r = buildRunInstallerCommand('C:\\q\\app.exe', bad);
    assert.equal(r.ok, false, bad);
  }
});

test('installer: single-quote in path is PS-escaped (no breakout)', () => {
  const r = buildRunInstallerCommand("C:\\q\\o'brien.exe");
  assert.ok(r.ok);
  assert.match(r.command!, /'C:\\q\\o''brien\.exe'/);   // doubled quote = literal, not a string break
});
