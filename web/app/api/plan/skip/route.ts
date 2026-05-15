/**
 * /api/plan/skip — runner explicitly marks today's planned workout as
 * skipped. Writes a row to `skipped_workouts` so the coach engine can
 * react and /log surfaces it as a real event.
 *
 * GET  → returns the skip row for today (or null).
 * POST → upserts a skip row.
 *        Body: { plannedWorkoutType?, plannedMi?, reason?, undo?: true }
 *        When `undo: true`, deletes the row instead.
 *
 * The endpoint is intentionally narrow — Skip is a clear runner
 * intent, not a fuzzy signal. The coach treats it as ground truth.
 */

import { saveSkip, deleteSkip, getSkipForDate } from '../../../../lib/skip-store';

function todayLAISO(): string {
  const now = new Date();
  const la = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, '0')}-${String(la.getDate()).padStart(2, '0')}`;
}

export async function GET() {
  try {
    const dateISO = todayLAISO();
    const skip = await getSkipForDate({ dateISO });
    return Response.json({ ok: true, skip });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const dateISO = body.dateISO ?? todayLAISO();

    // Undo path — delete the row.
    if (body.undo === true) {
      const deleted = await deleteSkip({ dateISO });
      return Response.json({ ok: true, deleted });
    }

    // Validate optional fields softly — bad input shouldn't 500.
    const plannedWorkoutType =
      typeof body.plannedWorkoutType === 'string' && body.plannedWorkoutType.length <= 80
        ? body.plannedWorkoutType
        : null;
    const plannedMi =
      typeof body.plannedMi === 'number' && isFinite(body.plannedMi) && body.plannedMi >= 0
        ? body.plannedMi
        : null;
    const reason =
      typeof body.reason === 'string' && body.reason.length <= 280
        ? body.reason
        : null;

    const skip = await saveSkip({ dateISO, plannedWorkoutType, plannedMi, reason });
    return Response.json({ ok: true, skip });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
