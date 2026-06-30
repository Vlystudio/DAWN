# DAWN Native File-Edit Tools

The Coding Agent's first-class edit tools (`electron/services/coding/*`). All are
**workspace-scoped**, **checkpoint before changing**, return a **redacted diff**, are
**audited**, and **fail closed**. They never expose write access outside the selected
workspace.

| Tool | Purpose | Key rules |
|---|---|---|
| `fs_write_file` | create/overwrite a text file | inside workspace; protected/binary/oversize denied; checkpoint first; returns diff |
| `fs_create_file` | create a new file | default `overwrite:false` (fails if it exists) |
| `fs_edit_file` | exact-text replacement(s) | each `old_text` must match exactly; 0 matches → fail; multiple matches → fail unless `allow_multiple` |
| `fs_apply_patch` | apply a unified diff | every target validated (inside workspace, not absolute, not protected, not binary); large/too-many → approval; checkpoint first |
| `fs_delete_file` | reversible delete | requires approval even in autopilot; backed up to checkpoint; rollback restores |
| `fs_get_diff` | current workspace diff | `git diff` (git) or checkpoint comparison (non-git); secrets redacted |
| `fs_checkpoint` | snapshot before first write | git baseline or per-file copies |
| `fs_rollback_checkpoint` | revert a run | restores originals; removes created files; only files the run touched |

## Path safety (every write)
1. Resolve the target against the workspace root; reject traversal (`..`) and absolute paths
   that escape.
2. Reject the workspace root itself.
3. Reject protected segments (`.git`, `node_modules`, `windows`, `program files`, `.ssh`, …),
   credential/browser fragments, and secret files (`.env`, `*.pem/.key/.pfx`, `id_rsa`, …).
4. Realpath/symlink check: reject if the resolved real path escapes the real workspace root.
5. Reject binary content and files over the size limit; only editable text types.

## Patch safety
Unified diffs are parsed, then **every** target path is validated before anything is written.
Binary patches, absolute/escaping paths, protected files, and over-limit patches are rejected
(over-limit → approval). Hunks are applied by locating the exact context block and replacing
it; a stale/ambiguous context **fails closed** (no guessing). A checkpoint is created first; a
post-apply diff is returned.

## Secret redaction
Diffs, command output, and audit entries pass through DAWN's secret redactor. If an edit/patch
would write a secret-looking value, it still goes through redaction in any displayed diff; the
file content the user explicitly approves is what's written. Secret files themselves can never
be edited.

Tested in `tests/coding.test.ts` (pure validation) and `tests/codingEngine.test.ts` (real temp
workspace: write/create/edit/apply/delete/checkpoint/rollback/diff + protected denial +
redaction).
