/**
 * POST /api/admin/users/[id]/[action]
 *
 * Admin-only. Actions:
 *   approve   pending → active (sets approved_at + approved_by)
 *   reapprove denied  → active (re-grants access to a previously denied user)
 *   deny      pending|active → denied (revoke or refuse access)
 *   promote   active  → is_admin=true
 *   demote    active  → is_admin=false (refuses to demote the last admin
 *             or to let an admin demote themselves while alone)
 *
 * The admin check is enforced by requireAdmin(); there's no other gate.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

type Action = 'approve' | 'reapprove' | 'deny' | 'promote' | 'demote';
const ACTIONS: Action[] = ['approve', 'reapprove', 'deny', 'promote', 'demote'];

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; action: string }> },
) {
  const me = await requireAdmin();
  const { id, action } = await ctx.params;

  if (!ACTIONS.includes(action as Action)) {
    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
  }

  // Look up the target user to know their current state.
  const rows = await query<{ id: string; status: string; is_admin: boolean; email: string }>(
    `SELECT id, status, is_admin, email FROM users WHERE id = $1 LIMIT 1;`,
    [id],
  );
  const target = rows[0];
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  switch (action as Action) {
    case 'approve':
    case 'reapprove': {
      await query(
        `UPDATE users SET status = 'active', approved_at = NOW(), approved_by = $1, updated_at = NOW()
         WHERE id = $2;`,
        [me.id, id],
      );
      return NextResponse.json({ ok: true, status: 'active' });
    }

    case 'deny': {
      // Self-deny is forbidden; the legacy owner is always active.
      if (target.id === me.id) {
        return NextResponse.json({ error: "You can't deny your own account" }, { status: 400 });
      }
      // Bonus: also drop their session(s) so the change kicks in on next request.
      await query(`DELETE FROM sessions WHERE user_id = $1;`, [id]);
      await query(
        `UPDATE users SET status = 'denied', is_admin = FALSE, updated_at = NOW() WHERE id = $1;`,
        [id],
      );
      return NextResponse.json({ ok: true, status: 'denied' });
    }

    case 'promote': {
      await query(
        `UPDATE users SET is_admin = TRUE, updated_at = NOW() WHERE id = $1 AND status = 'active';`,
        [id],
      );
      return NextResponse.json({ ok: true });
    }

    case 'demote': {
      // Refuse to demote the last admin.
      const [{ admins }] = await query<{ admins: number }>(
        `SELECT COUNT(*)::int AS admins FROM users WHERE is_admin = TRUE AND status = 'active';`,
      );
      if (admins <= 1 && target.is_admin) {
        return NextResponse.json({ error: 'Cannot demote the last admin' }, { status: 400 });
      }
      if (target.id === me.id) {
        return NextResponse.json({ error: "You can't demote yourself" }, { status: 400 });
      }
      await query(
        `UPDATE users SET is_admin = FALSE, updated_at = NOW() WHERE id = $1;`,
        [id],
      );
      return NextResponse.json({ ok: true });
    }
  }
}
