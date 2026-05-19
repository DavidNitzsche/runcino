/**
 * L7 Signal 4 · PR trajectory as adaptive evidence (C3)
 *
 * Fourth signal in the alive-but-not-nervous L7 architecture. Where
 * Signals 1+2+3 watch workout execution between races, Signal 4
 * watches the cumulative count of new race PRs set within the current
 * training cycle. Multiple fresh PRs are strong evidence the runner
 * is building real fitness — converging confirmation from race
 * performance, not just training adherence.
 *
 * GATING (locked with David spec round 5):
 *   2+ PRs in last 8 weeks · soft positive (count contributes,
 *                            single-signal-up state on its own)
 *   3+ PRs in last 8 weeks · strong positive (firesUp = true, full
 *                            corroboration weight)
 *
 * SOURCE OF TRUTH (Rule 1 · L6 source-of-truth)
 *   Race-source PRs only. Reads from races.actual_result.finishS.
 *   Strava-source PRs are display-only on the PR card (per L5
 *   design) and explicitly do NOT feed this signal.
 *
 * "NEW PR" DEFINITION
 *   A race finish is a "new PR" when it's the user's best at its
 *   canonical distance AND no prior race at that distance has a
 *   faster finish. Multi-distance counting: a fresh 10K PR and a
 *   fresh HM PR within 8 weeks counts as TWO PRs.
 *
 * SUSPENSION
 *   When user is marked injured (activity_gap_status='injured'),
 *   signal evaluation suspends. Per CLAUDE.md Rule 5 — each finding
 *   applies its own injury filter, doesn't inherit from parent.
 */

import { query } from './db';
import { computeStravaGap } from './strava-gap';

export interface Signal4PR {
  date: string;
  distanceMi: number;
  canonicalLabel: string;
  finishS: number;
  name: string;
}

export interface Signal4Result {
  /** Race-source PRs set within the lookback window. */
  prsInWindow: Signal4PR[];
  /** Distinct canonical distances represented. */
  distinctDistances: number;
  /** True when 3+ PRs in window — strong fitness-up evidence. */
  firesUp: boolean;
  /** True when 2 PRs in window — softer positive (single-signal-up state). */
  softPositive: boolean;
  /** Lookback window in days. */
  lookbackDays: number;
  /** When signal is suspended (injury mark). */
  suspended: boolean;
}

export const SIGNAL4_LOOKBACK_DAYS = 56;  // 8 weeks
export const SIGNAL4_STRONG_THRESHOLD = 3;
export const SIGNAL4_SOFT_THRESHOLD = 2;

const CANONICAL_DISTANCES: Array<{ label: string; mi: number; tol: number }> = [
  { label: '1 mi', mi: 1.00, tol: 0.08 },
  { label: '5K',   mi: 3.10, tol: 0.08 },
  { label: '10K',  mi: 6.21, tol: 0.08 },
  { label: '15K',  mi: 9.32, tol: 0.08 },
  { label: 'Half', mi: 13.10, tol: 0.08 },
  { label: 'Marathon', mi: 26.22, tol: 0.08 },
];

function inferCanonical(distMi: number): { label: string; mi: number } | null {
  for (const c of CANONICAL_DISTANCES) {
    if (Math.abs(distMi - c.mi) / c.mi <= c.tol) return { label: c.label, mi: c.mi };
  }
  return null;
}

interface RaceRow {
  date: string;
  name: string;
  distance_mi: string;
  finish_s: string;
}

export async function computeSignal4(
  userId: string,
  today: Date,
): Promise<Signal4Result> {
  const todayIso = today.toISOString().slice(0, 10);
  const cutoffIso = new Date(today.getTime() - SIGNAL4_LOOKBACK_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

  const empty: Signal4Result = {
    prsInWindow: [],
    distinctDistances: 0,
    firesUp: false,
    softPositive: false,
    lookbackDays: SIGNAL4_LOOKBACK_DAYS,
    suspended: false,
  };

  // Injury suspension check (per Rule 5).
  try {
    const gap = await computeStravaGap(userId, todayIso);
    if (gap.signalsSuspended) {
      return { ...empty, suspended: true };
    }
  } catch { /* non-fatal */ }

  // 1. Pull all completed races (any time, any distance) to compute
  //    each canonical distance's all-time best finish.
  // 2. Pull races in the window (last 8 weeks).
  // 3. For each in-window race, check: is its finish equal to or
  //    better than the all-time best at that canonical distance?
  //    AND no earlier race at that distance ALSO has the same or
  //    better finish (PR is "new").

  const allRaces = await query<RaceRow>(
    `SELECT meta->>'date'                                  AS date,
            COALESCE(meta->>'name', '')                    AS name,
            (meta->>'distanceMi')::TEXT                    AS distance_mi,
            (actual_result->>'finishS')::TEXT              AS finish_s
       FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND actual_result IS NOT NULL
        AND (actual_result->>'finishS')::NUMERIC > 0
        AND meta->>'date' IS NOT NULL
      ORDER BY meta->>'date' ASC`,
    [userId],
  );

  // Bucket by canonical label, track running best by date order.
  const byDistance = new Map<string, Array<{ date: string; finishS: number; name: string; distanceMi: number }>>();
  for (const r of allRaces) {
    const distMi = Number(r.distance_mi);
    const finishS = Number(r.finish_s);
    if (!Number.isFinite(distMi) || !Number.isFinite(finishS) || finishS <= 0) continue;
    const canon = inferCanonical(distMi);
    if (!canon) continue;
    const list = byDistance.get(canon.label) ?? [];
    list.push({ date: r.date, finishS, name: r.name || canon.label, distanceMi: distMi });
    byDistance.set(canon.label, list);
  }

  const prsInWindow: Signal4PR[] = [];
  const distinctDistances = new Set<string>();

  for (const [label, list] of byDistance.entries()) {
    // list already sorted ASC by date. Walk and track running best.
    let bestSoFar = Number.POSITIVE_INFINITY;
    for (const r of list) {
      const isNewPR = r.finishS < bestSoFar;
      if (isNewPR) {
        bestSoFar = r.finishS;
        // Only count if PR was set within the window.
        if (r.date >= cutoffIso) {
          prsInWindow.push({
            date: r.date,
            distanceMi: r.distanceMi,
            canonicalLabel: label,
            finishS: r.finishS,
            name: r.name,
          });
          distinctDistances.add(label);
        }
      }
    }
  }

  return {
    prsInWindow,
    distinctDistances: distinctDistances.size,
    firesUp: prsInWindow.length >= SIGNAL4_STRONG_THRESHOLD,
    softPositive: prsInWindow.length >= SIGNAL4_SOFT_THRESHOLD,
    lookbackDays: SIGNAL4_LOOKBACK_DAYS,
    suspended: false,
  };
}
