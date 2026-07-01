/**
 * Tests for the helper job queue (helperQueue.ts) — pure Node, mocked helper fns, no real model. Guards
 * the honest concurrency/priority/cancellation contract: one active job by default, priority + FIFO,
 * bounded capacity, timeouts, manual cancel, generation supersede, and status that carries NO prompt or
 * response text. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { HelperQueue } from '../electron/services/rag/helperQueue';

const tick = () => new Promise((r) => setTimeout(r, 5));
function deferred<T = any>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const ok = (text = 'x') => ({ ok: true as const, text });

test('one active job by default; a freed slot picks HIGH before LOW (priority over submit order)', async () => {
  const q = new HelperQueue();
  const order: string[] = [];
  const dB = deferred(), dL = deferred(), dH = deferred();
  const pB = q.run('block', 'normal', () => { order.push('block'); return dB.promise as any; }, { timeoutMs: 5000 }); // occupies the single slot
  const pL = q.run('rewriteL', 'low', () => { order.push('low'); return dL.promise as any; }, { timeoutMs: 5000 });   // queued
  const pH = q.run('rewriteH', 'high', () => { order.push('high'); return dH.promise as any; }, { timeoutMs: 5000 }); // queued
  await tick();
  assert.deepEqual(order, ['block']); // only 1 active
  assert.equal(q.status().active, 1); assert.equal(q.status().queued, 2);
  dB.resolve(ok()); await pB; await tick();
  assert.deepEqual(order, ['block', 'high'], 'high runs before low');
  dH.resolve(ok()); await pH; await tick();
  assert.deepEqual(order, ['block', 'high', 'low']);
  dL.resolve(ok()); await pL;
});

test('FIFO within the same priority', async () => {
  const q = new HelperQueue();
  const order: string[] = [];
  const dB = deferred(), d1 = deferred(), d2 = deferred();
  const pB = q.run('block', 'normal', () => dB.promise as any, { timeoutMs: 5000 });
  const p1 = q.run('a', 'high', () => { order.push('a'); return d1.promise as any; }, { timeoutMs: 5000 });
  const p2 = q.run('b', 'high', () => { order.push('b'); return d2.promise as any; }, { timeoutMs: 5000 });
  await tick();
  dB.resolve(ok()); await pB; await tick();
  d1.resolve(ok()); await p1; await tick();
  assert.deepEqual(order, ['a', 'b']);
  d2.resolve(ok()); await p2;
});

test('bounded capacity rejects excess jobs honestly', async () => {
  const q = new HelperQueue(); q.configure({ capacity: 2 });
  const dB = deferred(), d2 = deferred();
  const pB = q.run('a', 'normal', () => dB.promise as any, { timeoutMs: 5000 }); // active
  const p2 = q.run('b', 'normal', () => d2.promise as any, { timeoutMs: 5000 }); // queued (total 2 = capacity)
  const r3 = await q.run('c', 'normal', () => deferred().promise as any, { timeoutMs: 5000 }); // 3rd → rejected
  assert.equal(r3.status, 'rejected');
  assert.match(r3.reason || '', /full/i);
  dB.resolve(ok()); d2.resolve(ok()); await pB; await p2;
});

test('timeout cancels the job honestly (status=timeout, counter increments)', async () => {
  const q = new HelperQueue();
  const r = await q.run('e', 'low', () => new Promise(() => { /* never resolves */ }) as any, { timeoutMs: 20 });
  assert.equal(r.status, 'timeout');
  assert.equal(q.status().sessionTimedOut, 1);
});

test('manual cancelAll cancels the active job (honest status, no fake completion)', async () => {
  const q = new HelperQueue();
  const p = q.run('e', 'low', (signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) as any, { timeoutMs: 5000 });
  await tick();
  assert.equal(q.status().active, 1);
  q.cancelAll('cancelled');
  const r = await p;
  assert.equal(r.status, 'cancelled');
  assert.equal(q.status().active, 0);
});

test('beginGeneration supersedes an older-generation job (stale work cancelled)', async () => {
  const q = new HelperQueue();
  const p = q.run('e', 'low', () => new Promise(() => {}) as any, { timeoutMs: 5000 }); // generation 1
  await tick();
  q.beginGeneration(); // → generation 2, supersedes gen-1 work
  const r = await p;
  assert.equal(r.status, 'superseded');
});

test('clear() cancels active + queued (used for runtime stop / app quit)', async () => {
  const q = new HelperQueue();
  const dB = deferred();
  const pB = q.run('a', 'normal', (signal) => new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('x')))) as any, { timeoutMs: 5000 });
  const pQ = q.run('b', 'normal', () => deferred().promise as any, { timeoutMs: 5000 });
  await tick();
  q.clear('runtime_stopped');
  const [rB, rQ] = await Promise.all([pB, pQ]);
  assert.equal(rB.status, 'cancelled'); assert.equal(rQ.status, 'cancelled');
  assert.equal(q.status().active, 0); assert.equal(q.status().queued, 0);
});

test('queue status carries NO prompt/response text (only roles/timings/counts)', async () => {
  const q = new HelperQueue();
  const p = q.run('rewrite', 'high', () => Promise.resolve(ok('SECRET RESPONSE TEXT')) as any, { timeoutMs: 5000 });
  await p; await tick();
  const st = q.status();
  const json = JSON.stringify(st);
  assert.ok(!/SECRET RESPONSE TEXT/.test(json), 'response text must never appear in queue status');
  assert.deepEqual(Object.keys(st.lastCompleted || {}).sort(), ['role', 'runMs']); // no text/prompt fields
  assert.equal(st.sessionCompleted, 1);
});
