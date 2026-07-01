import * as path from 'path';
import { app, BrowserWindow, shell, Notification, powerMonitor } from 'electron';
import { registerIpc } from './ipc';
import db from './services/db';
import graph from './services/graph';
import logger from './services/logger';
import runtime from './services/runtime';
import rag from './services/rag';
import settings from './services/settings';
import download from './services/download';
import updater from './services/updater';
import vaultIndex from './services/vaultIndex';
import notion from './services/notion';

const isDev = process.env.NODE_ENV === 'development';
let win: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(bootstrap).then(() => { try { require('./services/rag/helperRuntime').default.maybeAutoStart(); } catch { /* helper runtime is optional */ } });
}

async function bootstrap() {
  logger.setLogDir(path.join(app.getPath('userData'), 'logs'));
  try {
    await db.init();
    graph.rebuild(); // build the brain graph from existing data on startup
  } catch (e: any) {
    logger.error('main', `Init failed: ${e.message}`);
  }

  // Auto-index the Obsidian vault on startup if it's connected but not yet indexed.
  try {
    const s = settings.get();
    if (s.obsidianEnabled && s.vaultPath && require('fs').existsSync(s.vaultPath)) {
      const c = db.get<{ c: number }>('SELECT COUNT(*) c FROM vault_chunks')?.c || 0;
      if (c === 0) {
        logger.info('vault', 'Vault connected but not indexed — auto-indexing…');
        vaultIndex.reindex();
      }
    }
  } catch {
    /* ignore */
  }

  // Auto-sync Notion on startup if connected but not yet indexed.
  try {
    const s = settings.get();
    if (s.notionEnabled && s.notionToken && (db.get<{ c: number }>('SELECT COUNT(*) c FROM notion_chunks')?.c || 0) === 0) {
      logger.info('notion', 'Notion connected — syncing…');
      notion.sync().then(() => { try { graph.rebuild(); } catch { /* */ } });
    }
  } catch {
    /* ignore */
  }
  // Ensure local folders exist (models / logs / knowledge).
  for (const sub of ['models', 'logs', 'knowledge']) {
    try {
      require('fs').mkdirSync(path.join(app.getPath('userData'), sub), { recursive: true });
    } catch {
      /* ignore */
    }
  }

  registerIpc();
  createWindow();

  const send = (channel: string, payload: any) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    // Mirror to any connected phones (companion web app) so their brain/UI live-update too.
    try { require('./services/companion').default.broadcast(channel, payload); } catch { /* */ }
  };

  // Forward events to the renderer.
  logger.on('log', (entry: any) => send('log:new', entry));
  runtime.on('state', (status: any) => send('runtime:update', status));
  runtime.on('log', (entry: any) => send('runtime:log', entry));
  runtime.on('model-loaded', (status: any) => send('runtime:update', status));
  runtime.on('port-conflict', (info: any) => logger.warn('runtime', `Port conflict: ${JSON.stringify(info)}`));
  rag.on('progress', (status: any) => send('rag:progress', status));
  download.on('progress', (list: any) => send('hub:progress', list));
  vaultIndex.on('progress', (status: any) => send('vault:progress', status));
  notion.on('progress', (status: any) => send('notion:progress', status));
  try { require('./services/research/research').default.on('progress', (p: any) => send('research:progress', p)); } catch (e: any) { logger.warn('research', `wiring failed: ${e?.message || e}`); }
  try { require('./services/bench/compare').default.on('progress', (p: any) => send('compare:progress', p)); } catch (e: any) { logger.warn('compare', `wiring failed: ${e?.message || e}`); }
  try { require('./services/bench/benchmark').default.on('progress', (p: any) => send('bench:progress', p)); } catch (e: any) { logger.warn('bench', `wiring failed: ${e?.message || e}`); }
  try { require('./services/tools/toolGateway').default.on('approval', (req: any) => send('tools:approval', req)); } catch (e: any) { logger.warn('tools', `gateway wiring failed: ${e?.message || e}`); }
  try { require('./services/backup/backup').default.on('event', (ev: any) => { if (ev.kind === 'restore' && ev.status === 'ok') send('backup:restored', {}); }); } catch (e: any) { logger.warn('backup', `wiring failed: ${e?.message || e}`); }

  // Lock on sleep/screen-lock when Secure mode is on (no network; purely local).
  try {
    const lockNow = () => {
      const s = settings.get();
      if (s.authEnabled && s.lockOnSleep) { try { require('./services/security/auth').default.lock(); send('auth:locked', {}); } catch { /* */ } }
    };
    powerMonitor.on('suspend', lockNow);
    powerMonitor.on('lock-screen', lockNow);
  } catch (e: any) { logger.warn('auth', `lock-on-sleep wiring failed: ${e?.message || e}`); }

  // Task reminders → local desktop notifications (no network). Polls once a minute.
  try {
    const tasks = require('./services/workspace/tasks').default;
    const checkReminders = () => {
      if (!settings.get().taskRemindersEnabled || !Notification.isSupported()) return;
      try {
        for (const t of tasks.takeDueReminders()) {
          const n = new Notification({ title: 'DAWN — task reminder', body: t.title || 'A task is due.' });
          n.on('click', () => { if (win) { win.show(); win.webContents.send('nav', 'tasks'); } });
          n.show();
        }
      } catch (e: any) { logger.warn('tasks', `reminder check: ${e?.message || e}`); }
    };
    setInterval(checkReminders, 60000);
    setTimeout(checkReminders, 8000);
  } catch (e: any) { logger.warn('tasks', `reminder poller failed: ${e?.message || e}`); }

  // AgentOS runtime manager: forward status changes + auto-start the local API if enabled.
  try {
    const agentosRuntime = require('./services/agentosRuntime').default.runtime();
    agentosRuntime.on('status', (st: any) => send('agentos:status', st));
    const sx = settings.get();
    if (sx.agentosEnabled && sx.agentosAutoStart !== false) {
      agentosRuntime.ensure().catch((e: any) => logger.warn('agentos', `runtime ensure failed: ${e?.message || e}`));
    }
  } catch (e: any) {
    logger.warn('agentos', `runtime manager init failed: ${e?.message || e}`);
  }

  // In-place auto-updates (packaged builds only).
  if (!isDev) {
    try {
      updater.init(win!);
    } catch (e: any) {
      logger.warn('updater', e.message);
    }
  }

  // Optional: auto-start the runtime when the app opens.
  if (settings.get().autoStartRuntime && runtime.isInstalled() && runtime.hasModel()) {
    runtime.start();
  }

  // Phone access (companion web server) — start if the user enabled it.
  if (settings.get().companionEnabled) {
    try {
      require('./services/companion').default.start();
    } catch (e: any) {
      logger.warn('companion', e.message);
    }
  }

  // AI bridge for other local apps (D.C.D uses DAWN as its Ollama-compatible brain).
  if (settings.get().aiBridgeEnabled) {
    try {
      require('./services/ollamaBridge').default.start();
    } catch (e: any) {
      logger.warn('aibridge', e.message);
    }
  }

  app.on('activate', () => {
    if (!win) createWindow();
    else win.show();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#070b14',
    show: false,
    autoHideMenuBar: true,
    title: 'DAWN',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    win = null;
  });
}

app.on('window-all-closed', () => {
  db.saveNow();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  db.saveNow();
  runtime.stop().catch(() => {});
  try {
    require('./services/rag/helperRuntime').default.stop();
  } catch {
    /* ignore */
  }
  try {
    require('./services/kokoro').default.stop();
  } catch {
    /* ignore */
  }
  try {
    require('./services/vision').default.stopServer();
  } catch {
    /* ignore */
  }
  try {
    require('./services/companion').default.stop();
  } catch {
    /* ignore */
  }
  try {
    require('./services/ollamaBridge').default.stop();
  } catch {
    /* ignore */
  }
  try {
    // Only stops the AgentOS API if DAWN started it (never an unknown process).
    require('./services/agentosRuntime').default.runtime().stop();
  } catch {
    /* ignore */
  }
});
