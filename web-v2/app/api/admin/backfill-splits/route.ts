/**
 * POST /api/admin/backfill-splits?days=14
 *
 * Repairs watch-source canonical runs that landed with no splits
 * because the watch endpoint wasn't deriving splits from paceSamples.
 *
 * 2026-06-06 · Root cause: watch sends 5-sec {distMi, tSec} samples
 * per phase but the server wasn't walking them.  iPhone HK was the
 * intended source but its reconciliation guard dropped splits on every
 * run from 2026-05-29 onward (trailing-fraction bug, fixed c2f27151).
 * Fix: deriveSplitsFromPaceSamples now runs at watch ingest.  This
 * endpoint backfills the N days of runs that landed before the fix.
 *
 * Algorithm:
 *   1. Find watch-source canonical rows (no mergedIntoId) with empty
 *      or missing splits, within the last `days` days.
 *   2. For each, find the matching coach_intents row via workoutId.
 *   3. Reconstruct the body JSON (stored char-by-char in coach_intents
 *      when the value column received a plain string — see note below).
 *   4. Run deriveSplitsFromPaceSamples on the phases.
 *   5. If we get ≥1 mile, UPDATE runs SET data = jsonb_set(...) on
 *      the canonical row.
 *
 * Note on char-by-char storage: coach_intents.value is jsonb.  When
 * the watch endpoint writes `value = body` (a JS object), pg serializes
 * it correctly as a jsonb object.  But historical rows where the body
 * was JSON.stringify'd and stored as a string ended up stored as a
 * jsonb array of single characters.  This endpoint handles both shapes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { pool } from '@/lib/db/pool';

// Re-export the deriveSplitsFromPaceSamples logic inline so this
// endpoint doesn't have to import from the watch completion route.
function deriveSplitsFromPaceSamples(
  phases: any[]
): Array<{ mile: number; pace: string; hr: number | null; paceSecPerMi: number }> | null {
  if (!Array.isArray(phases) || phases.length === 0) return null;

  interface FlatSample { tSec: number; distMi: number; bpm: number | null }
  const flat: FlatSample[] = [];
  let distOffset = 0;
  let tOffset = 0;

  for (const phase of phases) {
    const ps: any[] = phase.paceSamples ?? [];
    const hs: any[] = phase.hrSamples ?? [];
    if (ps.length === 0) {
      distOffset += Number(phase.actualDistanceMi ?? 0);
      tOffset += Number(phase.actualDurationSec ?? 0);
      continue;
    }
    const hrByT = new Map<number, number>();
    for (const h of hs) { if (h.bpm != null && h.bpm > 0) hrByT.set(h.tSec, h.bpm); }
    for (const s of ps) {
      if (s.distMi == null) continue;
      flat.push({ tSec: s.tSec + tOffset, distMi: s.distMi + distOffset, bpm: hrByT.get(s.tSec) ?? null });
    }
    distOffset += Number(phase.actualDistanceMi ?? (ps[ps.length - 1]?.distMi ?? 0));
    tOffset += Number(phase.actualDurationSec ?? (ps[ps.length - 1]?.tSec ?? 0));
  }

  if (flat.length < 2) return null;
  flat.sort((a, b) => a.tSec - b.tSec);

  const splits: Array<{ mile: number; pace: string; hr: number | null; paceSecPerMi: number }> = [];
  let mileNo = 1;
  let prevCrossT = 0;

  for (let i = 1; i < flat.length; i++) {
    const prev = flat[i - 1];
    const curr = flat[i];
    const span = curr.distMi - prev.distMi;
    if (span <= 0) continue;
    while (curr.distMi >= mileNo && prev.distMi < mileNo) {
      const frac = (mileNo - prev.distMi) / span;
      const crossT = prev.tSec + frac * (curr.tSec - prev.tSec);
      const elapsedSec = Math.round(crossT - prevCrossT);
      if (elapsedSec >= 120 && elapsedSec <= 3600) {
        const windowSamples = flat.filter(s => s.tSec >= prevCrossT && s.tSec <= crossT && s.bpm != null);
        const avgHr = windowSamples.length > 0
          ? Math.round(windowSamples.reduce((sum, s) => sum + (s.bpm!), 0) / windowSamples.length)
          : null;
        splits.push({
          mile: mileNo,
          pace: `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`,
          hr: avgHr,
          paceSecPerMi: elapsedSec,
        });
      }
      prevCrossT = crossT;
      mileNo++;
    }
  }
  return splits.length > 0 ? splits : null;
}

/** Parse the coach_intents value.
 *  coach_intents.value is a TEXT column (confirmed 2026-06-06).
 *  The pg driver returns text columns as JS strings — just JSON.parse.
 *  Guards: already-object (future schema change), null/empty. */
function reconstructBody(value: any): any | null {
  if (!value) return null;
  // Already an object (defensive — column is text today)
  if (typeof value === 'object') return value;
  // Normal path: text column → JSON string → parse
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const daysParam = req.nextUrl.searchParams.get('days');
  const days = Math.min(90, Math.max(1, Number(daysParam) || 14));

  // Find watch-source canonical rows with empty/missing splits
  const runs = (await pool.query<{
    id: string; date: string; dist_mi: number; client_workout_id: string;
  }>(
    `SELECT id::text AS id,
            (data->>'date') AS date,
            (data->>'distanceMi')::float AS dist_mi,
            (data->>'client_workout_id') AS client_workout_id
     FROM runs
     WHERE user_uuid = $1
       AND (data->>'source') = 'watch'
       AND (data->>'mergedIntoId') IS NULL
       AND (data->>'date')::date >= (CURRENT_DATE - $2 * INTERVAL '1 day')
       AND (data->'splits' IS NULL
            OR jsonb_array_length(data->'splits') = 0
            OR (jsonb_array_length(data->'splits') = 1
                AND (data->'splits'->0->>'pace') IS NULL
                AND (data->'splits'->0->>'paceSPerMi') IS NULL
                AND (data->'splits'->0->>'paceSecPerMi') IS NULL))
     ORDER BY (data->>'date') DESC`,
    [userId, days]
  )).rows;

  const results: Array<{ date: string; runId: string; dist: number; milesRecovered: number | null; status: string }> = [];

  for (const run of runs) {
    if (!run.client_workout_id) { results.push({ date: run.date, runId: run.id, dist: run.dist_mi, milesRecovered: null, status: 'no_workout_id' }); continue; }

    // Find the coach_intents row for this workout
    const ci = (await pool.query(
      `SELECT value FROM coach_intents
       WHERE user_uuid = $1
         AND field = $2
       ORDER BY id DESC LIMIT 1`,
      [userId, run.client_workout_id]
    )).rows[0];

    if (!ci) { results.push({ date: run.date, runId: run.id, dist: run.dist_mi, milesRecovered: null, status: 'no_coach_intent' }); continue; }

    const body = reconstructBody(ci.value);
    if (!body) { results.push({ date: run.date, runId: run.id, dist: run.dist_mi, milesRecovered: null, status: 'reconstruct_failed' }); continue; }

    const phases = body.phases ?? [];
    const splits = deriveSplitsFromPaceSamples(phases);

    if (!splits || splits.length === 0) {
      results.push({ date: run.date, runId: run.id, dist: run.dist_mi, milesRecovered: 0, status: 'no_splits_derived' });
      continue;
    }

    // Write splits onto the canonical run row
    await pool.query(
      `UPDATE runs
          SET data = jsonb_set(data, '{splits}', $1::jsonb)
        WHERE id = $2::BIGINT
          AND user_uuid = $3`,
      [JSON.stringify(splits), run.id, userId]
    );

    results.push({ date: run.date, runId: run.id, dist: run.dist_mi, milesRecovered: splits.length, status: 'ok' });
  }

  const fixed = results.filter(r => r.status === 'ok').length;
  return NextResponse.json({ ok: true, days, runsScanned: runs.length, fixed, results });
}
