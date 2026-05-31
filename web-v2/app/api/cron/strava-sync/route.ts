/**
 * POST /api/cron/strava-sync
 *
 * Walks every Strava-connected user (connector_tokens.provider='strava',
 * not disconnected), pulls the last 30 days of activities, and either
 * enhances a matching canonical row or inserts a new canonical row.
 *
 * Doctrine reference: lib/strava/pullSync.ts header.
 *
 * Auth: shared CRON_SECRET, same pattern as enrich-weather + the other
 * GH-Actions-triggered crons.
 *
 * Schedule (GitHub Actions): 15 8 * * * UTC = 01:15 PT. Runs after
 * enrich-weather so newly-inserted Strava rows get weather-tagged on
 * the next pass.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pullSyncAllUsers } from '@/lib/strava/pullSync';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

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
    const r = await pullSyncAllUsers({ windowDays: 30 });
    const totals = r.results.reduce((a, x) => ({
      fetched: a.fetched + x.fetched,
      matched: a.matched + x.matched,
      inserted: a.inserted + x.inserted,
      fieldsAdded: a.fieldsAdded + x.fieldsAdded,
      shoesAttributed: a.shoesAttributed + x.shoesAttributed,
      rpeWritten: a.rpeWritten + x.rpeWritten,
      errors: a.errors + x.errors.length,
    }), { fetched: 0, matched: 0, inserted: 0, fieldsAdded: 0, shoesAttributed: 0, rpeWritten: 0, errors: 0 });
    return NextResponse.json({
      ok: true,
      users: r.users,
      totals,
      per_user: r.results.map((x) => ({
        userUuid: x.userUuid.slice(0, 8) + '…',  // don't echo full UUIDs
        fetched: x.fetched,
        matched: x.matched,
        inserted: x.inserted,
        fieldsAdded: x.fieldsAdded,
        shoesAttributed: x.shoesAttributed,
        rpeWritten: x.rpeWritten,
        errors: x.errors.slice(0, 3),
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/strava-sync',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    description: 'Pull last 30d Strava activities for all connected users; enhance or insert canonical rows.',
  });
}
