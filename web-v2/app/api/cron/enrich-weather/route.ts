/**
 * POST /api/cron/enrich-weather  (P31)
 *
 * Nightly weather backfill — walks recent un-enriched runs, fetches
 * Open-Meteo for each, folds tempF + weather blob into data.
 *
 * Auth: same CRON_SECRET as /api/cron/refresh-briefings.
 *
 * Schedule (GitHub Actions): 30 7 * * * UTC = 00:30 PT (after the
 * briefing-refresh cron so the next briefing reads enriched data).
 */
import { NextRequest, NextResponse } from 'next/server';
import { enrichRecent } from '@/lib/weather/openmeteo';

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '').trim() !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const r = await enrichRecent(14, 30);
    return NextResponse.json({ ok: true, ...r, timestamp: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/enrich-weather',
    auth: 'Authorization: Bearer <CRON_SECRET>',
  });
}
