# DAWN — 0.2.0-beta.8 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.7

**Knowledge/RAG safety + workspace integration** (Loops 22 & part of 23):

- **Knowledge safety guard** (`knowledgeGuardCore`) wired into the **real indexer**: DAWN never
  indexes `.env` / private keys / certs / `credentials` / `secrets.json` / vault+auth DB
  (`dawn.db`/`settings.json`) / browser profiles / password managers / `node_modules` / `.git` /
  caches / system folders. It enforces a **5 MB** limit + an indexable-type allowlist, and records a
  **plain-language skip reason** for every skipped file.
- **Honest status:** the Local Knowledge page now shows the retrieval **mode** (embeddings vs
  **keyword fallback** — labelled honestly, no neural-embedding pretence) and a **"Skipped for
  safety"** breakdown with counts.
- **Workspace + Search:** knowledge **sources** auto-register as Workspace Graph items (labelled by
  **name only** — never the full path, no content in metadata), so they appear in the **Brain** and
  **Global Search**. File content is never dumped into search; contents are never logged; diagnostics
  never include indexed text.

System Health adds a **Knowledge Safety** area (COMPLETE) distinct from the broader **Local
Knowledge / RAG** area (which stays honest about indexed state + the incremental UI/citation work).

## Status

- Tests: **301 / 301 pass** (`npm run test:agentos`) — +5 since beta.7 (secrets never indexed +
  reasons, protected dirs, size/type limits, knowledge→workspace adapter no-path-leak, safety area).
- Build: **green**. TypeScript (main): clean. Contract test green. Route-consistency green.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.8.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Honestly not done this batch

- **Loop 23 (full citation metadata)** — page/section/chunk citation fields are still incremental; the
  workspace-registration half of Loop 23 shipped.
- **Loop 24 (full design-system migration of legacy screens)** — deferred; new screens use the
  library, legacy screens don't yet. Design System stays **PARTIAL** with the exact list.
- **Loop 25 (Brain node inline linking)** — deferred.

## Install

Overwrite-install over beta.7. All earlier fixes carry forward. Supersedes earlier betas.
