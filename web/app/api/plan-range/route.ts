/**
 * /api/plan-range — multi-month engine simulation for the /plan page.
 *
 * Returns one entry per day from the first of the current month through
 * `months` calendar months forward (default 4 ≈ 120 days). The /plan
 * page groups these into calendar grids and renders each month.
 *
 * Powered by `simulateRange` in lib/coach-engine, which uses the same
 * per-day path the WEEK STRIP does (pickRun → applyConstraints) and
 * applies the tier-aware streak cap per Mon→Sun chunk so multi-month
 * cadence honors the runner's tier (Research/00b §Recovery Scaled
 * to Weekly Mileage).
 */

import { gatherCoachState } from '../../../lib/coach-state';
import { simulateRange, type CoachToday } from '../../../lib/coach-engine';

export interface PlanRangeApiOk {
  ok: true;
  today: string;
  startISO: string;
  endISO: string;
  days: CoachToday['weekShape'];
}

export interface PlanRangeApiErr {
  ok: false;
  error: string;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const monthsAhead = Math.max(1, Math.min(12, Number(url.searchParams.get('months') ?? '4')));

    const state = await gatherCoachState();
    const today = state.now;
    const start = new Date(today + 'T12:00:00Z');
    // Start on the first of the current month — gives a clean calendar
    // grid for the leading month.
    start.setUTCDate(1);
    const startISO = start.toISOString().slice(0, 10);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + monthsAhead);
    end.setUTCDate(0); // last day of the final month
    const endISO = end.toISOString().slice(0, 10);

    const days = simulateRange(state, startISO, endISO);
    const body: PlanRangeApiOk = { ok: true, today, startISO, endISO, days };
    return Response.json(body);
  } catch (e) {
    const err: PlanRangeApiErr = { ok: false, error: e instanceof Error ? e.message : String(e) };
    return Response.json(err, { status: 200 });
  }
}
