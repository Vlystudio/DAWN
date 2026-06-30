# DAWN — 0.2.0-beta.2 — Internal Local Build

> **DAWN — Digitally Autonomous Workspace Node.** A fully-local AI workspace with a living,
> data-driven 3D brain. No cloud, no telemetry. This is an **internal local build** — a private,
> unsigned installer for my own use. **Not intended for public distribution.**

## Why this build exists

`0.2.0-beta.2` is a corrected repackage of `0.2.0-beta.1`. It exists to ship one security fix into
the installed app.

### Main fix — Backup/Restore no longer archives legacy plaintext settings secrets

`settings.json` legacy-stores a couple of plaintext credentials. The previous build captured
`settings.json` **verbatim** into a `.dawnbackup`, so a backup could carry those secrets in
cleartext. Backups now **redact** the secret-bearing settings keys before archiving:

- `notionToken` → archived as `""`
- `companionPin` → archived as `""`

Non-secret config (e.g. `contextLength`, Obsidian/Notion enablement, model paths) is preserved. On
**restore**, the redacted keys come back empty and you re-enter them — the same "re-auth after
restore" rule the encrypted Vault already uses.

Scope of the original issue (verified): the token was confined to `settings.json` / `settings.json.bak`
at rest — it did **not** appear in logs, `dawn.db`, the brain graph, audits, or model prompts. The
only exposure path was the backup archive, which this build closes.

Changed files: `electron/services/backup/backupCore.ts` (new pure `redactSettingsForBackup()` +
`SECRET_SETTINGS_KEYS`), `electron/services/backup/backup.ts` (redacts the captured settings before
adding it to the archive). Regression tests added in `tests/backup.test.ts`.

## ⚠ Supersedes 0.2.0-beta.1 for backups

- **Do not use the `0.2.0-beta.1` installer to create or share backups** — its `.dawnbackup` files
  can contain plaintext `notionToken` / `companionPin`.
- The known-bad `release/DAWN-Setup-0.2.0-beta.1.exe` is **kept but retired**; install
  `0.2.0-beta.2` before using Backup/Restore.
- If you already made a backup with `beta.1`, treat it as sensitive (it may contain the plaintext
  token) and delete it; rotate the Notion token if that backup left the machine.

## Status

- Tests: **246 / 246 pass** (`npm run test:agentos`) — includes the 2 new backup-redaction
  regression tests.
- Build: **green** (`npm run build`).
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.2.exe` (unsigned; SmartScreen will warn —
  "More info → Run anyway").

## Install

1. Overwrite-install (or uninstall `beta.1` first), then install `DAWN-Setup-0.2.0-beta.2.exe`.
2. After launch, run one **Backup → Verify** smoke test: create a `.dawnbackup`, unzip it, and confirm
   `data/settings.json` shows `notionToken: ""` and `companionPin: ""`.

All other limitations and the manual smoke checklist from
[RELEASE_NOTES_0.2.0-beta.1](RELEASE_NOTES_0.2.0-beta.1.md) still apply.
