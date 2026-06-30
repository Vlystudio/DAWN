# DAWN Coding Autopilot

A local, private coding agent inside DAWN — closer to Claude Code/Cursor, but fully local.
Give it a trusted workspace and a task; it reads files, edits/creates code, runs safe tests,
iterates on failures, shows a diff, and lets you roll back. **High autonomy inside a trusted
workspace, not access to your whole computer.**

Open it from the sidebar: **Coding**.

## What it can do
- Inspect a selected repo/workspace and read project instructions (DAWN.md / AGENTS.md /
  CLAUDE.md / README / package.json / configs).
- Plan an implementation, then **edit and create files** with native tools.
- Apply **unified-diff patches** safely.
- Run **allowlisted** test/lint/typecheck commands and read failures.
- **Iterate** fixes up to `max_iterations`.
- Produce a **final diff**, list files changed + commands run, and a **rollback**.
- Optionally use **AgentOS** (`software_engineering` domain) for a deeper plan/proposed
  patches — which DAWN still validates and applies through its own tools.

## What it cannot do (boundaries — non-negotiable)
- Edit anything **outside the selected workspace root**.
- Touch protected files even inside the workspace: `.env`, keys (`.pem/.key/.pfx/…`),
  `.git`, `node_modules`, credential stores, browser profiles, OS/system folders.
- Run arbitrary shell. Commands are an **argv allowlist** (test/lint/typecheck only) — no
  pipes, redirects, chaining, install, network, or destructive commands; never `shell=true`.
- Sign/forge AgentOS grants, enable network execution, or enable `python_exec`.
- Show raw secrets — they're redacted from diffs, logs, command output, and chat.

## Workspace trust model
A workspace is a folder you explicitly select. It must be a normal project folder — **not**
a drive root, your user-profile root, Desktop/Documents/Downloads roots, AppData, Program
Files, Windows/System32, `.ssh`, or any protected location (rejected with a reason). Symlinks
are resolved and symlink escapes are rejected. If the folder has `.git`, DAWN uses
`git diff`/status; otherwise it uses its own **checkpoint snapshots**. See
[workspaces.md](workspaces.md).

## Autonomy modes (per workspace)
| Mode | Behavior |
|---|---|
| `chat_only` | Explain/plan only; no edits. |
| `propose_patch` | Proposes changes; you apply them. Nothing is written. |
| `workspace_autopilot` | Edits inside the workspace without approving every small change (checkpointed first). |
| `batch_review` | Iterates edit→test→fix, then shows the final diff for review. No auto-commit, no push, no installs. |

Even in autopilot, DAWN **stops and asks** for: file **delete**, a **large diff** over your
limit, **too many files**, and **sensitive files** (package/lockfiles, build/deploy/auth/
payment/security config). Denied → the op is skipped and noted.

## Coding run (state machine)
`planning → reading → editing → testing → fixing → (awaiting_approval) → completed | failed
| rolled_back`. Each run: validates the workspace → **checkpoints** → reads instructions →
scans files → asks the model for structured ops → validates + applies each through the
engine → runs allowlisted tests → feeds failures back → repeats up to `max_iterations` →
final diff + rollback. Limits: `max_iterations`, `max_files_per_run`, `max_diff_lines_per_run`,
`max_command_seconds` (all editable in the panel).

## Native edit tools
`fs_write_file`, `fs_create_file`, `fs_edit_file` (exact text replace), `fs_apply_patch`
(unified diff), `fs_delete_file` (approval + reversible), `fs_get_diff`, `fs_checkpoint`,
`fs_rollback_checkpoint`. All are workspace-scoped, checkpoint before changing, return a
redacted diff, and fail closed. See [file-edit-tools.md](file-edit-tools.md).

## Checkpoints & rollback
- **git**: baseline recorded; `git diff` for display; rollback restores only files touched by
  the run; never auto-commits or pushes.
- **non-git**: original files are copied into a per-run checkpoint as they're first touched;
  rollback restores originals and removes files the run created.

## Safe test/lint/typecheck runner
Allowed: `npm test`, `npm run test|lint|typecheck[:*]`, `npx tsc --noEmit`, `npx vitest run`,
`pnpm/yarn test|lint|typecheck`, `python -m pytest -q`, `pytest -q`, `ruff check .`, `mypy .`.
**argv arrays only**, cwd = workspace root, timeout + output cap, output redacted. DAWN infers
commands from `package.json`/`pyproject.toml`, but inferred commands must still pass the
allowlist.

## Coding model role
DAWN routes coding to `modelRoles.coding` when configured. If not, it runs on the current
chat model with a warning: *"Coding Autopilot is running on the current chat model. For better
results, configure a dedicated coding model (e.g. Qwen2.5-Coder)."* The panel shows the model
in use and the warning. Configure the coding role in Settings / Model Hub. All local.

## AgentOS integration
DAWN owns workspace selection, editing, checkpoints, rollback, and command execution. AgentOS
(`software_engineering` domain, via `implementCode`) can propose a plan + patches; DAWN
**validates every proposed patch** against the workspace and applies it through
`fs_apply_patch` — AgentOS can never write directly or bypass workspace validation.

## Using it from chat
- "Use Coding Autopilot on `proj` to add a dark-mode toggle."
- "Fix the failing tests in `myapp`."
- "Show the diff for `proj`." · "Rollback the coding run `crun_…`."
Chat tools: `coding_run`, `coding_diff`, `coding_rollback` (the run is confirmed once, then
runs with per-op gates). The **Coding panel** is the primary UI.

## Audit & redaction
Every run logs to `<userData>/coding/coding-audit.jsonl` (redacted): run started/completed/
failed, checkpoint, file read/written/edited/created/deleted, test started/completed,
iteration start/end, approval required, rollback. No raw secrets, no huge file dumps.

## Troubleshooting
- "Cannot use this folder" → it's a drive root / profile root / protected location; pick a
  specific project subfolder.
- "old_text not found" → the model's exact-edit didn't match; it will retry, or switch to a
  coding model for better edits.
- Tests don't run → enable **allow tests** for the workspace and ensure a `test` script
  exists (`package.json`) or `pytest` is configured.
- Weak edits → configure a coding model (`modelRoles.coding`).

## Tests / verification
- `npm run test:agentos` — pure core (workspace/path/patch/commands), engine
  (write/edit/patch/checkpoint/rollback/diff/command-runner), and orchestrator (state machine,
  modes, approvals).
- `npm run smoke:installed` includes a coding scenario (edit → test → diff → rollback +
  protected-path denial) against the installed bytes. See [installed-smoke.md](installed-smoke.md).
