/**
 * SAFETYSTOP-1 (2026-09-02) · WHAT THE WRIST SAYS WHEN SAFETY WITHHOLDS.
 *
 * ── WHAT THIS IS, AND WHAT IT IS DELIBERATELY NOT ───────────────────────────
 *
 * This is NOT a safety owner, and it does not DECIDE anything safety decides.
 * `docs/BRAIN_CONSTITUTION.md` gives Safety exactly one canonical owner,
 * `web-v2/lib/safety/**`, and that owner already exports the two predicates
 * every surface asks:
 *
 *   `mayEmitRunnableWorkout(res)`   Constitution §31, as a function.
 *   `mayEmitQualityWorkout(res)`    "do not present a quality session as
 *                                    cleared until the check succeeds".
 *
 * An earlier draft of this file re-derived the first of those from `posture`
 * by hand. That was a second answer to a question that already had one — the
 * exact thing the constitution forbids — and it was wrong to write even though
 * it happened to agree. Both predicates are CALLED now, and this file owns one
 * thing only: **which sentence the runner reads**, which the owner does not
 * express and should not.
 *
 * ── WHAT THE BEHAVIOUR USED TO BE ───────────────────────────────────────────
 *
 * `build-workout.ts` resolved an open injury and STILL shipped the runnable
 * workout beside its "Not today" board. That was deliberate, and its own
 * comment said why: "the workout still ships beside this, so a deployed watch
 * runs the session unchanged and a 0821 build draws No session instead." The
 * cost of that compatibility is that a watch on any older build will happily
 * execute a session on an injured runner.
 *
 * David's ruling: "Determine active watch build distribution from available
 * telemetry or deployment evidence. Until proven otherwise, preserve
 * compatibility without allowing older builds to execute a workout that the
 * canonical safety owner has marked STOP. If complete build information is
 * unavailable, document the uncertainty and choose the safer behavior."
 *
 * ── THE TELEMETRY, AND ITS LIMITS (measured 2026-09-02, production, RO) ─────
 *
 *   · Watch-sourced runs in the last 120 days, grouped by user: ONE user,
 *     53 runs, most recent 2026-09-02, out of 16 accounts. There is no fleet
 *     of older watch builds in the field to strand — there is one device.
 *   · That device's payloads carry every field the CURRENT build emits:
 *     `movingSec` present on every run since 2026-08-21, `paceSamples` and
 *     per-phase `verdict` throughout, `ceilingLift` / `recoveryExtensions`
 *     (the 2026-08-21 wrist decisions) on the runs that earned them.
 *
 *   THE UNCERTAINTY, STATED: nothing on this wire identifies a watch BUILD.
 *   `device_tokens.app_version` is the PHONE's push registration (28 rows, all
 *   `3.0.1`) and says nothing about the watch. So the evidence is indirect: it
 *   shows one active watch user on a build that emits current fields, not a
 *   proven build number. Per the ruling, incomplete build information resolves
 *   to the safer behaviour — and here the safer behaviour is also free.
 *
 * ── WHY THIS COSTS NO COMPATIBILITY AT ALL ──────────────────────────────────
 *
 * `WatchTodayResponse` has been a two-branch union since long before the
 * No-session board: `{ workout, ...glance }` or `{ message, ...glance }`. The
 * message branch is the ORIGINAL shape and every build ever shipped renders
 * it — it is what a rest day and an empty calendar have always returned. So a
 * withheld session needs no new field, no version negotiation, no capability
 * probe. It takes the branch the whole fleet already understands, and the
 * `dayState` board rides along for the builds that can draw it.
 *
 * The safer behaviour and the compatible behaviour are the same behaviour.
 */
import {
  mayEmitQualityWorkout,
  mayEmitRunnableWorkout,
  type SafetyResolution,
} from '@/lib/safety/safety-verdict';

/** May a runnable workout leave for the wrist, and if not, what is said instead.
 *
 *  `withhold` carries WHY, because "safety stopped training", "the check did
 *  not run" and "easy only, and this session is not easy" are three different
 *  facts and the runner is owed a different sentence for each (Rule 11). */
export type WatchSafetyGate =
  | { kind: 'ship' }
  | { kind: 'withhold'; why: 'stopped' | 'unchecked' | 'quality_not_cleared'; message: string };

/**
 * Turn the canonical resolution into a wire decision and a sentence.
 *
 * `isQualitySession` is the session `build-workout.ts` has already composed —
 * `sessionClass === 'threshold' || 'interval'`, the same predicate the rest of
 * that file uses. It is passed in rather than re-derived so there is one
 * answer to "is this quality" as well.
 *
 * ── THE THREE WITHHOLDING CASES ─────────────────────────────────────────────
 *
 *   stopped               `mayEmitRunnableWorkout` is false and the check RAN.
 *                         Safety has stopped ordinary training.
 *   unchecked             `mayEmitRunnableWorkout` is false because the check
 *                         did NOT run. Retryable, and it is our fault, not his.
 *   quality_not_cleared   Running is licensed, quality is not, and the session
 *                         on the calendar is quality. The wire cannot down-
 *                         scope it — authoring an easy version is a
 *                         PRESCRIPTION decision owned by the plan engine, and
 *                         inventing one here would be another second answer.
 *                         So the honest wire behaviour is to withhold this
 *                         session and say which running is licensed. That is
 *                         `mayEmitQualityWorkout`'s own stated purpose:
 *                         "prevent the app from confidently presenting a
 *                         quality session as cleared."
 */
export function resolveWatchSafetyGate(
  res: SafetyResolution,
  isQualitySession: boolean,
): WatchSafetyGate {
  if (!mayEmitRunnableWorkout(res)) {
    // `known` is the honest discriminator between the two: a STOP is a verdict
    // somebody reached, and an unresolved check is not. Reading `posture` to
    // tell them apart would work today and would silently pick the wrong
    // sentence the day a fifth posture is added.
    return res.known
      ? {
          kind: 'withhold',
          why: 'stopped',
          // Coach voice. States the fact, judges nothing, and does not repeat
          // what the No-session board beside it already draws (Rule 17).
          message: 'Not today. Nothing to run while this is open.',
        }
      : {
          kind: 'withhold',
          why: 'unchecked',
          // NOT "not today" — that asserts a verdict nobody reached. The
          // honest sentence is that we could not check, and that it is ours to
          // fix rather than his.
          message: 'We could not check in on you. Nothing to run until we can.',
        };
  }

  if (isQualitySession && !mayEmitQualityWorkout(res)) {
    return {
      kind: 'withhold',
      why: 'quality_not_cleared',
      message: 'Easy running only today. The hard session is not cleared.',
    };
  }

  return { kind: 'ship' };
}
