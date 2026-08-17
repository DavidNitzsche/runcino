/**
 * lib/faff/race-countdown.ts · THE one way to answer "how far away is the
 * race?"
 *
 * Locked 2026-08-17 after Train rendered "7 days to Dec 6" while Dec 6 was
 * 111 days out. The countdown was derived from the ACTIVE PLAN'S GEOMETRY —
 * `(raceIdx - focusIdx) * 7`, where `raceIdx` is just the last index of the
 * plan's week array (seed.ts adaptSeason). With a 2-week post-race recovery
 * block that arithmetic yields 7, and it will always yield a multiple of 7,
 * because it is counting plan weeks rather than calendar days.
 *
 * The plan's last week is NOT the race week. It is only the race week when
 * the active plan happens to be the goal-race build. A recovery block, a
 * bridge block, a maintenance block, or any plan that has been rebuilt or
 * has run out entirely all break that assumption — and each one breaks it
 * silently, producing a confident, wrong, round number.
 *
 * The rule: days-to-race comes from the race's own date and today's date.
 * One source. No plan geometry may participate. This is the same fact
 * `GoalRace.daysAway` already carries (seed.ts:889, off the races table);
 * this module is the pure, testable form of it so every surface can agree
 * without re-deriving.
 *
 * Pure · no IO · no clock read. Callers pass the runner's own today.
 */

const DAY_MS = 86_400_000;

/** Noon-anchored parse · the repo idiom that survives DST and tz drift. */
function parseDayISO(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.slice(0, 10) + 'T12:00:00Z');
  return Number.isFinite(t) ? t : null;
}

/**
 * Whole calendar days from `todayISO` to `raceDateISO`.
 *
 * Returns null when either date is missing or unparseable — callers must
 * render nothing rather than fall back to a plan-derived guess. Negative
 * for a race already run; 0 on race day.
 */
export function daysToRace(
  raceDateISO: string | null | undefined,
  todayISO: string | null | undefined,
): number | null {
  const race = parseDayISO(raceDateISO);
  const today = parseDayISO(todayISO);
  if (race == null || today == null) return null;
  return Math.round((race - today) / DAY_MS);
}

/**
 * Whole weeks from `todayISO` to `raceDateISO`, floored. Null on the same
 * terms as `daysToRace`. Provided so surfaces that want a week count stop
 * reaching for `plan.weeks.length` to get one.
 */
export function weeksToRace(
  raceDateISO: string | null | undefined,
  todayISO: string | null | undefined,
): number | null {
  const days = daysToRace(raceDateISO, todayISO);
  return days == null ? null : Math.floor(days / 7);
}
