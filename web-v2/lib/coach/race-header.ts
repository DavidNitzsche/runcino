/**
 * race-header.ts — the persistent race-bib header view-model.
 * Paper-overhaul 2026-05-29 (docs/DESIGN_OVERHAUL_2026-05-29.md §4).
 *
 * The header is the SPINE of the app: "here's what stands between you and the
 * finish line." It renders, stacked:
 *     FAFF                         ← wordmark (client)
 *     BERLIN MARATHON              ← raceName
 *     T-87 · GOAL 1:45 · PROJ 1:44:50 · ON TRACK ●
 *
 * Data honesty (Cardinal Rule #1 · facts only, never fabricate):
 *   · tMinus / raceName / goalLabel — real, straight from the plan + race row.
 *   · projLabel — a Daniels VDOT projection. Rendered ONLY when a current
 *     VDOT is derivable from real race history. Null otherwise. Never faked.
 *   · status — the deterministic readiness + ACWR (+ proj-vs-goal) composite.
 *     No LLM (Cardinal Rule #1).
 *
 * VDOT derivation mirrors the canonical pattern in lib/coach/profile-state.ts
 * (A/B races in the last 180d → meta.finishTime, else match a run → highest
 * VDOT). A future refactor should extract one shared `loadCurrentVdot`; until
 * then this is a faithful copy of the same method so projections agree.
 */
import { pool } from '@/lib/db/pool';
import {
  bestRecentVdot,
  parseRaceTime,
  predictRaceTime,
  formatRaceTime,
} from '@/lib/training/vdot';
import { loadNearestSnapshot } from '@/lib/training/projection-snapshots';
import { loadActivePlan } from '@/lib/plan/lookup';
import type { ReadinessBreakdown } from './readiness';

export type RaceHeaderStatus = 'on_track' | 'watch' | 'off';

/**
 * Projection trend — change in the projected finish time over a lookback
 * window. Computed by re-running the VDOT chain as of `today - lookbackDays`
 * and diffing against today's projection.
 *
 * deltaSec convention: current_projection_sec - past_projection_sec.
 *   - Negative → projection got faster (fitness improved) — render "↓".
 *   - Positive → projection slowed down — render "↑" with caution tone.
 *   - Zero / null → not enough data or no change.
 *
 * Null when there's no past anchor (cold-start runner, no data 30d ago).
 */
export interface ProjectionTrend {
  deltaSec: number;
  lookbackDays: number;
  pastVdot: number | null;     // for debugging + audit
  currentVdot: number | null;
}

export interface RaceHeader {
  mode: 'race' | 'goal' | 'base';
  raceName: string | null;
  tMinus: number | null;
  dateLabel: string | null;   // "SEP 21"
  phaseLabel: string | null;  // "BUILD"
  goalLabel: string | null;   // "1:45"
  projLabel: string | null;   // "1:44:50" · only when computable
  projectionTrend: ProjectionTrend | null;
  status: RaceHeaderStatus | null;
  statusLabel: string | null; // "ON TRACK"
  statusTone: 'green' | 'amber' | 'over' | 'none';
}

export interface RaceHeaderInputs {
  today: string;
  daysToARace: number | null;
  nextARaceName: string | null;
  phaseLabel: string | null;
  readiness: ReadinessBreakdown | null;
  loadAcwr: number | null;
}

function distFromLabel(label: string | null | undefined): number | null {
  const l = String(label ?? '').toLowerCase();
  if (l.includes('marathon') && !l.includes('half')) return 26.2;
  if (l.includes('half') || l.includes('21k')) return 13.1;
  if (l.includes('10k')) return 6.2;
  if (l.includes('5k')) return 3.1;
  return null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function dateLabelFrom(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

/**
 * Compose the ON TRACK / WATCH THIS / OFF TRACK status from real signals.
 * Worst signal wins. Documented mapping (DESIGN_OVERHAUL §10):
 *   readiness moderate → watch · pull-back → off
 *   ACWR spike (≥1.5) or detrain (<0.8) → watch
 *   proj > goal·1.08 → off · proj > goal·1.03 → watch
 */
function composeStatus(
  readiness: ReadinessBreakdown | null,
  acwr: number | null,
  projSec: number | null,
  goalSec: number | null,
): RaceHeaderStatus {
  let level = 0; // 0 green · 1 amber · 2 red
  if (readiness) {
    if (readiness.band === 'moderate') level = Math.max(level, 1);
    if (readiness.band === 'pull-back') level = Math.max(level, 2);
  }
  if (acwr != null) {
    if (acwr >= 1.5 || acwr < 0.8) level = Math.max(level, 1);
  }
  if (projSec && goalSec) {
    const ratio = projSec / goalSec;
    if (ratio > 1.08) level = Math.max(level, 2);
    else if (ratio > 1.03) level = Math.max(level, 1);
  }
  return level === 0 ? 'on_track' : level === 1 ? 'watch' : 'off';
}

const STATUS_META: Record<RaceHeaderStatus, { label: string; tone: 'green' | 'amber' | 'over' }> = {
  on_track: { label: 'ON TRACK', tone: 'green' },
  watch: { label: 'WATCH THIS', tone: 'amber' },
  off: { label: 'OFF TRACK', tone: 'over' },
};

/**
 * Pure, DB-free header builder from glance-only inputs. Used by the
 * /today simulator (persona mode), where the DB lookups in loadRaceHeader
 * would key off the REAL user and bleed David's goal/PROJ into a simulated
 * persona's bib. Goal + PROJ + date are omitted here (those need the real
 * plan + VDOT + race row); status still composes off the persona's
 * readiness + ACWR so the status dot is meaningful per fixture.
 */
export function buildGlanceOnlyHeader(input: RaceHeaderInputs): RaceHeader {
  const { daysToARace, nextARaceName, phaseLabel, readiness, loadAcwr } = input;
  if (daysToARace == null || !nextARaceName) {
    return {
      mode: 'base',
      raceName: null,
      tMinus: null,
      dateLabel: null,
      phaseLabel: phaseLabel ?? null,
      goalLabel: null,
      projLabel: null,
      projectionTrend: null,
      status: null,
      statusLabel: null,
      statusTone: 'none',
    };
  }
  const status = composeStatus(readiness, loadAcwr, null, null);
  const meta = STATUS_META[status];
  return {
    mode: 'race',
    raceName: nextARaceName.toUpperCase(),
    tMinus: daysToARace,
    dateLabel: null,
    phaseLabel: phaseLabel ?? null,
    goalLabel: null,
    projLabel: null,
    projectionTrend: null,
    status,
    statusLabel: meta.label,
    statusTone: meta.tone,
  };
}

/**
 * Derive current VDOT from real A/B race history + training-derived
 * estimates from recent quality runs. Source-of-truth ladder per
 * CLAUDE.md (locked 2026-05-19):
 *   1. races.actual_result.finishS — curated chip time (canonical)
 *   2. meta.finishTime — legacy stored time
 *   3. Strava match by date+distance — provisional fallback
 * Plus training-derived VDOT from runs in QUALITY_RUN_TYPES or HR≥80%MaxHR
 * (penalized -1 point so a real race always wins ties; see vdot.ts).
 *
 * `asOfDate` is today by default; pass a past ISO date to compute the VDOT
 * as it would have been at that point — used for projectionTrend.
 */
async function loadCurrentVdot(userId: string, today: string, asOfDate?: string): Promise<number | null> {
  const asOf = asOfDate ?? today;
  const raceRows = (await pool
    .query(
      `SELECT slug, meta, actual_result FROM races
        WHERE user_uuid = $1
          AND (meta->>'date')::date >= ($2::date - interval '180 days')::date
          AND (meta->>'date')::date < $2::date
          AND meta->>'priority' IN ('A', 'B')`,
      [userId, asOf],
    )
    .catch(() => ({ rows: [] }))).rows;

  const earliestDate = raceRows.length
    ? raceRows.reduce((min: string, r: { meta?: { date?: string } }) => {
        const d = r.meta?.date ?? '';
        return !min || (d && d < min) ? d : min;
      }, '')
    : '';

  const candidateRuns = earliestDate
    ? (await pool
        .query(
          `SELECT data FROM runs
            WHERE user_uuid = $1
              AND NOT (data ? 'mergedIntoId')
              AND (data->>'distanceMi')::numeric > 2.5
              AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= $2
              AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) <= $3`,
          [userId, earliestDate, asOf],
        )
        .catch(() => ({ rows: [] }))).rows
    : [];

  const candidates = raceRows.map((r: { slug: string; meta?: Record<string, unknown>; actual_result?: Record<string, unknown> }) => {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const ar = (r.actual_result ?? {}) as Record<string, unknown>;
    const distMi = m.distanceMi ? Number(m.distanceMi) : distFromLabel(m.distanceLabel as string);
    // Canonical ladder: actual_result.finishS → meta.finishTime → Strava match.
    let finishSec: number | null = ar.finishS != null ? Number(ar.finishS) : null;
    if (!finishSec) finishSec = parseRaceTime(m.finishTime as string);
    if (!finishSec && distMi && m.date) {
      let best: Record<string, unknown> | null = null;
      let bestScore = Infinity;
      for (const c of candidateRuns) {
        const d = c.data as Record<string, unknown>;
        const day = (d.date as string) || String(d.startLocal ?? '').slice(0, 10);
        if (!day) continue;
        const dayDelta = Math.abs(
          (Date.parse(day + 'T12:00:00Z') - Date.parse((m.date as string) + 'T12:00:00Z')) / 86400000,
        );
        if (dayDelta > 1) continue;
        const miDelta = Math.abs(Number(d.distanceMi) - distMi);
        if (miDelta > 2.0) continue;
        const score = dayDelta * 10 + miDelta;
        if (score < bestScore) { best = d; bestScore = score; }
      }
      if (best) finishSec = Number(best.movingTimeS) || Number(best.elapsedTimeS) || null;
    }
    return {
      slug: r.slug,
      name: (m.name as string) ?? r.slug,
      date: (m.date as string) ?? '',
      priority: ((m.priority as string) ?? null) as 'A' | 'B' | 'C' | null,
      distance_mi: distMi,
      finish_seconds: finishSec,
    };
  });

  // Training-derived VDOT — recent quality runs (last 60 days).
  // Excludes runs on race days: a race-effort attempt belongs in the races
  // ladder (counted as race when priority='A'/'B', explicitly excluded when
  // 'C'/'hilly-excluded'/'training-run'). Including the same effort here
  // would defeat the priority filter.
  const qualityCutoff = new Date(Date.parse(asOf + 'T12:00:00Z') - 60 * 86400000).toISOString().slice(0, 10);
  const recentRuns = (await pool.query(
    `SELECT
       sa.id::text AS id,
       COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) AS date,
       sa.data->>'workoutType' AS workout_type,
       (sa.data->>'distanceMi')::numeric AS distance_mi,
       (sa.data->>'movingTimeS')::numeric AS finish_seconds,
       (sa.data->>'avgHr')::numeric AS avg_hr
       FROM runs sa
      WHERE sa.user_uuid = $1
        AND NOT (sa.data ? 'mergedIntoId')
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) >= $2
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) < $3
        AND (sa.data->>'distanceMi')::numeric >= 4
        AND (sa.data->>'movingTimeS')::numeric > 60
        AND NOT EXISTS (
          SELECT 1 FROM races r
           WHERE r.user_uuid = $1
             AND ABS((r.meta->>'date')::date - COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))::date) <= 1
        )`,
    [userId, qualityCutoff, asOf]
  ).catch(() => ({ rows: [] }))).rows;

  const userMaxHr = (await pool.query(
    `SELECT COALESCE(max_hr_override, max_hr) AS m FROM users WHERE id = $1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0]?.m;
  const maxHrValue = userMaxHr != null ? Number(userMaxHr) : null;

  const runCandidates = recentRuns.map((r: { id: string; date: string; workout_type: string | null; distance_mi: string | null; finish_seconds: string | null; avg_hr: string | null }) => ({
    id: String(r.id),
    date: r.date,
    workout_type: r.workout_type,
    distance_mi: r.distance_mi != null ? Number(r.distance_mi) : null,
    finish_seconds: r.finish_seconds != null ? Number(r.finish_seconds) : null,
    avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
    max_hr: maxHrValue,
  }));

  const { best } = bestRecentVdot(candidates, asOf, 180, runCandidates);
  return best?.vdot ?? null;
}

/**
 * Build the race-bib header. Best-effort: every DB hit soft-fails to null so
 * /today never breaks on a header lookup. Pure-ish — DB access is contained
 * here; status math is deterministic.
 */
export async function loadRaceHeader(userId: string, input: RaceHeaderInputs): Promise<RaceHeader> {
  const { today, daysToARace, nextARaceName, phaseLabel, readiness, loadAcwr } = input;

  // No race anchored → base mode (phase only).
  if (daysToARace == null || !nextARaceName) {
    return {
      mode: 'base',
      raceName: null,
      tMinus: null,
      dateLabel: null,
      phaseLabel: phaseLabel ?? null,
      goalLabel: null,
      projLabel: null,
      projectionTrend: null,
      status: null,
      statusLabel: null,
      statusTone: 'none',
    };
  }

  // Active plan → race row (goal display + distance + date).
  // Memoized via loadActivePlan so this query is shared with the other
  // state-loaders that fire in parallel on /today + /races.
  const planRow = await loadActivePlan(userId).then((p) => p ? { race_id: p.race_id } : undefined);

  let goalLabel: string | null = null;
  let raceDistanceMi: number | null = null;
  let dateLabel: string | null = null;

  if (planRow?.race_id) {
    const raceMeta = await pool
      .query(`SELECT meta FROM races WHERE slug = $1`, [planRow.race_id])
      .then((r) => (r.rows[0]?.meta ?? null) as Record<string, unknown> | null)
      .catch(() => null);
    if (raceMeta) {
      goalLabel = (raceMeta.goalDisplay as string) ?? null;
      raceDistanceMi = raceMeta.distanceMi
        ? Number(raceMeta.distanceMi)
        : distFromLabel(raceMeta.distanceLabel as string);
      dateLabel = dateLabelFrom(raceMeta.date as string);
    }
  }

  // PROJ — only from real VDOT. Never fabricated.
  let projSec: number | null = null;
  let projLabel: string | null = null;
  let currentVdot: number | null = null;
  if (raceDistanceMi) {
    currentVdot = await loadCurrentVdot(userId, today).catch(() => null);
    if (currentVdot != null) {
      projSec = predictRaceTime(currentVdot, raceDistanceMi);
      projLabel = formatRaceTime(projSec);
    }
  }

  // Projection trend — projection as-of 30 days ago vs today's projection.
  // Read path: try projection_snapshots first (O(1) lookup), fall back to
  // live re-compute (180d window, O(1) Postgres query but heavier). Snapshot
  // table is populated by the daily cron at 00:30 local.
  // Returns null when there's no past anchor (cold-start, no data 30d ago)
  // or when the race distance is unknown.
  const TREND_LOOKBACK_DAYS = 30;
  let projectionTrend: ProjectionTrend | null = null;
  if (projSec != null && raceDistanceMi) {
    const pastDateISO = new Date(Date.parse(today + 'T12:00:00Z') - TREND_LOOKBACK_DAYS * 86400000)
      .toISOString().slice(0, 10);
    const snap = await loadNearestSnapshot(userId, pastDateISO, raceDistanceMi).catch(() => null);
    let pastVdot: number | null = snap?.vdot ?? null;
    let pastProjSec: number | null = snap?.projection_sec ?? null;
    if (pastVdot == null) {
      pastVdot = await loadCurrentVdot(userId, today, pastDateISO).catch(() => null);
      if (pastVdot != null) {
        pastProjSec = predictRaceTime(pastVdot, raceDistanceMi);
      }
    }
    if (pastVdot != null && pastProjSec != null) {
      projectionTrend = {
        deltaSec: projSec - pastProjSec,
        lookbackDays: TREND_LOOKBACK_DAYS,
        pastVdot,
        currentVdot,
      };
    }
  }

  const goalSec = parseRaceTime(goalLabel);
  const status = composeStatus(readiness, loadAcwr, projSec, goalSec);
  const meta = STATUS_META[status];

  return {
    mode: 'race',
    raceName: nextARaceName.toUpperCase(),
    tMinus: daysToARace,
    dateLabel,
    phaseLabel: phaseLabel ?? null,
    goalLabel,
    projLabel,
    projectionTrend,
    status,
    statusLabel: meta.label,
    statusTone: meta.tone,
  };
}
