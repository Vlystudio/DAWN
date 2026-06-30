/**
 * Tests for the CodingRun orchestrator (electron/services/coding/coding.ts) with an INJECTED
 * fake model. Verifies the state machine end-to-end without a live LLM: checkpoint → apply
 * ops → final diff → completed; propose_patch mode does not write; delete needs approval;
 * rollback restores; pickCodingModel routing/warning. Run: npm run test:agentos
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dawn-crun-data-'));
process.env.DAWN_CODING_DATA = DATA;

import * as eng from '../electron/services/coding/engine';
import { runCodingTask, pickCodingModel } from '../electron/services/coding/coding';
import type { Workspace } from '../electron/services/coding/engine';

let ROOT: string;
function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    workspace_id: 'ws_run', name: 't', root_path: ROOT, created_at: '', last_used_at: '', trust_level: 'coding_workspace',
    autopilot_enabled: true, mode: 'workspace_autopilot', is_git: false, allow_file_create: true, allow_file_delete: true,
    allow_test_commands: false, max_iterations: 3, max_files_per_run: 20, max_diff_lines_per_run: 600, max_command_seconds: 30,
    requires_approval_for_large_diff: true, requires_approval_for_delete: true, created_by: 'local_user', ...over,
  } as Workspace;
}
const fakeGen = (reply: string) => async () => reply;

before(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dawn-runws-'));
  fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'src', 'util.ts'), 'export function add(a, b) {\n  return a - b;\n}\n');
});
after(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* */ } });

// --- model routing ---------------------------------------------------------
test('pickCodingModel: configured + loaded → no warning; not loaded / none → warning', () => {
  assert.equal(pickCodingModel({ modelRoles: { coding: 'qwen2.5-coder-32b' }, chatModel: 'qwen2.5-coder-32b' }).warning, null);
  assert.match(pickCodingModel({ modelRoles: { coding: 'qwen2.5-coder-32b' }, chatModel: 'llama-3' }).warning!, /not the loaded model/);
  assert.match(pickCodingModel({ modelRoles: {}, chatModel: 'llama-3' }).warning!, /dedicated coding model/);
});

// --- end-to-end autopilot run ---------------------------------------------
test('workspace_autopilot: applies an edit, completes, produces a diff, rolls back', async () => {
  const reply = '```dawn-ops\n{"plan":"fix add","ops":[{"op":"edit","path":"src/util.ts","edits":[{"old_text":"return a - b;","new_text":"return a + b;"}]}],"done":true}\n```';
  const run = await runCodingTask(ws(), 'make add() correct', 'workspace_autopilot', { generate: fakeGen(reply) });
  assert.equal(run.status, 'completed');
  assert.ok(run.files_changed.includes('src/util.ts'));
  assert.match(fs.readFileSync(path.join(ROOT, 'src/util.ts'), 'utf-8'), /return a \+ b;/);
  assert.ok(run.checkpoint_id && run.diff_summary);
  // rollback restores the original
  const rb = eng.rollback(ws(), run.run_id);
  assert.ok(rb.ok);
  assert.match(fs.readFileSync(path.join(ROOT, 'src/util.ts'), 'utf-8'), /return a - b;/);
});

test('propose_patch mode does not write files (awaits approval)', async () => {
  const before = fs.readFileSync(path.join(ROOT, 'src/util.ts'), 'utf-8');
  const reply = '```dawn-ops\n{"ops":[{"op":"write","path":"src/util.ts","content":"changed"}],"done":true}\n```';
  const run = await runCodingTask(ws(), 'x', 'propose_patch', { generate: fakeGen(reply) });
  assert.equal(run.status, 'awaiting_approval');
  assert.equal(fs.readFileSync(path.join(ROOT, 'src/util.ts'), 'utf-8'), before);   // unchanged
});

test('create blocked when allow_file_create=false; protected path edit fails', async () => {
  const reply = '```dawn-ops\n{"ops":[{"op":"create","path":"src/x.ts","content":"a"},{"op":"write","path":".env","content":"S=1"}],"done":true}\n```';
  const run = await runCodingTask(ws({ allow_file_create: false }), 'x', 'workspace_autopilot', { generate: fakeGen(reply) });
  assert.equal(fs.existsSync(path.join(ROOT, 'src/x.ts')), false);     // create disabled
  assert.equal(fs.existsSync(path.join(ROOT, '.env')), false);        // protected denied
});

test('delete op requires approval (skipped when denied)', async () => {
  fs.writeFileSync(path.join(ROOT, 'src/del.ts'), 'x\n');
  const reply = '```dawn-ops\n{"ops":[{"op":"delete","path":"src/del.ts"}],"done":true}\n```';
  const run = await runCodingTask(ws(), 'remove', 'workspace_autopilot', { generate: fakeGen(reply), approve: async () => false });
  assert.ok(fs.existsSync(path.join(ROOT, 'src/del.ts')));            // not deleted (denied)
});

test('invalid model output does not crash; run fails closed', async () => {
  const run = await runCodingTask(ws({ max_iterations: 2 }), 'x', 'workspace_autopilot', { generate: fakeGen('no ops here') });
  assert.ok(['failed', 'completed'].includes(run.status));
  assert.equal(run.files_changed.length, 0);
});
