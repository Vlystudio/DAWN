# AgentOS Runtime Manager (DAWN)

DAWN manages the local AgentOS API as a trusted companion process, so you never have to run
`uvicorn` by hand. Implemented in [electron/services/agentosRuntime.ts](../electron/services/agentosRuntime.ts),
wired through IPC (`window.dawn.agentos.*`) and surfaced in the **Local Knowledge** panel and
**Settings → AgentOS & Local Knowledge**.

## What it does
When DAWN opens (and `agentosEnabled` + `agentosAutoStart` are on) it:
1. Checks whether the AgentOS API is already running and healthy → if so, **adopts it** (uses
   HTTP transport; does not start a second one).
2. If the port is occupied by a **non-AgentOS** service → never connects and never kills it;
   warns and falls back to the CLI.
3. If the API is down and the port is free → starts it itself (trusted argv), waits for
   `/health` readiness, then validates the embedding backend.
4. If startup fails → falls back to the CLI (when allowed) and reports a clear status.
5. Re-checks health on a background interval and pushes status to the UI.

## How DAWN starts AgentOS (trusted command only)
The startup command comes **only** from trusted settings — never from model output or
retrieved text. DAWN spawns an **argv array** (no shell, no string interpolation):
```
<python> -m uvicorn agentos.ui.api:app --host 127.0.0.1 --port 8099 --log-level warning
```
- `<python>` = `agentosPythonPath` if set, else `<agentosDir>\.venv\Scripts\python.exe`.
- `cwd` = `agentosDir`.
- Child env adds only safe local vars: `AGENTOS_RAG_EMBEDDING_PROVIDER=ollama`,
  `AGENTOS_RAG_EMBEDDING_MODEL=nomic-embed-text`, `AGENTOS_RAG_OLLAMA_URL=http://127.0.0.1:11434`.
  Cloud keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) and `ELECTRON_RUN_AS_NODE` are **stripped**;
  the test-only hash backend is **never** enabled.

## Process safety
- DAWN tracks the child **only if it started it** (`startedByDawn`). `stop()`/`restart()` only
  ever kill that process — never an unknown process on the port.
- A non-AgentOS service on port 8099 is left untouched (DAWN warns + uses CLI).
- All process logs are secret-redacted before being stored or shown.

## Runtime states
| State | Meaning |
|---|---|
| `stopped` | Disabled, or down with no CLI fallback. |
| `starting` | DAWN is launching the API and polling readiness. |
| `ready` | API healthy, dangerous capabilities OFF, real embedding backend available. |
| `degraded` | API healthy but something's off — no/test embedding backend, or a capability flag is unexpectedly ON. |
| `failed` | Could not become healthy and no CLI fallback. |
| `using_cli_fallback` | API unreachable but the AgentOS CLI is available; chat/RAG still work via CLI. |

Transport is `http` (API reachable), `cli` (fallback), or `unavailable`.

## Health checks
`GET /health` returns version + capability flags. DAWN validates:
- it identifies as AgentOS (`service: "agentos"`, or an older shape with `network`/`shell`),
- `network_enabled` and `python_exec_enabled` are **false** (else degraded + warning),
- `approval_enabled` / `rag_enabled`.

`GET /rag/status` provides the embedding backend posture:
- **degraded** if no backend is available (RAG answers fail closed), or
- **degraded + warning** if the TEST-ONLY hash backend is active (not real retrieval).

A malformed/unreachable health response **fails closed** (never treated as "ok").

## Status object (`window.dawn.agentos.status()`)
```jsonc
{
  "enabled": true, "state": "ready", "transport": "http",
  "apiUrl": "http://127.0.0.1:8099", "startedByDawn": true, "pid": 4242,
  "health": { "ok": true, "agentosVersion": "0.13.0", "networkEnabled": false,
              "pythonExecEnabled": false, "shellEnabled": false, "approvalEnabled": true, "ragEnabled": true },
  "rag": { "available": true, "embeddingProvider": "ollama:nomic-embed-text",
           "embeddingModel": "nomic-embed-text", "embeddingUrl": "http://127.0.0.1:11434",
           "isTestBackend": false, "indexPath": "…/rag/rag.db", "collections": 2 },
  "warnings": [], "lastError": null, "lastCheckedAt": "2026-…"
}
```

## IPC surface (renderer → main)
`window.dawn.agentos`: `status() · refresh() · start() · stop() · restart() · logs() · onStatus(cb)`
(runtime), and `collections() · sources(c) · stale(c) · reindex(c,path?) · deleteSource(c,id) ·
ingest(path,c) · pickFolder() · search(q,c,k) · answer(q,c,k)` (collection manager). No arbitrary
command execution is exposed.

## Settings (all safe + local by default)
`agentosEnabled` (true), `agentosAutoStart` (true), `agentosApiUrl`
(`http://127.0.0.1:8099`), `agentosApiHost`/`agentosApiPort`, `agentosDir`,
`agentosPythonPath` (optional), `agentosStartupTimeoutMs` (15000),
`agentosHealthCheckIntervalMs` (30000), `agentosPreferHttp` (true),
`agentosAllowCliFallback` (true), `agentosEmbeddingProviderExpected` (`ollama`),
`agentosEmbeddingModelExpected` (`nomic-embed-text`), `agentosOllamaUrl`
(`http://127.0.0.1:11434`).

## Disable autostart / start manually
- Turn off **Settings → AgentOS & Local Knowledge → Auto-start the AgentOS API**, or set
  `agentosAutoStart: false`.
- Start it yourself any time:
  ```powershell
  cd C:\Users\benma\agentos
  $env:AGENTOS_RAG_EMBEDDING_PROVIDER="ollama"; $env:AGENTOS_RAG_OLLAMA_URL="http://127.0.0.1:11434"
  .venv\Scripts\python -m uvicorn agentos.ui.api:app --host 127.0.0.1 --port 8099
  ```
- Or use the **Start / Restart** buttons in the Local Knowledge panel.

## Logs
- DAWN main log: `%APPDATA%\DAWN\logs\dawn.log` (entries tagged `(agentos)`).
- AgentOS process stdout/stderr is captured in-memory (redacted), available via
  `window.dawn.agentos.logs()` and shown on demand.
- AgentOS's own per-run audit trail lives under `<agentosDir>\runs\<run_id>.jsonl`.

## Troubleshooting embeddings
`rag-status` (or the panel) should show `ollama:nomic-embed-text`. If it shows the hash
backend or "unavailable":
```powershell
ollama pull nomic-embed-text          # the real embedding model (served on :11434)
```
DAWN's chat bridge on `:11435` does **not** serve embeddings — real embeddings come from
Ollama on `:11434`. Restart AgentOS from the panel after pulling the model.
