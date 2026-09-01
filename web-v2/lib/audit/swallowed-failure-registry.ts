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
    // 2026-08-30 · the function did not change; its file did. It moved to
    // goal-outlook.ts when goal-renegotiation.ts was retired.
    id: 'lib/plan/goal-outlook.ts::expireStalePendingProposals',
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
/**
 * 2026-08-25 · 388 → 380. The ratchet tightens, which is the only direction it
 * moves.
 *
 * Eight sites closed in the automatic-mutation audit that followed the drift
 * cron replacing the owner's training block overnight. Seven were guards
 * standing in front of an action — four dedupe reads and three that authorise
 * pushing a runner's long run up — plus `hasPendingProposal`, the one guard
 * between the nightly cron and re-authoring a block.
 *
 * That last one is worth recording here rather than only in its own file,
 * because it is a gap in THIS scanner's reach, not just a missed site. It
 * caught `.catch(() => ({ rows: [] }))` and was classified EMPTIED — a harmless
 * empty container, held under this ratchet rather than argued as an exemption.
 * Two lines below the catch, `return r != null` turned that empty into `false`,
 * and `false` to its only two callers meant "nothing standing, go ahead". So an
 * EMPTIED fallback was laundered into a MINTED decision just outside the
 * scanner's window, and the 2026-08-24 sweep fixed the four sibling guards in
 * the plan-drift route while walking past this one.
 *
 * If you are extending the scanner: the shape to look for is an EMPTIED
 * fallback whose enclosing function returns a boolean or a count.
 */
/**
 * 380 → 379 (2026-08-25, TRAINING-LEAD-1). Re-tightened, not slackened: the
 * upward training-evidence detector added two reads and both went through
 * `rowsOrNull`, and fixing the shape it was copied FROM took the count below
 * where it started.
 *
 * The one that mattered was `detectFitnessRegression`'s race-week suppression
 * query. It swallowed a failure into an empty result, which reads as "no race
 * is coming" — so a database blip during race week would let a downward
 * re-anchor through in the one window doctrine reserves for the race
 * machinery. A suppression filter that cannot read its own input has to
 * suppress. The new detector's copy fails closed; the original is still open
 * and is named in the hand-off.
 */
// 2026-08-27 · +2 from the timezone-safety sweep (15 files gained a
// `runnerTimezone(userId).catch(() => 'UTC')` resolution — the same
// already-tolerated shape used dozens of times elsewhere in this codebase
// for exactly this fallback, not a new class of swallowed database read).
// 2026-08-28 · -1 from retiring the workout_library DB table: the reader
// (lib/plan/workout-library.ts, catch → cached-or-empty) is deleted; the
// catalog is static code now (lib/plan/workout-library-static.ts) with no
// failure to swallow.
// 2026-08-30 · -2 from ANCHOR-STALE-1: `deriveHrZones` and
// `deriveHrZonesFromSamples` in lib/coach/run-state.ts each carried their own
// `SELECT lthr FROM profile … .catch(() => ({ rows: [] }))`, and a swallowed
// read there returned NO ZONE BAR while the zone RANGES panel beside it — fed
// by `resolveThresholdHr` — still drew its bands. Both helpers are deleted:
// the caller resolves the anchor once and passes the table in, so there is one
// read to fail instead of three, and it fails for the whole panel at once.
// 2026-08-30 · -1 from the adaptive ramp's quality gate. It ran its own
// `SELECT … FROM runs … .catch(() => [])`, and the empty array it minted on a
// failure was indistinguishable from the empty array the query returned on
// EVERY call — the predicate asked for `data->>'type' IN ('threshold',
// 'intervals','tempo')`, a value that field has never held. The gate now calls
// `loadKeySessionExecutions` under `attempt`, so a failed read is its own state
// and closes the gate, and `_guard_fail_closed.test.ts` holds it there.
// 2026-09-01 · -1 from `lib/race/coach-goal-load.ts::loadCoachGoalForRace`.
// Its personal-exponent block used to be
// `try { const { raceCandidates } = await loadVdotInputs(...); ... }
// catch { exponentFit = null; }` — a DB-backed read (loadVdotInputs queries
// `races`) whose failure and whose "no qualifying races" outcome were
// indistinguishable, both landing as `exponentFit = null`. The block is gone
// — replaced by `resolveRaceExponent(userId).catch(() => null)`, which calls
// `durability-anchor.ts`'s canonical resolver instead of coach-goal.ts's own
// race-loading query, per docs/reports/race-prediction-consolidation-
// 2026-09-01.md. One fewer DB-backed swallow site in this tree.
// 2026-09-01 · P0 race-pace brain · 374 → 373: the race HR-evidence read in
// lib/race/race-outlook.ts no longer swallows a failed query into `rows: []`.
export const EMPTIED_BASELINE = 373;

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
