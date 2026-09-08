import { runPhases, type RunData } from '@/lib/runs/run-shape';

/**
 * lib/coach/recap-phase-readings.ts · everything the recap reads off ONE
 * stored phase array.
 *
 * ── WHY THIS IS A MODULE AND NOT INLINE IN THE ROUTE (SIMROW-1 · RECAP) ─────
 *
 * `GET /api/runs/[id]/recap` mapped the raw phase array itself and then
 * derived SIX separate quantities from the result — the frozen work target,
 * the work pace, the work distance, the rep count, the per-rep paces and the
 * finish-segment pace. Every one of them was route-local, so the only way a
 * test could reach them was to re-implement them, and a test that
 * re-implements the code it checks cannot fail on that code changing
 * (Rule 18). This is the same extraction, and the same argument, as
 * `lib/runs/work-averages.ts#workStatsForDisplay` — the module that carries
 * the Today route's half of the identical defect.
 *
 * ── ALL SIX COME OFF ONE ARRAY, ALWAYS ──────────────────────────────────────
 *
 * That is the point of returning them as a SET rather than as six reads. The
 * defect this was extracted for (see `_recap_phase_row_identity.test.ts`) put
 * a simulator's single 31-second rep where the runner's seven work phases
 * belonged; the trio of numbers that came off it — 1 rep, 0.09 mi, 5:44/mi —
 * were mutually consistent and jointly false. A mixed reading, where the rep
 * count comes from one payload and the pace from another, is the one outcome
 * that must be impossible by construction (Rule 16).
 *
 * ── THE NUMERIC CORE COMES FROM ITS OWNER ───────────────────────────────────
 *
 * `run-shape.ts#runPhases` already owns "what is in a stored phase": the three
 * eras and which fields each populates, that a heart rate outside 30-230 is a
 * strap sentinel rather than a reading, and that a phase carrying `hrSamples`
 * but no `avgHr` still has a measured heart rate. The route's own ladder knew
 * none of that, and `gradeStoredPhases` and `workStatsForDisplay` both already
 * route through the same owner. Two consequences worth naming, because both
 * are behaviour changes:
 *
 *   1. A work phase whose `avgHr` is absent but whose per-second `hrSamples`
 *      are present now contributes its heart rate. The recap carries `avgHr`
 *      so its threshold-band sentences can be gated on the WORK heart rate
 *      (Rule 16); the owner's fallback is what makes that number exist on the
 *      sessions where the watch wrote samples and no mean.
 *   2. `type` and `verdict` are narrowed to the values the owner recognises.
 *      The raw `type` string still decides when the owner returns null — the
 *      work filter compares it itself, and dropping an unrecognised spelling
 *      here would silently shrink the work set (Rule 11).
 *
 * `isFinishSegment` is read off the ELEMENT by position, because
 * `NormalizedPhase` does not carry it — the same shape, and the same argument,
 * as `workStatsForDisplay`'s cadence read.
 *
 * ── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────────────
 *
 * It does not choose WHICH array. That question has exactly one owner,
 * `lib/postrun/load.ts#resolveStoredPhases`, and handing this function the
 * wrong array is precisely the defect it was extracted during. It also does
 * not grade: `lib/execution/verdict.ts` owns the verdict, and the `verdict`
 * field carried through here is the DEVICE'S stored word, never a judgement
 * made in this file.
 */

/** One stored phase, in the field names the recap and `deriveWin` read. */
export interface RecapPhase {
  type: string | null;
  verdict: string | null;
  actualPaceSPerMi: number | null;
  targetPaceSPerMi: number | null;
  actualDistanceMi: number | null;
  avgHr: number | null;
  actualDurationSec: number | null;
  isFinishSegment: boolean;
  actualSpeedMph: number | null;
  actualInclinePct: number | null;
  completed: boolean | null;
}

export interface RecapPhaseReadings {
  /** The mapped phases, for `deriveWin` and the treadmill belt read. */
  phases: RecapPhase[];
  /**
   * E3 · the target the reps were PRESCRIBED AT THE TIME, frozen into the
   * completion. Null when no work phase carries one, which is the caller's cue
   * to fall back to the live `plan_workouts` row.
   */
  frozenTargetSPerMi: number | null;
  /** Distance-weighted pace across the work phases. */
  workPaceSPerMi: number | null;
  /** Total work distance. Null rather than 0 when no work phase carries one. */
  workDistanceMi: number | null;
  /** How many work phases ran. Null when there were none. */
  repCount: number | null;
  /** Per-rep actual paces, in rep order, for the pacing-pattern read. */
  repPaces: number[];
  /** The finish segment's own pace, when the payload marked one. */
  finishPaceSPerMi: number | null;
}

/** Most common value in a list (ties resolve to the first seen). Picks the
 *  representative frozen work-phase target across reps (E3). */
function modePace(xs: number[]): number {
  const counts = new Map<number, number>();
  let best = xs[0];
  let bestN = 0;
  for (const x of xs) {
    const n = (counts.get(x) ?? 0) + 1;
    counts.set(x, n);
    if (n > bestN) { bestN = n; best = x; }
  }
  return best;
}

/** The empty reading. A run with no stored phases has no work block to
 *  describe — which is a different answer from a work block of zero, and the
 *  nulls below are what say so (Rule 11). */
const NONE: RecapPhaseReadings = {
  phases: [],
  frozenTargetSPerMi: null,
  workPaceSPerMi: null,
  workDistanceMi: null,
  repCount: null,
  repPaces: [],
  finishPaceSPerMi: null,
};

export function recapPhaseReadings(stored: readonly unknown[]): RecapPhaseReadings {
  // Pre-filtered so `normalized[i]` and `elements[i]` name the same phase.
  // `runPhases` drops non-objects, and `isFinishSegment` is read off the
  // element.
  const elements = stored.filter(
    (el): el is Record<string, unknown> => !!el && typeof el === 'object' && !Array.isArray(el),
  );
  if (elements.length === 0) return NONE;
  const normalized = runPhases({ phases: elements } as unknown as RunData);

  const phases: RecapPhase[] = normalized.map((n, i): RecapPhase => {
    const el = elements[i] ?? {};
    return {
      // `n.type` is null for a spelling outside the four the owner knows. The
      // raw value still decides, because the work filter below compares it
      // itself and dropping the phase here would silently shrink the work set.
      type: n.type ?? (typeof el.type === 'string' ? el.type : null),
      verdict: n.verdict,
      actualPaceSPerMi: n.actualPaceSPerMi,
      targetPaceSPerMi: n.targetPaceSPerMi,
      actualDistanceMi: n.actualDistanceMi,
      // RULE 16 · carried so the recap's threshold-band sentences can be gated
      // on the WORK heart rate rather than the whole run's.
      avgHr: n.avgHr,
      actualDurationSec: n.actualDurationSec,
      isFinishSegment: el.isFinishSegment === true,
      // BELT-WIN-1 · the treadmill console's own readings, carried so
      // `winTreadmill` has something to read. `completed` keeps its three
      // states — a phase that never said is not a phase that said no, and the
      // composer's `!== false` test depends on that.
      actualSpeedMph: n.actualSpeedMph,
      actualInclinePct: n.actualInclinePct,
      completed: n.completed,
    };
  });

  const frozenWorkTargets = phases
    .filter((p) => p.type === 'work' && p.targetPaceSPerMi)
    .map((p) => p.targetPaceSPerMi as number);
  const frozenTargetSPerMi = frozenWorkTargets.length > 0 ? modePace(frozenWorkTargets) : null;

  // Work-phase pace + distance for the tempo recap copy. Both derived from the
  // same work-phase filter so the "4.0 mi @ 7:18" pair is always consistent.
  const workPhases = phases.filter((p) => p.type === 'work' && p.actualPaceSPerMi);
  const workDistMiRaw = workPhases.reduce((s, p) => s + (p.actualDistanceMi ?? 0), 0);
  const workDistanceMi: number | null = workDistMiRaw > 0 ? workDistMiRaw : null;

  // AUDIT #33 · DISTANCE-WEIGHTED work pace = total work time / total work
  // distance. The old unweighted mean of rep paces over-/under-weighted short
  // reps (1mi@6:00 + 0.5mi@7:00 → mean 6:30 but true avg 6:20) and disagreed
  // with the workDistanceMi printed beside it. For equal-length reps the
  // weighted value EQUALS the mean, so this is a no-op on the standard set.
  // Weight only phases that carry a real distance; fall back to the unweighted
  // mean when none do (so we never lose a value we previously had).
  const weightablePhases = workPhases.filter((p) => (p.actualDistanceMi ?? 0) > 0);
  const workPaceSPerMi: number | null = (() => {
    if (workPhases.length === 0) return null;
    if (weightablePhases.length > 0) {
      const totalDist = weightablePhases.reduce((s, p) => s + (p.actualDistanceMi as number), 0);
      const totalTime = weightablePhases.reduce(
        (s, p) => s + (p.actualPaceSPerMi as number) * (p.actualDistanceMi as number), 0);
      return totalDist > 0 ? totalTime / totalDist : null;
    }
    // No phase carries a distance — keep the legacy unweighted mean.
    return workPhases.reduce((s, p) => s + (p.actualPaceSPerMi as number), 0) / workPhases.length;
  })();

  const repPaces: number[] = workPhases
    .map((p) => p.actualPaceSPerMi as number)
    .filter((p) => typeof p === 'number' && p > 0);

  const finishPhase = phases.find((p) => p.isFinishSegment && p.actualPaceSPerMi != null);

  return {
    phases,
    frozenTargetSPerMi,
    workPaceSPerMi,
    workDistanceMi,
    repCount: workPhases.length > 0 ? workPhases.length : null,
    repPaces,
    finishPaceSPerMi: finishPhase?.actualPaceSPerMi ?? null,
  };
}
