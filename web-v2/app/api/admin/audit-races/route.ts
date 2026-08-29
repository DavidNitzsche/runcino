/**
 * GET /api/admin/audit-races
 *
 * READ-ONLY diagnostic for CLAUDE.md's "Race-data source-of-truth" checklist
 * (locked 2026-05-19). Surfaces, for the calling runner, every `races` row's
 * curation status and every race-flagged `runs` row, plus any divergence
 * between a curated chip time and what the linked run's raw data shows.
 *
 * PORT-1 (2026-08-29) · this route used to live at
 * `legacy/web/app/api/admin/audit-races/route.ts`, against that app's
 * single-tenant `races`/`strava_activities` schema. `legacy/web` is retired
 * (see root package.json's build script and railway.json — only web-v2
 * builds/deploys), so CLAUDE.md's citation of that path pointed at a route
 * nothing on the live app can reach. This is the same diagnostic re-derived
 * against web-v2's live, multi-tenant schema:
 *
 *   · `races`   gained `user_uuid`; `actual_result` and `meta` are unchanged
 *     in shape (`lib/race/personal-records.ts`, `lib/race/retrospective.ts`).
 *   · `strava_activities` doesn't exist here — activity data lives in `runs`
 *     (`data` jsonb), and `canonicalLabel`/`canonicalFinishS` are present as
 *     keys but permanently null on every row (`lib/runs/run-shape.ts`
 *     `RunData.canonicalLabel` doc comment) — the auto-detected-best-effort
 *     mechanism that caused the phantom-5K bug was retired, not renamed.
 *     This route still reports them (always null) so a regression that
 *     starts populating them again is visible here first.
 *   · Race-flagged runs are resolved via `runWorkoutType()`, which already
 *     unifies the Strava-numeric-code and faff-semantic-string taxonomies —
 *     do not hand-roll a `workoutType = 1` check (see its doc comment).
 *
 * Same non-mutating, agent-built, self-execute posture as the other
 * `/api/admin/audit-*` routes (audit-weather, audit-coach-intents).
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireAdmin } from '@/lib/auth/session';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
import { runWorkoutType, runDaySql, runDay } from '@/lib/runs/run-shape';

export const dynamic = 'force-dynamic';

interface RaceRow {
  slug: string;
  meta: Record<string, unknown> | null;
  actual_result: Record<string, unknown> | null;
}

interface RunRow {
  id: string;
  data: Record<string, unknown>;
}

function fmtTime(s: number | null): string {
  if (s == null || !isFinite(s)) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const [races, runs] = await Promise.all([
    pool.query<RaceRow>(
      `SELECT slug, meta, actual_result FROM races WHERE user_uuid = $1 ORDER BY meta->>'date' DESC`,
      [userId],
    ).then((r) => r.rows),
    pool.query<RunRow>(
      `SELECT id::text AS id, data FROM runs
        WHERE user_uuid = $1 AND ${CANONICAL_ROW_SQL}
        ORDER BY ${runDaySql()} DESC NULLS LAST`,
      [userId],
    ).then((r) => r.rows),
  ]);

  // Curation flags per races row — races.actual_result is rung 1 (Rule §2).
  const racesReport = races.map((r) => {
    const ar = r.actual_result as { finishS?: number; source?: string; runId?: string } | null;
    const finishS = ar?.finishS != null ? Number(ar.finishS) : null;
    let flag: 'no-curated-result' | 'strava-auto-verify' | 'manual-curated' = 'no-curated-result';
    if (finishS != null) flag = ar?.source === 'strava' ? 'strava-auto-verify' : 'manual-curated';
    return {
      slug: r.slug,
      name: (r.meta as any)?.name ?? null,
      date: (r.meta as any)?.date ?? null,
      distanceMi: (r.meta as any)?.distanceMi != null ? Number((r.meta as any).distanceMi) : null,
      actualFinishS: finishS,
      actualFinishDisplay: fmtTime(finishS),
      source: ar?.source ?? null,
      linkedRunId: ar?.runId ?? null,
      flag,
    };
  });

  // Rule §4 · report canonicalLabel/canonicalFinishS presence WITHOUT ever
  // treating either as a race result — this section exists purely to catch
  // a future regression where something starts populating them again.
  const raceFlaggedRuns = runs
    .map((row) => {
      const d = row.data;
      const wt = runWorkoutType(d as any);
      return { row, d, wt };
    })
    .filter(({ wt, d }) => wt.semantic === 'race' || (d as any).canonicalLabel != null)
    .map(({ row, d, wt }) => {
      const distanceMi = (d as any).distanceMi != null ? Number((d as any).distanceMi) : null;
      const movingTimeS = (d as any).movingTimeS != null ? Number((d as any).movingTimeS) : null;
      const match = races.find((r) => {
        const rDate = (r.meta as any)?.date;
        const rDistanceMi = (r.meta as any)?.distanceMi != null ? Number((r.meta as any).distanceMi) : null;
        const runDate = runDay(d as any);
        if (!rDate || rDate !== runDate) return false;
        if (rDistanceMi == null || distanceMi == null) return false;
        return Math.abs(rDistanceMi - distanceMi) / distanceMi < 0.05;
      });
      return {
        runId: row.id,
        date: (d as any).startLocal ?? null,
        name: (d as any).name ?? null,
        distanceMi,
        workoutTypeRaw: wt.raw,
        workoutTypeEra: wt.era,
        canonicalLabel: (d as any).canonicalLabel ?? null,
        canonicalFinishS: (d as any).canonicalFinishS ?? null,
        movingTimeS,
        movingTimeDisplay: fmtTime(movingTimeS),
        linkedRacesSlug: match?.slug ?? null,
        flag: match ? 'linked' : 'orphan-run-no-races-row',
      };
    });

  // Rule §3 · a races row whose actual_result carries source:'strava' is a
  // provisional/unverified chip time — flag any large gap against the run
  // it was populated from, same as the legacy divergence report.
  const divergences: Array<{
    slug: string;
    curatedFinishS: number;
    runFinishS: number;
    deltaSeconds: number;
    curatedDisplay: string;
    runDisplay: string;
  }> = [];
  for (const r of races) {
    const ar = r.actual_result as { finishS?: number; runId?: string } | null;
    if (ar?.finishS == null || !ar.runId) continue;
    const run = runs.find((rr) => rr.id === ar.runId);
    if (!run) continue;
    const runFinishS = (run.data as any).movingTimeS != null ? Number((run.data as any).movingTimeS) : null;
    if (runFinishS == null) continue;
    const delta = Number(ar.finishS) - runFinishS;
    if (Math.abs(delta) < 2) continue;
    divergences.push({
      slug: r.slug,
      curatedFinishS: Number(ar.finishS),
      runFinishS,
      deltaSeconds: delta,
      curatedDisplay: fmtTime(Number(ar.finishS)),
      runDisplay: fmtTime(runFinishS),
    });
  }

  return NextResponse.json({
    userId,
    summary: {
      racesTotal: races.length,
      needCuration: racesReport.filter((r) => r.flag === 'no-curated-result').length,
      manualCurated: racesReport.filter((r) => r.flag === 'manual-curated').length,
      orphanRaceFlaggedRuns: raceFlaggedRuns.filter((r) => r.flag === 'orphan-run-no-races-row').length,
      canonicalLabelPopulatedCount: raceFlaggedRuns.filter((r) => r.canonicalLabel != null).length,
      divergencesFound: divergences.length,
    },
    races: racesReport,
    raceFlaggedRuns,
    divergences,
    legend: {
      'no-curated-result': 'races row has no actual_result.finishS · enter chip time via the race editor',
      'strava-auto-verify': "races row's actual_result.source is 'strava' · confirm it matches official chip time",
      'manual-curated': 'races row carries a runner-entered chip time (authoritative, provisional:false)',
      'orphan-run-no-races-row': 'a race-flagged run has no matching races row',
      'linked': 'race-flagged run matched to a races row by date + distance',
      canonicalLabelPopulatedCount:
        'MUST be 0 · canonicalLabel/canonicalFinishS are retired and should never be non-null. Non-zero here means the auto-detected best-effort mechanism is back and something needs to keep refusing to read it as a race result (CLAUDE.md §Race-data source-of-truth, rule 4).',
    },
  });
}
