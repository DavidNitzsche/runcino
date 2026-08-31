/**
 * lib/audit/normal-window-registry.ts · the argued exceptions to RULE 8.
 *
 * THE RULE (CLAUDE.md, locked 2026-08-30): any reader that answers "what does
 * this runner NORMALLY do" MUST exclude days the engine itself prescribed as
 * taper, race week, or post-race recovery. The shared filter is
 * `lib/training/normal-window.ts`; this file is the list of readers that trip
 * the scanner and are nonetheless right as they stand.
 *
 * THE BUG CLASS. Six distinct defects in one engine, every one found by the
 * runner and none by any gate, because every output was well-formed and only
 * the WINDOW was wrong: a marathon block opened at 31 mi/wk against a sustained
 * 43.5; four-mile easy days for a runner whose easy days are 3-7.8; one quality
 * session in week 1 for a runner whose habit is two; a long-run ramp anchored
 * to a 13.5 mi taper long instead of the 18.0 he ran on 2026-07-25. The engine
 * measures the runner during a period IT told him to go easy and reports the
 * result as his training identity.
 *
 * WHAT COUNTS AS GUARDED. A file whose SQL aggregates the runner's own `runs`
 * over a rolling recent window must import `@/lib/training/normal-window`.
 * Anything else lands here with a reason, or fails.
 *
 * WHAT IS LEGITIMATELY EXEMPT, and the three shapes it comes in — because an
 * over-applied filter is its own defect:
 *
 *   · EXECUTION, not habit. "How much did he actually run" must keep every
 *     taper day; hiding one would understate his own history to him.
 *   · A MODEL THAT IS SUPPOSED TO MOVE. Acute load, ACWR, CTL/ATL/TSB and
 *     readiness baselines exist to track recent load. Filtering the taper out
 *     of a freshness model deletes the thing the model is for.
 *   · A RACE DETECTOR. Race-recency, taper and recovery-phase detectors exist
 *     to look at race weeks.
 *
 * The allowlist is a RATCHET: it may shrink, never grow, in the same posture as
 * `active-plan-exemptions.ts` and `swallowed-failure-registry.ts`'s
 * `EMPTIED_BASELINE`. An entry whose file no longer trips the scanner is itself
 * a failure, so a fix forces its deletion.
 */

export interface NormalWindowExemption {
  /** Repo-relative path, as the scanner reports it. */
  file: string;
  /**
   * Optional · excuse ONE statement rather than the whole file.
   *
   * A distinctive substring of the normalised SQL. Present when a file holds
   * both habit readers and corollary readers and must not be excused wholesale
   * — `lib/plan/generate.ts` is the case that forced this: its habit readers
   * are filtered and its two injury guards are not, and a file-level exemption
   * there would blind the scanner to the next defect in a file that has already
   * produced four.
   *
   * Key it on the PROJECTION ALIAS (`::text AS avg_weekly`), never on the raw
   * jsonb access the statement happens to use. Two reasons, and both bit: a
   * fingerprint spelling `data->>'…'` trips RUN-SHAPE LINT in this very file,
   * and an alias is the half of a statement that survives the accessor
   * refactors `run-shape.ts` exists to make. The gate asserts each fingerprint
   * matches EXACTLY ONE statement, so a lazy one fails rather than quietly
   * widening.
   */
  statement?: string;
  /** Why reading across prescribed taper / recovery days is correct HERE. */
  reason: string;
}

/**
 * RULE 8'S COROLLARY, stated once and cited by every reader it excuses.
 *
 * **Filter a reader that asks what the runner CAN DO. Do not filter one that
 * asks what the runner HAS RECENTLY ABSORBED.**
 *
 * Rule 8 says a taper is never his NORMAL. It does not say the taper did not
 * happen. If he genuinely spent four weeks at reduced volume, then ramping from
 * THAT volume is what his connective tissue will actually experience next week,
 * and a guard measured against his pre-taper self would wave through a jump his
 * legs have not been prepared for. Over-applying Rule 8 makes a safety guard
 * MORE PERMISSIVE in exactly the situation it exists for.
 *
 * Habit and capability are Rule 8 questions. Tissue load and injury exposure
 * are not.
 *
 * The consistency is the argument. Two readers hit this fork independently on
 * the night the rule was written and both split the same way — and where a
 * reader turns out to be answering both questions, the answer is to SPLIT it,
 * not to pick one. `recentPeakLongMi` is the worked example: one name over two
 * quantities (a Rule 16 violation as well), now two, with the habit half
 * filtered to his real 18.0 mi longest and the spike anchor left literal at the
 * taper's 13.5 because `Research/00a` writes its own window into the citation —
 * ">110% of longest run in the PRIOR 30 D raises overuse injury risk by ~64%".
 */
const ABSORBED_LOAD_NOT_CAPABILITY =
  'RULE 8 COROLLARY · filter a reader that asks what the runner CAN DO; do not filter one ' +
  'that asks what he HAS RECENTLY ABSORBED. This is an INJURY GUARD, and injury risk is a ' +
  'property of what the tissue actually did, not of what the runner normally does. Rule 8 ' +
  'says a taper is never his normal; it does not say the taper did not happen. If he really ' +
  'spent four weeks at reduced volume, ramping FROM that volume is what his connective ' +
  'tissue will experience next week, and a guard measured against his pre-taper self would ' +
  'wave through a jump his legs have not been prepared for. Filtering here would make the ' +
  'guard more permissive in exactly the situation it exists for. ';

/**
 * Seeded 2026-08-30 from the sixteen files standing after the habit readers
 * this round repaired. Every reason below was checked against the reader's own
 * direction of error, not assumed.
 */
export const NORMAL_WINDOW_EXEMPTIONS: readonly NormalWindowExemption[] = [
  // ── the corollary · two injury guards in a file whose habit readers ARE
  //    filtered, so they are excused per STATEMENT and the file stays scanned.
  {
    file: 'lib/plan/generate.ts',
    statement: '::text AS mi FROM runs',
    reason:
      ABSORBED_LOAD_NOT_CAPABILITY +
      'THIS STATEMENT is `recentPeakLongMi`\'s LITERAL 28-day max — the spike-guard anchor, ' +
      'and half of a function that was one name over two quantities until it was split. ' +
      '`Research/00a` §"Volume progression rules" writes the window into the citation: ' +
      '">110% of longest run in the PRIOR 30 D raises overuse injury risk by ~64%". A runner ' +
      'whose longest run in the last thirty days really is 13.5 is at spike risk on an ' +
      '18-miler however fit he was in July; filtering this would let the engine author 148% ' +
      'of his actual recent longest and call it doctrine. The HABIT half of the same ' +
      'function (`representativeMi`) IS filtered, to his real 18.0.',
  },
  {
    file: 'lib/plan/generate.ts',
    statement: '/ 4.0)::text AS avg_weekly',
    reason:
      ABSORBED_LOAD_NOT_CAPABILITY +
      'THIS STATEMENT is `trailingAvgWeeklyMi`, feeding the validator\'s peak-vs-trailing ' +
      'RAMP check. Same side of the fork as the spike anchor above and exempt for the same ' +
      'stated reason rather than an ad-hoc one: it asks what the runner has recently ' +
      'absorbed, so that the plan\'s peak can be judged against the volume his legs actually ' +
      'carried. A filtered version would compare the peak against a pre-taper self and pass ' +
      'a ramp the tissue has not been prepared for — the failure this check exists to catch.',
  },

  {
    file: 'lib/plan/drift-monitor.ts',
    reason:
      'Adherence, not habit — and self-cancelling. Every axis compares the runner ' +
      'against the PLAN over the same window (loadEasyDayMedian vs loadPlanEasyDayMedian, ' +
      'loadRecentLongRunMedian vs loadPlanLongRunMedian, volume vs authored weeklyAvg4w), ' +
      'and the plan side of each pair reads plan_workouts over that identical window. In a ' +
      'taper BOTH sides fall together, so the ratio the detector actually spends is ' +
      'unchanged; filtering only the runner side would invent a drift that is not there.',
  },
  {
    file: 'lib/coach/training-form.ts',
    reason:
      'CTL/ATL/TSB is a fitness-and-fatigue MODEL, not a habit claim. Its 42-day and ' +
      '7-day EWMAs must see every day of load, taper days most of all: the whole point ' +
      'of TSB is that a taper lifts freshness, and the tsb_race_ready card exists to say ' +
      'so. Excluding the taper would delete the signal rather than clean it.',
  },
  {
    file: 'lib/race/representativeness-inputs.ts',
    reason:
      'A race detector, and the one this rule would break most directly. It measures the ' +
      'race week\'s own volume against the peak week that preceded it to judge whether a ' +
      'result is representative — the taper IS its subject. Filtering it would leave the ' +
      'function reading nothing at all.',
  },
  {
    file: 'lib/coach/recovery-phase.ts',
    reason:
      'The post-race detector itself. computeRecoveryPhase resolves which recovery block ' +
      'the runner is in, and the muscle-signal read is scoped to exactly the days after a ' +
      'hard effort. Excluding post-race recovery from the module whose job is post-race ' +
      'recovery is circular.',
  },
  {
    file: 'lib/coach/state-loader.ts',
    reason:
      'The 60-day cadence baseline is a running-FORM metric, not a training-load one. ' +
      'Cadence is a property of how the runner moves at a given pace and does not fall ' +
      'during a taper the way volume does; a taper day\'s cadence is his cadence. Dropping ' +
      'those days would thin a 60-day sample for no gain in truth.',
  },
  {
    file: 'lib/coach/glance-state.ts',
    reason:
      'A near-verbatim copy of state-loader.ts\'s 60-day cadence baseline, exempt for the ' +
      'same reason: form mechanics, not training load. Noted here rather than silently, ' +
      'because the duplication is real and either both move or neither does.',
  },
  {
    file: 'lib/coach/health-state.ts',
    reason:
      'The running-form block (cadence, stride length, vertical oscillation, ground ' +
      'contact, L/R balance) at 14- and 28-day averages. Same argument as the cadence ' +
      'baseline: these describe mechanics at a pace, not volume, and the Health page shows ' +
      'them AS a trend the runner reads himself rather than feeding a plan decision.',
  },
  {
    file: 'lib/training/max-hr.ts',
    reason:
      'A biometric ceiling, not a habit. The highest HR ever observed is evidence wherever ' +
      'it came from, and a race — which sits inside a prescribed window by definition — is ' +
      'the single best place to observe it. Filtering would discard the best data.',
  },
  {
    file: 'lib/training/vdot-inputs.ts',
    reason:
      'Fitness anchors, not training identity. A taper workout and a race are legitimate ' +
      'and often the STRONGEST VDOT evidence available; the whole taper exists to produce ' +
      'exactly that performance. This module already carries its own quality gates for ' +
      'what counts as an anchor, which is the right filter for the question it asks.',
  },
  {
    file: 'app/api/admin/tester-watch/route.ts',
    reason:
      'An admin diagnostic table, read by nobody but the operator and feeding no coaching ' +
      'decision. Its columns are labelled "derived from actual runs" and showing the raw ' +
      'window is the point — an admin debugging a bad plan needs to see the same number ' +
      'the engine saw. Its hardcoded /4.0 weekly divisor is a separate, pre-existing ' +
      'inaccuracy and is not made worse by this rule.',
  },
  {
    file: 'scripts/_bump_long_floor.mjs',
    reason:
      'A one-off maintenance script, not production, and the direction of error is inert: ' +
      'it RAISES a plan\'s long-run floor to the 28-day max, so a taper-depressed window ' +
      'can only fail to raise the floor. It can never lower one.',
  },
  {
    file: 'scripts/_simulate_all.mjs',
    reason:
      'A simulation harness that deliberately MIRRORS the generator\'s own readers so the ' +
      'sim and prod agree. It must not be filtered independently: if it diverges from ' +
      'lib/plan/generate.ts the harness stops reproducing what prod does, which is worse ' +
      'than reproducing a defect. It follows generate.ts, which is being repaired ' +
      'separately under this same rule.',
  },
  {
    file: 'scripts/_simulate_mid_block.mjs',
    reason:
      'The mid-block sibling of _simulate_all.mjs, exempt for the identical reason: it is ' +
      'a mirror of the generator\'s reads, and a mirror that corrects its subject is no ' +
      'longer a mirror. It follows generate.ts.',
  },
  {
    file: 'scripts/_audit_state_05_form_readiness.mjs',
    reason:
      'An analysis script reproducing training-form.ts\'s CTL/ATL/TSB series for an audit. ' +
      'Exempt for the same reason as the module it reproduces: a freshness model must see ' +
      'the taper, and an audit of that model must see what the model sees.',
  },
];

/**
 * The file-level COUNT PIN · a backstop behind the statement exemptions.
 *
 * `lib/plan/generate.ts` produced four of Rule 8's six defects. Its habit
 * readers were repaired in `43c3da26`; the two statements that remain are
 * argued above under the corollary, PER STATEMENT, so the file itself is never
 * exempted and every other statement in it is still scanned.
 *
 * This pin sits behind those two exemptions and asserts the file's TOTAL
 * finding count, which the per-statement excuses cannot. A `statement`
 * fingerprint is a substring match, so one written a shade too broadly would
 * silently excuse a future sibling that happens to contain it — the pin catches
 * that, because the total would rise while the unexcused count stayed at zero.
 * Defence in depth on the file with the worst record.
 *
 * IT HAS ALREADY FIRED ONCE, on its first real encounter and exactly as
 * designed: `43c3da26` landed while this gate was being rebased onto it, the
 * count fell from 4 to 2, and the gate refused to pass until the entry was
 * re-read. That is the argument for pinning a number rather than trusting a
 * list — the same self-expiring posture as `check-palette-sync.sh`'s
 * legacy-declaration block.
 *
 * The two implementations of the window itself — this module's
 * `prescribedWindowFor` and generate.ts's `prescribedSpanFor` — are bound
 * against drift by assertion in `lib/training/_normal_window.test.ts`, across
 * every distance and priority. They read the same two doctrine tables; there
 * are two of them because the generator imports `pg` and reaching into it from
 * the filter would close an import cycle.
 */
export interface NormalWindowFilePin {
  file: string;
  /** Exact number of findings the scanner must report for this file, excused
   *  or not. It rises when a statement is added and falls when one is
   *  repaired; either way the entry has to be re-read. */
  findings: number;
  reason: string;
}

export const NORMAL_WINDOW_FILE_PINS: readonly NormalWindowFilePin[] = [
  {
    file: 'lib/plan/generate.ts',
    findings: 2,
    reason:
      'Was 4 before the repair in 43c3da26 on 2026-08-30, and this pin caught the drop. ' +
      'Both remaining statements are argued per-statement above under the corollary — ' +
      'recentPeakLongMi\'s literal spike anchor and trailingAvgWeeklyMi\'s ramp check, each ' +
      'an injury guard reading absorbed load rather than capability. The pin stays because ' +
      'those excuses are substring matches: it is what fails if a third statement in this ' +
      'file ever slips under one of their fingerprints.',
  },
];

/**
 * The curated half of the gate · habit readers the SQL scanner CANNOT see.
 *
 * The scanner keys on SQL that aggregates `runs` over a rolling window. That
 * misses every reader which pulls rows through `mileageByDay` /
 * `getCanonicalRunIds` and does the aggregation in TypeScript — which is most
 * of the important ones, including four of the six defects Rule 8 was written
 * from. This list carries them by name so the gate can assert that each is
 * still where it says it is, and still on the side of the line it claims.
 *
 * `verdict`:
 *   · `filtered` — repaired this round; the file must reference the shared
 *     module, and the gate fails if that reference is ever removed.
 *   · `exempt`   — argued above the line; the reason must say WHY, and the
 *     symbol must still exist so a rename cannot silently retire the claim.
 */
export interface HabitReader {
  /** Repo-relative path. */
  file: string;
  /** A symbol that must still be present in that file. */
  symbol: string;
  /** The lookback this reader measures over, for the record. */
  window: string;
  verdict: 'filtered' | 'exempt';
  reason: string;
}

export const HABIT_READERS: readonly HabitReader[] = [
  // ── repaired 2026-08-30 ───────────────────────────────────────────────────
  {
    file: 'lib/plan/sim-inputs.ts',
    symbol: 'prescribedSpans',
    window: '28 representative days · easy 3-9 mi, median to 0.5',
    verdict: 'filtered',
    reason:
      'RULE8-SIM-1 · the SIMULATOR\'s half of `easyDayMedianMi`, and the one Rule 8 could not ' +
      'reach. `loadGeneratorInputs` assembles a PrescribedSpan and hands it to every habit ' +
      'reader; `buildSimPlan` assembled none and read the raw daily series over 14 CALENDAR ' +
      'days, so the filter RULE8-1 shipped that morning was unreachable by /sim/plan, by ' +
      '_anchor_fit, by _coach_sensible and by the whole archetype corpus — Rule 15\'s ' +
      '"a mechanism the corpus cannot REACH is untested", in the one place a gate could have ' +
      'proved it. It now builds the span with the same `prescribedSpanFor` and consumes it ' +
      'through the same `eligibleDaysBack`, over the same HABIT_ELIGIBLE_DAYS, refusing on ' +
      'the same HABIT_MIN_EASY_SAMPLES. On the owner\'s own logged series the reading moves ' +
      'from 4.0 (the median of his post-half recovery jogs) to 6.0.',
  },
  {
    file: 'lib/coach/runner-calibration.ts',
    symbol: 'medianDailyMi',
    window: '14 days · easy 3-9 mi, long 10-30 mi, quality 4-12 mi',
    verdict: 'filtered',
    reason:
      'Three habit medians persisted as the runner\'s learned tolerances. Read raw the ' +
      'week after a half, the easy median is the taper\'s 4 mi — Rule 8\'s second row.',
  },
  {
    file: 'lib/coach/runner-calibration.ts',
    symbol: 'peakWeekMi',
    window: '28 days',
    verdict: 'filtered',
    reason:
      'volume_ceiling_mi — the biggest week the runner is believed to hold. A window that ' +
      'is entirely taper would set that ceiling at the taper and call it his capacity.',
  },
  {
    file: 'lib/plan/goal-gap.ts',
    symbol: 'normalWeeklyMileage',
    window: '28 days',
    verdict: 'filtered',
    reason:
      'Feeds the limiter\'s volume signal and assessGoal\'s volume caution, both of which ' +
      'ask what he NORMALLY runs. composeCautions\' own in-taper guard is not enough: it ' +
      'goes quiet inside the window and speaks again a week after it closes, while the ' +
      '28-day mean is still almost entirely taper.',
  },
  {
    file: 'app/api/targets/projection/route.ts',
    symbol: 'normalWeeklyMileage',
    window: '28 days',
    verdict: 'filtered',
    reason: 'Same assessGoal volume caution, reached from the Targets surface.',
  },
  {
    file: 'app/api/v5/races/route.ts',
    symbol: 'normalWeeklyMileage',
    window: '28 days',
    verdict: 'filtered',
    reason: 'Same assessGoal volume caution, reached from the phone\'s Races card.',
  },
  {
    file: 'lib/onboarding/strava-history.ts',
    symbol: 'loadStravaHistoryForOnboarding',
    window: '56 days',
    verdict: 'filtered',
    reason:
      'Prefills the onboarding volume chips, which seed weeklyAvg4w and the plan\'s ' +
      'peak-long floor — the two numbers Rule 8\'s first and fourth rows name. Its ' +
      'divisor now moves with the exclusion instead of a fixed eight weeks.',
  },
  {
    file: 'lib/plan/seed-from-onboarding.ts',
    symbol: 'deriveRunHistory',
    window: '56 days',
    verdict: 'filtered',
    reason:
      'The cold-start path that derives the first plan\'s starting volume and long-run ' +
      'floor from actual runs. Its hardcoded / 8.0 divisor is now the representative-day ' +
      'count, so excluding the taper no longer reads as a collapse.',
  },
  {
    file: 'lib/plan/adapt.ts',
    symbol: 'detectVolumeOvershoot',
    window: 'acute 7 days · chronic 28 days ending 8 days back',
    verdict: 'filtered',
    reason:
      'The CHRONIC leg only — the baseline the card calls "your usual {N}mi week" in the ' +
      'runner\'s own copy. The ACUTE leg is deliberately unfiltered: that week is the ' +
      'thing under judgement. A taper-depressed chronic lowers max(prescribed, chronic) ' +
      'and fires a shave on a runner doing nothing but returning to his own volume.',
  },

  // ── argued exemptions the SQL scanner cannot see ──────────────────────────
  {
    file: 'lib/runs/volume.ts',
    symbol: 'recentWeeklyMileageMi',
    window: '28 days',
    verdict: 'exempt',
    reason:
      'THE execution reader, and it must stay one. It answers "how much did he run", ' +
      'which a drift check and an adherence surface need complete, taper days included. ' +
      'Its habit twin is normalWeeklyMileage in lib/training/normal-window.ts; the two ' +
      'are kept as separate functions precisely so a call site must say which question ' +
      'it is asking rather than inheriting an answer.',
  },
  {
    file: 'lib/coach/acwr.ts',
    symbol: 'computeAcwr',
    window: 'acute 7 days · chronic 28 days',
    verdict: 'exempt',
    reason:
      'An acute-to-chronic load ratio is a model of what the runner is CARRYING, not a ' +
      'claim about who he is. Research/15 defines both legs over consecutive days; ' +
      'removing the taper from the chronic leg would raise the ratio and manufacture a ' +
      'load spike out of a rest week. Bound by SAMPLING.acwr-needs-a-full-chronic-window.',
  },
  {
    file: 'lib/coach/convergence-loader.ts',
    symbol: 'habitualWeeklyMpw',
    window: '28 days · chronic28 x 7',
    verdict: 'exempt',
    reason:
      'Named "habitual" but spent as a CURRENT-LOAD number: its only consumer is the ' +
      'Research/00b sleep row, and how much sleep a runner needs this week scales with ' +
      'what he is running this week. A tapering runner genuinely needs the lower row. ' +
      'The name is misleading and worth changing; the behaviour is right.',
  },
  {
    file: 'lib/coach/readiness.ts',
    symbol: 'weeklyMpwFor',
    window: '28 days · loadChronic28 x 7',
    verdict: 'exempt',
    reason:
      'Sets the dynamic sleep target off current load, same argument as habitualWeeklyMpw ' +
      'and reading the same chronic leg. A readiness input is SUPPOSED to move with ' +
      'recent training; that responsiveness is the feature.',
  },
  {
    file: 'lib/coach/health-actions.ts',
    symbol: 'chronicWeeklyMpw',
    window: '28 days · loadChronic28 x 7',
    verdict: 'exempt',
    reason:
      'The third consumer of the same chronic leg, for the same sleep-floor row. Exempt ' +
      'on the same grounds, listed separately so a future change to one of the three ' +
      'cannot quietly assume the other two were considered.',
  },
  {
    file: 'lib/coach/easy-discipline.ts',
    symbol: 'raceWindowFor',
    window: '90 days, with its own per-distance race exclusion',
    verdict: 'exempt',
    reason:
      'ALREADY COMPLIANT by its own route, and deliberately so. It excludes a per-distance ' +
      'window around each race as EasyRunExclusion \'race\', claim-bound by ' +
      'EASY.pre-race-context-window / EASY.post-race-context-window. SETTLED 2026-08-30: ' +
      'neither citation is wrong and the divergence from this module is pure GRANULARITY. ' +
      'raceWindowFor reads DAYS and matches its sources exactly — Research/00b\'s "total ' +
      'recovery days (no quality)" upper bound after (5/7/14/28) and Research/08 §9.1\'s ' +
      'taper-length upper bound before (7/10/14/21). The engine\'s tables are WHOLE WEEKS ' +
      'and round opposite ways on the two sub-week rows: 10K pre 7-10 days rounds UP to 14, ' +
      '5K post 3-5 days floors DOWN to 0. So this module over-excludes 4 days before a 10K ' +
      '(safe — at worst a refusal) and UNDER-excludes up to 5 days after a 5K (not safe). ' +
      'Closing that needs POST_RACE_RECOVERY_WEEKS[\'5k\'] to change, which also moves plan ' +
      'composition, so it belongs to whoever owns that table. Recorded, not silently left.',
  },
  {
    file: 'lib/coach/limiter.ts',
    symbol: 'recentWeeklyMi',
    window: 'inherited from its caller',
    verdict: 'exempt',
    reason:
      'Takes the number rather than reading it, and its one production caller (goal-gap.ts) ' +
      'now hands it the filtered value. Listed so the input stays visible: if a second ' +
      'caller ever appears it must make the same choice at its own site, which is the ' +
      'per-finding-context-filter rule this one inherits from.',
  },
];
