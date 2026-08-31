/**
 * lib/plan/probe-instant.ts · the moment the audit harnesses must author at.
 *
 * WHY THIS EXISTS. On 2026-08-30 four separate CIM probes — `_probe_cim_block`,
 * `_probe_cim_phases`, `_probe_cim_sessions` and `_probe_race_pace` — all faked
 * `2026-08-31T19:00:00Z`, which is NOON PACIFIC on the 31st. The plan-drift
 * cron that actually authors the block fires at `0 4 * * *` UTC, which is
 * 21:00 PT on the 30th, and `runnerToday` then resolves `2026-08-30`.
 *
 * Different calendar day, materially different plan. Measured on the same tree:
 *
 *     noon-on-the-31st : first authored week 37.5 mi, easy days 4.0 x4
 *     the real tick    : first authored week 43.5 mi, easy days 3.5/3.5/4.0
 *                        plus a 9 mi medium-long
 *
 * A whole family of audit harnesses was verifying a block that would never be
 * authored, and a plan was signed off on numbers that were never going to ship.
 * Rule 13 says a fix is verified by rendering the real thing; **the authoring
 * instant is part of "the real thing"**, and getting it wrong is its own
 * failure mode — every downstream number is internally consistent and simply
 * describes a different world.
 *
 * One constant, so the four cannot drift apart again. Derive the wall-clock
 * meaning from the cron schedule in `.github/workflows/plan-drift.yml`, never
 * by hand: that file is the authority on when authoring happens, and if it
 * moves, this must move with it.
 */

/**
 * 04:00 UTC on 2026-08-31 = 21:00 PT on 2026-08-30 (PDT, UTC-7).
 *
 * This is the `0 4 * * *` tick of `.github/workflows/plan-drift.yml` — the
 * evening slot added 2026-08-30 so a recovery block whose last prescribed day
 * IS today hands over that evening rather than cold the next morning.
 * `recoveryCompleteDue` became same-day-eligible in the same change.
 */
export const CRON_AUTHOR_INSTANT = new Date('2026-08-31T04:00:00Z');

/**
 * What `runnerToday` resolves the instant above to, in the runner's zone.
 * Stated explicitly because it is the value that actually changes the plan,
 * and because "the 31st" is the intuitive-but-wrong reading of the UTC date.
 */
export const CRON_AUTHOR_TODAY_ISO = '2026-08-30';
