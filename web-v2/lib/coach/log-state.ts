/**
 * log-state.ts — chronological run history for /log.
 *
 * Pulls every run from the table (legacy-named `strava_activities`,
 * but holds all sources: watch, HealthKit, manual, Strava webhook),
 * groups by week, surfaces per-week totals.
 */
import { pool } from '@/lib/db/pool';
import { loadActivePlan } from '@/lib/plan/lookup';

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
  // Filter axes (2026-05-28): three new joins for /log filter chips.
  // - workoutType: pulled from plan_workouts (joined by ISO date) when a plan
  //   row exists for this run's date. Falls back to the activity's own `type`
  //   (already on the row) when there's no matched plan workout. Null when
  //   neither resolves.
  // - phaseLabel: plan_phases.label for the runner+ISO date (BASE/BUILD/PEAK/
  //   TAPER/RACE). Null when no plan covers the date.
  // - shoeName: shoes table display name ("Puma Deviate 3"). Null when no shoe
  //   was assigned to this run.
  workoutType: string | null;
  phaseLabel: string | null;
  shoeName: string | null;
  shoeSlug: string | null;  // URL-safe id used by the filter chip
}

// Per-axis available values for the filter chip strip — only render chips
// for values that actually appear in the unfiltered set.
export interface LogFilterAxes {
  sources: string[];                              // e.g. ['watch','strava']
  types: string[];                                // e.g. ['easy','long','quality']
  phases: string[];                               // e.g. ['BASE','BUILD']
  shoes: { slug: string; name: string; runs: number }[];
}

// Active filters parsed from URL searchParams.
export interface LogFilters {
  source: string | null;
  type: string | null;
  phase: string | null;
  shoe: string | null;
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
  totalRuns: number;             // matching the active filters
  totalMi: number;               // matching the active filters
  totalRunsUnfiltered: number;   // all runs ignoring filters
  totalMiUnfiltered: number;     // all runs ignoring filters
  weeks: LogWeek[];              // already filtered (only weeks with matching runs)
  axes: LogFilterAxes;           // axis values present in the unfiltered set
  filters: LogFilters;           // active filters echoed back for the UI
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

/**
 * Slugify a shoe display name into a URL-safe id.
 * "Puma Deviate Nitro 3" → "puma-deviate-nitro-3"
 */
function shoeSlugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function loadLogState(
  userId: string,
  opts?: { limit?: number; filters?: Partial<LogFilters> }
): Promise<LogState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const limit = opts?.limit ?? 200; // ~6 months of running

  const filters: LogFilters = {
    source: opts?.filters?.source ?? null,
    type: (opts?.filters?.type ?? null)?.toLowerCase() ?? null,
    phase: (opts?.filters?.phase ?? null)?.toUpperCase() ?? null,
    shoe: opts?.filters?.shoe ?? null,
  };

  // Pull runs + their shoe assignment in one query (LEFT JOIN to shoes).
  // We still keep the json blob in `data` so all downstream formatting (pace,
  // hr, etc.) keeps working identically.
  // Distance floor was `> 0.5` — silently hid every walk, recovery jog, and
  // sub-half-mile shakeout from the runner's own log. If the ingest path
  // accepted it, the log should show it. Only filter zero-distance ghost
  // entries (GPS errors, abandoned starts) where the run never happened.
  const rows = (await pool.query(
    `SELECT sa.data,
            sa.shoe_id,
            s.brand AS shoe_brand,
            s.model AS shoe_model
       FROM runs sa
       LEFT JOIN shoes s ON s.id = sa.shoe_id
      WHERE sa.user_uuid = $1
        AND NOT (sa.data ? 'mergedIntoId')
        AND (sa.data->>'distanceMi')::numeric > 0
      ORDER BY COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) DESC,
               COALESCE(sa.data->>'startLocal','') DESC
      LIMIT $2`,
    [userId, limit]
  )).rows;

  // Active plan (memoized — shared across state-loaders)
  const plan = await loadActivePlan(userId);

  // plan_workouts keyed by ISO date — gives us the runner-friendly type
  // assigned by the plan ("long", "quality", "easy", etc.) for that date.
  const planWorkoutByDate = new Map<string, string>();
  // plan_phases — array of {label, start, end week-idx}, mapped to ISO dates
  // via plan_weeks. We resolve per-row at filter time.
  type PhaseRange = { label: string; start_iso: string; end_iso: string };
  let phaseRanges: PhaseRange[] = [];
  if (plan) {
    const pw = (await pool.query(
      `SELECT date_iso, type FROM plan_workouts WHERE plan_id = $1`,
      [plan.id]
    )).rows;
    for (const r of pw) {
      if (r.date_iso && r.type) planWorkoutByDate.set(r.date_iso, String(r.type));
    }
    const weeks = (await pool.query(
      `SELECT week_idx, week_start_iso FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
      [plan.id]
    )).rows;
    const phases = (await pool.query(
      `SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1`,
      [plan.id]
    )).rows;
    phaseRanges = phases.map((p: any) => {
      const startWk = weeks.find((w: any) => w.week_idx === p.start_week_idx);
      const endWk = weeks.find((w: any) => w.week_idx === p.end_week_idx);
      if (!startWk || !endWk) return null;
      // Phase end-week stretches through that week's Sunday.
      const endIso = addDays(endWk.week_start_iso, 6);
      return { label: String(p.label).toUpperCase(), start_iso: startWk.week_start_iso, end_iso: endIso };
    }).filter(Boolean) as PhaseRange[];
  }

  function phaseFor(iso: string): string | null {
    for (const p of phaseRanges) {
      if (iso >= p.start_iso && iso <= p.end_iso) return p.label;
    }
    return null;
  }

  const rawRuns: LogRun[] = rows.map((r: any) => {
    const a = r.data;
    const date = a.date || (a.startLocal ?? '').slice(0, 10);
    const sPerMi = Number(a.paceSPerMi) || null;
    const activityType: string | null = a.type ?? null;
    // workoutType: plan-assigned type wins, then activity type, then null.
    const planType = date ? (planWorkoutByDate.get(date) ?? null) : null;
    const workoutType = planType ?? activityType;
    // shoe: only set when both brand + model present
    const shoeName = r.shoe_brand && r.shoe_model
      ? `${r.shoe_brand} ${r.shoe_model}`.trim()
      : null;
    const shoeSlug = shoeName ? shoeSlugify(shoeName) : null;
    return {
      id: a.id ?? a.activityId ?? `${date}-${Number(a.distanceMi).toFixed(2)}`,
      date,
      dow: date ? dowOf(date) : 0,
      start_local: a.startLocal ?? null,
      name: a.name ?? 'Run',
      source: a.source ?? 'strava',
      type: activityType,
      distance_mi: Number(a.distanceMi) || 0,
      pace: a.avgPaceMinPerMi || fmtPaceFromSec(sPerMi) || null,
      time_moving: fmtDuration(Number(a.movingTimeS) || null),
      avg_hr: Number(a.avgHr) || null,
      max_hr: Number(a.maxHr) || null,
      cadence: Number(a.avgCadence) || null,
      elev_gain_ft: Number(a.elevGainFt) || null,
      workoutType,
      phaseLabel: date ? phaseFor(date) : null,
      shoeName,
      shoeSlug,
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
  const allRuns = [...bestByKey.values()].sort((a, b) => b.date.localeCompare(a.date));

  // Axes from the UNFILTERED set — chips only render for values that actually
  // appear, so we don't show CROSS when the runner has zero cross-trains.
  const sourcesSet = new Set<string>();
  const typesSet = new Set<string>();
  const phasesSet = new Set<string>();
  const shoeAgg = new Map<string, { name: string; runs: number }>();
  for (const r of allRuns) {
    if (r.source) sourcesSet.add(r.source);
    if (r.workoutType) typesSet.add(r.workoutType.toLowerCase());
    if (r.phaseLabel) phasesSet.add(r.phaseLabel.toUpperCase());
    if (r.shoeSlug && r.shoeName) {
      const cur = shoeAgg.get(r.shoeSlug);
      if (cur) cur.runs += 1;
      else shoeAgg.set(r.shoeSlug, { name: r.shoeName, runs: 1 });
    }
  }
  const axes: LogFilterAxes = {
    sources: [...sourcesSet].sort(),
    types: [...typesSet].sort(),
    phases: [...phasesSet].sort(),
    shoes: [...shoeAgg.entries()]
      .map(([slug, v]) => ({ slug, name: v.name, runs: v.runs }))
      .sort((a, b) => b.runs - a.runs),
  };

  // Apply filters (all compose with AND).
  const runs = allRuns.filter((r) => {
    if (filters.source && r.source !== filters.source) return false;
    if (filters.type && (r.workoutType ?? '').toLowerCase() !== filters.type) return false;
    if (filters.phase && (r.phaseLabel ?? '').toUpperCase() !== filters.phase) return false;
    if (filters.shoe && r.shoeSlug !== filters.shoe) return false;
    return true;
  });

  // Group by Monday-of-week (filtered set)
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
        runs: ws.sort((a, b) => b.date.localeCompare(a.date)), // newest day first within the week
        isCurrent,
      };
    });

  const totalMi = Math.round(runs.reduce((s, r) => s + r.distance_mi, 0) * 10) / 10;
  const totalMiUnfiltered = Math.round(allRuns.reduce((s, r) => s + r.distance_mi, 0) * 10) / 10;
  return {
    today,
    totalRuns: runs.length,
    totalMi,
    totalRunsUnfiltered: allRuns.length,
    totalMiUnfiltered,
    weeks,
    axes,
    filters,
  };
}
