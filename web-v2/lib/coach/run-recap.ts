/**
 * lib/coach/run-recap.ts · "WHAT THIS RUN DID" post-run engine.
 *
 * Takes a completed canonical run + its planned-workout intent + the
 * conditions it ran in, returns 1-2 sentences of plain English about
 * what the stimulus actually was. Heat-aware for HR only: when heat
 * explains an HR rise, the recap says so instead of reading it as
 * fitness fade — it never adjusts, widens, or displays a pace target
 * for heat. The runner paces off feel and conditions on the day.
 *
 * Doctrine sources:
 *   · Research/04-workout-vocabulary.md · per-type expectations
 *   · Research/06-weather-adjustments.md · heat as an HR confounder
 *   · Research/15-wearable-data.md · cardiovascular drift signal
 *   · Research/00a-distance-running-training.md · stimulus vs prescription
 *
 * Output shape (matches PurposePayload so consumers can share renderer):
 *   {
 *     verdict:  string,         // "Long run done." / "Tempo done." / ...
 *     facts:    string[],       // 1-2 plain-English sentences on what landed
 *     coach_tip: string | null, // forward-looking advice when warranted
 *     conditions_note: string | null,  // null when neutral
 *   }
 *
 * Voice doctrine (David, 2026-05-31): plain runner-English, no PhD jargon
 * ("mitochondrial / cardiovascular drift / lactate threshold" all gone),
 * and citations are NOT in the output. The science is in the rules · it's
 * not in the words.
 */
import type { Phase, WorkoutType } from '@/lib/coach/run-purpose';
import { ranAboveThresholdBand } from '@/lib/training/threshold-band';
import {
  judgeWeather,
  type WeatherInput,
  type WeatherJudgment,
} from '@/lib/coach/weather-adjust';
import { composeEffortFactor } from '@/lib/terrain/grade-adjust';
import type { RunTerrain } from '@/lib/terrain/run-terrain';
import { reconcilePaceWithClock } from '@/lib/runs/run-shape';
import { miNum, fmtPaceSlash } from '@/lib/format/run';
import type { ReadingScopes } from '@/lib/coach/reading-scope';
import { expectedDaysForAnchor } from '@/lib/coach/recovery-phase';

/**
 * Minutes of running below which `Research/18` prescribes no fuelling at all,
 * so fuel cannot be the cause of anything the recap observes.
 *
 * The doc says it three ways and lands on the same number: the CHO definition
 * calls it the "Primary fuel for endurance running >60 min"; §8's training-vs-
 * racing table opens with "Easy run <60 min | Water only | No fueling stimulus
 * needed"; and §"Hourly intake by exercise duration" carries a literal "0" in
 * the g/hr column for its shortest row before reaching a real target at 1 hr.
 *
 * Bound by `FUELLING.attribution-duration-floor` in lib/doctrine/registry.ts.
 */
export const FUELLING_RELEVANT_MIN_MINUTES = 60;

export interface RecapInput {
  type: WorkoutType;
  phase: Phase | null;
  plannedMi: number;
  /** Plan-side target pace (s/mi). null when by-feel. */
  plannedPaceSPerMi?: number | null;
  /** Plan-side HR cap (bpm). null when by-feel. */
  plannedHrCap?: number | null;
  /** Actual canonical-row execution. */
  actualMi: number;
  actualPaceSPerMi: number | null;
  /** Elapsed running time, seconds. Optional · derived from
   *  `actualMi × actualPaceSPerMi` when absent, which is what every existing
   *  caller relied on implicitly. Used to decide whether a long run was long
   *  enough for `Research/18`'s fuelling guidance to apply at all. */
  actualDurationSec?: number | null;
  /** Work-phase avg pace (s/mi) derived from watch completion phases.
   *  When present, replaces whole-run avg in tempo/threshold copy.
   *  Absent on Strava/cold-start runs — falls back to actualPaceSPerMi. */
  workPaceSPerMi?: number | null;
  /** Sum of work-phase actualDistanceMi from watch completion phases.
   *  When present alongside workPaceSPerMi, formats as "4.0 mi @ 7:18".
   *  Absent when phases carry no distance (falls back to pace-only block). */
  workDistanceMi?: number | null;
  /** Count of completed work phases (reps) from watch completion.
   *  When present, used in intervals lead line: "4 reps @ 6:52".
   *  Absent on Strava/cold-start runs (falls back to total-distance block). */
  repCount?: number | null;
  /** Per-rep actual work pace (s/mi), in rep order. Drives the interval
   *  pacing-pattern read (went out fast · faded · even · built). Absent on
   *  Strava/cold-start runs (the pattern fact is skipped). */
  repPaces?: number[] | null;
  /** Prescribed rep count from the workout spec. When the runner completed
   *  fewer reps than this, the lead line says "3 of 4 reps" instead of
   *  treating the reps run as the whole session. Null when not plan-based. */
  prescribedRepCount?: number | null;
  /** Finish-segment distance (mi) from workout_spec (long runs with HM/M finish). */
  finishMi?: number | null;
  /** Actual finish-segment pace (s/mi). Prefer the isFinishSegment phase's
   *  actualPaceSPerMi; falls back to workout_spec finish_pace_s_per_mi. */
  finishPaceSPerMi?: number | null;
  /** 'HM' | 'M' from the spec — rendered as 'HMP' / 'MP'. */
  finishLabel?: string | null;
  actualAvgHr: number | null;
  actualMaxHr: number | null;
  /**
   * 2026-08-24 · the interval `actualAvgHr` is actually the average of.
   *
   * THE RECAP WAS SAYING THE NUMBER OUT LOUD. Both the tempo and the interval
   * arms interpolated `actualAvgHr` into their lead line — "Tempo done · 4.0 mi
   * @ 6:59 · avg HR 148" — where 148 is the whole run, warm-up and cool-down
   * included, sitting in a sentence otherwise entirely about the work block.
   * The reader has no way to know the two halves of that sentence describe
   * different intervals.
   *
   * Optional. Absent → every arm behaves exactly as before, which is what
   * keeps the existing recap snapshots byte-identical for unstructured runs.
   * See `lib/coach/reading-scope.ts`.
   */
  readings?: ReadingScopes | null;
  /**
   * Mile-by-mile splits with pace + HR per segment when available.
   * 2026-05-31 fix: accept both naming conventions on the wire ·
   * canonical rows store `{mile, hr, pace, cadence, elev_ft}` (Faff watch
   * + Apple Watch shape) while older code paths emit `{mile, avgHr,
   * paceSPerMi}`. detectHrDrift + detectPaceFade coalesce both via the
   * normalizeSplit helper.
   */
  splits?: Array<{
    mile?: number;
    paceSPerMi?: number | null;
    avgHr?: number | null;
    /** Alternate shape: `pace` as "M:SS" string, `hr` as int. */
    pace?: string | null;
    hr?: number | null;
  }>;
  weather?: WeatherInput | null;
  /** 2026-06-09 Phase 2 (3.2) · contingency-rule outcomes recorded by the
   *  watch (runs.data.ruleOutcomes). A taken bail is a decision, not a
   *  failure — the recap says so explicitly instead of grading the
   *  shortened session as a miss. */
  ruleOutcomes?: Array<{
    kind?: string; label?: string; breached?: boolean;
    actionTaken?: boolean; atMi?: number | null;
  }> | null;
  /**
   * 2026-08-17 · terrain, from `lib/terrain/run-terrain.ts`.
   *
   * THE RULE: the recap judges effort against the target on grade-adjusted
   * pace, and prints the pace the runner actually ran. Both numbers appear;
   * they never swap jobs. Absent / null = no terrain signal, and every branch
   * below then behaves byte-identically to the pre-terrain output.
   *
   * A treadmill run arrives here with `surface: 'treadmill'`, which suppresses
   * the outdoor-route framing entirely — a belt is not a hill and it is not a
   * flat road either.
   */
  terrain?: RunTerrain | null;
  /** 2026-08-17 · adaptive voice band (lib/coach/voice-band.ts).
   *  'guided' / null / undefined = default copy, byte-identical to the
   *  pre-band output. 'calibration' softens with a learning frame ·
   *  'challenge' tersens. Word choice only, never structure. */
  voiceBand?: 'calibration' | 'guided' | 'challenge' | null;
  /**
   * 2026-08-24 · THE RACE BEHIND THIS RUN, when there is one close enough to
   * be the reason for what the recap is about to observe.
   *
   * CLAUDE.md, per-finding context filters, locked 2026-05-19 round 4: a
   * surface that aggregates N findings runs N filter applications, one per
   * finding. This engine had no race-recency input at all, so every finding
   * ran unfiltered — and the two findings whose CAUSE a recent race changes
   * are the two a runner reads most in the week after one.
   *
   * The day after a marathon, an easy run whose heart rate sits above its cap
   * read:
   *
   *     Your HR (152) ran past the 145 target. Slow it down next time · easy
   *     days only work when they're actually easy.
   *
   * The observation is true. The instruction is wrong — an elevated easy-day
   * heart rate is what the first days after a race are — and rule four says
   * never scold. Same for a long run's HR drift, which is told to the runner
   * as "usually fuel or water".
   *
   * Absent / null on every existing caller, and the copy is then byte-
   * identical to the pre-filter output.
   */
  daysSinceRace?: number | null;
  /** Distance of that race, miles. Sets the window length — the recovery
   *  band is distance-keyed, and 21 days after a marathon is not the same
   *  claim as 21 days after a 5K. Null leaves the filter off. */
  raceDistanceMi?: number | null;
}

export interface RecapPayload {
  verdict: string;
  facts: string[];
  coach_tip: string | null;
  conditions_note: string | null;
  /** Heat-adjusted work-rep target (s/mi) for interval sessions · lets the
   *  per-rep graph colour against the pace that was actually achievable in
   *  the conditions, not the raw cold-weather number. Null/omitted for
   *  non-interval runs or when there's no target. */
  intervals_adjusted_target_s_per_mi?: number | null;
}

// Citations removed from output payloads (David, 2026-05-31). The
// engine still reads research-grounded rules · the words shown to the
// runner are plain English, not paper-style citations.

/**
 * The terrain factor to judge this run's pace through, or 1 when there is no
 * usable signal.
 *
 * `material` is the gate on the whole thing: below ~4 s/mi the terrain is
 * inside GPS pace noise, and an adjustment smaller than the error it corrects
 * would only add wobble to a verdict. A treadmill with an unrecorded incline
 * returns 1 too — an unknown belt angle is not a flat one, so we decline to
 * adjust and the copy says why instead.
 */
function terrainFactor(t: RecapInput['terrain']): number {
  if (!t || !t.material || t.basis === 'treadmill-incline-unknown') return 1;
  return t.factor > 0 ? t.factor : 1;
}

/**
 * What an observed pace was worth on flat ground in neutral conditions.
 *
 * FOR COMPARISON AGAINST A TARGET, NEVER FOR DISPLAY. Every call site that
 * uses this feeds a `<` or a `-`; every call site that prints a pace uses the
 * raw number. If you ever find this value inside a `paceLabel()` that is
 * shown as "your pace", that is the bug.
 */
function judgedPace(observedSPerMi: number, t: RecapInput['terrain']): number {
  const f = terrainFactor(t);
  return f === 1 ? observedSPerMi : observedSPerMi / f;
}

/**
 * MIGRATED 2026-08-24 · this file's own pace formatter. It was the ONLY one
 * in the repo that rounded to whole seconds before splitting, and its comment
 * is the reason `lib/format/run.ts` does the same for everybody:
 *
 *   "rounding spm%60 on its own rolls 59.6s to 60 and prints 6:60/mi"
 *
 * Its DISTANCE formatting was the other half of the poster-versus-recap
 * split — eight open-coded fixed-one-decimal sites, printing "3.0 mi"
 * beside the poster's "3.1 mi" for one float. Those now call `miNum`.
 */
const paceLabel = fmtPaceSlash;

/**
 * The heart-rate clause for a sentence that is otherwise about the WORK, or
 * nothing at all.
 *
 * Three outcomes, and the third is why this exists rather than a `?? fallback`:
 *
 *   work  · "· HR 165 across the 4 reps" — the number and the interval, in one
 *           breath, so the reader cannot take it for the whole run
 *   whole · "· avg HR 139" — unchanged, because on a run with one intent the
 *           whole-run mean IS the work
 *   none  · **empty string.** `Research/03` §14: `| Reps / R-pace (<2 min) |
 *           Pace | RPE | Ignore HR |`. On reps that short the recorded HR is
 *           the sensor's rise time, and a coach who quotes it is quoting the
 *           lag. Saying nothing is the honest sentence.
 *
 * With no `readings` on the input this returns the pre-2026-08-24 clause
 * verbatim, so every existing caller's output is byte-identical.
 */
/**
 * The heart rate this run is entitled to quote, as a bare number — or null.
 *
 * The counterpart to `hrClause` for the call sites that build their own
 * sentence. Null means REFUSED, never "unknown", so a caller that treats null
 * as "skip the clause" is doing the right thing by construction.
 */
function scopedWorkHr(input: RecapInput): number | null {
  const r = input.readings?.hr;
  if (!r) return input.actualAvgHr ?? null;
  return r.scope === 'none' ? null : r.value;
}

function hrClause(input: RecapInput, opts?: { prefix?: string }): string {
  const prefix = opts?.prefix ?? ' · avg HR ';
  const r = input.readings?.hr;
  if (!r) return input.actualAvgHr ? `${prefix}${input.actualAvgHr}` : '';
  if (r.scope === 'none' || r.value == null) return '';
  if (r.scope === 'whole') return `${prefix}${r.value}`;
  // Work scope · the interval rides with the number, always.
  return `${prefix}${r.value} ${r.note ?? 'on the work'}`;
}

/**
 * A distance clause, or nothing.
 *
 * 2026-08-24 · EVERY LEAD LINE IN THIS FILE INTERPOLATED `miNum(...)`
 * DIRECTLY, and `miNum` returns null for a distance the reader refuses. A
 * template literal writes that null down. The recap route hands this function
 * `runc.distanceMi ?? 0` — the `?? 0` is there because `deriveRecap` takes a
 * non-nullable `actualMi` — so a row whose distance the reconciler declines
 * arrives here as a zero, `miNum` refuses the zero, and the runner reads:
 *
 *     Easy null mi. Run by feel · the right way to take an easy day.
 *
 * Not a crash and not a fabrication, but it is the app failing in front of
 * him, on the screen he opens after every run.
 *
 * Rule three. When there is no distance to state, the sentence says the other
 * true things and leaves the distance out. It never guesses one and it never
 * prints the word null.
 */
function miPhrase(mi: number | null | undefined): string | null {
  const n = miNum(mi);
  return n == null ? null : `${n} mi`;
}

/**
 * Read the rep-by-rep pacing pattern for an interval / cruise session and
 * say what actually happened — judged against the HEAT-ADJUSTED target,
 * not the raw cold-weather number.
 *
 * Research grounding:
 *   · Research/01 · hard reps (I/T) lock to the target within ~±3 s; in
 *     heat you judge against the adjusted pace or by HR, not the raw pace.
 *   · Even / negative splitting is the goal; a positive split (fast early,
 *     slow late) is the classic execution error. HR is the guardrail when
 *     pace drifts.
 *
 * Returns the pattern fact (or null when there isn't enough rep signal)
 * plus the heat-adjusted target so the per-rep graph can colour to it.
 */
function intervalPacing(
  reps: number[],
  targetSPerMi: number | null,
  avgHr: number | null,
  terrain: RecapInput['terrain'],
): { fact: string | null; adjTarget: number | null } {
  const clean = (reps ?? []).filter((p) => typeof p === 'number' && p > 0);
  if (!targetSPerMi || clean.length < 2) {
    return { fact: null, adjTarget: targetSPerMi ?? null };
  }
  // Terrain is the only condition this grades against — heat no longer
  // adjusts a target or a grading band anywhere in this app.
  const combined = composeEffortFactor({
    heatSlowdownPct: 0,
    gradeFactor: terrainFactor(terrain),
  });
  const adjTarget = Math.round(targetSPerMi * combined.factor);
  const hills = combined.grade > 1.001;
  const targetPhrase = hills
    ? `the ~${paceLabel(adjTarget)} the terrain allowed`
    : `the ~${paceLabel(adjTarget)} target`;
  const half = Math.max(1, Math.floor(clean.length / 2));
  const firstHalf = clean.slice(0, half);
  const lastHalf = clean.slice(-half);
  const avg = (a: number[]) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const fAvg = avg(firstHalf);
  const lAvg = avg(lastHalf);
  // Drift (late − early) is the robust signal · it doesn't depend on the
  // exact heat number, only on how the reps moved across the session.
  const drift = lAvg - fAvg; // >0 = slowed (positive split), <0 = built
  const lateVsAdj = lAvg - adjTarget; // >0 = back reps slipped past the adjusted pace
  const hrClause = avgHr && avgHr > 0 ? ` HR ${avgHr} says the effort was right.` : '';

  // Positive split · went out faster than they finished.
  if (drift >= 8) {
    return lateVsAdj <= 8
      // Settled: the back reps landed at/under the pace the heat allowed.
      ? {
          adjTarget,
          fact: `Went out ~${drift}s fast on the first ${firstHalf.length}, then settled into the pace the conditions allowed.${hrClause}`,
        }
      // Faded: the back reps slipped past even the heat-adjusted pace.
      : {
          adjTarget,
          fact: `Went out fast and gave back ~${drift}s across the reps · ${targetPhrase} was the line to hold.${hrClause}`,
        };
  }
  // Negative split · built into it.
  if (drift <= -8) {
    return { adjTarget, fact: `Built into it · the last ${lastHalf.length} were ~${Math.abs(drift)}s quicker. Strong close.` };
  }
  // Even · held the line across the session.
  return { adjTarget, fact: `Even across all ${clean.length} · held the line.${hrClause}` };
}

/** Pull an HR out of a split using either canonical key (`avgHr` or `hr`). */
function splitHr(s: { avgHr?: number | null; hr?: number | null } | undefined): number | null {
  if (!s) return null;
  if (typeof s.avgHr === 'number' && s.avgHr > 0) return s.avgHr;
  if (typeof s.hr === 'number' && s.hr > 0) return s.hr;
  return null;
}

/** Pull a paceSPerMi out of a split, accepting either the integer field
 *  or a "M:SS" formatted pace string. */
function splitPaceS(s: { paceSPerMi?: number | null; pace?: string | null } | undefined): number | null {
  if (!s) return null;
  if (typeof s.paceSPerMi === 'number' && s.paceSPerMi > 0) return s.paceSPerMi;
  if (typeof s.pace === 'string') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.pace.trim());
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  return null;
}

/**
 * Detect cardiovascular drift across the run: did HR climb in the back
 * half while pace held or slowed? Returns {drift, firstHr, lastHr} when
 * we have enough split signal. Research/15 frames this as the canonical
 * heat / dehydration / fatigue marker for steady efforts.
 */
function detectHrDrift(splits: RecapInput['splits']): {
  drift: number;
  firstHr: number;
  lastHr: number;
} | null {
  if (!splits || splits.length < 4) return null;
  /* 2026-08-24 · CUT ON POSITION IN THE RUN, NOT POSITION IN THE SURVIVORS.
   *
   * This compacted to the splits carrying a heart rate and then halved THAT
   * array, so "the back half" meant the back half of whatever survived. A
   * twelve-mile run whose strap dropped after mile six compared miles 1-3
   * against miles 4-6 and reported the result as "by the end". See
   * `detectPaceFade` for the same fix and the sentence it produced.
   *
   * Cutting on the index within the ORIGINAL array keeps the halves meaning
   * what the copy says they mean, and returns null when either half has
   * nothing left to average — which is a refusal, and correct.
   */
  const mid = Math.floor(splits.length / 2);
  const hrs = splits.map((s) => splitHr(s));
  const first: number[] = [];
  const last: number[] = [];
  for (let i = 0; i < splits.length; i++) {
    const hr = hrs[i];
    if (hr == null || hr <= 0) continue;
    (i < mid ? first : last).push(hr);
  }
  // Two per side is the floor the old `withHr.length < 4` gate implied; it
  // just could not enforce which side they came from.
  if (first.length < 2 || last.length < 2) return null;
  const firstAvg = first.reduce((s, x) => s + x, 0) / first.length;
  const lastAvg = last.reduce((s, x) => s + x, 0) / last.length;
  return {
    drift: Math.round(lastAvg - firstAvg),
    firstHr: Math.round(firstAvg),
    lastHr: Math.round(lastAvg),
  };
}

/**
 * Detect back-half pace fade: did the last third of the run slow vs the
 * first two thirds? Returns the slowdown in s/mi.
 */
function detectPaceFade(splits: RecapInput['splits']): number | null {
  if (!splits || splits.length < 5) return null;
  /* 2026-08-24 · "THE LAST THIRD" HAS TO BE THE LAST THIRD OF THE RUN.
   *
   * This dropped the splits with no pace and then took the last third of what
   * was LEFT. On a twelve-mile run whose GPS stopped pacing after mile six,
   * the six survivors compacted to a six-element array and the "last third"
   * became miles 5 and 6 — the middle of the run — reported to the runner as:
   *
   *     The last third was about 60s/mi slower than the rest.
   *     Worth checking your fueling.
   *
   * A real observation, attached to the wrong part of the run, with a cause
   * attached to that. The numbers were all real; the sentence was not.
   *
   * Cutting on the index within the ORIGINAL array fixes the attribution, and
   * an empty side returns null. Rule three: when the back of the run was not
   * paced, there is no back-half read, and saying nothing is the answer.
   */
  const cut = Math.floor(splits.length * 2 / 3);
  const front: number[] = [];
  const back: number[] = [];
  for (let i = 0; i < splits.length; i++) {
    const p = splitPaceS(splits[i]);
    if (p == null || p <= 0) continue;
    (i < cut ? front : back).push(p);
  }
  // The old gate wanted five paced splits before it would speak. Keep the
  // same weight of evidence, now with both sides guaranteed to be represented.
  if (front.length < 3 || back.length < 1 || front.length + back.length < 5) return null;
  const frontAvg = front.reduce((s, x) => s + x, 0) / front.length;
  const backAvg = back.reduce((s, x) => s + x, 0) / back.length;
  return Math.round(backAvg - frontAvg);
}

/**
 * Assess how a tempo / threshold block actually went: pace consistency and
 * vs-target read from the work-phase splits. Returns null when there isn't
 * enough split signal (Strava / cold-start runs with no phase data).
 *
 * Identifies work splits by proximity to workPaceSPerMi — warmup and
 * cooldown are typically 60-90 s/mi slower, so a ±45 s window cleanly
 * separates them from the tempo block.
 */
function tempoExecution(input: RecapInput): string | null {
  const workPace = input.workPaceSPerMi;
  if (!workPace || workPace <= 0) return null;
  const splits = input.splits ?? [];
  if (splits.length < 2) return null;

  const WORK_WINDOW_S = 45;
  const workSplits = splits
    .map(s => splitPaceS(s))
    .filter((p): p is number => p != null && p > 0 && Math.abs(p - workPace) <= WORK_WINDOW_S);
  if (workSplits.length < 2) return null;

  const fastest = Math.min(...workSplits);
  const slowest = Math.max(...workSplits);
  const spread = slowest - fastest;
  const avgWork = Math.round(workSplits.reduce((s, p) => s + p, 0) / workSplits.length);
  // A treadmill with an unrecorded incline has no honest vs-target read; the
  // block's own consistency is still a real observation, so fall through to it.
  const target = judgeableAgainstTarget(input) ? input.plannedPaceSPerMi : null;

  // Even vs faded vs built: compare first and last work split halves.
  const half = Math.max(1, Math.floor(workSplits.length / 2));
  const firstAvg = Math.round(workSplits.slice(0, half).reduce((s, p) => s + p, 0) / half);
  const lastAvg  = Math.round(workSplits.slice(-half).reduce((s, p) => s + p, 0) / half);
  const drift = lastAvg - firstAvg; // >0 = faded, <0 = built

  const spreadDesc = spread <= 8 ? 'very even' : spread <= 16 ? 'consistent' : `${spread}s of spread`;

  if (target) {
    // 2026-08-17 · judge the block on what the effort was worth, print what
    // the runner ran. `avgWork` stays raw everywhere it is rendered below;
    // only the vs-target comparison sees the terrain-adjusted value. A tempo
    // up a hill was not "off the target" — it was the target, uphill.
    // Rounded before subtracting · vsTarget is printed as a whole-second gap.
    const vsTarget = Math.round(judgedPace(avgWork, input.terrain)) - target; // + = slower
    if (Math.abs(vsTarget) <= 5) {
      // Right on target — just report consistency
      return drift >= 8
        ? `Hit the target early, faded ${drift}s across the block.`
        : drift <= -8
          ? `Built into it · back half ${Math.abs(drift)}s quicker. ${spreadDesc} overall.`
          : `Work miles landed on the ${paceLabel(target) ?? 'target'} mark · ${spreadDesc} through the block.`;
    } else if (vsTarget < -5) {
      /* Ran under target · which is genuinely ambiguous, and the old copy
       * ("pushed the tempo today") read as approval for whichever it was.
       *
       * Threshold work is bought with time at the intensity where lactate
       * clearance matches production. Running past that pace does not buy more
       * of it — the session ends sooner and costs more. So beating the target
       * is only good news when the heart rate says the runner was still inside
       * the band; otherwise they left the zone the session existed for.
       *
       * Same discriminator the drift monitor uses, from the same module, so
       * the recap and the rebuild decision can never disagree. */
      const under = Math.abs(vsTarget);
      if (ranAboveThresholdBand(input.actualAvgHr, input.plannedHrCap)) {
        return `Ran ${under}s/mi under the target, and the heart rate went with it · that is past threshold, not more of it. Threshold is bought with time at the pace, not by beating it. ${spreadDesc}.`;
      }
      if (input.actualAvgHr != null && input.plannedHrCap != null) {
        return `Ran ${under}s/mi under the target with the heart rate still in the band · that is a soft lead the targets should probably catch up to. Worth a retest before it counts as a new number. ${spreadDesc}.`;
      }
      return `Ran ${under}s/mi under the target · no heart rate to say whether that was fitness or just a hot start. The test is stacking the next eight weeks, not winning today. ${spreadDesc}.`;
    } else if (vsTarget <= 18) {
      // Slightly short — note the gap without being harsh
      return `Work pace averaged ${paceLabel(avgWork)} · ${vsTarget}s/mi off the ${paceLabel(target) ?? 'target'}. ${spreadDesc}.`;
    } else {
      // Significantly short — HR is the honest read.
      // Voice band · default (guided/null) stays byte-identical.
      if (input.voiceBand === 'calibration') {
        return `Tempo pace came in off the ${paceLabel(target) ?? 'target'} · useful calibration, the target tunes from here. ${spreadDesc}.`;
      }
      if (input.voiceBand === 'challenge') {
        return `Short of the ${paceLabel(target) ?? 'target'} · HR is the honest grade. ${spreadDesc}.`;
      }
      return `Tempo pace fell short of the ${paceLabel(target) ?? 'target'} · HR is the honest grade here. ${spreadDesc}.`;
    }
  }

  // No target — consistency is the story.
  return drift >= 10
    ? `${spread}s between fastest and slowest work mile · faded a bit in the back half.`
    : drift <= -10
      ? `Built into the block · back half ${Math.abs(drift)}s stronger. ${spreadDesc}.`
      : `${workSplits.length} work miles · ${spreadDesc}.`;
}

/**
 * True when a pace-vs-target verdict is honest for this run.
 *
 * False for a treadmill whose incline nobody recorded: the belt speed is
 * known, the effort behind it is not, and "you ran quicker than the easy
 * target" is a claim about effort. Saying nothing beats saying something
 * unfalsifiable — the recap falls back to its by-feel copy and the terrain
 * note explains the gap.
 */
function judgeableAgainstTarget(input: RecapInput): boolean {
  return input.terrain?.basis !== 'treadmill-incline-unknown';
}

/**
 * TRUE when a race is close enough behind this run to be the reason for an
 * elevated heart rate, rather than something the runner did wrong today.
 *
 * The window is `expectedDaysForAnchor('race', distance)` — the SAME
 * distance-keyed band `lib/coach/recovery-phase.ts` reads out of
 * `Research/00b` §"Recovery by Distance", not a second number invented here.
 * A marathon buys three weeks, a 5K buys six days, and the two surfaces
 * cannot come to disagree about which.
 *
 * Applied per finding, never at the top of the function. The distance, the
 * pace, the split spread and the rep pattern are all still reported exactly as
 * measured in this window — a race does not make a run unmeasurable. Only the
 * findings whose stated CAUSE the race changes are reframed.
 */
function inPostRaceWindow(input: RecapInput): boolean {
  const days = input.daysSinceRace;
  const mi = input.raceDistanceMi;
  if (days == null || !Number.isFinite(days) || days < 0) return false;
  if (mi == null || !Number.isFinite(mi) || mi <= 0) return false;
  return days <= expectedDaysForAnchor('race', mi);
}

export function deriveRecap(input: RecapInput): RecapPayload {
  /**
   * THE PACE THIS RECAP MAY SPEAK, checked against the run's own clock before
   * a single sentence is written.
   *
   * This is the function that said it out loud. David's 2026-08-23 run stored
   * an 11.01 mile distance, 5298 seconds on his watch — 8:01/mi, what he ran —
   * and a `paceSPerMi` of 217 that a Strava moving time invented. The recap
   * read the second and told him:
   *
   *   "Easy 11.0 mi at 3:37/mi. A touch quicker than the 9:22/mi easy target."
   *
   * `runPaceSecPerMi` closed that at the READ, and the route that feeds this
   * function goes through it. But `RecapInput` is a plain object: the recap
   * route is not the only caller, `actualDurationSec` sits right there beside
   * the pace, and the surface sweep proved the contradiction walks straight
   * back in through any call site that assembles the input by hand.
   *
   * So the reconciliation happens here too, against the input's own facts.
   * Every fact, verdict and target comparison below is then written off ONE
   * pace, which is the whole point: the recap cannot praise a pace the run's
   * own clock disproves, and it cannot contradict the panel printing the same
   * run two inches above it.
   */
  const honest = reconcilePaceWithClock(input.actualMi, input.actualDurationSec, input.actualPaceSPerMi);
  const reconciled: RecapInput = honest === input.actualPaceSPerMi
    ? input
    : { ...input, actualPaceSPerMi: honest };
  const payload = deriveRecapCore(reconciled);
  // Terrain speaks last. The lead fact is what the runner did; this is the
  // one sentence about what the ground (or the belt) did to it. Only present
  // when the terrain actually changed how the run should be read — a flat
  // road run adds nothing here, which is the overwhelming majority of runs.
  const note = input.terrain?.note ?? null;
  return note ? { ...payload, facts: [...payload.facts, note] } : payload;
}

function deriveRecapCore(input: RecapInput): RecapPayload {
  // E6: pass the workout type so the conditions copy reframes around effort
  // for easy/long/recovery/shakeout (pace-cost framing only for quality/race).
  const weather = input.weather ? judgeWeather({ ...input.weather, workoutType: input.type, phase: 'post' }) : null;
  const drift = detectHrDrift(input.splits);
  const fade = detectPaceFade(input.splits);
  const paceStr = paceLabel(input.actualPaceSPerMi);

  const facts: string[] = [];
  let conditions_note: string | null = null;
  let coach_tip: string | null = null;

  // Whether conditions were material enough to change how HR drift +
  // pace fade get read below. No conditions/pace-cost copy is surfaced —
  // the runner paces off feel, not a heat estimate.
  const conditionsMaterial = weather?.shouldFlagInRecap === true;

  // Heat-aware judgment on HR drift + pace fade.
  //
  // 2026-08-17 · gated on the SLOWDOWN, not the band word. `heatBand` is now
  // the Research/06 §3 WBGT risk flag, and risk is the wrong question here:
  // a green-flag 65°F morning is low risk and still drifts a long-run HR by
  // thermoregulation. The 2% gate is the same one heat-band.ts's
  // heatAdjustedStatus and heatAwareDrift use, so the recap prose, the phase
  // bars and the drift chip all change their mind at the same moment.
  const heatExplainsDrift = conditionsMaterial && (weather?.slowdownPct ?? 0) >= 2;

  // 2026-08-24 · resolved ONCE, applied PER FINDING below. Heat is checked
  // first at every site it matters, because a hot day is the more specific
  // explanation and a runner in the week after a race still runs in weather.
  const postRace = inPostRaceWindow(input);

  // 2026-06-09 Phase 2 (3.2) · a TAKEN bail leads the facts. The runner
  // made the smart call mid-run; the recap must say so before any
  // pace/distance copy reads like a miss. Breached-but-continued gets a
  // quieter note · the engine saw it, the runner chose, both stand.
  const takenBail = (input.ruleOutcomes ?? []).find(
    (o) => (o.kind === 'bail' || o.kind === 'abort') && o.breached === true && o.actionTaken === true,
  );
  const declinedBail = (input.ruleOutcomes ?? []).find(
    (o) => o.kind === 'bail' && o.breached === true && o.actionTaken !== true,
  );
  if (takenBail) {
    facts.push(
      takenBail.kind === 'abort'
        ? `You took the B plan at the checkpoint · that's execution, not surrender. Even splits from there beat a blow-up chasing A.`
        : `You took the bail${takenBail.atMi != null ? ` at mile ${Number(takenBail.atMi).toFixed(0)}` : ''} · smart, not a fail. The stimulus was already banked; forcing the rest buys fatigue, not fitness.`,
    );
  } else if (declinedBail) {
    facts.push(`The ${String(declinedBail.label ?? 'bail line').toLowerCase()} tripped and you pushed through. Watch tomorrow's readiness.`);
  }

  // Voice doctrine (David, 2026-05-31): plain English. No PhD jargon.
  // "mitochondrial / lactate / VO2 / cardiovascular drift" all gone.
  // The science still drives the rules · just not the words.
  switch (input.type) {
    case 'long': {
      const finishMi = input.finishMi ?? 0;
      /* 2026-08-24 · A BREAKDOWN THAT DOES NOT ADD UP IS NOT A BREAKDOWN.
       *
       * `finishMi` is the PRESCRIBED finish segment, off `workout_spec`. The
       * easy portion below is `actualMi − finishMi` clamped at zero, and the
       * finish leg was never clamped at all — so a 20-mile long run with a
       * 6-mile marathon-pace finish, abandoned at mile 3, printed:
       *
       *     Long run done · 0mi easy + 6mi @ MP 6:40 · avg HR 150.
       *
       * Six miles at marathon pace, on a run that covered three. Both halves
       * of the sentence are drawn from real fields and the sum is fiction —
       * the worst of the three outcomes, because the runner cannot tell.
       *
       * A prescribed segment longer than the whole run is proof the segment
       * was not run as prescribed, and nothing on this wire says how much of
       * it was. So the structured line is refused and the plain long-run line
       * states the distance that is actually known. Rule three.
       */
      const finishFitsTheRun = finishMi > 0 && input.actualMi > 0 && finishMi <= input.actualMi;
      const hasFinish = finishFitsTheRun && input.finishPaceSPerMi != null;
      if (hasFinish) {
        // Easy portion = what was ACTUALLY run minus the finish segment, so
        // the breakdown sums to the real distance covered — not plannedMi,
        // which over/under-states the easy miles when the runner ran long/short.
        const easyMi = Math.max(0, Math.round(input.actualMi - finishMi));
        const fPaceStr = paceLabel(input.finishPaceSPerMi!)?.replace('/mi', '') ?? '';
        const rawLabel = String(input.finishLabel ?? '').trim().toUpperCase();
        /* 2026-08-19 · the fallback used to be `|| 'HMP'`, which named a
         * marathoner's own marathon-pace finish "half-marathon pace" every
         * time the spec's `finish_label` was missing — the app telling the
         * runner they ran a pace they did not run, on their key session.
         *
         * There is nothing in the input that says what the segment was when
         * the spec did not say, and the goal race is not on this wire. So the
         * label is simply omitted: the distance and the actual pace are both
         * still printed, and every word of the sentence is true. Naming the
         * zone is a nicety; naming it wrong is a defect. */
        const label = rawLabel === 'HM' ? 'HMP' : rawLabel === 'M' ? 'MP' : rawLabel || null;
        const hrPart = input.actualAvgHr ? ` · avg HR ${input.actualAvgHr}` : '';
        // A leg that rounds to nothing is not a leg. "0mi easy + 6mi @ MP" on
        // a 6.2-mile run reads as a run with no easy portion, which is a
        // different session from the one that happened.
        const easyLeg = easyMi > 0 ? `${easyMi}mi easy + ` : '';
        facts.push(
          `Long run done · ${easyLeg}${Math.round(finishMi)}mi @ ${label ? `${label} ` : ''}${fPaceStr}${hrPart}.`,
        );
      } else {
        const hrPart = input.actualAvgHr ? ` · avg HR ${input.actualAvgHr}` : '';
        const miPart = miPhrase(input.actualMi);
        facts.push(
          `Long run done${miPart ? ` · ${miPart}` : ''}${hrPart} · kept it aerobic.`,
        );
      }
      /* 2026-08-19 · FUEL IS A CAUSE ONLY ONCE THE RUN IS LONG ENOUGH TO HAVE
       * ONE. Both branches below used to blame fuelling on ANY long run — a
       * 5K-focused runner's 5-mile, 45-minute long run included. `Research/18`
       * §"Hourly intake by exercise duration" puts the carbohydrate target at
       * "<45 min | 0", §8 says "Easy run <60 min | Water only | No fueling
       * stimulus needed", and the section's own definition line calls CHO the
       * "Primary fuel for endurance running >60 min". Telling that runner to
       * eat earlier prescribes against doctrine and, worse, misdiagnoses: a
       * 45-minute HR climb is pace, heat or fitness, never glycogen.
       *
       * This is the same contradiction as `run-purpose.ts`'s `isShortBlock`
       * gap, on the post-run side. Below the threshold the observation still
       * gets reported — the runner should know their HR climbed — with the
       * cause left open instead of asserted wrongly. */
      const runDurationSec = input.actualDurationSec != null && input.actualDurationSec > 0
        ? input.actualDurationSec
        : (input.actualPaceSPerMi != null && input.actualPaceSPerMi > 0
            ? input.actualMi * input.actualPaceSPerMi
            : null);
      const fuellingApplies =
        runDurationSec == null || runDurationSec >= FUELLING_RELEVANT_MIN_MINUTES * 60;

      if (drift && drift.drift >= 8) {
        if (heatExplainsDrift) {
          facts.push(
            `Your HR climbed ${drift.drift} bpm by the end (${drift.firstHr} → ${drift.lastHr}). That's normal in heat like this · the body works harder to cool itself, not because you're slowing down.`,
          );
        } else if (postRace) {
          // PER-FINDING FILTER. Fuel is the usual cause of a long-run HR
          // climb and it is the wrong one this week: the aerobic system is
          // still carrying a race. Naming fuel here sends the runner to fix
          // something that is not broken.
          facts.push(
            `Your HR climbed ${drift.drift} bpm by the end (${drift.firstHr} → ${drift.lastHr}). Expected this soon after the race · the legs are still paying it back.`,
          );
        } else if (fuellingApplies) {
          facts.push(
            `Your HR climbed ${drift.drift} bpm by the end (${drift.firstHr} → ${drift.lastHr}). Usually fuel or water · try eating something earlier and drinking more next time.`,
          );
        } else {
          facts.push(
            `Your HR climbed ${drift.drift} bpm by the end (${drift.firstHr} → ${drift.lastHr}). On a run this short that's effort, not fuel · start the next one easier and see if it settles.`,
          );
        }
      }
      if (fade && fade > 25 && !heatExplainsDrift) {
        facts.push(
          postRace
            // PER-FINDING FILTER, again on the CAUSE and not on the number.
            ? `The last third was about ${fade}s/mi slower than the rest. Normal this close to the race · the endurance comes back last.`
            : fuellingApplies
              ? `The last third was about ${fade}s/mi slower than the rest. Worth checking your fueling.`
              : `The last third was about ${fade}s/mi slower than the rest. Too short to be fuel · that's a pacing read, so go out closer to the pace you can hold.`,
        );
      }
      return {
        verdict: 'Long run done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'easy': {
      // Read the run, not a platitude (David 2026-06-12). Easy pace is a
      // range, so compare actual to the easy target and say what happened:
      // honest-easy, a touch quick (the one easy-day mistake worth flagging),
      // or relaxed. Falls back to a by-feel line when there's no target pace.
      const easyMiPart = miPhrase(input.actualMi);
      const lead = easyMiPart
        ? `Easy ${easyMiPart}${paceStr ? ' at ' + paceStr : ''}.`
        : `Easy run${paceStr ? ' at ' + paceStr : ''}.`;
      const easyTgt = input.plannedPaceSPerMi ?? null;
      const easyAct = input.actualPaceSPerMi ?? null;
      if (easyTgt && easyAct && judgeableAgainstTarget(input)) {
        // 2026-08-17 · `lead` above already printed the REAL pace. The verdict
        // below is about effort, so it reads the grade-adjusted value: an easy
        // run up a hill is not "relaxed and well inside easy" just because the
        // clock was slow, and a net-downhill easy run that felt effortless
        // should not be praised for a pace gravity handed over.
        const delta = Math.round(judgedPace(easyAct, input.terrain)) - easyTgt; // + slower
        if (delta < -25) {
          // Voice band · default (guided/null) stays byte-identical.
          if (input.voiceBand === 'calibration') {
            facts.push(`${lead} A touch quicker than the ${paceLabel(easyTgt)} easy target. Early days · the target settles as we learn your easy.`);
          } else if (input.voiceBand === 'challenge') {
            facts.push(`${lead} Quicker than the ${paceLabel(easyTgt)} easy target. Keep easy easy.`);
          } else {
            // 2026-08-21 · rule four. Was "Fine, but easy days bank the most
            // when you let them stay genuinely easy." Two problems in one
            // sentence: "Fine, but" is a grade dressed as a concession, and
            // "when you let them" puts the shortfall on the runner. The fact
            // is about easy days, not about him.
            facts.push(`${lead} A touch quicker than the ${paceLabel(easyTgt)} easy target. Easy days bank the most when they stay genuinely easy.`);
          }
        } else if (delta > 45) {
          facts.push(`${lead} Relaxed and well inside easy · exactly what these days are for.`);
        } else {
          facts.push(`${lead} Right in the easy range. That's the aerobic work, no cost.`);
        }
      } else {
        facts.push(`${lead} Run by feel · the right way to take an easy day.`);
      }
      if (input.plannedHrCap && input.actualAvgHr && input.actualAvgHr > input.plannedHrCap + 5) {
        if (heatExplainsDrift) {
          facts.push(`Your HR (${input.actualAvgHr}) ran a bit above the ${input.plannedHrCap} target, but it was hot · effort was right.`);
        } else if (postRace) {
          // PER-FINDING FILTER. The reading stands; the instruction does not.
          // An easy-day heart rate sitting above its cap is what the days
          // after a race are, and telling the runner to slow down implies he
          // did something wrong. Rule four: never scold.
          facts.push(`Your HR (${input.actualAvgHr}) sat above the ${input.plannedHrCap} target. That is the race still in the legs, not the pace.`);
        } else {
          facts.push(`Your HR (${input.actualAvgHr}) ran past the ${input.plannedHrCap} target. Slow it down next time · easy days only work when they're actually easy.`);
        }
      }
      return {
        verdict: 'Easy done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'tempo':
    case 'threshold': {
      const workPaceStr = paceLabel(input.workPaceSPerMi);
      // Scoped, not whole-run: the two halves of this sentence described
      // different intervals and nothing said so.
      const hrPart = hrClause(input);
      /* THE WORK BLOCK IS PART OF THE RUN, NOT LONGER THAN IT (2026-08-24).
       *
       * `workDistanceMi` is the sum of the work phases' `actualDistanceMi`
       * from the watch completion, and nothing checked it against the run it
       * decomposes. Same shape as the long-run finish leg, in the tempo arm:
       * a phase set carrying a target distance for a rep the runner did not
       * reach, or a rep counted twice by a merge, prints "Tempo done · 8 mi @
       * 6:52" on a five-mile run — two real fields whose sum is fiction.
       *
       * No canonical row does this today (55 watch completions, none), which
       * is exactly why it is worth pinning now: the finish leg did not either,
       * until it did. When the block does not fit the run, the pace is still
       * true and is still printed; only the distance claim is dropped.
       */
      const workMiFits = input.workDistanceMi != null && input.actualMi > 0
        ? input.workDistanceMi <= input.actualMi + 0.05
        : input.actualMi <= 0 ? false : true;
      const workMiPart = workMiFits ? miPhrase(input.workDistanceMi) : null;
      const tempoMiPart = miPhrase(input.actualMi);
      const leadLine = workPaceStr && workMiPart
        ? `Tempo done · ${workMiPart} @ ${workPaceStr.replace('/mi', '')}${hrPart}.`
        : workPaceStr
          ? `Tempo done · ${workPaceStr} tempo block${hrPart}.`
          : `Tempo done${tempoMiPart ? ` · ${tempoMiPart} total` : ''}${paceStr ? ' at ' + paceStr : ''}${hrClause(input, { prefix: ', avg HR ' })}.`;
      facts.push(leadLine);
      // Execution analysis: how did the work block actually go?
      // Reads work-phase splits vs target — specific to this run.
      const execFact = tempoExecution(input);
      if (execFact) {
        facts.push(execFact);
      }
      return {
        verdict: 'Tempo done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'intervals': {
      const workPaceStr = paceLabel(input.workPaceSPerMi);
      // Same fix as the tempo arm, and it bites harder here: on a rep session
      // the whole-run HR is the mean of hard reps and slow jogs. On reps under
      // two minutes the clause disappears entirely rather than shrinking.
      const hrPart = hrClause(input, { prefix: ' · HR ' });
      // The real read: rep-by-rep pacing pattern vs the heat-adjusted target
      // (went out fast · faded · even · built), HR as the guardrail.
      const pacing = intervalPacing(
        input.repPaces ?? [],
        input.plannedPaceSPerMi ?? null,
        // "HR 165 says the effort was right" is a claim about the REPS, so it
        // has to be the reps' heart rate. It was the whole run's, which on a
        // session with three jog recoveries is a materially lower number and
        // therefore made the effort look easier than it was. Null when the
        // reps are too short for HR to mean anything — the clause then drops.
        scopedWorkHr(input),
        input.terrain,
      );
      // Lead with the RESULT, not the prescription: how many reps landed in
      // the acceptable range (same band as the per-rep graph · prescribed
      // target − 6 to heat-adjusted + 4). Falls back to a plain "reps done"
      // line only when there's no per-rep signal (Strava / cold-start).
      const reps = (input.repPaces ?? []).filter((p) => typeof p === 'number' && p > 0);
      const target = input.plannedPaceSPerMi ?? null;
      const adj = pacing.adjTarget ?? target;
      const prescribed = input.prescribedRepCount ?? null;
      const avgPart = workPaceStr ? ` · ${workPaceStr.replace('/mi', '')} avg` : '';
      let leadLine: string;
      if (prescribed && reps.length >= 1 && reps.length < prescribed) {
        // Missed reps (or stopped early) · the completion is the headline,
        // not the pace. Covers "didn't finish" for rep-based sessions.
        leadLine = `Did ${reps.length} of ${prescribed} reps${avgPart}${hrPart}.`;
      } else if (reps.length >= 2 && target && adj) {
        /* 2026-08-24 · THE BAND WAS EXCLUDING EVERY POSSIBLE PACE.
         *
         * `target - 6` to `adj + 4` was written when the only adjustment was
         * heat, which can only ever make a target SLOWER, so `adj >= target`
         * held and the interval was well ordered. Terrain arrived later and
         * goes the other way: a net-downhill session gets `adj < target`, and
         * once the run is downhill enough that `adj + 4 < target - 6` the
         * "band" is an empty interval. Not a narrow one — empty. No number
         * satisfies it.
         *
         * A six-mile session down 900 ft, four reps of 399/401/400/402
         * against a 400 target, read:
         *
         *     0 of 4 reps in range · HR 160.
         *     Even across all 4 · held the line. HR 160 says the effort was right.
         *
         * Two sentences in one payload, and the first is false for any rep
         * the runner could have run — including one landing exactly on either
         * target.
         *
         * Ordering the bounds keeps both edges doing their job: the fast edge
         * still catches overcooking and the slow edge still forgives the
         * conditions, whichever direction the conditions pushed.
         */
        const lo = Math.min(target, adj) - 6;
        const hi = Math.max(target, adj) + 4;
        const inRange = reps.filter((p) => p >= lo && p <= hi).length;
        leadLine =
          inRange === reps.length
            ? `All ${reps.length} reps in range${avgPart}${hrPart}.`
            : `${inRange} of ${reps.length} reps in range${avgPart}${hrPart}.`;
      } else {
        const repStr = input.repCount ? `${input.repCount} rep${input.repCount !== 1 ? 's' : ''}` : null;
        leadLine = repStr && workPaceStr
          ? `Reps done · ${repStr} @ ${workPaceStr.replace('/mi', '')}${hrPart}.`
          : repStr
            ? `Reps done · ${repStr}${hrPart}.`
            : workPaceStr
              ? `Reps done · ${workPaceStr} work avg${hrPart}.`
              : (() => {
                  const m = miPhrase(input.actualMi);
                  return `Reps done${m ? ` · ${m} total` : ''}${paceStr ? ' at ' + paceStr + ' avg' : ''}${hrClause(input, { prefix: ', HR ' })}.`;
                })();
      }
      facts.push(leadLine);
      facts.push(pacing.fact ?? `Building the top end · these stack.`);
      return {
        verdict: 'Reps done.',
        facts,
        coach_tip,
        conditions_note,
        intervals_adjusted_target_s_per_mi: pacing.adjTarget,
      };
    }

    // ── THREE TYPES THAT REACHED THE DEFAULT ARM AND SAID "LOGGED." ────────
    //
    // `fartlek`, `progression` and `race_week_tuneup` are all in
    // `SESSION_TYPES`, all authored by the generator, all carried through the
    // plan — and all fell off the end of this switch. A runner who executed a
    // race-week tune-up got "Logged · 6.0 mi at 7:18." for a session that is
    // arguably the most consequential one in the block.

    case 'race_week_tuneup': {
      // THE ONE SESSION THAT MUST NOT BE GRADED ON THE CLOCK.
      //
      // `Research/08` §9.4: "'Taper crud' / 'taper madness' — fatigue,
      // sluggish legs, irritability, sleeplessness, phantom pains — is normal.
      // Resist the urge to test fitness. The work is done."
      //
      // And `Research/02` §12.4 on what a race-effort tune-up IS: "Not a
      // quantitative predictor, but a binary go/no-go signal: if the tempo
      // feels redline, the goal is too aggressive." Go/no-go, not a time.
      //
      // So this arm names the work and explicitly declines the inference. A
      // heavy tune-up in taper is a taper artefact until something else says
      // otherwise, and the recap saying so is the difference between a runner
      // arriving confident and a runner arriving worried about a number.
      const workPaceStr = paceLabel(input.workPaceSPerMi);
      const reps = (input.repPaces ?? []).filter((p) => typeof p === 'number' && p > 0);
      const hrPart = hrClause(input, { prefix: ' · HR ' });
      facts.push(
        reps.length >= 2 && workPaceStr
          ? `Sharpener done · ${reps.length} at ${workPaceStr.replace('/mi', '')}${hrPart}.`
          : workPaceStr
            ? `Sharpener done · ${workPaceStr} on the work${hrPart}.`
            : (() => { const m = miPhrase(input.actualMi); return `Sharpener done${m ? ` · ${m}` : ''}${paceStr ? ' at ' + paceStr : ''}${hrPart}.`; })(),
      );
      facts.push('Race week. This was about touching race pace, not testing fitness · heavy legs now are the taper, not a problem.');
      return {
        verdict: 'Sharpener done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'fartlek': {
      // `Research/04` §9: fartlek is "speed play"; the floats are "recovery
      // jogs (not stops)" and the session is run by feel. So the read is the
      // shape across the surges, and there is no pace to miss — these specs
      // carry `by_effort`, and quoting an average pace over a run that
      // alternated 5K effort with jogging would describe neither.
      const surges = (input.repPaces ?? []).filter((p) => typeof p === 'number' && p > 0);
      facts.push(
        surges.length >= 2
          ? (() => { const m = miPhrase(input.actualMi); return m ? `Fartlek done · ${surges.length} surges over ${m}.` : `Fartlek done · ${surges.length} surges.`; })()
          : (() => { const m = miPhrase(input.actualMi); return m ? `Fartlek done · ${m} of mixed effort.` : 'Fartlek done · mixed effort.'; })(),
      );
      if (surges.length >= 4) {
        const half = Math.floor(surges.length / 2);
        const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
        const drift = Math.round(avg(surges.slice(-half)) - avg(surges.slice(0, half)));
        facts.push(
          drift >= 8
            ? `The back surges came in about ${drift}s slower than the front ones. Start a shade easier and the whole set holds.`
            : drift <= -8
              ? 'Built through the set · the last surges were the quickest. That is the one to repeat.'
              : 'Surges held their shape from front to back. That is the session.',
        );
      } else {
        facts.push('Effort session, not a pace session. The variety is the work.');
      }
      return {
        verdict: 'Fartlek done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'progression': {
      // The one session whose whole-run average is guaranteed to describe no
      // part of it: a progression is two intents by design, and its mean sits
      // between them. `Research/00a` §"Long-Run Variations":
      // "| Progression | Start easy; finish at marathon pace or faster |".
      // So the read is the delta between the ends, never the middle.
      const fade = detectPaceFade(input.splits);
      facts.push((() => { const m = miPhrase(input.actualMi); return m ? `Progression done · ${m}.` : 'Progression done.'; })());
      facts.push(
        fade != null && fade <= -15
          ? `Dropped about ${Math.abs(fade)}s/mi from the front third to the back. That is the workout.`
          : fade != null && fade >= 15
            ? `Drifted about ${fade}s/mi slower across the run · a progression wants the other shape. Start easier than feels right.`
            : 'Held pretty even front to back. A progression wants a faster finish than start · leave more in the tank early.',
      );
      return {
        verdict: 'Progression done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'recovery':
    case 'shakeout': {
      {
        const m = miPhrase(input.actualMi);
        facts.push(`Recovery jog${m ? ` · ${m}` : ''}${paceStr ? ' at ' + paceStr : ''}. Just blood flow. Box checked.`);
      }
      return {
        verdict: 'Legs cleared.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'race': {
      {
        const m = miPhrase(input.actualMi);
        facts.push(`Race${m ? ` · ${m}` : ''}${paceStr ? ' at ' + paceStr : ''}${input.actualAvgHr ? ', avg HR ' + input.actualAvgHr : ''}.`);
      }
      return {
        verdict: 'Raced it.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    default: {
      {
        const m = miPhrase(input.actualMi);
        facts.push(`Logged${m ? ` · ${m}` : ''}${paceStr ? ' at ' + paceStr : ''}.`);
      }
      return {
        verdict: 'Logged.',
        facts,
        coach_tip,
        conditions_note,
      };
    }
  }
}
