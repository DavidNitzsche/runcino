/**
 * lib/training/workout-type.ts · ONE name for what a day's session is.
 *
 * ## The two defects this closes
 *
 * ### 1 · `interval` and `intervals` both exist
 *
 * Production carries both spellings in `workout_type`: 214 rows say `interval`
 * and 41 say `intervals`. They mean the same thing, and the split is not
 * cosmetic — `QUALITY_TYPES` in `lib/runs/log-enrich.ts` contains `intervals`
 * and NOT `interval`, so a completed rep session stored under the singular
 * never earned its SOLID / ON TARGET badge. The codebase had already grown
 * workarounds rather than a fix: `run-state.ts` tests for both spellings in one
 * list, `vdot.ts` maps four spellings onto one domain, `effort-map.ts` matches
 * on substrings.
 *
 * `intervals` (plural) is canonical, for three reasons that all point the same
 * way: it is what `DayPlan['type']` in the generator emits, it is what
 * `plan_workouts.type` is therefore written with, and it is what `QUALITY_TYPES`
 * already contains.
 *
 * The SINGULAR is not a misspelling to be stamped out, though, and that is why
 * this file normalises rather than renames. `'interval'` is also the name of a
 * PACE DOMAIN — Daniels' I zone — in `lib/execution/interpret.ts`,
 * `lib/prescription/trajectory.ts#SessionFamily`, `lib/plan/dosing.ts` and
 * `AT_PACE_SESSION_MI.interval`. Those are a different concept (which
 * physiological zone the work sits in, not what kind of day it is) and they
 * keep their singular name. Only `workout_type` values are normalised here.
 *
 * NO MIGRATION IS RUN. Read-time normalisation fixes every consumer at once and
 * is reversible; a data migration is neither, and the DDL rule in CLAUDE.md
 * requires an explicit per-statement go regardless. A migration proposal is in
 * the handover report.
 *
 * ### 2 · three `WorkoutType` unions with different members
 *
 * | Union | Members | Verdict |
 * |---|---|---|
 * | `lib/coach/run-purpose.ts` | 12 · has `fartlek`, `progression`, `recovery` | same axis · converged here |
 * | `lib/training/prescriptions.ts` | 9 · has none of those three | same axis · converged here |
 * | `lib/faff/types.ts` | 9 · `easy/long/quality/rest/race/recovery/shakeout/cross/strength` | DIFFERENT AXIS · stays separate |
 *
 * The first two answer the same question — what kind of session is this day? —
 * and one is a strict subset of the other, which meant `derivePurpose` could be
 * asked about a fartlek day that `prescriptionFor` could not be asked about at
 * all. Both now alias `SessionType`.
 *
 * `lib/faff/types.ts` is genuinely a different axis and is deliberately NOT
 * merged: it is the mobile wire contract's COARSE bucket, paired with its own
 * `WorkoutSubLabel` for the detail (`quality` + `intervals`, `quality` + `tempo`).
 * Two levels of a taxonomy are not two spellings of one level. Collapsing them
 * would either lose the sub-label distinction or force every wire consumer to
 * handle thirteen cases where it currently handles nine.
 */

/**
 * Every kind of day the engine can author or the log can record.
 *
 * The union of what `run-purpose.ts` and `prescriptions.ts` each had, plus
 * `race_week_tuneup` — which the generator has emitted since the taper work
 * landed and which `lib/watch/build-workout.ts` has been casting into a union
 * that did not contain it.
 */
export const SESSION_TYPES = [
  'easy',
  'long',
  'recovery',
  'shakeout',
  'tempo',
  'threshold',
  'intervals',
  'fartlek',
  'progression',
  'race_week_tuneup',
  'race',
  'rest',
  'unplanned',
] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

const CANONICAL = new Set<string>(SESSION_TYPES);

/**
 * Spellings the codebase already treats as one thing, gathered in one place.
 *
 * Every entry here is EVIDENCE from an existing consumer, not a guess:
 *   · `interval`  · `lib/coach/run-state.ts` lists it beside `intervals`
 *   · `vo2`       · `lib/training/vdot.ts` folds it into the interval domain
 *   · `vo2max`    · same
 *   · `track`     · `lib/faff/effort-map.ts` maps it to `intervals`
 *   · `tune_up`   · the generator's own `race_week_tuneup`, hyphen variants
 *
 * `quality` is deliberately absent. It is the COARSE wire bucket from
 * `lib/faff/types.ts`, not a synonym for any single session type, and guessing
 * which one it meant is how a tempo becomes a rep session.
 */
const ALIASES: Record<string, SessionType> = {
  interval: 'intervals',
  vo2: 'intervals',
  vo2max: 'intervals',
  'vo2-max': 'intervals',
  track: 'intervals',
  repeats: 'intervals',
  'race-week-tuneup': 'race_week_tuneup',
  race_week_tune_up: 'race_week_tuneup',
  tuneup: 'race_week_tuneup',
  tune_up: 'race_week_tuneup',
  'long-run': 'long',
  longrun: 'long',
  'easy-run': 'easy',
  lt: 'threshold',
  'sub-threshold': 'threshold',
};

/**
 * The canonical `SessionType` for a raw workout-type string, or null.
 *
 * Null means "this is not a session type I recognise" — never a fallback guess.
 * A caller that needs a default picks its own; silently returning `easy` for an
 * unknown string is how a rep session becomes a jog.
 */
export function canonicalSessionType(raw: unknown): SessionType | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  if (!s) return null;
  if (CANONICAL.has(s)) return s as SessionType;
  const alias = ALIASES[s] ?? ALIASES[s.replace(/_/g, '-')];
  return alias ?? null;
}

/**
 * Normalise a workout-type string, keeping anything unrecognised as-is.
 *
 * The lenient sibling of `canonicalSessionType`, for read paths that must not
 * drop a value they cannot classify — the run log records what Strava and
 * HealthKit actually said, and an unfamiliar string is data, not an error.
 */
export function normalizeWorkoutTypeLoose(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  return canonicalSessionType(s) ?? s;
}

/** True when this session type is structured quality work. */
export function isQualitySessionType(raw: unknown): boolean {
  const t = canonicalSessionType(raw);
  return t === 'tempo' || t === 'threshold' || t === 'intervals'
    || t === 'fartlek' || t === 'progression' || t === 'race_week_tuneup';
}
