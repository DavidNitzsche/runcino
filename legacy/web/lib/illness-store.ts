/**
 * Active-illness store. Triggers ILLNESS mode in the coach when a row
 * has resolved_date IS NULL. Per docs/COACH_VOICE_AUDIT_AND_REWRITE.md
 * §7.5.
 */

import { query } from './db';

export type IllnessKind = 'cold' | 'flu' | 'gi' | 'fever' | 'covid' | 'other';
export type IllnessSeverity = 'mild' | 'moderate' | 'severe';

export interface RunnerIllness {
  id: number;
  userUuid: string;
  kind: IllnessKind;
  severity: IllnessSeverity;
  aboveNeck: boolean;
  notes: string | null;
  startDate: string;
  resolvedDate: string | null;
  createdAt: string;
}

interface RawRow {
  id: number;
  user_uuid: string | null;
  kind: string;
  severity: string;
  above_neck: boolean;
  notes: string | null;
  start_date: string | Date;
  resolved_date: string | Date | null;
  created_at: string | Date;
}

function toIso(d: string | Date | null): string | null {
  if (d == null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function fromRow(r: RawRow): RunnerIllness {
  return {
    id: r.id,
    userUuid: r.user_uuid ?? '',
    kind: (r.kind as IllnessKind) ?? 'other',
    severity: (r.severity as IllnessSeverity) ?? 'mild',
    aboveNeck: r.above_neck,
    notes: r.notes,
    startDate: toIso(r.start_date) ?? '',
    resolvedDate: toIso(r.resolved_date),
    createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
  };
}

export async function getActiveIllness(userUuid: string): Promise<RunnerIllness | null> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, kind, severity, above_neck, notes,
            start_date, resolved_date, created_at
       FROM runner_illnesses
      WHERE user_uuid = $1 AND resolved_date IS NULL
      ORDER BY start_date DESC LIMIT 1`,
    [userUuid],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function listIllnesses(userUuid: string): Promise<RunnerIllness[]> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, kind, severity, above_neck, notes,
            start_date, resolved_date, created_at
       FROM runner_illnesses WHERE user_uuid = $1
      ORDER BY start_date DESC`,
    [userUuid],
  );
  return rows.map(fromRow);
}

export interface CreateIllnessInput {
  userUuid: string;
  kind: IllnessKind;
  severity?: IllnessSeverity;
  aboveNeck?: boolean;
  notes?: string | null;
  startDate?: string;
}

export async function createIllness(input: CreateIllnessInput): Promise<RunnerIllness> {
  const rows = await query<RawRow>(
    `INSERT INTO runner_illnesses (user_uuid, kind, severity, above_neck, notes, start_date)
     VALUES ($1, $2, COALESCE($3,'mild'), COALESCE($4,true), $5, COALESCE($6, CURRENT_DATE))
     RETURNING id, user_uuid, kind, severity, above_neck, notes,
               start_date, resolved_date, created_at`,
    [
      input.userUuid, input.kind, input.severity ?? null,
      input.aboveNeck ?? null, input.notes ?? null, input.startDate ?? null,
    ],
  );
  return fromRow(rows[0]);
}

export async function resolveIllness(id: number, userUuid: string, resolvedDate?: string): Promise<void> {
  await query(
    `UPDATE runner_illnesses
        SET resolved_date = COALESCE($3, CURRENT_DATE)
      WHERE id = $1 AND user_uuid = $2`,
    [id, userUuid, resolvedDate ?? null],
  );
}
