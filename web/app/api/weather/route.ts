/**
 * /api/weather?lat=<>&lon=<> — NOAA weather passthrough.
 *
 * Free, no auth. CONUS only (US National Weather Service coverage).
 */

import { fetchNoaaWeather } from '../../../lib/weather';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return new Response('lat + lon query params required', { status: 400 });
  }

  try {
    const data = await fetchNoaaWeather(lat, lon);
    return Response.json(data);
  } catch (err) {
    return new Response(`Weather fetch failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
  }
}
