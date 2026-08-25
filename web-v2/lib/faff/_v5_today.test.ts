/**
 * lib/faff/_v5_today.test.ts — one case per `V5Today.state`, against the
 * pure composer (`composeV5Today`). No DB, no network — every input is a
 * hand-built `V5TodayContext`, so this locks the composer's own logic
 * (state precedence, Rule 1's modelled:false stamping, Rule 2's ≥3-domain
 * gate, Rule 3's refusal shapes) independent of whatever the route's DB
 * orchestration does.
 */
import { describe, it, expect } from 'vitest';
import { composeV5Today, type V5TodayContext, type V5ConvergenceCtx } from './v5-today';

const TODAY = '2026-08-19';

function baseCtx(overrides: Partial<V5TodayContext> = {}): V5TodayContext {
  return {
    todayISO: TODAY,
    raceMode: true,
    todayPlan: null,
    weekLine: 'Week 6 of 16',
    phaseLine: 'Base',
    weekStripDays: [
      { id: 'w1', dateISO: '2026-08-18', plannedType: 'easy', subLabel: null, isToday: false, isRest: false, isDone: true },
      { id: 'date:2026-08-19', dateISO: TODAY, plannedType: 'easy', subLabel: null, isToday: true, isRest: false, isDone: false },
    ],
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

describe('composeV5Today · state precedence', () => {
  it('not_on_phone_yet · refuses gracefully when the runner is not in race mode', () => {
    const out = composeV5Today(baseCtx({ raceMode: false }));
    expect(out.state).toBe('not_on_phone_yet');
    expect(out.notOnPhoneYet).toBeTruthy();
    // Rule 3: a refusal, not a partially-populated payload.
    expect(out.panel.quiet).toBe(true);
    expect(out.weekStrip).toEqual([]);
  });

  it('injury_flare · a quiet panel, no gradient, nothing to prescribe', () => {
    const out = composeV5Today(baseCtx({
      injury: {
        area: 'Left calf', since: 'Flagged 2 days ago',
        verdict: 'Rest, not run.',
        whatChanged: [{ id: 'x', label: 'This week', sub: '12 mi, easy only', value: null, action: null }],
        checkIn: [{ id: 'better', label: 'Better today', sub: null, value: null, action: 'checkin_better' }],
        returnAvailable: false,
      },
    }));
    expect(out.state).toBe('injury_flare');
    expect(out.panel.quiet).toBe(true);
    expect(out.injury?.area).toBe('Left calf');
    expect(out.injury?.returnAvailable).toBe(false);
  });

  it('sick · a quiet panel too, but NOT the injury screen, and checked second', () => {
    const out = composeV5Today(baseCtx({
      sick: {
        symptoms: ['Head cold', 'Fatigue'], hasFever: false,
        since: 'Flagged today',
        verdict: 'Rest, not run.',
        checkIn: [{ id: 'better', label: 'Better today', sub: null, value: null, action: 'trend_better' }],
      },
    }));
    expect(out.state).toBe('sick');
    expect(out.panel.quiet).toBe(true);
    expect(out.sick?.symptoms).toContain('Head cold');
    expect(out.injury).toBeNull();
  });

  it('sick · an active injury takes the screen over a concurrent sick day', () => {
    const out = composeV5Today(baseCtx({
      injury: {
        area: 'Left calf', since: 'Flagged 2 days ago', verdict: 'Rest, not run.',
        whatChanged: [], checkIn: [], returnAvailable: false,
      },
      sick: {
        symptoms: ['Fever'], hasFever: true, since: 'Flagged today',
        verdict: 'Rest, not run.', checkIn: [],
      },
    }));
    expect(out.state).toBe('injury_flare');
    expect(out.sick).toBeNull();
  });

  it('week_off · a deliberate break, rest-hue gradient (not quiet)', () => {
    const out = composeV5Today(baseCtx({
      weekOff: {
        reason: 'Away from the plan', fromISO: '2026-08-18', toISO: '2026-08-24',
        nextUp: { label: 'Monday · Easy 4 mi', sub: '' },
      },
    }));
    expect(out.state).toBe('week_off');
    expect(out.panel.quiet).toBe(false);
    expect(out.panel.dayState).toBe('rest');
    expect(out.weekOff?.fromISO).toBe('2026-08-18');
    expect(out.weekOff?.nextUp?.label).toContain('Monday');
  });

  it('off_season · a Silence, not an invented sentence', () => {
    const out = composeV5Today(baseCtx({
      offSeason: {
        sinceLastRace: '3 weeks since Big Sur',
        silenceReason: 'No block is written. Running is optional, and nothing here is measured against a goal.',
        weeklyRange: '25 to 35 miles a week',
      },
    }));
    expect(out.state).toBe('off_season');
    expect(out.panel.quiet).toBe(true);
    expect(out.offSeason?.silenceReason).toMatch(/No block is written/);
  });

  it('after_run · outdoor · asked-vs-ran, zones, and elevation all present', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'threshold', subLabel: 'THRESHOLD', distanceMi: 8, originalType: null, originalSubLabel: null },
      recentRun: {
        runId: 'r1', distanceMi: 8.1, durationSec: 3600, paceSPerMi: 444,
        avgHr: 158, indoor: false, speedMph: null, inclinePct: null,
        askedPaceSPerMi: 440, askedHrCap: 165,
        // A threshold session's ceiling is an LTHR reference, not a hard
        // cap (spec-builder.ts only emits hr_cap_bpm for easy/long/
        // recovery) — false here, matching production for this workout type.
        askedHrIsHardCap: false,
        askedMi: 8,
        facts: [], win: null, conditionsNote: null, coachTip: null,
        effortAsked: { lo: 6, hi: 8 }, effortLogged: 7,
        verdict: 'Banked the threshold.',
        zoneShares: [8, 26, 14, 46, 6], zoneTarget: 4, zoneTargets: [4],
        elevationSamples: [0, 12, 8, 20], elevGainFt: 340, elevGainMeasured: true, hrMax: 158, cadenceAvg: 172, tempF: 61, workoutType: 'easy', hrAvgWork: null, cadenceAvgWork: null, paceWork: null, routePolyline: null, 
    routeSplits: [], routePhases: [], hrZones: [], paceBand: null,
        weekDoneMi: 26, weekPlannedMi: 46,
        shoeOptions: [{ id: 's1', name: 'Vomero Premium', mi: 62.7 }, { id: 's2', name: 'Vaporfly 3', mi: 88 }],
        shoeWorn: { id: '1', name: 'Endorphin Speed 4', mi: 214 },
        niggleFlagged: null,
      },
    }));
    expect(out.state).toBe('after_run');
    // Four rows, not three. Distance leads — see buildRecentRun's note.
    expect(out.askedVsRan.map((r) => r.id)).toEqual(['distance', 'pace', 'heart', 'effort']);
    expect(out.askedVsRan.find((r) => r.id === 'effort')?.action).toBeNull(); // already logged
    expect(out.zoneShares).toEqual([8, 26, 14, 46, 6]);
    expect(out.elevation).toEqual([0, 12, 8, 20]);
    expect(out.onTheBelt).toBeNull();
    expect(out.shoesWorn?.label).toBe('Endorphin Speed 4');
    // Rule 1: the RAN side of asked-vs-ran is a read of what happened — a
    // logged pace, a heart rate off the wrist, the runner's own effort. Those
    // stay measured. (The ASKED side lives in `sub`, which carries no
    // provenance field on the wire; see the audit note in v5-today.ts.)
    for (const row of out.askedVsRan) {
      if (row.value) expect(row.value.modelled).toBe(false);
    }
  });

  it('after_run · treadmill (5c) · onTheBelt present, elevation replaced entirely', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: null, distanceMi: 6, originalType: null, originalSubLabel: null },
      recentRun: {
        runId: 'r2', distanceMi: 6, durationSec: 3000, paceSPerMi: 500,
        avgHr: 140, indoor: true, speedMph: 7.2, inclinePct: 1.5,
        askedPaceSPerMi: null, askedHrCap: null, askedHrIsHardCap: false,
        askedMi: null,
        facts: [], win: null, conditionsNote: null, coachTip: null,
        effortAsked: null, effortLogged: null,
        verdict: 'Easy miles banked.',
        zoneShares: [40, 50, 10, 0, 0], zoneTarget: null, zoneTargets: [],
        elevationSamples: [0, 4, 8], elevGainFt: 120, elevGainMeasured: true, hrMax: 158, cadenceAvg: 172, tempF: 61, workoutType: 'easy', hrAvgWork: null, cadenceAvgWork: null, paceWork: null, routePolyline: null, routeSplits: [], routePhases: [], hrZones: [], paceBand: null,
        weekDoneMi: 20, weekPlannedMi: 40,
        shoeOptions: [{ id: 's1', name: 'Vomero Premium', mi: 62.7 }, { id: 's2', name: 'Vaporfly 3', mi: 88 }],
        shoeWorn: null, niggleFlagged: null,
      },
    }));
    expect(out.state).toBe('after_run');
    expect(out.elevation).toBeNull(); // design: replaced, not an empty card
    // RULE ONE, 2026-08-21. A treadmill has no sensor: `beltAverages` rolls up
    // the SETTINGS the runner confirmed on the console. The live console says
    // so on the screen before this one ("Distance is from the belt speed you
    // set · nothing here measured it") and the recap said the opposite.
    expect(out.onTheBelt).toEqual([
      { label: 'Speed', value: { text: '7.2', modelled: true }, tone: null },
      { label: 'Incline', value: { text: '1.5', modelled: true }, tone: null },
    ]);
    expect(out.panel.kicker).toBe('Treadmill · indoor, no GPS');
    // Effort not yet logged — the row is tappable.
    expect(out.askedVsRan.find((r) => r.id === 'effort')?.action).toBe('log_effort');
  });

  it('after_run · tone (Job 2 wire contract) · effort and hard-HR-cap breaches ink attention, pace never does', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: null, distanceMi: 6, originalType: null, originalSubLabel: null },
      recentRun: {
        runId: 'r3', distanceMi: 6, durationSec: 3000, paceSPerMi: 900,
        avgHr: 160, indoor: false, speedMph: null, inclinePct: null,
        // Easy day → askedHrCap really is hr_cap_bpm in production, so this
        // fixture marks it a hard cap and breaches it (160 > 150).
        askedPaceSPerMi: 500, askedHrCap: 150, askedHrIsHardCap: true,
        askedMi: null,
        facts: [], win: null, conditionsNote: null, coachTip: null,
        effortAsked: { lo: 2, hi: 4 }, effortLogged: 7, // well outside the band
        verdict: 'Easy done, but it ran hot.',
        zoneShares: null, zoneTarget: null, zoneTargets: [],
        elevationSamples: null, elevGainFt: null, elevGainMeasured: true, hrMax: 158, cadenceAvg: 172, tempF: 61, workoutType: 'easy', hrAvgWork: null, cadenceAvgWork: null, paceWork: null, routePolyline: null, routeSplits: [], routePhases: [], hrZones: [], paceBand: null,
        weekDoneMi: 10, weekPlannedMi: 30,
        shoeOptions: [{ id: 's1', name: 'Vomero Premium', mi: 62.7 }, { id: 's2', name: 'Vaporfly 3', mi: 88 }],
        shoeWorn: null, niggleFlagged: null,
      },
    }));
    const pace = out.askedVsRan.find((r) => r.id === 'pace');
    const heart = out.askedVsRan.find((r) => r.id === 'heart');
    const effort = out.askedVsRan.find((r) => r.id === 'effort');
    // Rule 1's own worked example: pace never gets a client-computable band
    // here, so this composer never inks it — see the doc comment above
    // askedPaceText in buildRecentRun.
    expect(pace?.tone).toBeUndefined();
    expect(heart?.tone).toBe('attention'); // 160 > a REAL cap of 150
    expect(effort?.tone).toBe('attention'); // 7 outside [2, 4]
  });

  it('after_run · tone · a non-cap HR reference (target/LTHR) never inks attention, even when exceeded', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'threshold', subLabel: 'THRESHOLD', distanceMi: 8, originalType: null, originalSubLabel: null },
      recentRun: {
        runId: 'r4', distanceMi: 8, durationSec: 3300, paceSPerMi: 412,
        // avgHr ABOVE the displayed number, but askedHrIsHardCap is false —
        // this is the exact shape of the bug the field prevents: a
        // threshold session that reached its own LTHR reference must not
        // read as a miss when reaching it was the point.
        avgHr: 172, indoor: false, speedMph: null, inclinePct: null,
        askedPaceSPerMi: 410, askedHrCap: 168, askedHrIsHardCap: false,
        askedMi: null,
        facts: [], win: null, conditionsNote: null, coachTip: null,
        effortAsked: null, effortLogged: null,
        verdict: 'Banked the threshold.',
        zoneShares: null, zoneTarget: 4, zoneTargets: [4],
        elevationSamples: null, elevGainFt: null, elevGainMeasured: true, hrMax: 158, cadenceAvg: 172, tempF: 61, workoutType: 'easy', hrAvgWork: null, cadenceAvgWork: null, paceWork: null, routePolyline: null, routeSplits: [], routePhases: [], hrZones: [], paceBand: null,
        weekDoneMi: 30, weekPlannedMi: 45,
        shoeOptions: [{ id: 's1', name: 'Vomero Premium', mi: 62.7 }, { id: 's2', name: 'Vaporfly 3', mi: 88 }],
        shoeWorn: null, niggleFlagged: null,
      },
    }));
    expect(out.askedVsRan.find((r) => r.id === 'heart')?.tone).toBeNull();
  });

  it('race_day / before_run · groups say which one is the work, never inferred from position', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'threshold', subLabel: 'THRESHOLD', distanceMi: 8, originalType: null, originalSubLabel: null },
      prescription: {
        type: 'threshold', headline: 'Threshold', why: 'Extend the ceiling.',
        total_mi: 8,
        steps: [
          { label: 'Warmup', distance_mi: 1.5, note: 'Easy in.' },
          { label: 'Threshold', distance_mi: 5, pace_target: '6:52/mi', note: 'Steady state.' },
          { label: 'Cooldown', distance_mi: 1.5, note: 'Easy out.' },
        ],
      },
    }));
    expect(out.groups).toHaveLength(3);
    const byId = Object.fromEntries(out.groups.map((g) => [g.id, g]));
    expect(byId.warmup.isWork).toBe(false);
    expect(byId.work.isWork).toBe(true);
    expect(byId.cooldown.isWork).toBe(false);
  });

  it('changed_overnight · fires only when THREE domains converged (Rule 2)', () => {
    const convergence: V5ConvergenceCtx = {
      updatedAt: '3:12 AM', wasType: 'Threshold', wasSubLabel: 'THRESHOLD',
      verdict: {
        grade: 'red',
        converging: ['sleep', 'autonomic', 'cardiac'],
        domains: [
          { domain: 'sleep', dragging: true, daysSustained: 3, suppressedBy: null, counts: true },
          { domain: 'autonomic', dragging: true, daysSustained: 4, suppressedBy: null, counts: true },
          { domain: 'cardiac', dragging: true, daysSustained: 2, suppressedBy: null, counts: true },
        ],
        rationale: '3 converging: sleep, autonomic, cardiac',
      },
      readings: {
        sleep: { value: '5h 40m', baseline: 'Your baseline is 7h 10m' },
        autonomic: { value: '52 ms', baseline: 'Your baseline is 68 ms' },
        cardiac: { value: '54', baseline: 'Your baseline is 48' },
      },
      coachLine: 'Three short nights, four days of low HRV and a resting heart rate above your usual. Today is easy running instead. The threshold session comes back when the numbers do.',
    };
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: null, distanceMi: 5, originalType: 'threshold', originalSubLabel: 'THRESHOLD' },
      convergence,
    }));
    expect(out.state).toBe('changed_overnight');
    expect(out.changed?.converged).toHaveLength(3);
    expect(out.changed?.movedTo).toBeNull(); // never invents a destination
    expect(out.changed?.coachLine).toMatch(/Three short nights/);
    expect(out.panel.dayState).toBe('rest'); // rest-hue gradient, per 17a
  });

  it('changed_overnight · omits `changed` entirely below three domains', () => {
    const convergence: V5ConvergenceCtx = {
      updatedAt: '3:12 AM', wasType: null, wasSubLabel: null,
      verdict: {
        grade: 'amber',
        converging: ['sleep', 'cardiac'],
        domains: [
          { domain: 'sleep', dragging: true, daysSustained: 3, suppressedBy: null, counts: true },
          { domain: 'cardiac', dragging: true, daysSustained: 2, suppressedBy: null, counts: true },
        ],
        rationale: '2 converging: sleep, cardiac',
      },
      readings: {},
      coachLine: 'Three short nights and a resting heart rate above your usual. Today stands as written.',
    };
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'threshold', subLabel: 'THRESHOLD', distanceMi: 8, originalType: null, originalSubLabel: null },
      convergence,
    }));
    // Amber never touches the plan (adapt.ts) — no `original_type` would be
    // set in practice, but even if a convergence payload showed up with <3
    // domains, the composer itself refuses to tell the story (Rule 2,
    // enforced at the point the payload is built, not just trusted upstream).
    expect(out.changed).toBeNull();
    expect(out.state).toBe('before_run');
  });

  it('race_day · uses the race gradient and the normal before-run shape', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'race', subLabel: 'MARATHON', distanceMi: 26.2, originalType: null, originalSubLabel: null },
      raceDay: true,
      prescription: {
        type: 'race', headline: 'Marathon · goal 3:30', why: 'Sixteen weeks are in the bank.',
        total_mi: 26.2,
        steps: [{ label: 'Race', distance_mi: 26.2, pace_target: '8:00/mi', note: 'Even effort, hold the pace.' }],
      },
    }));
    expect(out.state).toBe('race_day');
    expect(out.panel.dayState).toBe('race');
    expect(out.groups).toHaveLength(1);
    // A step's `sub` is its pace or HR target, and both come out of
    // `prescriptionFor` → `paces(p)` / `hrTargets(p)` → `tPaceFromGoal(...)`.
    // That is the runner's own typed GOAL TIME back-solved to a threshold pace
    // and offset by Daniels constants: modelled, not measured.
    expect(out.groups[0].steps[0].sub?.modelled).toBe(true);
  });

  it('before_run · the dose is the plan\'s own number, the pace band and HR ceiling are modelled', () => {
    const out = composeV5Today(baseCtx({
      todayPlan: { type: 'easy', subLabel: null, distanceMi: 6, originalType: null, originalSubLabel: null },
      paceBandStat: '8:50-9:35/mi', hrCapStat: '146 bpm', effortStat: '2-4',
      prescription: {
        type: 'easy', headline: 'Easy aerobic', why: 'Build the aerobic engine.',
        total_mi: 6,
        steps: [{ label: 'Run', distance_mi: 6, pace_target: '8:50-9:35/mi', hr_target: '146 bpm', note: 'Conversational the whole way.' }],
      },
    }));
    expect(out.state).toBe('before_run');
    expect(out.panel.dayState).toBe('easy');
    // RULE ONE, 2026-08-21. This test used to assert `false` for every stat on
    // the panel, which is how the pace band shipped as a hard read for as long
    // as it did: the test agreed with the composer and neither of them had
    // checked where the number came from.
    //
    // The DOSE stays measured — it is the plan's own prescribed distance, a
    // fact about the plan rather than an estimate of the runner.
    expect(out.panel.dose?.modelled).toBe(false);
    // The pace band is `derivePaces()` off the runner's typed goal time; the
    // HR ceiling is the Z2 upper bound of the LTHR zone model. Neither is a
    // read of anything that happened, so both carry the mark.
    const byLabel = Object.fromEntries(out.panel.stats.map((s) => [s.label, s.value]));
    expect(byLabel['Pace band']?.modelled).toBe(true);
    expect(byLabel['HR ceiling']?.modelled).toBe(true);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].title).toBe('Easy aerobic');
  });
  // ────────────────────────────────────────────────────────────────────────
  // 22b · a stepped-to day carries no present-tense context.
  //
  // The bug this locks: `loadGlanceState` takes no date. Readiness, the
  // seven-night sleep average and week-to-date mileage are read as of NOW and
  // were being rendered under a heading that said WED 19 AUG. A runner
  // looking back at Wednesday read Friday's readiness as Wednesday's.
  describe('stepped-to day', () => {
    const GLANCE_ROWS = [
      { id: 'readiness', label: 'Readiness', sub: 'READY',
        value: { text: '62 / 100', modelled: true }, action: null },
      { id: 'week', label: 'This week', sub: '31.0 mi planned',
        value: { text: '18.4 mi', modelled: false }, action: null },
    ];

    it('drops Where you are when the day is one the runner stepped to', () => {
      const out = composeV5Today(baseCtx({
        isSteppedDay: true,
        whereYouAre: GLANCE_ROWS,
        todayPlan: { type: 'easy', subLabel: null, distanceMi: 6, originalType: null, originalSubLabel: null },
      }));
      expect(out.whereYouAre).toEqual([]);
    });

    it('keeps Where you are on the runner\'s actual today', () => {
      const out = composeV5Today(baseCtx({
        isSteppedDay: false,
        whereYouAre: GLANCE_ROWS,
        todayPlan: { type: 'easy', subLabel: null, distanceMi: 6, originalType: null, originalSubLabel: null },
      }));
      expect(out.whereYouAre.map((r) => r.id)).toEqual(['readiness', 'week']);
    });

    // The flag is absent on every context built before this rule existed, and
    // an undefined flag must mean "this is today" rather than silently
    // emptying the section for every existing caller.
    it('treats an absent flag as today', () => {
      const out = composeV5Today(baseCtx({
        whereYouAre: GLANCE_ROWS,
        todayPlan: { type: 'easy', subLabel: null, distanceMi: 6, originalType: null, originalSubLabel: null },
      }));
      expect(out.whereYouAre).toHaveLength(2);
    });

    // The after-run screen is where a tapped "Done" row lands most of the
    // time, and it has its OWN `whereYouAre` assignment in the composer.
    it('drops Where you are on the after-run state too', () => {
      const out = composeV5Today(baseCtx({
        isSteppedDay: true,
        whereYouAre: GLANCE_ROWS,
        recentRun: {
          runId: 'r1', distanceMi: 6, durationSec: 3234, paceSPerMi: 539,
          avgHr: 141, indoor: false, speedMph: null, inclinePct: null,
          askedPaceSPerMi: null, askedHrCap: null, askedHrIsHardCap: false,
          askedMi: null,
          facts: [], win: null, conditionsNote: null, coachTip: null,
          effortAsked: null, effortLogged: null,
          verdict: 'Held it honestly.',
          zoneShares: [30, 55, 15, 0, 0], zoneTarget: null, zoneTargets: [],
          elevationSamples: [0, 6, 10], elevGainFt: 120, elevGainMeasured: true, hrMax: 158, cadenceAvg: 172, tempF: 61, workoutType: 'easy', hrAvgWork: null, cadenceAvgWork: null, paceWork: null, routePolyline: null, routeSplits: [], routePhases: [], hrZones: [], paceBand: null,
          weekDoneMi: 18.4, weekPlannedMi: 31,
          shoeOptions: [{ id: 's1', name: 'Vomero Premium', mi: 62.7 }, { id: 's2', name: 'Vaporfly 3', mi: 88 }],
          shoeWorn: null, niggleFlagged: null,
        },
      }));
      expect(out.state).toBe('after_run');
      expect(out.whereYouAre).toEqual([]);
    });
  });
});
