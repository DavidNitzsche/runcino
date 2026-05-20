/**
 * POST /api/plan/reschedule — runner moves or swaps a planned workout.
 *
 * body: { action: 'move' | 'swap', fromDateISO, toDateISO }
 *   move — move the workout on fromDate to toDate. If toDate already has
 *          a workout, the two exchange dates (so no day ends up doubled).
 *   swap — exchange the workouts on the two dates (both must exist).
 *
 * Updates the live plan_workouts rows (date_iso + dow). The original_*
 * columns are preserved by the store, so the coach can still see what
 * was originally prescribed. No coach-signal mutation is logged — this
 * is a manual reschedule, not an engine adaptation.
 *
 * Auth optional: anonymous → the legacy 'me' demo plan.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActivePlan, updateWorkout } from '@/lib/plan-store';
import { resolvePlanUserId } from '@/lib/plan-user';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function dowOf(iso: string): number {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

export async function POST(req: NextRequest) {
  let body: { action?: string; fromDateISO?: string; toDateISO?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const action = body.action;
  const from = body.fromDateISO ?? '';
  const to = body.toDateISO ?? '';
  if (action !== 'move' && action !== 'swap') {
    return NextResponse.json({ error: "action must be 'move' or 'swap'" }, { status: 400 });
  }
  if (!ISO.test(from) || !ISO.test(to)) {
    return NextResponse.json({ error: 'fromDateISO + toDateISO (YYYY-MM-DD) required' }, { status: 400 });
  }
  if (from === to) return NextResponse.json({ ok: true, noop: true });

  const plan = await getActivePlan(await resolvePlanUserId());
  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 404 });

  const all = plan.weeks.flatMap((w) => w.workouts);
  const a = all.find((w) => w.dateISO === from);
  if (!a) return NextResponse.json({ error: 'No workout on fromDate', from }, { status: 404 });
  const b = all.find((w) => w.dateISO === to);

  if (action === 'swap' && !b) {
    return NextResponse.json({ error: 'Nothing to swap with on toDate', to }, { status: 400 });
  }

  await updateWorkout({ ...a, dateISO: to, dow: dowOf(to) });
  if (b) await updateWorkout({ ...b, dateISO: from, dow: dowOf(from) });

  return NextResponse.json({ ok: true, moved: from, to, swapped: !!b });
}
