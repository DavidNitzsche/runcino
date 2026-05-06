import { parseGpx } from '../../../lib/gpx';
import { injectDemElevation } from '../../../lib/elevation';

export async function POST(req: Request) {
  let body: { gpxText: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!body.gpxText) return new Response('Missing gpxText', { status: 400 });

  let track;
  try {
    track = parseGpx(body.gpxText);
  } catch (err) {
    return new Response(`GPX parse error: ${err instanceof Error ? err.message : err}`, { status: 400 });
  }

  try {
    const result = await injectDemElevation(track);
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: 'Elevation service is temporarily unavailable. Please try again in a few minutes.', detail: msg }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
}
