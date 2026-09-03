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
import { resolvePrescriptions } from '@/lib/plan/generate';
import { distanceCategoryOrNull } from '@/lib/race/distance-category';
import { buildSimPlan, simCapacityBand } from '@/lib/plan/sim-inputs';
import { SIM_DISTANCE_MI, type SimInputs, type SimDistance } from '@/lib/plan/sim-constants';
import { requireUserId } from '@/lib/auth/session';
import { outage } from '@/lib/route/failure';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as Partial<SimInputs> | null;
  if (!body || typeof body !== 'object' || !body.goalMode) {
    return NextResponse.json({ ok: false, reason: 'invalid body' }, { status: 400 });
  }

  try {
    // FID-2 · resolve the REAL level + phase-aware prescriptions from the
    // in-code workout library (lib/plan/workout-library-static.ts, matching
    // production) so the sim shows what the runner would actually get.
    let rxOverride: Parameters<typeof buildSimPlan>[1];
    const raceDistMi = body.goalMode === 'justRun' ? SIM_DISTANCE_MI.half : SIM_DISTANCE_MI[body.distance as SimDistance];
    if (raceDistMi) {
      const cat = distanceCategoryOrNull(raceDistMi);
      try {
        if (cat == null) throw new Error('unknown sim distance');
        // TIEREVIDENCE-2 · the workout library is filtered on DEMONSTRATED
        // capacity, resolved the same way `loadGeneratorInputs` resolves it, so
        // the sim keeps showing what the runner would actually get (PARITY-1).
        // `experienceLevel` is still passed and is now ignored.
        const rxBand = simCapacityBand(body as SimInputs, raceDistMi);
        const [rxQuality, rxRaceSpecific] = await Promise.all([
          resolvePrescriptions(cat, 'quality', body.experienceLevel ?? null, rxBand),
          resolvePrescriptions(cat, 'race_specific', body.experienceLevel ?? null, rxBand),
        ]);
        rxOverride = { rxQuality, rxRaceSpecific };
      } catch { /* resolution failure → inline fallback in buildSimPlan */ }
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
  } catch (err: unknown) {
    // Was `reason: err?.message`. `reason` is the key the phone reads a
    // REFUSAL out of, so this put a Postgres string where the engine's own
    // sentence goes. The 500 kept it from decoding as `.absent`, which is
    // luck, not design.
    return outage('plan/simulate', err);
  }
}
