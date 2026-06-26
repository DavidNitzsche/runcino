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
 *   - HRV          28%  → 7-day median vs 30-day baseline. ±1 per 2%.
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

/**
 * 2026-06-16 · #16 fix · load-scaled sleep target.
 *
 * Research/00b §284 ("recovery requirements scale with absolute training
 * load") + §290 (20–40 mpw sleep band 7.5–9h). Under high acute:chronic
 * load the recovery bar rises: 8.0h at ACWR>1.0, 8.5h at >1.3; otherwise
 * the 7.5h floor.
 *
 * Lives here (the score module) rather than in readiness-brief because
 * the SCORE must use the same target the displayed baseline label does.
 * Before this fix the score hardcoded 7.5h while the brief's baseline
 * label showed the elevated target, so a 7.8h sleeper under load read
 * "+0.3h vs target" (scored as surplus) next to a baseline implying
 * "target 8.5h" (−0.7h short) — the score credited phantom surplus and
 * contradicted the delta. computeReadiness now derives this internally
 * so EVERY score consumer (brief, glance, watch, /api/readiness) agrees,
 * and the brief's label reads the same value.
 */
export function computeDynamicSleepTarget(acwr: number | null | undefined): number {
  if (acwr == null) return 7.5;
  if (acwr > 1.3) return 8.5;
  if (acwr > 1.0) return 8.0;
  return 7.5;
}

/**
 * 2026-06-16 · #19 · luteal-phase HRV baseline allowance.
 *
 * Luteal HRV runs 5-10ms lower regardless of fitness (Research/13
 * §1-Menstrual-Cycle-and-Training · HRV "trends with phase"), so subtract
 * 5ms from the baseline a luteal female is compared against — only when
 * biologicalSex === 'female' AND cyclePhase === 'luteal'. Floored at 1 so
 * the bar can never go non-positive. For everyone else the baseline is
 * unchanged.
 *
 * Lives here (the score module, alongside computeReadiness which applies
 * the same shift inline) so EVERY HRV-vs-baseline comparator can import
 * one canonical implementation — the streak detector, the [N/M] threshold
 * line, and recovery-phase. Per CLAUDE.md per-finding context filters,
 * the luteal adjustment must propagate to every HRV consumer, not just
 * the score. Without this a luteal female reads "at baseline" on the
 * score pillar while STREAKS / the recovery tile flag the same HRV below
 * baseline. A 5ms shift on a ~60ms baseline ≈ 8.3% — enough to flip a
 * borderline reading.
 */
export function lutealAdjustedHrvBaseline(
  baseline: number,
  biologicalSex: CoachState['biologicalSex'] | undefined,
  cyclePhase: CoachState['cyclePhase'] | undefined,
): number {
  return biologicalSex === 'female' && cyclePhase === 'luteal'
    ? Math.max(1, baseline - 5)
    : baseline;
}

export function computeReadiness(
  state: CoachState,
  // 2026-06-16 · #16 · explicit override lets the brief pass its already-
  // computed dynamicSleepTarget (identical value, avoids a recompute).
  // When omitted, derive the load-scaled target from state.loadAcwr so
  // the score and the baseline label always agree, on every surface.
  sleepTargetOverride?: number,
): ReadinessBreakdown {
  let score = BASELINE;
  const inputs: ReadinessInput[] = [];
  const sleepTarget = sleepTargetOverride ?? computeDynamicSleepTarget(state.loadAcwr);

  // SLEEP (28%)
  if (state.sleep7Avg != null) {
    const target = sleepTarget;
    const delta = state.sleep7Avg - target;
    const debt = Math.max(0, -delta * 7); // approx weekly debt
    // ±2 per 0.25h, clamp -18 / +10 (scaled from old ±15/+8 for new 28% weight)
    const w = Math.max(-18, Math.min(10, Math.round(delta / 0.25 * 2)));
    score += w;
    const meaning = delta >= 0
      // 2026-06-16 · #16 · name the actual (possibly load-scaled) target,
      // not a hardcoded 7.5h, so the prose agrees with the scored delta.
      ? `At or above your ${target.toFixed(1)}h target. Strong recovery base.`
      : debt >= 7
        // 2026-06-26 · surface the gap concretely (nightly shortfall + the
        // actual target) and end on what to do, not "cost compounds".
        ? `About ${(-delta).toFixed(1)}h under your ${target.toFixed(1)}h target each night · roughly ${debt.toFixed(0)}h of debt this week. A couple of 8h nights pulls it back.`
        : debt >= 3
          ? `Around ${debt.toFixed(0)}h short of your ${target.toFixed(1)}h target this week. Watch for fatigue creep.`
          : `A touch under your ${target.toFixed(1)}h target. Nothing concerning yet.`;
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

  // HRV (28%)
  if (state.hrvCurrent != null && state.hrvBaseline != null && state.hrvBaseline > 0) {
    // 2026-06-01 · Luteal-phase adjustment (Research/13 §1-Menstrual-Cycle-and-Training).  // was §sex-specific · heading: ## 1. The Menstrual Cycle and Training
    // Luteal HRV runs 5-10ms lower regardless of fitness · subtract 5ms
    // from the baseline so the runner isn't penalized for biology. Only
    // applies when biologicalSex === 'female' AND cyclePhase === 'luteal'.
    // For non-female users or non-luteal phases, baseline is unchanged.
    // 2026-06-16 · #19 · now via the shared lutealAdjustedHrvBaseline so
    // the score, the streak detector, the threshold line, and recovery-
    // phase all apply byte-identical luteal logic (can't drift apart).
    const lutealAdjusted = lutealAdjustedHrvBaseline(state.hrvBaseline, state.biologicalSex, state.cyclePhase);
    const pct = ((state.hrvCurrent - lutealAdjusted) / lutealAdjusted) * 100;
    // ±1 per 2%, clamp ±18 (scaled from old ±15 for new 28% weight)
    const w = Math.max(-18, Math.min(18, Math.round(pct / 2)));
    score += w;
    const lutealNote = state.cyclePhase === 'luteal'
      ? ' Baseline adjusted for luteal phase.'
      : '';
    // Frame every verdict on the 7-DAY window so it can't read as a
    // contradiction of the Health tab's single-day HRV reading (today can
    // bounce back to baseline while the week's trend still sits low).
    // 2026-06-26 · name the baseline number in the prose (the tile's
    // observedSub isn't shown on iPhone), and end on what it means for today.
    const hrvBase = Math.round(state.hrvBaseline);
    const meaning = (pct >= 15
      ? `Well above your ${hrvBase}ms baseline. Fully recovered · green light for hard work.`
      : pct >= 5
        ? `Above your ${hrvBase}ms baseline. Recovered and ready.`
        : pct >= -5
          ? `Right on your ${hrvBase}ms baseline. No recovery flag · train as planned.`
          : pct >= -15
            ? `Below your ${hrvBase}ms baseline. Could be stress, sleep, or building load. Watch tomorrow.`
            : `Well below your ${hrvBase}ms baseline. The week's been low. Ease off and check rest.`) + lutealNote;
    inputs.push({
      key: 'hrv', label: 'HRV · 28%', weight: w,
      // G3 (2026-06-09) · health-state now feeds the 7-day MEDIAN
      // (outlier-immune after the Jun 8 partial-night incident).
      observedV: `${state.hrvCurrent}ms · 7d median`,
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
    // 2026-06-26 · name the baseline bpm in the prose (observedSub isn't shown
    // on iPhone) so "at baseline" is verifiable at a glance.
    const rhrBase = Math.round(state.rhrBaseline);
    const meaning = delta <= -2
      ? `Below your ${rhrBase} bpm baseline. Sign of strong fitness adaptation.`
      : delta <= 1
        ? `Right on your ${rhrBase} bpm baseline. No fatigue or illness signal.`
        : delta <= 4
          ? `A few beats above your ${rhrBase} bpm baseline. Could be sleep, dehydration, or a volume bump. One day is fine · watch for a streak.`
          : `Notably above your ${rhrBase} bpm baseline. Sleep, illness, dehydration, or overreach. If it holds 3+ days, ease the load.`;
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
  //   <0.8  light/cutback — fresh legs, NEUTRAL (0) · not a readiness drag
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
    // 2026-06-26 · low load (ACWR < 0.8) no longer DRAGS readiness. A cutback
    // or down week means fresh legs, not an unready runner · weight 0, framed
    // as freshness. The detraining-over-time concern lives in the copy's
    // "only a worry if it stays here for weeks" caveat (and any sustained
    // low-load streak), not the today-readiness score. (David's call · low
    // load was surfacing in "X dragging" when he was simply well-rested.)
    const acuteWk = state.loadAcute7 * 7;   // mi/day → mi/week
    const baseWk = state.loadChronic28 * 7;
    if (r < 0.8) {
      w = 0;
      meaning = `${acuteWk.toFixed(0)}mi this week vs your ~${baseWk.toFixed(0)}mi base. Fresh legs, low fatigue · fine for a cutback. Only a worry if it stays here for weeks.`;
    } else if (r < 1.0) {
      w = 2;
      meaning = `${acuteWk.toFixed(0)}mi this week, just under your ~${baseWk.toFixed(0)}mi base. Building gradually · sustainable.`;
    } else if (r <= 1.3) {
      w = 5;
      meaning = `Sweet spot per Gabbett. Productive band with the lowest injury rate in his cohort.`;
    } else if (r <= 1.5) {
      w = -3;
      meaning = `${acuteWk.toFixed(0)}mi this week runs above your ~${baseWk.toFixed(0)}mi base. Elevated ramp · keep an eye on it.`;
    } else {
      w = -8;
      meaning = `Above 1.5 · Gabbett's elevated-injury-risk band. Coach factors this into today's prescription.`;
    }
    score += w;
    const acwrWord = r < 0.8 ? 'Fresh' : r < 1.0 ? 'Building' : r <= 1.3 ? 'In range'
      : r < 1.5 ? 'Elevated' : 'High';
    inputs.push({
      key: 'load', label: 'LOAD · 15%', weight: w,
      observedV: `${acwrWord} · ${r.toFixed(2)} ACWR`,
      observedSub: `this week ${state.loadAcute7.toFixed(1)} · month avg ${state.loadChronic28.toFixed(1)} mi/day`,
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
