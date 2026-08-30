/**
 * _projection_trend.test.ts · the Races card cannot draw a constant, and its
 * headline and its bars cannot be two different numbers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG THESE ARE WRITTEN AGAINST (2026-08-30)
 *
 * The card printed `computeGoalProjection(...).trajectory.projectedSec` as a
 * headline and plotted `loadProjectionSeries(...)` — a DIFFERENT model, the
 * frozen current-fitness equivalence — as the bars underneath it. On the
 * owner's phone that was 3:22:17 over a series sitting at 3:31:48, and the
 * series had 13 rows carrying exactly one distinct value.
 *
 * Two failure modes, so two kinds of test:
 *
 *   · BEHAVIOUR · the guard, the delta, the cold start. Pure, no database.
 *   · SOURCE    · a scan of `app/api/v5/races/route.ts` asserting the bars
 *                 read the same store the headline is computed from. This is
 *                 the one that would actually have caught the shipped bug:
 *                 every behavioural test passed while the two halves of the
 *                 card came from different tables, because nothing in the
 *                 unit layer could see both at once.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  composeProjectionTrend,
  computeProjectionDelta,
  fmtGapWords,
  MEANINGFUL_MOVE_SEC,
  MIN_CHARTED_READS,
  type ProjectionRead,
} from './projection-trend';

const ROOT = path.resolve(__dirname, '..', '..');

/** N daily reads ending on `lastISO`, all carrying `sec`. */
function flatSeries(n: number, sec: number, lastISO = '2026-08-29'): ProjectionRead[] {
  const end = Date.parse(`${lastISO}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(end - (n - 1 - i) * 86400000).toISOString().slice(0, 10),
    projectedSec: sec,
  }));
}

describe('the flat-series guard', () => {
  it('does NOT chart a constant, however many reads there are', () => {
    // The owner's real shape: thirteen rows, one value.
    const out = composeProjectionTrend({
      series: flatSeries(12, 12708),
      todayProjectedSec: 12708,
      todayISO: '2026-08-30',
      anchorAgeDays: 14,
    });
    expect(out.reads).toBe(13);
    expect(out.spreadSec).toBe(0);
    expect(out.charted).toBe(false);
    // The whole point: nothing to draw. A bar row of thirteen equal
    // rectangles is not a chart of a trend, it is a chart of a number.
    expect(out.values).toEqual([]);
  });

  it('says what would move the number instead of drawing the flat row', () => {
    const out = composeProjectionTrend({
      series: flatSeries(12, 12708),
      todayProjectedSec: 12708,
      todayISO: '2026-08-30',
      anchorAgeDays: 14,
    });
    expect(out.footnotes).toHaveLength(2);
    expect(out.footnotes[0]).toMatch(/moves this/i);
    expect(out.footnotes[1]).toBe('Anchored 14d ago');
    // And the delta carries the honest "it did not move", over the REAL span.
    expect(out.delta?.direction).toBe('flat');
    expect(out.delta?.text).toBe('Unchanged over 12 days');
  });

  it('holds the line exactly at the 30s threshold, both sides', () => {
    const under = composeProjectionTrend({
      series: [{ date: '2026-08-01', projectedSec: 12000 }],
      todayProjectedSec: 12000 + MEANINGFUL_MOVE_SEC - 1,
      todayISO: '2026-08-30',
      anchorAgeDays: 3,
    });
    expect(under.spreadSec).toBe(29);
    expect(under.charted).toBe(false);
    expect(under.values).toEqual([]);

    const at = composeProjectionTrend({
      series: [{ date: '2026-08-01', projectedSec: 12000 }],
      todayProjectedSec: 12000 + MEANINGFUL_MOVE_SEC,
      todayISO: '2026-08-30',
      anchorAgeDays: 3,
    });
    expect(at.spreadSec).toBe(30);
    expect(at.charted).toBe(true);
    expect(at.values).toEqual([12000, 12030]);
  });

  it('needs at least MIN_CHARTED_READS reads, so one read is never a chart', () => {
    expect(MIN_CHARTED_READS).toBe(2);
    const out = composeProjectionTrend({
      series: [],
      todayProjectedSec: 12137,
      todayISO: '2026-08-30',
      anchorAgeDays: 14,
    });
    expect(out.reads).toBe(1);
    expect(out.charted).toBe(false);
    expect(out.values).toEqual([]);
    expect(out.delta).toBeNull();
    // The honest cold start, not an invented history.
    expect(out.footnotes[0]).toMatch(/first read/i);
  });

  it('charts a series that genuinely moves', () => {
    const out = composeProjectionTrend({
      series: [
        { date: '2026-08-20', projectedSec: 12300 },
        { date: '2026-08-21', projectedSec: 12250 },
        { date: '2026-08-22', projectedSec: 12100 },
      ],
      todayProjectedSec: 11985,
      todayISO: '2026-08-23',
      anchorAgeDays: 6,
    });
    expect(out.charted).toBe(true);
    expect(out.values).toEqual([12300, 12250, 12100, 11985]);
    expect(out.footnotes[0]).toBe('4 days of daily reads');
  });

  it('a null read is not a bar, and does not fake a spread', () => {
    const out = composeProjectionTrend({
      series: [
        { date: '2026-08-20', projectedSec: null },
        { date: '2026-08-21', projectedSec: 12708 },
      ],
      todayProjectedSec: 12708,
      todayISO: '2026-08-22',
      anchorAgeDays: null,
    });
    expect(out.reads).toBe(2);
    expect(out.spreadSec).toBe(0);
    expect(out.charted).toBe(false);
    expect(out.footnotes[1]).toMatch(/No fitness anchor yet/);
  });
});

describe('the delta', () => {
  it('names the window the data actually covers, never "the past month"', () => {
    const d = computeProjectionDelta([
      { date: '2026-08-18', projectedSec: 12708 },
      { date: '2026-08-30', projectedSec: 12273 },
    ]);
    expect(d).not.toBeNull();
    expect(d!.spanDays).toBe(12);
    expect(d!.direction).toBe('faster');
    expect(d!.deltaSec).toBe(-435);
    expect(d!.text).toBe('Faster by 7m 15s over 12 days');
    // The label is derived, so it can never claim a month it does not have.
    expect(d!.text).not.toMatch(/month/i);
  });

  it('reads a rising finish time as slower, not as progress', () => {
    const d = computeProjectionDelta([
      { date: '2026-08-01', projectedSec: 12000 },
      { date: '2026-08-08', projectedSec: 12180 },
    ]);
    expect(d!.direction).toBe('slower');
    expect(d!.text).toBe('Slower by 3m over 7 days');
  });

  it('calls a sub-threshold drift unchanged rather than "faster"', () => {
    const d = computeProjectionDelta([
      { date: '2026-08-01', projectedSec: 12000 },
      { date: '2026-08-22', projectedSec: 11996 },
    ]);
    expect(d!.direction).toBe('flat');
    expect(d!.text).toBe('Unchanged over 21 days');
  });

  it('is null with nothing to difference', () => {
    expect(computeProjectionDelta([])).toBeNull();
    expect(computeProjectionDelta([{ date: '2026-08-01', projectedSec: 12000 }])).toBeNull();
    expect(computeProjectionDelta([
      { date: '2026-08-01', projectedSec: null },
      { date: '2026-08-02', projectedSec: 12000 },
    ])).toBeNull();
  });

  it('writes a gap the way a runner says it', () => {
    expect(fmtGapWords(45)).toBe('45s');
    expect(fmtGapWords(-45)).toBe('45s');
    expect(fmtGapWords(60)).toBe('1m');
    expect(fmtGapWords(435)).toBe('7m 15s');
    expect(fmtGapWords(3600)).toBe('1h');
    expect(fmtGapWords(3720)).toBe('1h 2m');
  });
});

describe('headline and series are ONE quantity', () => {
  it("appends today's live headline value as the last plotted point", () => {
    const headlineSec = 12137;
    const out = composeProjectionTrend({
      series: [
        { date: '2026-08-27', projectedSec: 12400 },
        { date: '2026-08-28', projectedSec: 12300 },
      ],
      todayProjectedSec: headlineSec,
      todayISO: '2026-08-30',
      anchorAgeDays: 14,
    });
    // The highlighted bar on the phone is the LAST one (`highlight: -1`), and
    // it must be the number printed above it.
    expect(out.values[out.values.length - 1]).toBe(headlineSec);
  });

  it("replaces, never duplicates, a stored read carrying today's date", () => {
    const out = composeProjectionTrend({
      // The cron already wrote today at 00:30; the live read differs because
      // the trajectory moves within the day.
      series: [
        { date: '2026-08-29', projectedSec: 12300 },
        { date: '2026-08-30', projectedSec: 12200 },
      ],
      todayProjectedSec: 12137,
      todayISO: '2026-08-30',
      anchorAgeDays: 14,
    });
    expect(out.reads).toBe(2);
    expect(out.values).toEqual([12300, 12137]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// THE SOURCE GUARD
//
// Everything above passes just as happily when the route plots a different
// table than the one it computes the headline from — which is exactly what
// shipped. These read the route.
// ─────────────────────────────────────────────────────────────────────────
describe('the Races route plots what it prints', () => {
  const routeSrc = fs.readFileSync(
    path.join(ROOT, 'app', 'api', 'v5', 'races', 'route.ts'), 'utf8');

  it('reads the trajectory series, not the current-fitness snapshot table', () => {
    expect(routeSrc).toMatch(/loadGoalProjectionSeries\(/);
    // `loadProjectionSeries` stores predictRaceTime(vdot, d) — the frozen
    // equivalence. It moves only when a race re-anchors VDOT, while the
    // headline moves daily. If it comes back as a CALL in this route, the
    // card is back to plotting one model under another. (The name may still
    // appear in prose explaining why it was removed.)
    expect(routeSrc).not.toMatch(/[^a-zA-Z]loadProjectionSeries\(/);
  });

  it('feeds the bars and the headline from one variable', () => {
    // Both `trend` and `trendHeadline` must derive from `projectedSec`: the
    // headline directly, the bars via composeProjectionTrend's
    // `todayProjectedSec`. Anything else is two quantities again.
    expect(routeSrc).toMatch(/todayProjectedSec:\s*projectedSec/);
    expect(routeSrc).toMatch(/trendHeadline\s*=\s*projectedSec\s*!=\s*null/);
  });

  it('emits the delta the card renders', () => {
    expect(routeSrc).toMatch(/trendDelta\s*=\s*composed\.delta/);
    expect(routeSrc).toMatch(/trendDelta,/);
  });
});

describe('one definition of "it moved"', () => {
  it('the projection push imports the chart threshold rather than redeclaring it', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'lib', 'notifications', 'projection-changed.ts'), 'utf8');
    expect(src).toMatch(/MEANINGFUL_MOVE_SEC.*from '@\/lib\/training\/projection-trend'/);
    expect(src).toMatch(/THRESHOLD_SEC = MEANINGFUL_MOVE_SEC/);
    // Nobody re-types the 30.
    expect(src).not.toMatch(/THRESHOLD_SEC\s*=\s*\d/);
  });
});
