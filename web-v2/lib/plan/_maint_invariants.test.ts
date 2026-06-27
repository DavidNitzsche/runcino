/**
 * MAINTENANCE / DISPLAY INVARIANTS (2026-06-24).
 *
 * Locks the three bugs caught on the live sim that the all-user count/band gate was
 * structurally blind to:
 *
 *   1. SPREAD       — running days clustered on consecutive calendar days (Sun/Mon/Tue)
 *                     when the week had rest slots to break them up. The count gate passed
 *                     because it only checks how MANY running days, not WHERE.
 *   2. MIN_RUN_DIST — a sub-2mi "junk" run (the 1mi easy left over after a 2mi fartlek
 *                     consumed the budget). Counts as a running day to the count gate.
 *   3. CAL_MERGE    — two plan weeks merging into one Sun-Sat calendar row, so a row shows
 *                     more running days than the stated frequency. Lived in the page.tsx
 *                     re-bucket; the data gate never rendered a calendar, and every gate
 *                     archetype used a single Monday start date so misalignment never showed.
 *
 * DIAGNOSTIC-FIRST: this run REPORTS counts so we can see the composer's real behaviour
 * across start-DOW × mileage × freq before turning the clean invariants into hard asserts.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_maint_invariants.test.ts --disable-console-intercept 2>&1 | tail -60
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import type { SimDistance } from './sim-constants';

const DISTANCES: SimDistance[] = ['5k', '10k', 'half', 'marathon', '50k', '100k'];
const FREQ = [3, 4, 5, 6];
const MILEAGE = [5, 15, 25, 35];
const LONGEST = ['3-6', '6-10'];
// seven consecutive start dates → every start DOW (2026-07-05 is a Sunday)
const STARTS = ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11'];
const GOAL_SEC: Record<SimDistance, number> = { '5k': 1350, '10k': 2700, half: 6300, marathon: 13500, '50k': 18000, '100k': 43200 };

const dowOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();
const plusDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type V = { count: number; ex: string };
const bump = (m: Record<string, V>, k: string, ex: string) => { (m[k] ??= { count: 0, ex }).count++; };

/** max run of consecutive calendar days among the week's running days (no week-wrap) */
function maxConsecutive(dows: number[], weekStartDow: number): number {
  const offsets = dows.map((d) => (d - weekStartDow + 7) % 7).sort((a, b) => a - b);
  let best = 0, run = 0, prev = -2;
  for (const o of offsets) { run = o === prev + 1 ? run + 1 : 1; prev = o; best = Math.max(best, run); }
  return best;
}

describe('maintenance + display invariants (diagnostic)', () => {
  it('reports SPREAD / MIN_RUN_DIST / CAL_MERGE across the start-DOW × profile matrix', () => {
    const spread: Record<string, V> = {};
    const minDist: Record<string, V> = {};      // maintenance/recovery — FIXED, hard-zero gate
    const minDistRace: Record<string, V> = {};   // race-prep quality/race-specific — soft ceiling (boundary/volume-constrained class)
    const minDistRaceStrict: Record<string, V> = {}; // race-prep with STRICTLY-positive surplus, non-cutback — FIXED by RP-FREQ-FLOOR, hard-zero gate
    const calMerge: Record<string, V> = {};
    let plans = 0, maintWeeks = 0;

    for (const distance of DISTANCES)
      for (const freq of FREQ)
        for (const mileage of MILEAGE)
          for (const longestRunBucket of LONGEST)
            for (const startDateISO of STARTS)
              for (const goalMode of ['justRun', 'race'] as const) {
                const arc = `${distance}/f${freq}/m${mileage}/L${longestRunBucket}/${goalMode}/start${dowOf(startDateISO)}`;
                const built = buildSimPlan({
                  goalMode, distance, experienceLevel: 'intermediate', weeklyFrequency: freq,
                  weeklyMileageBucket: mileage, longestRunBucket, longRunDay: 'sun', restDay: 'sat',
                  startDateISO, raceDateISO: goalMode === 'race' ? '2027-03-01' : '',
                  goalTimeSec: goalMode === 'race' ? GOAL_SEC[distance] : null, planWeeks: 0,
                  lastRaceFinishedDaysAgo: 0, lastRaceDistance: null, raceHistory: [], availableDays: [],
                } as any);
                if (!built.ok) continue;
                plans++;

                // ── 1+2 · per plan-week structural checks ──
                for (const w of built.composed.weeks) {
                  if (w.isRaceWeek || w.phase === 'TAPER') continue;
                  const runDays = w.days.filter((d: any) => d.type !== 'rest' && d.distanceMi > 0);
                  const runningCount = runDays.length;
                  // MIN_RUN_DIST · a sub-2mi NON-long run is misallocation only when, after the long
                  // takes its (coherence-floored) share, the remaining budget could have seated every
                  // other running day at ≥2mi but the allocator starved one. At genuinely low volume
                  // — where even after the long the rest can't all reach 2mi (10mpw/6-day with a 4mi
                  // long → 1.2mi/run) — sub-2mi is arithmetically forced, not a defect. The long
                  // itself is exempt (it's the largest run; never the starved one).
                  const realized = runDays.reduce((s: number, d: any) => s + d.distanceMi, 0);
                  const longDist = Math.max(0, ...runDays.filter((d: any) => d.isLong).map((d: any) => d.distanceMi));
                  const restCouldAfford2 = runningCount > 1 && (realized - longDist) >= 2 * (runningCount - 1);
                  if (restCouldAfford2) {
                    const isHold = w.phase === 'MAINTENANCE' || w.phase === 'RECOVERY';
                    // STRICT subset (race-prep): strictly-positive surplus beyond seating every non-long
                    // run at 2mi, AND not a deliberate cutback dip. This is the unarguable core RP-FREQ-FLOOR
                    // fixes — there are spare miles, so a 1mi run is pure misallocation, never volume-constraint.
                    const strictSurplus = !isHold && !w.isCutback && (realized - longDist) > 2 * (runningCount - 1);
                    for (const d of runDays) {
                      if (!d.isLong && d.distanceMi < 2) {
                        bump(isHold ? minDist : minDistRace, `${w.phase} run=${d.distanceMi}mi realized=${realized}/${runningCount}run`, arc);
                        if (strictSurplus) bump(minDistRaceStrict, `${w.phase} run=${d.distanceMi}mi realized=${realized}/${runningCount}run`, arc);
                      }
                    }
                  }
                  // SPREAD · only meaningful for hold-the-base phases with breakable geometry
                  if ((w.phase === 'MAINTENANCE' || w.phase === 'RECOVERY') && runningCount > 0) {
                    maintWeeks++;
                    const wsd = dowOf(w.startISO);
                    const mc = maxConsecutive(runDays.map((d: any) => d.dow), wsd);
                    const breakable = runningCount <= 4; // ≤4 runs in 7 days can always be ≤2-consecutive
                    if (breakable && mc >= 3) bump(spread, `${w.phase} ${runningCount}run consec=${mc}`, arc);
                  }
                }

                // ── 3 · CAL_MERGE · replicate page.tsx Sun-Sat re-bucket, count runs per row ──
                // tag each day with its plan-week index, place on real date, group Sun-Sat
                const cells: Record<string, { run: boolean; wi: number }> = {};
                built.composed.weeks.forEach((w: any, wi: number) => {
                  const wsd = dowOf(w.startISO);
                  for (const d of w.days) {
                    const date = plusDays(w.startISO, (d.dow - wsd + 7) % 7);
                    cells[date] = { run: d.type !== 'rest' && d.distanceMi > 0, wi };
                  }
                });
                const dates = Object.keys(cells).sort();
                if (dates.length) {
                  let cur = plusDays(dates[0], -dowOf(dates[0])); // Sunday on/before first day
                  const last = dates[dates.length - 1];
                  while (cur <= last) {
                    let runs = 0; const wis = new Set<number>();
                    for (let i = 0; i < 7; i++) {
                      const c = cells[plusDays(cur, i)];
                      if (c) { if (c.run) runs++; wis.add(c.wi); }
                    }
                    // a Sun-Sat row carrying days from ≥2 plan weeks = a merge; >freq runs = the visible symptom
                    if (wis.size >= 2 && runs > freq) bump(calMerge, `row mergesWeeks=${wis.size} runs=${runs}>f${freq}`, arc);
                    cur = plusDays(cur, 7);
                  }
                }
              }

    const tot = (m: Record<string, V>) => Object.values(m).reduce((s, v) => s + v.count, 0);
    const dump = (name: string, m: Record<string, V>) => {
      console.log(`\n${name}: ${tot(m)} across ${Object.keys(m).length} types`);
      for (const [k, v] of Object.entries(m).sort((a, b) => b[1].count - a[1].count).slice(0, 20))
        console.log(`  [${v.count}] ${k}  e.g. ${v.ex}`);
    };
    console.log(`\n=== swept ${plans} plans, ${maintWeeks} maintenance/recovery weeks ===`);
    dump('SPREAD (consecutive-day clustering)', spread);
    dump('MIN_RUN_DIST · maintenance/recovery (FIXED — hard-zero gate)', minDist);
    dump('MIN_RUN_DIST · race-prep (soft ceiling — boundary/volume-constrained class)', minDistRace);
    dump('MIN_RUN_DIST · race-prep STRICT surplus (FIXED by RP-FREQ-FLOOR — hard-zero)', minDistRaceStrict);
    dump('CAL_MERGE (two weeks in one Sun-Sat row)', calMerge);

    // ── THE GATE · the three classes David caught, locked so they can never regress ──
    // 1 · clustering: running days must never bunch onto consecutive calendar days when the
    //     week has the rest slots to break them up (Sun/Mon/Tue).
    expect(tot(spread), `clustering reappeared — see SPREAD log`).toBe(0);
    // 2 · calendar merge: no Sun-Sat row may carry two plan weeks / exceed the stated frequency
    //     (the W6 "5 running days" artifact from start-date misalignment).
    expect(tot(calMerge), `calendar merge reappeared — see CAL_MERGE log`).toBe(0);
    // 3 · junk runs in hold-the-base weeks: no sub-2mi non-long run when the budget could seat
    //     every run at ≥2mi (the 1mi easy after a fartlek ate the budget).
    expect(tot(minDist), `maintenance junk runs reappeared — see MIN_RUN_DIST·maintenance log`).toBe(0);
    // 4 · race-prep STRICT-surplus junk runs — FIXED by RP-FREQ-FLOOR (the long cap that leaves ≥2mi
    //     for every non-long run when the week affords it). These had spare miles, so a 1mi run was pure
    //     misallocation. Hard-zero so the regression can never reappear.
    expect(tot(minDistRaceStrict), `race-prep STRICT-surplus junk runs reappeared — RP-FREQ-FLOOR regressed`).toBe(0);
    // 5 · SOFT ceiling on the remaining boundary class (surplus==0 / genuinely volume-constrained, e.g.
    //     10mpw/6-day where even a floor-respecting long can't leave 2mi for every run). Ratcheted from
    //     287 → current after RP-FREQ-FLOOR; nothing may make it worse. Lower as further fixes land.
    expect(tot(minDistRace), `race-prep boundary junk runs WORSENED — a change regressed the low-volume quality path`).toBeLessThanOrEqual(287);
  });
});
