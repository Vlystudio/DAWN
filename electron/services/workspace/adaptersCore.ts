/**
 * adaptersCore.ts — pure, electron-free mapping rules that turn REAL feature rows (notes, tasks,
 * documents, conversations, memories, research runs, benchmarks, email accounts) into Workspace
 * Graph items. No DB here: the registry service reads the rows and applies these rules, so the
 * mapping logic stays unit-tested. Only real persisted objects are mapped — never fabricated.
 */
import { cleanLabel, safeMetadata, ItemType } from './workspaceCore';

export interface AdapterDef {
  feature: string;          // source_feature stored on the item
  type: ItemType;           // workspace item type
  table: string;            // source table
  idCol: string;            // primary key column
  labelCols: string[];      // first non-empty wins
  snippetCols?: string[];   // optional, for metadata.snippet
  updatedCols: string[];    // first present numeric wins → item.updated_at
  metaCols?: string[];      // extra columns copied (non-secret) into metadata
  extraWhere?: string;      // e.g. archived=0
}

/** The real, persisted sources DAWN auto-registers. (No secret-bearing tables here.) */
export const ADAPTER_DEFS: AdapterDef[] = [
  { feature: 'chat', type: 'conversation', table: 'conversations', idCol: 'id', labelCols: ['title'], updatedCols: ['updated_at', 'created_at'] },
  { feature: 'memory', type: 'memory', table: 'memories', idCol: 'id', labelCols: ['content'], snippetCols: ['source'], updatedCols: ['updated_at', 'created_at'], metaCols: ['type'] },
  { feature: 'notes', type: 'note', table: 'notes', idCol: 'id', labelCols: ['title', 'content'], snippetCols: ['content'], updatedCols: ['updated_at', 'created_at'], extraWhere: 'archived=0' },
  { feature: 'tasks', type: 'task', table: 'tasks', idCol: 'id', labelCols: ['title'], snippetCols: ['details'], updatedCols: ['updated_at', 'created_at'], metaCols: ['status', 'priority'] },
  { feature: 'documents', type: 'document', table: 'documents', idCol: 'id', labelCols: ['title'], snippetCols: ['content'], updatedCols: ['updated_at', 'created_at'], extraWhere: 'archived=0' },
  { feature: 'research', type: 'research_run', table: 'research_runs', idCol: 'id', labelCols: ['question'], snippetCols: ['status'], updatedCols: ['started_at', 'created_at'], metaCols: ['status'] },
  { feature: 'benchmark', type: 'benchmark', table: 'benchmarks', idCol: 'id', labelCols: ['model_name'], snippetCols: ['status'], updatedCols: ['created_at', 'started_at'], metaCols: ['status', 'quant'] },
  { feature: 'email', type: 'email_account', table: 'email_accounts', idCol: 'id', labelCols: ['label', 'email_address'], updatedCols: ['updated_at', 'created_at'] },
  // Knowledge sources: label by name only (never the full path), metadata = status/kind only.
  { feature: 'knowledge', type: 'knowledge_source', table: 'knowledge_sources', idCol: 'id', labelCols: ['name'], updatedCols: ['indexed_at', 'added_at'], metaCols: ['kind'], extraWhere: "(state IS NULL OR state IN ('indexed','stale'))" },
];

export interface MappedItem { type: ItemType; refId: string; label: string; sourceFeature: string; metadata: string; updatedAt: number }

function firstStr(row: any, cols: string[]): string {
  for (const c of cols) { const v = row?.[c]; if (v != null && String(v).trim()) return String(v); }
  return '';
}
function firstNum(row: any, cols: string[]): number {
  for (const c of cols) { const v = row?.[c]; if (typeof v === 'number' && isFinite(v)) return v; const n = Number(v); if (isFinite(n) && v != null && v !== '') return n; }
  return 0;
}

/** Map one source row to a workspace item (pure; never throws). Returns null if there's no id/label. */
export function mapRowToItem(def: AdapterDef, row: any): MappedItem | null {
  const refId = row?.[def.idCol];
  if (refId == null || String(refId) === '') return null;
  const label = cleanLabel(firstStr(row, def.labelCols) || def.type);
  const meta: Record<string, any> = {};
  if (def.snippetCols) { const sn = firstStr(row, def.snippetCols); if (sn) meta.snippet = cleanLabel(sn, 160); }
  for (const c of def.metaCols || []) if (row?.[c] != null) meta[c] = row[c];
  return {
    type: def.type, refId: String(refId), label, sourceFeature: def.feature,
    metadata: safeMetadata(meta), updatedAt: firstNum(row, def.updatedCols) || Date.now(),
  };
}

/**
 * Merge SAFE image-attachment flags into a conversation item's metadata. Only counts/booleans — never
 * a path, hash, filename, OCR, or image bytes. Used by the registry so the Workspace Graph reflects
 * that a chat has images without leaking any content.
 */
export function withImageMeta(metadataJson: string, count: number): string {
  if (!count || count < 1) return metadataJson;
  let obj: any = {};
  try { obj = metadataJson ? JSON.parse(metadataJson) : {}; } catch { obj = {}; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
  obj.has_image_attachment = true;
  obj.attachment_type = 'image';
  obj.attachment_count = Math.max(1, Math.floor(count));
  return safeMetadata(obj);
}

export default { ADAPTER_DEFS, mapRowToItem, withImageMeta };
