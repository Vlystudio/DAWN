/**
 * workspace/search.ts — search workspace items by label / type / source feature / link type / date.
 * Parameterized LIKE (term never concatenated). When a link type is given, results are restricted to
 * items that participate in at least one link of that type. Labels are non-secret handles, but the
 * snippet is still passed through the core's label cleaner.
 */
import db from '../db';
import core, { WorkspaceSearchQuery } from './workspaceCore';
import { WorkspaceItem } from './items';

export type { WorkspaceSearchQuery };

export function search(query: WorkspaceSearchQuery = {}): { results: WorkspaceItem[]; total: number } {
  const { sql, params } = core.buildWorkspaceSearchSql(query);
  const results = db.all<WorkspaceItem>(sql, params).map((r) => ({ ...r, label: core.cleanLabel(r.label) }));
  return { results, total: results.length };
}

export default { search };
