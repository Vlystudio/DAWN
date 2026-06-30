# DAWN Architecture

DAWN is a **local-first** Electron desktop app: a TypeScript main process (services), a
React/TypeScript renderer (the shell + screens), a bundled **llama.cpp** runtime for the model,
**SQLite** (sql.js/WASM) for all state, and a data-driven **3D brain**. No cloud, no telemetry.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Renderer (React / Vite)                                              │
│   Sidebar shell + Dashboard + screens ── window.dawn.* (preload)      │
└───────────────▲──────────────────────────────────────────────────────┘
                │ contextBridge IPC (electron/preload.ts)
┌───────────────┴──────────────────────────────────────────────────────┐
│  Main process (electron/services/*)                                  │
│   runtime (llama.cpp)   db (sql.js)   settings   graph (brain)        │
│   chat ─ memory ─ rag ─ research ─ documents ─ workspace ─ calendar   │
│   optimizer ─ bench (compare/benchmark)                               │
│   security/  (promptSecurity · crypto · auth · vault)                 │
│   tools/     (registry · gateway · providers · skills)               │
│   email/     (emailCore · transport · email)                         │
│   backup/    (backupCore · backup)                                   │
└───────────────▲──────────────────────────────────────────────────────┘
                │ 127.0.0.1 only
        llama-server.exe (CUDA/Vulkan/CPU)        OS keychain (DPAPI)
```

## Layers

- **Runtime** — `runtime.ts` owns one `llama-server.exe` bound to `127.0.0.1`; `llama.ts` is the
  OpenAI-compatible client (`chat`, `chatStream`, `tokenize`). One model loads at a time.
- **Data** — `db.ts` is real SQLite via sql.js with debounced atomic saves; `settings.ts` is a
  durable JSON config with a backup copy. Backups use `db.exportBytes/loadBytes`.
- **Brain** — `graph.ts` rebuilds `brain_nodes`/`brain_edges` from the actual data (conversations,
  memory, documents, notes, tasks, research, models, skills, email, security). Deterministic
  positions; quiet warning edges for security/restore/suspicious events. **No secrets or bodies
  in node metadata.**
- **Security spine** (Parts F/G):
  - **PromptSecurity** (`security/promptSecurityCore.ts`) — the prompt-injection firewall:
    `wrapUntrustedContent`, `scanForInjectionPatterns`, `sanitizeToolOutput`,
    `buildSafeModelMessages`, `assertNoUntrustedSystemRole`, audit shaping. Untrusted content
    rides in user-role messages, never system/developer.
  - **Crypto/Auth/Vault** (`security/cryptoCore.ts`, `authCore.ts`, `auth.ts`, `vault.ts`) —
    scrypt password, AES-256-GCM vault under an OS-keychain + password-wrapped master key,
    RFC-6238 TOTP + backup codes, in-memory sessions, guards.
- **Capability spine** (Part E):
  - **Tool Registry** (`tools/toolRegistryCore.ts`, `toolRegistry.ts`) — every capability is a
    typed tool (risk, permission, schema, approval). Future capabilities are registered disabled.
  - **Execution Gateway** (`tools/toolGateway.ts`) — validate → scan → approve → execute via a
    **provider** → sanitize output → audit. Injectable deps → unit-testable.
  - **Skills** (`tools/skills.ts`) — user automations scoped to allowed tools; body is untrusted.
- **Feature services** — optimizer, bench (compare/benchmark), research, documents, workspace
  (notes/tasks), calendar, email, backup. Each has a **pure core** (`*Core.ts`, electron-free,
  unit-tested) + an electron service.

## The pure-core pattern

Security- and logic-critical code lives in **pure, electron-free modules** (`promptSecurityCore`,
`cryptoCore`, `authCore`, `toolRegistryCore`, `emailCore`, `backupCore`, `researchCore`,
`benchCore`, `docCore`, `wsCore`, `calCore`, `optimizer/*`, `uiCore`). They're imported by both the
electron services (which add DB/IO) and the test suite (which runs them in plain Node). This is
why **244 tests** can cover crypto, firewall, registry, email, backup, and UI logic without
electron.

## IPC

The renderer only reaches the main process through `window.dawn.*` (preload `contextBridge`).
Channels are grouped by feature (`chat:*`, `optimizer:*`, `research:*`, `compare:*`, `bench:*`,
`docs:*`, `notes:*`, `tasks:*`, `cal:*`, `security:*`, `tools:*`, `skills:*`, `auth:*`, `vault:*`
[preload `secrets`], `email:*`, `backup:*`). Risky operations (shell, model download, email send,
backup restore, vault) flow through the **gateway** for approval; sensitive vault/restore IPC adds
session + password checks.

## Build & test

- **Build:** `npm run build` = `tsc -p tsconfig.main.json` (main → `dist-electron`, CommonJS) +
  `vite build` (renderer → `dist`).
- **Tests:** `npm run test:agentos` = `tsc -p tsconfig.test.json` (compiles the pure cores + tests)
  + `node --test`. 244 tests.
- **Package:** electron-builder (`npm run dist`), bundling `dependencies`
  (sql.js, imapflow, nodemailer, mailparser, adm-zip, electron-updater, qrcode.react) + the
  `resources/` sidecars (llama.cpp runtime, voice).

## Dependencies of note (all pure-JS, no native build)

`sql.js` (SQLite WASM), `imapflow`/`nodemailer`/`mailparser` (email), `adm-zip` (backup archives),
`qrcode.react` (TOTP QR), `electron-updater`. Crypto/TOTP/scrypt/GCM use Node's built-in `crypto`;
vault key wrapping uses Electron `safeStorage` (Windows DPAPI).
