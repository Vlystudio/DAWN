/**
 * Tests for the Coding Agent engine file ops (electron/services/coding/engine.ts) against a
 * REAL temp workspace (no Electron — DAWN_CODING_DATA points checkpoints/audit at a temp dir).
 * Covers: write/create/edit/apply_patch/delete, checkpoint-before-edit, rollback, get_diff,
 * protected-path denial, traversal denial, large-diff approval gate, command runner safety.
 * Run: npm run test:agentos
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dawn-coding-data-'));
process.env.DAWN_CODING_DATA = DATA;

// import AFTER setting the env so the engine resolves the data dir correctly
import * as eng from '../electron/services/coding/engine';
import type { Workspace } from '../electron/services/coding/engine';

let WS_ROOT: string;
function makeWs(root: string, over: Partial<Workspace> = {}): Workspace {
  return {
    workspace_id: 'ws_test', name: 't', root_path: root, created_at: '', last_used_at: '', trust_level: 'coding_workspace',
    autopilot_enabled: true, mode: 'workspace_autopilot', is_git: false, allow_file_create: true, allow_file_delete: true,
    allow_test_commands: true, max_iterations: 4, max_files_per_run: 20, max_diff_lines_per_run: 600, max_command_seconds: 30,
    requires_approval_for_large_diff: true, requires_approval_for_delete: true, created_by: 'local_user', ...over,
  } as Workspace;
}

before(() => {
  WS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dawn-ws-'));
  fs.mkdirSync(path.join(WS_ROOT, 'src'), { recursive: true });
  fs.writeFileSync(path.join(WS_ROOT, 'src', 'util.ts'), 'export function add(a, b) {\n  return a - b;\n}\n');
});
after(() => { try { fs.rmSync(WS_ROOT, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* */ } });

// --- write / create --------------------------------------------------------
test('writeFile creates a file inside the workspace + returns a diff', () => {
  const ws = makeWs(WS_ROOT); const cp = eng.createCheckpoint(ws, 'run_w');
  const r = eng.writeFile(ws, cp, 'src/new.ts', 'export const x = 1;\n');
  assert.ok(r.ok && r.created);
  assert.ok(fs.existsSync(path.join(WS_ROOT, 'src/new.ts')));
  assert.match(r.diff!, /\+export const x = 1;/);
});
test('writeFile blocks protected + traversal targets', () => {
  const ws = makeWs(WS_ROOT); const cp = eng.createCheckpoint(ws, 'run_p');
  assert.equal(eng.writeFile(ws, cp, '.env', 'SECRET=1').ok, false);
  assert.equal(eng.writeFile(ws, cp, '../escape.ts', 'x').ok, false);
  assert.equal(eng.writeFile(ws, cp, '.git/config', 'x').ok, false);
  assert.equal(eng.writeFile(ws, cp, 'node_modules/p/i.js', 'x').ok, false);
});
test('createFile refuses overwrite by default', () => {
  const ws = makeWs(WS_ROOT); const cp = eng.createCheckpoint(ws, 'run_c');
  assert.ok(eng.createFile(ws, cp, 'src/once.ts', 'a\n').ok);
  assert.equal(eng.createFile(ws, cp, 'src/once.ts', 'b\n').ok, false);
  assert.ok(eng.createFile(ws, cp, 'src/once.ts', 'b\n', true).ok);
});

// --- edit ------------------------------------------------------------------
test('editFile exact replace works; missing/ambiguous fail closed', () => {
  const ws = makeWs(WS_ROOT); const cp = eng.createCheckpoint(ws, 'run_e');
  const ok = eng.editFile(ws, cp, 'src/util.ts', [{ old_text: 'return a - b;', new_text: 'return a + b;' }]);
  assert.ok(ok.ok && /return a \+ b;/.test(fs.readFileSync(path.join(WS_ROOT, 'src/util.ts'), 'utf-8')));
  assert.equal(eng.editFile(ws, cp, 'src/util.ts', [{ old_text: 'NOT THERE', new_text: 'x' }]).ok, false);
});

// --- apply patch -----------------------------------------------------------
const PATCH = `--- a/src/util.ts
+++ b/src/util.ts
@@ -1,3 +1,3 @@
 export function add(a, b) {
-  return a + b;
+  return a + b + 0;
 }
`;
test('applyPatch applies a valid patch; rejects outside/binary/large', () => {
  const ws = makeWs(WS_ROOT); const cp = eng.createCheckpoint(ws, 'run_ap');
  const r = eng.applyPatch(ws, cp, PATCH);
  assert.ok(r.ok && r.files!.includes('src/util.ts'));
  // outside-workspace
  assert.equal(eng.applyPatch(ws, cp, PATCH.replace(/src\/util\.ts/g, '../x.ts')).ok, false);
  // binary
  assert.equal(eng.applyPatch(ws, cp, 'diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n').ok, false);
  // large diff requires approval
  const tiny = makeWs(WS_ROOT, { max_diff_lines_per_run: 1 });
  const big = eng.applyPatch(tiny, cp, PATCH);
  assert.equal(big.ok, false);
  assert.equal(big.requiresApproval, 'large_diff');
});

// --- checkpoint + rollback -------------------------------------------------
test('checkpoint backs up before edit; rollback restores + removes created', () => {
  const ws = makeWs(WS_ROOT); const cp = eng.createCheckpoint(ws, 'run_rb');
  const original = fs.readFileSync(path.join(WS_ROOT, 'src/util.ts'), 'utf-8');
  eng.editFile(ws, cp, 'src/util.ts', [{ old_text: 'add', new_text: 'sum' }]);
  eng.writeFile(ws, cp, 'src/created.ts', 'export const c = 1;\n');
  assert.notEqual(fs.readFileSync(path.join(WS_ROOT, 'src/util.ts'), 'utf-8'), original);
  assert.ok(fs.existsSync(path.join(WS_ROOT, 'src/created.ts')));
  const rb = eng.rollback(ws, 'run_rb');
  assert.ok(rb.ok);
  assert.equal(fs.readFileSync(path.join(WS_ROOT, 'src/util.ts'), 'utf-8'), original);   // restored
  assert.equal(fs.existsSync(path.join(WS_ROOT, 'src/created.ts')), false);              // created removed
});

// --- delete (reversible) ---------------------------------------------------
test('deleteFile is reversible via rollback; disabled when not allowed', () => {
  const ws = makeWs(WS_ROOT); const cp = eng.createCheckpoint(ws, 'run_del');
  fs.writeFileSync(path.join(WS_ROOT, 'src/gone.ts'), 'bye\n');
  const r = eng.deleteFile(ws, cp, 'src/gone.ts');
  assert.ok(r.ok && !fs.existsSync(path.join(WS_ROOT, 'src/gone.ts')));
  eng.rollback(ws, 'run_del');
  assert.ok(fs.existsSync(path.join(WS_ROOT, 'src/gone.ts')));    // restored
  const noDel = makeWs(WS_ROOT, { allow_file_delete: false });
  assert.equal(eng.deleteFile(noDel, cp, 'src/gone.ts').ok, false);
});

// --- get diff (non-git checkpoint) -----------------------------------------
test('getDiff (non-git) reports changed files vs checkpoint', () => {
  const ws = makeWs(WS_ROOT); const cp = eng.createCheckpoint(ws, 'run_gd');
  eng.editFile(ws, cp, 'src/util.ts', [{ old_text: 'function', new_text: 'function /* edited */' }]);
  const d = eng.getDiff(ws, 'run_gd');
  assert.equal(d.via, 'checkpoint');
  assert.match(d.diff, /edited/);
});

// --- command runner safety -------------------------------------------------
test('runTestCommand rejects unsafe commands without spawning', async () => {
  const ws = makeWs(WS_ROOT);
  for (const c of ['rm -rf .', 'npm install', 'npm test && rm x', 'curl http://x', 'pytest | tee out']) {
    const r = await eng.runTestCommand(ws, c, 'run_cmd');
    assert.equal(r.ok, false, c);
    assert.ok(r.reason);
  }
});
test('runTestCommand respects allow_test_commands=false', async () => {
  const ws = makeWs(WS_ROOT, { allow_test_commands: false });
  const r = await eng.runTestCommand(ws, 'npm test');
  assert.equal(r.ok, false);
  assert.match(r.reason!, /disabled/);
});

// --- secret redaction in diff ----------------------------------------------
test('secrets are redacted from returned diffs', () => {
  const ws = makeWs(WS_ROOT); const cp = eng.createCheckpoint(ws, 'run_sec');
  const r = eng.writeFile(ws, cp, 'src/cfg.ts', 'export const KEY = "sk-test_fake_fake_fake";\n');
  assert.ok(r.ok);
  assert.ok(!r.diff!.includes('sk-test_fake_fake_fake'));
  assert.match(r.diff!, /\[REDACTED/);
});
