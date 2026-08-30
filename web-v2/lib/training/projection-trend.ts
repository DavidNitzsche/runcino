/**
 * lib/training/projection-trend.ts · the Races card's projected-finish trend,
 * composed in one pure place.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS FOR (2026-08-30)
 *
 * The card drew a headline, a row of bars underneath it, and footnotes. On
 * the owner's phone the headline read 3:22:17 and the bars sat at 3:31:48,
 * because they were TWO DIFFERENT QUANTITIES:
 *
 *   headline · `computeGoalProjection(...).trajectory.projectedSec` — the
 *              forward-looking, execution-scaled projection to race day.
 *              Moves day to day as the runner trains and the runway shortens.
 *   bars     · `loadProjectionSeries(...)` off `projection_snapshots` — the
 *              raw current-fitness equivalence, `predictRaceTime(vdot, d)`.
 *              Moves ONLY when a race or time trial re-anchors VDOT.
 *
 * Against prod, that second series held 13 rows and exactly ONE distinct
 * value for the owner's marathon distance. Thirteen identical rectangles,
 * captioned as a trend, nine minutes away from the number above them.
 *
 * So this module does two things and both are the point:
 *
 *   1 · The plotted series and the headline are the SAME quantity. The
 *       series is `goal_projection_snapshots` (the daily trajectory read),
 *       and today's LIVE headline value is appended as the final point, so
 *       the highlighted bar is by construction the number printed above it.
 *
 *   2 · A CONSTANT IS NEVER DRAWN AS A CHART. Below the guard the bars are
 *       withheld and the card says the honest thing in words instead.
 *
 * Pure and synchronous on purpose: every rule above is exercised by
 * `_projection_trend.test.ts` with no database in the room.
 */

/**
 * The move that counts as a move · 30 seconds.
 *
 * Not a new number. It is the threshold David set on 2026-08-26 for the
 * projection-change push ("tell me when Projected moves"), and
 * `lib/notifications/projection-changed.ts` imports it from here so the app
 * cannot hold two opinions about what "it moved" means. A series whose whole
 * window spans less than one push-worthy move has not moved, and drawing it
 * as a chart claims otherwise.
 */
export const MEANINGFUL_MOVE_SEC = 30;

/**
 * Two reads is the floor for a chart, because one bar is not a trend and the
 * delta below the guard needs a from and a to. This is the N the brief asked
 * to be picked and justified: the guard is `reads >= 2 AND spread >= 30s`,
 * i.e. at least two MEANINGFULLY distinct values in the window. Two identical
 * reads fail on the spread; two reads 31 seconds apart pass on both.
 */
export const MIN_CHARTED_READS = 2;

/** How far back the trend window looks. Matches loadProjectionSeries. */
export const TREND_WINDOW_DAYS = 90;

export interface ProjectionRead {
  /** ISO date, runner's calendar. */
  date: string;
  projectedSec: number | null;
}

export type TrendDirection = 'faster' | 'slower' | 'flat';

export interface ProjectionTrendDelta {
  /** Signed, seconds. Negative is faster: a finish time going down is good. */
  deltaSec: number;
  direction: TrendDirection;
  fromDate: string;
  toDate: string;
  /** Calendar days actually covered, first read to last. Never a round label. */
  spanDays: number;
  /** Runner-facing sentence. Always names the REAL window, never "a month". */
  text: string;
}

export interface ProjectionTrendOut {
  /**
   * What the bar row draws. EMPTY when the flat-series guard fires — the
   * phone renders no bars at all rather than a flat row, which is the durable
   * half of this fix.
   */
  values: number[];
  /** Whether a bar row is warranted. `values` is empty whenever this is false. */
  charted: boolean;
  /** Every read in the window, guard or no guard. What the footnotes count. */
  reads: number;
  /** max − min across the window, seconds. 0 for a constant. */
  spreadSec: number;
  delta: ProjectionTrendDelta | null;
  footnotes: string[];
}

/**
 * `"45s"` · `"7m 15s"` · `"1h 2m"`. A gap between two finish times, written
 * the way a runner says it out loud.
 *
 * Rounds ONCE, at the top, then divides — the split-rounding shape
 * `lib/format/_format_lint.test.ts` exists to stop (floor the minutes, round
 * the seconds, print "6:60") cannot occur here.
 */
export function fmtGapWords(sec: number): string | null {
  if (!Number.isFinite(sec)) return null;
  const t = Math.round(Math.abs(sec));
  if (t < 60) return `${t}s`;
  if (t < 3600) {
    const m = Math.floor(t / 60);
    const s = t % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(t / 3600);
  const m = Math.round((t % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Whole days between two ISO dates. Both ends are runner-calendar day keys. */
function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T12:00:00Z`);
  const b = Date.parse(`${toISO}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function dayWords(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

/**
 * The delta the owner asked for, over the window the data actually covers.
 *
 * David called out a competitor's card reading "7m 15s over the past month"
 * as the good version of this. The magnitude and the direction are the good
 * part; "the past month" is the part that must not be copied, because it is a
 * fixed label over a variable window. This names the real span every time —
 * "over 12 days" when there are twelve days of reads.
 *
 * Null below two reads: there is nothing to difference.
 */
export function computeProjectionDelta(reads: ProjectionRead[]): ProjectionTrendDelta | null {
  const usable = reads.filter((r): r is ProjectionRead & { projectedSec: number } =>
    r.projectedSec != null && Number.isFinite(r.projectedSec));
  if (usable.length < 2) return null;

  const first = usable[0];
  const last = usable[usable.length - 1];
  const deltaSec = last.projectedSec - first.projectedSec;
  const spanDays = daysBetween(first.date, last.date);
  const span = dayWords(spanDays);

  // The same 30s bar the chart guard uses. A 4-second drift over three weeks
  // is not "faster", and calling it that is the sentence version of drawing a
  // constant as a chart.
  const direction: TrendDirection =
    deltaSec <= -MEANINGFUL_MOVE_SEC ? 'faster'
    : deltaSec >= MEANINGFUL_MOVE_SEC ? 'slower'
    : 'flat';

  const magnitude = fmtGapWords(deltaSec);
  const text =
    direction === 'flat' || magnitude == null
      ? `Unchanged over ${span}`
      : direction === 'faster'
        ? `Faster by ${magnitude} over ${span}`
        : `Slower by ${magnitude} over ${span}`;

  return { deltaSec, direction, fromDate: first.date, toDate: last.date, spanDays, text };
}

export interface ComposeProjectionTrendInput {
  /** Stored daily reads, oldest first, of the SAME quantity as the headline. */
  series: ProjectionRead[];
  /**
   * The headline's live value, right now. Appended as the final read so the
   * highlighted bar IS the number printed above it. A stored read already
   * carrying `todayISO` is replaced, never duplicated.
   */
  todayProjectedSec: number | null;
  todayISO: string;
  /** The VDOT anchor's age in days, for the second footnote. Null when none. */
  anchorAgeDays: number | null;
}

/**
 * Compose the whole trend block: the bars (or deliberately none), the delta,
 * and the footnotes that match whichever of those two the card got.
 */
export function composeProjectionTrend(input: ComposeProjectionTrendInput): ProjectionTrendOut {
  const { series, todayProjectedSec, todayISO, anchorAgeDays } = input;

  const merged: ProjectionRead[] = series
    .filter((r) => r.date !== todayISO)
    .map((r) => ({ date: r.date, projectedSec: r.projectedSec }));
  if (todayProjectedSec != null && Number.isFinite(todayProjectedSec)) {
    merged.push({ date: todayISO, projectedSec: todayProjectedSec });
  }
  merged.sort((a, b) => a.date.localeCompare(b.date));

  const usable = merged.filter((r): r is ProjectionRead & { projectedSec: number } =>
    r.projectedSec != null && Number.isFinite(r.projectedSec));
  const values = usable.map((r) => r.projectedSec);
  const reads = values.length;
  const spreadSec = reads > 0 ? Math.max(...values) - Math.min(...values) : 0;

  // ── THE GUARD ────────────────────────────────────────────────────────────
  //
  // Fewer than two reads, or a window that never moved a push-worthy 30
  // seconds, and there is no chart here to draw. Thirteen equal rectangles
  // are not a picture of a trend; they are a picture of a number, drawn
  // thirteen times, and the number is already printed above them.
  const charted = reads >= MIN_CHARTED_READS && spreadSec >= MEANINGFUL_MOVE_SEC;

  const delta = computeProjectionDelta(merged);

  const anchorFact = anchorAgeDays != null
    ? `Anchored ${anchorAgeDays}d ago`
    : 'No fitness anchor yet · a race or a hard time trial would set one.';

  // Two footnotes, always, both short: the row is an HStack on the phone and
  // a paragraph in it reads as a wall. Between the headline, the delta and
  // these two, the card says the number, how far it has moved over what
  // window, what would move it, and what anchors it.
  let lead: string;
  if (reads === 0) {
    lead = 'No projection on file yet';
  } else if (reads === 1) {
    // The honest cold start. The trajectory series begins the day it begins;
    // nothing here invents the days before it.
    lead = 'First read on file. A trend needs a few more days.';
  } else if (!charted) {
    // What replaces the flat bar row. The delta above already says
    // "Unchanged over N days", so this does not repeat it — it says what
    // WOULD move the number, which is the part a runner can act on.
    lead = 'Hitting the plan moves this. So does a race or time trial.';
  } else {
    lead = `${reads} days of daily reads`;
  }

  return {
    values: charted ? values : [],
    charted,
    reads,
    spreadSec,
    delta,
    footnotes: [lead, anchorFact],
  };
}
