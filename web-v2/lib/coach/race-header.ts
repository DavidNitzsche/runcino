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
import type { ReadinessBreakdown } from './readiness';

export type RaceHeaderStatus = 'on_track' | 'watch' | 'off';

export interface RaceHeader {
  mode: 'race' | 'goal' | 'base';
  raceName: string | null;
  tMinus: number | null;
  dateLabel: string | null;   // "SEP 21"
  phaseLabel: string | null;  // "BUILD"
  goalLabel: string | null;   // "1:45"
  projLabel: string | null;   // "1:44:50" — only when computable
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
    status,
    statusLabel: meta.label,
    statusTone: meta.tone,
  };
}

/** Derive current VDOT from real A/B race history (faithful to profile-state). */
async function loadCurrentVdot(userId: string, today: string): Promise<number | null> {
  const raceRows = (await pool
    .query(
      `SELECT slug, meta FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND (meta->>'date')::date >= ($2::date - interval '180 days')::date
          AND (meta->>'date')::date < $2::date
          AND meta->>'priority' IN ('A', 'B')`,
      [userId, today],
    )
    .catch(() => ({ rows: [] }))).rows;
  if (!raceRows.length) return null;

  const earliestDate = raceRows.reduce((min: string, r: { meta?: { date?: string } }) => {
    const d = r.meta?.date ?? '';
    return !min || (d && d < min) ? d : min;
  }, '');

  const candidateRuns = earliestDate
    ? (await pool
        .query(
          `SELECT data FROM strava_activities
            WHERE (user_uuid = $1 OR user_uuid IS NULL)
              AND NOT (data ? 'mergedIntoId')
              AND (data->>'distanceMi')::numeric > 2.5
              AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= $2
              AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) <= $3`,
          [userId, earliestDate, today],
        )
        .catch(() => ({ rows: [] }))).rows
    : [];

  const candidates = raceRows.map((r: { slug: string; meta?: Record<string, unknown> }) => {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const distMi = m.distanceMi ? Number(m.distanceMi) : distFromLabel(m.distanceLabel as string);
    let finishSec = parseRaceTime(m.finishTime as string);
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

  const { best } = bestRecentVdot(candidates, today, 180);
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
      status: null,
      statusLabel: null,
      statusTone: 'none',
    };
  }

  // Active plan → race row (goal display + distance + date).
  const planRow = await pool
    .query(
      `SELECT race_id FROM training_plans
        WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userId],
    )
    .then((r) => r.rows[0] as { race_id?: string } | undefined)
    .catch(() => undefined);

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
  if (raceDistanceMi) {
    const vdot = await loadCurrentVdot(userId, today).catch(() => null);
    if (vdot != null) {
      projSec = predictRaceTime(vdot, raceDistanceMi);
      projLabel = formatRaceTime(projSec);
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
    status,
    statusLabel: meta.label,
    statusTone: meta.tone,
  };
}
