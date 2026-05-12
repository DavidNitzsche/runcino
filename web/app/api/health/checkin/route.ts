/**
 * /api/health/checkin — daily Hooper-axis subjective check-in CRUD.
 *
 * POST → upsert today's check-in (energy/soreness/stress 1-10).
 * GET  → return the latest check-in for today, or null.
 *
 * Upsert is keyed on (user_id, date). Re-submitting on the same day
 * overwrites — the runner re-rated themselves; we keep only the latest.
 * Future enhancement: track edit history.
 */

import { query } from '../../../../lib/db';

interface CheckinRow {
  id: number;
  user_id: string;
  date: string;
  energy: number;
  soreness: number;
  stress: number;
  notes: string | null;
  logged_at: string;
}

function todayLAISO(): string {
  // Match the rest of the engine — LA calendar, not UTC. Avoids the
  // post-midnight-LA-but-still-yesterday-UTC bug that would let two
  // check-ins land on the same calendar day.
  const now = new Date();
  const la = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return `${la.getFullYear()}-${String(la.getMonth() + 1).padStart(2, '0')}-${String(la.getDate()).padStart(2, '0')}`;
}

export async function GET() {
  try {
    const today = todayLAISO();
    const rows = await query<CheckinRow>(
      `SELECT id, user_id, date::text, energy, soreness, stress, notes, logged_at::text
       FROM daily_checkin
       WHERE user_id = $1 AND date = $2
       LIMIT 1`,
      ['me', today],
    );
    return Response.json({ ok: true, today, checkin: rows[0] ?? null });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

function isOneToTen(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 10 && Number.isInteger(n);
}

export async function POST(req: Request) {
  let body: Partial<{ energy: number; soreness: number; stress: number; notes: string; date: string }>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isOneToTen(body.energy)) {
    return Response.json({ ok: false, error: 'energy must be 1-10' }, { status: 400 });
  }
  if (!isOneToTen(body.soreness)) {
    return Response.json({ ok: false, error: 'soreness must be 1-10' }, { status: 400 });
  }
  if (!isOneToTen(body.stress)) {
    return Response.json({ ok: false, error: 'stress must be 1-10' }, { status: 400 });
  }

  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : todayLAISO();

  try {
    const rows = await query<CheckinRow>(
      `INSERT INTO daily_checkin (user_id, date, energy, soreness, stress, notes)
       VALUES ('me', $1, $2, $3, $4, $5)
       ON CONFLICT (user_id, date)
       DO UPDATE SET energy = EXCLUDED.energy,
                     soreness = EXCLUDED.soreness,
                     stress = EXCLUDED.stress,
                     notes = EXCLUDED.notes,
                     logged_at = NOW()
       RETURNING id, user_id, date::text, energy, soreness, stress, notes, logged_at::text`,
      [date, body.energy, body.soreness, body.stress, body.notes?.trim() || null],
    );
    return Response.json({ ok: true, checkin: rows[0] });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
