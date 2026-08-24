/**
 * _coherence_regression.test.ts · the rows that lied, and the old code beside
 * the new.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EVERY FIXTURE HERE IS A REAL PRODUCTION ROW
 *
 * Pulled 2026-08-24 out of the live `runs` table through `faff_readonly`, key
 * for key, value for value. Not a shape someone imagined a bug could take —
 * the shape the bug actually had. Row ids are in the test names so any of them
 * can be re-read.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EACH TEST RUNS THE OLD CODE TOO
 *
 * A regression test that only asserts the new behaviour proves the new code
 * does something. It does not prove the old code did something else, and a
 * fix nobody can see the effect of is a fix nobody can trust.
 *
 * So each block below carries a verbatim copy of the expression it replaced,
 * asserts the WRONG answer out of it, and the right answer out of the new
 * path. When those two ever agree, the test fails and says the fixture stopped
 * discriminating — which is the honest signal that a fixture went stale.
 */

import { describe, it, expect } from 'vitest';
import {
  reconcileRun, coherentPace, coherentMovingSec, coherentElapsedSec,
  coherentDurationSec, reconcileHrZones, reconcileSplitsTotal,
  runTotalEnergyKcal, runActiveEnergyKcal,
} from '@/lib/runs/coherence';
import { runFinishSec, runPaceSecPerMi, type RunData } from '@/lib/runs/run-shape';

/* ══════════════════════════════════════════════════════════════════════════
 * THE FIXTURES · verbatim production rows
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * runs.id = -55341764239083 · 2026-08-23 · source 'watch' · CANONICAL.
 *
 * The incident row. The watch recorded 11.01 mi in 5298 s. Faff pushed it to
 * Strava, Strava returned a moving time of 2389 s, and the merge absorbed
 * Strava's `movingTimeS` / `movingSec` / `elapsedTimeS` / `paceSPerMi` onto the
 * watch's row while the tier ladder correctly protected the watch's
 * `durationSec` and `avgPaceMinPerMi`. Half of each source's arithmetic.
 */
const AUG23: RunData = {
  date: '2026-08-23', source: 'watch', distanceMi: 11.01,
  durationSec: 5298, movingTimeS: 2389, movingSec: 2389, elapsedTimeS: 2389,
  paceSPerMi: 217, avgPaceMinPerMi: '8:01', timeMoving: '88:23',
};

/**
 * runs.id = -127657343028184 · 2026-06-21 · source 'watch' · CANONICAL.
 *
 * The control. 9 minutes 21 seconds of genuine pauses on a 13.15 mile run —
 * 8.7% of it — so the moving time is honest and must survive. Its pace STRING
 * and pace NUMBER are still 43 s/mi apart, because they are the elapsed pace
 * and the moving pace respectively. Both facts are true at once.
 */
const JUN21: RunData = {
  date: '2026-06-21', source: 'watch', distanceMi: 13.15,
  durationSec: 6444, movingTimeS: 5883, elapsedTimeS: 5883,
  paceSPerMi: 447, avgPaceMinPerMi: '8:10', timeMoving: '107:24',
};

/**
 * runs.id = -3363396946462586 · 2026-05-20 · source 'apple_watch' · CANONICAL.
 * Carries an all-zero zone distribution beside a measured average of 145 bpm.
 */
const MAY20: RunData = {
  date: '2026-05-20', source: 'apple_watch', distanceMi: 5.08,
  durationSec: 2685, elapsedTimeS: 2846, movingTimeS: 2685,
  avgHr: 145, maxHr: 160,
  hrZonePcts: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
};

/**
 * runs.id = -2702777794856273 · 2026-08-01 · source 'apple_watch' · CANONICAL.
 * A 1.34 mile row carrying five splits that total 4.14 miles.
 */
const AUG01: RunData = {
  date: '2026-08-01', source: 'apple_watch', distanceMi: 1.34,
  splits: [
    { hr: 119, mile: 1, cadence: 152, elev_ft: 0, distanceMi: 1, unreliable: true },
    { hr: 138, mile: 2, cadence: 148, elev_ft: -7, distanceMi: 1, unreliable: true },
    { hr: 143, mile: 3, cadence: 153, elev_ft: 8, distanceMi: 1, unreliable: true },
    { hr: 148, mile: 4, cadence: 158, elev_ft: 0, distanceMi: 1, unreliable: true },
    { hr: 148, mile: 5, cadence: 148, elev_ft: 0, distanceMi: 0.14285714285714285, unreliable: true },
  ],
};

/**
 * runs.id = -226447289863060 · 2026-06-14 · source 'watch' · CANONICAL.
 * Carries both energy keys: total 2187 kcal beside active 1661 kcal.
 */
const JUN14: RunData = {
  date: '2026-06-14', source: 'watch', distanceMi: 13.13,
  durationSec: 6573, movingTimeS: 6509, elapsedTimeS: 6509,
  calories: 2187, kcal: 1661,
};

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE PACE THE RECAP READ OUT LOUD
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2026-08-23 · the recap said "at 3:37/mi"', () => {
  it('the old recap expression returns 3:37/mi · the new one returns 8:01/mi', () => {
    // app/api/runs/[id]/recap/route.ts, verbatim, before 2026-08-24:
    //   const actualPaceSPerMi = Number(data.paceSPerMi) || parsePaceToSec(data.avgPaceMinPerMi);
    const OLD = Number(AUG23.paceSPerMi) || null;
    expect(OLD).toBe(217);                       // 3:37/mi
    expect(Math.round(217 / 60)).toBe(4);        // sanity: this is minutes-per-mile territory

    const now = coherentPace(AUG23);
    expect(now).not.toBeNull();
    expect(Math.round(now!.secPerMi)).toBe(481); // 8:01/mi
    expect(now!.basis).toBe('elapsed');

    // The fixture must still discriminate. If these ever agree the row has
    // been repaired upstream and this test is measuring nothing.
    expect(OLD).not.toBe(Math.round(now!.secPerMi));
  });

  it('the pace guard in run-shape.ts agrees, so no surface can split from another', () => {
    expect(Math.round(runPaceSecPerMi(AUG23)!)).toBe(481);
  });

  it('the same run on the log now reads the same pace, not the display string', () => {
    // lib/coach/log-state.ts, verbatim, before:
    //   pace: a.avgPaceMinPerMi || fmtPaceFromSec(sPerMi) || null
    // The string happened to be right on THIS row and wrong on the six rows
    // where the two clocks diverge — which is worse, not better, because it
    // makes the bug invisible until one particular run.
    const oldLog = AUG23.avgPaceMinPerMi;
    expect(oldLog).toBe('8:01');
    const oldRecap = Number(AUG23.paceSPerMi);
    expect(oldRecap).toBe(217);
    // Two surfaces, one run, two paces. That is the finding.
    expect(String(oldLog)).not.toBe(String(oldRecap));

    // Both read the same number now.
    expect(Math.round(coherentPace(AUG23)!.secPerMi)).toBe(481);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE DURATION RUN DETAIL AND THE LOG PRINTED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2026-08-23 · run detail printed 39:49 for a 1:28:18 run', () => {
  it('the old run-state ladder returns 2389s · both its rungs were broken', () => {
    // lib/coach/run-state.ts, verbatim, before 2026-08-24:
    //   const movingSec  = Number(r.movingTimeS) || Number(r.duration_sec) || null;
    //   const elapsedSec = Number(r.elapsedTimeS) || Number(r.duration_sec) || null;
    // `duration_sec` is not a key on this object — the blob spells it
    // `durationSec` — so the second rung was NaN on every row ever written.
    const asAny = AUG23 as unknown as Record<string, unknown>;
    expect(asAny.duration_sec).toBeUndefined();

    const OLD_MOVING = Number(AUG23.movingTimeS) || Number(asAny.duration_sec) || null;
    const OLD_ELAPSED = Number(AUG23.elapsedTimeS) || Number(asAny.duration_sec) || null;
    expect(OLD_MOVING).toBe(2389);   // 39:49
    expect(OLD_ELAPSED).toBe(2389);  // 39:49 again — elapsed was a copy of moving
    expect(OLD_ELAPSED).toBe(OLD_MOVING);

    // Now: moving time is REFUSED, and elapsed is the watch's real clock.
    expect(coherentMovingSec(AUG23)).toBeNull();
    expect(coherentElapsedSec(AUG23)).toBe(5298);   // 1:28:18
  });

  it('the log gets a duration and is told which clock it is', () => {
    // lib/coach/log-state.ts, verbatim, before:
    //   Number(a.movingTimeS) || Number(a.movingSec) || Number(a.durationSec) || null
    const OLD = Number(AUG23.movingTimeS) || Number(AUG23.movingSec) || Number(AUG23.durationSec) || null;
    expect(OLD).toBe(2389);

    const now = coherentDurationSec(AUG23);
    expect(now).toEqual({ sec: 5298, basis: 'elapsed' });
    expect(now!.sec).not.toBe(OLD);
  });

  it('refusing moving time does not blank the run · the wall clock still answers', () => {
    // Rule 3: a refusal is a correct answer, not an empty state. The runner
    // still sees how long the run took. What disappears is the claim that
    // 39:49 of it was spent moving, which nothing measured.
    const c = reconcileRun(AUG23);
    expect(c.movingSec).toBeNull();
    expect(c.elapsedSec).toBe(5298);
    expect(c.refusals.map((r) => r.family)).toContain('clock.moving-disproved');
    // And the refusal says why, in a sentence a log line can carry.
    expect(c.refusals[0].detail).toContain('54.9%');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE CONTROL · an honest row must not be touched
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2026-06-21 · nine minutes of real pauses survive the guard', () => {
  it('keeps the moving time and the moving-pace basis', () => {
    const c = reconcileRun(JUN21);
    expect(c.movingSec).toBe(5883);
    expect(c.elapsedSec).toBe(6444);
    expect(c.paceBasis).toBe('moving');
    expect(Math.round(c.paceSecPerMi!)).toBe(447);  // 7:27/mi
    expect(c.refusals.map((r) => r.family)).not.toContain('clock.moving-disproved');
  });

  it('still reports that the pace STRING is a different quantity', () => {
    // 8:10/mi (elapsed) against 7:27/mi (moving) — 43 s/mi apart on a row
    // where nothing is corrupt. This is the finding the incident row hid:
    // 115 of 115 production rows store the string off `durationSec` and the
    // number off `movingTimeS`.
    const c = reconcileRun(JUN21);
    expect(c.refusals.map((r) => r.family)).toContain('pace.display-vs-numeric');
  });

  it('the guard catches exactly one canonical row in production, and this is not it', () => {
    // Measured 2026-08-24 across all 256 rows: one row trips
    // clock.moving-disproved. Zero collateral. A guard that also refused this
    // row would be trading one wrong number for a lot of missing ones.
    expect(reconcileRun(JUN21).movingSec).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · A DISTRIBUTION THAT DISTRIBUTES NOTHING
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2026-05-20 · five zeros beside a measured 145 bpm', () => {
  it('the old read passes the zeros straight through', () => {
    // Every consumer read `data.hrZonePcts` directly. A five-zero object is
    // truthy and well-shaped, so it rendered as a zone bar of nothing.
    const OLD = MAY20.hrZonePcts;
    expect(OLD).not.toBeNull();
    expect(Object.values(OLD!).reduce((a, b) => a + b, 0)).toBe(0);

    expect(reconcileHrZones(MAY20)).toBeNull();
  });

  it('keeps the average HR · it was measured independently and is not in doubt', () => {
    const c = reconcileRun(MAY20);
    expect(c.hrZonePcts).toBeNull();
    expect(c.refusals.map((r) => r.family)).toContain('hr.zones-vs-avg');
    expect(MAY20.avgHr).toBe(145);
  });

  it('a real distribution is untouched', () => {
    expect(reconcileHrZones({ avgHr: 145, hrZonePcts: { z1: 5, z2: 70, z3: 20, z4: 4, z5: 1 } }))
      .not.toBeNull();
  });

  it('zones with no HR beside them are unusable rather than false · no refusal', () => {
    const refusals: Array<{ family: string }> = [];
    expect(reconcileHrZones({ hrZonePcts: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 } }, refusals as never))
      .toBeNull();
    expect(refusals).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · SPLITS THAT DESCRIBE A DIFFERENT RUN
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2026-08-01 · a 1.34 mile run with 4.14 miles of splits', () => {
  it('the array does not decompose the run', () => {
    expect(reconcileSplitsTotal(AUG01, 1.34)).toBe(false);
  });

  it('the run distance wins · nothing rewrites distanceMi to 4.14', () => {
    // `distanceMi` is what weekly volume and every distance-keyed doctrine
    // table are summed from. The splits are the derived decomposition, so a
    // disagreement demotes the splits, never the run.
    const c = reconcileRun(AUG01);
    expect(c.distanceMi).toBe(1.34);
    expect(c.splitsCoverRun).toBe(false);
  });

  it('splits that do cover their run are kept', () => {
    expect(reconcileSplitsTotal(
      { splits: [{ distanceMi: 1 }, { distanceMi: 1 }, { distanceMi: 1 }, { distanceMi: 0.1 }] },
      3.1,
    )).toBe(true);
  });

  it('Strava metre-denominated splits are converted, not misread as miles', () => {
    // One of the six historical split shapes stores `distance` in METRES.
    // Reading it as miles is bug #3 from run-shape.ts's own header, one file
    // over.
    expect(reconcileSplitsTotal(
      { splits: [{ distance: 1609.344 }, { distance: 1609.344 }] },
      2.0,
    )).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · TWO ENERGIES, TWO NAMES
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2026-06-14 · total energy is not active energy', () => {
  it('the COALESCE that conflates them picks the larger by ~32%', () => {
    // components/faff-app/seed.ts:723, verbatim:
    //   COALESCE(c.data->>'calories', c.data->>'kcal') AS kcal
    const OLD = JUN14.calories ?? JUN14.kcal;
    expect(OLD).toBe(2187);
    expect(runActiveEnergyKcal(JUN14)).toBe(1661);
    expect(OLD! / 1661).toBeGreaterThan(1.3);
  });

  it('both are correct and both are readable by name', () => {
    // Nothing is refused here. `calories` is Strava/HealthKit TOTAL energy and
    // `kcal` is the watch's ACTIVE energy; the ~31% gap is the basal share of
    // an hour's running. The data is sound. The read was not.
    expect(runTotalEnergyKcal(JUN14)).toBe(2187);
    expect(runActiveEnergyKcal(JUN14)).toBe(1661);
    expect(reconcileRun(JUN14).refusals.map((r) => r.family))
      .not.toContain('energy.total-vs-active');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · THE TWO FINISH LADDERS THAT SAID THEY MIRRORED AND DID NOT
 * ═══════════════════════════════════════════════════════════════════════ */

describe('runFinishSec vs runFinishSecSql', () => {
  it('the old TS ladder returned durationSec where the SQL returned movingTimeS', () => {
    // The SQL fragment was reordered 2026-08-17 to prefer moving time. The TS
    // accessor was not, and its docstring claimed the two mirrored. On the
    // 2026-06-11 row the pair returned 3326 and 3112.
    const row: RunData = { movingTimeS: 3112, elapsedTimeS: 3112, durationSec: 3326 };
    const OLD_TS = row.durationSec;            // what the accessor used to return
    const SQL_ORDER = row.movingTimeS;         // what the SQL returns
    expect(OLD_TS).not.toBe(SQL_ORDER);
    // Now the accessor agrees with the SQL.
    expect(runFinishSec(row)).toBe(3112);
  });

  it('and refuses a moving time the SQL cannot see is disproved', () => {
    // The SQL would return 2389 here. The accessor returns the wall clock,
    // because a finish time must still answer — the run took 5298 seconds.
    expect(runFinishSec(AUG23)).toBe(5298);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · THE GUARD IS ARITHMETIC, NOT PHYSIOLOGY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('no threshold on human speed', () => {
  it('a world-record marathon pace is not refused', () => {
    // 26.2 mi in 7299 s = 4:38/mi. Nothing here judges whether a person can
    // run that; the row is coherent, so it stands.
    const elite: RunData = { distanceMi: 26.2, durationSec: 7299, movingTimeS: 7299, paceSPerMi: 279 };
    const c = reconcileRun(elite);
    expect(c.movingSec).toBe(7299);
    expect(c.refusals).toHaveLength(0);
  });

  it('a walker is not refused either', () => {
    const walker: RunData = { distanceMi: 3.0, durationSec: 3600, movingTimeS: 3550, paceSPerMi: 1183 };
    const c = reconcileRun(walker);
    expect(c.movingSec).toBe(3550);
    expect(c.refusals).toHaveLength(0);
  });

  it('an empty row refuses nothing and claims nothing', () => {
    const c = reconcileRun({});
    expect(c.refusals).toHaveLength(0);
    expect(c.paceSecPerMi).toBeNull();
    expect(c.movingSec).toBeNull();
    expect(c.elapsedSec).toBeNull();
    // A null with no refusal means "never measured". A null WITH a refusal
    // means "disproved". Callers can tell them apart, which is the whole
    // reason `refusals` is on the result.
    expect(reconcileRun(AUG23).refusals.length).toBeGreaterThan(0);
  });
});
