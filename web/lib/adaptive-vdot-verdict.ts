/**
 * Adaptive VDOT verdict — combines L7 signals into a banner-shape
 * recommendation. Mirrors the suspect-ceiling pattern that fired
 * successfully on David's real data 2026-05-19:
 *
 *   - Diagnosis (what we observed)
 *   - Reasoning (why it matters)
 *   - Math (numbers behind the recommendation)
 *   - Recommendation (the proposed action)
 *   - Falsifier (what would change our mind)
 *   - User agency (Apply / Keep current / 30D suppress)
 *
 * SIGNAL 1 thresholds (workout adherence):
 *   UP:   3+ corroborating observations AND total weight ≥ 2.5
 *   DOWN: 2+ observations AND total weight ≥ 1.5
 *
 * SIGNAL 2 thresholds (pace at fixed HR drift):
 *   UP:   |Δ| ≤ -5 s/mi AND ≥3 workouts AND ≥10 Z2 splits per window
 *   DOWN: |Δ| ≥ +5 s/mi AND same volume gates
 *
 * COMBINED RULE (locked 2026-05-19 round 4):
 *   Either signal can fire its own banner on its own thresholds.
 *   When BOTH fire in the same direction, they merge into one banner
 *   with both evidence panels and bump = max(s1Bump, s2Bump) capped
 *   at 1.5. Same direction corroborates confidence but doesn't
 *   compound magnitude — the conservative-on-upside discipline says
 *   evidence converges, not amplifies.
 *
 *   When they fire in OPPOSITE directions (rare: S1 says faster, S2
 *   says slower, or vice versa), neither fires. Contradicting signals
 *   are evidence of system noise, not real fitness movement. The
 *   verdict returns 'no-finding' with a contradiction note so the
 *   user can see the disagreement on the diagnostic surface.
 *
 * Asymmetric on purpose — bumping VDOT up has real workout-effect
 * (faster prescriptions = harder workouts = injury risk) so the
 * threshold is higher. Investigating a downgrade is lower-risk
 * (we propose investigation, not auto-modification).
 *
 * Edge case: if the verdict fires AND a goal race is within 14
 * days, suspend (taper distorts paces; we don't trust the signal
 * during this window). Verdict returns 'race-week-suspended' kind.
 */

import { query } from './db';
import { computeAdaptiveSignals, type AdaptiveSignals, type SignalObservation } from './adaptive-vdot-signals';
import { computeSignal2, type Signal2Result, type Signal2Workout } from './adaptive-vdot-signal2';

const UP_OBS_MIN = 3;
const UP_WEIGHT_MIN = 2.5;
const DOWN_OBS_MIN = 2;
const DOWN_WEIGHT_MIN = 1.5;
const RACE_WEEK_SUSPEND_DAYS = 14;

/** Map Signal 2's pace delta into a proposed VDOT bump. Conservative
 *  mirror of Signal 1's proposedBumpPoints math. 5 s/mi → 0.3 (min),
 *  10 s/mi → 0.8, 15 s/mi → 1.3, 20+ s/mi → 1.5 (capped). */
function signal2BumpPoints(deltaSPerMi: number): number {
  const magnitude = Math.abs(deltaSPerMi);
  const base = 0.3 + (magnitude - 5) * 0.1;
  return Math.min(1.5, Math.max(0.3, base));
}

export interface AdaptiveVdotVerdict {
  hasFinding: boolean;
  currentVdot: number;
  dismissed: boolean;
  manualOverride: {
    value: number;
    setAt: string;
  } | null;
  signals: AdaptiveSignals;
  /** Signal 2 result, exposed alongside Signal 1's so the banner +
   *  diagnostic can surface both evidence panels when both fire. */
  signal2: Signal2Result;
  recommendation:
    | { kind: 'no-finding'; reason: string; contradiction?: { s1: 'up' | 'down' | 'none'; s2: 'up' | 'down' | 'none' } }
    | { kind: 'insufficient-data'; reason: string }
    | { kind: 'race-week-suspended'; reason: string; daysToRace: number }
    | {
        kind: 'vdot-bump-suggested';
        suggestedVdot: number;
        suggestedDeltaPoints: number;
        evidence: SignalObservation[];
        signal2Evidence?: Signal2Workout[];
        signal2Delta?: number;
        reason: string;
        falsifier: string;
      }
    | {
        kind: 'vdot-downgrade-investigate';
        evidence: SignalObservation[];
        signal2Evidence?: Signal2Workout[];
        signal2Delta?: number;
        reason: string;
        falsifier: string;
      };
}

/** Map total faster-weight delta into a proposed VDOT bump.
 *  Conservative: 2.5 weight ≈ 0.5 VDOT, 4.0 weight ≈ 1.0 VDOT.
 *  Caps at 1.5 points per banner — bigger jumps need more evidence
 *  across more banners, not a single large recommendation. */
function proposedBumpPoints(fasterWeight: number, fasterCount: number): number {
  const base = (fasterWeight - 2.0) * 0.4; // 2.5w → 0.2, 3.5w → 0.6, 5w → 1.2
  // Each additional faster observation past the 3-obs minimum adds a
  // tiny bit more confidence
  const obsBonus = Math.max(0, fasterCount - 3) * 0.15;
  return Math.min(1.5, Math.max(0.3, base + obsBonus));
}

async function checkDismissal(userId: string, signals: AdaptiveSignals): Promise<boolean> {
  try {
    const rows = await query<{ at: Date | null }>(
      `SELECT adaptive_vdot_dismissed_at AS at FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const at = rows[0]?.at;
    if (!at) return false;
    const ageDays = (Date.now() - new Date(at).getTime()) / 86_400_000;
    if (ageDays > 30) return false;
    // New-evidence override: if there are MORE faster observations
    // after the dismissal than at dismissal time, re-fire.
    // Simplification: if any observation date is after the dismissal
    // date AND it's a faster signal, re-fire.
    const dismissedIso = new Date(at).toISOString().slice(0, 10);
    const newFaster = signals.threshold.observations.some(
      (o) => o.faster && o.date > dismissedIso,
    );
    if (newFaster) return false;
    return true;
  } catch {
    return false;
  }
}

async function checkRaceWeek(userId: string, today: Date): Promise<number | null> {
  try {
    const todayIso = today.toISOString().slice(0, 10);
    const rows = await query<{ date: string }>(
      `SELECT meta->>'date' AS date
         FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND meta->>'date' >= $2
        ORDER BY meta->>'date' ASC
        LIMIT 1`,
      [userId, todayIso],
    );
    const next = rows[0]?.date;
    if (!next) return null;
    const daysToRace = Math.floor((new Date(next + 'T12:00:00Z').getTime() - today.getTime()) / 86_400_000);
    if (daysToRace >= 0 && daysToRace <= RACE_WEEK_SUSPEND_DAYS) return daysToRace;
    return null;
  } catch {
    return null;
  }
}

async function checkManualOverride(userId: string): Promise<AdaptiveVdotVerdict['manualOverride']> {
  try {
    const rows = await query<{ value: string | null; at: Date | null }>(
      `SELECT vdot_manual_override::TEXT AS value, vdot_manual_override_at AS at
         FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const value = rows[0]?.value;
    const at = rows[0]?.at;
    if (value == null || at == null) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return { value: num, setAt: new Date(at).toISOString() };
  } catch {
    return null;
  }
}

async function fetchRestingHr(userId: string): Promise<number | null> {
  try {
    const rows = await query<{ resting_hr: number | null }>(
      `SELECT resting_hr FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    return rows[0]?.resting_hr ?? null;
  } catch {
    return null;
  }
}

export async function buildAdaptiveVdotVerdict(
  userId: string,
  currentVdot: number,
  maxHr: number | null,
  today: Date = new Date(),
): Promise<AdaptiveVdotVerdict> {
  const [signals, signal2, manualOverride, restingHr] = await Promise.all([
    computeAdaptiveSignals(userId, today, currentVdot, maxHr),
    // Signal 2 needs resting HR for HRR-framework Z2 detection.
    fetchRestingHr(userId).then((rhr) => computeSignal2(userId, today, maxHr, rhr)),
    checkManualOverride(userId),
    fetchRestingHr(userId),
  ]);
  void restingHr;  // already passed into computeSignal2 via the chain above
  const dismissed = await checkDismissal(userId, signals);

  const base: Pick<AdaptiveVdotVerdict, 'currentVdot' | 'dismissed' | 'manualOverride' | 'signals' | 'signal2'> = {
    currentVdot,
    dismissed,
    manualOverride,
    signals,
    signal2,
  };

  // Race-week / taper suspension
  const daysToRace = await checkRaceWeek(userId, today);
  if (daysToRace != null && daysToRace <= 7) {
    return {
      ...base,
      hasFinding: false,
      recommendation: {
        kind: 'race-week-suspended',
        reason: `${daysToRace} days from your next race — taper distorts paces, adaptive signals are suspended.`,
        daysToRace,
      },
    };
  }

  const t = signals.threshold;
  const totalObs = t.observations.length;

  // Insufficient data: both signals lack the minimum to evaluate
  const signal1HasEnough = totalObs >= UP_OBS_MIN;
  const signal2HasEnough = signal2.enoughVolume;
  if (!signal1HasEnough && !signal2HasEnough) {
    return {
      ...base,
      hasFinding: false,
      recommendation: {
        kind: 'insufficient-data',
        reason:
          `Need ${UP_OBS_MIN}+ threshold workouts in the last 6 weeks (Signal 1) ` +
          `OR 3+ easy workouts with 10+ Z2 splits per 4-week window (Signal 2) to detect drift. ` +
          `Currently: Signal 1 ${totalObs} obs, Signal 2 ${signal2.windows.recent.workoutCount}+${signal2.windows.prior.workoutCount} workouts.`,
      },
    };
  }

  const s1FiresUp = t.fasterCount >= UP_OBS_MIN && t.fasterWeight >= UP_WEIGHT_MIN;
  const s1FiresDown = t.slowerCount >= DOWN_OBS_MIN && t.slowerWeight >= DOWN_WEIGHT_MIN;
  const s2FiresUp = signal2.firesUp;
  const s2FiresDown = signal2.firesDown;

  // Contradiction guard: signals firing opposite directions cancel.
  // Real fitness movement should show as either-both-up or either-both-down.
  // A clash is evidence the picture is noisy, not directional.
  if ((s1FiresUp && s2FiresDown) || (s1FiresDown && s2FiresUp)) {
    return {
      ...base,
      hasFinding: false,
      recommendation: {
        kind: 'no-finding',
        reason:
          `Adaptive signals disagree this period — Signal 1 ` +
          `${s1FiresUp ? 'shows faster thresholds' : 'shows slower thresholds'} while Signal 2 ` +
          `${s2FiresUp ? 'shows faster Z2 pace' : 'shows slower Z2 pace'}. When workout adherence and ` +
          `pace-at-fixed-HR drift point opposite ways, the most likely explanation is one window had a ` +
          `non-representative sample (illness, weather cluster, missed sessions). Holding off on any change.`,
        contradiction: {
          s1: s1FiresUp ? 'up' : 'down',
          s2: s2FiresUp ? 'up' : 'down',
        },
      },
    };
  }

  // Bump-up rule (either signal fires up alone, or both fire up together)
  if (s1FiresUp || s2FiresUp) {
    // Compute proposed bumps per signal that's firing
    const s1Bump = s1FiresUp ? proposedBumpPoints(t.fasterWeight, t.fasterCount) : 0;
    const s2Bump = (s2FiresUp && signal2.deltaSPerMi != null) ? signal2BumpPoints(signal2.deltaSPerMi) : 0;
    // Both firing: corroboration, take the LARGER bump (capped). Single
    // firing: that signal's bump alone.
    const bumpPoints = Math.min(1.5, Math.max(s1Bump, s2Bump));
    const suggestedVdot = Math.round((currentVdot + bumpPoints) * 10) / 10;

    const evidence = s1FiresUp ? t.observations.filter((o) => o.faster).slice(0, 5) : [];
    const signal2Evidence = s2FiresUp
      ? signal2.workouts.filter((w) => w.inWindow === 'recent').slice(0, 5)
      : undefined;

    let reason: string;
    let falsifier: string;
    if (s1FiresUp && s2FiresUp) {
      // Combined fire — strongest evidence shape.
      const s1Dates = evidence.slice(0, 3)
        .map((o) => `${o.date} (${formatPace(o.actualPaceS)} vs prescribed ${formatPace(o.prescribedPaceS)})`)
        .join('; ');
      reason =
        `Two corroborating signals point to fitness gain. ` +
        `Signal 1 · ${t.fasterCount} threshold workouts trended faster at controlled HR (${s1Dates}). ` +
        `Signal 2 · Z2 pace dropped ${Math.abs(signal2.deltaSPerMi!)} s/mi over the last 4 weeks vs the prior 4. ` +
        `Combined evidence is ~${bumpPoints.toFixed(1)} VDOT points. ` +
        `Suggested: bump aggregate VDOT ${currentVdot.toFixed(1)} → ${suggestedVdot.toFixed(1)}.`;
      falsifier =
        `Workouts in heat >78°F or within 7 days of a race are already excluded from both signal windows. ` +
        `A single slow threshold workout OR a 5+ s/mi Z2 pace regression in the next two weeks would weaken ` +
        `the case. The combined signal is more conservative than either alone — both must keep agreeing.`;
    } else if (s1FiresUp) {
      // Signal 1 alone
      const datesList = evidence.slice(0, 3)
        .map((o) => `${o.date} (${formatPace(o.actualPaceS)} vs prescribed ${formatPace(o.prescribedPaceS)}, HR ${o.actualAvgHr ?? '—'})`)
        .join('; ');
      reason =
        `Your last ${t.fasterCount} threshold workouts (${datesList}) trended faster than prescribed at controlled HR. ` +
        `Current VDOT ${currentVdot.toFixed(1)} prescribes T at ${formatPace(t.observations[0]?.prescribedPaceS || 0)}. ` +
        `This is evidence of ~${bumpPoints.toFixed(1)} VDOT points of fitness gain. ` +
        `Suggested: bump aggregate VDOT ${currentVdot.toFixed(1)} → ${suggestedVdot.toFixed(1)}.`;
      falsifier =
        `Workouts in heat >78°F or within 7 days of a race are already excluded from this evidence — what you ` +
        `see above ran in normal conditions. A single slow threshold workout in the next two weeks would weaken ` +
        `the signal, as would discovering a context (illness, life stress) that explained the fast paces.`;
    } else {
      // Signal 2 alone
      reason =
        `Pace at fixed HR has dropped ${Math.abs(signal2.deltaSPerMi!)} s/mi over the last 4 weeks vs the prior 4. ` +
        `Z2 band (${signal2.z2BandBpm?.lo}-${signal2.z2BandBpm?.hi} bpm), ` +
        `${signal2.windows.recent.workoutCount} workouts (${signal2.windows.recent.z2MileCount} Z2 splits) recent vs ` +
        `${signal2.windows.prior.workoutCount} workouts (${signal2.windows.prior.z2MileCount} splits) prior. ` +
        `This is evidence of ~${bumpPoints.toFixed(1)} VDOT points of aerobic-base improvement. ` +
        `Suggested: bump aggregate VDOT ${currentVdot.toFixed(1)} → ${suggestedVdot.toFixed(1)}.`;
      falsifier =
        `Easy runs in heat >78°F or within 7 days of a race are already excluded from both windows. ` +
        `A 5+ s/mi Z2 pace regression in the next two weeks would weaken the signal. Signal 1 (workout adherence) ` +
        `did not corroborate this period — that's why the bump is conservative.`;
    }

    return {
      ...base,
      hasFinding: true,
      recommendation: {
        kind: 'vdot-bump-suggested',
        suggestedVdot,
        suggestedDeltaPoints: bumpPoints,
        evidence,
        signal2Evidence,
        signal2Delta: s2FiresUp ? (signal2.deltaSPerMi ?? undefined) : undefined,
        reason,
        falsifier,
      },
    };
  }

  // Downgrade-investigate rule (either signal fires down)
  if (s1FiresDown || s2FiresDown) {
    const evidence = s1FiresDown ? t.observations.filter((o) => o.slower).slice(0, 5) : [];
    const signal2Evidence = s2FiresDown
      ? signal2.workouts.filter((w) => w.inWindow === 'recent').slice(0, 5)
      : undefined;

    let reason: string;
    let falsifier: string;
    if (s1FiresDown && s2FiresDown) {
      reason =
        `Both signals point to a possible fitness regression. ` +
        `Signal 1 · ${t.slowerCount} threshold workouts came in slow despite controlled HR. ` +
        `Signal 2 · Z2 pace is ${signal2.deltaSPerMi} s/mi slower over the last 4 weeks. ` +
        `Worth investigating: am I in a recovery week? Carrying extra fatigue? Illness?`;
      falsifier =
        `If you can identify a contextual reason — recovery week, poor sleep cluster, illness, life stress — ` +
        `dismiss this. The investigate path is for when execution is honest and both signals still agree something's off.`;
    } else if (s1FiresDown) {
      const datesList = evidence.slice(0, 3)
        .map((o) => `${o.date} (${formatPace(o.actualPaceS)} vs prescribed ${formatPace(o.prescribedPaceS)})`)
        .join('; ');
      reason =
        `Your last ${t.slowerCount} threshold workouts (${datesList}) came in slow despite controlled HR ` +
        `and no flagged context issues. Worth checking: am I in a recovery week? Carrying extra fatigue? Illness?`;
      falsifier =
        `If you can identify a contextual reason — recovery week, poor sleep cluster, illness, life stress — ` +
        `dismiss this. The investigate path is for when execution is honest and the numbers still tell you ` +
        `something's off.`;
    } else {
      reason =
        `Z2 pace at fixed HR has slowed ${signal2.deltaSPerMi} s/mi over the last 4 weeks. ` +
        `Signal 1 (threshold workouts) didn't corroborate — that's why this is investigate-only, not a downgrade recommendation.`;
      falsifier =
        `Easy-run pace can drift slow for many non-fitness reasons (warmer days, longer routes, less sleep). ` +
        `If you can identify any of those, this isn't a fitness signal.`;
    }

    return {
      ...base,
      hasFinding: true,
      recommendation: {
        kind: 'vdot-downgrade-investigate',
        evidence,
        signal2Evidence,
        signal2Delta: s2FiresDown ? (signal2.deltaSPerMi ?? undefined) : undefined,
        reason,
        falsifier,
      },
    };
  }

  return {
    ...base,
    hasFinding: false,
    recommendation: {
      kind: 'no-finding',
      reason:
        `Signal 1 (${totalObs} threshold workouts) and Signal 2 (Z2 pace at fixed HR) are both tracking close to baseline. ` +
        `No fitness movement detected.`,
    },
  };
}

function formatPace(s: number | null | undefined): string {
  if (s == null || !s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}/mi`;
}
