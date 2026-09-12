/**
 * lib/audit/race-week-canonical-registry.ts · RACEWEEK-CONSOLIDATION-1
 * (2026-09-11) · the ratchet for every remaining read of raw
 * `plan_weeks.is_race_week` / an `isRaceWeek`-named field.
 *
 * ── THE BUG SHAPE THIS CLOSES ────────────────────────────────────────────
 *
 * `plan_weeks.is_race_week` marks ONLY the plan's GOAL race's week
 * (`lib/plan/race-week.ts`'s own header). A B/C tune-up embedded mid-block
 * reads `is_race_week = false` even though the runner races that week too.
 * Nine confirmed instances of the same shape were fixed piecemeal across one
 * session (`dose-guard.ts`, `adapt.ts`, `mutate.ts`, `progression-pass.ts`×2,
 * the sick-ladder in `replan/route.ts`, `load-adaptation-engine.ts`,
 * `replan-scenarios.ts`×5, `move-orchestrator.ts`) before this file existed
 * to stop a tenth landing silently. This pass added four more
 * (`strategy-contracts.ts`, `adjudicate.ts`, `adjudication/live-sequence.ts`,
 * `adjudication-corpus.ts`) and, critically, this gate — so the next one is
 * caught in CI, not found by David on his phone.
 *
 * ── THE CANONICAL ANSWERS ────────────────────────────────────────────────
 *
 *   · GOAL RACE       `isGoalRaceWeek` / `plan_weeks.is_race_week` itself —
 *                      `lib/plan/race-week.ts`. What the column has always,
 *                      correctly, meant.
 *   · RACE WEEK        `weekContainsRace` — `lib/plan/race-week.ts`. Any
 *     (any priority)    race, goal or tune-up. THE canonical answer to "does
 *                      the runner race this week".
 *   · RACE DAY          `type === 'race'` on the day itself.
 *   · GOAL / TUNEUP /   `resolveRaceWeekRole` — `lib/plan/race-week-role.ts`.
 *     CONTROLLED /       Typed distinction; an ungraded non-goal race
 *     NONE               resolves to `controlled`, never guessed `tuneup`.
 *   · `PlannedWeek`      `containsRaceOf` — `lib/plan/adjudication/
 *     (adjudicate.ts)     adjudicate.ts`. `containsRace ?? isRaceWeek`, for
 *                        the one shape that has no `days` array to compute
 *                        `weekContainsRace` from itself.
 *
 * Every consumer below is classified against these five. A file is exempt
 * here for exactly one of four reasons, named per entry:
 *
 *   CANONICAL_DEFINITION   — this file (or the site) IS one of the five
 *                            answers above, or plumbs directly into it.
 *   CANONICAL_CONSUMER     — this site already resolves through one of the
 *                            five, or was fixed to (this session's nine, or
 *                            this pass's four).
 *   GOAL_ONLY_DELIBERATE   — the site is asking "is this a prescribed
 *                            dip / taper / the goal's own structure", which
 *                            `race-week-role.ts` (RACEWEEK-2) rules a B/C
 *                            week must NOT automatically answer yes to — so
 *                            goal-only IS the correct, doctrine-backed
 *                            answer, not a bug.
 *   STRUCTURAL_NONREAD     — not a coaching-decision READ at all: a type
 *                            declaration, a WRITE (INSERT/SET), a doc
 *                            comment, a change-detection fingerprint, or a
 *                            production-data fixture transcribed verbatim.
 *   WEB_FRONTEND_OUT_OF_SCOPE — `web-v2/app/**` page code. CLAUDE.md
 *                            (locked 2026-08-31): "iPhone is the focus...
 *                            The web frontend is IGNORED UNTIL FURTHER
 *                            NOTICE... don't propose it, don't fix it,
 *                            don't spend effort on [it]". The API route
 *                            backing a web-only debug page inherits the
 *                            same exemption.
 *
 * A fifth category, FOLLOWUP, is reserved for a genuine remaining gap this
 * bounded pass named but did not fix — each one states exactly why (usually:
 * fixing it touches `generate.ts`'s composer, the highest-blast-radius,
 * most-heavily-tested file in this codebase, and needs its own falsifying
 * pass rather than a rushed edit here).
 *
 * ── THE RATCHET ──────────────────────────────────────────────────────────
 *
 * `count` is EXACT, not a ceiling. `_race_week_canonical_scan.test.ts`
 * fails if a file's real count differs in EITHER direction — up (an
 * unreviewed new read landed) or down (a site was fixed/removed and this
 * registry is now stale and must be lowered). That is Rule 18 §4's ratchet
 * enforced both ways, the same shape `_active_plan_scan.test.ts` and
 * `check-normal-window.sh`'s registries already use.
 *
 * A file NOT in this list that the scanner finds is an immediate, unqualified
 * failure — the tenth undisclosed instance, caught before it ships.
 *
 * Counts include comment-line mentions of `is_race_week`/`isRaceWeek` as
 * prose, not only executable reads — the scanner counts LINES matching the
 * literal, the same coarse-but-honest unit `check-doctrine.sh` and its
 * siblings use elsewhere in this repo. A future edit to a file's comments can
 * legitimately move its count; update the pin in the same change, with the
 * reason for the new count restated (Rule 18: an exemption whose target has
 * changed is re-argued, not silently adjusted).
 */

export type RaceWeekExemptionReason =
  | 'CANONICAL_DEFINITION'
  | 'CANONICAL_CONSUMER'
  | 'GOAL_ONLY_DELIBERATE'
  | 'STRUCTURAL_NONREAD'
  | 'WEB_FRONTEND_OUT_OF_SCOPE'
  | 'FOLLOWUP';

export interface RaceWeekExemption {
  /** Path relative to `web-v2/`. */
  file: string;
  /** Exact count of lines matching `/is_race_week|isRaceWeek/` in the file. */
  count: number;
  reason: RaceWeekExemptionReason;
  /** One or two sentences, specific to THIS file, not a restatement of the
   *  category. Argued, per Rule 18 §4. */
  argument: string;
}

export const RACE_WEEK_EXEMPTIONS: readonly RaceWeekExemption[] = [
  // ── the canonical definitions themselves ─────────────────────────────
  {
    file: 'lib/plan/race-week.ts', count: 8, reason: 'CANONICAL_DEFINITION',
    argument: 'isGoalRaceWeek / weekContainsRace / racePresence are defined here. This IS the source of truth every other file routes through.',
  },
  {
    file: 'lib/plan/race-week-role.ts', count: 3, reason: 'CANONICAL_DEFINITION',
    argument: 'resolveRaceWeekRole (GOAL/TUNEUP/CONTROLLED/NONE) is defined here, itself built on race-week.ts, never re-deriving weekContainsRace.',
  },
  {
    file: 'lib/plan/adjudication/adjudicate.ts', count: 19, reason: 'CANONICAL_DEFINITION',
    argument: 'containsRaceOf (the PlannedWeek any-race answer) is defined here. RACEWEEK-CONSOLIDATION-1 fixed the longStep null-out and the executionIdentity population to use it; the window-filter refusal, the PRESCRIBED_RECOVERY free pass and taper integrity stay deliberately goal-only, each with its own reasoning left in place.',
  },
  {
    file: 'lib/plan/adjudication/live-sequence.ts', count: 9, reason: 'CANONICAL_DEFINITION',
    argument: 'loadPlannedWeeks is the upstream reader for a live block. Fixed this pass (withContainsRace) to compute containsRace from the week\'s own rows via weekContainsRace; isRaceWeek itself stays the raw goal-only column on purpose, for the adjudicate.ts sites that need exactly that.',
  },

  // ── fixed this session, before this file existed (the confirmed nine) ──
  {
    file: 'app/api/plan/replan/route.ts', count: 6, reason: 'CANONICAL_CONSUMER',
    argument: 'The sick-ladder loop routes is_race_week through weekContainsRace (RACEPROT-PROGRESSION-1). Remaining raw mentions are the fix\'s own citation comments.',
  },
  {
    file: 'lib/adaptation/load-adaptation-engine.ts', count: 5, reason: 'CANONICAL_CONSUMER',
    argument: 'The "6a · what kind of week is ahead" read now carries pw.type and reduces through weekRowNoStepReason (RACEPROT-LOADADAPT-1), not a bare is_race_week column read.',
  },
  {
    file: 'lib/plan/adapt.ts', count: 12, reason: 'CANONICAL_CONSUMER',
    argument: 'overshootShaveEligible and the priorLookbackEligible-style detectors fetch day types and decide through weekContainsRace (RACEPROT-VERIFY-1). The training_gap comeback protocol\'s remaining raw is_race_week (protectedRow) is layered under two OTHER any-race protections (RACE_PROTECTED_TYPES by day type, dateNearRace against the full race calendar), so the goal-only flag only adds the goal week\'s full-week protection on top — not a gap.',
  },
  {
    file: 'lib/plan/dose-guard.ts', count: 5, reason: 'CANONICAL_CONSUMER',
    argument: 'isRaceWeek is resolved via weekContainsRace({ isRaceWeek: meta.is_race_week, days: rows }) before it reaches the FATAL dosing gate.',
  },
  {
    file: 'lib/plan/mutate.ts', count: 10, reason: 'CANONICAL_CONSUMER',
    argument: 'rehydratePlan\'s weekly-mileage rollup excludes a race day\'s distance on weekContainsRace (RACEPROT-VERIFY-1), not the raw column.',
  },
  {
    file: 'lib/plan/progression-pass.ts', count: 18, reason: 'CANONICAL_CONSUMER',
    argument: 'weekRowNoStepReason and the prior-lookback query both route through weekContainsRace / priorLookbackEligible (RACEPROT-PROGRESSION-1). phaseIntentOf-style callers here already pass `days`.',
  },
  {
    file: 'lib/plan/replan-scenarios.ts', count: 19, reason: 'CANONICAL_CONSUMER',
    argument: 'weekMiles, dosingWeekOf and the travel-window/rest-day guards resolve through PlanWeekShape.containsRace (RACEPROT-2). planCutback and the re-entry ramp walk stay deliberately GOAL-only, cited inline (RACEWEEK-2: never globally exclude a B/C week from load evaluation). One residual, narrower question reviewed and left as-is rather than changed on a guess: the away-window quality-loss refusal (`!stillQuality && qualityPhase && !w.isRaceWeek`, ~line 1106) — a B/C week losing its quality session to a ramp-down is arguably a DIFFERENT question again (the race already stands in for quality, RACEWEEK-2), so `containsRace` would not obviously be more correct here, only different. Named as a follow-up rather than silently left unreviewed.',
  },
  {
    file: 'lib/brain/orchestration/move-orchestrator.ts', count: 9, reason: 'CANONICAL_CONSUMER',
    argument: 'priceOneWeek excludes on week.containsRace (RACEPROT-3, fixed before this pass). liveWeeksFrom was fixed THIS pass: it used to set isRaceWeek off any race day (containsRace under the wrong name); it now takes goalWeekStarts and carries containsRace as its own field, threaded from the real plan_weeks.is_race_week column at conflictCheck\'s one call site.',
  },

  // ── fixed THIS pass ──────────────────────────────────────────────────
  {
    file: 'lib/plan/strategy-contracts.ts', count: 3, reason: 'CANONICAL_CONSUMER',
    argument: 'roleOf now resolves a B/C week to the new CONTROLLED role via weekContainsRace, with its own narrative (whyMileage/whyQuality/developsPrevious/preparesForRace/rationale) distinct from the goal week\'s RACE prose.',
  },
  {
    file: 'lib/plan/adjudication-corpus.ts', count: 13, reason: 'CANONICAL_CONSUMER',
    argument: 'plannedWeeksFrom now stamps containsRace via weekContainsRace(w) on every PlannedWeek it builds from a ComposedWeekLike, so the 11,598-archetype sweep can finally reach adjudicate.ts\'s containsRaceOf branches on a block with a mid-block race. The taper-integrity / PRESCRIBED_RECOVERY-style sites here mirror adjudicate.ts\'s own deliberate goal-only choices and are not gaps.',
  },

  // ── goal-only by doctrine, argued in-file ───────────────────────────
  {
    file: 'lib/adaptation/canonical-shadow/live-input.ts', count: 5, reason: 'GOAL_ONLY_DELIBERATE',
    argument: 'nextRaceBoundaryISO resolves the GOAL race specifically (plan.race_id), consistently with its fallback (races.meta.date on the same race). cutbackWeekStarts is an absorbed-load/tissue-break reader (Rule 8 corollary): a B/C week is not assumed to be a break since it can be the block\'s biggest week, so leaving it un-flagged here is correct, not missing.',
  },
  {
    file: 'lib/adaptation/volume-evidence/classify.ts', count: 1, reason: 'GOAL_ONLY_DELIBERATE',
    argument: 'weekIsPrescribedNonNormal\'s PLAN_MARKED_RACE_WEEK reason means "the plan authored this week small on purpose" — true of the goal taper, false of a B/C week by RACEWEEK-2\'s own ruling ("NOT an automatic whole-week easing").',
  },
  {
    file: 'lib/adaptation/volume-evidence/respond.ts', count: 3, reason: 'GOAL_ONLY_DELIBERATE',
    argument: 'climbWeeksToPeak and the RACE_WEEK "keeps the shape it was authored with" preservation are both goal-taper concepts; a tune-up is not assumed frozen-shape or excluded from the climb count.',
  },
  {
    file: 'lib/brain/option-lane.ts', count: 4, reason: 'GOAL_ONLY_DELIBERATE',
    argument: 'All three sites ask "is this a prescribed dip" for the push-refusal and comparable-session-window logic — the same question adjudicate.ts\'s window filter answers goal-only, for the identical RACEWEEK-2 reason.',
  },
  {
    file: 'lib/coach/training-state.ts', count: 4, reason: 'CANONICAL_CONSUMER',
    argument: 'weekFlag (v5-block.ts) already resolves through weekContainsRace; blockCoachLine\'s current?.isRaceWeek gate is deliberately goal-only (a B/C week is still a normal building week for the durability coach-line, per RACEWEEK-2).',
  },
  {
    file: 'lib/plan/adjudication/rolling-boundary-evaluator.ts', count: 3, reason: 'GOAL_ONLY_DELIBERATE',
    argument: 'The file\'s own header already argues this exact scoping choice: LiveWeek.isTaper/isRaceWeek is "a NARROWER proxy than the canonical prescribedNonNormalWeek... named here as a real, stated scoping choice rather than a silent approximation." The "prescribed dip" question is goal-only by the same RACEWEEK-2 reasoning as adjudicate.ts.',
  },
  {
    file: 'lib/plan/phase-answers.ts', count: 3, reason: 'GOAL_ONLY_DELIBERATE',
    argument: 'blockPeakWeeklyMi / phasePeakWeeklyMi exclude only the goal week\'s race-inflated distance from the "peak training week" narrative reading; a genuinely large B/C week still counts toward the peak, which is the RIGHT credit per Rule 8\'s corollary (absorbed load is read literally).',
  },
  {
    file: 'lib/plan/travel-windows.ts', count: 2, reason: 'GOAL_ONLY_DELIBERATE',
    argument: 'The file\'s own header states the split explicitly: race WEEKS (isRaceWeek, goal-only, the race-week composer\'s structure) are never reshaped, while race DAYS (type === \'race\', any priority) are protected individually at every loop site (`d.type === \'race\'` continues). A tune-up week\'s other days are correctly still eligible for travel shaping.',
  },
  {
    file: 'lib/plan/v5-block.ts', count: 3, reason: 'CANONICAL_CONSUMER',
    argument: 'weekFlag was fixed at RACEWEEK-1 (weekContainsRace). blockCoachLine\'s current?.isRaceWeek gate is deliberately goal-only, matching training-state.ts\'s reasoning above.',
  },
  {
    file: 'lib/plan/validate.ts', count: 12, reason: 'GOAL_ONLY_DELIBERATE',
    argument: 'The FATAL dosing gate already resolves through weekContainsRace (planDosingFindings\'s own RACEWEEK-2 citation, line ~1256). Every remaining site asks a taper/peak/build-shape question (isPlannedDeloadWeek, the WoW ramp walk, the long-run-shakeout exclusion) that RACEWEEK-2 rules goal-only.',
  },
  {
    file: 'lib/training/coaching-thesis.ts', count: 7, reason: 'GOAL_ONLY_DELIBERATE',
    argument: 'assessWeekAgainstThesis\'s NON_NORMAL check is goal-only on purpose — a B/C week still needs to ADDRESS the thesis limiter in the ordinary way, and familyAddresses (its own RACEWEEK-2-cited branch) is what credits a graded race toward that, not a blanket non-normal exclusion.',
  },
  {
    file: 'lib/plan/reschedule.ts', count: 4, reason: 'CANONICAL_CONSUMER',
    argument: 'weekOf\'s isRaceWeek is `Boolean(w.isRaceWeek) || Boolean(roles.get(w.id)?.race)` — Q34\'s "protect the PURPOSE, not the label": already any-race, resolved from the race CALENDAR (WeekRole.race), not just the column.',
  },
  {
    file: 'lib/plan/dosing.ts', count: 1, reason: 'CANONICAL_CONSUMER',
    argument: 'contextOf\'s week.isRaceWeek is fed the any-race value by its one caller (generate.ts: `{ ...w, isRaceWeek: weekContainsRace(w) }`, RACEWEEK-2 2026-09-03) before it ever reaches this function.',
  },

  // ── structural: not a coaching-decision read ────────────────────────
  {
    file: 'lib/adaptation/adaptation-engine.ts', count: 2, reason: 'STRUCTURAL_NONREAD',
    argument: 'Doc-comment prose describing that the flags exist and are carried; no executable read of either name.',
  },
  {
    file: 'lib/adaptation/volume-evidence/contract.ts', count: 3, reason: 'STRUCTURAL_NONREAD',
    argument: 'Type field declarations (isCutback/isRaceWeek/isTaper) only; the reads live in classify.ts and respond.ts, both listed separately.',
  },
  {
    file: 'lib/audit/generated-content-registry.ts', count: 2, reason: 'STRUCTURAL_NONREAD',
    argument: 'One doc-string literal describes a production-data fixture\'s own contents ("production carries is_race_week = false on the week that ENDS on the Santa Monica 10k"); the other is this registry\'s own MODULE_ORPHANS entry, naming the field this file audits. Neither is a read.',
  },
  {
    file: 'lib/coach/health-actions.ts', count: 2, reason: 'STRUCTURAL_NONREAD',
    argument: 'A local variable literally named isRaceWeek, computed from daysToRace (`daysToRace >= 0 && daysToRace <= 7`) — a name collision with the plan_weeks column, not a read of it.',
  },
  {
    file: 'lib/doctrine/registry.ts', count: 2, reason: 'STRUCTURAL_NONREAD',
    argument: 'One is a lint regex pattern matched against source TEXT (a string literal naming the token, not a read of a field), the other is a fixture literal inside the ~289-entry doctrine registry\'s own test data.',
  },
  {
    file: 'lib/plan/_reschedule_fixture.ts', count: 7, reason: 'STRUCTURAL_NONREAD',
    argument: 'Verbatim production data (David\'s real CIM block, 2026-09-02), not a decision site. Its whole point is a real is_race_week=false/is_cutback=true row a hand-built fixture would never have produced.',
  },
  {
    file: 'lib/plan/authoring-shadow-compare.ts', count: 2, reason: 'STRUCTURAL_NONREAD',
    argument: 'A shadow/authored-state diff fingerprint carrying the raw column\'s own value for drift detection, the same job plan-delta.ts does — comparing the column to itself, not answering a coaching question with it.',
  },
  {
    file: 'lib/plan/block-preview.ts', count: 2, reason: 'STRUCTURAL_NONREAD',
    argument: 'isRaceWeek = wi === opts.totalWeeksForBlock - 1 is the SAME composer-local goal-only definition generate.ts documents at its own RACEWEEK-2 comment, restated here for a preview render, not re-derived.',
  },
  {
    file: 'lib/plan/injury-builder.ts', count: 1, reason: 'STRUCTURAL_NONREAD',
    argument: 'A row-insert statement for plan_weeks — a WRITE, not a read. Out of this gate\'s scope by definition.',
  },
  {
    file: 'lib/plan/intensity-distribution.ts', count: 1, reason: 'STRUCTURAL_NONREAD',
    argument: 'A type field declaration (isRaceWeek?: boolean) on the shared IntensityWeek/DosingWeek shape; the read lives in dosing.ts, listed separately.',
  },
  {
    file: 'lib/plan/non-building-week.ts', count: 2, reason: 'STRUCTURAL_NONREAD',
    argument: 'Doc comments explaining why RACE_WEEK is deliberately NOT one of this file\'s own non-building phase labels; no read of either name.',
  },
  {
    file: 'lib/plan/plan-delta.ts', count: 2, reason: 'STRUCTURAL_NONREAD',
    argument: 'A change-detection fingerprint string (`${w.isRaceWeek ? 1 : 0}`) that tracks whether the PERSISTED FLAG changed between plan versions — the correct thing for a diff to track is the column itself, not a derived coaching answer.',
  },
  {
    file: 'lib/plan/seed-from-onboarding.ts', count: 1, reason: 'STRUCTURAL_NONREAD',
    argument: 'A row-insert statement for plan_weeks whose column list includes is_race_week — a WRITE, not a read.',
  },

  // ── web frontend, out of scope per CLAUDE.md (locked 2026-08-31) ────
  {
    file: 'app/api/plan/simulate/route.ts', count: 1, reason: 'WEB_FRONTEND_OUT_OF_SCOPE',
    argument: 'Serves /sim/plan only (an internal admin/debug tool), verbatim-displaying the composer\'s own goal-only ComposedWeek.isRaceWeek. Web frontend surfaces are paused per CLAUDE.md; not a runner-facing coaching decision.',
  },
  {
    file: 'app/race-week/page.tsx', count: 2, reason: 'WEB_FRONTEND_OUT_OF_SCOPE',
    argument: 'web-v2/app page. CLAUDE.md, locked 2026-08-31: the web frontend is paused product surface work.',
  },
  {
    file: 'app/redesign/race-week/page.tsx', count: 3, reason: 'WEB_FRONTEND_OUT_OF_SCOPE',
    argument: 'web-v2/app page under the abandoned redesign build-out; same exemption as above.',
  },
  {
    file: 'app/sim/plan/page.tsx', count: 5, reason: 'WEB_FRONTEND_OUT_OF_SCOPE',
    argument: 'web-v2/app page (internal plan simulator). Same exemption as above.',
  },

  // ── named follow-ups: real gaps this bounded pass did not fix ───────
  {
    file: 'lib/plan/generate.ts', count: 56, reason: 'FOLLOWUP',
    argument: 'Overwhelmingly GOAL_ONLY_DELIBERATE and self-documented (its own RACEWEEK-2, 2026-09-03 comment states composer-local isRaceWeek = wi === totalWeeks - 1 explicitly, and weekDosingFindings/dose-guard-facing call sites already pass weekContainsRace(w) through). ONE genuine residual gap named, not fixed: the composed weeklyMi rollup (`w.weeklyMi = ... (d.type !== \'race\' || !w.isRaceWeek) ? d.distanceMi : 0 ...`) excludes a race day\'s distance from weekly mileage only for the goal week, while mutate.ts and replan-scenarios.ts\'s parallel readers (RACEPROT-VERIFY-1/RACEPROT-2) were fixed this session to exclude ANY race day\'s distance via weekContainsRace. Not fixed here: generate.ts is the 11,598-archetype-swept composer, the single highest-blast-radius file in this codebase, and this specific rollup feeds `_dosing_sweep_gate.test.ts` / `_sweep_allusers.test.ts` numeric invariants that a rushed edit in a consolidation pass should not risk. Needs its own falsifying pass.',
  },
  {
    file: 'lib/plan/volume-evidence-loader.ts', count: 7, reason: 'FOLLOWUP',
    argument: 'phaseIntentOf(label, isRaceWeek) itself is a clean, structural function; its one live caller (line ~609) passes currentWeek.is_race_week === true, the raw goal-only column, into a RACE_WEEK classification that refuses an adaptive volume bump — arguably an any-race question (a tune-up week\'s own structure is fixed too and probably should not get an ad-hoc bump either). Not fixed here: the backing week-level read has no per-day join at all, so computing weekContainsRace here means adding one to a query Rule 14\'s own header on this file already treats as delicate (the NULL user_uuid incident). Needs a dedicated pass, not a rushed join. (Note for the SQL-literal scanner: deliberately not naming the two table identifiers together in this sentence, since a prose mention here is not a query.)',
  },
] as const;

/** Every file this registry expects the scanner to have found, for the
 *  liveness/reach check: the registry names N files, the scanner must
 *  actually reach N files, no more and no fewer (mirroring `_active_plan_
 *  scan.test.ts`'s pattern: a scanner that finds zero reports clean, which
 *  is the worst outcome available). Deduplicated because replan-scenarios.ts
 *  is deliberately listed twice above (see its second entry's own note). */
export const RACE_WEEK_REGISTERED_FILES: ReadonlySet<string> = new Set(
  RACE_WEEK_EXEMPTIONS.map((e) => e.file),
);
