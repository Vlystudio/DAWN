# DAWN — 0.2.0-beta.5 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.4

Three end-to-end feature loops (all wired UI → IPC → service → persistence, tested):

1. **Workspace Graph** (Phase 2) — unified, typed **items** + directional **links** across features
   (28 item types, 16 link types). DB-level duplicate-link prevention, orphan-edge cleanup, safe
   capped metadata. Items appear in **Global Search** and are injected into the **Brain** (Workspace
   cluster). Real cross-feature actions: convert-to-task, save-as-note. New `Workspace Graph` page +
   `RelatedItemsPanel`. `docs/WORKSPACE_GRAPH.md`.
2. **Email Setup Wizard** (Phase 3) — guided setup over the existing IMAP/SMTP backend: provider
   presets (Gmail/Outlook/iCloud/Yahoo/Custom), honest **no-OAuth / app-password** guidance, separate
   incoming/outgoing tests, **plain-English error** messages. Credentials stored **only** in the
   encrypted Vault (save blocked with a clear message if locked); never logged/shown/diagnosed.
   `docs/EMAIL_SETUP.md`.
3. **Setup Center** (Phase 4) — a live, honest setup checklist (Essentials / Security / Communication
   / Integrations) pulled straight from System Health, with Set up / Open deep links. Reusable
   `SetupChecklist` component. `docs/FIRST_RUN.md`.

System Health now tracks **Workspace Graph** (COMPLETE) and **Onboarding / Setup Center**.

## Status

- Tests: **275 / 275 pass** (`npm run test:agentos`) — +10 since beta.4 (workspace SQL contract +
  dedupe/orphan, email guides/humanizer/no-secret, route consistency).
- Build: **green** (`npm run build`). TypeScript (main): clean. Contract test: green.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.5.exe` (unsigned).
- Not run (don't exist): `npm run lint`, `npm test`, `npm run smoke`. Renderer `typecheck` has
  pre-existing lib (`SharedArrayBuffer`) noise unrelated to these changes; the build is authoritative.

## Install

Overwrite-install over beta.4. All earlier fixes carry forward. Supersedes earlier betas.
