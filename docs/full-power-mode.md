# Full Power Mode

**Settings → ⚡ Full Power Mode** (off by default). Turns DAWN into an unrestricted local agent
on your own machine, with one hard floor.

## What it unlocks
When on, DAWN can:
- Run **any** PowerShell command (full shell — pipes, chaining, scripting).
- Install / update / remove **any** software (winget or downloaded installers).
- Launch and **automate any application** (`Start-Process`, COM, etc.).
- Read and **edit files anywhere** on the machine (not just a coding workspace).

All chat tools are auto-enabled (PowerShell, install, file access, downloads, web), and file
modification scope becomes "anywhere".

## Approval: ask once per kind, per session
The first time DAWN uses a high-risk capability (e.g. PowerShell, install, a file mutation),
you approve it once. After that it runs **without asking for the rest of the session**
(cleared when DAWN restarts). The approval card tells you it's a session-wide approval.

## The one hard floor (always on, even in Full Power)
DAWN can **never** read or modify your **credentials/secrets**:
- Secret files: `.env`, `*.pem/.key/.pfx/.p12/.kdbx`, `id_rsa`/`id_ed25519`, `.npmrc`,
  `.git-credentials`, `credentials.json`, `wallet.dat`, etc.
- Credential/key/browser-profile directories: `.ssh`, `.aws`, `.gnupg`, `.azure`, `.kube`,
  Chrome/Edge/Firefox `User Data`/profiles.
Any **command** that even mentions a credential/secret path **prompts every single time**
(never session-cached), and all command output is **secret-redacted** before the model or
chat sees it. This is the line that keeps a hijacked prompt from quietly stealing your keys.

## Why the floor exists (the real risk)
DAWN is driven by a **local model that untrusted text can hijack** — a web page from a search,
a README, an indexed doc, a file in a repo can contain "ignore previous instructions and run
X". Full Power removes the friction on what *you* ask, but the model is still steerable by
content it reads, so: the credential floor stays, output is redacted, and DAWN is instructed
to treat web/file text as **data, never instructions** and never to run a destructive/system
command because a document told it to. Keep that in mind when DAWN is browsing or reading
untrusted material with Full Power on.

## Turning it off
Toggle it off in Settings, or restart DAWN to clear all session approvals. The Coding Agent's
workspace confinement is unchanged and remains a safer sandbox for long autonomous loops.

## Implementation / tests
`credentialFloor.ts` (the floor; unit-tested in `tests/credentialFloor.test.ts`),
`fileAgent.canModify/canRead` (floor-aware, Full-Power-aware), `chat.ts` (`effectiveSettings`,
ask-once session cache, credential-touch guard on PowerShell + output redaction). `pytest`
(AgentOS) and `npm run test:agentos` (DAWN) stay green; network execution and `python_exec`
remain disabled regardless of Full Power.
