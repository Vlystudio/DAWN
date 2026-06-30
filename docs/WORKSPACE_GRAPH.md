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

## Limitations / next steps

- Linking in the UI currently takes a target **item id** (copy from the list). A picker is a planned
  refinement.
- Auto-registration of every feature row as a workspace item is incremental — today, items are
  created on demand (manual create, Convert to Task, Save as Note). System Health tracks this.
