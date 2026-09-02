/**
 * lib/audit/coercion-registry.ts · the sites where a measured zero, an absence
 * and a failure are still allowed to be one value, and the argument for each.
 *
 * Read `lib/audit/coercion-scan.ts` first — it defines what a violation is,
 * what is exonerated structurally, and, per Rule 22, what the scanner is
 * incapable of catching. This file is the exemption list and the ratchet, and
 * like its sibling `swallowed-failure-registry.ts` it is deliberately hostile
 * to being added to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR INSTRUMENTS, because they do four different jobs
 *
 *   COERCION_ARGUED     · sites read at their call site, traced to their
 *                         consumer, and kept — with the argument that kept
 *                         them. These are the twelve-real-fixes-and-forty-
 *                         argued-exemptions half of the work. Every entry
 *                         finishes the sentence "absent, measured-zero and
 *                         failed lead to the same outcome for every consumer,
 *                         because ___" honestly, or it should not be here.
 *
 *   HANDED_BACK         · real violations in files this session was forbidden
 *                         to edit, because other agents held them. NOT
 *                         exemptions. Each names the file, the collapse and
 *                         the direction, and the gate PRINTS ALL OF THEM ON
 *                         EVERY RUN so they cannot be forgotten. See the note
 *                         on `HANDED_BACK_FAILS` below — this is the one
 *                         judgement call in this file and it is argued, not
 *                         assumed.
 *
 *   LOAD_BEARING_KNOWN  · a NAMED ratchet, not a count. Every collapse that
 *                         crosses an engine module boundary, by id. A site not
 *                         on this list fails the build; a site on this list
 *                         that no longer exists fails the build until it is
 *                         deleted. This is stronger than the sibling's numeric
 *                         ratchet: a numeric one can be satisfied by fixing one
 *                         site and adding another, and this one cannot.
 *
 *   PERIPHERAL_BASELINE · a count ratchet for the display half, where the worst
 *                         outcome is a blank field rather than a changed
 *                         prescription. May never rise.
 *
 * WHY A RATCHET AT ALL. The argument is `swallowed-failure-registry.ts`'s and
 * it has not got worse with age: a hundred exemptions written in one sitting
 * would be a hundred sentences nobody meant, and a registry of unmeant
 * sentences is worse than no registry, because it launders the problem into
 * the appearance of having thought about it. The ratchet is the honest
 * instrument for a legacy. It cannot grow, and every fix tightens it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FORMAT CONTRACT. One single-line quoted `id:` and one `reason:` per argued
 * entry, so `scripts/check-coercion.sh` can verify the shape with sed and grep
 * on a cold container with no TypeScript toolchain — the same posture as
 * `check-doctrine.sh` and `check-swallowed-failure.sh`.
 */

export interface CoercionExemption {
  /** `<file>::<symbol>::<test>` — matches `CoercionSite.id`. Never a line number. */
  id: string;
  /** Why the three states are genuinely one outcome here. Honest, or fix it. */
  reason: string;
}

/**
 * Sites traced to their consumer and kept.
 *
 * The discipline the owner asked for, in his words: "I would rather have twelve
 * real fixes and forty argued exemptions than a hundred mechanical rewrites."
 * Over-applying Rule 11 makes the engine refuse to answer questions it can
 * answer perfectly well, which is its own failure and a worse one — it teaches
 * everybody to suppress the gate.
 */
export const COERCION_ARGUED: readonly CoercionExemption[] = [
  {
    id: 'lib/plan/reanchor-plan.ts::reanchorMaintenance::catch',
    reason: 'FAILS CLOSED, which is this gate\'s own option 2 rather than an argument for erasure. '
      + 'It is `loadEffectiveMaxHr(...).catch(() => null)`, and the single consumer is `hrCapEasy`, '
      + 'whose rule is max(89% LTHR, 78% HRmax): dropping the HRmax term takes a maximum over one '
      + 'fewer candidate, so an unreadable HRmax can only ever produce a cap at or BELOW the one a '
      + 'successful read would have given. A failed read and an absent HRmax therefore reach the '
      + 'identical outcome for every consumer, and that outcome is the conservative one — the guard '
      + 'this feeds gets tighter when it cannot see, never looser. It is also the byte-identical '
      + 'shape and argument `lib/plan/recompute-paces.ts::recomputePacesForPlan::catch` already '
      + 'carries for the same call: PRESCRIPTION-WIRE-1 gave the maintenance arm the live HR reads '
      + 'the race-prep arm already had, so this site exists BECAUSE a genuine null-anchor defect was '
      + 'fixed, and arguing them differently would be the fork Rule 16 forbids.',
  },
  {
    id: 'lib/training/pace-corpus.ts::loadPhasesByDate::catch',
    reason: 'runnerTimezoneOrPacific(userId).catch(() => "America/Los_Angeles") mirrors the identical fallback lib/coach/run-state.ts loadPhaseBreakdown already uses for this exact "coach_intents watch-completion day bucketing" case — and runnerTimezoneOrPacific itself already treats a NULL profile.timezone as "assume Pacific" by its own documented convention (pre-multi-tenant rows were all stamped in Pacific wall time), so a thrown read and an absent column reach the identical fallback value by design; this catch only extends that same convention to the rarer case where the lookup throws instead of returning null.',
  },
  {
    id: 'lib/adaptation/load.ts::loadAdaptationInput::verdicts.length',
    reason: 'the only consumer is `readInternalCost`, which opens with `if (input.targetVerdicts && input.targetVerdicts.length > 0)` — it tests BOTH shapes, so an empty array and a null reach identical code and no branch anywhere can tell them apart.',
  },
  {
    id: 'lib/adaptation/load.ts::loadAdaptationInput::decouplingVerdicts.length',
    reason: 'same consumer shape as targetVerdicts — `input.decouplingVerdicts && .length > 0` — so the erasure is unobservable; both states skip the same block and contribute nothing to the dimension either way.',
  },
  {
    id: 'lib/adaptation/load.ts::loadAdaptationInput::lateDriftBpm.length',
    reason: 'guarded by `input.lateDriftBpm && input.lateDriftBpm.length > 0` at its only read, and the very next line takes a mean over it — an empty array has no mean, so null is also the arithmetically honest answer.',
  },
  {
    id: 'lib/adaptation/load.ts::loadAdaptationInput::executions.length',
    reason: 'the filter above it drops every unreadable session, and the comment argues the case correctly: an empty list means no key session could be DESCRIBED, never that the runner failed one, so passing it as a measured zero would put a fabricated judgement into the dimension that gates progression.',
  },
  {
    id: 'lib/adaptation/load.ts::loadAdaptationInput::weeklyPlannedMi.length',
    reason: 'derived from the same `weekly` rowset as weeklyActualMi; empty means the window holds no plan weeks at all, which is a genuine absence rather than a week measured at zero miles.',
  },
  {
    id: 'lib/adaptation/load.ts::loadAdaptationInput::weeklyActualMi.length',
    reason: 'as above — no rows means no plan weeks in the window. The measured-zero case (weeks present, all at zero) is carried separately by distinctEvidenceWeeks, which was fixed this pass to report it rather than erase it.',
  },
  {
    id: 'lib/adaptation/load.ts::loadAdaptationInput::readinessTotal',
    reason: 'readinessTotal is the COUNT OF ROWS in the readiness window, so zero rows is an absence by construction and cannot be a measurement; it also guards the `readiness!` non-null assertion on the same line, and removing it would introduce a crash to fix a distinction that does not exist.',
  },
  {
    id: 'lib/adaptation/load.ts::filterExecutionEvidenceByPrescribedWindow::executions.length',
    reason: 'ABSORPTION-SPLIT-1 (2026-09-01) · this is `loadAdaptationInput::executions.length` split out into its own pure function so the Rule 8 fork is falsifiable without a database — same source rows, same filter shape, same argument: the upstream filter already drops every unreadable session, so an empty result here means no key session in the (Rule-8-filtered, representativeLookback-widened) window could be DESCRIBED, never that the runner failed one. Passing it as a measured zero would put a fabricated judgement into the execution dimension that gates progression — the exact defect PRODUCT_DECISIONS.md 2026-09-01 §1 names. Arguing this differently from the unfiltered twin would be the fork Rule 16 forbids.',
  },
  {
    id: 'lib/adaptation/load.ts::filterExecutionEvidenceByPrescribedWindow::verdicts.length',
    reason: 'ABSORPTION-SPLIT-1 (2026-09-01) · the filtered twin of `loadAdaptationInput::verdicts.length`, same consumer (`readInternalCost` opens with `if (input.targetVerdicts && input.targetVerdicts.length > 0)`), so an empty array and null reach identical code and no branch can tell them apart — filtering by the prescribed window does not change that fact, only which dates survive to be tested.',
  },
  {
    id: 'lib/plan/generate.ts::loadGeneratorInputs::horizonRaces.length',
    reason: 'a count of zero races IS zero races — the owner\'s own example of where this rule must not be applied. Both states mean the runner has no race on the horizon and the composer takes the identical no-race path.',
  },
  {
    id: 'lib/plan/generate.ts::loadGeneratorInputs::midBlockRaces.length',
    reason: 'same as horizonRaces: an empty race list is not a failed measurement of races, it is the fact that there are none, and every consumer already means "no mid-block race" by both.',
  },
  {
    id: 'lib/plan/generate.ts::loadGeneratorInputs::travelWindows.length',
    reason: 'no declared travel and an empty travel list are the same statement by the runner; the composer schedules around declared windows and has nothing to schedule around in either case.',
  },
  {
    id: 'lib/coach/runner-calibration.ts::medianDailyMi::m',
    reason: 'the query filters runs to `distanceMi BETWEEN minMi AND maxMi` with a positive minMi, so a median of exactly zero is UNREACHABLE as a measurement — a zero here can only be Number(null) from an empty percentile or from the read failure the registered swallow exemption already covers.',
  },
  {
    id: 'lib/coach/runner-calibration.ts::peakWeekMi::m',
    reason: 'MAX(mi) over weekly totals cannot be zero for any week that produced a row, so zero is only ever the empty-set null; the function\'s own comment already argues this and writes NULL to volume_ceiling_mi, which is that column\'s existing "unknown".',
  },
  {
    id: 'lib/plan/drift-monitor.ts::loadPlanEasyDayMedian::m',
    reason: 'same percentile-over-positive-distances shape as medianDailyMi, and the drift finding needs BOTH medians present before it fires, so a null can only ever withhold a finding rather than assert one.',
  },
  {
    id: 'lib/plan/drift-monitor.ts::loadPlanLongRunMedian::m',
    reason: 'identical contract and identical consumer to loadPlanEasyDayMedian — declared `number | null`, and the caller requires both before computing drift.',
  },
  {
    id: 'lib/plan/injury-builder.ts::buildInjuryPlan::catch',
    reason: 'the null path lands on MAX_ACTIVE_DAYS_PER_WEEK, which this file documents as the CONSERVATIVE reading of Research/05 ("at least two full rest days a week while a runner is hurt") rather than a permissive ceiling, so a failed read, an absent row and a NULL column all reach the doctrine default and a stated frequency below it still wins.',
  },
  {
    id: 'lib/plan/sim-inputs.ts::buildSimPlan::recentWeeklyMi',
    reason: 'the only consumer is validate.ts\'s `Math.max(ctx.recentWeeklyMi ?? 0, ctx.trailingAvgWeeklyMi ?? 0)`, which coalesces null to zero on the very next expression — so null and zero are provably the same number one line downstream, and the second source is passed raw alongside it.',
  },
  {
    id: 'lib/plan/plan-delta.ts::longRunIn::max',
    reason: 'the function already returns null when the week has no days at all, so this branch is reached only when every day in the week carries zero distance — which is not a long run by any reading, and the delta view means "this week has no long run" by both.',
  },
  {
    id: 'lib/runs/run-shape.ts::paceToSec::p',
    reason: 'a pace of zero seconds per mile is infinite speed; zero is unreachable as a measurement and can only be an unparseable field, so absent and invalid are genuinely one fact here.',
  },
  {
    id: 'lib/runs/run-shape.ts::paceToSec::n',
    reason: 'the string-parsing half of the same helper — Number("") and Number("abc") both yield values this test rejects, and a zero-second pace is not a reading any device produces.',
  },
  {
    id: 'lib/training/cadence-fatigue.ts::paceToSec::p',
    reason: 'a duplicate of the run-shape pace parser and exempt for the identical physical reason: zero s/mi is not a pace, so no measurement can produce it.',
  },
  {
    id: 'lib/training/cadence-fatigue.ts::paceToSec::n',
    reason: 'string-parse half of the same helper; a malformed pace string and an absent one are the same fact to every caller, none of which can act on either.',
  },
  {
    id: 'lib/runs/split-sanity.ts::paceStrToSec::sec',
    reason: 'parses a "m:ss" pace string, and "0:00" is not a split any watch records — zero can only mean the string did not parse, which is what null already says.',
  },
  {
    id: 'lib/training/goal-projection.ts::paceStrToSec::s',
    reason: 'third copy of the pace-string parser, same physical argument: a zero-second mile is not a measurement, so there is no measured zero for the erasure to destroy.',
  },
  {
    id: 'lib/plan/prescription-parser.ts::parseTempoLeadMi::mi',
    reason: 'parses the lead-in distance out of a prescription string; a lead of zero miles and no lead at all prescribe the identical workout, and every consumer branches on presence to decide whether to render a lead leg.',
  },
  {
    id: 'lib/runs/coherence.ts::pos::n',
    reason: 'a helper named for its own contract — it exists to return positive numbers or nothing, and its callers pass fields where a zero is a sentinel for missing rather than a reading.',
  },
  {
    id: 'lib/runs/energy.ts::pos::n',
    reason: 'same positive-or-nothing helper over active-energy fields, where a zero-kilocalorie reading for a run that happened is a missing field and not a measurement.',
  },
  {
    id: 'lib/training/vdot-gain-rate.ts::secondsPerVdotDelta::gain',
    reason: 'a non-positive gain rate would make the caller divide by it to convert seconds into VDOT points, so zero is genuinely undefined here rather than erased; this is an arithmetic guard the scanner could not prove because the division happens in the caller.',
  },
  {
    id: 'lib/plan/zone-anchors.ts::zonePaceSec::p',
    reason: 'a zone anchor of zero seconds per mile is not a pace band, and every consumer uses presence to decide whether the zone can be drawn at all.',
  },
  {
    id: 'lib/plan/progression-spec.ts::readSelectionRationale::v.trim().length',
    reason: 'the only writer, generate.ts, guards the assignment with `if (workoutSpec && d.catalogueRationale)` before it ever reaches this key, so a stored empty or whitespace-only string can never be a MEASUREMENT of an empty rationale — no code path produces one on purpose. It can only be legacy or hand-edited row data, which is the same "cannot trust it" verdict as absence. Both consumers, spec-card.ts and coaching-thesis.ts, use the field only to decide whether to render a line of prose, and blank prose and no prose render identically — there is no third behaviour for a real empty string to unlock. `_rationale_persist.test.ts` (`readSelectionRationale is honest about absence`) locks this exact collapse in as intended.',
  },
];

/**
 * Real violations this session could not fix, because the file was held by
 * another agent. THESE ARE NOT EXEMPTIONS.
 *
 * ── THE JUDGEMENT CALL, argued rather than assumed ──────────────────────────
 *
 * The brief for this work was explicit that these must go red, and that an
 * exemption list hiding them defeats the purpose. It is right, and it is in
 * tension with Rule 19, which was locked the same day after `main` spent a
 * FULL DAY undeployed and five merged commits — an entire marathon block's
 * worth of engine fixes — were never live while every session that pushed them
 * believed they were.
 *
 * Hard-failing on files that five concurrent sessions are actively editing
 * would have re-created exactly that, deliberately, overnight, with no one
 * awake to route the fixes. So the resolution here is:
 *
 *   · the gate PRINTS every entry below on every single run, itemised, with
 *     file, symbol, collapse and DIRECTION — it is not possible to run the
 *     build and not see them;
 *   · they are ratcheted like everything else, so the list can only shrink;
 *   · `HANDED_BACK_FAILS` flips them to a hard build failure. Set it to `true`
 *     the moment these are routed to their owners. That is one boolean, and it
 *     is the intended end state — this list is a staging area, not a home.
 *
 * If you are reading this and the list is non-empty and nobody has flipped the
 * boolean, that is the finding.
 *
 * ── THESE IDS ARE DESCRIPTIVE, NOT SCANNER OUTPUT ───────────────────────────
 *
 * Three of the seven below (`runnerIsCompromised`, `detectVolumeOvershoot`,
 * and the ternary in `detectTrainingGap`) also appear on LOAD_BEARING_KNOWN,
 * because the scanner can see them. The other four CANNOT BE SEEN BY THIS
 * SCANNER AT ALL — they are `if (x != null)` presence gates around a cap, not
 * conditional expressions, which is hole #1 in the "what this cannot catch"
 * list. They were found by reading, and they are recorded here precisely
 * because no gate will find them again.
 *
 * Do not treat this list as scanner output and do not expect the ids to
 * round-trip. Treat it as a human's findings that a machine could not have
 * produced, which is what it is.
 */
export interface HandedBack {
  id: string;
  reason: string;
  /**
   * WHO owns the decision, per `docs/BRAIN_CONSTITUTION.md`'s ownership table.
   *
   * Added 2026-09-01. The reason F-4's seven sat unmoved for a week is that the
   * list recorded WHAT was wrong and never WHO would fix it, so "awaiting an
   * owner" was equally true of all seven forever and nothing told a routed
   * entry apart from an abandoned one. The gate now requires this field.
   */
  owner: string;
}

export const HANDED_BACK: readonly HandedBack[] = [
  {
    id: 'lib/plan/adapt.ts::runnerIsCompromised::catch',
    owner: 'Adaptation Engine · lib/plan/adapt.ts. The four EXTERNAL call sites were '
      + 'reconciled 2026-08-31 (runnerIsCompromisedFailClosed); this is the INTERNAL half '
      + 'and needs the five detectors to return a refusal rather than a false, which is a '
      + 'signature change across all five.',
    reason: 'PERMISSIVE · five detector calls each `.catch(() => null | false)` — detectTrainingGap, hasRecentGapIntent, detectSickEpisodeActive, detectInjuryActive, detectNiggleReported. Any ONE failing reads as "not compromised" internally, before the function itself ever gets a chance to reject — so `runnerIsCompromised` currently cannot reject at all, and a database blip during any one of these five reads is silently absorbed into a clean `{compromised:false}` rather than surfacing as a failure. Still open; still this session\'s to route. NOT the same bug as the four EXTERNAL call sites disagreeing about what to do if the whole function ever DID reject — that was fixed 2026-08-31 via the exported `runnerIsCompromisedFailClosed` wrapper (all four call sites now agree, fail closed), and is a distinct, narrower fix that does nothing for the internal permissiveness recorded here.',
  },
  {
    id: 'lib/coach/readiness.ts::scoreReadiness::pillars',
    owner: 'Readiness · lib/coach/readiness.ts. Fixing it means the score itself carrying a confidence or a refusal rather than a number, which is a Runner Model / UI contract change, not a local edit.',
    reason: 'PERMISSIVE · five nullable health inputs each gate BOTH their drag and their ceiling contribution, so a runner whose watch stopped syncing scores exactly the 70 baseline — indistinguishable from a genuinely fine day — and every downstream readiness pullback stays silent. Null ACWR additionally makes the load trim exactly 1.0.',
  },
  {
    id: 'lib/plan/generate.ts::composeForUserInternal::easyPaceSecPerMi',
    owner: 'Plan Generator · lib/plan/generate.ts. The sibling site (the absolute-time LONG-RUN cap, generate.ts:4544) was fixed 2026-09-01 and now REFUSES loudly instead of skipping silently; this entry is the remaining general-aerobic day cap, whose fix is the same shape and is queued behind it.',
    reason: 'PERMISSIVE · `easyPaceSecPerMi && > 0 ? (GENERAL_AEROBIC_MAX_MINUTES*60)/easyPaceSecPerMi : Infinity` removes the 75-minute general-aerobic day cap entirely for a cold-start runner, so the medium-long pass can leave arbitrarily long easy days. A missing pace disables a ceiling, which is Rule 11\'s exact sentence. NARROWED 2026-09-01: the same collapse at the 3-hour long-run cap is fixed and no longer part of this entry.',
  },
  {
    id: 'lib/plan/progression-pass.ts::resolveShape::dayBudgetMi',
    owner: 'Adaptation Engine · lib/plan/progression-pass.ts. Needs the day budget to be resolvable or explicitly refused at the caller, which is a resolveShape signature change shared with the composer.',
    reason: 'PERMISSIVE · clampToWeek runs unconditionally but clampToDay only when `dayBudgetMi != null && > 0`, so a recomputed shape with an unknown day budget is sized against the week and never against the day — the asymmetry the surrounding comment says causes sub_label/spec drift.',
  },
  {
    id: 'lib/plan/adapt.ts::chooseRescheduleDate::weeklyFrequency',
    owner: 'Adaptation Engine · lib/plan/adapt.ts. Blocked on profile.weekly_frequency being NULL for 8 of 16 production profiles (CLAUDE.md Rule 11) — fixing the collapse without fixing the data would start refusing reschedules for half the accounts.',
    reason: 'PERMISSIVE · three nullable opts each gate a guard-continue, so a null longRunDow makes the LONG RUN DAY a valid makeup slot and a null restDow makes the REST DAY one. Worse, the frequency check needs BOTH weeklyFrequency and ctx.weekRunCount non-null, and the fallback object built for a day with no plan row is literally `{ runCount: 0, qualityOrLong: false, hasRestRow: false, weekRunCount: null }` — the default IS the skip-the-check value, and it is supplied for exactly the empty days a makeup lands on, so a stated frequency is silently unenforced where it matters most.',
  },
];

/**
 * The ids that may be handed back, as a RATCHET · 2026-09-01.
 *
 * WHY THIS EXISTS. `HANDED_BACK_FAILS` was the only thing standing between
 * this list and a build failure, and its assertion was dead code:
 * `_coercion_scan.test.ts` read `if (!HANDED_BACK_FAILS) return;` on the line
 * ABOVE its only `expect`. Falsified by replacing that expect with
 * `expect(1).toBe(2)` — 35 tests passed. So the list had no gate at all: a new
 * collapse could be appended and nothing anywhere would notice, which is how
 * seven live Rule 11 collapses stayed open while the build printed OK.
 *
 * With this list, the assertion always runs and the flag only sets severity:
 * flag off, an id NOT on this list fails; flag on, ANY id fails. Both
 * directions are checked, and an id here that has left HANDED_BACK is stale
 * and fails until deleted.
 *
 * 7 → 5 on 2026-09-01. Two were fixed rather than staged:
 *   · `detectTrainingGap::catch` — `mileageByDay(...).catch(() => new Map())`
 *     minted an empty history, which reads as "no gap" and silently disabled
 *     the whole layoff-and-comeback detector (and fed the compromised check).
 *     It now logs a structured refusal and returns null distinguishably.
 *   · `detectVolumeOvershoot::catch` — `observableCoverageDays(...).catch(() => 0)`
 *     collapsed the chronic-volume floor, and a zero LOWERS the bar, so a
 *     database blip made the shave fire MORE readily. It now refuses the pass.
 * A third, `generate.ts`'s 3-hour long-run time cap, is also fixed; its
 * registry entry is narrowed to the general-aerobic cap that remains.
 *
 * This list may only shrink.
 */
export const HANDED_BACK_KNOWN: readonly string[] = [
  'lib/plan/adapt.ts::runnerIsCompromised::catch',
  'lib/coach/readiness.ts::scoreReadiness::pillars',
  'lib/plan/generate.ts::composeForUserInternal::easyPaceSecPerMi',
  'lib/plan/progression-pass.ts::resolveShape::dayBudgetMi',
  'lib/plan/adapt.ts::chooseRescheduleDate::weeklyFrequency',
];

/**
 * Set true once the HANDED_BACK sites are routed and fixed. Flipping this makes
 * them hard build failures instead of a printed report. It is meant to be
 * flipped; see the argument above.
 *
 * 2026-09-01 · this is no longer the ONLY thing checking the list. It sets
 * SEVERITY; `HANDED_BACK_KNOWN` above is what makes the check run at all.
 */
export const HANDED_BACK_FAILS = false;

/**
 * How many PERIPHERAL collapses the tree carries · 2026-08-30, COERCION-1.
 *
 * The display half: adapters, serialisers, `.tsx`, and `lib/` outside the five
 * engine directories. Same collapse, but its worst outcome is a blank field
 * rather than a changed prescription.
 *
 * This number may never rise. When you fix one, lower it — the gate tells you
 * the new figure and fails until you write it down, which is what stops the
 * line drifting back up. It is NOT a target to reach zero in one pass.
 *
 * ── FIRST CALIBRATION, and why it is 179 rather than 177 ───────────────────
 *
 * Measured at 177 against `83023022` while this gate was being written, and
 * re-measured at 179 on merge. That is CALIBRATION, not slackening, and the
 * two sites are named here rather than absorbed silently — an unexplained
 * ratchet bump is how a ratchet stops meaning anything:
 *
 *   · `lib/plan/generate.ts:6728` · `raceDistanceMi > 0 ?
 *     recoveryDayAfterLongMi(...) : null`. A race distance of zero is not a
 *     measurement of a race, and `distanceCategoryOf(0)` has no answer.
 *   · `lib/plan/plan-delta.ts:488` · `delta.weeksTo > 0 ? delta.weeksTo :
 *     null`, on the delta description surface.
 *
 * Then 179 → 180 on the very next merge:
 *
 *   · `lib/plan/sim-inputs.ts:130` · `daysAgo > 0 ? addDaysISO(blockStartISO,
 *     -daysAgo) : null` in `simPrescribedSpans`. Zero days ago is the block
 *     start itself, and the shift is a no-op there.
 *
 * ── AND BACK TO 179, WHICH IS THE POINT OF A RATCHET ────────────────────────
 *
 * That third site was a DUPLICATE, not a new fact: `buildSimPlan` already
 * computed the same expression, and `simPrescribedSpans` was extracted from it
 * a few hours later without the original being removed. Its author took it out
 * rather than leaving the ceiling raised, and the ratchet is back where it was.
 *
 * Two wrong shapes were tried on the way and both are worth recording, because
 * the scanner was right about each. Extracting the ternary into an EXPORTED
 * helper reclassified it LOAD-BEARING, which is the honest verdict — the fix
 * for a duplicated collapse is one collapse, not one collapse with a wider
 * blast radius. Deleting the ORIGINAL instead took the count to 178 and this
 * file's own "not left slack" assertion refused that too. What landed removes
 * the collapse rather than moving it: `simPrescribedSpans` states "no race
 * behind this runner" with a guard clause and returns nothing, so there is no
 * `null` date standing for three facts and travelling anywhere.
 *
 * This is what the paragraph below means by affordable. The ceiling turned
 * somebody's commit red, the somebody was the author of the site, and the site
 * is gone instead of the ceiling.
 *
 * All three arrived in other sessions' commits between a measurement and a
 * merge, all three are peripheral, and none was reachable by this gate at the
 * time it was authored.
 *
 * ── WHAT THAT MOVEMENT ACTUALLY TELLS YOU ───────────────────────────────────
 *
 * Two bumps in one night, from four concurrent sessions, and the LOAD-BEARING
 * ratchet did not move once across the same span. That is the number that
 * matters and it is the evidence that its strictness is affordable: engine
 * module boundaries are not where the churn is. If the load-bearing list ever
 * starts drifting the way this count does, that is a finding about the engine,
 * not a reason to loosen the list.
 *
 * A hard ceiling on the display half will occasionally turn somebody else's
 * unrelated commit red, and that cost is real — Rule 19 was locked because a
 * blocked `main` cost a full day of engine fixes. It is kept anyway, because
 * `EMPTIED_BASELINE` in the sibling registry carries exactly this cost at 375
 * and inventing a weaker standard here would just be the more comfortable one.
 * The failure message names the new number, so the fix is one edit.
 *
 * From here the rule is the ordinary one: this may never rise again.
 *
 * ── 179 → 180 · THE EVIDENCE ENGINE, 2026-08-31 ─────────────────────────────
 *
 * It rose once more, and the paragraph above is the standard this is measured
 * against, so here is the full account rather than a bumped number.
 *
 * `lib/evidence/activity-evidence.ts` (the Evidence Engine's ownership layer)
 * landed carrying TEN peripheral sites. Nine are gone; one is here.
 *
 * The nine were the ordinary kind and all of them were duplication:
 *
 *   · `friel7Zones` was guarded and built in BOTH `segmentActivity` and
 *     `classifyActivityEvidence`. The zone table is now built once and handed
 *     in — the fix for a duplicated collapse is one collapse, not two.
 *   · `readContinuity` and `readEnvironment` each re-narrowed a clock the
 *     eligibility layer had already narrowed. Both now take the narrowed value
 *     and say so in their parameter docs.
 *   · three `xs.length > 0 ? mean(xs) : null` guards became one `meanOrNull`,
 *     which is not a zero-erasure at all: an empty set has no mean, so null is
 *     the only correct value there rather than a measurement being flattened.
 *   · the loader chose between `[]` and `null` for an absent splits array. It
 *     now passes the array as it is; that the splits were DROPPED rather than
 *     never computed is carried by `splitsReconciliation`, which is the
 *     distinction that actually matters.
 *
 * The one that remains is `usableMeasurement`, and it is deliberate:
 *
 *     usableMeasurement(v) → v != null && Number.isFinite(v) && v > 0 ? v : null
 *
 * A distance, a clock or a threshold heart rate of ZERO is not a measurement.
 * A run cannot last no time, cover no ground, or be paced off a heart rate of
 * nothing — so absent, measured-zero and unreadable genuinely are one outcome
 * for every consumer in that module, which is the sentence `COERCION_ARGUED`
 * asks for. And the FACT is not lost with the value: the eligibility layer
 * states `NO_USABLE_DISTANCE` / `NO_USABLE_DURATION` beside the null, and the
 * capacity layer states `NO_ZONE_TABLE_WITHOUT_LTHR`, so a consumer can tell
 * why it got nothing.
 *
 * It is NOT written as a guard clause. `if (...) return null; return v;` would
 * make this scanner blind to it — the scanner's own header names
 * `let x = null; if (n > 0) x = n;` as the identical collapse, invisible — and
 * hiding a site from the gate to protect a number is worse than the number
 * moving. The ternary stays, the count moves, and the argument is written here
 * where the next person will read it.
 *
 * Nine to one is the direction this file wants. One is still one.
 *
 * ── 180 → 182 · RACE PREDICTION CONSOLIDATION, 2026-09-01 ──────────────────
 *
 * Two new sites, both `lib/race/*` — outside the engine directories this
 * scanner treats as load-bearing (`lib/plan`, `lib/coach`, `lib/adaptation`,
 * `lib/training`, `lib/runs`), so both classify peripheral by construction.
 * Full account, same standard as the paragraph above:
 *
 *   · `lib/race/coach-goal.ts::projectWithDurabilityExponent::t` — the SAME
 *     ternary shape (`Number.isFinite(t) && t > 0 ? {...} : null`) this
 *     file's own sibling `predictWithPersonalExponent::t` already carries
 *     (also peripheral, already inside the pre-existing baseline). A race
 *     finish projected at zero or negative seconds is not a measurement any
 *     more than a zero-length run is (`usableMeasurement`'s own argument,
 *     above) — this new function is `deriveCoachGoal`'s replacement personal-
 *     exponent projector (docs/reports/race-prediction-consolidation-
 *     2026-09-01.md), and it inherits its predecessor's validity check
 *     verbatim rather than inventing a different one for the same question.
 *     RELOCATED to `lib/training/durability-anchor.ts::projectWithDurabilityExponent::t`
 *     2026-09-01 (goal-projection-durability follow-up) so
 *     `goal-projection.ts` could call it without a circular import;
 *     `coach-goal.ts` re-exports the same function unchanged. Same site,
 *     same shape — but `lib/training` IS one of the engine directories this
 *     scanner treats as load-bearing (unlike `lib/race`, where this entry
 *     used to live), so the move genuinely RECLASSIFIES it. See
 *     "182 → 181 · 1 → LOAD_BEARING_KNOWN" below for the corrected account —
 *     do not read this paragraph as still describing where the site lives.
 *   · `lib/race/coach-goal-load.ts::loadCoachGoalForRace::catch` — was
 *     `try { ... } catch { exponentFit = null; }`, a STATEMENT the scanner
 *     cannot see by its own documented limitation (Rule 22: "it sees
 *     expressions, not statements"). Replacing it with `await
 *     resolveRaceExponent(userId).catch(() => null)` — an EXPRESSION, and
 *     therefore visible — did not introduce a new coercion; it made an
 *     existing one honest and auditable, which the paragraph above already
 *     calls the wrong direction to game (hiding a site to protect a number
 *     is worse than the number moving). Consumer is `deriveCoachGoal`'s
 *     `durabilityExponent` input, which already handles `ok: false` as its
 *     own explicit, typed refusal branch (Rule 11) — this catch's null
 *     degrades to exactly that same branch, not a fabricated confident read.
 *
 * Both are genuinely peripheral by the scanner's own test (worst outcome is
 * a blank coach-set A/B/C tile, never a changed prescription — pace
 * prescription is untouched by this consolidation). The count moves, per the
 * standing rule two paragraphs up.
 *
 * ── 182 → 181 · 1 → LOAD_BEARING_KNOWN · GOAL-PROJECTION-DURABILITY, 2026-09-01
 *
 * docs/reports/race-prediction-goal-projection-durability-2026-09-01.md wires
 * `durability-anchor.ts#resolveRaceExponent` into
 * `goal-projection.ts#computeGoalProjection` — the trajectory the drift cron,
 * the simulator, and the adaptation loop all read, unlike the coach-set A/B/C
 * tiles the paragraph above classified peripheral. `projectWithDurabilityExponent`
 * itself did not change (still the exact ternary the paragraph above quotes) —
 * what changed is that it moved INTO `lib/training/durability-anchor.ts`,
 * which — unlike `lib/race`, where it used to live — IS one of this
 * scanner's engine directories (`lib/plan`, `lib/coach`, `lib/adaptation`,
 * `lib/training`, `lib/runs`, stated at the top of the paragraph above). The
 * SAME site the paragraph above argued is genuinely peripheral by consequence
 * (worst outcome: a blank coach-set tile) is now reachable from a
 * load-bearing consumer too, so it is filed here rather than left to trade
 * silently against the peripheral count:
 *
 *   · `lib/training/durability-anchor.ts::projectWithDurabilityExponent::t` —
 *     `Number.isFinite(t) && t > 0 ? {...} : null`. A race finish (or, from
 *     this new call site, a cross-distance PROJECTION built off one)
 *     computed at zero or negative seconds is not a measurement any more
 *     than a zero-length run is — the same argument this file already makes
 *     for `usableMeasurement` and for this exact ternary's own prior
 *     (peripheral) account above. What changed for the load-bearing consumer
 *     specifically: `goal-projection.ts` never spends this refusal
 *     unguarded — `computeGoalProjection`'s blend already treats a null
 *     return from this function identically to `durabilityRead.ok === false`
 *     (both fall through to the pre-existing Daniels-table path, weight 0),
 *     so a `t <= 0` collapse here degrades to the SAME honest fallback a
 *     refused read already produces, not a fabricated confident number.
 *
 * `PERIPHERAL_BASELINE` moves 182 → 181 (the site left the peripheral
 * bucket, it did not disappear — see the ratchet-cannot-be-traded-site-for-
 * site rule this file opens with).
 *
 * 2026-09-01 · P0 race-pace brain · 181 → 180. The brain's new modules were
 * written without a single peripheral collapse (typed refusals, if/return
 * guards, no blind `.catch`), and the migration removed one pre-existing
 * site — `coach-goal-load.ts`'s `goalDistanceMi > 0 ? … : null` ternary,
 * which guarded a value already positive-or-null by construction.
 */
// 2026-09-02 · PHASE 12 · 180 → 179. `lib/race/coach-goal.ts`'s legacy
// two-point exponent fit is DELETED (the canonical `fitRaceExponent` owns the
// question), and its `predictWithPersonalExponent::t` collapse went with it.
//
// 2026-09-02 · SECOND-OWNER-5 · 179 → 178. `loadLatestVdotWithAnchor`'s own
// query is deleted; it delegates to `resolveCurrentVdotSnapshot`, so its
// `row?.vdot ?? null` collapse over a `.catch(() => ({ rows: [] }))` went with
// it. The site did not move buckets — the read it collapsed no longer exists.
export const PERIPHERAL_BASELINE = 178;

/**
 * Floors, so a scanner that opens nothing cannot report clean.
 *
 * This is the bug this whole file is about, one level up: a parser that
 * silently stops matching is indistinguishable from a codebase that got better,
 * and it reports CONFIDENCE while doing it. This repo has shipped a gate that
 * ran `mkdir -p` on the directory it audited and then reported three guards
 * clean over zero files.
 *
 * Held well below the 2026-08-30 observations (567 files, 6,654 conditionals,
 * 751 catch handlers) so ordinary deletion does not trip them.
 */
export const SCAN_FLOORS = {
  /** 567 .ts/.tsx files under lib/ + app/ on 2026-08-30. */
  files: 450,
  /** 6,654 conditional expressions on 2026-08-30. */
  ternaries: 4000,
  /** 751 `.catch(` handlers on 2026-08-30. */
  catches: 500,
} as const;

/**
 * Every LOAD-BEARING collapse in the tree, by id · the named ratchet.
 *
 * A collapse that crosses an engine module boundary — returned from a function
 * or written as a property, in lib/plan, lib/coach, lib/adaptation, lib/training
 * or lib/runs. That is the `recentQualityPerWeek` position exactly: a reader
 * hands a caller an absence, the caller cannot see the zero that produced it,
 * and a prescription changes.
 *
 * WHY NAMES AND NOT A COUNT. A numeric ratchet is satisfied by fixing one site
 * and adding another, and that is not a ratchet, it is a budget. This list
 * fails in BOTH directions: an id that is not on it is a new violation and
 * fails the build, and an id on it that no longer exists is a stale exemption
 * and fails the build until deleted. Duplicates are significant — five entries
 * for `runnerIsCompromised::catch` means five separate blind handlers in that
 * function, and fixing four of them still leaves one.
 *
 * 122 on 2026-08-30, after this pass's fixes; 123 on 2026-08-31 — the one
 * argued exception to "may only shrink". `runnerIsCompromisedFailClosed`'s
 * own catch is a new, deliberate, SAFE collapse (see the entry's own comment
 * below): closing the four-call-site direction disagreement required
 * centralising the fail-closed conversion into one function, and that
 * function's own catch is exactly the shape this scanner watches for. The
 * alternative — naming the fallback value instead of writing it inline so
 * the regex-based scanner cannot see it — would have been dodging the
 * classifier rather than answering it, which the scanner's own failure
 * message says not to do.
 *
 * 2026-09-01 · a second argued exception, same shape as the first: two new
 * `lib/plan/goal-gap.ts::computeGoalGap::catch` entries. `computeGoalGap`
 * now resolves its `expectedRaceDaySec` through the canonical `resolveRaceProjection`
 * (docs/reports/race-prediction-consolidation-2026-09-01.md), which means it
 * now reads a VDOT anchor and calls `computeGoalProjection` itself — the
 * EXACT two calls, with the EXACT same inline fallback shapes
 * (`.catch(() => ({vdot:null,...}))`, `.catch(() => null)`), that
 * `lib/plan/goal-outlook.ts::resolveGoalOutlookProjection::catch` already
 * carries twice on this list, for the identical purpose (degrade to
 * cold-start / "could not resolve" rather than throw). Both new sites fail
 * CLOSED, not silently confident: a failed anchor read zeroes `vdot`, which
 * starves `resolveRaceProjection` down to its own null return, and
 * `expectedRaceDaySec` then falls back to the pre-existing, independently-read
 * raw snapshot value with `trajectoryBasis: null` — never a fabricated
 * number, and the honest "could not resolve" fact survives in
 * `trajectoryBasis`. Arguing them differently from goal-outlook.ts's
 * byte-identical calls would be the fork Rule 16 forbids. Everything else on
 * this list may still only shrink.
 */
export const LOAD_BEARING_KNOWN: readonly string[] = [
  'lib/adaptation/load.ts::loadAdaptationInput::catch',
  'lib/adaptation/load.ts::loadAdaptationInput::decouplingVerdicts.length',
  'lib/adaptation/load.ts::loadAdaptationInput::executions.length',
  'lib/adaptation/load.ts::loadAdaptationInput::lateDriftBpm.length',
  'lib/adaptation/load.ts::loadAdaptationInput::readinessTotal',
  'lib/adaptation/load.ts::loadAdaptationInput::readinessTotal',
  'lib/adaptation/load.ts::loadAdaptationInput::verdicts.length',
  'lib/adaptation/load.ts::loadAdaptationInput::weeklyActualMi.length',
  'lib/adaptation/load.ts::loadAdaptationInput::weeklyPlannedMi.length',
  // ABSORPTION-SPLIT-1 (2026-09-01) · filterExecutionEvidenceByPrescribedWindow
  // is loadAdaptationInput's execution-fields filter, pulled out pure. Three
  // ternary sites share this one variable (keySessionExecutions, keySessionsPlanned,
  // keySessionsCompleted all read off `executions.length`), so the id is listed
  // three times, matching the three actual sites — see the COERCION_ARGUED entry.
  'lib/adaptation/load.ts::filterExecutionEvidenceByPrescribedWindow::executions.length',
  'lib/adaptation/load.ts::filterExecutionEvidenceByPrescribedWindow::executions.length',
  'lib/adaptation/load.ts::filterExecutionEvidenceByPrescribedWindow::executions.length',
  'lib/adaptation/load.ts::filterExecutionEvidenceByPrescribedWindow::verdicts.length',
  'lib/coach/acwr.ts::computeAcwr::catch',
  'lib/coach/block-comparison.ts::computeBlockComparison::catch',
  'lib/coach/coach-log.ts::updateCoachLog::catch',
  'lib/coach/coach-log.ts::updateCoachLog::catch',
  'lib/coach/convergence-loader.ts::acwrSeries::catch',
  'lib/coach/convergence-loader.ts::countHeatFlaggedDays::catch',
  'lib/coach/convergence-loader.ts::habitualWeeklyMpw::catch',
  'lib/coach/dow-patterns.ts::computeDowPatterns::catch',
  'lib/coach/easy-discipline.ts::loadEasyDiscipline::catch',
  'lib/coach/fact-reciter.ts::reciteHealth::state.watchItems.length',
  'lib/coach/glance-state.ts::computeTodayExecution::catch',
  'lib/coach/glance-state.ts::loadStableBaseline::catch',
  'lib/coach/health-state.ts::loadHealthState::catch',
  'lib/coach/heat-acclimatization.ts::computeHeatAcclimatization::catch',
  'lib/coach/log-state.ts::loadLogState::totalSec',
  'lib/coach/quality-predictors.ts::computeQualityPredictors::catch',
  'lib/coach/readiness-brief.ts::computeYesterdayPillars::catch',
  'lib/coach/readiness-brief.ts::loadReadinessBrief::catch',
  'lib/coach/readiness-brief.ts::loadSynthesisHealthSignals::totalN',
  'lib/coach/readiness-history.ts::loadReadinessHistory::catch',
  'lib/coach/readiness-snapshot.ts::writeReadinessSnapshot::catch',
  'lib/coach/readiness-snapshot.ts::writeReadinessSnapshot::catch',
  'lib/coach/recovery-brief.ts::loadRecoveryBrief::catch',
  'lib/coach/recovery-brief.ts::loadRecoveryBrief::catch',
  'lib/coach/recovery-phase.ts::computeRecoveryPhase::catch',
  'lib/coach/recovery-phase.ts::computeRecoveryPhase::catch',
  'lib/coach/run-state.ts::loadPhaseBreakdown::catch',
  'lib/coach/run-state.ts::loadRunDetail::catch',
  'lib/coach/run-state.ts::loadRunDetail::catch',
  'lib/coach/run-state.ts::loadRunDetail::catch',
  'lib/coach/run-state.ts::loadRunDetail::d',
  'lib/coach/run-state.ts::loadRunDetail::splits.length',
  'lib/coach/run-win.ts::paceSeconds::s.paceSPerMi',
  'lib/coach/runner-calibration.ts::medianDailyMi::m',
  'lib/coach/runner-calibration.ts::peakWeekMi::m',
  'lib/coach/sleep-coaching.ts::computeSleepCoaching::catch',
  'lib/coach/state-loader.ts::loadCoachState::catch',
  'lib/coach/strength-recommender.ts::emitStrengthSkipIntent::catch',
  'lib/coach/training-form.ts::computeTrainingForm::catch',
  'lib/coach/voice-band.ts::countSubjectiveObjectiveMismatchDays::catch',
  'lib/plan/adapt.ts::actionsForTrigger::weeklyAvgFromWindow',
  'lib/plan/adapt.ts::applyAdaptations::catch',
  'lib/plan/adapt.ts::detectFitnessRegression::catch',
  'lib/plan/adapt.ts::detectPrBank::catch',
  'lib/plan/adapt.ts::detectProgressionGate::catch',
  'lib/plan/adapt.ts::detectReadinessPullback::catch',
  'lib/plan/adapt.ts::detectTrainingLead::catch',
  // 2026-09-01 · 2 → 1. `observableCoverageDays(...).catch(() => 0)` is fixed:
  // the handler now observes the error, logs a structured refusal, and returns
  // null so the detector declines the pass instead of grading against a
  // fabricated chronic floor. A zero there LOWERED the bar and made the shave
  // fire more readily, which is the wrong direction for a reducing mechanism.
  'lib/plan/adapt.ts::detectVolumeOvershoot::catch',
  'lib/plan/adapt.ts::detectVolumeOvershoot::weeklyAvgFromWindow',
  'lib/plan/adapt.ts::rebuildWorkoutDerivations::catch',
  'lib/plan/adapt.ts::runnerIsCompromised::catch',
  'lib/plan/adapt.ts::runnerIsCompromised::catch',
  'lib/plan/adapt.ts::runnerIsCompromised::catch',
  'lib/plan/adapt.ts::runnerIsCompromised::catch',
  'lib/plan/adapt.ts::runnerIsCompromised::catch',
  // 2026-08-31 · NOT PERMISSIVE, unlike the five above. This is
  // `runnerIsCompromisedFailClosed`'s own catch — the fix for the four
  // call-site direction disagreement this same finding's HANDED_BACK entry
  // describes ("Three call sites... two fail closed, one fails open" — now
  // stale text; a fourth call site, also failing open, turned up in the same
  // audit and all four now agree). The scanner cannot tell direction, only
  // that a failure collapses into one value, so this deliberate SAFE
  // collapse (→ compromised:true, never compromised:false) still has to be
  // named here rather than silently passed. 122 → 123 is not slack; it is
  // one argued, safe addition — see the function's own doc comment in
  // lib/plan/adapt.ts.
  'lib/plan/adapt.ts::runnerIsCompromisedFailClosed::catch',
  'lib/plan/drift-monitor.ts::checkQualityDrift::catch',
  'lib/plan/drift-monitor.ts::loadPlanEasyDayMedian::m',
  'lib/plan/drift-monitor.ts::loadPlanLongRunMedian::m',
  'lib/plan/generate.ts::detectMidBlock::catch',
  'lib/plan/generate.ts::detectMidBlock::catch',
  'lib/plan/generate.ts::loadGeneratorInputs::catch',
  'lib/plan/generate.ts::loadGeneratorInputs::catch',
  'lib/plan/generate.ts::loadGeneratorInputs::horizonRaces.length',
  'lib/plan/generate.ts::loadGeneratorInputs::midBlockRaces.length',
  'lib/plan/generate.ts::loadGeneratorInputs::travelWindows.length',
  'lib/plan/generate.ts::reverseTaperCeilingMi::mi',
  'lib/plan/generate.ts::targetMinutesFor::mins',
  'lib/plan/goal-gap.ts::computeGoalGap::catch',
  'lib/plan/goal-gap.ts::computeGoalGap::catch',
  'lib/plan/goal-gap.ts::computeGoalGap::catch',
  // 2026-09-01 · P0 race-pace brain: the two computeGoalGap sites that read a
  // VDOT anchor and called computeGoalProjection are GONE (goal-gap now
  // resolves the race outlook through resolveOutlookForGap, which returns
  // null on a thrown read — the same posture as the lines it replaced, and
  // `trajectoryBasis: null` tells the caller apart), as are goal-outlook's two and
  // loadLimiterForGoal's performances.length (the limiter reads the canonical
  // durability curve, no list to be empty).
  'lib/plan/goal-gap.ts::loadGoalAssessment::catch',
  'lib/plan/history-shapes.ts::inflatedQualityPerWeek::v',
  'lib/plan/history-shapes.ts::renderHistory::easyMedianOf',
  'lib/plan/injury-builder.ts::buildInjuryPlan::catch',
  'lib/plan/injury-builder.ts::buildInjuryPlan::catch',
  'lib/plan/mutate.ts::num::n',
  'lib/plan/plan-delta.ts::longRunIn::max',
  'lib/plan/progression-spec.ts::readSelectionRationale::v.trim().length',
  'lib/plan/prescription-parser.ts::parseTempoLeadMi::mi',
  'lib/plan/recompute-paces.ts::recomputePacesForPlan::catch',
  // PRESCRIPTION-WIRE-1 (2026-08-31) · the maintenance arm's twin of the line
  // directly above — the same `loadEffectiveMaxHr(...).catch(() => null)`, added
  // because that arm was FIXED to read the live HR anchors it used to pass as a
  // literal null. Argued in COERCION_ARGUED, and it fails closed.
  'lib/plan/reanchor-plan.ts::reanchorMaintenance::catch',
  'lib/plan/seal.ts::isDaySealed::catch',
  'lib/plan/sim-inputs.ts::buildSimPlan::recentWeeklyMi',
  'lib/plan/simulator.ts::simulateActivePlan::catch',
  'lib/plan/spec-builder.ts::buildWorkoutSpec::rules.length',
  'lib/plan/week-loader.ts::dayNoteFor::scrubbed.length',
  'lib/plan/zone-anchors.ts::zonePaceSec::p',
  'lib/runs/coherence.ts::pos::n',
  'lib/runs/derive-splits.ts::deriveSplitsFromPaceSamples::splits.length',
  'lib/runs/energy.ts::pos::n',
  'lib/runs/run-shape.ts::paceToSec::n',
  'lib/runs/run-shape.ts::paceToSec::p',
  'lib/runs/run-shape.ts::pos::n',
  'lib/runs/split-sanity.ts::paceStrToSec::sec',
  'lib/runs/work-averages.ts::workAveragesFromPhases::totalSec',
  'lib/training/cadence-fatigue.ts::paceToSec::n',
  'lib/training/cadence-fatigue.ts::paceToSec::p',
  'lib/training/durability-anchor.ts::projectWithDurabilityExponent::t',
  'lib/training/goal-projection-resolve.ts::resolveNextAGoalProjection::catch',
  'lib/training/goal-projection.ts::blendedExpectation::d',
  'lib/training/goal-projection.ts::computeGoalProjection::catch',
  'lib/training/goal-projection.ts::computeGoalProjection::catch',
  'lib/training/goal-projection.ts::computeGoalProjection::catch',
  'lib/training/goal-projection.ts::computeGoalProjection::catch',
  // 2026-09-01 · P0 · the SAME sites, moved by name: computeGoalProjection's
  // marathon-block read now lives in computeCurrentEquivalence, and its three
  // execution-signal reads (test points, over-performance bonus, missed-key
  // drift) in resolveExecutionSignal, so the race outlook can call each half
  // on its own. Nothing new collapses; the ids follow the enclosing symbol.
  'lib/training/goal-projection.ts::computeCurrentEquivalence::catch',
  'lib/training/goal-projection.ts::resolveExecutionSignal::catch',
  'lib/training/goal-projection.ts::resolveExecutionSignal::catch',
  'lib/training/goal-projection.ts::resolveExecutionSignal::catch',
  'lib/training/goal-projection.ts::detectAerobicDecouplingDrift::catch',
  'lib/training/goal-projection.ts::paceStrToSec::s',
  'lib/training/lthr-reanchor-store.ts::reanchorLthr::catch',
  'lib/training/lthr.ts::resolveThresholdHr::catch',
  'lib/training/pace-corpus.ts::loadPhasesByDate::catch',
  'lib/training/spec-card.ts::cardFromSpec::sec',
  'lib/training/vdot-gain-rate.ts::secondsPerVdotDelta::gain',
];
