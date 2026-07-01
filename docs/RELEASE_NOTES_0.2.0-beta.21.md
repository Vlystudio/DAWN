# DAWN — 0.2.0-beta.21 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.20

**Retrieval quality, wired for real.** beta.20 shipped hybrid retrieval + lexical grounding + an eval
core. beta.21 turns the model-dependent knobs into real local features — each **off by default** and each
**degrading honestly**.

- **Query rewrite (local model)** — when enabled, DAWN asks the local model for alternative queries and
  uses their tokens to widen the **BM25 keyword** search. Retrieval aids only — never the answer, never
  evidence, never cited. Times out → original query.
- **HyDE expansion (local model)** — generates a short hypothetical passage and appends it to the query
  **only to widen the vector search**. Never cited, never stored as a source, never obeyed.
- **Real reranker** — an honest rerank stage after hybrid: **embedding-similarity** (real local rerank by
  cosine) when enabled + embeddings present, else **heuristic** (hybrid order). **Cross-encoder is never
  claimed** — none ships; a configured reranker path falls to embedding-similarity and says so. Score
  trace kept (hybrid / rerank / final).
- **Local-model entailment verification (optional)** — upgrades the lexical groundedness check: per claim,
  the local model judges SUPPORTED / PARTIAL / UNSUPPORTED / NONE. On **any** failure it keeps the
  conservative lexical result, and it's **never** run without evidence (missing evidence is never
  "supported"). The grounding detail shows which mode was used.
- **In-app RAG eval** — the dev fixture isn't bundled, so DAWN embeds a small public fixture and adds a
  **Run eval** button in **Local Knowledge → Retrieval quality**. It runs deterministically offline (no
  model/network/user-files), persists to userData, and **System Health → RAG Eval Harness now shows real
  numbers** after you click Run.
- **Retrieval debug** — expand the grounding line under a chat answer to see the retrieval trace (mode,
  rerank mode, rewrite/HyDE status, rewritten variants) — modes/names only, no paths or chunk text.

## Honesty guarantees (unchanged + extended)
Everything degrades to an honest fallback; nothing is faked. No cross-encoder claim without a real one,
no fabricated rewrite/HyDE/entailment/eval, retrieved text stays untrusted (scored, never obeyed), and no
paths/secrets/chunk-text leave main. Vault/auth/audit are never retrieved.

## Status
- Tests: **374 / 374 pass** (`npm run test:agentos`) — +7 (rewrite parse/sanitize, rerank modes + reorder,
  entailment parse incl. "UNSUPPORTED ≠ SUPPORTED" + junk→lexical-fallback, embedded fixture clean).
- `npm run eval:rag`: **green** (hit-rate 1.0, negatives leaked 0).
- Build: **green**. TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.21.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`. Renderer
  `typecheck` has pre-existing `SharedArrayBuffer` lib noise unrelated to this work.

## Honest remaining gaps
- Rewrite/HyDE/entailment run against the **loaded chat model**; quality depends on that model, and they
  add latency when enabled (hence off by default).
- No **cross-encoder** reranker ships — embedding-similarity is the strongest honest local rerank.
- Groundedness (even entailment) is a **signal**, not proof.
- Real Vision Chat analysis is still unexercised (no VLM installed).

## Install
Overwrite-install over beta.20. See [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md),
[ANSWER_VERIFICATION.md](ANSWER_VERIFICATION.md), [EVALS.md](EVALS.md).
