/**
 * diagnostics.ts — electron service that gathers a redacted diagnostics bundle: app/system info,
 * runtime status, System Health summary, redacted settings, and recent redacted logs. All secret
 * redaction happens in diagnosticsCore (unit-tested). The file write/save dialog lives in the IPC
 * layer. Nothing here logs or returns a raw secret.
 */
import { app } from 'electron';
import * as os from 'os';
import settings from './settings';
import logger from './logger';
import featureMaturity from './featureMaturity';
import core from './diagnosticsCore';

function safe<T>(fn: () => T, fallback: T): T { try { return fn(); } catch { return fallback; } }

/** Build the full, redacted diagnostics bundle object. */
export function bundle(): Record<string, any> {
  const logs = safe(() => logger.getAll() as any[], []);
  const recentLogs = logs.slice(-300);
  const errors = logs.filter((l) => l && l.level === 'error').slice(-50).map((l) => `(${l.source}) ${l.message}`);

  const runtime = safe(() => { const rt = require('./runtime').default; return rt.status ? rt.status() : null; }, null);
  const health = safe(() => featureMaturity.list().summary, null);

  return core.buildBundle({
    app: { name: 'DAWN', version: safe(() => app.getVersion(), 'unknown') },
    system: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: (process.versions as any).electron,
      cpuCount: safe(() => os.cpus().length, 0),
      totalMemGB: safe(() => Math.round(os.totalmem() / 1e9), 0),
      freeMemGB: safe(() => Math.round(os.freemem() / 1e9), 0),
    },
    runtime,
    health,
    settings: safe(() => settings.get() as any, {}),
    logs: recentLogs,
    errors,
    db: { logEntries: logs.length },
  });
}

/** Short, copy-pasteable error summary. */
export function summary(): string {
  return core.copySummary(bundle());
}

export default { bundle, summary };
