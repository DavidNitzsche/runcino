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

interface IncomingWorkout {
  startISO?: string;
  distanceMi?: number;
  durationSec?: number;
  avgHr?: number | null;
  maxHr?: number | null;
  name?: string;
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
  for (const w of workouts) {
    const startISO = typeof w.startISO === 'string' ? w.startISO : '';
    const distanceMi = Number(w.distanceMi);
    const durationSec = Number(w.durationSec);
    if (!startISO || !(distanceMi > 0) || !(durationSec > 0)) { skipped++; continue; }
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
      });
      if (res.written) imported++; else skipped++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
