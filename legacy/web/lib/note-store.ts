/**
 * Runner notes — "talk to the coach" free-text journal. Coach reads
 * recent notes (≥30 days) as context; may acknowledge in voice, may
 * trigger injury/illness/re-plan flows based on keyword detection.
 */

import { query } from './db';

export type NoteKind = 'general' | 'injury' | 'illness' | 'schedule' | 'other';

export interface RunnerNote {
  id: number;
  userUuid: string;
  kind: NoteKind;
  text: string;
  coachAck: string | null;
  coachAckAt: string | null;
  createdAt: string;
}

interface RawRow {
  id: number;
  user_uuid: string | null;
  kind: string;
  text: string;
  coach_ack: string | null;
  coach_ack_at: string | Date | null;
  created_at: string | Date;
}

function toIso(d: string | Date | null): string | null {
  if (d == null) return null;
  return typeof d === 'string' ? d : d.toISOString();
}

function fromRow(r: RawRow): RunnerNote {
  return {
    id: r.id,
    userUuid: r.user_uuid ?? '',
    kind: (r.kind as NoteKind) ?? 'general',
    text: r.text,
    coachAck: r.coach_ack,
    coachAckAt: toIso(r.coach_ack_at),
    createdAt: toIso(r.created_at) ?? '',
  };
}

export async function createNote(
  userUuid: string,
  text: string,
  kind: NoteKind = 'general',
): Promise<RunnerNote> {
  const rows = await query<RawRow>(
    `INSERT INTO runner_notes (user_uuid, kind, text)
     VALUES ($1, $2, $3)
     RETURNING id, user_uuid, kind, text, coach_ack, coach_ack_at, created_at`,
    [userUuid, kind, text],
  );
  return fromRow(rows[0]);
}

export async function listRecentNotes(userUuid: string, days = 30, limit = 30): Promise<RunnerNote[]> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, kind, text, coach_ack, coach_ack_at, created_at
       FROM runner_notes
      WHERE user_uuid = $1 AND created_at > NOW() - ($2 || ' days')::interval
      ORDER BY created_at DESC LIMIT $3`,
    [userUuid, String(days), limit],
  );
  return rows.map(fromRow);
}

export async function ackNote(id: number, userUuid: string, ack: string): Promise<void> {
  await query(
    `UPDATE runner_notes
        SET coach_ack = $3, coach_ack_at = NOW()
      WHERE id = $1 AND user_uuid = $2`,
    [id, userUuid, ack],
  );
}
