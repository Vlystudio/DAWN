# DAWN — First Run & Setup Center

DAWN is **local-first and private** — everything runs on your machine. There's no account and nothing
to sign up for. Two things help you get configured:

## First-run setup

On a fresh profile DAWN opens to the **Dashboard** and runs a short first-run flow covering the
essentials: detect the local runtime, pick/import a **model**, and choose **memory** + **knowledge**
preferences. You can change all of these later in Settings.

## Setup Center

**Sidebar → System → Setup Center** (or the **"Open Setup Center"** command). This is a live
checklist that pulls straight from **System Health** — it never marks anything complete on its own.
It groups setup into:

- **Essentials** (recommended): model, optimizer, local knowledge, backup.
- **Security** (recommended): admin password / Secure mode, TOTP, vault.
- **Communication** (optional): email, calendar.
- **Integrations** (optional): Obsidian, Notion, voice, vision, companion, D.C.D.

Each row shows **Ready / Partial / Needs setup / Broken**, what it's for, the exact next step, and a
**Set up / Open** deep link. Nothing is faked — if a feature needs credentials or a dependency, it
says so and points you to the page that fixes it.

## Honest status

- First-run covers model/memory/knowledge today. Per-feature wizards (e.g. **Email setup**,
  **Security**) live on their own pages and in the Setup Center.
- The full multi-step onboarding tour (one screen per feature) is incremental — the Setup Center is
  the always-available, truthful equivalent. System Health tracks this under **Onboarding / Setup
  Center**.

## Where things live

- App data: `%APPDATA%\DAWN\` (`dawn.db`, `settings.json`, `backups\`, `logs\`).
- Setup status is computed live from your settings + database — see [SYSTEM_HEALTH](SYSTEM_HEALTH.md).
