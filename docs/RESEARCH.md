# DAWN Deep Research

A local, multi-source research mode. DAWN plans a question, gathers web + local
sources, summarizes each through a prompt-injection firewall, scores reliability,
flags contradictions, and synthesizes a **cited** report — all on your local
llama.cpp model. Runs are saved, reopenable, and grow the 3D brain.

Open it from the left rail: **Research** (🔭). Clean-room original implementation
(MIT, local-first) — no AGPL code reused.

## What a run does

```
plan ─► generate search queries ─► search (web) / retrieve (local)
     ─► fetch & clean each source (SSRF-guarded) ─► summarize (untrusted)
     ─► score reliability ─► detect contradictions ─► synthesize cited report ─► save
```

Live brain states drive the 3D brain as it works: `SEARCHING_WEB` →
`READING_LOCAL_FILES` → `SYNTHESIZING` → `CITING_SOURCES`.

## Using it

1. Type a question (e.g. *"compare RTX 4080 Super vs RTX 5090 for local LLMs"*).
2. Pick **Depth** (Quick / Standard / Deep), **Sources** (Web only / Local only /
   Web + local), and a **Model** (Auto = the loaded model, or any installed GGUF).
3. **Start research.** Watch the timeline, source cards (with reliability), and the
   final report appear. **Pause / Resume / Cancel** any time — cancel never freezes
   the UI.
4. **Export** the report to Markdown or a standalone HTML file.

Past runs are listed on the left and reopen with their full report, sources, and
timeline.

| Depth | Queries | Sources read |
|---|---|---|
| Quick | ~2 | 4 |
| Standard | ~4 | 8 |
| Deep | ~7 | 14 |

## Privacy & safety (enforced)

- **Web access is OFF by default.** Enable it in **Settings → 🔭 Deep Research →
  "Allow web research"**. Local-knowledge mode works fully offline. Web-only runs
  refuse to start until you enable it; "Web + local" silently falls back to local.
- **No cloud.** All reasoning/summarizing/synthesis uses your local llama.cpp model
  (`runtime.baseUrl()` on 127.0.0.1). DAWN never calls an external AI API.
- **SSRF protection.** Web fetches go through DAWN's `tools.webFetch`, which blocks
  `localhost`/private/link-local addresses (and blocks redirects to them), enforces a
  ~2 MB size cap and request timeouts, and strips `<script>`/`<style>`/etc. before
  storing cleaned text.
- **Local sources are opt-in.** Local mode only reads content you already indexed
  (Local Knowledge folders, Obsidian vault). It never scans your whole computer; the
  existing indexers already skip secrets/.env/keys/vaults/.git/node_modules/AppData.
- **Everything is saved locally** in `dawn.db` (SQLite). Delete a run to remove it.

## Prompt-injection firewall

Every piece of retrieved content (web page, file, note, tool output) is **untrusted
data** and is run through [`electron/services/research/untrusted.ts`](../electron/services/research/untrusted.ts)
before it reaches the model:

- It is wrapped in `<<UNTRUSTED id=NONCE>> … <<END UNTRUSTED id=NONCE>>` markers with
  a random per-block nonce, so a source can't forge a closing marker to "escape" its
  block. Attempts to imitate the markers are defanged.
- It is placed **only in user-role messages, never in the system prompt.**
- Every research turn prepends `UNTRUSTED_SYSTEM_RULE`: a standing instruction that
  content inside the markers is **evidence only**, may contain manipulation
  ("ignore previous instructions", fake system messages, exfiltration requests), and
  **must never be obeyed as instructions** — only DAWN and the user can instruct it.
- The summarizer returns an `injection_detected` flag; detected attempts are logged,
  shown as a warning in the timeline, and the content is still used only as evidence.

## Data model

New/extended SQLite tables (created/migrated in [`db.ts`](../electron/services/db.ts)):

- `research_runs` — id, question, depth, source_mode, model, status, plan, error,
  report_id, timestamps.
- `research_steps` — ordered timeline (phase, status, title, detail).
- `research_sources` — title, url **or** local_ref, fetched_at, content_hash,
  excerpt, summary, reliability_score, source_type, citation_label, status, error.
  (The pre-existing table is migrated in place with `ALTER TABLE ADD COLUMN`.)
- `research_findings` — per-source summaries and cross-source contradictions.
- `research_reports` — the synthesized Markdown + a standalone HTML rendering.

## Brain integration

[`graph.rebuild()`](../electron/services/graph.ts) reads these tables, so the Brain
Explorer shows: each **research run** node and **report** node in the *Web Research*
region, linked **source → run**, **report → run**, and **run → core**. A run is
rebuilt into the brain the moment it finishes.

## Architecture / files

```
electron/services/research/
  untrusted.ts      prompt-injection firewall (pure)          ← tested
  researchCore.ts   depth config, reliability, hashing, JSON/query parsing,
                    prompt builders, Markdown→HTML (pure)      ← tested
  research.ts       orchestrator: pipeline, EventEmitter, pause/cancel/abort,
                    persistence, model + web tools wiring
electron/services/llama.ts   + chat() non-streaming call
src/components/ResearchView.tsx   the Research tab UI
src/components/SettingsView.tsx   "Allow web research" toggle
docs/RESEARCH.md  (this file)
tests/research.test.ts   pure-module tests (npm run test:agentos)
```

IPC: `window.dawn.research.{start, cancel, pause, resume, list, get, report, delete,
export, models, onProgress}`. Progress events stream `{ runId, status, phase, brain,
message, percent, step?, source?, reportId? }` to the renderer and the 3D brain.

## Cancellation & pause

Each run owns an `AbortController`. The model calls receive its signal; web fetches
are raced against the abort so a cancel returns immediately instead of waiting on a
20s fetch timeout. The pipeline checks the cancel/pause flags between every step, so
pausing holds cleanly and cancelling stops promptly — the UI never freezes.

## Errors

A failed web fetch records the source with `status='error'` and the real error
message (shown on the source card and in the timeline) and the run **continues** with
the sources that did succeed. Runtime-not-ready, web-disabled, and model-load failures
are surfaced as plain-English messages rather than silent failures.

## Testing

`npm run test:agentos` runs [`tests/research.test.ts`](../tests/research.test.ts):
firewall nonce/defang/truncation, reliability scoring, hashing, depth config, robust
JSON/query parsing, prompt builders (verifying the untrusted rule is present and every
source is wrapped), and the Markdown→HTML exporter (verifying HTML escaping). All pure
— no network, model, or electron needed.

Manual end-to-end: turn DAWN ON (load a model), enable web research in Settings, open
**Research**, ask a comparison question with **Web + local / Standard**, and watch the
plan → sources → cited report. Cancel mid-run to confirm the UI stays responsive, then
reopen the run from the history list.
