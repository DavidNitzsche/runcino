/**
 * lib/runs/post-write-hooks.ts · run-write side-effects.
 *
 * Single chokepoint for everything that fires AFTER a run lands in
 * `runs`. Today's hook:
 *   · auto-fire calibration completion when an in_progress session
 *     exists (lib/coach/calibration.ts)
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

  return { calibration, reason };
}
