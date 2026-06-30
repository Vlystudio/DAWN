# DAWN Email

A local-first IMAP/SMTP email workspace. Read, summarize, and reply to mail with the local
model; turn emails into tasks, calendar events, and notes — all on your machine. Open it from
the **Email** sidebar item (✉️). Clean-room, DAWN-native.

> **Core rule:** email content is **untrusted**, credentials are **secrets**, and outbound
> sending is **high-risk** — nothing is ever auto-sent by the model.

## Setup
Add an account with IMAP + SMTP settings (host/port/TLS), email address, display name, and
username. **Provider presets** for Gmail / Outlook / iCloud / Yahoo prefill hosts/ports and
warn that these providers usually require an **App Password** (or OAuth) — a normal password
won't work. **OAuth is not implemented** (not faked). Use **Test connection** before saving;
server errors are redacted so they can't leak a password.

Transports: **imapflow** (IMAP), **nodemailer** (SMTP), **mailparser** (MIME) — all pure-JS,
bundled with the app. No cloud, no telemetry.

## Credentials → Vault
The password/app-password is stored **only** in the encrypted Vault (kind `email_credential`,
AES-256-GCM). Email tables, IPC responses, logs, audits, the brain graph, and model prompts
**never** contain the credential — only a `credentialVaultItemId` reference. Reading the
credential (for IMAP/SMTP auth) goes through the Vault/Auth guard; when Secure mode is on and
DAWN is **locked**, the Email screen shows a locked state and no account secrets.

## Reading
**Sync** fetches the latest **N messages** (default 50, capped 300) per folder — conservative
by design. Bodies are size-capped; HTML is **sanitized** (scripts, styles, iframes, on*
handlers, `javascript:` URLs, and **tracking pixels/images** removed) and `text/plain` is
preferred. Only sanitized text/HTML is stored. Every message gets a `promptRiskScore`; a
suspicious one shows a **warning** in the list and detail view.

## AI actions (firewalled)
Summarize message, summarize thread, draft reply, extract action items, **create task**,
**create calendar event**, **save summary to note**. Every action wraps the email
(subject + sender + body) as **untrusted `sourceType: email`** via PromptSecurity, runs
`assertNoUntrustedSystemRole` before the model call, and inspects/audits suspicious content. A
drafted reply **never sends** and never carries hidden instructions from the email — the model
is told to treat the email as evidence only.

## Sending (explicit only)
Sending requires: you click **Send** → a **confirmation preview** (recipients/subject/body) →
the **approval gateway** (`email.sendDraft` is **critical** + approval-required, **no
"always allow"**) → an **active session** if auth is enabled. Reply drafts preserve threading
headers (In-Reply-To / References). AI can draft but can **never** send on its own. If a
**skill** triggers a send, it still requires explicit approval and shows the skill name. Send
results are recorded in `email_audit` + `tool_audit` with **redacted** recipients (masked) and
**no body**.

## Attachments (safe)
Attachments are **metadata-only** until you explicitly download. Filenames are sanitized and
**path-traversal is rejected**. **Dangerous types** (`.exe .msi .bat .cmd .ps1 .vbs .js .jar
.scr .com .hta …` and macro-enabled Office files `.docm/.xlsm/.pptm/…`) are **flagged**;
executables are never run and direct-open is blocked. Downloads go to a sanitized app-data
folder.

## Tags & search
Local search over subject / sender / snippet / body, an **unread** filter, and **tags**
(create / apply / remove / filter).

## Tool Registry
Real email tools (replacing the former `email.read/email.send` future entries):
`email.listAccounts · listFolders · sync · readMessage · summarizeMessage · draftReply ·
createTask · createCalendarEvent · sendDraft`. Permissions: `email_read` for read/sync/draft,
`email_send` for send, `write_local_data`/`calendar_write` for task/event. Risk: read/sync/
summarize/draft = **medium**, send = **critical**. All output is sanitized via
`PromptSecurity.sanitizeToolOutput`. Skills may use email tools only if explicitly allowed, and
can never send without approval.

## Brain
Subtle: each account is an **Email** node; a few recent + any **suspicious** messages appear
(suspicious ones glow red with a security-warning edge); tasks/events created from an email
link back to the source message. **No bodies, headers, or credentials** are ever stored in the
graph.

## Data model
`email_accounts · email_folders · email_messages · email_attachments · email_drafts ·
email_tags · email_message_tags · email_audit`.

## Files
```
electron/services/email/emailCore.ts   pure: validation, public view, sanitize, threading, attachment safety, audit redaction, firewalled prompts  ← tested
electron/services/email/transport.ts   imapflow + nodemailer wrappers (errors redacted)
electron/services/email/email.ts        EmailService (accounts→Vault, sync, read, AI, drafts, gated send, tags, attachments, audit)
src/components/EmailView.tsx            the Email tab UI
tests/email.test.ts                     (npm run test:agentos)
```
IPC: `window.dawn.email.*`. Send routes through `window.dawn.email.send` → the approval gateway.

## Tests (18 reqs)
Account public-view has no credentials; config validation; email wrapped as `email`; injection
detected; AI never puts email in the system role; draft doesn't send; send requires approval;
denial blocks send; skill allow-list gates email tools; attachment traversal rejected +
dangerous types flagged; audit masks recipients/omits body; locked-session guard; tags/search.
Prior 213 → **225 total**.

## Intentional limitations
- OAuth is not implemented (App Passwords only) — not faked.
- Attachment **download** stores metadata + safety checks; live byte re-fetch from IMAP is a
  documented follow-up (the unsafe-handling protections are already in place).
- Destructive IMAP actions (delete/move) are deferred; mark-read and sync are supported.
- No telemetry, no cloud — IMAP/SMTP talk only to the servers you configure.
