# DAWN — 0.2.0-beta.7 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.6

Two end-to-end loops (wired UI → IPC → service → persistence, tested):

1. **Workspace item picker + visual linking** (Loop 17) — linking is now fully visual: open an item →
   **+ Link…** → choose a relationship → pick the target in a searchable **item picker** (no IDs).
   Chat replies gain a **Link** action too. `RelatedItemsPanel` filters by relationship; duplicate
   links return a friendly "already linked"; self/invalid links blocked. Picker searches real items
   only — the vault/auth/audit can never appear.
2. **Model Cookbook** (Loop 19) — **Sidebar → Models → Model Cookbook**: best installed model per role
   (fast/coding/reasoning/research/…), honest **hardware-fit labels** (Fits in VRAM / Partial offload
   / CPU fallback / Too large / **Unknown hardware**), real benchmark tok/s or **Needs benchmark**, and
   honest explanations. **Never fakes models, benchmarks, or hardware.** Built on the shared
   design-system (PageShell/DataTable).

System Health now tracks **Workspace Linking UX** and **Model Cookbook** (both COMPLETE when their
prerequisites exist).

## Status

- Tests: **296 / 296 pass** (`npm run test:agentos`) — +5 since beta.6 (picker search SQL safety +
  filters, cookbook role/fit/best-per-role, no-fakes).
- Build: **green**. TypeScript (main): clean. Contract test: green (no IPC/preload mismatch, no
  duplicate handlers). Route-consistency: green (no dead links).
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.7.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Honestly not done this batch

Loop 18 (Knowledge/RAG deepening — needs wiring into the existing indexer) and Loop 20 (full
design-system migration of legacy screens) are deferred. System Health shows their real status
(Design System stays **PARTIAL** with the exact reason).

## Install

Overwrite-install over beta.6. All earlier fixes carry forward. Supersedes earlier betas.
