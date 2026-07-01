# DAWN — 0.2.0-beta.10 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.9

Two end-to-end loops (wired UI → IPC → service → persistence, tested):

1. **Per-file Knowledge stale detection** (Loop 35) — the **Check for changes** button (and
   `rag.validate()`) re-checks each indexed source against the filesystem **without reading its
   contents**: it compares current **mtime/size** to the values stored at index time
   (`knowledgeStaleCore`) and honestly marks **stale** (changed), **removed** (gone), or **skipped**
   (now unsafe — the safety guard re-runs first). No comparison metadata → left as-is (never faked).
   Stale sources stay usable until re-index; removed drop out of workspace/search. System Health shows
   stale/failed counts.
2. **Live workspace auto-registration hooks** (Loop 34) — **Notes** and **Tasks** now
   register/update/prune their Workspace Graph item **instantly** on create/update/delete (idempotent,
   wrapped so a hook can't break the host service). Reconcile remains the fallback and stays
   idempotent. Other features remain reconcile-only — honestly marked **PARTIAL** (Live Workspace
   Hooks) in System Health, listing exactly what's reconcile-only.

## Status

- Tests: **317 / 317 pass** (`npm run test:agentos`) — +7 since beta.9 (stale verdicts incl. removed +
  jitter tolerance + honest "unknown"; live-hooks PARTIAL honesty + remove-by-ref SQL contract).
- Build: **green**. TypeScript (main): clean. Contract test green. Route-consistency green.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.10.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Honestly not done this batch

- **Loop 33 (full design-system migration of legacy screens)** — deferred; Design System stays
  **PARTIAL** with the exact list. New screens use the library.
- **Loop 36 (status-language central mapper)** — deferred.
- Live hooks cover Notes + Tasks; Documents/Memories/Research/Benchmarks/Email/Knowledge remain
  reconcile-only (tracked as PARTIAL).

## Install

Overwrite-install over beta.9. All earlier fixes carry forward. Supersedes earlier betas.
