/**
 * Aggregate VDOT compute from a user's Strava history.
 *
 * Single-race VDOT (vdot.ts → vdotFromRace) is brittle: a bad day or
 * a hot race spikes it the wrong way. For the /races page anchor card
 * we want a STARTING POINT that draws on everything this year so far.
 *
 * Strategy:
 *   1. Pull this year's runs that look like effort (best efforts at
 *      common distances: 5K / 10K / HM / Marathon, plus any flagged
 *      workoutType=1 race).
 *   2. For each canonical distance, compute the VDOT implied by the
 *      best time within the last 365 days.
 *   3. Average the top 3 VDOTs (drop the rest as outliers). If only 1
 *      or 2 candidates, use whatever's there.
 *   4. Bias toward the most recent — divide weight by 1 + months_old / 6.
 *
 * Returns null when there's nothing usable (no races logged, no
 * canonical-distance bests yet).
 */

import { query } from './db';
import { vdotFromRace } from './vdot';

export interface AggregateVdot {
  /** The aggregate VDOT estimate (rounded to 0.1) */
  value: number;
  /** How many distinct distance bests fed into the aggregate */
  sourceCount: number;
  /** Top contributing sources, newest-first */
  sources: Array<{
    canonicalLabel: string;
    distanceMi: number;
    finishS: number;
    date: string;
    activityId: string;
    vdot: number;
  }>;
  /** "this year" / "last 365d" — what window we actually used */
  windowLabel: string;
}

interface ActivityRow {
  id: string;
  data: {
    name?: string;
    date?: string;
    canonicalLabel?: string;
    canonicalFinishS?: number;
    distanceMi?: number;
    movingTimeS?: number;
    workoutType?: number | null;
  };
}

/** Map a Strava activity to a canonical distance (within 5% tolerance)
 *  when canonicalLabel isn't already set on the row. Returns null when
 *  the activity doesn't match a standard race distance. */
function inferCanonical(distanceMi: number): { label: string; canonicalMi: number } | null {
  if (Math.abs(distanceMi - 3.107) < 0.155) return { label: '5K', canonicalMi: 3.107 };       // 5K ±5%
  if (Math.abs(distanceMi - 6.214) < 0.31)  return { label: '10K', canonicalMi: 6.214 };      // 10K ±5%
  if (Math.abs(distanceMi - 9.32)  < 0.47)  return { label: '15K', canonicalMi: 9.32 };
  if (Math.abs(distanceMi - 13.109) < 0.55) return { label: 'Half', canonicalMi: 13.109 };    // HM ±4%
  if (Math.abs(distanceMi - 26.219) < 1.05) return { label: 'Marathon', canonicalMi: 26.219 };
  return null;
}

export async function computeAggregateVdot(userId: string): Promise<AggregateVdot | null> {
  // Pull anything from the last 365 days that's either a flagged race
  // or has a canonical-label tag set by our import pipeline. We grab
  // a generous superset and pick the best per distance in JS.
  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (
          (data->>'workoutType')::INTEGER = 1
          OR data->>'canonicalLabel' IS NOT NULL
          OR (data->>'distanceMi')::NUMERIC BETWEEN 2.95 AND 27.3
        )
        AND (data->>'movingTimeS')::NUMERIC > 0
      ORDER BY (data->>'date') DESC
      LIMIT 250`,
    [userId, yearAgoIso],
  );
  if (rows.length === 0) return null;

  // Group by canonical distance, taking the fastest in each bucket.
  // The row's canonicalLabel/canonicalFinishS wins when present (our
  // import pipeline already chose the segment within the activity).
  // Otherwise fall back to inferring from distanceMi.
  type Best = { label: string; canonicalMi: number; finishS: number; date: string; activityId: string };
  const bests = new Map<string, Best>();
  for (const r of rows) {
    const d = r.data;
    let label: string | undefined;
    let canonMi = 0;
    let finishS = 0;
    if (d.canonicalLabel && d.canonicalFinishS && d.canonicalFinishS > 0) {
      label = d.canonicalLabel;
      finishS = Number(d.canonicalFinishS);
      const matched = inferCanonical(label === 'Half' ? 13.109 : label === 'Marathon' ? 26.219 : Number(d.distanceMi) || 0);
      canonMi = matched?.canonicalMi ?? (Number(d.distanceMi) || 0);
    } else if (Number(d.distanceMi)) {
      const matched = inferCanonical(Number(d.distanceMi));
      if (matched) {
        label = matched.label;
        canonMi = matched.canonicalMi;
        finishS = Number(d.movingTimeS) || 0;
      }
    }
    if (!label || finishS <= 0 || canonMi <= 0) continue;

    const prior = bests.get(label);
    if (!prior || finishS < prior.finishS) {
      bests.set(label, {
        label,
        canonicalMi: canonMi,
        finishS,
        date: d.date || '',
        activityId: r.id,
      });
    }
  }
  if (bests.size === 0) return null;

  // Convert each best to a VDOT and weight by recency.
  const today = Date.now();
  const sources = Array.from(bests.values())
    .map((b) => {
      const vdot = vdotFromRace(b.canonicalMi, b.finishS);
      if (vdot == null) return null;
      const ageDays = b.date
        ? Math.max(0, (today - new Date(b.date + 'T12:00:00Z').getTime()) / 86_400_000)
        : 180;
      const monthsOld = ageDays / 30;
      const weight = 1 / (1 + monthsOld / 6);  // 1.0 fresh → 0.5 after 6 months
      return {
        canonicalLabel: b.label,
        distanceMi: b.canonicalMi,
        finishS: b.finishS,
        date: b.date,
        activityId: b.activityId,
        vdot: Math.round(vdot * 10) / 10,
        weight,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (sources.length === 0) return null;

  // Top 3 contributors only — drop trailing outliers.
  const top = sources.slice(0, 3);
  const weightSum = top.reduce((s, p) => s + p.weight, 0);
  const value = top.reduce((s, p) => s + p.vdot * p.weight, 0) / weightSum;

  return {
    value: Math.round(value * 10) / 10,
    sourceCount: sources.length,
    sources: sources.slice(0, 5).map(({ weight: _w, ...rest }) => rest),
    windowLabel: 'last 365 days',
  };
}
