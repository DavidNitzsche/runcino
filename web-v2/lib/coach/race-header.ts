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
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
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
 * estimates from recent quality runs. Uses the canonical shared loader
 * so fixes to the race/run query propagate here automatically (B2).
 *
 * `asOfDate` is today by default; pass a past ISO date to compute the VDOT
 * as it would have been at that point — used for projectionTrend.
 *
 * Throws on DB error; call sites use .catch(() => null) for graceful header
 * degradation.
 */
async function loadCurrentVdot(userId: string, today: string, asOfDate?: string): Promise<number | null> {
  const asOf = asOfDate ?? today;
  const { raceCandidates, runCandidates } = await loadVdotInputs(userId, asOf);
  const { best } = bestRecentVdot(raceCandidates, asOf, 180, runCandidates);
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
    // 2026-06-05 · backend audit P0-6 fix · race meta lookup MUST be
    // user-scoped. races.slug is per-user, not globally unique · two
    // users with the same slug (e.g. "la-marathon-2026") got the wrong
    // row, bleeding goal + distance + date into the wrong runner's
    // RaceHeader. Cite docs/2026-06-05-backend-audit.html § P0-6.
    const raceMeta = await pool
      .query(`SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2`,
        [planRow.race_id, userId])
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

  // PROJ · plan-trusts-itself doctrine (2026-06-04 · David's call).
  // Old behavior · projection = predictRaceTime(currentVdot, distance) ·
  // backward-looking · froze at last race result without a tune-up race.
  // New behavior · projection = goal UNLESS drift signals fire ·
  // forward-looking · "the plan is the path until it isn't."
  //
  // VDOT still calculated · feeds the OFF TRACK fallback projection AND
  // the diagnostic chips on the page (so the runner can see the engine's
  // raw read alongside the plan-trusted projection).
  let projSec: number | null = null;
  let projLabel: string | null = null;
  let currentVdot: number | null = null;
  let projectionGoalStatus: 'on-track' | 'watching' | 'off-track' | null = null;
  if (raceDistanceMi) {
    currentVdot = await loadCurrentVdot(userId, today).catch(() => null);
    const goalSecForProj = parseRaceTime(goalLabel);
    if (goalSecForProj != null) {
      const { computeGoalProjection } = await import('@/lib/training/goal-projection');
      const goalProj = await computeGoalProjection({
        userUuid: userId,
        goalSec: goalSecForProj,
        raceDistanceMi,
        vdot: currentVdot,
      }).catch(() => null);
      if (goalProj) {
        projSec = goalProj.projectionSec;
        projLabel = formatRaceTime(projSec);
        projectionGoalStatus = goalProj.status;
      }
    }
    // Fallback · no goal time or computeGoalProjection failed · old VDOT
    // path so cold-start runners still get a number.
    if (projSec == null && currentVdot != null) {
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
