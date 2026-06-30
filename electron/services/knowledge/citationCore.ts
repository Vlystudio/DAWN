/**
 * citationCore.ts — pure, electron-free citation-metadata builder for Local Knowledge. It produces a
 * citation from ONLY the data that really exists (file name, source type, chunk index when chunking
 * exists, content hash, retrieval mode). It never fabricates page numbers, section headings, chunk
 * ids, or embedding models — those appear only when the caller passes real values, otherwise they are
 * reported as "not available". It also computes a safe display path (file name only — no full path).
 */

export type CitationPrecision = 'file-level' | 'chunk-level' | 'page-level' | 'section-level' | 'row-level' | 'line-level' | 'unknown';

export interface CitationInput {
  sourceId?: string; name?: string; path?: string; sourceType?: string;
  contentHash?: string; indexedAt?: number; retrievalMode?: string; embeddingModel?: string;
  chunkId?: string; chunkIndex?: number | null;
  page?: number | null; section?: string | null; row?: number | null; line?: number | null;
}

export interface Citation {
  sourceId?: string; displayName: string; fileName: string; safeDisplayPath: string; sourceType: string;
  contentHash?: string; indexedAt?: number; retrievalMode?: string; embeddingModel?: string;
  chunkId?: string; chunkIndex?: number; page?: number; section?: string; row?: number; line?: number;
  precision: CitationPrecision; available: string[]; unavailable: string[];
}

/** File name only — never the full path (avoids leaking sensitive directory structure). */
export function safeDisplayPath(p?: string): string {
  const base = String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  return base || 'unknown';
}

const has = (v: any) => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && isNaN(v));

/** Most precise level the real data supports (never higher than what's actually present). */
export function precisionOf(input: CitationInput): CitationPrecision {
  if (has(input.line)) return 'line-level';
  if (has(input.row)) return 'row-level';
  if (has(input.section)) return 'section-level';
  if (has(input.page)) return 'page-level';
  if (has(input.chunkIndex) || has(input.chunkId)) return 'chunk-level';
  if (has(input.name) || has(input.path)) return 'file-level';
  return 'unknown';
}

/** Build a citation from real data only. `available`/`unavailable` say exactly what is/ isn't known. */
export function buildCitation(input: CitationInput): Citation {
  const fileName = safeDisplayPath(input.path || input.name);
  const out: Citation = {
    sourceId: input.sourceId,
    displayName: String(input.name || fileName || 'Source'),
    fileName,
    safeDisplayPath: fileName,
    sourceType: String(input.sourceType || 'file'),
    precision: precisionOf(input),
    available: [],
    unavailable: [],
  };
  const set = (key: keyof Citation, label: string, val: any) => {
    if (has(val)) { (out as any)[key] = val; out.available.push(label); }
    else out.unavailable.push(label);
  };
  out.available.push('file name');
  set('contentHash', 'content hash', input.contentHash);
  set('indexedAt', 'indexed date', input.indexedAt);
  set('retrievalMode', 'retrieval mode', input.retrievalMode);
  set('embeddingModel', 'embedding model', input.embeddingModel);
  set('chunkIndex', 'chunk index', has(input.chunkIndex) ? input.chunkIndex : undefined);
  set('chunkId', 'chunk id', input.chunkId);
  set('page', 'page number', input.page);
  set('section', 'section heading', input.section);
  set('row', 'row number', input.row);
  set('line', 'line number', input.line);
  return out;
}

export default { safeDisplayPath, precisionOf, buildCitation };
