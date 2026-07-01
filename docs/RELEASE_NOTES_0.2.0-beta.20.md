# DAWN — 0.2.0-beta.20 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.19

**The SOTA-for-local retrieval upgrade: hybrid retrieval + answer verification + a real eval harness.**
DAWN's advantage is private, grounded, honest local answers — this makes retrieval measurably better
and self-verifying.

### Hybrid retrieval (real keyword + vector)
- Retrieval is now **hybrid**: **vector** (local `nomic-embed-text` cosine, where present) + a real
  **BM25 keyword** signal over chunk text, fused with **reciprocal-rank fusion**. Deduped, title-boosted,
  stale-penalized, normalized `[0,1]`.
- It only searches **safe** sources (skipped/removed excluded; **stale kept + flagged**) and reports its
  mode honestly per query: **hybrid / vector / keyword / unavailable**. This also **fixes** the old
  "keyword fallback" label that previously did nothing — keyword search is now real.

### Answer verification (groundedness)
- After a RAG answer, DAWN checks each claim against the retrieved chunks and labels it **supported /
  partially / unsupported / not-enough-evidence**, with a groundedness score. A grounding summary
  appears under the answer, expandable to per-claim detail (source **name** only).
- Conservative + honest: it **never fabricates support**, flags what it can't verify, and treats
  retrieved text as data only (injection text is scored, never obeyed). The summary carries **no chunk
  text, path, or secret**.

### RAG eval harness (measure it)
- `npm run eval:rag` — a **deterministic, offline** harness (no model/index/network) scores a fixed set
  (`evals/rag-eval.json`) with the shipped retrieval + groundedness cores: retrieval hit-rate, top-1,
  keyword coverage, groundedness, unsupported-rate, **negatives-leaked**. Missing expectations →
  **INVALID** (not a silent pass). Verified run: **hit-rate 1.0**, negatives leaked **0**, and the
  no-evidence case honestly scores **groundedness 0 / mode unavailable**.

### Honest scaffolding (not faked)
- **Reranker**: settings + a Model Cookbook `reranker` role, but with none configured (default) DAWN
  labels ranking as **heuristic hybrid (RRF + title boost)** — it never claims cross-encoder reranking.
- **Query rewriting / HyDE**: settings exist (default **off**); reported honestly as optional/not-wired
  rather than pretended.

## Status
- Tests: **367 / 367 pass** (`npm run test:agentos`) — +9 (fusion, real keyword fallback, dedupe/stale,
  BM25/RRF, grounded/unsupported/no-evidence, injection-only-scored, eval valid/invalid/negatives).
- `npm run eval:rag`: **green** (real metrics, negatives-leaked 0).
- Build: **green**. TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.20.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`. Renderer
  `typecheck` has pre-existing `SharedArrayBuffer` lib noise unrelated to this work.

## New System Health areas
Hybrid Retrieval, Answer Verification, RAG Eval Harness — each honest (COMPLETE only when the real path
works; the eval area shows "not run in this install" since `evals/` isn't bundled).

## Honest remaining gaps
- Query-rewrite/HyDE and a cross-encoder reranker are **settings + status only** — the model-wired
  versions are a future loop.
- Groundedness is **lexical overlap** (a signal, not a verdict); an optional local-model entailment
  check would raise precision.

## Install
Overwrite-install over beta.19. All earlier fixes carry forward. See [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md),
[ANSWER_VERIFICATION.md](ANSWER_VERIFICATION.md), [EVALS.md](EVALS.md).
