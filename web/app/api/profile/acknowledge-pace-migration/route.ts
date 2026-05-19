/**
 * POST /api/profile/acknowledge-pace-migration
 *
 * One-time confirmation that the user has reviewed the canonical
 * pace-band correction. Until this is set, /profile's Coach Reads
 * card surfaces a migration banner explaining that pace bands were
 * derived from a now-corrected legacy formula (see
 * docs/2026-05-19-sim-sweep.md for the diff).
 *
 * After acknowledgment, ongoing pace-band shifts (e.g., from new
 * race results that move VDOT) fall under the standard large-shift
 * guard at the prescription layer — not the migration banner.
 *
 * Empty body. Returns the ack timestamp.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST() {
  try {
    const user = await requireUser();
    const rows = await query<{ pace_migration_ack_at: Date | null }>(
      `UPDATE users
          SET pace_migration_ack_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING pace_migration_ack_at`,
      [user.id],
    );
    return NextResponse.json({
      ok: true,
      pace_migration_ack_at: rows[0]?.pace_migration_ack_at?.toISOString() ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isUnauth = /unauthorized/i.test(msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: isUnauth ? 401 : 500 },
    );
  }
}
