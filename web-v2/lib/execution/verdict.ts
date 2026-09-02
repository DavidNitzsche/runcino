/**
 * lib/execution/verdict.ts · THE canonical verdict for one completed workout.
 *
 * Pure. No pool, no query, no `userId`, no DB import at any depth — the same
 * seal `lib/training/execution-semantics.ts` carries, because this is reached
 * from the phone route, the run-detail mapper, the recap, the glance state,
 * the Targets test points and the execution reconstruction, and one of those
 * is reachable from a `'use client'` entry (Rule 19's client-graph gate is
 * the enforcement; this sentence is not).
 *
 * ── WHY THIS FILE EXISTS (Phase 6, 2026-09-01) ──────────────────────────────
 *
 * `execution-semantics.ts` already owned the RULES — one tolerance table, one
 * shape per phase, one grade per shape, one session ladder. What it did not
 * own was the INPUT. Each consumer still assembled its own phase list from the
 * stored payload and decided for itself which session class to grade it as,
 * and that is where the same run kept getting two answers:
 *
 *   · Run detail (`loadPhaseBreakdown`) called `mapWatchPhases` WITHOUT a
 *     session class, so on every completion recorded before the wire carried
 *     `tolerancePaceSPerMi` a work phase fell through to `sessionToleranceSec
 *     ('other')` — thirty seconds a mile. The owner's 2026-09-01 fourth rep,
 *     419 against 430, read "On target" there and "Quicker than target"
 *     everywhere the class was known.
 *   · The win line (`winIntervalsFromPhases`) read the DEVICE'S stored
 *     `verdict` — `drifted / drifted / drifted / missed` on that same row —
 *     and printed "3 of 4 reps on target" under a recap whose reps were
 *     hit / hit / hit / fast.
 *   · The glance done-state (`computeTodayExecution`) graded the same phases
 *     through `heatAdjustedStatus` at its default width of ten.
 *   · The recap's tempo arm called a work mean "on the mark" at ±5 and
 *     "under the target" beyond it, against an owner that grades ±8.
 *
 * Every one of those is a legal verdict. Together they are Rule 16 broken on
 * one workout across four screens. So the fix is not another rule; it is ONE
 * RESOLVER that takes the stored phases and the plan row and returns the
 * verdict, and every consumer reads that object. Consumer-specific WORDING is
 * allowed (a win line, a phase label, a done-state); a consumer-specific
 * VERDICT is not, and `_workout_verdict_owner.test.ts` scans for one.
 *
 * ── WHAT THE STORED `verdict` IS NOW ────────────────────────────────────────
 *
 * The device's word is carried as `storedVerdict` — a fact about what the
 * wrist decided at the time, kept for audit and never re-derived — and it is
 * NOT the verdict any surface prints. Rule 10: a persisted derived value
 * either carries its anchor or is recomputed at read time. The device's grade
 * carries neither the session class nor the tolerance table it was graded
 * against, so it is recomputed here from the actuals it recorded, and the
 * wrist's own rule is pinned to this one by `_watch_grader_parity.test.ts`.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ─────────────────────────────────
 *
 *   · It inherits every blind spot of `execution-semantics.ts`: no view of
 *     heart rate, terrain, weather or fatigue in the grade itself. `work.hrAvg`
 *     is carried for the readers that DO look at heart rate; it does not vote.
 *   · A payload with no phases at all grades nothing (`basis: 'none'`), and a
 *     consumer that then falls back to a whole-run comparison of its own is
 *     exactly the second verdict this file forbids. The scanner catches the
 *     literal; it cannot catch a fallback written around a named constant.
 *   · It classifies from the PLAN row the caller hands it. A caller that
 *     passes the wrong plan row gets a confidently wrong class.
 */
import {
  classifySession,
  gradeCeilingPhase,
  gradeWorkPhase,
  lateCollapseOf,
  paceShapeFor,
  phaseToleranceSec,
  phaseVerdictLabel,
  recoveriesHonestOf,
  sessionLadder,
  sessionToleranceSec,
  wireVerdictFellShort,
  WIRE_PHASE_VERDICTS,
  EASY_PHASE_TOLERANCE_S_PER_MI,
  type PaceShape,
  type PhaseType,
  type PhaseVerdict,
  type SessionClass,
  type SessionGrade,
  type WirePhaseVerdict,
} from '@/lib/training/execution-semantics';

/* ══════════════════════════════ 1 · the shape ═══════════════════════════ */

/** One phase, graded. Everything a surface needs to draw or word it. */
export interface GradedPhase {
  index: number;
  type: PhaseType | 'unknown';
  label: string | null;
  /** What `targetSecPerMi` MEANS on this phase — window, ceiling, effort, none. */
  shape: PaceShape;
  targetSecPerMi: number | null;
  /** The width the phase was graded at, s/mi. Null when not pace-graded. */
  toleranceSec: number | null;
  avgSecPerMi: number | null;
  actualDurationSec: number | null;
  actualDistanceMi: number | null;
  targetDurationSec: number | null;
  targetDistanceMi: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  completed: boolean;
  isFinishSegment: boolean;
  /** THE verdict. */
  verdict: PhaseVerdict;
  /** The word the runner reads for `verdict`, correct for `shape`. Null when
   *  nothing was graded (Rule 11: absence is not a verdict). */
  statusLabel: string | null;
  /** The device's own word at the time — a stored fact, never displayed as
   *  the verdict. Legacy `drifted` / `missed` survive here and nowhere else. */
  storedVerdict: WirePhaseVerdict | null;
  timeInToleranceSec: number | null;
  timeOutOfToleranceSec: number | null;
}

/** The work, summarised — the numbers a surface prints beside the verdict. */
export interface WorkSummary {
  /** Work phases present in the payload. */
  count: number;
  /** Work phases that were pace-graded at all. */
  graded: number;
  /** Graded work phases that landed the work (`hit` or `fast`). */
  landed: number;
  /** Graded work phases that fell short (`slow`). */
  fellShort: number;
  /** A work phase ended before its target. */
  incomplete: boolean;
  /** Duration-weighted mean pace across the work phases, s/mi. */
  paceSPerMi: number | null;
  /** Duration-weighted mean heart rate across the work phases, bpm. */
  hrAvg: number | null;
  /** Total work distance, mi. */
  distanceMi: number | null;
}

export interface WorkoutVerdict {
  sessionClass: SessionClass;
  /** `watch-phases` when the payload carried phases; `none` when it did not,
   *  in which case `phases` is empty and `session.verdict` is `not_graded`. */
  basis: 'watch-phases' | 'none';
  phases: GradedPhase[];
  session: SessionGrade;
  work: WorkSummary;
}

/* ══════════════════════════════ 2 · parsing ═════════════════════════════ */

const PHASE_TYPES: readonly string[] = ['warmup', 'work', 'recovery', 'cooldown'];

/** Positive finite number or null. `Number(null)` is 0 and a 0 pace is an
 *  absence, so this is the one coercion every field below goes through. */
function pos(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A heart rate a heart can produce, or null. Same bound `run-shape.ts`'s
 *  `hrToNum` applies — a strap sentinel is not a reading. */
function hr(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 30 && n <= 230 ? Math.round(n) : null;
}

/** Non-negative integer or null — the tolerance counters are seconds and a
 *  zero here is a real "graded, none of it in band". */
function counter(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** The phase type as the wire spells it, folded to the four the grader knows.
 *  `rep` / `tempo` / `threshold` / `intervals` / `race` are older spellings of
 *  a work phase that some payloads still carry. */
function phaseType(v: unknown): PhaseType | 'unknown' {
  const t = String(v ?? '').toLowerCase();
  if (PHASE_TYPES.includes(t)) return t as PhaseType;
  if (t === 'rep' || t === 'tempo' || t === 'threshold' || t === 'intervals' || t === 'race') return 'work';
  return 'unknown';
}

/**
 * The completion payload's phase array, however it arrived.
 *
 * Three call sites parse this three ways — `coach_intents.value` is TEXT and
 * may be a JSON string or an already-parsed object; `runs.data.phases` is the
 * same array copied verbatim at write time. One parser, so a payload shape
 * that decodes in one place decodes everywhere.
 */
export function phasesFromCompletion(value: unknown): unknown[] {
  let payload: unknown = value;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return []; }
  }
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const p = (payload as { phases?: unknown }).phases;
    return Array.isArray(p) ? p : [];
  }
  return [];
}

/* ══════════════════════════════ 3 · grading ═════════════════════════════ */

export interface GradeOptions {
  /** The recovery the plan prescribed, seconds, for every recovery phase that
   *  does not carry its own `targetDurationSec`. From `workout_spec.rep_rest_s`. */
  prescribedRecoverySec?: number | null;
}

/**
 * Grade a stored phase array as ONE session of a known class.
 *
 * The per-phase ladder, most authoritative first, and stated once:
 *
 *   SHAPE      1 · `paceShape` off the wire — the server's own `paceShapeFor`
 *                  round-tripped, so it is authored truth.
 *              2 · `paceShapeFor(type, class)` when the class is known.
 *              3 · The phase type alone: a recovery carries no pace, a
 *                  warm-up or cool-down is a ceiling, work is a window.
 *   TOLERANCE  1 · `tolerancePaceSPerMi` off the wire — the band the runner was
 *                  actually shown and graded against on the wrist (the E3
 *                  frozen-target contract: a later re-pace must not flip a
 *                  verdict).
 *              2 · `phaseToleranceSec(type, class)` — THE table.
 *
 * The device's `verdict` is read only into `storedVerdict`. It never decides
 * anything here.
 */
export function gradeStoredPhases(
  raw: unknown,
  sessionClass: SessionClass,
  opts: GradeOptions = {},
): WorkoutVerdict {
  const list = phasesFromCompletion(raw);
  const classKnown = sessionClass !== 'other';

  const phases: GradedPhase[] = list.map((el, i): GradedPhase => {
    const p = (el && typeof el === 'object' && !Array.isArray(el) ? el : {}) as Record<string, unknown>;
    const type = phaseType(p.type);
    const gradable: PhaseType = type === 'unknown' ? 'work' : type;
    const target = pos(p.targetPaceSPerMi);
    const avg = pos(p.actualPaceSPerMi);
    const hasTarget = target != null;
    const byEffort = p.isStrideSegment === true;

    const wireShape: PaceShape | null =
      p.paceShape === 'ceiling' || p.paceShape === 'window'
        || p.paceShape === 'effort' || p.paceShape === 'none'
        ? p.paceShape
        : null;
    const shape: PaceShape =
      wireShape
      ?? (classKnown
          ? paceShapeFor(gradable, sessionClass, { hasTarget, byEffort })
          : byEffort ? 'effort'
            : !hasTarget ? 'none'
            : gradable === 'recovery' ? 'none'
            : gradable === 'warmup' || gradable === 'cooldown' ? 'ceiling'
            : 'window');

    const wireTol = pos(p.tolerancePaceSPerMi);
    const toleranceSec: number | null =
      shape === 'none' || shape === 'effort' ? null
      : wireTol
        ?? (classKnown
            ? phaseToleranceSec(gradable, sessionClass, { hasTarget, byEffort })
            : shape === 'ceiling' ? EASY_PHASE_TOLERANCE_S_PER_MI
            : sessionToleranceSec('other'));

    const completed = p.completed === false ? false : true;

    // ONE GRADE, ON THE RESOLVED SHAPE. `gradeWorkPhase` for a window,
    // `gradeCeilingPhase` for a ceiling, nothing for the rest — the same two
    // rules `gradePhase` routes to, called on the shape resolved above rather
    // than on one it would re-derive from a class.
    const verdict: PhaseVerdict =
      shape === 'window'
        ? gradeWorkPhase({ targetSecPerMi: target, avgSecPerMi: avg, toleranceSec, completed })
        : shape === 'ceiling'
          ? gradeCeilingPhase({ ceilingSecPerMi: target, avgSecPerMi: avg, completed })
          : 'not_graded';

    const storedRaw = typeof p.verdict === 'string' ? p.verdict : null;
    const storedVerdict = storedRaw != null && (WIRE_PHASE_VERDICTS as readonly string[]).includes(storedRaw)
      ? (storedRaw as WirePhaseVerdict)
      : null;

    const idx = Number(p.index);
    return {
      index: Number.isFinite(idx) ? idx : i,
      type,
      label: typeof p.label === 'string' ? p.label : (typeof p.name === 'string' ? p.name : null),
      shape,
      targetSecPerMi: target,
      toleranceSec,
      avgSecPerMi: avg,
      actualDurationSec: pos(p.actualDurationSec ?? p.durationSec ?? p.duration_sec),
      actualDistanceMi: pos(p.actualDistanceMi ?? p.distanceMi ?? p.distance_mi),
      targetDurationSec: pos(p.targetDurationSec),
      targetDistanceMi: pos(p.targetDistanceMi),
      avgHr: hr(p.avgHr ?? p.avg_hr),
      maxHr: hr(p.maxHr ?? p.max_hr),
      avgCadence: pos(p.avgCadence ?? p.avg_cadence),
      completed,
      isFinishSegment: p.isFinishSegment === true,
      verdict,
      statusLabel: phaseVerdictLabel(verdict, shape),
      storedVerdict,
      timeInToleranceSec: counter(p.timeInToleranceSec),
      timeOutOfToleranceSec: counter(p.timeOutOfToleranceSec),
    };
  });

  // The session ladder, off the SAME per-phase grades — never re-graded.
  const workPhases = phases.filter((p) => p.type === 'work');
  const recoveries = phases
    .filter((p) => p.type === 'recovery')
    .map((p) => ({
      prescribedSec: p.targetDurationSec ?? opts.prescribedRecoverySec ?? null,
      actualSec: p.actualDurationSec,
    }));
  const session = sessionLadder(
    workPhases.map((p) => p.verdict),
    {
      lateCollapse: lateCollapseOf(workPhases.filter((p) => p.shape === 'window' || p.shape === 'ceiling')),
      recoveriesHonest: recoveriesHonestOf(recoveries),
    },
  );

  let sec = 0, mi = 0, hrW = 0, hrWeight = 0;
  for (const p of workPhases) {
    const s = p.actualDurationSec ?? 0;
    if (s > 0) sec += s;
    if (p.actualDistanceMi != null && p.actualDistanceMi > 0) mi += p.actualDistanceMi;
    if (p.avgHr != null && s > 0) { hrW += p.avgHr * s; hrWeight += s; }
  }
  const graded = workPhases.filter((p) => p.verdict !== 'not_graded').length;
  const work: WorkSummary = {
    count: workPhases.length,
    graded,
    landed: workPhases.filter((p) => p.verdict === 'hit' || p.verdict === 'fast').length,
    fellShort: workPhases.filter((p) => p.verdict === 'slow').length,
    incomplete: workPhases.some((p) => p.verdict === 'incomplete'),
    paceSPerMi: sec > 0 && mi > 0 ? Math.round(sec / mi) : null,
    hrAvg: hrWeight > 0 ? Math.round(hrW / hrWeight) : null,
    distanceMi: mi > 0 ? Math.round(mi * 100) / 100 : null,
  };

  return {
    sessionClass,
    basis: phases.length > 0 ? 'watch-phases' : 'none',
    phases,
    session,
    work,
  };
}

/* ══════════════════════════════ 4 · the entry point ═════════════════════ */

export interface ResolveWorkoutVerdictArgs {
  /** `plan_workouts.type` for the day, or the run's own semantic type when
   *  there was no plan row. Null classifies as `other`. */
  type: string | null | undefined;
  /** `plan_workouts.workout_spec`. Null is a real answer. */
  spec: Record<string, unknown> | null | undefined;
  /** `runs.data.phases`, a `coach_intents.value` blob, or its parsed form. */
  phases: unknown;
}

/**
 * THE entry point. Classifies the session from the plan row — the ONE
 * classification the phone, the wrist and every server grader share — then
 * grades the stored phases as that session.
 */
export function resolveWorkoutVerdict(args: ResolveWorkoutVerdictArgs): WorkoutVerdict {
  const spec = args.spec && typeof args.spec === 'object' ? args.spec : null;
  const sessionClass = classifySession(String(args.type ?? ''), spec);
  const restS = spec ? pos(spec.rep_rest_s) : null;
  return gradeStoredPhases(args.phases, sessionClass, { prescribedRecoverySec: restS });
}

/* ══════════════════════ 5 · the consumers' shared reads ═════════════════ */

/**
 * The Targets test-point word, off the canonical session grade.
 *
 * `judgeTestPointExecution` used to grade the work MEAN through
 * `heatAdjustedStatus` — a different quantity from the per-rep verdicts, and
 * the two can disagree (425 and 445 against 430 ±8 is one hit, one slow, and
 * a mean of 435 that reads "on"). When the session was graded, the test point
 * reads the session:
 *
 *   executed              → 'on'   (every rep landed)
 *   every graded rep fast → 'fast'
 *   off_target            → 'slow' (most reps fell short)
 *   uneven / incomplete   → the mean, at the owner's width — a mixed set is
 *                            honestly a mean question
 *   not_graded            → null
 */
export function testPointVerdictFor(
  v: WorkoutVerdict,
  meanFallback: () => 'on' | 'fast' | 'slow' | null,
): 'on' | 'fast' | 'slow' | null {
  if (v.basis === 'none' || v.work.graded === 0) return null;
  const s = v.session;
  if (s.verdict === 'executed') return s.fasts === s.graded && s.graded > 0 ? 'fast' : 'on';
  if (s.verdict === 'off_target') return 'slow';
  return meanFallback();
}

/** The glance done-state's share of work that fell short. Null when nothing
 *  was graded, which the caller must not read as zero (Rule 11). */
export function fellShortShare(v: WorkoutVerdict): number | null {
  if (v.work.graded === 0) return null;
  return v.work.fellShort / v.work.graded;
}

/** Did this graded phase fall short — the canonical twin of the legacy
 *  `wireVerdictFellShort`, kept exported so a consumer with a stored word
 *  and one with a canonical grade ask the same question. */
export function phaseFellShort(p: Pick<GradedPhase, 'verdict'>): boolean {
  return p.verdict === 'slow';
}

/** Did this graded phase land the work. `fast` counts — see `gradeSession`. */
export function phaseLandedTheWork(p: Pick<GradedPhase, 'verdict'>): boolean {
  return p.verdict === 'hit' || p.verdict === 'fast';
}

/** Legacy bridge for a reader that still holds only the device's word. */
export { wireVerdictFellShort };
