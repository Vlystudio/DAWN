# DAWN — 0.2.0-beta.6 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.5

Three end-to-end loops (all wired UI → IPC → service → persistence, tested):

1. **Workspace auto-registration** (Loop 11) — real feature rows (conversations, memories, notes,
   tasks, documents, research runs, benchmarks, email accounts) **auto-register** as Workspace Graph
   items via pure adapters + a reconcile service. Idempotent upsert, in-place update, safe orphan
   pruning (manual items untouched). Runs on Workspace open + every Brain rebuild → items flow into
   Global Search and the Brain. Never touches secret-bearing tables.
2. **Chat cross-feature actions** (Loop 13) — every assistant reply has **Note · Task · Doc ·
   Remember**, creating a real object via the existing services and **linking it `created_from` the
   conversation**. Honest results (green confirm + Open, or a clear error). `docs/CHAT_ACTIONS.md`.
3. **Design-system library** (Loop 10, honest **partial**) — `src/ui/system.tsx` (PageShell,
   StatusBadge, HealthBadge, LoadingState, ErrorState, ActionBar, Button, DataTable). Adopted in new
   screens; legacy screens migrate incrementally. New **route-consistency** test guards against dead
   links. `docs/UI_SYSTEM.md`.

System Health now tracks **Workspace Auto-Registration**, **Chat Cross-Feature Actions** (both
COMPLETE), and **Design System** (honestly **PARTIAL**).

## Status

- Tests: **286 / 286 pass** (`npm run test:agentos`) — +6 since beta.5 (adapter mapping + sql.js
  upsert/prune contract, route consistency, new-area honesty).
- Build: **green** (`npm run build`). TypeScript (main): clean. Contract test: green.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.6.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Honestly not done this batch

Loop 12 (visual item picker), Loop 14 (Knowledge/RAG deepening), Loop 15 (Models cookbook) — deferred.
System Health shows their real status.

## Install

Overwrite-install over beta.5. All earlier fixes carry forward. Supersedes earlier betas.
