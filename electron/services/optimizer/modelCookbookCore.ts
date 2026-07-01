/**
 * modelCookbookCore.ts — pure, electron-free heart of DAWN's Model Cookbook. It normalizes model
 * roles, turns the optimizer's real compatibility level into a user-facing hardware-fit label, marks
 * recommended vs slow vs not-recommended honestly, and picks the best installed model per role. It
 * never invents models, benchmarks, or hardware — it only shapes real inputs the service passes in.
 */

/** Canonical roles the cookbook reasons about. */
export const ROLES = ['fast', 'coding', 'reasoning', 'research', 'long_context', 'embeddings', 'vision', 'reranker'] as const;
export type Role = typeof ROLES[number];
export const ROLE_LABELS: Record<Role, string> = {
  fast: 'Fast chat', coding: 'Coding', reasoning: 'Reasoning', research: 'Research',
  long_context: 'Long context', embeddings: 'Embeddings', vision: 'Vision', reranker: 'Reranker',
};

const ROLE_ALIASES: Record<string, Role> = {
  fast: 'fast', chat: 'fast', general: 'fast',
  coding: 'coding', code: 'coding', coder: 'coding',
  reasoning: 'reasoning', reason: 'reasoning', logic: 'reasoning',
  research: 'research',
  long: 'long_context', longcontext: 'long_context', long_context: 'long_context',
  embedding: 'embeddings', embeddings: 'embeddings', embed: 'embeddings',
  vision: 'vision', vlm: 'vision', multimodal: 'vision',
  reranker: 'reranker', rerank: 'reranker', 'cross-encoder': 'reranker',
};

/** Normalize a raw roles array (from the catalog or a model category) into canonical roles. */
export function normalizeRoles(roles: any): Role[] {
  const out = new Set<Role>();
  for (const r of Array.isArray(roles) ? roles : [roles]) {
    const key = String(r || '').toLowerCase().trim();
    if (ROLE_ALIASES[key]) out.add(ROLE_ALIASES[key]);
  }
  return [...out];
}

/** The optimizer's compatibility level → a user-facing hardware fit label. */
export type CompatLevel = 'Excellent' | 'Good' | 'Borderline' | 'CPU-only fallback' | 'Unsupported' | string;
export type FitLabel = 'Fits in VRAM' | 'Partial offload' | 'CPU fallback' | 'Too large / not recommended' | 'Unknown hardware';

export function fitLabel(level: CompatLevel, hasVramInfo: boolean): FitLabel {
  if (!hasVramInfo) return 'Unknown hardware';
  switch (level) {
    case 'Excellent':
    case 'Good': return 'Fits in VRAM';
    case 'Borderline': return 'Partial offload';
    case 'CPU-only fallback': return 'CPU fallback';
    case 'Unsupported': return 'Too large / not recommended';
    default: return 'Unknown hardware';
  }
}

export function isRecommended(level: CompatLevel): boolean { return level === 'Excellent' || level === 'Good'; }

/** Honest one-line explanation of the recommendation. */
export function explain(input: { level: CompatLevel; hasVramInfo: boolean; reason?: string; needsBenchmark?: boolean }): string {
  const tail = input.reason ? ` ${input.reason}` : '';
  if (!input.hasVramInfo) return `Hardware not fully detected — run hardware detection (and a benchmark) to confirm what this model can do here.${tail}`;
  if (isRecommended(input.level)) return `Recommended — fits your GPU.${tail}${input.needsBenchmark ? ' Run a benchmark to confirm speed.' : ''}`;
  if (input.level === 'Borderline') return `May be slower — needs partial GPU offload.${tail}`;
  if (input.level === 'CPU-only fallback') return `Runs on CPU only — expect slow generation.${tail}`;
  if (input.level === 'Unsupported') return `Not recommended on this hardware — it doesn't fit.${tail}`;
  return `Status unknown — a benchmark would clarify.${tail}`;
}

export interface CookbookEntry {
  modelId: string; friendlyName: string; actualName: string; roles: Role[];
  level: CompatLevel; fitLabel: FitLabel; recommended: boolean; needsBenchmark: boolean;
  benchmarkTps?: number | null; score?: number; why: string;
}

/** Best installed model for a role: prefer recommended + higher score, then known benchmark tok/s. Null if none. */
export function bestForRole(entries: CookbookEntry[], role: Role): CookbookEntry | null {
  const candidates = entries.filter((e) => e.roles.includes(role));
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (b.benchmarkTps || 0) - (a.benchmarkTps || 0);
  });
  return sorted[0];
}

/** Build the best-for-each-role map (only roles that have a candidate appear). */
export function bestForRoles(entries: CookbookEntry[]): Partial<Record<Role, CookbookEntry>> {
  const out: Partial<Record<Role, CookbookEntry>> = {};
  for (const role of ROLES) { const best = bestForRole(entries, role); if (best) out[role] = best; }
  return out;
}

export default { ROLES, ROLE_LABELS, normalizeRoles, fitLabel, isRecommended, explain, bestForRole, bestForRoles };
