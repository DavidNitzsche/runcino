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
import { pickWorkout, type WorkoutFamily } from './workout-library-static';
import { recoveryDayAfterLongMi } from './plan-templates';
import { buildWorkoutSpec, conservativeVdotFromMileage, resolveMarathonPace, totalDistanceMiFromSpec, capSpecToDistance, retitleReps, retitleLeadMi, STRIDE_DAYS_PER_WEEK, STRIDE_DURATION_S, strideRepsForPhase } from './spec-builder';
import { subLabelFromSpec } from '@/lib/training/expand-spec';
import { parseRaceTime, tPaceFromVdot, vdotFromTpace, iPaceFromVdot, iPaceFromAnchorPace, vdotFromRace, predictRaceTime, bestRecentVdot as computeBestRecentVdot, resolveCurrentTPace, clampToSanePace, EVIDENCE_RUN_FLOOR_MI, type BelowTableAnchor } from '@/lib/training/vdot';
import { achievableRaceTarget, boundedRacePaceSPerMi } from '@/lib/training/achievable-target';
// 2026-06-03 · Rule 16 · canonical max-HR reader · resolves
// users.max_hr_override → hybrid 12-mo observed → users.max_hr → null.
// profile.max_hr is NOT the source of truth per task #141.
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { bestVdotFromRaceHistory } from '@/lib/training/race-history';
import { lookupLoadTierTarget, resolveLoadTier, type TierTarget, type GoalTier, pickPlanMode, MAINTENANCE_BY_TIER, POST_RACE_RECOVERY_WEEKS, postRaceRecoveryWeeks, RECOVERY_WEEKLY_PCT_OF_BASE, RECOVERY_RUN_DAYS, RECOVERY_LONG_PCT, RECOVERY_HALF_WEEKLY_MINUTES, recoveryBlockCeilingPct, BUILD_WINDOW_WEEKS, type PlanMode, type DistCategory, taperFactor, GENERAL_RAMP_CEILING, COMEBACK_RAMP_CEILING, CYCLE_GROWTH_CEILING, PEAK_HOLD_WEEKS, MLR_MAX_WEEK_SHARE, MLR_MIN_MI, TIER_TARGETS } from './goal-tiers';
import {
  type AnchorSource, isProvisionalAnchor, isUnverifiedAnchor, paceBlendAnchorIsProvisional,
  anchorSourceFromCapacityMode,
  CALIBRATION_INTRO_WEEKS, EFFORT_CUED_TYPES,
} from './anchor-provenance';
import { assessGoalVdotSanity } from './goal-vdot-sanity';
import { syntheticPaceAnchors } from './authoring-anchors';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';
import { isBaseBuildingPlan } from './plan-templates';
import { ULTRA_UNSUPPORTED_REASON, planAuthorshipUnsupported } from './supported-distances';
import { isCoachedExternally, COACHED_SKIP_REASON } from './coached-gate';
import { distanceMiOfMeta } from '@/lib/race/distance'; // 2026-07-07 · ultra-honesty audit · shared label→mi parser (handles 50K/50M/100K/100M)
import { fmtPaceSlash } from '@/lib/format/run'; // MIDGOAL-1 (2026-08-30) · the one pace formatter, so a plan note and a screen read the same string
import { shapeTravelWindows, type TravelWindow } from './travel-windows'; // TRAVEL-1 (2026-08-28) · runner-declared travel shapes the composed block
import { ROLE_POST_QUALITY_FREE_DAYS, isRaceRole } from '@/lib/race/race-role'; // RACEROLE-1 (2026-08-28) · answered tune-up roles
import { snapshotSealedDays, logSealSkip, type SealedPrescription } from './seal';
import { resolveBlockAnchor } from './block-anchor';
// PLANVERSION-1 (2026-08-30) · the quality-habit readers describe what the
// RUNNER RAN, so they read `runs` through the shared shape helpers rather than
// joining `training_plans` (which duplicates a day once per plan version).
import { runDaySql, runDistanceMiSql, runWorkoutTypeSql, runTypeSql } from '@/lib/runs/run-shape';
// 2026-08-17 · coaching-loop reconciliation · shared blend implementation
// (authoring + adaptation-time recompute run the same math).
import {
  type LongRunKind,
  DRESS_REHEARSAL,
  isDressRehearsalSlot,
  dressRehearsalDose,
} from './long-run-rows';
import { type CourseTerrain, UNKNOWN_TERRAIN, loadRaceCourseTerrain } from './course-profile';
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
import { progressionSpecFields, RATIONALE_SPEC_KEY } from './progression-spec';
import { validateComposedPlan, longRunWoWCeilingMi, isPlannedDeloadWeek } from './validate';
import { deriveBlockStrategy } from './strategy-contracts';
import { mutatePlan, snapshotPrescription, snapshotActivePrescription } from './mutate';
// 2026-08-25 · the commit gate + the "what moved" line. See lib/plan/plan-delta.ts.
import {
  computeDelta, samePrescription, prescriptionFingerprint, fingerprintDigest,
  type PlanPrescription, type PlanDelta,
} from './plan-delta';
import { EASY_SHARE_FLOOR, SPEC_PROBE_T_PACE_SEC, weekIntensity, splitDay } from './intensity-distribution';
// PHASE-ANSWERS-1 (2026-09-01) · every phase answers what / why now / evidence /
// hold-progress-restructure in a structured field. See ./phase-answers.
import { buildPhaseAnswers, type PhaseAnswer, type ThesisAtAuthoring } from './phase-answers';
// DOCTRINE-DOSING-2 · the composer sizes to the SAME doctrine the gate checks.
// Importing the budget from the module that measures the breach is what makes
// the two unable to disagree — see that file's header.
import {
  DOSE_PACES, slotDosePace, slotDoseBudgetMi, weeklyDoseBudgetMi,
  dayDoses, weekDosingFindings, duplicatePaceFamily, MARATHON_PACE_WORKOUT_CAP, MI_PER_KM,
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
  newCatalogueHistory, recordCatalogueChoice, selectSlotWorkout, selectLongRunVariant,
  MARATHON_ROTATION_EXCLUDED, DOWNHILL_ONLY_SLUGS,
  type CatalogueHistory, type ComposerSlot, type ThesisSlotContext,
} from './catalogue-rx';
import { capFamilyOf, type CapFamily, type PlacedSession } from '@/lib/workout-catalogue/select';
import type { Tier, CatalogueEntry } from '@/lib/workout-catalogue/types';
// #12 follow-up (2026-08-18) · THE race-distance categorizer. generate.ts kept
// four more inline mileage branches after the goal-tiers re-export landed, and
// they had drifted from it — `>= 31` against the canonical 31.07 ultra floor,
// `>= 20` against 19.65, a `>= 12` with no canonical equivalent at all, and a
// `< 7` against 7.75. A race whose distance is unknown returns null here and
// the caller refuses rather than silently becoming a half marathon.
import {
  distanceCategoryOrNull, UNKNOWN_DISTANCE_REASON,
} from '@/lib/race/distance-category';
// COMBINED-STRESS-1 (2026-09-02) · the placement pass's doctrine numbers. See
// lib/plan/combined-stress.ts for what that module owns and why the constants
// live there rather than here.
import {
  returnToLongDays,
  longRunFactorAfterRace,
  raceConsumesLongRunSlot,
  postRaceNoQualityDays as postRaceNoQualityDaysImpl,
  noQualityDaysAfterRace,
  effectiveRecoveryPriority as effectiveRecoveryPriorityImpl,
  type PlacementRecord,
} from './combined-stress';

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
/**
 * VARIETY-R3-1 (2026-08-28) · the composer's quality-type vocabulary.
 *
 * `'speed'` is a COMPOSER-INTERNAL pseudo-type for the 5K/10K third quality
 * day (the R day). It never reaches a DayPlan: the day is written with the
 * existing `intervals` type (DOCTRINE-BASE-2's rep-shaped-day convention, so
 * nothing new reaches the database, the mutation boundary or the watch), and
 * the pseudo-type exists so the scheduler, the dose ledger and the slot
 * resolution can tell the R day apart from the week's I session — two days
 * that share a DayPlan type but spend different Daniels budgets (8% I vs
 * 5% R, `Research/01` §"Dosing rules") and carry different recovery costs.
 */
export type ComposerQualityType = DayPlan['type'] | 'speed';

export function scheduleQuality(
  qualityDows: number[],
  qualityTypes: Array<ComposerQualityType>,
  longRunDow: number,
  restDow: number,
  availableDows: Set<number> | null,
  placementTypes?: Array<ComposerQualityType>,
): { dows: DOW[]; types: Array<ComposerQualityType> } {
  const n = qualityDows.length;
  // VARIETY-R3-1 · is the R day in this week's mix? Read from the placement
  // profile too (QUAL-PHASE-STABLE passes the most gap-demanding parity), so
  // the gap model and the placement always agree about which world they are in.
  const hasSpeed = qualityTypes.includes('speed')
    || (placementTypes?.includes('speed') ?? false);
  // FARTLEK-GAP-SCHED-1 (2026-06-23): fartlek is type='easy' and reqGap=0 in the validator
  // (easy needs no recovery day). gapRank must match so scheduleQuality doesn't displace
  // fartlek from its requested slot just because it's adjacent to the long run.
  //
  // VARIETY-R3-1 · two additions, both read out of Research/22's own advanced
  // sample weeks — the only place doctrine writes a three-quality week down:
  //
  //   · `speed` (the R day) needs NO easy day before the next hard day. Both
  //     sample weeks run it the day before the long ("Sat | WU + 8×400 m @ R
  //     ... | Sun | 10-12 mi E"; "Sat | WU + 10×400 m @ R ... | Sun | 13-14 mi
  //     LR") — §7's work is short reps at full recovery, the same reasoning as
  //     FARTLEK-GAP-SCHED-1's rank-0 fartlek. What it must NOT be is the day
  //     immediately before a threshold session (Research/04 §16 "400m R-pace
  //     day before threshold"), which the ordering below prevents by putting
  //     the R day LAST — after the week's T day, against the long's edge.
  //   · in an R-day week the I session's gap is ONE easy day, not two. The
  //     three-session arithmetic forces the question (I:2 + T:1 + R:0 + long:1
  //     = 4 recovery days in a 7-day week that only has 3), and the sample
  //     weeks answer it: both run the I session with exactly one easy/GA day
  //     before the next quality day ("Tue | ...@ I... | Wed | 6 mi E | Thu |
  //     ...@ T..."). Two-session weeks keep the full 2-day buffer of
  //     Research/00b §"Hard/Easy Alternation" exactly as before.
  const gapRank = (t: ComposerQualityType): number =>
    (t === 'speed' ? 0 : t === 'intervals' ? (hasSpeed ? 1 : 2) : t === 'easy' ? 0 : 1);
  // VDEAD-A (2026-06-23) · PAD types to qualityDows.length so gaps[] aligns 1:1 with dows. When qualityTypes
  // is shorter than the dows (base-building emits 1 type for 2 quality slots), the old slice(0,n) left gaps
  // short → score() read gaps[i]=undefined → NaN slack → a stranded quality day (adjacent to the long, 0 easy
  // between) passed as "legal" → §9 stimulus-gap persist-abort. Cycle the types like the slot-assignment loop.
  //
  // VARIETY-R3-1 · ordering. The plain sort puts the highest-gap type last
  // (intervals toward the long's own buffer). In an R-day week that would put
  // the R day FIRST — often the day straight before the T session, §16's own
  // forbidden pairing — so the sort instead keeps the mix's stated order for
  // the non-speed types (I first, T second: Research/22's "Tue ...@ I / Thu
  // ...@ T") and pins `speed` last, which lands it where both sample weeks put
  // it: against the long run, two days after the T day.
  const typeBase: Array<ComposerQualityType> = qualityTypes.length > 0 ? qualityTypes : ['threshold'];
  const orderKey = (t: ComposerQualityType): number =>
    hasSpeed ? (t === 'speed' ? 1 : 0) : gapRank(t);
  const types = Array.from({ length: n }, (_, i) => typeBase[i % typeBase.length]).sort((a, b) => orderKey(a) - orderKey(b));
  if (n === 0) return { dows: qualityDows.slice().sort((a, b) => a - b) as DOW[], types };
  // QUAL-PHASE-STABLE (2026-06-24) · the DOW placement is driven by the GAP requirements of the type
  // mix. When the QUALITY phase toggles its mix every week (weekIdx%2: intervals-in vs intervals-out),
  // a per-week placement moves the runner's hard-training WEEKDAYS every 7 days (Mon+Wed ↔ Tue+Thu).
  // Fix: when the caller passes a weekIdx-INVARIANT `placementTypes` (the most gap-demanding profile the
  // phase emits), decide the DOWs from THAT so they stay fixed across the phase; the returned `types`
  // still reflect THIS week's actual workouts. The intervals-safe placement is gap-legal for the lighter
  // (intervals-free) weeks too (Research/00b:55-58), so only the TYPE rotates, never the day. Both profiles
  // sort intervals to the last index, so a week that DOES carry intervals still lands it on the gap-2 slot.
  const gapBase: Array<ComposerQualityType> = (placementTypes && placementTypes.length > 0) ? placementTypes : typeBase;
  const gapTypes = Array.from({ length: n }, (_, i) => gapBase[i % gapBase.length]).sort((a, b) => orderKey(a) - orderKey(b));
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
  // VARIETY-R3-1 · when even the best placement cannot seat the THREE-session
  // week, the R day goes first — before any downgrade touches the I or T
  // session. That is Research/00b's own order ("What to Cut First": "3. Second
  // quality session (replace with easy + strides)" comes ahead of "6. Last to
  // be cut: the one remaining quality session that defines the block"), and it
  // restores exactly the two-session week the runner had before VARIETY-R3-1
  // existed: the recursion drops the `speed` entry from the mix and the gap
  // profile and re-runs the unchanged two-session machinery. Fires for e.g. a
  // Saturday-rest Sunday-long runner, whose calendar leaves no legal seat for
  // an R day between the T session and the long.
  if (!bestS.ok && hasSpeed) {
    const si = types.lastIndexOf('speed');
    const gsi = gapTypes.lastIndexOf('speed');
    if (si >= 0 || gsi >= 0) {
      return scheduleQuality(
        best.filter((_, i) => i !== (si >= 0 ? si : best.length - 1)),
        types.filter((_, i) => i !== si),
        longRunDow, restDow, availableDows,
        gapTypes.filter((_, i) => i !== gsi),
      );
    }
  }
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

/**
 * BACKDATE-1 (2026-08-30) · does `persistPlan` write this composed day at all?
 *
 * WEEK-ALIGN-1 (above) separated two questions that had been answered by one
 * variable. There is a THIRD, it was never asked, and not asking it is what
 * backdated a quality session into a week that had already happened:
 *
 *   · WHERE DOES WEEK 0 BEGIN?  `weekStartBoundaryOf` — always a training-week
 *     boundary, so a `plan_weeks` row spans the same seven days every read
 *     surface does. Unchanged by this function.
 *   · WHICH DAY IS THE RUNNER'S FIRST?  `requestedBlockStartISO` — `null` on
 *     the lifecycle-regen path, which keeps the whole current week on purpose.
 *   · MAY A REGEN AUTHOR INTO THE PAST?  Never. This.
 *
 * A regen composes week 0 from the boundary, so up to six of its days are
 * already gone by the time the block is written. Rule 15 carries the OUTGOING
 * plan's prescription onto every past day the runner actually ran, and those
 * days are history worth keeping — that is why `clipBeforeISO` is null here.
 * But a past day the runner did NOT run has no prescription to carry forward,
 * and the freshly-composed one is a decision made after the fact about a day
 * on which nothing can now be done. Writing it invents an instruction that was
 * never given and then records it as disobeyed.
 *
 * OBSERVED LIVE 2026-08-30. David's CIM block, authored from the 08-24
 * boundary, put `tempo 6mi · 1.5 WU · 3 @ T · 1.5 CD` on Tuesday 08-25 — five
 * days past, a day he had not run, so unsealed. Two harms: his adherence
 * history gained a missed quality session that was never prescribed at the
 * time, and the day sits 9 days after his 08-16 half, inside `Research/00b`'s
 * 10-14 day post-half no-quality window — so the new block's first act broke
 * the doctrine that governed the block it was replacing.
 *
 * TODAY IS NOT PAST. The comparison is strictly `<`, so a same-day
 * regeneration still authors today, which every regen path depends on.
 *
 * Pure and exported so the decision can be tested without a database — the
 * same reason `persistedDayShape` was extracted.
 */
export function persistsComposedDay(args: {
  dateISO: string;
  todayISO: string;
  clipBeforeISO: string | null;
  sealed: boolean;
}): boolean {
  // WEEK-ALIGN-1 · a day before the runner's first day is not theirs.
  if (args.clipBeforeISO && args.dateISO < args.clipBeforeISO) return false;
  // BACKDATE-1 · the past is not this block's to author. A sealed day is the
  // outgoing block's prescription being preserved, not this one authoring.
  if (args.dateISO < args.todayISO && !args.sealed) return false;
  return true;
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
 *   · the canonical pace `anchors` price every zone, but the non-race
 *     composers resolve their own (see `composeMaintenancePlan`) rather than
 *     inheriting a race block's.
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
/**
 * WKRESUME-1 (2026-08-25) · the WHOLE row, not its first cell.
 *
 * `RAMP_BASE_RESUME_FRACTION` is the first of three numbers Research/22 §14
 * publishes on one line — "8-14 days | 70% of pre-layoff volume for 1 wk, 85%
 * for wk 2, full for wk 3" — and until now the engine spent that first number
 * and dropped the other two. The 70% week became the BASE of a nine-week
 * geometric climb instead of the first step of a three-week return, so a runner
 * doctrine says is back to full volume in week 3 got there in week 5, and paid
 * for it out of a build that only has eleven weeks to spend.
 *
 * Held as a sequence rather than three constants so the resume can never
 * disagree with the base the lift is computed from: element 0 IS
 * `RAMP_BASE_RESUME_FRACTION`, by construction.
 *
 * Cite: Research/22-plan-templates.md §"Return from Short Layoff (1-2 weeks off)"
 * Bound by RAMP.short-layoff-resume-sequence.
 */
export const RESUME_SEQUENCE: readonly number[] = [RAMP_BASE_RESUME_FRACTION, 0.85, 1.00];
/** Research/22 §14 · "Return from Short Layoff (1-2 weeks off)". Longer + unexplained = moderate layoff. */
export const SHORT_LAYOFF_WEEKS = 2;

/**
 * QUALITYFLOOR-1 (2026-08-30) · the fewest quality sessions Rule 5's density
 * ramp may author in a quality-bearing week. ONE, never zero.
 *
 * `Research/00b` §"Recovery by Race Distance" publishes a "Return to quality
 * workouts" column for every distance — 5K day 6-8, half marathon day 10-14,
 * marathon week 3-4. Every cell names a day on which quality COMES BACK. The
 * no-quality window before it belongs to the recovery composer; by the time a
 * race-prep QUALITY or RACE-SPECIFIC week is being authored, that window is
 * over by construction. A week inside a build that prescribes no quality at all
 * has not returned the runner to training, and no row in that table sanctions
 * it.
 *
 * WHY IT IS NEEDED NOW. `recentQualityPerWeek` measures a 28-day window. For a
 * runner who just raced, most of that window IS the mandated no-quality
 * recovery this engine itself prescribed — so the ramp, reading it literally,
 * would start from ~0 and hand an experienced marathoner a week with no hard
 * running in it. That is the same error `RAMPBASE-1` names for volume, arriving
 * at density: reading the engine's own prescription back as the runner's
 * capability. The owner, 2026-08-30: one threshold session in 28 days because
 * days 1-14 of that window were his half marathon and `Research/00b`'s 10-14
 * day post-half no-quality window.
 *
 * Bound by RULE5.quality-returns-it-does-not-vanish.
 */
export const QUALITY_RETURN_MIN_SESSIONS = 1;

/**
 * CONTINUOUS-RESTORE-1 (2026-08-30) · doctrine's restoration RATE, read out of
 * its own ladder rather than hand-copied: the gap between consecutive rungs of
 * `RESUME_SEQUENCE` (0.85 − 0.70 = 0.15, and 1.00 − 0.85 = 0.15), as a fraction
 * of the sustained level. Research/22 §14 restores a runner at 70% of their
 * pre-interruption volume to 100% in two steps, so a step is 15% of sustained.
 */
export const RESTORE_STEP_FRACTION = RESUME_SEQUENCE[1] - RESUME_SEQUENCE[0];

/**
 * CONTINUOUS-RESTORE-1 (2026-08-30) · the return ladder, as a QUANTITY.
 *
 * ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────
 *
 * The ladder used to be switched on by `RampBaseEvidence.lifted`, which is
 * `0.70 × sustained > mean`. Its logical complement, `mean ≥ 0.70 × sustained`,
 * is `baseRebuilt`. So ONE comparison of two near-identical numbers decided
 * whether a runner got Research/22 §14's three-week restoration or a geometric
 * crawl from a 28-day mean, and the discontinuity at the threshold was
 * infinitely sharp: a runner at 69% of sustained was restored to full volume in
 * three weeks, a runner at 71% was not.
 *
 * THE FITTER RUNNER GOT THE WORSE PLAN. Observed live on the owner's CIM
 * authoring, 2026-08-30: sustained 45.0, resume level 31.50, 28-day mean 31.6 —
 * 70.3% of sustained, three tenths of a percent the wrong side of the line. The
 * ladder never ran. And the number that pushed him over was the good week he
 * had just run: a better recovery week produced a smaller build.
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
 *
 * No threshold, no boolean, no band. The question is not "was this runner
 * interrupted enough to qualify" but "how far below their sustained level are
 * they", and the answer is spent at doctrine's own rate — one
 * `RESTORE_STEP_FRACTION` of sustained per week until sustained is reached.
 *
 *   · a runner AT 70% of sustained  → [70%, 85%, 100%] · Research/22 §14 exactly
 *   · a runner at 77% (the owner)   → [77%, 92%, 100%]
 *   · a runner at 99%              → [99%, 100%] · a one-week nudge, from the
 *                                     same arithmetic, not a special case
 *   · a runner at or above sustained → [] · nothing to restore
 *
 * Every one of those falls out of the same two lines, and the vector moves
 * continuously as `startMi` moves. Nobody experiences a step change from a
 * tenth of a mile.
 *
 * `startMi` is the base the curve ramps from, which is already
 * `max(28-day mean, 0.70 × sustained, demonstrated recent volume)` — so the
 * ladder can never start BELOW doctrine's resume level (the RAMPBASE-1 rule
 * that a runner resumes at a fraction of pre-interruption volume, never at the
 * interruption's own), and never below what the runner is actually running
 * (CURRENTVOL-1). Bounded to three steps by construction, since `startMi` is at
 * least 70% of sustained and each step is 15% of it.
 */
export function restoreSteps(
  startMi: number,
  sustainedMi: number,
  /**
   * POSTRACE-RESTORE-1 (2026-08-30) · has the runner ALREADY spent a week at
   * `startMi`? When true the ladder opens on the first step UP, because the
   * re-entry week doctrine describes has already happened.
   *
   * ── WHICH DOCTRINE GOVERNS, AND WHY IT IS NOT §14 ─────────────────────────
   *
   * `Research/22` §14's ladder is titled "Return from Short Layoff (1-2 weeks
   * OFF)" and its row keys on "8-14 days" — DAYS OFF. Its first rung, 70% of
   * pre-layoff volume, is the week a runner spends coming BACK from not
   * running. A runner who never stopped has not got that week ahead of them;
   * they have just finished it.
   *
   * The owner, 2026-08-30, is the case: `interruptionWeeks` is 0, he ran every
   * week of his post-half window, and the seven days ending that morning held
   * 30.7 miles WITH a 13.5-mile long run in them. Opening his marathon build at
   * ~70% of sustained would have prescribed the week he had just run — the
   * build's first week as a copy of the recovery block it replaces, which is a
   * recovery that never ends.
   *
   * `Research/00b` is the protocol that actually governs a runner coming off a
   * race, and it restores far FASTER than §14, as a percentage of PEAK on a
   * fixed schedule: "| Week 2 | 30-40% |", "| Week 3 | 50-60% |", "| Week 4 |
   * 70-80% |", full by week 5-6. Those are week-over-week steps of roughly
   * +40% to +100% — so one restoration step for a runner who is already past
   * the window (a half's is 10-14 days, and he is at day 14) is a conservative
   * reading of it, not an aggressive one.
   *
   * ── ENTRY-CONTINUOUS-1 (2026-08-30) · Rule 9 · this was a BOOLEAN ─────────
   *
   * It used to be `entryWeekAlreadySpent`, computed as `heldMi >= baseMi`, and
   * it was the last cliff in this ladder. `baseMi` is
   * `max(mean, 0.70 × sustained, heldMi)`, so the boolean flipped exactly where
   * the runner's demonstrated volume crossed the re-entry level — and skipping
   * the rung is worth a whole `RESTORE_STEP_FRACTION` of sustained. Measured on
   * the owner's series, 2026-08-30: a runner holding 31.42 mi/wk against a
   * re-entry level of 31.43 was prescribed 31.4 for week one — the week he had
   * just run — and a runner holding 31.44 was prescribed 38.2. **Six and a half
   * miles of week one on two hundredths of a mile of history.**
   *
   * The question the boolean was asking is not binary. "Has he already spent
   * the re-entry week" is really "how far above or below the re-entry level is
   * he running", and the answer is a distance. So the ladder now opens ONE
   * DOCTRINE STEP above what the runner is demonstrably holding, floored at the
   * re-entry level itself and capped at sustained:
   *
   *     first = min(sustained, max(start, held + step))
   *
   * Both old branches fall out of it unchanged, which is why this is a
   * generalisation rather than a new rule. A runner coming back from NOT
   * running has `held` at or near zero, `held + step` is far below `start`, and
   * the ladder opens on `start` — `Research/22` §14 exactly. A runner holding
   * the base has `held === start` (since `start` is the max that `held` is a
   * term of), so the ladder opens on `start + step` — POSTRACE-RESTORE-1
   * exactly. Everything between the two is now a straight line instead of a
   * step, and the value moves with the runner's own mileage rather than with
   * which side of a comparison it landed on.
   */
  heldMi = 0,
): number[] {
  const start = Math.max(0, startMi || 0);
  if (!(sustainedMi > 0) || !(start < sustainedMi)) return [];
  const stepMi = sustainedMi * RESTORE_STEP_FRACTION;
  if (!(stepMi > 0)) return [];
  // ENTRY-CONTINUOUS-1 · the first authored week: one doctrine step above what
  // the runner is demonstrably holding, never below the re-entry level, never
  // past sustained. Continuous and monotone in `heldMi`.
  const held = Math.max(0, heldMi || 0);
  const first = Math.min(sustainedMi, Math.max(start, held + stepMi));
  const steps: number[] = [Math.round(first * 10) / 10];
  let v = first;
  // The bound is arithmetic, not a policy cap: start ≥ 0.70 × sustained and a
  // step is 0.15 × sustained, so this can only ever run twice. The guard is
  // here so a future change to either number cannot spin.
  while (v < sustainedMi - 1e-9 && steps.length < RESUME_SEQUENCE.length) {
    v = Math.min(sustainedMi, v + stepMi);
    steps.push(Math.round(v * 10) / 10);
  }
  return steps;
}

export interface RampBaseEvidence {
  /** The base volumeCurve ramps from. */
  baseMi: number;
  /** The 28-day mean it would have used. */
  meanMi: number;
  /** Rank-3 week of the look-back. 0 when there is no history. */
  sustainedMi: number;
  /**
   * WKPEAK-1 · the runner's biggest rolling 7-day block in the look-back — the
   * peak this cycle's peak is measured against. `resolvePeakWeekly`'s number,
   * from the same daily series `sustainedMi` is ranked out of, so the two can
   * never describe different windows. 0 when the caller supplied none, and the
   * cycle-growth ceiling is then inert (every synthetic archetype, every
   * cold-start authoring).
   */
  peakMi: number;
  /**
   * WEEKS-EQUIVALENT OF ABSENCE in the most recent `allowedInterruptionWeeks + 1`
   * blocks. Fractional: a block at zero miles counts a full week, a block at the
   * resume level counts none, and a block half-way counts half. See
   * `absenceWeeksEquivalent` for why this is not a count of weeks below a line.
   */
  interruptionWeeks: number;
  /** How long an interruption this authoring is entitled to look through. */
  allowedInterruptionWeeks: number;
  /** True when the sustained level (not the mean) set the base. */
  lifted: boolean;
  /**
   * CURRENTVOL-1 · the volume the runner is demonstrably holding right now:
   * the better of the two most recent completed 7-day blocks, bounded above by
   * `sustainedMi` so one outlier week can never set it. 0 when there is no
   * history, and 0 on the layoff path (the comeback protocols own that ramp).
   *
   * A FLOOR under the base and under every resume step — never a ceiling, never
   * a reduction.
   */
  heldMi: number;
  /**
   * CURRENTVOL-1 · true when the runner has a known sustained level that they
   * are currently below, and the low stretch is within the allowance. THIS, not
   * `lifted`, is the question the three-week return ladder answers.
   */
  returning: boolean;
  /**
   * POSTRACE-RESTORE-1 · true when the base is the volume the runner is
   * DEMONSTRABLY holding (`heldMi` is the binding term) rather than a re-entry
   * level being prescribed to them. A runner who has already been running at
   * the base has spent the ladder's first rung; one who is coming back from not
   * running has not. See `restoreSteps`.
   */
  heldByCurrent: boolean;
}

/**
 * ABSENCE-CONTINUOUS-1 (2026-08-30) · Rule 9 · how much has this runner been
 * AWAY, in weeks — measured so a hair cannot move it.
 *
 * ── WHAT IT REPLACES, AND WHY THAT WAS A CLIFF ──────────────────────────────
 *
 * `interruptionWeeks` used to be a count of the CONSECUTIVE most-recent 7-day
 * blocks below the resume level:
 *
 *     while (i < series.length && series[i] < resumeLevel) i++;
 *
 * Two things are wrong with that, and the second is the one that hurt.
 *
 * 1 · IT RESETS ON ONE WEEK. The scan stops at the first block at or above the
 *     resume level, so a runner three weeks into a dip whose most recent week
 *     lands a fifth of a mile over the line is reported as having no
 *     interruption at all. Measured on the owner's own series, 2026-08-30:
 *     blocks [31.3, 25.6, 20.9] against a resume level of 31.43 reported THREE;
 *     the same blocks scaled by half a percent — [31.5, 25.7, 21.0] — reported
 *     ZERO. The count moved three weeks for 0.2 mi, `lifted` flipped with it,
 *     and an entire BASE phase appeared in the block. Week one moved 29 → 39.
 *     THE FITTER RUNNER GOT THE WORSE PLAN, which is Rule 9's stated signature.
 *
 * 2 · IT IS A MILEAGE THRESHOLD STANDING IN FOR A DAYS-OFF QUESTION, which is
 *     the shape Rule 9's corollary says to remove rather than smooth. The
 *     allowance it is compared against comes from `Research/22` §14, and that
 *     section keys on DAYS OFF in its own row headers — "| 1-7 days |",
 *     "| 8-14 days |" — while §"Return from Moderate Layoff (3-8 weeks)" keys
 *     on WEEKS off. Doctrine never asks how many weeks a runner spent below 70%
 *     of his best; it asks how long he was not running. "Below the resume level"
 *     was a proxy for that, and a proxy with a step in it.
 *
 * ── WHAT THIS MEASURES INSTEAD ──────────────────────────────────────────────
 *
 * The same quantity doctrine states, read continuously: WEEKS-EQUIVALENT OF
 * ABSENCE. Each block contributes its shortfall against the resume level as a
 * fraction of that level — a block at zero miles is one week off, a block at the
 * resume level is none, a block at half the resume level is half a week off —
 * and the contributions are summed over a fixed window so no single week can
 * erase the ones behind it.
 *
 * At doctrine's own integer points it reproduces doctrine exactly: two weeks of
 * no running is 2.0, which is `SHORT_LAYOFF_WEEKS` and §14's "1-2 weeks off";
 * three is 3.0, which is where §"Return from Moderate Layoff (3-8 weeks)" takes
 * over. Between them it interpolates instead of stepping.
 *
 * ── THE WINDOW IS THE ALLOWANCE PLUS ONE ────────────────────────────────────
 *
 * Not a free parameter. The decision this feeds is `interruption > allowed`, so
 * the shortest span that can carry more than `allowed` weeks of absence is
 * `allowed + 1` weeks, and that is the window. Summing over anything longer
 * would count the weeks the allowance has already FORGIVEN a second time — a
 * runner whose taper and post-race recovery are explained by his race would have
 * those same weeks accumulate against him from outside the allowance. Summing
 * over anything shorter could not reach the allowance at all.
 *
 * A consequence worth stating plainly, because it is a real behaviour change:
 * the layoff branch now requires the whole window to be close to empty. Three
 * weeks at 25 mi/wk off a 45 mi/wk sustained level used to read as a layoff and
 * insert a BASE phase; it now reads as what it is, a dip, and the runner keeps
 * his base. Three weeks at 2 mi/wk still reads as a layoff, which is the case
 * `_base_gate_invariant.test.ts` and `RAMPBASE.resume-from-pre-interruption-volume`
 * exist to hold.
 *
 * ── WHAT IS STILL DISCRETE, AND WHY THAT IS ALLOWED ─────────────────────────
 *
 * `interruption > allowed` remains a binary handoff, because what sits on the
 * other side of it is a different PROTOCOL — `Research/22` §"Return from
 * Moderate Layoff" and `Research/05`, not §14's ladder — and Rule 9 permits a
 * discrete behaviour. What it forbids is a decision hinging on a hair. Reaching
 * that boundary now requires near-total absence across the whole window, the
 * quantity moves continuously with the daily series, and no single week can
 * shift it by more than the one week it actually represents.
 */
export function absenceWeeksEquivalent(
  /** Most-recent-first 7-day sums. */
  series: readonly number[],
  /** `sustained × RAMP_BASE_RESUME_FRACTION`. Must be > 0. */
  resumeLevel: number,
  allowedInterruptionWeeks: number,
): number {
  if (!(resumeLevel > 0)) return 0;
  const window = Math.max(1, Math.floor(Math.max(0, allowedInterruptionWeeks)) + 1);
  let weeks = 0;
  for (let i = 0; i < window && i < series.length; i++) {
    const shortfall = (resumeLevel - series[i]) / resumeLevel;
    weeks += Math.max(0, Math.min(1, shortfall));
  }
  // Two decimals · a hundredth of a week is a seventh of a day, well past the
  // resolution of anything downstream, and it keeps the value printable.
  return Math.round(weeks * 100) / 100;
}

/**
 * Pure half of RAMPBASE-1. `weeklySeries` is most-recent-first 7-day sums.
 * Exported for direct unit testing — the worktree has no DB pool.
 */
export function resolveRampBase(opts: {
  meanWeeklyMi: number;
  weeklySeries: number[];
  allowedInterruptionWeeks: number;
  /** WKPEAK-1 · `resolvePeakWeekly` over the same look-back. Omit when unknown. */
  peakWeeklyMi?: number | null;
}): RampBaseEvidence {
  const mean = Math.max(0, opts.meanWeeklyMi || 0);
  const series = opts.weeklySeries.filter((v) => Number.isFinite(v)).map((v) => Math.max(0, v));
  // WKPEAK-1 · carried through every return path below, including the
  // no-history ones — a caller that measured a peak has measured it whether or
  // not the ramp lift applies.
  const peakMi = Number.isFinite(opts.peakWeeklyMi) && (opts.peakWeeklyMi ?? 0) > 0
    ? Math.round((opts.peakWeeklyMi as number) * 10) / 10
    : 0;
  // CURRENTVOL-1 · the better of the two most recent completed 7-day blocks.
  // Corroborated rather than a raw max: one freak week cannot speak for the
  // runner, and one down week inside a fortnight of real training cannot erase
  // what the week beside it demonstrates.
  const recentDemonstratedMi = Math.max(series[0] ?? 0, series[1] ?? 0);
  const base0: RampBaseEvidence = {
    baseMi: mean, meanMi: mean, sustainedMi: 0, peakMi,
    interruptionWeeks: 0, allowedInterruptionWeeks: opts.allowedInterruptionWeeks, lifted: false,
    heldMi: 0, returning: false, heldByCurrent: false,
  };
  if (series.length < RAMP_BASE_SUSTAINED_RANK) return base0;
  const sorted = [...series].sort((a, b) => b - a);
  const sustained = sorted[RAMP_BASE_SUSTAINED_RANK - 1] ?? 0;
  if (!(sustained > 0)) return base0;
  const resumeLevel = sustained * RAMP_BASE_RESUME_FRACTION;
  const interruption = absenceWeeksEquivalent(series, resumeLevel, opts.allowedInterruptionWeeks);
  const evidence: RampBaseEvidence = {
    ...base0, sustainedMi: Math.round(sustained * 10) / 10, interruptionWeeks: interruption,
  };
  if (interruption > opts.allowedInterruptionWeeks) return evidence;   // a layoff, not a deload
  const lifted = resumeLevel > mean;
  const liftedBase = lifted ? Math.round(resumeLevel * 10) / 10 : mean;
  // ── CURRENTVOL-1 (2026-08-30) · never ramp from below where the runner IS ──
  //
  // RAMPBASE-1 stated the rule — "a runner resumes at a fraction of their
  // PRE-interruption volume, never at the interruption's own" — and then
  // implemented it only for the case where 70% of sustained clears the 28-day
  // mean. When the mandated deload is SHALLOW, the mean still governs, and the
  // mean still contains the deload. The same defect, one rung down, reachable
  // by any runner whose recovery block was not deep enough to trip the lift.
  //
  // OBSERVED LIVE 2026-08-30, and it turned on a tenth of a mile. Owner's CIM
  // authoring: sustained 45.0, so the resume level is 31.50; his 28-day mean
  // was 31.6, because that window straddles his 08-16 half, its taper (23.2)
  // and its recovery (28.4). 31.50 < 31.6, so `lifted` was false and the base
  // was the mean — 31.6 mi/wk — while the seven days ending that same morning
  // totalled 34.7 with a 13.5-mile long run inside them. The build opened
  // BELOW the recovery block it was replacing: week 1 came out at 35 mi
  // against a 34.7 he had just run, which is a plateau wearing a build's name,
  // and the easy days were whatever was left after a 14-mile long and two
  // 6-mile quality sessions — 3.0 mi against a 4.0 mi demonstrated easy day.
  //
  // THE RULE. A base is a volume the runner is holding. The most recent
  // completed 7-day block is the least deniable evidence of that, so it is a
  // FLOOR under the base — never a ceiling, and never a reduction.
  //
  // BOUNDED BY `sustained`, which is what keeps this from becoming the
  // outlier-week bug `RAMP_BASE_SUSTAINED_RANK` exists to prevent: one huge
  // week can lift the floor no higher than a level the runner has already
  // reached three times in the look-back. Ramping from your own sustained
  // level is, by construction, ramping from somewhere you have been.
  //
  // NOT APPLIED PAST THE ALLOWANCE. The early return above still wins: a
  // genuine layoff hands the ramp to the comeback protocols untouched.
  //
  // BYTE-IDENTICAL for a runner in steady training, where the recent blocks,
  // the mean and the sustained level are the same number, and for every
  // synthetic archetype (which never reaches this reader at all).
  const heldMi = Math.round(Math.min(evidence.sustainedMi, recentDemonstratedMi) * 10) / 10;
  const baseMi = Math.max(liftedBase, heldMi);
  return {
    ...evidence,
    baseMi,
    lifted,
    heldMi,
    // CONTINUOUS-RESTORE-1 · the ladder's real entry condition, and the reason
    // `lifted` stops being a behavioural switch: is there a sustained level
    // this runner is currently below? The allowed-interruption entitlement is
    // already spent — the layoff branch returned above, with `returning` false,
    // so the comeback protocols keep owning that ramp untouched.
    returning: evidence.sustainedMi > 0 && baseMi < evidence.sustainedMi,
    // POSTRACE-RESTORE-1 · the base IS what he is running, not a level being
    // prescribed to him — so the ladder's re-entry rung has already been spent.
    heldByCurrent: heldMi >= baseMi - 1e-9,
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

// ── RULE8-1 (2026-08-30) · a taper or a recovery window is never the normal ──
//
// CLAUDE.md Rule 8, locked after the owner said it twice and the second time as
// an absolute: "It cannot look at taper and recover as my 'normal'. Ever."
//
// Every reader that answers "what does this runner normally do" must exclude the
// days the engine ITSELF prescribed as taper, race week and post-race recovery.
// Six distinct defects in this one engine came from not doing it, every one
// found by the runner and none by a gate, because every output was well-formed:
// a 31 mi/wk marathon opener, 4-mile easy days, one quality session where his
// habit is two, a long-run ramp anchored to a taper long.
//
// EXCLUDE, DO NOT WIDEN. A longer average still CONTAINS the taper; it only
// dilutes it. And if excluding leaves too little to answer honestly, the reader
// REFUSES — `null`, distinguishable downstream from a measured zero, because a
// zero inside a prescribed recovery block and a zero off a detrained runner are
// opposite facts. Falling back to the contaminated window is how all six landed.
//
// The bounds are doctrine-bound and already in this file. They are not
// re-derived here: `BLOCK_SHAPE[cat].taperWeeks` before the race and
// `postRaceRecoveryWeeks(cat, priority)` after — the same two numbers
// `allowedInterruptionWeeksFor` assembles.

/** RULE8-1 · a closed date range the engine prescribed. Inclusive both ends. */
export interface PrescribedSpan { startISO: string; endISO: string }

/**
 * RULE8-1 · the span around a race the runner ACTUALLY RAN that the engine
 * itself wrote: its taper lead-in through its post-race recovery window.
 *
 * Null when nothing explains a quiet stretch — no race, or a history row whose
 * distance we cannot resolve, which explains no mandated window and so excludes
 * nothing. A `5k` returns a span too (1 taper week), because even a short race
 * has a lead-in the engine authored.
 */
export function prescribedSpanFor(
  raceDateISO: string | null | undefined,
  raceDistanceMi: number | null | undefined,
  racePriority: string | null | undefined,
): PrescribedSpan | null {
  if (!raceDateISO || raceDistanceMi == null || !(raceDistanceMi > 0)) return null;
  const cat = distanceCategoryOrNull(raceDistanceMi);
  if (cat == null) return null;
  const taperDays = BLOCK_SHAPE[cat].taperWeeks * 7;
  const recoveryDays = postRaceRecoveryWeeks(cat, racePriority ?? null) * 7;
  if (taperDays <= 0 && recoveryDays <= 0) return null;
  return { startISO: addDays(raceDateISO, -taperDays), endISO: addDays(raceDateISO, recoveryDays) };
}

/**
 * RULE8-1 · the most recent `n` days that are NOT inside any prescribed span,
 * most-recent-first. Walks back day by day, skipping what the engine wrote.
 *
 * `maxLookbackDays` bounds how far back it will reach for them. Returning FEWER
 * than `n` days is the signal that there is not enough representative training
 * to answer — callers must refuse on it rather than spend a short sample.
 */
export function eligibleDaysBack(
  todayISO: string,
  n: number,
  spans: readonly PrescribedSpan[],
  maxLookbackDays = 365,
): string[] {
  const out: string[] = [];
  const inSpan = (d: string) => spans.some((s) => d >= s.startISO && d <= s.endISO);
  for (let k = 0; out.length < n && k <= maxLookbackDays; k++) {
    const d = addDays(todayISO, -k);
    if (!inSpan(d)) out.push(d);
  }
  return out;
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
  // WKPEAK-1 · the peak comes off the SAME `daily` this function already
  // fetched — one read, both numbers, and no second window to drift.
  return resolveRampBase({
    meanWeeklyMi, weeklySeries: series, allowedInterruptionWeeks: allowed,
    peakWeeklyMi: resolvePeakWeekly(daily),
  });
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
/**
 * RULE8-2 (2026-08-30) · TWO QUESTIONS, ONE NAME — the `lifted` disease again.
 *
 * `recentLongMi` fed two consumers with opposite semantics, and Rule 8 applies
 * to exactly one of them:
 *
 *   · `longFloor` asks A HABIT QUESTION — "what long run is normal for this
 *     runner, so we never author one shorter". Measured across the owner's AFC
 *     taper and recovery it read 13.5, his taper long, when he had run 18.0 on
 *     2026-07-25. That is Rule 8's fourth row and it is fixed here:
 *     `representativeMi` skips the prescribed span.
 *
 *   · `rampCeiling` asks A DOCTRINE QUESTION with its own window written into
 *     the citation — `Research/00a` §"Volume progression rules": "An individual
 *     run >110% of longest run in the PRIOR 30 D raises overuse injury risk by
 *     ~64%". That thirty days is the rule, not an accident of implementation. A
 *     runner whose longest run in the last thirty days really is 13.5 is at
 *     spike risk on an 18-miler however fit he was in July, and Rule-8-filtering
 *     this one would let the engine author 148% of his actual recent longest and
 *     call it doctrine. `literalMi` stays literal.
 *
 * Rule 8 says a taper is never the runner's NORMAL. It does not say a taper
 * never happened — and the spike rule is precisely a question about what has
 * recently happened to his connective tissue.
 */
interface RecentLongRead {
  /** Literal MAX over the last 28 calendar days · the spike-guard anchor. */
  literalMi: number;
  /** MAX over 28 REPRESENTATIVE days · the habit floor. Null when refused. */
  representativeMi: number | null;
}

async function recentPeakLongMi(
  userId: string,
  todayISO: string,
  spans: readonly PrescribedSpan[],
): Promise<RecentLongRead | null> {
  const r = await rowOrNull<{ mi: string | null }>(
    'plan/generate · recentPeakLongMi',
    pool.query<{ mi: string | null }>(
      `SELECT MAX((data->>'distanceMi')::numeric)::text AS mi
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date
            >= $2::date - 28`,
      [userId, todayISO],
    ),
  );
  if (r === null || r === undefined) return null;
  const literalMi = Math.round((Number(r.mi ?? 0)) * 10) / 10;

  const days = eligibleDaysBack(todayISO, HABIT_ELIGIBLE_DAYS, spans);
  let representativeMi: number | null = null;
  if (days.length >= HABIT_ELIGIBLE_DAYS) {
    const rep = await rowOrNull<{ mi: string | null }>(
      'plan/generate · recentPeakLongMi · representative',
      pool.query<{ mi: string | null }>(
        `SELECT MAX(${runDistanceMiSql('r')})::text AS mi
           FROM runs r
          WHERE r.user_uuid = $1::uuid
            AND NOT (r.data ? 'mergedIntoId')
            AND (${runDaySql('r')})::date = ANY($2::date[])`,
        [userId, days],
      ),
    );
    if (rep !== null && rep !== undefined && rep.mi != null) {
      const v = Math.round(Number(rep.mi) * 10) / 10;
      if (Number.isFinite(v) && v > 0) representativeMi = v;
    }
  }
  return { literalMi, representativeMi };
}

/**
 * LONGEVIDENCE-1 (2026-09-02) · THE LONGEST RUN THIS RUNNER HAS ACTUALLY DONE.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 *
 * The block's long-run ceiling was `TIER_TARGETS[cat][tier].peakLongMiBand[1]`
 * and nothing else — a number keyed to `profile.experience_level`, which is a
 * word the runner typed at onboarding. The owner's ruling, 2026-09-02: "My
 * actual history — not an onboarding label — must determine appropriate load",
 * and for the long run specifically, "choose from evidence, not from the old
 * plan or a generic tier."
 *
 * `recentPeakLongMi` cannot answer this. Both of its halves are 28-day
 * questions on purpose — one literal for the spike rule, one representative for
 * the habit floor — and a block ceiling is neither. Measured on the reference
 * marathoner: his 28-day habit long is 18.0 mi and he has completed 21.5.
 * Sizing a fifteen-week build's ceiling off 18 would tell a runner his cycle
 * may not reach a distance he has already run, which is CLAUDE.md's "current
 * fitness is a SAFETY FLOOR, not a ceiling" inverted.
 *
 * ── WHAT IT READS ────────────────────────────────────────────────────────────
 *
 * The longest single canonical run over the runner's ELIGIBLE days in the last
 * year — Rule 8's habit lane, so every taper lead-in and post-race recovery
 * window is excluded by `spans`, and with them the races themselves: a raced
 * marathon sits inside its own prescribed span and never reaches this number.
 * That is the correct exclusion twice over, because a race is not a training
 * long run and `Research/00b` governs the days around it.
 *
 * Rule 11: null is a FAILED READ, distinct from a runner with no long runs,
 * who reads 0. The caller must not treat them alike.
 */
export const DEMONSTRATED_LONG_ELIGIBLE_DAYS = 365;

async function demonstratedLongMi(
  userId: string,
  todayISO: string,
  spans: readonly PrescribedSpan[],
): Promise<number | null> {
  const days = eligibleDaysBack(todayISO, DEMONSTRATED_LONG_ELIGIBLE_DAYS, spans,
    DEMONSTRATED_LONG_ELIGIBLE_DAYS);
  if (days.length === 0) return 0;
  // A RACE IS NOT A TRAINING LONG RUN, and `races` is the authority on which
  // days were races (CLAUDE.md, race-data source-of-truth). Rule 8's prescribed
  // spans do NOT cover this on their own: the loader builds a span for the
  // runner's LAST race only, so without this the reference marathoner's
  // demonstrated long read 26.8 — Big Sur — and the block's ceiling would have
  // been set by a marathon he raced in April.
  const r = await rowOrNull<{ mi: string | null }>(
    'plan/generate · demonstratedLongMi',
    pool.query<{ mi: string | null }>(
      `SELECT MAX(${runDistanceMiSql('r')})::text AS mi
         FROM runs r
        WHERE r.user_uuid = $1::uuid
          AND NOT (r.data ? 'mergedIntoId')
          AND (${runDaySql('r')})::date = ANY($2::date[])
          AND (${runDaySql('r')})::date NOT IN (
            SELECT (meta->>'date')::date FROM races
             WHERE user_uuid = $1::uuid AND meta->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}$'
          )`,
      [userId, days],
    ),
  );
  if (r === null || r === undefined) return null;
  const v = Math.round(Number(r.mi ?? 0) * 10) / 10;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * LONGEVIDENCE-1 · the block's long-run ceiling, from the runner rather than
 * from the label on their profile.
 *
 * Two readings, and the block takes the larger:
 *
 *   · WHAT HE HAS ALREADY DONE — `demonstratedLongMi`. A distance already
 *     completed in normal training is a floor on what this cycle may ask for,
 *     not a ceiling. CLAUDE.md: "Current fitness is a SAFETY FLOOR, not a
 *     ceiling."
 *   · WHAT DOCTRINE LICENSES HIM TO ADD — his recent normal-training long grown
 *     by one cycle's allowance. `Research/00a` §"Volume progression rules" ·
 *     "Year-on-year base growth | 5-15% per training cycle for trained
 *     athletes", which is the same row and the same reading
 *     `CYCLE_GROWTH_CEILING` already takes for weekly volume. Beginners have no
 *     per-cycle figure in that row (the table states it for TRAINED athletes),
 *     so this arm is simply unavailable to them and the demonstrated value
 *     stands alone.
 *
 * The tier band is still applied, as a CAP rather than as the driver: doctrine
 * publishes a peak-long band per distance and no block should exceed the top of
 * it, but nothing licenses a band keyed to a self-declared word to REACH up and
 * set a runner's ceiling on its own.
 *
 * Returns null when there is no long-run evidence at all — a cold-start runner,
 * or a failed read. The caller keeps the band, which is the only answer
 * available for someone with no history, and Rule 11 keeps the two apart at the
 * call site rather than here.
 */
export function evidenceLongCeilingMi(args: {
  demonstratedLongMi: number | null;
  recentLongMi: number;
  level: LevelKey;
  tierPeakLongMi: number;
}): number | null {
  // MEASURED EVIDENCE IS THE GATE, and it is the whole gate. Without a
  // demonstrated long run there is nothing here to reason from: a self-reported
  // "longest run 0-3 mi" at onboarding is a starting point, not a capability
  // ceiling, and `Research/22`'s beginner marathon rows build such a runner to
  // a 16-20 mi long — many times what one cycle's 15% would license. Applying
  // the growth arm to a self-report crushed 8,781 archetypes' long runs to a
  // few miles on the first run of this function. So: no measured long run, no
  // evidence ceiling, and the band stands as the only answer available.
  const demonstrated = args.demonstratedLongMi != null && args.demonstratedLongMi > 0
    ? args.demonstratedLongMi : 0;
  if (!(demonstrated > 0)) return null;
  const growth = args.level ? CYCLE_GROWTH_CEILING[args.level] : null;
  const grown = growth != null && args.recentLongMi > 0 ? args.recentLongMi * growth : 0;
  const earned = Math.max(demonstrated, grown);
  return Math.min(args.tierPeakLongMi, Math.round(earned * 2) / 2);
}

/**
 * 2026-06-03 · runner's recent quality-day median distance (last 28d).
 * Rule 2 floor source. "Quality day" = a run that landed on a plan
 * workout of type tempo/threshold/intervals, OR (cold-fallback) a run
 * with avgHr ≥ 85% of effective max. Returns 0 when no signal.
 */
async function recentQualityDistanceMi(
  userId: string,
  todayISO: string,
  spans: readonly PrescribedSpan[],
): Promise<number | null> {
  // 2026-06-03 fix · plan_workouts has NO matched_run_id column.
  // Matching was date-based: JOIN runs ON (data->>'date')::date = pw.date_iso.
  // The query before that silently returned 0 (caught error) · Rule 2 floor
  // never fired since it shipped.
  //
  // PLANVERSION-1 (2026-08-30) · THE PLAN JOIN IS GONE. See the full story in
  // `recentQualityPerWeek` below: joining `training_plans` on nothing but the
  // user reached every plan that user has ever had, and each rebuild carries
  // its own copy of every day. The owner's account, 2026-08-30: 71 rows for
  // THREE dates, and two of those three were "threshold" only because plans
  // authored 2026-05-13 — and archived the same afternoon — had projected a
  // threshold onto that August date. The runner's own run rows say what he
  // actually ran, they cannot be duplicated by re-authoring, and they are what
  // this Rule 2 floor was always trying to describe.
  //
  // RULE8-1 (2026-08-30) · and the window skips the days the engine prescribed.
  // A quality session's typical DISTANCE measured across a taper is the taper's
  // distance, not the runner's.
  const days = eligibleDaysBack(todayISO, HABIT_ELIGIBLE_DAYS, spans);
  if (days.length < HABIT_ELIGIBLE_DAYS) return null;
  const r = await rowOrNull<{ med: string | null }>(
    'plan/generate · recentQualityDistanceMi',
    pool.query<{ med: string | null }>(
      `WITH q AS (
         SELECT DISTINCT ${runDaySql('r')} AS d, ${runDistanceMiSql('r')} AS mi
           FROM runs r
          WHERE r.user_uuid = $1::uuid
            AND NOT (r.data ? 'mergedIntoId')
            AND COALESCE(${runWorkoutTypeSql('r')}, ${runTypeSql('r')}, '')
                  IN ('tempo','threshold','intervals')
            AND (${runDaySql('r')})::date = ANY($2::date[])
       )
       SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med FROM q`,
      [userId, days],
    ),
  );
  // SWALLOW · a read that FAILED is not a runner with no quality history.
  // `rowOrNull` gives null on error and undefined on no rows; an aggregate
  // always returns a row, so undefined here is also "we could not look". Both
  // must reach the caller as no-signal, never as the 0 that used to disable
  // the Rule 2 floor silently.
  if (r === null || r === undefined) return null;
  const m = Number(r.med ?? 0);
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.round(m * 2) / 2;
}

/**
 * 2026-06-03 · runner's quality sessions per week over the last 28 days.
 * Rule 5 density-ramp source. Returns 0 when no signal.
 *
 * ── PLANVERSION-1 (2026-08-30) · IT WAS COUNTING PLAN VERSIONS ──────────────
 *
 * `plan_workouts` JOIN `training_plans` filtered on nothing but
 * `tp.user_uuid = $1`, which reaches EVERY plan that user has ever had, not the
 * one that was active. Every rebuild writes a new `training_plans` row with its
 * own copy of every day, so a single Tuesday tempo the runner ran once was
 * counted once per plan version that happened to cover that date.
 *
 * Measured against prod on 2026-08-30, the owner's account: 47 plans, 1 active.
 * The week of 08-03 returned 59 — from 43 distinct plans — and the week of
 * 08-10 returned 12, from 12 plans. He had run THREE quality sessions in the
 * window (08-04, 08-06, 08-11). `AVG(59, 12)` is 35.5, so this function
 * returned 36.
 *
 * WHAT THAT BROKE. `densityForWeek` opens with
 * `if (recentQ >= tierQ || recentQ >= desiredDensity) return desiredDensity`.
 * With `recentQ` at 36 that is trivially true, so Rule 5's quality-density ramp
 * — the mechanism that walks a returning runner up to full quality density over
 * four weeks — returned full density from week 1 and has never once fired for
 * any runner whose plan had ever been rebuilt, which is every runner. Nothing
 * caught it because the output was still well-formed: the weeks simply had more
 * quality in them than doctrine intended, and the quality crowded the easy days
 * down to whatever the weekly budget had left. `_repro_live.test.ts` records a
 * production authoring with `recentQualityPerWeek 273` and carries it as an
 * INPUT — the defect had already been seen and read as data.
 *
 * THE FIX IS THE DEDUPLICATION, NOT A CLAMP. A clamp would have hidden the same
 * bug from the next reader. A date can hold at most one quality session, so
 * `COUNT(DISTINCT pw.date_iso)` is the honest count and is immune to how many
 * times the block around that date was re-authored — which is why it is
 * preferred over reconstructing "which plan was active on this date" from
 * `authored_iso`/`archived_iso`, a harder question with the same answer.
 *
 * ── AND THE DENOMINATOR IS THE WINDOW, NOT THE WEEKS THAT HAPPENED TO HAVE ONE
 *
 * The old query bucketed by `date_trunc('week')` and averaged, so a week with
 * no quality in it did not appear in the average at all. A runner who did three
 * sessions across two weeks and none in the other two scored 1.5/wk instead of
 * 0.75/wk — the zeros were silently dropped, and the runners whose zeros matter
 * most are exactly the post-race ones this ramp exists for. "Sessions per week
 * over the last 28 days" is the count over the window, so that is what it is.
 *
 * Returned unrounded on purpose: `densityForWeek` does its own rounding, and
 * rounding here would throw information away twice — 0.25 would land on 0,
 * which `composeForUserInternal` used to map to `undefined`, which
 * `densityForWeek` reads as a cold start and answers with FULL density. A
 * near-zero habit must not come back as "no signal, assume they can handle
 * everything".
 *
 * ── AND `null` IS NOT `0` ───────────────────────────────────────────────────
 *
 * A read that FAILED and a runner who did no quality work are opposite facts,
 * and the old signature could not tell them apart: both came back as 0, which
 * `composeForUserInternal`'s `> 0 ? x : undefined` then turned into "no
 * signal", which `densityForWeek` answers with the runner's FULL preferred
 * density. So the two most cautious situations the engine can be in — we
 * cannot see, and we can see that he has done nothing hard in a month — both
 * produced the most aggressive answer available. `null` now means "could not
 * look", a number means "looked", and 0 survives as 0.
 */
async function recentQualityPerWeek(
  userId: string,
  todayISO: string,
  spans: readonly PrescribedSpan[],
): Promise<number | null> {
  // 2026-06-03 fix · same bug as recentQualityDistanceMi. plan_workouts
  // has no user_uuid column AND no matched_run_id column, so matching was
  // date-based via JOIN on training_plans + runs — the join this reader has
  // now dropped entirely. See the header.
  //
  // ── RULE8-1 (2026-08-30) · IT WAS MEASURING THE PRESCRIPTION ──────────────
  //
  // The 28-day window on the owner's CIM authoring was 2026-08-02 to 08-30, and
  // his AFC taper plus Research/00b's post-half no-quality window runs 08-02 to
  // 08-30 — the SAME 28 days, exactly. The reader looked only at days the
  // engine had told him not to do quality on, found almost none, and reported
  // "his habit is a quarter of a session a week". The plan then rationed him to
  // one quality day in week 1. He is a marathoner whose pattern is two, and he
  // was running threshold-ish efforts through that window anyway — 9.14 mi at
  // 156 bpm, 6.32 at 154.
  //
  // ── AND IT IS A MEDIAN, WHICH IS WHAT IT ALWAYS SAID IT WAS ───────────────
  //
  // The header has read "median quality sessions per week" since 2026-06-03 and
  // no implementation ever computed one — first an AVG over only the weeks that
  // happened to contain quality, then a flat count/4. Both let one quiet week
  // decide. Over his eligible weeks the counts are 2, 2, 1, 0 (that 0 is a
  // four-mile travel week), so the mean is 1.25 and the MEDIAN is 1.5 — and 1.5
  // is the honest description of a runner who does two in a normal week.
  //
  // Refuses when 28 representative days cannot be assembled. That refusal is
  // NOT a measured zero: `null` reaches `densityForWeek` as "no habit evidence"
  // and it answers with the runner's own stated pattern, whereas 0 means "he
  // genuinely does no quality" and ramps him up from nothing.
  const days = eligibleDaysBack(todayISO, HABIT_ELIGIBLE_DAYS, spans);
  if (days.length < HABIT_ELIGIBLE_DAYS) return null;
  const rows = await pool.query<{ d: string }>(
    `SELECT DISTINCT (${runDaySql('r')})::date::text AS d
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND NOT (r.data ? 'mergedIntoId')
        AND COALESCE(${runWorkoutTypeSql('r')}, ${runTypeSql('r')}, '')
              IN ('tempo','threshold','intervals')
        AND (${runDaySql('r')})::date = ANY($2::date[])`,
    [userId, days],
  ).then((res) => res.rows).catch((e: unknown) => {
    logReadFailure('plan/generate · recentQualityPerWeek', e);
    return null;
  });
  // SWALLOW · null means the read failed, and that is NOT "he did no quality
  // work". The two must not collapse into one downstream behaviour.
  if (rows === null) return null;
  const qualityDays = new Set(rows.map((x) => x.d));
  // `days` is most-recent-first; slice the ELIGIBLE days into 7-day blocks and
  // count each. Blocks are representative days, not calendar weeks, so a
  // prescribed window can never contribute a zero-quality "week".
  const ordered = [...days].sort();
  const perWeek: number[] = [];
  for (let i = 0; i + 7 <= ordered.length; i += 7) {
    perWeek.push(ordered.slice(i, i + 7).filter((d) => qualityDays.has(d)).length);
  }
  if (perWeek.length === 0) return null;
  perWeek.sort((a, b) => a - b);
  const mid = perWeek.length >> 1;
  const med = perWeek.length % 2 ? perWeek[mid] : (perWeek[mid - 1] + perWeek[mid]) / 2;
  if (!Number.isFinite(med) || med < 0) return null;
  // `densityForWeek` rounds when it builds each week's count; this reader's job
  // is to report the habit, not to pre-round it into a category. A MEASURED
  // zero survives as zero.
  return Math.round(med * 100) / 100;
}

/**
 * DERIVEDFREQ-1 (2026-08-30) · how many days a week this runner actually runs,
 * when their profile does not say.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `profile.weekly_frequency` is NULL for 8 of the 16 profiles in production —
 * every Strava-only signup and every profile predating the field, the owner's
 * among them. The comment at the read site calls that "legacy fill-every-slot"
 * and treats it as a cosmetic default. It is not. `trainingDaysPerWeek != null`
 * is the gate on THIRTEEN separate mechanisms in this file, and a NULL switches
 * every one of them off, including the whole cluster written to stop the
 * junk-run pattern:
 *
 *   · the RP-FREQ-FLOOR long cap, which reserves 2 mi for each easy day
 *   · `qualityFloorFreq`, the 2 mi minimum on a quality session (0 when null)
 *   · `qualityWeekRoomMi` / `doctrinalDayCeiling` — no per-day quality ceiling
 *   · `coherentRecentLong`'s `weeklyMi / trainingDaysPerWeek` floor
 *   · `easyCount`'s even-distribution placement
 *
 * The day COUNT still came out right for the owner by accident — with no cap,
 * every non-rest slot fills, which happens to be six — so nothing ever looked
 * wrong. A NULL must not disable safety machinery, and the fix has to be in the
 * engine rather than in one runner's row: a data write would fix one account
 * and leave every other NULL profile exactly as it is.
 *
 * ── THE STATISTIC, AND WHY THIS ONE ─────────────────────────────────────────
 *
 * The 3rd-highest distinct-run-day count over the last `RAMP_BASE_LOOKBACK_
 * WEEKS` 7-day blocks — deliberately the same rank and the same window
 * `resolveRampBase` already spends on volume, for the same stated reason: it is
 * a level the runner reached REPEATEDLY, so no single (or double) big week can
 * set it, and no single interrupted week can drag it down.
 *
 * That last part is what rules out the median. The owner's sixteen blocks are
 * 5,4,3,6,1,5,5,6,0,3,6,5,6,5,6,5 — a median of 5, because the window contains
 * his half marathon, its taper and Research/00b's mandated recovery. Reading 5
 * there would CAP a six-day runner at five days on the strength of a window the
 * engine itself depressed: the same error `RAMPBASE-1` names for volume. Rank-3
 * gives 6, which is what he runs.
 *
 * It is a CEILING on running days, so erring high is the permissive direction —
 * toward today's fill-every-slot behaviour — which is what keeps this from
 * taking days away from anyone.
 *
 * ── "WE DO NOT KNOW" IS NOT "WE MEASURED ZERO" ──────────────────────────────
 *
 * `null` is returned only when the read failed, or when rank-3 is 0 — a runner
 * who ran in fewer than three of the last sixteen weeks, from whom no frequency
 * can honestly be derived. Those keep the legacy permissive path. A runner we
 * CAN measure gets their measured number, however small.
 */
async function derivedTrainingDaysPerWeek(userId: string, todayISO: string): Promise<number | null> {
  const { isoDaysBefore } = await import('@/lib/runs/volume');
  const WINDOW_DAYS = RAMP_BASE_LOOKBACK_WEEKS * 7;
  const r = await rowOrNull<{ days: string | null }>(
    'plan/generate · derivedTrainingDaysPerWeek',
    pool.query<{ days: string | null }>(
      `SELECT string_agg(DISTINCT (${runDaySql('r')})::date::text, ',') AS days
         FROM runs r
        WHERE r.user_uuid = $1::uuid
          AND NOT (r.data ? 'mergedIntoId')
          AND (${runDaySql('r')})::date BETWEEN $2::date AND $3::date`,
      [userId, isoDaysBefore(todayISO, WINDOW_DAYS), todayISO],
    ),
  );
  // A read we could not make is not a runner with no habit. Legacy path.
  if (r === null || r === undefined) return null;
  const ran = new Set((r.days ?? '').split(',').filter(Boolean));
  if (ran.size === 0) return null;
  const perBlock: number[] = [];
  for (let b = 0; b < RAMP_BASE_LOOKBACK_WEEKS; b++) {
    let n = 0;
    for (let k = 0; k < 7; k++) if (ran.has(isoDaysBefore(todayISO, b * 7 + k))) n++;
    perBlock.push(n);
  }
  const sorted = perBlock.sort((a, b) => b - a);
  const rank3 = sorted[RAMP_BASE_SUSTAINED_RANK - 1] ?? 0;
  // Fewer than three weeks with any running in them · nothing to derive from.
  if (!(rank3 > 0)) return null;
  return Math.min(7, rank3);
}

/**
 * Rule 12 · an easy day is a DURATION, not a distance. `Research/00a` §2's
 * general-aerobic run is 40-75 minutes; this is the floor of that band, the
 * shortest an aerobic day can be and still be one.
 * Bound by AEROBIC.general-aerobic-run-is-a-duration.
 */
export const GENERAL_AEROBIC_MIN_MINUTES = 40;
/**
 * Rule 12 · the TOP of the same band. `Research/00a` §2's general-aerobic run is
 * 40-75 minutes, and 75 is the longest a day can be and still be one of these
 * rather than a second medium-long.
 *
 * Used as a CEILING on how much the medium-long promotion is required to leave
 * its neighbours: a runner whose measured easy day is longer than doctrine's own
 * general-aerobic maximum should not, on that basis, have the MLR suppressed
 * entirely. Bound by AEROBIC.general-aerobic-run-is-a-duration.
 */
export const GENERAL_AEROBIC_MAX_MINUTES = 75;
/**
 * Rule 12 · `Research/00a` §1's recovery run is 20-45 minutes, and this is the
 * top of it — the longest the day AFTER a long run should be before it stops
 * being recovery and becomes another aerobic day.
 * Bound by AEROBIC.general-aerobic-run-is-a-duration.
 */
export const RECOVERY_RUN_MAX_MINUTES = 45;

/**
 * SPIKEROLL-1 · `Research/00a` §"Volume progression rules" · the single-run
 * spike rule, as a share: ">110% of the longest run in the prior 30 days
 * raises overuse injury risk by ~64%".
 *
 * A CEILING on every authored long run, measured against a ROLLING anchor —
 * not a floor and not a seed. See `enforceSpikeRule` in
 * `finalizeComposedPlan`.
 */
export const SPIKE_MAX_SHARE = 1.10;
/** SPIKEROLL-1 · the window the rule writes into its own citation: thirty days. */
export const SPIKE_WINDOW_DAYS = 30;

/**
 * SPIKEROLL-1 · the guard degenerates on the half-mile authoring grid for a
 * small anchor: `floor(anchor * SPIKE_MAX_SHARE * 2) / 2` EQUALS `anchor`
 * itself whenever a 10% move does not cross a half-mile boundary —
 * `floor(2 * 1.10 * 2) / 2 = 2.0` — which is the NORM, not the edge case, for
 * an anchor that is already authored on that grid. Measured in
 * `docs/spikeroll-1-handback.md` §3a: 334 archetype failures on landing, ALL
 * traced to this — nearly every one a "Taper bottoms at N mi, X% below peak"
 * on the smallest runners (L0-3 / m0-m5), because the long run could never
 * grow at all, so the block's own peak — and therefore its taper depth —
 * never rose.
 *
 * THIS NUMBER IS A CONVENTION, NOT A RESEARCH FINDING. `Research/00a` states
 * the 110% ratio; it says nothing about a minimum coherent long-run distance
 * for that ratio to operate on a half-mile grid. 5 mi is the smallest anchor
 * at which a single 0.5 mi grid step is ALWAYS at least a 10% move
 * (0.5 / 5.0 = 10%), so the ceiling can express doctrine's ratio at every
 * anchor above it. Below 5 mi some anchors can still express it (2.3 -> 2.5 is
 * +8.7%) and others structurally cannot (2.0 -> 2.0 is +0%) — an anchor-
 * dependent, incoherent guard, not a strict one, which is worse than no guard
 * at that grid resolution because it looks like protection and is not.
 *
 * The exemption is NARROW, not a retreat: below the floor, `enforceSpikeRule`
 * does not evaluate that week at all, but the long run is not left unguarded
 * — `layoutWeek`'s own `rampCeiling` (bound by doctrine claim
 * `RAMP.single-session-spike`) already bounds every authored session at
 * ~110% of ITS OWN pre-finalization anchor, so an exempt week keeps exactly
 * the protection it had before this pass existed. What this pass adds — the
 * rolling, POST-taper, POST-cutback, FINAL-value check — is what does not
 * apply below the floor, not protection in general. So the population below
 * this floor is no worse off than `main` was before SPIKEROLL-1 landed.
 *
 * Known gap, named rather than silently routed around (a beginner or a
 * runner returning from a long layoff is exactly the population
 * `Research/22`'s "Return from Long Layoff" section addresses with its own
 * mechanism, and a finer authoring grid below 5 mi — quarter-mile — would
 * also close this structurally). Either is a real fix for later; this floor
 * only keeps the guard honest today rather than quietly wrong.
 *
 * Bound by `CONVENTION.spike-rule-coherence-floor` in
 * `lib/doctrine/registry.ts`, on the same discipline as
 * `CONVENTION.corpus-corroboration-count`: it asserts the number stays inside
 * the reasoning above and never advertises itself as measured.
 */
export const SPIKE_MIN_COHERENT_ANCHOR_MI = 5;

/**
 * DOCTRINE-1c / TAPER-RESTORE-CONTINUOUS-1 · how far under its doctrine target
 * a taper week may sit before `finalizeComposedPlan` lifts it back.
 *
 * A TOLERANCE, and now a floor rather than a trigger — see the block that
 * spends it. Ordinary rounding and the day-sum reconciliation land far inside
 * 12%, so a healthy plan never reaches it; a week that does has been
 * over-tapered by the divergence between the volume-curve BUDGET peak the
 * taper's depth is authored from and the REALIZED peak everything downstream
 * measures. Ours, not doctrine's: `Research/08` §9.1 states the taper's DEPTH
 * band (30-40% off peak), and this is the slack allowed around it before the
 * engine corrects itself, which no source prescribes.
 */
export const TAPER_RESTORE_TOLERANCE = 1.12;

/** RULE8-1 · how many representative days a habit reader wants. Same length as
 *  `QUALITY_LOOKBACK_DAYS`, so every habit question is asked over the same span
 *  of REAL training rather than each picking its own calendar window. */
export const HABIT_ELIGIBLE_DAYS = 28;
/** RULE8-1 · fewer easy runs than this in the representative window and the
 *  median is an anecdote. Refuse rather than floor a block on three runs. */
export const HABIT_MIN_EASY_SAMPLES = 4;

async function easyDayMedianMi(
  userId: string,
  todayISO: string,
  spans: readonly PrescribedSpan[],
): Promise<number | null> {
  // ── RULE8-1 (2026-08-30) · THIS READER MEASURED THE TAPER ─────────────────
  //
  // It took a 14-day median off `NOW()`. On the owner's CIM authoring every one
  // of those 14 days sat inside his AFC taper and Research/00b's post-half
  // recovery window, so four of its six samples were the short recovery jogs
  // the engine had prescribed: 3.14, 4.01, 4.02, 4.26 against his real easy
  // days of 6.32 and 7.78. It returned 4.0 and the block authored four-mile
  // easy days for a runner whose easy day is six.
  //
  // The window is now 28 ELIGIBLE days — the prescribed span skipped entirely,
  // not averaged away. Measured against prod 2026-08-30 the reading is stable
  // where it matters: 6.16 over 28 eligible days and 6.16 again over 42, where
  // the contaminated 14-day window said 4.0 and a naive 90-day widening said
  // 6.02 only because the taper was diluted rather than removed.
  //
  // It also read server `NOW()` while every neighbouring reader anchors on
  // `runnerToday`. That is a timezone the runner does not live in deciding
  // which of his days count.
  const days = eligibleDaysBack(todayISO, HABIT_ELIGIBLE_DAYS, spans);
  if (days.length < HABIT_ELIGIBLE_DAYS) return null;   // not enough clean history
  const r = await rowOrNull<{ med: string | null; n: string }>(
    'plan/generate · easyDayMedianMi',
    pool.query<{ med: string | null; n: string }>(
      `WITH easy_runs AS (
         SELECT ${runDistanceMiSql('r')} AS mi
           FROM runs r
          WHERE r.user_uuid = $1::uuid
            AND NOT (r.data ? 'mergedIntoId')
            AND ${runDistanceMiSql('r')} BETWEEN 3 AND 9
            AND (${runDaySql('r')})::date = ANY($2::date[])
       )
       SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med,
              COUNT(*)::text AS n
         FROM easy_runs`,
      [userId, days],
    ),
  );
  // A read that failed is not a runner with no easy days.
  if (r === null || r === undefined) return null;
  if (Number(r.n ?? 0) < HABIT_MIN_EASY_SAMPLES) return null;
  const m = Number(r.med);
  if (!Number.isFinite(m) || m <= 0) return null;
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
  phases: Array<{
    label: string; weeks: number; rationale: string; citation: string;
    /** PHASE-ANSWERS-1 · attached by `finalizeComposedPlan`, after every pass
     *  that moves a mile, so the numbers it cites are the block that ships.
     *  Absent on a raw `sizeBlocks` result. */
    answers?: PhaseAnswer;
  }>;
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

/** RULE8-1 (2026-08-30) · EXPORTED so the shared representative-window filter
 *  reads these doctrine-bound taper weeks rather than keeping a second copy.
 *  `prescribedSpanFor` above is this file's own consumer of the same numbers. */
export const BLOCK_SHAPE: Record<DistCategory, { taperWeeks: number; raceSpecificCap: number }> = {
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
 * VARIETY-BEGIN-1 (2026-08-28) · the beginner's structured days: two DIFFERENT
 * sessions, and a dose that walks.
 *
 * TWO DEFECTS, one slot. The base-building (true beginner) quality mix is
 * `['tempo']` on two quality days, so `types[i % types.length]` ran the SAME
 * light fartlek twice a week (recorded as open beside DOCTRINE-DOSING-2's
 * slot-count derivation); and the seed string "5×1 min surges @ T effort" was
 * repeated verbatim for every week of the block — the dose never moved from
 * first sharpen week to race week.
 *
 * THE PROGRESSION IS DOCTRINE'S OWN, count first, then duration:
 *
 *   · `Research/00b-recovery-protocols.md` §"Marathon Recovery (4-week
 *     reverse taper)" week 3: "Strides + light fartlek (4-6× 1 min @ 10K
 *     effort)" — the COUNT is the stated axis, 4 to 6, at one minute.
 *   · `Research/22-plan-templates.md` §"5K — Beginner" sample week opens the
 *     session at the band floor: "2.5 mi E w/ 4×1 min @ T effort".
 *   · `Research/22` §"10K — Beginner" names the session ("fartlek (1 min on /
 *     1 min off)") and its sample peak week states the built-up end state:
 *     "4 mi w/ 6×2 min fartlek" — count at its top, THEN the minute doubles.
 *
 * So: QUALITY walks 4×1 → 5×1 → 6×1 across its closing weeks;
 * RACE-SPECIFIC holds six reps and lengthens them, 6×1 → 6×1.5 → 6×2.
 * The beginner's TAPER day is untouched (`race_week_tuneup`, its own row).
 *
 * WHY NOT THE OVERLOAD TRAJECTORY. `trackOfType` deliberately returns null for
 * base-building (SLOT-ROTATE-2: a beginner's fartlek carries a dose Research/22
 * states, not a shape for the ladder to render) — and wiring it in would also
 * be WRONG for this shape: `SESSION_LADDER.threshold` is
 * `['quality_duration','work_density','pace']` with no `rep_count`, so its
 * first step turns 5×1 min into 5×3 min (tripling a beginner's T dose in one
 * week), and `MIN_QUALITY_REP_MINUTES` = 3 makes every day-clamp re-shape
 * 1-minute surges into 2×3 min cruise blocks — a different session wearing the
 * fartlek's label. Doctrine's beginner ladder above is count-first at a
 * one-minute rep, which the trajectory cannot express. Deterministic in
 * (phase, weeksToPhaseEnd), so plans regenerate byte-identically.
 *
 * Bound by `BEGINNER.surge-progression` in lib/doctrine/registry.ts, which
 * reads the opening dose out of the 5K row and the peak dose out of the 10K
 * row rather than trusting these copies.
 */
export const BEGINNER_SURGE_REPS_BAND: readonly [number, number] = [4, 6];
export const BEGINNER_SURGE_MINUTES_BAND: readonly [number, number] = [1, 2];

/**
 * The beginner surge-fartlek dose for a week · see VARIETY-BEGIN-1 above.
 *
 * CAPPED BY DANIELS' T SHARE. The walk's top rung (6×2 min ≈ 1.2-1.5 mi at a
 * beginner's T) can exceed "cap T-pace at 10% of weekly mileage"
 * (`Research/04`:187, the same rule `weeklyDoseBudgetMi('T')` reads) on the
 * smallest beginner weeks — a 14 mi/wk week may spend 1.4 mi at T. So when the
 * caller passes the week, the dose walks back DOWN the same ladder it climbed
 * (minutes first, then count, never below the 4×1 opening) until it fits.
 * Weeks that can afford the full walk are byte-identical; the sweep validator
 * measures the same cap afterwards, so an unaffordable rung is never authored.
 */
export function beginnerSurgeDose(
  phase: string,
  weeksToPhaseEnd: number,
  /** The week's mileage, for the 10% T cap. Omitted → uncapped (the registry
   *  claim reads the doctrine endpoints this way). */
  weeklyMi?: number | null,
): { reps: number; minutes: number } {
  const [repsLo, repsHi] = BEGINNER_SURGE_REPS_BAND;
  const [minLo, minHi] = BEGINNER_SURGE_MINUTES_BAND;
  let dose: { reps: number; minutes: number };
  if (phase === 'RACE-SPECIFIC') {
    // Count holds at its top; the minute walks toward Research/22 §"10K —
    // Beginner"'s peak-week "6×2 min fartlek" across the phase's last weeks.
    const minutes = weeksToPhaseEnd >= 2 ? minLo : weeksToPhaseEnd === 1 ? (minLo + minHi) / 2 : minHi;
    dose = { reps: repsHi, minutes };
  } else {
    // QUALITY (the beginner's first structured phase): open at the 5K-Beginner
    // row's 4×1 and climb the count toward six across the phase's closing weeks.
    const reps = Math.max(repsLo, repsHi - Math.min(repsHi - repsLo, Math.max(0, weeksToPhaseEnd)));
    dose = { reps, minutes: minLo };
  }
  if (weeklyMi != null && weeklyMi > 0) {
    const budgetMi = weeklyDoseBudgetMi(weeklyMi, 'T', 'training');
    // The MEASUREMENT's own conversion, deliberately: `splitDay`/`dayDoses`
    // weigh a time-stated rep at the fixed `SPEC_PROBE_T_PACE_SEC`, whatever
    // the runner's actual T is, so a clamp converted at the plan's slower
    // real pace would author a session the sweep validator then flags. One
    // conversion on both sides is the whole label/spec-drift lesson.
    const capMinutes = (budgetMi * SPEC_PROBE_T_PACE_SEC) / 60;
    // Walk back down the ladder: 6×2 → 6×1.5 → 6×1 → 5×1 → 4×1.
    while (dose.reps * dose.minutes > capMinutes) {
      if (dose.minutes > minLo) dose = { ...dose, minutes: dose.minutes - 0.5 };
      else if (dose.reps > repsLo) dose = { ...dose, reps: dose.reps - 1 };
      else break; // the 4×1 opening dose is never refused · ~0.5 mi at T
    }
  }
  return dose;
}

/**
 * VARIETY-BEGIN-1-FIX (2026-08-30) · the smallest day the beginner's surge
 * fartlek can be authored onto and still be the session Research/22 names.
 *
 * `timeRepSpec`'s clamp (spec-builder.ts) floors a rep set at ONE repetition
 * rather than deleting the session — right for a day that can seat SOME of
 * the prescribed dose, wrong for a day too small to seat even the doctrine
 * floor dose. Research/22 §"5K — Beginner" states that floor as "4×1 min @
 * T" — `BEGINNER_SURGE_REPS_BAND[0]` / `BEGINNER_SURGE_MINUTES_BAND[0]` — and
 * `beginnerSurgeDose`'s own comment above notes that opening dose "is never
 * refused" by the WEEKLY T-pace budget. But nothing checked the single DAY's
 * physical mileage: on a cutback week (`isCutback` excludes the RP-FREQ-FLOOR
 * 2mi quality-day floor by design — see `qualityFloorFreq` in `layoutWeek`) a
 * true beginner's `qualityMiEach` can round to exactly 1mi, and warm-up
 * (0.5mi floor) plus cool-down (0.5mi floor) alone already spend that
 * mile — the clamp then floors the rep count at 1 rather than 0, which is
 * doing its job, but the day is a warm-up and a cool-down around one clipped
 * rep, not a surge fartlek.
 *
 * Solved at the SAME conversion `beginnerSurgeDose`'s weekly cap already uses
 * (`SPEC_PROBE_T_PACE_SEC` — "one conversion on both sides", per that
 * function's own comment) and against `timeRepSpec`'s own warm-up/cool-down
 * formula, so authoring and this refusal price the session identically and
 * cannot drift out of sync with a future change to the band or the probe
 * pace. `restS` is fixed at 60 — the beginner surge label's own "1 min jog"
 * — matching what `timeRepSpec` will build for this session.
 */
function minBeginnerSurgeDayMi(): number {
  const [repsLo] = BEGINNER_SURGE_REPS_BAND;
  const [minLo] = BEGINNER_SURGE_MINUTES_BAND;
  const workMi = (repsLo * (minLo * 60)) / SPEC_PROBE_T_PACE_SEC;
  const floatMi = Math.max(0, repsLo - 1) * (60 / 540);
  // Fixed-point solve for the smallest budgetMi where `timeRepSpec`'s own
  // wu/cd floors (0.5-1.5mi at 0.3× the day, 0.5-1.0mi at 0.25×) plus this
  // work no longer exceeds the day — the exact inequality the clamp loop
  // tests. Converges in a handful of steps (wu/cd scale by <1×); 20 is a
  // generous, cheap ceiling for a value computed once at module load.
  let m = workMi + floatMi + 1.0;
  for (let i = 0; i < 20; i++) {
    const wuFloor = Math.max(0.5, Math.min(1.5, m * 0.3));
    const cdFloor = Math.max(0.5, Math.min(1.0, m * 0.25));
    const next = wuFloor + cdFloor + workMi + floatMi;
    if (Math.abs(next - m) < 1e-6) { m = next; break; }
    m = next;
  }
  return m;
}

/** Module-level · computed once, from constants only. */
const MIN_BEGINNER_SURGE_DAY_MI = minBeginnerSurgeDayMi();

/**
 * VARIETY-BEGIN-1 · the beginner's SECOND weekly structured day is light
 * hills, not a second copy of the fartlek.
 *
 * `Research/04` §15's base row places both in the same phase — "Base (8–12+
 * wks) | E, GA, medium-long, long, strides, hill sprints, occasional
 * fartlek/light hills | 2 quality sessions/wk max" — and `Research/22`
 * §"10K — Beginner" lists "light hills" among its own Key workout types. §8.2
 * (short hill repeats) is the light-hills row: "Duration | 10–30 s",
 * "Reps | 8–16 (start 8, build to 16)", "Recovery | Walk or jog back to
 * start; full recovery", "Purpose | Power, tendon stiffness, form; gateway
 * speed work" — the gateway wording is exactly the beginner's case, and the
 * label keeps the word "hill" so `buildWorkoutSpec` builds it by effort with
 * no pace target (§8.1 prescribes hills by effort; a pace is unreachable on a
 * grade). Reps open at the band's own "start 8" and take one modest step in
 * RACE-SPECIFIC per its "build to 16" axis — a beginner never approaches the
 * top of the band. Bound by `BEGINNER.hill-day` in lib/doctrine/registry.ts.
 */
export const BEGINNER_HILL_SURGE_S = 20;
export const BEGINNER_HILL_REPS_BAND: readonly [number, number] = [8, 16];

/** The beginner light-hills rep count for a phase · VARIETY-BEGIN-1. */
export function beginnerHillReps(phase: string): number {
  return phase === 'RACE-SPECIFIC' ? BEGINNER_HILL_REPS_BAND[0] + 2 : BEGINNER_HILL_REPS_BAND[0];
}

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

/**
 * ROTATION-REFUSE-1 · how many long-run variants one week may try before it
 * gives up and keeps the default finish.
 *
 * A bound, not a policy: every iteration that does not settle adds a slug to
 * the exclusion set, so the loop terminates on its own once the candidate list
 * is exhausted. This only stops an unbounded `while` from existing in the
 * plan-authoring path. `SLOT_FAMILIES.long` holds four entries today; the
 * constant is deliberately above that so adding a fifth does not silently
 * truncate the retry.
 */
const LONG_VARIANT_MAX_ATTEMPTS = 8;

/**
 * VARIETY-10K-1 (2026-08-28) · the 10K progression long run's M-pace tail.
 *
 * The 10K's long runs were sixteen identical plain easy runs: `racePaceTag`
 * is null for the distance (correctly — 10K race pace is I-band work, not a
 * long-run insert), so `longFinishSegment` never fired and no long-run row
 * reached the plan at all. But `Research/22-plan-templates.md`
 * §"10K — Intermediate" lists "progression LR" among Key workout types and
 * its sample peak week states the dose exactly: "9-10 mi E w/ last 2 mi @ M".
 * `Research/04` §4.3 gives the session its own row and its own cadence
 * ("Frequency | Every 2–3 weeks in specific phase") — the same rhythm
 * `racePaceLongThisWeek` already walks for §4.4/§4.5.
 *
 * Two miles FIXED, from the sample week — never the marathon build's 30-50%
 * fractions, which size §4.4/§4.5 sessions and would put five race-pace miles
 * on a ten-mile 10K long. Sits exactly at FAST_FINISH_MIN_MI, so the smallest
 * legal race-pace segment and this tail agree by construction.
 *
 * 5K long runs stay plain: every long in Research/22's three 5K rows is E
 * ("3.5-4 mi (E)", "6 mi E", "10-12 mi E") and no 5K row names a progression
 * LR. 10K beginners stay plain too — §"10K — Beginner" longs are "E with
 * optional walk breaks" and its key workouts carry no progression LR — which
 * the `!baseBuilding` gate at the call site enforces (a stated 'beginner'
 * level IS a base-building plan, `isBaseBuildingPlan`).
 *
 * Bound by `LONGRUN.tenk-progression` in lib/doctrine/registry.ts, which reads
 * the 2 out of the sample-week cell rather than trusting this copy.
 */
export const TENK_PROGRESSION_FINISH_MI = 2;

/**
 * VARIETY-R3-1 (2026-08-28) · the 5K/10K third quality day — the R day.
 *
 * `Research/01` §"Dosing rules" prescribes a polarized distribution whose hard
 * half is TWO bands, not one: "70–80% E, 10–15% M+T, 10–15% I+R". The engine's
 * two-slot 5K/10K weeks spend the M+T band (tempo/cruise) and the I band (rep
 * slot) and leave R unspent, so measured I+R landed at 4-6% of block mileage
 * against doctrine's 10-15. `Research/22`'s own advanced sample weeks show the
 * missing session by name: §"5K — Advanced" (Phase III, week 4) runs Tue
 * "6×1000 m @ I", Thu "4×1 mi @ T" AND Sat "WU + 8×400 m @ R, 400 jog + CD";
 * §"10K — Advanced" (race-specific, week 11) runs "5×1600 m @ 10K pace",
 * "4×1 mi @ T" AND "WU + 10×400 m @ R, 400 jog + CD". Three quality days,
 * the third at R — which is also both rows' "Key workout types" column
 * ("R reps (200-400 m)"; "strides, hill sprints").
 *
 * The day exists only where doctrine's own rows assume it can:
 *
 *   · 5k/10k only. Research/22's marathon and half rows are 2 quality + long
 *     (the HM-Advanced sample week is Tue T, Thu race-pace, Sat long), and
 *     the marathon's third stimulus is the MP long, not a third weekday.
 *   · `tierTarget.qualityPerWeek >= 3` — the tier table's own count, which
 *     for 5k/10k advanced/elite is read from those sample weeks.
 *   · the runner's preferences seat three quality days, and
 *   · the week runs at least `R3_MIN_TRAINING_DAYS` days: both Research/22
 *     rows state "| Days/week | 6-7 |", and their sample weeks need six —
 *     three quality days, a long, and the easy day each hard→hard gap
 *     requires. A 4-5 day runner keeps the two-session week their tier's
 *     intermediate row describes.
 *   · never on a cutback week: `Research/00b` §"What to Cut First" removes
 *     the extra quality session first ("3. Second quality session (replace
 *     with easy + strides)") and its cutback table keeps "one true quality
 *     session only" — so the deload drops the R day before anything else.
 *
 * The day rides the composer-internal `speed` slot (`ComposerSlot`), exactly
 * as DOCTRINE-BASE-2's base-week session does: the DayPlan type stays
 * `intervals` (nothing new on the wire), the catalogue draws from the §7 R
 * vocabulary, and Daniels' 5% R cap (`Research/01`: "R | 5% of weekly mi
 * (max 8K cumulative)") binds through the same `capLedger` /
 * `slotBudgetMi` machinery as every other slot — three correctly-sized
 * days, never one inflated one.
 *
 * Bound by `VARIETY.r3-third-quality-day` in lib/doctrine/registry.ts, which
 * parses the Days/week band and counts the sample weeks' structured sessions
 * out of Research/22 itself.
 */
export const R3_MIN_TRAINING_DAYS = 6;

/**
 * VARIETY-LONG-1 (2026-08-28) · the threshold tail's share of a progression
 * long run's intensity block.
 *
 * `Research/04-workout-vocabulary.md` §4.3's Structure row: "First 1/3 to 1/2
 * at E pace, middle at strong E or M, final 1/4 to 1/3 at M to T", and its
 * worked example — "6 mi E + 6 mi M + 4 mi T" — spends 4 of its 10 intensity
 * miles (0.40 of the intensity block; the final 1/4 of the RUN) on the tail.
 * The engine expresses the shape as two segments after an easy bulk: an M
 * middle and a T tail. The tail takes one third of the intensity block —
 * inside the doc's own final-quarter-to-third band when read against the whole
 * run (an intensity block sized at 30-50% of the long puts a one-third tail at
 * 10-17% of the run, always under the "final 1/4" ceiling) — and the intensity
 * block's TOTAL is the same fraction of the long that §4.5's single-tag finish
 * would have taken on the same week, so rotating the shape never adds hard
 * miles. Bounded per segment by the week's own dose budgets (`M` and `T` each
 * priced by `weeklyDoseBudgetMi`), floored per segment at `FAST_FINISH_MIN_MI`;
 * a week that cannot seat both segments keeps the default single-tag finish
 * rather than shipping a fragment. Bound by LONGRUN.progression-shape.
 */
export const PROGRESSION_TAIL_SHARE = 1 / 3;

// Exported for lib/plan/block-preview.ts (the pre-recovery-complete block-shape
// preview) — it must call this SAME function rather than re-deriving BLOCK_SHAPE
// or the phase-sizing arithmetic. See that file's header for why.
export function sizeBlocks(totalWeeks: number, raceDistanceMi: number, isMidBlock: boolean = false): BlockPlan {
  const cat = distanceCategoryOf(raceDistanceMi);
  const shape = BLOCK_SHAPE[cat];
  /*
   * RUNWAY-1 (2026-08-30) · every phase floor below is written against the
   * assumption that totalWeeks is comfortably larger than shape.taperWeeks and
   * qualityWeeks' own 3-week minimum. That assumption held for every runway
   * this function had ever been called with — until it didn't.
   *
   * Swept over every distance category and totalWeeks 1-12: the ORIGINAL
   * `qualityWeeks = Math.min(8, Math.max(3, Math.floor(remaining * 0.6)))`
   * floors at 3 whatever `remaining` is, so a category can claim MORE weeks
   * than totalWeeks actually has. `extraWeeks` a few lines down can only ADD
   * slack when a phase UNDER-claims — `Math.max(0, ...)` — it has no
   * mechanism to claw back an OVER-claim. Measured: 5K mismatches at
   * totalWeeks 1-3, 10K/HM at 1-4, marathon/ultra at 1-5 — a `phases` array
   * summing to as much as double `totalWeeks` (marathon at totalWeeks=1:
   * QUALITY:3 + TAPER:3 = 6). Composed downstream (`composePlan`'s week
   * loop walks `phases` in order, decrementing a week at a time), the
   * over-claimed early phase consumes the ENTIRE composed grid before the
   * walk ever reaches TAPER — so a short-runway plan silently never taper'd
   * at all, while `isRaceWeek = wi === totalWeeks - 1` kept marking its last
   * week as race week regardless of which phase (or lack of one) that week
   * actually landed in.
   *
   * The fix: every floor below is capped at what is ACTUALLY LEFT, not at an
   * unconditional minimum. Each cap is a MIN with the previous remainder, so
   * on any runway large enough to satisfy the floor anyway (every runway this
   * function ran on before RUNWAY-1) the min is slack and the arithmetic is
   * unchanged — provably so: `Math.max(3, Math.floor(0.6x)) <= x` for every
   * `x >= 3`, so `Math.min(x, Math.max(3, Math.floor(0.6x)))` only ever
   * differs from the original when `x < 3`, which was structurally
   * unreachable until a short runway could reach it. TAPER — the phase
   * closest to race day and the one whose absence is most dangerous (no
   * volume cut, no protected intensity, the plan just runs the runner into
   * the race at build load) — is protected FIRST, at its full doctrine
   * length whenever totalWeeks allows it, and shrunk only when totalWeeks
   * itself is smaller than the category's own taper.
   */
  const taperWeeks       = Math.min(shape.taperWeeks, totalWeeks);
  // Race-specific = the closest-to-race quality block. Sized by race distance,
  // squeezed only if total runway is too short.
  const raceSpecificWks  = Math.min(shape.raceSpecificCap, Math.max(0, totalWeeks - taperWeeks - 4));
  // Quality block: bigger when there's more runway, capped at 8.
  const remainingAfterTaperAndRS = totalWeeks - taperWeeks - raceSpecificWks;
  const qualityWeeks     = Math.min(
    remainingAfterTaperAndRS,
    Math.min(8, Math.max(3, Math.floor(remainingAfterTaperAndRS * 0.6))),
  );
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

/**
 * CUTBACK-LONG-1 (2026-08-28) · how far the cutback week's LONG RUN drops.
 *
 * Research/00b §"Depth of Cutback by Mileage Tier" prescribes the long run's
 * own reduction separately from the week's, per tier, in the table's Notes
 * column: "Drop the long run by 20–30%" (20–40 mpw), "Long run –25%" (40–60),
 * "Long run –25–30%" (60–80), "Long run –30%" (80+). The engine cut the WEEK
 * by 20% (`volumeCurve`'s 0.80 deload, in band) but nothing cut the long: it
 * was sized proportionally off the reduced weekly volume and then re-floored
 * by the ramp anchors, so observed cutback longs dropped only 6–16% against
 * the surrounding load weeks — the weekday runs absorbed the whole deload,
 * which is #13's "opposite of a deload" arriving through the sizing path
 * instead of the floor path.
 *
 * One row per doc row, same order, boundaries read from the doc's own
 * "Peak-load mpw" column by the gate. Each drop sits at the low end of its
 * row's band — consistent with the weekly cut sitting on its band's floor.
 * Keyed by the PRECEDING LOAD BLOCK's peak weekly mileage, which is the same
 * base the doc names for the weekly cut ("from the highest week in the
 * preceding load block"). Bound by CUTBACK.long-run-depth.
 */
export const CUTBACK_LONG_DROP: ReadonlyArray<{ maxMpw: number; drop: number }> = [
  { maxMpw: 40, drop: 0.20 },
  { maxMpw: 60, drop: 0.25 },
  { maxMpw: 80, drop: 0.25 },
  { maxMpw: Infinity, drop: 0.30 },
];

export function cutbackLongDropFor(peakLoadMpw: number): number {
  for (const tier of CUTBACK_LONG_DROP) {
    if (peakLoadMpw <= tier.maxMpw) return tier.drop;
  }
  return CUTBACK_LONG_DROP[CUTBACK_LONG_DROP.length - 1].drop;
}

/**
 * CUTBACK-LONG-1 · apply the long-run drop to every planned cutback week.
 *
 * Runs once, after the week loop has laid every day out and before the
 * mid-block race embed (so an embedded race week — which sets its own
 * `isCutback` flag for the validator's benefit — is never mistaken for a
 * volume-curve deload; at this point the only `isCutback` weeks are the
 * curve's own).
 *
 * For each cutback week: the reference is the preceding load block (walk back
 * to the previous cutback, exclusive), its longest long and its highest
 * weekly volume. The cutback long is trimmed down to `refLong × (1 − drop)`,
 * bounded three ways:
 *
 *   · it stays the longest run of its week — a "long" shorter than the
 *     midweek medium-long is not a long run;
 *   · the WEEK's total cut never exceeds 30% of the reference load — the
 *     ceiling of the same doc table's "% reduction" column — so deepening the
 *     long cannot push the week out the bottom of the band it was cut into;
 *   · a long already at or under its target is left alone.
 *
 * The trimmed miles are shed, not redistributed: §"What to Cut First" cuts
 * total volume first and the long run second, so a cutback week that lands
 * deeper than 20% (but inside 30%) because its long came down is the doc's
 * own ordering, not a bug. `weeklyMi` and `vols` are re-reconciled to the
 * realized day sum so every downstream reader (embed, validator, VOL-1) sees
 * the same week.
 */
function applyCutbackLongDrop(weeks: ComposedWeek[], vols: number[]): void {
  for (let wi = 0; wi < weeks.length; wi++) {
    const w = weeks[wi];
    if (!w.isCutback || w.isRaceWeek || w.phase === 'TAPER') continue;
    let refLong = 0;
    let refMpw = 0;
    for (let j = wi - 1; j >= 0; j--) {
      const prev = weeks[j];
      if (prev.isCutback || prev.isRaceWeek || prev.phase === 'TAPER') break;
      refMpw = Math.max(refMpw, prev.weeklyMi);
      const prevLong = prev.days.find((d) => d.isLong && d.type !== 'race');
      if (prevLong) refLong = Math.max(refLong, prevLong.distanceMi);
    }
    if (!(refLong > 0) || !(refMpw > 0)) continue;
    const longDay = w.days.find((d) => d.isLong && d.type !== 'race');
    if (!longDay) continue;
    const target = Math.round(refLong * (1 - cutbackLongDropFor(refMpw)));
    if (longDay.distanceMi <= target) continue;
    const maxOtherMi = Math.max(
      0,
      ...w.days.filter((d) => d !== longDay && d.type !== 'race').map((d) => d.distanceMi),
    );
    const floorMi = Math.max(target, maxOtherMi);
    const maxTrim = Math.max(0, w.weeklyMi - refMpw * 0.70);
    const trim = Math.min(longDay.distanceMi - floorMi, maxTrim);
    if (trim <= 0) continue;
    longDay.distanceMi = Math.round((longDay.distanceMi - trim) * 10) / 10;
    w.weeklyMi = Math.round(w.days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
    vols[wi] = w.weeklyMi;
  }
}

export type LevelKey = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;

/**
 * WKPEAK-1 (2026-08-25) · the tier's peak target, reconciled against the peak
 * the runner has actually run.
 *
 * Three bounds, in the order they bind:
 *
 *   · `min(doctrineTarget, measuredPeak × CYCLE_GROWTH_CEILING)` — the row of
 *     Research/00a §"Volume progression rules" that says how much a trained
 *     athlete's base grows per training CYCLE. See CYCLE_GROWTH_CEILING for why
 *     this axis was unbounded while the weekly one was bounded twice.
 *
 *   · `≥ measuredPeak` — a build that peaks at the runner's existing peak has
 *     built nothing, so the ceiling may never pull the target BELOW what they
 *     have already held. When their peak is at or above the tier target this
 *     bound is what keeps the plan honest in the other direction.
 *
 *   · `≥ TIER_TARGETS[cat].developing.peakWeeklyMileageBand[0]` — the least
 *     volume doctrine asks of ANYONE racing this distance. Without it a runner
 *     with a thin measured history (a long break inside the look-back, an
 *     account that has only just connected Strava) would be walked down to a
 *     marathon build peaking in the twenties. The guard may move a runner
 *     around inside the table for their distance; it may not take them out
 *     from under it.
 *
 * REFUSES RATHER THAN GUESSES. `peakMi === 0` means nothing was measured — the
 * cold-start case, and every synthetic archetype in the sweep. The function
 * returns the doctrine target untouched, which is a refusal to bound rather
 * than a bound computed off an invented number.
 *
 * A TARGET, NOT A MEASUREMENT. Nothing here claims the runner CAN hold the
 * returned volume. It is the destination the block is authored toward, and the
 * only measured quantity in it is `evidence.peakMi`, which is the runner's own
 * biggest week.
 *
 * Bound by RAMP.cycle-over-cycle-peak-growth.
 */
export function cycleBoundedPeak(
  doctrineTargetMi: number,
  evidence: RampBaseEvidence | null,
  level: LevelKey,
  cat: DistCategory,
): number {
  const measuredPeak = evidence?.peakMi ?? 0;
  const ceilFactor = CYCLE_GROWTH_CEILING[level ?? 'intermediate'];
  if (!(measuredPeak > 0) || ceilFactor == null) return doctrineTargetMi;
  const distanceFloorMi = TIER_TARGETS[cat].developing.peakWeeklyMileageBand[0];
  const cycleCeilingMi = Math.round(measuredPeak * ceilFactor * 10) / 10;
  return Math.max(
    Math.min(doctrineTargetMi, cycleCeilingMi),
    measuredPeak,
    distanceFloorMi,
  );
}

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
 *   · cutback every 4th non-taper week to 80% of the last climbing week
 *     (RC2-4 · the doc's 20-30% band; this line used to say "85% of last
 *     peak", which was stale twice over — the factor moved to 0.80 and the
 *     base was never the peak. The loop below is the truth.)
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
  /** WKPEAK-1 + WKRESUME-1 · what the authoring MEASURED about this runner.
   *  Null (every synthetic archetype, every cold start) leaves the curve
   *  byte-identical: no cycle ceiling, no resume ramp. */
  evidence?: RampBaseEvidence | null,
  /** HOLD-PROGRESS-1 (2026-08-28) · an explicit peak target, replacing the
   *  tier-band derivation. The maintenance composer's long hold is a SHALLOW
   *  climb — base × HOLD_CYCLE_GROWTH — and reuses this curve rather than
   *  growing a parallel ramp implementation: same geometric climb, same ramp
   *  ceiling, same cutback cadence and 0.80 deload, same post-deload re-entry
   *  cap. Null (every race-prep caller) leaves the curve byte-identical. */
  peakTargetOverrideMi?: number | null,
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
  const doctrineTarget = Math.max(
    tierTarget.peakWeeklyMileageBand[0],
    Math.round(start * 1.10),
  );
  // WKPEAK-1 · …and no further above the peak the runner has actually run than
  // doctrine's per-cycle growth figure allows. See `cycleBoundedPeak`.
  // HOLD-PROGRESS-1 · unless the caller states the destination outright — the
  // maintenance hold's target is its own base × HOLD_CYCLE_GROWTH, already
  // inside Research/00a's per-cycle band, not the tier's race-prep peak.
  const peakTarget = peakTargetOverrideMi != null
    ? peakTargetOverrideMi
    : cycleBoundedPeak(doctrineTarget, evidence ?? null, level, taperCat);

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
  //
  // WKRESUME-1 · the first climbing weeks are a RETURN, not a climb, when the
  // base was lifted off a mandated interruption. Research/22 §14 states all
  // three of them (70% · 85% · full) and `resolveRampBase` spent only the
  // first; the geometric ramp then treated the deload as the runner's fitness
  // and took five weeks to get back to a level doctrine restores in three.
  // Capped at `peakTarget` so a resume can never overshoot the block's own
  // destination, and held to `climbWeeks - 1` so a very short block still has
  // one week that is a build.
  //
  // WKPEAK-2 · and the climb aims to ARRIVE with `hold` climbing weeks to
  // spare, so the peak is the phase Research/22 describes rather than a single
  // week at the end. The existing `Math.min(cappedTarget, peakTarget)` in the
  // loop is what holds it there — nothing else was needed.
  // CONTINUOUS-RESTORE-1 (2026-08-30) · was gated on `evidence.lifted`, i.e. on
  // whether 70% of sustained happened to clear the 28-day mean. That is a
  // comparison of two near-identical numbers being used to switch a whole
  // behaviour on and off, and it cost the owner his CIM build by 0.1 mi. The
  // gate is now the quantity the ladder is actually about — how far below their
  // sustained level the runner is — and the steps are spent at doctrine's own
  // rate from the base rather than replayed as fixed 70/85/100 fractions.
  // See `restoreSteps`. `returning` is false on the layoff path, so a genuine
  // layoff still belongs to the comeback protocols.
  const resumeSteps: number[] = (evidence?.returning && evidence.sustainedMi > 0)
    ? restoreSteps(start, evidence.sustainedMi, evidence.heldMi).map((v) => Math.min(peakTarget, v))
    : [];
  const resumeWeeks = Math.min(resumeSteps.length, Math.max(0, climbWeeks - 1));
  // The climbing-week index whose value IS `rampFrom` — week 0 with no resume,
  // the resume's last week with one. The geometric exponent counts from here.
  const firstBuildIdx = resumeWeeks > 0 ? resumeWeeks - 1 : 0;
  const rampFrom = resumeWeeks > 0 ? resumeSteps[resumeWeeks - 1] : start;
  const hold = Math.min(
    PEAK_HOLD_WEEKS[taperCat],
    Math.max(0, climbWeeks - 1 - firstBuildIdx - 1),
  );
  const climbSteps = Math.max(1, (climbWeeks - 1 - hold) - firstBuildIdx);
  const idealFactor = climbWeeks > 1 && peakTarget > rampFrom
    ? Math.pow(peakTarget / rampFrom, 1 / climbSteps)
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
      // WKRESUME-1 · inside the return window the week is the doctrine step,
      // not a point on the climb. Outside it (every plan with no lift, which is
      // every synthetic archetype) `firstBuildIdx` is 0 and `rampFrom` is
      // `start`, so this is byte-for-byte the old `start * f^climbIdx`.
      const geometricTarget = climbIdx < resumeWeeks
        ? resumeSteps[climbIdx]
        : rampFrom * Math.pow(climbFactor, climbIdx - firstBuildIdx);
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
   * PROGRESSION-DOSE-1 (2026-08-30) · WHERE ON THE LADDER THIS WEEK STANDS,
   * recorded even when the catalogue supplied the session's identity.
   *
   * ── The defect this exists for ───────────────────────────────────────────
   *
   * `workShape` above is the LABEL half: it is set only when `trackFor(slot)`
   * is non-null, which excludes any slot the §15 catalogue filled, because a
   * catalogue session "carries the session doctrine names by name" and the
   * ladder must not overwrite those words with its own rendering. That split is
   * deliberate and it is right.
   *
   * But `workShape` was ALSO the only thing that reached storage, and the
   * adaptation gate reads storage. Measured on the owner's CIM block as the
   * cron authors it: 24 quality slots, 21 with `vocabRx` SET, and
   * `trackOfType` non-null on 13 of those 21. So the dose stepped for thirteen
   * sessions — verified directly against `OverloadTrajectory`, which climbs
   * 3x10 → 2x15 → 1x30 on T and 5x3 → 6x3 → 7x3 → 5x4 → 4x5 on I — and its
   * position was written down for TWO. `loadProgressionWeek` then built zero
   * targets, `detectProgressionGate` returned null every week, and
   * `plan_adapt_progression` has zero rows in the entire production database.
   *
   * The ladder was never dark. Only its position was unrecorded.
   *
   * ── Why a separate field rather than widening `workShape` ────────────────
   *
   * Because they answer the two different questions `generate.ts:5449` already
   * separates. `workShape` is "does the trajectory supply the WORDS"; this is
   * "which rung is the DOSE on". Widening the first to cover the second would
   * make the trajectory rename a doctrine-named session — trading variety, a
   * feature, for progression, the product, when both are available.
   *
   * Keyed off `trackOfType`, which is the dose question and is type-driven by
   * construction, so this is populated on exactly the weeks `stepByTrack`
   * stepped. Cleared by `clearWorkShape` alongside its sibling: a day that
   * stops being quality stops carrying a ladder position too.
   */
  progressionDose?: {
    shape: WorkShape;
    lever: ProgressionLever | null;
    zone: ChallengeZone | null;
  } | null;
  /**
   * RATIONALE-PERSIST-1 (2026-09-01) · the §15 catalogue selector's own
   * reason this session beat the alternatives it considered on this slot —
   * `SelectorResult.rationale` in `lib/workout-catalogue/select.ts`, e.g.
   * "Cruise intervals (§5.3) · threshold on the threshold slot in QUALITY; 3
   * session(s) eligible, least recently used wins." Computed at selection
   * time and, until this field existed, discarded at this exact boundary —
   * see `docs/reports/workout-provenance-trace-2026-09-01.md` §1.
   *
   * Present only on a slot the catalogue filled. Absent on a generic
   * trajectory-driven slot (no rotation to explain) and on every non-quality
   * day, the same population `workShape` and `progressionDose` are scoped to.
   */
  catalogueRationale?: string | null;
  /**
   * LONGRUN-ROWS-1 (2026-08-25) · WHICH `Research/04` §4.1 ROW this long run's
   * race-pace segment came from.
   *
   * The engine used to model §4.4's marathon-pace long, §4.5's fast-finish long
   * and §4.6's dress rehearsal as one `{ pct, tag }` object, and a ruling made
   * about one of them silently governed the other two. See ./long-run-rows.
   * Absent on every day that carries no race-pace segment.
   */
  longRunKind?: LongRunKind | null;
  /**
   * LONGRUN-TRACE-1 (2026-08-25) · a race-pace segment this day USED to carry.
   *
   * Four passes can shorten or delete a long run's race-pace block after it is
   * authored, and until now all four did it silently. On the owner's CIM block
   * the post-race window removed the whole marathon-pace finish from the
   * twenty-one-mile run three weeks out — the single most important session of
   * the build — and the only evidence left was the absence of it. A session of
   * that weight disappearing has to leave a mark somebody can read.
   *
   * Collected into `authored_state.long_run_race_pace_changes` by
   * `finalizeComposedPlan`.
   */
  racePaceChange?: { fromMi: number; toMi: number; reason: string; kind: LongRunKind | null } | null;
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
 * Sourced from the in-code workout library (`workout-library-static.ts`,
 * Research/04 + 22, formerly the workout_library table), with the previous
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
   * DOCTRINE-VOCAB-1 (2026-08-17) · prescriptions for the workout-library
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
 * These mirror the `workout-library-static.ts` rows byte-for-byte in structure,
 * so the library path and this fallback describe the same workout. Rest values are
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
// do. `rx.families` is now the workout-library rows and nothing else; a family
// with no row and no catalogue session falls through to the generic
// intervals/threshold/tempo prescription below, exactly as an unseeded family
// always has.

/** Inline last-resort prescriptions — match the historical doctrine in this
 *  file. Library reads supersede these.
 *
 *  Exported 2026-06-02 so the generator-bench test can call composePlan
 *  without resolving the full library (which was a DB query at the time;
 *  the library lives in code now — workout-library-static.ts). */
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
    // fills this from workout-library-static rows where they exist; the catalogue supplies
    // the session itself.
    families: {},
  };
}

/**
 * Resolve prescription strings for one plan, preferring the in-code workout
 * library (`workout-library-static.ts`, formerly the workout_library table).
 * Falls back to the inline catalog on any miss.
 *
 * Still async: the signature predates the table's retirement and every
 * caller awaits it; the body is synchronous now that no DB read remains.
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
  // uses.
  const VOCAB: WorkoutFamily[] = ['hills', 'fartlek', 'cutdown', 'combo', 'marathon_specific', 'race_specific'];
  const intervalsT = pickWorkout({ family: 'vo2max' as WorkoutFamily, distance: cat, phase: phaseFit, level: lvl });
  const thresholdT = pickWorkout({ family: 'threshold' as WorkoutFamily, distance: cat, phase: phaseFit, level: lvl });
  const vocabT = VOCAB.map((family) => pickWorkout({ family, distance: cat, phase: phaseFit, level: lvl }));

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
 *
 * ── MPRACE-1 (2026-09-02) · A WEEK WITH NO LONG RUN CANNOT CARRY ONE ──────
 *
 * `noLongRunAt` names the weeks whose long-run SLOT is a tune-up race day.
 * `embedMidBlockRaces` sets `slot.isLong = wasLong` — a mid-block race landing
 * on the long-run day REPLACES the long — and this walk knew only about
 * deloads, so it could hand §4.4's marathon-pace long to a week that has no
 * long run to put it in. The session was then not moved, not reported and not
 * authored: it simply did not exist.
 *
 * Measured on the reference marathoner's CIM block (0645f40c, 2026-09-02). The
 * RACE-SPECIFIC phase is weeks 8-11. The anchor is week 11, a deload, so it
 * stepped to week 10 — Run Malibu, a half marathon ON his long-run Sunday — and
 * stopped. Stepping back from there lands on week 8, also a deload, and then on
 * week 7, which is outside the phase. Net: the phase whose own recorded purpose
 * is "race-pace durability" authored `racePaceLongsInPhase: 0`. The engine
 * printed that zero into `authored_state` and nothing read it.
 *
 * A race week is a stronger version of the case this function already handles:
 * a deload week COULD carry the session and doctrine says it should not, while
 * a raced week physically cannot. So it takes the same latitude — `Research/04`
 * §4.4's "Every 2-3 weeks during marathon specific phase" — and steps back.
 *
 * The step-back is a bounded LOOP rather than the single `i -= 1` it replaces,
 * because two unavailable weeks can now sit next to each other (10 is raced,
 * 11 is a deload) where two deloads could not. With no mid-block races
 * `noLongRunAt` is always false and the loop runs at most one step, which is
 * the old behaviour literal-for-literal — `_mp_spacing.test.ts` and the
 * `MPLONG.*` doctrine claims walk the no-race case unchanged.
 */
export function racePaceLongThisWeek(
  weekIdx: number,
  weeksToPhaseEnd: number,
  cutbackEveryN: number,
  /** MPRACE-1 · true for a week whose long-run day is an embedded tune-up
   *  race, so there is no long run for the session to live in. Omitted (every
   *  plan with no mid-block races) → byte-identical to the deload-only walk. */
  noLongRunAt: (weekIdx: number) => boolean = () => false,
): boolean {
  const isCutbackAt = (i: number) => i > 0 && (i + 1) % cutbackEveryN === 0;
  const cannotCarry = (i: number) => isCutbackAt(i) || noLongRunAt(i);
  /** Nearest week at or before `i` that can actually hold the session. */
  const stepBack = (i: number): number => {
    let j = i;
    for (let guard = 0; j > 0 && cannotCarry(j) && guard < 500; guard++) j -= 1;
    return j;
  };
  // Anchor on the phase's LAST week — the one closest to the race — and step
  // back. Anchoring on the first week instead would make the cadence depend on
  // where the phase happens to start, so a 15- and a 16-week build would put
  // the final MP long a different distance from race day.
  let i = stepBack(weekIdx + weeksToPhaseEnd);
  // The sequence descends strictly, so this terminates; the guard is belt and
  // braces against a caller passing a degenerate cutbackEveryN.
  for (let guard = 0; i >= 0 && guard < 500; guard++) {
    if (i === weekIdx) return true;
    if (i < weekIdx) return false;
    const next = stepBack(i - MP_LONG_CADENCE_WEEKS);  // stretch to the 3-week end of the band
    if (next >= i) return false;                       // no earlier week can carry it
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
 * 5K (racePaceTag null) → null everywhere · 5Ks train via reps, not long-run
 * pace inserts: every long run in Research/22's three 5K rows is plain E
 * ("3.5-4 mi (E)", "6 mi E", "10-12 mi E"). Ultra likewise (see racePaceTag).
 *
 * 10K (racePaceTag null) · VARIETY-10K-1 (2026-08-28) · the 10K is NOT plain:
 * `Research/22` §"10K — Intermediate" names "progression LR" among Key workout
 * types and its sample peak week states the dose — "9-10 mi E w/ last 2 mi
 * @ M". That is `Research/04` §4.3's progression long run ("Frequency | Every
 * 2–3 weeks in specific phase"), expressed as the fixed two-mile M tail the
 * sample states rather than the marathon-sized fractions above. The caller
 * passes `tenKProgression` only when the plan is a non-beginner 10K, and the
 * cadence flag it passes is already scoped to the race-specific phase.
 */
function longFinishSegment(
  phase: string,
  weeksToPhaseEnd: number,
  racePaceTag: 'HM' | 'MP' | null,
  /** DOCTRINE-MPLONG-1 / DOCTRINE-HMLONG-1 · `racePaceLongThisWeek` for this
   *  week. Only the RACE-SPECIFIC arm consults it; the QUALITY warm-in ramp is
   *  three weeks long and already a cadence of its own. */
  cadenceWeek: boolean = true,
  /** VARIETY-10K-1 · true only when this is a 10K plan that trains a
   *  progression LR (non-beginner) AND the week is a race-specific cadence
   *  week (`racePaceLongThisWeek`, same rhythm as §4.4/§4.5 — §4.3 states the
   *  identical "Every 2–3 weeks in specific phase"). Encodes the phase test,
   *  so this function adds none of its own. */
  tenKProgression: boolean = false,
): { pct: number; fixedMi?: number; tag: 'HM' | 'M' | 'MP'; kind: LongRunKind } | null {
  if (!racePaceTag) {
    // VARIETY-10K-1 · Research/22 §"10K — Intermediate": "9-10 mi E w/ last
    // 2 mi @ M". Fixed miles, not a fraction — TENK_PROGRESSION_FINISH_MI is
    // the doc's own 2, so `finishRawMi` takes it verbatim (still bounded by
    // the week's M-pace dose budget, like every race-pace finish).
    if (tenKProgression) {
      return { pct: 0, fixedMi: TENK_PROGRESSION_FINISH_MI, tag: 'M', kind: 'progression' };
    }
    return null;
  }
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
    // LONGRUN-ROWS-1 · the marathon's race-specific long IS §4.4's
    // marathon-pace long run ("14-22 mi | Easy warmup + 8-16 mi at MP"); the
    // half's is §4.5's fast finish, which is what this arm's own comment
    // already cites for it. Naming them apart is what stops a ruling about one
    // reaching the other. See ./long-run-rows.
    return { pct: 0.50, tag: racePaceTag, kind: racePaceTag === 'MP' ? 'mp_long' : 'fast_finish' };
  }
  if (phase !== 'QUALITY') return null;
  // VARIETY-LONG-1 (2026-08-28) · the warm-in window is now cadence-gated too.
  // The ramp below is §4.5's shape at every step, and §4.5's own Frequency row
  // is "Every 2–3 weeks" — a rhythm, not a window. `Research/00a` §"Long-run
  // rules of thumb" states it block-wide: "Most long runs are easy; intensity
  // inserts come 1 in every 2–3 long runs in marathon/half cycles." Three
  // consecutive warm-in finishes were exactly what that sentence forbids.
  // The caller passes the same `racePaceLongThisWeek` walk, anchored on this
  // phase's own end, so the LAST warm-in week still carries the step to race
  // pace and the intervening week runs plain.
  if (!cadenceWeek) return null;
  // Last QUALITY weeks build toward race pace. HM ramps M → HMP;
  // M holds MP throughout (race pace == marathon pace).
  const mTag: 'M' | 'MP' = racePaceTag === 'HM' ? 'M' : 'MP';
  // The warm-in ramp is §4.5's shape at every step — "final 2-6 mi at MP or
  // slightly faster" — for both distances. §4.4's larger dose starts at the
  // RACE-SPECIFIC seam above.
  switch (weeksToPhaseEnd) {
    case 0:  return { pct: 0.33, tag: racePaceTag, kind: 'fast_finish' };  // last QUALITY wk · HMP step / MP
    case 1:  return { pct: 0.33, tag: mTag, kind: 'fast_finish' };
    case 2:  return { pct: 0.30, tag: mTag, kind: 'fast_finish' };
    default: return null;                             // earlier QUALITY · plain long
  }
}

/**
 * LAYOUTWEEK-CONTRACT-1 (2026-09-02) · brief Phase 2, first cut.
 *
 * `layoutWeek` took FORTY inline-destructured parameters under an anonymous
 * type literal, which is the shape the brief names as the thing to fix: "Each
 * function takes a typed object, not forty positional/destructured
 * parameters." An anonymous literal cannot be handed to a second function, so
 * every responsibility the brief wants split out — `resolveWeekRole`,
 * `resolveKeySessionSlots`, `resolveLongRunIntent` and the rest — would have
 * had to re-declare its own slice of it, and the eight functions would have
 * been eight new contracts instead of one shared one.
 *
 * Naming it is therefore the FIRST step rather than a cosmetic one: a
 * responsibility can now be lifted out by taking a `Pick<LayoutWeekInput, …>`,
 * which is what `layoutRaceWeek` below does.
 *
 * NOTHING ELSE CHANGED. The member list, its defaults and its doc comments are
 * the ones that were inline, moved verbatim; `layoutWeek` destructures the
 * object on its first line so its three thousand lines of body are untouched.
 * `_layout_contract.test.ts` asserts the whole archetype matrix composes
 * byte-identically across this change.
 */
export interface LayoutWeekInput {
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
   *  never asks for a long shorter than what the runner just did.
   *  RULE8-2 · habit value, prescribed span excluded. */
  recentLongMi?: number;
  /** RULE8-2 · literal prior-28-day max · the single-session spike anchor. */
  spikeAnchorLongMi?: number;
  /** LONGEVIDENCE-1 · the block's long-run ceiling, resolved from the runner's
   *  own demonstrated long runs by `evidenceLongCeilingMi` and already bounded
   *  by the tier band. Null → no long-run evidence; the band stands alone. */
  evidenceLongCapMi?: number | null;
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
  /**
   * MPRACE-1 (2026-09-02) · week indices whose LONG-RUN DAY is a mid-block
   * tune-up race, so the week has no long run for §4.4's marathon-pace long
   * (or §4.5's fast finish, or §4.3's progression tail) to live in.
   *
   * Derived in `composePlan` from the same three facts `embedMidBlockRaces`
   * uses to decide it — the race date, the block's start Monday and the
   * runner's long-run day-of-week — because the embed itself runs AFTER the
   * whole layout loop and `layoutWeek` cannot see it. `MPRACE.long-slot-
   * prediction-matches-the-embed` in the doctrine registry asserts the two
   * agree on the composed plan rather than leaving the duplication unchecked.
   *
   * Omitted / empty (every plan with no mid-block races) → the cadence walk is
   * byte-identical to the deload-only one.
   */
  noLongRunWeeks?: ReadonlySet<number>;
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
   * MPLABEL-1 (2026-08-25) · WHICH marathon pace `weekMpPaceSec` is.
   *
   * `Research/04` §"Pace zone shorthand" carries both codes in one table:
   * `M` = Goal MP, `MP` = Current MP. `resolveMarathonPace` decides between
   * them and, until now, threw the decision away — so every note this function
   * writes over an MP session asserted the goal's pace regardless of which one
   * the session actually got.
   *
   * true  → the goal genuinely sits inside the marathon zone and is prescribed
   *         "exactly — not faster" (`Research/04` §4.4). Notes may name it as
   *         race pace.
   * false → the goal was refused (faster than the runner's own threshold, or
   *         slower than their long-run bulk) and the session is at marathon
   *         EFFORT for demonstrated fitness. Notes must say so.
   * null  → no marathon-pace work in play (no goal, or not a marathon block).
   *         Every note falls back to its pre-MPLABEL-1 wording.
   */
  weekMpAtGoalPace?: boolean | null;
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
  /**
   * DOWNHILL-2 (2026-08-29) · does the GOAL RACE run net downhill, on trusted
   * course data?
   *
   * Research/11's eccentric-loading protocol is course-specific training, and
   * the two sessions it prescribes are only ever right for a course that
   * descends. Offering them to a flat-marathon runner would be the engine
   * inventing a stimulus their race does not ask for — the protocol's own cost
   * is deliberate muscle damage — and NOT offering them to a net-downhill
   * runner is the gap this flag closes: CIM is Research/11's named archetype,
   * and Research/08 §4.5 puts the downhill payoff at "0% or negative for
   * untrained". Same signal `applyCourseGuidance` gates its note on, so the
   * note and the sessions cannot disagree about what kind of race this is.
   */
  courseIsNetDownhill?: boolean;
  /**
   * THESIS-PLAN-1 (2026-09-02) · what the Coaching Thesis asks of this week's
   * quality slots, or null when there is no thesis.
   *
   * Constitution §F is the boundary this respects: the composer does NOT rank a
   * capacity, and nothing here computes one. It carries the limiter the Thesis
   * already named and lets `selectSlotWorkout` prefer, inside doctrine's own
   * placement for the slot, a session that can EVIDENCE it. See
   * `ThesisSlotContext` in `catalogue-rx.ts` for the finding (brief §3.2.I) and
   * for what happens when nothing paced is offerable.
   */
  thesisSlot?: ThesisSlotContext | null;
}

/**
 * LAYOUTWEEK-RACEWEEK-1 (2026-09-02) · brief Phase 2 · the race week, lifted
 * out of the monolith.
 *
 * The first responsibility split the brief asks for, and it is the one that
 * comes out CLEAN: the race-week branch reads six of `layoutWeek`'s forty
 * inputs and nothing else, writes seven days from scratch, and returns before
 * any of the standard week's sizing runs. It shared a three-thousand-line
 * scope with the build week for no reason other than that it was written
 * there.
 *
 * Its parameter is a `Pick<LayoutWeekInput, …>`, which is the point of naming
 * that contract one commit earlier: a responsibility can now be lifted out
 * without re-declaring its own slice of the composer's inputs. The remaining
 * seven splits the brief lists (`resolveWeekLoadBudget`,
 * `resolveKeySessionSlots`, `resolveLongRunIntent`,
 * `resolveEasyAndMediumLongDays`, `allocateWeeklyMileage` …) are NOT done, and
 * the handback says so rather than implying this was the whole of Phase 2.
 *
 * BEHAVIOUR PRESERVED, BYTE FOR BYTE. The body is the branch verbatim, one
 * indent level out; `_layout_contract.test.ts` composes the whole archetype
 * matrix on both sides of the change and compares the serialised weeks.
 */
function layoutRaceWeek(input: Pick<
  LayoutWeekInput,
  'phase' | 'raceDow' | 'raceDistanceMi' | 'trainingDaysPerWeek' | 'availableDows'
>): DayPlan[] {
  const { phase, raceDow, raceDistanceMi, trainingDaysPerWeek, availableDows } = input;
  if (raceDow == null) return [];
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

function layoutWeek(input: LayoutWeekInput): DayPlan[] {
  const {
  phase, weekIdx, weeksToPhaseEnd, totalWeeks, weeklyMi, peakWeeklyMi, longRunDow, qualityDows, restDow, isRaceWeek, raceDow, raceDistanceMi, rx, easyMileFloor, recentLongMi, spikeAnchorLongMi, recentQualityDistanceMi, tierTarget, trainingDaysPerWeek, cutbackEveryN = 4, baseBuilding = false, availableDows = null, easyPaceSecPerMi = null, trajectory = null, weekTPaceSec = null, weekIPaceSec = null, weekMpPaceSec = null, weekMpAtGoalPace = null, catalogueHistory = null, level = null, courseIsNetDownhill = false, thesisSlot = null, noLongRunWeeks = undefined, evidenceLongCapMi = null,
  } = input;
  // MPRACE-1 · the cadence walk's "this week has no long run" predicate. One
  // definition here so all four call sites below ask the same question.
  const noLongRunAt = (i: number) => noLongRunWeeks?.has(i) === true;
  // LAYOUTWEEK-RACEWEEK-1 · the race week is its own responsibility now.
  if (isRaceWeek && raceDow != null) {
    return layoutRaceWeek({ phase, raceDow, raceDistanceMi, trainingDaysPerWeek, availableDows });
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
   * Resolved only where a `repetition`-family session can exist — BASE, and
   * (VARIETY-R3-1) the 5K/10K QUALITY / RACE-SPECIFIC weeks whose third
   * quality day is the R day — `resolveZoneAnchors` walks the VDOT table and
   * this function runs once per week of every plan in a 120k-archetype sweep.
   */
  const weekRPaceSec = (phase === 'BASE'
    || ((phase === 'QUALITY' || phase === 'RACE-SPECIFIC')
      && (distanceCategoryOf(raceDistanceMi) === '5k' || distanceCategoryOf(raceDistanceMi) === '10k')))
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
  // LONGEVIDENCE-1 (2026-09-02) · THE CEILING COMES FROM THE RUNNER, AND THE
  // BAND CAPS IT.
  //
  // `peakLongMiBand[1]` is keyed to `profile.experience_level` — a word typed
  // at onboarding — and it was the ONLY thing setting how far this block's long
  // run could climb. The owner's ruling: "My actual history — not an onboarding
  // label — must determine appropriate load", and for the long run, "choose
  // from evidence, not from the old plan or a generic tier."
  //
  // `evidenceLongCapMi` is that number: the greater of what he has already run
  // in normal training and what `Research/00a`'s per-cycle growth row licenses
  // him to add to his recent normal-training long, already `min`-ed against the
  // band by `evidenceLongCeilingMi`. Absent (cold start, or a failed read the
  // caller decided not to refuse on) the band stands alone, which is the only
  // answer available for a runner with no long runs — Rule 11 keeps "no
  // evidence" and "evidence says small" apart, because they are opposite facts.
  const bandLongCap = (longCat === 'ultra')
    ? Math.min(tierTarget.peakLongMiBand[1], Math.round(raceDistanceMi * 0.95))
    : tierTarget.peakLongMiBand[1];
  const longCap = evidenceLongCapMi != null && evidenceLongCapMi > 0
    ? Math.min(bandLongCap, evidenceLongCapMi)
    : bandLongCap;
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
  // ── LONGSIZE-CONTINUOUS-1 (2026-08-30) · Rule 9 · TWO FORMULAS, ONE SWITCH ─
  //
  // The 5k/10k/hm arm used to read:
  //
  //     Math.round(peakWeeklyMi * longShare) < peakLongMiBand[0]
  //       ? Math.max(shareLongRaw, drivenLongRaw)     // ramped to band[1]
  //       : shareLongRaw                              // the share alone
  //
  // and `Math.max(a, b) >= a` for every input, so crossing that threshold
  // UPWARD could only ever make the long run SHORTER. More weekly volume, less
  // long run — Rule 9's stated signature, on the session the block is built
  // around. Measured on the plan walk: a peak of 36.3 authored a 14-mile long,
  // a peak of 36.5 authored a 12-mile one.
  //
  // Rule 9's corollary says to ask what the threshold is ANSWERING before
  // reaching for a smoother, and here the answer is: nothing the `max` does
  // not already answer for itself. The condition chose between
  // `max(share, driven)` and `share` — and `max(share, driven)` IS `share`
  // wherever the share is the larger of the two. The branch was a hand-decided
  // shortcut for a case the max decides correctly on its own, and a wrong one,
  // because the two sides do not agree at the boundary. So it is DELETED, not
  // interpolated:
  //
  //     longMiRaw = max(weeklyMi × longShare, weeklyMi × longCap / peakWeeklyMi)
  //
  // Nothing left to fall off, and the authored SIZES do not move: walking an
  // advanced HM block across the old threshold produces the same long runs
  // literal-for-literal, now moving monotonically with the block instead of
  // stepping down at one peak. A smaller reading of RC2-2 — ramping the lift
  // to `peakLongMiBand[0]` rather than `longCap` — was tried first and
  // REJECTED: it is also continuous, but it shortens an advanced half's peak
  // long from 17 to 15, and a continuity fix has no business reducing a
  // runner's training. `LONGSIZE-CONTINUOUS-1` in `_restore_continuity.test.ts`
  // is the walk, falsified against the ternary before this landed.
  const drivenLongRaw = peakWeeklyMi > 0 ? Math.round(weeklyMi * (longCap / peakWeeklyMi)) : 0;
  const shareLongRaw = Math.round(weeklyMi * longShare);
  const longMiRaw = (longCat === 'm' || longCat === 'ultra') && peakWeeklyMi > 0
    ? drivenLongRaw
    : Math.max(shareLongRaw, drivenLongRaw);
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
    // RULE8-2 (2026-08-30) · the SPIKE anchor, not the habit value. Research/00a
    // §"Volume progression rules" writes its own window into the rule this
    // implements — ">110% of longest run in the prior 30 d" — so this one stays
    // literal even where Rule 8 filters everything else. A runner whose longest
    // run in the last thirty days really is 13.5 is at spike risk on an
    // 18-miler however fit he was five weeks ago. `longFloor` above is the
    // habit question and DOES read the Rule-8-filtered `recentLongMi`.
    const spikeAnchorMi = spikeAnchorLongMi ?? recentLongMi;
    if (!spikeAnchorMi || spikeAnchorMi <= 0) return longCap;
    // LOWVOL-1 (2026-08-19) · FLOOR to the half mile, not ROUND to the whole.
    // `Math.round` can only ever push this ABOVE the multiple it is enforcing,
    // and proportionally that costs the small runner the most: a 6 mi longest
    // rounded to 7 is 117%, a 5 to 6 is 120%, against doctrine's flat "should
    // not exceed 110% of the longest run in the prior 30 days". Flooring can
    // only reduce, never raise, and lands on the half-mile grid the rest of the
    // generator rounds to.
    const seed = Math.floor(spikeAnchorMi * 1.10 * 2) / 2;      // week-0 ≤110% of recent
    const stepCeil = spikeAnchorMi * Math.pow(1.10, weekIdx);   // ≤10%/step geometric climb
    // LONGARRIVE-1 (2026-09-02) · THE RAMP MUST ARRIVE ON A WEEK THAT CAN
    // CARRY THE LONG RUN.
    //
    // `totalWeeks - 4` is "~3-4 weeks before the race" and is otherwise
    // correct. It is also, for a three-week deload cadence, frequently a
    // CUTBACK — and a cutback week's long is deliberately small, so the ramp
    // aims at a week that will never hold the number, and the block's biggest
    // real long lands a step short of the ceiling the engine computed for it.
    // Measured on the reference marathoner: ceiling 21.5, arrival week 11 (a
    // deload), biggest real long 20.0 — a ceiling the block was structurally
    // incapable of reaching, which is Rule 21's "wired, tested and inert" in
    // the one place it costs the most.
    //
    // Step back to the nearest earlier week that is not a deload, the same
    // latitude and the same helper shape `racePaceLongThisWeek` already uses
    // for §4.4's cadence. With a four-week cadence the arrival week is usually
    // already a load week and this is a no-op.
    const peakWeekIdx = (() => {
      let i = Math.max(1, totalWeeks - 4);                    // reach the cap ~3-4 wk before race
      for (let g = 0; i > 1 && i > 0 && (i + 1) % cutbackEveryN === 0 && g < 500; g++) i -= 1;
      return Math.max(1, i);
    })();
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
  //
  // ── RULE 11 (2026-09-01) · AN UNREADABLE PACE IS A REFUSAL, NOT AN EXEMPTION
  //
  // This used to read `if (longCat !== 'ultra' && easyPaceSecPerMi != null &&
  // easyPaceSecPerMi > 0) { … }` and nothing else. A missing easy pace SILENTLY
  // DISABLED the 3-hour cap — the safest reading of the data producing the most
  // aggressive plan, which is Rule 11's exact sentence: "a missing input must
  // never silently disable a safety mechanism". For a 12:00/mi runner the cap
  // binds at 15 mi; without it a distance-driven 20-miler is a four-hour long
  // run, aimed at the cohort least equipped to absorb it.
  //
  // The cap still cannot be APPLIED without a pace — there is nothing to divide
  // by, and inventing one would be worse. What changes is that the skip is now
  // STATED rather than silent, so a plan authored without this ceiling can be
  // told apart from one the ceiling did not bind on.
  if (longCat !== 'ultra') {
    if (easyPaceSecPerMi != null && easyPaceSecPerMi > 0) {
      const timeCapMi = Math.floor(((LONG_RUN_MAX_HOURS * 3600) / easyPaceSecPerMi) * 2) / 2;
      // Never cap below the coherence floor a long run needs to still be a long run.
      if (timeCapMi >= 3) longMi = Math.min(longMi, timeCapMi);
    } else {
      // eslint-disable-next-line no-console
      console.warn('[plan/generate] SAFETY CAP NOT APPLIED', {
        cap: 'LONG_RUN_MAX_HOURS',
        capHours: LONG_RUN_MAX_HOURS,
        site: 'layoutWeek · absolute-time long-run cap',
        reason: easyPaceSecPerMi == null
          ? 'easyPaceSecPerMi is null · no easy-band anchor resolved for this week'
          : 'easyPaceSecPerMi is not a positive number',
        easyPaceSecPerMi,
        weekIdx,
        phase,
        longMiUncapped: longMi,
        doctrine: 'Research/00a §"Volume progression rules" · <3.0-3.5 h for marathoners',
        consequence: 'The long run for this week is sized by DISTANCE only. It may exceed '
          + `${LONG_RUN_MAX_HOURS} hours at this runner's own easy pace, and nothing downstream `
          + 'knows the ceiling did not run.',
      });
    }
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
    && racePaceLongThisWeek(weekIdx, weeksToPhaseEnd, cutbackEveryN, noLongRunAt);
  // VARIETY-LONG-1 (2026-08-28) · the QUALITY warm-in ramp is ALSO on the
  // cadence now. The ramp is §4.5's shape at every step (this function's own
  // comment says so), and §4.5's Frequency row — "Every 2–3 weeks" — does not
  // stop applying because the phase changed. `Research/00a` §"Long-run rules of
  // thumb" states the same rule for the whole block: "Most long runs are easy;
  // intensity inserts come 1 in every 2–3 long runs in marathon/half cycles."
  // The old shape put a finish on each of the last THREE QUALITY weeks — three
  // consecutive intensity longs, which is the one thing both rows forbid. The
  // cadence is the SAME picker the race-specific arm walks, anchored on this
  // phase's own last week, so the last QUALITY long still carries the HMP/MP
  // step and never lands on a deload. Off-cadence warm-in weeks run plain.
  // Bound by LONGRUN.intensity-cadence.
  const qualityIntensityLongWeek = phase === 'QUALITY' && racePaceTag != null
    && racePaceLongThisWeek(weekIdx, weeksToPhaseEnd, cutbackEveryN, noLongRunAt);
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
  // MPLABEL-1 · null (no signal threaded) reads as "at goal pace", which is the
  // pre-2026-08-25 wording — so a composer that does not pass the flag is
  // byte-identical. Only an explicit `false` changes a sentence.
  const taperMpAtGoalPace = weekMpAtGoalPace !== false;
  // VARIETY-10K-1 · the 10K's §4.3 progression LR rides the SAME cadence flag
  // (§4.3's "Every 2–3 weeks in specific phase" is byte-identical to §4.4/§4.5's
  // rhythm) but cannot reuse `racePaceLongWeek`, which requires a race-pace tag
  // the 10K deliberately does not have. Beginners excluded — Research/22
  // §"10K — Beginner" longs are "E with optional walk breaks", no progression
  // LR row. Off-cadence and non-race-specific weeks stay plain, as does every
  // TAPER week (the flag is scoped to RACE-SPECIFIC).
  //
  // The week's quality mix is NOT thinned on the weeks this lands, and that is
  // Research/22's own call, not an oversight: the §"10K — Intermediate" sample
  // peak week runs the T session (Tue), the I session (Thu) AND the "last 2 mi
  // @ M" long (Sat) in the same seven days. §4.3's "don't pair with other
  // quality work" contraindication describes its full-size shape ("final 1/4
  // to 1/3 at M to T" — 3-4 mi of it on a 16-miler); the two-mile M tail is
  // the smaller session the sample week prescribes alongside both, and it
  // spends the M budget, which neither structured slot touches.
  const tenKProgressionWeek = cat === '10k' && !baseBuilding
    && phase === 'RACE-SPECIFIC' && racePaceLongThisWeek(weekIdx, weeksToPhaseEnd, cutbackEveryN, noLongRunAt);
  const finishSeg = longFinishSegment(
    phase, weeksToPhaseEnd, racePaceTag,
    // VARIETY-LONG-1 · one cadence, whichever phase asks. RACE-SPECIFIC weeks
    // read `racePaceLongWeek` exactly as before; QUALITY weeks now read their
    // own phase-anchored walk of the same picker.
    phase === 'QUALITY' ? qualityIntensityLongWeek : racePaceLongWeek,
    tenKProgressionWeek,
  );
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
  // VARIETY-10K-1 · a finish that states its miles outright (`fixedMi` — the
  // 10K's "last 2 mi @ M") takes them verbatim; the fraction-sized rows keep
  // their share of the long. Both stay bounded by the week's dose budget.
  const finishRawMi = finishSeg
    ? Math.min(finishSeg.fixedMi ?? Math.round(longMi * finishSeg.pct), Math.floor(finishBudgetMi * 2) / 2)
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

  /* ── VARIETY-LONG-1 (2026-08-28) · WHICH intensity long, from the catalogue ──
   *
   * The cadence machinery above decides WHETHER this week's long carries
   * intensity. Until now the VARIANT was fixed per (phase, distance): every
   * marathon race-specific cadence week was §4.4, every other intensity long
   * was §4.5's single-tag finish, and §4.3's progression long run sat in the
   * catalogue cited and unreachable — `SLOT_FAMILIES.long` declared the five
   * §4 entries and no composer path ever passed the slot. `Research/00a`
   * §"Long-Run Variations" is direct about both halves: "Long runs are not
   * monolithic" and, on the progression row itself, "Don't make every long run
   * a progression — rotate."
   *
   * So on the cadence weeks the catalogue's `long` family now picks the row,
   * LRU-rotated through the same `CatalogueHistory` the quality slots rotate
   * through, filtered by the entries' own phase/distance/tier declarations.
   * What deliberately does NOT rotate:
   *
   *   · Marathon RACE-SPECIFIC cadence weeks stay §4.4. Its row calls the
   *     session "the marathon-specific stimulus" and §15's race-specific row
   *     names "MP long runs" among the phase's primary workouts — it is the
   *     dominant entry there by doctrine, not by rotation. §4.6's rehearsal
   *     (via `authorDressRehearsal`) is the late-phase variation.
   *
   *     SEGLONG-2 (2026-08-29) · this exclusion was tried WIDENED, to let
   *     §11.1's modified block and Research/11's downhill simulation into the
   *     window doctrine places them in, on the reasoning that every eligible
   *     entry there carries MP so the stimulus survives. That reasoning is
   *     true and still insufficient: the corpus gate came back with 78
   *     enforced dosing breaches and 156 firm validator failures, all of the
   *     shape "RACE-SPECIFIC · session doses N mi at M · doctrine caps it at
   *     20% of weekly". `DAY-SIZE-1` below is why — on a marathon-pace long
   *     week the MP block IS the week's race-specific stimulus, and the
   *     quality slots are sized against that assumption. Rotating the long
   *     breaks it and the week pays for marathon-pace work twice.
   *
   *     So the exclusion is load-bearing for DOSE ACCOUNTING, not only for
   *     doctrine flavour, and it stays. The two sessions reach the plan by
   *     routes that do not disturb the accounting: §11.1's block is offered in
   *     `specific_support` (the engine's QUALITY phase), which is where its
   *     own row puts the FIRST block — "8-10 weeks out"; and Research/11's
   *     simulation is placed by `authorDownhillSimulation`, a post-pass that
   *     PROMOTES a long already carrying race pace and adds no load at all.
   *   · The 10K's fixed two-mile tail (kind 'progression' out of
   *     `longFinishSegment`) is Research/22's own sample-week dose, not a
   *     fraction-sized shape, and stays as authored.
   *   · Dress rehearsal never rotates in — §4.6 is placed by days-to-race and
   *     authored by `authorDressRehearsal`; the selector wrapper excludes it.
   *
   * SIZING STAYS THE COMPOSER'S. The chosen entry contributes the SHAPE only.
   * A progression week re-splits the SAME `finishMi` the default finish was
   * already sized to (volume-curve fraction, bounded by the week's dose
   * budget), so rotating the shape never adds a hard mile: an M middle and a
   * T tail (`PROGRESSION_TAIL_SHARE`), each floored at `FAST_FINISH_MIN_MI`,
   * the tail additionally inside Daniels' weekly T budget. A week that cannot
   * seat both segments keeps the default single-tag finish and the offer is
   * recorded as an attempt, ROTATION-ATTEMPT-1's own device, so the rotation
   * self-corrects instead of re-offering it forever.
   */
  const longTier = (catalogueHistory != null && level != null) ? (level as Tier) : null;
  const rotatesLongVariant = hasFinish && !baseBuilding
    && finishSeg!.kind !== 'progression'
    && !(phase === 'RACE-SPECIFIC' && racePaceTag === 'MP')
    && (phase === 'QUALITY' || phase === 'RACE-SPECIFIC')
    && longTier != null && catalogueHistory != null;
  /**
   * ROTATION-REFUSE-1 (2026-08-29) · a variant the week cannot fund yields to
   * the next candidate instead of burning the slot.
   *
   * Both §4.3's progression and §11.1's modified block are SHAPES the composer
   * has to be able to seat inside the finish it already sized: each of their
   * segments has to clear §4.5's two-mile floor, and the block's second segment
   * additionally has to leave the easy bulk outweighing the work. On a week
   * where that fails, the code below used to record the attempt and fall
   * through to the default single-tag finish — the rotation self-corrected on
   * the NEXT cadence week, which is the right contract when there is a next
   * one.
   *
   * A marathon block does not have one. `rotatesLongVariant` fires only outside
   * BASE and only where §4.4's race-specific MP long has not already claimed
   * the week, which comes to exactly TWO rotated long runs per block at every
   * length from 12 to 20 weeks. So a single refusal did not cost a week of
   * variety, it cost half the block's: an 18-week build measured on 2026-08-29
   * authored `fast_finish, fast_finish` — the same session twice, with §4.3
   * never appearing — because the second slot drew a block the week could not
   * fund and degraded rather than falling back to the progression that was
   * sitting right behind it in the rotation.
   *
   * So the refusal re-asks. Same device `selectSlotWorkout` already uses for a
   * shape it cannot render: exclude what refused, select again, and let the
   * least-recently-used order pick the next one. The attempt is still recorded,
   * so the rotation's memory is unchanged and a session the week cannot fund
   * does not keep winning the tie on staleness. Bounded by the candidate count;
   * when everything refuses, `longVariant` is null and the day keeps the
   * default finish exactly as it did before.
   */
  const longVariantExclude = new Set<string>([
    // ROTATION-REFUSE-1 · on a marathon, §4.5 is the default the rotation
    // departs from, so a slot spent on it is a slot spent on nothing. Stated
    // and reasoned at `MARATHON_ROTATION_EXCLUDED`; conditional on the same
    // `racePaceTag` the race-specific reservation above reads, so the two
    // cannot disagree about which distance reserves §4.4.
    ...(racePaceTag === 'MP' ? MARATHON_ROTATION_EXCLUDED : []),
    // DOWNHILL-2 · Research/11's simulation is training FOR a descent.
    // Excluded outright on a race that does not descend, rather than left
    // to lose the LRU rotation by luck: a flat-course runner should never
    // be offered it, and a net-downhill runner should not have their one
    // prescribed simulation depend on which sessions happened to come up
    // recently.
    ...(courseIsNetDownhill ? [] : DOWNHILL_ONLY_SLUGS),
  ]);
  const recordLongAttempt = (slug: string) => {
    if (catalogueHistory && !catalogueHistory.attempts.some(
      (a) => a.slug === slug && a.weekIdx === weekIdx,
    )) {
      catalogueHistory.attempts.push({ slug, weekIdx });
    }
  };
  /** §4.3's two-pace walk, sized inside the finish the week already bought. */
  const progressionSegFor = (): { midMi: number; tailMi: number } | null => {
    const tBudget = weeklyDoseBudgetMi(weeklyMi, 'T', weekDoseContext);
    const tailMi = Math.min(
      Math.max(FAST_FINISH_MIN_MI, Math.floor(finishMi * PROGRESSION_TAIL_SHARE * 2) / 2),
      Math.floor(tBudget * 2) / 2,
    );
    const midMi = Math.round((finishMi - tailMi) * 2) / 2;
    // Both segments real (§4.5's two-mile floor applies to each), and the easy
    // bulk still the run's first act (§4.3 "First 1/3 to 1/2 at E pace") —
    // guaranteed by hasFinish (finishMi ≤ half the long).
    return (tailMi >= FAST_FINISH_MIN_MI && midMi >= FAST_FINISH_MIN_MI)
      ? { midMi, tailMi }
      : null;
  };
  /**
   * SEGLONG-2 (2026-08-29) · the segmented long — two marathon-pace blocks
   * with easy running BETWEEN them, not one block at the end.
   *
   * Research/04 §11.1's Variations row: "Modified block (single longer run
   * with two segments separated by short rest) for mortals". It is the only
   * form of the Canova block a non-elite can run and the only form this engine
   * can schedule, since `plan_workouts` holds one session per date and the
   * elite version is a two-a-day.
   *
   * Why it is a DIFFERENT session from the progression long above, and not a
   * cosmetic re-cut of it: a progression runs its quality continuously to the
   * finish, so the runner enters marathon pace once, fresh-ish, and stays
   * there. This one asks them to come back to marathon pace a second time with
   * the first block already in the legs and the easy running having let them
   * partly recover — §11.1's Purpose row calls that "trains under-fatigue
   * running", and it is the stimulus the doc names, not the mileage.
   *
   * The gap is what makes it that session, and until SEGLONG-1 the segment
   * grammar could not express one: segments were contiguous and tail-anchored,
   * so every easy mile went in front of the quality. Both halves had to land
   * for this to be authorable at all — the grammar, and this branch that
   * emits it.
   */
  const modifiedBlockSegFor = (entry: CatalogueEntry): { firstMi: number; gapMi: number; secondMi: number } | null => {
    /*
     * SEGLONG-3 (2026-08-29) · size §11.1 off §11.1, not off §4.5.
     *
     * This used to read `Math.min(finishMi, …)`, and `finishMi` is the FAST
     * FINISH's number — §4.5's "final 2-6 mi at MP", sized by the volume curve
     * for a completely different session. The marathon-pace budget alongside it
     * is `Infinity`, because doctrine writes "n/a" in M's WEEKLY column, so the
     * fast-finish bound was the only thing binding this session at all.
     *
     * What that produced, measured on a 14-week advanced build at 65 mi/wk:
     * a 19-mile long run carrying `3.5mi @ M + 1mi @ E + 2mi @ M`. Five and a
     * half miles at marathon pace — LESS than the same block's own §4.4 weeks,
     * which carry 10.5 and 12 — and split into two pieces, so it was strictly
     * worse than the plain fast finish it displaced: the same volume, in halves
     * too small to be blocks, with the "under-fatigue" second effort arriving
     * after three and a half easy-ish miles. §11.1's Purpose row calls this a
     * "massive marathon-specific stimulus"; it was the smallest quality long in
     * the block.
     *
     * The session's own row states its dose, so that is what sizes it now. Both
     * numbers are READ, never written here:
     *
     *   · `entry.atPace` — §11.1's at-pace total, which the catalogue holds in
     *     the doc's own unit (20 km, off the Structure row's 12 km + 8 km).
     *   · `MARATHON_PACE_WORKOUT_CAP` — `Research/01`'s "the lesser of 18 mi or
     *     20% of weekly mi", the ceiling on ONE session's marathon-pace work.
     *     This is the bound that should always have been here, and the one the
     *     dosing gate measures the result against.
     *
     * The lesser wins, so a small week still buys a small block and the gate
     * cannot be breached by construction. Bound by
     * `LONGRUN.modified-block-doses-its-own-row` in lib/doctrine/registry.ts.
     */
    const atPaceBandMi = entry.atPace
      ? entry.atPace.min * (entry.atPace.unit === 'km' ? MI_PER_KM
        : entry.atPace.unit === 'm' ? MI_PER_KM / 1000 : 1)
      : Infinity;
    // `Research/01` §"Dosing rules": both halves bind and the lesser wins.
    const danielsMi = Math.min(
      MARATHON_PACE_WORKOUT_CAP.absMi,
      Math.max(0, weeklyMi) * MARATHON_PACE_WORKOUT_CAP.pctOfWeekly,
    );
    const atPace = Math.floor(Math.min(atPaceBandMi, danielsMi) * 2) / 2;
    // The doc's own proportion between the two segments, read off the same
    // Structure row the at-pace total comes from (12 km : 8 km) rather than
    // written here as 0.6. A doc that restates the split restates it once.
    const steps = entry.structures.find((st) => st.kind === 'sequence');
    const stepVals = steps?.kind === 'sequence' ? steps.steps.map((x) => x.value) : [];
    const firstShare = stepVals.length === 2 && stepVals[0] + stepVals[1] > 0
      ? stepVals[0] / (stepVals[0] + stepVals[1])
      : 0.6;
    const firstMi = Math.round(atPace * firstShare * 2) / 2;
    const secondMi = Math.round((atPace - firstMi) * 2) / 2;
    // "Short rest", kept short on purpose: long enough to be a real break in
    // the effort, short enough that the second block is run on tired legs.
    // A full recovery would make this two sessions in a row, which is the
    // elite double this variation exists to replace.
    const gapMi = 1;
    // Each block has to be a real block (§4.5's two-mile floor, same as the
    // progression's), and the work plus its gap must still fit inside the run
    // with easy running left over — a long run that is nothing but the block
    // is not the session §11.1 describes.
    return (
      firstMi >= FAST_FINISH_MIN_MI
      && secondMi >= FAST_FINISH_MIN_MI
      && firstMi + gapMi + secondMi < longMi
    ) ? { firstMi, gapMi, secondMi } : null;
  };

  let longVariant: ReturnType<typeof selectLongRunVariant> = null;
  let progressionSeg: { midMi: number; tailMi: number } | null = null;
  let modifiedBlockSeg: { firstMi: number; gapMi: number; secondMi: number } | null = null;
  if (rotatesLongVariant) {
    // One pass per candidate at most: every iteration either settles on a
    // variant or adds one to the exclusion set, so the loop cannot spin.
    for (let attempt = 0; attempt < LONG_VARIANT_MAX_ATTEMPTS; attempt++) {
      const picked = selectLongRunVariant({
        history: catalogueHistory!,
        enginePhase: phase,
        distance: cat,
        tier: longTier!,
        weekIdx,
        weeklyMi,
        dayOffset: longRunDow,
        // The rotation only runs in QUALITY / RACE-SPECIFIC (the gate above),
        // so the taper window reduces to the race week itself.
        inTaperWindow: isRaceWeek,
        tPaceSec: weekTPaceSec,
        iPaceSec: weekIPaceSec,
        mpPaceSec: weekMpPaceSec,
        // SLOT-ROTATE-5 · the same QUALITY split the quality slots take.
        inHillBlock: phase === 'QUALITY' ? weeksToPhaseEnd > 2 : null,
        exclude: longVariantExclude.size ? new Set(longVariantExclude) : undefined,
      });
      if (!picked) break;
      if (picked.entry.slug === 'progression-long-run') {
        const seg = progressionSegFor();
        if (!seg) {
          recordLongAttempt('progression-long-run');
          longVariantExclude.add('progression-long-run');
          continue;
        }
        progressionSeg = seg;
      } else if (picked.entry.slug === 'canova-modified-block') {
        const seg = modifiedBlockSegFor(picked.entry);
        if (!seg) {
          // Refused for this week, recorded so the rotation does not keep
          // offering a session the week cannot fund — same contract the
          // progression long's refusal uses.
          recordLongAttempt('canova-modified-block');
          longVariantExclude.add('canova-modified-block');
          continue;
        }
        modifiedBlockSeg = seg;
      }
      // Everything else — §4.5's fast finish, Research/11's simulation — takes
      // the default segment sizing and has nothing the week can refuse.
      longVariant = picked;
      break;
    }
  }
  // The rotation's memory: what this week's intensity long actually IS. Only
  // the rotated weeks record, so the marathon's §4.4 weeks and the 10K's fixed
  // tail leave the quality-slot history exactly as they left it before.
  //
  // ROTATION-REFUSE-1 · the CHOSEN entry's own slug, which is what the loop
  // above settled on after any refusals. It used to be re-derived from which
  // segment field ended up set, and that derivation could not name a variant
  // carrying no segment of its own — Research/11's simulation recorded as
  // `fast-finish-long-run`, so a block that ran the simulation looked to the
  // next week's tie-break as though it had run the fast finish.
  if (rotatesLongVariant && catalogueHistory) {
    recordCatalogueChoice(
      catalogueHistory,
      longVariant?.entry.slug ?? 'fast-finish-long-run',
      weekIdx,
    );
  }
  // DOWNHILL-2 · the simulation's SHAPE is an ordinary marathon-pace long —
  // Research/11 asks for "1 long downhill simulation (race pace)", not a
  // different pace structure — so it takes the default segment sizing and
  // differs only in what the runner is told to run it ON. Recorded as its own
  // kind so the note can carry the terrain instruction and so the day is
  // identifiable in the plan afterwards.
  const isDownhillSim = longVariant?.entry.slug === 'downhill-simulation-long-run';
  const longRunKindAuthored: LongRunKind | null =
    !hasFinish ? null
      : modifiedBlockSeg ? 'modified_block'
      : isDownhillSim ? 'downhill_simulation'
      : progressionSeg ? 'progression'
      : finishSeg!.kind;
  // MPLABEL-1 · "at marathon pace" reads as the goal's marathon pace, and on a
  // refused goal it is not. An HM finish rides `tPaceSec` and never had this
  // ambiguity, so only the M arm is qualified.
  const mPaceWord = taperMpAtGoalPace ? 'marathon pace' : 'marathon effort for your current fitness';
  slots[longRunDow] = {
    dow: longRunDow, type: 'long', distanceMi: longMi, isQuality: false, isLong: true,
    ...(hasFinish ? { longRunKind: longRunKindAuthored! } : {}),
    subLabel: !hasFinish ? 'LONG'
      // SEGLONG-2 · the `@ E` token is the gap. `extractLongSegments` folds it
      // into the block before it as that block's recovery, so the two blocks
      // stay two blocks and the easy miles stay easy miles in every consumer
      // that sums quality.
      : modifiedBlockSeg
      ? `LONG · ${modifiedBlockSeg.firstMi}mi @ M + ${modifiedBlockSeg.gapMi}mi @ E + ${modifiedBlockSeg.secondMi}mi @ M`
      : progressionSeg ? `LONG · ${progressionSeg.midMi}mi @ M + ${progressionSeg.tailMi}mi @ T`
      : `LONG · ${finishMi}mi @ ${finishSeg!.tag}`,
    notes: !hasFinish
      ? (phase === 'TAPER' ? 'Easy long, hold pace. Quality lives in the race itself.'
        : 'Conversational throughout. Build the engine.')
      : modifiedBlockSeg
      // Says what the session IS for, because the shape is the point and a
      // runner who treats the gap as a rest stop has run a different workout.
      ? `Modified block. Easy ${Math.round((longMi - modifiedBlockSeg.firstMi - modifiedBlockSeg.gapMi - modifiedBlockSeg.secondMi) * 10) / 10}mi, then ${modifiedBlockSeg.firstMi}mi at ${mPaceWord}, ${modifiedBlockSeg.gapMi}mi easy, then ${modifiedBlockSeg.secondMi}mi at ${mPaceWord}. The second block is the session: you are practising getting back to race pace on tired legs, so keep the easy mile honest and short.`
      : progressionSeg
      ? `Progression long. Easy ${Math.round((longMi - finishMi) * 10) / 10}mi, then ${progressionSeg.midMi}mi at ${mPaceWord}, close with ${progressionSeg.tailMi}mi at threshold. Continuous, no stop between segments.`
      : isDownhillSim
      // The instruction IS the session. Run on the flat and this is just
      // another MP long — the eccentric loading, which is the whole point, only
      // happens on the descent.
      ? `Downhill simulation. Steady ${longMi - finishMi}mi, then ${finishMi}mi at ${mPaceWord}, on terrain that descends like your race. Find the closest gradient you can and run the race-pace section on it. Quads will feel this more than the pace suggests; that is the session working, and it is what stops the same damage arriving at mile 20 on race day.`
      : `Steady ${longMi - finishMi}mi, then ${finishMi}mi at ${
          finishSeg!.tag === 'HM' ? 'half-marathon pace' : mPaceWord}.`,
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
    //
    // VARIETY-R3-1 (2026-08-28) · the 5K/10K third quality day — the R day.
    // See R3_MIN_TRAINING_DAYS for the whole doctrine case. The gate, term by
    // term:
    //   · 5k/10k only (Research/22's HM/M rows are 2 quality + long);
    //   · `tierTarget.qualityPerWeek >= 3` — the tier count read from
    //     Research/22's advanced/elite sample weeks;
    //   · the runner's preferences seat three quality days this week
    //     (`qualityDows` is already density-sliced by the ramp);
    //   · the week runs ≥ R3_MIN_TRAINING_DAYS days — both Research/22 rows
    //     state "| Days/week | 6-7 |". An unstated frequency falls back to the
    //     tier's own daysPerWeek, the same assumption the volume bands make;
    //   · never on a cutback (Research/00b §"What to Cut First": the extra
    //     quality session is the first thing a deload removes) and never on
    //     race week.
    // The entry is the composer-internal `speed` pseudo-type; it becomes an
    // `intervals`-typed DayPlan at write-time (see `ComposerQualityType`).
    const thirdSpeedDay = (cat === '5k' || cat === '10k')
      && !baseBuilding
      && tierTarget.qualityPerWeek >= 3
      && qualityDows.length >= 3
      && (trainingDaysPerWeek ?? tierTarget.daysPerWeek) >= R3_MIN_TRAINING_DAYS
      && !isCutback
      && !isRaceWeek;
    const withSpeedDay = (mix: Array<ComposerQualityType>): Array<ComposerQualityType> =>
      thirdSpeedDay ? [...mix, 'speed'] : mix;
    const qualityTypesFor = (wi: number): Array<ComposerQualityType> => baseBuilding
      // Base-building (beginner): a LIGHT surge fartlek in the sharpen phase
      // (the `tempo` slot) — BASE weeks are pure easy + strides + long, no
      // structured I/R reps — Research/22 §Beginner (Higdon Novice / Mayo).
      // Sized small below (the 3mi tempo floor is lifted for base-building).
      //
      // VARIETY-BEGIN-1 (2026-08-28) · the SECOND day is §8.2's light hills,
      // on the `intervals` type — DOCTRINE-BASE-2's own convention for a
      // rep-shaped speed day ("the engine's existing rep-shaped day... nothing
      // here needs a new day type"). Two entries also close the two-identical-
      // days defect at the type level: the fill's `types[i % length]` now
      // alternates instead of cloning, and DOCTRINE-DOSING-2's one-session-
      // per-pace-family rule holds (the fartlek doses T, the hills day doses
      // its own family) instead of running two T days. A one-quality-day week
      // (3-day runners) takes the list's head — the surge fartlek — exactly
      // as before.
      ? ( phase === 'TAPER' ? ['race_week_tuneup']
        : (phase === 'QUALITY' || phase === 'RACE-SPECIFIC') ? ['tempo', 'intervals']
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
          // VARIETY-R3-1 · `withSpeedDay` appends the R day where the gate
          // holds — Research/22 §"10K — Advanced"'s race-specific sample week
          // is exactly this mix plus "WU + 10×400 m @ R, 400 jog + CD".
          ? (cat === '5k'   ? withSpeedDay(['intervals', 'threshold'])
           : cat === '10k'  ? withSpeedDay(['intervals', 'threshold'])   // RACE-SPEC-10K-1 (2026-06-23): 10K race-specific dominates with I-pace reps (Research/00a §"Workout dose by race distance" "3–4×2km at 10K pace"), mirrors 5K
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
          // VARIETY-LONG-1 · on the week the rotation authors §4.3's
          // progression long, the T-family slot comes out and the rep slot
          // stays — but NOT here. The mix below stays the phase's own so the
          // DOW placement (QUAL-PHASE-STABLE) is computed from the full
          // profile; the progression week's slot list is filtered AFTER
          // scheduling, where the surviving day keeps the weekday the phase
          // always gives it. See the `scheduledQ` filter below.
          // Each row: one I-family slot, one T-family slot, and the T slot
          // alternates cruise intervals ↔ continuous tempo by week parity —
          // §5.2's "alternating with cruise intervals", read literally.
          // VARIETY-R3-1 · the 5K/10K R day rides here too — Research/22
          // §"5K — Advanced"'s Phase III sample week is a QUALITY-phase week
          // and runs all three ("6×1000 m @ I" / "4×1 mi @ T" / "8×400 m @ R").
          ? (cat === '5k'   ? withSpeedDay(wi % 2 === 0 ? ['intervals', 'threshold'] : ['intervals', 'tempo'])
           : cat === '10k'  ? withSpeedDay(wi % 2 === 0 ? ['intervals', 'threshold'] : ['intervals', 'tempo'])
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
    // Prescription strings are resolved up-front from the in-code workout
    // library (Research/04 + 22) via resolvePrescriptions() — falls back to
    // the historical inline catalog if the library has no matching row.
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
    // BASE-BUILDING IS EXEMPT, and the exemption's history matters. Its mix
    // used to be `['tempo']` on two quality days — two IDENTICAL light
    // fartleks — which this pass would rather have collapsed to one, but
    // collapsing the second into an easy day moves enough mileage on a
    // true-beginner ramp to breach the validator's own 50% week-over-week
    // volume limit (16 archetypes, `5k/beginner/f6/m0/L0-3` among them), so
    // the day count was pinned to the runner's quality days and the
    // two-identical-days defect was recorded as open.
    // VARIETY-BEGIN-1 (2026-08-28) · that defect is closed at the TYPE level:
    // the beginner mix is now `['tempo', 'intervals']` — surge fartlek +
    // §8.2's light hills — so the two expressions this arm chooses between
    // agree (two types, two days) and the exemption stands only as the
    // recorded guard against a future one-type mix reopening the ramp trap.
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
    const placementProfile: Array<ComposerQualityType> = phase === 'QUALITY'
      ? (() => { const a = qualityTypesFor(0), b = qualityTypesFor(1);
          return a.includes('intervals') ? a : b.includes('intervals') ? b : qualityTypes; })()
      : qualityTypes;
    const scheduledQRaw = scheduleQuality(effectiveQDows, qualityTypes, longRunDow, restDow, availableDows, placementProfile);
    /* ── VARIETY-LONG-1 · the QUALITY progression week runs ONE structured day ──
     *
     * On the week the rotation authors §4.3's progression long, the T-family
     * slot comes out and the rep slot stays. Two grounds, both doctrine's:
     * §4.3's own contraindication row — "don't pair with other quality work
     * in same week" — and the dosing arithmetic, because the progression's T
     * tail spends the same Daniels 10% the cruise/tempo slot is budgeted
     * against: the identical collision DOCTRINE-HMLONG-DOSE-1 resolves the
     * identical way for the half's fast-finish cadence weeks. The long IS the
     * week's threshold work.
     *
     * Filtered AFTER scheduling, deliberately. The schedule is computed from
     * the phase's full profile, so the surviving rep day sits on the weekday
     * the phase always gives it — dropping the slot BEFORE placement let the
     * one-day search choose a different weekday and broke QUAL-PHASE-STABLE's
     * training-days promise on 20 swept archetypes. The freed day becomes an
     * easy day through the ordinary fill, exactly as an MP-long week's does.
     */
    const scheduledQ = (progressionSeg != null && phase === 'QUALITY' && scheduledQRaw.dows.length > 1)
      ? (() => {
          const li = scheduledQRaw.types.lastIndexOf('intervals');
          const i = li >= 0 ? li : 0;
          return {
            dows: [scheduledQRaw.dows[i]],
            types: [scheduledQRaw.types[i]],
          };
        })()
      : scheduledQRaw;
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
        // VARIETY-LONG-1 · a rotated progression long names itself, so §16's
        // predicates see the session that was actually authored (its zones end
        // at T, which the threshold-spacing rules care about). Every other
        // week keeps the tag-derived mapping it always had.
        slug: progressionSeg != null ? 'progression-long-run'
          : finishSeg?.tag === 'MP' ? 'marathon-pace-long-run'
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
      return (qt: ComposerQualityType | 'strides'): number => {
        const p = slotDosePace(qt, Boolean(taperMp) && qt === 'tempo');
        return p ? (byPace.get(p) ?? Infinity) : Infinity;
      };
    })();

    /* ── ONE-PER-FAMILY-1 (2026-08-25) · THE INVARIANT THE COMMENT PROMISED ───
     *
     * DOCTRINE-DOSING-2's header states the rule — "ONE SESSION PER PACE
     * FAMILY, PER WEEK" — and ends "`assertOnePerPaceFamily` below holds the
     * invariant". There is no such function in the repo. What was actually
     * built holds it over the SLOT TYPES (`duplicatePaceFamily`), and a slot
     * type is not what a session spends: `slotDosePace('threshold')` is `T`,
     * but §12.3's 1K cutdowns ramp `MP → 5K` and `capFamilyOf` charges the
     * whole session to `interval`. Both halves were individually right and the
     * join was missing.
     *
     * The cost, measured on the owner's own marathon build: a QUALITY week
     * authored an 8×1K cutdown on the threshold slot and a 6×1200m rep set on
     * the intervals slot — 9.4 mi charged to I on a 56.5 mi week whose whole I
     * allowance is 4.5. `applyDosingCaps` then shaved reps off both until the
     * arithmetic closed, and what the runner read was "1×1km · MP → 5K" and
     * "2×1200m @ I pace". §12.3's own row is "5–8 × 1K" and §6.1's is "4–6 ×
     * 1200": neither session was still the workout its label named, and the
     * week's I dose came out at 2.6% against a doctrine band of 10-15%.
     *
     * So the ledger below is the week's actual budget in each of Daniels'
     * three capped families, and each slot is offered only what its OWN family
     * has left — with the families other slots in the week are budgeted for
     * held back. The refusal then happens where a refusal belongs, at
     * selection, and the selector ranks the next session §15 places on the
     * slot rather than authoring one and shaving it into a shape doctrine does
     * not describe. `applyDosingCaps` stays exactly as it is: it is the
     * backstop for what the composer could not foresee, and it stops being the
     * primary mechanism.
     */
    const capLedger = (() => {
      const FAMILY_OF_PACE: Partial<Record<DosePace, CapFamily>> = {
        T: 'threshold', I: 'interval', R: 'repetition',
      };
      const FAMILIES: CapFamily[] = ['threshold', 'interval', 'repetition'];
      const budget: Record<CapFamily, number> = {
        threshold: weeklyDoseBudgetMi(weeklyMi, 'T', weekDoseContext),
        interval: weeklyDoseBudgetMi(weeklyMi, 'I', weekDoseContext),
        repetition: weeklyDoseBudgetMi(weeklyMi, 'R', weekDoseContext),
      };
      const spent: Record<CapFamily, number> = { threshold: 0, interval: 0, repetition: 0 };
      /** The cap family a slot is BUDGETED against, from its day type. */
      const nominalOf = (qt: ComposerQualityType): CapFamily | null => {
        const p = slotDosePace(qt, Boolean(taperMp) && qt === 'tempo');
        return p ? FAMILY_OF_PACE[p] ?? null : null;
      };
      /** Slots still to be resolved, in order, by their nominal family. */
      const pending = plannedSlots.map((s) => (s ? nominalOf(s.qt) : null));
      /**
       * ONE-PER-FAMILY-2 · the SAME ceilings `sizeFromPrescription` will apply.
       *
       * `sizeFromPrescription` cuts a rep set against three bounds — the
       * session cap, `slotBudgetMi`, and `mpLongAtPaceCapMi` — and the selector
       * priced against only the first. So on a marathon-pace long week the
       * selector offered §11.2's Canova 2K repeats at their doctrine floor of
       * four, the cut then took them to two, and the runner read "2×2km · MP →
       * T | Canova 2K repeats · Research/04 §11.2" against a row that says
       * "4–8 × 2 km". The 75%-easy floor leaving 2.9 at-pace miles beside a
       * ten-mile MP finish is CORRECT; offering a session that cannot fit in
       * 2.9 miles and then shaving it until it does is not. Priced here, the
       * selector refuses it and ranks the next session §15 places on the slot,
       * and if nothing fits the slot falls back to the trajectory's generic
       * shape — which claims no doc row and is the honest answer.
       */
      const slotCeilingMi = (qt: ComposerQualityType): number => Math.min(
        slotBudgetMi(qt),
        mpLongAtPaceCapMi ?? Infinity,
      );
      return {
        /** What slot `i` may spend in each family, given the rest of the week. */
        remainingFor(i: number, qt: ComposerQualityType): Partial<Record<CapFamily, number>> {
          const mine = pending[i];
          const claimedByOthers = new Set<CapFamily>();
          for (let j = 0; j < pending.length; j++) {
            if (j === i) continue;
            const f = pending[j];
            if (f) claimedByOthers.add(f);
          }
          const ceiling = slotCeilingMi(qt);
          const out: Partial<Record<CapFamily, number>> = {};
          for (const f of FAMILIES) {
            out[f] = f !== mine && claimedByOthers.has(f)
              ? 0
              : Math.max(0, Math.min(budget[f] - spent[f], ceiling));
          }
          return out;
        },
        /** Record what slot `i` actually committed, and retire its claim. */
        commit(i: number, family: CapFamily | null, atPaceMi: number): void {
          pending[i] = null;
          if (family && Number.isFinite(atPaceMi) && atPaceMi > 0) spent[family] += atPaceMi;
        },
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
    const trackOfType = (qt: ComposerQualityType): SessionFamily | null => {
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
    const trackFor = (s: { qt: ComposerQualityType; vocabRx: string | undefined }): SessionFamily | null => {
      if (s.vocabRx) return null;
      return trackOfType(s.qt);
    };
    /**
     * PROGRESSION-DOSE-1 (2026-08-30) · which track a slot SPENDS against.
     *
     * `trackOfType` is the LABEL-side reading and deliberately says nothing
     * about `tempo`. This says what `Research/01` says. Its own table gives
     * "Tempo (continuous)" and "Cruise intervals" the SAME Daniels zone (T),
     * the same pace anchor, the same RPE 7-8 and the same 88-92% HRmax; the
     * concept map one section above lists them as "T" and "T (broken)". A tempo
     * IS the threshold ladder, continuous rather than chopped up.
     *
     * The engine already agreed with that on the sizing path —
     * `targetMinutesFor` below does `qt === 'tempo' ? 'threshold' : qt` — and
     * disagreed with itself here, which is a Rule 16 split: one quantity, two
     * answers. The consequence was silent. On a week whose only T-side slot was
     * a tempo, `stepByTrack` got no 'threshold' entry at all, so
     * `targetMinutesFor` returned null and the ladder's at-pace ceiling was not
     * applied to the session it was computed for.
     *
     * `trackFor` is deliberately NOT routed through this. It still asks
     * `trackOfType`, so a generic tempo keeps its own `rx.tempo` sizing and the
     * trajectory does not start supplying words it never supplied before. The
     * rendered prescription is byte-identical; only the map gains an entry.
     */
    const doseTrackOfType = (qt: ComposerQualityType): SessionFamily | null =>
      trackOfType(qt === 'tempo' ? 'threshold' : qt);
    const stepByTrack = new Map<SessionFamily, ReturnType<OverloadTrajectory['step']>>();
    if (trajectory) {
      for (const s of plannedSlots) {
        if (!s) continue;
        // NOT `doseTrackOfType` here, deliberately. Keying the MAP by the dose
        // track would add a `threshold` entry on a tempo-only week, and
        // `targetMinutesFor` reads this same map — so the ladder's at-pace
        // ceiling would begin binding on weeks where it never has. That is
        // arguably the behaviour DOCTRINE-DOSING-2 intended, but it changes the
        // composed plan, and `_audit_periodization.test.ts`'s frozen
        // David-class fingerprint caught it doing so. The dose READ below is
        // additive and byte-stable; changing what the map holds is a separate
        // decision with its own evidence, and it is not this change.
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
    const targetMinutesFor = (qt: ComposerQualityType): number | null => {
      const track = doseTrackOfType(qt);
      if (track == null) return null;
      const step = stepByTrack.get(track);
      if (!step) return null;
      const mins = totalWorkMinutes(step.shape);
      return mins > 0 ? mins : null;
    };

    const resolvedSlots = plannedSlots.map((planned, slotIdx) => {
      if (!planned) return null; // conflict · skip
      const { dow, qt } = planned;
      // VARIETY-R3-1 · the R day's family is stated here, not asked of
      // `qualityFamilyFor`. That function is the §15 oracle and §15's
      // QUALITY/race-specific rows do not name R work — the R day's placement
      // authority is Research/04 §7.4's own cycle row ("When in cycle | Base,
      // late specific, taper week") plus Research/22's advanced sample weeks,
      // which is what the `VARIETY.r3-third-quality-day` registry claim reads.
      // Keeping the §15 oracle out of it keeps VOCAB.phase-placement honest.
      const candidateFamily = (baseBuilding || (taperMp && qt === 'tempo'))
        ? null
        : qt === 'speed'
        ? 'speed'
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
      // VARIETY-R3-1 · the mid-block R day is fed by the same SPEED slot the
      // base week uses — the pseudo-type resolves to it directly. The selector
      // scopes what that slot may answer with mid-block (R-pace rep entries;
      // see `select.ts`), and the day is written as `intervals` at the end.
      const slot: ComposerSlot | null =
        qt === 'speed'
          ? 'speed'
          : phase === 'BASE'
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
            // ONE-PER-FAMILY-1 · what this week has left in each of Daniels'
            // three capped families, with the families the week's OTHER slots
            // are budgeted for held back. See `capLedger` above.
            capFamilyRemainingMi: capLedger.remainingFor(slotIdx, qt),
            // DOWNHILL-3 · Research/11's eccentric-loading protocol is training
            // FOR a descent, so a flat-course runner is never offered it. The
            // long-run simulation was gated on this from the start; the REPEATS
            // were not, and being family `hills` they sit on the intervals slot
            // for every marathon and half runner. Measured: on `main` §12.2's
            // mile cutdown landed in all nine half archetypes swept; with the
            // repeats in the pool it landed in none, because a session the
            // runner had no use for was winning the rotation ahead of it.
            exclude: courseIsNetDownhill ? undefined : DOWNHILL_ONLY_SLUGS,
            // THESIS-PLAN-1 · what the Coaching Thesis asks of this slot. Null
            // on every caller that has no thesis; see `ThesisSlotContext`.
            thesis: thesisSlot,
          })
        : null;
      if (choice?.ok) {
        const text = slot === 'tempo' ? choice.phrase : choice.prescription;
        if (text) {
          usedSlugs.add(choice.entry.slug);
          usedFamilies.add(choice.family);
          placedThisWeek.push({ slug: choice.entry.slug, dayOffset: dow });
          recordCatalogueChoice(catalogueHistory!, choice.entry.slug, weekIdx);
          capLedger.commit(slotIdx, capFamilyOf(choice.entry), choice.dose.atPaceMi);
          return {
            dow, qt,
            vocabFamily: choice.family,
            vocabRx: text,
            catalogueNote: choice.note,
            catalogueAtPaceMi: choice.dose.atPaceMi,
            // RATIONALE-PERSIST-1 · the selector's real "why this one" line,
            // carried past this boundary instead of discarded here.
            catalogueRationale: choice.rationale,
          };
        }
      }
      // ONE-PER-FAMILY-1 · the catalogue declined, so this slot falls back to
      // the overload trajectory's generic shape — which runs at the slot's own
      // nominal pace and spends that family's budget through `slotBudgetMi`.
      // Its claim is therefore deliberately NOT retired: a later slot must
      // still be unable to reach into the family this one is about to spend.
      const vocabFamily = (candidateFamily && !usedFamilies.has(candidateFamily)) ? candidateFamily : null;
      const vocabRx = vocabFamily ? rx.families[vocabFamily] : undefined;
      if (vocabFamily && vocabRx) usedFamilies.add(vocabFamily);
      return {
        dow, qt, vocabFamily, vocabRx, catalogueNote: null, catalogueAtPaceMi: null,
        catalogueRationale: null,
      };
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
      // PROGRESSION-DOSE-1 · the DOSE half, read off `trackOfType` rather than
      // `trackFor`, so a catalogue-filled slot still records which rung its
      // track is on. `stepByTrack` is itself built from `trackOfType`, so this
      // is exactly the step that was already computed and then discarded on
      // every rotated week. See the `progressionDose` field doc.
      const doseTrack = doseTrackOfType(qt);
      const doseStep = doseTrack != null ? (stepByTrack.get(doseTrack) ?? null) : null;
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
      // VARIETY-R3-1 · the mid-block R day is REPETITION work wherever it
      // lands — same three consequences as the base-week session above:
      // §7.4's session band, §17.1's one-mile jog legs, and Daniels' 5% R cap.
      const qFamily: QualityFamily = (phase === 'BASE' || qt === 'speed')
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
      // VARIETY-R3-1 · the R day, like BASE, never reaches for a generic
      // fallback: `rx.intervals` is an I-pace rep set, which is the wrong
      // budget and the wrong session. Catalogue prescription or nothing.
      const rxSized = (doctrinalDaySizing && !taperMp && step == null && tempoSized == null
        && (qt === 'intervals' || qt === 'threshold' || qt === 'speed'))
        ? sizeFromPrescription(
            (phase === 'BASE' || qt === 'speed')
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
      // VARIETY-R3-1 · the same refusal governs the mid-block R day: when the
      // selector declines (no R anchor, Daniels' 5% too small for the shortest
      // R set, §16 spacing) the day goes back to the easy fill — a week that
      // cannot afford its R day simply keeps the two-session shape.
      if ((phase === 'BASE' || qt === 'speed') && (!vocabRx || rxSized == null)) return;
      // VARIETY-BEGIN-1-FIX (2026-08-30) · the same refusal, for the beginner's
      // surge fartlek. `taperMp` is gated `!baseBuilding` (line ~3730), so it
      // never overlaps this branch. `minBeginnerSurgeDayMi`'s own comment has
      // the arithmetic and names where this actually fires — a cutback week,
      // where RP-FREQ-FLOOR's 2mi quality-day floor deliberately does not
      // apply and `qualityMiEach` can round to 1mi, too small for even the
      // doctrine floor dose's warm-up and cool-down, let alone a rep. Below
      // that floor the day goes back to the easy fill below instead of
      // authoring a warm-up and cool-down around one clipped rep wearing a
      // surge label — exactly the "1×1 min surges on a 1mi day" gap
      // VARIETY-BEGIN-1's own test names.
      if (baseBuilding && qt === 'tempo' && qualityMiEach + 1e-9 < MIN_BEGINNER_SURGE_DAY_MI) return;
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
        // VARIETY-R3-1 · unreachable fallback (the guard above dropped any
        // speed slot without a catalogue prescription); stated so the arm list
        // stays total over ComposerQualityType.
      : qt === 'speed'            ? (rxSized?.prescription ?? 'QUALITY')
        // PROGRESSION-1 · the trajectory's rendered shape when it owns this
        // slot, the fixed catalog string when it does not (unparseable seed,
        // no pace anchor, or a composer that passes no trajectory at all).
      // VARIETY-BEGIN-1 · the beginner's second structured day: §8.2's light
      // hills ("start 8, build to 16" · 10-30 s · walk-down recovery), typed
      // `intervals` per DOCTRINE-BASE-2's rep-shaped-day convention. The word
      // "hill" routes `buildWorkoutSpec` to the by-effort rep spec (§8.1
      // prescribes hills by effort — a pace is unreachable on a grade).
      : qt === 'intervals'        ? (baseBuilding
                                      ? `${Math.max(1.5, Math.round(qualityMiEach * 10) / 10)}mi E w/ ${beginnerHillReps(phase)}×${BEGINNER_HILL_SURGE_S}s light hill surges · walk-down rec`
                                      : (step?.label ?? rxSized?.prescription ?? rx.intervals))
      : qt === 'threshold'        ? (step?.label ?? rxSized?.prescription ?? rx.threshold)
      : qt === 'tempo'            ? (baseBuilding
                                      // VARIETY-BEGIN-1 · beginner structured days: a light surge
                                      // fartlek whose dose WALKS (4×1 → 6×1 → 6×2 · Research/00b
                                      // §"Marathon Recovery" wk3 "4-6× 1 min", Research/22
                                      // §"5K — Beginner" "4×1 min @ T", §"10K — Beginner" peak
                                      // "6×2 min fartlek") on the first day, and §8.2's light
                                      // hills ("start 8, build to 16" · by effort, walk-down
                                      // recovery) on the second. Sized to the runner (no 3mi
                                      // tempo floor); both labels carry the rep geometry, so
                                      // `parseTimeReps` builds the spec the label promises. The
                                      // "· 1 min jog" is the 10K row's own "1 min on / 1 min off".
                                      ? (({ reps, minutes }) =>
                                          `${Math.max(1.5, Math.round(qualityMiEach * 10) / 10)}mi E w/ ${reps}×${minutes} min surges @ T effort · 1 min jog`
                                        )(beginnerSurgeDose(phase, weeksToPhaseEnd, weeklyMi))
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
      // 2026-06-02 · the workout library uses family='threshold' for
      // BOTH rep-based cruise intervals AND continuous tempos (both
      // are T-pace work in Daniels' taxonomy). When the picked library
      // row's prescription describes a continuous tempo
      // ("N mi WU · M mi @ T · N mi CD"), the row's TYPE should be
      // 'tempo' so spec-builder produces a tempo spec (not a rep spec).
      // Without this remap, the runner sees a sub_label promising
      // continuous tempo over a workout_spec that's actually 4×1mi reps.
      // VARIETY-R3-1 · the R day is WRITTEN as `intervals` — DOCTRINE-BASE-2's
      // rep-shaped-day convention. The pseudo-type dies here; the row, the
      // spec builder, persistence and the watch see the day type they already
      // understand, and the "@ R" token in the prescription is what paces it.
      let effectiveType: DayPlan['type'] = qt === 'speed' ? 'intervals' : qt;
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
        // VARIETY-R3-1 · the mid-block R day sizes exactly like the base-week
        // speed session, for the same reason: §7's day is its own shape and
        // flooring it at the runner's tempo-day length would wrap easy miles
        // around two-and-a-half at-pace ones and call it quality.
        : (phase === 'BASE' || qt === 'speed') && doctrinalDayMi != null
          ? Math.min(Math.round(doctrinalDayMi * 2) / 2, doctrinalDayCeiling)
        // BOUNDARY-OWNER-1 (2026-09-02) · THE RECENT-QUALITY-DISTANCE FLOOR NO
        // LONGER INFLATES A DOCTRINALLY-COMPOSED DAY.
        //
        // `qualityFloor` is mid-block Rule 2 — "don't author a shorter version
        // of the workout this runner is already doing" — read as a floor on the
        // DAY'S TOTAL MILEAGE. On a doctrinally-sized day that is a Rule 7
        // shape: a number spent on a quantity it was not written about. Rule 2
        // is a claim about the WORK; the day around the work is composed by
        // `quality-day.ts`, which is this app's one owner of "how many miles is
        // this quality day" (Constitution §5, one question one resolver).
        //
        // Measured on the owner's live CIM block, 2026-09-02, week of
        // 2026-09-07 (`_probe_cim_sessions`, reproduced against production):
        //
        //     composeQualityDay('threshold', atPace 2.0)  →  4.3 mi
        //     qualityFloor (recentQualityDistanceMi 7.2 − 1)  →  6.2 mi
        //     slotMi = max(4.3, 6.2, 2)                   →  6.2 mi
        //     spec-builder splits the 4.2 mi remainder    →  2.1 WU · 2 T · 2.1 CD
        //
        // 4.2 miles of warm-up and cool-down around 2 miles of threshold work.
        // The runner reads a tempo session whose easy legs are twice its
        // workout, and nothing chose that — it is the residual of an
        // arithmetic floor. DAY-SIZE-1's own header states the principle this
        // violated: the quality day is "composed, not shared out of the week's
        // volume", and `layoutWeek` already sends what is left to the easy days
        // via `remainingMi = weeklyMi - allocated`. So the surplus has a
        // correct destination and does not need a home inside the session.
        //
        // `qualityFloorFreq` STAYS. It is the 2 mi run-coherence floor
        // (RP-FREQ-FLOOR), a statement about what counts as a run at all, and
        // `_maint_invariants`' MIN_RUN_DIST holds it at zero findings.
        //
        // `qualityFloor` is untouched on the share-based path below
        // (`qualityMiEach`), which is where a day that doctrine did NOT size
        // still needs a floor. Only the composed day is protected.
        : doctrinalDayMi != null
          ? Math.min(
              Math.max(Math.round(doctrinalDayMi * 2) / 2, qualityFloorFreq),
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
      if ((phase === 'BASE' || qt === 'speed') && slotMi + 1e-9 < Math.round((doctrinalDayMi ?? 0) * 2) / 2) return;
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
        // PROGRESSION-DOSE-1 · the ladder position, recorded whether or not the
        // trajectory supplied the words. On a slot the catalogue filled, `step`
        // is null and this is the only thing that reaches storage; on a generic
        // slot the two describe the same rung and the gate reads either.
        ...(doseStep ? {
          progressionDose: {
            shape: doseStep.shape,
            lever: doseStep.lever,
            zone: doseStep.zone,
          },
        } : {}),
        // RATIONALE-PERSIST-1 · the catalogue's own selection reason, carried
        // the same way `progressionDose` is: present only when the slot has
        // one, absent (not null-valued) so a generic slot's shape is
        // unchanged.
        ...(slot.catalogueRationale ? { catalogueRationale: slot.catalogueRationale } : {}),
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
        // MPLABEL-1 (2026-08-25) · SAY WHICH MARATHON PACE THIS IS.
        //
        // This note was unconditionally "Race pace, not faster. This is a
        // rehearsal, not a test." — and on the owner's CIM block it sat over a
        // pace 62 s/mi slower than the race it named, on the two longest
        // sessions of the taper (8.5 mi and 7 mi at "MP", three and two weeks
        // out). The number was right; `marathonPaceSPerMi` had correctly
        // refused a goal faster than the runner's own threshold, and
        // `Research/01` §"Marathon-specific correction" only ever moves an MP
        // prescription downward. The sentence was the defect, and the sentence
        // is the part the runner reads on the morning of the session.
        //
        // `Research/04` §"Pace zone shorthand" carries both codes in one table
        // — `M` = Goal MP, `MP` = Current MP — so there is a cited vocabulary
        // for the distinction and the engine was collapsing it. Same shape as
        // ZONE-LABEL-1's three sites, one zone over.
        //
        // Voice: no scolding, no hedging, no exclamation. It states which pace
        // it is and why that is the right pace to rehearse today.
        : (taperMp && effectiveType === 'tempo')
          ? (taperMpAtGoalPace
              ? 'Race pace, not faster. This is a rehearsal, not a test.'
              : 'Marathon effort at the fitness you have shown, not goal pace. Not faster. This is a rehearsal, not a test.')
        // VARIETY-BEGIN-1 · a beginner's structured days are a surge fartlek
        // and a light-hills day, never a continuous block or a paced rep set —
        // "continuous tempo block" over a surge session is the label/spec
        // drift in note form, and "hold pace, even splits" is exactly wrong on
        // a hill (§8.1 prescribes hills by effort). §8.2's own rows supply the
        // hills wording (walk back, controlled); §9.1's fartlek family is
        // play, not a test. Before the generic type notes, or they never fire.
        : (baseBuilding && effectiveType === 'tempo')
          ? 'Easy running with short surges at T effort. Relaxed pickups, full jog between. Not a test.'
        : (baseBuilding && effectiveType === 'intervals')
          ? 'Easy running with short uphill pickups. Strong but controlled, walk back down. Form over force.'
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
  const easyCountRaw = trainingDaysPerWeek != null
    ? Math.max(0, Math.min(easyCandidates.length, trainingDaysPerWeek - runningPlaced))
    : easyCandidates.length;
  // ── RULE12-COUNT-1 (2026-08-30) · FEWER HONEST DAYS, NOT MORE JUNK ONES ────
  //
  // Rule 12: "If quality will not fit once easy running is honest, the week is
  // over-prescribed — cut quality, not the aerobic base." When quality and the
  // long are already doctrine-sized and the remainder still will not give each
  // easy day `Research/00a` §2's forty minutes, the last honest lever is the
  // NUMBER of easy days. A stated frequency is a CEILING on how often the
  // runner is willing to run, never a quota the week must fill — so spending
  // the same miles over fewer, real runs is strictly better than spreading
  // them into four 29-minute jogs.
  //
  // OBSERVED: his week of 2026-09-14 — a cutback in the 10K's own post-race
  // window — held a 12-mile long, a 7-mile hill session and FOUR easy days
  // sharing 14 miles: 3, 5, 3, 3. Three miles is the number he called
  // "incredibly short", and `Research/00b` wants 2-3 zero/very-light days after
  // a 10K anyway, so the extra rest day this produces is the doctrine-correct
  // shape rather than a concession.
  //
  // NOT IN BASE OR TAPER. A taper cuts volume on purpose and short easy days
  // are what that looks like — `Research/00a` §1 prices easy/recovery at 20-75
  // min, and his taper 3.5s are ~32 min, a legitimate run. BASE steps down
  // deliberately too. Both keep every day they are given; this is explicit so
  // the next reader does not "fix" them.
  //
  // Volume-neutral by construction: `weeklyMi` is untouched, the same miles are
  // spread over fewer days, so no ramp ceiling can be breached by it. Inert
  // wherever no easy pace resolves, which is every caller that supplies none.
  // 2026-09-01 · Rule 12 · the floor is priced in MINUTES and then rounded UP
  // to the half-mile the day distribution quantises on. Checking the raw
  // mile figure against the MEAN let a week pass at 12.5 mi over three easies
  // (mean 4.17 ≥ 4.13) and then hand the runner two 4.0-mile days of 39 min
  // against a 40-min floor — the day the runner actually gets is the
  // quantised one, so the floor has to be stated in that unit.
  const genAerobicFloorMi = easyPaceSecPerMi && easyPaceSecPerMi > 0
    ? Math.ceil(((GENERAL_AEROBIC_MIN_MINUTES * 60) / easyPaceSecPerMi) * 2) / 2
    : 0;
  let easyCount = easyCountRaw;
  if (genAerobicFloorMi > 0 && phase !== 'BASE' && phase !== 'TAPER') {
    while (easyCount > 1 && remainingMi / easyCount < genAerobicFloorMi) easyCount--;
  }
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
  // ── RULE12-RESIDUAL-1 (2026-08-30) · Rule 9 · A ROUNDED QUOTIENT, TIMES N ──
  //
  // This was `Math.round(remainingMi / easyCount)` — one WHOLE-MILE number
  // handed to every easy day. Two consequences, and the second is a Rule 9
  // defect rather than a rounding nicety:
  //
  // 1 · Every other distance this engine authors is half-mile granular (the
  //     long run, the taper rescale, the medium-long, the recovery day right
  //     below). The easy day was the only whole-mile quantity in the week.
  //
  // 2 · IT MULTIPLIES ITS OWN ROUNDING ERROR BY THE NUMBER OF EASY DAYS. The
  //     week's realized volume is `long + quality + easyCount × perEasy`, so a
  //     quotient crossing x.5 moves the WEEK by a full `easyCount` miles. On
  //     the owner's own series, 2026-08-30: half a mile of long run (15 → 15.5,
  //     itself a rounding step in the spike anchor) took the quotient from 4.33
  //     to 4.17, the round dropped 5 → 4, and week one fell from 45.5 to 43 —
  //     **three miles of easy running lost to a half-mile of long run.** The
  //     continuity walk read it as the plan getting SMALLER as the runner
  //     trained MORE, which is Rule 9's stated signature, and it was.
  //
  // THE FIX IS THE REMAINDER, NOT A FINER ROUND. Rounding to halves alone would
  // still multiply by `easyCount`, just at half the size — Rule 9's "widening a
  // tolerance relocates the cliff". So the quotient FLOORS to the half mile and
  // the leftover is handed out half a mile at a time, one day each, until it is
  // spent. The easy pool is then the remainder itself to within half a mile,
  // whatever `easyCount` is, and the week tracks its budget instead of
  // quantising in `easyCount`-mile steps.
  //
  // The days end up unequal by half a mile, which is the direction Rule 12
  // already asks for ("four identical easy days is a template, not a plan") and
  // the same shape MLR-1 and RULE12-VARY-1 give the week below. Every bound
  // above still binds: no day is handed the extra half if it would reach the
  // long-run separation, and the floor is untouched.
  const perEasyRaw = easyCount > 0 ? Math.floor((remainingMi / easyCount) * 2) / 2 : 0;
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
  // RULE12-RESIDUAL-1 · the half miles the floor left on the table, handed out
  // one day at a time. Never past the long-run separation, never more than one
  // half per day, and it stops the moment the remainder is spent — so the pool
  // lands within half a mile of `remainingMi` instead of within `easyCount` of
  // it. Inert whenever `perEasy` is set by the floor or the separation rather
  // than by the budget (the leftover is then zero or negative by construction).
  const extraHalfDows = new Set<number>();
  {
    let left = Math.round((remainingMi - perEasy * easyDowSet.size) * 2) / 2;
    if (perEasy + 0.5 <= easySep + 1e-9) {
      for (const dow of [...easyDowSet].sort((a, b) => a - b)) {
        if (left < 0.5 - 1e-9) break;
        extraHalfDows.add(dow);
        left -= 0.5;
      }
    }
  }
  for (const { dow } of emptySlots) {
    slots[dow] = easyDowSet.has(dow)
      ? { dow, type: 'easy', distanceMi: perEasy + (extraHalfDows.has(dow) ? 0.5 : 0), isQuality: false, isLong: false, subLabel: 'EASY', notes: 'Conversational. Z2 HR cap.' }
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
  // DOCTRINE-STRIDES-2 (2026-08-28) · the rep count is the PHASE's, not a
  // constant. §7.2's "| Reps | 4–8 |" is a band, and the engine sat at 6
  // forever: band floor in BASE, mid-band through QUALITY, band top by
  // RACE-SPECIFIC, and back to the familiar mid-band 6 in the TAPER
  // (Research/08 §9.1 "Add no novel workout types" — eight reps for the first
  // time in race week would be the novelty that rule names). The progression
  // lives in `strideRepsForPhase` (spec-builder), bound by
  // `STRIDES.rep-progression` in the doctrine registry.
  const strideReps = strideRepsForPhase(phase);
  {
    let strideDays = 0;
    for (let d = 0; d < 7 && strideDays < STRIDE_DAYS_PER_WEEK; d++) {
      const s = slots[d];
      if (!s || s.type !== 'easy' || s.distanceMi <= 0) continue;
      s.subLabel = `EASY · ${strideReps}×${STRIDE_DURATION_S}s strides`;
      s.notes = `${s.notes} Finish with ${strideReps} relaxed ${STRIDE_DURATION_S}-second strides, full recovery between.`;
      strideDays++;
    }
  }

  // ── MLR-1 (2026-08-25) · THE MEDIUM-LONG RUN ────────────────────────────
  //
  // THE DEFECT. The block above this one has just given every easy day the same
  // number. `perEasy = remainingMi / easyCount`, one figure, applied to each
  // slot — so an advanced-marathon week at 61.5 miles came out as a 20-mile
  // long and three identical 8-mile easy days. Research/00a §"3. Medium-long
  // run" gives the session its own row among the seven workout categories
  // ("Purpose | Aerobic strength under fatigue without long-run cost",
  // "Frequency | 1×/wk in marathon and half cycles"), and Research/22's
  // marathon and half plans name it in Key workout types AND lay one out in
  // their sample peak weeks. The engine had none, at any volume, for any runner.
  //
  // WHY IT MATTERS MORE ONCE THE VOLUME IS RIGHT. WKPEAK-1/2 above raise what
  // the block builds to. Miles added to a week with no medium-long run inflate
  // three identical easy days into three slightly longer identical easy days —
  // a bigger week, not a different one, and none of the adaptation the doctrine
  // row is describing. The sample week doctrine actually publishes is not flat:
  // §"Marathon — Advanced" runs 6 · 11 · 15 · 9 · 5 · 8 · 22, where the
  // non-long, non-quality days range from a 5-mile recovery jog to a 15-mile
  // medium-long. That spread IS the prescription.
  //
  // VOLUME-NEUTRAL, DELIBERATELY. This pass moves miles between easy days and
  // changes no weekly total: it takes the MLR's extra distance from its
  // siblings. So every volume guard upstream and downstream — the ramp
  // ceilings, the week-over-week checks, the acute:chronic backstop, the
  // dosing shares — sees exactly the week it saw before. What changes is the
  // shape of the week, which is what was wrong.
  //
  // FOUR BOUNDS, AND THE REFUSAL. The run is the LEAST of:
  //   · the doctrine ceiling for this distance and tier, RAMPED with the volume
  //     curve — `weeklyMi × (mlrPeakMi / peakWeeklyMi)`, the same peak-relative
  //     shape DIST-1 gives the long run, so it arrives at the ceiling in the
  //     block's peak week rather than in week one;
  //   · `MLR_MAX_WEEK_SHARE` of this week, the floor of the share doctrine's
  //     own sample peak weeks spend on it — this is what stops a 45 mi/wk
  //     runner being handed a 76 mi/wk runner's session;
  //   · strictly below the long run, at the SAME 0.8× separation
  //     `finalizeComposedPlan` re-applies to every easy day, so the pass can
  //     never author a day that a later trim then cuts back (which would make
  //     it not volume-neutral after all);
  //   · what the other easy days can actually give up while each stays at the
  //     week's own `mathFloor` coherence minimum.
  // If that least is under `MLR_MIN_MI` — the floor of Research/00a §3's own
  // "8-14 mi typical" — the week does not get one. It is not a short MLR; it
  // is an easy week, authored exactly as it was before. That refusal is what
  // keeps every low-volume plan byte-identical, and it is why hm/intermediate
  // needs no special case: its own doctrine week's mid-week run is six miles.
  //
  // NOT IN THE TAPER. Research/08 §9.1: "The largest cut is to easy mileage."
  // Concentrating a taper week's reduced easy mileage into one big run is the
  // opposite of letting down into the race, and no sample taper week carries an
  // MLR. Cutback weeks inside the build DO keep it, shrunk by the share bound
  // along with the rest of the week — that is what a deload of a real week
  // looks like.
  //
  // TYPE STAYS `easy`. The spec builder branches on `type`, and an MLR is run
  // at easy-to-steady pace under an easy HR cap — which is what `case 'easy'`
  // already emits. Inventing a ninth day type would mean a wire change across
  // the watch, the phone and every validator to describe a run the existing
  // type already describes correctly. The sub_label carries the name, the same
  // way a long run with a marathon-pace finish is a `long` with a different
  // sub_label.
  //
  // Cite: Research/00a-distance-running-training.md §"3. Medium-long run"
  // Cite: Research/22-plan-templates.md §"Marathon — Advanced" (Key workout
  //       types · MLR (13-17 mi) · and the sample peak week's Wednesday)
  // Bound by PLAN.medium-long-run.
  if (tierTarget.mlrPeakMi != null && phase !== 'TAPER' && !isRaceWeek) {
    const easyDows: number[] = [];
    for (let d = 0; d < 7; d++) {
      const s = slots[d];
      if (s && s.type === 'easy' && s.distanceMi > 0) easyDows.push(d);
    }
    // One easy day cannot be promoted: there is nobody to take the miles from,
    // and moving them off the quality or long days is a different change.
    if (easyDows.length >= 2) {
      const easyPool = easyDows.reduce((sum, d) => sum + slots[d]!.distanceMi, 0);
      const rampedMi = peakWeeklyMi > 0 ? weeklyMi * (tierTarget.mlrPeakMi / peakWeeklyMi) : 0;
      const shareMi = weeklyMi * MLR_MAX_WEEK_SHARE;
      // The same expression finalizeComposedPlan re-applies to easy days.
      const belowLongMi = longMi > 0 ? Math.max(1, Math.min(longMi - 1, Math.round(0.8 * longMi))) : Infinity;
      // MLR-EASY-FLOOR-1 (2026-08-30) · WHAT COUNTS AS SPARE.
      //
      // This read `mathFloor` — the flat 3 mi emergency minimum — so the
      // medium-long run was allowed to take every mile above three from each
      // remaining easy day. On the owner's CIM week 1 that turned easy days of
      // 5 / 5 / 5 into 3 / 9 / 3: the MLR ate six miles of aerobic base and the
      // two real easy days dropped under the general-aerobic floor
      // (`_coach_sensible` "an easy day is long enough", 3 mi = 26 min against
      // Research/03's 40). He read it as the plan giving him less than the
      // recovery week it replaced, and he was right.
      //
      // The MLR is a stimulus laid ON TOP of an aerobic base; it is not funded
      // by dismantling one. Spare miles are the ones above the runner's OWN
      // demonstrated easy day (`effectiveFloor`, which is `easyMileFloor` — now
      // Rule-8 clean — floored at `mathFloor`), not above a number that exists
      // so a week cannot collapse entirely. Where the week genuinely cannot
      // fund both, `mlrMi` falls under `MLR_MIN_MI` and no MLR is promoted,
      // which is the honest answer: the easy days ARE the week's aerobic work
      // at that volume, and Research/22 lists the MLR in the peak-week shape,
      // not in week one.
      // WHAT THE MLR MUST LEAVE EACH REMAINING EASY DAY.
      //
      // The runner's own demonstrated easy distance (`effectiveFloor`, the
      // Rule-8-clean `easyMileFloor` floored at `mathFloor`) — the number Rule
      // 12 says is halved when this goes wrong.
      //
      // Bounded ABOVE by `Research/00a` §2's own general-aerobic maximum, 75
      // minutes priced at the runner's easy pace. Without that bound a runner
      // whose measured easy day is longer than any general-aerobic run doctrine
      // describes would suppress the MLR entirely on his own behalf — which is
      // how the first cut of this broke `_seglong_authoring`, whose advanced
      // marathoner has a 12-mile "easy day". Past 75 minutes a day is not an
      // easy day the MLR is displacing, it is a second medium-long.
      //
      // Bounded BELOW by `mathFloor`, so a week can never collapse entirely.
      const genAerobicMaxMi = easyPaceSecPerMi && easyPaceSecPerMi > 0
        ? (GENERAL_AEROBIC_MAX_MINUTES * 60) / easyPaceSecPerMi
        : Infinity;
      const mlrLeaveMi = Math.max(mathFloor, Math.min(effectiveFloor, genAerobicMaxMi));
      const affordableMi = easyPool - mlrLeaveMi * (easyDows.length - 1);
      const mlrMi = Math.floor(Math.min(rampedMi, shareMi, belowLongMi, affordableMi) * 2) / 2;
      if (mlrMi >= MLR_MIN_MI && mlrMi > slots[easyDows[0]]!.distanceMi) {
        // PLACEMENT · the easy day furthest from the long run, measured both
        // ways round the week. Research/22's sample peak weeks put the MLR on
        // Wednesday against a Sunday long, which is exactly what this picks;
        // stating it as a separation rule rather than a weekday means it also
        // lands correctly for a runner whose long is on Saturday. Ties go to
        // the earlier day after the long, matching the Wednesday-over-Thursday
        // choice §"Marathon — Advanced" makes.
        const sepOf = (dow: number) => {
          const fwd = (dow - longRunDow + 7) % 7;
          return Math.min(fwd, 7 - fwd);
        };
        let pick = easyDows[0];
        for (const d of easyDows) {
          const better = sepOf(d) > sepOf(pick)
            || (sepOf(d) === sepOf(pick)
                && (d - longRunDow + 7) % 7 < (pick - longRunDow + 7) % 7);
          if (better) pick = d;
        }
        // Redistribute · the pool is conserved to the half mile, so weeklyMi is
        // untouched. Remainder goes to the earliest donors rather than being
        // dropped, which is what keeps the sum exact.
        const donors = easyDows.filter((d) => d !== pick);
        let left = Math.round((easyPool - mlrMi) * 2) / 2;
        slots[pick]!.distanceMi = mlrMi;
        const per = Math.floor((left / donors.length) * 2) / 2;
        donors.forEach((d, i) => {
          const give = i === donors.length - 1 ? left : Math.max(mathFloor, per);
          slots[d]!.distanceMi = Math.max(0, Math.round(give * 10) / 10);
          left = Math.round((left - slots[d]!.distanceMi) * 10) / 10;
        });
        // DOCTRINE-STRIDES-3 (2026-08-30) · A MEDIUM-LONG RUN IS NOT AN EASY
        // RUN, SO IT DOES NOT CARRY THE EASY DAY'S STRIDES.
        //
        // The stride pass above ran before this one and put strides on the
        // week's first two easy days. This pass then promotes one of those
        // days into a 9-12 mile medium-long run — and the code here used to
        // carry the strides across with it, deliberately, re-rendering them at
        // the current phase count. That is placement doctrine does not license:
        //
        //   · `Research/04` §7.2 Placement names exactly three homes — "End of
        //     an easy run, mid-warmup before a workout, or standalone day". A
        //     medium-long is none of them: `Research/00a` §3 gives it its OWN
        //     row among the seven workout categories, whose Purpose is
        //     "Aerobic strength under fatigue without long-run cost".
        //   · §7.2's Contraindications row is "Not a workout — back off if form
        //     degrades", and the end of a twelve-mile run done for aerobic
        //     strength UNDER FATIGUE is the exact state that names.
        //   · §3's own Contraindications row — "Don't run too hard — it should
        //     not compete with the long run for recovery" — is what the
        //     embedded-T guard directly below already respects. Appending
        //     8×20s at near-mile pace after that embedded threshold segment
        //     puts three intensities on the one day the doctrine asks to stay
        //     out of the long run's way.
        //
        // Verified on the owner's live block `pln_9a57561debb776e5`: three
        // medium-long runs (9-12 mi) carried strides for exactly this reason.
        //
        // The week does not LOSE its second stride day — the strides are
        // re-homed to the earliest remaining true-easy slot, so §7.2's
        // "Frequency 2-4×/week" is still met where §7.2 says to meet it.
        // Deterministic (earliest dow wins), so plans still regenerate
        // byte-identically.
        if ((slots[pick]!.subLabel ?? '').includes('strides')) {
          for (let d = 0; d < 7; d++) {
            if (d === pick) continue;
            const s = slots[d];
            if (!s || s.type !== 'easy' || s.distanceMi <= 0) continue;
            if ((s.subLabel ?? '').includes('strides')) continue;
            s.subLabel = `EASY · ${strideReps}×${STRIDE_DURATION_S}s strides`;
            s.notes = `${s.notes} Finish with ${strideReps} relaxed ${STRIDE_DURATION_S}-second strides, full recovery between.`;
            break;
          }
        }
        // Never appended to a medium-long. Kept as a named empty string rather
        // than deleting the interpolation, so the label shape below still reads
        // as "here is where strides would go, and they do not go here".
        const strides = '';
        /* VARIATION-CLOSE-1 (2026-08-29) · §3's "medium-long with embedded T
         * segment (advanced)".
         *
         * The medium-long is authored HERE, directly, and the `medium_long`
         * slot is never passed to the selector — so an embedded-T structure
         * added to the catalogue entry would have been unreachable, which is
         * the same mistake §11.1's Canova block sat in for months. The variant
         * has to be authored where the session is.
         *
         * Guarded hard, because §3's Contraindications row is the constraint
         * that matters more than the variation: "Don't run too hard — it
         * should not compete with the long run for recovery." So:
         *   · advanced tiers only, which is the doc's own "(advanced)" tag;
         *   · specific phases only, never base;
         *   · never on a week whose long run already carries race pace — two
         *     structured days plus a quality day is a third hard session the
         *     week was not budgeted for;
         *   · the segment is bounded by Daniels' weekly T budget AND capped at
         *     a fifth of the run, so it stays an embedded segment rather than
         *     becoming a tempo that happens to be long.
         */
        const mlrTierAllows = level === 'advanced' || level === 'advanced_plus';
        const mlrPhaseAllows = phase === 'QUALITY' || phase === 'RACE-SPECIFIC';
        const mlrTBudget = mlrTierAllows && mlrPhaseAllows
          ? weeklyDoseBudgetMi(weeklyMi, 'T', weekDoseContext)
          : 0;
        const mlrTMi = (!hasFinish && mlrTBudget > 0)
          ? Math.min(Math.floor(mlrTBudget * 2) / 2, Math.floor(mlrMi * 0.2 * 2) / 2)
          : 0;
        const embeddedT = mlrTMi >= 2 ? ` · ${mlrTMi}mi @ T` : '';
        slots[pick]!.subLabel = `MEDIUM-LONG${embeddedT}${strides}`;
        slots[pick]!.notes =
          'Easy to steady. Aerobic strength under fatigue, without the cost of a long run. '
          + (embeddedT
            ? `Settle in, then run ${mlrTMi}mi at threshold somewhere in the middle and ease back to steady after. Embedded, no stop either side. It should not leave you needing a recovery day.`
            : 'Let the last few miles drift up if they want to.')
          + (strides ? ` Finish with ${strideReps} relaxed ${STRIDE_DURATION_S}-second strides, full recovery between.` : '');
      }
    }
  }

  // ── RULE12-VARY-1 (2026-08-30) · THE DAY AFTER THE LONG RUN IS A RECOVERY DAY
  //
  // Rule 12's second clause: "Vary them: a week has a short recovery day after
  // the long run and longer aerobic days elsewhere. Four identical easy days is
  // a template, not a plan." The engine sized every easy day in a week to the
  // same number because they were all the same division of one remainder.
  //
  // `Research/00a` gives them different jobs and different lengths. §1 recovery
  // run: "| Duration | 20-45 min |", whose whole purpose is the day after hard
  // work. §2 general aerobic: "| Duration | 40-75 min |", "bulk of weekly Z1".
  // So the day following the long run is capped into §1's band and the miles it
  // gives up go to the §2 days, which is the shape both sections describe.
  //
  // POOL-CONSERVING, exactly as the medium-long promotion above is: the same
  // miles, distributed by job rather than by division, so `weeklyMi` is
  // untouched and no ramp ceiling can move.
  //
  // NOT IN BASE OR TAPER, for the same reason the count rule above skips them —
  // a taper's easy days are already short by design and are legitimate §1 runs.
  // Inert when no easy pace resolves, or when the week has fewer than two easy
  // days to vary between.
  if (easyPaceSecPerMi && easyPaceSecPerMi > 0 && phase !== 'BASE' && phase !== 'TAPER') {
    const trueEasy: number[] = [];
    for (let d = 0; d < 7; d++) {
      const s = slots[d];
      if (s && s.type === 'easy' && s.distanceMi > 0
          && !(s.subLabel ?? '').startsWith('MEDIUM-LONG')) trueEasy.push(d);
    }
    const afterLongDow = (longRunDow + 1) % 7;
    if (trueEasy.length >= 2 && trueEasy.includes(afterLongDow)) {
      /* ── RECOVERY-AFTER-LONG-1 (2026-08-30) · DOCTRINE PUBLISHES THIS DAY ──
       *
       * The cap below was `Research/00a` §1's RECOVERY band alone, and §1 is
       * the GENERIC band for "a recovery run". `Research/22` publishes a
       * SPECIFIC cell for this specific day in each tier's own sample week,
       * and a specific cell outranks a generic band — Rule 7's lint shape is
       * exactly a category reaching for a generic value when doctrine states a
       * particular one.
       *
       * Live consequence, caught by the owner reading his own authored block:
       * at his 9:38/mi easy pace §1's 45-minute ceiling is 4.67 mi, floored to
       * 4.5, on a day his tier's row (Marathon — Advanced) reads "Rest or 6 mi
       * recovery" and his own history reads median 6.0. Six miles at 9:38 is 58
       * minutes, which is §2's general-aerobic band, so the day was not a §1
       * run for this runner at all.
       *
       * PER-TIER, NEVER A CONSTANT. Marathon — Intermediate reads "Rest" and
       * Beginner reads "XT or rest"; neither publishes a distance, and for
       * those runners §1's cap remains the right answer. `recoveryDayAfterLongMi`
       * returns null there and this whole branch keeps its previous behaviour.
       *
       * THE VARIATION IS PRESERVED, which is the half of RULE12-VARY-1 that was
       * right: the day still differs from the week's other easy days, and the
       * pool is still conserved. Only the magnitude moves, and it moves to the
       * number doctrine actually states.
       */
      const doctrineAfterLongMi = raceDistanceMi != null && raceDistanceMi > 0
        ? recoveryDayAfterLongMi(distanceCategoryOf(raceDistanceMi), level ?? null)
        : null;
      const recoveryCapMi = Math.max(
        (RECOVERY_RUN_MAX_MINUTES * 60) / easyPaceSecPerMi,
        doctrineAfterLongMi ?? 0,
      );
      const current = slots[afterLongDow]!.distanceMi;
      // The doctrine cell is a TARGET, not only a ceiling: when the week's own
      // division came in under it, this day is raised to it and the miles are
      // taken from the other easy days rather than added to the week. Bounded
      // by what those days can give above their floor, so a thin week cannot be
      // pushed past its ramp ceiling to satisfy a sample-week cell.
      if (doctrineAfterLongMi != null && current < doctrineAfterLongMi) {
        const others = trueEasy.filter((d) => d !== afterLongDow);
        let need = Math.round((doctrineAfterLongMi - current) * 2) / 2;
        for (let i = 0; i < others.length && need > 0; i++) {
          const d = others[i];
          // NOT `mathFloor`. The pull floor is the runner's own DEMONSTRATED
          // easy day (`baselineFloor` = `easyMileFloor`, Rule-8-filtered),
          // because funding this day by shortening the others below what he
          // actually runs would re-create the very defect Rule 12 exists for —
          // caught by `_coach_sensible`'s DEMONSTRATED_EASY check, which went
          // from 0 findings to 4 when this took down to `mathFloor`.
          const pullFloor = Math.max(mathFloor, baselineFloor);
          const spare = Math.max(0, Math.floor((slots[d]!.distanceMi - pullFloor) * 2) / 2);
          const take = Math.min(need, spare);
          if (take <= 0) continue;
          slots[d]!.distanceMi = Math.round((slots[d]!.distanceMi - take) * 10) / 10;
          need = Math.round((need - take) * 10) / 10;
        }
        const raised = Math.round((doctrineAfterLongMi - need) * 10) / 10;
        slots[afterLongDow]!.distanceMi = raised;
      }
      const recoveryMi = Math.max(mathFloor, Math.floor(Math.min(slots[afterLongDow]!.distanceMi, recoveryCapMi) * 2) / 2);
      const afterRaise = slots[afterLongDow]!.distanceMi;
      const surplus = Math.round((afterRaise - recoveryMi) * 2) / 2;
      if (surplus > 0) {
        const others = trueEasy.filter((d) => d !== afterLongDow);
        // §2's own ceiling · a day the surplus pushes past 75 minutes has
        // stopped being a general-aerobic run, so it does not take more.
        const aerobicCapMi = (GENERAL_AEROBIC_MAX_MINUTES * 60) / easyPaceSecPerMi;
        let left = surplus;
        const per = Math.floor((surplus / others.length) * 2) / 2;
        for (let i = 0; i < others.length && left > 0; i++) {
          const d = others[i];
          const want = i === others.length - 1 ? left : per;
          const room = Math.max(0, Math.floor((aerobicCapMi - slots[d]!.distanceMi) * 2) / 2);
          const give = Math.min(want, room);
          if (give <= 0) continue;
          slots[d]!.distanceMi = Math.round((slots[d]!.distanceMi + give) * 10) / 10;
          left = Math.round((left - give) * 10) / 10;
        }
        // Only shorten the recovery day by what the others actually absorbed,
        // so the week's mileage is conserved to the half mile either way.
        slots[afterLongDow]!.distanceMi = Math.round((afterRaise - (surplus - left)) * 10) / 10;
      }
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
  /** RACEROLE-1 (2026-08-28) · the runner's answered role for this tune-up
   *  (races.meta.plannedRole, set by accepting the race_role card). Null →
   *  unanswered, default shaping. Carried on the summary so the ramp/no-quality
   *  pass after embedding can key on it too. */
  plannedRole?: 'b_effort' | 'race' | 'mp_workout' | null;
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

/**
 * MIDRACE-SHAPE-1 (2026-08-25) · a day that stops being quality stops carrying
 * the overload trajectory's shape.
 *
 * `persistedDayShape` attaches `progressionSpecFields` whenever the day still
 * has a `workShape`, so a session demoted to easy by a mini-taper or a
 * post-race window persisted with the demoted label, the demoted notes, the
 * demoted type — and the ORIGINAL workout's geometry still in its spec. Live on
 * the owner's CIM block: the Thursday inside Run Malibu's mini-taper read
 * "Easy. Inside the mini-taper for Run Malibu · no quality this close." over a
 * spec carrying `progression: { reps: 3, rep_minutes: 10, pace_s_per_mi: 438,
 * zone: PROGRESSIVE }`. One row, two contradictory instructions.
 *
 * `raceGoalPaceSec` is already deleted at each of those sites for the same
 * reason. This is the field that was missed.
 */
function clearWorkShape(d: DayPlan): void {
  delete d.workShape;
  delete d.progressionLever;
  delete d.challengeZone;
  // PROGRESSION-DOSE-1 · the dose half goes with the label half, for the same
  // reason and at the same moment. A day demoted out of quality carries no
  // ladder position either, or the row would say "Easy · no quality this close"
  // over a spec still claiming a rung on the threshold ladder.
  delete d.progressionDose;
  // RATIONALE-PERSIST-1 · and the selection reason goes with both. A demoted
  // day's rationale would describe a session that is no longer on the row —
  // the same lie in a third field.
  delete d.catalogueRationale;
}

/**
 * MIDRACE-RESUME-1 (2026-08-28) · the first quality day back after an embedded
 * race's recovery window.
 *
 * A short cruise-interval set at the light end of Research/04 §5.3's structure
 * row ("3–6 × 1 mi with 1 min jog, or 2–4 × 2 mi with 2 min jog"), with a
 * deliberately generous jog: 3 mi at T, under the §5.3 full-session "4–8 mi"
 * at-pace band. Doctrine for the sizing is Research/00b's re-entry ordering —
 * the reverse taper reintroduces "strides, then short tempo" before a full
 * quality session, and every recovery table's first-intensity row is a
 * fraction of a normal workout. The string is a real prescription: it goes
 * through `parsePrescription` → `buildWorkoutSpec` exactly like every other
 * authored quality day, so the day carries a spec, a pace target and phases on
 * the watch — not a bare `threshold` label over a default-shaped session.
 *
 * Bound by MIDRACE.resume-quality-light in the doctrine registry, which parses
 * both the §5.3 structure row and its at-pace band out of the doc.
 */
export const MIDRACE_RESUME_RX = '2×1.5 mi @ T · 3 min jog';

export function embedMidBlockRaces(
  weeks: ComposedWeek[],
  vols: number[],
  opts: {
    startMondayISO: string;
    raceDateISO: string;
    midBlockRaces: MidBlockRace[];
    trainingDaysPerWeek: number | null;
    /**
     * RACEPACE-1 (2026-08-25) · measured fitness, so an embedded race's own
     * stated goal gets the same realism the target race's does.
     *
     * Found by the CIM audit and it is not a hypothetical: the owner's Run
     * Malibu row, a B race four weeks out, carried `goalPaceSec` 412 — 6:52/mi
     * for a HALF, i.e. a 1:30:00, off a 1:41:53 half run three months earlier.
     * It went onto the row untouched, so the plan's sharpest tune-up asked for
     * eleven minutes faster than the runner's own most recent race at that
     * exact distance, and the race that is supposed to TEST the goal was
     * pre-committed to failing it (`Research/02` §12.3 makes the tune-up half
     * "the default predictor" — a predictor paced at fiction predicts nothing).
     *
     * Each embedded race is bounded at ITS distance over ITS remaining runway,
     * per-finding, not by inheriting the target race's ceiling. CLAUDE.md
     * §"Per-finding context filters": a surface that aggregates N findings runs
     * N filter applications, and a Malibu-shaped question must be asked about
     * Malibu. Null → no clamp, byte-identical to before.
     */
    currentVdot?: number | null;
    /**
     * RACEROLE-1 (2026-08-28) · the TARGET race's goal pace (s/mi). Only read
     * when an embedded race carries plannedRole 'mp_workout': that race day
     * becomes the week's marathon-pace long, and MP is by definition the goal
     * marathon's pace. Null → the MP long carries no numeric target.
     */
    targetGoalPaceSec?: number | null;
    /**
     * COMBINED-STRESS-1 (2026-09-02) · sink for the typed placement decisions
     * this pass makes (brief §5.5). Mutated in place; `composePlan` hands one
     * in and writes it to `authoredState.placement_compromises`. Omitted →
     * the decisions are still made, they are simply not recorded, which is
     * what every existing unit caller wants.
     */
    compromises?: PlacementRecord[];
  },
): EmbeddedRaceSummary[] {
  const compromises: PlacementRecord[] = opts.compromises ?? [];
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
    // RACEROLE-1 · the runner's answered role for this tune-up (only B races
    // carry one — the race_role card never fires for C). Null → unanswered,
    // and every shaping below is byte-identical to before.
    const role = race.priority === 'B' && race.plannedRole ? race.plannedRole : null;

    // The race day itself — race-effort framing at the race's own distance.
    slot.type = 'race';
    slot.distanceMi = race.distanceMi;
    slot.isQuality = true;                               // the race is the day's (and often the week's) quality
    slot.isLong = wasLong;                               // race ON the long-run day replaces the long
    slot.subLabel = 'RACE';
    // RACEPACE-1 · this race's own goal, bounded by this race's own runway at
    // this race's own distance. `weeksToThis` counts from the block's start to
    // the race date, which is the build the runner actually has for it.
    slot.raceGoalPaceSec = boundedRacePaceSPerMi({
      statedPaceSPerMi: race.goalPaceSec ?? null,
      currentVdot: opts.currentVdot ?? null,
      raceDistanceMi: race.distanceMi,
      // The build this runner actually has for THIS race: the block's start to
      // its date, not the target race's runway.
      totalWeeks: Math.max(0, o / 7),
    });
    slot.notes = race.priority === 'B'
      ? role === 'b_effort'
        ? `${race.name}. B effort. Hard, not all out. It feeds your goal pacing and leaves the build intact.`
        : role === 'race'
          ? `${race.name}. Race it honestly. Full effort; full recovery follows before quality resumes.`
          : `${race.name}. B race · race effort. Recovery days follow before quality resumes.`
      : `${race.name}. C race · this is the week's quality session. Run it as the workout.`;
    // MIDGOAL-1 (2026-08-30) · STATE THE TARGET, AND SAY WHOSE IT IS.
    //
    // The row carried `raceGoalPaceSec` since MIDRACE-1 and the prose never
    // said it, so a runner reading the plan saw "B race · race effort" and no
    // number for a day the watch was already going to pace. State it.
    //
    // Provenance is in the WORDS, not a mark. Rule one ("a modelled number
    // must never look measured", docs/faff-iphone-design-contract.md §1) is
    // carried on the phone by `FaffValue` and on the web by `<Modelled>`, and
    // `notes` is a bare string with neither: it reaches the watch, the phone
    // and the web as prose. check-modelled-mark's own guard-8/9 header records
    // why a typed `~` is the fallback where no provenance type exists — but a
    // tilde in a prose string is exactly what guards 2 and 6 forbid elsewhere,
    // because it can be truncated, copied or formatted away and it says
    // nothing about WHICH model produced the number. "Coach target" cannot be
    // stripped without the sentence losing its verb, and it names the author.
    // A runner-stated goal says "Target", because it is theirs.
    if (slot.raceGoalPaceSec != null && Number.isFinite(slot.raceGoalPaceSec)) {
      const paceStr = fmtPaceSlash(slot.raceGoalPaceSec);
      if (paceStr) {
        slot.notes += race.goalPaceIsCoachSet === true
          ? ` Coach target ${paceStr}, set from your current fitness. Yours to change.`
          : ` Target ${paceStr}.`;
      }
    }
    if (role === 'b_effort') slot.subLabel = 'RACE · B EFFORT';
    touchedWeeks.add(wi);

    if (race.priority === 'B' && role === 'mp_workout') {
      // RACEROLE-1 · MP WORKOUT WITH A BIB. The runner answered "convert":
      // the race is closer than the tune-up sanction allows (Research/
      // REVIEW_NOTES.md A2 · inside 4 weeks of the marathon), so race day
      // becomes the week's MP-specific long (Research/08 §9.2's week −3
      // session) instead of a raced half. The day KEEPS its race marker —
      // the runner is still standing on a start line — but the prescription
      // is workout-shaped: it is the week's long, it carries the marathon
      // goal pace, and it takes hard-day spacing rather than a race-recovery
      // window. No mini-taper (the surrounding week trains through), no
      // cutback flag, no post-race easy window — the next day eases, as
      // after any hard long.
      slot.isLong = true;
      slot.subLabel = 'RACE · MP LONG';
      slot.notes = `${race.name}. Run it as the marathon pace long, not a race. Warm up, then marathon pace to the line. Hard day, not a peak effort.`;
      if (opts.targetGoalPaceSec != null && Number.isFinite(opts.targetGoalPaceSec)) {
        slot.raceGoalPaceSec = Math.round(opts.targetGoalPaceSec);
      } else {
        delete slot.raceGoalPaceSec;
      }
      clearWorkShape(slot);
      // The week's separate long stands down · the race IS the long now.
      for (const d of weeks[wi].days) {
        if (d === slot || !d.isLong || d.type === 'race') continue;
        d.type = 'easy';
        d.distanceMi = Math.min(d.distanceMi, 6);
        d.isQuality = false;
        d.isLong = false;
        d.subLabel = 'EASY';
        d.notes = `Easy. ${race.name} is this week's long run.`;
        delete d.raceGoalPaceSec;
        clearWorkShape(d);
      }
      // Hard-day spacing: the day after eases (not a race-recovery window).
      const after = dayAt(o + 1);
      if (after && after.type !== 'race' && after.isQuality && !after.isLong) {
        after.type = 'easy';
        after.distanceMi = Math.min(after.distanceMi, 5);
        after.isQuality = false;
        after.subLabel = 'EASY';
        after.notes = `Easy the day after the ${race.name} MP long.`;
        delete after.raceGoalPaceSec;
        clearWorkShape(after);
        touchedWeeks.add(Math.floor((o + 1) / 7));
      }
    } else if (race.priority === 'B') {
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
        clearWorkShape(d);
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
      //
      // RACEROLE-1 · when the runner has ANSWERED the race-role card, the
      // window is the doctrine one for the answered effort instead: role
      // 'race' is an honest (maximum) effort and takes the A-effort table
      // floor (00b by-distance: half 10 · 10K 5 · 5K 4); role 'b_effort'
      // takes the B scale (00b: "expect 7–10 days of recovery rather than
      // 14" → half 7 · 10K 4 · 5K 3). ROLE_POST_QUALITY_FREE_DAYS is bound
      // by RACEROLE.recovery-scale in lib/doctrine/registry.ts.
      //
      // D1 (2026-09-02) · THE UNCITED WINDOW IS GONE.
      //
      // This line used to fall back to `distanceMi >= 12 ? 4 : >= 5 ? 2 : 1`
      // for an unanswered B race — three numbers with no citation, sitting
      // beside a doctrine-bound table and BELOW it in every row (half 4 vs 7,
      // 10K 2 vs 4, 5K 1 vs 3). Two answers to one question is a Rule 16
      // violation whichever is right, and the uncited one was also the more
      // permissive, which is the direction that costs a runner.
      //
      // An unanswered B race is a B effort by its own calendar letter, so it
      // takes the b_effort row: `Research/00b` §"Recovery by Distance" ·
      // "Total recovery days (no quality)", scaled by §"Recovery by Effort"'s
      // "60–70% of A-race recovery duration". That is the same derivation
      // `postRaceNoQualityDays` makes; ROLE_POST_QUALITY_FREE_DAYS is the
      // pinned table and is used rather than re-derived.
      //
      // Consequence, measured on the owner's block: his Santa Monica 10K's
      // window goes 2 → 4 days and his Run Malibu half's 4 → 7. The half's
      // 7-day window covers the whole of the following composed week, which
      // leaves that week with no quality at all — accepted by
      // `validateComposedPlan` §5 through an argued, doctrine-cited exemption
      // (see POSTRACE-WEEK-1 there), not by weakening the quality rule.
      //
      // `roleCat`'s own >=12 / >=5 thresholds are pre-existing and untouched:
      // ROLE_POST_QUALITY_FREE_DAYS publishes only hm/10k/5k rows, so the
      // canonical categorizer's 'm' and 'ultra' have nowhere to land here.
      // The embedder refuses an ultra outright (ULTRA-OUT-1) and a marathon
      // tune-up maps to the half row, which is the most conservative row that
      // exists rather than a guess at one that does not.
      // ONE RESOLVER (Rule 16). `noQualityDaysAfterRace` reads
      // ROLE_POST_QUALITY_FREE_DAYS through the EFFECTIVE priority, which is
      // the same mapping `role` expressed by hand: 'race' → the A row,
      // 'b_effort' and unanswered-B → the b_effort row. The validator asks the
      // identical function, so a plan cannot be authored under one reading of
      // the window and refused under another — which is exactly what happened
      // when §11 first ran against a second doctrine table.
      const recoveryDays = noQualityDaysAfterRace(
        race.distanceMi,
        effectiveRecoveryPriorityImpl({ priority: race.priority, plannedRole: role }),
      );
      let firstDisplacedQuality: Pick<DayPlan, 'type' | 'distanceMi' | 'subLabel' | 'notes'> | null = null;
      for (let j = 1; j <= recoveryDays; j++) {
        const d = dayAt(o + j);
        if (!d || d.type === 'race') continue;
        const wiJ = Math.floor((o + j) / 7);
        if (d.isQuality && !d.isLong) {
          if (!firstDisplacedQuality) {
            firstDisplacedQuality = { type: d.type, distanceMi: d.distanceMi, subLabel: d.subLabel, notes: d.notes };
          }
          d.type = 'easy';
          d.distanceMi = Math.min(d.distanceMi, 5);
          d.isQuality = false;
          d.subLabel = 'EASY';
          d.notes = `Post-race recovery · day ${j} after ${race.name}. Easy only; quality resumes after the recovery window.`;
          delete d.raceGoalPaceSec;
          clearWorkShape(d);
          touchedWeeks.add(wiJ);
        }
        // D2 (2026-09-02) · the long run is NOT handled here any more.
        //
        // This branch used to convert any long inside a half-or-longer B
        // race's recovery window to a ≤6 mi easy day. Two things were wrong
        // with it and both are Rule 9 shapes: it was a CLIFF (day 4 stood the
        // long down entirely, day 5 left it untouched), and its trigger was
        // the no-quality window, which is a different column of the doctrine
        // table from the one that governs long runs. The long-run question is
        // answered once, continuously, by the pass below.
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
              // MIDRACE-RESUME-1 (2026-08-28) · the restored day is a LIGHT
              // threshold re-entry with a real prescription, not the displaced
              // session at full dose — and never an unprescribed slot.
              //
              // Two defects, one root. The intervals path (MIDRACE-NOTE-1's
              // "downgrade to threshold") nulled the sub_label, so the day
              // shipped as `{type:'threshold', subLabel:null}` and
              // buildWorkoutSpec fell through to its default full 4×1mi @ T —
              // a quality day with a distance and a scheduling note but no
              // stated shape. The preserved-threshold path was worse in the
              // other direction: it restored the displaced session at full
              // dose (the owner's CIM block put a 6×1km MP→5K cutdown five
              // days after a half).
              //
              // Doctrine says the first quality back is light either way.
              // Research/00b §"The Reverse Taper Principle" orders re-entry
              // "reintroduce strides, then short tempo" before "reintroduce
              // one quality session (threshold or fartlek)", and the recovery
              // tables' first-intensity rows are all sized under a full
              // session ("40 min easy or short fartlek (4× 1 min @ 10K
              // effort) | First intensity, optional"). So the resume day is a
              // short cruise-interval set at the light end of Research/04
              // §5.3's structure ("3–6 × 1 mi with 1 min jog, or 2–4 × 2 mi
              // with 2 min jog") with a generous jog: 3 mi at T, below the
              // §5.3 full-session band of "4–8 mi" at pace. The day's total
              // distance is unchanged — the warm-up and cool-down absorb the
              // difference — so the week's volume accounting is untouched.
              //
              // MIDRACE-NOTE-1's lesson stands: the scheduling sentence is
              // kept, but it rides behind a real prescription instead of
              // standing in for one. Bound by MIDRACE.resume-quality-light.
              d.type = 'threshold';
              d.distanceMi = firstDisplacedQuality.distanceMi;
              d.isQuality = true;
              d.subLabel = MIDRACE_RESUME_RX;
              d.notes =
                `Cruise-interval re-entry · Research/04 §5.3, light end. First quality back after ` +
                `${race.name} · short T reps with a generous jog before full sessions return ` +
                `(Research/00b reverse taper). Quality resumes after ${race.name} recovery.`;
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
      // One easy day BEFORE — no deeper mini-taper for a C race.
      {
        const d = dayAt(o - 1);
        if (d && d.type !== 'race' && d.isQuality && !d.isLong) {
          d.type = 'easy';
          d.isQuality = false;
          d.subLabel = 'EASY';
          d.notes = `Easy the day before ${race.name}.`;
          delete d.raceGoalPaceSec;
          touchedWeeks.add(Math.floor((o - 1) / 7));
        }
      }
      /* AFTER · THE DOCTRINE WINDOW, NOT ONE DAY (2026-09-02).
       *
       * This was a bare `+1`: exactly one easy day after a C race, cited to
       * nothing. `Research/00b` §"Recovery by Effort" gives the C row its own
       * number — "25–50% of A-race recovery duration; treat like a hard
       * workout" — which for a 10K is 1.25 to 2.5 days of no quality, and the
       * engine was answering the very bottom of it.
       *
       * Found by the new combined-stress check refusing a plan the composer
       * had just authored: `_brain_acceptance`'s multi-race golden runner put
       * an intervals session on day 2 after a C 10K and `validateComposedPlan`
       * §11 raised `QUALITY_INSIDE_RECOVERY_WINDOW` against the same doctrine
       * table. Two answers to one question (Rule 16) — and the composer's was
       * the uncited one, exactly as it had been for an unanswered B race
       * before D1.
       *
       * `noQualityDaysAfterRace` is the single resolver both now call, so the
       * plan cannot be authored under one reading of the window and refused
       * under another. The LONG RUN is deliberately untouched: D2 grades a C
       * effort as a hard workout, not a race, so it does not consume the
       * following long-run slot (see the D2 block below).
       */
      {
        const window = noQualityDaysAfterRace(race.distanceMi, 'C');
        for (let j = 1; j <= window; j++) {
          const d = dayAt(o + j);
          if (!d || d.type === 'race' || !d.isQuality || d.isLong) continue;
          d.type = 'easy';
          d.isQuality = false;
          d.subLabel = 'EASY';
          d.notes = j === 1
            ? `Easy the day after ${race.name}.`
            : `Easy. Day ${j} after ${race.name}; it was a hard session and takes its recovery.`;
          delete d.raceGoalPaceSec;
          clearWorkShape(d);
          touchedWeeks.add(Math.floor((o + j) / 7));
        }
      }
    }

    /* ── D2 · RACE AND LONG RUN ARE ONE TRANSACTION ─────────────────────
     *
     * The defect (brief §3.2.C), reproduced on the owner's live block before
     * this pass existed:
     *
     *   2026-09-26 Sat  race 6.21 mi
     *   2026-09-27 Sun  long 15.5 mi        → 21.7 mi in 24 hours
     *
     * "Race valid" and "long run valid" were separate questions and both
     * answered yes. Nothing computed the pair.
     *
     * THE ARBITRATION, and it is between two citations that both apply:
     * `Research/00b` §"Recovery by Distance" gives every raced distance a
     * "Return to long runs" day, and `Research/22` §"Multi-Race Year
     * Planning" (with the Pfitzinger Saturday-tune-up → Sunday-long pattern
     * this function's own comments already cite) deliberately puts a race in
     * front of a long. §"Recovery by Effort" settles which is speaking: a C
     * race is a "hard workout substitute … treat like a hard workout", and a
     * hard workout takes the §"Hard/Easy Alternation" gap, not a race's
     * return-to-long window. An A or B EFFORT is a race and consumes the
     * slot. `raceConsumesLongRunSlot` is that sentence.
     *
     * CONTINUOUS, NOT A CLIFF (Rule 9). The allowed long is
     * `daysAfter / returnDays` of what the week planned, reaching the full
     * long exactly on the doctrine day. There is no day on which shifting the
     * race by one changes the plan in kind — which is precisely what the
     * branch this replaces did.
     *
     * WHY IT SHORTENS RATHER THAN MOVES. Brief §5.4 offers "long run moves"
     * first and this engine cannot take it: the composed week is anchored on
     * `longRunDow` and the long is its last day by construction, so there is
     * no later seat inside the week to move to. Moving it EARLIER would put
     * it against the week's own quality day, trading one adjacency for
     * another. So the compromise is REDUCE_DOSE, and it is recorded by name
     * on `authoredState.placement_compromises` rather than applied silently
     * (brief §5: "Do not silently repair an unsafe week without recording
     * the change").
     */
    {
      const effPriority = effectiveRecoveryPriorityImpl({ priority: race.priority, plannedRole: role });
      if (raceConsumesLongRunSlot(effPriority)) {
        const returnDays = returnToLongDays(race.distanceMi, effPriority);
        for (let j = 1; j < Math.ceil(returnDays); j++) {
          const d = dayAt(o + j);
          if (!d || d.type === 'race' || !d.isLong || !(d.distanceMi > 0)) continue;
          const factor = longRunFactorAfterRace(j, returnDays);
          const was = d.distanceMi;
          // Half-mile grain, the same increment every other distance in this
          // composer moves in.
          const now = Math.max(0.5, Math.round(was * factor * 2) / 2);
          if (!(now < was)) continue;
          d.distanceMi = now;
          d.notes =
            `Long run cut to ${now} mi · day ${j} after ${race.name} (${race.distanceMi} mi, ` +
            `${effPriority} effort). Research/00b puts the long run back at day ` +
            `${returnDays % 1 === 0 ? returnDays : returnDays.toFixed(1)}. Run it easy.`;
          clearWorkShape(d);
          delete d.raceGoalPaceSec;
          compromises.push({
            code: 'REDUCE_DOSE',
            raceSlug: race.slug, raceName: race.name, raceDateISO: race.date,
            dateISO: dowDateInWeek(weeks[Math.floor((o + j) / 7)].startISO, d.dow),
            detail: `long ${was}mi → ${now}mi · day ${j} of a ${returnDays.toFixed(1)}-day return-to-long window`,
            citation: 'Research/00b-recovery-protocols.md §"Recovery by Distance" (Return to long runs) · §"Recovery by Effort"',
          });
          touchedWeeks.add(Math.floor((o + j) / 7));
        }
      } else {
        // The decision is recorded even when nothing changes, because "we
        // looked and doctrine says this stands" and "nothing looked" are
        // different facts (Rule 11) and only one of them is defensible.
        const nextLong = (() => {
          for (let j = 1; j <= 2; j++) {
            const d = dayAt(o + j);
            if (d && d.isLong && d.type !== 'race' && d.distanceMi > 0) return { d, j };
          }
          return null;
        })();
        if (nextLong) {
          compromises.push({
            code: 'ACCEPT_AS_HARD_WORKOUT',
            raceSlug: race.slug, raceName: race.name, raceDateISO: race.date,
            dateISO: dowDateInWeek(weeks[Math.floor((o + nextLong.j) / 7)].startISO, nextLong.d.dow),
            detail:
              `${nextLong.d.distanceMi}mi long run stands ${nextLong.j} day(s) after ${race.name} ` +
              `(${race.distanceMi}mi, C effort) · ${(race.distanceMi + nextLong.d.distanceMi).toFixed(2)}mi across the pair`,
            citation: 'Research/00b-recovery-protocols.md §"Recovery by Effort" (C race · treat like a hard workout) · Research/22-plan-templates.md §"Multi-Race Year Planning"',
          });
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
      plannedRole: role,
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
 * MIDRACE-WINDOW-1 (2026-08-25) · that strip now measures the window in DAYS,
 * and scales it by the race's PRIORITY. It used to do neither, and both are
 * things `Research/00b` states outright.
 *
 *   · §"Recovery by Effort" is a table about priority, and the strip read
 *     `POST_RACE_RECOVERY_WEEKS`, which is keyed on DISTANCE alone. That
 *     constant is the A-race column — the by-distance table's own header reads
 *     "Total recovery days (no quality)" and §"Recovery by Effort" says an A
 *     race takes the "Full table above". A B race takes "60–70% of A-race
 *     recovery duration", and the row says the same thing again in days: "For
 *     a B-race half marathon, expect 7–10 days of recovery rather than 14."
 *     Every tune-up this engine embeds is a B or a C.
 *
 *   · And it stripped a WEEK, not a window. `weeks[weekIdx + 1]`'s long run is
 *     seven days after a Sunday race and thirteen after a Monday one; the
 *     strip fired identically on both. A window has a length and the long run
 *     has a date, so compare them.
 *
 * For the owner's own CIM block this changes nothing — Run Malibu is a Sunday
 * B half and his long run is the following Sunday, day 7, inside the 10-day
 * B-race window on either reading. It is corrected because it is wrong, not
 * because it moved his plan.
 *
 * WHERE IT RUNS. Inside `finalizeComposedPlan`, AFTER the VOL-1 reconcile and
 * before the taper enforcement. Running it in `composePlan` (the obvious place,
 * right after the embed) compares BUDGET volumes, and the budget is not what
 * ships: the per-day caps trim weeks afterwards, so the reference week shrank
 * from 54 to 51 while the capped week kept the 53.5 the budget allowed and
 * stayed the block's peak. Same budget-vs-realized trap COH-4 documents one
 * pass below. The taper then descends from the corrected peak.
 */
/**
 * MIDRACE-WINDOW-1 (2026-08-25) · fraction of the A-race recovery window a
 * tune-up of this priority actually costs.
 *
 * `Research/00b-recovery-protocols.md` §"Recovery by Effort":
 *
 *   | **A race** | Maximum, full taper, peak day | 2–3 weeks | Full table above |
 *   | **B race** | ... | 7–10 days | 60–70% of A-race recovery duration |
 *   | **C race / hard workout substitute** | ... | 25–50% of A-race recovery
 *     duration; treat like a hard workout |
 *
 * Each band's SLOW edge, for the same reason `ST_OFFSET_S_PER_MI` takes its
 * band's slow edge: the direction the error is dangerous in. A window read too
 * short authors quality onto legs that have not recovered; read too long it
 * costs one session. `POST_RACE_RECOVERY_WEEKS.hm` is 14 days, so a B half
 * lands on 10 — which is the number §"Recovery by Effort" states in words for
 * exactly that case ("expect 7–10 days of recovery rather than 14").
 *
 * Bound by `RECOVERY.priority-scale` in lib/doctrine/registry.ts.
 *
 * MOVED 2026-09-02 to `lib/plan/combined-stress.ts` and re-exported here so
 * every existing importer is unchanged. Three passes read it now — the
 * placement pass below, the no-quality window, and the final-plan combined-
 * stress check — and a constant three passes share is not the monolith's
 * property. There is one definition; this line is a name for it.
 */
export { POST_RACE_PRIORITY_SCALE } from './combined-stress';

/**
 * MOVED 2026-09-02 to `lib/plan/combined-stress.ts`, re-exported here so every
 * existing importer is unchanged. Both are now read by the validator as well
 * as by the placement pass, and the validator cannot import this file (the
 * dependency runs the other way). One definition, two names for it.
 */
export { postRaceNoQualityDays, effectiveRecoveryPriority } from './combined-stress';

/** The ISO date of `dow` inside a composed week, whatever weekday that week
 *  starts on. Same mapping `embedMidBlockRaces` walks with its absolute
 *  offsets, expressed for a caller that holds a week rather than the block. */
function dowDateInWeek(weekStartISO: string, dow: DOW): string {
  const startDow = new Date(weekStartISO + 'T12:00:00Z').getUTCDay();
  return addDays(weekStartISO, ((dow - startDow) % 7 + 7) % 7);
}

export function enforceRampCeilingAfterEmbedding(
  weeks: ComposedWeek[],
  vols: number[],
  level: LevelKey,
  embedded: EmbeddedRaceSummary[],
  /** WKRESUME-1 · the largest week the runner held BEFORE this block. Same
   *  seed, same reason, as `enforceWeeklyRampCeiling`: this pass's own header
   *  argues that ramping off a deliberately-reduced week "would punish the
   *  runner for tapering", and then measures against the block's opening weeks,
   *  which on a resume are deliberately reduced too. On the owner's CIM block
   *  the week doctrine puts at FULL pre-interruption volume (Research/22 §14,
   *  week 3 of the return) followed a 10K tune-up, so it was graded against the
   *  70%-of-sustained week the engine itself had prescribed and cut from 43 to
   *  32. Null/undefined → 0, and the pass is byte-identical. */
  priorLevelMi?: number | null,
): void {
  const seedMi = (priorLevelMi != null && Number.isFinite(priorLevelMi) && priorLevelMi > 0)
    ? priorLevelMi
    : 0;
  const ceiling = GENERAL_RAMP_CEILING[level ?? 'intermediate'];
  // RACEROLE-1 · an mp_workout conversion is a full training week (the race
  // day IS the week's long), not a mini-tapered cutback — it is neither a
  // distorted reference week nor a week anything needs to ramp-guard after.
  const bRaceWeeks = new Set(
    embedded.filter((e) => e.priority === 'B' && e.plannedRole !== 'mp_workout').map((e) => e.weekIdx),
  );
  for (const e of embedded) {
    if (e.priority !== 'B' || e.plannedRole === 'mp_workout') continue;
    const wi = e.weekIdx + 1;
    const w = weeks[wi];
    const prev = weeks[wi - 1];
    if (!w || !prev || w.isRaceWeek || bRaceWeeks.has(wi)) continue;
    // Race-pace finish inside the post-race no-quality window (half+ only).
    // MIDRACE-WINDOW-1 · measured in days from race day, priority-scaled.
    if (e.distanceMi >= 12) {
      const long = w.days.find((d) => d.isLong && d.type === 'long' && d.distanceMi > 0);
      if (long && splitDay(long).qualityMi > 0
        // RACEROLE-1 · window scaled by the ANSWERED effort, not the letter.
        && daysBetween(e.date, dowDateInWeek(w.startISO, long.dow)) <= postRaceNoQualityDaysImpl(e.distanceMi, effectiveRecoveryPriorityImpl(e))
      ) setLongFinish(long, 0, `inside the post-race no-quality window after ${e.name}`);
    }
    // Ramp reference · the most recent week distorted by neither a tune-up nor
    // a planned cutback. Falls back to the prior peak when the block has none.
    // WKRESUME-1 · both references are the larger of what the block has shown
    // and what the runner brought into it.
    const priorPeak = Math.max(seedMi, ...weeks.slice(0, wi).map((x) => x.weeklyMi ?? 0));
    let refMi = 0;
    for (let k = wi - 1; k >= 0; k--) {
      if (bRaceWeeks.has(k) || weeks[k].isCutback || weeks[k].isRaceWeek) continue;
      refMi = weeks[k].weeklyMi ?? 0;
      break;
    }
    if (!(refMi > 0)) refMi = priorPeak;
    refMi = Math.max(refMi, seedMi);
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
      setLongFinish(long, Math.max(0, Math.floor(long.distanceMi * 0.5 * 2) / 2),
        'resized after the week was trimmed to its ramp ceiling');
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
  /** WKRESUME-1 · the largest week the runner held BEFORE this block, seeding
   *  the prior-peak reference. Null/undefined → 0, and the block's own weeks
   *  are the only reference, exactly as before. */
  priorLevelMi?: number | null,
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
  // WKRESUME-1 · the reference starts at the runner's own pre-block level when
  // the authoring measured one. "The largest week the runner has completed" is
  // the rule; the block is not the only place they have run.
  let priorPeak = (priorLevelMi != null && Number.isFinite(priorLevelMi) && priorLevelMi > 0)
    ? priorLevelMi
    : 0;
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
  /**
   * COURSE-PLAN-1 (2026-08-25) · the target race's MEASURED terrain, from
   * `loadRaceCourseTerrain`. Optional: absent, or `UNKNOWN_TERRAIN`, composes
   * exactly as this engine composed before it could see a course at all —
   * which is what every synthetic-runner and simulator path passes.
   */
  courseTerrain?: CourseTerrain | null;
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
  /**
   * PHASE-ANSWERS-1 · the Coaching Thesis (Constitution §F) as resolved at
   * authoring, CONSUMED here and quoted into each phase's answers. The
   * composer never ranks a capacity itself. Absent on every pure caller, and
   * the answers then say the limiter was not named (Rule 11).
   */
  thesisAtAuthoring?: ThesisAtAuthoring | null;
  easyDayMedianMi: number;
  /** 2026-06-03 · runner's recent peak long-run distance · floors the
   *  long-run sizing so the plan can't ask for a shorter long than the
   *  runner just did. 0 = no floor (cold start).
   *  RULE8-2 · this is the HABIT value and skips the prescribed span. The
   *  prior-30-day spike anchor is `spikeAnchorLongMi`. */
  recentLongMi: number;
  /** RULE8-2 (2026-08-30) · the LITERAL longest run in the last 28 calendar
   *  days, taper included. `rampCeiling`'s anchor, because Research/00a writes
   *  its own window into the rule it cites — ">110% of longest run in the prior
   *  30 d". Undefined falls back to `recentLongMi`, which is what every caller
   *  that does not supply it got before. */
  spikeAnchorLongMi?: number;
  /** LONGEVIDENCE-1 (2026-09-02) · the longest run this runner has actually
   *  completed in normal training over the last year, races and their
   *  prescribed windows excluded. Drives the block's long-run ceiling instead
   *  of the tier band, which becomes a cap. Undefined / null → no long-run
   *  evidence, and the band stands alone (a cold-start runner). */
  demonstratedLongMi?: number | null;
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
    /** MIDGOAL-1 (2026-08-30) · TRUE when `goalPaceSec` came from the COACH
     *  (lib/race/coach-goal.ts) rather than the runner's own stated goal.
     *
     *  A coach goal is modelled — derived from current VDOT, the runner's
     *  personal Riegel exponent and the course grade — and the row's prose
     *  must never present it as the runner's own number. False/absent means
     *  `goalPaceSec` is the runner's stated goal (races.meta.goalDisplay),
     *  which is exactly what it has always meant, so every existing caller
     *  and every stated-goal race composes byte-identically. */
    goalPaceIsCoachSet?: boolean;
    priority: 'B' | 'C';
    /** RACEROLE-1 (2026-08-28) · the runner's answered tune-up role
     *  (races.meta.plannedRole · written by the race_role card's accept).
     *  Read here so a REBUILD preserves the answer: 'b_effort' keeps the
     *  B shape with B-effort framing, 'race' takes the honest-race framing
     *  and the A-effort recovery window, 'mp_workout' turns race day into
     *  the week's MP long. Absent/null → shaping identical to before. */
    plannedRole?: 'b_effort' | 'race' | 'mp_workout' | null;
  }>;
  /**
   * AUTHORING-CANONICAL-1 (2026-09-01) · THE SIX CANONICAL PRICES.
   *
   * THE ONLY pace authority this composer has. A real authoring supplies them
   * from `resolvePrescribedPaceAnchors` (`loadGeneratorInputs`) — the same
   * function `recompute-paces.ts` and `reanchor-plan.ts` call, so a block is
   * authored at exactly the prices the nightly flex would rewrite it to.
   *
   * ABSENT — every pure caller: sweep archetypes, bench personas, `/sim/plan`,
   * unit fixtures. Those are composed through `syntheticPaceAnchors`
   * (`lib/plan/authoring-anchors.ts`), which runs the IDENTICAL pure capacity
   * cores on this input's own evidence fields. One pricing path, two sources
   * for its bottom rung — never a fallback to the VDOT cascade.
   *
   * NO GOAL REACHES IT. `PrescribedPaceAnchors` is composed from
   * `ResolvedCapacity` alone and `capacity-resolver.ts` is compile-time sealed
   * against goal data (Constitution §G).
   */
  paceAnchors?: PrescribedPaceAnchors | null;
  isMidBlock: boolean;
  /** TRAVEL-1 (2026-08-28) · the runner's declared travel windows that
   *  overlap the plan window (travel_windows table, entered on the phone).
   *  Travel days are EASY-PREFERRED, never rest-by-default: quality and the
   *  long run avoid them when the week has a clean seat, easy dose is
   *  unchanged, and every shaped day carries a coach note saying why.
   *  Undefined/empty → composePlan output is byte-identical to before.
   *  Cite: Research/12-travel-timezone.md §Pre/In/Post-Flight Running
   *  Adjustments ("avoid hard efforts" · "First quality session
   *  permissible" only days after arrival). See lib/plan/travel-windows.ts. */
  travelWindows?: TravelWindow[];
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
  /**
   * LABELTRUTH-1 · the threshold pace this plan was COMPOSED at, in s/mi.
   *
   * `finalizeComposedPlan` reconciles each day's sub_label against the spec the
   * day builds, and a time-stated rep set's clamp depends on the pace its
   * seconds convert through — so reconciling against a probe constant would
   * answer a question about a different runner. Carried on the result rather
   * than added as a parameter so every caller is reconciled at the right pace
   * without any of them changing.
   */
  tPaceSec?: number | null;
  /**
   * AUTHORING-CANONICAL-1 (2026-09-01) · THE SIX PRICES THIS BLOCK WAS
   * COMPOSED AT, carried to the writer.
   *
   * Rule 16: the composition and the persisted rows must be priced off one
   * resolution of one runner's capacity. Before this the writer re-derived a
   * threshold pace of its own (`resolveCurrentTPace`, the second of three
   * copies), and the two could — and for a below-table runner did — disagree.
   *
   * Rule 10: it is also the stamp. `persistComposedPlan` writes it to
   * `authored_state.pace_authoring`, so a later reader can answer "what was
   * this block priced at, and how well was each number known" without an
   * inference, and `lib/adaptation/authoring-convergence.ts` can tell a plan
   * authored canonically from one that still needs the flex to fix it.
   */
  paceAnchors?: PrescribedPaceAnchors | null;
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
  /**
   * WKRESUME-1 (2026-08-25) · the largest week the runner had already held
   * BEFORE this block opened, in miles. `enforceWeeklyRampCeiling`'s prior-peak
   * reference is seeded from it.
   *
   * The ramp ceiling reads "the largest week the runner has already completed
   * IN THIS BLOCK", which was the only thing the engine could know when it was
   * written. It is not the same sentence as the doctrine it enforces, and the
   * gap is visible the moment a block opens below the runner's own level: a
   * resume that starts at 70% of sustained (Research/22 §14) has a block-local
   * peak of 70%, so the ceiling caps week 2 at 80% and week 3 at 93% and the
   * return doctrine puts at week 3 never happens. Same shape as WKRAMP-REC-1
   * one regime over — measuring a return against the weeks it is returning FROM.
   *
   * Absent (maintenance, recovery, every archetype with no history) the seed is
   * 0 and the pass is byte-identical.
   */
  rampAnchorMi?: number;
  /**
   * PEAKLOAD-1 (2026-09-02) · THE BLOCK'S DECLARED PEAK WEEK, IN MILES.
   *
   * `max(...vols)` at composition time — the volume curve's own peak, which is
   * the number `deriveBlockStrategy` publishes as `peakLoadMi` and the number
   * the runner is shown. `layoutWeek` sizes each day against its own floors and
   * can hand back a week that sums ABOVE the budget it was given (WKRAMP-1's
   * header says so in as many words), so the plan could ship a week larger than
   * the peak its own strategy declares. Two answers to "what is the biggest
   * week in this block" is Rule 16, and the owner has ruled on the number:
   * "Retain the proposed 58.5-mile peak … Do not raise mileage to satisfy the
   * self-declared 'advanced' category."
   *
   * Carried so `finalizeComposedPlan` can hold the shipped plan to it. Absent →
   * the cap does not run and composition is byte-identical, which is every
   * caller that predates this field.
   */
  budgetPeakWeeklyMi?: number;
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
  //
  // RUNWAY-1 (2026-08-30) · the floor used to be `Math.max(3, ...)`, which
  // padded a genuinely short runway UP to 3 weeks without ever re-checking
  // that `input.raceDateISO` still falls inside the padded grid. Since
  // `isRaceWeek = wi === totalWeeks - 1` decides race week by ARRAY INDEX —
  // below — the composer kept building forward from `startMondayISO` and
  // blindly marked the LAST padded week as race week, whatever the real
  // date said. Reproduced directly: a half marathon 6 days out composed a
  // plan whose race day landed 14 days late; 13 days out landed 7 days
  // late; three race dates two calendar weeks apart collapsed onto one
  // identical composed grid.
  //
  // The two live callers (`loadGeneratorInputs`, `buildSimPlan`) already
  // refuse a runway this short before ever reaching `composePlan` — a
  // real dated goal race under 3 weeks out, or a sim under 2, is declined
  // with a friendly reason rather than silently mis-dated. So the padding
  // this floor did was dead weight for both of them; what it was NOT dead
  // weight for is `sizeBlocks`, whose own phase floors (fixed alongside
  // this, see RUNWAY-1 there) over-claimed weeks whenever a category's
  // taper plus quality-minimum exceeded a small totalWeeks — reachable at
  // 4-9 weeks, well above either guard's 2-3 week threshold, and measured
  // live: a half marathon or 10K 4 weeks out, or a marathon 3-5 weeks out,
  // silently never reached TAPER at all.
  //
  // Floored at 1, not 0 — a week array of length zero has no week for a
  // race day to live in, and `sizeBlocks` already degrades correctly to a
  // single TAPER week at totalWeeks=1 (verified: every category, swept
  // 1-12 weeks, phases always sum to totalWeeks, TAPER always present).
  // A race whose date is already in the past floors here too rather than
  // producing a negative-length grid — that is a caller-input question
  // (both live callers already refuse it upstream via the same runway
  // check), not one this function can answer by itself.
  const totalWeeks = Math.max(1,
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
  // GOALVOL-1 (2026-09-02) · THE LOAD TABLE IS NOT READ AT THE GOAL'S TIER.
  //
  // `lookupTierTarget(input.goalPaceSec, ...)` used to sit here, and its first
  // argument is why an `advanced` runner who typed a goal one second past the
  // elite line moved from the [65, 90] band to [70, 100] on identical evidence.
  // `lookupLoadTierTarget` takes a NAMED bag whose ceiling half
  // (`classifyCapacityTier`) has no goal in its parameter tuple at all, and the
  // goal enters only as a reduction. See the GOALVOL-1 block in goal-tiers.ts.
  const { tier, capacityTier, reducedByGoal, target: baseTierTarget } = lookupLoadTierTarget({
    raceDistanceMi: input.raceDistanceMi,
    level: input.level, // VAR-01 · experience is capacity, not ambition
    demonstratedPaceSec, // COLD-1 · an unstated level is lifted only by evidence
    goalPaceSec: input.goalPaceSec, // reduction only · never raises the band
  });

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
      // GOALVOL-1 · the horizon race's LOAD row, on the same seal. A future
      // race's typed goal may not lift this block's long-run dials either.
      const { target: ht } = lookupLoadTierTarget({
        raceDistanceMi: h.distanceMi, level: input.level,
        demonstratedPaceSec: hDemonstrated, goalPaceSec: h.goalPaceSec,
      }); // VAR-01 + COLD-1 + GOALVOL-1
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
  const vols = volumeCurve(input.rampBaseMi ?? input.recentWeeklyMi, blocks, input.level, tierTarget, distanceCategoryOf(input.raceDistanceMi), input.tsbAtStart, rampEvidence);
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
    const ramped = Math.round(recentQ + (desiredDensity - recentQ) * (stepsUp / 4));
    // QUALITYFLOOR-1 · the ramp brings quality BACK; it never removes it
    // entirely. A post-race 28-day window is mostly the no-quality recovery
    // this engine prescribed, so a literal reading of it would author a build
    // week with no hard running in it. Research/00b's "Return to quality
    // workouts" column names a day for every distance on which quality
    // resumes, and this week is past it by construction.
    return Math.min(desiredDensity, Math.max(QUALITY_RETURN_MIN_SESSIONS, ramped));
  }

  /* ── THE SIX ANCHORS · AUTHORING-CANONICAL-1 (2026-09-01) ─────────────────
   *
   * This block replaced the entire legacy pricing apparatus that used to sit
   * here: `conservativeVdotFromMileage` as an authority, `resolveCurrentTPace`
   * (one of THREE independent copies of the same computation — Rule 16),
   * `tPaceFromGoal`, `maxSeasonalVdotGain`, `achievableFloorT`, and the
   * per-week `blendedTPaceForWeek` blend that let a STATED GOAL move a
   * PRESCRIBED TRAINING PACE (Constitution §7/§G, and the live violation the
   * 2026-09-01 independent audit measured on the owner's own plan).
   *
   * Six numbers, each from the service that owns its question, and NO GOAL
   * AMONG THEM. `recompute-paces.ts` and `reanchor-plan.ts` — the flex path
   * that rewrites every unrun day of a live block — have priced this way since
   * 2026-08-31; authoring was the last surface still on the cascade, which is
   * exactly the "sometimes old, sometimes new depending on which path ran
   * last" state Constitution §8 forbids. It is now closed.
   *
   * WHERE THE ANCHORS COME FROM. `input.paceAnchors`, always. A real authoring
   * gets them from `resolvePrescribedPaceAnchors` in `loadGeneratorInputs`; a
   * pure caller (sweep archetype, bench persona, /sim/plan) gets them from
   * `syntheticPaceAnchors`, which runs the IDENTICAL pure capacity cores on
   * the caller's own evidence fields. See `lib/plan/authoring-anchors.ts` —
   * one pricing path, two sources for its bottom rung.
   *
   * RULE 11 · there is no fallback. `composePaceAnchors` refuses only on an
   * INCOHERENT set (an easy ceiling faster than threshold, a non-finite
   * number), never on thin evidence — every capacity resolver's last rung is a
   * prior, so a cold-start runner still gets an ordered set. Reaching for the
   * VDOT cascade on a refusal would put the defect on the runner's phone under
   * a different derivation, so a refusal THROWS and the caller declines to
   * author.
   */
  const anchorRead = input.paceAnchors != null
    ? ({ ok: true, anchors: input.paceAnchors } as const)
    : syntheticPaceAnchors({
        bestRecentVdot: input.bestRecentVdot ?? null,
        belowTableAnchor: input.belowTableAnchor ?? null,
        recentWeeklyMi: input.recentWeeklyMi,
      });
  if (!anchorRead.ok) {
    throw new Error(
      `[composePlan] REFUSED · pace anchors ${anchorRead.reason} · ${anchorRead.detail} · `
      + 'no plan authored (Rule 11 · no fallback to the VDOT cascade)',
    );
  }
  const anchors = anchorRead.anchors;

  /** THE threshold pace this block is priced at. One number, one resolution.
   *  Was `resolveCurrentTPace(...)` here, again in `persistComposedPlan`, and
   *  a third time in `loadGeneratorInputs` — Rule 16's cheapest win. */
  const currentT = anchors.thresholdSecPerMi;

  /**
   * The threshold capacity's DERIVED VDOT, for the two consumers that
   * legitimately still speak VDOT: Race Prediction's own input
   * (`achievableRaceTarget`, Constitution §J) and the goal-REALISM flag, which
   * is a sanity check on a stated goal rather than a training prescription.
   *
   * Null for a runner whose threshold pace sits outside the Daniels table's
   * [30,85] range — a real answer, not a failure (Rule 11), and both consumers
   * below branch on it rather than substituting.
   */
  const estimatedCurrentVdot = anchors.basis.threshold.vdot;

  // COLD-3 · provenance of the anchor this authoring is about to persist,
  // now read off the CANONICAL source mode rather than re-derived from which
  // legacy tier happened to answer. The mapping is the same claim in both
  // vocabularies: an observation the app made is `measured_vdot`, a
  // demonstrated below-table pace is `below_table_anchor`, something the
  // runner typed is `self_reported_race`, and a mileage bucket is
  // `provisional_mileage`.
  //
  // SELFREPORT-1's distinction survives intact and is now STRUCTURAL rather
  // than a boolean the loader had to remember to set: `user_prior` is exactly
  // "the runner told us", and `population_prior` is exactly "we have nothing".
  const seasonAnchorSource: AnchorSource = input.seasonAnchorVdot != null
    ? (input.seasonAnchorSource ?? 'measured_vdot')
    : anchorSourceFromCapacityMode(anchors.basis.threshold.sourceMode);
  const anchorIsProvisional = isProvisionalAnchor(seasonAnchorSource);
  // SELFREPORT-1 · the persisted boolean answers the READER's question ("may I
  // believe this as fitness"), which is the wider one. `anchorIsProvisional`
  // above answers the narrower one and drives what this authoring withholds
  // from the runner. See ./anchor-provenance for why they are not the same.
  const anchorIsUnverified = isUnverifiedAnchor(seasonAnchorSource);

  /**
   * RACEPACE-1 (2026-08-25) · THE ONE PACE THE GOAL IS ACTUALLY ABOUT.
   *
   * The stated goal reaches EXACTLY here and nowhere else in this function.
   * `achievableRaceTarget` answers with the goal when the goal is inside
   * `Research/20` §"SMART criteria"'s achievability band and with the runway's
   * own ceiling when it is not. The STATED goal is untouched either way: it
   * stays on `authored_state.goal_pace_s_per_mi`, and
   * `Design/goal-pursuit-doctrine.md` §14 ("Fitness updates often. Goals do
   * not.") is honoured because nothing here writes a goal.
   *
   * `currentVdot` is the CANONICAL threshold capacity's derived VDOT — the
   * same fitness that priced every training day above, so the race target and
   * the block cannot be read off two different runners (Rule 16). Null when
   * the anchor is provisional, which is `achievableRaceTarget`'s own signal to
   * decline rather than to price a race off an invented fitness.
   */
  const achievableRace = achievableRaceTarget({
    goalSec: input.goalSec,
    currentVdot: anchorIsProvisional ? null : estimatedCurrentVdot,
    raceDistanceMi: input.raceDistanceMi,
    totalWeeks,
  });
  /** What the race row is prescribed at · null when there is no goal to bound. */
  const prescribedRacePaceSec = achievableRace?.paceSPerMi ?? null;

  /**
   * GOAL-SANITY-NAME-1 (2026-09-02) · WAS `goalRealism`, AND THE NAME WAS THE
   * DEFECT.
   *
   * This screen asks one narrow question — "does the typed goal demand a VDOT
   * more than 15% above demonstrated threshold capacity?" — and it shipped
   * under a name that promised the whole one. On 2026-09-02 the owner's block
   * recorded `goal_realism.flag = false` while Goal Feasibility's canonical
   * owner (`lib/race/race-outlook.ts` §7, Constitution §L) returned
   * `unlikely_currently` on a 19:42 gap, at the same instant, for the same
   * runner. Two answers to one question, and only the wrong one had an
   * authoritative name.
   *
   * The predicate is unchanged. The name, the field names and the honesty of
   * the record are. Remaining training time and uncertainty are NOT inputs and
   * never were — see `./goal-vdot-sanity` for what this structurally cannot
   * mean. It still prices nothing: this is the one remaining legitimate
   * `vdotFromRace(goalSec)` at authoring, and no pace, week or goal is written
   * from it.
   */
  const goalVdotSanity = assessGoalVdotSanity({
    goalSec: input.goalSec,
    raceDistanceMi: input.raceDistanceMi,
    // COLD-3 (2026-08-17) · a provisional anchor makes this NOT ASSESSABLE
    // rather than a false all-clear: the guard was once silenced by the
    // fabrication it exists to catch. AUTHORING-CANONICAL-1 · so is a capacity
    // off the Daniels table. Both branches live in the resolver now.
    currentVdot: anchorIsProvisional ? null : estimatedCurrentVdot,
    anchorSource: seasonAnchorSource,
  });
  /** The VDOT the goal demands · still recorded on `pace_blend` as the
   *  baseline the adaptation and projection surfaces read. */
  const goalVdot = goalVdotSanity.goalVdot;

  const composeBuildWeeks = blocks.phases.filter((p) => p.label !== 'TAPER')
    .reduce((s, p) => s + p.weeks, 0);

  /**
   * AUTHORING-CANONICAL-1 · THE PER-WEEK PACE RAMP IS DELETED, NOT MOVED.
   *
   * It read: anchor early weeks to current fitness and blend toward the GOAL's
   * threshold pace by mid-build, gated on a measured-progress fraction with a
   * 15% grace. Three things were wrong with it and all three are Constitution
   * violations rather than tuning problems:
   *
   *   · A stated goal moved a prescribed training pace (§G) — and it could
   *     only ever move it FASTER, because `BRK-1` kept current fitness
   *     whenever the goal was slower.
   *   · At ZERO demonstrated progress the grace still advanced the pace 15% of
   *     the way toward the goal, on the owner's real plan, on 2026-08-31.
   *   · A pace that advanced on the CALENDAR is Rule 1's violation, and
   *     `fbc61eb9` had already deleted an earlier version of exactly that.
   *
   * Capacity does not vary by week index. The block is priced at what the
   * runner can do now; the ADAPTATION engine moves it when evidence says so
   * (Constitution §I), and that is the only thing that may.
   */
  const tPaceForWeek = (_weekIdx: number, _phase: string): number | null => currentT;

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
  /**
   * THESIS-PLAN-1 (2026-09-02) · THE COACHING THESIS, CONSUMED.
   *
   * `thesisAtAuthoring` has reached this function since PHASE-ANSWERS-1 and has
   * only ever been quoted into phase prose — `loadGeneratorInputs`' own comment
   * said so: "the thesis is quoted into prose and prices nothing". The
   * plan-generation brief §3.2.I is the cost: the Thesis named high-intensity
   * evidence as the limiter and the block's first six weeks answered with
   * effort-cued hills, which cannot produce a paced read of it. "Coincidental
   * agreement is not strategy."
   *
   * WHICH FAMILIES CAN EVIDENCE WHICH LIMITER. Read off the catalogue's own
   * `effortOnly` field and `Research/04`'s families, not invented here:
   *
   *   · HIGH_INTENSITY · §6's VO2max sessions and §7's repetitions are the
   *     paced ones. §8's hills are `effortOnly` by the doc's own Pace column
   *     ("5K-10K effort", never a number, "because a flat-ground pace is
   *     unreachable on a 4-6% grade").
   *   · THRESHOLD · §5's threshold family, §12's cutdowns and §10's combos all
   *     carry a T or ST anchor.
   *   · DURABILITY · null. Its evidence is the long run's DURATION and its
   *     late-run behaviour, and the long slot is filled by
   *     `selectLongRunVariant`, not by the quality slots this touches. Asking a
   *     quality slot to evidence durability would be this file inventing a
   *     capacity reading (Constitution §F forbids it).
   *   · UNKNOWN · both threshold and high-intensity. `thesisPlanDirective`'s own
   *     answer for an unnamed limiter is `emphasis: 'establish_evidence'`, and a
   *     block that opens with only effort-cued work establishes none.
   *
   * A read that FAILED is not a limiter (Rule 11): `source === 'read_failed'`
   * yields null here, the same as no thesis at all, and the phase answers
   * already say which of the two happened.
   */
  const thesisSlot: ThesisSlotContext | null = (() => {
    const t = input.thesisAtAuthoring;
    if (!t || t.source !== 'resolved') return null;
    switch (t.primaryLimiter) {
      case 'HIGH_INTENSITY':
        return {
          limiter: 'HIGH_INTENSITY',
          pacedEvidenceFamilies: ['vo2max', 'speed'],
          doNotAddFamilies: null,
          evidenceSlots: ['intervals', 'speed'],
        };
      case 'THRESHOLD':
        return {
          limiter: 'THRESHOLD',
          pacedEvidenceFamilies: ['threshold', 'cutdown', 'combo'],
          doNotAddFamilies: null,
          evidenceSlots: ['threshold', 'tempo'],
        };
      case 'DURABILITY':
        return {
          limiter: 'DURABILITY',
          pacedEvidenceFamilies: null,
          // THESIS-PLAN-2 · `planEmphasisForLimiter('DURABILITY').doNotAdd` is
          // the session family `'intervals'`; these are the CATALOGUE families
          // that fill that slot (`SLOT_FAMILIES.intervals` in
          // `workout-catalogue/select.ts`, minus the ones that also serve
          // threshold). One mapping, read off the slot table rather than typed
          // twice.
          doNotAddFamilies: ['vo2max', 'hills', 'speed'],
          evidenceSlots: null,
        };
      case 'UNKNOWN':
        return {
          limiter: 'UNKNOWN',
          pacedEvidenceFamilies: ['vo2max', 'speed', 'threshold', 'cutdown', 'combo'],
          doNotAddFamilies: null,
          evidenceSlots: ['intervals', 'speed', 'threshold', 'tempo'],
        };
    }
  })();
  /**
   * AUTHORING-CANONICAL-1 · THE I-PACE ELIGIBILITY GATE IS DELETED, NOT MOVED.
   *
   * It read: a 5K/10K/HM goal earns a true Daniels I-pace; a marathon or ultra
   * goal keeps the `T - 18` cruise default. That is a runner's ENTERED RACE
   * deciding what pace their intervals are run at — §G's "goal ≠ current
   * training capacity" in one line. `recompute-paces.ts` deleted it on the
   * flex path on 2026-08-31 with the same sentence; this is authoring
   * catching up, so the two paths stop disagreeing.
   *
   * `resolveHighIntensityCapacity` now answers for every runner,
   * unconditionally, and says out loud how well it knows the number — on most
   * accounts a flagged `vdot_fallback`, because this app still has no direct
   * high-intensity reader. A stated gap beats a silent one (§38).
   */
  const iPaceForWeek = (t: number | null): number | null => (t == null ? null : anchors.intervalSecPerMi);

  /**
   * MPRACE-1 (2026-09-02) · WHICH WEEKS WILL HAVE NO LONG RUN.
   *
   * `embedMidBlockRaces` runs after this whole loop and sets `slot.isLong =
   * wasLong`, so a tune-up race landing on the runner's long-run day REPLACES
   * the long. `layoutWeek` therefore cannot see it, and the §4.4 cadence walk
   * was handing the block's marathon-pace long to a week that would have no
   * long run to hold it. See `racePaceLongThisWeek`'s header for the measured
   * case: a four-week race-specific phase authored ZERO race-pace longs.
   *
   * Derived from the same three facts the embed decides on — the race date,
   * `startMondayISO` and `longRunDow` — and from nothing else, so the two
   * cannot drift apart on anything but a code change. The prediction is
   * CHECKED rather than assumed: `MPRACE.long-slot-prediction-matches-the-embed`
   * recomposes a block with an embedded long-day race and asserts the weeks
   * this set names are exactly the weeks that ship without a training long.
   *
   * The plan's own race week is excluded, matching `dayAt`'s guard — that
   * week's structure belongs to the race-week composer, and the cadence walk
   * never reaches it (TAPER carries no race-pace long).
   */
  /**
   * LONGEVIDENCE-1 · this block's long-run ceiling, resolved ONCE here and
   * handed to every week, so no week can re-derive a different answer to
   * "how far may the long run climb" (Rule 16). Recorded in
   * `authored_state.long_run_ceiling` below with the two readings that
   * produced it, so the answer is auditable rather than inferred.
   */
  const evidenceLongCapMi = evidenceLongCeilingMi({
    demonstratedLongMi: input.demonstratedLongMi ?? null,
    recentLongMi: input.recentLongMi,
    level: input.level ?? null,
    tierPeakLongMi: tierTarget.peakLongMiBand[1],
  });

  const noLongRunWeeks: ReadonlySet<number> = (() => {
    const out = new Set<number>();
    for (const r of input.midBlockRaces ?? []) {
      if (!r?.date || !(r.distanceMi > 0)) continue;
      if (r.date >= input.raceDateISO) continue;
      const off = daysBetween(input.startMondayISO, r.date);
      if (off < 0 || off >= totalWeeks * 7) continue;
      const wi = Math.floor(off / 7);
      if (wi === totalWeeks - 1) continue;                  // the plan's own race week
      const startDow = new Date(input.startMondayISO + 'T12:00:00Z').getUTCDay();
      if (((startDow + off) % 7) === input.longRunDow) out.add(wi);
    }
    return out;
  })();

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
    /**
     * AUTHORING-CANONICAL-1 · MARATHON PACE IS A CAPACITY, NOT A GOAL.
     *
     * `resolveMarathonPace` used to take the runner's stated goal pace and
     * return it whenever it happened to land inside the marathon zone —
     * `spec-builder.ts:1160-1188` states the problem in its own words: that is
     * "the goal reaching a TRAINING pace, which Constitution §G forbids
     * outright", and when the goal was refused the fallback was a FLAT `T+18`
     * population offset, "one formula for every runner".
     *
     * `anchors.marathonSecPerMi` is neither. It is threshold capacity carried
     * to 26.2 through THIS RUNNER'S OWN fitted Riegel exponent
     * (`resolveDurability`), and it is the single largest divergence the
     * 2026-09-01 shadow compare measured — on the owner's block it moves every
     * marathon-pace day from 7:22/mi to 7:43/mi. The canonical number is
     * SLOWER, and it is the honest one.
     *
     * MPLABEL-1's flag survives and is now always false at authoring: no
     * marathon-pace session is ever priced at the goal, so no note may name it
     * as the goal's pace.
     */
    const weekMp = weekT != null && weekT > 0
      ? { paceSPerMi: anchors.marathonSecPerMi, source: 'current_fitness' as const }
      : null;
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
      spikeAnchorLongMi: input.spikeAnchorLongMi,
      recentQualityDistanceMi: input.recentQualityDistanceMi,
      tierTarget,
      trainingDaysPerWeek: input.trainingDaysPerWeek,
      cutbackEveryN,  // #13 · same cadence as volumeCurve's deload mask
      noLongRunWeeks, // MPRACE-1 · weeks whose long-run day is a tune-up race
      evidenceLongCapMi, // LONGEVIDENCE-1 · his own long runs, not the tier label
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
      /* AUTHORING-CANONICAL-1 · DOCTRINE-3's long-run absolute-TIME cap, and
       * the ONE place this migration deliberately does NOT move onto the
       * prescription layer's number.
       *
       * The literal answer is `anchors.easyCeilingSecPerMi +
       * EASY_BAND_WIDTH_S` — the slow edge of the band the rows actually
       * carry — and it was tried. It is wrong to ship inside a wiring pass,
       * for a reason worth writing down: `resolveCapacityPrescription` widens
       * an easy CEILING by an uncertainty pad, so a LOW-CONFIDENCE runner gets
       * a slower assumed pace, and a slower assumed pace through a
       * minutes-to-miles conversion CUTS THEIR LONG RUN. Measured on the
       * `_audit_periodization` David-class fixture: peak long 22.5 mi -> 21
       * mi, and 17 -> 16 on the cutback. That is a volume reduction caused by
       * the engine being unsure, arriving through a channel nobody designed —
       * exactly the asymmetry CLAUDE.md's hero statement warns about ("a coach
       * whose only lever is do less").
       *
       * So the cap stays on the CAPACITY band's slow edge, which is
       * byte-identical to what the legacy path used for every runner, and the
       * decision about whether a confidence pad should be allowed to shorten a
       * long run belongs to whoever owns DOCTRINE-3 rather than to this pass.
       * `easy_pace_s_per_mi` below stamps the SAME number, so the plan still
       * reports one easy pace and not two (Rule 16). */
      easyPaceSecPerMi: currentT + EASY_BAND_SLOW_OFFSET_SEC,
      // PROGRESSION-1 · the overload trajectory, stepped once per week in
      // ascending order. The paces are the ones persistPlan will pace the
      // session at, so the shape's at-pace caps are computed against the pace
      // the runner is actually asked to hold.
      trajectory,
      weekTPaceSec: weekT,
      weekIPaceSec: iPaceForWeek(weekT),
      // ZONE-R-1 · resolved above, so the pace the selector prices an MP
      // session at is the pace `buildWorkoutSpec` will build it at.
      weekMpPaceSec: weekMp?.paceSPerMi ?? null,
      // MPLABEL-1 · the decision `resolveMarathonPace` just made, carried
      // rather than discarded. `layoutWeek` writes the notes that name this
      // pace; without the flag it named the goal's pace over a session that had
      // refused it. Null when there is no MP work in play at all.
      weekMpAtGoalPace: weekMp ? false : null,
      // VOCAB-CATALOGUE-1 · the plan's running record of which of
      // Research/04's named workouts it has already authored. Stepped in
      // ascending week order, the same contract as `trajectory`, so the
      // selector's least-recently-used rotation and its per-cycle caps see the
      // whole block rather than one week.
      catalogueHistory,
      level: input.level,
      // DOWNHILL-2 · the same signal `applyCourseGuidance` gates its note on,
      // read here so the sessions and the note cannot disagree about whether
      // this is a descending race.
      courseIsNetDownhill:
        input.courseTerrain?.shape === 'net_downhill' && input.courseTerrain.trusted === true,
      // THESIS-PLAN-1 · the Coaching Thesis, finally CONSUMED rather than only
      // quoted. Resolved once for the block, above.
      thesisSlot,
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

  // CUTBACK-LONG-1 · the cutback week's long run drops per the doc's own
  // per-tier band. Before the race embed on purpose — see the function's
  // doctrine block.
  applyCutbackLongDrop(weeks, vols);

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
  // COMBINED-STRESS-1 · the typed placement decisions the embed makes, kept
  // so the block records them (brief §5.5) instead of only showing the result.
  const placementCompromises: PlacementRecord[] = [];
  const embeddedRaces = (input.midBlockRaces && input.midBlockRaces.length > 0)
    ? embedMidBlockRaces(weeks, vols, {
        compromises: placementCompromises,
        startMondayISO: input.startMondayISO,
        raceDateISO: input.raceDateISO,
        midBlockRaces: input.midBlockRaces,
        trainingDaysPerWeek: input.trainingDaysPerWeek,
        // RACEPACE-1 · the same anchor the target race's ceiling is built on,
        // withheld when it is provisional (a mileage-derived VDOT is not
        // evidence, and a ceiling drawn off it would be fiction bounding
        // fiction).
        currentVdot: anchorIsProvisional ? null : estimatedCurrentVdot,
        // RACEROLE-1 · MP for an mp_workout conversion IS the goal pace.
        targetGoalPaceSec: input.goalPaceSec ?? null,
      })
    : [];

  // TRAVEL-1 · after the race embed (a tune-up day must already read as a
  // race so the travel pass leaves it alone), before the run-up guard (which
  // must see the calendar with travel already shaped — a long run this pass
  // relocates into the run-up window still gets eased there). Gated: no
  // windows → byte-identical output.
  const travelShaped = (input.travelWindows && input.travelWindows.length > 0)
    ? shapeTravelWindows(weeks, {
        startMondayISO: input.startMondayISO,
        travelWindows: input.travelWindows,
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
    // WKRESUME-1 · the level the runner was at before this block. Sustained
    // (the rank-3 week), not the peak: the ramp ceiling's reference is meant to
    // be a volume the runner reached REPEATEDLY, which is the same reading
    // `resolveRampBase` already takes of the same series.
    ...(rampEvidence?.sustainedMi ? { rampAnchorMi: rampEvidence.sustainedMi } : {}),
    budgetPeakWeeklyMi: peakWeeklyMi,   // PEAKLOAD-1 · the block's declared peak
    // AUTHORING-CANONICAL-1 · the plan-wide threshold is now the CANONICAL
    // anchor, not `input.tPaceSec` (which was `min(goalT, currentT)` — the
    // goal's own threshold pace whenever the goal was ambitious). One number,
    // resolved once, carried to every reader (Rule 16).
    tPaceSec: currentT,
    paceAnchors: anchors,
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
      // PHASE-ANSWERS-1 · the two authoring facts the phase answers quote that
      // no other key carried: the quality density the runner's preferences
      // seat, and the Coaching Thesis as the owner resolved it at authoring
      // (an explicit null on a pure caller, never an omitted key · Rule 11).
      quality_days_planned: input.qualityDows.length,
      thesis_at_authoring: input.thesisAtAuthoring ?? null,
      t_pace_s_per_mi: input.tPaceSec,
      /**
       * PACE-E-1 · the pace the composer actually SIZED this block's easy days
       * at: the current-fitness T anchor plus `EASY_BAND_SLOW_OFFSET_SEC`, the
       * slow end of the band `spec-builder` emits for an easy run.
       *
       * Recorded because it is a different number from `t_pace_s_per_mi`, which
       * is the GOAL-BLENDED threshold, and anything converting an easy day
       * between miles and minutes needs the one the engine spent. Rule 16 · one
       * quantity, one name: `_coach_sensible.test.ts` priced the easy mile off
       * `t_pace_s_per_mi` and was ~12% fast for a runner whose goal is ahead of
       * his fitness — 8:34/mi against the engine's 9:38/mi on the owner's own
       * CIM authoring — so its forty-minute floor asked for 4.7 mi where
       * doctrine asks for 4.2. Null when no current-fitness anchor resolves,
       * which is the same condition under which `layoutWeek` gets no easy pace
       * and every minute-based bound in it is inert.
       */
      // AUTHORING-CANONICAL-1 · the SAME number the long-run time cap above
      // is evaluated at, deliberately — `_coach_sensible.test.ts` reads this
      // field as "the pace layoutWeek sizes easy days at", and a stamp that
      // reported a different pace than the sizing used would make that gate
      // measure a runner the engine never composed. See the argument beside
      // `easyPaceSecPerMi` for why both stay on the capacity band's slow edge
      // rather than the prescription-padded one.
      //
      // KNOWN, AND ARGUED: for a runner whose easy ceiling came from a DIRECT
      // read this is within a second or two of `anchors.easyCeilingSecPerMi +
      // EASY_BAND_WIDTH_S` (the owner: 540 vs 542), and for a low-confidence
      // runner it is faster, because the prescription layer's uncertainty pad
      // is not spent here.
      easy_pace_s_per_mi: currentT + EASY_BAND_SLOW_OFFSET_SEC,
      /**
       * RULE8-1 · the runner's own demonstrated easy day, as this authoring
       * read it — `easyDayMedianMi` over 28 REPRESENTATIVE days, the reading
       * `easyMileFloor` is set from. Recorded beside the pace it is priced at
       * so a reader (or a gate) does not have to re-derive it and get a
       * different window than the composer used. 0 when the reader refused.
       */
      easy_day_median_mi: input.easyDayMedianMi,
      lthr_bpm: input.lthr,
      // 2026-06-02 · tier classification for downstream consumers
      // (gap-report, projection snapshots, brief).
      goal_tier: tier,
      // GOALVOL-1 · the ceiling this block was authored under, and whether the
      // stated goal reduced it. Three facts, not one (Rule 11): a block where
      // the goal reduced nothing and a block with no goal at all both leave
      // `goal_tier === capacity_tier`, and `load_tier_reduced_by_goal` is what
      // tells them apart. A reader of an old stamp sees the field is absent and
      // knows the seal predates it.
      capacity_tier: capacityTier,
      load_tier_reduced_by_goal: reducedByGoal,
      tier_peak_weekly_band: tierTarget.peakWeeklyMileageBand,
      tier_peak_long_band: tierTarget.peakLongMiBand,
      /**
       * LONGEVIDENCE-1 · WHY THE LONGEST RUN IS THE DISTANCE IT IS.
       *
       * The owner's fourth question, answered by the engine and stored, not
       * written into a report. Both readings are kept, not just the winner, so
       * a reader can see which one bound and by how much — and so a band that
       * is not binding cannot be mistaken for the reason.
       */
      long_run_ceiling: {
        ceilingMi: evidenceLongCapMi,
        demonstratedLongMi: input.demonstratedLongMi ?? null,
        recentNormalLongMi: input.recentLongMi,
        cycleGrowth: input.level ? CYCLE_GROWTH_CEILING[input.level] : null,
        tierBandTopMi: tierTarget.peakLongMiBand[1],
        boundBy: evidenceLongCapMi == null
          ? 'tier_band_no_evidence'
          : evidenceLongCapMi >= tierTarget.peakLongMiBand[1]
            ? 'tier_band'
            : (input.demonstratedLongMi ?? 0) >= (input.level && CYCLE_GROWTH_CEILING[input.level]
              ? input.recentLongMi * (CYCLE_GROWTH_CEILING[input.level] as number) : 0)
              ? 'demonstrated_long_run'
              : 'cycle_growth_allowance',
        citation: 'Research/00a-distance-running-training.md §"Volume progression rules"',
      },
      // 2026-06-03 · Rule 11 · horizon raise. Null when no future race
      // raises the long-run cap above the current tier's. Drives the
      // chip on the plan UI ("LONG-RUN CAP · 22mi · setting up CIM").
      horizon_raise: horizonRaise,
      // 2026-08-17 · MIDRACE-1 · which B/C races were embedded as tune-up
      // race days, by plan week. Empty array when none. Drives the plan
      // UI chip + the brief's tune-up framing.
      embedded_races: embeddedRaces,
      // COMBINED-STRESS-1 (2026-09-02) · every typed placement decision the
      // race embed made about a race and the long run that follows it —
      // including the ones where the answer was "this stands, and here is the
      // row that says so". Absent when no race sat near a long run. Brief
      // §5.5's named compromises; see lib/plan/combined-stress.ts.
      ...(placementCompromises.length > 0 ? { placement_compromises: placementCompromises } : {}),
      // RACE-RUNUP-1 · the dates the goal-race run-up guard rewrote, so a
      // block that had a long run inside race week says so on its own record
      // rather than only in a diff. Absent when it changed nothing, which is
      // every already-well-formed block.
      ...(runUpChanged.length > 0 ? { race_runup_eased: runUpChanged } : {}),
      // TRAVEL-1 · which days the travel pass shaped and how, plus the
      // windows it shaped them from, so a week that looks unusual says why on
      // the plan's own record. Absent when no window touched the block.
      ...(travelShaped.length > 0
        ? { travel_shaped: travelShaped, travel_windows: input.travelWindows }
        : {}),
      // 2026-06-03 · Rule 10 · transparency envelope so the runner can
      // audit which signals drove their plan. Surfaces in /plan brief
      // as "plan built from your last 28 days." Cite: §Rule 10.
      derived_from: {
        recentWeeklyMi: input.recentWeeklyMi,
        recentLongMi: input.recentLongMi,
        spikeAnchorLongMi: input.spikeAnchorLongMi,
        recentQualityPerWeek: input.recentQualityPerWeek ?? null,
        recentQualityDistanceMi: input.recentQualityDistanceMi ?? null,
        bestRecentVdot: input.bestRecentVdot ?? null,
        easyDayMedianMi: input.easyDayMedianMi,
        tsbAtStart: input.tsbAtStart ?? null,
      },
      /**
       * GOAL-SANITY-NAME-1 · the key is `goal_vdot_sanity`, not
       * `goal_realism`. It names the predicate it holds. `lib/plan/
       * goal-vdot-sanity.ts` owns the question; Constitution §L's Goal
       * Feasibility owner is `lib/race/race-outlook.ts` §7 and is a different
       * question with a different answer. `_goal_vdot_sanity_gate.test.ts`
       * keeps the two apart, and keeps the old name from coming back.
       */
      goal_vdot_sanity: goalVdotSanity,
      /**
       * RACEPACE-1 · what this authoring decided the block may PRESCRIBE as a
       * race-relative target, and why.
       *
       * Written alongside — never instead of — `goal_pace_s_per_mi` above.
       * Rule 1: `basis_modelled` is true whenever `pace_s_per_mi` came out of
       * the gain model rather than out of the runner's own stated goal, and no
       * surface may render a modelled target as a measured capability. The wire
       * already has the vocabulary for this (`V5Number { text, modelled }`), so
       * a reader has somewhere honest to put it.
       *
       * `optimism_fraction` is the raw distance between ambition and runway. It
       * is what a §8 feasibility read ("Supported / Reach / Stretch / Unlikely /
       * Unsupported") should be computed from, rather than from the older
       * `goal_vdot_sanity.beyondSanityBand` (formerly `goal_realism.flag`),
       * which is a boolean struck at a 15% VDOT band and cannot express four
       * of those five states.
       */
      /*
       * B2 (2026-09-02) · PROVENANCE ONLY. This blob is a record of what the
       * runway said when the block was authored. It is NOT the prescribed race
       * target and no reader may resolve a row against it — that question has
       * one owner, `lib/race/race-outlook.ts`'s `execution`, which writes
       * `plan_workouts.pace_target_s_per_mi` and `workout_spec.race_execution`
       * through `refreshRaceRowsForPlan`.
       *
       * It was read back as the authoring seed until 2026-09-02, which is how
       * the owner's plan came to hold 436 s/mi here and 443 s/mi on the row.
       *
       * Rule 10 · a persisted derived value carries its anchor. `anchor_vdot`
       * is the threshold capacity this was computed from — so a reader can see
       * that a `ceiling_vdot` of 47.1 was struck against a fitness that has
       * since moved to 47.8, instead of reading a stale number as current.
       * `authority: 'provenance_only'` is the posture, declared rather than
       * assumed, and `lib/race/_race_target_ownership.test.ts` is what holds it.
       *
       * The rule's "at" is `training_plans.authored_iso`, on the same row. A
       * `new Date()` here would have been a second timestamp for one moment
       * AND non-deterministic — it broke `_travel_invariants`' byte-identical
       * composition gate on the first run, which is the gate doing its job.
       */
      prescribed_race_pace: achievableRace
        ? {
            authority: 'provenance_only',
            anchor_vdot: estimatedCurrentVdot ?? null,
            pace_s_per_mi: achievableRace.paceSPerMi,
            target_sec: achievableRace.targetSec,
            source: achievableRace.source,
            goal_sec: achievableRace.goalSec,
            goal_pace_s_per_mi: input.goalPaceSec,
            ceiling_sec: achievableRace.ceilingSec,
            ceiling_vdot: achievableRace.ceilingVdot,
            optimism_fraction: achievableRace.optimismFraction,
            basis_modelled: achievableRace.basisModelled,
          }
        : null,
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
        // AUTHORING-CANONICAL-1 · written as an explicit null rather than
        // dropped, so a reader of an OLD stamp can still tell "the gate ran"
        // from "there is no gate any more" — the same Rule 11 distinction
        // `recompute-paces.ts` kept when it deleted its half on 2026-08-31.
        measured_progress_fraction: null,
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
  /** AUTHORING-CANONICAL-1 · the six canonical prices, as on
   *  `ComposePlanInput`. Absent → `syntheticPaceAnchors` off this input's own
   *  evidence, which is what every pure caller gets. */
  paceAnchors?: PrescribedPaceAnchors | null;
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

/* ── MAINT-LENGTH-1 (2026-08-28) · the hold block has a ceiling now ─────────
 *
 * `Research/22` §6 Base Building / Off-Season publishes `Duration | 8-16
 * weeks`, and DOCTRINE-MAINTFREQ-1 already ruled that §6 governs this mode
 * (§7 Maintenance's own row — open-ended, 4-15 wk realistically, on the basis
 * that ~2/3 of volume holds VO2max for ~15 weeks — points the same way). A
 * single authored hold block is therefore capped at 16 weeks. The runner a
 * year out is not stranded at week sixteen: the `plan_elapsed` branch of
 * /api/cron/plan-drift (2026-08-28) re-authors a race-anchored plan that runs
 * out of days while its race is still ahead, so a capped hold elapses into
 * the next block toward the race — another hold if the build window is still
 * closed, race-prep once it opens. Bound by MAINTENANCE.hold-block-length in
 * the doctrine registry, which reads the ceiling out of the doc's own
 * Duration row. */
/** `Research/22` §6 · "Duration | 8-16 weeks" — the top of the band. */
export const HOLD_BLOCK_MAX_WEEKS = 16;

/* ── HOLD-PROGRESS-1 (2026-08-28) · a long hold climbs gently, not flat ─────
 *
 * The owner's ruling on the question MAINT-LENGTH-1 left open ("when in
 * doubt we should also try for progress"): a hold long enough to be the
 * block `Research/22` §6 describes PROGRESSES weekly volume gently across
 * the block instead of holding one number with a step-down every fourth
 * week. The doctrine gives both shapes and its own Duration rows draw the
 * line between them:
 *
 *   · §6 Base Building / Off-Season — "Duration | 8-16 weeks", a "Peak
 *     weekly volume" row (a block with a peak is a block that climbs to
 *     one), and a Phases row that is progression outright: "Reverse
 *     periodization is fine: continuous E → introduce strides → introduce
 *     fartlek → introduce LT".
 *   · §7 Maintenance — "holding fitness without progression", open-ended.
 *
 * So the threshold is §6's own floor: a hold of 8+ weeks is the §6 block
 * (DOCTRINE-MAINTFREQ-1 already ruled §6 governs this mode) and climbs; a
 * shorter hold has nothing to progress and stays flat — §7's shape.
 *
 * How much it climbs comes from `Research/00a` §"Volume progression rules":
 * "Year-on-year base growth | 5–15% per training cycle for trained
 * athletes". The CONSERVATIVE end of that band — 5% — because a hold is
 * maintenance-shaped base building, not a build: the same reading that put
 * GENERAL_RAMP_CEILING and CYCLE_GROWTH_CEILING at the band's TOP for a
 * race-prep block puts a between-blocks hold at its BOTTOM, and the
 * progress-is-the-guiding-light principle asks only that current fitness be
 * a floor, not that every block ramp like a build.
 *
 * The climb is `volumeCurve` itself with the peak target overridden to
 * base × HOLD_CYCLE_GROWTH — not a parallel ramp — so every existing
 * guardrail binds unchanged: the geometric climb under GENERAL_RAMP_CEILING
 * (trivially, at ~1% per week), the every-4th-week 0.80 cutback, the
 * post-deload re-entry cap, and the monotonic floor. The long run does NOT
 * climb with the week: it stays on the §7 sizing (≤110% of the recent long
 * per RAMP.single-session-spike, ≤30% of the week), so the growth lands on
 * the easy days and the single-session spike rule cannot be approached.
 * Quality stays 1/week (MAINTENANCE_BY_TIER); the threshold dose already
 * sizes itself off the week's own T budget (`weeklyDoseBudgetMi`), so it
 * steps with the week inside Daniels' cap and no quality days are added.
 * The overload trajectory does not engage here — the non-race composers
 * have no build to progress through (see ComposePlanResult.progression).
 *
 * Bound by MAINTENANCE.long-hold-progresses-gently in the doctrine
 * registry, which reads both the band and the threshold out of the docs. */
/** `Research/22` §6 · "Duration | 8-16 weeks" — the BOTTOM of the band. A hold
 *  at least this long is the §6 base-building block and progresses; a shorter
 *  hold is §7's flat shape. */
export const HOLD_PROGRESSION_MIN_WEEKS = 8;
/** `Research/00a` §"Volume progression rules" · "Year-on-year base growth |
 *  5–15% per training cycle for trained athletes" — the conservative end (5%),
 *  applied across the whole hold block as its peak target multiplier. */
export const HOLD_CYCLE_GROWTH = 1.05;

/**
 * Compose a 4-week maintenance plan. Single phase 'MAINTENANCE'. The
 * graduate cron regenerates this every 4 weeks until the next race
 * enters its build window, at which point it auto-transitions to
 * race-prep. Volume + long held at maintenance percentages of the
 * runner's recent peak; quality drops to 1/week; intervals removed.
 */
export function composeMaintenancePlan(input: ComposeNonRaceInput): ComposePlanResult {
  /* AUTHORING-CANONICAL-1 (2026-09-01) · THE SIX CANONICAL PRICES.
   *
   * This composer used to price its threshold day off `input.tPaceSec` — which
   * `loadGeneratorInputs` computed as `min(tPaceFromGoal(goal), currentT)`, so
   * for an ambitious goal it WAS the goal's threshold pace — and its easy band
   * off `tPaceFromVdot(conservativeVdotFromMileage(0))`, the flat VDOT-30
   * floor, whenever that was null. Both are gone; see `composePlan`'s own
   * anchor block for the full argument.
   */
  const maintAnchorsRead = input.paceAnchors != null
    ? ({ ok: true, anchors: input.paceAnchors } as const)
    : syntheticPaceAnchors({
        bestRecentVdot: input.bestRecentVdot ?? null,
        recentWeeklyMi: input.recentWeeklyMi,
      });
  if (!maintAnchorsRead.ok) {
    throw new Error(
      '[composeMaintenancePlan] REFUSED · pace anchors ' + maintAnchorsRead.reason + ' · ' + maintAnchorsRead.detail
      + ' · no plan authored (Rule 11 · no fallback to the VDOT cascade)',
    );
  }
  const maintAnchors = maintAnchorsRead.anchors;

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
  // HOLD-PROGRESS-1 · the next race's distance category, when it resolves and
  // the hold is real (weeksToRace > buildWindow). Null on the rolling 4-week
  // default and on an unresolvable calendar row — both of which stay flat.
  let holdCat: DistCategory | null = null;
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
      // MAINT-LENGTH-1 (2026-08-28) · capped at the doctrine ceiling. This
      // line was open-ended for two years of runway — a runner who entered a
      // half fifty-three weeks out was authored a FORTY-ONE-WEEK hold — and
      // was argued rather than closed while nothing re-authored a
      // race-anchored hold that ran out. Both halves are now in place:
      // `plan_elapsed` in /api/cron/plan-drift re-authors an elapsed
      // race-anchored plan whose race is still ahead (2026-08-28), and the
      // owner approved sizing the block to `Research/22` §6's Duration
      // ceiling (HOLD_BLOCK_MAX_WEEKS, see its header). So the far-out runner
      // gets a 16-week hold, and when it elapses the cron authors the next
      // block toward the race. The registry's `no-ceiling-on-a-long-hold`
      // exemption is deleted; MAINTENANCE.hold-block-length now checks the
      // cap against the doc's own row.
      //
      // HOLD-PROGRESS-1 (2026-08-28) · the remaining ruling this comment used
      // to name as open is now MADE: the owner ruled a long hold PROGRESSES
      // ("when in doubt we should also try for progress"). A hold of
      // HOLD_PROGRESSION_MIN_WEEKS+ climbs gently to targetWeekly ×
      // HOLD_CYCLE_GROWTH through `volumeCurve` (cutbacks preserved); a
      // shorter hold stays §7-flat. See the header on HOLD_CYCLE_GROWTH.
      //
      // Cite: Research/22-plan-templates.md §"Base Building / Off-Season Plan"
      //       — Duration 8-16 weeks, 80-100% of last cycle's peak
      // Cite: Research/22-plan-templates.md §"Maintenance Plan" — Duration
      //       open-ended, 4-15 wk realistically; ~15 weeks of VO2max hold
      TOTAL_WEEKS = Math.max(1, Math.min(HOLD_BLOCK_MAX_WEEKS, Math.floor(weeksToRace - buildWindow)));
      holdCat = buildCat;
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

  // HOLD-PROGRESS-1 (2026-08-28) · a hold long enough to be Research/22 §6's
  // base-building block climbs gently to targetWeekly × HOLD_CYCLE_GROWTH,
  // through the SAME curve race-prep ramps on (geometric climb under the ramp
  // ceiling, every-4th-week 0.80 cutback, post-deload re-entry cap) with only
  // the peak target overridden. `blocks` carries a single MAINTENANCE phase
  // and no TAPER, so every week is a "build" week to the curve; its deload
  // mask ((i+1) % cutbackCadence(undefined)=4 === 0, i>0 → weeks 4, 8, 12, 16)
  // is the same set maintenanceWeek's own isCutback marks, so the week's
  // volume and its long-run step-down land on the same weeks. Shorter holds,
  // cold starts and unresolvable-race holds stay flat (§7's shape) — null
  // here means "flat", exactly the pre-ruling behavior. See the header on
  // HOLD_CYCLE_GROWTH for the full doctrine derivation.
  const holdPeakTarget = Math.round(targetWeekly * HOLD_CYCLE_GROWTH);
  const holdVols: number[] | null = (
    TOTAL_WEEKS >= HOLD_PROGRESSION_MIN_WEEKS
    && holdCat != null
    && !noVolumeSignal
    && targetWeekly > 0
  )
    ? volumeCurve(targetWeekly, blocks, input.level, TIER_TARGETS[holdCat][input.tier], holdCat, undefined, null, holdPeakTarget)
    : null;
  /** Slow end of the engine's own easy band — the pace the runner is actually
   *  permitted to run at, so the minutes→miles conversion cannot imply a
   *  faster one. Falls back to the bottom of the Daniels table when the runner
   *  has no goal to derive a threshold pace from, which is the usual day-one
   *  case. */
  // AUTHORING-CANONICAL-1 · the easy ceiling is `resolveEasyCeiling`'s answer,
  // not a fixed +120 s/mi off a threshold scalar and not
  // `conservativeVdotFromMileage(0)` (the flat VDOT-30 floor, which this path
  // reached for on every cold start). `EASY_BAND_SLOW_OFFSET_SEC` off the
  // canonical CEILING is the slow edge of the runner's own band, which is what
  // a minutes→miles conversion must never run faster than.
  const coldStartEasySecPerMi = maintAnchors.easyCeilingSecPerMi + EASY_BAND_SLOW_OFFSET_SEC;

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
    // HOLD-PROGRESS-1 · a progressing hold reads its week off the curve (whose
    // deloads land on the same weeks isCutback marks); a flat hold keeps the
    // one-number-with-step-down shape.
    const wkWeeklyBase = holdVols != null
      ? holdVols[weekIdx]
      : (isCutback ? Math.round(targetWeekly * 0.80) : targetWeekly);
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
      // HOLD-PROGRESS-1 · a progressing hold's weeklyMi comes off the same
      // curve maintenanceWeek(wi) sizes its days from, so the displayed number
      // and the realized week agree on every cutback (the flat arm's wi === 3
      // only ever mattered for TOTAL_WEEKS ≤ 7, where it is the only cutback).
      weeklyMi: holdVols != null
        ? holdVols[wi]
        : (wi === 3 ? Math.round(targetWeekly * 0.80) : targetWeekly),
      days: maintenanceWeek(wi),
      isRaceWeek: false,
      // AUTHORING-CANONICAL-1 · the canonical threshold, not the goal-blended
      // plan-wide scalar this used to carry.
      tPaceSec: maintAnchors.thresholdSecPerMi,
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
    tPaceSec: maintAnchors.thresholdSecPerMi,
    paceAnchors: maintAnchors,
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
      // HOLD-PROGRESS-1 · which shape this hold ran, and where a progressing
      // one is climbing to, so the audit surface reads the ruling off the
      // plan rather than re-deriving it.
      hold_progression: holdVols != null
        ? { growth_factor: HOLD_CYCLE_GROWTH, peak_target_mi: holdPeakTarget }
        : null,
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
  /* AUTHORING-CANONICAL-1 (2026-09-01) · THE SIX CANONICAL PRICES.
   *
   * This composer used to price its threshold day off `input.tPaceSec` — which
   * `loadGeneratorInputs` computed as `min(tPaceFromGoal(goal), currentT)`, so
   * for an ambitious goal it WAS the goal's threshold pace — and its easy band
   * off `tPaceFromVdot(conservativeVdotFromMileage(0))`, the flat VDOT-30
   * floor, whenever that was null. Both are gone; see `composePlan`'s own
   * anchor block for the full argument.
   */
  const recAnchorsRead = input.paceAnchors != null
    ? ({ ok: true, anchors: input.paceAnchors } as const)
    : syntheticPaceAnchors({
        bestRecentVdot: input.bestRecentVdot ?? null,
        recentWeeklyMi: input.recentWeeklyMi,
      });
  if (!recAnchorsRead.ok) {
    throw new Error(
      '[composeRecoveryPlan] REFUSED · pace anchors ' + recAnchorsRead.reason + ' · ' + recAnchorsRead.detail
      + ' · no plan authored (Rule 11 · no fallback to the VDOT cascade)',
    );
  }
  const recAnchors = recAnchorsRead.anchors;

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
  // RECOVERY-HALF-DURATION-1 (2026-08-28) · the pace the half's minute→mile
  // conversion runs at. Same convention as COLD-START-1: the SLOW end of the
  // runner's own easy band (`EASY_BAND_SLOW_OFFSET_SEC`), so the conversion
  // can never imply a pace faster than the runner is permitted to run.
  // `input.tPaceSec` is null only when a runner with no resolved threshold
  // pace somehow reaches recovery mode (it always follows a finished race, so
  // this is defensive) — falls back to a conservative VDOT read off recent
  // mileage, same fallback `composeMaintenancePlan`'s cold-start path uses.
  // AUTHORING-CANONICAL-1 · see `composeMaintenancePlan`'s twin. The canonical
  // easy ceiling replaces both the goal-blended `input.tPaceSec` and the
  // `conservativeVdotFromMileage` fallback beneath it.
  const recoveryEasySecPerMi = recAnchors.easyCeilingSecPerMi + EASY_BAND_SLOW_OFFSET_SEC;
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
    // RECOVERY-HALF-DURATION-1 (2026-08-28) · the half sizes off its own
    // day-by-day minutes (RECOVERY_HALF_WEEKLY_MINUTES), not peakAnchor * pct
    // — see the constant's citation in goal-tiers.ts for why. Every other
    // category is unchanged: marathon/ultra's table genuinely is "Volume vs.
    // peak" and 5K/10K have no comparable doctrine table to convert from.
    const wkWeekly = (lastCat === 'hm' && recoveryEasySecPerMi != null)
      ? (() => {
          const band = RECOVERY_HALF_WEEKLY_MINUTES[blockWeekIdx]
            ?? RECOVERY_HALF_WEEKLY_MINUTES[RECOVERY_HALF_WEEKLY_MINUTES.length - 1];
          const midMin = (band[0] + band[1]) / 2;
          return Math.round((midMin * 60) / recoveryEasySecPerMi);
        })()
      : Math.round(peakAnchor * wkPct);
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
      // AUTHORING-CANONICAL-1 · was a literal null, which made persistPlan fall
      // back to the plan-wide scalar for every recovery row. The canonical
      // threshold is what the block is priced at; recovery rows carry no
      // quality anyway, and the easy bands read the anchors either way.
      tPaceSec: recAnchors.thresholdSecPerMi,
      blockWeekIdx,
    });
  }

  return {
    weeks,
    blocks,
    totalWeeks: weeks.length,
    vols: weeks.map((w) => w.weeklyMi),
    tPaceSec: recAnchors.thresholdSecPerMi,
    paceAnchors: recAnchors,
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
  // The plan(s) just archived may have had their own still-pending
  // plan_proposals (a goal-renegotiation card, a drift proposal awaiting
  // accept/dismiss) computed against a plan that no longer exists. Same
  // transaction, so a proposal can never be read as live against an
  // already-archived plan.
  const { supersedeProposalsForArchivedPlans } = await import('./proposals-state');
  await supersedeProposalsForArchivedPlans(client, userId);
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
  /** The block's threshold anchor. Null → no spec (the caller writes nulls). */
  weekT: number | null,
  args: {
    lthr: number | null;
    maxHr: number | null;
    goalPaceSec: number | null;
    easyAnchorTSec: number | null;
    belowTableAnchor?: BelowTableAnchor | null;
    /** RACEPACE-1 · the achievable race target for the PLAN's own race day.
     *  Null → the race branch reads `goalPaceSec`, byte-identical to before.
     *  Deliberately not applied to an embedded mid-block tune-up: that row
     *  carries its OWN goal (`raceGoalPaceSec`) at its OWN distance, and this
     *  ceiling was computed for the goal race at the goal distance. */
    prescribedRacePaceSec?: number | null;
    /**
     * AUTHORING-CANONICAL-1 · THE SIX CANONICAL PRICES, threaded to
     * `buildWorkoutSpec` so every derived pace below is a READ rather than a
     * fixed offset off one threshold scalar. Exactly the wiring
     * `recompute-paces.ts` has used since PRESCRIPTION-WIRE-1.
     *
     * NULL is not a fallback to the cascade — it is the shape a caller that
     * genuinely has no anchors (an adapt-time restore of a single row) passes,
     * and `buildWorkoutSpec` then behaves as it did before that argument
     * existed. Every AUTHORING caller supplies them.
     */
    anchors?: PrescribedPaceAnchors | null;
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
  // AUTHORING-CANONICAL-1 · the I-pace eligibility gate is DELETED, not moved
  // — a runner's entered race distance may not decide what pace their
  // intervals are run at (Constitution §G). `anchors.intervalSecPerMi` is
  // `resolveHighIntensityCapacity`'s answer, unconditionally, for every
  // runner. The legacy VDOT round trip survives only for a caller with no
  // anchors at all.
  const iPaceSec = args.anchors != null
    ? args.anchors.intervalSecPerMi
    : (args.belowTableAnchor
        ? iPaceFromAnchorPace(args.belowTableAnchor.anchor)
        : iPaceFromVdot(vdotFromTpace(weekT)));
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
    // RACEPACE-1 · only the plan's OWN race day is bounded by the ceiling
    // computed for this goal at this distance. An embedded tune-up
    // (`raceGoalPaceSec` set) is a different race and keeps its own target.
    d.raceGoalPaceSec !== undefined ? null : (args.prescribedRacePaceSec ?? null),
    // AUTHORING-CANONICAL-1 · the six canonical anchors. This is the argument
    // that makes every derived pace inside `buildWorkoutSpec` a READ of the
    // service that owns it rather than an offset off one scalar.
    args.anchors ?? null,
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
    belowTableAnchor?: BelowTableAnchor | null;
    /** RACEPACE-1 · see `specForComposedDay`. */
    prescribedRacePaceSec?: number | null;
    /** AUTHORING-CANONICAL-1 · see `specForComposedDay`. */
    anchors?: PrescribedPaceAnchors | null;
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
  //
  // PROGRESSION-DOSE-1 (2026-08-30) · `d.progressionDose` is the fallback, and
  // on this runner's block it is the ONLY source for 13 of 24 quality slots.
  // `workShape` is set only where the trajectory also supplied the LABEL, which
  // excludes every session the §15 catalogue filled — 21 of his 24. The dose
  // stepped for those anyway; it simply had nowhere to be written. Preferring
  // `workShape` when both exist keeps the byte-for-byte output of a generic
  // slot unchanged, since the two then describe the same rung.
  const persistedDose = d.workShape
    ? { shape: d.workShape, lever: d.progressionLever ?? null, zone: d.challengeZone ?? null }
    : d.progressionDose ?? null;
  if (workoutSpec && persistedDose) {
    workoutSpec = {
      ...workoutSpec,
      ...progressionSpecFields({
        shape: persistedDose.shape,
        lever: persistedDose.lever,
        zone: persistedDose.zone,
        repsOverride: Number((workoutSpec as Record<string, unknown>).rep_count ?? 0) || null,
      }),
    };
  }
  // RATIONALE-PERSIST-1 (2026-09-01) · the catalogue selector's own "why this
  // one" line, carried into the row the same way PROGRESSION-PERSIST-1 above
  // carries the trajectory's shape: after the distance cap, so it describes
  // the session actually prescribed rather than the one composed before
  // `capSpecToDistance` may have trimmed it.
  if (workoutSpec && d.catalogueRationale) {
    workoutSpec = { ...workoutSpec, [RATIONALE_SPEC_KEY]: d.catalogueRationale };
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
  /**
   * RACEPACE-1 (2026-08-25) · what the race-day row is actually prescribed at.
   *
   * `goalPaceSec` above is the AMBITION and stays exactly what the runner
   * typed. This is the ambition bounded by what the runway supports
   * (`lib/training/achievable-target.ts`), and it is the number the race row,
   * its ±5 s/mi band and its mid-race abort rule are built from. Read back off
   * `authoredState.prescribed_race_pace` so the persisted plan and the audit
   * trail can never say two different things. Null → byte-identical to before.
   */
  prescribedRacePaceSec?: number | null;
  /** 2026-06-23 · PACE-E-1 · current-fitness T-pace anchor for EASY/long/recovery bands. Those are
   *  EFFORT runs and must track CURRENT fitness, not the goal-blended weekT — otherwise a sub-fitness
   *  goal makes "easy" ramp faster every week (cold-start: easy can pass current MP). null → falls
   *  back to weekT (byte-identical; at-goal runners have easyAnchorT == weekT). */
  easyAnchorTSec: number | null;
  /**
   * AUTHORING-CANONICAL-1 (2026-09-01) · THE SIX CANONICAL PRICES, carried
   * from `composePlan` to the row.
   *
   * This REPLACED `goalIPaceEligible`, which gated true Daniels I-pace on the
   * runner's entered race distance — a goal deciding a training pace, which
   * Constitution §G forbids and which `recompute-paces.ts` deleted on the flex
   * path on 2026-08-31. High-intensity capacity is a property of the runner:
   * a marathoner's 800s are run at their own 3-5K effort, not at a slower pace
   * because of what is on their calendar.
   */
  anchors: PrescribedPaceAnchors | null;
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
  /** BACKDATE-1 (2026-08-30) · the runner's own calendar day, from
   *  `runnerToday`. The regen path keeps week 0's already-elapsed days so
   *  Rule 15 can re-seal the ones that were RUN; this is what stops it from
   *  authoring a brand-new prescription onto the ones that were not.
   *  See `persistsComposedDay`. */
  todayISO: string;
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
      // PHASE-ANSWERS-1 · `rationale` carries the phase's own "what are we
      // developing" sentence, about THIS runner, in place of the one fixed
      // string every block used to share. The full structured set lives on
      // `authored_state.phase_answers` (no DDL · additive jsonb key).
      params.push(phaseId, planId, ph.label, cursor, cursor + ph.weeks - 1, ph.answers?.developing ?? ph.rationale, ph.citation);
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
      // 2026-06-03 · Rule 15 · seal completed days. If the prior
      // active plan had a row for this date AND a completed run
      // exists, OVERRIDE the freshly-composed prescription with the
      // prior's. The runner trained against the prior prescription ·
      // changing it after-the-fact would make every retro lie.
      //
      // BACKDATE-1 (2026-08-30) · read BEFORE the write gate, because the gate
      // now asks whether this day is sealed. Same lookup, moved up.
      const sealed = args.sealedSnapshot.get(dateISO);
      // WEEK-ALIGN-1 · a day before the runner's first day is a day that is
      // not theirs. Week 0 is authored from the training-week boundary so the
      // week reads back whole; the part of it that predates them is dropped
      // here rather than shown as already missed.
      // BACKDATE-1 · and a regen never authors a NEW prescription into the
      // past — only carries a sealed one forward. See `persistsComposedDay`.
      if (!persistsComposedDay({
        dateISO, todayISO: args.todayISO, clipBeforeISO: args.clipBeforeISO, sealed: sealed != null,
      })) continue;
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
export function finalizeComposedPlan(
  composed: ComposePlanResult,
  raceDistanceMi: number,
  level: LevelKey = null,
  /** COURSE-PLAN-1 · the target race's measured terrain. Optional and
   *  defaulted so every existing caller is byte-identical; an unknown course
   *  composes exactly as it did before the plan engine could see one. */
  courseTerrain: CourseTerrain = UNKNOWN_TERRAIN,
): void {
  // Long-run WoW smoother · clamp each training long to ≤ prev × 1.30
  // (rounded down to 0.5mi), trimming the week total to match. Defined as a
  // function so it can be RE-APPLIED after the taper rescale below — the
  // rescale shrinks one taper week's long without touching the next, which
  // can re-introduce the very >30% jump this smoother exists to prevent
  // (workflow CRITICAL · marathon got zero plans on a ~17-week runway).
  //
  // ── CUTBACK-LONG-2 (2026-09-02) · THE DELOAD BRIDGE THIS PASS NEVER GOT ───
  //
  // The ceiling is now `validate.ts#longRunWoWCeilingMi`, the SAME function
  // `validateComposedPlan` §4 asks. It was not, and the two disagreed: §4 got
  // CUTBACK-LONG-1's bridge over a planned deload on 2026-08-28 and this pass —
  // the one that actually CUTS the long run — kept a flat `prev × 1.30`. So
  // authoring trimmed long runs the validator would have passed, and no gate
  // could see it, because a validator only reports what is illegal and a long
  // run trimmed BELOW the limit is legal.
  //
  // Measured on the reference marathoner's CIM block: week 9's long was capped
  // at 20.5 = floor(16.0 × 1.30) off the CUTBACK week beside it, while the load
  // week before that deload had already carried 19.5 — so the block peaked
  // below the 21.5 the runner has already run, in a block whose own thesis is
  // `increase_long_run_demand`. No guard is weakened here: the 110%/30-day
  // spike rule (`enforceSpikeRule`), `layoutWeek`'s ramp ceiling and the tier
  // long cap all still run, and one of them is what the week now lands on.
  //
  // The bridge is spent only over a PLANNED deload that is not a race week,
  // which is §4's own test, and `prevWeek` walks composed weeks in order so
  // "the week before the cutback" is the last week that carried a training
  // long — a race week between them does not reset the chain, exactly as
  // `prevLong` already did not.
  // ── WHAT THIS DOES TO THE WEEK'S TOTAL, AND WHY NOTHING PAYS FOR IT ───────
  //
  // The old pass DELETED the miles it took off the long, so a week whose long
  // it cut also shipped smaller. Letting the long stand therefore returns those
  // miles to the week: on the reference block the realized peak week moves
  // 58.5 -> 60.0, and every one of the 1.5 miles is long-run mileage. No easy
  // day and no quality session changes anywhere in the block.
  //
  // Paying for the longer long run by trimming the easy days was written and
  // then REMOVED. Rule 12 is explicit that easy running is sized first and is
  // not the pool other sessions draw from — "cut quality, not the aerobic
  // base" — and taking two miles off a 60-mile week's easy days to fund the
  // long is that rule in reverse. Holding the week at 58.5 would mean deleting
  // 1.5 miles from the long run, which is reinstating the defect.
  //
  // So the week's SIZE is left to the mechanism that owns it — the volume
  // curve, and `enforceWeeklyRampCeiling` behind it, both untouched here.
  const smoothLongWoW = () => {
    const cat = distanceCategoryOf(raceDistanceMi);
    // The bridge ANCHOR is read by index, exactly as `validateComposedPlan` §4
    // reads `longByWeek[i - 2]`, and from the same expression — so the two
    // spend the identical number or neither spends one. A week with no
    // training long (a tune-up race takes the slot) reads 0 and the bridge is
    // simply not available, which is the validator's behaviour and is the
    // stricter of the two readings.
    const longByWeek = composed.weeks.map((w) =>
      Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)));
    let prevLong = 0;
    for (const [wi, week] of composed.weeks.entries()) {
      const day = week.days.find((d) => d.isLong && d.type !== 'race' && d.distanceMi > 0);
      if (!day) continue;
      // The IMMEDIATELY preceding week, exactly as `validateComposedPlan` §4
      // reads `weeks[i - 1]` — not the last week that happened to carry a
      // training long. The difference is the whole point on a tune-up week:
      // its long IS the race, so it carries no training long, and walking
      // past it would bridge over a week the runner raced.
      const prevWeek = composed.weeks[wi - 1] ?? null;
      const bridgeLong = longByWeek[wi - 2] ?? 0;
      if (prevLong > 0) {
        // COHERENCE FLOOR · the same 5 mi `enforceSpikeRule` already applies,
        // for the same reason and with the measured evidence behind it.
        //
        // Below five miles a half-mile step is a tenth of the whole long run
        // and several percent of the week, and the week does not have the
        // miles to absorb it: on the archetype corpus, bridging a 3.0 mi
        // cutback long to a 3.5 mi one moved 28 §12/§13 ladder sessions from a
        // real multi-rung shape to a single flat rung, because the long took
        // the rep budget the ladder needed to express itself
        // (`_ladder_targets.test.ts`'s census, 497 -> 525). That is a worse
        // session traded for a rounding-scale long run, on a population whose
        // long run is not the block's primary stressor in the first place —
        // `Research/22`'s 5K and 10K rows run every long plain E.
        //
        // The block this exists for is nowhere near the floor: the reference
        // marathoner's bridged anchors are 18.0 and 19.5 mi.
        const prevWasPlannedCutback = isPlannedDeloadWeek(prevWeek)
          && bridgeLong >= SPIKE_MIN_COHERENT_ANCHOR_MI;
        const ceil = Math.floor(
          longRunWoWCeilingMi(cat, prevLong, { bridgeLongMi: bridgeLong, prevWasPlannedCutback }) * 2,
        ) / 2;
        if (day.distanceMi > ceil) {
          const trim = day.distanceMi - ceil;
          day.distanceMi = ceil;
          week.weeklyMi = Math.max(0, Math.round((week.weeklyMi - trim) * 10) / 10);
        }
      }
      // `prevLong` stays the last week that CARRIED a training long rather than
      // the previous array slot, which is the pre-existing behaviour and is
      // stricter than the validator: after a raced week `longByWeek[i-1]` is 0
      // and §4 applies no limit at all, while this keeps the last real long as
      // the reference. Only the bridge anchor is index-read.
      prevLong = day.distanceMi;
      longByWeek[wi] = day.distanceMi;
    }
  };

  /**
   * SPIKEROLL-1 (2026-08-30, landed 2026-08-31) · `Research/00a`
   * §"Volume progression rules" · ">110% of the longest run in the prior 30
   * days = ~64% overuse injury risk".
   *
   * ── LANDED. `docs/spikeroll-1-handback.md` is the full audit trail ────────
   *
   * This closes the owner's ruled defect ("Let's not breach. So adjust."). It
   * was held back for one cycle because turning it on MOVES PROTECTED ANSWER
   * KEYS: `_sweep_allusers` (0 -> 334 firm failures, all traced to the sub-5mi
   * grid degeneracy — see `SPIKE_MIN_COHERENT_ANCHOR_MI`), `_dosing_sweep_gate`
   * (0 -> 12, the same population), `_audit_long_ramp` (its own assertion was
   * the bug — see `RAMP12MI` below), doctrine claim `RAMP.single-session-spike`,
   * and the `_audit_periodization` frozen snapshot (deliberately rebaselined,
   * net -5.0 mi over 14 weeks, peak long 21.5 -> 21.0, still inside
   * `Research/22`'s 20-24 marathon band). None of the four was a bug in this
   * pass; each is resolved on landing rather than routed around.
   *
   * ── WHY IT EXISTS ────────────────────────────────────────────────────────
   *
   * `smoothLongWoW` above caps a long at 130% of the PREVIOUS ONE — a
   * week-over-week bound with no memory, which a step-down resets. The spike
   * rule is a THIRTY-DAY bound: a cutback does not license the week after it to
   * jump. The owner's live block breached exactly there while passing the 130%
   * smoother at every week — 2026-10-04 authored 19.0 mi against a prior-30-day
   * longest of 15.5 (123%), immediately after a 12-mile cutback.
   *
   * ── WHY IT CANNOT LIVE IN `layoutWeek` ───────────────────────────────────
   *
   * Tried there first; the anchor it can read is wrong in the PERMISSIVE
   * direction. `layoutWeek` returns a week before the composer has embedded
   * tune-up races, re-shaped cutbacks or rescaled the taper, so its running
   * maximum was 14.5 / 15 / 16 / 17.5 where the FINAL longs are
   * 14.5 / 15 / 6.2 / 12 — every one higher than what the runner will run, and
   * looser by exactly enough to wave the breach through. A guard has to read
   * the plan that ships.
   *
   * ── THE ANCHOR IS BLENDED, AND HAS TO BE ─────────────────────────────────
   *
   * The longest SINGLE RUN in the preceding thirty days, races included — a
   * raced half is tissue load whatever else it is. A guard reading only the
   * plan is blind to the runner and collapses the whole progression behind a
   * short opening week; a guard reading only history goes stale by week five.
   * `spikeAnchorLongMi` (the literal prior-28-day max, kept literal per Rule 8's
   * corollary) covers the first four weeks and the block's own runs take over.
   *
   * Race day is excluded from the CHECK outright: a marathon is not a training
   * long run. Trimmed miles are NOT redistributed — a long doctrine says is too
   * long is not a surplus looking for a home.
   */
  // ONE CALL, placed BEFORE COH-4 (the taper rescale, directly below) —
  // deliberately, not after. COH-4 sizes each taper week's target as a
  // PERCENTAGE of the block's realized peak, computed fresh at COH-4's own
  // start, so a peak this guard has already trimmed by then is what taper is
  // correctly sized against. Tried the reverse order first (after COH-4) and
  // it is wrong: a trim landing after COH-4 has already fixed its target
  // leaves the taper's depth measured against a peak that no longer exists —
  // 1,574 firm `_sweep_allusers` failures, "Taper bottoms at Nmi, only X%
  // below peak (need >=Y%)" with X<Y.
  //
  // TAPER-phase weeks are exempt from the ceiling ENTIRELY, for a related but
  // distinct reason, and this is true whether the ceiling would run before or
  // after COH-4 — both were tried and both broke COH-4's own arithmetic:
  //
  //  · Before COH-4 (this call's position): COH-4's restore-up pass
  //    (DOCTRINE-1c) ONLY ever adds miles back to EASY days, never the long —
  //    "restored miles go to the EASY days, never the long run" is its own
  //    comment — so a TAPER week's long this guard clamped stayed clamped even
  //    where COH-4's restore tried to lift the week back toward its doctrine
  //    floor, producing an over-taper COH-4 exists specifically to prevent.
  //    Measured as a new `_sweep_allusers` finding (10K/beginner/m0/L0-3: "43%
  //    below peak, max 40%").
  //  · After COH-4 (tried as a second call, to catch `authorDressRehearsal`'s
  //    fixed-distance rehearsal long three weeks out — see that call site for
  //    what actually fixes it): trimming a taper week post-COH-4 can drop it
  //    BELOW the depth COH-4 already computed and fixed, the same under-taper
  //    shape from the opposite direction (86 new failures).
  //
  // A taper week's long only ever gets SMALLER from `layoutWeek`'s authored
  // value to what ships — COH-4 cites Research/08 §9.1 for exactly how much —
  // so this guard cannot make a taper week safer by also clamping it; it can
  // only make COH-4's own arithmetic wrong, in either direction, depending on
  // which side of COH-4 it runs. The week's raw distance still feeds
  // `longestByWeek` below so a week after taper reads a real anchor — only
  // the CEILING is skipped.
  //
  // ── THE ROLLING ANCHOR READS THE WEEK'S RECONCILED MAX, NOT ITS RAW ONE ───
  //
  // `longestByWeek` records the true stress of the week — the longest SINGLE
  // run of any type, per Rule 8's corollary — so a hard quality session that
  // ties or exceeds the (just-trimmed) long must be reconciled BEFORE that
  // record is taken, not after. A first version recorded the max first and
  // ran the easy/quality re-cap as a separate pass over the whole block
  // afterward: a quality day sized to the ORIGINAL, un-trimmed long (legal —
  // "quality may reach the long", RP-5) was still sitting at its old value
  // when the NEXT week's anchor was computed, so a week trimmed 9->8 fed the
  // rolling window a 9 anyway (whatever the tied quality day still read), and
  // the very next week's ceiling was calculated off the wrong number. Caught
  // by `_spike_rule_gate.test.ts`'s own corpus walk: `2026-10-05` on a
  // marathon/advanced_plus archetype read `anchor=9` when the week that fed
  // it had already been trimmed to 8. The re-cap now runs PER WEEK, inline,
  // immediately after that week's own trim and before its max is recorded —
  // so the anchor a later week reads is always what the runner would actually
  // have run, never a value another pass hasn't caught up to yet.
  const recapEasyBelowLong = (week: ComposedWeek) => {
    const longMi = Math.max(0, ...week.days.filter((d) => d.isLong).map((d) => d.distanceMi));
    if (longMi <= 0) return;
    for (const d of week.days) {
      const cap = d.type === 'easy' ? Math.max(1, Math.min(longMi - 1, Math.round(0.8 * longMi))) : longMi;
      if ((d.type === 'easy' || (d.isQuality && d.type !== 'race')) && !d.isLong && d.distanceMi > cap) {
        week.weeklyMi = Math.max(0, Math.round((week.weeklyMi - (d.distanceMi - cap)) * 10) / 10);
        d.distanceMi = cap;
      }
    }
  };
  const enforceSpikeRule = (): void => {
    const longestByWeek: number[] = [];
    const weeksInWindow = Math.floor(SPIKE_WINDOW_DAYS / 7);
    const df = (composed.authoredState as Record<string, unknown> | undefined)?.['derived_from'];
    const seedAnchorMi = Number((df as Record<string, unknown> | undefined)?.['spikeAnchorLongMi']) || 0;
    for (const [wi, week] of composed.weeks.entries()) {
      const day = week.days.find((d) => d.isLong && d.type !== 'race' && d.distanceMi > 0);
      const anchor = Math.max(
        wi < weeksInWindow ? seedAnchorMi : 0,
        ...longestByWeek.slice(-weeksInWindow),
      );
      // SPIKE_MIN_COHERENT_ANCHOR_MI · below the coherence floor the guard
      // cannot express doctrine's ratio on the half-mile grid (see that
      // constant's comment), so the week is left exactly as every other pass
      // above it left it — `layoutWeek`'s own rampCeiling already bounds this
      // population, this pass simply does not additionally constrain it.
      const taperExempt = week.phase === 'TAPER';
      if (day && !taperExempt && anchor >= SPIKE_MIN_COHERENT_ANCHOR_MI) {
        const ceil = Math.floor(anchor * SPIKE_MAX_SHARE * 2) / 2;
        if (day.distanceMi > ceil + 1e-9) {
          const trim = day.distanceMi - ceil;
          day.distanceMi = ceil;
          week.weeklyMi = Math.max(0, Math.round((week.weeklyMi - trim) * 10) / 10);
          // Belt-and-suspenders re-cap, THIS week, THIS iteration — see the
          // comment above `recapEasyBelowLong` for why it cannot wait.
          recapEasyBelowLong(week);
        }
      }
      // Recorded AFTER any clamp, so a trimmed long anchors the next week at
      // what the runner will actually have run.
      longestByWeek.push(Math.max(0, ...week.days.map((d) => d.distanceMi)));
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

  // ── SPIKEORDER-1 (2026-09-02) · THE SPIKE RULE SETTLES THE LONGS BEFORE
  //    ANYTHING READS A WEEKLY PEAK ────────────────────────────────────────
  //
  // MIDRACE-ORDER-1, directly below, states the principle this obeys: "a
  // reference is only worth reading once every pass that can lower it has run."
  // `enforceSpikeRule` lowers long runs, and a long run is the largest single
  // component of a week — so a ramp ceiling that runs before it measures weeks
  // against a peak the spike rule is about to remove, and pays for a trim the
  // week did not need out of the EASY days, which then stay cut after the long
  // is shortened anyway.
  //
  // Measured on `_midrace_invariants.test.ts`'s CIM fixture: week 8's long
  // stood at 21.5 when the ramp ceiling read it and at 16.5 when it shipped, so
  // the peak week lost six miles of easy running to a ceiling that was never
  // exceeded by the plan that ships — and the post-race week then became the
  // block's peak, which is the exact invariant MIDRACE-RAMP-1 exists to hold.
  //
  // The spike rule keeps every property its own header argues for: it still
  // runs inside `finalizeComposedPlan` on the plan that ships rather than on
  // `layoutWeek`'s pre-finalization curve, still after both WoW smoothers, and
  // still BEFORE COH-4 (see the note at its old call site, retained below).
  // What changes is only that the ramp ceilings now read final longs. It also
  // removes the one PERMISSIVE reading left in the old order — MIDRACE-RAMP-1
  // trims without `protectLong`, so a long it shortened used to feed the spike
  // rule's rolling anchor as if the runner had never been prescribed the
  // longer one.
  enforceSpikeRule();

  // ── THE TWO RAMP CEILINGS, IN THE ORDER THEY HAVE TO RUN ─────────────────
  //
  // WKRAMP-1 (2026-08-19) · the general ramp ceiling, on every week's REALIZED
  // volume. This is the block-wide case the generator never enforced, which is
  // how a beginner marathoner was authored a 44% week-over-week step. Runs on
  // the numbers VOL-1 just wrote and before the taper pass, so the taper
  // descends from the corrected peak. See the function's own note.
  //
  // WKRAMP-REC-1 (2026-08-25) · a post-race reverse taper is graded against the
  // PRE-RACE PEAK it is unwinding, not against its own deload weeks. Only
  // `composeRecoveryPlan` publishes that ceiling, so every other composer
  // passes null here and is byte-identical.
  //
  // MIDRACE-ORDER-1 (2026-08-25) · MIDRACE-RAMP-1 USED TO RUN FIRST, AND ITS
  // REFERENCE DID NOT SURVIVE THE PASS THAT FOLLOWED IT.
  //
  // Both passes measure a week against the block's prior PEAK. MIDRACE-RAMP-1
  // ran first, read a peak of 67, capped the post-race week at 67 — and then
  // WKRAMP-1 ran and trimmed that very peak week down to 55, leaving the
  // post-race week standing at 62 against a block whose real peak was now 55.
  // The invariant MIDRACE-RAMP-1 exists to hold — "the week after a raced half
  // is not the block's peak week" — was violated BY the pass that runs after
  // it, using a number the first pass had already spent.
  //
  // It is the same mistake as measuring a rebound against a deload, one level
  // up: a reference is only worth reading once every pass that can lower it has
  // run. So the general ceiling goes first and settles the block's peak, the
  // tune-up rule then measures against a peak that is final, and WKRAMP-1 runs
  // once more because MIDRACE-RAMP-1's trim can itself lower a reference that a
  // later week was measured against. Both passes only ever REMOVE miles, so the
  // second call converges and is a no-op whenever the first left nothing to do
  // — the same argument `smoothLongWoW` above makes for being called twice.
  const enforceGeneralRamp = () => enforceWeeklyRampCeiling(
    composed.weeks, composed.vols, level,
    reverseTaperCeilingMi(composed),
    // WKRESUME-1 · the runner's pre-block level, when composePlan measured one.
    composed.rampAnchorMi ?? null,
  );
  enforceGeneralRamp();
  {
    const embedded = ((composed.authoredState as Record<string, unknown> | undefined)
      ?.embedded_races ?? []) as EmbeddedRaceSummary[];
    if (Array.isArray(embedded) && embedded.length > 0) {
      enforceRampCeilingAfterEmbedding(
        composed.weeks, composed.vols, level, embedded,
        composed.rampAnchorMi ?? null,
      );
      enforceGeneralRamp();
    }
  }

  // ── PEAKLOAD-1 (2026-09-02) · THE PLAN SHIPS THE PEAK IT DECLARES ─────────
  //
  // `layoutWeek`'s per-day floors can push a week's realized sum above the
  // volume-curve budget it was handed — WKRAMP-1's own header says so — and
  // VOL-1 then reports that number honestly. On the reference marathoner that
  // meant `block_strategy.peakLoadMi` read 58.5 while three weeks shipped at
  // 60.0: two answers to "what is the biggest week in this block" (Rule 16),
  // with the runner shown the smaller one.
  //
  // The owner's ruling, 2026-09-02, is on the number itself: "Retain the
  // proposed 58.5-mile peak unless new evidence contradicts it. Do not raise
  // mileage to satisfy the self-declared 'advanced' category." His best week
  // ever is 48.5 and he has never run 50, so 58.5 is already +20.6% on an
  // all-time best; a further 1.5 arriving as a layout artefact is not evidence.
  //
  // `protectLong` is deliberate and is the Rule 12 trade stated out loud: the
  // long run is the session the block exists to build and is bounded by its own
  // doctrine (the 110%/30-day spike rule, the week-over-week limit, the tier
  // cap), so a weekly-total cap must not pay for itself out of it. What it does
  // pay out of is the easy days, which Rule 12 protects as a FLOOR rather than
  // as untouchable — `layoutWeek` set that floor from the runner's own easy-day
  // median and `trimWeekToVolume` keeps every surviving run above its junk-run
  // minimum. The alternative is shipping a week the block's own strategy says
  // is not its peak.
  //
  // Only ever REMOVES miles, and only above a budget the composer itself set,
  // so it cannot make any week harder and is a no-op for every plan whose
  // layout stayed inside its budget.
  if (composed.budgetPeakWeeklyMi != null && composed.budgetPeakWeeklyMi > 0) {
    const cap = composed.budgetPeakWeeklyMi;
    for (const [wi, w] of composed.weeks.entries()) {
      if (w.isRaceWeek || w.phase === 'TAPER') continue;   // taper is COH-4's, race week is its own
      if (!((w.weeklyMi ?? 0) > cap + 0.05)) continue;
      trimWeekToVolume(w, cap, true);
      if (Array.isArray(composed.vols) && wi < composed.vols.length) composed.vols[wi] = w.weeklyMi;
    }
  }

  // SPIKEROLL-1 · runs HERE, deliberately BEFORE the taper rescale (COH-4,
  // directly below) rather than after it. Both orderings satisfy "read the
  // plan that ships, not `layoutWeek`'s pre-finalization curve" — the hand-
  // back's own reason this cannot live in `layoutWeek` — because by this point
  // every long-run-moving pass that runs BEFORE `finalizeComposedPlan` is done
  // (`layoutWeek` itself), and so are both WoW smoothers and the general and
  // embedded-race ramp ceilings, directly above.
  //
  // Only AFTER-taper was tried first, and it is wrong: COH-4 sizes each taper
  // week's target as a PERCENTAGE OF `nonTaperPeakR`, the block's own realized
  // peak — computed once, before this guard runs. If `enforceSpikeRule` then
  // ran after COH-4 and trimmed the actual PEAK week (exactly the week most
  // likely to trip a 30-day spike right after a cutback — 2026-10-04 in the
  // owner's own block), the taper's already-fixed target no longer matches the
  // now-lower REAL peak the validator reads at the end of the pipeline, and
  // every taper week under-reaches by however much the peak dropped. Measured
  // on the sweep with the guard placed after COH-4: 1,574 firm failures, the
  // overwhelming majority "Taper bottoms at Nmi, only X% below peak Nmi (need
  // >=Y%)" with X<Y — not the ~334, nearly-all-sub-5mi population the hand-back
  // characterized. That population is real (see `SPIKE_MIN_COHERENT_ANCHOR_MI`)
  // but it was never the whole story; this ordering bug was compounding it.
  //
  // Placed HERE, COH-4 computes `nonTaperPeakR` off the ALREADY spike-trimmed
  // weeks, so the taper is sized against the peak that actually ships and the
  // two stay consistent by construction — no separate reconciliation needed.
  //
  // SPIKEORDER-1 (2026-09-02) · this is now the SECOND call. The first runs
  // before the ramp ceilings so they read final long runs (see that call site
  // for the six miles of easy running the old order cost). This one stays
  // because MIDRACE-RAMP-1's trim does not protect the long, so a long it
  // shortens changes the rolling anchor a later week reads — and the pass only
  // ever removes miles, so a second call converges and is a no-op whenever the
  // first left nothing to do. Same argument `smoothLongWoW` makes for being
  // called three times.
  enforceSpikeRule();

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
        // DEADBAND: only acts when the week sits more than
        // `TAPER_RESTORE_TOLERANCE` below its target. Ordinary rounding and
        // reconciliation land far inside that, so healthy plans — David's
        // marathon among them — are byte-identical.
        //
        // ── TAPER-RESTORE-CONTINUOUS-1 (2026-08-30) · Rule 9 ──────────────────
        //
        // The deadband used to be a TRIGGER: inside it nothing happened, and
        // one hundredth outside it the week was lifted all the way to
        // `doctrineTarget`. That is non-monotonic, and backwards — a week
        // authored at 89.3% of its target kept its 89.3%, while a week authored
        // slightly SMALLER was lifted to 100%. **A smaller input produced a
        // bigger output**, which is the same defect shape as every other cliff
        // in this pass, and the taper is the block's most volume-sensitive
        // stretch to have it in.
        //
        // The tolerance is now the FLOOR it was always describing. It says
        // "a taper week is allowed to sit up to 12% under its doctrine target";
        // so the week is lifted to that edge and no further, and the result is
        //
        //     out = max(authored, doctrineTarget / TAPER_RESTORE_TOLERANCE)
        //
        // which is continuous at the edge and monotone non-decreasing in the
        // authored week, by construction. Nothing changes for a week the
        // deadband never fired on, which is every healthy plan — this only
        // changes how far an over-tapered week is brought back, and it brings
        // it back to the edge of the band the deadband already asserted was
        // acceptable rather than past it. Same shape as the race-target fix
        // Rule 9 records: a band has ONE edge, and `max(value, floor)` is
        // continuous and monotone for free.
        const doctrineTarget = Math.min(nonTaperPeakR * factor, priorTaper);
        const restoreFloorMi = doctrineTarget / TAPER_RESTORE_TOLERANCE;
        if (restoreFloorMi > tw.weeklyMi) {
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
          const wantOther = restoreFloorMi - longMi;
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

  // LONGRUN-ROWS-1 (2026-08-25) · Research/04 §4.6's dress rehearsal, three
  // weeks out. Runs after MIDRACE-RAMP-1's post-race strip (so the window that
  // legitimately removes §4.4's marathon-pace long cannot also remove §4.6's
  // rehearsal) and before both caps below (so they still get the last word).
  authorDressRehearsal(composed, raceDistanceMi);

  // SPIKEROLL-1 · third `smoothLongWoW()` call, for `authorDressRehearsal`
  // immediately above. Research/04 §4.6's rehearsal long is authored AFTER
  // COH-4 and the first `enforceSpikeRule` call, at a fixed distance tied to
  // race day rather than to the block's recent longs, so neither guard has
  // seen it — and left unchecked it can open a WoW jump `smoothLongWoW`'s own
  // 30% limit already passed BEFORE the rehearsal existed to violate it (a
  // beginner marathon archetype measured at 44%, once the first spike call
  // had correctly shrunk the weeks the rehearsal is compared against).
  //
  // `smoothLongWoW` — not a third `enforceSpikeRule` call — is the fix here.
  // A second full spike pass was tried first, `skipTaperWeeks: false`, so it
  // could reach a rehearsal that lands in a TAPER week: it re-broke taper
  // depth the same way the first call did before it learned to skip TAPER
  // weeks, because trimming ANY week that happens to be COH-4's already-spent
  // peak reference — taper or not — invalidates arithmetic COH-4 finished
  // before this point runs (86 new `_sweep_allusers` failures, same
  // under-taper shape). `smoothLongWoW` does not have that failure mode: it
  // caps each long against the PREVIOUS week's own realized value, never
  // against a block-wide peak, so re-running it here cannot invalidate
  // anything COH-4 already computed — it can only trim a jump the rehearsal
  // just introduced, which is exactly and only what this needs to do. Safe to
  // call a third time for the identical reason the file's own comment gives
  // for calling it a second: "only ever REMOVE miles, so ... the second call
  // converges and is a no-op whenever the first left nothing to do."
  smoothLongWoW();

  // ── TAPERMP-ANCHOR-1 (2026-09-02) · THE MP SESSION IS SIZED OFF THE LONG,
  //    SO IT IS RE-SIZED WHEN THE LONG MOVES ─────────────────────────────────
  //
  // `taperMpDose` is handed `qualityCeiling = min(longMi, 0.6 × weeklyMi)`, so
  // §9.2's marathon-pace taper session is a value DERIVED from that week's long
  // run — and every trimmer that shortens the long afterwards leaves it
  // holding an anchor that no longer exists. Rule 10, inside the composer.
  //
  // The quality-or-easy re-cap several hundred lines above used to be the last
  // pass that touched a long run, and is not any more: `authorDressRehearsal`
  // authors §4.6's rehearsal long after it, and the `smoothLongWoW()` call
  // directly above trims that rehearsal against the previous week's long. A
  // week whose long is cut there ships the older, larger MP session beside it,
  // and the validator reports "tempo N mi exceeds the long N mi · the long must
  // be the week's longest run" — which `_sweep_allusers` catches on a 25 mi/wk
  // marathoner carrying §9.2's 11-mile MP session against an 11-mile long.
  //
  // A pre-existing hole rather than one CUTBACK-LONG-2 opened; the numbers
  // simply had not broken it before. Scoped to `isMpTaperSession` — the one
  // session in the plan sized off the long AND carrying its own segment
  // arithmetic in its sub_label — because the general "cap every quality day at
  // the long" version of this was written first and REJECTED: on a 5K runner
  // whose longest run is three miles it re-cuts §12/§13 ladder sessions that
  // were authored at their full shape, collapsing 28 more of them to a single
  // flat rung (`_ladder_targets.test.ts`'s ratchet, 497 -> 525). Trimming the
  // day without re-authoring the session is not the same as sizing it right.
  for (const w of composed.weeks) {
    const longMi = Math.max(0, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi));
    if (longMi <= 0) continue;
    for (const d of w.days) {
      if (d.isLong || !isMpTaperSession(d) || d.distanceMi <= longMi) continue;
      w.weeklyMi = Math.max(0, Math.round((w.weeklyMi - (d.distanceMi - longMi)) * 10) / 10);
      d.distanceMi = longMi;
      resizeMpSession(d, d.distanceMi);
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

  // COURSE-PLAN-1 (2026-08-25) · terrain guidance on the long runs. After the
  // intensity floor because `setLongFinish` rewrites a long run's notes
  // wholesale, and this appends to them.
  applyCourseGuidance(composed, courseTerrain, raceDistanceMi);
  // DOWNHILL-2 · after the guidance note, because this promotes one of the
  // longs that note already covers and its own sentence is more specific.
  authorDownhillSimulation(composed, courseTerrain, raceDistanceMi);

  // LONGRUN-TRACE-1 (2026-08-25) · collect every race-pace segment a later pass
  // shortened or removed, so a session disappearing is a thing the audit
  // surface can read rather than an absence somebody has to notice. Written
  // even when empty is false: the key is absent on a block where nothing moved,
  // which is the honest shape.
  {
    const changes: Array<Record<string, unknown>> = [];
    for (const w of composed.weeks) {
      for (const d of w.days) {
        if (!d.racePaceChange) continue;
        changes.push({
          week_start_iso: w.startISO,
          date_iso: dowDateInWeek(w.startISO, d.dow),
          kind: d.racePaceChange.kind,
          from_mi: d.racePaceChange.fromMi,
          to_mi: d.racePaceChange.toMi,
          reason: d.racePaceChange.reason,
        });
      }
    }
    if (changes.length > 0) {
      (composed.authoredState as Record<string, unknown>).long_run_race_pace_changes = changes;
    }
  }

  // COURSE-PLAN-1 · what the engine saw of the course, recorded whether or not
  // it changed anything. "The plan is blind to the course" was true for every
  // race for the whole life of this engine and nothing said so; an `unknown`
  // here is now a statement rather than a silence.
  (composed.authoredState as Record<string, unknown>).course = {
    shape: courseTerrain.shape,
    net_ft: courseTerrain.netFt,
    gain_ft: courseTerrain.gainFt,
    loss_ft: courseTerrain.lossFt,
    vert_per_10mi: courseTerrain.vertPer10Mi,
    provenance: courseTerrain.provenance,
    confidence: courseTerrain.confidence,
    trusted: courseTerrain.trusted,
    geometry_source: courseTerrain.geometrySource,
  };

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

  /*
   * ZERODAY-1 (2026-08-29) · a day with no miles is not a workout.
   *
   * Found by the same sweep as LABELTRUTH-1: two days of 47,040 ended at zero
   * distance while still carrying a prescription — an ultra taper week's
   * `race_week_tuneup` reading "5×400m @ T pace · 90s jog" on a 0 mi day. The
   * taper's volume cut took the day to nothing and nothing re-read what the day
   * still claimed to be.
   *
   * It is a small population and an incoherent one. `splitDay` reports the day
   * as zero easy and zero quality, so it contributes nothing to any cap, ramp
   * or intensity ratio — but the prescription is still what the runner reads
   * and what `buildWorkoutSpec` parses, and that spec expands to warm-up plus
   * five four-hundreds plus cool-down: about two and a quarter miles of running
   * on a day the plan says is zero.
   *
   * Converting it to REST removes no training. The day already had none — zero
   * miles is what every accounting pass in this file already believes about it,
   * and this only makes the label agree with them. Cross-training and strength
   * are not `DayPlan` types — they are carried elsewhere — so the only runless
   * type this has to step around is `rest` itself.
   */
  for (const week of composed.weeks) {
    for (const day of week.days) {
      if (day.type === 'rest') continue;
      if ((day.distanceMi ?? 0) > 0) continue;
      day.type = 'rest';
      day.isQuality = false;
      day.isLong = false;
      day.subLabel = 'REST';
      day.notes = 'Off feet. Hydrate.';
    }
  }

  /*
   * LABELTRUTH-1 (2026-08-29) · the last word on what a day SAYS is the spec
   * that day builds.
   *
   * `timeRepSpec` clamps a rep set to what the day can hold — right, and its
   * own comment argues why: "a prescription is a request, not an instruction".
   * But the composer authored the sub_label BEFORE the day's mileage was
   * finally known (every ramp ceiling, taper rescale and long-run smoother
   * above can still move it), so the two were free to disagree, and they did.
   * Swept over the archetype grid on 2026-08-29: 920 of 8,181 rep-bearing days
   * — 11% — carried a sub_label whose rep count the spec contradicted. A
   * beginner on a 15 mi/wk block read "6×1 min surges" and their watch ran
   * three.
   *
   * That is the sub_label/spec drift this codebase has already paid for twice,
   * and this pass is the general answer rather than a third point fix: build
   * each day's spec exactly as the persist path will, and where the spec
   * clamped the count, restate the count in the label. `retitleReps` moves the
   * number and nothing else, so the workout's authored identity survives.
   *
   * It runs LAST, after every pass that can change a day's distance, because
   * a label reconciled before those passes would just drift again.
   */
  // The plan's OWN threshold pace. A time-stated rep set's clamp converts its
  // seconds through this number, so reconciling at any other pace answers the
  // question for a different runner. The probe constant is the fallback only
  // for a composer that recorded none.
  // AUTHORING-CANONICAL-1 · AND AT THE SAME ANCHORS THE PERSIST PATH USES.
  // `specForComposedDay` builds every persisted spec WITH the canonical
  // anchors; reconciling the label against a spec built WITHOUT them answers
  // the question for a differently-priced runner, and a rep-count clamp is
  // pace-dependent — which is exactly the drift this pass exists to close
  // (Rule 16: the label and the spec must come off one pricing).
  const reconcileTPaceSec = composed.paceAnchors?.thresholdSecPerMi
    ?? composed.tPaceSec ?? SPEC_PROBE_T_PACE_SEC;
  const reconcileAnchors = composed.paceAnchors ?? null;
  for (const week of composed.weeks) {
    for (const day of week.days) {
      const label = day.subLabel;
      if (!label || !(day.distanceMi > 0)) continue;
      // ONLY a single homogeneous rep set. A SEQUENCE — §9.2's Mona fartlek
      // is "2×90s + 4×60s + 4×30s + 4×15s" — carries several groups, and its
      // spec's `rep_count` is the TOTAL number of steps (14), not the first
      // group's count (2). Reconciling those two against each other rewrites
      // the leading group to the total and prescribes fourteen ninety-second
      // reps at 5K effort in place of two. Caught by the same sweep that found
      // the drift, on this pass's own first run; the guard is why a label with
      // more than one group is left entirely alone.
      const groups = label.match(/\d+\s*[×x]\s*\d/g) ?? [];
      if (groups.length !== 1) continue;
      let spec: Record<string, unknown> | null = null;
      try {
        spec = buildWorkoutSpec(
          day.type, day.distanceMi, reconcileTPaceSec, null, label,
          null,                                       // maxHr
          null,                                       // goalPaceSPerMi
          reconcileAnchors?.intervalSecPerMi ?? null, // iPaceSec
          reconcileAnchors?.easyCeilingSecPerMi ?? null, // easyAnchorTSec
          false,                                      // effortCued
          null,                                       // prescribedRacePaceSPerMi
          reconcileAnchors,
        ).spec as Record<string, unknown> | null;
      } catch {
        continue;
      }
      const built = Number(spec?.rep_count ?? 0);
      if (!(built > 0)) continue;
      const authored = Number(/(\d+)\s*[×x]\s*\d/.exec(label)?.[1] ?? 0);
      if (!(authored > 0) || authored === built) continue;

      const retitled = retitleReps(label, authored, built);
      if (retitled && retitled !== label) day.subLabel = retitled;
    }
  }

  /*
   * LABELTRUTH-2 (2026-08-30) · the distance half of the same drift.
   *
   * `retitleReps` above restates a clamped REP count; this restates a
   * beginner base-building label's own LEADING MILEAGE ("8mi E w/ 4×1 min
   * surges @ T effort · 1 min jog") against the day's FINAL distanceMi, for
   * the identical reason: VARIETY-BEGIN-1's light-hills/light-surges
   * branches author that number off `qualityMiEach` at layout time, before
   * every ramp ceiling, taper rescale and long-run smoother below it has
   * finished moving the day. Swept 2026-08-30 over the same archetype grid
   * `_label_truth.test.ts` walks: 4 of 2,310 "mi E w/" days — every one a
   * 3.11mi/beginner/70mpw base week's dow-2 tempo or dow-4 intervals day —
   * read "8mi E w/ …" over a day that settled at 7.5mi. Runs LAST, same as
   * the rep-count pass, for the same reason: reconciled any earlier and it
   * would just drift again.
   */
  for (const week of composed.weeks) {
    for (const day of week.days) {
      const label = day.subLabel;
      if (!label || !(day.distanceMi > 0)) continue;
      const retitled = retitleLeadMi(label, day.distanceMi);
      if (retitled && retitled !== label) day.subLabel = retitled;
    }
  }

  // COMBINED-STRESS-1 · same reasoning, one pass earlier in the list: the
  // placement record's numbers have to be the SHIPPED numbers.
  refreshPlacementCompromises(composed);

  // PHASE-ANSWERS-1 · LAST, after every pass that can move a mile, so the
  // numbers each phase cites (the block's peak week, its longest run, the
  // race-pace longs a phase carries) describe the block that ships.
  attachPhaseAnswers(composed, raceDistanceMi);

  // BLOCK-STRATEGY-1 · after the phase answers, because it CARRIES them rather
  // than restating them (Rule 17). Describes; changes nothing.
  attachBlockStrategy(composed, raceDistanceMi);
}

/**
 * BLOCK-STRATEGY-1 (2026-09-02) · brief §4.3's `BlockStrategy`, stamped onto
 * the block that ships.
 *
 * Reads only the composed weeks, the phase answers attached one line above,
 * and what the composer already stamped on `authoredState`. Derives no
 * capacity, sizes nothing, moves nothing — `_strategy_contracts.test.ts`
 * asserts the composed weeks are byte-identical with this pass and without it,
 * because a description that changes what it describes is not one.
 *
 * Inert on a result whose composer stamped no `authoredState` (the pure unit
 * fixtures), which is the same gating `attachPhaseAnswers` uses.
 */
function attachBlockStrategy(composed: ComposePlanResult, raceDistanceMi: number): void {
  const st = composed.authoredState as Record<string, unknown> | undefined;
  if (!st) return;
  const cat = distanceCategoryOrNull(raceDistanceMi);
  const thesis = (st['thesis_at_authoring'] ?? null) as ThesisAtAuthoring | null;
  // The race date is not a key on `authoredState`; it is a DAY in the block,
  // which is the more honest place to read it from — a stamped date and a
  // composed race day could disagree, and the runner runs the day (Rule 16).
  const raceDateISO = (() => {
    for (let i = composed.weeks.length - 1; i >= 0; i--) {
      const w = composed.weeks[i];
      const d = w.days.find((x) => x.type === 'race');
      if (!d) continue;
      const startDow = new Date(w.startISO + 'T12:00:00Z').getUTCDay();
      return addDays(w.startISO, ((d.dow - startDow) % 7 + 7) % 7);
    }
    return null;
  })();
  // The runner's STATED goal, in seconds, as `achievable-target` recorded it.
  // Carried verbatim and never spent: `check-goal-pace-leak` is what keeps a
  // goal out of the capacity path, and nothing downstream reads this field.
  const prescribed = st['prescribed_race_pace'] as { goal_sec?: unknown } | null | undefined;
  const goalSec = typeof prescribed?.goal_sec === 'number' ? prescribed.goal_sec : null;
  const strategy = deriveBlockStrategy({
    weeks: composed.weeks,
    phases: composed.blocks.phases,
    targetEvent: cat != null && raceDateISO
      ? { distanceMi: raceDistanceMi, category: cat, dateISO: raceDateISO }
      : null,
    statedGoalSec: goalSec,
    thesis: thesis
      ? {
          primaryLimiter: thesis.primaryLimiter,
          priority: thesis.priority,
          confidence: thesis.confidence,
          source: thesis.source,
        }
      : null,
  });
  if (strategy) st['block_strategy'] = strategy;
}

/**
 * COMBINED-STRESS-1 (2026-09-02) · RESTATE EACH PLACEMENT RECORD AGAINST THE
 * BLOCK THAT SHIPS.
 *
 * `embedMidBlockRaces` records its decisions at the moment it makes them, and
 * three later passes can still move the day it recorded — the ramp ceiling
 * after embedding, `applyDosingCaps`, and the long-run smoother. Caught
 * immediately on the owner's block: the record read "18mi long run stands 1
 * day after Dodgers" while the plan shipped 15.5. One quantity, two answers
 * (Rule 16), in a field whose entire job is to be the honest account of a
 * decision.
 *
 * So the record's DECISION and CITATION are the embed's, and its NUMBERS are
 * re-read here from the final day. A record whose day no longer exists (the
 * long stood down entirely) keeps the embed's text — it is still a true
 * statement about what was decided — rather than being deleted, because a
 * decision that was made and then overtaken is not a decision that was never
 * made.
 */
function refreshPlacementCompromises(composed: ComposePlanResult): void {
  const st = composed.authoredState as Record<string, unknown> | undefined;
  const raw = st?.['placement_compromises'];
  if (!Array.isArray(raw) || raw.length === 0) return;
  const dayOn = (iso: string): DayPlan | null => {
    for (const w of composed.weeks) {
      if (iso < w.startISO || iso > addDays(w.startISO, 6)) continue;
      const startDow = new Date(w.startISO + 'T12:00:00Z').getUTCDay();
      const dow = ((startDow + daysBetween(w.startISO, iso)) % 7) as DOW;
      return w.days.find((d) => d.dow === dow) ?? null;
    }
    return null;
  };
  for (const r of raw as PlacementRecord[]) {
    const d = dayOn(r.dateISO);
    if (!d || !(d.distanceMi > 0)) continue;
    if (r.code === 'ACCEPT_AS_HARD_WORKOUT') {
      const raceDay = dayOn(r.raceDateISO);
      const raceMi = raceDay?.distanceMi ?? 0;
      const gap = daysBetween(r.raceDateISO, r.dateISO);
      r.detail =
        `${d.distanceMi}mi long run stands ${gap} day(s) after ${r.raceName} ` +
        `(${raceMi}mi, C effort) · ${(raceMi + d.distanceMi).toFixed(2)}mi across the pair`;
    } else if (r.code === 'REDUCE_DOSE') {
      // The "was" half of the sentence is the embed's own record of what it
      // cut FROM and cannot be re-derived here; only the shipped number is
      // restated, so the record cannot claim a distance the plan does not
      // carry.
      r.detail = r.detail.replace(/→ [\d.]+mi/, `→ ${d.distanceMi}mi`);
    }
  }
}

/**
 * PHASE-ANSWERS-1 (2026-09-01) · the structured answers every phase owes.
 *
 * Reads only what the composer already stamped on `authoredState` and carried
 * on the result: the ramp evidence, the habit readers, the canonical anchors'
 * provenance, the embedded races, and the Coaching Thesis as resolved at
 * authoring. Nothing is derived here that another owner owns (Constitution
 * §H consumes §F and §C; it does not recreate them). The answers are attached
 * to `blocks.phases[i].answers` and mirrored to `authored_state.phase_answers`
 * in phase order, which is the order `persistPlan` writes `plan_phases`.
 *
 * Inert on a result whose composer stamped no `authoredState` at all.
 */
function attachPhaseAnswers(composed: ComposePlanResult, raceDistanceMi: number): void {
  const st = composed.authoredState as Record<string, unknown> | undefined;
  if (!st) return;
  const cat = distanceCategoryOrNull(raceDistanceMi);
  if (cat == null) return;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const derived = (st['derived_from'] ?? {}) as Record<string, unknown>;
  const ramp = (st['ramp_base'] ?? null) as
    | { sustainedMi?: unknown; meanMi?: unknown; heldMi?: unknown; peakMi?: unknown; returning?: unknown; interruptionWeeks?: unknown; allowedInterruptionWeeks?: unknown }
    | null;
  const rampEvidence = ramp && num(ramp.sustainedMi) != null
    ? {
        sustainedMi: num(ramp.sustainedMi) ?? 0,
        meanMi: num(ramp.meanMi) ?? 0,
        heldMi: num(ramp.heldMi) ?? 0,
        peakMi: num(ramp.peakMi) ?? 0,
        returning: ramp.returning === true,
        interruptionWeeks: num(ramp.interruptionWeeks) ?? 0,
        allowedInterruptionWeeks: num(ramp.allowedInterruptionWeeks) ?? 0,
      }
    : null;
  const tierRaw = (st['goal_tier'] ?? st['tier']) as GoalTier | undefined;
  const tier: GoalTier | null =
    tierRaw === 'elite' || tierRaw === 'advanced' || tierRaw === 'intermediate' || tierRaw === 'developing' ? tierRaw : null;
  const band = (k: string): [number, number] | null => {
    const b = st[k];
    return Array.isArray(b) && b.length === 2 && num(b[0]) != null && num(b[1]) != null
      ? [Number(b[0]), Number(b[1])]
      : null;
  };
  const weeklyBand = band('tier_peak_weekly_band');
  const longBand = band('tier_peak_long_band');
  const tierTarget = weeklyBand && longBand
    ? { peakWeeklyMileageBand: weeklyBand, peakLongMiBand: longBand }
    : (tier ? { peakWeeklyMileageBand: TIER_TARGETS[cat][tier].peakWeeklyMileageBand, peakLongMiBand: TIER_TARGETS[cat][tier].peakLongMiBand } : null);
  // The density the runner's preferences seat; on a composer that did not
  // stamp it, the most quality days any authored week actually carries.
  const qualityDowsPlanned = num(st['quality_days_planned'])
    ?? Math.max(0, ...composed.weeks.map((w) => w.days.filter((d) => d.isQuality && !d.isLong && d.type !== 'race').length));
  const thesis = (st['thesis_at_authoring'] ?? null) as ThesisAtAuthoring | null;
  const embedded = (Array.isArray(st['embedded_races']) ? st['embedded_races'] : []) as EmbeddedRaceSummary[];
  const answers = buildPhaseAnswers({
    cat,
    raceDistanceMi,
    phases: composed.blocks.phases,
    weeks: composed.weeks,
    tier,
    tierTarget,
    qualityDowsPlanned,
    rampEvidence,
    recentLongMi: num(derived['recentLongMi']),
    easyDayMedianMi: num(st['easy_day_median_mi']) ?? num(derived['easyDayMedianMi']),
    // `derived_from` writes `?? null`, so an unmeasured habit and a failed read
    // arrive here as the same null; both are said to be "not yet measured".
    recentQualityPerWeek: num(derived['recentQualityPerWeek']),
    anchors: composed.paceAnchors ?? null,
    thesis: thesis && (thesis.source === 'resolved' || thesis.source === 'read_failed') ? thesis : null,
    embeddedRaces: embedded.map((e) => ({ name: e.name, weekIdx: e.weekIdx, priority: e.priority, distanceMi: e.distanceMi })),
    isMidBlock: st['is_mid_block'] === true,
    allowedInterruptionWeeks: rampEvidence?.allowedInterruptionWeeks ?? null,
  });
  composed.blocks.phases = composed.blocks.phases.map((p, i) => ({ ...p, answers: answers[i] }));
  st['phase_answers'] = answers;
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
    // BOUNDARY-OWNER-1 · what each day carried before the trimmer, so the
    // give-back below can restore a day the week has no room to re-home from.
    const beforeMi = new Map<number, number>();
    for (const d of w.days) beforeMi.set(d.dow, d.distanceMi);
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


    // BOUNDARY-OWNER-1 · RE-HOME WHAT THE TRIMMER FREED.
    //
    // A session that gave mileage back did so because its WORK got smaller, not
    // because the week should. Those miles are ordinary easy running and belong
    // on an easy day — Rule 12 ("easy running is sized before quality") and the
    // brief §5.3 ("surplus flows to eligible aerobic days").
    //
    // Leaving them unspent is NOT an option here, and the reason is worth
    // stating: the brief offers "bounded weekly underfill" as the alternative to
    // distorting a session, but this engine does not express that state.
    // `_quality_day` holds `|daySum − weeklyMi| < 0.6` and the conformance sweep
    // holds WEEKLY_NEQ_REALIZED at zero — 1,078 archetypes failed it the moment
    // the day was allowed to shrink without a home for the difference. Inventing
    // an underfill tolerance here would be a second volume truth (Constitution
    // §8), so the miles move instead.
    //
    // `w.weeklyMi` is DELIBERATELY NOT lowered to match. It is the week's TARGET
    // volume — the denominator every Daniels percentage cap is taken against and
    // what `vols`/`authored_state` snapshot. Lowering it would tighten those caps
    // by exactly the mileage just freed, so a session trimmed to the cap would
    // immediately breach the smaller cap; the sweep measured that feedback
    // directly (a marathon week went clean → "doses 1.99 mi at I on 24.2 mi/wk"
    // on the second pass).
    //
    // Bounded by invariants that already exist, not by new numbers: nothing
    // lands on a rest, race, shakeout or quality day; no easy day may reach the
    // week's long run (long-primacy); the top-up never exceeds what the week is
    // short; and it moves in the same half-mile grain `layoutWeek` sizes easy
    // days in.
    const daySum = w.days.reduce((acc, d) => acc + (d.distanceMi || 0), 0);
    let owed = Number((w.weeklyMi - daySum).toFixed(2));
    if (owed >= 0.05) {
      const longMi = Math.max(0, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi));
      // Largest first, so the week's general-aerobic days absorb before the
      // short recovery day after the long run — Rule 12's own shape: "a week has
      // a short recovery day after the long run and longer aerobic days
      // elsewhere".
      const takers = w.days
        .filter((d) => !d.isQuality && !d.isLong && d.type !== 'rest' && d.type !== 'race'
          && d.type !== 'shakeout' && d.distanceMi > 0)
        .sort((a, b) => b.distanceMi - a.distanceMi);
      for (let pass = 0; pass < 8 && owed >= 0.5; pass++) {
        let placed = false;
        for (const d of takers) {
          if (owed < 0.5) break;
          const room = longMi > 0 ? longMi - 0.5 - d.distanceMi : Infinity;
          if (room < 0.5) continue;
          d.distanceMi = Number((d.distanceMi + 0.5).toFixed(1));
          owed = Number((owed - 0.5).toFixed(2));
          placed = true;
        }
        if (!placed) break;
      }
      // THE WEEK COULD NOT TAKE IT · give the remainder back to the session it
      // came from, up to the size it was composed at.
      //
      // A three-day week is the case: long + two quality days and no standalone
      // easy day exists, so `takers` is empty and there is nowhere for the
      // freed mileage to go. Handing it back is the honest answer — the day
      // returns to exactly what it was before the trim and the week is
      // unchanged from `origin/main`. It is NOT a good answer (those miles are
      // still boundary running around a smaller block, which is the defect this
      // whole change is about), and the size of the remaining exposure is
      // counted by `_boundary_run`'s census rather than hidden here.
      //
      // Rule 11: this is a THIRD state — not "the trim did not fire" and not
      // "the surplus found a home", but "the week has no aerobic day to put it
      // on". The shrink is bounded by what the week can absorb rather than
      // being applied and then breaking `daySum ≈ weeklyMi`.
      if (owed >= 0.05) {
        for (const d of w.days) {
          if (owed < 0.05) break;
          const was = beforeMi.get(d.dow);
          if (was == null || !(was > d.distanceMi)) continue;
          const give = Math.min(owed, was - d.distanceMi);
          d.distanceMi = Number((d.distanceMi + give).toFixed(1));
          owed = Number((owed - give).toFixed(2));
        }
      }
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
 * The day's own distance never changes on a rep-set trim. What was hard
 * becomes easy inside the same session — fewer reps with a longer warm-up and
 * cool-down — which is what keeps every structural invariant intact and what
 * lets `applyDosingCaps` converge.
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
    // VARIETY-LONG-1 · a progression long carries TWO segments and the T tail
    // is the cheaper give-back: it is the smaller segment, it spends the
    // tighter budget (Daniels' 10% for T against the marathon-pace column),
    // and dropping it returns the session to §4.5's single-tag shape — a
    // workout doctrine still describes — instead of shaving both segments
    // into fragments. Only if the day is still over after the tail is gone
    // does the remaining finish come down, through the same setLongFinish
    // every single-segment long already goes through.
    const segs = String(day.subLabel ?? '').match(/(\d+(?:\.\d+)?)mi\s*@\s*(HM|MP|M|T)\b/gi);
    if (segs && segs.length >= 2) {
      const firstSeg = String(day.subLabel).match(/(\d+(?:\.\d+)?)mi\s*@\s*(HM|MP|M)\b/i);
      if (firstSeg) {
        setLongFinish(day, Number(firstSeg[1]),
          'dropped the progression tail to fit the week\'s dosing budget');
        const now = measure(day);
        if (now <= targetMi + 0.05) return now;
      }
    }
    setLongFinish(day, Math.max(0, Math.floor(targetMi * 2) / 2),
      "trimmed to Daniels' marathon-pace cap for the week");
    return measure(day);
  }

  // 2 · an explicit three-segment prescription ("2 mi WU · 4 mi @ T · 2 mi CD").
  //
  //     BOUNDARY-OWNER-1 (2026-09-02) · THE COOL-DOWN NO LONGER ABSORBS THE CUT.
  //
  //     This used to read `${cd + block - want} mi CD`, which kept the segments
  //     summing to a day whose total was never allowed to move — and produced
  //     "2.1 mi WU · 2 mi @ T · 2.1 mi CD" on the owner's live block, 4.2 miles
  //     of easy legs around 2.0 miles of threshold work. The legs are doctrine's
  //     (`Research/04` §5.2/§5.3, "2-3 mi E each side", spent at the bottom of
  //     the band by `quality-day.ts`), not a place to park unspent mileage.
  //
  //     The warm-up and cool-down now stay exactly as authored and the DAY comes
  //     down by the miles the block lost, so the label, the spec and the
  //     headline distance still describe one session (`totalDistanceMiFromSpec`
  //     sums exactly these three segments for a `tempo` spec). The week's target
  //     `weeklyMi` is deliberately NOT lowered with it: it is the denominator
  //     every Daniels percentage cap is taken against, and lowering it would
  //     tighten the cap by exactly the mileage just given back. The gap is the
  //     bounded weekly underfill the brief §5.3 prefers to a distorted session.
  const seg = label.match(/^([\d.]+) mi WU · ([\d.]+) mi @ ([A-Za-z]+) · ([\d.]+) mi CD$/i);
  if (seg) {
    const wu = Number(seg[1]);
    const block = Number(seg[2]);
    const cd = Number(seg[4]);
    const want = Math.max(0.5, Math.floor(targetMi * 2) / 2);
    if (want < block) {
      day.subLabel = `${wu} mi WU · ${want} mi @ ${seg[3]} · ${cd} mi CD`;
      day.distanceMi = Number((wu + want + cd).toFixed(1));
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
  //
  //     SPECFIRST-1's lesson, applied here (2026-08-28) · the count is not
  //     always at the front. This matched `/^(\s*)(\d+)(\s*[×xX])/` —
  //     anchored — so a label that opens with the day's MILEAGE ("2mi E w/
  //     6×2 min surges @ T effort") had NO trim lever at all: the cap pass
  //     found the day, called this function, and nothing moved. The count is
  //     the first `N×` followed by a rep SIZE (a digit), exactly the matcher
  //     expand-spec already uses for the same reconciliation.
  const reps = label.match(/(^|[^0-9])(\d+)(\s*[×xX])(?=\d)/);
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
        // The same unanchored matcher as above — rewriting only an anchored
        // leading count here is how a mileage-led label kept its six reps
        // while the loop counted down to one beside it.
        cur = cur.replace(/(^|[^0-9])\d+(\s*[×xX])(?=\d)/, `$1${n}$2`);
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
  //
  //     BOUNDARY-OWNER-1 (2026-09-02) · THE DAY COMES DOWN WITH THE BLOCK.
  //
  //     This is the branch that trimmed the owner's live 2026-09-08 session and
  //     left the day where it was:
  //
  //       composed   8.5 mi day · "4.5mi continuous tempo" (§5.2)
  //       Daniels' T cap on the 29.4 mi mini-taper week      2.94 mi
  //       trimmed    "2mi continuous tempo", DAY LEFT AT 8.5
  //       persisted  "2.1 mi WU · 2 mi @ T · 2.1 mi CD"
  //
  //     `buildWorkoutSpec` reads the block out of the label and splits whatever
  //     is left of the day between the warm-up and the cool-down, so 2.5 miles
  //     of threshold work the cap removed came back as easy legs. The runner
  //     reads a session whose jogging is twice its workout, and nothing chose
  //     it (brief §3.2.D; §5.3 rules the residual may not do this).
  //
  //     The day now loses exactly the miles the block lost. `weeklyMi` is
  //     deliberately not lowered with it — it is the denominator every Daniels
  //     percentage cap is taken against — so the gap is the bounded weekly
  //     underfill the brief prefers to a distorted session.
  const lead = label.match(/^(\s*)([\d.]+)\s*mi\b/i);
  if (lead && !/\bE\s+w\//i.test(label)) {
    const want = Math.max(0.5, Math.floor(targetMi * 2) / 2);
    const had = Number(lead[2]);
    if (want < had) {
      day.subLabel = label.replace(/^(\s*)[\d.]+(\s*mi\b)/i, `$1${want}$2`);
      day.distanceMi = Number(Math.max(0.5, day.distanceMi - (had - want)).toFixed(1));
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
/**
 * LONGRUN-ROWS-1 (2026-08-25) · §4.6'S DRESS REHEARSAL, RESTORED.
 *
 * `Research/04-workout-vocabulary.md` §4.6 is its own row of the long-run
 * table, and until now the engine had never read it:
 *
 *   | Purpose       | Final equipment, fueling, and timing rehearsal |
 *   | Distance      | 18-22 mi (marathon); 12-14 mi (HM) |
 *   | Structure     | Race-day breakfast, race-day kit, race-day fueling
 *                     intervals; segments at MP |
 *   | Pace          | Easy bulk + 2-3 segments at MP (4-8 mi total at MP) |
 *   | When in cycle | 3 weeks pre-marathon; before taper begins |
 *   | Contraindications | Not a fitness builder - keep effort controlled |
 *
 * `Research/08` §9.2's marathon taper table asks for the same session from the
 * other side: its -3 row pairs "Final MP-specific" with "Last long (20-22 mi)".
 *
 * WHY IT WAS MISSING. `longFinishSegment` returns null for TAPER, on a ruling
 * recorded beside `TAPER_MP_DOSE` that cites §16's "Fast finish long run before
 * goal race | Adds depletion in taper window". That is a true statement about
 * §4.5 and it is not a statement about §4.6 - see ./long-run-rows for the full
 * argument. The owner overturned the collapse on 2026-08-25.
 *
 * WHERE IT RUNS. After `enforceRampCeilingAfterEmbedding`, deliberately. On the
 * owner's block the three-weeks-out long is seven days after a B-race half, and
 * that pass strips a race-pace finish inside the post-race window. Authoring
 * the rehearsal BEFORE the strip would have it removed again by the rule that
 * removed §4.4's; authoring it after says what §4.6 says, which is that a
 * controlled four-to-eight-mile rehearsal is a different session from the
 * eight-to-sixteen-mile marathon-pace long the window is protecting him from.
 *
 * Still BEFORE `applyDosingCaps` and `applyIntensityFloor`, so Daniels' cap and
 * the 75% easy floor both get the last word - and if either shortens it, it now
 * says so (LONGRUN-TRACE-1).
 *
 * Keyed on DAYS BEFORE THE RACE rather than on a phase, because that is the
 * unit §4.6 states its placement in.
 */
function authorDressRehearsal(composed: ComposePlanResult, raceDistanceMi: number): void {
  // VARIETY-HMDR-1 (2026-08-28) · §4.6's Distance row names TWO races —
  // "18–22 mi (marathon); 12–14 mi (HM)" — and this pass honoured only the
  // first: `!== 'm'` returned early and a half build shipped with no fueling/
  // kit/timing rehearsal at all. The half now runs the same pass with its own
  // band; everything else — the three-weeks-out slot (§4.6 "3 weeks
  // pre-marathon; before taper begins", which for the half's shorter 10-14
  // day taper is likewise before the taper opens · Research/08 §9.1), the
  // MP-segment dose, the affordability pricing, the post-race softening — is
  // shared, because the doc states one session with two sizes.
  const drCat = distanceCategoryOf(raceDistanceMi);
  if (drCat !== 'm' && drCat !== 'hm') return;
  const drTotalBand = drCat === 'hm' ? DRESS_REHEARSAL.hmTotalMiBand : DRESS_REHEARSAL.totalMiBand;
  const raceISO = raceDayISO(composed);
  if (!raceISO) return;
  for (const w of composed.weeks) {
    if (w.isRaceWeek) continue;
    const long = w.days.find((d) => d.isLong && d.type === 'long' && d.distanceMi > 0);
    if (!long) continue;
    const daysToRace = daysBetween(dowDateInWeek(w.startISO, long.dow), raceISO);
    if (!isDressRehearsalSlot(daysToRace)) continue;
    // A long that already carries race pace is §4.4's session (or, on a half,
    // §4.5's fast finish) sitting in this slot. It is not upgraded and it is
    // not doubled: the cadence put it there.
    if (splitDay(long).qualityMi > 0) return;
    // AFFORDABILITY, BEFORE AUTHORING. `applyIntensityFloor` runs after this
    // and gives surplus hard miles back by shrinking exactly this segment, so a
    // rehearsal sized past the week's 75% easy floor would be authored and then
    // immediately shaved — "a floor that fires every single time is not a
    // safety net, it is the generator's real behaviour arriving through a
    // correction pass" (DOCTRINE-HMLONG-1's own words). The same reasoning
    // `select.ts#fits` applies to every other session: price it against what
    // the week may spend, and refuse rather than trim.
    const training = w.days.filter((d) => d.type !== 'race');
    const totals = training.reduce(
      (acc, d) => { const sp = splitDay(d); acc.easy += sp.easyMi; acc.hard += sp.qualityMi; return acc; },
      { easy: 0, hard: 0 },
    );
    const runningMi = totals.easy + totals.hard;
    const easyFloorHeadroomMi = runningMi > 0
      ? runningMi * (1 - EASY_SHARE_FLOOR) - totals.hard
      : 0;
    const budgetMi = Math.min(
      weeklyDoseBudgetMi(w.weeklyMi, 'M', w.phase === 'TAPER' ? 'taper' : 'training'),
      easyFloorHeadroomMi,
    );
    // Research/00b §"Recovery by Effort" · a rehearsal on legs still inside a
    // tune-up's no-quality window takes §4.6's slow edge. `enforceRampCeiling-
    // AfterEmbedding` has already removed §4.4's larger session from this day
    // for the same reason; the two rows are treated differently on purpose.
    const inPostRaceWindow = (
      ((composed.authoredState as Record<string, unknown>)?.embedded_races ?? []) as EmbeddedRaceSummary[]
    ).some((e) => {
      const gap = daysBetween(e.date, dowDateInWeek(w.startISO, long.dow));
      // RACEROLE-1 · window scaled by the ANSWERED effort, not the letter.
      return gap > 0 && gap <= postRaceNoQualityDaysImpl(e.distanceMi, effectiveRecoveryPriorityImpl(e));
    });
    /* ── MPSPACING-1 (2026-09-01) · §16 IS STATED IN DAYS, AND THIS PASS
     * CROSSES A WEEK BOUNDARY.
     *
     * `Research/04` §16: "MP long run + hard tempo within 5 days | Same energy
     * system, same impact pattern, no recovery between."
     *
     * The engine honours that INSIDE a week — `DOCTRINE-MPLONG-1` removes the
     * tempo slot from any week whose long carries marathon pace. This pass is
     * the one place a marathon-pace long is authored WITHOUT that check having
     * run, and it authors it on the last day of the last race-specific week:
     * §4.6 dates the rehearsal "3 weeks pre-marathon; before taper begins".
     * `taperMpDose` then puts §9.2's week-minus-3 session ("Final MP-specific
     * (14-16 mi w/ 10-12 mi at MP)") in the FIRST taper week, two days later.
     * Different weeks, so nothing looked.
     *
     * Measured on the owner's live CIM block `pln_9a57561debb776e5`:
     *   2026-11-15  LONG 16 mi · 4 mi @ MP      (this pass)
     *   2026-11-17  TEMPO 15 mi · 11 mi @ MP    (§9.2's session)
     * Fifteen marathon-pace miles across three days, entering a taper.
     *
     * ── WHICH SESSION YIELDS, AND WHY IT IS THIS ONE ─────────────────────────
     *
     * §9.2's session is dated by the taper structure and is the larger MP
     * rehearsal (11 mi against 4). §4.6's is the one doctrine itself says may
     * lose its race pace: its Contraindications row reads "Not a fitness
     * builder — keep effort controlled. If injury threat, skip MP segments",
     * and its stated Purpose is "Final equipment, fueling, and timing
     * rehearsal" — kit, race breakfast, fuelling intervals, none of which
     * needs marathon-pace miles to rehearse.
     *
     * So the rehearsal still happens, on the day doctrine dates it, doing the
     * job §4.6 names. It simply does not add a second marathon-pace session to
     * the three days before the taper's own. The runner loses no MP rehearsal:
     * they gain a bigger one two days later.
     *
     * NOT WIDENED BEYOND §16's OWN ROW. Only a QUALITY session carrying
     * marathon pace inside the window suppresses the segments — the row names
     * "hard tempo", not any hard day. A block with no such session is
     * byte-identical to before. */
    const rehearsalISO = dowDateInWeek(w.startISO, long.dow);
    const collidingMp = composed.weeks.flatMap((wk) => {
      const startDow = new Date(wk.startISO + 'T12:00:00Z').getUTCDay();
      return wk.days
        .filter((d) => d.isQuality && !d.isLong && d.type !== 'race' && /@\s*MP?\b/i.test(String(d.subLabel ?? '')))
        .map((d) => ({
          dateISO: addDays(wk.startISO, ((d.dow - startDow) % 7 + 7) % 7),
          label: String(d.subLabel ?? ''),
        }));
    }).find((q) => {
      const gap = Math.abs(daysBetween(rehearsalISO, q.dateISO));
      return gap > 0 && gap < MP_LONG_TEMPO_MIN_GAP_DAYS;
    });

    if (collidingMp) {
      long.longRunKind = 'dress_rehearsal';
      // No `@ MP` in the label: `splitDay` reads the segment back out of it,
      // so a label promising race pace the day does not carry would put the
      // miles into every dosing and intensity count (Rule 16 · the label and
      // the spec are one set of numbers).
      long.subLabel = 'LONG';
      long.notes =
        'Dress rehearsal · Research/04 §4.6. Race kit, race breakfast, race fuelling, race-day '
        + 'timing. Run it all at easy effort. The marathon-pace rehearsal is the session two days '
        + 'later, and Research/04 §16 keeps the two apart.';
      return;
    }

    const dose = dressRehearsalDose(long.distanceMi, budgetMi, FAST_FINISH_MIN_MI, inPostRaceWindow, drTotalBand);
    if (!dose) return;
    long.longRunKind = 'dress_rehearsal';
    long.subLabel = `LONG · ${dose.mpMi}mi @ MP`;
    // §4.6's own contraindication row, in the coach's voice. The runner is
    // told this is a rehearsal, not a test, which is the whole difference
    // between this row and §4.5's.
    long.notes =
      `Dress rehearsal · Research/04 §4.6. Steady ${dose.easyMi}mi, then ${dose.mpMi}mi at marathon pace. `
      + 'Race kit, race breakfast, race fuelling. Controlled effort, not a fitness test.';
    return;
  }
}

/**
 * MPSPACING-1 · `Research/04` §16's own window, in days.
 *
 * "| MP long run + hard tempo within 5 days | Same energy system, same impact
 * pattern, no recovery between |". Bound by `LONGRUN.mp-tempo-spacing` in
 * lib/doctrine/registry.ts, which parses the number out of that row rather
 * than trusting this copy.
 */
export const MP_LONG_TEMPO_MIN_GAP_DAYS = 5;

/**
 * DOWNHILL-2 (2026-08-29) · PROMOTE ONE RACE-PACE LONG TO THE DOWNHILL
 * SIMULATION, on a race that actually descends.
 *
 * Research/11's protocol names this session once and dates it: "Weeks 7-8:
 * peak — 1 long downhill simulation (race pace)", bounded on the other side by
 * §"Avoid the Late-Taper Trap" — "the last race-pace downhill should be 2-3
 * weeks out".
 *
 * WHY THIS IS A PASS AND NOT A ROTATION CANDIDATE. The long-run rotation is
 * least-recently-used across §4's variants, which is right for sessions
 * doctrine offers as interchangeable shapes ("Don't make every long run a
 * progression — rotate"). This is not one of those. It is prescribed ONCE, at a
 * stated time, for a stated reason, and leaving it to LRU meant it never
 * appeared at all: a marathon build has only two or three race-pace longs in
 * the specific phase and the rotation spent them on §4.4 and §11.1. A session
 * doctrine schedules by date has to be placed by date.
 *
 * NO NEW LOAD. It promotes a long that is ALREADY carrying race pace — the
 * cadence machinery put the session there and sized it — and changes only the
 * kind and the note. Research/11 asks for the runner to be somewhere specific,
 * not to run more.
 */
function authorDownhillSimulation(
  composed: ComposePlanResult,
  terrain: CourseTerrain,
  raceDistanceMi: number,
): void {
  if (terrain.shape !== 'net_downhill' || !terrain.trusted) return;
  const cat = distanceCategoryOf(raceDistanceMi);
  if (cat !== 'm' && cat !== 'hm') return;
  const raceISO = raceDayISO(composed);
  if (!raceISO) return;

  // The doc's own window, in days. Its far edge is the protocol's "weeks 7-8"
  // peak; its near edge is the late-taper trap's "2-3 weeks out" floor. The
  // dress rehearsal owns 3 weeks out (§4.6, `isDressRehearsalSlot`), so this
  // takes the latest qualifying long STRICTLY EARLIER than that — the two
  // sessions rehearse different things and must not fight over one day.
  const NEAR_DAYS = 25;
  const FAR_DAYS = 45;

  let best: { day: DayPlan; days: number } | null = null;
  for (const w of composed.weeks) {
    if (w.isRaceWeek) continue;
    const long = w.days.find((d) => d.isLong && d.type === 'long' && d.distanceMi > 0);
    if (!long) continue;
    // Already carrying race pace: this promotes, never creates. A plain easy
    // long is not upgraded, because that would add a hard session the week was
    // not budgeted for.
    if (splitDay(long).qualityMi <= 0) continue;
    // Do not steal the dress rehearsal's day, and do not overwrite §11.1's
    // modified block — both are sessions in their own right.
    if (long.longRunKind === 'dress_rehearsal' || long.longRunKind === 'modified_block') continue;
    const days = daysBetween(dowDateInWeek(w.startISO, long.dow), raceISO);
    if (days < NEAR_DAYS || days > FAR_DAYS) continue;
    // Latest inside the window · closest to the protocol's peak without
    // crossing into the taper trap.
    if (!best || days < best.days) best = { day: long, days };
  }
  if (!best) return;

  best.day.longRunKind = 'downhill_simulation';
  best.day.notes = `${best.day.notes ?? ''} Run the race-pace section on terrain that descends `
    + `like your course. Quads will feel this more than the pace suggests; that is the session `
    + `working, and it is what stops the same damage arriving at mile 20 on race day. Last `
    + `race-pace downhill of the block. Keep the taper's downhill running short and easy.`.trim();
}

/** The plan's own race day, or null for a goal-mode or open block. */
function raceDayISO(composed: ComposePlanResult): string | null {
  for (let i = composed.weeks.length - 1; i >= 0; i--) {
    const w = composed.weeks[i];
    if (!w.isRaceWeek) continue;
    const race = w.days.find((d) => d.type === 'race');
    if (race) return dowDateInWeek(w.startISO, race.dow);
  }
  return null;
}

/**
 * COURSE-PLAN-1 (2026-08-25) · THE LONG RUNS LEARN WHAT THE COURSE IS.
 *
 * `Research/11-course-specific-training.md` §"Net-Downhill Training
 * Adjustments" states the dose in the long run's own units:
 *
 *   "60-80% of long-run mileage should occur on terrain with similar grade to
 *    the race's average descent."
 *
 * and §"Avoid the Late-Taper Trap" states the exception:
 *
 *   "A heavy downhill session inside ~10 days of race day risks racing on quads
 *    still impaired by EIMD. The last race-pace downhill should be 2-3 weeks
 *    out; final downhill running in the taper is short and easy."
 *
 * `Research/08` §4.5 says why it is not optional for this class of course:
 * "0% or negative for untrained".
 *
 * GUIDANCE, NOT ARITHMETIC. This appends a sentence to the long run's notes and
 * changes no distance, no pace and no structure. Rule 1: the elevation quoted
 * is MEASURED off the runner's own course file and reads as measured, and no
 * pace adjustment is derived from it, because doctrine's instruction here is
 * about terrain rather than time. `trusted` gates it regardless - a
 * low-confidence trace may be SHOWN but may not move a prescription
 * (`elevationIsTrustedForAdjustment`).
 *
 * Runs dead last, after every pass that can rewrite a long run's notes.
 */
function applyCourseGuidance(
  composed: ComposePlanResult,
  terrain: CourseTerrain,
  raceDistanceMi: number,
): void {
  if (terrain.shape !== 'net_downhill' || !terrain.trusted) return;
  if (distanceCategoryOf(raceDistanceMi) === 'ultra') return;
  const raceISO = raceDayISO(composed);
  if (!raceISO) return;
  const drop = terrain.netFt != null ? `${Math.abs(terrain.netFt)} ft` : 'a net drop';
  const sharePct = Math.round(NET_DOWNHILL_LONG_RUN_SHARE * 100);
  for (const w of composed.weeks) {
    if (w.isRaceWeek) continue;
    const long = w.days.find((d) => d.isLong && d.type === 'long' && d.distanceMi > 0);
    if (!long) continue;
    const daysToRace = daysBetween(dowDateInWeek(w.startISO, long.dow), raceISO);
    // §"Avoid the Late-Taper Trap" - the last ten to fourteen days.
    long.notes += daysToRace <= LATE_TAPER_DOWNHILL_DAYS
      ? ` Course drops ${drop}. Downhill running stays short and easy from here · Research/11 §late-taper trap.`
      : ` Course drops ${drop}. Run at least ${sharePct}% of this on downhill-similar terrain · Research/11 §net-downhill adjustments.`;
  }
}

/**
 * COURSE-PLAN-1 · "60-80% of long-run mileage should occur on terrain with
 * similar grade to the race's average descent" (`Research/11` §"Net-Downhill
 * Training Adjustments").
 *
 * The band's LOW edge. The high edge describes a runner who can find that much
 * of the right terrain; the low edge is the instruction that holds for everyone,
 * and over-prescribing terrain a runner does not have is how a plan stops being
 * followed. Bound by `COURSE.net-downhill-long-run-share`.
 */
export const NET_DOWNHILL_LONG_RUN_SHARE = 0.60;

/**
 * COURSE-PLAN-1 · "A heavy downhill session inside ~10 days of race day risks
 * racing on quads still impaired by EIMD" (`Research/11` §"Avoid the Late-Taper
 * Trap"). The same row's next sentence gives the other end - "the last
 * race-pace downhill should be 2-3 weeks out" - so the window closes somewhere
 * in ten-to-fourteen days and this takes the SAFE edge of it, fourteen.
 * Bound by `COURSE.late-taper-downhill-window`.
 */
export const LATE_TAPER_DOWNHILL_DAYS = 14;

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
    setLongFinish(long, newFinish, 'gave hard miles back to hold the 75% easy floor');
  }
}

/**
 * Rewrite a long-run day's finish segment to `finishMi` miles (0 removes it).
 * sub_label is the ONLY carrier of the finish between compose and persist —
 * `buildWorkoutSpec`'s `extractFinishSegment` reads it back out — so the label
 * and the notes are rewritten together and there is no third place to drift.
 */
function setLongFinish(day: DayPlan, finishMi: number, reason = 'unrecorded'): void {
  const tagMatch = String(day.subLabel ?? '').match(/mi\s*@\s*(HM|MP|M)\b/i);
  const tag = tagMatch ? tagMatch[1].toUpperCase() : 'MP';
  // VARIETY-LONG-1 · was the label a two-segment progression before this call?
  // Any rewrite below collapses it to one segment, and the row identity must
  // follow the shape (§4.3's identity IS the two-pace walk). The 10K's fixed
  // single-segment tail also carries kind 'progression' and is untouched here.
  const wasTwoSegment =
    (String(day.subLabel ?? '').match(/mi\s*@\s*(HM|MP|M|T)\b/gi) ?? []).length >= 2;
  // LONGRUN-TRACE-1 · what this call is about to change, recorded before it
  // changes it. `splitDay` reads the segment back out of the sub_label, which
  // is where it lives between compose and persist.
  const beforeMi = splitDay(day).qualityMi;
  // DOCTRINE-DOSING-2 · the same floor `layoutWeek` authors to, applied to
  // every later trim. `Research/04` §4.5 states the segment as "final 2-6 mi at
  // MP or slightly faster", so a give-back that would leave less than two miles
  // removes the finish instead of shipping a mile of race pace under a label
  // that promises a session. Both the intensity floor and the dosing pass reach
  // this function, and neither should be able to invent a shape doctrine does
  // not describe.
  if (finishMi > 0 && finishMi < FAST_FINISH_MIN_MI) finishMi = 0;

  /* SEGLONG-2 (2026-08-29) · SHRINK §11.1's MODIFIED BLOCK, DO NOT FLATTEN IT.
   *
   * Every rewrite below collapses a multi-segment label to one finish, which
   * is right for a progression — §4.3 walks its paces continuously to the end,
   * so a trimmed one really is §4.5's single-tag finish. It is wrong for the
   * modified block, whose identity is the GAP: "two segments separated by short
   * rest". Flattening it does not shorten the session, it deletes it.
   *
   * And the trims that reach here are routine. Measured on an 18-week advanced
   * marathon build: the easy-floor give-back took 0.5 mi off the long in two
   * separate weeks, one of which was the block. A session doctrine prescribes
   * two or three times a cycle cannot survive being destroyed by a half-mile.
   *
   * So the give-back comes out of the SECOND block, which is the doctrinally
   * correct place for it — the first block is what fatigues the legs and the
   * second is what is run on them, so shortening the second preserves the
   * stimulus while shortening the third that is being paid for. Below the
   * two-mile floor there is no second block left and the shape genuinely is
   * gone, so it falls through to the flatten-and-re-identify path.
   */
  if (finishMi > 0 && day.longRunKind === 'modified_block') {
    const parts = String(day.subLabel ?? '')
      .match(/([\d.]+)\s*mi\s*@\s*(HM|MP|M|T|E)\b/gi) ?? [];
    if (parts.length === 3) {
      const num = (s: string) => Number(/([\d.]+)/.exec(s)![1]);
      const [authoredFirstMi, gapMi] = [num(parts[0]), num(parts[1])];
      /*
       * ROTATION-REFUSE-1 (2026-08-29) · RE-SPLIT before flattening.
       *
       * Taking the give-back off the second block alone is the doctrinally
       * preferred cut and it stays the first choice, for the reason above. But
       * as the ONLY choice it left the session with no headroom at all: the
       * first block is authored at 60% of the finish, so on the six-mile
       * finish an 18-week 40 mi/wk build actually buys — 3.5 + 1 + 2.5 — a
       * routine half-mile give-back drops the second block to 2.0 and the next
       * one to 1.5, below §4.5's floor, and the shape was deleted. Measured on
       * that build: §11.1 was authored at week 8 and flattened before persist,
       * so the plan carried `fast_finish` twice and never ran the block or the
       * §4.3 progression it had displaced.
       *
       * Two real blocks are still two real blocks at a different split. So
       * when the preferred cut would kill the second one, re-apply the doc's
       * own 60:40 proportion to what the finish is NOW, floored so that each
       * block clears §4.5. Only below two floors' worth of finish is there
       * genuinely no second block left, and only then does it flatten.
       */
      const zone = /@\s*(HM|MP|M)\b/i.exec(parts[0])?.[1]?.toUpperCase() ?? 'M';
      const emitKind = day.longRunKind;
      const emit = (a: number, bMi: number) => {
        day.racePaceChange = { fromMi: splitDay(day).qualityMi, toMi: finishMi, reason, kind: emitKind };
        day.subLabel = `LONG · ${a}mi @ ${zone} + ${gapMi}mi @ E + ${bMi}mi @ ${zone}`;
        // SEGLONG-3 (2026-08-30) · THE NOTES COME WITH THE LABEL.
        //
        // This function's own header states the contract — "the label and the
        // notes are rewritten together and there is no third place to drift" —
        // and the flatten path at the bottom honours it. This re-split path,
        // added by SEGLONG-2/ROTATION-REFUSE-1, rewrote the label and returned,
        // leaving `layoutWeek`'s note describing the segments the day USED to
        // carry.
        //
        // Observed on the owner's CIM authoring (2026-08-30, week of 10-05):
        // the easy-floor give-back cut the race-pace work from 10 mi to 5 and
        // re-split it 3 + 1 + 2, and the note still read "then 7mi at marathon
        // effort ... then 5mi at marathon effort" — twelve miles of marathon
        // pace promised in prose on a day whose spec, which is built from the
        // sub_label, prescribes five. The runner reads the note; the watch runs
        // the label. On the §11.1 modified block, three times a cycle.
        //
        // Rebuilt in `layoutWeek`'s own words with the new numbers. The
        // goal-vs-current-fitness qualifier is carried forward off the note
        // being replaced (the MPLABEL-1 technique used at the foot of this
        // function) because a give-back pass has no access to the week's pace
        // anchors. Anything the composer appended after the authored sentence
        // group — the `Research/11` terrain instruction, for one — is a
        // property of the DAY, not of the segment sizing, so it is preserved.
        const paceWord = zone === 'HM' ? 'half-marathon pace'
          : /marathon effort for your current fitness/i.test(String(day.notes ?? ''))
            ? 'marathon effort for your current fitness'
            : 'marathon pace';
        const easyMi = Math.max(0, Math.round((day.distanceMi - a - gapMi - bMi) * 10) / 10);
        const TAIL = 'so keep the easy mile honest and short.';
        const prior = String(day.notes ?? '');
        const cut = prior.indexOf(TAIL);
        const suffix = cut >= 0 ? prior.slice(cut + TAIL.length) : '';
        day.notes =
          `Modified block. Easy ${easyMi}mi, then ${a}mi at ${paceWord}, ${gapMi}mi easy, ` +
          `then ${bMi}mi at ${paceWord}. The second block is the session: you are practising ` +
          `getting back to race pace on tired legs, ${TAIL}${suffix}`;
      };
      const trimmedSecondMi = Math.round((finishMi - authoredFirstMi) * 2) / 2;
      if (trimmedSecondMi >= FAST_FINISH_MIN_MI && authoredFirstMi >= FAST_FINISH_MIN_MI) {
        emit(authoredFirstMi, trimmedSecondMi);
        return;
      }
      if (finishMi >= 2 * FAST_FINISH_MIN_MI) {
        const firstMi = Math.max(
          FAST_FINISH_MIN_MI,
          Math.min(finishMi - FAST_FINISH_MIN_MI, Math.round(finishMi * 0.6 * 2) / 2),
        );
        const secondMi = Math.round((finishMi - firstMi) * 2) / 2;
        if (firstMi >= FAST_FINISH_MIN_MI && secondMi >= FAST_FINISH_MIN_MI) {
          emit(firstMi, secondMi);
          return;
        }
      }
    }
  }

  const trace = (toMi: number) => {
    if (Math.abs(beforeMi - toMi) < 0.05) return;
    day.racePaceChange = { fromMi: beforeMi, toMi, reason, kind: day.longRunKind ?? null };
  };
  if (finishMi <= 0) {
    trace(0);
    day.subLabel = 'LONG';
    day.notes = 'Conversational throughout. Build the engine.';
    // The row identity goes with the segment it described.
    day.longRunKind = null;
    return;
  }
  trace(finishMi);
  const easyMi = Math.max(0, Math.round((day.distanceMi - finishMi) * 10) / 10);
  day.subLabel = `LONG · ${finishMi}mi @ ${tag}`;
  // VARIETY-LONG-1 · a rewrite to a single segment is no longer §4.3's
  // two-pace progression; what remains is §4.5's single-tag finish, and the
  // row identity follows the shape it now describes.
  if (wasTwoSegment && day.longRunKind === 'progression') day.longRunKind = 'fast_finish';
  // SEGLONG-2 (2026-08-29) · the same rule for §11.1's modified block, and it
  // matters more here. A progression collapsed to one segment is at least
  // still continuous quality; a modified block collapsed to one segment has
  // lost the ONLY thing that made it that session — the gap. "Two segments
  // separated by short rest" with the rest removed is a marathon-pace long
  // run, and calling it a modified block would have the plan claiming a
  // stimulus (returning to race pace on tired legs) the runner is not being
  // given. Observed live: a 0.5-mile dosing give-back collapsed the shape and
  // left the kind behind, so the day read `modified_block` over a label with
  // no easy block in it.
  //
  // `downhill_simulation` deliberately does NOT re-identify: its identity is
  // the terrain it is run on, not its segment count, so a trimmed one is still
  // the session Research/11 asked for.
  if (wasTwoSegment && day.longRunKind === 'modified_block') day.longRunKind = 'fast_finish';
  // MPLABEL-1 · this function REWRITES a note `layoutWeek` already wrote, and
  // that note is the only place the goal-vs-current-fitness qualifier exists by
  // the time a trim runs. Re-deriving it here would need the week's pace
  // anchors, which a give-back pass walking finished days does not have — so
  // the qualifier is carried forward off the note being replaced. Exactly the
  // reasoning in this function's own header: the label and the notes are
  // rewritten together so there is no third place to drift.
  const wasCurrentFitness = /marathon effort for your current fitness/i.test(String(day.notes ?? ''));
  const finishPhrase = tag === 'HM' ? 'half-marathon pace'
    : wasCurrentFitness ? 'marathon effort for your current fitness'
    : 'marathon pace';
  day.notes = `Steady ${easyMi}mi, then ${finishMi}mi at ${finishPhrase}.`;
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

  // 2026-06-03 · Rules 12 + 13 · pick plan mode based on temporal context.
  // race-prep: race is within build window
  // maintenance: race is too far out · hold aerobic base
  // recovery: another race finished recently · 1-2 week light-running
  //
  // BLOCKANCHOR-1 (2026-09-02) · this read moved ABOVE `loadGeneratorInputs`
  // because the anchor decision needs it. Same reader, same arguments, one
  // fewer call than before (`loadGeneratorInputs` also asked it, for RULE8-1).
  const todayISO = await runnerToday(userId);
  const { lastRaceFinished: dbLastRace, lastRaceDistanceMi: dbLastRaceMi } = await loadLastRaceFinished(userId, todayISO);

  // BLOCKANCHOR-1 · WHEN A BLOCK ALREADY EXISTS, ITS REBUILD BEGINS WHERE IT
  // BEGAN. Resolved HERE, at the one chokepoint every authoring path passes
  // through, rather than wired per route: the coverage matrix in
  // `docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md` and COACHED-GATE-1's own history
  // both say a rule wired at each route is a rule that misses the routes
  // nobody remembered. Onboarding is excluded by its own `startAnchor:
  // 'today'`, and every refusal carries a named reason (Rule 11) which
  // `scripts/p0-proof/rebuild-anchor-acceptance.ts` prints.
  const anchorRead = await resolveBlockAnchor({
    userId, todayISO, startAnchor, startDateISO,
    target: {
      raceSlug,
      goalRaceDateISO: goalTarget?.raceDateISO,
      isOpenBlock: !!openTarget,
    },
    lastFinishedRaceISO: dbLastRace?.date ?? null,
  });
  const blockAnchorISO = anchorRead.preserved ? anchorRead.anchorISO : null;

  // 1. Load all DB-sourced inputs into a pure-data bundle.
  const inputs = await loadGeneratorInputs(userId, raceSlug, startAnchor, startDateISO, goalTarget, openTarget, blockAnchorISO);
  if (!inputs.ok) return { ok: false, reason: inputs.reason };

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
    // lifted the base — the base-rebuilt gate in `composePlan` needs the
    // comparison the evidence carries (this runner's 28-day mean against this
    // runner's own sustained level) even on the authorings where the ramp
    // itself did not move.
    //
    // CONTINUOUS-RESTORE-1 (2026-08-30) · `rampBaseMi` was conditional on
    // `ramp.lifted` too, and that was the quietest of the five places one
    // near-tie switched a behaviour: when false the base was never passed at
    // all, so `volumeCurve(input.rampBaseMi ?? input.recentWeeklyMi, …)` fell
    // back to the 28-day mean and the whole RAMPBASE-1 mechanism disengaged —
    // for precisely the runners sitting near the threshold, who are the ones it
    // was built for. It is now always passed. This is byte-identical wherever
    // nothing lifts the base: `resolveRampBase` is handed `recentWeeklyMi` as
    // its mean and returns exactly that as `baseMi` when neither the resume
    // level nor demonstrated volume clears it, so the `??` fallback and the
    // value now supplied are the same number.
    inputs.compose.rampBaseMi = ramp.baseMi;
    inputs.compose.rampBaseEvidence = ramp;
  }

  /* AUTHORING-CANONICAL-1 (2026-09-01) · THE MEASURED-PROGRESS GATE IS DELETED,
   * NOT MOVED, BECAUSE THE THING IT GATED IS GONE.
   *
   * It existed to cap the per-week `currentT → goalT` blend on a mid-block
   * rebuild: measured progress = the share of the (goalVdot − seasonAnchor)
   * gap the runner had actually banked, plus a 15% grace. That was a careful,
   * well-argued mechanism for keeping a goal-driven pace ramp honest — and the
   * pace ramp itself is what Constitution §G forbids. The 2026-09-01
   * independent audit measured it firing on the owner's own live plan: at
   * `measured_progress_fraction = 0`, on ZERO demonstrated progress, the grace
   * alone moved his prescribed threshold pace 3 s/mi toward a 3:00 marathon
   * goal, with a ceiling of 20 s/mi on that block and more on a longer one.
   * It could also only ever move paces FASTER — `BRK-1` kept current fitness
   * whenever the goal was slower — so the goal was a one-way ratchet on
   * training intensity.
   *
   * `recomputePacesForPlan` deleted its half of this on 2026-08-31 ("this path
   * no longer reads a goal at all"). Authoring was the remaining half, which
   * is precisely the §8 state where two paths disagree about whether the goal
   * may touch a training pace depending on which ran last. Both are now silent.
   *
   * WHAT SURVIVES, AND WHERE. The season anchor itself is still recorded —
   * `pace_blend.season_anchor_vdot` / `season_anchor_source` — because a
   * BASELINE to measure progress against is a real and useful thing that the
   * adaptation engine and the projection surfaces read. It is now written from
   * the canonical threshold capacity's own derived VDOT and its own source
   * mode (see `composePlan`), which is a stronger provenance than the
   * three-rung inheritance this block performed: rung 2 could and did launder
   * a typed PR into a season baseline (`SELFREPORT-1`), and the canonical
   * resolver cannot, because `user_prior` is a distinct mode by construction.
   */

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
    // GOALVOL-1 · maintenance and recovery read `MAINTENANCE_BY_TIER` and
    // `TIER_TARGETS[holdCat][tier]` off this value, both of which are LOAD
    // tables (days per week, quality per week, long share, the hold's own
    // volume curve). Same seal as the race path.
    const tier = resolveLoadTier({
      raceDistanceMi: inputs.compose.raceDistanceMi,
      level: inputs.compose.level,
      demonstratedPaceSec: nrDemonstrated,
      goalPaceSec: inputs.compose.goalPaceSec,
    }).tier; // VAR-01 + COLD-1 + GOALVOL-1
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
      return { ok: false, reason: 'could not read your training history · the plan you have stands' };
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
    finalizeComposedPlan(composed, inputs.compose.raceDistanceMi, inputs.compose.level,
      inputs.compose.courseTerrain ?? UNKNOWN_TERRAIN);
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
  /**
   * B2 (2026-09-02) · the prescribed race target, from its ONE owner, resolved
   * before the transaction opens. `race-outlook` reads no plan data (it reads
   * runs, races and profile), so its answer here is byte-identical to the one
   * `refreshRaceRowsForPlan` produces post-persist inside the transaction —
   * which is exactly why seeding from it removes a second record rather than
   * adding a second derivation.
   */
  const raceSeed = await (async () => {
    const { resolveAuthoringRaceSeed } = await import('@/lib/race/race-row-refresh');
    return resolveAuthoringRaceSeed(userId, raceSlug ?? null, todayISO);
  })();
  if (!raceSeed.ok && raceSlug) {
    console.error(`[persistComposedPlan] race seed REFUSED · plan for ${userId} race=${raceSlug} · ${raceSeed.reason}${raceSeed.detail ? ` · ${raceSeed.detail}` : ''} · the race row is authored with no prescribed target and refreshRaceRowsForPlan will report the same refusal`);
  }
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
      todayISO,
      blocks: composed.blocks,
      weeks: composed.weeks.map((w) => ({
        // 2026-06-06 · Audit C C1-1f · pass the per-week blended tPaceSec
        // through to persistPlan. Was stripped here → persistPlan fell back
        // to plan-wide goalT for every week → flat goal-pace plan (the
        // Rule 3 ramp was computed in composePlan then discarded at persist).
        startISO: w.startISO, phase: w.phase, days: w.days, isRaceWeek: w.isRaceWeek, tPaceSec: w.tPaceSec,
      })),
      tPaceSec: inputs.compose.tPaceSec,
      // AUTHORING-CANONICAL-1 · THE SECOND OF THREE COPIES OF ONE COMPUTATION,
      // DELETED. This was `resolveCurrentTPace(...)` again, with a comment
      // saying it "must match" `composePlan`'s internal copy — a Rule 16
      // violation that named itself. The composer now RETURNS the anchors it
      // priced the block at, so there is nothing left to keep in sync.
      //
      // The value is the canonical EASY CEILING, not a threshold pace: every
      // easy, long and recovery band in `buildWorkoutSpec` opens on it, and
      // `resolveEasyCeiling` is the service that owns that question. The old
      // argument handed it a THRESHOLD pace and let the offsets manufacture an
      // easy band — the "one formula for every runner" shape the whole
      // prescription layer exists to replace.
      easyAnchorTSec: composed.paceAnchors?.easyCeilingSecPerMi ?? null,
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
      // B2 (2026-09-02) · THE SEED COMES FROM THE OWNER, NOT FROM
      // `authored_state`. This used to read `prescribed_race_pace.pace_s_per_mi`
      // — `achievableRaceTarget`'s number — back out of the state this compose
      // had just authored. That made the plan hold TWO records of the
      // prescribed race target: on the owner's block, `authored_state` said
      // 436 s/mi (11430 s, `ceiling_vdot 47.1`, already stale against a live
      // 47.8) while `refreshRaceRowsForPlan` wrote 443 s/mi (11610 s) onto the
      // row. Which one the runner got depended on whether the refresh had run
      // since authoring. `authored_state.prescribed_race_pace` is PROVENANCE
      // now — what the runway said when the block was authored — and nothing
      // reads it back as a value.
      //
      // `raceSeed` is resolved by `race-outlook` (the canonical owner) before
      // the transaction, and the same resolver writes the row again seconds
      // later inside it, so the two cannot disagree. A refusal seeds null and
      // the race branch falls back exactly as it did with no goal (Rule 11:
      // a refusal is not a number).
      prescribedRacePaceSec: raceSeed.ok ? raceSeed.paceSecPerMi : null,
      // R3 + PACE-I-1 (2026-06-23) · 5K/10K/HM race goals get true VO2max I-pace intervals. HM was
      // excluded, but its quality day is explicitly labeled "6×800m @ I pace" (inlinePrescriptions) —
      // with iPace null it shipped the cruise T−18 default: a +6..+28 s/mi too-slow "VO2max" rep that
      // contradicts its own label (Research/22:187,194,206,213 · HM I-reps ≈ 5K-10K race pace).
      // Marathon/ultra keep the cruise default (their label is "I-T transition", not "@ I pace").
      // AUTHORING-CANONICAL-1 · the six canonical prices this compose was
      // authored at, carried to the row so the persisted spec and the in-memory
      // composition cannot be priced off different fitness (Rule 16).
      anchors: composed.paceAnchors ?? null,
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
        /**
         * AUTHORING-CANONICAL-1 (2026-09-01) · RULE 10'S STAMP · WHAT THIS
         * BLOCK WAS ACTUALLY PRICED AT, AND BY WHICH BRAIN.
         *
         * `lib/adaptation/authoring-convergence.ts` was built with an
         * `AUTHORED_CANONICALLY` state that was, in its own header's words,
         * "structurally unreachable today". This is the mark that makes it
         * reachable: a plan carrying `pace_authoring.source === 'canonical'`
         * has been through `resolvePrescribedPaceAnchors` at composition time
         * and needs no reanchor to converge, because there was never a second
         * brain to converge with.
         *
         * Rule 10 proper: the six prices are stamped WITH their basis (source
         * mode, confidence, the derived VDOT, the fitted endurance exponent),
         * so a later reader can tell a stale price from a current one by
         * looking rather than by inferring — the exact failure `hrZonePcts`
         * and `hr_cap_bpm` shipped.
         */
        pace_authoring: composed.paceAnchors != null
          ? {
              source: 'canonical' as const,
              // The key `authoring-convergence.ts` already checks for. Named
              // rather than renamed: that guard was written first and its
              // predicate is the contract.
              authored_directly: true,
              at: new Date().toISOString(),
              anchors: {
                threshold_s_per_mi: composed.paceAnchors.thresholdSecPerMi,
                interval_s_per_mi: composed.paceAnchors.intervalSecPerMi,
                repetition_s_per_mi: composed.paceAnchors.repetitionSecPerMi,
                easy_ceiling_s_per_mi: composed.paceAnchors.easyCeilingSecPerMi,
                shakeout_ceiling_s_per_mi: composed.paceAnchors.shakeoutCeilingSecPerMi,
                marathon_s_per_mi: composed.paceAnchors.marathonSecPerMi,
                basis: composed.paceAnchors.basis,
              },
              model: 'prescription_resolver',
            }
          // Rule 11 · an explicit null, never an omitted key. "This composer
          // returned no anchors" and "this plan predates the stamp" are two
          // different facts and a reader must be able to tell them apart.
          : null,
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

    /* ── RACE-ROW REFRESH SEAM · Phase 3 (`feat/race-pace-brain`) ────────────
     *
     * THE ONE LINE THAT GOES HERE, from the race-pace-brain coordinator:
     *
     *   await refreshRaceRowsForPlan(planId, { client, todayISO });
     *
     * inside this transaction (the standalone form routes itself through its
     * own `mutatePlan` with `touches: 'derivations'`, which would nest here).
     * It belongs AFTER the mode write and BEFORE the commit gate below, so the
     * gate compares the plan as it will actually be read.
     *
     * IT IS NOT ADDED YET, and the reason is Rule 19's discipline rather than
     * an oversight: `lib/race/race-row-refresh.ts` does not exist on `origin`
     * at the time of writing (`git ls-remote --heads origin` has no
     * `feat/race-pace-brain`), so importing it would break `tsc --noEmit` and
     * `next build` on this branch and every verification claim in this pass
     * would be unrunnable. A call to a module that is not there is not a
     * seam, it is a broken build.
     *
     * WHAT THIS BRANCH GUARANTEES IN THE MEANTIME: the authoring-time race row
     * is a SEED and nothing here competes with the refresh for authority. The
     * migration deleted every goal→training-pace derivation and added none;
     * the only `achievableRaceTarget` call left in authoring is the one that
     * was already there (`composePlan`'s RACEPACE-1 bound), it still receives
     * the same provisional-anchor gate, and the shadow compare asserts the
     * race row moved by 0 s/mi on every real account and across the archetype
     * corpus. Merging Phase 3 on top of this is a one-line insertion at this
     * comment.
     */
    // 2026-09-01 · THE ONE LINE. Race rows are priced by the race-pace brain
    // through the dedicated canonical path, inside this transaction, before
    // the commit gate compares the plan as it will be read.
    {
      const { refreshRaceRowsForPlan } = await import('@/lib/race/race-row-refresh');
      await refreshRaceRowsForPlan(planId, { client, todayISO, source: 'authoring' });
    }

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
  /**
   * BLOCKANCHOR-1 (2026-09-02) · the ACTIVE block's own first day, when this
   * authoring is a rebuild of that block. Week 0 snaps here instead of to the
   * current week, so a rebuild occupies the same calendar and the same phase
   * geometry the block was authored with. `null` on every other authoring —
   * onboarding, a graduation, an open block, a first plan.
   *
   * Resolved by ONE function, `resolveBlockAnchor`, at `composeForUserInternal`.
   * It does NOT touch `clipBeforeISO`: `persistsComposedDay` still refuses to
   * author a new prescription onto a past day, and Rule 15 still carries a
   * sealed one.
   */
  blockAnchorISO?: string | null,
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
  // DERIVEDFREQ-1 (2026-08-30) · a NULL profile field no longer switches off
  // thirteen mechanisms. When the runner has not STATED a frequency we measure
  // one from their own running; only a runner we cannot measure keeps the
  // legacy fill-every-slot path. See `derivedTrainingDaysPerWeek`.
  const statedFreq = rawFreq == null ? null
    : rawFreq === 0 ? 3
    : (rawFreq >= 1 && rawFreq <= 7) ? rawFreq
    : null;
  const trainingDaysPerWeek = statedFreq ?? await derivedTrainingDaysPerWeek(userId, todayISO);
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
  // BLOCKANCHOR-1 (2026-09-02) · a REBUILD begins where its block began. The
  // three quantities stay separate and are read in the order they were
  // separated: a caller-named first day wins outright (onboarding), else the
  // active block's own start when this is that block's rebuild, else today.
  // `clipBeforeISO` below is still `blockStartISO` and nothing else, so the
  // backdate guard is untouched by this.
  const startMondayISO = weekStartBoundaryOf(blockStartISO ?? blockAnchorISO ?? todayISO, weekStartDow);
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
    return { ok: false, reason: 'could not read your recent training · the plan you have stands' };
  }
  let recentMi = await recentWeeklyMileage(userId);
  // RULE8-1 · the days the engine itself prescribed as taper / race week /
  // post-race recovery. Every habit reader below skips them. Assembled ONCE so
  // the readers cannot answer "which days count" differently from each other.
  const prescribedSpans: PrescribedSpan[] = [];
  {
    const lastRaceForSpan = await loadLastRaceFinished(userId, todayISO)
      .catch(() => ({ lastRaceFinished: null, lastRaceDistanceMi: null }));
    const span = prescribedSpanFor(
      lastRaceForSpan.lastRaceFinished?.date ?? null,
      lastRaceForSpan.lastRaceDistanceMi ?? lastRaceForSpan.lastRaceFinished?.distanceMi ?? null,
      lastRaceForSpan.lastRaceFinished?.priority ?? null,
    );
    if (span) prescribedSpans.push(span);
  }
  const easyFloor = await easyDayMedianMi(userId, todayISO, prescribedSpans);
  const recentLongRead = await recentPeakLongMi(userId, todayISO, prescribedSpans);
  // LONGEVIDENCE-1 · the same prescribed spans, so a raced marathon and the
  // taper that led into it are excluded from what this runner "has done".
  const demonstratedLong = await demonstratedLongMi(userId, todayISO, prescribedSpans);
  // A plan authored on a failed read is a plan authored on a fabricated
  // history. Refuse — the runner keeps the plan they have, and the refusal is
  // a correct answer with a reason on it, not an empty state.
  if (recentLongRead === null) {
    return { ok: false, reason: 'could not read your recent runs · the plan you have stands' };
  }
  // RULE8-2 · the HABIT value where one could be measured, the literal 28-day
  // max otherwise. `spikeAnchorLongMi` below keeps the literal one for the
  // prior-30-day injury rule, which owns its own window.
  const spikeAnchorLongMi = recentLongRead.literalMi;
  let recentLong = Math.max(recentLongRead.literalMi, recentLongRead.representativeMi ?? 0);
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
  const recentQualityDist = await recentQualityDistanceMi(userId, todayISO, prescribedSpans);
  const recentQualityPW = await recentQualityPerWeek(userId, todayISO, prescribedSpans);
  // bestRecentVdot — assembled by the canonical shared loader (B2).
  // A fix to the race/run query now propagates to all call sites automatically.
  // Throws on DB error; generatePlan propagates up (refuses to plan rather than
  // producing a goal-pace plan from undefined VDOT — the C1 bug class).
  const runFloorMi = EVIDENCE_RUN_FLOOR_MI;
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
        goalPaceIsCoachSet: false,
        priority: (m.priority === 'B' ? 'B' : 'C') as 'B' | 'C',
        // RACEROLE-1 (2026-08-28) · the runner's answered role for this
        // tune-up (written by the race_role card's accept). Guarded read —
        // arbitrary jsonb strings never reach the embedder. This is what
        // makes a REBUILD preserve the answer.
        plannedRole: isRaceRole(m.plannedRole) ? m.plannedRole : null,
      };
    });
  // ── MIDGOAL-1 (2026-08-30) · A TUNE-UP WITH NO GOAL GETS THE COACH'S ──────
  //
  // The mapping above is the ONLY source of a mid-block race's target, and it
  // reads exactly one field: the runner's own `meta.goalDisplay`. A race the
  // runner never gave a time to therefore reached the embedder with
  // `goalPaceSec: null`, and `boundedRacePaceSPerMi` returns null for a null
  // stated pace — so the row went out with no target at all, and the race-day
  // prose had no number to state. That is the defect: David's Santa Monica 10K
  // is the race he designated his all-out fitness anchor, and it is the one
  // race in his calendar with an empty goal field.
  //
  // Owner ruling (David 2026-08-28): "For races that have no goals lets have
  // the coach set one based on pushing the runner and current fitness." That
  // derivation already exists and is already used by the race-detail surfaces
  // — `lib/race/coach-goal.ts` (pure) behind `loadCoachGoalForRace` (evidence
  // loader). It is called here rather than re-derived, so the number the plan
  // paces and the number the race screen shows cannot drift apart.
  //
  // THREE PROPERTIES THIS PASS MUST KEEP, all of them load-bearing:
  //
  //   1 · A STATED GOAL ALWAYS WINS. `loadCoachGoalForRace` returns null the
  //       moment `statedGoalSec > 0` — structurally, as its first check — and
  //       this pass only ever runs for a race whose `goalPaceSec` is already
  //       null. Two independent guards, because a coach renegotiating a goal
  //       the runner stated is the standing prohibition
  //       (`feedback_no_forced_goal_decisions`). Dodgers (0:45:00 → 435 s/mi)
  //       and Run Malibu (1:30:00 → 412 s/mi) are untouched by construction.
  //
  //   2 · ONLY A TIME FRAMING PRODUCES A NUMBER. `deriveCoachGoal` answers
  //       `kind:'effort'` for a C race (Research/00b grades a C race a hard
  //       workout, not a chase) and for a course past §13.2's Mountain floor.
  //       Those keep `goalPaceSec: null` — an effort framing withholding a
  //       time is doctrine working, not a gap to fill.
  //
  //   3 · THE B TIER IS THE PACE, NOT A. A/B/C are Daniels' three race goals
  //       (Research/20 §A/B/C); B is "solid execution, minor adversity" at
  //       ~50-60%, and it is by construction the honest centre of demonstrated
  //       fitness — the tier the projection band is drawn AROUND. Pacing a
  //       tune-up off the ~20-30% A tier would commit the runner to the
  //       perfect day at the gun, which is the §18.2 blow-up the whole
  //       `boundedRacePaceSPerMi` machinery exists to prevent.
  //
  // Compute-on-read, exactly as the race screen does it: NOTHING is written
  // back to `races.meta`. A coach goal follows the evidence the morning it
  // changes, and it evaporates the instant the runner states their own.
  // Fail-open — a throw or a refusal leaves `goalPaceSec` null, which is
  // byte-identical to the behaviour before this pass existed.
  for (const mbr of midBlockRaces) {
    if (mbr.goalPaceSec != null) continue;          // guard 1 · stated goal stands
    if (!(mbr.distanceMi > 0)) continue;
    try {
      const { loadCoachGoalForRace } = await import('@/lib/race/coach-goal-load');
      const meta = (midBlockRaceRows.find((row) => row.slug === mbr.slug)?.meta ?? {}) as any;
      const coach = await loadCoachGoalForRace(userId, {
        slug: mbr.slug,
        name: mbr.name,
        priority: mbr.priority,
        // Re-parsed from the row rather than inferred from the null above, so
        // this call carries the same refusal input the race screen passes.
        statedGoalSec: parseRaceTime(meta.goalDisplay ?? meta.goalTime),
        distanceMi: mbr.distanceMi,
        metaTerrain: meta.terrain,
        elevationGainFt: meta.elevationGainFt != null ? Number(meta.elevationGainFt) : null,
        goalFraming: meta.goalFraming,
        daysAway: daysBetween(todayISO, mbr.date),
      });
      // guard 2 · an effort framing carries no time, by design.
      if (!coach || coach.kind !== 'time') continue;
      // guard 3 · B is the tier a tune-up is paced off.
      const paceSec = Math.round(coach.bSec / mbr.distanceMi);
      if (!Number.isFinite(paceSec) || paceSec <= 0) continue;
      mbr.goalPaceSec = paceSec;
      mbr.goalPaceIsCoachSet = true;
    } catch { /* additive · a failed derivation is an absent goal, never a failed plan */ }
  }
  // TRAVEL-1 (2026-08-28) · the runner's declared travel windows overlapping
  // the plan window. Catch-guarded to [] twice over: the table lands via
  // manual migration 159, and a runner with no windows (or a pre-migration
  // deploy) must compose byte-identically to before the feature existed.
  // Loaded here, beside the other date-anchored inputs, so composePlan stays
  // pure. Only the race-prep composer shapes around them (maintenance and
  // recovery blocks have no quality/long geometry worth relocating — their
  // days are already easy-dominant); the adapter and the convergence loader
  // read the same table through lib/plan/travel-store.ts.
  const travelWindows: TravelWindow[] = await (async () => {
    try {
      const { travelWindowsOverlapping } = await import('./travel-store');
      return await travelWindowsOverlapping(userId, startMondayISO, raceDateISO);
    } catch { return []; }
  })();

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

  // 6. Prescriptions (in-code workout library)
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
  // AUTHORING-CANONICAL-1 (2026-09-01) · THE THIRD COPY OF `resolveCurrentTPace`
  // AND THE PLAN-WIDE GOAL PACE, BOTH DELETED.
  //
  // What used to be here:
  //
  //     const currentTLoader = resolveCurrentTPace(bestRecentVdot, belowTableAnchor,
  //                                                recentMi, conservativeVdotFromMileage).tPaceSec;
  //     const goalTpLoader   = tPaceFromGoal(goalSec, raceDistanceMi);
  //     const tPaceSec       = min(goalTpLoader, currentTLoader) ?? currentTLoader ?? 480;
  //
  // `min` of two PACES picks the FASTER one, so for any ambitious goal the
  // plan-wide threshold pace WAS THE GOAL'S — and the maintenance and recovery
  // composers read exactly this field, as did `persistPlan` for every week that
  // carried no `tPaceSec` of its own. A stated goal, pricing training. The
  // 2026-09-01 independent audit named it the blunter of the two goal→pace
  // leaks (appendix A §2, `generate.ts:14160`).
  //
  // In its place: ONE resolution, from the services that own each question, on
  // the same seam `recompute-paces.ts` and `reanchor-plan.ts` already use — so
  // a block is authored at exactly the prices the nightly flex would rewrite it
  // to, and Constitution §8's "sometimes old, sometimes new" state is closed.
  //
  // RULE 11 · a refusal REFUSES. `composePaceAnchors` refuses only on an
  // incoherent SET, never on thin evidence, so this cannot fire for a
  // cold-start runner — every capacity resolver's last rung is a prior.
  // Reaching for the VDOT cascade here would be the exact second truth this
  // migration removes.
  const anchorRead = await resolvePrescribedPaceAnchors(userId, todayISO);
  if (!anchorRead.ok) {
    console.error(
      '[loadGeneratorInputs] REFUSED - pace anchors ' + anchorRead.reason + ' - ' + anchorRead.detail,
    );
    return {
      ok: false,
      reason: 'could not price your training paces yet · the plan you have stands',
    };
  }
  const paceAnchors = anchorRead.anchors;
  const tPaceSec = paceAnchors.thresholdSecPerMi;
  const lthrRow = (await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = lthrRow?.lthr ?? null;
  // maxHr resolved above alongside loadVdotInputs; used here for Rule 16.

  // COURSE-PLAN-1 (2026-08-25) · what the course actually looks like. Loaded
  // ONCE per authoring, here, alongside every other input — the parse of a
  // large GPX is not something a per-week pass should be doing. Never throws
  // and never guesses: an unreadable or absent course resolves to
  // `UNKNOWN_TERRAIN` and the block composes as it always has.
  const courseTerrain = await loadRaceCourseTerrain(userId, raceSlug ?? null, raceDistanceMi);

  // PHASE-ANSWERS-1 · the Coaching Thesis, from its owner (Constitution §F),
  // so the phase answers can say which capacity the block is built around
  // without the composer ranking one itself. A failed read is recorded as a
  // failed read, not as "no limiter" (Rule 11); it never refuses the plan,
  // because the thesis is quoted into prose and prices nothing.
  const thesisAtAuthoring: ThesisAtAuthoring = await (async () => {
    try {
      const { resolveCoachingThesis } = await import('@/lib/training/coaching-thesis');
      const t = await resolveCoachingThesis(userId, todayISO);
      return { primaryLimiter: t.primaryLimiter, priority: t.priority, confidence: t.confidence, source: 'resolved' as const };
    } catch (e) {
      logReadFailure('plan/generate · coaching thesis at authoring', e);
      return { primaryLimiter: 'UNKNOWN' as const, priority: 'establish_evidence_before_prioritising' as const, confidence: null, source: 'read_failed' as const };
    }
  })();

  return {
    ok: true,
    compose: {
      raceDistanceMi,
      goalSec,
      goalPaceSec,
      courseTerrain,
      thesisAtAuthoring,
      raceDateISO,
      startMondayISO,
      level,
      recentWeeklyMi: recentMi,
      // RULE8-1 · `null` is the reader REFUSING — it could not assemble 28
      // representative days, or found too few easy runs in them to call a
      // median. `layoutWeek`'s `easyMileFloor` already treats 0 as "no
      // recoverable baseline" and falls back to its 3 mi math floor, which is
      // the correct answer to "we cannot say". What must never happen is a
      // confident floor measured off a taper, and that is what is now gone.
      easyDayMedianMi: easyFloor ?? 0,
      recentLongMi: recentLong,
      spikeAnchorLongMi,
      // LONGEVIDENCE-1 · the block's long-run ceiling comes from HIS long runs.
      // Rule 11: `null` is the read failing, which leaves the tier band in
      // place; a runner who has simply never run long reads 0 and gets the same
      // band for a different and correct reason. The two are not collapsed.
      demonstratedLongMi: demonstratedLong,
      // PLANVERSION-1 (2026-08-30) · a MEASURED ZERO SURVIVES AS ZERO.
      //
      // These were `x > 0 ? x : undefined`, and `undefined` is what
      // `densityForWeek` reads as a cold start and answers with the runner's
      // FULL preferred quality density. So "we measured this runner and he has
      // done no hard running in a month" arrived at the composer wearing the
      // same face as "we know nothing about this runner", and got the most
      // aggressive answer available — the exact opposite of what Rule 5's ramp
      // exists to do. Only `null` (the reader could not look) is absent now.
      recentQualityDistanceMi: recentQualityDist ?? undefined,
      recentQualityPerWeek: recentQualityPW ?? undefined,
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
      // TRAVEL-1 · undefined (not []) when none, so the composer's gate and
      // every synthetic-input caller stay byte-identical.
      travelWindows: travelWindows.length > 0 ? travelWindows : undefined,
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
      // AUTHORING-CANONICAL-1 · the six canonical prices, resolved ONCE here and
      // carried into `composePlan`. Nothing downstream re-derives a pace.
      paceAnchors,
      lthr,
      // 2026-06-03 · Rule 16 · plumbed to persistPlan + buildWorkoutSpec.
      maxHr,
    },
  };
}
