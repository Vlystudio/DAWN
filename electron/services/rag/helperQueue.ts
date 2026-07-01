/**
 * helperQueue.ts — a bounded, priority job queue for HELPER RUNTIME requests (query rewrite / HyDE /
 * entailment / test). Pure Node (no electron imports) so its real async behaviour is unit-tested with
 * mocks. It serializes helper work (ONE active request by default) so the single helper llama-server is
 * never hammered, cancels stale work when a newer chat request supersedes it or the user stops, enforces
 * per-job timeouts, and exposes HONEST status. It stores NO prompt/response text — only roles, timings,
 * counts, and statuses — so nothing private can leak through queue metadata.
 */
import { randomUUID } from 'crypto';

export type Priority = 'high' | 'normal' | 'low' | 'test';
const RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2, test: 3 };

export type JobStatus = 'completed' | 'cancelled' | 'superseded' | 'timeout' | 'rejected';
export type CancelReason = 'cancelled' | 'superseded' | 'timeout' | 'runtime_stopped' | 'app_quitting' | 'cleared';

export interface QueueResult { ok: boolean; text?: string; status: JobStatus; reason?: string; queueWaitMs: number; runMs: number }
/** The actual work: receives an AbortSignal it MUST honour, returns an honest {ok,text?,reason?}. */
export type HelperFn = (signal: AbortSignal) => Promise<{ ok: boolean; text?: string; reason?: string }>;

interface Job {
  id: string; role: string; priority: Priority; generation: number; seq: number; enqueuedAt: number;
  fn: HelperFn; timeoutMs: number; resolve: (r: QueueResult) => void;
  abort: AbortController; startedAt: number; timer: any;
}

export interface QueueStatus {
  active: number; queued: number; capacity: number; maxConcurrency: number;
  oldestQueuedAgeMs: number; generation: number;
  sessionCompleted: number; sessionCancelled: number; sessionTimedOut: number;
  lastCompleted: { role: string; runMs: number } | null;
  lastCancelled: { role: string; reason: string } | null;
}

class HelperQueue {
  capacity = 32;
  maxConcurrency = 1;
  private queued: Job[] = [];
  private active: Job[] = [];
  private seq = 0;
  generation = 1;
  sessionCompleted = 0; sessionCancelled = 0; sessionTimedOut = 0;
  private lastCompleted: { role: string; runMs: number } | null = null;
  private lastCancelled: { role: string; reason: string } | null = null;

  configure(c: { capacity?: number; maxConcurrency?: number }) {
    if (c.capacity && c.capacity > 0) this.capacity = Math.max(1, Math.floor(c.capacity));
    if (c.maxConcurrency && c.maxConcurrency > 0) this.maxConcurrency = Math.max(1, Math.floor(c.maxConcurrency));
  }

  /** Start a new request generation and supersede any older-generation jobs (queued + active). */
  beginGeneration(): number { this.generation++; this.supersedeOlder(); return this.generation; }

  private supersedeOlder() {
    for (const j of [...this.queued]) if (j.generation < this.generation) this.finish(j, 'superseded', 'newer request');
    for (const j of [...this.active]) if (j.generation < this.generation) this.abortJob(j, 'superseded');
  }

  /** Submit a helper job. Resolves with an honest QueueResult (never throws). */
  run(role: string, priority: Priority, fn: HelperFn, opts: { timeoutMs: number; generation?: number }): Promise<QueueResult> {
    return new Promise<QueueResult>((resolve) => {
      if (this.queued.length + this.active.length >= this.capacity) {
        resolve({ ok: false, status: 'rejected', reason: 'helper queue full', queueWaitMs: 0, runMs: 0 });
        return;
      }
      const job: Job = {
        id: randomUUID(), role, priority, generation: opts.generation ?? this.generation, seq: this.seq++,
        enqueuedAt: Date.now(), fn, timeoutMs: opts.timeoutMs, resolve, abort: new AbortController(), startedAt: 0, timer: null,
      };
      this.queued.push(job);
      this.pump();
    });
  }

  private nextJob(): Job | null {
    if (!this.queued.length) return null;
    this.queued.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq);
    return this.queued[0];
  }

  private pump() {
    while (this.active.length < this.maxConcurrency) {
      const job = this.nextJob();
      if (!job) break;
      this.queued = this.queued.filter((j) => j !== job);
      this.active.push(job);
      job.startedAt = Date.now();
      job.timer = setTimeout(() => this.abortJob(job, 'timeout'), Math.max(1, job.timeoutMs));
      job.fn(job.abort.signal).then(
        (r) => { if (job.abort.signal.aborted) return; this.finish(job, r.ok ? 'completed' : 'cancelled', r.ok ? undefined : (r.reason || 'failed'), r.text); },
        () => { if (job.abort.signal.aborted) return; this.finish(job, 'cancelled', 'error'); },
      );
    }
  }

  private abortJob(job: Job, reason: CancelReason) {
    const status: JobStatus = reason === 'timeout' ? 'timeout' : reason === 'superseded' ? 'superseded' : 'cancelled';
    try { job.abort.abort(); } catch { /* */ }
    this.finish(job, status, reason);
  }

  private finish(job: Job, status: JobStatus, reason?: string, text?: string) {
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    const wasKnown = this.queued.includes(job) || this.active.includes(job);
    this.queued = this.queued.filter((j) => j !== job);
    this.active = this.active.filter((j) => j !== job);
    if (!wasKnown) return; // already finished (guards double-resolve on abort race)
    const now = Date.now();
    const queueWaitMs = (job.startedAt || now) - job.enqueuedAt;
    const runMs = job.startedAt ? now - job.startedAt : 0;
    if (status === 'completed') { this.sessionCompleted++; this.lastCompleted = { role: job.role, runMs }; }
    else if (status === 'timeout') { this.sessionTimedOut++; this.lastCancelled = { role: job.role, reason: reason || 'timeout' }; }
    else { this.sessionCancelled++; this.lastCancelled = { role: job.role, reason: reason || status }; }
    job.resolve({ ok: status === 'completed', text, status, reason, queueWaitMs, runMs });
    this.pump();
  }

  /** Cancel everything (queued + active) with an honest reason (chat stop / runtime stop / quit). */
  cancelAll(reason: CancelReason = 'cancelled') { for (const j of [...this.active, ...this.queued]) this.abortJob(j, reason); }
  clear(reason: CancelReason = 'cleared') { this.cancelAll(reason); }

  status(now = Date.now()): QueueStatus {
    const oldest = this.queued.reduce((m, j) => Math.min(m, j.enqueuedAt), Infinity);
    return {
      active: this.active.length, queued: this.queued.length, capacity: this.capacity, maxConcurrency: this.maxConcurrency,
      oldestQueuedAgeMs: this.queued.length ? now - oldest : 0, generation: this.generation,
      sessionCompleted: this.sessionCompleted, sessionCancelled: this.sessionCancelled, sessionTimedOut: this.sessionTimedOut,
      lastCompleted: this.lastCompleted, lastCancelled: this.lastCancelled,
    };
  }
}

const helperQueue = new HelperQueue();
export default helperQueue;
export { HelperQueue };
