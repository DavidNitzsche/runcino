/**
 * _canonical_family.test.ts · the absorber may not build a row out of half of
 * each source.
 *
 * `lib/runs/coherence.ts` stops the contradiction being PRINTED. This stops it
 * being WRITTEN. Both are needed: the read guard repairs the 256 rows already
 * in the table, and this stops the 257th acquiring the shape.
 *
 * The scenario below is the real merge that produced David's 2026-08-23 row,
 * replayed field by field against `familyGuardedFill`.
 */

import { describe, it, expect } from 'vitest';
import {
  familyGuardedFill, CLOCK_FAMILY, SOURCE_TIER, existingTierFor,
} from '@/lib/runs/canonical';
import { reconcileRun } from '@/lib/runs/coherence';

/**
 * The canonical row as /api/watch/workouts/complete wrote it, before any
 * absorption. Verbatim key set: the watch writes `durationSec`, `movingSec`,
 * `timeMoving` and `avgPaceMinPerMi`, and no other member of the clock family.
 */
const WATCH_CANONICAL: Record<string, unknown> = {
  date: '2026-08-23', source: 'watch', distanceMi: 11.01,
  durationSec: 5298, movingSec: null, timeMoving: null,
  avgPaceMinPerMi: '8:01',
};

/** The Strava twin that lost the dedup. Internally consistent at 3:37/mi. */
const STRAVA_LOSER: Record<string, unknown> = {
  date: '2026-08-23', source: 'strava_webhook', distanceMi: 11.01,
  movingTimeS: 2389, movingSec: 2389, durationSec: 2389, elapsedTimeS: 2389,
  paceSPerMi: 217, avgPaceMinPerMi: '3:37', avgSpeedMph: 16.6,
};

const WATCH_TIER = SOURCE_TIER.watch;
const STRAVA_TIER = SOURCE_TIER.strava_webhook;

describe('the tier ladder and the hole beneath it', () => {
  it('the watch outranks Strava, which is why durationSec was protected', () => {
    expect(WATCH_TIER).toBeGreaterThan(STRAVA_TIER);
    // `existingTierFor` floors a field at the row's OWN source, so the watch's
    // unstamped durationSec is worth 5 rather than 0.
    expect(existingTierFor(WATCH_CANONICAL, {}, 'durationSec')).toBe(WATCH_TIER);
  });

  it('every clock-family member the Strava row carries is REFUSED', () => {
    // Each of these was absent on the canonical, so the old fill-when-missing
    // branch took it unconditionally. The watch's own durationSec, at tier 5,
    // now blocks all of them.
    for (const key of ['movingTimeS', 'elapsedTimeS', 'paceSPerMi', 'avgSpeedMph']) {
      const v = familyGuardedFill(key, WATCH_CANONICAL, {}, STRAVA_TIER);
      expect(v.allow, `${key} should have been refused`).toBe(false);
      if (!v.allow) expect(v.siblingTier).toBe(WATCH_TIER);
    }
  });

  it('and so is movingSec, which is the one that carried the 3:37 pace', () => {
    // `movingSec` is present-but-JSON-null on the watch row, which the
    // absorber treats as missing. It is still a clock-family member.
    expect(familyGuardedFill('movingSec', WATCH_CANONICAL, {}, STRAVA_TIER).allow).toBe(false);
  });

  it('non-clock fields are absorbed exactly as before', () => {
    // The absorber's whole value is filling gaps. Nothing outside the family
    // is touched by this guard — a Strava row is still the only source of
    // kudos, polyline, gear and suffer score.
    for (const key of ['summaryPolyline', 'kudosCount', 'sufferScore', 'calories', 'avgHr', 'elevGainFt']) {
      expect(familyGuardedFill(key, WATCH_CANONICAL, {}, STRAVA_TIER).allow, key).toBe(true);
    }
  });

  it('a HIGHER-tier row still fills the gaps · this is not a freeze', () => {
    // A Strava-sourced canonical absorbing a watch row must take the watch's
    // clocks. The guard is about rank, not about clock keys being untouchable.
    const stravaCanonical = { source: 'strava', distanceMi: 11.01, paceSPerMi: 217 };
    expect(familyGuardedFill('durationSec', stravaCanonical, {}, WATCH_TIER).allow).toBe(true);
  });

  it('an equal-tier row fills too · two watches are not a contradiction', () => {
    const phoneCanonical = { source: 'phone', distanceMi: 6.0, durationSec: 3000 };
    expect(SOURCE_TIER.phone).toBe(SOURCE_TIER.watch);
    expect(familyGuardedFill('movingTimeS', phoneCanonical, {}, WATCH_TIER).allow).toBe(true);
  });

  it('a canonical with NO clock at all takes whatever arrives', () => {
    // The gap the absorber exists for. Nothing to contradict, so nothing to
    // guard — a row with no time is worse than a row with Strava's time.
    const bare = { source: 'manual', distanceMi: 11.01 };
    for (const key of CLOCK_FAMILY) {
      expect(familyGuardedFill(key, bare, {}, STRAVA_TIER).allow, key).toBe(true);
    }
  });
});

describe('the row that would have been written', () => {
  it('old absorber · half the watch, half Strava, and unreadable', () => {
    // Replay the OLD branch: fill every missing key unconditionally.
    const old: Record<string, unknown> = { ...WATCH_CANONICAL };
    for (const [k, v] of Object.entries(STRAVA_LOSER)) {
      if (['id', 'activityId', 'source', 'ingestedAt', 'mergedIntoId'].includes(k)) continue;
      if (v == null) continue;
      const cur = old[k];
      if (cur == null || cur === '') old[k] = v;       // "always populate"
    }
    // This is the production row, reproduced exactly.
    expect(old.durationSec).toBe(5298);   // the watch's, protected by tier
    expect(old.movingTimeS).toBe(2389);   // Strava's, through the hole
    expect(old.paceSPerMi).toBe(217);     // Strava's, through the hole
    expect(old.avgPaceMinPerMi).toBe('8:01'); // the watch's, protected by tier

    // And it contradicts itself.
    const c = reconcileRun(old);
    expect(c.refusals.map((r) => r.family)).toContain('clock.moving-disproved');
  });

  it('new absorber · the watch\'s clock stands alone, and the row reads clean', () => {
    const now: Record<string, unknown> = { ...WATCH_CANONICAL };
    for (const [k, v] of Object.entries(STRAVA_LOSER)) {
      if (['id', 'activityId', 'source', 'ingestedAt', 'mergedIntoId'].includes(k)) continue;
      if (v == null) continue;
      const cur = now[k];
      if (cur == null || cur === '') {
        if (familyGuardedFill(k, WATCH_CANONICAL, {}, STRAVA_TIER).allow) now[k] = v;
      }
    }
    expect(now.durationSec).toBe(5298);
    expect(now.movingTimeS).toBeUndefined();
    expect(now.paceSPerMi).toBeUndefined();
    expect(now.elapsedTimeS).toBeUndefined();
    expect(now.avgSpeedMph).toBeUndefined();

    // Nothing to refuse, because nothing contradicts.
    const c = reconcileRun(now);
    expect(c.refusals).toHaveLength(0);
    expect(c.elapsedSec).toBe(5298);
    expect(Math.round(c.paceSecPerMi!)).toBe(481);   // 8:01/mi
    expect(c.paceBasis).toBe('elapsed');
  });

  it('the guard does not cost the merge its actual job', () => {
    // Everything Strava uniquely holds still lands. The point of the absorber
    // is preserved; only the contradicting arithmetic is held back.
    const rich = { ...STRAVA_LOSER, summaryPolyline: 'abc', kudosCount: 4, sufferScore: 120 };
    const now: Record<string, unknown> = { ...WATCH_CANONICAL };
    for (const [k, v] of Object.entries(rich)) {
      if (v == null) continue;
      const cur = now[k];
      if ((cur == null || cur === '')
          && familyGuardedFill(k, WATCH_CANONICAL, {}, STRAVA_TIER).allow) now[k] = v;
    }
    expect(now.summaryPolyline).toBe('abc');
    expect(now.kudosCount).toBe(4);
    expect(now.sufferScore).toBe(120);
  });
});
