# DAWN — UI Migration Checklist (design-system / shell rollout)

This is the **honest, tracked status** of DAWN's page-shell migration. The source of truth for the
lists below is code: [`electron/services/uiMigrationCore.ts`](../electron/services/uiMigrationCore.ts)
(pure, unit-tested). System Health's **Design System** area and this doc both read that registry, so
they can't drift. Tests: [`tests/uiMigration.test.ts`](../tests/uiMigration.test.ts).

## The rule (beta.15)

> While **any migrated split screen is still awaiting human visual verification**, do **not** migrate
> another split/master–detail screen. Simple `PageShellPanel` / `PageShellLog` migrations may continue.

`uiMigrationCore.canMigrateAnotherSplit()` returns `false` while Notes/Documents are pending — this is
enforced honestly, not by memory.

## Migrated screens

| Screen | Variant | Human visual verification |
|---|---|---|
| Logs | `PageShellLog` | n/a (single scroll box) |
| Model Manager | `PageShellPanel` | n/a (single scroll) |
| Model Hub | `PageShellPanel` | n/a (single scroll) |
| Model Optimizer | `PageShellPanel` | n/a (single scroll) |
| Tasks | `PageShellPanel` | n/a (single scroll) — *migrated beta.16* |
| Backup & Restore | `PageShellPanel` | n/a (single scroll) — *migrated beta.16* |
| **Obsidian** | `PageShellPanel` | n/a (single scroll) — *migrated beta.17* |
| **Notion** | `PageShellPanel` | n/a (single scroll) — *migrated beta.17* |
| Notes | `PageShellSplit` | **⏳ PENDING** — needs a human pass |
| Documents | `PageShellSplit` | **⏳ PENDING** — needs a human pass |

`n/a` = a panel/log screen has one scroll region and no split behaviour to eyeball; the build (valid
JSX) + the layout invariant tests are sufficient. Split screens still need eyes.

## Split-screen human verification checklist

Run this for **Notes** and **Documents** on the installed build. Mark each ✅/❌.

- [ ] opens from the sidebar
- [ ] opens from the command palette (if it has an entry)
- [ ] master list is visible
- [ ] detail / editor pane is visible
- [ ] selecting an item updates the detail pane
- [ ] create works
- [ ] edit works
- [ ] delete / remove works (if supported)
- [ ] list scrolls independently
- [ ] detail / editor scrolls independently
- [ ] header / action bars stay fixed
- [ ] empty state looks correct
- [ ] no clipping
- [ ] no overlap
- [ ] no double-scroll weirdness
- [ ] live workspace registration updates the Workspace Graph (Notes/Documents both hook)

**When a human confirms a screen:** set its `verification` to `'confirmed'` in `uiMigrationCore.ts`
(and tick it here). Only then does `canMigrateAnotherSplit()` unlock the next split migration.

> **Verification status as of beta.17: still PENDING for both Notes and Documents.** A verification
> result was requested, but the submitted report contained the **unfilled template placeholder**
> (`[PASSED / FAILED — describe failures]`), not an actual PASS/FAIL. Per the rule "do not assume pass,
> do not infer pass from build success," neither screen was marked confirmed, and
> `canMigrateAnotherSplit()` remains **false**. No split screen was migrated in beta.17. To unlock the
> next split migration, report a real PASS for both — then their `verification` flips to `'confirmed'`.

## Not yet migrated (bespoke layouts)

Dashboard, Research, Calendar, Tools/Skills, Security/Vault, integrations, Settings.

### Deliberately deferred this batch (with honest reasons)

- **Calendar** — its header is an inline toolbar (prev/today/next + month label + view toggles +
  import/export), which doesn't map cleanly to icon+title+subtitle without moving the toolbar. Panel
  migration is possible later after a small header rework.
- **Skills** — it's a **split/master–detail** screen (sidebar + editor), so it's gated by the rule
  above until Notes/Documents are confirmed.
- **Security/Vault** — redaction-sensitive; not touched in a UI-only batch.
- **Settings** — large with nested scrollers; risky to wrap without a dedicated pass.

## Next safe candidates

See `NEXT_SAFE_CANDIDATES` in the registry: Calendar (panel, after header rework) and a Security
overview panel — both simple-panel migrations that are allowed while split verification is pending.
