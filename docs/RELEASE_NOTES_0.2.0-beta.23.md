# DAWN — 0.2.0-beta.23 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.22

**Dedicated helper runtime** — DAWN can now run a **second local `llama-server`** dedicated to retrieval
helper tasks (query rewrite / HyDE / entailment), separate from the chat model. This removes the beta.22
limitation (helpers had to share the one chat runtime) **honestly** — no fake concurrency.

- **Real second process.** `helperRuntime` spawns a bundled `llama-server.exe` on its own port (default
  8090), **CPU by default** so it doesn't take VRAM from the chat model, with startup + request timeouts,
  crash detection, port-conflict handling, and duplicate-process guards.
- **Honest status.** It only reports **running/reachable** when `/health` returns 200 — never a fake
  "running". If disabled, unconfigured, starting, or crashed, helper tasks fall back **honestly** and the
  main chat keeps working regardless.
- **Clear provenance.** Every helper result records where it ran: **helper_runtime → chat → lexical
  (entailment) → skipped**. The retrieval trace + grounding detail + System Health all show it.
- **Reranking is unaffected** — embedding-similarity/heuristic (not generative), so it doesn't use the
  helper runtime and is never presented as a cross-encoder.
- **Configure it** in **Model Cookbook → Helper runtime**: enable, pick a small helper `.gguf`,
  start/stop/restart, and **Test** (a tiny live request → latency + provider + model). Per-role provider
  status is shown live.

## Settings (new)
`helperRuntime.{enabled, modelPath, port, contextSize, threads, gpuLayers, batchSize, startupTimeoutMs,
requestTimeoutMs, autoStart}` — the **process**. Distinct from beta.22's `helperModels.*` — the **roles**.

## Security
The helper runtime is local-only (127.0.0.1), sees only the rewrite/HyDE/entailment prompts DAWN already
builds, and **never** touches blocked/skipped/removed/vault/auth/audit material. Its request client
**never logs prompts or responses** (no private retrieved content in logs/diagnostics). Helper output
stays untrusted — never cited, never triggers tools. Knowledge-safety guards are unchanged.

## Status
- Tests: **381 / 381 pass** (`npm run test:agentos`) — +2 (dedicated-runtime routing: used only when
  reachable; honest fallbacks task-off/none/lexical).
- `npm run eval:rag`: **green** (exit 0, hit-rate 1.0, negatives 0).
- Build: **green**. TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.23.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`.

## New IPC
`helperRuntime:{status, start, stop, restart, test, updateSettings, pickModel}` (preload
`window.dawn.helperRuntime.*`). No duplicate handlers (contract test green). Auto-start on boot +
graceful stop on quit are wired.

## Honest remaining gaps
- The helper runtime is **not exercised end-to-end in this environment** (no helper model installed) — the
  default state is the honest "disabled/fallback" path; the process/health/timeout logic is unit-covered
  via the pure resolver and modeled on the proven chat-runtime pattern.
- Loading a helper model with GPU layers would still share the GPU — CPU is the safe default; the user
  chooses.
- Next: model warm-pooling, a helper job queue + cancellation, and a GGUF **reranking** server
  (`--reranking`) for a real cross-encoder.

## Install
Overwrite-install over beta.22. See [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md), [MODELS.md](docs/MODELS.md).
