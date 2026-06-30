/**
 * Tests for the Local Knowledge safety guard (knowledgeGuardCore) — the security gate that decides
 * what may be indexed and WHY a file is skipped. Verifies secrets/keys/.env/vault-DB/node_modules/.git
 * are never indexable, the 5 MB limit + unsupported-type rules, plain-language reasons, and that the
 * knowledge_source workspace adapter is wired. No filesystem. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import kg, { classifyFile, classifyDir, MAX_FILE_BYTES } from '../electron/services/knowledge/knowledgeGuardCore';
import { ADAPTER_DEFS } from '../electron/services/workspace/adaptersCore';
import fm from '../electron/services/featureMaturityCore';

test('secrets / keys / .env / vault DB are NEVER indexable, with reasons', () => {
  for (const f of ['/p/.env', '/p/.env.local', '/p/id_rsa', '/p/credentials', '/p/secrets.json', '/p/dawn.db', '/p/server.pem', '/p/cert.key', '/p/vault.kdbx', '/p/Login Data', '/p/my-secret-token.txt']) {
    const v = classifyFile(f, 10);
    assert.equal(v.index, false, `${f} must be skipped`);
    assert.ok(v.reason && v.reason.length > 0, `${f} must carry a reason`);
  }
});

test('protected directories are blocked with reasons; normal dirs pass', () => {
  for (const d of ['node_modules', '.git', '.ssh', 'AppData', 'GPUCache']) assert.equal(classifyDir(d).blocked, true, `${d} must be blocked`);
  assert.equal(classifyDir('notes').blocked, false);
  assert.ok(classifyDir('node_modules').reason);
});

test('size limit + unsupported types enforced; real text/docs allowed', () => {
  assert.equal(classifyFile('/p/big.md', MAX_FILE_BYTES + 1).index, false);
  assert.match(classifyFile('/p/big.md', MAX_FILE_BYTES + 1).reason!, /too large/);
  assert.equal(classifyFile('/p/photo.png', 1000).index, false);
  assert.match(classifyFile('/p/photo.png', 1000).reason!, /unsupported/);
  assert.equal(classifyFile('/p/notes.md', 1000).index, true);
  assert.equal(classifyFile('/p/data.csv', 1000).index, true);
  assert.equal(classifyFile('/p/doc.pdf', 1000).index, true);
});

test('knowledge sources auto-register into the Workspace Graph (no path leak via label)', () => {
  const def = ADAPTER_DEFS.find((d) => d.feature === 'knowledge' && d.type === 'knowledge_source');
  assert.ok(def, 'knowledge_source adapter must exist');
  assert.deepEqual(def!.labelCols, ['name'], 'label must be the name only — never the full path');
  assert.ok(!(def!.metaCols || []).includes('path'), 'path must not be copied into workspace metadata');
});

test('System Health: Knowledge Safety area is COMPLETE', () => {
  assert.equal(fm.evaluateArea('knowledge_safety').status, 'COMPLETE');
});
