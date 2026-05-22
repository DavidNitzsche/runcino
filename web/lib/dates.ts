/**
 * Shared date / time helpers. Used by every page that needs a real
 * "today", Overview greeting, race countdowns, this-week range,
 * past/upcoming filters.
 *
 * Single source of truth for "what is today?" so the entire app moves
 * through time together. Tests pin to a fixed date by stubbing now().
 */

/** App-default reference timezone — the FALLBACK used only when a user
 *  has no device-reported timezone yet (users.timezone is null). The
 *  server runs in UTC; computing "today" naively against UTC flips to
 *  tomorrow at 4–5 PM California time, highlighting the wrong day. Real
 *  users now carry their own IANA tz (auto-detected by the app and
 *  stored on users.timezone); pass it to these helpers so date math
 *  follows wherever they actually are. */
export const FAFF_TZ = 'America/Los_Angeles';

/** Resolve a usable IANA tz, falling back to the app default. Accepts the
 *  AuthUser.timezone shape (string | null | undefined). */
export function resolveTz(tz?: string | null): string {
  return tz && typeof tz === 'string' && tz.length > 0 ? tz : FAFF_TZ;
}

export function now(): Date {
  return new Date();
}

/** Today's date in YYYY-MM-DD, computed in the given timezone (en-CA
 *  locale yields ISO format). Pass the user's tz; omit it only in
 *  contexts with no user (defaults to FAFF_TZ). Never use
 *  `new Date().toISOString().slice(0,10)` (which is UTC). */
export function todayISO(tz?: string | null): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: resolveTz(tz) });
}

/** The YYYY-MM-DD calendar day a given instant falls on, in the given
 *  timezone. Use to date a run/sample from its absolute timestamp so a
 *  6 PM-local run is dated today, not tomorrow (UTC). */
export function dayInTz(instant: string | number | Date, tz?: string | null): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: resolveTz(tz) });
}

/** A Date anchored at noon UTC of the given timezone's calendar today.
 *  Safe to pass through `setDate` / `getDate` arithmetic on any server
 *  timezone — noon UTC is far enough from midnight that ±days never
 *  crosses a UTC date boundary. */
export function todayDate(tz?: string | null): Date {
  return new Date(todayISO(tz) + 'T12:00:00Z');
}

export function greeting(d: Date = now()): 'Good morning' | 'Good afternoon' | 'Good evening' {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Days from today (LA calendar) to the race date.
 *  Negative if past, 0 if today, positive if future. */
export function daysUntil(iso: string): number {
  const target = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(target.getTime())) return NaN;
  return Math.round((target.getTime() - todayDate().getTime()) / 86_400_000);
}

export function isUpcoming(iso: string): boolean {
  return daysUntil(iso) >= 0;
}

export function isPast(iso: string): boolean {
  return daysUntil(iso) < 0;
}

/** "Sunday, May 4, 2026" */
export function formatLong(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "May 4" */
export function formatShort(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Mon May 4" */
export function formatDow(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Returns Mon-of-current-week + Sun-of-current-week as ISO strings.
 *  Computed in LA timezone, the server's UTC clock would otherwise
 *  flip the week boundary in the early hours of LA's Monday. */
export function thisWeekRange(d: Date = todayDate()): { start: string; end: string } {
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat (UTC because d is anchored noon-UTC)
  const offsetToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + offsetToMon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return {
    start: mon.toISOString().slice(0, 10),
    end:   sun.toISOString().slice(0, 10),
  };
}

/** "Mon May 4 – Sun May 10" */
export function formatWeekRange(d: Date = now()): string {
  const { start, end } = thisWeekRange(d);
  const a = new Date(start + 'T12:00:00Z');
  const b = new Date(end + 'T12:00:00Z');
  return `${a.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${b.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}
