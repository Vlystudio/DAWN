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
