/**
 * scripts/adaptation-real-replay/build-input.ts · REAL ROWS → THE ENGINE'S
 * INPUT, AT ONE HISTORICAL MOMENT, WITH NOTHING FROM THE FUTURE IN IT.
 *
 * `evaluate.ts` names this file's job as the thing its own gates cannot check:
 *
 *     "They also cannot fail on the input being assembled wrongly. Everything
 *      here is downstream of whoever built the `CanonicalAdaptationInput`, and
 *      a loader that quietly passed a taper week as an ordinary one would
 *      produce confident, well-formed, wrong records."
 *
 * So every judgement this file makes is written down beside the code that makes
 * it, and every judgement it REFUSES to make is recorded in `Diagnostics.
 * couldNotBuild` rather than filled in with a plausible number. Where his real
 * rows cannot support an input, the honest output is `absent(...)` and a line
 * in the diagnostics, not a default.
 *
 * ── NO LOOKAHEAD IS A TYPE, NOT A PREDICATE ────────────────────────────────
 *
 * It used to be one local `before()` closure, `day(iso) < asOf`, applied by
 * hand to every collection, with three attack tests proving after the fact that
 * nobody had forgotten. That is the shape Rule 20 calls a hypothesis: a
 * convention plus a test, where the next person to add a fourth collection has
 * to remember, and nothing stops them if they do not.
 *
 * It is now `asof.ts` and `sealed-history.ts`. This file receives a
 * `SealedHistory`, whose collections have no array surface at all — no
 * `filter`, no `find`, no `length`, no iterator — so the only way to obtain a
 * row is to name a moment. Outcomes come back branded `Evidence<T>` and
 * artifacts branded `Authored<T>`, and the two share no member, so a
 * prescription can never be spent as a result. Prescriptions and week flags are
 * gated by their PLAN's authoring rather than by their own date, which is the
 * axis that actually matters: next Tuesday's prescription is not lookahead, and
 * last Tuesday's prescription written by a plan authored tomorrow is.
 *
 * The three attack tests in `real-replay.test.ts` remain and still pass — no
 * record cites INCLUDED evidence dated on or after its own decision point; the
 * same for EXCLUDED and CONTRADICTORY evidence; and a fabricated spectacular
 * session planted in the future never reaches an earlier decision. They are now
 * a second line rather than the only one. Deleting the old comparison was run
 * and watched — 537 leaks and 40 poison citations — before any of it was
 * trusted, and `_asof_fence.test.ts` falsifies the type-level fence the way a
 * type-level fence has to be falsified, at compile time.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT BE CAUGHT ON ───────────────────────────
 *
 * · A wrong PRESCRIPTION-to-ACTIVITY match. Sessions are matched to plan rows
 *   by calendar date. If he ran Tuesday's tempo on Wednesday, this file grades
 *   Wednesday's easy prescription against a tempo, or drops the tempo entirely.
 *   The real history has at least one such slip and it is named in the report.
 * · A wrong stimulus grade that follows from a wrong segmentation. `phases`
 *   arrives already segmented by the watch and this file trusts it, which is
 *   the same hazard `stimulus.ts` names for itself.
 * · Absolute correctness of the carried belief. The replay seeds the threshold
 *   anchor from the plan's own authored prescription and then carries it
 *   forward under the engine's decisions; if the seed was wrong, every
 *   proposal is wrong by the same offset and nothing here notices.
 */
import {
  measured, absent, failed,
  type CanonicalAdaptationInput, type CapacityBelief, type ComparableThirds,
  type EvaluationBoundary, type GradedSession, type LongRunObservation,
  type Measured, type PaceRepresentativenessFlag, type Provenance,
  type Truncation, type WeekObservation, type CanonicalLever,
  type AuthoredPlanMode,
} from '@/lib/adaptation/canonical/input';
import { gradeStimulus, type StimulusGrade } from '@/lib/adaptation/canonical/stimulus';
import { HEAT_HR_CONFOUNDER } from '@/lib/weather/heat-adjustment';
import { tPaceFromVdot, vdotFromRace } from '@/lib/training/vdot';
import {
  gradeWorkPhase, sessionToleranceSecFor,
} from '@/lib/training/execution-semantics';
import {
  type SnapPhase, type SnapRace, type SnapRun, type SnapSplit, type SnapWeek, type SnapWorkout,
} from './snapshot';
import {
  asOf as asOfOf, narrow, narrowAuthored,
  type AsOf, type Authored, type Evidence,
} from './asof';
import {
  allVisiblePlans, planInForce, sealedHistory,
  type SealedHistory,
} from './sealed-history';

/* ══════════════════════════════════════════════════════════════════════════
 * THE RUNNER, AND THE TWO FACTS THE BRIEF PINS
 * ═══════════════════════════════════════════════════════════════════════ */

export const ATHLETE_ID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** CIM, 6 Dec 2026. From `races.meta`, and from `training_plans.goal_iso`. */
export const RACE = {
  raceDateISO: '2026-12-06',
  raceDistance: 'MARATHON',
} as const;

/** 3:00:00. `authored_state.goal_pace_s_per_mi` is 412 on every plan version. */
export const GOAL = { goalFinishSeconds: 10_800, goalPaceSecPerMi: 412 } as const;

/**
 * The threshold anchor the replay SEEDS from, and why it is this number.
 *
 * The engine carries a belief; it never resolves one. The honest seed for a
 * historical replay is what the runner was actually being asked to run at the
 * first decision point, which is the T target on the plan in force on
 * 2026-06-01: `plan_workouts.pace_target_s_per_mi` = 442 for the 4 Jun tempo,
 * and `workout_spec.tempo_pace_s_per_mi` agrees.
 *
 * Deliberately NOT `authored_state.t_pace_s_per_mi` (407 in June, 394 in
 * August). That field is a goal-BLENDED T pace, and seeding the capacity belief
 * from a goal-blended number is the goal-poisoning the whole architecture
 * exists to prevent.
 */
export const SEED_THRESHOLD_SEC_PER_MI = 442;

/* ══════════════════════════════════════════════════════════════════════════
 * SMALL HELPERS
 * ═══════════════════════════════════════════════════════════════════════ */

const DAY_MS = 86_400_000;
const day = (iso: string): string => iso.slice(0, 10);
const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${day(iso)}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Monday of the ISO week containing `iso`. The plan's own week grid. */
export function weekStartOf(iso: string): string {
  const d = new Date(Date.parse(`${day(iso)}T12:00:00Z`));
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(day(iso), -dow);
}

/* ══════════════════════════════════════════════════════════════════════════
 * DIAGNOSTICS  ·  Rule 11, kept as a list rather than swallowed
 * ═══════════════════════════════════════════════════════════════════════ */

export interface Diagnostics {
  /** Inputs the real rows could not support, each with the reason. */
  couldNotBuild: string[];
  /** Notes worth reporting that are not failures. */
  notes: string[];
}

const note = (d: Diagnostics, s: string) => { if (!d.notes.includes(s)) d.notes.push(s); };
const cannot = (d: Diagnostics, s: string) => {
  if (!d.couldNotBuild.includes(s)) d.couldNotBuild.push(s);
};

/* ══════════════════════════════════════════════════════════════════════════
 * SPLITS  ·  one tolerant reader, because his rows carry three shapes
 * ═══════════════════════════════════════════════════════════════════════ */

interface NormSplit { paceSecPerMi: number | null; hrBpm: number | null; mi: number | null }

/**
 * Watch rows carry `{mile, pace, paceSecPerMi, hr}`; Strava rows carry
 * `{distance, moving_time, average_heartrate}`; some carry `{distanceMi,
 * paceSPerMi, avgHr}`. One reader, so a shape this file has not seen produces a
 * null rather than a silently wrong number.
 */
function normSplit(s: SnapSplit): NormSplit {
  const rec = s as unknown as Record<string, unknown>;
  const pace =
    num(rec.paceSecPerMi) ?? num(rec.paceSPerMi)
    ?? (num(rec.moving_time) !== null && num(rec.distance) !== null && num(rec.distance)! > 0
      ? num(rec.moving_time)! / (num(rec.distance)! / 1609.34)
      : null);
  const hr = num(rec.hr) ?? num(rec.avgHr) ?? num(rec.average_heartrate);
  const mi = num(rec.distanceMi)
    ?? (num(rec.distance) !== null ? num(rec.distance)! / 1609.34 : null)
    ?? (rec.mile !== undefined || rec.mi !== undefined ? 1 : null);
  return { paceSecPerMi: pace, hrBpm: hr, mi };
}

/* ══════════════════════════════════════════════════════════════════════════
 * PROVENANCE  ·  what an activity may be spent on
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * `Research/00a` is not consulted here and neither is any pace table. Every
 * flag below is a fact about the RECORDING or the CONDITIONS, which is what
 * `PaceRepresentativenessFlag` is for.
 */
export function provenanceOf(r: SnapRun, d: Diagnostics): Provenance {
  const flags: PaceRepresentativenessFlag[] = [];

  // Q28 · treadmill. `indoor` is the field the ingest sets; the activity name
  // is the belt-and-braces half, because three of his treadmill rows carry
  // `indoor: null` and are named "Treadmill".
  const treadmill = r.indoor === 'true' || /treadmill/i.test(r.name ?? '');

  // Heat. The threshold is READ from the app's own doctrine-bound constant
  // rather than retyped, per Rule 18: `HEAT_HR_CONFOUNDER.thresholdF` is
  // Research/03's "Heat (≥25°C)" in Fahrenheit. There is no supported
  // pace adjustment applied to these rows, so the flag is the honest posture.
  if (r.tempF !== null && r.tempF >= HEAT_HR_CONFOUNDER.thresholdF) {
    flags.push('HEAT_WITHOUT_SUPPORTED_ADJUSTMENT');
  }

  // Terrain. 100 ft/mi is roughly twice his own median and is this replay's
  // own resolution of "hilly", flagged as such rather than cited to doctrine.
  // It catches exactly one session in his history, the 361 ft/mi run of 26 Aug.
  if (r.elevGainFt !== null && r.distanceMi !== null && r.distanceMi > 1
    && r.elevGainFt / r.distanceMi >= 100) {
    flags.push('HILLY_WITHOUT_TRUSTED_GRADE_ADJUSTMENT');
  }

  // Q12.7 / the pace channel's precondition. No phases means nobody segmented
  // the work, so a "work pace" would be the whole-run average wearing a
  // work-pace label.
  if (!r.hasPhases || r.phases.length === 0) {
    flags.push('WORK_PHASES_MISSING_OR_MISSEGMENTED');
  }

  const truncation = truncationOf(r, d);

  return {
    activityId: r.activityId,
    dateISO: r.date,
    paceFlags: flags,
    truncation,
    treadmill,
  };
}

/**
 * Q29 · truncation, detected from what his rows actually record.
 *
 * The 2 Sep run is the worked case and it is the reason this is not a guess:
 * `data.manualCorrection.reason` says in full sentences that the run was "cut
 * at the last structured phase" because the watch offered no reachable End run,
 * and its `note` says `phases` and `splits` were deliberately LEFT summing to
 * 5.98 mi while `distanceMi` was repaired to 6.41. So the signature of a
 * truncated row here is a manual correction that says so, and the phase sum
 * falling materially short of the recorded distance is the corroborating half.
 */
function truncationOf(r: SnapRun, d: Diagnostics): Truncation {
  const reason = `${r.manualCorrection?.reason ?? ''} ${r.manualCorrection?.note ?? ''}`;
  const saysTruncated = /truncat|cut short|force-quit|crash-recovery/i.test(reason);

  const phaseMi = sum(r.phases.map((p) => num(p.actualDistanceMi) ?? 0));
  const shortfall = r.distanceMi !== null && phaseMi > 0
    ? (r.distanceMi - phaseMi) / r.distanceMi
    : 0;

  const truncated = saysTruncated || shortfall > 0.05;
  if (!truncated) {
    return { truncated: false, completeWorkPhasesCaptured: true, note: '' };
  }

  // Q29's second question, and the one that decides whether pace survives.
  const workPhases = r.phases.filter((p) => p.type === 'work');
  const complete = workPhases.length > 0 && workPhases.every((p) => p.completed === true);

  if (!complete) {
    cannot(d, `${r.date} · truncated with incomplete work phases, so it cannot price pace.`);
  } else {
    note(d,
      `${r.date} · truncated AFTER the prescribed work finished. Q29 admits it for pace with `
      + 'reduced confidence and refuses it for durability.');
  }

  return {
    truncated: true,
    completeWorkPhasesCaptured: complete,
    note: saysTruncated
      ? String(r.manualCorrection?.reason ?? 'recorded as truncated')
      : `phases sum to ${phaseMi.toFixed(2)} mi against a recorded ${r.distanceMi?.toFixed(2)} mi`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THIRDS  ·  Q13's "comparable work", refused when it is not comparable
 * ═══════════════════════════════════════════════════════════════════════ */

const NO_THIRDS = (why: string): ComparableThirds => ({
  middlePaceSecPerMi: absent(why),
  finalPaceSecPerMi: absent(why),
  middleHrBpm: absent(why),
  finalHrBpm: absent(why),
  comparable: false,
});

/** Distance-weighted pace and duration-weighted HR over a set of work phases. */
function phaseAgg(ps: readonly SnapPhase[]): { pace: number | null; hr: number | null } {
  const mi = sum(ps.map((p) => num(p.actualDistanceMi) ?? 0));
  const sec = sum(ps.map((p) => num(p.actualDurationSec) ?? 0));
  const hrPairs = ps
    .map((p) => [num(p.avgHr), num(p.actualDurationSec) ?? 1] as const)
    .filter((x): x is readonly [number, number] => x[0] !== null);
  const hrSec = sum(hrPairs.map((x) => x[1]));

  // Rule 11, and `check-coercion.sh` was right to flag the first draft's
  // `sec > 0 ? sec / mi : null`. The nulls below are the ABSENCE state, not an
  // erased measured zero: a phase set with no recorded distance or no recorded
  // duration is work that was never captured, and there is no such thing as a
  // pace over zero seconds. Named so the fact is in the code rather than in the
  // shape of a comparison.
  const distanceAndDurationRecorded = mi > 0 && sec > 0;
  const someHeartRateRecorded = hrPairs.length > 0 && hrSec > 0;
  return {
    pace: distanceAndDurationRecorded ? sec / mi : null,
    hr: someHeartRateRecorded ? sum(hrPairs.map((x) => x[0] * x[1])) / hrSec : null,
  };
}

/**
 * Thirds over REPEATED work phases. Q13 is explicit that deterioration must not
 * be inferred "from whole-run thirds when the workout contains different
 * prescribed phases", so this only fires when there are three or more work
 * phases that share one prescribed target pace, which is what a rep set is.
 */
function thirdsFromWorkPhases(r: SnapRun): ComparableThirds | null {
  const work = r.phases.filter((p) => p.type === 'work');
  if (work.length < 3) return null;

  const targets = new Set(work.map((p) => String(num(p.targetPaceSPerMi) ?? 'none')));
  if (targets.size > 1) return null; // different prescribed phases · Q13's warning

  const n = work.length;
  const mid = work.slice(Math.floor(n / 3), Math.floor((2 * n) / 3));
  const fin = work.slice(Math.floor((2 * n) / 3));
  const m = phaseAgg(mid);
  const f = phaseAgg(fin);

  return {
    middlePaceSecPerMi: m.pace === null ? absent('middle work pace unreadable') : measured(m.pace),
    finalPaceSecPerMi: f.pace === null ? absent('final work pace unreadable') : measured(f.pace),
    middleHrBpm: m.hr === null ? absent('middle work HR unreadable') : measured(m.hr),
    finalHrBpm: f.hr === null ? absent('final work HR unreadable') : measured(f.hr),
    comparable: true,
  };
}

/**
 * Thirds over whole-run SPLITS, for a continuous run.
 *
 * Only admissible when the prescription contains no pace-varying structure. A
 * long run prescribed "LONG · 9mi @ HM" ends at half-marathon pace on purpose,
 * so its final third is faster BY DESIGN, and comparing thirds across it would
 * measure the prescription rather than the runner. That case returns
 * `comparable: false`, which `assessDeterioration` turns into UNKNOWN, which is
 * the true answer.
 */
function thirdsFromSplits(r: SnapRun, structured: boolean): ComparableThirds {
  if (structured) {
    return NO_THIRDS('the prescription changes pace across the run, so its thirds are not comparable');
  }
  const sp = r.splits.map(normSplit).filter((s) => s.paceSecPerMi !== null);
  if (sp.length < 6) {
    return NO_THIRDS(`only ${sp.length} readable splits, too few to compare thirds`);
  }
  const n = sp.length;
  const mid = sp.slice(Math.floor(n / 3), Math.floor((2 * n) / 3));
  const fin = sp.slice(Math.floor((2 * n) / 3));
  const agg = (xs: NormSplit[]) => {
    const paces = xs.map((x) => x.paceSecPerMi!).filter((x) => x > 0);
    const hrs = xs.map((x) => x.hrBpm).filter((x): x is number => x !== null);
    return {
      pace: paces.length ? sum(paces) / paces.length : null,
      hr: hrs.length ? sum(hrs) / hrs.length : null,
    };
  };
  const m = agg(mid);
  const f = agg(fin);
  return {
    middlePaceSecPerMi: m.pace === null ? absent('middle third pace unreadable') : measured(m.pace),
    finalPaceSecPerMi: f.pace === null ? absent('final third pace unreadable') : measured(f.pace),
    middleHrBpm: m.hr === null ? absent('middle third HR unreadable') : measured(m.hr),
    finalHrBpm: f.hr === null ? absent('final third HR unreadable') : measured(f.hr),
    comparable: true,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * PRESCRIPTION → THE STIMULUS DENOMINATOR
 * ═══════════════════════════════════════════════════════════════════════ */

interface Prescribed {
  workSeconds: number;
  segments: number;
  targetPaceSecPerMi: number;
  recoverySeconds: number;
  hrCeilingBpm: number | null;
}

/**
 * What the plan asked for, read out of `workout_spec` rather than parsed from
 * the human sub-label. Three real shapes appear in his rows:
 *
 *   · rep sets by DISTANCE   · `rep_count · rep_distance_mi · rep_pace_s_per_mi`
 *   · rep sets by DURATION   · `rep_count · rep_duration_s`, `by_effort: true`
 *   · continuous tempo       · `tempo_distance_mi · tempo_pace_s_per_mi`
 *
 * The HR ceiling comes from the spec's own `pass` rule, which is the number the
 * watch actually enforced on the day. Rule 10 applies to it and this replay is
 * on the RIGHT side of that rule by accident of purpose: the frozen
 * `hr_cap_bpm` is exactly what the runner was held to at the time, and
 * re-deriving it from today's LTHR would be the bug.
 */
function prescribedFrom(w: SnapWorkout, d: Diagnostics): Prescribed | null {
  const spec = (w.spec ?? {}) as Record<string, unknown>;
  const rules = Array.isArray(spec.rules) ? spec.rules as Array<Record<string, unknown>> : [];
  const passHr = rules.find((r) => r.kind === 'pass' && r.metric === 'hr');
  const hrCeilingBpm = num(passHr?.value) ?? num(spec.hr_cap_bpm) ?? num(spec.hr_target_bpm);

  const repCount = num(spec.rep_count);
  const repPace = num(spec.rep_pace_s_per_mi);
  const repDist = num(spec.rep_distance_mi);
  const repDur = num(spec.rep_duration_s);
  const rest = num(spec.rep_rest_s) ?? 0;

  if (repCount !== null && repDist !== null && repPace !== null) {
    return {
      workSeconds: repCount * repDist * repPace,
      segments: repCount,
      targetPaceSecPerMi: repPace,
      recoverySeconds: rest * Math.max(0, repCount - 1),
      hrCeilingBpm,
    };
  }

  if (repCount !== null && repDur !== null) {
    // `by_effort: true` · there is no prescribed pace, so pace cannot be the
    // channel. The caller discounts pace for these, which is Q12's allowance.
    const target = repPace ?? num(w.paceTargetSPerMi);
    if (target === null) {
      cannot(d, `${w.dateISO} · effort-governed rep set with no prescribed pace, so pace cannot be graded.`);
      return null;
    }
    return {
      workSeconds: repCount * repDur,
      segments: repCount,
      targetPaceSecPerMi: target,
      recoverySeconds: rest * Math.max(0, repCount - 1),
      hrCeilingBpm,
    };
  }

  const tempoMi = num(spec.tempo_distance_mi);
  const tempoPace = num(spec.tempo_pace_s_per_mi) ?? num(w.paceTargetSPerMi);
  if (tempoMi !== null && tempoPace !== null) {
    return {
      workSeconds: tempoMi * tempoPace,
      segments: 1,
      targetPaceSecPerMi: tempoPace,
      recoverySeconds: 0,
      hrCeilingBpm,
    };
  }

  cannot(d, `${w.dateISO} · ${w.type} prescription has no readable work denominator in workout_spec.`);
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * A COMPLETED SESSION → A GRADED SESSION
 * ═══════════════════════════════════════════════════════════════════════ */

const TESTS_BY_TYPE: Readonly<Record<string, GradedSession['tests']>> = {
  threshold: 'THRESHOLD',
  tempo: 'THRESHOLD',
  race_week_tuneup: 'THRESHOLD',
  intervals: 'HIGH_INTENSITY',
  repetition: 'HIGH_INTENSITY',
  long: 'LONG_RUN',
  easy: 'EASY',
  shakeout: 'EASY',
  recovery: 'EASY',
};

const RACE_DISTANCE_OF = (mi: number): GradedSession['raceDistance'] => {
  if (mi < 4.5) return 'FIVE_K';
  if (mi < 9) return 'TEN_K';
  if (mi < 20) return 'HALF';
  return 'MARATHON';
};

export interface BuiltSession { session: GradedSession; grade: StimulusGrade }

/**
 * One completed run, matched to one prescription, graded.
 *
 * Returns null when the run is not a quality session at all, or when the
 * prescription cannot supply a denominator. Both are recorded in diagnostics.
 */
export function buildSession(
  /**
   * Race RESULTS, as evidence. `Evidence<SnapRace>` and not the sealed
   * collection, because this function prices a run that has already happened
   * and must not be able to reach for a race that has not: the type it holds
   * cannot produce one.
   */
  raceResults: Evidence<SnapRace>,
  r: SnapRun,
  w: SnapWorkout | null,
  d: Diagnostics,
): BuiltSession | null {
  const prov = provenanceOf(r, d);

  /* ── A race reads from `races.actual_result`, never from the run ───────── */

  const race = raceResults.find((x) => x.dateISO === r.date && x.finishS !== null);
  if (race) {
    const finishS = num(race.finishS)!;
    const distMi = num(race.distanceMi) ?? r.distanceMi ?? 0;
    const pace = num(race.paceSPerMi) ?? (distMi > 0 ? finishS / distMi : null);
    const raceDistance = RACE_DISTANCE_OF(distMi);
    note(d, `${r.date} · ${race.name} read from races.actual_result (${finishS}s), not from the training row.`);

    // A race is its own stimulus. Grading it against a prescribed rep set would
    // be a category error, so it is admitted as FULL when the recorded result
    // is confirmed and non-provisional, and the admissibility gate downstream
    // decides whether a race of THIS distance says anything about threshold.
    const provisional = race.provisional === 'true';
    if (provisional) {
      note(d, `${r.date} · ${race.name} is flagged provisional, so it is admitted as SUBSTANTIAL rather than FULL.`);
    }

    // ── THE EQUIVALENCE STEP A RACE NEEDS AND A WORKOUT DOES NOT ─────────
    //
    // A race's FINISH pace is an average over 6.2 or 13.1 miles, and a 10K and
    // a half are raced at different fractions of threshold. Handing the raw
    // number to the threshold lever compared two quantities that are not the
    // same quantity: his 2026-08-16 half at 7:47/mi happens to land within
    // ~5 s/mi of his threshold-equivalent, which hid it, and his 2026-09-13
    // Santa Monica 10K takes the same path in the OPPOSITE direction.
    //
    // The conversion is a PACE-PRESCRIPTION question and this harness does not
    // own it (`docs/BRAIN_CONSTITUTION.md` · one question, one canonical
    // owner). So it calls the owner: the repo's Daniels table, inverted from
    // the finish and read back at T. Rule 11 · when the finish falls outside
    // the tabulated VDOT range the answer is an explicit absence, never the
    // finish pace as a substitute.
    const raceVdot = vdotFromRace(finishS, distMi);
    const tEquivalent = raceVdot === null ? null : tPaceFromVdot(raceVdot);
    const thresholdEquivalent: Measured<number> =
      raceDistance !== 'TEN_K' && raceDistance !== 'HALF'
        ? absent<number>(
          `a ${raceDistance} is not clean threshold evidence, so no threshold equivalence is derived`,
        )
        : tEquivalent === null || !Number.isFinite(tEquivalent)
          ? absent<number>(
            'the finish falls outside the tabulated VDOT range, so no threshold equivalence could be derived',
          )
          : measured(tEquivalent);
    if (thresholdEquivalent.ok && pace !== null) {
      note(d, `${r.date} · ${race.name} finish pace ${Math.round(pace)} s/mi converts to a threshold `
        + `equivalent of ${Math.round(thresholdEquivalent.value)} s/mi at VDOT ${raceVdot}.`);
    }

    return {
      grade: provisional ? 'SUBSTANTIAL' : 'FULL',
      session: {
        provenance: prov,
        tests: raceDistance === 'MARATHON' ? 'MARATHON_EFFORT' : 'THRESHOLD',
        grade: provisional ? 'SUBSTANTIAL' : 'FULL',
        workPaceSecPerMi: pace === null
          ? failed('race pace could not be derived from races.actual_result')
          : measured(pace),
        thresholdEquivalentPaceSecPerMi: thresholdEquivalent,
        // `races.actual_result.miles` is EMPTY on every one of his races, so
        // there are no per-mile race splits to build thirds from. Q13 gets an
        // honest refusal rather than whole-run thirds off the training row.
        thirds: NO_THIRDS('races.actual_result carries no per-mile splits for this race'),
        raceDistance,
      },
    };
  }

  if (!w) return null;

  const tests = TESTS_BY_TYPE[w.type] ?? null;
  if (tests === null || tests === 'EASY') {
    // Easy days, strides days and rest are not quality evidence. They are still
    // fully admissible for weekly volume, which is where they are counted.
    return null;
  }
  if (tests === 'LONG_RUN') {
    // A long run reaches the engine through `longRuns`, where the lever that
    // owns it asks about completion and durability. It is not put through the
    // stimulus grader as well: a long-run spec carries a pace BAND and a
    // finish segment rather than a work denominator, so `prescribedFrom` would
    // have to invent one, and the grade it produced would then be read by the
    // volume lever as a key-session verdict it was never meant to be.
    return null;
  }

  const pres = prescribedFrom(w, d);
  if (!pres) return null;

  const work = r.phases.filter((p) => p.type === 'work');
  const rec = r.phases.filter((p) => p.type === 'recovery');

  const completedWorkSec: Measured<number> = work.length > 0
    ? measured(sum(work.map((p) => num(p.actualDurationSec) ?? 0)))
    : absent('no work phases were recorded for this activity');

  // C2 · per-segment acceptability, from the CANONICAL OWNER.
  //
  // The stored `phases[].verdict` is NOT used, and the reason is written down
  // in `execution-semantics.ts` itself: `missed` and `drifted` are legacy words
  // that "conflated two opposite facts", and the module names this runner's own
  // 2026-09-01 last rep as the worked example, marked `missed` for being three
  // seconds a mile QUICKER than the fast edge. Feeding that word into C2 would
  // grade his best threshold session of the block down for running well.
  //
  // So the segment average is re-graded through `gradeWorkPhase`, which is the
  // owner of that question, at `sessionToleranceSecFor`'s doctrine-bound width.
  // This is calling the owner, not holding a second opinion — Rule 16.
  const tolSec = sessionToleranceSecFor(w.type, w.spec);
  const segVerdicts = work.map((p) => gradeWorkPhase({
    targetSecPerMi: num(p.targetPaceSPerMi) ?? pres.targetPaceSecPerMi,
    avgSecPerMi: num(p.actualPaceSPerMi),
    toleranceSec: tolSec,
    completed: p.completed,
  }));
  const gradable = segVerdicts.filter((v) => v !== 'not_graded');
  // `fast` counts, for the reason `wireVerdictLandedTheWork` gives: doctrine's
  // own worked example calls a threshold set finishing past the fast edge
  // upward evidence, and whether a fast rep was an overcook is a HEART RATE
  // question, which C4 asks separately.
  const acceptable: Measured<number> = work.length === 0
    ? absent('no work phases were recorded, so no segment could be judged')
    : gradable.length === 0
      ? absent('no work segment carried a prescribed pace to be judged against')
      : measured(segVerdicts.filter((v) => v === 'hit' || v === 'fast').length);

  const wa = phaseAgg(work);
  const actualWorkPace: Measured<number> = wa.pace === null
    ? absent('work pace could not be read from the recorded phases')
    : measured(wa.pace);

  const meanWorkHr: Measured<number> = wa.hr === null
    ? absent('work heart rate could not be read')
    : measured(wa.hr);

  const thirds = thirdsFromWorkPhases(r)
    ?? thirdsFromSplits(r, /* structured */ work.length !== 1);

  const det = thirds.comparable;
  const majorLateCollapse: Measured<boolean> = det
    ? measured(false) // the deterioration module makes the real call; this is C5's coarse flag
    : absent('late-session behaviour could not be compared across this session');

  const actualRecoverySec: Measured<number> = pres.recoverySeconds === 0
    ? measured(0)
    : rec.length > 0
      ? measured(sum(rec.map((p) => num(p.actualDurationSec) ?? 0)))
      : absent('recovery segments were not recorded separately');

  const byEffort = (w.spec as Record<string, unknown> | null)?.by_effort === true;

  const assessment = gradeStimulus({
    prescribedWorkSeconds: pres.workSeconds,
    completedWorkSeconds: completedWorkSec,
    prescribedSegments: pres.segments,
    acceptableSegments: acceptable,
    targetWorkPaceSecPerMi: pres.targetPaceSecPerMi,
    actualWorkPaceSecPerMi: actualWorkPace,
    meanWorkHrBpm: meanWorkHr,
    // C4's per-repetition half. Each work phase carries its own `avgHr` from
    // its own sample window, which is exactly the granularity Q12's "averages
    // can hide failed repetitions" is about. Rule 11 · a phase with no HR is an
    // explicit absence in this array, never a silent pass.
    workSegmentHrBpm: work.map((ph) => {
      const hr = num(ph.avgHr);
      return hr === null
        ? absent<number>('this work segment recorded no heart rate')
        : measured(hr);
    }),
    hrCeilingBpm: pres.hrCeilingBpm === null
      ? absent<number>('the prescription carried no HR ceiling')
      : measured(pres.hrCeilingBpm),
    // C4's precondition. The question is whether HR ON THE WORK is readable,
    // so it is answered from the WORK PHASES, which carry their own measured
    // `avgHr` from the phase's own sample window. `runs.data.avgHrKind` is
    // about the RUN-level average and says nothing about the work; using it
    // here discounted the HR channel on 52 of his 156 runs for a reason that
    // was not about them.
    hrReliable: work.length > 0 && work.every((p) => num(p.avgHr) !== null),
    majorLateCollapse,
    prescribedRecoverySeconds: pres.recoverySeconds,
    actualRecoverySeconds: actualRecoverySec,
    dataCompleteAndSegmented: r.hasPhases && r.phases.length > 0 && r.splitsUnreliable !== 'true',
    paceDiscountFlags: byEffort
      ? [...prov.paceFlags, 'DELIBERATELY_ALTERED_EFFORT' as const]
      : prov.paceFlags,
  });

  if (assessment.grade === 'INSUFFICIENT') {
    cannot(d, `${r.date} · ${w.type} graded INSUFFICIENT · ${assessment.limiting.join(', ')}.`);
  }

  return {
    grade: assessment.grade,
    session: {
      provenance: prov,
      tests,
      grade: assessment.grade,
      workPaceSecPerMi: actualWorkPace,
      // For a prescribed workout the two quantities ARE the same number: the
      // work pace is already the pace held over the threshold work itself, with
      // no distance to convert away. The equivalence step exists for races.
      thresholdEquivalentPaceSecPerMi: actualWorkPace,
      thirds,
      raceDistance: null,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE BUILDER
 * ═══════════════════════════════════════════════════════════════════════ */

export interface BuildArgs {
  readonly asOfISO: string;
  readonly boundary: EvaluationBoundary;
  readonly belief: CapacityBelief;
  readonly stepsTakenThisCycle?: Partial<Record<CanonicalLever, number>>;
  readonly anchorMovedTodayForLever?: Partial<Record<CanonicalLever, boolean>>;
  /** Set false to prove a failed read is not a runner without evidence. */
  readonly readable?: boolean;
  /** Test-only. A fabricated future session, to attack the lookahead filter. */
  readonly poison?: GradedSession;
}

export interface BuiltInput {
  readonly input: CanonicalAdaptationInput;
  readonly diagnostics: Diagnostics;
}

/**
 * THE ONLY DOOR. Everything a decision point can see comes through here, and
 * nothing reaches it except through `asof.ts`'s two branded views.
 */
export function buildInputAt(args: BuildArgs, snapshot?: SealedHistory): BuiltInput {
  const snap = snapshot ?? sealedHistory();
  const asOf = day(args.asOfISO);
  /** The moment, as the fence's own unforgeable token. */
  const A: AsOf = asOfOf(asOf);
  const d: Diagnostics = { couldNotBuild: [], notes: [] };

  /**
   * The last remaining hand-written temporal predicate, and it guards exactly
   * one thing: the test-only poison session, which is a fabricated
   * `GradedSession` rather than a row from any sealed collection. It cannot go
   * through the fence because it never came from the extract, so it is checked
   * here — deliberately, and named, so the exception is visible rather than
   * looking like the old convention surviving.
   */
  const before = (iso: string | null | undefined): boolean =>
    typeof iso === 'string' && iso.length >= 10 && day(iso) < asOf;

  const runs = snap.runs.before(A);
  const raceResults = snap.races.before(A);
  const visiblePlans = snap.plans.before(A);

  /* ── The plan in force, and the prescriptions it carried ───────────────── */

  const inForceYesterday = planInForce(visiblePlans, addDays(asOf, -1), A);
  const currentPlan = inForceYesterday?.plan ?? null;
  if (!currentPlan) {
    cannot(d, `${asOf} · no plan was in force, so there is no prescription to compare against.`);
  }

  /** The prescription for one date, from the plan that was live on that date. */
  const prescriptionOn = (dayISO: string): SnapWorkout | null => {
    const p = planInForce(visiblePlans, dayISO, A);
    if (!p) return null;
    return narrowAuthored(
      snap.planWorkouts.ofPlan(p.visible, 'PRESCRIPTION_IS_AUTHORED_IN_ADVANCE'),
      (w) => w.dateISO === dayISO,
    )[0] ?? null;
  };

  /* ── WEEKS · prescribed against completed ──────────────────────────────── */

  const weekStarts = [...new Set(runs.map((r) => weekStartOf(r.date)))]
    .concat(
      // Weeks with a prescription but no runs are weeks too. Dropping them would
      // turn "he ran nothing" into "the week does not exist", which is Rule 11's
      // exact confusion in a different place.
      //
      // Every VISIBLE plan version, not just the one in force, because this is
      // enumerating which weeks the plan ever spoke about and a week can be
      // prescribed by a version that was later archived. Rule 14 still holds:
      // the set is bounded by what was authored before this moment, and the
      // per-week prescription below is resolved by `prescriptionOn`, which
      // picks exactly one plan per date.
      narrowAuthored(
        snap.planWorkouts.ofAnyVisiblePlan(
          allVisiblePlans(visiblePlans, A), 'PRESCRIPTION_IS_AUTHORED_IN_ADVANCE',
        ),
        (w) => w.dateISO < asOf,
      ).map((w) => weekStartOf(w.dateISO)),
    );
  const weeks: WeekObservation[] = [...new Set(weekStarts)]
    .sort()
    .filter((ws) => ws < asOf)
    .map((ws) => {
      const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((x) => x < asOf);
      const pres = days
        .map(prescriptionOn)
        .filter((w): w is SnapWorkout => w !== null);
      const prescribedMi = sum(pres.map((w) => num(w.distanceMi) ?? 0));
      const inWeek = runs.filter((r) => days.includes(r.date));

      // Rule 11 · a week nobody could read is not a week at zero. The only
      // genuinely unreadable case in his history is a run whose distance is
      // null; a week with no runs at all is a MEASURED zero and is reported as
      // one, because a week he chose not to run and a week the sync dropped are
      // opposite facts.
      const unreadable = inWeek.filter((r) => r.distanceMi === null);
      const completedMi: Measured<number> = unreadable.length > 0
        ? failed(`${unreadable.length} activities in this week have no readable distance`)
        : measured(sum(inWeek.map((r) => r.distanceMi ?? 0)));

      const p = planInForce(visiblePlans, ws, A);
      const pw = p
        ? narrowAuthored(
          snap.planWeeks.ofPlan(p.visible, 'PLAN_WEEK_STRUCTURE_IS_AUTHORED_IN_ADVANCE'),
          (x) => x.weekStartISO === ws,
        )[0] ?? null
        : null;

      // The plan's OWN cutback flag, which is the authored truth the volume
      // lever asks for: "a week the plan told him to reduce is not a week he
      // fell short of". Race weeks count for the same reason, which is
      // CLAUDE.md Rule 8 arriving at the same answer from the other direction.
      //
      // ── AND THE THIRD CLAUSE, WHICH IS A PRODUCTION DATA DEFECT ─────────
      //
      // `plan_weeks.is_cutback` is FALSE on both weeks of `pln_eb73331e19230ad9`
      // — the `mode: 'recovery'` plan authored the day after his A-race half on
      // 2026-08-16 — and `is_peak` is TRUE on the second of them. So the two
      // weeks of prescribed post-race recovery are, in the database, ordinary
      // non-cutback weeks, one of them flagged as a PEAK.
      //
      // Rule 8 is unambiguous that this must not reach a habit reader: "It
      // cannot look at taper and recover as my 'normal'. Ever." The canonical
      // engine delegates the whole of that protection to this one boolean, so
      // a loader that trusted `is_cutback` alone would hand it a post-race
      // recovery week as evidence about his training identity, and the 2026-08-17
      // week — 28.4 mi run against a 17 mi recovery prescription, 167% — would
      // count as a completed week supporting an increase.
      //
      // The plan's `mode` carries the fact the week row lost. It used to be
      // reconciled INTO `isCutback` right here, which fixed the number and hid
      // the defect from the engine — so the engine still had a Rule 8
      // protection resting on one boolean that production had got wrong, and
      // only this harness knew. Both witnesses are now handed over as they
      // stand and `prescribedNonNormalWeek` reconciles them inside the engine,
      // which is where the resilience belongs. The underlying row is still
      // wrong and is still reported as a defect; nothing here repairs it.
      const planIsRecovery = p?.plan.mode === 'recovery';
      const authoredPlanMode: AuthoredPlanMode = p === null || p === undefined
        ? 'UNKNOWN'
        : planIsRecovery
          ? 'RECOVERY'
          : p.plan.mode === 'taper'
            ? 'TAPER'
            : 'BUILD';
      if (planIsRecovery && pw && !pw.isCutback) {
        note(d, `week ${ws} · plan ${p!.plan.planId} is mode 'recovery' but plan_weeks.is_cutback is false. `
          + 'Rule 8 · the engine reconciles the two witnesses, and the row is a defect.');
      }
      const isCutback = pw ? (pw.isCutback || pw.isRaceWeek) : false;
      if (!pw && prescribedMi > 0) {
        note(d, `week ${ws} · no plan_weeks row, so its cutback flag is unknown and read as false. `
          + `The plan mode is ${authoredPlanMode}, which is the engine's second witness.`);
      }

      return {
        weekStartISO: ws,
        prescribedMi,
        completedMi,
        isCutback,
        authoredPlanMode,
        dataComplete: unreadable.length === 0,
      };
    })
    // A week with NO prescription is not a week he fell short of, and it is
    // not an unreadable week either. It is a week the plan did not cover — the
    // gap between the AFC block ending on race day and the CIM block being
    // authored two weeks later is the real instance. Passing it through with
    // `prescribedMi: 0` would make the lever compute a completion fraction of
    // zero and read a rest week as a total failure, which is exactly the
    // "measured zero versus no question asked" collapse Rule 11 forbids.
    .filter((w) => {
      if (w.prescribedMi > 0) return true;
      note(d, `week ${w.weekStartISO} · no plan prescribed anything, so it is not a week to grade completion against.`);
      return false;
    });

  /* ── QUALITY SESSIONS ──────────────────────────────────────────────────── */

  const qualitySessions: GradedSession[] = [];
  for (const r of runs) {
    const w = prescriptionOn(r.date);
    const built = buildSession(raceResults, r, w, d);
    if (built) qualitySessions.push(built.session);
  }
  if (args.poison && before(args.poison.provenance.dateISO)) {
    qualitySessions.push(args.poison);
  } else if (args.poison) {
    // Present in the pool, kept out by the filter. That is the tripwire.
    void args.poison;
  }

  /* ── LONG RUNS ─────────────────────────────────────────────────────────── */

  const longRuns: LongRunObservation[] = [];
  for (const ws of [...new Set(weekStarts)].sort()) {
    if (ws >= asOf) continue;
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((x) => x < asOf);
    const presLong = days
      .map(prescriptionOn)
      .find((w): w is SnapWorkout => w !== null && w.isLong);
    if (!presLong) continue;

    const inWeek = runs.filter((r) => days.includes(r.date) && r.distanceMi !== null);
    if (inWeek.length === 0) {
      longRuns.push({
        provenance: {
          activityId: `no-run:${ws}`, dateISO: presLong.dateISO,
          paceFlags: [], truncation: { truncated: false, completeWorkPhasesCaptured: true, note: '' },
          treadmill: false,
        },
        prescribedMi: num(presLong.distanceMi) ?? 0,
        completedMi: measured(0),
        thirds: NO_THIRDS('no activity was recorded in this week'),
        followingKeySessionOk: absent('no long run happened, so nothing followed it'),
      });
      continue;
    }
    const actual = inWeek.reduce((a, b) => ((a.distanceMi ?? 0) >= (b.distanceMi ?? 0) ? a : b));
    if (actual.date !== presLong.dateISO) {
      note(d, `week ${ws} · the long run was prescribed for ${presLong.dateISO} and the longest run was ${actual.date}.`);
    }

    const spec = (presLong.spec ?? {}) as Record<string, unknown>;
    const prov = provenanceOf(actual, d);
    const work = actual.phases.filter((p) => p.type === 'work');

    // Q13's own warning, applied to the long run. A long prescribed
    // "LONG · 10mi @ HM" finishes fast BY DESIGN, so comparing its thirds would
    // measure the prescription rather than the runner. Two signatures say the
    // run is structured: the spec carries a `finish_mi` segment, or the watch
    // recorded work phases with more than one prescribed target pace.
    const targets = new Set(
      work.map((p) => String(num(p.targetPaceSPerMi) ?? 'none')),
    );
    const structured = (spec.finish_mi !== undefined && spec.finish_mi !== null)
      || targets.size > 1;
    const thirds = thirdsFromWorkPhases(actual) ?? thirdsFromSplits(actual, structured);

    // Q22 · the next quality session after this long run, within a week. Absent
    // when none has happened YET, which is a refusal input rather than a pass.
    const after = runs
      .filter((r) => r.date > actual.date && r.date <= addDays(actual.date, 7))
      .map((r) => ({ r, w: prescriptionOn(r.date) }))
      .find((x) => x.w !== null && x.w.isQuality);
    let followingKeySessionOk: Measured<boolean>;
    if (!after) {
      followingKeySessionOk = absent('no key session has followed this long run yet');
    } else {
      const b = buildSession(raceResults, after.r, after.w, d);
      followingKeySessionOk = b === null
        ? absent('the following key session could not be graded')
        : measured(b.grade === 'FULL' || b.grade === 'SUBSTANTIAL');
    }

    longRuns.push({
      provenance: prov,
      prescribedMi: num(presLong.distanceMi) ?? 0,
      completedMi: actual.distanceMi === null
        ? failed('the long run distance could not be read')
        : measured(actual.distanceMi),
      thirds,
      followingKeySessionOk,
    });
  }

  /* ── THE PROJECTED PLAN CONTEXT ────────────────────────────────────────── */

  const nextWeekStart = weekStartOf(addDays(asOf, 7));
  const nextWeekDays = Array.from({ length: 7 }, (_, i) => addDays(nextWeekStart, i));
  const nextPres = nextWeekDays
    .map((x) => prescriptionOn(x))
    .filter((w): w is SnapWorkout => w !== null);

  const nextWeekPrescribedMi = sum(nextPres.map((w) => num(w.distanceMi) ?? 0));
  const nextWeekLongRunMi = Math.max(0, ...nextPres.filter((w) => w.isLong).map((w) => num(w.distanceMi) ?? 0));
  const nextWeekQualityMinutes = sum(
    nextPres.filter((w) => w.isQuality).map((w) => {
      const p = prescribedFrom(w, d);
      return p ? p.workSeconds / 60 : 0;
    }),
  );
  if (nextWeekPrescribedMi === 0) {
    cannot(d, `${asOf} · the plan in force prescribes nothing for the week starting ${nextWeekStart}.`);
  }

  const planWeeksOfCurrent: readonly SnapWeek[] = inForceYesterday
    ? [...snap.planWeeks.ofPlan(inForceYesterday.visible, 'PLAN_WEEK_STRUCTURE_IS_AUTHORED_IN_ADVANCE')]
      .sort((a, b) => a.weekIdx - b.weekIdx)
    : [];
  const nextCutbackBoundaryISO =
    planWeeksOfCurrent.find((w) => w.weekStartISO > asOf && w.isCutback)?.weekStartISO ?? null;
  // The race CALENDAR, through the fence's forward door. What comes back has no
  // `finishS` field at all, so the next-boundary read cannot become a read of a
  // result that has not happened.
  const nextRaceBoundaryISO =
    narrowAuthored(
      snap.races.fromInclusive(A, 'RACE_DATE_IS_PUBLISHED_IN_ADVANCE'),
      (r) => r.dateISO !== null && r.dateISO > asOf,
    )
      .map((r) => r.dateISO!)
      .sort()[0] ?? null;
  // The taper is the first race week's block, resolved from the plan's own
  // week flags rather than re-derived from a doctrine table this file does not
  // own. `BLOCK_SHAPE[cat].taperWeeks` already decided it at authoring.
  //
  // And it is the first race week that has NOT ALREADY HAPPENED. Reading
  // `find(w => w.isRaceWeek)` unconditionally returned the AFC half's race week
  // for the whole of the block that followed it, so at 2026-08-03 this handed
  // the engine a taper start of 2026-07-27 — a boundary a week in the past,
  // which bounded a proposal for the week of 2026-08-10 to nothing. The engine
  // now refuses to be bounded by a boundary the change has already passed, and
  // this stops handing it one.
  const raceWeek = planWeeksOfCurrent.find((w) => w.isRaceWeek && w.weekStartISO >= asOf);
  const taperStartISO = raceWeek
    ? planWeeksOfCurrent.find((w) => w.weekIdx === raceWeek.weekIdx - 2)?.weekStartISO ?? raceWeek.weekStartISO
    : null;

  const futureThresholdSessionIds = inForceYesterday
    ? narrowAuthored(
      snap.planWorkouts.ofPlan(inForceYesterday.visible, 'PRESCRIPTION_IS_AUTHORED_IN_ADVANCE'),
      (w) => w.dateISO >= asOf && (w.type === 'threshold' || w.type === 'tempo'),
    ).map((w) => w.workoutId)
    : [];

  const zero = { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 } as const;
  const no = { THRESHOLD_PACE: false, WEEKLY_VOLUME: false, LONG_RUN: false } as const;

  const input: CanonicalAdaptationInput = {
    athleteId: ATHLETE_ID,
    planVersion: currentPlan?.planId ?? 'no-plan-in-force',
    evidenceVersion: `real-${snap.extractedAtISO}-asof-${asOf}`,
    evaluatedAtISO: asOf,
    boundary: args.boundary,
    belief: args.belief,
    race: RACE,
    goal: GOAL,
    plan: {
      planVersion: currentPlan?.planId ?? 'no-plan-in-force',
      nextWeekStartISO: nextWeekStart,
      nextWeekPrescribedMi,
      nextWeekLongRunMi,
      nextWeekQualityMinutes,
      nextCutbackBoundaryISO,
      nextRaceBoundaryISO,
      taperStartISO,
      futureThresholdSessionIds,
      stepsTakenThisCycle: { ...zero, ...args.stepsTakenThisCycle },
      anchorMovedTodayForLever: { ...no, ...args.anchorMovedTodayForLever },
    },
    qualitySessions,
    weeks,
    longRuns,
    readable: args.readable ?? true,
  };

  return { input, diagnostics: d };
}
