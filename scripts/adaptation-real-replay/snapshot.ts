/**
 * scripts/adaptation-real-replay/snapshot.ts · THE REAL ROWS, AS EXTRACTED.
 *
 * `real-history.snapshot.json` is a READ-ONLY export of the owner's production
 * data, taken with the `faff_readonly` role on 2026-09-02. It is the thing that
 * makes `_real_replay.test.ts` a replay rather than a reconstruction: the
 * canonical engine's own `_replay_ledger.test.ts` says in its own header that
 * its season is "a hand-authored reconstruction ... No production credentials
 * were available in this worktree", and replacing that caveat with evidence is
 * the whole point of this directory.
 *
 * ── WHAT WAS EXTRACTED, AND WITH WHICH PREDICATE ───────────────────────────
 *
 * · `runs`         · Rule 14 · `NOT (data ? 'mergedIntoId')`, the ONE canonical
 *                    predicate (`CANONICAL_ROW_SQL`). 156 rows, 2026-01-01 to
 *                    2026-09-02. Per-phase `hrSamples`/`paceSamples` arrays were
 *                    dropped at extract time for size; every phase SUMMARY
 *                    (`avgHr`, `actualPaceSPerMi`, `actualDurationSec`,
 *                    `completed`, `verdict`) is kept, and that is what the
 *                    grading below reads.
 * · `plan_workouts`· Rule 14 again, and the sharper half of it. This runner has
 *                    48 plan versions and `clearActivePlansFor` never deletes
 *                    the workouts of an archived one, so a query filtered on
 *                    `user_uuid` alone reads all 48 at once — the exact defect
 *                    that made `recentQualityPerWeek` return 36. The extract
 *                    keeps only the 9 plans that were ever THE PLAN IN FORCE on
 *                    some calendar day, and `planInForceAt()` below resolves
 *                    exactly one of them per date.
 * · `races`        · the race-data source-of-truth checklist. A race result is
 *                    read from `races.actual_result`, never from the training
 *                    run that happens to sit on the same date, and never from
 *                    `canonicalLabel` (permanently null in web-v2 anyway).
 * · `training_plans`·`authored_state.t_pace_s_per_mi` and `lthr_bpm`, which are
 *                    stamped AT AUTHORING and are therefore lookahead-free
 *                    anchors for a historical decision point.
 *
 * ── WHAT IS NOT HERE, DELIBERATELY ─────────────────────────────────────────
 *
 * No readiness, sleep, HRV, resting HR or TSB. `input.ts` has nowhere to put
 * them and `_forbidden_inputs.test.ts` fails the build on the vocabulary, so
 * extracting them would only create a temptation with no destination.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/* ══════════════════════════════════════════════════════════════════════════
 * ROW SHAPES  ·  as extracted, not as the app models them
 * ═══════════════════════════════════════════════════════════════════════ */

export interface SnapPhase {
  readonly type: 'warmup' | 'work' | 'recovery' | 'cooldown' | string;
  readonly index: number;
  readonly label?: string;
  readonly completed?: boolean;
  readonly verdict?: string;
  readonly avgHr?: number;
  readonly maxHr?: number;
  readonly actualDistanceMi?: number;
  readonly actualDurationSec?: number;
  readonly actualPaceSPerMi?: number;
  readonly targetPaceSPerMi?: number;
}

export interface SnapSplit {
  readonly i: number;
  readonly distanceMi?: string | null;
  readonly distance?: string | null;
  readonly elapsed?: string | null;
  readonly movingS?: string | null;
  readonly moving_time?: string | null;
  readonly paceSPerMi?: string | null;
  readonly avgHr?: string | null;
  readonly average_heartrate?: string | null;
}

export interface SnapRun {
  readonly runId: string;
  readonly activityId: string;
  readonly date: string;
  readonly startLocal: string | null;
  readonly distanceMi: number | null;
  readonly durationSec: number | null;
  readonly movingSec: number | null;
  readonly paceSPerMi: number | null;
  readonly workoutType: string | null;
  readonly workoutTypeSource: string | null;
  readonly name: string | null;
  readonly source: string | null;
  readonly sportType: string | null;
  readonly indoor: string | null;
  readonly avgHr: number | null;
  readonly avgHrKind: string | null;
  readonly maxHr: number | null;
  readonly elevGainFt: number | null;
  readonly tempF: number | null;
  readonly splitsUnreliable: string | null;
  readonly nSplits: number;
  readonly unmeasuredDistanceMi: number | null;
  readonly unmeasuredSec: number | null;
  readonly clockAudit: Record<string, number> | null;
  readonly manualCorrection: { reason?: string; note?: string; measured?: boolean } | null;
  readonly manualCorrectionBefore: { distanceMi?: number; durationSec?: number } | null;
  readonly manualCorrectionAfter: { distanceMi?: number; durationSec?: number } | null;
  readonly hasPhases: boolean;
  readonly phases: readonly SnapPhase[];
  readonly splits: readonly SnapSplit[];
}

export interface SnapPlan {
  readonly planId: string;
  readonly mode: string;
  readonly raceId: string | null;
  readonly goalISO: string | null;
  readonly authoredISO: string;
  readonly archivedISO: string | null;
  readonly archiveReason: string | null;
  readonly tPaceSPerMi: string | null;
  readonly lthrBpm: string | null;
  readonly goalPaceSPerMi: string | null;
}

export interface SnapWeek {
  readonly planId: string;
  readonly weekIdx: number;
  readonly weekStartISO: string;
  readonly phaseId: string;
  readonly isCutback: boolean;
  readonly isPeak: boolean;
  readonly isRaceWeek: boolean;
}

export interface SnapWorkout {
  readonly planId: string;
  readonly workoutId: string;
  readonly dateISO: string;
  readonly type: string;
  readonly distanceMi: string | number | null;
  readonly paceTargetSPerMi: number | null;
  readonly durationMin: number | null;
  readonly isQuality: boolean;
  readonly isLong: boolean;
  readonly subLabel: string | null;
  readonly spec: Record<string, unknown> | null;
}

export interface SnapRace {
  readonly slug: string;
  readonly name: string | null;
  readonly dateISO: string | null;
  readonly distanceMi: string | null;
  readonly priority: string | null;
  readonly finishS: string | null;
  readonly paceSPerMi: string | null;
  readonly avgHr: string | null;
  readonly provisional: string | null;
  readonly source: string | null;
  readonly totalGainFt: string | null;
}

export interface RealHistorySnapshot {
  readonly extractedAtISO: string;
  readonly athleteId: string;
  readonly runs: readonly SnapRun[];
  readonly plans: readonly SnapPlan[];
  readonly planWeeks: readonly SnapWeek[];
  readonly planWorkouts: readonly SnapWorkout[];
  readonly races: readonly SnapRace[];
  readonly profile: {
    readonly lthr: number | null;
    readonly lthrSetAt: string | null;
    readonly hrmax: number | null;
    readonly hrmaxObserved: number | null;
    readonly weeklyFrequency: number | null;
    readonly timezone: string | null;
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

let cached: RealHistorySnapshot | null = null;

/** The extracted rows. Read once, then shared. Never mutated. */
export function realHistory(): RealHistorySnapshot {
  if (cached) return cached;
  cached = JSON.parse(
    readFileSync(path.join(HERE, 'real-history.snapshot.json'), 'utf8'),
  ) as RealHistorySnapshot;
  return cached;
}

/* ══════════════════════════════════════════════════════════════════════════
 * PLAN IN FORCE  ·  Rule 14, "a query names the population it reads"
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The ONE plan whose prescriptions were live on `dayISO`, as known at
 * `asOfISO`.
 *
 * Two filters, and both matter:
 *
 *  · `authoredISO <= asOfISO` is the NO-LOOKAHEAD half. A plan authored after
 *    the decision point cannot supply its prescriptions to that decision point,
 *    even for a week in the past. Without this, the CIM plan authored on 31 Aug
 *    would silently reprice every June week.
 *  · `archivedISO > dayISO` is the RULE 14 half. Of the 48 plan versions this
 *    runner has, the archived ones still hold all their `plan_workouts` rows,
 *    and reading them together is what once counted 59 quality sessions in one
 *    week.
 */
export function planInForceAt(
  snap: RealHistorySnapshot,
  dayISO: string,
  asOfISO: string,
): SnapPlan | null {
  const dayEnd = `${dayISO}T23:59:59Z`;
  const dayStart = `${dayISO}T00:00:00Z`;
  const visible = snap.plans.filter((p) => p.authoredISO <= asOfISO);

  const live = visible.filter(
    (p) => p.authoredISO <= dayEnd && (p.archivedISO === null || p.archivedISO > dayStart),
  );
  if (live.length > 0) {
    return live.reduce((a, b) => (a.authoredISO >= b.authoredISO ? a : b));
  }

  // No plan was live on that day as far as this decision point can see. Fall
  // back to the most recent plan authored on or before it, which is the plan
  // whose prescriptions the runner was actually following, and return null
  // rather than guessing when even that does not exist.
  const before = visible.filter((p) => p.authoredISO <= dayEnd);
  if (before.length === 0) return null;
  return before.reduce((a, b) => (a.authoredISO >= b.authoredISO ? a : b));
}
