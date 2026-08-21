/**
 * lib/coach/convergence.ts · THE convergence rule.
 *
 * ── The ruling this implements (owner, 2026-08-19) ───────────────────────
 *
 *   "Readiness may change a session — but only on a convergence of
 *    independent signals, never on one metric, and the change is settled
 *    the night before."
 *
 * This reconciles two things that had been in tension in the source. The
 * 2026-06-03 ruling (`feedback_no_reactive_coach`) said readiness INFORMS and
 * never mutates, and `lib/plan/adapt.ts` carried a long comment defending it.
 * The owner separately moved the adaptation cron to 03:00 UTC himself — "I
 * dont want to wake up to change runs · that was annoying" — which is not a
 * refusal of automatic change but a requirement about WHEN it happens. The
 * ruling above permits exactly that and nothing more: a change may be made,
 * automatically, provided it is settled before the runner sees the day, and
 * provided the evidence is a convergence rather than a metric having a bad
 * morning.
 *
 * ── Why the old gate had to go ───────────────────────────────────────────
 *
 * `detectReadinessPullback` fired when ANY ONE of these was true:
 *
 *     sustainedPullBack || hasTieredStreak || forcedByHardRule || subjectiveFired
 *
 * `hasTieredStreak` is ONE streak in ONE pillar. A runner with five days of
 * elevated RHR and nothing else wrong had his quality session downgraded on a
 * single number. `subjectiveFired` is one bad post-run rating, alone. Both are
 * precisely what the ruling forbids.
 *
 * ── Domains, not pillars ─────────────────────────────────────────────────
 *
 * The unit of convergence is a DOMAIN — a physiological channel that can fail
 * independently of the others. This distinction is the whole rule. Counting
 * two measures of the same system as two signals fakes the independence the
 * ruling is built on, and would let one underlying event masquerade as a
 * convergence.
 *
 *   autonomic   · HRV (7-day rolling LnRMSSD vs the runner's own baseline)
 *   cardiac     · resting heart rate (nocturnal, vs the runner's own baseline)
 *   sleep       · total sleep time, 7-night trend vs the doctrine floor
 *   load        · acute:chronic workload ratio
 *   subjective  · the runner's own post-run report
 *
 * HR RECOVERY IS DELIBERATELY NOT A SIXTH DOMAIN. It is the same cardiac
 * system RHR measures, from the same sensor, and Research/15 gives it no row
 * at all. Admitting it would let one elevated heart rate count twice and reach
 * the convergence bar on its own. It stays what `readiness.ts` calls it: a 5%
 * engine-internal sub-signal on the score, with no vote here.
 *
 * ── The ladder ───────────────────────────────────────────────────────────
 *
 *   green   ≤1 domain dragging   nothing happens
 *   amber    2 domains dragging   the runner is told; THE PLAN IS NOT TOUCHED
 *   red     ≥3 domains dragging   today's quality session may be downgraded
 *
 * Three, not two, is the bar for touching the plan. The citation is
 * BuildResearch D1 §3 — "three corroborating signals start to look like
 * evidence" — and its honest epistemic status is stated here rather than
 * dressed up: D1 §3 is a finding about what READS as evidence to a person,
 * from the composite-score UX literature, not a physiological threshold. It is
 * the right shape for this decision (when is a picture strong enough to act
 * on?) and it is the number `readiness.ts` already uses for the pull-back
 * band, so band and mutation share one notion of corroboration. The physiology
 * doing the real work is per-domain, below, and is Research/15's.
 *
 * The mutation bar sits ONE domain above the bar for the pull-back BAND
 * (`PULLBACK_MIN_DRAGGING_PILLARS` = 2). That gap is deliberate: saying
 * something is cheaper than doing something, so it should need less evidence.
 *
 * ── Per-domain thresholds · all Research/15 ──────────────────────────────
 *
 * Each domain has its own persistence requirement, read out of the doc. None
 * of them can be met by a single day's reading — Research/15 §"Common HRV
 * interpretation errors" opens with "Treating one day's reading as actionable"
 * as an error, and that applies across the board.
 *
 * ── Per-domain context filters · CLAUDE.md, locked 2026-05-19 round 4 ────
 *
 * "A surface that aggregates N findings runs N filter applications, one per
 * finding." Each domain asks its OWN question about what would distort THIS
 * observation, and a context that explains a domain's reading disqualifies
 * that domain from voting. It does not suppress the surface — the other
 * domains still count, which is the entire point of doing it per-finding.
 *
 * The V5 Z2 incident is the worked example of getting this wrong: a
 * surface-level race-week guard that would have fired correctly, wrapped
 * around a sub-finding that walked history independently and picked up a
 * deliberate taper workout as evidence of overreaching.
 *
 * Research/15 §"Confounders that elevate RHR independent of training stress"
 * names most of these in the doc itself: "Alcohol within 12 hr (+5 to +10
 * bpm), late meals, hot bedroom (+3 to +5 bpm), dehydration, late caffeine,
 * emotional/work stress, travel and altitude >1500 m (elevates nocturnal HR
 * 3–5 days)." A filter table is the operational form of that sentence.
 *
 * ── What this module may never do ────────────────────────────────────────
 *
 * Nothing here re-anchors training paces. Paces come from measured evidence
 * (`lib/coach/vdot.ts` and the race-result source of truth); convergence
 * changes WHAT IS PRESCRIBED TODAY, never what the runner is judged capable
 * of. A red morning is a statement about this morning, not a demotion.
 *
 * Determinism: no `Math.random`, no clock. Every input is passed in, including
 * the runner's own date, so a given day's evidence always grades the same way.
 */

import { sleepFloorForMileage } from './tier-rules';

export type ConvergenceDomain =
  | 'autonomic'
  | 'cardiac'
  | 'sleep'
  | 'load'
  | 'subjective';

export type ConvergenceGrade = 'green' | 'amber' | 'red';

/**
 * Doctrine constants. Every one of these is bound by a registry claim
 * (`CONVERGENCE.*` in lib/doctrine/registry.ts) that parses the number out of
 * the cited passage at run time. The two that are NOT read out of the research
 * are labelled convention, in the shape `CONVENTION.*` claims already use.
 */
export const CONVERGENCE = {
  /**
   * Research/15 §"Decision rules" (RHR table) · the "≥+5 bpm for 2+
   * consecutive days" row, whose action signal is "Reduce intensity; flag".
   * The row above it (+3 to +5 for 1 day) says "Watch, do not act" — this
   * engine's bar is the first row doctrine says to act on.
   */
  rhrRiseBpm: 5,
  rhrMinDays: 2,

  /**
   * Research/15 §"Interpretation matrix" (HRV) · "Falling > SWC for ≥3 days"
   * → "Reduce intensity 24–72 hr".
   */
  hrvMinDays: 3,

  /**
   * Research/15 §"Plews approach" step 3 · "smallest worthwhile change (SWC)
   * as `0.5 × SD` of the 7-day rolling average over the prior 60 days".
   */
  hrvSwcSdMultiple: 0.5,

  /**
   * Research/15 §"Plews approach" step 4 · the alternative form of the same
   * flag, "LnRMSSD × 20 drops by ≥1.5 points (≈7.5% raw RMSSD drop)". Used
   * only when the 60-day SD is not yet computable, so a runner without 60 days
   * of history still gets doctrine's rule rather than no rule.
   *
   * Expressed as a RAW RMSSD percentage because that is how doctrine writes
   * it; `hrvFallbackLnDrop` below converts it into the log space the rest of
   * the domain works in, so the two forms cannot drift apart.
   */
  hrvFallbackDropPct: 7.5,

  /**
   * Research/15 §"Acute:Chronic Workload Ratio" · Gabbett's ">1.5 · Danger
   * zone". Doctrine's own critique in the same section — "treat ACWR as a
   * directional sanity check, not a stop-light ... a ratio of 1.4 in itself is
   * not a verdict" — is exactly why load is only ever ONE VOTE here and can
   * never act alone. The sentence that follows it is the convergence rule in
   * doctrine's own words: "Couple with HRV trend, RHR, sleep, and subjective
   * state."
   */
  acwrDanger: 1.5,

  /**
   * CONVENTION · not read out of the research. Research/15 gives ACWR no
   * persistence requirement because it declines to make it a verdict at all.
   * Requiring two days matches the shortest persistence doctrine asks of any
   * other domain (RHR's 2), so load is held to no weaker a standard than the
   * signals doctrine does quantify. One day is excluded on the general rule
   * that a single day's reading is not actionable.
   */
  acwrMinDays: 2,

  /**
   * Research/15 §"Establishing a baseline" (RHR) · "Minimum 14 days of data
   * before drawing conclusions." Below this NOTHING may fire — a day-one
   * runner has no personal normal to deviate from.
   */
  minBaselineDays: 14,

  /**
   * Domains that must converge. See the ladder in the docblock: 3 to touch
   * the plan (D1 §3), 2 to say something.
   */
  redMinDomains: 3,
  amberMinDomains: 2,

  /**
   * Research/15 §"Confounders that elevate RHR independent of training
   * stress" · "travel and altitude >1500 m (elevates nocturnal HR 3–5 days)".
   * The wide end of doctrine's own band, so the filter is generous to the
   * runner rather than to the detector.
   */
  travelConfoundDays: 5,

  /**
   * CONVENTION · not read out of the research. Research/06 quantifies heat's
   * effect on the SESSION, not on next-morning RHR; Research/15 names "hot
   * bedroom (+3 to +5 bpm)" as a confounder without a duration. Three days
   * mirrors the trailing window the heat gate already reasons over, and errs
   * toward not counting a cardiac reading that heat could explain.
   */
  heatConfoundDays: 3,
} as const;

/**
 * One day's raw evidence, oldest → newest. `null` means no reading that day,
 * which is never treated as a bad reading — a domain we cannot see does not
 * vote. Same discipline as COLD-4 in recovery-brief.ts, where every absent
 * pillar's default happened to flatter and 64 of 89 points came from data that
 * did not exist.
 */
export interface ConvergenceSeries {
  /**
   * 7-day rolling mean of LnRMSSD, one entry per day, oldest → newest.
   *
   * LOG SPACE, NOT MILLISECONDS. Research/15 §"Plews approach" step 2 computes
   * the rolling average of LnRMSSD and step 3 defines the smallest worthwhile
   * change against THAT series, so the threshold is only doctrine's if the
   * comparison happens in the same space. All three HRV fields here share it.
   */
  hrvLnRolling: Array<number | null>;
  /** The runner's own reference · 60-day mean of the rolling average, Ln. */
  hrvLnBaseline: number | null;
  /** SD of the 7-day rolling average over the prior 60 days, Ln · drives the SWC. */
  hrvLnSd60d: number | null;
  /** Nocturnal RHR, bpm, one entry per day. */
  rhrDaily: Array<number | null>;
  /** The runner's own RHR reference. */
  rhrBaseline: number | null;
  /** Total sleep time, hours, one entry per night. */
  sleepNightly: Array<number | null>;
  /** Acute:chronic workload ratio, one entry per day. Null where not yet observable. */
  acwrDaily: Array<number | null>;
  /**
   * The runner reported yesterday's PLANNED-EASY session as wrecked / cooked
   * / RPE ≥ 8. Computed by `lib/coach/acknowledge.ts:subjectivePullbackSignal`,
   * which already excludes quality and long days — those are allowed to read
   * hard.
   */
  subjectiveWreckedOnEasy: boolean;
  /** Days of biometric history this runner has. Gates everything. */
  baselineDays: number;
  /** The runner's habitual weekly mileage · sets the doctrine sleep floor. */
  weeklyMpw: number | null;
}

/**
 * What might explain a reading. Each field is consumed by SPECIFIC domains —
 * see `SUPPRESSORS` — never by the surface as a whole.
 */
export interface ConvergenceContext {
  /** Days until the next race; null when none scheduled. */
  daysToNextRace: number | null;
  /** Days since the last race; null when none. */
  daysSinceLastRace: number | null;
  /** Length of the doctrine post-race recovery window for that race, in days. */
  postRaceWindowDays: number;
  /** The plan itself is in a taper or a planned cutback this week. */
  inPlannedCutback: boolean;
  /** An illness episode is logged and active. */
  illnessActive: boolean;
  /** Days since crossing ≥2 time zones; null when no recent travel. */
  daysSinceTravel: number | null;
  /** Heat-flagged sessions in the trailing window (Research/06 gate). */
  heatFlaggedDaysRecent: number;
  /** Alcohol logged last night. */
  alcoholLastNight: boolean;
}

export interface DomainVerdict {
  domain: ConvergenceDomain;
  /** The domain's evidence met its doctrine threshold. */
  dragging: boolean;
  /** Consecutive days the threshold was met, ending on the most recent day. */
  daysSustained: number;
  /** Non-null when a context filter disqualified this domain from voting. */
  suppressedBy: string | null;
  /** Counted toward the convergence · `dragging && !suppressedBy`. */
  counts: boolean;
  /** Plain-English fragment for coach copy. Null when the domain is not dragging. */
  phrase: string | null;
}

export interface ConvergenceVerdict {
  grade: ConvergenceGrade;
  /** Domains that met threshold AND survived their own filters. */
  converging: ConvergenceDomain[];
  /** Every domain's working, including the suppressed ones. */
  domains: DomainVerdict[];
  /** Why the grade is what it is, for the intent record. Never shown raw. */
  rationale: string;
}

/* ────────────────────────── Streak arithmetic ────────────────────────── */

/**
 * Consecutive trailing days for which `test` holds, counting back from the
 * newest entry. A `null` day breaks the streak rather than extending it — a
 * missing reading is not evidence the condition held.
 */
function trailingStreak<T>(
  series: Array<T | null>,
  test: (v: T) => boolean,
): number {
  let n = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v == null || !test(v)) break;
    n++;
  }
  return n;
}

/** Mean of the present values, or null when there are none. */
function meanPresent(xs: Array<number | null>): number | null {
  const present = xs.filter((x): x is number => x != null && isFinite(x));
  if (present.length === 0) return null;
  return present.reduce((s, x) => s + x, 0) / present.length;
}

/* ────────────────────────── Per-domain filters ───────────────────────── */

/**
 * Which contexts disqualify which domain, and why. One row per (domain,
 * context) pair, evaluated independently per domain.
 *
 * Read this table as the per-finding filter application CLAUDE.md requires:
 * `sleep` does not care that the runner ran in heat, and `load` does not care
 * that he had a drink — but `cardiac` cares about both, because Research/15
 * names both as things that raise nocturnal heart rate without any training
 * stress behind them.
 */
type Suppressor = {
  /** Human-readable reason, recorded on the verdict. */
  reason: string;
  applies: (c: ConvergenceContext) => boolean;
};

const inPostRaceWindow = (c: ConvergenceContext): boolean =>
  c.daysSinceLastRace != null && c.daysSinceLastRace <= c.postRaceWindowDays;

const recentTravel = (c: ConvergenceContext): boolean =>
  c.daysSinceTravel != null && c.daysSinceTravel <= CONVERGENCE.travelConfoundDays;

const SUPPRESSORS: Record<ConvergenceDomain, Suppressor[]> = {
  /**
   * HRV. Research/15 §"Common HRV interpretation errors" warns against
   * reading HRV without controlling context; the confounder list for the
   * autonomic system is alcohol, illness, travel, and post-race disturbance.
   */
  autonomic: [
    {
      reason: 'illness',
      applies: (c) => c.illnessActive,
      // An illness episode has its own protocol (Research/05) and its own
      // propose-only path in adapt.ts. Counting the HRV drop it causes as
      // training overreach would double-respond to one event.
    },
    {
      reason: 'post-race recovery',
      applies: inPostRaceWindow,
      // Depressed HRV after a race is the expected response, not a warning.
      // The plan is already a recovery block; there is nothing to downgrade.
    },
    {
      reason: 'recent travel',
      applies: recentTravel,
    },
    {
      reason: 'alcohol',
      applies: (c) => c.alcoholLastNight,
    },
  ],

  /**
   * RHR. Research/15 §"Confounders that elevate RHR independent of training
   * stress" is the source list, verbatim: alcohol, hot bedroom, travel and
   * altitude (3–5 days). Illness is named in the decision table's own top row.
   */
  cardiac: [
    { reason: 'illness', applies: (c) => c.illnessActive },
    { reason: 'post-race recovery', applies: inPostRaceWindow },
    { reason: 'recent travel', applies: recentTravel },
    { reason: 'alcohol', applies: (c) => c.alcoholLastNight },
    {
      reason: 'heat',
      applies: (c) => c.heatFlaggedDaysRecent > 0,
      // Research/15 names "hot bedroom (+3 to +5 bpm)" — the same order as the
      // +5 threshold itself, so a heat block can manufacture this domain
      // outright.
    },
  ],

  /**
   * Sleep. Short nights in a new time zone are the time zone, not the
   * training. Heat is NOT a sleep suppressor: a hot night genuinely costs
   * sleep, and the lost sleep is real recovery lost either way.
   */
  sleep: [
    { reason: 'recent travel', applies: recentTravel },
    {
      reason: 'race night',
      applies: (c) => c.daysSinceLastRace != null && c.daysSinceLastRace <= 1,
    },
  ],

  /**
   * Load. THIS IS THE V5 Z2 ROW. A taper drops the ratio by design and a
   * comeback re-ramp inflates it by arithmetic; in both cases the number is
   * describing the plan, not the runner. Doctrine is blunt about how little
   * the ratio proves on its own, so it gets the most filtering.
   */
  load: [
    {
      reason: 'planned cutback',
      applies: (c) => c.inPlannedCutback,
    },
    {
      reason: 'race week',
      applies: (c) => c.daysToNextRace != null && c.daysToNextRace <= 7,
    },
    {
      reason: 'post-race recovery',
      applies: inPostRaceWindow,
    },
  ],

  /**
   * Subjective. `subjectivePullbackSignal` already restricts this to days that
   * were PLANNED EASY, so a hard session reading hard never lands here. What
   * remains to filter is the race itself and its aftermath, where feeling
   * wrecked is the expected outcome of a thing that already happened.
   */
  subjective: [
    { reason: 'post-race recovery', applies: inPostRaceWindow },
    { reason: 'illness', applies: (c) => c.illnessActive },
  ],
};

function suppressionFor(
  domain: ConvergenceDomain,
  context: ConvergenceContext,
): string | null {
  for (const s of SUPPRESSORS[domain]) {
    if (s.applies(context)) return s.reason;
  }
  return null;
}

/* ────────────────────────── Domain evaluation ────────────────────────── */

function countWord(n: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  return words[n] ?? String(n);
}

/**
 * Phrases are NOUN PHRASES, all of them, so they assemble into one readable
 * list: "Three short nights, four days of low HRV and a resting heart rate
 * above your usual." That is the form the owner's own example takes — "three
 * days of poor sleep and an elevated resting heart rate" — and mixing clauses
 * with noun phrases is what made the first draft read like a machine.
 *
 * A streak longer than a week is described, not counted. "Thirty days of low
 * HRV" is technically what the series says and is not how a person talks.
 */
function daysPhrase(n: number, noun: string): string {
  return n > 7 ? `over a week of ${noun}` : `${countWord(n)} days of ${noun}`;
}

/**
 * Doctrine's step-4 fallback, converted once into log space.
 *
 * A "7.5% raw RMSSD drop" means the new value is 0.925 of the old, so in
 * LnRMSSD it is a fixed decrease of −ln(0.925) ≈ 0.078 whatever the runner's
 * absolute HRV. Deriving it here rather than writing 0.078 down keeps the
 * engine tied to the percentage doctrine actually states.
 */
export const hrvFallbackLnDrop = (): number =>
  -Math.log(1 - CONVERGENCE.hrvFallbackDropPct / 100);

function evaluateAutonomic(s: ConvergenceSeries): { dragging: boolean; days: number; phrase: string | null } {
  const baseline = s.hrvLnBaseline;
  if (baseline == null || !isFinite(baseline)) return { dragging: false, days: 0, phrase: null };

  // Research/15 §"Plews approach" step 3: SWC = 0.5 × SD of the 7-day rolling
  // average. Step 4's percentage form is the documented alternative, used only
  // when the runner has no 60-day SD yet — a runner in his third week gets
  // doctrine's rule rather than no rule.
  const swc = s.hrvLnSd60d != null && isFinite(s.hrvLnSd60d) && s.hrvLnSd60d > 0
    ? CONVERGENCE.hrvSwcSdMultiple * s.hrvLnSd60d
    : hrvFallbackLnDrop();

  const days = trailingStreak(s.hrvLnRolling, (v) => baseline - v > swc);
  const dragging = days >= CONVERGENCE.hrvMinDays;
  return {
    dragging,
    days,
    phrase: dragging
      ? daysPhrase(days, 'low HRV')
      : null,
  };
}

function evaluateCardiac(s: ConvergenceSeries): { dragging: boolean; days: number; phrase: string | null } {
  const baseline = s.rhrBaseline;
  if (baseline == null) return { dragging: false, days: 0, phrase: null };
  const days = trailingStreak(
    s.rhrDaily,
    (v) => v - baseline >= CONVERGENCE.rhrRiseBpm,
  );
  const dragging = days >= CONVERGENCE.rhrMinDays;
  return {
    dragging,
    days,
    phrase: dragging ? 'a resting heart rate above your usual' : null,
  };
}

function evaluateSleep(s: ConvergenceSeries): { dragging: boolean; days: number; phrase: string | null } {
  const last7 = s.sleepNightly.slice(-7);
  const avg = meanPresent(last7);
  if (avg == null) return { dragging: false, days: 0, phrase: null };

  // Research/15 §"What to use vs. ignore" · "Coaching rule: trend total sleep
  // time and efficiency." The test is the TREND, not a streak of bad nights,
  // so no new persistence constant is invented here. The floor is the
  // doctrine, mileage-scaled target less the engine's existing named
  // tolerance — one number, already registry-bound (TIER.sleep-floor-rises-
  // with-mileage), shared with every other sleep consumer.
  const floor = sleepFloorForMileage(s.weeklyMpw);
  const dragging = avg < floor;

  // The COUNT is for the copy only — "three short nights" is what a person
  // understands. It is not what the rule tests.
  const shortNights = last7.filter((h) => h != null && h < floor).length;
  return {
    dragging,
    days: shortNights,
    phrase: dragging ? `${countWord(shortNights)} short nights` : null,
  };
}

function evaluateLoad(s: ConvergenceSeries): { dragging: boolean; days: number; phrase: string | null } {
  const days = trailingStreak(s.acwrDaily, (v) => v > CONVERGENCE.acwrDanger);
  const dragging = days >= CONVERGENCE.acwrMinDays;
  return {
    dragging,
    days,
    phrase: dragging ? 'a week well above your usual load' : null,
  };
}

function evaluateSubjective(s: ConvergenceSeries): { dragging: boolean; days: number; phrase: string | null } {
  const dragging = s.subjectiveWreckedOnEasy;
  return {
    dragging,
    days: dragging ? 1 : 0,
    phrase: dragging ? 'an easy run that read harder than it was' : null,
  };
}

/* ────────────────────────── The rule ─────────────────────────────────── */

/**
 * Grade one morning's evidence.
 *
 * Pure and total: same inputs, same verdict, always. No clock is read — the
 * runner's own date has already been applied by the caller in assembling the
 * series and the context.
 */
export function gradeConvergence(
  series: ConvergenceSeries,
  context: ConvergenceContext,
): ConvergenceVerdict {
  const evaluated: Array<{ domain: ConvergenceDomain; r: { dragging: boolean; days: number; phrase: string | null } }> = [
    { domain: 'autonomic', r: evaluateAutonomic(series) },
    { domain: 'cardiac', r: evaluateCardiac(series) },
    { domain: 'sleep', r: evaluateSleep(series) },
    { domain: 'load', r: evaluateLoad(series) },
    { domain: 'subjective', r: evaluateSubjective(series) },
  ];

  // Research/15 §"Establishing a baseline" · "Minimum 14 days of data before
  // drawing conclusions." A day-one runner has no personal normal, so every
  // deviation is measured against nothing. The domains are still evaluated and
  // reported (the working is useful) but NOTHING counts.
  const coldStart = series.baselineDays < CONVERGENCE.minBaselineDays;

  const domains: DomainVerdict[] = evaluated.map(({ domain, r }) => {
    const suppressedBy = coldStart
      ? (r.dragging ? 'no baseline yet' : null)
      : (r.dragging ? suppressionFor(domain, context) : null);
    return {
      domain,
      dragging: r.dragging,
      daysSustained: r.days,
      suppressedBy,
      counts: r.dragging && suppressedBy == null,
      phrase: r.phrase,
    };
  });

  const converging = domains.filter((d) => d.counts).map((d) => d.domain);

  const grade: ConvergenceGrade =
    coldStart ? 'green'
      : converging.length >= CONVERGENCE.redMinDomains ? 'red'
        : converging.length >= CONVERGENCE.amberMinDomains ? 'amber'
          : 'green';

  const suppressed = domains.filter((d) => d.dragging && d.suppressedBy != null);
  const rationale = coldStart
    ? `cold start · ${series.baselineDays} of ${CONVERGENCE.minBaselineDays} baseline days`
    : [
      `${converging.length} converging: ${converging.join(', ') || 'none'}`,
      suppressed.length > 0
        ? `suppressed: ${suppressed.map((d) => `${d.domain} (${d.suppressedBy})`).join(', ')}`
        : null,
    ].filter(Boolean).join(' · ');

  return { grade, converging, domains, rationale };
}

/* ────────────────────────── Coach voice ──────────────────────────────── */

/**
 * What the runner is told.
 *
 * Design brief v2 · short, direct, no hype, no exclamation marks, no emoji,
 * no em dashes. And the rule that matters most here, which is the owner's own
 * line: HE MUST NEVER BE SCOLDED. A product that moralises about a six-hour
 * night is one he deletes. So this copy states what was observed and what
 * changed, and stops. It does not tell him to go to bed earlier, it does not
 * say the word "should", and it does not congratulate him either.
 *
 * It names the CONVERGENCE, not the metric. "Three short nights and your
 * resting heart rate is up" is a thing a person can check against their own
 * week. "HRV z-score -1.8" is a number about a number.
 */
export function convergenceCopy(
  verdict: ConvergenceVerdict,
  change: { from: string; to: string; movedTo: string | null } | null,
): string | null {
  if (verdict.grade === 'green') return null;

  const phrases = convergencePhrases(verdict);
  if (phrases.length === 0) return null;
  return convergenceCopyFromPhrases(
    phrases,
    verdict.grade === 'amber' ? null : change,
  );
}

/**
 * The counting domains' phrases, in READ ORDER — fixed and human, not the
 * evaluation order: the things a person can check against their own week come
 * first. It matches the shape of the owner's own example, "three days of poor
 * sleep and an elevated resting heart rate", which leads on sleep and closes
 * on heart rate.
 *
 * Exported so the adaptation layer can carry them on the trigger's evidence
 * and re-author the line once it knows which session actually changed —
 * without a second copy of the wording living over there.
 */
export function convergencePhrases(verdict: ConvergenceVerdict): string[] {
  const READ_ORDER: ConvergenceDomain[] = ['sleep', 'autonomic', 'cardiac', 'load', 'subjective'];
  return READ_ORDER
    .map((k) => verdict.domains.find((d) => d.domain === k))
    .filter((d): d is DomainVerdict => d != null && d.counts && d.phrase != null)
    .map((d) => d.phrase as string);
}

/**
 * THE ONE PLACE THE SENTENCE IS BUILT. Everything that tells the runner about
 * a convergence comes through here, so the voice cannot fork.
 */
export function convergenceCopyFromPhrases(
  phrases: string[],
  change: { from: string; to: string; movedTo: string | null } | null,
): string | null {
  if (phrases.length === 0) return null;

  // RULE TWO, enforced where the sentence is actually made.
  //
  // The three-domain floor was a property of the CALLERS: `gradeConvergence`
  // only grades red at `redMinDomains`, and `adapt.ts` only downgrades on red.
  // But this function took a bare `string[]`, so handed one surviving phrase
  // and a non-null `change` it would cheerfully write "Three short nights.
  // Today is easy running instead." — a session change blamed on one signal,
  // in the one composer whose whole job is to make that impossible.
  //
  // `convergenceWhy` in lib/plan/adapt.ts reads `phrases` back out of a
  // persisted evidence blob, so a truncated or legacy row is exactly how you
  // get there. A sentence that ANNOUNCES A CHANGE needs the convergence that
  // licensed it; without one there is no honest sentence to write, and null
  // is the correct answer. Observation-only copy (`change == null`) keeps its
  // lower bar — saying "your sleep is short, today stands as written" off one
  // domain is a fact, not a verdict.
  if (change != null && phrases.length < CONVERGENCE.redMinDomains) return null;

  // "a, b and c" · sentence case, no serial comma before "and".
  const list = phrases.length === 1
    ? phrases[0]
    : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
  const observation = list.charAt(0).toUpperCase() + list.slice(1) + '.';

  if (change == null) {
    // Informs and stops. No instruction, no plan change, no lecture.
    return `${observation} Today stands as written.`;
  }

  const moved = change.movedTo != null
    ? ` The ${change.from} moves to ${change.movedTo}.`
    : ` The ${change.from} comes back when the numbers do.`;
  return `${observation} Today is ${change.to} instead.${moved}`;
}
