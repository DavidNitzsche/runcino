/**
 * lib/training/_race_projection.test.ts — ONE race, ONE projected time.
 *
 * THE TEST THAT WOULD HAVE CAUGHT IT. On the owner's account, 2026-08-30, CIM
 * 2026-12-06, goal 3:00:00, VDOT 44.1 anchored to the AFC half:
 *
 *   Races list   Projected 3:22:17 · Gap +22:17
 *   CIM detail   Projected 3:31:48 · Gap +31:48
 *
 * Same race, same goal, same label, one tap apart, 9m31s of daylight between
 * them. The list resolved through `computeGoalProjection().trajectory`; the
 * detail called `predictRaceTime(vdot, distanceMi)` and had never heard of the
 * trajectory.
 *
 * Neither number was wrong in isolation — they are two real, legitimately
 * different quantities (race-day projection vs today's fitness equivalence).
 * The defect is that both were published under the word "Projected". So the
 * assertions below come in two halves, and the second half is the one that
 * actually holds the line:
 *
 *   1 · the resolver's precedence behaves.
 *   2 · NEITHER ROUTE RESOLVES A PROJECTION ANY OTHER WAY. A behavioural test
 *       of a shared function cannot catch a route that stops calling it, and
 *       that is precisely the failure mode here — the detail route did not
 *       call the wrong function, it called a different one entirely. So the
 *       route sources are read and asserted against directly.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRaceProjection, projectionCoachLine } from './race-projection';

const ROOT = path.resolve(__dirname, '..', '..');
const LIST_ROUTE = path.join(ROOT, 'app/api/v5/races/route.ts');
const DETAIL_ROUTE = path.join(ROOT, 'app/api/v5/race/[slug]/route.ts');

// The owner's real numbers, 2026-08-30. Not a fixture — these are what the two
// screens actually printed, and what the engine actually computed.
const GOAL_SEC = 3 * 3600;                     // 3:00:00
const TRAJECTORY_SEC = 12137;                  // 3:22:17 · execution-scaled to race day
const ADJUSTED_EQUIVALENCE_SEC = 13343;        // 3:42:23 · today + Research/02 §13.1 +5%
const RAW_EQUIVALENCE_SEC = 12708;             // 3:31:48 · today, raw predictRaceTime
const CIM_VDOT = 44.1;
const CIM_MI = 26.22;

describe('resolveRaceProjection · precedence', () => {
  it('prefers the race-day trajectory over every equivalence', () => {
    const out = resolveRaceProjection({
      goalProjection: {
        trajectory: { projectedSec: TRAJECTORY_SEC },
        vdotProjectionSec: ADJUSTED_EQUIVALENCE_SEC,
      },
      vdot: CIM_VDOT,
      distanceMi: CIM_MI,
    });
    expect(out.projectedSec).toBe(TRAJECTORY_SEC);
    expect(out.basis).toBe('trajectory');
  });

  it('falls back to the adjusted equivalence when there is no trajectory', () => {
    const out = resolveRaceProjection({
      goalProjection: { trajectory: null, vdotProjectionSec: ADJUSTED_EQUIVALENCE_SEC },
      vdot: CIM_VDOT,
      distanceMi: CIM_MI,
    });
    expect(out.projectedSec).toBe(ADJUSTED_EQUIVALENCE_SEC);
    expect(out.basis).toBe('equivalence');
  });

  it('falls back to the raw equivalence only when the projection failed entirely', () => {
    const out = resolveRaceProjection({ goalProjection: null, vdot: CIM_VDOT, distanceMi: CIM_MI });
    expect(out.basis).toBe('equivalence');
    // The value the detail screen used to print, now reachable only as a last
    // resort rather than as a peer of the trajectory.
    expect(out.projectedSec).toBe(RAW_EQUIVALENCE_SEC);
  });

  it('refuses rather than guessing when there is no fitness read at all', () => {
    const out = resolveRaceProjection({ goalProjection: null, vdot: null, distanceMi: CIM_MI });
    expect(out.projectedSec).toBeNull();
    expect(out.basis).toBeNull();
  });
});

describe('the two surfaces agree', () => {
  /** Exactly what each route now does with the resolver's answer. */
  const project = () => resolveRaceProjection({
    goalProjection: {
      trajectory: { projectedSec: TRAJECTORY_SEC },
      vdotProjectionSec: ADJUSTED_EQUIVALENCE_SEC,
    },
    vdot: CIM_VDOT,
    distanceMi: CIM_MI,
  });

  it('produces one number and one gap for one race', () => {
    const list = project();
    const detail = project();
    expect(detail.projectedSec).toBe(list.projectedSec);
    expect(detail.projectedSec! - GOAL_SEC).toBe(list.projectedSec! - GOAL_SEC);
    // The regression, stated as the number it was: the detail screen must not
    // land back on today's equivalence while the list shows the trajectory.
    expect(detail.projectedSec).not.toBe(RAW_EQUIVALENCE_SEC);
    expect(list.projectedSec! - GOAL_SEC).toBe(1337); // +22:17, both screens
  });

  it('neither route resolves a projection any other way', () => {
    for (const file of [LIST_ROUTE, DETAIL_ROUTE]) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src, `${file} must import the shared resolver`)
        .toMatch(/import\s*\{[^}]*resolveRaceProjection[^}]*\}\s*from\s*'@\/lib\/training\/race-projection'/);
      // `predictRaceTime` may still be NAMED in prose explaining the bug; it
      // may not be CALLED. A call is the defect returning.
      const calls = src
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
        .filter((l) => /\bpredictRaceTime\s*\(/.test(l));
      expect(calls, `${file} calls predictRaceTime directly: ${calls.join(' | ')}`).toHaveLength(0);
    }
  });
});

describe('projectionCoachLine · the prose names the basis it actually has', () => {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  it('does not say "Today\'s fitness" over a race-day projection', () => {
    const line = projectionCoachLine({ basis: 'trajectory', gapSec: 1337, formatGap: fmt })!;
    // The exact sentence the detail screen used to print beside its number.
    expect(line).not.toMatch(/Today's fitness/);
    expect(line).toMatch(/This build projects/);
  });

  it('still says "Today\'s fitness" when that is genuinely the basis', () => {
    const line = projectionCoachLine({ basis: 'equivalence', gapSec: 1908, formatGap: fmt })!;
    expect(line).toMatch(/Today's fitness projects/);
  });

  it('says nothing when there is no projection to speak about', () => {
    expect(projectionCoachLine({ basis: null, gapSec: 100, formatGap: fmt })).toBeNull();
    expect(projectionCoachLine({ basis: 'trajectory', gapSec: null, formatGap: fmt })).toBeNull();
  });
});
