/**
 * lib/runs/log-enrich.ts · pure enrichment helpers for the run log
 * (log-state.ts). No DB access — every function is deterministic on its
 * inputs so the truth rules are unit-testable.
 *
 * 2026-08-17 · Activity-surface truth audit. Three verified bugs fixed here:
 *
 *   1. NAME COALESCING · after dedup the canonical row is usually the
 *      watch's `name='Run'`; the Strava twin carrying the real name
 *      ("AFC Half", "Intervals") was merged away (data.mergedIntoId).
 *      The absorb path (lib/runs/canonical.ts) only copies fields the
 *      canonical LACKS — and the canonical always has a (generic) name —
 *      so the good name never lands. Read-time fix: when the canonical's
 *      name is generic, take the best merged twin's non-generic name.
 *
 *   2. RACE MATCHING · runs on a race day matching the race distance
 *      (or flagged workoutType='race' by any twin) are races, not easy
 *      runs. They get the race's curated display name (races.meta.name),
 *      isRace, the race slug (so the UI can link to the race page), and
 *      workoutType='race' so effort donuts color them correctly.
 *
 *   3. BADGES · log-state only ever emitted LONGEST (≥18 mi) which left
 *      the UI's NAILED IT / SOLID branches dead. Real conditions now:
 *      race → RACE · plan-matched quality within pace target → NAILED IT
 *      · completed quality → SOLID · ≥18 mi → LONGEST.
 */

export type LogBadge = 'RACE' | 'NAILED IT' | 'SOLID' | 'LONGEST';

/** A merged-away duplicate row of a canonical run (data.mergedIntoId set). */
export interface MergedTwin {
  name: string | null;
  source: string | null;
  /** Raw data.workoutType from the twin (Strava numeric '1'/'3' or a
   *  plan-stamped string like 'race'/'tempo'). */
  workoutType: string | null;
}

/** Minimal race shape for run↔race matching (from races.meta). */
export interface RaceForMatch {
  slug: string;
  name: string | null;
  date: string | null;        // YYYY-MM-DD
  distanceMi: number | null;  // meta.distanceMi ?? distanceMiFromLabel(label)
}

/** Plan workout resolved for a date (across ALL the user's plans). */
export interface PlanWorkoutLite {
  type: string;
  paceTargetSPerMi: number | null;
  isQuality: boolean;
}

/**
 * Generic device-default run names that carry zero information. Strava's
 * time-of-day defaults ("Morning Run") are generic too — a human-authored
 * name ("AFC Half", "Little Monday speed hit") never matches these shapes.
 */
export function isGenericRunName(name: string | null | undefined): boolean {
  if (!name) return true;
  const s = String(name).trim().toLowerCase();
  if (!s) return true;
  return /^(?:(?:morning|lunch|afternoon|evening|night)\s+)?(?:run|treadmill(?:\s+run)?|workout|outdoor run|indoor run)$/.test(s);
}

/**
 * Display name for a canonical run: its own name when non-generic, else the
 * best merged twin's non-generic name (Strava-sourced twins preferred — the
 * runner names runs in Strava), else the canonical's own (generic) name.
 */
export function coalesceRunName(
  canonicalName: string | null | undefined,
  twins: MergedTwin[],
): string {
  if (!isGenericRunName(canonicalName)) return String(canonicalName);
  const named = twins.filter(t => !isGenericRunName(t.name));
  if (named.length > 0) {
    const strava = named.find(t => (t.source ?? '').toLowerCase() === 'strava');
    return String((strava ?? named[0]).name);
  }
  return canonicalName ? String(canonicalName) : 'Run';
}

/**
 * Normalize a raw data.workoutType value. Strava's numeric codes map
 * 1→race, 2→long, 3→tempo (0 = default/none). Plan-stamped strings pass
 * through lowercased. Null when nothing meaningful.
 */
export function normalizeDataWorkoutType(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === '0') return null;
  if (s === '1') return 'race';
  if (s === '2') return 'long';
  if (s === '3') return 'tempo';
  return s;
}

/**
 * Match a run against the user's races: same local date AND (run distance
 * within ~12% of the race distance OR any row of the physical run —
 * canonical or twin — carries workoutType='race'). The 12% band absorbs
 * GPS over/under-measure; the workoutType branch catches courses that
 * measured far off (tunnels, dense city) but were explicitly flagged.
 */
export function matchRaceForRun(
  run: { date: string; distanceMi: number; workoutTypeHint: string | null },
  races: RaceForMatch[],
): RaceForMatch | null {
  if (!run.date) return null;
  for (const race of races) {
    if (!race.date || race.date !== run.date) continue;
    if (race.distanceMi != null && race.distanceMi > 0) {
      const rel = Math.abs(run.distanceMi - race.distanceMi) / race.distanceMi;
      if (rel <= 0.12) return race;
    }
    if (run.workoutTypeHint === 'race') return race;
  }
  return null;
}

/** Quality types that earn SOLID / NAILED IT when completed. Long runs are
 *  deliberately excluded — LONGEST (≥18 mi) covers the notable ones and a
 *  badge on every long run would be noise. */
export const QUALITY_TYPES = new Set([
  'tempo', 'threshold', 'intervals', 'quality', 'vo2', 'track',
  'race_pace', 'race_simulation', 'race_week_tuneup',
]);

/**
 * Badge for a completed run. Priority: RACE > NAILED IT > SOLID > LONGEST.
 *
 * NAILED IT requires a plan pace target AND the run's average pace within
 * max(10 s/mi, 3%) of it — honest only for steady quality (tempo/threshold);
 * interval sessions' whole-run average includes recovery jog so they settle
 * at SOLID rather than false-negative on the target check.
 */
export function badgeForRun(args: {
  isRace: boolean;
  workoutType: string | null;
  distanceMi: number;
  paceSPerMi: number | null;
  plan: PlanWorkoutLite | null;
}): LogBadge | null {
  if (args.isRace) return 'RACE';
  const t = (args.workoutType ?? '').toLowerCase();
  const isQuality = QUALITY_TYPES.has(t) || (args.plan?.isQuality ?? false);
  if (isQuality) {
    const target = args.plan?.paceTargetSPerMi ?? null;
    if (
      target != null && target > 0 &&
      args.paceSPerMi != null && args.paceSPerMi > 0 &&
      ['tempo', 'threshold', 'race_pace'].includes((args.plan?.type ?? t).toLowerCase()) &&
      Math.abs(args.paceSPerMi - target) <= Math.max(10, target * 0.03)
    ) {
      return 'NAILED IT';
    }
    return 'SOLID';
  }
  if (args.distanceMi >= 18) return 'LONGEST';
  return null;
}

/**
 * Effort/workout type for a run, in truth order:
 *   race match → 'race'
 *   plan-assigned type for the date (any plan, active preferred)
 *   the physical run's own workoutType hint (canonical or twin)
 *   the activity's raw type
 */
export function resolveWorkoutType(args: {
  isRace: boolean;
  planType: string | null;
  workoutTypeHint: string | null;
  activityType: string | null;
}): string | null {
  if (args.isRace) return 'race';
  return args.planType ?? args.workoutTypeHint ?? args.activityType;
}
