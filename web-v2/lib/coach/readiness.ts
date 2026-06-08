/**
 * Readiness — composite score per §8.3 doctrine.
 *
 *   baseline 70, range 0-100
 *   bands: >85 SHARP · 65-85 READY · 50-65 MODERATE · <50 PULL BACK
 *
 * Weights (2026-05-30: dropped subjective, renormalized to objective signals
 * only — subjective check-ins now feed the coach voice directly rather than
 * the readiness number, so the score reflects what HealthKit actually says.
 * 2026-05-30 P2 #9: added HR Recovery 5% pillar from Apple Watch post-workout
 * 60s drop):
 *   - Sleep        28%  → 7-night avg vs 7.5h target. ±2 per 0.25h.
 *   - HRV          28%  → 7-day rolling avg vs 30-day baseline. ±1 per 2%.
 *   - RHR          24%  → 3-day rolling avg vs 30-day baseline. −2 per bpm above.
 *   - Load         15%  → A:C ratio (7d:28d). >1.5 = -8 per Gabbett.
 *   - HR Recovery   5%  → most recent vs 30d baseline. ±1 per 2 bpm delta.
 */
import type { CoachState } from '@/lib/topics/types';

export interface ReadinessBreakdown {
  score: number | null;         // 0-100; null when all pillar inputs have no signal (cold start)
  band: 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'unknown';
  label: string;                // 'SHARP' / 'READY' / 'MODERATE' / 'PULL BACK' / 'UNKNOWN'
  inputs: ReadinessInput[];
}

export interface ReadinessInput {
  key: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery';
  label: string;          // 'SLEEP · 28%'
  weight: number;         // contribution (signed)
  observedV: string;      // '6.7h' / '71ms' / etc
  observedSub: string;    // 'vs 7.5h target' / '+27%' / etc
  meaning: string;        // one-sentence interpretation of YOUR value
}

const BASELINE = 70;

export function computeReadiness(state: CoachState): ReadinessBreakdown {
  let score = BASELINE;
  const inputs: ReadinessInput[] = [];

  // SLEEP (30%)
  if (state.sleep7Avg != null) {
    const target = 7.5;
    const delta = state.sleep7Avg - target;
    const debt = Math.max(0, -delta * 7); // approx weekly debt
    // ±2 per 0.25h, clamp -18 / +10 (scaled from old ±15/+8 for new 30% weight)
    const w = Math.max(-18, Math.min(10, Math.round(delta / 0.25 * 2)));
    score += w;
    const meaning = delta >= 0
      ? `You're at or above the 7.5h target. Strong recovery foundation.`
      : debt >= 7
        ? `Roughly ${debt.toFixed(0)}h of sleep debt across the week. Recovery cost compounds.`
        : debt >= 3
          ? `About ${debt.toFixed(0)}h short for the week. Watch for fatigue creep.`
          : `Just under target. A few hours short, but nothing concerning.`;
    inputs.push({
      key: 'sleep', label: 'SLEEP · 28%', weight: w,
      // Tag the value as the 7-night average so it doesn't read as "last night".
      observedV: `${state.sleep7Avg.toFixed(1)}h · 7-night avg`,
      // 2026-06-03 · dropped "vs 7.5h target" tail · the pillar's
      // baseline field also says "target 7.5h" so showing both gave
      // the runner "-1.4h vs 7.5h target · target 7.5h" with the
      // target value duplicated. Now just shows the signed delta ·
      // baseline carries the target.
      observedSub: delta >= 0 ? `+${delta.toFixed(1)}h vs target` : `${delta.toFixed(1)}h vs target`,
      meaning,
    });
  } else {
    inputs.push({ key: 'sleep', label: 'SLEEP · 28%', weight: 0, observedV: 'no data', observedSub: '', meaning: 'No sleep data yet. Wear the watch overnight.' });
  }

  // HRV (30%)
  if (state.hrvCurrent != null && state.hrvBaseline != null && state.hrvBaseline > 0) {
    // 2026-06-01 · Luteal-phase adjustment (Research/13 §1-Menstrual-Cycle-and-Training).  // was §sex-specific · heading: ## 1. The Menstrual Cycle and Training
    // Luteal HRV runs 5-10ms lower regardless of fitness · subtract 5ms
    // from the baseline so the runner isn't penalized for biology. Only
    // applies when biologicalSex === 'female' AND cyclePhase === 'luteal'.
    // For non-female users or non-luteal phases, baseline is unchanged.
    const lutealAdjusted = state.biologicalSex === 'female' && state.cyclePhase === 'luteal'
      ? Math.max(1, state.hrvBaseline - 5)
      : state.hrvBaseline;
    const pct = ((state.hrvCurrent - lutealAdjusted) / lutealAdjusted) * 100;
    // ±1 per 2%, clamp ±18 (scaled from old ±15 for new 30% weight)
    const w = Math.max(-18, Math.min(18, Math.round(pct / 2)));
    score += w;
    const lutealNote = state.cyclePhase === 'luteal'
      ? ' Baseline adjusted for luteal phase.'
      : '';
    const meaning = (pct >= 15
      ? `Well above your baseline. Nervous system fully recovered, green light for hard work.`
      : pct >= 5
        ? `Above baseline. Recovered, ready to go.`
        : pct >= -5
          ? `At baseline. Neutral signal.`
          : pct >= -15
            ? `Below baseline. Could be stress, sleep, or accumulating load. Watch tomorrow.`
            : `Well below baseline. Pull back today and check rest.`) + lutealNote;
    inputs.push({
      key: 'hrv', label: 'HRV · 28%', weight: w,
      observedV: `${state.hrvCurrent}ms · 7d avg`,
      // State both numbers, no delta. Same rule the coach voice follows.
      observedSub: state.cyclePhase === 'luteal'
        ? `baseline ${state.hrvBaseline}ms · luteal-adjusted ${lutealAdjusted}ms`
        : `baseline ${state.hrvBaseline}ms`,
      meaning,
    });
  } else {
    inputs.push({ key: 'hrv', label: 'HRV · 28%', weight: 0, observedV: 'no data', observedSub: '', meaning: 'No HRV data yet. Needs a few overnights of watch wear.' });
  }

  // RHR (25%)
  if (state.rhrCurrent != null && state.rhrBaseline != null) {
    const delta = state.rhrCurrent - state.rhrBaseline;
    // Clamp -12 / +6 (scaled from old -10/+5 for new 25% weight)
    const w = Math.max(-12, Math.min(6, delta > 0 ? -delta * 2 : -delta));
    score += w;
    const meaning = delta <= -2
      ? `Below your baseline. Sign of strong fitness adaptation.`
      : delta <= 1
        ? `At baseline. Steady resting cardio.`
        : delta <= 4
          ? `A few beats above baseline. Could be sleep deficit, dehydration, or a volume bump. Single-day rise is fine; watch for a streak.`
          : `Notably elevated. Sleep, illness brewing, dehydration, or overreach. If it stays up 3+ days, ease the load.`;
    inputs.push({
      key: 'rhr', label: 'RHR · 24%', weight: w,
      observedV: `${state.rhrCurrent} bpm · 3d avg`,
      observedSub: `baseline ${state.rhrBaseline} bpm`,
      meaning,
    });
  } else {
    inputs.push({ key: 'rhr', label: 'RHR · 24%', weight: 0, observedV: 'no data', observedSub: '', meaning: 'No resting HR data yet.' });
  }

  // LOAD (15%) — Gabbett's Acute:Chronic Workload Ratio (ACWR).
  //   acute7    = avg daily mi over last 7 days
  //   chronic28 = avg daily mi over last 28 days
  //   ratio     = acute7 / chronic28
  //
  //   <0.8  detrained — fitness drift, -3
  //   0.8-1.0 building — sustainable, +2
  //   1.0-1.3 sweet spot — gains, low injury risk, +5
  //   1.3-1.5 caution — elevated ramp, -3
  //   >1.5   spike — high injury risk per Gabbett, -8
  if (state.loadAcwr != null && state.loadAcute7 != null && state.loadChronic28 != null) {
    const r = state.loadAcwr;
    let w = 0;
    let meaning = '';
    // 2026-05-27: descriptive only — what the ratio IS, not what to DO
    // about it. The coach decides prescription. Otherwise this card and
    // the coach voice openly contradict (David flagged it: "why is it
    // telling me to back off but the coach isn't?").
    if (r < 0.8) {
      w = -3;
      meaning = `Below 0.8. Recent 7-day volume sits well under the 28-day base · the detraining band.`;
    } else if (r < 1.0) {
      w = 2;
      meaning = `Below 1.0. Building gradually, sustainable-progression band.`;
    } else if (r <= 1.3) {
      w = 5;
      meaning = `Sweet spot per Gabbett. Productive-training band with the lowest injury rate in his cohort.`;
    } else if (r <= 1.5) {
      w = -3;
      meaning = `Elevated ramp. Recent 7-day volume runs above the 28-day base.`;
    } else {
      w = -8;
      meaning = `Above 1.5 · the elevated-injury-risk band per Gabbett. Coach factors this into today's prescription.`;
    }
    score += w;
    inputs.push({
      key: 'load', label: 'LOAD · 15%', weight: w,
      observedV: `${r.toFixed(2)} ACWR`,
      observedSub: `acute ${state.loadAcute7.toFixed(1)} · chronic ${state.loadChronic28.toFixed(1)} mi/day`,
      meaning,
    });
  } else {
    // Insufficient history — Gabbett needs ≥3 runs in 28 days to mean anything.
    inputs.push({
      key: 'load', label: 'LOAD · 15%', weight: 0,
      observedV: 'building history',
      observedSub: '',
      meaning: 'Acute:Chronic load ratio needs at least 3 runs in the last 28 days to be meaningful.',
    });
  }

  // HR RECOVERY (5%) — 60s post-workout HR drop from the Apple Watch.
  // Sevenfit literature pegs ~30 bpm as well-conditioned, ~20 average,
  // < 15 a yellow flag. We compare today's reading to the 30-day baseline:
  // a faster-than-baseline drop is a small lift, a slower drop is a small drag.
  // Weight cap ±5 keeps it appropriately minor — readiness isn't the place
  // to weigh one workout's recovery beat.
  if (state.hrRecoveryCurrent != null && state.hrRecoveryBaseline != null) {
    const delta = state.hrRecoveryCurrent - state.hrRecoveryBaseline;
    // ±1 per 2 bpm delta vs baseline, cap ±5.
    const w = Math.max(-5, Math.min(5, Math.round(delta / 2)));
    score += w;
    const meaning = delta >= 6
      ? `Faster than your baseline. Strong cardio recovery signal · the engine is rebounding well.`
      : delta >= 2
        ? `Slightly above your baseline. Recovery system is on.`
        : delta >= -2
          ? `At your baseline. Steady cardio recovery.`
          : delta >= -6
            ? `Below your baseline. Could be a hard recent session, sleep deficit, or heat · single-day dip is fine.`
            : `Well below your baseline. Cardiac recovery is sluggish. Watch tomorrow.`;
    inputs.push({
      key: 'hr_recovery', label: 'HR RECOVERY · 5%', weight: w,
      observedV: `${state.hrRecoveryCurrent} bpm drop`,
      observedSub: `baseline ${state.hrRecoveryBaseline} bpm`,
      meaning,
    });
  } else {
    inputs.push({
      key: 'hr_recovery', label: 'HR RECOVERY · 5%', weight: 0,
      observedV: 'no data',
      observedSub: '',
      meaning: 'HR recovery comes from Apple Watch post-workout. Will appear once a few sessions are in.',
    });
  }

  // Item 14: when every pillar has no real signal (brand-new user, Health
  // data not yet synced), return null score + 'unknown' band so the UI can
  // show "—" instead of 70/READY which reads as a confident endorsement.
  if (inputs.every((i) => i.observedV === 'no data' || i.observedV === 'building history')) {
    return { score: null, band: 'unknown', label: 'UNKNOWN', inputs };
  }

  score = Math.max(0, Math.min(100, score));
  const band = score > 85 ? 'sharp'
    : score >= 65 ? 'ready'
    : score >= 50 ? 'moderate'
                  : 'pull-back';
  const label = band === 'sharp' ? 'SHARP'
    : band === 'ready' ? 'READY'
    : band === 'moderate' ? 'MODERATE'
                          : 'PULL BACK';

  return { score, band, label, inputs };
}
