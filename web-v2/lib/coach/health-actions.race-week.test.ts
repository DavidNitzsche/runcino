/**
 * 2026-06-09 · race-killer F4 regression tests — the race-week guard.
 *
 * Production failure these lock down: on 2026-06-08 a single 29 ms
 * partial-night HRV reading (later corrected to 46 ms by re-sync)
 * scored readiness 38 PULL-BACK and fired pull-back prescriptions.
 * health-actions had no race-proximity awareness at all, so the same
 * inputs on Aug 16 would have told the runner to "take 2-3 easy days"
 * at 5 AM with the gun at 7:00.
 *
 * Doctrine: taper-week fatigue signals are expected physiology, not
 * actionable warnings (Research/08-pacing-and-race-week.md §9 ·
 * "taper crud … is normal. Resist the urge to test fitness.").
 * Medical hard rules (illness / flare / wrist temp) stay on.
 */
import { describe, expect, it } from 'vitest';
import { buildHealthActions, type HealthAction } from './health-actions';
import type { CoachState } from '@/lib/topics/types';

const FATIGUE_SIGNALS: ReadonlyArray<HealthAction['signal']> = [
  'compound', 'hrv_low_streak', 'rhr_high_streak', 'tsb_overreach',
  'load_spike', 'load_caution', 'load_detraining', 'hrv_cv_destabilizing',
];

/** A stressed runner: HRV+RHR streaks at threshold, deep-negative TSB,
 *  ACWR in the spike band, sustained sub-40 scores — every fatigue-class
 *  trigger armed at once. daysToRace positions it on the calendar. */
function stressedArgs(daysToRace: number | null, overrides: Record<string, unknown> = {}) {
  const state = {
    profile: { experience_level: 'intermediate' },
    nextARace: daysToRace == null ? null : {
      slug: 'americas-finest-city', name: 'Americas Finest City',
      date: '2026-08-16', goal: '1:30', days_to_race: daysToRace,
      distanceMi: 13.1, distanceLabel: 'Half Marathon',
    },
    activeNiggle: null,
    loadAcwr: 1.45,                       // spike band for intermediate
    hrvCurrent: 29, hrvBaseline: 56,      // the Jun 8 production shape
    rhrCurrent: 54, rhrBaseline: 47,
    sleep7Avg: 7.6,                       // sleep NOT tripping (isolate fatigue class)
    hrRecoveryCurrent: null, hrRecoveryBaseline: null,
    loadAcute7: 40, loadChronic28: 38,
  } as unknown as CoachState;
  return {
    breakdown: {
      score: 38, band: 'pull-back',
      inputs: [{ key: 'hrv', weight: -18 }, { key: 'sleep', weight: -2 }],
    },
    state,
    history: { hrv: [], rhr: [], sleep: [], hrvPlews: null },
    streaks: [
      { pillar: 'hrv', direction: 'below', days: 5 },
      { pillar: 'rhr', direction: 'above', days: 5 },
    ],
    trainingForm: { tsb: -32, label: 'OVERREACH' },
    wristTempDeltaC: null,
    activeSick: false,
    scoreTrend: [
      { date: '2026-08-13', score: 38 },
      { date: '2026-08-14', score: 36 },
      { date: '2026-08-15', score: 39 },
    ],
    planAdaptation: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('buildHealthActions — race-week guard (F4)', () => {
  it('outside race week the fatigue class still fires (guard does not over-suppress)', () => {
    const out = buildHealthActions(stressedArgs(20));
    expect(out.some((a) => FATIGUE_SIGNALS.includes(a.signal))).toBe(true);
    expect(out.some((a) => a.signal === 'race_day' || a.signal === 'race_week')).toBe(false);
  });

  it('race week (T−3): pull-back prescriptions and training changes are gone, taper note shown', () => {
    const out = buildHealthActions(stressedArgs(3));
    for (const a of out) {
      expect(FATIGUE_SIGNALS, `unexpected fatigue action: ${a.signal} · ${a.action}`).not.toContain(a.signal);
    }
    const note = out.find((a) => a.signal === 'race_week');
    expect(note).toBeDefined();
    expect(note!.action).toContain('3d out');
  });

  it('race morning (T−0): "time to execute" leads and nothing else fires', () => {
    const out = buildHealthActions(stressedArgs(0));
    expect(out[0].signal).toBe('race_day');
    expect(out[0].action).toMatch(/execute/i);
    expect(out.length).toBe(1); // every fatigue + advisory action suppressed
  });

  it('race morning keeps the illness hard rule (racing sick is medical, not taper noise)', () => {
    const out = buildHealthActions(stressedArgs(0, { activeSick: true }));
    // Final priority sort puts URGENT illness above the on-course execute
    // line — correct: flu at 5 AM outranks the pep line.
    expect(out[0].signal).toBe('sick');
    expect(out.some((a) => a.signal === 'race_day')).toBe(true);
    expect(out.some((a) => FATIGUE_SIGNALS.includes(a.signal))).toBe(false);
  });

  it('no race on the calendar → behavior unchanged', () => {
    const out = buildHealthActions(stressedArgs(null));
    expect(out.some((a) => FATIGUE_SIGNALS.includes(a.signal))).toBe(true);
  });

  it('race week + missing gun time → logistics nag (F14); absent on race morning', () => {
    const week = buildHealthActions(stressedArgs(3, { raceGunTimeMissing: true }));
    const nag = week.find((a) => a.action.includes('Gun time not set'));
    expect(nag).toBeDefined();
    expect(nag!.priority).toBe('medium');
    const morning = buildHealthActions(stressedArgs(0, { raceGunTimeMissing: true }));
    expect(morning.some((a) => a.action.includes('Gun time'))).toBe(false);
  });
});
