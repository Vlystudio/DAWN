/**
 * featureMaturityCore.ts — pure, electron-free heart of DAWN's System Health / Feature Maturity
 * dashboard. It owns the canonical catalog of feature areas, the honest classifier that turns
 * live "signals" (counts + config flags gathered by the electron service) into a per-area report
 * (status + what works + what's missing + required setup + next action), and the roll-up summary.
 *
 * This page must never lie: statuses are derived from real persisted state, and every area maps to
 * a real settings route + docs file. No I/O here — the electron service feeds in signals.
 */

export type MaturityStatus =
  | 'COMPLETE'        // wired end-to-end and in active/usable shape
  | 'PARTIAL'         // works but missing pieces or never exercised
  | 'BLOCKED_BY_SETUP'// implemented but needs user setup/credentials to function
  | 'STUB'            // scaffolding only
  | 'BROKEN'          // present but failing a health check
  | 'MISSING';        // not implemented yet

/** Map a status to a uiCore badge kind (ok/warning/locked/error/disabled). */
export function statusTone(status: MaturityStatus): string {
  switch (status) {
    case 'COMPLETE': return 'ok';
    case 'PARTIAL': return 'warning';
    case 'BLOCKED_BY_SETUP': return 'locked';
    case 'BROKEN': return 'error';
    case 'STUB': return 'disabled';
    case 'MISSING': return 'disabled';
    default: return 'disabled';
  }
}

/** Weight used for the overall completion percentage (BLOCKED counts as "ready, awaiting you"). */
export function statusWeight(status: MaturityStatus): number {
  switch (status) {
    case 'COMPLETE': return 1;
    case 'BLOCKED_BY_SETUP': return 0.8;
    case 'PARTIAL': return 0.5;
    case 'BROKEN': return 0.25;
    case 'STUB': return 0.1;
    case 'MISSING': return 0;
    default: return 0;
  }
}

export interface FeatureArea {
  id: string;
  name: string;
  group: string;        // System Health grouping
  route?: string;       // a uiCore ROUTE key to open the feature
  settingsRoute?: string; // where its setup/config lives
  docs?: string;        // docs/<file>
  summary: string;      // one-line description
}

export interface AreaReport extends FeatureArea {
  status: MaturityStatus;
  works: string[];
  missing: string[];
  requiredSetup?: string;
  nextAction?: string;
  lastError?: string | null;
  lastCheckedAt?: number | null;
}

/** Signals the electron service gathers from settings + the DB (all optional / safe-defaulted). */
export interface MaturitySignals {
  runtimeState?: string; runtimeInstalled?: boolean; modelSelected?: boolean; modelCount?: number;
  benchmarkCount?: number; optimizerCount?: number; embeddingsAvailable?: boolean;
  conversations?: number; memories?: number; documents?: number; notes?: number; tasks?: number;
  overdueTasks?: number; events?: number; researchRuns?: number; knowledgeSources?: number;
  knowledgeChunks?: number; brainNodes?: number; brainEdges?: number; skills?: number; toolAudit?: number;
  promptEvents?: number; vaultItems?: number; emailAccounts?: number; emailLastStatus?: string | null;
  backups?: number; workspaceItems?: number; workspaceLinks?: number; workspaceRegistered?: number;
  toolsEnabled?: boolean; voiceEnabled?: boolean; voiceEngine?: string; companionEnabled?: boolean;
  obsidianConfigured?: boolean; notionConfigured?: boolean; visionEnabled?: boolean; dcdAvailable?: boolean;
  agentosEnabled?: boolean; authEnabled?: boolean; totpEnabled?: boolean; firstRunComplete?: boolean;
  codingWorkspaces?: number; fileAgentEnabled?: boolean; updaterConfigured?: boolean;
  commandPalette?: boolean; globalSearch?: boolean; indexedFolders?: number;
}

const n = (x?: number) => (typeof x === 'number' && isFinite(x) ? x : 0);
const yes = (b?: boolean) => b === true;

/** The canonical feature catalog. Order drives the System Health page. */
export const FEATURE_AREAS: FeatureArea[] = [
  { id: 'dashboard', name: 'Dashboard', group: 'Core', route: 'dashboard', summary: 'Home overview of the whole app.' },
  { id: 'chat', name: 'Chat', group: 'Core', route: 'chat', settingsRoute: 'settings', docs: 'README.md', summary: 'Streaming local chat with the model.' },
  { id: 'chat_actions', name: 'Chat Cross-Feature Actions', group: 'Core', route: 'chat', docs: 'CHAT_ACTIONS.md', summary: 'Turn a reply into a note/task/doc/memory, linked.' },
  { id: 'brain', name: 'Brain Explorer', group: 'Core', route: 'explorer', docs: 'ARCHITECTURE.md', summary: 'Data-driven 3D brain of your workspace.' },
  { id: 'workspace', name: 'Workspace Graph', group: 'Core', route: 'workspace', docs: 'WORKSPACE_GRAPH.md', summary: 'Unified items + typed links across features.' },
  { id: 'workspace_autoreg', name: 'Workspace Auto-Registration', group: 'Core', route: 'workspace', docs: 'WORKSPACE_GRAPH.md', summary: 'Real feature rows auto-register as items.' },
  { id: 'memory', name: 'Memory', group: 'Knowledge', route: 'memory', summary: 'Durable, confirmed memories recalled in chat.' },
  { id: 'knowledge', name: 'Local Knowledge / RAG', group: 'Knowledge', route: 'localknowledge', settingsRoute: 'settings', docs: 'KNOWLEDGE_SETUP.md', summary: 'Index folders you approve; cited retrieval.' },
  { id: 'research', name: 'Deep Research', group: 'Core', route: 'research', docs: 'RESEARCH.md', summary: 'Plan → search → cite → report.' },
  { id: 'compare', name: 'Model Compare / Arena', group: 'Models', route: 'compare', docs: 'COMPARE.md', summary: 'Head-to-head model comparison + judge.' },
  { id: 'documents', name: 'Documents', group: 'Workspace', route: 'documents', docs: 'WORKSPACE.md', summary: 'Markdown docs + AI actions + versions.' },
  { id: 'notes', name: 'Notes', group: 'Workspace', route: 'notes', docs: 'WORKSPACE.md', summary: 'Notes with AI summarize / convert-to-task.' },
  { id: 'tasks', name: 'Tasks', group: 'Workspace', route: 'tasks', docs: 'WORKSPACE.md', summary: 'Tasks with due/priority/recurrence.' },
  { id: 'calendar', name: 'Calendar', group: 'Workspace', route: 'calendar', docs: 'WORKSPACE.md', summary: 'Local calendar + ICS + task overlay.' },
  { id: 'email', name: 'Email', group: 'Workspace', route: 'email', settingsRoute: 'email', docs: 'EMAIL_SETUP.md', summary: 'Local IMAP/SMTP, firewalled, approval-gated send.' },
  { id: 'hub', name: 'Model Hub', group: 'Models', route: 'hub', docs: 'MODELS.md', summary: 'Browse + download GGUF models.' },
  { id: 'models', name: 'Model Manager', group: 'Models', route: 'models', docs: 'MODELS.md', summary: 'Installed models: import/select/remove.' },
  { id: 'optimizer', name: 'Model Optimizer', group: 'Models', route: 'optimizer', docs: 'MODEL_OPTIMIZER.md', summary: 'Hardware-aware per-model settings.' },
  { id: 'benchmark', name: 'Benchmarking', group: 'Models', route: 'compare', docs: 'MODEL_OPTIMIZER.md', summary: 'tok/s + load time; best-for-this-PC.' },
  { id: 'tools', name: 'Tool Gateway', group: 'Tools', route: 'skills', settingsRoute: 'settings', docs: 'SKILLS.md', summary: 'Typed tools with risk + approval + audit.' },
  { id: 'skills', name: 'Skills', group: 'Tools', route: 'skills', docs: 'SKILLS.md', summary: 'User automations scoped to allowed tools.' },
  { id: 'security', name: 'Security / Auth', group: 'Security', route: 'security', settingsRoute: 'security', docs: 'SECURITY_SETUP.md', summary: 'Local password, lock/unlock, audit.' },
  { id: 'totp', name: 'TOTP / 2FA', group: 'Security', route: 'security', settingsRoute: 'security', docs: 'SECURITY_SETUP.md', summary: 'Authenticator + one-time backup codes.' },
  { id: 'vault', name: 'Vault', group: 'Security', route: 'security', settingsRoute: 'security', docs: 'SECURITY.md', summary: 'Encrypted secrets, reveal after unlock.' },
  { id: 'backup', name: 'Backup / Restore', group: 'System', route: 'backup', settingsRoute: 'backup', docs: 'BACKUP_RESTORE.md', summary: 'Verified archives + safe restore.' },
  { id: 'obsidian', name: 'Obsidian', group: 'Integrations', route: 'obsidian', settingsRoute: 'settings', docs: 'SETUP.md', summary: 'Sync notes to/from an Obsidian vault.' },
  { id: 'notion', name: 'Notion', group: 'Integrations', route: 'notion', settingsRoute: 'settings', docs: 'SETUP.md', summary: 'Save notes/reports to Notion.' },
  { id: 'voice', name: 'Voice / TTS', group: 'Integrations', route: 'settings', settingsRoute: 'settings', docs: 'VOICE.md', summary: 'Local text-to-speech for responses.' },
  { id: 'vision', name: 'Live Vision', group: 'Integrations', route: 'vision', settingsRoute: 'settings', docs: 'SETUP.md', summary: 'Local webcam perception (off by default).' },
  { id: 'companion', name: 'Phone Companion', group: 'Integrations', route: 'settings', settingsRoute: 'settings', docs: 'SETUP.md', summary: 'LAN-only mobile access (off by default).' },
  { id: 'coding', name: 'Coding Autopilot', group: 'Tools', route: 'coding', docs: 'coding-autopilot.md', summary: 'Scoped, approval-gated code edits.' },
  { id: 'fileagent', name: 'File Agent', group: 'Tools', route: 'coding', settingsRoute: 'settings', docs: 'file-edit-tools.md', summary: 'Scoped file read/write with undo.' },
  { id: 'dcd', name: 'D.C.D Integration', group: 'Integrations', route: 'settings', settingsRoute: 'settings', docs: 'dcd-integration.md', summary: 'Defensive, read-only D.C.D reports.' },
  { id: 'settings', name: 'Settings', group: 'System', route: 'settings', summary: 'All app configuration.' },
  { id: 'logs', name: 'Logs', group: 'System', route: 'logs', docs: 'TROUBLESHOOTING.md', summary: 'Runtime/tool/error logs (redacted).' },
  { id: 'onboarding', name: 'Onboarding / Setup Center', group: 'System', route: 'setup', docs: 'FIRST_RUN.md', summary: 'First-run flow + a live Setup Center.' },
  { id: 'design_system', name: 'Design System', group: 'System', route: 'health', docs: 'UI_SYSTEM.md', summary: 'Shared UI primitives + page shell across screens.' },
  { id: 'health', name: 'System Health', group: 'System', route: 'health', docs: 'SYSTEM_HEALTH.md', summary: 'This page — honest feature completion map.' },
  { id: 'diagnostics', name: 'Diagnostics', group: 'System', route: 'health', docs: 'TROUBLESHOOTING.md', summary: 'Redacted diagnostics bundle export.' },
  { id: 'updater', name: 'Internal Updater', group: 'System', route: 'settings', settingsRoute: 'settings', docs: 'TROUBLESHOOTING.md', summary: 'Optional private update feed.' },
  { id: 'palette', name: 'Command Palette', group: 'Core', route: 'dashboard', summary: 'Keyboard command launcher.' },
  { id: 'search', name: 'Global Search', group: 'Core', route: 'dashboard', summary: 'Search across the whole workspace.' },
];

const AREA_BY_ID: Record<string, FeatureArea> = Object.fromEntries(FEATURE_AREAS.map((a) => [a.id, a]));

/** Per-area evaluators: honest mapping from live signals → status/works/missing/next action. */
type Evaluator = (s: MaturitySignals) => { status: MaturityStatus; works: string[]; missing: string[]; requiredSetup?: string; nextAction?: string };

const EVAL: Record<string, Evaluator> = {
  dashboard: () => ({ status: 'COMPLETE', works: ['Live overview of model, security, workspace, backup'], missing: [] }),
  chat: (s) => n(s.modelSelected ? 1 : 0) || s.runtimeInstalled
    ? { status: yes(s.modelSelected) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Streaming chat', 'Memory recall', 'Markdown + code copy'], missing: yes(s.modelSelected) ? [] : ['A selected model'], requiredSetup: yes(s.modelSelected) ? undefined : 'Pick or import a GGUF model in Model Hub/Manager.', nextAction: yes(s.modelSelected) ? undefined : 'Open Model Hub' }
    : { status: 'BLOCKED_BY_SETUP', works: ['Chat UI + streaming pipeline'], missing: ['llama.cpp runtime', 'a model'], requiredSetup: 'Install the llama.cpp runtime and a GGUF model.', nextAction: 'Open Model Hub' },
  brain: (s) => ({ status: n(s.brainNodes) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['3D/2D brain from real data', 'Click-to-inspect nodes', 'Workspace items injected as nodes'], missing: n(s.brainNodes) > 0 ? [] : ['No graph yet — use the app to populate it'], nextAction: n(s.brainNodes) > 0 ? undefined : 'Chat / add notes, then rebuild graph' }),
  chat_actions: () => ({ status: 'COMPLETE', works: ['Reply → Note / Task / Document / Memory', 'Each links created_from the conversation', 'Created item shows in Global Search + Brain'], missing: [] }),
  workspace: (s) => ({ status: 'COMPLETE', works: ['Typed items + links (services + DB + IPC + UI)', 'Cross-feature convert-to-task / save-as-note', 'In Global Search + Brain', `${n(s.workspaceItems)} items, ${n(s.workspaceLinks)} links`], missing: [] }),
  workspace_autoreg: (s) => ({ status: 'COMPLETE', works: ['8 real sources (chat/memory/notes/tasks/documents/research/benchmark/email)', 'Idempotent upsert + orphan pruning', 'Runs on Workspace open + Brain rebuild', `${n(s.workspaceRegistered)} registered`], missing: [] }),
  memory: (s) => ({ status: n(s.memories) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Add/edit/pin memories', 'Cited recall in chat'], missing: n(s.memories) > 0 ? [] : ['No memories saved yet'], nextAction: n(s.memories) > 0 ? undefined : 'Save a memory from chat' }),
  knowledge: (s) => n(s.indexedFolders) > 0
    ? { status: n(s.knowledgeChunks) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Folder indexing', 'Cited retrieval', s.embeddingsAvailable ? 'Embeddings' : 'Keyword fallback'], missing: n(s.knowledgeChunks) > 0 ? (s.embeddingsAvailable ? [] : ['Embedding model (using keyword fallback)']) : ['Index has no chunks yet'], nextAction: n(s.knowledgeChunks) > 0 ? undefined : 'Re-index your folders' }
    : { status: 'BLOCKED_BY_SETUP', works: ['Indexer + retrieval pipeline'], missing: ['No folders indexed'], requiredSetup: 'Add an opt-in folder in Local Knowledge.', nextAction: 'Open Local Knowledge' },
  research: (s) => ({ status: n(s.researchRuns) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Plan → search → cited report', 'Untrusted-source firewall', 'Web off by default'], missing: n(s.researchRuns) > 0 ? [] : ['No research runs yet'], nextAction: n(s.researchRuns) > 0 ? undefined : 'Start a research run' }),
  compare: (s) => ({ status: 'COMPLETE', works: ['2–4 model compare', 'Blind mode + AI judge'], missing: n(s.modelCount) >= 2 ? [] : ['Needs ≥2 installed models'], nextAction: n(s.modelCount) >= 2 ? undefined : 'Install another model' }),
  documents: (s) => ({ status: n(s.documents) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Create/edit + versions', 'AI summarize/rewrite/extract tasks'], missing: n(s.documents) > 0 ? [] : ['No documents yet'], nextAction: n(s.documents) > 0 ? undefined : 'Create a document' }),
  notes: (s) => ({ status: n(s.notes) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Create/edit', 'Summarize, convert-to-task'], missing: n(s.notes) > 0 ? [] : ['No notes yet'], nextAction: n(s.notes) > 0 ? undefined : 'Create a note' }),
  tasks: (s) => ({ status: n(s.tasks) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Due/priority/recurrence', 'Overdue surfacing', 'AI break-down'], missing: n(s.tasks) > 0 ? [] : ['No tasks yet'], nextAction: n(s.tasks) > 0 ? undefined : 'Create a task' }),
  calendar: (s) => ({ status: n(s.events) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Local CRUD', 'ICS import/export', 'Tasks overlaid'], missing: n(s.events) > 0 ? [] : ['No events yet'], nextAction: n(s.events) > 0 ? undefined : 'Add an event' }),
  email: (s) => n(s.emailAccounts) > 0
    ? { status: s.emailLastStatus === 'failed' ? 'BROKEN' : (s.emailLastStatus ? 'COMPLETE' : 'PARTIAL'), works: ['IMAP/SMTP', 'Firewalled summaries/drafts', 'Approval-gated send'], missing: ['OAuth (use an app password)'], nextAction: s.emailLastStatus === 'failed' ? 'Re-test connection in Email setup' : undefined }
    : { status: 'BLOCKED_BY_SETUP', works: ['IMAP/SMTP engine', 'Vault-stored credentials'], missing: ['No account configured'], requiredSetup: 'Add an account (app password) in the Email setup wizard.', nextAction: 'Open Email setup' },
  hub: (s) => ({ status: 'COMPLETE', works: ['Catalog + GPU fit', 'Resumable downloads'], missing: n(s.modelCount) > 0 ? [] : ['No models installed yet'], nextAction: n(s.modelCount) > 0 ? undefined : 'Download a model' }),
  models: (s) => ({ status: n(s.modelCount) > 0 ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Import/select/remove', 'Size + RAM estimate'], missing: n(s.modelCount) > 0 ? [] : ['No GGUF installed'], requiredSetup: n(s.modelCount) > 0 ? undefined : 'Download or import a GGUF model.', nextAction: n(s.modelCount) > 0 ? undefined : 'Open Model Hub' }),
  optimizer: (s) => ({ status: n(s.modelCount) > 0 ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Hardware-aware presets', 'Apply & load'], missing: n(s.modelCount) > 0 ? [] : ['Needs an installed model'], nextAction: n(s.modelCount) > 0 ? undefined : 'Install a model' }),
  benchmark: (s) => ({ status: n(s.benchmarkCount) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['tok/s + load time', 'Historical compare'], missing: n(s.benchmarkCount) > 0 ? [] : ['No benchmark runs yet'], nextAction: n(s.benchmarkCount) > 0 ? undefined : 'Run a benchmark' }),
  tools: (s) => ({ status: yes(s.toolsEnabled) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Typed risk levels', 'Approval gateway', 'Audit log'], missing: yes(s.toolsEnabled) ? [] : ['Tools disabled in Settings'], requiredSetup: yes(s.toolsEnabled) ? undefined : 'Enable Tools in Settings.', nextAction: yes(s.toolsEnabled) ? undefined : 'Open Settings → Tools' }),
  skills: (s) => ({ status: n(s.skills) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Scoped to allowed tools', 'Test with sample input', 'Audit'], missing: n(s.skills) > 0 ? [] : ['No skills created yet'], nextAction: n(s.skills) > 0 ? undefined : 'Create a skill' }),
  security: (s) => ({ status: yes(s.authEnabled) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['scrypt password', 'Lock/unlock', 'Audit'], missing: yes(s.authEnabled) ? [] : ['Secure mode off (local desktop)'], requiredSetup: yes(s.authEnabled) ? undefined : 'Set an admin password to enable Secure mode.', nextAction: yes(s.authEnabled) ? undefined : 'Open Security' }),
  totp: (s) => yes(s.authEnabled)
    ? { status: yes(s.totpEnabled) ? 'COMPLETE' : 'PARTIAL', works: ['RFC-6238 TOTP', 'One-time backup codes'], missing: yes(s.totpEnabled) ? [] : ['2FA not enabled'], nextAction: yes(s.totpEnabled) ? undefined : 'Enable TOTP in Security' }
    : { status: 'BLOCKED_BY_SETUP', works: ['TOTP engine'], missing: ['Requires Secure mode first'], requiredSetup: 'Enable Secure mode, then add TOTP.', nextAction: 'Open Security' },
  vault: (s) => ({ status: n(s.vaultItems) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['AES-256-GCM secrets', 'Reveal after unlock', 'Never logged/sent to model'], missing: n(s.vaultItems) > 0 ? [] : ['No secrets stored yet'], nextAction: n(s.vaultItems) > 0 ? undefined : 'Add a vault item in Security' }),
  backup: (s) => ({ status: n(s.backups) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Verified archives', 'Pre-restore safety snapshot', 'Secret redaction'], missing: n(s.backups) > 0 ? [] : ['No backups created yet'], requiredSetup: n(s.backups) > 0 ? undefined : 'Create your first backup.', nextAction: n(s.backups) > 0 ? undefined : 'Open Backup' }),
  obsidian: (s) => ({ status: yes(s.obsidianConfigured) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Vault sync', 'Save notes/reports'], missing: yes(s.obsidianConfigured) ? [] : ['No vault path set'], requiredSetup: yes(s.obsidianConfigured) ? undefined : 'Choose your Obsidian vault path in Settings.', nextAction: yes(s.obsidianConfigured) ? undefined : 'Open Settings → Obsidian' }),
  notion: (s) => ({ status: yes(s.notionConfigured) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Token stored securely', 'Save notes/reports'], missing: yes(s.notionConfigured) ? [] : ['No integration token'], requiredSetup: yes(s.notionConfigured) ? undefined : 'Add a Notion integration token in Settings.', nextAction: yes(s.notionConfigured) ? undefined : 'Open Settings → Notion' }),
  voice: (s) => ({ status: yes(s.voiceEnabled) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Local TTS', 'Read responses aloud'], missing: yes(s.voiceEnabled) ? [] : ['Voice disabled'], requiredSetup: yes(s.voiceEnabled) ? undefined : 'Enable Voice in Settings and install a voice.', nextAction: yes(s.voiceEnabled) ? undefined : 'Open Settings → Voice' }),
  vision: (s) => yes(s.visionEnabled)
    ? { status: 'PARTIAL', works: ['Camera UI', 'Off by default'], missing: ['Perception sidecar is future scope'], nextAction: undefined }
    : { status: 'BLOCKED_BY_SETUP', works: ['Privacy-first camera UI'], missing: ['Disabled by default'], requiredSetup: 'Enable Live Vision explicitly (camera light shows when active).', nextAction: 'Open Settings → Live Vision' },
  companion: (s) => ({ status: yes(s.companionEnabled) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['LAN-only', 'PIN pairing', 'Critical actions blocked'], missing: yes(s.companionEnabled) ? [] : ['Disabled by default'], requiredSetup: yes(s.companionEnabled) ? undefined : 'Enable the companion in Settings (LAN-only).', nextAction: yes(s.companionEnabled) ? undefined : 'Open Settings → Companion' }),
  coding: (s) => ({ status: n(s.codingWorkspaces) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Scoped to a folder', 'Diff preview', 'Approval-gated edits'], missing: n(s.codingWorkspaces) > 0 ? [] : ['No coding workspace opened'], nextAction: n(s.codingWorkspaces) > 0 ? undefined : 'Open a workspace in Coding' }),
  fileagent: (s) => ({ status: yes(s.fileAgentEnabled) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Scoped read/write', 'Undo', 'Protected-path blocklist'], missing: yes(s.fileAgentEnabled) ? [] : ['Disabled in Settings'], requiredSetup: yes(s.fileAgentEnabled) ? undefined : 'Enable the File Agent in Settings.', nextAction: yes(s.fileAgentEnabled) ? undefined : 'Open Settings' }),
  dcd: (s) => ({ status: yes(s.dcdAvailable) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Defensive, read-only', 'Import reports'], missing: yes(s.dcdAvailable) ? [] : ['D.C.D engine not detected'], requiredSetup: yes(s.dcdAvailable) ? undefined : 'Install/point DAWN at the D.C.D engine.', nextAction: yes(s.dcdAvailable) ? undefined : 'See D.C.D setup docs' }),
  settings: () => ({ status: 'COMPLETE', works: ['Durable JSON config + backup copy'], missing: [] }),
  logs: () => ({ status: 'COMPLETE', works: ['Runtime/tool/error logs', 'Redacted'], missing: [] }),
  onboarding: (s) => ({ status: yes(s.firstRunComplete) ? 'COMPLETE' : 'PARTIAL', works: ['First-run model/memory/knowledge setup', 'Live Setup Center (status + deep links from System Health)'], missing: yes(s.firstRunComplete) ? [] : ['First run not completed'], nextAction: yes(s.firstRunComplete) ? 'Open Setup Center' : 'Finish first-run setup' }),
  design_system: () => ({ status: 'PARTIAL', works: ['Shared library: PageShell, StatusBadge, HealthBadge, LoadingState, ErrorState, ActionBar, Button, DataTable (on primitives.tsx)', 'Adopted in new screens (System Health, Setup Center, Workspace, Email wizard)'], missing: ['Legacy screens not yet migrated to PageShell/DataTable'], nextAction: 'Migrate remaining legacy screens to the shared library' }),
  health: () => ({ status: 'COMPLETE', works: ['Honest, live feature completion map'], missing: [] }),
  diagnostics: () => ({ status: 'COMPLETE', works: ['Health checks per area', 'One-click redacted diagnostics export', 'Copy error summary'], missing: [] }),
  updater: (s) => ({ status: yes(s.updaterConfigured) ? 'COMPLETE' : 'BLOCKED_BY_SETUP', works: ['Manual check', 'No silent install'], missing: yes(s.updaterConfigured) ? [] : ['No private update feed configured'], requiredSetup: yes(s.updaterConfigured) ? undefined : 'Optional: point at a private update feed.', nextAction: undefined }),
  palette: (s) => yes(s.commandPalette)
    ? { status: 'COMPLETE', works: ['Keyboard command launcher (Ctrl/Cmd+K)'], missing: [] }
    : { status: 'MISSING', works: [], missing: ['Command palette not implemented yet'], nextAction: 'Planned next loop' },
  search: (s) => yes(s.globalSearch)
    ? { status: 'COMPLETE', works: ['Cross-workspace search'], missing: [] }
    : { status: 'MISSING', works: [], missing: ['Global workspace search not implemented yet'], nextAction: 'Planned next loop' },
};

/** Evaluate one area from signals → a full report (pure). Unknown ids are reported as MISSING. */
export function evaluateArea(id: string, signals: MaturitySignals = {}): AreaReport {
  const area = AREA_BY_ID[id];
  if (!area) return { id, name: id, group: 'Other', summary: 'Unknown feature area.', status: 'MISSING', works: [], missing: ['Unknown feature area'], lastError: null, lastCheckedAt: null };
  const eval_ = EVAL[id];
  const r = eval_ ? eval_(signals) : { status: 'PARTIAL' as MaturityStatus, works: [], missing: ['No evaluator'] };
  return { ...area, status: r.status, works: r.works, missing: r.missing, requiredSetup: r.requiredSetup, nextAction: r.nextAction, lastError: null, lastCheckedAt: null };
}

/** Evaluate every catalogued area. */
export function evaluateAll(signals: MaturitySignals = {}): AreaReport[] {
  return FEATURE_AREAS.map((a) => evaluateArea(a.id, signals));
}

/** Roll-up: counts per status + an overall completion percentage. */
export function summarizeReports(reports: AreaReport[]): { total: number; byStatus: Record<MaturityStatus, number>; completionPct: number } {
  const byStatus: Record<MaturityStatus, number> = { COMPLETE: 0, PARTIAL: 0, BLOCKED_BY_SETUP: 0, STUB: 0, BROKEN: 0, MISSING: 0 };
  let weight = 0;
  for (const r of reports) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; weight += statusWeight(r.status); }
  const completionPct = reports.length ? Math.round((weight / reports.length) * 100) : 0;
  return { total: reports.length, byStatus, completionPct };
}

export default { FEATURE_AREAS, evaluateArea, evaluateAll, summarizeReports, statusTone, statusWeight };
