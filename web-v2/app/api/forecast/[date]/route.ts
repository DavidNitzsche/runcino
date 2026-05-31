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

  const f = await fetchDayForecast(home.lat, home.lng, date);
  if (!f) {
    return NextResponse.json({ error: 'forecast unavailable (likely out of range)' }, { status: 404 });
  }

  return NextResponse.json(f, {
    headers: { 'Cache-Control': 'private, max-age=1800, stale-while-revalidate=600' },
  });
}
