/**
 * POST /api/health/workouts
 *
 * Apple Health workout import. The iPhone reads recent RUNNING workouts from
 * HealthKit (the source the watch reliably syncs to) and posts them here so a
 * run shows up even when the watch->phone completion bridge never fired.
 *
 * Each workout is written through the shared canonical-run writer, which keys
 * on START TIME — so a run that ALSO arrived via the watch completion (or that
 * later shows up from Strava) is de-duped to a single row, never doubled.
 *
 * Body: { workouts: [{ startISO, distanceMi, durationSec, avgHr?, maxHr?, name? }] }
 * Response: { ok, imported, skipped }
 *
 * Auth: Bearer access token (cookie also accepted for curl testing).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { upsertCanonicalRun } from '@/lib/run-dedup';
import { resolveTz } from '@/lib/dates';

interface IncomingWorkout {
  startISO?: string;
  distanceMi?: number;
  durationSec?: number;
  avgHr?: number | null;
  maxHr?: number | null;
  name?: string;
}

/**
 * Apple Health gives us a true UTC instant (e.g. `2026-05-19T02:27:22Z` for
 * a 7:27 PM LA-time run). Strava, by contrast, serializes `start_date_local`
 * as wall-clock time WITH a fake `Z` suffix (`2026-05-18T19:27:22Z` means
 * "19:27 in the runner's local zone"). The dedup `findNearbyRunId` compares
 * both via `Date.parse`, so it treats them as 7h apart and never matches.
 *
 * Normalize AH's true-UTC instant to the same "wall-clock + Z" frame Strava
 * uses, so a 7:27 PM LA AH run lands at `2026-05-18T19:27:22Z` and the
 * ±15-min dedup window catches its Strava twin.
 */
function utcToWallClockZ(utcISO: string, tz: string): string {
  const ms = Date.parse(utcISO);
  if (!Number.isFinite(ms)) return utcISO;
  // en-CA in tz gives YYYY-MM-DD, en-GB hour12=false gives HH:MM:SS.
  // Parts API avoids locale-specific ordering surprises.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const yyyy = get('year');
  const mm = get('month');
  const dd = get('day');
  let hh = get('hour');
  if (hh === '24') hh = '00'; // en-CA quirk on midnight
  const mi = get('minute');
  const ss = get('second');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') {
    return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });
  }

  let body: { workouts?: IncomingWorkout[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const workouts = Array.isArray(body.workouts) ? body.workouts : [];

  let imported = 0;
  let skipped = 0;
  const tz = resolveTz(user.timezone);
  for (const w of workouts) {
    const rawISO = typeof w.startISO === 'string' ? w.startISO : '';
    const distanceMi = Number(w.distanceMi);
    const durationSec = Number(w.durationSec);
    if (!rawISO || !(distanceMi > 0) || !(durationSec > 0)) { skipped++; continue; }
    // Convert true-UTC AH instant to Strava's "wall-clock + Z" frame so
    // dedup proximity matches a Strava twin of the same session.
    const startISO = utcToWallClockZ(rawISO, tz);
    try {
      const res = await upsertCanonicalRun(user.id, {
        startISO,
        distanceMi,
        durationSec,
        avgHr: w.avgHr != null ? Number(w.avgHr) : null,
        maxHr: w.maxHr != null ? Number(w.maxHr) : null,
        name: w.name || 'Run',
        type: 'easy',
        source: 'apple_health',
      }, user.timezone);
      if (res.written) imported++; else skipped++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
