# DAWN — 0.2.0-beta.4 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.3

Four end-to-end feature loops (all tested, all wired UI → IPC → service → persistence):

1. **System Health** (Sidebar → System) — an honest, live feature-completion map. Per area: status
   (Complete / Partial / Needs setup / Broken / Missing), what works, what's missing, required setup,
   last check, and a next-action deep link. Derived from real persisted state — never mocked. New
   `feature_maturity` table; `docs/SYSTEM_HEALTH.md`.
2. **Command Palette** — `Ctrl/Cmd+K` launcher; navigate anywhere + run actions; respects setup
   state (annotates setup-gated destinations).
3. **Global Search** — `Ctrl/Cmd+Shift+F` (or the "Search everything…" command). Searches across
   conversations, messages, memories, notes, tasks, documents, calendar, research, skills, and email
   subjects. Parameterized queries, redacted snippets, **never searches the vault**.
4. **Diagnostics export** (on System Health) — one-click **redacted** diagnostics bundle + "Copy
   error summary". Secrets stripped by settings-key name AND value pattern AND per-log-line.

## Status

- Tests: **265 / 265 pass** (`npm run test:agentos`) — +19 since beta.3, incl. SQL-injection-safe
  search, no-vault invariant, and "no secret survives the diagnostics bundle".
- Build: **green** (`npm run build`).
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.4.exe` (unsigned).

## Install

Overwrite-install over beta.3. All beta.1–3 fixes (backup secret redaction, sidebar scroll) carry
forward. Supersedes earlier betas.
