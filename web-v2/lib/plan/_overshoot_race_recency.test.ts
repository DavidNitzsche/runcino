/**
 * Regression · the volume-overshoot race filter is per-distance, not a flat 7
 * days (2026-08-24).
 *
 * THE CONSTANT. `detectVolumeOvershoot` suppresses its finding when a race
 * falls inside a trailing window, because a race legitimately spikes completed
 * volume. That window was hardcoded in SQL as `$2::date - 7` — one number
 * asserting physiology for every distance from a 5K to a 100-miler, with no
 * doctrine registry entry behind it.
 *
 * WHY 7 IS WRONG. Research/00b-recovery-protocols.md §"Recovery by Distance"
 * publishes a "total recovery days (no quality)" band per distance: 5K 3-5,
 * 10K 5-7, half 10-14, marathon 21-28, the ultras 14-42. Only the 10K's band
 * reaches 7. A half-marathoner was unprotected from day 8; a marathoner was
 * unprotected for three of the four weeks doctrine says they are recovering.
 *
 * HOW IT SURFACED. The owner raced a half on 2026-08-16. On 2026-08-24 — day
 * 8 — the flat window missed him by one day and the finding fired. Two
 * stronger guards landed that same morning (the chronic-load floor in
 * `overshootFires` and `overshootSuppressedByPlanMode`, both proved in
 * `_overshoot_recovery.test.ts`), so nothing was broken by the time this
 * landed. The constant was still wrong.
 *
 * The band itself is checked against the doc at run time by
 * RECOVERY.overshoot-race-recency-is-per-distance in lib/doctrine/registry.ts.
 * This file proves the BEHAVIOUR: the days the old constant left uncovered are
 * covered now, and the ones it covered still are.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  OVERSHOOT_RACE_RECENCY_DAYS,
  OVERSHOOT_RACE_LOOKBACK_DAYS,
  overshootRaceRecencyDays,
  raceSuppressesOvershoot,
  overshootShaveEligible,
} from './adapt';
import { rehydratePlan, type PlanSnapshot, type PlanWorkoutRow } from './mutate';

/** The window that shipped, kept as the control. Never re-introduce it. */
const OLD_FLAT_WINDOW_DAYS = 7;

const RACE = '2026-08-16';
const dayAfter = (n: number) =>
  new Date(Date.parse(RACE + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
/** What the deleted SQL would have decided on the same day. */
const oldRuleSuppresses = (elapsed: number) => elapsed >= 0 && elapsed <= OLD_FLAT_WINDOW_DAYS;

const HALF_MI = 13.1;
const MARATHON_MI = 26.2;

describe('overshoot race recency · the old flat 7 days under-covered four of five distances', () => {
  it('THE INCIDENT · a half at day 8 · the old window had lapsed, the new one has not', () => {
    // 2026-08-16 + 8 = 2026-08-24, the day this was found on the owner.
    expect(dayAfter(8)).toBe('2026-08-24');
    expect(oldRuleSuppresses(8)).toBe(false);
    expect(raceSuppressesOvershoot(RACE, dayAfter(8), HALF_MI)).toBe(true);
  });

  it('a marathon at day 14 · the old window had lapsed a week earlier', () => {
    expect(oldRuleSuppresses(14)).toBe(false);
    expect(raceSuppressesOvershoot(RACE, dayAfter(14), MARATHON_MI)).toBe(true);
    // And doctrine's own marathon floor is 21 days, so day 21 must hold too.
    expect(raceSuppressesOvershoot(RACE, dayAfter(21), MARATHON_MI)).toBe(true);
  });

  it('every day the old rule covered is still covered, at every distance', () => {
    // The change only ever WIDENS. A distance whose window shrank would be a
    // regression dressed as a fix — the 5K is the one that could, and its
    // doctrine band (3-5) genuinely stops before 7.
    for (const [mi, cat] of [[HALF_MI, 'hm'], [MARATHON_MI, 'm'], [6.2, '10k'], [50, 'ultra']] as const) {
      for (let d = 0; d <= OLD_FLAT_WINDOW_DAYS; d++) {
        expect(
          raceSuppressesOvershoot(RACE, dayAfter(d), mi),
          `${cat} lost coverage the flat window had on day ${d}`,
        ).toBe(true);
      }
    }
  });

  it('the 5K is the one distance that narrows, and it narrows TO doctrine', () => {
    // 3-5 days in Research/00b. Days 6 and 7 were the old rule over-reaching,
    // not coverage worth keeping.
    expect(OVERSHOOT_RACE_RECENCY_DAYS['5k']).toBe(5);
    expect(raceSuppressesOvershoot(RACE, dayAfter(5), 3.1)).toBe(true);
    expect(raceSuppressesOvershoot(RACE, dayAfter(6), 3.1)).toBe(false);
  });

  it('each distance is spent to its own last day and no further', () => {
    const byMi: Array<[number, keyof typeof OVERSHOOT_RACE_RECENCY_DAYS]> = [
      [3.1, '5k'], [6.2, '10k'], [13.1, 'hm'], [26.2, 'm'], [50, 'ultra'],
    ];
    for (const [mi, cat] of byMi) {
      const days = OVERSHOOT_RACE_RECENCY_DAYS[cat];
      expect(overshootRaceRecencyDays(mi), `${cat} lookup`).toBe(days);
      expect(raceSuppressesOvershoot(RACE, dayAfter(days), mi), `${cat} day ${days}`).toBe(true);
      expect(raceSuppressesOvershoot(RACE, dayAfter(days + 1), mi), `${cat} day ${days + 1}`).toBe(false);
    }
  });

  it('race day itself, and a race in the future', () => {
    expect(raceSuppressesOvershoot(RACE, RACE, HALF_MI)).toBe(true);
    // A scheduled race has inflated no completed volume and must not silence a
    // finding about training already done.
    expect(raceSuppressesOvershoot(dayAfter(3), RACE, MARATHON_MI)).toBe(false);
  });

  it('an unresolvable distance takes the widest window, never a substituted row', () => {
    // Production carries label-only race rows (2 of 12, verified 2026-08-19),
    // and distanceMiOfMeta returns null for one it cannot parse.
    expect(OVERSHOOT_RACE_LOOKBACK_DAYS).toBe(
      Math.max(...Object.values(OVERSHOOT_RACE_RECENCY_DAYS)),
    );
    for (const unknown of [null, undefined, 0, -1, NaN]) {
      expect(overshootRaceRecencyDays(unknown), String(unknown)).toBe(OVERSHOOT_RACE_LOOKBACK_DAYS);
      expect(raceSuppressesOvershoot(RACE, dayAfter(OVERSHOOT_RACE_LOOKBACK_DAYS), unknown)).toBe(true);
    }
  });

  it('a missing or unparseable race date suppresses nothing', () => {
    expect(raceSuppressesOvershoot(null, dayAfter(1), MARATHON_MI)).toBe(false);
    expect(raceSuppressesOvershoot(undefined, dayAfter(1), MARATHON_MI)).toBe(false);
    expect(raceSuppressesOvershoot('not-a-date', dayAfter(1), MARATHON_MI)).toBe(false);
  });

  it('THE SOURCE · the flat 7-day window is gone from the detector', () => {
    // A behavioural test cannot see a second copy of the constant left behind
    // in SQL, and this one lived in SQL for fifteen months.
    const src = fs.readFileSync(path.join(__dirname, 'adapt.ts'), 'utf8');
    const at = src.indexOf('async function detectVolumeOvershoot');
    expect(at, 'detectVolumeOvershoot has been renamed · re-point this test').toBeGreaterThan(0);
    const query = src.slice(at, at + 6000);
    expect(query).toContain('FROM races');
    expect(query, 'the races filter is hardcoding a day window again').not.toMatch(
      /\(meta->>'date'\)::date BETWEEN \$2::date - \d+/,
    );
    expect(query).toContain('OVERSHOOT_RACE_LOOKBACK_DAYS');
    expect(query).toContain('raceSuppressesOvershoot');
  });
});

/**
 * RACEPROT-VERIFY-1 (2026-09-09) · two live, reachable gaps found by a
 * targeted verification query against David's real upcoming tune-up
 * (Santa Monica 10k, 2026-09-13, `pln_7636bcc0a201bf2d`,
 * `wk_76b0f9f77292f000`) — see `docs/PRODUCT_DECISIONS.md`. Both read the raw
 * `is_race_week` column, which `race-week.ts`'s own header states holds ONLY
 * the goal race's week, and both are dormant for David specifically (no
 * overshoot trigger firing, no pending mutation on that week) but reachable
 * under the right conditions:
 *
 *   1. `adapt.ts`'s volume_overshoot shave-target query — an `easy`-typed day
 *      inside a B/C tune-up's taper or post-race recovery window was eligible
 *      for the 17% shave, because its type is not in the excluded list and
 *      its week's `is_race_week` reads false.
 *   2. `mutate.ts`'s `rehydratePlan` weekly-mileage rollup — a tune-up race's
 *      own distance counted INTO `weeklyMi`, instead of being excluded the
 *      way the goal race's is.
 *
 * Both are fixed the same way `dose-guard.ts` already fixed this exact gap
 * for the dosing caps: `weekContainsRace` (race-week.ts), the day-level
 * detector, instead of the raw column.
 */
describe('RACEPROT-VERIFY-1 · a B/C tune-up week is race-protected the same way the goal race week is', () => {
  // ── 1 · adapt.ts's volume_overshoot shave-target eligibility ──────────────

  describe('overshootShaveEligible · the volume_overshoot shave-target filter', () => {
    /** Santa Monica 10k's week, shaped like David's real one: is_race_week is
     *  the tune-up default (false), and the taper/recovery days around the
     *  race are ordinary 'easy' rows — exactly what the old column-only guard
     *  could not see. */
    const tuneupWeekDayTypes = ['rest', 'easy', 'easy', 'shakeout', 'race', 'rest', 'easy'];

    it('THE INCIDENT · an easy day inside a B/C tune-up week was shave-eligible; it is not now', () => {
      expect(overshootShaveEligible({
        id: 'wko_taper_easy',
        weekIsRaceWeek: false, // is_race_week: only the GOAL race's week
        weekDayTypes: tuneupWeekDayTypes,
      })).toBe(false);
    });

    it('every non-race-machinery day in that same tune-up week is protected too', () => {
      for (const id of ['wko_rest', 'wko_shakeout_day', 'wko_post_race_easy']) {
        expect(overshootShaveEligible({
          id, weekIsRaceWeek: false, weekDayTypes: tuneupWeekDayTypes,
        }), id).toBe(false);
      }
    });

    it('an ordinary week with no race anywhere in it is unaffected · still eligible', () => {
      expect(overshootShaveEligible({
        id: 'wko_ordinary_easy',
        weekIsRaceWeek: false,
        weekDayTypes: ['rest', 'threshold', 'easy', 'easy', 'rest', 'easy', 'long'],
      })).toBe(true);
    });

    it('THE GOAL RACE CASE IS UNCHANGED · is_race_week=true still protects the week', () => {
      expect(overshootShaveEligible({
        id: 'wko_goal_taper_easy',
        weekIsRaceWeek: true,
        weekDayTypes: ['rest', 'easy', 'easy', 'rest', 'shakeout', 'race', 'rest'],
      })).toBe(false);
    });

    it('a row with no readable week (week_id null) is unchanged by this fix · still eligible', () => {
      // `weekContainsRace` on an unreadable week (no column, no days) returns
      // false, same as the pre-fix `COALESCE(wk.is_race_week, false) = false`
      // did for a null column — the "no week" case is not what this fix
      // changes, and this pins that it still is not.
      expect(overshootShaveEligible({
        id: 'wko_no_week', weekIsRaceWeek: null, weekDayTypes: [],
      })).toBe(true);
    });

    it('THE SOURCE · the shave query resolves eligibility through the shared detector, not the raw column alone', () => {
      const src = fs.readFileSync(path.join(__dirname, 'adapt.ts'), 'utf8');
      const at = src.indexOf("case 'volume_overshoot':");
      expect(at, "the volume_overshoot case has moved · re-point this test").toBeGreaterThan(0);
      const block = src.slice(at, at + 4000);
      expect(block).toContain('overshootShaveEligible');
      // The raw-column-only guard this replaced must not have come back.
      expect(block, 're-introduced the column-only guard this fixed').not.toMatch(
        /COALESCE\(wk\.is_race_week,\s*false\)\s*=\s*false/,
      );
    });
  });

  // ── 2 · mutate.ts's rehydratePlan weekly-mileage rollup ───────────────────

  describe("rehydratePlan's weeklyMi · a tune-up race's distance is excluded the way the goal race's is", () => {
    /** One phase, one week. `race_week` toggles is_race_week to isolate what
     *  each fixture is testing — a tune-up week always has it false. */
    function snapshotOf(opts: { isRaceWeek: boolean; raceMi: number }): PlanSnapshot {
      const workouts: PlanWorkoutRow[] = [
        { id: 'w1', week_id: 'wk0', date_iso: '2026-09-07', dow: 1, type: 'rest', distance_mi: 0, is_quality: false, is_long: false, sub_label: null, notes: null },
        { id: 'w2', week_id: 'wk0', date_iso: '2026-09-08', dow: 2, type: 'easy', distance_mi: 4, is_quality: false, is_long: false, sub_label: null, notes: null },
        { id: 'w3', week_id: 'wk0', date_iso: '2026-09-09', dow: 3, type: 'easy', distance_mi: 3, is_quality: false, is_long: false, sub_label: null, notes: null },
        { id: 'w4', week_id: 'wk0', date_iso: '2026-09-10', dow: 4, type: 'shakeout', distance_mi: 2, is_quality: false, is_long: false, sub_label: null, notes: null },
        { id: 'w5', week_id: 'wk0', date_iso: '2026-09-13', dow: 0, type: 'race', distance_mi: opts.raceMi, is_quality: false, is_long: true, sub_label: null, notes: null },
        { id: 'w6', week_id: 'wk0', date_iso: '2026-09-11', dow: 5, type: 'rest', distance_mi: 0, is_quality: false, is_long: false, sub_label: null, notes: null },
        { id: 'w7', week_id: 'wk0', date_iso: '2026-09-12', dow: 6, type: 'easy', distance_mi: 3, is_quality: false, is_long: false, sub_label: null, notes: null },
      ];
      return {
        planId: 'pln_test',
        phases: [{ id: 'phs0', label: 'TAPER', start_week_idx: 0, end_week_idx: 0, rationale: '', citation: '' }],
        weeks: [{ id: 'wk0', week_idx: 0, week_start_iso: '2026-09-07', phase_id: 'phs0', is_race_week: opts.isRaceWeek, is_cutback: true }],
        workouts,
        authoredState: {},
      };
    }

    it('THE INCIDENT · a B/C tune-up race (is_race_week=false) counted its distance into weeklyMi; it does not now', () => {
      const plan = rehydratePlan(snapshotOf({ isRaceWeek: false, raceMi: 6.2 }));
      // 4 + 3 + 2 + 3 = 12mi of ordinary running. The 6.2mi tune-up race is
      // excluded, exactly as the goal race already is on its own week.
      expect(plan.weeks[0].weeklyMi).toBe(12);
    });

    it('THE GOAL RACE CASE IS UNCHANGED · is_race_week=true still excludes the race distance', () => {
      const plan = rehydratePlan(snapshotOf({ isRaceWeek: true, raceMi: 26.2 }));
      expect(plan.weeks[0].weeklyMi).toBe(12);
    });
  });
});
