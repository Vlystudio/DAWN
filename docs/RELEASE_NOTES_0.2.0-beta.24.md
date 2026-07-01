# DAWN — 0.2.0-beta.24 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.23

**Helper job queue + cancellation + warm control** on top of the dedicated helper runtime. The second
llama-server is no longer hit by uncontrolled concurrent requests, stale helper work is cancelled honestly,
and latency-critical helpers are prioritized.

- **Bounded, serialized queue** — one active helper request at a time by default (`maxConcurrency` 1,
  `queueCapacity` 32). Excess jobs are **rejected honestly** ("queue full"), never silently dropped.
- **Priority** — query rewrite + HyDE are **high** (pre-retrieval, latency-critical); entailment is **low**
  (post-answer) so it never starves retrieval; the manual runtime test is lowest.
- **Real cancellation** — every job holds an AbortSignal. Work is cancelled with an **honest status**
  (`cancelled / superseded / timeout / runtime_stopped / app_quitting` — never a fake "failure") when you
  press **Stop**, a **newer request supersedes** an older one (per-turn *generation id*), a request times
  out, the helper runtime **stops/restarts**, or the **app quits**. No orphan helper work continues.
- **Generation IDs** — each chat turn starts a new generation; stale rewrite/HyDE/entailment jobs from a
  previous turn are superseded so they can't modify the current turn's retrieval/trace.
- **Warm control** — `keepWarm` keeps the helper server loaded (memory/CPU for lower latency); off by
  default, it **stops after `idleStopMs` idle**. A runtime is only shown **warm** when actually reachable.
- **Honest provenance + no leakage** — every helper result records provider **and** queue status
  (completed/cancelled/superseded/timeout/skipped); the retrieval trace carries queue timings. Queue status
  is roles/timings/counts **only — never prompt or response text**; helper prompts/outputs are never logged.
  Fallback stays honest (helper_runtime → chat → lexical → skipped) and **main chat is unaffected** if the
  queue/runtime fails.

## Settings (new)
`helperRuntime.{keepWarm(false), idleStopMs(300000), maxConcurrency(1), queueCapacity(32)}`.

## New IPC
`helperRuntime:{queueStatus, cancelJobs, clearQueue}` (+ queue is embedded in `helperRuntime:status`).
Preload `window.dawn.helperRuntime.*`. No duplicate handlers (contract test green).

## UI
**Model Cookbook → Helper runtime** now shows the queue (active/queued/capacity, session done/cancelled/
timeouts, last cancel reason) with **Keep-warm** toggle, **Cancel jobs**, and **Clear queue**. System
Health → Retrieval Helper Models shows live queue metrics.

## Status
- Tests: **389 / 389 pass** (`npm run test:agentos`) — **+8** (one-active-by-default, priority-over-submit
  order, FIFO within priority, capacity rejects, timeout, manual cancel of active job, generation
  supersede, clear-on-stop, and **status carries no prompt/response text**). All beta.23 fallback tests
  still pass.
- `npm run eval:rag`: **green** (exit 0). Build: **green**. TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.24.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`.

## Security
Helpers still only ever see the rewrite/HyDE/entailment prompts DAWN already builds (blocked/skipped/
removed/vault/auth/audit material is excluded upstream). Cancellation aborts the in-flight request (no
orphan client work); runtime stop/restart clears the queue and cannot create duplicate processes. Queue
status/metrics never expose prompt/response/chunk text. Main chat survives helper-queue failure.

## Honest remaining gaps
- Not exercised end-to-end here (no helper model installed) — the queue logic is fully unit-covered with
  mocks; the live path mirrors the proven runtime pattern.
- Cancelling a job aborts the HTTP request; the helper server may finish its current short generation
  server-side, but the client never waits on it and reports the honest status immediately.
- Cross-encoder reranking still not shipped (embedding-similarity remains the honest rerank).

## Install
Overwrite-install over beta.23. See [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md), [MODELS.md](docs/MODELS.md).
