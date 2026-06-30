/**
 * workspace/search.ts — search workspace items by label / type / source feature / link type / date.
 * Parameterized LIKE (term never concatenated). When a link type is given, results are restricted to
 * items that participate in at least one link of that type. Labels are non-secret handles, but the
 * snippet is still passed through the core's label cleaner.
 */
import db from '../db';
import core from './workspaceCore';
import { WorkspaceItem } from './items';

export interface WorkspaceSearchQuery {
  q?: string; type?: string; sourceFeature?: string; linkType?: string; since?: number; until?: number; limit?: number;
}

export function search(query: WorkspaceSearchQuery = {}): { results: WorkspaceItem[]; total: number } {
  const where: string[] = []; const params: any[] = [];
  if (query.q && String(query.q).trim()) {
    where.push('label LIKE ? ESCAPE \'\\\'');
    params.push('%' + String(query.q).trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%');
  }
  if (query.type && core.isValidItemType(query.type)) { where.push('type=?'); params.push(query.type); }
  if (query.sourceFeature) { where.push('source_feature=?'); params.push(String(query.sourceFeature)); }
  if (typeof query.since === 'number') { where.push('updated_at >= ?'); params.push(query.since); }
  if (typeof query.until === 'number') { where.push('updated_at <= ?'); params.push(query.until); }
  if (query.linkType && core.isValidLinkType(query.linkType)) {
    where.push('id IN (SELECT from_id FROM workspace_links WHERE type=? UNION SELECT to_id FROM workspace_links WHERE type=?)');
    params.push(query.linkType, query.linkType);
  }
  const limit = Math.max(1, Math.min(200, query.limit || 100));
  const sql = `SELECT * FROM workspace_items${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ${limit}`;
  const results = db.all<WorkspaceItem>(sql, params).map((r) => ({ ...r, label: core.cleanLabel(r.label) }));
  return { results, total: results.length };
}

export default { search };
