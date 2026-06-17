/**
 * lib/coach/health-actions.ts · WHAT TO DO panel.
 *
 * Replaces the prior WATCHING TOMORROW slot per David 2026-06-03:
 *   "instead of watching tomorrow · can we surface something about
 *    actions to take? Run slower, sleep more, etc whatever it is based
 *    on data."
 *
 * Each action is tied to a SPECIFIC trigger in the data. The runner
 * gets:
 *   · a short imperative sentence (the action)
 *   · a one-line citation showing the underlying number (the why)
 *   · a priority tag · urgent / high / medium / low
 *
 * The engine doesn't extrapolate. If a trigger isn't met, no action
 * fires. If nothing fires, the panel shows ON COURSE · keep doing
 * what you're doing.
 *
 * Note this surface flips the 2026-06-03 no-reactive-coach doctrine
 * for THIS one panel on THIS one page (David's explicit ask). The
 * Today-page prescription card stays unmounted. The doctrine still
 * holds for that surface.
 *
 * Doctrine grounding for each rule:
 *   · Sleep 3+ night deficit            · Walker, sleep-load coupling
 *   · RHR 3+ day elevated streak        · Plews monitoring · Research/15
 *   · HRV 3+ day low streak             · Plews HRV CV · Research/15
 *   · HRV CV destabilizing band         · Plews · CV > 7% threshold
 *   · Wrist temp +0.2°C/+0.3°C above    · Research/15 illness-risk thresholds
 *   · ACWR > 1.3 / > 1.4                · Gabbett spike band
 *   · TSB < -30                         · Banister overreach
 *   · Active sick / niggle              · Hard fact (already in voice)
 */

import type { ReadinessBreakdown } from './readiness';
import { lutealAdjustedHrvBaseline } from './readiness';
import type { CoachState } from '@/lib/topics/types';
import type { ReadinessHistory } from './readiness-history';
import type { ReadinessStreak } from './readiness-brief';
import { tierRulesFor, HARD_RULES, type ExperienceLevel } from './tier-rules';
import { hasRecoverySignal } from './state-presence';

export type HealthActionPriority = 'urgent' | 'high' | 'medium' | 'low' | 'on-course';

export interface HealthAction {
  /** Stable signal tag · so the frontend can pick an icon if needed. */
  signal:
    | 'sick'
    | 'niggle'
    | 'compound'           // HRV + RHR both flagging
    | 'hrv_low_streak'
    | 'rhr_high_streak'
    | 'sleep_deficit'
    | 'hrv_cv_destabilizing'
    | 'wrist_temp_elevated'
    | 'load_spike'
    | 'load_caution'
    | 'load_detraining'
    | 'tsb_overreach'
    | 'tsb_race_ready'
    | 'plan_adapted'       // 2026-06-03 · the plan adapter has changed today/tomorrow
    | 'race_day'           // 2026-06-09 · race morning · execute line (F4)
    | 'race_week'          // 2026-06-09 · race week · taper-noise note (F4)
    | 'on_course';
  priority: HealthActionPriority;
  /** Imperative sentence the runner reads first. */
  action: string;
  /** Underlying data citation (one short line · shows the number). */
  cite: string;
}

/**
 * 2026-06-03 · plan adaptation context. When the plan adapter has
 * already mutated today's or tomorrow's workout, the action panel
 * surfaces that as the primary read instead of issuing a parallel
 * text prescription · "panel describes the plan, doesn't
 * double-prescribe."
 */
export interface PlanAdaptationContext {
  date: string;
  isToday: boolean;
  currentType: string;
  currentSubLabel: string | null;
  currentDistanceMi: number | null;
  originalType: string | null;
  originalSubLabel: string | null;
  originalDistanceMi: number | null;
  reason: string | null;
  kind: 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'other' | null;
}

interface BuildArgs {
  breakdown: ReadinessBreakdown;
  state: CoachState;
  history: ReadinessHistory;
  streaks: ReadinessStreak[];
  trainingForm: { tsb: number; label: string } | null;
  wristTempDeltaC: number | null;
  /** When true, the runner is actively sick (from CoachState recentCheckIns
   *  or sick_episodes). Surfaces the highest-priority skip-intensity action. */
  activeSick: boolean;
  /** 2026-06-03 · recent score history · used to gate the band-driven
   *  fallback so single-day PULL-BACK dips don't trigger prescriptions.
   *  Sustained PULL-BACK (2+ of last 3 days < 40) fires the action;
   *  single-day dips surface as honest acknowledgement without
   *  prescription. */
  scoreTrend: Array<{ date: string; score: number }>;
  /** 2026-06-03 · today's or tomorrow's plan adaptation, if any. When
   *  present, the panel surfaces THIS instead of duplicating the same
   *  message as a separate prescription. Plan is the source of truth
   *  for "what you actually do" · panel just describes it. */
  planAdaptation?: PlanAdaptationContext | null;
  /** 2026-06-09 · Phase 2 F14 — true when the runner is inside race week
   *  and the A-race has no stored gun time (races.meta.startTime). Drives
   *  a logistics nag: race-morning timing math (wake, fuel, corral) hangs
   *  off the gun, and "—" on the race card was being discovered on race
   *  morning (adversarial audit F14). Caller resolves it (needs a DB read). */
  raceGunTimeMissing?: boolean;
}

/**
 * Build the prioritized list of actions for the Health page.
 *
 * Returns at most 3 actions, sorted urgent → low. When nothing
 * triggers, returns a single ON COURSE entry. The frontend can
 * render the priority chip color from .priority.
 */
/**
 * 2026-06-03 · transparency line · "what would trigger an adapt".
 *
 * David's calibration ask (option C): when the panel is quiet, show
 * what the engine is watching for and how close the runner is. Lets
 * the runner SEE the rules of engagement in real-time and re-tune
 * the tier thresholds if the engagement feels off.
 *
 * Format example for an advanced runner with 1-day HRV low, 2-day
 * RHR high, 1-day pull-back:
 *   "Watching for: HRV needs 4 more low days · RHR needs 3 more
 *    high days · score needs 2 more pull-back days. Hard rules
 *    always on: illness, flare, temp +0.4°C, ACWR > 2.0, TSB ≤ -30."
 *
 * For runners with no active progress toward any soft trigger:
 *   "Watching for: HRV 5-day streak · RHR 5-day streak · score
 *    3 pull-back days. Hard rules always on: illness, flare, temp
 *    +0.4°C, ACWR > 2.0, TSB ≤ -30."
 */
export function buildThresholdLine(args: {
  state: CoachState;
  history: ReadinessHistory;
  scoreTrend: Array<{ date: string; score: number }>;
}): string {
  const tier: ExperienceLevel = args.state.profile?.experience_level ?? null;
  const rules = tierRulesFor(tier);

  // 2026-06-04 · compute current streak length DIRECTLY from history,
  // not from the streaks array. The streaks array only records 3+ day
  // streaks · 1- and 2-day runs got dropped, so the line under-reported
  // progress (David's QC: showed "RHR 5-day streak" when actually
  // already at 2/5). Now we count from the tail using the same unified
  // baseline + threshold the streak detector uses, but report ANY
  // length so the runner sees real progress.
  // 2026-06-16 · #19 · apply the luteal-phase HRV allowance so this line
  // counts "HRV low days" against the SAME (luteal-adjusted) baseline the
  // score + the streak detector use. Without it a luteal female's [N/M]
  // line could climb toward the trigger while the score pillar still read
  // "at baseline" — the per-finding context filter must reach here too.
  const hrvBaseline = args.state.hrvBaseline != null
    ? lutealAdjustedHrvBaseline(args.state.hrvBaseline, args.state.biologicalSex, args.state.cyclePhase)
    : null;
  const rhrBaseline = args.state.rhrBaseline;

  const countTrailingHrvLow = (): number => {
    if (hrvBaseline == null) return 0;
    let n = 0;
    for (let i = args.history.hrv.length - 1; i >= 0; i--) {
      if (args.history.hrv[i].value < hrvBaseline) n++;
      else break;
    }
    return n;
  };
  const countTrailingRhrHigh = (): number => {
    if (rhrBaseline == null) return 0;
    let n = 0;
    for (let i = args.history.rhr.length - 1; i >= 0; i--) {
      // +3 bpm above baseline matches the streak detector threshold
      // in lib/coach/readiness-brief.ts:840.
      if (args.history.rhr[i].value - rhrBaseline >= 3) n++;
      else break;
    }
    return n;
  };

  const hrvHas = countTrailingHrvLow();
  const rhvNeeded = rules.streakDaysMin;
  const rhrHas = countTrailingRhrHigh();
  const rhrNeeded = rules.streakDaysMin;

  // Sustained pull-back · count consecutive trailing days <40 (PB band).
  let pbConsec = 0;
  for (let i = args.scoreTrend.length - 1; i >= 0; i--) {
    if (args.scoreTrend[i].score < 40) pbConsec++;
    else break;
  }
  const pbNeeded = rules.pullbackConsecutiveDays;

  // [N/M] format · runner sees "where I am" / "where the bar is" at a
  // glance. Skip rules already past threshold (the chip above fired).
  const parts: string[] = [];
  if (hrvHas < rhvNeeded) parts.push(`HRV low streak [${hrvHas}/${rhvNeeded}]`);
  if (rhrHas < rhrNeeded) parts.push(`RHR high streak [${rhrHas}/${rhrNeeded}]`);
  if (pbConsec < pbNeeded) parts.push(`sustained pull-back [${pbConsec}/${pbNeeded}]`);

  if (parts.length === 0) return '';

  const softLine = `Adapter triggers at: ${parts.join(' · ')}.`;
  const hardLine = 'Hard rules always on: illness, flare, wrist temp +0.4°C, weekly load ratio > 2.0, form score ≤ −30.';
  return `${softLine} ${hardLine}`;
}

export function buildHealthActions(args: BuildArgs): HealthAction[] {
  const out: HealthAction[] = [];
  const { breakdown, state, history, streaks, trainingForm, wristTempDeltaC, activeSick, scoreTrend, planAdaptation } = args;

  // ── PLAN ADAPTATION (when the plan adapter has already moved) ─────
  //
  // 2026-06-03 · The plan adapter mutates plan_workouts when triggers
  // fire (HRV streak, pull-back, etc). When it has, the panel
  // surfaces THAT as the read instead of issuing a parallel text
  // prescription. Architecture: plan is source of truth for "what you
  // actually do" · the panel describes the plan, doesn't double-coach.
  //
  // Sequencing here matters · this fires FIRST (before streak/pull-back
  // rules) so subsequent rules can see `out.length > 0` and suppress
  // themselves if they would duplicate the plan-adapt message.
  if (planAdaptation) {
    const dayPrefix = planAdaptation.isToday ? "Today's" : "Tomorrow's";
    const fromType = (planAdaptation.originalType ?? planAdaptation.currentType).toLowerCase();
    const toType = planAdaptation.currentType.toLowerCase();
    const distanceShaved = planAdaptation.originalDistanceMi != null
      && planAdaptation.currentDistanceMi != null
      && planAdaptation.originalDistanceMi - planAdaptation.currentDistanceMi > 0.05
      ? `${planAdaptation.originalDistanceMi.toFixed(1)}mi → ${planAdaptation.currentDistanceMi.toFixed(1)}mi`
      : null;
    let kindLabel = '';
    if (planAdaptation.kind === 'downgrade') {
      kindLabel = `${dayPrefix} ${fromType} downgraded to ${toType}.`;
    } else if (planAdaptation.kind === 'shave' && distanceShaved) {
      kindLabel = `${dayPrefix} ${toType} shaved · ${distanceShaved}.`;
    } else if (planAdaptation.kind === 'reschedule') {
      kindLabel = `${dayPrefix} ${toType} rescheduled.`;
    } else {
      kindLabel = `${dayPrefix} ${toType} adjusted from ${fromType}.`;
    }
    out.push({
      signal: 'plan_adapted',
      priority: 'high',
      action: kindLabel,
      cite: planAdaptation.reason ?? 'Plan adapter applied a change.',
    });
  }

  // 2026-06-03 · tier-aware thresholds + tone. The runner's
  // experience_level decides:
  //   · how long a streak has to run before firing an action
  //   · how short chronic sleep has to be before flagging
  //   · what ACWR band counts as "spike" vs "caution"
  //   · whether the action reads as a prescription ("Tomorrow easy")
  //     or an observation ("HRV down 5 days · worth noting")
  // See lib/coach/tier-rules.ts for the full table.
  const tier: ExperienceLevel = state.profile?.experience_level ?? null;
  const rules = tierRulesFor(tier);
  const isInformational = rules.tone === 'informational' || rules.tone === 'red-flag-only';
  const isRedFlagOnly = rules.tone === 'red-flag-only';

  // When the plan adapter has already absorbed a signal, suppress the
  // duplicate text prescription. "Tomorrow's tempo downgraded to easy.
  // HRV down 5 days." (plan adapt chip) + "Tomorrow easy · let HRV
  // recover." (streak chip) say the same thing twice. Hard rules + sleep
  // (behavioral lever) + informational chips still fire.
  const planAbsorbed = planAdaptation != null;

  // ── 2026-06-09 · race-killer F4 · race-week proximity ─────────────
  //
  // Inside the final 7 days, fatigue-class signals are EXPECTED taper
  // physiology, not actionable warnings: "taper crud / taper madness —
  // fatigue, sluggish legs, irritability, sleeplessness, phantom pains
  // — is normal. Resist the urge to test fitness. The work is done."
  // (Cite: Research/08-pacing-and-race-week.md §9.) Production proof of
  // the failure mode: 2026-06-08, a single 29 ms partial-night HRV
  // reading (corrected to 46 ms on re-sync) scored readiness 38
  // PULL-BACK and fired pull-back prescriptions. The same logic running
  // on race morning would tell a runner to "take 2-3 easy days" at 5 AM
  // with the gun at 7. Health hard rules (illness, flare, wrist temp)
  // stay on — racing sick is a medical risk, not taper noise.
  const daysToRace = state.nextARace?.days_to_race ?? null;
  const isRaceWeek = daysToRace != null && daysToRace >= 0 && daysToRace <= 7;
  const isRaceMorning = daysToRace === 0;

  // Streak direction convention (lib/coach/readiness-brief.ts):
  //   · hrv  direction 'below' = HRV below baseline (bad)
  //   · rhr  direction 'above' = RHR above baseline (bad)
  const hrvStreak = streaks.find((s) => s.pillar === 'hrv' && s.direction === 'below');
  const rhrStreak = streaks.find((s) => s.pillar === 'rhr' && s.direction === 'above');

  // ── HARD RULES · always fire regardless of tier ───────────────────
  //
  // These are "don't push through this" signals where pushing through
  // has real downside. Apply to every tier · advanced runners still
  // skip when they have flu, still stop when something is flaring,
  // still get the illness-onset alert at wrist temp +0.4°C.

  // Active illness · trumps every other signal.
  if (activeSick) {
    out.push({
      signal: 'sick',
      priority: 'urgent',
      action: 'Skip running today · easy walk only until symptoms clear.',
      cite: 'Active illness logged · resume on feel.',
    });
  }

  // Niggle flare · pain isn't pushable. Same prescription for everyone.
  if (state.activeNiggle && state.activeNiggle.severity === 'flare') {
    out.push({
      signal: 'niggle',
      priority: 'urgent',
      action: `Skip running until ${state.activeNiggle.body_part} clears · don't run through a flare.`,
      cite: `${state.activeNiggle.body_part} · flare · ${state.activeNiggle.days_ago}d ago.`,
    });
  }

  // Wrist temp illness alert · the early-detection threshold.
  if (wristTempDeltaC != null && wristTempDeltaC >= HARD_RULES.wristTempIllnessAlert) {
    out.push({
      signal: 'wrist_temp_elevated',
      priority: 'urgent',
      action: 'Watch closely for cold or flu symptoms today.',
      cite: `Wrist temp +${wristTempDeltaC.toFixed(2)}°C above baseline · illness-onset threshold.`,
    });
  }

  // ACWR injury hard cap · uncoupled from chronic base.
  if (state.loadAcwr != null && state.loadAcwr >= HARD_RULES.acwrInjuryHardCap) {
    out.push({
      signal: 'load_spike',
      priority: 'urgent',
      action: 'Trim 2-3 miles from your next long run · load is in the injury-risk band.',
      cite: `ACWR ${state.loadAcwr.toFixed(2)} · above ${HARD_RULES.acwrInjuryHardCap} hard cap.`,
    });
  }

  // 7-day sustained PULL-BACK · pattern too sustained to ignore.
  const last7Scores = scoreTrend.slice(-HARD_RULES.pullbackForcedAck).map((s) => s.score);
  if (last7Scores.length === HARD_RULES.pullbackForcedAck && last7Scores.every((s) => s < 40)) {
    out.push({
      signal: 'compound',
      priority: 'urgent',
      action: `Take 2-3 easy days · score has been pull-back ${HARD_RULES.pullbackForcedAck} days running.`,
      cite: `Recent scores: ${last7Scores.join('/')}.`,
    });
  }

  // Compound HRV+RHR streak at tier threshold · urgent for everyone.
  // Suppressed when the plan adapter has already moved · the
  // plan_adapted chip carries this same message.
  if (!planAbsorbed && hrvStreak && rhrStreak && hrvStreak.days >= rules.streakDaysMin && rhrStreak.days >= rules.streakDaysMin) {
    out.push({
      signal: 'compound',
      priority: 'urgent',
      action: isInformational
        ? `HRV down ${hrvStreak.days} days + RHR up ${rhrStreak.days} days · compound pattern.`
        : 'Tomorrow easy or rest · HRV and RHR are both flagging.',
      cite: `HRV ${hrvStreak.days}-day low + RHR ${rhrStreak.days}-day high.`,
    });
  }

  // ── TIER-GATED RULES ──────────────────────────────────────────────
  //
  // Skipped entirely in red-flag-only mode (advanced_plus tier). Only
  // hard rules above fire. Otherwise: each rule respects the tier's
  // streak/threshold cutoffs and tone.
  if (!isRedFlagOnly) {

    // TSB deep overreach (Banister · widely-cited -30 threshold).
    // Suppressed when plan adapter already moved (it would have).
    if (!planAbsorbed && trainingForm && trainingForm.tsb <= -30) {
      out.push({
        signal: 'tsb_overreach',
        priority: 'urgent',
        action: isInformational
          ? `Form score ${trainingForm.tsb} · overreach band.`
          : 'Two easy days before the next quality session · you\'re deep in overreach.',
        cite: `Form score ${trainingForm.tsb} · overreach band.`,
      });
    }

    // HRV multi-day low at tier threshold (and not already in compound).
    // Suppressed when plan adapter already moved · the plan_adapted
    // chip carries this message.
    if (!planAbsorbed && hrvStreak && hrvStreak.days >= rules.streakDaysMin && !(rhrStreak && rhrStreak.days >= rules.streakDaysMin)) {
      out.push({
        signal: 'hrv_low_streak',
        priority: 'high',
        action: isInformational
          ? `HRV at or below baseline ${hrvStreak.days} days running.`
          : 'Tomorrow easy · let HRV recover.',
        cite: `HRV ${hrvStreak.days}-day low streak.`,
      });
    }

    // RHR multi-day high at tier threshold.
    // Suppressed when plan adapter already moved.
    if (!planAbsorbed && rhrStreak && rhrStreak.days >= rules.streakDaysMin && !(hrvStreak && hrvStreak.days >= rules.streakDaysMin)) {
      out.push({
        signal: 'rhr_high_streak',
        priority: 'high',
        action: isInformational
          ? `RHR up ${rhrStreak.days} days running.`
          : 'Pull tomorrow\'s intensity back · run easier or shorter.',
        cite: `RHR ${rhrStreak.days}-day elevation streak.`,
      });
    }

    // Wrist temp watch band · informational only at tier's watch threshold.
    if (wristTempDeltaC != null
        && wristTempDeltaC >= rules.wristTempWatch
        && wristTempDeltaC < HARD_RULES.wristTempIllnessAlert) {
      out.push({
        signal: 'wrist_temp_elevated',
        priority: 'high',
        action: isInformational
          ? `Wrist temp +${wristTempDeltaC.toFixed(2)}°C above baseline.`
          : 'Watch for cold or flu symptoms · drop intensity if anything else shows up.',
        cite: `+${wristTempDeltaC.toFixed(2)}°C vs your 30-day baseline.`,
      });
    }

    // ACWR spike at tier threshold.
    // Suppressed when plan adapter already moved (likely a 'shave' kind).
    if (!planAbsorbed
        && state.loadAcwr != null
        && state.loadAcwr >= rules.acwrSpike
        && state.loadAcwr < HARD_RULES.acwrInjuryHardCap) {
      out.push({
        signal: 'load_spike',
        priority: 'high',
        action: isInformational
          ? `ACWR ${state.loadAcwr.toFixed(2)} · spike band for your tier.`
          : 'Trim 1-2 miles from your next long run · load is spiking.',
        cite: `ACWR ${state.loadAcwr.toFixed(2)} · spike band.`,
      });
    }

    // Niggle moderate severity.
    if (state.activeNiggle && state.activeNiggle.severity === 'moderate') {
      out.push({
        signal: 'niggle',
        priority: 'high',
        action: `Easy only until the ${state.activeNiggle.body_part} settles.`,
        cite: `${state.activeNiggle.body_part} · moderate · ${state.activeNiggle.days_ago}d ago.`,
      });
    }

    // Sleep deficit · chronic 7-night avg below tier floor OR acute
    // 3-night deficit ≥ 3h. Sleep is a behavioral lever everyone CAN
    // pull · keep this even for advanced.
    //
    // 2026-06-09 Phase 2 (3.4) · streak ESCALATION on top: when the
    // shortness is a standing pattern (≥10 consecutive nights < 7h ·
    // mirrors lib/coach/sleep-coaching.ts STREAK_NIGHTS), the line
    // stops being a tip and starts being the limiter · priority HIGH
    // and the copy names the streak. A coach would have escalated this
    // two weeks ago (state-audit Part 5 #1 · Research/00b §sleep is the
    // #1 recovery lever). Same history series already in scope.
    if (history.sleep.length >= 3) {
      const last3 = history.sleep.slice(-3);
      const deficit3 = last3.reduce((s, p) => s + Math.max(0, 7.5 - p.value), 0);
      const acuteTrip = deficit3 >= 3;
      const chronicTrip = state.sleep7Avg != null && state.sleep7Avg < rules.sleep7AvgFloor;
      let streakNights = 0;
      for (let i = history.sleep.length - 1; i >= 0; i--) {
        if (history.sleep[i].value < 7.0) streakNights++;
        else break;
      }
      if (streakNights >= 10) {
        out.push({
          signal: 'sleep_deficit',
          priority: 'high',
          action: isInformational
            ? `Night ${streakNights} under 7 hours · this is the limiter now.`
            : `Night ${streakNights} under 7 hours. This is the limiter now, not fitness. In bed for 7:30 tonight · protect it like a workout.`,
          cite: `${streakNights} consecutive nights < 7h · 7-night avg ${state.sleep7Avg ?? '?'}h.`,
        });
      } else if (acuteTrip || chronicTrip) {
        const cite = acuteTrip
          ? `${deficit3.toFixed(1)}h short over the last 3 nights.`
          : `7-night avg ${state.sleep7Avg}h vs 7.5h target.`;
        out.push({
          signal: 'sleep_deficit',
          priority: 'medium',
          action: isInformational
            ? `Sleep ${state.sleep7Avg ?? '?'}h 7-night avg · ${(7.5 - (state.sleep7Avg ?? 7.5)).toFixed(1)}h short.`
            : 'Lights out 30 minutes earlier tonight · target 7.5h.',
          cite,
        });
      }
    }

    // HRV CV destabilizing band.
    // 2026-06-16 · #20 · threshold is Research/03 §CV: RMSSDcv > 14% is
    // the non-functional-overreaching band (recreational-normal is 8–12%,
    // intensified 8–14%). cv is now computed on RAW RMSSD (readiness-
    // history.ts). The old > 7% gate was a raw-RMSSD-literature number
    // applied to CV-of-rolling-LnRMSSD, so it never fired.
    if (history.hrvPlews?.cv != null && history.hrvPlews.cv > 14) {
      out.push({
        signal: 'hrv_cv_destabilizing',
        priority: 'medium',
        action: isInformational
          ? `HRV CV ${history.hrvPlews.cv.toFixed(1)}% · destabilizing band.`
          : 'Hold this week at easy · let your HRV variability settle.',
        cite: `RMSSD CV ${history.hrvPlews.cv.toFixed(1)}% · overreach band > 14%.`,
      });
    }

    // ACWR caution band · between caution and spike thresholds.
    if (state.loadAcwr != null
        && state.loadAcwr >= rules.acwrCaution
        && state.loadAcwr < rules.acwrSpike) {
      out.push({
        signal: 'load_caution',
        priority: 'medium',
        action: isInformational
          ? `ACWR ${state.loadAcwr.toFixed(2)} · caution band.`
          : 'Hold mileage flat next week · don\'t pile on.',
        cite: `ACWR ${state.loadAcwr.toFixed(2)} · caution band.`,
      });
    }

    // Wrist temp informational chip (skipped for advanced+ via tier rules).
    if (rules.wristTempInformational != null
        && wristTempDeltaC != null
        && wristTempDeltaC >= rules.wristTempInformational
        && wristTempDeltaC < rules.wristTempWatch) {
      out.push({
        signal: 'wrist_temp_elevated',
        priority: 'low',
        action: isInformational
          ? `Wrist temp +${wristTempDeltaC.toFixed(2)}°C · watching.`
          : 'Extra hydration + a longer night tonight.',
        cite: `+${wristTempDeltaC.toFixed(2)}°C above your baseline.`,
      });
    }

    // ACWR detraining band.
    if (state.loadAcwr != null && state.loadAcwr < rules.acwrDetraining) {
      out.push({
        signal: 'load_detraining',
        priority: 'low',
        action: isInformational
          ? `ACWR ${state.loadAcwr.toFixed(2)} · below chronic base.`
          : 'Add a few easy miles this week · you\'re drifting below your chronic base.',
        cite: `ACWR ${state.loadAcwr.toFixed(2)} · detraining band.`,
      });
    }

    // TSB race-ready · positive signal · only surface when nothing else
    // is flagging.
    if (trainingForm && trainingForm.tsb >= 25 && out.length === 0) {
      out.push({
        signal: 'tsb_race_ready',
        priority: 'low',
        action: isInformational
          ? `Form score +${trainingForm.tsb} · race-ready band.`
          : 'You\'re sharp · don\'t add volume this week.',
        cite: `Form score +${trainingForm.tsb} · race-ready band.`,
      });
    }

    // Sustained PULL-BACK fallback · score below 40 for N days where N
    // is the tier's threshold. Without this, runners with subtle
    // multi-day dips (no single pillar firing a streak but the score
    // is sustained low) would see "ON COURSE" misleadingly.
    const recentScores = scoreTrend.slice(-3).map((s) => s.score);
    const recentPullBack = recentScores.filter((s) => s < 40).length;
    const sustainedPullBack = recentScores.length >= rules.pullbackConsecutiveDays
      && recentPullBack >= rules.pullbackConsecutiveDays;

    if (!planAbsorbed && out.length === 0 && sustainedPullBack) {
      const worst = [...breakdown.inputs]
        .filter((i) => i.weight < 0)
        .sort((a, b) => a.weight - b.weight)[0];
      const worstLabel = worst
        ? worst.key === 'sleep' ? 'sleep is short'
          : worst.key === 'hrv' ? 'HRV is down'
          : worst.key === 'rhr' ? 'RHR is up'
          : worst.key === 'load' ? 'load is off-balance'
          : worst.key === 'hr_recovery' ? 'HR recovery is weaker'
          : 'signals are mixed'
        : 'signals are mixed';
      out.push({
        signal: 'compound',
        priority: 'high',
        action: isInformational
          ? `Score below 40 ${recentPullBack} of the last ${recentScores.length} days · ${worstLabel}.`
          : `Tomorrow easy · ${worstLabel} and pull-back is sticking.`,
        cite: `Recent scores: ${recentScores.join('/')}.`,
      });
    }
  }

  // ── 2026-06-09 · race-killer F4 · RACE-WEEK GUARD ─────────────────
  //
  // Post-filter (rather than gating each rule) so the suppression list
  // is one auditable place. Health stays on; fatigue-class comes off:
  //   · keep  · sick / niggle / wrist temp (medical) · plan_adapted
  //             (describes a change that already happened) ·
  //             tsb_race_ready (positive) · sleep_deficit (behavioral
  //             lever — "lights out earlier" is good race-week advice).
  //   · drop  · pull-back prescriptions, HRV/RHR streaks, TSB
  //             overreach, every ACWR band — taper physiology reads
  //             exactly like the overload symptoms these rules watch
  //             for, and "trim your next long run" is meaningless when
  //             the next long run is the race.
  if (isRaceWeek) {
    const fatigueClass = new Set<HealthAction['signal']>([
      'compound', 'hrv_low_streak', 'rhr_high_streak', 'tsb_overreach',
      'load_spike', 'load_caution', 'load_detraining', 'hrv_cv_destabilizing',
    ]);
    const suppressed = out.filter((a) => fatigueClass.has(a.signal));
    let kept = out.filter((a) => !fatigueClass.has(a.signal));

    if (isRaceMorning) {
      // Race morning · the only job is execution. Everything except
      // medical hard rules comes off; the execute line leads.
      kept = kept.filter((a) =>
        a.signal === 'sick' || a.signal === 'niggle' || a.signal === 'wrist_temp_elevated');
      kept.unshift({
        signal: 'race_day',
        priority: 'on-course',
        action: 'Race day. Time to execute — the work is done.',
        cite: 'Race-week guard · readiness advice suppressed on race morning (Research/08 §9).',
      });
    } else if (suppressed.length > 0) {
      // Name what was filtered instead of going silently quiet — the
      // panel's whole contract is showing the rules of engagement.
      kept.push({
        signal: 'race_week',
        priority: 'low',
        action: `Race week · ${daysToRace}d out. Taper noise is normal — fatigue signals don't change the plan now. Illness and injury rules stay on.`,
        cite: 'Taper crud is expected · Research/08-pacing-and-race-week.md §9.',
      });
    }

    // 2026-06-09 · Phase 2 F14 — gun-time logistics nag. Fires through
    // race week but not race morning (too late to be useful there; the
    // execute line owns that surface). Medium priority — it's the one
    // race-week to-do that blocks wake/fuel/corral timing math.
    if (!isRaceMorning && args.raceGunTimeMissing) {
      kept.push({
        signal: 'race_week',
        priority: 'medium',
        action: `Gun time not set · ${daysToRace}d out. Confirm the start time and wave on the race page — wake-up, fueling, and corral timing hang off it.`,
        cite: 'races.meta.startTime is empty · race card shows "—".',
      });
    }
    out.length = 0;
    out.push(...kept);
  }

  // ── EMPTY STATE (Option B · transparent trend) ────────────────────
  //
  // When nothing tripped, surface the recent trend honestly. Doesn't
  // prescribe · just shows the runner what the engine is reading. Per
  // David: "B is good · keeps the surface honest without being
  // prescriptive. Shows you the read without telling you what to do."
  if (out.length === 0) {
    const trend3 = scoreTrend.slice(-3).map((s) => s.score);
    const trendStr = trend3.length > 0 ? trend3.join('/') : `${breakdown.score}`;
    const todayInPullBack = breakdown.band === 'pull-back';
    const todayInModerate = breakdown.band === 'moderate';

    // 2026-06-05 · multi-tenant audit Pattern 2 + Pattern 5 fix · the
    // empty-state ladder fires "All quiet · keep doing what you're
    // doing" with the runner's score in tow, regardless of whether
    // that score was backed by real recovery data. For a Strava-only
    // runner with LOAD signal only, no actions trip · "all quiet"
    // gets shown · confident sentence on empty input.
    //
    // Now: when no recovery pillar is real (sleep/HRV/RHR/HR-recovery
    // all missing), bail to an honest "connect a source" message
    // instead of letting the band ladder render. The band itself
    // came from a near-untouched BASELINE=70 · saying "all quiet"
    // would be the very lie this audit Pattern 5 named.
    //
    // Cite: docs/2026-06-05-multi-tenant-audit.html § Pattern 2, 5.
    if (!hasRecoverySignal(state)) {
      return [{
        signal: 'compound',
        priority: 'low',
        action: 'No recovery data yet · connect Apple Health or wear your watch overnight to start tracking.',
        cite: 'Cold-start envelope · no recovery pillar reporting.',
      }];
    }

    if (todayInPullBack) {
      // Today's a dip but it's not sustained (otherwise the sustained
      // fallback above would have fired). Acknowledge honestly.
      return [{
        signal: 'compound',
        priority: 'low',
        action: 'Single-day dip · not a sustained pattern. Ride it out and reassess tomorrow.',
        cite: `Today ${breakdown.score} · recent: ${trendStr}.`,
      }];
    }
    if (todayInModerate) {
      return [{
        signal: 'on_course',
        priority: 'on-course',
        action: 'Mid-range score · no specific signals tripping.',
        cite: `Today ${breakdown.score} · recent: ${trendStr}.`,
      }];
    }
    return [{
      signal: 'on_course',
      priority: 'on-course',
      action: 'All quiet · keep doing what you\'re doing.',
      cite: `Today ${breakdown.score} · recent: ${trendStr}.`,
    }];
  }

  // Sort by priority (urgent → low), keep top 3.
  const order: Record<HealthActionPriority, number> = {
    'urgent': 0, 'high': 1, 'medium': 2, 'low': 3, 'on-course': 4,
  };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 3);
}
