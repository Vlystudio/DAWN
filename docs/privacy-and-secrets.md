# DAWN — Privacy & Secret Detection

DAWN is local-first. With Obsidian integration:

- **Nothing is uploaded.** Vault contents are never sent to any cloud — not to
  OpenAI, Anthropic, Google, or any service. Embeddings are computed on-device.
- The local llama.cpp runtime binds to **127.0.0.1** only.
- DAWN only indexes the vault you connect, and only writes inside `Dawn/`.

## Secret detection

Before writing any note, DAWN scans the text and **redacts** detected secrets
(replaced with `[REDACTED <type>]`) unless you explicitly allow them. Detected:

| Type | Examples |
|---|---|
| Private keys | `-----BEGIN … PRIVATE KEY-----` |
| API keys | `sk-…`, `AKIA…`, `ghp_…`, `xox…` |
| Bearer tokens | `Bearer …` |
| Passwords | `password: …`, `secret = …`, `token=…` |
| SSNs | `123-45-6789` |
| Credit cards | 13–16 digit sequences |

Toggle in **Obsidian → Secret detection** (on by default). Even with it off, DAWN
asks before saving sensitive memories in approval modes.

## What stays where

| Data | Location |
|---|---|
| Chats, quick memories, brain graph, vault index | `%APPDATA%\DAWN\dawn.db` (local SQLite) |
| Vault notes | your Obsidian folder (local Markdown) |
| Models | `%APPDATA%\DAWN\models` (local) |
| Settings | `%APPDATA%\DAWN\settings.json` (no secrets stored) |

## Agentic tools

PowerShell and web tools are **off by default** and gated behind per-action
**approval**. Web fetch is SSRF-guarded and web page text is treated as untrusted
(it can't change DAWN's instructions). DAWN never sends your vault or files to a
search provider — only the query you approve.
