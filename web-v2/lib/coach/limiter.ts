/**
 * The limiter · "what is actually preventing this goal?"
 *
 * `Design/adaptive-progression-engine.md` §11. The prescription model (System C)
 * takes a limiter as an input and the engine has never produced one, so every
 * prescription reached for the only lever it knew about: pace. Rule 2 of the
 * same doctrine says progression is not pace progression, and rule 11 ends
 * "Do not simply make every workout faster." Without a limiter there was nothing
 * else to reach for.
 *
 * The visible symptom was `lib/plan/goal-gap.ts` `whatClosesIt[]`, which
 * returned hardcoded prose — "Threshold density is the lever · 2 quality
 * days/week vs current 1" — to every runner regardless of whether threshold was
 * their problem. That string is where this module's output belongs.
 *
 * Pure, like `lib/adaptation/adaptation-model.ts`. Callers assemble a
 * `LimiterInput` from readers that already exist and get a ranked read back. No
 * I/O, no database, no clock.
 *
 * ## The signal that does the most work
 *
 * The SHAPE of a runner's race-time curve across distances, not its level.
 * Research/02 §7 records McMillan's classification, which is a limiter
 * diagnosis in all but name: a runner whose short-distance form outruns their
 * long-distance form is endurance-limited, and the reverse is speed-limited.
 * Doctrine gives it as a fitted Riegel exponent, and Research/02 §6 gives the
 * formula for fitting one from two races: `b = ln(T2/T1) / ln(D2/D1)`.
 *
 * That is the only signal here that separates limiters by itself. Everything
 * else corroborates, narrows, or contradicts.
 *
 * ## Four rules that shape the design
 *
 * 1 · **A wrong limiter is worse than no limiter.** It sends the whole
 *     prescription down the wrong road for a block. So where evidence is
 *     consistent with more than one limiter, this module ranks both and drops
 *     `confidence` rather than picking the more interesting one. The caller is
 *     expected to treat `low` as "use the goal-distance default lever".
 *
 * 2 · **Absence of evidence is not evidence** (inherited from System B). A
 *     runner with no HR strap and one race is not limiter-free; they are
 *     unreadable. They get the goal-distance default at low confidence, never a
 *     confident diagnosis built out of nothing.
 *
 * 3 · **Every observation carries its own context filter** (CLAUDE.md, locked
 *     2026-05-19 round 4). A surface-level guard does not protect sub-findings.
 *     Decoupling measured in heat is inflated by a known amount and is filtered
 *     per observation, not per diagnosis — see `DECOUPLING_HEAT_ARTIFACT_PCT`.
 *
 * 4 · **Say what cannot be distinguished.** Three pairs are genuinely
 *     entangled with the data this app collects, and each is named at the point
 *     where the ambiguity arises rather than papered over:
 *
 *     · `aerobic_capacity` vs `threshold` — both are LEVEL limiters, not SHAPE
 *       limiters. The performance curve cannot separate them, because a runner
 *       short of goal at every distance has the same curve shape whether the
 *       ceiling is VO2max or lactate clearance. Separating them needs a graded
 *       exercise test or a vVO2max field test, neither of which exists here.
 *       So `aerobic_capacity` is never diagnosed from evidence — it is assigned
 *       only as the goal-distance default where doctrine says aerobic capacity
 *       dominates the event, and never above `medium` confidence.
 *
 *     · `endurance` vs `durability` — a late fade is the symptom of both. The
 *       discriminator is whether the AEROBIC system gave out with it. Fade with
 *       high decoupling is the aerobic engine running out (endurance); fade with
 *       clean decoupling and dropping cadence is the chassis failing while the
 *       engine holds (durability). With no HR data the two cannot be split, and
 *       both are ranked.
 *
 *     · `training_volume` vs `recovery_capacity` — a runner under-volumed
 *       because they cannot absorb more looks exactly like a runner under-
 *       volumed because of their calendar. Volume alone reads as
 *       `training_volume`; only independent recovery evidence promotes it to
 *       `recovery_capacity`.
 */
import {
  TIER_TARGETS,
  distanceCategoryOf,
  classifyGoalTier,
  type DistCategory,
  type ExperienceLevelInput,
} from '@/lib/plan/goal-tiers';
import { DECOUPLING_PROTOCOL_MIN_MINUTES } from '@/lib/training/aerobic-decoupling';

/** The seven limiters `Design/adaptive-progression-engine.md` §11 names. */
export type Limiter =
  | 'aerobic_capacity'
  | 'threshold'
  | 'speed_reserve'
  | 'endurance'
  | 'durability'
  | 'training_volume'
  | 'recovery_capacity';

export interface RankedLimiter {
  limiter: Limiter;
  /** 0..1. How far past its trigger the evidence sits, not how bad the runner
   *  is. Used for ordering, not for display. */
  severity: number;
  /** What was actually observed, in falsifiable terms. */
  evidence: string[];
}

export interface LimiterRead {
  primary: Limiter;
  /** Ranked, because runners usually have more than one. */
  ranked: RankedLimiter[];
  confidence: 'high' | 'medium' | 'low';
  /** The levers this limiter says to progress, in order. Doctrine §11 table. */
  levers: string[];
  /** One plain line for the coach voice — what is actually holding the goal back. */
  summary: string;
}

/* ------------------------------------------------------------------ inputs */

/**
 * One race or race-effort performance, used to fit the curve. Provenance
 * matters here: per CLAUDE.md's race-data lock, a performance curve is a
 * fitness claim, so these must come from `races.actual_result` (or curated
 * `meta.finishTime`) and never from auto-detected Strava best-effort segments —
 * a 5K split inside a long run is not a 5K race and would bend the curve toward
 * a speed bias the runner does not have.
 *
 * KNOWN LIMITATION the caller owns: the fit assumes both performances were run
 * at comparable effort. A maximal A race paired with a jogged C-race tune-up
 * fits an exponent that describes the runner's RACE SELECTION, not their
 * physiology. Nothing in this module can detect that, because a soft effort and
 * a genuine weakness look identical in a finish time. Callers with race
 * priority available should prefer A and B efforts.
 */
export interface PerformancePoint {
  distanceMi: number;
  finishSeconds: number;
  /** Days ago. Two performances far apart in time describe two different
   *  runners, so the fit requires both inside the freshness window. */
  ageDays: number;
  /** True for watch-auto-logged results not yet confirmed by a chip time.
   *  Still real efforts, but they cost the read a confidence notch. */
  provisional?: boolean;
}

/**
 * One long run or race with enough detail to ask whether the runner faded, and
 * whether the aerobic system faded with them.
 */
export interface FadeObservation {
  distanceMi: number;
  /** Back third vs front two thirds, s/mi. Positive = faded. From
   *  `detectPaceFade` (`lib/coach/run-recap.ts`) — module-private today, so the
   *  caller passes the computed number rather than importing it. */
  lateFadeSecPerMi: number | null;
  /** Pa:HR decoupling for the same effort, percent. From
   *  `computeAerobicDecoupling` (`lib/training/aerobic-decoupling.ts`). Null
   *  when the run had no usable HR — which is the case that makes endurance and
   *  durability inseparable, not a case that means "fine". */
  decouplingPct: number | null;
  /** Elapsed running time for the effort, seconds. Research/03 §12's
   *  interpretation table — the source of `DECOUPLING_ENDURANCE_GAP_PCT` — is
   *  stated for "a steady aerobic run (60–90 min)", so a decoupling reading off
   *  a shorter effort is outside the table it would be graded against.
   *
   *  Optional because a `decouplingPct` produced by `computeAerobicDecoupling`
   *  already satisfies the protocol duration by construction. Supply it when
   *  the drift came from anywhere else, and a short effort's reading is then
   *  held back from the endurance finding rather than accusing the runner's
   *  aerobic base for being brief. */
  durationSec?: number | null;
  /** From `computeCadenceFatigue` (`lib/training/cadence-fatigue.ts`). A
   *  cadence that breaks down under fatigue is a mechanical read, and it is the
   *  signal that separates durability from endurance when HR is present. */
  cadence: 'sustained' | 'fading' | 'breaking' | null;
  /** Context filters, applied per observation per CLAUDE.md. Heat inflates
   *  decoupling by a known amount; a hard course invalidates a pace fade
   *  entirely because the fade is the terrain. */
  heatConfounded?: boolean;
  courseConfounded?: boolean;
}

export interface LimiterInput {
  /* --- the goal ---------------------------------------------------------- */
  /** Required. Without a goal there is nothing to be limited relative to. */
  goalDistanceMi: number | null;
  /** Goal finish pace, s/mi. Selects the tier whose volume band the runner is
   *  measured against. Null falls back to the experience level alone. */
  goalPaceSecPerMi: number | null;
  experienceLevel?: ExperienceLevelInput;
  /** 0..1 through the training block. Volume below the tier floor is normal
   *  early and a finding late, so the volume check is gated on this. Null is
   *  treated as unknown and the check needs the deeper shortfall to fire. */
  blockProgressFraction: number | null;

  /* --- the performance curve --------------------------------------------- */
  /** Curated race results, any order. From `bestRecentVdot().considered` filtered
   *  to `source: 'race'`, or straight off the races table. */
  performances: PerformancePoint[] | null;

  /* --- fade / decoupling -------------------------------------------------- */
  fadeObservations: FadeObservation[] | null;

  /* --- threshold ---------------------------------------------------------- */
  /** Threshold pace at the start and end of the observed window, s/mi, and how
   *  long the window was. Stagnant T-pace while volume climbs is the classic
   *  threshold-limited signature. */
  thresholdPaceStartSecPerMi: number | null;
  thresholdPaceNowSecPerMi: number | null;
  thresholdWindowWeeks: number | null;
  /** Weekly mileage at the start and end of the same window. */
  weeklyMiAtWindowStart: number | null;

  /* --- volume ------------------------------------------------------------- */
  /** Recent weekly mileage. From `recentWeeklyMileageMi` (`lib/runs/volume.ts`). */
  recentWeeklyMi: number | null;

  /* --- recovery ----------------------------------------------------------- */
  /** Observed days the runner actually needed before the next quality session
   *  landed well, paired with the stimulus that preceded it. Compared against
   *  the gap doctrine prescribes. */
  observedHardDayGaps: Array<{ stimulus: 'threshold' | 'vo2max' | 'long_race_pace'; daysTaken: number }> | null;
  /** Consecutive recent sessions where prescribed paces could not be hit at the
   *  usual HR/RPE. Doctrine's strongest single performance indicator of
   *  incomplete recovery. */
  sessionsMissingPacesInARow: number | null;
}

/* -------------------------------------------------------------- constants */

/**
 * McMillan's neutral band, read off Research/02 §7.1's "Combo runner" row.
 *
 * A fitted Riegel exponent inside this band means the runner's curve follows
 * the reference curve and there is no SHAPE limiter to find — which is a real
 * finding, not a failure. Above it the runner fades faster than the reference
 * with distance (doctrine's "Speedster": endurance-limited). Below it they hold
 * pace better than the reference (doctrine's "Endurance monster": speed-limited).
 */
export const CURVE_NEUTRAL_EXPONENT_BAND: [number, number] = [1.06, 1.08];

/**
 * Minimum ratio between the two distances used to fit the exponent.
 *
 * NOT a physiological constant and deliberately carries no doctrine claim — it
 * is numerical conditioning. `b = ln(T2/T1)/ln(D2/D1)` divides by `ln(D2/D1)`,
 * so two nearby distances make the denominator small and the fitted exponent
 * explodes on a few seconds of timing noise.
 *
 * 1.8 admits the pairs runners actually have — half-to-marathon and 5K-to-10K
 * are both ratio 2.0, and 10K-to-half is 2.1 — while rejecting the pairs where
 * the denominator stops carrying the fit: half-to-30K (1.4), marathon-to-50K
 * (1.2), and any two runnings of adjacent road distances.
 */
export const MIN_CURVE_DISTANCE_RATIO = 1.8;

/** Both performances must sit inside this window, or the fit is describing two
 *  different runners. Matches `VDOT_FULL_VALUE_DAYS` in `lib/training/vdot.ts`,
 *  which is the window the rest of the engine treats a result as current for. */
export const CURVE_FRESHNESS_DAYS = 56;

/**
 * Pa:HR decoupling at which Research/03 §12 stops calling the aerobic system
 * adequate and names an endurance gap outright: "Endurance gap; build base
 * before progressing". The floor of that row, read out of the doc.
 *
 * 2026-08-19 · THIS ROW IS DURATION-SCOPED, AND THE SCOPE IS NOW ENFORCED.
 * §12 states its instrument before it states its table — "Compare first vs.
 * second half of a steady aerobic run (60–90 min)" — so every row of that
 * table, this one included, describes what drift means on a run of about that
 * length. Applying 8% to a 40-minute effort quotes the table outside its own
 * scope: §2's confounder row scopes cardiac drift to ">30 min steady" and puts
 * its magnitude at "+5–15% over 60 min", so a short effort has not had the
 * time to develop the drift the row is describing and a reading off one means
 * something else entirely.
 *
 * The scope is held in two places, deliberately. `computeAerobicDecoupling`
 * now refuses to produce a number at all below `DECOUPLING_PROTOCOL_MIN_MINUTES`,
 * so every `decouplingPct` reaching this file from the engine already satisfies
 * it by construction; and `FadeObservation.durationSec` lets a caller with
 * another source of drift state the duration explicitly, which is checked
 * below. CLAUDE.md's per-finding rule is why both exist rather than one: an
 * upstream guard is not a guarantee about a sub-finding's own inputs.
 */
export const DECOUPLING_ENDURANCE_GAP_PCT = 8;

/**
 * How much of a decoupling reading heat can manufacture on its own — the top of
 * Research/03 §12's "Heat adds 2-5% artifactually" clause. A heat-confounded
 * observation must clear the endurance-gap threshold by this much before it is
 * allowed to accuse the runner's aerobic base, because otherwise the finding is
 * about the weather. This is the per-observation context filter CLAUDE.md
 * requires: the parent diagnosis having a heat guard would not protect this
 * sub-finding.
 */
export const DECOUPLING_HEAT_ARTIFACT_PCT = 5;

/**
 * The gap doctrine prescribes between a given stimulus and the next hard day,
 * from Research/00b §In-Week Recovery. A runner who consistently needs longer
 * than this is not lazy and not under-trained — their recovery capacity is the
 * constraint on how much training they can be given.
 */
export const HARD_DAY_GAP_DAYS: Record<'threshold' | 'vo2max' | 'long_race_pace', number> = {
  threshold: 1,
  vo2max: 2,
  long_race_pace: 2,
};

/** Research/00b §Warning Signs: "Can't hit prescribed paces at usual HR/RPE for
 *  2+ workouts", noted there as the strongest single performance indicator of
 *  incomplete recovery. */
export const INCOMPLETE_RECOVERY_WORKOUTS = 2;

/**
 * How far under the tier's peak volume band a runner may sit AT THE START of a
 * block before the shortfall stops being the plan working and starts being
 * evidence · §4 of the diagnosis below.
 *
 * Was the boolean `volNow < floor * 0.7`. Rule 9 (2026-08-30) turned it into
 * the head of a ramp: it is the shortfall the phase is expected to explain at
 * block progress 0, decaying to zero by `PROGRESS_FULLY_LATE`.
 */
export const DEEP_SHORTFALL_FRACTION = 0.30;

/**
 * The point in a block by which no volume shortfall is explained by phase any
 * more · was the boolean `progress >= 0.5`. From here on the finding's severity
 * is the original `shortfall × 1.6`.
 */
export const PROGRESS_FULLY_LATE = 0.5;

/**
 * Where the curve is flat and nothing else fires, the limiter defaults to
 * whatever doctrine says dominates the event — Research/00a §Training Intensity
 * Distribution, "When each TID applies". 5K/10K is one row there and its
 * rationale names aerobic capacity; the half and the marathon both name LT2;
 * the ultra is prescribed HVLIT, which is pure aerobic base building.
 *
 * This is a DEFAULT, not a diagnosis. It is what the prescription model should
 * reach for in the absence of evidence, and it never carries high confidence.
 */
// Keys are quoted throughout, including the ones that are valid identifiers.
// `_doctrine_lint.test.ts` finds distance-keyed tables by scanning for `'cat':`
// and cannot see a bare `hm:` — an unquoted key is a row the copied-category
// lint silently stops watching.
export const DEFAULT_LIMITER: Record<DistCategory, Limiter> = {
  '5k': 'aerobic_capacity',
  '10k': 'aerobic_capacity',
  'hm': 'threshold',
  'm': 'threshold',
  'ultra': 'endurance',
};

/**
 * The levers each limiter says to progress, in order.
 *
 * The first four rows are `Design/adaptive-progression-engine.md` §11's own
 * table, kept in its order. The remaining three are filled from Research/ as
 * the brief requires rather than invented:
 *
 *   · `aerobic_capacity` — Research/00a §"The Seven Workout Categories" #6,
 *     which prescribes 2-6 min intervals (3-5 min accruing the most time above
 *     90% VO2max), 15-30 min of total interval work, once a week in the
 *     specific phase. Duration and total work before pace, same shape as the
 *     threshold row.
 *   · `durability` — Research/00a #4 (long run: "Fatigue resistance, glycogen
 *     depletion adaptation") and #7 (race-specific: long blocks at goal pace
 *     inside a long run), plus Research/11's back-to-back long runs.
 *   · `recovery_capacity` — Research/00b §"What to Cut First", which is an
 *     explicit priority order, read in reverse: what to protect is the last
 *     thing it says to cut.
 */
export const LEVERS: Record<Limiter, string[]> = {
  threshold: [
    'Threshold duration · extend the time at threshold before touching the pace',
    'Threshold density · more of the week at threshold, same effort',
    'Threshold pace · last, once the duration is being absorbed',
  ],
  endurance: [
    'Long-run duration · the single biggest lever on aerobic ceiling',
    'Aerobic volume · easy miles across the week, not harder ones',
    'Long threshold blocks · sustained work inside a long run',
    'Race-specific durability · goal-pace blocks late in the long run',
  ],
  speed_reserve: [
    'Strides · 4-8 after easy runs, relaxed, full recovery',
    'Short intervals · 200-400m at repetition pace, full recovery',
    'VO2max work · 3-5 min intervals once the short work is established',
  ],
  training_volume: [
    'Run frequency · another day on the feet before another hard day',
    'Easy volume · lengthen the easy runs, hold the effort down',
    'Long-run consistency · the same long run every week beats a big one monthly',
  ],
  aerobic_capacity: [
    'Interval duration · 3-5 min reps accrue the most time above 90% VO2max',
    'Total interval work · build toward 15-30 min of work in the session',
    'Interval pace · last, once the volume of work is being absorbed',
  ],
  // Ordered cheapest-adaptation-first per §2's lever list, which puts duration
  // and volume ahead of race_specificity and goal_pace_exposure. The race-pace
  // block is the last thing added, not the first — the fatigue has to be there
  // before the pace demand means anything.
  durability: [
    'Long-run duration under fatigue · time on feet is the adaptation',
    'Medium-long midweek run · aerobic strength under fatigue without long-run cost',
    'Back-to-back long days · the specific fatigue-resistance stimulus',
    'Race-pace blocks late in the long run · fatigue first, then the pace demand',
  ],
  recovery_capacity: [
    'Widen the gap between hard days before adding any stimulus',
    'Cut the second quality session before cutting volume',
    'Protect sleep · the highest-return recovery input there is',
    'Hold the cutback cadence · the first cutback skipped is when risk climbs',
  ],
};

/* --------------------------------------------------------------- helpers */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Fit Riegel's exponent from two performances · Research/02 §6:
 * `b = ln(T2/T1) / ln(D2/D1)`.
 *
 * Returns null when the pair is too close in distance to fit against (see
 * `MIN_CURVE_DISTANCE_RATIO`) or either input is not a real performance.
 */
export function fitRiegelExponent(a: PerformancePoint, b: PerformancePoint): number | null {
  const [short, long] = a.distanceMi <= b.distanceMi ? [a, b] : [b, a];
  if (!(short.distanceMi > 0) || !(short.finishSeconds > 0)) return null;
  if (!(long.distanceMi > 0) || !(long.finishSeconds > 0)) return null;
  const dRatio = long.distanceMi / short.distanceMi;
  if (dRatio < MIN_CURVE_DISTANCE_RATIO) return null;
  const tRatio = long.finishSeconds / short.finishSeconds;
  if (tRatio <= 1) return null; // the longer race was not slower · not a curve
  return Math.log(tRatio) / Math.log(dRatio);
}

/** The widest-separated fresh pair, which gives the fit the most leverage. */
function pickCurvePair(points: PerformancePoint[]): [PerformancePoint, PerformancePoint] | null {
  const fresh = points.filter(
    (p) => p.ageDays <= CURVE_FRESHNESS_DAYS && p.distanceMi > 0 && p.finishSeconds > 0,
  );
  let best: [PerformancePoint, PerformancePoint] | null = null;
  let bestRatio = 0;
  for (let i = 0; i < fresh.length; i++) {
    for (let j = i + 1; j < fresh.length; j++) {
      const lo = Math.min(fresh[i].distanceMi, fresh[j].distanceMi);
      const hi = Math.max(fresh[i].distanceMi, fresh[j].distanceMi);
      const ratio = lo > 0 ? hi / lo : 0;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = [fresh[i], fresh[j]];
      }
    }
  }
  return bestRatio >= MIN_CURVE_DISTANCE_RATIO ? best : null;
}

function paceStr(secPerMi: number): string {
  const m = Math.floor(secPerMi / 60);
  const s = Math.round(secPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

/* ------------------------------------------------------------- diagnosis */

/** Accumulates severity and evidence per limiter without letting one signal
 *  silently overwrite another's. */
class Findings {
  private map = new Map<Limiter, RankedLimiter>();

  add(limiter: Limiter, severity: number, evidence: string): void {
    const cur = this.map.get(limiter);
    if (cur) {
      // Two signals agreeing is stronger than either alone, but the scale stays
      // bounded — a limiter cannot rank above 1 by accumulating weak evidence.
      cur.severity = clamp(cur.severity + severity * (1 - cur.severity), 0, 1);
      cur.evidence.push(evidence);
    } else {
      this.map.set(limiter, { limiter, severity: clamp(severity, 0, 1), evidence: [evidence] });
    }
  }

  ranked(): RankedLimiter[] {
    return [...this.map.values()].sort((a, b) => b.severity - a.severity);
  }
}

/**
 * Diagnose what is holding the goal back.
 *
 * Returns null only when there is no goal distance to reason about. Everything
 * else degrades: a runner we cannot see gets the goal-distance default at low
 * confidence, which is the honest answer and also the safe one, because the
 * default lever is the one doctrine says suits the event.
 */
export function diagnoseLimiter(input: LimiterInput): LimiterRead | null {
  const goalMi = input.goalDistanceMi;
  if (goalMi == null || !(goalMi > 0)) return null;

  const cat = distanceCategoryOf(goalMi);
  const f = new Findings();
  /** Signals that were readable at all · drives confidence. */
  let dimensionsRead = 0;
  /** Set when a signal was read but could not be attributed to one limiter. */
  let ambiguous = false;
  let curveRestsOnProvisional = false;

  /* ── 1 · the performance curve ─────────────────────────────────────────
   * The only signal here that separates limiters on its own. Everything below
   * either corroborates it or fills in where it is silent. */
  const pair = input.performances ? pickCurvePair(input.performances) : null;
  const b = pair ? fitRiegelExponent(pair[0], pair[1]) : null;
  if (pair && b != null) {
    dimensionsRead++;
    curveRestsOnProvisional = pair.some((p) => p.provisional === true);
    const [lo, hi] = CURVE_NEUTRAL_EXPONENT_BAND;
    const shorter = pair[0].distanceMi <= pair[1].distanceMi ? pair[0] : pair[1];
    const longer = pair[0].distanceMi <= pair[1].distanceMi ? pair[1] : pair[0];
    const shape = `${shorter.distanceMi.toFixed(1)}mi and ${longer.distanceMi.toFixed(1)}mi form a curve at ${b.toFixed(3)}`;
    if (b > hi) {
      // Speedster. Short form outruns long form · the aerobic side is the gap.
      f.add('endurance', clamp((b - hi) / 0.05, 0.15, 1), `${shape} · doctrine's neutral band tops out at ${hi}`);
    } else if (b < lo) {
      // Endurance monster. Long form outruns short form · top end is the gap.
      f.add('speed_reserve', clamp((lo - b) / 0.03, 0.15, 1), `${shape} · doctrine's neutral band starts at ${lo}`);
    }
    // Inside the band there is deliberately no finding. A curve that follows
    // the reference curve is real evidence that no SHAPE limiter exists — it
    // says nothing about the LEVEL, which is why it does not suppress the
    // level-limiter checks below.
  }

  /* ── 2 · fade and decoupling ───────────────────────────────────────────
   * Per-observation context filters, per CLAUDE.md. Each observation resolves
   * its own heat and course context before contributing. */
  const fades = input.fadeObservations ?? [];
  if (fades.length > 0) {
    const decouplings: number[] = [];
    let durabilityHits = 0;
    let enduranceHits = 0;
    let ambiguousFades = 0;

    for (const o of fades) {
      /* Duration · Research/03 §12's table is stated for a 60-90 min steady
       * run, so a stated-short effort's drift is not a reading that table can
       * grade. Unknown duration passes: the engine's only producer of
       * `decouplingPct` enforces the protocol duration itself. */
      const durationKnownShort =
        o.durationSec != null &&
        Number.isFinite(o.durationSec) &&
        o.durationSec < DECOUPLING_PROTOCOL_MIN_MINUTES * 60;

      // Decoupling · heat inflates it by a known amount, so a heat-confounded
      // reading must clear the threshold by the artifact before it counts.
      if (o.decouplingPct != null && !durationKnownShort) {
        const threshold = o.heatConfounded
          ? DECOUPLING_ENDURANCE_GAP_PCT + DECOUPLING_HEAT_ARTIFACT_PCT
          : DECOUPLING_ENDURANCE_GAP_PCT;
        if (o.decouplingPct >= threshold) {
          decouplings.push(o.decouplingPct);
          enduranceHits++;
        }
      }

      // Pace fade · worthless on a confounded course, where the fade is the
      // terrain rather than the runner. Never a primary signal on its own: it
      // only routes when something else says whether the aerobic system held.
      const faded = !o.courseConfounded && o.lateFadeSecPerMi != null && o.lateFadeSecPerMi > 0;
      if (!faded) continue;

      /* A stated-short effort's drift cannot say the aerobic system HELD
       * either — the table that would clear it is out of scope in both
       * directions. Such an observation is treated exactly like a run with no
       * HR at all: consistent with durability AND endurance, and said to be. */
      const aerobicHeld =
        o.decouplingPct != null &&
        !durationKnownShort &&
        o.decouplingPct <
          (o.heatConfounded ? DECOUPLING_ENDURANCE_GAP_PCT + DECOUPLING_HEAT_ARTIFACT_PCT : DECOUPLING_ENDURANCE_GAP_PCT);
      const mechanical = o.cadence === 'fading' || o.cadence === 'breaking';

      if (aerobicHeld && mechanical) {
        // The engine held and the chassis did not. This is durability.
        durabilityHits++;
      } else if ((o.decouplingPct == null || durationKnownShort) && mechanical) {
        // Cadence broke down but we cannot see whether HR did. Consistent with
        // durability AND with endurance · rank both, and say so.
        durabilityHits++;
        ambiguousFades++;
      }
      // A fade with high decoupling is already counted as endurance above.
      // A fade with nothing else attached is deliberately dropped: it is
      // consistent with every limiter here and with simply going out too fast.
    }

    if (enduranceHits > 0 || durabilityHits > 0) dimensionsRead++;

    if (enduranceHits > 0) {
      const m = mean(decouplings);
      f.add(
        'endurance',
        clamp((m - DECOUPLING_ENDURANCE_GAP_PCT) / 6, 0.2, 1),
        `aerobic decoupling averaging ${m.toFixed(1)}% across ${enduranceHits} long efforts · doctrine calls ${DECOUPLING_ENDURANCE_GAP_PCT}% an endurance gap`,
      );
    }
    if (durabilityHits > 0) {
      f.add(
        'durability',
        clamp(durabilityHits / Math.max(1, fades.length), 0.2, 1),
        ambiguousFades === durabilityHits
          ? `pace and cadence fell away late in ${durabilityHits} of ${fades.length} long efforts, with no HR to say whether the aerobic system went with them`
          : `pace and cadence fell away late in ${durabilityHits} of ${fades.length} long efforts while heart rate stayed in band`,
      );
      if (ambiguousFades > 0) {
        ambiguous = true;
        // The honest consequence: an unattributable fade is evidence for
        // endurance too, at the same strength, so neither wins by default.
        f.add(
          'endurance',
          clamp(ambiguousFades / Math.max(1, fades.length), 0.15, 0.6),
          'the same late fades are equally consistent with an aerobic ceiling · no HR data to separate them',
        );
      }
    }
  }

  /* ── 3 · threshold stagnation ──────────────────────────────────────────
   * Threshold pace flat while volume climbed. Inferred, not measured: the same
   * pattern is produced by a block that simply had no threshold work in it, so
   * this signal is capped and never carries the read alone. */
  const tStart = input.thresholdPaceStartSecPerMi;
  const tNow = input.thresholdPaceNowSecPerMi;
  const weeks = input.thresholdWindowWeeks;
  const volStart = input.weeklyMiAtWindowStart;
  const volNow = input.recentWeeklyMi;
  if (tStart != null && tNow != null && weeks != null && weeks >= 4) {
    dimensionsRead++;
    const gainedSec = tStart - tNow; // positive = got faster
    const volumeClimbed = volStart != null && volNow != null && volNow > volStart * 1.05;
    if (gainedSec <= 0 && volumeClimbed) {
      f.add(
        'threshold',
        clamp(-gainedSec / 20 + 0.35, 0.35, 0.85),
        `threshold pace has not moved in ${weeks} weeks (${paceStr(tStart)} to ${paceStr(tNow)}) while weekly volume rose from ${Math.round(volStart!)} to ${Math.round(volNow!)} mi`,
      );
    }
  }

  /* ── 4 · training volume against the tier the goal implies ──────────────
   * Read off TIER_TARGETS rather than a number of this module's own, so the
   * bar is the same one the plan is actually built to. */
  if (volNow != null && volNow > 0) {
    dimensionsRead++;
    const tier = classifyGoalTier(input.goalPaceSecPerMi, goalMi, input.experienceLevel);
    const floor = TIER_TARGETS[cat][tier].peakWeeklyMileageBand[0];
    const progress = input.blockProgressFraction;
    // Being under the PEAK band early in a block is the plan working, not a
    // limiter. Fire late in the block, or at any point if the shortfall is
    // deeper than any phase justifies.
    //
    // ── Rule 9 (2026-08-30) · this was two booleans and a severity floor ────
    //
    //   lateInBlock   = progress >= 0.5
    //   deepShortfall = volNow < floor * 0.7
    //   if (volNow < floor && (lateInBlock || deepShortfall))
    //     f.add(..., clamp(shortfall * 1.6, 0.2, 1), ...)
    //
    // Measured: early in a block, a runner at 70.1% of the floor got NOTHING
    // and one at 69.9% got a 0.4825-severity finding — for a tenth of a mile.
    // And 0.4480 for two thousandths of block progress. `Findings.ranked()`
    // sorts by severity and the top limiter is the lever the whole block's
    // prescription reaches for, so a finding materialising at 0.48 can displace
    // the incumbent and send the prescription down a different road.
    //
    // The fix is the sentence directly above, taken literally: some shortfall
    // is EXPECTED this early, so subtract what the phase justifies and let only
    // the excess be evidence. The same two constants become the ends of a ramp
    // rather than two switches — the expected shortfall falls from
    // DEEP_SHORTFALL_FRACTION at the start of the block to zero by
    // PROGRESS_FULLY_LATE. An unknown progress keeps the old posture: it is
    // treated as the start of the block, so only a deep shortfall carries.
    //
    // From halfway on the expected shortfall is zero, so severity is
    // `shortfall * 1.6` — the original formula exactly, minus its 0.2 floor.
    // The floor had to go: a finding that cannot be weak cannot fade in, and
    // that floor is what turned the firing boundary into an output cliff.
    const progressT = progress == null ? 0 : clamp(progress / PROGRESS_FULLY_LATE, 0, 1);
    const expectedShortfall = DEEP_SHORTFALL_FRACTION * (1 - progressT);
    const shortfall = volNow < floor ? (floor - volNow) / floor : 0;
    const unexplained = shortfall - expectedShortfall;
    if (unexplained > 0) {
      f.add(
        'training_volume',
        clamp(unexplained * 1.6, 0, 1),
        `running ${Math.round(volNow)} mi/wk against a ${floor} mi/wk floor for this goal`,
      );
    }
  }

  /* ── 5 · recovery capacity ─────────────────────────────────────────────
   * Only promotes over training_volume when there is INDEPENDENT recovery
   * evidence · a runner short on volume is not thereby short on recovery. */
  const gaps = input.observedHardDayGaps ?? [];
  const missed = input.sessionsMissingPacesInARow;
  if (gaps.length > 0 || missed != null) {
    dimensionsRead++;
    const overruns = gaps.filter((g) => g.daysTaken > HARD_DAY_GAP_DAYS[g.stimulus]);
    if (overruns.length > 0 && overruns.length >= gaps.length / 2) {
      const worst = Math.max(...overruns.map((g) => g.daysTaken - HARD_DAY_GAP_DAYS[g.stimulus]));
      f.add(
        'recovery_capacity',
        clamp(worst / 4, 0.25, 1),
        `needing ${worst} day${worst === 1 ? '' : 's'} longer than prescribed between hard sessions on ${overruns.length} of ${gaps.length}`,
      );
    }
    if (missed != null && missed >= INCOMPLETE_RECOVERY_WORKOUTS) {
      f.add(
        'recovery_capacity',
        clamp(missed / 5, 0.3, 1),
        `${missed} sessions running where prescribed paces would not come at the usual effort`,
      );
    }
  }

  /* ── verdict ───────────────────────────────────────────────────────────── */
  const ranked = f.ranked();

  if (ranked.length === 0) {
    // Nothing fired. Either the runner has no limiter we can see, or the curve
    // sat inside the neutral band and nothing else was readable. Both answer
    // the same way: the lever doctrine gives the event, held at low confidence.
    const primary = DEFAULT_LIMITER[cat];
    return {
      primary,
      ranked: [],
      confidence: dimensionsRead >= 3 && b != null ? 'medium' : 'low',
      levers: LEVERS[primary],
      summary:
        b != null
          ? 'Nothing in the training reads as a single physiological limiter. Your race times track the reference curve, so the work is to keep progressing the stimulus the event asks for.'
          : 'Not enough evidence yet to say what is holding the goal back. Training to the demands of the distance until there is.',
    };
  }

  const primary = ranked[0].limiter;

  /* Confidence.
   *
   * `high` needs the curve — it is the only signal that separates limiters on
   * its own — plus corroboration from a second dimension, plus a clear margin
   * over the runner-up. Anything less tops out at medium.
   *
   * `aerobic_capacity` is capped at medium wherever it appears, because it is
   * not separately identifiable from `threshold` with this data (see header). */
  const runnerUp = ranked[1]?.severity ?? 0;
  const margin = ranked[0].severity - runnerUp;
  let confidence: LimiterRead['confidence'];
  if (b != null && dimensionsRead >= 3 && margin >= 0.25 && !ambiguous) confidence = 'high';
  else if (dimensionsRead >= 2 && margin >= 0.1) confidence = 'medium';
  else confidence = 'low';

  // Ambiguity must not read as certainty. A runner-up sitting on the primary's
  // shoulder means the evidence did not choose, whatever the ordering says.
  if (margin < 0.1 && ranked.length > 1) confidence = 'low';
  if (ambiguous && confidence === 'high') confidence = 'medium';
  if (curveRestsOnProvisional && confidence === 'high') confidence = 'medium';
  if (primary === 'aerobic_capacity' && confidence === 'high') confidence = 'medium';

  return {
    primary,
    ranked,
    confidence,
    levers: LEVERS[primary],
    summary: summarise(primary, ranked, confidence),
  };
}

/**
 * The one line a coach surface renders. Observation, then what it means for the
 * next block. No praise, no scold, no exclamation marks, no em dashes.
 */
function summarise(primary: Limiter, ranked: RankedLimiter[], confidence: LimiterRead['confidence']): string {
  const lead = ranked[0]?.evidence[0] ?? '';
  const hedge = confidence === 'low' ? 'The likeliest read is that ' : '';
  const body: Record<Limiter, string> = {
    endurance: 'your aerobic ceiling is what the goal is waiting on, not your speed',
    speed_reserve: 'your top end is the constraint, not your endurance',
    threshold: 'threshold is the constraint · the time you can hold at threshold, before the pace',
    aerobic_capacity: 'aerobic power is the constraint the distance asks about',
    durability: 'holding form late is the constraint, not the aerobic engine',
    training_volume: 'the volume underneath the training is the constraint',
    recovery_capacity: 'what you can recover from is setting the ceiling on what you can train',
  };
  const tail =
    ranked.length > 1 && ranked[0].severity - ranked[1].severity < 0.1
      ? ` ${ranked[1].limiter.replace(/_/g, ' ')} reads almost as strongly, so treat this as the first place to look rather than a settled answer.`
      : '';
  return `${hedge}${hedge ? body[primary] : body[primary].charAt(0).toUpperCase() + body[primary].slice(1)}. ${lead ? lead.charAt(0).toUpperCase() + lead.slice(1) + '.' : ''}${tail}`.replace(/\s+/g, ' ').trim();
}
