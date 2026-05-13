/**
 * /api/plan-range — multi-month plan view for the /plan page.
 *
 * Returns one entry per day from the first of the current month through
 * `months` calendar months forward (default 4 ≈ 120 days). The /plan
 * page groups these into calendar grids and renders each month.
 *
 * Powered by `getCurrentPlan` — the plan-as-artifact lifecycle entry
 * point. Every day comes from the real persisted plan (phases, volume
 * curve, doctrine-grounded workout types) rather than a per-day engine
 * simulation. Pace targets are derived from the runner's VDOT via
 * Daniels' bands (Research/01 §Daniels training paces).
 *
 * Days that fall before the plan starts or after it ends show REST so
 * the calendar grid stays complete without fabricating prescriptions.
 */

import { getCurrentPlan } from '../../../coach/plan-lifecycle';
import { gatherCoachState } from '../../../lib/coach-state';
import { vdotSnapshot, pacesFromVdot, type DanielsPaceSet } from '../../../lib/vdot';
import type { RunWorkoutType } from '../../../lib/coach-workouts';
import type { CoachToday } from '../../../lib/coach-engine';

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

// ─── Type mapping: plan-as-artifact → RunWorkoutType ──────────────────────────
// The /plan page renders using RunWorkoutType for colour + label logic.
// Mapping is one-way — these strings are only for UI rendering.

function mapToRunType(planType: string): RunWorkoutType {
  switch (planType) {
    case 'easy':      return 'general_aerobic';
    case 'long':      return 'long_steady';
    case 'threshold': return 'threshold';
    case 'interval':  return 'vo2';
    case 'mp':        return 'marathon_specific';
    case 'race':      return 'race';
    case 'shakeout':  return 'shakeout';
    case 'recovery':  return 'recovery';
    case 'rest':      return 'rest';
    default:          return 'general_aerobic';
  }
}

function mapToLabel(planType: string): string {
  switch (planType) {
    case 'easy':      return 'Easy Run';
    case 'long':      return 'Long Run · Steady';
    case 'threshold': return 'Threshold Tempo';
    case 'interval':  return 'VO₂ Max Intervals';
    case 'mp':        return 'Marathon Pace';
    case 'race':      return 'Race';
    case 'shakeout':  return 'Shakeout';
    case 'recovery':  return 'Recovery Run';
    case 'rest':      return 'Rest';
    default:          return 'Easy Run';
  }
}

function mapToDescription(planType: string): string {
  switch (planType) {
    case 'easy':      return 'Easy / conversational. E pace per Daniels (Research/01).';
    case 'long':      return 'Long aerobic run at E pace. Builds durability (Research/00a §Long runs).';
    case 'threshold': return 'Threshold continuous block at T pace (Research/01 §Daniels training paces).';
    case 'interval':  return 'VO₂max intervals at I pace — 1000-1200 m reps (Research/01 §Dosing rules).';
    case 'mp':        return 'Marathon-pace block (Research/01 §M pace).';
    case 'race':      return 'Race day — execute per race-week pacing strategy (Research/08).';
    case 'shakeout':  return 'Short shakeout, optional 4 strides.';
    case 'recovery':  return 'Recovery run — below E pace. Circulation, not adaptation.';
    case 'rest':      return 'Full rest day.';
    default:          return '';
  }
}

/** Daniels pace band for a given plan workout type. */
function paceForType(
  planType: string,
  paces: DanielsPaceSet | null,
): { lowS: number; highS: number } | null {
  if (!paces) return null;
  switch (planType) {
    case 'easy':      return paces.E;
    case 'long':      return paces.E;
    case 'threshold': return paces.T;
    case 'interval':  return paces.I;
    case 'mp':        return paces.M;
    default:          return null;
  }
}

/** REST-day entry for dates outside the plan window. */
function restDay(dateISO: string, todayISO: string): CoachToday['weekShape'][number] {
  return {
    date: dateISO,
    type: 'rest',
    label: 'Rest',
    distanceMi: 0,
    description: 'No plan for this date.',
    paceTargetSPerMi: null,
    hrZone: null,
    isQuality: false,
    isLong: false,
    isToday: dateISO === todayISO,
    hasStrength: false,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const monthsAhead = Math.max(1, Math.min(12, Number(url.searchParams.get('months') ?? '4')));

    // Run plan lifecycle + coach state in parallel.
    // getCurrentPlan internally calls gatherCoachState, but we also call
    // it separately here to get the VDOT snapshot for pace targets.
    const [{ plan }, state] = await Promise.all([
      getCurrentPlan('me'),
      gatherCoachState(),
    ]);

    const today = state.now;
    const start = new Date(today + 'T12:00:00Z');
    start.setUTCDate(1); // first of the current month
    const startISO = start.toISOString().slice(0, 10);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + monthsAhead);
    end.setUTCDate(0); // last day of the final month
    const endISO = end.toISOString().slice(0, 10);

    // Pace bands from VDOT (Research/01 §Daniels training paces).
    const vdot = vdotSnapshot(state);
    const paces = vdot ? pacesFromVdot(vdot.vdot) : null;

    // Build a date → workout lookup from the plan.
    const workoutByDate = new Map<string, CoachToday['weekShape'][number]>();
    if (plan) {
      for (const week of plan.weeks) {
        for (const w of week.workouts) {
          const pace = paceForType(w.type, paces);
          workoutByDate.set(w.dateISO, {
            date: w.dateISO,
            type: mapToRunType(w.type),
            label: w.subLabel ?? mapToLabel(w.type),
            distanceMi: w.distanceMi,
            description: w.notes || mapToDescription(w.type),
            paceTargetSPerMi: pace,
            hrZone: null,
            isQuality: w.isQuality,
            isLong: w.isLong,
            isToday: w.dateISO === today,
            hasStrength: w.hasStrength,
          });
        }
      }
    }

    // Expand every calendar day in the window.
    const days: CoachToday['weekShape'] = [];
    const cursor = new Date(startISO + 'T12:00:00Z');
    const endDate = new Date(endISO + 'T12:00:00Z');
    while (cursor <= endDate) {
      const dateISO = cursor.toISOString().slice(0, 10);
      days.push(workoutByDate.get(dateISO) ?? restDay(dateISO, today));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const body: PlanRangeApiOk = { ok: true, today, startISO, endISO, days };
    return Response.json(body);
  } catch (e) {
    const err: PlanRangeApiErr = { ok: false, error: e instanceof Error ? e.message : String(e) };
    return Response.json(err, { status: 200 });
  }
}
