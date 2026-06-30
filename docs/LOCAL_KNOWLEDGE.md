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
