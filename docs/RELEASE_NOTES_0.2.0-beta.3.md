# DAWN — 0.2.0-beta.3 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## Why this build exists

UI hotfix on top of `0.2.0-beta.2` (which carries the Backup/Restore secret-redaction fix).

### Fix — sidebar nav was unreachable / cut off on shorter windows

The left rail's navigation was a fixed, non-scrolling block. With all groups
(Home / Core / Models / Workspace / Knowledge / Automation / Security / System ≈ 20 items) the nav
overflowed the viewport, pushing **New Chat**, the conversation search/list, and the **System** panel
off-screen and leaving the lower nav items (Obsidian → Settings) unreachable — the sidebar looked
"broken."

**Change:** the nav + New Chat/search + conversations now share **one scroll region**, with the
brand/power switch fixed at the top and the System status panel pinned at the bottom. Every nav item
is reachable on any window height. CSS/layout only — no behavior, routing, or feature change.

Changed file: `src/components/Sidebar.tsx`.

## Status

- Tests: **246 / 246 pass** (`npm run test:agentos`).
- Build: **green** (`npm run build`) — renderer bundle rebuilt.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.3.exe` (unsigned).

## Install

Overwrite-install `DAWN-Setup-0.2.0-beta.3.exe` over beta.2. Backup redaction and all other beta.2
behavior are unchanged. Supersedes beta.1/beta.2.
