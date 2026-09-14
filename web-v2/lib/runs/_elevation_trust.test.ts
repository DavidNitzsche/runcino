/**
 * lib/runs/_elevation_trust.test.ts · ELEVTRUST-1 (2026-09-13).
 *
 * Fail-before / pass-after for the elevation-trust gap found alongside the
 * Santa Monica 10K splits defect: `elevGainSource:'watch'` — the whole-run
 * barometric total the Faff watch app writes directly
 * (`app/api/watch/workouts/complete/route.ts`) — was entirely absent from
 * `ELEVATION_TRUST`, so it scored trust 0 and lost to every ranked
 * candidate, including a `gps_derived` figure known to run 2.3x the
 * barometer.
 *
 * Real production shape, `faff_readonly`, 2026-09-13:
 *
 *   canonical  runs.id -159534527913687   elevGainFt 176  elevGainSource 'watch'
 *   HK twin    runs.id -2879323795619998  elevGainFt 466  elevGainSource 'gps_derived'
 *   Strava twin runs.id 20159746844       elevGainFt 179  elevGainSource 'raw'
 *
 * and the known-bad legacy row that motivates the credibility recheck rather
 * than a blanket trust bump, from the same live table:
 *
 *   runs, 2026-08-26, non-canonical twin: elevGainFt 2807, distanceMi 7.78,
 *   elevGainSource 'watch' → 361 ft/mi, well past `SUSPICION_THRESHOLD_FT_PER_MI`
 *   (250) and from before `elev-sanity.ts`'s 2026-08-30 fix existed.
 */
import { describe, it, expect } from 'vitest';
import { pickElevationGain, ELEVATION_TRUST } from '@/lib/runs/elevation';
import { SUSPICION_THRESHOLD_FT_PER_MI } from '@/lib/runs/elev-sanity';

/** The old table, reimplemented locally — no `watch` entry — so the
 *  fail-before case is proven against the actual pre-fix shape rather than a
 *  paraphrase of it. */
const OLD_TRUST: Record<string, number> = {
  raw: 100,
  treadmill_incline: 90,
  gps_derived: 40,
  recomputed: 20,
};

function pickElevationGainPreFix(
  candidates: Array<{ ft: number | null; source: string | null }>,
) {
  let best: { ft: number; source: string } | null = null;
  let bestTrust = -1;
  for (const c of candidates) {
    const ft = Number(c.ft);
    if (!Number.isFinite(ft) || ft < 0) continue;
    const t = c.source ? (OLD_TRUST[c.source] ?? 0) : 0;
    if (t <= 0) continue;
    if (t > bestTrust) {
      bestTrust = t;
      best = { ft: Math.round(ft), source: String(c.source) };
    }
  }
  return best;
}

describe('ELEVTRUST-1 · Santa Monica 10K, real production row shape', () => {
  it('FAIL-BEFORE: the old table excludes "watch" entirely, so gps_derived wins with no competing twin', () => {
    // Same run, but without the Strava twin that happened to save it — the
    // common case: most training runs and most races have no Strava sync.
    const picked = pickElevationGainPreFix([
      { ft: 176, source: 'watch' },       // canonical, correct
      { ft: 466, source: 'gps_derived' }, // HealthKit twin, wrong
    ]);
    expect(picked).not.toBeNull();
    expect(picked!.source).toBe('gps_derived');
    expect(picked!.ft).toBe(466); // the wrong number, displayed with confidence
  });

  it('PASS-AFTER: "watch" is ranked and wins over gps_derived with no Strava twin present', () => {
    const picked = pickElevationGain([
      { ft: 176, source: 'watch' },
      { ft: 466, source: 'gps_derived' },
    ], 6.28);
    expect(picked).not.toBeNull();
    expect(picked!.source).toBe('watch');
    expect(picked!.ft).toBe(176);
    expect(picked!.measured).toBe(true);
  });

  it('the full three-candidate Santa Monica set still resolves to the true value', () => {
    const picked = pickElevationGain([
      { ft: 176, source: 'watch', ingest: 'watch' },
      { ft: 466, source: 'gps_derived', ingest: 'apple_watch' },
      { ft: 179, source: 'raw', ingest: 'strava_webhook' },
    ], 6.28);
    // Strava's `raw` (trust 100) and the watch's `watch` (trust 100, and it
    // clears the credibility recheck at 176/6.28 = 28 ft/mi) are equally
    // ranked; either true reading is an acceptable answer, and both are near
    // -identical (176 vs 179). What must never win is the 466 ft outlier.
    expect(picked).not.toBeNull();
    expect(['watch', 'raw']).toContain(picked!.source);
    expect(picked!.ft).toBeLessThan(200);
  });

  it('a "watch" reading past the suspicion threshold is refused, not trusted at parity with raw', () => {
    // The confirmed live 2026-08-26 outlier: 2807 ft over 7.78 mi = 361 ft/mi.
    const ftPerMi = 2807 / 7.78;
    expect(ftPerMi).toBeGreaterThan(SUSPICION_THRESHOLD_FT_PER_MI);
    const picked = pickElevationGain([
      { ft: 2807, source: 'watch' },
    ], 7.78);
    expect(picked).toBeNull();
  });

  it('a "watch" reading past the suspicion threshold does not silently promote a gps_derived candidate either', () => {
    const picked = pickElevationGain([
      { ft: 2807, source: 'watch' },       // refused · past the band
      { ft: 900, source: 'gps_derived' },  // still ranked, still the best survivor
    ], 7.78);
    expect(picked).not.toBeNull();
    expect(picked!.source).toBe('gps_derived');
    expect(picked!.ft).toBe(900);
  });

  it('with no run distance to check ft/mi against, a "watch" candidate is let through rather than refused', () => {
    const picked = pickElevationGain([
      { ft: 176, source: 'watch' },
    ]); // no distanceMi argument at all
    expect(picked).not.toBeNull();
    expect(picked!.ft).toBe(176);
  });

  it('"watch" sits in the live trust table at parity with "raw"', () => {
    expect(ELEVATION_TRUST.watch).toBe(ELEVATION_TRUST.raw);
    expect(ELEVATION_TRUST.watch).toBeGreaterThan(ELEVATION_TRUST.gps_derived);
  });
});
