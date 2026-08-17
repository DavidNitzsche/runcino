/**
 * lib/runtime/day-key.ts · pure helpers for deriving a calendar day key.
 *
 * The bug class: `someDate.toISOString().slice(0, 10)`. It answers "what
 * was the UTC date at that instant", and it is used all over this app to
 * mean "what day is this on the calendar". Those are different questions
 * whenever the Date is not a UTC instant, or the calendar is not UTC's.
 *
 * Three distinct shapes, three helpers — because the right fix depends
 * on what the Date actually holds:
 *
 *   1. A Date built from LOCAL calendar parts — `new Date(y, m, d)`, or
 *      `setHours(0,0,0,0)`. This is local midnight, and its UTC instant
 *      is midnight MINUS the zone's offset. For every zone EAST of UTC
 *      that lands on the PREVIOUS calendar day, so `toISOString()` keys
 *      the whole grid one day early: Berlin (+2) turns midnight on the
 *      17th into 22:00Z on the 16th. West-of-UTC zones happen to survive
 *      (00:00 PDT is 07:00Z, same date) — which is exactly why this
 *      never showed up for a Pacific-based runner and shipped anyway.
 *      Month-grid cells and week-bar labels are built this way, in the
 *      BROWSER, so the runner's own zone decides whether their calendar
 *      is off by one.
 *      → dayKeyFromLocalParts()
 *
 *   2. A pg `date` column. node-pg parses OID 1082 into a JS Date at
 *      LOCAL midnight (lib/db/pool.ts sets no type parser), so the same
 *      east-of-UTC shift applies. Prod runs UTC and is safe today; any
 *      non-UTC deploy east of Greenwich would read every health and
 *      readiness series a day early.
 *      → pgDayKey()
 *
 *   3. A genuine instant, where the question is "which day was this for
 *      the runner". Needs the runner's IANA zone; there is no correct
 *      answer without one.
 *      → dayKeyInTz(), and lib/runtime/runner-tz.ts runnerToday() for
 *        the async "today for this user" case.
 *
 * Anything that is genuinely a UTC instant serialised whole (ingestedAt,
 * generated_at, TCX <Time>) should keep using toISOString(). This module
 * is only for day keys.
 *
 * Pure and synchronous — no DB, no env, no clock reads except where a
 * Date is passed in.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Day key from a Date that carries LOCAL calendar parts.
 *
 * Use for `new Date(y, m, d)`, `setHours(0,0,0,0)` dates, and node-pg
 * `date` columns — anything whose midnight is local midnight. Reads the
 * local getters, which is exactly how the value was constructed, so the
 * round trip is lossless.
 */
export function dayKeyFromLocalParts(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Day key from a pg `date` / `timestamp` column value.
 *
 * Accepts what node-pg can hand back: a Date (local midnight for OID
 * 1082), an already-sliced string, or null. Strings are trusted and
 * sliced — a `YYYY-MM-DD` from the database is already the calendar day
 * and must not be round-tripped through a Date.
 */
export function pgDayKey(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s.length >= 10 ? s.slice(0, 10) : null;
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : dayKeyFromLocalParts(v);
  }
  return null;
}

/**
 * Day key for an instant, in a named IANA timezone.
 *
 * `en-CA` formats as YYYY-MM-DD, which is why it is the repo's idiom.
 * An unknown/invalid zone throws inside Intl, so fall back to UTC rather
 * than let a bad profile value take a request down.
 */
export function dayKeyInTz(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/**
 * Shift a `YYYY-MM-DD` key by whole days.
 *
 * Noon-anchored UTC arithmetic — the established idiom in this repo
 * (lib/plan/adapt.ts, lib/runs/volume.ts, lib/coach/week-window.ts).
 * Anchoring at noon means no DST transition, and no rounding at either
 * midnight boundary, can push the result onto the wrong day.
 */
export function addDaysToDayKey(dayKey: string, days: number): string {
  const ms = Date.parse(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(ms)) return dayKey;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. Negative when b < a. */
export function daysBetweenDayKeys(a: string, b: string): number {
  const ma = Date.parse(`${a}T12:00:00Z`);
  const mb = Date.parse(`${b}T12:00:00Z`);
  if (Number.isNaN(ma) || Number.isNaN(mb)) return 0;
  return Math.round((mb - ma) / 86_400_000);
}
