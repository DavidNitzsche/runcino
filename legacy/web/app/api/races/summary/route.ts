/**
 * GET /api/races/summary
 *
 * Lightweight list of every race (upcoming + recent) for the iPhone
 * Races tab, slug, name, date, distance, goal, priority, days-away,
 * and the actual result for past races. Deliberately omits the heavy
 * gpxText + plan that /api/races returns (those are ~1.6 MB each).
 *
 * Anon-readable (mirrors /api/races): logged-in users get their own
 * races; anonymous callers fall back to the legacy 'me' demo races.
 *
 * Response: { ok, today, races: [{
 *   slug, name, date, distanceMi, goalDisplay, priority, daysAway,
 *   isPast, finishS, finishDisplay, paceDisplay }] }
 */

import { NextResponse } from 'next/server';
import { listRacesDB } from '@/lib/race-store';
import { ensureSeed } from '@/lib/seed-server';
import { requireActiveUser } from '@/lib/auth';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  await ensureSeed();
  let userId: string | undefined;
  try { userId = (await requireActiveUser(req)).id; } catch { /* anon ok */ }

  const today = todayISO();
  const todayMs = Date.parse(today + 'T12:00:00Z');
  const races = (await listRacesDB(userId)).map((r) => {
    const dateMs = Date.parse(r.meta.date + 'T12:00:00Z');
    const daysAway = Number.isNaN(dateMs) ? null : Math.round((dateMs - todayMs) / 86_400_000);
    const isPast = daysAway != null && daysAway < 0;
    const ar = r.actualResult;
    return {
      slug: r.slug,
      name: r.meta.name,
      date: r.meta.date,
      distanceMi: r.meta.distanceMi,
      goalDisplay: r.meta.goalDisplay,
      priority: r.meta.priority ?? 'A',
      daysAway,
      isPast,
      finishS: ar?.finishS ?? null,
      finishDisplay: ar?.finishDisplay ?? null,
      paceDisplay: ar?.paceDisplay ?? null,
    };
  });

  return NextResponse.json({ ok: true, today, races });
}
