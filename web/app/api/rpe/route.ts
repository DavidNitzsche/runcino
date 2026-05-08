/**
 * /api/rpe — workout RPE log endpoints.
 *
 * GET  → recent entries (last 14 days, most recent first)
 * POST → save / overwrite an entry for a given date
 *        body: { workoutDate: 'YYYY-MM-DD', rpe: 1..10, notes?: string }
 *
 * Source of truth: `workout_rpe` Postgres table. The hub picks up
 * recent entries automatically on its next refresh, so saving here
 * + bumping the hub cache propagates the new RPE to every page.
 */

import { getRecentRpe, saveRpe } from '../../../lib/rpe-store';

export async function GET() {
  try {
    const entries = await getRecentRpe(14);
    return Response.json({ ok: true, entries });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      workoutDate?: unknown;
      rpe?: unknown;
      notes?: unknown;
    };
    const workoutDate = String(body.workoutDate ?? '');
    const rpe = Number(body.rpe);
    const notes = body.notes == null ? null : String(body.notes).slice(0, 500);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
      return Response.json({ ok: false, error: 'invalid workoutDate' }, { status: 400 });
    }
    if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) {
      return Response.json({ ok: false, error: 'invalid rpe (1-10)' }, { status: 400 });
    }
    const saved = await saveRpe(workoutDate, rpe, notes);
    return Response.json({ ok: true, entry: saved });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
