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
import type { CoachState } from '@/lib/topics/types';
import type { ReadinessHistory } from './readiness-history';
import type { ReadinessStreak } from './readiness-brief';
import { tierRulesFor, HARD_RULES, type ExperienceLevel } from './tier-rules';

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
    | 'on_course';
  priority: HealthActionPriority;
  /** Imperative sentence the runner reads first. */
  action: string;
  /** Underlying data citation (one short line · shows the number). */
  cite: string;
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
}

/**
 * Build the prioritized list of actions for the Health page.
 *
 * Returns at most 3 actions, sorted urgent → low. When nothing
 * triggers, returns a single ON COURSE entry. The frontend can
 * render the priority chip color from .priority.
 */
export function buildHealthActions(args: BuildArgs): HealthAction[] {
  const out: HealthAction[] = [];
  const { breakdown, state, history, streaks, trainingForm, wristTempDeltaC, activeSick, scoreTrend } = args;

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
  if (hrvStreak && rhrStreak && hrvStreak.days >= rules.streakDaysMin && rhrStreak.days >= rules.streakDaysMin) {
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
    if (trainingForm && trainingForm.tsb <= -30) {
      out.push({
        signal: 'tsb_overreach',
        priority: 'urgent',
        action: isInformational
          ? `TSB ${trainingForm.tsb} · overreach band.`
          : 'Two easy days before the next quality session · you\'re deep in overreach.',
        cite: `TSB ${trainingForm.tsb} · overreach band.`,
      });
    }

    // HRV multi-day low at tier threshold (and not already in compound).
    if (hrvStreak && hrvStreak.days >= rules.streakDaysMin && !(rhrStreak && rhrStreak.days >= rules.streakDaysMin)) {
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
    if (rhrStreak && rhrStreak.days >= rules.streakDaysMin && !(hrvStreak && hrvStreak.days >= rules.streakDaysMin)) {
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
    if (state.loadAcwr != null
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
    if (history.sleep.length >= 3) {
      const last3 = history.sleep.slice(-3);
      const deficit3 = last3.reduce((s, p) => s + Math.max(0, 7.5 - p.value), 0);
      const acuteTrip = deficit3 >= 3;
      const chronicTrip = state.sleep7Avg != null && state.sleep7Avg < rules.sleep7AvgFloor;
      if (acuteTrip || chronicTrip) {
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

    // HRV CV destabilizing band (Plews · > 7%).
    if (history.hrvPlews?.cv != null && history.hrvPlews.cv > 7) {
      out.push({
        signal: 'hrv_cv_destabilizing',
        priority: 'medium',
        action: isInformational
          ? `HRV CV ${history.hrvPlews.cv.toFixed(1)}% · destabilizing band.`
          : 'Hold this week at easy · let your HRV variability settle.',
        cite: `HRV rolling CV ${history.hrvPlews.cv.toFixed(1)}% · Plews threshold > 7%.`,
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
          ? `TSB +${trainingForm.tsb} · race-ready band.`
          : 'You\'re sharp · don\'t add volume this week.',
        cite: `TSB +${trainingForm.tsb} · race-ready band.`,
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

    if (out.length === 0 && sustainedPullBack) {
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
