/**
 * POST /api/plan/simulate
 *
 * Plan simulator · 2026-06-22. Takes synthetic onboarding answers (SimInputs),
 * runs the REAL plan engine on them in-memory, and returns the composed plan +
 * a validation verdict. Writes NOTHING to the database — pure computation.
 *
 * Pipeline mirrors generatePlan's race-prep path exactly:
 *   simInputsToComposeInput → composePlan → finalizeComposedPlan → validate
 *
 * Unlike generatePlan, a validation failure does NOT throw away the plan: the
 * simulator surfaces the composed plan alongside the violations so you can see
 * what the engine built and why it would be rejected.
 *
 * Gated behind a logged-in session (no data access, but it exposes engine
 * internals). v1 = race-prep mode, the mode every race-goal onboarding hits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { composePlan, finalizeComposedPlan } from '@/lib/plan/generate';
import { validateComposedPlan, PlanValidationError } from '@/lib/plan/validate';
import { simInputsToComposeInput, type SimInputs, SIM_DISTANCE_MI } from '@/lib/plan/sim-inputs';
import { requireUserId } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as Partial<SimInputs> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, reason: 'invalid body' }, { status: 400 });
  }
  if (!body.distance || !(body.distance in SIM_DISTANCE_MI)) {
    return NextResponse.json({ ok: false, reason: 'distance must be one of 5k, 10k, half, marathon' }, { status: 400 });
  }
  if (!body.raceDateISO || !body.startDateISO) {
    return NextResponse.json({ ok: false, reason: 'raceDateISO and startDateISO required' }, { status: 400 });
  }

  try {
    const translated = simInputsToComposeInput(body as SimInputs);
    if (!translated.ok || !translated.compose) {
      // Guard failure (race too close / too far / bad date). 200 so the panel
      // renders the message inline instead of a console error mid-edit.
      return NextResponse.json({ ok: false, reason: translated.reason ?? 'could not build plan' });
    }

    const compose = translated.compose;
    const composed = composePlan(compose);
    finalizeComposedPlan(composed, compose.raceDistanceMi);

    // Validate exactly as generatePlan would (race-prep), but capture the
    // verdict instead of letting it abort — the simulator shows rejected plans.
    let validation: { valid: boolean; violations: string[] };
    try {
      validateComposedPlan(composed, compose.raceDistanceMi, 'race-prep', {
        level: compose.level,
        isSteppingStoneToMarathon: false,
        priorPlanPeakLongMi: null,
        todayISO: compose.startMondayISO,
        trainingDaysPerWeek: compose.trainingDaysPerWeek,
        trailingAvgWeeklyMi: compose.recentWeeklyMi > 0 ? compose.recentWeeklyMi : null,
      });
      validation = { valid: true, violations: [] };
    } catch (err) {
      if (err instanceof PlanValidationError) {
        validation = { valid: false, violations: err.violations };
      } else {
        throw err;
      }
    }

    return NextResponse.json({
      ok: true,
      derived: translated.derived,
      validation,
      plan: {
        totalWeeks: composed.totalWeeks,
        vols: composed.vols,
        weeks: composed.weeks.map((w) => ({
          startISO: w.startISO,
          phase: w.phase,
          weeklyMi: w.weeklyMi,
          isRaceWeek: w.isRaceWeek,
          tPaceSec: w.tPaceSec ?? null,
          days: w.days.map((d) => ({
            dow: d.dow,
            type: d.type,
            distanceMi: d.distanceMi,
            isQuality: d.isQuality,
            isLong: d.isLong,
            subLabel: d.subLabel,
            notes: d.notes,
          })),
        })),
      },
    });
  } catch (err: any) {
    console.error('[plan/simulate] error:', err);
    return NextResponse.json({ ok: false, reason: err?.message ?? 'simulation failed' }, { status: 500 });
  }
}
