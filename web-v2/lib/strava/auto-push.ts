/**
 * lib/strava/auto-push.ts · shared hook for "push every new run to Strava"
 * when the runner has opted in.
 *
 * Every ingest path that lands a canonical run row should call
 * `maybeAutoPush(userId, runId)` once the row is committed. The helper
 * reads `profile.strava_auto_push` and fires `pushRunToStrava` in the
 * background when true. Fire-and-forget · auto-push is a nice-to-have,
 * not a critical path · failures are logged but never block the ingest
 * response.
 *
 * Three ingest callers:
 *   · /api/ingest/workout         · HK + Apple Watch push path
 *   · /api/watch/workouts/complete · Faff watch app push path
 *   · /api/run/manual             · runner-entered manual run
 *
 * The push itself is idempotent on (user_uuid, run_id) so a re-ingest
 * doesn't double-upload to Strava. See lib/strava/push.ts.
 */
import { pool } from '@/lib/db/pool';

/**
 * Auto-push a freshly-ingested run to Strava when the runner opted in.
 *
 * Returns immediately · the actual upload runs in the background. The
 * caller never has to await this · the void promise is intentional.
 * Reads `profile.strava_auto_push`. False / null = no-op.
 *
 * Logs failures to console.error so they show in Railway logs. The
 * runner doesn't see push failures · they'd see a missing activity
 * on Strava, which is the right signal anyway (we can't pretend to
 * have pushed when we didn't).
 */
export function maybeAutoPush(userId: string, runId: string): void {
  void (async () => {
    try {
      const row = (await pool.query<{ strava_auto_push: boolean | null }>(
        `SELECT strava_auto_push FROM profile WHERE user_uuid = $1`,
        [userId],
      )).rows[0];
      if (!row?.strava_auto_push) return;
      const { pushRunToStrava } = await import('@/lib/strava/push');
      await pushRunToStrava(userId, runId).catch((e) => {
        console.error('[auto-push]', { userId, runId, err: e?.message?.slice(0, 200) });
      });
    } catch (e: any) {
      console.error('[auto-push prefs read failed]', { userId, runId, err: e?.message?.slice(0, 200) });
    }
  })();
}
