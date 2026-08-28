/**
 * lib/audit/timezone-date-exemptions.ts · the sites where a bare
 * `<timestamptz column>::date` is allowed to stand, and the argument for
 * each.
 *
 * Read `lib/audit/timezone-date-scan.ts` first — it defines the violation and
 * the incident that motivated it.
 *
 * UNLIKE `swallowed-failure-registry.ts`'s EMPTIED ratchet, this list has no
 * legacy to forgive and no baseline above zero. David's directive was
 * explicit: "time zone issues should NEVER ever EVER happen. Ever. No
 * excuses." The 2026-08-27 sweep that added this gate found and fixed every
 * live instance, so this list is expected to stay empty.
 *
 * An entry is legitimate ONLY for a query that is deliberately UTC-scoped
 * for a cross-user aggregate — never for a per-runner read, where "whose
 * timezone" always has one right answer: the runner's own. If you find
 * yourself adding an entry for a per-runner query because threading the
 * timezone through felt like more work than it was worth, that is exactly
 * the bug this gate exists to stop — fix the query instead.
 *
 * STALENESS IS CHECKED. Fix a site (or find the substring was a false
 * positive) and the gate makes you delete its entry.
 */

export interface TimezoneDateExemption {
  /** `<file>::<line>` — matches `TimezoneDateSite.id`. Re-argue on every edit
   *  to the line; a line number is not a stable anchor the way a doctrine
   *  quote is, so this registry is expected to need upkeep across refactors
   *  more often than `doctrine/registry.ts` does. */
  id: string;
  /** Why this specific site is not a per-runner-local-day read. Honest, or
   *  fix the query. */
  reason: string;
}

/**
 * Expect this to be empty. If it isn't, every entry needs to survive the
 * question: "is this comparing a UTC-stamped column against a RUNNER's local
 * calendar day?" If yes, it is the bug — thread `runnerTimezone(userId)`
 * through instead of writing an exemption.
 */
export const TIMEZONE_DATE_EXEMPTIONS: TimezoneDateExemption[] = [];
