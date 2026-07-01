/**
 * adaptiveRoutingCore.ts — pure, deterministic decision + hysteresis for OPTIONAL adaptive helper
 * routing. Given only SAFE per-role analytics (sample count, p95 latency, timeout/failure rates, health),
 * it decides whether a helper task should keep using the dedicated helper runtime or route away to the
 * honest fallback (chat / lexical), then probe + route back when the helper recovers. It ONLY steers
 * provider preference — it never invents capabilities, never inspects prompt/response content, and is
 * fully reversible. Off unless the caller says enabled. All state transitions are returned so the caller
 * can persist them; nothing here reads the clock or global state, so it's exhaustively unit-testable.
 */

export type AdaptiveDecisionType =
  | 'disabled' | 'manual' | 'insufficient_data' | 'adaptive_helper_allowed'
  | 'adaptive_avoid_slow_helper' | 'adaptive_avoid_timeout_prone_helper' | 'adaptive_avoid_failure_prone_helper'
  | 'adaptive_avoid_unavailable_helper' | 'adaptive_recovery_probe';

export type AdaptiveRole = 'query_rewriter' | 'hyde_generator' | 'entailment_verifier';

export interface AdaptiveConfig {
  enabled: boolean; minSamples: number; slowP95Ms: number; timeoutRateThreshold: number; failureRateThreshold: number;
  cooldownMs: number; recoveryMinSamples: number; recoveryP95Ms: number; recoveryTimeoutRate: number;
  applyToRewrite: boolean; applyToHyDE: boolean; applyToEntailment: boolean;
}
export interface RoleSummary { jobs: number; p95Ms: number; timeoutRate: number; failureRate: number; health: string }
export interface WindowSummary { jobs: number; p95Ms: number; timeoutRate: number }
export interface RoleState { status: 'active' | 'away' | 'probing'; routedAwayAt: number; lastRecoveryAt: number; lastProbeAt: number }

export interface AdaptiveEvidence { sampleCount: number; p95Ms: number; timeoutRate: number; failureRate: number; health: string; cooldownRemainingMs: number }
export interface AdaptiveDecision {
  role: AdaptiveRole; decisionType: AdaptiveDecisionType; preferHelper: boolean; reason: string;
  evidence: AdaptiveEvidence; reversible: boolean;
  routedAwayFromHelper: boolean; routedBackToHelper: boolean; recoveryProbe: boolean;
}

export const DEFAULT_STATE: RoleState = { status: 'active', routedAwayAt: 0, lastRecoveryAt: 0, lastProbeAt: 0 };

export function appliesTo(cfg: AdaptiveConfig, role: AdaptiveRole): boolean {
  if (role === 'query_rewriter') return cfg.applyToRewrite !== false;
  if (role === 'hyde_generator') return cfg.applyToHyDE !== false;
  if (role === 'entailment_verifier') return cfg.applyToEntailment !== false;
  return false;
}

function ev(full: RoleSummary, cooldownRemainingMs = 0): AdaptiveEvidence {
  return { sampleCount: full.jobs, p95Ms: full.p95Ms, timeoutRate: full.timeoutRate, failureRate: full.failureRate, health: full.health, cooldownRemainingMs };
}

/**
 * Decide routing for one role. Pure: pass current settings, the persisted per-role state, the full
 * per-role summary, the recovery-window summary (since routedAwayAt), and `now`. Returns the decision +
 * the next state to persist. `preferHelper=true` means keep/allow the helper runtime for this task.
 */
export function decide(role: AdaptiveRole, cfg: AdaptiveConfig, state: RoleState, full: RoleSummary, since: WindowSummary, now: number): { decision: AdaptiveDecision; nextState: RoleState } {
  const keep = (decisionType: AdaptiveDecisionType, reason: string, extra: Partial<AdaptiveDecision> = {}, cooldownRemainingMs = 0): AdaptiveDecision => ({
    role, decisionType, preferHelper: true, reason, evidence: ev(full, cooldownRemainingMs), reversible: true,
    routedAwayFromHelper: false, routedBackToHelper: false, recoveryProbe: false, ...extra,
  });
  const away = (decisionType: AdaptiveDecisionType, reason: string, cooldownRemainingMs: number): AdaptiveDecision => ({
    role, decisionType, preferHelper: false, reason, evidence: ev(full, cooldownRemainingMs), reversible: true,
    routedAwayFromHelper: true, routedBackToHelper: false, recoveryProbe: false,
  });

  if (!cfg.enabled) return { decision: keep('disabled', 'Adaptive routing disabled'), nextState: state };
  if (!appliesTo(cfg, role)) return { decision: keep('manual', 'Manual routing (adaptive off for this role)'), nextState: state };

  // --- ACTIVE: watch for degradation over enough samples ---------------------
  if (state.status === 'active') {
    if (full.jobs < cfg.minSamples) return { decision: keep('insufficient_data', `Insufficient data (${full.jobs}/${cfg.minSamples})`), nextState: state };
    if (full.p95Ms > cfg.slowP95Ms) return { decision: away('adaptive_avoid_slow_helper', `Routing away from helper: p95 ${full.p95Ms}ms > ${cfg.slowP95Ms}ms over ${full.jobs} samples`, cfg.cooldownMs), nextState: { ...state, status: 'away', routedAwayAt: now } };
    if (full.timeoutRate > cfg.timeoutRateThreshold) return { decision: away('adaptive_avoid_timeout_prone_helper', `Routing away from helper: timeout rate ${pct(full.timeoutRate)} > ${pct(cfg.timeoutRateThreshold)} over ${full.jobs} samples`, cfg.cooldownMs), nextState: { ...state, status: 'away', routedAwayAt: now } };
    if (full.failureRate > cfg.failureRateThreshold) return { decision: away('adaptive_avoid_failure_prone_helper', `Routing away from helper: failure rate ${pct(full.failureRate)} > ${pct(cfg.failureRateThreshold)} over ${full.jobs} samples`, cfg.cooldownMs), nextState: { ...state, status: 'away', routedAwayAt: now } };
    return { decision: keep('adaptive_helper_allowed', 'Helper healthy — preferred'), nextState: state };
  }

  // --- AWAY: honour cooldown, then move to probing ---------------------------
  if (state.status === 'away') {
    const remaining = Math.max(0, cfg.cooldownMs - (now - state.routedAwayAt));
    if (remaining > 0) return { decision: away('adaptive_avoid_slow_helper', `Avoiding helper (cooldown ${Math.round(remaining / 1000)}s remaining)`, remaining), nextState: state };
    return { decision: keep('adaptive_recovery_probe', 'Cooldown elapsed — probing helper recovery', { recoveryProbe: true }), nextState: { ...state, status: 'probing', lastProbeAt: now } };
  }

  // --- PROBING: gather recovery-window samples, then recover or re-avoid ------
  if (since.jobs < cfg.recoveryMinSamples) {
    return { decision: keep('adaptive_recovery_probe', `Probing helper recovery (${since.jobs}/${cfg.recoveryMinSamples})`, { recoveryProbe: true }), nextState: state };
  }
  if (since.p95Ms < cfg.recoveryP95Ms && since.timeoutRate < cfg.recoveryTimeoutRate) {
    return { decision: keep('adaptive_helper_allowed', 'Helper recovered — routing restored', { routedBackToHelper: true }), nextState: { ...state, status: 'active', routedAwayAt: 0, lastRecoveryAt: now } };
  }
  // still unhealthy → back to away, reset cooldown
  const reason = since.timeoutRate >= cfg.recoveryTimeoutRate ? 'Helper still timeout-prone' : 'Helper still slow';
  return { decision: away('adaptive_avoid_slow_helper', `${reason} — staying on fallback`, cfg.cooldownMs), nextState: { ...state, status: 'away', routedAwayAt: now } };
}

function pct(x: number): string { return `${Math.round(x * 100)}%`; }

export default { appliesTo, decide, DEFAULT_STATE };
