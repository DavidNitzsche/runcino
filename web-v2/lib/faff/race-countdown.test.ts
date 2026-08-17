/**
 * The countdown must come from the race's date. Never from plan geometry.
 *
 * The live defect this locks: on 2026-08-17 the owner was on day 1 of a
 * 2-week post-race recovery block with California International Marathon on
 * 2026-12-06. Train's header read "7 days to Dec 6". Dec 6 was 111 days
 * away. The 7 came from `(raceIdx - focusIdx) * 7` where `raceIdx` is only
 * `miles.length - 1` — the last week of the ACTIVE plan, not the race.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { daysToRace, weeksToRace } from './race-countdown';

const TODAY = '2026-08-17';
const CIM = '2026-12-06';

/** Drop block and line comments so source guards assert on code alone. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

describe('daysToRace · the live case', () => {
  it('says 111 days from 2026-08-17 to CIM on 2026-12-06', () => {
    expect(daysToRace(CIM, TODAY)).toBe(111);
  });

  it('does not agree with the plan-geometry answer the bug produced', () => {
    // The active plan was 2 weeks long and the runner was in week 0, so
    // `(planWeeks - 1 - nowIdx) * 7` = 7. The whole point is that the two
    // numbers are unrelated.
    const planGeometryAnswer = (2 - 1 - 0) * 7;
    expect(planGeometryAnswer).toBe(7);
    expect(daysToRace(CIM, TODAY)).not.toBe(planGeometryAnswer);
  });

  it('is not a multiple of 7, which every plan-geometry path must be', () => {
    // `weeks * 7` can only ever land on a multiple of 7. A countdown that
    // is not one is proof the value came from real dates. 111 % 7 === 6.
    const days = daysToRace(CIM, TODAY)!;
    expect(days % 7).not.toBe(0);
  });
});

describe('daysToRace · edges', () => {
  it('is 0 on race day', () => {
    expect(daysToRace(CIM, CIM)).toBe(0);
  });

  it('goes negative for a race already run', () => {
    // The half he raced the day before.
    expect(daysToRace('2026-08-16', TODAY)).toBe(-1);
  });

  it('crosses a leap day correctly', () => {
    expect(daysToRace('2028-03-01', '2028-02-28')).toBe(2);
  });

  it('ignores a time component on either side', () => {
    expect(daysToRace('2026-12-06T09:30:00Z', '2026-08-17T23:59:00Z')).toBe(111);
  });

  it('returns null rather than guessing when a date is missing', () => {
    expect(daysToRace(null, TODAY)).toBeNull();
    expect(daysToRace(CIM, null)).toBeNull();
    expect(daysToRace(undefined, undefined)).toBeNull();
    expect(daysToRace('', TODAY)).toBeNull();
    expect(daysToRace('not-a-date', TODAY)).toBeNull();
  });
});

describe('weeksToRace', () => {
  it('floors 111 days to 15 weeks', () => {
    expect(weeksToRace(CIM, TODAY)).toBe(15);
  });

  it('is null on the same terms as daysToRace', () => {
    expect(weeksToRace(null, TODAY)).toBeNull();
  });
});

/**
 * Source guard · the bug survived one earlier fix because that fix handled
 * the dead-plan case and left the live-plan expression in place. This
 * asserts the expression itself is gone, so a partial fix cannot recur.
 */
describe('no plan-geometry countdown survives in TrainView', () => {
  const raw = readFileSync(
    join(__dirname, '../../components/faff-app/views/TrainView.tsx'),
    'utf8',
  );
  // Scan CODE, not prose. The fix comments quote the old expressions on
  // purpose, so that a future reader knows what not to reintroduce; those
  // quotations must not trip the guard that enforces it.
  const src = stripComments(raw);

  it('does not derive days from (raceIdx - focusIdx) * 7', () => {
    // Any `(<something>Idx - <something>Idx) * 7` shape, whitespace-loose.
    expect(src).not.toMatch(/\(\s*\w*[Ii]dx\s*-\s*\w*[Ii]dx\s*\)\s*\*\s*7/);
  });

  it('does not multiply any week count by 7 to get a countdown', () => {
    const weekTimesSeven = /(?:planWeeks|totalWeeks|weeksRemaining|weeks\.length|miles\.length)\s*[-+)\s\w]*\*\s*7/;
    expect(src).not.toMatch(weekTimesSeven);
  });

  it('derives the countdown through the shared race-date helper', () => {
    expect(src).toMatch(/from '@\/lib\/faff\/race-countdown'/);
    expect(src).toMatch(/daysToRace\(\s*goal\?\.date\s*,\s*seed\.todayISO\s*\)/);
  });
});
