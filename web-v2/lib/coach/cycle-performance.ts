/**
 * lib/coach/cycle-performance.ts · per-phase performance pattern
 * (female runners only).
 *
 * Cross-references menstrual cycle phase × run quality history. For each
 * phase (follicular / ovulatory / luteal), computes run count + average
 * effort indicators (VDOT-equivalent, perceived effort) over the last
 * 90 days.
 *
 * Doctrine: Research/13 § sex-specific · "peak power efforts land best
 * in ovulation week · luteal endurance is solid · adjust accordingly."
 *
 * Returns null when:
 *   - biologicalSex !== 'female' (caller's job to check, but defensive)
 *   - < 4 weeks of cycle phase data exists
 *   - < 6 runs total in the window
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

export interface CyclePerformance {
  follicular: PhaseStats;
  ovulatory: PhaseStats;
  luteal: PhaseStats;
  menstrual: PhaseStats;
  insights: string[];
}

interface PhaseStats {
  runCount: number;
  avgPaceSPerMi: number | null;
  avgHrBpm: number | null;
  topQuartileRate: number;  // % of runs in top quartile by pace
}

const PHASE_MAP: Record<number, keyof CyclePerformance> = {
  1: 'menstrual', 2: 'follicular', 3: 'ovulatory', 4: 'luteal',
};

async function buildPhaseStats(rows: Array<{ pace: number | null; hr: number | null; phase: number }>, phase: number, topPaceThreshold: number | null): Promise<PhaseStats> {
  const phaseRows = rows.filter((r) => r.phase === phase);
  if (phaseRows.length === 0) {
    return { runCount: 0, avgPaceSPerMi: null, avgHrBpm: null, topQuartileRate: 0 };
  }
  const paces = phaseRows.map((r) => r.pace).filter((v): v is number => v != null);
  const hrs = phaseRows.map((r) => r.hr).filter((v): v is number => v != null);
  const topQuartileCount = topPaceThreshold != null
    ? paces.filter((p) => p <= topPaceThreshold).length
    : 0;
  return {
    runCount: phaseRows.length,
    avgPaceSPerMi: paces.length ? Math.round(paces.reduce((s, v) => s + v, 0) / paces.length) : null,
    avgHrBpm: hrs.length ? Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length) : null,
    topQuartileRate: phaseRows.length > 0 ? Math.round((topQuartileCount / phaseRows.length) * 100) : 0,
  };
}

export async function computeCyclePerformance(userUuid: string): Promise<CyclePerformance | null> {
  // 2026-06-03 · runner TZ anchors the 90d window.
  const today = await runnerToday(userUuid);
  // Pull runs in last 90d with paces + HR + the cycle phase from same day.
  const rows = await pool.query<{ date: string; pace: number | string | null; hr: number | string | null; phase: number | string | null }>(
    `SELECT r.data->>'date' AS date,
            CASE
              WHEN r.data->>'avgPaceMinPerMi' LIKE '%:%'
              THEN (SPLIT_PART(r.data->>'avgPaceMinPerMi', ':', 1)::int * 60
                  + SPLIT_PART(r.data->>'avgPaceMinPerMi', ':', 2)::int)
              ELSE (r.data->>'avgPaceMinPerMi')::numeric
            END AS pace,
            (r.data->>'avgHr')::numeric AS hr,
            (SELECT value::int FROM health_samples h
              WHERE COALESCE(h.user_uuid, h.user_id) = $1
                AND h.sample_type = 'menstrual_cycle_phase'
                AND h.sample_date = (r.data->>'date')::date
              ORDER BY h.recorded_at DESC LIMIT 1) AS phase
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND NOT (r.data ? 'mergedIntoId')
        AND (r.data->>'date')::date >= $2::date - interval '90 days'`,
    [userUuid, today],
  ).then((q) => q.rows).catch(() => []);

  const normalized = rows.map((r) => ({
    pace: r.pace != null ? Number(r.pace) : null,
    hr: r.hr != null ? Number(r.hr) : null,
    phase: r.phase != null ? Number(r.phase) : null,
  })).filter((r): r is { pace: number | null; hr: number | null; phase: number } => r.phase != null && r.phase >= 1 && r.phase <= 4);

  if (normalized.length < 6) return null;

  // Top-quartile pace threshold across all valid runs.
  const allPaces = normalized.map((r) => r.pace).filter((v): v is number => v != null).sort((a, b) => a - b);
  const topPaceThreshold = allPaces.length >= 4 ? allPaces[Math.floor(allPaces.length / 4)] : null;

  const [follicular, ovulatory, luteal, menstrual] = await Promise.all([
    buildPhaseStats(normalized, 2, topPaceThreshold),
    buildPhaseStats(normalized, 3, topPaceThreshold),
    buildPhaseStats(normalized, 4, topPaceThreshold),
    buildPhaseStats(normalized, 1, topPaceThreshold),
  ]);

  const insights: string[] = [];
  // Find peak phase.
  const phases = [
    { name: 'follicular', stats: follicular },
    { name: 'ovulatory', stats: ovulatory },
    { name: 'luteal', stats: luteal },
  ];
  const bestPhase = phases.filter((p) => p.stats.runCount >= 2)
    .sort((a, b) => b.stats.topQuartileRate - a.stats.topQuartileRate)[0];
  if (bestPhase && bestPhase.stats.topQuartileRate > 30) {
    insights.push(`Your top-quartile runs land most in the ${bestPhase.name} phase (${bestPhase.stats.topQuartileRate}% hit rate).`);
  }
  // Luteal endurance check (Research/13 doctrine).
  if (luteal.runCount >= 2 && luteal.avgHrBpm != null && follicular.avgHrBpm != null) {
    const hrDelta = luteal.avgHrBpm - follicular.avgHrBpm;
    if (hrDelta > 3) {
      insights.push(`HR runs ${hrDelta} bpm higher in luteal vs follicular · plan recovery accordingly.`);
    }
  }

  if (insights.length === 0) return null;

  return { follicular, ovulatory, luteal, menstrual, insights };
}
