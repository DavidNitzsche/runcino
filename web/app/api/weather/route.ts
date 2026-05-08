/**
 * /api/weather — weather data for race-day planning.
 *
 *   ?lat=<>&lon=<>                → NOAA forecast (CONUS only, free)
 *   ?lat=<>&lon=<>&date=YYYY-MM-DD → Open-Meteo historical archive
 *                                    (global, free, last year's actuals)
 *
 * The race-detail page hits the historical mode when the race is
 * still far enough out that NOAA hasn't published a forecast for
 * race day, then switches to live forecast as the race approaches.
 */

import { fetchNoaaWeather, fetchHistoricalWeather } from '../../../lib/weather';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const date = url.searchParams.get('date');     // optional: historical mode
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return new Response('lat + lon query params required', { status: 400 });
  }

  try {
    const data = date
      ? await fetchHistoricalWeather(lat, lon, date)
      : await fetchNoaaWeather(lat, lon);
    return Response.json({ ...data, source: date ? 'historical' : 'forecast', date });
  } catch (err) {
    return new Response(`Weather fetch failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
  }
}
