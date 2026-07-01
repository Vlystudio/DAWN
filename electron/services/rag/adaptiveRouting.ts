/**
 * adaptiveRouting.ts — electron state manager for OPTIONAL adaptive helper routing. Holds the per-role
 * hysteresis state (session-only, in memory), reads settings + the safe analytics summaries, and calls
 * the pure decision core. `decisionFor()` (used by real helper tasks) advances state; `preview()` (used
 * by the UI/status) is read-only so polling never changes routing. Off by default. No private content.
 */
import settings from '../settings';
import analytics from './helperAnalyticsCore';
import core, { AdaptiveConfig, AdaptiveRole, RoleState, AdaptiveDecision, DEFAULT_STATE } from './adaptiveRoutingCore';

const ROLES: AdaptiveRole[] = ['query_rewriter', 'hyde_generator', 'entailment_verifier'];
const num = (v: any, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

const state: Record<AdaptiveRole, RoleState> = {
  query_rewriter: { ...DEFAULT_STATE }, hyde_generator: { ...DEFAULT_STATE }, entailment_verifier: { ...DEFAULT_STATE },
};
const lastDecision: Record<AdaptiveRole, AdaptiveDecision | null> = { query_rewriter: null, hyde_generator: null, entailment_verifier: null };
const routedAwayAtDisplay: Record<AdaptiveRole, number> = { query_rewriter: 0, hyde_generator: 0, entailment_verifier: 0 };
const recoveredAtDisplay: Record<AdaptiveRole, number> = { query_rewriter: 0, hyde_generator: 0, entailment_verifier: 0 };

export function cfg(): AdaptiveConfig {
  const a: any = (settings.get() as any).helperModels?.adaptiveRouting || {};
  return {
    enabled: !!a.enabled,
    minSamples: num(a.minSamples, 12), slowP95Ms: num(a.slowP95Ms, 3500),
    timeoutRateThreshold: num(a.timeoutRateThreshold, 0.20), failureRateThreshold: num(a.failureRateThreshold, 0.30),
    cooldownMs: num(a.cooldownMs, 300000), recoveryMinSamples: num(a.recoveryMinSamples, 8),
    recoveryP95Ms: num(a.recoveryP95Ms, 2000), recoveryTimeoutRate: num(a.recoveryTimeoutRate, 0.10),
    applyToRewrite: a.applyToRewrite !== false, applyToHyDE: a.applyToHyDE !== false, applyToEntailment: a.applyToEntailment !== false,
  };
}

export function enabled(): boolean { return cfg().enabled; }
export function appliesTo(role: AdaptiveRole): boolean { return core.appliesTo(cfg(), role); }

/** Real decision for a helper task — ADVANCES the hysteresis state. Never throws. */
export function decisionFor(role: AdaptiveRole): AdaptiveDecision {
  try {
    const c = cfg();
    const st = state[role];
    const full = analytics.roleSummary(role);
    const since = analytics.windowSummary(role, st.routedAwayAt || 0);
    const { decision, nextState } = core.decide(role, c, st, full, since, Date.now());
    if (nextState.status === 'away' && st.status !== 'away') routedAwayAtDisplay[role] = Date.now();
    if (decision.routedBackToHelper) recoveredAtDisplay[role] = Date.now();
    state[role] = nextState;
    lastDecision[role] = decision;
    return decision;
  } catch {
    // Never let adaptive logic break a helper task — fall back to "keep helper" (beta.25 behaviour).
    return { role, decisionType: 'disabled', preferHelper: true, reason: 'adaptive error — kept helper', evidence: { sampleCount: 0, p95Ms: 0, timeoutRate: 0, failureRate: 0, health: 'insufficient_data', cooldownRemainingMs: 0 }, reversible: true, routedAwayFromHelper: false, routedBackToHelper: false, recoveryProbe: false };
  }
}

/** Read-only decision for display (does NOT advance state) — safe for status polling. */
export function preview(role: AdaptiveRole): AdaptiveDecision {
  const c = cfg();
  const st = state[role];
  const full = analytics.roleSummary(role);
  const since = analytics.windowSummary(role, st.routedAwayAt || 0);
  return core.decide(role, c, st, full, since, Date.now()).decision;
}

export function status() {
  const c = cfg();
  return {
    enabled: c.enabled, config: c,
    roles: ROLES.map((role) => ({
      role, appliesTo: core.appliesTo(c, role), state: state[role].status,
      decision: preview(role), lastDecision: lastDecision[role],
      routedAwayAt: routedAwayAtDisplay[role] || null, recoveredAt: recoveredAtDisplay[role] || null,
    })),
  };
}

export function reset() {
  for (const r of ROLES) { state[r] = { ...DEFAULT_STATE }; lastDecision[r] = null; routedAwayAtDisplay[r] = 0; recoveredAtDisplay[r] = 0; }
  return status();
}

/** Force an immediate recovery probe for a role (bypass the remaining cooldown) with a fresh window. */
export function forceRecoveryProbe(role: AdaptiveRole) {
  const st = state[role];
  if (st.status === 'away') { st.status = 'probing'; st.routedAwayAt = Date.now(); st.lastProbeAt = Date.now(); }
  return status();
}

export function updateSettings(patch: any) {
  const cur: any = (settings.get() as any).helperModels || {};
  settings.save({ helperModels: { ...cur, adaptiveRouting: { ...(cur.adaptiveRouting || {}), ...(patch || {}) } } } as any);
  return status();
}

export default { cfg, enabled, appliesTo, decisionFor, preview, status, reset, forceRecoveryProbe, updateSettings };
