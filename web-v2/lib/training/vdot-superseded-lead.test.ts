/**
 * Superseded-lead doctrine · `Research/01` §"Testing cadence".
 *
 * A tempo that feels notably easier at target pace is worth "+1 VDOT
 * estimated; field-test within 2 weeks". Two clauses. The engine enforced the
 * first (the AUDIT #8 soft cap bounds training candidates to `bestRaceRaw + 1`)
 * and ignored the second, so a lead could outrank the very test it asked for.
 *
 * The case that exposed it is the first test below: a runner races an A half
 * the day before, and their anchor is a two-month-old 4-mile tempo. Because the
 * cap pins every qualifying training run to exactly `race + 1`, this was not an
 * edge case — once a runner had any qualifying training run, their races could
 * never anchor them again.
 */

import { describe, it, expect } from 'vitest';
import { bestRecentVdot } from './vdot';

type Race = Parameters<typeof bestRecentVdot>[0][number];
type Run = NonNullable<Parameters<typeof bestRecentVdot>[3]>[number];

const TODAY = '2026-08-17';

function race(over: Partial<Race> = {}): Race {
  return {
    slug: 'afc',
    name: 'Americas Finest City',
    date: '2026-08-16',
    priority: 'A',
    distance_mi: 13.1,
    finish_seconds: 6113, // 1:41:53
    ...over,
  } as Race;
}

function tempo(date: string, over: Partial<Run> = {}): Run {
  return {
    id: `run-${date}`,
    date,
    workout_type: 'tempo',
    distance_mi: 4,
    finish_seconds: 1720,
    ...over,
  } as Run;
}

describe('a race supersedes the training leads that preceded it', () => {
  it("the day after an A race, the anchor is the race — not a two-month-old tempo", () => {
    const { best } = bestRecentVdot([race()], TODAY, undefined, [
      tempo('2026-06-23'),
      tempo('2026-07-07'),
      tempo('2026-07-21'),
      tempo('2026-08-09', { workout_type: 'long', distance_mi: 12, finish_seconds: 5310 }),
    ]);
    expect(best?.source).toBe('race');
    expect(best?.age_days).toBe(1);
  });

  it('holds even though the capped leads sit numerically ABOVE the race', () => {
    // This is the whole point: the soft cap pins leads to race + 1, so on raw
    // value they always win. Recency of the field test has to outrank value.
    const { best, considered } = bestRecentVdot([race()], TODAY, undefined, [tempo('2026-06-23')]);
    const lead = considered.find((c) => c.source === 'run');
    expect(lead!.vdot).toBeGreaterThan(best!.vdot);
    expect(best!.source).toBe('race');
  });

  it('keeps the superseded leads visible in `considered`, just ranked below', () => {
    // Demotion, not deletion — the evidence is still auditable.
    const { considered } = bestRecentVdot([race()], TODAY, undefined, [tempo('2026-06-23')]);
    expect(considered).toHaveLength(2);
    expect(considered[0].source).toBe('race');
    expect(considered[1].source).toBe('run');
  });
});

describe('training since the race still leads — that is what a soft lead IS', () => {
  it('a tempo run AFTER the race can outrank it by the permitted +1', () => {
    const { best } = bestRecentVdot([race()], TODAY, undefined, [tempo('2026-08-17')]);
    expect(best?.source).toBe('run');
  });

  it('a run on the same day as the race does not supersede it', () => {
    // Same-day evidence is the race itself, or its warm-up. Strictly newer
    // than the race is the bar, so a same-day run cannot displace it.
    const { best } = bestRecentVdot([race()], TODAY, undefined, [tempo('2026-08-16')]);
    expect(best?.source).toBe('race');
  });
});

describe('the rule is inert when there is nothing to supersede', () => {
  it('with no race at all, training evidence anchors as before', () => {
    const { best } = bestRecentVdot([], TODAY, undefined, [tempo('2026-06-23'), tempo('2026-07-21')]);
    expect(best?.source).toBe('run');
  });

  it('with no training runs, the race anchors', () => {
    const { best } = bestRecentVdot([race()], TODAY, undefined, []);
    expect(best?.source).toBe('race');
  });

  it('an older race does not supersede newer training', () => {
    const { best } = bestRecentVdot([race({ date: '2026-06-01' })], TODAY, undefined, [
      tempo('2026-08-10'),
    ]);
    expect(best?.source).toBe('run');
  });
});
