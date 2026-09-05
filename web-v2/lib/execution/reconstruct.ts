/**
 * lib/execution/reconstruct.ts · turning a plan row and a run row into the two
 * `Stimulus` values `interpretExecution` compares.
 *
 * `interpretExecution` is deliberately shape-blind — it takes two stimuli and
 * never sees a rep count, because doctrine forbids grading 3 × 2 miles against
 * the rep window for 5 × 1. That purity has to be paid for somewhere, and this
 * is where: everything that knows about `workout_spec` kinds, watch phases,
 * split shapes and pace bands lives here, and hands the interpreter two
 * comparable descriptions of physiological work.
 *
 * ## The reconstruction, and what it falls back to
 *
 * PLANNED — three rungs, first honest read wins:
 *
 *   1 · `workout_spec.progression` (`lib/plan/progression-spec.ts`) — reps,
 *       rep minutes, recovery minutes, work pace. The overload trajectory's own
 *       decision, and the only rung that states the intended stimulus directly.
 *       Absent on every row authored before the block existed, which is all of
 *       the live data today.
 *   2 · `expandSpecToPhases` over the older structural fields. The app's single
 *       spec→phases expander, already used by the watch payload, /today and the
 *       projection's blended basis. Summing its `work` phases IS the intended
 *       stimulus; re-deriving per-kind arithmetic here would be a second
 *       opinion that drifts from what the runner was actually shown.
 *   3 · The bare plan row — `distance_mi` and `pace_target_s_per_mi`. Only
 *       honest for the types where the target IS a whole-run pace (easy, long,
 *       race); for a quality day the target is the WORK pace and the distance
 *       includes warm-up and cool-down, so this rung abstains rather than
 *       claiming a runner was asked to run eight miles at threshold.
 *
 * ACTUAL — three rungs, mirroring the projection's basis ladder on purpose:
 *
 *   1 · `data.phases` — the watch's own per-phase actuals. `type === 'work'`
 *       isolates the work from the warm-up and cool-down exactly, which is why
 *       this rung is worth having at all: every other basis has to infer where
 *       the work was.
 *   2 · Splits, windowed to the contiguous work block via
 *       `contiguousWorkWindowMi` + `paceOverWindow`. Reused from
 *       `goal-projection.ts` rather than reimplemented — those functions carry
 *       the straddling-split exclusion that a naive window read gets wrong at
 *       every phase transition.
 *   3 · Whole-run distance and moving time, for the sessions where the whole
 *       run IS the work (easy, long, race).
 *
 * When a run exists and NONE of the rungs can read it, this module returns
 * `readable: false` — never a zero. "We cannot see what he did" and "he did
 * nothing" are different findings and only the second is a miss.
 *
 * ## Domains, and why they are not nearest-anchor
 *
 * `interpretExecution` refuses equivalence across intensity domains, and the
 * counter-example in its own tests is "same duration, easy pace — that is a
 * different session entirely". So the domain test has to separate QUALITY from
 * EASY. It must not re-judge pace adherence, because `judgeTestPointExecution`
 * already does that at ±10 s/mi with a heat adjustment, and a second grader
 * would count the same miss twice.
 *
 * That rules out nearest-anchor over `derivePaces`: its threshold and marathon
 * anchors sit 18 s/mi apart, which is inside the tolerance the verdict path
 * grades at, so a GPS mean pace cannot honestly tell them apart. Classifying a
 * threshold session run 27 s/mi slow as "a marathon-pace session" would be a
 * measurement claim the data does not support.
 *
 * Instead the session's OWN work target anchors the question, and the window
 * around it comes from `derivePaces`' own neighbouring anchors:
 *
 *   · `repSec` = T − 30 — the first genuinely faster system. Work run more
 *     than 30 s/mi faster than its target is repetition work, not this session.
 *   · `longSecLo` = T + 55 — the first genuinely non-quality anchor. Work run
 *     more than 55 s/mi slower than its target has left the quality domain.
 *
 * Inside that window the session is the session, run well or badly. Outside it,
 * `paceDomain` names what was actually run so the read can say so.
 */

import {
  type IntensityDomain,
  type RecoveryIntent,
  type Stimulus,
  type ExecutionContext,
} from './interpret';
import {
  asRunData,
  runDistanceMi,
  runMovingSec,
  runPhases,
  runWatchStatus,
  watchStoppedInsideWork,
  workToleranceShare,
  type NormalizedPhase,
  type RunData,
} from '@/lib/runs/run-shape';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';
import { classifySession, type PhaseVerdict } from '@/lib/training/execution-semantics';
import { gradeStoredPhases } from './verdict';
import { readProgressionSpec } from '@/lib/plan/progression-spec';
import { expandSpecToPhases, type ExpandedPhase } from '@/lib/training/expand-spec';
import {
  normalizePaceSplits,
  contiguousWorkWindowMi,
  paceOverWindow,
  easyPaceForBlend,
} from '@/lib/training/goal-projection';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';

/* ─────────────────────────────────────────────────────────────── constants */

/**
 * How far FASTER than its own work target a piece of work may be run and still
 * be the same session. `derivePaces().repSec = T − 30` — the next system up.
 * `lib/training/prescriptions.ts`, `Research/01-pace-zones-vdot.md`.
 */
export const DOMAIN_WINDOW_FASTER_S = 30;

/**
 * How far SLOWER. `derivePaces().longSecLo = T + 55` — the first anchor that
 * is not quality work at all. Wider than the fast side because the pace bands
 * themselves are: the easy band spans 40 s/mi, the T band a handful.
 */
export const DOMAIN_WINDOW_SLOWER_S = 55;

/** Plan types whose `pace_target_s_per_mi` is the WORK-phase pace rather than
 *  a whole-run pace. Mirrors `WORK_TARGET_TYPES` in `goal-projection.ts`; a
 *  second, disagreeing list is its own bug. */
const WORK_TARGET_TYPES = new Set(['tempo', 'threshold', 'intervals', 'race_week_tuneup']);

/* ───────────────────────────────────────────────────────────────── domains */

/**
 * The domain a plan day INTENDS. Read from the session's own type rather than
 * inferred from its target pace, because the plan states its intent and there
 * is nothing to infer.
 *
 * A long run carrying a `finish_mi` block at half-marathon or marathon pace is
 * a marathon-domain session: the finish IS the stimulus and the preceding easy
 * miles are the durability context it is run on.
 */
export function plannedDomain(type: string | null, spec: WorkoutSpec): IntensityDomain {
  const kind = spec && typeof spec === 'object' ? String((spec as Record<string, unknown>).kind ?? '') : '';
  switch (type) {
    case 'race':
      return 'race';
    case 'intervals':
      return 'interval';
    case 'tempo':
    case 'threshold':
    case 'race_week_tuneup':
      return 'threshold';
    case 'long':
      return hasFinishSegment(spec) ? 'marathon' : 'easy';
    default:
      break;
  }
  // No type, or a type the plan does not model. Fall back to the spec kind,
  // then to easy — the domain that claims the least.
  if (kind === 'intervals') return 'interval';
  if (kind === 'tempo' || kind === 'threshold') return 'threshold';
  if (kind === 'long') return hasFinishSegment(spec) ? 'marathon' : 'easy';
  return 'easy';
}

function hasFinishSegment(spec: WorkoutSpec): boolean {
  if (!spec || typeof spec !== 'object') return false;
  const mi = Number((spec as Record<string, unknown>).finish_mi);
  return Number.isFinite(mi) && mi > 0;
}

/**
 * Name the domain a pace belongs to, for the runner's own threshold anchor.
 *
 * Only reached when the work sat OUTSIDE its session's window — the point is
 * to say what happened instead, not to re-grade a session that stayed inside.
 * Nearest anchor over `derivePaces`' set, which is the app's own operational
 * definition of each pace. `recovery` is deliberately absent: the app has no
 * recovery-pace anchor, and `interpretExecution` treats it identically to
 * `easy` (`routineAerobic`), so inventing one would change nothing but could
 * be wrong.
 */
export function paceDomain(paceSPerMi: number, tPaceSPerMi: number): IntensityDomain {
  const anchors: Array<[IntensityDomain, number]> = [
    ['repetition', tPaceSPerMi - 30],
    ['interval', tPaceSPerMi - 18],
    ['threshold', tPaceSPerMi],
    ['marathon', tPaceSPerMi + 18],
    ['easy', tPaceSPerMi + 100],
  ];
  let best = anchors[0];
  for (const a of anchors) {
    if (Math.abs(paceSPerMi - a[1]) < Math.abs(paceSPerMi - best[1])) best = a;
  }
  return best[0];
}

/**
 * The domain a piece of work actually landed in.
 *
 * Inside the session's own window it is the session's domain — run well or
 * badly, it taxed the system the session aimed at, and how well is the verdict
 * path's question. Outside it, `paceDomain` names what it really was.
 *
 * A race is always `race`. Doctrine evaluates a race independently of the pace
 * it was run at, and a goal that turned out to be optimistic is a fitness
 * finding rather than evidence that the athlete ran a different kind of
 * session.
 */
export function actualDomain(args: {
  intended: IntensityDomain;
  workTargetSPerMi: number | null;
  actualPaceSPerMi: number | null;
  tPaceSPerMi: number | null;
}): IntensityDomain {
  const { intended, workTargetSPerMi, actualPaceSPerMi, tPaceSPerMi } = args;
  if (intended === 'race') return 'race';
  // Nothing to place it against — assume the session it was run as. Claiming a
  // domain change on no evidence would fabricate a non-equivalence.
  if (actualPaceSPerMi == null) return intended;
  // Whole seconds per mile, like every other pace comparison in the app
  // (`progressionSpecFields`, `judgeTestPointExecution`). A mean derived from
  // phase durations lands a tenth of a second off the belt speed the runner
  // actually set, and an un-rounded boundary test lets that tenth decide which
  // physiological system a session belonged to. It did: a treadmill session
  // whose three reps each ran at exactly the prescribed 389 s/mi came out at
  // 388.9 and fell out of its own domain.
  const actual = Math.round(actualPaceSPerMi);
  if (workTargetSPerMi != null && workTargetSPerMi > 0) {
    const target = Math.round(workTargetSPerMi);
    const inside = actual >= target - DOMAIN_WINDOW_FASTER_S
      && actual <= target + DOMAIN_WINDOW_SLOWER_S;
    if (inside) return intended;
  }
  if (tPaceSPerMi == null || tPaceSPerMi <= 0) return intended;
  return paceDomain(actual, tPaceSPerMi);
}

/* ──────────────────────────────────────────────────────── planned stimulus */

export interface PlannedSession {
  dateISO: string;
  /** `plan_workouts.type`. */
  type: string | null;
  isQuality: boolean;
  isLong: boolean;
  distanceMi: number | null;
  /** `plan_workouts.pace_target_s_per_mi`. WORK pace on quality days. */
  paceTargetSPerMi: number | null;
  spec: WorkoutSpec;
}

export type PlannedBasis = 'progression-spec' | 'expanded-spec' | 'plan-row';

export interface PlannedRead {
  stimulus: Stimulus;
  basis: PlannedBasis;
  /** The work-phase pace the session asked for, s/mi. The anchor
   *  `actualDomain` places the delivered work against. */
  workTargetSPerMi: number | null;
}

/**
 * What the session asked for, as a stimulus. Null when no rung can read it —
 * a plan row we cannot describe must not be graded.
 */
export function plannedStimulus(
  session: PlannedSession,
  ctx: { vdot: number | null },
): PlannedRead | null {
  const domain = plannedDomain(session.type, session.spec);

  /* 1 · the overload trajectory's own decision, when the row carries it. */
  const prog = readProgressionSpec(session.spec);
  if (prog) {
    const workMinutes = prog.shape.reps * prog.shape.repMinutes;
    const pace = prog.shape.paceSPerMi;
    if (workMinutes > 0 && pace > 0) {
      return {
        basis: 'progression-spec',
        workTargetSPerMi: pace,
        stimulus: {
          domain,
          workMinutes,
          workMi: (workMinutes * 60) / pace,
          meanWorkPaceSPerMi: pace,
          recoveryIntent: prog.shape.recoveryMinutes > 0 ? 'incomplete' : 'none',
        },
      };
    }
  }

  /* 2 · the app's single spec expander. */
  const phases = expandPlanned(session, ctx.vdot);
  if (phases) {
    const work = summariseExpandedWork(phases);
    if (work != null) {
      return {
        basis: 'expanded-spec',
        workTargetSPerMi: work.paceSPerMi,
        stimulus: {
          domain,
          workMinutes: work.durationSec / 60,
          workMi: work.distanceMi,
          meanWorkPaceSPerMi: work.paceSPerMi,
          recoveryIntent: phases.some((p) => p.type === 'recovery') ? 'incomplete' : 'none',
        },
      };
    }
  }

  /* 3 · the bare plan row, and only where its target is a whole-run pace. */
  const mi = session.distanceMi;
  const pace = session.paceTargetSPerMi;
  if (
    mi != null && mi > 0 && pace != null && pace > 0
    && !WORK_TARGET_TYPES.has(String(session.type))
  ) {
    return {
      basis: 'plan-row',
      workTargetSPerMi: pace,
      stimulus: {
        domain,
        workMinutes: (mi * pace) / 60,
        workMi: mi,
        meanWorkPaceSPerMi: pace,
        recoveryIntent: 'none',
      },
    };
  }

  return null;
}

/** `expandSpecToPhases` with the easy anchor every other consumer uses. */
function expandPlanned(session: PlannedSession, vdot: number | null): ExpandedPhase[] | null {
  if (!session.spec) return null;
  const easyPaceSec = easyPaceForBlend(vdot, String(session.type ?? ''), session.paceTargetSPerMi);
  if (easyPaceSec == null) return null;
  return expandSpecToPhases({
    spec: session.spec,
    totalMi: session.distanceMi ?? 8,
    easyPaceSec,
    recoveryPaceSec: easyPaceSec,
  });
}

/** Sum the `work` phases of an expanded spec. Null when none resolves both
 *  axes — a phase list we cannot measure is not a stimulus. */
function summariseExpandedWork(
  phases: ExpandedPhase[],
): { distanceMi: number; durationSec: number; paceSPerMi: number } | null {
  let dist = 0, dur = 0;
  for (const p of phases) {
    if (p.type !== 'work') continue;
    const pace = p.targetPaceSPerMi ?? null;
    const d = p.distanceMi ?? (p.durationSec != null && pace ? p.durationSec / pace : null);
    const s = p.durationSec ?? (d != null && pace != null ? d * pace : null);
    if (d == null || s == null || d <= 0 || s <= 0) continue;
    dist += d;
    dur += s;
  }
  if (dist <= 0 || dur <= 0) return null;
  return { distanceMi: dist, durationSec: dur, paceSPerMi: dur / dist };
}

/* ───────────────────────────────────────────────────────── actual stimulus */

export type ActualBasis = 'watch-phases' | 'work-window-splits' | 'whole-run';

export interface ActualRead {
  stimulus: Stimulus;
  basis: ActualBasis;
  /** The watch's own run-level outcome, when the row carries it. */
  watchStatus: 'completed' | 'partial' | 'abandoned' | null;
  /** Share of graded work time inside the pace band, per the device's own
   *  counters. Null when no work phase carried them. */
  toleranceShare: number | null;
  /** THE canonical per-phase grades over the work phases, in order — from
   *  `lib/execution/verdict.ts`, graded as the session the plan row names.
   *  VERDICT-1 (2026-09-01): this used to carry the DEVICE'S stored word,
   *  which on the owner's 2026-09-01 row was `drifted / drifted / drifted /
   *  missed` for a set the server grades hit / hit / hit / fast. */
  workVerdicts: PhaseVerdict[];
}

/**
 * What actually happened, as a stimulus.
 *
 * `null` means the run exists but no rung could describe its work — which the
 * caller must treat as missing evidence, never as a miss.
 *
 * ── THRESHOLD-OWNER-1 (2026-09-05) · `tPaceSecPerMi`, NOT A SECOND FITNESS ──
 *
 * This read `tPaceFromVdot(ctx.vdot)` and handed the result to `paceDomain`,
 * whose whole ladder (`t-30` R, `t-18` I, `t` threshold, `t+18` M, `t+100` E)
 * hangs off that one number — so the domain an executed run was CLASSIFIED
 * into came off a VDOT while the domain it was PRESCRIBED at came off
 * `resolvePrescribedPaceAnchors`. Two answers to "what is this runner's
 * threshold", eleven lines apart in the same call.
 *
 * F-5 fixed exactly this shape one function down (`establishedPaceFor`, see
 * its header) and did not follow it up here; `load.ts` already resolves the
 * canonical anchors in the same function that calls this one and was passing
 * the VDOT anyway. On the owner's account, 2026-09-05, the two numbers were
 * 431 s/mi (`tPaceFromVdot(47.7)`) and 430 s/mi (canonical) — one second, and
 * that smallness is the point: the divergence is unbounded by construction,
 * and it has been as wide as the tier flips the continuity cap exists for.
 *
 * `vdot` stays on `ctx` because `expandPlanned` still prices the EASY band
 * from it (`easyPaceForBlend`). That is a separate quantity with a separate
 * owner and a separate migration; naming them separately is Rule 16 rather
 * than a compromise of it. It is listed as OPEN in
 * `lib/training/_threshold_owner_scan.test.ts`.
 */
export function actualStimulus(
  runData: RunData,
  planned: PlannedRead,
  session: PlannedSession,
  ctx: {
    vdot: number | null;
    /** THE canonical threshold, from `resolvePrescribedPaceAnchors`. Null is
     *  a real answer — a runner nobody can price gets no domain
     *  reclassification, which is what `paceDomain`'s caller already handles
     *  (Rule 11). */
    tPaceSecPerMi: number | null;
    watchStatusFallback?: 'completed' | 'partial' | 'abandoned' | null;
  },
): ActualRead | null {
  const tPace = ctx.tPaceSecPerMi;
  const phases = runPhases(runData);
  const workPhases = phases.filter((p) => p.type === 'work');
  const watchStatus = runWatchStatus(runData) ?? ctx.watchStatusFallback ?? null;
  const toleranceShare = workToleranceShare(phases);
  const workVerdicts = gradeStoredPhases(
    runData.phases,
    classifySession(String(session.type ?? ''), (session.spec ?? null) as Record<string, unknown> | null),
  ).phases.filter((p) => p.type === 'work').map((p) => p.verdict);

  const finish = (
    basis: ActualBasis,
    workMi: number | null,
    workMinutes: number,
    pace: number | null,
    recoveryIntent: RecoveryIntent,
  ): ActualRead => ({
    basis,
    watchStatus,
    toleranceShare,
    workVerdicts,
    stimulus: {
      domain: actualDomain({
        intended: planned.stimulus.domain,
        workTargetSPerMi: planned.workTargetSPerMi,
        actualPaceSPerMi: pace,
        tPaceSPerMi: tPace,
      }),
      workMinutes,
      workMi,
      meanWorkPaceSPerMi: pace,
      recoveryIntent,
    },
  });

  /* 1 · the watch's own work phases. The only basis that knows exactly where
   *     the work was rather than inferring it. */
  if (workPhases.length > 0) {
    let dist = 0, dur = 0;
    for (const p of workPhases) {
      if (p.actualDurationSec == null || p.actualDurationSec <= 0) continue;
      dur += p.actualDurationSec;
      if (p.actualDistanceMi != null) dist += p.actualDistanceMi;
    }
    if (dur > 0) {
      const mi = dist > 0 ? dist : null;
      return finish(
        'watch-phases',
        mi,
        dur / 60,
        mi != null ? dur / mi : null,
        // A jog between reps is recorded as its own phase. No recovery phase
        // on a run that had work phases means the work was continuous.
        phases.some((p) => p.type === 'recovery') ? 'incomplete' : 'none',
      );
    }
  }

  /* 2 · splits, windowed to the contiguous work block. Only resolves a single
   *     block — mile splits cannot see sub-mile reps between jog recoveries. */
  if (runData.splits_unreliable !== true) {
    const expanded = expandPlanned(session, ctx.vdot);
    const splits = normalizePaceSplits(runData.splits);
    if (expanded && splits.length >= 2) {
      const window = contiguousWorkWindowMi(expanded);
      const pace = window ? paceOverWindow(splits, window.startMi, window.endMi) : null;
      if (window && pace != null && pace > 0) {
        // The window is the PLANNED work block on the mile axis; the runner may
        // have covered less of it. Credit only the distance actually run.
        const covered = Math.max(
          0,
          Math.min(window.endMi, splits.reduce((a, s) => a + s.distMi, 0)) - window.startMi,
        );
        if (covered > 0) {
          return finish(
            'work-window-splits',
            covered,
            (covered * pace) / 60,
            pace,
            // Splits cannot see recovery structure. Mirroring the plan records
            // "no evidence it changed", which is what we actually know —
            // defaulting to 'none' would fabricate a non-equivalence.
            planned.stimulus.recoveryIntent,
          );
        }
      }
    }
  }

  /* 3 · the whole run, where the whole run is the work. */
  const isWholeRunWork = !WORK_TARGET_TYPES.has(String(session.type));
  if (isWholeRunWork) {
    const mi = runDistanceMi(runData);
    const sec = runMovingSec(runData);
    if (mi != null && sec != null && sec > 0) {
      return finish('whole-run', mi, sec / 60, sec / mi, planned.stimulus.recoveryIntent);
    }
  }

  return null;
}

/* ────────────────────────────────────────────────────────────────  context */

/**
 * The context flags `interpretExecution` reasons over, read off the device
 * rather than reconstructed from distance.
 *
 * `effortCollapsed` is the one that matters, and the one the run-level
 * `status` is repeatedly mistaken for. `abandoned` is stamped whenever the
 * runner ends the workout before its last phase — most often during the
 * cool-down, on a session that was fully executed. In the live data it lands
 * on an 18-mile long run and on tempo sessions whose work block finished in
 * full. Taken alone it would mark a well-executed block as coming apart.
 *
 * So the collapse test is the conjunction doctrine actually describes — the
 * athlete stopped INSIDE the work:
 *
 *   · the workout did not run to its end (`abandoned` / `partial`), AND
 *   · a WORK phase was left unfinished.
 *
 * Or, independently, the runner reported the session harder than it should
 * have been — doctrine's "RPE spiked", from the same `post_run_rpe` threshold
 * the adaptation model's internal-cost dimension already uses.
 */
export function executionContext(args: {
  runData: RunData | null;
  watchStatusFallback?: 'completed' | 'partial' | 'abandoned' | null;
  /** Highest RPE the runner logged for this session, 0-10. Null when none. */
  rpe?: number | null;
  /** A race was run in this session's place. */
  replacedByRace?: boolean;
  /** This run was not on the plan at all. */
  unplanned?: boolean;
  /** The pace this runner has established for the session's domain, s/mi. */
  establishedPaceSPerMi?: number | null;
}): ExecutionContext {
  const { runData } = args;
  let effortCollapsed = false;

  if (runData) {
    const phases = runPhases(runData);
    const status = runWatchStatus(runData) ?? args.watchStatusFallback ?? null;
    const endedEarly = status === 'abandoned' || status === 'partial';
    const stoppedInWork = watchStoppedInsideWork(phases);
    if (endedEarly && stoppedInWork === true) effortCollapsed = true;
  }
  if (args.rpe != null && args.rpe >= RPE_HARDER_THAN_EXPECTED) effortCollapsed = true;

  return {
    effortCollapsed,
    replacedByRace: args.replacedByRace,
    unplanned: args.unplanned,
    establishedPaceSPerMi: args.establishedPaceSPerMi ?? null,
  };
}

/** The RPE at or above which a session read harder than it should have.
 *  Same edge `lib/adaptation/load.ts` already counts on. */
export const RPE_HARDER_THAN_EXPECTED = 8;

/**
 * The pace this runner has established for a domain. Doctrine's "previously
 * considered established" — it is what lets a failure at a known pace read as
 * high fitness evidence rather than as a bad day.
 *
 * ── F-5 · WHAT THIS USED TO DO, AND WHAT IT COST ────────────────────────────
 *
 * It took a raw VDOT and applied its own offsets to `tPaceFromVdot`:
 *
 *     repetition: t - 30 · interval: t - 18 · easy: t + 100
 *
 * and its own header claimed "offsets are `derivePaces`', so this and the
 * prescription agree." They did not. The prescription side uses Daniels'
 * Mile column for R (`rPaceFromVdot`), the I column for I (`iPaceFromVdot`),
 * and `easyBandFromTPace(t).lo = t + 80` for the easy ceiling — the last of
 * which is doctrine-gated by `PACE.easy-band-off-threshold`. Measured against
 * the real functions:
 *
 *     VDOT 40 · R table 7:07 vs t-30  7:53   → 46 s/mi slower
 *     VDOT 50 · R table 5:50 vs t-30  6:24   → 34 s/mi slower
 *     VDOT 65 · R table 4:37 vs t-30  4:59   → 22 s/mi slower
 *     VDOT 50 · I table 6:25 vs t-18  6:36   → 11 s/mi slower
 *     all     · easy t+80    vs t+100        → 20 s/mi slower
 *
 * EVERY offset erred in the same direction: the grader believed the runner's
 * established pace was SLOWER than the pace he was actually prescribed. That
 * biases `failedAtKnownPace` (`interpret.ts` — `actual <= established + 5`)
 * toward TRUE, so a session that came apart at a pace well INSIDE the
 * prescription still read as HIGH fitness evidence. And it was printed at the
 * runner: `composeFitnessEvidenceEntry` says "That pace has been comfortable
 * before, at {established}/mi", which at VDOT 50 would have told him his rep
 * pace was comfortable at 6:24/mi while his plan asked for 5:50.
 *
 * ── WHAT IT DOES NOW ────────────────────────────────────────────────────────
 *
 * It reads `PrescribedPaceAnchors` — the SAME six numbers
 * `resolvePrescribedPaceAnchors` hands the plan builder, off the same four
 * capacity resolvers. There is no second fitness and no offset table here at
 * all, which is the only way "the grader and the prescription share one
 * fitness" can be true rather than asserted (Rule 16, Rule 20).
 *
 * `null` in, `null` out, and `null` for `repetition` when the high-intensity
 * ladder could not price a mile-column pace — that null is deliberate in
 * `PrescribedPaceAnchors` (Rule 11: a caller must branch, never read a
 * substituted I-pace) and it is carried through rather than filled in.
 */
export function establishedPaceFor(
  domain: IntensityDomain,
  anchors: PrescribedPaceAnchors | null,
): number | null {
  if (anchors == null) return null;
  switch (domain) {
    case 'repetition': return anchors.repetitionSecPerMi;
    case 'interval':   return anchors.intervalSecPerMi;
    case 'threshold':  return anchors.thresholdSecPerMi;
    case 'race':       return anchors.thresholdSecPerMi;
    case 'marathon':   return anchors.marathonSecPerMi;
    case 'easy':       return anchors.easyCeilingSecPerMi;
    case 'recovery':   return anchors.shakeoutCeilingSecPerMi;
  }
}

/** Narrow a run row's jsonb without asserting anything about it. */
export const runDataOf = asRunData;
