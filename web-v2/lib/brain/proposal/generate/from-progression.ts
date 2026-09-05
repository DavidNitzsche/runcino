/**
 * lib/brain/proposal/generate/from-progression.ts · THE SESSION-GEOMETRY LEVERS,
 * AS ACTIONS.
 *
 * ── WHAT THIS TRANSLATES, AND WHY IT IS THE HIGHEST-VALUE ONE ──────────────
 *
 * `lib/plan/progression-pass.ts` already resolves, once a training week, what a
 * quality session's shape should be: reps, minutes per rep, jog recovery, work
 * pace, against a verdict of TAKE / ACCELERATE / HOLD / BACK_OFF. It is the one
 * mechanism in this engine that can ask a session to get HARDER on four
 * separate axes, and `docs/ADAPTATION_PROGRESSION_DOCTRINE.md` says those axes
 * are four questions with four owners and must never collapse into one score.
 *
 * And it reached the runner as a single word. The resolution became an
 * `AdaptationAction` of kind `reshape`, which the seam refuses (it is not in
 * `PROPOSABLE_KINDS`), which `toObservationalNote` turns into
 * `{ sealed_kind: 'reshape' }`. Four levers, one string, no direction, nothing
 * countable. That is exactly the record Rule 21 could not read: "309 intents,
 * zero upward" had to be established by querying `coach_intents` sideways
 * because the engine's own log could not say WHAT moved.
 *
 * So the resolution is translated into the levers it actually pulled, one
 * action per axis, and the axes are the ones the doctrine names.
 *
 * ── ONE PRIMARY STRESSOR, AND HOW THAT SURVIVES THE TRANSLATION ────────────
 *
 * `ADAPTATION_PROGRESSION_DOCTRINE` requires one primary stressor at a time,
 * and `resolveWeekProgression` already enforces that upstream — a resolution
 * carries ONE `lever`. So this reads that field rather than diffing the shapes
 * and guessing, and a shape whose numbers moved on two axes with one declared
 * lever is REPORTED rather than silently split into two actions: two actions
 * for one decision would double-count the very census this exists to feed.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE STEP WAS EARNED. `progression-gate.ts` decides that and this
 *   reads its verdict. A wrong ACCELERATE is translated faithfully into an
 *   action that says MORE, and nothing here would object.
 * · WHETHER THE SHAPE IS DOCTRINALLY LEGAL. `advanceShape` caps it and
 *   `dosingBreachIfWritten` re-checks the whole week at apply time. This is
 *   description, not sizing.
 * · A LEVER THE RESOLUTION DOES NOT DECLARE. `lever` is null on HOLD and
 *   BACK_OFF by construction, so a BACK_OFF is read off the SHAPE DIFF instead,
 *   and a back-off that changed nothing reads as a HOLD — which is what it is.
 */

import type { ProgressionResolution } from '@/lib/plan/progression-pass';
import type { BrainAction, RowBefore } from '../action';
import { ACTION_SCHEMA_VERSION } from '../action';
import { roundTo } from '@/lib/format/run';

/**
 * One resolution, as the action it is.
 *
 * Returns exactly one action: a decision the runner answers once. A resolution
 * that moved nothing is a HOLD, which is a real answer and not an absence
 * (Rule 11) — the engine looked at this session and decided to leave it, and
 * that is the row a reader needs to tell "never pushed" from "did not earn it".
 */
export function actionFromProgression(
  resolution: ProgressionResolution,
  before: readonly RowBefore[],
): BrainAction {
  const base = { schemaVersion: ACTION_SCHEMA_VERSION, before } as const;
  const from = resolution.authored;
  const to = resolution.shape;

  /* HOLD and BACK_OFF pull no lever, so `lever` is null on both and the two
   * have to be told apart by what happened to the shape. A held session and a
   * backed-off one are different things to read on a Tuesday. */
  if (resolution.action === 'HOLD' || !resolution.changed) {
    return {
      ...base,
      kind: 'HOLD',
      direction: 'NEUTRAL',
      because: resolution.why,
    };
  }

  const harder = resolution.action === 'TAKE' || resolution.action === 'ACCELERATE';
  const direction = harder ? 'MORE' as const : 'LESS' as const;

  /* The declared lever first. Only when it is absent — a BACK_OFF — is the
   * shape diffed, and then in the doctrine's own order of primacy: density
   * (recovery) is the sharpest change to a session, then rep count, then rep
   * length, then pace. */
  const lever = resolution.lever ?? inferLever(from, to);

  switch (lever) {
    case 'pace':
      return {
        ...base, kind: 'PACE_CHANGE', direction,
        lever: paceLeverOf(resolution.family),
        to: { unit: 'sec_per_mi', value: Math.round(to.paceSPerMi) },
      };

    case 'rep_count':
      return {
        ...base, kind: 'REPETITION_CHANGE', direction,
        to: { unit: 'reps', value: to.reps },
      };

    case 'recovery_duration':
      /* A SHORTER recovery is MORE work, which is why direction comes from the
       * verdict and never from comparing the two numbers. A renderer that
       * decided direction from "the number went down" would draw the hardest
       * step in this engine as a pull-back. */
      return {
        ...base, kind: 'RECOVERY_INTERVAL_CHANGE', direction,
        to: { unit: 'min', value: roundTo(to.recoveryMinutes, 1) },
      };

    case 'interval_duration':
      return {
        ...base, kind: 'DURATION_CHANGE', direction,
        to: { unit: 'min', value: roundTo(to.repMinutes, 1) },
      };

    /* UNREACHABLE FROM THIS PASS TODAY, and kept rather than deleted.
     * `SessionFamily` is `threshold | interval | repetition`, so
     * `resolveWeekProgression` never walks a long run and never resolves this
     * lever — which is why LONG_RUN_STRUCTURE_CHANGE carries a GENERATOR gap in
     * `facets.ts` rather than claiming this arm. The arm exists because
     * `ProgressionLever` DOES contain the lever, and falling through to the
     * dose default would silently describe a long-run change as a quality dose:
     * a wrong answer where a refusal was available. */
    case 'long_run_duration':
      return {
        ...base, kind: 'LONG_RUN_STRUCTURE_CHANGE', direction,
        to: resolution.family,
        /* The SHAPE, not the reason. `resolution.why` is coach prose of
         * unbounded length that already travels to the card as its own `why`,
         * so echoing it here would print one sentence twice (Rule 17) and could
         * exceed the card length `validateAction` enforces. */
        describe: `${to.reps} x ${roundTo(to.repMinutes, 1)} min at ${resolution.family} pace`,
      };

    /* `quality_duration` and `work_density` both move the total minutes AT
     * PACE, which is the dose. They differ in HOW — one lengthens the reps, the
     * other packs them closer — and the runner reads the same sentence for
     * both, so they land on the same kind. */
    case 'quality_duration':
    case 'work_density':
    default:
      return {
        ...base, kind: 'QUALITY_DOSE_CHANGE', direction,
        lever: doseLeverOf(resolution.family),
        to: { unit: 'min', value: roundTo(to.reps * to.repMinutes, 1) },
      };
  }
}

/**
 * Which axis moved, when the resolution did not say.
 *
 * Only reached for a BACK_OFF, which pulls no lever and therefore declares
 * none. The order is the doctrine's order of primacy, and the FIRST match wins
 * rather than the largest — a back-off that shortened the reps and lengthened
 * the recovery has changed the session's density, and reporting that as a
 * duration change would name the smaller half of what happened.
 */
function inferLever(
  from: ProgressionResolution['authored'],
  to: ProgressionResolution['shape'],
): 'recovery_duration' | 'rep_count' | 'interval_duration' | 'pace' | 'quality_duration' {
  if (!near(from.recoveryMinutes, to.recoveryMinutes)) return 'recovery_duration';
  if (from.reps !== to.reps) return 'rep_count';
  if (!near(from.repMinutes, to.repMinutes)) return 'interval_duration';
  if (!near(from.paceSPerMi, to.paceSPerMi, 1)) return 'pace';
  return 'quality_duration';
}

/**
 * The session family, as the pace lever the card names.
 *
 * `SessionFamily` is the engine's word and the union's `lever` is the runner's;
 * mapping here rather than on the surface is what stops the phone learning an
 * engine word (Rule 16's surface half).
 */
function paceLeverOf(family: string): 'THRESHOLD' | 'MARATHON' | 'INTERVAL' | 'EASY' {
  return doseLeverOf(family);
}

/**
 * `SessionFamily` is exactly `threshold | interval | repetition`, so this is
 * total over what the pass can actually produce and the fallback is not a
 * catch-all — it is the third member. Repetition work is priced off the same
 * anchor as intervals in this app's pace layer, so it reads INTERVAL rather
 * than gaining a lever the union does not have.
 */
function doseLeverOf(family: string): 'THRESHOLD' | 'MARATHON' | 'INTERVAL' {
  if (family === 'interval' || family === 'repetition') return 'INTERVAL';
  return 'THRESHOLD';
}


const near = (a: number, b: number, tol = 0.05): boolean => Math.abs(a - b) <= tol;
