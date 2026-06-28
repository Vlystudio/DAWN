import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export interface LogEntry {
  ts: string;
  level: 'step' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

/**
 * In-memory + file logger (singleton). Emits 'log' for each entry so the main
 * process can forward it to the Logs page. Also mirrored to a rolling file.
 */
class Logger extends EventEmitter {
  private entries: LogEntry[] = [];
  private max = 2000;
  private filePath: string | null = null;

  setLogDir(dir: string) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.filePath = path.join(dir, 'dawn.log');
    } catch {
      this.filePath = null;
    }
  }

  log(level: LogEntry['level'], source: string, message: string): LogEntry {
    const entry: LogEntry = { ts: new Date().toISOString(), level, source, message: String(message) };
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
    this.emit('log', entry);
    if (this.filePath) {
      try {
        fs.appendFileSync(this.filePath, `${entry.ts} [${level.toUpperCase()}] (${source}) ${entry.message}\n`);
      } catch {
        /* never let logging crash the app */
      }
    }
    return entry;
  }

  step(s: string, m: string) { return this.log('step', s, m); }
  info(s: string, m: string) { return this.log('info', s, m); }
  warn(s: string, m: string) { return this.log('warn', s, m); }
  error(s: string, m: string) { return this.log('error', s, m); }

  getAll() { return this.entries; }
  clear() { this.entries = []; this.emit('clear'); }
}

export default new Logger();
