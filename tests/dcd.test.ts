/**
 * Tests for the D.C.D client (electron/services/dcd.ts). Effects (spawn/elevated/fs) are
 * injected, so no real engine is needed. Verifies the operation allowlist, argv construction
 * (argv-only, --json), parameter validation, read-only vs elevated routing, trusted-engine
 * resolution, JSON parsing, secret redaction, and unknown-op rejection. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  runOperation, resolveEngine, operationInfo, listOperations, OPERATIONS, DEFAULT_ENGINE, DcdDeps,
} from '../electron/services/dcd';

function makeDeps(over: Partial<DcdDeps> & { json?: any; raw?: string; code?: number } = {}): { deps: DcdDeps; calls: any[] } {
  const calls: any[] = [];
  const out = over.raw !== undefined ? over.raw : JSON.stringify(over.json ?? { ok: true });
  const deps: DcdDeps = {
    pathExists: over.pathExists || ((p) => p === DEFAULT_ENGINE),
    spawnJson: over.spawnJson || (async (exe, args, cwd, t) => { calls.push({ kind: 'spawn', exe, args, cwd }); return { code: over.code ?? 0, stdout: out, stderr: '' }; }),
    runElevatedJson: over.runElevatedJson || (async (exe, args, cwd, t) => { calls.push({ kind: 'elevated', exe, args, cwd }); return { code: over.code ?? 0, stdout: out, stderr: '' }; }),
  };
  return { deps, calls };
}

// --- engine resolution -----------------------------------------------------
test('resolveEngine: only ever resolves engine.exe, never python/cmd', () => {
  assert.equal(resolveEngine({}, { pathExists: () => true }).exe, DEFAULT_ENGINE);
  // a python override is skipped (never used); it falls back to the trusted default engine.exe
  const r = resolveEngine({ enginePath: 'C:\\x\\python.exe' }, { pathExists: () => true });
  assert.ok(!r.exe || r.exe.toLowerCase().endsWith('engine.exe'));
  // a valid engine.exe override is honored
  assert.equal(resolveEngine({ enginePath: 'C:\\x\\engine.exe' }, { pathExists: (p) => p === 'C:\\x\\engine.exe' }).exe, 'C:\\x\\engine.exe');
  // not installed at all → fail closed
  assert.equal(resolveEngine({}, { pathExists: () => false }).ok, false);
});

// --- operation allowlist + argv -------------------------------------------
test('scan builds argv-only [scan --type <t> --json]', async () => {
  const m = makeDeps({ json: { scan_type: 'full', files_scanned: 10, total_findings: 0, severity_counts: {}, tools_used: ['clamav', 'yara'] } });
  const r = await runOperation('scan', { type: 'full' }, {}, m.deps);
  assert.equal(r.ok, true);
  assert.equal(m.calls[0].kind, 'spawn');
  assert.deepEqual(m.calls[0].args, ['scan', '--type', 'full', '--json']);
  assert.match(r.summary, /10 file/);
});

test('path scan uses scan --path (no custom type); defender custom uses --scan custom --path', async () => {
  const bad = await runOperation('scan', { type: 'custom' }, {}, makeDeps().deps);   // no path
  assert.equal(bad.ok, false);
  const m = makeDeps({ json: { files_scanned: 3 } });
  const ok = await runOperation('scan', { path: 'C:\\Users\\me\\Downloads' }, {}, m.deps);
  assert.ok(ok.ok);
  assert.deepEqual(m.calls[0].args, ['scan', '--path', 'C:\\Users\\me\\Downloads', '--json']);
  const m2 = makeDeps({ json: { threats_found: 0 } });
  await runOperation('defender_scan', { type: 'custom', path: 'C:\\Users\\me\\Downloads' }, {}, m2.deps);
  assert.deepEqual(m2.calls[0].args, ['defender', '--scan', 'custom', '--path', 'C:\\Users\\me\\Downloads', '--json']);
});

test('defender_scan maps to defender --scan; unknown op rejected', async () => {
  const m = makeDeps({ json: { threats_found: 0 } });
  await runOperation('defender_scan', { type: 'quick' }, {}, m.deps);
  assert.deepEqual(m.calls[0].args, ['defender', '--scan', 'quick', '--json']);
  const u = await runOperation('totally_made_up', {}, {}, makeDeps().deps);
  assert.equal(u.ok, false);
  assert.match(u.error!, /Unknown D\.C\.D operation/);
});

test('parameter validation: pid / id / ip / realtime state', async () => {
  assert.equal((await runOperation('behavior_kill', { pid: 'evil; rm' }, {}, makeDeps().deps)).ok, false);
  assert.equal((await runOperation('quarantine_restore', { id: 'a/../b' }, {}, makeDeps().deps)).ok, false);
  assert.equal((await runOperation('firewall_block', { ip: 'not-an-ip!!' }, {}, makeDeps().deps)).ok, false);
  assert.equal((await runOperation('defender_realtime', { state: 'maybe' }, {}, makeDeps().deps)).ok, false);
});

// --- elevated routing ------------------------------------------------------
test('elevated ops go through the elevated runner (RunAs), not plain spawn', async () => {
  const m = makeDeps({ json: { ok: true } });
  const r = await runOperation('defender_harden', {}, {}, m.deps);
  assert.equal(r.elevated, true);
  assert.equal(m.calls[0].kind, 'elevated');
  assert.deepEqual(m.calls[0].args, ['defender', '--harden', '--json']);
  assert.equal(operationInfo('defender_harden').elevated, true);
  assert.equal(operationInfo('scan').elevated, false);
});

test('elevated op refused when allowElevated=false', async () => {
  const r = await runOperation('defender_remove_threats', {}, { allowElevated: false }, makeDeps().deps);
  assert.equal(r.ok, false);
  assert.match(r.error!, /elevation, which is disabled/);
});

// --- result handling -------------------------------------------------------
test('scan exit code 2 (threats found) is still ok; bad JSON fails closed', async () => {
  const m = makeDeps({ json: { total_findings: 2, severity_counts: { Critical: 2 }, files_scanned: 5 }, code: 2 });
  const r = await runOperation('scan', { type: 'quick' }, {}, m.deps);
  assert.equal(r.ok, true);
  assert.match(r.summary, /2 finding/);
  const bad = await runOperation('status', {}, {}, makeDeps({ raw: 'not json at all' }).deps);
  assert.equal(bad.ok, false);
});

test('secrets in engine output are redacted', async () => {
  const m = makeDeps({ json: { ok: true, findings: [{ severity: 'High', path: 'C:\\x\\sk-test_fake_fake_fake.bin', rule_or_signature: 'X' }], message: 'token sk-test_fake_fake_fake' } });
  const { formatForChat } = await import('../electron/services/dcd');
  const r = await runOperation('persistence', {}, {}, m.deps);
  const out = formatForChat(r);
  assert.ok(!out.includes('sk-test_fake_fake_fake'));
});

test('listOperations exposes read-only + elevated flags', () => {
  const ops = listOperations();
  assert.ok(ops.find((o) => o.name === 'scan' && !o.elevated));
  assert.ok(ops.find((o) => o.name === 'defender_harden' && o.elevated));
  assert.ok(Object.keys(OPERATIONS).length >= 20);
});
