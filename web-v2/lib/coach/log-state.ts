/**
 * log-state.ts — chronological run history for /log.
 *
 * Pulls every run from the table (legacy-named `strava_activities`,
 * but holds all sources: watch, HealthKit, manual, Strava webhook),
 * groups by week, surfaces per-week totals.
 */
import { pool } from '@/lib/db/pool';

export interface LogRun {
  id: string;
  date: string;             // YYYY-MM-DD (local)
  dow: number;              // 0=Sun..6=Sat
  start_local: string | null;
  name: string;
  source: 'watch' | 'apple_health' | 'manual' | 'strava' | string;
  type: string | null;
  distance_mi: number;
  pace: string | null;       // formatted "9:18"
  time_moving: string | null;
  avg_hr: number | null;
  max_hr: number | null;
  cadence: number | null;
  elev_gain_ft: number | null;
}

export interface LogWeek {
  monday: string;           // YYYY-MM-DD
  label: string;            // e.g. "MAY 25 → MAY 31" or "THIS WEEK"
  totalMi: number;
  totalDuration: string | null;
  runs: LogRun[];
  isCurrent: boolean;
}

export interface LogState {
  today: string;
  totalRuns: number;
  totalMi: number;
  weeks: LogWeek[];
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function fmtPaceFromSec(s: number | null): string | null {
  if (!s || s <= 0 || !isFinite(s)) return null;
  return `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;
}

function fmtDuration(secs: number | null): string | null {
  if (!secs || secs <= 0 || !isFinite(secs)) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function fmtDay(iso: string): string {
  const [_, mm, dd] = iso.split('-').map(Number);
  return `${MONTHS[mm - 1]} ${dd}`;
}

function dowOf(iso: string): number {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay();
  const shift = dow === 0 ? -6 : 1 - dow;
  const m = new Date(d.getTime() + shift * 86400000);
  return m.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

export async function loadLogState(userId: string, opts?: { limit?: number }): Promise<LogState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const limit = opts?.limit ?? 200; // ~6 months of running

  const rows = (await pool.query(
    `SELECT data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'distanceMi')::numeric > 0.5
      ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal',10)) DESC,
               COALESCE(data->>'startLocal','') DESC
      LIMIT $2`,
    [userId, limit]
  )).rows;

  const rawRuns: LogRun[] = rows.map((r: any) => {
    const a = r.data;
    const date = a.date || (a.startLocal ?? '').slice(0, 10);
    const sPerMi = Number(a.paceSPerMi) || null;
    return {
      id: a.id ?? a.activityId ?? `${date}-${Number(a.distanceMi).toFixed(2)}`,
      date,
      dow: date ? dowOf(date) : 0,
      start_local: a.startLocal ?? null,
      name: a.name ?? 'Run',
      source: a.source ?? 'strava',
      type: a.type ?? null,
      distance_mi: Number(a.distanceMi) || 0,
      pace: a.avgPaceMinPerMi || fmtPaceFromSec(sPerMi) || null,
      time_moving: fmtDuration(Number(a.movingTimeS) || null),
      avg_hr: Number(a.avgHr) || null,
      max_hr: Number(a.maxHr) || null,
      cadence: Number(a.avgCadence) || null,
      elev_gain_ft: Number(a.elevGainFt) || null,
    };
  });

  // Dedupe: same date + distance (within 0.05mi) is the same run captured by
  // multiple sources (e.g. watch + apple_health import + Strava webhook).
  // Prefer the source w/ richer data: strava > watch > manual > apple_health.
  const SOURCE_RANK: Record<string, number> = { strava: 4, watch: 3, manual: 2, apple_health: 1 };
  const dedupeKey = (r: LogRun) => `${r.date}-${Math.round(r.distance_mi * 20) / 20}`;
  const bestByKey = new Map<string, LogRun>();
  for (const r of rawRuns) {
    const k = dedupeKey(r);
    const cur = bestByKey.get(k);
    if (!cur) { bestByKey.set(k, r); continue; }
    const curRank = SOURCE_RANK[cur.source] ?? 0;
    const newRank = SOURCE_RANK[r.source] ?? 0;
    if (newRank > curRank) bestByKey.set(k, r);
  }
  const runs = [...bestByKey.values()].sort((a, b) => b.date.localeCompare(a.date));

  // Group by Monday-of-week
  const byWeek = new Map<string, LogRun[]>();
  for (const r of runs) {
    if (!r.date) continue;
    const m = mondayOf(r.date);
    const arr = byWeek.get(m) ?? [];
    arr.push(r);
    byWeek.set(m, arr);
  }

  const thisMonday = mondayOf(today);
  const weeks: LogWeek[] = [...byWeek.entries()]
    .sort((a, b) => b[0].localeCompare(a[0])) // most-recent first
    .map(([monday, ws]) => {
      const totalMi = Math.round(ws.reduce((s, x) => s + x.distance_mi, 0) * 10) / 10;
      const isCurrent = monday === thisMonday;
      const sunday = addDays(monday, 6);
      return {
        monday,
        label: isCurrent ? 'THIS WEEK' : `${fmtDay(monday)} → ${fmtDay(sunday)}`,
        totalMi,
        totalDuration: null, // TODO: sum moving times
        runs: ws.sort((a, b) => a.date.localeCompare(b.date)), // Mon → Sun within the week
        isCurrent,
      };
    });

  const totalMi = Math.round(runs.reduce((s, r) => s + r.distance_mi, 0) * 10) / 10;
  return { today, totalRuns: runs.length, totalMi, weeks };
}
