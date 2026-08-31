import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * VIEWED-DAY-1 · the route must resolve the day the SCREEN is on.
 *
 * A behavioural test cannot reach this: `composeToday` opens with auth and
 * eight database reads, so the only cheap guarantee that the route asks the
 * right question is to read the route (Rule 16's own pattern — the projection
 * fix is paired with a test asserting no route computes it directly).
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *   - It cannot tell whether `resolveViewedPlanDay` is CORRECT. That is
 *     `_viewed_day.test.ts`.
 *   - It cannot tell whether the resolved day reaches the panel, the About
 *     card, or the watch. Only rendering can (Rule 13).
 *   - It matches source text, so a refactor that renames the helper while
 *     keeping the behaviour will fail this and need the string updated. That
 *     is the intended ratchet, not a bug.
 *   - It cannot see a SECOND surface making the same mistake; it names one file.
 */

const ROUTE = path.join(__dirname, '..', '..', 'app', 'api', 'v5', 'today', 'route.ts');

function routeSource(): string {
  const src = fs.readFileSync(ROUTE, 'utf8');
  // Liveness (Rule 18 §2). A gate that reports clean because it read nothing
  // is the worst outcome available.
  if (src.length < 10_000) throw new Error(`route.ts read back as ${src.length} bytes — the gate is scanning the wrong file`);
  return src;
}

describe('GET /api/v5/today resolves the VIEWED day, not the runner\'s today', () => {
  it('reads the route (liveness)', () => {
    expect(routeSource().length).toBeGreaterThan(10_000);
  });

  it('does not pick the day\'s prescription off the is_today flag', () => {
    // THE DEFECT, 2026-08-30. `const todayWeekDay = planWeek.days.find((d) => d.is_today)`
    // resolves the runner's REAL today. Viewing Monday 2026-08-31 loads the
    // Mon-Sun week, which does not contain Sunday the 30th, so this matched
    // nothing and the hero rendered REST over a 4.5 mi easy with strides.
    //
    // `is_today` itself is still correct and still used — `backToToday()` on
    // the phone reads it off this payload. It is just not the answer to
    // "which day is this screen about".
    const src = routeSource();
    expect(src).not.toMatch(/const\s+todayWeekDay\s*=\s*planWeek\.days\.find\(\s*\(\s*d\s*\)\s*=>\s*d\.is_today\s*\)/);
  });

  it('resolves the viewed day through the one shared resolver', () => {
    const src = routeSource();
    expect(src).toMatch(/resolveViewedPlanDay\(/);
    expect(src).toMatch(/from '@\/lib\/faff\/viewed-day'/);
  });

  it('still marks is_today against the runner\'s real today, for backToToday', () => {
    // Guards the 230fbac1 fix this change composes with. Reverting to
    // `loadPlanWeek(userId, today)` would make "back to today" no-op again.
    expect(routeSource()).toMatch(/loadPlanWeek\(userId,\s*runnerTodayISO,\s*today\)/);
  });

  it('gates the unplanned/"By feel" copy on the day actually being unresolved', () => {
    // Defect 3 shares defect 1's root cause: a null day fell to
    // purposeType 'unplanned', whose branch is `verdict: 'By feel.'`. The
    // route must carry the distinction to the composer rather than letting
    // absence masquerade as a session type.
    expect(routeSource()).toMatch(/todayPlanUnresolved/);
  });
});
