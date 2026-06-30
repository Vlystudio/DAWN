/**
 * contract.test.ts — release-validation regression guard for the IPC/preload contract.
 * Statically reads electron/preload.ts + electron/ipc.ts and asserts that every channel the
 * renderer can invoke has exactly one main-process handler (a missing or duplicate handler
 * crashes a screen / the app at runtime — a class of bug the other tests don't catch).
 * Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const root = process.cwd();
const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const ipc = fs.readFileSync(path.join(root, 'electron/ipc.ts'), 'utf8');

const invoked = [...preload.matchAll(/invoke\('([a-zA-Z:]+)'/g)].map((m) => m[1]);
const handled = [...ipc.matchAll(/ipcMain\.handle\('([a-zA-Z:]+)'/g)].map((m) => m[1]);
const handledSet = new Set(handled);

test('every preload-invoked channel has an IPC handler', () => {
  const missing = [...new Set(invoked)].filter((c) => !handledSet.has(c));
  assert.deepEqual(missing, [], `preload invokes channels with no ipcMain.handle: ${missing.join(', ')}`);
  assert.ok(invoked.length > 200, 'sanity: expected many channels');
});

test('no duplicate IPC handlers (a second handle on a channel throws at startup)', () => {
  const seen = new Set<string>(); const dups: string[] = [];
  for (const c of handled) { if (seen.has(c)) dups.push(c); else seen.add(c); }
  assert.deepEqual(dups, [], `duplicate ipcMain.handle channels: ${dups.join(', ')}`);
});

test('security-sensitive channels are present (send/restore/vault/auth gated paths exist)', () => {
  for (const c of ['email:send', 'backup:restore', 'vault:reveal', 'auth:unlock', 'tools:approvalResponse', 'optimizer:apply', 'compare:start', 'skills:test'])
    assert.ok(handledSet.has(c), `missing handler: ${c}`);
});
