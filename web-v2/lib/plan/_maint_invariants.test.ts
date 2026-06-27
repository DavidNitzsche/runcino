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
const WEEKS: Record<SimDistance, number> = { '5k': 10, '10k': 12, half: 14, marathon: 18, '50k': 22, '100k': 24 };

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

                // ── 3 · CAL_MERGE · replicate the page.tsx render (group by PLAN-WEEK, one row per
                // training week). The merge symptom (a rendered row showing more running days than the
                // stated frequency because two training weeks share a Sun-Sat date window) cannot occur
                // when rows are grouped by plan-week — each row is exactly one week, so runs ≤ freq.
                built.composed.weeks.forEach((w: any) => {
                  if (w.isRaceWeek) return;
                  const runs = w.days.filter((d: any) => d.type !== 'rest' && d.distanceMi > 0).length;
                  if (runs > freq) bump(calMerge, `${w.phase} row runs=${runs}>f${freq}`, arc);
                });
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

  // ── QUAL_PHASE_STABLE · the runner's hard-training WEEKDAYS must not oscillate week-to-week ──
  // Audit defect #3 (QUAL-PHASE-STABLE): the QUALITY mix toggles by weekIdx%2 (intervals-in vs
  // intervals-out); per-week placement moved the days Mon+Wed ↔ Tue+Thu every 7 days for near-side
  // (sat/fri/thu) long-run users. The gate must sweep ALL long-run days — the prior CAL_MERGE gate
  // hardcoded 'sun' (stable) and missed this. Within one contiguous QUALITY phase the SET of quality
  // weekdays must be constant; only the workout TYPE on those fixed days may rotate.
  it('QUALITY-phase quality weekdays are stable across the phase (every long-run day)', () => {
    const LONGDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const shuffle: Record<string, V> = {};
    let plans = 0;
    for (const distance of DISTANCES)
      for (const freq of [3, 4, 5, 6])
        for (const mileage of [15, 25, 35])
          for (const longestRunBucket of ['6-10', '10+'])
            for (const longRunDay of LONGDAYS) {
              const built = buildSimPlan({
                goalMode: 'goal', distance, experienceLevel: 'intermediate', weeklyFrequency: freq,
                weeklyMileageBucket: mileage, longestRunBucket, longRunDay, restDay: 'sat',
                startDateISO: '2026-07-06', raceDateISO: '', goalTimeSec: GOAL_SEC[distance],
                planWeeks: WEEKS[distance], lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
                raceHistory: [], availableDays: [],
              } as any);
              if (!built.ok) continue;
              plans++;
              // collect the sorted quality-weekday SET for each QUALITY week, then count distinct sets
              const sets = new Set<string>();
              for (const w of built.composed.weeks) {
                if (w.phase !== 'QUALITY' || w.isRaceWeek) continue;
                const qd = w.days.filter((d: any) => d.isQuality && !d.isLong && d.type !== 'rest').map((d: any) => d.dow).sort((a: number, b: number) => a - b);
                if (qd.length) sets.add(qd.join(','));
              }
              if (sets.size > 1) bump(shuffle, `${distance}/f${freq}/${longRunDay} ${sets.size} distinct sets`, `${distance}/f${freq}/m${mileage}/${longRunDay}`);
            }
    const total = Object.values(shuffle).reduce((s, v) => s + v.count, 0);
    console.log(`\nQUAL_PHASE_STABLE: swept ${plans} race-prep plans · ${total} with oscillating quality weekdays across ${Object.keys(shuffle).length} types`);
    for (const [k, v] of Object.entries(shuffle).sort((a, b) => b[1].count - a[1].count).slice(0, 15)) console.log(`  [${v.count}] ${k}  e.g. ${v.ex}`);
    // The training-days promise: within a QUALITY phase the quality weekday SET is constant (only the
    // workout TYPE rotates). Was 576 oscillating plans (audit) → hard 0 after QUAL-PHASE-STABLE.
    expect(total, `quality weekdays oscillate within a QUALITY phase — QUAL-PHASE-STABLE regressed`).toBe(0);
  });

  // ── SIM_FIDELITY · the sim cluster (#5/#6/#8), swept over EVERY long-run day ──
  // The prior CAL_MERGE gate hardcoded long=sun and missed three classes the render-layer fix closes:
  //   #6 CAL_MERGE — under plan-week grouping no rendered row may exceed the stated frequency, for ANY long day.
  //   #5 RACE_WEEKDAY — the goal race cell must land on longRunDow (production parity), not a forced Saturday.
  //   #8 WEEK0_START — the sim must compose from the LITERAL chosen start (no snap-to-longRunDow), so week-0
  //      matches production (frontLoadFirstRun "run on day one"); weeks[0].startISO must equal the chosen start.
  it('sim is faithful across every long-run day (#5 race weekday · #6 no merge · #8 literal start)', () => {
    const LONGDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dowOfDay = (d: string) => LONGDAYS.indexOf(d);
    const GOAL_STARTS = ['2026-07-05', '2026-07-06', '2026-07-08']; // Sun, Mon, Wed
    let merge = 0, raceOff = 0, week0Off = 0, plans = 0;
    const ex: Record<string, string> = {};
    for (const distance of DISTANCES)
      for (const freq of [3, 4, 5, 6])
        for (const mileage of [15, 35])
          for (const longRunDay of LONGDAYS)
            for (const startDateISO of GOAL_STARTS) {
              const built = buildSimPlan({
                goalMode: 'goal', distance, experienceLevel: 'intermediate', weeklyFrequency: freq,
                weeklyMileageBucket: mileage, longestRunBucket: '6-10', longRunDay, restDay: 'sat',
                startDateISO, raceDateISO: '', goalTimeSec: GOAL_SEC[distance], planWeeks: WEEKS[distance],
                lastRaceFinishedDaysAgo: 0, lastRaceDistance: null, raceHistory: [], availableDays: [],
              } as any);
              if (!built.ok) continue;
              plans++;
              // #8 · week-0 composed from the literal chosen start (no snap-back)
              if (built.composed.weeks[0]?.startISO !== startDateISO) { week0Off++; ex.week0 ??= `${distance}/${longRunDay}/start${startDateISO} → wk0 ${built.composed.weeks[0]?.startISO}`; }
              // #6 · plan-week grouping → no row exceeds freq
              for (const w of built.composed.weeks) {
                if (w.isRaceWeek) continue;
                const runs = w.days.filter((d: any) => d.type !== 'rest' && d.distanceMi > 0).length;
                if (runs > freq) { merge++; ex.merge ??= `${distance}/f${freq}/${longRunDay} ${w.phase} runs=${runs}`; break; }
              }
              // #5 · race cell lands on longRunDow
              const raceDay = built.composed.weeks.flatMap((w: any) => w.days).find((d: any) => d.type === 'race');
              if (raceDay && raceDay.dow !== dowOfDay(longRunDay)) { raceOff++; ex.race ??= `${distance}/${longRunDay} race on dow${raceDay.dow}`; }
            }
    console.log(`\nSIM_FIDELITY: swept ${plans} goal plans · merge=${merge} raceOff=${raceOff} week0Off=${week0Off}`);
    if (ex.merge) console.log(`  merge e.g. ${ex.merge}`);
    if (ex.race) console.log(`  raceOff e.g. ${ex.race}`);
    if (ex.week0) console.log(`  week0Off e.g. ${ex.week0}`);
    expect(merge, `a rendered row exceeds the stated frequency — CAL_MERGE regressed (#6)`).toBe(0);
    expect(raceOff, `goal race cell is not on the long-run day — sim/prod race-weekday parity broke (#5)`).toBe(0);
    expect(week0Off, `week-0 startISO != chosen start — a start-snap was re-introduced (#8)`).toBe(0);
  });

  // ── RECOVERY_CHAIN · a post-race runner with a far next race must see the forward build (#2) ──
  // The HOLD+RACE-PREP chain was gated `mode==='maintenance'` and excluded recovery, so a post-race
  // runner planning a next race saw only 1-4 recovery weeks and the plan stopped — the entire build was
  // invisible (asymmetric with maintenance under identical geometry). Both hold modes must chain forward.
  it('recovery-mode preview appends the forward build when a next race is far out (#2)', () => {
    const PHASES_BUILD = new Set(['BASE', 'QUALITY', 'RACE-SPECIFIC', 'TAPER']);
    let recoveryPlans = 0, noForward = 0;
    const ex: string[] = [];
    for (const lastDistance of ['half', 'marathon', '50k'] as const)
      for (const distance of DISTANCES)
        for (const freq of [4, 5])
          for (const mileage of [25, 35]) {
            const built = buildSimPlan({
              goalMode: 'race', distance, experienceLevel: 'intermediate', weeklyFrequency: freq,
              weeklyMileageBucket: mileage, longestRunBucket: '6-10', longRunDay: 'sun', restDay: 'sat',
              startDateISO: '2026-07-06', raceDateISO: '2027-03-01', goalTimeSec: GOAL_SEC[distance],
              planWeeks: 0, lastRaceFinishedDaysAgo: 7, lastRaceDistance: lastDistance, raceHistory: [], availableDays: [],
            } as any);
            if (!built.ok || built.mode !== 'recovery') continue;
            recoveryPlans++;
            const hasBuild = built.composed.weeks.some((w: any) => PHASES_BUILD.has(w.phase));
            const endsOnRaceWeek = built.composed.weeks[built.composed.weeks.length - 1]?.isRaceWeek === true;
            if (!hasBuild || !endsOnRaceWeek) { noForward++; if (ex.length < 5) ex.push(`last=${lastDistance}/next=${distance}/f${freq}/m${mileage} weeks=${built.composed.weeks.length} build=${hasBuild} endRace=${endsOnRaceWeek}`); }
          }
    console.log(`\nRECOVERY_CHAIN: ${recoveryPlans} recovery-mode plans · ${noForward} missing the forward build`);
    for (const e of ex) console.log(`  ${e}`);
    expect(recoveryPlans, 'no recovery-mode plans were exercised — the test matrix stopped triggering recovery').toBeGreaterThan(0);
    // Was 6300/6300 missing the build (audit) → 0 after RECOVERY-CHAIN.
    expect(noForward, `recovery preview is missing the forward race-prep build — RECOVERY-CHAIN regressed (#2)`).toBe(0);
  });
});
