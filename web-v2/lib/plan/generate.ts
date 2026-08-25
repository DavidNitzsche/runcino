/**
 * plan/generate.ts — algorithmic plan generation (v1).
 *
 * Why algorithmic (not LLM-driven): plan STRUCTURE is deterministic
 * doctrine — block periodization is rules. We reserve the LLM for
 * voice/rationale around the structure, never for the structure itself.
 *
 * Every structural rule below cites the canonical research file at
 * `/Research/`. If a rule is added without a citation, that's a bug —
 * see CLAUDE.md "Engine must match research".
 *
 * Block model (Daniels-style, simplified for v1):
 *   - Race week:    deep taper, race day
 *   - Sharpen:      1-2 wks @ 70-80% peak, strides, short tune-up
 *   - Race-specific:2-3 wks @ peak vol, marathon-pace + threshold
 *   - Quality:      4-6 wks ramping, intervals + threshold
 *   - Base:         everything before, easy aerobic + long
 *
 *   Cite: Research/00a-distance-running-training.md §periodization
 *   Cite: Research/04-workout-vocabulary.md §5-Threshold §6-VO2max  // was §quality-types · headings: ## 5. Threshold workouts · ## 6. VO2max workouts
 *   Cite: Research/08-pacing-and-race-week.md §taper
 */
import { pool } from '@/lib/db/pool';
import { logReadFailure, rowOrNull } from '@/lib/db/read';
import type { PoolClient } from 'pg';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { randomBytes } from 'crypto';
import { loadSettings } from '@/lib/coach/settings';
import { pickWorkout, type WorkoutFamily } from './workout-library';
import { buildWorkoutSpec, conservativeVdotFromMileage, marathonPaceSPerMi, tPaceFromGoal, totalDistanceMiFromSpec, capSpecToDistance, STRIDE_DAYS_PER_WEEK, STRIDE_DEFAULT_REPS, STRIDE_DURATION_S } from './spec-builder';
import { subLabelFromSpec } from '@/lib/training/expand-spec';
import { parseRaceTime, tPaceFromVdot, vdotFromTpace, iPaceFromVdot, iPaceFromAnchorPace, vdotFromRace, predictRaceTime, bestRecentVdot as computeBestRecentVdot, resolveCurrentTPace, clampToSanePace, type BelowTableAnchor } from '@/lib/training/vdot';
// 2026-06-03 · Rule 16 · canonical max-HR reader · resolves
// users.max_hr_override → hybrid 12-mo observed → users.max_hr → null.
// profile.max_hr is NOT the source of truth per task #141.
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { loadVdotInputs, goalRunFloorMiForUser } from '@/lib/training/vdot-inputs';
import { bestVdotFromRaceHistory } from '@/lib/training/race-history';
import { lookupTierTarget, type TierTarget, type GoalTier, pickPlanMode, MAINTENANCE_BY_TIER, POST_RACE_RECOVERY_WEEKS, postRaceRecoveryWeeks, RECOVERY_WEEKLY_PCT_OF_BASE, RECOVERY_RUN_DAYS, RECOVERY_LONG_PCT, recoveryBlockCeilingPct, BUILD_WINDOW_WEEKS, type PlanMode, type DistCategory, taperFactor, GENERAL_RAMP_CEILING, COMEBACK_RAMP_CEILING } from './goal-tiers';
import {
  type AnchorSource, isProvisionalAnchor, isUnverifiedAnchor, paceBlendAnchorIsProvisional,
  CALIBRATION_INTRO_WEEKS, EFFORT_CUED_TYPES,
} from './anchor-provenance';
import { isBaseBuildingPlan } from './plan-templates';
import { ULTRA_UNSUPPORTED_REASON, planAuthorshipUnsupported } from './supported-distances';
import { isCoachedExternally, COACHED_SKIP_REASON } from './coached-gate';
import { distanceMiOfMeta } from '@/lib/race/distance'; // 2026-07-07 · ultra-honesty audit · shared label→mi parser (handles 50K/50M/100K/100M)
import { snapshotSealedDays, logSealSkip, type SealedPrescription } from './seal';
// 2026-08-17 · coaching-loop reconciliation · shared blend implementation
// (authoring + adaptation-time recompute run the same math).
import { blendedTPaceForWeek, measuredProgressFraction } from './recompute-paces';
// PROGRESSION-1 (2026-08-17) · the authored default overload trajectory.
// `Design/adaptive-progression-engine.md` §3's "calendar proposes" half: the
// plan carries a lever-driven trajectory so a block progresses by duration,
// density and rep count at constant effort. The "evidence permits" half runs
// after the runner has run something and is not authored here.
import { MIN_QUALITY_REP_MINUTES, OverloadTrajectory, type SessionFamily } from '@/lib/prescription/trajectory';
import type { ChallengeZone, ProgressionLever, WorkShape } from '@/lib/prescription/levers';
import { atPaceSessionCapMi, CONTINUOUS_TEMPO_MINUTES, totalWorkMinutes } from '@/lib/prescription/levers';
// DAY-SIZE-1 (2026-08-17) · a quality day is warm-up + at-pace work + floats +
// cool-down. The module header carries the category error this replaced.
import { composeQualityDay, floatMi as jogFloatMi, maxQualityDayMi, type QualityFamily } from './quality-day';
import { dropLastSegment, keepFirstSegment, parsePrescription, parseSegments, parseTempoShape, parseTimeReps, segmentMi } from './prescription-parser';
// PROGRESSION-PERSIST-1 (2026-08-17) · the trajectory's decision, carried into
// `plan_workouts.workout_spec` so the adaptation model can hold or modify a
// stimulus it can actually see.
import { progressionSpecFields } from './progression-spec';
import { validateComposedPlan } from './validate';
import { mutatePlan, snapshotPrescription, snapshotActivePrescription } from './mutate';
// 2026-08-25 · the commit gate + the "what moved" line. See lib/plan/plan-delta.ts.
import {
  computeDelta, samePrescription, prescriptionFingerprint, fingerprintDigest,
  type PlanPrescription, type PlanDelta,
} from './plan-delta';
import { EASY_SHARE_FLOOR, weekIntensity, splitDay } from './intensity-distribution';
// DOCTRINE-DOSING-2 · the composer sizes to the SAME doctrine the gate checks.
// Importing the budget from the module that measures the breach is what makes
// the two unable to disagree — see that file's header.
import {
  DOSE_PACES, slotDosePace, slotDoseBudgetMi, weeklyDoseBudgetMi,
  dayDoses, weekDosingFindings, duplicatePaceFamily,
  type DosePace, type DosingContext,
} from './dosing';
// VOCAB-CATALOGUE-1 (2026-08-18) · the workout vocabulary, wired.
// `Research/04-workout-vocabulary.md`'s 59 named workouts live in
// `lib/workout-catalogue/` as cited data, and §15's placement table plus §16's
// combinations-to-avoid live there as a selection algorithm. Nothing read
// either of them until this import: the composer looked up ONE hardcoded string
// per (family, distance), so every hills slot in every week of every plan read
// the same fifteen words. `catalogue-rx.ts` is the door — see its header for
// the anchors the composer can honestly supply and the shapes the engine's
// prescription grammar cannot yet express.
import {
  anchorsFor,
  newCatalogueHistory, recordCatalogueChoice, selectSlotWorkout,
  type CatalogueHistory, type ComposerSlot,
} from './catalogue-rx';
import type { PlacedSession } from '@/lib/workout-catalogue/select';
import type { Tier } from '@/lib/workout-catalogue/types';
// #12 follow-up (2026-08-18) · THE race-distance categorizer. generate.ts kept
// four more inline mileage branches after the goal-tiers re-export landed, and
// they had drifted from it — `>= 31` against the canonical 31.07 ultra floor,
// `>= 20` against 19.65, a `>= 12` with no canonical equivalent at all, and a
// `< 7` against 7.75. A race whose distance is unknown returns null here and
// the caller refuses rather than silently becoming a half marathon.
import {
  distanceCategoryOrNull, UNKNOWN_DISTANCE_REASON,
} from '@/lib/race/distance-category';

export type DOW = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sun=0..Sat=6
export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const dayKeyToDow = (k: DayKey): DOW => DAY_KEYS.indexOf(k) as DOW;

/**
 * 2026-06-23 · A1/A2 (SCHED-01/02) · derive quality days from a runner's
 * available_days, spaced off the long run. Drops any available day within 1 of the
 * long (a hard session must never sit back-to-back with the long), then greedily
 * orders the rest to maximize spacing from {long + already-chosen} so the downstream
 * frequency slice takes a well-separated 1 or 2. A 2-adjacent-available-day runner
 * (e.g. Sat/Sun) yields ZERO quality → the week folds to long + easy (the only
 * doctrinally-safe option · Research/00a:754, 48h between hard sessions). Replaces the
 * old proximity-to-Wednesday sort, which was blind to the long and put quality
 * back-to-back with it for weekend-only runners.
 */
export function spacedQualityDowsFromAvailable(avail: number[], longRunDow: number): DOW[] {
  const cd = (d: number, ref: number) => Math.min((d - ref + 7) % 7, (ref - d + 7) % 7);
  const cands = avail.filter((d) => d !== longRunDow && cd(d, longRunDow) >= 2);
  const out: number[] = [];
  while (out.length < cands.length) {
    let best = -1;
    let bestMin = -1;
    for (const c of cands) {
      if (out.includes(c)) continue;
      let m = 7;
      for (const a of [longRunDow, ...out]) m = Math.min(m, cd(c, a));
      if (m > bestMin) { bestMin = m; best = c; }
    }
    if (best < 0) break;
    out.push(best);
  }
  return out as DOW[];
}

/**
 * 2026-06-23 · B3 (SCHED-03) · stimulus-gap-aware quality scheduling. Research/00b:55-60: a
 * VO2max/intervals session needs 2 EASY days after; threshold/tempo and a plain long need 1.
 * Two steps:
 *   1. ORDER the week's quality types so intervals (gap 2) lands LAST — nearest the long's own
 *      2-day buffer — and lighter threshold/tempo (gap 1) come first. With the default Tue/Thu +
 *      Sun-long this makes the common configs gap-correct by construction (Tu threshold → Th
 *      intervals → Fri/Sat easy → Sun long).
 *   2. RE-PLACE the days only when the ordered assignment STILL violates a gap (over-constrained,
 *      or a non-Sunday long), choosing the placement with the largest tightest-slack. Currently
 *      legal weeks — including David's Su:long Tu/Th — keep their days byte-identical. Falls back
 *      to best-achievable when unsatisfiable (e.g. two VO2max days in a ≤6-day week).
 * qualityDows is returned ascending; types align by index (types[i] → i-th-earliest quality day).
 */
export function scheduleQuality(
  qualityDows: number[],
  qualityTypes: Array<DayPlan['type']>,
  longRunDow: number,
  restDow: number,
  availableDows: Set<number> | null,
  placementTypes?: Array<DayPlan['type']>,
): { dows: DOW[]; types: Array<DayPlan['type']> } {
  const n = qualityDows.length;
  // FARTLEK-GAP-SCHED-1 (2026-06-23): fartlek is type='easy' and reqGap=0 in the validator
  // (easy needs no recovery day). gapRank must match so scheduleQuality doesn't displace
  // fartlek from its requested slot just because it's adjacent to the long run.
  const gapRank = (t: DayPlan['type']): number => (t === 'intervals' ? 2 : t === 'easy' ? 0 : 1);
  // VDEAD-A (2026-06-23) · PAD types to qualityDows.length so gaps[] aligns 1:1 with dows. When qualityTypes
  // is shorter than the dows (base-building emits 1 type for 2 quality slots), the old slice(0,n) left gaps
  // short → score() read gaps[i]=undefined → NaN slack → a stranded quality day (adjacent to the long, 0 easy
  // between) passed as "legal" → §9 stimulus-gap persist-abort. Cycle the types like the slot-assignment loop.
  const typeBase: Array<DayPlan['type']> = qualityTypes.length > 0 ? qualityTypes : ['threshold'];
  const types = Array.from({ length: n }, (_, i) => typeBase[i % typeBase.length]).sort((a, b) => gapRank(a) - gapRank(b));
  if (n === 0) return { dows: qualityDows.slice().sort((a, b) => a - b) as DOW[], types };
  // QUAL-PHASE-STABLE (2026-06-24) · the DOW placement is driven by the GAP requirements of the type
  // mix. When the QUALITY phase toggles its mix every week (weekIdx%2: intervals-in vs intervals-out),
  // a per-week placement moves the runner's hard-training WEEKDAYS every 7 days (Mon+Wed ↔ Tue+Thu).
  // Fix: when the caller passes a weekIdx-INVARIANT `placementTypes` (the most gap-demanding profile the
  // phase emits), decide the DOWs from THAT so they stay fixed across the phase; the returned `types`
  // still reflect THIS week's actual workouts. The intervals-safe placement is gap-legal for the lighter
  // (intervals-free) weeks too (Research/00b:55-58), so only the TYPE rotates, never the day. Both profiles
  // sort intervals to the last index, so a week that DOES carry intervals still lands it on the gap-2 slot.
  const gapBase: Array<DayPlan['type']> = (placementTypes && placementTypes.length > 0) ? placementTypes : typeBase;
  const gapTypes = Array.from({ length: n }, (_, i) => gapBase[i % gapBase.length]).sort((a, b) => gapRank(a) - gapRank(b));
  const gaps = gapTypes.map(gapRank);
  const between = (a: number, b: number): number => ((b - a + 7) % 7) - 1; // circular easy days strictly between hard a and next hard b
  const score = (dows: number[]): { ok: boolean; minSlack: number } => {
    const hard = dows.map((d, i) => ({ d, g: gaps[i] })).concat([{ d: longRunDow, g: 1 }]).sort((p, q) => p.d - q.d);
    let ok = true; let minSlack = 99;
    for (let i = 0; i < hard.length; i++) {
      const cur = hard[i]; const nxt = hard[(i + 1) % hard.length];
      const slack = between(cur.d, nxt.d) - cur.g;
      if (slack < 0) ok = false;
      minSlack = Math.min(minSlack, slack);
    }
    return { ok, minSlack };
  };
  const orig = qualityDows.slice().sort((a, b) => a - b);
  // VDEAD-B (2026-06-23) · also force the re-placement search when a quality day collides with the REST or
  // LONG day — score() alone passed orig, then the slot assignment dropped the colliding quality onto the
  // rest/long day → §5 "no quality sessions" persist-abort. The combo search below already excludes both
  // days, so it re-routes to a free day. Byte-safe: David's Tue/Thu never collide (early return holds).
  if (score(orig).ok && orig.every((d) => d !== restDow && d !== longRunDow)) return { dows: orig as DOW[], types };
  const cand = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== longRunDow && d !== restDow && (!availableDows || availableDows.has(d)));
  // SCHED-VDEAD-B-1 (2026-06-23) · when cand has fewer slots than n quality sessions, returning orig
  // unconditionally re-introduced the collision (orig may contain restDow or longRunDow). Strip the
  // colliding DOWs before returning and align types to the surviving sessions.
  if (cand.length < n) {
    const safe = orig.filter((d) => d !== restDow && d !== longRunDow);
    return { dows: safe as DOW[], types: types.slice(0, safe.length) };
  }
  const combos: number[][] = [];
  const pick = (start: number, acc: number[]): void => {
    if (acc.length === n) { combos.push(acc.slice()); return; }
    for (let i = start; i < cand.length; i++) { acc.push(cand[i]); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  let best = orig; let bestS = score(orig); let bestShift = 0;
  for (const c of combos) {
    const s = score(c);
    const shift = c.reduce((acc, d, i) => acc + Math.abs(d - (orig[i] ?? d)), 0);
    const better = (s.ok && !bestS.ok)
      || (s.ok === bestS.ok && s.minSlack > bestS.minSlack)
      || (s.ok === bestS.ok && s.minSlack === bestS.minSlack && shift < bestShift);
    if (better) { best = c; bestS = s; bestShift = shift; }
  }
  // GAP-mode (GOAL-1) · if even the best placement leaves a gap unsatisfied (over-constrained by too
  // few available days — a tight 2-day pair can't give a VO2max session its 2 easy days), DOWNGRADE the
  // latest intervals to threshold (gap 2→1, which a tight pair CAN satisfy) — a legal recoverable
  // substitute (Research/00b · threshold needs only 1 easy day), far better than a rejected plan. Recurse
  // until satisfiable or no intervals remain.
  if (!bestS.ok && gapTypes.lastIndexOf('intervals') >= 0) {
    // Downgrade against the PLACEMENT profile (gapTypes) — it governs satisfiability — and downgrade
    // this week's matching intervals label too (if any), so the recursion converges on a legal placement
    // while the returned types stay truthful. A week with no intervals label just keeps its types.
    const gi = gapTypes.lastIndexOf('intervals');
    const downGap = gapTypes.slice(); downGap[gi] = 'threshold';
    const downLabel = types.slice();
    const li = types.lastIndexOf('intervals'); if (li >= 0) downLabel[li] = 'threshold';
    // DOCTRINE-DOSING-2 (2026-08-18) · the downgrade may not create a SECOND
    // session of a pace family the week already runs.
    //
    // Substituting threshold for intervals is a gap fix — it needs one easy day
    // instead of two — and on a week whose other session is already threshold it
    // buys that at the cost of running Daniels' whole 10% weekly allowance
    // twice. `Research/04` §5.2 gives the T session "1×/week", §16 names "Two
    // threshold sessions back-to-back" outright, and `Research/01`'s weekly
    // column makes it arithmetic. It is not hypothetical: a half-marathoner
    // available three days a week got two threshold days in the same
    // race-specific week, and the dosing pass then had to cut one of them to a
    // quarter-mile fragment to fit the cap.
    //
    // When the substitute would duplicate, the session is DROPPED instead. That
    // is the same trade the downgrade already makes — a legal smaller week
    // beats a rejected plan — taken one step further for a runner whose
    // available days cannot space two hard sessions at all. The freed day is
    // filled as an easy run by `layoutWeek`, so the training-day count holds.
    if (li >= 0 && duplicatePaceFamily(downLabel) != null) {
      return scheduleQuality(
        best.filter((_, i) => i !== li),
        types.filter((_, i) => i !== li),
        longRunDow, restDow, availableDows,
        gapTypes.filter((_, i) => i !== gi),
      );
    }
    return scheduleQuality(best, downLabel, longRunDow, restDow, availableDows, downGap);
  }
  return { dows: best as DOW[], types };
}

/**
 * 2026-06-23 · COH-1 · clamp a reported longest run to be COHERENT with weekly volume.
 * The long run ANCHORS the week (easy days are held < long, RP-5), so an incoherent long
 * mis-sizes the entire plan: a 50mpw runner reporting a 2mi "longest" collapses to a ~5mpw plan
 * (easy<2 crushes every day, VOL-1 reconciles the week down); a 10mpw runner reporting a 12mi
 * "longest" inflates the week with a long the race never needs. Data-sanity bounds: a single long
 * is ≤80% of the week (other runs exist) and ≥ the average run length (recentWeekly/days — the max
 * of a set is ≥ its mean). Byte-safe for coherent runners (David: ~13mi long on ~50mpw, null freq
 * → upper bound 40, no lower clamp → unchanged).
 */
export function coherentRecentLong(recentLongMi: number, recentWeeklyMi: number, trainingDaysPerWeek: number | null): number {
  if (!recentWeeklyMi || recentWeeklyMi <= 0 || !recentLongMi || recentLongMi <= 0) return recentLongMi;
  let v = Math.min(recentLongMi, Math.round(recentWeeklyMi * 0.8)); // a single long ≤ 80% of the week
  if (trainingDaysPerWeek && trainingDaysPerWeek > 0) {
    // longest ≥ the average run (arithmetic minimum: the max of a set ≥ its mean). When a runner
    // reports longestRunBucket='0-3' (2mi) but weeklyMileageBucket=45 (50mpw) on 3 days, it is
    // MATHEMATICALLY IMPOSSIBLE for their longest run to be 2mi — the mean alone is 17mi. Raising
    // the seed to the mean resolves the contradiction by trusting the weekly mileage over the longest-
    // run self-report (mileage is what runners know; longest-run bucket is often underreported).
    // The rampCeiling in layoutWeek then governs week-1 growth from this seed (max 10% above seed).
    v = Math.max(v, Math.round(recentWeeklyMi / trainingDaysPerWeek));
  }
  return v;
}

export interface GenerateInput {
  userId: string;
  /** Race-anchored plan: the races-row slug (reads distance/date/goal from it).
   *  Mutually exclusive with goalTarget. */
  raceSlug?: string;
  /** 2026-06-15 · GOAL-anchored plan (no race row). The fitness goal IS the
   *  anchor: distance + goal time + a synthetic target date (today + the
   *  runner's chosen plan_weeks). Routes through the SAME canonical periodized
   *  builder (BASE→QUALITY→RACE-SPECIFIC→TAPER, distance-appropriate long-run
   *  progression + race-pace work, incl. ultra) so every distance gets a real
   *  build — persisted with race_id = null. Mutually exclusive with raceSlug. */
  goalTarget?: { distanceMi: number; goalSec: number | null; raceDateISO: string };
  /** 2026-06-10 · where week 0 begins.
   *   · 'monday' (default) — Monday of the current week. Established
   *     runners keep clean Mon-Sun weeks across lifecycle regens.
   *   · 'today' — the join day. Used by onboarding so a runner who
   *     signs up mid-week doesn't get runs scheduled before they
   *     existed (David: "today is their first day, why would we
   *     schedule runs in the past"). First week is a full 7 days from
   *     today; no past-dated prescriptions. */
  startAnchor?: 'today' | 'monday';
  /** 2026-06-10 · explicit week-0 start date (YYYY-MM-DD) the runner
   *  picked at onboarding. Overrides startAnchor. Clamped to ≥ today.
   *  Day-of-week placement (long run etc.) still follows user prefs. */
  startDateISO?: string;
  /** 2026-06-20 · this is a user-initiated NEW target (set a goal / add a
   *  race), not an automatic adaptation regen of the same goal. When true the
   *  corruption check (new peak long < 80% of the active prior plan's peak)
   *  is skipped — the prior plan is a DIFFERENT goal that's about to be
   *  replaced, so a legitimately smaller long (marathon→5K, or a cold-start
   *  beginner) must not be flagged as "bad input data". The check still runs
   *  for same-goal adaptation regens, which is what it's actually for. */
  freshTarget?: boolean;
  /**
   * 2026-08-19 · OPEN-TARGET-1 · THE BLOCK WITH NOTHING TO BUILD TO.
   *
   * The third entry, alongside `raceSlug` and `goalTarget`, and the one whose
   * absence made a whole population invisible: a runner finishes their goal
   * race with nothing else booked. `runPostResultChain` archives the finished
   * plan the moment the time lands, finds no next race, and stops — so on the
   * morning after a marathon they have zero active plans, and no entry into
   * this module could give them one, because `loadGeneratorInputs` returned
   * `'race not found'` without a target.
   *
   * There is no target here and this input does not invent one. It carries
   * only the race they just FINISHED, which is what the block unwinds from:
   * `pickPlanMode` reads it to answer recovery-or-maintenance against
   * Research/00b's window, and `composeRecoveryPlan` reads it to size the
   * reverse taper. Both were already written to take exactly this. `after` is
   * null when the cron finds a runner who is planless by some other route.
   *
   * The block's LENGTH comes from the composer, not from a date — which is why
   * the runway gates (`totalDays < 14`, `totalWeeks < 3`) are skipped on this
   * path. They ask "is there enough time before the race", and there is no
   * race.
   *
   * Mutually exclusive with both `raceSlug` and `goalTarget`; when either of
   * those is present it wins, since a real target always beats an open block.
   */
  openTarget?: {
    after: {
      slug: string;
      dateISO: string | null;
      distanceMi: number | null;
      priority?: string | null;
    } | null;
  };
  /**
   * 2026-08-19 · COACHED-GATE-1 · this authoring is a DELIBERATE runner action,
   * so `coached_externally` does not block it.
   *
   * The gate itself now lives at the top of `generatePlan` (see there for why),
   * which makes it universal — every path, including ones that do not exist
   * yet, is covered without anyone remembering to add a line. This flag is the
   * single documented exception, and it is opt-IN rather than opt-out on
   * purpose: a call site that never thought about coached mode lands on the
   * safe side by default, and the three routes that pass it had to decide.
   *
   * Passed by exactly the three explicit runner actions — POST /api/plan/
   * generate, /api/plan/replan, /api/plan/proposal. NOT by the automatic
   * paths (silent-rebuild, the lifecycle crons, the result chain, the open
   * block), which is the whole point.
   */
  allowCoached?: boolean;
  /**
   * 2026-08-25 · WHY THE PLAN THIS ONE REPLACES WAS REPLACED.
   *
   * Stamped on the outgoing plan's `training_plans.archive_reason` by
   * `clearActivePlansFor`. That parameter has existed since 2026-06-09 with a
   * default of `'regenerated'` and NO caller has ever passed it, so every plan
   * this module has ever archived — a nightly drift rebuild, a settings
   * reshape, a race graduation, an admin silent-rebuild landing a code upgrade
   * — carries the identical string. The column looked like a lifecycle record
   * and was a constant.
   *
   * That cost a real answer on 2026-08-25. A runner's block was replaced
   * overnight; `archive_reason` said `regenerated`, which is what it says for
   * everything, so the row could not distinguish "the recovery block finished"
   * from "the drift cron inferred something" from "an operator dispatched a
   * rebuild". Only the `plan_proposals` row settled it — and the one path that
   * writes no proposal at all, by design, is `silent-rebuild`.
   *
   * This records what happened. It does not change what any caller is allowed
   * to do, and it fires no banner: `silent-rebuild` stays silent to the runner
   * and stops being silent to the database.
   *
   * Callers pass the trigger they already know (`fireAutoRebuild` its
   * `AutoRebuildKind`, the prefs path `'settings_prefs'`, silent-rebuild
   * `'silent_rebuild'`). Absent → `'regenerated'`, the historical value, so an
   * unconverted call site reads exactly as it did before rather than lying.
   */
  archiveReason?: string;
}

export interface GenerateResult {
  ok: boolean;
  plan_id?: string;
  weeks_generated?: number;
  reason?: string;
  /**
   * 2026-08-25 · TRUE when the rebuild ran, produced nothing worth landing, and
   * was rolled back. `ok` is still true and `plan_id` is the plan the runner
   * KEPT, so a caller that only reads those two behaves exactly as it did.
   *
   * A caller that reports what happened must read this. Writing "plan rebuilt"
   * off `ok: true` when nothing was rebuilt is the drift between the report and
   * reality that this whole night's work is about.
   */
  unchanged?: boolean;
  /** Why it was refused. Absent when a plan was written. */
  refusedReason?: RebuildRefusalReason;
  /**
   * What moved, both blocks read off the database. Absent on a first authoring
   * (there is no prior block) and whenever the prior read could not be taken.
   * Never modelled: every number in here is a sum of persisted rows.
   */
  plan_delta?: PlanDelta;
}

/**
 * 2026-08-25 · WHY A REBUILD MAY BE REFUSED AFTER IT HAS ALREADY RUN.
 *
 *   'no_change'        · the composed block is identical, field for field, to
 *                        the one it was about to replace. Landing it would
 *                        archive a live block, mint a fresh set of
 *                        `plan_workouts` ids, reset the week counter and raise
 *                        a notice card, in exchange for nothing. The morning
 *                        of 2026-08-25 the runner noticed the rebuild BECAUSE
 *                        the week counter reset; a counter that resets for no
 *                        reason is a false alarm on the one signal he has.
 *
 *   'undone_by_runner' · the runner put a block back, and this rebuild would
 *                        re-land the exact block they put away. Scoped to the
 *                        OUTPUT, not to the signal: an engine that wants
 *                        something genuinely different is free to act
 *                        immediately, and only the rejected block is held off.
 *                        That is what keeps this from becoming the fourteen-day
 *                        silence the propose-and-wait model would have created,
 *                        which is the harm the apply-with-undo decision was
 *                        taken to avoid.
 */
export type RebuildRefusalReason = 'no_change' | 'undone_by_runner';

/**
 * How long an undone block stays refused. Not a cooldown on the SIGNAL — the
 * engine may act on the same drift tomorrow, as long as it wants a different
 * week. It is how long the runner's "no, put it back" holds against that exact
 * answer being re-imposed.
 *
 * 14 days matches the window `hasPendingProposal` already gives a dismissed
 * proposal, so a runner who says no through the undo and a runner who says no
 * through the Keep button are honoured for the same length of time. THE NUMBER
 * ITSELF IS A JUDGMENT CALL and is flagged as one: there is no doctrine on how
 * long a runner's refusal should stand.
 */
export const UNDO_REFUSAL_DAYS = 14;


/**
 * Thrown from inside the rebuild transaction to reach `mutatePlan`'s ROLLBACK.
 * Caught immediately by `persistComposedPlan` and turned back into a value —
 * it never escapes this module and is never an error condition.
 */
export class RebuildRefused extends Error {
  constructor(
    readonly reason: RebuildRefusalReason,
    /** The plan the runner keeps. The one that was never archived. */
    readonly keptPlanId: string,
  ) {
    super(`rebuild refused · ${reason}`);
    this.name = 'RebuildRefused';
  }
}

/**
 * Has the runner undone a block that looks exactly like this one, recently?
 *
 * The undo route records the fingerprint of the block it put away
 * (`plan_proposals.reasons.undone_fingerprint`, status `'undone'`). This asks
 * whether the plan we just wrote reproduces it.
 *
 * FAILS OPEN, deliberately, and this is the opposite posture from
 * `hasPendingProposal` for a reason worth stating. That guard stands in front
 * of REPLACING a block, so it must assume the worst when it cannot see. This
 * one stands in front of REFUSING to replace one, and a read error that
 * silently froze a runner's plan against every future rebuild would be a much
 * quieter and much worse failure than one that lets a rebuild through.
 */
async function undoneWithin(
  client: PoolClient,
  userUuid: string,
  candidate: PlanPrescription,
  days: number,
): Promise<boolean> {
  const fp = fingerprintDigest(prescriptionFingerprint(candidate));
  const r = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM plan_proposals
      WHERE user_uuid = $1::uuid
        AND status = 'undone'
        AND resolved_at >= NOW() - ($2::text || ' days')::interval
        AND reasons->>'undone_fingerprint' = $3`,
    [userUuid, String(days), fp],
  ).catch((e) => {
    logReadFailure('plan/generate · undone-block check', e);
    return { rows: [{ n: '0' }] };
  });
  return Number(r.rows[0]?.n ?? 0) > 0;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

// Monday of the week containing `iso`
function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, shift);
}

/**
 * #10 (audit 2026-06-16) · the most-recent training-week start on-or-before
 * `iso`, where the week STARTS on `weekStartDow` (0=Sun..6=Sat). Generalizes
 * mondayOf — `weekStartBoundaryOf(iso, 1)` IS mondayOf.
 *
 * The training week ENDS on the runner's long-run day, so it STARTS the day
 * after: weekStartDow = (longRunDow + 1) % 7. This is the exact convention
 * /api/plan/week/route.ts uses (weekStartDow = (longRunDow + 1) % 7), so a
 * plan_weeks row now spans the SAME 7 days as the WeekStrip window instead of
 * straddling it for non-Sunday-long runners. For David (long=Sun → start=Mon)
 * this returns the most-recent Monday — byte-identical to mondayOf, a no-op.
 */
export function weekStartBoundaryOf(iso: string, weekStartDow: number): string {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const shift = -(((dow - weekStartDow) % 7 + 7) % 7);   // days back to the boundary
  return addDays(iso, shift);
}

/**
 * WEEK-ALIGN-1 (2026-08-24) · the first day the runner OWNS, or null when the
 * caller named none.
 *
 * Two different questions were being answered by one variable, and conflating
 * them is what misaligned the block from the week the runner reads:
 *
 *   · WHERE DOES WEEK 0 BEGIN?   Always a training-week boundary, so a
 *     `plan_weeks` row spans the same seven days as `trainingWeekWindow`.
 *   · WHICH DAY IS THE RUNNER'S FIRST?  The literal day they signed up or
 *     chose, so nothing is ever dated before they existed.
 *
 * This answers the second. `null` means the caller did not name a first day —
 * the lifecycle-regen path (`startAnchor: 'monday'`), which deliberately
 * re-authors the whole current week including the days already run, because
 * Rule 15 re-seals those rows from the prior plan. Clipping there would erase
 * the prescriptions the runner actually trained against.
 *
 * Kept next to `weekStartBoundaryOf` and exported so the loader (which snaps
 * the anchor) and the persister (which clips the days) cannot answer it
 * differently.
 */
export function requestedBlockStartISO(
  todayISO: string,
  startAnchor: 'today' | 'monday',
  startDateISO?: string,
): string | null {
  if (startDateISO && startDateISO >= todayISO) return startDateISO;
  return startAnchor === 'today' ? todayISO : null;
}

// 2026-06-03 · delegate to lib/training/vdot.parseRaceTime (single
// canonical parser, imported at the top of this file). Re-exported so
// the generator-bench keeps its existing test surface. Was a local
// fork that mis-parsed "1:30" as null instead of 5400.
export function parseGoalSeconds(goal: string | null | undefined): number | null {
  return parseRaceTime(goal);
}

// Race distance in miles. Prefers numeric meta.distanceMi (most reliable),
// falls back to label parsing via the shared distanceMiFromLabel parser
// (handles 5K/10K/half/marathon AND the ultra labels — 50K/50M/100K/100M —
// the phone Add Race sheet offers).
//
// 2026-07-07 · ultra-honesty audit P1-41 · this used to fall through to
// 13.1 for ANY unrecognized/unparseable label — the exact bug that gave a
// 50K/50M/100K/100M race a silent half-marathon plan (peak long ~12mi,
// half-marathon pace anchors, 13.1mi race-day workout) with no error.
// Returns null on "no distance resolvable" instead; callers MUST treat
// null as "unknown, don't assume a distance" — see loadGeneratorInputs'
// unsupported-ultra gate and the horizonRaces null-filter below.
// Exported for direct unit testing (see generate-ultra.test.ts) — the
// worktree can't spin up the DB pool to exercise loadGeneratorInputs end to
// end, so the label→distance resolution is tested at this boundary instead.
// 2026-08-19 · the BODY moved to lib/race/distance.ts § distanceMiOfMeta, so
// the readers that are not the plan engine (lib/plan/adapt.ts's adaptation
// signals, lib/coach/projection-levers.ts) can resolve a label-only race row
// without importing this module. This name and its behaviour are unchanged.
export function distanceMiOf(meta: any): number | null {
  return distanceMiOfMeta(meta);
}

/**
 * OPEN-TARGET-1 (2026-08-19) · CONVENTION, not doctrine — and made inert.
 *
 * An open block has no event. `ComposePlanInput` nonetheless requires a
 * `raceDistanceMi`, because every other path has one, so this path has to name
 * a number that no runner is training toward.
 *
 * WHAT IT IS. The distance the runner last RACED, when one resolves: the event
 * their current shape was built for and the one the reverse taper is unwinding,
 * so it is the closest thing to a true answer available. Absent that — a runner
 * who has never raced, which the nightly cron reaches — the half marathon,
 * stated here as a CONVENTION with nothing behind it. Research/22's off-season
 * / base-building template, which is the shape a targetless block actually
 * implements, is written without reference to any race distance at all, so
 * there is no doctrine to quote and this does not pretend otherwise.
 *
 * ── WHAT IT MOVES, and the one thing that had to change ─────────────────────
 *
 * Traced through every consumer reachable on the non-race-prep path:
 *
 *   · `validateComposedPlan` picks a CONSTRAINTS row by category. Three of
 *     that row's four fields are read only under `mode === 'race-prep'`
 *     (`taperDropMinPct`, `taperDropMaxPct`, `weeklyVolWoWMaxPct`), as is
 *     `longRunCapMi`. The one field that binds here, `longRunWoWMaxPct`, is 30
 *     in all five rows.
 *   · `MAINTENANCE_BY_TIER` is keyed by TIER; `RECOVERY_WEEKLY_PCT_OF_BASE`,
 *     `RECOVERY_RUN_DAYS` and `RECOVERY_LONG_PCT` are keyed by the FINISHED
 *     race's category. Neither reads this number.
 *   · `rxQuality` / `rxRaceSpecific` are resolved per category but read only
 *     inside `composePlan`, which this path never enters.
 *   · `goalIPaceEligible` gates I-pace derivation for `intervals` and
 *     `race_week_tuneup` rows. Neither non-race composer emits either type.
 *
 * That left ONE live consumer, and it was not inert. `classifyGoalTier` with no
 * goal reads the runner's demonstrated pace predicted at this distance and
 * grades it against this distance's tier table. That is VDOT-equivalent only up
 * to about VDOT 48; above it the rows diverge, and a fit runner graded at 13.1
 * came out `advanced` where the same runner graded at 26.2 came out
 * `intermediate` — a different `MAINTENANCE_BY_TIER` row, a different number of
 * running days a week, off a distance nobody chose.
 *
 * So the demonstrated-pace lift is NOT applied when the anchor is the
 * convention (see `composeForUserInternal`). Grading evidence at a distance the
 * runner never raced is the same error as defaulting an unknown distance to a
 * half marathon, which this codebase already refuses to do everywhere else. The
 * tier then falls to stated experience, which is a real fact about the runner,
 * and the anchor stops being able to move anything. When a last raced distance
 * DOES resolve the lift applies at that distance, where the evidence is real.
 *
 * `_open_block_authoring.test.ts` asserts both halves.
 */
export const OPEN_BLOCK_SHAPE_ANCHOR_MI = 13.1;

/** The open block's shape anchor: the last raced distance, else the
 *  convention. See OPEN_BLOCK_SHAPE_ANCHOR_MI. */
export function openBlockShapeAnchorMi(lastRacedMi: number | null | undefined): number {
  return openBlockAnchorIsMeasured(lastRacedMi) ? (lastRacedMi as number) : OPEN_BLOCK_SHAPE_ANCHOR_MI;
}

/** True when the open block's anchor is a distance the runner actually raced,
 *  rather than the convention. Only then may evidence be graded against it. */
export function openBlockAnchorIsMeasured(lastRacedMi: number | null | undefined): boolean {
  return lastRacedMi != null && Number.isFinite(lastRacedMi) && lastRacedMi > 0;
}

// Recent 4-week avg weekly volume → starting point for the ramp.
async function recentWeeklyMileage(userId: string): Promise<number> {
  // 2026-06-02 · delegated to lib/runs/volume.ts § recentWeeklyMileageMi
  // which uses smart-dedup (bucket by date + 0.1-mi distance). Old
  // MAX-per-day was undercounting legit same-day doubles (AM/PM,
  // separate lunch runs) · David's 35.7 mi/wk was reading as 32.6.
  const { recentWeeklyMileageMi } = await import('@/lib/runs/volume');
  return (await recentWeeklyMileageMi(userId)) ?? 0;
}

/**
 * DOCTRINE-4 (2026-08-17) · the runner's actual PEAK training week, mi.
 *
 * The post-race reverse taper in Research/00b is stated as percentages of
 * "Volume vs. peak". The engine had no peak reader at all — `recentPeakWeeklyMi`
 * was wired to the 28-day MEAN with the comment "proxy when peak unknown" — so
 * every recovery percentage was multiplied by an average and the whole reverse
 * taper landed roughly a third low. This reads the real thing.
 *
 * WINDOW. 16 weeks back from today, which spans a full build block: the peak
 * week of a marathon build sits 3-4 weeks before the race, and recovery mode
 * arms from race day, so a 16-week look-back always contains it. Longer would
 * start reaching into the PREVIOUS season's peak, which is not the peak this
 * recovery is unwinding.
 *
 * BUCKETING. Rolling 7-day sums rather than calendar weeks, because a runner
 * whose big week straddles a Sunday boundary has a real peak the calendar
 * split in two. Returns 0 when there is no history (cold start), which leaves
 * the caller's `max(peak, mean)` floor to supply the anchor exactly as before.
 */
/** 16 weeks · spans a full build block. See the header above. */
export const PEAK_WEEK_LOOKBACK_DAYS = 112;

/**
 * ANCHORFIT-1 (2026-08-25) · pure half of DOCTRINE-4, split out for the same
 * reason `resolveRampBase` was: the DB half cannot be graded without a
 * database, so the anchor that sizes every recovery and maintenance week
 * shipped with no test that fed it a runner's history.
 *
 * `dailyMi[i]` is miles run `i` days before today, so index 0 is today. The
 * rolling window is closed over the array's own length, which is what lets a
 * fixture hand it 112 days without inventing dates.
 */
export function resolvePeakWeekly(dailyMi: readonly number[]): number {
  let peak = 0;
  const at = (i: number): number => {
    const v = dailyMi[i];
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  for (let end = 0; end < dailyMi.length; end++) {
    let sum = 0;
    for (let k = 0; k < 7; k++) sum += at(end + k);
    if (sum > peak) peak = sum;
  }
  return Math.round(peak * 10) / 10;
}

async function recentPeakWeeklyMileage(userId: string, todayISO: string): Promise<number> {
  const { mileageByDay, isoDaysBefore } = await import('@/lib/runs/volume');
  const WINDOW_DAYS = PEAK_WEEK_LOOKBACK_DAYS;
  const fromISO = isoDaysBefore(todayISO, WINDOW_DAYS);
  // ANCHORFIT-2 (2026-08-25) · NOT `.catch(() => new Map())`. See lib/db/read.ts:
  // a failed read and an honest nothing were the same value here, and the
  // consumer is `peakAnchor = max(peak, 28-day mean)` — so a transient database
  // error silently demoted every recovery and maintenance block back onto the
  // trailing average this whole reader exists to replace. That is the DOCTRINE-4
  // defect, reachable at runtime with no code change. An authoring that cannot
  // read the runner's history must refuse, not invent a smaller runner.
  const byDay = await mileageByDay(userId, fromISO, todayISO);
  if (byDay.size === 0) return 0;
  const dayMi = (iso: string): number => (byDay.get(iso)?.mi ?? 0);
  // Exactly the WINDOW_DAYS the query fetched. `resolvePeakWeekly` reads past
  // the end as zero, which is what the old inline loop did too — days 112-117
  // sat outside `fromISO` and always answered 0.
  const daily: number[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) daily.push(dayMi(isoDaysBefore(todayISO, i)));
  return resolvePeakWeekly(daily);
}

// ── RAMPBASE-1 (2026-08-17) · the volume a build may honestly ramp FROM ──
//
// THE DEFECT. `volumeCurve`'s `baseMi` came straight from `recentWeeklyMi`, a
// flat 28-day MEAN. A build authored the day a mandated recovery block ends
// reads that block as the runner's fitness: the engine prescribes the deload,
// then treats the deload as the base. On the owner's CIM authoring (2026-08-31,
// four days after an A-priority half and its Research/00b recovery window) the
// mean read 15.8 mi/wk against twelve clean weeks averaging 41 and a real peak
// of 52.3. The block opened at 19 mi/wk with ONE-MILE easy days and peaked at
// 48 against a tier band of [65, 90].
//
// It is the same shape DOCTRINE-4 fixed for the recovery composer four hours
// earlier — "a percentage of peak multiplied by an average is not a percentage
// of peak" — applied to the recovery block and never swept to the build that
// FOLLOWS recovery.
//
// THE RULE.
//
//   base = max(28-day mean, sustained × RESUME_FRACTION)   ← if, and only if,
//                                                            the low stretch is
//                                                            a mandated one
//
//   sustained = the RAMP_BASE_SUSTAINED_RANK-th highest of the last
//               RAMP_BASE_LOOKBACK_WEEKS 7-day blocks. Third-highest, not the
//               max: a base is a volume the runner reached repeatedly, so one
//               big week can never set it (nor can two).
//
//   interruption = how many of the most recent blocks sit below that sustained
//               level. The lift applies only while the interruption is no
//               longer than the one the engine itself mandates — the finished
//               race's taper plus its own post-race recovery window. With no
//               finished race to explain it, the allowance is the two weeks
//               Research/22 §14 calls a SHORT layoff. Anything longer is a
//               layoff, not a deload: no lift, the mean governs, and the
//               comeback machinery (adapt.ts RERAMP-1, injury-builder) keeps
//               owning the ramp exactly as it does today.
//
// WHY 70%. Both tables that describe returning from an interruption agree on
// the number and on the anchor being PRE-interruption volume, never the
// interruption's own:
//   · Research/22 §14 "Return from Short Layoff" — 8-14 days off → "70% of
//     pre-layoff volume for 1 wk, 85% for wk 2, full for wk 3".
//   · Research/00b §"Marathon Recovery (4-week reverse taper)" week 4 — "70-80%"
//     of peak, with "full return to peak training load typically week 5-6".
// The floor of the band is taken. The build's own ramp ceiling carries the
// runner the rest of the way, which is what "full by week 3" describes.
//
// WHAT IT DOES NOT DO. A runner whose recent mean already sits at or above
// 70% of their sustained level gets `max(mean, …) = mean` — byte-identical
// output. That is every runner in steady training, so the sweep archetypes
// (which compose from synthetic inputs and never reach this reader) and every
// non-interrupted authoring are untouched.

/** Blocks of 7 days looked back over. 16 weeks spans a full build. */
export const RAMP_BASE_LOOKBACK_WEEKS = 16;
/** Rank of the "sustained" week · 3rd-highest, so no single (or double) outlier week sets a base. */
export const RAMP_BASE_SUSTAINED_RANK = 3;
/** Research/22 §14 · resume at 70% of PRE-interruption volume. */
export const RAMP_BASE_RESUME_FRACTION = 0.70;
/** Research/22 §14 · "Return from Short Layoff (1-2 weeks off)". Longer + unexplained = moderate layoff. */
export const SHORT_LAYOFF_WEEKS = 2;

export interface RampBaseEvidence {
  /** The base volumeCurve ramps from. */
  baseMi: number;
  /** The 28-day mean it would have used. */
  meanMi: number;
  /** Rank-3 week of the look-back. 0 when there is no history. */
  sustainedMi: number;
  /** Consecutive most-recent blocks below the resume level. */
  interruptionWeeks: number;
  /** How long an interruption this authoring is entitled to look through. */
  allowedInterruptionWeeks: number;
  /** True when the sustained level (not the mean) set the base. */
  lifted: boolean;
}

/**
 * Pure half of RAMPBASE-1. `weeklySeries` is most-recent-first 7-day sums.
 * Exported for direct unit testing — the worktree has no DB pool.
 */
export function resolveRampBase(opts: {
  meanWeeklyMi: number;
  weeklySeries: number[];
  allowedInterruptionWeeks: number;
}): RampBaseEvidence {
  const mean = Math.max(0, opts.meanWeeklyMi || 0);
  const series = opts.weeklySeries.filter((v) => Number.isFinite(v)).map((v) => Math.max(0, v));
  const base0: RampBaseEvidence = {
    baseMi: mean, meanMi: mean, sustainedMi: 0,
    interruptionWeeks: 0, allowedInterruptionWeeks: opts.allowedInterruptionWeeks, lifted: false,
  };
  if (series.length < RAMP_BASE_SUSTAINED_RANK) return base0;
  const sorted = [...series].sort((a, b) => b - a);
  const sustained = sorted[RAMP_BASE_SUSTAINED_RANK - 1] ?? 0;
  if (!(sustained > 0)) return base0;
  const resumeLevel = sustained * RAMP_BASE_RESUME_FRACTION;
  let interruption = 0;
  while (interruption < series.length && series[interruption] < resumeLevel) interruption++;
  const evidence: RampBaseEvidence = {
    ...base0, sustainedMi: Math.round(sustained * 10) / 10, interruptionWeeks: interruption,
  };
  if (interruption > opts.allowedInterruptionWeeks) return evidence;   // a layoff, not a deload
  const lifted = resumeLevel > mean;
  return {
    ...evidence,
    baseMi: lifted ? Math.round(resumeLevel * 10) / 10 : mean,
    lifted,
  };
}

/**
 * RAMPBASE-1 · how long an interruption this authoring may read THROUGH.
 *
 * A race the runner actually ran explains its own taper AND its own post-race
 * recovery window — both are volumes the engine itself prescribed, so reading
 * them as fitness is the defect. Nothing else earns more than the short-layoff
 * allowance.
 *
 * ANCHORFIT-1 (2026-08-25) · lifted out of `rampBaseForBuild` so the sim
 * harness answers this question with the SAME function rather than a second
 * copy that can drift. A HISTORY row, not the goal race, so an unrecognised
 * distance is a real possibility and refusing the whole authoring for it would
 * be wrong: a race whose distance we do not know explains no mandated
 * interruption, and the short-layoff allowance stands.
 */
export function allowedInterruptionWeeksFor(
  todayISO: string,
  lastRaceDateISO: string | null,
  lastRaceDistanceMi: number | null,
  lastRacePriority: string | null,
): number {
  let allowed = SHORT_LAYOFF_WEEKS;
  if (lastRaceDateISO && lastRaceDistanceMi != null && lastRaceDistanceMi > 0) {
    const weeksSince = Math.floor(daysBetween(lastRaceDateISO, todayISO) / 7);
    const cat = distanceCategoryOrNull(lastRaceDistanceMi);
    if (cat != null) {
      const mandated = BLOCK_SHAPE[cat].taperWeeks + postRaceRecoveryWeeks(cat, lastRacePriority);
      if (weeksSince >= 0 && weeksSince <= mandated) allowed = Math.max(allowed, mandated);
    }
  }
  return allowed;
}

/** ANCHORFIT-1 · pure · 16 most-recent-first 7-day sums from a daily series. */
export function weeklyBlocksFromDaily(dailyMi: readonly number[], blocks = RAMP_BASE_LOOKBACK_WEEKS): number[] {
  const at = (i: number): number => {
    const v = dailyMi[i];
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const out: number[] = [];
  for (let w = 0; w < blocks; w++) {
    let sum = 0;
    for (let k = 0; k < 7; k++) sum += at(w * 7 + k);
    out.push(Math.round(sum * 10) / 10);
  }
  return out;
}

/** DB half of RAMPBASE-1 · builds the 7-day series and spends `resolveRampBase`. */
async function rampBaseForBuild(
  userId: string,
  todayISO: string,
  meanWeeklyMi: number,
  lastRaceFinished: { date: string; distanceMi?: number } | null,
  lastRaceDistanceMi: number | null,
  lastRacePriority: string | null,
): Promise<RampBaseEvidence> {
  const { mileageByDay, isoDaysBefore } = await import('@/lib/runs/volume');
  const WINDOW_DAYS = RAMP_BASE_LOOKBACK_WEEKS * 7;
  // ANCHORFIT-2 (2026-08-25) · not swallowed. An empty map here makes every
  // 7-day block zero, `sustained` zero, and `resolveRampBase` return the
  // 28-day mean — the exact number RAMPBASE-1 exists to stop a build ramping
  // from. See the sibling note in `recentPeakWeeklyMileage`.
  const byDay = await mileageByDay(userId, isoDaysBefore(todayISO, WINDOW_DAYS), todayISO);
  const dayMi = (iso: string): number => (byDay.get(iso)?.mi ?? 0);
  const daily: number[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) daily.push(dayMi(isoDaysBefore(todayISO, i)));
  const series = weeklyBlocksFromDaily(daily, RAMP_BASE_LOOKBACK_WEEKS);
  // How long an interruption this authoring may look through · see
  // `allowedInterruptionWeeksFor`.
  const lastMi = lastRaceDistanceMi ?? lastRaceFinished?.distanceMi ?? null;
  const allowed = allowedInterruptionWeeksFor(
    todayISO, lastRaceFinished?.date ?? null, lastMi, lastRacePriority,
  );
  return resolveRampBase({ meanWeeklyMi, weeklySeries: series, allowedInterruptionWeeks: allowed });
}

/**
 * 2026-06-01 · runner's actual easy-day median over the last 14 days.
 *
 * Drives the easy-day distance floor in layoutWeek · prevents the
 * generator from authoring 4.5 mi easy days when the runner has been
 * comfortably running 6+ mi easy. The volume_drift cron only fires at
 * >40% deviation · this floor catches the silent 20-30% gap that the
 * runner notices ("my easy runs are usually 5-6 miles · why is the
 * plan asking for 4.5?") well before drift trips.
 *
 * "Easy" = any run that:
 *   - is between 3 and 9 mi (excludes warmups, race-pace work, long runs)
 *   - is NOT a duplicate (mergedIntoId not set)
 *
 * Returns the median (more robust than mean to one big outlier) ·
 * rounds to the nearest 0.5 mi to match the rest of the generator's
 * distance rounding doctrine.
 *
 * Returns 0 when there's no recoverable easy-day data · caller falls
 * back to the existing math floor of 3 mi.
 */
/**
 * 2026-06-03 · runner's recent peak long-run distance · used as a floor
 * for the generator's long-run sizing so the plan never authors a long
 * that's shorter than what the runner has actually been doing.
 *
 * Reads the longest run in last 28 days (typically the Sunday long).
 * Returns 0 when no data · caller treats as no floor.
 *
 * ── LOWVOL-1 (2026-08-19) · NO DISTANCE FILTER ─────────────────────────────
 *
 * This query used to carry `AND (data->>'distanceMi')::numeric >= 8` with the
 * comment "long-ish only". That filter switched the long-run injury guard OFF
 * for precisely the runners it protects.
 *
 * The value feeds TWO consumers with opposite polarity. As a FLOOR ("never
 * author a shorter long than the runner just ran") it is only consulted at
 * `recentLongMi >= 8` anyway, so the filter was redundant there. As the
 * `rampCeiling` ANCHOR it is the single-session spike guard — `Research/00a`
 * §"Volume progression rules": "An individual run >110% of longest run in the
 * prior 30 d raises overuse injury risk by ~64%" — and `rampCeiling` returns
 * the unbounded doctrine cap when this reads zero. A runner whose real longest
 * run in 28 days is 6 mi read 0, indistinguishable from no history at all, and
 * was authored a 10 mi week-1 long: 167% of their own prior-30d longest, the
 * exact spike the ramp exists to prevent.
 *
 * MAX over all runs equals MAX over runs ≥ 8 whenever the longest run is
 * itself ≥ 8, so this is byte-identical for every runner the old filter did
 * not silence. It changes only the cohort it was silencing.
 */
/**
 * The runner's longest run in the last 28 days, or `null` when the read FAILED.
 *
 * 2026-08-24 · swallowed-failure sweep · this returned a plain number and the
 * `.catch` fabricated `{ mi: null }`, which `Number(null ?? 0)` turned into
 * **0**. Zero is not a neutral value here: `composePlan` treats
 * `recentLong <= 0` as a cold start and re-seeds the whole volume curve from
 * the runner's onboarding self-report. So one failed read could hand a
 * marathoner a beginner's plan, built off a number they typed in months ago,
 * with nothing anywhere saying the read had failed.
 *
 * Null now means "we could not look". Zero still means "no runs in 28 days",
 * which is a real state and keeps its old behaviour.
 */
async function recentPeakLongMi(userId: string): Promise<number | null> {
  const today = await runnerToday(userId);
  const r = await rowOrNull<{ mi: string | null }>(
    'plan/generate · recentPeakLongMi',
    pool.query<{ mi: string | null }>(
      `SELECT MAX((data->>'distanceMi')::numeric)::text AS mi
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date
            >= $2::date - 28`,
      [userId, today],
    ),
  );
  if (r === null) return null;
  return Math.round((Number(r?.mi ?? 0)) * 10) / 10;
}

/**
 * 2026-06-03 · runner's recent quality-day median distance (last 28d).
 * Rule 2 floor source. "Quality day" = a run that landed on a plan
 * workout of type tempo/threshold/intervals, OR (cold-fallback) a run
 * with avgHr ≥ 85% of effective max. Returns 0 when no signal.
 */
async function recentQualityDistanceMi(userId: string): Promise<number> {
  // 2026-06-03 fix · plan_workouts has NO matched_run_id column.
  // Matching is date-based: JOIN runs ON (data->>'date')::date = pw.date_iso
  // (mirrors runner-calibration.ts and drift-monitor.ts patterns).
  // The previous query silently returned 0 (caught error) · Rule 2
  // floor never fired since it shipped.
  const today = await runnerToday(userId);
  const r = (await pool.query<{ med: string | null }>(
    `WITH q AS (
       SELECT (r.data->>'distanceMi')::numeric AS mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         JOIN runs r
           ON r.user_uuid = tp.user_uuid::uuid
          AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
          AND NOT (r.data ? 'mergedIntoId')
        WHERE tp.user_uuid = $1
          AND pw.type IN ('tempo','threshold','intervals')
          AND pw.date_iso::date >= $2::date - 28
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med FROM q`,
    [userId, today],
  ).catch((e: unknown) => {
    console.error('[recentQualityDistanceMi]', e instanceof Error ? e.message : String(e));
    return { rows: [{ med: null }] };
  })).rows[0];
  const m = Number(r?.med ?? 0);
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.round(m * 2) / 2;
}

/**
 * 2026-06-03 · runner's median quality sessions per week (last 28d).
 * Rule 5 density-ramp source. Returns 0 when no signal.
 */
async function recentQualityPerWeek(userId: string): Promise<number> {
  // 2026-06-03 fix · same bug as recentQualityDistanceMi. plan_workouts
  // has no user_uuid column AND no matched_run_id column. Matching is
  // date-based via JOIN on training_plans + runs.
  const today = await runnerToday(userId);
  const r = (await pool.query<{ avg: string | null }>(
    `WITH wk_q AS (
       SELECT date_trunc('week', pw.date_iso::timestamp) AS wk, COUNT(DISTINCT pw.id)::numeric AS n
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         JOIN runs r
           ON r.user_uuid = tp.user_uuid::uuid
          AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
          AND NOT (r.data ? 'mergedIntoId')
        WHERE tp.user_uuid = $1
          AND pw.type IN ('tempo','threshold','intervals')
          AND pw.date_iso::date >= $2::date - 28
        GROUP BY 1
     )
     SELECT AVG(n)::text AS avg FROM wk_q`,
    [userId, today],
  ).catch((e: unknown) => {
    console.error('[recentQualityPerWeek]', e instanceof Error ? e.message : String(e));
    return { rows: [{ avg: null }] };
  })).rows[0];
  const n = Number(r?.avg ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

async function easyDayMedianMi(userId: string): Promise<number> {
  const r = await pool.query<{ med: string | null }>(
    `WITH easy_runs AS (
       SELECT (data->>'distanceMi')::numeric AS mi
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'distanceMi')::numeric BETWEEN 3 AND 9
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::text
              >= (NOW() - interval '14 days')::date::text
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med
       FROM easy_runs`,
    [userId],
  ).catch(() => ({ rows: [{ med: null }] }));
  const m = Number(r.rows[0]?.med);
  if (!Number.isFinite(m) || m <= 0) return 0;
  // Round to nearest 0.5 mi per the distance-rounding doctrine.
  return Math.round(m * 2) / 2;
}

// ── DOCTRINE-MIDBLOCK-1 (2026-08-24) · the quality window skips the days
//    doctrine itself blanked ────────────────────────────────────────────────
//
// THE DEFECT. `detectMidBlock` asks "has this runner done quality in the last
// 28 days" and reads the answer as evidence about the RUNNER. After a race it
// is not: `Research/00b-recovery-protocols.md` §"Recovery by Distance" has a
// column headed "Total recovery days (no quality)" — 10-14 days for a half,
// 21-28 for a marathon — and the engine spends it, labelling the phase
// "Post-race recovery · Easy running only · no quality." So doctrine removes
// quality from the window, the engine obeys, and then the detector reads the
// obedience as an absence of fitness. Two opposite states — "has not been
// doing quality" and "was told not to do quality" — produce the same count.
//
// The consequence is not hypothetical. `isMidBlock` false makes `sizeBlocks`
// insert a full BASE phase, so a runner who has just raced can be handed weeks
// of easy running plus strides days after a hard race effort. It is worst
// exactly where the mandated window is longest: after a MARATHON the window is
// four weeks, so an authoring one month later looks back over 28 days that
// doctrine guaranteed would be empty, and every signal reads zero.
//
// THE RULE. The window is extended by the number of days inside it that
// doctrine mandated as no-quality. It measures 28 days of ELIGIBLE training,
// not 28 days of calendar — the days doctrine blanked do not get to count as
// evidence of anything.
//
// WHY KEYED ON THE RACE, NOT ON THE PLAN'S PHASE LABEL. The tempting version
// reads the authored rows and asks what was PRESCRIBED — "prescribed no
// quality" being different from "prescribed quality and skipped it". It is
// rejected for the reason DOCTRINE-BASE-3 already rejected it one gate over:
// it would let a prescription outrank doctrine, so a plan that authored
// quality inside a window `Research/00b` says is recovery would make the
// runner's compliance with doctrine read as a deficit. The mandated-window
// test asks instead what DOCTRINE says the window was for, which is knowable
// without trusting any particular plan authored over it. `postRaceRecoveryWeeks`
// is the same reader `rampBaseForBuild`, `pickPlanMode` and `openBlockMode`
// already spend, so the four agree by construction.
//
// WHY A TAPER DOES NOT EXTEND IT. A taper is not a no-quality window, and
// doctrine is explicit that it must not become one. `Research/08` §9.1's Rules
// read "The largest cut is to easy mileage; intensity is preserved through the
// taper", and its §15 mistake table names "Cutting all intensity in taper |
// Sluggish legs". A tapering runner is still doing quality, so the detector
// sees it and needs no allowance. Only the post-race window is blanked by
// doctrine, and only it is skipped here.
//
// SELF-LIMITING IN BOTH DIRECTIONS. The extension is the OVERLAP between the
// mandated window and the last 28 days, so it shrinks to zero as the race
// recedes and the window returns to a flat 28 days. A race that has not yet
// been run, or one whose distance does not resolve to a category, extends
// nothing. Runners with no finished race are byte-identical to today.
/** The quality-detection window, before any mandated-no-quality allowance. */
export const QUALITY_LOOKBACK_DAYS = 28;

/**
 * How many days `detectMidBlock` looks back for this authoring.
 *
 * Pure, and exported for direct unit testing and for the doctrine gate — the
 * worktree has no DB pool, and a claim that cannot exercise the real function
 * is a claim that only proves the test agrees with itself.
 */
export function qualityLookbackDays(
  todayISO: string,
  lastRace: { date: string; distanceMi: number; priority?: string | null } | null,
): number {
  if (!lastRace?.date || !(lastRace.distanceMi > 0)) return QUALITY_LOOKBACK_DAYS;
  const cat = distanceCategoryOrNull(lastRace.distanceMi);
  // A history row, not the goal race, so an unrecognised distance is a real
  // possibility. It explains no mandated window, so the flat window stands.
  if (cat == null) return QUALITY_LOOKBACK_DAYS;
  const noQualityDays = postRaceRecoveryWeeks(cat, lastRace.priority ?? null) * 7;
  if (!(noQualityDays > 0)) return QUALITY_LOOKBACK_DAYS;
  const sinceRace = daysBetween(lastRace.date, todayISO);
  if (!(sinceRace > 0)) return QUALITY_LOOKBACK_DAYS;   // not yet run
  // Days 1…noQualityDays after the race are the ones doctrine blanked. Count
  // those that fall inside the base window, i.e. are at most 28 days ago.
  const firstK = Math.max(1, sinceRace - QUALITY_LOOKBACK_DAYS);
  const lastK = Math.min(noQualityDays, sinceRace);
  const blanked = Math.max(0, lastK - firstK + 1);
  return QUALITY_LOOKBACK_DAYS + blanked;
}

/**
 * 2026-06-01 · detect whether the runner is mid-block · has been doing
 * quality work recently. THREE signals, any one of which is enough:
 *
 *   1. `plan_workouts` carries a PRESCRIBED quality row (threshold /
 *      tempo / intervals / vo2max) in the window, across the active plan
 *      and any plan archived in the last 30 days — a rebuild archives the
 *      active plan, so yesterday's block still counts.
 *   2. The runs feed has runs the importer TAGGED as quality or as a race.
 *   3. The runs feed has runs at ≥85% of effective max HR — catches real
 *      quality work that arrived from Strava or the watch untagged.
 *
 * Each fires at ≥2 occurrences. Returns true if any fires. When true,
 * `sizeBlocks` may skip BASE so a mid-block runner isn't dropped back into
 * a fresh aerobic phase by an auto-rebuild — "may", because the call site
 * conjoins this with `baseRebuilt`, a VOLUME test (see DOCTRINE-BASE-1).
 * This function answers only "has there been quality"; it is not on its own
 * a licence to skip BASE.
 *
 * The window is `qualityLookbackDays`, not a flat 28 days — see
 * DOCTRINE-MIDBLOCK-1 above for why the post-race no-quality window doctrine
 * mandates is skipped rather than counted against the runner.
 *
 * False-positive risk · a one-off hard run won't trigger #1 (it
 * checks PRESCRIBED type, not just one-off effort). #3 needs sustained
 * HR signal · single-day spike doesn't count.
 *
 * KNOWN SHARPNESS LIMIT, recorded rather than fixed: signal 1 counts plan
 * ROWS, so one calendar session that appears in both the active plan and a
 * recently-archived one counts twice. The ≥2 threshold is therefore a
 * weaker statement than "two distinct sessions" whenever more than one
 * non-ancient plan overlaps the window. It is left alone here because
 * tightening it changes who reads as mid-block for every runner, which is a
 * behaviour change this fix deliberately does not make.
 */
/**
 * Has this runner been doing quality lately? `null` when we could not find out.
 *
 * 2026-08-24 · swallowed-failure sweep · all three signals fabricated
 * `{ n: '0' }` on failure, and zero is the answer that means "no quality" —
 * which drops a runner mid-build back to BASE and re-authors their plan around
 * it. Three OR'd signals made it worse, not better: any one of them failing
 * quietly removed a chance to say yes. A signal that could not be read is not a
 * signal that said no.
 */
async function detectMidBlock(userId: string): Promise<boolean | null> {
  // 2026-06-03 · David flagged · was only checking ACTIVE plan for
  // prescribed quality · rebuilds ARCHIVE the active plan, so a runner
  // who's been doing quality for weeks gets dropped back to BASE because
  // the new active plan has no completed quality yet. Expand to include
  // recently-archived plans + HR-based effort detection on runs.
  //
  // 2026-06-03 · runner TZ anchors all "last 28d" windows.
  const today = await runnerToday(userId);
  // DOCTRINE-MIDBLOCK-1 · 28 days of ELIGIBLE training, not 28 days of
  // calendar. See the header above: the days `Research/00b` mandates as
  // "total recovery days (no quality)" are days the engine itself emptied,
  // so they are skipped rather than counted as an absence of quality.
  const { lastRaceFinished } = await loadLastRaceFinished(userId, today)
    .catch(() => ({ lastRaceFinished: null }));
  const lookback = qualityLookbackDays(today, lastRaceFinished);
  // Signal 1 · prescribed quality in the window across all NON-ANCIENT
  // plans (active OR archived within last 30 days · the plan that
  // just got archived by today's rebuild still counts).
  const r1 = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND (tp.archived_iso IS NULL OR tp.archived_iso > NOW() - interval '30 days')
        AND pw.type IN ('threshold','tempo','intervals','vo2max')
        AND pw.date_iso::date BETWEEN ($2::date - $3::int) AND $2::date`,
    [userId, today, lookback]
  ).catch((e) => { logReadFailure('plan/generate · detectMidBlock signal 1 · prescribed quality', e); return null; });
  if (r1 === null) return null;
  if (Number(r1.rows[0]?.n ?? 0) >= 2) return true;

  // Signal 2 · runs with quality-effort tag.
  const r2 = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM runs r
      WHERE r.user_uuid = $1
        AND NOT (r.data ? 'mergedIntoId')
        AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date
            >= $2::date - $3::int
        AND (
              LOWER(COALESCE(r.data->>'type', '')) IN ('tempo','threshold','intervals','vo2max','race')
              OR LOWER(COALESCE(r.data->>'workoutType', '')) ~ '(tempo|threshold|interval|vo2|race)'
            )`,
    [userId, today, lookback]
  ).catch((e) => { logReadFailure('plan/generate · detectMidBlock signal 2 · quality-tagged runs', e); return null; });
  if (r2 === null) return null;
  if (Number(r2.rows[0]?.n ?? 0) >= 2) return true;

  // Signal 3 · HR-based effort detection · ≥2 runs in last 28d with
  // avgHr ≥ 85% of effective max HR (Strava/Watch imports rarely tag
  // type · this catches the runner who's been doing real quality work
  // without the import tagging it). Threshold: 85% maxHR ≈ Z3+ effort.
  // Canonical max HR via the resolver (user_override → 12-month observed
  // → manual stored → null). Replaces the old `SELECT max_hr FROM profile`
  // which queried a non-existent column and silently fell through to a
  // LTHR-derived approximation (round(lthr/0.92) ≈ 176), producing a gate
  // threshold ~4 bpm too low for users with real observed data.
  const effectiveMax = await loadEffectiveMaxHr(userId).then((r) => r.bpm).catch(() => null);
  if (effectiveMax && effectiveMax > 100) {
    const hrThreshold = Math.round(effectiveMax * 0.85);
    const r3 = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM runs r
        WHERE r.user_uuid = $1
          AND NOT (r.data ? 'mergedIntoId')
          AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date
              >= $3::date - $4::int
          AND COALESCE(
                (r.data->>'avgHr')::numeric,
                (r.data->>'avg_hr')::numeric,
                0
              ) >= $2`,
      [userId, hrThreshold, today, lookback]
    ).catch((e) => { logReadFailure('plan/generate · detectMidBlock signal 3 · HR effort', e); return null; });
    if (r3 === null) return null;
    if (Number(r3.rows[0]?.n ?? 0) >= 2) return true;
  }

  return false;
}

// ── Block sizing ────────────────────────────────────────────────────────

export interface BlockPlan {
  totalWeeks: number;
  phases: Array<{ label: string; weeks: number; rationale: string; citation: string }>;
}

/**
 * Race-distance category (Q-02 · SIM-02 fix). The plan generator now
 * differentiates 5K / 10K / HM / M instead of only marathon-vs-not.
 * Each category drives a distinct taper length, race-specific block
 * size, and quality-mix (see qualityMixFor below).
 *
 * Cite: Research/22-plan-templates.md (per-distance template tables);
 *       Research/00a §7-Race-Specific (taper length by distance).  // was §race-specific-prep · heading: ### 7. Race-specific (inside ## The Seven Workout Categories)
 */
// #12 (audit 2026-06-16) · ONE categorizer across the whole generator.
// generate.ts previously kept its own distanceCategoryOf (everything ≥20mi
// collapsed to 'm', no 'ultra' case) while goal-tiers.ts maps >30mi → 'ultra'.
// The divergence meant a 50K goal got the marathon BLOCK_SHAPE (3-wk taper, MP
// race-pace tag, full-distance race-day row) while its volume/long bands came
// from the ultra tier — internally inconsistent, and an ultra's long-run
// finishes were tagged "MP" though ultra race pace is well below marathon pace.
// Re-export goal-tiers' categorizer (which already includes 'ultra') as the
// single source so block shape, taper length, and the race-pace tag all agree
// with the tier the plan is sized for. DistCategory now carries 'ultra'.
// #12 follow-up (2026-08-18) · the re-export is gone and every site in this
// file now goes to `lib/race/distance-category.ts` directly, through the
// refusal below. Two things changed with it:
//
//   · `distanceCategoryOfPublic` is DELETED. It was a second name for the same
//     function, exported so other modules could avoid importing the canonical
//     one — which is how the app grew three categorizers in the first place.
//     Its callers (the simulate route, and a dozen composer tests) now import
//     `distanceCategoryOrNull` / `distanceCategoryOrThrow` from the one module.
//   · Four inline mileage branches in this file that had drifted from the
//     canonical boundaries are gone: see the `race_week_tuneup` sites.
export type { DistCategory };

/**
 * THE categorizer, with the refusal stated at the point of use.
 *
 * `distanceCategoryOrNull` never guesses — a missing, non-finite or
 * non-positive distance is null, not a half marathon. Every site in this file
 * that reaches this helper sits BEHIND the entry-point guard in
 * `generatePlanForUser` ("race distance unrecognized; cannot build a plan for
 * an unknown distance"), so a null here means a caller skipped that guard.
 * Failing loudly at the site that skipped it beats composing a plan for the
 * wrong event, which is the defect the canonical module was written to end.
 *
 * The sites that CAN handle an unknown distance gracefully do not use this —
 * they call `distanceCategoryOrNull` and branch on the null, and there are two:
 * the last-race lookback in `resolveRampBaseFromEvidence` and the next-race
 * build window in `composeMaintenancePlan`.
 */
function distanceCategoryOf(raceDistanceMi: number): DistCategory {
  const cat = distanceCategoryOrNull(raceDistanceMi);
  if (cat == null) {
    throw new Error(
      `lib/plan/generate.ts: ${UNKNOWN_DISTANCE_REASON} (got ${String(raceDistanceMi)}). ` +
        'Guard the caller with distanceCategoryOrNull and refuse, as generatePlanForUser does.',
    );
  }
  return cat;
}

/** Per-category structural numbers per Research/22 + canonical Daniels. */
/**
 * DOCTRINE-3 · the long run's absolute-time ceiling, hours.
 *
 * Research/00a §"Volume progression rules" states the long-run cap as
 * "≤25-30% of weekly volume (or by absolute time: <3.0-3.5 h for marathoners;
 * ultra athletes go longer)". The top of the stated band is the hard ceiling,
 * matching how the engine reads every other doctrine band (take the permissive
 * edge, then let the tighter distance caps bind first).
 */
const LONG_RUN_MAX_HOURS = 3.5;

/** The slow end of the easy band the composer actually emits · spec-builder.ts
 *  `easyHi = easyAnchorT + 120`. Kept as a named constant so the time cap and
 *  the pace prescription cannot drift apart. */
const EASY_BAND_SLOW_OFFSET_SEC = 120;

const BLOCK_SHAPE: Record<DistCategory, { taperWeeks: number; raceSpecificCap: number }> = {
  '5k':    { taperWeeks: 1, raceSpecificCap: 2 }, // short, fast races · minimal taper
  '10k':   { taperWeeks: 2, raceSpecificCap: 3 },
  'hm':    { taperWeeks: 2, raceSpecificCap: 3 },
  'm':     { taperWeeks: 3, raceSpecificCap: 4 },
  // #12 · ultra mirrors the marathon block shape (3-wk taper, deep race-
  // specific block for time-on-feet + race-pace integration). Research/22
  // §Ultramarathon — taper is a marathon-style 3 weeks; the long run, not a
  // pace insert, is the race-specific stimulus (see racePaceTag below).
  'ultra': { taperWeeks: 3, raceSpecificCap: 4 },
};

/**
 * DOCTRINE-BASE-1 (2026-08-18) · the share of the block's own weekly-volume
 * target a runner must already be holding before BASE may be skipped.
 *
 * `Research/00a-distance-running-training.md` §"Volume progression rules":
 * "| Down weeks | Every 3-4 wk, reduce by 20-30% |". That band is the ONLY
 * statement in the research of how far below peak a runner who is genuinely
 * mid-block may legitimately sit — the deepest planned deload leaves them at
 * 70% of peak. A runner further down than doctrine's own deepest down week is
 * not mid-block on a light week; they are short of base, and the weeks that
 * close the gap are base weeks whatever the plan labels them.
 *
 * Bound by DOCTRINE.base-rebuilt-share, which parses the 20-30% band out of
 * that row and asserts this constant is its complement.
 *
 * See the gate itself in `composePlan`, and the defect that motivated it.
 */
export const BASE_REBUILT_SHARE = 0.70;

/**
 * DOCTRINE-BASE-2 (2026-08-19) · the structured sessions a BASE week carries,
 * and the day type each one lands on.
 *
 * ONE, and the one is doctrine's rather than a convention.
 *
 * `Research/04-workout-vocabulary.md` §15's base row states a CEILING —
 * "2 quality sessions/wk max" — and qualifies half of what it names as
 * "OCCASIONAL fartlek/light hills". The opening number is stated directly by
 * the two `Research/00b-recovery-protocols.md` tables that describe a runner
 * rebuilding volume, and they agree:
 *
 *   §"Marathon Recovery (4-week reverse taper)" · week 4 Quality is "One light
 *     tempo (15-20 min @ HMP)", with the Notes column reading "First true
 *     workout. Re-evaluate before adding a second quality session in week 5."
 *   §"Marathon Recovery, Conservative (6-week)" · "Two quality sessions"
 *     appears once, on the row whose Notes read "Resume normal block".
 *
 * Both ladders run 0 → 1 → 2 and both put the second session at the point the
 * block resumes normal training — which in this engine is QUALITY, where the
 * two-slot mixes live. So BASE opens at one and stays at one; §15's "max" is a
 * ceiling this phase never reaches.
 *
 * The strides `DOCTRINE-STRIDES-1` places on the week's easy days are not
 * counted against it. §7.2's own contraindication row is "Not a workout".
 *
 * The type is `intervals` — the engine's existing rep-shaped day. Nothing here
 * needs a new day type, a new column, or a new field on the wire; what makes
 * this a base session rather than a VO2 one is the catalogue SLOT the composer
 * asks with (`speed`), not the type of the row it writes.
 *
 * Bound by `DOCTRINE.base-quality-per-week`, which reads both Research/00b
 * ladders and §15's ceiling.
 */
export const BASE_QUALITY_TYPES: ReadonlyArray<DayPlan['type']> = ['intervals'];

/**
 * DOCTRINE-DOSING-2 (2026-08-18) · the smallest race-pace finish that is still
 * a race-pace session.
 *
 * `Research/04-workout-vocabulary.md` §4.5 "Fast finish long run" prescribes
 * the segment as "final 2-6 mi at MP or slightly faster"; §4.4's marathon-pace
 * long is larger again. Two miles is the bottom of the only band doctrine
 * states for it, so a segment the week's dosing budget cannot size to two miles
 * is not scheduled at all — the long runs easy and the week's threshold work
 * goes to its structured session. Bound by MPLONG.fast-finish-floor.
 */
export const FAST_FINISH_MIN_MI = 2;

// Exported for lib/plan/block-preview.ts (the pre-recovery-complete block-shape
// preview) — it must call this SAME function rather than re-deriving BLOCK_SHAPE
// or the phase-sizing arithmetic. See that file's header for why.
export function sizeBlocks(totalWeeks: number, raceDistanceMi: number, isMidBlock: boolean = false): BlockPlan {
  const cat = distanceCategoryOf(raceDistanceMi);
  const shape = BLOCK_SHAPE[cat];
  const taperWeeks       = shape.taperWeeks;
  // Race-specific = the closest-to-race quality block. Sized by race distance,
  // squeezed only if total runway is too short.
  const raceSpecificWks  = Math.min(shape.raceSpecificCap, Math.max(0, totalWeeks - taperWeeks - 4));
  // Quality block: bigger when there's more runway, capped at 8.
  const remainingAfterTaperAndRS = totalWeeks - taperWeeks - raceSpecificWks;
  const qualityWeeks     = Math.min(8, Math.max(3, Math.floor(remainingAfterTaperAndRS * 0.6)));
  // Base: everything left, but capped at 8 weeks so we don't stall in aerobic
  // forever when the race is far out. If race is >6 months out, the user is
  // effectively in maintenance · the surplus weeks fold into base anyway.
  //
  // 2026-06-01 · mid-block awareness: when the runner has been doing
  // threshold/intervals in the last 28 days, an auto-rebuild that drops
  // them back into a fresh BASE phase is a regression. Skip BASE entirely
  // (baseWeeks = 0) · the freed weeks fold into expandedQuality below.
  // 2026-06-03 · mid-block doctrine RULE 6 (phase compression).
  // Two triggers for skipping BASE:
  //   1. isMidBlock=true · runner has been doing quality recently
  //   2. totalWeeks < 10 · not enough runway to justify a base block
  // either case, BASE folds into QUALITY via the extraWeeks redistribute.
  // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 6
  const baseWeeksRaw     = Math.min(8, Math.max(0, totalWeeks - taperWeeks - raceSpecificWks - qualityWeeks));
  const baseWeeks        = (isMidBlock || totalWeeks < 10) ? 0 : baseWeeksRaw;
  // If base was capped, redistribute the extras into quality so we don't end
  // up with fewer total weeks than the runway.
  const extraWeeks       = Math.max(0, totalWeeks - taperWeeks - raceSpecificWks - qualityWeeks - baseWeeks);
  const expandedQuality  = qualityWeeks + extraWeeks;

  // Build phase list in chronological order (oldest → race day).
  const phases: BlockPlan['phases'] = [];
  if (baseWeeks > 0) phases.push({
    label: 'BASE',
    weeks: baseWeeks,
    rationale: 'Aerobic foundation · easy volume + long progressions, no quality yet.',
    citation: 'Research/00a-distance-running-training.md §periodization',
  });
  if (expandedQuality > 0) phases.push({
    label: 'QUALITY',
    weeks: expandedQuality,
    rationale: 'Intervals + threshold sessions to lift aerobic ceiling.',
    citation: 'Research/04-workout-vocabulary.md §intervals-and-threshold',
  });
  if (raceSpecificWks > 0) phases.push({
    label: 'RACE-SPECIFIC',
    weeks: raceSpecificWks,
    rationale: 'Pace + long-run integration at race-specific demands.',
    citation: 'Research/00a-distance-running-training.md §race-specific',
  });
  phases.push({
    label: 'TAPER',
    weeks: taperWeeks,
    rationale: 'Volume drops sharply, intensity preserved. Sharpen, then race.',
    citation: 'Research/08-pacing-and-race-week.md §taper',
  });

  return { totalWeeks, phases };
}

// ── Volume curve ────────────────────────────────────────────────────────

/**
 * Cutback (deload) cadence · how many weeks between recovery weeks.
 * 2026-06-03 · mid-block doctrine RULE 8: when Banister TSB at generate-
 * time is < -10 (high cumulative load), deload every 3rd week instead of
 * every 4th. null/cold-start → mod-4. Cite docs/PLAN_ENGINE_MID_BLOCK_
 * DOCTRINE.md §Rule 8; Pfitzinger Faster Road Racing §"recovery weeks
 * under load".
 *
 * #13 (audit 2026-06-16) · ONE definition shared by volumeCurve (which
 * cuts the weekly mileage) and layoutWeek (which relaxes the long-run
 * floor on cut weeks). They previously diverged — volumeCurve cut at
 * this cadence while layoutWeek hardcoded mod-4 — so on a TSB<-10
 * runner's deloaded week (mod-3) the long run was pinned to full peak
 * against a reduced budget and the easy days absorbed the cut, the
 * opposite of a deload.
 */
function cutbackCadence(tsbAtStart?: number): number {
  return (typeof tsbAtStart === 'number' && tsbAtStart < -10) ? 3 : 4;
}

export type LevelKey = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;

/* DOCTRINE-7 (2026-08-17) · VOLUME_FLOOR_MPW and RAMP_PCT are DELETED here.
 *
 * Both were declared with `Cite:` blocks and read by nothing. VOLUME_FLOOR_MPW
 * was already neutralised by an explicit `void floor` — VAR-06 (2026-06-23)
 * deliberately replaced it with `max(TRUE_BEGINNER_MIN_MPW, baseMi)` so a
 * detrained runner is not jumped to a tier floor in week 1, and that decision
 * stands. RAMP_PCT's { beginner 5%, intermediate 7%, advanced 7%,
 * advanced_plus 8% } were uncited guesses that contradicted the flat
 * `Math.min(1.10, …)` the engine actually ran.
 *
 * A dead constant carrying a citation is worse than no constant: it reads as
 * doctrine being applied when nothing applies it, and it defeats review. The
 * live ramp ceiling is RAMP_CEILING below; the live volume floor is
 * TRUE_BEGINNER_MIN_MPW inside volumeCurve.
 */

/** Returns target mileage for each week 0..N-1 (chronological).
 *
 * 2026-06-02 rewrite (David's fail-proof generator ask):
 *   · ramp geometrically from baseMi to tier.peakWeeklyMileageBand[0]
 *     (the tier's LOWER bound · ambitious but doctrine-safe)
 *   · cutback every 4th non-taper week to 85% of last peak
 *   · taper math unchanged
 *
 * The geometric ramp is bounded by GENERAL_RAMP_CEILING (Research/00a
 * §"Volume progression rules" · trained 15%/wk, novice 20%/wk). When
 * (peak/base)^(1/climbWeeks) exceeds it we cap the per-week growth and accept
 * that the peak target won't be fully reached — honest about the runway.
 *
 * Cite: Research/00a-distance-running-training.md §"Volume progression rules"
 * Cite: Research/22-plan-templates.md (tier targets via TIER_TARGETS)
 * Cite: Research/08-pacing-and-race-week.md §9.1 (taper depth by distance)
 */
function volumeCurve(
  baseMi: number,
  blocks: BlockPlan,
  level: LevelKey,
  tierTarget: TierTarget,
  /** DOCTRINE-1 · race distance category · sets the TAPER's depth
   *  (Research/08 §9.1) and the general-case ramp regime. */
  taperCat: DistCategory,
  /** 2026-06-03 · Rule 8 · Banister TSB at generate-time. When < -10
   *  (high cumulative stress), shift cutback frequency from every 4th
   *  week to every 3rd week. null = cold-start, falls back to mod-4. */
  tsbAtStart?: number,
): number[] {
  const vols: number[] = [];
  // 2026-06-03 · mid-block doctrine RULE 4 (monotonic volume floor) ·
  // enforced after vols are built (see end of function). The post-build sweep
  // guarantees non-cutback non-taper weeks stay ≥ baseMi - 1.
  // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 4
  // 2026-06-20 · true-beginner volume floor. The research VOLUME_FLOOR (10
  // mpw for 'beginner') is the minimum base for a *trained* beginner; a
  // genuinely sedentary 0-5 mi/week runner shouldn't be floored up to 2-4×
  // their reported base in week 1. For beginners, respect their reported base
  // with a coherence minimum of 6 mpw instead of the 10 floor. Every other
  // level is unchanged — start = max(tier floor, base) — so David /
  // intermediate / advanced plans are byte-for-byte identical.
  // 2026-06-23 · VAR-06 · respect the runner's reported base at EVERY level (generalizing
  // the beginner carve-out below), not just beginners. The old non-beginner `max(floor,
  // base)` jumped a detrained sub-floor runner (e.g. 10mi/wk intermediate) up to the tier
  // floor in week 1 — a big leap that skips the safe ramp and flattened the low
  // weekly-mileage buckets together (David's "weekly mileage doesn't do anything"). A
  // runner already at/above the tier floor (David, any trained runner) is byte-unchanged:
  // max(6, base) == base == max(floor, base) when base >= floor >= 6.
  const TRUE_BEGINNER_MIN_MPW = 6;
  const start = Math.max(TRUE_BEGINNER_MIN_MPW, baseMi);
  // Peak target · LOWER band of the tier so it's achievable from a
  // realistic base. If the runner already exceeds the lower band,
  // aim 10% above their current base (still respects tier doctrine).
  const peakTarget = Math.max(
    tierTarget.peakWeeklyMileageBand[0],
    Math.round(start * 1.10),
  );

  // Build phases · everything before TAPER. Each is a ramp week or a
  // deload (every 4th non-taper week). We pre-mark deload positions
  // along the build span so the ramp targets the right week.
  const buildPhases = blocks.phases.filter((p) => p.label !== 'TAPER');
  const buildWeeks = buildPhases.reduce((s, p) => s + p.weeks, 0);
  // 2026-06-03 · mid-block doctrine RULE 8 (cutback frequency).
  // #13 · shared cadence so layoutWeek's long-run-floor relaxation lands
  // on the SAME weeks this curve actually deloads. Cite §Rule 8.
  const cutbackEveryN = cutbackCadence(tsbAtStart);
  const deloadMask: boolean[] = [];
  for (let i = 0; i < buildWeeks; i++) {
    deloadMask.push(i > 0 && (i + 1) % cutbackEveryN === 0);
  }
  const climbWeeks = deloadMask.filter((d) => !d).length;

  // Geometric ramp factor across climb weeks (skipping deloads).
  // DOCTRINE-7 (2026-08-17) · the ceiling is the GENERAL-CASE ramp, keyed to
  // experience, not the flat 1.10 that cited Research/00a §"The 10% rule —
  // reconsidered" — the section that argues the 10% rule is NOT well supported.
  // ≤10%/wk is doctrine for injury return, post-layoff and youth only, and those
  // regimes ramp elsewhere (injury-builder, adapt's RERAMP_WEEKLY_GROWTH).
  // See goal-tiers.ts GENERAL_RAMP_CEILING for the full sourcing.
  const idealFactor = climbWeeks > 1 && peakTarget > start
    ? Math.pow(peakTarget / start, 1 / (climbWeeks - 1))
    : 1.0;
  const rampCeilingWeekly = GENERAL_RAMP_CEILING[level ?? 'intermediate'];
  const climbFactor = Math.min(rampCeilingWeekly, idealFactor);

  // Walk climb weeks · target = start * climbFactor^N where N is
  // the climbing-week index (skips deloads). Deload weeks = previous
  // climb week × 0.80 (RC2-4 · doctrine is 20-30% reduction; prior 0.85 = 15% — too shallow).
  // Cite: Research/00b-recovery-protocols.md §"Depth of Cutback by Mileage Tier" (20-30%
  // off the highest week of the preceding block). 0.80 sits on the floor of that band.
  // Bound by CUTBACK.depth. (Was cited to Pfitzinger ADM §"Cutback Weeks" with a
  // "(20-25%)" band the doc does not state — DOCTRINE-BOOK-5, 2026-08-17.)
  let climbIdx = 0;
  let lastClimb = start;
  let lastPeak = start;
  let lastDeloadVol: number | null = null; // RC2-4 post-deload WoW guard (see below)
  for (let i = 0; i < buildWeeks; i++) {
    if (deloadMask[i]) {
      const deload = Math.round(lastClimb * 0.80);
      lastDeloadVol = deload;
      vols.push(deload);
    } else {
      const geometricTarget = start * Math.pow(climbFactor, climbIdx);
      // RC2-4 post-deload WoW cap · 20% deload can create a >50% jump when the geometric
      // curve climbs aggressively (e.g. 5mpw → 25mi peak in 14 wks). Cap the FIRST climbing
      // week after a deload to deload × 1.45 so the WoW validator's 50% limit never fires.
      // The cap only bites on that one week; subsequent weeks continue the uncapped curve.
      // DOCTRINE-BOOK-6 (2026-08-17) · 1.45 IS A PRODUCT CONVENTION, NOT A RESEARCH FINDING.
      // It used to cite Pfitzinger ADM §"Cutback Weeks" plus a supposed week-over-week
      // 10%-rule section. (Named rather than quoted: the registry claim greps this file for
      // the exact old string so it cannot come back, and reproducing it here would trip
      // that tripwire.) The
      // cutback half of that is real and lives on the deload line above; the 1.45 half is not
      // doctrine at all. No source prescribes how fast a runner returns from a planned cutback
      // — the number exists only so this curve cannot author a week that validate.ts's own
      // weeklyVolWoWMaxPct ceiling would then reject. What it owes is that relationship, and
      // CONVENTION.post-deload-reentry-cap enforces it: 1.45 must stay strictly under the
      // tightest WoW ceiling in CONSTRAINTS. Cite: Research/00b §"Cutback Weeks" for the
      // deload → return pattern this rides on; the factor itself is ours.
      const cappedTarget = lastDeloadVol != null
        ? Math.min(geometricTarget, lastDeloadVol * 1.45)
        : geometricTarget;
      lastDeloadVol = null;
      const rounded = Math.round(Math.min(cappedTarget, peakTarget));
      vols.push(rounded);
      lastClimb = rounded;
      lastPeak = Math.max(lastPeak, rounded);
      climbIdx++;
    }
  }

  // Taper phase · scale from lastPeak.
  const taperPhase = blocks.phases.find((p) => p.label === 'TAPER');
  if (taperPhase) {
    for (let w = 0; w < taperPhase.weeks; w++) {
      const wksLeft = taperPhase.weeks - w;
      // DOCTRINE-1 (2026-08-17) · taper depth is PER DISTANCE. This used to be a
      // flat 0.82/0.60/0.45 for every race — the marathon row of Research/08 §9.2
      // applied universally, so a 5K raced off 45% of peak where §9.1 asks for
      // 65-75%. One shared model now serves this site AND finalizeComposedPlan.
      // Cite: Research/08 §9.1 (depth by distance) · goal-tiers.ts taperFactor.
      vols.push(Math.round(lastPeak * taperFactor(taperCat, wksLeft)));
    }
  }

  // 2026-06-03 · mid-block doctrine RULE 4 (monotonic volume floor).
  // Sweep over non-deload non-taper weeks · ensure none dip below
  // baseMi - 1. This catches the edge case where rounding compresses
  // a climbing week below the runner's actual base (e.g. start = 35,
  // climbFactor = 1.04, climbIdx 0 = round(35) = 35 ✓ but a flat ramp
  // could land week 1 at round(35 × 1.04 × 0.85 cutback) = 31, which
  // is below baseMi). Deloads + taper allowed to step below.
  const monotonicFloor = Math.max(0, baseMi - 1);
  for (let i = 0; i < buildWeeks; i++) {
    if (deloadMask[i]) continue;
    if (vols[i] < monotonicFloor) vols[i] = monotonicFloor;
  }
  return vols;
}

// ── Weekly layout ───────────────────────────────────────────────────────

export interface DayPlan {
  dow: DOW;
  type: 'easy' | 'long' | 'threshold' | 'intervals' | 'tempo' | 'race' | 'rest' | 'shakeout' | 'race_week_tuneup';
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  subLabel: string | null;
  notes: string;
  /** 2026-08-17 · MIDRACE-1 · embedded mid-block tune-up race day only:
   *  the TUNE-UP race's own goal pace (s/mi), so persistPlan's spec
   *  builder targets the tune-up's pace, not the plan target race's
   *  goal pace. Absent (undefined) on every other day — including the
   *  plan's own race-week race day, which keeps args.goalPaceSec. */
  raceGoalPaceSec?: number | null;
  /**
   * PROGRESSION-1 (2026-08-17) · the overload trajectory's shape for this
   * session, when the slot is a generic threshold / rep session the trajectory
   * owns. Absent on every other day, and on the named `Research/04` §15
   * vocabulary families, whose dose doctrine states by name.
   *
   * `subLabel` is RENDERED from this shape and `buildWorkoutSpec` parses that
   * label straight back, so the shape, the label and the spec are one set of
   * numbers rather than three that have to be kept in step.
   */
  workShape?: WorkShape | null;
  /** Which lever moved this session on from the previous week. Null on the
   *  block's opening dose, on a deload, and when every lever was at its cap. */
  progressionLever?: ProgressionLever | null;
  /** The session's intent · `Design/adaptive-progression-engine.md` §4. */
  challengeZone?: ChallengeZone | null;
  /**
   * COLD-4 (2026-08-17) · THE CALIBRATION INTRO.
   *
   * True on the quality sessions of the opening `CALIBRATION_INTRO_WEEKS` when
   * this plan's fitness anchor is `provisional_mileage` — a VDOT invented from
   * a self-reported mileage bucket rather than measured from anything the
   * runner has run. `persistPlan` passes it to `buildWorkoutSpec`, which emits
   * the session `by_effort` with no pace target.
   *
   * The maintenance seeder has had this since 2026-06-15 and race-prep — where
   * a new runner WITH a goal lands — never got it: a zero-run account was
   * handed a 7 mi threshold session at 8:23/mi in week one. The distance is the
   * runner's own claim and is doctrine-bounded (`Research/00a` caps progression
   * against their longest recent run); the pace was ours.
   *
   * Absent on every other day, so a plan with a measured anchor is
   * byte-identical to before.
   */
  effortCued?: boolean;
}

/**
 * Resolved prescription strings for a (distance × phase × level) combo.
 *
 * Sourced from workout_library (Research/04 + 22), with the previous
 * hardcoded strings as a safety-net fallback. Building this map once per
 * plan generation keeps layoutWeek sync.
 */
export interface ResolvedPrescriptions {
  intervals: string;
  threshold: string;
  tempo: string;   // formula-based; library row is optional
  citationInterval: string;
  citationThreshold: string;
  /**
   * DOCTRINE-VOCAB-1 (2026-08-17) · prescriptions for the workout_library
   * families beyond `vo2max` and `threshold`.
   *
   * The library carries 21 seeded families, all of them transcribed from
   * `Research/04-workout-vocabulary.md` and correct, and `resolvePrescriptions`
   * only ever asked for two of them. The consequence was not subtle: a whole
   * marathon build contained exactly three workout shapes — reps, tempo, long —
   * repeated for eighteen weeks, with `hills`, `fartlek`, `cutdown`,
   * `race_specific` and `marathon_specific` sitting in the table unread.
   *
   * The `tempo` slot's entry is a PHRASE that replaces `tempo` (the caller
   * prefixes the sized distance); every other slot's entry is the whole
   * prescription. That mirrors how `tempo` itself has always been assembled.
   */
  families: Partial<Record<WorkoutFamily, string>>;
}

/**
 * DOCTRINE-VOCAB-1 (2026-08-17) · which family supplies a quality slot.
 *
 * `Research/04` §15 "Training-cycle placement summary" is a five-row table that
 * maps this engine's four phases almost exactly:
 *
 *   | Base (8–12+ wks)          | E, GA, medium-long, long, strides, hill
 *                                 sprints, occasional fartlek/light hills |
 *   | Hill / strength (3–4 wks) | Hill circuit, long hill repeats, hill sprints |
 *   | Specific support (4–6 wks)| T, cruise intervals, mile repeats at slower I,
 *                                 alternations |
 *   | Race-specific (4–8 wks)   | Race-pace workouts, MP long runs, Canova
 *                                 structures, 4×2 mi for HM |
 *   | Sharpening / taper        | Reduced-volume versions of recent workouts;
 *                                 strides; short race-pace work |
 *
 * DOCTRINE-BASE-2 (2026-08-19) · BASE gets §7's SPEED row, and it used to get
 * nothing. This header read "BASE has no quality slot in this engine and
 * doctrine does not ask for one", which is not what §15 says: its base row
 * names strides, hill sprints and occasional fartlek/light hills as the
 * phase's Primary workouts and then states a frequency CEILING of two, which
 * is not a sentence anyone writes about a phase that carries none.
 * DOCTRINE-STRIDES-1 put the strides on the easy days — §7.2's own Placement
 * row and its "Not a workout" contraindication both say that is where they
 * belong — and left the rest of the row unplaced. This places it: one
 * structured session a week, drawn from §7, §8's light hills and §9's
 * fartleks, and from nothing else. See `baseQualityTypes` for the frequency
 * and `SLOT_FAMILIES_IN_PHASE` for the families.
 *
 * QUALITY spans both the optional hill block and specific support, so it opens
 * with hills and fartlek and closes with reps; RACE-SPECIFIC becomes race-pace
 * work; TAPER's sharpener is already the race-week tune-up.
 *
 * Each family is placed on the slot whose EXISTING type already matches its
 * shape, so this changes what a workout IS without changing which day it lands
 * on. Placement, gap spacing and every structural invariant are untouched.
 *
 * Per-workout "When in cycle" rows behind each choice:
 *   hills   · §8.3 "Late base, early specific"
 *   fartlek · §9.2 "Base through specific"
 *   cutdown · §12.2 "Specific phase, 5K/10K/HM"
 *   combo   · §10.3 wave tempo "Specific phase HM/marathon"
 *   m-spec  · §11.2 "Specific phase; first block 8–10 weeks out, last 4–5 weeks out"
 *   r-spec  · §14.1-14.3, the 5K / 10K / half race-pace session tables
 */
export function qualityFamilyFor(
  cat: DistCategory,
  phase: string,
  weekIdx: number,
  weeksToPhaseEnd: number,
  slotType: DayPlan['type'],
): WorkoutFamily | null {
  // DOCTRINE-DOSING-2 · the ultra's rep slot is HILLS, in the QUALITY phase.
  //
  // ULTRA-QUAL-1 already ruled I-pace reps out of ultra training
  // (Research/00a:311 "3×1600m at 10K pace (rarely)"), and DOCTRINE-DOSING-2
  // put a rep slot on every ultra QUALITY week to stop it running two T
  // sessions. Those two only agree if the slot is pinned: `Research/22`
  // §Ultramarathon lists "hill repeats" and "hill power" under Key workout
  // types for the 50K and 50 mile, and every sample peak week in that section
  // pairs ONE threshold session with hill work. Without this pin, a
  // late-QUALITY ultra week falls through to the generic I prescription.
  //
  // RACE-SPECIFIC is deliberately NOT covered. §15's row for that phase reads
  // "Race-pace workouts, MP long runs, Canova structures, 4×2 mi for HM" and
  // places no hill session there — the doctrine gate's VOCAB.phase-placement
  // claim catches it if this reaches for one. The ultra's race-specific weeks
  // run a single threshold slot instead; see `qualityTypesFor`.
  if (cat === 'ultra' && slotType === 'intervals' && phase === 'QUALITY') {
    return 'hills';
  }
  // DOCTRINE-BASE-2 · §15's base row, on the one slot a base week carries.
  //
  // `speed` NAMES the row — "strides, hill sprints" is §7 — and the catalogue
  // is free to answer with anything else §15 places beside it, which
  // `SLOT_FAMILIES_IN_PHASE` scopes to §8's light hills and §9's fartleks. That
  // is the same division of labour the QUALITY arm below already runs: this
  // states the §15 RULING the doctrine gate checks, and the selector's
  // least-recently-used rotation picks which member of the row lands this week.
  //
  // Distance-independent, and deliberately. §15's rows are keyed on PHASE, not
  // on the event: an aerobic base week is the same week whether the race at the
  // end of the block is a 5K or a hundred kilometres, which is exactly why the
  // per-distance quality mixes below start at QUALITY and not before it.
  if (phase === 'BASE') {
    return slotType === 'intervals' ? 'speed' : null;
  }
  if (phase === 'RACE-SPECIFIC') {
    // §15 race-specific row. Ultra is deliberately excluded: it trains
    // threshold-dominant off race-paced EFFORT, not rep sessions
    // (Research/00a:311-312, and the existing ULTRA-QUAL-1 ruling).
    if (cat === 'ultra') return null;
    if (cat === 'm') {
      if (slotType === 'threshold') return 'marathon_specific';  // §11.2 Canova 2K reps
      if (slotType === 'tempo')     return 'combo';              // §10.3 wave tempo
      return null;
    }
    // 5K / 10K on the rep slot, half on the threshold slot — §14.1-14.3 put
    // each distance's race-pace session at the pace that slot already targets,
    // so the spec's own pace derivation lands on race pace without a special case.
    if ((cat === '5k' || cat === '10k') && slotType === 'intervals') return 'race_specific';
    if (cat === 'hm' && slotType === 'threshold') return 'race_specific';
    return null;
  }

  if (phase === 'QUALITY') {
    // The last three QUALITY weeks are the block's sharpening end — the same
    // window longFinishSegment already treats as the run-up to race-specific.
    // Before it, §8.3 and §9.2 place hills and fartlek; at it, reps take over.
    const early = weeksToPhaseEnd > 2;
    if (early && slotType === 'intervals') {
      // VOCAB-CATALOGUE-1 · this used to alternate hills and fartlek on
      // `Math.floor(weekIdx / 2) % 2`, which is a two-entry rotation over a
      // vocabulary §8 and §9 write as eleven. The rotation now belongs to the
      // catalogue's selector, which ranks every session §15 places on this slot
      // by least-recently-used — so the runner sees short, medium and long hill
      // repeats, the Lydiard circuit, the hill fartlek and the timed fartlek in
      // turn instead of two strings on a two-week loop.
      //
      // What survives here is the §15 RULING, which is what the doctrine gate's
      // VOCAB.phase-placement claim checks: the hill/strength block belongs on
      // this slot in the early part of QUALITY. `hills` names it, and the
      // catalogue is free to answer with any family §15 places alongside it.
      return 'hills';
    }
    // §12.2 cutdowns are named for 5K/10K/HM only. The marathon's threshold
    // slot keeps its cruise intervals.
    if (!early && slotType === 'threshold' && (cat === '5k' || cat === '10k' || cat === 'hm')) {
      return 'cutdown';
    }
    // SLOT-ROTATE-1 (2026-08-19) · §15's specific-support row names four things
    // and the engine reached for one of them.
    //
    //   | Specific support (4–6 wks) | T, cruise intervals, mile repeats at
    //     slower I, alternations |
    //
    // "mile repeats at slower I" is the rep slot once the hill block is behind
    // it, and "T, cruise intervals" is the threshold and tempo slots for the
    // whole of specific support. Neither was placed here, so those slots fell
    // to the generic `rx.intervals` / `rx.threshold` string for every week of
    // every block — the twelve of a marathon's seventeen quality days the
    // catalogue did not own.
    //
    // These two are DOORS, not prescriptions. `rx.families` carries no row for
    // either (`VOCAB` in `resolvePrescriptions` lists neither), so when the
    // catalogue declines, `vocabRx` is undefined and the slot falls straight
    // back to the overload trajectory that owned it before — which is the
    // half of this that must not be lost. See SLOT-ROTATE-2 in `layoutWeek`
    // for the dose side: the trajectory keeps stepping underneath the rotation
    // and hands the catalogue the at-pace minutes the block has earned, so the
    // identity rotates while the load still climbs.
    if (!early && slotType === 'intervals') return 'vo2max';
    if (slotType === 'threshold' || slotType === 'tempo') return 'threshold';
    return null;
  }

  return null;
}

/**
 * DOCTRINE-VOCAB-1 · the doctrine prescription for each family, per distance.
 *
 * These mirror the seeded `workout_library` rows byte-for-byte in structure, so
 * the DB path and this fallback describe the same workout. Rest values are
 * written as single numbers rather than the doc's bands ("60s" not "60–90s")
 * because the prescription is also the machine-readable recipe that
 * `parsePrescription` turns into a spec — the band lives in the research file
 * and the midpoint lives here.
 */
/**
 * DOCTRINE-VOCAB-1 · the coaching line for each family, from its §"Purpose"
 * row. Coach voice: what it is for, and the one thing to get right.
 */
const FAMILY_NOTES: Partial<Record<WorkoutFamily, string>> = {
  // §7.1 "Short, fast, full-recovery work"; §7.2 Recovery "no fatigue between
  // strides"; §7.2 Contraindications "Not a workout — back off if form
  // deteriorates". The recovery IS the prescription here, so it is what the
  // note says.
  speed:   'Full recovery between reps. This is form and turnover, not a workout.',
  // §8.2 Purpose "Power, tendon stiffness, form"; §8.1 pace column is effort.
  hills:   'Run the climb by effort, not pace. Jog down, full recovery, repeat.',
  // §9.1 "Unstructured to highly structured pace variation within a continuous run."
  fartlek: 'Continuous run. Surge, float, surge. The float is a jog, not a stop.',
  // §12.2 Purpose "final reps at I/R pace force composure under fatigue"
  cutdown: 'Start controlled. Each rep a little faster. The last one is the point.',
  // §10.3 wave tempo · §10 "alternate paces without true recovery"
  combo:   'One continuous block, rolling either side of threshold. No stopping.',
  // §11.2 Canova 2K repeats · marathon-specific
  marathon_specific: 'Marathon-specific. Open at race pace, finish at threshold.',
  // §14 "Workouts whose paces and structures directly mirror race demands."
  race_specific: 'Race pace, race rhythm. This is the dress rehearsal for the effort.',
};

// VOCAB-CATALOGUE-1 (2026-08-18) · `inlineFamilyPrescriptions` is DELETED.
//
// It was one fixed string per (family, distance) — `'6×90s hills @ 5K-10K
// effort · 2:30 jog down'` for every hills slot at every distance in every week
// of every plan — and it was the whole vocabulary the engine could express for
// §15's families. `lib/workout-catalogue/` now holds all 59 of Research/04's
// named workouts as cited data and `catalogue-rx.ts` renders whichever one the
// selector places on the slot, so there is nothing left for a fixed table to
// do. `rx.families` is now the workout_library rows and nothing else; a family
// with no row and no catalogue session falls through to the generic
// intervals/threshold/tempo prescription below, exactly as an unseeded family
// always has.

/** Inline last-resort prescriptions — match the historical doctrine in this
 *  file. Library reads supersede these.
 *
 *  Exported 2026-06-02 so the generator-bench test can call composePlan
 *  without going through the DB workout_library query. */
export function inlinePrescriptions(cat: DistCategory): ResolvedPrescriptions {
  return {
    intervals:
        cat === '5k'    ? '5×800m @ I pace · 90s jog'
      : cat === '10k'   ? '4×1km @ I pace · 2:00 jog'
      : cat === 'hm'    ? '6×800m @ I pace · 90s jog'
      : cat === 'ultra' ? '3×1mi @ I-T transition · 2:00 jog' // ULTRA-IREP-1 (2026-06-23): Research/00a §"Workout dose by race distance" cap = 2-3×1600m "rarely" for 100K; 5× over-counts; 3× stays within doctrine max
      :                   '5×1mi @ I-T transition · 2:00 jog',
    threshold:
        cat === '5k'  ? '3×1mi @ T pace · 60s jog'
      : cat === '10k' ? '4×1km @ T pace · 60s jog'
      : cat === 'hm'  ? '3×1mi @ T pace · 2:00 jog'
      :                 '4×1mi @ T pace · 90s jog',
    tempo:        'continuous tempo',
    citationInterval:  'Research/04-workout-vocabulary.md §6',
    citationThreshold: 'Research/04-workout-vocabulary.md §5',
    // VOCAB-CATALOGUE-1 · no inline family table any more. `resolvePrescriptions`
    // fills this from workout_library where rows exist; the catalogue supplies
    // the session itself.
    families: {},
  };
}

/**
 * Resolve prescription strings for one plan, preferring the workout_library
 * table. Falls back to the inline catalog on any miss so plan generation
 * never blocks.
 */
export async function resolvePrescriptions(
  cat: DistCategory,
  phase: 'quality' | 'race_specific',
  level: LevelKey,
): Promise<ResolvedPrescriptions> {
  const fallback = inlinePrescriptions(cat);
  const lvl = level ?? undefined;

  const phaseFit = phase === 'race_specific' ? 'race_specific' : 'quality';

  // DOCTRINE-VOCAB-1 (2026-08-17) · ask the library for every family
  // Research/04 §15 places in this phase, not just the two it used to.
  // `qualityFamilyFor` decides which of them a given week's slot actually
  // uses; resolving them all here keeps the read to a single round of
  // queries against an in-process-cached table.
  const VOCAB: WorkoutFamily[] = ['hills', 'fartlek', 'cutdown', 'combo', 'marathon_specific', 'race_specific'];
  const [intervalsT, thresholdT, ...vocabT] = await Promise.all([
    pickWorkout({ family: 'vo2max' as WorkoutFamily, distance: cat, phase: phaseFit, level: lvl }),
    pickWorkout({ family: 'threshold' as WorkoutFamily, distance: cat, phase: phaseFit, level: lvl }),
    ...VOCAB.map((family) => pickWorkout({ family, distance: cat, phase: phaseFit, level: lvl })),
  ]);

  // Library row wins; the inline doctrine string is the floor. A family with
  // neither (e.g. `combo` for a 5K, which doctrine does not place there) is
  // simply absent, and qualityFamilyFor never asks for it.
  const families: Partial<Record<WorkoutFamily, string>> = {};
  VOCAB.forEach((family, i) => {
    const row = vocabT[i];
    // `combo` is a phrase the caller prefixes with a sized distance, so a
    // library row that leads with its own fixed mileage ("6 mi continuous
    // wave tempo") would double the number. Strip the leading distance.
    if (row?.prescriptionText) {
      families[family] = family === 'combo'
        ? row.prescriptionText.replace(/^\s*\d+(?:\.\d+)?\s*mi\s+/i, '')
        : row.prescriptionText;
    }
  });

  return {
    families,
    intervals:        intervalsT?.prescriptionText  ?? fallback.intervals,
    // HM-RSPEC-1 (2026-06-23): HM race-specific threshold should be 5×1mi (Research/00a §"Workout dose by race distance"
    // "5–6×1mi at half-marathon pace"), not the quality-phase 3×1mi. The DB row wins when present;
    // fallback distinguishes race-specific from quality for the HM inline prescription.
    threshold:        thresholdT?.prescriptionText
                   ?? (phase === 'race_specific' && cat === 'hm' ? '5×1mi @ T pace · 90s jog' : fallback.threshold),
    tempo:            fallback.tempo,
    citationInterval: intervalsT?.citation          ?? fallback.citationInterval,
    citationThreshold: thresholdT?.citation         ?? fallback.citationThreshold,
  };
}

/**
 * DOCTRINE-MPLONG-1 (2026-08-17) · the marathon-pace long run is a CADENCE
 * session, not a weekly one.
 *
 * `Research/04-workout-vocabulary.md` §4.4 "Marathon-pace long run" states the
 * dose and the rhythm in the same table:
 *
 *   | Common dose | 14–18 mi total with 10–14 mi at MP |
 *   | Frequency   | Every 2–3 weeks during marathon specific phase |
 *   | When in cycle | 6–10 weeks out from goal marathon |
 *
 * `longFinishSegment` read the dose and ignored the rhythm: it put a
 * 50%-of-the-long marathon-pace finish on EVERY race-specific week, and
 * `qualityTypesFor` put two structured sessions beside it in the same seven
 * days. §16 "Combinations to avoid" names that pairing outright — "MP long run
 * + hard tempo within 5 days | Same energy system, same impact pattern, no
 * recovery between". The measured cost was a race-specific block at 58-71%
 * easy against a 75% doctrinal floor.
 *
 * The 80/20 pass (`applyIntensityFloor`) was the first half of the fix and is
 * an after-the-fact correction: it hands surplus hard miles back by shrinking
 * the finish it should never have authored, which lands every race-specific
 * week on exactly the floor. This is the other half — the CADENCE — and it
 * removes the cause rather than trimming the symptom.
 *
 * The rule, stated so a reader can check it against the table above:
 *
 *   · The MP long lands every `MP_LONG_CADENCE_WEEKS` weeks, counted BACKWARDS
 *     from the last week of the race-specific phase, so the session closest to
 *     the taper always carries it and the cadence is plan-length independent.
 *   · A cutback week never carries it. The deload exists to absorb the block's
 *     fatigue and the MP long is the block's single biggest quality session;
 *     putting one on the other defeats both. When the cadence lands on a
 *     deload the session steps back one more week, which spends exactly the
 *     latitude doctrine already grants ("every 2–3 weeks") and never more.
 *   · The intervening long runs are plain easy longs.
 *
 * DOCTRINE-HMLONG-1 (2026-08-17) · the half is now on the same cadence. When
 * this constant landed, the half was reported rather than moved and the
 * decision left open. It has since been ruled on: §4.5 "Fast finish long run"
 * states the same rhythm in its own table —
 *
 *   | Frequency     | Every 2–3 weeks              |
 *   | When in cycle | Specific phase, marathon and HM |
 *
 * — so §4.5 owes the half exactly what §4.4 gave the marathon, and the reason
 * offered for holding off was itself the symptom. The half's race-specific
 * block measured 75% easy *because* `applyIntensityFloor` was shaving the
 * finish it should never have authored: across the half archetype matrix, 100%
 * of race-specific weeks carried a finish and 83% of those came out shaved,
 * every week pinned to within a point of the floor. A floor that fires
 * every single week is not a safety net, it is the generator's real behaviour
 * arriving through a correction pass.
 *
 * The half reuses `racePaceLongThisWeek` unchanged, so it inherits both
 * properties the marathon's cadence already has: measured backwards from the
 * phase end, so the last race-specific week always carries one; and never
 * landing on a deload.
 */
export const MP_LONG_CADENCE_WEEKS = 2;

/**
 * Does the marathon-pace long run land in the week at `weekIdx`?
 *
 * Pure and self-contained: the phase's last week is `weekIdx + weeksToPhaseEnd`,
 * and the deload mask is the same `(i + 1) % cutbackEveryN === 0` formula
 * `volumeCurve` and `layoutWeek` already share, so this needs no knowledge of
 * the plan beyond what `layoutWeek` is handed.
 */
export function racePaceLongThisWeek(
  weekIdx: number,
  weeksToPhaseEnd: number,
  cutbackEveryN: number,
): boolean {
  const isCutbackAt = (i: number) => i > 0 && (i + 1) % cutbackEveryN === 0;
  // Anchor on the phase's LAST week — the one closest to the race — and step
  // back. Anchoring on the first week instead would make the cadence depend on
  // where the phase happens to start, so a 15- and a 16-week build would put
  // the final MP long a different distance from race day.
  let i = weekIdx + weeksToPhaseEnd;
  if (isCutbackAt(i)) i -= 1;
  // The sequence descends strictly, so this terminates; the guard is belt and
  // braces against a caller passing a degenerate cutbackEveryN.
  for (let guard = 0; i >= 0 && guard < 500; guard++) {
    if (i === weekIdx) return true;
    if (i < weekIdx) return false;
    let next = i - MP_LONG_CADENCE_WEEKS;
    if (isCutbackAt(next)) next -= 1;   // stretch to the 3-week end of the band
    i = next;
  }
  return false;
}

/**
 * DOCTRINE-TAPERMP-1 (2026-08-17) · the marathon taper keeps its marathon-pace
 * work.
 *
 * `Research/08-pacing-and-race-week.md` §9.1 states the principle:
 *
 *   "The largest cut is to easy mileage; intensity is preserved through the
 *    taper."
 *
 * and §9.2 "Marathon taper structure (3 weeks)" states the sessions:
 *
 *   | -3 | 80-90% peak | Final MP-specific (14-16 mi w/ 10-12 mi at MP) | ... |
 *   | -2 | 60-70% peak | 6-8 mi at MP, or 4-5 mi threshold              | ... |
 *   | -1 | 40-50% peak | 3-4 mi w/ 4-6 x 1 min at 5K pace, 4-5 days out | ... |
 *
 * `qualityTypesFor` collapsed the whole taper to `['race_week_tuneup']`, which
 * is the -1 row applied to all three. That is not a taper, it is a volume cut
 * with the intensity cut too — the exact distinction §9.1 draws. A marathoner
 * who has spent the block rehearsing MP stops rehearsing it at the moment the
 * rehearsal matters most, and the last MP running before race day ends up
 * being 4-5 weeks stale.
 *
 * The engine's phase layout maps onto §9.2 exactly, which is what makes this
 * fixable without touching the volume curve: the race week IS the -1 row and
 * already carries `race_week_tuneup` (its own 5K-pace prime), so the two
 * non-race TAPER weeks are -3 and -2, and the volume curve already puts them
 * at ~80% and ~57% of peak.
 *
 * The doses below are the MIDPOINTS of the bands in the table above. They are
 * targets, not floors: `taperMpDose` scales them down when the week cannot
 * afford them, which is what keeps a 25 mi/wk marathoner from being handed a
 * 15-mile quality session. The scale preserves the doctrine's MP-to-total
 * ratio, so a scaled session is still recognisably the same workout.
 *
 * What is deliberately NOT restored: §9.2's -2 row also asks the long run to
 * carry "MP miles late". `Research/04` §16 "Combinations to avoid" names "Fast
 * finish long run before goal race | Adds depletion in taper window", and the
 * two cannot both be honoured. §16 is the more specific claim about the taper
 * window, so the taper long stays easy and the MP work lives in the quality
 * session where §9.2 puts most of it.
 */
export const TAPER_MP_DOSE = {
  /** -3 week · "Final MP-specific (14-16 mi w/ 10-12 mi at MP)" · band midpoints. */
  final:  { totalMi: 15, mpMi: 11 },
  /** -2 week · "6-8 mi at MP" · band midpoint, plus a 2mi WU and a 1mi CD. */
  primer: { totalMi: 10, mpMi: 7 },
} as const;

/**
 * The marathon taper's MP session for one week, or null when this week has none.
 *
 * `weeksToPhaseEnd` is 0 on the race week, so the two non-race taper weeks are
 * 1 (=-2, the primer) and 2 or more (=-3, the final MP-specific). A one-week
 * taper therefore gets the primer, which is the right way round: the session
 * closer to race day is the smaller one.
 *
 * `budgetMi` is the week's quality-day allocation ceiling; the returned session
 * never exceeds it.
 */
export function taperMpDose(
  weeksToPhaseEnd: number,
  budgetMi: number,
): { totalMi: number; mpMi: number; warmupMi: number; cooldownMi: number } | null {
  if (weeksToPhaseEnd < 1) return null;              // race week · §9.2's -1 row
  const dose = weeksToPhaseEnd >= 2 ? TAPER_MP_DOSE.final : TAPER_MP_DOSE.primer;
  if (!(budgetMi > 0)) return null;
  const scale = Math.min(1, budgetMi / dose.totalMi);
  const totalMi = Math.round(dose.totalMi * scale * 2) / 2;
  const mpMi = Math.round(dose.mpMi * scale * 2) / 2;
  // Below ~3mi of MP the session stops being a marathon-pace rehearsal and
  // becomes a jog with a surge. §9.2's own alternative for the -2 week is
  // "4-5 mi threshold"; the caller falls back to the tune-up rather than ship
  // a session doctrine would not recognise.
  if (mpMi < 3 || totalMi - mpMi < 1) return null;
  const warmupMi = Math.round((totalMi - mpMi) * (2 / 3) * 2) / 2;
  return { totalMi, mpMi, warmupMi, cooldownMi: Number((totalMi - mpMi - warmupMi).toFixed(1)) };
}

/**
 * 2026-06-07 · Audit D follow-up · long-run race-pace finish for the late
 * build. Returns {pct, tag} or null (plain easy long). Derived from PHASE
 * POSITION (weeks from the end of the phase), so it holds for any plan
 * length — an 8-week and a 16-week build both get the finish in their last
 * three QUALITY weeks, never by a hardcoded absolute week number.
 *
 * Doctrine · Research/22 §3:
 *   HM "endurance build → LT + LR with HMP segments → race-specific HMP":
 *       marathon-pace warm-in through the last QUALITY weeks, stepping to
 *       HMP at the QUALITY→RACE-SPECIFIC seam, then HMP through race-specific.
 *   M  "long run w/ last N @ M": race pace IS marathon pace → every finish @ MP.
 *
 *   RACE-SPECIFIC (on cadence):     40% @ {HM | MP}   (see `cadenceWeek`)
 *   QUALITY last wk:                33% @ {HM | MP}   (HMP step for HM)
 *   QUALITY 2nd-from-last:          33% @ {M  | MP}   (M-pace warm-in for HM)
 *   QUALITY 3rd-from-last:          30% @ {M  | MP}
 *   earlier QUALITY / BASE / TAPER: null
 *
 * 5K/10K (racePaceTag null) → null everywhere · they train via reps, not
 * long-run pace inserts.
 */
function longFinishSegment(
  phase: string,
  weeksToPhaseEnd: number,
  racePaceTag: 'HM' | 'MP' | null,
  /** DOCTRINE-MPLONG-1 / DOCTRINE-HMLONG-1 · `racePaceLongThisWeek` for this
   *  week. Only the RACE-SPECIFIC arm consults it; the QUALITY warm-in ramp is
   *  three weeks long and already a cadence of its own. */
  cadenceWeek: boolean = true,
): { pct: number; tag: 'HM' | 'M' | 'MP' } | null {
  if (!racePaceTag) return null;
  // Research/22 §3 Advanced peak week: "16mi LR w/ last 8mi @ HMP" = 50%.
  // §4 Marathon peaks at 64-70%; Research/00a §fast-finish says 10-25% (general principle).
  // 0.50 targets the §22 minimum for the race-specific phase; QUALITY ramp (0.30→0.33→0.33)
  // builds toward it progressively.
  if (phase === 'RACE-SPECIFIC') {
    // DOCTRINE-MPLONG-1 · Research/04 §4.4 "Every 2–3 weeks during marathon
    // specific phase". DOCTRINE-HMLONG-1 · §4.5 "Fast finish long run" carries
    // the same "Every 2–3 weeks" in its own Frequency row, and names the half
    // in "When in cycle | Specific phase, marathon and HM". Off-cadence weeks
    // run the long easy, for both distances.
    if (!cadenceWeek) return null;
    return { pct: 0.50, tag: racePaceTag };
  }
  if (phase !== 'QUALITY') return null;
  // Last three QUALITY weeks build toward race pace. HM ramps M → M → HMP;
  // M holds MP throughout (race pace == marathon pace).
  const mTag: 'M' | 'MP' = racePaceTag === 'HM' ? 'M' : 'MP';
  switch (weeksToPhaseEnd) {
    case 0:  return { pct: 0.33, tag: racePaceTag };  // last QUALITY wk · HMP step / MP
    case 1:  return { pct: 0.33, tag: mTag };
    case 2:  return { pct: 0.30, tag: mTag };
    default: return null;                             // earlier QUALITY · plain long
  }
}

function layoutWeek({
  phase, weekIdx, weeksToPhaseEnd, totalWeeks, weeklyMi, peakWeeklyMi, longRunDow, qualityDows, restDow, isRaceWeek, raceDow, raceDistanceMi, rx, easyMileFloor, recentLongMi, recentQualityDistanceMi, tierTarget, trainingDaysPerWeek, cutbackEveryN = 4, baseBuilding = false, availableDows = null, easyPaceSecPerMi = null, trajectory = null, weekTPaceSec = null, weekIPaceSec = null, weekMpPaceSec = null, catalogueHistory = null, level = null,
}: {
  phase: string; weekIdx: number;
  /** 2026-06-07 · Audit D follow-up · 0-indexed weeks remaining until this
   *  phase ends (0 = last week of the phase). Drives the late-QUALITY
   *  long-run finish window in a plan-length-independent way. */
  weeksToPhaseEnd: number;
  totalWeeks: number;
  weeklyMi: number;
  /** 2026-06-23 · DIST-1 · peak weekly volume of the whole plan (max of the volume
   *  curve). Scales the marathon/ultra long so it REACHES peakLongMiBand[1] when weekly
   *  volume peaks, instead of topping out short via weeklyMi × longShare. */
  peakWeeklyMi: number;
  longRunDow: DOW; qualityDows: DOW[]; restDow: DOW;
  isRaceWeek: boolean; raceDow: DOW | null; raceDistanceMi: number;
  rx: ResolvedPrescriptions;
  /** 2026-06-03 · runner's recent peak long · floors longMi so plan
   *  never asks for a long shorter than what the runner just did. */
  recentLongMi?: number;
  /** 2026-06-03 · Rule 2 · runner's typical quality-day distance ·
   *  floors qualityMiEach so plan never asks for a shorter tempo/
   *  threshold than the runner is already running. */
  recentQualityDistanceMi?: number;
  /** 2026-06-01 · runner's actual 14-day easy-day median. Floors the
   *  per-easy distance in non-race weeks so the plan never asks for a
   *  4.5-mi easy day when the runner is comfortably running 6+ mi
   *  easy. Pass 0 to skip the floor (falls back to historical math). */
  easyMileFloor?: number;
  /** 2026-06-02 · tier targets from Research/22 (via lookupTierTarget).
   *  Drives longShare + caps the long-run upper bound at the tier
   *  band. Without it, the generator was producing goal-blind plans. */
  tierTarget: TierTarget;
  /** 2026-06-10 · cap total running days to the runner's stated
   *  frequency (excess easy slots become rest). NULL → fill all slots. */
  trainingDaysPerWeek?: number | null;
  /** #13 (audit 2026-06-16) · deload cadence shared with volumeCurve so the
   *  long-run-floor relaxation lands on the weeks the volume curve actually
   *  cut. 3 under TSB<-10, else 4. Defaults to 4 (legacy mod-4) when omitted. */
  cutbackEveryN?: number;
  /** 2026-06-20 · base-building (beginner) plan: quality days are LIGHT (a
   *  short tempo / fartlek with surges), never structured I/R reps, and only
   *  in the sharpen phase. Gated to level==='beginner' (templateFor), so
   *  intermediate/advanced are unchanged. Research/22 §5K/10K/HM/M Beginner. */
  baseBuilding?: boolean;
  /** 2026-06-20 · days the runner can run. When set, easy days fill only these
   *  and every other day is rest (long/quality already land on available days
   *  via the upstream derivation). null = unrestricted (existing behaviour). */
  availableDows?: Set<number> | null;
  /** DOCTRINE-3 · the SLOW end of the runner's own easy band, s/mi. Drives the
   *  long run's absolute-TIME cap (Research/00a §"Volume progression rules":
   *  "<3.0-3.5 h for marathoners"). null → no time cap (pace unknown). */
  easyPaceSecPerMi?: number | null;
  /**
   * PROGRESSION-1 · the block's default overload trajectory. Stateful and
   * ordered — `composePlan` steps it once per week in ascending week order,
   * which is the order it already calls this function in.
   *
   * null keeps the pre-2026-08-17 behaviour exactly: every week of a phase
   * renders the same fixed prescription string. That is what the maintenance
   * and recovery composers, which have no build to progress through, want.
   */
  trajectory?: OverloadTrajectory | null;
  /** The week's threshold pace (s/mi) — the same number `buildWorkoutSpec`
   *  will pace the session at. Evidence-derived; never a calendar ramp. */
  weekTPaceSec?: number | null;
  /** The week's rep pace (s/mi), for the interval track's caps. */
  weekIPaceSec?: number | null;
  /** ZONE-R-1 · the runner's marathon pace (s/mi), from `marathonPaceSPerMi`.
   *  Anchors the catalogue's M and MP zones — §11.3's and §4.4's marathon-pace
   *  sessions were declined `no-anchor` without it. */
  weekMpPaceSec?: number | null;
  /**
   * VOCAB-CATALOGUE-1 · the plan's running record of which catalogue sessions
   * it has already authored. Stateful and ordered, the same contract as
   * `trajectory`: `composePlan` walks weeks in ascending order and each week's
   * choices are recorded for the next.
   *
   * The selector's rotation is LEAST RECENTLY USED, and its per-cycle caps
   * ("1x per training cycle") are counted here, so without this every week of a
   * block would open on the same session — the defect the rotation exists to
   * prevent. null keeps the pre-2026-08-18 behaviour exactly: the composer
   * falls back to the fixed `rx` strings, which is what the maintenance and
   * recovery composers want.
   */
  catalogueHistory?: CatalogueHistory | null;
  /**
   * The runner's experience tier, for the catalogue's contraindication rows
   * (§8.5 "not for novice runners", §10.2 "practice each in isolation first").
   * null → the catalogue is not consulted; the tier gate has no safe default
   * and guessing one is how a beginner gets handed a Canova block.
   */
  level?: LevelKey;
}): DayPlan[] {
  // Race week: all roads lead to race day.
  if (isRaceWeek && raceDow != null) {
    const days: DayPlan[] = [];
    for (let d = 0; d < 7; d++) {
      const dow = d as DOW;
      if (dow === raceDow) {
        days.push({
          dow, type: 'race', distanceMi: raceDistanceMi, isQuality: true, isLong: true,
          subLabel: 'RACE', notes: 'Execute the plan. Pacing in race-week briefing.',
        });
      } else {
        // Day before race: 2mi shakeout w/ strides. 2 days before: rest.
        const daysBeforeRace = (raceDow - dow + 7) % 7;
        if (daysBeforeRace === 1) {
          // DOCTRINE-STRIDES-1 · the strides move from the notes into the
          // sub_label. They have been in this row's copy since it was written
          // and in no spec, so the day before every race the watch ran a flat
          // 2-mile jog under a label promising four 20-second strides.
          days.push({ dow, type: 'shakeout', distanceMi: 2, isQuality: false, isLong: false, subLabel: 'SHAKEOUT · 4×20s strides', notes: '2 mi easy. Loosen the legs.' });
        } else if (daysBeforeRace === 2) {
          days.push({ dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off feet. Hydrate.' });
        } else if (daysBeforeRace === 5) {
          // 2026-06-09 state-audit Tier 2.2 · the race-week tune-up.
          // Research/08 §9.3: the race-prep session sits ~5 days out —
          // HM/M: 4×1km at race pace w/ 90s jog; 5K/10K keep the
          // shorter 2×0.5mi @ T primer. The audit found race week
          // carried ZERO quality (last touch 10 days out) · legs go
          // flat into the gun. This is also the WATCHING test point:
          // hold race pace at honest HR here and the race plan is
          // confirmed.
          // RACEWK-SHARP-1 (2026-06-23) · marathon/ultra race-week sharpener must be 5K pace not race
          // pace. Research/08 §9.3 "3 mi w/ 5×1min @ 5K pace, 4-5 days out" — MP is too slow to be a
          // neuromuscular primer. TAPER-phase already used 5K pace (line 1269); race-week now matches.
          // #12 follow-up (2026-08-18) · THE categorizer, not four raw mileage
          // thresholds. These read `>= 31` against the canonical 31.07 ultra
          // floor (so a 31.0-mile race was an ultra here and a marathon
          // everywhere else), `>= 20` against the canonical 19.65 hm|m line,
          // `>= 12` against nothing canonical at all, and `< 7` against 7.75 —
          // four boundaries in one function, none of them the app's.
          //
          // The tune-up STRINGS stay as they are: they are Research/08 §9.3's
          // race-week primers, and `Research/04`'s workout catalogue does not
          // carry them (it is the training vocabulary, not the race-week
          // template). What changes is which row a given race lands on.
          const tuneCat = distanceCategoryOrNull(raceDistanceMi);
          const isUltra = tuneCat === 'ultra';
          const isMarathonPlus = tuneCat === 'm' || tuneCat === 'ultra';
          const isLongRace = tuneCat === 'hm' || isMarathonPlus;
          days.push({
            dow, type: 'race_week_tuneup',
            distanceMi: isLongRace ? 5 : 4,
            isQuality: true, isLong: false,
            // ULTRA-TUNE-1 (2026-06-23) · ultra race-week tune-up uses T-pace (threshold primer), NOT I-pace
            // (5K pace). Ultra race pace is 10–14+ min/mi — running 5K-pace reps (30–40% faster than race
            // pace) the week before a 100K is physiologically wrong. Research/00a §taper: "intensity preserved"
            // at the runner's training intensity (threshold, not VO2max) for ultra. 5K-SHARP-1 · 5K/10K now
            // uses 5K-pace reps (Research/00a §taper: "intensity preserved"). Shorter reps to match distance.
            // The 5k row is the canonical categorizer's, not a `< 7` guess.
            subLabel: isUltra ? '5×400m @ T pace · 90s jog'
              : isMarathonPlus ? '5×400m @ 5K pace · 2min jog'
              : isLongRace ? '4×1km @ race pace · 90s jog'
              : tuneCat === '5k' ? '5×200m @ 5K pace · 90s jog'
              : '4×400m @ 5K pace · 90s jog',  // 10K
            notes: isUltra
              ? 'Threshold strides, 5 days out. Hold T effort · just under comfortably hard. Brief neuromuscular prime.'
              : isMarathonPlus
              ? 'Five sharp 5K-pace reps, 5 days out. Brief neuromuscular primer. Legs stay fresh.'
              : isLongRace
              ? 'Race-pace primer, 5 days out. Hold goal pace, even reps, stop at 4. Confidence check, not a workout.'
              : 'Short race-pace strides, 5 days out. Quick turnover · finish feeling sharp, not tired.',
          });
        } else if (daysBeforeRace >= 3 && daysBeforeRace <= 4) {
          // TAPER-RW-1 · time-based easy prescription (not distance). 35-45 min at conversational
          // pace; the distance is a planning guide only.
          // Cite: Research/08-pacing-and-race-week.md §"9.3 Day-by-day race week templates" —
          // every published template puts the T-3/T-4 days at an easy run in minutes, not
          // miles (marathon Wed 30-40 / Thu 0-30, half Wed 35-45 / Thu 30-40). Bound by
          // TAPER.race-week-easy-duration. (Was `Daniels §Race-week sharpening`, a section
          // the gate could not open — DOCTRINE-BOOK-7, 2026-08-17.)
          //
          // TAPER-RWT3-1 (2026-08-17) · T-3 splits by distance; it used to be a
          // flat 35 min for every race. §9.3's half template makes T-3 "Easy + 6
          // strides · 30-40 min" and its marathon template makes the same day
          // "Rest or short easy shakeout · 0-30 min" — the marathon deliberately
          // takes a near-rest day three out before the longest race on the
          // board. 35 sits inside the half's row and five minutes over the
          // marathon's ceiling, so the one number could not be right for both.
          // The ultra has no §9.3 template of its own; it takes the marathon's
          // row as the nearest and most conservative published one, which is
          // consistent with §9.1 giving the ultra the longest taper and the
          // deepest volume cut of any distance. T-4 is unchanged: 40 min sits
          // inside both templates' Wednesday rows.
          const raceWeekCat = distanceCategoryOf(raceDistanceMi);
          const minEasyT3 = raceWeekCat === 'm' || raceWeekCat === 'ultra' ? 30 : 35;
          const minEasy = daysBeforeRace === 4 ? 40 : minEasyT3;
          days.push({ dow, type: 'easy', distanceMi: 3 + (daysBeforeRace === 4 ? 1 : 0), isQuality: false, isLong: false, subLabel: `EASY · ${minEasy} MIN`, notes: `${minEasy} min easy. Conversational effort throughout. Strides optional at end.` });
        } else {
          // TAPER-RW-1 · early race-week easy days also time-based (35-45 min)
          const earlyEasy = daysBeforeRace > 5;
          days.push({ dow, type: earlyEasy ? 'easy' : 'rest', distanceMi: earlyEasy ? 4 : 0, isQuality: false, isLong: false, subLabel: earlyEasy ? 'EASY · 40 MIN' : 'REST', notes: earlyEasy ? '40 min easy. Keep it truly easy · save the legs.' : '' });
        }
      }
    }
    // 2026-06-21 · PLACE-A · availability in race week. The offset-based
    // placement above is blind to availableDows — it could put the tune-up or
    // a midweek easy on a day the runner said they can't run (the standard-week
    // easy-fill respects availability; the race-week branch did not). When
    // availableDows is set, relocate the shakeout + tune-up to the nearest
    // available day in their window, and rest any non-race running day that
    // isn't available. The RACE day is the sole exemption — it's fixed by the
    // calendar. null availableDows → untouched (David / legacy).
    const restRow = (dow: number, note: string): DayPlan => ({
      dow: dow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: note,
    });
    if (availableDows != null) {
      const isAvail = (dow: number) => availableDows.has(dow) || dow === raceDow;
      for (const role of ['shakeout', 'race_week_tuneup'] as const) {
        const idx = days.findIndex((d) => d.type === role);
        if (idx < 0 || isAvail(idx)) continue;
        const window = role === 'shakeout' ? [1, 2, 3] : [5, 4, 6];
        for (const off of window) {
          const dow: number = ((raceDow - off) % 7 + 7) % 7;
          if (dow !== raceDow && isAvail(dow) && days[dow].distanceMi === 0) {
            days[dow] = { ...days[idx], dow: dow as DOW };
            break;
          }
        }
        days[idx] = restRow(idx, 'Off. Taper week · rest is the work now.');
      }
      for (let d = 0; d < 7; d++) {
        if (d !== raceDow && days[d].distanceMi > 0 && !isAvail(d)) {
          days[d] = restRow(d, 'Off. Not one of your run days this week.');
        }
      }
    }
    // 2026-06-10 · frequency cap also applies to race week. Without it a
    // 3-day runner saw 6 running days in their race week (race + shakeout
    // + tune-up + 3 easies). 2026-06-21 · PLACE-B · trim in priority order.
    // RACEWEEK-TUNEUP-DROP-1 (2026-06-23) · previous order (easy → tune-up → shakeout)
    // made a 2-day runner keep race + shakeout instead of race + tune-up. The tune-up
    // is the week's key quality prime (§9.3); the shakeout is just a loosening jog.
    // Correct order: easy → shakeout → tune-up. freq 1 → race only,
    // freq 2 → race + tune-up. The race day always stays. NULL frequency → untouched.
    if (trainingDaysPerWeek != null) {
      let running = days.filter((d) => d.distanceMi > 0).length;
      for (const role of ['easy', 'shakeout', 'race_week_tuneup'] as const) {
        if (running <= trainingDaysPerWeek) break;
        for (const d of days) {
          if (running <= trainingDaysPerWeek) break;
          if (d.type === role && d.distanceMi > 0) {
            const wasTuneup = d.type === 'race_week_tuneup';
            d.type = 'rest'; d.distanceMi = 0; d.subLabel = 'REST';
            d.notes = wasTuneup
              ? 'Off. Too few run days this week to fit the tune-up · rest is the work now.'
              : 'Off. Taper week · rest is the work now.';
            running--;
          }
        }
      }
    }
    return days;
  }

  // Standard week: 1 long, 1-2 quality, rest = easy, 1 rest day.
  // 2026-06-02 · longShare is tier-driven (from Research/22). BASE
  // phase keeps a lower share since the long is the only quality.
  // TAPER pulls back to a recovery long. QUALITY + RACE-SPECIFIC use
  // the full tier share.
  /**
   * DOCTRINE-BASE-2 · the week's R pace, from the one function that answers
   * "what is this zone worth".
   *
   * `anchorsFor` is the same call `selectSlotWorkout` makes a few hundred lines
   * below and the same resolver `buildWorkoutSpec` prices a rep off, so the
   * pace a §7 speed day is SIZED at and the pace it is RUN at are one number by
   * construction — which is the property `catalogue-rx.ts`'s header calls the
   * whole safety gate. Null when the runner's implied VDOT falls outside
   * Daniels' published 30-85 table, which is the honest answer, and the sizing
   * falls back to the I anchor.
   *
   * Only BASE reads it (the `repetition` quality family is BASE-only), so it is
   * resolved only there — `resolveZoneAnchors` walks the VDOT table and this
   * function runs once per week of every plan in a 120k-archetype sweep.
   */
  const weekRPaceSec = phase === 'BASE'
    ? (anchorsFor({
        tPaceSec: weekTPaceSec, iPaceSec: weekIPaceSec, mpPaceSec: weekMpPaceSec ?? null,
      }).R ?? null)
    : null;
  const longShare = phase === 'BASE' ? Math.max(0.28, tierTarget.longRunShare - 0.04)
                  : phase === 'TAPER' ? 0.28
                  : tierTarget.longRunShare;
  // DAY-SIZE-1 (2026-08-17) · `qualityShare` is now the FALLBACK day budget,
  // not the primary one.
  //
  // It was a flat share of weekly volume spent on the whole quality DAY, which
  // charged the day's warm-up and cool-down — easy miles, by
  // `Research/04-workout-vocabulary.md` §5.3's own "2-3 mi E each side" —
  // against the intensity allowance. At 55 mi/wk over two quality days that is
  // 6.05 miles for the day, leaving about three at threshold against a doctrine
  // band of four to eight on a week whose Daniels cap permitted 5.5.
  //
  // Build and race-specific weeks now size each quality day from its own
  // session (see `lib/plan/quality-day.ts`). This share survives for the paths
  // that are NOT sized that way and must stay byte-stable: BASE (no quality),
  // TAPER (whose two session kinds — the §9.2 MP block and the tune-up — are
  // already sized by doctrine), the beginner fartlek, and any prescription
  // whose at-pace volume cannot be read out of the string.
  const qualityShare = phase === 'BASE' ? 0
                     : phase === 'TAPER' ? 0.18
                     : 0.22;  // total across quality days
  // Which weeks size their quality days from the session. TAPER is excluded
  // because both of its session kinds already carry a doctrine-stated dose;
  // `baseBuilding` because a beginner's sharpen day is an easy run with surges
  // in it, not a workout with easy legs around it; and a week with no pace
  // anchor because there is then no way to turn minutes of work into miles.
  //
  // DOCTRINE-BASE-2 · BASE is now INCLUDED, and it has to be. `qualityShare` is
  // zero there and stays zero — a base week's easy volume is not a pool the
  // quality day draws a percentage from — so the only way its structured day
  // gets a size at all is from the session itself: §17.1's warm-up jog, the
  // reps, the walk-back jogs, §17.4's cool-down. Without this the day would
  // round to zero miles and the INV13 guard below would demote it to rest,
  // which is the same "quality slot the engine sized at nothing" this
  // workstream removed everywhere else.
  const doctrinalDaySizing = phase !== 'TAPER' && !baseBuilding
    && weekTPaceSec != null && weekTPaceSec > 0;
  // Cap long at the tier's peakLong upper bound · no overdistance
  // beyond what doctrine prescribes. Use the higher of two sizes:
  //   · weeklyMi × longShare (the volume-curve derived target)
  //   · runner's recent peak long (don't author a shorter long than
  //     they just did · 2026-06-03 fix · David's plan was sizing
  //     Sun 6/7 at 9mi when his 5/31 long was 12.36mi).
  // Allow cutback weeks to step slightly below the recentLong floor.
  // #13 · cadence threaded from volumeCurve (same cutbackCadence(tsb)) so a
  // TSB<-10 runner's mod-3 deload weeks relax the long-run floor on the weeks
  // the volume curve actually cut — not the stale hardcoded mod-4. For
  // non-taper weeks layoutWeek's absolute weekIdx equals volumeCurve's build-
  // week index (build phases precede TAPER), so the masks line up exactly.
  const isCutback = weekIdx > 0 && (weekIdx + 1) % cutbackEveryN === 0;
  const longCat = distanceCategoryOf(raceDistanceMi);
  // ULTRA-LONG-CAP-1 (2026-06-23): elite-tier ultra has peakLongMiBand[1]=32, which exceeds
  // the 50K race distance (31.1mi). Cap at 95% of raceDistanceMi for ultra so training long
  // never exceeds the race; for 100K (62.1mi) the tier cap of 32 already dominates so the
  // min() is a no-op. All non-ultra distances (marathon peak 22-25mi < 26.2mi) are unaffected.
  const longCap = (longCat === 'ultra')
    ? Math.min(tierTarget.peakLongMiBand[1], Math.round(raceDistanceMi * 0.95))
    : tierTarget.peakLongMiBand[1];
  // 2026-06-23 · DIST-1 · long-run SIZE, research-grounded:
  //   5k/10k/hm — share of the week (Research/00a:184, ≤25-30%); weeklyMi × longShare
  //     already lands inside the tier's peakLongMiBand, so keep it.
  //   marathon/ultra — DISTANCE-driven toward the doctrine peak (Research/22:219-275 ·
  //     marathon peak long 20-24mi). The marathon long is 45-67% of the week at peak — the
  //     EXPLICIT exemption from the % cap, bounded by TIME not distance (Research/00a:217
  //     "<3-3.5h for marathoners; ultra athletes go longer"). Scale it to REACH
  //     peakLongMiBand[1] exactly when weekly volume peaks, ramping with the volume curve;
  //     weeklyMi × longShare alone tops out ~5mi short of the doctrine peak.
  // DIST-1 · marathon/ultra are distance-driven to peakLongMiBand[1]. RC2-2 (2026-06-23) · HM-advanced
  // (longShare 0.25, peak ~56) reaches only 14 < band[0]=15 via the share path — so for 5k/10k/hm, when
  // the share would underreach band[0] AT PEAK, use the distance-driven size too. Byte-safe: only lifts
  // when the peak share is short of the band floor (elite/int/dev + David's horizon HM stay in-band).
  const drivenLongRaw = peakWeeklyMi > 0 ? Math.round(weeklyMi * (longCap / peakWeeklyMi)) : 0;
  const shareLongRaw = Math.round(weeklyMi * longShare);
  const longMiRaw = (longCat === 'm' || longCat === 'ultra') && peakWeeklyMi > 0
    ? drivenLongRaw
    : (peakWeeklyMi > 0 && Math.round(peakWeeklyMi * longShare) < tierTarget.peakLongMiBand[0])
      ? Math.max(shareLongRaw, drivenLongRaw)
      : shareLongRaw;
  // 2026-06-21 (David signed off): the recent-long floor (don't author a shorter
  // long than the runner just ran) must NOT apply in TAPER — the taper
  // deliberately reduces the long into the race. Flooring it at recentLongMi
  // pinned the taper long flat (wk14 long 14 instead of ~11), a weak taper.
  // Skipping it in TAPER lets the long reduce; the post-compose WoW re-smoother
  // keeps the descending sequence legal.
  // marathon/ultra · NO recent-long floor (the distance-driven ramp above sizes it; a flat
  // floor at recentLongMi would pin every week at the runner's recent peak instead of
  // ramping UP to it only 2-3 times near race day · Research/22:228). 5k/10k/hm keep it.
  const longFloor = (longCat !== 'm' && longCat !== 'ultra' && phase !== 'TAPER' && recentLongMi && recentLongMi >= 8)
    ? Math.round(recentLongMi - (isCutback ? 2 : 0))
    : 0;
  // 2026-06-23 · VAR-02 + A1 · ANCHOR the long to the runner's recent longest run and ramp it
  // GRADUALLY. The longest-run input drives the early long (without this, week 1 jumped to
  // weeklyMi×longShare — a 3mi-longest runner got an 8mi week-1 long, 4× capacity, and the
  // 0-3/3-6/6-10 buckets were byte-identical). A1 fixes the ramp SHAPE: seed week-0 at ≤110% of
  // the REAL recent long (Research/00a:752 · a single run >110% of prior-30d = 64% injury risk),
  // then climb at ≤10%/step toward the doctrine cap, reaching it ~3-4 weeks before the race
  // (Research/22:228 · the long peaks LATE). The old 1.20^(weekIdx+1) ceiling saturated the cap by
  // BASE week 2 (parked at 19 for the whole build) and front-loaded a 117%-of-recent week-1 long.
  // recentLongMi 0 (no self-report) → no anchor (volume-derived size as before).
  const rampCeiling = (() => {
    // COH-3 · the taper long DESCENDS with volume; the build's climbing ramp ceiling
    // (recentLongMi × 1.10^weekIdx) must NOT govern it — for a low recent-long runner the still-
    // climbing ceiling suppressed the FIRST taper long below its volume size, making the SECOND
    // taper long larger (non-monotonic taper). In TAPER, only the doctrine cap + descending
    // longMiRaw apply. Byte-safe for high recent-long runners (their stepCeil already cleared longCap).
    if (phase === 'TAPER') return longCap;
    if (!recentLongMi || recentLongMi <= 0) return longCap;
    // LOWVOL-1 (2026-08-19) · FLOOR to the half mile, not ROUND to the whole.
    // `Math.round` can only ever push this ABOVE the multiple it is enforcing,
    // and proportionally that costs the small runner the most: a 6 mi longest
    // rounded to 7 is 117%, a 5 to 6 is 120%, against doctrine's flat "should
    // not exceed 110% of the longest run in the prior 30 days". Flooring can
    // only reduce, never raise, and lands on the half-mile grid the rest of the
    // generator rounds to.
    const seed = Math.floor(recentLongMi * 1.10 * 2) / 2;      // week-0 ≤110% of recent
    const stepCeil = recentLongMi * Math.pow(1.10, weekIdx);   // ≤10%/step geometric climb
    const peakWeekIdx = Math.max(1, totalWeeks - 4);           // reach the cap ~3-4 wk before race
    const linearTarget = seed + Math.max(0, longCap - seed) * Math.min(1, weekIdx / peakWeekIdx);
    return Math.max(longFloor, seed, Math.round(Math.min(stepCeil, linearTarget)));
  })();
  let longMi = Math.min(
    Math.max(longMiRaw, longFloor),
    longCap,
    rampCeiling,
  );
  // DOCTRINE-3 (2026-08-17) · THE ABSOLUTE-TIME CAP, FINALLY IMPLEMENTED.
  //
  // Research/00a §"Volume progression rules": "Long-run cap | ≤25-30% of weekly
  // volume (or by absolute time: <3.0-3.5 h for marathoners; ultra athletes go
  // longer)". Every cap above this line is a DISTANCE cap. The DIST-1 comment a
  // few lines up even cites the time bound as the reason the marathon long is
  // allowed to break the percentage cap — and then never implements it, so the
  // percentage cap was lifted on an authority that was never applied.
  //
  // The runners this hurts are the slowest ones, which is backwards: a 20-mile
  // long at 13:00/mi is 4 h 20 m — an hour past doctrine's ceiling, aimed
  // squarely at the cohort least equipped to absorb it. Faster runners were
  // never near the bound (a 20-miler at 8:00/mi is 2 h 40 m), so this changes
  // nothing for them.
  //
  // Evaluated at the SLOW end of the engine's own easy band (spec-builder's
  // easyAnchorT + 120), because that is the pace the runner is actually
  // permitted to run the long at — capping against a midpoint would let the
  // permitted pace overshoot the ceiling.
  //
  // Ultra is exempt by the doctrine sentence itself ("ultra athletes go longer").
  if (longCat !== 'ultra' && easyPaceSecPerMi != null && easyPaceSecPerMi > 0) {
    const timeCapMi = Math.floor(((LONG_RUN_MAX_HOURS * 3600) / easyPaceSecPerMi) * 2) / 2;
    // Never cap below the coherence floor a long run needs to still be a long run.
    if (timeCapMi >= 3) longMi = Math.min(longMi, timeCapMi);
  }
  // RP-FREQ-FLOOR (2026-06-24) · race-prep analogue of MAINT-FREQ-FLOOR. A distance-driven long
  // (marathon/ultra DIST-1 above) can over-consume a small week's budget, pinning the easy days at
  // 1mi via perEasyBudgetCap below — the same junk-run class fixed in maintenance. Race-prep can't
  // lift weeklyMi (it is the periodized volume curve), so instead CAP the long to leave ≥2mi for
  // every other running day: longMi ≤ weeklyMi − quality − 2×easyDays. Only when the capped long
  // still stays the longest run (> per-quality, ≥ a 3mi coherence floor, ≥ the recent-long floor);
  // a genuinely volume-constrained week (can't fit a floor-respecting long AND 2mi easies — e.g.
  // 10mpw/6-day) is left as-is. TAPER/cutback are excluded (deliberate deload shapes already
  // floor or descend). Gated on stated frequency so David's null-frequency profiles stay byte-stable;
  // a no-op for healthy-volume weeks where the long never approaches that ceiling.
  //
  // DOCTRINE-BASE-2 · BASE is no longer excluded, and it has to stop being.
  // The exclusion was correct while a base week had no quality day: nothing
  // competed with the long, so nothing could squeeze the easy days under two
  // miles. §15's base row now gets its one session, and on the swept corpus
  // leaving BASE out of this reservation put 392 sub-2-mile runs back into
  // weeks that had the miles to seat every run properly — the exact junk-run
  // class RP-FREQ-FLOOR was written to end, arriving through the one phase the
  // guard did not cover.
  if (trainingDaysPerWeek != null && phase !== 'TAPER' && !isCutback) {
    // The days the week will ACTUALLY schedule, which in BASE is one whatever
    // the runner's preferences list — `effectiveQDows` derives the same number
    // from the same type list further down, and reserving for two would take
    // miles off the long that nothing is going to spend.
    const qDays = phase === 'BASE'
      ? Math.min(qualityDows.length, BASE_QUALITY_TYPES.length)
      : qualityDows.length;
    const easyDays = Math.max(0, trainingDaysPerWeek - 1 - qDays);
    // DAY-SIZE-1 · reserve what a quality day actually costs. This guard exists
    // to stop a distance-driven long swallowing the week and pinning the easy
    // days at 1mi; sizing the reservation off the old 22% share while the days
    // themselves are sized off doctrine would under-reserve by several miles
    // and reintroduce exactly the junk-run class it was written to prevent.
    //
    // DOCTRINE-BASE-2 · a base week reserves for a REPETITION day. §7's speed
    // work spends Daniels' 5% rather than his 10% and carries §17.1's one-mile
    // jog either side rather than §5.3's two, so reserving a threshold day's
    // cost there would take several miles off the long to hold room for a
    // session that is never that big.
    const perQEst = qDays > 0
      ? Math.max(2, Math.round(
          doctrinalDaySizing
            ? maxQualityDayMi({
                family: phase === 'BASE' ? 'repetition' : 'threshold',
                weeklyMi,
                paceSPerMi: phase === 'BASE' ? (weekRPaceSec ?? weekIPaceSec) : weekTPaceSec,
                ceilingMi: null,
              })
            : (weeklyMi * qualityShare) / qDays,
        ))
      : 0;
    const longRoom = weeklyMi - perQEst * qDays - 2 * easyDays;
    const minLong = Math.max(perQEst + 1, 3, longFloor);
    if (longRoom >= minLong && longRoom < longMi) longMi = longRoom;
  }
  // 2026-06-03 · mid-block doctrine RULE 2 (quality distance floor).
  // Floor qualityMiEach at the runner's recent quality-day distance ·
  // 1mi (the −1mi tolerance lets rep-shape work fit). Cap at the
  // weeklyMi share so we don't blow weekly budget on quality.
  // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 2
  const qualityRaw = qualityDows.length > 0 ? Math.round((weeklyMi * qualityShare) / qualityDows.length) : 0;
  const qualityFloor = (recentQualityDistanceMi && recentQualityDistanceMi >= 5)
    ? Math.max(0, recentQualityDistanceMi - 1)
    : 0;
  // 2026-06-21 · quality never dwarfs the long run or the week (INV3/INV4).
  // Symmetric to the easy-fill clamp (easyCeiling = longMi) that fixed the
  // Lilley inversion — the easy clamp guarded easy days only, so a single
  // collapsed quality day (few running days, high weekly budget, short race
  // with a tier-capped small long) could still author a "tempo" LONGER than
  // the long run (e.g. 55mpw weekends-only 5K → 12mi tempo vs 8mi long).
  // Clamp to longMi (long stays the longest run) and 0.6×week (no dwarf);
  // unplaceable residual lowers the weekly total instead of piling on quality.
  // Only binds in the degenerate case — normal plans keep qualityRaw (David's
  // long ≫ quality → min picks qualityRaw, byte-for-byte unchanged).
  const qualityCeiling = Math.max(1, Math.min(longMi || Infinity, Math.round(weeklyMi * 0.6)));
  // RP-FREQ-FLOOR (quality half) · a placed quality session is a real workout, never a 1mi "intervals"
  // (qualityRaw rounds to 1 at the 10mpw floor with two quality days). Floor it at 2mi for stated-
  // frequency non-deload weeks — the RP-FREQ-FLOOR long cap above already reserved 2mi/quality, so the
  // budget balances. Capped at qualityCeiling so it never exceeds the long. null-freq/BASE/TAPER/cutback
  // and healthy weeks (qualityRaw ≥ 2) are byte-unchanged.
  const qualityFloorFreq = (trainingDaysPerWeek != null && phase !== 'BASE' && phase !== 'TAPER' && !isCutback) ? 2 : 0;
  const qualityMiEach = Math.min(Math.max(qualityRaw, qualityFloor, qualityFloorFreq), qualityCeiling);
  // DAY-SIZE-1 · the week's OWN budget bound on a doctrinally-sized quality day.
  //
  // Sizing the day from the session is right, and on a small week it still has
  // to be paid for out of somewhere. The long run keeps its distance and every
  // other running day keeps the 2mi coherence floor RP-FREQ-FLOOR reserves for
  // it; what is left over is what the quality days may spend. Without this, an
  // 18-mile week over six running days spends doctrine's warm-up and cool-down
  // out of the easy days and leaves one of them at a mile — the junk-run class
  // `_maint_invariants` holds at zero, arriving by a new route.
  //
  // Gated on a stated frequency, which is exactly when the engine knows how
  // many days it owes a runner; and applied ONLY to the doctrinal sizing, so
  // `qualityMiEach` and every path still using it are byte-unchanged.
  //
  // DOCTRINE-BASE-2 · the divisor is the days the week will actually SCHEDULE,
  // which in BASE is one whatever the runner's preferences list. Dividing a
  // base week's room between two days it never fills halves the ceiling and
  // shrinks the one session that does land.
  const scheduledQDayCount = phase === 'BASE'
    ? Math.min(qualityDows.length, BASE_QUALITY_TYPES.length)
    : qualityDows.length;
  const qualityWeekRoomMi = (trainingDaysPerWeek != null && scheduledQDayCount > 0)
    ? (weeklyMi - longMi - 2 * Math.max(0, trainingDaysPerWeek - 1 - scheduledQDayCount)) / scheduledQDayCount
    : Infinity;
  const doctrinalDayCeiling = Math.max(1, Math.min(qualityCeiling, qualityWeekRoomMi));

  // Pre-allocate: rest = 0, long + quality slotted in
  const slots: (DayPlan | null)[] = new Array(7).fill(null);
  slots[restDow] = { dow: restDow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
  // 2026-06-02 · race-pace label varies by race distance · "MP" only
  // makes sense for a marathon target. HM target → HM pace. 5K/10K
  // target → no MP insert at all (those distances train via reps, not
  // long-run pace inserts).
  // #12 (audit 2026-06-16) · keyed on the shared category, not a raw mileage
  // threshold, so an ULTRA (>30mi) no longer trips the old `>=25 → 'MP'` arm.
  // Ultra race pace sits well below marathon pace, so tagging a long-run finish
  // (or race day) "MP" is wrong; ultras build via the long run / time-on-feet,
  // so they take the null branch (no race-pace long-run insert), same as 5K/10K.
  const cat = distanceCategoryOf(raceDistanceMi);
  const racePaceTag = cat === 'm'  ? 'MP'
                    : cat === 'hm' ? 'HM'
                    : null;  // 5k / 10k / ultra → no long-run pace insert
  // 2026-06-07 · Audit D follow-up · race-pace finish for late-build longs.
  // RACE-SPECIFIC keeps its 40% finish; the last three QUALITY weeks now
  // also carry the M→HMP warm-in (Research/22 §3). Encoded into the
  // sub_label ("LONG · 4mi @ M") so buildWorkoutSpec's extractFinishSegment
  // picks it up and the watch executes easy-build + finish — closing the
  // generator side of the D1 gap (in-place row patches fixed the active
  // plan; this fixes every future regen + new runner).
  // DOCTRINE-MPLONG-1 / DOCTRINE-HMLONG-1 · does the race-pace long land this
  // week? Both the marathon's MP long (§4.4) and the half's fast-finish long
  // (§4.5) carry "Every 2–3 weeks", so both walk the same cadence.
  const racePaceLongWeek = phase === 'RACE-SPECIFIC' && racePaceTag != null
    && racePaceLongThisWeek(weekIdx, weeksToPhaseEnd, cutbackEveryN);
  // The MARATHON-only consequences hang off this narrower flag: §16's forbidden
  // "MP long run + hard tempo" pairing (the half's race-specific mix is
  // threshold + intervals, which §16 does not name) and DAY-SIZE-1's at-pace
  // cap. Extending either to the half is a separate decision and is not taken
  // here — the ruling was about the long run's rhythm, not the week's shape.
  const mpLongWeek = racePaceTag === 'MP' && racePaceLongWeek;
  // DOCTRINE-TAPERMP-1 · the marathon taper's MP session (Research/08 §9.2).
  // Marathon only — the half, 5K, 10K and ultra tapers have no MP row in that
  // table and keep their 5K-pace tune-up. `baseBuilding` (true beginner) is
  // excluded: §9.2 is a competitive-marathoner taper, and a beginner's taper
  // stays the light sharpen day Research/22 §Beginner prescribes.
  const taperMp = (phase === 'TAPER' && !isRaceWeek && cat === 'm' && !baseBuilding)
    ? taperMpDose(weeksToPhaseEnd, qualityCeiling)
    : null;
  const finishSeg = longFinishSegment(phase, weeksToPhaseEnd, racePaceTag, racePaceLongWeek);
  // DOCTRINE-DOSING-2 · the long-run finish is a DOSE, and it was never charged
  // to one. A half of the long run at marathon pace is marathon-pace mileage —
  // `dosePaceOf` reads it as M, `splitDay` counts its miles as hard — but the
  // segment was sized purely as a fraction of the long, so a 21 mi long on a
  // 54.5 mi race-specific week shipped 11 mi at MP against `Research/01`'s "the
  // lesser of 18 mi or 20% of weekly mi" (10.9). This is the same doctrine
  // `weekDosingFindings` measures afterwards, applied here so it is never
  // authored. `weekDoseContext` keeps the taper out of the percentage half —
  // Research/08 §9.2 prescribes 10-12 mi at MP on an 80-90%-of-peak week by
  // name, and §9.1 says why (see `capEnforced`).
  //
  // An @HM finish doses T, not M, and takes the T budget accordingly — which is
  // also why the structured slots below reserve against it rather than spending
  // the same ten percent twice.
  const finishPace: DosePace | null = finishSeg
    ? (finishSeg.tag === 'HM' ? 'T' : 'M')
    : null;
  const weekDoseContext: DosingContext =
    isRaceWeek ? 'race-week' : phase === 'TAPER' ? 'taper' : 'training';
  const finishBudgetMi = finishPace
    ? weeklyDoseBudgetMi(weeklyMi, finishPace, weekDoseContext)
    : Infinity;
  const finishRawMi = finishSeg
    ? Math.min(Math.round(longMi * finishSeg.pct), Math.floor(finishBudgetMi * 2) / 2)
    : 0;
  // DOCTRINE-DOSING-2 · a race-pace finish the week cannot afford is not run at
  // all, rather than run as a fragment.
  //
  // `Research/04` §4.5 sizes a fast-finish long as "final 2-6 mi at MP or
  // slightly faster", and §4.4's marathon-pace long is larger still. Below two
  // miles there is no session in doctrine that the segment corresponds to — it
  // is a mile of race pace tacked onto a long run, which §4.5's own "Not a hard
  // workout" cousin (Research/00a's "Easy long with surges") describes better
  // than its fast-finish row does.
  //
  // This binds on the smallest bases, where Daniels' 10% cannot buy two miles
  // at threshold: an 18 mi/wk half-marathoner's whole weekly T allowance is
  // 1.8 mi. On those weeks the long runs easy and the week's threshold work
  // goes to the structured session, which is a coherent week rather than a
  // shrunken imitation of a bigger runner's. `hasFinish` is what the quality
  // mix keys on below, so the freed slot comes back automatically.
  const finishMi = finishRawMi >= FAST_FINISH_MIN_MI ? finishRawMi : 0;
  const hasFinish = finishSeg != null && finishMi > 0 && finishMi < longMi;
  slots[longRunDow] = {
    dow: longRunDow, type: 'long', distanceMi: longMi, isQuality: false, isLong: true,
    subLabel: hasFinish ? `LONG · ${finishMi}mi @ ${finishSeg!.tag}` : 'LONG',
    notes: hasFinish
      ? `Steady ${longMi - finishMi}mi, then ${finishMi}mi at ${finishSeg!.tag === 'HM' ? 'half-marathon pace' : 'marathon pace'}.`
      : phase === 'TAPER' ? 'Easy long, hold pace. Quality lives in the race itself.'
      : 'Conversational throughout. Build the engine.',
  };
  // DAY-SIZE-1 · on a marathon-pace long week, the MP block IS the week's
  // race-specific stimulus.
  //
  // `Research/04` §4.4 calls it "the marathon-specific stimulus" and gives it a
  // cadence — "every 2-3 weeks" — and `racePaceLongThisWeek` exists precisely so
  // it is not competing with a full structured session every week. §16 already
  // takes the tempo out of these weeks; the one structured session that remains
  // must not now grow into the space the MP dose occupies.
  //
  // So on THESE weeks only, the structured session is bounded by what is left of
  // the week's intensity allowance after the MP block has taken its share. It is
  // the reverse of `applyIntensityFloor`'s default give-back order, and
  // deliberately: that pass reads the long-run finish as the surplus in an
  // over-dense week, which is right when the finish is on every week and wrong
  // on the three where doctrine put it on purpose. The threshold track has the
  // rest of the block to grow in; the §4.4 cadence has three sessions.
  // The floor keeps the session a session. On a week where the MP block alone
  // is most of the intensity allowance the remainder goes to zero, and a
  // structured day the engine sizes at zero is not a deload — it is a row the
  // runner reads as broken. Two of doctrine's shortest quality repetitions
  // (`MIN_QUALITY_REP_MINUTES`, itself Research/04 §6's 3-minute floor) is the
  // smallest thing that is still a rep set, and the intensity floor pass gives
  // back the difference from the long exactly as it always has.
  const mpLongAtPaceCapMi = (mpLongWeek && hasFinish)
    ? Math.max(
        (2 * MIN_QUALITY_REP_MINUTES * 60) / (weekTPaceSec && weekTPaceSec > 0 ? weekTPaceSec : 480),
        weeklyMi * (1 - EASY_SHARE_FLOOR) - finishMi,
      )
    : null;
  /* ── DOCTRINE-BASE-2 (2026-08-19) · what a BASE week's quality mix is ───────
   *
   * ONE slot, and the one is doctrine's, not a convention.
   *
   * §15's base row states the CEILING — "2 quality sessions/wk max" — and a
   * ceiling is not a target; the row's own Primary-workouts column qualifies
   * the second half of what it names as "OCCASIONAL fartlek/light hills".
   * `Research/00b` states the opening number directly, in the two tables that
   * describe a runner rebuilding volume:
   *
   *   §"Marathon Recovery (4-week reverse taper)"
   *     | Week 3 | 50-60% | ... | Strides + light fartlek (4-6× 1 min @ 10K
   *       effort) | First structured surges. No threshold or VO2max. |
   *     | Week 4 | 70-80% | ... | One light tempo (15-20 min @ HMP) | First
   *       true workout. Re-evaluate before adding a second quality session in
   *       week 5. |
   *   §"Marathon Recovery, Conservative (6-week)"
   *     | 4 | 55% | 70-80 min easy | Light fartlek |
   *     | 5 | 70% | 80-90 min easy | Tempo 15-20 min @ HMP |
   *     | 6 | 85% | 90+ min, optional MP segments | Two quality sessions |
   *       Resume normal block |
   *
   * Both ladders run 0 → 1 → 2, and both put the SECOND session at the point
   * the block resumes normal training — which in this engine is QUALITY, where
   * the two-slot mixes below already live. So BASE opens at one and stays at
   * one, and §15's "max" is never reached inside the phase.
   *
   * Bound by `DOCTRINE.base-quality-per-week`, which reads both tables.
   *
   * The strides on the week's easy days are NOT this session and are not
   * counted against it: §7.2's own contraindication row is "Not a workout".
   *
   * The slot's TYPE is `intervals` — the engine's existing rep-shaped day —
   * because nothing about this needs a new day type, a new column or a new
   * field on the wire. What differs from a QUALITY rep day is which doctrine
   * row the session comes out of, and that is settled by the catalogue slot
   * (`speed`, see the `ComposerSlot` resolution below), not by the day type.
   */
  const baseQualityTypes: Array<DayPlan['type']> = BASE_QUALITY_TYPES.slice();
  {
    // Q-02 fix: quality mix now varies by race distance per Research/22.
    // 5K leans VO2max heavy (intervals); 10K balanced threshold + intervals;
    // HM threshold-dominant + race-specific MP; M long-run + threshold +
    // marathon-pace integration. Race-specific phase still steers harder
    // toward race-specific quality regardless of distance.
    // #12 · `cat` is the shared categorizer hoisted above (includes 'ultra').
    // The `/* m / ultra */` arms are the explicit fall-through: an ultra trains
    // aerobic-dominant with threshold support (Research/22 §Ultramarathon), so
    // the marathon quality mix is the right default — but the long-run finish is
    // NOT tagged MP (racePaceTag is null for ultra above).
    // Quality type mix as a FUNCTION of the week index (only QUALITY alternates by parity), so the
    // QUAL-PHASE-STABLE placement below can inspect both parities and anchor the days to the more
    // gap-demanding one — keeping the runner's training WEEKDAYS fixed while the workout TYPE rotates.
    const qualityTypesFor = (wi: number): Array<DayPlan['type']> => baseBuilding
      // Base-building (beginner): a single LIGHT tempo/fartlek in the sharpen
      // phase only; BASE weeks are pure easy + strides + long. No structured
      // I/R reps — Research/22 §Beginner (Higdon Novice / Mayo). Sized small
      // below (the 3mi tempo floor is lifted for base-building).
      ? ( phase === 'TAPER' ? ['race_week_tuneup']
        : (phase === 'QUALITY' || phase === 'RACE-SPECIFIC') ? ['tempo']
        : [] )
      // DOCTRINE-BASE-2 · one slot in BASE, from §15's base row. See
      // `baseQualityTypes` above for the frequency and the two Research/00b
      // ladders it is read from. The true-beginner arm above keeps its empty
      // list: Research/22 §Beginner builds on easy running and the strides
      // DOCTRINE-STRIDES-1 already places, and §7.3's own contraindication row
      // rules hill sprints out for exactly that runner ("Not for first-month-
      // back runners; require base of easy running").
      : phase === 'BASE' ? baseQualityTypes
      :
        // DOCTRINE-TAPERMP-1 · the marathon taper's non-race weeks run the
        // MP-specific session Research/08 §9.2 prescribes; every other distance
        // (and the marathon's own race week, and a week too small to carry a
        // recognisable MP dose) keeps the 5K-pace tune-up, which IS §9.2's -1
        // row. One quality slot either way — PP-3's "one quality session in a
        // non-race taper week" is untouched.
        phase === 'TAPER'         ? (taperMp ? ['tempo'] : ['race_week_tuneup'])
      // ── DOCTRINE-DOSING-2 (2026-08-18) · ONE SESSION PER PACE FAMILY, PER WEEK ──
      //
      // `threshold` (cruise intervals) and `tempo` (a continuous block) are the
      // SAME pace in Daniels' taxonomy — both are T — and every mix below used
      // to pair them, or to pair `intervals` with itself. That is the shape
      // behind 1055 of the corpus's 1750 weekly-cap breaches: two individually
      // legal sessions summing to 13-25% of a week against doctrine's 10%.
      //
      // The fix is not to halve both sessions. Doctrine states the frequency
      // directly, and it is one:
      //
      //   · §5.2 continuous tempo, Frequency: "1×/week or ALTERNATING with
      //     cruise intervals" — the two forms of T work alternate ACROSS weeks;
      //     they are not run in the same seven days.
      //   · §6.2 mile repeats, Frequency: "Every 7-10 days"; §6.3 1000m
      //     repeats, "Weekly during VO2max block" — one I session, not two.
      //   · §16 "Combinations to avoid": "Two threshold sessions back-to-back |
      //     Only the Norwegian double-day model handles this, and only with
      //     sub-threshold pacing" — which the engine does not prescribe.
      //   · `Research/01` §"Dosing rules": the 10% / 8% weekly columns, which
      //     are what one full-dose session of each already spends.
      //
      // So the pairs below now alternate the FORM of the T session week to week
      // (§5.2's own instruction) instead of running both forms at once, and the
      // second slot goes to the family whose weekly budget is untouched. Every
      // week still carries two quality sessions — §15's "2 quality/wk" is
      // unchanged — and each keeps its full doctrinal dose rather than half of
      // one. `assertOnePerPaceFamily` below holds the invariant.
      : phase === 'RACE-SPECIFIC'
          // 5K/10K keep the race-pace rep session (§14.1-14.2, resolved to the
          // `race_specific` family) and spend the other slot on threshold, which
          // §15's race-specific row names in the same breath ("4×2 mi for HM").
          // Running the rep session twice broke §6.2's "every 7-10 days" and
          // put 2× the 8% I budget in one week.
          ? (cat === '5k'   ? ['intervals', 'threshold']
           : cat === '10k'  ? ['intervals', 'threshold']   // RACE-SPEC-10K-1 (2026-06-23): 10K race-specific dominates with I-pace reps (Research/00a §"Workout dose by race distance" "3–4×2km at 10K pace"), mirrors 5K
           // DOCTRINE-HMLONG-DOSE-1 · on the week the half's fast-finish long
           // lands, the CRUISE session comes out — the direct analogue of
           // DOCTRINE-MPLONG-1, forced by a collision the marathon does not
           // have. The marathon's long finishes at MP and its structured slot
           // runs at T: different pace families, different budgets, no clash.
           // The half's finishes at HM race pace, which `Research/01`
           // §"Pace conversion from a race time" places inside T ("~half-
           // marathon pace to 15K pace") — so a cadence week carrying both runs
           // TWO threshold sessions and spends Daniels' 10% twice. On a 36 mi/wk
           // half that is 3.5 mi of finish plus a 4 mi cruise against a 3.6 mi
           // weekly allowance; something has to give, and doctrine says which.
           // §4.5 schedules the fast-finish long "Every 2-3 weeks" and §15's
           // race-specific row lists it among the phase's primary workouts, so
           // on the weeks it lands it IS the week's threshold work. Off-cadence
           // weeks have no finish (longFinishSegment returns null) and keep both
           // structured sessions, exactly as before.
           : cat === 'hm'   ? (hasFinish ? ['intervals'] : ['threshold', 'intervals'])
           // DOCTRINE-MPLONG-1 · on the week the marathon-pace long lands, the
           // tempo comes OUT. Research/04 §16 "Combinations to avoid": "MP long
           // run + hard tempo within 5 days | Same energy system, same impact
           // pattern, no recovery between". The MP long IS the week's second
           // quality session — §4.4 calls it the "marathon-specific stimulus" —
           // so the week still runs two hard days, one of which is the long.
           // DOCTRINE-DOSING-2 · off-cadence weeks have no MP long (§4.4's
           // "every 2-3 weeks" · longFinishSegment returns null), so they DO
           // run two structured sessions — but the second is no longer a second
           // T session. The threshold slot keeps the race-specific work (§14.4
           // Canova 2K reps, via the `marathon_specific` family); the other goes
           // to the rep slot, which §14.4 also names ("MP+10K alternations") and
           // which for the ultra resolves to hills rather than I-pace reps.
           // DOCTRINE-DOSING-2 · the ULTRA runs ONE structured session here, and
           // that is doctrine rather than a dosing convenience. Every sample
           // race-specific peak week in `Research/22` §Ultramarathon carries
           // exactly one — the 50 mile's "WU + 30 min @ T + CD (9 mi)", the
           // 100K's "WU + 4×8 min @ T + CD (10 mi)" — beside the back-to-back
           // long pair that IS the ultra's second quality stimulus, with hill
           // strides riding on an easy day rather than occupying a slot. It also
           // keeps §15's race-specific row honest: that row names race-pace
           // work, MP long runs and Canova structures, and nothing in it places
           // a hill session in this phase.
           : cat === 'ultra' ? ['threshold']
           // The marathon's off-cadence weeks keep their TEMPO slot, not a
           // second threshold one. The slot's identity matters as much as its
           // pace: `qualityFamilyFor` resolves a race-specific tempo to the
           // `combo` family — §10.3's wave tempo, "Specific phase HM/marathon" —
           // and the threshold slot to `marathon_specific` (§11.2 Canova 2K
           // reps), which the MP-long weeks already carry. Pairing the wave
           // tempo with the rep slot keeps both §15 shapes in the block while
           // the week runs one T session and one I session.
           : /* m */  (mpLongWeek ? ['threshold'] : ['tempo', 'intervals']))
      : phase === 'QUALITY'
          // Each row: one I-family slot, one T-family slot, and the T slot
          // alternates cruise intervals ↔ continuous tempo by week parity —
          // §5.2's "alternating with cruise intervals", read literally.
          ? (cat === '5k'   ? (wi % 2 === 0 ? ['intervals', 'threshold'] : ['intervals', 'tempo'])
           : cat === '10k'  ? (wi % 2 === 0 ? ['intervals', 'threshold'] : ['intervals', 'tempo'])
           : cat === 'hm'   ? (wi % 2 === 0 ? ['intervals', 'threshold'] : ['intervals', 'tempo'])
           : cat === 'ultra'
               // ULTRA-QUAL-1 (2026-06-23): ultra training is threshold-dominant; I-pace intervals are
               // "rarely" appropriate (Research/00a §"Workout dose by race distance" "3×1600m at 10K pace (rarely)").
               // DOCTRINE-DOSING-2 · the pair was `['threshold','tempo']` — both
               // T, and 20% of the week at threshold. Research/22's ultra sample
               // peak weeks show what the second session actually is: the 50K's
               // "6×3 min hill repeats", the 50-mile's and 100K's "hill strides"
               // beside a SINGLE "WU + 30 min @ T + CD". So the rep slot carries
               // HILLS for the ultra — `qualityFamilyFor` pins it there, in this
               // phase and in RACE-SPECIFIC, so it can never fall through to
               // I-pace track reps ULTRA-QUAL-1 removed.
               ? (wi % 2 === 0 ? ['threshold', 'intervals'] : ['tempo', 'intervals'])
           : /* marathon */  (wi % 2 === 0 ? ['tempo', 'intervals']  : ['threshold', 'intervals']))
      : [];
    const qualityTypes = qualityTypesFor(weekIdx);
    // Prescription strings are resolved up-front from workout_library
    // (Research/04 + 22) via resolvePrescriptions() — falls back to the
    // historical inline catalog if the library has no matching row.
    // B3 · stimulus-gap-aware scheduling: order intervals last (toward the long's buffer) and
    // re-place days only when the default assignment violates a Research/00b:55-60 gap.
    // PP-3 (2026-06-23, David approved) · non-race taper weeks get exactly 1 tune-up, not 2.
    // Pfitzinger §taper: "reduce volume, preserve intensity, one quality session." Two tune-ups
    // in a non-race taper week accumulate fatigue and blunt the taper effect.
    // DOCTRINE-MPLONG-1 · an MP-long week has ONE structured slot, so it gets
    // one quality DOW. Without this the `types[i % types.length]` fill below
    // would put the surviving threshold session on both days — trading the
    // forbidden tempo pairing for a worse one (§16 "Two threshold sessions
    // back-to-back"). The freed day becomes an easy day, not a rest day: the
    // frequency cap counts long + quality as `runningPlaced`, so easyCount
    // rises by exactly one and the runner's training-day count is unchanged.
    //
    // DOCTRINE-DOSING-2 (2026-08-18) · the slot count follows the TYPE count.
    //
    // `scheduledQ.types[i % scheduledQ.types.length]` fills any surplus day by
    // wrapping the type list, so a mix that declares ONE type and two days runs
    // that one session twice. DOCTRINE-MPLONG-1 patched that by hand for the
    // marathon's MP-long week; DOCTRINE-HMLONG-DOSE-1 adds the half's
    // fast-finish week, and enumerating a third exception is how the trap stays
    // open. Deriving the count closes it for every mix.
    //
    // BASE-BUILDING IS EXEMPT, and the reason is a defect rather than doctrine.
    // Its mix is `['tempo']` on two quality days — two light fartleks, which
    // §5.2's "1×/week" would rather see as one. But collapsing the second into
    // an easy day moves enough mileage on a true-beginner ramp to breach the
    // validator's own 50% week-over-week volume limit (16 archetypes,
    // `5k/beginner/f6/m0/L0-3` among them). Trading a frequency nuance for a
    // structural ramp violation is a worse plan, and re-sizing the beginner
    // ramp is not this workstream's to do. The dose itself is not the problem:
    // a 5×1 min surge set is ~0.6 mi at T, so two of them sit far inside
    // Daniels' 10% on any week a beginner runs, and `applyDosingCaps` holds the
    // cap regardless. Recorded as open rather than papered over.
    // DOCTRINE-BASE-2 · NO types means NO days, and the `Math.max(1, …)` floor
    // below cannot say that. This pass used to be skipped wholesale on BASE
    // weeks, so an empty type list never reached it; now that BASE places a
    // slot the pass runs on every phase, and a true-beginner base week — whose
    // mix is deliberately empty, per Research/22 §Beginner — would otherwise be
    // floored to one scheduled day and fill it from `types[i % 0]` — or, worse,
    // from `scheduleQuality`'s own `['threshold']` default, which would hand a
    // first-month-back runner a threshold session in their base phase.
    const effectiveQDows = qualityTypes.length === 0 ? [] : qualityDows.slice(
      0,
      Math.max(1, Math.min(
        baseBuilding ? qualityDows.length : qualityTypes.length,
        (phase === 'TAPER' && !isRaceWeek) || mpLongWeek ? 1 : qualityDows.length,
      )),
    );
    // QUAL-PHASE-STABLE (2026-06-24) · anchor the quality DOWs to a weekIdx-INVARIANT placement profile
    // so they don't oscillate as the QUALITY mix toggles. The two parities differ only by whether
    // intervals is present; the intervals-bearing parity is the most gap-demanding, so place against it.
    // Non-QUALITY phases don't alternate → use this week's types directly (placement byte-unchanged).
    const placementProfile: Array<DayPlan['type']> = phase === 'QUALITY'
      ? (() => { const a = qualityTypesFor(0), b = qualityTypesFor(1);
          return a.includes('intervals') ? a : b.includes('intervals') ? b : qualityTypes; })()
      : qualityTypes;
    const scheduledQ = scheduleQuality(effectiveQDows, qualityTypes, longRunDow, restDow, availableDows, placementProfile);
    // DOCTRINE-VOCAB-1 (2026-08-17) · does Research/04 §15 place a specific
    // family on this slot, in this phase, for this distance? If so its
    // prescription supersedes the generic vo2max/threshold/tempo string.
    //
    // A week never runs the same family twice. Both of a week's slots can land
    // on the same type (the scheduler is free to), and a family keyed only on
    // type would then fill both with one workout — trading three shapes for
    // two, which is not what §15 is asking for. The second slot falls back to
    // its generic prescription.
    // The slot's TYPE is unchanged either way — each family is only ever
    // offered to a slot whose type already matches its shape — so scheduling,
    // spacing and every structural invariant are exactly as before.
    // Base-building beginners are excluded: Research/22 §Beginner keeps them
    // on easy running plus one light surge session, not the full vocabulary.
    // DOCTRINE-TAPERMP-1 · the taper's MP session is prescribed by Research/08
    // §9.2 by name and dose; no §15 vocabulary family may supersede it.
    //
    // PROGRESSION-1 · resolved in a PRE-PASS rather than inline, because the
    // overload trajectory has to step at most once per family per week. A week
    // whose scheduler puts two generic rep slots on it (the 5K's race-specific
    // mix does) would otherwise take two duration steps in seven days, which is
    // the opposite of the doctrine's one-lever-per-cycle rule. Resolving the
    // vocabulary first tells us which slots the trajectory actually owns before
    // any of them is stepped.
    const usedFamilies = new Set<WorkoutFamily>();
    const filledByThisPass = new Set<number>();

    /* ── VOCAB-CATALOGUE-1 · the catalogue picks the session, not a lookup ────
     *
     * `qualityFamilyFor` still answers the §15 question it always answered —
     * does doctrine name a vocabulary family on THIS slot, in this phase, for
     * this distance — and the doctrine gate's VOCAB.phase-placement claim still
     * checks its answers against §15's own row keywords. What it no longer does
     * is CHOOSE the session: it named one family per (phase, slot) and handed
     * off to one fixed string per (family, distance), so every hills slot in
     * every week of every plan read the same fifteen words.
     *
     * The catalogue answers the second question. Given the phase, distance,
     * tier, week volume, pace anchors, what the week has already placed and
     * what the block has already run, `selectSlotWorkout` returns the session
     * §15 places here that this week can afford, rotated least-recently-used so
     * a twelve-week block works through the vocabulary before it repeats any of
     * it. It chooses across every family §15 places on the slot rather than the
     * one this gate happens to name, which is what retires the old
     * `Math.floor(weekIdx / 2) % 2` hills/fartlek alternation.
     *
     * WHEN IT REFUSES, the fixed string is still there. A refusal is doctrine
     * speaking — at 15 mi/wk Daniels' share caps genuinely leave too little
     * at-pace volume for the shortest form of anything §15 places here — and
     * the fallback below is bounded by the same caps through
     * `sizeFromPrescription`, so a refusal cannot become a breach either way.
     */
    const catalogueTier: Tier | null =
      (catalogueHistory != null && level != null) ? (level as Tier) : null;
    const placedThisWeek: PlacedSession[] = [];
    // §16's rules about the long run only fire if the long run is visible to
    // them. It is placed above, and its race-pace finish names which of §4's
    // long runs it is — the same tag `dosePaceOf` reads.
    if (slots[longRunDow]?.isLong) {
      placedThisWeek.push({
        slug: finishSeg?.tag === 'MP' ? 'marathon-pace-long-run'
          : finishSeg?.tag === 'HM' ? 'fast-finish-long-run'
          : 'base-long-run',
        dayOffset: longRunDow,
      });
    }
    const usedSlugs = new Set<string>();

    /* ── SLOT-ROTATE-2 (2026-08-19) · WHICH SLOTS EXIST, BEFORE WHO FILLS THEM ──
     *
     * This used to be the first half of the catalogue pass, and the ordering it
     * forced is the reason a rotating vocabulary and a rising dose could not
     * both be true. The chain ran: catalogue chooses → week's budget is divided
     * among the slots it left → trajectory steps inside that budget. So the
     * trajectory could only ever see the slots the catalogue had DECLINED, and
     * `trackFor` said as much — a slot with a `vocabRx` was simply not on a
     * ladder. Widening §15's placement therefore took slots off the ladder one
     * for one, and the threshold track's dose flattened onto the weekly cap:
     * measured at 4.0 mi at T in every QUALITY week of a 14-week marathon,
     * where the ladder had been running 3×7 min → 4×7 min → 4×9 min.
     *
     * The slot's TYPE is not the catalogue's to decide — `scheduleQuality`
     * fixed it above, and the conflict skip below is a calendar question. So
     * the week's slot list is resolvable first, and once it is, the budget and
     * the trajectory both resolve before anything picks a session. The
     * catalogue then runs LAST and is handed the minutes the block has earned.
     *
     * `slotBudgetMi` and `stepByTrack` read this list; both counted the same
     * surviving slots off `resolvedSlots` before, so neither changes.
     */
    const plannedSlots = scheduledQ.dows.map((dow, i) => {
      if (slots[dow] != null || filledByThisPass.has(dow)) return null; // conflict · skip
      filledByThisPass.add(dow);
      return { dow, qt: scheduledQ.types[i % scheduledQ.types.length] };
    });

    /* ── DOCTRINE-DOSING-2 · the week's at-pace budget, before anything is sized ──
     *
     * `atPaceSessionCapMi` answers "how big may ONE session be on a week this
     * size", and it answered it identically for every session in the week —
     * which is how a week ended up spending Daniels' whole 10% twice. This
     * resolves the other half of the same doctrine: what the WEEK may spend,
     * minus what the long run's race-pace finish has already committed, divided
     * among the slots that want it.
     *
     * Both bounds still apply, and the smaller wins. The session band (§5.1's
     * "4-8 mi", §6.1's "3-6 mi") says what the workout IS; this says what the
     * week can pay for. `slotDoseBudgetMi` carries the doctrine; this carries
     * the week's own bookkeeping.
     *
     * DOCTRINE-DOSING-2's type mixes mean `slots` is 1 for every mix the engine
     * authors, so in practice each session gets the family's whole remaining
     * budget rather than a fraction of it — the redistribution happened when the
     * second T session became an I session, not here. The division is kept
     * because it is what makes the guarantee structural: any future mix that
     * doubles up on a family is bounded by arithmetic rather than by whoever
     * remembers this rule.
     */
    const slotBudgetMi = (() => {
      // The long-run finish is deliberately NOT reserved here, though it is a
      // dose of the same pace. `Research/04` §4.5 gives the fast-finish long
      // "Every 2-3 weeks" while the structured session is weekly, and
      // `applyIntensityFloor` already treats the finish as the surplus in an
      // over-dense week for exactly that reason. Charging it first would size
      // the phase's own race-specific session down to nothing to protect a
      // segment doctrine schedules less often. `applyDosingCaps` reconciles the
      // two after every pass that moves mileage, and gives the finish back
      // first — see that function.
      const reserved: Partial<Record<DosePace, number>> = {};
      const count: Partial<Record<DosePace, number>> = {};
      for (const s of plannedSlots) {
        if (!s) continue;
        const p = slotDosePace(s.qt, Boolean(taperMp) && s.qt === 'tempo');
        if (!p) continue;
        count[p] = (count[p] ?? 0) + 1;
      }
      const byPace = new Map<DosePace, number>();
      for (const p of DOSE_PACES) {
        byPace.set(p, slotDoseBudgetMi({
          weeklyMi,
          pace: p,
          context: weekDoseContext,
          reservedMi: reserved[p] ?? 0,
          slots: count[p] ?? 1,
        }));
      }
      // DOCTRINE-BASE-2 · `'strides'` is accepted alongside the day types.
      // `slotDosePace` has mapped it to R since DOCTRINE-DOSING-2 landed and
      // nothing asked for it, because no slot spent the R budget. A base
      // week's §7 session does, and asking for it by the day type `intervals`
      // would price it against Daniels' 8% instead of his 5%.
      return (qt: DayPlan['type'] | 'strides'): number => {
        const p = slotDosePace(qt, Boolean(taperMp) && qt === 'tempo');
        return p ? (byPace.get(p) ?? Infinity) : Infinity;
      };
    })();

    /* ── SLOT-ROTATE-2 · THE TRACK A SLOT SITS ON, AND WHO OWNS THE LABEL ─────
     *
     * These were one function and they are two questions.
     *
     * `trackOfType` is the DOSE question: which of Daniels' quality tracks does
     * this slot spend against. It is a property of the slot's type and of
     * nothing else, so the trajectory can step it before anybody has chosen a
     * session — which is the whole of this change.
     *
     * `trackFor` is the LABEL question, unchanged: does the trajectory's own
     * rendered shape become the prescription the runner reads. A slot the
     * catalogue filled carries the session doctrine names by name, and a taper
     * MP block and a beginner's light fartlek carry doses `Research/08` §9.2
     * and `Research/22` state — none of them is a shape for the ladder to
     * render.
     *
     * So on a rotated week the trajectory still STEPS and its dose is still
     * spent; what it no longer does is supply the words. That is the dose /
     * identity split, and it is why the ladder survives the rotation: the
     * ladder is a number, the vocabulary is a name, and only the number has to
     * be monotone.
     */
    const trackOfType = (qt: DayPlan['type']): SessionFamily | null => {
      if (baseBuilding) return null;
      // DOCTRINE-BASE-2 · the T and I ladders do not start in BASE.
      //
      // The base week's slot carries the day type `intervals`, so without this
      // the overload trajectory would read it as the block's first I session
      // and start climbing there — three or four rungs spent before the phase
      // that is supposed to open the ladder begins. §15 places no I-pace work
      // in base and `Research/00b`'s reverse taper says the same thing in the
      // negative ("No threshold or VO2max"), so there is no dose here for a
      // ladder to carry. The base session's dose is doctrine's own, stated by
      // name in §7/§8/§9 and sized by `fits` inside Daniels' share; the ladders
      // open with QUALITY, exactly as they did before this phase had a slot.
      if (phase === 'BASE') return null;
      if (qt === 'threshold') return 'threshold';
      if (qt === 'intervals') return 'interval';
      return null;
    };
    const trackFor = (s: { qt: DayPlan['type']; vocabRx: string | undefined }): SessionFamily | null => {
      if (s.vocabRx) return null;
      return trackOfType(s.qt);
    };
    const stepByTrack = new Map<SessionFamily, ReturnType<OverloadTrajectory['step']>>();
    if (trajectory) {
      for (const s of plannedSlots) {
        if (!s) continue;
        const track = trackOfType(s.qt);
        if (track == null || stepByTrack.has(track)) continue;
        stepByTrack.set(track, trajectory.step({
          family: track,
          weekIdx,
          seedPrescription: track === 'threshold' ? rx.threshold : rx.intervals,
          paceSPerMi: track === 'threshold' ? weekTPaceSec : weekIPaceSec,
          weeklyMi,
          // DAY-SIZE-1 · the day is sized FROM the session on a build week, so
          // the trajectory's earned stimulus is bounded by Daniels' at-pace cap
          // rather than by an arithmetic share of weekly volume. `qualityMiEach`
          // stays the budget on the paths that are not doctrinally sized.
          dayBudgetMi: qualityMiEach,
          sizeDay: doctrinalDaySizing
            ? {
                ceilingMi: doctrinalDayCeiling,
                // DOCTRINE-DOSING-2 · the trajectory's earned stimulus is now
                // also bounded by what the WEEK has left at this pace, not only
                // by what one session may carry. Both caps were always meant to
                // bind (`Research/01` states them in two columns); only the
                // first was ever computed.
                atPaceCapMi: Math.min(
                  mpLongAtPaceCapMi ?? Infinity,
                  slotBudgetMi(track === 'interval' ? 'intervals' : 'threshold'),
                ),
              }
            : null,
          // Doctrine §2's W4. `isCutback` is the same deload mask `volumeCurve`
          // cut the week's mileage with, so the trajectory holds on exactly the
          // weeks the plan already calls recovery.
          isDeload: isCutback,
        }));
      }
    }

    /* ── SLOT-ROTATE-2 · the catalogue picks the session, at the earned dose ──
     *
     * Runs after the trajectory rather than before it, and takes one number
     * from it: `totalWorkMinutes(step.shape)`, the at-pace minutes this track
     * has worked up to. The selector treats it as a ceiling on SIZING inside
     * the entry's own doctrine band — never as an eligibility test — so the
     * week still offers everything §15 places on the slot and doctrine's own
     * shape floors (§5.2's twenty minutes, a rep set's `reps.min`) still win
     * over a target below them.
     *
     * `step.shape` is already through `clampToWeek` and the week's
     * `slotBudgetMi`, so the target can only ever be at or under the share cap
     * the census enforces. It cannot introduce a breach; it can only spend less
     * of the same budget.
     *
     * On weeks the trajectory has nothing to say — no pace anchor, an
     * unparseable seed, a composer running without a trajectory at all — the
     * target is null and this is the behaviour that shipped before: spend the
     * week's whole share.
     */
    const targetMinutesFor = (qt: DayPlan['type']): number | null => {
      const track = trackOfType(qt === 'tempo' ? 'threshold' : qt);
      if (track == null) return null;
      const step = stepByTrack.get(track);
      if (!step) return null;
      const mins = totalWorkMinutes(step.shape);
      return mins > 0 ? mins : null;
    };

    const resolvedSlots = plannedSlots.map((planned) => {
      if (!planned) return null; // conflict · skip
      const { dow, qt } = planned;
      const candidateFamily = (baseBuilding || (taperMp && qt === 'tempo'))
        ? null
        : qualityFamilyFor(cat, phase, weekIdx, weeksToPhaseEnd, qt);
      // DOCTRINE-BASE-2 · in BASE the rep-shaped day is fed by the SPEED slot.
      //
      // The day keeps the `intervals` type — that is what the row, the spec
      // builder, the persistence layer and the watch already understand — and
      // the slot is what decides which of §15's rows the catalogue draws from.
      // `SLOT_FAMILIES.speed` is §7, and `SLOT_FAMILIES_IN_PHASE.speed.base`
      // adds §8's light hills and §9's fartleks. What it cannot reach is
      // `vo2max` and `threshold`, which is the point: the `intervals` slot
      // admits §6's rep sessions in every phase, and §6.5's own "Late base"
      // row would have put 8-12×600m at I into a rebuilding week that
      // `Research/00b` says carries "No threshold or VO2max".
      const slot: ComposerSlot | null =
        phase === 'BASE'
          ? (qt === 'intervals' ? 'speed' : null)
          : qt === 'threshold' || qt === 'intervals' || qt === 'tempo' ? qt : null;
      const choice = (candidateFamily && catalogueTier && slot && catalogueHistory)
        ? selectSlotWorkout({
            history: catalogueHistory,
            enginePhase: phase,
            distance: cat,
            tier: catalogueTier,
            weekIdx,
            weeklyMi,
            slot,
            dayOffset: dow,
            placedThisWeek,
            // §16 "Fast finish long run before goal race | Adds depletion in
            // taper window". The taper's LENGTH is Research/08's and the block
            // planner's, not Research/04's, so the caller states it.
            inTaperWindow: phase === 'TAPER' || isRaceWeek,
            tPaceSec: weekTPaceSec,
            iPaceSec: weekIPaceSec,
            mpPaceSec: weekMpPaceSec,
            usedThisWeek: usedSlugs,
            targetAtPaceMinutes: targetMinutesFor(qt),
            // SLOT-ROTATE-5 · §15's hill/strength block, then §15's specific
            // support. `qualityFamilyFor` splits QUALITY on the same test —
            // it opens the phase with hills and closes it with reps — so the
            // two agree by construction rather than by anyone remembering.
            inHillBlock: phase === 'QUALITY' ? weeksToPhaseEnd > 2 : null,
            // EFFORT-RAMP-1 · where this week sits in the BLOCK, 0…1.
            //
            // The block is the plan, not the phase. §7.3's hill sprints are
            // placed "Year-round" and §8.2's short hills run "1×/week base
            // phase; 1× every 2 weeks specific", so the build both rows state
            // is scoped to the training cycle and crosses the phase boundary
            // with the runner. Re-basing it per phase would drop a runner from
            // twelve sprints back to four the week BASE ends, which doctrine
            // nowhere states and no coach would write.
            //
            // Pure in `(weekIdx, totalWeeks)` — no clock, no counter — so the
            // plan still regenerates byte-identically.
            blockPosition: totalWeeks > 1 ? weekIdx / (totalWeeks - 1) : 0,
          })
        : null;
      if (choice?.ok) {
        const text = slot === 'tempo' ? choice.phrase : choice.prescription;
        if (text) {
          usedSlugs.add(choice.entry.slug);
          usedFamilies.add(choice.family);
          placedThisWeek.push({ slug: choice.entry.slug, dayOffset: dow });
          recordCatalogueChoice(catalogueHistory!, choice.entry.slug, weekIdx);
          return {
            dow, qt,
            vocabFamily: choice.family,
            vocabRx: text,
            catalogueNote: choice.note,
            catalogueAtPaceMi: choice.dose.atPaceMi,
          };
        }
      }
      const vocabFamily = (candidateFamily && !usedFamilies.has(candidateFamily)) ? candidateFamily : null;
      const vocabRx = vocabFamily ? rx.families[vocabFamily] : undefined;
      if (vocabFamily && vocabRx) usedFamilies.add(vocabFamily);
      return { dow, qt, vocabFamily, vocabRx, catalogueNote: null, catalogueAtPaceMi: null };
    });

    // DAY-SIZE-1 (2026-08-17) · size a quality DAY from its session.
    //
    // `Research/04-workout-vocabulary.md` §5.2/§5.3 prescribe "2-3 mi E each
    // side" around 4-8 miles at threshold, and §6.2 the same warm-up with a 1-2
    // mi cool-down around 3-6 miles at I. Those easy legs are EASY — the
    // intensity caps and the 75% easy floor speak only to the at-pace half — so
    // the day is composed, not shared out of the week's volume. `layoutWeek`
    // fills the remaining days from `weeklyMi - allocated`, so the extra easy
    // miles come off the standalone easy days and the weekly total is
    // unchanged: this RELOCATES easy running, it does not add any.

    /** Doctrine's own bounds on a continuous tempo block, both applied.
     *  §5.1 "| Continuous tempo | 3-8 mi continuous | T | None | 20-40 min |" —
     *  a slow runner reaches forty minutes before eight miles and a fast one
     *  reaches eight miles first, so whichever binds first is the answer.
     *
     *  DOCTRINE-DOSING-2 · the three-MILE floor that used to sit under this is
     *  gone, and its removal is the low-mileage half of this workstream.
     *
     *  It came from the left column of §5.1's own row ("3-8 mi continuous"), and
     *  read as a floor it contradicts `Research/01`'s cap for every runner under
     *  30 mi/wk: ten percent of a 22-mile week is 2.2 miles, and the floor
     *  overrode it to three — 13.6% of the week at threshold, authored on the
     *  smallest bases in the corpus. It is the single largest source of the
     *  508 single-workout T breaches the census measured.
     *
     *  Doctrine's floor for this session is not in miles. §5.2 states it in
     *  time — "Duration | 20 min minimum for stimulus; 20-40 min sweet spot" —
     *  and §5.1's own "Total at-pace" column for the row says "20-40 min". Time
     *  is the runner-invariant unit: at a 9:00 T pace twenty minutes is 2.2
     *  miles, which is exactly ten percent of that 22-mile week. The cap and the
     *  stimulus floor agree once the floor is read in the unit doctrine wrote it
     *  in; it was the mile translation that did not fit either.
     *
     *  Where they still collide — a fast runner on a very small week, whose ten
     *  percent is under twenty minutes — the CAP wins. It is the safety rule,
     *  a short tempo is recoverable inside the same week, and `Research/00b`
     *  exists because the other error is not. */
    const sizeTempoDay = (catalogueAtPaceMi: number | null = null): { tempoMi: number; dayMi: number } => {
      const capMi = Math.min(
        atPaceSessionCapMi(weeklyMi, 'threshold'),
        slotBudgetMi('tempo'),
        mpLongAtPaceCapMi ?? Infinity,
      );
      // VOCAB-CATALOGUE-1 · when the catalogue chose the block, its OWN band is
      // the doctrine bound and §5.2's twenty-to-forty minutes is not. §5.5's
      // long tempo is "8-12 mi continuous" and §10.3's wave tempo "4-8 mi
      // continuous"; sizing either by the continuous-tempo clock would ship a
      // five-mile block under a label promising a long tempo. `dose.atPaceMi`
      // already sits inside the entry's band AND inside Daniels' share, so the
      // minimum of it and the week's own budget is the answer.
      const byTimeMi = catalogueAtPaceMi != null
        ? catalogueAtPaceMi
        : weekTPaceSec != null && weekTPaceSec > 0
        ? (CONTINUOUS_TEMPO_MINUTES.max * 60) / weekTPaceSec
        : Infinity;
      // Half-mile grain, rounded DOWN: the cap is a ceiling, and rounding a
      // 2.6-mile allowance up to three is how the old floor got in.
      let tempoMi = Math.max(0.5, Math.floor(Math.min(capMi, byTimeMi) * 2) / 2);
      const first = composeQualityDay({ family: 'threshold', atPaceMi: tempoMi, ceilingMi: doctrinalDayCeiling });
      // The ceiling is structural (the long run stays the week's longest run).
      // The easy legs give way first — `composeQualityDay` has already shrunk
      // them — and only when the block itself will not fit does the block come
      // down, because a day promising more tempo than its own mileage can hold
      // is the sub_label/spec drift this codebase has twice paid for.
      if (first.dayMi > doctrinalDayCeiling) {
        tempoMi = Math.max(1, Math.floor(doctrinalDayCeiling - first.warmupMi - first.cooldownMi));
      }
      return {
        tempoMi,
        dayMi: composeQualityDay({ family: 'threshold', atPaceMi: tempoMi, ceilingMi: doctrinalDayCeiling }).dayMi,
      };
    };

    /**
     * A day sized around a prescription the engine did not choose the dose of —
     * a §15 vocabulary family, or a catalog string the trajectory does not own.
     *
     * The SHAPE is doctrine's, stated by name, and is honoured as written; the
     * day is built to hold it instead of squeezing the warm-up and cool-down
     * out of the session. The one thing that can still move is the rep COUNT,
     * and only downward: a named dose is stated for the runner doctrine had in
     * mind, and five two-kilometre reps is 6.2 miles at threshold, which is
     * 13.5% of a 46-mile cutback week against Daniels' 10%. That is the same
     * cut `clampToWeek` makes for the trajectory — reps come off before the rep
     * shortens — and the label is rewritten with it, because a session the
     * runner reads as five reps over a spec that runs four is exactly the drift
     * this codebase has already fixed twice.
     *
     * Returns null when the string carries no readable at-pace volume, and the
     * caller falls back to the weekly share.
     */
    const sizeFromPrescription = (
      p: string | null | undefined,
      family: QualityFamily,
    ): { prescription: string; dayMi: number } | null => {
      if (!p) return null;
      // A "N mi WU · M mi @ T · P mi CD" string already IS a whole day.
      const tempo = parseTempoShape(p);
      if (tempo) {
        return { prescription: p, dayMi: Number((tempo.warmupMi + tempo.tempoMi + tempo.cooldownMi).toFixed(1)) };
      }
      // DOCTRINE-BASE-2 · a §7 rep is timed and its work pace is R, not I and
      // not T. `weekRPaceSec` is `resolveZoneAnchors`' own R — the same number
      // `buildWorkoutSpec` will pace the rep at — and it falls back to the I
      // anchor for the effort-cued §8 and §9 sessions the base slot also
      // carries, whose rendered strings name no R zone at all.
      const pace = family === 'interval' ? weekIPaceSec
        : family === 'repetition' ? (weekRPaceSec ?? weekIPaceSec)
        : weekTPaceSec;
      // GRAMMAR-SEQ-1 · an unequal-step session is a FIXED shape doctrine states
      // by name — §13's ladders, §10's combos and alternations, §12.4's
      // progression — so the day is sized FROM it rather than it being cut to
      // the day. The selector has already refused this session on any week that
      // cannot afford it (`sessionAllowanceMi` prices the whole sequence against
      // Daniels' share before it is offered), which is why there is no cut here
      // to make. Without this the day fell through to the week's flat quality
      // share and a four-rung ladder was printed over a day sized for something
      // else — the label/spec drift this whole workstream exists to close.
      const segs = parseSegments(p);
      if (segs) {
        let atPaceMi = 0;
        let restS = 0;
        let unpriced = false;
        for (const s of segs) {
          const mi = segmentMi(s, pace);
          if (mi == null) { unpriced = true; break; }
          atPaceMi += mi;
          restS += s.restS;
        }
        if (!unpriced && atPaceMi > 0) {
          return {
            prescription: p,
            dayMi: composeQualityDay({
              family,
              atPaceMi,
              floatMi: Number((restS / 540).toFixed(2)),
              ceilingMi: doctrinalDayCeiling,
            }).dayMi,
          };
        }
        return null;
      }
      const dist = parsePrescription(p);
      const timed = dist ? null : parseTimeReps(p);
      let reps: number;
      let repMi: number;
      let restS: number;
      if (dist) {
        ({ reps, repMi, restS } = { reps: dist.reps, repMi: dist.repDistanceMi, restS: dist.restS ?? 90 });
      } else if (timed && pace != null && pace > 0) {
        ({ reps, repMi, restS } = { reps: timed.reps, repMi: timed.durationS / pace, restS: timed.restS ?? 90 });
      } else {
        return null;
      }
      if (!(repMi > 0)) return null;

      // DOCTRINE-DOSING-2 · plus what the WEEK has left at this pace.
      const capMi = Math.min(
        atPaceSessionCapMi(weeklyMi, family),
        slotBudgetMi(
          family === 'interval' ? 'intervals'
          // DOCTRINE-BASE-2 · the R budget, for the R family. See `slotBudgetMi`.
          : family === 'repetition' ? 'strides'
          : 'threshold',
        ),
        mpLongAtPaceCapMi ?? Infinity,
      );
      // Two reps is the FLOOR the cut prefers — a one-rep "rep session" is a
      // different workout, and the affordability cut is meant to size a
      // session, not delete it.
      //
      // DOCTRINE-DOSING-2 · but it is a preference, not a licence to overspend.
      // Two reps of a named dose can exceed a small week's whole allowance on
      // their own ("5×2K" is 6.2 mi at T; a 25 mi/wk runner may spend 2.5), and
      // before this the cut stopped at two and shipped the breach. When two
      // still overshoot, the set collapses to ONE — which for the threshold
      // family is a shape doctrine names in its own right (§5.1 "| Continuous
      // tempo | 3-8 mi continuous |"), and for a rep set is the honest
      // statement that this week cannot afford the named dose. The rep itself
      // never shortens here: its length is the workout's identity and rewriting
      // it would leave the label describing a session the spec does not build.
      let keptReps = reps;
      while (keptReps > 2 && keptReps * repMi > capMi) keptReps--;
      while (keptReps > 1 && keptReps * repMi > capMi) keptReps--;
      // Rewrite ONLY the leading rep count, and only when the string opens with
      // it, so the family's identity ("descend MP → T", "hills") is untouched.
      const prescription = keptReps === reps
        ? p
        : p.replace(/^(\s*)\d+(\s*[×xX])/, `$1${keptReps}$2`);

      return {
        prescription,
        dayMi: composeQualityDay({
          family,
          atPaceMi: keptReps * repMi,
          floatMi: jogFloatMi(keptReps, restS / 60),
          ceilingMi: doctrinalDayCeiling,
        }).dayMi,
      };
    };

    resolvedSlots.forEach((slot) => {
      if (!slot) return; // conflict · skip
      const { dow, qt, vocabFamily, vocabRx } = slot;
      const track = trackFor(slot);
      const step = track != null ? (stepByTrack.get(track) ?? null) : null;
      // DOCTRINE-BASE-2 · a base week's session is §7/§8/§9 work, so it is
      // sized and capped as REPETITION, not as an interval session.
      //
      // Three things follow from the family, and all three are right this way.
      // `AT_PACE_SESSION_MI.repetition` is read out of §7.4 rather than §6.1,
      // so a twelve-second sprint set is not measured against a mile-repeat
      // band; `QUALITY_WARMUP_MI/COOLDOWN_MI` give it §17.1's one-mile jog
      // instead of §6.2's two; and `atPaceSessionCapMi` charges it Daniels'
      // 5% R cap instead of the 8% I cap — the tighter number, which is the
      // one §7's own contraindication row names ("Cap at 5% weekly mileage").
      const qFamily: QualityFamily = phase === 'BASE'
        ? 'repetition'
        : qt === 'intervals' ? 'interval' : 'threshold';
      const tempoSized = (doctrinalDaySizing && qt === 'tempo' && !baseBuilding && !taperMp)
        ? sizeTempoDay(slot.catalogueAtPaceMi)
        : null;
      // The fixed string this slot carries when the trajectory does not own it:
      // a §15 vocabulary family, or the catalog entry for a slot whose seed the
      // trajectory could not read. Sized to the week, label and day together.
      //
      // DOCTRINE-BASE-2 · BASE never reaches for the generic fallback. `VOCAB`
      // in `resolvePrescriptions` carries no `speed` row, so `vocabRx` there is
      // either the catalogue's own §15 base-row session or nothing — and
      // nothing means the day is dropped below rather than filled with
      // `rx.intervals`, which is an I-pace rep set §15 does not place in base.
      const rxSized = (doctrinalDaySizing && !taperMp && step == null && tempoSized == null
        && (qt === 'intervals' || qt === 'threshold'))
        ? sizeFromPrescription(
            phase === 'BASE'
              ? vocabRx
              : vocabRx ?? (qt === 'intervals' ? rx.intervals : rx.threshold),
            qFamily,
          )
        : null;
      // DOCTRINE-BASE-2 · the refusal, honoured.
      //
      // `selectWorkout` declines when Daniels' share leaves too little for the
      // shortest form of anything §15 places here, and `renderPrescription`
      // declines a shape the engine's grammar cannot express. On a base week
      // both are real answers rather than failures — at a small enough volume
      // the honest week IS easy running plus the strides on its easy days —
      // and the day goes back to the easy fill below instead of being filled
      // with a session doctrine did not put there or sized at zero miles.
      if (phase === 'BASE' && (!vocabRx || rxSized == null)) return;
      const sub =
        // DOCTRINE-TAPERMP-1 · "N mi WU · M mi @ MP · P mi CD". The "@ MP"
        // token is load-bearing, not decoration: `parseTempoShape` reads the
        // segment sizes out of it and `buildWorkoutSpec` reads the tag to pace
        // the block at marathon pace instead of threshold.
        taperMp && qt === 'tempo'
          ? `${taperMp.warmupMi} mi WU · ${taperMp.mpMi} mi @ MP · ${taperMp.cooldownMi} mi CD`
        // DAY-SIZE-1 · `rxSized` is the same string with its rep count cut to
        // the week's at-pace allowance, when the week could not afford the
        // named dose. Identical to `vocabRx` whenever it could.
      : vocabRx && qt !== 'tempo' ? (rxSized?.prescription ?? vocabRx)
        // PROGRESSION-1 · the trajectory's rendered shape when it owns this
        // slot, the fixed catalog string when it does not (unparseable seed,
        // no pace anchor, or a composer that passes no trajectory at all).
      : qt === 'intervals'        ? (step?.label ?? rxSized?.prescription ?? rx.intervals)
      : qt === 'threshold'        ? (step?.label ?? rxSized?.prescription ?? rx.threshold)
      : qt === 'tempo'            ? (baseBuilding
                                      // Beginner sharpen day = a light fartlek: an easy run with a
                                      // few short surges at T effort, sized to the runner (no 3mi
                                      // tempo floor). Research/22 §Beginner ("2.5mi E w/ 4×1 min @ T").
                                      ? `${Math.max(1.5, Math.round(qualityMiEach * 10) / 10)}mi E w/ 5×1 min surges @ T effort`
                                      // DOCTRINE-VOCAB-1 · the family entry for a tempo slot is a
                                      // PHRASE ("continuous wave tempo · ±10 s/mi around T"); the
                                      // sizing in front of it is the caller's, exactly as for rx.tempo.
                                      // DAY-SIZE-1 · that sizing is now the AT-PACE block, straight
                                      // out of §5.1's band, rather than 60% of a whole-day share —
                                      // the 0.6 was itself an implicit warm-up/cool-down reserve,
                                      // taken out of the intensity budget.
                                      : `${tempoSized ? tempoSized.tempoMi : Math.max(3, Math.round(qualityMiEach * 0.6))}mi ${vocabRx ?? rx.tempo}`)
      // #12 follow-up (2026-08-18) · keyed on `cat` — THE categorizer, hoisted
      // above — rather than on three raw mileage thresholds that disagreed with
      // it (`>= 31` vs the canonical 31.07 ultra floor, `>= 20` vs 19.65, and a
      // `>= 12` with no canonical equivalent). The strings themselves are
      // Research/08 §9.3's race-week primers; `Research/04`'s catalogue is the
      // training vocabulary and carries no race-week template.
      : qt === 'race_week_tuneup' ? (
          cat === 'ultra' ? '5×400m @ T pace · 90s jog'   // ULTRA-TUNE-1: threshold, not I-pace (see race-week note)
        : cat === 'm'     ? '5×400m @ 5K pace · 2min jog' // TAPER-SHARP-1 · marathon: 5K-pace prime
        : cat === 'hm'    ? '4×1km @ race pace · 90s jog'  // PP-2 · HM: race-pace prime
        : cat === '5k'    ? '5×200m @ 5K pace · 90s jog'   // 5K-SHARP-1
        : '4×400m @ 5K pace · 90s jog'                     // 10K-SHARP-1
      )
      :                              'QUALITY';
      // 2026-06-02 · the workout_library uses family='threshold' for
      // BOTH rep-based cruise intervals AND continuous tempos (both
      // are T-pace work in Daniels' taxonomy). When the picked library
      // row's prescription describes a continuous tempo
      // ("N mi WU · M mi @ T · N mi CD"), the row's TYPE should be
      // 'tempo' so spec-builder produces a tempo spec (not a rep spec).
      // Without this remap, the runner sees a sub_label promising
      // continuous tempo over a workout_spec that's actually 4×1mi reps.
      let effectiveType = qt;
      if (qt === 'threshold' && /\d+\s*(?:mi)?\s*WU\s*[·•].*@\s*T[^·•]*[·•]\s*\d+\s*(?:mi)?\s*CD/i.test(sub)) {
        effectiveType = 'tempo';
      }
      // CC-1 (2026-06-23, David approved) · a race-week tune-up is a 3-5mi SHARPENING session
      // (Research/08:394-438), NOT a full quality slot. Cap its distance to the band so composed ==
      // persisted — the spec realizer truncates a 10mi tune-up to ~3.6mi at persist, silently dropping
      // taper volume the gate counted (51→44.6mi). The freed surplus flows into the easy-fill below.
      // DAY-SIZE-1 · the day this session actually needs: warm-up + at-pace
      // work + jog floats + cool-down. Null on the paths doctrine already
      // sizes (the taper MP block, the race-week tune-up), on a beginner's
      // fartlek, and on any prescription whose at-pace volume cannot be read —
      // those keep the weekly share, byte-for-byte as before.
      const doctrinalDayMi: number | null = !doctrinalDaySizing || (taperMp && qt === 'tempo')
        ? null
        : step?.dayMi != null ? step.dayMi
        : tempoSized ? tempoSized.dayMi
        : rxSized ? rxSized.dayMi
        : null;
      const slotMi = effectiveType === 'race_week_tuneup'
        ? Math.min(qualityMiEach, (cat === '5k' || cat === '10k') ? 4 : 5)
        // DOCTRINE-TAPERMP-1 · the taper MP session is sized by DOCTRINE
        // (Research/08 §9.2's 14-16 / 6-8 mi bands), not by the week's generic
        // quality share, which in a tapering week is far too small to carry it.
        // `taperMpDose` has already clamped it to what the week can afford.
        : (taperMp && effectiveType === 'tempo') ? taperMp.totalMi
        // The composed day still passes through the envelope the share-based
        // budget was held to: the recent-quality-distance floor, the
        // stated-frequency floor, and the ceiling that keeps the long run the
        // week's longest run. Each of those records a real bug; none of them
        // is what was making the sessions short.
        // DOCTRINE-BASE-2 · the recent-quality-distance floor is NOT applied to
        // a base week's session, and the reason is what that floor is for. It
        // records "don't author a shorter version of the workout this runner is
        // already doing" — a claim about the same kind of session. §7's speed
        // work is not a shorter threshold day; it is a different session with a
        // different day around it (§17.1's 1-2 mi jog, §17.4's 1-2 mi cool-down,
        // which is exactly what `QUALITY_WARMUP_MI.repetition` carries). Flooring
        // eight fifteen-second hill sprints at a seven-mile day because the
        // runner's last tempo was eight would wrap five easy miles around
        // ninety seconds of work and call it quality — the junk-run shape the
        // day-sizing pass exists to prevent, arriving from the other direction.
        : phase === 'BASE' && doctrinalDayMi != null
          ? Math.min(Math.round(doctrinalDayMi * 2) / 2, doctrinalDayCeiling)
        : doctrinalDayMi != null
          ? Math.min(
              Math.max(Math.round(doctrinalDayMi * 2) / 2, qualityFloor, qualityFloorFreq),
              doctrinalDayCeiling,
            )
        : qualityMiEach;
      // DOCTRINE-BASE-2 · the second refusal · a week that cannot SEAT the
      // session does not get a shrunken one.
      //
      // The selector prices a session against Daniels' share of the week; this
      // asks the other question — whether the week's remaining MILES can hold
      // the day doctrine composes for it once the long run and the two-mile
      // coherence floor on every other running day are paid. On a 10 mi/wk
      // budget over six running days with an 8 mi long there is nothing left,
      // `qualityWeekRoomMi` goes negative, and `doctrinalDayCeiling`'s own
      // one-mile floor was cutting a "12×8s hill sprints · 2 min jog" day to a
      // single mile: a label promising twelve sprints and twenty-two minutes of
      // walk-down recovery over a day that cannot hold the recovery, which is
      // the label/spec drift this file has twice paid for.
      //
      // Refusing is the same answer `select.ts`'s header already gives for the
      // low-volume threshold case, and it leaves the runner the week doctrine
      // actually prescribes there: easy running, plus the strides
      // DOCTRINE-STRIDES-1 puts on two of its easy days.
      if (phase === 'BASE' && slotMi + 1e-9 < Math.round((doctrinalDayMi ?? 0) * 2) / 2) return;
      slots[dow] = {
        dow: dow as DOW, type: effectiveType, distanceMi: slotMi, isQuality: true, isLong: false,
        subLabel: sub,
        // PROGRESSION-1 · the shape the label was rendered from, so a surface
        // that wants the geometry does not have to parse prose back out of the
        // string, and so the trajectory is inspectable end to end.
        ...(step ? {
          workShape: step.shape,
          progressionLever: step.lever,
          challengeZone: step.zone,
        } : {}),
        // DOCTRINE-VOCAB-1 · a family's coaching note comes from what that
        // family is FOR, not from the slot's spec kind. "Hold pace, even
        // splits" is exactly wrong on a hill session, which Research/04 §8.1
        // prescribes by effort precisely because pace cannot hold on a climb.
        // VOCAB-CATALOGUE-1 · when the catalogue chose the session, the note
        // names WHICH member of the family the runner is holding and where in
        // Research/04 it is specified. That is the thing the catalogue added:
        // the family note says what a hill session is for, and this says
        // whether it is §8.1's medium repeat or §8.3's long one.
        notes: slot.catalogueNote
          ? `${slot.catalogueNote}${vocabFamily && FAMILY_NOTES[vocabFamily] ? ` ${FAMILY_NOTES[vocabFamily]}` : ''}`
        : (vocabFamily && FAMILY_NOTES[vocabFamily]) ? FAMILY_NOTES[vocabFamily]!
        // DOCTRINE-TAPERMP-1 · Research/04 §4.4 "Pace | MP exactly — not faster".
        // The taper is where a runner is most tempted to test fitness (§9.4
        // "Resist the urge to test fitness"), so the note says the quiet part.
        : (taperMp && effectiveType === 'tempo') ? 'Race pace, not faster. This is a rehearsal, not a test.'
        : effectiveType === 'intervals'        ? 'WU 1.5mi, reps, CD 1mi. Hold pace, even splits.'
        : effectiveType === 'threshold'        ? 'WU 1.5mi, threshold reps, CD 1mi. Comfortably hard.'
        : effectiveType === 'tempo'            ? 'WU, continuous tempo block, CD. Just below threshold.'
        : effectiveType === 'race_week_tuneup' ? 'Two sharp half-mile reps just above T-pace. Keep it brief. Legs stay fresh.'
        :                                         '',
      };
    });
  }

  // Fill remaining slots with easy.
  //
  // 2026-06-01 · `perEasy` is now floored by the runner's actual 14-day
  // easy-day median when available (`easyMileFloor`). This closes a
  // generator gap: the volume_drift cron fires at >40% deviation, but
  // a runner whose real easy-day baseline is 6+ mi will silently be
  // asked for 4.5 mi easy days when week budget math comes in low ·
  // a 25-30% gap that's invisible to drift detection but obvious to
  // the runner ("my easy runs are usually 5-6 miles · why is the
  // plan asking for 4.5?"). The floor catches this case.
  //
  // Race-week distances stay template-controlled · taper math overrides
  // the floor (handled by the early return for isRaceWeek above).
  const allocated = slots.filter(Boolean).reduce((s, d) => s + (d!.distanceMi || 0), 0);
  const remainingMi = Math.max(0, weeklyMi - allocated);
  const emptySlots = slots
    .map((s, i) => ({ slot: s, dow: i as DOW }))
    .filter((x) => x.slot == null);

  // 2026-06-10 · frequency cap. When the runner stated a training
  // frequency, fill only enough easy days to hit it; the rest become
  // rest days. Without this the generator filled EVERY non-rest slot,
  // so a 3-day runner got a 6-day plan (the bug David hit 3 clicks into
  // onboarding). NULL frequency → fill all empties (legacy behavior).
  const runningPlaced = slots.filter(Boolean).filter((d) => d!.distanceMi > 0).length; // long + quality
  // 2026-06-20 · when the runner gave available days, easy runs may only land
  // on those days; every other empty day stays rest. Long/quality already sit
  // on available days (upstream derivation). Unset → all empties are candidates.
  const easyCandidates = availableDows
    ? emptySlots.filter((e) => availableDows.has(e.dow))
    : emptySlots;
  const easyCount = trainingDaysPerWeek != null
    ? Math.max(0, Math.min(easyCandidates.length, trainingDaysPerWeek - runningPlaced))
    : easyCandidates.length;
  // Place the easy days for EVEN distribution across the week (audit RP-1/RP-2):
  // maximize the minimum circular gap between run days, tie-break by MINIMIZING the
  // maximum gap (so the runs don't collapse into one contiguous block with a long
  // rest tail), then avoid the day immediately adjacent to the long, then lowest dow
  // for determinism. `anchors` is the HARD days only (long + quality) — the rest day
  // is deliberately NOT counted as a stressor to flee. The prior (2026-06-22) greedy
  // counted rest in `occupied` and used a first-wins tie-break, so for a 3-day BASE
  // week every midweek candidate tied at gap-1 and it dropped the easy on Monday, the
  // day right after the Sunday long — the back-to-back David reported. Only the
  // stated-frequency branch (easyCount < candidates) runs this; null-frequency fills
  // every slot below, byte-unchanged (David's path).
  const easyDowSet = new Set<number>();
  if (easyCount >= easyCandidates.length) {
    easyCandidates.forEach((e) => easyDowSet.add(e.dow));
  } else if (easyCount > 0) {
    const circDist = (a: number, b: number) => Math.min((a - b + 7) % 7, (b - a + 7) % 7);
    const anchors = slots.map((s, i) => (s && s.type !== 'rest' ? i : -1)).filter((i) => i >= 0);
    const maxGapOf = (run: number[]): number => {
      const sorted = [...run].sort((a, b) => a - b);
      let mg = 0;
      for (let j = 0; j < sorted.length; j++) {
        const g = ((sorted[(j + 1) % sorted.length] - sorted[j]) + 7) % 7 || 7;
        if (g > mg) mg = g;
      }
      return mg;
    };
    for (let k = 0; k < easyCount; k++) {
      const placed = [...anchors, ...easyDowSet];
      let best = -1, bestMin = -1, bestMax = 99, bestAdj = 9;
      for (const cand of easyCandidates) {
        if (easyDowSet.has(cand.dow)) continue;
        let minGap = 7;
        for (const o of placed) minGap = Math.min(minGap, circDist(cand.dow, o));
        const maxGap = maxGapOf([...placed, cand.dow]);
        const longAdj = circDist(cand.dow, longRunDow) === 1 ? 1 : 0;
        const better =
          minGap > bestMin
          || (minGap === bestMin && (maxGap < bestMax
          || (maxGap === bestMax && (longAdj < bestAdj
          || (longAdj === bestAdj && (best < 0 || cand.dow < best))))));
        if (better) { best = cand.dow; bestMin = minGap; bestMax = maxGap; bestAdj = longAdj; }
      }
      if (best >= 0) easyDowSet.add(best);
    }
  }

  const mathFloor = 3;
  const baselineFloor = easyMileFloor && easyMileFloor > 0 ? easyMileFloor : 0;
  // BASE, TAPER and CUTBACK weeks may legitimately step down · don't over-floor
  // a deliberate deload/taper. CUTBACK = 4th week per volumeCurve. 2026-06-21 ·
  // TAPER added (David signed off): flooring taper easy days at the runner's
  // baseline kept the REALIZED taper volume above the correctly-tapered weekly
  // field, so the final week dropped only ~5% when doctrine wants ~25%. Now the
  // taper actually lets down into the race (Pfitzinger/Daniels marathon taper).
  const isDeloadOrBase = phase === 'BASE' || phase === 'TAPER';
  const effectiveFloor = isDeloadOrBase
    ? mathFloor
    : Math.max(mathFloor, baselineFloor);
  const perEasyRaw = easyCount > 0 ? Math.round(remainingMi / easyCount) : 0;
  // Invariant: an easy run is NEVER longer than the long run — the long run is
  // the longest run of the week by definition. Without this, a cold-start or
  // mismatched-tier plan whose long is pinned at the tier's small peakLong cap
  // dumps the week's remaining volume onto the single easy day, producing the
  // inverted "9mi EASY vs 3mi LONG" plan (Lilley, 2026-06-20). Clamping easy ≤
  // long lowers the weekly total instead — the correct, gentler outcome for a
  // runner whose long-run capacity is small. For established runners the long
  // dwarfs any easy day, so this clamp never binds (no behaviour change).
  // RP-5 · strict separation: an easy day must be SHORTER than the long, never equal,
  // so the long is visibly the week's longest run (David's "every run is the same
  // distance" complaint — a small-tier 5K long pinned easy == long == 8mi). Cap easy
  // at ~0.8×long (and ≥1 below it); separation overrides the floor when they conflict
  // at large equal distances. For established runners the long dwarfs easy so this never binds.
  //
  // B5-EASY-SEP-1 (2026-06-23) · RP-5's 0.8×long-1 separation collapses beginner volume when
  // the long run is tiny (≤ effectiveFloor=3mi). A 2mi long → easySep=1 → perEasy=1mi →
  // 3-day beginner realizes 4mi of a 10mi target (60% shortfall). The validator's long-primacy
  // rule allows easy ≤ long + 0.15mi, so allowing easy = long for SMALL longs is valid and
  // avoids the collapse. David's complaint was about 8mi equal distances, not 3mi beginners.
  const easySep = longMi > 0
    ? (longMi <= effectiveFloor
        ? longMi  // tiny long (beginner early weeks): easy may equal the long — within validator's 0.15mi tolerance
        : Math.max(1, Math.min(longMi - 1, Math.round(0.8 * longMi))))
    : perEasyRaw;
  // VDEAD-RAMP-1 (2026-06-23) · budget ceiling on the easy-day floor, but ONLY for
  // non-deload non-base weeks where floor inflation can hit the §3 validator ceiling.
  // Two disjoint exemptions:
  //
  // Exemption A (easySep < effectiveFloor): small long run (e.g. 2.5mi → easySep=1.5) means
  //   the final `min(max(floor, raw), easySep)` already caps perEasy at 1.5mi — far below the
  //   3mi floor. No budget cap needed; reducing the floor further exposes a 73% WoW jump.
  //
  // Exemption B (isDeloadOrBase): BASE and cutback weeks INTENTIONALLY keep the floor to
  //   smooth WoW transitions. A 9mi-budget BASE cutback with long=6 + 3 easy × floor=3mi
  //   realizes 15mi. The QUALITY phase starts at 14mi — a -7% drop, not a +56% spike.
  const perEasyBudgetCap = easyCount > 0 ? Math.max(1, Math.floor(remainingMi / easyCount)) : 0;
  const flooredPerEasy = (easySep < effectiveFloor || isDeloadOrBase)
    ? effectiveFloor                              // exempt: easySep or deload/base handles the bound
    : Math.min(effectiveFloor, perEasyBudgetCap); // cap: prevent peak-week ceiling violation
  const perEasy = Math.min(Math.max(flooredPerEasy, perEasyRaw), easySep);
  for (const { dow } of emptySlots) {
    slots[dow] = easyDowSet.has(dow)
      ? { dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Conversational. Z2 HR cap.' }
      : { dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
  }

  // DOCTRINE-STRIDES-1 (2026-08-17) · put strides on the week's easy days.
  //
  // Research/04 §7.2: "| When in cycle | All phases — never stop doing strides |",
  // "| Placement | End of an easy run, mid-warmup before a workout, or standalone
  // day |", "| Frequency | 2–4×/week |". Research/00a §"Practical base-building
  // rules": "| Strides preserved | 4–8×100 m strides 1–2×/wk maintain
  // neuromuscular function |". §15's phase table lists strides in the base row
  // AND the sharpening/taper row — they are the one thing doctrine never takes
  // away, and the engine had them nowhere.
  //
  // The strides go in the SUB_LABEL, not the notes, because sub_label is what
  // persistPlan hands to buildWorkoutSpec as the prescription. Writing them into
  // notes — which is what the race-week shakeout did — produces a row that
  // promises strides over a spec that has none, and a watch that runs a flat jog.
  // Distance is untouched: Research/04:349 "Not a workout".
  {
    let strideDays = 0;
    for (let d = 0; d < 7 && strideDays < STRIDE_DAYS_PER_WEEK; d++) {
      const s = slots[d];
      if (!s || s.type !== 'easy' || s.distanceMi <= 0) continue;
      s.subLabel = `EASY · ${STRIDE_DEFAULT_REPS}×${STRIDE_DURATION_S}s strides`;
      s.notes = `${s.notes} Finish with ${STRIDE_DEFAULT_REPS} relaxed ${STRIDE_DURATION_S}-second strides, full recovery between.`;
      strideDays++;
    }
  }

  // 2026-06-21 · INV13 guard · never author a labeled running day with a non-
  // positive distance. A degenerate budget (tiny taper week, 0-base cold start)
  // can round a quality/tune-up/easy slot to 0mi — a "QUALITY 0mi" row is worse
  // than no row. Demote any non-positive running day to rest. 'race' is exempt
  // (always carries the race distance); 'rest' is already 0.
  for (let d = 0; d < 7; d++) {
    const s = slots[d];
    if (s && s.type !== 'rest' && s.type !== 'race' && s.distanceMi <= 0) {
      slots[d] = { dow: d as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
    }
  }

  return slots as DayPlan[];
}

/** "Get them running on day one." If the week's anchor-day slot is a rest
 *  day, relocate an easy run onto it — stolen from the easy day furthest
 *  out — so a fresh onboarder isn't met with several rest days before
 *  their first run. The long + quality days and the weekly run count stay
 *  put; only an easy day moves. No-op when the anchor already runs or
 *  there's no easy day to relocate (a low-frequency week that's all
 *  long + quality).
 *
 *  FRONTLOAD-AVAIL-1 (2026-08-19) · IT NOW READS `availableDows`.
 *
 *  It never did, and it is the only placement step in the engine that
 *  writes a running day without consulting the days the runner said they
 *  can run. Every runner who signed up mid-week AND named their days got
 *  their first-ever prescription on a day they had just told us they
 *  cannot run — live on the beginner QA account, which said Tue/Thu/Sat,
 *  signed up on a Wednesday, and was handed `dow3 easy 1.0mi`. Week 1
 *  onward was correct, because week 1 onward never goes through here.
 *
 *  The destination is now chosen, not assumed:
 *    · anchor day available (or availability unset) → the anchor, exactly
 *      as before. Byte-identical for every plan that was already correct.
 *    · anchor day UNAVAILABLE → the soonest day the runner CAN run that is
 *      currently rest and lands before the donor. That still honours the
 *      rule ("start them as soon as they are able") without prescribing a
 *      day they ruled out.
 *    · nothing earlier available → no-op. A runner who cannot run today
 *      does not need to be started today.
 *
 *  The run count is conserved either way (one rest becomes easy, the donor
 *  becomes rest), so the frequency cap and the long/quality days are
 *  untouched, and the moved day is always easy → no hard-day adjacency is
 *  created that was not already there. */
function frontLoadFirstRun(
  days: DayPlan[],
  anchorDow: number,
  availableDows: Set<number> | null = null,
  /** FRONTLOAD-SPREAD-1 · refuse a destination that clusters the week onto
   *  consecutive days. Set by the maintenance composer, whose own MAINT-SPREAD-1
   *  pass exists to break exactly that pattern and whose weeks are graded on it
   *  by `_maint_invariants.test.ts` — moving a run onto the anchor without
   *  asking put 80 maintenance weeks onto three consecutive days. Left OFF for
   *  `composePlan`, which has never had a spacing rule here and whose plans stay
   *  byte-identical. */
  preserveSpread = false,
): void {
  const todaySlot = days.find((d) => d.dow === anchorDow);
  if (!todaySlot || todaySlot.type !== 'rest') return; // already runs today
  const easies = days.filter((d) => d.type === 'easy' && d.distanceMi > 0);
  if (easies.length === 0) return; // only long/quality this week — leave them
  const offset = (dow: number) => (dow - anchorDow + 7) % 7;
  const donor = easies.reduce((a, b) => (offset(b.dow) > offset(a.dow) ? b : a));
  const candidates: DayPlan[] = (availableDows == null || availableDows.has(anchorDow))
    ? [todaySlot]
    : days
      .filter((d) => d.type === 'rest' && availableDows.has(d.dow) && offset(d.dow) < offset(donor.dow))
      .sort((a, b) => offset(a.dow) - offset(b.dow));
  /** Longest run of consecutive calendar days among the week's running days,
   *  measured from the week's own start — the same shape `_maint_invariants`
   *  grades on, so this reads the number the gate reads. */
  const maxConsecutive = (dows: number[]): number => {
    const offs = dows.map(offset).sort((a, b) => a - b);
    let best = 0, run = 0, prev = -2;
    for (const o of offs) { run = o === prev + 1 ? run + 1 : 1; prev = o; best = Math.max(best, run); }
    return best;
  };
  const before = maxConsecutive(days.filter((d) => d.distanceMi > 0).map((d) => d.dow));
  const dest = candidates.find((c) => {
    if (!preserveSpread) return true;
    const after = maxConsecutive(
      days.filter((d) => d.distanceMi > 0 && d.dow !== donor.dow).map((d) => d.dow).concat(c.dow),
    );
    // Two-in-a-row is ordinary; three is the cluster MAINT-SPREAD-1 names. A
    // week that is already denser than that may not be made denser still.
    return after <= Math.max(before, 2);
  });
  if (dest == null) return; // nothing they can run sooner without clustering the week
  dest.type = 'easy';
  dest.distanceMi = donor.distanceMi;
  dest.isQuality = false;
  dest.isLong = false;
  dest.subLabel = 'EASY';
  dest.notes = 'First run. Ease in at a conversational pace · the week settles into its rhythm from here.';
  donor.type = 'rest';
  donor.distanceMi = 0;
  donor.isQuality = false;
  donor.isLong = false;
  donor.subLabel = 'REST';
  donor.notes = 'Off. Sleep, hydrate, mobilize.';
}

// ── Mid-block tune-up race embedding (2026-08-17 · MIDRACE-1) ──────────
//
// Before this, the generator scheduled ordinary training straight over a
// runner's own dated B/C races inside the plan window (horizonRaces only
// looked at LONGER races AFTER the target, and race_week_tuneup only
// exists for the plan's own race week). David's CIM block carried Santa
// Monica 10K (B), Dodgers 10K (C), and Run Malibu Half (B) with a tempo
// or a 16-mile long authored on top of each.
//
// Doctrine:
//   · Research/22-plan-templates.md §11 "5K-10K series" — race week is
//     "1 short quality + race; rest of week is E".
//   · Research/22 §Half-Advanced + §Marathon-Advanced list "tune-up race"
//     as a KEY WORKOUT of the build; §15 BQ table: "tune-up half at
//     HMP-T, 4-6 wk out".
//   · Research/01-pace-zones-vdot.md:679-682 — tune-up races are the
//     build's natural fitness tests.
//   · Post-race recovery scale: POST_RACE_RECOVERY_WEEKS (goal-tiers.ts,
//     Research/00b) — 5K needs ~1 easy day, 10K 1-2, half 3-4 before
//     quality resumes (the in-plan mini version of the full-recovery
//     weeks table).
//
// Shape:
//   B race → the calendar day becomes a `race` day at the race's own
//     distance; the 2 preceding days ease (day-1 shakeout, day-2 no
//     quality) and 1-4 post-race days run easy before quality resumes.
//     The week is flagged isCutback so the validator's WoW check treats
//     the return to normal volume as a planned deload return (RC2-4).
//   C race → the week keeps its structure; the race day replaces the
//     week's nearest quality slot (the race IS that week's quality),
//     with 1 easy day before and 1 after — no deeper mini-taper.
//
// Long-run rule: the training long is never displaced — the only case
// where a long disappears is when the race lands ON the long-run day
// (B half on the weekend: the race replaces the long). One deliberate
// exception, per race-mile recovery doctrine: a HALF-or-longer B race
// converts a long run that falls inside its post-race recovery window
// to easy (running a full long inside 3-4 recovery days after 13.1
// raced miles is the exact stimulus the recovery table forbids); a
// 10K-or-shorter tune-up leaves a next-day long in place (the classic
// Pfitzinger Saturday-tune-up → Sunday-long pattern).
//
// Runs INSIDE composePlan (before finalizeComposedPlan), so the WoW
// smoothers + VOL-1 reconcile see the embedded week. Gated on
// midBlockRaces being non-empty → plans without mid-block races are
// byte-identical.

export type MidBlockRace = NonNullable<ComposePlanInput['midBlockRaces']>[number];

/** MIDRACE-TAPER-1 · running days the B-race mini-taper covers (day-1 shakeout, day-2 eased). */
const MINI_TAPER_RUNNING_DAYS = 2;
/** …found within this many CALENDAR days, so a rest-heavy week can't drag the taper onto the long run. */
const MINI_TAPER_LOOKBACK_DAYS = 4;

export interface EmbeddedRaceSummary {
  slug: string;
  name: string;
  date: string;
  distanceMi: number;
  priority: 'B' | 'C';
  weekIdx: number;
}

/* ─────────────────────────────────────────────────────────────────────────
 * RACE-RUNUP-1 (2026-08-24) · THE SEVEN DAYS BEFORE THE GOAL RACE
 *
 * The race-week composer lays out a race week from `raceDow` INSIDE the
 * composed week the race falls in. That works while race day sits near the
 * end of that week, and stops working the moment it does not: the days that
 * lead into the race are then in the PREVIOUS composed week, where nothing
 * knows a race is coming. Under the old literal anchor a well-formed race
 * week required `raceDow === (startDow + 6) % 7` — one signup weekday in
 * seven — and the composer's own probe shows what the other six produce: for
 * a Monday-anchored block with a Sunday race, the last week before the race
 * ends with a TEN-MILE LONG RUN on the Saturday. The day before a marathon.
 *
 * WEEK-ALIGN-1 changes which combinations land there (the grid is now the
 * runner's training week, so a Sunday-long runner racing on a Sunday is
 * perfect and a Saturday-long runner racing on a Sunday is the bad corner),
 * but it does not remove the class. This does, and it is scoped to the two
 * things every template in the doctrine agrees on:
 *
 *   · NO LONG RUN in the seven days ending on race day. Not one of the four
 *     race-week templates in Research/08 §9.3 contains one.
 *   · THE LAST RUNNING DAY BEFORE THE RACE IS A SHAKEOUT. Marathon Sat, half
 *     Sat, 10K Fri, 5K Fri — all four, all "15-25 min easy + strides".
 *
 * Deliberately silent on QUALITY placement. The templates put one race-prep
 * workout at T-5, and for a 5K or 10K that lands inside four days of the gun
 * on purpose; a blanket no-quality window would delete the sharpener the
 * doctrine prescribes. The mid-block B-race mini-taper below has its own
 * no-quality rule because a tune-up is not the goal race and the trade is
 * different.
 *
 * A NO-OP on every block whose race week was already well-formed: the last
 * running day there is already the composer's own 2-mile shakeout, and there
 * is no long run to move.
 *
 * Cite: Research/08-pacing-and-race-week.md §"Day-by-day race week templates"
 * Watched by: RACE_RUNUP.no-long-run-in-race-week and
 *             RACE_RUNUP.last-run-is-a-shakeout in lib/doctrine/registry.ts.
 * ──────────────────────────────────────────────────────────────────────── */

/** Calendar days before race day that the run-up owns. Seven days ending ON
 *  race day = race day plus the six before it, which is the span every
 *  Research/08 §9.3 template is written over. */
export const RACE_RUNUP_DAYS = 6;
/** How close a running day has to be for the shakeout rule to claim it. The
 *  templates put the shakeout at T-1; T-2 is allowed because a runner whose
 *  T-1 is a rest day has already tapered it and the day before THAT is the
 *  last time they run. Beyond that, leave the week alone. */
const SHAKEOUT_WINDOW_DAYS = 2;
/** What a long run inside the run-up becomes. Same ceiling the B-race
 *  mini-taper uses for the same reason — an easy run, not a session. */
const RUNUP_EASY_CAP_MI = 6;

/**
 * Enforces the two run-up rules above across composed WEEK BOUNDARIES.
 * Mutates `weeks` in place. Returns the dates it changed, for the record.
 */
export function guardGoalRaceRunUp(
  weeks: ComposedWeek[],
  opts: { startMondayISO: string; raceDateISO: string },
): string[] {
  const totalDays = weeks.length * 7;
  const raceOff = daysBetween(opts.startMondayISO, opts.raceDateISO);
  if (raceOff <= 0 || raceOff >= totalDays) return [];
  const startDow = new Date(opts.startMondayISO + 'T12:00:00Z').getUTCDay();
  // Unlike `embedMidBlockRaces`' accessor this does NOT skip the race week.
  // Reaching into it is the entire point: the run-up spans the seam.
  const dayAt = (o: number): DayPlan | null => {
    if (o < 0 || o >= totalDays) return null;
    const wi = Math.floor(o / 7);
    const dow = ((startDow + o) % 7) as DOW;
    return weeks[wi]?.days.find((d) => d.dow === dow) ?? null;
  };

  const changed: string[] = [];
  const dateOf = (o: number) => addDays(opts.startMondayISO, o);

  // 1 · No long run in the seven days ending on race day.
  for (let j = 1; j <= RACE_RUNUP_DAYS; j++) {
    const d = dayAt(raceOff - j);
    if (!d || d.type === 'race') break;   // plan edge, or an embedded B race owns its own taper
    if (!d.isLong && d.type !== 'long') continue;
    d.type = 'easy';
    d.isLong = false;
    d.isQuality = false;
    d.distanceMi = Math.min(d.distanceMi, RUNUP_EASY_CAP_MI);
    d.subLabel = 'EASY';
    d.notes = 'Easy. Race week · the long run is behind you.';
    delete d.raceGoalPaceSec;
    changed.push(dateOf(raceOff - j));
  }

  // 2 · The last running day before the race is a shakeout.
  for (let j = 1; j <= SHAKEOUT_WINDOW_DAYS; j++) {
    const d = dayAt(raceOff - j);
    if (!d || d.type === 'race') break;
    if (d.distanceMi <= 0) continue;      // a rest day is already taper
    if (d.type === 'shakeout') break;     // the composer already did this
    d.type = 'shakeout';
    d.distanceMi = 2;
    d.isQuality = false;
    d.isLong = false;
    // DOCTRINE-STRIDES-1 · strides belong in the sub_label, which is the
    // prescription spec-builder reads.
    d.subLabel = 'SHAKEOUT · 4×20s strides';
    d.notes = '2 mi easy. Loosen the legs.';
    delete d.raceGoalPaceSec;
    changed.push(dateOf(raceOff - j));
    break;
  }

  return changed;
}

export function embedMidBlockRaces(
  weeks: ComposedWeek[],
  vols: number[],
  opts: {
    startMondayISO: string;
    raceDateISO: string;
    midBlockRaces: MidBlockRace[];
    trainingDaysPerWeek: number | null;
  },
): EmbeddedRaceSummary[] {
  const totalDays = weeks.length * 7;
  const startDow = new Date(opts.startMondayISO + 'T12:00:00Z').getUTCDay();
  // Absolute-offset day accessor. Returns null outside the plan window and
  // inside the plan's own race week (that week's structure is owned by the
  // race-week composer — mini-taper/recovery must never leak into it).
  const dayAt = (o: number): DayPlan | null => {
    if (o < 0 || o >= totalDays) return null;
    const wi = Math.floor(o / 7);
    if (!weeks[wi] || weeks[wi].isRaceWeek) return null;
    const dow = ((startDow + o) % 7) as DOW;
    return weeks[wi].days.find((d) => d.dow === dow) ?? null;
  };
  const touchedWeeks = new Set<number>();
  const embedded: EmbeddedRaceSummary[] = [];
  const races = [...opts.midBlockRaces].sort((a, b) => a.date.localeCompare(b.date));

  for (const race of races) {
    if (!race?.date || !(race.distanceMi > 0)) continue;
    if (race.date >= opts.raceDateISO) continue;         // at/after the target race → not mid-block
    const o = daysBetween(opts.startMondayISO, race.date);
    if (o < 0 || o >= totalDays) continue;
    const wi = Math.floor(o / 7);
    const slot = dayAt(o);
    if (!slot || slot.type === 'race') continue;         // race week / already embedded
    const wasLong = slot.isLong;
    const wasQuality = slot.isQuality;
    const wasRest = slot.type === 'rest' && slot.distanceMi === 0;

    // The race day itself — race-effort framing at the race's own distance.
    slot.type = 'race';
    slot.distanceMi = race.distanceMi;
    slot.isQuality = true;                               // the race is the day's (and often the week's) quality
    slot.isLong = wasLong;                               // race ON the long-run day replaces the long
    slot.subLabel = 'RACE';
    slot.raceGoalPaceSec = race.goalPaceSec ?? null;
    slot.notes = race.priority === 'B'
      ? `${race.name}. B race · race effort. Recovery days follow before quality resumes.`
      : `${race.name}. C race · this is the week's quality session. Run it as the workout.`;
    touchedWeeks.add(wi);

    if (race.priority === 'B') {
      // Mini-taper · no quality within the 2 RUNNING days before the race, and
      // the last running day before it is a shakeout (Research/08 §9 race-week
      // idiom scaled down). The long run is never displaced pre-race.
      //
      // MIDRACE-TAPER-1 (2026-08-17) · this used to index CALENDAR offsets −1
      // and −2, which made the whole mini-taper a no-op for the commonest
      // layout there is. The owner rests Saturday and races Sunday: the −1
      // guard required `distanceMi > 0`, so a rest day the day before the race
      // silently SKIPPED the taper, and −2 was his short Friday easy — already
      // not quality — so the Thursday session stood untouched. Both his B races
      // (Santa Monica 10K, Run Malibu Half) were authored off a full Thursday
      // quality session with no taper of any kind. A rest day IS taper; the
      // eased days have to be the days he actually runs.
      const preRun: { day: DayPlan; off: number }[] = [];
      for (let j = 1; j <= MINI_TAPER_LOOKBACK_DAYS && preRun.length < MINI_TAPER_RUNNING_DAYS; j++) {
        const d = dayAt(o - j);
        if (!d || d.type === 'race') break;      // plan window edge or another race
        if (d.distanceMi <= 0) continue;         // a rest day is already taper
        preRun.push({ day: d, off: o - j });
      }
      // No quality inside the mini-taper.
      for (const { day: d, off } of preRun) {
        if (!d.isQuality || d.isLong) continue;
        d.type = 'easy';
        d.distanceMi = Math.min(d.distanceMi, 6);
        d.isQuality = false;
        d.subLabel = 'EASY';
        d.notes = `Easy. Inside the mini-taper for ${race.name} · no quality this close.`;
        delete d.raceGoalPaceSec;
        touchedWeeks.add(Math.floor(off / 7));
      }
      // The last running day before the race is the shakeout.
      const lastRun = preRun[0];
      if (lastRun && !lastRun.day.isLong) {
        const d = lastRun.day;
        d.type = 'shakeout';
        d.distanceMi = 2;
        d.isQuality = false;
        d.isLong = false;
        // DOCTRINE-STRIDES-1 · same move as the race-week shakeout: strides
        // belong in the sub_label, which is the prescription spec-builder reads.
        d.subLabel = 'SHAKEOUT · 4×20s strides';
        d.notes = `2 mi easy. Loosen the legs for ${race.name}.`;
        delete d.raceGoalPaceSec;
        touchedWeeks.add(Math.floor(lastRun.off / 7));
      }
      // Post-race easy days per race-mile scale (see doctrine block above):
      // half+ → 4, 10K/5-11mi → 2, shorter → 1.
      const recoveryDays = race.distanceMi >= 12 ? 4 : race.distanceMi >= 5 ? 2 : 1;
      let firstDisplacedQuality: Pick<DayPlan, 'type' | 'distanceMi' | 'subLabel'> | null = null;
      for (let j = 1; j <= recoveryDays; j++) {
        const d = dayAt(o + j);
        if (!d || d.type === 'race') continue;
        const wiJ = Math.floor((o + j) / 7);
        if (d.isQuality && !d.isLong) {
          if (!firstDisplacedQuality) {
            firstDisplacedQuality = { type: d.type, distanceMi: d.distanceMi, subLabel: d.subLabel };
          }
          d.type = 'easy';
          d.distanceMi = Math.min(d.distanceMi, 5);
          d.isQuality = false;
          d.subLabel = 'EASY';
          d.notes = `Post-race recovery · day ${j} after ${race.name}. Easy only; quality resumes after the recovery window.`;
          delete d.raceGoalPaceSec;
          touchedWeeks.add(wiJ);
        } else if (d.isLong && race.distanceMi >= 12) {
          // Deliberate long-rule exception (documented above): a half+ B race
          // converts a long inside its recovery window to easy.
          d.type = 'easy';
          d.distanceMi = Math.min(d.distanceMi, 6);
          d.isQuality = false;
          d.isLong = false;
          d.subLabel = 'EASY';
          d.notes = `Post-race recovery · day ${j} after ${race.name}. The long run stands down this week; easy miles only.`;
          delete d.raceGoalPaceSec;
          touchedWeeks.add(wiJ);
        }
      }
      // Quality RESUMES after the recovery window. When the window swallowed
      // every quality session of the week it ends in (a Sunday half's 4 easy
      // days cover Mon-Thu → both Tue/Thu quality slots), restore the FIRST
      // displaced session onto the first easy day after the window — the
      // validator (§5) rightly requires ≥1 quality per quality-phase week,
      // and doctrinally quality returns once recovery is served (threshold
      // first: an intervals session is downgraded to threshold, the gentler
      // gap-1 stimulus — mirrors scheduleQuality's GAP-mode downgrade).
      if (firstDisplacedQuality) {
        const endWi = Math.floor((o + recoveryDays) / 7);
        const wkEnd = weeks[endWi];
        if (endWi !== wi && wkEnd && !wkEnd.isRaceWeek && !wkEnd.days.some((d) => d.isQuality)) {
          for (let oo = o + recoveryDays + 1; oo < (endWi + 1) * 7; oo++) {
            const d = dayAt(oo);
            if (d && d.type === 'easy' && d.distanceMi > 0 && !d.isLong) {
              const wasIntervals = firstDisplacedQuality.type === 'intervals';
              d.type = wasIntervals ? 'threshold' : firstDisplacedQuality.type;
              d.distanceMi = firstDisplacedQuality.distanceMi;
              d.isQuality = true;
              d.subLabel = wasIntervals ? null : firstDisplacedQuality.subLabel;
              d.notes = `Quality resumes after ${race.name} recovery.`;
              touchedWeeks.add(endWi);
              break;
            }
          }
        }
      }
      // Planned-deload flag: the validator's §6 WoW check exempts the week
      // AFTER a cutback — returning from the tune-up week's reduced volume
      // is an expected jump, not a ramp error (RC2-4).
      weeks[wi].isCutback = true;
    } else {
      // C race · the race replaces the week's nearest quality slot.
      if (!wasQuality) {
        const oInWeek = o - wi * 7;
        let nearest: DayPlan | null = null;
        let nearestDist = Infinity;
        for (const d of weeks[wi].days) {
          if (!d.isQuality || d.isLong || d.type === 'race') continue;
          const dInWeek = ((d.dow - startDow) % 7 + 7) % 7;
          const dist = Math.abs(dInWeek - oInWeek);
          if (dist < nearestDist) { nearestDist = dist; nearest = d; }
        }
        if (nearest) {
          // When the race consumed the week's rest slot, the displaced
          // quality day becomes the rest day (the rest moves, it doesn't
          // vanish — a 7-running-day week is not "keeping the structure").
          if (wasRest) {
            nearest.type = 'rest';
            nearest.distanceMi = 0;
            nearest.isQuality = false;
            nearest.isLong = false;
            nearest.subLabel = 'REST';
            nearest.notes = `Off. ${race.name} takes this week's quality slot; rest moves here.`;
          } else {
            nearest.type = 'easy';
            nearest.isQuality = false;
            nearest.subLabel = 'EASY';
            nearest.notes = `Easy. ${race.name} is this week's quality session.`;
          }
          delete nearest.raceGoalPaceSec;
        }
      }
      // 1 easy day either side — no deeper mini-taper for a C race.
      for (const off of [-1, 1]) {
        const d = dayAt(o + off);
        if (d && d.type !== 'race' && d.isQuality && !d.isLong) {
          d.type = 'easy';
          d.isQuality = false;
          d.subLabel = 'EASY';
          d.notes = off < 0
            ? `Easy the day before ${race.name}.`
            : `Easy the day after ${race.name}.`;
          delete d.raceGoalPaceSec;
          touchedWeeks.add(Math.floor((o + off) / 7));
        }
      }
    }

    // A B race that consumed the rest slot: restore one rest day by
    // resting the week's shortest easy run (a 7-running-day week is not a
    // mini-taper). The C path already moved the rest onto the displaced
    // quality day above.
    if (wasRest && race.priority === 'B') {
      const easies = weeks[wi].days
        .filter((d) => d.type === 'easy' && d.distanceMi > 0)
        .sort((a, b) => a.distanceMi - b.distanceMi);
      if (easies.length > 0) {
        const victim = easies[0];
        victim.type = 'rest';
        victim.distanceMi = 0;
        victim.isQuality = false;
        victim.isLong = false;
        victim.subLabel = 'REST';
        victim.notes = `Off. ${race.name} takes the usual rest slot; rest moves here.`;
      }
    }

    // Frequency cap: a race that landed on a former rest day adds a running
    // day. Trim the shortest easy day back to rest so the runner's stated
    // days/week holds. NULL frequency (David / legacy) → untouched.
    if (opts.trainingDaysPerWeek != null) {
      let running = weeks[wi].days.filter((d) => d.distanceMi > 0).length;
      while (running > opts.trainingDaysPerWeek) {
        const easies = weeks[wi].days
          .filter((d) => d.type === 'easy' && d.distanceMi > 0)
          .sort((a, b) => a.distanceMi - b.distanceMi);
        if (easies.length === 0) break;
        const victim = easies[0];
        victim.type = 'rest';
        victim.distanceMi = 0;
        victim.isQuality = false;
        victim.isLong = false;
        victim.subLabel = 'REST';
        victim.notes = 'Off. Race week for a tune-up · rest is the work now.';
        running--;
      }
    }

    embedded.push({
      slug: race.slug, name: race.name, date: race.date,
      distanceMi: race.distanceMi, priority: race.priority, weekIdx: wi,
    });
  }

  // Weekly mileage accounting includes tune-up race miles (they are real
  // training-load miles inside the block — unlike the plan's own race day,
  // which is the event the block builds to). Keep vols[] in sync so the
  // validator's VOLS-SNAP coherence check (§0) holds.
  for (const wi of touchedWeeks) {
    const w = weeks[wi];
    if (!w) continue;
    w.weeklyMi = Math.round(w.days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
    if (Array.isArray(vols) && wi < vols.length) vols[wi] = w.weeklyMi;
  }

  return embedded;
}

/**
 * MIDRACE-RAMP-1 (2026-08-17) · the ramp ceiling, enforced AFTER tune-up
 * embedding, on the week that follows a B race.
 *
 * THE DEFECT. `volumeCurve` builds the block under `GENERAL_RAMP_CEILING`, and
 * then `embedMidBlockRaces` rewrites `w.weeklyMi` (and `vols[]`) for every week
 * it touches — so the ceiling is computed on numbers that no longer exist by
 * the time the plan is persisted. The validator does not catch the gap either:
 * embedding flags the tune-up week `isCutback`, and the §6 week-over-week check
 * deliberately exempts the week after a cutback. The cap is therefore bypassed
 * in exactly the place it is load-bearing. On the owner's CIM block the week
 * immediately after a raced half came out at +37% week-over-week AND as the
 * single biggest week of the block, carrying its longest run.
 *
 * THE RULE. A week following an embedded B race may not exceed
 *   · the last UNDISTORTED week × the runner's general ramp ceiling — the
 *     tune-up week itself is a mini-tapered week, so ramping off it would
 *     punish the runner for tapering, which is why the validator exempts it in
 *     the first place; and
 *   · when the tune-up was a half or longer, the biggest week that came before
 *     it. Returning from 13.1 raced miles you may come back to your previous
 *     peak. You may not come back PAST it: `POST_RACE_RECOVERY_WEEKS.hm` is two
 *     weeks of no quality, and the block does not peak inside them. A 5K/10K
 *     tune-up is a hard workout, not a recovery event, so it takes the ramp
 *     ceiling only and the block may legitimately reach a new high.
 * C races are untouched — they take the week's quality slot without a mini-taper
 * or a volume drop, so there is no cutback to return from.
 *
 * The surplus comes off the easy days first (Research/08 §9.1 · "the largest
 * cut is to easy mileage" — the same ordering `finalizeComposedPlan`'s taper
 * rescale already cites), spilling proportionally onto the rest only when easy
 * mileage alone cannot cover it. The key session survives the cap.
 *
 * AND the long run inside a half-or-longer B race's no-quality window loses its
 * race-pace finish. `POST_RACE_RECOVERY_WEEKS.hm` is 2 weeks of no quality
 * (Research/00b §"Post-Race Recovery"); `embedMidBlockRaces`' own 4-day easy
 * window covers the first days and stops, so a 21.5-mile long with a 10.5-mile
 * marathon-pace finish landed six days after 13.1 raced miles. Stripping the
 * finish leaves the aerobic long intact and removes the quality that doctrine
 * says has not been earned back yet.
 *
 * WHERE IT RUNS. Inside `finalizeComposedPlan`, AFTER the VOL-1 reconcile and
 * before the taper enforcement. Running it in `composePlan` (the obvious place,
 * right after the embed) compares BUDGET volumes, and the budget is not what
 * ships: the per-day caps trim weeks afterwards, so the reference week shrank
 * from 54 to 51 while the capped week kept the 53.5 the budget allowed and
 * stayed the block's peak. Same budget-vs-realized trap COH-4 documents one
 * pass below. The taper then descends from the corrected peak.
 */
export function enforceRampCeilingAfterEmbedding(
  weeks: ComposedWeek[],
  vols: number[],
  level: LevelKey,
  embedded: EmbeddedRaceSummary[],
): void {
  const ceiling = GENERAL_RAMP_CEILING[level ?? 'intermediate'];
  const bRaceWeeks = new Set(embedded.filter((e) => e.priority === 'B').map((e) => e.weekIdx));
  for (const e of embedded) {
    if (e.priority !== 'B') continue;
    const wi = e.weekIdx + 1;
    const w = weeks[wi];
    const prev = weeks[wi - 1];
    if (!w || !prev || w.isRaceWeek || bRaceWeeks.has(wi)) continue;
    // Race-pace finish inside the post-race no-quality window (half+ only).
    if (e.distanceMi >= 12) {
      const long = w.days.find((d) => d.isLong && d.type === 'long' && d.distanceMi > 0);
      if (long && splitDay(long).qualityMi > 0) setLongFinish(long, 0);
    }
    // Ramp reference · the most recent week distorted by neither a tune-up nor
    // a planned cutback. Falls back to the prior peak when the block has none.
    const priorPeak = Math.max(...weeks.slice(0, wi).map((x) => x.weeklyMi ?? 0));
    let refMi = 0;
    for (let k = wi - 1; k >= 0; k--) {
      if (bRaceWeeks.has(k) || weeks[k].isCutback || weeks[k].isRaceWeek) continue;
      refMi = weeks[k].weeklyMi ?? 0;
      break;
    }
    if (!(refMi > 0)) refMi = priorPeak;
    const cap = e.distanceMi >= 12
      ? Math.min(refMi * ceiling, priorPeak)
      : refMi * ceiling;
    if (!(cap > 0) || (w.weeklyMi ?? 0) <= cap + 0.05) continue;
    trimWeekToVolume(w, cap);
    if (Array.isArray(vols) && wi < vols.length) vols[wi] = w.weeklyMi;
  }
}

/** Easy-day floor the MIDRACE-RAMP-1 trim will not cut below before spilling
 *  onto the rest of the week. Matches layoutWeek's own coherence minimum. */
const RAMP_TRIM_MIN_EASY_MI = 3;

/** Bring a composed week down to `targetMi`, easy days first.
 *
 *  `protectLong` (WKRAMP-1, 2026-08-19) · leave the long run out of the
 *  proportional spill. The long carries its OWN doctrine — the 110%
 *  single-session spike rule (Research/00a §"Practical load rules"), the 30%
 *  week-over-week cap in `CONSTRAINTS.longRunWoWMaxPct`, and
 *  `finalizeComposedPlan`'s `smoothLongWoW` — and it is the session the block
 *  exists to build. A weekly-total cap that pays for itself out of the long
 *  would trade the progression doctrine governs for the one it does not.
 *  MIDRACE-RAMP-1 keeps the old behaviour (it caps a post-race week where
 *  shrinking the long is the point). */
function trimWeekToVolume(week: ComposedWeek, targetMi: number, protectLong = false): void {
  const sum = () => Math.round(week.days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
  const easies = week.days.filter((d) => d.type === 'easy' && d.distanceMi > RAMP_TRIM_MIN_EASY_MI);
  const easyMi = easies.reduce((s, d) => s + d.distanceMi, 0);
  const easyFloorMi = easies.length * RAMP_TRIM_MIN_EASY_MI;
  let surplus = sum() - targetMi;
  if (surplus > 0 && easyMi > easyFloorMi) {
    const take = Math.min(surplus, easyMi - easyFloorMi);
    const scale = (easyMi - take) / easyMi;
    for (const d of easies) {
      d.distanceMi = Math.max(RAMP_TRIM_MIN_EASY_MI, Math.floor(d.distanceMi * scale * 2) / 2);
    }
    surplus = sum() - targetMi;
  }
  if (surplus > 0.05) {
    // Easy alone could not cover it · scale every non-race day proportionally,
    // which preserves the easy<long ordering layoutWeek established.
    const trimmable = week.days.filter((d) => d.type !== 'race' && d.distanceMi > 0 && !(protectLong && d.isLong));
    const total = trimmable.reduce((s, d) => s + d.distanceMi, 0);
    if (total > 0) {
      const scale = Math.max(0, (total - surplus) / total);
      for (const d of trimmable) {
        const next = Math.floor(d.distanceMi * scale * 2) / 2;
        // WKRAMP-1 (2026-08-19) · THE CAP IS BEST-EFFORT BELOW THE JUNK-RUN FLOOR.
        //
        // Sparing the long concentrates the whole surplus onto the other days,
        // and at low volume a proportional scale drove them under two miles —
        // 322 of them across the maintenance-invariant matrix, which is the
        // "junk run" class RP-FREQ-FLOOR exists to hold at zero. A sub-2mi
        // easy run is misallocation, not training: it costs a session's
        // logistics and returns almost no stimulus, and it appears on the
        // runner's week looking like a mistake, because it is one.
        //
        // So every run this trim keeps stays at or above the floor, and when
        // the cap cannot be reached without breaking it the week simply lands
        // as close as the floor allows. That is the right trade. The ramp
        // ceiling exists to stop a big absolute jump in load; at the volumes
        // where this binds the residue is a mile or two, and the acute:chronic
        // backstop in validate.ts still has the week comfortably in hand.
        // Trading a real structural defect for a fractional ramp overshoot
        // would be paying a certain cost for a rounding error.
        if (protectLong && !d.isLong) { d.distanceMi = Math.max(TRIM_MIN_RUN_MI, next); continue; }
        if (d.isLong || d.isQuality) { d.distanceMi = Math.max(1, next); continue; }
        d.distanceMi = Math.max(0, next);
      }
    }
  }
  // A long run that was trimmed carries a finish segment sized for the old
  // distance · re-size it so sub_label never claims more MP miles than the day.
  const long = week.days.find((d) => d.isLong && d.type === 'long' && d.distanceMi > 0);
  if (long) {
    const finish = splitDay(long).qualityMi;
    if (finish > 0 && finish > long.distanceMi * 0.5) {
      setLongFinish(long, Math.max(0, Math.floor(long.distanceMi * 0.5 * 2) / 2));
    }
  }
  week.weeklyMi = sum();
}

/**
 * WKRAMP-1 (2026-08-19) · THE RAMP CEILING, ON THE VOLUME THAT ACTUALLY SHIPS.
 *
 * THE DEFECT. `volumeCurve` climbs under `GENERAL_RAMP_CEILING` — 20%/week for
 * a novice, 15% for a trained runner (Research/00a §"Volume progression
 * rules"). That ceiling governs the BUDGET. It does not govern the plan: the
 * budget is a weekly total handed to `layoutWeek`, which sizes each day against
 * its own floors and caps and hands back a day-sum that can sit well above what
 * it was given. VOL-1 then reconciles `weeklyMi` to that realized sum — honestly
 * reporting a number the ramp ceiling never saw.
 *
 * The gap opens widest exactly where it hurts most, at the BASE → QUALITY
 * phase boundary for a runner with almost no base. Marathon / beginner / f5 /
 * m35 / L0-3, on the 11,598-archetype sweep:
 *
 *   wk4 BASE     16 mi   long 4 · easy 3 · easy 3 · easy 3 · easy 3
 *   wk5 QUALITY  23 mi   long 5 · tempo 5 · easy 4 · tempo 5 · easy 4   +43.8%
 *
 * The curve asked for ~19. Two tempo sessions arrived at their own dose, and
 * the week came out at 23 — a 44% week-over-week jump for a first-time
 * marathoner whose longest run in the last month is four miles.
 *
 * Nothing downstream caught it. `validate.ts`'s `weeklyVolWoWMaxPct` was 50 —
 * fitted to this generator rather than to doctrine, which is not a guardrail.
 *
 * THE RULE. A week may not exceed the largest week the runner has already
 * completed in this block, times their general ramp ceiling:
 *
 *   cap = max(realized volume of every prior non-race week) × ceiling
 *
 * One rule, no special cases, and the two regimes doctrine distinguishes fall
 * out of it:
 *
 *   · A STEP onto new ground. While the block climbs, the prior peak IS last
 *     week, so the cap is last week × ceiling — the ramp doctrine states.
 *   · A REBOUND after a planned cutback. Research/00b §"What Cutback Weeks Are
 *     Not" — the reduction is planned, so the return to load is the design, not
 *     a ramp error. The prior peak is the pre-cutback week, so returning to it
 *     costs nothing, and the block may still step past it by the ceiling. This
 *     is why the check reads the peak and not the previous week: measuring a
 *     rebound against the deload week would punish the runner for deloading,
 *     which is the same reason `validate.ts` §6 exempts the post-cutback week
 *     outright.
 *
 * WHAT IT DOES NOT TOUCH. The long run (see `trimWeekToVolume`'s `protectLong`)
 * and the plan's own race week. Taper weeks are in scope but never bind — they
 * descend from the peak by construction, and the trim only ever removes miles.
 *
 * WHERE IT RUNS. `finalizeComposedPlan`, after the VOL-1 reconcile (so it reads
 * realized volume, not the budget — the same budget-vs-realized trap COH-4 and
 * MIDRACE-RAMP-1 both document) and after MIDRACE-RAMP-1, before the taper
 * pass, so the taper descends from the corrected peak.
 *
 * WKRAMP-REC-1 (2026-08-25) · THE THIRD REGIME, WHICH DEFEATED BOTH OF THOSE.
 *
 * The two regimes above are a STEP and a REBOUND, and both are measured against
 * the block's own prior peak. A post-race REVERSE TAPER is neither, and the
 * prior-peak reference fails on it completely: the block contains nothing but
 * deload weeks, so the reference IS the deload. Week 1 of a marathon recovery
 * is 15% of peak and the ceiling is 1.15, so the block's own arithmetic caps
 * week 4 at 0.15 × 1.15³ ≈ 23% of peak where Research/00b's row asks for 70-80%.
 * A 62 mi/wk marathoner authored the day after their race was given
 * 10 · 10 · 10 · 17 against doctrine's 9 · 22 · 34 · 47. The header above says
 * measuring a rebound against the deload week "would punish the runner for
 * deloading"; it got that right for a cutback inside a build and never
 * considered a block whose whole shape is downward.
 *
 * DOCTRINE-4 fixed the DENOMINATOR of those percentages four hours earlier —
 * peak instead of a trailing mean — which moved the delivered miles from about
 * 46% of the doctrine row to about 50%. The other half of the shortfall was
 * this pass, one layer down, undoing the fix on the way out.
 *
 * THE RULE FOR A REVERSE TAPER. `blockCeilingMi`, when the caller supplies one,
 * REPLACES the prior-peak reference for the whole block: no week may exceed it,
 * and nothing else is capped. `composeRecoveryPlan` supplies
 * `peakAnchor × recoveryBlockCeilingPct(cat)` — the deepest row doctrine
 * publishes for the distance just raced, off the same pre-race peak every week
 * of the block is already sized against. So the reverse taper reaches its rows,
 * and a recovery block still cannot climb past the volume the runner
 * demonstrated before the race (doctrine puts that at week 5-6, after the
 * block). Week-over-week is deliberately NOT checked here: inside a reverse
 * taper the step from 15% to 35% of peak IS the prescription, and grading it as
 * a ramp error is the defect.
 *
 * Absent (every build, maintenance and open block) this parameter is inert and
 * the pass is byte-identical.
 *
 * Cite: Research/00a-distance-running-training.md §"Volume progression rules"
 *       (via GENERAL_RAMP_CEILING — one constant, read by the curve, by this
 *       pass, and by `validate.ts`, so the three cannot diverge)
 * Cite: Research/00b-recovery-protocols.md §"What Cutback Weeks Are Not"
 *       (the rebound is the design)
 * Cite: Research/00b-recovery-protocols.md §"Marathon Recovery (4-week reverse taper)"
 *       (the reverse taper is stated against peak, not against itself)
 * Bound by RAMP.realized-weekly-step-is-the-general-ceiling.
 * Bound by RECOVERY.reverse-taper-ceiling-is-the-pre-race-peak.
 */
export function enforceWeeklyRampCeiling(
  weeks: ComposedWeek[],
  vols: number[],
  level: LevelKey,
  /** WKRAMP-REC-1 · a whole-block ceiling in miles, for a block whose shape is
   *  downward by design. Null/undefined → the week-over-week rule above. */
  blockCeilingMi?: number | null,
): void {
  const ceiling = GENERAL_RAMP_CEILING[level ?? 'intermediate'];
  if (blockCeilingMi != null && Number.isFinite(blockCeilingMi) && blockCeilingMi > 0) {
    for (let wi = 0; wi < weeks.length; wi++) {
      const w = weeks[wi];
      if (!w || w.isRaceWeek) continue;
      if ((w.weeklyMi ?? 0) > blockCeilingMi + 0.05) {
        trimWeekToVolume(w, blockCeilingMi, true);
        if (Array.isArray(vols) && wi < vols.length) vols[wi] = w.weeklyMi;
      }
    }
    return;
  }
  let priorPeak = 0;
  let prevMi = 0;
  for (let wi = 0; wi < weeks.length; wi++) {
    const w = weeks[wi];
    if (!w || w.isRaceWeek) continue;
    const mi = w.weeklyMi ?? 0;
    // Two references, deliberately different. The CAP is measured against the
    // prior peak — that is the doctrine reference, and it is what lets a
    // rebound off a planned cutback return to load for free. The SMALLNESS
    // exemption is measured against the previous week, because that is how
    // validate.ts §6 measures it, and the two must agree about which jumps are
    // too small to be worth calling a jump: at very low volume a %-step is
    // misleading (6mi → 9mi is +50% but only +3mi, a safe ramp for a cold-start
    // beginner). Measuring the exemption against the peak instead let a
    // 5K/advanced archetype keep an 11 → 15.5 week, exactly the case this pass
    // exists to catch.
    if (priorPeak > 0 && prevMi > 0) {
      const cap = priorPeak * ceiling;
      if (mi > cap && mi - prevMi > WKRAMP_ABS_SLACK_MI) {
        trimWeekToVolume(w, cap, true);
        if (Array.isArray(vols) && wi < vols.length) vols[wi] = w.weeklyMi;
      }
    }
    priorPeak = Math.max(priorPeak, w.weeklyMi ?? 0);
    prevMi = w.weeklyMi ?? 0;
  }
}

/** The shortest run WKRAMP-1's trim will leave standing. Mirrors the junk-run
 *  floor `_maint_invariants.test.ts` holds at zero (a sub-2mi non-long run when
 *  the week could afford better) and layoutWeek's own per-day coherence
 *  minimum. */
const TRIM_MIN_RUN_MI = 2;

/** The shortest easy run `composeRecoveryPlan` will place. The same junk-run
 *  floor as `TRIM_MIN_RUN_MI` above, and the reason a recovery week's realized
 *  volume lands on a grid of (running days × 2 mi) rather than exactly on its
 *  doctrine row. Exported (2026-08-25) so `anchor-fit.ts` can read the engine's
 *  own number when it attributes a low-volume miss, rather than restating it —
 *  a gate that copies the constant it is grading proves only that it agrees
 *  with itself. */
export const RECOVERY_MIN_EASY = 2;

/** Absolute slack on the WKRAMP-1 cap · the same 4mi the validator's §6 WoW
 *  check uses, so the generator and the validator agree about which jumps are
 *  too small to be meaningful. */
const WKRAMP_ABS_SLACK_MI = 4;

// ── Pure compose layer (2026-06-02) ─────────────────────────────────────
// Extracted from generatePlan() so the plan-engine bench can test the
// actual plan output against persona doctrine targets without a database.
// generatePlan() is the I/O wrapper · loadGeneratorInputs() gathers all
// the DB-sourced facts and bundles them into a ComposePlanInput · then
// composePlan() does the pure work and returns the plan shape ·
// persistPlan() writes it.
//
// All branching that depends on user data lives in loadGeneratorInputs,
// the test bench, or persona fixtures. composePlan is mechanically
// deterministic against a fixed input.

export interface ComposePlanInput {
  raceDistanceMi: number;
  goalSec: number | null;
  goalPaceSec: number | null;
  /** Race day ISO date (YYYY-MM-DD). */
  raceDateISO: string;
  /** Monday of the plan start week (YYYY-MM-DD). Caller computes from
   *  today() · keeps composePlan pure (no Date.now()). */
  startMondayISO: string;
  level: LevelKey;
  recentWeeklyMi: number;
  /** RAMPBASE-1 (2026-08-17) · the volume the build ramps FROM. Equals
   *  `recentWeeklyMi` for a runner in steady training; higher only when the
   *  28-day mean is depressed by an interruption the engine itself mandated
   *  (a race taper + its Research/00b recovery window). Undefined → the mean,
   *  which is the pre-RAMPBASE-1 behaviour, so every synthetic-input caller
   *  (sweep archetypes, benches, sims) is byte-identical. */
  rampBaseMi?: number;
  /** Transparency record for the above · lands in authored_state. */
  rampBaseEvidence?: RampBaseEvidence;
  easyDayMedianMi: number;
  /** 2026-06-03 · runner's recent peak long-run distance · floors the
   *  long-run sizing so the plan can't ask for a shorter long than the
   *  runner just did. 0 = no floor (cold start). */
  recentLongMi: number;
  /** 2026-06-03 · mid-block runner doctrine carriers. Optional · all
   *  default to 0/undefined for cold-start runners. Bench persona
   *  "david-mid-block" exercises each as a gap-rule assertion. See
   *  docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md for the full ruleset. */
  /** Runner's typical quality-day distance (mi) over last 28d · floors
   *  per-quality distance (Rule 2 · GAP). */
  recentQualityDistanceMi?: number;
  /** Median quality sessions per week over last 28d · density-ramp anchor
   *  (Rule 5 · GAP). */
  recentQualityPerWeek?: number;
  /** Best recent VDOT from races or quality runs in last 60d · pace-
   *  anchor blend source (Rule 3). When < tier-implied VDOT, early
   *  weeks anchor to this and ramp toward the goal tier. */
  bestRecentVdot?: number;
  /** SELFREPORT-1 (2026-08-21) · TRUE when `bestRecentVdot` above came from
   *  `profile.race_history` — a PR the runner typed into onboarding — rather
   *  than from a race or run the app observed. PARITY-1 seeds it that way when
   *  there is no measured signal at all, and the anchor it produced was stamped
   *  `measured_vdot`. See `AnchorSource` in ./anchor-provenance for why that is
   *  its own tier and not a relabelling of either neighbour. */
  bestRecentVdotSelfReported?: boolean;
  /** 2026-07-07 · AUDIT P1-56 · set ONLY when bestRecentVdot is undefined AND
   *  the runner's best race/run implied a VDOT below the Daniels table floor
   *  of 30 (not "no data" — a demonstrated pace that doesn't map onto the
   *  VDOT scale). resolveCurrentTPace (vdot.ts) reads this as tier 2, deriving
   *  T-pace directly from the anchor's OWN pace instead of falling straight to
   *  conservativeVdotFromMileage, which floors at VDOT 30 and can prescribe
   *  faster than the runner's own demonstrated race pace. */
  belowTableAnchor?: BelowTableAnchor | null;
  /** Banister TSB at generate-time · shifts cutback frequency to every
   *  3rd week when TSB < -10 (Rule 8). Optional · falls back to mod-4. */
  tsbAtStart?: number;
  /** 2026-06-03 · Rule 11 · horizon races · A/B-priority races within 24
   *  weeks of raceDateISO. When any has a LARGER tier band than the
   *  current race's tier, long-run dials (cap + share) extend toward
   *  that larger band. Weekly cap + quality density stay current-race.
   *  Empty/undefined = no horizon. Cite: §Rule 11 + Pfitz Advanced
   *  Marathoning §"Bridging from half to full." */
  horizonRaces?: Array<{
    slug: string;
    name: string;
    date: string;
    distanceMi: number;
    goalPaceSec: number | null;
    priority: 'A' | 'B';
  }>;
  /** 2026-08-17 · MIDRACE-1 · B/C-priority races dated INSIDE the plan
   *  window (start ≤ date < plan race day). The generator embeds each as
   *  a tune-up: B → race day + 2-day mini-taper + post-race easy days
   *  before quality resumes; C → the race converts the week's nearest
   *  quality slot (the race IS that week's quality), 1 easy day either
   *  side. Undefined/empty → composePlan output is byte-identical.
   *  Cite: Research/22-plan-templates.md §11 (multi-race planning ·
   *  "1 short quality + race; rest of week is E"), §Half-Advanced /
   *  §Marathon-Advanced key workouts ("tune-up race" / "tune-up half"),
   *  Research/01-pace-zones-vdot.md:679-682 (tune-up races are the
   *  build's natural fitness tests). */
  midBlockRaces?: Array<{
    slug: string;
    name: string;
    date: string;
    distanceMi: number;
    goalPaceSec: number | null;
    priority: 'B' | 'C';
  }>;
  isMidBlock: boolean;
  longRunDow: DOW;
  restDow: DOW;
  qualityDows: DOW[];
  /** 2026-06-20 · days the runner can run (from available_days). When set,
   *  layoutWeek places easy days only on these and rests the rest. */
  availableDows?: Set<number> | null;
  /** 2026-06-10 · runner's stated training frequency (profile.
   *  weekly_frequency, captured at onboarding). When set, caps total
   *  running days per week so a 3-day runner never gets a 6-day plan.
   *  NULL preserves the historical "fill every non-rest slot" behavior
   *  (David + pre-frequency profiles unaffected). */
  trainingDaysPerWeek: number | null;
  /** Profile cross-training modes · drives rest-day relabeling. */
  crossModes: string[];
  rxQuality: ResolvedPrescriptions;
  rxRaceSpecific: ResolvedPrescriptions;
  tPaceSec: number | null;
  lthr: number | null;
  /** 2026-06-03 · Rule 16 · maxHr for the easy/long HR cap doctrine.
   *  Optional · null falls back to LTHR-only cap. */
  maxHr: number | null;
  /** 2026-08-17 · coaching-loop reconciliation · measured share of the
   *  season's VDOT gap actually banked (recompute-paces.ts
   *  measuredProgressFraction). Gates the currentT→goalT weekly blend so
   *  paces advance only as fast as demonstrated fitness: blend =
   *  min(calendar fraction, measured + 0.15 grace). null/undefined =
   *  calendar-only (fresh authoring · byte-identical to the historical
   *  Rule 3 blend — the plan is a forecast, and the adaptation layer
   *  (recomputePacesForPlan, pr_bank, fitness_regression) keeps it
   *  honest as evidence arrives). generatePlan populates this on
   *  MID-BLOCK REBUILDS from the prior plan's season anchor.
   *  Cite: Research/01-pace-zones-vdot.md §Recalibrate-Paces (:304-321). */
  measuredProgressFraction?: number | null;
  /** 2026-08-17 · the season's original anchor VDOT, carried FORWARD
   *  across mid-block rebuilds so the measured-progress fraction always
   *  measures against where the season's ambition was priced, not against
   *  the most recent rebuild (which would reset the gate to ~0 every
   *  time). null/undefined → this authoring IS the season start and its
   *  own estimatedCurrentVdot becomes the anchor. */
  seasonAnchorVdot?: number | null;
  /** COLD-3 (2026-08-17) · provenance of an INHERITED `seasonAnchorVdot`. A
   *  rebuild may only carry forward an anchor that was itself measured; an
   *  inherited provisional is a fabrication compounding across rebuilds.
   *  Undefined when no anchor is inherited. */
  seasonAnchorSource?: AnchorSource;
}

export interface ComposedWeek {
  startISO: string;
  phase: string;
  weeklyMi: number;
  days: DayPlan[];
  isRaceWeek: boolean;
  /**
   * THIS WEEK'S NUMBER WITHIN THE BLOCK, when it is not its array position.
   *
   * A recovery block authored mid-recovery emits only the weeks that REMAIN
   * (see RECOVERY-2), so the array holds one week and `persistPlan` wrote
   * `week_idx` 0. The runner then read "Week 1 of 1" on day nine of a
   * fourteen-day recovery, which is the exact shape the comment above
   * `recoveryOff` says must not happen — the offset reached the taper row,
   * the run-day cap and the final-week test, and never reached the label.
   *
   * Absent means the array position is the number, which is true of every
   * block that starts at its own week one.
   */
  blockWeekIdx?: number;
  /** 2026-06-03 · Rule 3 · per-week T-pace from the bestRecentVdot →
   *  goalT blend. persistPlan writes this into each quality row's
   *  pace_target_s_per_mi instead of the plan-wide tPaceSec. */
  tPaceSec?: number | null;
  /** RC2-4 · planned cutback (deload) week. The validator exempts the
   *  FOLLOWING week from the WoW jump check — returning from a planned
   *  deload to normal training is an EXPECTED jump, not a ramp error.
   *  Cite: Research/00b-recovery-protocols.md §"What Cutback Weeks Are Not" — a cutback
   *  is a planned reduction, so the return to load is the design rather than a defect. */
  isCutback?: boolean;
}

export interface ComposePlanResult {
  weeks: ComposedWeek[];
  blocks: BlockPlan;
  totalWeeks: number;
  vols: number[];
  /** Bundle that persistPlan writes verbatim to training_plans.authored_state. */
  authoredState: Record<string, unknown>;
  /**
   * PROGRESSION-1 · the block's overload trajectory, week by week and track by
   * track: which lever moved, what it changed, where a doctrine cap bound and
   * where the session held. Absent on the maintenance and recovery composers,
   * which have no build to progress through.
   *
   * Purely an audit surface — nothing in persistence reads it. It exists so
   * "why is week 7 what it is" has an answer that is not a guess.
   */
  progression?: OverloadTrajectory['log'];
}

/**
 * Pure plan composition · no DB, no clock. Given a ComposePlanInput,
 * returns the full plan shape ready for persistence + the authored_state
 * blob.
 *
 * Tests assert this function against persona doctrine targets ·
 * `expectedPlan.peakWeeklyMileageBand`, `longRunShare`, etc.
 */
export function composePlan(input: ComposePlanInput): ComposePlanResult {
  // 2026-06-02 · totalWeeks MUST be an integer · was fractional for
  // non-Monday races (race day Sun = 6 days span, 7×N-1 days = N
  // weeks - 1/7). Fractional weeks made phaseWkRemaining never hit
  // exactly 0, so phase advancement broke and plans stayed in BASE
  // for the entire runway. Caught by the generator bench.
  const totalWeeks = Math.max(3,
    Math.floor(daysBetween(input.startMondayISO, input.raceDateISO) / 7) + 1
  );
  // 2026-06-02 · tier targets drive volume + long-run sizing.
  // Sourced from Research/22 via lookupTierTarget. Classification
  // uses goalPaceSec; falls back to intermediate tier when no goal.
  // COLD-1 (2026-08-17) · the DEMONSTRATED equivalent race pace, from a MEASURED
  // VDOT only. `bestRecentVdot` is evidence-only (races + qualifying runs); it is
  // null for a runner the app has never seen take a step, and deliberately NOT
  // backfilled here with conservativeVdotFromMileage — a mileage self-report is
  // not a demonstrated capacity, and feeding it in is exactly how a typed goal
  // time used to authorize advanced-tier volume off zero evidence.
  const demonstratedPaceSec = input.bestRecentVdot != null
    ? (() => {
        const t = predictRaceTime(input.bestRecentVdot, input.raceDistanceMi);
        return t != null ? Math.round(t / input.raceDistanceMi) : null;
      })()
    : null;
  const { tier, target: baseTierTarget } = lookupTierTarget(
    input.goalPaceSec,
    input.raceDistanceMi,
    input.level, // VAR-01 · experience clamps the pace-derived tier
    demonstratedPaceSec, // COLD-1 · an unstated level is lifted only by evidence
  );

  // 2026-06-03 · Rule 11 · horizon-aware long-run dials.
  // Find the most demanding A/B race within 24 weeks. If its tier's
  // long-run band exceeds the current race's, override the long dials
  // (cap + share) so the current plan sets up the future block's long
  // progression. Weekly + quality stay at current-race tier. Cite §11.
  const horizonRaise = (() => {
    const horizon = input.horizonRaces ?? [];
    if (horizon.length === 0) return null;
    // For each horizon race, compute its tier target.
    let bestCap = baseTierTarget.peakLongMiBand[1];
    let bestShare = baseTierTarget.longRunShare;
    let bestRace: { slug: string; name: string; date: string; distanceMi: number } | null = null;
    for (const h of horizon) {
      const hDemonstrated = input.bestRecentVdot != null
        ? (() => {
            const t = predictRaceTime(input.bestRecentVdot, h.distanceMi);
            return t != null ? Math.round(t / h.distanceMi) : null;
          })()
        : null;
      const { target: ht } = lookupTierTarget(h.goalPaceSec, h.distanceMi, input.level, hDemonstrated); // VAR-01 + COLD-1
      // Only LARGER bands count · we extend up, never contract down.
      if (ht.peakLongMiBand[1] > bestCap || ht.longRunShare > bestShare) {
        if (ht.peakLongMiBand[1] > bestCap) bestCap = ht.peakLongMiBand[1];
        if (ht.longRunShare > bestShare) bestShare = ht.longRunShare;
        bestRace = { slug: h.slug, name: h.name, date: h.date, distanceMi: h.distanceMi };
      }
    }
    if (!bestRace) return null;
    return {
      fromLongCapMi: baseTierTarget.peakLongMiBand[1],
      toLongCapMi: bestCap,
      fromLongShare: baseTierTarget.longRunShare,
      toLongShare: bestShare,
      race: bestRace,
    };
  })();

  // Tier target used by the layout · when horizon raise is active:
  //   · long cap extends to horizon race's cap
  //   · long share extends to horizon race's share
  //   · weekly peakTarget shifts from lower-band toward mid-band so the
  //     plan has enough weekly volume to support the bigger long runs
  //   · weekly UPPER band stays current-race (don't blow up HM training
  //     intensity for marathon-prep ambition)
  //   · qualityPerWeek stays current-race (we're still sharpening for
  //     the immediate goal, not the horizon goal)
  const tierTarget: TierTarget = horizonRaise ? {
    ...baseTierTarget,
    peakLongMiBand: [baseTierTarget.peakLongMiBand[0], horizonRaise.toLongCapMi],
    longRunShare: horizonRaise.toLongShare,
    peakWeeklyMileageBand: [
      Math.round((baseTierTarget.peakWeeklyMileageBand[0] + baseTierTarget.peakWeeklyMileageBand[1]) / 2),
      baseTierTarget.peakWeeklyMileageBand[1],
    ],
  } : baseTierTarget;

  // DOCTRINE-BASE-1 (2026-08-18) · BASE is skipped for a runner who HAS a
  // base, and recent quality is not evidence that they do.
  //
  // `sizeBlocks` drops the BASE phase entirely when `isMidBlock`, and
  // `detectMidBlock` sets that flag from three signals that all measure the
  // same thing: did this runner do hard sessions in the last 28 days. None of
  // them looks at VOLUME. So a runner one week out of a post-race reverse
  // taper — quality in the archived plan, mileage still less than two thirds of
  // what the block will demand — reads as mid-block, and the engine authors a
  // fourteen-week marathon build that opens in QUALITY. That is the defect
  // this gate closes, and it was found on the owner's own CIM build: 31 mi in
  // week one carrying 7.0 mi at threshold, 22.6% of the week.
  //
  // Doctrine is explicit, in three places that agree:
  //
  //   · `Research/00b-recovery-protocols.md` §"Reverse Periodization for
  //     Marathon Recovery" — "A *reverse taper* (post-race) inverts this:
  //     progressively rebuild volume first, then add intensity." Volume FIRST.
  //     Its own week-by-week ordering does not reintroduce a quality session
  //     until week 5.
  //   · `Research/00a-distance-running-training.md` §Periodization, the linear
  //     table's base row: "Base / aerobic conditioning | 8-16 wk | Easy
  //     mileage, long runs, strides | High, peak | Low". The phase is DEFINED
  //     by volume being at peak. A runner well below peak has base left.
  //   · The same file's §"Periodization choice by athlete and event":
  //     "Returning from layoff | Linear (rebuild base before any sharpening)".
  //
  // And §"Reverse linear" licenses skipping the build for "Athletes with
  // adequate base year-round" — adequate BASE, which is a volume claim.
  //
  // ── The comparison is against the RUNNER'S OWN volume, not the plan's target ──
  //
  // The first cut of this gate measured the runner against
  // `tierTarget.peakWeeklyMileageBand[0]` — the volume the block is building
  // TOWARD — and that is wrong in a way worth recording, because it is the
  // regression the original mid-block rule was written to prevent. A runner
  // steadily holding 45 mi/wk six weeks into a build toward a 70 mi peak is
  // below 70% of that target and is not short of base at all; they are exactly
  // where the plan means them to be. Gating on the target would have dropped
  // them into a fresh BASE phase on every rebuild.
  //
  // "Has the base been rebuilt" is a question about the runner's own history:
  // is the volume they are running now depressed relative to the volume they
  // have demonstrably held? `RampBaseEvidence` already answers exactly that and
  // is already computed on every race-prep authoring —
  //
  //   · `sustainedMi` — the 3rd-highest of the last sixteen 7-day blocks. A
  //     level reached repeatedly, so no single big week can set it.
  //   · `meanMi` — the 28-day mean, i.e. what they are running now.
  //
  // and the threshold between them is doctrine's, not chosen here. The one
  // place the research says how far below their own level a runner in normal
  // training may legitimately sit is `Research/00a` §"Volume progression
  // rules" — "| Down weeks | Every 3-4 wk, reduce by 20-30% |". A genuine
  // mid-block runner caught on their deepest planned down week is at 70% of
  // their sustained level. Below that the shortfall is not a down week, it is a
  // volume deficit, and the weeks that close it are base weeks whatever the
  // plan labels them. Bound by DOCTRINE.base-rebuilt-share, which parses the
  // 20-30% band out of that row. It is also the same 70% `Research/22` §14 and
  // `Research/00b`'s reverse taper both use as the resume level, which is why
  // `RAMP_BASE_RESUME_FRACTION` already carries it.
  //
  // With no evidence — `composePlan` called directly from a harness, a
  // synthetic persona, the simulator — the gate does not fire. Absence of
  // history is not evidence of a deficit, and inventing one would make every
  // DB-free caller author a phase the runner's actual data might not support.
  //
  // ── DOCTRINE-BASE-3 (2026-08-19) · WHICH volume the gate reads ─────────────
  //
  // It read `meanMi` — the raw 28-day mean — and `RampBaseEvidence` carries two
  // other fields that exist precisely because the raw mean is the wrong number
  // to read a mandated interruption through. `rampBaseForBuild`'s own header
  // states the principle it was written for:
  //
  //   "A race the runner actually ran explains its own taper AND its own
  //    recovery window — both are volumes the engine itself prescribed, so
  //    reading them as fitness is the defect."
  //
  // `resolveRampBase` applies that to the RAMP and this gate did not apply it
  // to the PHASE, so the same four weeks were discounted as engine-prescribed
  // by one half of the authoring and counted as detraining by the other. The
  // owner's CIM build is the case: measured against prod on 2026-08-31, his
  // sustained level was 43.5 mi/wk and his 28-day mean 16.8, so the gate asked
  // "16.8 ≥ 30.45?", got no, and inserted three BASE weeks fifteen days after
  // an A-priority half — a window largely made of the taper and the 10-14
  // recovery days `Research/00b` mandates for that distance, both of them
  // volumes this engine itself prescribed.
  //
  // ── What replaces it, and why it is not simply `baseMi` ───────────────────
  //
  // `baseMi` would work — it is `max(mean, sustained × 0.70)` when the dip is
  // explained — but it is the LIFT rounded to a tenth, so comparing it back
  // against the un-rounded 70% threshold decides a genuine edge case on a
  // rounding artefact. `lifted` is the same fact stated exactly: true when, and
  // only when, the interruption is no longer than the one the engine itself
  // mandated (a finished race's taper plus `Research/00b`'s recovery window for
  // its distance and priority; otherwise `Research/22` §14's two-week short
  // layoff). So the gate asks the two questions doctrine actually poses:
  //
  //   · is the runner holding their own volume?   `meanMi ≥ 70% × sustainedMi`
  //   · if not, is the shortfall EXPLAINED?       `lifted`
  //
  // ── Why "explained" is the right test, and not adherence ─────────────────
  //
  // The tempting alternative is to read the plan rows and ask what was
  // PRESCRIBED during the window — "prescribed low and ran low" being a
  // different fact from "prescribed high and ran low". It is rejected, on two
  // grounds. First, no `Research/` file measures fitness by adherence, so the
  // threshold would be ours and the rule would be uncited — which Rule 7 does
  // not allow for a constant that asserts physiology. Second, it would let a
  // prescription outrank doctrine: a plan that asked for 40 miles inside a
  // window `Research/00b` says is recovery would make the runner's compliance
  // with doctrine read as a fitness deficit. The mandated-window test asks
  // instead what DOCTRINE says the window was for, which is knowable without
  // trusting any particular plan that was authored over it.
  //
  // ── What still fires ──────────────────────────────────────────────────────
  //
  // Everything unexplained. `resolveRampBase` counts the consecutive most-recent
  // weeks below the resume level and refuses the lift outright when that run is
  // longer than the allowance, so a runner eight weeks down with no race behind
  // them gets `lifted === false`, the mean governs, and BASE goes in exactly as
  // it does today. The allowance is self-limiting in the other direction too:
  // it is only extended while `weeksSince <= mandated`, so the same runner
  // eight weeks past a marathon whose mandated window was seven is back on the
  // two-week short-layoff allowance. And the VOLUME ramp is untouched either
  // way — `baseMi` still governs what the block opens at, which is the
  // mechanism that keeps this runner off 50 mi/wk in week one. Skipping BASE
  // changes what the weeks CONTAIN, not how big they are.
  const rampEvidence = input.rampBaseEvidence ?? null;
  const baseRebuilt = rampEvidence == null
    || !(rampEvidence.sustainedMi > 0)
    || rampEvidence.meanMi >= BASE_REBUILT_SHARE * rampEvidence.sustainedMi
    || rampEvidence.lifted;
  const blocks = sizeBlocks(totalWeeks, input.raceDistanceMi, input.isMidBlock && baseRebuilt);

  // DOCTRINE-1 · the taper's depth is keyed to the race distance (Research/08 §9.1),
  // so the curve needs the category, not just the tier band.
  // RAMPBASE-1 · ramp from the runner's SUSTAINED base, not from a mandated
  // deload the engine itself prescribed. Falls back to the 28-day mean, which
  // is what every caller that does not supply the field gets.
  const vols = volumeCurve(input.rampBaseMi ?? input.recentWeeklyMi, blocks, input.level, tierTarget, distanceCategoryOf(input.raceDistanceMi), input.tsbAtStart);
  // DIST-1 · plan-wide peak weekly volume · scales the marathon/ultra long to its doctrine band.
  const peakWeeklyMi = Math.max(1, ...vols);
  // #13 · the cadence volumeCurve used to deload, threaded into layoutWeek so
  // its long-run-floor relaxation lands on the same weeks. Same helper, same
  // input → guaranteed agreement.
  const cutbackEveryN = cutbackCadence(input.tsbAtStart);

  // 2026-06-03 · mid-block doctrine RULE 5 (quality density ramp).
  // When the runner's recent quality habit is below their prefs/tier
  // target density, ramp UP by ≤1 session per 4 weeks. NEVER slice
  // below the runner's prefs · the slicing was producing extra easy
  // slots on cold-start personas (ultra · qualityDows=[2,4], tierQ=1
  // → sliced to [2] → 5 easies instead of 4 → 113mi weekly vs 100mi
  // tier cap). The desired-density anchor is the runner's prefs
  // (qualityDows.length), not the tier table. Tier informs ramp
  // CEILING, not floor. Cite: §Rule 5 (refined 2026-06-03).
  const tierQ = tierTarget.qualityPerWeek;
  // BANDS-ULTRA-Q1 is a KNOWN-OPEN defect (ultra ships 2 quality/wk; Research/22 wants 1) — but the naive
  // clamp here re-introduces the easy-slot inflation this density=prefs design fixed (2026-06-03): the
  // displaced quality slot becomes a FLOORED easy → 5 easies → week 117 > band 110. The correct fix routes
  // the displaced ultra slot to a MEDIUM-LONG (back-to-back-long doctrine), a layout change tracked for a
  // focused follow-up, NOT a one-line density clamp. Keep prefs (tier informs ramp CEILING, not floor).
  const desiredDensity = input.qualityDows.length;
  const recentQ = (typeof input.recentQualityPerWeek === 'number' && input.recentQualityPerWeek >= 0)
    ? input.recentQualityPerWeek
    : desiredDensity; // cold-start defaults to prefs
  function densityForWeek(weekIdx: number, phase: string): number {
    if (phase === 'BASE' || phase === 'TAPER') return desiredDensity;
    // Habit ≥ tier OR habit ≥ prefs · no slicing, use prefs.
    if (recentQ >= tierQ || recentQ >= desiredDensity) return desiredDensity;
    // Habit genuinely below target · ramp habit → desired over 4wk.
    const stepsUp = Math.min(4, weekIdx);
    return Math.min(desiredDensity, Math.round(recentQ + (desiredDensity - recentQ) * (stepsUp / 4)));
  }

  // Cold-start pace floor · conservativeVdotFromMileage lifted to spec-builder.ts
  // 2026-06-10 (shared with the maintenance seeder). Moved ABOVE goalT for VAR-05.
  //
  // 2026-08-17 · the duplicate of a citation that named a table which does not
  // exist. See that function's header: its values are a CONVENTION, bound by
  // CONVENTION.cold-start-mileage-anchor, and its output is marked
  // `provisional_mileage` so three readers refuse to inherit it.
  const estimatedCurrentVdot = input.bestRecentVdot
    ?? conservativeVdotFromMileage(input.recentWeeklyMi);
  // 2026-07-07 · AUDIT P1-56 · currentT is the pace every easy/long/recovery/
  // quality band anchors to (below); resolveCurrentTPace's tier-2 fallback
  // (belowTableAnchor → tPaceFromAnchorPace) replaces conservativeVdotFromMileage
  // ONLY for the prescribed-PACE math when the runner's own best race/run implied
  // a sub-30 VDOT — conservativeVdotFromMileage floors at VDOT 30 (T ~10:41/mi),
  // which can be FASTER than a slow runner's actual demonstrated race pace.
  // estimatedCurrentVdot (a VDOT number) is left untouched for the seasonal-gain
  // / goal-realism math a few lines below, which reasons in VDOT deltas, not
  // paces — those stay on the existing (unaffected, already-doctrine-vetted) path.
  const currentTResolved = resolveCurrentTPace(
    input.bestRecentVdot ?? null, input.belowTableAnchor ?? null,
    input.recentWeeklyMi, conservativeVdotFromMileage,
  );
  const currentT = currentTResolved.tPaceSec ?? tPaceFromVdot(estimatedCurrentVdot);

  // COLD-3 · provenance of the anchor this authoring is about to persist.
  // `resolveCurrentTPace` has computed exactly this tier since 2026-07-07 and
  // every caller threw it away. An INHERITED anchor keeps the provenance it was
  // handed (generatePlan refuses to inherit a provisional one, so an inherited
  // anchor present here is always measured); a fresh authoring reports whether
  // anything was actually measured.
  // SELFREPORT-1 (2026-08-21) · `bestRecentVdot != null` used to be read as
  // "something was measured". It is not: PARITY-1 seeds it from the PR the
  // runner typed into onboarding when nothing WAS measured, and the anchor then
  // went out stamped `measured_vdot`, `season_anchor_provisional: false`, with
  // zero runs and zero races on file. The seeder now says which it handed over.
  const seasonAnchorSource: AnchorSource = input.seasonAnchorVdot != null
    ? (input.seasonAnchorSource ?? 'measured_vdot')
    : input.bestRecentVdot != null
      ? (input.bestRecentVdotSelfReported ? 'self_reported_race' : 'measured_vdot')
      : currentTResolved.tier === 'below_table_anchor'
        ? 'below_table_anchor'
        : 'provisional_mileage';
  const anchorIsProvisional = isProvisionalAnchor(seasonAnchorSource);
  // SELFREPORT-1 · the persisted boolean answers the READER's question ("may I
  // believe this as fitness"), which is the wider one. `anchorIsProvisional`
  // above answers the narrower one and drives what this authoring withholds
  // from the runner. See ./anchor-provenance for why they are not the same.
  const anchorIsUnverified = isUnverifiedAnchor(seasonAnchorSource);

  // 2026-06-03 · mid-block doctrine RULE 3 (pace anchor blend) · when bestRecentVdot
  // implies a T-pace slower than goal-T, anchor early-week paces to currentT and blend
  // toward goalT by mid-build (Cite: §Rule 3). 2026-06-23 · VAR-05 · a by-feel runner (no
  // goal) now paces off their ACTUAL fitness (currentT), never the flat 480s/mi (8:00/mi)
  // literal — tPaceFromGoal returns null with no goal, and currentT always resolves
  // (conservativeVdotFromMileage ≥30) so the 480 fallback goes dead. PACE-5 · ultra
  // (≥31mi) also makes tPaceFromGoal return null → ultra T anchors to currentT here, not the
  // bogus goalPace−18. Cite: Research/01 §Daniels-T (T-pace is a function of VDOT).
  // GOAL-2 (2026-06-23) · clamp goal-T to an ACHIEVABLE floor so the per-week blend never prescribes
  // paces faster than current fitness + a safe seasonal VDOT gain (Research/01:314-321 · retest deltas
  // ~+2-3; scale with build length, cap ~+6). An in-table but over-ambitious goal (e.g. +8 VDOT in one
  // block) otherwise drives every quality day to an unreachable pace. The aspirational goal stays on
  // the UI; only the prescribed paces are floored. Derived from CURRENT fitness (never goalVdot, which
  // is null off-table). Byte-safe for an at/near-goal runner (achievableFloorT faster ⇒ max keeps goalT).
  const goalTraw = tPaceFromGoal(input.goalSec, input.raceDistanceMi) ?? currentT ?? input.tPaceSec;
  const maxSeasonalVdotGain = Math.min(6, 2 + totalWeeks * 0.22);
  // achievableFloorT is derived from estimatedCurrentVdot, which floors at
  // VDOT 30 (conservativeVdotFromMileage) when the runner has no measured
  // VDOT — completely blind to a below-table anchor's real (slower) pace.
  // For a below-table runner this "achievable floor" guard can legitimize a
  // VDOT-30-territory goalT that is faster than the runner has ever run.
  const achievableFloorT = tPaceFromVdot(estimatedCurrentVdot + maxSeasonalVdotGain);
  const goalTFloored = (achievableFloorT != null && goalTraw != null) ? Math.max(goalTraw, achievableFloorT) : goalTraw;
  // 2026-07-08 · P0 re-audit follow-up (3rd instance of the P1-56 unclamped-
  // pace bug class) · clamp goalT itself to the anchor pace. tPaceForWeek
  // blends currentT -> goalT; clamping BOTH endpoints to >= the anchor pace
  // means every interpolated value in between is also honest, closing the
  // mid-block ramp leak without touching the blend math itself.
  const goalT = input.belowTableAnchor
    ? clampToSanePace(goalTFloored, input.belowTableAnchor.anchor.paceSPerMi)
    : goalTFloored;

  // Goal-realism guard: flag when the entered goal implies a VDOT >15% above
  // the conservative current estimate. Written to authoredState for the plan
  // UI to surface; does not block generation.
  const goalVdot = input.goalSec != null
    ? vdotFromRace(input.goalSec, input.raceDistanceMi)
    : null;
  // GOAL-3 (2026-06-23) · DIRECTION-AWARE realism flag. goalVdot is null OFF-TABLE (VDOT>85) — i.e. the
  // MOST ambitious goals — so the old `goalVdot != null && >est×1.15` treated those (off-the-top) as
  // NOT flagged (the flag inverted for the most absurd goals). When goalVdot is null, compare the goal
  // TIME to the current-fitness predicted time: faster ⇒ off-the-top ⇒ flag; slower ⇒ off-the-bottom ⇒
  // don't. (GOAL-2 already floors the prescribed paces; this makes the surfaced flag correct too.)
  const currentPredicted = input.goalSec != null ? predictRaceTime(estimatedCurrentVdot, input.raceDistanceMi) : null;
  const realismFlag = goalVdot != null
    ? goalVdot > estimatedCurrentVdot * 1.15
    : (input.goalSec != null && currentPredicted != null && input.goalSec < currentPredicted);
  // COLD-3 (2026-08-17) · the guard was SILENCED BY THE FABRICATION IT WAS
  // MEANT TO CATCH. `estimatedCurrentVdot` falls back to
  // conservativeVdotFromMileage, which reads a 30 mi/wk self-report as VDOT 40 —
  // a level of fitness nobody demonstrated. A 3:30 marathon goal (VDOT ~44.6) is
  // then only +11.5% over that invented baseline, under the 15% trigger, and the
  // plan records `{ flag: false }`: an affirmative statement that the goal is
  // realistic, made about a runner the app has never seen take a step.
  //
  // With no measured fitness the honest answer is neither true nor false. It is
  // "not assessable yet" — which is a different thing to say to the runner, and
  // the only honest thing the engine knows about an over-ambitious cold-start
  // goal. `basis` names what the verdict rests on so a surface never has to
  // guess. (Design/adaptive-progression-engine.md §A · evidence-only.)
  const goalRealism: {
    flag: boolean;
    assessable: boolean;
    basis: AnchorSource;
    goalVdot?: number;
    estimatedCurrentVdot?: number;
  } = anchorIsProvisional
    ? {
        flag: false,
        assessable: false,
        basis: seasonAnchorSource,
        ...(goalVdot != null ? { goalVdot } : {}),
      }
    : realismFlag
      ? { flag: true, assessable: true, basis: seasonAnchorSource, ...(goalVdot != null ? { goalVdot } : {}), estimatedCurrentVdot }
      : { flag: false, assessable: true, basis: seasonAnchorSource, estimatedCurrentVdot };

  // 2026-08-17 · coaching-loop reconciliation · the blend math moved to
  // lib/plan/recompute-paces.ts (blendedTPaceForWeek) so authoring and the
  // adaptation-time recompute share ONE implementation. Semantics here are
  // byte-identical to the historical inline formula (Rule 3 + BRK-1 +
  // VAR-07) whenever input.measuredProgressFraction is null/undefined;
  // when a measured-progress fraction IS supplied (mid-block rebuilds),
  // the calendar blend is gated on it — paces advance only as fast as
  // demonstrated fitness. Cite: Research/01 §Recalibrate-Paces (:304-321).
  const composeBuildWeeks = blocks.phases.filter((p) => p.label !== 'TAPER')
    .reduce((s, p) => s + p.weeks, 0);
  function tPaceForWeek(weekIdx: number, phase: string): number | null {
    return blendedTPaceForWeek({
      currentT,
      goalT,
      weekIdx,
      phase,
      buildWeeks: composeBuildWeeks,
      measuredProgressFraction: input.measuredProgressFraction ?? null,
    });
  }

  /**
   * PROGRESSION-1 (2026-08-17) · the block's default overload trajectory.
   *
   * `Design/adaptive-progression-engine.md` §3: "the plan carries a default
   * overload trajectory". Before this the plan carried none — every week of a
   * phase rendered the same fixed prescription string, and the only thing that
   * moved was a pace ramp indexed on the week number, which Rule 1 forbids and
   * `fbc61eb9` deleted. Deleting it left the block frozen; this is what belongs
   * in its place.
   *
   * The trajectory is walked with the adaptation model's own no-evidence
   * verdict, which is `normal` — §3's "progress as planned". It is a DEFAULT:
   * once the runner has actually run something, the adaptation model permits,
   * holds or modifies it, and that half is not authored here.
   */
  const trajectory = new OverloadTrajectory();
  // VOCAB-CATALOGUE-1 · plan-scoped, so the selector's rotation and its
  // per-cycle caps ("1× per training cycle") count the whole block.
  const catalogueHistory = newCatalogueHistory();
  // The rep pace persistPlan will use, mirrored here so the trajectory's
  // at-pace caps are computed against the pace actually prescribed. 5K/10K/HM
  // goals carry true Daniels I; marathon and ultra keep the cruise-interval
  // T−18 default that `buildWorkoutSpec` applies (R3 · PACE-I-1).
  const iPaceEligible = ['5k', '10k', 'hm'].includes(distanceCategoryOf(input.raceDistanceMi));
  // Memoised: `vdotFromTpace` is a fifty-step binary search over the Daniels
  // table, and without evidence every week of a block carries the same T, so
  // this would otherwise run the same search once per week for one answer.
  const iPaceCache = new Map<number, number | null>();
  const iPaceForWeek = (t: number | null): number | null => {
    if (t == null) return null;
    if (!iPaceEligible) return t - 18;
    const hit = iPaceCache.get(t);
    if (hit !== undefined) return hit;
    // Same precedence as `resolveCurrentTPace`: a MEASURED VDOT outranks a
    // below-table anchor. persistPlan's own I-pace derivation reaches for the
    // anchor first, which for a runner who has both is the anchor overriding a
    // measurement — the inversion P1-56's byte-safety test exists to catch.
    const v = (input.bestRecentVdot == null && input.belowTableAnchor)
      ? iPaceFromAnchorPace(input.belowTableAnchor.anchor)
      : (iPaceFromVdot(vdotFromTpace(t)) ?? t - 18);
    iPaceCache.set(t, v);
    return v;
  };

  const weeks: ComposedWeek[] = [];
  let phaseCursor = 0;
  let phaseWkRemaining = blocks.phases[0].weeks;
  let phaseLabel = blocks.phases[0].label;
  for (let wi = 0; wi < totalWeeks; wi++) {
    while (phaseWkRemaining === 0) {
      phaseCursor++;
      phaseWkRemaining = blocks.phases[phaseCursor].weeks;
      phaseLabel = blocks.phases[phaseCursor].label;
    }
    const weekStart = addDays(input.startMondayISO, wi * 7);
    const isRaceWeek = wi === totalWeeks - 1;
    const raceDow: DOW | null = isRaceWeek
      ? ((new Date(input.raceDateISO + 'T12:00:00Z').getUTCDay()) as DOW)
      : null;
    const rx = phaseLabel === 'RACE-SPECIFIC' ? input.rxRaceSpecific : input.rxQuality;
    // 2026-06-03 · Rule 5 · slice qualityDows to per-week density.
    // The runner's preferences list ≤2 quality days; if density says 1,
    // we pick the first entry; if 2, all; if 0 (BASE), already handled
    // inside layoutWeek's `phase === 'BASE'` branch via empty quality.
    const weekDensity = densityForWeek(wi, phaseLabel);
    const weekQualityDows = input.qualityDows.slice(0, weekDensity);
    // 2026-06-03 · Rule 3 · per-week T-pace.
    const weekT = tPaceForWeek(wi, phaseLabel);
    const days = layoutWeek({
      phase: phaseLabel,
      weekIdx: wi,
      // 2026-06-07 · Audit D follow-up · 0 = last week of this phase.
      // phaseWkRemaining is decremented after this call, so it currently
      // holds weeks-left-including-this-one → minus 1 = weeks-to-phase-end.
      weeksToPhaseEnd: phaseWkRemaining - 1,
      totalWeeks,
      weeklyMi: vols[wi],
      peakWeeklyMi,
      longRunDow: input.longRunDow,
      qualityDows: weekQualityDows,
      restDow: input.restDow,
      isRaceWeek,
      raceDow,
      raceDistanceMi: input.raceDistanceMi,
      rx,
      easyMileFloor: input.easyDayMedianMi,
      recentLongMi: input.recentLongMi,
      recentQualityDistanceMi: input.recentQualityDistanceMi,
      tierTarget,
      trainingDaysPerWeek: input.trainingDaysPerWeek,
      cutbackEveryN,  // #13 · same cadence as volumeCurve's deload mask
      // 2026-06-20 · beginner = base-building structure (light fartlek, no
      // structured I/R reps). Gated to level==='beginner', so intermediate/
      // advanced (incl. David) are unchanged.
      // LOWVOL-2 (2026-08-19) · the runner's own volume is passed so an UNSTATED
      // experience level cannot route a 5-10 mi/wk runner into the periodized
      // machine. A STATED level still wins outright.
      baseBuilding: isBaseBuildingPlan(
        distanceCategoryOf(input.raceDistanceMi), input.level, input.recentWeeklyMi,
      ),
      availableDows: input.availableDows ?? null,
      // DOCTRINE-3 · the long run's absolute-time cap is evaluated against the
      // runner's OWN easy pace, at the slow end of the band spec-builder emits
      // (easyAnchorT + 120). currentT is the current-fitness anchor, which is
      // what easy/long/recovery work paces off (PACE-E-1) — not the blended
      // goal pace, which would flatter a slow runner into a longer long.
      easyPaceSecPerMi: currentT != null ? currentT + EASY_BAND_SLOW_OFFSET_SEC : null,
      // PROGRESSION-1 · the overload trajectory, stepped once per week in
      // ascending order. The paces are the ones persistPlan will pace the
      // session at, so the shape's at-pace caps are computed against the pace
      // the runner is actually asked to hold.
      trajectory,
      weekTPaceSec: weekT,
      weekIPaceSec: iPaceForWeek(weekT),
      // ZONE-R-1 · THE marathon-pace expression, called rather than re-derived,
      // so the pace the selector prices an MP session at is the pace
      // `buildWorkoutSpec` will build it at.
      // The two inputs are the ones `persistPlan` hands `buildWorkoutSpec`, in
      // the same shapes: `currentT` is the same `resolveCurrentTPace` cascade,
      // and the goal pace carries the same below-table fallback. Diverging on
      // either would size an MP session at one pace and run it at another.
      weekMpPaceSec: weekT != null && weekT > 0
        ? marathonPaceSPerMi({
            tPaceSec: weekT,
            easyAnchorTSec: currentT,
            goalPaceSPerMi: input.goalPaceSec
              ?? (input.belowTableAnchor
                ? Math.round(input.belowTableAnchor.anchor.paceSPerMi)
                : null),
          })
        : null,
      // VOCAB-CATALOGUE-1 · the plan's running record of which of
      // Research/04's named workouts it has already authored. Stepped in
      // ascending week order, the same contract as `trajectory`, so the
      // selector's least-recently-used rotation and its per-cycle caps see the
      // whole block rather than one week.
      catalogueHistory,
      level: input.level,
    });
    // 2026-06-23 · SP-4 · race-week chronology guard. layoutWeek positions
    // shakeout/tune-up/easy by a circular days-before-race offset that WRAPS, so for a
    // race that is NOT the last day of its week the tune-up/easy aliased onto days
    // AFTER the race (a tune-up 2 days post-race · was live on every mid-week race).
    // Force every day whose calendar date is after the race to rest, keyed on the real
    // week window (weekStart + dow offset) so it is correct whether or not the runway
    // is boundary-aligned. Byte-identical when the race is the window's last day
    // (David's Sunday race · nothing falls after it).
    if (isRaceWeek) {
      const weekStartDow = new Date(weekStart + 'T12:00:00Z').getUTCDay();
      for (const d of days) {
        const dayDate = addDays(weekStart, (d.dow - weekStartDow + 7) % 7);
        if (d.type !== 'race' && daysBetween(input.raceDateISO, dayDate) > 0) {
          d.type = 'rest'; d.distanceMi = 0; d.isQuality = false; d.isLong = false;
          d.subLabel = 'REST'; d.notes = 'Off. Post-race recovery.';
        }
      }
    }
    // COLD-4 · THE CALIBRATION INTRO. When this plan's anchor is provisional —
    // `conservativeVdotFromMileage` reading a mileage bucket, marked
    // `provisional_mileage` a few dozen lines above — the opening weeks'
    // quality sessions go out by EFFORT rather than at a pace we invented.
    //
    // Applied here rather than inside `layoutWeek` on purpose: the composer is
    // the only layer that knows the anchor's provenance, and the shape of the
    // week (types, distances, rep counts, the overload trajectory's decision)
    // is deliberately untouched. Only the pace target is withheld.
    //
    // Race week is excluded even if it falls inside the window — a two-week
    // plan is legal — because race day and the tune-up are priced off the
    // runner's stated goal, not off the fitness anchor.
    if (anchorIsProvisional && wi < CALIBRATION_INTRO_WEEKS && !isRaceWeek) {
      for (const d of days) {
        if (d.isQuality && EFFORT_CUED_TYPES.has(d.type)) d.effortCued = true;
      }
    }
    // 2026-08-17 · cross-training rest-day relabel removed (owner ruling).
    weeks.push({ startISO: weekStart, phase: phaseLabel, weeklyMi: vols[wi], days, isRaceWeek, tPaceSec: weekT, isCutback: wi > 0 && (wi + 1) % cutbackEveryN === 0 });
    phaseWkRemaining--;
  }

  // 2026-06-10 · "get them running on day one." A mid-week onboarder
  // (today-anchored · start day is not a Monday) whose preferred run days
  // fall later in the week would otherwise stare at several rest days
  // before their first run (David: "if someone signs up lets get them
  // running and then the schedule can even out · they're going to be
  // ready and excited to run"). When week 0's start day is a rest day,
  // relocate an easy run onto it — stolen from the latest easy day so the
  // weekly count (and the long/quality days) are untouched. Week 1+ keeps
  // the normal day-of-week rhythm. Monday-anchored regens skip this.
  if (weeks.length > 0 && new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay() !== 1) {
    // FRONTLOAD-AVAIL-1 · the destination must be a day the runner can run.
    frontLoadFirstRun(weeks[0].days, new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay(), input.availableDows ?? null);
  }

  // 2026-08-17 · MIDRACE-1 · embed the runner's own B/C races that fall
  // inside the plan window as tune-up race days (see embedMidBlockRaces
  // doctrine block). Gated: no midBlockRaces → byte-identical output.
  const embeddedRaces = (input.midBlockRaces && input.midBlockRaces.length > 0)
    ? embedMidBlockRaces(weeks, vols, {
        startMondayISO: input.startMondayISO,
        raceDateISO: input.raceDateISO,
        midBlockRaces: input.midBlockRaces,
        trainingDaysPerWeek: input.trainingDaysPerWeek,
      })
    : [];

  // RACE-RUNUP-1 · last, so it sees the calendar every other pass has already
  // written — including an embedded B race, whose own mini-taper it must not
  // undo (the loops stop at a `race` day). Before `finalizeComposedPlan`, so
  // the WoW smoothers and the VOL-1 reconcile see the eased week.
  const runUpChanged = guardGoalRaceRunUp(weeks, {
    startMondayISO: input.startMondayISO,
    raceDateISO: input.raceDateISO,
  });

  return {
    weeks,
    blocks,
    totalWeeks,
    vols,
    progression: trajectory.log,
    authoredState: {
      total_weeks: totalWeeks,
      race_distance_mi: input.raceDistanceMi,
      goal_pace_s_per_mi: input.goalPaceSec,
      recent_avg_mpw: input.recentWeeklyMi,
      weeklyAvg4w: input.recentWeeklyMi,
      // RAMPBASE-1 · what the volume curve actually ramped from, and why. Null
      // (absent) whenever it was the 28-day mean.
      ...(input.rampBaseEvidence ? { ramp_base: input.rampBaseEvidence } : {}),
      is_mid_block: input.isMidBlock,
      t_pace_s_per_mi: input.tPaceSec,
      lthr_bpm: input.lthr,
      // 2026-06-02 · tier classification for downstream consumers
      // (gap-report, projection snapshots, brief).
      goal_tier: tier,
      tier_peak_weekly_band: tierTarget.peakWeeklyMileageBand,
      tier_peak_long_band: tierTarget.peakLongMiBand,
      // 2026-06-03 · Rule 11 · horizon raise. Null when no future race
      // raises the long-run cap above the current tier's. Drives the
      // chip on the plan UI ("LONG-RUN CAP · 22mi · setting up CIM").
      horizon_raise: horizonRaise,
      // 2026-08-17 · MIDRACE-1 · which B/C races were embedded as tune-up
      // race days, by plan week. Empty array when none. Drives the plan
      // UI chip + the brief's tune-up framing.
      embedded_races: embeddedRaces,
      // RACE-RUNUP-1 · the dates the goal-race run-up guard rewrote, so a
      // block that had a long run inside race week says so on its own record
      // rather than only in a diff. Absent when it changed nothing, which is
      // every already-well-formed block.
      ...(runUpChanged.length > 0 ? { race_runup_eased: runUpChanged } : {}),
      // 2026-06-03 · Rule 10 · transparency envelope so the runner can
      // audit which signals drove their plan. Surfaces in /plan brief
      // as "plan built from your last 28 days." Cite: §Rule 10.
      derived_from: {
        recentWeeklyMi: input.recentWeeklyMi,
        recentLongMi: input.recentLongMi,
        recentQualityPerWeek: input.recentQualityPerWeek ?? null,
        recentQualityDistanceMi: input.recentQualityDistanceMi ?? null,
        bestRecentVdot: input.bestRecentVdot ?? null,
        easyDayMedianMi: input.easyDayMedianMi,
        tsbAtStart: input.tsbAtStart ?? null,
      },
      goal_realism: goalRealism,
      // 2026-08-17 · coaching-loop reconciliation · the blend anchors, so
      // recomputePacesForPlan (adaptation-time pace rewrite) can gate the
      // weekly blend on measured evidence against the SAME season anchor
      // this authoring ran on. season_anchor_vdot is the fitness the
      // season's ambition was priced against; measured_progress_fraction
      // records the gate this authoring itself used (null = calendar-
      // trusted forecast). Cite: Research/01 §Recalibrate-Paces.
      // Only the ANCHORS are recorded — never the derived T-paces, which
      // recomputePacesForPlan re-derives from vdotNow (and whose exact
      // values legitimately vary with resolution-tier internals a
      // recompute doesn't need · see _audit_slow_runner P1-56 byte-safety).
      pace_blend: {
        season_anchor_vdot: input.seasonAnchorVdot ?? estimatedCurrentVdot,
        // COLD-3 (2026-08-17) · the anchor's PROVENANCE, written alongside the
        // number it qualifies. Without it a mileage-derived estimate is
        // indistinguishable from a race result once persisted, and three
        // readers were treating it as one. `season_anchor_provisional` is the
        // single boolean a reader checks before believing the VDOT.
        season_anchor_source: seasonAnchorSource,
        season_anchor_provisional: anchorIsUnverified,
        goal_vdot: goalVdot,
        build_weeks: composeBuildWeeks,
        measured_progress_fraction: input.measuredProgressFraction ?? null,
      },
      citations: blocks.phases.map((p) => p.citation),
    },
  };
}

// ── Maintenance + Recovery composers ────────────────────────────────────
//
// 2026-06-03 · Rule 12 + 13 · pickPlanMode returns 'race-prep' for the
// existing composePlan path. These two functions handle the other modes.
//
// MAINTENANCE · runner has no race within build window. Hold aerobic
// fitness + leg turnover; volume + long drop to ~70-80% of peak; 1
// quality per week (threshold OR fartlek per tier); NO vo2/intervals.
// 4-week looping plan that regenerates monthly via the graduate cron.
//
// RECOVERY · 1-2 weeks immediately after a race. Very low volume,
// all easy + rest. Auto-transitions to maintenance OR race-prep.
//
// DOCTRINE-BOOK-8 (2026-08-17) · was two book citations the gate could not open
// (Pfitzinger FRR §"Recovery & Off-Season Training", Daniels 3rd ed §"Off-Season
// Training"). The shape these composers implement is published; see the header on
// MAINTENANCE_BY_TIER in goal-tiers.ts for the volume grounding and for the honest
// note on where the engine's frequency diverges from Research/22 §7.
//
// Cite: Research/22-plan-templates.md §"Maintenance Plan" (volume + 1 quality)
// Cite: Research/22-plan-templates.md §"Base Building / Off-Season Plan" (all-E,
//       strides, no peak — which is why VO2 work is cut entirely here)
// Cite: Research/00b-recovery-protocols.md §"Recovery by Distance" (recovery mode)

export interface ComposeNonRaceInput {
  startMondayISO: string;
  level: LevelKey;
  /** Recent 4-week avg weekly mileage · the maintenance anchor. */
  recentWeeklyMi: number;
  /** Runner's recent peak long · 28d max. Drops to longPctOfPeak in
   *  maintenance / recovery. */
  recentLongMi: number;
  /** Runner's recent peak weekly · last race-prep peak. When unknown,
   *  recentWeeklyMi serves as the proxy. */
  recentPeakWeeklyMi: number;
  /** MAINT-NOBLOCK-1 (2026-08-19) · the MEASURED peak week, straight out of
   *  `recentPeakWeeklyMileage`, before it is maxed with the stated volume.
   *  `recentPeakWeeklyMi` above deliberately erases the difference (DOCTRINE-4
   *  needs a usable number for the reverse taper), and that erasure is what
   *  made a day-one runner's CURRENT volume look like a peak they had come
   *  down from. 0 or null → the runner has no completed block behind them.
   *  Absent → inferred from `recentPeakWeeklyMi > recentWeeklyMi`, which is
   *  what a real completed block always looks like against its own 28-day
   *  mean; that keeps every hand-built harness reading the same as before. */
  measuredPeakWeeklyMi?: number | null;
  easyDayMedianMi: number;
  longRunDow: DOW;
  restDow: DOW;
  qualityDows: DOW[];
  /** 2026-06-21 · days the runner can run (from available_days). When set,
   *  the maintenance/recovery easy-fill places easy runs ONLY on these days
   *  and rests every other empty slot — parity with composePlan's layoutWeek.
   *  long/quality/rest already land on available days upstream (loadGenerator-
   *  Inputs derives longRunDow/restDow/qualityDows from the same set), so only
   *  the easy-fill needs this filter. NULL → fill every empty slot (David /
   *  pre-available-days profiles unchanged). */
  availableDows?: Set<number> | null;
  /** 2026-06-10 · runner's stated training frequency. When set, overrides
   *  the tier's daysPerWeek so a far-out-race runner's maintenance block
   *  honors the days/week they actually picked. NULL → tier default. */
  trainingDaysPerWeek: number | null;
  crossModes: string[];
  /** For maintenance: tier of the next race (so the maintenance shape
   *  matches the runner's level). For recovery: tier of the race that
   *  just finished. */
  tier: GoalTier;
  /** Next race (for context · maintenance plans show "X weeks until
   *  CIM build starts"). Null when no future race scheduled. */
  nextRace: { slug: string; name: string; date: string; distanceMi: number; goalPaceSec: number | null } | null;
  /** Last race finished (recovery mode only). `priority` is the race's A/B/C
   *  grading — DOCTRINE-5, it scales the recovery DURATION per Research/00b
   *  §"Recovery by Effort". Absent → treated as an A race. */
  lastRaceFinished: { slug: string; name: string; date: string; distanceMi: number; priority?: string | null } | null;
  rxQuality: ResolvedPrescriptions;
  tPaceSec: number | null;
  lthr: number | null;
  /** EVIDENCE-2 (2026-08-17) · the runner's measured VDOT at authoring. Both
   *  non-race composers record it as `pace_blend.season_anchor_vdot` so the
   *  build that FOLLOWS a recovery/maintenance block has an anchor to measure
   *  progress against. Without it the measured-progress gate read null and the
   *  next race-prep authoring had no evidence baseline at all — the second
   *  violation named in Design/engine-doctrine-evidence-and-levers.md. */
  bestRecentVdot?: number | null;
  /** SELFREPORT-1 (2026-08-21) · as on `ComposePlanInput`. The non-race
   *  composers write `bestRecentVdot` straight into `pace_blend` as the season
   *  anchor the NEXT build measures progress against, so a typed PR reaching
   *  that column unmarked is the same laundering on a quieter path. */
  bestRecentVdotSelfReported?: boolean;
}

/* ── COLD-START-1 (2026-08-19) · the week a runner with NO history gets ──────
 *
 * `composeMaintenancePlan` sizes everything off `peakAnchor = max(recentPeak,
 * recentWeekly)`. For a day-one runner both are zero, and the arithmetic then
 * produced exactly ONE run: `targetWeekly` 0, the long-run coherence floor
 * asserted 4 miles anyway (its `recentLongMi > 0` guard let zero fall through
 * to the `: 4` arm), and `easyMiBudget = max(0, 0 - 4)` left nothing for any
 * other day. A single four-mile run a week, and for somebody with no recorded
 * running it is also a first session four miles long.
 *
 * Doctrine has an answer for this runner and it is not the maintenance plan.
 * `Research/22` §"8. Couch-to-5K Progression" is written for exactly "sedentary
 * individuals who can walk 30 minutes": three days a week with a rest day
 * between, opening at eight minutes of running per session and topping out at a
 * thirty-minute continuous run. Those three numbers are transcribed below and
 * bound by `COLDSTART.couch-to-5k-opening` in the doctrine registry.
 *
 * Two things are ours rather than doctrine's, and are labelled as such:
 *
 *   · The ramp BETWEEN weeks. §8's ladder is written as run/walk intervals
 *     whose weeks 5 and 6 hold three different sessions each, which does not
 *     transcribe to one number per week without picking one. So the climb uses
 *     the engine's existing novice ramp ceiling — `GENERAL_RAMP_CEILING.
 *     beginner`, already bound to `Research/00a`'s "+20-25% over 8 weeks" —
 *     and the §8 peak caps it. That reaches thirty minutes at about the week
 *     §8 does, without inventing a reading of the a/b/c rows.
 *   · The minutes→miles conversion, which the plan schema forces: rows carry a
 *     distance. It is done at the SLOW end of the engine's own easy band so the
 *     distance cannot imply a pace the runner is not permitted to run.
 */
/** `Research/22` §8 · "Days/week | 3 (with rest day between)". */
const COLD_START_DAYS_PER_WEEK = 3;
/** `Research/22` §8 week 1 · "8× (60 sec run / 90 sec walk)" — eight minutes of running. */
const COLD_START_WEEK1_RUN_MIN = 8;
/** `Research/22` §8 · "Peak workout | 30 min continuous run". */
const COLD_START_PEAK_RUN_MIN = 30;

/* ── MAINT-NOBLOCK-1 (2026-08-19) · 70% of a block that never happened ──────
 *
 * A runner reporting 20-25 mi/wk with a half 116 days out was authored a
 * 10 mi/wk block with four rest days on their first day in the app. The
 * arithmetic is `MAINTENANCE_BY_TIER.intermediate.weeklyPctOfPeak = 0.70`
 * applied to `peakAnchor`, and `Research/22` §7's own row is explicit about
 * what that percentage is a percentage OF: "Peak weekly volume | ~65% of
 * **last cycle's peak**". A day-one onboarder has no last cycle. The number
 * being cut by 30% was their current, sustainable volume.
 *
 * Doctrine already decided which section governs this mode. DOCTRINE-MAINTFREQ-1
 * (see the header on MAINTENANCE_BY_TIER in goal-tiers.ts) ruled that §6 Base
 * Building / Off-Season governs, not §7 Maintenance, because this mode fires
 * when the runner HAS a goal race and it is simply not near yet — that runner
 * is base-building. That ruling re-pointed FREQUENCY to §6 and left VOLUME on
 * §7. This is the other half of the same ruling.
 *
 * §6's row: "Peak weekly volume | 80-100% of last cycle's peak (or whatever
 * level the runner can sustain durably)". The parenthetical is written for
 * exactly this runner. With no last cycle to take a percentage of, the anchor
 * IS the durable level, and the whole of it stands — no reduction, and no
 * invented build either.
 *
 * The discriminator is evidence, not a guess: `recentPeakWeeklyMileage` is a
 * query over logged runs, and it returns 0 for a runner who has logged none.
 * A runner who genuinely came down from a block keeps §7's reduction.
 */
/** `Research/22` §6 · with no last cycle's peak, the anchor is "whatever level
 *  the runner can sustain durably" and the block holds it. The 80-100% band in
 *  the same row applies to a LAST CYCLE'S PEAK, which this runner has none of,
 *  so it is not a second reduction to apply on top. */
const BASE_BUILD_SUSTAINABLE_PCT = 1.00;

/**
 * Compose a 4-week maintenance plan. Single phase 'MAINTENANCE'. The
 * graduate cron regenerates this every 4 weeks until the next race
 * enters its build window, at which point it auto-transitions to
 * race-prep. Volume + long held at maintenance percentages of the
 * runner's recent peak; quality drops to 1/week; intervals removed.
 */
export function composeMaintenancePlan(input: ComposeNonRaceInput): ComposePlanResult {
  const tierShape = MAINTENANCE_BY_TIER[input.tier];
  // 2026-06-10 · honor the runner's stated frequency over the tier
  // default so a far-out-race runner who picked 3 days/wk doesn't get
  // the tier's 5-6. NULL → tier default (David / pre-frequency profiles).
  const shape = input.trainingDaysPerWeek != null
    ? { ...tierShape, daysPerWeek: input.trainingDaysPerWeek }
    : tierShape;
  const peakAnchor = Math.max(input.recentPeakWeeklyMi, input.recentWeeklyMi);
  // MAINT-NOBLOCK-1 · is there a completed block behind this runner at all?
  // See the block comment above `BASE_BUILD_SUSTAINABLE_PCT`.
  const hasCompletedBlockPeak = input.measuredPeakWeeklyMi != null
    ? input.measuredPeakWeeklyMi > 0
    : input.recentPeakWeeklyMi > input.recentWeeklyMi;
  const weeklyPctApplied = hasCompletedBlockPeak
    ? shape.weeklyPctOfPeak            // Research/22 §7 · ~65% of last cycle's peak
    : BASE_BUILD_SUSTAINABLE_PCT;      // Research/22 §6 · the durable level, held
  const targetWeekly = Math.round(peakAnchor * weeklyPctApplied);
  // SP-6 · maintenance long is PROPORTIONAL to recent fitness, not an absolute 8mi floor.
  // The old `max(8, ...)` gave a 15mpw / 5mi-recent runner an 8mi long = 160% of recent +
  // 35% of the week (over both the 110% injury cap and the ~30% proportion cap). Cap at
  // ≤110% of recent long (Research/00a:752) AND ≤30% of the week (Research/00a:184), with a
  // 4mi coherence floor (a 2mi "long" is incoherent · D2 default). The tier's longPctOfPeak
  // intent still shapes the week via targetWeekly.
  // NS-2 (2026-06-23) · the 4mi coherence floor forced a ~2× jump on a true-beginner maintenance runner
  // (recent long 2-3mi). Cap the floor at their recent long so a maintenance long never exceeds ~110% of
  // what they've actually run; 4mi still applies once they're at/above 4 (or have no recent-long signal).
  const longFloor = (input.recentLongMi > 0 && input.recentLongMi < 4) ? Math.max(2, Math.round(input.recentLongMi)) : 4;
  const targetLong = Math.max(
    longFloor,
    Math.min(Math.round(input.recentLongMi * 1.10), Math.round(targetWeekly * 0.30)),
  );

  // MAINT-HORIZON (2026-06-23) · when a race is scheduled, maintenance runs exactly until the
  // build-window opens, not a fixed 4 weeks. A 20-week-out 5K runner needs 10 weeks of
  // maintenance before the 10-week race-prep window starts — not 4 weeks of maintenance that
  // restarts three more times with no visible horizon. Rolling cutback fires every 4th week.
  // When no race is scheduled (just-run mode), fall back to the 4-week rolling default.
  let TOTAL_WEEKS = 4;
  if (input.nextRace) {
    const weeksToRace = daysBetween(input.startMondayISO, input.nextRace.date) / 7;
    // The next race is a CALENDAR row the runner typed; its distance may not
    // resolve. A maintenance block whose build window we cannot size falls back
    // to the rolling four-week default rather than sizing off a guessed event.
    const buildCat = distanceCategoryOrNull(input.nextRace.distanceMi);
    const buildWindow = buildCat != null ? BUILD_WINDOW_WEEKS[buildCat] : Infinity;
    if (weeksToRace > buildWindow) {
      // MAINT-SKIP-1 (2026-06-24) · floor not round — rounding up would let maintenance
      // eat into the build window. pickPlanMode already routes floor=0 to race-prep,
      // so this is guaranteed ≥ 1 when composeMaintenancePlan is called.
      //
      // ── A DIVERGENCE FROM DOCTRINE, ARGUED RATHER THAN CLOSED (2026-08-24) ──
      //
      // This has no ceiling, and doctrine gives one. `Research/22` §7
      // Maintenance Plan publishes `Duration | Open-ended (4-15 wk
      // realistically)`, and its whole basis is a stated time limit: "~2/3 of
      // training volume maintains VO2max for ~15 weeks if intensity is
      // preserved". Past that the maintenance dose stops maintaining.
      // `MAINTENANCE_BY_TIER`'s own DOCTRINE-MAINTFREQ-1 ruling says §6 Base
      // Building governs this mode rather than §7 — "that runner is
      // base-building, not maintaining" — and §6 publishes `Duration | 8-16
      // weeks`. Neither section sanctions what this line can produce: a runner
      // who enters a half fifty-three weeks out is authored a FORTY-ONE-WEEK
      // hold block, and it is flat (one `targetWeekly` for the whole span, a
      // 20% step-down every fourth week, no progression at all), where §6 asks
      // for 80-100% of last cycle's peak reached through reverse
      // periodization.
      //
      // NOT CAPPED HERE, and the reason is structural rather than a judgement
      // about the doctrine. Nothing re-authors a race-anchored hold block that
      // runs out. `graduateDue` fires on the RACE date, not the block's end.
      // The `plan_elapsed` branch of `/api/cron/plan-drift` is gated on
      // `!activePlanRow.race_id`, and this block carries one. `openBlockDue`
      // requires `!hasFutureTarget`, and this runner has a target. So a
      // fifteen-week cap would leave somebody a year out from a marathon with
      // no plan at all from week sixteen until the build window opened — which
      // is a worse failure than a hold that holds too long.
      //
      // Closing it properly is two changes and one decision, and the decision
      // is the owner's because it moves prescribed volume for every hold-block
      // runner: (1) size the block to the doctrine ceiling, (2) teach the
      // elapsed-plan branch to re-author a race-anchored hold block, and
      // (3) rule on whether a long hold progresses (§6) or holds (§7).
      //
      // Cite: Research/22-plan-templates.md §"Maintenance Plan" — Duration
      //       open-ended, 4-15 wk realistically; ~15 weeks of VO2max hold
      // Cite: Research/22-plan-templates.md §"Base Building / Off-Season Plan"
      //       — Duration 8-16 weeks, 80-100% of last cycle's peak
      TOTAL_WEEKS = Math.max(1, Math.floor(weeksToRace - buildWindow));
    }
  }
  const weeks: ComposedWeek[] = [];
  const blocks: BlockPlan = {
    totalWeeks: TOTAL_WEEKS,
    phases: [{
      label: 'MAINTENANCE',
      weeks: TOTAL_WEEKS,
      rationale: 'Holding aerobic fitness · no race in build window. 1 quality, 1 long, easies otherwise.',
      citation: 'Research/00a-distance-running-training.md §off-season + Pfitzinger Faster Road Racing §Recovery & Off-Season',
    }],
  };

  // COLD-START-1 · no volume signal of ANY kind. Not "a small week" — nothing
  // to size a week from. See the block comment above composeMaintenancePlan.
  const noVolumeSignal = !(peakAnchor > 0) && !(input.recentLongMi > 0);
  /** Slow end of the engine's own easy band — the pace the runner is actually
   *  permitted to run at, so the minutes→miles conversion cannot imply a
   *  faster one. Falls back to the bottom of the Daniels table when the runner
   *  has no goal to derive a threshold pace from, which is the usual day-one
   *  case. */
  const coldStartEasySecPerMi = (() => {
    const t = (input.tPaceSec != null && input.tPaceSec > 0)
      ? input.tPaceSec
      : tPaceFromVdot(conservativeVdotFromMileage(0));
    return (t != null && t > 0) ? t + 120 : null;
  })();

  /**
   * COLD-START-1 · `Research/22` §8's opening weeks, in the shape the plan
   * schema can carry. Three running days spaced with a rest day between, each
   * the same session — a day-one runner has no long run and no quality day,
   * and asserting either would be the four-mile "long" this replaces.
   */
  function coldStartWeek(weekIdx: number): DayPlan[] {
    const runMin = Math.min(
      COLD_START_PEAK_RUN_MIN,
      COLD_START_WEEK1_RUN_MIN * Math.pow(GENERAL_RAMP_CEILING.beginner, weekIdx),
    );
    const perRunMi = coldStartEasySecPerMi != null
      ? Math.max(0.1, Math.round((runMin * 60 / coldStartEasySecPerMi) * 10) / 10)
      : 0;
    // "with a rest day between" · start the day after the rest day and step by
    // two, honouring the runner's stated frequency when it is lower than three.
    const wanted = Math.min(
      COLD_START_DAYS_PER_WEEK,
      input.trainingDaysPerWeek != null && input.trainingDaysPerWeek > 0
        ? input.trainingDaysPerWeek : COLD_START_DAYS_PER_WEEK,
    );
    const order: number[] = [];
    for (let i = 1; i <= 6; i++) order.push((input.restDow + i) % 7);
    const usable = order.filter((d) => input.availableDows == null || input.availableDows.has(d));
    const runDows = new Set<number>();
    for (let i = 0; i < usable.length && runDows.size < wanted; i += 2) runDows.add(usable[i]);
    // A runner whose available days sit adjacent cannot have the rest day
    // between; they still get their sessions rather than an empty week.
    for (const d of usable) { if (runDows.size >= wanted) break; runDows.add(d); }
    const days: DayPlan[] = [];
    for (let dow = 0; dow < 7; dow++) {
      if (runDows.has(dow) && perRunMi > 0) {
        days.push({
          dow: dow as DOW, type: 'easy', distanceMi: perRunMi, isQuality: false, isLong: false,
          subLabel: `${Math.round(runMin)} min run/walk`,
          notes: 'Alternate running and walking for the whole session, and finish able to talk. '
            + 'Run the minutes, not the miles. Once a few of these are logged the plan sizes itself off what you actually ran.',
        });
      } else {
        days.push({
          dow: dow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false,
          subLabel: 'REST',
          notes: 'Off. The day between sessions is where the adaptation happens.',
        });
      }
    }
    return days;
  }

  // Layout one canonical week per slot. Rolling cutback fires every 4th week (weekIdx 3, 7, 11 …).
  function maintenanceWeek(weekIdx: number): DayPlan[] {
    if (noVolumeSignal) return coldStartWeek(weekIdx);
    const isCutback = (weekIdx + 1) % 4 === 0; // week 4, 8, 12 … = recovery step-down
    const wkWeeklyBase = isCutback ? Math.round(targetWeekly * 0.80) : targetWeekly;
    // SP-6 · 4mi coherence floor, not 8. NS-2 (2026-06-23, ext) · the cutback floor must ALSO respect the
    // true-beginner cap (recentLong 3 → cutback Math.max(4,2)=4 → smoothed 3.5 = 117% = the plan's LONGEST
    // run, over the 110% injury cap). Cutback is never longer than the base long (targetLong, already ≤110%
    // recent); the 4mi coherence floor only engages once recentLong ≥ 4. Byte-safe for recentLong ≥ 4.
    const cutFloor = (input.recentLongMi > 0 && input.recentLongMi < 4) ? Math.max(2, Math.round(input.recentLongMi)) : 4;
    let wkLong = isCutback ? Math.min(targetLong, Math.max(cutFloor, Math.round(targetLong * 0.80))) : targetLong;

    // MAINT-FREQ-FLOOR (2026-06-24) · a stated-frequency runner must get `freq` REAL runs, not a
    // long + (freq-1) sub-2mi junk easies. The 4mi coherence longFloor can eat ~67% of a tiny
    // maintenance week (e.g. long=4 of a 6mi/3-day week → two 1mi junk easies — David's complaint).
    // Lift the weekly budget so every running day seats at ≥2mi: wkWeekly ≥ wkLong + 2×(freq-1).
    // CAP at the runner's real ceiling (peakAnchor) so a genuinely volume-constrained week
    // (10mpw/6-day = 1.7mi/run) is accepted as-is, not inflated above what they actually run.
    // Gated on stated frequency → null-freq profiles (David) are byte-stable. VOL-1 reconciles
    // the displayed weeklyMi to the realized day-sum.
    let wkWeekly = wkWeeklyBase;
    if (input.trainingDaysPerWeek != null && input.trainingDaysPerWeek >= 2) {
      const everyRunFloor = wkLong + 2 * (input.trainingDaysPerWeek - 1);
      wkWeekly = Math.max(wkWeekly, Math.min(everyRunFloor, peakAnchor));
    }

    const slots: (DayPlan | null)[] = new Array(7).fill(null);
    // Rest day
    slots[input.restDow] = { dow: input.restDow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Sleep, mobility, fuel.' };
    // Long run · simpler than race-prep (no race-pace inserts)
    slots[input.longRunDow] = {
      dow: input.longRunDow, type: 'long', distanceMi: wkLong, isQuality: false, isLong: true,
      subLabel: 'LONG',
      notes: 'Conversational. Maintenance long · holding aerobic base.',
    };
    // Quality day (skip when tier shape has qualityPerWeek=0).
    // 2026-06-21 · #5 · a 0-1 day/week runner can't fit a quality session on
    // top of the long. When the stated frequency caps running below 2 days,
    // drop quality entirely (the long IS the week's single hard effort). NULL
    // frequency / freq>=2 keep the tier's quality. Uses the already-overridden
    // shape.daysPerWeek so this reads the runner's stated number, not the tier.
    const qualityAllowed = shape.qualityPerWeek > 0 && shape.daysPerWeek >= 2;
    // MAINT-QUAL-COMPRESS (2026-06-24) · when the runner stated a frequency ≥3, reserve budget
    // for at least (freq-2) easy days at 1mi each before placing quality. Without this, a low-base
    // runner (e.g. 10mpw/3-day) gets long(4)+quality(3)=7mi=budget, leaving zero room for the
    // easy fill → only 2 running days instead of the stated 3. Cap quality distance at whatever
    // remains after reserving the easy room; if that cap < 2mi, skip quality for this week.
    // Reserve 2mi (a REAL run), not 1mi (junk), per easy day so quality can't overspend into the
    // easy budget and starve an easy to 1mi (long=4 + fartlek=3 + easy=1 — David's case again).
    const qualFreqRoom = input.trainingDaysPerWeek != null && input.trainingDaysPerWeek > 2
      ? (input.trainingDaysPerWeek - 2) * 2
      : 0;
    const qualBudgetCap = wkWeekly - wkLong - qualFreqRoom;
    // MAINT-QUAL-COMPRESS-THRESH (2026-06-24) · raised from 2 to 3. A 2mi fartlek cap leaves
    // only 1mi for the easy fill — a sub-minimal run that just creates a third consecutive day
    // (Sun long / Mon easy / Tue fartlek). At budget cap < 3, skip quality and give the runner
    // two solid easy days instead (spread by MAINT-SPREAD-1 below).
    if (qualityAllowed && input.qualityDows.length > 0 && qualBudgetCap >= 3) {
      // MAINT-QUAL-ADJACENT (2026-06-23) · route through scheduleQuality so the selected DOW is
      // guaranteed to be at least 1 day away from the long run (§5). The previous direct use of
      // qualityDows[0] had no gap check: sat-quality + sun-long = 0 recovery days between them.
      const qType: DayPlan['type'] = shape.qualityType === 'threshold' ? 'threshold' : 'easy';
      const { dows: scheduledQ } = scheduleQuality(input.qualityDows, [qType], input.longRunDow, input.restDow, input.availableDows ?? null);
      const qDow = scheduledQ.length > 0 ? scheduledQ[0] : input.qualityDows[0];
      if (slots[qDow] == null) {
        // MAINT-QLONG-1 (2026-06-23) · cap at wkLong to preserve long-primacy (§7).
        // qualBudgetCap further limits quality distance when freq headroom is tight.
        const qDist = Math.min(Math.max(3, Math.round(wkWeekly * 0.16)), wkLong, qualBudgetCap);
        if (shape.qualityType === 'threshold') {
          // DOCTRINE-DOSING-2 (2026-08-18) · the maintenance threshold session
          // carried the same two defects the race-prep tempo did, and worse.
          //
          // Its label was PROSE — "3mi @ T pace · cruise" — which no parser
          // reads, so `buildWorkoutSpec` fell through to its 4×1mi default and
          // the workout the watch ran had nothing to do with the number
          // printed on it. And that number came off a hard-coded three-mile
          // floor, which on a 12 mi/wk maintenance week is 16.7% of the week at
          // threshold against `Research/01`'s 10%. The all-user sweep found it
          // on 38k archetype-weeks, most of the corpus's whole failure count.
          //
          // Now it is a real cruise-interval prescription (§5.3 "3–6 × 1 mi
          // with 1 min jog"), with the rep count sized by the week's own
          // threshold budget — the same `weeklyDoseBudgetMi` the gate checks —
          // and floored at one rep so a small week gets a real, single mile at
          // T rather than a fictional three.
          const tBudgetMi = weeklyDoseBudgetMi(wkWeekly, 'T');
          const reps = Math.max(1, Math.min(6, Math.floor(tBudgetMi)));
          slots[qDow] = {
            dow: qDow, type: 'threshold', distanceMi: qDist, isQuality: true, isLong: false,
            subLabel: `${reps}×1mi @ T pace · 60s jog`,
            notes: 'WU 1.5mi · steady at threshold · CD 1mi. Aerobic engine maintenance.',
          };
        } else if (shape.qualityType === 'fartlek') {
          // MAINT-FARTLEK-SPEC (2026-06-23) · fartlek is AEROBIC with surges, not sustained
          // threshold. The prior type:'tempo' caused buildWorkoutSpec to prescribe tPaceSec
          // and 92% LTHR — full threshold effort — while notes said "Easy with 1-minute pickups."
          // Fix: type:'easy' so the spec targets the aerobic zone; surges communicated via subLabel.
          slots[qDow] = {
            dow: qDow, type: 'easy', distanceMi: qDist, isQuality: true, isLong: false,
            subLabel: `${qDist}mi w/ 6×1min surges`,
            notes: 'Easy with 1-minute pickups every 5 min. Leg turnover · not race-pace.',
          };
        }
      }
    }
    // Fill easies up to daysPerWeek
    // MAINT-EASY-1 (2026-06-23) · the easyFloor=max(3, median||5) inflated easy days for cold-start
    // runners (easyDayMedianMi=0 → floor=5) to well beyond the weekly budget, making a 15mpw
    // maintenance plan realize 19mpw. Use a 2mi sanity floor only (no baseline inflation). VOL-1
    // reconciles weeklyMi to the realized sum, so the UI would have shown the inflated number.
    const allocated = slots.filter(Boolean).reduce((s, d) => s + (d?.distanceMi ?? 0), 0);
    const easyMiBudget = Math.max(0, wkWeekly - allocated);
    const emptySlots = slots
      .map((s, i) => ({ slot: s, dow: i as DOW }))
      .filter((x) => x.slot == null);
    // 2026-06-21 · #4 · when the runner gave available days, easy runs may only
    // land on those days; every other empty day stays rest. long/quality/rest
    // already sit on available days (loadGeneratorInputs derives them from the
    // same set). NULL → every empty slot is a candidate (legacy behavior). This
    // mirrors composePlan's layoutWeek easy-candidate filter exactly.
    const easySlots = input.availableDows
      ? emptySlots.filter((e) => input.availableDows!.has(e.dow))
      : emptySlots;
    const runningPlaced = slots.filter(Boolean).filter((d) => d?.distanceMi! > 0).length;
    // MAINT-EASY-2 (2026-06-23) · cap easy slots to what the budget can sustain at a minimum
    // 2mi each. Without this, a 3mi easy budget spread over 4 slots floored each to 2mi and
    // realized 8mi instead of 3mi. The fix: max floor(budget/2) easy days — the remainder stay
    // rest. MAINT-EASY-1-REGRESS extended this to the zero-budget case (floor(0/2)=0 easy days).
    // MAINT-MIN-EASY (2026-06-24) · when MAINT-FREQ-FLOOR could seat every running day at ≥2mi
    // (budget ≥ wkLong + 2×(freq-1)), floor easies at 2mi — no 1mi junk. Only when the runner is
    // genuinely volume-constrained (peakAnchor can't afford freq real runs alongside the coherence
    // long, e.g. 10mpw/6-day) do we drop to a 1mi floor, honoring the stated frequency with short
    // runs rather than dropping a day. null-freq (David) keeps the 2mi floor → byte-stable.
    const budgetSeatsAll2 = input.trainingDaysPerWeek != null
      && wkWeekly >= wkLong + 2 * (input.trainingDaysPerWeek - 1);
    const MAINT_MIN_EASY = input.trainingDaysPerWeek == null ? 2 : (budgetSeatsAll2 ? 2 : 1);
    const maxEasyByBudget = Math.floor(easyMiBudget / MAINT_MIN_EASY);
    const targetEasyCount = Math.min(easySlots.length, Math.max(0, shape.daysPerWeek - runningPlaced), maxEasyByBudget);
    const perEasyRaw = targetEasyCount > 0 ? Math.max(MAINT_MIN_EASY, Math.round(easyMiBudget / targetEasyCount)) : 0;
    // 2026-06-21 · N2 · easy never exceeds the long run. A sparse availableDows
    // (few easy slots) + a high peak can spike per-easy above the long (same
    // class as recovery N2); clamp to wkLong, mirroring layoutWeek's easyCeiling.
    // The week runs lighter instead — the correct gentler outcome. null-avail /
    // ample-slot weeks sit well under the long, so this is a no-op for them.
    const perEasy = wkLong > 0 ? Math.min(perEasyRaw, wkLong) : perEasyRaw;
    // MAINT-SPREAD-1 (2026-06-24) · spread easy fills across the week instead of always
    // taking the first N slots in DOW order. The default order places easy on Monday when
    // long=Sun and quality=Tue → Sun/Mon/Tue = 3 consecutive days every week. Fix: prefer
    // slots NOT adjacent to any hard session (long or quality), then pick evenly spaced
    // indices across the candidate list. Fall back to all slots when the filtered set is
    // too small to satisfy targetEasyCount.
    const hardDows = new Set<number>(
      slots.map((s, i) => (s != null && (s as DayPlan).distanceMi > 0 ? i : -1)).filter((i) => i >= 0)
    );
    const adjToHard = new Set<number>();
    for (const hd of hardDows) { adjToHard.add((hd + 1) % 7); adjToHard.add((hd + 6) % 7); }
    const preferredEasySlots = easySlots.filter((e) => !adjToHard.has(e.dow));
    const candidateSlots = preferredEasySlots.length >= targetEasyCount ? preferredEasySlots : easySlots;
    const pickedDows = new Set<number>();
    for (let i = 0; i < targetEasyCount; i++) {
      const idx = targetEasyCount <= 1
        ? Math.floor(candidateSlots.length / 2)
        : Math.round(i * (candidateSlots.length - 1) / (targetEasyCount - 1));
      if (idx < candidateSlots.length) pickedDows.add(candidateSlots[idx].dow);
    }
    for (const { dow } of easySlots) {
      if (pickedDows.has(dow)) {
        slots[dow] = { dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Conversational throughout.' };
      } else {
        slots[dow] = { dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off.' };
      }
    }
    // 2026-06-21 · #5 · frequency cap. The long (and a freq>=2 quality) are
    // authored unconditionally above, so a 1-day runner could still end up with
    // long+quality = 2 running days when they asked for 1 — the easy-fill can
    // only ADD days, never trim the long/quality. Mirror the race-prep trim:
    // demote running days in priority order (easy → quality, long always stays)
    // until the running-day count meets the stated frequency. NULL → untouched.
    if (input.trainingDaysPerWeek != null) {
      let running = slots.filter((d) => d != null && d.distanceMi > 0).length;
      const isQ = (d: DayPlan) => d.isQuality;
      const isE = (d: DayPlan) => d.type === 'easy';
      for (const matches of [isE, isQ] as const) {
        if (running <= input.trainingDaysPerWeek) break;
        for (let dow = 0; dow < 7; dow++) {
          if (running <= input.trainingDaysPerWeek) break;
          const d = slots[dow];
          if (d != null && d.distanceMi > 0 && !d.isLong && matches(d)) {
            slots[dow] = { dow: dow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off.' };
            running--;
          }
        }
      }
    }
    // 2026-06-21 · #4b · any slot still empty is a NON-available day: when the
    // runner gave available_days, the easy-fill above only touches available
    // empties, so the rest stay null. layoutWeek rests every empty slot and
    // returns a full 7-day week — mirror that here so the persisted week has 7
    // contiguous days. Without this the null slots drop out at filter(Boolean)
    // below → a <7-day week → INV2 gaps in the strip (the live non-race harness
    // caught M·avail at days=4). No-op for null-available runners: the easy-fill
    // already covered every empty slot, so nothing is left to rest (David byte-
    // for-byte unchanged).
    for (let dow = 0; dow < 7; dow++) {
      if (slots[dow] == null) {
        slots[dow] = { dow: dow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off.' };
      }
    }
    return slots.filter(Boolean) as DayPlan[];
  }

  for (let wi = 0; wi < TOTAL_WEEKS; wi++) {
    const startISO = addDays(input.startMondayISO, wi * 7);
    // #14 (audit 2026-06-16) · the `weeks[wi]?.weeklyMi ??` self-reference was
    // dead: `weeks[wi]` is read before THIS iteration's push, so it was always
    // undefined and the fallback always ran. The fallback IS the real value and
    // matches maintenanceWeek(wi)'s internal `isCutback = weekIdx === 3 →
    // targetWeekly * 0.80`. (Pattern was copied from the race-prep composer
    // where `weeklyMi: vols[wi]` reads a genuinely pre-computed array.) Drop the
    // dead clause so the cutback factor lives in one place per week.
    weeks.push({
      startISO,
      phase: 'MAINTENANCE',
      weeklyMi: wi === 3 ? Math.round(targetWeekly * 0.80) : targetWeekly,
      days: maintenanceWeek(wi),
      isRaceWeek: false,
      tPaceSec: input.tPaceSec,
    });
  }

  /* ── FRONTLOAD-MAINT-1 (2026-08-19) · maintenance front-loads too ─────────
   *
   * "Get them running on day one" was written into `composePlan` and only
   * `composePlan`, so it never applied to the ONE onboarding path most likely
   * to need it: a runner whose race sits outside the build window gets a
   * maintenance block, and `qa-race-…` signed up on a Wednesday and was shown
   * two rest days before their first run.
   *
   * Two exclusions, both deliberate:
   *
   *   · COLD START. `Research/22` §8's own parameter row is "Days/week | 3
   *     (with rest day between)", and `coldStartWeek` places its sessions on
   *     that spacing. Front-loading one onto the anchor can seat two sessions
   *     back to back, which is the one thing §8 spells out not to do. A
   *     sedentary starter waits for their first scheduled day.
   *   · RECOVERY. `composeRecoveryPlan` deliberately does NOT call this. That
   *     block only ever exists in the days after a race, where `Research/00b`
   *     prescribes days of zero-to-very-light running — the exact column the
   *     engine already mis-spent once (see Rule 7 in CLAUDE.md). "Start them
   *     today" is an onboarding rule, not a post-race one.
   *
   * Ordered after FRONTLOAD-AVAIL-1 on purpose: without that fix this call
   * would propagate the unavailable-day bug into a second composer.
   */
  const maintAnchorDow = new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay();
  if (weeks.length > 0 && !noVolumeSignal && maintAnchorDow !== 1) {
    frontLoadFirstRun(weeks[0].days, maintAnchorDow, input.availableDows ?? null, true);
  }

  return {
    weeks,
    blocks,
    totalWeeks: TOTAL_WEEKS,
    vols: weeks.map((w) => w.weeklyMi),
    authoredState: {
      mode: 'maintenance',
      total_weeks: TOTAL_WEEKS,
      recent_avg_mpw: input.recentWeeklyMi,
      tier: input.tier,
      maintenance_shape: shape,
      // MAINT-NOBLOCK-1 · `maintenance_shape` is the TIER LOOKUP, and its
      // weeklyPctOfPeak is no longer always the fraction that ran. Record which
      // doctrine arm this block was sized by, and the number it used, so the
      // audit surface cannot quietly disagree with the plan the way
      // target_weekly_mi did (see VOL-2 in finalizeComposedPlan).
      volume_anchor: hasCompletedBlockPeak ? 'last_cycle_peak' : 'durable_level',
      weekly_pct_applied: weeklyPctApplied,
      target_weekly_mi: targetWeekly,
      target_long_mi: targetLong,
      next_race: input.nextRace,
      // EVIDENCE-2 · carry the season anchor forward (see ComposeNonRaceInput).
      // SELFREPORT-1 · the anchor's provenance, not an assumption about it.
      ...(input.bestRecentVdot != null
        ? { pace_blend: { season_anchor_vdot: input.bestRecentVdot, season_anchor_source: (input.bestRecentVdotSelfReported ? 'self_reported_race' : 'measured_vdot') as AnchorSource, season_anchor_provisional: input.bestRecentVdotSelfReported === true, goal_vdot: null, build_weeks: TOTAL_WEEKS, measured_progress_fraction: null } }
        : {}),
      citations: blocks.phases.map((p) => p.citation),
    },
  };
}

/**
 * Compose a 1-2 week recovery plan. Very low volume; all easy + rest;
 * no quality. Transitions automatically to maintenance or race-prep
 * via the graduate cron when the recovery window closes.
 */
export function composeRecoveryPlan(input: ComposeNonRaceInput): ComposePlanResult {
  if (!input.lastRaceFinished) {
    // Shouldn't happen · recovery requires a finished race. Bail to a
    // single-week placeholder.
    return composeMaintenancePlan(input);
  }
  const lastCat = (input.lastRaceFinished.distanceMi <= 4) ? '5k'
    : input.lastRaceFinished.distanceMi <= 8 ? '10k'
    : input.lastRaceFinished.distanceMi <= 17 ? 'hm'
    : input.lastRaceFinished.distanceMi <= 30 ? 'm'
    : 'ultra';
  // DOCTRINE-5 (2026-08-17) · RECOVERY_EFFORT_SCALE, finally spent. It was added
  // the same morning as RECOVERY-3 and imported nowhere, so a B-priority tune-up
  // triggered the full A-race hole. Research/00b §"Recovery by Effort": a B race
  // takes 60-70% of A-race recovery DURATION, a C race 25-50%. Duration, not
  // depth — a shorter hole, not a diluted one.
  // A distance/priority pair that earns no recovery WEEK at all (5K at any
  // priority; a C-effort 10K) still yields the historical one-week placeholder
  // via the `max(1, …)` below — pickPlanMode never routes those to recovery in
  // the first place, so this path is only reached by a direct call.
  const recoveryWeeks = postRaceRecoveryWeeks(lastCat, input.lastRaceFinished.priority ?? null);
  // RECOVERY-2 (2026-06-23) · a mid-recovery REGEN must not restart at week 1. Offset into the reverse
  // taper by whole weeks elapsed since the race finished, and emit only the weeks that remain.
  const recoveryOff = Math.floor(Math.max(0, daysBetween(input.lastRaceFinished.date, input.startMondayISO)) / 7);
  const remainingWeeks = Math.max(1, recoveryWeeks - recoveryOff);
  // DOCTRINE-4 (2026-08-17) · THE DENOMINATOR IS PEAK, NOT A 4-WEEK AVERAGE.
  //
  // RECOVERY_WEEKLY_PCT_OF_BASE multiplies this anchor, and the column it is
  // read from in Research/00b §"Marathon Recovery (4-week reverse taper)" is
  // headed "Volume vs. **peak**". Both inputs here were trailing AVERAGES:
  // `recentWeeklyMi` is a 28-day mean, and `recentPeakWeeklyMi` was wired to the
  // same value ("proxy when peak unknown"), so max() of two averages is an
  // average. A marathoner whose true peak week was 70 but whose 4-week mean was
  // 43 (peak, taper, taper, race week — exactly the shape of the weeks before a
  // marathon) landed week 4 at 0.75 × 43 ≈ 32 mi, about 46% of true peak, where
  // the doctrine row asks for 70-80%. The reverse taper reconverged on a number
  // the runner had already left behind.
  //
  // `recentPeakWeeklyMi` is now a REAL peak week (see recentPeakWeeklyMileage in
  // the loader); the max() with the mean is kept as a floor for callers that
  // still pass a proxy, where it is a no-op.
  const peakAnchor = Math.max(input.recentPeakWeeklyMi, input.recentWeeklyMi);

  // WKRAMP-REC-1 (2026-08-25) · the block's own ceiling, published so
  // `finalizeComposedPlan` can hand it to `enforceWeeklyRampCeiling` instead of
  // letting that pass measure this block against its own deload weeks. See the
  // ramp ceiling's WKRAMP-REC-1 note, and `recoveryBlockCeilingPct` for why the
  // fraction is derived from the sequence the weeks are already sized off
  // rather than declared beside it.
  //
  // Null when there is no anchor at all (a cold-start runner with no logged
  // history): a ceiling of zero would trim every week to nothing, so the pass
  // falls back to its ordinary week-over-week rule, which is what it did for
  // this runner before.
  const recoveryCeilingMi = peakAnchor > 0
    ? Math.round(peakAnchor * recoveryBlockCeilingPct(lastCat) * 10) / 10
    : null;

  // RECOVERY-3 (2026-08-17) · per-distance volume profiles. Previously every
  // distance ran on the marathon reverse taper, so a half prescribed 20% of
  // base in week 1 → 2 running days → 6 miles for a 33mpw runner with a
  // marathon 16 weeks out. "No quality for 10-14 days" is not "no running for
  // 10-14 days" (Research/00b:196-204 has both columns; the half's own
  // protocol at :240-255 has a 45-60 min medium-long on day 7). Marathon and
  // ultra keep the reverse taper unchanged. See goal-tiers RECOVERY-3.
  const wkPctSeq = RECOVERY_WEEKLY_PCT_OF_BASE[lastCat];
  const runDaySeq = RECOVERY_RUN_DAYS[lastCat];
  const longPct = RECOVERY_LONG_PCT[lastCat];
  // What this block was sized against and the ceiling `finalizeComposedPlan`
  // enforces on it. Published rather than passed as an argument, because
  // `finalizeComposedPlan` takes only the composed result — and because a
  // modelled number that moves a runner's miles belongs on the audit surface
  // rather than implicit in a call. Built here rather than inline in the
  // `authoredState` literal so that literal stays compact: the
  // EVIDENCE.no-calendar-pace-advance claim reads it by proximity to
  // `mode: 'recovery'`, and a long comment inside it silently pushes
  // `season_anchor_vdot` out of the window that claim looks in.
  const reverseTaperRecord = {
    peak_anchor_mi: peakAnchor,
    weekly_pct: wkPctSeq,
    block_ceiling_mi: recoveryCeilingMi,
  };
  const weeks: ComposedWeek[] = [];
  const blocks: BlockPlan = {
    totalWeeks: remainingWeeks,
    phases: [{
      label: 'RECOVERY',
      weeks: remainingWeeks,
      rationale: `Post-race recovery · ${input.lastRaceFinished.name}. Easy running only · no quality.`,
      citation: 'Research/00a-distance-running-training.md §recovery + Pfitzinger Advanced Marathoning §Post-race recovery',
    }],
  };

  for (let wi = 0; wi < (remainingWeeks); wi++) {
    const wkPct = wkPctSeq[wi + recoveryOff] ?? wkPctSeq[wkPctSeq.length - 1]; // RECOVERY-2 · elapsed offset
    // The same offset the taper row, the run-day cap and the final-week test
    // already carry. It reaches the LABEL now too.
    const blockWeekIdx = wi + recoveryOff;
    const wkWeekly = Math.round(peakAnchor * wkPct);
    const slots: (DayPlan | null)[] = new Array(7).fill(null);
    slots[input.restDow] = { dow: input.restDow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Recover.' };
    // RECWK-RESTDAYS-1 (2026-08-25) · THE SECOND REST DAY IS NOT UNCONDITIONAL.
    //
    // "2 rest in recovery weeks" was written when every distance ran on the
    // marathon percentages and no recovery week asked for more than five
    // running days. RECOVERY-3 replaced `ceil(wkPct * 7)` with each distance's
    // OWN protocol, and two of those rows ask for six: the marathon's week 4
    // ("rebuilding to 6") and the half's week 2 ("5-6 days in week 2",
    // Research/00b's 14-day table, days 8-14). Two hard-coded rest days out of
    // seven make six impossible, so the composer published a run-day table it
    // then quietly capped at five — and the missing day is a whole easy run,
    // which is what held the marathon's last reverse-taper week at ~60% of peak
    // when the doctrine row asks for 70-80%.
    //
    // So the extra rest day is placed only while the week actually intends six
    // running days — the run-day row AND the runner's own stated frequency,
    // which RECWK1-FREQ-1 already treats as a ceiling over it. A runner who
    // says they run five days gets five, and gets them with the rest days
    // SPACED, exactly as before; the day is only surrendered when it is the
    // thing standing between the week and its doctrine row. Every week whose
    // target is five or fewer is untouched.
    const recoveryRunCap = runDaySeq[wi + recoveryOff] ?? runDaySeq[runDaySeq.length - 1];
    const weekRunTarget = input.trainingDaysPerWeek != null
      ? Math.min(input.trainingDaysPerWeek, recoveryRunCap)
      : recoveryRunCap;
    const extraRestDow: number = weekRunTarget <= 5 ? ((input.restDow + 3) % 7) : -1;
    if (extraRestDow >= 0) {
      slots[extraRestDow] = { dow: extraRestDow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Extra rest · still recovering.' };
    }
    // 1 medium easy mid-week (optional · only if Pfitz says >40% of peak).
    // 2026-06-21 · #7 · the medium-easy used to claim slots[longRunDow]
    // unconditionally. When longRunDow coincides with restDow or the
    // extraRestDow=(restDow+3)%7, it silently overwrote a rest day → only 1
    // rest day → a 6-running-day "recovery" week. Pick a medium day that is
    // NOT either rest day (and, when the runner gave available days, IS one of
    // them). Prefer the long-run slot, then mid-week, then any free day.
    // The recovery week's longest run · the optional mid-week medium AND the
    // ceiling for every easy day below (easy never exceeds the longest run,
    // mirroring layoutWeek's easy≤long clamp). 2026-06-21 · N2.
    // REC-MEDIUM-1 (2026-06-23) · the 6mi floor inflated the "medium" day to 6mi for very
    // low-volume runners (5mpw base → wkWeekly=2mi → mediumMi was max(6,0)=6 = 3× the
    // week budget). Use a 2mi sanity floor (matching RECOVERY_MIN_EASY) and cap at wkWeekly.
    // RECOVERY-3 · long/medium sized per distance (marathon holds 0.20; the
    // shorter distances reintroduce a real medium-long on the protocol's
    // schedule), always capped by the week's own budget.
    const mediumMi = Math.min(wkWeekly, Math.max(2, Math.round(wkWeekly * longPct)));
    const isFinalRecoveryWeek = (wi + recoveryOff) === recoveryWeeks - 1;
    const isFree = (d: number) =>
      d !== input.restDow && d !== extraRestDow && slots[d] == null &&
      (input.availableDows ? input.availableDows.has(d) : true);
    // candidate order: long-run day, then mid-week-out (Wed-first), then any
    const longBackDow = [input.longRunDow, 3, 4, 2, 5, 1, 6, 0].find(isFree);
    if (wkPct >= 0.50) {
      if (longBackDow != null) {
        // BRK-3 (2026-06-23) · reintroduce a LONG run on the FINAL recovery week so the runner carries one
        // into maintenance/race-prep (RECOVERY-1's 4-week reverse taper otherwise ended long-less for
        // marathon/ultra). Earlier weeks keep the day as a building-back medium.
        slots[longBackDow] = isFinalRecoveryWeek
          ? { dow: longBackDow as DOW, type: 'long', distanceMi: mediumMi, isQuality: false, isLong: true, subLabel: 'LONG', notes: 'Long run back · easy effort.' }
          : { dow: longBackDow as DOW, type: 'easy', distanceMi: mediumMi, isQuality: false, isLong: false, subLabel: 'MEDIUM-LONG', notes: 'Building back · easy effort.' };
      }
    } else if (isFinalRecoveryWeek && longBackDow != null) {
      // MT-REC-1 (2026-06-23) · HM (wkPct [0.20,0.40]) and 10K (wkPct [0.30]) recovery NEVER reach wkPct≥0.50,
      // so BRK-3 above never fired → a long was never reintroduced (realized long = 0mi all block). Place a
      // GENTLE long on the final recovery week, sized to recent long capped to ~40% of the week's volume.
      // Research/00b:200-201 (long reintroduced day 7-10, ~45-60min easy). Marathon/ultra unaffected (≥0.50).
      const reLongMi = Math.max(3, Math.min(input.recentLongMi || 6, Math.round(wkWeekly * 0.40)));
      slots[longBackDow] = { dow: longBackDow as DOW, type: 'long', distanceMi: reLongMi, isQuality: false, isLong: true, subLabel: 'LONG', notes: 'Long run back · easy effort.' };
    }
    // Fill rest with easies.
    const allocated = slots.filter(Boolean).reduce((s, d) => s + (d?.distanceMi ?? 0), 0);
    const easyMiBudget = Math.max(0, wkWeekly - allocated);
    const emptySlots = slots
      .map((s, i) => ({ slot: s, dow: i as DOW }))
      .filter((x) => x.slot == null);
    // 2026-06-21 · #4 · respect available days — easy runs land only on days
    // the runner can run; every other empty day stays rest. NULL → every empty
    // slot is a candidate (legacy). Parity with composePlan's layoutWeek.
    const easySlots = input.availableDows
      ? emptySlots.filter((e) => input.availableDows!.has(e.dow))
      : emptySlots;
    // 2026-06-21 · #6 · honor stated frequency. The week is 2 rest + every other
    // slot easy = ~5 running days regardless of what the runner picked. When a
    // frequency is set, keep only enough easy days to hit it (running days
    // already placed = long/medium count toward the budget); the rest become
    // rest. NULL → fill every easy candidate (legacy 5-day recovery week).
    const runningPlaced = slots.filter(Boolean).filter((d) => d?.distanceMi! > 0).length;
    // RECWK1-1 (2026-06-23) · early recovery (low wkPct) must be REST-dominated — Research/00b:260 (marathon
    // week 1 ≈ days 0-3 rest, days 4-7 easy jogs every other day = ~2 short jogs). The null-freq branch filled
    // EVERY empty slot (5 running days even the race-finish week). Cap TOTAL running days by wkPct (ceil so
    // the lightest week still gets ~2 short jogs) so the reverse taper actually rebuilds frequency: wk1 ~2 →
    // wk4 ~6. Stated-frequency runners unchanged.
    // RECOVERY-3 (2026-08-17) · running days come from the distance's own
    // protocol, not from ceil(wkPct * 7). The formula was calibrated on
    // marathon percentages, so feeding it a half's shallower profile capped
    // the week at 2 running days when the half protocol runs on four
    // (days 3, 4, 6, 7 · Research/00b:240-255).
    // RECWK-RESTDAYS-1 (2026-08-25) · `recoveryRunCap` is now resolved at the
    // TOP of the week, because the second rest day's placement depends on it.
    // Same value, read once.
    // RECWK1-FREQ-1 (2026-06-23) · stated frequency is a CEILING for normal training, not a floor that
    // overrides recovery's deliberate frequency rebuild. A stated-freq=5 runner was getting 5 running days
    // in marathon-recovery week 1 (should be ~2). Apply recoveryRunCap to stated-freq runners too:
    // min(trainingDaysPerWeek, recoveryRunCap) so the rebuild rebuilds: wk1 ~2 → wk4 ~6.
    const targetEasyCount = input.trainingDaysPerWeek != null
      ? Math.max(0, Math.min(easySlots.length, Math.min(input.trainingDaysPerWeek, recoveryRunCap) - runningPlaced))
      : Math.max(0, Math.min(easySlots.length, recoveryRunCap - runningPlaced));
    // 2026-06-21 · #8 · the per-slot easyFloor (>= ~4mi each) decoupled the day-
    // sum from wkWeekly: with N easy slots all pinned to the floor, the realized
    // week ran ~2× the intended recovery volume — the opposite of a cutback. A
    // recovery week is deliberately light, so size easy days off the budget
    // (a small 2mi sanity floor only, no baseline floor) and ensure the realized
    // day-sum tracks wkWeekly. Floor never inflates the week above its target.
    const perEasyRaw = targetEasyCount > 0 ? Math.round(easyMiBudget / targetEasyCount) : 0;
    // REC-EASY-CAP-1 (2026-06-23) · the mediumMi ceiling (originally added to prevent "recovery
    // easy" spikes when available_days constrains slots) was applied unconditionally. In early
    // recovery weeks (wkPct < 0.50) no medium/long run is placed, so mediumMi is synthetic
    // (= max(2, wkWeekly*0.20)) — 2mi for a week-1 55mpw runner. Capping perEasy at 2mi when
    // there are 2 easy slots and an 8mi budget produces 4mi realized vs 8mi target (50% gap).
    // Fix: only apply the mediumMi ceiling when a medium or long run was actually placed this week
    // (i.e. the slot is not zero). When the week is all-easy, the natural perEasyRaw from the
    // budget computation is the correct ceiling (no ceiling needed — it's the budget itself).
    const mediumRunPlaced = wkPct >= 0.50 || isFinalRecoveryWeek;
    const perEasyCeiling = mediumRunPlaced ? mediumMi : wkWeekly; // without medium: easy up to full budget
    const perEasy = Math.min(Math.max(RECOVERY_MIN_EASY, perEasyRaw), perEasyCeiling);
    for (let i = 0; i < easySlots.length; i++) {
      const { dow } = easySlots[i];
      if (i < targetEasyCount) {
        slots[dow] = { dow, type: 'easy', distanceMi: perEasy, isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Recovery easy · conversational, no surges.' };
      } else {
        slots[dow] = { dow, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Still recovering.' };
      }
    }
    // 2026-06-21 · #4b · rest any slot the easy-fill left untouched (non-
    // available days when available_days is set). Mirrors layoutWeek's full
    // 7-day week so the persisted recovery week has 7 contiguous days, not a
    // gap-riddled <7 (the same INV2 hole the maintenance composer had). No-op
    // for null-available runners — the easy-fill covered every empty slot.
    for (let dow = 0; dow < 7; dow++) {
      if (slots[dow] == null) {
        slots[dow] = { dow: dow as DOW, type: 'rest', distanceMi: 0, isQuality: false, isLong: false, subLabel: 'REST', notes: 'Off. Still recovering.' };
      }
    }
    weeks.push({
      startISO: addDays(input.startMondayISO, wi * 7),
      phase: 'RECOVERY',
      weeklyMi: wkWeekly,
      days: slots.filter(Boolean) as DayPlan[],
      isRaceWeek: false,
      tPaceSec: null,
      blockWeekIdx,
    });
  }

  return {
    weeks,
    blocks,
    totalWeeks: weeks.length,
    vols: weeks.map((w) => w.weeklyMi),
    authoredState: {
      mode: 'recovery',
      total_weeks: weeks.length,
      tier: input.tier,
      last_race_finished: input.lastRaceFinished,
      next_race: input.nextRace,
      target_weekly_mi: weeks[0]?.weeklyMi ?? 0,
      reverse_taper: reverseTaperRecord,
      // EVIDENCE-2 · a recovery block wrote NO pace anchor, so the race-prep
      // authoring that follows it found none and fell through to the calendar
      // blend ungated. Record the fitness the block was entered at.
      // SELFREPORT-1 · the anchor's provenance, not an assumption about it.
      ...(input.bestRecentVdot != null
        ? { pace_blend: { season_anchor_vdot: input.bestRecentVdot, season_anchor_source: (input.bestRecentVdotSelfReported ? 'self_reported_race' : 'measured_vdot') as AnchorSource, season_anchor_provisional: input.bestRecentVdotSelfReported === true, goal_vdot: null, build_weeks: weeks.length, measured_progress_fraction: null } }
        : {}),
      citations: blocks.phases.map((p) => p.citation),
    },
  };
}

// ── Persistence ─────────────────────────────────────────────────────────

/** 2026-06-09 · M-19 · runs on the rebuild transaction's client so the
 *  archive UPDATE commits (or rolls back) atomically with the new
 *  plan's inserts. A crash between archive and insert used to leave
 *  the runner with NO active plan — today/watch/adaptation crons went
 *  dark. The lookup-cache bust moved to generatePlan, post-commit
 *  (busting pre-commit let a concurrent render re-cache the OLD plan
 *  mid-rebuild and serve it stale for the TTL). */
async function clearActivePlansFor(client: PoolClient, userId: string, reason = 'regenerated'): Promise<void> {
  await client.query(
    `UPDATE training_plans SET archived_iso = NOW(), archive_reason = $2
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [userId, reason]
  );
}

/**
 * THE PACE + SPEC A COMPOSED DAY IS PERSISTED WITH.
 *
 * Lifted out of `persistPlan` verbatim (2026-08-17 · COLD-4) so the numbers the
 * writer commits can be inspected without a database. It was previously
 * inlined, which meant every audit of "what does this plan actually prescribe"
 * had to reconstruct the argument list by hand — and an audit that reproduces
 * the code it is auditing proves nothing.
 *
 * Pure. Same inputs, same spec, no I/O.
 */
export function specForComposedDay(
  d: DayPlan,
  /** The week's blended T-pace. Null → no spec (the caller writes nulls). */
  weekT: number | null,
  args: {
    lthr: number | null;
    maxHr: number | null;
    goalPaceSec: number | null;
    easyAnchorTSec: number | null;
    goalIPaceEligible: boolean;
    belowTableAnchor?: BelowTableAnchor | null;
  },
): { paceTargetSPerMi: number | null; spec: ReturnType<typeof buildWorkoutSpec>['spec'] } {
  if (weekT == null) return { paceTargetSPerMi: null, spec: null };
  // 2026-06-02 · pass the prescription string (sub_label) into
  // spec-builder so the spec's rep_count / rep_distance_mi /
  // rep_rest_s match what the label promises. Was hardcoded ·
  // produced 5×1km specs under "4×1 mi @ I" labels.
  // 2026-06-03 · Rule 16 · pass maxHr alongside LTHR so easy/long
  // HR caps use max(89% LTHR, 78% maxHR) instead of LTHR-only.
  // R3 · per-week true I-pace for 5K/10K goals: invert the week's blended
  // T back to a VDOT, then take its 5K-race-pace I. Ramps with the block;
  // null (→ cruise default) for half/marathon and when weekT is unusable.
  // TAPER-SHARP-1 (2026-06-23) · the marathon/ultra race-week sharpener is 5K-pace reps (Research/08
  // §9.3 "5×1min @ 5K pace") — a NEUROMUSCULAR primer FASTER than race pace, not MP. Compute I-pace for
  // the tune-up day even when the goal distance isn't I-eligible for long-run inserts (spec-builder
  // uses it only when the prescription says "5K pace", so the HM tune-up still reads HMP).
  // 2026-07-07 · AUDIT P1-56 · vdotFromTpace's binary search is bounded [30,85] — inverting a
  // below-table weekT through it silently clamps UP to VDOT-30 I-pace, re-introducing the
  // too-fast-prescription bug one level down from the T-pace fix. When the plan-wide fitness read
  // came from a below-table anchor (no measured VDOT), derive I-pace directly off the anchor via
  // Riegel (iPaceFromAnchorPace) instead — never re-enters VDOT space. Byte-identical whenever
  // args.belowTableAnchor is null (every runner with a measured VDOT).
  const iPaceSec = (args.goalIPaceEligible || d.type === 'race_week_tuneup')
    ? (args.belowTableAnchor
        ? iPaceFromAnchorPace(args.belowTableAnchor.anchor)
        : iPaceFromVdot(vdotFromTpace(weekT)))
    : null;
  const built = buildWorkoutSpec(
    d.type, d.distanceMi, weekT, args.lthr, d.subLabel, args.maxHr ?? null,
    // 2026-06-09 · goal pace · only the race branch reads it.
    // MIDRACE-1 (2026-08-17) · an embedded mid-block tune-up race day
    // carries ITS OWN goal pace (raceGoalPaceSec, may be null → the
    // race branch derives race pace from T at the TUNE-UP's distance);
    // the plan's race-week race day keeps args.goalPaceSec.
    d.raceGoalPaceSec !== undefined ? d.raceGoalPaceSec : (args.goalPaceSec ?? null),
    iPaceSec,
    args.easyAnchorTSec ?? null,  // PACE-E-1 · easy/long/recovery anchor (current fitness)
    // COLD-4 · the composer's calibration-intro decision. The spec goes
    // out `by_effort` with no rep pace and no pace_target column.
    d.effortCued === true,
  );
  return { paceTargetSPerMi: built.paceTargetSPerMi, spec: built.spec };
}

/** What one composed day becomes in `plan_workouts`. The columns a reader can
 *  actually see, in the values the INSERT binds. */
export interface PersistedDayShape {
  type: string;
  distanceMi: number;
  paceTargetSPerMi: number | null;
  workoutSpec: ReturnType<typeof buildWorkoutSpec>['spec'];
  isQuality: boolean;
  isLong: boolean;
  notes: string;
  subLabel: string | null;
  /** True when a seal overrode the freshly-composed prescription. */
  sealed: boolean;
}

/**
 * THE AUTHORED DAY BECOMES THE STORED DAY, HERE.
 *
 * Extracted 2026-08-24 from `persistPlan`'s row loop — byte-identical logic,
 * zero behaviour change — so the hop can be driven with no database. It is a
 * LOSSY hop and that is why it needed a seam: `distance_mi` is the SPEC's
 * summed total, not the composed day's `distanceMi`, so a quality session
 * composed as a 4-mile core is stored as its 8-mile whole; and `sub_label` is
 * re-derived from the spec, so the composer's own string can be replaced.
 *
 * `lib/conservation/_plan_conservation.test.ts` says in as many words that it
 * enters AROUND this function rather than through it. Now it can enter through
 * it, and so can the onboarding sweep — see
 * `lib/onboarding/_onboarding_e2e.test.ts`.
 */
export function persistedDayShape(
  d: DayPlan,
  /** The week's blended T-pace, or the plan-wide goal-T when the week has none. */
  weekT: number | null,
  args: {
    lthr: number | null;
    maxHr: number | null;
    goalPaceSec: number | null;
    easyAnchorTSec: number | null;
    goalIPaceEligible: boolean;
    belowTableAnchor?: BelowTableAnchor | null;
  },
  /** The prior plan's prescription for this date, when the day is sealed. */
  sealed?: SealedPrescription | null,
): PersistedDayShape {
  // 2026-06-01 · derive pace_target + workout_spec at insert time (web agent
  // gap brief). Was leaving both NULL waiting on the backfill cron · now every
  // freshly-generated quality row carries its target pace + structured spec
  // from day one. Reuses lib/plan/spec-builder.ts (single source of truth · the
  // backfill cron uses the same helper).
  const derived = specForComposedDay(d, weekT, args);
  const paceTargetSPerMi: number | null = derived.paceTargetSPerMi;
  let workoutSpec: ReturnType<typeof buildWorkoutSpec>['spec'] = derived.spec;
  // 2026-06-21 · cap the spec's REALIZED distance at the clamped day distance.
  // The post-compose easy/quality≤long sweep clamps d.distanceMi, but the
  // PERSISTED distance is the spec's summed segments — which can exceed it
  // (fixed-shape tempo, float-jog overshoot) and ship a quality run longer than
  // the week's long on short-race plans (round-2 CRITICAL). No-op when the spec
  // already fits (David byte-for-byte same).
  workoutSpec = capSpecToDistance(workoutSpec, d.distanceMi);
  // PROGRESSION-PERSIST-1 (2026-08-17) · carry the trajectory's decision into
  // the row. Without this the shape died here and the adaptation model's "hold
  // the current stimulus" had nothing to hold — see lib/plan/progression-spec.ts.
  // Attached AFTER the distance cap so the block describes the session actually
  // prescribed: `capSpecToDistance` can trim a rep, and a block disagreeing with
  // the spec beside it would be the same drift in a new field.
  if (workoutSpec && d.workShape) {
    workoutSpec = {
      ...workoutSpec,
      ...progressionSpecFields({
        shape: d.workShape,
        lever: d.progressionLever ?? null,
        zone: d.challengeZone ?? null,
        repsOverride: Number((workoutSpec as Record<string, unknown>).rep_count ?? 0) || null,
      }),
    };
  }
  // 2026-06-02 · distance_mi reflects the TOTAL run · WU + core + floats + CD ·
  // so the headline number matches the breakdown. Was: stored just the core
  // (e.g. "4×1 mi @ T" → 4.0) while the sub_label said "2 mi WU · 4 mi @ T ·
  // 2 mi CD" (= 8 mi). The runner's math didn't tie. See
  // spec-builder.totalDistanceMiFromSpec for the inclusion rules.
  const totalDistanceMi = totalDistanceMiFromSpec(workoutSpec, d.distanceMi);
  // 2026-06-03 · iPhone agent Tier 2.d brief · sub_label derived from the spec
  // instead of the rx template string. The spec is the authored truth · deriving
  // sub_label from it means the chip title and the spec can never drift. Falls
  // back to d.subLabel when the spec is null (rest/cross/strength).
  const derivedSubLabel = subLabelFromSpec(workoutSpec) ?? d.subLabel;
  return {
    type: sealed?.type ?? d.type,
    distanceMi: sealed?.distance_mi ?? totalDistanceMi,
    paceTargetSPerMi: sealed?.pace_target_s_per_mi ?? paceTargetSPerMi,
    // A sealed spec came out of a prior `persistPlan`, so it IS one of these;
    // `SealedPrescription` types the column as `unknown` because it reads it
    // back out of jsonb.
    workoutSpec: (sealed?.workout_spec as ReturnType<typeof buildWorkoutSpec>['spec']) ?? workoutSpec,
    isQuality: sealed?.is_quality ?? d.isQuality,
    isLong: sealed?.is_long ?? d.isLong,
    // notes coalesce '' · the column is NOT NULL (persona-suite catch).
    notes: (sealed?.notes ?? d.notes) ?? '',
    subLabel: sealed?.sub_label ?? derivedSubLabel,
    sealed: sealed != null,
  };
}

/**
 * `plan_weeks.is_peak` and `plan_weeks.is_cutback`, per week.
 *
 * Extracted from `persistPlan` 2026-08-24 so the rule can be driven without a
 * database. Both columns are DISPLAY facts — the Block screen's week flag and
 * the block chart read them — and neither is re-derivable by a reader, which
 * is why they are written rather than computed at read time.
 *
 *   is_peak     the highest-mileage non-race week; first occurrence wins, so a
 *               block that ties its peak twice marks the earlier one.
 *   is_cutback  a drop of more than 15% off the week before.
 *
 * TAPER-NOT-CUTBACK-1 (2026-08-24) · `is_cutback` now excludes TAPER weeks as
 * well as race week. A taper week always drops more than 15% — by design, that
 * IS the taper — so every taper week was landing in the column, and the Block
 * screen checks cutback BEFORE the phase name. A runner scanning their block
 * for where the taper starts saw "Cutback" on the taper weeks and
 * "RACE-SPECIFIC" on the week before it. Live on both production plans that
 * had reached a taper on 2026-08-24: three weeks between them, all
 * mislabelled.
 *
 * The app already said this out loud in the one place it was asked:
 * `proposeChange('cutback')` refuses a taper week with "The taper is already a
 * cutback, and cutting it again would leave you flat on race day." A cutback is
 * a deload inserted INTO a build to absorb the ramp; the taper is the block's
 * ending. Race week was excluded here for that reason and the taper is the
 * rest of it.
 */
export function planWeekFlags(
  weeks: Array<{ isRaceWeek: boolean; phase: string; days: Array<{ distanceMi: number }> }>,
): { isPeakByWeek: boolean[]; isCutbackByWeek: boolean[]; weeklyMiles: number[] } {
  const weeklyMiles = weeks.map((w) => w.days.reduce((s, d) => s + d.distanceMi, 0));
  const maxMi = Math.max(...weeklyMiles.filter((_, i) => !weeks[i].isRaceWeek), 0);
  let peakMarked = false;
  const isPeakByWeek = weeklyMiles.map((mi, i) => {
    if (!weeks[i].isRaceWeek && mi === maxMi && !peakMarked) {
      peakMarked = true;
      return true;
    }
    return false;
  });
  const isCutbackByWeek = weeklyMiles.map((mi, i) =>
    i > 0
    && !weeks[i].isRaceWeek
    && weeks[i].phase !== 'TAPER'
    && mi < weeklyMiles[i - 1] * 0.85,
  );
  return { isPeakByWeek, isCutbackByWeek, weeklyMiles };
}

async function persistPlan(client: PoolClient, args: {
  userId: string; raceSlug: string | null; raceDateISO: string;
  blocks: BlockPlan; weeks: Array<{ startISO: string; phase: string; days: DayPlan[]; isRaceWeek: boolean; tPaceSec?: number | null; blockWeekIdx?: number }>;
  authoredState: Record<string, unknown>;
  /** Runner's T-pace (s/mi) at generate-time. Used to populate every
   *  quality workout's pace_target_s_per_mi + workout_spec at insert ·
   *  no more null columns waiting for a backfill cron. 2026-06-01. */
  tPaceSec: number | null;
  /** Runner's LTHR for spec HR caps. Optional · spec falls back to
   *  pace-only when missing. */
  lthr: number | null;
  /** 2026-06-03 · Rule 16 · maxHR for the easy/long HR cap doctrine
   *  (max of 89% LTHR + 78% maxHR). Optional · null falls back to
   *  LTHR-only. Resolved via loadEffectiveMaxHr at the entry point. */
  maxHr: number | null;
  /** 2026-06-09 state-audit fix · the runner's GOAL pace (s/mi) for
   *  the race-day row. Race day was inheriting T-pace (goal − 5 for an
   *  HM) · a 66s over-commitment at the gun. Null when the race has no
   *  goal time · spec-builder falls back to an inverse-offset
   *  derivation from T. */
  goalPaceSec: number | null;
  /** 2026-06-23 · PACE-E-1 · current-fitness T-pace anchor for EASY/long/recovery bands. Those are
   *  EFFORT runs and must track CURRENT fitness, not the goal-blended weekT — otherwise a sub-fitness
   *  goal makes "easy" ramp faster every week (cold-start: easy can pass current MP). null → falls
   *  back to weekT (byte-identical; at-goal runners have easyAnchorT == weekT). */
  easyAnchorTSec: number | null;
  /** 2026-06-15 · R3 · use true Daniels I-pace (≈ current 5K race pace, from
   *  iPaceFromVdot) for intervals on a 5K/10K race goal — where VO2 at race
   *  pace IS the point — instead of spec-builder's tPaceSec-18 cruise default
   *  (which lands near threshold for a low-VDOT runner). Half/marathon keep the
   *  conservative cruise default. Per-week I-pace ramps with the week's T. */
  goalIPaceEligible: boolean;
  /** 2026-06-03 · Rule 15 · Seal completed days against retroactive
   *  mutation. Snapshotted BEFORE clearActivePlansFor archives the
   *  prior plan; applied during INSERT so the new plan's row for a
   *  completed date inherits the prior prescription.
   *  2026-06-09 · M-19 · passed as a parameter (was module-scoped
   *  state shared between generatePlan and persistPlan). */
  sealedSnapshot: Map<string, SealedPrescription>;
  /** 2026-07-07 · AUDIT P1-56 · when bestRecentVdot is null and the runner's
   *  best race/run implied a below-table VDOT, this carries the honest
   *  anchor so race_week_tuneup/goal-I-eligible quality days can derive
   *  I-pace via iPaceFromAnchorPace (Riegel) instead of
   *  iPaceFromVdot(vdotFromTpace(weekT)) — vdotFromTpace's own binary search
   *  is bounded [30,85], so a below-table weekT silently clamps UP to
   *  VDOT-30 I-pace otherwise, re-introducing the "faster than demonstrated
   *  pace" bug one level down from the T-pace fix. Null for every runner
   *  with a measured VDOT (the vast majority) — byte-identical then. */
  belowTableAnchor?: BelowTableAnchor | null;
  /** WEEK-ALIGN-1 (2026-08-24) · the runner's FIRST day. Week 0 is composed
   *  from the training-week boundary so it lines up with the window every
   *  read surface uses, which puts up to six composed days before the day the
   *  runner actually signed up. Those days are not written.
   *
   *  Null on the lifecycle-regen path, which re-authors the current week
   *  whole on purpose — Rule 15 re-seals the days already run from the prior
   *  plan, and dropping them would erase the prescriptions the runner trained
   *  against. See `requestedBlockStartISO`. */
  clipBeforeISO: string | null;
}): Promise<string> {
  const planId = id('pln');
  await client.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, race_id, goal_iso, authored_state)
     VALUES ($1, 'me', $2, 'race-prep', $3, $4, $5)`,
    [planId, args.userId, args.raceSlug, args.raceDateISO, args.authoredState]
  );

  // Phases (need ids upfront so weeks can reference)
  // 2026-06-09 · M-19 · one multi-row INSERT (was one statement per
  // phase) · fewer round-trips inside the rebuild transaction.
  const phaseIds: string[] = [];
  {
    const params: unknown[] = [];
    const tuples: string[] = [];
    let cursor = 0;
    for (const ph of args.blocks.phases) {
      const phaseId = id('phs');
      phaseIds.push(phaseId);
      const b = params.length;
      tuples.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
      params.push(phaseId, planId, ph.label, cursor, cursor + ph.weeks - 1, ph.rationale, ph.citation);
      cursor += ph.weeks;
    }
    if (tuples.length > 0) {
      await client.query(
        `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
         VALUES ${tuples.join(', ')}`,
        params
      );
    }
  }

  // Map weekIdx → phaseId
  const phaseForWeek = (idx: number): string => {
    let c = 0;
    for (let i = 0; i < args.blocks.phases.length; i++) {
      const ph = args.blocks.phases[i];
      if (idx >= c && idx < c + ph.weeks) return phaseIds[i];
      c += ph.weeks;
    }
    return phaseIds[phaseIds.length - 1];
  };

  // 2026-06-09 · M-19 · collect week + workout rows, then flush as
  // multi-row VALUES inserts (weeks in one statement, workouts in
  // chunks of 50). Was one pool.query per row — ~16 + ~80-100 separate
  // statements inside the rebuild, each a round-trip. Day-level logic
  // below is unchanged; only the write is deferred.
  const weekRows: unknown[][] = [];
  const workoutRows: unknown[][] = [];

  const { isPeakByWeek, isCutbackByWeek } = planWeekFlags(args.weeks);

  for (let wi = 0; wi < args.weeks.length; wi++) {
    const w = args.weeks[wi];
    const weekId = id('wk');
    // 2026-06-10 · derive each day's date as an offset from the week's
    // actual start weekday (not a hardcoded Monday). For Monday-anchored
    // plans (default · David + lifecycle regens) this is identical to the
    // old `(dow - 1 + 7) % 7`. For onboarding's today-anchored plans the
    // week can start any weekday, and this keeps a Sunday long run on
    // Sunday instead of scattering it.
    const weekStartDow = new Date(w.startISO + 'T12:00:00Z').getUTCDay();
    const dateForDow = (dow: number) => addDays(w.startISO, ((dow - weekStartDow + 7) % 7));
    weekRows.push(
      // `blockWeekIdx` where the composer stated one — a mid-recovery block
      // emits only the remaining weeks, so its array position is not its
      // number. Everything else numbers itself by position, as before.
      [weekId, planId, w.blockWeekIdx ?? wi, w.startISO, phaseForWeek(wi), w.isRaceWeek,
       `${w.phase} · week ${(w.blockWeekIdx ?? wi) + 1}`, isPeakByWeek[wi], isCutbackByWeek[wi]]
    );

    for (const d of w.days) {
      if (d.distanceMi === 0 && d.type !== 'rest' && d.type !== 'race') continue;
      const dateISO = dateForDow(d.dow);
      // WEEK-ALIGN-1 · a day before the runner's first day is a day that is
      // not theirs. Week 0 is authored from the training-week boundary so the
      // week reads back whole; the part of it that predates them is dropped
      // here rather than shown as already missed.
      if (args.clipBeforeISO && dateISO < args.clipBeforeISO) continue;
      const wkoId = id('wko');
      // 2026-06-01 · derive pace_target + workout_spec at insert time
      // (web agent gap brief). Was leaving both NULL waiting on the
      // backfill cron · now every freshly-generated quality row
      // carries its target pace + structured spec from day one.
      // Reuses lib/plan/spec-builder.ts (single source of truth ·
      // backfill cron uses the same helper).
      // 2026-06-03 · Rule 3 · use the week's blended T-pace if set
      // (composePlan computes per-week tPaceSec from bestRecentVdot ramp);
      // fall back to plan-wide goal-T. Plain assignment from week's own
      // tPaceSec (set on every ComposedWeek by composePlan).
      const weekT = (w as { tPaceSec?: number | null }).tPaceSec ?? args.tPaceSec;
      // 2026-06-03 · Rule 15 · seal completed days. If the prior
      // active plan had a row for this date AND a completed run
      // exists, OVERRIDE the freshly-composed prescription with the
      // prior's. The runner trained against the prior prescription ·
      // changing it after-the-fact would make every retro lie.
      const sealed = args.sealedSnapshot.get(dateISO);
      // The spec derivation, the distance cap, the progression block, the
      // spec-summed total and the spec-derived sub_label all live in
      // `persistedDayShape` (extracted 2026-08-24, byte-identical) so the
      // onboarding sweep can drive this hop without a database.
      const row = persistedDayShape(d, weekT, args, sealed);
      if (sealed) {
        logSealSkip('persistPlan/rebuild', args.userId, dateISO);
      }
      // dow stored as 1=Mon..7=Sun in our convention? Use what plan_workouts expects.
      // We pass dow 0..6 (Sun..Sat). Existing reader treats numeric dow + sub_label.
      workoutRows.push(
        [wkoId, planId, weekId, dateISO, d.dow, row.type, row.distanceMi,
         row.paceTargetSPerMi, row.workoutSpec ? JSON.stringify(row.workoutSpec) : null,
         row.isQuality, row.isLong, row.notes, row.subLabel]
      );
    }

    // 2026-08-17 · strength companion rows removed (owner ruling: strength is
    // handled outside the app). Data and HealthKit ingest untouched;
    // _no_strength_rows.test.ts fails the build if a writer reappears.
  }

  if (weekRows.length > 0) {
    const params: unknown[] = [];
    const tuples = weekRows.map((row) => {
      const b = params.length;
      params.push(...row);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
    });
    await client.query(
      `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, is_race_week, rationale, is_peak, is_cutback)
       VALUES ${tuples.join(', ')}`,
      params
    );
  }

  // 13 bound params per row · the original_* columns reuse the row's own
  // placeholders ($b+4 date, $b+6 type, $b+7 distance, $b+13 sub_label)
  // exactly like the old single-row statement reused $4/$6/$7/$13.
  const WORKOUT_CHUNK = 50;
  for (let i = 0; i < workoutRows.length; i += WORKOUT_CHUNK) {
    const chunk = workoutRows.slice(i, i + WORKOUT_CHUNK);
    // $1 is the shared user_uuid for every row in the chunk; per-row params
    // start at $2, so each row's base offset is params.length at push time.
    const params: unknown[] = [args.userId];
    const tuples = chunk.map((row) => {
      const b = params.length;
      params.push(...row);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, ` +
        `$${b + 8}, $${b + 9}::jsonb, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, ` +
        `$${b + 4}, $${b + 6}, $${b + 7}, $${b + 13}, $1)`;
    });
    await client.query(
      `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                  pace_target_s_per_mi, workout_spec,
                                  is_quality, is_long, notes, sub_label,
                                  original_date_iso, original_type, original_distance_mi, original_sub_label, user_uuid)
       VALUES ${tuples.join(', ')}`,
      params
    );
  }

  return planId;
}

// ── Main entrypoint ─────────────────────────────────────────────────────

/**
 * WKRAMP-REC-1 (2026-08-25) · the whole-block ceiling a reverse taper is graded
 * against, or null for every other block.
 *
 * Reads `authored_state.reverse_taper.block_ceiling_mi`, which only
 * `composeRecoveryPlan` writes. Deliberately defensive about the shape: an
 * older persisted block re-finalized through this path carries no
 * `reverse_taper` key at all, and a block with no peak anchor publishes a null
 * ceiling on purpose. Both answer null, which restores the ordinary
 * week-over-week rule rather than trimming a week to zero.
 */
export function reverseTaperCeilingMi(composed: ComposePlanResult): number | null {
  const st = composed.authoredState as Record<string, unknown> | undefined;
  if (!st || st['mode'] !== 'recovery') return null;
  const rt = st['reverse_taper'];
  if (!rt || typeof rt !== 'object') return null;
  const mi = (rt as Record<string, unknown>)['block_ceiling_mi'];
  return typeof mi === 'number' && Number.isFinite(mi) && mi > 0 ? mi : null;
}

/**
 * Post-composition finalize · pure, mutates `composed` in place. Applies the
 * refinements that sit between composePlan and validateComposedPlan: the
 * long-run WoW smoother, the taper rescale, a second WoW smooth, and the final
 * easy≤long invariant sweep. Extracted (2026-06-22) so generatePlan and the
 * plan simulator (/api/plan/simulate) run the IDENTICAL post-processing and can
 * never drift. No DB, no clock. Behavior-preserving lift of the former inline
 * block — asserted byte-stable by the plan test suite.
 */
export function finalizeComposedPlan(composed: ComposePlanResult, raceDistanceMi: number, level: LevelKey = null): void {
  // Long-run WoW smoother · clamp each training long to ≤ prev × 1.30
  // (rounded down to 0.5mi), trimming the week total to match. Defined as a
  // function so it can be RE-APPLIED after the taper rescale below — the
  // rescale shrinks one taper week's long without touching the next, which
  // can re-introduce the very >30% jump this smoother exists to prevent
  // (workflow CRITICAL · marathon got zero plans on a ~17-week runway).
  const smoothLongWoW = () => {
    let prevLong = 0;
    for (const week of composed.weeks) {
      const day = week.days.find((d) => d.isLong && d.type !== 'race' && d.distanceMi > 0);
      if (!day) continue;
      if (prevLong > 0) {
        const ceil = Math.floor(prevLong * 1.30 * 2) / 2;
        if (day.distanceMi > ceil) {
          const trim = day.distanceMi - ceil;
          day.distanceMi = ceil;
          week.weeklyMi = Math.max(0, Math.round((week.weeklyMi - trim) * 10) / 10);
        }
      }
      prevLong = day.distanceMi;
    }
  };
  smoothLongWoW();

  // (Progressive taper enforcement moved BELOW the VOL-1 reconcile — it must see each week's
  // REALIZED day-sum, not the volume-curve budget · COH-4.)

  // 2026-06-21 · re-smooth long-run WoW AFTER the taper rescale. The rescale
  // can shrink a taper week's long below its predecessor's-÷1.30 floor while
  // leaving the next taper week untouched, re-creating an illegal jump. The
  // smoother only ever trims DOWN, so it converges and never undoes the
  // taper drop. Belt-and-suspenders with the no-floor-in-taper fix above.
  smoothLongWoW();

  // 2026-06-20 · FINAL easy≤long invariant sweep. The long-smoothing and
  // taper rescale above can trim the long run AFTER layoutWeek already
  // clamped easy days to the (then larger) long — re-introducing the
  // inversion (easy ends up 0.5mi over a trimmed long on cutback / taper
  // weeks · caught by the full audit matrix). Re-cap every easy day at its
  // week's training long so the long is always the longest run, trimming
  // the week total to match. Race-day rows are skipped (not training longs).
  for (const w of composed.weeks) {
    // Longest run of the week INCLUDING the race day — in a short-race
    // (5K/10K) race week the race itself is the longest run, so an easy
    // shakeout must not exceed it either.
    const longMi = Math.max(0, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi));
    if (longMi <= 0) continue;
    for (const d of w.days) {
      // 2026-06-21 · re-cap EASY *and* QUALITY at the (possibly trimmed) long.
      // layoutWeek clamps them at compose time, but the WoW smoother + taper rescale
      // above trim the long afterward, so a session sized to the original long can
      // re-exceed the trimmed long. 2026-06-23 · RP-5 · easy is held STRICTLY below the
      // long (~0.8×) so the long stays visibly the longest run; quality may reach it.
      // Race day exempt (longest by design in a short race).
      const cap = d.type === 'easy' ? Math.max(1, Math.min(longMi - 1, Math.round(0.8 * longMi))) : longMi;
      if ((d.type === 'easy' || (d.isQuality && d.type !== 'race')) && !d.isLong && d.distanceMi > cap) {
        w.weeklyMi = Math.max(0, Math.round((w.weeklyMi - (d.distanceMi - cap)) * 10) / 10);
        d.distanceMi = cap;
      }
    }
  }

  // 2026-06-23 · VOL-1 · reconcile EVERY week's reported weeklyMi to the ACTUAL
  // scheduled day-sum (race day excluded — it is the event, not training mileage).
  // Until now weeklyMi carried the volume-curve BUDGET, but the per-day caps (long cap,
  // easy≤long clamp, frequency cap) silently drop whatever the budget can't place — so
  // a low-frequency plan advertised 40mi while the days summed to 24 (~40% phantom).
  // The validator validated the lie and the UI rendered it. Make weeklyMi == realized
  // so the reported number can never exceed the plan AND the taper-drop check sees the
  // race week's true (small) taper volume, not its phantom budget — otherwise a
  // reconciled peak can fall below the un-reconciled race-week budget and false-fail.
  // MIDRACE-1 (2026-08-17) · the race-mile exclusion applies to the plan's
  // OWN race week only (the event the block builds to). An embedded mid-block
  // tune-up race IS training-load mileage for its week — excluding it would
  // re-open the phantom-volume gap in the other direction (a 13.1-mile raced
  // Sunday reported as a 20mi week missing 13 miles). Plans without embedded
  // races have no race-typed day outside the race week → byte-identical.
  for (const w of composed.weeks) {
    w.weeklyMi = Math.round(w.days.reduce((s, d) => s + ((d.type !== 'race' || !w.isRaceWeek) ? d.distanceMi : 0), 0) * 10) / 10;
  }

  // MIDRACE-RAMP-1 (2026-08-17) · the ramp ceiling, on the week after a tune-up.
  // Runs on the REALIZED volumes VOL-1 just wrote (see the function's own
  // "where it runs" note) and BEFORE the taper pass, so the taper descends from
  // the corrected peak. No embedded races → no-op, byte-identical.
  {
    const embedded = ((composed.authoredState as Record<string, unknown> | undefined)
      ?.embedded_races ?? []) as EmbeddedRaceSummary[];
    if (Array.isArray(embedded) && embedded.length > 0) {
      enforceRampCeilingAfterEmbedding(composed.weeks, composed.vols, level, embedded);
    }
  }

  // WKRAMP-1 (2026-08-19) · the general ramp ceiling, on every week's REALIZED
  // volume. MIDRACE-RAMP-1 above is the same rule scoped to the week after a
  // tune-up; this is the block-wide case the generator never enforced, which is
  // how a beginner marathoner was authored a 44% week-over-week step. Runs on
  // the numbers VOL-1 just wrote and before the taper pass, so the taper
  // descends from the corrected peak. See the function's own note.
  //
  // WKRAMP-REC-1 (2026-08-25) · a post-race reverse taper is graded against the
  // PRE-RACE PEAK it is unwinding, not against its own deload weeks. Only
  // `composeRecoveryPlan` publishes that ceiling, so every other composer
  // passes null here and is byte-identical.
  enforceWeeklyRampCeiling(composed.weeks, composed.vols, level, reverseTaperCeilingMi(composed));

  // 2026-06-23 · COH-4 · PROGRESSIVE taper enforcement, AFTER VOL-1 so it sees each week's REALIZED
  // day-sum. The race week's pre-race easy volume often EXCEEDS the volume-curve budget (the layout
  // places easy days the budget didn't account for), so running this on the budget missed it and
  // left the race week ABOVE the preceding taper week (non-monotonic). Cap each taper week at BOTH
  // its doctrine factor AND the prior taper week (strict monotonic descent); scaling all non-race
  // days preserves easy<long.
  // DOCTRINE-1 (2026-08-17) · the factor is per-distance (Research/08 §9.1) and comes from the SAME
  // shared model volumeCurve uses. It was a hardcoded marathon 0.82/0.60/0.45 here as well, so the
  // two sites could — and did — encode the same doctrine twice and generalise the same wrong row.
  const nonTaperPeakR = Math.max(0, ...composed.weeks.filter((w) => w.phase !== 'TAPER' && !w.isRaceWeek).map((w) => w.weeklyMi ?? 0));
  if (nonTaperPeakR > 0) {
    const taperCat = distanceCategoryOf(raceDistanceMi);
    const taperWeeks = composed.weeks.filter((w) => w.phase === 'TAPER');
    let priorTaper = Infinity;
    for (let i = 0; i < taperWeeks.length; i++) {
      const tw = taperWeeks[i];
      const wksLeft = taperWeeks.length - i;
      const factor = taperFactor(taperCat, wksLeft);
      const target = Math.min(tw.weeklyMi, nonTaperPeakR * factor, priorTaper);
      if (tw.weeklyMi > 0 && target < tw.weeklyMi - 0.05) {
        // DOCTRINE-TAPERMP-1 (2026-08-17) · Research/08 §9.1: "The largest cut
        // is to easy mileage; intensity is preserved through the taper."
        //
        // A flat proportional scale cuts the quality session by the same
        // fraction as the easy days, which is the opposite of that rule — and
        // for the MP session it also breaks the label: the day's sub_label
        // spells out "2.5 mi WU · 11 mi @ MP · 1.5 mi CD", so shaving the day
        // to 14.5 mi leaves a prescription whose own segments no longer sum to
        // it. That is the composed-vs-persisted drift CC-1 fixed for the
        // race-week tune-up, in the other direction.
        //
        // So hold the MP session and take the whole cut out of the rest. The
        // guard is deliberately narrow — a non-long quality day whose
        // prescription declares an MP block, which only DOCTRINE-TAPERMP-1
        // authors — so every plan that existed before this pass scales exactly
        // as it did. When the week is too small to hold the session and still
        // reach its target, the flat scale takes over rather than shipping a
        // taper week that refuses to descend.
        const heldMi = tw.days.filter(isMpTaperSession).reduce((s, d) => s + d.distanceMi, 0);
        const scalableMi = tw.weeklyMi - heldMi;
        const heldScale = scalableMi > 0 ? (target - heldMi) / scalableMi : 0;
        // The long run must stay the longest run of the week. Holding the MP
        // session while the long absorbs the whole cut can invert that on a
        // small-volume marathoner (the sweep catches it as "tempo exceeds the
        // long"), so intensity is only preserved while the week can still
        // afford BOTH. Otherwise the flat scale takes over and the session
        // shrinks with everything else — the label is re-sized to match below.
        const longMi = Math.max(0, ...tw.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi));
        const holds = heldMi > 0 && scalableMi > 0 && target - heldMi > 0
          && Math.floor(longMi * heldScale * 2) / 2 >= heldMi;
        const scale = holds ? heldScale : target / tw.weeklyMi;
        for (const d of tw.days) {
          if (holds && isMpTaperSession(d)) continue;
          if (d.type !== 'race' && d.distanceMi > 0) d.distanceMi = Math.floor(d.distanceMi * scale * 2) / 2;
        }
        tw.weeklyMi = Math.round(tw.days.reduce((s, d) => s + (d.type !== 'race' ? d.distanceMi : 0), 0) * 10) / 10;
      } else if (!tw.isRaceWeek && tw.weeklyMi > 0) {
        // DOCTRINE-1c (2026-08-17) · THE TAPER RESCALE IS NOW SYMMETRIC.
        //
        // This pass only ever scaled taper weeks DOWN, so it enforced one end of
        // the doctrine band and left the other open — the same one-sidedness the
        // validator had. It mattered because the taper's depth is authored off
        // the volume-curve BUDGET peak while everything downstream measures the
        // REALIZED peak, and the two diverge whenever layoutWeek's floors (the
        // recent-long floor, the easy-day median floor) lift realized volume
        // above budget. A 10K beginner reporting 30 mi/wk peaked at a realized
        // 32 and tapered to 17 — a 47% cut where Research/08 §9.1 allows 30-40%.
        // The plan over-tapered, and nothing looked at it.
        //
        // Lifting back toward the doctrine target scales every non-race day
        // proportionally, so easy<long and the day shape are preserved, and the
        // result is still bounded by `priorTaper` (monotonic descent) and by the
        // realized peak. The long-run WoW smoother re-runs after this block.
        //
        // DEADBAND: only acts when the week sits more than 12% below its target.
        // Ordinary rounding and reconciliation land far inside that, so healthy
        // plans — David's marathon among them — are byte-identical.
        const doctrineTarget = Math.min(nonTaperPeakR * factor, priorTaper);
        if (doctrineTarget > tw.weeklyMi * 1.12) {
          // The restored miles go to the EASY days, never the long run. Two
          // reasons, and they agree: Research/08 §9.1's own taper rules say
          // "the largest cut is to easy mileage", so easy mileage is what a
          // too-deep taper has over-cut; and the long is the one day bounded by
          // the long-run WoW smoother, which has already run by this point —
          // growing it here re-opens the >30% week-over-week jump that smoother
          // exists to close (it did, on 51 ultra/marathon archetypes, before
          // this was scoped to easy days).
          const longMi = tw.days
            .filter((d) => d.isLong && d.type !== 'race')
            .reduce((sum, d) => sum + d.distanceMi, 0);
          const longestMi = Math.max(0, ...tw.days.filter((d) => d.type !== 'race').map((d) => d.distanceMi));
          const otherMi = tw.weeklyMi - longMi;
          const wantOther = doctrineTarget - longMi;
          if (otherMi > 0 && wantOther > otherMi) {
            const scale = wantOther / otherMi;
            for (const d of tw.days) {
              if (d.type === 'race' || d.isLong || d.distanceMi <= 0) continue;
              // easy never exceeds the week's longest run (layoutWeek's invariant).
              d.distanceMi = Math.min(longestMi, Math.floor(d.distanceMi * scale * 2) / 2);
            }
            tw.weeklyMi = Math.round(tw.days.reduce((sum, d) => sum + (d.type !== 'race' ? d.distanceMi : 0), 0) * 10) / 10;
          }
        }
      }
      priorTaper = tw.weeklyMi;
    }
  }

  // DOCTRINE-TAPERMP-1 · re-sync the taper MP session's label to its distance.
  // Several passes above may trim a day (the quality≤long re-cap, the taper
  // rescale's flat-scale fallback), and this session is the only one in the
  // plan whose sub_label spells out its own segment arithmetic — "2 mi WU · 7
  // mi @ MP · 1 mi CD" — so a trim that left the label alone would ship a
  // prescription that does not add up to the day it is printed on. Runs after
  // every trimmer for exactly that reason.
  for (const w of composed.weeks) {
    for (const d of w.days) {
      if (isMpTaperSession(d)) resizeMpSession(d, d.distanceMi);
    }
  }

  // DOCTRINE-DOSING-2 (2026-08-18) · Daniels' dosing caps, reconciled after
  // every pass that moved mileage. Runs BEFORE the intensity floor: it only
  // ever converts hard miles to easy ones, so it can lift a week's easy share
  // but never lower it, and the floor pass gets the last word on that number.
  applyDosingCaps(composed);

  // DOCTRINE-TID-1 (2026-08-17) · the 80/20 constraint, which the engine has
  // never had in any form. Runs LAST, because every pass above moves mileage.
  applyIntensityFloor(composed);

  /* ── VOL-2 (2026-08-19) · authored_state agrees with the plan ──────────────
   *
   * VOL-1 above reconciles every week's `weeklyMi` to its realized day-sum, and
   * MAINT-WEEKLYML-1 re-snapshots `vols` from it. The SCALARS in
   * `authored_state` were never reconciled to anything, so the audit surface
   * and the plan disagreed: `qa-race-…` was stored with
   * `target_weekly_mi = 14` against a block whose days summed to 10, and
   * `target_long_mi = 4` is written from the same pre-finalize arithmetic.
   * Those two numbers are the only record of what the engine INTENDED, so a
   * stale one makes every later "did the plan drift?" read start from fiction.
   *
   * Reconciled per mode, because the scalar means a different week in each:
   *   · maintenance · the block's non-cutback week → the realized MAX.
   *   · recovery    · the reverse taper's opening week → week 0's realized.
   * `composePlan` writes neither key, so its authored_state is untouched.
   *
   * Runs dead last, after every pass that can move a mile. `vols` is
   * re-snapshotted here too, so a caller that forgets to do it cannot ship a
   * plan whose `vols` disagree with its own weeks (generatePlan does it
   * separately today; this makes the guarantee the function's, not the
   * caller's). */
  {
    const st = composed.authoredState as Record<string, unknown> | undefined;
    composed.vols = composed.weeks.map((w) => w.weeklyMi);
    if (st != null) {
      const realizedLong = Math.max(0, ...composed.weeks.flatMap(
        (w) => w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)));
      if (typeof st.target_weekly_mi === 'number') {
        st.target_weekly_mi = st.mode === 'recovery'
          ? (composed.weeks[0]?.weeklyMi ?? 0)
          : Math.max(0, ...composed.weeks.map((w) => w.weeklyMi));
      }
      // 0 is a real answer, not a missing one: the cold-start ladder authors no
      // long run at all (Research/22 §8 · a day-one runner has no long), and
      // leaving the pre-finalize scalar behind reported a 4 mi long over a week
      // of three 0.6 mi run/walks.
      if (typeof st.target_long_mi === 'number') st.target_long_mi = realizedLong;
    }
  }
}

/**
 * DOCTRINE-DOSING-2 (2026-08-18) · hold every week inside Daniels' dosing caps.
 *
 * `Research/01-pace-zones-vdot.md` §"Dosing rules — Daniels' caps" bounds how
 * much of a week may be run at each quality pace. `layoutWeek` now sizes every
 * session against that budget as it authors — see `slotBudgetMi` — so this pass
 * exists for the two things authoring cannot settle on its own:
 *
 *  1. THE DENOMINATOR MOVES. The caps are percentages of weekly mileage, and
 *     `weeklyMi` at layout time is the volume-curve BUDGET. VOL-1 later
 *     reconciles it to the realized day-sum, the taper rescale cuts it again,
 *     and the long-run WoW smoother trims a long the week was measured against.
 *     A session sized to ten percent of the budget can be eleven percent of what
 *     the week turns out to be.
 *  2. THE ORDER OF GIVE-BACK IS A DOCTRINE QUESTION, not an authoring one. The
 *     long run's race-pace finish is authored before the structured slots, so
 *     charging it first would shrink the phase's own race-specific session to
 *     protect a segment `Research/04` §4.5 schedules "Every 2-3 weeks" against
 *     one scheduled weekly. Reconciling afterwards lets the surplus be decided
 *     by doctrine rather than by which pass ran first.
 *
 * ── The give-back order, and why ───────────────────────────────────────────
 *
 * The finish goes first. That is `applyIntensityFloor`'s existing ruling, in
 * its own words — "The long-run finish is therefore the SURPLUS hard mileage in
 * an over-dense week, and it is what this pass gives back first" — resting on
 * §4.4's "every 2-3 weeks" cadence and §16's "MP long run + hard tempo within 5
 * days". Only when the finish is gone does a structured session come down, and
 * then by REP COUNT before block length, because §5.3's cruise intervals and
 * §6.2's mile repeats are defined by their rep length and doctrine's own
 * affordability cut (`sizeFromPrescription`) takes reps off first.
 *
 * ── What it may not move ───────────────────────────────────────────────────
 *
 * Nothing structural. The correction converts hard miles to easy miles INSIDE
 * THE SAME DAY: day count, day distances, placement, weekly totals and the long
 * run's length are all byte-identical afterwards. That is the same constraint
 * `applyIntensityFloor` accepted, for the same reason — it is the only lever
 * that cannot disturb the invariants the sweep gates hold — and it is also what
 * makes this pass converge in one sweep: the denominator it measures against
 * cannot move while it is trimming.
 *
 * ── Which caps ─────────────────────────────────────────────────────────────
 *
 * Whatever `capEnforced` says: absolute ceilings in every week, percentage caps
 * on training weeks only. A taper is a volume cut with intensity held
 * (`Research/08` §9.1) and §9.2 states its sessions by name at doses outside
 * the percentage; see `dosing.ts` for the arithmetic.
 */
function applyDosingCaps(composed: ComposePlanResult): void {
  for (const w of composed.weeks) {
    // Up to three sweeps: trimming one pace can reveal that another shares a
    // day (a long run doses M through its finish and nothing else, but a rep
    // set that shortens changes no other bucket), and a rep count is a coarse
    // lever that may overshoot its own target. Three is empirically past the
    // point where the corpus stops changing; the loop exits early when a sweep
    // finds nothing.
    for (let sweep = 0; sweep < 3; sweep++) {
      const findings = weekDosingFindings(w as never).filter((f) => f.enforced);
      if (findings.length === 0) break;
      let moved = false;
      for (const f of findings) {
        // Everything in the week that doses this pace, in give-back order.
        //
        // The long run's race-pace finish goes FIRST — but only where doctrine
        // treats it as surplus rather than as the week's scheduled stimulus, and
        // the phase is what tells them apart.
        //
        //  · In QUALITY, the finish is `longFinishSegment`'s warm-in ramp: it
        //    lands on each of the last three weeks of the phase at 30-33% of the
        //    long, beside two full structured sessions. That is the over-dense
        //    week `applyIntensityFloor` describes, and its ruling stands — "The
        //    long-run finish is therefore the SURPLUS hard mileage in an
        //    over-dense week, and it is what this pass gives back first."
        //  · In RACE-SPECIFIC, a finish only exists on the CADENCE weeks
        //    `Research/04` §4.4 and §4.5 both scheduled "Every 2-3 weeks"
        //    (`longFinishSegment` returns null otherwise). §4.4 calls it "the
        //    marathon-specific stimulus" and §15 lists "MP long runs" among the
        //    phase's primary workouts. Trimming it to protect a structured
        //    session would spend the phase's own named session to keep a weekly
        //    one — the give-back order backwards. So there it goes LAST, and the
        //    structured sessions come down first.
        //
        // `applyIntensityFloor`'s own comment makes exactly this distinction
        // ("right when the finish is on every week and wrong on the three where
        // doctrine put it on purpose"); this is that sentence, applied.
        const finishIsScheduled = String(w.phase ?? '') === 'RACE-SPECIFIC';
        const longRank = (d: DayPlan) => (d.isLong ? (finishIsScheduled ? -1 : 1) : 0);
        // GRAMMAR-SEQ-1 · a day can dose more than one pace. §13.2's ladder runs
        // its 400 at mile pace (R) and its other three rungs at 5K/10K (I), and
        // `weekDose` charges each rung to its own bucket — so a day is a
        // candidate for a finding when it doses THAT pace, not when its single
        // headline pace happens to match.
        //
        // Looking it up by `dosePaceOf` was the bug: that function returns the
        // TIGHTEST of a session's zones, so the ladder answered R, the I finding
        // found no candidate at all, and 2.23 mi at I shipped uncorrected on a
        // 17 mi/wk week. Byte-identical for every single-zone session, which is
        // every session the engine wrote before this.
        const doseAt = (d: DayPlan) =>
          dayDoses(d as never).filter((x) => x.pace === f.pace).reduce((a, x) => a + x.mi, 0);
        const candidates = w.days
          .filter((d) => d.type !== 'race' && doseAt(d) > 0)
          .sort((a, b) => longRank(b) - longRank(a) || doseAt(b) - doseAt(a));
        if (candidates.length === 0) continue;

        // `weekly` and `cumulative` are budgets for the whole week;
        // `single-workout` bounds one day. Either way the target is the same
        // arithmetic: how many hard miles at this pace must come out.
        // `overByMi` is rounded to two places and a finding only fires past a
        // tenth-of-a-mile tolerance, so the smallest breach that can reach here
        // reports exactly 0.05 over. Guarding at 0.05 would skip precisely
        // those — the marginal ones — and leave them to the gate. Anything
        // above zero is a breach worth a lever.
        let over = f.overByMi;
        for (const day of candidates) {
          if (over <= 0) break;
          // What the day doses AT THIS PACE, and what it doses in total. They
          // differ only on a multi-zone session; `trimSessionDose` works in
          // total hard miles, so the target is translated once here.
          const have = doseAt(day);
          if (have <= 0) continue;
          // A single-workout finding is only about days over the cap.
          if (f.scope === 'single-workout' && have <= f.capMi + 0.05) continue;
          const want = f.scope === 'single-workout'
            ? f.capMi
            : Math.max(0, have - over);
          const after = trimSessionDose(day, want, doseAt);
          if (after < have - 0.01) {
            over -= have - after;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }
}

/**
 * Cut one session's at-pace mileage to `targetMi`, rewriting the prescription
 * so the label and the spec still describe the same workout.
 *
 * Returns the at-pace mileage the session carries afterwards — which may be
 * more than asked for when doctrine leaves no lever: a rep set already down to
 * one repetition cannot shed more without becoming a different workout, and
 * shortening the repetition itself would change the session's identity (§5.3
 * and §6.2 both define their workout BY the rep length). The caller reports
 * what it could not fix rather than pretending otherwise.
 *
 * The day's own distance never changes. What was hard becomes easy inside the
 * same session — a shorter tempo inside the same total, fewer reps with a
 * longer warm-up and cool-down — which is what keeps every structural invariant
 * intact and what lets `applyDosingCaps` converge.
 */
function trimSessionDose(
  day: DayPlan,
  targetMi: number,
  /**
   * GRAMMAR-SEQ-1 · what quantity `targetMi` is expressed in.
   *
   * Defaults to the day's whole hard mileage, which is what every single-zone
   * session's dose is. A multi-zone session — §13.2's ladder runs its 400 at
   * mile pace and its other rungs at 5K/10K — is trimmed against ONE of its
   * buckets, and the caller passes that bucket's measure so the loop drives on
   * exactly the number the finding is about. Translating a per-pace target into
   * a whole-day one instead loses the difference inside the tolerance and stops
   * one step short.
   */
  measure: (d: DayPlan) => number = (d) => splitDay(d as never).qualityMi,
): number {
  const before = measure(day);
  if (before <= targetMi + 0.05) return before;
  const label = String(day.subLabel ?? '');

  // 1 · the long run's race-pace finish. `setLongFinish` owns sub_label and
  //     notes together — it is the only carrier of the finish between compose
  //     and persist.
  if (day.isLong && day.type === 'long') {
    setLongFinish(day, Math.max(0, Math.floor(targetMi * 2) / 2));
    return measure(day);
  }

  // 2 · an explicit three-segment prescription ("2 mi WU · 4 mi @ T · 2 mi CD").
  //     The block shrinks and the cool-down absorbs it, so the segments still
  //     sum to the day — the arithmetic DOCTRINE-TAPERMP-1 keeps honest.
  const seg = label.match(/^([\d.]+) mi WU · ([\d.]+) mi @ ([A-Za-z]+) · ([\d.]+) mi CD$/i);
  if (seg) {
    const wu = Number(seg[1]);
    const block = Number(seg[2]);
    const cd = Number(seg[4]);
    const want = Math.max(0.5, Math.floor(targetMi * 2) / 2);
    if (want < block) {
      day.subLabel = `${wu} mi WU · ${want} mi @ ${seg[3]} · ${Number((cd + block - want).toFixed(1))} mi CD`;
    }
    return measure(day);
  }

  // 2b · GRAMMAR-SEQ-1 · an unequal-step session. It has no leading rep count
  //      to rewrite, so it sheds its last step (see `dropLastSegment` for which
  //      end and why), one at a time, re-measuring against the same `splitDay`
  //      the gate will ask.
  //
  //      This lever is what lets a fixed-shape session survive the denominator
  //      moving. `layoutWeek` prices a sequence against the volume curve's
  //      BUDGET, and a low-frequency week realizes well under it — a 3-day 10K
  //      week budgeted at 50 mi composes to 34 once the long and the easy days
  //      hit their own ceilings. A rep set is cut back by `sizeFromPrescription`
  //      on the way through; a sequence cannot be, so §13.3's seven-rung pyramid
  //      shipped 3.98 mi at I on a 34 mi week — 11.7% against Daniels' 8%.
  if (parseSegments(label)) {
    let cur = label;
    let now = before;
    for (let guard = 0; guard < 16 && now > targetMi + 0.05; guard++) {
      const next = dropLastSegment(cur);
      if (next == null || !parseSegments(next)) break;
      cur = next;
      day.subLabel = cur;
      now = measure(day);
    }
    // SLOT-ROTATE-4 · the shedder runs out of moves at two rungs, and "no rungs
    // left to drop" is not "the week can afford what is left". A two-rung
    // remainder over the cap used to ship as the final answer — §13.1's ladder
    // at 1.74 mi at I on a 19.5 mi week, against Daniels' 1.56. One rung at its
    // stated length is a session; a labelled breach is not. See
    // `keepFirstSegment` for why the FIRST is the one kept.
    if (now > targetMi + 0.05) {
      const one = keepFirstSegment(cur);
      if (one != null) {
        const prev = day.subLabel;
        day.subLabel = one;
        const after = measure(day);
        // Only if it actually helps: a single rung of a long-first ladder is
        // smaller than two, but nothing here guarantees that for every shape
        // the grammar admits, and a change that does not reduce the breach is
        // a change that only costs the runner a rung.
        if (after < now) return after;
        day.subLabel = prev;
        now = measure(day);
      }
    }
    return now;
  }

  // 3 · a rep set the prescription opens the count of ("4×1mi @ T pace · 60s
  //     jog", "6×90s hills"). Reps come off before anything else — doctrine's
  //     own affordability cut does the same, and for the same reason: fewer
  //     reps of the stated length is still the stated workout.
  const reps = label.match(/^(\s*)(\d+)(\s*[×xX])/);
  if (reps) {
    let n = parseInt(reps[2], 10);
    let cur = label;
    let now = before;
    if (n > 1) {
      // Step the count down ONE at a time and re-measure, rather than dividing
      // the dose by the label's rep count.
      //
      // The two numbers are not always the same. `buildWorkoutSpec` caps a set
      // to what the day's mileage can hold once warm-up, jog floats and
      // cool-down are paid for, so a six-rep prescription on a five-mile day
      // builds four — and dividing by six models a per-rep cost 33% below the
      // real one, which cuts the label without moving the workout. Re-measuring
      // asks the same `splitDay` the gate asks, so what this function reports
      // is what the gate will see.
      while (n > 1 && now > targetMi + 0.05) {
        n--;
        cur = cur.replace(/^(\s*)\d+(\s*[×xX])/, `$1${n}$2`);
        day.subLabel = cur;
        now = measure(day);
      }
      if (now <= targetMi + 0.05) return now;
      // Down to a single repetition and still over: the levers below own it.
      // `cur` is now "1×…", which is what they match on.
    }
    // A ONE-rep time block is a continuous tempo, and doctrine dials that one
    // in minutes: §5.1's row reads "| Continuous tempo | 3-8 mi continuous | T
    // | None | 20-40 min |" and §5.2 "Duration | 20 min minimum for stimulus;
    // 20-40 min sweet spot". So its length is a lever where a multi-rep set's
    // rep length is not — shortening one repetition of "4×1 mi" would make it a
    // different workout (§5.3 defines it BY the mile), shortening the single
    // block just makes it a shorter tempo.
    //
    // The floor is `MIN_QUALITY_REP_MINUTES` — Research/04 §6's three-minute
    // repetition — not §5.2's twenty. Twenty minutes is the stimulus optimum,
    // and where it collides with `Research/01`'s cap the cap wins: see the
    // tension resolved in dosing.ts's header, and `sizeTempoDay`.
    // A one-rep DISTANCE set is the low-volume case, and the same argument
    // applies to its length as to the tempo's.
    //
    // `AT_PACE_SESSION_MI` already states the principle for the session band:
    // "`min` is not a floor. A small week buys a small session; doctrine's
    // lower bound describes the runner who can afford the whole dose, and
    // flooring a 20 mi/wk runner at four threshold miles would be the share cap
    // read backwards." §5.1's shortest cruise repetition is a mile, which is
    // 12.5% of an eight-mile week — doctrine's rep bands are written for
    // runners at the volumes `Research/00a`'s own volume table puts them at,
    // and below that floor the CAP is the rule that still means something.
    //
    // So the single repetition shortens, in the unit the prescription states it
    // in, down to `MIN_QUALITY_REP_MINUTES` (Research/04 §6's three minutes).
    // Shorter than that and it is not a repetition, and the caller keeps what
    // it has. Only ever at ONE rep: shortening a repetition inside a multi-rep
    // set would change the workout §5.3 and §6.2 define BY its rep length,
    // where here the set IS the single effort.
    const dist = cur.match(/^(\s*)1(\s*[×xX]\s*)(\d+(?:\.\d+)?)\s*(mi|km|K|m)\b/);
    if (dist && now > 0) {
      const unit = dist[4];
      const perMi = unit === 'mi' ? 1 : unit === 'm' ? 1609.34 : 1.609344;
      const floorMi = (MIN_QUALITY_REP_MINUTES * 60) / 480; // §6's 3 min, at splitDay's probe pace
      const wantMi = Math.max(floorMi, Math.min(now, targetMi));
      if (wantMi < now - 0.01) {
        const raw = wantMi * perMi;
        const grain = unit === 'm' ? 100 : unit === 'mi' ? 0.25 : 0.5;
        // Round DOWN to the grain, but never below the three-minute floor
        // itself: flooring 0.375 mi onto a quarter-mile grain gives 0.25, which
        // is a ninety-second fragment doctrine describes nowhere. The floor is
        // rounded UP to the grain and wins.
        const floorGrain = Math.ceil((floorMi * perMi) / grain) * grain;
        const rounded = Math.max(grain, floorGrain, Math.floor(raw / grain) * grain);
        day.subLabel = cur.replace(
          /^(\s*)1(\s*[×xX]\s*)\d+(?:\.\d+)?(\s*)(mi|km|K|m)\b/,
          `$11$2${Number(rounded.toFixed(2))}$3$4`,
        );
        return measure(day);
      }
      return now;
    }

    const timed = cur.match(/^(\s*)1(\s*[×xX]\s*)(\d+(?:\.\d+)?)(\s*min\b)/i);
    if (timed && now > 0) {
      const mins = Number(timed[3]);
      const want = Math.max(
        MIN_QUALITY_REP_MINUTES,
        Math.floor(mins * Math.min(1, targetMi / now)),
      );
      if (want < mins) {
        day.subLabel = cur.replace(
          /^(\s*)1(\s*[×xX]\s*)\d+(?:\.\d+)?(\s*min\b)/i,
          `$11$2${want}$3`,
        );
        return measure(day);
      }
    }
    return now;
  }

  // 4 · a continuous block whose size leads the prescription ("5mi continuous
  //     tempo", "4mi continuous wave tempo · ±10 s/mi around T"). Only the
  //     leading number moves; the phrase after it is the workout's identity.
  const lead = label.match(/^(\s*)([\d.]+)\s*mi\b/i);
  if (lead && !/\bE\s+w\//i.test(label)) {
    const want = Math.max(0.5, Math.floor(targetMi * 2) / 2);
    if (want < Number(lead[2])) {
      day.subLabel = label.replace(/^(\s*)[\d.]+(\s*mi\b)/i, `$1${want}$2`);
      return measure(day);
    }
  }

  return before;
}

/**
 * DOCTRINE-TAPERMP-1 · is this day the taper's marathon-pace session?
 *
 * Deliberately narrow — a non-long quality day whose prescription declares a
 * continuous MP block, which only `taperMpDose` authors. Every plan composed
 * before this pass existed answers false, so the trimmers it guards behave
 * exactly as they did.
 */
function isMpTaperSession(d: DayPlan): boolean {
  return d.isQuality && !d.isLong && d.type !== 'race'
    && MP_SESSION_LABEL.test(String(d.subLabel ?? ''));
}

const MP_SESSION_LABEL = /^([\d.]+) mi WU · ([\d.]+) mi @ MP · ([\d.]+) mi CD$/i;

/**
 * Rewrite an MP session's label so its segments sum to `totalMi`, holding the
 * warm-up and cool-down proportions. The MP block absorbs the remainder, which
 * is the right way round: `Research/08` §9.2 sizes the session BY its MP
 * mileage, so that is the number the label must keep honest.
 */
function resizeMpSession(day: DayPlan, totalMi: number): void {
  const m = String(day.subLabel ?? '').match(MP_SESSION_LABEL);
  if (!m) return;
  const [wuPrev, mpPrev, cdPrev] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const prev = wuPrev + mpPrev + cdPrev;
  if (!(prev > 0) || !(totalMi > 0) || Math.abs(prev - totalMi) < 0.05) return;
  const k = totalMi / prev;
  const wu = Math.max(0.5, Math.round(wuPrev * k * 2) / 2);
  const cd = Math.max(0.5, Math.round(cdPrev * k * 2) / 2);
  const mp = Number((totalMi - wu - cd).toFixed(1));
  if (mp <= 0) return;
  day.subLabel = `${wu} mi WU · ${mp} mi @ MP · ${cd} mi CD`;
}

/**
 * DOCTRINE-TID-1 (2026-08-17) · hold every TRAINING week at or above the
 * doctrinal easy-volume floor.
 *
 * `Research/00a-distance-running-training.md` §"TID — the disagreement and when
 * each TID matters": "All elite distance runners — regardless of system —
 * converge on ≥75% of training volume in Z1." §"Practical base-building rules"
 * repeats it with a ceiling: "Most base running is easy | 75–90% in Z1".
 * Nothing in the generator measured this, let alone enforced it.
 *
 * What it was costing: the marathon RACE-SPECIFIC block ran at 58-71% easy.
 * `longFinishSegment` puts a 50%-of-the-long marathon-pace finish on EVERY
 * race-specific week, and `qualityTypesFor` puts two structured sessions
 * alongside it in the same seven days. `Research/04` §16 "Combinations to
 * avoid" names that pairing directly — "MP long run + hard tempo within 5 days
 * | Same energy system, same impact pattern, no recovery between" — and §4.4
 * gives the marathon-pace long run a cadence of "6-10 weeks out", not "every
 * week". The long-run finish is therefore the SURPLUS hard mileage in an
 * over-dense week, and it is what this pass gives back first.
 *
 * The correction converts hard miles to easy miles INSIDE THE SAME DAY: the
 * long run keeps its distance and loses finish miles to its own easy build.
 * Nothing about the week's shape moves — day count, day distances, placement,
 * weekly total and the long run's length are all byte-identical afterwards.
 * That is deliberate: it is the only lever that cannot disturb the structural
 * invariants the sweep gates already hold, so a plan that was well-formed
 * before this pass is still well-formed after it.
 *
 * TAPER and race weeks are exempt, and the exemption is doctrine rather than
 * convenience. `Research/08` §9.1's taper is defined as volume-cut with
 * intensity PRESERVED, so the hard share rises by design as the taper deepens;
 * and a race week's biggest number is the race, which is not training volume at
 * all. Applying a training-volume floor to either would be reading the claim
 * against weeks it was never about.
 */
function applyIntensityFloor(composed: ComposePlanResult): void {
  for (const w of composed.weeks) {
    if (w.isRaceWeek || w.phase === 'TAPER') continue;
    // MIDRACE-TID-1 (2026-08-17) · A RACE IS NOT TRAINING VOLUME.
    //
    // The floor reads Research/00a's "≥75% of TRAINING volume in Z1" and, on a
    // week carrying an embedded tune-up, was counting a raced 10K or half as
    // training. Four weeks of the owner's CIM block landed at 45.8%, 63%, 51.3%
    // and 37.9% — and the pass could do nothing about any of them, because its
    // only lever is the long run's marathon-pace finish and in a tune-up week
    // the long run IS the race.
    //
    // The honest correction is to measure the week's TRAINING distribution:
    // take the race day out of both sides of the ratio, not to widen the floor
    // and not to wave the week through. It is the same argument the plan's own
    // race week already makes one line up (a race is the event, not the
    // training), applied per finding rather than per surface — CLAUDE.md's
    // per-finding context-filter rule. What is left is the week's actual
    // training, held to the same 75% as every other week, with the long-run
    // finish still available as the lever whenever the race did not consume it.
    const trainingWeek = w.days.some((d) => d.type === 'race')
      ? { ...w, days: w.days.filter((d) => d.type !== 'race') }
      : w;
    if (weekIntensity(trainingWeek).easyShare >= EASY_SHARE_FLOOR) continue;

    const long = w.days.find((d) => d.isLong && d.type === 'long' && d.distanceMi > 0);
    if (!long) continue;
    const finishMi = splitDay(long).qualityMi;
    if (finishMi <= 0) continue;

    // Hard miles the week may carry: (1 - floor) of its running volume.
    const totals = trainingWeek.days.reduce(
      (acc, d) => { const s = splitDay(d); acc.easy += s.easyMi; acc.hard += s.qualityMi; return acc; },
      { easy: 0, hard: 0 },
    );
    const running = totals.easy + totals.hard;
    if (running <= 0) continue;
    const hardBudget = running * (1 - EASY_SHARE_FLOOR);
    const surplus = totals.hard - hardBudget;
    if (surplus <= 0.05) continue;

    // Give back only what the finish can give. When the two quality days alone
    // already exceed the budget the finish goes to zero and the week stays
    // over — this pass never touches a quality session's prescription, so the
    // sub_label a runner reads always matches the spec their watch executes.
    const newFinish = Math.max(0, Math.floor((finishMi - surplus) * 2) / 2);
    setLongFinish(long, newFinish);
  }
}

/**
 * Rewrite a long-run day's finish segment to `finishMi` miles (0 removes it).
 * sub_label is the ONLY carrier of the finish between compose and persist —
 * `buildWorkoutSpec`'s `extractFinishSegment` reads it back out — so the label
 * and the notes are rewritten together and there is no third place to drift.
 */
function setLongFinish(day: DayPlan, finishMi: number): void {
  const tagMatch = String(day.subLabel ?? '').match(/mi\s*@\s*(HM|MP|M)\b/i);
  const tag = tagMatch ? tagMatch[1].toUpperCase() : 'MP';
  // DOCTRINE-DOSING-2 · the same floor `layoutWeek` authors to, applied to
  // every later trim. `Research/04` §4.5 states the segment as "final 2-6 mi at
  // MP or slightly faster", so a give-back that would leave less than two miles
  // removes the finish instead of shipping a mile of race pace under a label
  // that promises a session. Both the intensity floor and the dosing pass reach
  // this function, and neither should be able to invent a shape doctrine does
  // not describe.
  if (finishMi > 0 && finishMi < FAST_FINISH_MIN_MI) finishMi = 0;
  if (finishMi <= 0) {
    day.subLabel = 'LONG';
    day.notes = 'Conversational throughout. Build the engine.';
    return;
  }
  const easyMi = Math.max(0, Math.round((day.distanceMi - finishMi) * 10) / 10);
  day.subLabel = `LONG · ${finishMi}mi @ ${tag}`;
  day.notes = `Steady ${easyMi}mi, then ${finishMi}mi at ${tag === 'HM' ? 'half-marathon pace' : 'marathon pace'}.`;
}

/**
 * Everything `generatePlan` does BEFORE it touches the database: load the
 * inputs, pick the mode, compose, finalize, validate.
 *
 * Extracted 2026-08-17 (RAMPBASE-1 audit) so the author-time pipeline can be
 * driven end-to-end — real `loadGeneratorInputs`, real composer, real
 * validator, against real rows — without persisting. Every verification of a
 * dated plan defect before this had to re-implement the wiring in a harness
 * and therefore verified the harness, not the engine. `generatePlan` now calls
 * this and does nothing but persist what comes back.
 */
export interface ComposeForUserResult {
  compose: ComposePlanInput;
  composed: ComposePlanResult;
  mode: PlanMode;
  todayISO: string;
  trailingAvgWeeklyMi: number | null;
}

export async function composeForUser(
  input: GenerateInput,
): Promise<{ ok: true; result: ComposeForUserResult } | { ok: false; reason: string }> {
  const r = await composeForUserInternal(input);
  return r.ok ? { ok: true, result: r.result } : { ok: false, reason: r.reason };
}

export async function generatePlan(input: GenerateInput): Promise<GenerateResult> {
  // COACHED-GATE-1 (2026-08-19) · THE gate, at the single chokepoint.
  //
  // `coached_externally` is the fifth onboarding branch: the runner has a human
  // coach, that coach owns the prescription, and Faff is the measurement layer.
  // The gate shipped 2026-08-18 wired at each authoring ROUTE — /api/race,
  // /api/profile/goal, fireAutoRebuild, rebuildActivePlanForPrefs, the open
  // block — which closed the paths that existed and left four that did not get
  // the line, including `POST /api/cron/silent-rebuild`. That one is the one
  // that matters: it is automatic, it is invisible by design (no proposal, no
  // banner, "essentially a backend code upgrade"), and it would have quietly
  // rewritten a coached runner's plan on every rules landing.
  //
  // One line here covers every path, including paths that do not exist yet, and
  // demotes the five route-level gates to belt and braces — they now stop the
  // work EARLIER (no composition, a specific response shape) rather than being
  // the only thing standing there.
  //
  // FAILS OPEN, inherited from `isCoachedExternally`: a read error returns
  // false and the plan is authored. Silently ceasing to coach somebody who
  // asked to be coached is a worse and far less visible failure than an extra
  // plan a coached runner can ignore.
  //
  // The ONE exception is `allowCoached`, passed by the three explicit runner
  // actions. See the reasoning on that field.
  if (!input.allowCoached && await isCoachedExternally(input.userId)) {
    return { ok: false, reason: COACHED_SKIP_REASON };
  }
  const staged = await composeForUserInternal(input);
  if (!staged.ok) return { ok: false, reason: staged.reason };
  return persistComposedPlan(input, staged.result);
}

async function composeForUserInternal(
  input: GenerateInput,
): Promise<{ ok: true; result: ComposeForUserResult } | { ok: false; reason: string }> {
  const { userId, raceSlug, startAnchor = 'monday', startDateISO, goalTarget, freshTarget } = input;
  // OPEN-TARGET-1 · an open block only exists when there is NO real target. A
  // raceSlug or goalTarget always wins, so a caller that passes both gets the
  // target — never a maintenance block instead of the build they asked for.
  const openTarget = (!raceSlug && !goalTarget) ? input.openTarget : undefined;

  // 1. Load all DB-sourced inputs into a pure-data bundle.
  const inputs = await loadGeneratorInputs(userId, raceSlug, startAnchor, startDateISO, goalTarget, openTarget);
  if (!inputs.ok) return { ok: false, reason: inputs.reason };

  // 2026-06-03 · Rules 12 + 13 · pick plan mode based on temporal context.
  // race-prep: race is within build window
  // maintenance: race is too far out · hold aerobic base
  // recovery: another race finished recently · 1-2 week light-running
  const todayISO = await runnerToday(userId);
  const { lastRaceFinished: dbLastRace, lastRaceDistanceMi: dbLastRaceMi } = await loadLastRaceFinished(userId, todayISO);

  // OPEN-TARGET-1 · the race the OPEN BLOCK is unwinding from, when the caller
  // named one. `loadLastRaceFinished` reads the runner's last A/B race dated
  // strictly BEFORE today, which is right for a build but wrong twice here:
  //
  //   · on race DAY the finished race is dated today, so the DB reader returns
  //     nothing and `pickPlanMode` would answer 'maintenance' — a maintenance
  //     block on the evening of somebody's marathon.
  //   · a C-priority race is filtered out of that query entirely, but
  //     `postRaceRecoveryWeeks` has a C row and `openBlockMode` spends it.
  //
  // `authorOpenBlock` has already answered recovery-vs-maintenance from this
  // same race through `openBlockMode`. Threading it here is what makes
  // `pickPlanMode` reach the SAME answer rather than a second, quieter one —
  // both read `postRaceRecoveryWeeks`, so given the same race they agree by
  // construction. Falls back to the DB reader when the caller named no race.
  const openAfter = openTarget?.after ?? null;
  const openLastRace = (openAfter && openAfter.dateISO && openAfter.distanceMi != null && openAfter.distanceMi > 0)
    ? {
        slug: openAfter.slug,
        name: openAfter.slug,
        date: String(openAfter.dateISO).slice(0, 10),
        distanceMi: openAfter.distanceMi,
        priority: openAfter.priority ?? null,
      }
    : null;
  const lastRaceFinished = openTarget ? (openLastRace ?? dbLastRace) : dbLastRace;
  const lastRaceDistanceMi = openTarget ? (openLastRace?.distanceMi ?? dbLastRaceMi) : dbLastRaceMi;
  /** True when `raceDistanceMi` on this authoring is OPEN_BLOCK_SHAPE_ANCHOR_MI
   *  — a stated convention — rather than a distance the runner raced. Must be
   *  computed from the SAME input the loader used, so the two cannot drift. */
  const openAnchorIsConvention = !!openTarget && !openBlockAnchorIsMeasured(openAfter?.distanceMi ?? null);

  // Goal-mode is always a BUILD to the goal (the runner chose the length) — it
  // never demotes to maintenance/recovery the way a far-off or just-finished
  // race would.
  const mode: PlanMode = goalTarget ? 'race-prep' : pickPlanMode(
    todayISO,
    // OPEN-TARGET-1 · a null next-race is the literal truth on this path, and
    // `pickPlanMode` step 2 already answers it: "No next race · maintenance by
    // default". Nothing new decides the mode — the existing machine does, fed
    // the honest input instead of a synthetic target it would misread as a
    // race one day away.
    openTarget ? null : inputs.compose.raceDateISO,
    openTarget ? null : inputs.compose.raceDistanceMi,
    lastRaceFinished?.date ?? null,
    lastRaceDistanceMi ?? null,
    lastRaceFinished?.priority ?? null,   // DOCTRINE-5 · effort-scaled recovery window
  );

  // RAMPBASE-1 (2026-08-17) · race-prep ramps from the runner's SUSTAINED
  // base. The 28-day mean is the right number for pace anchors and for the
  // Rule 10 transparency envelope (both keep reading it) and the wrong number
  // for a ramp whose window is half mandated recovery. Maintenance/recovery
  // are unaffected: they anchor to peak already (DOCTRINE-4).
  if (mode === 'race-prep') {
    const ramp = await rampBaseForBuild(
      userId, todayISO, inputs.compose.recentWeeklyMi,
      lastRaceFinished, lastRaceDistanceMi, lastRaceFinished?.priority ?? null,
    );
    // DOCTRINE-BASE-1 (2026-08-18) · the EVIDENCE is threaded whether or not it
    // lifted the base. `rampBaseMi` stays conditional, so the volume curve is
    // byte-identical for every runner the lift does not apply to — but the
    // base-rebuilt gate in `composePlan` needs the comparison the evidence
    // carries (this runner's 28-day mean against this runner's own sustained
    // level) even on the authorings where the ramp itself did not move.
    if (ramp.lifted) inputs.compose.rampBaseMi = ramp.baseMi;
    inputs.compose.rampBaseEvidence = ramp;
  }

  // 2026-08-17 · coaching-loop reconciliation · measured-progress gate for
  // MID-BLOCK REBUILDS of the same race. The prior active plan carries the
  // season's anchor VDOT (authored_state.pace_blend, falling back to the
  // Rule 10 derived_from envelope); measured progress = share of the
  // (goalVdot − seasonAnchor) gap the runner has actually banked. The
  // weekly currentT→goalT blend is then capped at measured + 0.15 grace so
  // a rebuild can't re-schedule goal-anchored paces fitness hasn't earned.
  // Fresh authorings (no prior plan for this race) stay calendar-blended —
  // a forecast, kept honest by recomputePacesForPlan + the adapter's
  // pr_bank/fitness_regression detectors as evidence arrives.
  // Byte-safe: when measured VDOT tracks the calendar the gate is a no-op
  // (min(calendar, measured+grace) = calendar), and when no prior plan
  // exists the input stays undefined (identical behavior to before).
  // Cite: Research/01-pace-zones-vdot.md §Recalibrate-Paces (:304-321).
  if (mode === 'race-prep' && raceSlug && inputs.compose.goalSec != null) {
    try {
      const prior = (await pool.query<{ authored_state: Record<string, unknown> | null }>(
        `SELECT authored_state FROM training_plans
          WHERE user_uuid = $1 AND archived_iso IS NULL AND race_id = $2
          ORDER BY authored_iso DESC LIMIT 1`,
        [userId, raceSlug],
      ).catch(() => ({ rows: [] }))).rows[0];
      const priorSt = (prior?.authored_state ?? null) as Record<string, any> | null;
      // EVIDENCE-2 · third rung: the runner's OWN measured VDOT. A prior plan
      // that recorded no anchor (every recovery block before this commit) used
      // to leave seasonAnchor null, which switched the gate off entirely.
      // Anchoring on today's measurement makes measured progress 0 — honest:
      // nothing has been demonstrated since — rather than absent.
      // COLD-3 (2026-08-17) · READER 3 · refuse to INHERIT a provisional anchor.
      // The prior plan's `season_anchor_vdot` may be a mileage-derived estimate.
      // Carrying it forward launders a self-report into the season's fitness
      // baseline permanently: every subsequent rebuild inherits it, and
      // measuredProgressFraction then grades real running against an invented
      // starting point.
      //
      // SELFREPORT-1 (2026-08-21) · the sentence that used to sit here — "rung 2
      // is measured by construction, it is null when nothing was measured" —
      // stopped being true when PARITY-1 began seeding `bestRecentVdot` from
      // `profile.race_history`. `derived_from.bestRecentVdot` records whatever
      // the authoring was handed, so on a cold-start plan it holds the PR the
      // runner typed, and rung 2 walked straight past rung 1's guard with it.
      // Rung 2 now inherits the PLAN's provenance, and rung 3 inherits this
      // authoring's own, so whichever rung wins, the source recorded is the
      // source that won.
      const priorAnchorProvisional = paceBlendAnchorIsProvisional(priorSt?.pace_blend);
      const priorAnchorSource = priorSt?.pace_blend?.season_anchor_source;
      let seasonAnchorInheritedSource: AnchorSource = 'measured_vdot';
      let seasonAnchor: number | null = null;
      if (!priorAnchorProvisional && priorSt?.pace_blend?.season_anchor_vdot != null) {
        seasonAnchor = Number(priorSt.pace_blend.season_anchor_vdot);
      } else if (priorSt?.derived_from?.bestRecentVdot != null) {
        seasonAnchor = Number(priorSt.derived_from.bestRecentVdot);
        // The prior plan's own stamp is the only record of where its
        // `bestRecentVdot` came from. A prior plan that predates the stamp
        // carries none, and reads measured — unchanged from before.
        if (priorAnchorProvisional) seasonAnchorInheritedSource = (priorAnchorSource as AnchorSource | undefined) ?? 'provisional_mileage';
      } else if (inputs.compose.bestRecentVdot != null) {
        seasonAnchor = Number(inputs.compose.bestRecentVdot);
        if (inputs.compose.bestRecentVdotSelfReported) seasonAnchorInheritedSource = 'self_reported_race';
      }
      if (seasonAnchor != null) {
        const goalVdotNow = vdotFromRace(inputs.compose.goalSec, inputs.compose.raceDistanceMi);
        inputs.compose.seasonAnchorVdot = seasonAnchor;
        // SELFREPORT-1 · the provenance of the rung that actually won. Rung 1
        // is measured by the guard above; rungs 2 and 3 carry their own.
        inputs.compose.seasonAnchorSource = seasonAnchorInheritedSource;
        inputs.compose.measuredProgressFraction = measuredProgressFraction(
          seasonAnchor,
          inputs.compose.bestRecentVdot ?? null,
          goalVdotNow,
        );
      }
    } catch { /* gate is additive — a read failure falls back to calendar blend */ }
  }

  // 2. Compose · branch by mode.
  let composed: ComposePlanResult;
  if (mode === 'race-prep') {
    composed = composePlan(inputs.compose);
  } else {
    // COLD-1 · same evidence-only lift as the race-prep branch.
    //
    // OPEN-TARGET-1 · WITHHELD when the open block's distance anchor is the
    // convention rather than a distance the runner raced. This lift predicts a
    // pace AT the anchor distance and grades it against THAT distance's tier
    // table, which is the one consumer the anchor can actually move: above
    // roughly VDOT 48 the rows diverge, and the same runner graded at 13.1 came
    // out a tier above the same runner graded at 26.2. Grading evidence against
    // an event nobody entered is the "unknown distance defaulted to a half"
    // error wearing different clothes. Withholding it leaves the tier on stated
    // experience — a real fact — and leaves the anchor unable to change
    // anything. Unaffected on every other path, including an open block that
    // DOES know what the runner last raced.
    const nrDemonstrated = (inputs.compose.bestRecentVdot != null && !openAnchorIsConvention)
      ? (() => {
          const t = predictRaceTime(inputs.compose.bestRecentVdot, inputs.compose.raceDistanceMi);
          return t != null ? Math.round(t / inputs.compose.raceDistanceMi) : null;
        })()
      : null;
    const tier = lookupTierTarget(inputs.compose.goalPaceSec, inputs.compose.raceDistanceMi, inputs.compose.level, nrDemonstrated).tier; // VAR-01 + COLD-1
    // DOCTRINE-4 · read only on the non-race branch (maintenance + recovery are
    // the two composers that anchor to peak); race-prep never touches it, so the
    // race path takes no extra query.
    const recentPeakWeeklyMi = await recentPeakWeeklyMileage(userId, todayISO);
    const nonRaceInput: ComposeNonRaceInput = {
      startMondayISO: inputs.compose.startMondayISO,
      level: inputs.compose.level,
      recentWeeklyMi: inputs.compose.recentWeeklyMi,
      recentLongMi: inputs.compose.recentLongMi,
      // DOCTRINE-4 · a REAL peak week, not the 28-day mean. Research/00b's
      // reverse-taper column is headed "Volume vs. peak"; feeding it an average
      // put marathon week 4 at ~46% of true peak against a 70-80% row.
      recentPeakWeeklyMi: Math.max(recentPeakWeeklyMi, inputs.compose.recentWeeklyMi),
      // MAINT-NOBLOCK-1 · the same query's answer BEFORE the max, so the
      // composer can tell "came down from 40" from "has logged nothing and
      // says 20". 0 here is the day-one onboarder.
      measuredPeakWeeklyMi: recentPeakWeeklyMi,
      easyDayMedianMi: inputs.compose.easyDayMedianMi,
      longRunDow: inputs.compose.longRunDow,
      restDow: inputs.compose.restDow,
      qualityDows: inputs.compose.qualityDows,
      availableDows: inputs.compose.availableDows ?? null,
      trainingDaysPerWeek: inputs.compose.trainingDaysPerWeek,
      crossModes: inputs.compose.crossModes,
      tier,
      // OPEN-TARGET-1 · null, not a fabricated row. `ComposeNonRaceInput.
      // nextRace` has been declared nullable since it was written, and
      // `composeMaintenancePlan` already reads it as "when no race is
      // scheduled, fall back to the 4-week rolling default" — the block's
      // length comes from the composer. `composeRecoveryPlan` never reads it
      // at all; its whole shape comes from `lastRaceFinished`. Building a row
      // out of `raceSlug` here would have handed maintenance a race dated
      // today and collapsed its window to nothing.
      nextRace: openTarget ? null : {
        // On every other path this branch is only reached from the race path
        // (goal-mode forces 'race-prep'), so raceSlug is defined here.
        slug: raceSlug ?? '',
        name: raceSlug ?? '',
        date: inputs.compose.raceDateISO,
        distanceMi: inputs.compose.raceDistanceMi,
        goalPaceSec: inputs.compose.goalPaceSec,
      },
      lastRaceFinished: lastRaceFinished ?? null,
      rxQuality: inputs.compose.rxQuality,
      tPaceSec: inputs.compose.tPaceSec,
      lthr: inputs.compose.lthr,
      bestRecentVdot: inputs.compose.bestRecentVdot ?? null,   // EVIDENCE-2
      bestRecentVdotSelfReported: inputs.compose.bestRecentVdotSelfReported,  // SELFREPORT-1
    };
    composed = mode === 'recovery'
      ? composeRecoveryPlan(nonRaceInput)
      : composeMaintenancePlan(nonRaceInput);
  }

  // 3. Validate composed plan · gate before any DB mutation.
  // Throws PlanValidationError if doctrine or corruption checks fail.
  // clearActivePlansFor never runs on a bad plan — runner's active plan untouched.
  let trailingAvgWeeklyMi: number | null = null;
  {
    // 2026-08-24 · swallowed-failure sweep · both of these fed VALIDATOR
    // inputs, and both fabricated `null` on failure. `null` is the documented
    // "skip this check" value for each: `priorPlanPeakLongMi: null` skips the
    // corruption check, `trailingAvgWeeklyMi: null` skips the peak-vs-trailing
    // ramp check. So a dropped connection did not merely lose a number — it
    // switched off two of the gates standing between a bad plan and the
    // runner's legs, silently, on the write path. Both reads now refuse.
    const priorPeakRow = await rowOrNull<{ peak_long: string | null }>(
      'plan/generate · priorPlanPeakLongMi',
      pool.query<{ peak_long: string | null }>(
        `SELECT MAX(pw.distance_mi)::text AS peak_long
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL AND pw.type = 'long'`,
        [userId],
      ),
    );
    // F13: query trailing 28d actual mileage for peak-vs-trailing ramp check.
    const trailingRow = await rowOrNull<{ avg_weekly: string | null }>(
      'plan/generate · trailingAvgWeeklyMi',
      pool.query<{ avg_weekly: string | null }>(
        `SELECT (SUM((data->>'distanceMi')::numeric) / 4.0)::text AS avg_weekly
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'date')::date >= $2::date - INTERVAL '28 days'
          AND (data->>'date')::date < $2::date`,
        [userId, todayISO],
      ),
    );
    if (priorPeakRow === null || trailingRow === null) {
      return { ok: false, reason: 'could not read your training history · try again in a moment' };
    }
    trailingAvgWeeklyMi = trailingRow?.avg_weekly != null
      ? Number(trailingRow.avg_weekly)
      : null;
    // 2026-06-10 persona-suite fix · author-time WoW smoothing. The
    // long-run curve steps in whole/half miles; at low cold-start bases
    // a 2mi step IS >30% (6mi → 8mi = 33%) and the validator (rightly,
    // per its cited progression doctrine) rejected every low-base race
    // plan. Enforce the SAME rule at author time: clamp each training
    // long to ≤ prev × 1.30, rounded DOWN to 0.5mi, trimming the week
    // total to match. 30 mirrors validate.ts CONSTRAINTS.longRunWoWMaxPct
    // (30 for all four distance categories — kept literal here because
    // generate→validate would be a runtime import cycle). Race-day rows
    // are not training longs and are skipped, matching the validator.
    finalizeComposedPlan(composed, inputs.compose.raceDistanceMi, inputs.compose.level);
    // MAINT-WEEKLYML-1 (2026-06-23) · re-snapshot vols from the VOL-1-reconciled weeklyMi values so
    // non-race-prep modes (maintenance/recovery) carry realized volumes, not the pre-finalize budgets.
    // composePlan derives vols from volumeCurve (the real source); maintenance/recovery authored weeklyMi
    // from targetWeekly/wkWeekly scalars. VOL-1 in finalizeComposedPlan overwrites weeklyMi with the
    // actual day-sum for ALL modes, so vols[] must track it to stay in sync.
    composed.vols = composed.weeks.map((w) => w.weeklyMi);
    validateComposedPlan(composed, inputs.compose.raceDistanceMi, mode, {
      level: inputs.compose.level,
      // CC2-4 (2026-06-23) · key this to the SAME boundary the builder's horizonRaise extends at — any
      // horizon at marathon category or longer (distanceMi > 17, the hm→m cutoff). At >=20 a (17,20]
      // horizon (e.g. 30K = 18.64mi) made the builder author a ~21mi long while this flag stayed false →
      // HM cap 20 → persist-abort. David's CIM horizon (26.22) is true under both → no-op for him.
      isSteppingStoneToMarathon: (inputs.compose.horizonRaces ?? []).some(r => r.distanceMi > 17),
      // Corruption check compares against the active prior plan. On a fresh
      // user-initiated target (set-goal / add-race) the prior plan is a
      // DIFFERENT goal about to be replaced, so a legitimately smaller long
      // (marathon→5K, cold-start beginner) must not be flagged as data loss —
      // null skips it. Same-goal adaptation regens still get the check.
      priorPlanPeakLongMi: freshTarget ? null : (priorPeakRow?.peak_long != null ? Number(priorPeakRow.peak_long) : null),
      todayISO,
      trailingAvgWeeklyMi,
      trainingDaysPerWeek: inputs.compose.trainingDaysPerWeek,
      // GOAL-1 · available_days stranded quality to empty → composer folds to long+easy (valid)
      qualityStrandedByAvailability: inputs.compose.availableDows != null && (inputs.compose.qualityDows?.length ?? 0) === 0,
      recentWeeklyMi: inputs.compose.recentWeeklyMi, // CC-2 · cold-start ramp base
    });
  }

  return {
    ok: true,
    result: { compose: inputs.compose, composed, mode, todayISO, trailingAvgWeeklyMi },
  };
}

async function persistComposedPlan(
  input: GenerateInput,
  staged: ComposeForUserResult,
): Promise<GenerateResult> {
  const { userId, raceSlug, goalTarget } = input;
  const { compose, composed, mode, todayISO } = staged;
  const inputs = { compose };
  const openTarget = (!raceSlug && !goalTarget) ? input.openTarget : undefined;
  // WEEK-ALIGN-1 · the same question the loader asked when it snapped the
  // anchor, asked through the same function so the two cannot answer it
  // differently: which day is the runner's first? Null on the lifecycle-regen
  // path, which keeps the whole current week.
  const clipBeforeISO = requestedBlockStartISO(
    todayISO, input.startAnchor ?? 'monday', input.startDateISO,
  );

  // OPEN-TARGET-1 · `goal_iso` on an open block is the block's OWN last day,
  // not the `todayISO` the loader carried as a placeholder. The column answers
  // "how far does this plan run"; every reader of it on a plan with a null
  // race_id is asking that, not "when is the race". Writing today would date
  // the plan as already over on the morning it is authored.
  const openBlockEndISO = composed.weeks.length > 0
    ? addDays(composed.weeks[composed.weeks.length - 1].startISO, 6)
    : inputs.compose.raceDateISO;

  // 4. Archive existing + persist · one transaction (M-19, 2026-06-09).
  // Wraps sealed-day snapshot → archive → all plan inserts → mode
  // stamp. Before this each step was its own pool.query: a crash after
  // the archive UPDATE left the runner with NO active plan (today /
  // watch / adaptation crons go dark), a crash mid-insert left a
  // half-written plan, and a transient DB error during the sealed-day
  // snapshot silently returned an empty map — the retry rebuilt with
  // every Rule 15 seal dropped. Now any failure rolls the whole
  // rebuild back and the prior plan stays active.
  //
  // 2026-08-18 · ROUTED THROUGH THE PLAN MUTATION BOUNDARY (lib/plan/mutate.ts).
  // The transaction is now owned by `mutatePlan`, which does one thing this
  // path never did: it reads the PERSISTED plan back and validates THAT.
  //
  // Why that matters here specifically. `validateComposedPlan` runs upstream on
  // the in-memory `ComposePlanResult`. Between that call and the row landing in
  // `plan_workouts`, `persistPlan` re-derives each day's distance from the
  // workout spec (`totalDistanceMiFromSpec`), caps the spec to the day distance
  // (`capSpecToDistance`), and overlays the PRIOR plan's prescriptions onto any
  // sealed completed day (Rule 15). Every one of those can move a number the
  // validator had already approved, and nothing checked the result.
  //
  // REPORT ONLY, deliberately. Drift lands on `plan_mutation_rejections` with
  // outcome `authorship_drift` and the rebuild COMMITS. Rolling a rebuild back
  // would leave the runner with no active plan at all — today, the watch and
  // the adaptation crons all go dark — which is a strictly worse failure than
  // a plan that drifted. The honest move is to see it, not to detonate on it.
  //
  // NOTE: composition and phase logic above are untouched; only the
  // persistence transaction moved.
  let planId: string | undefined;
  /** The block being replaced, read inside the transaction before it is
   *  archived. Null when the runner has no active plan (a first authoring) or
   *  has more than one (see `snapshotActivePrescription`) — in both cases the
   *  commit gate stands down and the rebuild lands as it always did. */
  let priorPrescription: PlanPrescription | null = null;
  let planDelta: PlanDelta | null = null;
  const boundary = await mutatePlan<string | undefined>({
    userUuid: userId,
    source: 'generate/persistComposedPlan',
    todayISO,
    touches: 'authorship',
    planIdFromResult: (v) => v ?? null,
    detail: { mode, race_slug: raceSlug ?? null, total_weeks: composed.totalWeeks },
    apply: async (client) => {
    // 2026-06-03 · Rule 15 · snapshot the prior plan's completed-day
    // prescriptions BEFORE archiving so persistPlan can overlay them
    // onto the new plan's rows. Without this, a rebuild would change
    // what the runner was prescribed for days they already ran ·
    // every retro surface (badge, recap, VDOT, adapt-text) would lie.
    // Throws on DB error · the rebuild aborts rather than unsealing.
    const sealedSnapshot = await snapshotSealedDays(client, userId);
    // 2026-08-25 · READ THE OUTGOING BLOCK BEFORE IT IS ARCHIVED, for the same
    // reason the sealed snapshot is taken here: `snapshotActivePrescription`
    // filters on `archived_iso IS NULL`, and one statement later there is no
    // active plan to read. This is the `before` side of the commit gate at the
    // bottom of this callback.
    priorPrescription = await snapshotActivePrescription(client, userId);
    // 2026-08-25 · the trigger, not the constant. See GenerateInput.archiveReason.
    await clearActivePlansFor(client, userId, input.archiveReason ?? 'regenerated');
    planId = await persistPlan(client, {
      userId,
      raceSlug: raceSlug ?? null,  // null for goal-mode AND for an open block (no race row)
      raceDateISO: openTarget ? openBlockEndISO : inputs.compose.raceDateISO,
      clipBeforeISO,
      blocks: composed.blocks,
      weeks: composed.weeks.map((w) => ({
        // 2026-06-06 · Audit C C1-1f · pass the per-week blended tPaceSec
        // through to persistPlan. Was stripped here → persistPlan fell back
        // to plan-wide goalT for every week → flat goal-pace plan (the
        // Rule 3 ramp was computed in composePlan then discarded at persist).
        startISO: w.startISO, phase: w.phase, days: w.days, isRaceWeek: w.isRaceWeek, tPaceSec: w.tPaceSec,
      })),
      tPaceSec: inputs.compose.tPaceSec,
      // PACE-E-1 · current-fitness anchor for easy/long/recovery (vs the goal-blended weekT).
      // 2026-07-07 · AUDIT P1-56 · same resolveCurrentTPace cascade as composePlan's
      // internal currentT (above) — must match, or the persisted anchor and the
      // in-memory composition anchor diverge for a below-table runner.
      easyAnchorTSec: resolveCurrentTPace(
        inputs.compose.bestRecentVdot ?? null, inputs.compose.belowTableAnchor ?? null,
        inputs.compose.recentWeeklyMi, conservativeVdotFromMileage,
      ).tPaceSec,
      lthr: inputs.compose.lthr,
      // 2026-06-03 · Rule 16 · plumb maxHr through to spec-builder so
      // easy/long HR caps land at max(89% LTHR, 78% maxHR) instead of
      // LTHR-only. profile.max_hr already loaded in inputs.compose.maxHr
      // via the planInputs reader.
      maxHr: inputs.compose.maxHr,
      // 2026-06-09 state-audit fix · goal pace for the race-day target.
      // 2026-07-07 · AUDIT P1-56 · when there is NO explicit goal (by-feel
      // plan, goalPaceSec null) and the runner's fitness is below-table,
      // thread the anchor's own demonstrated pace as the effective by-feel
      // race-day target rather than letting spec-builder fall back to
      // `tPaceSec + inverseOffset` (a re-derived number, one hop further from
      // the runner's actual demonstrated fitness than the anchor itself).
      // No-op (byte-identical) whenever an explicit goal exists or no
      // below-table anchor exists. NOTE: the race branch's own ±5 s/mi
      // "controlled push / negative-split" band (spec-builder.ts race case)
      // can still land ~5 s/mi faster than whatever racePace resolves to —
      // that band is a deliberate, long-standing pacing-STRATEGY allowance
      // for EVERY runner's race day (not specific to below-table runners,
      // not part of this fix's scope) and is intentionally excluded from the
      // falsifiable requirement #3 test (see _audit_slow_runner.test.ts).
      goalPaceSec: inputs.compose.goalPaceSec
        ?? (inputs.compose.belowTableAnchor
          ? Math.round(inputs.compose.belowTableAnchor.anchor.paceSPerMi)
          : null),
      // R3 + PACE-I-1 (2026-06-23) · 5K/10K/HM race goals get true VO2max I-pace intervals. HM was
      // excluded, but its quality day is explicitly labeled "6×800m @ I pace" (inlinePrescriptions) —
      // with iPace null it shipped the cruise T−18 default: a +6..+28 s/mi too-slow "VO2max" rep that
      // contradicts its own label (Research/22:187,194,206,213 · HM I-reps ≈ 5K-10K race pace).
      // Marathon/ultra keep the cruise default (their label is "I-T transition", not "@ I pace").
      goalIPaceEligible: ['5k', '10k', 'hm'].includes(distanceCategoryOf(inputs.compose.raceDistanceMi)),
      sealedSnapshot,
      // 2026-07-07 · AUDIT P1-56 · threaded so persistPlan's I-pace derivation
      // for race_week_tuneup/goal-I-eligible days uses iPaceFromAnchorPace
      // (Riegel) instead of the VDOT-bounded iPaceFromVdot(vdotFromTpace(weekT))
      // when the runner's fitness came from a below-table anchor.
      belowTableAnchor: inputs.compose.belowTableAnchor ?? null,
      authoredState: {
        ...composed.authoredState,
        mode,
        // Goal-anchored plan (no race row): record the goal so surfaces can
        // say "working toward your 10K" off the plan + the projection can read
        // the target without a races lookup.
        ...(goalTarget ? {
          goal_mode: true,
          goal_distance_mi: goalTarget.distanceMi,
          goal_sec: goalTarget.goalSec,
        } : {}),
        // OPEN-TARGET-1 · an open block has a null race_id, exactly like a
        // goal-mode plan, and the two are otherwise indistinguishable in the
        // row. Stamped so a surface can say "holding pattern, nothing booked"
        // rather than reaching for a goal that is not there — and so the shape
        // anchor is on the record as an anchor rather than as a target.
        ...(openTarget ? {
          open_block: true,
          open_block_after: openTarget.after?.slug ?? null,
          open_block_shape_anchor_mi: inputs.compose.raceDistanceMi,
          // 'last_raced' | 'convention' — the anchor's provenance, recorded so
          // a reader of this row can never mistake the convention for a target
          // the runner set. Same discipline as pace_blend's
          // `season_anchor_provisional`.
          open_block_shape_anchor_source:
            openBlockAnchorIsMeasured(openTarget.after?.distanceMi ?? null) ? 'last_raced' : 'convention',
        } : {}),
        generated_at: new Date().toISOString(),
        // When runway is < 14 weeks (e.g. AFC → CIM compressed block), flag it
        // so the coach briefing layer can surface the context. Base phase
        // condenses; race-specific and taper are preserved intact.
        // Cite: Research/22-plan-templates.md §11 "Two Marathons (spring + fall)"
        ...(composed.totalWeeks < 14 ? {
          compressed_timeline: true,
          compressed_note: `${composed.totalWeeks}-week build · base phase condensed; race-specific phase and taper preserved intact.`,
        } : {}),
      },
    });

    // Write the mode column for fast filtering by graduate/transition crons.
    await client.query(
      `UPDATE training_plans SET mode = $1 WHERE id = $2`,
      [mode, planId],
    );

    // 2026-08-25 · THE COMMIT GATE. See RebuildRefused below for the argument.
    //
    // Runs LAST, on the fully written plan, because the only honest way to ask
    // "did this rebuild change anything" is to compare what was actually
    // persisted. `persistPlan` re-derives distances from the spec, caps the
    // spec to the day distance and overlays Rule 15 sealed days — a comparison
    // made against the in-memory composition would be answering about a plan
    // that was never written.
    if (priorPrescription) {
      const after = await snapshotPrescription(client, planId);
      planDelta = computeDelta(priorPrescription, after, todayISO);
      if (samePrescription(priorPrescription, after)) {
        throw new RebuildRefused('no_change', priorPrescription.planId);
      }
      const undone = await undoneWithin(client, userId, after, UNDO_REFUSAL_DAYS);
      if (undone) {
        throw new RebuildRefused('undone_by_runner', priorPrescription.planId);
      }
    }
    return planId;
    },
  }).catch((e) => {
    // The boundary already rolled back, so the prior active plan stays live.
    // A RebuildRefused is not an error; it is this function's other correct
    // answer, and it is re-thrown here only because throwing is how a caller
    // inside `apply` reaches the boundary's ROLLBACK. Caught immediately below.
    if (e instanceof RebuildRefused) throw e;
    console.error('[generatePlan]', `rebuild rolled back · prior active plan untouched · user=${userId.slice(0, 8)} ·`, e instanceof Error ? e.message : String(e));
    throw e;
  }).catch((e) => {
    if (e instanceof RebuildRefused) return e;
    throw e;
  });

  // THE REFUSAL PATH. Nothing was written, nothing was archived, the runner is
  // still in the block they were in this morning, and the week counter reads
  // what it read yesterday. `ok` is TRUE: the engine ran, and "your plan is
  // already right" is a successful outcome, not a failure to rebuild. Callers
  // that need to tell the two apart read `unchanged` / `refusedReason`.
  if (boundary instanceof RebuildRefused) {
    console.log(
      `[generatePlan] refused · ${boundary.reason} · plan kept ${boundary.keptPlanId} · `
      + `user=${userId.slice(0, 8)} · trigger=${input.archiveReason ?? 'regenerated'}`,
    );
    return {
      ok: true,
      plan_id: boundary.keptPlanId,
      weeks_generated: 0,
      unchanged: true,
      refusedReason: boundary.reason,
      plan_delta: planDelta ?? undefined,
    };
  }

  planId = boundary.value ?? planId;

  // Post-commit, best-effort · plan mutation → invalidate memoized lookup
  // so the next /today render sees the new active plan.
  (await import('./lookup')).bustPlanLookupCache(userId);

  return {
    ok: true, plan_id: planId, weeks_generated: composed.totalWeeks,
    unchanged: false,
    // What moved, for the notice card. Null on a first plan (nothing to
    // compare against) and on a rebuild where the prior read could not be
    // taken; the card falls back to the trigger's own message and never
    // invents a number.
    plan_delta: planDelta ?? undefined,
  };
}

/**
 * 2026-06-03 · helper · read the runner's last finished A/B race so
 * pickPlanMode can decide if we're inside the recovery window.
 */
async function loadLastRaceFinished(
  userId: string,
  todayISO: string,
): Promise<{ lastRaceFinished: { slug: string; name: string; date: string; distanceMi: number; priority: string | null } | null; lastRaceDistanceMi: number | null }> {
  const r = (await pool.query<{ slug: string; meta: any }>(
    `SELECT slug, meta FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' IN ('A','B')
        AND (meta->>'date')::date < $2::date
      ORDER BY (meta->>'date')::date DESC LIMIT 1`,
    [userId, todayISO],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return { lastRaceFinished: null, lastRaceDistanceMi: null };
  const m = r.meta || {};
  // 2026-06-21 · meta.distanceMi is rarely populated on race rows (the editor
  // stores a distanceLabel, not a numeric mile count), so reading it directly
  // returned NaN → recovery mode never armed in production. distanceMiOf does
  // the same label fallback loadGeneratorInputs already trusts for the race
  // path (distanceMi → distanceLabel → name). 2026-07-07 · ultra-honesty audit:
  // distanceMiOf no longer falls through to 13.1 for an unparseable label — an
  // unresolvable last-finished-race distance is treated the same as "no last
  // race" (null) so pickPlanMode never arms recovery mode off a fabricated
  // half-marathon distance.
  const dMi = distanceMiOf(m);
  if (dMi == null) return { lastRaceFinished: null, lastRaceDistanceMi: null };
  return {
    lastRaceFinished: {
      slug: r.slug,
      name: String(m.name || r.slug),
      date: String(m.date),
      distanceMi: dMi,
      // DOCTRINE-5 · A/B/C priority decides how much recovery the race earns
      // (Research/00b §"Recovery by Effort"). Read here rather than re-queried
      // downstream; the SELECT above already filters on it.
      priority: m.priority != null ? String(m.priority) : null,
    },
    lastRaceDistanceMi: dMi,
  };
}

/**
 * Gather all DB-sourced facts a plan needs · race, user prefs, recent
 * volume, easy median, experience level, prescriptions, T-pace, LTHR.
 * Returns a ComposePlanInput ready for composePlan() · OR a failure
 * reason that generatePlan converts to a result.
 *
 * Split from generatePlan() 2026-06-02 so the plan-engine bench can
 * test composePlan() without needing the database.
 */
async function loadGeneratorInputs(
  userId: string,
  raceSlug: string | undefined,
  startAnchor: 'today' | 'monday' = 'monday',
  startDateISO?: string,
  goalTarget?: { distanceMi: number; goalSec: number | null; raceDateISO: string },
  openTarget?: GenerateInput['openTarget'],
): Promise<
  | { ok: true; compose: ComposePlanInput }
  | { ok: false; reason: string }
> {
  const todayISO = await runnerToday(userId);

  // 1. Target — a races row (race-anchored) OR the runner's fitness goal
  // (goal-anchored, no race row). Both resolve to {raceDistanceMi, raceDateISO,
  // goalSec}; everything downstream is identical.
  let raceDateISO: string;
  let raceDistanceMi: number;
  let goalSec: number | null;
  if (openTarget) {
    // ── OPEN-TARGET-1 (2026-08-19) · NO TARGET AT ALL ───────────────────────
    //
    // There is nothing to resolve, so nothing is resolved. What the three
    // fields carry on this path, and why each is the honest value:
    //
    // goalSec = null. No goal exists. Everything downstream that reads it
    //   already handles null: the tier falls back to experience + measured
    //   fitness (`classifyGoalTier`, the `goalPaceSec == null` branch), and
    //   `tPaceSec` falls to the runner's own current-fitness threshold via
    //   `resolveCurrentTPace` — exactly the by-feel path.
    //
    // raceDateISO = today. Not a claimed target date: the two remaining
    //   readers of it on this path are the horizon-race and mid-block-race
    //   queries, which select races strictly BETWEEN today and the target.
    //   Anchoring at today makes both empty, which is correct by construction
    //   — a runner with a future A/B race is not in an open block at all
    //   (`openBlockDue` returns false), so there is no horizon to find.
    //   `persistComposedPlan` overwrites this with the composed block's own
    //   last day before it reaches `training_plans.goal_iso`, so no row ever
    //   records today as a goal.
    //
    // raceDistanceMi — see OPEN_BLOCK_SHAPE_ANCHOR_MI.
    raceDateISO = todayISO;
    raceDistanceMi = openBlockShapeAnchorMi(openTarget.after?.distanceMi ?? null);
    goalSec = null;
  } else if (goalTarget) {
    // 2026-07-07 · ultra-honesty audit P1-41 · /api/profile/goal accepts
    // '50K'/'100K' (ALLOWED_DISTANCES) and used to route every distance
    // through the same periodized builder, including ultras — the same
    // fake-support bug as the race path, just entered via the no-race goal
    // flow instead of Add Race. Same gate, same reason string, so the
    // caller's toFriendlyPlanError path is unchanged either way.
    // ULTRA-OUT-1 (2026-08-19) · the predicate and the runner-facing string now
    // live in supported-distances.ts, so this path, the race path below and the
    // simulator cannot drift into three different accounts of the same refusal.
    if (planAuthorshipUnsupported(goalTarget.distanceMi)) {
      return { ok: false, reason: ULTRA_UNSUPPORTED_REASON };
    }
    raceDateISO = goalTarget.raceDateISO;
    raceDistanceMi = goalTarget.distanceMi;
    goalSec = goalTarget.goalSec;
  } else {
    // 2026-06-05 · backend audit P0-6 fix · scope race lookup by user.
    // races.slug is per-user · without user_uuid filter, plan generation
    // can latch onto another runner's race row with the same slug.
    // Cite docs/2026-06-05-backend-audit.html § P0-6.
    const raceRow = (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1 AND user_uuid = $2`, [raceSlug, userId])).rows[0];
    if (!raceRow) return { ok: false, reason: 'race not found' };
    const meta = raceRow.meta ?? {};
    if (!meta.date) return { ok: false, reason: 'race missing date' };
    raceDateISO = meta.date;
    const dMi = distanceMiOf(meta);
    // 2026-07-07 · ultra-honesty audit P1-41 · distanceMiOf no longer falls
    // through to 13.1 for an unrecognized label — an unresolvable distance
    // means "we don't know", never "assume half marathon". Fail honestly
    // instead of composing a plan for the wrong event.
    if (dMi == null) return { ok: false, reason: 'race distance unrecognized; cannot build a plan for an unknown distance' };
    // GOAL: HONEST UNSUPPORTED (David-approved 2026-07-07) · the Daniels-
    // periodized generator (composePlan/composeMaintenancePlan/
    // composeRecoveryPlan) is built and validated for 5K-through-marathon
    // training doctrine only — Research/00a's periodization tables, taper
    // %s, and long-run caps are all sourced from that range; nothing in
    // Research/ covers 50K/50M/100K/100M periodization. Rather than fake
    // support by quietly capping an ultra at the marathon long-run/pace
    // model (the exact P1-41 bug), the race saves fine (POST /api/race
    // never blocks on this) and generation returns a clear unsupported
    // reason. Callers (race POST, /api/plan/generate) surface it as a
    // friendly message; the runner is left on the no-plan / maintenance
    // machinery (see goal-mode / just-run fallback), never on a wrong plan.
    if (planAuthorshipUnsupported(dMi)) {
      return { ok: false, reason: ULTRA_UNSUPPORTED_REASON };
    }
    raceDistanceMi = dMi;
    goalSec = parseGoalSeconds(meta.goalDisplay);
  }

  // OPEN-TARGET-1 · the two runway gates ask "is there enough time before the
  // race", and on this path there is no race. `raceDateISO` is today, so both
  // would fire — `totalDays < 14` first, refusing with "target < 2 weeks away"
  // about a target that does not exist. Skipped, not loosened: they still bind
  // exactly as before on every path that HAS a target.
  const totalDays = daysBetween(todayISO, raceDateISO);
  if (!openTarget && totalDays < 14) return { ok: false, reason: 'target < 2 weeks away; use race-week briefing only' };
  if (!openTarget && totalDays > 365) return { ok: false, reason: 'target > 1 year out; plan only when within a year' };

  // PACE-3 · sanity-guard the implied pace. A wheel/entry error (e.g. an HM time pasted
  // onto a 5K goal) can imply a >15:00/mi "race pace" that threads an absurd 30-min/mi
  // threshold into every workout. Treat an implausibly slow sub-HM goal as absent → it
  // falls to the currentT fitness anchor (VAR-05) instead of the bogus pace. Scoped to
  // sub-HM ONLY (< 13.1mi) — a >15:00/mi 5K/10K is essentially always a data-entry error
  // (walk pace sustained for 3-6mi is not a realistic "race goal" at that distance), but
  // the SAME absolute pace is an ordinary, common, celebrated HM/marathon finish (a 3:16
  // half or 6:33 marathon at 900 s/mi is a normal run-walk finish, many marathons have
  // 7-8hr cutoffs) — applying the short-distance cap there would erase legitimate slow
  // goals, not catch errors. Cite Research/01:138-145.
  // GOAL-4 (2026-06-23) · null a physiologically OFF-TABLE goal so it can't thread impossible paces
  // into the plan — OFF-THE-TOP (a fast wheel truncation: 45:00 entered for a 1:45 HM → 3:21/mi, or
  // a sub-2:00 marathon → 4:17/mi). vdotFromRace returns null outside VDOT[30,85]; the
  // predictRaceTime(85,…) compare catches the off-the-TOP side (faster than world-class). A nulled
  // goal falls to the currentT fitness anchor (VAR-05). Cite Research/01:138-145.
  // GOAL-4-SLOW-1 (2026-06-23) originally also nulled any HM+/ultra goal implying VDOT < 30 — REMOVED
  // 2026-07-07 (AUDIT P1-56): that tied a wheel-error sanity check to Daniels' VDOT table's citation
  // scope (Research/01:7 "Range: ~30 to 85+"), which conflates "off the VDOT table" with "implausible."
  // A 6:30 marathon goal is a common, entirely legitimate goal for a true-beginner/run-walk runner and
  // was being silently discarded — the exact P1-56 failure mode (a slow runner's data gets erased)
  // applied to GOAL-setting instead of fitness-reading. There is no HM+ equivalent of the sub-HM
  // 900 s/mi cap that doesn't ALSO reject ordinary slow finishers (see the marathon math above), so
  // the guard is removed for HM+ rather than widened. What still protects quality-pace sanity for a
  // too-slow HM+ goal: BRK-1 below (currentT <= goalT → quality trains at currentT, never the slower
  // goalT) — the only realistic way goalT drives quality is when it's FASTER than currentT (the
  // normal "training toward a goal" case), not slower, so a slow-but-honest goal can never thread an
  // absurdly-slow T-pace into quality work; it just becomes the (correctly slow) race-day target.
  if (goalSec != null && (
    (raceDistanceMi < 13.1 && goalSec / raceDistanceMi > 900) ||          // implausibly slow (wheel/entry error, sub-HM only)
    (vdotFromRace(goalSec, raceDistanceMi) == null &&
      goalSec < (predictRaceTime(85, raceDistanceMi) ?? 0))               // off-the-top (VDOT > 85, any distance)
  )) goalSec = null;
  const goalPaceSec = goalSec ? Math.round(goalSec / raceDistanceMi) : null;

  // 2. User prefs · layout
  const prefs = await loadSettings(userId).catch(() => null);
  let longRunDow  = dayKeyToDow((prefs?.long_run_day ?? 'sun') as DayKey);
  let restDow     = dayKeyToDow((prefs?.rest_day ?? 'sat') as DayKey);
  // qualityDows comes from runner prefs · composePlan slices it per-
  // week via densityForWeek() to honor Rule 5 (density ramp).
  // P2-36 (2026-07-06): `?? ['tue','thu']` only catches null/undefined —
  // a runner who deselected every chip in Settings saves quality_days:[]
  // (a real empty array, not absent), so it silently fell through with
  // zero quality days and no quality stimulus ever generated again. An
  // empty selection means "let the coach pick," same as never having set
  // it, so treat length-0 the same as unset.
  let qualityDows = (prefs?.quality_days?.length ? prefs.quality_days : ['tue', 'thu']).map((d) => dayKeyToDow(d as DayKey));

  // 2026-06-20 · available-days placement (goal/race setup asks which days the
  // runner can run). When set (>=2 days), long/quality/easy land ONLY on those
  // days and the rest are rest — Research/22 "shift rest days to user schedule".
  // Unset → keep the prefs above, so existing runners (incl. David) are
  // unchanged. availableDows is threaded to layoutWeek to force the easy days
  // onto available days too.
  let availableDows: Set<number> | null = null;
  const avail = (prefs?.available_days ?? []).map((d) => dayKeyToDow(d as DayKey));
  if (avail.length >= 2) {
    const aset = new Set<number>(avail);
    availableDows = aset;
    // Long run: the runner's chosen long day if available, else the latest
    // weekend day available (Sat > Sun), else the latest available day.
    longRunDow = (aset.has(longRunDow) ? longRunDow
      : aset.has(6) ? 6 : aset.has(0) ? 0 : Math.max(...avail)) as DOW;
    // Rest: keep the runner's rest day if it's already unavailable; else pick
    // the first day they CAN'T run as the (true) rest day.
    const unavail = [0, 1, 2, 3, 4, 5, 6].filter((d) => !aset.has(d));
    restDow = (!aset.has(restDow) ? restDow : (unavail[0] ?? restDow)) as DOW;
    // Quality: available days other than the long day, midweek-first so hard
    // days sit away from the long run. composePlan slices to weekly density.
    qualityDows = spacedQualityDowsFromAvailable(avail, longRunDow);
  }

  // 2026-06-10 · stated training frequency (profile.weekly_frequency,
  // captured at onboarding). Drives BOTH the quality-day count and the
  // total running-days cap (layoutWeek). NULL (David, pre-frequency
  // profiles, Strava-only signups) preserves legacy behavior — the
  // generator fills every non-rest slot and uses prefs' 2 quality days.
  const freqRow = (await pool.query<{ f: number | null }>(
    `SELECT weekly_frequency AS f FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ f: number | null }> }))).rows[0];
  // 2026-06-20 · weekly_frequency now spans 0-6 (true-beginner support).
  //   3-6  → respected exactly as before (existing users unchanged).
  //   1-2  → respected as a hard cap so a low-frequency runner gets 1-2
  //          running days, not the legacy fill-every-slot. (The old `>= 3`
  //          clamp silently dropped 1/2 to null → cap disabled → 5-6 days,
  //          badly over-prescribed for someone who runs twice a week.)
  //   0    → "not running yet" + a goal → a gentle couch-to-X floor of 3
  //          days (the standard beginner run-training frequency). An empty
  //          week can't train toward a goal.
  //   null → David / Strava-only / pre-frequency profiles: legacy fill-
  //          every-slot + prefs' 2 quality days, byte-for-byte unchanged.
  const rawFreq = freqRow?.f != null ? Number(freqRow.f) : null;
  const trainingDaysPerWeek = rawFreq == null ? null
    : rawFreq === 0 ? 3
    : (rawFreq >= 1 && rawFreq <= 7) ? rawFreq
    : null;
  // Quality-day count scaled to the running-day budget so we never prescribe
  // more hard days than the runner has sessions:
  //   1 day  → 0 quality (the single run is just easy/long)
  //   2-4    → 1 quality (the canonical low-frequency 1 long + 1 quality)
  //   5+     → 2 quality
  if (trainingDaysPerWeek != null) {
    const qCount = trainingDaysPerWeek <= 1 ? 0 : trainingDaysPerWeek >= 5 ? 2 : 1;
    qualityDows = qualityDows.slice(0, qCount);
  }

  // 3. Cross-training removed 2026-08-17 (owner ruling). Held as an empty list
  //    at the composer boundary so downstream signatures stay unchanged.
  const crossModes: string[] = [];

  // 4. Plan-shape inputs
  // 2026-06-10 · onboarding anchors week 0 at the runner's chosen start
  // day (startDateISO, clamped to ≥ today), else TODAY (startAnchor),
  // so a mid-week signup never sees runs dated before they existed.
  // Lifecycle regens anchor each plan_weeks row to the training-week
  // boundary. The race-week math is anchor-agnostic: race day always
  // falls in the final 7-day block regardless of where week 0 starts.
  //
  // #10 (audit 2026-06-16) · the lifecycle-regen anchor is now the runner's
  // training-week-start (day AFTER long_run_day), matching /api/plan/week,
  // instead of a hardcoded Monday. So a plan_weeks row spans the same 7 days
  // as the WeekStrip window for non-Sunday-long runners (was: Monday-anchored
  // rows straddled the strip). For David (long=Sun → start=Mon) the boundary
  // IS Monday, so weekStartBoundaryOf == mondayOf — a provable no-op. Both
  // runway endpoints snap to the SAME boundary so totalWeeks stays an exact
  // multiple of 7 (fractional weeks broke phase advancement, the C1 bug class
  // — see composePlan).
  //
  // ── WEEK-ALIGN-1 (2026-08-24) · THE ONBOARDING ANCHOR SNAPS TOO ─────────
  //
  // Until now the onboarding and start-today paths stayed LITERAL, on the
  // reasoning that snapping would date runs before signup. That reasoning was
  // sound and the conclusion was not: the anchor and the clip are two
  // different decisions (see `requestedBlockStartISO`), and holding them as
  // one bought "no run before signup" at the price of a block whose weeks are
  // not the runner's weeks.
  //
  // What it cost, live. A block authored on a Wednesday against a Sunday long
  // run is written in Wed→Tue weeks and read back in Mon→Sun ones — they
  // coincide for one signup weekday in seven. Two of the seven active plans in
  // production on 2026-08-24 were authored exactly that way, and both handed
  // their runner a Today screen whose planned-mileage figure disagreed with
  // the week strip printed directly beneath it (29.5 against 31.0 on one,
  // 3.0 against 2.0 on the other), a "Week N of M" counted off the authored
  // window, and a seven-day strip that is the tail of one training week and
  // the head of the next.
  //
  // So week 0 now starts on the boundary like every other week, and
  // `persistPlan` drops the days before the runner's first (`clipBeforeISO`
  // below). Nothing is dated before signup, and every week the engine authors
  // is a week `trainingWeekWindow` can read back whole. Week 0 is short by
  // however many days the runner missed by signing up mid-week, which is the
  // honest shape of a week you joined on Wednesday.
  const weekStartDow = (longRunDow + 1) % 7;  // day after the long run, per /api/plan/week
  const blockStartISO = requestedBlockStartISO(todayISO, startAnchor, startDateISO);
  const startMondayISO = weekStartBoundaryOf(blockStartISO ?? todayISO, weekStartDow);
  // LSP2-1 (2026-06-23) · a goalTarget race date is start+weeks*7 with NO weekday snap, so it lands on
  // day-0 of its week → SP-4 strips every tune-up/shakeout/easy that wraps onto the post-race days and
  // the final week collapses to a bare race day (all 7 start weekdays, prod-only — the sim snaps and
  // hid it). Snap a goalTarget race to the END of its week (weekStartBoundary + 6 = the long-run day) so
  // the pre-race days fit. goalTarget ONLY — a real race honors its chosen date. totalWeeks is unchanged
  // (the snap stays within the same week). David is a real race → no-op.
  if (goalTarget) raceDateISO = addDays(weekStartBoundaryOf(raceDateISO, weekStartDow), 6);
  const totalWeeks = daysBetween(startMondayISO, weekStartBoundaryOf(raceDateISO, weekStartDow)) / 7 + 1;
  // OPEN-TARGET-1 · same reason as the totalDays gates above. This one measures
  // runway to the target in whole weeks; with no target it measures nothing.
  // The open block's length is the composer's answer — `composeMaintenance-
  // Plan`'s rolling four weeks, or the remainder of Research/00b's reverse
  // taper in `composeRecoveryPlan` — and a legitimate one-week recovery
  // remainder is a plan, not a plan with insufficient runway.
  if (!openTarget && totalWeeks < 3) return { ok: false, reason: 'plan needs at least 3 weeks runway' };

  const isMidBlock = await detectMidBlock(userId);
  // A plan authored on "no quality detected" when we simply could not look
  // rewrites a mid-build runner back to BASE. Refuse instead.
  if (isMidBlock === null) {
    return { ok: false, reason: 'could not read your recent training · try again in a moment' };
  }
  let recentMi = await recentWeeklyMileage(userId);
  const easyFloor = await easyDayMedianMi(userId);
  const recentLongRead = await recentPeakLongMi(userId);
  // A plan authored on a failed read is a plan authored on a fabricated
  // history. Refuse — the runner keeps the plan they have, and the refusal is
  // a correct answer with a reason on it, not an empty state.
  if (recentLongRead === null) {
    return { ok: false, reason: 'could not read your recent runs · try again in a moment' };
  }
  let recentLong = recentLongRead;
  // 2026-06-10 persona-suite fix · cold-start race plans. A brand-new
  // runner has NO runs, so recentMi/recentLong read 0 and the ramp from
  // zero to race-prep peaks trips the progression validator (26.2mi
  // long-run peak, 50% weekly jumps — EVERY race-path onboarding
  // failed). Seed the zeros from the runner's SELF-REPORTED onboarding
  // baselines — the documented purpose of profile.history_* (see
  // /api/onboarding/complete § PLAN-GEN HANDOFF). Self-reports only
  // fill zeros; any real run history always wins.
  if (recentMi <= 0 || recentLong <= 0) {
    const selfReport = (await pool.query<{ avg: number | null; long: number | null }>(
      `SELECT history_avg_weekly_mi AS avg,
              history_longest_recent_mi AS long
         FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] }))).rows[0];
    // 2026-08-17 · COLD-2 · `weekly_mileage_target` was the second rung of this
    // fallback and is NOT a history field — it is what the runner said they WANT
    // to be running. It reached recentWeeklyMi, which anchors the volume curve's
    // start AND (via conservativeVdotFromMileage) the cold-start pace floor: the
    // VDOT floor swings 30 → 47 across the range of that one form input, about
    // 2:30/mi of threshold pace, on an aspiration. `history_avg_weekly_mi` is the
    // field that answers this question; when it is absent the honest answer is
    // zero, which the ramp machinery already handles (BRK-2 / CC2-1).
    // HIGHVOL-1 (2026-08-19) · the `if (recentMi > 50) recentMi = 50` that used
    // to sit here was written when the onboarding ladder topped out at a '45+'
    // bucket whose midpoint was 50, so it only ever collapsed a 55 to a 50 and
    // "50 vs 55 yield identical paces" was true. The ladder now reaches the
    // sub-elite and elite rows of Research/00a §"Volume table" (to 90 mi/wk),
    // and against those the clamp is not a rounding convenience — it HALVES a
    // 100 mi/wk runner's stated base and then paces and sizes their whole plan
    // off the halved number. A self-report is still only a self-report: it
    // remains marked `provisional_mileage` through pace_blend, three readers
    // refuse to inherit it, and the calibration intro runs the opening quality
    // sessions by effort until a real read lands.
    if (recentMi <= 0) recentMi = Number(selfReport?.avg ?? 0) || 0;
    if (recentLong <= 0) recentLong = Number(selfReport?.long ?? 0) || 0;
  }
  // COH-1 · clamp the reported longest run to be coherent with weekly volume (the long anchors
  // the week; an incoherent long mis-sizes the whole plan). Byte-safe for coherent runners.
  recentLong = coherentRecentLong(recentLong, recentMi, trainingDaysPerWeek);
  // 2026-06-03 · mid-block doctrine carriers (Rules 2, 3, 5, 8).
  const recentQualityDist = await recentQualityDistanceMi(userId);
  const recentQualityPW = await recentQualityPerWeek(userId);
  // bestRecentVdot — assembled by the canonical shared loader (B2).
  // A fix to the race/run query now propagates to all call sites automatically.
  // Throws on DB error; generatePlan propagates up (refuses to plan rather than
  // producing a goal-pace plan from undefined VDOT — the C1 bug class).
  const runFloorMi = await goalRunFloorMiForUser(userId);
  const { raceCandidates, runCandidates } = await loadVdotInputs(userId, todayISO);
  const { best: bestVdotPick, belowTableAnchor } = computeBestRecentVdot(raceCandidates, todayISO, 180, runCandidates, runFloorMi);
  // PARITY-1 (2026-06-23) · when there is NO measured signal (empty races+runs → bestVdotPick
  // undefined, the no-Strava cold-start case), seed bestRecentVdot from self-reported onboarding PRs
  // (profile.race_history) — the canonical pace anchor (Research/01:3,115). Prod previously read ONLY
  // races+runs and dropped the reported PR, pacing the runner ~96s/mi too slow; the sim already reads
  // it (sim-inputs.bestVdotFromHistory), so this restores SIM↔PROD parity. Fires only when no measured
  // signal exists — never overrides a real bestVdotPick. Raw vdotFromRace to match the sim exactly.
  let bestRecentVdot = bestVdotPick?.vdot ?? undefined;
  // SELFREPORT-1 (2026-08-21) · whether the number below came from the app's
  // own observations or from the runner's keyboard. It was not recorded, and
  // `composePlan` read "bestRecentVdot is set" as "something was measured" —
  // so a runner with zero runs and zero races on file had the PR they typed
  // persisted as `season_anchor_source: 'measured_vdot'`, inherited into every
  // rebuild, and graded against as if the app had watched them run it.
  let bestRecentVdotSelfReported = false;
  if (bestRecentVdot === undefined) {
    const rhRow = (await pool.query<{ race_history: any }>(
      `SELECT race_history FROM profile WHERE user_uuid = $1 LIMIT 1`, [userId],
    ).catch(() => ({ rows: [] }))).rows[0];
    // LSP2-2 · 180d window (~6mo = '<6mo' bucket midpoint 90d ≤ 180d · '6-12mo' midpoint 270d > 180d).
    // A PR from 8+ months ago does not reflect current fitness; cap to recent races only.
    bestRecentVdot = bestVdotFromRaceHistory(Array.isArray(rhRow?.race_history) ? rhRow.race_history : [], 180);
    bestRecentVdotSelfReported = bestRecentVdot != null;
  }
  // 2026-07-07 · AUDIT P1-56 · belowTableAnchor (from computeBestRecentVdot) is
  // the runner's best race/run when NO candidate produced an in-table VDOT —
  // i.e. bestRecentVdot is still undefined here (race-history seeding above
  // only seeds from self-reported PRs, which is a SEPARATE data source; it
  // does not clear this measured-signal gap). Only meaningful when
  // bestRecentVdot stayed undefined; carried through to composePlan either way
  // (resolveCurrentTPace ignores it once bestRecentVdot is set).
  // maxHr for Rule 16 (easy/long HR cap). loadVdotInputs resolves it
  // internally for the run-candidate gate; hoist separately for composePlan.
  const maxHr = await loadEffectiveMaxHr(userId).then((r) => r.bpm).catch(() => null);
  // Banister TSB · drives Rule 8 cutback frequency. Pull from training
  // form helper which already EWMAs CTL/ATL from runs.
  const tsbAtStart = await (async () => {
    try {
      const { computeTrainingForm } = await import('@/lib/coach/training-form');
      const f = await computeTrainingForm(userId);
      return f?.tsb;
    } catch { return undefined; }
  })();
  // 2026-06-03 · Rule 11 · horizon races · A/B-priority races within 24
  // weeks of the current race day. Filtered to "longer distance than
  // current race" — sharpening races (5K/10K after a HM) don't raise
  // the long-run cap.
  const horizonRacesRows = (await pool.query<{ slug: string; meta: any }>(
    `SELECT slug, meta FROM races
      WHERE user_uuid = $1
        AND (meta->>'date')::date > $2::date
        AND (meta->>'date')::date <= ($2::date + interval '168 days')
        AND meta->>'priority' IN ('A','B')`,
    [userId, raceDateISO],
  ).catch(() => ({ rows: [] }))).rows;
  // HORIZON-1 (2026-06-23) · derive distance via distanceMiOf (its distanceLabel→name fallback), NOT
  // the raw meta.distanceMi jsonb field — which is NULL for every label-only race (the standard write
  // path writes distanceLabel only). The old SQL `(meta->>'distanceMi')::numeric > $3` excluded every
  // label-only horizon, so the half→full bridge (Rule 11) never fired for those users; the same null
  // leaked into Number(m.distanceMi)=NaN → wrong tier + a dead stepping-stone gate. Filter "longer than
  // the current race" in TS via distanceMiOf. (David's CIM has a numeric distanceMi → identical result.)
  const horizonRaces: ComposePlanInput['horizonRaces'] = horizonRacesRows
    .map((r) => ({ r, m: r.meta || {}, dMi: distanceMiOf(r.meta || {}) }))
    // 2026-07-07 · ultra-honesty audit · distanceMiOf now returns null for an
    // unresolvable label instead of assuming 13.1 — drop those rows from the
    // stepping-stone horizon rather than let a null slip into the `> ` compare
    // (which would exclude it anyway, but silently and confusingly via NaN-like
    // behavior; explicit is safer against future refactors).
    .filter((x): x is { r: typeof x.r; m: any; dMi: number } => x.dMi != null && x.dMi > raceDistanceMi)
    .map(({ r, m, dMi }) => {
      const goalSec = parseRaceTime(m.goalDisplay ?? m.goalTime);
      return {
        slug: r.slug,
        name: String(m.name || r.slug),
        date: String(m.date),
        distanceMi: dMi,
        goalPaceSec: goalSec && dMi > 0 ? Math.round(goalSec / dMi) : null,
        priority: (m.priority === 'A' ? 'A' : 'B') as 'A' | 'B',
      };
    });
  // 2026-08-17 · MIDRACE-1 · the runner's OWN dated B/C races INSIDE the
  // plan window (today < date < target race day). composePlan embeds each
  // as a tune-up race day (B: mini-taper + race + recovery days; C: the
  // race converts the week's nearest quality slot). Distance-capped at the
  // target race's distance — a race LONGER than the target isn't a tune-up
  // (the Rule 11 horizon logic owns those). Excludes the target race row
  // itself. Same distanceMiOf label fallback as HORIZON-1 (the raw
  // meta.distanceMi jsonb field is NULL for label-only race rows).
  // Cite: Research/22-plan-templates.md §11 + §Marathon-Advanced
  // ("tune-up half"); Research/01:679-682 (tune-up races as fitness tests).
  const midBlockRaceRows = (await pool.query<{ slug: string; meta: any }>(
    `SELECT slug, meta FROM races
      WHERE user_uuid = $1
        AND (meta->>'date')::date > $2::date
        AND (meta->>'date')::date < $3::date
        AND meta->>'priority' IN ('B','C')
        AND ($4::text IS NULL OR slug <> $4::text)`,
    [userId, todayISO, raceDateISO, raceSlug ?? null],
  ).catch(() => ({ rows: [] as Array<{ slug: string; meta: any }> }))).rows;
  const midBlockRaces: ComposePlanInput['midBlockRaces'] = midBlockRaceRows
    .map((r) => ({ r, m: r.meta || {}, dMi: distanceMiOf(r.meta || {}) }))
    // ULTRA-OUT-1 (2026-08-19) · an ultra is not a tune-up, stated rather than
    // inferred. The `dMi <= raceDistanceMi` cap below ALREADY forecloses this
    // today — the target race can never be an ultra, because the two gates
    // above refuse to author for one — so an ultra B/C race cannot currently
    // reach the embedder by arithmetic. That is an accident of two rules
    // meeting, not a decision, and it would silently reverse the moment the
    // target-race gate moved. The decision itself: `embedMidBlockRaces` treats
    // a B race as a hard session with a mini-taper and a four-day easy window,
    // and 31+ raced miles is not a hard session under any doctrine —
    // Research/00b's recovery window for a marathon-plus effort is measured in
    // weeks. Embedding one would be the same fake-support defect as authoring
    // an ultra plan, wearing a different hat. The block is still authored; the
    // ultra simply is not scheduled around.
    .filter((x): x is { r: typeof x.r; m: any; dMi: number } => x.dMi != null && x.dMi > 0 && x.dMi <= raceDistanceMi && !planAuthorshipUnsupported(x.dMi))
    .map(({ r, m, dMi }) => {
      const goalSecMid = parseRaceTime(m.goalDisplay ?? m.goalTime);
      return {
        slug: r.slug,
        name: String(m.name || r.slug),
        date: String(m.date),
        distanceMi: dMi,
        goalPaceSec: goalSecMid && dMi > 0 ? Math.round(goalSecMid / dMi) : null,
        priority: (m.priority === 'B' ? 'B' : 'C') as 'B' | 'C',
      };
    });
  // 2026-06-02 · ensure totalWeeks is an integer here too · matches
  // the same fix in composePlan. Was producing fractional totalWeeks
  // that broke phase advancement.
  // #10 · same training-week boundary as startMondayISO above so the runway
  // count stays an exact multiple of 7 (no-op for David: boundary == Monday).
  const integerTotalWeeks = Math.max(3,
    Math.floor(daysBetween(startMondayISO, weekStartBoundaryOf(raceDateISO, weekStartDow)) / 7) + 1
  );
  void integerTotalWeeks;  // computed for the early-return check below

  // 5. Experience level
  const expRow = (await pool.query<{ experience_level: string | null }>(
    `SELECT experience_level FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const level = (expRow?.experience_level ?? null) as LevelKey;

  // 6. Prescriptions (workout_library)
  const cat = distanceCategoryOf(raceDistanceMi);
  const [rxQuality, rxRaceSpecific] = await Promise.all([
    resolvePrescriptions(cat, 'quality',        level),
    resolvePrescriptions(cat, 'race_specific',  level),
  ]);

  // 7. T-pace + LTHR + maxHR · plan-wide goal-T (composePlan computes
  //    per-week blend in tPaceForWeek when bestRecentVdot is set, Rule 3).
  //    2026-06-03 · Rule 16 · maxHR drives easy/long HR cap via
  //    spec-builder's max(89% LTHR, 78% maxHR) doctrine.
  //
  //    LTHR · profile.lthr (manual entry, stable per-runner).
  //    maxHR · loadEffectiveMaxHr (canonical · resolves user override
  //            → hybrid 12-mo observed → users.max_hr → null). Reading
  //            profile.max_hr directly would miss the observed peak ·
  //            per task #141 the profile column is not source of truth.
  // 2026-06-06 · Audit C C5 · plan-wide T-pace. 2026-06-23 · VAR-05 · when no goal is set
  // (by-feel) OR an ultra makes tPaceFromGoal return null (PACE-5), anchor to the runner's
  // ACTUAL fitness (currentT from bestRecentVdot, else the conservative mileage estimate),
  // never the flat 480s/mi (8:00/mi) literal — this value feeds authoredState.t_pace_s_per_mi
  // + the per-week blend fallback. conservativeVdotFromMileage is always ≥30 so 480 is now a
  // dead last-ditch. Cite: Research/01 §Daniels-T (T is a function of VDOT, never a constant).
  // 2026-07-07 · AUDIT P1-56 · resolveCurrentTPace tier-2 (belowTableAnchor) replaces
  // conservativeVdotFromMileage when the runner's best race/run implied sub-30 VDOT —
  // see the composePlan-internal currentT fix above for the full rationale. Byte-safe
  // when belowTableAnchor is null (the vast majority of runners): falls straight to
  // the same tPaceFromVdot(bestRecentVdot ?? conservativeVdotFromMileage(recentMi)).
  const currentTLoader = resolveCurrentTPace(
    bestRecentVdot ?? null, belowTableAnchor, recentMi, conservativeVdotFromMileage,
  ).tPaceSec;
  // NEW-A (2026-06-23) · floor the plan-wide tPaceSec at currentT so the MAINTENANCE/RECOVERY composers
  // (which read input.tPaceSec, not tPaceForWeek) can't inherit a SLOW soft-goal pace → threshold quality
  // ~70s/mi slower than easy. Race-prep is unaffected (its goalT derives from input.goalSec, not tPaceSec).
  const goalTpLoader = tPaceFromGoal(goalSec, raceDistanceMi);
  const tPaceSec = (goalTpLoader != null && currentTLoader != null ? Math.min(goalTpLoader, currentTLoader) : goalTpLoader) ?? currentTLoader ?? 480;
  const lthrRow = (await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = lthrRow?.lthr ?? null;
  // maxHr resolved above alongside loadVdotInputs; used here for Rule 16.

  return {
    ok: true,
    compose: {
      raceDistanceMi,
      goalSec,
      goalPaceSec,
      raceDateISO,
      startMondayISO,
      level,
      recentWeeklyMi: recentMi,
      easyDayMedianMi: easyFloor,
      recentLongMi: recentLong,
      recentQualityDistanceMi: recentQualityDist > 0 ? recentQualityDist : undefined,
      recentQualityPerWeek: recentQualityPW > 0 ? recentQualityPW : undefined,
      bestRecentVdot,
      // SELFREPORT-1 · carried alongside the number, never re-derived. The
      // composer cannot tell a typed PR from an observed one by looking at it.
      bestRecentVdotSelfReported,
      // 2026-07-07 · AUDIT P1-56 · threaded to composePlan's currentT/easyAnchorTSec
      // resolveCurrentTPace calls; null when bestRecentVdot is already set (a
      // measured VDOT always wins, this is a fallback signal only).
      belowTableAnchor: bestRecentVdot == null ? belowTableAnchor : null,
      tsbAtStart,
      horizonRaces: horizonRaces.length > 0 ? horizonRaces : undefined,
      midBlockRaces: midBlockRaces.length > 0 ? midBlockRaces : undefined,
      isMidBlock,
      longRunDow,
      restDow,
      qualityDows,
      availableDows,
      trainingDaysPerWeek,
      crossModes,
      rxQuality,
      rxRaceSpecific,
      tPaceSec,
      lthr,
      // 2026-06-03 · Rule 16 · plumbed to persistPlan + buildWorkoutSpec.
      maxHr,
    },
  };
}
