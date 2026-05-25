/**
 * Post-run RPE store. Subjective effort + optional free-text notes
 * per activity. Coach reads via runRead/formRead to deepen the FORM
 * verdict (HR-pace says easy + RPE says 7 → fatigue signal).
 */

import { query } from './db';

export interface PostRunRpe {
  id: number;
  userUuid: string;
  activityId: string;
  rpe: number | null;
  notes: string | null;
  loggedAt: string;
}

interface RawRow {
  id: number;
  user_uuid: string | null;
  activity_id: string;
  rpe: number | null;
  notes: string | null;
  logged_at: string | Date;
}

function fromRow(r: RawRow): PostRunRpe {
  return {
    id: r.id,
    userUuid: r.user_uuid ?? '',
    activityId: r.activity_id,
    rpe: r.rpe,
    notes: r.notes,
    loggedAt: typeof r.logged_at === 'string' ? r.logged_at : r.logged_at.toISOString(),
  };
}

export async function getRpe(userUuid: string, activityId: string): Promise<PostRunRpe | null> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, activity_id, rpe, notes, logged_at
       FROM post_run_rpe
      WHERE user_uuid = $1 AND activity_id = $2 LIMIT 1`,
    [userUuid, activityId],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function listRecentRpe(userUuid: string, limit = 30): Promise<PostRunRpe[]> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, activity_id, rpe, notes, logged_at
       FROM post_run_rpe WHERE user_uuid = $1
      ORDER BY logged_at DESC LIMIT $2`,
    [userUuid, limit],
  );
  return rows.map(fromRow);
}

export async function upsertRpe(
  userUuid: string,
  activityId: string,
  rpe: number | null,
  notes?: string | null,
): Promise<PostRunRpe> {
  const rows = await query<RawRow>(
    `INSERT INTO post_run_rpe (user_uuid, activity_id, rpe, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, activity_id) DO UPDATE
       SET rpe = EXCLUDED.rpe, notes = EXCLUDED.notes, logged_at = NOW()
     RETURNING id, user_uuid, activity_id, rpe, notes, logged_at`,
    [userUuid, activityId, rpe, notes ?? null],
  );
  return fromRow(rows[0]);
}
