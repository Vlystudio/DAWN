# Installed-App GUI Smoke (DAWN ↔ AgentOS)

A repeatable, semi-automated smoke that proves the **installed** DAWN app works end-to-end
with AgentOS — without touching your real knowledge base, cloud services, or admin rights.

Script: [scripts/installed-smoke.mjs](../scripts/installed-smoke.mjs) · Run: `npm run smoke:installed`

## What it does
1. Locates the installed app (`%LOCALAPPDATA%\Programs\DAWN`) and records the `app.asar`
   SHA-256 + size (build id).
2. Starts an AgentOS API on an **isolated home** (a temp folder) with **real Ollama
   embeddings**, so the test never touches `C:\Users\benma\agentos\rag\rag.db`. Because it
   binds `127.0.0.1:8099` first, the installed app's runtime manager **adopts** it.
3. Launches the installed `DAWN.exe` (with `ELECTRON_RUN_AS_NODE` unset) and waits for the
   renderer to reach **READY** via `dawn.log`, checking for startup errors.
4. Drives every check through the **exact installed client bytes** (extracted from the
   installed `app.asar`) against the live API — the same code the GUI's IPC handlers call.
5. Cleans up the temp corpus + isolated home, stops the API it started, and writes a report.

## Checks performed
- installed app present + build hash recorded
- AgentOS API healthy; **network + python_exec disabled**; **real (non-test) embeddings**
- installed GUI launches + reaches READY; no startup errors (camera-probe noise excluded)
- GUI adopts the existing API (no competing server spawned)
- RAG **ingest** (with `.env` skipped), **search** (provenance + injection flag),
  **answer** (citations) and **unknown → insufficient evidence**
- **secret redaction** (fake `sk-test_…` never displayed)
- **protected-path** ingest denied; **broad drive-root** ingest denied
- **collection manager**: list collections, list sources, stale detection, reindex,
  delete-source (index-only, file kept)
- **delegation** + **security domain** (`security_agent` ran)
- **signed-grant flow**: mint (64-hex HMAC) → tamper denied → valid applied → replay denied
  → **audit chain intact**
- **Coding Autopilot** (against the installed coding-engine/orchestrator bytes, deterministic
  fake model): protected-file edit denied, traversal denied, autopilot edits a file, the safe
  `npm test` command runs, a final diff is produced, the run reaches a terminal status, and
  **rollback restores the original**.

## Output / report
- Console: a `ok/FAIL` line per check, then a summary block.
- File: `installed-smoke-report.json` in the DAWN repo root with: pass/fail per check, build
  app.asar hash/size, AgentOS health + embedding backend, logs path, collection used
  (`gui_smoke`), and cleanup result.
- The installed DAWN window is left open so you can visually confirm the **Local Knowledge**
  panel (status, collections, ingest, ask) and an approval card if you trigger one in chat.

## Requirements
- Installed DAWN app present (run packaging first — see
  [agentos-integration.md](agentos-integration.md)).
- AgentOS at `C:\Users\benma\agentos` with its venv.
- Ollama running with `nomic-embed-text` pulled (real embeddings). No cloud keys needed.

## Scope / honesty
This runner launches the real installed GUI and verifies it boots to READY and adopts the
AgentOS API, then exercises the installed bundle's AgentOS/RAG/grant code paths against a live
API. It does **not** synthesize mouse clicks in the renderer (no Playwright dependency is
added); the visual rendering of the Local Knowledge panel and approval cards is left for a
quick human glance, which the runner prompts for. The runtime manager's **auto-start** path
(spawning the API when down) is covered by unit tests
([tests/agentosRuntime.test.ts](../tests/agentosRuntime.test.ts)); the installed smoke verifies
the **detect-and-adopt** path live.

## Troubleshooting
- "installed DAWN not found" → build + swap `app.asar` first.
- "AgentOS API healthy: FAIL" → ensure the venv exists and `ollama pull nomic-embed-text` ran.
- "reached READY: FAIL" → check `%APPDATA%\DAWN\logs\dawn.log` for the real error.
