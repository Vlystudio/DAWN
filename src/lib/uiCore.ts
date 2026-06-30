/**
 * uiCore.ts — pure, framework-free UI helpers used across DAWN's shell: the canonical
 * navigation route map, risk/status badge styling, the Dashboard summary shaper (safe on
 * empty data — never embeds bodies/secrets), and small confirmation helpers. Kept pure so the
 * shell's structure can be unit-tested without React.
 */

export interface RouteDef { key: string; label: string; group: string }

/** Canonical sidebar route list, grouped. Order here drives the sidebar. */
export const ROUTES: RouteDef[] = [
  { key: 'dashboard', label: 'Home', group: 'Home' },
  { key: 'chat', label: 'Chat', group: 'Core' },
  { key: 'explorer', label: 'Brain', group: 'Core' },
  { key: 'research', label: 'Research', group: 'Core' },
  { key: 'coding', label: 'Coding', group: 'Core' },
  { key: 'vision', label: 'Live Vision', group: 'Core' },
  { key: 'hub', label: 'Model Hub', group: 'Models' },
  { key: 'optimizer', label: 'Optimizer', group: 'Models' },
  { key: 'cookbook', label: 'Model Cookbook', group: 'Models' },
  { key: 'compare', label: 'Compare', group: 'Models' },
  { key: 'models', label: 'Models', group: 'Models' },
  { key: 'documents', label: 'Documents', group: 'Workspace' },
  { key: 'notes', label: 'Notes', group: 'Workspace' },
  { key: 'tasks', label: 'Tasks', group: 'Workspace' },
  { key: 'calendar', label: 'Calendar', group: 'Workspace' },
  { key: 'email', label: 'Email', group: 'Workspace' },
  { key: 'workspace', label: 'Workspace Graph', group: 'Workspace' },
  { key: 'memory', label: 'Memory', group: 'Knowledge' },
  { key: 'obsidian', label: 'Obsidian', group: 'Knowledge' },
  { key: 'notion', label: 'Notion', group: 'Knowledge' },
  { key: 'knowledge', label: 'Knowledge', group: 'Knowledge' },
  { key: 'localknowledge', label: 'Local Knowledge', group: 'Knowledge' },
  { key: 'skills', label: 'Skills', group: 'Automation' },
  { key: 'security', label: 'Security', group: 'Security' },
  { key: 'backup', label: 'Backup', group: 'Security' },
  { key: 'setup', label: 'Setup Center', group: 'System' },
  { key: 'health', label: 'System Health', group: 'System' },
  { key: 'logs', label: 'Logs', group: 'System' },
  { key: 'settings', label: 'Settings', group: 'System' },
];
export const ROUTE_KEYS = ROUTES.map((r) => r.key);
export function isKnownRoute(key: string): boolean { return ROUTE_KEYS.includes(key); }

// --- badges (risk / status) ------------------------------------------------
export type BadgeKind = 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'disabled' | 'locked' | 'encrypted' | 'ok' | 'warning' | 'error';

const BADGES: Record<BadgeKind, { label: string; cls: string; dot: string }> = {
  safe: { label: 'safe', cls: 'text-neural-green border-neural-green/50 bg-neural-green/10', dot: 'bg-neural-green' },
  low: { label: 'low', cls: 'text-neural-green border-neural-green/40 bg-neural-green/10', dot: 'bg-neural-green' },
  medium: { label: 'medium', cls: 'text-neural-amber border-neural-amber/50 bg-neural-amber/10', dot: 'bg-neural-amber' },
  high: { label: 'high', cls: 'text-neural-red border-neural-red/50 bg-neural-red/10', dot: 'bg-neural-red' },
  critical: { label: 'critical', cls: 'text-neural-red border-neural-red/60 bg-neural-red/15', dot: 'bg-neural-red' },
  disabled: { label: 'disabled', cls: 'text-faint border-border bg-panel2/40', dot: 'bg-faint' },
  locked: { label: 'locked', cls: 'text-neural-amber border-neural-amber/50 bg-neural-amber/10', dot: 'bg-neural-amber' },
  encrypted: { label: 'encrypted', cls: 'text-neural-cyan border-neural-cyan/50 bg-neural-cyan/10', dot: 'bg-neural-cyan' },
  ok: { label: 'ok', cls: 'text-neural-green border-neural-green/40 bg-neural-green/10', dot: 'bg-neural-green' },
  warning: { label: 'warning', cls: 'text-neural-amber border-neural-amber/50 bg-neural-amber/10', dot: 'bg-neural-amber' },
  error: { label: 'error', cls: 'text-neural-red border-neural-red/50 bg-neural-red/10', dot: 'bg-neural-red' },
};
export function badge(kind: string): { label: string; cls: string; dot: string } {
  return BADGES[(kind || '') as BadgeKind] || BADGES.disabled;
}
/** A risk level (safe..critical) → badge. Critical/high stand out (red). */
export function riskBadge(level: string): { label: string; cls: string; dot: string } {
  return badge(level);
}

// --- dashboard summary (safe on empty; never includes bodies/secrets) ------
export interface DashboardData {
  runtime?: { state?: string; model?: string; backend?: string } | null;
  auth?: { authEnabled?: boolean; locked?: boolean; totpEnabled?: boolean; hasPassword?: boolean; lanModeEnabled?: boolean } | null;
  tasks?: any[]; notes?: any[]; documents?: any[]; research?: any[]; events?: any[];
  backups?: any[]; emailAccounts?: any[]; optimizerTop?: { friendlyName?: string; level?: string } | null;
  promptEvents?: number;
}
export interface DashboardSummary {
  online: boolean; model: string; backend: string;
  security: { mode: string; locked: boolean; tone: BadgeKind };
  counts: { tasks: number; overdue: number; notes: number; documents: number; research: number };
  upcoming: { id: string; title: string; when: number; overdue: boolean }[];
  recentDocs: { id: string; title: string }[];
  recentResearch: { id: string; question: string; status: string }[];
  backup: { has: boolean; lastAt: number | null; tone: BadgeKind };
  email: { accounts: number; lastStatus: string | null };
  promptEvents: number;
  optimizer: string | null;
}
export function buildDashboardSummary(d: DashboardData = {}): DashboardSummary {
  const now = Date.now();
  const tasks = d.tasks || [];
  const overdue = tasks.filter((t: any) => t.overdue || (t.due_at && t.status !== 'done' && t.due_at < now)).length;
  const upcoming = tasks
    .filter((t: any) => t.due_at && t.status !== 'done')
    .sort((a: any, b: any) => a.due_at - b.due_at)
    .slice(0, 5)
    .map((t: any) => ({ id: t.id, title: trunc(t.title, 60), when: t.due_at, overdue: t.due_at < now }));
  const events = (d.events || []).slice(0, 5).map((e: any) => ({ id: e.id, title: trunc(e.title, 60), when: e.start_at, overdue: false }));
  const auth = d.auth || {};
  const mode = auth.lanModeEnabled ? 'LAN mode' : auth.authEnabled ? 'Secure' : 'Local desktop';
  const lastBackup = (d.backups || []).filter((b: any) => b.kind === 'backup')[0];
  return {
    online: !!d.runtime && (d.runtime.state === 'READY' || d.runtime.state === 'GENERATING'),
    model: shortModel(d.runtime?.model || ''),
    backend: d.runtime?.backend || 'Unknown',
    security: { mode, locked: !!(auth.authEnabled && auth.locked), tone: auth.authEnabled ? (auth.totpEnabled ? 'safe' : 'ok') : 'disabled' },
    counts: { tasks: tasks.filter((t: any) => t.status !== 'done').length, overdue, notes: (d.notes || []).length, documents: (d.documents || []).length, research: (d.research || []).length },
    upcoming: [...upcoming, ...events].sort((a, b) => a.when - b.when).slice(0, 5),
    recentDocs: (d.documents || []).slice(0, 5).map((x: any) => ({ id: x.id, title: trunc(x.title || 'Untitled', 50) })),
    recentResearch: (d.research || []).slice(0, 4).map((x: any) => ({ id: x.id, question: trunc(x.question || '', 60), status: x.status })),
    backup: { has: !!lastBackup, lastAt: lastBackup?.created_at || null, tone: lastBackup ? 'ok' : 'warning' },
    email: { accounts: (d.emailAccounts || []).length, lastStatus: (d.emailAccounts || [])[0]?.lastSyncStatus || null },
    promptEvents: d.promptEvents || 0,
    optimizer: d.optimizerTop?.friendlyName || null,
  };
}

// --- confirmation ----------------------------------------------------------
export function isRestoreConfirmed(text: string): boolean { return String(text || '').trim() === 'RESTORE'; }
export function confirmMatches(text: string, expected: string): boolean { return String(text || '').trim() === expected; }

function trunc(s: string, n: number): string { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
function shortModel(raw: string): string { return (raw || '').split(/[\\/]/).pop() || ''; }

export default { ROUTES, ROUTE_KEYS, isKnownRoute, badge, riskBadge, buildDashboardSummary, isRestoreConfirmed, confirmMatches };
