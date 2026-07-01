# DAWN — Workspace Graph

**Sidebar → Workspace → Workspace Graph** (or the "Open Workspace Graph" command).

The Workspace Graph is DAWN's unifying layer: lightweight, typed **items** that can be **linked**
to each other across features, then searched and shown in the Brain. It lets a note, the task it
became, the document it references, and the research run that produced it all hang together.

## Items

An **item** is a typed handle (optionally pointing at an underlying feature row via `ref_id`):

`conversation · message · memory · knowledge_source · knowledge_chunk · document · note · task ·
calendar_event · email_account · email_thread · email_message · research_run · research_source ·
model · benchmark · tool · tool_run · skill · skill_run · obsidian_note · notion_page · coding_run ·
file_agent_action · dcd_operation · backup · setting · security_event`

Items are **de-duplicated** by `(type, ref_id)` — registering the same feature row twice updates it
instead of creating a copy. Metadata is stored as capped, validated JSON (never throws, no blobs).

## Links

A **link** is a typed, directional edge between two items:

`created_from · references · summarizes · expands_on · attached_to · related_to · converted_to ·
uses_source · uses_memory · uses_tool · uses_model · generated_by · scheduled_as · assigned_to ·
exported_to · imported_from`

- **Duplicate links are prevented** at the database level (`UNIQUE(from_id, to_id, type)`).
- **Deleting an item removes its links** — no dangling edges. (The underlying note/task/etc. is *not*
  deleted; only the graph item + its edges.)
- **Related lookup** walks edges in both directions and returns the connected item + the edge.

## Cross-feature actions (real, not stubs)

- **Convert to Task** — turns a workspace item into a real Task (`tasks.create`) and adds a
  `converted_to` link.
- **Save as Note** — saves text (e.g. a chat reply) as a real Note and links it `created_from` a
  source item.

More cross-feature wiring (chat → save/convert, email → task/calendar) hangs off these primitives.

## Where items show up

- **Global Search** — workspace items are a search source (`workspace`), so they appear alongside
  notes/tasks/docs. The vault is still never searched.
- **Brain** — workspace items are injected as `workspace_item` nodes in the **Workspace** cluster,
  and links become edges. They appear on the next Brain rebuild.

## API

- IPC: `workspace:items:{list,get,create,update,delete}`, `workspace:links:{list,create,delete}`,
  `workspace:related:get`, `workspace:search`, `workspace:convertToTask`, `workspace:saveAsNote`.
- Preload: `window.dawn.workspace.*`.
- Services: `electron/services/workspace/{items,links,search,workspace}.ts` over the pure
  `workspaceCore.ts` (validation / safe metadata / dedupe), unit-tested in `tests/workspaceGraph.test.ts`.

## Data stored locally

Two tables: `workspace_items` (id, type, ref_id, label, source_feature, metadata, timestamps) and
`workspace_links` (id, from_id, to_id, type, metadata, created_at, UNIQUE). **No secrets** — labels
are non-secret handles; the vault is never represented here.

## Auto-registration (from real features)

DAWN auto-registers **real persisted rows** as workspace items — no manual create needed. The
registry (`electron/services/workspace/registry.ts`) reconciles these sources via pure adapters
(`adaptersCore.ts`):

| Source | Item type |
|---|---|
| conversations | `conversation` |
| memories | `memory` |
| notes | `note` |
| tasks | `task` |
| documents | `document` |
| research_runs | `research_run` |
| benchmarks | `benchmark` |
| email_accounts | `email_account` |

Behaviour:

- **Idempotent upsert** — keyed by `(type, ref_id)`; the same source row never duplicates.
- **Updates in place** — when the source row changes (title/label), the item updates.
- **Safe orphan pruning** — if a source row is deleted, its auto-registered item (and its links) is
  removed. **Manual items are never pruned** (they have no `ref_id` / `source_feature = workspace`).
- **When it runs** — on opening the Workspace Graph (and the refresh button), and on every **Brain
  rebuild**. IPC: `workspace:reconcile`, `workspace:coverage`.
- **Never registers secret-bearing tables** (vault/auth/audit). Email registers the *account*
  (label/address), never the credential.

System Health distinguishes **Workspace Graph** (core items/links) from **Workspace
Auto-Registration** (this reconciler).

## Visual linking (no IDs)

Linking is fully visual — you never paste an item id:

- In **Workspace Graph**, open an item → **+ Link…** → choose a relationship type → **Choose target
  item…** opens the **item picker** (search + type filter, shows label/type/source/date/snippet).
- In **Chat**, any reply has a **Link** action → pick a workspace item to link the conversation to.
- The picker searches real workspace items only (`workspace:search`, parameterized) — the vault/auth/
  audit are never in the workspace tables, so they can never appear.
- `links.create` blocks self-links and invalid types and returns a friendly **"already linked"** for
  duplicates (no crash). `RelatedItemsPanel` lets you **add / open / remove** links and **filter by
  relationship**.

Components: `WorkspaceItemPicker`, `WorkspaceLinkDialog`, `RelatedItemsPanel`. The picker's search SQL
is the pure, tested `buildWorkspaceSearchSql` (parameterized, `excludeId`, type/source/link filters).

## Limitations / next steps

- Auto-registration has **live hooks** for Notes, Tasks, Documents, Memories, **Knowledge sources** (register on index; prune on removed/skipped/folder-delete — **name only, never the full path/content**), **Benchmarks** (register on run; prune on delete — **public model name only**), and **Research runs** (register on start — label is **the user's own question, never fetched web content**; runs are never deleted and the completion path reconciles the final status). All are instant register/update/prune and idempotent (items dedupe by `type+ref_id`, using the exact `type`/`feature` of the matching reconcile adapter so live + reconcile can't diverge; `tests/liveHooks.test.ts` guards this). Still **reconcile-only**: **Email** (accounts register via reconcile; a live hook there must never touch credential metadata or message bodies). Reconcile remains the fallback for everything and stays idempotent (scans real sources on Workspace open / Brain rebuild). No vault/auth/audit source is ever live-registered.
- Brain node details now expose inline linking for workspace_item nodes (Related items + "+ Link…" using the visual picker).

## Image attachments in the graph

A chat conversation that carries image attachments gets **safe** flags merged into its workspace-item
metadata during reconcile — `has_image_attachment: true`, `attachment_type: 'image'`, `attachment_count`
— and nothing else. No file path, bytes, content hash, filename, EXIF, or OCR/vision text ever enters
workspace metadata, Global Search, or diagnostics. The merge is computed by the pure, tested
`adaptersCore.withImageMeta` and recomputed each reconcile, so it survives Brain rebuilds.
