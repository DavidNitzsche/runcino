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
} from './adapt';

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
