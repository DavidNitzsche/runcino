/**
 * Selection order in `bestRecentVdot` · `Research/01` §"Implementation notes
 * for the engine" and §"Triggers to retest".
 *
 * ── WHAT THIS FILE REPLACES, AND WHY ──────────────────────────────────────
 *
 * This was `vdot-superseded-lead.test.ts`, and it asserted the opposite of what
 * it asserts now. The rule it locked — a training candidate dated on or before
 * a representative race can never outrank that race, whatever its magnitude —
 * was an INFERENCE ("the rule doctrine implies", in its own words) that
 * overrode a sentence `Research/01` states outright:
 *
 *     "Selection — pick the highest derived VDOT, not the most recent.
 *      A 6-week-old PR is a better fitness signal than a heat-affected
 *      race last weekend."
 *
 * The old suite could not catch that, because it was written by the same
 * reasoning as the engine, at the same time, to lock the same conclusion in
 * place (CLAUDE.md Rule 22). Eight of its assertions passed for two weeks while
 * the owner's prescribed easy pace sat at 9:02-9:42/mi against 27 logged runs
 * at avg HR 144 averaging 8:14/mi.
 *
 * The failure the old rule was built for is real and is still covered here —
 * a training lead must not run away from a race. It is bounded by the AUDIT #8
 * soft cap (`bestRaceRaw + TRAINING_ESTIMATE_SOFT_CAP_VDOT`), which is cited,
 * and which is what makes the second veto unnecessary rather than merely
 * unfashionable. The tests below assert that bound directly.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ──────────────────────────────
 *
 * It is a pure-function suite over hand-built candidates. It cannot see
 * anything the LOADER does: which rows reach the pool, whether their clocks are
 * coherent, whether a work phase was extracted, or the terrain adjustment. A
 * corrupt `movingTimeS` reaching this function looks like a fast runner, and
 * nothing here can tell the difference — that is `vdot-inputs`' job and it is
 * tested there. It also asserts ORDER and VALUE, never whether the resulting
 * pace is one a human should be asked to run.
 *
 * Balance, counted deliberately: 6 cases where training evidence wins, 6 where
 * the race wins. The old suite ran 8 race-wins to 3.
 */

import { describe, it, expect } from 'vitest';
import { bestRecentVdot, TRAINING_ESTIMATE_SOFT_CAP_VDOT } from './vdot';

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
    finish_seconds: 6113, // 1:41:53 → VDOT 44.1
    ...over,
  } as Race;
}

/** A 4-mile tempo at 7:10/mi · reads well above the race, so the cap bites. */
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

/** A 4-mile tempo deliberately SLOWER than the race implies. */
function slowTempo(date: string): Run {
  return { id: `slow-${date}`, date, workout_type: 'tempo', distance_mi: 4, finish_seconds: 2100 } as Run;
}

describe('selection takes the highest derived VDOT, not the most recent', () => {
  it('a tempo that predates the race still anchors, at the capped +1 lead', () => {
    // The case the retired rule inverted. Doctrine §"Triggers to retest": a
    // tempo running notably easier is worth "Add 1 VDOT point; re-derive
    // paces" — being anchored at race + 1 is the PRESCRIBED outcome, not a bug.
    const { best } = bestRecentVdot([race()], TODAY, undefined, [
      tempo('2026-06-23'),
      tempo('2026-07-07'),
      tempo('2026-07-21'),
    ]);
    expect(best?.source).toBe('run');
  });

  it('the lead it takes is EXACTLY the doctrinal quantum — it cannot run away', () => {
    // The bound that makes the date veto unnecessary. However fast the tempo,
    // the anchor may not exceed the race by more than the soft-estimate
    // quantum. This is the assertion the old rule's job actually belonged to.
    const insanelyFast = tempo('2026-06-23', { finish_seconds: 900 }); // 3:45/mi
    const { best, considered } = bestRecentVdot([race()], TODAY, undefined, [insanelyFast]);
    const raceCand = considered.find((c) => c.source === 'race')!;
    expect(best!.vdot).toBeCloseTo(raceCand.vdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT, 5);
  });

  it('a tempo run AFTER the race leads by the same permitted +1', () => {
    const { best } = bestRecentVdot([race()], TODAY, undefined, [tempo('2026-08-17')]);
    expect(best?.source).toBe('run');
  });

  it('with no race at all, training evidence anchors', () => {
    const { best } = bestRecentVdot([], TODAY, undefined, [tempo('2026-06-23'), tempo('2026-07-21')]);
    expect(best?.source).toBe('run');
  });

  it('an older race does not outrank newer training', () => {
    const { best } = bestRecentVdot([race({ date: '2026-06-01' })], TODAY, undefined, [
      tempo('2026-08-10'),
    ]);
    expect(best?.source).toBe('run');
  });

  it('every candidate stays visible in `considered` — ranked, never deleted', () => {
    const { considered } = bestRecentVdot([race()], TODAY, undefined, [tempo('2026-06-23')]);
    expect(considered).toHaveLength(2);
    expect(considered.filter((c) => c.source === 'race')).toHaveLength(1);
    expect(considered.filter((c) => c.source === 'run')).toHaveLength(1);
  });
});

describe('the race still wins wherever doctrine says it should', () => {
  it('when training merely AGREES with it — a race wins the exact tie', () => {
    // Stable sort, races precede runs in the concatenation. A race and a tempo
    // that say the same thing resolve to the race, which is the harder proof.
    const { best } = bestRecentVdot([race()], TODAY, undefined, [
      // 4 mi at 7:42/mi · T-pace for VDOT 44.1, so this reads AT the race.
      tempo('2026-08-01', { finish_seconds: 1848 }),
    ]);
    expect(best?.source).toBe('race');
  });

  it('when the training evidence reads BELOW it', () => {
    const { best } = bestRecentVdot([race()], TODAY, undefined, [
      slowTempo('2026-07-21'), slowTempo('2026-08-17'),
    ]);
    expect(best?.source).toBe('race');
  });

  it('when there is no qualifying training run at all', () => {
    const { best } = bestRecentVdot([race()], TODAY, undefined, []);
    expect(best?.source).toBe('race');
  });

  it('when the only training run is an easy jog that fails the honesty gate', () => {
    const jog = { id: 'jog', date: '2026-08-17', workout_type: 'easy',
      distance_mi: 6, finish_seconds: 3200, avg_hr: 120, max_hr: 185 } as Run;
    const { best } = bestRecentVdot([race()], TODAY, undefined, [jog]);
    expect(best?.source).toBe('race');
  });

  it('a run on the SAME DAY as the race cannot displace it', () => {
    // Identity, not doctrine: a same-day row is the race re-ingested from
    // Strava, or its warm-up. Letting it through lets the race lead ITSELF
    // by +1 and inflates every runner's anchor on the day they race.
    const { best } = bestRecentVdot([race()], TODAY, undefined, [tempo('2026-08-16')]);
    expect(best?.source).toBe('race');
  });

  it('the same-day guard keys on a REPRESENTATIVE race, not any race', () => {
    // A jogged C race must not acquire a veto the B row is doctrine's floor
    // for. With only a C race that day, the training run is genuine evidence.
    const { best } = bestRecentVdot(
      [race({ slug: 'parkrun', priority: 'C', distance_mi: 3.107, finish_seconds: 1500 })],
      TODAY, undefined, [tempo('2026-08-16')]);
    expect(best?.source).toBe('run');
  });
});

describe('a sub-representative race does not set the training ceiling', () => {
  // It is proof of a floor, not of a ceiling. `Research/01` §"Triggers to
  // retest" licenses "Update VDOT from race" only for an "all-out, well-paced"
  // result, and that is the question the ceiling asks.
  const fast = tempo('2026-08-10', { finish_seconds: 1500 }); // 6:15/mi, reads far above

  it('a C race lets training read past race + 1', () => {
    const { best } = bestRecentVdot(
      [race({ priority: 'C' })], TODAY, undefined, [fast]);
    const capped = bestRecentVdot([race()], TODAY, undefined, [fast]);
    expect(best!.vdot).toBeGreaterThan(capped.best!.vdot);
  });

  it("so does a race the RUNNER reported as compromised", () => {
    // The lever `POST /api/v5/race-authority` writes. It was honoured in the
    // ranking and ignored by the cap, so a runner who disowned a result still
    // had every training read bounded to it + 1.
    const { best } = bestRecentVdot(
      [race({ runner_authority_tier: 'compromised' })], TODAY, undefined, [fast]);
    const capped = bestRecentVdot([race()], TODAY, undefined, [fast]);
    expect(best!.vdot).toBeGreaterThan(capped.best!.vdot);
  });

  it('but it still anchors the headline when it is all the runner has', () => {
    // Ranked, not removed. A floor you have beats a guess you don't.
    const { best } = bestRecentVdot([race({ priority: 'C' })], TODAY, undefined, []);
    expect(best?.source).toBe('race');
  });

  it('and a representative race DOES still set the ceiling', () => {
    // The falsifier for the rule above: if this passed too, the exclusion
    // would be unconditional and the cap would mean nothing.
    const { best, considered } = bestRecentVdot([race()], TODAY, undefined, [fast]);
    const raceCand = considered.find((c) => c.source === 'race')!;
    expect(best!.vdot).toBeCloseTo(raceCand.vdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT, 5);
  });
});
