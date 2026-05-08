/**
 * Doctrine — Plan integrity rules.
 *
 * Source: /Research/ (multiple files; see citations on each constant).
 *
 * This file declares the assertions that EVERY engine-generated plan
 * must honor. Validator (web/coach/plan-validator.ts) reads these and
 * checks each rule against the engine's output. When a rule fails, the
 * validator returns a PlanIssue with the doctrine citation so the
 * regression is visible — both to the runner (banner on /training)
 * and to the developer (engine logs).
 *
 * Why this file exists:
 *
 * The engine had implicit rules embedded in switch statements with
 * magic numbers. Each rule was a place where a future regression
 * could silently produce a 7-day-easy stretch, a 26mi long run from
 * race contamination, a 30-day-rest projection, or a Sat-hardcoded
 * long run on a Sunday-runner's plan. Symptoms only surfaced via
 * screenshots from the runner.
 *
 * Now: every rule is a Cited<T> here. Validator reads them. Tests
 * assert zero validator errors across a tier × phase × race-calendar
 * matrix. Engine refactors that break a rule fail in CI.
 *
 * Engine consumers:
 *   - plan-validator.ts            → reads every constant in this file
 *   - coachDaily()                 → runs validatePlan() before return
 *   - /training banner             → surfaces errors to runner
 */
import { cite, type Cited } from './cite';
import type { MileageTier } from './recovery_protocols';

// ── 1. Max consecutive non-rest days ─────────────────────────────
//
// Pfitz/Daniels both stress: aerobic adaptation comes from absorbing
// load, not piling it. The hard ceiling on consecutive run days
// before a rest scales with weekly volume — a high-mileage runner
// can string 6-7 days, a low-mileage runner shouldn't go past 5
// before a rest day intervenes.
//
// Why this rule exists: caught the 7-day-GA stretch in stage-4
// post-race. The engine prescribed 5+ consecutive easy days because
// stage-4 only had ONE rest day baked in. Validator now flags any
// plan window with > tier max as a planIssue.

export const MAX_CONSECUTIVE_NON_REST_DAYS_BY_TIER: Cited<Record<MileageTier, number>> = {
  value: {
    low:   5,  // 20-40 mpw — 1-2 rest days/week per Research/00b
    mid:   6,  // 40-60 mpw — 1 rest day/week + occasional shake-out
    high:  6,  // 60-80 mpw — 0-1 rest, but 6 days running is still the safe ceiling
    elite: 7,  // 80+ mpw — daily running is normal at this tier
  },
  citations: [
    cite('§Recovery Scaled to Weekly Mileage', 'Rest days/week by tier: low 1-2 / mid 1 / high 0-1 (shake-out replaces) / elite 0-1', 'research', '00b'),
    cite('§Hard-Easy Alternation', 'Hard day → easy day cadence; consecutive hard days violate the 24h-recovery rule', 'research', '00b'),
  ],
};

// ── 2. Minimum weekly mileage during BUILD/PEAK ───────────────────
//
// During a race-mode build, the engine should never zero out or
// near-zero a week unless TAPER or POST_RACE explicitly justifies
// it. A 30 mpw runner in BUILD shouldn't see a 5 mpw week — that's
// detraining.
//
// Why this rule exists: caught the 14mi NEXT WEEK during recovery
// week 1 (which IS doctrine for stage-2 light, but if it persisted
// into stage-3 or BASE_MAINTENANCE, that's a bug).

export const MIN_WEEKLY_MILEAGE_FRAC_BY_PHASE: Cited<Record<string, number>> = {
  value: {
    BASE:               0.85,  // base weeks within 15% of weeklyAvg4w
    BUILD:              0.85,
    PEAK:               0.90,
    TAPER:              0.50,  // taper drops 40-50%
    BASE_MAINTENANCE:   0.85,
    REBUILD:            0.50,  // rebuilding from break — gradual ramp
    POST_RACE:          0.20,  // recovery week can drop to 20% of normal
  },
  note: 'Floor relative to weeklyAvg4w. Plans below this in their phase are flagged as detraining-risk unless POST_RACE/TAPER explicitly. Per Pfitz: aerobic base erodes after ~10 days of < 50% normal volume.',
  citations: [
    cite('§Volume + Long Run', 'Maintenance load: 70-85% of recent average to retain aerobic base', 'research', '00b'),
    cite('§Taper', 'Taper volume reduction 40-60% over final 2 weeks', 'research', '14'),
  ],
};

// ── 3. Quality cadence ────────────────────────────────────────────
//
// Polarized 80/20 + Pfitz BUILD/PEAK both prescribe specific quality
// cadences per phase. Outside these bands, the plan is either
// over-cooking (too many quality days → injury) or too soft (no
// quality → no race-pace adaptation).

export const QUALITY_DAYS_PER_WEEK_BY_PHASE: Cited<Record<string, { min: number; max: number }>> = {
  value: {
    BASE:             { min: 0, max: 1 },
    BUILD:            { min: 1, max: 2 },
    PEAK:             { min: 2, max: 2 },
    TAPER:            { min: 1, max: 1 },  // intensity preserved, volume cut
    BASE_MAINTENANCE: { min: 1, max: 1 },
    REBUILD:          { min: 0, max: 1 },
    POST_RACE:        { min: 0, max: 0 },  // no quality during recovery
  },
  citations: [
    cite('§3.1 Polarized Distribution', '~80% easy / 20% quality split; max 2 quality/wk to absorb', 'research', '00a'),
    cite('§Build/Peak/Taper Phase Cadence', 'Quality density by phase', 'research', '00b'),
    cite('§Taper Intensity Preservation', 'Taper drops volume but holds 1 quality session', 'research', '14'),
  ],
};

// ── 4. Long-run spike rule ────────────────────────────────────────
//
// Daniels' single-session-spike: the longest run shouldn't exceed
// 110% of the runner's recent (28d) longest TRAINING long run.
// Races excluded — a 26mi marathon shouldn't license a 28mi long run.
//
// Why this rule exists: caught the 26.8mi long_steady prescription
// after Big Sur was counted as a "training long run" in
// longestLast28Mi. Validator asserts `longRunMi ≤ longestLast28Mi
// × 1.10` and `longestLast28Mi excludes races`.

export const LONG_RUN_SPIKE_MAX_RATIO: Cited<{ ratio: number; excludeRaces: boolean }> = {
  value: { ratio: 1.10, excludeRaces: true },
  note: 'Daniels §13.1 single-session-spike rule. The 10% cap protects connective tissue, which adapts on a 2-4 week timeline (much slower than VO2max). Races excluded because race effort + race-day adrenaline produce a distance the runner can\'t safely train at.',
  citations: [
    cite('§13.1 Single-Session Spike', 'Long run ≤ 110% of recent longest', 'research', '01'),
    cite('§Volume + Long Run', 'Connective tissue adaptation 2-4 weeks', 'research', '00b'),
  ],
};

// ── 5. Recovery floor by tier ────────────────────────────────────
//
// A "recovery jog" prescription should never be smaller than a
// fraction of the runner's daily aerobic floor. A 2.5mi recovery
// jog is appropriate for a 20 mpw runner; a 60+ mpw runner whose
// daily floor is 8mi needs a longer jog to keep circulation honest.
//
// Floor formula: max(2.0, min(6.0, dailyFloor × 0.55)) where
// dailyFloor = weeklyAvg4w / 7.

export const RECOVERY_JOG_FLOOR_FRAC: Cited<{ frac: number; absMin: number; absMax: number }> = {
  value: { frac: 0.55, absMin: 2.0, absMax: 6.0 },
  citations: [
    cite('§Recovery Scaled to Weekly Mileage', 'Recovery-jog modality scales with absolute weekly load', 'research', '00b'),
  ],
};

// ── 6. Hard-easy alternation ─────────────────────────────────────
//
// Quality day → easy day rule. Two consecutive quality days violate
// 24h-recovery doctrine. Validator flags any QQ adjacency.

export const HARD_EASY_ALTERNATION_REQUIRED: Cited<{ minEasyDaysBetweenQuality: number }> = {
  value: { minEasyDaysBetweenQuality: 1 },
  citations: [
    cite('§Hard-Easy Alternation Rules', '24h between hard sessions; gap of 1+ easy day required', 'research', '00b'),
  ],
};

// ── 7. Long-run-day preference honored ───────────────────────────
//
// When the runner has set state.runner.longRunDow, the engine MUST
// place the long run on that day. Caught the Sat-hardcoded long
// for a Sunday-runner.

export const LONG_RUN_PLACEMENT_HONORS_PREFERENCE: Cited<{ required: true }> = {
  value: { required: true },
  citations: [
    cite('§User Preferences', 'Engine respects runner-set long-run day; mismatch is a P0 plan-integrity error', 'coaching'),
  ],
};

// ── 8. POST_RACE quality blackout ────────────────────────────────
//
// Per POST_RACE_BY_DISTANCE doctrine, quality work resumes after
// the no-quality window closes (21d for marathon, 10d for half).
// Validator asserts no quality prescription appears within the
// recovery window.

export const POST_RACE_QUALITY_BLACKOUT: Cited<{ enforced: true }> = {
  value: { enforced: true },
  citations: [
    cite('§Post-Race Recovery › Recovery by Distance', 'totalRecoveryDaysNoQuality * tier modifier', 'research', '00b'),
  ],
};
