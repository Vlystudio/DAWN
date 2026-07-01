# DAWN — 0.2.0-beta.28 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.27

**Live-index retrieval strategy eval + reranker benchmark** — DAWN can now evaluate its retrieval strategies
against **your actual local index**, and specifically measure whether GGUF reranking improves retrieval
quality over embedding-similarity and baseline hybrid. **Local-only, honest, never mutates the index, never
leaks private text.**

- **Three eval modes.** `offline_fixture_eval` (the deterministic embedded fixture — unchanged),
  `live_index_eval` (real strategies over your index), `reranker_benchmark` (baseline vs embedding vs GGUF).
  Each result carries eval mode + timestamp + app version + index summary + provider summary + unavailable
  reasons + metrics + safe result rows.
- **Safe preflight.** Before a live run, DAWN computes source/chunk/embedded counts, excluded (skipped/
  removed/failed) counts, chunk-strategy distribution, outdated-source count, redacted embed-model name,
  reranker/helper/adaptive readiness, whether live eval can run, and **which of the 12 strategies are
  eligible + why each unavailable one is unavailable**. No embeddings → vector/hybrid/rerank unavailable; no
  helper/chat → rewrite/HyDE unavailable; GGUF not ready → GGUF-rerank unavailable. No chunk/source text or
  full paths.
- **12 strategies.** keyword, vector, hybrid, rewrite+hybrid, HyDE+vector, HyDE+hybrid, embedding-rerank
  (kw base), GGUF-rerank (kw base), hybrid+embedding-rerank, hybrid+GGUF-rerank, rewrite+hybrid+rerank,
  HyDE+hybrid+rerank. Each row reports status (`ran`/`unavailable`/`failed`/`cancelled`/`timed_out`), honest
  reason, provider, helper/reranker fallback, top-K in/out, latency, hit/MRR/top-K/nDCG, and safe ids.
- **Reranker benchmark.** For each query, the same baseline hybrid candidate set is reordered by embedding
  similarity and by GGUF (when ready); DAWN measures expected-id **rank movement** (improved/worsened/
  unchanged), MRR/top-K/binary-nDCG per order, latency (avg/p95), and unavailable/timeout/fallback counts. If
  GGUF isn't ready it is marked **unavailable with a reason** and only available orders are compared — **no
  fabricated lift**.
- **Query sets.** User-provided (queries + optional expected ids), metadata-generated (chunk title / section
  path / parent heading / file basename — **never chunk text**; each query expects its own chunk), and a
  locally-saved **golden set** (query + expected id + label + notes; bounded to 200; safe fields only).
- **Honest labels.** "best available strategy" only when **≥2 strategies ran over ≥3 labeled queries**; else
  "only available strategy" / "insufficient samples" / "coverage only". Offline eval is unchanged.

## Settings
None added. Uses existing `reranker.gguf.topKInput`/`topKOutput` for candidate/return sizing.

## New IPC
`rag:eval:{preflightLive, live, rerankerBenchmark, liveStatus, saveGoldenItem, listGoldenItems,
deleteGoldenItem, clearLiveResult, exportSafeEval}` (the offline `rag:evalStatus`/`rag:runEval` are
unchanged). Preload `window.dawn.rag.eval.*`. No duplicate handlers (contract test green). All responses
safe/redacted.

## UI
Local Knowledge → **Live-index eval + reranker benchmark**: preflight status, query-set selector (metadata /
golden / user), max-queries, **Run live eval** / **Reranker benchmark** buttons, a per-strategy table
(status + hit/MRR/top3/nDCG, unavailable reason on hover, `*` = reranker fallback used), a baseline-vs-
embedding-vs-GGUF comparison with lift + rank movement + latency, and **Save golden item** / **Export safe
JSON** / **Clear last live eval**. Honest labels throughout.

## Persistence / export
Latest **live eval** and **reranker benchmark** persist to userData **separately** from the offline result
(`rag-live-eval-results.json`, `rag-reranker-benchmark.json`); golden set → `rag-eval-golden.json` (bounded,
deletable). Each stores timestamp + app version + eval mode + query-set mode + strategy table + metrics +
unavailable reasons + index summary + provider summary + **safe result ids and ranks** — no chunk/source/
prompt/response text. Export produces one safe JSON (ids + numbers + metadata queries only).

## Status
- Tests: **456 / 456 pass** (`npm run test:agentos`) — **+19** (empty index refuses; missing embeddings/
  helper/GGUF mark the right strategies unavailable; chat-fallback flagged; metadata queries use metadata
  only; golden sanitize drops chunk text; hit/MRR/top-K/nDCG correctness; best never overstated;
  best_available only with ≥2 strategies; rank movement; GGUF unavailable never fakes lift; GGUF improves
  when mocked scores support it; timeout/failed/fallback/latency counted; IPC channels wired; 12 strategies).
- `npm run eval:rag`: **green** (hit-rate 1, groundedness 0.569, negatives leaked 0 — offline unchanged).
  Build: **green**. TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.28.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`.

## Security / privacy
Live eval only searches SAFE sources (blocked/skipped/removed/failed + vault/auth/audit excluded — same guard
as retrieval). No raw chunk/source text in logs, IPC, persistence, or export; full paths redacted to
basenames; no prompt/model-response text stored (eval rewrite/HyDE skip analytics recording). Candidate text
is sent **only** to the local reranker runtime (127.0.0.1) when GGUF is configured. Eval query storage is
explicit + local-only. Fallback is honest. Main chat is unaffected if an eval fails. Cancel/clear supersedes
the run and clears reranker jobs — no stale work.

## Honest limitations
- Not exercised end-to-end with a real GGUF reranker model installed; the metric/preflight/benchmark logic is
  fully unit-covered and the orchestrator reuses the shipped retrieval cores.
- Metadata-generated labels are self-retrieval (query = a chunk's own title/heading → expects that chunk); a
  hand-labeled golden set gives stronger signal.
- Live eval is bounded (default ≤20 queries) and runs the strategies sequentially; large indexes take longer.
- Results persist in memory/userData for the session; no cross-session eval history yet.

## Install
Overwrite-install over beta.27. See [EVALS.md](EVALS.md), [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md),
[MODELS.md](MODELS.md).
