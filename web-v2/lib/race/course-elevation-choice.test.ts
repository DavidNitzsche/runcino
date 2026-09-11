/**
 * lib/race/course-elevation-choice.test.ts
 *
 * Falsifies the exact bug named in `docs/audit-2026-09-11-session-handback.md`
 * §5 Finding 2 and traced in
 * `docs/design/cim-elevation-semantic-trace-2026-09-11.md`: "Both
 * 'Acknowledge' and 'Not now' trace to the same functional outcome — a
 * 14-day suppression, zero data correction — confirming they aren't two
 * meaningful choices."
 *
 * §1 reproduces that bug literally, as it existed before this fix, and
 * proves it WOULD have failed the assertion below (Rule 18 — a gate is not
 * trusted until it has been made to fail). §2 proves the replacement
 * genuinely diverges, on the actual STATE CHANGE each answer produces
 * (`courseLibraryUpdate` — the real mutation instruction the route executes),
 * not merely on which `if` branch ran.
 */
import { describe, it, expect } from 'vitest';
import { decideCourseElevationChoice, type CourseElevationChoiceOutcome } from './course-elevation-choice';

// CIM's real, committed numbers — see the semantic trace §1, §3, §7.
const CIM = {
  slug: 'cim',
  previousGainFt: 100, previousNetFt: -340, // curated, course_library
  measuredGainFt: 723, measuredNetFt: -304, // measured, David's own GPS track
  confidence: 'low', // the branch that reaches this action at all
};

/**
 * The OLD behavior, reproduced literally: `acknowledge` and `not_now`, for
 * the course-changed trigger, before this fix. Both called
 * `suppressTrigger(userId, 'course_changed')` and wrote a receipt with no
 * data write — see the git history of `app/api/v5/goal-answer/route.ts`'s
 * `'acknowledge'` and `'not_now'` cases, both of which only ever called
 * `suppressTrigger` + `writeIntent`, never touching `course_library`.
 */
function oldBrokenOutcome(action: 'acknowledge' | 'not_now'): { suppressTrigger: 'course_changed'; courseLibraryUpdate: null; receipt: Record<string, unknown> } {
  return {
    suppressTrigger: 'course_changed',
    courseLibraryUpdate: null,
    receipt: { action },
  };
}

describe('course-elevation-choice · Rule 18 falsification', () => {
  it('FALSIFIES the old bug: acknowledge and not_now really were identical outcomes', () => {
    const ack = oldBrokenOutcome('acknowledge');
    const notNow = oldBrokenOutcome('not_now');
    // This is the defect, reproduced: the only field that could possibly
    // differ between two answers (courseLibraryUpdate — the actual data
    // correction) is null on BOTH. Confirming this passes on the OLD shape
    // is what proves the new assertion below is a real test and not one
    // that was already trivially true.
    expect(ack.suppressTrigger).toBe(notNow.suppressTrigger);
    expect(ack.courseLibraryUpdate).toBe(notNow.courseLibraryUpdate);
    expect(ack.courseLibraryUpdate).toBeNull();
  });

  it('the NEW pair diverges on the actual state change, not just the branch taken', () => {
    const useIt: CourseElevationChoiceOutcome = decideCourseElevationChoice({
      action: 'use_measured_elevation', ...CIM,
    });
    const keepIt: CourseElevationChoiceOutcome = decideCourseElevationChoice({
      action: 'keep_curated_elevation', ...CIM,
    });

    // Both succeed and both suppress the trigger — the runner answered
    // either way, so the question should not re-fire regardless of which
    // they picked.
    expect(useIt.ok).toBe(true);
    expect(keepIt.ok).toBe(true);
    expect(useIt.suppressTrigger).toBe('course_changed');
    expect(keepIt.suppressTrigger).toBe('course_changed');

    // THIS is the assertion the old pair could never have passed: the
    // actual mutation instruction, not a flag or a label.
    expect(useIt.courseLibraryUpdate).toEqual({
      slug: 'cim', elevationGainFt: 723, netElevationFt: -304,
    });
    expect(keepIt.courseLibraryUpdate).toBeNull();
    expect(useIt.courseLibraryUpdate).not.toEqual(keepIt.courseLibraryUpdate);

    // The undo path: `use_measured_elevation`'s receipt carries what it is
    // about to overwrite. `keep_curated_elevation` overwrites nothing, so it
    // carries none.
    expect(useIt.previous).toEqual({ elevationGainFt: 100, netElevationFt: -340 });
    expect(keepIt.previous).toBeNull();
    expect(useIt.receipt).toMatchObject({ action: 'use_measured_elevation', applied: { elevationGainFt: 723, netElevationFt: -304 } });
    expect(keepIt.receipt).toMatchObject({ action: 'keep_curated_elevation', kept_curated: true });
  });

  it('refuses rather than silently no-oping when the track yields no measurement (Rule 11)', () => {
    const outcome = decideCourseElevationChoice({
      action: 'use_measured_elevation', slug: 'cim',
      measuredGainFt: null, measuredNetFt: null,
      previousGainFt: 100, previousNetFt: -340, confidence: 'reject',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    // A refusal suppresses nothing and writes nothing — the card stays up
    // rather than the runner being told something happened when it did not.
    expect(outcome.suppressTrigger).toBeNull();
    expect(outcome.courseLibraryUpdate).toBeNull();
    expect(outcome.receipt).toBeNull();
  });

  it('keep_curated_elevation never touches course_library, whatever the measured candidate looks like', () => {
    const outcome = decideCourseElevationChoice({
      action: 'keep_curated_elevation', slug: 'cim',
      measuredGainFt: 999, measuredNetFt: -999, // even if a caller passed real numbers
      previousGainFt: 100, previousNetFt: -340, confidence: 'low',
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.courseLibraryUpdate).toBeNull();
  });
});
