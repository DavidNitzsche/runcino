/**
 * lib/plan/goal-tiers.ts · goal-tier classification + doctrine targets.
 *
 * David's 2026-06-02 ask: fail-proof plan generator. Bench-tested
 * against every tier × distance combination. No hardcoded one-offs.
 *
 * The system was previously "race distance" based (`cat: '5k' | '10k'
 * | 'hm' | 'm'`) which is too coarse. A 1:30 HM runner needs different
 * training than a 2:00 HM runner even though both target HM. This
 * module classifies plans by GOAL TIER (elite / advanced /
 * intermediate / developing) per race distance · then provides tier
 * targets sourced directly from Research/22-plan-templates.md.
 *
 * Architecture:
 *   1. classifyGoalTier(goalPaceSec, raceDistanceMi) → GoalTier
 *   2. TIER_TARGETS[distance][tier] → { peakWeekly, peakLong, ...}
 *   3. generator ramps baseMi → tier.peakWeekly over the build
 *   4. peakLong respects tier.peakLong band (top of the band when
 *      runner has runway, lower when conservative)
 *
 * Cite: Research/22-plan-templates.md
 * Cite: Research/00a-distance-running-training.md §periodization
 */
import {
  type DistanceCategory,
  distanceCategoryOrNull,
  distanceCategoryOrThrow,
} from '@/lib/race/distance-category';

export type GoalTier =
  | 'elite'         // sub-elite paces · world-class targets
  | 'advanced'      // sub-1:30 HM, sub-3 M, sub-18 5K territory
  | 'intermediate'  // sub-2:00 HM, sub-4 M, sub-25 5K
  | 'developing';   // first-race / 2:00+ HM, 4:30+ M

/**
 * 2026-08-18 · categorizer unification. This used to be its own union literal
 * next to its own boundary function, one of three in the app. Both are now
 * aliases of THE categorizer in lib/race/distance-category.ts — the type name
 * is kept because ~40 files import it, but there is one definition.
 */
export type DistCategory = DistanceCategory;
export { distanceCategoryOrNull };

/**
 * 2026-06-03 · Rule 12 · build-window per distance.
 *
 * The maximum useful race-specific build duration. Past this, you're
 * burning the runner out without additional gain. Used by pickPlanMode
 * to decide if a future race is close enough to warrant race-prep mode
 * (vs maintenance mode that waits for the build window to open).
 *
 * DOCTRINE-BOOK-1 (2026-08-17) · this used to cite `Daniels §"Building the
 * Plan"` and `Pfitzinger FRR §"Block Periodization"`, neither of which the
 * doctrine gate could open. The band IS grounded, just elsewhere: Research/22
 * publishes a duration for every distance × tier plan, and the build window is
 * what has to be long enough to fit one. Bound by PLANMODE.build-window-fits-
 * doctrine-plan, which reads those durations out of the doc.
 *
 * DOCTRINE-HMWIN-1 (2026-08-17) · hm was 14 and is now 12. That claim found
 * the divergence and it was reported rather than moved, under an exemption; it
 * has since been ruled on. All three half plans in Research/22 §3 publish
 * `Duration | 12 weeks`, so a 14-week window put a runner into race-prep about
 * two weeks before any published half plan would start. The exemption is gone
 * and the claim now binds the half like every other distance.
 *
 * Cite: Research/22-plan-templates.md · the per-distance plan `Duration` rows
 *       (5K 8-18 wk · 10K 10-18 · HM 12 · M 18 · ultra 16-28)
 * Cite: Research/22-plan-templates.md §"Multi-Race Year Planning" — the
 *       cycle → recovery → bridge → cycle block table this mode machine walks
 */
export const BUILD_WINDOW_WEEKS: Record<DistCategory, number> = {
  '5k': 10,
  '10k': 12,
  'hm': 12,
  'm': 18,
  'ultra': 24,
};

/**
 * 2026-06-03 · Rule 13 · post-race recovery weeks per distance.
 *
 * Mandatory low-volume easy-running window AFTER a race finishes,
 * BEFORE either maintenance or the next race-prep starts. Race-prep
 * blocks that fire too soon after a race land into a runner with
 * depleted glycogen + microscopic muscle damage and stall out by
 * week 3.
 *
 * DOCTRINE-BOOK-2 (2026-08-17) · this header used to assert that "Pfitz
 * explicitly says skipping recovery causes overtraining 80% of the time",
 * under book citations the gate could not open. Nothing in Research/ carries
 * that statistic and it is not attributable to a passage anyone here has read,
 * so it is gone. What Research/00b DOES say, and what actually justifies the
 * window, is kept: returning to *hard* running before day 7 demonstrably
 * impairs recovery (§"Muscle-Damage Biomarker Timeline"), and CK/LDH do not
 * return to baseline until day 6-8. The duration band itself is bound by
 * RECOVERY.post-race-duration.
 *
 * Cite: Research/00b-recovery-protocols.md §"Recovery by Distance" — the
 *       "Total recovery days (no quality)" column
 * Cite: Research/00b-recovery-protocols.md §"Muscle-Damage Biomarker Timeline (Marathon)"
 */
// 2026-06-23 · RECOVERY-1 · post-race recovery duration per Research/00b:197-208 (marathon 21-28
// days / return to quality wk3-4; HM 10-14 days). Was hm:1/m:2 — ~2 weeks too short → under-recovery
// (this composer's own header warns under-recovery causes overtraining 80% of the time).
export const POST_RACE_RECOVERY_WEEKS: Record<DistCategory, number> = {
  '5k': 0,    // 2-3 days easy, no full week needed
  '10k': 1,
  'hm': 2,
  'm': 4,
  'ultra': 4,
};

/**
 * 2026-08-17 · RECOVERY-3 · recovery VOLUME is not recovery DURATION.
 *
 * The bug this fixes, from David's first post-race rollover: his half
 * generated 6 miles in week 1 and 9 in week 2 (15 total) against a 33
 * mi/wk base. He raced 13.1 with a marathon 16 weeks out and the app
 * prescribed near-total rest for a fortnight.
 *
 * Root cause: Research/00b-recovery-protocols.md:196-204 has TWO
 * distinct columns and the composer read the wrong one.
 *   · "Total recovery days (no quality)" · half = 10-14
 *   · "Days of zero/very-light running"  · half = 3-5
 * POST_RACE_RECOVERY_WEEKS above correctly encodes the FIRST (no
 * quality for ~2 weeks). The composer then reused the MARATHON
 * reverse-taper percentages (:256-263 · wk1 10-20% of peak) for every
 * distance, so "no quality" became "no running".
 *
 * These sequences come from each distance's own day-by-day protocol.
 * Half (:240-255) is explicit: day 3 a 20-30 min jog, day 4 30-40 min
 * easy, day 6 40-50 min + strides, day 7 a 45-60 min medium-long, day
 * 12 a 50-70 min long. Summed at an easy pace that is ~60% of base in
 * week 1 and ~80% in week 2 · a cutback, not a shutdown. Marathon
 * KEEPS the reverse taper (:256-263) unchanged · that hole is real.
 *
 * Cite: Research/00b-recovery-protocols.md §Post-Race Recovery
 *       (:196-204 table · :240-255 half protocol · :256-263 marathon)
 */
export const RECOVERY_WEEKLY_PCT_OF_BASE: Record<DistCategory, number[]> = {
  '5k': [0.75],
  '10k': [0.70],
  'hm': [0.60, 0.80],
  'm': [0.15, 0.35, 0.55, 0.75],
  'ultra': [0.15, 0.35, 0.55, 0.75],
};

/**
 * Running days per recovery week, per the same protocols. Derived
 * counts, not a formula: the half runs on days 3, 4, 6 and 7 of week 1
 * (4 days · optional 5th on day 5) then 5-6 days in week 2. Marathon
 * week 1 is days 0-3 off with a couple of short jogs after (2 days),
 * rebuilding to 6. Replaces ceil(wkPct * 7), which produced 2 running
 * days for a half because it was fed marathon-depth percentages.
 */
export const RECOVERY_RUN_DAYS: Record<DistCategory, number[]> = {
  '5k': [4],
  '10k': [4],
  'hm': [4, 6],
  'm': [2, 4, 5, 6],
  'ultra': [2, 4, 5, 6],
};

/**
 * The week's longest run as a fraction of that week's volume. Marathon
 * holds the historical 0.20 (its long stays deliberately small deep in
 * the reverse taper). Shorter distances reintroduce a real medium-long
 * on schedule: half day 7 is 45-60 min and day 12 is 50-70 min, which
 * lands near 30% of those weeks. Always capped by the runner's own
 * recent long.
 */
export const RECOVERY_LONG_PCT: Record<DistCategory, number> = {
  '5k': 0.30, '10k': 0.30, 'hm': 0.30, 'm': 0.20, 'ultra': 0.20,
};

/**
 * RECOVERY-HALF-DURATION-1 (2026-08-28) · THE HALF HAS NO "VOLUME VS. PEAK"
 * COLUMN. IT HAS MINUTES.
 *
 * David's real post-half recovery (`pln_0e635603799fd7b1`, week 2) prescribed
 * 45 miles — four 7-mile easy days and a 13-mile long, off a true recent base
 * around 30-40 mi/wk. The arithmetic that produced it: DOCTRINE-4 below made
 * every `RECOVERY_WEEKLY_PCT_OF_BASE` entry multiply `peakAnchor`, a REAL
 * peak week, because that is what the MARATHON reverse-taper table's own
 * column header says ("Volume vs. peak"). But `hm`'s 0.60/0.80 were never
 * read off a peak-vs-column in the doc — RECOVERY-3's own comment above says
 * they were reverse-engineered by summing the half's 14-day table's MINUTES
 * "at an easy pace" and dividing by "base". Research/00b has no half-marathon
 * "volume vs. peak" table anywhere; the half's own protocol
 * (`### Half Marathon Recovery (14-day)`) is a day-by-day list of MINUTE
 * ranges. DOCTRINE-4 changing the shared denominator from an average to a
 * real peak week was correct for the marathon table it names — and wrong for
 * the half, whose percentages were never calibrated against peak. A runner
 * whose pre-race peak build week ran meaningfully above their typical base
 * (exactly what a taper looks like) had every half-recovery week inflated by
 * that peak/base ratio: peakAnchor ~56 mi × 0.80 ≈ 45 mi, when the table's
 * own days 8-13 sum to 225-265 minutes — about 24-28 mi at a 9:20/mi easy
 * pace, not 45.
 *
 * So the half stops reading `RECOVERY_WEEKLY_PCT_OF_BASE` (still exported and
 * still asserted at length 2 by `RECOVERY.half-protocol-run-days`, so a
 * regression in either place is caught) and instead sizes its week directly
 * off the protocol's own minutes, summed across the SAME running days
 * `RECOVERY_RUN_DAYS.hm` already counts (day-count machinery untouched — only
 * the per-day DOSE changes), converted to miles through the runner's own easy
 * pace. `composeRecoveryPlan` does the conversion, at the slow end of the
 * easy band (`EASY_BAND_SLOW_OFFSET_SEC`) — the same convention COLD-START-1
 * uses, so the conversion can never imply a pace faster than the runner is
 * permitted to run.
 *
 * `[lo, hi]` minutes per week, running days only:
 *   · week 1 (days 3, 4, 6, 7): 20-30 + 30-40 + 40-50 + 45-60 = 135-180 min
 *   · week 2 (days 8, 9, 10, 11, 12, 13): 30-40 + 45 + 40 + 30-40 + 50-70 + 30
 *     = 225-265 min
 *
 * NOT extended to 5K/10K/marathon/ultra:
 *   · 5K/10K have no day-by-day OR volume-vs-peak table in Research/00b at
 *     all. `RECOVERY_WEEKLY_PCT_OF_BASE['5k'|'10k']` is an undocumented
 *     heuristic either way — there is no doctrine-backed duration table to
 *     replace it with, so it is left alone.
 *   · Marathon/ultra's table genuinely IS headed "Volume vs. peak"
 *     (`RECOVERY.marathon-reverse-taper`, `RECOVERY.denominator-is-peak`) —
 *     peakAnchor is the correct, doctrine-stated denominator there. Unchanged.
 *
 * Cite: Research/00b-recovery-protocols.md §"Half Marathon Recovery (14-day)"
 * Bound by RECOVERY.half-duration-not-peak.
 */
export const RECOVERY_HALF_WEEKLY_MINUTES: [number, number][] = [
  [135, 180],
  [225, 265],
];

/**
 * WKRAMP-REC-1 (2026-08-25) · THE CEILING ON A REVERSE TAPER, AS A FRACTION OF
 * THE PRE-RACE PEAK.
 *
 * A recovery block's weeks are stated in Research/00b as percentages of PEAK —
 * the reverse-taper column header says "Volume vs. peak" in as many words, and
 * every number in `RECOVERY_WEEKLY_PCT_OF_BASE` above is read off that column
 * (or, below the marathon, off that distance's own day-by-day protocol). The
 * deepest row doctrine publishes for a distance is therefore the most volume
 * the block is ever entitled to carry, and the block's own earlier weeks — all
 * of which are deloads — say nothing at all about that bound.
 *
 * This is derived, never declared. `max()` of the sequence the doctrine gate
 * already watches cannot drift from it, which a second per-distance table
 * beside it could. It is also why there is no new `Record<DistCategory, …>`
 * here for the lint to have to explain.
 *
 * WHERE IT IS SPENT. `composeRecoveryPlan` multiplies it by the same
 * `peakAnchor` every week of the block is sized off, and hands the product to
 * `enforceWeeklyRampCeiling` as the block's ceiling. See WKRAMP-REC-1 in
 * generate.ts for what that pass did before, and why measuring a reverse taper
 * against its own deload weeks could never let it reach its last row.
 *
 * WHAT IT IS NOT. It is not a target and it is not a resume level. Doctrine's
 * own note under the marathon table — "Full return to peak training load
 * typically week 5-6" — puts 100% of peak AFTER the block, which is exactly
 * why the deepest row (0.75 for the marathon, 0.80 for the half) is below 1.
 *
 * Cite: Research/00b-recovery-protocols.md §"Marathon Recovery (4-week reverse taper)"
 * Bound by RECOVERY.reverse-taper-ceiling-is-the-pre-race-peak.
 */
export function recoveryBlockCeilingPct(cat: DistCategory): number {
  const seq = RECOVERY_WEEKLY_PCT_OF_BASE[cat];
  return seq.length > 0 ? Math.max(...seq) : 1;
}

/**
 * Effort scaling · Research/00b:216-222. An A race is run to the floor
 * off a full taper and earns the full table. A B race is hard but not
 * depleted (60-70% of A-race recovery duration); a C race is a hard
 * workout in costume (25-50%). Applied to DURATION · a shorter hole,
 * not a deeper one, so volumes shift up a step rather than down.
 */
export const RECOVERY_EFFORT_SCALE: Record<string, number> = {
  A: 1.0, B: 0.65, C: 0.35,
};

/** A race's priority as stored on `races.meta->>'priority'`. Anything absent or
 *  unrecognised is treated as an A race — the conservative read, since an
 *  unlabelled race is more likely a goal race than a tune-up. */
export type RacePriority = 'A' | 'B' | 'C';

export function recoveryEffortScale(priority: string | null | undefined): number {
  const key = (priority ?? '').trim().toUpperCase();
  return RECOVERY_EFFORT_SCALE[key] ?? RECOVERY_EFFORT_SCALE.A;
}

/**
 * Recovery DURATION in weeks for a finished race, scaled by how hard it was
 * actually raced.
 *
 * DOCTRINE-6 (2026-08-17). `RECOVERY_EFFORT_SCALE` was added the same morning
 * as the RECOVERY-3 fix and imported nowhere, so every tune-up triggered the
 * full A-race hole: a C-priority 10K put a runner into a week of recovery mode
 * when Research/00b §"Recovery by Effort" asks for "2-3 easy days". This is the
 * function that spends the constant.
 *
 * Scaling DURATION, never depth: a B race is a SHORTER hole, not a shallower
 * one, so the runner re-enters the reverse taper further along rather than
 * running a diluted version of week 1. `composeRecoveryPlan` already offsets
 * into the profile by elapsed weeks; a scaled duration simply ends it sooner.
 *
 * Floors at 0 (a C-priority 5K needs no recovery WEEK at all — the day-level
 * composer carries the 2-3 easy days) and never rounds a positive requirement
 * away when the unscaled table asked for one: `Math.round` on 2 × 0.35 = 0.7
 * would give 1, which is the intent — a C-effort marathon still deserves a week.
 *
 * Cite: Research/00b-recovery-protocols.md §"Recovery by Effort (A vs. B vs. C Race)"
 */
export function postRaceRecoveryWeeks(
  cat: DistCategory,
  priority: string | null | undefined,
): number {
  const full = POST_RACE_RECOVERY_WEEKS[cat];
  if (full <= 0) return 0;
  const scaled = full * recoveryEffortScale(priority);
  // Round to nearest week, but never erase a non-trivial requirement: a half
  // (2 wk) at C scale is 0.7 → 1 week, not 0.
  return Math.max(scaled >= 0.5 ? 1 : 0, Math.round(scaled));
}

/**
 * DOCTRINE-1 (2026-08-17) · TAPER DEPTH IS PER DISTANCE.
 *
 * The engine ran one taper curve — 0.82 / 0.60 / 0.45 of peak at three, two and
 * one weeks out — for every race distance. Those three numbers are lifted from
 * `Research/08-pacing-and-race-week.md` §9.2, whose title is "**Marathon** taper
 * structure (3 weeks)". §9.1, one heading above it, is a five-row table:
 *
 *   | Distance | Taper length | Volume reduction (peak week) |
 *   | 5K       | 5-7 days     | 25-35%                       |
 *   | 10K      | 7-10 days    | 30-40%                       |
 *   | Half     | 10-14 days   | 30-50%                       |
 *   | Marathon | 14-21 days   | 40-60%                       |
 *   | Ultra    | 14-28 days   | 50-70%                       |
 *
 * A 5K runner off a 30 mi/wk peak was racing on 13.5 miles where doctrine asks
 * for 19.5-22.5. That is the same defect shape as the post-race recovery bug
 * caught on 2026-08-17 — one row of a per-distance table applied to all rows —
 * and it was duplicated at two sites in `generate.ts`, which is why this model
 * is exported from here and both sites call it.
 *
 * SHAPE. §9.1 fixes only the DEPTH (the race week). The descent that reaches it
 * is doctrine only for the marathon, in §9.2, so the marathon's own descent is
 * the shape every distance uses, rescaled to its own depth. Expressed as the
 * fraction of the total descent already spent at each week:
 *
 *   race week   1.000   →  1 - 1.000 × 0.55 = 0.45   (§9.2 band 40-50%)
 *   two weeks   0.727   →  1 - 0.727 × 0.55 = 0.60   (§9.2 band 60-70%)
 *   three weeks 0.327   →  1 - 0.327 × 0.55 = 0.82   (§9.2 band 80-90%)
 *
 * so the marathon reproduces its three legacy factors EXACTLY (to the two
 * decimals the engine rounds to) and every marathon plan is byte-identical.
 * Only the other four distances move.
 *
 * ── RULE 7 (2026-08-19) · WHAT IS DOCTRINE HERE AND WHAT IS NOT ───────────
 * Two different things are going on in this array and they have different
 * epistemic status. Bound by CONVENTION.taper-descent-shape, which parses
 * §9.2's three volume bands and derives the admissible range for each entry.
 *
 *   · DOCTRINE · that the shape lands the marathon inside §9.2's three bands.
 *     The claim derives, from §9.2's own numbers, the interval each entry may
 *     occupy, and every entry sits inside it.
 *
 *   · CONVENTION · the three-decimal PRECISION. §9.2's bands are ten points
 *     wide, so 0.727 and 0.327 are one choice inside a range, not a figure
 *     doctrine states. They were reverse-engineered to reproduce three legacy
 *     constants byte-for-byte, which is a good reason and is not a research
 *     finding. Writing them to three decimals implies a precision the source
 *     does not have.
 *
 *   · CONVENTION · applying the shape to the other four distances at all.
 *     §9.2 is titled "Marathon taper structure" and doctrine states no
 *     week-by-week descent for 5K, 10K, half or ultra. Rescaling the
 *     marathon's descent to each distance's own §9.1 depth is OUR
 *     extrapolation. It is a defensible one — a taper that descends
 *     monotonically to a doctrine-correct race-week depth is better than one
 *     that does not — but nobody should read it as doctrine. In practice a
 *     5K's taper is one week long (§9.1 gives 5-7 days, and
 *     TAPER.duration-by-distance holds BLOCK_SHAPE to that), so entries past
 *     the first are never reached for the short distances.
 *
 * Cite: Research/08-pacing-and-race-week.md §9.1 (depth) + §9.2 (descent shape)
 */
const TAPER_DESCENT_SHAPE = [1.0, 0.727, 0.327];

/**
 * Race-week volume as a fraction of peak, per distance · the complement of
 * §9.1's "Volume reduction (peak week)" band, taken at its midpoint.
 *
 * The marathon takes 0.45 rather than §9.1's midpoint of 0.50 because §9.2 is
 * more specific for that distance (week -1 at 40-50% of peak) and 0.45 is the
 * midpoint of the two bands' intersection. Every other distance has no §9.2, so
 * §9.1's midpoint stands.
 */
export const TAPER_RACE_WEEK_PCT_OF_PEAK: Record<DistCategory, number> = {
  '5k': 0.70,   // 25-35% cut → 65-75% remains
  '10k': 0.65,  // 30-40% cut → 60-70% remains
  'hm': 0.60,   // 30-50% cut → 50-70% remains
  'm': 0.45,    // 40-60% cut ∩ §9.2's 40-50% → 45%
  'ultra': 0.40, // 50-70% cut → 30-50% remains
};

/**
 * Taper volume as a fraction of the block's peak week.
 *
 * `wksLeft` counts the race week as 1. Weeks earlier than the shape covers hold
 * the shallowest stated factor rather than climbing back toward peak — a taper
 * never goes back up.
 */
/**
 * DOCTRINE-7 (2026-08-17) · THE 10% RULE IS REGIME-SPECIFIC.
 *
 * `generate.ts` capped every runner's weekly volume climb at `Math.min(1.10,
 * …)` and cited `Research/00a` §"The 10% rule — reconsidered" as its authority.
 * That section is the one that DEBUNKS the rule:
 *
 *   "The traditional 'increase weekly mileage by ≤10%' rule is not strongly
 *   supported by recent evidence" · novices at +24%/wk over 8 wk showed no
 *   higher injury rate than +10% over 12 (Buist RCT) · "Weekly mileage change
 *   correlated weakly with injury" (BJSM 5,200-runner cohort).
 *
 * What `00a` DOES bind is the SINGLE-SESSION spike — a run >110% of the longest
 * in the prior 30 days raises overuse risk ~64% — and the engine already
 * enforces that, in `rampCeiling`. That is the constraint carrying the safety
 * load; the weekly cap was riding on a citation that argues against it.
 *
 * ≤10%/week appears in doctrine only for three named regimes:
 *   · injury return   — Research/05 §"Load progression" ("+≤10%/week")
 *   · post-layoff     — Research/22 §"Return from Moderate Layoff"
 *                       ("10% rule strictly enforced")
 *   · youth (<14)     — Research/14 §"Youth Running Guidelines"
 *
 * All three live in other modules (`injury-builder.ts`, `adapt.ts`'s
 * `RERAMP_WEEKLY_GROWTH`), which already run at 1.10 and are unchanged.
 * `volumeCurve` is the GENERAL case, and its ceiling now comes from the row of
 * `00a` §"Volume progression rules" that actually addresses general ramping:
 *
 *   | Year-on-year base growth | 5-15% per training cycle for trained
 *   | athletes; novices safely +20-25% over 8 weeks vs. +10% over 12 |
 *
 * so a trained runner may climb at the top of the trained band (15%) and a
 * novice at the FLOOR of the novice band (20%) — the conservative end of the
 * only figure doctrine reports for that cohort.
 *
 * WHAT THIS CHANGES IN PRACTICE. The ceiling only binds when the geometric ramp
 * from a runner's base to their tier peak would need more than the cap — an
 * under-based runner on a short runway. Those runners previously got a plan the
 * engine itself described as one where "the peak target won't be fully reached",
 * i.e. they raced under-prepared relative to the Research/22 band for their
 * distance and tier. The peak TARGET is unchanged and still bounds the curve, so
 * no plan climbs past its band; runners simply reach the band they were always
 * aimed at. Every other guard is untouched: the 110% single-session spike cap,
 * the 50% week-over-week validator, the 1.45 post-deload cap, and a cutback
 * every third or fourth week.
 *
 * Cite: Research/00a-distance-running-training.md §"Volume progression rules"
 *       (general case) · §"The 10% rule — reconsidered" (why it is not universal)
 * Cite: Research/05-injury-return-protocols.md · Research/22-plan-templates.md
 *       §"Return from Moderate Layoff" (the regimes that DO take 10%)
 */
export const COMEBACK_RAMP_CEILING = 1.10;
export const GENERAL_RAMP_CEILING: Record<Exclude<LevelKeyLite, null>, number> = {
  beginner: 1.20,        // novices: 00a reports +20-25%/wk safe · take the floor
  intermediate: 1.15,    // trained: top of the 5-15% band
  advanced: 1.15,
  advanced_plus: 1.15,
};

/**
 * WKPEAK-1 (2026-08-25) · HOW MUCH BIGGER THIS CYCLE'S PEAK MAY BE THAN THE
 * LAST ONE THE RUNNER ACTUALLY RAN.
 *
 * `GENERAL_RAMP_CEILING` above and this table read the SAME row of
 * `Research/00a` §"Volume progression rules", on two different axes, and only
 * one of those axes was ever bounded:
 *
 *   | Year-on-year base growth | 5-15% per training cycle for trained
 *   | athletes; novices safely +20-25% over 8 weeks vs. +10% over 12 |
 *
 * DOCTRINE-7 spent that row on the WEEK-OVER-WEEK climb, which is a defensible
 * ruling about the SHAPE of a build (00a §"The 10% rule — reconsidered" argues
 * against a tight weekly cap, and something has to bound the climb). But the
 * row's own words are "per training cycle", and the quantity it literally
 * bounds — how far this block's peak may sit above the last peak the runner
 * demonstrated — was bounded by nothing at all. `volumeCurve` took
 * `TIER_TARGETS[cat][tier].peakWeeklyMileageBand[0]` and built to it from
 * wherever the runner happened to be.
 *
 * WHAT THAT COST, MEASURED. The owner's CIM block: rolling-7-day peak 52.3 in
 * the sixteen weeks before authoring, 51.3 in the sixteen before that — a
 * ceiling he has held twice and grown 2% across. `TIER_TARGETS.m.advanced` is
 * 65-90, so the curve was built to 65: a 24% single-cycle step onto ground he
 * has not touched in eighteen months of records. The block did not deliver it
 * (see WKPEAK-2 and the resume ramp for why), so the defect never surfaced as
 * an injury — it surfaced as a build that peaked at 52.5, exactly his existing
 * peak, having built nothing.
 *
 * BOTH FAILURES COME FROM THE SAME MISSING QUANTITY. A target nobody checks
 * against the runner is either unreachable or unsafe, and which one you get is
 * decided by accident downstream.
 *
 * WHY THE TIER BAND IS NOT DEMOTED INSTEAD. Research/22's rows carry an entry
 * condition in their own prose — §"Marathon — Advanced" opens "Multiple
 * marathons, 50+ mpw base" — and the engine reads the row by goal pace and
 * stated experience without ever asking whether the base is there. Demoting
 * the tier would answer that, and answer it wrongly: the tier also sets the
 * long-run band, quality sessions per week and days per week, all of which are
 * right for this runner. The band is the destination; this is how fast a
 * runner is walked to it. A runner who spends a cycle at 60 arrives at the
 * next authoring with a 60 peak, and 65 is then inside their own ceiling.
 *
 * BEGINNER IS null, AND THAT IS THE DOCTRINE. The 5-15% figure is stated "for
 * trained athletes". The novice half of the row is a different claim about ramp
 * RATE over 8 vs 12 weeks, not about cycle-over-cycle base growth, and reading
 * it as one caps a first-time marathoner building off 15 mi/wk at 19 — against
 * a Research/22 beginner row that asks for 30-35. Doctrine bounds the trained
 * runner here and says nothing about the novice; so does this table.
 *
 * Cite: Research/00a-distance-running-training.md §"Volume progression rules"
 *       — the "Year-on-year base growth" row, per-cycle axis
 * Cite: Research/00a-distance-running-training.md §"Volume table — miles per
 *       week (km in parentheses)" — corroboration, not the binding: the
 *       marathon row's "Recreational competitive 40-60" is the band a 52 mi/wk
 *       marathoner is in, and 60 is its top
 * Bound by RAMP.cycle-over-cycle-peak-growth.
 */
export const CYCLE_GROWTH_CEILING: Record<Exclude<LevelKeyLite, null>, number | null> = {
  beginner: null,        // doctrine's per-cycle figure is stated for TRAINED athletes only
  intermediate: 1.15,    // trained: top of the 5-15% band, same reading GENERAL_RAMP_CEILING takes
  advanced: 1.15,
  advanced_plus: 1.15,
};

/**
 * WKPEAK-2 (2026-08-25) · HOW MANY BUILD WEEKS THE PLAN SPENDS AT ITS PEAK.
 *
 * `volumeCurve` is a pure geometric climb whose factor is
 * `(peak/base)^(1/(climbWeeks-1))`, so it touches the peak on the LAST climbing
 * week and then tapers. One week at the target, at the end, and every other
 * week of the block below it.
 *
 * Research/22 does not describe a build that shape for a marathon. It names a
 * peak PHASE in the phase row and repeats the peak long run in the parameter
 * row, in three places that agree:
 *
 *   · §"Marathon — Beginner"     Phases "… → peak (3 wk) → taper (3 wk)"
 *   · §"Marathon — Intermediate" Peak long run "20-22 mi (2-3 times)"
 *   · §"Marathon — Advanced"     sample peak week is "week 12 of 18" against a
 *                                2-3 week taper — three to four build weeks
 *                                still to come after the peak volume lands
 *
 * The floor common to all three is THREE weeks, and it is the number the
 * beginner row states outright, so that is what this table takes.
 *
 * ZERO IS NOT AN OVERSIGHT. No 5K, 10K or half row in Research/22 names a peak
 * phase — they run "build → sharpen → taper", where the sharpening weeks are
 * deliberately NOT at peak volume. Carrying the marathon's number across to
 * them would be exactly the class `_doctrine_lint`'s "no distance category
 * silently carries another category's value" check exists to catch. The ultra
 * rows do name one ("race-specific peak (4 wk)" · "(4-6 wk)" · "(6 wk)"), and
 * take its floor.
 *
 * WHAT IT ACTUALLY CHANGES. Only the reach: the curve now aims to arrive at the
 * target with this many climbing weeks left, and the existing
 * `Math.min(cappedTarget, peakTarget)` clamp holds it there. Nothing about the
 * climb's safety moves — `GENERAL_RAMP_CEILING` still caps every step, so for
 * an under-based runner whose ideal factor already exceeded the ceiling this is
 * inert (the ceiling governs, and the plan reaches whatever it reaches). It
 * bites only where the runner has the base to arrive early, which is the case
 * doctrine is describing.
 *
 * Cite: Research/22-plan-templates.md §"Marathon — Beginner" — the Phases row's
 *       "peak (3 wk)"
 * Cite: Research/22-plan-templates.md §"Marathon — Intermediate" — "Peak long
 *       run | 20-22 mi (2-3 times)"
 * Bound by PLAN.peak-is-a-phase-not-a-week.
 */
export const PEAK_HOLD_WEEKS: Record<DistCategory, number> = {
  '5k': 0,     // no 5K phase row names a peak phase · build → sharpen → taper
  '10k': 0,    // no 10K phase row names a peak phase · aerobic build → strength → race-specific → taper
  'hm': 0,     // no half phase row names a peak phase · endurance → LT → race-specific → taper
  'm': 3,      // §"Marathon — Beginner" Phases row: "peak (3 wk)"
  'ultra': 4,  // §"50 Mile" Phases row: "race-specific peak (4 wk)" · floor of the ultra rows
};

/** Local mirror of generate.ts's LevelKey · kept here to avoid a circular import. */
export type LevelKeyLite = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;

export function taperFactor(cat: DistCategory, wksLeft: number): number {
  const raceWeek = TAPER_RACE_WEEK_PCT_OF_PEAK[cat];
  const span = 1 - raceWeek;
  const idx = Math.min(Math.max(1, Math.round(wksLeft)), TAPER_DESCENT_SHAPE.length) - 1;
  return Math.round((1 - TAPER_DESCENT_SHAPE[idx] * span) * 100) / 100;
}

/**
 * 2026-06-03 · Rule 12 · maintenance-mode shape per tier.
 *
 * When a runner has no race within the build window (BUILD_WINDOW_WEEKS),
 * the plan enters MAINTENANCE mode · holds aerobic fitness + leg
 * turnover without race-specific stress. Anchored to the runner's
 * recent peak (from the just-completed race-prep block) so the
 * shape is per-runner even though the percentages are doctrine.
 *
 * Frequency holds (Daniels' "use it or lose it" curve · dropping
 * days/wk loses neuromuscular pattern fast). Volume + quality drop.
 * VO2 work is CUT entirely · with no race in window that stress
 * is just damaging.
 *
 * DOCTRINE-BOOK-3 (2026-08-17) · replaces three book citations the gate could
 * not open (Pfitzinger FRR §"Recovery & Off-Season Training", Daniels 3rd ed
 * §"Off-Season Training", Hudson Ch. 7 §"Maintenance Periods"). The volume
 * fraction is genuinely grounded — Research/22 §7 states the minimum effective
 * dose outright — and is now bound by MAINTENANCE.minimum-effective-volume.
 *
 * DOCTRINE-MAINTFREQ-1 (2026-08-17) · which section governs is now decided.
 * The divergence flagged here was 5-7 days against §7 Maintenance's 3-4, held
 * under an exemption. Ruled: §6 Base Building / Off-Season governs, not §7.
 * This mode fires when the runner HAS a goal race and it is simply not near
 * yet — that runner is base-building, not maintaining. Frequency is the first
 * quality lost and the slowest to rebuild, so days hold and volume drops. §7
 * still owns the volume floor, which is why the two claims below split:
 * MAINTENANCE.minimum-effective-volume reads §7, MAINTENANCE.frequency-is-
 * base-building reads §6. The exemption is deleted.
 *
 * Recorded honestly, because the re-point does not fit perfectly: §6's own
 * `Days/week` row is 5-6, so it covers `developing`, `intermediate` and
 * `advanced` outright and does NOT by itself reach `elite`'s 7. That seventh
 * day is grounded in §10 High-Volume Plan ("Days/week | 7"), which Research/22
 * writes for "experienced runners targeting peak performance" — the runner the
 * elite tier describes. The claim reads both rows out of the doc and bounds
 * elite by §10, every other tier by §6.
 *
 * Cite: Research/22-plan-templates.md §"Maintenance Plan" — "~2/3 of training
 *       volume maintains VO2max for ~15 weeks if intensity is preserved"
 * Cite: Research/22-plan-templates.md §"Base Building / Off-Season Plan" — 5-6
 *       days/wk, all-E with strides, one optional steady run just below T
 * Cite: Research/22-plan-templates.md §"High-Volume Plan" — 7 days/wk for
 *       experienced runners targeting peak performance
 * Cite: Research/09-cross-training.md §"Detraining timeline (no training at all)"
 */
export interface MaintenanceShape {
  /** Days running per week · held from race-prep habit. */
  daysPerWeek: number;
  /** Weekly volume as fraction of recent race-prep peak (0-1). */
  weeklyPctOfPeak: number;
  /** Long run as fraction of recent peak long (0-1). */
  longPctOfPeak: number;
  /** Quality sessions per week (always 1 for maintenance · never 2). */
  qualityPerWeek: 0 | 1;
  /** Quality type for maintenance · NO vo2/intervals. */
  qualityType: 'threshold' | 'fartlek' | 'none';
}

export const MAINTENANCE_BY_TIER: Record<GoalTier, MaintenanceShape> = {
  elite:        { daysPerWeek: 7, weeklyPctOfPeak: 0.75, longPctOfPeak: 0.80, qualityPerWeek: 1, qualityType: 'threshold' },
  advanced:     { daysPerWeek: 6, weeklyPctOfPeak: 0.75, longPctOfPeak: 0.80, qualityPerWeek: 1, qualityType: 'threshold' },
  intermediate: { daysPerWeek: 5, weeklyPctOfPeak: 0.70, longPctOfPeak: 0.75, qualityPerWeek: 1, qualityType: 'fartlek' },
  developing:   { daysPerWeek: 5, weeklyPctOfPeak: 0.70, longPctOfPeak: 0.70, qualityPerWeek: 0, qualityType: 'none' },
};

export type PlanMode = 'race-prep' | 'maintenance' | 'recovery';

/**
 * 2026-06-03 · Rule 12 + 13 · pick plan mode based on temporal context.
 *
 * Three modes:
 *   - 'recovery'    · within POST_RACE_RECOVERY_WEEKS of the last race
 *                     finish. Light easy running. Mandatory.
 *   - 'race-prep'   · next race is within BUILD_WINDOW_WEEKS of today.
 *                     Full periodized build (Base/Build/Peak/Taper).
 *   - 'maintenance' · next race is OUTSIDE the build window. Holding
 *                     pattern · 70-80% of peak, 1 quality/wk, no
 *                     race-specific work. Waits for transition.
 *
 * The maintenance-to-race-prep transition fires automatically when
 * today crosses (nextRaceDate − BUILD_WINDOW_WEEKS).
 *
 * DOCTRINE-BOOK-4 (2026-08-17) · was `Pfitzinger FRR §"Block Periodization"`,
 * which the gate could not open. The three-mode machine is the same shape as
 * Research/22 §11's published season table — cycle → recovery → bridge →
 * cycle — with "bridge / base" as this app's maintenance mode.
 *
 * Cite: Research/22-plan-templates.md §"Multi-Race Year Planning"
 * Cite: Research/00a-distance-running-training.md §"Block periodization (Issurin)"
 *       — block sequencing is the default for a year-round racer with
 *       multiple peaks, which is what a mode machine has to serve
 */
export function pickPlanMode(
  todayISO: string,
  nextRaceDateISO: string | null,
  nextRaceDistanceMi: number | null,
  lastRaceFinishedISO: string | null,
  lastRaceDistanceMi: number | null,
  /** DOCTRINE-5 (2026-08-17) · the finished race's A/B/C priority. A B race
   *  earns 60-70% of the A-race recovery duration and a C race 25-50%
   *  (Research/00b §"Recovery by Effort"), so a tune-up no longer parks the
   *  runner in recovery mode for the full table. Absent → treated as A. */
  lastRacePriority?: string | null,
): PlanMode {
  const today = new Date(todayISO + 'T12:00:00Z').getTime();
  // 1. Recovery check · within the (effort-scaled) recovery window of the last race?
  if (lastRaceFinishedISO && lastRaceDistanceMi) {
    const lastCat = distanceCategoryOf(lastRaceDistanceMi);
    const recoveryEnd = new Date(lastRaceFinishedISO + 'T12:00:00Z').getTime()
      + postRaceRecoveryWeeks(lastCat, lastRacePriority) * 7 * 86400000;
    if (today < recoveryEnd) return 'recovery';
  }
  // 2. No next race · maintenance by default
  if (!nextRaceDateISO || !nextRaceDistanceMi) return 'maintenance';
  // 3. Race-prep when next race is within build window (or < 1 full maintenance week outside it)
  // MAINT-SKIP-1 (2026-06-24): when weeksOut - buildWindow < 1 (floors to 0), there is
  // less than one full maintenance week available before race-prep should start. Showing
  // a fractional-week maintenance block is misleading and wastes onboarding attention —
  // route to race-prep instead and let the composer fit the plan to the actual race date.
  const nextCat = distanceCategoryOf(nextRaceDistanceMi);
  const buildWindowWeeks = BUILD_WINDOW_WEEKS[nextCat];
  const raceMs = new Date(nextRaceDateISO + 'T12:00:00Z').getTime();
  const weeksOut = (raceMs - today) / (7 * 86400000);
  const maintWeeks = Math.floor(weeksOut - buildWindowWeeks);
  if (weeksOut > 0 && maintWeeks <= 0) return 'race-prep';
  // 4. Too far out · maintenance until build window opens
  return 'maintenance';
}

/**
 * The first day `pickPlanMode` would answer 'race-prep' for this race, asked
 * of the function itself rather than re-derived from `BUILD_WINDOW_WEEKS`.
 *
 * `pickPlanMode` does not open the window at exactly `race − buildWindow`:
 * MAINT-SKIP-1 pulls it forward whenever fewer than one whole maintenance week
 * would remain. A date computed off the constant would be right most of the
 * time and wrong at the seam, which is the one week a runner would be looking
 * at it. Null when the race is already inside the window (so the caller says
 * nothing rather than naming a date in the past) or when it never opens.
 */
export function buildOpensISO(
  todayISO: string,
  raceDateISO: string,
  raceDistanceMi: number,
): string | null {
  if (pickPlanMode(todayISO, raceDateISO, raceDistanceMi, null, null) === 'race-prep') return null;
  const day = (n: number) =>
    new Date(Date.parse(todayISO + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  for (let n = 1; n <= 400; n++) {
    const d = day(n);
    if (d > raceDateISO) return null;
    if (pickPlanMode(d, raceDateISO, raceDistanceMi, null, null) === 'race-prep') return d;
  }
  return null;
}

export interface TierTarget {
  /** Peak weekly volume target [min, max] in miles. From Research/22. */
  peakWeeklyMileageBand: [number, number];
  /** Peak long run target [min, max] in miles. From Research/22. */
  peakLongMiBand: [number, number];
  /** Quality sessions per week during build/race-specific phase. */
  qualityPerWeek: number;
  /** Long-run share of weekly volume. */
  longRunShare: number;
  /** Days/week running (rest days = 7 - this). */
  daysPerWeek: number;
  /**
   * MLR-1 (2026-08-25) · the week's MEDIUM-LONG run at peak, in miles. Null
   * where doctrine names none for this distance and tier.
   *
   * `Research/00a` §"3. Medium-long run" gives the session its own row in the
   * seven workout categories — "Purpose | Aerobic strength under fatigue
   * without long-run cost", "Frequency | 1×/wk in marathon and half cycles;
   * optional in 5K/10K" — and `Research/22` names it in the Key-workout-types
   * row of the marathon and half plans and lays one out in their sample peak
   * weeks. The engine had none, anywhere. `layoutWeek` split the week's
   * non-long, non-quality budget EQUALLY across the easy days, so a 61.5-mile
   * advanced-marathon week came out as a 20-mile long plus three identical
   * 8-mile easy days. Raising the volume without this makes the week bigger and
   * not more like the week doctrine publishes: the same runs, padded.
   *
   * READ ROW BY ROW, INCLUDING THE NULLS.
   *   · m/advanced 17, m/elite 17 — §"Marathon — Advanced" "MLR (13-17 mi)".
   *   · m/intermediate 15 — §"Marathon — Intermediate" "MLR (11-15 mi)".
   *   · hm/advanced 14, hm/elite 14 — §"Half Marathon — Advanced" names "MLR
   *     with HMP-MP segments" and its sample peak week lays out "13 mi MLR".
   *     The half's parameter row publishes no band, so the ceiling is the top
   *     of `00a` §3's own "8-14 mi typical", which the sample sits inside.
   *   · hm/intermediate null, DESPITE the row naming "MLR with M segments".
   *     Doctrine is ambiguous here and its own published week settles it: the
   *     HM-Intermediate sample peak week's mid-week run is "6 mi GA", below
   *     `MLR_MIN_MI`. A 6-mile run is a general-aerobic day, not a medium-long
   *     run, and the engine already authors that.
   *   · every beginner/developing row null — none of them names an MLR, and
   *     `00a` §3's frequency row does not reach them.
   *   · 5k and 10k null at every tier — `00a` §3 says "optional in 5K/10K" and
   *     no Research/22 5K or 10K row names one. Optional is not prescribed.
   *   · ultra null — its rows replace the MLR with back-to-back weekend long
   *     runs, which is a different session with a different purpose, and
   *     ULTRA-OUT-1 refuses ultra authorship regardless.
   *
   * The number is a CEILING reached at the block's peak week, not a weekly
   * dose: `layoutWeek` ramps it with the volume curve exactly as it ramps the
   * long run, and `MLR_MAX_WEEK_SHARE` holds it to the share doctrine's own
   * sample weeks spend on it.
   *
   * Bound by PLAN.medium-long-run.
   */
  mlrPeakMi: number | null;
}

/**
 * MLR-1 · the largest share of a week doctrine's own sample peak weeks give the
 * medium-long run. Derived, not chosen: the three Research/22 plans that lay
 * one out publish both the MLR and the week it sits in —
 *
 *   §"Marathon — Advanced"      15 mi MLR · "~70 mpw"  = 21.4%
 *   §"Marathon — Intermediate"  11 mi MLR · "~55 mpw"  = 20.0%
 *   §"Half Marathon — Advanced" 13 mi MLR · "~63 mpw"  = 20.6%
 *
 * — and this is the floor of the three, the conservative end of the only
 * figures doctrine reports. It is what stops `mlrPeakMi` from being spent in a
 * week too small to hold it: a runner peaking at 45 mi/wk does not get the
 * 17-mile MLR of a runner peaking at 76, they get 20% of their own week.
 *
 * Cite: Research/22-plan-templates.md §"Marathon — Advanced" (sample peak week)
 * Bound by PLAN.medium-long-run.
 */
export const MLR_MAX_WEEK_SHARE = 0.20;

/**
 * MLR-1 · below this a medium-long run is not one.
 *
 * Research/00a §"3. Medium-long run" states the session's own duration:
 * "75-110 min (12-20 km / 8-14 mi typical)". Eight miles is the floor of that
 * band, and a week that cannot afford eight miles in one run without starving
 * the rest simply does not get an MLR — the engine authors the easy days it
 * already authored. That refusal is what keeps every low-volume plan
 * byte-identical, and it is why `hm/intermediate` needs no special case: its
 * own doctrine week's mid-week run is six miles and would fail this floor.
 *
 * Cite: Research/00a-distance-running-training.md §"3. Medium-long run"
 * Bound by PLAN.medium-long-run.
 */
export const MLR_MIN_MI = 8;

/**
 * Doctrine table · sourced row-by-row from Research/22-plan-templates.md.
 * Each row maps (race distance, goal tier) → training-shape parameters.
 *
 * If a row needs to change, update Research/22 FIRST, then this table.
 * The bench (generator-bench.test.ts) asserts plans match these bands ·
 * any plan-engine commit that breaks the assertions will fail CI.
 *
 * Tier ↔ Research/22 row: developing = "Beginner", intermediate =
 * "Intermediate", advanced = "Advanced". `elite` has NO doctrine row — it is
 * the engine's extrapolation above Advanced and is deliberately left alone.
 *
 * ── DOCTRINE-8 (2026-08-17) · THE BAND SWEEP ─────────────────────────────────
 *
 * `volumeCurve` targets `peakWeeklyMileageBand[0]`, so a band floor set below
 * the doctrine row is not a conservative choice — it is the number the plan is
 * BUILT to. A sub-3 marathoner (m/advanced) was built to 55 mi/wk against
 * Research/22 §"Marathon — Advanced" 65-90, and their peak long capped at 22
 * where the row says 22-24 — the band top sitting exactly on doctrine's floor.
 *
 * That is the same shape XTIER-1 fixed for 10K-advanced in June and did not
 * sweep, which is the audit's "partial fix, class not swept" pattern. Swept
 * here across every row that had it:
 *
 *   5k/advanced    weekly [35,50] → [40,70]   (§"5K — Advanced" 40-70)
 *   10k/advanced   weekly [40,55] → [50,75]   (§"10K — Advanced" 50-75)
 *   m/intermediate weekly [40,55] → [45,55]   (§"Marathon — Intermediate" 45-55)
 *                  long   [18,20] → [20,22]   (same row, "20-22 mi")
 *   m/advanced     weekly [55,75] → [65,90]   (§"Marathon — Advanced" 65-90)
 *                  long   [20,22] → [22,24]   (same row, "22-24 mi")
 *
 * Rows already matching their doctrine row, and rows sitting ABOVE it (the
 * developing bands, which track Research/00a's wider recreational range rather
 * than 22's finish-focused beginner plans), are untouched.
 *
 * ── DOCTRINE-8b (2026-08-17) · LONG-RUN SHARE, RULED ─────────────────────────
 *
 * Two doctrine sources disagree, and the engine matched neither:
 *
 *   · Research/00a §"Volume progression rules" caps the long at "≤25-30% of
 *     weekly volume (or by absolute time: <3.0-3.5 h for marathoners)".
 *   · Research/22's own sample peak weeks run far above that at the low-volume
 *     end — Marathon-Beginner is a 20-mile long inside a 37-mile week (54%),
 *     Marathon-Intermediate 20 of 58 (34.5%) — and settle into 00a's band as
 *     volume rises: Marathon-Advanced 22 of 76 (29%), HM-Advanced 16 of 63 (25%).
 *
 * OWNER RULING (David, 2026-08-17): the share is tier- and distance-dependent.
 * "A marathon beginner's long run legitimately IS a bigger share of a small
 * week; a 70-mpw runner's isn't." So the shares below are read off Research/22's
 * ACTUAL sample weeks rather than invented, 00a's 25-30% governs the
 * higher-volume tiers where the sample plans already agree with it, and the
 * real safety bound for the low-volume/slow-runner case is the ABSOLUTE-TIME
 * cap from 00a's own parenthetical — implemented as DOCTRINE-3 in
 * generate.ts (`LONG_RUN_MAX_HOURS`), which is what stops a 54%-of-week long
 * from becoming a four-hour run for someone training at 13:00/mi.
 *
 * Derivation, sample week where Research/22 prints one, band midpoints
 * otherwise (peakLong mid ÷ peakWeekly mid):
 *
 *   5K   Beg 3.75/13.5 = .28 · Int 6.5/27.5 = .24 · Adv 10/55   = .18
 *   10K  Beg 6.5/20    = .33 · Int 9.5/35   = .27 · Adv 14/62.5 = .22
 *   HM   Beg 11/25     = .44 · Int 13/40    = .33 · Adv 16/63   = .25 (sample)
 *   M    Beg 20/37     = .54 (sample) · Int 20/58 = .35 (sample) · Adv 22/76 = .29 (sample)
 *
 * Ultra keeps its existing shares: its rows map to race DISTANCES (50K, 50mi,
 * 100K, 100mi) rather than experience tiers, and the back-to-back long-run
 * option makes a single-run share non-comparable. (ULTRA-OUT-1, 2026-08-19:
 * that mismatch is now why ultra authorship is refused outright — see
 * supported-distances.ts. These rows stay so re-opening it is a change to one
 * gate rather than an excavation.)
 *
 * ── TIERDAYS-1 (2026-08-19) · 5K and 10K ADVANCED: daysPerWeek 5 → 6 ───────
 *
 * Both said 5. Research/22 §"5K — Advanced" and §"10K — Advanced" both publish
 * "6-7" in the Days/week row, and both sample peak weeks lay out SEVEN running
 * days with no rest day at all. The engine was two days under doctrine on the
 * only two rows where it was, recorded as exemptions on
 * PLAN.tier-days-per-week; those exemptions are now deleted.
 *
 * 6, not 7 — the floor of the published band, matching how every other
 * doctrine band in this engine is read (GENERAL_RAMP_CEILING takes the novice
 * floor, the deload takes the floor of 20-30%). The sample weeks argue for 7;
 * the header argues for 6-7; the conservative reading that satisfies both is 6.
 *
 * WHAT IT CHANGES IN A RUNNER'S WEEK: NOTHING, AND THAT IS THE POINT.
 * `TIER_TARGETS.daysPerWeek` has exactly one reader outside the doctrine gate —
 * the all-user sweep's WK-FREQ-1 volume scaling. The composer takes its day
 * count from `MAINTENANCE_BY_TIER`'s shape, overridden by the runner's stated
 * `weekly_frequency`, so this field never reached a prescribed week. Measured
 * across all 48 advanced 5K/10K archetypes (f3-f6 × three mileage buckets ×
 * two experience levels), peak weekly volume and peak-week run days are
 * IDENTICAL before and after, and no archetype crosses the WK_UNDERREACH line
 * under either value.
 *
 * WHICH DIRECTION IT MOVES THE GATE: softer, and correctly so. The sweep grades
 * a plan's volume against `band[0] × min(1, runDays / daysPerWeek)`, so raising
 * the denominator lowers the floor for any plan running fewer days. That is
 * WK-FREQ-1's own rule landing rather than being weakened: doctrine's 40-70 mi
 * is published FOR a 6-7 day week, and holding a 5-day plan to a 6-day plan's
 * full volume asks a 5K runner for six days of miles in five sessions.
 *
 * The 5K and 10K `elite` rows are left at 6, which now equals `advanced`.
 * Research/22 publishes no elite row for either distance, so raising them would
 * be invention; the elite tiers are separated from advanced by volume (55-80 vs
 * 40-70, 65-90 vs 50-75), which is how doubles show up in a day count that
 * cannot exceed seven.
 */
export const TIER_TARGETS: Record<DistCategory, Record<GoalTier, TierTarget>> = {
  '5k': {
    elite:        { peakWeeklyMileageBand: [55, 80], peakLongMiBand: [10, 14], qualityPerWeek: 3, longRunShare: 0.18, daysPerWeek: 6, mlrPeakMi: null },
    advanced:     { peakWeeklyMileageBand: [40, 70], peakLongMiBand: [8, 12],  qualityPerWeek: 3, longRunShare: 0.18, daysPerWeek: 6, mlrPeakMi: null }, // DOCTRINE-8 · Research/22 §"5K — Advanced" 40-70 mpw (was [35,50], floor below the row) · TIERDAYS-1 (2026-08-19) · daysPerWeek 5 → 6, see the note above TIER_TARGETS · VARIETY-R3-1 (2026-08-28) · qualityPerWeek 2 → 3: the row's own sample week (Phase III, week 4) runs THREE structured sessions — "6×1000 m @ I", "4×1 mi @ T", "WU + 8×400 m @ R" — and its Key-workout column names "R reps (200-400 m)". The 2 was the answer key disagreeing with the doc's own week; the composer's third-day gate (R3_MIN_TRAINING_DAYS) reads this count.
    intermediate: { peakWeeklyMileageBand: [25, 35], peakLongMiBand: [6, 8],   qualityPerWeek: 2, longRunShare: 0.24, daysPerWeek: 4, mlrPeakMi: null },
    developing:   { peakWeeklyMileageBand: [16, 24], peakLongMiBand: [3.5, 5], qualityPerWeek: 1, longRunShare: 0.28, daysPerWeek: 3, mlrPeakMi: null },
  },
  '10k': {
    elite:        { peakWeeklyMileageBand: [65, 90], peakLongMiBand: [13, 17], qualityPerWeek: 3, longRunShare: 0.20, daysPerWeek: 6, mlrPeakMi: null },
    advanced:     { peakWeeklyMileageBand: [50, 75], peakLongMiBand: [13, 15], qualityPerWeek: 3, longRunShare: 0.22, daysPerWeek: 6, mlrPeakMi: null }, // VARIETY-R3-1 (2026-08-28) · qualityPerWeek 2 → 3: §"10K — Advanced"'s sample week (race-specific, week 11) runs "5×1600 m @ 10K pace", "4×1 mi @ T" AND "WU + 10×400 m @ R" · TIERDAYS-1 (2026-08-19) · daysPerWeek 5 → 6, see the note above TIER_TARGETS · DOCTRINE-8 · Research/22 §"10K — Advanced" 50-75 mpw (was [40,55]) · XTIER-1 (2026-06-23) · was [10,13] — Research/22:144 10K-Advanced peak long is 13-15mi; the old top sat at research's FLOOR (RC2-2 then drives it into band, clamped ≤30%/week)
    intermediate: { peakWeeklyMileageBand: [30, 42], peakLongMiBand: [9, 12],  qualityPerWeek: 2, longRunShare: 0.27, daysPerWeek: 5, mlrPeakMi: null },
    developing:   { peakWeeklyMileageBand: [22, 30], peakLongMiBand: [6, 8],   qualityPerWeek: 1, longRunShare: 0.33, daysPerWeek: 4, mlrPeakMi: null },
  },
  'hm': {
    // Research/22 §"Half Marathon — Advanced" · sub-1:30, 45+ mpw base
    // Sample peak week shows 16mi LR / 63mi weekly = 0.254 long share.
    elite:        { peakWeeklyMileageBand: [70, 100], peakLongMiBand: [16, 20], qualityPerWeek: 3, longRunShare: 0.25, daysPerWeek: 7, mlrPeakMi: 14 },
    advanced:     { peakWeeklyMileageBand: [55, 85],  peakLongMiBand: [15, 17], qualityPerWeek: 2, longRunShare: 0.25, daysPerWeek: 6, mlrPeakMi: 14 },
    // Research/22 §"Half Marathon — Intermediate" · sub-2:00, 25-35 mpw base
    intermediate: { peakWeeklyMileageBand: [35, 45],  peakLongMiBand: [12, 14], qualityPerWeek: 2, longRunShare: 0.33, daysPerWeek: 5, mlrPeakMi: null },
    developing:   { peakWeeklyMileageBand: [25, 35],  peakLongMiBand: [9, 12],  qualityPerWeek: 1, longRunShare: 0.44, daysPerWeek: 4, mlrPeakMi: null },
  },
  'm': {
    // Research/22 §"Marathon — Advanced" · sub-3, 60+ mpw base
    elite:        { peakWeeklyMileageBand: [70, 100], peakLongMiBand: [22, 25], qualityPerWeek: 3, longRunShare: 0.28, daysPerWeek: 7, mlrPeakMi: 17 },
    advanced:     { peakWeeklyMileageBand: [65, 90],  peakLongMiBand: [22, 24], qualityPerWeek: 2, longRunShare: 0.29, daysPerWeek: 6, mlrPeakMi: 17 }, // DOCTRINE-8 · Research/22 §"Marathon — Advanced" 65-90 mpw / 22-24 mi long (was [55,75]/[20,22])
    intermediate: { peakWeeklyMileageBand: [45, 55],  peakLongMiBand: [20, 22], qualityPerWeek: 2, longRunShare: 0.35, daysPerWeek: 5, mlrPeakMi: 15 }, // DOCTRINE-8 · Research/22 §"Marathon — Intermediate" 45-55 mpw / 20-22 mi long (was [40,55]/[18,20])
    developing:   { peakWeeklyMileageBand: [30, 45],  peakLongMiBand: [16, 20], qualityPerWeek: 1, longRunShare: 0.54, daysPerWeek: 5, mlrPeakMi: null }, // DOCTRINE-8b · Research/22 §"Marathon — Beginner" sample peak week: 20mi long in a 37mi week
  },
  'ultra': {
    // Research/22 §"Ultramarathon" · peak long 22-32 mi or 5-7 hr
    // time-on-feet · 70-100 mpw advanced · B2B long-run option.
    elite:        { peakWeeklyMileageBand: [85, 120], peakLongMiBand: [28, 32], qualityPerWeek: 1, longRunShare: 0.30, daysPerWeek: 6, mlrPeakMi: null },
    advanced:     { peakWeeklyMileageBand: [65, 100], peakLongMiBand: [24, 28], qualityPerWeek: 1, longRunShare: 0.30, daysPerWeek: 6, mlrPeakMi: null },
    intermediate: { peakWeeklyMileageBand: [50, 75],  peakLongMiBand: [20, 24], qualityPerWeek: 1, longRunShare: 0.32, daysPerWeek: 5, mlrPeakMi: null },
    developing:   { peakWeeklyMileageBand: [35, 55],  peakLongMiBand: [16, 20], qualityPerWeek: 1, longRunShare: 0.35, daysPerWeek: 5, mlrPeakMi: null },
  },
};

/**
 * Map a goal pace + race distance to the appropriate tier.
 *
 * Thresholds chosen to match Research/22's named cohorts:
 *   · HM advanced ≈ sub-1:30 (6:52/mi) · advanced threshold = 7:00/mi
 *   · HM intermediate ≈ sub-2:00 (9:09/mi) · intermediate threshold = 9:15/mi
 *   · M advanced ≈ sub-3 (6:52/mi) · advanced threshold = 7:00/mi
 *   · 5K advanced ≈ sub-18 (5:48/mi) · advanced threshold = 6:00/mi
 *
 * Falls back to 'intermediate' when goalPaceSec is null (no goal time
 * set yet · plan still needs a tier to build against).
 */
/** Runner experience level for tier clamping · mirrors generate.ts LevelKey, kept local to avoid a circular import. */
export type ExperienceLevelInput = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null | undefined;

const TIER_ORD: Record<GoalTier, number> = { developing: 0, intermediate: 1, advanced: 2, elite: 3 };

/**
 * The pace→tier table itself, with no experience clamp applied. Extracted so the
 * SAME thresholds grade a GOAL pace (ambition) and a DEMONSTRATED pace (capacity)
 * — the clamp below compares the two, and a comparison across two different
 * tables would be meaningless.
 */
function tierFromPace(paceSec: number, cat: DistCategory): GoalTier {
  switch (cat) {
    case '5k': // sub-17:00 elite · sub-18:30 advanced · sub-24:30 intermediate
      return paceSec <= 330 ? 'elite' : paceSec <= 360 ? 'advanced' : paceSec <= 480 ? 'intermediate' : 'developing';
    case '10k': // sub-35:40 elite · sub-40:24 advanced · sub-52:48 intermediate
      return paceSec <= 345 ? 'elite' : paceSec <= 390 ? 'advanced' : paceSec <= 510 ? 'intermediate' : 'developing';
    case 'hm': // sub-1:18:35 elite · sub-1:31:42 advanced (covers 1:30) · sub-2:01:12 intermediate
      return paceSec <= 360 ? 'elite' : paceSec <= 420 ? 'advanced' : paceSec <= 555 ? 'intermediate' : 'developing';
    case 'm': // sub-2:37:12 elite · sub-3:03:24 advanced (covers sub-3) · sub-4:02:24 intermediate
      return paceSec <= 360 ? 'elite' : paceSec <= 420 ? 'advanced' : paceSec <= 555 ? 'intermediate' : 'developing';
    case 'ultra': // ~30s/mi slower bands than marathon
      return paceSec <= 420 ? 'elite' : paceSec <= 480 ? 'advanced' : paceSec <= 600 ? 'intermediate' : 'developing';
  }
}

/**
 * COLD-1 (2026-08-17) · the tier ceiling an UNSTATED experience level earns.
 *
 * `profile.experience_level` is NULL for real production accounts, and the
 * clamp below used to pass NULL straight through — so a goal TIME somebody
 * typed picked the tier by itself. A marathon goal at 6:40/mi off an account
 * with zero runs classified `advanced`: peak band 65-90 mi/wk, 22-24 mi long
 * runs, ramped from a self-reported 30 mi/wk over 13 weeks. Nothing in that
 * chain was demonstrated.
 *
 * `intermediate` was unclamped for the same reason and could reach `elite`.
 *
 * Per Design/adaptive-progression-engine.md ("Fitness must be demonstrated")
 * an unstated level is unknown capacity, not permission. It is capped here,
 * and lifted only by `demonstratedPaceSec` — an equivalent race pace the
 * caller derived from a MEASURED VDOT (races / qualifying runs), never from
 * mileage self-report or from the goal.
 */
const UNSTATED_LEVEL_TIER_CEILING: GoalTier = 'intermediate';
/** An explicitly-intermediate runner has a stated base, but not an elite one. */
const INTERMEDIATE_LEVEL_TIER_CEILING: GoalTier = 'advanced';

export function classifyGoalTier(
  goalPaceSec: number | null | undefined,
  raceDistanceMi: number,
  level?: ExperienceLevelInput,
  /**
   * COLD-1 · the runner's DEMONSTRATED equivalent race pace at this distance
   * (s/mi), predicted from a measured VDOT by the caller. Lifts the
   * unstated-level ceiling to whatever the evidence itself grades at — and
   * nothing further. Omit (or pass null) when no measured fitness exists;
   * the ceiling then holds, which is the cold-start case.
   */
  demonstratedPaceSec?: number | null,
): GoalTier {
  // VAR-01 · experience CLAMPS the pace-derived tier. Research/22 has distinct per-experience
  // templates (5K Beginner 12-15mi/3day vs Advanced 40-70mi/6-7day; M Beginner 30-35mi/20-long vs
  // Advanced 65-90mi/22-24-long). The tier reflects training CAPACITY (experience), not only goal
  // AMBITION (pace): an advanced runner with a soft goal still has the base for advanced volume; a
  // beginner with an aggressive goal can't absorb advanced bands.
  const cat = distanceCategoryOf(raceDistanceMi);

  // COLD-1 · the ceiling an unstated level earns, possibly lifted by evidence.
  const demonstratedTier =
    demonstratedPaceSec != null && Number.isFinite(demonstratedPaceSec) && demonstratedPaceSec > 0
      ? tierFromPace(demonstratedPaceSec, cat)
      : null;
  const unstatedCeiling: GoalTier =
    demonstratedTier != null && TIER_ORD[demonstratedTier] > TIER_ORD[UNSTATED_LEVEL_TIER_CEILING]
      ? demonstratedTier
      : UNSTATED_LEVEL_TIER_CEILING;

  if (goalPaceSec == null || !Number.isFinite(goalPaceSec) || goalPaceSec <= 0) {
    // No goal yet → default off experience, not a hardcoded 'intermediate'.
    return level === 'beginner' ? 'developing'
      : (level === 'advanced' || level === 'advanced_plus') ? 'advanced'
      : unstatedCeiling === 'intermediate' ? 'intermediate' : unstatedCeiling;
  }
  const tier = tierFromPace(goalPaceSec, cat);
  // Clamp to experience capacity: advanced(+) never below advanced, beginner never above intermediate.
  if (level === 'advanced' || level === 'advanced_plus') return TIER_ORD[tier] < TIER_ORD.advanced ? 'advanced' : tier;
  if (level === 'beginner') return TIER_ORD[tier] > TIER_ORD.intermediate ? 'intermediate' : tier;
  // COLD-1 · the two rungs that used to fall through unclamped.
  if (level === 'intermediate') {
    return TIER_ORD[tier] > TIER_ORD[INTERMEDIATE_LEVEL_TIER_CEILING] ? INTERMEDIATE_LEVEL_TIER_CEILING : tier;
  }
  return TIER_ORD[tier] > TIER_ORD[unstatedCeiling] ? unstatedCeiling : tier;
}

/**
 * @deprecated Use `distanceCategoryOrNull` from lib/race/distance-category.ts.
 *
 * 2026-08-18 · thin wrapper over THE categorizer, kept because ~40 call sites
 * (including lib/plan/generate.ts and lib/plan/validate.ts, owned by other
 * work in flight) import this name. Behaviour for a real distance is now
 * identical to every other surface in the app.
 *
 * The one behaviour that intentionally changed: a missing / zero / non-finite
 * distance used to return '5k' silently, which is how a legacy race row with
 * no numeric distance got a marathoner a 10-week build window instead of 18.
 * It now throws. Every call site inside this repo either guards `> 0` first or
 * resolves the distance through `distanceCategoryOrNull` and handles the null.
 */
export function distanceCategoryOf(raceDistanceMi: number): DistCategory {
  return distanceCategoryOrThrow(raceDistanceMi);
}

/**
 * Convenience · lookup the tier-target for a (goal pace, race distance)
 * pair. Returns the full TierTarget struct.
 */
export function lookupTierTarget(
  goalPaceSec: number | null | undefined,
  raceDistanceMi: number,
  level?: ExperienceLevelInput,
  /** COLD-1 · demonstrated equivalent race pace (s/mi) from a MEASURED VDOT. */
  demonstratedPaceSec?: number | null,
): { tier: GoalTier; target: TierTarget } {
  const tier = classifyGoalTier(goalPaceSec, raceDistanceMi, level, demonstratedPaceSec);
  const cat = distanceCategoryOf(raceDistanceMi);
  return { tier, target: TIER_TARGETS[cat][tier] };
}
