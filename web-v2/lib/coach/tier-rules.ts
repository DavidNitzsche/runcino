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
 *
 * ── 2026-08-17 · doctrine-conformance audit, cluster 3 ────────────────────
 *
 * Two of these fields were not tone. They were safety numbers, and the tier
 * axis moved them in the PERMISSIVE direction for the runners training
 * hardest:
 *
 *   · `sleep7AvgFloor` DROPPED with experience — 6.8 h for a beginner, 6.2
 *     for advanced, 6.0 for advanced_plus. Research/00b §"Recovery Scaled to
 *     Weekly Mileage" scales the sleep requirement UP with load: 20-40 mpw
 *     wants 7.5-9 h, 80+ mpw wants 9-10 h. The engine had it backwards, and
 *     backwards on the cohort with the most to lose.
 *
 *   · `acwrCaution` / `acwrSpike` ROSE with experience — caution 1.7 and
 *     spike 1.9 for advanced_plus. Research/15 §"Acute:Chronic Workload
 *     Ratio" is a single four-row table with NO tier dimension: <0.8
 *     detraining, 0.8-1.3 sweet spot, 1.3-1.5 caution, >1.5 danger. The
 *     tier scaling was sourced to Gabbett's "workload tolerance scales with
 *     chronic exposure", which is a statement about what the DENOMINATOR
 *     already encodes — a 1.4 on 60 mpw and a 1.4 on 25 mpw are both 1.4
 *     BECAUSE the chronic load is in the ratio. Scaling the threshold on top
 *     of that double-counts the runner's base.
 *
 * Both are now tier-independent. Tier still shapes TONE, the streak gate,
 * the wrist-temp chips and the pull-back patience — how loudly the app
 * speaks — and never the number that decides whether something is unsafe.
 */

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;

/**
 * Research/15 §"Acute:Chronic Workload Ratio" · Gabbett's zones, verbatim.
 * One table, every runner. `danger` is the ">1.5" row.
 */
export const ACWR_BANDS = {
  detraining: 0.8,
  caution: 1.3,
  danger: 1.5,
} as const;

/**
 * Research/00b §"Recovery Scaled to Weekly Mileage" · the sleep target band
 * for each mileage row, low end first. Read straight off the four per-band
 * tables (20-40 → 7.5-9 h, 40-60 → 8-9, 60-80 → 8.5-9.5, 80+ → 9-10).
 */
export const SLEEP_TARGET_BY_MPW: ReadonlyArray<{
  throughMpw: number;
  band: readonly [number, number];
}> = [
  { throughMpw: 40, band: [7.5, 9.0] },
  { throughMpw: 60, band: [8.0, 9.0] },
  { throughMpw: 80, band: [8.5, 9.5] },
  { throughMpw: Infinity, band: [9.0, 10.0] },
] as const;

/**
 * How far under the doctrine target the 7-night average has to fall before
 * the sleep action fires. Engine-internal, and the ONE number here that is
 * not read out of the research: 0.7 h is the tolerance the shipped engine
 * already ran at the entry mileage row (target 7.5, floor 6.8). Keeping it
 * means the lowest-mileage runner's behaviour is unchanged and every heavier
 * row moves in the direction doctrine points.
 */
export const SLEEP_FLOOR_TOLERANCE_H = 0.7;

/** Doctrine sleep target (low end of the band) for a weekly mileage. */
export function sleepTargetForMileage(weeklyMpw: number | null | undefined): number {
  const mpw = weeklyMpw != null && isFinite(weeklyMpw) ? weeklyMpw : 0;
  const row = SLEEP_TARGET_BY_MPW.find((r) => mpw <= r.throughMpw) ?? SLEEP_TARGET_BY_MPW[0];
  return row.band[0];
}

/**
 * Sleep floor for a weekly mileage · the doctrine target minus the engine's
 * tolerance. Below the table's first row (under 20 mpw) doctrine has no
 * lighter guidance, so the entry row stands.
 */
export function sleepFloorForMileage(weeklyMpw: number | null | undefined): number {
  return +(sleepTargetForMileage(weeklyMpw) - SLEEP_FLOOR_TOLERANCE_H).toFixed(2);
}

export interface TierRules {
  /** Minimum consecutive-day streak before HRV/RHR triggers fire.
   *  Streak detection itself still happens at 3 days (research baseline)
   *  · this gate decides when to ACT on the streak, not when to
   *  surface it. */
  streakDaysMin: number;
  /** Sleep chronic threshold · fire the sleep action when 7-night avg drops
   *  below this. NOT tier-scaled · derived from the runner's weekly mileage
   *  per Research/00b (see sleepFloorForMileage). */
  sleep7AvgFloor: number;
  /** ACWR caution band · "hold mileage flat" message. Research/15, no tier. */
  acwrCaution: number;
  /** ACWR danger band · "trim long run" message. Research/15, no tier. */
  acwrSpike: number;
  /** ACWR detraining band · "add easy miles" message. Research/15, no tier. */
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

/**
 * The genuinely tier-shaped fields · how loudly the app speaks, how long it
 * waits, which informational chips it bothers with. No safety threshold in
 * here: the ACWR bands and the sleep floor are attached by `tierRulesFor`
 * from their doctrine sources, identically for every tier.
 */
const TONE_RULES: Record<NonNullable<ExperienceLevel>, Omit<TierRules,
  'sleep7AvgFloor' | 'acwrCaution' | 'acwrSpike' | 'acwrDetraining'>> = {
  beginner: {
    streakDaysMin: 3,
    wristTempInformational: 0.2,
    wristTempWatch: 0.3,
    tone: 'prescriptive',
    pullbackConsecutiveDays: 2,
  },
  intermediate: {
    streakDaysMin: 3,
    wristTempInformational: 0.2,
    wristTempWatch: 0.3,
    tone: 'prescriptive',
    pullbackConsecutiveDays: 2,
  },
  advanced: {
    streakDaysMin: 5,
    wristTempInformational: null,   // skip +0.2 chip; +0.3 still surfaces
    wristTempWatch: 0.3,
    tone: 'informational',
    pullbackConsecutiveDays: 3,
  },
  advanced_plus: {
    streakDaysMin: 7,
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
 *
 * `weeklyMpw` is the runner's chronic weekly volume. Supply it and the sleep
 * floor comes off the runner's own Research/00b mileage row; omit it and the
 * table's entry row (20-40 mpw) stands, which is the most permissive row
 * doctrine offers and therefore the honest default when we don't know.
 */
export function tierRulesFor(level: ExperienceLevel, weeklyMpw?: number | null): TierRules {
  return {
    ...TONE_RULES[level ?? 'intermediate'],
    sleep7AvgFloor: sleepFloorForMileage(weeklyMpw),
    acwrCaution: ACWR_BANDS.caution,
    acwrSpike: ACWR_BANDS.danger,
    acwrDetraining: ACWR_BANDS.detraining,
  };
}
