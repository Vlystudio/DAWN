# DAWN ↔ D.C.D (Dawn Cyber Defense) Integration

DAWN can operate your local antivirus, **D.C.D**, from chat — run scans, check the system,
quarantine files, harden Defender, etc. — just by asking. Fully local.

> "Do a full system scan for threats and tell me what you find."
> "Check my PC for persistence and rootkits." · "Quarantine that file." · "Is real-time
> protection on?" · "Block 203.0.113.4 at the firewall."

Enable it in **Settings → 🛡️ D.C.D (antivirus) integration** (on by default when D.C.D is
installed).

## How it works
D.C.D ships a trusted frozen engine at `C:\Program Files\Dawn Cyber Defense\engine\engine.exe`
with a JSON CLI. DAWN drives it via the `delegate_to_dcd` chat tool
([electron/services/dcd.ts](../electron/services/dcd.ts)): the model picks an **operation from a
fixed allowlist**, DAWN builds the **argv array** (no shell, no interpolation), spawns the
**trusted engine** (`--json`), parses the result, redacts secrets, and reports findings. The
model never supplies raw engine arguments.

## Operations
**Read-only (run freely):** `scan` (ClamAV+YARA; `type: quick|full`, or a `path`),
`defender_scan` (Microsoft Defender; `quick|full|custom`+`path`), `status`, `system_status`,
`defender_status`, `defender_threats`, `persistence`, `rootkit`, `netscan`, `behavior_check`,
`memscan` (`pid?`), `ransomware_status`/`ransomware_check`, `clamav_status`, `yara_status`,
`quarantine_list`, `schedule_status`, `watchdog_status`.

**State-changing (approval):** `clamav_update`, `defender_update`, `ransomware_deploy`/
`ransomware_remove`, `quarantine_add` (`path`), `quarantine_restore` (`id`).

**Elevated (approval + Windows UAC):** `defender_harden`, `defender_realtime` (`state: on|off`),
`defender_remove_threats`, `behavior_kill` (`pid`), `firewall_block` (`ip`),
`schedule_install`/`schedule_remove`, `watchdog_install`/`watchdog_remove`.

A "full system scan for threats" runs `scan` with `type:"full"` (ClamAV+YARA) and/or
`defender_scan` with `type:"full"`. Full scans can take several minutes; DAWN shows a
"this can take a while…" status.

## Safety model
- **Argv only, no shell** — the engine is spawned with a discrete argument array; the model's
  parameters (path/pid/id/ip/state) are validated and passed as separate args (no injection).
- **Trusted engine only** — DAWN runs `engine.exe` from the install dir (or a settings
  override that must also be `engine.exe`); it never runs `python.exe`/`cmd`/`powershell` as
  the engine.
- **Operation allowlist** — only the operations above; an unknown operation is rejected.
- **Elevation** — elevated ops run the trusted frozen engine via `Start-Process -Verb RunAs`
  (Windows UAC prompts), with output captured through a temp file. DAWN refuses to elevate any
  non-engine executable. Toggle off via "Allow elevated D.C.D actions".
- **Approval** — read-only scans/status run without prompts; state-changing/elevated ops ask
  for approval. In **Full Power mode** the approval is "ask once per operation per session".
- **Redaction** — all engine output is secret-redacted before the model/chat sees it.

## Result shape (scan)
DAWN summarizes the engine's `ScanResult` (`files_scanned`, `tools_used`,
`severity_counts {Critical/High/Medium/Low}`, `total_findings`, and a `findings[]` list with
`severity`, `path`, `rule_or_signature`, `sha256`). It surfaces the top findings and
recommends quarantine for malicious files (asking before quarantining).

## Settings
`dcdEnabled` (true), `dcdAllowElevated` (true — still prompts + UAC), `dcdEnginePath`
(optional override of the trusted `engine.exe`). Also available via IPC: `window.dawn.dcd.{available, operations, run}`.

## Tests / verification
`tests/dcd.test.ts` — operation allowlist, argv construction, parameter validation, read-only
vs elevated routing, trusted-engine resolution, JSON parsing, redaction. Verified live against
the installed engine (status / system_status / quarantine_list / path scan all return parsed
results).

## Troubleshooting
- "D.C.D engine not found" → install Dawn Cyber Defense, or set the engine path in Settings.
- An elevated op did nothing → you likely declined the UAC prompt (D.C.D reports
  "user declined the UAC elevation prompt").
- A scan reports 0 findings but you expected detections → run `clamav_update` / `defender_update`
  first (signatures may be stale).
