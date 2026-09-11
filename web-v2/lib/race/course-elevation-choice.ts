/**
 * lib/race/course-elevation-choice.ts · the pure decision half of the
 * course-elevation CHOICE answers.
 *
 * `POST /api/v5/goal-answer`'s `use_measured_elevation` /
 * `keep_curated_elevation` cases (only reachable from
 * `lib/training/race-card.ts#courseChangedChoiceCard`, the low-confidence
 * branch) are kept thin: this module decides WHAT to write, the route
 * executes it. Same split as `race-card.ts` being the pure half of the
 * card itself, and for the same reason — this is the one place the two
 * answers' actual divergence can be asserted without a database.
 *
 * ── The bug this closes ──────────────────────────────────────────────────
 *
 * `docs/audit-2026-09-11-session-handback.md` §5 Finding 2 and
 * `docs/design/cim-elevation-semantic-trace-2026-09-11.md`: the old
 * course-changed card offered `acknowledge` / `not_now`, and BOTH traced to
 * the identical outcome in `goal-answer/route.ts` — suppress the trigger
 * for `TRIGGER_SUPPRESS_DAYS`, write a receipt, correct no data either way.
 * Two buttons, one outcome.
 *
 * `decideCourseElevationChoice` is the proof the replacement genuinely
 * diverges: `use_measured_elevation` returns a real `courseLibraryUpdate`
 * that changes what `course_library` — and therefore every other consumer
 * of `resolveCourseElevation()` — reads from then on; `keep_curated_elevation`
 * returns `null` there and touches nothing. Both suppress the trigger; only
 * one is a data correction.
 */

export interface CourseElevationChoiceOutcome {
  ok: boolean;
  /** Present only when `ok` is false — Rule 11: a refusal is a fact, never a
   *  silent no-op dressed as success. */
  error?: string;
  /** Null only on refusal. `use_measured_elevation` and `keep_curated_elevation`
   *  both suppress the trigger when they succeed — that much they share, on
   *  purpose (the runner answered either way; the question shouldn't re-fire). */
  suppressTrigger: 'course_changed' | null;
  /**
   * The actual state change. Non-null ONLY for a successful
   * `use_measured_elevation` — this is the field whose presence/absence IS
   * the divergence the falsification test asserts on, not which `case`
   * branch executed.
   */
  courseLibraryUpdate: { slug: string; elevationGainFt: number | null; netElevationFt: number | null } | null;
  /** The values `courseLibraryUpdate` is about to overwrite, carried so a
   *  manual reversal is possible — the undo path lives in this receipt. */
  previous: { elevationGainFt: number | null; netElevationFt: number | null } | null;
  receipt: Record<string, unknown> | null;
}

export function decideCourseElevationChoice(args: {
  action: 'use_measured_elevation' | 'keep_curated_elevation';
  slug: string;
  measuredGainFt: number | null;
  measuredNetFt: number | null;
  previousGainFt: number | null;
  previousNetFt: number | null;
  confidence: string;
}): CourseElevationChoiceOutcome {
  const { action, slug } = args;

  if (action === 'keep_curated_elevation') {
    return {
      ok: true,
      suppressTrigger: 'course_changed',
      courseLibraryUpdate: null,
      previous: null,
      receipt: { action, slug, kept_curated: true },
    };
  }

  // use_measured_elevation — Rule 11: "could not measure" is a distinct fact
  // from "measured zero", and neither may silently become the other. A
  // conflict card is never built with both fields null (see
  // `detectCourseChanged`), but this action can be reached with a race whose
  // GPS track has since been removed or replaced, so the guard still earns
  // its keep here.
  if (args.measuredGainFt == null && args.measuredNetFt == null) {
    return {
      ok: false,
      error: 'Could not derive an elevation profile from the GPS track.',
      suppressTrigger: null,
      courseLibraryUpdate: null,
      previous: null,
      receipt: null,
    };
  }

  const previous = { elevationGainFt: args.previousGainFt, netElevationFt: args.previousNetFt };
  const applied = { elevationGainFt: args.measuredGainFt, netElevationFt: args.measuredNetFt };
  return {
    ok: true,
    suppressTrigger: 'course_changed',
    courseLibraryUpdate: { slug, ...applied },
    previous,
    receipt: { action, slug, previous, applied, confidence: args.confidence },
  };
}
