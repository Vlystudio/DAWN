# AgentOS Integration (DAWN → AgentOS)

DAWN can delegate **bounded, read-only** tasks to **AgentOS** — the local
multi-agent framework at `C:\Users\benma\agentos` — and surface structured results
plus the AgentOS audit trail. This is wired as a chat tool: `delegate_to_agents`.

> Read-only by default. Passing `allow_writes/allow_shell/allow_network` on a delegate
> is still denied (fail closed). When **AgentOS itself** proposes a bounded side effect
> (a specific file write / allow-listed test command), DAWN supports the **per-run
> approval flow with HMAC-signed grants** (below). DAWN also has **local-knowledge (RAG)**
> modes. Network execution and `python_exec` remain disabled.

## Runtime path (how DAWN calls AgentOS)
```
chat model emits  ```dawn-tool {"tool":"delegate_to_agents","args":{...}}```
   → chat.ts executeTool()                       (electron/services/chat.ts)
   → agentos.delegate(input, {agentosDir, apiUrl}) (electron/services/agentos.ts)
       1. validate + apply read-only policy (deny writes/shell/network; check path)
       2. POST {task, target_path} to AgentOS API  http://127.0.0.1:8099/run   ← preferred
       3. if API offline → CLI fallback (argv array, no shell):
          <agentosDir>\.venv\Scripts\python.exe -m agentos.cli run --json [--target-path P] "<task>"
       4. map RunResult → DAWN result, sanitize + redact secrets
   → formatForChat() → fed back to the model → user sees summary/findings/recs
```

## How to run AgentOS
```bash
cd C:\Users\benma\agentos
.venv\Scripts\python -m pip install -e .            # one-time
# Option A (preferred): start the local API
.venv\Scripts\python -m uvicorn agentos.ui.api:app --host 127.0.0.1 --port 8099
# Option B: nothing to start — DAWN falls back to the CLI automatically.
```
If neither the API nor the venv is found, DAWN returns a safe "AgentOS is not
installed" result (no crash).

## Installed-app packaging & relaunch
The installed desktop app (`%LOCALAPPDATA%\Programs\DAWN`, appId `com.dawn.app`) bundles the
renderer + main process in `resources\app.asar`. To update it from verified repo code without
a full reinstall, swap only `app.asar` (the large `extraResources` — runtime/piper/kokoro/
vision — are unchanged and stay put). **Note:** `C:\Program Files\Dawn Cyber Defense` is a
different app — do not touch it.

```powershell
cd C:\Users\benma\dawn
# 1) gate on green tests + typecheck
npm run test:agentos
npx tsc -p tsconfig.main.json --noEmit
# 2) build renderer + main, then produce an unpacked app (correct app.asar incl. prod node_modules)
npm run build
npx electron-builder --win --dir          # -> release\win-unpacked\resources\app.asar
# 3) BACK UP the installed asar (timestamped) BEFORE swapping
$dst = "$env:LOCALAPPDATA\Programs\DAWN\resources"
Copy-Item "$dst\app.asar" "$dst\app.asar.bak.$(Get-Date -Format yyyyMMdd-HHmmss)"
# 4) swap in the new app.asar (+ its unpacked sidecar)
Copy-Item "release\win-unpacked\resources\app.asar" "$dst\app.asar" -Force
Copy-Item "release\win-unpacked\resources\app.asar.unpacked" "$dst\app.asar.unpacked" -Recurse -Force
# 5) relaunch normally (ELECTRON_RUN_AS_NODE must NOT be set)
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process "$env:LOCALAPPDATA\Programs\DAWN\DAWN.exe"
```
Record the old/new `app.asar` size + SHA-256 (e.g. `Get-FileHash`) before/after the swap.

### Rollback
If the installed app misbehaves after a swap:
```powershell
# stop DAWN, then restore the most recent backup
Get-Process DAWN -ErrorAction SilentlyContinue | Stop-Process
$dst = "$env:LOCALAPPDATA\Programs\DAWN\resources"
$bak = Get-ChildItem "$dst\app.asar.bak.*" | Sort-Object LastWriteTime -Desc | Select-Object -First 1
Copy-Item $bak.FullName "$dst\app.asar" -Force
Start-Process "$env:LOCALAPPDATA\Programs\DAWN\DAWN.exe"
```
Backups are never deleted by this process. A clean reinstall (`release\DAWN-Setup-<ver>.exe`)
also restores a known-good app.asar.

## Start the AgentOS API (for the installed app)
**You usually don't need to** — DAWN now starts and monitors the AgentOS API for you (the
**AgentOS Runtime Manager**; see [agentos-runtime-manager.md](agentos-runtime-manager.md)). It
detects a running API and adopts it, starts one safely if down (trusted argv, no shell), and
falls back to the CLI on failure. Manage it from the **Local Knowledge** panel or
**Settings → AgentOS & Local Knowledge** (toggle auto-start there).

To start it manually anyway (with real local embeddings pinned):
```powershell
cd C:\Users\benma\agentos
$env:AGENTOS_RAG_EMBEDDING_PROVIDER = "ollama"
$env:AGENTOS_RAG_OLLAMA_URL = "http://127.0.0.1:11434"
.venv\Scripts\python -m uvicorn agentos.ui.api:app --host 127.0.0.1 --port 8099
```

## Coding Autopilot (uses AgentOS for deeper planning)
DAWN's local **Coding Autopilot** (sidebar → Coding; see [coding-autopilot.md](coding-autopilot.md))
owns workspace selection, file editing, checkpoints, rollback, and command execution. AgentOS's
`software_engineering` domain can propose a plan + patches via `agentos.implementCode`, but DAWN
**validates every proposed patch** against the trusted workspace and applies it through its own
`fs_apply_patch` — AgentOS never writes directly or bypasses workspace validation, and network
execution / `python_exec` stay disabled.

## Installed GUI smoke
Verify the installed app end-to-end with `npm run smoke:installed` — see
[installed-smoke.md](installed-smoke.md). It now includes a **coding scenario** (edit → test →
diff → rollback + protected-path denial) against the installed coding-engine bytes. `GET /health` now returns version + capability flags
(`features.network_enabled`/`python_exec_enabled` = false, `rag_enabled`, `approval_enabled`,
`domain_packs`, embedding posture) so DAWN can validate it is talking to AgentOS and that
dangerous capabilities remain off.

## Using it from DAWN chat
Enable **Tools** in DAWN Settings (AgentOS is on by default: `agentosEnabled`).
Then just ask, e.g.:
- "Use AgentOS to audit `C:\Users\benma\dawn` for vulnerabilities."
- "Delegate a security review of the electron services to AgentOS."
- "Have the agents plan how to add feature X."

The model calls `delegate_to_agents` with:
```json
{ "task": "string", "mode": "audit|research|plan|code_review|summarize",
  "target_path": "optional absolute path", "max_runtime_seconds": 120 }
```

## Result shape DAWN receives
```json
{ "ok": true, "summary": "...", "findings": [{severity,file,title,detail,fix}],
  "recommendations": ["..."], "proposed_patches": ["...proposal only..."],
  "audit_log_path": "C:\\Users\\benma\\agentos\\runs\\run_xxx.jsonl",
  "agentos_run_id": "run_xxx", "agents_used": ["planner","repo_auditor",...],
  "blocked_actions": [], "errors": [], "transport": "http|cli" }
```

## Current permissions (from DAWN)
| Capability | State | Notes |
|---|---|---|
| Analyze / audit / review / plan / summarize | ✅ allowed | read-only |
| Local knowledge (RAG) ingest / search / answer | ✅ allowed | local only; ingest needs user confirm |
| File **writes** | ⚠ per-run approval | one signed, expiring grant per action (not a global switch) |
| **Shell** / test commands | ⚠ per-run approval | allow-listed argv only, one signed grant |
| **Network** | ❌ denied | execution disabled this phase |
| **python_exec** | ❌ denied | disabled in AgentOS too |
| Protected paths (`.env`,`.ssh`, system dirs, Program Files, browser profiles, keys, registry) | ❌ denied | validated before AgentOS is called |

## Security controls (DAWN side)
- No arbitrary command construction; CLI uses a spawn **argv array** (no shell).
- Timeout on HTTP and CLI; output capped + control-char/ANSI stripped.
- Secrets redacted from anything rendered to the user (AgentOS also redacts).
- `target_path` must be absolute, existing, and not protected.
- Untrusted task text is passed as a bounded task, never as system authority; it
  cannot enable capabilities (the flags are forced off here and re-checked in AgentOS).
- Every invocation is logged DAWN-side (`logger.info('agentos', ...)`) and fully in
  AgentOS's per-run JSONL audit (`audit_log_path`).

## Tests
```bash
cd C:\Users\benma\dawn
npm run test:agentos     # 40 tests: unavailable, CLI ok/fail, malformed, timeout,
                         # protected path, allow_* denied, secret redaction, success,
                         # signed-grant mint flow, and local-knowledge (RAG) modes
```

## Current limitations
- Generic delegate is read-only; side effects only via the per-run approval flow.
- `research` mode needs network → AgentOS returns "blocked" until network is approved.
- `proposed_patches` is populated only when AgentOS's coder agent returns a diff;
  audit/summarize/plan modes won't produce patches.

## Per-run approval flow (IMPLEMENTED — signed grants)
DAWN grants a **one-time, expiring, run-scoped** approval for a single AgentOS side
effect — without any global "allow writes/shell/network" switch.

Flow: AgentOS returns `status:"approval_required"` + an `approval_request` →
`chat.ts` shows DAWN's approval card (`requestApproval`) with the capability, files,
exact command argv, redacted patch preview, risk, reason, and expiry → on **Approve
once**, DAWN asks AgentOS to **mint + HMAC-sign** the grant
(`agentos.mintGrant` → `POST /grant` or CLI `mint-grant`), then sends the signed grant
to `POST /approve` (or CLI `approve --json`, grant on STDIN). **DAWN never builds or
signs the grant** — AgentOS derives every field from its own request and is the sole
signing/enforcement authority; it independently validates the signature + invariants
and burns the grant after one use. If no signed grant is issued, DAWN fails closed
(nothing runs). On **Reject**, nothing runs.

Settings (default-safe): `agentosApprovalRequired:true`, `agentosAllowPatchApproval:true`,
`agentosAllowTestApproval:true`, `agentosAllowNetworkApproval:false`,
`agentosApprovalTtlSeconds:300`, `agentosMaxApprovedCalls:1`. Network execution stays
disabled regardless. See AgentOS `docs/approval-flow.md` and `docs/security_model.md`.

## Local knowledge (RAG)
`delegate_to_agents` also supports local-knowledge modes — see
[local-knowledge-rag.md](local-knowledge-rag.md). Briefly: `mode:"rag_ingest"` (index a
local folder/file — the user confirms via the approval card), `mode:"rag_search"`
(retrieve cited passages), `mode:"rag_answer"` (cited, source-grounded answer). All local
(no cloud), protected paths auto-skipped, secrets redacted, prompt-injection flagged and
never followed.

## Future work
1. **Approval UI polish** — a dedicated approval card component (diff viewer) rather
   than the generic tool-request modal.
2. **Apply proposed patches** — after human approval, hand a coder diff to DAWN's
   file agent (which already has preview+approve+undo).
3. **RAG UX** — a dedicated Knowledge panel (collections, sources, re-index) on top of
   the implemented `rag_*` modes.
4. **Streaming** — stream AgentOS step events into the DAWN chat as they happen.

## Domain packs (delegate_to_agents `domain`)
`delegate_to_agents` accepts an optional `domain` (security, software_engineering,
design, strategy, sales, scriptwriting, game_development, finance, engineering,
academic_research, support, spatial_computing, media_production). DAWN forwards it to
AgentOS `/run` (or `--domain` via CLI), shows which domain agents ran (`agents_used`),
and renders their findings/recommendations. Domain packs are READ-ONLY (no write/
shell/network); proposed patches are proposal-only and go through the approval flow.
Unknown domain fails closed in DAWN; an older AgentOS that ignores the field still works.
See AgentOS `docs/domain-packs.md`.
