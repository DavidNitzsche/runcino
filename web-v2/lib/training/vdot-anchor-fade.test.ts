/**
 * 2026-06-09 · race-killer F1 regression tests — the stale-anchor fade.
 * 2026-08-17 · DOCTRINE-2 · re-scoped onto the doctrine freshness window.
 *
 * F1's fix was that an aging anchor must GLIDE out rather than vanish
 * overnight. That behaviour is unchanged and still locked below. What changed
 * is WHERE the glide happens.
 *
 * These tests used to be written against a 180-day full-value window with a
 * 120-day tail, so they asserted that a 197-day-old half marathon was still the
 * runner's pace anchor. `Research/01-pace-zones-vdot.md` §"Freshness window"
 * says the opposite in a four-row table — 12+ weeks is "Expired. Don't anchor
 * pace prescription on this VDOT" — and §"Implementation notes" writes the rule
 * directly at this engine: "use ≤56 days as the canonical freshness window."
 *
 * So the bands are now 56 / 84 days:
 *   ≤ 56 d   full value
 *   56-84 d  faded and FLOOR-ONLY · ranks below any in-window candidate, but
 *            still anchors when it is the only evidence there is
 *   > 84 d   expired · not a candidate
 *
 * The fixture keeps the runner's real race history and simply asks the
 * questions at dates that exercise those bands.
 */
import { describe, expect, it } from 'vitest';
import {
  bestRecentVdot,
  predictRaceTime,
  VDOT_FULL_VALUE_DAYS,
  VDOT_EXPIRY_DAYS,
  vdotFromRace,
  type VdotCandidate,
} from './vdot';

/** Narrow the race|run candidate union to a race slug (null for runs). */
const slugOf = (c: VdotCandidate | null | undefined): string | null =>
  c && c.source === 'race' ? c.slug : null;

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const DISNEY_DATE = '2026-02-01';
const RACES = [
  { slug: 'rose-bowl-half-2026', name: 'Rose Bowl Half', date: '2026-01-18', priority: 'A' as const, distance_mi: 13.109, finish_seconds: 5918 },
  { slug: 'disney-half-2026', name: 'Disney Half Marathon', date: DISNEY_DATE, priority: 'A' as const, distance_mi: 13.109, finish_seconds: 5694 },
  { slug: 'la-marathon-2026', name: 'LA Marathon', date: '2026-03-08', priority: 'A' as const, distance_mi: 26.219, finish_seconds: 12700 },
];

describe('bestRecentVdot — the doctrine freshness window (DOCTRINE-2)', () => {
  it('inside 56 days: full value, effective ≡ raw', () => {
    const { best, considered } = bestRecentVdot(RACES, addDays(DISNEY_DATE, 30));
    expect(slugOf(best)).toBe('disney-half-2026');
    expect(best?.vdot).toBe(47.9);
    expect(best?.vdot_raw).toBe(47.9);
    for (const c of considered) expect(c.vdot).toBe(c.vdot_raw);
  });

  it('on the window edge (day 56) the anchor is still at full value', () => {
    const { best } = bestRecentVdot([RACES[1]], addDays(DISNEY_DATE, VDOT_FULL_VALUE_DAYS));
    expect(best?.vdot).toBe(47.9);
  });

  it('past 84 days the anchor is EXPIRED — doctrine refuses to anchor on it', () => {
    const dayAfterExpiry = addDays(DISNEY_DATE, VDOT_EXPIRY_DAYS + 1);
    const { considered } = bestRecentVdot([RACES[1]], dayAfterExpiry);
    expect(considered.some((c) => slugOf(c) === 'disney-half-2026')).toBe(false);
  });

  it('with every race expired there is NO anchor — the honest answer, not a stale one', () => {
    // Aug 17: Disney is 197 days old, LA 162, Rose Bowl 211. Research/01 calls
    // all three expired. The old 180-day window answered "47.8" here, which is
    // a pace prescription off a 6.5-month-old race.
    const { best, considered } = bestRecentVdot(RACES, '2026-08-17');
    expect(considered).toHaveLength(0);
    expect(best).toBeNull();
  });
});

describe('bestRecentVdot — the fade still glides, at the doctrine boundary (F1)', () => {
  it('no cliff crossing day 56: the fade is invisible at day granularity', () => {
    const before = bestRecentVdot([RACES[1]], addDays(DISNEY_DATE, VDOT_FULL_VALUE_DAYS));
    const after = bestRecentVdot([RACES[1]], addDays(DISNEY_DATE, VDOT_FULL_VALUE_DAYS + 1));
    expect(before.best?.vdot).toBe(47.9);
    expect(after.best).not.toBeNull();
    expect(Math.abs(after.best!.vdot - before.best!.vdot)).toBeLessThanOrEqual(0.5);
  });

  it('continuity across the whole floor-only band — no single-day move over 0.5', () => {
    let prev: number | null = null;
    for (let age = 40; age <= VDOT_EXPIRY_DAYS; age++) {
      const { best } = bestRecentVdot([RACES[1]], addDays(DISNEY_DATE, age));
      expect(best, `no anchor at age ${age}, still inside the window`).not.toBeNull();
      if (prev != null) {
        expect(Math.abs(best!.vdot - prev), `cliff at age ${age}: ${prev} → ${best!.vdot}`)
          .toBeLessThanOrEqual(0.5);
      }
      prev = best!.vdot;
    }
    // The glide is gentle: 28 days of tail at 0.1 per 14 days.
    expect(prev).toBeGreaterThanOrEqual(47.6);
    expect(prev).toBeLessThan(47.9);
  });

  it('a projection off a faded anchor never reads faster than the race itself said', () => {
    const { best } = bestRecentVdot([RACES[1]], addDays(DISNEY_DATE, 80));
    const proj = predictRaceTime(best!.vdot, 13.1)!;
    expect(proj).toBeGreaterThanOrEqual(5694);
    expect(proj).toBeLessThan(5694 + 75);
  });
});

describe('bestRecentVdot — floor-only demotion inside 56-84 days', () => {
  // A tune-up inside the fresh window, and a faded anchor with a HIGHER VDOT.
  // Doctrine: the stale one is "use only as a floor" — it must not outrank
  // current evidence however large it is.
  const freshDay = addDays(DISNEY_DATE, 70);   // Disney age 70 · floor-only band
  const SLOWER_BUT_FRESH = {
    slug: 'tune-up-10k', name: 'Tune-up 10K', date: addDays(freshDay, -10),
    priority: 'B' as const, distance_mi: 6.2137, finish_seconds: 2820,   // ≈ VDOT 43
  };

  it('a fresher, SLOWER race outranks a faded, faster one', () => {
    const { best, considered } = bestRecentVdot([RACES[1], SLOWER_BUT_FRESH], freshDay);
    expect(slugOf(best)).toBe('tune-up-10k');
    expect(best!.vdot).toBeLessThan(47.8);
    // Demoted, not dropped — still visible for display and debugging.
    expect(considered.some((c) => slugOf(c) === 'disney-half-2026')).toBe(true);
  });

  it('every floor-only candidate ranks below every in-window candidate', () => {
    const { considered } = bestRecentVdot([RACES[1], SLOWER_BUT_FRESH], freshDay);
    const firstStale = considered.findIndex((c) => c.age_days > VDOT_FULL_VALUE_DAYS);
    const lastFresh = considered.reduce(
      (acc, c, i) => (c.age_days <= VDOT_FULL_VALUE_DAYS ? i : acc), -1);
    expect(firstStale).toBeGreaterThan(lastFresh);
  });

  it('with nothing fresher, the faded anchor still anchors — a floor you have beats a guess you do not', () => {
    const { best } = bestRecentVdot([RACES[1]], freshDay);
    expect(slugOf(best)).toBe('disney-half-2026');
    expect(best!.vdot).toBeGreaterThanOrEqual(47.7);
  });

  it('fresh evidence that scores HIGHER takes over outright', () => {
    const faster = { ...SLOWER_BUT_FRESH, slug: 'tune-up-10k-fast', finish_seconds: 2560 };
    const { best } = bestRecentVdot([RACES[1], faster], freshDay);
    expect(slugOf(best)).toBe('tune-up-10k-fast');
    expect(best!.vdot).toBeGreaterThan(47.8);
  });
});

// ── 2026-08-17 · run-evidence cancellation fix (soft cap vs sort penalty) ───
//
// Runs are soft-capped at bestRaceRaw + 1.0 (AUDIT #8) AND used to be
// penalized exactly 1.0 in the sort — the permitted +1 lead cancelled to
// zero, so training evidence could never move the headline off a race
// anchor, by construction. Now cap-bounded runs sort at their capped face
// value: a capped run genuinely leads by up to the doctrinal +1, and a race
// still wins exact ties (stable sort, races first).
//
// DOCTRINE-2 (2026-08-17): the scenario DATES moved inside the 56-day window.
// The behaviour under test is the SOFT CAP and the sort, neither of which
// changed — but the old fixtures posed the question on a day when every race
// in them was expired, which now (correctly) leaves nothing to cap against.

const LA_DATE = '2026-03-08';
const LA_ONLY = [
  { slug: 'la-marathon-2026', name: 'LA Marathon', date: LA_DATE, priority: 'A' as const, distance_mi: 26.219, finish_seconds: 12700 },
];

// Strong quality effort: 10K time-trial-grade run, reads well above the
// ceiling → clamped to race + 1.0.
const HOT_RUN = {
  id: 'run-hot', date: addDays(LA_DATE, 20), workout_type: 'race',
  distance_mi: 6.2137, finish_seconds: 2560,
  avg_hr: null, max_hr: null, zone: null,
};
const ASK_DAY = addDays(LA_DATE, 30);   // LA age 30 · in window · run age 10

describe('bestRecentVdot — capped training run leads the race anchor by +1', () => {
  it('a run clamped to the soft cap wins the headline at race + 1.0 (not a tie)', () => {
    const raceVdot = vdotFromRace(12700, 26.219)!;           // LA ≈ 44.1
    const ceiling = Math.round((raceVdot + 1.0) * 10) / 10;  // ≈ 45.1
    const { best } = bestRecentVdot(LA_ONLY, ASK_DAY, VDOT_FULL_VALUE_DAYS, [HOT_RUN]);
    expect(best?.source).toBe('run');
    expect(best?.vdot).toBe(ceiling);
    // The cap is intact — the raw 10K read (≈48.5) never leaks through.
    expect(vdotFromRace(2560, 6.2137)!).toBeGreaterThan(ceiling);
  });

  it('race wins EXACT ties against a run reading identical fitness', () => {
    // Run with byte-identical distance/time to the Disney race → same
    // vdotFromRace read → exact tie → the race is the headline (stable
    // sort, races precede runs).
    const disney = [RACES[1]];
    const twinRun = { id: 'twin', date: addDays(DISNEY_DATE, 28), workout_type: 'race', distance_mi: 13.109, finish_seconds: 5694, avg_hr: null, max_hr: null, zone: null };
    const { best } = bestRecentVdot(disney, addDays(DISNEY_DATE, 32), VDOT_FULL_VALUE_DAYS, [twinRun]);
    expect(best?.source).toBe('race');
  });

  it('the soft-cap ceiling anchors to IN-WINDOW evidence, never a floor-only race', () => {
    // A faded, faster half (age 70) plus a fresh, slower marathon. The ceiling
    // for training reads must come from the fresh proof — otherwise an expired
    // anchor keeps licensing training estimates the doctrine calls unsupported.
    const freshRace = { ...LA_ONLY[0], date: addDays(DISNEY_DATE, 55) };
    const askDay = addDays(DISNEY_DATE, 70);
    const run = { ...HOT_RUN, date: addDays(askDay, -5) };
    const freshVdot = vdotFromRace(12700, 26.219)!;
    const ceiling = Math.round((freshVdot + 1.0) * 10) / 10;
    const { best, considered } = bestRecentVdot([RACES[1], freshRace], askDay, VDOT_FULL_VALUE_DAYS, [run]);
    expect(best?.source).toBe('run');
    expect(best?.vdot).toBe(ceiling);
    // Faded Disney (47.9) did not set the ceiling...
    expect(ceiling).toBeLessThan(46.5);
    // ...and is still visible, demoted.
    expect(considered.some((c) => slugOf(c) === 'disney-half-2026')).toBe(true);
  });
});
