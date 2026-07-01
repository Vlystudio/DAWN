# DAWN — UI System (Design System)

DAWN's UI is built from a small shared component layer so screens look and behave consistently while
keeping DAWN's futuristic identity. Status: the **library is implemented and adopted in new screens**;
migrating the older screens is incremental (System Health tracks this as **Design System → Partial**).

## Layers

- **`src/ui/primitives.tsx`** — base building blocks: `Badge`, `Spinner`, `EmptyState`,
  `ErrorCallout`, `SectionHeader`, `HelpNote`, `ConfirmDialog`.
- **`src/ui/system.tsx`** — the design system on top of primitives:
  - `PageShell` — standard page header (icon + title + subtitle + actions) and scroll container.
  - `StatusBadge` / `HealthBadge` — consistent status tone mapping (Ready/Partial/Needs setup/Broken/Missing).
  - `LoadingState` / `ErrorState` / `EmptyState` — consistent async states.
  - `ActionBar` / `Button` (primary/secondary/danger, visible focus ring).
  - `DataTable<T>` — simple consistent table (columns → cells, empty state, optional row click).
- **Feature components** reused across screens: `SetupChecklist`, `RelatedItemsPanel`.

## Conventions

- **Page header:** every screen should use `PageShell` (title + optional subtitle + right-aligned
  actions). New screens do; legacy screens are migrated over time.
- **Status:** use `StatusBadge`/`HealthBadge` so colours/labels are identical everywhere. Colour is
  never the only signal (label text + dot).
- **States:** use `LoadingState`, `ErrorState`, `EmptyState` instead of one-off markup.
- **Buttons:** `Button` variants for primary/secondary/danger; focus rings are visible
  (`focus-visible:ring`).
- **Routing:** sidebar labels, command-palette labels, and route titles must match. A test
  (`tests/routeConsistency.test.ts`) enforces: no duplicate route keys, every System Health area +
  search source opens a **real** route (no dead links).
- **Motion:** animations use `motion-reduce:animate-none` where practical; reduced-motion is respected.
- **Language:** no public-launch / public-beta wording — DAWN is a private/internal build.

## Adoption status (honest)

- **Adopted:** System Health, Setup Center (PageShell + LoadingState/ErrorState + Button),
  Workspace Graph, Email Setup wizard (shared primitives), Global Search.
- **Pending migration:** Dashboard, Model Hub/Manager/Optimizer, Research, Documents/Notes/Tasks/
  Calendar, Tools/Skills, Security/Vault, Backup, Obsidian/Notion, Voice, Companion, D.C.D, Settings,
  Logs. These work today; they just predate the shared layer. Tracked as **Partial** in System Health.

## Next step

Migrate the pending screens to `PageShell` + `DataTable` + shared states, one screen per change, with
the route-consistency test guarding against regressions. When the major screens are migrated, the
System Health "Design System" area moves from **Partial → Complete**.

## Status language (one source of truth)

`src/lib/statusMap.ts` is DAWN's single, tested source of truth for status language. It maps every
status code — in groups **feature / knowledge / retrieval / modelFit / toolRisk / setup** — to a
**display label**, a **badge tone** (uiCore `BadgeKind`), a **plain-English explanation**, and an
optional next-action hint. `resolveStatus(group, key)` never throws: an unrecognised code resolves to
a neutral **"Unknown"** badge (never a crash, never fake reassurance).

Adopted by: `StatusBadge` (`ui/system.tsx`), **System Health**, **Setup Center** (`SetupChecklist`),
and **Model Cookbook** — so a status means the same thing (and looks the same) everywhere. Screens
still to adopt it are the legacy screens tracked under **Design System → Partial** in System Health.
Tests: `tests/statusMap.test.ts` (valid tones, documented statuses, safe Unknown, no dup keys).

## Risk colours from the central map

Tool/Skill **risk** colours are now derived from the central status map's `toolRisk` tones
(`statusTextClass('toolRisk', level)`) instead of a duplicated per-screen literal — one source of
truth. A regression test asserts the derived colours are byte-identical to the previous mapping.

### Migration note (honest)

Legacy screens with **split / flex-1-scroll layouts** (e.g. Logs' fixed-header + scrolling log box,
the master–detail Research/Documents/Skills views) are **not** blindly wrapped in `PageShell` — doing
so changes their scroll/split behaviour, which needs visual verification. Those migrations are done
one screen at a time with a human in the loop; System Health keeps **Design System → Partial** with
the exact list until then. The status-language layer (labels, tones, risk colours) is already unified.

## Layout-safe shell variants (beta.13)

The original `PageShell` only fits simple top-scroll pages. Forcing it onto split/log/canvas screens
breaks their scroll behaviour (the beta.12 lesson). So there are now **layout-safe variants**
(`src/ui/system.tsx`, layout classes in `src/ui/shellLayout.ts`, invariants unit-tested in
`tests/shellLayout.test.ts`):

| Variant | Use for | Guarantee |
|---|---|---|
| `PageShell` / `PageShellPanel` | simple top-scroll pages / card grids | single top-level scroll |
| `PageShellSplit` | master–detail (sidebar + main + optional detail) | fixed header, **independently-scrolling** columns, no double-scroll |
| `PageShellLog` | logs / diagnostics | **fixed** header/actions + one scrollable body box (`bodyRef`/`bodyClassName` preserve auto-scroll) |
| `PageShellCanvas` | brain / graph / canvas | header + **full-bleed non-scrolling** canvas + optional scrolling detail panel |

The invariants are testable without rendering: e.g. a split shell's `splitBody` must be a *clean flex
host* (fills + shrinks + does **not** scroll) while its columns each scroll; a log shell's header must
be fixed while exactly the body scrolls. `tests/shellLayout.test.ts` asserts these on the class strings.

**Migrated so far:** Logs → `PageShellLog` (fixed header + scroll box preserved), Model Manager / Model
Hub / **Model Optimizer** / **Tasks** / **Backup** / **Obsidian** / **Notion** → `PageShellPanel`,
Notes / **Documents** → `PageShellSplit`. Others migrate one at a time using the matching variant;
System Health tracks the remaining list under **Design System → Partial**.

The full, code-backed status (which screens, which variant, and — for split screens — whether a human
has visually verified them) lives in **[`docs/UI_MIGRATION_CHECKLIST.md`](UI_MIGRATION_CHECKLIST.md)**,
generated from the `electron/services/uiMigrationCore.ts` registry that System Health also reads.

## PageShellSplit proof pattern (Notes)

**Notes** is the first master–detail screen migrated to `PageShellSplit` (beta.14). Pattern:

- `sidebar={<>…fixed buttons…<div className="flex-1 overflow-y-auto">…list…</div></>}` — the sidebar
  column is a **flex host**, so its fixed "New note"/search stay put while the list scrolls inside.
- `children` = the detail pane (empty state or editor) — the main column is a flex host, so the
  editor's action bar stays fixed while the textarea/links scroll.
- A consistent page header (title + subtitle) is added on top; **no double-scroll**, columns scroll
  independently, live workspace hooks for Notes are unchanged (only the view wrapper changed).

### Human visual-verification checklist (Notes, after installing beta.14)

1. Notes opens from the sidebar. 2. Master list is visible on the left. 3. Detail pane on the right.
4. Clicking a note fills the detail pane. 5. **New note** works. 6. Editing title/tags/body works.
7. Deleting a note (trash on hover) works. 8. The list scrolls independently. 9. The editor body
scrolls independently. 10. The page header + New-note/search stay fixed. 11. Empty state ("No notes")
looks right. 12. No clipped content, no overlap, no double-scroll. 13. Creating/deleting a note updates
the **Workspace Graph** (live hook). If any fail, revert `NotesView` to its pre-beta.14 layout.

**Migrated (beta.14):** Model Hub (`PageShellPanel`), Notes (`PageShellSplit`, the one split proof).
Only one split screen was migrated in beta.14 on purpose — verify Notes before rolling out further.

## beta.15 — controlled continuation

Following the beta.14 lesson (migrate splits in **small batches** after the flex-host proof), beta.15
adds exactly:

- **Model Optimizer → `PageShellPanel`** — simple top-scroll page (hardware scores + auto-tune). The
  fixed toast stays a child; scroll model unchanged. No behaviour change.
- **Documents → `PageShellSplit`** — the **second** master–detail screen on the split shell. It is
  structurally identical to Notes (sidebar: New/Import + `flex-1 overflow-y-auto` list; main:
  empty-state or editor with fixed sub-header + AI toolbar + scrolling body). Same flex-host guarantee
  — fixed sub-headers stay, list/editor scroll independently, no double-scroll. Documents' live
  workspace hooks are unchanged (only the view wrapper changed).

### Human visual-verification checklist (Documents, after installing beta.15)

1. Documents opens from the sidebar. 2. Master list on the left, editor on the right. 3. Clicking a doc
fills the editor. 4. **New** works. 5. **Import** (.md/.txt/.html/.csv) works. 6. Editing title/body +
autosave ("Saving…→Saved") works. 7. Preview/Edit toggle works. 8. **History** dropdown opens (save/
restore a version). 9. AI toolbar actions run (brain → THINKING). 10. Export chips (md/txt/html/csv)
download. 11. The doc list scrolls independently. 12. The editor body scrolls independently. 13. The
page header + New/Import + editor sub-header/AI toolbar stay fixed. 14. Empty state ("No documents")
looks right. 15. No clipped content, overlap, or double-scroll. 16. Creating/deleting a doc updates the
**Workspace Graph** (live hook). If any fail, revert `DocumentsView` to its pre-beta.15 layout.

### Knowledge live workspace hook (beta.15)

Knowledge sources now register/prune in the Workspace Graph **live** (not just on reconcile): `rag.ts`
calls `live.register('knowledge_source', id, name, 'knowledge')` right after a file is indexed, and
`live.remove(...)` when a source is removed, skipped, or its folder is deleted. The hook passes the
**name only — never the full path or content** (privacy). It uses the exact `type`/`feature` of the
reconcile adapter, so live + reconcile can't diverge and items dedupe by `type+ref_id`
(`tests/liveHooks.test.ts` guards this against drift). Reconcile remains the fallback; hooked features
are now Notes/Tasks/Documents/Memories/**Knowledge** (Research/Benchmarks/Email stay reconcile-only).

## beta.16 — verification gate + two more simple panels

- **Migration registry (`electron/services/uiMigrationCore.ts`)** — a pure, unit-tested source of
  truth for the migration: each screen, its shell variant, and (for split screens) its human
  verification state. System Health's Design System area and `docs/UI_MIGRATION_CHECKLIST.md` both
  read it, so the three can't drift. It exposes `canMigrateAnotherSplit()`, which stays **false**
  while any split screen is pending — the rule "don't roll out more splits until Notes/Documents are
  visually verified" is enforced in code, not memory.
- **Tasks → `PageShellPanel`** and **Backup & Restore → `PageShellPanel`** — two clean single-scroll
  panels migrated (identical wrapper to Model Optimizer). Tasks keeps its inline-expanding rows and
  live hooks; Backup keeps its RESTORE safety flow (typed confirm + optional password + approval).
  No split screen was migrated this batch — the gate is closed while Notes/Documents await a human
  pass. Deferred with reasons: Calendar (inline toolbar header), Skills (split — gated), Security
  (redaction-sensitive), Settings (nested scrollers).

## beta.17 — gate held closed (verification not provided) + two integration panels

- **The split gate stayed CLOSED.** A Notes/Documents verification result was requested but the report
  came back with the unfilled template placeholder, not a real PASS/FAIL — so neither was marked
  confirmed and **no split screen was migrated**. The registry helpers now take an optional screens
  list so the gate *logic* (opens only when every split is `'confirmed'`) is unit-tested against
  hypothetical inputs **without** ever faking the real registry (`tests/uiMigration.test.ts`).
- **Obsidian → `PageShellPanel`** and **Notion → `PageShellPanel`** — two clean integration-overview
  panels. All privacy/redaction copy is preserved (Obsidian's secret-detection + "never uploaded";
  Notion's `type="password"` token field is untouched and never logged/registered).
- **Research live workspace hook** — a run registers in the Workspace Graph the moment it starts
  (label = the user's own question, **never fetched web content**); the completion path already
  reconciles the final status, and runs are never deleted. Live-hooked sources are now Notes / Tasks /
  Documents / Memories / Knowledge / Benchmarks / **Research**. Only **Email** stays reconcile-only
  (a live hook there must never touch credentials or message bodies).
