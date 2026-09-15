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
 * ── F139 UPDATE (2026-09-15) ───────────────────────────────────────────────
 *
 * `bestRaceRaw` (the race half of that bound) requires a race to clear
 * `REPRESENTATIVE_FLOOR`. Before F139 a bare declared A/B priority cleared it
 * on its own; now that priority may never weight evidence
 * (`RACE_TIERING_AND_SEASON_PHILOSOPHY.md`), NOTHING clears it without a
 * measured signal this function does not yet have wired in (see the F139
 * report). Three mechanisms share this one root cause and are all
 * consequently DORMANT for a bare, unreported race today — disclosed here
 * rather than silently absorbed:
 *
 *   1. The candidate-sort authority demotion (`authorityDemoted`).
 *   2. The AUDIT #8 race-based ceiling fallback (`bestRaceRaw`) — this file's
 *      own subject, below.
 *   3. The same-day identity guard (`representativeRaceDates`).
 *
 * The TRAINING-CORPUS half of the ceiling (`corpusRead.ok`) is untouched and
 * still bounds training reads once enough qualifying runs corroborate each
 * other — the gap is specifically "a race, on its own, with no runner
 * report, no longer sets a ceiling," not "training reads are now always
 * uncapped."
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

  it('F139 · a bare, unreported race no longer bounds an insanely fast tempo at all', () => {
    // Before F139 this asserted the AUDIT #8 cap held even against an
    // absurd tempo. It no longer can: `race()` (declared A, no runner
    // report) cannot clear REPRESENTATIVE_FLOOR any more, so it is excluded
    // from `bestRaceRaw` and the training read goes uncapped. See the file
    // header's F139 note — this is the disclosed ceiling-dormancy
    // consequence, demonstrated directly.
    const insanelyFast = tempo('2026-06-23', { finish_seconds: 900 }); // 3:45/mi
    const { best, considered } = bestRecentVdot([race()], TODAY, undefined, [insanelyFast]);
    const raceCand = considered.find((c) => c.source === 'race')!;
    expect(best!.vdot).toBeGreaterThan(raceCand.vdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT);
  });

  it('RULE 18 FALSIFIER · before F139 the same fixture capped the tempo to race + 1.0', () => {
    const insanelyFast = tempo('2026-06-23', { finish_seconds: 900 });
    const { best, considered } = bestRecentVdot([race()], TODAY, undefined, [insanelyFast]);
    const raceCand = considered.find((c) => c.source === 'race')!;
    // The OLD assertion (`toBeCloseTo(raceCand.vdot + CAP, 5)`) no longer
    // holds — proving this is a real, deliberate behaviour change.
    expect(best!.vdot).not.toBeCloseTo(raceCand.vdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT, 5);
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

  it('F139 · a run on the SAME DAY as an UNREPORTED race no longer triggers the identity guard', () => {
    // Before F139 this was the identity protection: a same-day row is the
    // race re-ingested from Strava, or its warm-up, and must not lead the
    // race by +1. The guard keys on `representativeRaceDates`, which — like
    // the other two mechanisms named in this file's F139 header note —
    // requires clearing REPRESENTATIVE_FLOOR, and a bare declared-A race
    // with no runner report no longer can. In production `loadVdotInputs`
    // already excludes race-day runs at the loader (C1-1e, ±1 day), so this
    // is belt-and-braces dormancy, not an open hole — but it is real and
    // disclosed here rather than silently absorbed.
    const { best } = bestRecentVdot([race()], TODAY, undefined, [tempo('2026-08-16')]);
    expect(best?.source).toBe('run');
  });

  it('RULE 18 FALSIFIER · before F139 the race won this exact fixture', () => {
    const { considered } = bestRecentVdot([race()], TODAY, undefined, [tempo('2026-08-16')]);
    const raceCand = considered.find((c) => c.source === 'race')! as { authority: number };
    // Under the old rule `raceCand.authority` (`selectionAuthority('A')`)
    // would have been 1.0, clearing REPRESENTATIVE_FLOOR and arming the
    // guard. It is now the F139 conservative default, well below it.
    expect(raceCand.authority).toBeLessThan(0.65);
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
  //
  // F139 (2026-09-15): every one of the fixtures below — a C race, a race
  // reported compromised, AND a bare declared-A race with no report at all —
  // now grades sub-representative, because priority can no longer promote
  // one of them above the others. So "a C race lets training read past
  // race + 1" is no longer a distinguishing fact: EVERY unreported race lets
  // that happen now, C or A. The section is rewritten to assert that new,
  // flatter invariant directly, plus a falsifier proving it is a real change.
  const fast = tempo('2026-08-10', { finish_seconds: 1500 }); // 6:15/mi, reads far above
  const uncapped = () =>
    bestRecentVdot([], TODAY, undefined, [fast]).considered.find((c) => c.source === 'run')!.vdot_raw;

  it('F139 · a C race, a compromised-reported race, and a bare unreported A race ALL let training read uncapped', () => {
    const cases: Array<[string, Race]> = [
      ['C priority', race({ priority: 'C' })],
      ['compromised report', race({ runner_authority_tier: 'compromised' })],
      ['bare declared A, no report', race()],
    ];
    const u = uncapped();
    for (const [label, r] of cases) {
      const { best } = bestRecentVdot([r], TODAY, undefined, [fast]);
      expect(best!.vdot, `${label} should read uncapped`).toBeCloseTo(u, 5);
    }
  });

  it('RULE 18 FALSIFIER · before F139 the bare declared-A race capped the same tempo to race + 1.0', () => {
    const { best, considered } = bestRecentVdot([race()], TODAY, undefined, [fast]);
    const raceCand = considered.find((c) => c.source === 'race')!;
    // The OLD assertion for this exact fixture ("and a representative race
    // DOES still set the ceiling") no longer holds.
    expect(best!.vdot).not.toBeCloseTo(raceCand.vdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT, 5);
  });

  it('but a sub-representative race still anchors the HEADLINE when it is all the runner has', () => {
    // Ranked, not removed. A floor you have beats a guess you don't — this
    // half of the doctrine is unaffected by F139, and unaffected by the
    // ceiling going dormant, because it never depended on the ceiling.
    const { best } = bestRecentVdot([race({ priority: 'C' })], TODAY, undefined, []);
    expect(best?.source).toBe('race');
  });

  it('the TRAINING-CORPUS ceiling is untouched · once the corpus corroborates itself, reads are bounded again', () => {
    // F139 only removed the RACE half of the ceiling's fallback chain. The
    // primary, corpus-based bound (`corpusRead.ok`) reads no priority at
    // all and is unaffected — demonstrated here so the disclosure above
    // reads as "the race-only fallback is dormant", not "training reads
    // are now always uncapped".
    const corroborating = [
      tempo('2026-06-01', { finish_seconds: 2100 }),
      tempo('2026-06-15', { finish_seconds: 2100 }),
      tempo('2026-06-29', { finish_seconds: 2100 }),
      tempo('2026-07-13', { finish_seconds: 2100 }),
    ];
    const { corpus } = bestRecentVdot([], TODAY, undefined, corroborating);
    expect(corpus.ok).toBe(true);
    const { best } = bestRecentVdot([], TODAY, undefined, [...corroborating, fast]);
    if (corpus.ok) {
      expect(best!.vdot).toBeLessThanOrEqual(corpus.vdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT + 1e-9);
    }
  });
});
