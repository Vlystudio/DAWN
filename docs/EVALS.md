# DAWN — RAG Eval Harness

A small, **local, deterministic** evaluation harness so retrieval + grounded-answer quality can be
**measured** and regressions caught over time. No cloud, no telemetry, no model, no live index — it
scores a fixed dataset with the exact retrieval + groundedness cores DAWN ships.

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
