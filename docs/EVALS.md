# DAWN — RAG Eval Harness

A small, **local, deterministic** evaluation harness so retrieval + grounded-answer quality can be
**measured** and regressions caught over time. No cloud, no telemetry, no model, no live index — it
scores a fixed dataset with the exact retrieval + groundedness cores DAWN ships.

## Three eval modes (all local-only)

DAWN has three distinct, honest evals:

1. **`offline_fixture_eval`** — the deterministic embedded fixture below (`npm run eval:rag` + the in-app
   "Run eval"). No model, no live index, no your-files. This is the regression gate and is unchanged.
2. **`live_index_eval`** — runs DAWN's REAL retrieval strategies against **your actual local index** and
   reports a per-strategy table (hit-rate / MRR / top-K / binary nDCG / latency). In-app only (Local
   Knowledge → *Live-index eval*). It **never mutates your index** and stores **ids + metrics only** — never
   chunk or source text.
3. **`reranker_benchmark`** — for each query, takes the same baseline hybrid candidate set and compares
   **baseline vs embedding-similarity rerank vs GGUF rerank** (when a local GGUF reranker is ready),
   measuring expected-id rank movement + lift. It **never fabricates GGUF lift**: if the GGUF reranker isn't
   ready, that column is `unavailable` with a reason, and only the available orders are compared.

### Preflight (live modes)
Before a live run, DAWN computes a **safe preflight**: source/chunk/embedded counts, excluded (skipped/
removed/failed) counts, chunk-strategy distribution, outdated-source count, redacted embed-model name,
reranker + helper + adaptive readiness, whether live eval can run, and **which of the 12 strategies are
eligible + why each unavailable one is unavailable**. If there's no live index it says so; no embeddings →
vector/hybrid/rerank unavailable; no helper/chat → rewrite/HyDE unavailable; GGUF not ready → GGUF-rerank
unavailable. The preflight carries **no chunk/source text or full paths**.

### Strategies (live eval)
The 12 strategies: `keyword`, `vector`, `hybrid`, `rewrite_hybrid`, `hyde_vector`, `hyde_hybrid`,
`embedding_rerank` (keyword base), `gguf_rerank` (keyword base), `hybrid_embedding_rerank`,
`hybrid_gguf_rerank`, `rewrite_hybrid_rerank`, `hyde_hybrid_rerank`. Each row reports status
(`ran`/`unavailable`/`failed`/`cancelled`/`timed_out`), the honest unavailable reason, provider used, any
helper/reranker fallback, top-K in/out, latency, hit/MRR/top-K/nDCG, and safe result ids.

### Query sets
Three safe modes: **user-provided** (type queries, optional expected source/chunk ids), **metadata-
generated** (auto-built from chunk **title / section path / parent heading / file basename** — *never* chunk
text; each query expects its own chunk), and a **golden set** saved locally (query + expected id + label +
notes; **no chunk/source text**, bounded, deletable).

### Interpreting the metrics
- **hit-rate** = fraction of labeled queries whose expected id appears in the top-K output.
- **MRR** = mean of 1/(rank+1) of the first expected id (higher = expected result ranked higher).
- **top-1/3/5/10** = expected id within the first N.
- **binary nDCG@K** = normalized DCG treating expected ids as relevance 1; if there are no labeled queries it
  is honestly **unavailable**, not 0.
- **"best available strategy"** is only shown when **≥2 strategies ran over ≥3 labeled queries**. One
  strategy → *"only available strategy"*; too few labeled queries → *"insufficient samples"*; no labels →
  *coverage only* (no ranking). DAWN never fakes a win or a reranker lift.
- **Why rows are unavailable, not faked:** a missing capability (no embeddings / no helper / no GGUF) is
  reported as `unavailable` with a reason rather than silently substituting a different strategy's numbers.
- **GGUF reranker lift requires a configured local reranker** (`reranker.provider = gguf_reranker` + a rank-
  head GGUF + a running `llama-server --reranking`). Without it, the benchmark compares baseline vs embedding
  only and marks GGUF `unavailable`.

### Privacy boundaries
Live/benchmark results + the golden set + the safe export contain **ids, ranks, providers, numbers, and the
(user-entered or metadata-derived) query strings only** — never chunk text, source text, full paths, or any
model prompt/response. Candidate text is sent **only** to the local reranker runtime (127.0.0.1) when GGUF is
configured. Eval never modifies your index; cancel/clear leaves no stale reranker jobs.

## Run it

```
npm run eval:rag
```

This compiles the cores (`tsc -p tsconfig.test.json`) and runs `scripts/eval-rag.mjs` over
`evals/rag-eval.json`, prints a summary, and writes `evals/last-results.json`. It exits non-zero if a
**negative claim leaks** (a case's "should NOT be supported" statement gets marked supported) — a real
regression signal for CI.

## Dataset format (`evals/rag-eval.json`)

Each case:

| field | meaning |
|---|---|
| `id` | case id |
| `question` | the query |
| `corpus` | `{ id, name, text }[]` — the synthetic documents to retrieve from |
| `expectedSourceIds` | ids that *should* be retrieved (→ hit rate) |
| `expectedKeywords` | keywords a grounded answer should contain |
| `answer` | a candidate answer to verify offline |
| `negativeClaims` | statements that should **not** be supported by the corpus |
| `notes` | free text |

A case with **no** expectations (`expectedSourceIds` / `expectedKeywords` / `answer`) is marked
**INVALID** — not a silent pass.

## Metrics

- **retrieval hit rate** — expected source appears in top-K.
- **top-1 hit rate** — expected source is the #1 result.
- **mean keyword coverage** — expected keywords present in the answer.
- **mean groundedness** — from the answer-verification core.
- **mean unsupported rate** — fraction of claims not supported.
- **negatives leaked** — negative claims wrongly marked supported (should be **0**).

## Honesty rules

- No cloud calls, no telemetry, **no fabricated scores**.
- Missing expected data → the case is **invalid**, not passed.
- Deterministic (same input → same output), so it's a real regression guard.
- Results are stored locally; the dataset is a small **public** fixture (no secret document contents).

System Health → **RAG Eval Harness** shows the last run's cases + hit rate + groundedness (or "not run
yet"). Implementation: pure `ragEvalCore.ts`, tested in `tests/retrieval.test.ts`.

## In-app eval (installed build)

The dev set isn't bundled into the installed app, so DAWN embeds a small **public fixture** in code.
**Local Knowledge → Retrieval quality → Run eval** runs it in-app (deterministic, offline, no model/
network, no user files), persists to userData, and System Health → **RAG Eval Harness** reflects the last
run (hit-rate, groundedness, negatives-leaked). So the installed app reports **real** numbers after Run.

## Strategy comparison

`Run eval` (and `npm run eval:rag`) now also produces a **strategy comparison** table. The offline fixture
has no embeddings and no model, so only **keyword** is actually computed; **vector / hybrid / hybrid+rewrite
/ hybrid+HyDE / hybrid+rerank** are marked **unavailable** with a real reason (never a fabricated win). The
best available strategy is highlighted. On a live index with embeddings, vector/hybrid become comparable.

**Reranker + the eval.** `hybrid+rerank` here refers to the *embedding-similarity* rerank (deterministic,
offline). The **GGUF cross-encoder** reranker (`reranker.provider = gguf_reranker`) is a live-runtime path:
it needs a running `llama-server --reranking` + a GGUF reranker model, so it is **not** exercised by this
deterministic fixture (and the harness never fabricates a cross-encoder score). To evaluate it, point DAWN at
a live index, enable + start the GGUF reranker in Model Cookbook, and compare retrieval quality with the
provider set to `embedding_similarity` vs. `gguf_reranker`. A dedicated reranker benchmark suite (measuring
the cross-encoder's ranking lift over embedding similarity on a labeled set) is a recommended next step.
