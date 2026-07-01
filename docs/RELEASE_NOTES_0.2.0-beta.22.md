# DAWN — 0.2.0-beta.22 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.21

**A better knowledge *foundation*, not just a better answer layer.** This release improves how documents
are chunked, lets you upgrade old indexes, compares retrieval strategies, adds helper-model slots, and is
honest about cross-encoder reranking.

- **Chunking v2 (title/heading-aware)** — indexing now produces **heading-aware** Markdown sections with a
  **section-path** breadcrumb + parent heading, paragraph-aware grouping, **code blocks preserved** whole,
  block-level overlap, and **real** start/end line numbers + char/token estimates. It never invents pages,
  headings, or line numbers. Old (v1) chunks keep NULLs and still read fine.
- **Reindex to v2** — Local Knowledge → Retrieval quality shows how many sources are on old chunking and a
  **Reindex** button; it re-applies the safety guard per source (missing/now-blocked files skipped, old
  index removed) and upgrades `chunk_strategy`.
- **Retrieval strategy comparison** — the eval now compares strategies. Offline, only **keyword** is
  actually computed; **vector / hybrid / rewrite / HyDE / rerank** are marked **unavailable** with a real
  reason — never a fabricated win. Best available strategy highlighted.
- **Helper model slots** — Model Cookbook roles + settings for **query rewrite / HyDE / entailment /
  reranker**. **Honest constraint:** DAWN runs one model at a time, so a configured helper is used directly
  only when it *is* the loaded model; otherwise it falls back to the chat model (or skips). A dedicated
  helper runtime is a future loop — not faked.
- **Cross-encoder reranker status** — reported honestly as **NEEDS SETUP** (`onnxruntime-node` is too
  heavy/brittle to bundle; a GGUF reranker via a second `llama-server --reranking` instance is the real
  future path). The real local rerank today is **embedding-similarity**.

## Honesty guarantees
No faked chunking metadata (real headings/lines only), no faked strategy wins, no faked cross-encoder, no
faked helper concurrency. Reindex re-applies knowledge-safety; retrieval still excludes skipped/removed and
never touches vault/auth/audit; citations, diagnostics redaction, and answer verification are unchanged.

## Status
- Tests: **379 / 379 pass** (`npm run test:agentos`) — +5 (chunkV2 heading/code/plain + needsReindex,
  strategy-comparison honesty, helper single-runtime resolution).
- `npm run eval:rag`: **green** (hit-rate 1.0, negatives 0) — now also emits the strategy table.
- Build: **green**. TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.22.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck`
  has pre-existing `SharedArrayBuffer` lib noise unrelated to this work.

## Migrations
`knowledge_chunks`: +`chunk_title, parent_heading, section_path, start_line, end_line, chunk_strategy`.
`knowledge_sources`: +`chunk_strategy`. Old rows read fine (NULLs); reindex upgrades them.

## Honest remaining gaps
- Helper models can't run **concurrently** with the chat model (single llama-server) — a dedicated helper
  runtime is future work.
- No **cross-encoder** reranker ships (NEEDS SETUP); embedding-similarity is the strongest honest rerank.
- Strategy comparison's vector/hybrid rows need a **live embedded index** to be computed (offline fixture
  is keyword-only).
- Real Vision Chat analysis still unexercised (no VLM installed).
- OCR-on-upload still unavailable.

## Install
Overwrite-install over beta.21. See [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md), [EVALS.md](EVALS.md),
[MODELS.md](MODELS.md).
