# DAWN Backup & Restore

Snapshot, verify, and restore DAWN's local state as a single `.dawnbackup` archive — all on
your machine, no cloud, no telemetry. Open it from the **Backup** sidebar item. Clean-room,
DAWN-native, built on the Vault/Auth, Tool Registry/approval gateway, and PromptSecurity layers.

> **Core rule:** Backup is high-risk; **Restore is critical**. A restore **never** overwrites
> your data without first creating a **recoverable pre-restore safety snapshot**.

## What's included
A backup always includes: the SQLite database snapshot (conversations, memory, knowledge
indexes, **brain graph**, documents + versions, notes & tasks, calendar, research, model
benchmarks/compare history, skills + tool-registry state, **email** accounts/drafts/tags/folders,
**vault items + key metadata + auth config — all encrypted**), and **settings** (model/optimizer/
security config). Optional, user-toggled: **cached email messages + attachment metadata**,
**downloaded attachments**, and **audit logs** (tool/security/auth/email).

## What's excluded (always)
Raw plaintext secrets, the raw admin password, the plaintext vault master key, session tokens,
OS-keychain (DPAPI) material, `node_modules`/build artifacts, and arbitrary user/home/system
folders. (None of these live in the DB to begin with — the vault stores only **encrypted**
items, the password is **scrypt-hashed**, the master key is **wrapped**, and sessions are
**in-memory**.)

## Archive format (`.dawnbackup`)
A zip with `manifest.json` (format/schema version, app version, created-at, machine-id **hash**,
included sections, encrypted-vault/email-cache/attachments/audit flags, file count, total size,
checksum algorithm, compatibility notes), `data/database.db` (selective snapshot),
`data/settings.json`, `files/` (managed app-data files), `checksums.json` (SHA-256 per file),
and `backup-log.json` (redacted).

## Safe database snapshot
The snapshot is built by exporting the live sql.js DB (flushing pending writes first), loading
it into a **fresh in-memory copy**, dropping any opted-out tables, and re-exporting — then
**verifying it re-opens** before it's written. Schema version is recorded in the manifest.

## Archive safety
Every entry path is validated on **both** create and restore: **absolute paths, `..`
traversal, drive-letter paths, UNC paths, control bytes, and symlinks are rejected**; filenames
are sanitized; single-file/total size is capped. On restore, extraction goes **only into a
staging directory**, every entry is re-validated, and any entry that would escape staging
aborts the restore — live data is never written over directly.

## Verify
**Verify a backup** opens the archive, parses + **inspects the manifest as untrusted**
(PromptSecurity), validates the format/schema version, **recomputes and compares checksums**,
checks required files exist, confirms the DB re-opens, and checks the vault payload claim. It
reports **valid / valid-with-warnings / invalid** with the included sections + size — and never
reveals secret data.

## Restore (critical)
Restore requires, in order: an **unlocked session** (if Secure mode is on), **password
re-verification** (if Secure mode is on), a **typed `RESTORE` confirmation**, and **approval
through the gateway** (critical, **no "always allow"**). Then it:
1. **verifies** the backup,
2. creates a **pre-restore safety snapshot** of your current state (full),
3. **stages** the extraction (paths validated),
4. **validates** the staged DB,
5. **swaps** the live DB + settings + managed files,
6. records the result and **reloads** DAWN.

**If it fails before the swap**, your current state is untouched. **If it fails during the
swap**, DAWN **automatically rolls back** from the safety snapshot. The safety snapshot stays in
your backups folder for recovery (`pre-restore-…dawnbackup`).

## Vault on restore (same vs cross machine)
Vault items restore **encrypted**. On the **same machine**, the OS-keychain wrap unlocks them
normally. On a **different machine**, the OS wrap is machine-bound, so you'll need the **admin
password** to unwrap (the manifest's compatibility note states this). Auth config restores;
**sessions never** do; backup codes stay **hashed**; the TOTP secret stays **encrypted**.

## Email on restore
Account metadata, drafts, tags, and folders restore. Credentials restore **only if the vault
restores/decrypts**; otherwise the account shows it needs to reconnect. DAWN does **not**
auto-sync after a restore — you trigger sync yourself.

## Tool Registry
Real tools: `backup.create` (high, approval — includes the encrypted vault), `backup.verify`
(medium), `backup.restore` (**critical**, approval, **no always-allow**), `backup.listHistory`
(low), `backup.openFolder` (low), `backup.deleteSafetySnapshot` (critical, approval). All
outputs are sanitized via PromptSecurity; audit previews are redacted (no secrets, no manifests).

## Where backups live
`…/AppData/Roaming/DAWN/backups/` (or your chosen "Save to…" path). Open it with the **Folder**
button.

## Recovering from a failed restore
1. DAWN auto-rolls back from the pre-restore safety snapshot if the swap failed.
2. If anything still looks wrong, open **Backup → Verify** on the
   `pre-restore-…dawnbackup` in your backups folder, then **Restore** it.
3. The safety snapshot is never auto-deleted; remove it manually when you're confident.

## Files
```
electron/services/backup/backupCore.ts   pure: entry-path safety, manifest, sections, checksums, compatibility, redaction  ← tested
electron/services/backup/backup.ts        service: selective snapshot, .dawnbackup zip, verify, staged restore + safety snapshot + rollback, history
src/components/BackupView.tsx             the Backup tab UI (toggles, verify, typed-confirm restore, history)
tests/backup.test.ts                      (npm run test:agentos)
```
IPC: `window.dawn.backup.*`; restore routes through `backup:restore` → password gate → approval gateway.

## Tests (21 reqs)
Manifest version/sections; secret/session exclusion; vault stays encrypted; path normalization
rejects absolute/`..`/drive/UNC; staging-only extraction; checksum mismatch + missing-file +
unsafe-path detection; safety-snapshot/rollback (service); restore approval + denial-blocks;
password/session gate; email creds never in logs/manifest; attachment sanitization; audit
redaction; untrusted-manifest inspection; restore critical + no always-allow. Prior 225 → **236
total**.

## Intentional limitations
- No cloud sync — local files only.
- Cross-machine vault unwrap needs the admin password (documented; warned in the manifest).
- Live swap reloads DAWN; the running session re-reads the restored DB/settings on reload.
