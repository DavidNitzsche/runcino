/**
 * lib/coach/_standing_recommendation_convergence.test.ts · STANDINGREC-1.
 *
 * `composeStandingRecommendation` used to decide on its OWN, single-domain
 * reading of a `ReadinessBrief` — a private `evaluateSignals()` that fired on
 * any ONE of a pull-back band, a lone sleep streak, one elevated-RHR reading,
 * an HRV streak, or two soft pillars. That is a second, unilateral answer to
 * the question `docs/BRAIN_CONSTITUTION.md`'s ownership table gives to ONE
 * owner — "Is normal training appropriate today? | Readiness" — which in code
 * is `resolveRunnerState()` (lib/training/runner-state.ts).
 *
 * ── THE PLANTED-DEFECT DISCRIMINATOR (Rule 18) ───────────────────────────────
 *
 * `oldSingleDomainEvaluator` below reproduces the deleted logic verbatim
 * against a brief carrying exactly ONE soft signal (a 5-night sleep streak,
 * nothing else dragging). It fires. The live composer, routed through
 * `resolveRunnerState`, must NOT fire for that same runner-day, because
 * `resolveRunnerState` no longer reads sleep/HRV/RHR/subjective readiness at
 * all (2026-09-02 "runner owns readiness") — the only driving signal it has
 * left for a `reduce` decision is a training-gap re-entry. A test that cannot
 * tell the two apart is not evidence of anything.
 *
 * Run: ./node_modules/.bin/vitest run lib/coach/_standing_recommendation_convergence.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('@/lib/runtime/runner-tz', () => ({ runnerToday: vi.fn() }));
vi.mock('@/lib/training/runner-state', () => ({ resolveRunnerState: vi.fn() }));

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { resolveRunnerState } from '@/lib/training/runner-state';
import { composeStandingRecommendation } from './standing-recommendation';
import type { ReadinessBrief, PillarBand } from './readiness-brief';
import type { RunnerState } from '@/lib/training/runner-state';

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const TODAY = '2026-09-11';
const WORKOUT_ID = 'wk-1';

const QUALITY_WORKOUT = {
  type: 'tempo',
  distance_mi: 8,
  date_iso: TODAY,
  is_quality: true,
};

/** Minimal brief · enough to satisfy the `!brief` early-exit and to feed the
 *  old (deleted) single-domain evaluator being reproduced below. Only the
 *  fields that evaluator reads are populated meaningfully. */
function briefWithOneSoftSignal(): ReadinessBrief {
  return {
    date: TODAY,
    score: 68,
    band: 'ready' as PillarBand,
    label: 'READY',
    headline: '',
    oneLineMover: null,
    scoreTrend: [],
    pillars: [
      { key: 'sleep', label: 'SLEEP', weightPct: 0, observedValue: '', observedSub: '', baseline: '', band: 'ready' as PillarBand, weightContribution: 0, meaning: '', confounders: [], trend: [], citation: '' },
    ],
    // ONE domain dragging · a 5-night sleep streak, nothing else.
    streaks: [{
      pillar: 'sleep', direction: 'below', days: 5,
      startDate: '2026-09-06', short: '', meaning: '',
    }],
    movers: [],
    subjectiveOverride: null,
    subjectiveCheckin: { answeredAt: null, rating: null, answered: false },
    coldStart: null,
    trendNote: null,
    composition: null,
    hrvCv: null,
    synthesis: null,
    trainingForm: null,
    watchTomorrow: [],
    actions: [],
    actionsThreshold: '',
    gapReport: null,
  };
}

/** The deleted evaluator, reproduced verbatim as the falsification oracle.
 *  Mirrors the pre-fix `evaluateSignals` in standing-recommendation.ts git
 *  history — kept here, not restored there, so this file can prove the fix
 *  actually removed it rather than merely renamed it. */
function oldSingleDomainEvaluatorFires(brief: ReadinessBrief): boolean {
  if (brief.band === 'no-data') return false;
  if (brief.band === 'pull-back') return true;
  const sleepStreak = brief.streaks.find((s) => s.pillar === 'sleep' && s.direction === 'below');
  if (sleepStreak && sleepStreak.days >= 5) return true;
  const rhrTile = brief.pillars.find((p) => p.key === 'rhr');
  if (rhrTile && rhrTile.band === 'pull-back') return true;
  const hrvStreak = brief.streaks.find((s) => s.pillar === 'hrv' && s.direction === 'below');
  if (hrvStreak && hrvStreak.days >= 3) return true;
  const cautionPillars = brief.pillars.filter((p) => p.band === 'pull-back' || p.band === 'moderate');
  if (cautionPillars.length >= 2) return true;
  return false;
}

function stateWith(decision: RunnerState['decision'], kind: string | null = null): RunnerState {
  return {
    decision,
    driver: kind ? { kind: kind as never, argues: decision, driving: true, detail: 'internal', evidence: {} } : null,
    signals: [],
    readable: true,
    todayISO: TODAY,
    resolvedAt: new Date().toISOString(),
    modelVersion: '1.0.0',
  };
}

beforeEach(() => {
  vi.mocked(pool.query).mockReset().mockResolvedValue({ rows: [] } as never);
  vi.mocked(runnerToday).mockReset().mockResolvedValue(TODAY);
  vi.mocked(resolveRunnerState).mockReset();
});

describe('STANDINGREC-1 · single-domain violation is falsified', () => {
  it('the deleted single-domain evaluator DOES fire on one soft signal (the oracle discriminates)', () => {
    expect(oldSingleDomainEvaluatorFires(briefWithOneSoftSignal())).toBe(true);
  });

  it('the live composer does NOT fire on the same one-soft-signal runner-day, because resolveRunnerState (fed only training facts) reads it as proceed', async () => {
    vi.mocked(resolveRunnerState).mockResolvedValue(stateWith('proceed'));
    const rec = await composeStandingRecommendation({
      workoutId: WORKOUT_ID,
      userUuid: USER,
      workout: QUALITY_WORKOUT,
      brief: briefWithOneSoftSignal(),
    });
    expect(rec).toBeNull();
    expect(resolveRunnerState).toHaveBeenCalledWith(USER, TODAY);
  });
});

describe('STANDINGREC-1 · routes through the canonical Readiness owner', () => {
  it('reduce (training-gap re-entry) fires an ease_down recommendation', async () => {
    vi.mocked(resolveRunnerState).mockResolvedValue(stateWith('reduce', 'training_gap'));
    const rec = await composeStandingRecommendation({
      workoutId: WORKOUT_ID,
      userUuid: USER,
      workout: QUALITY_WORKOUT,
      brief: briefWithOneSoftSignal(),
    });
    expect(rec).not.toBeNull();
    expect(rec?.kind).toBe('ease_down');
    expect(rec?.suggestion?.proposedDistanceMi).toBe(QUALITY_WORKOUT.distance_mi);
    // Coach-voice copy names WHY without leaking the resolver's internal,
    // explicitly non-runner-facing `driver.detail` string.
    expect(rec?.copy).toContain('gap in training');
    expect(rec?.copy).not.toContain('internal');
  });

  it('proceed_with_caution never fires a recommendation (refuses to tighten, per prescription-resolver.ts)', async () => {
    vi.mocked(resolveRunnerState).mockResolvedValue(stateWith('proceed_with_caution'));
    const rec = await composeStandingRecommendation({
      workoutId: WORKOUT_ID,
      userUuid: USER,
      workout: QUALITY_WORKOUT,
      brief: briefWithOneSoftSignal(),
    });
    expect(rec).toBeNull();
  });

  it('stop maps to push_back with no suggestion payload, not to ease_down', async () => {
    vi.mocked(resolveRunnerState).mockResolvedValue(stateWith('stop', 'training_gap'));
    const rec = await composeStandingRecommendation({
      workoutId: WORKOUT_ID,
      userUuid: USER,
      workout: QUALITY_WORKOUT,
      brief: briefWithOneSoftSignal(),
    });
    expect(rec?.kind).toBe('push_back');
    expect(rec?.suggestion).toBeNull();
  });

  it('a past workout still short-circuits before resolveRunnerState is ever called', async () => {
    vi.mocked(runnerToday).mockResolvedValue(TODAY);
    const rec = await composeStandingRecommendation({
      workoutId: WORKOUT_ID,
      userUuid: USER,
      workout: { ...QUALITY_WORKOUT, date_iso: '2026-09-01' },
      brief: briefWithOneSoftSignal(),
    });
    expect(rec).toBeNull();
    expect(resolveRunnerState).not.toHaveBeenCalled();
  });
});
