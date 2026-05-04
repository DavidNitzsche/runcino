/**
 * Shared date / time helpers. Used by every page that needs a real
 * "today" — Overview greeting, race countdowns, this-week range,
 * past/upcoming filters.
 *
 * Single source of truth for "what is today?" so the entire app moves
 * through time together. Tests pin to a fixed date by stubbing now().
 */

export function now(): Date {
  return new Date();
}

export function todayISO(): string {
  return now().toISOString().slice(0, 10);
}

export function greeting(d: Date = now()): 'Good morning' | 'Good afternoon' | 'Good evening' {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Days from today (00:00 local) to the race date (12:00 UTC).
 *  Negative if past, 0 if today, positive if future. */
export function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(target.getTime())) return NaN;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
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

/** Returns Mon-of-current-week + Sun-of-current-week as ISO strings. */
export function thisWeekRange(d: Date = now()): { start: string; end: string } {
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offsetToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + offsetToMon);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
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
