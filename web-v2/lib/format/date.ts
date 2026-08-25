/**
 * lib/format/date.ts · one place that decides HOW a date is written down.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE SIBLING
 *
 * `lib/format/run.ts` is the single decision point for how a run's NUMBERS are
 * written. This is the same job for its dates, and it exists for the same
 * reason: the answer was being given per-file, and the files disagreed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT WAS THERE BEFORE
 *
 * Two byte-identical copies of a `raceDateWords` helper — one in
 * `app/api/v5/races/route.ts`, one in `app/api/v5/race/[slug]/route.ts` —
 * each carrying its own `DOW`/`MON` arrays, and each writing the date the
 * British way round:
 *
 *     Sunday 6 December 2026
 *
 * David, 2026-08-25, testing on his phone: it should be month, day, year. He
 * is in California and every other date he reads all day is written that way.
 * Two copies meant the schedule list and the race detail could drift apart on
 * the next edit; one copy means they cannot.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY ABBREVIATED, AND WHY THE COMMA IS NOT DECORATION
 *
 *     Sun, Dec 6, 2026
 *
 * The long form ("Sunday, December 6, 2026") is 27 characters and these dates
 * are almost never alone on their line — a schedule row prints
 * "Half Marathon · <date>" at 12pt inside a row that also holds a rank badge,
 * a name and a finish time. Spelled out, that row wrapped to two lines for
 * every race with a distance label. Abbreviated it does not.
 *
 * The comma before the year is the part people drop and it is the part that
 * makes the form readable: "Dec 6 2026" runs two numbers together with nothing
 * between them. US convention puts a comma there and it earns its place.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY NOT `toLocaleDateString`
 *
 * Because it reads the SERVER's locale and time zone, and this string is
 * composed on a Railway box for a phone in California. `Intl` with an explicit
 * `en-US` and `UTC` would work, but the noon-UTC anchor below is what keeps a
 * date-only column from sliding a day in either direction, and doing that part
 * by hand is already most of the work. Arrays are also trivially testable and
 * cannot be moved by a platform ICU upgrade.
 */

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];

export interface DateWordsOptions {
  /** Spell the weekday and month out in full. Default false. */
  long?: boolean;
  /** Drop the weekday entirely — "Dec 6, 2026". Default false. */
  noWeekday?: boolean;
  /** Drop the year — "Sun, Dec 6". Default false. */
  noYear?: boolean;
}

/**
 * A date-only ISO string ("2026-12-06", or a timestamp we take the first ten
 * characters of) as US words.
 *
 * ANCHORED AT NOON UTC, DELIBERATELY. `new Date('2026-12-06')` is midnight
 * UTC, which is the 5th anywhere west of Greenwich, and every one of these
 * columns is a calendar date with no time in it. Noon is the only hour that
 * cannot slide the day in either direction, whatever zone reads it.
 *
 * Returns '' for null/undefined, and the input unchanged when it will not
 * parse — a surface printing a raw column is a visible bug someone reports,
 * where a silent '' is a blank nobody can explain.
 */
export function dateWords(iso: string | null | undefined, opts: DateWordsOptions = {}): string {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return String(iso);

  const dow = (opts.long ? DOW_FULL : DOW_SHORT)[d.getUTCDay()];
  const mon = (opts.long ? MON_FULL : MON_SHORT)[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();

  const monthDay = `${mon} ${day}`;
  const tail = opts.noYear ? monthDay : `${monthDay}, ${year}`;
  return opts.noWeekday ? tail : `${dow}, ${tail}`;
}
