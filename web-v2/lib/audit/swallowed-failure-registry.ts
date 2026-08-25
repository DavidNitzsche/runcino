/**
 * lib/audit/swallowed-failure-registry.ts · the sites where a database failure
 * is allowed to become a value, and the argument for each.
 *
 * Read `lib/audit/swallow-scan.ts` first — it defines what a violation is and
 * why. This file is the exemption list, and it is deliberately hostile to
 * being added to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO TIERS, BECAUSE THEY ARE NOT THE SAME CRIME
 *
 *   MINTED  · the fallback FABRICATES a value the app then reasons with —
 *             `{ rows: [{ n: '0' }] }`, `0`, `false`, `{ rowCount: 0 }`. Every
 *             one of these needs an entry below with an argued reason. There
 *             is no baseline and no grace: an unlisted minted site fails the
 *             build. This is the tier the incident lived in — `data_quality`
 *             sat at `cold-start` for every runner because a `'0'` that was
 *             an error got counted by a `>= 3` gate.
 *
 *   EMPTIED · the fallback is an empty container — `[]`, `{ rows: [] }`,
 *             `null`. Still indistinguishable from an honest nothing, but it
 *             does not invent an observation. Held to a RATCHET: `EMPTIED_BASELINE`
 *             may never be exceeded, and any drop below it must be written
 *             down, which permanently lowers the line.
 *
 * WHY A RATCHET AND NOT 389 ENTRIES. Because 389 individually-argued
 * exemptions written in one sitting would be 389 sentences nobody meant, and a
 * registry of unmeant sentences is worse than no registry — it launders the
 * problem into the appearance of having thought about it. The ratchet is the
 * honest instrument for a legacy: it cannot grow, and every fix tightens it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ADDING AN ENTRY
 *
 * Only for a MINTED site, and only when you can finish this sentence honestly:
 * "absent and failed lead to the same outcome for every consumer of this value,
 * because ___". If you cannot, the answer is not an entry. It is one of:
 *
 *   · return null / a distinguishable failure and let the caller decide;
 *   · fail CLOSED — for a guard, assume the thing it guards against happened;
 *   · `outage()` — for a route, say you could not read rather than answering.
 *
 * STALENESS IS CHECKED. Fix a site and the gate makes you delete its entry.
 * That is the point: the list can only shrink.
 *
 * FORMAT CONTRACT. One single-line quoted `id:` and one `reason:` per entry, so
 * `scripts/check-swallowed-failure.sh` can verify the shape with sed and grep
 * on a cold container with no TypeScript toolchain — same posture as
 * `check-doctrine.sh` and `check-generated-content.sh`.
 */

export interface SwallowExemption {
  /** `<file>::<enclosingSymbol>` — matches `SwallowSite.id`. Never a line number. */
  id: string;
  /** Why absent and failed are the same to every consumer. Honest, or fix it. */
  reason: string;
}

/**
 * The MINTED sites that survive the 2026-08-24 sweep, each with the argument
 * that kept it. Eighteen, down from thirty-eight.
 *
 * Every entry here was read at its call site and traced to its consumer. Where
 * that trace showed the value could change what the runner sees or what the
 * engine does, the site was FIXED and does not appear below — the password
 * revocation, the plan's mid-block detector, the streak pill, the injury
 * check, the two plan-validation gates, the four de-dupe guards, and the rest.
 */
export const SWALLOW_EXEMPTIONS: readonly SwallowExemption[] = [
  {
    id: 'app/api/cron/silent-rebuild/route.ts::POST',
    reason: 'rowCount feeds `acked_intents` in a cron JSON response read by operators, not runners; the banners it stamps re-stamp on the next rebuild, so an uncounted ack costs one cycle of a banner staying visible and nothing else.',
  },
  {
    id: 'app/api/strength/route.ts::DELETE',
    reason: 'rowCount only decides whether to bust the briefing cache after a DELETE; a missed bust self-heals at the cache TTL, and the DELETE itself has already either happened or thrown to the caller.',
  },
  {
    id: 'lib/coach/profile-state.ts::loadProfileState',
    reason: 'three MAX(timestamp) last-sync reads whose only consumer renders a date beside a connection name; null renders no date, which is exactly what an unsynced account renders, so absent and failed reach the same pixels.',
  },
  {
    id: 'lib/coach/runner-calibration.ts::medianDailyMi',
    reason: 'writes `easy/long/quality_tolerance_mi`, all nullable columns whose null already means "not yet learned"; every consumer falls back to the experience-level default on null, and does so identically for a missing median and a failed one.',
  },
  {
    id: 'lib/coach/state-loader.ts::loadCoachState',
    reason: 'covers both the todayRunDone and todayRunLong reads; false is also the pre-run state, so a failed read renders the same Today the runner saw an hour earlier and self-corrects on the next load, and refusing to build CoachState at all would blank every surface that depends on it — a worse answer to a transient blip.',
  },
  {
    id: 'lib/coach/strength-recommender.ts::loadHabit',
    reason: 'the count separates a new runner from a lapsed one, and zero yields "unknown" rather than "dormant" — the humble branch, which is the correct one to land on when the read failed.',
  },
  {
    id: 'lib/coach/voice-band.ts::goalOffProjectedForWindow',
    reason: 'total_count 0 fails the `total >= 7` floor, so the fabricated pair can only ever withhold the soft-cap, never apply one; a band that does not soften on evidence it never gathered is the intended direction.',
  },
  {
    id: 'lib/plan/coached-gate.ts::isCoachedExternally',
    reason: 'argued in the function\'s own doc comment and still right: false means "author the plan", and silently withholding coaching from someone who asked for it is both worse and far harder to notice than an extra plan a coached runner can ignore.',
  },
  {
    id: 'lib/plan/drift-monitor.ts::loadEasyDayMedian',
    reason: 'declared `Promise<number | null>` and every caller already treats null as "no median available"; the fabricated `{ med: null }` collapses into that same null, so the failure cannot be mistaken for a measured number.',
  },
  {
    id: 'lib/plan/drift-monitor.ts::loadRecentLongRunMedian',
    reason: 'same shape and same contract as loadEasyDayMedian — nullable return, null means absent, and a drift finding needs both medians present before it fires.',
  },
  {
    id: 'lib/plan/generate.ts::easyDayMedianMi',
    reason: 'the Rule 2 easy-day floor; null disables the floor rather than lowering it, so a failed read cannot make the generator prescribe a shorter easy day than doctrine allows.',
  },
  {
    id: 'lib/plan/goal-renegotiation.ts::expireStalePendingProposals',
    reason: 'covers both rowCount tallies in this function; expiry and the mislabel cleanup are idempotent and ride a daily cron, so an uncounted pass expires the same rows tomorrow and reports zero for what THIS run achieved, which is true.',
  },
  {
    id: 'lib/race/auto-result.ts::detectAndLogProvisionalResults',
    reason: 'rowCount 0 makes the loop `continue`, skipping the post-result chain for that race — the safe direction, because the chain must only run for a result this pass actually wrote.',
  },
  {
    id: 'lib/watch/build-workout.ts::loadNoSessionReason',
    reason: 'zero means "not an AWAY week", so the watch builds the ordinary prescribed workout instead of the week-off card; this endpoint is on the wrist\'s critical path and a Postgres blip must not cost the runner their workout.',
  },
] as const;

/**
 * How many EMPTIED sites the tree is allowed to carry.
 *
 * 2026-08-24 · 389, measured after the sweep. Lowered to 388 the same day:
 * the week seed's private body-mass query and its private calorie estimator
 * both went away when the calorie column was migrated to the shared
 * active-energy ladder in `lib/runs/energy.ts`. One fewer place a DB failure
 * could quietly become a number.
 *
 * This number may never rise. When
 * you fix one, lower it — the gate tells you the new figure and fails until you
 * write it down, which is what stops the line drifting back up.
 *
 * It is NOT a target to reach zero in one pass. It is a line that only moves
 * one way.
 */
export const EMPTIED_BASELINE = 388;

/**
 * Floors, so a scanner that opens nothing cannot report clean.
 *
 * A gate whose parser silently stops matching is indistinguishable from a
 * codebase that got better, which is the same bug this whole file is about —
 * one level up. These are the numbers observed on 2026-08-24, held well below
 * actual so ordinary deletion does not trip them.
 */
export const SCAN_FLOORS = {
  /** 494 .ts/.tsx files under lib/ + app/ on 2026-08-24. */
  files: 400,
  /** 1056 `pool.query(` / `client.query(` call sites on 2026-08-24. */
  dbCalls: 800,
} as const;
