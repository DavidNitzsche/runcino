/**
 * Active-injury store. Triggers INJURY mode in the coach when a row
 * has resolved_date IS NULL. Per docs/COACH_VOICE_AUDIT_AND_REWRITE.md
 * §7.4.
 */

import { query } from './db';

export interface RunnerInjury {
  id: number;
  userUuid: string;
  site: string;
  severity: 'minor' | 'moderate' | 'major';
  returnProtocol: string | null;
  notes: string | null;
  startDate: string;
  expectedReturnDate: string | null;
  resolvedDate: string | null;
  createdAt: string;
}

interface RawRow {
  id: number;
  user_uuid: string | null;
  site: string;
  severity: string;
  return_protocol: string | null;
  notes: string | null;
  start_date: string | Date;
  expected_return_date: string | Date | null;
  resolved_date: string | Date | null;
  created_at: string | Date;
}

function toIso(d: string | Date | null): string | null {
  if (d == null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function fromRow(r: RawRow): RunnerInjury {
  return {
    id: r.id,
    userUuid: r.user_uuid ?? '',
    site: r.site,
    severity: (r.severity as RunnerInjury['severity']) ?? 'minor',
    returnProtocol: r.return_protocol,
    notes: r.notes,
    startDate: toIso(r.start_date) ?? '',
    expectedReturnDate: toIso(r.expected_return_date),
    resolvedDate: toIso(r.resolved_date),
    createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
  };
}

/** Most recent active injury (resolved_date IS NULL) for the runner. */
export async function getActiveInjury(userUuid: string): Promise<RunnerInjury | null> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, site, severity, return_protocol, notes,
            start_date, expected_return_date, resolved_date, created_at
       FROM runner_injuries
      WHERE user_uuid = $1 AND resolved_date IS NULL
      ORDER BY start_date DESC LIMIT 1`,
    [userUuid],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** All injuries (active + resolved) for the runner, most recent first. */
export async function listInjuries(userUuid: string): Promise<RunnerInjury[]> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, site, severity, return_protocol, notes,
            start_date, expected_return_date, resolved_date, created_at
       FROM runner_injuries WHERE user_uuid = $1
      ORDER BY start_date DESC`,
    [userUuid],
  );
  return rows.map(fromRow);
}

export interface CreateInjuryInput {
  userUuid: string;
  site: string;
  severity?: 'minor' | 'moderate' | 'major';
  returnProtocol?: string | null;
  notes?: string | null;
  startDate?: string;
  expectedReturnDate?: string | null;
}

export async function createInjury(input: CreateInjuryInput): Promise<RunnerInjury> {
  const rows = await query<RawRow>(
    `INSERT INTO runner_injuries
       (user_uuid, site, severity, return_protocol, notes, start_date, expected_return_date)
     VALUES ($1, $2, COALESCE($3,'minor'), $4, $5, COALESCE($6, CURRENT_DATE), $7)
     RETURNING id, user_uuid, site, severity, return_protocol, notes,
               start_date, expected_return_date, resolved_date, created_at`,
    [
      input.userUuid, input.site, input.severity ?? null,
      input.returnProtocol ?? null, input.notes ?? null,
      input.startDate ?? null, input.expectedReturnDate ?? null,
    ],
  );
  return fromRow(rows[0]);
}

export async function resolveInjury(id: number, userUuid: string, resolvedDate?: string): Promise<void> {
  await query(
    `UPDATE runner_injuries
        SET resolved_date = COALESCE($3, CURRENT_DATE)
      WHERE id = $1 AND user_uuid = $2`,
    [id, userUuid, resolvedDate ?? null],
  );
}

export async function updateInjuryProtocol(id: number, userUuid: string, returnProtocol: string): Promise<void> {
  await query(
    `UPDATE runner_injuries SET return_protocol = $3 WHERE id = $1 AND user_uuid = $2`,
    [id, userUuid, returnProtocol],
  );
}
