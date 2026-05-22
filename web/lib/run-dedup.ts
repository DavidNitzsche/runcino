/**
 * Run dedup — the foundation that lets multiple feed paths (watch completion,
 * watch direct-post, Apple Health import) write runs without ever creating a
 * duplicate.
 *
 * The dedup key is the RUN ITSELF — its start time (to the minute) — not the
 * source. So every internal path that sees the same run computes the same
 * id and converges to ONE row. A run that's also present from Strava is
 * skipped (Strava, the richer source, wins) via a start-time proximity check.
 *
 * Synthetic ids are NEGATIVE so they can never collide with a positive Strava
 * activity id.
 */

import { query } from './db';

export interface CanonicalRun {
  /** ISO datetime the run started (local or UTC — only the minute matters). */
  startISO: string;
  distanceMi: number;
  durationSec: number;
  avgHr?: number | null;
  maxHr?: number | null;
  name?: string;
  /** Coach type hint: 'easy' | 'long' | 'threshold' | 'race' | … */
  type?: string;
  /** Provenance tag stored on the row ('apple_health', 'watch', …). */
  source: string;
}

/** Stable negative BIGINT id keyed on user + start-minute. Same run from any
 *  internal path → same id → one row (idempotent upsert). */
export function canonicalRunId(userId: string, startISO: string): number {
  const minute = startISO.slice(0, 16); // YYYY-MM-DDTHH:MM
  const s = `${userId}@${minute}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return -(Math.abs(h) + 1);
}

/** Returns the id of an existing run for this user that started within
 *  ±toleranceMin of startISO, or null. Runs are 30+ min apart in practice,
 *  so a 15-min window only ever matches the SAME session (e.g. the Strava
 *  copy of a watch run), never two distinct runs. */
export async function findNearbyRunId(
  userId: string,
  startISO: string,
  toleranceMin = 15,
): Promise<number | null> {
  const startMs = Date.parse(startISO);
  if (!Number.isFinite(startMs)) return null;
  const day = startISO.slice(0, 10);
  const rows = await query<{ id: string; start: string | null }>(
    `SELECT id::text AS id, COALESCE(data->>'startLocal', data->>'date') AS start
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2`,
    [userId, day],
  ).catch(() => [] as { id: string; start: string | null }[]);
  for (const r of rows) {
    if (!r.start) continue;
    const ms = Date.parse(r.start.length === 10 ? `${r.start}T12:00:00Z` : r.start);
    if (Number.isFinite(ms) && Math.abs(ms - startMs) <= toleranceMin * 60_000) {
      return Number(r.id);
    }
  }
  return null;
}

/**
 * Write a run to strava_activities (the canonical runs table), de-duped:
 *   - same run from another internal path → same canonical id → idempotent upsert
 *   - a DIFFERENT run already within the time window (e.g. the Strava copy)
 *     → skip, the existing row wins
 * Returns whether a row was written and the id that now represents the run.
 */
export async function upsertCanonicalRun(
  userId: string,
  run: CanonicalRun,
): Promise<{ written: boolean; id: number | null }> {
  if (!(run.distanceMi > 0)) return { written: false, id: null };
  const id = canonicalRunId(userId, run.startISO);
  const nearby = await findNearbyRunId(userId, run.startISO);
  if (nearby != null && nearby !== id) {
    // A different-source row (often the real Strava activity) already covers
    // this session — don't add a duplicate.
    return { written: false, id: nearby };
  }
  const date = run.startISO.slice(0, 10);
  const durationS = Math.round(run.durationSec);
  const data = {
    date,
    startLocal: run.startISO,
    name: run.name ?? 'Run',
    distanceMi: Math.round(run.distanceMi * 100) / 100,
    movingTimeS: durationS,
    paceSPerMi: run.distanceMi > 0 && durationS > 0 ? Math.round(durationS / run.distanceMi) : null,
    avgHr: run.avgHr != null ? Math.round(run.avgHr) : null,
    maxHr: run.maxHr != null ? Math.round(run.maxHr) : null,
    workoutType: 0,
    type: run.type ?? 'easy',
    source: run.source,
  };
  await query(
    `INSERT INTO strava_activities (id, user_uuid, data)
       VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, userId, JSON.stringify(data)],
  );
  return { written: true, id };
}
