/**
 * POST /api/plan/simulate
 *
 * Plan simulator · 2026-06-22. Runs the REAL plan engine on synthetic NATIVE
 * onboarding answers in-memory and returns the composed plan + validation
 * verdict. Writes NOTHING to the database.
 *
 * All three engine modes are reachable (buildSimPlan dispatches via pickPlanMode):
 *   Goal → race-prep · Race → race-prep/maintenance/recovery · Just run → maintenance
 *
 * A validation failure does NOT discard the plan — the simulator surfaces the
 * composed plan alongside the violations. Gated behind a logged-in session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateComposedPlan, PlanValidationError } from '@/lib/plan/validate';
import { resolvePrescriptions, distanceCategoryOfPublic } from '@/lib/plan/generate';
import { buildSimPlan } from '@/lib/plan/sim-inputs';
import { SIM_DISTANCE_MI, type SimInputs, type SimDistance } from '@/lib/plan/sim-constants';
import { requireUserId } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as Partial<SimInputs> | null;
  if (!body || typeof body !== 'object' || !body.goalMode) {
    return NextResponse.json({ ok: false, reason: 'invalid body' }, { status: 400 });
  }

  try {
    // FID-2 · resolve the REAL level + phase-aware prescriptions from workout_library
    // (matching production) so the sim shows what the runner would actually get;
    // buildSimPlan falls back to the inline catalog if this DB read is unavailable.
    let rxOverride: Parameters<typeof buildSimPlan>[1];
    const raceDistMi = body.goalMode === 'justRun' ? SIM_DISTANCE_MI.half : SIM_DISTANCE_MI[body.distance as SimDistance];
    if (raceDistMi) {
      const cat = distanceCategoryOfPublic(raceDistMi);
      try {
        const [rxQuality, rxRaceSpecific] = await Promise.all([
          resolvePrescriptions(cat, 'quality', body.experienceLevel ?? null),
          resolvePrescriptions(cat, 'race_specific', body.experienceLevel ?? null),
        ]);
        rxOverride = { rxQuality, rxRaceSpecific };
      } catch { /* DB unavailable → inline fallback in buildSimPlan */ }
    }
    const built = buildSimPlan(body as SimInputs, rxOverride);
    if (!built.ok) {
      // Guard failure (race too close / bad date). 200 so the panel renders the
      // message inline instead of a console error mid-edit.
      return NextResponse.json({ ok: false, reason: built.reason });
    }

    let validation: { valid: boolean; violations: string[] };
    try {
      validateComposedPlan(built.composed, built.raceDistanceMi, built.mode, built.validateCtx);
      validation = { valid: true, violations: [] };
    } catch (err) {
      if (err instanceof PlanValidationError) validation = { valid: false, violations: err.violations };
      else throw err;
    }

    const c = built.composed;
    return NextResponse.json({
      ok: true,
      mode: built.mode,
      derived: built.derived,
      validation,
      plan: {
        totalWeeks: c.totalWeeks,
        vols: c.vols,
        weeks: c.weeks.map((w) => ({
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
