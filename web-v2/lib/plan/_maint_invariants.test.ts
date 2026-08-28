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
import { HOLD_BLOCK_MAX_WEEKS } from './generate';
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
              // collect the sorted quality-weekday SET for each QUALITY week.
              //
              // VARIETY-LONG-1 (2026-08-28) · a week whose set is a SUBSET of
              // the phase's stable set is not oscillation. On the cadence week
              // the rotation authors §4.3's progression long, the T-family
              // slot comes out (§4.3 "don't pair with other quality work"; the
              // long's T tail IS the week's threshold work) and the freed day
              // runs easy — the same one-slot week DOCTRINE-MPLONG-1 already
              // authors in RACE-SPECIFIC. The defect this gate holds at zero
              // is the days MOVING (Mon+Wed ↔ Tue+Thu every 7 days), and a
              // subset cannot move: every quality day the week does run is on
              // a day the phase always uses.
              const weekSets: number[][] = [];
              for (const w of built.composed.weeks) {
                if (w.phase !== 'QUALITY' || w.isRaceWeek) continue;
                const qd = w.days.filter((d: any) => d.isQuality && !d.isLong && d.type !== 'rest').map((d: any) => d.dow).sort((a: number, b: number) => a - b);
                if (qd.length) weekSets.push(qd);
              }
              // Stable = the union of all observed sets is itself one of the
              // observed sets (the phase's full profile), so every other week
              // is a subset of it. Two alternating sets (the audit's Mon+Wed ↔
              // Tue+Thu) have a union nobody runs, and still fail.
              const union = new Set(weekSets.flat());
              const stable = weekSets.length > 0
                && weekSets.some((qd) => qd.length === union.size);
              if (weekSets.length > 0 && !stable) {
                const sets = new Set(weekSets.map((qd) => qd.join(',')));
                bump(shuffle, `${distance}/f${freq}/${longRunDay} ${sets.size} distinct sets`, `${distance}/f${freq}/m${mileage}/${longRunDay}`);
              }
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
  //   #8 WEEK0_START — the sim must compose from the same anchor production does. WEEK-ALIGN-1
  //      (2026-08-24) moved that anchor from the LITERAL chosen start to the runner's TRAINING-WEEK
  //      BOUNDARY on or before it, because a block authored on the signup weekday is read back by
  //      `trainingWeekWindow` on the long-run-day grid and the two coincide one weekday in seven.
  //      So this now asserts the boundary, and that the boundary is never after the chosen start
  //      and never more than the six days `persistPlan` clips before it.
  it('sim is faithful across every long-run day (#5 race weekday · #6 no merge · #8 aligned start)', () => {
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
              // #8 · week-0 composed from the runner's training-week boundary (WEEK-ALIGN-1)
              const w0 = built.composed.weeks[0]?.startISO;
              const weekStartDow = (dowOfDay(longRunDay) + 1) % 7;
              const startDow = new Date(startDateISO + 'T12:00:00Z').getUTCDay();
              const back = ((startDow - weekStartDow) % 7 + 7) % 7;
              const anchor = new Date(Date.parse(startDateISO + 'T12:00:00Z') - back * 86400000)
                .toISOString().slice(0, 10);
              if (w0 !== anchor || (w0 != null && w0 > startDateISO)) {
                week0Off++;
                ex.week0 ??= `${distance}/${longRunDay}/start${startDateISO} → wk0 ${w0}, boundary ${anchor}`;
              }
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
    expect(week0Off, `week-0 startISO is not the runner's training-week boundary (#8)`).toBe(0);
  });

  // ── HOLD_SYMMETRY · recovery and maintenance answer a far race the same way (#2) ──
  //
  // The defect this began as: the HOLD+RACE-PREP chain was gated
  // `mode==='maintenance'` and excluded recovery, so under identical geometry a
  // post-race runner saw 1-4 recovery weeks and a not-post-race runner saw the
  // whole build. An asymmetry with no reason behind it.
  //
  // SIM-CHAIN-1 (2026-08-24) closed it from the other side. The chain is gone
  // entirely, because `composeForUserInternal` never had one: it calls
  // `pickPlanMode` once and one composer once, so a half sixteen weeks out got
  // four maintenance weeks in production while /sim/plan drew seventeen. Both
  // hold modes now do what production does, which is still symmetric and is
  // additionally true.
  //
  // So the gate flips from "both chain forward" to "neither does, and both say
  // when the build opens" — the answer that replaced the chain, and the one the
  // Block screen's coach line prints.
  it('a hold block for a far race carries no build, and names the day the build opens (#2)', () => {
    const PHASES_BUILD = new Set(['BASE', 'QUALITY', 'RACE-SPECIFIC', 'TAPER']);
    let holdPlans = 0, carriedBuild = 0, noOpenDate = 0, endsOnRace = 0;
    // MAINT-LENGTH-1 (2026-08-28) · a single hold block is capped at the
    // doctrine ceiling, and a CAPPED hold must still name the build-open day
    // even though its own weeks end before the window opens — the runner is
    // told when the build starts, the plan-drift cron authors the block(s)
    // in between. overCap gates the ceiling; cappedHolds proves the sweep
    // actually exercised a hold long enough to be cut by it.
    let overCap = 0, cappedHolds = 0;
    const byMode: Record<string, number> = {};
    const ex: string[] = [];
    for (const lastDistance of [null, 'half', 'marathon', '50k'] as const)
      for (const distance of DISTANCES)
        for (const freq of [4, 5])
          for (const mileage of [25, 35]) {
            const built = buildSimPlan({
              goalMode: 'race', distance, experienceLevel: 'intermediate', weeklyFrequency: freq,
              weeklyMileageBucket: mileage, longestRunBucket: '6-10', longRunDay: 'sun', restDay: 'sat',
              startDateISO: '2026-07-06', raceDateISO: '2027-03-01', goalTimeSec: GOAL_SEC[distance],
              planWeeks: 0,
              lastRaceFinishedDaysAgo: lastDistance ? 7 : 0,
              lastRaceDistance: lastDistance, raceHistory: [], availableDays: [],
            } as any);
            if (!built.ok || built.mode === 'race-prep') continue;
            holdPlans++;
            byMode[built.mode] = (byMode[built.mode] ?? 0) + 1;

            // 1 · no build phases. A hold block is a hold block.
            if (built.composed.weeks.some((w: any) => PHASES_BUILD.has(w.phase))) {
              carriedBuild++;
              if (ex.length < 5) ex.push(`${built.mode}/last=${lastDistance}/next=${distance}: phases ${[...new Set(built.composed.weeks.map((w: any) => w.phase))].join('→')}`);
            }
            // 2 · and it does not pretend to reach the start line.
            if (built.composed.weeks[built.composed.weeks.length - 1]?.isRaceWeek === true) endsOnRace++;
            // 3 · but it does say when the build gets written, or it is a stub
            //     that just stops — the thing the chain was invented to avoid.
            const opens = built.derived.buildOpensISO;
            if (!opens || opens > '2027-03-01' || opens < '2026-07-06') {
              noOpenDate++;
              if (ex.length < 5) ex.push(`${built.mode}/last=${lastDistance}/next=${distance}: buildOpensISO=${opens}`);
            }
            // 4 · MAINT-LENGTH-1 · no single hold block outlives the ceiling.
            if (built.mode === 'maintenance') {
              const wks = built.composed.weeks.length;
              if (wks > HOLD_BLOCK_MAX_WEEKS) {
                overCap++;
                if (ex.length < 5) ex.push(`${built.mode}/next=${distance}: ${wks} wk hold over the ${HOLD_BLOCK_MAX_WEEKS} wk cap`);
              }
              if (wks === HOLD_BLOCK_MAX_WEEKS) cappedHolds++;
            }
          }
    console.log(`\nHOLD_SYMMETRY: ${holdPlans} hold blocks ${JSON.stringify(byMode)} · ${carriedBuild} carrying a build · ${endsOnRace} ending on a race week · ${noOpenDate} with no open date · ${cappedHolds} at the ${HOLD_BLOCK_MAX_WEEKS} wk cap · ${overCap} over it`);
    for (const e of ex) console.log(`  ${e}`);
    // BOTH hold modes must be exercised, or the symmetry is asserted over one
    // of them — which is exactly the shape of the defect this began as.
    expect(byMode.maintenance ?? 0, 'no maintenance-mode plans were exercised').toBeGreaterThan(0);
    expect(byMode.recovery ?? 0, 'no recovery-mode plans were exercised').toBeGreaterThan(0);
    expect(carriedBuild, 'a hold block carries build phases — the sim/production chain is back (#2)').toBe(0);
    expect(endsOnRace, 'a hold block ends on a race week — it is pretending to reach the start line').toBe(0);
    expect(noOpenDate, 'a hold block does not say when the build opens — a stub that just stops (#2)').toBe(0);
    expect(overCap, `a hold block exceeds HOLD_BLOCK_MAX_WEEKS (${HOLD_BLOCK_MAX_WEEKS}) — the MAINT-LENGTH-1 cap regressed`).toBe(0);
    expect(cappedHolds, 'no hold in the sweep reached the cap — the ceiling was never exercised, widen the geometry').toBeGreaterThan(0);
  });

  // ── RACE_ON_AVAIL · the goal race cell must land on a declared-available day (#7) ──
  // The old Saturday-snap ignored availableDays, stranding a 26.2mi RACE on a day the runner said they
  // can't run. The SIM-FIDELITY race-snap (#5) now puts the race on longRunDow, which is itself forced
  // to an available day (sim-inputs.ts longRunDow fallback) whenever availableDays is set — so #7 is
  // closed by #5. This gate locks it: in any goalMode:'goal' plan with availableDays, the race cell's
  // dow is in availableDays.
  it('goal race cell lands on a declared-available day (#7)', () => {
    const AVAIL_SETS = [['tue', 'thu', 'sun'], ['mon', 'wed', 'fri'], ['sun', 'wed', 'fri'], ['mon', 'tue', 'thu', 'sat'], ['tue', 'fri', 'sun']];
    const dayDow: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    let plans = 0, off = 0;
    const ex: string[] = [];
    for (const distance of DISTANCES)
      for (const availableDays of AVAIL_SETS)
        for (const longRunDay of ['sun', 'sat', 'wed']) {
          const built = buildSimPlan({
            goalMode: 'goal', distance, experienceLevel: 'intermediate', weeklyFrequency: 4,
            weeklyMileageBucket: 25, longestRunBucket: '6-10', longRunDay, restDay: 'sat',
            startDateISO: '2026-07-06', raceDateISO: '', goalTimeSec: GOAL_SEC[distance],
            planWeeks: WEEKS[distance], lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
            raceHistory: [], availableDays,
          } as any);
          if (!built.ok) continue;
          plans++;
          const avail = new Set(availableDays.map((d) => dayDow[d]));
          const raceDay = built.composed.weeks.flatMap((w: any) => w.days).find((d: any) => d.type === 'race');
          if (raceDay && !avail.has(raceDay.dow)) { off++; if (ex.length < 5) ex.push(`${distance}/long=${longRunDay}/avail=${availableDays.join('+')} race on dow${raceDay.dow}`); }
        }
    console.log(`\nRACE_ON_AVAIL: ${plans} goal plans with availableDays · ${off} with race on an unavailable day`);
    for (const e of ex) console.log(`  ${e}`);
    expect(plans, 'no constrained goal plans exercised').toBeGreaterThan(0);
    expect(off, `goal race cell landed on a declared-unavailable day (#7)`).toBe(0);
  });
});
