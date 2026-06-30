/**
 * optimizerStorage.ts — durable per-model optimizer state in userData/optimizer-state.json:
 * for each model we remember the last mode, the exact settings applied, whether the user
 * manually overrode DAWN's recommendation, a timestamp, and the hardware hash they were
 * generated for. When the hardware hash changes, the optimizer can suggest re-optimizing.
 *
 * Atomic, backed-up writes (same pattern as settings.ts) so a crash never truncates state.
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { OptimizedSettings, OptimizerMode } from './optimizerTypes';

export interface ModelRecord {
  modelKey: string;            // normalized model identifier (filename or tag)
  friendlyName?: string;
  mode: OptimizerMode;
  settings: OptimizedSettings;
  manualOverride: boolean;     // user edited away from DAWN's recommendation
  forcedLoad?: boolean;        // user force-loaded a "Not recommended" model
  updatedAt: string;
  hardwareHash: string;        // hash of the HardwareProfile these were tuned for
}

interface Store {
  version: number;
  records: Record<string, ModelRecord>;
  lastHardwareHash?: string;
}

const EMPTY: Store = { version: 1, records: {} };

function file() { return path.join(app.getPath('userData'), 'optimizer-state.json'); }
const tmpFile = () => file() + '.tmp';
const bakFile = () => file() + '.bak';

let cache: Store | null = null;

/** Normalize a model id to a stable key (basename, no .gguf, lowercased). */
export function keyFor(modelId: string): string {
  return String(modelId || '').split(/[\\/]/).pop()!.replace(/\.gguf$/i, '').toLowerCase();
}

function read(p: string): Store | null {
  try {
    if (!fs.existsSync(p)) return null;
    let raw = fs.readFileSync(p, 'utf-8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    raw = raw.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed, records: parsed.records || {} };
  } catch { return null; }
}

function load(): Store {
  if (cache) return cache;
  cache = read(file()) || read(bakFile()) || { ...EMPTY };
  return cache;
}

function persist() {
  const data = JSON.stringify(cache, null, 2);
  try {
    fs.writeFileSync(tmpFile(), data, 'utf-8');
    fs.renameSync(tmpFile(), file());
    fs.writeFileSync(bakFile(), data, 'utf-8');
  } catch {
    try { fs.writeFileSync(file(), data, 'utf-8'); } catch { /* */ }
  }
}

export function getRecord(modelId: string): ModelRecord | null {
  return load().records[keyFor(modelId)] || null;
}

export function saveRecord(rec: Omit<ModelRecord, 'updatedAt'> & { updatedAt?: string }): ModelRecord {
  const s = load();
  const full: ModelRecord = { ...rec, modelKey: keyFor(rec.modelKey), updatedAt: rec.updatedAt || new Date().toISOString() };
  s.records[full.modelKey] = full;
  persist();
  return full;
}

export function setManualOverride(modelId: string, override: boolean): ModelRecord | null {
  const s = load();
  const rec = s.records[keyFor(modelId)];
  if (!rec) return null;
  rec.manualOverride = override;
  rec.updatedAt = new Date().toISOString();
  persist();
  return rec;
}

export function clearRecord(modelId: string): void {
  const s = load();
  delete s.records[keyFor(modelId)];
  persist();
}

export function lastHardwareHash(): string | undefined { return load().lastHardwareHash; }

export function setLastHardwareHash(hash: string): void {
  const s = load();
  s.lastHardwareHash = hash;
  persist();
}

/** True if this model was last tuned for different hardware than `currentHash`. */
export function reoptimizeNeeded(modelId: string, currentHash: string): boolean {
  const rec = getRecord(modelId);
  return !!rec && !!rec.hardwareHash && rec.hardwareHash !== currentHash;
}

export function allRecords(): ModelRecord[] { return Object.values(load().records); }

export default {
  keyFor, getRecord, saveRecord, setManualOverride, clearRecord,
  lastHardwareHash, setLastHardwareHash, reoptimizeNeeded, allRecords,
};
