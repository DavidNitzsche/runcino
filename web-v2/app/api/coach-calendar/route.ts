/**
 * /api/coach-calendar · coached-mode v2 (2026-06-10).
 *
 * The runner pastes their coach platform's calendar Sync URL (Final
 * Surge, TrainingPeaks — any ICS web-calendar). Faff caches the parsed
 * events and renders them read-only on Today. No structured spec is
 * derived (v3); no writes ever go back to the coach platform.
 *
 *   GET    → { connected, events_total, events_next7, fetched_at, last_error }
 *   POST   { url }  → validate + save + fetch INLINE so the runner sees
 *                     their workouts immediately · returns same shape
 *   DELETE → disconnect (clears URL + cached events)
 *
 * Auth: requireUserId on all three.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { normalizeFeedUrl } from '@/lib/coach-calendar/ics';
import {
  getCoachCalendarStatus,
  refreshCoachCalendar,
  setCoachCalendarUrl,
} from '@/lib/coach-calendar/store';

export const dynamic = 'force-dynamic';

function shape(status: Awaited<ReturnType<typeof getCoachCalendarStatus>>) {
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  return {
    connected: status.urlSet,
    events_total: status.events.length,
    events_next7: status.events.filter((e) => e.dateISO >= today && e.dateISO < week).length,
    fetched_at: status.fetchedAt,
    last_error: status.lastError,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const status = await getCoachCalendarStatus(auth);
  return NextResponse.json({ ok: true, ...shape(status) });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;

  let body: { url?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  const norm = normalizeFeedUrl(typeof body.url === 'string' ? body.url : '');
  if (!norm.ok) return NextResponse.json({ ok: false, error: norm.error }, { status: 400 });

  await setCoachCalendarUrl(auth, norm.url);
  const result = await refreshCoachCalendar(auth);
  if (!result.ok) {
    // Keep the URL saved (the host may be momentarily down) but tell the
    // runner exactly what happened — the read path will keep retrying on
    // its TTL.
    return NextResponse.json({ ok: false, error: result.error, saved: true }, { status: 422 });
  }
  const status = await getCoachCalendarStatus(auth);
  return NextResponse.json({ ok: true, ...shape(status) });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  await setCoachCalendarUrl(auth, null);
  return NextResponse.json({ ok: true, connected: false });
}
