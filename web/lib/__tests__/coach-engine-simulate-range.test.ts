/**
 * Regression tests for coach-engine.simulateRange — specifically the
 * post-race-with-far-goal-race scenario that produced an all-REST
 * plan from May 23 onward for ~100 days.
 *
 * Bug class (compound):
 *   1) decideMode required the next-A race to be inside `inWindow`
 *      (distance-aware build window). AFC Half at 96 days fell outside
 *      the 84-day HM window → mode=base.
 *   2) Once mode=base, after POST_RACE ends the phase becomes
 *      BASE_MAINTENANCE. The `heavyBlockSuspected` flag stayed true
 *      through every advanceState call, triggering the
 *      "BASE_MAINTENANCE + heavy block → REST" mandate forever.
 *   3) advanceState didn't decay heavyBlockSuspected even after the
 *      recovery window plus heavy-block window had passed.
 *
 * Fixes verified by these tests:
 *   - decideMode treats any future A-race as race-mode (no inWindow gate)
 *   - decidePhase respects recoveryWindowEnds in BOTH modes (POST_RACE
 *     before raceSubPhase) so the runner doesn't get full BASE training
 *     the day after a marathon when a goal race is also on the calendar
 *   - advanceState decays heavyBlockSuspected once past
 *     recoveryWindowEnds + HEAVY_BLOCK_REST_DAYS
 */
import { describe, expect, it } from 'vitest';
import { simulateRange } from '../coach-engine';
import type { CoachState } from '../coach-state';

function makePostRaceState(opts: { inWindow: boolean }): CoachState {
  const nextA = {
    slug: 'afc-half-2026',
    name: 'AFC Half',
    date: '2026-08-16',
    distanceMi: 13.1,
    goalDisplay: '1:45',
    goalFinishS: 6300,
    priority: 'A' as const,
    daysAway: 96,
  };
  return {
    now: '2026-05-12',
    races: {
      nextA,
      nextAny: nextA,
      // Realistic runtime data: the AFC Half is 96 days away which is
      // OUTSIDE the 84-day HM build window, so gatherCoachState would
      // not include it in inWindow. The bug fired specifically in this
      // configuration. We test both cases to confirm correctness.
      inWindow: opts.inWindow ? [nextA] : [],
      recent: [
        { slug: 'sombrero-2026', activityId: null, name: 'Sombrero Half', date: '2026-05-03', distanceMi: 13.1, finishS: 6600, daysAgo: 9 },
        { slug: 'big-sur-2026', activityId: null, name: 'Big Sur Marathon', date: '2026-04-27', distanceMi: 26.2, finishS: 13800, daysAgo: 15 },
      ],
      raceCount30d: 2,
    },
    volume: {
      last7Mi: 14,
      last28Mi: 72,
      last7Days: [],
      weeklyAvg4w: 18,
      weeklyAvg8w: 22,
      longestLast28Mi: 26.2,
      deltaPct4v4: -0.1,
    },
    intensity: { easyMi14d: 50, hardMi14d: 22, easyShare14d: 0.69 },
    recovery: {
      daysSinceLastRun: 1,
      consecutiveRunDays: 3,
      yesterday: null,
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: {
      // 2 races in 14 days + marathon in last 14 → heavy block fires.
      heavyBlockSuspected: true,
      rebuildAfterBreak: false,
      healthKitAvailable: false,
    },
    // Marathon Apr 27 + 26 days = May 23.
    recoveryWindowEndsISO: '2026-05-23',
  };
}

function longestRestStreak(days: Array<{ type: string }>): number {
  let max = 0, cur = 0;
  for (const d of days) {
    if (d.type === 'rest') { cur++; if (cur > max) max = cur; }
    else cur = 0;
  }
  return max;
}

function chunkByMonSun<T>(days: T[], firstDateISO: string): T[][] {
  // Split into Mon-Sun calendar weeks. The first chunk may be partial
  // if firstDateISO isn't a Monday.
  const out: T[][] = [];
  const firstDow = new Date(firstDateISO + 'T12:00:00Z').getUTCDay(); // 0=Sun
  // Days until next Monday (1=Mon). If firstDow=Sun(0) → 1 day to Mon.
  const daysToFirstMon = (8 - firstDow) % 7 || 7;
  const startIdx = Math.min(daysToFirstMon, days.length);
  if (startIdx > 0) out.push(days.slice(0, startIdx));
  for (let i = startIdx; i < days.length; i += 7) {
    out.push(days.slice(i, Math.min(i + 7, days.length)));
  }
  return out;
}

describe('simulateRange — post-race + far-goal-race scenario', () => {
  for (const inWindow of [false, true]) {
    describe(`inWindow=${inWindow}`, () => {
      const state = makePostRaceState({ inWindow });
      const days = simulateRange(state, '2026-05-01', '2026-08-31');

      it('produces 123 days (May 1 .. Aug 31 inclusive)', () => {
        expect(days.length).toBe(123);
      });

      it('at least 30% of days are NOT rest', () => {
        const nonRest = days.filter(d => d.type !== 'rest').length;
        const ratio = nonRest / days.length;
        expect(ratio).toBeGreaterThanOrEqual(0.30);
      });

      it('no rest streak exceeds 4 consecutive days', () => {
        // This is the heart of the bug: pre-fix this was 100+ days.
        expect(longestRestStreak(days)).toBeLessThanOrEqual(4);
      });

      it('every Mon-Sun week after day +21 (excluding race week) has at least one long run', () => {
        // Day +21 (May 12 + 21 = Jun 2) is well past the marathon
        // recovery window. Beyond that point, every full Mon-Sun chunk
        // should anchor a long run — EXCEPT the race week itself,
        // which legitimately substitutes a shakeout + race for the
        // long run. AFC Half is Aug 16 (Sun), so Aug 10-16 is taper.
        const dayPlus21Idx = days.findIndex(d => d.date === '2026-06-02');
        expect(dayPlus21Idx).toBeGreaterThan(0);
        const tail = days.slice(dayPlus21Idx);
        const weeks = chunkByMonSun(tail, tail[0].date);
        for (const week of weeks) {
          if (week.length < 7) continue; // skip partial trailing weeks
          // Race week: skip — race itself is the long effort.
          const hasRace = week.some(d => d.type === 'race');
          if (hasRace) continue;
          const hasLong = week.some(d => d.type === 'long_steady' || d.type === 'long_progression' || d.type === 'long_mp_block');
          expect(hasLong, `Week starting ${week[0].date} has no long run: ${week.map(d => d.type).join(',')}`).toBe(true);
        }
      });

      it('every full Mon-Sun week during BASE training has at least one quality session', () => {
        // Take the section that's outside POST_RACE and outside the
        // taper window (last 14 days before AFC Half Aug 16).
        // Window: Jun 2 .. Aug 1.
        const start = days.findIndex(d => d.date === '2026-06-02');
        const end = days.findIndex(d => d.date === '2026-08-01');
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const slice = days.slice(start, end + 1);
        const weeks = chunkByMonSun(slice, slice[0].date);
        for (const week of weeks) {
          if (week.length < 7) continue;
          const hasQuality = week.some(d =>
            d.type === 'threshold' || d.type === 'threshold_intervals' ||
            d.type === 'sub_threshold' || d.type === 'vo2' ||
            d.type === 'marathon_specific' || d.type === 'long_progression' ||
            d.type === 'long_mp_block'
          );
          expect(hasQuality).toBe(true);
        }
      });

      it('marks May 23 or earlier as recovery-style work, not REST-everything', () => {
        // The post-race graduated recovery should fill May 12-23 with
        // recovery/general_aerobic runs, not a wall of REST.
        const earlyWindow = days.filter(d => d.date >= '2026-05-12' && d.date <= '2026-05-23');
        const restCount = earlyWindow.filter(d => d.type === 'rest').length;
        expect(restCount).toBeLessThan(earlyWindow.length * 0.4);
      });

      it('does NOT produce an all-rest stretch past day +21', () => {
        // Concrete regression assertion: pre-fix, May 24 .. Aug 31 was
        // 100 straight REST days. Make sure the very specific failure
        // mode cannot return.
        const tail = days.filter(d => d.date >= '2026-05-24');
        const restCount = tail.filter(d => d.type === 'rest').length;
        expect(restCount).toBeLessThan(tail.length * 0.5);
      });
    });
  }
});
