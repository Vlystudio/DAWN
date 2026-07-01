/**
 * workspace/registry.ts — auto-registration. Reconciles the Workspace Graph against REAL feature
 * rows using adaptersCore: idempotent upsert (items.create dedupes by type+ref_id), then safe
 * pruning of items whose source row was deleted (only auto-registered items — manual items, which
 * have no ref_id / source_feature 'workspace', are never touched). Every source read is wrapped, so
 * a missing/empty table never breaks reconciliation.
 */
import db from '../db';
import items from './items';
import core, { ADAPTER_DEFS } from './adaptersCore';

export interface ReconcileResult {
  registered: number; pruned: number;
  byFeature: Record<string, { source: number; registered: number }>;
  errors: string[];
}

/** Reconcile all adapters. Safe to call repeatedly (idempotent). */
export function reconcile(): ReconcileResult {
  let registered = 0; let pruned = 0; const byFeature: Record<string, any> = {}; const errors: string[] = [];

  // Precompute which conversations carry image attachments (SAFE counts only — no path/content).
  let convImages: Record<string, number> = {};
  try {
    const rows = db.all<{ conversation_id: string; c: number }>("SELECT conversation_id, COUNT(*) c FROM chat_attachments WHERE kind='image' AND message_id IS NOT NULL AND message_id!='' GROUP BY conversation_id");
    for (const r of rows) convImages[String(r.conversation_id)] = Number(r.c) || 0;
  } catch { convImages = {}; }

  for (const def of ADAPTER_DEFS) {
    let rows: any[] = [];
    try { rows = db.all(`SELECT * FROM ${def.table}${def.extraWhere ? ' WHERE ' + def.extraWhere : ''}`); }
    catch { byFeature[def.feature] = { source: 0, registered: 0 }; continue; }

    const validRefs = new Set<string>();
    let count = 0;
    for (const row of rows) {
      const mapped = core.mapRowToItem(def, row);
      if (!mapped) continue;
      validRefs.add(mapped.refId);
      // Chat conversations that hold image attachments get safe image flags in their metadata.
      const metadata = (def.feature === 'chat' && convImages[mapped.refId])
        ? core.withImageMeta(mapped.metadata, convImages[mapped.refId])
        : mapped.metadata;
      try {
        const r: any = items.create({ type: mapped.type, refId: mapped.refId, label: mapped.label, sourceFeature: mapped.sourceFeature, metadata });
        if (r?.ok) count++;
      } catch (e: any) { errors.push(`${def.feature}: ${String(e?.message || e).slice(0, 80)}`); }
    }
    registered += count;
    byFeature[def.feature] = { source: rows.length, registered: count };

    // Prune auto-registered items whose source row no longer exists.
    try {
      const existing = db.all<{ id: string; ref_id: string }>(
        'SELECT id, ref_id FROM workspace_items WHERE type=? AND source_feature=? AND ref_id IS NOT NULL',
        [def.type, def.feature]);
      for (const it of existing) {
        if (it.ref_id && !validRefs.has(String(it.ref_id))) { items.remove(it.id); pruned++; }
      }
    } catch { /* table absent */ }
  }

  return { registered, pruned, byFeature, errors };
}

/** Coverage snapshot for System Health: how many sources vs registered items, per feature. */
export function coverage(): { features: number; totalSource: number; totalRegistered: number; byFeature: Record<string, { source: number; registered: number }> } {
  const byFeature: Record<string, { source: number; registered: number }> = {};
  let totalSource = 0; let totalRegistered = 0;
  for (const def of ADAPTER_DEFS) {
    let source = 0; let registered = 0;
    try { source = Number(db.get<{ c: number }>(`SELECT COUNT(*) c FROM ${def.table}${def.extraWhere ? ' WHERE ' + def.extraWhere : ''}`)?.c || 0); } catch { source = 0; }
    try { registered = Number(db.get<{ c: number }>('SELECT COUNT(*) c FROM workspace_items WHERE type=? AND source_feature=?', [def.type, def.feature])?.c || 0); } catch { registered = 0; }
    byFeature[def.feature] = { source, registered };
    totalSource += source; totalRegistered += registered;
  }
  return { features: ADAPTER_DEFS.length, totalSource, totalRegistered, byFeature };
}

export default { reconcile, coverage };
