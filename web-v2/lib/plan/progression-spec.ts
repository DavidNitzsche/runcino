/**
 * lib/plan/progression-spec.ts · the overload trajectory's decision, persisted.
 *
 * ## What was missing
 *
 * `OverloadTrajectory` computes a `WorkShape` for every generic quality session
 * and `layoutWeek` attaches it to the composed day as `workShape`,
 * `progressionLever` and `challengeZone`. Those three fields were written and
 * never read: only the rendered prescription STRING reached `plan_workouts`, so
 * the geometry died at the persistence boundary. The comment at the assignment
 * site claimed the shape was attached "so a surface that wants the geometry does
 * not have to parse prose back out of the string" — which was not true of
 * anything downstream, because nothing downstream could see it.
 *
 * ## Why it has to survive
 *
 * `Design/adaptive-progression-engine.md` §3 splits progression in two. The plan
 * carries a default trajectory — calendar proposes — and the adaptation model
 * then permits, holds or modifies it. Three of the four verdicts in that table
 * need the shape:
 *
 *     strong    progress as planned, or slightly accelerate
 *     normal    progress as planned
 *     marginal  HOLD CURRENT STIMULUS
 *     poor      REDUCE OR MODIFY STIMULUS
 *
 * "Hold the current stimulus" is unanswerable without knowing what the current
 * stimulus was. The alternative is regexing `"3×10 min @ T pace · 60s jog"` back
 * into numbers, which is exactly the drift the string was never meant to carry.
 *
 * ## Where it lives, and the multi-writer hazard
 *
 * Under one key on `plan_workouts.workout_spec`, so CLAUDE.md Rule 6 applies
 * with full force: that column has at least six writers and a naive
 * `SET workout_spec = $1` erases whatever the active writer did not know about.
 * This codebase has paid for that twice already (`strava_activities.data.splits`,
 * `races.actual_result`). ONE key rather than three fields means one guard
 * covers the whole block — `preserveProgressionSql` — and a writer that rebuilds
 * a spec for the SAME session keeps it.
 *
 * A writer that deliberately makes the row a DIFFERENT session — the adapter
 * downgrading a threshold day to easy, or replacing it with a field test — does
 * NOT preserve it, and that is the rule working rather than an exception to it:
 * explicit destruction beats silent destruction, and a shape describing a
 * session that is no longer on the row would be a lie about what the runner was
 * asked to do.
 */
import type { ChallengeZone, ProgressionLever, WorkShape } from '@/lib/prescription/levers';
import { LEVER_ORDER } from '@/lib/prescription/levers';

/** The single `workout_spec` key the whole block lives under. */
export const PROGRESSION_SPEC_KEY = 'progression';

/** The persisted form. snake_case, like every other `workout_spec` field. */
export interface ProgressionSpec {
  reps: number;
  rep_minutes: number;
  recovery_minutes: number;
  pace_s_per_mi: number;
  zone: ChallengeZone;
  /** Null on a seed week, a deload, or a week where every lever was capped. */
  lever: ProgressionLever | null;
}

const ZONES: ChallengeZone[] = ['ESTABLISHED', 'PROGRESSIVE', 'PROBE'];

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The fields to spread into a `workout_spec` at authoring time.
 *
 * Returns `{}` when there is no shape, so the caller can spread
 * unconditionally and a day the trajectory does not own is byte-identical.
 *
 * `repsOverride` exists because `capSpecToDistance` may trim a rep after the
 * shape was computed. The persisted block must describe the session that was
 * actually PRESCRIBED — that is what "hold the current stimulus" means — so the
 * spec's own rep count wins over the trajectory's intent whenever they differ.
 */
export function progressionSpecFields(args: {
  shape: WorkShape | null | undefined;
  lever?: ProgressionLever | null;
  zone?: ChallengeZone | null;
  repsOverride?: number | null;
}): Record<string, ProgressionSpec> {
  const s = args.shape;
  if (!s || !(s.reps > 0) || !(s.repMinutes > 0) || !(s.paceSPerMi > 0)) return {};
  const reps = args.repsOverride != null && args.repsOverride > 0 ? args.repsOverride : s.reps;
  return {
    [PROGRESSION_SPEC_KEY]: {
      reps: Math.round(reps),
      rep_minutes: Number(s.repMinutes.toFixed(2)),
      recovery_minutes: Number(Math.max(0, s.recoveryMinutes).toFixed(2)),
      pace_s_per_mi: Math.round(s.paceSPerMi),
      zone: args.zone ?? s.zone,
      lever: args.lever ?? null,
    },
  };
}

/**
 * Read the block back off a persisted spec.
 *
 * Returns null for anything malformed rather than a half-populated shape — a
 * consumer deciding whether to hold a stimulus must be able to tell "no shape
 * recorded" from "a shape with a zero in it".
 */
export function readProgressionSpec(spec: unknown): {
  shape: WorkShape;
  lever: ProgressionLever | null;
  zone: ChallengeZone;
} | null {
  if (!spec || typeof spec !== 'object') return null;
  const raw = (spec as Record<string, unknown>)[PROGRESSION_SPEC_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;

  const reps = num(p.reps);
  const repMinutes = num(p.rep_minutes);
  const recoveryMinutes = num(p.recovery_minutes);
  const paceSPerMi = num(p.pace_s_per_mi);
  if (reps == null || repMinutes == null || paceSPerMi == null) return null;
  if (!(reps > 0) || !(repMinutes > 0) || !(paceSPerMi > 0)) return null;

  const zone = ZONES.includes(p.zone as ChallengeZone) ? (p.zone as ChallengeZone) : null;
  if (zone == null) return null;
  const lever = LEVER_ORDER.includes(p.lever as ProgressionLever)
    ? (p.lever as ProgressionLever)
    : null;

  return {
    shape: {
      reps: Math.round(reps),
      repMinutes,
      recoveryMinutes: recoveryMinutes != null && recoveryMinutes >= 0 ? recoveryMinutes : 0,
      paceSPerMi,
      zone,
    },
    lever,
    zone,
  };
}

/**
 * CLAUDE.md Rule 6 · the SQL a writer uses when it rewrites `workout_spec` for a
 * session whose IDENTITY has not changed.
 *
 * `param` is the placeholder carrying the new spec (`'$1'`, `'$4'`, …). In an
 * UPDATE, a bare column reference on the right of SET is the OLD row, which is
 * what lets this read the value it is about to overwrite.
 *
 * Every branch is covered deliberately:
 *   · new spec carries a block           → the new block wins (the author re-ran)
 *   · new spec carries none, old had one → the old block is carried forward
 *   · neither carries one                → nothing happens
 *   · new spec is NULL                   → NULL, because a row with no spec has
 *                                          no session to describe
 *
 * `qualifier` names the table for the old-row reference. Pass the alias when the
 * statement uses one; the default is the bare table name.
 */
export function preserveProgressionSql(param: string, qualifier = 'plan_workouts'): string {
  const old = `${qualifier}.workout_spec`;
  const key = PROGRESSION_SPEC_KEY;
  return `CASE
              WHEN ${param}::jsonb IS NOT NULL
               AND NOT (${param}::jsonb ? '${key}')
               AND ${old} IS NOT NULL
               AND ${old} ? '${key}'
              THEN jsonb_set(${param}::jsonb, '{${key}}', ${old}->'${key}')
              ELSE ${param}::jsonb
            END`;
}
