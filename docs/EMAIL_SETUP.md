# DAWN — Email Setup

**Email page → Setup wizard**, or the **"Email setup wizard…"** command (`Ctrl/Cmd+K`).

DAWN connects to your mailbox over standard **IMAP** (read) and **SMTP** (send), entirely locally.
It does **not** use OAuth — you sign in with an **app password**. Email content is treated as
untrusted, and **DAWN never sends mail on its own**: every send needs your explicit approval.

## Before you start: Secure mode

Your email password is stored **only** in DAWN's encrypted **Vault**. Saving an account requires an
**unlocked Secure mode session**. If you haven't set one up: **Security → set an admin password →
unlock**, then run the wizard. If the vault is locked, the wizard will tell you and block the save —
it will not store the password anywhere else.

## The wizard

1. **Provider** — pick Gmail, Outlook/Microsoft 365, iCloud, Yahoo, or Custom.
2. **Credentials** — your email address + an **app password** (instructions per provider below).
3. **Test** — DAWN tests **incoming (IMAP)** and **outgoing (SMTP)** separately and shows a
   plain-English result for each.
4. **Finish** — save. You can sync the inbox afterward from the Email page.

## Provider app passwords

| Provider | IMAP | SMTP | App password |
|---|---|---|---|
| **Gmail** | imap.gmail.com:993 (SSL/TLS) | smtp.gmail.com:465 (SSL/TLS) | 2-Step Verification → [App passwords](https://myaccount.google.com/apppasswords) → "Mail" |
| **Outlook / 365** | outlook.office365.com:993 (SSL/TLS) | smtp.office365.com:587 (STARTTLS) | Security → Advanced → App passwords (work/school accounts may disable IMAP) |
| **iCloud** | imap.mail.me.com:993 (SSL/TLS) | smtp.mail.me.com:587 (STARTTLS) | appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| **Yahoo** | imap.mail.yahoo.com:993 (SSL/TLS) | smtp.mail.yahoo.com:465 (SSL/TLS) | Account Security → Generate app password |
| **Custom** | your host:993 | your host:587/465 | whatever your provider requires |

> **A normal account password will be rejected** by Gmail/Outlook/iCloud/Yahoo — you must use an
> app-specific password (turn on 2-step verification first).

## Common errors (and what they mean)

- **"Sign-in was rejected / app password"** — you used your normal password; create an app password.
- **"Could not find the mail server"** — wrong host or no internet.
- **"Connection timed out"** — wrong port or a firewall is blocking it.
- **"TLS/SSL problem"** — the security mode doesn't match the port (993/465 = SSL/TLS, 587 = STARTTLS).
- **"IMAP appears disabled"** — enable IMAP in your provider's settings (work 365 accounts: ask your admin).

## What DAWN stores locally

- The account settings (host/port/security/username) in the local database.
- The **password only in the encrypted Vault** (OS-keychain + password-wrapped). It is **never**
  logged, never shown after save, never put in the model's context, and **never included in a
  diagnostics export** (settings keys matching `password`/`token`/`secret` are redacted).
- Synced message subjects/senders/bodies are cached locally so you can read and search them. Email
  **subjects** (not bodies) are included in Global Search; the vault is never searched.

## Removing an account

Email page → delete the account. This removes the account, its **vault credential**, and (optionally)
its cached messages. Nothing is sent anywhere.

## Safety model

- Email bodies are **untrusted** — they pass through DAWN's prompt-injection firewall and can never
  become instructions to the model.
- **Sending requires approval**: SMTP send flows through the Tool Gateway and shows a confirmation;
  the AI cannot send autonomously. Drafts are clearly marked and never auto-sent.

## Not supported yet

- **OAuth** (Google/Microsoft "Sign in with…"). Use an app password.
- Push/IDLE live sync (sync is on-demand/periodic). System Health shows the current email status.
