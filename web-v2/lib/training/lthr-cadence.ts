/**
 * lib/training/lthr-cadence.ts · the LTHR re-test cadence, and nothing else.
 *
 * WHY THIS FILE EXISTS: it is the half of `lthr-reanchor.ts` a BROWSER is
 * allowed to see.
 *
 * `lthr-reanchor.ts` says of itself that it "is PURE and imports no database
 * at any depth, so a client bundle can read `LTHR_RETEST_CADENCE_DAYS` from
 * it". The intent is right and worth keeping — the profile tile's stale marker
 * and the engine's staleness limb should be the same number by construction,
 * not by two people typing 84. The claim was simply not true:
 *
 *     components/faff-app/Shell.tsx            'use client'
 *       → views/ProfileView.tsx                imports the constant
 *         → lib/training/lthr-reanchor.ts      imports lthrFromRace
 *           → lib/training/lthr.ts             `await import('@/lib/db/pool')`
 *             → pg → fs · dns · net · tls
 *
 * `lthr.ts` is pure at the top but `resolveThresholdHr` lazily pulls the pool
 * in. A dynamic import is still a bundled edge, so webpack followed it into the
 * client graph and failed to resolve four node built-ins. That broke every
 * Railway deploy of `main` from 9a0c6314 onward — `next build` failed while
 * `tsc` and all twelve prebuild gates passed, so nothing caught it.
 *
 * `resolveThresholdHr` could not move to a store module because one of its
 * callers is `app/api/v5/today/route.ts`, held by another agent. So the
 * constants moved down here instead: a leaf with no imports at all, which
 * `lthr-reanchor.ts` re-exports so its own public surface is unchanged and
 * `DOCTRINE_REGISTRY`'s `lib/training/lthr-reanchor.ts#...` bindings still name
 * a symbol that module exports.
 *
 * Friel's re-test cadence, `Research/03-heart-rate-zones.md` §6: "Re-test every
 * 6-12 weeks." The CEILING of that band is the point past which a stored anchor
 * is stale — inside the band a re-test is due but not overdue, and the engine
 * does not nag on the near edge of a range doctrine states as a range.
 *
 * Bound by `LTHR.retest-cadence-is-the-shelf-life`, which parses both weeks out
 * of the doc's own sentence.
 */
export const LTHR_RETEST_MIN_WEEKS = 6;
export const LTHR_RETEST_MAX_WEEKS = 12;
export const LTHR_RETEST_CADENCE_DAYS = LTHR_RETEST_MAX_WEEKS * 7;
