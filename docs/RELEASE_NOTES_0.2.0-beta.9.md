# DAWN — 0.2.0-beta.9 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.8

Three end-to-end loops (wired UI → IPC → service → persistence, tested):

1. **Persisted Knowledge source lifecycle** (Loop 27) — each indexed source now carries a real,
   persisted **state** (`pending → validating → indexing → indexed`, plus `skipped`, `stale`,
   `failed`, `removed`). The indexer sets `indexed` (with size + indexed date) on success and
   `failed` with a **sanitized** error (no path/secret/contents) on failure. Local Knowledge shows
   **indexed / failed / stale** counts; System Health surfaces failed-source counts.
2. **Real citation metadata** (Loop 28) — retrieved chunks carry an honest **citation**: file name
   (no full path), source type, **real** chunk index, retrieval mode, with a **precision** level and
   explicit *available vs "not available"* fields. Page numbers / section headings are reported as
   **not available** (parsers don't extract them) — **never faked**.
3. **Brain inline linking** (Loop 30) — Brain node details for workspace-item nodes show **Related
   items** + a **"+ Link…"** action using the visual picker (no IDs). Self/invalid blocked, duplicate
   is friendly, vault/auth/audit can never appear.

System Health adds **Knowledge Source state** (in Local Knowledge), **Brain Inline Linking**
(COMPLETE), and keeps citation precision honest.

## Status

- Tests: **310 / 310 pass** (`npm run test:agentos`) — +9 since beta.8 (lifecycle transitions +
  error sanitizer, citation honesty/no-fakes/no-path-leak, brain-linking/knowledge-safety areas).
- Build: **green**. TypeScript (main): clean. Contract test green. Route-consistency green.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.9.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Honestly not done this batch

- **Loop 29 (full design-system migration of legacy screens)** — deferred; Design System stays
  **PARTIAL** with the exact list. New screens use the library.
- **Loop 31 (live auto-registration hooks)** — deferred; reconcile (on Workspace open + Brain
  rebuild) remains the working fallback.
- Per-file **stale** detection between index runs is incremental (state machine supports it; the
  detection pass isn't wired yet).

## Install

Overwrite-install over beta.8. All earlier fixes carry forward. Supersedes earlier betas.
