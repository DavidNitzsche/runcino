/**
 * _probe_lifted_isolate.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 *
 * Walk B of `_probe_lifted_sensitivity` found a 9.5 mi step in block total
 * across 0.05 mi of input. That walk moved TWO things at once (the 28-day mean
 * and the demonstrated volume). This isolates them.
 *
 * READ-ONLY. FAFF_LIFTED_PROBE=1 npx vitest run lib/plan/_probe_lifted_isolate.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  composeForUser,
  composePlan,
  resolveRampBase,
  resolvePeakWeekly,
  weeklyBlocksFromDaily,
  restoreSteps,
  RAMP_BASE_RESUME_FRACTION,
  RAMP_BASE_LOOKBACK_WEEKS,
  type ComposePlanResult,
  type RampBaseEvidence,
} from './generate';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RUN = !!process.env.FAFF_LIFTED_PROBE;

describe.skipIf(!RUN)('LIFTED-ISOLATE', () => {
  it('walks each axis alone', async () => {
    const r = await composeForUser({ userId: DAVID, raceSlug: 'cim' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { compose, todayISO } = r.result;
    const ev0 = compose.rampBaseEvidence as RampBaseEvidence;
    const { mileageByDay, isoDaysBefore } = await import('@/lib/runs/volume');
    const WINDOW_DAYS = RAMP_BASE_LOOKBACK_WEEKS * 7;
    const byDay = await mileageByDay(DAVID, isoDaysBefore(todayISO, WINDOW_DAYS), todayISO);
    const daily: number[] = [];
    for (let i = 0; i < WINDOW_DAYS; i++) daily.push(byDay.get(isoDaysBefore(todayISO, i))?.mi ?? 0);
    const series = weeklyBlocksFromDaily(daily, RAMP_BASE_LOOKBACK_WEEKS);
    const peak = resolvePeakWeekly(daily);
    const allowed = ev0.allowedInterruptionWeeks;
    const B = ev0.sustainedMi * RAMP_BASE_RESUME_FRACTION;
    const out: string[] = [];

    function run(meanMi: number, s: number[]) {
      const ev = resolveRampBase({
        meanWeeklyMi: meanMi, weeklySeries: s,
        allowedInterruptionWeeks: allowed, peakWeeklyMi: peak,
      });
      const res = composePlan({
        ...compose, recentWeeklyMi: meanMi,
        rampBaseEvidence: ev, rampBaseMi: ev.baseMi,
      }) as ComposePlanResult;
      return {
        ev, vols: res.vols,
        total: Math.round(res.vols.reduce((a, b) => a + b, 0) * 10) / 10,
        steps: restoreSteps(ev.baseMi, ev.sustainedMi, ev.heldMi),
      };
    }

    function table(title: string, xs: number[], mk: (x: number) => { mean: number; s: number[] }) {
      out.push(`\n=== ${title} ===`);
      out.push('x'.padEnd(8) + 'mean'.padEnd(8) + 'lift'.padEnd(7) + 'base'.padEnd(7) +
        'held'.padEnd(7) + 'hbc'.padEnd(7) + 'intr'.padEnd(6) + 'total'.padEnd(8) +
        'steps'.padEnd(22) + 'vols');
      let prev: ReturnType<typeof run> | null = null;
      let px = 0;
      for (const x of xs) {
        const { mean, s } = mk(x);
        const v = run(mean, s);
        out.push(x.toFixed(2).padEnd(8) + mean.toFixed(2).padEnd(8) +
          String(v.ev.lifted).padEnd(7) + v.ev.baseMi.toFixed(1).padEnd(7) +
          v.ev.heldMi.toFixed(1).padEnd(7) + String(v.ev.heldByCurrent).padEnd(7) +
          String(v.ev.interruptionWeeks).padEnd(6) + v.total.toFixed(1).padEnd(8) +
          JSON.stringify(v.steps).padEnd(22) + v.vols.join('/'));
        if (prev && Math.abs(v.total - prev.total) > 0.05) {
          out.push(`   ^^ TOTAL STEP ${(v.total - prev.total).toFixed(1)} mi across ` +
            `${(x - px).toFixed(2)} mi of x`);
        }
        prev = v; px = x;
      }
    }

    const fine: number[] = [];
    for (let x = B - 0.6; x <= B + 0.6 + 1e-9; x += 0.02) fine.push(Math.round(x * 100) / 100);

    // AXIS 1 · the 28-day MEAN alone. `lifted` is exactly `B > mean`, so this is
    // the literal boundary. Demonstrated volume held at the runner's real 44.
    table('1 · MEAN alone (series untouched · heldMi stays 44)', fine, (x) => ({ mean: x, s: series }));

    // AXIS 2 · the mean alone, on a runner whose recent weeks are LOW, so
    // `heldMi` cannot mask the lift.
    const lowTail = [10, 10, ...series.slice(2)];
    table('2 · MEAN alone (recent two weeks 10 mi · heldMi = 10)', fine, (x) => ({ mean: x, s: lowTail }));

    // AXIS 3 · DEMONSTRATED VOLUME alone, mean pinned at the runner's real 34.2.
    table('3 · demonstrated volume alone (mean pinned 34.2)', fine,
      (x) => ({ mean: 34.2, s: [x, x, ...series.slice(2)] }));

    // AXIS 4 · demonstrated volume alone, mean pinned BELOW the boundary so
    // `lifted` is true throughout and cannot be the explanation.
    table('4 · demonstrated volume alone (mean pinned 25 · lifted always true)', fine,
      (x) => ({ mean: 25, s: [x, x, ...series.slice(2)] }));

    // AXIS 5 · the RESIDUAL boundary LADDER-LENGTH-1 leaves behind:
    // `first == 0.775 x sustained`, i.e. `held == sustained x 0.775 - step`.
    const resid = ev0.sustainedMi * 0.775 - ev0.sustainedMi * 0.15;
    const fine5: number[] = [];
    for (let x = resid - 0.6; x <= resid + 0.6 + 1e-9; x += 0.02) fine5.push(Math.round(x * 100) / 100);
    out.push(`\n(residual boundary: first = 0.775 x sustained = ${(ev0.sustainedMi * 0.775).toFixed(2)}` +
      ` -> held = ${resid.toFixed(2)})`);
    table('5 · demonstrated volume across the RESIDUAL boundary (mean pinned 25)', fine5,
      (x) => ({ mean: 25, s: [x, x, ...series.slice(2)] }));

    require('fs').writeFileSync('/tmp/lifted-isolate.txt', out.join('\n'));
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
  }, 600_000);
});
