/**
 * Readiness — composite score per §8.3 doctrine.
 *
 *   baseline 70, range 0-100
 *   bands: >85 SHARP · 65-85 READY · 50-65 MODERATE · <50 PULL BACK
 *
 * Weights:
 *   - Sleep      25%  → 7-night avg vs 7.5h target. ±2 per 0.25h.
 *   - HRV        25%  → last night vs 30-day baseline. ±1 per 2%.
 *   - RHR        20%  → 3-day avg vs 60-day baseline. −2 per bpm above.
 *   - Subjective 15%  → last 2 check-ins. SOLID +3 / TIRED -3 / WRECKED -8.
 *   - Load       15%  → A:C ratio (7d:28d). >1.5 = -5 (overreaching).
 */
import type { CoachState } from '@/lib/topics/types';

export interface ReadinessBreakdown {
  score: number;                // 0-100
  band: 'sharp' | 'ready' | 'moderate' | 'pull-back';
  label: string;                // 'SHARP' / 'READY' / 'MODERATE' / 'PULL BACK'
  inputs: ReadinessInput[];
}

export interface ReadinessInput {
  key: 'sleep' | 'hrv' | 'rhr' | 'subjective' | 'load';
  label: string;          // 'SLEEP · 25%'
  weight: number;         // contribution (signed)
  observedV: string;      // '6.7h' / '71ms' / etc
  observedSub: string;    // 'vs 7.5h target' / '+27%' / etc
  meaning: string;        // one-sentence interpretation of YOUR value
}

const BASELINE = 70;

export function computeReadiness(state: CoachState): ReadinessBreakdown {
  let score = BASELINE;
  const inputs: ReadinessInput[] = [];

  // SLEEP (25%)
  if (state.sleep7Avg != null) {
    const target = 7.5;
    const delta = state.sleep7Avg - target;
    const debt = Math.max(0, -delta * 7); // approx weekly debt
    // ±2 per 0.25h, clamp ±15
    const w = Math.max(-15, Math.min(8, Math.round(delta / 0.25 * 2)));
    score += w;
    const meaning = delta >= 0
      ? `You're at or above the 7.5h target. Strong recovery foundation.`
      : debt >= 7
        ? `Roughly ${debt.toFixed(0)}h of sleep debt across the week. Recovery cost compounds.`
        : debt >= 3
          ? `About ${debt.toFixed(0)}h short for the week. Watch for fatigue creep.`
          : `Just under target. A few hours short, but nothing concerning.`;
    inputs.push({
      key: 'sleep', label: 'SLEEP · 25%', weight: w,
      // Tag the value as the 7-night average so it doesn't read as "last night".
      observedV: `${state.sleep7Avg.toFixed(1)}h · 7-night avg`,
      observedSub: delta >= 0 ? `+${delta.toFixed(1)}h vs 7.5h target` : `${delta.toFixed(1)}h vs 7.5h target`,
      meaning,
    });
  } else {
    inputs.push({ key: 'sleep', label: 'SLEEP · 25%', weight: 0, observedV: 'no data', observedSub: '', meaning: 'No sleep data yet. Wear the watch overnight.' });
  }

  // HRV (25%)
  if (state.hrvCurrent != null && state.hrvBaseline != null && state.hrvBaseline > 0) {
    const pct = ((state.hrvCurrent - state.hrvBaseline) / state.hrvBaseline) * 100;
    const w = Math.max(-15, Math.min(15, Math.round(pct / 2)));
    score += w;
    const meaning = pct >= 15
      ? `Well above your baseline. Nervous system fully recovered, green light for hard work.`
      : pct >= 5
        ? `Above baseline. Recovered, ready to go.`
        : pct >= -5
          ? `At baseline. Neutral signal.`
          : pct >= -15
            ? `Below baseline. Could be stress, sleep, or accumulating load. Watch tomorrow.`
            : `Well below baseline. Pull back today and check rest.`;
    inputs.push({
      key: 'hrv', label: 'HRV · 25%', weight: w,
      observedV: `${state.hrvCurrent}ms`,
      // State both numbers, no delta. Same rule the coach voice follows.
      observedSub: `baseline ${state.hrvBaseline}ms`,
      meaning,
    });
  } else {
    inputs.push({ key: 'hrv', label: 'HRV · 25%', weight: 0, observedV: 'no data', observedSub: '', meaning: 'No HRV data yet. Needs a few overnights of watch wear.' });
  }

  // RHR (20%)
  if (state.rhrCurrent != null && state.rhrBaseline != null) {
    const delta = state.rhrCurrent - state.rhrBaseline;
    const w = Math.max(-10, Math.min(5, delta > 0 ? -delta * 2 : -delta));
    score += w;
    const meaning = delta <= -2
      ? `Below your baseline. Sign of strong fitness adaptation.`
      : delta <= 1
        ? `At baseline. Steady resting cardio.`
        : delta <= 4
          ? `A few beats above baseline. Could be sleep deficit, dehydration, or a volume bump. Single-day rise is fine; watch for a streak.`
          : `Notably elevated. Sleep, illness brewing, dehydration, or overreach. If it stays up 3+ days, ease the load.`;
    inputs.push({
      key: 'rhr', label: 'RHR · 20%', weight: w,
      observedV: `${state.rhrCurrent} bpm`,
      observedSub: `baseline ${state.rhrBaseline} bpm`,
      meaning,
    });
  } else {
    inputs.push({ key: 'rhr', label: 'RHR · 20%', weight: 0, observedV: 'no data', observedSub: '', meaning: 'No resting HR data yet.' });
  }

  // SUBJECTIVE (15%) — last 2 check-ins
  const recent = state.recentCheckIns.slice(0, 2);
  if (recent.length > 0) {
    const map = { solid: 3, tired: -3, wrecked: -8 } as const;
    const w = recent.reduce((s, c) => s + (map[c.rating] ?? 0), 0);
    score += w;
    const ratings = recent.map((c) => c.rating);
    const allSolid = ratings.every((r) => r === 'solid');
    const anyWrecked = ratings.some((r) => r === 'wrecked');
    const meaning = anyWrecked
      ? `A WRECKED check-in is a real signal. Coach should ease the next session.`
      : allSolid && ratings.length >= 2
        ? `Back-to-back SOLID feel. You're absorbing the work.`
        : ratings.includes('tired')
          ? `TIRED in recent check-ins. Fatigue accumulating, watch volume.`
          : `Subjective reads steady.`;
    inputs.push({
      key: 'subjective', label: 'CHECK-IN · 15%', weight: w,
      observedV: ratings.map((r) => r.toUpperCase()).join(' · '),
      observedSub: `last ${recent.length} check-in${recent.length === 1 ? '' : 's'}`,
      meaning,
    });
  } else {
    inputs.push({ key: 'subjective', label: 'CHECK-IN · 15%', weight: 0, observedV: 'no rating yet', observedSub: '', meaning: 'No subjective rating yet today. Coach defaults to neutral.' });
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
    if (r < 0.8) {
      w = -3;
      meaning = `Below 0.8. You're trending toward detraining. Recent volume is well below your 28-day base.`;
    } else if (r < 1.0) {
      w = 2;
      meaning = `Below 1.0. Building gradually, sustainable progression with low injury risk.`;
    } else if (r <= 1.3) {
      w = 5;
      meaning = `Sweet spot. Gains with low injury risk, the Gabbett zone for productive training.`;
    } else if (r <= 1.5) {
      w = -3;
      meaning = `Elevated ramp. Recent volume well above your 28-day base. Hold here, don't add more.`;
    } else {
      w = -8;
      meaning = `Spike above 1.5. High injury risk. Back off this week or absorb the cost.`;
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
