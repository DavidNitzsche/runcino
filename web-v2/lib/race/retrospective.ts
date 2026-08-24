/**
 * lib/race/retrospective.ts · server-side builder for the post-race story.
 *
 * Composes everything the web race retrospective renders:
 *   · the resolved finish (chip / watch-provisional / run-match) with honest
 *     provenance labels per the CLAUDE.md race-data source-of-truth lock
 *   · per-mile splits — races.actual_result.miles[] first (curated), the
 *     date+distance-matched watch run's splits as the labeled fallback
 *   · the course-phase plan (races.plan.phases with authored labels like
 *     "Point Loma Climb" / "The Drop" and target paces) and, per phase,
 *     the overlap-weighted ACTUAL pace + delta vs target
 *   · what the result means: VDOT from this race, projection before vs
 *     after (projection_snapshots), and the prediction it implies for the
 *     next A race vs that race's goal
 *
 * Race-data checklist (CLAUDE.md):
 *   1. Displays race results → yes.
 *   2. Reads races.actual_result first → yes (finish + miles ladder).
 *   3. Fallbacks labeled provisional → yes (finishProvisional +
 *      provisionalLabel ride through from races-state; watch-splits miles
 *      carry milesSource:'watch' so the UI captions them).
 *   4. Never reads strava_activities.canonicalLabel → correct, it doesn't.
 *
 * All queries are read-only and individually .catch-guarded — the retro is
 * additive; a missing table or column degrades a beat, never the page.
 */
import { pool } from '@/lib/db/pool';
import { vdotFromRace, predictRaceTime, parseRaceTime, formatRaceTime } from '@/lib/training/vdot';
import { buildRacePacing, type CourseGeometryInput } from '@/lib/race/pacing';
import type { RaceRow } from '@/lib/coach/races-state';

export interface RetroMile {
  mile: number;
  /** seconds per mile · null when the split was flagged unreliable */
  paceSPerMi: number | null;
  avgHr: number | null;
  elevDeltaFt: number | null;
}

export interface RetroPhase {
  label: string;
  startMi: number;
  endMi: number;
  targetSPerMi: number | null;
  targetDisplay: string | null;   // "7:01/mi"
  actualSPerMi: number | null;
  actualDisplay: string | null;   // "7:14/mi"
  /** actual − target, seconds per mile. Positive = slower than target. */
  deltaSPerMi: number | null;
  deltaDisplay: string | null;    // "+0:13" / "-0:05"
  status: 'on' | 'fast' | 'slow' | null;
  note: string | null;
}

export interface RaceRetro {
  finishS: number | null;
  finishDisplay: string | null;
  /** true when the shown finish is not a confirmed chip time */
  provisional: boolean;
  /** render-ready caption when provisional ("Watch time · confirm to lock in") */
  provisionalLabel: string | null;
  finishSource: 'actual_result' | 'meta' | 'run_match' | null;
  goalSec: number | null;
  goalDisplay: string | null;
  /** finish − goal, seconds. Positive = over goal. */
  gapS: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPaceSPerMi: number | null;
  distanceMi: number;
  miles: RetroMile[];
  milesSource: 'result' | 'watch' | null;
  phases: RetroPhase[];
  toleranceSPerMi: number;
  /** VDOT computed from this finish (Daniels, canonical lib). */
  vdotRace: number | null;
  /** Last pre-race snapshot VDOT at this distance (cron-daily). */
  vdotBefore: number | null;
  /** Pre-race projection at this distance, seconds. */
  projBeforeSec: number | null;
  /** Post-race projection: the race-result snapshot when logged, else
   *  computed from vdotRace. */
  projAfterSec: number | null;
  nextRace: {
    slug: string;
    name: string;
    date: string;
    distanceMi: number | null;
    goalSec: number | null;
    goalDisplay: string | null;
    /** what this race's fitness predicts at the next race's distance */
    predictedSec: number | null;
    weeksAway: number;
  } | null;
}

function fmtPace(sPerMi: number): string {
  const s = Math.round(sPerMi);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/mi`;
}

function fmtSignedSec(delta: number): string {
  const sign = delta < 0 ? '-' : '+';
  const a = Math.abs(Math.round(delta));
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse "7:09" pace text → seconds/mi. */
function paceTextToSec(t: unknown): number | null {
  if (typeof t !== 'string') return null;
  const parts = t.split(':').map((x) => parseInt(x, 10));
  if (parts.length !== 2 || parts.some((x) => !Number.isFinite(x))) return null;
  return parts[0] * 60 + parts[1];
}

/** Map actual_result.miles[] (Strava-shaped: paceSPerMi/avgHr/elevDeltaFt)
 *  or a watch run's splits[] (paceSecPerMi/hr, split-sanity `unreliable`)
 *  into the one RetroMile shape. */
function mapMiles(raw: unknown[]): RetroMile[] {
  return raw
    .map((m): RetroMile | null => {
      const r = m as Record<string, unknown>;
      const mile = num(r.mile);
      if (mile == null || mile <= 0) return null;
      const unreliable = r.unreliable === true;
      const pace = unreliable
        ? null
        : (num(r.paceSPerMi) ?? num(r.paceSecPerMi) ?? paceTextToSec(r.pace));
      return {
        mile,
        paceSPerMi: pace != null && pace > 0 ? pace : null,
        avgHr: num(r.avgHr) ?? num(r.hr),
        elevDeltaFt: num(r.elevDeltaFt) ?? num(r.elev_change_ft),
      };
    })
    .filter((m): m is RetroMile => m != null)
    .sort((a, b) => a.mile - b.mile);
}

/** Splits from the date+distance-matched run in the log (the watch file).
 *  Same match rule as races-state (±1 day, distance within 10%, floor
 *  0.31 mi, cap 2.0 mi) so the two surfaces agree on which run is "the race". */
async function loadMatchedRunSplits(
  userId: string,
  raceDate: string,
  targetMi: number | null,
): Promise<{ splits: unknown[]; avgHr: number | null; maxHr: number | null } | null> {
  const rows = (await pool.query<{ data: Record<string, unknown> }>(
    `SELECT data FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'distanceMi')::numeric > 2.5
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) BETWEEN $2 AND $3`,
    [userId, addDaysISO(raceDate, -1), addDaysISO(raceDate, 1)],
  ).catch(() => ({ rows: [] as Array<{ data: Record<string, unknown> }> }))).rows;

  const miTolerance = targetMi != null ? Math.min(2.0, Math.max(0.31, targetMi * 0.10)) : null;
  let best: Record<string, unknown> | null = null;
  let bestScore = Infinity;
  for (const row of rows) {
    const d = row.data;
    const day = (d.date as string) || String(d.startLocal ?? '').slice(0, 10);
    if (!day) continue;
    const dayDelta = Math.abs(
      (Date.parse(day + 'T12:00:00Z') - Date.parse(raceDate + 'T12:00:00Z')) / 86400000,
    );
    if (dayDelta > 1) continue;
    const mi = Number(d.distanceMi);
    const miDelta = targetMi != null ? Math.abs(mi - targetMi) : 0;
    if (miTolerance != null && miDelta > miTolerance) continue;
    const score = dayDelta * 10 + miDelta;
    if (score < bestScore) { best = d; bestScore = score; }
  }
  if (!best) return null;
  const splits = Array.isArray(best.splits) ? (best.splits as unknown[]) : [];
  if (splits.length < 2) return null;
  return { splits, avgHr: num(best.avgHr), maxHr: num(best.maxHr) };
}

function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}

/** Overlap-weighted actual pace across [startMi, endMi]. Mile i covers
 *  [i-1, i]; the final split stretches to the run's end so a 13.24-mi race
 *  with 13 splits still covers the Balboa finish. Returns null when reliable
 *  splits cover less than half the phase. */
function phaseActualPace(
  miles: RetroMile[],
  startMi: number,
  endMi: number,
  courseEndMi: number,
): number | null {
  if (miles.length === 0 || endMi <= startMi) return null;
  const lastMile = miles[miles.length - 1].mile;
  let weighted = 0;
  let covered = 0;
  for (const m of miles) {
    if (m.paceSPerMi == null) continue;
    const spanStart = m.mile - 1;
    const spanEnd = m.mile === lastMile ? Math.max(m.mile, courseEndMi) : m.mile;
    const lo = Math.max(spanStart, startMi);
    const hi = Math.min(spanEnd, endMi);
    if (hi <= lo) continue;
    weighted += (hi - lo) * m.paceSPerMi;
    covered += hi - lo;
  }
  if (covered < (endMi - startMi) * 0.5) return null;
  return weighted / covered;
}

interface PlanPhaseRow {
  label?: unknown; note?: unknown; start_mi?: unknown; end_mi?: unknown;
  target_pace_s_per_mi?: unknown; target_pace_display?: unknown;
}

export async function buildRaceRetro(args: {
  userId: string;
  race: RaceRow;
  /** next upcoming A race after this one (with its goal), if any */
  nextA: RaceRow | null;
  actualResult: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  /** course_library.geometry_json — target-pace fallback when races.plan
   *  has no phases (buildRacePacing distributes the goal over it) */
  libGeometry?: CourseGeometryInput | null;
  todayISO: string;
}): Promise<RaceRetro> {
  const { userId, race, nextA, actualResult, plan, libGeometry, todayISO } = args;
  const ar = (actualResult ?? {}) as Record<string, unknown>;

  /**
   * DELETED 2026-08-24 · the `plan.race.distance_mi` rung that used to sit
   * between these two.
   *
   * `races.plan.race` is a six-field snapshot of the race identity frozen at
   * the moment the LEGACY GPX planner ran (`legacy/web/lib/types.ts:136`).
   * Nothing in web-v2 has ever written it — every writer here either seeds
   * `plan` as `'{}'` or spreads it preserving only `goal` — so it is
   * write-once, and it has drifted: its `distance_mi` is the raw measured
   * GPX distance while `meta.distanceMi` is the canonical one, and its
   * `name` and `date` are not touched when the race is renamed or moved.
   *
   * It was UNREACHABLE AS A VALUE, and that is measured rather than
   * reasoned. Over production 2026-08-24 (`faff_readonly`, 18 races):
   *
   *     rows carrying plan.race.distance_mi ......... 7
   *     rows with meta.distanceMi missing ........... 3
   *     rows with BOTH — the only way here .......... 0
   *
   * The two sets cannot overlap by construction: the legacy planner writes
   * `meta.distanceMi` unconditionally on any row it gives a `plan.race` to
   * (`legacy/web/app/races/new/page.tsx:364`, and the field is required in
   * `legacy/web/lib/storage-types.ts:64`), so rung 1 always answers first.
   * Every evaluation of this rung returned undefined and fell through.
   *
   * WHAT REMAINS TRUE AND IS NOT FIXED HERE: rung 1 IS null on 3 of 18
   * rows — label-only races, `lib/race/distance.ts:78` documents the same
   * count — and each of those lands on the 13.1 default below. That default
   * is a half marathon's distance handed to a race of unknown length, and
   * it is now the single visible fallback rather than the third of three.
   * `distanceMiOfMeta` (lib/race/distance.ts:100) carries a `meta.name` rung
   * that would resolve some of them; wiring it changes what those rows
   * report, so it belongs to whoever owns the race surface, not here.
   */
  const distanceMi = race.distance_mi ?? 13.1;

  // ── Finish · provenance already resolved by races-state ────────────────
  const finishS = (num(ar.finishS) != null && Number(ar.finishS) > 0)
    ? Math.round(Number(ar.finishS))
    : (parseRaceTime(race.finishTime) ?? null);
  const finishDisplay = finishS != null ? formatRaceTime(finishS) : null;
  const goalSec = parseRaceTime(race.goal) ?? null;

  // ── Miles · actual_result.miles first, watch splits as labeled fallback ─
  let miles: RetroMile[] = [];
  let milesSource: RaceRetro['milesSource'] = null;
  // 2026-08-24 · READ BOTH SPELLINGS. `actual_result` stores race HR under two
  // key names and no row carries both: the two live writers
  // (result-chain.ts:manualResultPatch and auto-result.ts) both emit
  // `avgHrBpm`, while this reader only ever looked at `avgHr`. In production
  // that is 1 of the 4 HR-carrying races — Americas Finest City, 168 bpm,
  // confirmed by the runner — resolving null here and falling through to
  // `loadMatchedRunSplits` below, which substitutes a Strava-matched TRAINING
  // run's average HR, unlabelled. That is CLAUDE.md race-data question 3:
  // a Strava fallback shown where a curated value exists.
  //
  // `avgHrBpm` first because it is what both current writers emit; `avgHr` is
  // the legacy spelling on the three older rows.
  let avgHr = num(ar.avgHrBpm) ?? num(ar.avgHr);
  let maxHr = num(ar.maxHr);
  if (Array.isArray(ar.miles) && (ar.miles as unknown[]).length >= 2) {
    miles = mapMiles(ar.miles as unknown[]);
    milesSource = 'result';
  } else if (race.date) {
    const matched = await loadMatchedRunSplits(userId, race.date, distanceMi);
    if (matched) {
      miles = mapMiles(matched.splits);
      milesSource = miles.length >= 2 ? 'watch' : null;
      if (miles.length < 2) miles = [];
      avgHr = avgHr ?? matched.avgHr;
      maxHr = maxHr ?? matched.maxHr;
    }
  }

  // ── Phases · races.plan.phases (authored targets), lib-geometry fallback ─
  const tolerance = num((plan?.tolerance as Record<string, unknown> | undefined)?.pace_s_per_mi) ?? 10;
  let phaseRows: Array<{ label: string; startMi: number; endMi: number; targetSPerMi: number | null; targetDisplay: string | null; note: string | null }> = [];
  const rawPlanPhases = Array.isArray(plan?.phases) ? (plan?.phases as PlanPhaseRow[]) : [];
  for (const p of rawPlanPhases) {
    const s = num(p.start_mi); const e = num(p.end_mi);
    if (s == null || e == null || e <= s) continue;
    const tgt = num(p.target_pace_s_per_mi);
    phaseRows.push({
      label: typeof p.label === 'string' && p.label ? p.label : `${s}–${e} mi`,
      startMi: s,
      endMi: e,
      targetSPerMi: tgt,
      targetDisplay: typeof p.target_pace_display === 'string'
        ? p.target_pace_display
        : (tgt != null ? fmtPace(tgt) : null),
      note: typeof p.note === 'string' ? p.note : null,
    });
  }
  if (phaseRows.length === 0 && goalSec && libGeometry) {
    try {
      const pacing = buildRacePacing({ goalSec, distanceMi, geometry: libGeometry });
      if (pacing.phases) {
        phaseRows = pacing.phases.map((p) => ({
          label: p.label,
          startMi: p.start_mi,
          endMi: p.end_mi,
          targetSPerMi: p.pace_s_per_mi,
          targetDisplay: p.display,
          note: null,
        }));
      }
    } catch { /* additive — no phases beats a broken page */ }
  }
  phaseRows.sort((a, b) => a.startMi - b.startMi);
  const courseEndMi = phaseRows.length > 0
    ? Math.max(distanceMi, phaseRows[phaseRows.length - 1].endMi)
    : distanceMi;

  const phases: RetroPhase[] = phaseRows.map((p) => {
    const actual = phaseActualPace(miles, p.startMi, p.endMi, courseEndMi);
    const delta = actual != null && p.targetSPerMi != null ? actual - p.targetSPerMi : null;
    let status: RetroPhase['status'] = null;
    if (delta != null) {
      status = Math.abs(delta) <= tolerance ? 'on' : delta < 0 ? 'fast' : 'slow';
    }
    return {
      label: p.label,
      startMi: p.startMi,
      endMi: p.endMi,
      targetSPerMi: p.targetSPerMi,
      targetDisplay: p.targetDisplay,
      actualSPerMi: actual,
      actualDisplay: actual != null ? fmtPace(actual) : null,
      deltaSPerMi: delta,
      deltaDisplay: delta != null ? fmtSignedSec(delta) : null,
      status,
      note: p.note,
    };
  });

  // ── What it means · VDOT + projections ─────────────────────────────────
  const vdotRace = finishS != null ? vdotFromRace(finishS, distanceMi) : null;

  // Snapshots record standard distances (13.1 / 26.2), race meta can carry
  // the certified length (13.24) — match within a mile.
  let vdotBefore: number | null = null;
  let projBeforeSec: number | null = null;
  let projAfterSec: number | null = null;
  if (race.date) {
    const before = (await pool.query<{ vdot: number | null; projection_sec: number | null }>(
      `SELECT vdot::float AS vdot, projection_sec
         FROM projection_snapshots
        WHERE user_uuid = $1
          AND ABS(distance_mi - $2) <= 1.0
          AND snapshot_date <= $3::date
          AND source <> 'race-result'
        ORDER BY snapshot_date DESC LIMIT 1`,
      [userId, distanceMi, race.date],
    ).catch(() => ({ rows: [] }))).rows[0];
    vdotBefore = before?.vdot ?? null;
    projBeforeSec = before?.projection_sec != null ? Number(before.projection_sec) : null;

    const after = (await pool.query<{ projection_sec: number | null }>(
      `SELECT projection_sec
         FROM projection_snapshots
        WHERE user_uuid = $1
          AND ABS(distance_mi - $2) <= 1.0
          AND race_slug = $3
          AND source = 'race-result'
        ORDER BY snapshot_date DESC LIMIT 1`,
      [userId, distanceMi, race.slug],
    ).catch(() => ({ rows: [] }))).rows[0];
    projAfterSec = after?.projection_sec != null ? Number(after.projection_sec) : null;
  }
  if (projAfterSec == null && vdotRace != null) {
    projAfterSec = predictRaceTime(vdotRace, distanceMi);
  }

  // ── Next race · what this result predicts vs its goal ──────────────────
  let nextRace: RaceRetro['nextRace'] = null;
  if (nextA?.date) {
    const nextGoalSec = parseRaceTime(nextA.goal) ?? null;
    const anchorVdot = vdotRace ?? vdotBefore;
    const predictedSec = anchorVdot != null && nextA.distance_mi != null
      ? predictRaceTime(anchorVdot, nextA.distance_mi)
      : null;
    nextRace = {
      slug: nextA.slug,
      name: nextA.name,
      date: nextA.date,
      distanceMi: nextA.distance_mi,
      goalSec: nextGoalSec,
      goalDisplay: nextA.goal,
      predictedSec,
      weeksAway: Math.max(0, Math.round(
        (Date.parse(nextA.date + 'T12:00:00Z') - Date.parse(todayISO + 'T12:00:00Z')) / (7 * 86_400_000),
      )),
    };
  }

  return {
    finishS,
    finishDisplay,
    provisional: race.finishProvisional,
    provisionalLabel: race.finishProvisionalLabel,
    finishSource: race.finishSource,
    goalSec,
    goalDisplay: race.goal,
    gapS: finishS != null && goalSec != null ? finishS - goalSec : null,
    avgHr,
    maxHr,
    avgPaceSPerMi: finishS != null && distanceMi > 0 ? finishS / distanceMi : null,
    distanceMi,
    miles,
    milesSource,
    phases,
    toleranceSPerMi: tolerance,
    vdotRace,
    vdotBefore,
    projBeforeSec,
    projAfterSec,
    nextRace,
  };
}
