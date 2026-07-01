# DAWN — 0.2.0-beta.15 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.14

**Design-system migration continues in a controlled batch** (the beta.14 lesson: migrate splits in
small batches, after the flex-host proof, with a human visual check):

- **Model Optimizer → `PageShellPanel`** — simple top-scroll page (hardware scores + auto-tune). The
  fixed toast stays a child; scroll model unchanged. No behaviour change.
- **Documents → `PageShellSplit`** — the **second master–detail screen** on the shared split shell,
  structurally identical to the Notes proof. Sidebar (New/Import + scrolling list) and editor (fixed
  sub-header + AI toolbar + scrolling body) keep **flex-host semantics**: fixed sub-headers stay put,
  the list and editor scroll **independently**, no double-scroll. Only the view wrapper changed —
  Documents' live workspace hooks are unchanged.

**One more live workspace hook — Knowledge:**

- **Knowledge sources now register/prune in the Workspace Graph live**, not just on reconcile. `rag.ts`
  calls `live.register('knowledge_source', id, name, 'knowledge')` right after a file is indexed, and
  `live.remove(...)` when a source is removed, skipped, or its folder is deleted.
- **Privacy preserved:** the hook passes the **name only — never the full path or file content**.
- **No drift / no double-registration:** it uses the exact `type`/`feature` of the reconcile adapter,
  so live + reconcile can't diverge (items dedupe by `type+ref_id`). A new test
  (`tests/liveHooks.test.ts`) guards this. Reconcile remains the fallback.
- Live-hooked features are now **Notes / Tasks / Documents / Memories / Knowledge**
  (Research / Benchmarks / Email stay reconcile-only — honestly listed in System Health).

## ⚠️ Please visually verify Documents after installing

Documents is the second split-shell screen. **Checklist:** open Documents → master list left, editor
right → click a doc fills the editor → **New** works → **Import** (.md/.txt/.html/.csv) works → edit
title/body + autosave ("Saving…→Saved") → Preview/Edit toggle → **History** (save/restore a version) →
AI toolbar runs (brain → THINKING) → export chips download → doc list scrolls independently → editor
body scrolls independently → page header + New/Import + editor sub-header/AI toolbar stay fixed → empty
state ("No documents") looks right → no clipping/overlap/double-scroll → creating/deleting a doc
updates the Workspace Graph. If anything's off, revert `DocumentsView` to its pre-beta.15 layout.

(Notes remains the first split proof — its beta.14 checklist still applies.)

## Status

- Tests: **329 / 329 pass** (`npm run test:agentos`) — +1 for the Knowledge live-hook drift-guard.
- Build: **green** (renderer compiled — validates the migrated Documents split + Model Optimizer JSX).
  TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.15.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Screens migrated so far

System Health, Setup Center, Workspace, Email wizard, Model Cookbook, Logs (`PageShellLog`), Model
Manager + Model Hub + **Model Optimizer** (`PageShellPanel`), Notes + **Documents** (`PageShellSplit`).

## Deliberately NOT migrated (honest)

Only **one** more split screen (Documents) was migrated on purpose — controlled batch, verify before
rolling out further. Still bespoke: Dashboard, Research, Tasks, Calendar, Tools/Skills, Security/Vault,
Backup, integrations, Settings. Design System stays **PARTIAL** with this list. Live hooks stay
**PARTIAL** (Research/Benchmarks/Email reconcile-only).

## Install

Overwrite-install over beta.14. All earlier fixes carry forward. Supersedes earlier betas.
