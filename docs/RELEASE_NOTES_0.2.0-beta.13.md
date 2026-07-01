# DAWN — 0.2.0-beta.13 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.12

**Layout-safe shell variants** — the right foundation for the design-system migration (fixing the
beta.12 lesson that `PageShell` breaks split/log/canvas layouts):

- New shared variants in `src/ui/system.tsx`: **`PageShellSplit`** (master–detail: fixed header +
  independently-scrolling sidebar/main/detail), **`PageShellPanel`** (top-scroll card page),
  **`PageShellLog`** (fixed header/actions + one scrollable body box, with `bodyRef`/`bodyClassName`
  so auto-scroll is preserved), **`PageShellCanvas`** (header + full-bleed non-scrolling canvas +
  optional scrolling detail).
- Layout classes live in a pure `src/ui/shellLayout.ts` with **unit-tested invariants** (independent
  scroll, fixed header, no double-scroll) — guardrails that are testable **without rendering**.
- **Migrated two screens that clearly fit** (behaviour preserved): **Logs → `PageShellLog`** (fixed
  header + scrolling log box, auto-scroll-to-bottom intact) and **Model Manager → `PageShellPanel`**.

## Status

- Tests: **328 / 328 pass** (`npm run test:agentos`) — +5 since beta.12 (shell layout invariants for
  split/log/canvas/panel).
- Build: **green**. TypeScript (main): clean. Contract test green. Route-consistency green.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.13.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Honestly not done this batch

- **Loop 53 (split-screen migration to `PageShellSplit`)** — the variant exists and its invariants are
  tested, but migrating a real master–detail screen changes header/column structure I **can't visually
  verify**, so I didn't do it blind (the beta.12 lesson). Best done with a human checking one screen.
- **Loops 55/56 (full copy audit / more live hooks)** — deferred.
- Most legacy screens remain on bespoke layouts — Design System stays **PARTIAL** with the exact list.

## Install

Overwrite-install over beta.12. All earlier fixes carry forward. Supersedes earlier betas.
