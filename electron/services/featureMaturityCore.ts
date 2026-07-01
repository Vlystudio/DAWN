/**
 * featureMaturityCore.ts — pure, electron-free heart of DAWN's System Health / Feature Maturity
 * dashboard. It owns the canonical catalog of feature areas, the honest classifier that turns
 * live "signals" (counts + config flags gathered by the electron service) into a per-area report
 * (status + what works + what's missing + required setup + next action), and the roll-up summary.
 *
 * This page must never lie: statuses are derived from real persisted state, and every area maps to
 * a real settings route + docs file. No I/O here — the electron service feeds in signals.
 */
import uiMig from './uiMigrationCore';

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
  backups?: number; workspaceItems?: number; workspaceLinks?: number; workspaceRegistered?: number; knowledgeFailed?: number; knowledgeStale?: number;
  toolsEnabled?: boolean; voiceEnabled?: boolean; voiceEngine?: string; companionEnabled?: boolean;
  obsidianConfigured?: boolean; notionConfigured?: boolean; visionEnabled?: boolean; dcdAvailable?: boolean;
  agentosEnabled?: boolean; authEnabled?: boolean; totpEnabled?: boolean; firstRunComplete?: boolean;
  codingWorkspaces?: number; fileAgentEnabled?: boolean; updaterConfigured?: boolean;
  commandPalette?: boolean; globalSearch?: boolean; indexedFolders?: number;
  // Vision Chat / image attachments (honest capability probe + storage/DB presence)
  visionChatReady?: boolean; visionChatMode?: string; visionChatReason?: string; visionChatNextAction?: string;
  visionModelConfigured?: boolean; visionCliPresent?: boolean; chatImages?: number;
  visionMmprojConfigured?: boolean; visionSetupState?: string;
  // Retrieval quality (hybrid / rewrite / rerank / verification / evals)
  ragRetrievalMode?: string; ragEmbeddedChunks?: number; ragTotalChunks?: number;
  answerVerificationEnabled?: boolean; queryRewriteEnabled?: boolean; hydeEnabled?: boolean;
  rerankerEnabled?: boolean; rerankerConfigured?: boolean; rerankMode?: string;
  entailmentEnabled?: boolean;
  ragEvalLastRunAt?: number; ragEvalCases?: number; ragEvalHitRate?: number | null; ragEvalGroundedness?: number | null;
  ragEvalFixtureCount?: number; ragEvalNegativesLeaked?: number; ragEvalBestStrategy?: string | null;
  chunkStrategyVersion?: string; sourcesNeedReindex?: number;
  helperModelsConfigured?: number; helperChatFallback?: boolean;
  helperRuntimeEnabled?: boolean; helperRuntimeState?: string; helperRuntimeReachable?: boolean;
  helperRuntimeModelConfigured?: boolean; helperRuntimeError?: string | null; helperRuntimeInstalled?: boolean;
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
  { id: 'workspace_linking', name: 'Workspace Linking UX', group: 'Core', route: 'workspace', docs: 'WORKSPACE_GRAPH.md', summary: 'Visual item picker + link dialog (no IDs).' },
  { id: 'brain_linking', name: 'Brain Inline Linking', group: 'Core', route: 'explorer', docs: 'WORKSPACE_GRAPH.md', summary: 'Link/related items from Brain node details.' },
  { id: 'workspace_livehooks', name: 'Live Workspace Hooks', group: 'Core', route: 'workspace', docs: 'WORKSPACE_GRAPH.md', summary: 'Instant register/update/prune on feature CRUD.' },
  { id: 'memory', name: 'Memory', group: 'Knowledge', route: 'memory', summary: 'Durable, confirmed memories recalled in chat.' },
  { id: 'knowledge', name: 'Local Knowledge / RAG', group: 'Knowledge', route: 'localknowledge', settingsRoute: 'settings', docs: 'LOCAL_KNOWLEDGE.md', summary: 'Index folders you approve; cited retrieval.' },
  { id: 'knowledge_safety', name: 'Knowledge Safety', group: 'Knowledge', route: 'localknowledge', docs: 'LOCAL_KNOWLEDGE.md', summary: 'Protected-path skipping with reasons; no secrets indexed.' },
  { id: 'hybrid_retrieval', name: 'Hybrid Retrieval', group: 'Knowledge', route: 'localknowledge', docs: 'LOCAL_KNOWLEDGE.md', summary: 'Vector + BM25 keyword fusion with honest fallback + rerank/rewrite status.' },
  { id: 'answer_verification', name: 'Answer Verification', group: 'Knowledge', route: 'localknowledge', docs: 'ANSWER_VERIFICATION.md', summary: 'Groundedness check of RAG answers (no faked support).' },
  { id: 'rag_eval', name: 'RAG Eval Harness', group: 'Knowledge', route: 'localknowledge', docs: 'EVALS.md', summary: 'Local retrieval + grounding metrics + strategy comparison.' },
  { id: 'retrieval_helpers', name: 'Retrieval Helper Models', group: 'Knowledge', route: 'localknowledge', settingsRoute: 'cookbook', docs: 'MODELS.md', summary: 'Dedicated model slots for rewrite/HyDE/entailment/rerank.' },
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
  { id: 'cookbook', name: 'Model Cookbook', group: 'Models', route: 'cookbook', docs: 'MODELS.md', summary: 'Best model per role + honest hardware fit.' },
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
  { id: 'vision_chat', name: 'Vision Chat / Image Attachments', group: 'Core', route: 'chat', settingsRoute: 'hub', docs: 'VISION_CHAT.md', summary: 'Paste/upload images into chat; local vision model or honest fallback.' },
  { id: 'companion', name: 'Phone Companion', group: 'Integrations', route: 'settings', settingsRoute: 'settings', docs: 'SETUP.md', summary: 'LAN-only mobile access (off by default).' },
  { id: 'coding', name: 'Coding Autopilot', group: 'Tools', route: 'coding', docs: 'coding-autopilot.md', summary: 'Scoped, approval-gated code edits.' },
  { id: 'fileagent', name: 'File Agent', group: 'Tools', route: 'coding', settingsRoute: 'settings', docs: 'file-edit-tools.md', summary: 'Scoped file read/write with undo.' },
  { id: 'dcd', name: 'D.C.D Integration', group: 'Integrations', route: 'settings', settingsRoute: 'settings', docs: 'dcd-integration.md', summary: 'Defensive, read-only D.C.D reports.' },
  { id: 'settings', name: 'Settings', group: 'System', route: 'settings', summary: 'All app configuration.' },
  { id: 'logs', name: 'Logs', group: 'System', route: 'logs', docs: 'TROUBLESHOOTING.md', summary: 'Runtime/tool/error logs (redacted).' },
  { id: 'onboarding', name: 'Onboarding / Setup Center', group: 'System', route: 'setup', docs: 'FIRST_RUN.md', summary: 'First-run flow + a live Setup Center.' },
  { id: 'design_system', name: 'Design System', group: 'System', route: 'health', docs: 'UI_SYSTEM.md', summary: 'Shared UI primitives + page shell across screens.' },
  { id: 'status_language', name: 'Status Language', group: 'System', route: 'health', docs: 'UI_SYSTEM.md', summary: 'One tested source of truth for status labels + tones.' },
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
  workspace_linking: () => ({ status: 'COMPLETE', works: ['Visual item picker (search + type filter, no IDs)', 'Link dialog with relationship type', 'Friendly "already linked" handling; self/invalid blocked', 'Used in Workspace + Chat "Link" action', 'Related panel: add / remove / open / filter'], missing: [] }),
  brain_linking: () => ({ status: 'COMPLETE', works: ['Brain node details show related items for workspace_item nodes', '+ Link… uses the visual picker (no IDs)', 'Self/invalid blocked; duplicate = friendly; vault/auth/audit never appear'], missing: [] }),
  workspace_livehooks: () => ({ status: 'PARTIAL', works: ['Notes, Tasks, Documents, Memories, Knowledge sources, Benchmarks, and Research runs register/update/prune instantly (idempotent; knowledge = name only, no path/content; benchmark = public model name only; research = the user\'s own question, never fetched web content)', 'Reconcile remains the fallback (Workspace open + Brain rebuild)'], missing: ['Email remains reconcile-only (accounts register via reconcile; a live hook must never touch credential metadata)'], nextAction: 'Only Email is reconcile-only; a live hook there must never register credentials or bodies' }),
  memory: (s) => ({ status: n(s.memories) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Add/edit/pin memories', 'Cited recall in chat'], missing: n(s.memories) > 0 ? [] : ['No memories saved yet'], nextAction: n(s.memories) > 0 ? undefined : 'Save a memory from chat' }),
  knowledge: (s) => n(s.indexedFolders) > 0
    ? { status: n(s.knowledgeChunks) > 0 ? 'COMPLETE' : 'PARTIAL', works: ['Folder indexing with lifecycle state (indexed/stale/failed/removed)', 'Per-file stale/removed detection (Check for changes)', 'Cited retrieval with honest precision', s.embeddingsAvailable ? 'Embeddings' : 'Keyword fallback', 'Protected-path skipping with reasons'], missing: [...(n(s.knowledgeChunks) > 0 ? (s.embeddingsAvailable ? [] : ['Embedding model (using keyword fallback)']) : ['Index has no chunks yet']), ...(n(s.knowledgeFailed) > 0 ? [`${n(s.knowledgeFailed)} source(s) failed to index`] : []), ...(n(s.knowledgeStale) > 0 ? [`${n(s.knowledgeStale)} stale source(s) — re-index to refresh`] : []), 'Page/section citation precision depends on parser support (honestly "not available" otherwise)'], nextAction: n(s.knowledgeStale) > 0 ? 'Re-index to refresh stale sources' : (n(s.knowledgeChunks) > 0 ? undefined : 'Re-index your folders') }
    : { status: 'BLOCKED_BY_SETUP', works: ['Indexer + retrieval pipeline', 'Protected-path skipping (with reasons)', 'Sources auto-register in the Workspace Graph'], missing: ['No folders indexed'], requiredSetup: 'Add an opt-in folder in Local Knowledge.', nextAction: 'Open Local Knowledge' },
  knowledge_safety: () => ({ status: 'COMPLETE', works: ['Never indexes .env/keys/credentials/vault/auth/browser-profiles/password-managers/node_modules/.git', 'Skips with a plain-language reason (shown in status)', '5 MB file-size limit; unsupported types skipped', 'No whole-disk scan — folders are opt-in'], missing: [] }),
  hybrid_retrieval: (s) => {
    const mode = s.ragRetrievalMode || 'unavailable';
    const works = [
      'Vector (local embeddings) + BM25 keyword, fused with reciprocal-rank fusion; deduped; skipped/removed sources excluded; stale kept + flagged',
      'Honest mode label per query (hybrid / vector / keyword / unavailable) — real keyword search, no faked scores',
      `Chunking ${s.chunkStrategyVersion || 'v2'}: heading/title-aware, code-block-preserving, real line numbers + section paths (never faked pages)`,
    ];
    const missing: string[] = [];
    if (n(s.sourcesNeedReindex) > 0) missing.push(`${n(s.sourcesNeedReindex)} source(s) still use old chunking — reindex in Local Knowledge to upgrade to ${s.chunkStrategyVersion || 'v2'}`);
    const rm = s.rerankMode || 'disabled';
    if (rm === 'cross_encoder') works.push('Reranker: cross-encoder (local)');
    else if (rm === 'embedding') works.push('Reranker: embedding-similarity rerank (local, real) — no cross-encoder shipped, never faked');
    else missing.push('Reranker: heuristic hybrid ranking (RRF + title boost) — enable + embeddings for embedding-similarity rerank; no fake cross-encoder');
    if (yes(s.queryRewriteEnabled)) works.push(`Query rewriting ON (local model, times out → original)${yes(s.hydeEnabled) ? ' + HyDE vector expansion' : ''}`);
    else missing.push('Query rewriting/HyDE off (optional; real local-model expansion when enabled, honest fallback)');
    let status: MaturityStatus = 'COMPLETE';
    if (mode === 'unavailable') status = 'BLOCKED_BY_SETUP';
    else if (mode !== 'hybrid') status = 'PARTIAL';
    return { status, works, missing, requiredSetup: mode === 'unavailable' ? 'Index a folder in Local Knowledge.' : undefined,
      nextAction: mode === 'hybrid' ? undefined : (n(s.ragEmbeddedChunks) > 0 ? undefined : 'Index with an embedding model for hybrid (keyword works now)') };
  },
  answer_verification: (s) => ({
    status: yes(s.answerVerificationEnabled) ? 'COMPLETE' : 'PARTIAL',
    works: [
      'After a RAG answer, each claim is checked against the retrieved chunks: supported / partially / unsupported / not-enough-evidence',
      'Conservative lexical-overlap groundedness — flags what it cannot verify; NEVER fabricates support',
      yes(s.entailmentEnabled) ? 'OPTIONAL local-model entailment upgrade ON (falls back to lexical per claim on any failure; missing evidence never becomes supported)' : 'Optional local-model entailment available (off by default; upgrades lexical when enabled)',
      'Retrieved text is data only (never obeyed); the summary carries no chunk text, path, or secret',
    ],
    missing: yes(s.answerVerificationEnabled) ? [] : ['Disabled in settings (answerVerificationEnabled=false)'],
  }),
  rag_eval: (s) => {
    const ran = n(s.ragEvalLastRunAt) > 0;
    return {
      status: ran ? 'COMPLETE' : 'PARTIAL',
      works: [
        `Embedded fixture (${n(s.ragEvalFixtureCount)} cases) runnable IN-APP + full dev set via npm run eval:rag — deterministic, offline, no model/network`,
        'Metrics: retrieval hit-rate, top-1, keyword coverage, groundedness, unsupported-rate, negatives-leaked',
        ran ? `Last run: ${n(s.ragEvalCases)} cases, hit-rate ${s.ragEvalHitRate}, groundedness ${s.ragEvalGroundedness}, negatives leaked ${n(s.ragEvalNegativesLeaked)}` : 'Not run in this install yet',
      ],
      missing: ran ? (n(s.ragEvalNegativesLeaked) > 0 ? [`${n(s.ragEvalNegativesLeaked)} negative claim(s) leaked — a real regression`] : []) : ['Not run in this install yet — run it from Local Knowledge or npm run eval:rag'],
      nextAction: ran ? undefined : 'Run the RAG eval (in-app or npm run eval:rag)',
    };
  },
  retrieval_helpers: (s) => {
    // A DEDICATED helper runtime (2nd llama-server) can now run helper tasks WITHOUT competing with the
    // chat model. Honest: 'running' is only reported when the helper server is actually reachable.
    const enabled = yes(s.helperRuntimeEnabled);
    const reachable = yes(s.helperRuntimeReachable);
    const state = s.helperRuntimeState || 'OFF';
    const works: string[] = [
      'Dedicated helper slots + Model Cookbook roles for query rewrite / HyDE / entailment / rerank',
      'Helper outputs stay untrusted (never cited, never trigger tools); prompts/responses are not logged to diagnostics',
      'Every helper result records its provenance (helper_runtime / chat / lexical / skipped)',
    ];
    const missing: string[] = [];
    let status: MaturityStatus;
    if (!enabled) { status = 'PARTIAL'; missing.push('Dedicated helper runtime disabled — helper tasks use the loaded chat model (honest fallback). Enable it (Model Cookbook) to run helpers on a separate llama-server without competing with chat.'); }
    else if (reachable) { status = 'COMPLETE'; works.push(`Dedicated helper runtime RUNNING (${state}) — rewrite/HyDE/entailment run on a second llama-server, not the chat model`); }
    else { status = 'BLOCKED_BY_SETUP'; missing.push(`Helper runtime enabled but not reachable (${state}${s.helperRuntimeError ? ': ' + s.helperRuntimeError : ''}) — ${yes(s.helperRuntimeModelConfigured) ? 'starting or failed; tasks fall back to the chat model' : 'configure a small helper .gguf'}`); }
    if (!yes(s.helperRuntimeInstalled)) missing.push('llama-server.exe not found (resources/runtime) — the helper runtime cannot start');
    return { status, works, missing, nextAction: enabled ? (reachable ? undefined : 'Configure/start the helper runtime in Model Cookbook') : 'Enable the dedicated helper runtime in Model Cookbook' };
  },
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
  cookbook: (s) => n(s.modelCount) > 0
    ? { status: 'COMPLETE', works: ['Best model per role (fast/coding/reasoning/research)', 'Honest hardware-fit labels (real compatibility)', 'Real benchmark tok/s + "Needs benchmark"', 'Never fakes models/benchmarks/hardware'], missing: [] }
    : { status: 'BLOCKED_BY_SETUP', works: ['Cookbook engine (roles + fit + recommendations)'], missing: ['No installed models'], requiredSetup: 'Install a GGUF model.', nextAction: 'Open Model Hub' },
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
  vision_chat: (s) => {
    // Image attach/paste/upload + local storage + DB are always available; the honest gap is whether a
    // vision-capable model is configured. READY only when a real VLM path exists; else PARTIAL/NEEDS_SETUP.
    const works = [
      'Paste, drag-drop, or upload PNG/JPEG/WebP/GIF into chat; validated + stored locally (size/dimension limits; corrupt/renamed files rejected)',
      'Attachments persist in SQLite, associate with the message, show a thumbnail + open a larger preview',
      'Only safe metadata (name/mime/size/dims) is exposed — never the file path, bytes, EXIF, or OCR text; image content never enters diagnostics or search',
      'Image text (OCR/vision) is treated as UNTRUSTED evidence (wrapped + inspected), never as instructions',
      `Setup (Model Cookbook): multimodal runtime ${yes(s.visionCliPresent) ? 'present ✓' : 'MISSING'}; VLM model ${yes(s.visionModelConfigured) ? 'set' : 'not set'}; mmproj ${yes(s.visionMmprojConfigured) ? 'set' : 'not set'} — pick files or auto-detect + validate + test on-device`,
    ];
    if (yes(s.visionChatReady) && s.visionChatMode === 'vlm') {
      return { status: 'COMPLETE', works: [...works, 'A vision-capable local model is configured — attached images are actually analyzed on-device'], missing: [] };
    }
    if (yes(s.visionChatReady) && s.visionChatMode === 'ocr') {
      return { status: 'PARTIAL', works: [...works, 'OCR text fallback is available'], missing: ['No full vision model configured — only OCR text, not full image understanding'], nextAction: s.visionChatNextAction || 'Install a vision-capable model + its mmproj.' };
    }
    return {
      status: 'BLOCKED_BY_SETUP',
      works,
      missing: [`No vision model configured: ${s.visionChatReason || 'a VLM GGUF + its mmproj are required'}. Until then DAWN honestly tells you it can't see the image (it never guesses).`],
      requiredSetup: s.visionChatNextAction || 'Install a vision-capable model (e.g. Qwen2.5-VL, LLaVA, MiniCPM-V) + its mmproj in the Model Hub, then set it as the Vision role.',
      nextAction: 'Install/select a vision-capable model in the Model Hub.',
    };
  },
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
  design_system: () => {
    // Lists derived from the single migration registry (uiMigrationCore) so System Health, the
    // checklist doc, and tests can never drift. Split screens awaiting a human check are named
    // honestly, and while any is pending we do NOT migrate another split screen.
    const pending = uiMig.pendingSplitVerification();
    const migrated = uiMig.MIGRATED_SCREENS.map(uiMig.describe).join(', ');
    const missing: string[] = [];
    if (pending.length) missing.push(`Human visual verification PENDING for split screens: ${pending.join(', ')} — no further split-screen migration until confirmed (see docs/UI_MIGRATION_CHECKLIST.md)`);
    missing.push(`Still on bespoke layouts: ${uiMig.UNMIGRATED_SCREENS.join(', ')} — migrate one at a time using the matching shell variant + a visual check`);
    return {
      status: 'PARTIAL' as MaturityStatus,
      works: [
        'Shell library incl. LAYOUT-SAFE VARIANTS: PageShell, PageShellSplit (master–detail), PageShellPanel, PageShellLog (fixed header + scroll box), PageShellCanvas — layout invariants unit-tested',
        'Central status map is the single source for labels/tones (StatusBadge, System Health, Setup Center, Model Cookbook, Skills risk colours)',
        `Migrated: also System Health, Setup Center, Workspace, Email wizard, Model Cookbook; ${migrated}`,
      ],
      missing,
      nextAction: pending.length
        ? `Confirm ${pending.join(' & ')} visually, then continue; meanwhile only simple PageShellPanel screens migrate (next safe: ${uiMig.NEXT_SAFE_CANDIDATES.join('; ')})`
        : 'Roll out PageShellSplit to the next master–detail screen (Skills/Research), one at a time with a visual check',
    };
  },
  status_language: () => ({ status: 'COMPLETE', works: ['One tested status map (src/lib/statusMap): feature/knowledge/retrieval/modelFit/toolRisk/setup', 'Label + tone + plain-English explanation per status', 'Unknown codes resolve to a neutral "Unknown" (never crash/fake)', 'Adopted by StatusBadge, System Health, Setup Center, Model Cookbook'], missing: [] }),
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
