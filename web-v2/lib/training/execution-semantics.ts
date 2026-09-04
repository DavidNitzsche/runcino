/**
 * lib/training/execution-semantics.ts — THE owner of "did the runner do the
 * session, and how wide is the window we judge that against".
 *
 * Pure. No pool, no query, no `userId`, no DB import at any depth — the same
 * seal `prescription-resolver.ts` carries, and for the same reason: this file
 * is imported by the phone route, the watch builder, the run-detail mapper,
 * the recap, the evidence pipeline and the Targets page, and one of those is
 * reachable from a `'use client'` entry. Rule 19's client-graph gate is what
 * enforces it; this sentence is not the enforcement (Rule 20).
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * On 2026-09-01 the owner ran `4×1 mi @ T pace · 1 min jog` — 422 / 429 / 422 /
 * 419 s/mi against a 430 target, recoveries 61 / 64 / 64 s against a
 * prescribed 60, work HR 158 → 166 against a `pass: avgHr ≤ 164` line, on a
 * slight negative split. That is a near-flawless threshold session. The app
 * returned **drifted, drifted, drifted, missed**, and graded the cool-down
 * "missed" as well.
 *
 * Nothing was broken in an obvious way. FIVE different tolerances were live,
 * each individually defensible, none of them shared:
 *
 *   | where                          | tolerance | site                        |
 *   |--------------------------------|-----------|-----------------------------|
 *   | phone card + watch band SHOWN  | ±8        | `today/route.ts:1515`,      |
 *   |                                |           | `spec-card.ts:382`,         |
 *   |                                |           | `build-workout.ts:1712`     |
 *   | evidence / adaptation pipeline | ±10 / ±40 | `goal-projection.ts:1161`   |
 *   | blended-overall basis          | ±15       | `goal-projection.ts:1246`   |
 *   | run-detail phase colouring     | ±10       | `run-state.ts:1564`         |
 *   |   (while shipping tolerance 8) | ±8        | `run-state.ts:1584`         |
 *   | "on track / slipping" copy     | ±12 / ±18 | `training-influence.ts:103` |
 *
 * and the phone and the watch did not even agree on WHICH class a session was:
 * `build-workout.ts` classified on `workout_spec.kind` (so a tempo row is
 * `threshold` → 8) while `today/route.ts` classified on `strictPrescriptionType`
 * (so the same row is `tempo` → 20). 21 live plan rows sat on that fork. Rule
 * 16, on one workout, across two surfaces.
 *
 * Worse than the spread: three of the four numbers were applied to the wrong
 * SHAPE of prescription. A warm-up and a cool-down are easy running — a
 * CEILING, where slower is always fine — and both were graded as a two-sided
 * band, which is how a correct 534 s/mi cool-down under a 502 ceiling became
 * "missed". A between-rep jog carries no prescribed pace at all and must never
 * be pace-graded. And a rep was graded on the SHARE OF INSTANTANEOUS SAMPLES
 * inside a ±8 s/mi band — which, on a 1-mile GPS rep, is measuring the
 * instrument, not the runner.
 *
 * So the fix is not "pick one number". It is: one table, one classification,
 * one statement of what each phase's pace target MEANS, and one grading rule
 * per meaning. That is this file.
 *
 * ── DOCTRINE ────────────────────────────────────────────────────────────────
 *
 * `Research/01-pace-zones-vdot.md` §"Pace zone width and lock-in rules" is the
 * source, read row for row:
 *
 *     | E    | ±30 sec/mi (wide)      | Never. Prescribe a window. |
 *     | M    | ±5 sec/mi              | ... window for general MP segments |
 *     | T    | ±3 sec/mi              | Yes — narrow window required for adaptation |
 *     | I    | ±3 sec per rep         | ... |
 *     | R    | ±1–2 sec per rep       | ... |
 *
 * and, two lines under it, the rule that orders them: **"the harder the
 * workout, the tighter the lock. Easy work is effort-based; threshold and
 * faster work is pace-based."** That ORDERING is what `TOLERANCE_ORDER_DOCTRINE`
 * below is bound to, and what `DOCTRINE.grading-tolerance-order` reads out of
 * the file at run time (Rule 18 — a check that hardcodes both sides only proves
 * the test agrees with itself).
 *
 * ── THE DEVIATION, STATED (Rule 20) ─────────────────────────────────────────
 *
 * The widths here are NOT doctrine's ±3 for T. They are the widths the app has
 * shipped and displayed since 2026-09-01 (8 / 12 / 20 / 30), and they are
 * WIDER than the table. That is deliberate and it is argued, not inherited:
 *
 *   1. Doctrine's ±3 is a window for a runner reading a track split off a
 *      known distance. This module grades a GPS-derived SEGMENT AVERAGE. ±3
 *      s/mi on a 430 s/mi rep is 0.7% — below the resolution of the instrument
 *      doing the grading.
 *   2. Brief 03: "do not manufacture precision because the software can
 *      display it." The 2026-09-01 threshold anchor was a VDOT 47.9 estimate at
 *      confidence 0.727 resting on a 16-day-old half marathon. The uncertainty
 *      in the CENTRE of that band is comparable to ±8. Grading at ±3 would
 *      claim to know the centre to a second.
 *   3. `ZONE_TOLERANCE_S_PER_MI` in `prescription-resolver.ts` already holds
 *      doctrine's numbers, and it answers a DIFFERENT question — how wide is
 *      the window we PRESCRIBE. This table answers how wide is the window we
 *      GRADE a measured average against. Two questions, two names (Rule 16);
 *      the ordering constraint below is what keeps them from contradicting.
 *
 * Narrowing these toward doctrine is a prescription change and belongs to the
 * Pace Prescription owner (Constitution §G), not to the grader. What is NOT
 * negotiable, and is asserted here, is that they stay ORDERED the way doctrine
 * orders them.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ─────────────────────────────────
 *
 *   · It cannot tell a correctly-run session from a mis-PRESCRIBED one. If the
 *     target itself is wrong, every verdict here is confidently wrong with it.
 *   · It has no view of heart rate, terrain, weather or fatigue. `gradeSession`
 *     reads pace and completion only. A rep hit on pace at a heart rate that
 *     says the runner was drowning grades `hit` here, and the physiological
 *     read belongs to the Evidence Engine (§B) and the recap.
 *   · It cannot see a session it is never called on. Every consumer that stops
 *     calling it goes silently back to its own literal — which is the exact
 *     failure that produced the five-tolerance spread above, so
 *     `_execution_semantics_owner.test.ts` scans for that rather than trusting
 *     this paragraph.
 *   · Its verdict distribution is deliberately NOT symmetric in the way Rule 22
 *     warns about, and the asymmetry runs the other way from the usual: a
 *     ceiling phase has no failing verdict at all in the "too slow" direction,
 *     because doctrine says slower than a ceiling is not a miss. The one thing
 *     a ceiling phase CAN fail is running too FAST, which is the finding that
 *     actually matters on an easy day.
 */

import type { PrescriptionShape } from '@/lib/training/prescription-resolver';

/* ═════════════════════════════ 1 · classification ═══════════════════════ */

/**
 * The ONE session classification. Moved here from `lib/watch/build-workout.ts`
 * (which now re-exports it) so the phone, the watch and every server-side
 * grader route off the same answer instead of three.
 *
 * Keyed off the SPEC's `kind` first, because the spec is authored truth and is
 * already correct where `plan_workouts.type` is not — a race-week tune-up
 * carries `kind: 'threshold'`. Falls back to `type` for the categories the spec
 * union has no member for (race, rest, shakeout).
 *
 * The phone used to route off `strictPrescriptionType` instead, which maps
 * `tempo → 'tempo'` and therefore missed both the `threshold` and `intervals`
 * arms of its own ternary: a tempo row printed ±20 s/mi on the card the runner
 * planned off while the wrist graded it at ±8. That fork is what this being
 * one function removes.
 */
export type SessionClass = 'easy' | 'long' | 'threshold' | 'interval' | 'race' | 'rest' | 'other';

export function classifySession(
  type: string,
  spec: Record<string, unknown> | null | undefined,
): SessionClass {
  // Type wins where the spec union cannot express the answer. A race stashes
  // as `kind: 'long'` because WorkoutSpec has no race member, so asking the
  // spec first would classify race day as a long run.
  if (type === 'race') return 'race';
  if (type === 'rest') return 'rest';

  const kind = typeof spec?.kind === 'string' ? spec.kind : null;
  switch (kind) {
    case 'intervals': return 'interval';
    case 'threshold':
    case 'tempo':     return 'threshold';
    case 'long':      return 'long';
    case 'easy':
    case 'recovery':  return 'easy';
  }

  switch (type) {
    case 'intervals':
    case 'vo2max':            return 'interval';
    case 'threshold':
    case 'tempo':
    case 'race_week_tuneup':
    case 'fartlek':
    case 'progression':       return 'threshold';
    case 'long':              return 'long';
    case 'easy':
    case 'recovery':
    case 'shakeout':          return 'easy';
    default:                  return 'other';
  }
}

/* ═════════════════════════════ 2 · the tolerance table ══════════════════ */

/**
 * Easy running inside a quality session — the warm-up and the cool-down.
 *
 * Doctrine's own E row, verbatim: `±30 sec/mi (wide)`. It is here for the two
 * consumers that still need a NUMBER for an easy phase (the wire's
 * `tolerancePaceSPerMi`, and any legacy client that has not learned about
 * `paceShape` yet). Grading does NOT use it: `gradeCeilingPhase` reads the
 * ceiling and nothing else, because a ceiling has no far edge.
 */
export const EASY_PHASE_TOLERANCE_S_PER_MI = 30;

/**
 * MP-EMBEDDED-1, 2026-09-04 · a marathon-pace-specific segment EMBEDDED in a
 * `long` session — "10.0 mi easy" into "4.0 mi @ marathon pace" — is not the
 * same prescription as the easy running around it, and grading it as one is
 * a real defect this constant closes.
 *
 * `Research/01-pace-zones-vdot.md` §"Pace zone width and lock-in rules", the
 * M row verbatim: `±5 sec/mi | Yes for race-simulation; window for general
 * MP segments`. "Window", not "ceiling" — the whole point of marathon-pace
 * work is marathon-specific economy (`Research/04-workout-vocabulary.md`
 * §4.1, "Marathon-pace long run... Marathon-specific economy"), and running
 * dramatically slower than MP does not rehearse that regardless of how
 * comfortably it clears an easy-day ceiling.
 *
 * `paceShapeFor` cannot see this on its own — it takes a `phaseType` ('work')
 * and a `SessionClass` ('long'), never per-phase INTENT, so every work phase
 * in a long run reads `ceiling` uniformly. `gradeStoredPhases` is the one
 * place that also holds the phase's own LABEL and can tell the two apart —
 * see `looksLikeMarathonPaceLabel` and its call site there.
 */
export const MP_PHASE_TOLERANCE_S_PER_MI = 5;

/**
 * Detects a marathon-pace-specific phase by its own label — the same
 * heuristic the phone already applies client-side
 * (`RunDetailV5.marathonPacePhase`, `TodayAfterV5.marathonPacePhase`) to
 * find and prioritise this exact phase in the Digest UI, now given one
 * server-side home so grading and display cannot disagree about which
 * phase this is. Matches "4.0 mi @ marathon pace", "Marathon pace block",
 * etc. — the label vocabulary `lib/postrun/load.ts` composes for this
 * session shape.
 */
export function looksLikeMarathonPaceLabel(label: string | null | undefined): boolean {
  return typeof label === 'string' && /marathon[\s-]*pace/i.test(label);
}

/**
 * THE tolerance table, seconds per mile. Every consumer calls this; nobody
 * writes a literal.
 *
 * See the module header for the doctrine anchor and for why these are wider
 * than `Research/01`'s own ±3. What the doc DOES fix, and what
 * `TOLERANCE_ORDER_DOCTRINE` asserts, is the ordering: quality tightest, race
 * next, general running widest, easy running widest of all.
 */
const SESSION_TOLERANCE_S_PER_MI: Readonly<Record<SessionClass, number>> = Object.freeze({
  threshold: 8,
  interval: 8,
  race: 12,
  // EVERYTHING THAT IS NOT QUALITY OR RACE IS EASY RUNNING, and doctrine has
  // exactly one answer for easy running: `Research/01`'s E row, ±30 sec/mi
  // (wide), "Never [lock]. Prescribe a window." A long run is easy effort with
  // more volume — the same reason `PrescribedPaceAnchors.easyCeilingSecPerMi`
  // is ONE number for easy and long — so it takes the same width.
  //
  // `other` and `rest` are the classifier's "I could not name this session".
  // Rule 11: an unnamed session is not a licence to grade it harshly, so it
  // takes doctrine's widest stated window too. A refusal to be precise is a
  // correct answer; a confident narrow verdict on a session nobody can name is
  // not.
  easy: EASY_PHASE_TOLERANCE_S_PER_MI,
  long: EASY_PHASE_TOLERANCE_S_PER_MI,
  rest: EASY_PHASE_TOLERANCE_S_PER_MI,
  other: EASY_PHASE_TOLERANCE_S_PER_MI,
});


/**
 * Doctrine's ordering, as the constraint it actually is.
 *
 * `Research/01-pace-zones-vdot.md` §"Pace zone width and lock-in rules":
 * "the harder the workout, the tighter the lock". Bound at run time by
 * `DOCTRINE.grading-tolerance-order`, which parses the E / M / T rows out of
 * the doc and asserts this table respects the same order — rather than
 * hardcoding both sides of the comparison.
 */
export const TOLERANCE_ORDER_DOCTRINE: readonly SessionClass[] = Object.freeze([
  'threshold', 'interval', 'race', 'easy', 'long',
]);

/** The ONE tolerance. Seconds per mile, always positive. */
export function sessionToleranceSec(kind: SessionClass): number {
  return SESSION_TOLERANCE_S_PER_MI[kind] ?? SESSION_TOLERANCE_S_PER_MI.other;
}

/**
 * Convenience for the many call sites that hold a raw `plan_workouts.type` and
 * a `workout_spec` rather than an already-classified session.
 */
export function sessionToleranceSecFor(
  type: string,
  spec: Record<string, unknown> | null | undefined,
): number {
  return sessionToleranceSec(classifySession(type, spec));
}

/* ═════════════════════════════ 3 · what a pace target MEANS ═════════════ */

/**
 * What a phase's pace target asserts. Same four words as
 * `PrescriptionShape` — deliberately the same type, because a prescription
 * whose shape is `ceiling` must be graded as a ceiling, and letting the two
 * drift apart would be two names for one quantity (Rule 16).
 *
 *   · `ceiling` — "do not go FASTER than this". Slower is never a miss.
 *     Easy, long, recovery, warm-up, cool-down, shakeout.
 *   · `window`  — "hold this, within the tolerance, both sides". Threshold
 *     and interval reps, race pace, marathon-pace rehearsal.
 *   · `effort`  — a target exists but not as a pace (hills, strides, by-feel).
 *     Not pace-graded.
 *   · `none`    — no prescribed pace at all. Never pace-graded, and the
 *     absence is a real answer, not a missing one (Rule 11).
 */
export type PaceShape = PrescriptionShape;

/** The phase vocabulary the wire and `expand-spec.ts` already speak. */
export type PhaseType = 'warmup' | 'work' | 'recovery' | 'cooldown';

/**
 * The shape of one phase's pace target.
 *
 * A recovery phase is `none` unconditionally: `RECOVERY-BYFEEL-1` removed the
 * pace from a between-rep jog on purpose, and a jog that ran 1034 s/mi because
 * the runner was catching his breath between two 422s is a CORRECTLY executed
 * recovery. Grading it against anything is the defect.
 *
 * A warm-up or cool-down is `ceiling` whenever it carries a target, because
 * the number it carries IS the easy band's fast edge (`easyBandFromTPace().lo`
 * — "the ceiling an easy-pace prescription must not cross"), not a midpoint to
 * hover on. That single line is what stops a 534 s/mi cool-down under a 502
 * ceiling from reading "missed".
 *
 * Work phases follow the session: a window on quality and race work, a ceiling
 * on easy/long work (where "work" just means the body of the run).
 */
export function paceShapeFor(
  phaseType: PhaseType,
  kind: SessionClass,
  opts?: { hasTarget?: boolean; byEffort?: boolean },
): PaceShape {
  const hasTarget = opts?.hasTarget ?? true;
  if (opts?.byEffort) return 'effort';
  if (!hasTarget) return 'none';

  switch (phaseType) {
    case 'recovery':
      // A recovery has no prescribed pace even when a legacy row carries one.
      return 'none';
    case 'warmup':
    case 'cooldown':
      return 'ceiling';
    case 'work':
      switch (kind) {
        case 'threshold':
        case 'interval':
        case 'race':
          return 'window';
        case 'easy':
        case 'long':
          return 'ceiling';
        case 'rest':
          return 'none';
        default:
          return 'ceiling';
      }
  }
}

/**
 * The tolerance that rides on one phase's wire record.
 *
 * `null` for a phase with no pace to grade, so a consumer that reads
 * `tolerance != null` as "this phase is pace-graded" is right by construction.
 * A ceiling phase still carries doctrine's E width, because the number is what
 * a legacy client needs to draw its band; the GRADER ignores it.
 */
export function phaseToleranceSec(
  phaseType: PhaseType,
  kind: SessionClass,
  opts?: { hasTarget?: boolean; byEffort?: boolean },
): number | null {
  const shape = paceShapeFor(phaseType, kind, opts);
  if (shape === 'none' || shape === 'effort') return null;
  if (shape === 'ceiling') return EASY_PHASE_TOLERANCE_S_PER_MI;
  return sessionToleranceSec(kind);
}

/* ═════════════════════════════ 4 · the grading rules ════════════════════ */

/**
 * How long into a rep the pace signal is not yet the runner's pace.
 *
 * Two things are settling at once and they happen to have the same order of
 * magnitude:
 *
 *   · the RUNNER. `Research/01` §"Pace zone width and lock-in rules" prescribes
 *     I work "by interval time, not by per-mile pace" precisely because the
 *     first seconds of a rep are an acceleration, not a pace.
 *   · the INSTRUMENT. A wrist GPS pace estimate is a smoothed derivative; its
 *     own settling time after a step change is tens of seconds, which is why a
 *     rep averaging 419 s/mi can spend 325 of its 422 seconds reading outside a
 *     ±8 band. That is the instrument, and grading it was the 2026-09-01 defect.
 *
 * This allowance is why `gradeWorkPhase` grades the SEGMENT AVERAGE and not a
 * share-of-samples: an average over a whole rep absorbs both settlings by
 * construction, which is the same reasoning `drift-monitor` and `run-recap`
 * already apply to heart rate (`Research/03` §2 — HR half-time ≈30 s).
 *
 * It is exported, and it is used, so that a consumer that genuinely must look
 * at samples (the live-run drift indicator on the wrist) has ONE number to
 * skip rather than inventing its own.
 */
export const REP_SETTLE_ALLOWANCE_SEC = 30;

/**
 * Per-phase verdict.
 *
 *   · `hit`         — inside the window, or under the ceiling.
 *   · `fast`        — faster than the window's fast edge, or past a ceiling.
 *   · `slow`        — slower than the window's slow edge. A ceiling phase can
 *                     never return this: slower than a ceiling is correct.
 *   · `incomplete`  — the runner ended the phase before reaching its target.
 *   · `not_graded`  — no pace to grade against. Rule 11's third state, and it
 *                     is NOT a failure.
 */
export type PhaseVerdict = 'hit' | 'fast' | 'slow' | 'incomplete' | 'not_graded';

/**
 * The verdict vocabulary that travels on the wire and sits in `runs.data.phases
 * [].verdict` on rows already in the database.
 *
 * `hit` / `fast` / `slow` / `incomplete` are what a watch build from
 * 2026-09-01 onward emits, and they are `PhaseVerdict` minus `not_graded`
 * (which is expressed on the wire as an ABSENT verdict, not a word — Rule 11's
 * third state, kept distinguishable).
 *
 * `drifted` and `missed` are LEGACY. They are still accepted, because they are
 * on real production rows and a stored fact does not stop having happened, but
 * no build emits them any more:
 *
 *   · `drifted` used to mean "the average landed but under 70% of the
 *     5-second instantaneous samples were inside a ±8 s/mi band". On a 1-mile
 *     GPS rep that is a measurement of the instrument, not of the runner — the
 *     owner's 2026-09-01 reps at 422 / 429 / 422 against a 422-438 window
 *     scored 29% / 57% / 35% and all three came back `drifted`. Raggedness is
 *     real and still travels, as `timeInToleranceSec` /
 *     `timeOutOfToleranceSec`, which `winTimeInTolerance` already renders as
 *     "N% of work time inside the target band". It is no longer a VERDICT,
 *     because at this band width the wrist cannot tell a ragged rep from a
 *     noisy signal, and Rule 11 says do not assert what you cannot measure.
 *   · `missed` conflated two opposite facts. The 2026-09-01 last rep was
 *     `missed` for being THREE SECONDS A MILE QUICKER than the fast edge, on
 *     the rep the watch's own cue had asked him to run at the pace of the
 *     first. `fast` and `slow` are separate words because they are separate
 *     events and they call for opposite coaching.
 */
export type WirePhaseVerdict = 'hit' | 'fast' | 'slow' | 'drifted' | 'missed' | 'incomplete';

/** Every value a stored or incoming phase verdict may hold. */
export const WIRE_PHASE_VERDICTS: readonly WirePhaseVerdict[] =
  Object.freeze(['hit', 'fast', 'slow', 'drifted', 'missed', 'incomplete']);

/** The two words no current build emits — see `WirePhaseVerdict`. */
export const LEGACY_WIRE_VERDICTS: readonly WirePhaseVerdict[] =
  Object.freeze(['drifted', 'missed']);

/**
 * Did this rep land the work?
 *
 * `fast` counts, for the reason `gradeSession` sets out at length: doctrine's
 * own worked example calls a threshold set finishing five seconds past the
 * fast edge upward evidence, and whether a fast rep was a soft target or an
 * overcook is a HEART RATE question this layer does not answer.
 * Legacy `drifted` counts too — its average was in band by definition.
 */
export function wireVerdictLandedTheWork(v: string | null | undefined): boolean {
  return v === 'hit' || v === 'fast' || v === 'drifted';
}

/** Did this rep fall short of the intensity the session existed for? */
export function wireVerdictFellShort(v: string | null | undefined): boolean {
  return v === 'slow' || v === 'missed';
}

/** True for the verdicts that mean the runner did what was asked. */
export function phaseVerdictIsGood(v: PhaseVerdict): boolean {
  return v === 'hit' || v === 'not_graded';
}

/**
 * A work phase, graded on its COMPLETED SEGMENT AVERAGE against the window.
 *
 * The average is the whole rule. The 2026-09-01 grader computed a verdict from
 * the share of 5-second instantaneous samples inside the band and returned
 * "drifted" on three reps whose averages were 422, 429 and 422 against a
 * 422–438 window — every one of them inside it. `Research/01`'s own I row says
 * to judge a rep "by interval time, not by per-mile pace"; the segment average
 * IS the interval time expressed per mile, and the sample share is not.
 */
export function gradeWorkPhase(input: {
  targetSecPerMi: number | null | undefined;
  avgSecPerMi: number | null | undefined;
  toleranceSec: number | null | undefined;
  // COMPLETION-STATE-1 · `null` means "the wire never said" (Rule 11), and
  // must grade exactly as an explicit `true` would — only a confirmed
  // `false` demotes a phase to `incomplete`. Never coerce this upstream of
  // here; that is the bug this type exists to make impossible to reintroduce.
  completed?: boolean | null;
}): PhaseVerdict {
  const { targetSecPerMi: target, avgSecPerMi: avg } = input;
  const tol = input.toleranceSec;
  if (target == null || !(target > 0) || avg == null || !(avg > 0) || tol == null || !(tol > 0)) {
    return 'not_graded';
  }
  if (input.completed === false) return 'incomplete';
  if (avg < target - tol) return 'fast';
  if (avg > target + tol) return 'slow';
  return 'hit';
}

/**
 * A ceiling phase, graded on one question only: did the runner go FASTER than
 * the ceiling.
 *
 * `Research/01` §"When to lock to a specific pace vs. give a range" — "Easy
 * day, base mileage → wide range; effort-anchored" — and Brief 03: "the
 * athlete should never need to speed up merely to satisfy the bottom of an
 * easy range." There is no bottom. A cool-down at 534 s/mi under a 502 ceiling
 * is a correct cool-down and grades `hit`.
 *
 * The one allowance on the fast side is `EASY_PHASE_TOLERANCE_S_PER_MI` —
 * doctrine's own E width — so a warm-up that drifts a few seconds quick on a
 * downhill is not a finding. `Research/01` §9/§11's own easy-run test says the
 * same thing in words: "briefly exceeding the easy ceiling downhill is not a
 * compliance failure — overall effort determines interpretation".
 */
export function gradeCeilingPhase(input: {
  ceilingSecPerMi: number | null | undefined;
  avgSecPerMi: number | null | undefined;
  // COMPLETION-STATE-1 · see `gradeWorkPhase`'s identical parameter.
  completed?: boolean | null;
  slackSec?: number;
}): PhaseVerdict {
  const { ceilingSecPerMi: ceiling, avgSecPerMi: avg } = input;
  if (ceiling == null || !(ceiling > 0) || avg == null || !(avg > 0)) return 'not_graded';
  if (input.completed === false) return 'incomplete';
  const slack = input.slackSec ?? EASY_PHASE_TOLERANCE_S_PER_MI;
  // Faster than the ceiling by more than doctrine's own E slack.
  if (avg < ceiling - slack) return 'fast';
  return 'hit';
}

/** One phase's full description, as every surface holds it. */
export interface GradablePhase {
  phaseType: PhaseType;
  targetSecPerMi?: number | null;
  avgSecPerMi?: number | null;
  toleranceSec?: number | null;
  completed?: boolean;
  byEffort?: boolean;
}

/**
 * THE per-phase entry point. Routes on the shape, so no caller has to remember
 * which phases are ceilings.
 */
export function gradePhase(phase: GradablePhase, kind: SessionClass): PhaseVerdict {
  const shape = paceShapeFor(phase.phaseType, kind, {
    hasTarget: phase.targetSecPerMi != null && phase.targetSecPerMi > 0,
    byEffort: phase.byEffort,
  });
  switch (shape) {
    case 'none':
    case 'effort':
      return 'not_graded';
    case 'ceiling':
      return gradeCeilingPhase({
        ceilingSecPerMi: phase.targetSecPerMi,
        avgSecPerMi: phase.avgSecPerMi,
        completed: phase.completed,
      });
    case 'window':
      return gradeWorkPhase({
        targetSecPerMi: phase.targetSecPerMi,
        avgSecPerMi: phase.avgSecPerMi,
        toleranceSec: phase.toleranceSec ?? sessionToleranceSec(kind),
        completed: phase.completed,
      });
  }
}

/* ═════════════════════════════ 5 · the session verdict ══════════════════ */

/**
 * What the whole session says.
 *
 *   · `executed`   — the work landed. Every graded work phase hit, recoveries
 *                    were run as recoveries, and nothing collapsed late.
 *   · `uneven`     — the work landed but the execution was not controlled:
 *                    some reps outside the window, or a late fade.
 *   · `off_target` — most of the work sat outside the window.
 *   · `incomplete` — the runner did not finish the prescribed work.
 *   · `not_graded` — nothing pace-graded was present. Rule 11's third state.
 */
export type SessionVerdict = 'executed' | 'uneven' | 'off_target' | 'incomplete' | 'not_graded';

export interface SessionGrade {
  verdict: SessionVerdict;
  /** Verdicts of the WORK phases only, in order. */
  workVerdicts: readonly PhaseVerdict[];
  /** Work phases that graded `hit` — inside the window. */
  hits: number;
  /** Work phases that graded `fast`. Reported, never counted as a failure —
   *  see `gradeSession`'s note on why the pace layer does not judge this. */
  fasts: number;
  /** Work phases that were pace-graded at all. */
  graded: number;
  /** True when the LAST graded work phase was materially slower than the
   *  first — doctrine's "late-session deterioration"
   *  (`ADAPTATION_PROGRESSION_DOCTRINE.md` §"Compare intended stimulus vs
   *  actual execution"). */
  lateCollapse: boolean;
  /** True when every recovery that carried a prescribed duration was run
   *  within `RECOVERY_DURATION_TOLERANCE` of it. Null when no recovery
   *  carried one — absence, not compliance. */
  recoveriesHonest: boolean | null;
}

/**
 * How far a recovery's duration may sit from the prescribed one and still be
 * the prescribed recovery.
 *
 * `Research/04` §5.3, quoted in `interpret.ts`'s own `recoveryPreserved`:
 * "lengthening the rest changes the workout. Shortening it makes it harder,
 * which is a different session too." A prescribed 60-second jog run at 61, 64
 * and 64 seconds is the prescribed jog; one run at 180 is a different session.
 * Expressed as a share so it scales from a 60-second jog to a 5-minute one.
 */
export const RECOVERY_DURATION_TOLERANCE = 0.5;

/**
 * How much slower the last graded work phase must be than the first before it
 * counts as a late collapse, as a share of the target.
 *
 * The doctrine names the phenomenon — "executed 6:30/6:32/6:45/7:10 finishing
 * destroyed → NOT evidence threshold should get faster" — and that example is
 * a 40-second spread on a ~390-second target, about 10%. Set at half of the
 * example's own margin so the rule fires before the extreme case it describes,
 * and above the tolerance band so a rep that is merely at the slow edge of the
 * window does not trip it.
 */
export const LATE_COLLAPSE_SHARE = 0.05;

/**
 * THE workout-level verdict: an aggregate of the rep verdicts, plus recovery
 * execution, plus the absence of a late collapse.
 *
 * Ceiling phases (warm-up, cool-down) DO NOT vote. A warm-up graded correctly
 * says nothing about whether the session landed, and letting a cool-down 32
 * s/mi slower than an easy ceiling drag the session's verdict down is the
 * 2026-09-01 defect at the workout level.
 */
export function gradeSession(
  phases: readonly GradablePhase[],
  kind: SessionClass,
  opts?: { recoveries?: readonly { prescribedSec?: number | null; actualSec?: number | null }[] },
): SessionGrade {
  const workPhases = phases.filter((p) => p.phaseType === 'work');
  const workVerdicts = workPhases.map((p) => gradePhase(p, kind));
  const lateCollapse = lateCollapseOf(
    workPhases.map((p) => ({ avgSecPerMi: p.avgSecPerMi, targetSecPerMi: p.targetSecPerMi })),
  );
  const recoveriesHonest = recoveriesHonestOf(opts?.recoveries ?? []);
  return sessionLadder(workVerdicts, { lateCollapse, recoveriesHonest });
}

/**
 * Late collapse · first vs last GRADED work phase, by pace.
 *
 * Exported on its own so `lib/execution/verdict.ts` — which grades each phase
 * once and must not grade it again — can read the same collapse rule off the
 * phases it already holds. ONE definition (Rule 16).
 */
export function lateCollapseOf(
  work: readonly { avgSecPerMi?: number | null; targetSecPerMi?: number | null }[],
): boolean {
  const paced = work.filter(
    (p) => p.avgSecPerMi != null && p.avgSecPerMi > 0 && p.targetSecPerMi != null && p.targetSecPerMi > 0,
  );
  if (paced.length < 3) return false;
  const first = paced[0]!.avgSecPerMi!;
  const last = paced[paced.length - 1]!.avgSecPerMi!;
  return last - first > first * LATE_COLLAPSE_SHARE;
}

/**
 * Recovery execution · absence is absence (Rule 11), never compliance.
 * Exported for the same reason as `lateCollapseOf`.
 */
export function recoveriesHonestOf(
  recs: readonly { prescribedSec?: number | null; actualSec?: number | null }[],
): boolean | null {
  const known = recs.filter(
    (r) => r.prescribedSec != null && r.prescribedSec > 0 && r.actualSec != null && r.actualSec > 0,
  );
  if (known.length === 0) return null;
  return known.every(
    (r) => Math.abs(r.actualSec! - r.prescribedSec!) <= r.prescribedSec! * RECOVERY_DURATION_TOLERANCE,
  );
}

/**
 * THE session ladder, over per-phase verdicts that were graded ONCE.
 *
 * `gradeSession` grades and then calls this; `lib/execution/verdict.ts`
 * grades through `gradePhase` per resolved shape and then calls this. Two
 * callers, one ladder — the second implementation of it is the thing this
 * export exists to prevent.
 */
export function sessionLadder(
  workVerdicts: readonly PhaseVerdict[],
  ctx: { lateCollapse: boolean; recoveriesHonest: boolean | null },
): SessionGrade {
  const graded = workVerdicts.filter((v) => v !== 'not_graded').length;
  const hits = workVerdicts.filter((v) => v === 'hit').length;
  const fasts = workVerdicts.filter((v) => v === 'fast').length;
  const incomplete = workVerdicts.some((v) => v === 'incomplete');
  /* WHY `fast` COUNTS AS LANDED, and `slow` does not.
   *
   * `ADAPTATION_PROGRESSION_DOCTRINE.md` §"Compare intended stimulus vs actual
   * execution" gives the worked example itself: `4×1mile threshold @
   * 6:50-7:00` executed `6:49/6:48/6:47/6:45` with controlled HR is UPWARD
   * evidence — and 6:45 is five seconds PAST the window's fast edge. A
   * controlled negative split that finishes a touch quick is the shape the
   * mission statement exists for ("there's a world where we push forward"),
   * and the 2026-09-01 session is exactly it: 422 / 429 / 422 / 419 against
   * 430, the last rep the fastest, HR climbing 158 → 166 and never touching
   * the 173 bail.
   *
   * Running FASTER than a threshold target is genuinely ambiguous, and
   * `lib/training/threshold-band.ts` already names the two readings and their
   * discriminator: faster with HR inside the band is a soft target; faster
   * with HR above it is an overcook. The discriminator is HEART RATE, which
   * this module deliberately does not read (see the Rule 22 note in the
   * header). So the pace layer records `fast`, refuses to call it a failure,
   * and hands the ambiguity to the reader that can actually settle it.
   *
   * `slow` is not symmetric with it and must not be treated as such: a rep
   * under the intensity did not deliver the stimulus the session existed for,
   * and no other reader is going to discover that later. */
  const landed = hits + fasts;
  const { lateCollapse, recoveriesHonest } = ctx;

  let verdict: SessionVerdict;
  if (graded === 0) verdict = 'not_graded';
  else if (incomplete) verdict = 'incomplete';
  else if (landed === graded && !lateCollapse && recoveriesHonest !== false) verdict = 'executed';
  else if (landed * 2 >= graded) verdict = 'uneven';
  else verdict = 'off_target';

  return { verdict, workVerdicts, hits, fasts, graded, lateCollapse, recoveriesHonest };
}

/* ═════════════════════════════ 6 · display words ════════════════════════ */

/**
 * What the runner READS for one phase. The 2026-09-01 defect was as much a
 * copy defect as an arithmetic one — "missed" was shown on a cool-down that
 * was correct, and "missed" reads as TOO SLOW to a runner who was in fact 3
 * s/mi too fast.
 *
 * Rule 16: a sentence asserting a fact about a measurement is gated on that
 * measurement. So a ceiling phase never gets a two-sided word, and a phase
 * that was not graded gets no word at all rather than a neutral-sounding one.
 */
export function phaseVerdictLabel(
  verdict: PhaseVerdict,
  shape: PaceShape,
): string | null {
  if (verdict === 'not_graded') return null;
  if (verdict === 'incomplete') return 'Ended early';
  if (shape === 'ceiling') {
    return verdict === 'fast' ? 'Over the ceiling' : 'Under the ceiling';
  }
  switch (verdict) {
    case 'hit': return 'On target';
    case 'fast': return 'Quicker than target';
    case 'slow': return 'Slower than target';
    default: return null;
  }
}

/* ══════════════════ 7 · how much of the session landed ═══════════════════ */

/**
 * THE completion ladder. Three lines on ONE scale, so they cannot contradict
 * each other, and each one still answers its own question.
 *
 * F-14 · these were three constants in two files with no relationship stated
 * between them, and an 8 mi threshold run at 5.0 mi (62.5%) got three answers:
 * `adapt.ts` counted it DONE and let the plan proceed, `interpretExecution`
 * recorded `PARTIAL_*`, and the phone drew an uncoloured "asked 8 mi · 5.00"
 * row. Nobody was wrong. They were answering different questions and nothing
 * said so, which is how "did he hit it" ended up with four incompatible
 * answers and none of them shown.
 *
 * The three questions, in order up the same scale:
 *
 *   · `FRAGMENT_BELOW` (0.40) — below this the run stops being a version of
 *     the prescription and becomes a fragment of it. `interpret.ts`'s
 *     `PARTIAL_FLOOR`.
 *   · `COUNTS_AS_DONE` (0.60) — at or above this the session is not MISSED
 *     and the plan does not reschedule it. `adapt.ts`'s `completionThresholdMi`.
 *     Cite: `Research/22-plan-templates.md` §14 — a 70%-volume comeback week
 *     still banks the stimulus, so 60% of a prescription is a
 *     completed-enough session, not a missed one.
 *   · `SAME_STIMULUS_WITHIN` (0.25, i.e. the 0.75-1.25 band) — inside this the
 *     delivered work IS the intended stimulus. `interpret.ts`'s
 *     `EQUIVALENT_WORK_TOLERANCE`. Cite: `Research/04` §5.1 prescribes
 *     threshold sessions at 4-8 mi at pace and VO2 sessions at 3-6 mi — bands
 *     with a 2× and a 1.5× span — so doctrine treats every point inside those
 *     as the same session, and this is the tighter of the two spans expressed
 *     as a symmetric tolerance.
 *
 * NOT MISSED and FULL STIMULUS are deliberately different lines, and that is
 * the resolution rather than the defect: a 62.5% session is correctly "not
 * rescheduled" AND "a partial stimulus" at the same time. What was missing was
 * anywhere that said so. `_execution_semantics_owner.test.ts` asserts the
 * ordering, so a future edit cannot invert them silently.
 */
export const COMPLETION_LADDER = Object.freeze({
  FRAGMENT_BELOW: 0.4,
  COUNTS_AS_DONE: 0.6,
  SAME_STIMULUS_WITHIN: 0.25,
});

/**
 * Where one completed session sits on the ladder. Pure, and the only place
 * the three lines are compared to a number.
 */
export type CompletionBand = 'fragment' | 'partial' | 'as_prescribed' | 'over';

export function completionBand(share: number | null | undefined): CompletionBand | null {
  if (share == null || !Number.isFinite(share) || share < 0) return null;
  if (share < COMPLETION_LADDER.FRAGMENT_BELOW) return 'fragment';
  if (share > 1 + COMPLETION_LADDER.SAME_STIMULUS_WITHIN) return 'over';
  if (share >= 1 - COMPLETION_LADDER.SAME_STIMULUS_WITHIN) return 'as_prescribed';
  return 'partial';
}

/** Did enough of the prescription land that the plan should NOT treat this
 *  day as missed? The scheduling question, and only that one. */
export function countsAsDone(share: number | null | undefined): boolean {
  return share != null && Number.isFinite(share) && share >= COMPLETION_LADDER.COUNTS_AS_DONE;
}

/* ══════════════════ 8 · heart rate against a prescribed cap ══════════════ */

/**
 * How far above a prescribed HR cap a reading may sit and still be inside the
 * band that cap was derived FROM.
 *
 * DERIVED, NOT CHOSEN. `zones.ts#aerobicCeilingBpm` is
 * `ceil(lthr × 0.90) − 1` — the printed cap is deliberately ONE BEAT BELOW
 * the true zone seam, so that the cap itself reads as "inside Z2". A run
 * averaging `cap + 1` is therefore still inside the zone the cap describes,
 * and calling it a breach contradicts the zone bar drawn beside it. `cap + 2`
 * is over the seam and is a real breach.
 *
 * F-14 · before this the same question had two answers in ONE FILE.
 * `run-recap.ts` coached a LONG run at `avg > cap` and an EASY run at
 * `avg > cap + 5`, while the phone row (`v5-today.ts`) and the watch row
 * (`build-workout.ts`) both toned at `avg > cap`. So an easy run at cap 145,
 * avg 148 drew an amber "Heart · under 145 · 148" and then, three lines
 * below, said nothing about heart rate at all — the same screen contradicting
 * itself. The +5 was the outlier and it is gone; every site now reads this.
 */
export const HR_CAP_GRACE_BPM = 1;

/** Did this run's average heart rate breach its prescribed cap? */
export function hrCapBreached(
  avgHrBpm: number | null | undefined,
  capBpm: number | null | undefined,
): boolean {
  if (avgHrBpm == null || !(avgHrBpm > 0) || capBpm == null || !(capBpm > 0)) return false;
  return avgHrBpm > capBpm + HR_CAP_GRACE_BPM;
}
