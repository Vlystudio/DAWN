# DAWN — 0.2.0-beta.26 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.25

**Adaptive helper routing** — using the beta.25 analytics as evidence, DAWN can now *optionally* route a
helper task away from the dedicated helper runtime when it's measurably slow or unreliable, then probe and
route back when it recovers. **Optional, off by default, transparent, and fully reversible.**

- **Evidence-based, honest.** For a role with ≥`minSamples` (12) samples, if **p95 latency > 3500 ms**,
  **timeout rate > 20%**, or **failure rate > 30%**, the role falls back honestly — rewrite/HyDE → chat
  (if allowed) else skip; entailment → lexical (if enabled) → chat → skip. It **never** routes away below
  the minimum sample and **only steers provider preference** (no invented capabilities, no fake health).
- **Hysteresis + recovery.** A routed-away role stays away for a **cooldown** (5 min), then **probes**
  recovery on the next real eligible helper tasks (no synthetic private content). It routes back only
  after **≥8 recovery samples** with p95 < 2000 ms and timeout rate < 10% — **one good sample never
  restores it**, and it won't flap across the boundary.
- **Transparent.** The decision (type + reason + evidence *numbers only*) appears in the retrieval trace,
  the Model Cookbook → Helper runtime → **Adaptive routing** panel (per-role decision + reason +
  thresholds, enable toggle, Reset), and System Health. **No prompt/response/chunk/source text anywhere.**
- **Safe by default.** Disabled = exactly beta.25 behaviour. If the adaptive logic ever throws, it keeps
  the helper (prior behaviour) — it can never break retrieval or main chat.

## Settings (new)
`helperModels.adaptiveRouting.{enabled(false), minSamples(12), slowP95Ms(3500), timeoutRateThreshold(0.20),
failureRateThreshold(0.30), cooldownMs(300000), recoveryMinSamples(8), recoveryP95Ms(2000),
recoveryTimeoutRate(0.10), applyToRewrite(true), applyToHyDE(true), applyToEntailment(true),
persistSafeHistory(false)}`.

## New IPC
`helperRuntime:{adaptiveStatus, updateAdaptiveRouting, resetAdaptiveRouting, forceRecoveryProbe}` (+
adaptive status embedded in `helperRuntime:status`). Preload `window.dawn.helperRuntime.*`. No duplicate
handlers (contract test green). All responses are safe/redacted.

## Retrieval trace (new, safe)
`adaptiveRoutingEnabled`, `rewriteAdaptive`, `hydeAdaptive` — each with decision type, reason, and
**evidence numbers** (sampleCount, p95Ms, timeoutRate, failureRate, cooldownRemainingMs) + routedAway /
routedBack / recoveryProbe flags. No private text.

## Status
- Tests: **407 / 407 pass** (`npm run test:agentos`) — **+10** (disabled=manual, per-role toggle,
  insufficient-sample never routes away, slow/timeout/failure route-away, cooldown blocks route-back,
  recovery needs enough healthy samples, one good sample doesn't restore, no-flap re-route, evidence
  carries numbers only).
- `npm run eval:rag`: **green** (exit 0). Build: **green**. TypeScript (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.26.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`.

## Security / privacy
Adaptive routing only changes provider preference from **safe numeric analytics** — it never inspects
prompt/response/chunk/source content, and none appears in the trace, IPC, or UI. Upstream retrieval safety
(blocked/skipped/removed/vault/auth/audit exclusion), the helper queue's cancellation, and honest fallback
are all unchanged. Main chat works even if adaptive logic throws.

## Honest limitations
- **Session-based** (in memory); `persistSafeHistory` exists (default off) but cross-session persistence is
  a future loop.
- **Not exercised end-to-end here** (no helper model installed) — the decision + hysteresis core is fully
  unit-covered; live behaviour appears once a helper model runs enough tasks.

## Install
Overwrite-install over beta.25. See [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md), [MODELS.md](docs/MODELS.md).
