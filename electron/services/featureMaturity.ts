/**
 * featureMaturity.ts — electron service behind the System Health page. It gathers honest, live
 * "signals" from durable state (settings + DB counts + a few safe service probes), feeds them to
 * the pure classifier (featureMaturityCore), persists the last status/error/timestamp per area in
 * the `feature_maturity` table, and exposes list/check/get. Every probe is wrapped — a failing
 * probe degrades that area's signal to a safe default and never throws.
 */
import db from './db';
import settings from './settings';
import logger from './logger';
import core, { AreaReport, MaturitySignals } from './featureMaturityCore';

/** SELECT COUNT(*) for a table; 0 if the table/query fails. */
function count(table: string, where = ''): number {
  try {
    const row = db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}${where ? ' WHERE ' + where : ''}`);
    return row ? Number(row.c) || 0 : 0;
  } catch { return 0; }
}

function tryNum(fn: () => number): number { try { const v = fn(); return typeof v === 'number' && isFinite(v) ? v : 0; } catch { return 0; } }
function tryBool(fn: () => boolean): boolean { try { return !!fn(); } catch { return false; } }
function tryStr(fn: () => string | null | undefined): string | null { try { const v = fn(); return v == null ? null : String(v); } catch { return null; } }

/** Gather all signals from durable state. Never throws. */
export function gatherSignals(): MaturitySignals {
  const s: any = (() => { try { return settings.get(); } catch { return {}; } })();

  // runtime / models (lazy-required so a runtime import problem can't break this page)
  let runtimeState = ''; let runtimeInstalled = false;
  try { const rt = require('./runtime').default; const st = rt.status ? rt.status() : null; if (st) { runtimeState = st.state || ''; runtimeInstalled = st.installed !== false && st.state !== 'NO_RUNTIME'; } } catch { /* */ }
  const modelCount = tryNum(() => { const m = require('./models').default; const list = m.list ? m.list() : []; return Array.isArray(list) ? list.length : 0; });
  const modelSelected = tryBool(() => !!(s.modelPath || s.chatModel));

  // auth / totp (settings is the source of truth; auth service is a soft cross-check)
  let authEnabled = !!s.authEnabled; let totpEnabled = false;
  try { const a = require('./security/auth').default; const st = a.status ? a.status() : null; if (st) { authEnabled = !!(st.authEnabled ?? authEnabled); totpEnabled = !!st.totpEnabled; } } catch { /* */ }

  const emailAccounts = count('email_accounts');
  const emailLastStatus = emailAccounts > 0
    ? tryStr(() => { const r = db.get<any>('SELECT last_sync_status FROM email_accounts ORDER BY rowid DESC LIMIT 1'); return r ? r.last_sync_status : null; })
    : null;

  const dcdAvailable = tryBool(() => { const d = require('./dcd').default; const st = d.status ? d.status() : null; return !!(st && (st.available || st.installed || st.ready)); });

  // Vision Chat: honest capability probe (no model paths leak — only booleans/reason).
  let visionChatReady = false, visionChatMode = 'none', visionChatReason = '', visionChatNextAction = '', visionModelConfigured = false, visionCliPresent = false;
  // Retrieval quality signals (hybrid mode + eval last-run, if any)
  let ragRetrievalMode = 'unavailable', ragEmbeddedChunks = 0, ragTotalChunks = 0;
  try { const r = require('./rag').default; const info = r.retrievalInfo ? r.retrievalInfo() : null; if (info) { ragRetrievalMode = info.mode; ragEmbeddedChunks = info.embeddedChunks; ragTotalChunks = info.totalChunks; } } catch { /* */ }
  let ragEvalLastRunAt = 0, ragEvalCases = 0; let ragEvalHitRate: number | null = null; let ragEvalGroundedness: number | null = null;
  try {
    const p = require('path').join(require('electron').app.getAppPath(), 'evals', 'last-results.json');
    if (require('fs').existsSync(p)) { const j = JSON.parse(require('fs').readFileSync(p, 'utf8')); const su = j.summary || {}; ragEvalLastRunAt = su.ranAt || 0; ragEvalCases = su.cases || 0; ragEvalHitRate = su.retrievalHitRate ?? null; ragEvalGroundedness = su.meanGroundedness ?? null; }
  } catch { /* not run in this install — honest */ }

  let visionMmprojConfigured = false, visionSetupState = 'not_configured';
  try { const vc = require('./vision/visionChat').default; const c = vc.capabilities ? vc.capabilities() : null; if (c) { visionChatReady = !!c.ready; visionChatMode = c.mode || 'none'; visionChatReason = c.reason || ''; visionChatNextAction = c.nextAction || ''; visionModelConfigured = !!c.modelConfigured; visionCliPresent = !!c.cliPresent; } const v = vc.validate ? vc.validate() : null; if (v) { visionMmprojConfigured = !!v.mmprojConfigured; visionSetupState = v.state || 'not_configured'; } } catch { /* */ }

  const now = Date.now();
  return {
    runtimeState, runtimeInstalled, modelSelected, modelCount,
    benchmarkCount: count('benchmarks'),
    optimizerCount: tryNum(() => count('model_optimizations')),
    embeddingsAvailable: tryBool(() => !!s.embedModel),
    conversations: count('conversations'),
    memories: count('memories'),
    documents: count('documents'),
    notes: count('notes'),
    tasks: count('tasks'),
    overdueTasks: count('tasks', `status!='done' AND due_at IS NOT NULL AND due_at < ${now}`),
    events: count('calendar_events'),
    researchRuns: count('research_runs'),
    knowledgeSources: count('knowledge_sources'),
    knowledgeChunks: count('knowledge_chunks'),
    brainNodes: count('brain_nodes'),
    brainEdges: count('brain_edges'),
    skills: count('skills'),
    toolAudit: count('tool_audit'),
    promptEvents: count('prompt_security_events'),
    vaultItems: count('vault_items'),
    emailAccounts, emailLastStatus,
    backups: count('backup_history', "kind='backup'") || count('backup_history'),
    workspaceItems: tryNum(() => count('workspace_items')),
    workspaceLinks: tryNum(() => count('workspace_links')),
    workspaceRegistered: tryNum(() => count('workspace_items', 'ref_id IS NOT NULL')),
    knowledgeFailed: tryNum(() => count('knowledge_sources', "state='failed'")),
    knowledgeStale: tryNum(() => count('knowledge_sources', "state='stale'")),
    toolsEnabled: !!s.toolsEnabled,
    voiceEnabled: !!s.voiceEnabled, voiceEngine: s.voiceEngine || '',
    companionEnabled: !!s.companionEnabled,
    obsidianConfigured: !!(s.obsidianEnabled && s.vaultPath),
    notionConfigured: !!s.notionToken,
    visionEnabled: !!s.liveVisionEnabled,
    dcdAvailable,
    agentosEnabled: !!s.agentosEnabled,
    authEnabled, totpEnabled,
    firstRunComplete: !!s.firstRunComplete,
    codingWorkspaces: tryNum(() => count('coding_runs')),
    fileAgentEnabled: !!s.fileAgentEnabled,
    updaterConfigured: !!(s.updateFeedDir),
    commandPalette: true,    // global Ctrl/Cmd+K launcher (src/components/CommandPalette.tsx)
    globalSearch: true,      // Ctrl/Cmd+Shift+F overlay (src/components/GlobalSearch.tsx)
    indexedFolders: tryNum(() => Array.isArray(s.indexedFolders) ? s.indexedFolders.length : 0),
    visionChatReady, visionChatMode, visionChatReason, visionChatNextAction, visionModelConfigured, visionCliPresent,
    visionMmprojConfigured, visionSetupState,
    chatImages: tryNum(() => count('chat_attachments', "kind='image'")),
    ragRetrievalMode, ragEmbeddedChunks, ragTotalChunks,
    answerVerificationEnabled: s.answerVerificationEnabled !== false,
    queryRewriteEnabled: !!s.queryRewriteEnabled, hydeEnabled: !!s.hydeEnabled,
    rerankerEnabled: !!s.rerankerEnabled, rerankerConfigured: !!(s.rerankerEnabled && s.rerankerModelPath),
    ragEvalLastRunAt, ragEvalCases, ragEvalHitRate, ragEvalGroundedness,
  };
}

function ensureTable() {
  try {
    db.run(`CREATE TABLE IF NOT EXISTS feature_maturity (
      id TEXT PRIMARY KEY, status TEXT, last_checked INTEGER, last_error TEXT, detail TEXT
    )`);
  } catch { /* db.ts SCHEMA also creates it; ignore */ }
}

/** Merge persisted last_checked/last_error into a fresh evaluation. */
function withPersisted(reports: AreaReport[]): AreaReport[] {
  let rows: any[] = [];
  try { rows = db.all('SELECT id, last_checked, last_error FROM feature_maturity'); } catch { rows = []; }
  const byId: Record<string, any> = Object.fromEntries(rows.map((r) => [r.id, r]));
  return reports.map((r) => ({ ...r, lastCheckedAt: byId[r.id]?.last_checked ?? null, lastError: byId[r.id]?.last_error ?? null }));
}

/** List every area (fresh evaluation + persisted last-check metadata) + summary. */
export function list() {
  const reports = withPersisted(core.evaluateAll(gatherSignals()));
  return { reports, summary: core.summarizeReports(reports) };
}

/** Run health checks: evaluate, persist status/error/timestamp per area, return fresh reports. */
export function check() {
  ensureTable();
  const signals = gatherSignals();
  const reports = core.evaluateAll(signals);
  const now = Date.now();
  for (const r of reports) {
    const lastError = r.status === 'BROKEN' ? (r.missing[0] || 'health check failed') : null;
    try {
      db.run(
        `INSERT INTO feature_maturity (id, status, last_checked, last_error, detail) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, last_checked=excluded.last_checked, last_error=excluded.last_error, detail=excluded.detail`,
        [r.id, r.status, now, lastError, JSON.stringify({ works: r.works, missing: r.missing }).slice(0, 2000)]
      );
    } catch (e: any) { logger.error?.('health', `persist ${r.id}: ${String(e?.message || e).slice(0, 120)}`); }
  }
  const withMeta = reports.map((r) => ({ ...r, lastCheckedAt: now, lastError: r.status === 'BROKEN' ? (r.missing[0] || null) : null }));
  logger.info?.('health', `health check: ${withMeta.length} areas, ${core.summarizeReports(reports).completionPct}% complete`);
  return { reports: withMeta, summary: core.summarizeReports(reports), checkedAt: now };
}

export function get(id: string): AreaReport | null {
  return withPersisted([core.evaluateArea(id, gatherSignals())])[0] || null;
}

export default { list, check, get, gatherSignals };
