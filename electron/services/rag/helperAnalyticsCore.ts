/**
 * helperAnalyticsCore.ts — pure, local-only, SAFE performance analytics for retrieval helper tasks. It
 * records ONLY safe metadata per job (role / provider / status / queue-wait ms / run ms / short reason /
 * timestamp / generation) — never a prompt, response, retrieved chunk, source text, or file path. Storage
 * is a BOUNDED rolling buffer (no forever-growth) plus derived per-role + global metrics (p50/p95, rates,
 * health labels). Health is never asserted below a minimum sample count ("insufficient data").
 *
 * This is the tested brain; the electron callers (queryExpansion / entailment / helperRuntime.test) feed
 * it outcomes. It is impossible for private text to enter, because record() only reads whitelisted fields.
 */

export type Role = 'query_rewriter' | 'hyde_generator' | 'entailment_verifier' | 'reranker' | 'test';
export type Provider = 'helper_runtime' | 'chat' | 'lexical' | 'embedding_similarity' | 'none';
export type Status =
  | 'completed' | 'cancelled' | 'superseded' | 'timeout' | 'runtime_stopped' | 'app_quitting'
  | 'unavailable' | 'fallback_used' | 'failed' | 'skipped';

export interface SafeEvent {
  ts: number; role: Role; provider: Provider; status: Status;
  queueWaitMs: number; runMs: number; totalLatencyMs: number;
  reason?: string; generation?: number;
}
export type HealthLabel = 'healthy' | 'slow' | 'timeout_prone' | 'mostly_unavailable' | 'insufficient_data';

export interface RoleMetrics {
  role: Role; jobs: number;
  completed: number; cancelled: number; superseded: number; timeout: number; failed: number; unavailableOrSkipped: number; fallback: number;
  successRate: number; timeoutRate: number; cancelRate: number;
  p50QueueMs: number; p95QueueMs: number; p50RunMs: number; p95RunMs: number; p50TotalMs: number; p95TotalMs: number;
  avgQueueMs: number; avgRunMs: number; avgTotalMs: number;
  lastStatus: Status | null; lastProvider: Provider | null; lastFallbackReason: string | null; lastCancelReason: string | null;
  lastCompletedAt: number | null; lastFailedAt: number | null;
  health: HealthLabel;
}
export interface GlobalMetrics {
  totalJobs: number; totalCompleted: number; totalCancelled: number; totalTimeouts: number;
  slowestRole: Role | null; slowestP95Ms: number;
  timeoutProneRole: Role | null; timeoutProneRate: number;
  health: HealthLabel; lastIssue: string | null;
}

const MIN_SAMPLE = 8;      // below this → "insufficient data"
const SLOW_P95_MS = 4000;  // p95 total latency above this → slow
const TIMEOUT_RATE = 0.2;  // timeout fraction above this → timeout-prone
const UNAVAIL_RATE = 0.5;  // unavailable/skipped fraction above this → mostly unavailable
export const SCHEMA_VERSION = 1;

const ALL_ROLES: Role[] = ['query_rewriter', 'hyde_generator', 'entailment_verifier', 'reranker', 'test'];

function pct(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((p / 100) * sortedAsc.length)));
  return sortedAsc[idx];
}
function avg(xs: number[]): number { return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0; }
function r2(x: number): number { return Math.round(x * 100) / 100; }

export class HelperAnalytics {
  capacity: number;
  private events: SafeEvent[] = [];
  sessionStart = Date.now();
  constructor(capacity = 500) { this.capacity = Math.max(50, capacity); }

  /** Record ONE outcome. Only whitelisted, safe fields are stored (no prompt/response/chunk/path). */
  record(e: { role: Role; provider: Provider; status: Status; queueWaitMs?: number; runMs?: number; reason?: string; generation?: number }): SafeEvent {
    const queueWaitMs = Math.max(0, Math.round(Number(e.queueWaitMs) || 0));
    const runMs = Math.max(0, Math.round(Number(e.runMs) || 0));
    const ev: SafeEvent = {
      ts: Date.now(), role: e.role, provider: e.provider, status: e.status,
      queueWaitMs, runMs, totalLatencyMs: queueWaitMs + runMs,
      reason: e.reason ? String(e.reason).slice(0, 80) : undefined, // short, safe reason string only
      generation: typeof e.generation === 'number' ? e.generation : undefined,
    };
    this.events.push(ev);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity); // rolling
    return ev;
  }

  reset() { this.events = []; this.sessionStart = Date.now(); }
  size() { return this.events.length; }

  private forRole(role: Role): SafeEvent[] { return this.events.filter((e) => e.role === role); }

  roleMetrics(role: Role): RoleMetrics {
    const evs = this.forRole(role);
    const jobs = evs.length;
    const by = (s: Status) => evs.filter((e) => e.status === s).length;
    const completed = by('completed');
    const cancelled = by('cancelled') + by('runtime_stopped') + by('app_quitting');
    const superseded = by('superseded');
    const timeout = by('timeout');
    const failed = by('failed');
    const unavailableOrSkipped = by('unavailable') + by('skipped');
    const fallback = by('fallback_used');
    const successful = completed + fallback; // fallback that produced a result counts as a success
    const q = evs.map((e) => e.queueWaitMs).sort((a, b) => a - b);
    const run = evs.map((e) => e.runMs).sort((a, b) => a - b);
    const tot = evs.map((e) => e.totalLatencyMs).sort((a, b) => a - b);
    const last = evs[evs.length - 1] || null;
    const lastCompleted = [...evs].reverse().find((e) => e.status === 'completed' || e.status === 'fallback_used');
    const lastFailed = [...evs].reverse().find((e) => e.status === 'failed' || e.status === 'timeout');
    const lastFallback = [...evs].reverse().find((e) => e.provider === 'chat' || e.provider === 'lexical');
    const lastCancel = [...evs].reverse().find((e) => e.status === 'cancelled' || e.status === 'superseded');
    return {
      role, jobs, completed, cancelled, superseded, timeout, failed, unavailableOrSkipped, fallback,
      successRate: jobs ? r2(successful / jobs) : 0,
      timeoutRate: jobs ? r2(timeout / jobs) : 0,
      cancelRate: jobs ? r2((cancelled + superseded) / jobs) : 0,
      p50QueueMs: pct(q, 50), p95QueueMs: pct(q, 95), p50RunMs: pct(run, 50), p95RunMs: pct(run, 95), p50TotalMs: pct(tot, 50), p95TotalMs: pct(tot, 95),
      avgQueueMs: avg(q), avgRunMs: avg(run), avgTotalMs: avg(tot),
      lastStatus: last ? last.status : null, lastProvider: last ? last.provider : null,
      lastFallbackReason: lastFallback?.reason || null, lastCancelReason: lastCancel?.reason || null,
      lastCompletedAt: lastCompleted?.ts || null, lastFailedAt: lastFailed?.ts || null,
      health: this.health(role, jobs, timeout, unavailableOrSkipped, pct(tot, 95)),
    };
  }

  private health(role: Role, jobs: number, timeout: number, unavail: number, p95Total: number): HealthLabel {
    if (jobs < MIN_SAMPLE) return 'insufficient_data';
    if (unavail / jobs > UNAVAIL_RATE) return 'mostly_unavailable';
    if (timeout / jobs > TIMEOUT_RATE) return 'timeout_prone';
    if (p95Total > SLOW_P95_MS) return 'slow';
    return 'healthy';
  }

  roles(): RoleMetrics[] {
    const present = ALL_ROLES.filter((r) => this.forRole(r).length > 0);
    return present.map((r) => this.roleMetrics(r));
  }

  global(): GlobalMetrics {
    const roles = this.roles();
    const totalJobs = this.events.length;
    const totalCompleted = this.events.filter((e) => e.status === 'completed').length;
    const totalCancelled = this.events.filter((e) => e.status === 'cancelled' || e.status === 'superseded').length;
    const totalTimeouts = this.events.filter((e) => e.status === 'timeout').length;
    const withData = roles.filter((r) => r.jobs >= MIN_SAMPLE);
    const slowest = withData.slice().sort((a, b) => b.p95TotalMs - a.p95TotalMs)[0] || null;
    const toProne = withData.slice().sort((a, b) => b.timeoutRate - a.timeoutRate)[0] || null;
    // overall health = worst meaningful role health, else insufficient
    const order: HealthLabel[] = ['mostly_unavailable', 'timeout_prone', 'slow', 'healthy'];
    let health: HealthLabel = 'insufficient_data';
    for (const label of order) if (withData.some((r) => r.health === label)) { health = label; break; }
    const lastIssueEv = [...this.events].reverse().find((e) => e.status === 'timeout' || e.status === 'failed' || e.status === 'unavailable');
    const lastIssue = lastIssueEv ? `${lastIssueEv.role}: ${lastIssueEv.status}${lastIssueEv.reason ? ' (' + lastIssueEv.reason + ')' : ''}` : null;
    return {
      totalJobs, totalCompleted, totalCancelled, totalTimeouts,
      slowestRole: slowest ? slowest.role : null, slowestP95Ms: slowest ? slowest.p95TotalMs : 0,
      timeoutProneRole: toProne && toProne.timeoutRate > 0 ? toProne.role : null, timeoutProneRate: toProne ? toProne.timeoutRate : 0,
      health, lastIssue,
    };
  }

  /** Advisory-only hints (never auto-routing). Honest about insufficient data. */
  hints(): string[] {
    const out: string[] = [];
    for (const r of this.roles()) {
      if (r.jobs < MIN_SAMPLE) continue;
      if (r.health === 'slow') out.push(`${label(r.role)} helper is slow: p95 ${r.p95TotalMs} ms over ${r.jobs} samples.`);
      if (r.health === 'timeout_prone') out.push(`${label(r.role)} is timeout-prone (${Math.round(r.timeoutRate * 100)}% over ${r.jobs} samples)${r.role === 'entailment_verifier' ? '; lexical fallback may be faster' : ''}.`);
      if (r.health === 'mostly_unavailable') out.push(`${label(r.role)} is mostly unavailable (${r.unavailableOrSkipped}/${r.jobs}).`);
    }
    if (!out.length) out.push('Not enough data yet to recommend routing changes.');
    return out;
  }

  recent(n = 10): SafeEvent[] { return this.events.slice(-Math.max(1, n)).reverse(); }

  /** A fully SAFE snapshot for export/IPC (no private content can exist here by construction). */
  snapshot(appVersion?: string) {
    return {
      schemaVersion: SCHEMA_VERSION, appVersion: appVersion || undefined,
      sessionStart: this.sessionStart, capacity: this.capacity, size: this.events.length,
      global: this.global(), roles: this.roles(), hints: this.hints(), recent: this.recent(10),
    };
  }
}

function label(role: Role): string {
  return role === 'query_rewriter' ? 'Query rewrite' : role === 'hyde_generator' ? 'HyDE'
    : role === 'entailment_verifier' ? 'Entailment' : role === 'reranker' ? 'Reranker' : 'Test';
}

/** Map a routing outcome (provider + ok + optional queue status) to the analytics Status vocabulary. */
export function statusFor(provider: Provider, ok: boolean, queueStatus?: string): Status {
  if (provider === 'none') return 'unavailable';
  if (provider === 'lexical') return 'fallback_used';
  if (provider === 'chat') return ok ? 'fallback_used' : 'failed';
  // helper_runtime
  if (queueStatus === 'cancelled') return 'cancelled';
  if (queueStatus === 'superseded') return 'superseded';
  if (queueStatus === 'timeout') return 'timeout';
  if (queueStatus === 'rejected') return 'failed';
  return ok ? 'completed' : 'failed';
}

const helperAnalytics = new HelperAnalytics(500);
export default helperAnalytics;
