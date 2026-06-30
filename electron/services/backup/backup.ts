/**
 * backup.ts — DAWN's local Backup/Restore service. Creates a `.dawnbackup` archive (zip:
 * manifest.json + data/ + files/ + checksums.json + backup-log.json), verifies archives,
 * and restores with a mandatory pre-restore safety snapshot, staged extraction (every entry
 * path validated), and rollback on failure. Vault data is included ONLY in its encrypted
 * form; no plaintext secrets, no session tokens, no master key, no OS-keychain material.
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { app, shell } from 'electron';
import db from '../db';
import logger from '../logger';
import settings from '../settings';
import core from './backupCore';

const AdmZip = require('adm-zip');
const now = () => Date.now();
const newId = () => crypto.randomUUID();

class BackupService extends EventEmitter {
  dir(): string { const d = path.join(app.getPath('userData'), 'backups'); fs.mkdirSync(d, { recursive: true }); return d; }
  private stagingDir(id: string): string { const d = path.join(this.dir(), `.staging-${id}`); fs.mkdirSync(d, { recursive: true }); return d; }
  private attachmentsDir(): string { return path.join(app.getPath('userData'), 'email-attachments'); }

  // --- build (shared by create + safety snapshot) --------------------------
  private buildArchive(opts: { emailCache: boolean; attachments: boolean; auditLogs: boolean }): { buffer: Buffer; manifest: any; sizeBytes: number } {
    // Selective DB snapshot: full export → drop opted-out tables → re-export.
    const full = db.exportBytes();
    const snap = db.newDatabase(full);
    for (const table of core.excludedTablesFor({ emailCache: opts.emailCache, auditLogs: opts.auditLogs })) {
      try { snap.run(`DELETE FROM ${table}`); } catch { /* table may not exist */ }
    }
    const dbBytes: Uint8Array = snap.export();
    try { snap.close(); } catch { /* */ }
    const dbIntegrity = db.canOpen(dbBytes) ? 'ok' : 'unreadable';

    const settingsRaw = (() => { try { return fs.readFileSync(settings.filePath(), 'utf-8'); } catch { return JSON.stringify(settings.get(), null, 2); } })();
    // Strip plaintext credentials (Notion token, companion PIN) so the backup carries no secret.
    const settingsBuf = Buffer.from(core.redactSettingsForBackup(settingsRaw), 'utf-8');

    const zip = new AdmZip();
    const checksums: Record<string, string> = {};
    const add = (name: string, buf: Buffer) => { core.normalizeEntryPath(name); zip.addFile(name, buf); checksums[name] = core.sha256(buf); };
    add('data/database.db', Buffer.from(dbBytes));
    add('data/settings.json', settingsBuf);

    // Managed files: downloaded email attachments (app-data only), if requested.
    let fileCount = 0; let fileBytes = 0;
    if (opts.attachments && fs.existsSync(this.attachmentsDir())) {
      for (const f of fs.readdirSync(this.attachmentsDir())) {
        const full2 = path.join(this.attachmentsDir(), f);
        try {
          const stat = fs.lstatSync(full2);
          if (!stat.isFile()) continue;                       // skip symlinks/dirs
          if (stat.size > 50 * 1024 * 1024) continue;          // cap single file
          const entry = `files/email-attachments/${core.normalizeEntryPath(f).split('/').pop()}`;
          add(entry, fs.readFileSync(full2)); fileCount++; fileBytes += stat.size;
        } catch { /* skip unreadable */ }
      }
    }

    const includedSections = core.SECTIONS.filter((s) => (s.id === 'email_cache' ? opts.emailCache : s.id === 'audit_logs' ? opts.auditLogs : true)).map((s) => s.id);
    const manifest = core.buildManifest({
      appVersion: app.getVersion?.() || undefined,
      machineIdHash: crypto.createHash('sha256').update(os.hostname() + os.platform()).digest('hex').slice(0, 16),
      includedSections, encryptedVaultIncluded: true, emailCacheIncluded: opts.emailCache, attachmentsIncluded: opts.attachments, auditLogsIncluded: opts.auditLogs,
      fileCount: 2 + fileCount, totalSizeBytes: dbBytes.length + settingsBuf.length + fileBytes, dbIntegrity,
    });
    const log = { createdAt: now(), host: manifest.machineIdHash, result: dbIntegrity === 'ok' ? 'ok' : 'warning', notes: core.redactBackupLog(`db ${dbBytes.length}B, ${fileCount} files`) };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    zip.addFile('checksums.json', Buffer.from(JSON.stringify(checksums, null, 2)));
    zip.addFile('backup-log.json', Buffer.from(JSON.stringify(log, null, 2)));
    const buffer: Buffer = zip.toBuffer();
    return { buffer, manifest, sizeBytes: buffer.length };
  }

  private record(kind: string, p: string, sizeBytes: number, sections: string[], status: string) {
    db.run('INSERT INTO backup_history (id,kind,path,size_bytes,sections,status,created_at,metadata) VALUES (?,?,?,?,?,?,?,?)',
      [newId(), kind, p, sizeBytes, JSON.stringify(sections), status, now(), '{}']);
  }

  // --- create --------------------------------------------------------------
  create(opts: { destination?: string; emailCache?: boolean; attachments?: boolean; auditLogs?: boolean } = {}): { ok: boolean; error?: string; path?: string; manifest?: any; sizeBytes?: number } {
    try {
      const o = { emailCache: !!opts.emailCache, attachments: !!opts.attachments, auditLogs: !!opts.auditLogs };
      const { buffer, manifest, sizeBytes } = this.buildArchive(o);
      const name = `dawn-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.dawnbackup`;
      const dest = opts.destination ? (opts.destination.endsWith('.dawnbackup') ? opts.destination : path.join(opts.destination, name)) : path.join(this.dir(), name);
      fs.writeFileSync(dest, buffer);
      this.record('backup', dest, sizeBytes, manifest.includedSections, 'ok');
      logger.info('backup', `Created backup ${path.basename(dest)} (${sizeBytes} bytes)`);
      try { require('../graph').default.rebuild(); } catch { /* */ }
      this.emit('event', { kind: 'backup', status: 'ok' });
      return { ok: true, path: dest, manifest, sizeBytes };
    } catch (e: any) { logger.error('backup', core.redactBackupLog(e.message)); return { ok: false, error: core.redactBackupLog(e.message) }; }
  }

  estimateSize(opts: { emailCache?: boolean; attachments?: boolean; auditLogs?: boolean } = {}): number {
    try { return this.buildArchive({ emailCache: !!opts.emailCache, attachments: !!opts.attachments, auditLogs: !!opts.auditLogs }).sizeBytes; } catch { return 0; }
  }

  // --- verify --------------------------------------------------------------
  verify(archivePath: string): { ok: boolean; level: string; manifest?: any; issues: string[]; warnings: string[] } {
    const issues: string[] = []; const warnings: string[] = [];
    try {
      if (!fs.existsSync(archivePath)) return { ok: false, level: 'invalid', issues: ['File not found.'], warnings };
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      // path safety on every entry
      for (const e of entries) { const v = core.isSafeEntryPath(e.entryName); if (!v.ok) issues.push(`unsafe path: ${v.reason}`); }
      const read = (n: string): Buffer | null => { const e = entries.find((x: any) => x.entryName === n); return e ? e.getData() : null; };
      const manifestBuf = read('manifest.json');
      if (!manifestBuf) { issues.push('manifest.json missing'); return { ...core.verifyStatus(issues, warnings), ok: false }; }
      let manifest: any; try { manifest = JSON.parse(manifestBuf.toString()); } catch { issues.push('manifest.json unreadable'); return { ...core.verifyStatus(issues, warnings), ok: false }; }
      // Imported manifest is untrusted: scan + audit (does not block unless it affects safety).
      try { const ins = require('../security/promptSecurity').default.inspect('backup manifest', JSON.stringify(manifest).slice(0, 4000), 'file'); if (ins.scan?.severity === 'high') warnings.push('manifest contains suspicious text (logged) — treated as data only'); } catch { /* */ }
      const compat = core.checkCompatibility(manifest);
      if (compat.level === 'blocked') issues.push(compat.message); else if (compat.level === 'migrate') warnings.push(compat.message);
      // required files
      for (const req of ['data/database.db', 'checksums.json']) if (!read(req)) issues.push(`required file missing: ${req}`);
      // checksums
      const cBuf = read('checksums.json');
      if (cBuf) {
        let checksums: any; try { checksums = JSON.parse(cBuf.toString()); } catch { checksums = null; }
        if (checksums) {
          const actual: Record<string, string> = {};
          for (const name of Object.keys(checksums)) { const b = read(name); if (b) actual[name] = core.sha256(b); }
          const r = core.verifyChecksums(checksums, actual);
          if (r.missing.length) issues.push(`checksum: missing ${r.missing.length} file(s)`);
          if (r.mismatches.length) issues.push(`checksum mismatch: ${r.mismatches.length} file(s)`);
        }
      }
      // DB opens
      const dbBuf = read('data/database.db');
      if (dbBuf && !db.canOpen(dbBuf)) issues.push('database snapshot is unreadable');
      // vault payload claim
      if (manifest.encryptedVaultIncluded && !(manifest.includedSections || []).includes('vault')) warnings.push('manifest claims vault but section missing');
      const status = core.verifyStatus(issues, warnings);
      return { ok: status.level !== 'invalid', level: status.level, manifest: this.publicManifest(manifest), issues, warnings };
    } catch (e: any) { return { ok: false, level: 'invalid', issues: [core.redactBackupLog(e.message)], warnings }; }
  }

  details(archivePath: string) {
    try { const m = JSON.parse(new AdmZip(archivePath).readAsText('manifest.json')); return this.publicManifest(m); } catch { return null; }
  }
  private publicManifest(m: any) { // never any secret — manifest has none, but keep this explicit
    return { backupFormatVersion: m.backupFormatVersion, appName: m.appName, appVersion: m.appVersion, createdAt: m.createdAt, dbSchemaVersion: m.dbSchemaVersion, includedSections: m.includedSections, encryptedVaultIncluded: m.encryptedVaultIncluded, emailCacheIncluded: m.emailCacheIncluded, attachmentsIncluded: m.attachmentsIncluded, auditLogsIncluded: m.auditLogsIncluded, fileCount: m.fileCount, totalSizeBytes: m.totalSizeBytes, checksumAlgorithm: m.checksumAlgorithm, compatibilityNotes: m.compatibilityNotes };
  }

  // --- restore -------------------------------------------------------------
  async restore(archivePath: string): Promise<{ ok: boolean; error?: string; needsReload?: boolean; safetySnapshot?: string }> {
    // 1. verify first
    const v = this.verify(archivePath);
    if (v.level === 'invalid') return { ok: false, error: `Backup failed verification: ${v.issues.join('; ')}` };
    const compat = core.checkCompatibility(v.manifest || {});
    if (compat.level === 'blocked') return { ok: false, error: compat.message };

    // 2. pre-restore safety snapshot of CURRENT state (full)
    let safetyPath = '';
    try {
      const snap = this.buildArchive({ emailCache: true, attachments: true, auditLogs: true });
      safetyPath = path.join(this.dir(), `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.dawnbackup`);
      fs.writeFileSync(safetyPath, snap.buffer);
      this.record('safety_snapshot', safetyPath, snap.sizeBytes, snap.manifest.includedSections, 'ok');
      logger.info('backup', `Pre-restore safety snapshot saved: ${path.basename(safetyPath)}`);
    } catch (e: any) { return { ok: false, error: `Could not create the pre-restore safety snapshot — restore aborted. ${core.redactBackupLog(e.message)}` }; }

    // 3. stage extraction (validate EVERY entry path; only into staging)
    const stageId = newId().slice(0, 8);
    const stage = this.stagingDir(stageId);
    try {
      const zip = new AdmZip(archivePath);
      for (const e of zip.getEntries()) {
        if (e.isDirectory) continue;
        const safe = core.isSafeEntryPath(e.entryName);
        if (!safe.ok) throw new Error(`refusing unsafe archive entry (${safe.reason})`);
        const rel = core.normalizeEntryPath(e.entryName);
        const out = path.join(stage, rel);
        if (!path.resolve(out).startsWith(path.resolve(stage) + path.sep)) throw new Error('entry escapes staging directory');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, e.getData());
      }
      // 4. validate staged DB
      const stagedDb = path.join(stage, 'data', 'database.db');
      if (!fs.existsSync(stagedDb)) throw new Error('staged database missing');
      const dbBytes = fs.readFileSync(stagedDb);
      if (!db.canOpen(dbBytes)) throw new Error('staged database is unreadable');

      // 5+6. swap live state (DB + settings + managed files). After this point, roll back on error.
      const stagedSettings = path.join(stage, 'data', 'settings.json');
      try {
        db.loadBytes(dbBytes);
        if (fs.existsSync(stagedSettings)) settings.importSettings(JSON.parse(fs.readFileSync(stagedSettings, 'utf-8')));
        const stagedFiles = path.join(stage, 'files', 'email-attachments');
        if (fs.existsSync(stagedFiles)) {
          fs.mkdirSync(this.attachmentsDir(), { recursive: true });
          for (const f of fs.readdirSync(stagedFiles)) { const base = path.basename(f); fs.copyFileSync(path.join(stagedFiles, f), path.join(this.attachmentsDir(), base)); }
        }
      } catch (swapErr: any) {
        // rollback from the safety snapshot we just made
        try { const roll = new AdmZip(safetyPath); db.loadBytes(roll.getEntry('data/database.db')!.getData()); const s = roll.getEntry('data/settings.json'); if (s) settings.importSettings(JSON.parse(s.getData().toString())); } catch { /* */ }
        throw new Error(`Restore failed during swap and was rolled back: ${core.redactBackupLog(swapErr.message)}`);
      }

      this.record('restore', archivePath, fs.statSync(archivePath).size, v.manifest?.includedSections || [], 'ok');
      try { require('../graph').default.rebuild(); } catch { /* */ }
      this.emit('event', { kind: 'restore', status: 'ok' });
      logger.info('backup', 'Restore complete — reload required.');
      return { ok: true, needsReload: true, safetySnapshot: path.basename(safetyPath) };
    } catch (e: any) {
      this.record('restore', archivePath, 0, [], 'error');
      this.emit('event', { kind: 'restore', status: 'error' });
      return { ok: false, error: core.redactBackupLog(e.message), safetySnapshot: safetyPath ? path.basename(safetyPath) : undefined };
    } finally {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* */ }
    }
  }

  // --- history / housekeeping ----------------------------------------------
  history() {
    const rows = db.all('SELECT * FROM backup_history ORDER BY created_at DESC LIMIT 100').map((r: any) => ({ ...r, sections: safe(r.sections), exists: fs.existsSync(r.path) }));
    return rows;
  }
  openFolder() { return shell.openPath(this.dir()); }
  deleteSafetySnapshot(id: string): { ok: boolean } {
    const row: any = db.get('SELECT * FROM backup_history WHERE id=? AND kind=?', [id, 'safety_snapshot']);
    if (row) { try { if (fs.existsSync(row.path)) fs.unlinkSync(row.path); } catch { /* */ } db.run('DELETE FROM backup_history WHERE id=?', [id]); }
    return { ok: true };
  }
}

function safe(s: string): any { try { return JSON.parse(s || '[]'); } catch { return []; } }

export default new BackupService();
