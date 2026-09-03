/**
 * _probe_lifted_sensitivity.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 *
 * Rule 9 · "Before rebuilding, show what happens when the relevant input moves
 * across that boundary." The boundary is `resolveRampBase`'s
 * `RAMP_BASE_RESUME_FRACTION x sustained > mean` — the `lifted` switch.
 *
 * READ-ONLY. It composes in memory and writes nothing but /tmp/lifted-walk.txt.
 *
 * Run with:
 *   FAFF_LIFTED_PROBE=1 npx vitest run lib/plan/_probe_lifted_sensitivity.test.ts
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

describe.skipIf(!RUN)('LIFTED-SENSITIVITY · walk the 70% boundary on the real block', () => {
  it('walks and prints', async () => {
    const r = await composeForUser({ userId: DAVID, raceSlug: 'cim' });
    expect(r.ok, r.ok ? '' : (r as { ok: false; reason: string }).reason).toBe(true);
    if (!r.ok) return;
    const { compose, composed, todayISO, mode } = r.result;
    const ev0 = compose.rampBaseEvidence as RampBaseEvidence;

    // Rebuild the SAME daily series `rampBaseForBuild` read, so the walk moves
    // one input at a time against the runner's real history.
    const { mileageByDay, isoDaysBefore } = await import('@/lib/runs/volume');
    const WINDOW_DAYS = RAMP_BASE_LOOKBACK_WEEKS * 7;
    const byDay = await mileageByDay(DAVID, isoDaysBefore(todayISO, WINDOW_DAYS), todayISO);
    const daily: number[] = [];
    for (let i = 0; i < WINDOW_DAYS; i++) daily.push(byDay.get(isoDaysBefore(todayISO, i))?.mi ?? 0);
    const series = weeklyBlocksFromDaily(daily, RAMP_BASE_LOOKBACK_WEEKS);
    const peak = resolvePeakWeekly(daily);
    const allowed = ev0.allowedInterruptionWeeks;

    const out: string[] = [];
    out.push(`=== REFERENCE (${todayISO}, mode=${mode}) ===`);
    out.push(`series (most-recent-first 7-day sums) = ${JSON.stringify(series)}`);
    out.push(`peakWeekly = ${peak}   allowedInterruptionWeeks = ${allowed}`);
    out.push(`live evidence = ${JSON.stringify(ev0)}`);
    out.push(`boundary 0.70 x sustained = ${(ev0.sustainedMi * RAMP_BASE_RESUME_FRACTION).toFixed(3)}`);
    out.push(`live mean = ${ev0.meanMi} -> distance from boundary = ` +
      `${(ev0.meanMi - ev0.sustainedMi * RAMP_BASE_RESUME_FRACTION).toFixed(3)} mi`);
    out.push(`live vols = ${JSON.stringify(composed.vols)}`);
    out.push(`live blocks = ${JSON.stringify(composed.blocks)}`);

    function at(meanMi: number, altSeries?: number[]) {
      const s = altSeries ?? series;
      const ev = resolveRampBase({
        meanWeeklyMi: meanMi, weeklySeries: s,
        allowedInterruptionWeeks: allowed, peakWeeklyMi: peak,
      });
      const res = composePlan({
        ...compose,
        recentWeeklyMi: meanMi,
        rampBaseEvidence: ev,
        rampBaseMi: ev.baseMi,
      }) as ComposePlanResult;
      const longs = res.weeks.map((w) => w.days.find((d) => d.isLong)?.distanceMi ?? 0);
      return {
        meanMi, ev,
        vols: res.vols,
        phases: res.weeks.map((w) => w.phase[0]).join(''),
        peakWk: Math.max(...res.vols),
        peakLong: Math.max(...longs),
        total: Math.round(res.vols.reduce((a, b) => a + b, 0) * 10) / 10,
        nQuality: res.weeks.reduce((n, w) => n + w.days.filter((d) => d.isQuality).length, 0),
        steps: restoreSteps(ev.baseMi, ev.sustainedMi, ev.heldMi),
      };
    }
    type Row = ReturnType<typeof at>;

    function table(title: string, rows: Row[]) {
      out.push(`\n=== ${title} ===`);
      out.push(
        'mean'.padEnd(8) + 'lift'.padEnd(7) + 'base'.padEnd(7) + 'held'.padEnd(7) +
        'sust'.padEnd(7) + 'intr'.padEnd(6) + 'pkWk'.padEnd(6) + 'pkLng'.padEnd(7) +
        'total'.padEnd(8) + 'nQ'.padEnd(4) + 'phases'.padEnd(17) + 'vols',
      );
      for (const v of rows) {
        out.push(
          v.meanMi.toFixed(2).padEnd(8) +
          String(v.ev.lifted).padEnd(7) +
          v.ev.baseMi.toFixed(1).padEnd(7) +
          v.ev.heldMi.toFixed(1).padEnd(7) +
          v.ev.sustainedMi.toFixed(1).padEnd(7) +
          String(v.ev.interruptionWeeks).padEnd(6) +
          String(v.peakWk).padEnd(6) +
          v.peakLong.toFixed(1).padEnd(7) +
          v.total.toFixed(1).padEnd(8) +
          String(v.nQuality).padEnd(4) +
          v.phases.padEnd(17) +
          v.vols.join('/'),
        );
      }
      let worst = { field: '', jump: 0, from: 0, to: 0 };
      for (let i = 1; i < rows.length; i++) {
        const dm = Math.abs(rows[i].meanMi - rows[i - 1].meanMi) || 1;
        const cand: Array<[string, number, number]> = [
          ['peakWk', rows[i - 1].peakWk, rows[i].peakWk],
          ['total', rows[i - 1].total, rows[i].total],
          ['peakLong', rows[i - 1].peakLong, rows[i].peakLong],
        ];
        for (let k = 0; k < rows[i].vols.length; k++) {
          cand.push([`wk${k + 1}`, rows[i - 1].vols[k] ?? 0, rows[i].vols[k] ?? 0]);
        }
        for (const [f, a, b] of cand) {
          const j = Math.abs(b - a) * (0.1 / dm);
          if (j > worst.jump) worst = { field: f, jump: j, from: rows[i - 1].meanMi, to: rows[i].meanMi };
        }
      }
      out.push(`LARGEST JUMP normalised to 0.1 mi of mean: ${worst.field} = ${worst.jump.toFixed(2)} mi ` +
        `(between mean ${worst.from} and ${worst.to})`);
    }

    const B = ev0.sustainedMi * RAMP_BASE_RESUME_FRACTION;
    const scan: number[] = [];
    for (const m of [B - 12, B - 8, B - 4, B - 2, B - 1, B - 0.5]) scan.push(m);
    for (let m = B - 0.3; m <= B + 0.3 + 1e-9; m += 0.05) scan.push(m);
    for (const m of [B + 0.5, B + 1, B + 2, B + 4, B + 8, B + 12]) scan.push(m);
    const pts = scan.map((m) => Math.round(m * 100) / 100);

    // (A) The literal boundary: move the 28-day mean only.
    table('A · mean ONLY, series held (the literal `lifted` boundary)', pts.map((m) => at(m)));

    // (B) The honest walk: the four most recent weeks move WITH the mean, which
    // is how a real runner actually crosses this line.
    const tail = series.slice(4);
    table('B · four most recent weeks move WITH the mean (a real runner)',
      pts.map((m) => at(m, [m, m, m, m, ...tail])));

    // (C) The runner AS HE IS, with only his most recent completed week moved —
    // the single input a live authoring is most sensitive to.
    const held0 = Math.max(series[0], series[1]);
    out.push(`\n(heldMi input = max(series[0]=${series[0]}, series[1]=${series[1]}) = ${held0})`);

    require('fs').writeFileSync('/tmp/lifted-walk.txt', out.join('\n'));
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
  }, 300_000);
});
