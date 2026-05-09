/**
 * Coach engine — the real version.
 *
 * Replaces the earlier placeholder. Encodes the coaching principles
 * from docs/coaching-research.md as constraints + decisions on top of
 * the aggregated CoachState. See coach-principles.ts for every
 * literature-anchored constant the engine reads.
 *
 * Decision flow each morning:
 *   1. mode      — race vs base (deterministic from race calendar)
 *   2. phase     — BASE | BUILD | PEAK | TAPER (race mode) OR
 *                  POST_RACE | REBUILD | BASE_MAINTENANCE (base mode)
 *   3. run pick  — default by phase + day-of-week, then state nudges
 *   4. constraints — long-run spike cap, recovery spacing, ACWR cap,
 *                    heavy-block override, post-race override
 *   5. strength  — Amp-aware prescription, opposite hard run days
 *   6. week shape — same loop simulated forward 7 days
 *   7. alerts    — heavy-block, easy-ratio low, taper window, rebuild
 *   8. rationale — one sentence that names the load-bearing input
 */

import type { CoachState } from './coach-state';
import {
  type Phase, type RaceSubPhase,
  raceSubPhase, intensityTarget, maxLongRunMi, acwr, ACWR_HIGH,
  HARD_EFFORT_HR_DEFAULT_BPM, phaseProgress, lerpByProgress,
  buildWindowDays,
} from './coach-principles';
import {
  type RunWorkoutType, type RunPrescription,
  defaultByDow, recovery, generalAerobic, easyWithStrides, mediumLong, vdotTest5K,
  longSteady, longProgression, longMpBlock, thresholdContinuous,
  thresholdIntervals, subThreshold, vo2, marathonSpecific, shakeout, rest, race,
} from './coach-workouts';
import {
  prescribeStrength, strengthWeekContext, type StrengthPrescription,
} from './coach-strength';
import { selectActiveTemplate, templateWorkoutType } from './coach-plan';
import { validatePlan } from '../coach/plan-validator';
import { shouldPromptVdotTest } from './vdot';
import { longRunTargetMi } from './long-run-cap';
import { POST_RACE_BY_DISTANCE, REVERSE_TAPER_PROTOCOL, MARATHON_RECOVERY_4WK_REVERSE_TAPER, MILEAGE_TIER_RECOVERY, mileageTier } from '../coach/doctrine';
import { postRaceDistanceBand } from './recovery-distance';

export type WorkoutType = RunWorkoutType;

export interface CoachToday {
  mode: 'race' | 'base';
  modeDetail: string;
  phase: Phase;
  today: TodayPrescription;
  strength: StrengthPrescription | null;
  rationale: string;
  weekShape: Array<{
    date: string;
    type: WorkoutType;
    label: string;
    distanceMi: number;
    description: string;
    paceTargetSPerMi: { lowS: number; highS: number } | null;
    hrZone: number | null;
    isQuality: boolean;
    isLong: boolean;
    isToday: boolean;
    hasStrength: boolean;
  }>;
  /** 30-day outlook from today forward — bridges the gap between
   *  today's prescription and the race calendar. Re-derived every
   *  morning, like weekShape. */
  next30Days: Array<{
    date: string;
    type: WorkoutType;
    label: string;
    distanceMi: number;
    /** Pace target band — same shape as today's prescription. Carries
     *  forward so /workout/[date] for any future day shows the
     *  intended pace, not a "—" fallback. Comes from the engine's
     *  full pickRun + applyConstraints path, so respects VDOT, phase,
     *  and any quality downshifts. */
    paceTargetSPerMi: { lowS: number; highS: number } | null;
    hrZone: number | null;
    description: string;
    isQuality: boolean;
    isLong: boolean;
    isToday: boolean;
    /** Phase that was active on this day per the engine simulation.
     *  Lets /workout/[date] show a date-correct header (e.g. "BUILD ·
     *  56 days to AFC") instead of always echoing today's modeDetail
     *  which is misleading when viewing a future workout. */
    phase: Phase;
    /** Human-readable mode descriptor for this specific day. Mirrors
     *  the format of coach.today.modeDetail but computed from the
     *  day's projected phase + days-to-race. */
    modeDetail: string;
    /** Race scheduled on this day, if any. Renders as a flag in the
     *  strip so the runner sees the destination relative to today. */
    raceName: string | null;
    racePriority: 'A' | 'B' | 'C' | null;
  }>;
  alerts: Array<{ severity: 'info' | 'warn' | 'rest'; message: string }>;
  /** Plan integrity issues — rules from coach/doctrine/plan_integrity.ts
   *  asserted by coach/plan-validator.ts after the engine produces its
   *  output. Empty array = clean plan. Any errors here mean the
   *  engine has a regression a refactor introduced; UI surfaces them
   *  as a banner so the runner knows + so the developer sees. */
  planIssues: import('../coach/plan-validator').PlanIssue[];
  /** Per-week trajectory toward the next A-race. Lets the runner SEE
   *  how the engine projects volume + quality count + long-run target
   *  scaling toward the goal, instead of trusting that BUILD/PEAK
   *  weeks will arrive. Forward weeks only — past weeks come from
   *  real activity data on the client side.
   *
   *  Generated for up to N weeks (currently 14, capped at days-to-A
   *  rounded up + 2 weeks of taper headroom). Empty array when there's
   *  no A-race scheduled. */
  buildCurve: Array<{
    weekStartISO: string;       // Monday of the week (LA timezone date)
    weekIndex: number;          // 0 = this week, +1 next, etc.
    daysToRace: number;         // mid-week days-to-A
    phase: Phase;
    totalMi: number;
    longRunMi: number;
    qualityCount: number;
    hasMpBlock: boolean;        // contains a marathon-specific or long-MP-block session
    isRaceWeek: boolean;
  }>;
  generatedAt: string;
  isPlaceholder: boolean;
}

interface TodayPrescription {
  type: WorkoutType;
  label: string;
  distanceMi: number;
  paceTargetSPerMi: { lowS: number; highS: number } | null;
  hrZone: number | null;
  description: string;
}

/* ── Main entry ─────────────────────────────────────────────── */
export function coachDaily(state: CoachState): CoachToday {
  const mode = decideMode(state);
  const phase = decidePhase(state, mode);
  const todayDow = jsDow(state.now);

  const run = applyConstraints(pickRun(state, phase, todayDow), state, phase, todayDow);
  const isHard = isHardRun(run);
  // Full rest day on the run side → no strength either. Rest day means
  // rest. The exception is mid/late POST_RACE where the run is rest but
  // mobility can still help — but in the first ~5 days of POST_RACE
  // (when REST is being prescribed because the body actually needs it),
  // skip strength entirely.
  const runIsRest = run.type === 'rest';
  const strength = runIsRest ? null : prescribeStrength(state, phase, todayDow, isHard);

  const alerts = computeAlerts(state, phase);
  const week = simulateWeek(state, phase, todayDow);
  const next30 = simulateNext30Days(state, phase);
  const buildCurve = simulateBuildCurveWeeks(state);
  const rationale = composeRationale(state, phase, run, strength);

  // Plan-integrity validator. Runs declarative rules from
  // coach/doctrine/plan_integrity.ts against the engine's generated
  // plan. Any issues land on the response — UI surfaces them as a
  // banner. This is the primary mechanism that catches engine
  // regressions automatically; future refactors that break a rule
  // produce visible warnings instead of silent broken plans.
  const planIssues = validatePlan({ next30Days: next30, buildCurve, weekShape: week }, state);

  return {
    mode, modeDetail: describeMode(state, phase),
    phase,
    today: runToTodayShape(run),
    strength,
    rationale,
    weekShape: week,
    next30Days: next30,
    alerts,
    planIssues,
    buildCurve,
    generatedAt: new Date().toISOString(),
    isPlaceholder: false,
  };
}

/* ── Mode ───────────────────────────────────────────────────── */
function decideMode(state: CoachState): 'race' | 'base' {
  // Race mode = nextA exists AND its days-away falls inside the
  // distance-aware build window (84d for half, 112d for marathon, etc.).
  // Computing from nextA.daysAway directly — NOT from state.races.inWindow
  // — because advanceState doesn't refresh inWindow as the simulation
  // walks forward in time. With the static inWindow check, a future
  // simulation day that should have crossed into BUILD (because the
  // race is now closer than the build window) was still labeled BASE
  // since inWindow reflected gather-time, not the advanced clock.
  // Caught by the runner: "Hold the floor before the build · 11 weeks"
  // when only ~2 weeks should be BASE_MAINTENANCE before crossing into
  // the build window.
  if (!state.races.nextA) return 'base';
  if (state.races.nextA.priority !== 'A') return 'base';
  if (state.races.nextA.daysAway <= 0) return 'base';
  const window = buildWindowDays(state.races.nextA.distanceMi);
  return state.races.nextA.daysAway <= window ? 'race' : 'base';
}

/* ── Phase ──────────────────────────────────────────────────── */
function decidePhase(state: CoachState, mode: 'race' | 'base'): Phase {
  // Race mode → sub-phase by days-to-A.
  if (mode === 'race' && state.races.nextA) {
    return raceSubPhase(state.races.nextA.daysAway, state.races.nextA.distanceMi) as RaceSubPhase;
  }
  // Base mode — POST_RACE while ANY recent race's distance-aware
  // recovery window is still open. A marathon contributes 26 days,
  // a half 14, a 10K 7. So a marathon 21 days ago still qualifies
  // as POST_RACE even though the previous "14 day" rule would have
  // closed it. Stacking races (marathon + half within 14 days) keeps
  // the phase active until the LATEST window closes.
  if (state.recoveryWindowEndsISO && state.now <= state.recoveryWindowEndsISO) {
    return 'POST_RACE';
  }
  if (state.flags.rebuildAfterBreak) return 'REBUILD';
  return 'BASE_MAINTENANCE';
}

function describeMode(state: CoachState, phase: Phase): string {
  if (phase === 'TAPER' && state.races.nextA) {
    const d = state.races.nextA.daysAway;
    if (d === 0) return `Race day — ${state.races.nextA.name}`;
    if (d === 1) return `Race tomorrow — ${state.races.nextA.name}`;
    return `${d} days to ${state.races.nextA.name} · taper week — volume drops, intensity holds`;
  }
  if (phase === 'PEAK' && state.races.nextA)  return `${state.races.nextA.daysAway} days to ${state.races.nextA.name} · peak block — marathon-specific work`;
  if (phase === 'BUILD' && state.races.nextA) return `${state.races.nextA.daysAway} days to ${state.races.nextA.name} · build phase — threshold + progression long runs`;
  if (phase === 'BASE' && state.races.nextA)  return `${state.races.nextA.daysAway} days to ${state.races.nextA.name} · base block — aerobic volume`;
  if (phase === 'POST_RACE') {
    const r = state.races.recent[0];
    return r ? `Recovery week — ${r.daysAgo} day${r.daysAgo === 1 ? '' : 's'} since ${r.name}` : 'Recovery — volume drop is by design';
  }
  if (phase === 'REBUILD') return 'Easing back in — rebuilding the base after a break';
  return 'Maintain the base — steady volume, weekly long run, no peaking';
}

/* ── Run picker ─────────────────────────────────────────────── */
function pickRun(state: CoachState, phase: Phase, dow: number): RunPrescription {
  // Race-week / race-day overrides — these short-circuit normal logic.
  if (phase === 'TAPER' && state.races.nextA) {
    const d = state.races.nextA.daysAway;
    if (d === 0) return race(state.races.nextA.distanceMi, state.races.nextA.name);
    if (d === 1) return shakeout();
  }

  // Heavy-block detected + base mode → reduced training, calibrated
  // to the runner's mileage tier. The previous logic mandated full
  // rest every day until the heavy-block flag aged out, which over-
  // recovered everyone — especially low-tier (20-40 mpw) runners
  // whose fitness-bleed cost from extended rest is high relative to
  // base. Now: prescribe protective rest on the tier's rest-day
  // count, otherwise easy aerobic at ~50% of weekly average volume.
  //
  // Tier rest-day cadence (MILEAGE_TIER_RECOVERY high end):
  //   low   (20-40):  2 rest/wk → Mon + Fri
  //   mid   (40-60):  1 rest/wk → Mon
  //   high  (60-80):  1 rest/wk → Mon (shake-out replaces rest mid-week)
  //   elite (80+):    1 rest/wk → Mon (shake-outs preferred elsewhere)
  //
  // Doctrine: Research/00b §"Recovery Scaled to Weekly Mileage" +
  // §13.3 (peaking ≥70 mpw needs 2-4 weeks reduced training).
  if (phase === 'BASE_MAINTENANCE' && state.flags.heavyBlockSuspected) {
    const tier = mileageTier(state.volume.weeklyAvg4w);
    const tierData = MILEAGE_TIER_RECOVERY.value[tier];
    const restDays = tierData.restDaysPerWeekHigh;

    // Sunday=0, Mon=1, ..., Sat=6
    const isMon = dow === 1;
    const isFri = dow === 5;
    const isProtectiveRest = (restDays >= 2 && (isMon || isFri))
      || (restDays === 1 && isMon);
    if (isProtectiveRest) {
      return rest(`Heavy-block recovery — protective rest day (tier ${tierData.label}: ${restDays} rest/wk).`);
    }

    // Reduced-volume easy aerobic. Cap at 50% of weekly average
    // spread across the running days. Floor 2.5 mi.
    const wkAvg = Math.max(state.volume.weeklyAvg4w, 12);
    const reducedWeekly = wkAvg * 0.5;
    const runningDays = 7 - restDays;
    const dailyEasy = Math.max(2.5, round1(reducedWeekly / runningDays));
    const ga = generalAerobic(dailyEasy, state);
    return {
      ...ga,
      description: `${dailyEasy} mi easy aerobic · heavy-block recovery, holding ~50% of usual ${Math.round(wkAvg)} mi/wk volume to maintain frequency without compounding load`,
    };
  }

  // POST_RACE — graduated recovery based on the LARGEST recent race's
  // distance + heavy-block flag (stacked races extend the rest depth).
  //
  // Single race recovery — gentle ramp:
  //   Marathon:    days 0-3 REST, days 4-7 recovery 2-3mi, days 8-14
  //                easy 4-6mi, days 15-21 gradual return, day 22+ base.
  //   Half:        days 0-2 REST, days 3-5 recovery 2-3mi, days 6-9
  //                easy 4-6mi, day 10+ base return.
  //   10K:         days 0-1 REST, days 2-4 recovery, day 5+ base.
  //   5K:          day 0 REST, day 1 recovery, day 2+ base.
  //
  // Heavy block (marathon-in-14d, 2+ races in 14d, etc) — every stage
  // extends ~2x because the second race compounded the damage.
  if (phase === 'POST_RACE') {
    const r = postRaceWorkout(state, dow);
    if (r) return r;
  }

  // VDOT test override: when no recent race exists or the current
  // VDOT signal is stale/expired, the Coach swaps the next quality
  // day for a 5K time trial. Doctrine: VDOT_FIELD_TESTS +
  // VDOT_TEST_TRIGGERS (Research/01 §"Field-test protocols").
  //
  // Guards:
  //   - Skip during TAPER and POST_RACE — race prep + recovery take
  //     priority and quality-day overrides would break those windows.
  //   - Only swap on a "quality day" per defaultByDow — replacing an
  //     easy run with a 5K TT would break the easy/hard distribution.
  //   - Only fires when shouldPromptVdotTest reports a stale/missing
  //     signal — not when the current VDOT is fresh.
  if (phase !== 'TAPER' && phase !== 'POST_RACE' && shouldPromptVdotTest(state)) {
    const def = defaultByDow(phase, dow, state.runner.longRunDow ?? 0);
    const isQualityDay = def.primary === 'threshold'
                      || def.primary === 'threshold_intervals'
                      || def.primary === 'sub_threshold'
                      || def.primary === 'vo2'
                      || def.primary === 'marathon_specific';
    if (isQualityDay) {
      return vdotTest5K();
    }
  }

  // Plan-template path (Stage 4): pick the active template for this
  // runner + goal race, classify today's slot in its sample peak week.
  // The template gives the SHAPE of the week (which days are quality,
  // which are long, which are easy); buildPrescriptionFor still
  // applies user VDOT + state-driven distance/pace targets.
  const template = selectActiveTemplate(state, phase);
  if (template) {
    const wkType = templateWorkoutType(template, dow);
    if (wkType) {
      return buildPrescriptionFor(wkType, state, phase);
    }
  }

  // Fallback: default by phase + day-of-week (from coach-workouts).
  // Used when no template applies, or when the template's sample-week
  // string didn't classify (e.g., a custom workout name we don't
  // recognize — we default to the safer phase+dow lookup). Honors
  // the runner's long-run-day preference (default Sunday).
  const def = defaultByDow(phase, dow, state.runner.longRunDow ?? 0);
  return buildPrescriptionFor(def.primary, state, phase);
}

/** Graduated post-race recovery prescription. Looks at the LARGEST
 *  recent race (most damaging) + heavy-block flag, finds days-since
 *  to that race, and picks the right depth: REST → light recovery →
 *  easy general aerobic → base return. Returns null when nothing
 *  matches (caller falls through to default phase logic).
 *
 *  Research alignment (coaching-research.md):
 *
 *    §13.3 "The recovery period doesn't have to mean no running; it
 *    means easy mileage at 30 to 50 percent of peak, no quality work."
 *    — light recovery is daily, not alternated.
 *
 *    §8.1 lists active recovery as high-evidence: easy spinning or
 *    very-low-intensity jogging supports recovery without taxing the
 *    aerobic system.
 *
 *    §8.3 "every hard training stress requires a recovery period of
 *    24 to 72 hours" — bounds the rest stage. Easy/recovery efforts
 *    are not classified as hard stress.
 *
 *    A heavy-block stack (multiple races within ~30 days) extends the
 *    reduced-volume window (more days at recovery + easy before
 *    structured workouts return), with the rest-stage scaling within
 *    the §8.3 24-72h envelope plus heavy-block accumulation. */
/** Parse "Day 4-5" / "Week 2-3" / "Day 7-10" → number of days.
 *  `which` picks low or high end. Used to consume the post-race
 *  doctrine table's free-text day-range strings as numeric stage
 *  boundaries for the engine's recovery ladder. */
function parseDayRange(s: string, which: 'low' | 'high'): number {
  const m = s.match(/(Day|Week)\s+(\d+)(?:[-–](\d+))?/i);
  if (!m) return 7;
  const unit = m[1].toLowerCase() === 'week' ? 7 : 1;
  const lo = Number(m[2]);
  const hi = m[3] ? Number(m[3]) : lo;
  return (which === 'low' ? lo : hi) * unit;
}

/** Pick the race that's currently the active recovery driver — the
 *  one whose no-quality window has the most days remaining. The
 *  previous logic used `biggest = largest distance` measured from
 *  `mostRecent = newest race's daysAgo`, which over-recovered runners
 *  with a stale-but-bigger race (e.g. marathon 28d ago + half 5d ago
 *  applied marathon's 21-day window from the half's 5-day clock —
 *  result: 2 weeks of recovery jogs when the half was already past
 *  its own 10-day window). The active model: race A is the active
 *  driver when (band.totalRecoveryDays - daysAgo) is largest. The
 *  marathon may not be active even though it's biggest. */
function pickActiveRecoveryRace(state: CoachState): { distanceMi: number; daysAgo: number; name: string } | null {
  if (state.races.recent.length === 0) return null;
  const tier = mileageTier(state.volume.weeklyAvg4w);
  const useHigh = tier === 'high' || tier === 'elite';
  const heavy = state.flags.heavyBlockSuspected;
  const stageMul = heavy ? 1.8 : 1;
  let best: { race: { distanceMi: number; daysAgo: number; name: string }; remaining: number } | null = null;
  for (const r of state.races.recent) {
    const band = POST_RACE_BY_DISTANCE.value[postRaceDistanceBand(r.distanceMi)];
    const totalDays = (useHigh ? band.totalRecoveryDaysNoQualityHigh : band.totalRecoveryDaysNoQualityLow) * stageMul;
    const remaining = totalDays - r.daysAgo;
    if (remaining < 0) continue;  // window already closed
    if (best == null || remaining > best.remaining) {
      best = { race: r, remaining };
    }
  }
  if (best != null) return best.race;
  // No active driver — fall back to most-recent race so the engine
  // still has SOMETHING to anchor stage-4 (past easyEnd but
  // recoveryWindowEndsISO still says POST_RACE) prescriptions to.
  return state.races.recent[0];
}

function postRaceWorkout(state: CoachState, dow: number): RunPrescription | null {
  if (state.races.recent.length === 0) return null;
  const active = pickActiveRecoveryRace(state);
  if (!active) return null;
  const days = active.daysAgo;
  const distMi = active.distanceMi;
  const mostRecent = state.races.recent[0];
  const heavy = state.flags.heavyBlockSuspected;

  // Stage gates derived from POST_RACE_BY_DISTANCE doctrine
  // (Research/00b §Post-Race Recovery) AND tier-calibrated against
  // the runner's weekly mileage history (MILEAGE_TIER_RECOVERY).
  //
  //   restEnd  = end of zero/very-light window (no running yet)
  //   lightEnd = START of return-to-long-runs window (easy aerobic ok now)
  //   easyEnd  = total no-quality recovery duration (no quality work yet)
  //
  // Tier calibration: lower-tier runners (20-40 mpw) exit recovery
  // at the LOW end of each band — extended rest costs them more
  // fitness than it gains in absorption. Higher-tier runners (60+
  // mpw) honor the HIGH end — they have more absolute load to absorb.
  //
  // For a 'low' tier runner post-marathon: zero/very-light 5d (low end),
  // start easy aerobic at day 14 (low end of week 2-3), quality returns
  // at day 21 (low end of 21-28d). Total ~3 weeks.
  //
  // For a 'high' tier runner post-marathon: zero/very-light 10d (high end),
  // start easy aerobic at day 21 (high end of week 2-3), quality returns
  // at day 28 (high end). Total ~4 weeks.
  //
  // Heavy-block suspicion stretches windows ~1.8x — back-to-back races
  // + heavy training compound and need more time.
  const band = POST_RACE_BY_DISTANCE.value[postRaceDistanceBand(distMi)];
  const tier = mileageTier(state.volume.weeklyAvg4w);
  const useHigh = tier === 'high' || tier === 'elite';
  const stageMul = heavy ? 1.8 : 1;
  const restEnd  = Math.round((useHigh ? band.zeroOrVeryLightDaysHigh : band.zeroOrVeryLightDaysLow) * stageMul);
  const lightEnd = Math.round(parseDayRange(band.returnToLongRunsDay, useHigh ? 'high' : 'low') * stageMul);
  const easyEnd  = Math.round((useHigh ? band.totalRecoveryDaysNoQualityHigh : band.totalRecoveryDaysNoQualityLow) * stageMul);

  // Reverse-taper week-by-week focus from REVERSE_TAPER_PROTOCOL
  // (and the marathon-specific MARATHON_RECOVERY_4WK_REVERSE_TAPER
  // when applicable). The week-post-race lookup gives us the doctrine
  // focus line to append to the prescription's voice description so
  // the runner sees the WHY of today's volume, not just the number.
  const weeksPostRace = Math.floor(days / 7) + 1;
  const reverseTaperWeek = REVERSE_TAPER_PROTOCOL.value.find(w => w.weekPostRace === Math.min(weeksPostRace, 6))
    ?? REVERSE_TAPER_PROTOCOL.value[REVERSE_TAPER_PROTOCOL.value.length - 1];
  const isMarathon = distMi >= 22;
  const marathonWeek = isMarathon
    ? MARATHON_RECOVERY_4WK_REVERSE_TAPER.value.find(w => w.weekPostRace === Math.min(weeksPostRace, 4))
    : null;
  const focusSuffix = marathonWeek
    ? ` · Week ${weeksPostRace} marathon recovery: ${marathonWeek.notes}`
    : ` · Week ${weeksPostRace} recovery focus: ${reverseTaperWeek.focus}`;

  if (days <= restEnd) {
    const racesDesc = state.races.recent.length > 1
      ? `${state.races.recent.length} races in ${state.races.recent[state.races.recent.length - 1].daysAgo} days (last: ${mostRecent.name})`
      : `${days === 0 ? 'Race day' : `${days} day${days === 1 ? '' : 's'}`} since ${mostRecent.name}`;
    return rest(`${racesDesc}. Full rest today.${focusSuffix} ${heavy ? 'Heavy block stacked — needs proper recovery before any running.' : 'The body needs 24-72h before any running, even easy.'}`);
  }
  // Day-of-week anchors derived from the runner's preferred long-run
  // day (default Sunday). All post-race day patterns rotate around
  // this anchor so the runner's preference is honored.
  const longDow = ((state.runner.longRunDow ?? 0) + 7) % 7;
  const recoveryDow = (longDow + 1) % 7;   // day after long
  const restDow = (longDow + 2) % 7;        // chill day
  const midRestDow = (longDow + 4) % 7;    // mid-week protective rest
  const lightJogDays = [(longDow + 3) % 7, (longDow + 5) % 7, (longDow + 6) % 7];
  const lightRestDays = [longDow, recoveryDow, restDow, midRestDow];
  const isLightJogDay = lightJogDays.includes(dow);
  const isLightRestDay = lightRestDays.includes(dow);

  // Stage-2 (light) — reverse-taper Week 1: "Days 4-7: 20-30 min very
  // easy jogs every other day". So light stage = run-day-rest-day
  // alternation, NOT 7 straight recovery jogs. 3 running days, 4 rest.
  if (days <= lightEnd) {
    if (isLightRestDay && !isLightJogDay) {
      return rest(`${days} days post ${active.name}. Light stage — protective rest, easy jog tomorrow.${focusSuffix}`);
    }
    // Recovery-jog floor scales with the runner's daily aerobic floor.
    // A 2.5 mi recovery jog is built for a ~20 mpw runner (~3 mi/day);
    // a 60 mpw runner whose daily floor is ~8 mi needs a longer jog
    // to keep circulation honest without going hard. Floor = clamp
    // (weeklyAvg4w / 7 × 0.55) into [2.0, 6.0].
    const dailyFloor = state.volume.weeklyAvg4w / 7;
    const recoveryMi = Math.max(2.0, Math.min(6.0, round1(dailyFloor * 0.55)));
    return {
      type: 'recovery', label: 'Recovery run',
      distanceMi: recoveryMi, durationMin: null,
      paceTargetSPerMi: null, hrZone: 1,
      description: `${recoveryMi} mi very easy · circulation, not adaptation · or rest if legs aren\'t ready${focusSuffix}`,
      isQuality: false, isLong: false, appendStrides: false,
    };
  }

  // Stage-3 (easy aerobic, no quality) — reverse-taper Week 2-3:
  // "Rebuild frequency, most days short easy" → 5 running days, 2
  // rest days, with a longer day on the long-run anchor. Pattern
  // for Sun-anchored long: Mon rest (post-long), Tue/Wed easy,
  // Thu rest (midweek), Fri easy, Sat easy, Sun longer rebuild.
  if (days <= easyEnd) {
    const baseEasy = baseEasyMi(state, 'POST_RACE');
    if (dow === recoveryDow || dow === midRestDow) {
      return rest(`${days} days post ${active.name}. Easy stage — protective rest, return to long-run rhythm.${focusSuffix}`);
    }
    if (dow === longDow) {
      // Longer rebuild day on the runner's preferred long-run day.
      const longishMi = round1(Math.min(baseEasy * 1.5, baseEasy + 3));
      return {
        type: 'general_aerobic', label: 'Long easy (rebuild)',
        distanceMi: longishMi, durationMin: null,
        paceTargetSPerMi: null, hrZone: 2,
        description: `${longishMi} mi easy · the rebuild-duration anchor of the week · conversational throughout${focusSuffix}`,
        isQuality: false, isLong: true, appendStrides: false,
      };
    }
    const milesPrescribed = round1(Math.max(3, Math.min(baseEasy * 0.85, 7)));
    return {
      type: 'general_aerobic', label: 'General aerobic',
      distanceMi: milesPrescribed, durationMin: null,
      paceTargetSPerMi: null, hrZone: 2,
      description: `${milesPrescribed} mi easy aerobic · stay conversational · rebuild frequency${focusSuffix}`,
      isQuality: false, isLong: false, appendStrides: false,
    };
  }

  // Stage-4 — past easyEnd but recoveryWindowEndsISO still says
  // POST_RACE (rare; happens for stacked-race scenarios where the
  // overall window outlasts the active driver's stage gates). Run
  // a normal-shaped easy week with no quality. Same Mon+Thu rest
  // as stage-3 (per low-tier doctrine: 1-2 rest days/week). Without
  // the second rest day this stage produced 6-7 consecutive easy
  // days, which the runner correctly flagged as too monotone.
  const baseEasy = baseEasyMi(state, 'POST_RACE');
  if (dow === recoveryDow || dow === midRestDow) {
    return rest(`${days} days post ${active.name}. Recovery window still open — protective rest day, ${dow === recoveryDow ? 'post-long absorb' : 'midweek reset'}.`);
  }
  if (dow === longDow) {
    const longMi = round1(Math.min(baseEasy * 1.7, baseEasy + 4));
    return {
      type: 'general_aerobic', label: 'Long easy',
      distanceMi: longMi, durationMin: null,
      paceTargetSPerMi: null, hrZone: 2,
      description: `${longMi} mi easy long · still inside recovery window — no quality, build duration${focusSuffix}`,
      isQuality: false, isLong: true, appendStrides: false,
    };
  }
  // Medium-long day on what would otherwise be the mediumLongDow
  // (longDow + 5) — gives the week a second-longest day so the
  // 5 running days vary in shape, not just length-of-easy.
  if (dow === ((longDow + 5) % 7)) {
    const mediumMi = round1(Math.min(baseEasy * 1.3, baseEasy + 2));
    return {
      type: 'general_aerobic', label: 'Medium-long easy',
      distanceMi: mediumMi, durationMin: null,
      paceTargetSPerMi: null, hrZone: 2,
      description: `${mediumMi} mi easy · the second-longest day of the week · no quality yet${focusSuffix}`,
      isQuality: false, isLong: false, appendStrides: false,
    };
  }
  const milesPrescribed = round1(baseEasy);
  return {
    type: 'general_aerobic', label: 'General aerobic',
    distanceMi: milesPrescribed, durationMin: null,
    paceTargetSPerMi: null, hrZone: 2,
    description: `${milesPrescribed} mi easy aerobic · still inside recovery window — no quality yet${focusSuffix}`,
    isQuality: false, isLong: false, appendStrides: false,
  };
}

function buildPrescriptionFor(type: RunWorkoutType, state: CoachState, phase: Phase): RunPrescription {
  const baseEasy = baseEasyMi(state, phase);
  const longTarget = longRunTarget(state, phase);

  // Phase progress drives within-phase ramping for quality workouts.
  // Pfitz/Daniels plans don't prescribe peak-week intensity from
  // BUILD week 1 — they ramp threshold distance, interval reps, etc.
  // over the phase. We compute progress 0..1 from the runner's
  // days-to-A-race and use it to lerp workout parameters between
  // early-phase low and late-phase high values.
  const subPhase: RaceSubPhase | null = (phase === 'BASE' || phase === 'BUILD' || phase === 'PEAK' || phase === 'TAPER')
    ? phase
    : null;
  const daysToA = state.races.nextA?.daysAway ?? null;
  const distMi = state.races.nextA?.distanceMi ?? 13.1;
  const progress = subPhase ? phaseProgress(daysToA, distMi, subPhase) : 0;

  switch (type) {
    case 'recovery':           return recovery(Math.min(5, Math.max(3, baseEasy * 0.6)));
    case 'general_aerobic':    return generalAerobic(baseEasy, state);
    case 'medium_long':        return mediumLong(Math.max(8, baseEasy * 1.6), state);
    case 'long_steady':        return longSteady(longTarget, state);
    case 'long_progression':   return longProgression(longTarget, state);
    case 'long_mp_block':      return longMpBlock(longTarget, state, Math.min(14, Math.max(6, longTarget * 0.55)));
    case 'threshold': {
      // Threshold-tempo distance ramps 5 → 8 mi over the phase.
      // Total = WU 2 + tempo + CD 1; tempo = 2 → 5 over progress.
      const totalMi = lerpByProgress(5, 8, progress);
      return thresholdContinuous(totalMi, state);
    }
    case 'threshold_intervals': {
      // Reps ramp 3 → 5 over the phase.
      const reps = Math.round(lerpByProgress(3, 5, progress));
      return thresholdIntervals(state, reps);
    }
    case 'sub_threshold': {
      // Reps ramp 3 → 6 over the phase.
      const reps = Math.round(lerpByProgress(3, 6, progress));
      return subThreshold(state, reps);
    }
    case 'vo2': {
      // Reps ramp 4 → 6, distance per rep 800m → 1200m over the phase.
      const reps = Math.round(lerpByProgress(4, 6, progress));
      const repM = Math.round(lerpByProgress(800, 1200, progress) / 100) * 100;
      return vo2(state, reps, repM);
    }
    case 'marathon_specific':  return marathonSpecific(state);
    case 'strides_appended':   return easyWithStrides(baseEasy, state);
    case 'shakeout':           return shakeout();
    case 'race':               return state.races.nextA ? race(state.races.nextA.distanceMi, state.races.nextA.name) : rest('No race scheduled.');
    case 'vdot_test_5k':       return vdotTest5K();
    case 'rest':               return rest('Scheduled rest day.');
  }
}

/** Adaptive training-response score — −1 (struggling) to +1 (crushing).
 *  Reads observable signals to detect whether the runner is absorbing
 *  current load well, then bumps volume/intensity targets accordingly.
 *  Per the user's spec: "if I'm crushing it, amp up training" — not a
 *  configurable knob, an automatic response.
 *
 *  Signals (each contributes ±0.25, score clipped to [-1, +1]):
 *    + RPE drift NEGATIVE     — workouts feeling EASIER for same prescription
 *    + ACWR in [0.8, 1.2]     — load build is sustainable
 *    + weeklyAvg4w > weeklyAvg8w — actually building, not stagnant
 *    + No incomplete-recovery signals firing this week
 *    − RPE recentHeavy       — recent quality felt too hard
 *    − rebuildAfterBreak     — coming back, dial down
 *    − heavyBlockSuspected    — already in deep recovery, no extra load
 *
 *  Returns 0 (neutral) on no/insufficient data so first-time runners
 *  don't get amplified prescriptions before a baseline exists. */
function trainingResponseScore(state: CoachState): number {
  // Hard blockers — never amp up during recovery or rebuild.
  if (state.flags.heavyBlockSuspected) return -0.5;
  if (state.flags.rebuildAfterBreak) return -0.3;

  let score = 0;
  // RPE drift: negative drift = workouts feeling easier than they used
  // to. The classic sign of fitness moving forward. Threshold ±0.5
  // RPE points (Borg CR-10 scale).
  if (state.rpe.drift != null) {
    if (state.rpe.drift < -0.5) score += 0.25;
    else if (state.rpe.drift > 0.5) score -= 0.25;
  }
  if (state.rpe.recentHeavy) score -= 0.25;

  // ACWR sustainable band [0.8, 1.2]. Above 1.3 = injury-risk zone;
  // below 0.7 = detraining.
  const ratio = acwr(state);
  if (ratio != null) {
    if (ratio >= 0.8 && ratio <= 1.2) score += 0.25;
    else if (ratio > 1.3) score -= 0.25;
  }

  // Volume momentum: weeklyAvg4w climbing relative to weeklyAvg8w.
  // +5% trailing means the runner is in a real build trend.
  if (state.volume.deltaPct4v4 != null) {
    if (state.volume.deltaPct4v4 > 0.05) score += 0.25;
    else if (state.volume.deltaPct4v4 < -0.10) score -= 0.25;
  }

  // Easy-share at or above target = polarized training intact, not
  // grinding the middle. Doctrine target ~0.80.
  if (state.intensity.easyShare14d >= 0.78) score += 0.25;
  else if (state.intensity.easyShare14d < 0.65) score -= 0.25;

  return Math.max(-1, Math.min(1, score));
}

/** Daily easy mileage scaled to recent volume + phase. Floors at 3,
 *  caps at 25% of weekly average so a single easy day doesn't blow the
 *  weekly budget. Bumped/dampened by trainingResponseScore so the
 *  engine is responsive to how the runner is absorbing load —
 *  crushing it (score +0.5+) → up to +12% volume; struggling
 *  (score -0.5-) → down to −20%. */
function baseEasyMi(state: CoachState, phase: Phase): number {
  const wkAvg = Math.max(state.volume.weeklyAvg4w, 12);
  const dailyShare = wkAvg / 5;  // Assume ~5 running days/week
  // Adaptive multiplier — only applies during normal training phases;
  // recovery phases (POST_RACE/REBUILD) keep doctrine windows intact.
  const responseMul = (phase === 'POST_RACE' || phase === 'REBUILD' || phase === 'TAPER')
    ? 1
    : 1 + (trainingResponseScore(state) * 0.12);
  if (phase === 'POST_RACE') return Math.max(3, dailyShare * 0.5);
  if (phase === 'REBUILD')   return Math.max(3, dailyShare * 0.7);
  if (phase === 'TAPER')     return Math.max(3, dailyShare * 0.8);
  return Math.max(3, Math.min(dailyShare * responseMul, 14));
}

/** Long-run target — capped at 110% of longest run in last 30 days
 *  (single-session-spike rule, doc §13.1). Phase-specific multipliers
 *  + floors live in lib/long-run-cap.ts so engine + dashboard share
 *  ONE source of truth. The cap is the safety ceiling; the adaptive
 *  response can lift the TARGET toward the cap when the runner is
 *  absorbing load well, or pull it back when they aren't. */
function longRunTarget(state: CoachState, phase: Phase): number {
  const cap = maxLongRunMi(state);
  const peakLast = state.volume.longestLast28Mi;
  const target = longRunTargetMi(phase, peakLast);
  // Adaptive response — only applies in BUILD/PEAK/BASE; recovery
  // phases honor doctrine targets exactly.
  const responseMul = (phase === 'POST_RACE' || phase === 'REBUILD' || phase === 'TAPER')
    ? 1
    : 1 + (trainingResponseScore(state) * 0.10);
  return Math.min(cap, target * responseMul);
}

/* ── Hard constraints ───────────────────────────────────────── */
function applyConstraints(p: RunPrescription, state: CoachState, phase: Phase, dow: number): RunPrescription {
  // 1. Long run can't spike — cap at maxLongRunMi.
  if (p.isLong && p.distanceMi > maxLongRunMi(state)) {
    const capped = maxLongRunMi(state);
    return { ...p, distanceMi: round1(capped),
      description: p.description.replace(/^\d+(\.\d+)?\s*mi/i, `${round1(capped)} mi`)
        + ` · capped to ${round1(capped)} mi (long-run spike rule: never >10% over your recent longest)`,
    };
  }

  // 2. 24h recovery: yesterday hard → today must be easy.
  // Threshold from coach/doctrine/hr_zones.ts HRMAX_ZONES_5 — 80% HRmax
  // is the bottom of the threshold zone. Uses the runner's actual
  // HRmax (measured > Tanaka estimate from age) when set; falls back
  // to HARD_EFFORT_HR_DEFAULT_BPM (152, ~80% × 190 default HRmax)
  // when the profile is empty.
  const hardThresholdBpm = state.runner?.resolvedHrmaxBpm != null
    ? Math.round(state.runner.resolvedHrmaxBpm * 0.80)
    : HARD_EFFORT_HR_DEFAULT_BPM;
  const y = state.recovery.yesterday;
  const yesterdayHard = y && y.distMi > 0 && y.avgHr != null && y.avgHr >= hardThresholdBpm;
  if (p.isQuality && yesterdayHard) {
    return generalAerobic(baseEasyMi(state, phase), state);
  }

  // 3. ACWR > 1.3 → flag and downshift quality to general aerobic.
  const ratio = acwr(state);
  if (ratio != null && ratio > ACWR_HIGH && p.isQuality && !p.isLong) {
    const easy = generalAerobic(baseEasyMi(state, phase), state);
    return { ...easy, description: `${easy.description} · acute load is ${ratio.toFixed(2)}× chronic, holding off on quality today` };
  }

  // 4. POST_RACE phase — never quality, ever.
  if (phase === 'POST_RACE' && p.isQuality) {
    return recovery(Math.max(3, baseEasyMi(state, phase) * 0.7));
  }

  // 5. Rebuild — cap distance to a sensible easy.
  if (phase === 'REBUILD' && p.distanceMi > baseEasyMi(state, phase) * 1.3) {
    return generalAerobic(Math.max(3, baseEasyMi(state, phase)), state);
  }

  // dow used implicitly via the picker; keep for future placement rules.
  void dow;
  return p;
}

function isHardRun(p: RunPrescription): boolean {
  return p.isQuality || (p.isLong && p.distanceMi >= 10);
}

/* ── Alerts ─────────────────────────────────────────────────── */
function computeAlerts(state: CoachState, phase: Phase): CoachToday['alerts'] {
  const out: CoachToday['alerts'] = [];

  // Heavy-block + post-race contexts are already explained in the
  // workout description AND the readiness sentence. Adding a third
  // alert that says the same thing produces banner-fatigue, so we skip
  // these when the description carries the message.
  if (phase === 'BASE_MAINTENANCE' && state.flags.heavyBlockSuspected) {
    // No alert — description ("X races in N days, full rest today")
    // and readiness ("recovery is the work right now") already cover it.
  }
  if (phase === 'POST_RACE') {
    // Same — workout description already names the recent race + the
    // recovery posture. Suppress.
  }
  if (state.flags.rebuildAfterBreak) {
    out.push({ severity: 'warn', message: 'Last 7 days mileage is well below your 28-day average. Rebuild week — easy mileage only.' });
  }
  // Easy-share alert — only fires in phases where the runner has
  // forward agency over training composition. POST_RACE and REBUILD
  // are recovery phases; the past 14 days will mechanically fail the
  // ratio and the alert isn't actionable. Skip it.
  const target = intensityTarget(phase);
  if (
    phase !== 'POST_RACE' && phase !== 'REBUILD' &&
    state.intensity.easyShare14d > 0 &&
    state.intensity.easyShare14d < target.easyShareMin
  ) {
    out.push({ severity: 'warn', message: `Only ${Math.round(state.intensity.easyShare14d * 100)}% easy miles last 14 days. Target for this phase is ≥${Math.round(target.easyShareMin * 100)}% — drop intensity before injury risk climbs.` });
  }
  if (state.races.nextA && state.races.nextA.daysAway > 0 && state.races.nextA.daysAway <= 14) {
    out.push({ severity: 'info', message: `${state.races.nextA.daysAway}-day taper window for ${state.races.nextA.name}. Volume drops 40-60%, intensity preserved.` });
  }
  const ratio = acwr(state);
  if (ratio != null && ratio > ACWR_HIGH) {
    out.push({ severity: 'warn', message: `Acute:chronic load ratio is ${ratio.toFixed(2)}× — over the 1.3 ceiling. Holding intensity until it drops.` });
  }
  return out;
}

/* ── Week shape simulation ──────────────────────────────────── */
// Walks every day through the SAME picker the actual prescription
// uses (pickRun + applyConstraints), advancing state forward one day
// at a time so race-week overrides and post-race graduated recovery
// reflect what the day will actually look like. Today's entry is
// guaranteed to match coachDaily's prescription.
function simulateWeek(state: CoachState, phase: Phase, todayDow: number): CoachToday['weekShape'] {
  const today = new Date(state.now + 'T12:00:00Z');
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + (todayDow === 0 ? -6 : 1 - todayDow));

  const cadence = strengthWeekContext(state, phase).cadence;
  const out: CoachToday['weekShape'] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const isToday = iso === state.now;

    // Calendar offset from today. Past days don't need a real
    // simulation (Strava actuals fill those in on the client) — we
    // still emit an entry so the strip stays 7 wide.
    const offset = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    const dayState = offset > 0 ? advanceState(state, offset) : state;
    const dayPhase = offset > 0 ? decidePhase(dayState, decideMode(dayState)) : phase;

    const run = applyConstraints(pickRun(dayState, dayPhase, dow), dayState, dayPhase, dow);
    const hasStrength = strengthFitsThisDay(state, phase, dow, isHardRun(run), cadence.perWeek);

    out.push({
      date: iso,
      type: run.type,
      label: run.label,
      distanceMi: run.distanceMi,
      description: run.description,
      paceTargetSPerMi: run.paceTargetSPerMi,
      hrZone: run.hrZone,
      isQuality: run.isQuality,
      isLong: run.isLong,
      isToday,
      hasStrength,
    });
  }
  return out;
}

/** Simulate the next 30 days from today forward. Same engine path
 *  as simulateWeek (advance state, re-derive phase, run pickRun)
 *  with race overlays — when a race is scheduled on a day, attach
 *  raceName/racePriority so the strip can flag it.
 *
 *  Used by the dashboard's 30-day outlook tile, which fills the
 *  gap between today's prescription and the race calendar. */
function simulateNext30Days(state: CoachState, phase: Phase): CoachToday['next30Days'] {
  const today = new Date(state.now + 'T12:00:00Z');
  const out: CoachToday['next30Days'] = [];

  // Map race ISO date → race meta for overlay lookup. Walk every
  // future race in the build window plus next-A so out-of-window
  // races also show up.
  const raceByDate = new Map<string, { name: string; priority: 'A' | 'B' | 'C' }>();
  for (const r of state.races.inWindow) raceByDate.set(r.date, { name: r.name, priority: r.priority });
  if (state.races.nextA && !raceByDate.has(state.races.nextA.date)) {
    raceByDate.set(state.races.nextA.date, { name: state.races.nextA.name, priority: state.races.nextA.priority });
  }

  for (let offset = 0; offset < 30; offset++) {
    const d = new Date(today); d.setUTCDate(today.getUTCDate() + offset);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const isToday = offset === 0;

    const dayState = offset > 0 ? advanceState(state, offset) : state;
    const dayPhase = offset > 0 ? decidePhase(dayState, decideMode(dayState)) : phase;
    const run = applyConstraints(pickRun(dayState, dayPhase, dow), dayState, dayPhase, dow);

    const raceMeta = raceByDate.get(iso) ?? null;
    const dayMode = decideMode(dayState);
    const effectivePhase = offset > 0 ? decidePhase(dayState, dayMode) : phase;
    out.push({
      date: iso,
      type: run.type,
      label: run.label,
      distanceMi: run.distanceMi,
      paceTargetSPerMi: run.paceTargetSPerMi,
      hrZone: run.hrZone,
      description: run.description,
      isQuality: run.isQuality,
      isLong: run.isLong,
      isToday,
      phase: effectivePhase,
      modeDetail: describeMode(dayState, effectivePhase),
      raceName: raceMeta?.name ?? null,
      racePriority: raceMeta?.priority ?? null,
    });
  }
  return out;
}

/** Project per-week aggregates from today through the next A-race.
 *  Same engine path as simulateNext30Days but rolled up to weekly
 *  totals so the dashboard's build-curve view can show real engine
 *  trajectory (volume, long run, quality count) instead of a flat
 *  last-4-week-avg projection.
 *
 *  Only fires when there's a next-A race scheduled. Caps at 14 weeks
 *  forward (long enough for a full marathon block + a couple weeks
 *  past the race for a return-to-base view). */
function simulateBuildCurveWeeks(state: CoachState): CoachToday['buildCurve'] {
  const nextA = state.races.nextA;
  if (!nextA) return [];

  // Walk Monday-anchored weeks. We anchor on Monday of the runner's
  // current week (LA timezone-naive — same convention as the rest of
  // the engine) so weekIndex 0 always covers a clean Mon-Sun window.
  const today = new Date(state.now + 'T12:00:00Z');
  const todayDow = today.getUTCDay();
  const daysToMonday = todayDow === 0 ? -6 : 1 - todayDow;
  const thisMonday = new Date(today);
  thisMonday.setUTCDate(thisMonday.getUTCDate() + daysToMonday);
  const todayMs = today.getTime();
  const raceMs = new Date(nextA.date + 'T12:00:00Z').getTime();
  const totalDaysToRace = Math.round((raceMs - todayMs) / 86_400_000);
  // Project up to (race week + 1 post-race week), capped at 14 weeks
  // total so the curve stays bounded for far-out goals.
  const weeksToShow = Math.min(14, Math.max(2, Math.ceil(totalDaysToRace / 7) + 1));

  const out: CoachToday['buildCurve'] = [];
  for (let w = 0; w < weeksToShow; w++) {
    const weekStart = new Date(thisMonday);
    weekStart.setUTCDate(thisMonday.getUTCDate() + w * 7);
    const weekStartISO = weekStart.toISOString().slice(0, 10);

    // Sum each day in the week. Stop simulating once a day is past
    // the race date (race itself replaces that day's prescription).
    let totalMi = 0;
    let longRunMi = 0;
    let qualityCount = 0;
    let hasMpBlock = false;
    let isRaceWeek = false;
    // Track every day's phase so we can pick the dominant one
    // (mode of the 7 days). The previous logic sampled only Thursday
    // which mis-labeled weeks where a phase boundary fell mid-week.
    const dayPhases: Phase[] = [];
    let representativeDaysToRace = 0;

    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(weekStart);
      dayDate.setUTCDate(weekStart.getUTCDate() + d);
      const offsetFromToday = Math.round((dayDate.getTime() - todayMs) / 86_400_000);
      // Skip days before today (current week's already-elapsed days).
      if (offsetFromToday < 0) continue;
      // Stop at race date — the race itself isn't a training day.
      if (dayDate.getTime() > raceMs) {
        isRaceWeek = true;
        break;
      }
      const dayState = offsetFromToday > 0 ? advanceState(state, offsetFromToday) : state;
      const dayPhase = offsetFromToday > 0 ? decidePhase(dayState, decideMode(dayState)) : decidePhase(state, decideMode(state));
      const dow = dayDate.getUTCDay();
      const run = applyConstraints(pickRun(dayState, dayPhase, dow), dayState, dayPhase, dow);
      totalMi += run.distanceMi;
      if (run.isLong && run.distanceMi > longRunMi) longRunMi = run.distanceMi;
      if (run.isQuality) qualityCount += 1;
      if (run.type === 'long_mp_block' || run.type === 'marathon_specific') hasMpBlock = true;
      dayPhases.push(dayPhase);
      // Use the LAST day of the week (closest to race) as the days-
      // to-race anchor. This matches the runner's mental model: "next
      // Sunday I'll be N days from race" makes more sense than the
      // mid-week sample.
      representativeDaysToRace = nextA.daysAway - offsetFromToday;
    }

    // Dominant phase = most-frequent across the week's days.
    // Tiebreak: pick the LATER phase (closer to race) so a week
    // that bridges BASE→BUILD labels as BUILD (the more advanced
    // commitment), not BASE.
    const phaseOrder: Phase[] = ['POST_RACE', 'REBUILD', 'BASE_MAINTENANCE', 'BASE', 'BUILD', 'PEAK', 'TAPER'];
    const dominantPhase: Phase = (() => {
      if (dayPhases.length === 0) return 'BASE_MAINTENANCE';
      const counts = new Map<Phase, number>();
      for (const p of dayPhases) counts.set(p, (counts.get(p) ?? 0) + 1);
      let best: Phase = dayPhases[0];
      let bestCount = 0;
      for (const [p, c] of counts.entries()) {
        if (c > bestCount || (c === bestCount && phaseOrder.indexOf(p) > phaseOrder.indexOf(best))) {
          best = p;
          bestCount = c;
        }
      }
      return best;
    })();

    out.push({
      weekStartISO,
      weekIndex: w,
      daysToRace: representativeDaysToRace,
      phase: dominantPhase,
      totalMi: round1(totalMi),
      longRunMi: round1(longRunMi),
      qualityCount,
      hasMpBlock,
      isRaceWeek,
    });
  }
  return out;
}

/** Shift CoachState forward by N days for week-shape simulation:
 *  state.now bumps forward, every recent race's daysAgo grows by N,
 *  and the next-A race's daysAway shrinks by N. Lets postRaceWorkout
 *  (graduated by daysAgo) and TAPER overrides (by daysAway) produce
 *  the right answer for a future day without mutating real state. */
function advanceState(state: CoachState, daysOffset: number): CoachState {
  if (daysOffset === 0) return state;
  const advancedNow = (() => {
    const d = new Date(state.now + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + daysOffset);
    return d.toISOString().slice(0, 10);
  })();
  // Age every recent race forward by N days. A race that was 5 days
  // ago is now 5+N days ago — drops out of recovery + heavy-block
  // windows once it ages past their thresholds.
  const advancedRecent = state.races.recent.map(r => ({ ...r, daysAgo: r.daysAgo + daysOffset }));

  // Recompute heavyBlockSuspected for the advanced clock. The flag
  // ages out as races leave the 14/21-day windows. Without this
  // recomputation, the future-day simulation stays "heavy block" for
  // 30 days even when the actual races have aged past relevance —
  // which then trips the BASE_MAINTENANCE → rest-every-day branch.
  // The mileage-spike component of the original flag isn't preserved
  // because we don't simulate future mileage; for projection we only
  // honor the race-count signals which is the right shape anyway.
  const racesIn21 = advancedRecent.filter(r => r.daysAgo <= 21).length;
  const racesIn14 = advancedRecent.filter(r => r.daysAgo <= 14).length;
  const marathonIn14 = advancedRecent.some(r => r.daysAgo <= 14 && r.distanceMi >= 22);
  const heavyBlockSuspected = racesIn21 >= 3 || racesIn14 >= 2 || marathonIn14;

  return {
    ...state,
    now: advancedNow,
    races: {
      ...state.races,
      recent: advancedRecent,
      nextA: state.races.nextA
        ? { ...state.races.nextA, daysAway: state.races.nextA.daysAway - daysOffset }
        : null,
    },
    flags: {
      ...state.flags,
      heavyBlockSuspected,
    },
  };
}

/** Mirrors prescribeStrength's day placement so the week shape's
 *  hasStrength flag matches what the actual prescription would have
 *  said for that day. */
function strengthFitsThisDay(state: CoachState, phase: Phase, dow: number, todayHard: boolean, perWeek: number): boolean {
  if (perWeek === 0) return false;
  const PLACEMENT: Record<string, number[]> = {
    heavy: [1, 4], power: [3], maintenance: [2, 5], mobility: [0, 2],
  };
  const types = phase === 'BASE' ? ['heavy', 'heavy']
    : phase === 'BUILD' ? ['heavy', 'power']
    : phase === 'PEAK' ? ['maintenance']
    : phase === 'TAPER' ? ['maintenance']
    : phase === 'BASE_MAINTENANCE' ? ['heavy', 'heavy']
    : phase === 'REBUILD' ? ['heavy', 'mobility']
    : ['mobility'];
  for (let i = 0; i < Math.min(perWeek, types.length); i++) {
    if (PLACEMENT[types[i]]?.includes(dow)) {
      if (todayHard && (types[i] === 'heavy' || types[i] === 'power')) continue;
      return true;
    }
  }
  return false;
}

/* ── Rationale ──────────────────────────────────────────────── */
function composeRationale(state: CoachState, phase: Phase, p: RunPrescription, strength: StrengthPrescription | null): string {
  // Priority order: explicit overrides → state-driven flags → phase
  // logic → fall-through.
  if (p.type === 'race') return `Race day. Trust the plan, execute the pacing strategy.`;
  if (p.type === 'shakeout') return `Race tomorrow — keep the legs awake without adding fatigue.`;

  if (state.flags.heavyBlockSuspected && p.type === 'rest') {
    return `${state.races.raceCount30d} races finished in the last 30 days; rest is the highest-leverage workout right now.`;
  }
  if (state.flags.rebuildAfterBreak) {
    const ratio = state.volume.weeklyAvg4w > 0 ? Math.round((state.volume.last7Mi / state.volume.weeklyAvg4w) * 100) : null;
    return ratio != null
      ? `Last 7 days are ${ratio}% of your recent weekly average — easing back, not pushing.`
      : `Coming back from a break — easing back in.`;
  }
  if (phase === 'POST_RACE') {
    const r = state.races.recent[0];
    return r ? `${r.daysAgo} day${r.daysAgo === 1 ? '' : 's'} since ${r.name}. Recovery before structure.` : `Recovery before structure.`;
  }
  if (phase === 'TAPER') {
    return `Taper week — fitness is built, the job is to arrive at the start line rested without losing edge.`;
  }
  if (phase === 'PEAK' && p.isLong) {
    return `Peak block long run — most race-specific session in the cycle (Pfitzinger/Canova). Long-run cap is ${maxLongRunMi(state).toFixed(1)} mi (no >10% spikes).`;
  }
  if (p.isQuality && p.isLong) {
    return `Long run with quality — drives both aerobic capacity and race-pace specificity. Cap ${maxLongRunMi(state).toFixed(1)} mi from longest recent.`;
  }
  if (p.isLong) {
    return `Long run anchors the week. Aerobic effort, kept fun. Cap ${maxLongRunMi(state).toFixed(1)} mi from longest recent.`;
  }
  if (p.isQuality) {
    const tgt = intensityTarget(phase);
    return `Mid-week quality session — ${phase.toLowerCase()} target is ${Math.round(tgt.qualityDaysPerWeek)} quality day${tgt.qualityDaysPerWeek === 1 ? '' : 's'}/week, easy share ≥${Math.round(tgt.easyShareMin * 100)}%.`;
  }
  if (strength) {
    return `Easy mileage today; ${strength.label.toLowerCase()} on the Amp completes the day. ${state.intensity.easyShare14d > 0 ? `Last 14d easy share ${Math.round(state.intensity.easyShare14d * 100)}%.` : ''}`.trim();
  }
  return phase === 'BASE_MAINTENANCE'
    ? `Maintain the base — easy mileage compounds across years more than any single hard day.`
    : `Building toward race day — aerobic miles are the substrate.`;
}

/* ── Helpers ────────────────────────────────────────────────── */
function runToTodayShape(p: RunPrescription): TodayPrescription {
  return {
    type: p.type, label: p.label,
    distanceMi: p.distanceMi,
    paceTargetSPerMi: p.paceTargetSPerMi,
    hrZone: p.hrZone,
    description: p.description,
  };
}
function jsDow(iso: string): number {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}
function round1(n: number): number { return Math.round(n * 10) / 10; }
