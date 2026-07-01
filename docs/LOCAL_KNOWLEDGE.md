# DAWN — Local Knowledge (RAG)

**Sidebar → Knowledge → Local Knowledge.**

Local Knowledge lets DAWN answer from **your own files** — entirely locally. You add folders you
choose; DAWN indexes the text into a local SQLite store and retrieves relevant chunks (with citations)
during chat. Nothing is uploaded.

## What you can add

Opt-in **folders** (and the files inside them). DAWN indexes text-ish files: `.txt .md .csv .json
.yaml .html .xml .pdf .docx .rtf` and common source-code files. It **never scans your whole disk** —
only the folders you explicitly add.

## What DAWN refuses to index (and why)

The safety guard (`knowledgeGuardCore`) skips sensitive things and **records a plain-language reason**
(shown on the Local Knowledge page under "Skipped for safety"):

| Skipped | Reason |
|---|---|
| `.env`, `*.env.*` | environment/secret file |
| `id_rsa`, `*.pem`, `*.key`, `*.pfx`, `*.kdbx`, `*.1pux`, … | private keys / certs / password stores |
| `credentials`, `secrets.json`, `.netrc`, `Login Data`, `Cookies`, `key4.db` | credential / browser-profile / secret stores |
| `dawn.db`, `settings.json` | DAWN's own DB/config (vault/auth/audit + settings) |
| files named like `*secret*`, `*password*`, `*token*`, `*apikey*` | name looks like a secret |
| `node_modules`, `.git`, `.ssh`, caches, system folders | protected directory |
| files over **5 MB** | too large |
| binaries / unsupported types | unsupported file type |

This means **no secret, key, vault, auth, or audit content is ever indexed** — and you can see exactly
what was skipped and why.

## Embeddings vs keyword fallback (honest)

DAWN uses a **local** representation for retrieval. The Local Knowledge page shows the current mode:

- **embeddings** — chunks have vector embeddings.
- **keyword fallback (local hash — no neural embedding model)** — retrieval works without a neural
  embedding model. This is labeled honestly; it is not pretending to be neural embeddings.
- **not indexed yet** — add a folder and index.

If you've configured an embedding model it's shown next to the mode.

## Source states & actions

Each added folder shows its file/chunk counts and indexing status. Actions: **Add folder**,
**Re-index** (refresh after files change — "stale" content), **Pause**, **Delete all**. Removing a
folder deletes its sources + chunks.

## Workspace + Search integration

Knowledge **sources** auto-register as **Workspace Graph** items (labelled by **name only** — never
the full path, and no file content in metadata), so they appear in the Brain and in **Global Search**
alongside notes/tasks/docs. Full file *content* is **not** dumped into Global Search.

## Privacy / diagnostics

File **contents are never logged**, and the redacted **diagnostics** export never includes indexed
text or secret snippets. Skip reasons are aggregate counts only (no file paths/contents).

## Current limitations (honest)

- Per-file source-state columns (pending/indexing/stale/failed) and citation metadata
  (page/section/chunk) are **incremental** — System Health tracks **Local Knowledge** by indexed
  state and **Knowledge Safety** separately (the guard is complete and tested).
- The Local Knowledge page hasn't been fully migrated to the shared design system yet.

## Source lifecycle states (persisted)

Each indexed source now carries a persisted lifecycle **state** (`electron/services/knowledge/
sourceStateCore.ts`): `pending → validating → indexing → indexed`, plus `skipped` (safety/unsupported),
`stale` (changed since indexing), `failed` (sanitized error stored — no path/secret/contents), and
`removed`. The Local Knowledge page shows **indexed / failed / stale** counts; System Health surfaces
failed-source counts and the honest gap (per-file stale detection + full citation precision are
incremental). Removed/skipped sources don't surface as active workspace/search results.

## Citation metadata (honest precision)

When DAWN retrieves a chunk it now attaches a **citation** (`knowledge/citationCore.ts`) built from
**real data only**: file name (path is never exposed — file name only), source type, **chunk index**
(real, since chunking exists), content/retrieval mode. It reports a **precision** —
`file-level` / `chunk-level` (and `page-level` / `section-level` / `row-level` / `line-level` only if
a parser genuinely provides them) — and lists exactly which fields are **available** vs **not
available**. DAWN's text/markdown/CSV parsers don't currently extract page numbers or section
headings, so those are honestly shown as **"not available"** — never faked. If/when a PDF parser
provides real pages, the citation will include them automatically.

## Stale detection (Check for changes)

The **Check for changes** button (and `rag.validate()`) re-checks each indexed source against the
filesystem **without reading its contents**: it compares the file's current **mtime** + **size** to
what was stored at index time (`knowledgeStaleCore`). Verdicts are honest — file changed → **stale**
(re-index to refresh), file gone → **removed**, file now unsafe (path/type) → **skipped** with reason,
no stored metadata → left as-is (never fabricated). The safety guard runs first, so an
unsafe file is never read just to check staleness. Stale sources stay usable in search/workspace
until you re-index; **removed** sources drop out. System Health reports stale/failed counts.

## Hybrid retrieval (vector + keyword)

DAWN's retrieval is **hybrid**: it combines **vector** search (cosine over local `nomic-embed-text`
embeddings, where present) with a real **BM25 keyword** signal over the candidate chunk text, and fuses
them with **reciprocal-rank fusion**. It reports its mode honestly per query:

- **Hybrid** — both signals available (best).
- **Vector only** — embeddings present but no keyword match for this query.
- **Keyword only (BM25)** — no embeddings yet (e.g. indexed without an embedding model), or no vector
  match. This is a *real* keyword search now, not a silent skip.
- **Unavailable** — nothing indexed.

Retrieval only searches **safe** sources: skipped/removed sources are excluded; **stale** sources are
still searchable but **flagged** so citations/verification can label them. An exact title/name token
match gets a small boost; stale chunks get a small penalty. Scores are normalized `[0,1]` — never faked.
Implementation: pure `rag/hybridRetrievalCore.ts` (BM25 + RRF + fusion), tested in
`tests/retrieval.test.ts`. System Health → **Hybrid Retrieval** shows the active mode + fallback reason.

### Reranker (honest status)

A cross-encoder **reranker** is optional (`rerankerEnabled` / `rerankerModelPath`). When none is
configured — the default — DAWN uses the **heuristic hybrid ranking** (RRF + title boost) and labels it
as such; it never claims cross-encoder reranking it isn't doing. The Model Cookbook tracks a `reranker`
role for when a local reranker is added.

### Query rewriting / HyDE (optional)

`queryRewriteEnabled` / `hydeEnabled` (default **off**) will expand/rewrite the query with the **local
model** before searching, to improve recall. It uses only the local model, treats its output as an
internal retrieval aid (never the final answer, never memory), and **degrades honestly** (skips) when
the model is unavailable or times out (`rewriteTimeoutMs`).

### Answer grounding

RAG answers are checked against the retrieved chunks — see [ANSWER_VERIFICATION.md](ANSWER_VERIFICATION.md).
Measure retrieval + grounding quality with the eval harness — see [EVALS.md](EVALS.md).

## Query rewrite + HyDE (now local-model wired)

`queryRewriteEnabled` / `hydeEnabled` (default **off**) are now real. When enabled, DAWN calls the
**local model** (bundled llama-server, never cloud) before searching:
- **Query rewrite** generates up to `maxRewriteQueries` alternative queries; their tokens widen the
  **BM25 keyword** search. Rewrites are **retrieval aids only** — never the answer, never evidence.
- **HyDE** generates a short hypothetical passage; its text is appended to the query **only to widen the
  vector search** (embedding). HyDE text is **never cited, never stored as a source, never obeyed.**
Both use a timeout (`rewriteTimeoutMs`) and **fall back to the original query** on any failure — reported
honestly as `fallback` in the retrieval trace. Cores: `queryExpansionCore.ts` (tested).

## Reranker (real embedding-similarity path)

After hybrid retrieval, an honest rerank stage reorders the top `maxRerankCandidates`:
- **Embedding similarity** (`rerankerEnabled` + embeddings present) — a real local rerank by cosine.
- **Heuristic** — hybrid (RRF + title boost) order kept when embeddings are unavailable.
- **Cross-encoder** — only if a real cross-encoder is loaded (**not shipped → never claimed**). A
  configured `rerankerModelPath` does *not* fake cross-encoder; DAWN falls to embedding-similarity and
  says so. Every result keeps a score trace (hybrid / rerank / final). Core: `rerankerCore.ts`.

## Retrieval debug (safe)

Expand the grounding line under a chat answer to see the retrieval trace: **mode** (hybrid/vector/
keyword), **rerank** mode, **rewrite/HyDE** status, and the rewritten query variants — names/modes only,
never paths or chunk text. Local Knowledge shows the reranker mode + the in-app **RAG eval**.
