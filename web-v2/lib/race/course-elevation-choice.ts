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
 *
 * ── Editorial protection (2026-09-11, CLAUDE.md Rule 6) ─────────────────
 *
 * `course_library` is a GLOBAL, cross-user table (`slug` UNIQUE, no
 * `user_uuid` — migrations 102/127). `lib/courses/promote-from-race.ts`'s
 * own header states the rule for `source='editorial'` rows verbatim:
 * "Editorial is canonical. Do NOT overwrite geometry_json ... Just bump
 * contributor_count." `use_measured_elevation` is reached ONLY when
 * `resolveCourseElevation()`'s confidence in the runner's own GPS reading is
 * genuinely `low` — the resolver itself already declined to auto-adopt it.
 * Applying an admittedly-untrusted single trace over a curated editorial
 * baseline (CIM, AFC, Big Sur, Sombrero Half) is exactly the multi-writer
 * jsonb-column-shape violation Rule 6 exists to catch, just on plain integer
 * columns instead of a jsonb blob.
 *
 * No per-contributor elevation-measurement record exists in this schema
 * (`promote-from-race.ts`'s `contributor_count` counts full-geometry
 * promotions, not scalar elevation disagreements, and repurposing it here
 * would be inventing new semantics for an existing column rather than
 * following the documented pattern). So for an editorial row this function
 * REFUSES the write the same way `courseLibraryUpdate: null` already means
 * "nothing to apply" for `keep_curated_elevation` — `ok` stays `true` (the
 * runner's answer was received and is not itself invalid), the trigger is
 * still suppressed (the question was answered; it must not re-fire), and the
 * receipt records `editorialProtected: true` plus both readings so the
 * decision is auditable. This is a disclosed limitation, not a silent
 * no-op: the route surfaces `applied: false` with a plain-language reason on
 * this branch specifically so the runner's choice produces an honest outcome
 * even though the confidence bar for the CHOICE path already means the
 * server treats the reading as one it does not trust enough to persist over
 * curated data.
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
  /** Set only on the editorial-protection branch of `use_measured_elevation`
   *  (`ok: true`, `courseLibraryUpdate: null`) — a plain-language reason the
   *  route surfaces as `applied: false` so the runner's choice produces an
   *  honest outcome rather than an indistinguishable-from-success no-op
   *  (Rule 11). Distinct from `error`, which is reserved for `ok: false`. */
  note?: string;
}

export function decideCourseElevationChoice(args: {
  action: 'use_measured_elevation' | 'keep_curated_elevation';
  slug: string;
  measuredGainFt: number | null;
  measuredNetFt: number | null;
  previousGainFt: number | null;
  previousNetFt: number | null;
  confidence: string;
  /** `course_library.source` for this slug, `null` when there is no row at
   *  all. Required (not defaulted) so a call site cannot forget to pass it
   *  and silently regain the editorial-overwrite bug — see the file header. */
  librarySource: 'editorial' | 'crowd-sourced' | 'stub' | null;
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

  // Editorial protection — see the file header. The runner's own reading is
  // acknowledged (the question is answered, so it must not re-fire) but
  // never written over curated data. `courseLibraryUpdate: null` is the same
  // "nothing to apply" signal `keep_curated_elevation` uses above, which is
  // what lets the route skip the UPDATE with no separate flag to forget.
  if (args.librarySource === 'editorial') {
    const curated = { elevationGainFt: args.previousGainFt, netElevationFt: args.previousNetFt };
    const measured = { elevationGainFt: args.measuredGainFt, netElevationFt: args.measuredNetFt };
    return {
      ok: true,
      suppressTrigger: 'course_changed',
      courseLibraryUpdate: null,
      previous: null,
      receipt: { action, slug, editorialProtected: true, curated, measured, confidence: args.confidence },
      note: 'This course’s elevation record is set from certified race data and is shared by every runner training toward it. Your GPS reading was noted but the record was not changed.',
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
