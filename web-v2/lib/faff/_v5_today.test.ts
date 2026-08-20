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
    raceDay: false,
    recentRun: null,
    weekOff: null,
    offSeason: null,
    injury: null,
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
        effortAsked: { lo: 6, hi: 8 }, effortLogged: 7,
        verdict: 'Banked the threshold.',
        zoneShares: [8, 26, 14, 46, 6], zoneTarget: 4,
        elevationSamples: [0, 12, 8, 20], elevGainFt: 340,
        weekDoneMi: 26, weekPlannedMi: 46,
        shoeWorn: { id: '1', name: 'Endorphin Speed 4', mi: 214 },
        niggleFlagged: null,
      },
    }));
    expect(out.state).toBe('after_run');
    expect(out.askedVsRan).toHaveLength(3);
    expect(out.askedVsRan.find((r) => r.id === 'effort')?.action).toBeNull(); // already logged
    expect(out.zoneShares).toEqual([8, 26, 14, 46, 6]);
    expect(out.elevation).toEqual([0, 12, 8, 20]);
    expect(out.onTheBelt).toBeNull();
    expect(out.shoesWorn?.label).toBe('Endorphin Speed 4');
    // Rule 1: every number here is measured, never modelled.
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
        askedPaceSPerMi: null, askedHrCap: null,
        effortAsked: null, effortLogged: null,
        verdict: 'Easy miles banked.',
        zoneShares: [40, 50, 10, 0, 0], zoneTarget: null,
        elevationSamples: [0, 4, 8], elevGainFt: 120,
        weekDoneMi: 20, weekPlannedMi: 40,
        shoeWorn: null, niggleFlagged: null,
      },
    }));
    expect(out.state).toBe('after_run');
    expect(out.elevation).toBeNull(); // design: replaced, not an empty card
    expect(out.onTheBelt).toEqual([
      { label: 'Speed', value: { text: '7.2', modelled: false }, tone: null },
      { label: 'Incline', value: { text: '1.5%', modelled: false }, tone: null },
    ]);
    expect(out.panel.kicker).toBe('Treadmill · indoor, no GPS');
    // Effort not yet logged — the row is tappable.
    expect(out.askedVsRan.find((r) => r.id === 'effort')?.action).toBe('log_effort');
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
    expect(out.groups[0].steps[0].sub?.modelled).toBe(false);
  });

  it('before_run · the default day, dose and stats carry no modelled marks', () => {
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
    expect(out.panel.dose?.modelled).toBe(false);
    for (const s of out.panel.stats) expect(s.value.modelled).toBe(false);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].title).toBe('Easy aerobic');
  });
});
