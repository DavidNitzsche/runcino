/**
 * lib/training/expand-spec.ts · the SINGLE source for expanding a
 * plan_workouts.workout_spec into the flat phase list every consumer
 * needs (watch payload, today purpose, recap deltas, brief copy).
 *
 * iPhone agent 2026-06-02 brief flagged the bug class:
 *   buildWatchToday was calling `prescriptionFor()` (generic template)
 *   instead of expanding `workout_spec` (authored truth). David's watch
 *   was showing "6×800m @ 90s" when his spec said "4×1mi @ 180s."
 *
 * Architecture (per iPhone brief Tier 2):
 *   · workout_spec is the source of truth (authored by generator)
 *   · expandSpecToPhases(spec) → WatchPhase[] is the ONLY path that
 *     turns a spec into a phase list
 *   · every consumer calls this · no other code path generates phases
 *   · prescriptionFor() becomes a fallback ONLY when spec is null
 *     (cold start, pre-migration rows · backfill cron handles these)
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md
 * Cite: designs/briefs/iphone-workout-spec-single-source-2026-06-02.md
 */

import type { WorkoutSpec } from '@/lib/plan/spec-builder';

export type ExpandedPhaseType = 'warmup' | 'work' | 'recovery' | 'cooldown';

export interface ExpandedPhase {
  type: ExpandedPhaseType;
  label: string;
  /** Optional · for distance-based phases (rep N of M, WU/CD). When
   *  set, also set durationSec via durationFromDistance(). */
  distanceMi?: number | null;
  /** Optional · for time-based phases (jog recovery, time-only intervals). */
  durationSec?: number | null;
  /** Target pace · null for recovery / unstructured. */
  targetPaceSPerMi?: number | null;
  /** Tolerance band around target · pace ± this still counts as "on pace". */
  tolerancePaceSPerMi?: number | null;
  /** 2026-06-08 · True only on the closing HM/M pace segment of a long run
   *  (set by expandLong when the spec carries finish_mi). Consumers route it
   *  to a FINISH face instead of the rep face. Absent/false everywhere else. */
  isFinishSegment?: boolean;
  /** DOCTRINE-STRIDES-1 · 2026-08-17 · True on each of the 4-8 short
   *  accelerations appended to an easy run, shakeout or standalone strides
   *  day (set by appendStrides when the spec carries strides_reps).
   *  Absent/false everywhere else, so it follows the same optional-field
   *  contract as isFinishSegment: a client that has never heard of strides
   *  sees ordinary short work phases and runs them correctly. */
  isStrideSegment?: boolean;
}

export interface ExpandSpecInput {
  spec: WorkoutSpec;
  /** Total distance the runner will cover · used to size easy/long/recovery
   *  bars + to validate total = WU + core + CD where applicable. */
  totalMi: number;
  /** Easy-pace anchor when the spec doesn't include pace targets
   *  (WU/CD always use easy pace). seconds/mi.
   *  P1-47 fix 2026-07-06 · null means "no fitness signal" — WU/CD/recovery
   *  phases then go out BY FEEL (targetPaceSPerMi: null) instead of a
   *  fabricated number. Callers derive this from the runner's OWN easy pace
   *  (plan-authored easy band · Research/01-pace-zones-vdot.md §E-pace),
   *  never from goal race pace or a fixed constant. */
  easyPaceSec: number | null;
  /** Recovery jog pace · seconds/mi. Jog recoveries are easy jogging
   *  (Research/04-workout-vocabulary.md §1 recovery runs) — callers pass
   *  the same easy anchor. null → by-feel recovery (no pace target). */
  recoveryPaceSec?: number | null;
  /** Default tolerance per phase type · in seconds/mi. */
  toleranceSec?: number;
  /** Optional phase-label override for types that need a name other than
   *  the generic "N mi long run" / "N mi easy". Pass "Race effort" for
   *  race workouts and "Shakeout" for shakeout workouts. Internal label
   *  only — no behavior change. */
  workPhaseLabel?: string;
}

/**
 * The half-width of the band actually in force — the ONE definition of it.
 *
 * BAND-WIDEN-1 (2026-08-30) · this was written out three times, identically,
 * as `Math.max(tolerance, Math.round((hi - lo) / 2))` — in `expandLong`,
 * `expandEasy` and `expandRecovery`. A MAX over two candidate bounds always
 * returns the more permissive one, which is the same shape the doctrine
 * registry already carries as a known violation for `hrCapEasy` ("a ceiling
 * assembled from two candidate ceilings must take the lower, or the looser
 * system always wins"). Here it meant the watch drew a band the plan did not
 * author whenever the authored one was TIGHTER than the caller's per-class
 * default.
 *
 * Rendered on the owner's real 2026-08-30 long run: the plan authored
 * 517-552 s/mi (8:37-9:12), the watch computed mid 535 and then widened the
 * half-width from 18 to the long-run default of 20, drawing 8:35-9:15. The
 * runner is told "on target" three seconds per mile outside the band the plan
 * actually set. Rule 16 — the plan and the wrist must not name one band and
 * show another.
 *
 * It went unnoticed because on an EASY day it is invisible by coincidence:
 * the authored easy band 542-582 has a half-width of exactly 20, which is
 * also the easy default, so `Math.max` returned the same number either way
 * and the board rendered correctly. That coincidence is what this removes —
 * the band in force is the band, authored or derived, and there is no second
 * candidate for the MAX to prefer.
 *
 * The caller's `toleranceSec` keeps its real job in `expandTempo` and
 * `expandReps`, where a work phase carries a single target and no band, so a
 * per-class tolerance is the only thing there is. It has no role here, which
 * is why the three functions below no longer take it: an unused parameter is
 * an invitation to reintroduce exactly this.
 *
 * ONE SECOND OF SLACK, DELIBERATELY. The wire carries a target plus a
 * SYMMETRIC tolerance, so a band of odd width cannot be represented exactly:
 * the owner's 517-552 has a half-width of 17.5, and mid rounds to 535. Rounding
 * the half-width UP to 18 draws 517-553 — one second wide at the slow end.
 * Rounding down to 17 would draw 518-552, which is one second TIGHT at the fast
 * end and would call 8:37/mi off-target on a day the plan explicitly allows it.
 * Telling a runner he has missed a band he is inside is the worse error, so the
 * rounding errs wide, and never excludes a pace the plan authored.
 */
function bandToleranceSec(lo: number | null, hi: number | null): number | null {
  if (lo == null || hi == null) return null;
  return Math.max(1, Math.round((hi - lo) / 2));
}

/**
 * Expand a workout_spec into a flat phase list. Pure function ·
 * deterministic · no DB. Returns null when the spec is null or
 * unrecognized · caller should fall back to a generic prescription.
 *
 * Coverage:
 *   · tempo       · WU + tempo block + CD
 *   · threshold   · WU + (rep + recovery) × N (last rep no recovery) + CD
 *   · intervals   · same as threshold (different paces)
 *   · long        · single work block · optional fuel-mi markers
 *   · easy        · single work block
 *   · recovery    · single recovery-paced block
 *   · race        · single work block at race pace
 *
 * For threshold + intervals, the recovery between reps is a TIME-based
 * phase (rep_rest_s) at the recovery pace. The watch UI advances by
 * timer, not by GPS distance, for those phases.
 */
export function expandSpecToPhases(input: ExpandSpecInput): ExpandedPhase[] | null {
  const { spec, totalMi, easyPaceSec } = input;
  if (!spec || typeof spec !== 'object') return null;

  const s = spec as Record<string, unknown>;
  const kind = String(s.kind ?? '');
  // P1-47 fix 2026-07-06 · no 9:00/mi default. When the caller has no real
  // easy-pace anchor, recovery phases carry no pace target (by feel) — a
  // 12:00/mi runner was being handed a 9:00/mi jog-recovery target.
  const recoveryPace = input.recoveryPaceSec ?? input.easyPaceSec ?? null;
  const defaultTolerance = input.toleranceSec ?? 12;

  switch (kind) {
    case 'tempo':
      return expandTempo(s, easyPaceSec, defaultTolerance);
    case 'threshold':
    case 'intervals':
      return expandReps(s, easyPaceSec, recoveryPace, defaultTolerance);
    case 'long':
      return expandLong(s, totalMi, easyPaceSec, input.workPhaseLabel);
    case 'easy':
    case 'shakeout':
    case 'strides':
      // DOCTRINE-STRIDES-1 · the run is an easy run either way; strides are
      // appended when the spec carries them (Research/04 §7.2 §Placement,
      // "End of an easy run").
      return appendStrides(
        expandEasy(s, totalMi, easyPaceSec, input.workPhaseLabel),
        s,
        recoveryPace,
      );
    case 'recovery':
      return expandRecovery(s, totalMi, recoveryPace);
    default:
      return null;
  }
}

/**
 * DOCTRINE-STRIDES-1 (2026-08-17) · append the stride reps a spec carries.
 *
 * `Research/04-workout-vocabulary.md` §7.2 · 4-8 × 15-30 s at mile-to-5K race
 * pace, "Full walk-back or 60–90 s jog — no fatigue between strides", placed at
 * the "End of an easy run". So they go after the easy block, each followed by
 * its own recovery — including the last one, because the walk-back is what
 * makes the next stride possible and the runner is going to take it whether or
 * not the watch counts it.
 *
 * Time-based, not distance-based: a 20-second stride covers ~90 m, which GPS
 * cannot resolve, so `distanceMi` stays null and `build-workout.ts` marks the
 * phase `repUnit: 'time'` — the same treatment the jog recoveries between
 * intervals already get. No wire change was needed for the watch to run these.
 *
 * A spec with no `strides_reps` returns the phases untouched.
 */
function appendStrides(
  phases: ExpandedPhase[],
  s: Record<string, unknown>,
  recoveryPace: number | null,
): ExpandedPhase[] {
  const reps = Number(s.strides_reps ?? 0) || 0;
  if (reps <= 0) return phases;
  const durationSec = Number(s.strides_duration_s ?? 0) || 20;
  const stridePace = Number(s.strides_pace_s_per_mi) || null;
  const recoverySec = Number(s.strides_recovery_s ?? 0) || 60;

  for (let i = 0; i < reps; i++) {
    phases.push({
      type: 'work',
      label: `Stride ${i + 1} of ${reps}`,
      distanceMi: null,
      durationSec,
      targetPaceSPerMi: stridePace,
      // Doctrine calls a stride "relaxed", "~85-95% max effort" and explicitly
      // "Not a workout" (§7.2). A tight pace gate would turn a form drill into
      // something to chase, so the band is deliberately wide.
      tolerancePaceSPerMi: stridePace != null ? 45 : null,
      isStrideSegment: true,
    });
    phases.push({
      type: 'recovery',
      label: 'Walk back',
      distanceMi: null,
      durationSec: recoverySec,
      targetPaceSPerMi: recoveryPace,
      tolerancePaceSPerMi: recoveryPace != null ? 60 : null,
    });
  }
  return phases;
}

// ── per-kind expanders ─────────────────────────────────────────────────

/** Internal duration ESTIMATE (s/mi) used ONLY to size durationSec when no
 *  pace anchor exists — the wire contract requires durationSec even for
 *  by-feel phases. Never emitted as a pace target (P1-47 · 2026-07-06). */
const DURATION_EST_S_PER_MI = 540;

function expandTempo(
  s: Record<string, unknown>,
  easyPaceSec: number | null,
  tolerance: number,
): ExpandedPhase[] {
  const wu = Number(s.warmup_mi ?? 1.5) || 1.5;
  const tempoMi = Number(s.tempo_distance_mi ?? 4) || 4;
  const cd = Number(s.cooldown_mi ?? 1.0) || 1.0;
  // Legacy fallback (spec without tempo pace): T ≈ E − 80 inverts the
  // spec-builder easy offset (easy lo = T + 80 · Research/01 §T-pace).
  // Null easy anchor → by-feel tempo, never a fabricated number.
  //
  // COLD-4 · `by_effort` is DELIBERATE absence, not missing data, so it must
  // beat the easy-anchor fallback. A calibration-intro tempo whose pace we
  // declined to state would otherwise come back out of the expander as
  // easy−80 — the fabrication re-derived one layer down, which is the exact
  // shape of the P1-56 bug class this file has already paid for twice.
  const byEffort = s.by_effort === true;
  const tempoPace = byEffort
    ? null
    : (Number(s.tempo_pace_s_per_mi) || (easyPaceSec != null ? easyPaceSec - 80 : null));
  const easyEst = easyPaceSec ?? DURATION_EST_S_PER_MI;
  return [
    {
      type: 'warmup',
      label: 'Warm-up',
      distanceMi: Number(wu.toFixed(1)),
      durationSec: Math.round(wu * easyEst),
      targetPaceSPerMi: easyPaceSec,
      tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
    },
    {
      type: 'work',
      // DOCTRINE-TAPERMP-1 · an "@ MP" block is a marathon-pace rehearsal, and
      // the watch phase must say so. Every other tempo spec carries no `label`
      // and reads exactly as before.
      label: /@\s*MP\b/i.test(String(s.label ?? ''))
        ? `${tempoMi.toFixed(1)} mi @ MP`
        : `${tempoMi.toFixed(1)} mi tempo`,
      distanceMi: Number(tempoMi.toFixed(1)),
      durationSec: Math.round(tempoMi * (tempoPace ?? DURATION_EST_S_PER_MI)),
      targetPaceSPerMi: tempoPace,
      tolerancePaceSPerMi: tempoPace != null ? tolerance : null,
    },
    {
      type: 'cooldown',
      label: 'Cool-down',
      distanceMi: Number(cd.toFixed(1)),
      durationSec: Math.round(cd * easyEst),
      targetPaceSPerMi: easyPaceSec,
      tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
    },
  ];
}

/**
 * GRAMMAR-SEQ-1 (2026-08-19) · the phases of an unequal-step session.
 *
 * §13's ladders, §9.2's Mona fartlek, §10.1's alternations, §10.2's combos and
 * §12.4's 5K progression differ from a rep set in exactly one way: the steps are
 * not all the same. They are otherwise ordinary work-and-recovery, and that is
 * the whole reason this needs NO WIRE CHANGE.
 *
 * The watch decodes a flat list of `WatchPhase` — type, label, duration,
 * optional distance, optional pace target. A ladder is a flat list of work
 * phases with different distances and different paces, which is a thing the
 * watch has been able to run since the day it shipped: `build-workout.ts` marks
 * a phase `repUnit: 'distance'` when it carries `distanceMi` and `'time'` when
 * it does not, exactly as it already does for a hill rep and its jog float.
 * The `steps` array never leaves the server.
 *
 * A step with `rest_s` of zero emits no recovery phase, which is what makes
 * §10.1's alternation continuous — "Recovery | None — continuous" — rather than
 * a rep set with the rest set to nothing.
 */
function expandSteps(
  s: Record<string, unknown>,
  easyPaceSec: number | null,
  recoveryPace: number | null,
  tolerance: number,
): ExpandedPhase[] | null {
  const raw = Array.isArray(s.steps) ? (s.steps as Array<Record<string, unknown>>) : null;
  if (!raw || raw.length === 0) return null;

  const wu = Number(s.warmup_mi ?? 1.5) || 1.5;
  const cd = Number(s.cooldown_mi ?? 1.0) || 1.0;
  const easyEst = easyPaceSec ?? DURATION_EST_S_PER_MI;
  const byEffort = s.by_effort === true;
  const phases: ExpandedPhase[] = [];

  phases.push({
    type: 'warmup',
    label: 'Warm-up',
    distanceMi: Number(wu.toFixed(1)),
    durationSec: Math.round(wu * easyEst),
    targetPaceSPerMi: easyPaceSec,
    tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
  });

  raw.forEach((step, i) => {
    const mi = Number(step?.distance_mi ?? 0) || 0;
    const durationS = Number(step?.duration_s ?? 0) || 0;
    const pace = byEffort ? null : (Number(step?.pace_s_per_mi) || null);
    const zone = typeof step?.zone === 'string' && step.zone ? String(step.zone) : null;
    // Doctrine states a step in EITHER a distance or a duration, and the phase
    // is counted in the unit the workout was written in. §9.2 sizes Mona's reps
    // in seconds because "90 s hard" is the instruction; the spec still carries
    // the miles those seconds cover so the day's mileage adds up, but the phase
    // goes out time-based and `build-workout.ts` marks it repUnit:'time' —
    // exactly what a hill rep already does.
    const timed = durationS > 0;
    const size = timed ? formatSec(durationS) : formatRepLabel(mi);
    phases.push({
      type: 'work',
      label: `${size}${zone ? ` @ ${zone}` : ''} · ${i + 1} of ${raw.length}`,
      distanceMi: timed ? null : Number(mi.toFixed(2)),
      durationSec: timed
        ? Math.round(durationS)
        : Math.round(mi * (pace ?? DURATION_EST_S_PER_MI)),
      targetPaceSPerMi: pace,
      tolerancePaceSPerMi: pace != null ? tolerance : null,
    });
    const restS = Number(step?.rest_s ?? 0) || 0;
    // Zero recovery is doctrine, not a missing field: §10.1's alternations and
    // §12.4's progression are continuous, and emitting a nil-length recovery
    // phase would put a transition haptic in the middle of an unbroken effort.
    if (restS > 0 && i < raw.length - 1) {
      phases.push({
        type: 'recovery',
        label: `Jog ${formatSec(restS)}`,
        distanceMi: null,
        durationSec: restS,
        targetPaceSPerMi: recoveryPace,
        tolerancePaceSPerMi: recoveryPace != null ? 60 : null,
      });
    }
  });

  phases.push({
    type: 'cooldown',
    label: 'Cool-down',
    distanceMi: Number(cd.toFixed(1)),
    durationSec: Math.round(cd * easyEst),
    targetPaceSPerMi: easyPaceSec,
    tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
  });
  return phases;
}

function expandReps(
  s: Record<string, unknown>,
  easyPaceSec: number | null,
  recoveryPace: number | null,
  tolerance: number,
): ExpandedPhase[] {
  // GRAMMAR-SEQ-1 · an unequal-step session first. A spec with no `steps` is
  // byte-identical to before.
  const stepped = expandSteps(s, easyPaceSec, recoveryPace, tolerance);
  if (stepped) return stepped;
  const wu = Number(s.warmup_mi ?? 1.5) || 1.5;
  const cd = Number(s.cooldown_mi ?? 1.0) || 1.0;
  const reps = Number(s.rep_count ?? 4) || 4;
  // Field precedence · prefer _mi · fall back to _m / 1609.34 (legacy rows).
  const repMi = Number(s.rep_distance_mi ?? 0) || 0;
  const repM = Number(s.rep_distance_m ?? 0) || 0;
  const effRepMi = repMi > 0 ? repMi : (repM / 1609.34);
  // Null easy anchor → by-feel rep target (legacy specs without a rep pace
  // AND no fitness signal) — never a fabricated number (P1-47).
  // DOCTRINE-VOCAB-1 · hills and fartlek carry rep_duration_s instead of a rep
  // distance (Research/04 §8.1, §9.1). `by_effort` marks the sets doctrine
  // prescribes by effort rather than pace — §8.1's pace column is "5K–10K
  // effort", never a number, because a flat-ground pace is unreachable uphill.
  const repDurationS = Number(s.rep_duration_s ?? 0) || 0;
  const byEffort = s.by_effort === true;
  const repPace = byEffort
    ? null
    : (Number(s.rep_pace_s_per_mi) || (easyPaceSec != null ? easyPaceSec - 80 : null));
  // COLD-4 · `by_effort` used to be synonymous with "this is a hill session",
  // because hills were the only thing that set it. The calibration intro now
  // sets it on ordinary threshold and interval reps, so the WORD has to come
  // from the workout's own identity (the authored label a time-rep spec
  // carries) rather than from the pace being absent — otherwise a cold-start
  // runner's first threshold session tells them to run hills.
  const isHillRep = /hill/i.test(String(s.label ?? ''));
  const restS = Number(s.rep_rest_s ?? 60) || 60;
  const easyEst = easyPaceSec ?? DURATION_EST_S_PER_MI;
  const phases: ExpandedPhase[] = [];

  phases.push({
    type: 'warmup',
    label: 'Warm-up',
    distanceMi: Number(wu.toFixed(1)),
    durationSec: Math.round(wu * easyEst),
    targetPaceSPerMi: easyPaceSec,
    tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
  });

  for (let i = 0; i < reps; i++) {
    phases.push(repDurationS > 0
      // Time-based rep · distanceMi stays null so build-workout marks it
      // repUnit:'time' and the watch counts the rep down by the clock, the
      // same way it already handles the jog recoveries below.
      ? {
          type: 'work',
          label: `${isHillRep ? 'Hill' : 'Rep'} ${i + 1} of ${reps} · ${formatSec(repDurationS)}`,
          distanceMi: null,
          durationSec: repDurationS,
          targetPaceSPerMi: repPace,
          tolerancePaceSPerMi: repPace != null ? tolerance : null,
        }
      : {
          type: 'work',
          label: `Interval · ${formatRepLabel(effRepMi)}`,
          distanceMi: Number(effRepMi.toFixed(2)),
          durationSec: Math.round(effRepMi * (repPace ?? DURATION_EST_S_PER_MI)),
          targetPaceSPerMi: repPace,
          tolerancePaceSPerMi: repPace != null ? tolerance : null,
        });
    // Recovery between reps (not after last)
    if (i < reps - 1) {
      phases.push({
        type: 'recovery',
        label: `Jog ${formatSec(restS)}`,
        distanceMi: null,
        durationSec: restS,
        targetPaceSPerMi: recoveryPace,
        tolerancePaceSPerMi: recoveryPace != null ? 60 : null,
      });
    }
  }

  phases.push({
    type: 'cooldown',
    label: 'Cool-down',
    distanceMi: Number(cd.toFixed(1)),
    durationSec: Math.round(cd * easyEst),
    targetPaceSPerMi: easyPaceSec,
    tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
  });
  return phases;
}

function expandLong(
  s: Record<string, unknown>,
  totalMi: number,
  easyPaceSec: number | null,
  workPhaseLabel?: string,
): ExpandedPhase[] {
  // Spec band first (authored truth) · else the easy anchor · else by feel
  // (null target — P1-47, no fabricated pace).
  const specLo = Number(s.pace_target_s_per_mi_lo) || null;
  const specHi = Number(s.pace_target_s_per_mi_hi) || null;
  const lo = specLo ?? (easyPaceSec != null ? easyPaceSec - 30 : null);
  const hi = specHi ?? (easyPaceSec != null ? easyPaceSec + 30 : null);
  const mid = lo != null && hi != null ? Math.round((lo + hi) / 2) : null;
  const easyTol = bandToleranceSec(lo, hi);

  // VARIETY-LONG-1 (2026-08-28) · a progression long (Research/04 §4.3) walks
  // TWO paces after the easy bulk — an M middle and a T tail — carried on the
  // spec as `finish_segments`. Expanded first, because the legacy single
  // fields also exist on such a spec (they carry the first segment, for
  // consumers that predate the list) and expanding those instead would run
  // the tail at the middle's pace. Each segment is a work phase with its own
  // target and the finish routing flag, so the watch runs easy → M → T as
  // three phases with no wire change — a flat phase list is all it ever sees.
  const rawSegments = Array.isArray(s.finish_segments)
    ? (s.finish_segments as Array<Record<string, unknown>>)
    : null;
  if (rawSegments && rawSegments.length >= 2) {
    const segs = rawSegments
      .map((seg) => ({
        mi: Number(seg?.mi) || 0,
        pace: Number(seg?.pace_s_per_mi) || 0,
        label: String(seg?.label ?? '').trim(),
        // SEGLONG-1 · easy running that follows THIS block. Absent on every
        // contiguous long run, which is every long run authored before
        // segmented longs existed.
        recoveryMi: Number(seg?.recovery_mi) || 0,
      }))
      .filter((seg) => seg.mi > 0 && seg.pace > 0);
    const segTotal = segs.reduce((a, seg) => a + seg.mi, 0);
    // The gaps come OUT of the opening bulk rather than being added to the
    // day: the label's numbers already account for the whole run, so counting
    // recovery miles on top would inflate the session past its own distance.
    const recoveryTotal = segs.reduce((a, seg) => a + seg.recoveryMi, 0);
    if (segs.length >= 2 && segTotal > 0 && segTotal + recoveryTotal < totalMi) {
      const bulkMi = Number((totalMi - segTotal - recoveryTotal).toFixed(1));
      const paceWord = (label: string) =>
        label === 'M' ? 'marathon pace'
        : label === 'HM' ? 'half marathon pace'
        : label === 'T' ? 'threshold pace'
        : label ? `${label} pace` : 'race pace';
      const phases: ExpandedPhase[] = [{
        type: 'work',
        label: `${bulkMi.toFixed(1)} mi easy`,
        distanceMi: bulkMi,
        durationSec: Math.round(bulkMi * (mid ?? DURATION_EST_S_PER_MI)),
        targetPaceSPerMi: mid,
        tolerancePaceSPerMi: easyTol,
      }];
      for (const seg of segs) {
        phases.push({
          type: 'work',
          label: `${seg.mi.toFixed(1)} mi @ ${paceWord(seg.label)}`,
          distanceMi: Number(seg.mi.toFixed(1)),
          durationSec: Math.round(seg.mi * seg.pace),
          targetPaceSPerMi: seg.pace,
          tolerancePaceSPerMi: 12,
          isFinishSegment: true,
        });
        // SEGLONG-1 · the gap that makes a segmented long run segmented.
        //
        // Its own phase, at easy pace, so the watch prompts the runner back
        // down rather than leaving them to guess when the block ended — and so
        // the phase list reads the way the session was written: block, easy,
        // block. `isFinishSegment` is deliberately NOT set; this is recovery,
        // and the finish-routing flag is what marks the parts of the day the
        // session is judged on.
        if (seg.recoveryMi > 0) {
          phases.push({
            type: 'work',
            label: `${seg.recoveryMi.toFixed(1)} mi easy`,
            distanceMi: Number(seg.recoveryMi.toFixed(1)),
            durationSec: Math.round(seg.recoveryMi * (mid ?? DURATION_EST_S_PER_MI)),
            targetPaceSPerMi: mid,
            tolerancePaceSPerMi: easyTol,
          });
        }
      }
      return phases;
    }
  }

  // 2026-06-07 · Audit D / D1 · race-specific + LT-phase long runs carry a
  // faster finish (last N mi @ HM/M pace). Split into easy-build + finish
  // so the watch executes — and guards — each correctly, instead of one
  // flat phase under a label that promised the finish. Cite: Research/22 §3.
  const finishMi = Number(s.finish_mi) || 0;
  const finishPace = Number(s.finish_pace_s_per_mi) || 0;
  if (finishMi > 0 && finishPace > 0 && finishMi < totalMi) {
    const easyMi = Number((totalMi - finishMi).toFixed(1));
    const finishLabel = String(s.finish_label ?? '').trim();
    const finishPaceLabel = finishLabel === 'M' ? 'marathon pace'
      : finishLabel === 'HM' ? 'half marathon pace'
      : finishLabel === 'T' ? 'tempo pace'
      : finishLabel ? `${finishLabel} pace` : 'race pace';
    const finishTag = `@ ${finishPaceLabel}`;
    return [
      {
        type: 'work',
        label: `${easyMi.toFixed(1)} mi easy`,
        distanceMi: easyMi,
        durationSec: Math.round(easyMi * (mid ?? DURATION_EST_S_PER_MI)),
        targetPaceSPerMi: mid,
        tolerancePaceSPerMi: easyTol,
      },
      {
        type: 'work',
        label: `${finishMi.toFixed(1)} mi ${finishTag}`,
        distanceMi: Number(finishMi.toFixed(1)),
        durationSec: Math.round(finishMi * finishPace),
        targetPaceSPerMi: finishPace,
        // Finish is race-pace quality work · tighter band than the easy
        // build (never looser than 12 s/mi, the tempo tolerance).
        tolerancePaceSPerMi: easyTol != null ? Math.min(easyTol, 12) : 12,
        isFinishSegment: true,
      },
    ];
  }

  return [{
    type: 'work',
    label: workPhaseLabel ?? `${totalMi.toFixed(1)} mi long run`,
    distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * (mid ?? DURATION_EST_S_PER_MI)),
    targetPaceSPerMi: mid,
    tolerancePaceSPerMi: easyTol,
  }];
}

function expandEasy(
  s: Record<string, unknown>,
  totalMi: number,
  easyPaceSec: number | null,
  workPhaseLabel?: string,
): ExpandedPhase[] {
  // Spec band first · else the easy anchor · else by feel (P1-47).
  const specLo = Number(s.pace_target_s_per_mi_lo) || null;
  const specHi = Number(s.pace_target_s_per_mi_hi) || null;
  const lo = specLo ?? (easyPaceSec != null ? easyPaceSec - 30 : null);
  const hi = specHi ?? (easyPaceSec != null ? easyPaceSec + 60 : null);
  const mid = lo != null && hi != null ? Math.round((lo + hi) / 2) : null;
  return [{
    type: 'work',
    label: workPhaseLabel ?? `${totalMi.toFixed(1)} mi easy`,
    distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * (mid ?? DURATION_EST_S_PER_MI)),
    targetPaceSPerMi: mid,
    tolerancePaceSPerMi: bandToleranceSec(lo, hi),
  }];
}

function expandRecovery(
  s: Record<string, unknown>,
  totalMi: number,
  recoveryPace: number | null,
): ExpandedPhase[] {
  // Spec band first · else the recovery anchor · else by feel (P1-47).
  const specLo = Number(s.pace_target_s_per_mi_lo) || null;
  const specHi = Number(s.pace_target_s_per_mi_hi) || null;
  const lo = specLo ?? recoveryPace;
  const hi = specHi ?? (recoveryPace != null ? recoveryPace + 60 : null);
  const mid = lo != null && hi != null ? Math.round((lo + hi) / 2) : null;
  return [{
    type: 'work',
    label: `${totalMi.toFixed(1)} mi recovery jog`,
    distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * (mid ?? DURATION_EST_S_PER_MI)),
    targetPaceSPerMi: mid,
    tolerancePaceSPerMi: bandToleranceSec(lo, hi),
  }];
}

// ── helpers ────────────────────────────────────────────────────────────

/**
 * 2026-06-03 · iPhone agent Tier 2.d brief · derive sub_label from
 * workout_spec so the title row and grid can never drift.
 *
 * Produces the same human-readable strings the generator's prescription
 * resolver produces, but sourced from the authored spec instead of a
 * template. Used at generator write time + adapter mutation sites + a
 * one-off backfill for rows where stored sub_label diverged from spec.
 *
 * Returns null for spec=null (rest/cross/strength · no breakdown).
 *
 * Output examples:
 *   tempo  spec wu=2 tempo=4 cd=2  → "2 mi WU · 4 mi @ T · 2 mi CD"
 *   intervals 4×1mi 180s rest     → "4×1 mi @ I · 3 min jog"
 *   threshold 5×1km 60s rest      → "5×1 km @ T pace · 60s jog"
 *   easy / recovery / long / race → "EASY" / "RECOVERY" / "LONG" / "RACE"
 */
export function subLabelFromSpec(spec: WorkoutSpec): string | null {
  if (!spec || typeof spec !== 'object') return null;
  const s = spec as Record<string, unknown>;
  const kind = String(s.kind ?? '');
  switch (kind) {
    case 'tempo': {
      // DOCTRINE-TAPERMP-1 · a continuous block is not always at T. The taper's
      // MP session (Research/08 §9.2) carries its authored prescription in
      // `label` for exactly this reason — re-deriving "@ T" over a marathon-pace
      // block is the sub_label/spec drift this function exists to prevent.
      const authored = typeof s.label === 'string' ? s.label.trim() : '';
      if (authored) return authored;
      const wu = Number(s.warmup_mi ?? 0);
      const tempo = Number(s.tempo_distance_mi ?? 0);
      const cd = Number(s.cooldown_mi ?? 0);
      if (!wu && !cd) return `${formatMi(tempo)} mi continuous tempo`;
      // COLD-4 · "@ T" names a pace. When the spec deliberately carries none,
      // the label has to say EFFORT, or the runner reads a target the workout
      // does not contain and the phone shows a dash where the number should be.
      const tTag = s.by_effort === true ? '@ T effort' : '@ T';
      return `${formatMi(wu)} mi WU · ${formatMi(tempo)} mi ${tTag} · ${formatMi(cd)} mi CD`;
    }
    case 'threshold':
    case 'intervals': {
      // DOCTRINE-VOCAB-1 · a time-based rep set carries the authored
      // prescription in `label`, because that string is where the workout's
      // IDENTITY lives — "6×90s hills", "Mona". Re-deriving a generic rep
      // label here would drop the family name between compose and persist,
      // which is the sub_label/spec drift this function exists to prevent.
      const authored = typeof s.label === 'string' ? s.label.trim() : '';
      if (authored) {
        // PROGRESSION-1 (2026-08-17) · but the COUNT is the spec's, not the
        // label's. `timeRepSpec` drops reps that do not fit the day's mileage
        // budget, exactly as the distance-based branches do, and for those the
        // whole label is re-derived here so the count follows. A time-based set
        // keeps its authored string for its identity, so only the leading
        // "N×" is reconciled — the workout is still "hills", it is just five of
        // them rather than six.
        // GRAMMAR-SEQ-1 · `rep_count` on a stepped spec counts STEPS, not the
        // leading group's repeats — "6×(1mi @ MP + 1mi @ 10K)" is six cycles and
        // twelve steps. Reconciling one against the other would relabel the
        // alternation as twelve of itself. A stepped session is a fixed shape;
        // `capSpecToDistance` is the only thing that shortens one, and it drops
        // steps from the end rather than rewriting a leading count.
        const stepped = Array.isArray(s.steps) && (s.steps as unknown[]).length > 0;
        const specReps = stepped ? 0 : (Number(s.rep_count ?? 0) || 0);
        // SPECFIRST-1 (2026-08-24) · the count is not always at the front.
        //
        // This matched `/^(\s*)(\d+)(\s*[×xX]\s*)/` — anchored. It reconciles
        // "6×90s hills" correctly and misses "2mi E w/ 5×1 min surges @ T
        // effort" entirely, because that label opens with the day's MILEAGE.
        // Three live plan rows carried exactly that string over a spec with
        // `rep_count: 4` (verified in production 2026-08-24): the label said
        // five surges, the watch ran four, and now that the phone card is
        // composed from the same spec the watch runs, the card's own headline
        // was the last thing still saying five.
        //
        // The count is the first `N×` followed by a rep SIZE — a digit, as in
        // "5×1 min", "6×90s", "4×400 m". Requiring the trailing digit is what
        // keeps a stray "x" in prose from being read as a multiplier, and the
        // leading boundary is what stops "2mi" being read as the "2" of a
        // count. A label that already leads with its count behaves exactly as
        // it did before.
        const lead = authored.match(/(^|[^0-9])(\d+)(\s*[×xX]\s*)(?=\d)/);
        const reconciled = specReps > 0 && lead && Number(lead[2]) !== specReps
          ? authored.slice(0, lead.index! + lead[1].length)
            + specReps + lead[3]
            + authored.slice(lead.index! + lead[0].length)
          : authored;
        // COLD-4 (2026-08-17) · the same reconciliation the rep COUNT gets, for
        // the PACE. An authored prescription names a zone — "3×8 min @ T pace"
        // — and when the spec deliberately carries no pace, that phrase is the
        // one part of the identity that is no longer true. The workout is still
        // the same session; it is being run by effort, so say effort. A named
        // family that states no zone (hills, "Mona") matches nothing here and
        // comes back untouched.
        return s.by_effort === true ? effortizeZone(reconciled) : reconciled;
      }
      const reps = Number(s.rep_count ?? 0) || 0;
      const repMi = Number(s.rep_distance_mi ?? 0) || 0;
      const repM = Number(s.rep_distance_m ?? 0) || 0;
      const effRepMi = repMi > 0 ? repMi : (repM / 1609.34);
      const restS = Number(s.rep_rest_s ?? 0) || 0;
      const repLabel = formatRepLabel(effRepMi);
      // COLD-4 · same rule as the tempo branch above: a spec that carries no
      // rep pace must not be labelled with the zone as though it did. "@ T
      // effort" is the instruction the session actually contains — comfortably
      // hard, repeatable — and it is what the watch, the phone breakdown and
      // the recap all agree on for this row.
      const paceTag = s.by_effort === true
        ? (kind === 'intervals' ? '@ I effort' : '@ T effort')
        : (kind === 'intervals' ? '@ I' : '@ T pace');
      const restLabel = formatRestLabel(restS);
      return `${reps}×${repLabel} ${paceTag} · ${restLabel}`;
    }
    // 2026-06-07 · Audit D / D1 · long runs with a finish segment now
    // carry it IN the spec (finish_mi/finish_label), so the label can be
    // derived. race rows are also kind:'long' (stash) but carry no
    // finish_mi → fall through to null and keep the "RACE" label.
    case 'long': {
      // VARIETY-LONG-1 · a progression long's identity is its segment list;
      // deriving from the single finish fields here would collapse
      // "LONG · 3mi @ M + 2mi @ T" to its first segment and the label would
      // drift from the spec the watch runs — the exact defect this function
      // exists to prevent, one field over.
      const segs = Array.isArray(s.finish_segments)
        ? (s.finish_segments as Array<Record<string, unknown>>)
            .map((seg) => ({
              mi: Number(seg?.mi) || 0,
              label: String(seg?.label ?? '').trim(),
              // SEGLONG-1 · round-trips the gap. Dropping it here would turn a
              // segmented long back into a contiguous one on the next
              // derivation — the label would say the blocks run back-to-back
              // while the spec still separated them, which is the same
              // label-drifts-from-spec defect the comment above describes, one
              // field further in.
              recoveryMi: Number(seg?.recovery_mi) || 0,
            }))
            .filter((seg) => seg.mi > 0 && seg.label)
        : [];
      if (segs.length >= 2) {
        const parts = segs.flatMap((seg) => (
          seg.recoveryMi > 0
            ? [`${formatMi(seg.mi)}mi @ ${seg.label}`, `${formatMi(seg.recoveryMi)}mi @ E`]
            : [`${formatMi(seg.mi)}mi @ ${seg.label}`]
        ));
        return `LONG · ${parts.join(' + ')}`;
      }
      const finishMi = Number(s.finish_mi) || 0;
      const finishLabel = String(s.finish_label ?? '').trim();
      if (finishMi > 0 && finishLabel) {
        return `LONG · ${formatMi(finishMi)}mi @ ${finishLabel}`;
      }
      return null;  // plain long / race · keep generator-time label
    }
    // DOCTRINE-STRIDES-1 · a STANDALONE strides day is fully described by its
    // spec, so its label can be derived. Strides riding on an easy day or a
    // shakeout are NOT derived here — those specs are kind:'easy', which
    // would mis-derive the run itself as "EASY" and lose the generator's
    // label (see the note below). `strideSuffix` is exported for callers that
    // want to decorate an existing label with them.
    case 'strides': {
      const suffix = strideSuffix(spec);
      return suffix ? `EASY${suffix}` : null;
    }
    // 2026-06-03 · easy / recovery / race / shakeout · return null so the
    // caller's existing sub_label sticks. The spec's `kind` doesn't carry
    // the decorations these labels need:
    //   · race  · spec.kind='long' (stash) · would mis-derive as "LONG"
    //   · shakeout · spec.kind='easy' · would mis-derive as "EASY"
    // Only the rep/tempo/long-finish shapes get derived. Everything else
    // keeps generator-time labels.
    default:
      return null;
  }
}

/**
 * DOCTRINE-STRIDES-1 · " + 6×20s strides" for a spec that carries them, or ''.
 *
 * Kept separate from `subLabelFromSpec` because strides decorate a label rather
 * than define one: an easy day's spec is kind:'easy' whether or not it ends in
 * strides, so the run's own label comes from the generator and this is appended
 * to it. Renderers on every surface can call this to show what the watch will
 * actually execute.
 */
export function strideSuffix(spec: WorkoutSpec): string {
  if (!spec || typeof spec !== 'object') return '';
  const s = spec as Record<string, unknown>;
  const reps = Number(s.strides_reps ?? 0) || 0;
  if (reps <= 0) return '';
  const durationSec = Number(s.strides_duration_s ?? 0) || 20;
  return ` + ${reps}×${durationSec}s strides`;
}

/**
 * COLD-4 · rewrite a zone-naming phrase in an authored prescription so it names
 * an EFFORT instead of a pace.
 *
 *   "3×8 min @ T pace · 90s jog"  →  "3×8 min @ T effort · 90s jog"
 *   "5×1km @ I · 2 min jog"       →  "5×1km @ I effort · 2 min jog"
 *   "6×90s hills"                 →  unchanged (states no zone)
 *   "7×3 min hills @ T-10K effort" → unchanged (a zone RANGE, already effort)
 *
 * Only ever applied to a spec that carries `by_effort`, so a paced session's
 * label is untouched. Deliberately conservative — it edits the zone token and
 * nothing else, because the rest of the string is the workout's identity.
 *
 * ZONE-RANGE-1 (2026-08-25) · the second pattern used to fire INSIDE a zone
 * range. `Research/04` §8.4's long hill repeats are prescribed "@ T–10K
 * effort" — a band, one token — and `catalogue-rx.ts#zoneClause` renders every
 * effort-only entry that way (`zones.map(ZONE_LABEL).join('-')`). The `@ T`
 * at the front of that band matched, and the runner's phone read
 * "7×3 min hills @ T effort-10K effort". Live on week 3 of the owner's CIM
 * block. A hyphen after the letter means the token is a range, and a range
 * ending in "effort" has already said what this function exists to say.
 */
function effortizeZone(label: string): string {
  return label
    .replace(/@\s*([TIRME])\s*pace\b/gi, '@ $1 effort')
    .replace(/@\s*([TIRME])\b(?![-–]|\s*(?:effort|pace))/g, '@ $1 effort');
}

function formatMi(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
}
function formatRestLabel(s: number): string {
  if (s <= 0) return 'jog rest';
  if (s >= 60 && s % 60 === 0) return `${s / 60} min jog`;
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')} jog`;
  }
  return `${s}s jog`;
}

function formatRepLabel(repMi: number): string {
  // 1.0 → "1 mi"; 0.62 → "1 km"; 0.5 → "800 m"; 0.25 → "400 m"
  if (Math.abs(repMi - 1.0) < 0.05) return '1 mi';
  if (Math.abs(repMi - 0.621) < 0.02) return '1 km';
  if (Math.abs(repMi - 0.497) < 0.02) return '800 m';
  if (Math.abs(repMi - 0.249) < 0.02) return '400 m';
  if (Math.abs(repMi - 1.243) < 0.03) return '2 km';
  return `${repMi.toFixed(2)} mi`;
}

function formatSec(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, '0')}`;
  }
  return `${s}s`;
}
