import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/** All DAWN settings. Plain local config — no secrets, nothing sent anywhere. */
export interface Settings {
  ollamaUrl: string;
  chatModel: string;
  embedModel: string;
  defaultSystemPrompt: string;
  memoryEnabled: boolean;
  // Brain / performance
  brain3DEnabled: boolean;
  lowPerfMode: boolean;
  brainParticles: boolean;
  brainBloom: boolean;
  fpsCap: number; // 0 = uncapped
  nodeLimit: number;
  // Seeds for the knowledge graph
  projects: string[];

  // --- Local llama.cpp runtime ---
  modelPath: string; // selected .gguf
  runtimeExePath: string; // optional override of bundled llama-server.exe
  runtimePort: number;
  contextLength: number;
  threads: number; // 0 = auto
  gpuLayers: number;
  batchSize: number;
  ubatchSize: number;     // -ub physical batch (0 = let llama.cpp default)
  mmap: boolean;          // memory-map weights (default true); false => --no-mmap
  mlock: boolean;         // lock weights in RAM (--mlock) to avoid paging
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  maxTokens: number;
  lowVram: boolean;
  highPerformance: boolean;
  autoStartRuntime: boolean;
  unloadOnOff: boolean;
  keepAliveInTray: boolean;
  streaming: boolean;
  performanceMode: 'balanced' | 'high' | 'lowvram' | 'cpu';

  // --- Tools (agentic: PowerShell + Internet) ---
  toolsEnabled: boolean; // master switch for tool use in chat
  powershellEnabled: boolean; // allow the PowerShell tool
  webEnabled: boolean; // allow web search/fetch tools
  toolApproval: boolean; // require user approval before each tool runs (recommended)

  // --- Computer Access (File Agent + downloads) ---
  fileAgentEnabled: boolean; // allow DAWN to scan/organize files
  fileModifyScope: 'user' | 'anywhere'; // where DAWN may MODIFY files (read is broader)
  fileAutonomy: 'confirm' | 'auto' | 'full'; // confirm = preview+approve every change
  downloadEnabled: boolean; // allow DAWN to download files from the internet
  downloadDir: string; // quarantine folder for downloads (default: ~/Downloads/DAWN)
  softwareInstallEnabled: boolean; // allow DAWN to INSTALL/RUN software (winget or a downloaded installer), approval-gated
  codingChatTools: boolean; // expose Coding Autopilot commands (run/rollback/diff) in chat
  fullPowerMode: boolean; // UNRESTRICTED: any command, install anything, edit files anywhere — ask once per kind per session. Floor: credentials/secrets are never read or modified.
  // --- D.C.D (Dawn Cyber Defense) integration ---
  dcdEnabled: boolean;        // expose delegate_to_dcd (run scans / operate D.C.D from chat)
  dcdEnginePath: string;      // optional override of the trusted engine.exe path
  dcdAllowElevated: boolean;  // allow elevated D.C.D actions (still prompt + Windows UAC)

  // --- First run / knowledge ---
  firstRunComplete: boolean;
  knowledgeEnabled: boolean;
  indexedFolders: string[];
  ragTopK: number;
  ragMinScore: number;
  chunkSize: number;
  // --- Retrieval quality (hybrid + rewrite + rerank + verification) ---
  hybridRetrievalEnabled: boolean;   // vector + BM25 keyword fusion (default on)
  answerVerificationEnabled: boolean; // groundedness check of RAG answers (default on)
  entailmentEnabled: boolean;         // optional local-model entailment verification (default off)
  queryRewriteEnabled: boolean;       // local-model query rewriting (default off)
  hydeEnabled: boolean;               // HyDE-style expansion (default off)
  maxRewriteQueries: number;
  rewriteTimeoutMs: number;
  rerankerEnabled: boolean;           // cross-encoder rerank if configured (default off)
  rerankerModelPath: string;
  maxRerankCandidates: number;
  rerankTimeoutMs: number;
  // Dedicated retrieval helper model slots (single-runtime aware; empty = use loaded chat model)
  helperModels: { queryRewriteModel: string; hydeModel: string; entailmentModel: string; rerankerModel: string; preferChatModelFallback: boolean; timeoutMs: number; maxTokens: number };
  chunkOverlap: number;

  // --- Voice (local TTS) ---
  voiceEnabled: boolean;
  voiceEngine: 'auto' | 'kokoro' | 'piper' | 'system'; // kokoro/piper = neural; system = Web Speech
  voiceModel: string; // selected piper voice (.onnx path or name)
  voicePreset: string; // jarvis_inspired | calm_assistant | fast_system
  voiceName: string; // OS voice override (Web Speech engine)
  voiceRate: number;
  voicePitch: number;
  voiceVolume: number;
  speakCodeBlocks: boolean;
  startupGreeting: boolean;

  // --- Updates ---
  autoCheckUpdates: boolean;
  updateFeedDir: string; // local folder DAWN serves updates from (default: userData/updates)

  // --- Model Hub / routing ---
  modelsRoot: string; // optional override; default = userData/models
  modelRoles: { fast: string; coding: string; reasoning: string; embedding: string; vision: string };

  // --- Obsidian vault integration ---
  obsidianEnabled: boolean;
  vaultPath: string;
  vaultMemoryMode: 'off' | 'manual' | 'auto-important' | 'auto-all';
  vaultSearchInChat: boolean;
  vaultSecretDetection: boolean;
  vaultAutoLinking: boolean;
  vaultDailyNote: boolean;

  // --- Notion integration ---
  notionEnabled: boolean;
  notionToken: string;
  notionSearchInChat: boolean;

  // --- Phone / companion web access (full DAWN over your LAN + Tailscale) ---
  companionEnabled: boolean;   // run the local web server for phone access
  companionPort: number;       // LAN port (default 8765)
  companionPin: string;        // PIN the phone must enter (auto-generated on first enable)
  companionAllowTools: boolean;// allow tool use from phone sessions (still gated by toolApproval)

  // --- AI bridge: let other local apps (D.C.D) use DAWN as their Ollama-compatible brain ---
  aiBridgeEnabled: boolean;    // serve the Ollama-compatible API on 127.0.0.1
  aiBridgePort: number;        // default 11435 (Ollama itself keeps 11434)

  // --- AgentOS delegation (local multi-agent framework; read-only/audit mode) ---
  agentosEnabled: boolean;     // expose the delegate_to_agents tool in chat
  agentosApiUrl: string;       // AgentOS FastAPI (preferred transport)
  agentosDir: string;          // AgentOS install dir (CLI fallback + audit log path)
  // Per-run approval flow (one-time, least-privilege, expiring grants). Default-safe.
  agentosApprovalRequired: boolean;     // always require explicit approval for side effects
  agentosAllowPatchApproval: boolean;   // allow approving a one-time patch/write
  agentosAllowTestApproval: boolean;    // allow approving a one-time allow-listed test command
  agentosAllowNetworkApproval: boolean; // network execution stays disabled this phase
  agentosApprovalTtlSeconds: number;    // grant lifetime
  agentosMaxApprovedCalls: number;      // calls per grant (1 = single-use)
  // --- AgentOS runtime manager (DAWN starts/monitors the local API) ---
  agentosAutoStart: boolean;            // start the AgentOS API when DAWN opens (if down)
  agentosPythonPath: string;            // optional override; else <dir>/.venv/Scripts/python.exe
  agentosApiHost: string;               // 127.0.0.1
  agentosApiPort: number;               // 8099
  agentosStartupTimeoutMs: number;      // readiness timeout
  agentosHealthCheckIntervalMs: number; // background re-check interval
  agentosPreferHttp: boolean;           // prefer HTTP transport over CLI
  agentosAllowCliFallback: boolean;     // allow CLI fallback when API is down
  agentosEmbeddingProviderExpected: string; // ollama
  agentosEmbeddingModelExpected: string;    // nomic-embed-text
  agentosOllamaUrl: string;             // real Ollama for embeddings (NOT the :11435 chat bridge)

  // --- Deep Research mode ---
  researchAllowWeb: boolean;        // allow web fetching during research (OFF by default; local-only works offline)
  researchMaxSources: number;       // 0 = use the depth default

  // --- Workspace (tasks) ---
  taskRemindersEnabled: boolean;    // local desktop notifications for task reminders

  // --- Tools / Skills registry ---
  toolApprovalMode: 'strict' | 'balanced' | 'permissive_low';  // default approval behavior

  // --- Email workspace (Part D) ---
  emailSyncLimit: number;                       // max recent messages fetched per sync (conservative)

  // --- Security / Auth / Vault (Part G) ---
  authEnabled: boolean;                         // require unlock (Secure mode). Default OFF (local desktop)
  lanModeEnabled: boolean;                      // LAN exposure intent (server not implemented yet)
  totpEnabled: boolean;                         // TOTP 2FA active (mirrors auth_config)
  sessionTimeoutMinutes: number;
  lockOnSleep: boolean;
  requireApprovalForHighRiskTools: boolean;
  requirePasswordForVaultReveal: boolean;
  requirePasswordForSettingsSecurityChanges: boolean;

  // --- Live Vision (webcam perception) ---
  liveVisionEnabled: boolean;       // master switch (camera still OFF until started)
  visionDevice: number;             // camera index
  visionWidth: number;
  visionHeight: number;
  visionFps: number;                // detection loop fps
  visionConf: number;               // detection confidence threshold
  visionOcrAuto: boolean;
  visionSaveSnapshots: boolean;     // never save frames unless true
  visionSnapshotDir: string;
  visionUseInChat: boolean;         // let chat use live camera context
  vlmModelPath: string;             // Qwen2.5-VL GGUF
  vlmMmprojPath: string;            // its mmproj
  visionVlmMode: 'coexist' | 'swap';
  // --- Chat image attachments (Vision Chat) ---
  maxImageAttachmentMB: number;     // reject images larger than this (default 10)
  maxImageDimensionPx: number;      // reject images wider/taller than this (default 4096)
  maxImagesPerMessage: number;      // cap attachments per message (default 4)
}

export const DEFAULTS: Settings = {
  ollamaUrl: 'http://localhost:11434',
  chatModel: '',
  embedModel: 'nomic-embed-text',
  defaultSystemPrompt:
    'You are DAWN (Digitally Autonomous Workspace Node), a calm, intelligent local AI assistant running entirely on the user\'s computer. Always write your name in capitals: DAWN. Be concise and helpful. You are not conscious or sentient; you are a useful local system.',
  memoryEnabled: true,
  brain3DEnabled: true,
  lowPerfMode: false,
  brainParticles: true,
  brainBloom: true,
  fpsCap: 0,
  nodeLimit: 1500,
  projects: [
    'Daybreak',
    'Beekeeping software',
    'Gardening / greenhouse',
    'Local AI assistant',
    'Home automation',
    'Arcade scoring app',
  ],

  modelPath: '',
  runtimeExePath: '',
  runtimePort: 8080,
  contextLength: 4096,
  threads: 0,
  gpuLayers: 0,
  batchSize: 512,
  ubatchSize: 0,
  mmap: true,
  mlock: false,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  maxTokens: 1024,
  lowVram: false,
  highPerformance: false,
  autoStartRuntime: false,
  unloadOnOff: true,
  keepAliveInTray: false,
  streaming: true,
  performanceMode: 'balanced',

  toolsEnabled: false,
  powershellEnabled: false,
  webEnabled: false,
  toolApproval: true,

  fileAgentEnabled: false,
  fileModifyScope: 'user',
  fileAutonomy: 'confirm',
  downloadEnabled: false,
  downloadDir: '',
  softwareInstallEnabled: false,
  codingChatTools: true,
  fullPowerMode: false,
  dcdEnabled: true,
  dcdEnginePath: '',
  dcdAllowElevated: true,

  firstRunComplete: false,
  knowledgeEnabled: false,
  indexedFolders: [],
  ragTopK: 5,
  ragMinScore: 0.05,
  hybridRetrievalEnabled: true,
  answerVerificationEnabled: true,
  entailmentEnabled: false,
  queryRewriteEnabled: false,
  hydeEnabled: false,
  maxRewriteQueries: 2,
  rewriteTimeoutMs: 8000,
  rerankerEnabled: false,
  rerankerModelPath: '',
  maxRerankCandidates: 20,
  rerankTimeoutMs: 8000,
  helperModels: { queryRewriteModel: '', hydeModel: '', entailmentModel: '', rerankerModel: '', preferChatModelFallback: true, timeoutMs: 8000, maxTokens: 200 },
  chunkSize: 1200,
  chunkOverlap: 200,

  voiceEnabled: false,
  voiceEngine: 'auto',
  voiceModel: '',
  voicePreset: 'jarvis_inspired',
  voiceName: '',
  voiceRate: 0.98,
  voicePitch: 0.9,
  voiceVolume: 1,
  speakCodeBlocks: false,
  startupGreeting: false,

  autoCheckUpdates: true,
  updateFeedDir: '',

  modelsRoot: '',
  modelRoles: { fast: '', coding: '', reasoning: '', embedding: '', vision: '' },

  obsidianEnabled: false,
  vaultPath: '',
  vaultMemoryMode: 'manual',
  vaultSearchInChat: true,
  vaultSecretDetection: true,
  vaultAutoLinking: true,
  vaultDailyNote: true,

  notionEnabled: false,
  notionToken: '',
  notionSearchInChat: true,

  companionEnabled: false,
  companionPort: 8765,
  companionPin: '',
  companionAllowTools: false,

  aiBridgeEnabled: true,
  aiBridgePort: 11435,

  agentosEnabled: true,
  agentosApiUrl: 'http://127.0.0.1:8099',
  agentosDir: 'C:\\Users\\benma\\agentos',
  agentosApprovalRequired: true,
  agentosAllowPatchApproval: true,
  agentosAllowTestApproval: true,
  agentosAllowNetworkApproval: false,
  agentosApprovalTtlSeconds: 300,
  agentosMaxApprovedCalls: 1,
  agentosAutoStart: true,
  agentosPythonPath: '',
  agentosApiHost: '127.0.0.1',
  agentosApiPort: 8099,
  agentosStartupTimeoutMs: 15000,
  agentosHealthCheckIntervalMs: 30000,
  agentosPreferHttp: true,
  agentosAllowCliFallback: true,
  agentosEmbeddingProviderExpected: 'ollama',
  agentosEmbeddingModelExpected: 'nomic-embed-text',
  agentosOllamaUrl: 'http://127.0.0.1:11434',

  researchAllowWeb: false,
  researchMaxSources: 0,

  taskRemindersEnabled: true,
  toolApprovalMode: 'balanced',

  emailSyncLimit: 50,

  authEnabled: false,
  lanModeEnabled: false,
  totpEnabled: false,
  sessionTimeoutMinutes: 30,
  lockOnSleep: true,
  requireApprovalForHighRiskTools: true,
  requirePasswordForVaultReveal: true,
  requirePasswordForSettingsSecurityChanges: true,

  liveVisionEnabled: false,
  visionDevice: 0,
  visionWidth: 1280,
  visionHeight: 720,
  visionFps: 6,
  visionConf: 0.35,
  visionOcrAuto: false,
  visionSaveSnapshots: false,
  visionSnapshotDir: '',
  visionUseInChat: true,
  vlmModelPath: '',
  vlmMmprojPath: '',
  visionVlmMode: 'coexist',
  maxImageAttachmentMB: 10,
  maxImageDimensionPx: 4096,
  maxImagesPerMessage: 4,
};

let cache: Settings | null = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}
const bakFile = () => file() + '.bak';
const tmpFile = () => file() + '.tmp';

/** Parse a settings JSON, tolerating a UTF-8 BOM (which JSON.parse otherwise rejects). */
function readSettings(p: string): Settings | null {
  try {
    if (!fs.existsSync(p)) return null;
    let raw = fs.readFileSync(p, 'utf-8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip UTF-8 BOM (JSON.parse rejects it)
    raw = raw.trim();
    if (!raw) return null;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

/**
 * Load settings durably. Order: main file → last-good backup → defaults. This
 * exists because a half-written or BOM-corrupted settings.json must NEVER cause
 * a silent reset to defaults (which would "unlink" the Obsidian vault, disable
 * phone access, forget models, etc.). A corrupt main file is preserved for
 * forensics and recovered from the backup when possible.
 */
export function load(): Settings {
  if (cache) return cache;
  const main = readSettings(file());
  if (main) {
    cache = main;
    // Ensure a last-good backup exists right away (insurance for the current state).
    try { if (!fs.existsSync(bakFile())) fs.writeFileSync(bakFile(), JSON.stringify(main, null, 2), 'utf-8'); } catch { /* */ }
    return cache;
  }

  // Main missing or corrupt — try the backup before ever falling to defaults.
  const backup = readSettings(bakFile());
  if (backup) {
    // Preserve the unreadable main file (if any) instead of destroying it.
    try { if (fs.existsSync(file())) fs.renameSync(file(), file() + '.corrupt-' + Date.now()); } catch { /* */ }
    try { fs.copyFileSync(bakFile(), file()); } catch { /* */ }
    cache = backup;
    return cache;
  }
  cache = { ...DEFAULTS };
  return cache;
}

export function get(): Settings {
  return load();
}

/** Atomic, backed-up save: write a temp file, atomically replace settings.json,
 *  then refresh the .bak — so an interrupted write can never truncate the real file. */
export function save(patch: Partial<Settings>): Settings {
  cache = { ...load(), ...patch };
  const data = JSON.stringify(cache, null, 2);
  try {
    fs.writeFileSync(tmpFile(), data, 'utf-8');
    fs.renameSync(tmpFile(), file()); // atomic replace on Windows (MoveFileEx)
    fs.writeFileSync(bakFile(), data, 'utf-8'); // keep last-good copy
  } catch {
    // Last resort: direct write (still better than losing the patch entirely).
    try { fs.writeFileSync(file(), data, 'utf-8'); } catch { /* */ }
  }
  return cache;
}

/** Drop the in-memory cache and re-read from disk (used after a restore swaps settings.json). */
export function reload(): Settings { cache = null; return load(); }
/** Absolute path of the settings file (for backup/restore staging). */
export function filePath(): string { return file(); }
/** Replace ALL settings from a restored object (merged over defaults), persisted atomically. */
export function importSettings(obj: Partial<Settings>): Settings {
  cache = { ...DEFAULTS, ...(obj || {}) };
  try { fs.writeFileSync(tmpFile(), JSON.stringify(cache, null, 2), 'utf-8'); fs.renameSync(tmpFile(), file()); } catch { /* */ }
  return cache;
}

export default { get, load, save, reload, filePath, importSettings, DEFAULTS };
