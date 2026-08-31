/**
 * Plan-simulator translation · 2026-06-22
 *
 * Turns the NATIVE onboarding + goal-setup answers (SimInputs) into a composed
 * plan by running the REAL engine — no DB. Mirrors generatePlan's dispatch:
 *
 *   goalMode 'goal'    → race date = start + planWeeks·7 → composePlan (race-prep)
 *   goalMode 'race'    → pickPlanMode(date) → composePlan / composeMaintenance /
 *                        composeRecovery  (covers all three engine modes)
 *   goalMode 'justRun' → no race → composeMaintenancePlan (the consistency block)
 *
 * Runner-profile derivation mirrors loadGeneratorInputs step-for-step, but from
 * the native onboarding buckets (a new no-Strava signup's cold-start seeds):
 *   - weekly mileage bucket → recentWeeklyMi (lossy histAvg-midpoint path)
 *   - longest-run bucket    → recentLongMi
 *   - self-reported PRs     → bestRecentVdot (vdotFromRace of the best entry)
 * Derived signals are overridable for simulating a runner with history.
 *
 * Pure · no DB · no clock (start date is an explicit input).
 */

import {
  type ComposePlanInput,
  type ComposeNonRaceInput,
  type ComposePlanResult,
  type DOW,
  type LevelKey,
  dayKeyToDow,
  daysBetween,
  spacedQualityDowsFromAvailable,
  inlinePrescriptions,
  type ResolvedPrescriptions,
  composePlan,
  composeMaintenancePlan,
  composeRecoveryPlan,
  finalizeComposedPlan,
  weekStartBoundaryOf,
  // ANCHORFIT-1 · the SAME pure resolvers production spends, so a simulated
  // runner with history is anchored by the shipped functions, not by a copy.
  resolvePeakWeekly,
  resolveRampBase,
  weeklyBlocksFromDaily,
  allowedInterruptionWeeksFor,
  RAMP_BASE_LOOKBACK_WEEKS,
  type RampBaseEvidence,
  // RULE8-SIM-1 · the SAME span builder and the SAME window constants the DB
  // readers spend, so the two front doors cannot disagree about which of a
  // runner's days count as his normal training.
  prescribedSpanFor,
  eligibleDaysBack,
  HABIT_ELIGIBLE_DAYS,
  HABIT_MIN_EASY_SAMPLES,
  type PrescribedSpan,
} from './generate';
import { lookupTierTarget, pickPlanMode, buildOpensISO, type PlanMode } from './goal-tiers';
import { distanceCategoryOrNull, UNKNOWN_DISTANCE_REASON } from '@/lib/race/distance-category';
import { ULTRA_UNSUPPORTED_REASON, planAuthorshipUnsupported } from './supported-distances';
import { tPaceFromGoal, conservativeVdotFromMileage } from './spec-builder';
import { vdotFromRace, tPaceFromVdot, predictRaceTime } from '@/lib/training/vdot';
import {
  SIM_DISTANCE_MI,
  recentWeeklyMiFromBucket,
  recentLongMiFromBucket,
  type SimInputs,
} from './sim-constants';

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Best VDOT across self-reported PRs · how the engine seeds current fitness.
 *  LSP2-2 · only PRs from the last ~6mo ('<6mo' bucket) count as current fitness.
 *  A sub-3 marathon from 18 months ago does not reflect today's shape.
 *  Cite: Research/01 §"Fitness anchor recency"; Pfitzinger §"Using recent races". */
function bestVdotFromHistory(rh: SimInputs['raceHistory']): number | undefined {
  let best: number | undefined;
  for (const e of rh) {
    if (e.whenRaced !== '<6mo') continue; // LSP2-2: only very recent PRs
    const mi = SIM_DISTANCE_MI[e.distance];
    const v = vdotFromRace(e.timeSec, mi);
    if (v != null && (best === undefined || v > best)) best = v;
  }
  return best;
}

export interface SimBuildOk {
  ok: true;
  mode: PlanMode;
  raceDistanceMi: number;
  composed: ComposePlanResult;
  derived: {
    mode: PlanMode;
    raceDistanceMi: number;
    raceDateISO: string;
    /** WEEK-ALIGN-1 · where week 0 BEGINS: the training-week boundary on or
     *  before the runner's start day, so every composed week is a week
     *  `trainingWeekWindow` reads back whole. */
    startMondayISO: string;
    /** WEEK-ALIGN-1 · the runner's FIRST day. Composed days before it belong
     *  to the part of week 0 that predates them; `persistPlan` drops those
     *  (`clipBeforeISO`) and any faithful preview must drop them too. */
    blockStartISO: string;
    /** SIM-CHAIN-1 · on a HOLD block (maintenance or recovery) with a real
     *  race behind it, the day `pickPlanMode` flips to race-prep and the build
     *  gets authored. This is what a four-week block for a race sixteen weeks
     *  out means, and it is the honest thing to draw instead of the build
     *  itself. Null when there is no race, or the window is already open. */
    buildOpensISO: string | null;
    goalPaceSec: number | null;
    tPaceSec: number;
    bestRecentVdot: number | null;
    /** SELFREPORT-1 · true when `bestRecentVdot` above came from the runner's
     *  typed race history rather than a race the app observed. Surfaced here
     *  because the sim's whole job is to show what onboarding would author, and
     *  "we paced you off a number you typed" is part of that answer. */
    bestRecentVdotSelfReported: boolean;
    recentWeeklyMi: number;
    recentLongMi: number;
    /** ANCHORFIT-1 · the anchors the composers were actually handed. Null when
     *  no history was supplied, which is how a caller tells "the buckets ran"
     *  from "the readers ran". */
    measuredPeakWeeklyMi: number | null;
    recentPeakWeeklyMi: number | null;
    rampBase: RampBaseEvidence | null;
    goalTier: string | null;
    longRunDow: DOW;
    restDow: DOW;
    qualityDows: DOW[];
    trainingDaysPerWeek: number | null;
    distanceCategory: string;
  };
  validateCtx: {
    level: LevelKey;
    isSteppingStoneToMarathon: boolean;
    priorPlanPeakLongMi: number | null;
    todayISO: string;
    trainingDaysPerWeek: number | null;
    trailingAvgWeeklyMi: number | null;
    qualityStrandedByAvailability?: boolean;
    recentWeeklyMi?: number | null;
  };
}
export type SimBuildResult = SimBuildOk | { ok: false; reason: string };

/** Native onboarding answers → composed plan via the real engine. */
export function buildSimPlan(sim: SimInputs, rxOverride?: { rxQuality: ResolvedPrescriptions; rxRaceSpecific: ResolvedPrescriptions }): SimBuildResult {
  /** The day the runner tapped "Start training" — their FIRST day. Week 0 is
   *  composed from the training-week boundary on or before it; the days in
   *  between belong to a week the runner was not here for and are not
   *  persisted. See `requestedBlockStartISO` in generate.ts. */
  const blockStartISO = sim.startDateISO;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(blockStartISO)) return { ok: false, reason: 'invalid start date' };

  // ── shared runner-profile derivation (mirrors loadGeneratorInputs) ──
  const level = sim.experienceLevel as LevelKey;

  // ── ANCHORFIT-1 · a runner WITH history ────────────────────────────────
  //
  // Absent (the default, and every existing archetype) this whole block is
  // inert and the buckets govern exactly as before. Present, it stands in for
  // the three DB readers `loadGeneratorInputs` runs — `recentWeeklyMileageMi`,
  // `recentPeakWeeklyMileage`, `rampBaseForBuild` — using their own pure
  // halves, so the harness can finally express the case the anchors exist for:
  // a runner whose recent weeks do not describe what they can do.
  // ── RULE8-SIM-1 (2026-08-30) · THE SIM HAD THE GAP THE DB PATH JUST CLOSED ─
  //
  // Rule 8 says no reader that answers "what does this runner normally do" may
  // count days the engine itself prescribed as taper, race week or post-race
  // recovery. `loadGeneratorInputs` assembles a `PrescribedSpan` from the race
  // the runner actually ran and hands it to every habit reader. This path
  // assembled nothing and read the raw daily series, so `easyDayMedianMi` here
  // was contaminated exactly as production's was before RULE8-1 — and this is
  // the path `/sim/plan`, `_anchor_fit`, `_coach_sensible` and the archetype
  // corpus all run on. Per Rule 15, a mechanism the corpus cannot reach is
  // untested: the filter existed and nothing in the harness could exercise it.
  //
  // The span is built from the SAME `prescribedSpanFor` and consumed through
  // the SAME `eligibleDaysBack`, so the sim cannot drift from the loader.
  // Empty (no `lastRaceDistance`, or a distance we cannot resolve) and this is
  // inert — every existing archetype is byte-identical.
  const lastRaceDaysAgoForSpan = sim.lastRaceFinishedDaysAgo ?? 0;
  const prescribedSpans: PrescribedSpan[] = [];
  {
    const span = prescribedSpanFor(
      lastRaceDaysAgoForSpan > 0 ? addDaysISO(blockStartISO, -lastRaceDaysAgoForSpan) : null,
      sim.lastRaceDistance ? SIM_DISTANCE_MI[sim.lastRaceDistance] : null,
      // The sim has no race-priority field; `postRaceRecoveryWeeks` treats a
      // null priority the same way the loader does when the race row has none.
      null,
    );
    if (span) prescribedSpans.push(span);
  }
  const daily = sim.dailyMiMostRecentFirst ?? null;
  const hist = daily && daily.length >= 28 ? (() => {
    const at = (i: number): number => {
      const v = daily[i];
      return Number.isFinite(v) && v > 0 ? v : 0;
    };
    let total28 = 0;
    for (let i = 0; i < 28; i++) total28 += at(i);
    // Mirrors `weeklyAvgFromWindow(total, 28, 28)` for a fully-covered window.
    const mean28 = Math.round((total28 / 4) * 10) / 10;
    // The 28-day longest single day · `recentPeakLongMi`'s shape.
    let long28 = 0;
    for (let i = 0; i < 28; i++) if (at(i) > long28) long28 = at(i);
    // `easyDayMedianMi` · runs of 3-9 mi, median, rounded to 0.5.
    //
    // RULE8-SIM-1 · over `HABIT_ELIGIBLE_DAYS` REPRESENTATIVE days, not the
    // most recent 14 calendar ones. This mirrors the DB reader line for line:
    // the same 28-day span, the same 3-9 mi band, the same minimum sample
    // count, and the same refusal when there is not enough clean history —
    // `easyDayMedianMi`'s own header records what the 14-day calendar window
    // cost, which was four-mile easy days for a runner whose easy day is six.
    //
    // The index-to-date map is the one the caller supplies: `daily[i]` is the
    // day `i` days before `blockStartISO`, most-recent-first.
    const eligible = new Set(
      eligibleDaysBack(blockStartISO, HABIT_ELIGIBLE_DAYS, prescribedSpans, daily.length),
    );
    const easies: number[] = [];
    let eligibleDaysSeen = 0;
    for (let i = 0; i < daily.length; i++) {
      if (!eligible.has(addDaysISO(blockStartISO, -i))) continue;
      eligibleDaysSeen++;
      const m = at(i);
      if (m >= 3 && m <= 9) easies.push(m);
    }
    easies.sort((a, b) => a - b);
    // Rule 11 · a refusal, not a measured zero. Too few clean days or too few
    // easy runs inside them and the floor stays unset, exactly as the DB
    // reader returns null. `easyMileFloor` reads 0 as "no habit evidence".
    const easyMed = (eligibleDaysSeen < HABIT_ELIGIBLE_DAYS || easies.length < HABIT_MIN_EASY_SAMPLES)
      ? 0
      : Math.round((easies.length % 2 ? easies[(easies.length - 1) / 2]
        : (easies[easies.length / 2 - 1] + easies[easies.length / 2]) / 2) * 2) / 2;
    return {
      mean28,
      peak: resolvePeakWeekly(daily),
      long28: Math.round(long28 * 10) / 10,
      easyMed,
      blocks: weeklyBlocksFromDaily(daily, RAMP_BASE_LOOKBACK_WEEKS),
    };
  })() : null;

  const recentWeeklyMi = hist ? hist.mean28 : recentWeeklyMiFromBucket(sim.weeklyMileageBucket);
  let recentLongMi = hist ? hist.long28 : recentLongMiFromBucket(sim.longestRunBucket);
  const easyDayMedianMi = sim.easyDayMedianMi != null && sim.easyDayMedianMi > 0
    ? sim.easyDayMedianMi
    : (hist ? hist.easyMed : 0);
  const bestRecentVdot = sim.bestRecentVdotOverride != null && sim.bestRecentVdotOverride > 0
    ? sim.bestRecentVdotOverride
    : bestVdotFromHistory(sim.raceHistory);
  // SELFREPORT-1 (2026-08-21) · prod's `loadGeneratorInputs` records whether the
  // anchor it produced came from the runner's keyboard or from a race the app
  // observed, and the composer stamps `season_anchor_source` off that. The sim
  // has to record the same thing or PARITY-1 is broken in the one place it was
  // written to hold: identical self-reports would author identically-shaped
  // plans carrying DIFFERENT provenance, and the sim would be the optimistic one.
  //
  // The override stands in for a measured read — it is the sim's way of saying
  // "this runner has a race on file" — so only the history path is marked.
  const bestRecentVdotSelfReported =
    !(sim.bestRecentVdotOverride != null && sim.bestRecentVdotOverride > 0) && bestRecentVdot != null;

  // layout (loadGeneratorInputs §2)
  let longRunDow = dayKeyToDow(sim.longRunDay);
  // REST-COLLIDE-1 (2026-08-24) · the default was a bare 'sat', so a runner who
  // picks SATURDAY long runs was simulated with the long run and the rest day
  // on the same day. `POST /api/onboarding/complete` has guarded that since
  // 2026-06-10 — `restDay = longRunDay === 'sat' ? 'mon' : 'sat'`, because "the
  // generator overwrites a shared slot with the long and would leave the week
  // rest-less" — so the colliding layout is one production cannot build.
  //
  // It was not harmless. With the slot taken, `composeRecoveryPlan` placed the
  // post-race long run on a WEDNESDAY for every Saturday-long runner, and
  // `_plan_conservation.test.ts` sweeps `longRunDay: 'sat'` across 448 of its
  // 896 archetypes — half that gate has been grading a runner who does not
  // exist. The route's own rule, applied here, so the two front doors seed the
  // same layout.
  let restDow = dayKeyToDow(sim.restDay ?? (sim.longRunDay === 'sat' ? 'mon' : 'sat'));
  let qualityDows: DOW[] = [dayKeyToDow('tue'), dayKeyToDow('thu')];
  let availableDows: Set<number> | null = null;
  const avail = (sim.availableDays ?? []).map((d) => dayKeyToDow(d));
  if (avail.length >= 2) {
    const aset = new Set<number>(avail);
    availableDows = aset;
    longRunDow = (aset.has(longRunDow) ? longRunDow : aset.has(6) ? 6 : aset.has(0) ? 0 : Math.max(...avail)) as DOW;
    const unavail = [0, 1, 2, 3, 4, 5, 6].filter((d) => !aset.has(d));
    restDow = (!aset.has(restDow) ? restDow : (unavail[0] ?? restDow)) as DOW;
    qualityDows = spacedQualityDowsFromAvailable(avail, longRunDow);
  }
  // WEEK-ALIGN-1 (2026-08-24) · week 0 begins on the runner's TRAINING-WEEK
  // BOUNDARY, mirroring `loadGeneratorInputs` after the same change there.
  //
  // The sim previously used the literal chosen start date because production
  // did, and the note here recorded a reverted snap-to-longRunDow experiment
  // and concluded that alignment is a render concern. It is not. A block
  // authored in Wed→Tue weeks is READ BACK in Mon→Sun ones by
  // `trainingWeekWindow`, so every per-week number beside the strip — planned
  // mileage, "Week N of M", cutback detection — is about a week the runner is
  // not looking at. Grouping the calendar rows by plan-week membership made
  // /sim/plan's own picture coherent and hid that from exactly the tool built
  // to catch it.
  //
  // Snapped AFTER `longRunDow` is resolved, because `availableDays` can move
  // the long run and the boundary is defined off wherever it lands — the same
  // ordering `loadGeneratorInputs` uses (its §2 layout precedes its §4 anchor).
  const startMondayISO = weekStartBoundaryOf(blockStartISO, (longRunDow + 1) % 7);

  // stated frequency → trainingDaysPerWeek + quality-count slice
  const rawFreq = Number.isFinite(sim.weeklyFrequency) ? Number(sim.weeklyFrequency) : null;
  const trainingDaysPerWeek = rawFreq == null ? null
    : rawFreq === 0 ? 3
    : (rawFreq >= 1 && rawFreq <= 7) ? rawFreq
    : null;
  if (trainingDaysPerWeek != null) {
    const qCount = trainingDaysPerWeek <= 1 ? 0 : trainingDaysPerWeek >= 5 ? 2 : 1;
    qualityDows = qualityDows.slice(0, qCount);
  }
  // COH-1 · clamp the reported longest run to be coherent with weekly volume (mirrors the loader).
  // SIM-COH-1 · cap the coherence floor to the bucket's upper bound so switching buckets
  // always produces a visibly different plan (prevents "nothing changes" when
  // avg-run-distance > bucket ceiling — e.g. 30mpw / 3 days → avg=10mi overrides both
  // "0-3mi" and "3-6mi" to 10mi, making them identical).
  const SIM_LONG_BUCKET_MAX: Record<string, number> = { '0-3': 3, '3-6': 6, '6-10': 10, '10+': 999 };
  const _bucketMax = SIM_LONG_BUCKET_MAX[sim.longestRunBucket as string] ?? 999;
  const _avgRun = trainingDaysPerWeek ? Math.round(recentWeeklyMi / trainingDaysPerWeek) : 0;
  recentLongMi = Math.min(
    Math.max(recentLongMi, Math.min(_avgRun, _bucketMax)),
    Math.round(recentWeeklyMi * 0.8),
  );
  const crossModes: string[] = [];

  // ── mode + horizon ──
  let mode: PlanMode;
  let raceDistanceMi: number;
  let raceDateISO: string;
  let goalSec: number | null;
  let lastRaceFinished: ComposeNonRaceInput['lastRaceFinished'] = null;
  let nextRace: ComposeNonRaceInput['nextRace'] = null;

  // ANCHORFIT-1 · the finished race is a fact about the RUNNER, not about the
  // mode the engine picked. `rampBaseForBuild` reads it on the race-prep path
  // — the one path where `lastRaceFinished` above stays null — because a race
  // is precisely what entitles a build to read through a low stretch.
  const lastRaceDaysAgo = sim.lastRaceFinishedDaysAgo ?? 0;
  const lastRaceISO = lastRaceDaysAgo > 0 ? addDaysISO(blockStartISO, -lastRaceDaysAgo) : null;
  const lastRaceMi = sim.lastRaceDistance ? SIM_DISTANCE_MI[sim.lastRaceDistance] : null;

  if (sim.goalMode === 'justRun') {
    // No goal · the consistency block. Reference distance (half) only selects
    // the validator's constraint row; maintenance skips the long-run cap.
    mode = 'maintenance';
    raceDistanceMi = SIM_DISTANCE_MI['half'];
    raceDateISO = addDaysISO(blockStartISO, 28);
    goalSec = null;
  } else if (sim.goalMode === 'goal') {
    raceDistanceMi = SIM_DISTANCE_MI[sim.distance];
    const weeks = Math.max(4, Math.min(52, Math.round(sim.planWeeks || 0)));
    // SIM-FIDELITY · snap the goal deadline to the runner's LONG-RUN day, exactly as production does
    // (generate.ts:3385 · raceDateISO = weekStartBoundaryOf(raw, (longRunDow+1)%7) + 6, which lands on
    // longRunDow). The earlier unconditional Saturday-snap diverged from production for 6 of 7 long-run
    // days — the sim previewed a Saturday race the runner would never get — and, with weeks now
    // grouped by plan-week at render time, a non-Saturday long would leave trailing post-race rest days.
    // Placing the race on longRunDow keeps it the natural end of its (now plan-week-grouped) final week.
    // WEEK-ALIGN-1 · off the runner's OWN start day, not the snapped anchor:
    // `/api/profile/goal` computes the deadline as `startDateISO + weeks*7`
    // before `generatePlan` ever sees it, so it cannot move when the anchor does.
    const rawDeadline = addDaysISO(blockStartISO, weeks * 7);
    raceDateISO = addDaysISO(weekStartBoundaryOf(rawDeadline, ((longRunDow + 1) % 7)), 6);
    goalSec = sim.goalTimeSec ?? null;
    mode = 'race-prep'; // goal-anchored is always a build
  } else {
    raceDistanceMi = SIM_DISTANCE_MI[sim.distance];
    raceDateISO = sim.raceDateISO;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDateISO)) return { ok: false, reason: 'invalid race date' };
    goalSec = sim.goalTimeSec ?? null;
    const lastISO = lastRaceISO;
    const lastDistMi = lastRaceMi;
    // WEEK-ALIGN-1 · production asks this of TODAY (`composeForUserInternal`
    // passes `todayISO`), never of the week-0 anchor. A snapped anchor sits up
    // to six days earlier, which is enough to flip the maintenance/race-prep
    // boundary on its own.
    mode = pickPlanMode(blockStartISO, raceDateISO, raceDistanceMi, lastISO, lastDistMi);
    if (mode === 'recovery' && lastISO && lastDistMi) {
      lastRaceFinished = {
        slug: 'sim-last', name: 'Last race', date: lastISO, distanceMi: lastDistMi,
        // ANCHORFIT-1 · DOCTRINE-5 scales the recovery WINDOW by priority, and
        // the harness could not say which priority the race was.
        ...(sim.lastRacePriority ? { priority: sim.lastRacePriority } : {}),
      };
    }
  }

  // PACE-3 · guard an absurd implied pace (e.g. a wheel hours-truncation putting an HM
  // time onto a 5K goal → ~30 min/mi threading into every workout). Treat an implausibly
  // slow sub-HM goal as absent → it falls to the currentT fitness anchor below.
  // GOAL-4 · null an off-table goal (impossibly slow sub-HM, or off-the-top faster-than-VDOT-85) so
  // it can't thread impossible paces; falls to the currentT anchor (VAR-05). Mirrors the loader.
  if (goalSec != null && (
    (raceDistanceMi < 13.1 && goalSec / raceDistanceMi > 900) ||
    (vdotFromRace(goalSec, raceDistanceMi) == null && goalSec < (predictRaceTime(85, raceDistanceMi) ?? 0))
  )) goalSec = null;
  const goalPaceSec = goalSec ? Math.round(goalSec / raceDistanceMi) : null;
  // VAR-05 · by-feel (no goal) or ultra (PACE-5 → tPaceFromGoal null) anchors T to the
  // runner's actual fitness (currentT), never the flat 480s/mi literal. Mirrors composePlan.
  const currentT = tPaceFromVdot(bestRecentVdot ?? conservativeVdotFromMileage(recentWeeklyMi));
  // NEW-A · floor tPaceSec at currentT (mirrors the loader) so maintenance/recovery don't inherit a slow soft goal.
  const goalTpSim = tPaceFromGoal(goalSec, raceDistanceMi);
  const tPaceSec = (goalTpSim != null && currentT != null ? Math.min(goalTpSim, currentT) : goalTpSim) ?? currentT ?? 480;

  // ANCHORFIT-1 · RAMPBASE-1's pure half, on the same path production runs it
  // (`if (mode === 'race-prep')`). Null with no history, and then the sim
  // behaves exactly as it did: `volumeCurve` opens from `recentWeeklyMi`.
  const rampEvidence: RampBaseEvidence | null = (hist && mode === 'race-prep')
    ? resolveRampBase({
        meanWeeklyMi: recentWeeklyMi,
        weeklySeries: hist.blocks,
        allowedInterruptionWeeks: allowedInterruptionWeeksFor(
          blockStartISO, lastRaceISO, lastRaceMi, sim.lastRacePriority ?? null,
        ),
        // WKPEAK-1 · the same `resolvePeakWeekly` number production reads, off
        // the same daily series. `hist.peak` already IS that call.
        peakWeeklyMi: hist.peak,
      })
    : null;

  if (mode === 'race-prep') {
    // Production's runway gate measures from TODAY (`loadGeneratorInputs`:
    // `daysBetween(todayISO, raceDateISO)`), not from the anchor.
    const d = daysBetween(blockStartISO, raceDateISO);
    if (d < 14) return { ok: false, reason: 'Race is under 2 weeks out · too close to build a plan. Push it later or pick a longer plan.' };
    if (d > 365) return { ok: false, reason: 'Race is over a year out · the engine plans within a year.' };
  }

  // #12 follow-up (2026-08-18) · THE categorizer, direct. The distance comes
  // from SIM_DISTANCE_MI, a table of six known events, so a null here means the
  // table gained a row with no mileage — refuse rather than plan the wrong race.
  const cat = distanceCategoryOrNull(raceDistanceMi);
  if (cat == null) return { ok: false, reason: UNKNOWN_DISTANCE_REASON };
  // ULTRA-OUT-1 (2026-08-19) · the simulator refuses exactly what production
  // refuses. `SIM_DISTANCE_MI` still offers 50K and 100K and the all-user sweep
  // still walks them — that is deliberate, because a matrix that simply dropped
  // ultra would stop noticing if authorship quietly re-opened. What it must not
  // do is BUILD one: this tool mirrors onboarding, and a simulator that happily
  // composes a plan the live engine declines is a simulator of a different app.
  // It was also the only remaining reader of the mislabelled PLAN_TEMPLATES
  // ultra rows, so those rows now reach nothing at all.
  if (planAuthorshipUnsupported(raceDistanceMi)) {
    return { ok: false, reason: ULTRA_UNSUPPORTED_REASON };
  }
  // FID-2 · prefer the real level + phase-aware prescriptions (resolved by the
  // route from the in-code workout library, matching the production engine);
  // fall back to the inline catalog when not provided.
  const rxQuality = rxOverride?.rxQuality ?? inlinePrescriptions(cat);
  const rxRaceSpecific = rxOverride?.rxRaceSpecific ?? inlinePrescriptions(cat);

  let composed: ComposePlanResult;
  if (mode === 'race-prep') {
    const input: ComposePlanInput = {
      raceDistanceMi, goalSec, goalPaceSec, raceDateISO, startMondayISO, level,
      recentWeeklyMi, easyDayMedianMi, recentLongMi,
      // HIST-1 (2026-08-30) · was `undefined, undefined` unconditionally, which
      // is why Rule 5's quality-density ramp and the quality-distance floor
      // could not be reached by ANY harness in this repo. Absent still reaches
      // the composer as `undefined` — `?? undefined` rather than `?? 0`,
      // because Rule 11: a measured zero and a missing read are different
      // facts, and `composePlan` reads a real 0 as "no quality habit" and an
      // `undefined` as "cold start, use the runner's prefs".
      recentQualityDistanceMi: sim.recentQualityDistanceMi ?? undefined,
      recentQualityPerWeek: sim.recentQualityPerWeek ?? undefined,
      bestRecentVdot, bestRecentVdotSelfReported, tsbAtStart: undefined, horizonRaces: undefined,
      isMidBlock: sim.isMidBlock ?? false,
      longRunDow, restDow, qualityDows, availableDows, trainingDaysPerWeek, crossModes,
      rxQuality, rxRaceSpecific, tPaceSec, lthr: sim.lthr ?? null, maxHr: sim.maxHr ?? null,
      // ANCHORFIT-1 · RAMPBASE-1, resolved by the shipped pure function. Same
      // conditionality production uses.
      // CONTINUOUS-RESTORE-1 (2026-08-30) · production stopped gating
      // `rampBaseMi` on `rampEvidence.lifted`; this mirror follows it, or the
      // sim stops being a mirror. See the note at that call site.
      ...(rampEvidence
        ? { rampBaseEvidence: rampEvidence, rampBaseMi: rampEvidence.baseMi }
        : {}),
    };
    composed = composePlan(input);
  } else {
    // COLD-1 · demonstrated equivalent race pace from a MEASURED VDOT only (mirrors generatePlan).
    const simDemonstrated = bestRecentVdot != null
      ? (() => {
          const t = predictRaceTime(bestRecentVdot, raceDistanceMi);
          return t != null ? Math.round(t / raceDistanceMi) : null;
        })()
      : null;
    const tier = lookupTierTarget(goalPaceSec, raceDistanceMi, level, simDemonstrated).tier; // VAR-01 + COLD-1
    if (mode !== 'recovery' && sim.goalMode === 'race') {
      nextRace = { slug: 'sim-race', name: 'Goal race', date: raceDateISO, distanceMi: raceDistanceMi, goalPaceSec };
    }
    const nonRace: ComposeNonRaceInput = {
      startMondayISO, level, recentWeeklyMi, recentLongMi,
      // ANCHORFIT-1 · DOCTRINE-4's real peak week when the harness was given a
      // history, exactly as `composeForUserInternal` wires it. Without one this
      // stays the pre-DOCTRINE-4 proxy, which is correct for the case the sim
      // was built for and was WRONG as a gate: every archetype in
      // `_sweep_allusers.test.ts` sized recovery and maintenance off a peak
      // that was the 28-day mean, which is the defect DOCTRINE-4 fixed. A gate
      // that cannot express the bug cannot catch it.
      recentPeakWeeklyMi: hist ? Math.max(hist.peak, recentWeeklyMi) : recentWeeklyMi,
      // MAINT-NOBLOCK-1 · the simulator mirrors ONBOARDING, where there are no
      // logged runs at all — so the measured peak is 0 and the maintenance
      // block holds the runner's stated volume rather than cutting it by 30%
      // toward a completed block they do not have.
      measuredPeakWeeklyMi: hist ? hist.peak : 0,
      easyDayMedianMi, longRunDow, restDow, qualityDows, availableDows, trainingDaysPerWeek, crossModes,
      tier, nextRace, lastRaceFinished, rxQuality, tPaceSec, lthr: sim.lthr ?? null,
    };
    composed = mode === 'recovery' ? composeRecoveryPlan(nonRace) : composeMaintenancePlan(nonRace);

    // THE CHAIN, REMOVED (SIM-CHAIN-1, 2026-08-24).
    //
    // What used to be here: when the race sat outside `BUILD_WINDOW_WEEKS`,
    // this composed the hold block and then the ENTIRE periodized build and
    // concatenated them into one calendar, "so the runner sees the complete
    // picture instead of a 1-4 week stub that just stops."
    //
    // `composeForUserInternal` has never done that. It calls `pickPlanMode`
    // once and one composer once. So for a half marathon sixteen weeks out —
    // outside the 12-week half window, and one of the three plan lengths the
    // native goal sheet offers — production authored four maintenance weeks
    // and /sim/plan drew seventeen. Two different plans from one set of
    // answers, and the simulator was the optimistic one.
    //
    // It also meant `_sweep_allusers.test.ts` was grading the chain. Its
    // far-out arc is commented "≥26 weeks → maintenance until the build window
    // opens" — the author's intent was the hold block, and the chain quietly
    // handed the sweep a build instead. Removing it restores what that arc
    // says it grades.
    //
    // The concern the chain was written for is real and is answered on the
    // screen instead of in the calendar: the Block panel's coach line now
    // names the day the build opens (`buildOpensISO`, asked of `pickPlanMode`
    // itself), so a runner on a four-week hold block is told why it is four
    // weeks rather than shown thirteen weeks that will not be written.
    // `derived.buildOpensISO` below carries the same date to /sim/plan.
  }
  finalizeComposedPlan(composed, raceDistanceMi, level);
  // VOLS-SNAP (2026-06-24) · re-snapshot the volume-curve series from the VOL-1/COH-4-reconciled
  // weeklyMi, exactly as the production generatePlan path does (generate.ts:3098). finalize mutates
  // weeklyMi to the realized day-sum but never touches composed.vols, which composePlan returned
  // straight from the un-reconciled curve budget — so without this the sim API ships two volume series
  // that disagree by up to 33mi (and the maint+race-prep chain concatenated two pre-finalize budgets).
  composed.vols = composed.weeks.map((w) => w.weeklyMi);

  // SIM-CHAIN-1 · asked of the mode machine, from the runner's own start day,
  // so the preview and the Block screen answer this with one function.
  const buildOpens = (sim.goalMode === 'race' && mode !== 'race-prep')
    ? buildOpensISO(blockStartISO, raceDateISO, raceDistanceMi)
    : null;

  return {
    ok: true,
    mode,
    raceDistanceMi,
    composed,
    derived: {
      mode, raceDistanceMi, raceDateISO, startMondayISO, blockStartISO, buildOpensISO: buildOpens, goalPaceSec, tPaceSec,
      bestRecentVdot: bestRecentVdot ?? null, bestRecentVdotSelfReported, recentWeeklyMi, recentLongMi,
      // ANCHORFIT-1 · what the composers were handed, for a gate to grade.
      measuredPeakWeeklyMi: hist ? hist.peak : null,
      recentPeakWeeklyMi: hist ? Math.max(hist.peak, recentWeeklyMi) : null,
      rampBase: rampEvidence,
      goalTier: (() => {
        const t = (composed.authoredState as Record<string, unknown> | undefined)?.['goal_tier']
          ?? (composed.authoredState as Record<string, unknown> | undefined)?.['tier'];
        return typeof t === 'string' ? t : null;
      })(),
      longRunDow, restDow, qualityDows, trainingDaysPerWeek, distanceCategory: cat,
    },
    validateCtx: {
      level, isSteppingStoneToMarathon: false, priorPlanPeakLongMi: null,
      todayISO: blockStartISO, trainingDaysPerWeek,
      trailingAvgWeeklyMi: recentWeeklyMi > 0 ? recentWeeklyMi : null,
      // GOAL-1 · available_days stranded quality to empty → composer folds to long+easy (valid)
      qualityStrandedByAvailability: availableDows != null && qualityDows.length === 0,
      recentWeeklyMi, // CC-2 · cold-start ramp base
    },
  };
}
