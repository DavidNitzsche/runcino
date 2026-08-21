/**
 * lib/runs/merge-safe.ts · the `runs.data` merge contract, in JS.
 *
 * Every ingest path writes `runs.data` with the same upsert:
 *
 *   ON CONFLICT (id) DO UPDATE
 *     SET data = runs.data || jsonb_strip_nulls(EXCLUDED.data)
 *
 * That shape is Rule 6's fix: a key the incoming payload OMITS survives,
 * because `||` only replaces keys the right-hand side actually carries. It is
 * what lets a HealthKit re-sync land on top of splits the absorber pulled in
 * from Strava, a shoe the runner picked by hand, and a `mergedIntoId` the
 * merge engine wrote, without erasing any of them.
 *
 * It has one hole, and the hole is not obvious: **`jsonb_strip_nulls` removes
 * nulls, not empty values.** `[]`, `''` and `{}` all survive the strip and win
 * the merge. A writer that emits `splits: []` when it has no splits is not
 * saying "I have nothing to add" — it is saying "this run has no splits", and
 * the merge believes it.
 *
 * Confirmed in production 2026-08-21: David's 2026-05-24 11.12 mi long run
 * carries `splits: []` on the canonical row while its merged loser still holds
 * all 12 real per-mile splits. Every splits-fed surface is blind for that run.
 *
 * So the contract a writer must honour is narrower than "don't send nulls":
 *
 *   A field the writer does not have is OMITTED, not sent empty.
 *   Clearing a field is a separate, explicit statement (`data - 'key'`).
 *
 * `omitEmpty` is how a payload builder says the first half. `mergePreserve` is
 * the JS mirror of the SQL, so a test can assert writer-A-then-writer-B
 * survival without a database.
 */

/** Values `jsonb_strip_nulls` does NOT remove but that mean "I have nothing". */
function isEmptyish(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v === '';
  return false;
}

/**
 * Spread-ready patch that carries `key` only when `value` is worth writing.
 *
 *   ...omitEmpty('splits', keptSplits)
 *
 * An empty array, an empty string, null and undefined all produce `{}`, so the
 * upsert leaves whatever is already on the row alone.
 */
export function omitEmpty<K extends string, V>(
  key: K,
  value: V,
): Partial<Record<K, V>> {
  return isEmptyish(value) ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * The JS mirror of `existing || jsonb_strip_nulls(incoming)`.
 *
 * Shallow, exactly like Postgres's `||` on two jsonb objects: keys present on
 * the right replace the left wholesale (no deep merge), keys only on the left
 * survive, and nulls on the right are dropped before the merge so they cannot
 * erase anything.
 */
export function mergePreserve(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null || v === undefined) continue;   // jsonb_strip_nulls
    stripped[k] = v;
  }
  return { ...existing, ...stripped };
}
