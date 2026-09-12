/**
 * lib/plan/_raceweek_consolidation_live.audit.test.ts
 * · RACEWEEK-CONSOLIDATION-1, AGAINST THE OWNER'S ACTUAL BLOCK. (Rule 13)
 *
 * Verification-only, ad hoc for this pass: reads the owner's live plan
 * read-only and checks the fixed sites against his real tune-up races
 * (Santa Monica 10k, Dodgers 10k) and his real goal race (CIM) for
 * regression safety, per the task's own instruction. Not wired into
 * `prebuild` — `_race_week_canonical_scan.test.ts` is the permanent CI gate;
 * this file is the one-time real-data check Rule 13 asks for on top of it.
 *
 * READ-ONLY, in the pattern `_move_readjudication_live.audit.test.ts` set:
 * skips entirely without `DATABASE_URL_RO`.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const d = RO ? describe : describe.skip;

d('RACEWEEK-CONSOLIDATION-1 · live verification', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let raceWeek: any;
  let raceWeekRole: any;
  let adjudicate: any;
  let liveSeq: any;
  let scen: any;
  let shape: any;

  beforeAll(async () => {
    process.env.DATABASE_URL = RO;
    raceWeek = await import('./race-week');
    raceWeekRole = await import('./race-week-role');
    adjudicate = await import('./adjudication/adjudicate');
    liveSeq = await import('./adjudication/live-sequence');
    scen = await import('./replan-scenarios');
    shape = await scen.loadPlanShape(OWNER);
  });

  it('liveness · a real block was read, with real weeks and real days', () => {
    expect(shape, 'no active plan for the owner').not.toBeNull();
    expect(shape.weeks.length).toBeGreaterThan(3);
    // eslint-disable-next-line no-console
    console.log(`[live] plan ${shape.planId} · ${shape.weeks.length} weeks`);
  });

  it('every week\'s own containsRace (PlanWeekShape) agrees with weekContainsRace recomputed independently', () => {
    let checked = 0;
    for (const w of shape.weeks) {
      const recomputed = raceWeek.weekContainsRace({ isRaceWeek: w.isRaceWeek, days: w.days });
      expect(recomputed, `${w.startISO} · loadPlanShapeUncached's stamped containsRace disagrees with a fresh weekContainsRace call`)
        .toBe(w.containsRace);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('EACH TUNE-UP WEEK (is_race_week=false, contains a race day) resolves CONTROLLED and containsRace=true', () => {
    const tuneUps = shape.weeks.filter((w: any) =>
      !w.isRaceWeek && w.days.some((day: any) => day.type === 'race'));
    // eslint-disable-next-line no-console
    console.log(`[live] ${tuneUps.length} tune-up week(s) found: `
      + tuneUps.map((w: any) => w.startISO).join(', '));
    for (const w of tuneUps) {
      expect(raceWeek.weekContainsRace(w), `${w.startISO} · a B/C tune-up week must read containsRace=true`).toBe(true);
      const role = raceWeekRole.resolveRaceWeekRoleWithoutPriority(w);
      expect(role.role, `${w.startISO} · a tune-up week must never resolve 'goal' or 'none'`)
        .not.toBe('goal');
      expect(role.role).not.toBe('none');
      expect(role.containsRace).toBe(true);
      // The adjudicate.ts PlannedWeek shape, as a live caller would build it.
      const plannedWeek = {
        weekStartISO: w.startISO, weeklyMi: 0, longestMi: 0, stressors: [], mpMi: 0,
        isTaper: false, isRaceWeek: w.isRaceWeek, containsRace: raceWeek.weekContainsRace(w),
      };
      expect(adjudicate.containsRaceOf(plannedWeek), `${w.startISO} · containsRaceOf must read true for a real tune-up`).toBe(true);
    }
    expect(tuneUps.length, 'no tune-up week found on the live block — cannot verify the fix against real data').toBeGreaterThan(0);
  });

  it('THE GOAL WEEK (is_race_week=true) is unaffected — still resolves GOAL, unconditionally', () => {
    const goalWeeks = shape.weeks.filter((w: any) => w.isRaceWeek === true);
    // eslint-disable-next-line no-console
    console.log(`[live] ${goalWeeks.length} goal week(s): ` + goalWeeks.map((w: any) => w.startISO).join(', '));
    for (const w of goalWeeks) {
      expect(raceWeek.isGoalRaceWeek(w)).toBe(true);
      expect(raceWeek.weekContainsRace(w)).toBe(true);
      expect(raceWeekRole.resolveRaceWeekRoleWithoutPriority(w).role).toBe('goal');
      const plannedWeek = {
        weekStartISO: w.startISO, weeklyMi: 0, longestMi: 0, stressors: [], mpMi: 0,
        isTaper: false, isRaceWeek: true,
      };
      // Goal case must resolve true through isRaceWeek ALONE, with no
      // containsRace supplied — the documented fallback.
      expect(adjudicate.containsRaceOf(plannedWeek)).toBe(true);
    }
    expect(goalWeeks.length, 'no goal week found on the live block').toBeGreaterThan(0);
  });

  it('loadPlannedWeeks (live-sequence.ts) stamps containsRace correctly on the same live block', async () => {
    const read = await liveSeq.loadPlannedWeeks(OWNER);
    expect(read.ok, `loadPlannedWeeks failed: ${read.ok ? '' : read.why}`).toBe(true);
    if (!read.ok) return;
    let tuneUpChecked = 0;
    for (const w of read.weeks) {
      const anyRaceDay = w.rows.some((r: any) => r.type === 'race');
      if (anyRaceDay && !w.isRaceWeek) {
        expect(w.containsRace, `${w.weekStartISO} · loadPlannedWeeks must stamp containsRace true for a tune-up`).toBe(true);
        tuneUpChecked += 1;
      }
      if (w.isRaceWeek) {
        expect(w.containsRace, `${w.weekStartISO} · goal week must also read containsRace true`).toBe(true);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[live] loadPlannedWeeks: ${read.weeks.length} weeks, ${tuneUpChecked} tune-up week(s) confirmed containsRace=true`);
  });
});
