/**
 * POST /api/cron/enrich-weather  (P31)
 *
 * Nightly weather backfill — walks recent un-enriched runs, fetches
 * Open-Meteo for each, folds tempF + weather blob into data.
 *
 * Auth: shared CRON_SECRET.
 *
 * Schedule: 30 7 * * * UTC = 00:30 PT, per
 * .github/workflows/enrich-weather.yml. Since 2026-08-30 the schedule is a
 * SLOT rather than a firing time — `/api/cron/tick` runs this once the slot has
 * opened and it has not already succeeded since (lib/ops/cron-ledger.ts), so a
 * trigger six hours late still enriches the same day's runs.
 *
 * 2026-08-30 · this header used to say "after the briefing-refresh cron so the
 * next briefing reads enriched data". There is no briefing-refresh cron: the
 * LLM briefing layer and its `refresh-briefings` route were removed on
 * 2026-05-28 and the `briefings` table is gone. Nothing ordered against a job
 * that does not exist, so nothing broke — but per CLAUDE.md Rule 20 a header
 * comment asserting an invariant is documentation, not enforcement, and a
 * false ordering claim is how a real one gets trusted. This job has NO
 * predecessor: `enrichRecent` selects un-enriched runs and fills nulls, so it
 * is correct in any order and simply catches whatever the last sync brought in
 * on its next pass.
 */
import { NextRequest, NextResponse } from 'next/server';
import { enrichRecent } from '@/lib/weather/openmeteo';
import { recordCronSuccess } from '@/lib/ops/cron-ledger';

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
    // 2026-08-30 · scheduler ledger (lib/ops/cron-ledger.ts).
    await recordCronSuccess('enrich-weather', r as Record<string, unknown>);
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
