/**
 * Coach actions audit log. Every plan change, proposal, and
 * notification the coach issues is logged here. Backs the
 * PlanAdaptedCard timeline + the COACH-WATCHING strip notifications.
 * Per autonomy contract §10.
 */

import { query } from './db';

export type ActionMode = 'unilateral' | 'propose' | 'notify';

export interface CoachAction<TPayload = unknown> {
  id: number;
  userUuid: string;
  actionType: string;
  mode: ActionMode;
  payload: TPayload;
  trigger: string | null;
  rationale: string | null;
  createdAt: string;
}

interface RawRow {
  id: number;
  user_uuid: string | null;
  action_type: string;
  mode: string;
  payload: unknown;
  trigger: string | null;
  rationale: string | null;
  created_at: string | Date;
}

function fromRow<T>(r: RawRow): CoachAction<T> {
  return {
    id: r.id,
    userUuid: r.user_uuid ?? '',
    actionType: r.action_type,
    mode: r.mode as ActionMode,
    payload: r.payload as T,
    trigger: r.trigger,
    rationale: r.rationale,
    createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
  };
}

export async function logCoachAction<T>(
  userUuid: string,
  actionType: string,
  mode: ActionMode,
  payload: T,
  trigger?: string,
  rationale?: string,
): Promise<CoachAction<T>> {
  const rows = await query<RawRow>(
    `INSERT INTO coach_actions (user_uuid, action_type, mode, payload, trigger, rationale)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING id, user_uuid, action_type, mode, payload, trigger, rationale, created_at`,
    [userUuid, actionType, mode, JSON.stringify(payload), trigger ?? null, rationale ?? null],
  );
  return fromRow<T>(rows[0]);
}

export async function listRecentCoachActions(userUuid: string, limit = 20): Promise<CoachAction[]> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, action_type, mode, payload, trigger, rationale, created_at
       FROM coach_actions WHERE user_uuid = $1
      ORDER BY created_at DESC LIMIT $2`,
    [userUuid, limit],
  );
  return rows.map(fromRow);
}

export async function listRecentByMode(
  userUuid: string,
  mode: ActionMode,
  limit = 20,
): Promise<CoachAction[]> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, action_type, mode, payload, trigger, rationale, created_at
       FROM coach_actions WHERE user_uuid = $1 AND mode = $2
      ORDER BY created_at DESC LIMIT $3`,
    [userUuid, mode, limit],
  );
  return rows.map(fromRow);
}
