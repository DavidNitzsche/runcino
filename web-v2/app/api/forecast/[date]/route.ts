/**
 * GET /api/forecast/[date]
 *
 * Day-of-run weather forecast for the runner's home base.
 *
 * Used by the /today + /train surfaces to render a real temp range for
 * planned days instead of the old hardcoded "64° · Calm" placeholder.
 * Past days surface actual conditions from Strava enrichment (different
 * code path — fetchRunWeather historical).
 *
 * date param: YYYY-MM-DD. Open-Meteo forecast covers ~16 days out.
 * Returns 404 when the date is too far out or no home location yet
 * (e.g. brand-new runner with no GPS runs).
 *
 * 30-min browser cache + SWR. Weather doesn't churn fast enough to
 * pound the upstream API on every TodayView render.
 */
import { NextResponse } from 'next/server';
import { fetchDayForecast, resolveHomeLatLng } from '@/lib/weather/openmeteo';
import { requireUserId } from '@/lib/auth/session';

/**
 * 2026-06-02 · iPhone brief · parse `?startHHMM=0630` query param to
 * fractional hours (0-23.99). Accepts `HHMM` or `HH:MM`. Returns null
 * on parse failure so the caller falls back to best_window.
 */
function parseStartHHMM(s: string | null): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return undefined;
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mn)) return undefined;
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return undefined;
  return h + mn / 60;
}

export async function GET(req: Request, { params }: { params: Promise<{ date: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  // Resolve "where does the runner live" from most recent GPS run.
  const home = await resolveHomeLatLng(userId);
  if (!home) {
    return NextResponse.json({ error: 'no home location yet (need a GPS-tracked run)' }, { status: 404 });
  }

  // 2026-06-02 · iPhone CONDITIONS chip · workout-window range params.
  // Both optional · old callers get the same response as before.
  // ?durationMin=60                  → compute temp_start/end from
  //                                    best_window start + duration
  // ?durationMin=60&startHHMM=0630   → override start time (5pm runs, etc.)
  const url = new URL(req.url);
  const durationMinParam = url.searchParams.get('durationMin');
  const durationMin = durationMinParam != null ? Number(durationMinParam) : null;
  const startHourOverride = parseStartHHMM(url.searchParams.get('startHHMM'));
  const workoutWindow = durationMin != null && Number.isFinite(durationMin) && durationMin > 0
    ? { durationMin, startHourOverride }
    : null;

  const f = await fetchDayForecast(home.lat, home.lng, date, workoutWindow);
  if (!f) {
    return NextResponse.json({ error: 'forecast unavailable (likely out of range)' }, { status: 404 });
  }

  return NextResponse.json(f, {
    headers: { 'Cache-Control': 'private, max-age=1800, stale-while-revalidate=600' },
  });
}
