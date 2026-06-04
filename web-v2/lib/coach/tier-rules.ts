/**
 * lib/coach/tier-rules.ts · runner-experience-aware thresholds.
 *
 * Locked in 2026-06-03 by David: "I think the plan adjustments and
 * flags should be dependent on the level of the runner. So advanced
 * maybe let the runner push through things more? Is that valid?"
 *
 * Yes · research-backed:
 *   · Plews & Buchheit (HRV monitoring) · SWC scales with training
 *     history. Recreational runners show larger daily variance with
 *     less performance implication. Elite runners' baselines are
 *     tighter and more meaningful.
 *   · Gabbett (ACWR) · workload tolerance scales with chronic
 *     exposure. A 1.4 spike on 60mpw ≠ a 1.4 spike on 25mpw.
 *   · Daniels · pace bands assume a training maturity. Below the
 *     base, prescriptions are wrong, not just imprecise.
 *
 * Two surfaces consume these:
 *   1. lib/coach/health-actions.ts · the Health page action panel
 *   2. lib/plan/adapt.ts · the nightly plan adapter
 *
 * Both must agree · same tier, same triggers, same band cuts.
 * Otherwise the runner sees "ease tomorrow" on the panel while the
 * plan still shows quality (or vice versa).
 *
 * HARD RULES override tier · these always fire regardless of
 * experience. See HARD_RULES below.
 */

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;

export interface TierRules {
  /** Minimum consecutive-day streak before HRV/RHR triggers fire.
   *  Streak detection itself still happens at 3 days (research baseline)
   *  · this gate decides when to ACT on the streak, not when to
   *  surface it. */
  streakDaysMin: number;
  /** Sleep chronic threshold · fire the sleep action when 7-night
   *  avg drops below this. Lower = trust the runner more. */
  sleep7AvgFloor: number;
  /** ACWR caution band · "hold mileage flat" message. */
  acwrCaution: number;
  /** ACWR spike band · "trim long run" message. */
  acwrSpike: number;
  /** ACWR detraining band · "add easy miles" message. */
  acwrDetraining: number;
  /** Wrist temp informational threshold · null = don't surface unless
   *  hard rule (+0.4°C) fires. Advanced runners skip the +0.2 chip. */
  wristTempInformational: number | null;
  /** Wrist temp prescriptive threshold · the "watch for cold symptoms"
   *  fire-point. Still informational vs hard-rule (+0.4°C illness alert). */
  wristTempWatch: number;
  /** Action voice:
   *    · 'prescriptive' = "Tomorrow easy · let HRV recover."
   *    · 'informational' = "HRV down 5 days · pattern worth noting."
   *    · 'red-flag-only' = only hard-rule signals surface anything. */
  tone: 'prescriptive' | 'informational' | 'red-flag-only';
  /** Band-driven fallback · # consecutive PULL-BACK days needed before
   *  the fallback action fires. Higher = trust the runner more, even
   *  on a multi-day rough patch. */
  pullbackConsecutiveDays: number;
}

/**
 * HARD RULES · always fire, regardless of tier. These are the "don't
 * push through this" signals where pushing through has real downside.
 *
 *   · Active illness  · fever / flu episode · skip intensity
 *   · Niggle flare    · pain isn't pushable
 *   · Wrist temp ≥ +0.4°C · illness onset signal per Research/15
 *   · ACWR > 2.0      · injury risk uncoupled from chronic base
 *   · 7-day sustained pull-back · pattern too sustained to ignore
 *     even for advanced
 */
export const HARD_RULES = {
  wristTempIllnessAlert: 0.4,
  acwrInjuryHardCap: 2.0,
  pullbackForcedAck: 7,
} as const;

const RULES: Record<NonNullable<ExperienceLevel>, TierRules> = {
  beginner: {
    streakDaysMin: 3,
    sleep7AvgFloor: 6.8,
    acwrCaution: 1.3,
    acwrSpike: 1.4,
    acwrDetraining: 0.8,
    wristTempInformational: 0.2,
    wristTempWatch: 0.3,
    tone: 'prescriptive',
    pullbackConsecutiveDays: 2,
  },
  intermediate: {
    streakDaysMin: 3,
    sleep7AvgFloor: 6.8,
    acwrCaution: 1.3,
    acwrSpike: 1.4,
    acwrDetraining: 0.8,
    wristTempInformational: 0.2,
    wristTempWatch: 0.3,
    tone: 'prescriptive',
    pullbackConsecutiveDays: 2,
  },
  advanced: {
    streakDaysMin: 5,
    sleep7AvgFloor: 6.2,
    acwrCaution: 1.5,
    acwrSpike: 1.7,
    acwrDetraining: 0.7,
    wristTempInformational: null,   // skip +0.2 chip; +0.3 still surfaces
    wristTempWatch: 0.3,
    tone: 'informational',
    pullbackConsecutiveDays: 3,
  },
  advanced_plus: {
    streakDaysMin: 7,
    sleep7AvgFloor: 6.0,
    acwrCaution: 1.7,
    acwrSpike: 1.9,
    acwrDetraining: 0.6,
    wristTempInformational: null,
    wristTempWatch: 0.4,             // only hard-rule alert
    tone: 'red-flag-only',
    pullbackConsecutiveDays: 4,
  },
};

/**
 * Resolve tier rules for a runner. Null tier defaults to 'intermediate'
 * (safe middle · prescriptive enough to be useful for unknown runners
 * without being annoying for advanced ones).
 */
export function tierRulesFor(level: ExperienceLevel): TierRules {
  return RULES[level ?? 'intermediate'];
}
