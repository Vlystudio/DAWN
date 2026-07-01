# DAWN — 0.2.0-beta.14 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.13

**Design-system migration continues safely** (one split screen as a proof pattern):

- **Model Hub → `PageShellPanel`** — simple top-scroll page migrated (same scroll model as Model
  Manager). No behaviour change.
- **Notes → `PageShellSplit`** — the **first master–detail screen** on the shared split shell. The
  sidebar (New note + search + list) and the editor keep their **fixed sub-headers** and **independent
  scroll**; a consistent page header is added on top. Live workspace hooks for Notes are unchanged.
- Refined the split-shell layout so columns are **flex hosts** (fixed sub-header stays put, inner
  list/editor scrolls) — no double-scroll. Layout invariants remain **unit-tested** without rendering.

## ⚠️ Please visually verify Notes after installing

Notes is the split-shell proof pattern. **Checklist:** open Notes from the sidebar → master list left,
detail right → click a note fills the detail → New note works → edit title/tags/body works → delete
(hover trash) works → list scrolls independently → editor body scrolls independently → header/New-note
stay fixed → empty state looks right → no clipping/overlap/double-scroll → creating/deleting a note
updates the Workspace Graph. If anything's off, revert `NotesView` to its pre-beta.14 layout.

## Status

- Tests: **328 / 328 pass** (`npm run test:agentos`) — shell invariants updated to flex-host split
  semantics; all green.
- Build: **green** (renderer compiled — validates the migrated ModelHub + NotesView JSX). TypeScript
  (main): clean. Contract test green. Route-consistency green.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.14.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing `SharedArrayBuffer` lib noise unrelated to these changes; the build is authoritative.

## Screens migrated so far

System Health, Setup Center, Workspace, Email wizard, Model Cookbook, Logs (`PageShellLog`), Model
Manager + Model Hub (`PageShellPanel`), **Notes (`PageShellSplit`)**.

## Deliberately NOT migrated (honest)

Only **one** split screen (Notes) was migrated on purpose (the beta.13 lesson — verify before rolling
out). Still bespoke: Dashboard, Model Optimizer, Research, Documents, Tasks, Calendar, Tools/Skills,
Security/Vault, Backup, integrations, Settings. Design System stays **PARTIAL** with this list.
Loop 60 (copy audit) and Loop 61 (extend a live hook) were deferred to keep this batch focused + safe.

## Install

Overwrite-install over beta.13. All earlier fixes carry forward. Supersedes earlier betas.
