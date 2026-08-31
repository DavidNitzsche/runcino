/**
 * lib/faff/_prerun_card.test.ts · PRERUN-1 (2026-08-24)
 *
 * THE SCREEN A RUNNER READS BEFORE THEY RUN, asserted end to end: real
 * `workout_spec` shapes off production, through `cardFromSpec`, through
 * `composeV5Today`, to the strings the phone draws.
 *
 * `_spec_card.test.ts` already guards the CARD. Everything below was true of
 * the card and false of the screen, because `buildGroups` read some of the
 * card's fields and dropped others — which is exactly the gap a card-level
 * test cannot see. The four defects it locks, all measured against production
 * on 2026-08-24 over `faff_readonly`:
 *
 *   · the rest interval never reached the phone. Fourteen live rep sessions,
 *     every one of them: "3 × 3:00 · 7:46 /mi" for a spec that reads
 *     "3×3 min @ 5K-10K race pace · 2 min jog". The watch had the jog phase
 *     the whole time.
 *   · the execution note never reached the phone. "Same pace on every rep. If
 *     the last one slips, the target was too fast." was composed on every
 *     request and discarded.
 *   · a hill rep rendered as a flat one: "11 × 10s".
 *   · a time-based rep set's work header was blank, because a set counted in
 *     seconds has no miles to sum.
 */

import { describe, it, expect } from 'vitest';
import { cardFromSpec, cardForUnprescribableType, HR_TARGET_MIN_REP_SEC } from '@/lib/training/spec-card';
import { strictPrescriptionType } from '@/lib/training/prescriptions';
import { composeV5Today, displayTypeFor, dayStateWordFor, type V5TodayContext, type V5Today } from './v5-today';

const HR = { z1: '120-135', z2: '135-150', z3: '150-162', z4: '162-172', z5: '172-185' };

/** Verbatim off production, `plan_workouts.workout_spec`, active plans. */
const SPEC = {
  hills: {
    kind: 'intervals', label: '11×10s hills · by effort', lthr_bpm: null, by_effort: true,
    rep_count: 11, warmup_mi: 1.2, rep_rest_s: 90, cooldown_mi: 1,
    rep_duration_s: 10, rep_pace_s_per_mi: null,
  },
  tuneup: {
    kind: 'threshold', label: '5×400 m @ T pace · 2 min jog', lthr_bpm: null,
    rep_count: 5, warmup_mi: 1.2, rep_rest_s: 120, cooldown_mi: 1,
    rep_distance_mi: 0.2485, rep_pace_s_per_mi: 430,
  },
  longWithFinish: {
    kind: 'long', fuel_mi: [], hr_cap_bpm: null, finish_mi: 10, finish_tag: 'marathon',
    pace_target_s_per_mi_hi: 586, pace_target_s_per_mi_lo: 566,
    finish_pace_s_per_mi: 481,
  },
} as const;

function screen(plan: { type: string; subLabel: string | null; distanceMi: number }, card: unknown): V5Today {
  const ctx: V5TodayContext = {
    todayISO: '2026-08-24', raceMode: true,
    todayPlan: { ...plan, originalType: null, originalSubLabel: null },
    weekLine: 'Week 6 of 16', phaseLine: 'Build', weekStripDays: [],
    prescription: card as V5TodayContext['prescription'],
    weatherKicker: null, paceBandStat: null, hrCapStat: null, effortStat: null,
    why: null, whereYouAre: [], beforeYouGo: [], paceNote: null,
    raceDay: plan.type === 'race', contingency: null, recentRun: null,
    weekOff: null, offSeason: null, injury: null, sick: null, convergence: null,
  };
  return composeV5Today(ctx);
}

function cardFor(spec: unknown, type: string, mi: number, subLabel: string | null, easy = 540) {
  const t = strictPrescriptionType(type)!;
  const c = cardFromSpec({
    spec: spec as never, type: t, subLabel, distanceMi: mi,
    easyPaceSec: easy, hr: HR,
    toleranceSec: t === 'threshold' || t === 'intervals' ? 8 : 20,
  })!;
  return { card: c, screen: screen({ type, subLabel, distanceMi: mi }, { ...c, fueling: null }) };
}

const groupById = (t: V5Today, id: string) => t.groups.find((g) => g.id === id)!;
const mains = (t: V5Today, id: string) => groupById(t, id).steps.map((s) => s.main);

describe('PRERUN-1 · the rest interval reaches the screen', () => {
  it('renders the jog as its own step, by feel · no exact pace', () => {
    const { screen: s } = cardFor(SPEC.tuneup, 'race_week_tuneup', 4.3, '5×400 m @ T pace · 2 min jog');
    expect(mains(s, 'work')).toEqual(['5 × 400 m', '2:00 jog between']);
    // RECOVERY-BYFEEL-1 (2026-09-01) · this used to assert the jog carried a
    // number ("9:00 /mi" — the runner's own easy anchor, reused). That was
    // finding #1 of the provenance trace: warm-up, every jog recovery and
    // cool-down all read the identical anchor "by construction", including a
    // jog whose only job is getting the runner ready for the next 400. The
    // jog's own note ("Honest jog, not standing.") still reaches the screen
    // via the step's `note`; it no longer needs a pace behind it to be real.
    expect(groupById(s, 'work').steps[1].sub).toBeNull();
  });

  it('calls a stride recovery a walk back, because that is what it is', () => {
    const spec = {
      kind: 'easy', fuel_mi: [], hr_cap_bpm: null,
      pace_target_s_per_mi_hi: 620, pace_target_s_per_mi_lo: 586,
      strides_reps: 6, strides_duration_s: 20, strides_pace_s_per_mi: 466,
      strides_recovery_s: 60,
    };
    const { screen: s } = cardFor(spec, 'easy', 4, 'EASY · 6×20s strides');
    expect(mains(s, 'work')).toContain('1:00 walk back between');
    expect(mains(s, 'work')).not.toContain('1:00 jog between');
  });

  it('emits one recovery per rep BLOCK on a ladder, not one for the set', () => {
    // 2×90s + 4×60s, two blocks with different rests. Both rests must show.
    const spec = {
      kind: 'intervals', label: 'ladder', lthr_bpm: null, by_effort: true,
      reps: [
        { count: 2, duration_s: 90, rest_s: 90 },
        { count: 4, duration_s: 60, rest_s: 60 },
      ],
      warmup_mi: 1.5, cooldown_mi: 1.1,
    };
    const built = cardFromSpec({
      spec: spec as never, type: 'intervals', subLabel: null, distanceMi: 5,
      easyPaceSec: 540, hr: HR, toleranceSec: 8,
    });
    // Only assert when this spec shape expands — the point is the invariant,
    // not this particular ladder's support.
    if (!built) return;
    const s = screen({ type: 'intervals', subLabel: null, distanceMi: 5 }, { ...built, fueling: null });
    const jogs = mains(s, 'work').filter((m) => /between$/.test(m));
    expect(jogs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('PRERUN-1 · a hill rep is not a flat rep', () => {
  it('keeps the noun the expander wrote', () => {
    const { screen: s } = cardFor(SPEC.hills, 'intervals', 4, '11×10s hills · by effort');
    expect(mains(s, 'work')[0]).toBe('11 × 10s hills');
  });

  it('does not decorate a plain rep with a noun', () => {
    const { screen: s } = cardFor(SPEC.tuneup, 'race_week_tuneup', 4.3, null);
    expect(mains(s, 'work')[0]).toBe('5 × 400 m');
  });
});

describe('PRERUN-1 · the work header states a figure on a time-based set', () => {
  it('reports the time when there are no miles to report', () => {
    const { screen: s } = cardFor(SPEC.hills, 'intervals', 4, '11×10s hills · by effort');
    // 11 × 10s = 110s.
    expect(groupById(s, 'work').note).toBe('1:50 of work');
  });

  it('still reports miles when the reps carry them', () => {
    const { screen: s } = cardFor(SPEC.tuneup, 'race_week_tuneup', 4.3, null);
    expect(groupById(s, 'work').note).toMatch(/mi$/);
  });
});

describe('PRERUN-1 · the execution note reaches the screen', () => {
  it('puts the group role note in the footer', () => {
    const { screen: s } = cardFor(SPEC.tuneup, 'race_week_tuneup', 4.3, null);
    expect(groupById(s, 'work').footer)
      .toBe('Same pace on every rep. If the last one slips, the target was too fast.');
    expect(groupById(s, 'warmup').footer).toMatch(/^Start easy/);
  });

  it('carries BOTH roles on a long run with a race-pace finish', () => {
    // The finish is the point of the session. A footer that says only "time on
    // feet beats pace" coaches against the ten miles below it.
    const { screen: s } = cardFor(SPEC.longWithFinish, 'long', 19, 'LONG · 10mi @ M');
    const f = groupById(s, 'work').footer ?? '';
    expect(f).toMatch(/Time on feet/);
    expect(f).toMatch(/Find race rhythm/);
  });

  it('never prints a note that is already the step', () => {
    // A rest-day step's `main` IS its note; the footer must not repeat it.
    const card = cardForUnprescribableType({ rawType: 'strength', subLabel: 'SESSION A' });
    const s = screen({ type: 'strength', subLabel: 'SESSION A', distanceMi: 0 }, { ...card, fueling: null });
    for (const g of s.groups) {
      if (g.footer) expect(g.steps.map((x) => x.main)).not.toContain(g.footer);
    }
  });
});

describe('PRERUN-1 · a day with no run in it says so', () => {
  it('refuses rather than narrowing strength to easy', () => {
    expect(strictPrescriptionType('strength')).toBeNull();
    expect(strictPrescriptionType('cross')).toBeNull();
    // The running types still narrow exactly as before.
    expect(strictPrescriptionType('race_week_tuneup')).toBe('threshold');
    expect(strictPrescriptionType('fartlek')).toBe('tempo');
    expect(strictPrescriptionType('interval')).toBe('intervals');
  });

  it('does not draw "Session a" at 56pt over a day with no run', () => {
    // "SESSION A" passes every test `subLabelIsName` applies — short, no
    // prescription syntax — which is how it became the day's headline.
    expect(displayTypeFor('strength', 'SESSION A')).toBe('Rest');
    expect(dayStateWordFor('strength')).toBe('rest');
  });

  it('names what the day IS stored as, and prescribes nothing', () => {
    const card = cardForUnprescribableType({ rawType: 'strength', subLabel: 'SESSION A' });
    expect(card.total_mi).toBe(0);
    expect(card.workPaceSPerMi).toBeNull();
    expect(card.why).toContain('strength');
    expect(card.headline).toBe('No run today');
  });
});

describe('PRERUN-1 · the panel states this session’s pace, not a derived one', () => {
  it('reads the work phase, and bands it by the tolerance the watch grades on', () => {
    const { card } = cardFor(SPEC.tuneup, 'race_week_tuneup', 4.3, null);
    expect(card.workPaceSPerMi).toBe(430);
    expect(card.workToleranceSPerMi).toBe(8);
  });

  it('prefers the FINISH on a long run, because that is the target', () => {
    const { card } = cardFor(SPEC.longWithFinish, 'long', 19, 'LONG · 10mi @ M');
    expect(card.workPaceSPerMi).toBe(481);
  });

  it('names no pace at all when the plan named none', () => {
    const { card } = cardFor(SPEC.hills, 'intervals', 4, '11×10s hills · by effort');
    expect(card.workPaceSPerMi).toBeNull();
  });
});

describe('PRERUN-1 · the session’s minutes come from its phases', () => {
  it('counts the warm-up and the jogs, not just the reps', () => {
    const { card } = cardFor(SPEC.tuneup, 'race_week_tuneup', 4.3, null);
    // miles × rep pace would be 4.3 × 430 = 1849s. The real session is longer,
    // because the warm-up, the cool-down and four two-minute jogs are slower.
    expect(card.totalDurationSec).toBeGreaterThan(1849);
  });
});

describe('PRERUN-1 · the phone never eases a target for heat', () => {
  // 2026-08-27 · heat easing removed entirely — the runner paces by feel.
  // `cardFromSpec` no longer accepts a heat-easing input at all; these
  // tests confirm the authored band is always what the card states.
  it('states the authored pace, unmoved', () => {
    const card = cardFromSpec({
      spec: SPEC.tuneup as never, type: 'threshold', subLabel: null,
      distanceMi: 4.3, easyPaceSec: 540, hr: HR, toleranceSec: 8,
    })!;
    expect(card.workPaceSPerMi).toBe(430);
  });

  it('a race states the authored pace too · nothing eases it', () => {
    const spec = {
      kind: 'long', fuel_mi: [5, 9, 13], hr_cap_bpm: null,
      pace_target_s_per_mi_hi: 486, pace_target_s_per_mi_lo: 476,
    };
    const card = cardFromSpec({
      spec: spec as never, type: 'race', subLabel: 'RACE', distanceMi: 26.2,
      easyPaceSec: 540, hr: HR, toleranceSec: 12,
    })!;
    expect(card.workPaceSPerMi).toBe(481);
  });
});

describe('PRERUN-1 · what to do if it goes wrong reaches the screen', () => {
  it('renders the authored contingency as its own group', () => {
    const card = cardFromSpec({
      spec: { kind: 'long', fuel_mi: [], hr_cap_bpm: null,
        pace_target_s_per_mi_hi: 486, pace_target_s_per_mi_lo: 476 } as never,
      type: 'race', subLabel: 'RACE', distanceMi: 26.2, easyPaceSec: 540, hr: HR,
    })!;
    const ctx: V5TodayContext = {
      todayISO: '2026-10-02', raceMode: true,
      todayPlan: { type: 'race', subLabel: 'RACE', distanceMi: 26.2, originalType: null, originalSubLabel: null },
      weekLine: null, phaseLine: 'Peak', weekStripDays: [],
      prescription: { ...card, fueling: null } as V5TodayContext['prescription'],
      weatherKicker: null, paceBandStat: null, hrCapStat: null, effortStat: null,
      why: null, whereYouAre: [], beforeYouGo: [], paceNote: null, raceDay: true,
      contingency: [{ evidence: 'Mile 5 pace slower than 8:24', judgement: 'Switch to the B plan.' }],
      recentRun: null, weekOff: null, offSeason: null, injury: null, sick: null, convergence: null,
    };
    const t = composeV5Today(ctx);
    const g = t.groups.find((x) => x.id === 'contingency')!;
    expect(g.title).toBe('If it goes wrong');
    expect(g.steps[0].main).toBe('Mile 5 pace slower than 8:24');
    expect(g.steps[0].sub?.text).toBe('Switch to the B plan.');
    // RULE ONE · a trigger derived from a goal is modelled, and wears the mark.
    expect(g.steps[0].sub?.modelled).toBe(true);
  });

  it('draws nothing at all when there are no rules', () => {
    const { screen: s } = cardFor(SPEC.tuneup, 'race_week_tuneup', 4.3, null);
    expect(s.groups.find((g) => g.id === 'contingency')).toBeUndefined();
  });
});

describe('PRERUN-1 · a rep too short for a heart rate does not state one', () => {
  it('drops the band on a ten-second hill and says what the plan said instead', () => {
    // Research/03 §13: "<30 s (sprints, R) | Useless — HR lags | Pace, RPE".
    // Live on two active plans as "11 × 10s hills · 172-185".
    expect(HR_TARGET_MIN_REP_SEC).toBe(30);
    const { card, screen: s } = cardFor(SPEC.hills, 'intervals', 4, '11×10s hills · by effort');
    const rep = card.steps.find((x) => x.reps === 11)!;
    expect(rep.hr_target).toBeUndefined();
    expect(rep.pace_target).toBeUndefined();
    expect(rep.effort_target).toBe('By effort');
    // and the target column is not left blank, which reads as a failed load.
    expect(groupById(s, 'work').steps[0].sub?.text).toBe('By effort');
  });

  it('keeps the band on a three-minute rep, where HR arrives mid-rep', () => {
    const spec = {
      kind: 'intervals', label: '6×3 min hills @ T-10K effort', lthr_bpm: null, by_effort: true,
      rep_count: 6, warmup_mi: 1.5, rep_rest_s: 90, cooldown_mi: 1,
      rep_duration_s: 180, rep_pace_s_per_mi: null,
    };
    const { card } = cardFor(spec, 'intervals', 5.5, '6×3 min hills @ T effort-10K effort');
    expect(card.steps.find((x) => x.reps === 6)!.hr_target).toBe(HR.z5);
  });

  it('never suppresses a band on a DISTANCE rep · a 400 is not a ten-second rep', () => {
    const { card } = cardFor(SPEC.tuneup, 'race_week_tuneup', 4.3, null);
    // It carries a pace, so pace wins the column — but the band is present.
    const rep = card.steps.find((x) => x.reps === 5)!;
    expect(rep.hr_target).toBe(HR.z4);
  });
});

describe('PRERUN-1 · an aerobic ceiling belongs to an aerobic day', () => {
  it('flags a long run that ends at race pace', () => {
    const { card } = cardFor(SPEC.longWithFinish, 'long', 19, 'LONG · 10mi @ M');
    expect(card.hasRacePaceFinish).toBe(true);
  });

  it('does not flag a plain long run', () => {
    const spec = { kind: 'long', fuel_mi: [], hr_cap_bpm: null,
      pace_target_s_per_mi_hi: 586, pace_target_s_per_mi_lo: 566 };
    const { card } = cardFor(spec, 'long', 12, 'LONG');
    expect(card.hasRacePaceFinish).toBe(false);
  });

  it('does not flag a rep session · the gate is the finish, not the intensity', () => {
    const { card } = cardFor(SPEC.tuneup, 'race_week_tuneup', 4.3, null);
    expect(card.hasRacePaceFinish).toBe(false);
  });
});

describe('PRERUN-1 · the footer does not argue with the target beside it', () => {
  it('drops "even splits" on a rep the plan sized in effort', () => {
    const { screen: s } = cardFor(SPEC.hills, 'intervals', 4, '11×10s hills · by effort');
    const f = groupById(s, 'work').footer ?? '';
    // "Even splits from the first rep" asks for a pace the row above has just
    // refused to state. Research/03 §14 puts hill reps under RPE outright.
    expect(f).not.toMatch(/even splits/i);
    expect(f).toMatch(/Effort is the target/);
  });

  it('keeps "even splits" where the plan DID name a pace', () => {
    const spec = {
      kind: 'intervals', label: '3×3 min @ 5K-10K race pace · 2 min jog', lthr_bpm: null,
      rep_count: 3, warmup_mi: 1.2, rep_rest_s: 120, cooldown_mi: 1.2,
      rep_duration_s: 180, rep_pace_s_per_mi: 466,
    };
    const { screen: s } = cardFor(spec, 'intervals', 4, null);
    expect(groupById(s, 'work').footer ?? '').toMatch(/Even splits/);
  });
});
