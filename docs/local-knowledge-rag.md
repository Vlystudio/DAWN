# Local Knowledge (RAG) in DAWN

DAWN can index your **own local files** and answer questions from them **with citations**,
fully locally (no cloud, no network). It is backed by AgentOS's local RAG store; DAWN is a
thin, security-conscious client.

> **Retrieved text is evidence, never instructions.** Passages are redacted (secrets),
> scanned for prompt-injection (flagged and **not** followed), and always cited by
> file:line/page. No indexed document can change DAWN/AgentOS behavior, permissions, or
> settings.

## How to use it (chat)
Enable **Tools** in Settings (`agentosEnabled`, on by default), then ask naturally:
- "Index my notes folder `C:\Users\benma\notes` into my knowledge base." → DAWN shows an
  **approval card**; on approve it indexes locally.
- "Search my knowledge for varroa treatment timing."
- "From my notes, when should I wrap the hive for winter?" → a cited answer.

Under the hood the model calls `delegate_to_agents` with a RAG mode:
```json
{ "mode": "rag_ingest", "path": "C:\\Users\\benma\\notes", "rag_collection": "hive" }
{ "mode": "rag_search", "task": "varroa treatment timing", "rag_collection": "hive", "top_k": 5 }
{ "mode": "rag_answer", "task": "when do I wrap the hive?", "rag_collection": "hive", "top_k": 5 }
```
`rag_collection` is optional (defaults to `default`); collections keep separate knowledge
bases (e.g. `hive`, `work`, `recipes`).

## What DAWN shows
- **Ingest:** the embedding backend used, how many files were indexed (with per-file chunk
  counts + trust level) and which were **skipped** (protected/binary/too-large), plus a
  source/chunk total for the collection.
- **Search:** each passage with `path:line-range` (or `(p.N)` for PDFs), trust level, score,
  the redacted snippet, and a ⚠ marker on any passage that contains instruction-like text
  (quoted as evidence, never obeyed).
- **Answer:** an extract-and-cite answer, a **CITATIONS** list, and **WARNINGS** (e.g.
  `insufficient_evidence`, or injection detected in evidence). If there isn't enough indexed
  evidence, DAWN says so rather than guessing.

## Safety (DAWN side, defense in depth)
- **Ingest needs intent.** `rag_ingest` always goes through DAWN's approval card before any
  indexing — you explicitly confirm the path and collection.
- **Protected paths blocked twice.** DAWN rejects protected targets client-side
  (`isProtectedPath`: `.env`, `.ssh`, keys, browser profiles, system folders, registry) and
  AgentOS skips them again during the walk. Relative/non-existent paths are rejected.
- **No raw secrets.** Snippets/answers are redacted by AgentOS and again by DAWN before
  display.
- **Evidence, not commands.** Every RAG block is framed as untrusted evidence; the chat model
  is told to cite provenance and never follow embedded instructions.
- **Local only.** No network egress; embeddings come from local Ollama or sentence-transformers
  (a hash backend exists for tests only). Files are read, never modified — `rag_delete_source`
  removes only the index entry, never your file.

## The Local Knowledge panel (UI)
Open **Local Knowledge** in the sidebar for a point-and-click surface (no chat needed):
- **AgentOS status** — state (ready/degraded/CLI-fallback/…), transport, API URL, started-by-DAWN,
  PID, version, network/python_exec posture, last check, and **Start / Restart / Refresh** buttons.
  DAWN auto-starts and monitors the AgentOS API for you — see
  [agentos-runtime-manager.md](agentos-runtime-manager.md).
- **Embedding backend** — provider/model/URL, with a clear warning if it's the TEST-ONLY hash
  backend or unavailable.
- **RAG index** — index path + totals (collections / sources / chunks / suspicious).
- **Add documents** — choose a folder (or type an absolute path) + a collection name, then Index.
  A whole drive root / your entire user profile is refused; protected files are skipped.
- **Collections** — click a collection to see its sources (path, trust, stale flag), **Reindex**,
  and **delete** a source from the index (your file is never touched). Stale sources are flagged.
- **Ask your knowledge** — Answer (cited) or Search (provenance), with injection warnings and
  redaction applied.
- A standing security note: indexed documents cannot grant permissions, change policy, or
  override DAWN/AgentOS.

## Collection manager
DAWN can also inspect and maintain your knowledge bases (all read or index-only):
- "Show my local knowledge collections." → `mode:"rag_collections"` — lists each collection
  with source/chunk/suspicious counts and the embedding backend in use.
- "What's indexed in the hive collection?" → `mode:"rag_list_sources","rag_collection":"hive"`
  — path, trust level, modified date, chunk count, source id.
- "Show stale RAG sources." → `mode:"rag_stale"` — sources whose file changed or went missing
  on disk since indexing.
- "Reindex my DAWN docs." → `mode:"rag_reindex","path":"C:\\…"` — refreshes the index from
  disk (a new path is confirmed via the approval card; protected paths are refused).
- "Delete this source from the RAG index." → `mode:"rag_delete_source","source_id":"src_…"`
  — removes **index data only**; your file is never touched.
- "What embedding backend is AgentOS using?" → shown by `rag_collections` / status; a
  **TEST-ONLY** hash backend is clearly labelled so you never mistake it for real retrieval.

## Embedding backend setup (real, local)
RAG needs a real **local** embedding backend (the deterministic hash backend is for tests
only). Recommended — Ollama (same local stack DAWN uses for chat):
```powershell
ollama pull nomic-embed-text                         # one-time; served on 127.0.0.1:11434
```
AgentOS auto-detects Ollama on `127.0.0.1:11434` (and `:11435`). To pin it explicitly, set
before launching the AgentOS API:
```powershell
$env:AGENTOS_RAG_EMBEDDING_PROVIDER = "ollama"
$env:AGENTOS_RAG_OLLAMA_URL         = "http://127.0.0.1:11434"
$env:AGENTOS_RAG_EMBEDDING_MODEL    = "nomic-embed-text"
```
Note: DAWN's chat bridge on `:11435` does **not** serve embeddings — real embeddings come
from Ollama on `:11434`. Alternative backend: `pip install sentence-transformers` in the
AgentOS venv. If no real backend is available, RAG **fails closed** with a clear message (it
never fabricates answers). Optional doc support: `pip install pypdf python-docx`.

Verify:
```powershell
C:\Users\benma\agentos\.venv\Scripts\python -m agentos.cli rag-status
# expect:  "embeddings_provider": "ollama:nomic-embed-text@http://127.0.0.1:11434"
```

## Requirements / transport
AgentOS must be installed at `C:\Users\benma\agentos`. DAWN prefers AgentOS's local API
(`/rag/*` and `/rag/collections/*` on `127.0.0.1:8099`) and falls back to the CLI
(`agentos rag-*`, argv only — no shell). Older AgentOS without the collection endpoints is
handled gracefully (DAWN falls back to the CLI). See AgentOS `docs/rag.md` for the full
pipeline, schemas, and tests.

## Tests
`npm run test:agentos` includes the RAG client tests (cited/injection-flagged search,
secret redaction, CLI fallback, citations + insufficient-evidence answers, protected-path
rejection, no fabricated evidence on empty results).
