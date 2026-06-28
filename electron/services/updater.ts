import { autoUpdater } from 'electron-updater';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import * as path from 'path';
import logger from './logger';
import settings from './settings';
import updateServer from './updateServer';

/**
 * updater.ts — in-place auto-updates via electron-updater, served from a LOCAL
 * offline feed (updateServer). DAWN updates itself in place instead of a manual
 * reinstall, with nothing leaving the machine: a new build dropped into the feed
 * folder is found by "Check now" and installed. No-ops cleanly in dev / when no
 * build has been published yet.
 */

let win: BrowserWindow | null = null;
let wired = false;

function send(status: string, info?: any) {
  if (win && !win.isDestroyed()) win.webContents.send('updater:status', { status, info });
}

/** The folder DAWN serves updates from (default: userData/updates). */
export function feedDir(): string {
  return settings.get().updateFeedDir || path.join(app.getPath('userData'), 'updates');
}

function wireEvents() {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = true; // local feed — full download is fast & simple
  (autoUpdater as any).logger = {
    info: (m: any) => logger.info('updater', String(m)),
    warn: (m: any) => logger.warn('updater', String(m)),
    error: (m: any) => logger.error('updater', String(m)),
    debug: () => {},
  };
  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', (i) => send('available', { version: i.version }));
  autoUpdater.on('update-not-available', () => send('none'));
  autoUpdater.on('download-progress', (p) => send('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('ready', { version: i.version }));
  autoUpdater.on('error', (e) => send('error', { message: String((e as any)?.message || e) }));
}

export function init(window: BrowserWindow) {
  win = window;
  wireEvents();
  if (settings.get().autoCheckUpdates) setTimeout(() => check(), 5000);
}

/** Ensure the local feed server is up and electron-updater points at it. */
async function ensureFeed(): Promise<boolean> {
  const dir = feedDir();
  if (!updateServer.hasManifest(dir)) return false; // nothing published yet
  const url = await updateServer.start(dir);
  autoUpdater.setFeedURL({ provider: 'generic', url } as any);
  return true;
}

export async function check() {
  wireEvents();
  try {
    const ready = await ensureFeed();
    if (!ready) {
      logger.info('updater', `No update published yet in ${feedDir()}.`);
      send('none');
      return null;
    }
    return await autoUpdater.checkForUpdates();
  } catch (e: any) {
    logger.warn('updater', `Update check failed: ${e.message}`);
    send('error', { message: e.message });
    return null;
  }
}

export function quitAndInstall() {
  try {
    // isSilent=true → NSIS updates IN PLACE at the existing install location with
    // no wizard (prevents the assisted installer from relocating the app).
    // isForceRunAfter=true → relaunch DAWN when done.
    autoUpdater.quitAndInstall(true, true);
  } catch (e: any) {
    logger.error('updater', e.message);
  }
}

export default { init, check, quitAndInstall };
