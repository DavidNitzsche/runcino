/**
 * lib/coach/intent-value.ts · `coach_intents.value` is TEXT, not jsonb.
 *
 * `writeIntent` (lib/plan/adapt.ts) stores `JSON.stringify(value)` into a plain
 * `text` column. Two shipped readers forgot that and reached for the jsonb
 * operator anyway:
 *
 *   · `lib/notifications/session-moved.ts` · `ci.value->>'why'` — the sentence
 *     the session-moved push puts on the lock screen. Threw on every call, the
 *     catch returned null, and the push shipped with no reason on it. The whys
 *     are real: prod holds "Long run on 2026-08-22 was missed. Recorded for the
 *     volume picture; long runs are never crammed back in."
 *   · `lib/training/goal-projection.ts` · `ci.value->>'source_trigger'` — added
 *     on 2026-08-17 to stop counting a volume-overshoot shave as evidence the
 *     runner is not absorbing the plan. The filter threw, so instead of
 *     excluding one trigger it excluded the whole signal: `detectPlanAdapterDrift`
 *     has returned null ever since.
 *
 * Both errors were `operator does not exist: text ->> unknown`, and both were
 * caught into a value that reads as an honest nothing.
 *
 * WHY NOT JUST CAST IN SQL. Because `value::jsonb` fails harder. 169 of the 269
 * rows in production are not JSON-shaped — older writers stored bare sentences —
 * so a blanket cast trades `text ->> unknown` for `invalid input syntax for
 * type json` on the majority of the table, and lands in the same catch.
 *
 * So the parse happens here, per row, and a row that is not JSON is not an
 * error: it is a row from an older writer, and it has no fields.
 */

/** The parsed object for one `coach_intents.value`, or null when it is not one. */
export function parseIntentValue(value: string | null | undefined): Record<string, unknown> | null {
  if (value == null) return null;
  const s = value.trim();
  // Cheap shape check first — most non-JSON rows are bare sentences, and
  // JSON.parse on those is a thrown exception per row in a hot loop.
  if (!s.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(s);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // A malformed row is a fact about that row, not a failure of the read.
    return null;
  }
}

/**
 * One string field out of `coach_intents.value`, or null.
 *
 * This is the `value->>'field'` the SQL could not do. Non-string values return
 * null rather than being stringified — `->>` would have rendered them, but no
 * caller here wants `[object Object]` on a lock screen.
 */
export function intentValueField(
  value: string | null | undefined,
  field: string,
): string | null {
  const obj = parseIntentValue(value);
  if (!obj) return null;
  const v = obj[field];
  return typeof v === 'string' ? v : null;
}
