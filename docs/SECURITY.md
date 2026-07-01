# DAWN Security

DAWN is local-first. This document covers **PromptSecurity** — DAWN's central
prompt-injection firewall (Part F). Vault/auth/2FA (Part G) and backup/restore (Part H)
are documented in their own files when implemented.

## PromptSecurity — the untrusted-data firewall

### The rule

> Untrusted content may be used only as **evidence/data**. It must **never** become
> system, developer, policy, tool-definition, or hidden-instruction text.

Untrusted content is anything not authored by DAWN's own code or typed directly by the
user: documents, notes, task text, calendar descriptions, memories, RAG chunks, web
fetches, tool outputs, skills (future), email (future), imported/exported workspace data,
and model-generated text that is later reused as context.

### Service

[`electron/services/security/promptSecurityCore.ts`](../electron/services/security/promptSecurityCore.ts)
(pure, unit-tested) + [`promptSecurity.ts`](../electron/services/security/promptSecurity.ts)
(electron — audit persistence). Public API:

| Function | Purpose |
|---|---|
| `wrapUntrustedContent(label, content, sourceType, metadata?)` | tamper-evident, source-typed wrapper (per-block nonce; forged markers defanged) |
| `buildUntrustedContextPolicy()` | the standing system-role rule that frames wrapped content as evidence-only |
| `scanForInjectionPatterns(content)` | risk score (0–100) + severity + matched pattern names |
| `sanitizeToolOutput(output, toolName?)` | strip control chars + wrap tool output as `tool_output` |
| `buildSafeModelMessages({ system, developer, user, trustedContext, untrustedContext })` | assemble role-separated messages: trusted → system, untrusted → a user evidence message |
| `assertNoUntrustedSystemRole(messages)` | **throws** if any wrapped untrusted block leaked into a system/developer role |
| `createPromptSecurityAuditEvent(event)` | shape + persist an audit record (hash + redacted preview) |
| `inspect(label, content, sourceType, sourceId?)` | scan + audit-if-suspicious; returns the scan so callers can warn |

**Source types:** `document · note · task · calendar · memory · rag · web · file ·
tool_output · skill · email · unknown`.

### How wrapping works

Untrusted text is fenced with a random per-call nonce:

```
<<UNTRUSTED id=ab12cd34 type=document source="My Doc">>
…content (control chars stripped; any forged <<UNTRUSTED…>> markers defanged)…
<<END UNTRUSTED id=ab12cd34>>
```

Because the nonce is unpredictable, content can't pre-close its own block to "escape", and
it can never sit in the system role (the policy lives there; the wrapped block lives in a
user-role message). `assertNoUntrustedSystemRole` is a hard guard run **before every model
call** in the integrated flows.

### Risk scoring (not blocking)

DAWN does **not** auto-block content. It **scores** risk, **logs** suspicious content,
**wraps** it (always), and **warns**. Approval is only required where suspicious content is
paired with **risky tool execution** (that gate lives in the tool/skill layer — Part E).
Detected patterns include: ignore/override previous instructions, reveal/print system
prompt, role reassignment ("you are now"), call-tool / run-command, exfiltrate / send
email / delete files, fake `system:`/```system role blocks, tool-call-looking JSON, long
encoded blobs, hidden Unicode, and `data:`/`javascript:` URIs.

### Audit log

Suspicious inspections create a local record (`prompt_security_events`): id, timestamp,
`sourceType`, `sourceId`, label, `riskScore`/severity, matched patterns, action taken,
**SHA-256 of the content**, a **redacted+truncated preview** (secrets/emails masked), and a
related brain-node id. View it in **Settings → 🛡️ Prompt safety** (with a Clear button).
Full content is never displayed.

### Brain integration (subtle)

Documents/notes/tasks whose imported text triggered a medium/high event are flagged on the
brain graph (node turns red + a `security_warning` edge to the core). It is intentionally
quiet — no separate noisy nodes.

### Integrated flows (real, not cosmetic)

- **Documents** AI actions (rewrite/summarize/expand/shorten/fix-grammar/checklist/extract):
  content wrapped + inspected + asserted before the model call.
- **Notes** (summarize / convert-to-task) and **Tasks** ("Ask DAWN to work on this"): wrapped
  + inspected + asserted.
- **Calendar**: imported `.ics` descriptions are inspected on import.
- **Chat / RAG / memory / vault / Notion**: these retrieved blocks were previously concatenated
  into the **system** prompt — they are now moved into a single **user-role evidence message**,
  each wrapped + inspected, with the policy added to the system prompt and
  `assertNoUntrustedSystemRole` enforced before every turn.
- **Tool output** (PowerShell, file reads, web fetch, D.C.D, AgentOS, etc.): wrapped via
  `sanitizeToolOutput` before being fed back to the model.
- **Deep Research**: source text inspected; every model call asserts no untrusted system role.
- **Future**: Skills (Part E) and Email (Part D) call the same service.

### Tests

[`tests/promptSecurity.test.ts`](../tests/promptSecurity.test.ts) proves: untrusted content
never appears in system/developer roles; document/RAG/tool content is wrapped; the scanner
catches obvious attacks; benign content stays clean; `assertNoUntrustedSystemRole` throws on
violation; `buildSafeModelMessages` separates roles; and audit events are shaped with hashing
+ redaction. The full suite (185 tests) passes.

### Intentional limitations

- Scanning is heuristic (pattern + score), not a guarantee — it surfaces and wraps, it
  doesn't "prove safe". The real protection is **structural** (untrusted content can't reach
  the system role), which the assertion enforces.
- The audit preview is redacted/truncated; the full original is never stored (only a hash).
- Risk scoring intentionally does not block normal content (low false-positive cost).

---

## Tool Registry + Execution Gateway (Part E)

The capability layer builds directly on PromptSecurity. Full details in
[SKILLS.md](SKILLS.md); the security-relevant architecture:

- **Tool Registry** — every capability is a typed tool with a **risk level**
  (safe→critical), a **required permission**, an input/output schema, an enabled flag, and a
  provider. Future capabilities (backup/email/vault) are registered **disabled** and can never
  run. Effective enabled-state also respects existing settings gates (PowerShell/Internet/file
  access).
- **Execution Gateway** (`toolGateway.execute`) — the chokepoint for registered/risky calls:
  validates existence/enabled/not-future/schema → **scans input + context with PromptSecurity**
  → decides approval by risk + mode + suspicion → requests approval → executes via the tool's
  provider → **`sanitizeToolOutput` wraps the result** → writes a redacted+hashed audit event →
  returns a typed result (errors redacted). Dependencies are injected, so the gateway is
  unit-tested without electron.
- **Approval policy** — safe/low auto; medium gated by mode/suspicion; **high & critical always
  require explicit approval**; disabled/future never run. **"Always allow" is never offered** for
  shell, vault, email-send, settings-modify, file-write, or backup-restore. Default mode:
  **balanced**.
- **Audit** — `tool_audit` stores tool/provider/skill, risk, permission, approval decision,
  **input & output SHA-256 + redacted previews**, status, error (redacted), duration, and linked
  PromptSecurity event ids. Viewable/clearable in **Settings → Tools & permissions**.
- **Skills** — user automations whose **body is untrusted**: wrapped as `sourceType: skill`,
  placed in a user-role message, asserted out of the system role, and limited to an allow-list
  of tools (off-list calls are denied + audited). A skill's risk = the max risk of its tools.
- **Providers (MCP seam)** — a provider interface fronts the built-in tools; an `mcp_future`
  provider is registered but disabled. No external MCP is implemented.

These are covered by [`tests/tools.test.ts`](../tests/tools.test.ts) (14 requirements).

---

## Auth, Vault, TOTP & LAN mode (Part G)

DAWN stays a simple local desktop app by default; security is **opt-in**. Manage everything in
the **Security** screen (🛡️ sidebar). Pure crypto/decision logic lives in
[`cryptoCore.ts`](../electron/services/security/cryptoCore.ts) +
[`authCore.ts`](../electron/services/security/authCore.ts) (unit-tested); the electron services
are [`auth.ts`](../electron/services/security/auth.ts) + [`vault.ts`](../electron/services/security/vault.ts).

### Security modes
- **Local Desktop (default):** no login. The vault still works — its master key is protected by
  the **OS keychain** (Windows DPAPI via Electron `safeStorage`).
- **Secure Local:** `authEnabled` → DAWN starts **locked**; unlock with the admin password
  (+ TOTP if enabled). Session times out (`sessionTimeoutMinutes`) and locks on sleep/screen-lock
  (`lockOnSleep`).
- **LAN mode:** requires a password and **strongly recommends TOTP**. DAWN has **no LAN server
  yet** — the setting records intent and enforces the security prerequisites, and the UI clearly
  states *"LAN server not implemented yet; security prerequisites are ready. DAWN is not exposed
  on the network."* Bind stays `127.0.0.1`.

### Admin password
Hashed with **scrypt** (N=16384, r=8, p=1, 32-byte key, unique 16-byte salt) — plaintext is never
stored. Strength is checked (12+ recommended; very weak/common blocked). Change-password verifies
the current password and **re-wraps the vault master key**. **If the password is lost, secrets
wrapped by it are unrecoverable** unless an OS-keychain wrap exists (local-desktop) — surfaced in
the UI.

### Sessions & lock
One local admin. The session is **in-memory only** (token + the password-derived key-encryption
key are never persisted). App starts locked when auth is on; manual **Lock now**; failed attempts
are **rate-limited** (escalating local lockout). Auth events are audited: login success/failure,
lock, unlock, session expiry, password set/changed, TOTP enabled/disabled, backup code used,
vault create/update/delete/reveal, security-setting/LAN changes. The lock screen leaks no secret
names, values, or audit detail.

### TOTP 2FA + backup codes
Standard **RFC-6238** TOTP (HMAC-SHA1, 6 digits, 30s) — verified against the RFC test vector in
tests. Setup shows a QR / `otpauth://` URI; a code must be confirmed before enabling. The TOTP
secret is stored **encrypted in the vault**. **8–10 one-time backup codes** are shown once and
stored only as SHA-256 hashes; using one consumes it; regeneration requires the password. Disable
requires the password.

### Encrypted Vault
Each secret is encrypted with **AES-256-GCM** (authenticated, **unique 12-byte IV per item**)
under a 32-byte **Vault Master Key (VMK)**. The VMK is never stored in plaintext: it is wrapped by
the **OS keychain** (works in local-desktop mode) **and** by an **admin-password-derived key**
(scrypt) when a password is set (works in secure/LAN mode). Items: `api_key · password ·
email_credential · totp_secret · provider_token · custom`. `vault:list` returns **labels/kinds
only** — never values. **Reveal** requires an unlocked session (and, by setting, the password),
returns the secret only to the UI, **auto-hides** after ~20s, and **copy auto-clears the
clipboard** after 30s. Secrets are never logged, never put into model prompts, and **redacted in
all audits**. `vault:rotateMasterKey` re-encrypts every item under a fresh VMK.

### Tool/permission integration
Vault tools (`vault.list/create/update/delete/reveal`) are **real** registry entries (no longer
future), with `vault_read`/`vault_write` permissions, **high/critical** risk, **approval required**,
and **never "always allow."** `vault.reveal` is marked **`sensitiveOutput`**: the gateway redacts
it from the audit and **never returns the secret into model context** (per the rule "secrets are
injected only into the tool layer"). When auth is enabled and locked, the gateway/provider **blocks
vault access**. Changing security-critical settings (auth/LAN/timeout/…) requires **password
verification** once auth is on.

### Central guards
`auth.requireUnlockedSession()`, `requireSessionForVault()`, `requireRecentPasswordVerification()`,
`setSecuritySetting()` (password-gated), and `auditSecurityAction()` are the chokepoints used by
the vault IPC and security flows.

### Brain
One quiet **security-posture** node (Logic region) shows auth/2FA/vault-count and turns red with a
warning edge after repeated failed logins. **No secret values ever appear in the graph.**

### Data model
`auth_config · auth_audit · vault_items · vault_key_metadata · totp_backup_codes ·
failed_login_attempts`, plus the security settings.

### Tests
[`tests/security.test.ts`](../tests/security.test.ts) (+ vault additions in `tools.test.ts`):
password hashing/verify, strength, AES-GCM round-trip + unique IV + tamper/wrong-key failure, the
**RFC-6238 TOTP vector**, backup-code hashing, sessions/expiry, guards, vault public view (no
secret), rate-limiting, LAN prerequisites, audit redaction, vault tools real + approval-required,
gateway blocking, and `sensitiveOutput` redaction. **213 tests pass.**

### Email credentials (Part D)
Email account passwords/app-passwords are stored **only** in the Vault (`email_credential`,
AES-256-GCM); email tables/IPC/logs/audit/graph/model-context never carry them. Reading a
credential for IMAP/SMTP auth goes through the Vault/Auth guard; a **locked** Secure-mode
session blocks it. Email content is **untrusted** (`sourceType: email`) and firewalled before
any AI call; sending is **critical**, gateway-approved, never "always allow", never auto. See
[EMAIL.md](EMAIL.md).

### Backup / Restore (Part H)
Backups are local `.dawnbackup` archives (full details in [BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
Security-relevant points: vault items + key metadata are included **only encrypted**; plaintext
secrets, the raw password, the master key, session tokens, and OS-keychain material are **never**
included. Every archive entry path is validated (absolute/`..`/drive/UNC/symlink rejected) on both
create and restore; restore extracts **only into staging**, validates checksums + the DB, and
makes a **pre-restore safety snapshot** before swapping (with auto-rollback on failure). Restore
is a **critical, approval-gated** tool with **no "always allow"**, and additionally requires an
unlocked session + password re-verification (Secure mode) + a typed `RESTORE` confirmation.
Imported manifests are inspected as **untrusted**; backup logs/audit previews are redacted.

### Intentional limitations
- One local admin (no multi-user) by design.
- No LAN server yet — only state + prerequisites + UI (clearly labeled), no faked networking.
- Master-key rotation re-wraps OS + (current) password; cross-wrap edge cases on password change
  fall back to OS-keychain access in local-desktop mode.
- Broad IPC hardening relies on the **lock screen** (blocks the UI when locked) + gateway approval
  + vault/auth guards; per-channel guards beyond vault/security are a documented follow-up so
  normal local-desktop flows never break.

---

## Threat model & data locality

**What DAWN defends against**
- **Prompt injection** from retrieved/imported/user-editable content (web, RAG, notes, documents,
  email, tool output, skills, backup manifests) — structurally prevented from becoming
  system/developer instructions (PromptSecurity).
- **Secret exposure** — secrets are never stored in plaintext, never logged, never placed in model
  prompts, never in audit previews, never in the brain graph, and never in backups (encrypted
  only). Reveal requires explicit action + session/password.
- **Unsafe tool execution** — risky/critical tools require explicit, per-call approval; skills are
  confined to an allow-list; email send and restore can never be automatic or "always allowed".
- **Archive attacks** — backup/restore reject absolute/`..`/drive/UNC/symlink paths, extract only
  into staging, verify checksums, and snapshot before swapping (with rollback).
- **Accidental data loss** — restore always makes a recoverable pre-restore safety snapshot.

**What DAWN does NOT defend against (out of scope)**
- A fully compromised OS account / malware with your user privileges (it can read DPAPI-wrapped
  data and DAWN's files, like any local app).
- Physical access to an unlocked machine in Local Desktop mode (no login by default — enable
  Secure mode for at-rest protection of the session).
- The local model itself being malicious (you choose which GGUF to run).
- Network interception of IMAP/SMTP beyond the TLS you configure.

**Where all data lives**
Everything is on your machine: `%APPDATA%/DAWN/` (`dawn.db`, `settings.json`, `logs/`, `backups/`,
`email-attachments/`) and the OS keychain (DPAPI) for the vault-key wrap. **No cloud, no telemetry,
no remote account.** IMAP/SMTP talk only to the mail servers you configure; web research (off by
default) fetches only the public pages you allow.

**Where secrets are never allowed**
Logs · tool/prompt/email/auth audit previews · the brain graph · model prompts/context · backup
manifests + backup logs · IPC responses (vault lists by label only).

## Intended use & scope
DAWN is a **private, local/internal-only** build for the author's own use — not a public product and
not exposed to the internet. It is a local-first app with **no server component**: it binds the model
runtime to `127.0.0.1`, talks only to the mail servers / web pages you explicitly configure, and has
no inbound network surface. The threat model above is written for that local, single-user context
(an attacker's data reaching the model via documents/email/web; local secret hygiene), not for a
multi-tenant or internet-facing deployment. If this ever changes to a shared/distributed build,
revisit the network exposure and add a disclosure process for outside reporters.

## Image attachments (Vision Chat)

Chat images are stored locally in `%APPDATA%/DAWN/chat-attachments` (content-addressed) with metadata in
SQLite. Only **safe metadata** (name/mime/size/dimensions/id/date) is ever exposed — never the file path,
raw bytes, content hash, EXIF, or any OCR/vision text. Image bytes/paths/OCR text never enter logs,
diagnostics, Global Search, or workspace metadata (workspace items may only carry a `has_image_attachment`
flag + count). OCR/vision text is **untrusted**: a screenshot can carry injection text, so it is wrapped
and passed through the prompt-injection firewall — described/quoted, never obeyed, never a system message.
Nothing is analyzed until you send the message; no autonomous file scanning. See [VISION_CHAT.md](VISION_CHAT.md).
