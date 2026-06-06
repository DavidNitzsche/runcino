/**
 * lib/coach/pacing-discipline.ts · Execution chunk for the Targets GapPanel.
 *
 * Returns a per-runner pacing-discipline buffer in seconds, sized to the
 * coefficient of variation (CV) across mile splits in their recent
 * race-effort runs. A tight pacer (low CV) gets a smaller buffer; a
 * loose pacer (high CV) gets a larger one. Used by
 * `goalRace.executionBufferSec` in the seed → GapPanel reads it directly.
 *
 * Doctrine: Research/04 · pacing discipline. The brief defines:
 *   CV < 0.02 → 15s · tight pacer
 *   CV < 0.04 → 30s · typical
 *   CV ≥ 0.04 → 60s · loose pacer
 *   < 2 qualifying runs → 30s default with source='default'
 *
 * Qualifying runs · "race-effort" means `type IN ('race','tempo','threshold')`
 * AND distance ≥ 4 mi AND splits.length ≥ 4. We considered a pace-quartile
 * fallback to identify tempo efforts when the type column is unreliable
 * (Strava-pulled runs often arrive as type='Run', HK as null) but pulling
 * "the fastest 4 runs" picked up run-walks and mixed-pace long runs with
 * sky-high CV and inflated the buffer to 60s for runners who hadn't
 * actually done explicit tempo work. The brief's stated fallback is the
 * honest one: < 2 typed runs → source='default', buffer=30s. As ingest
 * matures and types land, the chunk lights up to source='observed'.
 *
 * Multi-source splits: this helper tolerates four split shapes seen
 * across the ingest pipeline (watch/HK/Strava/manual). See
 * paceSecFromSplit() for the field-name fallback ladder.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { getCanonicalRunIds, isoDaysBefore } from '@/lib/runs/volume';

export interface PacingDisciplineResult {
  /** Seconds of pacing-buffer for the runner's typical execution. */
  bufferSec: number;
  /** Number of qualifying runs the CV was computed from. */
  n: number;
  /** Median coefficient of variation across mile splits. Null when
   *  source='default' (no qualifying runs). */
  cv: number | null;
  /** Provenance flag for the doctrine drawer. */
  source: 'observed' | 'default';
}

const BUFFER_TIGHT_SEC  = 15;
const BUFFER_TYPICAL_SEC = 30;
const BUFFER_LOOSE_SEC  = 60;
const CV_TIGHT_THRESHOLD = 0.02;
const CV_LOOSE_THRESHOLD = 0.04;
const DEFAULT_WINDOW_DAYS = 90;
const MIN_DISTANCE_MI = 4.0;
const MIN_SPLITS = 4;
const MAX_QUALIFYING_RUNS = 4;

interface RunRow {
  id: string;
  type: string | null;
  distanceMi: number;
  avgPaceSPerMi: number | null;
  splits: unknown[];
}

/**
 * Compute the per-runner pacing-discipline buffer.
 *
 * Generic across all users · queries by userUuid, applies pace-quartile
 * heuristic when explicit typing is absent. No hardcoded thresholds
 * per user.
 */
export async function computePacingDiscipline(
  userUuid: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<PacingDisciplineResult> {
  // 2026-06-03 · runner TZ anchors the window.
  const today = await runnerToday(userUuid);
  // Pull ALL runs ≥ MIN_DISTANCE_MI with ≥ MIN_SPLITS splits in the
  // window · we sort + filter client-side because jsonb_array_length
  // in a WHERE doesn't index well.
  // Phase B · one canonical dedup. A dupe of one race/tempo run would otherwise
  // appear twice in the qualifying set and skew the pace-CV buffer.
  const canonicalIds = await getCanonicalRunIds(userUuid, isoDaysBefore(today, windowDays), today);
  const rows = (await pool.query<{
    id: string;
    type: string | null;
    distance_mi: string | null;
    pace_s_per_mi: number | null;
    splits: unknown[];
  }>(
    `SELECT r.id::text AS id,
            data->>'type' AS type,
            data->>'distanceMi' AS distance_mi,
            COALESCE(
              (data->>'avgPaceSPerMi')::numeric,
              CASE WHEN data->>'avgPaceMinPerMi' ~ '^\\d+:\\d+$'
                THEN (
                  split_part(data->>'avgPaceMinPerMi', ':', 1)::numeric * 60 +
                  split_part(data->>'avgPaceMinPerMi', ':', 2)::numeric
                )
                ELSE NULL END
            )::numeric AS pace_s_per_mi,
            COALESCE(data->'splits', '[]'::jsonb) AS splits
       FROM runs r
      WHERE r.user_uuid = $1
        AND r.absorbed_into_canonical_at IS NULL
        AND r.id = ANY($5::bigint[])
        AND (data->>'distanceMi')::numeric >= $2
        AND COALESCE(
              (data->>'date')::date,
              LEFT(data->>'startLocal', 10)::date
            ) >= $4::date - $3::int
      ORDER BY (data->>'date') DESC
      LIMIT 80`,
    [userUuid, MIN_DISTANCE_MI, windowDays, today, canonicalIds],
  ).catch(() => ({ rows: [] }))).rows;

  const candidates: RunRow[] = rows
    .map((r) => ({
      id: r.id,
      type: r.type,
      distanceMi: Number(r.distance_mi ?? 0),
      avgPaceSPerMi: r.pace_s_per_mi != null ? Number(r.pace_s_per_mi) : null,
      splits: Array.isArray(r.splits) ? r.splits : [],
    }))
    .filter((r) => r.splits.length >= MIN_SPLITS && r.distanceMi >= MIN_DISTANCE_MI);

  if (candidates.length < 2) {
    return { bufferSec: BUFFER_TYPICAL_SEC, n: 0, cv: null, source: 'default' };
  }

  // Strict-typed only · pace-quartile fallback considered + rejected
  // (false positives on long runs + run-walks · see doc above).
  const qualifying = candidates
    .filter((r) => r.type != null && /\b(race|tempo|threshold)\b/i.test(r.type))
    .sort((a, b) => (a.avgPaceSPerMi ?? Infinity) - (b.avgPaceSPerMi ?? Infinity))
    .slice(0, MAX_QUALIFYING_RUNS);

  if (qualifying.length < 2) {
    return { bufferSec: BUFFER_TYPICAL_SEC, n: 0, cv: null, source: 'default' };
  }

  const cvValues: number[] = [];
  for (const run of qualifying) {
    const paceSecs = run.splits
      .map(paceSecFromSplit)
      .filter((p): p is number => p != null && p > 0 && p < 1800);
    if (paceSecs.length < MIN_SPLITS) continue;
    const cv = coefficientOfVariation(paceSecs);
    if (cv != null && isFinite(cv)) cvValues.push(cv);
  }

  if (cvValues.length < 2) {
    return { bufferSec: BUFFER_TYPICAL_SEC, n: 0, cv: null, source: 'default' };
  }

  const medianCV = median(cvValues);
  const bufferSec = medianCV < CV_TIGHT_THRESHOLD
    ? BUFFER_TIGHT_SEC
    : medianCV < CV_LOOSE_THRESHOLD
      ? BUFFER_TYPICAL_SEC
      : BUFFER_LOOSE_SEC;

  return {
    bufferSec,
    n: cvValues.length,
    cv: Math.round(medianCV * 1000) / 1000,
    source: 'observed',
  };
}

/**
 * Extract seconds-per-mile from a single split, tolerating the four
 * shapes seen across ingest sources:
 *
 *   · Watch/HK · { mile, pace: "8:25", hr, cadence, elev_ft }
 *   · Strava-pulled · { split, distance(m), moving_time(s), average_speed(m/s) }
 *   · Watch-completion · { mi, paceSecPerMi, distanceMi, durationSec, ... }
 *   · Manual · { pace, ... }
 *
 * Returns null when no recoverable pace signal in the split.
 */
function paceSecFromSplit(s: unknown): number | null {
  if (!s || typeof s !== 'object') return null;
  const sp = s as Record<string, unknown>;

  // 1. Explicit pace-seconds field
  const direct = num(sp.paceSecPerMi ?? sp.pace_s_per_mi);
  if (direct != null && direct > 0) return direct;

  // 2. "8:25" string
  const paceStr = typeof sp.pace === 'string' ? sp.pace : null;
  if (paceStr) {
    const m = paceStr.match(/^(\d+):(\d{1,2})$/);
    if (m) {
      const v = Number(m[1]) * 60 + Number(m[2]);
      if (v > 0) return v;
    }
  }

  // 3. Strava: average_speed (m/s) → s/mi
  const speedMs = num(sp.average_speed);
  if (speedMs != null && speedMs > 0) {
    return 1609.344 / speedMs;
  }

  // 4. Strava: moving_time (s) + distance (m) → s/mi
  const mt = num(sp.moving_time);
  const distM = num(sp.distance);
  if (mt != null && distM != null && distM > 0) {
    return mt / (distM / 1609.344);
  }

  // 5. Watch-completion durationSec + distanceMi
  const durSec = num(sp.durationSec);
  const distMi = num(sp.distanceMi);
  if (durSec != null && distMi != null && distMi > 0) {
    return durSec / distMi;
  }

  return null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
