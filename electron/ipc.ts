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
import download from './services/download';
import updater from './services/updater';
import vault from './services/vault';
import vaultIndex from './services/vaultIndex';
import vaultGraph from './services/vaultGraph';
import notion from './services/notion';
import piper from './services/piper';
import kokoro from './services/kokoro';
import vision from './services/vision';
import companion from './services/companion';
import fileAgent from './services/fileAgent';
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

  ipcMain.handle('chat:send', (e, { conversationId, content }) => {
    if (content && content.trim()) chat.addMessage(conversationId, 'user', content.trim());
    chat.generate(e.sender, conversationId);
    return { ok: true };
  });
  ipcMain.handle('chat:regenerate', (e, { conversationId }) => {
    chat.regenerate(e.sender, conversationId);
    return { ok: true };
  });
  ipcMain.handle('chat:stop', (_e, { conversationId }) => chat.stop(conversationId));

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
  ipcMain.handle('hub:download', (_e, { modelId, family, filename, url }) => download.start(modelId, family, filename, url));
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

  // Misc
  ipcMain.handle('open:external', (_e, url) => shell.openExternal(url));

  (ipcMain as any).handle = origHandle; // stop capturing
}
