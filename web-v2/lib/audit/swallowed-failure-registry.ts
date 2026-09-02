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
/**
 * 2026-09-01 · THE RATCHET IS NOW KEYED ON IDENTITY, NOT ON A COUNT.
 *
 * `EMPTIED_BASELINE` was a scalar, and a scalar ratchet is a BUDGET, not a
 * ratchet. It was falsified exactly as its sibling `LOAD_BEARING_KNOWN` warns:
 *
 *   A · one `.catch(() => ({ rows: [] }))` planted inside
 *       `lib/plan/generate.ts` → FAIL, "375 sites, baseline is 374". Correct.
 *   B · the SAME plant, plus one unrelated `.catch` tidied away in
 *       `lib/strava/connection-status.ts` → **PASS**,
 *       "swallowed-failure OK · empty-result baseline 374".
 *
 * So a single change could add a swallowed database read TO THE PLAN ENGINE
 * and stay green by cleaning up a peripheral one. The gate checked the count
 * and never the distribution, which is Rule 22 verbatim, in the gate CLAUDE.md
 * Rule 11 names as its own enforcement.
 *
 * `EMPTIED_KNOWN` fails in BOTH directions, the way `LOAD_BEARING_KNOWN` does:
 * an id seen more times than it is listed is a NEW violation and fails; an id
 * listed more times than it is seen is a STALE entry and fails until deleted.
 * Duplicates are significant — twelve entries for
 * `app/api/v5/today/route.ts::composeToday` means twelve separate swallowed
 * reads in that function, and fixing eleven still leaves one.
 *
 * The list is the 374 sites standing on 2026-09-01, transcribed from the
 * scanner rather than typed: it is a legacy inventory, not 374 arguments
 * anybody made, and the file header's reasoning for why that is the honest
 * instrument for a legacy is unchanged. What changed is that it can no longer
 * be traded site for site.
 *
 * TO LOWER IT: fix a read (`rowsOrNull` when the caller can tell the
 * difference, `rowsOrEmpty` — which still logs — when it genuinely cannot),
 * then delete its line here and lower `EMPTIED_BASELINE` to match. The gate
 * tells you both numbers and fails until they agree.
 */
export const EMPTIED_KNOWN: readonly string[] = [
  'app/admin/page.tsx::AdminPage',
  'app/admin/testers/page.tsx::TestersPage',
  'app/api/account/delete/route.ts::revokeStravaBestEffort',
  'app/api/account/delete/route.ts::revokeStravaBestEffort',
  'app/api/admin/backfill-workout-spec/route.ts::POST',
  'app/api/admin/backfill-workout-spec/route.ts::POST',
  'app/api/admin/backfill-workout-spec/route.ts::POST',
  'app/api/admin/reseed-maintenance/route.ts::POST',
  'app/api/admin/tester-watch/route.ts::GET',
  'app/api/admin/tester-watch/route.ts::GET',
  'app/api/auth/apple/route.ts::POST',
  'app/api/coach/proposal/[id]/accept/route.ts::POST',
  'app/api/coach/proposal/[id]/decline/route.ts::POST',
  'app/api/cron/dedupe-runs/route.ts::POST',
  'app/api/cron/max-hr-ratchet/route.ts::POST',
  'app/api/cron/notifications/route.ts::activeNiggle',
  'app/api/cron/notifications/route.ts::activeSickEpisode',
  'app/api/cron/notifications/route.ts::listActiveUsers',
  'app/api/cron/notifications/route.ts::nextARace',
  'app/api/cron/notifications/route.ts::raceOnDate',
  'app/api/cron/notifications/route.ts::weekSummary',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/plan-drift/route.ts::POST',
  'app/api/cron/promote-courses/route.ts::POST',
  'app/api/cron/readiness-snapshot/route.ts::POST',
  'app/api/cron/readiness-snapshot/route.ts::POST',
  'app/api/cron/silent-rebuild/route.ts::POST',
  'app/api/cron/silent-rebuild/route.ts::POST',
  'app/api/cron/snapshot-projections/route.ts::POST',
  'app/api/cron/snapshot-projections/route.ts::snapshotForUser',
  'app/api/cron/snapshot-projections/route.ts::snapshotForUser',
  'app/api/cross-training/route.ts::GET',
  'app/api/injuries/[id]/route.ts::GET',
  'app/api/plan/change/route.ts::resolveTargetSlug',
  'app/api/plan/restore/route.ts::deriveTPaceSec',
  'app/api/prescription/route.ts::GET',
  'app/api/prescription/route.ts::GET',
  'app/api/prescription/route.ts::GET',
  'app/api/race/[slug]/autofill/route.ts::POST',
  'app/api/race/[slug]/block-preview/route.ts::GET',
  'app/api/race/[slug]/block-preview/route.ts::GET',
  'app/api/race/[slug]/execution-plan/route.ts::GET',
  'app/api/race/[slug]/execution-plan/route.ts::GET',
  'app/api/race/[slug]/execution-plan/route.ts::GET',
  'app/api/race/[slug]/route.ts::GET',
  'app/api/race/[slug]/route.ts::GET',
  'app/api/race/[slug]/route.ts::GET',
  'app/api/race/[slug]/route.ts::PATCH',
  'app/api/race/route.ts::DELETE',
  'app/api/race/route.ts::POST',
  'app/api/readiness/subjective/route.ts::GET',
  'app/api/runs/[id]/rpe/route.ts::GET',
  'app/api/shoe/route.ts::GET',
  'app/api/strava/webhook/route.ts::processWebhookEvent',
  'app/api/strava/webhook/route.ts::upsertStravaActivity',
  'app/api/strength/route.ts::GET',
  'app/api/targets/projection/route.ts::GET',
  'app/api/targets/projection/route.ts::GET',
  'app/api/targets/projection/route.ts::GET',
  'app/api/targets/projection/route.ts::GET',
  'app/api/targets/projection/route.ts::GET',
  'app/api/today/purpose/route.ts::GET',
  'app/api/today/purpose/route.ts::loadAnchorRace',
  'app/api/today/purpose/route.ts::loadCueContext',
  'app/api/today/purpose/route.ts::loadPostRaceState',
  'app/api/v5/goal-answer/route.ts::POST',
  'app/api/v5/paces/route.ts::readPaces',
  'app/api/v5/race-authority/route.ts::activePlanId',
  'app/api/v5/race/[slug]/route.ts::GET',
  'app/api/v5/race/[slug]/route.ts::GET',
  'app/api/v5/race/[slug]/route.ts::GET',
  'app/api/v5/race/[slug]/route.ts::GET',
  'app/api/v5/race/[slug]/route.ts::GET',
  'app/api/v5/races/route.ts::detectCourseChanged',
  'app/api/v5/races/route.ts::detectCourseChanged',
  'app/api/v5/races/route.ts::detectHeat',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::composeToday',
  'app/api/v5/today/route.ts::loadShoes',
  'app/api/watch/workouts/complete/route.ts::POST',
  'app/dev/route-map-mockups/route.ts::loadRun',
  'lib/auth/session.ts::createSession',
  'lib/coach-calendar/store.ts::getCoachCalendarUrl',
  'lib/coach/acknowledge.ts::loadYesterdaySignals',
  'lib/coach/adaptation-info.ts::loadAdaptationInfoByPlanIds',
  'lib/coach/block-comparison.ts::computeBlockComparison',
  'lib/coach/block-comparison.ts::loadWindowAverages',
  'lib/coach/block-comparison.ts::loadWindowAverages',
  'lib/coach/block-comparison.ts::loadWindowAverages',
  'lib/coach/calibration.ts::completeCalibrationSession',
  'lib/coach/coach-log.ts::loadCoachLog',
  'lib/coach/coach-log.ts::updateCoachLog',
  'lib/coach/coach-log.ts::updateCoachLog',
  'lib/coach/coach-log.ts::updateCoachLog',
  'lib/coach/coach-log.ts::updateCoachLog',
  'lib/coach/coach-log.ts::updateCoachLog',
  'lib/coach/convergence-loader.ts::loadConvergenceContext',
  'lib/coach/convergence-loader.ts::loadConvergenceContext',
  'lib/coach/convergence-loader.ts::loadConvergenceContext',
  'lib/coach/cycle-performance.ts::computeCyclePerformance',
  'lib/coach/dow-patterns.ts::loadDowSeries',
  'lib/coach/easy-discipline.ts::loadEasyDiscipline',
  'lib/coach/easy-discipline.ts::loadEasyDiscipline',
  'lib/coach/easy-discipline.ts::loadEasyDiscipline',
  'lib/coach/easy-discipline.ts::loadEasyDiscipline',
  'lib/coach/episode-log.ts::<module>',
  'lib/coach/episode-log.ts::<module>',
  'lib/coach/glance-state.ts::computeTodayExecution',
  'lib/coach/glance-state.ts::computeTodayExecution',
  'lib/coach/glance-state.ts::loadGlanceState',
  'lib/coach/glance-state.ts::loadGlanceState',
  'lib/coach/glance-state.ts::loadGlanceState',
  'lib/coach/glance-state.ts::loadGlanceState',
  'lib/coach/glance-state.ts::loadGlanceState',
  'lib/coach/glance-state.ts::loadGlanceState',
  'lib/coach/glance-state.ts::loadStableBaseline',
  'lib/coach/heat-acclimatization.ts::computeHeatAcclimatization',
  'lib/coach/heat-acclimatization.ts::computeHeatAcclimatization',
  'lib/coach/heat-acclimatization.ts::measureWorkloadHrDelta',
  'lib/coach/log-state.ts::loadLogState',
  'lib/coach/log-state.ts::loadLogState',
  'lib/coach/memory.ts::loadActiveMemory',
  'lib/coach/memory.ts::readRecord',
  'lib/coach/morning-brief.ts::loadMorningBrief',
  'lib/coach/pacing-discipline.ts::computePacingDiscipline',
  'lib/coach/profile-state.ts::loadProfileState',
  'lib/coach/profile-state.ts::loadProfileState',
  'lib/coach/profile-state.ts::loadProfileState',
  'lib/coach/projection-levers.ts::findTuneUpCandidates',
  'lib/coach/proposals-state.ts::loadPendingProposals',
  'lib/coach/quality-predictors.ts::computeQualityPredictors',
  'lib/coach/race-lookup.ts::loadNextARace',
  'lib/coach/race-lookup.ts::loadNextARace',
  'lib/coach/races-state.ts::loadRacesState',
  'lib/coach/readiness-brief.ts::computeYesterdayPillars',
  'lib/coach/readiness-brief.ts::computeYesterdayPillars',
  'lib/coach/readiness-brief.ts::computeYesterdayPillars',
  'lib/coach/readiness-brief.ts::computeYesterdayPillars',
  'lib/coach/readiness-brief.ts::computeYesterdayPillars',
  'lib/coach/readiness-brief.ts::detectRecentHardSession',
  'lib/coach/readiness-brief.ts::loadActivePlanAdaptation',
  'lib/coach/readiness-brief.ts::loadActivePlanAdaptation',
  'lib/coach/readiness-brief.ts::loadReadinessBrief',
  'lib/coach/readiness-brief.ts::loadScoreTrend',
  'lib/coach/readiness-brief.ts::loadSubjectiveCheckin',
  'lib/coach/readiness-history.ts::loadReadinessHistory',
  'lib/coach/readiness-history.ts::loadReadinessHistory',
  'lib/coach/readiness-history.ts::loadReadinessHistory',
  'lib/coach/readiness-history.ts::loadReadinessHistory',
  'lib/coach/readiness-history.ts::loadReadinessHistory',
  'lib/coach/recovery-brief.ts::loadTodayRunTiming',
  'lib/coach/recovery-phase.ts::computeRecoveryPhase',
  'lib/coach/recovery-phase.ts::computeRecoveryPhase',
  'lib/coach/recovery-phase.ts::loadMuscleSignals',
  'lib/coach/recovery-phase.ts::loadMuscleSignals',
  'lib/coach/run-state.ts::computeHrOnPaceDelta',
  'lib/coach/run-state.ts::computeHrOnPaceDelta',
  'lib/coach/run-state.ts::computeWorkAverages',
  'lib/coach/run-state.ts::loadFormMetrics',
  'lib/coach/run-state.ts::loadPhaseBreakdown',
  'lib/coach/run-state.ts::loadRunDetail',
  'lib/coach/run-state.ts::loadRunDetail',
  'lib/coach/run-state.ts::loadRunDetail',
  'lib/coach/run-state.ts::loadRunDetail',
  'lib/coach/run-state.ts::loadRunDetail',
  'lib/coach/runner-calibration.ts::loadRunnerCalibration',
  'lib/coach/runner-calibration.ts::refreshRunnerCalibration',
  'lib/coach/sleep-coaching.ts::computeSleepCoaching',
  'lib/coach/sleep-coaching.ts::computeSleepCoaching',
  'lib/coach/sleep-coaching.ts::computeSleepCoaching',
  'lib/coach/standing-recommendation.ts::checkAcceptedProposal',
  'lib/coach/state-loader.ts::loadCoachState',
  'lib/coach/state-loader.ts::loadCoachState',
  'lib/coach/state-loader.ts::loadCoachState',
  'lib/coach/state-loader.ts::loadCoachState',
  'lib/coach/state-loader.ts::loadStableBaseline',
  'lib/coach/strength-load.ts::strengthMinutesByDay',
  'lib/coach/strength-recommender.ts::emitStrengthResumeIntent',
  'lib/coach/strength-recommender.ts::loadHabit',
  'lib/coach/strength-recommender.ts::loadLoggedStrengthDates',
  'lib/coach/strength-recommender.ts::loadPhaseContext',
  'lib/coach/strength-recommender.ts::loadPreferences',
  'lib/coach/strength-recommender.ts::loadRaceContext',
  'lib/coach/strength-recommender.ts::loadWeekWorkouts',
  'lib/coach/strength-status.ts::loadStrengthWeekStatus',
  'lib/coach/strength-status.ts::loadStrengthWeekStatus',
  'lib/coach/training-form.ts::computeTrainingForm',
  'lib/coach/training-form.ts::computeTrainingForm',
  'lib/coach/training-state.ts::loadTrainingState',
  'lib/coach/voice-band.ts::computeVoiceBand',
  'lib/coach/voice-band.ts::computeVoiceBand',
  'lib/coach/voice-band.ts::goalOffProjectedForWindow',
  'lib/coach/voice-band.ts::loadVoiceBandLite',
  'lib/coach/voice-band.ts::loadVoiceBandLite',
  'lib/faff/race-week-course.ts::loadRaceWeekCourse',
  'lib/faff/race-week-course.ts::loadRaceWeekCourse',
  'lib/faff/race-week-course.ts::loadRaceWeekCourse',
  'lib/notifications/dispatch.ts::activeDeviceTokens',
  'lib/onboarding/initial-name.ts::resolveInitialName',
  'lib/plan/adapt.ts::actionsForTrigger',
  'lib/plan/adapt.ts::actionsForTrigger',
  'lib/plan/adapt.ts::actionsForTrigger',
  'lib/plan/adapt.ts::actionsForTrigger',
  'lib/plan/adapt.ts::actionsForTrigger',
  'lib/plan/adapt.ts::applyAdaptations',
  'lib/plan/adapt.ts::deriveTPaceSecForRebuild',
  'lib/plan/adapt.ts::detectFitnessRegression',
  'lib/plan/adapt.ts::detectFitnessRegression',
  'lib/plan/adapt.ts::detectFitnessRegression',
  'lib/plan/adapt.ts::detectGoalChanged',
  'lib/plan/adapt.ts::detectInjuryActive',
  'lib/plan/adapt.ts::detectNiggleReported',
  'lib/plan/adapt.ts::detectPrBank',
  'lib/plan/adapt.ts::detectPrBank',
  'lib/plan/adapt.ts::detectSickEpisodeActive',
  'lib/plan/adapt.ts::detectTrainingGap',
  'lib/plan/adapt.ts::detectVolumeOvershoot',
  'lib/plan/adapt.ts::detectVolumeOvershoot',
  'lib/plan/adapt.ts::detectVolumeOvershoot',
  'lib/plan/adapt.ts::hasRecentGapIntent',
  'lib/plan/adaptive-ramp.ts::detectGreenRampOpportunity',
  'lib/plan/adaptive-ramp.ts::planUpgrade',
  'lib/plan/adaptive-ramp.ts::planUpgrade',
  'lib/plan/auto-rebuild.ts::fireAutoRebuild',
  'lib/plan/auto-rebuild.ts::fireAutoRebuild',
  'lib/plan/auto-rebuild.ts::rebuildActivePlanForPrefs',
  'lib/plan/auto-rebuild.ts::rebuildActivePlanForPrefs',
  'lib/plan/auto-rebuild.ts::resolveGoalTarget',
  'lib/plan/auto-rebuild.ts::resolveGoalTarget',
  'lib/plan/drift-monitor.ts::inferPlanAnchorVdot',
  'lib/plan/drift-monitor.ts::loadActivePlan',
  'lib/plan/generate.ts::composeForUserInternal',
  'lib/plan/generate.ts::loadGeneratorInputs',
  'lib/plan/generate.ts::loadGeneratorInputs',
  'lib/plan/generate.ts::loadGeneratorInputs',
  'lib/plan/generate.ts::loadGeneratorInputs',
  'lib/plan/generate.ts::loadGeneratorInputs',
  'lib/plan/generate.ts::loadGeneratorInputs',
  'lib/plan/generate.ts::loadGeneratorInputs',
  'lib/plan/generate.ts::loadGeneratorInputs',
  'lib/plan/generate.ts::loadLastRaceFinished',
  'lib/plan/goal-gap.ts::computeGoalGap',
  'lib/plan/goal-gap.ts::computeGoalGap',
  'lib/plan/goal-gap.ts::computeGoalGap',
  'lib/plan/goal-gap.ts::loadGoalAssessment',
  'lib/plan/goal-outlook.ts::writeGoalOutlookNote',
  'lib/plan/goal-outlook.ts::writeGoalOutlookNote',
  'lib/plan/goal-outlook.ts::writeGoalOutlookNote',
  'lib/plan/injury-builder.ts::buildInjuryPlan',
  'lib/plan/injury-builder.ts::buildInjuryPlan',
  'lib/plan/injury-builder.ts::buildInjuryPlan',
  'lib/plan/mutate.ts::loadMutationContext',
  'lib/plan/mutate.ts::loadMutationContext',
  'lib/plan/mutate.ts::mutatePlan',
  'lib/plan/open-block.ts::recordOpenBlock',
  'lib/plan/pace-drop-event.ts::loadPaceZoneEvent',
  'lib/plan/progression-pass.ts::applyProgressionReshape',
  'lib/plan/progression-pass.ts::diagnoseProgressionWeek',
  'lib/plan/progression-pass.ts::diagnoseProgressionWeek',
  'lib/plan/progression-pass.ts::diagnoseProgressionWeek',
  'lib/plan/progression-pass.ts::diagnoseProgressionWeek',
  'lib/plan/proposals-state.ts::loadAllPlanProposals',
  'lib/plan/proposals-state.ts::loadPlanProposals',
  'lib/plan/return-checkin-store.ts::loadReturnCheckins',
  'lib/plan/seed-from-onboarding.ts::deriveRunHistory',
  'lib/plan/simulator.ts::simulateActivePlan',
  'lib/plan/simulator.ts::simulateActivePlan',
  'lib/plan/simulator.ts::simulateActivePlan',
  'lib/plan/workout-proposals.ts::acceptProposal',
  'lib/plan/workout-proposals.ts::dismissProposal',
  'lib/plan/workout-proposals.ts::loadPendingProposals',
  'lib/plan/workout-proposals.ts::writeWorkoutProposals',
  'lib/race/auto-result.ts::detectAndLogProvisionalResults',
  'lib/race/auto-result.ts::detectAndLogProvisionalResults',
  'lib/race/personal-records.ts::loadPersonalRecords',
  'lib/race/personal-records.ts::loadPersonalRecords',
  'lib/race/representativeness-inputs.ts::assessRaceRepresentativeness',
  'lib/race/representativeness-inputs.ts::assessRaceRepresentativeness',
  'lib/race/representativeness-inputs.ts::assessRaceRepresentativeness',
  'lib/race/representativeness-inputs.ts::assessRaceRepresentativeness',
  'lib/race/representativeness-inputs.ts::assessRaceRepresentativeness',
  'lib/race/representativeness-inputs.ts::assessRaceRepresentativeness',
  'lib/race/result-chain.ts::runPostResultChain',
  'lib/race/result-chain.ts::runPostResultChain',
  'lib/race/result-chain.ts::runPostResultChain',
  'lib/race/retrospective.ts::buildRaceRetro',
  'lib/race/retrospective.ts::buildRaceRetro',
  'lib/race/retrospective.ts::loadMatchedRunSplits',
  'lib/runs/canonical.ts::enhanceCanonicalFromAbsorbed',
  'lib/runs/energy.ts::loadWeightKg',
  'lib/runs/flag-census.ts::computeFlagCensus',
  'lib/runs/volume.ts::firstRunISO',
  'lib/runtime/runner-tz.ts::captureTimezoneFromDevice',
  'lib/runtime/runner-tz.ts::storedRunnerTimezone',
  'lib/shoe/auto-assign.ts::loadGarage',
  'lib/shoe/auto-assign.ts::pickFromDayActions',
  'lib/shoe/auto-assign.ts::resolvePlannedType',
  'lib/shoe/mileage.ts::computeShoeMileageBreakdown',
  'lib/strava/auth.ts::getStravaToken',
  'lib/strava/auth.ts::getStravaToken',
  'lib/strava/auth.ts::hasStravaConnection',
  'lib/strava/auth.ts::hasStravaConnection',
  'lib/strava/connection-status.ts::loadReauthFailedRunIds',
  'lib/strava/connection-status.ts::loadStravaConnectionStatus',
  'lib/strava/connection-status.ts::loadStravaConnectionStatus',
  'lib/strava/connection-status.ts::loadStravaConnectionStatus',
  'lib/strava/connection-status.ts::loadStravaConnectionStatus',
  'lib/strava/pullSync.ts::pullSyncOneUser',
  'lib/strava/webhook.ts::userIdForAthlete',
  'lib/strava/webhook.ts::userIdForAthlete',
  'lib/training/decoupling-trend.ts::computeDecouplingTrend',
  'lib/training/goal-projection.ts::computeOverPerformanceBonus',
  'lib/training/goal-projection.ts::computeOverPerformanceBonus',
  'lib/training/goal-projection.ts::detectMissedKeyWorkoutDrift',
  'lib/training/goal-projection.ts::detectRecentRaceDrift',
  'lib/training/goal-projection.ts::detectTempoPaceDrift',
  'lib/training/goal-projection.ts::detectVdotTrendDrift',
  'lib/training/goal-projection.ts::loadExecutionAbsence',
  'lib/training/goal-projection.ts::loadExecutionAbsence',
  'lib/training/goal-projection.ts::loadNextTestPoints',
  'lib/training/goal-projection.ts::loadNextTestPoints',
  'lib/training/goal-projection.ts::loadRecentTestPoints',
  'lib/training/goal-ready.ts::loadGoalReadyProjection',
  'lib/training/goal-ready.ts::loadGoalReadyProjection',
  'lib/training/lthr-reanchor-store.ts::reanchorLthr',
  'lib/training/lthr.ts::resolveThresholdHr',
  'lib/training/plan-target.ts::loadMarathonSpecificTraining',
  'lib/training/plan-target.ts::loadPlannedTargetVdot',
  'lib/training/projection-snapshots.ts::loadLatestVdotForUser',
  'lib/training/projection-snapshots.ts::loadLatestVdotWithAnchor',
  'lib/training/projection-snapshots.ts::loadNearestSnapshot',
  'lib/training/projection-snapshots.ts::loadProjectionSeries',
  'lib/training/projection-snapshots.ts::loadProjectionSnapshot',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::buildWatchToday',
  'lib/watch/build-workout.ts::loadCompletedRun',
  'lib/watch/build-workout.ts::loadCompletedRun',
  'lib/watch/build-workout.ts::loadNoSessionReason',
  'lib/watch/build-workout.ts::loadNoSessionReason',
  'lib/watch/build-workout.ts::loadNoSessionReason',
  'lib/weather/lookup.ts::baselineTempF',
  'lib/weather/lookup.ts::lookupTempF',
  'lib/weather/openmeteo.ts::resolveHomeLatLng',
] as const;

/**
 * The same number, as a plain integer `scripts/check-swallowed-failure.sh` can
 * read with sed on a cold container that has no TypeScript toolchain — the
 * format contract this file's header states. It is CROSS-CHECKED against
 * `EMPTIED_KNOWN.length` by `_swallow_scan.test.ts`, so the shell-readable
 * figure cannot drift away from the list it summarises.
 */
// 2026-09-01 · P0 race-pace brain · 374 → 372: goal-gap's own race-performance
// read is gone (the limiter reads the canonical durability curve) and the
// projection-snapshot read in effective-race-target.ts is gone (it is an
// adapter over the race outlook now). Neither site was fixed in place; both
// were deleted with the second truth they served.
// 2026-09-01 · -3 (372 → 369), F-6. `lib/coach/fitness-evidence.ts`,
// `lib/coach/race-replacement.ts` and `lib/coach/threshold-pattern.ts` each
// carried a byte-identical `currentVdot` reader wrapped in
// `.catch(() => ({ rows: [] }))`. A failed read became "no VDOT", which became
// `establishedPaceFor → null`, which SUPPRESSED the finding entirely — a guard
// that silently switched itself off when its own input failed, which is Rule
// 11's defining shape. All three now call
// `projection-snapshots.ts#resolveCurrentVdotSnapshot`, whose refusal branch
// carries no `vdot` field at all and distinguishes NO_SNAPSHOT from
// READ_FAILED from STALE. `lib/adaptation/load.ts`'s copy (the one that did
// NOT swallow) is the fourth caller and routes there too.
export const EMPTIED_BASELINE = 369;

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
