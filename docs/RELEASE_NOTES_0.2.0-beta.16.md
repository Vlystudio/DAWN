# DAWN — 0.2.0-beta.16 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.15

**A verification gate, so the design-system rollout can't get ahead of itself:**

- **UI migration registry** (`electron/services/uiMigrationCore.ts`) — one pure, unit-tested source of
  truth for which screens are migrated, to which shell variant, and — for the risky split/master–detail
  screens — whether a **human** has visually verified them. System Health's *Design System* area and
  the new **[`docs/UI_MIGRATION_CHECKLIST.md`](UI_MIGRATION_CHECKLIST.md)** both read the registry, so
  the three can never drift. `canMigrateAnotherSplit()` stays **false** while any split screen is
  pending — the "don't roll out more splits until Notes/Documents are verified" rule is enforced in
  code, not memory.
- **Notes and Documents are recorded as verification PENDING.** The user hasn't reported a pass, so the
  build does not claim they're verified. No split screen was migrated this batch.

**Two more clean simple-panel migrations:**

- **Tasks → `PageShellPanel`** — same single-scroll model; keeps its inline-expanding rows, recurrence/
  reminders, "Ask DAWN", and live workspace hooks.
- **Backup & Restore → `PageShellPanel`** — keeps the critical RESTORE safety flow untouched: typed
  `RESTORE` confirmation, optional admin password, approval, and the pre-restore safety snapshot. Vault
  stays encrypted.

Deferred honestly this batch: **Calendar** (inline toolbar header needs a rework first), **Skills**
(it's a split screen — gated by the pending verification), **Security/Vault** (redaction-sensitive),
**Settings** (nested scrollers).

**One more live workspace hook — Benchmarks:**

- Running a benchmark now **registers** it in the Workspace Graph instantly (public **model name only**);
  deleting one **prunes** it (delete previously had no reconcile, so this is genuinely new). It matches
  the benchmark reconcile adapter's `type`/`feature`, so live + reconcile can't diverge (dedupe by
  `type+ref_id`). A drift-guard test locks this in.
- Live-hooked sources are now **Notes / Tasks / Documents / Memories / Knowledge / Benchmarks**.
  Still reconcile-only (honestly): **Research, Email**.

## ⏳ Still needs your eyes: Notes & Documents

The split-shell migrations remain **PENDING human visual verification**. The full checklist is in
[`docs/UI_MIGRATION_CHECKLIST.md`](UI_MIGRATION_CHECKLIST.md). Until you confirm them, DAWN will not
migrate another split screen (Skills/Research stay bespoke). If either misbehaves, revert that one view
to its pre-migration layout — the wrapper is the only change.

## Status

- Tests: **335 / 335 pass** (`npm run test:agentos`) — +6 since beta.15 (registry consistency + gate,
  Benchmarks/Knowledge live-hook coverage + drift-guards).
- Build: **green** (renderer compiled — validates the migrated Tasks + Backup JSX). TypeScript (main):
  clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.16.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`. Renderer
  `typecheck` has pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is
  authoritative.

## Screens migrated so far

System Health, Setup Center, Workspace, Email wizard, Model Cookbook, Logs (`PageShellLog`), Model
Manager + Model Hub + Model Optimizer + **Tasks** + **Backup** (`PageShellPanel`), Notes + Documents
(`PageShellSplit`, human verification pending).

## Deliberately NOT migrated (honest)

Dashboard, Research, Calendar, Tools/Skills, Security/Vault, integrations, Settings. Design System stays
**PARTIAL**. Live hooks stay **PARTIAL** (Research/Email reconcile-only).

## Install

Overwrite-install over beta.15. All earlier fixes carry forward. Supersedes earlier betas.
