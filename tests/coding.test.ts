/**
 * Tests for the Coding Agent's pure security core (electron/services/coding/*).
 * Workspace validation, path safety, the safe command allowlist, and patch
 * parse/validate/apply/diff — the security boundary of the coding agent.
 * Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { validateWorkspaceRoot } from '../electron/services/coding/workspace';
import { resolveInWorkspace, protectedReason, looksBinary, isEditableText } from '../electron/services/coding/pathsafety';
import { parseCommand } from '../electron/services/coding/commands';
import { parseUnifiedDiff, validatePatch, applyFilePatch, applyExactEdits, unifiedDiff, countChangedLines } from '../electron/services/coding/patch';

const HOME = 'C:\\Users\\benma';
const WS = 'C:\\Users\\benma\\projects\\myapp';

// --- workspace validation --------------------------------------------------
test('workspace: accepts a normal project folder', () => {
  const r = validateWorkspaceRoot(WS, HOME);
  assert.equal(r.ok, true);
});
test('workspace: rejects drive root / profile root / broad + system folders', () => {
  for (const bad of ['C:\\', 'C:', 'C:\\Users\\benma', 'C:\\Users\\benma\\Desktop', 'C:\\Users\\benma\\Documents',
    'C:\\Users\\benma\\AppData\\Roaming', 'C:\\Program Files', 'C:\\Windows', 'C:\\Windows\\System32',
    'C:\\Users\\benma\\.ssh', 'C:\\Users']) {
    assert.equal(validateWorkspaceRoot(bad, HOME).ok, false, bad);
  }
});
test('workspace: a project under Documents is allowed', () => {
  assert.equal(validateWorkspaceRoot('C:\\Users\\benma\\Documents\\proj', HOME).ok, true);
});

// --- path safety -----------------------------------------------------------
test('path: resolves a relative file inside the workspace', () => {
  const r = resolveInWorkspace(WS, 'src/index.ts');
  assert.equal(r.ok, true);
  assert.equal(r.rel, 'src/index.ts');
});
test('path: rejects traversal, absolute escape, workspace root itself', () => {
  assert.equal(resolveInWorkspace(WS, '../other/x.ts').ok, false);
  assert.equal(resolveInWorkspace(WS, '../../Windows/system32/x').ok, false);
  assert.equal(resolveInWorkspace(WS, 'C:\\Windows\\x').ok, false);
  assert.equal(resolveInWorkspace(WS, '.').ok, false);
});
test('path: rejects protected/secret/VCS targets even inside the workspace', () => {
  assert.equal(resolveInWorkspace(WS, '.env').ok, false);
  assert.equal(resolveInWorkspace(WS, '.git/config').ok, false);
  assert.equal(resolveInWorkspace(WS, 'node_modules/pkg/index.js').ok, false);
  assert.equal(resolveInWorkspace(WS, 'keys/server.pem').ok, false);
  assert.ok(protectedReason('C:\\proj\\.env'));
});
test('path: binary heuristic + editable-type check', () => {
  assert.equal(looksBinary(Buffer.from('hello world\nok')), false);
  assert.equal(looksBinary(Buffer.from([1, 2, 0, 3, 4])), true);
  assert.equal(isEditableText('a/b/logo.png').ok, false);
  assert.equal(isEditableText('a/b/app.ts').ok, true);
});

// --- safe command allowlist ------------------------------------------------
test('commands: allows test/lint/typecheck runners (argv)', () => {
  for (const c of ['npm test', 'npm run test', 'npm run test:unit', 'npm run lint', 'npm run typecheck',
    'npx tsc --noEmit', 'npx vitest run', 'pnpm test', 'yarn lint', 'python -m pytest -q', 'pytest -q',
    'ruff check .', 'mypy .']) {
    assert.equal(parseCommand(c).ok, true, c);
  }
});
test('commands: rejects shell metacharacters / chaining / redirects / pipes', () => {
  for (const c of ['npm test && rm -rf .', 'npm test | tee out', 'pytest > out.txt', 'npm test; cat /etc/passwd',
    'npm test `whoami`', 'npm test $(id)']) {
    assert.equal(parseCommand(c).ok, false, c);
  }
});
test('commands: rejects install / network / destructive / system', () => {
  for (const c of ['npm install', 'npm ci', 'pip install requests', 'npx create-react-app x', 'curl http://x',
    'powershell -c calc', 'rm -rf /', 'git push', 'tsc']) {
    assert.equal(parseCommand(c).ok, false, c);
  }
});

// --- patch parse / validate / apply ---------------------------------------
const PATCH = `diff --git a/src/util.ts b/src/util.ts
--- a/src/util.ts
+++ b/src/util.ts
@@ -1,3 +1,3 @@
 export function add(a, b) {
-  return a - b;
+  return a + b;
 }
`;

test('patch: parses + validates targets inside the workspace', () => {
  const p = parseUnifiedDiff(PATCH);
  assert.ok(p.ok && p.files!.length === 1 && p.files![0].rel === 'src/util.ts');
  const v = validatePatch(PATCH, WS);
  assert.ok(v.ok && v.files![0].rel === 'src/util.ts');
});
test('patch: applies hunk to current content (context-matched)', () => {
  const before = 'export function add(a, b) {\n  return a - b;\n}\n';
  const f = parseUnifiedDiff(PATCH).files![0];
  const r = applyFilePatch(before, f);
  assert.ok(r.ok);
  assert.match(r.content!, /return a \+ b;/);
});
test('patch: stale context fails closed', () => {
  const f = parseUnifiedDiff(PATCH).files![0];
  const r = applyFilePatch('totally different content\n', f);
  assert.equal(r.ok, false);
});
test('patch: rejects out-of-workspace / absolute / protected / binary targets', () => {
  assert.equal(validatePatch(PATCH.replace('a/src/util.ts b/src/util.ts', 'a/../x.ts b/../x.ts').replace(/[ab]\/src\/util\.ts/g, '../x.ts'), WS).ok, false);
  const absP = PATCH.replace(/src\/util\.ts/g, 'C:/Windows/x.ts');
  assert.equal(validatePatch(absP, WS).ok, false);
  const envP = PATCH.replace(/src\/util\.ts/g, '.env');
  assert.equal(validatePatch(envP, WS).ok, false);
  const binP = 'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n';
  assert.equal(validatePatch(binP, WS).ok, false);
});
test('patch: countChangedLines', () => {
  assert.equal(countChangedLines(PATCH), 2);
});

// --- exact edits -----------------------------------------------------------
test('exact edit: replaces a unique block', () => {
  const r = applyExactEdits('const x = 1;\nconst y = 2;\n', [{ old_text: 'const x = 1;', new_text: 'const x = 42;' }]);
  assert.ok(r.ok && /const x = 42;/.test(r.content!));
});
test('exact edit: missing old_text fails closed', () => {
  assert.equal(applyExactEdits('abc', [{ old_text: 'zzz', new_text: 'q' }]).ok, false);
});
test('exact edit: ambiguous (multiple matches) fails unless allowed', () => {
  const dup = 'x\nx\n';
  assert.equal(applyExactEdits(dup, [{ old_text: 'x', new_text: 'y' }]).ok, false);
  assert.ok(applyExactEdits(dup, [{ old_text: 'x', new_text: 'y' }], { allowMultiple: true }).ok);
});

// --- diff generation + round-trip -----------------------------------------
// --- AgentOS-proposed patches must route through DAWN validation -----------
test('an AgentOS-proposed patch touching protected/outside paths is rejected by DAWN', () => {
  // simulate a patch AgentOS might propose that tries to escape / hit a secret
  const escape = 'diff --git a/../../Windows/x b/../../Windows/x\n--- a/../../Windows/x\n+++ b/../../Windows/x\n@@ -1 +1 @@\n-a\n+b\n';
  assert.equal(validatePatch(escape, WS).ok, false);
  const env = PATCH.replace(/src\/util\.ts/g, '.env');
  assert.equal(validatePatch(env, WS).ok, false);
});

test('unifiedDiff: generates a diff that re-applies to reproduce the change', () => {
  const oldText = 'line1\nline2\nline3\n';
  const newText = 'line1\nline2 changed\nline3\nline4\n';
  const d = unifiedDiff(oldText, newText, 'src/a.ts');
  assert.match(d, /^--- a\/src\/a\.ts/);
  assert.match(d, /\+line2 changed/);
  const f = parseUnifiedDiff(d).files![0];
  const re = applyFilePatch(oldText, f);
  assert.ok(re.ok);
  assert.equal(re.content!.replace(/\n$/, ''), newText.replace(/\n$/, ''));
});
