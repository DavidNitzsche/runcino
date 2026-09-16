/**
 * lib/race/_last_known_good_projection.test.ts · the cache's own contract,
 * tested directly rather than through `loadPlanSnapshot` — which, per
 * BA-01R item 12 (2026-09-15), no longer writes it at all. These four
 * cases (scoping, max-age, withdrawal, unformattable) were previously
 * `_skip_and_projection.test.ts`'s 3.4/3.5/3.8/3.9, exercised through
 * `loadPlanSnapshot`'s old inline resolve-and-cache loop; relocated here so
 * the cache's own regression coverage survives the loop's removal, per
 * `lib/race/last-known-good-projection.ts`'s own header for why the WRITE
 * side moved to `lib/race/race-outlook.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  projectionCacheKey,
  readLastKnownGoodProjection,
  writeLastKnownGoodProjection,
  clearLastKnownGoodProjection,
  __resetLastKnownGoodProjectionsForTest,
} from './last-known-good-projection';

const UUID = '00000000-0000-0000-0000-000000000042';
const OTHER_UUID = '00000000-0000-0000-0000-0000000000ff';
const SLUG = 'sm10k';
const TODAY = '2026-09-07';
const TOMORROW = '2026-09-08';

beforeEach(() => {
  __resetLastKnownGoodProjectionsForTest();
});

describe('last-known-good projection cache', () => {
  it('a written value reads back exactly', () => {
    const key = projectionCacheKey(UUID, SLUG, TODAY);
    writeLastKnownGoodProjection(key, '42:57');
    expect(readLastKnownGoodProjection(key)?.text).toBe('42:57');
  });

  it('an unwritten key reads as nothing', () => {
    expect(readLastKnownGoodProjection(projectionCacheKey(UUID, SLUG, TODAY))).toBeNull();
  });

  it('3.4 · scoped to ONE runner, ONE race, ONE day', () => {
    writeLastKnownGoodProjection(projectionCacheKey(UUID, SLUG, TODAY), '42:57');

    // A DIFFERENT runner must not read this runner's projection.
    expect(readLastKnownGoodProjection(projectionCacheKey(OTHER_UUID, SLUG, TODAY))).toBeNull();
    // A DIFFERENT day must not read yesterday's projection — the quantity is
    // a function of `today` (Rule 10 · the anchor is in the key).
    expect(readLastKnownGoodProjection(projectionCacheKey(UUID, SLUG, TOMORROW))).toBeNull();
    // The actual key still resolves.
    expect(readLastKnownGoodProjection(projectionCacheKey(UUID, SLUG, TODAY))?.text).toBe('42:57');
  });

  it('3.5 · a value older than its max age is not served', () => {
    vi.useFakeTimers();
    const key = projectionCacheKey(UUID, SLUG, TODAY);
    writeLastKnownGoodProjection(key, '42:57');
    expect(readLastKnownGoodProjection(key)?.text).toBe('42:57');

    // Past RACE_PROJECTION_LKG_MAX_AGE_MS (15 min) — Rule 16: a value this
    // old could disagree with what Race Detail resolves fresh on its own
    // screen.
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    expect(readLastKnownGoodProjection(key)).toBeNull();
    vi.useRealTimers();
  });

  it('3.8 · FINISHEST-RESURRECT-1 · a cleared entry does not come back', () => {
    const key = projectionCacheKey(UUID, SLUG, TODAY);
    writeLastKnownGoodProjection(key, '42:57');
    expect(readLastKnownGoodProjection(key)?.text).toBe('42:57');

    // The engine withdraws the claim (case 2 in `cacheProjectionFromOutlook`:
    // genuinely nothing to project).
    clearLastKnownGoodProjection(key);
    expect(readLastKnownGoodProjection(key)).toBeNull();
  });

  it('3.9 · clearing is idempotent and safe on a key that was never written', () => {
    const key = projectionCacheKey(UUID, SLUG, TODAY);
    expect(() => clearLastKnownGoodProjection(key)).not.toThrow();
    expect(readLastKnownGoodProjection(key)).toBeNull();
  });
});
