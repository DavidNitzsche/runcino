/**
 * lib/race/auto-result.ts · auto-provisional race results.
 *
 * 2026-08-17 · race-lifecycle fixes. David's direction after AFC Half
 * (2026-08-16): the watch time IS the result unless a chip time later
 * overrides it. The manual result entry is buried; when it never
 * happens the whole post-race chain (VDOT recalc → plan archive →
 * next-block generation) never fires and TODAY reads "UNPLANNED" the
 * morning after a goal race.
 *
 * detectAndLogProvisionalResults(userId):
 *   For each of the user's races with meta date in [today-14d, today]
 *   and no result yet (no actual_result.finishS AND no curated
 *   meta.finishTime — a curated retro entry must never be demoted
 *   below a watch time, per the race-data source-of-truth lock):
 *     1. Find the matching canonical run — same date±1 / distance
 *        window matching races-state.ts uses for display, tightened
 *        for a WRITE: ±12% distance tolerance, tagged
 *        data->>'workoutType'='race' runs strongly preferred, and a
 *        race whose distance can't be resolved only matches a tagged
 *        race run.
 *     2. Write actual_result via a Rule 6 field-level jsonb merge with
 *        provenance: source:'watch_provisional', provisional:true,
 *        runId, avgHrBpm when present. meta.finishTime is NOT written
 *        (that key means "curated entry"; races-state's read ladder
 *        falls back to it as curated, so a provisional value there
 *        would launder the provenance).
 *     3. Run the shared post-result chain (projection snapshots + vdot
 *        intent + archive plan race_completed + next-plan generation).
 *        Full chain for A/B races only; a C race logs the result +
 *        snapshots but does not archive-and-rebuild a mid-block plan.
 *
 * Per-finding context filter (CLAUDE.md): the 14-day lookback is
 * deliberate. An old race row with no result is a historical data gap,
 * not a fresh finish — auto-firing plan regeneration off it would
 * archive the runner's current plan over stale history.
 *
 * Display doctrine: everything that reads actual_result.finishS for
 * DISPLAY must check actual_result.provisional and never label a
 * watch time as an authoritative chip time / PR. races-state.ts and
 * personal-records.ts carry the flag; WATCH_PROVISIONAL_FINISH_LABEL
 * is the render-ready caption.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { fmtFinish, runPostResultChain, type PostResultOutcome } from './result-chain';

/** How far back the detector looks for unresulted races. */
export const AUTO_RESULT_LOOKBACK_DAYS = 14;

export interface RunCandidate {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Pure matcher · pick the run that IS the race.
 *
 * Same shape as races-state.ts's display matcher (day ±1 for the known
 * startLocal→UTC drift; proportional distance window) with two
 * write-grade tightenings:
 *   · tolerance is 12% of race distance (floor 0.31 mi, cap 3.2 mi)
 *   · a run tagged workoutType='race' outranks any untagged run
 *   · when the race distance is unresolvable, only a tagged race run
 *     can match (we can't distance-verify an untagged candidate)
 */
export function pickMatchingRaceRun(
  raceDateISO: string,
  raceDistanceMi: number | null,
  candidates: RunCandidate[],
): RunCandidate | null {
  if (!raceDateISO) return null;
  const raceMs = Date.parse(raceDateISO + 'T12:00:00Z');
  if (!Number.isFinite(raceMs)) return null;
  const miTolerance = raceDistanceMi != null
    ? Math.min(3.2, Math.max(0.31, raceDistanceMi * 0.12))
    : null;

  let best: RunCandidate | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = c.data ?? {};
    const day = (typeof d.date === 'string' && d.date)
      ? d.date
      : (typeof d.startLocal === 'string' ? d.startLocal.slice(0, 10) : '');
    if (!day) continue;
    const dayMs = Date.parse(day + 'T12:00:00Z');
    if (!Number.isFinite(dayMs)) continue;
    const dayDelta = Math.abs((dayMs - raceMs) / 86400000);
    if (dayDelta > 1) continue;

    const isTaggedRace = String(d.workoutType ?? '').toLowerCase() === 'race'
      || String(d.type ?? '').toLowerCase() === 'race';

    const mi = Number(d.distanceMi);
    if (raceDistanceMi != null) {
      if (!Number.isFinite(mi)) continue;
      const miDelta = Math.abs(mi - raceDistanceMi);
      if (miTolerance != null && miDelta > miTolerance) continue;
      // Lower score = better. Tagged race runs win outright (-100 clears
      // any in-window day/distance penalty, max 10+3.2).
      const score = dayDelta * 10 + miDelta - (isTaggedRace ? 100 : 0);
      if (score < bestScore) { best = c; bestScore = score; }
    } else {
      // Unresolvable race distance → tagged race runs only.
      if (!isTaggedRace) continue;
      const score = dayDelta * 10 - 100;
      if (score < bestScore) { best = c; bestScore = score; }
    }
  }
  return best;
}

/**
 * Pure patch builder · the fields the detector merges into
 * actual_result. Carries ONLY the keys it means to set (Rule 6: the
 * jsonb || merge preserves everything else). A later manual chip entry
 * (result-chain.manualResultPatch) overwrites finishS/finishDisplay,
 * flips provisional:false / source:'manual', and leaves runId as
 * provenance of the originally matched run.
 */
export function provisionalResultPatch(run: RunCandidate): {
  finishS: number;
  finishDisplay: string;
  source: 'watch_provisional';
  provisional: true;
  runId: string;
  avgHrBpm?: number;
} | null {
  const d = run.data ?? {};
  // Moving-time COALESCE ladder — same order races-state.ts uses:
  // movingTimeS (pullSync/watch/HK) → movingSec (webhook) → elapsedTimeS.
  const secs = Number(d.movingTimeS) || Number(d.movingSec) || Number(d.elapsedTimeS) || null;
  if (!secs || secs <= 0) return null;
  const avgHr = Number(d.avgHr) || null;
  return {
    finishS: Math.round(secs),
    finishDisplay: fmtFinish(secs),
    source: 'watch_provisional',
    provisional: true,
    runId: run.id,
    ...(avgHr != null ? { avgHrBpm: avgHr } : {}),
  };
}

export interface AutoResultOutcome {
  slug: string;
  name: string;
  dateISO: string;
  priority: string | null;
  finishS: number;
  finishDisplay: string;
  runId: string;
  chain: PostResultOutcome;
}

/**
 * Detect and log provisional results for every recent unresulted race.
 * Idempotent: the UPDATE is guarded on "still no finishS", so a second
 * cron tick (or a manual entry landing mid-run) is a no-op.
 */
export async function detectAndLogProvisionalResults(userId: string): Promise<AutoResultOutcome[]> {
  const today = await runnerToday(userId);

  const races = (await pool.query<{ slug: string; meta: Record<string, unknown> | null }>(
    `SELECT slug, meta FROM races
      WHERE user_uuid = $1
        AND meta->>'date' IS NOT NULL
        AND (meta->>'date')::date <= $2::date
        AND (meta->>'date')::date >= $2::date - make_interval(days => $3::int)
        AND (actual_result IS NULL OR NOT (actual_result ? 'finishS'))
        AND meta->>'finishTime' IS NULL
      ORDER BY (meta->>'date')::date DESC`,
    [userId, today, AUTO_RESULT_LOOKBACK_DAYS],
  ).catch(() => ({ rows: [] }))).rows;
  if (races.length === 0) return [];

  const outcomes: AutoResultOutcome[] = [];
  for (const race of races) {
    const m = (race.meta ?? {}) as Record<string, unknown>;
    const dateISO = String(m.date ?? '');
    if (!dateISO) continue;
    const distanceMi = m.distanceMi
      ? Number(m.distanceMi)
      : distanceMiFromLabel((m.distanceLabel as string) ?? null);

    // Canonical runs within ±1 day of the race date. Same candidate
    // gates as races-state.ts: no merged losers, > 2.5 mi.
    const candidates = (await pool.query<{ id: string; data: Record<string, unknown> }>(
      `SELECT id::text AS id, data FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'distanceMi')::numeric > 2.5
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))
              BETWEEN ($2::date - interval '1 day')::date::text
                  AND ($2::date + interval '1 day')::date::text`,
      [userId, dateISO],
    ).catch(() => ({ rows: [] }))).rows;

    const match = pickMatchingRaceRun(dateISO, distanceMi, candidates);
    if (!match) continue;
    const patch = provisionalResultPatch(match);
    if (!patch) continue;

    // Rule 6 field-level merge · guarded so a result that landed between
    // the SELECT and now (manual entry, second cron) is never clobbered.
    const w = await pool.query(
      `UPDATE races SET
         actual_result = COALESCE(actual_result, '{}'::jsonb) || $3::jsonb
       WHERE slug = $1 AND user_uuid = $2
         AND (actual_result IS NULL OR NOT (actual_result ? 'finishS'))
         AND meta->>'finishTime' IS NULL`,
      [race.slug, userId, JSON.stringify(patch)],
    ).catch(() => ({ rowCount: 0 }));
    if ((w.rowCount ?? 0) === 0) continue;

    const priority = typeof m.priority === 'string' ? m.priority : null;
    const chain = await runPostResultChain({
      userId,
      raceSlug: race.slug,
      raceDateISO: dateISO,
      distanceMi,
      finishS: patch.finishS,
      // Full chain (archive + next-plan generation) for goal races only.
      regeneratePlan: priority === 'A' || priority === 'B',
    });

    outcomes.push({
      slug: race.slug,
      name: String(m.name ?? race.slug),
      dateISO,
      priority,
      finishS: patch.finishS,
      finishDisplay: patch.finishDisplay,
      runId: patch.runId,
      chain,
    });
  }
  return outcomes;
}
