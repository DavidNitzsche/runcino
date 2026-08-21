/**
 * 2026-08-21 · web audit · RULE TWO regression tests.
 *
 *   "Readiness may change a session — but only on a convergence of
 *    independent signals, never on one metric."
 *
 * `lib/coach/convergence.ts` owns that ruling and states its ladder
 * plainly: one domain does nothing, TWO tells the runner and THE PLAN IS
 * NOT TOUCHED, THREE may change today's session. The WHAT TO DO panel on
 * the web Health page was issuing the third rung's instructions on the
 * first and second rungs' evidence:
 *
 *     "Tomorrow easy · let HRV recover."         ← autonomic, alone
 *     "Pull tomorrow's intensity back."          ← cardiac, alone
 *     "Hold this week at easy."                  ← autonomic, alone
 *     "Two easy days before the next quality."   ← load, alone
 *     "Tomorrow easy or rest · HRV and RHR."     ← two domains
 *     "Tomorrow easy · sleep is short and ..."   ← ONE named cause
 *
 * These lock the shape rather than the wording: a fatigue-class action
 * whose evidence spans fewer than three independent domains may state
 * what it saw and may not tell the runner to change a run.
 *
 * Deliberately NOT covered here, because they are not readiness signals
 * looking for corroboration: an active illness, a moderate niggle, a wrist
 * temperature at the illness threshold, and an ACWR above the injury hard
 * cap. Those are facts about the body or hard safety ceilings and keep
 * their instructions. `imperativeShapes` is scoped to the fatigue class
 * for exactly that reason.
 */
import { describe, expect, it } from 'vitest';
import { buildHealthActions, type HealthAction } from './health-actions';
import type { CoachState } from '@/lib/topics/types';

/** The signals whose evidence is readiness, not a hard fact. */
const FATIGUE_SIGNALS: ReadonlyArray<HealthAction['signal']> = [
  'compound', 'hrv_low_streak', 'rhr_high_streak', 'tsb_overreach',
  'load_spike', 'load_caution', 'hrv_cv_destabilizing',
];

/**
 * Does this sentence tell the runner to change a run?
 *
 * Matched on the imperative verb phrases the panel actually used, not on a
 * general notion of tone: "tomorrow easy", "pull ... back", "hold this week
 * at easy", "two easy days", "trim N miles", "swap", "skip", "drop".
 */
function isSessionInstruction(s: string): boolean {
  const t = s.toLowerCase();
  return /(^|[.\s·])tomorrow (easy|rest)/.test(t)
    || /pull .*(back|intensity)/.test(t)
    || /hold this week/.test(t)
    || /\d+ easy days?/.test(t)
    || /^trim /.test(t)
    || /(^|\s)(swap|skip|drop) /.test(t);
}

/**
 * A runner with exactly TWO independent domains dragging: autonomic (HRV
 * streak) and cardiac (RHR streak). Sleep is deliberately fine, so the
 * evidence cannot reach three however it is counted.
 *
 * `intermediate` is the tier that speaks prescriptively — the one where
 * the bug was reachable. An advanced runner already got observations
 * because of TONE, which was the wrong reason for the right output.
 */
function twoDomainArgs(overrides: Record<string, unknown> = {}) {
  const state = {
    profile: { experience_level: 'intermediate' },
    nextARace: null,
    activeNiggle: null,
    loadAcwr: 1.0,                    // load NOT dragging · keeps the count at 2
    hrvCurrent: 29, hrvBaseline: 56,
    rhrCurrent: 54, rhrBaseline: 47,
    sleep7Avg: 7.8,                   // sleep NOT dragging
    hrRecoveryCurrent: null, hrRecoveryBaseline: null,
    loadAcute7: 38, loadChronic28: 38,
  } as unknown as CoachState;
  return {
    breakdown: {
      score: 38, band: 'pull-back',
      inputs: [{ key: 'hrv', weight: -18 }, { key: 'rhr', weight: -6 }],
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

/** One domain only: HRV. RHR, sleep and load are all clean. */
function oneDomainArgs() {
  return twoDomainArgs({
    state: {
      profile: { experience_level: 'intermediate' },
      nextARace: null,
      activeNiggle: null,
      loadAcwr: 1.0,
      hrvCurrent: 29, hrvBaseline: 56,
      rhrCurrent: 47, rhrBaseline: 47,
      sleep7Avg: 7.8,
      hrRecoveryCurrent: null, hrRecoveryBaseline: null,
      loadAcute7: 38, loadChronic28: 38,
    } as unknown as CoachState,
    breakdown: {
      score: 44, band: 'moderate',
      inputs: [{ key: 'hrv', weight: -18 }],
    },
    streaks: [{ pillar: 'hrv', direction: 'below', days: 5 }],
    trainingForm: { tsb: -5, label: 'PRODUCTIVE' },
  });
}

describe('buildHealthActions — rule two', () => {
  it('one dragging domain never instructs a session change', () => {
    const out = buildHealthActions(oneDomainArgs()) as HealthAction[];
    const offenders = out
      .filter((a) => FATIGUE_SIGNALS.includes(a.signal))
      .filter((a) => isSessionInstruction(a.action));
    expect(offenders.map((a) => `${a.signal}: ${a.action}`)).toEqual([]);
  });

  it('one dragging domain still SAYS something · silence is not the fix', () => {
    const out = buildHealthActions(oneDomainArgs()) as HealthAction[];
    const spoke = out.filter((a) => FATIGUE_SIGNALS.includes(a.signal));
    expect(spoke.length).toBeGreaterThan(0);
  });

  it('two dragging domains still never instruct · three is the bar', () => {
    const out = buildHealthActions(twoDomainArgs()) as HealthAction[];
    const offenders = out
      .filter((a) => FATIGUE_SIGNALS.includes(a.signal))
      .filter((a) => isSessionInstruction(a.action));
    expect(offenders.map((a) => `${a.signal}: ${a.action}`)).toEqual([]);
  });

  it('the compound HRV+RHR line names both domains, not one', () => {
    const out = buildHealthActions(twoDomainArgs()) as HealthAction[];
    const compound = out.find((a) => a.signal === 'compound');
    expect(compound).toBeTruthy();
    const t = compound!.action.toLowerCase();
    expect(t).toContain('hrv');
    expect(t).toContain('rhr');
  });

  it('an advanced runner is unchanged · the tier was never the gate', () => {
    const base = twoDomainArgs();
    const advanced = buildHealthActions({
      ...base,
      state: { ...base.state, profile: { experience_level: 'advanced' } },
    }) as HealthAction[];
    const offenders = advanced
      .filter((a) => FATIGUE_SIGNALS.includes(a.signal))
      .filter((a) => isSessionInstruction(a.action));
    expect(offenders.map((a) => `${a.signal}: ${a.action}`)).toEqual([]);
  });
});
