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
 * Thresholds locked with David round 2 spec:
 *   UP changes:   3+ corroborating observations AND total weight ≥ 2.5
 *   DOWN changes: 2+ observations AND total weight ≥ 1.5
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

const UP_OBS_MIN = 3;
const UP_WEIGHT_MIN = 2.5;
const DOWN_OBS_MIN = 2;
const DOWN_WEIGHT_MIN = 1.5;
const RACE_WEEK_SUSPEND_DAYS = 14;

export interface AdaptiveVdotVerdict {
  hasFinding: boolean;
  currentVdot: number;
  dismissed: boolean;
  manualOverride: {
    value: number;
    setAt: string;
  } | null;
  signals: AdaptiveSignals;
  recommendation:
    | { kind: 'no-finding'; reason: string }
    | { kind: 'insufficient-data'; reason: string }
    | { kind: 'race-week-suspended'; reason: string; daysToRace: number }
    | { kind: 'vdot-bump-suggested'; suggestedVdot: number; suggestedDeltaPoints: number; evidence: SignalObservation[]; reason: string; falsifier: string }
    | { kind: 'vdot-downgrade-investigate'; evidence: SignalObservation[]; reason: string; falsifier: string };
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

export async function buildAdaptiveVdotVerdict(
  userId: string,
  currentVdot: number,
  maxHr: number | null,
  today: Date = new Date(),
): Promise<AdaptiveVdotVerdict> {
  const signals = await computeAdaptiveSignals(userId, today, currentVdot, maxHr);
  const manualOverride = await checkManualOverride(userId);
  const dismissed = await checkDismissal(userId, signals);

  const base: Pick<AdaptiveVdotVerdict, 'currentVdot' | 'dismissed' | 'manualOverride' | 'signals'> = {
    currentVdot,
    dismissed,
    manualOverride,
    signals,
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

  // Insufficient data
  if (totalObs < UP_OBS_MIN) {
    return {
      ...base,
      hasFinding: false,
      recommendation: {
        kind: 'insufficient-data',
        reason: `Need ${UP_OBS_MIN}+ threshold-effort workouts in the last 6 weeks to detect fitness drift. Currently have ${totalObs}.`,
      },
    };
  }

  // Bump-up rule
  if (t.fasterCount >= UP_OBS_MIN && t.fasterWeight >= UP_WEIGHT_MIN) {
    const bumpPoints = proposedBumpPoints(t.fasterWeight, t.fasterCount);
    const suggestedVdot = Math.round((currentVdot + bumpPoints) * 10) / 10;
    const evidence = t.observations.filter((o) => o.faster).slice(0, 5);
    const datesList = evidence
      .slice(0, 3)
      .map((o) => `${o.date} (${formatPace(o.actualPaceS)} vs prescribed ${formatPace(o.prescribedPaceS)}, HR ${o.actualAvgHr ?? '—'})`)
      .join('; ');
    return {
      ...base,
      hasFinding: true,
      recommendation: {
        kind: 'vdot-bump-suggested',
        suggestedVdot,
        suggestedDeltaPoints: bumpPoints,
        evidence,
        reason:
          `Your last ${t.fasterCount} threshold workouts (${datesList}) trended faster than prescribed at controlled HR. ` +
          `Current VDOT ${currentVdot.toFixed(1)} prescribes T at ${formatPace((signals.threshold.observations[0]?.prescribedPaceS) || 0)}. ` +
          `This is evidence of ~${bumpPoints.toFixed(1)} VDOT points of fitness gain. ` +
          `Suggested: bump aggregate VDOT ${currentVdot.toFixed(1)} → ${suggestedVdot.toFixed(1)}.`,
        falsifier:
          `Workouts in heat >${78}°F or within 7 days of a race are already excluded from this evidence — what you ` +
          `see above ran in normal conditions. A single slow threshold workout in the next two weeks would weaken ` +
          `the signal, as would discovering a context (illness, life stress) that explained the fast paces.`,
      },
    };
  }

  // Downgrade-investigate rule
  if (t.slowerCount >= DOWN_OBS_MIN && t.slowerWeight >= DOWN_WEIGHT_MIN) {
    const evidence = t.observations.filter((o) => o.slower).slice(0, 5);
    const datesList = evidence
      .slice(0, 3)
      .map((o) => `${o.date} (${formatPace(o.actualPaceS)} vs prescribed ${formatPace(o.prescribedPaceS)})`)
      .join('; ');
    return {
      ...base,
      hasFinding: true,
      recommendation: {
        kind: 'vdot-downgrade-investigate',
        evidence,
        reason:
          `Your last ${t.slowerCount} threshold workouts (${datesList}) came in slow despite controlled HR ` +
          `and no flagged context issues. Worth checking: am I in a recovery week? Carrying extra fatigue? Illness?`,
        falsifier:
          `If you can identify a contextual reason — recovery week, poor sleep cluster, illness, life stress — ` +
          `dismiss this. The investigate path is for when execution is honest and the numbers still tell you ` +
          `something's off.`,
      },
    };
  }

  return {
    ...base,
    hasFinding: false,
    recommendation: {
      kind: 'no-finding',
      reason:
        `Threshold workouts (${totalObs} in the last 6 weeks) are tracking close to prescribed at controlled HR. ` +
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
