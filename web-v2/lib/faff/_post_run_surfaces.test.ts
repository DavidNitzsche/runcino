/**
 * lib/faff/_post_run_surfaces.test.ts — the after-run screen says what the
 * engine already knew.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUESTION THIS ANSWERS
 *
 * "Whatever happened to the post run information and how thats handled? are we
 * seeing intervals, and breakdowns etc all correctly?" — the owner, 2026-08-24.
 * The answer was no, in four separate places, and two of them are here:
 *
 *   · THE TABLE CALLED ASKED VS RAN HAD NO DISTANCE ROW. Pace, heart, effort.
 *     On 2026-08-23 the plan asked for 5.0 mi and the run covered 11.01 —
 *     the largest single fact about that session, and the one reading the
 *     screen did not carry. `plannedMi` reached `deriveRecap` and was read by
 *     no branch there either.
 *
 *   · `deriveRecap` RETURNS FOUR SENTENCES AND THE ROUTE FORWARDED ONE. facts,
 *     conditions_note and coach_tip were composed on every request, returned,
 *     decoded by `RunRecap` on the phone, and dropped on the floor. `win` was
 *     never even derived on this route.
 *
 * EVERY FIXTURE BELOW IS A REAL PRODUCTION ROW. The distances, paces, heart
 * rates and plan targets are `dnitch85@me.com`'s own, read out of prod at
 * `faff_readonly` on 2026-08-24 — `plan_workouts` for the asks and
 * `coach_intents.value` (reason `watch_completion`) for what the watch
 * recorded. A fixture invented to fit the code proves the code agrees with
 * itself.
 */
import { describe, it, expect } from 'vitest';
import { composeV5Today, type V5TodayContext, type V5RecentRunCtx } from './v5-today';

const TODAY = '2026-08-23';

function baseCtx(overrides: Partial<V5TodayContext> = {}): V5TodayContext {
  return {
    todayISO: TODAY,
    raceMode: true,
    todayPlan: null,
    weekLine: 'Week 6 of 16',
    phaseLine: 'Base',
    weekStripDays: [],
    prescription: null,
    weatherKicker: null,
    paceBandStat: null,
    hrCapStat: null,
    effortStat: null,
    why: null,
    whereYouAre: [],
    beforeYouGo: [],
    paceNote: null,
    raceDay: false,
    recentRun: null,
    weekOff: null,
    offSeason: null,
    injury: null,
    sick: null,
    convergence: null,
    ...overrides,
  };
}

/**
 * 2026-08-23, exactly as production holds it.
 *
 *   plan_workouts   · type 'easy', sub_label 'MEDIUM-LONG', distance_mi 5,
 *                     workout_spec.pace_target_s_per_mi_lo/hi 542/582
 *   coach_intents   · totalDistanceMi 11.01, totalDurationSec 5298,
 *                     avgHr 147, maxHr 175, one work phase labelled
 *                     "5.0 mi easy", verdict 'missed',
 *                     timeInToleranceSec 90 / timeOutOfToleranceSec 2280
 */
function aug23Run(overrides: Partial<V5RecentRunCtx> = {}): V5RecentRunCtx {
  return {
    runId: 'aug23',
    distanceMi: 11.01,
    durationSec: 5298,
    paceSPerMi: 481,
    avgHr: 147,
    indoor: false,
    speedMph: null,
    inclinePct: null,
    askedPaceSPerMi: 562,
    askedMi: 5,
    askedHrCap: null,
    askedHrIsHardCap: false,
    effortAsked: null,
    effortLogged: null,
    verdict: 'Medium-long done.',
    facts: [],
    win: null,
    conditionsNote: null,
    coachTip: null,
    zoneShares: null,
    zoneTarget: null,
    zoneTargets: [],
    elevationSamples: null,
    elevGainFt: 3195,
    routePolyline: null,
    weekDoneMi: 24.2,
    weekPlannedMi: 38,
    shoeOptions: [{ id: 's1', name: 'Vomero Premium', mi: 62.7 }, { id: 's2', name: 'Vaporfly 3', mi: 88 }],
    shoeWorn: null,
    niggleFlagged: null,
    ...overrides,
  };
}

describe('asked vs ran · the Distance row', () => {
  it('states both numbers on the day the plan asked 5 and the run covered 11', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: 'MEDIUM-LONG', distanceMi: 5, originalType: null, originalSubLabel: null },
      recentRun: aug23Run(),
    }));

    const distance = out.askedVsRan.find((r) => r.id === 'distance');
    expect(distance).toBeDefined();
    expect(distance?.label).toBe('Distance');
    expect(distance?.sub).toBe('asked 5 mi');
    expect(distance?.value?.text).toBe('11 mi');
  });

  it('leads the table · every row under it is read through the distance moved', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: 'MEDIUM-LONG', distanceMi: 5, originalType: null, originalSubLabel: null },
      recentRun: aug23Run(),
    }));
    expect(out.askedVsRan[0]?.id).toBe('distance');
  });

  it('A DECISION IS NOT A LAPSE · six extra miles are never inked as a fault', () => {
    // The register `WristDecisionsV5` sets, applied to a table row. Eleven
    // against five is unambiguous arithmetic — unlike pace there is no
    // honest-band problem here — and the row still carries no tone, because
    // the screen does not know whether the runner felt good and added, or
    // ran a route that came out long. Amber would grade both as faults.
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: 'MEDIUM-LONG', distanceMi: 5, originalType: null, originalSubLabel: null },
      recentRun: aug23Run(),
    }));
    const distance = out.askedVsRan.find((r) => r.id === 'distance');
    expect(distance?.tone).toBeUndefined();
    expect(distance?.action).toBeNull();
  });

  it('draws on a day the two AGREE · a row that appears only on a bad day teaches the runner to read its absence', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: 'MEDIUM-LONG', distanceMi: 5, originalType: null, originalSubLabel: null },
      recentRun: aug23Run({ distanceMi: 5.02 }),
    }));
    const distance = out.askedVsRan.find((r) => r.id === 'distance');
    expect(distance?.sub).toBe('asked 5 mi');
    expect(distance?.value?.text).toBe('5 mi');
  });

  it('RULE THREE · no plan row means no Distance row, never an empty one', () => {
    // An unplanned run has nothing to compare against. A "Distance / asked —"
    // row is a section that failed to load; a missing row is an answer.
    const out = composeV5Today(baseCtx({
      todayPlan: null,
      recentRun: aug23Run({ askedMi: null }),
    }));
    expect(out.askedVsRan.find((r) => r.id === 'distance')).toBeUndefined();
    expect(out.askedVsRan.map((r) => r.id)).toEqual(['pace', 'heart', 'effort']);
  });

  it('RULE ONE · the ran side is measured, because it is a logged distance', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: 'MEDIUM-LONG', distanceMi: 5, originalType: null, originalSubLabel: null },
      recentRun: aug23Run(),
    }));
    expect(out.askedVsRan.find((r) => r.id === 'distance')?.value?.modelled).toBe(false);
  });
});

describe('the recap sentences reach the wire', () => {
  const FACTS = [
    '11.0 mi at 8:01/mi, HR averaged 147.',
    'That is six miles past what the day asked for.',
  ];

  it('carries facts, win, the conditions note and the tip · not the verdict alone', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: 'MEDIUM-LONG', distanceMi: 5, originalType: null, originalSubLabel: null },
      recentRun: aug23Run({
        facts: FACTS,
        win: 'Held the easy band the whole way.',
        conditionsNote: 'Warm and humid, so the pace read slower than the effort.',
        coachTip: 'Keep the next one to the number on the plan.',
      }),
    }));
    expect(out.verdict).toBe('Medium-long done.');
    expect(out.facts).toEqual(FACTS);
    expect(out.win).toBe('Held the easy band the whole way.');
    expect(out.conditionsNote).toBe('Warm and humid, so the pace read slower than the effort.');
    expect(out.coachTip).toBe('Keep the next one to the number on the plan.');
  });

  it('QUOTES, never re-words · one voice, one composer', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: 'MEDIUM-LONG', distanceMi: 5, originalType: null, originalSubLabel: null },
      recentRun: aug23Run({ facts: FACTS }),
    }));
    // Identity, not just equality: nothing here re-derives the sentences.
    expect(out.facts[0]).toBe(FACTS[0]);
    expect(out.facts[1]).toBe(FACTS[1]);
  });

  it('RULE THREE · a neutral day carries no conditions note and no win, and both stay null', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: 'MEDIUM-LONG', distanceMi: 5, originalType: null, originalSubLabel: null },
      recentRun: aug23Run(),
    }));
    expect(out.conditionsNote).toBeNull();
    expect(out.win).toBeNull();
    expect(out.facts).toEqual([]);
  });

  it('a state that is not after_run says none of it', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: null, distanceMi: 5, originalType: null, originalSubLabel: null },
      recentRun: null,
    }));
    expect(out.state).toBe('before_run');
    expect(out.facts).toEqual([]);
    expect(out.win).toBeNull();
    expect(out.conditionsNote).toBeNull();
    expect(out.coachTip).toBeNull();
  });
});
