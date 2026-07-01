# DAWN — 0.2.0-beta.12 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.11

**Status-language consolidation** (safe slice of the UI-cohesion work):

- Tool/Skill **risk colours** now derive from the central status map (`statusTextClass('toolRisk', …)`)
  instead of a duplicated per-screen literal — one source of truth for status language. A regression
  test asserts the derived colours are **byte-identical** to the previous mapping (zero visual change).
- Added `toneTextClass` / `statusTextClass` helpers (unknown → neutral, never crash).

## Honest note on the design-system migration

The larger design-migration loops ask for migrating legacy screen **layouts** to `PageShell` /
`DataTable`. Many of those screens use **split (master–detail) or fixed-header + flex-1-scroll**
layouts (Logs, Research, Documents, Skills, …). Blindly wrapping them in `PageShell` changes their
scroll/split behaviour, which **can't be verified without looking at the running UI** — so I did **not**
force those migrations this session. Instead I completed the **safe, verifiable** part: unifying the
**status language layer** (labels, tones, risk colours) onto one tested source, and I kept **Design
System → PARTIAL** in System Health with the exact remaining-screens list and the reason. Layout
migration should proceed one screen at a time with a human verifying each.

## Status

- Tests: **323 / 323 pass** (`npm run test:agentos`) — +1 since beta.11 (derived-risk-colour
  regression + unknown-safe).
- Build: **green**. TypeScript (main): clean. Contract test green. Route-consistency green.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.12.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Honestly not done this batch

- **Loops 45–47 (legacy screen LAYOUT migration to PageShell/DataTable)** — deferred for visual
  verification; Design System stays **PARTIAL** with the exact list. The status layer is unified.
- **Loop 48 (full copy audit)** — status labels are now consistent; a full empty/error/confirmation
  copy sweep is still pending.
- **Loop 49 (extend live hooks to Research/Benchmarks/Email/Knowledge)** — still reconcile-only.

## Install

Overwrite-install over beta.11. All earlier fixes carry forward. Supersedes earlier betas.
