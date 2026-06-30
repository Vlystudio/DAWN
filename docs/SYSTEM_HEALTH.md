# DAWN — System Health (Feature Maturity)

**Sidebar → System → System Health.**

System Health is DAWN's honest, internal completion dashboard. It shows — for every feature area —
exactly where things stand, derived from **real persisted state** (your settings + database counts),
never from mock data. If a feature needs setup, it says so and links you to the setup. This page is a
truth source for "what works, what's missing, what to do next."

## What it shows

For each feature area:

- **Status** — one of:
  - `Complete` — wired end-to-end and in usable shape.
  - `Partial` — works, but missing pieces or never exercised yet.
  - `Needs setup` (`BLOCKED_BY_SETUP`) — implemented, but waiting on credentials/config from you.
  - `Broken` — present but failing a health check (e.g. last email sync failed).
  - `Stub` — scaffolding only.
  - `Missing` — not implemented yet (reported honestly, never hidden).
- **What works** — the concrete capabilities that are live.
- **What's missing** — gaps, in plain language.
- **Setup** — the exact next setup step, when one is required.
- **Last checked / last error** — from the most recent health-check run.
- **Open / Setup / Docs** — deep-links to the feature, its settings, and its documentation.

At the top: an **overall completion %** and per-status filters (All / Complete / Partial / Needs
setup / Broken / Missing).

## Running a health check

Click **Run health checks**. DAWN re-reads live state and persists each area's status, timestamp, and
any error to the `feature_maturity` table, so the page remembers the last result between sessions.

## How status is decided (honest by design)

Status comes from durable signals, e.g.:

- **Chat** is `Complete` once a model is selected; `Needs setup` if no runtime/model.
- **Email** is `Needs setup` with no account, `Complete` after a successful sync, `Broken` if the last
  sync failed.
- **Security / TOTP / Vault** reflect whether Secure mode, 2FA, and vault items actually exist.
- **Local Knowledge** is `Needs setup` until you index a folder.
- **Command Palette / Global Search** report `Missing` until implemented — the page does not pretend.

Every probe is wrapped: if a check can't run, that area degrades to a safe signal instead of crashing
the page.

## Architecture

- Pure classifier: [`electron/services/featureMaturityCore.ts`](../electron/services/featureMaturityCore.ts)
  (catalog + `evaluateArea` + `summarizeReports`, unit-tested in `tests/featureMaturity.test.ts`).
- Service: [`electron/services/featureMaturity.ts`](../electron/services/featureMaturity.ts)
  (`gatherSignals` from settings + DB, persists to `feature_maturity`).
- IPC: `maturity:list`, `maturity:check`, `maturity:get` → preload `window.dawn.maturity.*`.
- UI: [`src/components/FeatureMaturityView.tsx`](../src/components/FeatureMaturityView.tsx).

## Data stored locally

Only a small `feature_maturity` table: per-area `id`, `status`, `last_checked`, `last_error`, and a
short non-sensitive `detail` (what works / what's missing). **No secrets, bodies, or credentials.**

## Troubleshooting

- **Page is blank / errors** — click Retry; check **Logs** for a `(health)` line.
- **A feature you set up still says "Needs setup"** — click **Run health checks** to refresh, and
  confirm the setting actually saved (Settings has a backup copy of `settings.json`).
