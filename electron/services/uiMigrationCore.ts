/**
 * uiMigrationCore.ts — pure, electron-free registry of DAWN's design-system (shell) migration. One
 * HONEST source of truth for: which screens are migrated, to which shell variant, and — for the risky
 * split/master-detail screens — whether a HUMAN has visually verified them. System Health, the
 * migration-checklist doc, and the unit tests all read this, so the three can never drift apart. No DB
 * table, no side effects — just data + a couple of pure helpers.
 *
 * Rule enforced here (beta.15): while ANY migrated split screen is still awaiting human visual
 * verification, we must NOT migrate another split screen. Panel/log migrations may continue.
 */
export type ShellVariant = 'PageShell' | 'PageShellPanel' | 'PageShellSplit' | 'PageShellLog' | 'PageShellCanvas';

/** 'n/a' = single-scroll panel/log (no split behaviour to eyeball). 'pending' = split screen awaiting a
 *  human check. 'confirmed' = a human explicitly confirmed it. We never set 'confirmed' ourselves. */
export type Verification = 'n/a' | 'pending' | 'confirmed';

export interface MigratedScreen { screen: string; variant: ShellVariant; verification: Verification; note?: string }

export const MIGRATED_SCREENS: MigratedScreen[] = [
  { screen: 'Logs', variant: 'PageShellLog', verification: 'n/a' },
  { screen: 'Model Manager', variant: 'PageShellPanel', verification: 'n/a' },
  { screen: 'Model Hub', variant: 'PageShellPanel', verification: 'n/a' },
  { screen: 'Model Optimizer', variant: 'PageShellPanel', verification: 'n/a' },
  { screen: 'Tasks', variant: 'PageShellPanel', verification: 'n/a' },
  { screen: 'Backup', variant: 'PageShellPanel', verification: 'n/a' },
  { screen: 'Obsidian', variant: 'PageShellPanel', verification: 'n/a' },
  { screen: 'Notion', variant: 'PageShellPanel', verification: 'n/a' },
  // Split screens — human visual verification is PENDING until the user explicitly confirms them.
  { screen: 'Notes', variant: 'PageShellSplit', verification: 'pending', note: 'first split proof (beta.14)' },
  { screen: 'Documents', variant: 'PageShellSplit', verification: 'pending', note: 'second split (beta.15)' },
];

/** Screens still on bespoke layouts (not yet migrated). */
export const UNMIGRATED_SCREENS = ['Dashboard', 'Research', 'Calendar', 'Tools/Skills', 'Security/Vault', 'integrations', 'Settings'];

/** Next SAFE migration candidates. While split verification is pending these must be simple panels only. */
export const NEXT_SAFE_CANDIDATES = [
  'Calendar → PageShellPanel (after moving its inline nav toolbar into the body)',
  'Security overview → PageShellPanel (only if it stays a simple panel and keeps vault redaction)',
];

// Each helper takes an optional screens list (defaulting to the real registry) so the gate LOGIC can
// be unit-tested against hypothetical lists (e.g. "all confirmed → gate opens") WITHOUT ever mutating
// the real registry into a fake pass. Marking a split 'confirmed' only ever happens by an explicit,
// human-triggered edit to MIGRATED_SCREENS above.
export function splitScreens(screens: MigratedScreen[] = MIGRATED_SCREENS): MigratedScreen[] { return screens.filter((s) => s.variant === 'PageShellSplit'); }
export function panelScreens(screens: MigratedScreen[] = MIGRATED_SCREENS): MigratedScreen[] { return screens.filter((s) => s.variant === 'PageShellPanel'); }

/** Split screens still awaiting a human visual check (defaults to the real registry). */
export function pendingSplitVerification(screens: MigratedScreen[] = MIGRATED_SCREENS): string[] {
  return splitScreens(screens).filter((s) => s.verification === 'pending').map((s) => s.screen);
}

/** The gate: only migrate another split screen once every migrated split is human-confirmed. */
export function canMigrateAnotherSplit(screens: MigratedScreen[] = MIGRATED_SCREENS): boolean {
  return pendingSplitVerification(screens).length === 0;
}

/** A one-line honest summary of a screen's migration state (used by System Health + docs generation). */
export function describe(s: MigratedScreen): string {
  const v = s.verification === 'pending' ? ' — human verification PENDING'
    : s.verification === 'confirmed' ? ' — human-verified'
    : '';
  return `${s.screen} (${s.variant}${v})`;
}

export default {
  MIGRATED_SCREENS, UNMIGRATED_SCREENS, NEXT_SAFE_CANDIDATES,
  splitScreens, panelScreens, pendingSplitVerification, canMigrateAnotherSplit, describe,
};
