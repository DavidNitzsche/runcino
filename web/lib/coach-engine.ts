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
import { validatePlan, type PlanIssue } from '../coach/plan-validator';
import {
  type Phase, type RaceSubPhase,
  raceSubPhase, intensityTarget, maxLongRunMi, acwr, ACWR_HIGH,
  HEAVY_BLOCK_REST_DAYS, HARD_EFFORT_HR_DEFAULT_BPM,
} from './coach-principles';
const MS_PER_DAY = 86_400_000;
import {
  type RunWorkoutType, type RunPrescription,
  defaultByDow, recovery, generalAerobic, easyWithStrides, mediumLong,
  longSteady, longProgression, longMpBlock, thresholdContinuous,
  thresholdIntervals, subThreshold, vo2, marathonSpecific, shakeout, rest, race,
} from './coach-workouts';
import {
  prescribeStrength, strengthWeekContext, type StrengthPrescription,
} from './coach-strength';
import { selectActiveTemplate, templateWorkoutType } from './coach-plan';

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
  alerts: Array<{ severity: 'info' | 'warn' | 'rest'; message: string }>;
  /** Plan-integrity issues raised by the validator on this prescription.
   *  Empty array = clean plan. Each issue carries a research citation
   *  and surfaces on /training as a banner so engine regressions are
   *  visible to the runner, not just dev-facing logs. */
  planIssues: PlanIssue[];
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
  const rationale = composeRationale(state, phase, run, strength);
  // Plan-integrity validator runs against the simulated week. Each
  // rule cites Research/. UI surfaces these as a banner so engine
  // regressions are visible, not hidden behind dev logs.
  const planIssues = validatePlan({ weekShape: week }, state);

  return {
    mode, modeDetail: describeMode(state, phase),
    phase,
    today: runToTodayShape(run),
    strength,
    rationale,
    weekShape: week,
    alerts,
    planIssues,
    generatedAt: new Date().toISOString(),
    isPlaceholder: false,
  };
}

/* ── Mode ───────────────────────────────────────────────────── */
function decideMode(state: CoachState): 'race' | 'base' {
  // Race mode whenever there's a future A-priority race on the calendar.
  // The legacy gate also required the race to be inside `inWindow` (a
  // distance-aware build window — 84 days for HM, 112 for marathon),
  // which made a goal race outside that window invisible to the engine
  // and dropped the runner into base mode. Combined with a stuck
  // `heavyBlockSuspected` flag in `advanceState`, that produced an
  // all-REST plan past the recovery window. The phase logic
  // (raceSubPhase) already maps far-out daysAway to the 'BASE' phase,
  // so we don't need a secondary gate here — having an A-race is
  // sufficient signal that we're in race mode.
  return state.races.nextA ? 'race' : 'base';
}

/* ── Phase ──────────────────────────────────────────────────── */
function decidePhase(state: CoachState, mode: 'race' | 'base'): Phase {
  // POST_RACE overrides BOTH modes — recovery from a recent race takes
  // priority over race-week prep for the next race. A marathon
  // contributes 26 days of recovery window, a half 14, a 10K 7. So a
  // marathon 21 days ago keeps the runner in POST_RACE even though the
  // next-A race is 96 days out. Without this, a runner with a marathon
  // 9 days ago AND a goal race on the calendar would get full BASE
  // training the day after the marathon — clearly wrong.
  if (state.recoveryWindowEndsISO && state.now <= state.recoveryWindowEndsISO) {
    return 'POST_RACE';
  }
  // Race mode → sub-phase by days-to-A.
  if (mode === 'race' && state.races.nextA) {
    return raceSubPhase(state.races.nextA.daysAway, state.races.nextA.distanceMi) as RaceSubPhase;
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

/* ── Day-of-week preference helpers ─────────────────────────── */
//
// Every "is this a long-run day / quality day / recovery day" question
// the picker asks routes through these three predicates. They read
// state.prefs (parsed from the user_prefs table by gatherCoachState) so
// runners who configured Sunday long runs get Sunday long runs.
//
// Recovery-day logic: when state.prefs.restDow is set, the engine
// respects it; otherwise recovery defaults to the day AFTER the long
// run (mod 7). That keeps the "easy day after the longest day"
// invariant for the common case where the user only configured a long
// run day.

function isLongRunDow(state: CoachState, dow: number): boolean {
  return dow === state.prefs.longRunDow;
}

function isQualityDow(state: CoachState, dow: number): boolean {
  return state.prefs.qualityDows.includes(dow);
}

/** Returns the dow the engine treats as the post-long recovery day.
 *  When the user explicitly set a rest day (state.prefs.restDow), the
 *  engine uses it; otherwise it derives recovery as (longRunDow + 1)
 *  mod 7 so the day after the long run is light. */
function recoveryDowFor(state: CoachState): number {
  if (state.prefs.restDow != null) return state.prefs.restDow;
  return (state.prefs.longRunDow + 1) % 7;
}

function isRecoveryDow(state: CoachState, dow: number): boolean {
  return dow === recoveryDowFor(state);
}

/* ── Run picker ─────────────────────────────────────────────── */
function pickRun(state: CoachState, phase: Phase, dow: number): RunPrescription {
  // ─────────────────────────────────────────────────────────────
  // K2-4: B-race shield. When a B-race sits within ±2 days of
  // today, the engine cannot pile threshold/VO2 on top regardless
  // of the A-race window. Research/00b §"Recovery by Effort (A vs
  // B vs C Race)": "B race | Hard but not depleted; 1-week taper
  // | 7-10 days | 60-70% of A-race recovery". A B-race day is a
  // race day; the day before/after is recovery. Research/08 §9.3
  // race-week templates document the principle — quality work in
  // the ±2 day band around any race produces fatigue without
  // adaptation.
  //
  // We scan state.races.inWindow (which includes A + B + C
  // priorities) and act on B-races. A-race handling stays in the
  // A-race TAPER branch below.
  // ─────────────────────────────────────────────────────────────
  const bRaceShield = findBRaceShield(state);
  if (bRaceShield) {
    if (bRaceShield.daysAway === 0) return race(bRaceShield.distanceMi, bRaceShield.name);
    if (Math.abs(bRaceShield.daysAway) === 1) {
      // ±1 day from B-race — easy or recovery only.
      return recovery(Math.max(3, baseEasyMi(state, phase) * 0.6));
    }
    // ±2 days — no quality. Easy aerobic or long_steady on the user's
    // configured long-run day.
    if (isLongRunDow(state, dow)) return buildPrescriptionFor('long_steady', state, phase);
    return buildPrescriptionFor('general_aerobic', state, phase);
  }

  // Race-week / race-day overrides — these short-circuit normal logic.
  if (phase === 'TAPER' && state.races.nextA) {
    const d = state.races.nextA.daysAway;
    if (d === 0) return race(state.races.nextA.distanceMi, state.races.nextA.name);
    if (d === 1) return shakeout();
    // Race-week prescription: only easy, recovery, shakeout, or rest.
    // Research/08-pacing-and-race-week.md §9.3 day-by-day race-week
    // templates (HM/Marathon) — every day inside ~10 days of the
    // race is short easy / shakeout / strides / optional rest day. No
    // long runs, no T-pace continuous, no VO2 reps. The peak-week
    // template's quality slots are PEAK-block content, not TAPER, so
    // we short-circuit the template + defaultByDow lookups entirely
    // for the final 10 days. §9.1: "The largest cut is to easy
    // mileage; intensity is preserved" — intensity here means a few
    // short strides, not a T-pace continuous workout.
    if (d >= 2 && d <= 10) {
      return raceWeekEasy(state, dow, d);
    }
    // daysAway 11-14 (still TAPER phase mathematically, but outside
    // the final 10-day cutoff). Research/08 §9.2 HM week -2: "60-70%
    // peak, 4-5 mi threshold or 6-8 mi at MP, 12-14 mi w/ MP miles
    // late." This is the "last hard week" where a freshener long run
    // is still appropriate, but volume is already trimmed. Fall
    // through to defaultByDow which gives long_steady on Sat.
  }

  // PEAK→TAPER transition long-run placement. Research/08 §9.2 HM
  // week -1 calls for a "freshener" 8-10 mi long. The normal long-run
  // slot may fall inside the 10-day race-week cutoff, in which case we
  // shift the long earlier in the week so the runner still gets a long
  // anchor before the 10-day quiet zone closes.
  //
  // NOTE: `dow === 2` here is race-day-relative, NOT user-preference-
  // relative. Tuesday is 5 days before a Sunday race (the canonical race
  // day in the doctrine templates), giving the right buffer. If your
  // race lands on a different day, this constant may need rework — flag
  // for follow-up when we generalize race-day to any weekday.
  if (state.races.nextA) {
    const d = state.races.nextA.daysAway;
    if (d >= 11 && d <= 14 && dow === 2) {
      return buildPrescriptionFor('long_steady', state, phase);
    }
  }

  // Heavy-block detected + base mode → mandate rest. Doc §13.3:
  // a runner peaking ≥70 mpw needs 2-4 weeks of reduced training.
  if (phase === 'BASE_MAINTENANCE' && state.flags.heavyBlockSuspected) {
    return rest(`Heavy-block recovery (~${HEAVY_BLOCK_REST_DAYS} days). Full rest today.`);
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
    const r = postRaceWorkout(state);
    if (r) return r;
  }

  // Injury-return / long-gap rebuild — Research/05 §1.4 + §1.5.
  // "Volume before intensity, always" + the heuristic "weeks off ≈
  // weeks to rebuild base". A runner with weeklyAvg4w ≤ 5 mi and the
  // rebuildAfterBreak flag set (last7 ≤ 30% of last28 avg) is in
  // week 1 of a graded return. Week 1 must cap total volume at ~2×
  // the recent baseline. With baseline of ~4 mpw, that's ≤ 8mi — i.e.
  // 3-4 short runs of 1.5-3 mi each plus 3-4 rest days, NOT 6 short
  // runs.
  if (phase === 'REBUILD' &&
      state.flags.rebuildAfterBreak &&
      state.volume.weeklyAvg4w < 8) {
    // Run on the user's quality days + their long-run day + the post-long
    // recovery day — 4 days/week max. The long-run day gets a slightly
    // longer "long" (capped at 30% of weekly via longRunTarget). Other
    // days rest. This is the walk-run-to-easy bridge — cross-training
    // (bike/elliptical) on rest days is encouraged per Research/05 §1.3.
    if (isQualityDow(state, dow)) return buildPrescriptionFor('general_aerobic', state, phase);
    if (isLongRunDow(state, dow)) return buildPrescriptionFor('long_steady', state, phase);
    if (isRecoveryDow(state, dow)) return buildPrescriptionFor('recovery', state, phase);
    return rest('Rest day — week-1 return-to-run cadence. Cross-train (bike, pool, walk) if you want movement.');
  }

  // ─────────────────────────────────────────────────────────────
  // K2-3: Rebuild-after-break softening for ALL volume tiers.
  // Research/05-injury-return-protocols.md §1.4 "Return-to-Volume
  // Guidelines" + §1.5 "Volume before intensity, always" — the
  // principle is scale-free: a 50mpw runner who took 5 days off
  // cannot stack threshold/VO2 on day 1 back any more than a 4mpw
  // runner can. The heuristic "weeks off ≈ weeks to rebuild base"
  // scales (a 5-day break doesn't need a 5-day zero, but it does
  // need ~3-5 days of softening before structured intensity returns).
  //
  // Trigger: state.flags.rebuildAfterBreak (set in coach-state when
  // last7Mi ≤ 0.30 × last28Mi/4). The low-volume tier already
  // short-circuited above; this branch covers the high-volume tier.
  // Suppresses quality, ramps from last7Mi via the crater-aware
  // path in baseEasyMi/longRunTarget.
  // ─────────────────────────────────────────────────────────────
  if (state.flags.rebuildAfterBreak && state.volume.weeklyAvg4w >= 8) {
    // No quality for the first 3-5 days post-break (Research/05 §1.5
    // "Volume before intensity, always"). Long-run slot still allowed,
    // but distance comes from last7Mi via longRunTarget's crater path.
    if (isLongRunDow(state, dow)) return buildPrescriptionFor('long_steady', state, phase);
    if (isRecoveryDow(state, dow)) return buildPrescriptionFor('recovery', state, phase);
    return buildPrescriptionFor('general_aerobic', state, phase);
  }

  // ─────────────────────────────────────────────────────────────
  // Daily check-in gate — qualitative-signal Decision Matrix.
  // Research/00b-recovery-protocols.md §"Warning Signs of Incomplete
  // Recovery" · §"Decision Matrix":
  //   0-1 qualitative signals → continue training
  //   2 qualitative signals   → defer next quality 24-48h
  //   3+ qualitative signals  → 3-5 day cutback (50% volume, no quality)
  //   Persistent ≥2 weeks     → stop structured training (out of scope here).
  // checkin-aggregate.ts marks a day "poor" if energy ≤4 OR soreness ≥7
  // OR stress ≥7 — each row is one qualitative signal day. We read
  // state.checkin?.poorDaysCount as the literal count for the matrix.
  //
  // Mid-week intensity adjustment is bound by phase; here we fold it
  // into today's prescription so the underlying plan honors the
  // qualitative signal — adjustForReality is a safety net, not the
  // first responder.
  //
  // The other engine signals (REBUILD branch, low-volume gate) have
  // already short-circuited above; this gate only fires for runners
  // still inside the structured-training envelope.
  // ─────────────────────────────────────────────────────────────
  const poorDaysCount = state.checkin?.poorDaysCount ?? 0;
  if (poorDaysCount >= 5) {
    // 5+ poor days in the 7-day window — beyond the "3+ cutback"
    // threshold and into "persistent" territory. Today is rest or
    // recovery only; no long runs, no quality.
    if (isLongRunDow(state, dow) || isRecoveryDow(state, dow)) return buildPrescriptionFor('recovery', state, phase);
    return rest(`${poorDaysCount} of the last 7 daily check-ins were poor (energy/soreness/stress). Decision Matrix: full cutback. Rest today — the body is sending the signal.`);
  }
  if (poorDaysCount >= 3) {
    // 3-4 poor days — Decision Matrix "3+ qualitative" cutback. Drop
    // quality, keep easy volume (or long_steady if the slot is a long
    // run). We let the long-run slot through because long easy aerobic
    // is not a "quality" stimulus per Research/00a §1 ("Recovery run /
    // General aerobic") — but threshold/VO2/MP-block are suppressed.
    if (isLongRunDow(state, dow)) return buildPrescriptionFor('long_steady', state, phase);
    if (isRecoveryDow(state, dow)) return buildPrescriptionFor('recovery', state, phase);
    return buildPrescriptionFor('general_aerobic', state, phase);
  }
  if (poorDaysCount >= 1 && state.intensity.easyShare14d > 0 && state.intensity.easyShare14d < 0.60) {
    // 1-2 poor days alone is below the matrix cutback threshold, but
    // combined with an unhealthy easy-share (too much hard work in the
    // last 14 days), still suppress quality today. Easy-share <60% is
    // well below the Research/00a §"Polarized" 80% target — the runner
    // is already over-loading the system before the check-in signal.
    if (isLongRunDow(state, dow)) return buildPrescriptionFor('long_steady', state, phase);
    return buildPrescriptionFor('general_aerobic', state, phase);
  }

  // ─────────────────────────────────────────────────────────────
  // K2-2: Cratered-volume gate. When last7Mi has dropped to <70% of
  // weeklyAvg4w (skipped runs / illness / heat / travel) and we're
  // not also rebuilding from a long break, the engine treats the
  // runner as recovering from disruption. Suppress quality; the easy
  // and long slots are already scaled down via isCrateredVolume() in
  // baseEasyMi / longRunTarget. Don't try to make up the missed
  // mileage — Research/00a §"Volume progression rules": "5-15% per
  // cycle" + 10% rule (Research/05 §1.4 "Return-to-Volume Guidelines").
  // ─────────────────────────────────────────────────────────────
  if (isCrateredVolume(state)) {
    if (isLongRunDow(state, dow)) return buildPrescriptionFor('long_steady', state, phase);
    if (isRecoveryDow(state, dow)) return buildPrescriptionFor('recovery', state, phase);
    return buildPrescriptionFor('general_aerobic', state, phase);
  }

  // Aerobic foundation gate — Research/00a §"Aerobic Base Development"
  // and §"Volume Guidelines by Experience and Distance": a runner
  // averaging <20 mpw who has no quality history yet ("Beginner" tier
  // for HM/Marathon, "Recreational competitive" floor for 5K/10K)
  // builds the aerobic engine FIRST. Daniels §"Practical base-building
  // rules": "Most base running is easy (75-90% in Z1)" and "One Z2
  // stimulus minimum" only AFTER continuous easy is re-established.
  // Returning runners / beginners get easy + strides only until
  // weekly volume crosses ~20 mpw. Templates encode peak-week shapes
  // (already-built runners), so for a low-volume runner the template
  // path prescribes threshold/VO2 inappropriately — gate it out here.
  // TAPER/POST_RACE/race-day already returned above.
  const lowVolumeNoQualityHistory =
    state.volume.weeklyAvg4w < 20 &&
    state.intensity.hardMi14d <= state.volume.last28Mi * 0.05;
  if (lowVolumeNoQualityHistory && phase !== 'PEAK' && phase !== 'TAPER') {
    // Long-run day → long_steady (capped by longRunTarget). Post-long
    // recovery day + explicit rest day → recovery (active recovery
    // day). Other days → easy general aerobic. No threshold, no VO2,
    // no MP-blocks.
    if (isLongRunDow(state, dow)) return buildPrescriptionFor('long_steady', state, phase);
    if (isRecoveryDow(state, dow) || dow === state.prefs.restDow) return buildPrescriptionFor('recovery', state, phase);
    return buildPrescriptionFor('general_aerobic', state, phase);
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
  // recognize — we default to the safer phase+dow lookup). The picker
  // reads the runner's configured weekly cadence (state.prefs) so the
  // long-run / quality / rest days land on the user's chosen weekdays.
  const def = defaultByDow(phase, dow, state.prefs);
  return buildPrescriptionFor(def.primary, state, phase);
}

/** Race-week (TAPER, d≥2 days from race) prescription. Research/08
 *  §9.1: "The largest cut is to easy mileage; intensity is preserved" —
 *  intensity in race week means a few short strides or 1-min @ 5K
 *  pulses, not a continuous T-pace workout. §9.3 race-week templates
 *  for HM/Marathon: every day is easy 25-50 min ± strides, with one
 *  shakeout the day before. No long runs in this window. Race day is
 *  handled in pickRun above; this function fills the d ≥ 2 days. */
function raceWeekEasy(state: CoachState, dow: number, daysToRace: number): RunPrescription {
  // 2 days out → light shakeout
  if (daysToRace === 2) return shakeout();
  // Recovery day or explicit rest day inside race-week → short recovery.
  // (Race-week templates don't include a true rest day — even the rest
  // slot gets a short recovery run per Research/08 §9.3.)
  if (isRecoveryDow(state, dow) || dow === state.prefs.restDow) {
    return recovery(Math.max(3, baseEasyMi(state, 'TAPER') * 0.6));
  }
  // Quality days → easy with strides (intensity preserved per §9.1 —
  // strides on what would normally be a hard day).
  if (isQualityDow(state, dow)) {
    return easyWithStrides(baseEasyMi(state, 'TAPER'), state);
  }
  return generalAerobic(baseEasyMi(state, 'TAPER'), state);
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
function postRaceWorkout(state: CoachState): RunPrescription | null {
  if (state.races.recent.length === 0) return null;
  // Largest race is the load-bearing one for recovery duration.
  const biggest = state.races.recent.slice().sort((a, b) => b.distanceMi - a.distanceMi)[0];
  // Most-recent race tells us how many days have actually passed.
  const mostRecent = state.races.recent[0];
  const days = mostRecent.daysAgo;
  const distMi = biggest.distanceMi;
  const heavy = state.flags.heavyBlockSuspected;

  const stageMul = heavy ? 1.8 : 1;   // heavy block ~2x reduced-volume window
  const restEnd = Math.round((distMi >= 22 ? 3 : distMi >= 11 ? 2 : 1) * stageMul);
  const lightEnd = Math.round((distMi >= 22 ? 7 : distMi >= 11 ? 5 : 3) * stageMul);
  const easyEnd = Math.round((distMi >= 22 ? 14 : distMi >= 11 ? 9 : 5) * stageMul);

  if (days <= restEnd) {
    const racesDesc = state.races.recent.length > 1
      ? `${state.races.recent.length} races in ${state.races.recent[state.races.recent.length - 1].daysAgo} days (last: ${mostRecent.name})`
      : `${days === 0 ? 'Race day' : `${days} day${days === 1 ? '' : 's'}`} since ${mostRecent.name}`;
    return rest(`${racesDesc}. Full rest today. ${heavy ? 'Heavy block stacked — needs proper recovery before any running.' : 'The body needs 24-72h before any running, even easy.'}`);
  }
  if (days <= lightEnd) {
    return {
      type: 'recovery', label: 'Recovery run',
      distanceMi: 2.5, durationMin: null,
      paceTargetSPerMi: null, hrZone: 1,
      description: `2-3 mi very easy · circulation, not adaptation · or rest if legs aren\'t ready`,
      isQuality: false, isLong: false, appendStrides: false,
    };
  }
  if (days <= easyEnd) {
    const baseEasy = baseEasyMi(state, 'POST_RACE');
    return {
      type: 'general_aerobic', label: 'General aerobic',
      distanceMi: round1(Math.max(3, Math.min(baseEasy * 0.7, 6))), durationMin: null,
      paceTargetSPerMi: null, hrZone: 2,
      description: `${round1(Math.max(3, Math.min(baseEasy * 0.7, 6)))} mi easy aerobic · stay conversational · gradual return`,
      isQuality: false, isLong: false, appendStrides: false,
    };
  }
  // Past the easy window but recoveryWindowEndsISO still says POST_RACE
  // (e.g. day 15-26 after a marathon). Allow general aerobic at base
  // volume but no quality work.
  return {
    type: 'general_aerobic', label: 'General aerobic',
    distanceMi: round1(baseEasyMi(state, 'POST_RACE')), durationMin: null,
    paceTargetSPerMi: null, hrZone: 2,
    description: `${round1(baseEasyMi(state, 'POST_RACE'))} mi easy aerobic · still inside the marathon recovery window — no quality yet`,
    isQuality: false, isLong: false, appendStrides: false,
  };
}

function buildPrescriptionFor(type: RunWorkoutType, state: CoachState, phase: Phase): RunPrescription {
  const baseEasy = baseEasyMi(state, phase);
  const longTarget = longRunTarget(state, phase);

  // Injury-return / very-low-volume override on the recovery floor.
  // Standard recovery floors at 3mi; for a runner on 4 mpw baseline
  // that's nearly the whole week. Research/05 §1.4 — distances need
  // to fit the rebuild budget. Recovery is a 1-2mi jog in week 1.
  const recoveryFloor = (phase === 'REBUILD' && state.volume.weeklyAvg4w < 8) ? 1 : 3;

  switch (type) {
    case 'recovery':           return recovery(Math.min(5, Math.max(recoveryFloor, baseEasy * 0.6)));
    case 'general_aerobic':    return generalAerobic(baseEasy, state);
    case 'medium_long':        return mediumLong(Math.max(8, baseEasy * 1.6), state);
    case 'long_steady':        return longSteady(longTarget, state);
    case 'long_progression':   return longProgression(longTarget, state);
    case 'long_mp_block':      return longMpBlock(longTarget, state, Math.min(14, Math.max(6, longTarget * 0.55)));
    case 'threshold':          return thresholdContinuous(8, state);
    case 'threshold_intervals': return thresholdIntervals(state);
    case 'sub_threshold':      return subThreshold(state);
    case 'vo2':                return vo2(state);
    case 'marathon_specific':  return marathonSpecific(state);
    case 'strides_appended':   return easyWithStrides(baseEasy, state);
    case 'shakeout':           return shakeout();
    case 'race':               return state.races.nextA ? race(state.races.nextA.distanceMi, state.races.nextA.name) : rest('No race scheduled.');
    case 'rest':               return rest('Scheduled rest day.');
  }
}

/** Daily easy mileage scaled to recent volume + phase. Floors at 3,
 *  caps at 25% of weekly average so a single easy day doesn't blow the
 *  weekly budget.
 *
 *  REBUILD: very-low-volume / injury-return path. Research/05 §1.4 +
 *  §1.5: "Volume before intensity, always" + 10% rule (or weeks-off
 *  ≈ weeks-to-rebuild-base heuristic). When weeklyAvg4w ≤ 5 mi (gap
 *  of 21+ days, near-zero base), week-1 cap must be ~2× baseline so
 *  the runner doesn't go from 4mi to 18mi in one week. Floor at 1.5mi
 *  per easy day (a 25-30 min jog), not the generic 3mi. */
function baseEasyMi(state: CoachState, phase: Phase): number {
  // REBUILD with very-low baseline (injury return / long gap) — pin
  // distance to baseline, not the 3mi floor. Research/05 §1.4: rebuild
  // takes 4-8 weeks of continuous easy running to reach pre-injury
  // volume. Week 1 starts at baseline, not at pre-injury volume.
  if (phase === 'REBUILD' && state.volume.weeklyAvg4w < 8) {
    const wkAvg = Math.max(state.volume.weeklyAvg4w, 4);
    // Spread over 4 days/week (rebuild frequency, with 3 rest days).
    return Math.max(1.5, wkAvg / 4 * 0.9);
  }
  // ─────────────────────────────────────────────────────────────
  // Crater / disruption guard — Research/00a §"Volume progression
  // rules": "5-15% per training cycle for trained athletes" + the
  // "10% rule" (Research/05 §1.4 "Return-to-Volume Guidelines":
  // "weekly mileage +≤10%/week" as a safety margin). When last7Mi has
  // cratered to <70% of weeklyAvg4w (skipped runs, illness, heat,
  // life event) AND we're not also in the rebuild path, the next
  // week ramps from last7Mi × 1.10 — NOT from weeklyAvg4w. Don't try
  // to "make up" the missed mileage; the body is recovering from
  // disruption.
  // ─────────────────────────────────────────────────────────────
  if (isCrateredVolume(state)) {
    // 1.10× last7Mi → next week target. Divide over ~5 active days
    // (one rest day, one long, plus 3-4 easy). Floor at 2mi (still a
    // real easy run, just short).
    const targetWeek = state.volume.last7Mi * 1.10;
    return Math.max(2, Math.min(targetWeek / 5, 8));
  }
  const wkAvg = Math.max(state.volume.weeklyAvg4w, 12);
  // Higher-volume phases stack 2 quality + 1 long onto the easy days,
  // so the easy slot has to be tighter or the week blows past the
  // phase's volume multiplier ceiling. Math: in a 7-day BUILD/PEAK
  // week we typically have 1 rest + 2 quality + 1 long + 3 easy.
  // Quality days carry their own fixed mileage; long is independent.
  // Divisor 6.5 keeps 3-easy + 1-long + 2-quality + rest within the
  // 1.10× weeklyAvg target (Research/00a §"Volume progression rules":
  // 5-15% per cycle for trained athletes). BASE / POST_RACE / REBUILD
  // / BASE_MAINTENANCE keep the legacy /5 share since they don't stack
  // as much fixed-distance work.
  const dailyShareLow = wkAvg / 6.5;
  const dailyShare = wkAvg / 5;  // Assume ~5 running days/week
  if (phase === 'POST_RACE') return Math.max(3, dailyShare * 0.5);
  if (phase === 'REBUILD')   return Math.max(3, dailyShare * 0.7);
  // TAPER: 50% volume cut. Research/08 §9.1 / §9.2 HM table: HM taper
  // drops 30-50% of peak volume across the 10-14 day window. Easy
  // mileage takes the cut; intensity is preserved (strides + race).
  if (phase === 'TAPER')     return Math.max(3, dailyShare * 0.5);
  if (phase === 'BASE' || phase === 'BUILD' || phase === 'PEAK') return Math.max(3, Math.min(dailyShareLow, 12));
  return Math.max(3, Math.min(dailyShare, 12));
}

/** Finds the closest B-race within ±2 days of `state.now`. Returns null
 *  when no B-race is in window. A-race handling stays in the dedicated
 *  TAPER branch. Used by pickRun to apply the B-race shield: race-day
 *  → race, ±1 → recovery, ±2 → no quality.
 *
 *  @research Research/00b-recovery-protocols.md §"Recovery by Effort
 *            (A vs B vs C Race)" + Research/08-pacing-and-race-week.md
 *            §9.3 day-by-day race-week templates.
 */
function findBRaceShield(state: CoachState): { name: string; distanceMi: number; daysAway: number } | null {
  if (!state.races.inWindow || state.races.inWindow.length === 0) return null;
  let closest: { name: string; distanceMi: number; daysAway: number } | null = null;
  for (const r of state.races.inWindow) {
    if (r.priority !== 'B') continue;
    if (Math.abs(r.daysAway) > 2) continue;
    if (closest == null || Math.abs(r.daysAway) < Math.abs(closest.daysAway)) {
      closest = { name: r.name, distanceMi: r.distanceMi, daysAway: r.daysAway };
    }
  }
  return closest;
}

/** Crater detector — last7Mi has dropped well below the 4-week baseline
 *  and the 4-week baseline is real (>10mi, so we're not flagging a
 *  runner who always logs 5 mpw). The threshold matches the "missed 2-3
 *  planned runs out of 6" signal: last7Mi <70% of weeklyAvg4w. This is
 *  the "skipped runs / illness / heat / travel" disruption signal that
 *  adaptive planning must read. We exempt the legitimate REBUILD path
 *  (low baseline + flag) since that's already handled with its own ramp.
 *
 *  @research Research/00a-distance-running-training.md §"Volume
 *            progression rules" (10% rule) + Research/05-injury-return-
 *            protocols.md §1.4 "Return-to-Volume Guidelines".
 */
function isCrateredVolume(state: CoachState): boolean {
  // Already handled by the dedicated REBUILD branch.
  if (state.volume.weeklyAvg4w < 8) return false;
  // Need a meaningful baseline to detect a "crater" against.
  if (state.volume.weeklyAvg4w < 10) return false;
  return state.volume.last7Mi < state.volume.weeklyAvg4w * 0.7;
}

/** Long-run target — capped at 110% of longest run in last 30 days
 *  (single-session-spike rule, doc §13.1). PEAK targets a slight
 *  increase; TAPER cuts to ~75%; POST_RACE / REBUILD cap at 60-80%.
 *
 *  REBUILD with weeklyAvg4w ≤ 5 mi (injury return) overrides the
 *  generic 6-mile floor: Research/05 §1.4 "long run ≤30% of weekly
 *  volume during rebuild". A runner on 4 mpw cannot have a 6mi long
 *  run — that's 150% of weekly. Pin to ≤25% of week-1 budget. */
function longRunTarget(state: CoachState, phase: Phase): number {
  // POST_RACE — anchor on pre-race TRAINING, not the race itself.
  // Research/00b §Recovery by Effort + marathon-specific recovery:
  // long runs restart at ~50% of pre-race long, ramping back 2-3 weeks.
  if (phase === 'POST_RACE' && state.volume.preRaceLongestTrainingMi != null) {
    const anchor = state.volume.preRaceLongestTrainingMi;
    return Math.min(maxLongRunMi(state), Math.max(3, anchor * 0.50));
  }
  // Injury-return long-run pin — must respect the rebuild week budget.
  if (phase === 'REBUILD' && state.volume.weeklyAvg4w < 8) {
    const wkAvg = Math.max(state.volume.weeklyAvg4w, 4);
    return Math.max(2, wkAvg * 0.30);
  }
  // Crater-aware long-run cap. Anchor is TRAINING-only longest (races
  // excluded) so a recent race doesn't inflate the cap.
  if (isCrateredVolume(state)) {
    const targetWeek = state.volume.last7Mi * 1.10;
    return Math.max(3, Math.min(maxLongRunMi(state), targetWeek * 0.30,
      state.volume.longestTrainingRunLast28Mi * 1.10));
  }
  // Low-volume aerobic-foundation runner.
  if (state.volume.weeklyAvg4w < 20 &&
      state.intensity.hardMi14d <= state.volume.last28Mi * 0.05) {
    const wkAvg = Math.max(state.volume.weeklyAvg4w, 4);
    return Math.max(3, Math.min(maxLongRunMi(state), wkAvg * 0.30));
  }
  const cap = maxLongRunMi(state);
  // peakLast must be a TRAINING run, never a race — using race effort
  // produced a 29mi prescription off a 26.2mi marathon.
  const peakLast = state.volume.longestTrainingRunLast28Mi;
  switch (phase) {
    case 'TAPER':            return Math.min(cap, Math.max(8, peakLast * 0.65));
    case 'PEAK':             return Math.min(cap, Math.max(14, peakLast * 1.05));
    case 'BUILD':            return Math.min(cap, Math.max(10, peakLast * 1.05));
    case 'BASE':             return Math.min(cap, Math.max(8, peakLast));
    case 'BASE_MAINTENANCE': return Math.min(cap, Math.max(8, peakLast));
    case 'POST_RACE':        return Math.min(cap, Math.max(6, peakLast * 0.4));
    case 'REBUILD':          return Math.min(cap, Math.max(6, peakLast * 0.6));
  }
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
  // is the bottom of the threshold zone. Default 152 bpm ≈ 80% × 190.
  const y = state.recovery.yesterday;
  const yesterdayHard = y && y.distMi > 0 && y.avgHr != null && y.avgHr >= HARD_EFFORT_HR_DEFAULT_BPM;
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

  // 5. Rebuild — cap distance to a sensible easy. Cap, don't replace:
  // when longRunTarget is already a deliberately small ≤30%-of-weekly
  // long run (Research/05 §1.4 long-run cap), we want the small long,
  // not a 3mi general-aerobic. Only swap to easy when the original
  // prescription is genuinely large (quality / standard long target).
  if (phase === 'REBUILD' && p.distanceMi > baseEasyMi(state, phase) * 1.3) {
    const cap = Math.max(2, baseEasyMi(state, phase));
    if (p.isLong) {
      // Keep the long-run identity, just cap the distance.
      return { ...p, distanceMi: round1(Math.min(p.distanceMi, cap * 1.6)) };
    }
    return generalAerobic(cap, state);
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
/** Public range-simulator — walks the engine day-by-day from `startISO`
 *  through `endISO` (inclusive) and returns one entry per day. Same
 *  per-day path as `simulateWeek` (advance state, re-derive phase, run
 *  pickRun → applyConstraints). Used by the /plan page to render
 *  month-by-month calendars without each consumer having to import the
 *  internal helpers. The tier-aware streak cap is applied within each
 *  Mon→Sun window so the multi-month view honors the same rest cadence
 *  the single-week strip does. */
export function simulateRange(state: CoachState, startISO: string, endISO: string): CoachToday['weekShape'] {
  const start = new Date(startISO + 'T12:00:00Z');
  const end = new Date(endISO + 'T12:00:00Z');
  if (end.getTime() < start.getTime()) return [];
  const today = new Date(state.now + 'T12:00:00Z');
  const cadence = strengthWeekContext(state, decidePhase(state, decideMode(state))).cadence;
  const out: CoachToday['weekShape'] = [];
  // Per-day record of what the simulator has prescribed so far. We feed
  // these back into rolling 7/28-day volume aggregates BEFORE running
  // pickRun for the next day. Without this loop, every projected day
  // computes against the frozen "today" baseline: weeklyAvg4w never
  // climbs, baseEasyMi pegs at its 3.0mi floor for months, and the
  // long-run cap never lifts off today's longest run. That is the
  // root cause of "every weekday for 4 months: GENERAL AEROBIC 3.0
  // MI" — fixed by advanceStateForSim below.
  const simHistory: SimRun[] = [];

  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const offset = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    const dayState = offset > 0 ? advanceStateForSim(state, offset, simHistory) : state;
    const dayPhase = decidePhase(dayState, decideMode(dayState));
    const run = applyConstraints(pickRun(dayState, dayPhase, dow), dayState, dayPhase, dow);
    const hasStrength = strengthFitsThisDay(state, dayPhase, dow, isHardRun(run), cadence.perWeek);
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
      isToday: iso === state.now,
      hasStrength,
    });
    if (offset > 0 && run.type !== 'rest' && run.distanceMi > 0) {
      simHistory.push({
        dateISO: iso,
        distanceMi: run.distanceMi,
        isRace: run.type === 'race',
      });
    }
  }

  // Apply the tier-aware streak cap per Mon→Sun chunk so weekly cadence
  // is honored regardless of how many weeks the caller requested.
  for (let i = 0; i < out.length; i += 7) {
    const chunk = out.slice(i, Math.min(i + 7, out.length));
    if (chunk.length === 7) {
      enforceWeekStreakCap(chunk, state.volume.weeklyAvg4w);
      // Splice modified chunk back. enforceWeekStreakCap mutates in
      // place — chunk references the array; reassign each index.
      for (let j = 0; j < chunk.length; j++) out[i + j] = chunk[j];
    }
  }
  return out;
}

function simulateWeek(state: CoachState, phase: Phase, todayDow: number): CoachToday['weekShape'] {
  const today = new Date(state.now + 'T12:00:00Z');
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + (todayDow === 0 ? -6 : 1 - todayDow));

  const cadence = strengthWeekContext(state, phase).cadence;
  const out: CoachToday['weekShape'] = [];
  // Within-week feedback: each prior day's run feeds into rolling
  // volume for the next pickRun call so a post-race ramp or rebuild
  // progression evolves day-by-day across the week, not in one jump.
  const simHistoryWeek: SimRun[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const isToday = iso === state.now;

    // Calendar offset from today. Past days don't need a real
    // simulation (Strava actuals fill those in on the client) — we
    // still emit an entry so the strip stays 7 wide.
    const offset = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    const dayState = offset > 0 ? advanceStateForSim(state, offset, simHistoryWeek) : state;
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
    if (offset > 0 && run.type !== 'rest' && run.distanceMi > 0) {
      simHistoryWeek.push({
        dateISO: iso,
        distanceMi: run.distanceMi,
        isRace: run.type === 'race',
      });
    }
  }
  // Tier-aware consecutive-non-rest cap per Research/00b §Recovery
  // Scaled to Weekly Mileage. Without this post-process the per-day
  // pickRun can produce 6+ run days in a row for low-tier runners
  // (post-race recovery + Sun long-run + Mon recovery + Tue-Sat easy
  // = 6 consecutive non-rest days). Convert the latest general-aerobic
  // day in any over-cap streak to REST so the week shape honors the
  // tier's recovery cadence.
  enforceWeekStreakCap(out, state.volume.weeklyAvg4w);
  return out;
}

function enforceWeekStreakCap(days: CoachToday['weekShape'], weeklyAvg4w: number): void {
  // Tier cap: low <40mpw = 5, mid <60 = 6, high <80 = 6, elite = 7
  const cap = weeklyAvg4w < 40 ? 5 : weeklyAvg4w < 80 ? 6 : 7;
  let streakStart = -1;
  let i = 0;
  while (i < days.length) {
    const d = days[i];
    const isRest = d.type === 'rest';
    if (isRest) { streakStart = -1; i += 1; continue; }
    if (streakStart < 0) streakStart = i;
    const streakLen = i - streakStart + 1;
    if (streakLen <= cap) { i += 1; continue; }
    // Over cap — convert the latest non-quality, non-long general-
    // aerobic day in the streak to rest. Walk back from i, prefer the
    // most recent filler so the week keeps its quality + long shape.
    let swapIdx = -1;
    for (let j = i; j >= streakStart; j--) {
      const c = days[j];
      if (c.type === 'rest' || c.isQuality || c.isLong) continue;
      if (c.type === 'recovery') continue; // already light — try a fuller easy first
      swapIdx = j; break;
    }
    if (swapIdx < 0) {
      for (let j = i; j >= streakStart; j--) {
        const c = days[j];
        if (c.type === 'rest' || c.isQuality || c.isLong) continue;
        swapIdx = j; break;
      }
    }
    if (swapIdx < 0) { i += 1; continue; }
    days[swapIdx] = {
      ...days[swapIdx],
      type: 'rest',
      label: 'Rest day',
      distanceMi: 0,
      paceTargetSPerMi: null,
      hrZone: null,
      description: 'Protective rest — cap on consecutive run days at this weekly mileage tier.',
      isQuality: false,
      isLong: false,
    };
    streakStart = -1;
    i = swapIdx + 1;
  }
}

/** Shift CoachState forward by N days for week-shape simulation:
 *  state.now bumps forward, every recent race's daysAgo grows by N,
 *  and the next-A race's daysAway shrinks by N. Lets postRaceWorkout
 *  (graduated by daysAgo) and TAPER overrides (by daysAway) produce
 *  the right answer for a future day without mutating real state.
 *
 *  Also decays `flags.heavyBlockSuspected` once the simulated day is
 *  past the recovery window + HEAVY_BLOCK_REST_DAYS buffer. Without
 *  this decay, a stuck heavy-block flag combined with BASE_MAINTENANCE
 *  causes the engine to prescribe REST for every future day forever
 *  (pickRun line "BASE_MAINTENANCE && heavyBlockSuspected → rest"). */
function advanceState(state: CoachState, daysOffset: number): CoachState {
  if (daysOffset === 0) return state;
  const advancedNow = (() => {
    const d = new Date(state.now + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + daysOffset);
    return d.toISOString().slice(0, 10);
  })();
  // Decay heavy-block flag once we're past the recovery window plus
  // the heavy-block reduced-volume window (doc §13.3). Beyond that the
  // flag has no remaining grounding — both the marathon-in-14d and the
  // races-in-21d criteria have aged out.
  let heavyBlockSuspected = state.flags.heavyBlockSuspected;
  if (heavyBlockSuspected && state.recoveryWindowEndsISO) {
    const windowEnd = Date.parse(state.recoveryWindowEndsISO + 'T12:00:00Z');
    const advancedTs = Date.parse(advancedNow + 'T12:00:00Z');
    const daysPastWindow = Math.round((advancedTs - windowEnd) / MS_PER_DAY);
    if (daysPastWindow > HEAVY_BLOCK_REST_DAYS) heavyBlockSuspected = false;
  }
  return {
    ...state,
    now: advancedNow,
    races: {
      ...state.races,
      recent: state.races.recent.map(r => ({ ...r, daysAgo: r.daysAgo + daysOffset })),
      nextA: state.races.nextA
        ? { ...state.races.nextA, daysAway: state.races.nextA.daysAway - daysOffset }
        : null,
      inWindow: state.races.inWindow.map(r => ({ ...r, daysAway: r.daysAway - daysOffset })),
    },
    flags: { ...state.flags, heavyBlockSuspected },
  };
}

/** One simulated future run, captured during simulateRange / simulateWeek
 *  walks so later days can read the rolling 7/28-day window correctly.
 *  Race-day entries are included — the runner's body registers that
 *  mileage. */
interface SimRun {
  dateISO: string;
  distanceMi: number;
  isRace: boolean;
}

/** Extends `advanceState` with rolling-window volume + intensity
 *  aggregates rebuilt from the simulator's accumulated history. Fixes
 *  "every weekday GENERAL AEROBIC 3.0 MI for 4 months": pickRun reads
 *  `weeklyAvg4w`, `last7Mi`, `last28Mi`, `longestLast28Mi`,
 *  `longestTrainingRunLast28Mi`, and easyShare. None of these moved
 *  before because plain `advanceState` only bumped `now` + decayed
 *  race-dates. The engine kept seeing today's mileage forever, so the
 *  3mi `baseEasyMi` floor bound every projected easy day across all
 *  four months.
 *
 *  Window math (where T = advanced "now"):
 *    last7Mi  = (sim runs T-6..T)  + decayed remnant of original last7Mi
 *    last28Mi = (sim runs T-27..T) + decayed remnant of original last28Mi
 *    weeklyAvg4w = last28Mi / 4
 *    longestLast28Mi = max(sim runs in window,
 *                          original longestLast28Mi if offset < 28)
 *
 *  Linear decay isn't perfectly accurate (real miles weren't uniform)
 *  but it's a defensible interpolation that hands off smoothly to the
 *  simulated runs as they fill the window. By offset ≥ 28 the original
 *  contribution has fully aged out and the window is purely simulated
 *  mileage. */
function advanceStateForSim(state: CoachState, daysOffset: number, simHistory: SimRun[]): CoachState {
  const base = advanceState(state, daysOffset);
  if (daysOffset === 0) return base;
  const advancedTs = Date.parse(base.now + 'T12:00:00Z');

  let simLast7 = 0;
  let simLast28 = 0;
  let simLongest28 = 0;
  let simLongestTraining28 = 0;
  let simEasy14 = 0;
  let simHard14 = 0;
  for (const r of simHistory) {
    const runTs = Date.parse(r.dateISO + 'T12:00:00Z');
    const daysAgo = Math.round((advancedTs - runTs) / MS_PER_DAY);
    if (daysAgo < 0 || daysAgo >= 28) continue;
    simLast28 += r.distanceMi;
    if (r.distanceMi > simLongest28) simLongest28 = r.distanceMi;
    if (!r.isRace && r.distanceMi > simLongestTraining28) simLongestTraining28 = r.distanceMi;
    if (daysAgo < 7) simLast7 += r.distanceMi;
    if (daysAgo < 14) {
      if (r.isRace || r.distanceMi >= 10) simHard14 += r.distanceMi;
      else simEasy14 += r.distanceMi;
    }
  }

  const orig = state.volume;
  const origLast7Remain = Math.max(0, (7 - daysOffset) / 7);
  const origLast28Remain = Math.max(0, (28 - daysOffset) / 28);
  const origIntensity14Remain = Math.max(0, (14 - daysOffset) / 14);

  const last7Mi = Math.round((orig.last7Mi * origLast7Remain + simLast7) * 10) / 10;
  const last28Mi = Math.round((orig.last28Mi * origLast28Remain + simLast28) * 10) / 10;
  const weeklyAvg4w = Math.round((last28Mi / 4) * 10) / 10;
  const orig8wRemain = Math.max(0, (56 - daysOffset) / 56);
  const weeklyAvg8w = Math.round((orig.weeklyAvg8w * orig8wRemain + weeklyAvg4w * (1 - orig8wRemain)) * 10) / 10;

  const origLongestStillInWindow = daysOffset < 28;
  const longestLast28Mi = Math.max(
    origLongestStillInWindow ? orig.longestLast28Mi : 0,
    simLongest28,
  );
  const longestTrainingRunLast28Mi = Math.max(
    origLongestStillInWindow ? (orig.longestTrainingRunLast28Mi ?? 0) : 0,
    simLongestTraining28,
  );

  // Intensity 14-day rollups: hold the ORIGINAL signal across the
  // projection rather than decaying it to zero. The gates that read
  // these (lowVolumeNoQualityHistory: hardMi14d <= last28Mi * 0.05)
  // measure the runner's TRAINING HISTORY — what their body has
  // actually done. The simulator's hypothetical future doesn't change
  // the runner's history. If we decay hardMi14d to zero while the
  // simulator's easy runs inflate last28Mi, the gate flips to "no
  // quality history" and locks the runner out of quality forever
  // (feedback loop — engine prescribes easy → simHard stays 0 → gate
  // stays triggered → engine prescribes easy …). Keep history
  // sticky; the simulator's accumulated simHard14 / simEasy14 ADD
  // on top so quality the engine does plan still moves the needle.
  const origInt = state.intensity;
  const easyMi14d = Math.round((origInt.easyMi14d + simEasy14) * 10) / 10;
  const hardMi14d = Math.round((origInt.hardMi14d + simHard14) * 10) / 10;
  const totalMi14d = easyMi14d + hardMi14d;
  const easyShare14d = totalMi14d > 0 ? easyMi14d / totalMi14d : origInt.easyShare14d;
  // origIntensity14Remain considered for decay, rejected — see above.
  void origIntensity14Remain;

  // rebuildAfterBreak: hold the original signal sticky for the first
  // 28 days of projection. Research/05 §1.4 "Return-to-Volume
  // Guidelines": "weeks off ≈ weeks to rebuild base" — when the real
  // state says "this runner just had a break", we honor it for the
  // first projection block before allowing it to clear naturally as
  // the rolling-window math takes over. Without this hold, the
  // simulator's progressive ramp clears the rebuild flag after a
  // single week of imagined easy runs, and the engine pivots to a
  // full BASE/BUILD plan that doctrinally belongs 3-4 weeks later.
  let rebuildAfterBreak: boolean;
  if (orig.last28Mi > 0 && state.flags.rebuildAfterBreak && daysOffset < 28) {
    // Original state says we're rebuilding; respect it until the
    // simulator has had 4 weeks to legitimately rebuild the base.
    rebuildAfterBreak = true;
  } else {
    rebuildAfterBreak = last28Mi > 0 && last7Mi <= last28Mi / 4 * 0.30;
  }

  return {
    ...base,
    volume: {
      ...orig,
      last7Mi,
      last28Mi,
      weeklyAvg4w,
      weeklyAvg8w,
      longestLast28Mi: Math.round(longestLast28Mi * 10) / 10,
      longestTrainingRunLast28Mi: Math.round(longestTrainingRunLast28Mi * 10) / 10,
    },
    intensity: {
      easyMi14d,
      hardMi14d,
      easyShare14d,
    },
    flags: {
      ...base.flags,
      rebuildAfterBreak,
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
