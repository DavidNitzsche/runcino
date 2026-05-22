/**
 * POST /api/profile/adaptive-vdot
 *
 * Two actions for the L7 adaptive-VDOT banner:
 *
 *   { action: 'apply', vdot: 47.6 }
 *     User accepted the proposed bump. Sets
 *     users.vdot_manual_override + vdot_manual_override_at to NOW.
 *     compute-vdot honors the override until a new race result
 *     post-dates it (race-first source-of-truth still wins long
 *     term).
 *
 *   { action: 'dismiss' }
 *     User clicked "Keep current". Sets
 *     users.adaptive_vdot_dismissed_at to NOW. Banner suppresses
 *     for 30 days OR until new evidence (workouts after dismissal
 *     that fire the faster-signal pattern) re-fires.
 *
 *   { action: 'clear-override' }
 *     Manual clear (e.g., user wants to revert to race-derived).
 *     Nulls override + override_at.
 *
 * Auth required. The override applies per-user.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface ApplyBody { action: 'apply'; vdot: number }
interface DismissBody { action: 'dismiss' }
interface ClearBody { action: 'clear-override' }
type Body = ApplyBody | DismissBody | ClearBody;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Partial<Body>;

    if (body.action === 'apply') {
      const v = Number((body as ApplyBody).vdot);
      if (!Number.isFinite(v) || v < 20 || v > 90) {
        return NextResponse.json(
          { ok: false, error: 'vdot must be between 20 and 90' },
          { status: 400 },
        );
      }
      // Apply also acknowledges the shift-guard review at the new
      // value, applying an L7 bump is a deliberate "I see this and
      // accept it" action, which satisfies the aggregate-level guard.
      await query(
        `UPDATE users
            SET vdot_manual_override = $1, vdot_manual_override_at = NOW(),
                vdot_last_reviewed = $1, vdot_last_reviewed_at = NOW(),
                vdot_shift_dismissed_at = NULL, vdot_shift_snoozed_at = NULL,
                adaptive_vdot_dismissed_at = NULL,
                updated_at = NOW()
          WHERE id = $2`,
        [v, user.id],
      );
      return NextResponse.json({ ok: true, action: 'apply', vdot: v });
    }

    if (body.action === 'dismiss') {
      await query(
        `UPDATE users
            SET adaptive_vdot_dismissed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [user.id],
      );
      return NextResponse.json({ ok: true, action: 'dismiss' });
    }

    if (body.action === 'clear-override') {
      await query(
        `UPDATE users
            SET vdot_manual_override = NULL, vdot_manual_override_at = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [user.id],
      );
      return NextResponse.json({ ok: true, action: 'clear-override' });
    }

    return NextResponse.json(
      { ok: false, error: 'action must be one of: apply, dismiss, clear-override' },
      { status: 400 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isUnauth = /unauthorized/i.test(msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: isUnauth ? 401 : 500 },
    );
  }
}
