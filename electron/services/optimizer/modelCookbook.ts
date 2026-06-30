/**
 * modelCookbook.ts — assembles the Model Cookbook from REAL data: the optimizer's per-model
 * compatibility + the detected hardware, the catalog's role metadata, and any real benchmark tok/s.
 * It never invents models, benchmarks, or hardware — unknowns are reported honestly (Unknown
 * hardware / Needs benchmark / unknown role). The pure shaping lives in modelCookbookCore.
 */
import db from '../db';
import optimizer from './optimizer';
import catalog from '../catalog';
import core, { CookbookEntry } from './modelCookbookCore';

/** Latest real benchmark tok/s per model path (status ok only). */
function benchByPath(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    const rows = db.all<any>("SELECT model_path, tokens_per_sec FROM benchmarks WHERE status='ok' AND tokens_per_sec IS NOT NULL ORDER BY created_at DESC");
    for (const r of rows) { const p = String(r.model_path || ''); if (p && !(p in out)) out[p] = Number(r.tokens_per_sec); }
  } catch { /* table absent */ }
  return out;
}

/** Catalog roles for an installed model (best-effort id/name match); [] if unknown. */
function catalogRoles(m: any): string[] {
  try {
    const cat = catalog.CATALOG || [];
    const hay = `${m?.parsed?.name || ''} ${m?.actualName || ''} ${m?.path || ''}`.toLowerCase();
    for (const cm of cat) if (cm.id && hay.includes(String(cm.id).toLowerCase())) return cm.roles || [];
    for (const cm of cat) { const first = String(cm.name || '').toLowerCase().split(' ')[0]; if (first && first.length > 2 && hay.includes(first)) return cm.roles || []; }
  } catch { /* */ }
  return [];
}

export async function cookbook() {
  let profile: any = {}; let models: any[] = [];
  try { const r = await optimizer.listModels(); profile = r?.profile || {}; models = r?.models || []; } catch { /* no models / detection failed */ }

  const gpus: any[] = Array.isArray(profile.gpus) ? profile.gpus : [];
  const hasVram = gpus.some((g) => (g?.vramGB || 0) > 0);
  const bench = benchByPath();

  const entries: CookbookEntry[] = models.map((m: any) => {
    const level = m?.compatibility?.level;
    const id = String(m?.path || m?.actualName || '');
    const tps = m?.path ? bench[m.path] : undefined;
    const roles = core.normalizeRoles([...catalogRoles(m), m?.metadata?.category].filter(Boolean));
    return {
      modelId: id,
      friendlyName: m?.metadata?.friendlyName || m?.actualName || 'Model',
      actualName: m?.actualName || id,
      roles,
      level,
      fitLabel: core.fitLabel(level, hasVram),
      recommended: core.isRecommended(level),
      needsBenchmark: tps == null,
      benchmarkTps: tps ?? null,
      score: m?.compatibility?.score,
      why: core.explain({ level, hasVramInfo: hasVram, reason: m?.compatibility?.reason, needsBenchmark: tps == null }),
    };
  });

  return {
    hardware: { gpu: gpus[0]?.name || null, vramGB: gpus[0]?.vramGB ?? null, detected: hasVram },
    entries,
    bestForRole: core.bestForRoles(entries),
    roleLabels: core.ROLE_LABELS,
  };
}

export default { cookbook };
