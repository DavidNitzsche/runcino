import { extractAidStations } from '../../../lib/aid-extraction';

export async function POST(req: Request) {
  let body: {
    officialUrl: string;
    athleteGuidePdfUrl?: string;
    manualPasteText?: string;
    courseDistanceMi: number;
  };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!body.officialUrl) return new Response('Missing officialUrl', { status: 400 });
  if (!body.courseDistanceMi) return new Response('Missing courseDistanceMi', { status: 400 });

  try {
    const result = await extractAidStations(body);
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ stations: [], method: 'none', rawCount: 0, error: msg });
  }
}
