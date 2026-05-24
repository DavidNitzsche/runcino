/**
 * Strength training logs. Coach prescribes 2/week per Research/07;
 * CHALLENGE fires on 3-week gaps.
 */

import { query } from './db';

export interface StrengthSession {
  id: number;
  userUuid: string;
  date: string;
  sessionType: string | null;
  durationMin: number | null;
  notes: string | null;
  createdAt: string;
}

interface RawRow {
  id: number;
  user_uuid: string | null;
  date: string | Date;
  session_type: string | null;
  duration_min: number | null;
  notes: string | null;
  created_at: string | Date;
}

function toIsoDate(d: string | Date): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function fromRow(r: RawRow): StrengthSession {
  return {
    id: r.id,
    userUuid: r.user_uuid ?? '',
    date: toIsoDate(r.date),
    sessionType: r.session_type,
    durationMin: r.duration_min,
    notes: r.notes,
    createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
  };
}

export async function createStrengthSession(
  userUuid: string,
  date: string,
  sessionType?: string | null,
  durationMin?: number | null,
  notes?: string | null,
): Promise<StrengthSession> {
  const rows = await query<RawRow>(
    `INSERT INTO strength_sessions (user_uuid, date, session_type, duration_min, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_uuid, date, session_type, duration_min, notes, created_at`,
    [userUuid, date, sessionType ?? null, durationMin ?? null, notes ?? null],
  );
  return fromRow(rows[0]);
}

export async function listRecentStrength(userUuid: string, days = 14): Promise<StrengthSession[]> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, date, session_type, duration_min, notes, created_at
       FROM strength_sessions
      WHERE user_uuid = $1 AND date > CURRENT_DATE - ($2 || ' days')::interval
      ORDER BY date DESC`,
    [userUuid, String(days)],
  );
  return rows.map(fromRow);
}

export async function lastStrengthSessionDate(userUuid: string): Promise<string | null> {
  const rows = await query<{ date: string | Date }>(
    `SELECT date FROM strength_sessions WHERE user_uuid = $1 ORDER BY date DESC LIMIT 1`,
    [userUuid],
  );
  if (!rows[0]) return null;
  return toIsoDate(rows[0].date);
}
