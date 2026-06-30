# DAWN Coding Workspaces

A **coding workspace** is a folder you explicitly trust DAWN to edit. It is the boundary of
the Coding Agent: all edits are confined to it, and protected files inside it are still
off-limits.

## Selecting one
**Sidebar → Coding → Add folder…** Pick a normal project folder. DAWN validates it and stores
it locally (`<userData>/coding/workspaces.json`). No secrets are stored.

## What is rejected (with a reason)
- A whole drive root (`C:\`, `C:`), or any top-level location.
- Your user-profile root (`C:\Users\you`) and `C:\Users` (all profiles).
- Desktop / Documents / Downloads / Pictures / Music / Videos / OneDrive **roots** (a project
  subfolder inside them is fine).
- `AppData`, `Program Files`, `Windows`/`System32`, `ProgramData`.
- `.ssh`, credential/browser-profile folders, and any protected path segment.
- Anything containing your profile, or that fails the symlink/realpath check.

## Per-workspace settings
`mode` (chat_only | propose_patch | workspace_autopilot | batch_review), `autopilot_enabled`,
`allow_file_create`, `allow_file_delete` (default off; always approval), `allow_test_commands`,
`max_iterations`, `max_files_per_run`, `max_diff_lines_per_run`, `max_command_seconds`,
`requires_approval_for_large_diff`, `requires_approval_for_delete` (always true). Edit these in
the Coding panel; **Remove** detaches the workspace (your files are untouched).

## git vs non-git
- **git repo** (`.git` present): DAWN records a baseline and uses `git diff` for display;
  rollback restores only files the run touched; it never auto-commits or pushes.
- **non-git**: DAWN copies original files into a per-run checkpoint as they're first edited;
  rollback restores them and removes files the run created.

## Project instruction files
DAWN reads (advisory only) `DAWN.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`,
`pyproject.toml`, `tsconfig.json`, and common test/build configs to learn conventions and test
commands. These **cannot** change security rules, widen the workspace, enable network/
python_exec, approve tools, or disable redaction — they are guidance, not authority. DAWN can
also generate a suggested `DAWN.md` for a repo on request.
