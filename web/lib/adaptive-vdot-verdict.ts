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
import { computeSignal3, type Signal3Result, type Signal3Observation } from './adaptive-vdot-signal3';
import { computeSignal4, type Signal4Result, SIGNAL4_SOFT_THRESHOLD } from './adaptive-vdot-signal4';
import { computeStravaGap } from './strava-gap';

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
   *  diagnostic can surface both evidence panels when multiple fire. */
  signal2: Signal2Result;
  /** Signal 3 result (interval pace at controlled effort). */
  signal3: Signal3Result;
  /** Signal 4 result (PR trajectory · race-source PRs in last 8 weeks). */
  signal4: Signal4Result;
  recommendation:
    | { kind: 'no-finding'; reason: string; contradiction?: { s1: 'up' | 'down' | 'none'; s2: 'up' | 'down' | 'none'; s3: 'up' | 'down' | 'none'; s4: 'up' | 'down' | 'none' } }
    | { kind: 'insufficient-data'; reason: string }
    | { kind: 'race-week-suspended'; reason: string; daysToRace: number }
    | {
        kind: 'vdot-bump-suggested';
        suggestedVdot: number;
        suggestedDeltaPoints: number;
        evidence: SignalObservation[];
        signal2Evidence?: Signal2Workout[];
        signal2Delta?: number;
        signal3Evidence?: Signal3Observation[];
        reason: string;
        falsifier: string;
      }
    | {
        kind: 'vdot-downgrade-investigate';
        evidence: SignalObservation[];
        signal2Evidence?: Signal2Workout[];
        signal2Delta?: number;
        signal3Evidence?: Signal3Observation[];
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
  const restingHr = await fetchRestingHr(userId);
  const [signals, signal2, signal3, signal4, manualOverride] = await Promise.all([
    computeAdaptiveSignals(userId, today, currentVdot, maxHr),
    computeSignal2(userId, today, maxHr, restingHr),
    computeSignal3(userId, today, currentVdot, maxHr, restingHr),
    computeSignal4(userId, today),
    checkManualOverride(userId),
  ]);
  const dismissed = await checkDismissal(userId, signals);

  const base: Pick<AdaptiveVdotVerdict, 'currentVdot' | 'dismissed' | 'manualOverride' | 'signals' | 'signal2' | 'signal3' | 'signal4'> = {
    currentVdot,
    dismissed,
    manualOverride,
    signals,
    signal2,
    signal3,
    signal4,
  };

  // Injury-mark suspension · per E1 spec (Rule 5: each surface
  // applies its own context filter explicitly). When the user has
  // marked themselves injured, all L7 signals freeze until they
  // resume activity. Distinct from race-week suspension below.
  const todayIso = today.toISOString().slice(0, 10);
  try {
    const gap = await computeStravaGap(userId, todayIso);
    if (gap.signalsSuspended) {
      return {
        ...base,
        hasFinding: false,
        recommendation: {
          kind: 'race-week-suspended',  // reusing kind for "any suspension"
          reason: `Signals suspended · you marked yourself injured ${gap.daysSinceLastRun != null ? `${gap.daysSinceLastRun} days ago` : ''}. Adaptive evaluation pauses until activity resumes — missed workouts during recovery should never read as fitness regression.`,
          daysToRace: 0,
        },
      };
    }
  } catch { /* gap query failure non-fatal */ }

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

  // Insufficient data: all four signals lack the minimum to evaluate
  const signal1HasEnough = totalObs >= UP_OBS_MIN;
  const signal2HasEnough = signal2.enoughVolume;
  const signal3HasEnough = signal3.observations.length >= UP_OBS_MIN;
  const signal4HasEnough = signal4.prsInWindow.length >= SIGNAL4_SOFT_THRESHOLD;
  if (!signal1HasEnough && !signal2HasEnough && !signal3HasEnough && !signal4HasEnough) {
    return {
      ...base,
      hasFinding: false,
      recommendation: {
        kind: 'insufficient-data',
        reason:
          `Need any of: ${UP_OBS_MIN}+ threshold workouts (Signal 1), ` +
          `3+ easy workouts with 10+ Z2 splits per 4-week window (Signal 2), ` +
          `${UP_OBS_MIN}+ interval-effort workouts (Signal 3), ` +
          `OR 2+ fresh race PRs in 8 weeks (Signal 4) to detect drift. ` +
          `Currently: S1 ${totalObs} obs · S2 ${signal2.windows.recent.workoutCount}+${signal2.windows.prior.workoutCount} workouts · S3 ${signal3.observations.length} obs · S4 ${signal4.prsInWindow.length} PRs.`,
      },
    };
  }

  const s1FiresUp = t.fasterCount >= UP_OBS_MIN && t.fasterWeight >= UP_WEIGHT_MIN;
  const s1FiresDown = t.slowerCount >= DOWN_OBS_MIN && t.slowerWeight >= DOWN_WEIGHT_MIN;
  const s2FiresUp = signal2.firesUp;
  const s2FiresDown = signal2.firesDown;
  const s3FiresUp = signal3.firesUp;
  const s3FiresDown = signal3.firesDown;
  // Signal 4 · PR trajectory. firesUp on 3+ PRs in 8 weeks (strong).
  // Soft-positive state (2 PRs) doesn't trigger firesUp on its own but
  // contributes to "any signal trending up" detection.
  const s4FiresUp = signal4.firesUp;
  const s4SoftUp = signal4.softPositive;

  const anyUp = s1FiresUp || s2FiresUp || s3FiresUp || s4FiresUp;
  const anyDown = s1FiresDown || s2FiresDown || s3FiresDown;

  // Contradiction guard: ANY pair of signals firing opposite directions
  // cancels. Real fitness movement should show as one-or-more pointing
  // one way with no opposing fire. A clash is evidence the picture is
  // noisy, not directional.
  if (anyUp && anyDown) {
    const dirOf = (up: boolean, down: boolean): 'up' | 'down' | 'none' =>
      up ? 'up' : down ? 'down' : 'none';
    return {
      ...base,
      hasFinding: false,
      recommendation: {
        kind: 'no-finding',
        reason:
          `Adaptive signals disagree this period — at least one signal points up while another points down. ` +
          `S1=${dirOf(s1FiresUp, s1FiresDown)}, S2=${dirOf(s2FiresUp, s2FiresDown)}, S3=${dirOf(s3FiresUp, s3FiresDown)}, S4=${dirOf(s4FiresUp, false)}. ` +
          `When evidence cuts in multiple directions, the most likely explanation is one window had a ` +
          `non-representative sample (illness, weather cluster, missed sessions). Holding off on any change.`,
        contradiction: {
          s1: dirOf(s1FiresUp, s1FiresDown),
          s2: dirOf(s2FiresUp, s2FiresDown),
          s3: dirOf(s3FiresUp, s3FiresDown),
          s4: dirOf(s4FiresUp, false),
        },
      },
    };
  }

  // Bump-up rule (any signal fires up; merge evidence when multiple)
  if (s1FiresUp || s2FiresUp || s3FiresUp || s4FiresUp) {
    // Compute proposed bumps per signal that's firing
    const s1Bump = s1FiresUp ? proposedBumpPoints(t.fasterWeight, t.fasterCount) : 0;
    const s2Bump = (s2FiresUp && signal2.deltaSPerMi != null) ? signal2BumpPoints(signal2.deltaSPerMi) : 0;
    // Signal 3 reuses Signal 1's bump math (same shape: count + weight).
    const s3Bump = s3FiresUp ? proposedBumpPoints(signal3.fasterWeight, signal3.fasterCount) : 0;
    // Signal 4 · PR trajectory bump. Each PR is concrete fitness
    // evidence — race performance is the strongest signal we have.
    // Scale with count: 3 PRs = 0.5 pts, 4 PRs = 0.8 pts, 5+ PRs caps
    // at 1.0 pts. Distinct-distance bonus (broad fitness) adds 0.2.
    const s4Bump = s4FiresUp
      ? Math.min(
          1.0,
          0.2 + Math.min(signal4.prsInWindow.length, 5) * 0.15
            + (signal4.distinctDistances >= 2 ? 0.2 : 0)
        )
      : 0;
    // Multiple firing: corroboration, take the LARGER bump (capped).
    // Conservative on upside — same direction converges confidence,
    // doesn't compound magnitude.
    const bumpPoints = Math.min(1.5, Math.max(s1Bump, s2Bump, s3Bump, s4Bump));
    const suggestedVdot = Math.round((currentVdot + bumpPoints) * 10) / 10;

    const evidence = s1FiresUp ? t.observations.filter((o) => o.faster).slice(0, 5) : [];
    const signal2Evidence = s2FiresUp
      ? signal2.workouts.filter((w) => w.inWindow === 'recent').slice(0, 5)
      : undefined;
    const signal3Evidence = s3FiresUp
      ? signal3.observations.filter((o) => o.faster).slice(0, 5)
      : undefined;

    // Build reason text based on which combination fires. Three+ active
    // signals = strongest evidence, single-fire = least.
    const firingNames: string[] = [];
    if (s1FiresUp) firingNames.push('Signal 1 (threshold workouts)');
    if (s2FiresUp) firingNames.push('Signal 2 (Z2 pace drift)');
    if (s3FiresUp) firingNames.push('Signal 3 (interval pace)');
    if (s4FiresUp) firingNames.push('Signal 4 (PR trajectory)');
    const firingCount = firingNames.length;

    const reasonParts: string[] = [];
    if (s1FiresUp) {
      const dates = evidence.slice(0, 3)
        .map((o) => `${o.date} (${formatPace(o.actualPaceS)} vs ${formatPace(o.prescribedPaceS)})`)
        .join('; ');
      reasonParts.push(`Signal 1 · ${t.fasterCount} threshold workouts trended faster at controlled HR (${dates}).`);
    }
    if (s2FiresUp) {
      reasonParts.push(
        `Signal 2 · Z2 pace dropped ${Math.abs(signal2.deltaSPerMi!)} s/mi over the last 4 weeks vs the prior 4 ` +
        `(${signal2.windows.recent.workoutCount} workouts, ${signal2.windows.recent.z2MileCount} Z2 splits recent).`,
      );
    }
    if (s3FiresUp) {
      const i3Dates = (signal3Evidence ?? []).slice(0, 3)
        .map((o) => `${o.date} (${formatPace(o.workIntervalPaceS)} vs ${formatPace(o.prescribedPaceS)})`)
        .join('; ');
      reasonParts.push(`Signal 3 · ${signal3.fasterCount} interval sessions trended faster than prescribed I-pace at Z4-Z5 (${i3Dates}).`);
    }
    if (s4FiresUp) {
      const prList = signal4.prsInWindow.slice(0, 3)
        .map((p) => `${p.canonicalLabel} ${p.date}`)
        .join('; ');
      reasonParts.push(`Signal 4 · ${signal4.prsInWindow.length} fresh race PRs in last ${signal4.lookbackDays} days (${prList}). Race performance is the strongest fitness signal we have.`);
    }
    // Soft positive from Signal 4 alone (2 PRs, doesn't trigger firesUp
    // but mentioned as additional context when ANY other signal fires).
    if (!s4FiresUp && s4SoftUp && firingCount > 0) {
      reasonParts.push(`Plus · 2 fresh PRs in last ${signal4.lookbackDays} days corroborate (soft signal, below 3-PR firing threshold).`);
    }

    let reason: string;
    let falsifier: string;
    if (firingCount >= 2) {
      reason =
        `${firingCount} corroborating signals point to fitness gain. ` +
        reasonParts.join(' ') + ` ` +
        `Combined evidence is ~${bumpPoints.toFixed(1)} VDOT points. ` +
        `Suggested: bump aggregate VDOT ${currentVdot.toFixed(1)} → ${suggestedVdot.toFixed(1)}.`;
      falsifier =
        `All firing signals already exclude heat >78°F and race-recency windows. ` +
        `A reversal in any single signal in the next two weeks would weaken the combined case — ` +
        `multi-signal corroboration is more conservative than any single one, but each signal must keep agreeing.`;
    } else {
      reason =
        reasonParts.join(' ') + ` ` +
        `This is evidence of ~${bumpPoints.toFixed(1)} VDOT points of fitness gain. ` +
        `Suggested: bump aggregate VDOT ${currentVdot.toFixed(1)} → ${suggestedVdot.toFixed(1)}.`;
      const otherSignalsName = s1FiresUp ? 'Signals 2 and 3' : s2FiresUp ? 'Signals 1 and 3' : 'Signals 1 and 2';
      falsifier =
        `Heat >78°F and race-recency workouts are already filtered out. ${otherSignalsName} did not corroborate ` +
        `this period — that's why the bump is conservative. A reversal in the firing signal would weaken the case, ` +
        `as would discovering a context (illness, life stress) that explained the fast paces.`;
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
        signal3Evidence,
        reason,
        falsifier,
      },
    };
  }

  // Downgrade-investigate rule (any signal fires down)
  if (s1FiresDown || s2FiresDown || s3FiresDown) {
    const evidence = s1FiresDown ? t.observations.filter((o) => o.slower).slice(0, 5) : [];
    const signal2Evidence = s2FiresDown
      ? signal2.workouts.filter((w) => w.inWindow === 'recent').slice(0, 5)
      : undefined;
    const signal3Evidence = s3FiresDown
      ? signal3.observations.filter((o) => o.slower).slice(0, 5)
      : undefined;

    const reasonParts: string[] = [];
    if (s1FiresDown) {
      const dates = evidence.slice(0, 3)
        .map((o) => `${o.date} (${formatPace(o.actualPaceS)} vs ${formatPace(o.prescribedPaceS)})`)
        .join('; ');
      reasonParts.push(`Signal 1 · ${t.slowerCount} threshold workouts came in slow despite controlled HR (${dates}).`);
    }
    if (s2FiresDown) {
      reasonParts.push(`Signal 2 · Z2 pace is ${signal2.deltaSPerMi} s/mi slower over the last 4 weeks.`);
    }
    if (s3FiresDown) {
      reasonParts.push(`Signal 3 · ${signal3.slowerCount} interval sessions came in slow at Z4-Z5 effort.`);
    }
    const firingCount = (s1FiresDown ? 1 : 0) + (s2FiresDown ? 1 : 0) + (s3FiresDown ? 1 : 0);

    const reason = firingCount >= 2
      ? `${firingCount} signals point to a possible fitness regression. ` + reasonParts.join(' ') +
        ` Worth investigating: am I in a recovery week? Carrying extra fatigue? Illness?`
      : reasonParts.join(' ') + ` Worth investigating: recovery week? Fatigue? Illness?`;
    const falsifier =
      `If you can identify a contextual reason — recovery week, poor sleep cluster, illness, life stress — ` +
      `dismiss this. The investigate path is for when execution is honest and the numbers still tell you ` +
      `something's off.`;

    return {
      ...base,
      hasFinding: true,
      recommendation: {
        kind: 'vdot-downgrade-investigate',
        evidence,
        signal2Evidence,
        signal2Delta: s2FiresDown ? (signal2.deltaSPerMi ?? undefined) : undefined,
        signal3Evidence,
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
        `All four signals tracking close to baseline. ` +
        `S1 ${totalObs} threshold workouts · S2 Z2 pace at fixed HR · S3 ${signal3.observations.length} interval sessions · S4 ${signal4.prsInWindow.length} PRs in last ${signal4.lookbackDays} days. ` +
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
