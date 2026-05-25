/**
 * Coach proposals store. Surfaces requiring runner accept/reject:
 * goal time changes, race conflicts, plan rewrites. Per autonomy
 * contract §10.2.
 */

import { query } from './db';

export type ProposalType =
  | 'goal_time_change'
  | 'race_priority_change'
  | 'plan_rewrite'
  | 'race_drop'
  | 'long_run_day_change'
  | 'build_phase_extend'
  | 'build_phase_shorten';

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface CoachProposal<TPayload = unknown> {
  id: number;
  userUuid: string;
  proposalType: ProposalType;
  payload: TPayload;
  status: ProposalStatus;
  createdAt: string;
  respondedAt: string | null;
  expiresAt: string | null;
}

interface RawRow {
  id: number;
  user_uuid: string | null;
  proposal_type: string;
  payload: unknown;
  status: string;
  created_at: string | Date;
  responded_at: string | Date | null;
  expires_at: string | Date | null;
}

function fromRow<T>(r: RawRow): CoachProposal<T> {
  const toIso = (d: string | Date | null): string | null =>
    d == null ? null : typeof d === 'string' ? d : d.toISOString();
  return {
    id: r.id,
    userUuid: r.user_uuid ?? '',
    proposalType: r.proposal_type as ProposalType,
    payload: r.payload as T,
    status: r.status as ProposalStatus,
    createdAt: toIso(r.created_at) ?? '',
    respondedAt: toIso(r.responded_at),
    expiresAt: toIso(r.expires_at),
  };
}

export async function listPendingProposals(userUuid: string): Promise<CoachProposal[]> {
  const rows = await query<RawRow>(
    `SELECT id, user_uuid, proposal_type, payload, status,
            created_at, responded_at, expires_at
       FROM coach_proposals
      WHERE user_uuid = $1 AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at ASC`,
    [userUuid],
  );
  return rows.map(fromRow);
}

export interface CreateProposalInput<TPayload = unknown> {
  userUuid: string;
  proposalType: ProposalType;
  payload: TPayload;
  expiresAt?: string | null;
}

export async function createProposal<T>(input: CreateProposalInput<T>): Promise<CoachProposal<T>> {
  const rows = await query<RawRow>(
    `INSERT INTO coach_proposals (user_uuid, proposal_type, payload, expires_at)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, user_uuid, proposal_type, payload, status,
               created_at, responded_at, expires_at`,
    [input.userUuid, input.proposalType, JSON.stringify(input.payload), input.expiresAt ?? null],
  );
  return fromRow<T>(rows[0]);
}

export async function respondToProposal(
  id: number,
  userUuid: string,
  decision: 'accepted' | 'rejected',
): Promise<void> {
  await query(
    `UPDATE coach_proposals
        SET status = $3, responded_at = NOW()
      WHERE id = $1 AND user_uuid = $2 AND status = 'pending'`,
    [id, userUuid, decision],
  );
}

/** Sweep expired pending proposals. Call periodically. */
export async function expireOldProposals(): Promise<void> {
  await query(
    `UPDATE coach_proposals
        SET status = 'expired'
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`,
  );
}

/** Revoke pending proposals of a given type for a user. Used when a
 *  context filter (e.g. post-race recovery window) makes a previously-
 *  created proposal invalid — the data that drove it no longer applies.
 *  Marks as 'expired' rather than deleting so the audit trail survives. */
export async function revokePendingProposals(
  userUuid: string,
  proposalType: ProposalType,
): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH revoked AS (
       UPDATE coach_proposals SET status = 'expired', responded_at = NOW()
        WHERE user_uuid = $1 AND status = 'pending' AND proposal_type = $2
        RETURNING 1
     ) SELECT COUNT(*)::text AS count FROM revoked`,
    [userUuid, proposalType],
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}
