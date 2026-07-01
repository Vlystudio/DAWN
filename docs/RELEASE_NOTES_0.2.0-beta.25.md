# DAWN — 0.2.0-beta.25 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.24

**Per-role helper latency analytics + performance dashboard.** DAWN now measures how the helper runtime
actually performs — safely, locally, and honestly — and shows it in the UI. This is evidence for future
adaptive routing; it does **not** auto-change routing yet.

- **Safe metadata only.** Each helper job records: role · provider (helper_runtime / chat / lexical /
  none) · status (completed / cancelled / superseded / timeout / runtime_stopped / app_quitting /
  unavailable / fallback_used / failed / skipped) · queue-wait ms · run ms · a short safe reason ·
  timestamp · generation id. **Never** a prompt, response, retrieved chunk, source text, or file path —
  it's impossible by construction (the recorder only reads whitelisted fields; a test asserts no private
  text can appear in the snapshot/export).
- **Bounded rolling buffer** (most recent 500) — no unbounded growth. Session-only (in memory).
- **Per-role metrics** — jobs, success/timeout/cancel rates, **p50/p95** queue-wait, run, and total
  latency, averages, last status, and a **health label**: `healthy · slow · timeout-prone ·
  mostly-unavailable · insufficient-data`. A role stays **insufficient-data** until ≥8 samples — never
  labelled unhealthy on a tiny sample.
- **Global** — slowest role by p95, most timeout-prone role, session totals, and advisory **hints**
  (e.g. "Query rewrite helper is slow: p95 4200 ms over 25 samples"). Advisory only — no auto-routing.
- **Dashboard** in Model Cookbook → Helper runtime → **Performance**: health, per-role table, last 10
  safe events, **Reset session** + **Export JSON (safe)**. System Health → Retrieval Helper Models shows
  the performance summary + last issue.

## Recording points
Wired into query rewrite, HyDE, entailment (every outcome incl. helper-runtime disabled/unavailable,
chat fallback, lexical fallback, skipped) and the runtime **Test**. Recording is best-effort and
swallowed on error — it can never break retrieval or main chat.

## New IPC
`helperRuntime:{analytics, resetAnalytics, exportAnalytics}` (+ a lightweight global summary embedded in
`helperRuntime:status`). Preload `window.dawn.helperRuntime.*`. No duplicate handlers (contract test green).
Export writes a **safe** JSON via a save dialog (no private content).

## Status
- Tests: **397 / 397 pass** (`npm run test:agentos`) — **+8** (records safe fields only / no private text,
  every outcome type, rolling truncation, p50/p95, insufficient-data + slow + timeout-prone +
  mostly-unavailable health, reset, statusFor mapping). All prior tests still pass.
- `npm run eval:rag`: **green** (exit 0). Build: **green**. TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.25.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`.

## Security / privacy
No prompts, responses, retrieved chunks, source contents, or full paths are ever recorded, shown, or
exported. Metrics are local-only (no network, no telemetry) and bounded. Upstream retrieval safety
(blocked/skipped/removed/vault/auth/audit exclusion) is unchanged; the helper queue's cancellation of
stale work is unchanged; main chat is unaffected if analytics recording fails.

## Honest limitations
- Analytics are **session-only** (in memory) — cross-session history is a future loop.
- Not exercised end-to-end here (no helper model installed); the analytics core is fully unit-covered and
  fed by the real recording points.
- Hints are **advisory** — no automatic routing changes in this build.

## Install
Overwrite-install over beta.24. See [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md), [MODELS.md](docs/MODELS.md).
