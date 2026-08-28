/**
 * /api/travel · the runner's travel windows (TRAVEL-1, 2026-08-28).
 *
 *   GET              → { windows: [{ id, start_date, end_date, note }] }
 *   POST   {start_date, end_date, note?}       → create
 *   PATCH  {id, start_date, end_date, note?}   → edit
 *   DELETE {id}                                → remove
 *
 * Owner ruling: travel is "something the phone should surface, not me and
 * you in the backend" — this is the endpoint the phone's Settings surface
 * writes. The plan keeps the runner running through a window (travel days
 * are easy-preferred; quality and the long run land on home days where the
 * week has room) · see lib/plan/travel-windows.ts.
 *
 * A write whose window overlaps the ACTIVE plan fires the same inline
 * rebuild path a long-run-day change does (rebuildActivePlanForPrefs), so
 * the calendar reshapes immediately instead of waiting for the next organic
 * rebuild. A window outside the plan simply waits — the next authoring reads
 * it from loadGeneratorInputs.
 *
 * Sibling of /api/settings (same auth, same rebuild contract, same
 * isolated-failure stance: the save succeeds even when the rebuild cannot).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { rebuildActivePlanForPrefs } from '@/lib/plan/auto-rebuild';
import {
  createTravelWindow,
  deleteTravelWindow,
  invalidWindowReason,
  listTravelWindows,
  updateTravelWindow,
  windowTouchesActivePlan,
  type TravelWindowRow,
} from '@/lib/plan/travel-store';

// A window overlapping the active plan re-runs generatePlan inline · same
// headroom the settings route gives the same rebuild.
export const maxDuration = 120;

function wire(w: TravelWindowRow) {
  return { id: w.id, start_date: w.startISO, end_date: w.endISO, note: w.note };
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const windows = await listTravelWindows(auth);
    return NextResponse.json({ windows: windows.map(wire) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}

function parseWindowBody(body: any): { startISO: string; endISO: string; note: string | null } {
  return {
    startISO: String(body?.start_date ?? ''),
    endISO: String(body?.end_date ?? ''),
    note: body?.note != null && String(body.note).trim() !== '' ? String(body.note).trim() : null,
  };
}

/** Rebuild the active plan when the window touches it · isolated, the save
 *  already landed. Returns whether a rebuild produced a new plan. */
async function maybeReplan(userId: string, startISO: string, endISO: string): Promise<boolean> {
  const touches = await windowTouchesActivePlan(userId, startISO, endISO).catch(() => false);
  if (!touches) return false;
  const r = await rebuildActivePlanForPrefs(userId, ['travel_windows']).catch(() => ({ ok: false as const }));
  return !!r.ok;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const w = parseWindowBody(body);
  const bad = invalidWindowReason(w);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  try {
    const row = await createTravelWindow(auth, w);
    const replanned = await maybeReplan(auth, w.startISO, w.endISO);
    return NextResponse.json({ ok: true, window: wire(row), replanned });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!body || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  const w = parseWindowBody(body);
  const bad = invalidWindowReason(w);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  try {
    // The OLD range matters too · shrinking a window away from the plan must
    // also reshape it, so the touch test runs against the union of both.
    const before = (await listTravelWindows(auth)).find((x) => x.id === id);
    const row = await updateTravelWindow(auth, id, w);
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const spanStart = before && before.startISO < w.startISO ? before.startISO : w.startISO;
    const spanEnd = before && before.endISO > w.endISO ? before.endISO : w.endISO;
    const replanned = await maybeReplan(auth, spanStart, spanEnd);
    return NextResponse.json({ ok: true, window: wire(row), replanned });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  try {
    const before = (await listTravelWindows(auth)).find((x) => x.id === id);
    const gone = await deleteTravelWindow(auth, id);
    if (!gone) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const replanned = before
      ? await maybeReplan(auth, before.startISO, before.endISO)
      : false;
    return NextResponse.json({ ok: true, replanned });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
