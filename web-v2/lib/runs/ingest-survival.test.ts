/**
 * lib/runs/ingest-survival.test.ts · what survives a second write.
 *
 * The 2026-08-21 ingest audit found three ways a run got worse the second time
 * something touched it. Each one has a case here, in the writer-A-then-writer-B
 * shape Rule 6 prescribes: writer A puts a field on the row, writer B writes
 * again without it, the field must still be there.
 *
 *   1 · splits erased by an empty array (Rule 6's null-vs-empty hole)
 *   2 · the tier ladder inverted on first absorption (provenance floor)
 *   3 · a run's timestamp rewritten by a row that lost to it (identity)
 *
 * Plus the fix that makes cross-source dedup exact rather than inferred: a run
 * carrying an absolute `startUtc` matches its twin no matter which zone each
 * side wrote its wall clock in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergePreserve, omitEmpty } from './merge-safe';
import { existingTierFor, IDENTITY_FILL_ONLY, SOURCE_TIER } from './canonical';
import { isSameRun, isTrustworthy, clusterRuns, type RunRow } from './identity';

const TZ = 'America/Los_Angeles';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Rule 6 · a writer with nothing to say must say nothing
 * ═══════════════════════════════════════════════════════════════════════ */
describe('Rule 6 · runs.data merge preserves what the incoming payload omits', () => {
  const realSplits = [
    { mile: 1, paceSPerMi: 521, avgHr: 140 },
    { mile: 2, paceSPerMi: 518, avgHr: 145 },
  ];

  it('writer A absorbs splits · writer B re-ingests without them · splits survive', () => {
    // Writer A: the merge absorber pulls real per-mile splits onto the canonical.
    const afterA = { source: 'apple_watch', distanceMi: 11.12, splits: realSplits };

    // Writer B: HealthKit re-syncs the same HKWorkout. It has no usable splits
    // this time (route dropped them, or the workout never carried any).
    const writerBPayload = {
      source: 'apple_watch',
      distanceMi: 11.12,
      ...omitEmpty('splits', [] as typeof realSplits),
      splits_unreliable: false,
    };

    const afterB = mergePreserve(afterA, writerBPayload);
    expect(afterB.splits).toEqual(realSplits);
  });

  it('the pre-fix payload — splits: [] — is exactly what erased them', () => {
    // Kept as the counter-example so the reason for `omitEmpty` stays legible.
    // `jsonb_strip_nulls` does not strip an empty array, so it wins the merge.
    const afterA = { source: 'apple_watch', splits: realSplits };
    const preFixPayload = { source: 'apple_watch', splits: [] as typeof realSplits };
    expect(mergePreserve(afterA, preFixPayload).splits).toEqual([]);
  });

  it('a null cannot erase an absorbed value · that half already worked', () => {
    const afterA = { routePolyline: 'abc123', weather: { temp_f: 54 } };
    const afterB = mergePreserve(afterA, { routePolyline: null, tempF: 54 });
    expect(afterB.routePolyline).toBe('abc123');
    expect(afterB.weather).toEqual({ temp_f: 54 });
  });

  it('a real value still wins · preservation is not stickiness', () => {
    const afterA = { splits: realSplits };
    const better = [...realSplits, { mile: 3, paceSPerMi: 515, avgHr: 149 }];
    expect(mergePreserve(afterA, { splits: better }).splits).toEqual(better);
  });

  it('omitEmpty drops every shape that means "I have nothing"', () => {
    expect(omitEmpty('splits', [])).toEqual({});
    expect(omitEmpty('name', '')).toEqual({});
    expect(omitEmpty('x', null)).toEqual({});
    expect(omitEmpty('x', undefined)).toEqual({});
    expect(omitEmpty('splits', realSplits)).toEqual({ splits: realSplits });
    expect(omitEmpty('elevGainFt', 0)).toEqual({ elevGainFt: 0 });  // 0 is a value
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · the tier ladder · a row's own values are worth its own tier
 * ═══════════════════════════════════════════════════════════════════════ */
describe('absorber tier floor · a lower-tier loser cannot overwrite the canonical', () => {
  it('an unstamped field is worth the canonical row\'s own source tier', () => {
    // The bug: provenance only records fields that ARRIVED from elsewhere, so
    // a field the row wrote itself is unstamped and read as tier 0 — which
    // every source outranks. 66 of David's rows carry the damage.
    const watchCanonical = { source: 'watch', distanceMi: 6.01 };
    expect(existingTierFor(watchCanonical, {}, 'distanceMi')).toBe(SOURCE_TIER.watch);
    expect(existingTierFor(watchCanonical, {}, 'distanceMi'))
      .toBeGreaterThan(SOURCE_TIER.apple_watch);
    expect(existingTierFor(watchCanonical, {}, 'distanceMi'))
      .toBeGreaterThan(SOURCE_TIER.strava);
  });

  it('an absorbed stamp can raise the floor, never lower it', () => {
    const hkCanonical = { source: 'apple_watch' };
    // A tier-5 watch value that landed here earlier keeps its tier-5 standing.
    expect(existingTierFor(hkCanonical, { splits: 'watch' }, 'splits'))
      .toBe(SOURCE_TIER.watch);
    // A tier-1 Strava stamp does NOT drag the row below its own tier.
    expect(existingTierFor(hkCanonical, { distanceMi: 'strava' }, 'distanceMi'))
      .toBe(SOURCE_TIER.apple_watch);
  });

  it('an unknown source still floors at 0 · no accidental promotion', () => {
    expect(existingTierFor({ source: 'something_new' }, {}, 'distanceMi')).toBe(0);
    expect(existingTierFor({}, {}, 'distanceMi')).toBe(0);
  });

  it('the Faff phone treadmill tracker ranks with the app\'s own recordings', () => {
    // It was absent from the ladder entirely, so an incline-derived elevation
    // and an `indoor` flag would have lost canonical selection to any HK twin.
    expect(SOURCE_TIER.treadmill).toBe(SOURCE_TIER.watch);
  });
});

describe('identity fields are fill-only · absorption never moves a run in time', () => {
  it('covers every field dedup reads to place the run', () => {
    for (const k of ['date', 'startLocal', 'startUtc', 'timezone']) {
      expect(IDENTITY_FILL_ONLY.has(k)).toBe(true);
    }
  });

  it('does not cover measurements · those still follow the tier ladder', () => {
    for (const k of ['distanceMi', 'splits', 'avgHr', 'elevGainFt']) {
      expect(IDENTITY_FILL_ONLY.has(k)).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2b · the shoe follows the run, not the row
 *
 * The shoe lives on a COLUMN, so the absorber's `data` walk never saw it: a
 * hand-picked shoe stayed on whichever row was canonical when the runner
 * picked it, and a later merge that promoted a different row made the pick
 * invisible — lib/shoe/mileage.ts sums canonical rows only. 16 of David's
 * runs, 123.5 mi, every one of them a manual pick.
 *
 * The move is one guarded statement, so this pins the three properties that
 * make it safe rather than re-running Postgres.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('absorbed shoe · the guards that keep the move safe', () => {
  const src = readFileSync(new URL('./canonical.ts', import.meta.url), 'utf8');
  const stmt = /UPDATE runs c\b[\s\S]*?RETURNING c\.shoe_id/.exec(src)?.[0] ?? '';

  it('the absorber moves the shoe at all', () => {
    expect(stmt).not.toBe('');
  });

  it('never clobbers a shoe the canonical already has', () => {
    expect(stmt).toMatch(/c\.shoe_id IS NULL/);
  });

  it('only moves a shoe that exists', () => {
    expect(stmt).toMatch(/l\.shoe_id IS NOT NULL/);
  });

  it('carries shoe_auto_assigned_at across · a manual pick stays manual', () => {
    // That NULL stamp is the marker the day-level shoe route checks before it
    // overrides. Dropping it would silently demote a hand pick to an auto one.
    expect(stmt).toMatch(/shoe_auto_assigned_at\s*=\s*l\.shoe_auto_assigned_at/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · dedup across zones · the 2026-08-01 duplicate
 * ═══════════════════════════════════════════════════════════════════════ */
describe('cross-zone dedup · an absolute instant beats a guessed one', () => {
  // The real pair, from production. Same run: 612 s, 1.34 mi. Strava assigned
  // the activity a UTC-9 zone from its GPS (a run logged at sea); the phone
  // stamped the wall clock in the runner's UTC-7 profile zone. Both describe
  // 22:43:53 UTC. Two hours apart on paper, so they never merged and the day
  // counted the run twice.
  const stravaRow = (extra: Record<string, unknown> = {}): RunRow => ({
    id: '19562826050',
    user_uuid: 'u1',
    data: {
      source: 'strava',
      date: '2026-08-01',
      startLocal: '2026-08-01T13:43:53Z',
      distanceMi: 1.3373,
      movingTimeS: 612,
      ...extra,
    },
  });
  const watchRow = (extra: Record<string, unknown> = {}): RunRow => ({
    id: '-2702777794856273',
    user_uuid: 'u1',
    data: {
      source: 'apple_watch',
      date: '2026-08-01',
      startLocal: '2026-08-01T15:43:53',
      distanceMi: 1.34,
      durationSec: 612,
      ...extra,
    },
  });

  it('reproduces the miss · neither row carries an instant', () => {
    expect(isSameRun(stravaRow(), watchRow(), TZ)).toBe(false);
  });

  it('both rows carrying startUtc · they match', () => {
    const a = stravaRow({ startUtc: '2026-08-01T22:43:53Z' });
    const b = watchRow({ startUtc: '2026-08-01T22:43:53Z' });
    expect(isSameRun(a, b, TZ)).toBe(true);
    expect(clusterRuns([a, b], TZ)).toHaveLength(1);
  });

  it('one row carrying startUtc still resolves it · the wall clock agrees', () => {
    // The phone shipped the instant; Strava's fake-Z gets its usual strip and
    // lands 13:43 PT = 20:43 UTC, two hours before the phone's 22:43 UTC. The
    // spans do not overlap, so this pair legitimately stays split until the
    // other side is re-synced. Asserted so the partial-rollout behaviour is
    // stated rather than assumed.
    const a = stravaRow();
    const b = watchRow({ startUtc: '2026-08-01T22:43:53Z' });
    expect(isSameRun(a, b, TZ)).toBe(false);
  });

  it('startUtc makes a bare-wall-clock row trustworthy', () => {
    expect(isTrustworthy(watchRow())).toBe(true);   // apple_watch is provider-canonical
    const bare: RunRow = { id: 'x', user_uuid: 'u1', data: { source: 'treadmill', startLocal: '2026-08-01T15:43:53' } };
    expect(isTrustworthy(bare)).toBe(false);
    expect(isTrustworthy({ ...bare, data: { ...bare.data, startUtc: '2026-08-01T22:43:53Z' } })).toBe(true);
  });

  it('a garbage startUtc falls back rather than poisoning the comparison', () => {
    const a = stravaRow({ startUtc: 'not-a-date' });
    const b = stravaRow({ startUtc: 'not-a-date', id: 'other' });
    // Falls through to the wall-clock path and still clusters the pair.
    expect(isSameRun(a, b, TZ)).toBe(true);
  });

  it('two genuinely different runs on one day still stay apart', () => {
    const morning = watchRow({ startUtc: '2026-08-01T15:00:00Z' });
    const evening = watchRow({ id: 'y', startUtc: '2026-08-02T01:00:00Z', date: '2026-08-01' });
    expect(isSameRun(morning, evening, TZ)).toBe(false);
    expect(clusterRuns([morning, evening], TZ)).toHaveLength(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · no behaviour change for rows that predate the fix
 * ═══════════════════════════════════════════════════════════════════════ */
describe('rows written before the fix compare exactly as they did', () => {
  // David's 2026-05-20, verbatim from production. Three rows, one run.
  const hkRow: RunRow = { id: '-3363396946462586', user_uuid: 'u1', data: { source: 'apple_watch', date: '2026-05-20', startLocal: '2026-05-20T16:53:53', distanceMi: 5.08, durationSec: 2685 } };
  const healthRow: RunRow = { id: '-1346634309', user_uuid: 'u1', data: { source: 'apple_health', date: '2026-05-20', startLocal: '2026-05-20T23:53:53Z', distanceMi: 5.08, durationSec: 2685 } };
  // The legacy importer wrote the LOCAL wall clock with a `Z` on it. The `Z`
  // makes it trustworthy, so it is taken at face value as UTC and lands seven
  // hours from its own twin. This is the shape behind all eight of the days
  // whose stored flags the engine now disagrees with.
  const fakeZRow: RunRow = { id: '18589376553', user_uuid: 'u1', data: { date: '2026-05-20', startLocal: '2026-05-20T16:53:53Z', distanceMi: 5.08, durationSec: 2684 } };

  it('a bare wall clock and a true-UTC twin still cluster · unchanged', () => {
    expect(isSameRun(hkRow, healthRow, TZ)).toBe(true);
    expect(hkRow.data.startUtc).toBeUndefined();
  });

  it('the fake-Z legacy row still fails to cluster · unchanged, and reported', () => {
    // Not asserting this is CORRECT — it is the defect. Asserting only that
    // adding `startUtc` support moved nothing for rows that lack the key, so
    // the repair is a data question, not a silent behaviour change.
    expect(isSameRun(hkRow, fakeZRow, TZ)).toBe(false);
    expect(isTrustworthy(fakeZRow)).toBe(true);
    expect(clusterRuns([hkRow, healthRow, fakeZRow], TZ)).toHaveLength(2);
  });

  it('stamping the instant on all three collapses the day to one run', () => {
    const utc = '2026-05-20T23:53:53Z';
    const fixed = [hkRow, healthRow, fakeZRow].map((r) => ({ ...r, data: { ...r.data, startUtc: utc } }));
    expect(clusterRuns(fixed, TZ)).toHaveLength(1);
  });
});
