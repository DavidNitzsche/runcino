/**
 * active-energy-batch.ts · REQUESTSTORM-2 (2026-09-05)
 *
 * ONE place that turns an ingest body's `active_energy` samples into the one
 * row per calendar day `health_samples` can physically hold, and — the part
 * that did not exist before — SAYS SO when the body it was handed cannot
 * possibly contain a day's whole total.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, MEASURED
 *
 * `health_samples` carries UNIQUE (user_id, sample_type, sample_date) and the
 * ingest upsert is last-write-wins. The route has always collapsed the
 * phone's per-bucket active-energy samples to one row per date before
 * writing — correct, and it says so in its own comment.
 *
 * It collapses PER REQUEST BODY. The iPhone chunked its samples at 500 and
 * posted them sequentially, so a single day's ~1,470 buckets were split
 * across up to 21 bodies, each of which wrote its own partial sum over the
 * last one. What survived was whatever the final chunk holding that date
 * happened to contribute. Production, the owner's account, 2026-09-05:
 *
 *     54 of 135 stored days below 100 kcal · 37 below 20 kcal
 *     2026-08-23:  11.4 kcal, on a day he ran 11.01 miles
 *     2026-07-14:   2.1 kcal, on a day he ran  8.02 miles
 *     2026-08-17:   0.1 kcal
 *
 * Every one of those rows is internally well-formed, which is exactly why
 * nothing caught it — the same shape as Rule 10's stale-but-perfect HR zone
 * distribution.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE OWNERSHIP CALL (Rule 16 · one quantity, one name)
 *
 * "The day's total active energy" is ONE quantity, and it needs ONE owner.
 * The owner is the CLIENT, because only the client holds all the buckets.
 * As of REQUESTSTORM-2 the iPhone sums them itself
 * (`HealthKitImporter.activeEnergyDailyTotals`) and sends one row per day.
 *
 * The aggregation here stays, because it is still correct for a body that
 * carries a whole day's buckets, and deleting it would silently corrupt an
 * older client. But the server can no longer be the thing that PRETENDS to
 * own a total it was handed a fragment of. So it reports the fragment shape
 * instead of quietly summing it: more than one active_energy sample for one
 * date in one body means the sender is shipping buckets, and a total derived
 * from that body is trustworthy only if no sibling body carries the same
 * date — which this function cannot know and therefore does not claim.
 *
 * Rule 11: three outcomes stay distinguishable. A body with no active_energy
 * at all yields `bucketCount: 0` and no totals. A body with one row per date
 * yields totals and an EMPTY `bucketShapedDates`. A body carrying buckets
 * yields totals AND names the dates, so the caller can warn.
 */

/** The minimum shape this module needs off an ingest sample. */
export interface ActiveEnergySampleLike {
  sample_type?: unknown;
  value?: unknown;
  sample_date?: unknown;
  recorded_at?: unknown;
}

export interface ActiveEnergyBatch {
  /** One entry per calendar date present in this body. */
  totals: Array<{ sample_date: string; value: number }>;
  /**
   * Dates for which THIS BODY carried more than one active_energy sample —
   * i.e. the sender is shipping raw buckets, so this body's total for that
   * date is a fragment unless it happens to be the only body carrying it.
   * Empty is the healthy state and the one a current client produces.
   */
  bucketShapedDates: string[];
  /** How many active_energy samples were read. Zero means none present. */
  bucketCount: number;
}

/**
 * @param samples    every sample in the request body, of any type.
 * @param dayOf      fallback day key for a sample with no `sample_date`.
 *                   Injected rather than imported so this function is pure
 *                   and a test can pin the timezone. Typed loosely on purpose:
 *                   the route's own resolver takes `string | null | undefined`
 *                   and this module never inspects the value, it only passes
 *                   whatever `recorded_at` held straight through.
 */
export function aggregateActiveEnergy(
  samples: readonly ActiveEnergySampleLike[],
  dayOf: (recordedAt: any) => string,
): ActiveEnergyBatch {
  const totalByDate = new Map<string, number>();
  const seenPerDate = new Map<string, number>();
  let bucketCount = 0;

  for (const s of samples) {
    if (s?.sample_type !== 'active_energy') continue;
    if (typeof s.value !== 'number' || !Number.isFinite(s.value) || s.value <= 0) continue;
    const d = typeof s.sample_date === 'string' && s.sample_date
      ? s.sample_date
      : dayOf(s.recorded_at);
    bucketCount++;
    totalByDate.set(d, (totalByDate.get(d) ?? 0) + s.value);
    seenPerDate.set(d, (seenPerDate.get(d) ?? 0) + 1);
  }

  const bucketShapedDates = Array.from(seenPerDate.entries())
    .filter(([, n]) => n > 1)
    .map(([d]) => d)
    .sort();

  const totals = Array.from(totalByDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sample_date, total]) => ({
      sample_date,
      value: Math.round(total * 10) / 10,
    }));

  return { totals, bucketShapedDates, bucketCount };
}
