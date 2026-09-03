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
  MP_PHASE_TOLERANCE_S_PER_MI,
  looksLikeMarathonPaceLabel,
  type PaceShape,
  type PhaseType,
  type PhaseVerdict,
  type SessionClass,
  type SessionGrade,
  type WirePhaseVerdict,
} from '@/lib/training/execution-semantics';
// `pos` is run-shape's own "a finite positive number, or null", imported as
// `num` rather than re-written: it answers the same question about the same
// fields of the same payload (Rule 16).
import { hrToNum, pos as num, runPhases, type NormalizedPhase, type RunData } from '@/lib/runs/run-shape';
import { workAveragesFromPhases } from '@/lib/runs/work-averages';
import { looksLikeStrideLabel } from '@/lib/training/expand-spec';

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
  /** Resolved by `gradeStoredPhases` on the two rungs its `GradeOptions`
   *  describes. A stride is never pace-graded: its `shape` is `effort` and its
   *  `verdict` is `not_graded`, because doctrine calls it "Not a workout". */
  isStrideSegment: boolean;
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
}

/* NO `distanceMi`. It was here, nothing in the app read it, and returning it
 * meant either a third copy of the work-distance sum — which
 * `check-derived-consistency` correctly flagged, since a pace, a duration and
 * a distance from one arithmetic family sat in this block unreconciled — or
 * widening `work-averages.ts` to carry a field for a single caller.
 * Constitution §26: prefer deletion. A consumer that needs the work distance
 * sums the graded phases it already holds. */

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

/** The phase type as older payloads spell it, folded to the four the grader
 *  knows. `run-shape.ts#runPhases` returns null for anything outside the four;
 *  these five are older spellings of a WORK phase that some rows still carry,
 *  and reading them as `unknown` would drop real reps out of the work set. */
function phaseType(v: unknown): PhaseType | 'unknown' {
  const t = String(v ?? '').toLowerCase();
  if (t === 'warmup' || t === 'work' || t === 'recovery' || t === 'cooldown') return t as PhaseType;
  if (t === 'rep' || t === 'tempo' || t === 'threshold' || t === 'intervals' || t === 'race') return 'work';
  return 'unknown';
}

/** A non-negative counter, or null. Zero is a REAL reading here — a rep the
 *  device graded and found entirely outside the band — so it survives. */
function counter(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
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
  /**
   * STRIDE-ROUNDTRIP-1 (2026-09-02) · `workout_spec.strides_reps`.
   *
   * `byEffort` below has always been the right hook — `paceShapeFor` turns it
   * into `effort`, which is never pace-graded — and it has never once fired,
   * because the only thing that sets it is `p.isStrideSegment` and that marker
   * does not survive the round trip. `appendStrides` sets it, `build-workout.ts`
   * puts it on the prescription wire, the wrist decodes it, and
   * `WatchCompletionPhase` (the outgoing struct) declares no such property. So
   * every stored phase array in this database describes a 20-second
   * acceleration as ordinary work, and the runner's 2026-09-02 screen graded
   * four of his six strides as deviations for being quick.
   *
   * This licenses the LABEL rung: with the spec's own rep count in hand, a
   * phase labelled by `strideLabelFor` is a stride. Absent or zero, only the
   * marker rung applies — a label alone may never mint a stride, because a
   * caller with no plan row must not have its phases relabelled by their text.
   */
  stridesPrescribed?: number | null;
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
  /* THE NUMERIC CORE COMES FROM `run-shape.ts#runPhases`, not from a second
   * parser written here.
   *
   * That module already owns "what is in a stored phase" — it knows the three
   * eras (watch, treadmill, phone), which fields each populates, that a
   * treadmill phase carries no verdict and no target, and that a heart rate
   * outside 30-230 is a strap sentinel rather than a reading. Re-deriving any
   * of that here would be a second answer to a question that has an owner
   * (Rule 16), and the fields it does not carry — the ones below — are read
   * off the same element by position. */
  const stridesPrescribed = Math.max(0, Math.round(Number(opts.stridesPrescribed ?? 0)) || 0);
  const list = phasesFromCompletion(raw)
    .filter((el): el is Record<string, unknown> => !!el && typeof el === 'object' && !Array.isArray(el));
  const normalized: NormalizedPhase[] = runPhases({ phases: list } as unknown as RunData);
  const classKnown = sessionClass !== 'other';

  const phases: GradedPhase[] = normalized.map((n, i): GradedPhase => {
    const p = list[i] ?? {};
    const type: PhaseType | 'unknown' = n.type ?? phaseType(p.type);
    const gradable: PhaseType = type === 'unknown' ? 'work' : type;
    const target = n.targetPaceSPerMi;
    const avg = n.actualPaceSPerMi;
    const hasTarget = target != null;
    /* THE MARKER, OR THE PLAN'S OWN COUNT PLUS THE AUTHORED LABEL.
     *
     * Rung 1 is authored truth and needs nothing else. Rung 2 is a FALLBACK and
     * is written as one: it is conjunctive, so a label can never mint a stride
     * on a session that prescribed none, and it exists only because the wrist
     * does not send rung 1 back yet. See `GradeOptions.stridesPrescribed`. */
    const byEffort = p.isStrideSegment === true
      || (stridesPrescribed > 0 && looksLikeStrideLabel(n.label));

    const wireShape: PaceShape | null =
      p.paceShape === 'ceiling' || p.paceShape === 'window'
        || p.paceShape === 'effort' || p.paceShape === 'none'
        ? p.paceShape
        : null;
    // MP-EMBEDDED-1, 2026-09-04 · `paceShapeFor` grades every work phase of a
    // `long` session as a ceiling, because it sees a phase TYPE and a
    // SESSION class, never the phase's own intent. A marathon-specific long
    // run's embedded MP segment is not the easy running around it —
    // `Research/01`'s M row: "window for general MP segments" — and the
    // owner's real 2026-06-27 long run ("10.0 mi easy" into "4.0 mi @
    // marathon pace", self-authored on the watch, no `paceShape` on either
    // phase) proved the gap: the MP phase graded `ceiling`, so 462 s/mi
    // against a 434 s/mi marathon pace read as compliant no matter how
    // slow, and the post-run copy that tried to name the gap anyway
    // (`experience.ts`'s since-reverted `paceShortfalls`) inverted ceiling
    // semantics instead. Checked ONLY when the wire itself is silent —
    // `wireShape`, `p.paceShape` from the device, always wins outright, per
    // Rule 10 (a stamped anchor is read, not second-guessed).
    const looksLikeMP = wireShape == null && gradable === 'work' && hasTarget
      && looksLikeMarathonPaceLabel(n.label);
    const shape: PaceShape =
      wireShape
      ?? (looksLikeMP
          ? 'window'
          : classKnown
            ? paceShapeFor(gradable, sessionClass, { hasTarget, byEffort })
            : byEffort ? 'effort'
              : !hasTarget ? 'none'
              : gradable === 'recovery' ? 'none'
              : gradable === 'warmup' || gradable === 'cooldown' ? 'ceiling'
              : 'window');

    const wireTol = num(p.tolerancePaceSPerMi);
    const toleranceSec: number | null =
      shape === 'none' || shape === 'effort' ? null
      : wireTol
        ?? (looksLikeMP
            ? MP_PHASE_TOLERANCE_S_PER_MI
            : classKnown
              ? phaseToleranceSec(gradable, sessionClass, { hasTarget, byEffort })
              : shape === 'ceiling' ? EASY_PHASE_TOLERANCE_S_PER_MI
              : sessionToleranceSec('other'));

    const completed = n.completed !== false;

    // ONE GRADE, ON THE RESOLVED SHAPE. `gradeWorkPhase` for a window,
    // `gradeCeilingPhase` for a ceiling, nothing for the rest — the same two
    // rules `gradePhase` routes to, called on the shape resolved above rather
    // than on one it would re-derive from a class.
    const verdict: PhaseVerdict =
      shape === 'window'
        ? gradeWorkPhase({ targetSecPerMi: target, avgSecPerMi: avg, toleranceSec, completed })
        : shape === 'ceiling'
          /* CEIL-SLACK-1 (2026-09-02) · THE PHASE'S OWN SLACK, which is what the
           * wrist uses and what this call was missing.
           *
           * `WorkoutEngine.swift`'s ceiling arm reads `let slack =
           * p.tolerancePaceSPerMi ?? 30`. This read no `slackSec` at all, so
           * `gradeCeilingPhase` fell back to `EASY_PHASE_TOLERANCE_S_PER_MI`
           * (30) on EVERY phase — and the two only agree where the phase's own
           * tolerance happens to be 30, which is warm-up and cool-down and
           * nothing else. Measured against the owner's live plan, 2026-09-02:
           *
           *   easy 2026-09-04  target 522, tolerance 20 · wrist calls 8:15/mi
           *                    (495) FAST at 502; this called it HIT at 492
           *   long 2026-09-06  target 520, tolerance 18 · wrist 502, server 490
           *
           * Ten to twelve seconds a mile of disagreement between the grade the
           * runner was shown on the wrist and the grade the server recomputes
           * for the post-run screens, on every easy and every long day. Rule
           * 16, on the one quantity the two surfaces both call a verdict.
           *
           * `_watch_grader_parity.test.ts` could not see it: its EXECSEM-5c
           * arm asserts the two FALLBACKS are both 30, which is the one case
           * where a missing `slackSec` is harmless (Rule 22 — a gate that can
           * only fail on the default cannot fail on the data). */
          ? gradeCeilingPhase({ ceilingSecPerMi: target, avgSecPerMi: avg, completed, slackSec: toleranceSec ?? undefined })
          : 'not_graded';

    return {
      index: n.index,
      type,
      label: n.label,
      shape,
      targetSecPerMi: target,
      toleranceSec,
      avgSecPerMi: avg,
      actualDurationSec: n.actualDurationSec,
      actualDistanceMi: n.actualDistanceMi,
      targetDurationSec: num(p.targetDurationSec),
      targetDistanceMi: num(p.targetDistanceMi),
      avgHr: n.avgHr,
      maxHr: hrToNum(p.maxHr ?? p.max_hr),
      avgCadence: num(p.avgCadence ?? p.avg_cadence),
      completed,
      isFinishSegment: p.isFinishSegment === true,
      /* THE ONE RESOLVED ANSWER, so no consumer re-derives it (Rule 16). The
       * post-run composer, the phone's `phase_breakdown` and the win line all
       * read this rather than each asking the question their own way. */
      isStrideSegment: byEffort,
      verdict,
      statusLabel: phaseVerdictLabel(verdict, shape),
      // The DEVICE'S word, already whitelisted by `run-shape.ts`.
      storedVerdict: n.verdict,
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

  /* THE WORK NUMBERS COME FROM THEIR OWNER, not from arithmetic written here.
   *
   * `lib/runs/work-averages.ts` is the one place duration-weighted work
   * averages are computed, and its own header says why: "the one thing that
   * must not happen is two screens computing them two ways." A third copy here
   * would be exactly that — and `check-derived-consistency` said so, flagging
   * this block for holding a pace, a duration and a distance from one
   * arithmetic family with none of them reconciled. */
  const avgs = workAveragesFromPhases(workPhases.map((p) => ({
    type: 'work',
    sec: p.actualDurationSec,
    mi: p.actualDistanceMi,
    hr: p.avgHr,
    cadence: p.avgCadence,
  })));
  const graded = workPhases.filter((p) => p.verdict !== 'not_graded').length;
  const work: WorkSummary = {
    count: workPhases.length,
    graded,
    landed: workPhases.filter((p) => p.verdict === 'hit' || p.verdict === 'fast').length,
    fellShort: workPhases.filter((p) => p.verdict === 'slow').length,
    incomplete: workPhases.some((p) => p.verdict === 'incomplete'),
    paceSPerMi: avgs.paceSPerMi,
    hrAvg: avgs.hrAvg,
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
  const restS = spec ? num(spec.rep_rest_s) : null;
  const strides = spec ? num(spec.strides_reps) : null;
  return gradeStoredPhases(args.phases, sessionClass, {
    prescribedRecoverySec: restS,
    stridesPrescribed: strides,
  });
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
