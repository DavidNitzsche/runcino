/**
 * Cross-training logs (bike/swim/hike/etc). Coach credits toward
 * fitness preservation in INJURY mode per cross_training.ts doctrine.
 */

import { query } from './db';

export type CrossTrainingIntensity = 'easy' | 'moderate' | 'hard';

export interface CrossTrainingSession {
  id: number;
  userUuid: string;
  date: string;
  modality: string;
  durationMin: number | null;
  intensity: CrossTrainingIntensity | null;
  avgHr: number | null;
  notes: string | null;
  createdAt: string;
}

interface RawRow {
  id: number;
  user_uuid: string | null;
  date: string | Date;
  modality: string;
  duration_min: number | null;
  intensity: string | null;
  avg_hr: number | null;
  notes: string | null;
  created_at: string | Date;
}

function toIsoDate(d: string | Date): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function fromRow(r: RawRow): CrossTrainingSession {
  return {
    id: r.id,
    userUuid: r.user_uuid ?? '',
    date: toIsoDate(r.date),
    modality: r.modality,
    durationMin: r.duration_min,
    intensity: (r.intensity as CrossTrainingIntensity | null) ?? null,
    avgHr: r.avg_hr,
    notes: r.notes,
    createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
  };
}

export interface CreateCrossTrainingInput {
  userUuid: string;
  date: string;
  modality: string;
  durationMin?: number | null;
  intensity?: CrossTrainingIntensity | null;
  avgHr?: number | null;
  notes?: string | null;
}

export async function createCrossTraining(input: CreateCrossTrainingInput): Promise<CrossTrainingSession> {
  const rows = await query<RawRow>(
    `INSERT INTO cross_training_sessions
       (user_uuid, date, modality, duration_min, intensity, avg_hr, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_uuid, date, modality, duration_min, intensity, avg_hr, notes, created_at`,
    [
      input.userUuid, input.date, input.modality,
      input.durationMin ?? null, input.intensity ?? null,
      input.avgHr ?? null, input.notes ?? null,
    ],
  );
  return fromRow(rows[0]);
}

export async function listRecentCrossTraining(userUuid: string, days = 14): Promise<CrossTrainingSession[]> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, date, modality, duration_min, intensity, avg_hr, notes, created_at
       FROM cross_training_sessions
      WHERE user_uuid = $1 AND date > CURRENT_DATE - ($2 || ' days')::interval
      ORDER BY date DESC`,
    [userUuid, String(days)],
  );
  return rows.map(fromRow);
}
