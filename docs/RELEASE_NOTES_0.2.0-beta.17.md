# DAWN — 0.2.0-beta.17 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.16

**The split-migration gate stayed closed — honestly.**

- A Notes/Documents human-verification result was requested, but the submitted report came back with the
  **unfilled template placeholder** (`[PASSED / FAILED — describe failures]`), not a real PASS/FAIL.
  Per the rule *"do not assume pass; do not infer pass from build success,"* neither screen was marked
  confirmed, `canMigrateAnotherSplit()` stays **false**, and **no split screen was migrated** this
  build. To unlock the next split migration, report a real PASS for both Notes and Documents.
- The registry helpers now take an optional screens list, so the gate *logic* — "opens only when every
  split screen is `'confirmed'`" — is unit-tested against hypothetical inputs **without ever faking the
  real registry**. There's also a guard asserting zero split screens are confirmed in the real registry.

**Two more clean panels (integration overviews):**

- **Obsidian → `PageShellPanel`** — keeps its secret-detection toggle and "everything stays local /
  never uploaded / secrets redacted" copy.
- **Notion → `PageShellPanel`** — keeps its `type="password"` integration-token field (never logged or
  registered) and its "only ever reads from Notion" copy.

**One more live workspace hook — Research:**

- Starting a research run now **registers** it in the Workspace Graph instantly. The label is **the
  user's own question — never fetched web content**. Runs aren't deleted, and the completion path
  already reconciles the final status, so live + reconcile can't diverge (dedupe by `type+ref_id`).
- Live-hooked sources are now **Notes / Tasks / Documents / Memories / Knowledge / Benchmarks /
  Research**. Only **Email** stays reconcile-only (a live hook there must never touch credentials or
  message bodies — noted honestly in System Health).

## ⏳ Still needs your eyes: Notes & Documents

Both remain **PENDING human visual verification** — the gate is doing its job. The full checklist is in
[`docs/UI_MIGRATION_CHECKLIST.md`](UI_MIGRATION_CHECKLIST.md). Report a real PASS for both to unlock the
next split migration (Skills is the closest structural match). If either misbehaves, report the failure
and I'll fix that screen first.

## Status

- Tests: **338 / 338 pass** (`npm run test:agentos`) — +3 since beta.16 (gate-opens-only-when-confirmed,
  no-fake-confirmed guard, Research drift-guard).
- Build: **green** (renderer compiled — validates the migrated Obsidian + Notion JSX). TypeScript
  (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.17.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`. Renderer
  `typecheck` has pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is
  authoritative.

## Screens migrated so far

System Health, Setup Center, Workspace, Email wizard, Model Cookbook, Logs (`PageShellLog`), Model
Manager + Model Hub + Model Optimizer + Tasks + Backup + **Obsidian** + **Notion** (`PageShellPanel`),
Notes + Documents (`PageShellSplit`, human verification pending).

## Deliberately NOT migrated (honest)

No split screen this batch (gate closed). Still bespoke: Dashboard, Research, Calendar, Tools/Skills,
Security/Vault, other integrations, Settings. Design System stays **PARTIAL**. Live hooks stay
**PARTIAL** (Email reconcile-only).

## Install

Overwrite-install over beta.16. All earlier fixes carry forward. Supersedes earlier betas.
