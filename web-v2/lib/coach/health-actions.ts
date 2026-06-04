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
  const { breakdown, state, history, streaks, trainingForm, wristTempDeltaC, activeSick } = args;

  // ── URGENT ────────────────────────────────────────────────────────
  // Sick · trumps every other signal. The plan engine already pauses
  // hard sessions but the runner still needs to hear it.
  if (activeSick) {
    out.push({
      signal: 'sick',
      priority: 'urgent',
      action: 'Skip running today · easy walk only until symptoms clear.',
      cite: 'Active illness logged · resume on feel.',
    });
  }

  // Compound · HRV streak AND RHR streak simultaneously. The autonomic
  // system is clearly under strain. Collapse the two single-signal
  // actions into one stronger compound message.
  //
  // Streak direction convention (lib/coach/readiness-brief.ts):
  //   · hrv  direction 'below' = HRV below baseline (bad)
  //   · rhr  direction 'above' = RHR above baseline (bad)
  const hrvStreak = streaks.find((s) => s.pillar === 'hrv' && s.direction === 'below');
  const rhrStreak = streaks.find((s) => s.pillar === 'rhr' && s.direction === 'above');
  if (hrvStreak && rhrStreak && hrvStreak.days >= 3 && rhrStreak.days >= 3) {
    out.push({
      signal: 'compound',
      priority: 'urgent',
      action: 'Tomorrow easy or rest · HRV and RHR are both flagging.',
      cite: `HRV down ${hrvStreak.days} days · RHR up ${rhrStreak.days} days.`,
    });
  }

  // Active niggle at flare severity · pull intensity.
  if (state.activeNiggle && state.activeNiggle.severity === 'flare') {
    out.push({
      signal: 'niggle',
      priority: 'urgent',
      action: `Skip running until ${state.activeNiggle.body_part} clears · don't run through a flare.`,
      cite: `${state.activeNiggle.body_part} · flare · ${state.activeNiggle.days_ago}d ago.`,
    });
  }

  // TSB deep overreach · two-easy-day minimum before next quality.
  if (trainingForm && trainingForm.tsb <= -30) {
    out.push({
      signal: 'tsb_overreach',
      priority: 'urgent',
      action: 'Two easy days before the next quality session · you\'re deep in overreach.',
      cite: `TSB ${trainingForm.tsb} · overreach band.`,
    });
  }

  // ── HIGH ──────────────────────────────────────────────────────────
  //
  // 2026-06-03 · pillar-weight triggers added alongside streak triggers.
  // The streak path catches sustained patterns (3+ days); the pillar
  // path catches single-day-deep signals that drag the score hard but
  // don't form a clean streak yet. Without these, you can have a
  // PULL-BACK score (33) with a "ON COURSE" action panel · the bug
  // David flagged ("not sure this makes sense").
  const pillarWeight = (key: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery'): number => {
    const i = breakdown.inputs.find((x) => x.key === key);
    return i?.weight ?? 0;
  };
  const hrvWeight = pillarWeight('hrv');
  const rhrWeight = pillarWeight('rhr');
  const sleepWeight = pillarWeight('sleep');

  // HRV deep single-day low (drags score by ≥15 pts) OR multi-day streak.
  if (hrvStreak && hrvStreak.days >= 3 && !(rhrStreak && rhrStreak.days >= 3)) {
    out.push({
      signal: 'hrv_low_streak',
      priority: 'high',
      action: 'Tomorrow easy · let HRV recover.',
      cite: `HRV at or below baseline ${hrvStreak.days} days running.`,
    });
  } else if (hrvWeight <= -15 && state.hrvCurrent != null && state.hrvBaseline != null) {
    const pct = Math.round((1 - state.hrvCurrent / state.hrvBaseline) * 100);
    out.push({
      signal: 'hrv_low_streak',
      priority: 'high',
      action: 'Run easier than planned tomorrow · HRV is well below baseline today.',
      cite: `HRV ${state.hrvCurrent}ms vs ${state.hrvBaseline}ms baseline · ${pct}% down.`,
    });
  }

  // RHR deep single-day high OR multi-day streak.
  if (rhrStreak && rhrStreak.days >= 3 && !(hrvStreak && hrvStreak.days >= 3)) {
    out.push({
      signal: 'rhr_high_streak',
      priority: 'high',
      action: 'Pull tomorrow\'s intensity back · run easier or shorter.',
      cite: `RHR elevated ${rhrStreak.days} days running.`,
    });
  } else if (rhrWeight <= -8 && state.rhrCurrent != null && state.rhrBaseline != null) {
    const delta = state.rhrCurrent - state.rhrBaseline;
    out.push({
      signal: 'rhr_high_streak',
      priority: 'high',
      action: 'Pull tomorrow\'s intensity back · RHR is up today.',
      cite: `RHR ${state.rhrCurrent} bpm vs ${state.rhrBaseline} baseline · +${delta} bpm.`,
    });
  }

  // Wrist temp · illness-risk threshold per Research/15
  if (wristTempDeltaC != null && wristTempDeltaC >= 0.3) {
    out.push({
      signal: 'wrist_temp_elevated',
      priority: 'high',
      action: 'Watch for cold or flu symptoms · drop intensity if anything else shows up.',
      cite: `Wrist temp +${wristTempDeltaC.toFixed(2)}°C above your baseline.`,
    });
  }

  // ACWR spike
  if (state.loadAcwr != null && state.loadAcwr >= 1.4) {
    out.push({
      signal: 'load_spike',
      priority: 'high',
      action: 'Trim 1-2 miles from your next long run · load is spiking.',
      cite: `ACWR ${state.loadAcwr.toFixed(2)} · spike band.`,
    });
  }

  // Niggle moderate severity
  if (state.activeNiggle && state.activeNiggle.severity === 'moderate') {
    out.push({
      signal: 'niggle',
      priority: 'high',
      action: `Easy only until the ${state.activeNiggle.body_part} settles.`,
      cite: `${state.activeNiggle.body_part} · moderate · ${state.activeNiggle.days_ago}d ago.`,
    });
  }

  // ── MEDIUM ────────────────────────────────────────────────────────
  // Sleep deficit · two ways to trip:
  //   1. 3-night cumulative ≥ 3h (acute pattern · recent nights are short)
  //   2. 7-night avg < 6.8h AND pillar weight ≤ -8 (chronic short sleep ·
  //      single bad night could be noise, but a -8 weight means the 7-night
  //      avg is dragging the score hard).
  // Either way fires the same action with a different cite line.
  if (history.sleep.length >= 3) {
    const last3 = history.sleep.slice(-3);
    const deficit3 = last3.reduce((s, p) => s + Math.max(0, 7.5 - p.value), 0);
    const fired = deficit3 >= 3
      ? { cite: `${deficit3.toFixed(1)}h short over the last 3 nights.` }
      : (sleepWeight <= -8 && state.sleep7Avg != null && state.sleep7Avg < 6.8)
        ? { cite: `7-night avg ${state.sleep7Avg}h vs 7.5h target.` }
        : null;
    if (fired) {
      out.push({
        signal: 'sleep_deficit',
        priority: 'medium',
        action: 'Lights out 30 minutes earlier tonight · target 7.5h.',
        cite: fired.cite,
      });
    }
  }

  // HRV CV destabilizing band per Plews (> 7%)
  if (history.hrvPlews?.cv != null && history.hrvPlews.cv > 7) {
    out.push({
      signal: 'hrv_cv_destabilizing',
      priority: 'medium',
      action: 'Hold this week at easy · let your HRV variability settle.',
      cite: `HRV rolling CV ${history.hrvPlews.cv.toFixed(1)}% · destabilizing band.`,
    });
  }

  // ACWR caution
  if (state.loadAcwr != null && state.loadAcwr >= 1.3 && state.loadAcwr < 1.4) {
    out.push({
      signal: 'load_caution',
      priority: 'medium',
      action: 'Hold mileage flat next week · don\'t pile on.',
      cite: `ACWR ${state.loadAcwr.toFixed(2)} · caution band.`,
    });
  }

  // ── LOW ───────────────────────────────────────────────────────────
  // Wrist temp early-watch threshold (+0.2 to +0.3°C)
  if (wristTempDeltaC != null && wristTempDeltaC >= 0.2 && wristTempDeltaC < 0.3) {
    out.push({
      signal: 'wrist_temp_elevated',
      priority: 'low',
      action: 'Extra hydration + a longer night tonight.',
      cite: `Wrist temp +${wristTempDeltaC.toFixed(2)}°C above your baseline.`,
    });
  }

  // ACWR detraining band
  if (state.loadAcwr != null && state.loadAcwr < 0.8) {
    out.push({
      signal: 'load_detraining',
      priority: 'low',
      action: 'Add a few easy miles this week · you\'re drifting below your chronic base.',
      cite: `ACWR ${state.loadAcwr.toFixed(2)} · detraining band.`,
    });
  }

  // TSB race-ready · positive signal · only surface when nothing else
  // is flagging (otherwise it muddies the page).
  if (trainingForm && trainingForm.tsb >= 25 && out.length === 0) {
    out.push({
      signal: 'tsb_race_ready',
      priority: 'low',
      action: 'You\'re sharp · don\'t add volume this week.',
      cite: `TSB +${trainingForm.tsb} · race-ready band.`,
    });
  }

  // ── BAND-DRIVEN FALLBACK ──────────────────────────────────────────
  //
  // 2026-06-03 · the score itself is a signal. If readiness is in
  // PULL-BACK or MODERATE band and none of the specific rules above
  // fired, surface a fallback action grounded in the score. Without
  // this, you could have a 33 / PULL-BACK score with the action panel
  // saying ON COURSE · keep doing what you're doing · the bug David
  // flagged ("not sure this makes sense").
  //
  // Identify the worst pillar so the fallback names what's actually
  // dragging things down. "Tomorrow easy" is more useful when it
  // points at WHY · "HRV is down today" beats a generic "your score
  // is low."
  if (out.length === 0 && (breakdown.band === 'pull-back' || breakdown.band === 'moderate')) {
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
    if (breakdown.band === 'pull-back') {
      out.push({
        signal: 'compound',
        priority: 'high',
        action: `Tomorrow easy · ${worstLabel} and the score is in the pull-back band.`,
        cite: `Today's score is ${breakdown.score} · pull-back.`,
      });
    } else {
      out.push({
        signal: 'compound',
        priority: 'medium',
        action: `Run easier than planned · ${worstLabel}.`,
        cite: `Today's score is ${breakdown.score} · moderate band.`,
      });
    }
  }

  // ── ON COURSE ─────────────────────────────────────────────────────
  // Only fires when band is 'ready' or 'great' AND no specific rules
  // tripped. Pull-back / moderate bands always surface SOMETHING above.
  if (out.length === 0) {
    return [{
      signal: 'on_course',
      priority: 'on-course',
      action: 'All signals settled · keep doing what you\'re doing.',
      cite: `Today's score is ${breakdown.score} · band ${breakdown.band}.`,
    }];
  }

  // Sort by priority (urgent → low), keep top 3.
  const order: Record<HealthActionPriority, number> = {
    'urgent': 0, 'high': 1, 'medium': 2, 'low': 3, 'on-course': 4,
  };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 3);
}
