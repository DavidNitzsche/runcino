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
}

const BASELINE = 70;

export function computeReadiness(state: CoachState): ReadinessBreakdown {
  let score = BASELINE;
  const inputs: ReadinessInput[] = [];

  // SLEEP (25%)
  if (state.sleep7Avg != null) {
    const target = 7.5;
    const delta = state.sleep7Avg - target;
    // ±2 per 0.25h, clamp ±15
    const w = Math.max(-15, Math.min(8, Math.round(delta / 0.25 * 2)));
    score += w;
    inputs.push({
      key: 'sleep', label: 'SLEEP · 25%', weight: w,
      observedV: `${state.sleep7Avg.toFixed(1)}h`,
      observedSub: delta >= 0 ? `+${delta.toFixed(1)}h vs target` : `${delta.toFixed(1)}h vs target`,
    });
  } else {
    inputs.push({ key: 'sleep', label: 'SLEEP · 25%', weight: 0, observedV: '—', observedSub: 'no data' });
  }

  // HRV (25%)
  if (state.hrvCurrent != null && state.hrvBaseline != null && state.hrvBaseline > 0) {
    const pct = ((state.hrvCurrent - state.hrvBaseline) / state.hrvBaseline) * 100;
    const w = Math.max(-15, Math.min(15, Math.round(pct / 2)));
    score += w;
    inputs.push({
      key: 'hrv', label: 'HRV · 25%', weight: w,
      observedV: `${state.hrvCurrent}ms`,
      observedSub: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs baseline`,
    });
  } else {
    inputs.push({ key: 'hrv', label: 'HRV · 25%', weight: 0, observedV: '—', observedSub: 'no data' });
  }

  // RHR (20%)
  if (state.rhrCurrent != null && state.rhrBaseline != null) {
    const delta = state.rhrCurrent - state.rhrBaseline;
    // −2 per bpm above, +1 per bpm below, clamp ±10
    const w = Math.max(-10, Math.min(5, delta > 0 ? -delta * 2 : -delta));
    score += w;
    inputs.push({
      key: 'rhr', label: 'RHR · 20%', weight: w,
      observedV: `${state.rhrCurrent}`,
      observedSub: `${delta >= 0 ? '+' : ''}${delta} bpm vs baseline`,
    });
  } else {
    inputs.push({ key: 'rhr', label: 'RHR · 20%', weight: 0, observedV: '—', observedSub: 'no data' });
  }

  // SUBJECTIVE (15%) — last 2 check-ins
  const recent = state.recentCheckIns.slice(0, 2);
  if (recent.length > 0) {
    const map = { solid: 3, tired: -3, wrecked: -8 } as const;
    const w = recent.reduce((s, c) => s + (map[c.rating] ?? 0), 0);
    score += w;
    inputs.push({
      key: 'subjective', label: 'CHECK-IN · 15%', weight: w,
      observedV: recent.map((c) => c.rating.toUpperCase()).join(' · '),
      observedSub: `last ${recent.length} check-in${recent.length === 1 ? '' : 's'}`,
    });
  } else {
    inputs.push({ key: 'subjective', label: 'CHECK-IN · 15%', weight: 0, observedV: '—', observedSub: 'no rating yet' });
  }

  // LOAD (15%) — A:C ratio. Not loaded into state yet (P4.b adds it); pass-through 0 for now.
  inputs.push({ key: 'load', label: 'LOAD · 15%', weight: 0, observedV: '—', observedSub: 'A:C ratio pending' });

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
