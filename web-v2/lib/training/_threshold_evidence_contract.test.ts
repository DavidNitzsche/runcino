/**
 * lib/training/_threshold_evidence_contract.test.ts — the evidence contract
 * between the Evidence Engine and the threshold pace corpus (2026-09-01).
 *
 * Every case here was FALSIFIED against the pre-contract code: an abandoned
 * phase priced the belief, an HR two band-widths out was the fastest
 * observation, one session displaced a K-th-best slot outright, and two
 * "slower than believed" observations lowered the bar. Each of those is an
 * assertion below that the old code fails.
 *
 * RULE 22 · what this file CANNOT fail on: it drives the pure classifier and
 * statistic with hand-built rows, so it cannot detect a loader that feeds the
 * wrong Evidence Engine verdict to a run, or a window loader that returns the
 * wrong dates — those are the audit test's job against production.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyThresholdCandidatesDetailed,
  thresholdPaceCorpus,
  thresholdSegmentFromPhases,
  THRESHOLD_MIN_SESSION_TOTAL_SEC,
  THRESHOLD_SESSION_DURATION_RAMP_SEC,
  THRESHOLD_HR_ABSENT_AUTHORITY,
  PRESCRIBED_WINDOW_AUTHORITY,
  THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI,
  fullAuthority,
  type CandidateRow,
  type HrContext,
  type PaceObservation,
  type ThresholdEvidenceVerdict,
} from '@/lib/training/pace-corpus';
import type { PhaseBreakdown } from '@/lib/coach/run-state';
import type { PrescribedWindow } from '@/lib/training/normal-window';

const LTHR = 168;
const ctx: HrContext = { maxHrBpm: 183, lthrBpm: LTHR, lthrFresh: true };

function phase(over: Partial<PhaseBreakdown> & { actual_duration_sec: number; actual_distance_mi: number }): PhaseBreakdown {
  return {
    index: 0, label: 'Interval', type: 'work',
    target_pace: null, target_pace_sec: null, tolerance_pace_sec: null,
    target_distance_mi: null, target_duration_sec: null,
    actual_pace: null, avg_hr: null, max_hr: null, avg_cadence: null,
    completed: true, status: null, verdict: null,
    ...over,
  } as PhaseBreakdown;
}

function row(over: Partial<CandidateRow> & { id: string; date: string }): CandidateRow {
  return {
    distanceMi: 8.5, finishSec: 4100, avgHr: 154, workoutTypeRaw: 'threshold', splits: null, phases: [],
    ...over,
  };
}

/** Four completed 1-mile reps at `pace` s/mi with the given avg HR. */
function fourByMile(pace: number, hr: number | null, completed = true): PhaseBreakdown[] {
  return [0, 1, 2, 3].map((i) => phase({
    index: i, actual_duration_sec: pace, actual_distance_mi: 1, avg_hr: hr, completed,
  }));
}

const evidence = (kind: ThresholdEvidenceVerdict['kind'], weight: number | null = 0.55, anchor = false): ThresholdEvidenceVerdict =>
  ({ kind, weight, anchorMoveCandidate: anchor });

describe('admission · what the Evidence Engine and the watch already know outranks the label', () => {
  it('an abandoned work phase is dropped from the pool, and a session whose only work was abandoned is EXCLUDED with the reason', () => {
    // The owner's 2026-08-06 shape: one work phase, completed:false, no HR.
    const r = row({ id: 'treadmill', date: '2026-08-06', workoutTypeRaw: 'tempo',
      phases: [phase({ actual_duration_sec: 1200, actual_distance_mi: 2.86, completed: false })] });
    const { observations, excluded } = classifyThresholdCandidatesDetailed([r], ctx);
    expect(observations).toHaveLength(0);
    expect(excluded).toEqual([expect.objectContaining({ id: 'treadmill', reason: 'WORK_PHASES_ABANDONED' })]);
    // and the reader itself refuses the abandoned phase
    expect(thresholdSegmentFromPhases(r.phases!, ctx)).toBeNull();
  });

  it('completed reps still count when a sibling rep was abandoned, and the observation says so', () => {
    const phases = [...fourByMile(425, 162), phase({ index: 4, actual_duration_sec: 300, actual_distance_mi: 0.7, avg_hr: 160, completed: false })];
    const { observations } = classifyThresholdCandidatesDetailed([row({ id: 'r', date: '2026-08-20', phases })], ctx);
    expect(observations).toHaveLength(1);
    expect(observations[0].completed).toBe(false);
    expect(observations[0].authority.reasons).toContain('ABANDONED_PHASES_DROPPED');
    expect(observations[0].durationSec).toBe(4 * 425);
  });

  it('HR more than one further half-width past the T band is EXCLUDED (the owner\'s 2026-07-16 interval day at 91% LTHR)', () => {
    const hr = Math.round(LTHR * 0.9126);
    const { observations, excluded } = classifyThresholdCandidatesDetailed(
      [row({ id: 'intervals', date: '2026-07-16', workoutTypeRaw: 'intervals', phases: fourByMile(408, hr) })], ctx);
    expect(observations).toHaveLength(0);
    expect(excluded[0]).toMatchObject({ id: 'intervals', reason: 'HR_OUTSIDE_THRESHOLD_BAND' });
  });

  it('RULE 9 · HR authority fades CONTINUOUSLY from the band edge to zero, never a step', () => {
    let prev = Number.NaN;
    let maxStep = 0;
    for (let pct = 0.985; pct >= 0.90; pct -= 0.0025) {
      const hr = LTHR * pct;
      const { observations } = classifyThresholdCandidatesDetailed(
        [row({ id: 'x', date: '2026-08-20', phases: fourByMile(430, hr) })], ctx);
      const w = observations[0]?.weight ?? 0;
      if (!Number.isNaN(prev)) {
        expect(w).toBeLessThanOrEqual(prev + 1e-9);
        maxStep = Math.max(maxStep, prev - w);
      }
      prev = w;
    }
    expect(maxStep).toBeLessThan(0.15);
    expect(prev).toBe(0);
  });

  it('a qualifying segment with NO heart rate is admitted at reduced authority, never as full corroboration', () => {
    const { observations } = classifyThresholdCandidatesDetailed(
      [row({ id: 'nohr', date: '2026-08-20', phases: fourByMile(430, null) })], ctx);
    expect(observations[0].weight).toBeCloseTo(THRESHOLD_HR_ABSENT_AUTHORITY * 0.75, 6); // × unavailable-EE factor
    expect(observations[0].authority.hr).toBe('absent');
    expect(observations[0].authority.reasons).toContain('HR_ABSENT_REDUCED_AUTHORITY');
  });

  it('RULE 9 · the session-duration floor ramps in over five minutes instead of vanishing at one second (08-04 vs 08-06: 1161 s vs 1200 s)', () => {
    // Two equal reps, so the pooled session total walks through the floor
    // while each rep stays inside doctrine's 5-20 minute per-rep window.
    const at = (sec: number) => classifyThresholdCandidatesDetailed(
      [row({ id: 'd', date: '2026-08-20', phases: [0, 1].map((i) => phase({ index: i, actual_duration_sec: sec / 2, actual_distance_mi: sec / 2 / 430, avg_hr: 163 })) })], ctx);
    const floor = THRESHOLD_MIN_SESSION_TOTAL_SEC - THRESHOLD_SESSION_DURATION_RAMP_SEC;
    expect(at(floor - 1).observations).toHaveLength(0);
    expect(at(floor - 1).excluded[0].reason).toBe('SESSION_BELOW_DURATION_FLOOR');
    let prev = 0;
    for (let sec = floor; sec <= THRESHOLD_MIN_SESSION_TOTAL_SEC + 60; sec += 15) {
      const w = at(sec).observations[0]?.weight ?? 0;
      expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(w - prev).toBeLessThan(0.1);
      prev = w;
    }
    expect(at(1161).observations[0].authority.durationFactor).toBeGreaterThan(0.8);
    expect(at(1161).observations[0].authority.reasons).toContain('SESSION_SHORT_OF_DOCTRINE_FLOOR');
  });

  it('the Evidence Engine\'s no_evidence verdict EXCLUDES a run whatever its label says', () => {
    const ev = new Map([['t', evidence('no_evidence', null)]]);
    const { observations, excluded } = classifyThresholdCandidatesDetailed(
      [row({ id: 't', date: '2026-08-20', workoutTypeRaw: 'tempo', phases: fourByMile(425, 163) })], ctx, { evidence: ev });
    expect(observations).toHaveLength(0);
    expect(excluded[0].reason).toBe('EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE');
  });

  it('observed physiology outranks the plan label: a LONG-labelled run is admitted ONLY off the Evidence Engine\'s own threshold_like segments', () => {
    const r = row({ id: 'long', date: '2026-08-30', workoutTypeRaw: 'long', phases: fourByMile(432, 164) });
    // no verdict → the label stands
    expect(classifyThresholdCandidatesDetailed([r], ctx).observations).toHaveLength(0);
    expect(classifyThresholdCandidatesDetailed([r], ctx, { evidence: new Map() }).excluded[0].reason)
      .toBe('LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE');
    // evidence but no segments → cannot be priced; the corpus's own HR-split
    // pooling is NOT used (it would price cardiac drift at easy pace as threshold)
    const bare = classifyThresholdCandidatesDetailed([r], ctx, { evidence: new Map([['long', evidence('evidence', 0.55)]]) });
    expect(bare.observations).toHaveLength(0);
    expect(bare.excluded[0].reason).toBe('LABEL_NON_QUALITY_UNPRICEABLE');
    // evidence WITH threshold_like segments → admitted, priced from them
    const withSegs: ThresholdEvidenceVerdict = { ...evidence('evidence', 0.55), segments: [
      { paceSecPerMi: 440, durationSec: 780, meanHrBpm: 163 },
      { paceSecPerMi: 436, durationSec: 1620, meanHrBpm: 166 },
    ] };
    const { observations } = classifyThresholdCandidatesDetailed([r], ctx, { evidence: new Map([['long', withSegs]]) });
    expect(observations).toHaveLength(1);
    expect(observations[0].source).toBe('evidence-segments');
    expect(observations[0].weight).toBe(1);
    expect(Math.round(observations[0].paceSecPerMi)).toBe(437);
    expect(observations[0].authority.reasons).toContain('PRICED_FROM_EVIDENCE_ENGINE_SEGMENTS');
  });

  it('the Evidence Engine weight scales authority, and a supporting-only session says it cannot move the anchor alone', () => {
    const r = row({ id: 'w', date: '2026-08-20', phases: fourByMile(430, 163) });
    const strong = classifyThresholdCandidatesDetailed([r], ctx, { evidence: new Map([['w', evidence('evidence', 0.55, false)]]) }).observations[0];
    const weak = classifyThresholdCandidatesDetailed([r], ctx, { evidence: new Map([['w', evidence('evidence', 0.275, false)]]) }).observations[0];
    expect(strong.weight).toBe(1);
    expect(weak.weight).toBeCloseTo(0.5, 6);
    expect(strong.authority.reasons).toContain('SUPPORTING_EVIDENCE_ONLY_NOT_ANCHOR_MOVER');
  });

  it('a session inside a prescribed window is admitted at reduced authority and marked non-representative (Rule 8)', () => {
    const windows: PrescribedWindow[] = [{ slug: 'afc', fromISO: '2026-08-02', toISO: '2026-08-30', raceDateISO: '2026-08-16', distanceMi: 13.1, priority: 'A' } as unknown as PrescribedWindow];
    const { observations } = classifyThresholdCandidatesDetailed(
      [row({ id: 'rec', date: '2026-08-23', phases: fourByMile(430, 163) })], ctx,
      { windows, evidence: new Map([['rec', evidence('evidence', 0.55)]]) });
    expect(observations[0].representative).toBe(false);
    expect(observations[0].weight).toBeCloseTo(PRESCRIBED_WINDOW_AUTHORITY, 6);
  });
});

function ob(id: string, date: string, pace: number, weight = 1, representative = true): PaceObservation {
  const base = fullAuthority();
  return { ...base, id, date, paceSecPerMi: pace, durationSec: 1800, source: 'phases',
    hrBasis: 'pct_lthr', hrPct: 0.98, hrBandDistance: 0.2, weight, representative };
}

describe('the weighted order statistic', () => {
  it('refuses when the summed authority is under K, even when the head count is not', () => {
    const r = thresholdPaceCorpus([ob('a', '2026-08-01', 420, 0.5), ob('b', '2026-08-02', 425, 0.5), ob('c', '2026-08-03', 430, 0.5)]);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('insufficient_corroboration'); expect(r.weightedSupport).toBeCloseTo(1.5, 6); }
  });

  it('with three full observations it is the K-th fastest, exactly as before', () => {
    const r = thresholdPaceCorpus([ob('a', '2026-08-01', 420), ob('b', '2026-08-02', 425), ob('c', '2026-08-03', 430)]);
    expect(r.ok && r.tPaceSecPerMi).toBe(430);
  });

  it('RULE 9 · an observation\'s weight moving 0 → 1 moves the level continuously, and only faster', () => {
    const fixed = [ob('a', '2026-07-01', 430), ob('b', '2026-07-05', 432), ob('c', '2026-07-10', 435)];
    let prev = Number.POSITIVE_INFINITY;
    let maxStep = 0;
    for (let w = 0; w <= 1.0001; w += 0.05) {
      const r = thresholdPaceCorpus([...fixed, ob('new', '2026-07-12', 415, w)]);
      expect(r.ok).toBe(true);
      const t = r.ok ? r.tPaceSecPerMi : NaN;
      expect(t).toBeLessThanOrEqual(prev + 1e-9);
      if (Number.isFinite(prev)) maxStep = Math.max(maxStep, prev - t);
      prev = t;
    }
    expect(maxStep).toBeLessThanOrEqual(2);
  });

  it('a non-representative supporting observation is counted and reported as such', () => {
    const r = thresholdPaceCorpus([ob('a', '2026-08-01', 420), ob('b', '2026-08-02', 425, 1, false), ob('c', '2026-08-03', 430)]);
    expect(r.ok && r.representativeSupporting).toBe(2);
  });
});

describe('the daily move cap · one session cannot rewrite the runner in a day', () => {
  // Two faster reads already in the corpus, so the newest fast session would
  // DISPLACE the third slot outright under the old head-count statistic
  // (430 → 419, the 2026-09-01 shape).
  const prior = [ob('a', '2026-07-07', 412), ob('b', '2026-07-12', 419), ob('c', '2026-07-25', 430), ob('d', '2026-08-01', 440)];

  it('caps the newest session\'s move to the convention per elapsed day, and reports the uncapped read', () => {
    const r = thresholdPaceCorpus([...prior, ob('new', '2026-09-01', 405)], 3, { todayISO: '2026-09-01' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.moveCap.applied).toBe(true);
    expect(r.moveCap.priorSecPerMi).toBe(430);
    expect(r.moveCap.allowedSecPerMi).toBe(THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI);
    expect(r.tPaceSecPerMi).toBe(430 - THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI);
    expect(r.moveCap.uncappedSecPerMi).toBeLessThan(r.tPaceSecPerMi);
  });

  it('the same session is allowed twice the move the day after — the belief converges over days, it is not frozen', () => {
    const d0 = thresholdPaceCorpus([...prior, ob('new', '2026-09-01', 405)], 3, { todayISO: '2026-09-01' });
    const d1 = thresholdPaceCorpus([...prior, ob('new', '2026-09-01', 405)], 3, { todayISO: '2026-09-02' });
    const d9 = thresholdPaceCorpus([...prior, ob('new', '2026-09-01', 405)], 3, { todayISO: '2026-09-10' });
    expect(d0.ok && d1.ok && d9.ok).toBe(true);
    if (!(d0.ok && d1.ok && d9.ok)) return;
    expect(d1.tPaceSecPerMi).toBeLessThan(d0.tPaceSecPerMi);
    expect(d9.moveCap.applied).toBe(false);
    expect(d9.tPaceSecPerMi).toBe(d9.moveCap.uncappedSecPerMi);
  });

  it('the FIRST corroboration is never capped against nothing', () => {
    const r = thresholdPaceCorpus([ob('a', '2026-08-01', 420), ob('b', '2026-08-02', 425), ob('c', '2026-09-01', 430)], 3, { todayISO: '2026-09-01' });
    expect(r.ok && r.moveCap.applied).toBe(false);
    expect(r.ok && r.moveCap.priorSecPerMi).toBeNull();
  });

  it('a small move under the cap is untouched', () => {
    const r = thresholdPaceCorpus([...prior, ob('new', '2026-09-01', 432)], 3, { todayISO: '2026-09-01' });
    expect(r.ok && r.moveCap.applied).toBe(false);
  });
});

describe('the owner\'s real 2026-09-01 shape, end to end through the pure layer', () => {
  it('excludes 07-16 (HR out of band) and 08-06 (abandoned), admits 09-01 at full authority, and caps its first-day move', () => {
    const rows: CandidateRow[] = [
      row({ id: '0716', date: '2026-07-16', workoutTypeRaw: 'intervals', phases: fourByMile(408, Math.round(LTHR * 0.9126)) }),
      row({ id: '0707', date: '2026-07-07', workoutTypeRaw: 'tempo', phases: [0, 1].map((i) => phase({ index: i, actual_duration_sec: 1077, actual_distance_mi: 1077 / 429.5, avg_hr: Math.round(LTHR * 0.978) })) }),
      row({ id: '0712', date: '2026-07-12', workoutTypeRaw: 'tempo', phases: [0, 1].map((i) => phase({ index: i, actual_duration_sec: 900, actual_distance_mi: 900 / 434, avg_hr: 163 })) }),
      row({ id: '0721', date: '2026-07-21', workoutTypeRaw: 'tempo', phases: [0, 1].map((i) => phase({ index: i, actual_duration_sec: 1000, actual_distance_mi: 1000 / 451, avg_hr: 165 })) }),
      row({ id: '0806', date: '2026-08-06', workoutTypeRaw: 'tempo', phases: [phase({ actual_duration_sec: 1200, actual_distance_mi: 2.86, completed: false })] }),
      row({ id: '0714', date: '2026-07-14', workoutTypeRaw: 'tempo', phases: [phase({ actual_duration_sec: 870, actual_distance_mi: 2, avg_hr: Math.round(LTHR * 0.934) })] }),
      row({ id: '0901', date: '2026-09-01', workoutTypeRaw: 'threshold', phases: [
        phase({ index: 1, actual_duration_sec: 424, actual_distance_mi: 1.01, avg_hr: 158 }),
        phase({ index: 3, actual_duration_sec: 431, actual_distance_mi: 1.01, avg_hr: 161 }),
        phase({ index: 5, actual_duration_sec: 423, actual_distance_mi: 1.00, avg_hr: 164 }),
        phase({ index: 7, actual_duration_sec: 422, actual_distance_mi: 1.01, avg_hr: 166 }),
      ] }),
    ];
    const ev = new Map<string, ThresholdEvidenceVerdict>([
      ['0716', evidence('no_evidence', null)],
      ['0707', evidence('evidence', 0.55)],
      ['0712', evidence('evidence', 0.55)],
      ['0806', evidence('no_evidence', null)],
      ['0714', evidence('evidence', 0.4)],
      ['0721', evidence('evidence', 0.55)],
      ['0901', evidence('evidence', 0.55, false)],
    ]);
    const { observations, excluded } = classifyThresholdCandidatesDetailed(rows, ctx, { evidence: ev, windows: [] });
    // 0716 · HR two band-widths out · 0806 · abandoned · 0714 · a 14.5-minute
    // pooled phase read is under the ramp floor (its real-data twin came in via
    // the splits reader, which this fixture does not carry).
    expect(excluded.map((e) => e.id).sort()).toEqual(['0714', '0716', '0806']);
    expect(excluded.find((e) => e.id === '0716')!.reason).toBe('EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE');
    expect(excluded.find((e) => e.id === '0806')!.reason).toBe('EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE');
    const ids = observations.map((o) => o.id).sort();
    expect(ids).toEqual(['0707', '0712', '0721', '0901']);
    const s0901 = observations.find((o) => o.id === '0901')!;
    expect(s0901.weight).toBe(1);
    expect(s0901.authority.reasons).toContain('SUPPORTING_EVIDENCE_ONLY_NOT_ANCHOR_MOVER');

    const read = thresholdPaceCorpus(observations, 3, { todayISO: '2026-09-01', excluded });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // The session is genuinely the second-fastest read; it may move the level,
    // but the first-day move is bounded by the convention.
    expect(read.moveCap.applied).toBe(true);
    expect(read.moveCap.priorSecPerMi! - read.tPaceSecPerMi).toBeLessThanOrEqual(THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI);
    expect(read.moveCap.priorSecPerMi).toBe(451);   // third-fastest before 09-01 arrived
    expect(read.moveCap.uncappedSecPerMi).toBe(434); // where the head-count statistic would have jumped in one day
    expect(read.tPaceSecPerMi).toBe(446);
    expect(read.excluded).toHaveLength(3);
  });
});
