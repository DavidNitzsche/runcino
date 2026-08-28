/**
 * _dosing_sweep_gate.test.ts · Daniels' dosing caps over the WHOLE archetype
 * matrix (2026-08-28).
 *
 * The owner's ruling was "measure, then enforce if clean". The measurement ran
 * on 2026-08-28 across every archetype `./sim-matrix` generates — the same
 * corpus `_sweep_allusers.test.ts` grades — and the corpus composes with ZERO
 * enforced breaches: `applyDosingCaps` (generate.ts) clamps at authoring and
 * `validateComposedPlan` §10 makes any survivor fatal, so the detector that
 * shipped OFF on 2026-08-19 (178/180 archetypes breaching) is now an enforcer
 * with a clean corpus behind it. This file is that measurement kept as a gate,
 * so the number can never quietly stop being zero.
 *
 * ── What gates and what is only reported ───────────────────────────────────
 *
 * `enforced` findings (percentage caps on training weeks, absolute ceilings
 * everywhere — `capEnforced` in ./dosing) must be ZERO. Non-enforced findings
 * — percentage caps on taper and race weeks — are doctrine-sanctioned
 * (Research/08 §9.1-9.2, bound by DOSING.taper-percentage-exemption) and are
 * REPORTED, never failed on. The report also splits ROUNDING-LEVEL breaches
 * (within one 0.5 mi day-snap of the cap) from STRUCTURAL ones (the
 * composition asked for more than doctrine allows), because the two demand
 * different fixes: a snap is arithmetic, a structural breach is a defect in
 * what the composer wants.
 *
 * The full per-finding dump prints under FAFF_DOSING_PROBE=1:
 *
 *   FAFF_DOSING_PROBE=1 npx vitest run lib/plan/_dosing_sweep_gate.test.ts \
 *     --disable-console-intercept
 *
 * The gate itself always runs — the whole matrix composes in seconds (see the
 * sweep's own timing note) and a cap gate that has to be requested is not a
 * gate.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { validateComposedPlan, PlanValidationError } from './validate';
import { planDosingFindings, type DosingFinding } from './dosing';
import { matrix, arcStr, type Arc } from './sim-matrix';

const REPORT = !!process.env.FAFF_DOSING_PROBE;

/** One 0.5 mi day-snap: a breach at or under this is arithmetic, not intent. */
const ROUNDING_MI = 0.5;

/** Exactly the inputs the conformance sweep hands `buildSimPlan`, so the two
 *  gates measure the same plans byte-for-byte. */
function build(a: Arc) {
  return buildSimPlan({
    ...a, startDateISO: '2026-07-06', raceDateISO: a.raceDateISO ?? '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
    raceHistory: [], longRunDay: 'sun', availableDays: a.availableDays ?? [],
  } as never);
}

describe('Daniels dosing caps · full-matrix gate', () => {
  it('the whole archetype corpus composes with zero enforced cap breaches', () => {
    let swept = 0;
    let composed = 0;
    const enforced: { a: Arc; f: DosingFinding }[] = [];
    const reported: { a: Arc; f: DosingFinding }[] = [];
    // pace/scope/context → count, for the per-cap breakdown either way.
    const tally = new Map<string, number>();

    for (const a of matrix()) {
      swept++;
      const built = build(a);
      if (!built.ok) continue; // refusals are graded by the conformance sweep
      composed++;
      for (const f of planDosingFindings(built.composed.weeks as never)) {
        const bucket = f.enforced ? enforced : reported;
        bucket.push({ a, f });
        const key = `${f.enforced ? 'ENFORCED' : 'reported'} ${f.pace}/${f.scope}/${f.context}`
          + ` ${f.overByMi <= ROUNDING_MI ? 'rounding' : 'STRUCTURAL'}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
    }

    const worst = [...enforced, ...reported].sort((x, y) => y.f.overByMi - x.f.overByMi);
    console.log(`\n=== DOSING GATE · swept ${swept} archetypes, ${composed} composed ===`);
    console.log(`enforced breaches: ${enforced.length} · reported (taper/race-week %): ${reported.length}`);
    for (const [k, v] of [...tally].sort((x, y) => y[1] - x[1])) console.log(`  [${v}] ${k}`);
    for (const { a, f } of worst.slice(0, REPORT ? 200 : 5)) {
      console.log(`  ${f.enforced ? 'ENFORCED' : 'reported'} ${arcStr(a)} · ${f.weekStartISO} ${f.phase} · ${f.message}`);
    }

    // THE GATE. `applyDosingCaps` runs inside `finalizeComposedPlan`, which
    // every composer path (race-prep, maintenance, recovery) passes through,
    // so an enforced finding here means a session escaped the ledger, the
    // trimmer AND the budget — a regression in the enforcement chain itself.
    expect(
      enforced.length,
      `${enforced.length} enforced dosing-cap breaches across the corpus — see log`,
    ).toBe(0);
  }, 120_000);

  it('an enforced breach is FATAL in validateComposedPlan, not advisory', () => {
    // One real plan, verified clean, then handed a week that spends double the
    // weekly T allowance. If validate ever goes back to reporting instead of
    // failing — the pre-2026-08-18 advisory shape — this is the test that says
    // so, without waiting for the corpus to regress.
    const a: Arc = {
      goalMode: 'goal', distance: 'marathon', experienceLevel: 'advanced',
      weeklyFrequency: 6, weeklyMileageBucket: 45, longestRunBucket: '10+',
      goalTimeSec: 13500, planWeeks: 18,
    };
    const built = build(a);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const ctx = { ...built.validateCtx, trailingAvgWeeklyMi: null };
    // Clean as composed.
    validateComposedPlan(built.composed, built.raceDistanceMi, built.mode, ctx);

    // Inflate: a training-week long run rewritten to carry a half-marathon-pace
    // segment past the weekly 10% T cap (extractLongSegments → dosePace T).
    const week = built.composed.weeks.find((w: { phase?: string | null; isRaceWeek?: boolean; weeklyMi: number; days: { isLong?: boolean; type: string; distanceMi: number }[] }) =>
      String(w.phase ?? '') !== 'TAPER' && !w.isRaceWeek && w.weeklyMi >= 25 &&
      w.days.some((d) => d.isLong && d.type !== 'race' && d.distanceMi >= 10));
    expect(week, 'no mutable training week found in an 18-week marathon plan').toBeTruthy();
    const long = week!.days.find((d: { isLong?: boolean; type: string; distanceMi: number }) => d.isLong && d.type !== 'race' && d.distanceMi >= 10)!;
    const overMi = Math.min(long.distanceMi, Math.ceil(week!.weeklyMi * 0.2) + 1);
    (long as { subLabel?: string | null }).subLabel = `LONG · ${overMi}mi @ HM`;

    let thrown: PlanValidationError | null = null;
    try { validateComposedPlan(built.composed, built.raceDistanceMi, built.mode, ctx); }
    catch (e) { if (e instanceof PlanValidationError) thrown = e; else throw e; }
    expect(thrown, 'an enforced dosing breach did not fail validation').toBeTruthy();
    expect(
      thrown!.violations.some((v) => /doctrine caps it at/.test(v)),
      `validation failed but not on the dosing cap: ${thrown!.violations.join(' | ')}`,
    ).toBe(true);
  }, 30_000);
});
