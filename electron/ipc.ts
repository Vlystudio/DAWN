import { ipcMain, shell, dialog, app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import chat, { resolveTool } from './services/chat';
import memory from './services/memory';
import graph from './services/graph';
import logger from './services/logger';
import settings from './services/settings';
import runtime from './services/runtime';
import models from './services/models';
import rag from './services/rag';
import catalog from './services/catalog';
import hardware from './services/hardware';
import optimizer from './services/optimizer/optimizer';
import research from './services/research/research';
import compare from './services/bench/compare';
import benchmark from './services/bench/benchmark';
import documents from './services/documents/documents';
import notes from './services/workspace/notes';
import tasks from './services/workspace/tasks';
import calendar from './services/calendar/calendar';
import promptSecurity from './services/security/promptSecurity';
import toolRegistry from './services/tools/toolRegistry';
import toolGateway from './services/tools/toolGateway';
import skills from './services/tools/skills';
import auth from './services/security/auth';
import vaultSvc from './services/security/vault';
import email from './services/email/email';
import backup from './services/backup/backup';
import download from './services/download';
import updater from './services/updater';
import vault from './services/vault';
import vaultIndex from './services/vaultIndex';
import vaultGraph from './services/vaultGraph';
import notion from './services/notion';
import piper from './services/piper';
import kokoro from './services/kokoro';
import vision from './services/vision';
import visionChat from './services/vision/visionChat';
import attachments from './services/attachments/attachments';
import helperRuntime from './services/rag/helperRuntime';
import companion from './services/companion';
import fileAgent from './services/fileAgent';
import featureMaturity from './services/featureMaturity';
import globalSearch from './services/globalSearch';
import diagnostics from './services/diagnostics';
import wsItems from './services/workspace/items';
import wsLinks from './services/workspace/links';
import wsSearch from './services/workspace/search';
import workspace from './services/workspace/workspace';
import wsRegistry from './services/workspace/registry';
import chatActions from './services/workspace/chatActions';
import modelCookbook from './services/optimizer/modelCookbook';
import db from './services/db';
import * as pathlib from 'path';

/**
 * Registry of every ipcMain handler, so the phone companion server can invoke
 * the exact same channels over HTTP (full feature parity, no logic forked).
 */
const ipcHandlers = new Map<string, (...a: any[]) => any>();
export function invokeIpc(channel: string, fakeEvent: any, args: any[]): any {
  const fn = ipcHandlers.get(channel);
  if (!fn) throw new Error(`unknown ipc channel: ${channel}`);
  return fn(fakeEvent, ...args);
}

/** All renderer-callable channels. The UI only reaches these via preload. */
export function registerIpc() {
  // Capture every handler registered below into ipcHandlers (for the companion
  // server), without touching each call site, then restore at the end.
  const origHandle = ipcMain.handle.bind(ipcMain);
  (ipcMain as any).handle = (channel: string, fn: any) => { ipcHandlers.set(channel, fn); return origHandle(channel, fn); };

  // Conversations + chat
  ipcMain.handle('conv:list', () => chat.listConversations());
  ipcMain.handle('conv:search', (_e, q) => chat.searchConversations(q));
  ipcMain.handle('conv:get', (_e, id) => ({
    conversation: require('./services/db').get('SELECT * FROM conversations WHERE id=?', [id]),
    messages: chat.getMessages(id),
  }));
  ipcMain.handle('conv:create', (_e, opts) => chat.createConversation(opts || {}));
  ipcMain.handle('conv:update', (_e, id, patch) => chat.updateConversation(id, patch || {}));
  ipcMain.handle('conv:delete', (_e, id) => chat.deleteConversation(id));

  ipcMain.handle('chat:send', (e, { conversationId, content, attachmentIds }) => {
    const hasImages = Array.isArray(attachmentIds) && attachmentIds.length > 0;
    if ((content && content.trim()) || hasImages) {
      const mid = chat.addMessage(conversationId, 'user', (content || '').trim());
      if (hasImages) attachments.attachToMessage(conversationId, mid, attachmentIds);
    }
    chat.generate(e.sender, conversationId);
    return { ok: true };
  });
  ipcMain.handle('chat:regenerate', (e, { conversationId }) => {
    chat.regenerate(e.sender, conversationId);
    return { ok: true };
  });
  ipcMain.handle('chat:stop', (_e, { conversationId }) => chat.stop(conversationId));

  // Chat image attachments (Vision Chat) — paste / upload / drop → local storage + DB
  ipcMain.handle('chat:attachments:addFromClipboard', (_e, { conversationId, dataUrl, name }) => attachments.addFromDataUrl(conversationId, dataUrl, name));
  ipcMain.handle('chat:attachments:addFromFile', async (e, { conversationId }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Attach an image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return attachments.addFromFile(conversationId, res.filePaths[0]);
  });
  ipcMain.handle('chat:attachments:removeDraft', (_e, { id }) => attachments.removeDraft(id));
  ipcMain.handle('chat:attachments:listDraft', (_e, { conversationId }) => attachments.listDraft(conversationId));
  ipcMain.handle('chat:attachments:listForMessage', (_e, { messageId }) => attachments.listForMessage(messageId));
  ipcMain.handle('chat:attachments:getPreview', (_e, { id }) => attachments.preview(id));
  ipcMain.handle('chat:attachments:getMetadata', (_e, { id }) => attachments.metadata(id));
  ipcMain.handle('vision:capabilities', () => {
    const c = visionChat.capabilities(); // sanitized — never expose the CLI/model path
    return { ready: c.ready, mode: c.mode, status: c.status, reason: c.reason, nextAction: c.nextAction, cliPresent: c.cliPresent, modelConfigured: c.modelConfigured };
  });
  // Vision Chat model setup (Model Cookbook panel) — file picks stay in main; only basenames return.
  ipcMain.handle('vision:validate', () => visionChat.validate());
  ipcMain.handle('vision:autoDetect', () => visionChat.autoDetect());
  ipcMain.handle('vision:applyPair', (_e, { modelName, mmprojName }) => visionChat.applyPair(modelName, mmprojName));
  ipcMain.handle('vision:clearSetup', () => visionChat.clearSetup());
  ipcMain.handle('vision:testModel', () => visionChat.testModel());
  ipcMain.handle('vision:pickModel', async (e, { kind }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: kind === 'mmproj' ? 'Select the mmproj projector (.gguf)' : 'Select the vision model (.gguf)', properties: ['openFile'], filters: [{ name: 'GGUF', extensions: ['gguf'] }] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return visionChat.setModelPath(kind === 'mmproj' ? 'mmproj' : 'model', res.filePaths[0]);
  });

  // Memory
  ipcMain.handle('memory:list', () => memory.list());
  ipcMain.handle('memory:add', (_e, { content, type }) => {
    const m = memory.add(content, type);
    graph.rebuild();
    return m;
  });
  ipcMain.handle('memory:update', (_e, id, patch) => {
    const m = memory.update(id, patch || {});
    graph.rebuild();
    return m;
  });
  ipcMain.handle('memory:remove', (_e, id) => {
    memory.remove(id);
    graph.rebuild();
    return true;
  });
  ipcMain.handle('memory:clear', () => {
    memory.clearAll();
    graph.rebuild();
    return true;
  });

  // Brain graph
  ipcMain.handle('graph:get', () => graph.getGraph());
  ipcMain.handle('graph:rebuild', () => graph.rebuild());
  ipcMain.handle('graph:node', (_e, id) => graph.getNodeDetail(id));

  // Settings
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:save', (_e, patch) => settings.save(patch || {}));

  // Logs
  ipcMain.handle('logs:get', () => logger.getAll());
  ipcMain.handle('logs:clear', () => {
    logger.clear();
    return true;
  });

  // Tool approval (PowerShell / web) from the chat tool-loop
  ipcMain.handle('chat:tool-resolve', (_e, { callId, approved }) => resolveTool(callId, approved));

  // --- Runtime (llama.cpp server) ---
  ipcMain.handle('runtime:status', () => runtime.getStatus());
  ipcMain.handle('runtime:start', () => runtime.start());
  ipcMain.handle('runtime:stop', () => runtime.stop());
  ipcMain.handle('runtime:restart', () => runtime.restart());
  ipcMain.handle('runtime:switchModel', (_e, p) => runtime.switchModel(p));
  ipcMain.handle('runtime:logs', () => runtime.getLogs());

  // --- Model Manager ---
  ipcMain.handle('model:list', () => models.list());
  ipcMain.handle('model:systemRam', () => models.systemRamGB());
  ipcMain.handle('model:select', (_e, p) => models.select(p));
  ipcMain.handle('model:remove', (_e, p) => models.remove(p));
  ipcMain.handle('model:openFolder', () => models.openFolder());
  ipcMain.handle('model:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Select a GGUF model', filters: [{ name: 'GGUF', extensions: ['gguf'] }], properties: ['openFile'] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return models.importModel(res.filePaths[0]);
  });

  // --- Local knowledge (RAG) ---
  ipcMain.handle('rag:status', () => rag.status());
  ipcMain.handle('rag:validate', () => rag.validate());
  // Retrieval quality: last-retrieval trace (safe), reranker status, in-app eval status/run.
  ipcMain.handle('rag:retrievalTrace', () => rag.retrievalTrace());
  ipcMain.handle('rag:rerankerStatus', () => require('./services/rag/reranker').default.status());
  ipcMain.handle('rag:evalStatus', () => require('./services/rag/ragEval').default.status());
  ipcMain.handle('rag:runEval', () => require('./services/rag/ragEval').default.run());
  ipcMain.handle('rag:reindexInfo', () => rag.reindexInfo());
  ipcMain.handle('rag:reindexOutdated', () => rag.reindexOutdated());
  // Dedicated helper runtime (a second llama-server for helper tasks)
  ipcMain.handle('helperRuntime:status', () => ({ ...helperRuntime.status(), roles: helperRuntime.roles() }));
  ipcMain.handle('helperRuntime:start', async () => { await helperRuntime.start(); return { ...helperRuntime.status(), roles: helperRuntime.roles() }; });
  ipcMain.handle('helperRuntime:stop', async () => { await helperRuntime.stop(); return { ...helperRuntime.status(), roles: helperRuntime.roles() }; });
  ipcMain.handle('helperRuntime:restart', async () => { await helperRuntime.restart(); return { ...helperRuntime.status(), roles: helperRuntime.roles() }; });
  ipcMain.handle('helperRuntime:test', () => helperRuntime.test());
  ipcMain.handle('helperRuntime:updateSettings', (_e, patch) => helperRuntime.updateSettings(patch || {}));
  ipcMain.handle('helperRuntime:queueStatus', () => require('./services/rag/helperQueue').default.status());
  ipcMain.handle('helperRuntime:cancelJobs', () => { require('./services/rag/helperQueue').default.cancelAll('cancelled'); return require('./services/rag/helperQueue').default.status(); });
  ipcMain.handle('helperRuntime:clearQueue', () => { require('./services/rag/helperQueue').default.clear('cleared'); return require('./services/rag/helperQueue').default.status(); });
  // Helper performance analytics (safe metadata only — never prompt/response/chunk/source text)
  ipcMain.handle('helperRuntime:analytics', () => require('./services/rag/helperAnalyticsCore').default.snapshot(app.getVersion()));
  ipcMain.handle('helperRuntime:resetAnalytics', () => { require('./services/rag/helperAnalyticsCore').default.reset(); return { ok: true }; });
  ipcMain.handle('helperRuntime:exportAnalytics', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showSaveDialog(win!, { title: 'Export helper analytics (safe)', defaultPath: `dawn-helper-analytics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, JSON.stringify(require('./services/rag/helperAnalyticsCore').default.snapshot(app.getVersion()), null, 2));
    return { ok: true, path: require('path').basename(res.filePath) };
  });
  ipcMain.handle('helperRuntime:pickModel', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Select a small helper model (.gguf)', properties: ['openFile'], filters: [{ name: 'GGUF', extensions: ['gguf'] }] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return helperRuntime.updateSettings({ modelPath: res.filePaths[0] });
  });
  ipcMain.handle('rag:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Choose a folder to index', properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('rag:estimate', (_e, folder) => rag.estimate(folder));
  ipcMain.handle('rag:addFolder', (_e, folder) => rag.addFolder(folder));
  ipcMain.handle('rag:removeFolder', (_e, folder) => rag.removeFolder(folder));
  ipcMain.handle('rag:index', () => { rag.indexAll(); return { ok: true }; });
  ipcMain.handle('rag:pause', () => rag.pause());
  ipcMain.handle('rag:deleteAll', () => rag.deleteAll());

  // --- AgentOS runtime manager (start/monitor the local AgentOS API) ---
  const agRt = () => require('./services/agentosRuntime').default.runtime();
  const agClient = () => require('./services/agentos').default;
  const agOpts = () => ({ agentosDir: settings.get().agentosDir, apiUrl: settings.get().agentosApiUrl });
  ipcMain.handle('agentos:status', () => agRt().getStatus());
  ipcMain.handle('agentos:refresh', () => agRt().refresh());
  ipcMain.handle('agentos:start', () => agRt().ensure());
  ipcMain.handle('agentos:stop', () => agRt().stop());
  ipcMain.handle('agentos:restart', () => agRt().restart());
  ipcMain.handle('agentos:logs', () => agRt().getLogs());
  ipcMain.handle('agentos:collections', () => agClient().ragCollections(agOpts()));
  ipcMain.handle('agentos:sources', (_e, collection) => agClient().ragListSources(String(collection || 'default'), agOpts()));
  ipcMain.handle('agentos:stale', (_e, collection) => agClient().ragStale(String(collection || 'default'), agOpts()));
  ipcMain.handle('agentos:reindex', (_e, { collection, path: p }) => agClient().ragReindex(String(collection || 'default'), p || undefined, agOpts()));
  ipcMain.handle('agentos:deleteSource', (_e, { collection, sourceId }) => agClient().ragDeleteSource(String(collection || 'default'), String(sourceId || ''), agOpts()));
  ipcMain.handle('agentos:search', (_e, { query, collection, topK }) => agClient().ragSearch(String(query || ''), String(collection || 'default'), Number(topK) || 5, agOpts()));
  ipcMain.handle('agentos:answer', (_e, { query, collection, topK }) => agClient().ragAnswer(String(query || ''), String(collection || 'default'), Number(topK) || 5, agOpts()));
  // The client (ragIngest) refuses protected/broad paths itself (fail closed in one place).
  ipcMain.handle('agentos:ingest', (_e, { path: p, collection }) => agClient().ragIngest(String(p || ''), String(collection || 'default'), agOpts()));
  ipcMain.handle('agentos:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Choose a folder to index into AgentOS', properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  // --- Coding Agent (trusted-workspace autopilot) ---
  const coding = () => require('./services/codingService').default;
  ipcMain.handle('coding:listWorkspaces', () => coding().listWorkspaces());
  ipcMain.handle('coding:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Choose a project folder for Coding Autopilot', properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('coding:addWorkspace', (_e, folder) => coding().addWorkspace(String(folder || '')));
  ipcMain.handle('coding:updateWorkspace', (_e, { id, patch }) => coding().updateWorkspace(String(id), patch || {}));
  ipcMain.handle('coding:removeWorkspace', (_e, id) => ({ ok: coding().removeWorkspace(String(id)) }));
  ipcMain.handle('coding:workspaceInfo', (_e, id) => coding().workspaceInfo(String(id)));
  ipcMain.handle('coding:run', (e, { workspaceId, task, mode }) => coding().run(e.sender, String(workspaceId), String(task || ''), mode));
  ipcMain.handle('coding:cancel', (_e, workspaceId) => coding().cancel(String(workspaceId)));
  ipcMain.handle('coding:status', (_e, workspaceId) => coding().status(String(workspaceId)));
  ipcMain.handle('coding:getDiff', (_e, { workspaceId, runId }) => coding().getDiff(String(workspaceId), runId));
  ipcMain.handle('coding:rollback', (_e, { workspaceId, runId }) => coding().rollback(String(workspaceId), String(runId)));
  ipcMain.handle('coding:resolveApproval', (_e, { id, approved }) => coding().resolveApproval(String(id), !!approved));

  // --- D.C.D (Dawn Cyber Defense) antivirus control ---
  const dcd = () => require('./services/dcd').default;
  ipcMain.handle('dcd:available', () => {
    const s = settings.get();
    return dcd().resolveEngine({ enginePath: s.dcdEnginePath || undefined }, { pathExists: (p: string) => require('fs').existsSync(p) });
  });
  ipcMain.handle('dcd:operations', () => dcd().listOperations());
  ipcMain.handle('dcd:run', (_e, { operation, params }) => {
    const s = settings.get();
    return dcd().runOperation(String(operation || ''), params || {}, { enginePath: s.dcdEnginePath || undefined, allowElevated: s.dcdAllowElevated !== false });
  });

  // --- First-run setup ---
  ipcMain.handle('setup:complete', (_e, patch) => {
    const next = settings.save({ ...(patch || {}), firstRunComplete: true });
    // ensure local folders exist
    for (const sub of ['models', 'logs', 'knowledge']) {
      try { fs.mkdirSync(path.join(app.getPath('userData'), sub), { recursive: true }); } catch { /* */ }
    }
    return next;
  });

  // --- Auto-updater ---
  ipcMain.handle('updater:check', () => updater.check());
  ipcMain.handle('updater:install', () => updater.quitAndInstall());

  // --- Model Hub ---
  ipcMain.handle('hub:catalog', () => catalog.getCatalog());
  ipcMain.handle('hub:hardware', () => hardware.detect());
  ipcMain.handle('hub:download', (_e, { modelId, family, filename, url, sha }) => download.start(modelId, family, filename, url, sha));
  ipcMain.handle('hub:pause', (_e, id) => download.pause(id));
  ipcMain.handle('hub:resume', (_e, id) => download.resume(id));
  ipcMain.handle('hub:cancel', (_e, id) => download.cancel(id));
  ipcMain.handle('hub:downloads', () => download.list());
  ipcMain.handle('hub:roles', () => settings.get().modelRoles);
  ipcMain.handle('hub:setRole', (_e, { role, path: p }) => {
    const roles = { ...settings.get().modelRoles, [role]: p };
    settings.save({ modelRoles: roles });
    return roles;
  });
  ipcMain.handle('hub:switchTo', async (_e, p) => runtime.switchModel(p));

  // --- Model Optimizer (hardware-aware auto-tuning) ---
  ipcMain.handle('optimizer:hardware', (_e, force) => optimizer.getHardware(!!force));
  ipcMain.handle('optimizer:list', () => optimizer.listModels());
  ipcMain.handle('optimizer:analyze', (_e, { modelId, mode }) => optimizer.analyze(modelId, mode));
  ipcMain.handle('optimizer:previewModes', (_e, modelId) => optimizer.previewModes(modelId));
  ipcMain.handle('optimizer:apply', (_e, { modelId, ...opts }) => optimizer.apply(modelId, opts || {}));
  ipcMain.handle('optimizer:resetToRecommended', (_e, modelId) => optimizer.resetToRecommended(modelId));
  ipcMain.handle('optimizer:setManualOverride', (_e, { modelId, override }) => optimizer.setManualOverride(modelId, !!override));
  ipcMain.handle('optimizer:reoptimizeNeeded', (_e, modelId) => optimizer.reoptimizeNeeded(modelId));
  ipcMain.handle('optimizer:recommendForTask', (_e, task) => optimizer.recommendForTask(task));
  ipcMain.handle('optimizer:name', (_e, id) => optimizer.nameFor(id));
  ipcMain.handle('models:cookbook', () => modelCookbook.cookbook());
  ipcMain.handle('optimizer:names', (_e, ids) => optimizer.namesFor(ids || []));

  // --- Deep Research mode ---
  ipcMain.handle('research:start', (_e, opts) => research.start(opts || {}));
  ipcMain.handle('research:cancel', (_e, runId) => research.cancel(runId));
  ipcMain.handle('research:pause', (_e, runId) => research.pause(runId));
  ipcMain.handle('research:resume', (_e, runId) => research.resume(runId));
  ipcMain.handle('research:list', () => research.list());
  ipcMain.handle('research:get', (_e, runId) => research.get(runId));
  ipcMain.handle('research:report', (_e, runId) => research.getReport(runId));
  ipcMain.handle('research:delete', (_e, runId) => research.delete(runId));
  ipcMain.handle('research:export', (_e, { runId, format }) => research.export(runId, format));
  ipcMain.handle('research:models', () => ({ models: models.list().map((m: any) => ({ name: m.name, path: m.path })), loaded: settings.get().modelPath }));

  // --- Model Arena (compare) ---
  ipcMain.handle('compare:start', (_e, opts) => compare.start(opts || {}));
  ipcMain.handle('compare:cancel', (_e, runId) => compare.cancel(runId));
  ipcMain.handle('compare:judge', (_e, { runId, judgeModel }) => compare.judge(runId, judgeModel));
  ipcMain.handle('compare:list', () => compare.list());
  ipcMain.handle('compare:get', (_e, runId) => compare.get(runId));
  ipcMain.handle('compare:delete', (_e, runId) => compare.delete(runId));

  // --- Benchmarking ---
  ipcMain.handle('bench:run', (_e, modelPath) => benchmark.run(modelPath));
  ipcMain.handle('bench:history', (_e, modelPath) => benchmark.history(modelPath));
  ipcMain.handle('bench:best', () => benchmark.bestForThisPC());
  ipcMain.handle('bench:delete', (_e, id) => benchmark.delete(id));
  ipcMain.handle('bench:busy', () => benchmark.isBusy());

  // --- Documents workspace ---
  ipcMain.handle('docs:list', () => documents.list());
  ipcMain.handle('docs:get', (_e, id) => documents.get(id));
  ipcMain.handle('docs:create', (_e, opts) => documents.create(opts || {}));
  ipcMain.handle('docs:update', (_e, { id, patch }) => documents.update(id, patch || {}));
  ipcMain.handle('docs:remove', (_e, id) => documents.remove(id));
  ipcMain.handle('docs:saveVersion', (_e, { id, label }) => documents.saveVersion(id, label));
  ipcMain.handle('docs:versions', (_e, id) => documents.versions(id));
  ipcMain.handle('docs:restore', (_e, { docId, versionId }) => documents.restoreVersion(docId, versionId));
  ipcMain.handle('docs:ai', (_e, { id, action }) => documents.aiAction(id, action));
  ipcMain.handle('docs:export', (_e, { id, format }) => documents.exportDoc(id, format));
  ipcMain.handle('docs:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Import document', properties: ['openFile'], filters: [{ name: 'Documents', extensions: documents.supportedImport }] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return documents.importFile(res.filePaths[0]);
  });

  // --- Notes ---
  ipcMain.handle('notes:list', (_e, opts) => notes.list(opts || {}));
  ipcMain.handle('notes:get', (_e, id) => notes.get(id));
  ipcMain.handle('notes:search', (_e, q) => notes.search(q));
  ipcMain.handle('notes:create', (_e, opts) => notes.create(opts || {}));
  ipcMain.handle('notes:update', (_e, { id, patch }) => notes.update(id, patch || {}));
  ipcMain.handle('notes:remove', (_e, id) => notes.remove(id));
  ipcMain.handle('notes:summarize', (_e, id) => notes.aiSummarize(id));
  ipcMain.handle('notes:toTask', (_e, id) => notes.aiToTask(id));
  ipcMain.handle('notes:link', (_e, id) => notes.aiLink(id));
  ipcMain.handle('notes:unlink', (_e, linkId) => notes.unlink(linkId));

  // --- Tasks ---
  ipcMain.handle('tasks:list', (_e, opts) => tasks.list(opts || {}));
  ipcMain.handle('tasks:get', (_e, id) => tasks.get(id));
  ipcMain.handle('tasks:create', (_e, opts) => tasks.create(opts || {}));
  ipcMain.handle('tasks:update', (_e, { id, patch }) => tasks.update(id, patch || {}));
  ipcMain.handle('tasks:remove', (_e, id) => tasks.remove(id));
  ipcMain.handle('tasks:setStatus', (_e, { id, status }) => tasks.setStatus(id, status));
  ipcMain.handle('tasks:complete', (_e, id) => tasks.complete(id));
  ipcMain.handle('tasks:askDawn', (_e, id) => tasks.askDawn(id));
  ipcMain.handle('tasks:overdueCount', () => tasks.overdueCount());

  // --- Calendar ---
  ipcMain.handle('cal:list', (_e, { start, end }) => calendar.list(start, end));
  ipcMain.handle('cal:create', (_e, ev) => calendar.create(ev || {}));
  ipcMain.handle('cal:update', (_e, { id, patch }) => calendar.update(id, patch || {}));
  ipcMain.handle('cal:remove', (_e, id) => calendar.remove(id));
  ipcMain.handle('cal:exportIcs', (_e, range) => calendar.exportIcs(range?.start, range?.end));
  ipcMain.handle('cal:importIcs', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Import calendar (.ics)', properties: ['openFile'], filters: [{ name: 'iCalendar', extensions: ['ics'] }] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    try { return calendar.importIcs(require('fs').readFileSync(res.filePaths[0], 'utf8')); }
    catch (err: any) { return { ok: false, error: err.message }; }
  });

  // --- Prompt security (audit log) ---
  ipcMain.handle('security:recent', (_e, limit) => promptSecurity.recent(limit || 100));
  ipcMain.handle('security:count', () => promptSecurity.count());
  ipcMain.handle('security:clear', () => promptSecurity.clear());

  // --- Tool registry + gateway ---
  ipcMain.handle('tools:list', () => toolRegistry.list());
  ipcMain.handle('tools:get', (_e, id) => toolRegistry.get(id));
  ipcMain.handle('tools:updateEnabled', (_e, { id, enabled }) => toolRegistry.updateEnabled(id, !!enabled));
  ipcMain.handle('tools:providers', () => toolRegistry.providerList());
  ipcMain.handle('tools:auditRecent', (_e, limit) => toolRegistry.auditRecent(limit || 100));
  ipcMain.handle('tools:auditClear', () => toolRegistry.auditClear());
  ipcMain.handle('tools:execute', (_e, { toolId, input }) => toolGateway.execute(toolId, input || {}));
  ipcMain.handle('tools:approvalResponse', (_e, { id, decision }) => toolGateway.resolveApproval(id, decision));

  // --- Skills ---
  ipcMain.handle('skills:list', () => skills.list());
  ipcMain.handle('skills:get', (_e, id) => skills.get(id));
  ipcMain.handle('skills:create', (_e, opts) => skills.create(opts || {}));
  ipcMain.handle('skills:update', (_e, { id, patch }) => skills.update(id, patch || {}));
  ipcMain.handle('skills:delete', (_e, id) => skills.remove(id));
  ipcMain.handle('skills:test', (_e, { id, input }) => skills.test(id, input || ''));
  ipcMain.handle('skills:invokeTool', (_e, { id, toolId, input }) => skills.invokeTool(id, toolId, input || {}));
  ipcMain.handle('skills:auditRecent', (_e, { id, limit }) => skills.auditRecent(id, limit || 50));

  // --- Auth / session ---
  ipcMain.handle('auth:status', () => auth.status());
  ipcMain.handle('auth:setPassword', (_e, password) => auth.setPassword(password));
  ipcMain.handle('auth:changePassword', (_e, { current, next }) => auth.changePassword(current, next));
  ipcMain.handle('auth:verifyPassword', (_e, password) => auth.verifyPassword(password));
  ipcMain.handle('auth:unlock', (_e, { password, code }) => auth.unlock(password, code));
  ipcMain.handle('auth:lock', () => auth.lock());
  ipcMain.handle('auth:setSecuritySetting', (_e, { key, value, password }) => auth.setSecuritySetting(key, value, password));
  ipcMain.handle('auth:setupTotp', () => auth.setupTotp());
  ipcMain.handle('auth:confirmTotp', (_e, code) => auth.confirmTotp(code));
  ipcMain.handle('auth:disableTotp', (_e, password) => auth.disableTotp(password));
  ipcMain.handle('auth:regenerateBackupCodes', (_e, password) => auth.regenerateBackupCodes(password));
  ipcMain.handle('auth:backupRemaining', () => auth.backupCodesRemaining());
  ipcMain.handle('auth:audit', (_e, limit) => auth.recentAudit(limit || 100));
  ipcMain.handle('auth:lanStatus', () => auth.lanStatus());

  // --- Vault (all gated by the session when auth is enabled) ---
  const vaultGuard = () => auth.requireUnlockedSession();
  ipcMain.handle('vault:health', () => vaultSvc.health());
  ipcMain.handle('vault:list', () => { vaultGuard(); return vaultSvc.list(); });
  ipcMain.handle('vault:create', (_e, opts) => { vaultGuard(); const r = vaultSvc.create(opts); auth.auditSecurityAction('vault_create', `label=${(opts || {}).label || ''}`); return r; });
  ipcMain.handle('vault:update', (_e, { id, patch }) => { vaultGuard(); const r = vaultSvc.update(id, patch || {}); auth.auditSecurityAction('vault_update', `id=${id}`); return r; });
  ipcMain.handle('vault:delete', (_e, id) => { vaultGuard(); const r = vaultSvc.remove(id); auth.auditSecurityAction('vault_delete', `id=${id}`); return r; });
  ipcMain.handle('vault:reveal', (_e, { id, password }) => {
    vaultGuard();
    const s = settings.get();
    if (s.authEnabled && s.requirePasswordForVaultReveal) {
      if (!password || !auth.verifyPassword(password).ok) return { ok: false, error: 'Password required to reveal this secret.' };
    }
    const r = vaultSvc.reveal(id);
    auth.auditSecurityAction('vault_reveal', `id=${id}`, r.ok); // never logs the secret itself
    return r;
  });
  ipcMain.handle('vault:rotateMasterKey', () => vaultSvc.rotateMasterKey());

  // --- Email workspace ---
  ipcMain.handle('email:presets', () => email.presets);
  ipcMain.handle('email:providerGuides', () => email.providerGuides());
  ipcMain.handle('email:testIncoming', (_e, cfg) => email.testIncoming(cfg || {}));
  ipcMain.handle('email:testOutgoing', (_e, cfg) => email.testOutgoing(cfg || {}));
  ipcMain.handle('email:listAccounts', () => email.listAccounts());
  ipcMain.handle('email:getAccount', (_e, id) => email.getAccount(id));
  ipcMain.handle('email:createAccount', (_e, cfg) => email.createAccount(cfg || {}));
  ipcMain.handle('email:updateAccount', (_e, { id, patch }) => email.updateAccount(id, patch || {}));
  ipcMain.handle('email:deleteAccount', (_e, { id, deleteCredential }) => email.deleteAccount(id, deleteCredential !== false));
  ipcMain.handle('email:testConnection', (_e, cfg) => email.testConnection(cfg || {}));
  ipcMain.handle('email:listFolders', (_e, accountId) => email.listFolders(accountId));
  ipcMain.handle('email:sync', (_e, { accountId, folder }) => email.sync(accountId, folder));
  ipcMain.handle('email:listMessages', (_e, { accountId, folder, opts }) => email.listMessages(accountId, folder, opts || {}));
  ipcMain.handle('email:getMessage', (_e, id) => email.getMessage(id));
  ipcMain.handle('email:thread', (_e, threadKey) => email.thread(threadKey));
  ipcMain.handle('email:summarize', (_e, id) => email.summarize(id));
  ipcMain.handle('email:summarizeThread', (_e, threadKey) => email.summarizeThread(threadKey));
  ipcMain.handle('email:extractActions', (_e, id) => email.extractActions(id));
  ipcMain.handle('email:draftReply', (_e, { id, instruction }) => email.draftReply(id, instruction));
  ipcMain.handle('email:saveDraft', (_e, draft) => email.saveDraft(draft));
  ipcMain.handle('email:getDraft', (_e, id) => email.getDraft(id));
  ipcMain.handle('email:deleteDraft', (_e, id) => email.deleteDraft(id));
  // Sending always flows through the approval gateway (email.sendDraft = critical).
  ipcMain.handle('email:send', async (_e, draftId) => {
    const r = await toolGateway.execute('email.sendDraft', { draftId });
    if (!r.ok) return { ok: false, error: r.error || (r.blocked ? 'Send was not approved.' : 'Send failed.') };
    return { ok: true };
  });
  ipcMain.handle('email:attachmentInfo', (_e, id) => email.attachmentInfo(id));
  ipcMain.handle('email:downloadAttachment', (_e, id) => email.downloadAttachment(id));
  ipcMain.handle('email:tags', () => email.listTags());
  ipcMain.handle('email:createTag', (_e, { name, color }) => email.createTag(name, color));
  ipcMain.handle('email:tagMessage', (_e, { messageId, tagId }) => email.tagMessage(messageId, tagId));
  ipcMain.handle('email:untagMessage', (_e, { messageId, tagId }) => email.untagMessage(messageId, tagId));
  ipcMain.handle('email:createTask', (_e, id) => email.createTaskFromEmail(id));
  ipcMain.handle('email:createCalendar', (_e, id) => email.createCalendarFromEmail(id));
  ipcMain.handle('email:saveNote', (_e, id) => email.saveSummaryToNote(id));
  ipcMain.handle('email:audit', (_e, limit) => email.recentAudit(limit || 100));

  // --- Backup / Restore ---
  ipcMain.handle('backup:create', (_e, opts) => backup.create(opts || {}));
  ipcMain.handle('backup:estimateSize', (_e, opts) => backup.estimateSize(opts || {}));
  ipcMain.handle('backup:verify', (_e, p) => backup.verify(p));
  ipcMain.handle('backup:details', (_e, p) => backup.details(p));
  ipcMain.handle('backup:history', () => backup.history());
  ipcMain.handle('backup:openFolder', () => backup.openFolder());
  ipcMain.handle('backup:deleteSafetySnapshot', (_e, id) => backup.deleteSafetySnapshot(id));
  ipcMain.handle('backup:chooseDestination', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showSaveDialog(win!, { title: 'Save DAWN backup', defaultPath: `dawn-${new Date().toISOString().slice(0, 10)}.dawnbackup`, filters: [{ name: 'DAWN backup', extensions: ['dawnbackup'] }] });
    return res.canceled ? null : res.filePath;
  });
  ipcMain.handle('backup:chooseArchive', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Select a DAWN backup', properties: ['openFile'], filters: [{ name: 'DAWN backup', extensions: ['dawnbackup'] }] });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });
  // Restore: requires typed confirm (UI) + password (when authEnabled) + gateway approval (critical).
  ipcMain.handle('backup:restore', async (_e, { path: p, password }) => {
    const s = settings.get();
    if (s.authEnabled) {
      if (!auth.sessionActive()) return { ok: false, error: 'Unlock DAWN before restoring.' };
      if (!password || !auth.verifyPassword(password).ok) return { ok: false, error: 'Password verification required to restore.' };
    }
    const g = await toolGateway.execute('backup.restore', { path: p });
    if (!g.ok) return { ok: false, error: g.error || (g.blocked ? 'Restore was not approved.' : 'Restore failed.') };
    return { ok: true, needsReload: true };
  });

  // --- Obsidian vault ---
  ipcMain.handle('vault:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win!, { title: 'Select your Obsidian vault folder', properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('vault:connect', (_e, folder) => {
    const r = vault.connect(folder);
    if (r.ok) vaultIndex.reindex(); // auto-index right after connecting
    return r;
  });
  ipcMain.handle('vault:test', () => vault.test());
  ipcMain.handle('vault:status', () => ({ connected: vault.isConnected(), path: vault.vaultPath(), ...vaultIndex.status() }));
  ipcMain.handle('vault:reindex', () => vaultIndex.reindex());
  ipcMain.handle('vault:search', (_e, q) => vaultIndex.search(q));
  ipcMain.handle('vault:open', () => vault.openVault());
  ipcMain.handle('vault:openNote', (_e, rel) => vault.openNote(rel));
  ipcMain.handle('vault:writeMemory', async (_e, m) => {
    const r = vault.writeMemory(m);
    if (r.ok && r.path) await vaultIndex.indexFile(pathlib.join(vault.dawnDir(), r.path)).catch(() => 0);
    return r;
  });
  ipcMain.handle('vault:saveConversation', async (_e, conversationId) => {
    const conv: any = db.get('SELECT * FROM conversations WHERE id=?', [conversationId]);
    const msgs = chat.getMessages(conversationId);
    if (!msgs.length) return { ok: false, error: 'Empty conversation.' };
    const transcript = msgs.map((m: any) => `**${m.role}:** ${m.content}`).join('\n\n');
    const summary = (msgs.find((m: any) => m.role === 'user')?.content || '').slice(0, 240);
    const r = vault.writeConversation(conv?.title || 'Conversation', conv?.model || '', transcript, summary, conversationId);
    if (r.ok && r.path) await vaultIndex.indexFile(pathlib.join(vault.dawnDir(), r.path)).catch(() => 0);
    return r;
  });
  ipcMain.handle('vault:graphExport', () => vaultGraph.build());
  ipcMain.handle('vault:detectSecrets', (_e, text) => vault.detectSecrets(text));

  // --- Notion ---
  ipcMain.handle('notion:status', () => notion.status());
  ipcMain.handle('notion:connect', (_e, token) => notion.connect(token));
  ipcMain.handle('notion:test', () => notion.test());
  ipcMain.handle('notion:sync', async () => { const r = await notion.sync(); try { graph.rebuild(); } catch { /* */ } return r; });
  ipcMain.handle('notion:search', (_e, q) => notion.search(q));
  ipcMain.handle('notion:open', (_e, url) => notion.open(url));
  ipcMain.handle('notion:disconnect', () => { notion.disconnect(); return true; });

  // --- Voice (neural TTS: Kokoro preferred, Piper fallback) ---
  ipcMain.handle('voice:engine', () => ({
    piper: piper.available(),
    kokoro: kokoro.available(),
    piperVoices: piper.voices().map((v) => v.name),
    kokoroVoices: kokoro.voices(),
  }));
  ipcMain.handle('voice:synth', async (_e, text) => {
    const eng = settings.get().voiceEngine;
    let buf: Buffer | null = null;
    if (eng === 'kokoro') buf = await kokoro.synthesize(text);
    else if (eng === 'piper') buf = await piper.synthesize(text);
    else {
      // auto: best available neural engine, Kokoro first
      if (kokoro.available()) buf = await kokoro.synthesize(text);
      if (!buf && piper.available()) buf = await piper.synthesize(text);
    }
    return buf ? new Uint8Array(buf) : null;
  });

  // --- Live Vision (webcam perception sidecar) ---
  ipcMain.handle('vision:available', () => ({ available: vision.available(), hasModel: vision.hasModel() }));
  ipcMain.handle('vision:cameras', () => vision.listCameras());
  ipcMain.handle('vision:start', () => vision.start());
  ipcMain.handle('vision:stop', () => vision.stop());
  ipcMain.handle('vision:status', () => vision.status());
  ipcMain.handle('vision:detections', () => vision.detections());
  ipcMain.handle('vision:context', () => vision.context());
  ipcMain.handle('vision:ocr', () => vision.ocr());
  ipcMain.handle('vision:forget', () => vision.forget());
  ipcMain.handle('vision:snapshot', (_e, annotated) => vision.snapshot(!!annotated));
  ipcMain.handle('vision:frame', () => vision.frameDataUrl());

  // --- Phone access (companion web server) ---
  ipcMain.handle('companion:status', () => companion.status());
  ipcMain.handle('companion:setEnabled', (_e, enabled) => {
    settings.save({ companionEnabled: !!enabled });
    companion.apply();
    return companion.status();
  });
  ipcMain.handle('companion:setPort', (_e, port) => {
    const p = Math.max(1024, Math.min(65535, Number(port) || 8765));
    settings.save({ companionPort: p });
    companion.apply();
    return companion.status();
  });
  ipcMain.handle('companion:regeneratePin', () => { companion.regeneratePin(); return companion.status(); });
  ipcMain.handle('companion:firewall', () => companion.allowFirewall());

  // --- Computer Access (file agent) ---
  ipcMain.handle('fileagent:undo', () => fileAgent.undoLast());
  ipcMain.handle('fileagent:openDownloads', () => { shell.openPath(fileAgent.downloadDir()); return true; });
  ipcMain.handle('fileagent:scan', (_e, p) => fileAgent.scan(String(p || '')));

  // --- System Health / Feature Maturity ---
  ipcMain.handle('maturity:list', () => featureMaturity.list());
  ipcMain.handle('maturity:check', () => featureMaturity.check());
  ipcMain.handle('maturity:get', (_e, id) => featureMaturity.get(String(id || '')));

  // --- Global Search (never searches vault/auth/audit; snippets redacted) ---
  ipcMain.handle('search:query', (_e, term) => globalSearch.query(String(term || '')));

  // --- Workspace Graph (items + typed links across features) ---
  ipcMain.handle('workspace:items:list', (_e, opts) => wsItems.list(opts || {}));
  ipcMain.handle('workspace:items:get', (_e, id) => wsItems.get(String(id || '')));
  ipcMain.handle('workspace:items:create', (_e, input) => wsItems.create(input || {}));
  ipcMain.handle('workspace:items:update', (_e, { id, patch }) => wsItems.update(String(id || ''), patch || {}));
  ipcMain.handle('workspace:items:delete', (_e, id) => wsItems.remove(String(id || '')));
  ipcMain.handle('workspace:links:list', (_e, itemId) => wsLinks.listForItem(String(itemId || '')));
  ipcMain.handle('workspace:links:create', (_e, input) => wsLinks.create(input || {}));
  ipcMain.handle('workspace:links:delete', (_e, id) => wsLinks.remove(String(id || '')));
  ipcMain.handle('workspace:related:get', (_e, itemId) => wsLinks.related(String(itemId || '')));
  ipcMain.handle('workspace:search', (_e, q) => wsSearch.search(q || {}));
  ipcMain.handle('workspace:convertToTask', (_e, itemId) => workspace.convertToTask(String(itemId || '')));
  ipcMain.handle('workspace:saveAsNote', (_e, input) => workspace.saveAsNote(input || {}));
  ipcMain.handle('workspace:reconcile', () => wsRegistry.reconcile());
  ipcMain.handle('workspace:coverage', () => wsRegistry.coverage());

  // --- Chat cross-feature actions (real message → note/task/document/memory, linked) ---
  ipcMain.handle('chat:message:saveAsNote', (_e, messageId) => chatActions.saveAsNote(String(messageId || '')));
  ipcMain.handle('chat:message:createTask', (_e, messageId) => chatActions.createTask(String(messageId || '')));
  ipcMain.handle('chat:message:createDocument', (_e, messageId) => chatActions.createDocument(String(messageId || '')));
  ipcMain.handle('chat:message:saveAsMemory', (_e, messageId) => chatActions.saveAsMemory(String(messageId || '')));
  ipcMain.handle('chat:message:linkItem', (_e, { messageId, targetItemId, type }) => chatActions.linkItem(String(messageId || ''), String(targetItemId || ''), type));

  // --- Diagnostics (redacted bundle; export to a user-chosen file) ---
  ipcMain.handle('diagnostics:bundle', () => diagnostics.bundle());
  ipcMain.handle('diagnostics:summary', () => diagnostics.summary());
  ipcMain.handle('diagnostics:export', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || BrowserWindow.getFocusedWindow();
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export DAWN diagnostics (redacted)',
      defaultPath: `dawn-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try { fs.writeFileSync(res.filePath, JSON.stringify(diagnostics.bundle(), null, 2), 'utf-8'); return { ok: true, path: res.filePath }; }
    catch (err: any) { return { ok: false, error: String(err?.message || err) }; }
  });

  // Misc
  ipcMain.handle('open:external', (_e, url) => shell.openExternal(url));

  (ipcMain as any).handle = origHandle; // stop capturing
}
