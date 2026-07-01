# DAWN — 0.2.0-beta.27 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.26

**Real local GGUF reranker (cross-encoder path)** — DAWN can now rerank retrieved candidates with a genuine
local cross-encoder: a **dedicated `llama-server` started with `--reranking`** serving a GGUF reranker model
(e.g. `bge-reranker-v2-m3`) via its `/rerank` endpoint. **Optional, off by default, honest, and local-only.**

- **Provider model, honest by construction.** Model Cookbook → **Reranker** picks the provider:
  `embedding_similarity` (the **ready default** — real local cosine re-order), `heuristic` (hybrid RRF order),
  `disabled`, or `gguf_reranker` (the real cross-encoder). Status carries provider id + display name + ready +
  status label + **specific unavailable reason** + score type/semantics + redacted model summary + local
  endpoint + last test result/latency + redacted last error + fallback provider.
- **Real capability detection.** `gguf_reranker` is only **READY** when the runtime is installed, the model
  exists, the server is reachable, **and** a synthetic `/rerank` probe returned a well-formed relevance score.
  Reachability is never treated as support. Otherwise the reason is specific: `runtime_missing` /
  `model_missing` / `runtime_not_ready` / `runtime_unsupported` (build has no `--reranking`) /
  `api_not_supported` (endpoint 404/501) / `server_error` / `timeout` / `needs_setup`.
- **Honest fallback.** When the GGUF reranker is unavailable, times out, or is superseded by a newer chat
  turn, DAWN falls back to embedding-similarity (else hybrid order) and records the reason in the trace. It
  **never fabricates cross-encoder scores** and never labels embedding similarity as a cross-encoder.
- **Score semantics stated.** GGUF = `reranker_relevance` / **`relative`** (a real signal, *not* a calibrated
  probability); embedding = `cosine_similarity` / `relative`.
- **Dedicated runtime + queue.** Its own port (default **8091**), start/stop/restart/status/test, startup +
  request timeouts, crash detection, free-port conflict handling, duplicate-process guard, graceful shutdown,
  app-quit cleanup, optional keep-warm / idle-stop. Its **own** bounded serialized queue (cap 16, 1 at a
  time) with cancellation, per-job timeout, and generation-aware supersede — so it never fights the chat or
  helper runtimes.
- **Safe rerank client.** Sends query + candidate text ONLY to `127.0.0.1:<port>`; enforces `topKInput` (30)
  and `maxCandidateChars` (4000); handles timeout / cancellation / malformed body / missing score / index
  out-of-range / score-array length mismatch honestly. Returns ids + numeric scores only.
- **Pipeline.** hybrid retrieval → safety filtering (blocked/skipped/removed + vault/auth/audit excluded,
  unchanged) → top `topKInput` safe candidates → rerank → `topKOutput` (8). Index never mutated; all chunk
  metadata + citations preserved.
- **Optional adaptive fallback.** The existing adaptive-routing machine gained a `reranker` role: when
  adaptive routing is ON, a measurably slow / timeout-prone / failure-prone GGUF reranker is steered to
  embedding-similarity (reversible, transparent). Off by default (adaptive routing is off by default).

## Settings (new)
`reranker.provider` (`embedding_similarity`), `reranker.gguf.{enabled(false), modelPath, port(8091),
contextSize(4096), threads(0), gpuLayers(0), batchSize(0), startupTimeoutMs(60000), requestTimeoutMs(10000),
autoStart(false), keepWarm(false), idleStopMs(300000), topKInput(30), topKOutput(8), maxCandidateChars(4000),
queueCapacity(16), maxConcurrency(1)}`. Also `helperModels.adaptiveRouting.applyToReranker(true)`.
**Defaults preserve prior behavior:** `rerankerEnabled=false` → no rerank stage (hybrid order kept), GGUF off.

## New IPC
`reranker:{status, start, stop, restart, test, updateSettings, queueStatus, cancelJobs, clearQueue,
pickModel}` (+ the existing `rag:rerankerStatus` now enriched). Preload `window.dawn.reranker.*`. No duplicate
handlers (contract test green). All responses are safe/redacted.

## Retrieval trace (new, safe)
`rerankerProvider`, `rerankerSelected`, `rerankerStatus`, `rerankerUnavailableReason`,
`rerankerFallbackProvider`, `rerankerUsedFallback`, `rerankerQueueWaitMs`, `rerankerRunMs`,
`rerankerInputCount`, `rerankerOutputCount`, `rerankerCancelled`, `rerankerTimeout`, `rerankerScoresSummary`
(min/max/mean, numbers only), `rerankerCandidates[]` (chunkId + originalRank + rerankedRank + score +
scoreType + provider), `rerankerAdaptive`. **No query text, chunk text, source text, or full paths.**

## UI
- Model Cookbook → **Reranker** panel: provider select, GGUF enable + model pick, start/stop/restart, **Test
  reranker** (synthetic public text only), endpoint-supported status, port, queue + cancel/clear, keep-warm,
  last error (redacted), topK in→out.
- Retrieval Panel: reranker provider + ready / unavailable reason + fallback.
- Chat retrieval trace: reranker provider + input→output + run ms + (GGUF) per-candidate rank changes.
- System Health (Hybrid Retrieval): honest reranker provider line + unavailable reason + fallback.

## Status
- Tests: **437 / 437 pass** (`npm run test:agentos`) — **+30** (provider status incl. every unavailable
  reason; default stays embedding_similarity; plan default stays disabled; GGUF ready→relevance; honest
  fallback + reason; topKInput/maxCandidateChars enforced; malformed / length-mismatch / missing-score /
  out-of-range / non-numeric handled; no fake scores when unavailable; scoresSummary numeric-only; queue
  bounded/one-active/cancel/timeout/clear; adaptive reranker role routes away on slow; IPC channels wired).
- `npm run eval:rag`: **green** (hit-rate 1, groundedness 0.569, negatives leaked 0 — no regression). Build:
  **green**. TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.27.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`.

## Security / privacy
Local-only (`127.0.0.1`), no cloud. Blocked/skipped/removed + vault/auth/audit sources are excluded upstream
before reranking (unchanged). No prompt/query/chunk/source text in logs, analytics, queue status, IPC, trace
summaries, or export — only ids + numeric scores + safe timings. Full local paths are redacted to basenames.
Fallback is honest; no fake cross-encoder scores. Main chat and the helper runtime keep working if the
reranker fails. App quit stops the reranker process and clears its queue.

## Honest limitations
- **Not exercised end-to-end here** (no GGUF reranker model installed): the decision / capability / scoring /
  queue logic is fully unit-covered, and the runtime mirrors the proven helper-runtime spawn/health/shutdown
  patterns; live cross-encoder behavior appears once a reranker model is configured + started.
- Requires a llama-server build that supports `--reranking` **and** a reranker (rank-head) GGUF model. If the
  build lacks the flag or the endpoint, DAWN reports `unavailable_runtime_unsupported` /
  `unavailable_api_not_supported` honestly and falls back.
- GGUF relevance scores are `relative`, not calibrated across queries.
- Reranker analytics are session-based (in memory), consistent with the helper analytics.

## Install
Overwrite-install over beta.26. See [MODELS.md](MODELS.md), [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md),
[EVALS.md](EVALS.md).
