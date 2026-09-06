/**
 * active-energy-batch.test.ts · REQUESTSTORM-2 (2026-09-05)
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22)
 *
 * Four blind spots, stated so nobody mistakes green here for "the daily
 * active-energy series is correct":
 *
 *   · It never touches the DATABASE. The upsert is still last-write-wins on
 *     UNIQUE (user_id, sample_type, sample_date), and no case here can prove
 *     what actually landed in a row. `bucketShapedDates` is a REPORT that a
 *     body was a fragment, not a repair of one.
 *   · It cannot see ACROSS request bodies, because neither can the function.
 *     That is the whole point of the finding: two bodies each carrying one
 *     row for 2026-08-23 look individually perfect and still overwrite each
 *     other. Only the client can prevent that, and the Swift-side gate
 *     (`ActiveEnergyAggregationTests`) is where that is checked.
 *   · It does not assert the ROUTE calls this. A future edit that inlines
 *     its own aggregation next to the import passes everything below.
 *   · It says nothing about the 54 already-corrupt production days. Those
 *     are historical rows; no code change repairs them.
 *
 * What it CAN fail on: a body's per-date total being wrong, the fragment
 * shape going unreported, and a body with no active energy being confused
 * with one that has some.
 *
 * FALSIFICATION RECORD · verbatim output in the handback. Removing the
 * `seenPerDate` bookkeeping (so `bucketShapedDates` is always `[]`) fails
 * "names every date this body carried as buckets". Changing `+=` to `=` in
 * the total — the exact last-write-wins shape the database has — fails
 * "sums every bucket for a date".
 */
import { describe, it, expect } from 'vitest';
import { aggregateActiveEnergy } from './active-energy-batch';

const dayOf = () => '1970-01-01'; // only reached when sample_date is absent

describe('aggregateActiveEnergy', () => {
  it('sums every bucket for a date rather than keeping the last one', () => {
    const body = Array.from({ length: 500 }, () => ({
      sample_type: 'active_energy',
      value: 2,
      sample_date: '2026-08-23',
      recorded_at: '2026-08-23T19:00:00.000Z',
    }));
    const out = aggregateActiveEnergy(body, dayOf);
    expect(out.totals).toEqual([{ sample_date: '2026-08-23', value: 1000 }]);
  });

  it('names every date this body carried as buckets', () => {
    // The production shape: one chunk of a day's buckets. A total derived
    // from this is a fragment, and the route must be able to say so.
    const out = aggregateActiveEnergy(
      [
        { sample_type: 'active_energy', value: 1, sample_date: '2026-08-23' },
        { sample_type: 'active_energy', value: 1, sample_date: '2026-08-23' },
        { sample_type: 'active_energy', value: 9, sample_date: '2026-08-24' },
        { sample_type: 'active_energy', value: 1, sample_date: '2026-08-24' },
      ],
      dayOf,
    );
    expect(out.bucketShapedDates).toEqual(['2026-08-23', '2026-08-24']);
    expect(out.bucketCount).toBe(4);
  });

  it('reports NO bucket-shaped dates for the shape a current client sends', () => {
    // One pre-summed row per day. This is what the iPhone produces after
    // REQUESTSTORM-2, and it must not trip the warning.
    const out = aggregateActiveEnergy(
      [
        { sample_type: 'active_energy', value: 542.0, sample_date: '2026-09-05' },
        { sample_type: 'active_energy', value: 308.1, sample_date: '2026-09-04' },
        { sample_type: 'resting_hr', value: 44, sample_date: '2026-09-05' },
      ],
      dayOf,
    );
    expect(out.bucketShapedDates).toEqual([]);
    expect(out.bucketCount).toBe(2);
    expect(out.totals).toEqual([
      { sample_date: '2026-09-04', value: 308.1 },
      { sample_date: '2026-09-05', value: 542 },
    ]);
  });

  it('distinguishes a body with no active energy from one that has some (Rule 11)', () => {
    const none = aggregateActiveEnergy(
      [{ sample_type: 'resting_hr', value: 44, sample_date: '2026-09-05' }],
      dayOf,
    );
    expect(none.bucketCount).toBe(0);
    expect(none.totals).toEqual([]);
    expect(none.bucketShapedDates).toEqual([]);

    const some = aggregateActiveEnergy(
      [{ sample_type: 'active_energy', value: 500, sample_date: '2026-09-05' }],
      dayOf,
    );
    expect(some.bucketCount).toBe(1);
    expect(some.totals).toHaveLength(1);
  });

  it('drops non-positive and non-finite values without dropping the day', () => {
    const out = aggregateActiveEnergy(
      [
        { sample_type: 'active_energy', value: 0, sample_date: '2026-09-05' },
        { sample_type: 'active_energy', value: -3, sample_date: '2026-09-05' },
        { sample_type: 'active_energy', value: Number.NaN, sample_date: '2026-09-05' },
        { sample_type: 'active_energy', value: 500, sample_date: '2026-09-05' },
      ],
      dayOf,
    );
    expect(out.totals).toEqual([{ sample_date: '2026-09-05', value: 500 }]);
    expect(out.bucketCount).toBe(1);
    expect(out.bucketShapedDates).toEqual([]);
  });

  it('a day whose only active-energy samples are zero yields no row at all', () => {
    const out = aggregateActiveEnergy(
      [{ sample_type: 'active_energy', value: 0, sample_date: '2026-09-05' }],
      dayOf,
    );
    expect(out.totals).toEqual([]);
  });

  it('falls back to the injected day key only when sample_date is absent', () => {
    const out = aggregateActiveEnergy(
      [{ sample_type: 'active_energy', value: 7, recorded_at: '2026-09-05T19:00:00Z' }],
      () => '2026-09-05',
    );
    expect(out.totals).toEqual([{ sample_date: '2026-09-05', value: 7 }]);
  });

  /**
   * LIVENESS (Rule 18) · every case above that asserts an empty array would
   * also pass against a function that returns nothing at all. This one
   * fails instead.
   */
  it('LIVENESS · the aggregator actually produces totals', () => {
    const out = aggregateActiveEnergy(
      [{ sample_type: 'active_energy', value: 1, sample_date: '2026-09-05' }],
      dayOf,
    );
    expect(out.totals.length).toBeGreaterThan(0);
  });
});
