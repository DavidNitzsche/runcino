/**
 * _race_page_layers.test.ts · RP-2 / RP-3 · THE GATE.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · Whether the NUMBERS are right. It asserts the SET is coherent, never
 *     that `race-outlook.ts` resolved a good projection. A page showing four
 *     beautifully-labelled wrong times passes every assertion here.
 *   · Whether the phone DRAWS them. It gates the server's response shape;
 *     a Swift view that stops reading `raceLayers` is invisible to it. That
 *     half is `V5WireCorpusTests` and the rendered screenshot.
 *   · Whether the upside criteria are true. Nothing evaluates them, so this
 *     asserts only that they are reported `not_evaluated` rather than guessed.
 *   · A layer set nobody ever builds. The fixtures below are shaped from the
 *     owner's LIVE CIM and Dodgers outlooks (probed read-only 2026-09-02), not
 *     invented, so the paths exercised are paths production takes (Rule 15).
 *
 * Every invariant is FALSIFIED: broken on purpose, watched to fail, and only
 * then trusted (Rule 18).
 */
import { describe, it, expect } from 'vitest';
import {
  raceLayers,
  raceLayerInvariants,
  raceLayersPayload,
  type RaceLayer,
} from './race-page-layers';
import type { RaceOutlook } from './race-outlook';

/** The owner's live CIM outlook, probed read-only 2026-09-02. Only the fields
 *  `raceLayers` reads are populated; the rest is cast, because this test is
 *  about the presentation and not about the resolver's own shape. */
function cimOutlook(over: Record<string, unknown> = {}): RaceOutlook {
  return {
    race: { distanceMi: 26.22, priority: 'A', name: 'CIM' },
    statedGoal: { sec: 10800, paceSecPerMi: 412 },
    currentProjection: {
      expectedSec: 12230,
      likelyRangeSec: [11863, 12597] as const,
      confidence: 0.51,
      basis: 'durability_blend',
      primaryLimiter: 'endurance',
    },
    trainingPrescription: { kind: 'marathon_specific', paceSecPerMi: 472 },
    expectedRaceDay: {
      expectedSec: 11982,
      likelyRangeSec: [11608, 12411] as const,
      confidence: 0.3,
      basis: 'trajectory',
    },
    execution: {
      targetSec: 12230,
      paceSecPerMi: 466,
      paceBandSecPerMi: [461, 471] as const,
      source: 'current_evidence',
      effortCharacter: 'race',
      strategyLabel: 'Controlled start · 7:46/mi average',
      reasonVsExpected: 'Today’s evidence says 3:23:50.',
      hr: null,
    },
    conditionalUpside: {
      targetSec: 11610,
      paceSecPerMi: 443,
      criteria: [
        'Marathon-effort sessions completed inside the prescribed range with heart rate under the ceiling.',
        'A substantial marathon-specific long run finished without late-session deterioration.',
        'The same quality repeated in a second session, not shown once.',
        'A tune-up race consistent with the faster target.',
        'The higher-volume weeks of the block absorbed, not merely attempted.',
      ],
      confidence: 0.3,
    },
    ...over,
  } as unknown as RaceOutlook;
}

/** The owner's live Dodgers 10K, priority C, priced as a controlled effort. */
function dodgersOutlook(): RaceOutlook {
  return {
    race: { distanceMi: 6.21, priority: 'C', name: 'Dodgers' },
    statedGoal: { sec: 2700, paceSecPerMi: 435 },
    currentProjection: { expectedSec: 2584, likelyRangeSec: [2532, 2636] as const, confidence: 0.51, basis: 'durability_blend', primaryLimiter: 'endurance' },
    trainingPrescription: { kind: 'race_specific', paceSecPerMi: 416 },
    expectedRaceDay: { expectedSec: 2576, likelyRangeSec: [2524, 2630] as const, confidence: 0.3, basis: 'trajectory' },
    execution: {
      targetSec: 2825, paceSecPerMi: 455, paceBandSecPerMi: [450, 460] as const,
      source: 'controlled_c_effort', effortCharacter: 'controlled_c_effort',
      strategyLabel: 'Controlled effort · 7:35/mi average',
      reasonVsExpected: 'C race. Run it as the week’s hard session, not as a race.',
      hr: null,
    },
    // The resolver DOES emit one here. See the report: it derives the upside
    // from the forecast range without consulting `effortCharacter`.
    conditionalUpside: { targetSec: 2525, paceSecPerMi: 406, criteria: ['x', 'y', 'z', 'w'], confidence: 0.3 },
  } as unknown as RaceOutlook;
}

describe('RP-2 · the four layers are kept apart', () => {
  it('LIVENESS · the CIM fixture produces a real layer set, not an empty one', () => {
    const l = raceLayers(cimOutlook());
    expect(l, 'raceLayers returned null on a fully-populated outlook').not.toBeNull();
    expect(l!.layers.length, 'a fixture that produces no layers gates nothing').toBeGreaterThanOrEqual(3);
  });

  it('the live CIM set is coherent · no findings', () => {
    const l = raceLayers(cimOutlook())!;
    expect(l.findings, `incoherent: ${l.findings.join(' | ')}`).toEqual([]);
  });

  it('EXACTLY ONE layer is the number to run to, and it is never the goal', () => {
    const l = raceLayers(cimOutlook())!;
    const actionable = l.layers.filter((x) => x.actionable);
    expect(actionable).toHaveLength(1);
    expect(actionable[0].kind).toBe('execution_target');
    expect(l.layers.find((x) => x.kind === 'aspirational_goal')!.actionable).toBe(false);
  });

  it('THE RULE THE PAGE EXISTS FOR · no two layers wear the word "projection"', () => {
    const l = raceLayers(cimOutlook())!;
    const worded = l.layers.filter((x) => /projec/i.test(x.label));
    expect(worded.length, `labels: ${l.layers.map((x) => x.label).join(' / ')}`).toBeLessThanOrEqual(1);
  });

  it('no two layers print the same number under different labels', () => {
    const l = raceLayers(cimOutlook())!;
    const shown = l.layers.map((x) => x.display).filter((d): d is string => d != null);
    expect(new Set(shown).size, `duplicated: ${shown.join(', ')}`).toBe(shown.length);
  });

  it('the goal is the ONLY layer that is not modelled', () => {
    const l = raceLayers(cimOutlook())!;
    for (const x of l.layers) {
      expect(x.modelled, `${x.label} should be modelled`).toBe(x.kind !== 'aspirational_goal');
    }
  });

  it('Rule 17 · projection and target collapse when the target IS the projection', () => {
    const l = raceLayers(cimOutlook())!;
    expect(l.collapsedProjectionIntoTarget).toBe(true);
    expect(l.layers.some((x) => x.kind === 'current_projection')).toBe(false);
    // And the uncertainty survives the collapse (Q39 requires the range).
    const target = l.layers.find((x) => x.kind === 'execution_target')!;
    expect(target.range).not.toBeNull();
    expect(target.range!.lo).toBe('3:17:43');
  });

  it('THE LIVE FALSIFIER · rounding must not defeat the collapse', () => {
    // Measured on the owner's live CIM, 2026-09-03: the projection is 12228 s
    // and the target 12230 s, because `roundRaceTargetSec` rounds one of them.
    // A string-equality collapse showed "Today's evidence 3:23:48" directly
    // above "Race it at 3:23:50" — one quantity, two labels, two seconds
    // apart. The collapse now rests on `execution.source`, not on how close
    // the two numbers happen to render.
    const l = raceLayers(cimOutlook({
      currentProjection: {
        expectedSec: 12228, likelyRangeSec: [11861, 12595] as const,
        confidence: 0.51, basis: 'durability_blend', primaryLimiter: 'endurance',
      },
    }))!;
    expect(l.collapsedProjectionIntoTarget).toBe(true);
    expect(l.layers.filter((x) => /3:23:4|3:23:5/.test(x.display ?? ''))).toHaveLength(1);
    expect(l.findings).toEqual([]);
  });

  it('and they stay apart when they are genuinely two facts', () => {
    const l = raceLayers(dodgersOutlook())!;
    expect(l.collapsedProjectionIntoTarget).toBe(false);
    expect(l.layers.find((x) => x.kind === 'current_projection')!.display).toBe('43:04');
    expect(l.layers.find((x) => x.kind === 'execution_target')!.display).toBe('47:05');
    expect(l.findings).toEqual([]);
  });

  it('a controlled C effort gets no upside and no block forecast', () => {
    const l = raceLayers(dodgersOutlook())!;
    expect(l.layers.some((x) => x.kind === 'conditional_upside'),
      'an upside beside "run it as the week’s hard session" is the incompatible-values defect').toBe(false);
    expect(l.layers.some((x) => x.kind === 'block_forecast')).toBe(false);
  });

  it('RP-3 · the upside carries its criteria, and every one is honestly unevaluated', () => {
    const l = raceLayers(cimOutlook())!;
    const up = l.layers.find((x) => x.kind === 'conditional_upside')!;
    expect(up.criteria!.length).toBeGreaterThanOrEqual(4);
    // Rule 11 · nothing evaluates these. A fabricated tick would tell the
    // runner he had earned 3:13 on evidence nobody looked at.
    for (const c of up.criteria!) expect(c.status).toBe('not_evaluated');
    expect(up.actionable).toBe(false);
    expect(up.sec!).toBeLessThan(l.layers.find((x) => x.actionable)!.sec!);
  });

  it('Rule 17 · the goal layer carries the gap, because the stat plate yields', () => {
    // The plate used to print "Goal 3:00:00 · Projected 3:19:43 · Gap +19:43"
    // directly above the layer set printing the same two numbers again. The
    // plate is the one that goes, so the gap it uniquely carried moves here —
    // measured against the ACTIVE TARGET, not against a forecast.
    const l = raceLayers(cimOutlook())!;
    const goal = l.layers.find((x) => x.kind === 'aspirational_goal')!;
    expect(goal.note).toContain('23:50');   // 12230 - 10800
    expect(goal.note).toContain('faster than');
    expect(goal.note).not.toMatch(/[—!]/);
  });

  it('and it says so honestly when the goal is SLOWER than the evidence', () => {
    const l = raceLayers(cimOutlook({ statedGoal: { sec: 13000, paceSecPerMi: 496 } }))!;
    const goal = l.layers.find((x) => x.kind === 'aspirational_goal')!;
    expect(goal.note).toContain('slower than');
  });

  it('and refuses to state a gap it cannot compute', () => {
    const l = raceLayers(cimOutlook({
      execution: { targetSec: null, paceSecPerMi: null, paceBandSecPerMi: null, source: 'unavailable', effortCharacter: 'race', strategyLabel: null, reasonVsExpected: '', hr: null },
      conditionalUpside: null,
    }))!;
    const goal = l.layers.find((x) => x.kind === 'aspirational_goal')!;
    expect(goal.note).toBe('Yours. The coach never changes it and never races off it.');
  });

  it('the temporality sentence names the active number and the upside', () => {
    const l = raceLayers(cimOutlook())!;
    expect(l.temporality).toContain('3:23:50');
    expect(l.temporality).toContain('3:13:30');
    // Coach voice: no em dashes, no exclamation marks, no emoji.
    expect(l.temporality!).not.toMatch(/[—!]/);
  });

  it('a block forecast whose basis is not a trajectory is refused, not drawn twice', () => {
    const l = raceLayers(cimOutlook({
      expectedRaceDay: { expectedSec: 12230, likelyRangeSec: null, confidence: 0.3, basis: 'current_projection' },
      conditionalUpside: null,
    }))!;
    expect(l.layers.some((x) => x.kind === 'block_forecast')).toBe(false);
    expect(l.findings).toEqual([]);
  });

  it('Rule 11 · no outlook is null, not an empty set of layers', () => {
    expect(raceLayers(null)).toBeNull();
    expect(raceLayers(undefined)).toBeNull();
  });
});

// ── FALSIFICATION · Rule 18 ────────────────────────────────────────────────
//
// "Break the thing on purpose and watch the gate name it." Every invariant
// gets its own broken set. A guarantee that has never failed is a hypothesis.

describe('RP-2 · the invariants FAIL when the set is broken', () => {
  const base: RaceLayer = {
    kind: 'execution_target', label: 'Race it at', display: '3:23:50', sec: 12230,
    pace: '7:46', range: null, modelled: true, actionable: true, note: 'n', criteria: null,
  };

  it('two actionable numbers', () => {
    const f = raceLayerInvariants([base, { ...base, kind: 'block_forecast', label: 'Other', display: '3:19:42', sec: 11982 }]);
    expect(f.join(' ')).toContain('ACTIONABLE_NOT_EXACTLY_ONE');
  });

  it('no actionable number at all', () => {
    expect(raceLayerInvariants([{ ...base, actionable: false }]).join(' ')).toContain('ACTIONABLE_NOT_EXACTLY_ONE');
  });

  it('THE ORIGINAL DEFECT · three layers all labelled "projected"', () => {
    const f = raceLayerInvariants([
      base,
      { ...base, kind: 'current_projection', label: 'Projected', display: '3:22:17', sec: 12137, actionable: false },
      { ...base, kind: 'block_forecast', label: 'Projected finish', display: '3:31:48', sec: 12708, actionable: false },
    ]);
    expect(f.join(' ')).toContain('MULTIPLE_PROJECTIONS');
  });

  it('one number under two labels', () => {
    const f = raceLayerInvariants([
      base,
      { ...base, kind: 'block_forecast', label: 'Where the block gets you', actionable: false },
    ]);
    expect(f.join(' ')).toContain('SAME_NUMBER_TWO_LABELS');
  });

  it('two labels the same', () => {
    const f = raceLayerInvariants([
      base,
      { ...base, kind: 'block_forecast', display: '3:19:42', sec: 11982, actionable: false },
    ]);
    expect(f.join(' ')).toContain('DUPLICATE_LABEL');
  });

  it('THE GOAL PRESCRIBED AS THE TARGET', () => {
    const f = raceLayerInvariants([{ ...base, kind: 'aspirational_goal', label: 'Your goal', display: '3:00:00', sec: 10800, modelled: false }]);
    expect(f.join(' ')).toContain('GOAL_IS_ACTIONABLE');
  });

  it('a modelled number presented as a read', () => {
    const f = raceLayerInvariants([{ ...base, modelled: false }]);
    expect(f.join(' ')).toContain('MODELLED_LOOKS_MEASURED');
  });

  it('an "upside" that is not faster than the target', () => {
    const f = raceLayerInvariants([
      base,
      { ...base, kind: 'conditional_upside', label: 'Upside', display: '3:30:00', sec: 12600, actionable: false, criteria: [{ text: 'a', status: 'not_evaluated' }] },
    ]);
    expect(f.join(' ')).toContain('UPSIDE_NOT_FASTER');
  });

  it('a faster number dangled with no criteria', () => {
    const f = raceLayerInvariants([
      base,
      { ...base, kind: 'conditional_upside', label: 'Upside', display: '3:13:30', sec: 11610, actionable: false, criteria: [] },
    ]);
    expect(f.join(' ')).toContain('UPSIDE_WITHOUT_CRITERIA');
  });

  it('a forecast with no sentence saying it is a forecast', () => {
    const f = raceLayerInvariants([
      base,
      { ...base, kind: 'block_forecast', label: 'Block', display: '3:19:42', sec: 11982, actionable: false, note: null },
    ]);
    expect(f.join(' ')).toContain('FORECAST_UNLABELLED');
  });

  it('and a clean set produces NO findings · the gate is not simply always red', () => {
    expect(raceLayerInvariants([base])).toEqual([]);
  });
});

describe('RP-2 · the wire shape', () => {
  it('every layer reaches the wire with its label, its mark and its one flag', () => {
    const p = raceLayersPayload(raceLayers(cimOutlook()))!;
    expect(p.layers.filter((x) => x.actionable)).toHaveLength(1);
    for (const x of p.layers) {
      expect(typeof x.kind).toBe('string');
      expect(x.label.length).toBeGreaterThan(0);
      expect(typeof x.modelled).toBe('boolean');
    }
    expect(p.findings).toEqual([]);
    expect(p.collapsed_projection_into_target).toBe(true);
    const up = p.layers.find((x) => x.kind === 'conditional_upside')!;
    expect(up.criteria!.every((c) => c.status === 'not_evaluated')).toBe(true);
  });

  it('null in, null out', () => {
    expect(raceLayersPayload(null)).toBeNull();
  });
});
