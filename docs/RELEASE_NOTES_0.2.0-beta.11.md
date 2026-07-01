# DAWN — 0.2.0-beta.11 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.10

Two end-to-end loops (tested):

1. **Central status-language mapper** (Loop 38) — `src/lib/statusMap.ts` is now the single, tested
   source of truth for status language across DAWN: it maps every status code (groups
   **feature / knowledge / retrieval / modelFit / toolRisk / setup**) to a display **label**, a badge
   **tone**, and a plain-English **explanation**. Unknown codes resolve to a neutral **"Unknown"** —
   never a crash, never fake reassurance. Adopted by `StatusBadge`, **System Health**, **Setup
   Center**, and **Model Cookbook** (replacing four duplicated local maps). System Health area
   **Status Language → COMPLETE**.
2. **Extended live workspace hooks** (Loop 42) — **Documents** and **Memories** now join Notes + Tasks
   in registering/updating/pruning their Workspace Graph item **instantly** on CRUD (idempotent, no
   circular deps, wrapped). Four live-hooked sources now; Research/Benchmarks/Email/Knowledge remain
   reconcile-only — still honestly **PARTIAL** in System Health.

## Status

- Tests: **322 / 322 pass** (`npm run test:agentos`) — +5 since beta.10 (status-map: valid tones,
  documented statuses, safe Unknown, no dup keys; live-hooks coverage).
- Build: **green**. TypeScript (main): clean. Contract test green. Route-consistency green.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.11.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Honestly not done this batch

- **Loops 39–41 (full design-system migration of legacy screens)** — deferred; Design System stays
  **PARTIAL** with the exact list. The status map + shared components are adopted in the newer screens.
- **Loop 43 (final copy audit)** — partially advanced by the central status map; a full copy sweep is
  still pending.
- Live hooks cover Notes/Tasks/Documents/Memories; Research/Benchmarks/Email/Knowledge remain
  reconcile-only (tracked as PARTIAL).

## Install

Overwrite-install over beta.10. All earlier fixes carry forward. Supersedes earlier betas.
