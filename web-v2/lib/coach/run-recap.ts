/**
 * lib/coach/run-recap.ts · "WHAT THIS RUN DID" post-run engine.
 *
 * Takes a completed canonical run + its planned-workout intent + the
 * conditions it ran in, returns 1-2 sentences of plain English about
 * what the stimulus actually was. Heat-aware: when conditions explain
 * a slowdown or HR drift, the recap honors that instead of judging
 * the runner against an impossible pace target.
 *
 * Doctrine sources:
 *   · Research/04-workout-vocabulary.md · per-type expectations
 *   · Research/06-weather-adjustments.md · heat-adjusted honest pace
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

function paceLabel(spm: number | null | undefined): string | null {
  if (!spm || spm <= 0) return null;
  // Round to whole seconds FIRST, then split — rounding spm%60 on its own
  // rolls 59.6s to "60" and prints "6:60/mi" instead of carrying to 7:00.
  const total = Math.round(spm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/mi`;
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
  slowdownPct: number,
  avgHr: number | null,
  terrain: RecapInput['terrain'],
): { fact: string | null; adjTarget: number | null } {
  const clean = (reps ?? []).filter((p) => typeof p === 'number' && p > 0);
  if (!targetSPerMi || clean.length < 2) {
    return { fact: null, adjTarget: targetSPerMi ?? null };
  }
  // Research/06 §2 (interval-vs-continuous rule): rep-based work with ≥1:1
  // work:rest gets HALF the continuous heat slowdown — recovery jogs allow
  // partial cooling, so reps don't slow as much as a steady effort would.
  // Adjust the rep target by the halved amount; still surface the heat framing
  // whenever it's genuinely warm (keyed on the full slowdown), so a hot day
  // still reads "heat-adjusted" even though the magnitude is halved.
  const repSlowdownPct = slowdownPct / 2;
  // 2026-08-17 · THIS IS THE ONLY PLACE IN THE RECAP WHERE TWO CONDITIONS
  // STACK. Heat and hills both make the same target pace harder to hit, and
  // two independent code paths each "helpfully" forgiving the day is how one
  // hot hilly run gets forgiven twice. Research/01 §Combined conditions says
  // multiply, so composeEffortFactor multiplies — once, here.
  const combined = composeEffortFactor({
    heatSlowdownPct: repSlowdownPct,
    gradeFactor: terrainFactor(terrain),
  });
  const adjTarget = Math.round(targetSPerMi * combined.factor);
  const heat = slowdownPct >= 2;
  const hills = combined.grade > 1.001;
  const targetPhrase = heat && hills
    ? `the ~${paceLabel(adjTarget)} the heat and the hills allowed`
    : heat
      ? `the heat-adjusted ~${paceLabel(adjTarget)}`
      : hills
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
  const withHr = splits
    .map((s, i) => ({ i, hr: splitHr(s) }))
    .filter((s): s is { i: number; hr: number } => s.hr != null && s.hr > 0);
  if (withHr.length < 4) return null;
  const half = Math.floor(withHr.length / 2);
  const first = withHr.slice(0, half);
  const last = withHr.slice(-half);
  const firstAvg = first.reduce((s, x) => s + x.hr, 0) / first.length;
  const lastAvg = last.reduce((s, x) => s + x.hr, 0) / last.length;
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
  const paced = splits.map(s => splitPaceS(s)).filter((p): p is number => p != null && p > 0);
  if (paced.length < 5) return null;
  const cut = Math.floor(paced.length * 2 / 3);
  const front = paced.slice(0, cut);
  const back = paced.slice(cut);
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
        ? `Hit the target early but faded ${drift}s across the block. Still a solid effort.`
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

export function deriveRecap(input: RecapInput): RecapPayload {
  const payload = deriveRecapCore(input);
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

  // Compose the conditions sentence FIRST when it's material · it
  // changes how we read pace + HR drift.
  const conditionsMaterial = weather?.shouldFlagInRecap === true;
  if (conditionsMaterial && weather) {
    conditions_note = weather.summary;
    if (weather.coachTipForNextTime) coach_tip = weather.coachTipForNextTime;
  }

  // Heat-aware judgment on HR drift + pace fade.
  //
  // 2026-08-17 · gated on the SLOWDOWN, not the band word. `heatBand` is now
  // the Research/06 §3 WBGT risk flag, and risk is the wrong question here:
  // a green-flag 65°F morning is low risk and still drifts a long-run HR by
  // thermoregulation. The 2% gate is the same one heat-band.ts's
  // heatAdjustedStatus and heatAwareDrift use, so the recap prose, the phase
  // bars and the drift chip all change their mind at the same moment.
  const heatExplainsDrift = conditionsMaterial && (weather?.slowdownPct ?? 0) >= 2;

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
    facts.push(`The ${String(declinedBail.label ?? 'bail line').toLowerCase()} tripped and you pushed through · noted, not judged. Watch tomorrow's readiness.`);
  }

  // Voice doctrine (David, 2026-05-31): plain English. No PhD jargon.
  // "mitochondrial / lactate / VO2 / cardiovascular drift" all gone.
  // The science still drives the rules · just not the words.
  switch (input.type) {
    case 'long': {
      const finishMi = input.finishMi ?? 0;
      const hasFinish = finishMi > 0 && input.finishPaceSPerMi != null;
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
        facts.push(
          `Long run done · ${easyMi}mi easy + ${Math.round(finishMi)}mi @ ${label ? `${label} ` : ''}${fPaceStr}${hrPart}.`,
        );
      } else {
        const hrPart = input.actualAvgHr ? ` · avg HR ${input.actualAvgHr}` : '';
        facts.push(
          `Long run done · ${input.actualMi.toFixed(1)} mi${hrPart} · kept it aerobic.`,
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
          fuellingApplies
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
      const lead = `Easy ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}.`;
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
      const hrPart = input.actualAvgHr ? ` · avg HR ${input.actualAvgHr}` : '';
      const leadLine = workPaceStr && input.workDistanceMi
        ? `Tempo done · ${input.workDistanceMi.toFixed(1)} mi @ ${workPaceStr.replace('/mi', '')}${hrPart}.`
        : workPaceStr
          ? `Tempo done · ${workPaceStr} tempo block${hrPart}.`
          : `Tempo done · ${input.actualMi.toFixed(1)} mi total${paceStr ? ' at ' + paceStr : ''}${input.actualAvgHr ? ', avg HR ' + input.actualAvgHr : ''}.`;
      facts.push(leadLine);
      // Execution analysis: how did the work block actually go?
      // Reads work-phase splits vs target — specific to this run.
      const execFact = tempoExecution(input);
      if (execFact) {
        facts.push(execFact);
      }
      if (heatExplainsDrift && weather!.slowdownPct >= 4) {
        facts.push(`Heat was working against the clock today. If your HR was right, the stimulus was right · go by effort.`);
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
      const hrPart = input.actualAvgHr ? ` · HR ${input.actualAvgHr}` : '';
      // The real read: rep-by-rep pacing pattern vs the heat-adjusted target
      // (went out fast · faded · even · built), HR as the guardrail.
      const pacing = intervalPacing(
        input.repPaces ?? [],
        input.plannedPaceSPerMi ?? null,
        weather?.slowdownPct ?? 0,
        input.actualAvgHr ?? null,
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
        const inRange = reps.filter((p) => p >= target - 6 && p <= adj + 4).length;
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
              : `Reps done · ${input.actualMi.toFixed(1)} mi total${paceStr ? ' at ' + paceStr + ' avg' : ''}${input.actualAvgHr ? ', HR ' + input.actualAvgHr : ''}.`;
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

    case 'recovery':
    case 'shakeout': {
      facts.push(`Recovery jog · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}. Just blood flow. Box checked.`);
      return {
        verdict: 'Legs cleared.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'race': {
      facts.push(`Race · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}${input.actualAvgHr ? ', avg HR ' + input.actualAvgHr : ''}.`);
      return {
        verdict: 'Raced it.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    default: {
      facts.push(`Logged · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}.`);
      return {
        verdict: 'Logged.',
        facts,
        coach_tip,
        conditions_note,
      };
    }
  }
}
