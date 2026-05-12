import { describe, expect, it } from 'vitest';
import { gatherFreshness } from '../freshness';
import type { CoachState } from '../coach-state';

// Synthetic CoachState fixture — only the fields freshness reads
// (`now` + `races.recent` for vdotSnapshot). Cast through unknown so
// we don't have to fake every nested branch.
function makeState(opts: { now?: string; vdotRace?: { date: string; distanceMi: number; finishS: number; name: string } } = {}): CoachState {
  const recent = opts.vdotRace
    ? [{
        slug: 'fixture',
        activityId: null,
        name: opts.vdotRace.name,
        date: opts.vdotRace.date,
        distanceMi: opts.vdotRace.distanceMi,
        finishS: opts.vdotRace.finishS,
        daysAgo: 0, // not used by vdotSnapshot picker
      }]
    : [];
  return {
    now: opts.now ?? '2026-05-12',
    races: {
      nextA: null, nextAny: null, inWindow: [],
      recent,
      raceCount30d: 0,
    },
  } as unknown as CoachState;
}

const NOW_MS = Date.parse('2026-05-12T15:00:00Z');

describe('gatherFreshness', () => {
  it('fresh Strava + fresh check-in → all available chips fresh', async () => {
    const map = await gatherFreshness({
      state: makeState({
        vdotRace: {
          // 30 days back: half-marathon, 1:32:00 (well inside 60-day VDOT budget)
          date: '2026-04-12',
          distanceMi: 13.109,
          finishS: 92 * 60,
          name: 'Disney Half',
        },
      }),
      nowMs: NOW_MS,
      readStravaSyncAt: async () => new Date(NOW_MS - 5 * 60 * 1000),     // 5 min ago
      readCheckinAt: async () => new Date(NOW_MS - 4 * 60 * 60 * 1000),    // 4 hours ago
      readProfileUpdatedAt: async () => new Date(NOW_MS - 30 * 86_400_000),// 30 days
      readRaceCalUpdatedAt: async () => new Date(NOW_MS - 2 * 86_400_000), // 2 days
    });

    expect(map.strava.staleness).toBe('fresh');
    expect(map.strava.isAvailable).toBe(true);
    expect(map.strava.isStale).toBe(false);
    expect(map.strava.label).toMatch(/STRAVA · synced \d+m/);

    expect(map.checkin.staleness).toBe('fresh');
    expect(map.checkin.isAvailable).toBe(true);
    expect(map.checkin.isStale).toBe(false);
    expect(map.checkin.label).toMatch(/CHECK-IN · \d+h ago/);

    expect(map.vdotAnchor.isStale).toBe(false);
    expect(map.vdotAnchor.staleness).toBe('fresh');
    expect(map.vdotAnchor.isAvailable).toBe(true);

    expect(map.profile.staleness).toBe('fresh');
    expect(map.raceCal.staleness).toBe('fresh');

    // HealthKit is always unavailable.
    expect(map.healthkit.isAvailable).toBe(false);
    expect(map.healthkit.staleness).toBe('unavailable');
  });

  it('no daily_checkin row → check-in stale-bad + reason mentions "no check-in logged"', async () => {
    const map = await gatherFreshness({
      state: makeState(),
      nowMs: NOW_MS,
      readStravaSyncAt: async () => new Date(NOW_MS - 5 * 60 * 1000),
      readCheckinAt: async () => null,
      readProfileUpdatedAt: async () => null,
      readRaceCalUpdatedAt: async () => null,
    });

    expect(map.checkin.isStale).toBe(true);
    expect(map.checkin.isAvailable).toBe(false);
    expect(map.checkin.staleness).toBe('stale-bad');
    expect(map.checkin.lastRefreshISO).toBeNull();
    expect(map.checkin.reason.toLowerCase()).toContain('no check-in logged');
  });

  it('stale VDOT anchor (>60d) → vdotAnchor stale + reason cites doctrine', async () => {
    // Race 75 days back — clearly past the 60-day budget.
    const raceDate = new Date(NOW_MS - 75 * 86_400_000).toISOString().slice(0, 10);
    const map = await gatherFreshness({
      state: makeState({
        vdotRace: {
          date: raceDate,
          distanceMi: 13.109,
          finishS: 92 * 60,
          name: 'Old Half',
        },
      }),
      nowMs: NOW_MS,
      readStravaSyncAt: async () => null,
      readCheckinAt: async () => null,
      readProfileUpdatedAt: async () => null,
      readRaceCalUpdatedAt: async () => null,
    });

    expect(map.vdotAnchor.isStale).toBe(true);
    expect(map.vdotAnchor.staleness).toBe('stale-bad');
    expect(map.vdotAnchor.isAvailable).toBe(true);
    expect(map.vdotAnchor.daysSince).toBeGreaterThanOrEqual(60);
    // Reason must cite the Research doctrine path.
    expect(map.vdotAnchor.reason).toContain('Research/01-pace-zones-vdot.md');
    expect(map.vdotAnchor.reason.toLowerCase()).toContain('freshness window');
  });

  it('HealthKit always returns isAvailable:false + staleness "unavailable"', async () => {
    const map = await gatherFreshness({
      state: makeState({
        vdotRace: {
          date: '2026-04-12',
          distanceMi: 13.109,
          finishS: 92 * 60,
          name: 'Half',
        },
      }),
      nowMs: NOW_MS,
      readStravaSyncAt: async () => new Date(NOW_MS),
      readCheckinAt: async () => new Date(NOW_MS),
      readProfileUpdatedAt: async () => new Date(NOW_MS),
      readRaceCalUpdatedAt: async () => new Date(NOW_MS),
    });
    expect(map.healthkit.isAvailable).toBe(false);
    expect(map.healthkit.staleness).toBe('unavailable');
    expect(map.healthkit.label.toLowerCase()).toContain('healthkit');
    expect(map.healthkit.lastRefreshISO).toBeNull();
  });

  it('Strava 26h stale → stale-bad with refresh prompt in label', async () => {
    const map = await gatherFreshness({
      state: makeState(),
      nowMs: NOW_MS,
      readStravaSyncAt: async () => new Date(NOW_MS - 26 * 60 * 60 * 1000),
      readCheckinAt: async () => null,
      readProfileUpdatedAt: async () => null,
      readRaceCalUpdatedAt: async () => null,
    });
    expect(map.strava.isStale).toBe(true);
    expect(map.strava.staleness).toBe('stale-bad');
    expect(map.strava.label.toLowerCase()).toContain('connect to refresh');
  });

  it('no Strava sync at all → stale-bad with "never synced"', async () => {
    const map = await gatherFreshness({
      state: makeState(),
      nowMs: NOW_MS,
      readStravaSyncAt: async () => null,
      readCheckinAt: async () => null,
      readProfileUpdatedAt: async () => null,
      readRaceCalUpdatedAt: async () => null,
    });
    expect(map.strava.isAvailable).toBe(false);
    expect(map.strava.staleness).toBe('stale-bad');
    expect(map.strava.label).toMatch(/never synced/i);
  });

  it('check-in inside 36h budget but past 24h → still fresh', async () => {
    const map = await gatherFreshness({
      state: makeState(),
      nowMs: NOW_MS,
      readStravaSyncAt: async () => null,
      readCheckinAt: async () => new Date(NOW_MS - 18 * 60 * 60 * 1000),
      readProfileUpdatedAt: async () => null,
      readRaceCalUpdatedAt: async () => null,
    });
    expect(map.checkin.isStale).toBe(false);
    expect(map.checkin.staleness).toBe('fresh');
    expect(map.checkin.label).toMatch(/CHECK-IN · \d+h ago/);
  });

  it('profile stale past 180 days → stale-ok (not stale-bad)', async () => {
    const map = await gatherFreshness({
      state: makeState(),
      nowMs: NOW_MS,
      readStravaSyncAt: async () => null,
      readCheckinAt: async () => null,
      readProfileUpdatedAt: async () => new Date(NOW_MS - 200 * 86_400_000),
      readRaceCalUpdatedAt: async () => null,
    });
    expect(map.profile.isStale).toBe(true);
    expect(map.profile.staleness).toBe('stale-ok');
    expect(map.profile.isAvailable).toBe(true);
  });
});
