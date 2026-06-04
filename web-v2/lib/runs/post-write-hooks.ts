/**
 * lib/runs/post-write-hooks.ts · run-write side-effects.
 *
 * Single chokepoint for everything that fires AFTER a run lands in
 * `runs`. Today's hooks:
 *   · auto-fire calibration completion when an in_progress session
 *     exists (lib/coach/calibration.ts)
 *   · GPS-derived elev gain enrichment when the device payload didn't
 *     carry one (Faff watch app + iPhone HK importer omit elev_gain_ft
 *     today · we sample the polyline against Open-Meteo's elevation
 *     API instead of leaving the cell as "NO DATA")
 *
 * Future hooks can land here without touching the 5 ingest sites:
 *   · Strava webhook         · app/api/strava/webhook/route.ts
 *   · Strava bulk pullSync   · lib/strava/pullSync.ts
 *   · Watch workout complete · app/api/watch/workouts/complete/route.ts
 *   · HK ingest              · app/api/ingest/workout/route.ts
 *   · Manual entry           · app/api/run/manual/route.ts
 *
 * All work is fire-and-forget · best-effort, never throws to caller.
 * Run-write success doesn't depend on this hook completing.
 *
 * Cite: designs/briefs/calibration-session.md § Build order step 4
 */

import { completeCalibrationSession } from '@/lib/coach/calibration';
import { pool } from '@/lib/db/pool';
import { elevFromPolyline } from './elev-from-gps';

export interface AfterRunWriteInput {
  userUuid: string;
  /** The run.data->>'id' just persisted. Required · we read the run
   *  back to compute calibration pillars from splits. */
  runId: string;
  /** Optional source hint · 'strava' | 'watch' | 'hk' | 'manual'. Used
   *  for telemetry; doesn't change behavior. */
  source?: string;
}

/**
 * Fire post-write hooks for a run. Safe to call from any ingest path.
 *
 * Returns a summary of what fired · useful for the ingest endpoint's
 * response payload (debugging). Never throws · errors are logged.
 */
export async function afterRunWrite(input: AfterRunWriteInput): Promise<{
  calibration: 'fired' | 'skipped' | 'failed';
  elev: 'fired' | 'skipped' | 'failed' | 'present';
  reason?: string;
}> {
  // 1. Calibration auto-fire
  let calibration: 'fired' | 'skipped' | 'failed' = 'skipped';
  let reason: string | undefined;
  try {
    const result = await completeCalibrationSession(input.userUuid, input.runId);
    if (result) {
      calibration = 'fired';
      reason = `pace ${result.calibratedEasyPaceSPerMi}s/mi · ±${result.bandSPerMi}s · ${result.qualified ? 'qualified' : 'wide-band'}`;
    } else {
      reason = 'run not usable · session stays in_progress';
    }
  } catch (e) {
    calibration = 'failed';
    reason = e instanceof Error ? e.message : String(e);
    console.error('[afterRunWrite] calibration auto-fire failed:',
      input.source ?? 'unknown', input.runId, reason);
  }

  // 2. GPS-derived elevation enrichment · only fires when the row was
  //    written WITHOUT an elev value AND has a routePolyline. Faff
  //    watch app + iPhone HK importer omit elev_gain_ft today, so the
  //    structured-workout path (today's tempo) and the HK path both
  //    land null. Strava-sourced rows already carry elev · skip.
  //    Best-effort · failure logs and continues; the run row stays
  //    null and the UI shows "NO DATA" honestly.
  const elev = await enrichElevIfMissing(input.userUuid, input.runId).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[afterRunWrite] elev enrich failed:', input.runId, msg);
    return 'failed' as const;
  });

  return { calibration, elev, reason };
}

/**
 * 2026-06-04 · GPS elev backfill. Reads the row, decides if enrichment
 * is needed, runs it, writes back. Returns one of:
 *   · 'present'  · row already had a non-null elevGainFt · no work
 *   · 'fired'    · computed + persisted a value
 *   · 'skipped'  · no polyline to work with · nothing we can do
 *   · 'failed'   · API or DB error · row left as-is
 *
 * Idempotent across retries · the {elevGainFt: null AND polyline} gate
 * means re-runs won't double-write. UPDATE includes a WHERE guard
 * that keeps any concurrent writes from being clobbered.
 */
async function enrichElevIfMissing(
  userUuid: string,
  runId: string,
): Promise<'present' | 'fired' | 'skipped' | 'failed'> {
  // runId is the BIGINT row id (the watch + HK + manual + strava
  // routes all pass `String(stableId)`), not the data->>'id' value
  // (which is the synthetic slug). Cast to BIGINT for the lookup.
  const row = (await pool.query(
    `SELECT data->>'elevGainFt' AS elev,
            data->>'elevGainSource' AS elev_src,
            data->>'routePolyline' AS poly
       FROM runs
      WHERE user_uuid = $1
        AND id = $2::BIGINT
      LIMIT 1`,
    [userUuid, runId],
  )).rows[0];
  if (!row) return 'skipped';

  // Skip when the row already has a credible elev. A '0' from a
  // treadmill run is also a legitimate value · don't recompute.
  const elev = row.elev != null ? Number(row.elev) : null;
  if (elev != null && isFinite(elev) && row.elev_src !== 'absent') {
    return 'present';
  }

  const poly = typeof row.poly === 'string' ? row.poly : null;
  if (!poly || poly.length < 20) return 'skipped';

  const result = await elevFromPolyline(poly);
  if (!result) return 'failed';

  // Idempotent UPDATE · only write when the row still has the
  // missing/absent state we read above. Prevents clobbering an
  // upstream write that landed in the meantime.
  await pool.query(
    `UPDATE runs
        SET data = jsonb_set(
              jsonb_set(data, '{elevGainFt}', to_jsonb($1::int)),
              '{elevGainSource}', to_jsonb($2::text)
            )
      WHERE user_uuid = $3
        AND id = $4::BIGINT
        AND (data->>'elevGainFt' IS NULL OR data->>'elevGainSource' = 'absent')`,
    [result.value, result.source, userUuid, runId],
  );
  return 'fired';
}
