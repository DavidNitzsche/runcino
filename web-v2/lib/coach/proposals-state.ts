/**
 * proposals-state — load pending coach_proposals for the active runner so
 * the faff Today view can render accept/decline UI.
 *
 * Proposal rows are written by lib/plan/adapt.ts when a Q-03 (illness) or
 * Q-08 (injury) trigger fires. Until this loader existed the rows piled
 * up in the DB with no UI consumer — the dead-code rescue called out in
 * the 2026-05-30 audit P0 #1.
 *
 * Returned shape is the minimum the CoachProposalCard component needs to
 * render: id (for the POST URL), proposal_type (for the headline copy),
 * reason + suggested (for the body), and the trigger evidence (so a
 * runner can see WHAT we noticed before they accept). Status filter is
 * 'pending' only — accepted/rejected/expired never appear.
 */
import { pool } from '@/lib/db/pool';

export interface PendingProposal {
  id: number;
  proposal_type: 'injury_adjust' | 'illness_adjust' | string;
  reason: string;
  suggested: string;
  evidence: Record<string, unknown>;
  created_at: string;
}

export async function loadPendingProposals(userId: string): Promise<PendingProposal[]> {
  const r = await pool.query<{
    id: number;
    proposal_type: string;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>(
    `SELECT id, proposal_type, payload, created_at::text AS created_at
       FROM coach_proposals
      WHERE user_uuid = $1
        AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 5`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ id: number; proposal_type: string; payload: Record<string, unknown> | null; created_at: string }> }));

  return r.rows.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      proposal_type: row.proposal_type,
      reason: String(payload.reason ?? ''),
      suggested: String(payload.suggested ?? ''),
      evidence: (payload.evidence ?? {}) as Record<string, unknown>,
      created_at: row.created_at,
    };
  });
}
