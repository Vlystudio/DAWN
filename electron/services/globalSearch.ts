/**
 * globalSearch.ts — electron service for DAWN's Global Search. Runs the pure core's parameterized
 * LIKE queries across the searchable sources, redacts snippets, ranks, and reports any source that
 * was unavailable (so the UI can be honest about coverage). The vault/auth/audit tables are never
 * queried (they aren't in SEARCH_SOURCES). Each source is wrapped — a bad table never breaks search.
 */
import db from './db';
import core, { SEARCH_SOURCES, SearchResult } from './globalSearchCore';

export interface SearchResponse {
  term: string;
  results: SearchResult[];
  total: number;
  skipped: { type: string; reason: string }[];
}

export function query(term: string, limitPerSource = 8): SearchResponse {
  const t = String(term || '').trim();
  if (t.length < 2) return { term: t, results: [], total: 0, skipped: [] };

  const results: SearchResult[] = [];
  const skipped: { type: string; reason: string }[] = [];

  for (const src of SEARCH_SOURCES) {
    try {
      const { sql, params } = core.buildLikeQuery(src, t, limitPerSource);
      const rows = db.all<any>(sql, params);
      for (const r of rows) {
        results.push({
          type: src.type,
          label: src.label,
          id: String(r.id ?? ''),
          title: core.cleanTitle(r.title),
          snippet: core.redactSnippet(r.snippet || ''),
          route: src.route,
        });
      }
    } catch {
      skipped.push({ type: src.type, reason: 'source unavailable' });
    }
  }

  const ranked = core.rankResults(results, t).slice(0, 60);
  return { term: t, results: ranked, total: ranked.length, skipped };
}

export default { query };
