/**
 * lib/adaptation/_adaptation_engine.test.ts · the Adaptation Engine's gate.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22, stated before the tests) ────────
 *
 *   · WRONG MAGNITUDES. Every scenario asserts a DECISION and a LEVER. The
 *     numeric step is only bounded (never past a doctrine cap, never backwards).
 *     A +3 mi week where +1 was right passes every test in this file.
 *   · BAD UPSTREAM EVIDENCE. `executionQuality` is taken on trust from
 *     `activity-evidence.ts`. If that classifier calls a destroyed session
 *     controlled, this engine proposes an upward pace move and nothing here can
 *     tell.
 *   · WHETHER A PROPOSAL IS GOOD COACHING. Only whether it is doctrinally legal.
 *     `_adaptation_engine.audit.test.ts` renders the real answers for a human.
 *   · A LEVER NOBODY WIRED. DENSITY refuses when no plan row carries a
 *     progression block — the production reality today — and a refusal that
 *     reads correctly is not a mechanism that works.
 *
 * ── AND WHAT IT DELIBERATELY DOES CHECK, BECAUSE THE ENGINE'S HISTORY SAYS SO ─
 *
 * CLAUDE.md Rule 22 measured this repo's own test bias: 29 files exercise HOLD
 * and 1 exercises BACK_OFF; 2 exercise ACCELERATE. A gate written by the same
 * instinct as the engine passes an engine that can only refuse. So the last
 * describe block COUNTS THE SCENARIOS IN THIS FILE and fails if the upward
 * cases are outnumbered by the downward ones.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  NON_MOVING_DECISIONS,
  PACE_PROGRESS_MIN_SESSIONS,
  PROGRESS_LEVER_ORDER,
  composeAdaptation,
  contradictionsIn,
  sessionDemonstratesControl,
  densityRefusalFor,
  type AdaptationEngineInput,
  type AdaptationProposalSet,
  type DensityGateState,
  type EvidenceLookback,
  type QualitySessionRead,
} from './adaptation-engine';
import type { AdaptationVerdict } from './adaptation-model';
import type { ProgressionResolution } from '@/lib/plan/progression-pass';
import type { RunnerState, StateDecision } from '@/lib/training/runner-state';
import type { ResolvedCapacity } from '@/lib/training/prescription-resolver';

const TODAY = '2026-08-31';

/* ── FIXTURES · every one is a plain value, so every branch is falsifiable
 *    without a database (Rule 18) ─────────────────────────────────────────── */

const capacityAt = (
  thresholdSecPerMi: number,
  opts: { sourceMode?: ResolvedCapacity['threshold']['sourceMode']; confidence?: number } = {},
): ResolvedCapacity => ({
  threshold: {
    paceSecPerMi: thresholdSecPerMi,
    vdot: 50,
    confidence: opts.confidence ?? 0.8,
    sourceMode: opts.sourceMode ?? 'direct',
    evidenceIds: ['cap-1', 'cap-2', 'cap-3'],
    resolvedAt: `${TODAY}T00:00:00Z`,
    reasons: ['DIRECT_CORROBORATED_THRESHOLD_EVIDENCE'],
    modelVersion: '1.0.0',
  },
  highIntensity: {
    intervalPaceSecPerMi: thresholdSecPerMi - 25,
    repetitionPaceSecPerMi: thresholdSecPerMi - 45,
    vdot: 50, confidence: 0.6, sourceMode: 'vdot_fallback', evidenceIds: [],
    resolvedAt: `${TODAY}T00:00:00Z`, reasons: [], modelVersion: '1.0.0',
  },
  easyCeiling: {
    ceilingSecPerMi: thresholdSecPerMi + 90,
    confidence: 0.7, sourceMode: 'direct', evidenceIds: [],
    resolvedAt: `${TODAY}T00:00:00Z`, reasons: [], modelVersion: '1.0.0',
  },
  durability: {
    enduranceExponent: 1.06,
    raceExponent: { present: false, reason: 'no_race_exponent_evidence', observations: 0 },
    decoupling: { present: false, reason: 'no_decoupling_corroboration', observations: 0 },
    confidence: 0.4, sourceMode: 'population_prior', evidenceIds: [],
    resolvedAt: `${TODAY}T00:00:00Z`, reasons: [], modelVersion: '1.0.0',
  },
});

const stateAt = (decision: StateDecision, readable = true): RunnerState => ({
  decision,
  driver: decision === 'proceed' ? null : {
    kind: 'convergence', argues: decision, driving: true,
    detail: `convergence argues ${decision}`, evidence: {},
  },
  signals: [], readable, todayISO: TODAY,
  resolvedAt: `${TODAY}T00:00:00Z`, modelVersion: '1.0.0',
});

/**
 * MIRRORS `classifyAdaptation`'s own band → decision mapping, exactly.
 *
 * The first draft mapped `normal` to STAY, which the shipped model does not —
 * it returns PROGRESS for both `strong` AND `normal`. A fixture that disagrees
 * with the model it stands in for tests a system nobody ships, so the mapping
 * is asserted against the real classifier in its own test below rather than
 * left to match by eye.
 */
const DECISION_FOR_BAND: Record<AdaptationVerdict['band'], AdaptationVerdict['decision']> = {
  strong: 'PROGRESS',
  normal: 'PROGRESS',
  marginal: 'STAY',
  poor: 'MODIFY',
};

const absorptionAt = (
  band: AdaptationVerdict['band'],
  opts: { veto?: AdaptationVerdict['veto'] } = {},
): AdaptationVerdict => ({
  band,
  confidence: 'high',
  decision: opts.veto ? 'PROTECT' : DECISION_FOR_BAND[band],
  stepMultiplier: band === 'strong' ? 1.25 : band === 'normal' ? 1 : band === 'marginal' ? 0 : -0.5,
  dimensions: [],
  veto: opts.veto ?? null,
  summary: `absorption reads ${band}`,
});

const session = (
  dateISO: string,
  overrides: Partial<QualitySessionRead> = {},
): QualitySessionRead => ({
  activityId: `run-${dateISO}`,
  dateISO,
  capacity: 'threshold',
  weight: 0.5,
  anchorMoveCandidate: true,
  executionQuality: 'controlled',
  lateRunPacingCollapse: false,
  internalCostMagnitude: 'minimal',
  internalCostWithinNormalBand: true,
  ...overrides,
});

const controlledSessions = (n: number): QualitySessionRead[] =>
  Array.from({ length: n }, (_, i) => session(`2026-08-${String(28 - i * 3).padStart(2, '0')}`));

/** A `ProgressionResolution` that grew the session, as the gate would return. */
const denserResolution = (): ProgressionResolution => ({
  workoutId: 'pw-1',
  dateISO: '2026-09-02',
  family: 'threshold',
  action: 'ACCELERATE',
  shape: { reps: 4, repMinutes: 10, recoveryMinutes: 2, paceSPerMi: 400, zone: 'PROGRESSIVE' },
  authored: { reps: 4, repMinutes: 8, recoveryMinutes: 3, paceSPerMi: 400, zone: 'ESTABLISHED' },
  authoredLever: 'quality_duration',
  lever: 'work_density',
  why: 'Absorbing the block well. Same pace, less recovery.',
  changed: true,
});

const heldResolution = (): ProgressionResolution => ({
  ...denserResolution(),
  action: 'HOLD',
  shape: { reps: 4, repMinutes: 8, recoveryMinutes: 3, paceSPerMi: 400, zone: 'ESTABLISHED' },
  lever: null,
  why: 'Repeating last week. The step is deferred, not cancelled.',
  changed: false,
});

/** The neutral world: nothing earned, nothing wrong. Scenarios override. */
/** A lookback that never had to reach back. The common path, and the one the
 *  whole extension is a no-op on. */
const freshLookback = (): EvidenceLookback => ({
  baseWindowDays: 28,
  windowDays: 28,
  representativeDays: 28,
  excludedDays: 0,
  stalenessFactor: 1,
  reachedOuterBound: false,
});

/** A lookback that had to reach past a prescribed block, and paid for it. */
const extendedLookback = (stalenessFactor = 0.5): EvidenceLookback => ({
  baseWindowDays: 28,
  windowDays: 60,
  representativeDays: 32,
  excludedDays: 29,
  stalenessFactor,
  reachedOuterBound: false,
});

const baseInput = (): AdaptationEngineInput => ({
  todayISO: TODAY,
  capacity: capacityAt(400),
  state: stateAt('proceed'),
  absorption: absorptionAt('normal'),
  pace: {
    phases: [{
      phaseLabel: null, prescribedSecPerMi: 400, rowCount: 1,
      firstDateISO: '2026-09-01', lastDateISO: '2026-09-01',
    }],
    sessions: [],
    lookback: freshLookback(),
  },
  load: {
    currentWeeklyMi: 45,
    // 1.1.0 · the neutral world is a PROGRESSION week with two quality days.
    weekAhead: { readable: true, takesProgressionStep: true },
    qualitySessionsWeekAhead: 2,
    recentWeeks: [
      { weekStartISO: '2026-08-24', completedMi: 20, scheduledMi: 45 },
      { weekStartISO: '2026-08-17', completedMi: 20, scheduledMi: 45 },
    ],
    historicalTolerance: { ok: true, sustainedWeeklyMi: 44, representativeDays: 84, oldestISO: '2026-06-02' },
    tierWeeklyUpperMi: 70,
  },
  longRun: {
    prescribedLongMi: 16, longRunCapMi: 22, longRunWoWMaxFraction: 0.30,
    weekAhead: { readable: true, takesProgressionStep: true },
    recent: [], lookback: freshLookback(),
  },
  density: { resolutions: [], gate: 'NO_AUTHORED_PROGRESSION_BLOCK' },
  schedule: { sessionsOutOfPlace: 0, clearSlotsAvailable: 0 },
  readable: true,
});

const withAbsorbedLoad = (i: AdaptationEngineInput): AdaptationEngineInput => ({
  ...i,
  load: {
    ...i.load,
    recentWeeks: [
      { weekStartISO: '2026-08-24', completedMi: 45, scheduledMi: 45 },
      { weekStartISO: '2026-08-17', completedMi: 44, scheduledMi: 45 },
      { weekStartISO: '2026-08-10', completedMi: 43, scheduledMi: 45 },
    ],
  },
});

const decisions = (set: AdaptationProposalSet) => set.proposals.map((p) => `${p.decision}:${p.target}`);
const primaryProgress = (set: AdaptationProposalSet) =>
  set.proposals.find((p) => p.decision === 'PROGRESS') ?? null;

/* ══════════════════════════════════════════════════════════════════════════
 * SCENARIO:PROGRESS — the reachability half Rule 21 is about
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ADAPTATION ENGINE · PROGRESS is genuinely reachable, on all four levers', () => {
  it('SCENARIO:PROGRESS · PACE · repeated CONTROLLED sessions and capacity ahead of the plan', () => {
    const i = baseInput();
    i.capacity = capacityAt(388); // 12 s/mi faster than the prescribed 400
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    // Every other lever silenced so PACE is the only candidate — otherwise the
    // one-stressor rule promotes the cheaper lever and this asserts nothing.
    const set = composeAdaptation(i);
    const p = primaryProgress(set);
    expect(p?.target).toBe('PACE');
    expect(p?.domain).toBe('FITNESS');
    expect(p?.previous).toEqual({ unit: 'sec_per_mi', value: 400 });
    expect((p?.proposed as { value: number }).value).toBeLessThan(400);
    expect(p?.reasonCodes).toContain('REPEATED_CONTROLLED_QUALITY_EXECUTION');
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('PART 1 (2026-09-01 decision) · PACE moves each phase by its OWN delta, never a blended average', () => {
    // The owner's real shape: three phases at 435 / 424 / 475 s/mi (QUALITY,
    // RACE-SPECIFIC, TAPER). The pre-fix engine would have blended these to
    // 438 and moved every future row by one shared step off that number.
    const i = baseInput();
    i.capacity = capacityAt(430); // believed threshold capacity
    i.pace.phases = [
      { phaseLabel: 'QUALITY', prescribedSecPerMi: 435, rowCount: 6, firstDateISO: '2026-09-01', lastDateISO: '2026-10-13' },
      { phaseLabel: 'RACE-SPECIFIC', prescribedSecPerMi: 424, rowCount: 4, firstDateISO: '2026-10-20', lastDateISO: '2026-11-13' },
      { phaseLabel: 'TAPER', prescribedSecPerMi: 475, rowCount: 2, firstDateISO: '2026-11-17', lastDateISO: '2026-11-24' },
    ];
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const p = primaryProgress(set);
    expect(p?.target).toBe('PACE');
    if (p?.target !== 'PACE') throw new Error('unreachable');

    // No blended 438 anywhere. Each phase is judged against its OWN number.
    const byLabel = Object.fromEntries(p.phaseBreakdown.map((b) => [b.phaseLabel, b]));
    // QUALITY (435) clears the +5s/mi minimum against believed 430 → moves.
    expect(byLabel.QUALITY?.moved).toBe(true);
    expect(byLabel.QUALITY?.previousSecPerMi).toBe(435);
    expect(byLabel.QUALITY?.proposedSecPerMi).toBeLessThan(435);
    // RACE-SPECIFIC (424) is already FASTER than believed capacity (430) —
    // negative gain, held, never dragged along by QUALITY's move.
    expect(byLabel['RACE-SPECIFIC']?.moved).toBe(false);
    expect(byLabel['RACE-SPECIFIC']?.proposedSecPerMi).toBe(424);
    // TAPER (475) is a deliberately slow phase; its own gain clears the step
    // too (it is far from believed capacity), but the step is CLAMPED to the
    // doctrinal quantum, not applied as a blended-average nudge.
    expect(byLabel.TAPER?.stepSecPerMi).toBeLessThan(475 - 430);
    // The headline previous/proposed is the SOONEST moving phase (QUALITY),
    // never the three-phase average of 438.
    expect(p.previous).toEqual({ unit: 'sec_per_mi', value: 435 });
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('PART 1 · a PACE proposal with only phases already ahead of capacity holds, per phase', () => {
    const i = baseInput();
    i.capacity = capacityAt(430);
    i.pace.phases = [
      { phaseLabel: 'RACE-SPECIFIC', prescribedSecPerMi: 424, rowCount: 4, firstDateISO: '2026-10-20', lastDateISO: '2026-11-13' },
    ];
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const p = set.proposals.find((x) => x.target === 'PACE');
    expect(p?.decision).not.toBe('PROGRESS');
    expect(NON_MOVING_DECISIONS.has(p!.decision)).toBe(true);
    if (p?.target === 'PACE') {
      expect(p.phaseBreakdown.every((b) => !b.moved)).toBe(true);
    }
  });

  it('SCENARIO:PROGRESS · VOLUME · load absorbed for the required weeks, headroom in the band', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    const set = composeAdaptation(i);
    const p = primaryProgress(set);
    expect(p?.target).toBe('VOLUME');
    expect(p?.domain).toBe('LOAD');
    expect((p?.proposed as { value: number }).value).toBeGreaterThan(45);
    expect(p?.reasonCodes).toContain('RECENT_LOAD_ABSORBED');
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('SCENARIO:PROGRESS · DURATION · the last long run finished under control', () => {
    const i = baseInput();
    i.longRun.recent = [{
      activityId: 'long-1', dateISO: '2026-08-29', distanceMi: 16,
      durabilityEvidence: true, lateRunPacingCollapse: false,
      residualCardiovascularLoad: false, executionQuality: 'controlled',
    }];
    const set = composeAdaptation(i);
    const p = primaryProgress(set);
    expect(p?.target).toBe('DURATION');
    expect((p?.proposed as { value: number }).value).toBeGreaterThan(16);
    expect(p?.reasonCodes).toContain('LONG_RUN_TOLERATED_WITHOUT_COLLAPSE');
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('SCENARIO:PROGRESS · DENSITY · the gate shortened recovery on the same work', () => {
    const i = baseInput();
    i.density = { resolutions: [denserResolution()], gate: 'RESOLVED' };
    const set = composeAdaptation(i);
    const p = primaryProgress(set);
    expect(p?.target).toBe('DENSITY');
    expect(p?.reasonCodes).toContain('PROGRESSION_GATE_RESOLVED_A_DENSER_SESSION');
    // The gate's own resolution is CARRIED, not re-decided.
    expect(p && 'resolution' in p ? p.resolution.action : null).toBe('ACCELERATE');
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('SCENARIO:PROGRESS · QUALITY_VOLUME · the gate added work rather than packing it tighter', () => {
    // The Brain Constitution lists DENSITY and QUALITY_VOLUME as separate
    // targets, and doctrine draws the same line: more reps is a different claim
    // from the same reps with less rest. The split reads the progression gate's
    // OWN lever rather than guessing from the shape.
    const i = baseInput();
    i.density = {
      resolutions: [{ ...denserResolution(), lever: 'rep_count' }],
      gate: 'RESOLVED',
    };
    const set = composeAdaptation(i);
    const p = primaryProgress(set);
    expect(p?.target).toBe('QUALITY_VOLUME');
    expect(p?.domain).toBe('FITNESS');
    expect(p?.previous.unit).toBe('quality_minutes');
    expect(p?.reasonCodes).toContain('PROGRESSION_GATE_RESOLVED_MORE_QUALITY_WORK');
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('the two session levers are named off the gate\'s lever, never guessed', async () => {
    const { targetForProgressionLever } = await import('./adaptation-engine');
    expect(targetForProgressionLever('recovery_duration')).toBe('DENSITY');
    expect(targetForProgressionLever('work_density')).toBe('DENSITY');
    expect(targetForProgressionLever('rep_count')).toBe('QUALITY_VOLUME');
    expect(targetForProgressionLever('quality_duration')).toBe('QUALITY_VOLUME');
    expect(targetForProgressionLever('interval_duration')).toBe('QUALITY_VOLUME');
    // A lever owned by ANOTHER target is not quietly filed under a session one.
    expect(targetForProgressionLever('weekly_volume')).toBeNull();
    expect(targetForProgressionLever('long_run_duration')).toBeNull();
    expect(targetForProgressionLever('pace')).toBeNull();
    expect(targetForProgressionLever(null)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SCENARIO:HOLD / SCENARIO:REDUCE / SCENARIO:RESTRUCTURE — the other three
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ADAPTATION ENGINE · HOLD, REDUCE and RESTRUCTURE are all reachable', () => {
  it('SCENARIO:HOLD · nothing earned · nothing moves, and every lever says why', () => {
    const set = composeAdaptation(baseInput());
    // HOLD and INSUFFICIENT_EVIDENCE both leave the number where it is, and
    // they are DIFFERENT ANSWERS — the set may hold both and may hold nothing
    // that moves.
    expect(set.proposals.every((p) => NON_MOVING_DECISIONS.has(p.decision))).toBe(true);
    expect(set.proposals.every((p) => p.reasonCodes.length > 0)).toBe(true);
    expect(set.proposals.length).toBeGreaterThan(0);
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('SCENARIO:HOLD · PACE · evidence present but one session short of corroboration', () => {
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS - 1);
    const set = composeAdaptation(i);
    const hold = set.proposals.find((p) => p.target === 'PACE');
    // Two controlled sessions and nothing arguing against them is NOT a finding
    // that the pace should stay — it is one session short of knowing.
    expect(hold?.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(hold?.reasonCodes).toContain('SINGLE_STRONG_SESSION_IS_NOT_CORROBORATION');
    // A HOLD names what is missing rather than going silent — the Rule 21
    // failure mode is a lever that can only ever fail to fire, invisibly.
    expect(hold?.previous).toEqual(hold?.proposed);
  });

  it('SCENARIO:REDUCE · state says reduce · a SAFETY-domain recovery proposal', () => {
    const i = baseInput();
    i.state = stateAt('reduce');
    const set = composeAdaptation(i);
    const reduce = set.proposals.find((p) => p.decision === 'REDUCE');
    expect(reduce?.target).toBe('RECOVERY');
    expect(reduce?.domain).toBe('SAFETY');
    expect(reduce?.reasonCodes).toContain('STATE_SAYS_TODAY_IS_NOT_THE_DAY');
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('SCENARIO:REDUCE · an absorption VETO reduces and names safety', () => {
    const i = baseInput();
    i.absorption = absorptionAt('poor', { veto: 'injury_active' });
    const set = composeAdaptation(i);
    const reduce = set.proposals.find((p) => p.decision === 'REDUCE');
    expect(reduce).toBeTruthy();
    expect(reduce?.reasonCodes).toContain('SAFETY_OVERRIDES_NORMAL_PROGRESSION');
  });

  it('SCENARIO:RESTRUCTURE · SCHEDULE · sessions out of place with clear slots to take them', () => {
    const i = baseInput();
    i.schedule = { sessionsOutOfPlace: 2, clearSlotsAvailable: 3 };
    const set = composeAdaptation(i);
    const r = set.proposals.find((p) => p.decision === 'RESTRUCTURE');
    expect(r?.target).toBe('SCHEDULE');
    expect(r?.domain).toBe('SCHEDULE');
    expect(r?.reasonCodes).toContain('SESSIONS_OUT_OF_PLACE');
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('SCENARIO:RESTRUCTURE · TYPE · marginal absorption changes the kind of stress, not the amount', () => {
    const i = baseInput();
    i.absorption = absorptionAt('marginal');
    const set = composeAdaptation(i);
    const r = set.proposals.find((p) => p.decision === 'RESTRUCTURE');
    expect(r?.target).toBe('SPECIFICITY');
    expect(r?.reasonCodes).toContain('STIMULUS_TYPE_CHANGED_RATHER_THAN_REDUCED');
  });

  it('all four ACTING decisions are reachable from the same fixture family', () => {
    // The fifth, INSUFFICIENT_EVIDENCE, has its own block below: it is a
    // refusal rather than an act, and mixing it in here would let a suite that
    // only ever refuses look complete.
    const seen = new Set<string>();
    const scenarios: AdaptationEngineInput[] = [
      (() => { const i = withAbsorbedLoad(baseInput()); i.absorption = absorptionAt('strong'); return i; })(),
      baseInput(),
      (() => { const i = baseInput(); i.state = stateAt('recover'); return i; })(),
      (() => { const i = baseInput(); i.schedule = { sessionsOutOfPlace: 1, clearSlotsAvailable: 1 }; return i; })(),
    ];
    for (const s of scenarios) {
      for (const p of composeAdaptation(s).proposals) seen.add(p.decision);
    }
    for (const d of ['HOLD', 'PROGRESS', 'REDUCE', 'RESTRUCTURE']) expect([...seen]).toContain(d);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE DOCTRINE SUITE (§11)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ADAPTATION ENGINE · doctrine · GOAL POISONING', () => {
  it('the input type has no goal field · adding one is a build error, not a test failure', () => {
    // §6 is enforced by `_NoGoalInInput` in the module itself. This asserts the
    // runtime shape agrees, so a cast at a call site cannot smuggle one in
    // unnoticed.
    const keys = Object.keys(baseInput()).sort();
    expect(keys).toEqual([
      'absorption', 'capacity', 'density', 'load', 'longRun', 'pace', 'readable', 'schedule', 'state', 'todayISO',
    ]);
    expect(keys.some((k) => /goal|target.?time|aspir/i.test(k))).toBe(false);
  });

  it('a faster PRESCRIPTION with no capacity behind it produces no PACE progression', () => {
    // The goal-poisoning shape in this engine's units: something has written an
    // ambitious pace onto the plan. Capacity has not moved. The engine must
    // read the gap as "the plan is ahead of the runner", never as evidence.
    const i = baseInput();
    i.capacity = capacityAt(420); // capacity is SLOWER than the 400 prescribed
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    expect(set.proposals.find((p) => p.target === 'PACE')?.decision).not.toBe('PROGRESS');
  });
});

describe('ADAPTATION ENGINE · doctrine · SINGLE-RUN RESISTANCE', () => {
  it('one exceptional session does not move pace', () => {
    const i = baseInput();
    i.capacity = capacityAt(370);
    i.pace.sessions = [session('2026-08-30', { weight: 0.95 })];
    const set = composeAdaptation(i);
    const p = set.proposals.find((x) => x.target === 'PACE');
    expect(p?.decision).not.toBe('PROGRESS');
    expect(NON_MOVING_DECISIONS.has(p!.decision)).toBe(true);
    expect(p?.reasonCodes).toContain('SINGLE_STRONG_SESSION_IS_NOT_CORROBORATION');
  });

  it('the corroboration bar is the app\'s existing one, not a new number', async () => {
    const { CORROBORATION_MIN_OBSERVATIONS } = await import('@/lib/training/vdot-corpus');
    expect(PACE_PROGRESS_MIN_SESSIONS).toBe(CORROBORATION_MIN_OBSERVATIONS);
  });
});

describe('ADAPTATION ENGINE · doctrine · CONTROL · the Example A vs Example B test', () => {
  it('Example A · consistent, controlled, no collapse → counts', () => {
    expect(sessionDemonstratesControl(session('2026-08-30', {
      executionQuality: 'controlled', lateRunPacingCollapse: false,
    }))).toBe(true);
  });

  it('Example B · beat the target and fell apart → does NOT count', () => {
    expect(sessionDemonstratesControl(session('2026-08-30', {
      executionQuality: 'variable', lateRunPacingCollapse: true, weight: 0.95,
    }))).toBe(false);
  });

  it('THREE beaten-but-uncontrolled sessions still produce no PACE progression', () => {
    // THE headline doctrine case. Three sessions is corroboration by count and
    // must not be corroboration by evidence: "not evidence threshold should get
    // faster; may suggest poor execution instead."
    const i = baseInput();
    i.capacity = capacityAt(370);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS).map((s) => ({
      ...s, executionQuality: 'variable' as const, lateRunPacingCollapse: true, weight: 0.9,
    }));
    const set = composeAdaptation(i);
    const p = set.proposals.find((x) => x.target === 'PACE');
    expect(p?.decision).toBe('HOLD');
    expect(p?.reasonCodes).toContain('EXECUTION_BEAT_TARGET_WITHOUT_CONTROL');
    expect(p?.reasonCodes).toContain('LATE_SESSION_DETERIORATION');
  });

  it('`indeterminate` control does not count either · Rule 11, not conservatism', () => {
    expect(sessionDemonstratesControl(session('2026-08-30', {
      executionQuality: 'indeterminate', lateRunPacingCollapse: null,
    }))).toBe(false);
  });

  it('a long run that collapsed late does not grow the long run', () => {
    const i = baseInput();
    i.longRun.recent = [{
      activityId: 'long-1', dateISO: '2026-08-29', distanceMi: 16,
      durabilityEvidence: true, lateRunPacingCollapse: true,
      residualCardiovascularLoad: true, executionQuality: 'variable',
    }];
    const set = composeAdaptation(i);
    const p = set.proposals.find((x) => x.target === 'DURATION');
    expect(p?.decision).toBe('HOLD');
    expect(p?.reasonCodes).toContain('LONG_RUN_SHOWED_LATE_COLLAPSE');
  });
});

describe('ADAPTATION ENGINE · doctrine · ONE PRIMARY STRESSOR AT A TIME', () => {
  it('evidence for FOUR levers produces four proposals, ranked · never one compound', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    i.longRun.recent = [{
      activityId: 'long-1', dateISO: '2026-08-29', distanceMi: 16,
      durabilityEvidence: true, lateRunPacingCollapse: false,
      residualCardiovascularLoad: false, executionQuality: 'controlled',
    }];
    i.density = { resolutions: [denserResolution()], gate: 'RESOLVED' };

    const set = composeAdaptation(i);
    const promoted = set.proposals.filter((p) => p.decision === 'PROGRESS');
    expect(promoted).toHaveLength(1);
    expect(set.deferred).toHaveLength(3);
    expect(set.deferred.every((d) => d.decision === 'PROGRESS')).toBe(true);
    // Each proposal names exactly ONE lever. A compound proposal is not
    // expressible: `target` is a single field on every arm of the union.
    for (const p of [...set.proposals, ...set.deferred]) {
      expect(typeof p.target).toBe('string');
    }
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('the promoted lever is the SMALLEST USEFUL one · density before pace', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    i.density = { resolutions: [denserResolution()], gate: 'RESOLVED' };
    const set = composeAdaptation(i);
    expect(primaryProgress(set)?.target).toBe('DENSITY');
    expect(PROGRESS_LEVER_ORDER.indexOf('DENSITY'))
      .toBeLessThan(PROGRESS_LEVER_ORDER.indexOf('PACE'));
  });

  it('the promoted proposal names the alternatives it beat · why AND why-not', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const p = primaryProgress(set);
    expect(p?.whyNot.length).toBeGreaterThan(0);
    expect(p?.whyNot.every((w) => w.reasonCodes.length > 0)).toBe(true);
  });
});

describe('ADAPTATION ENGINE · doctrine · ADAPT THE THING THAT CHANGED (BRIEF 07)', () => {
  it('a missed Wednesday touches SCHEDULE and nothing in FITNESS', () => {
    const i = baseInput();
    i.schedule = { sessionsOutOfPlace: 2, clearSlotsAvailable: 2 };
    const set = composeAdaptation(i);
    const r = set.proposals.find((p) => p.decision === 'RESTRUCTURE');
    expect(r?.domain).toBe('SCHEDULE');
    // And it structurally cannot carry a pace: the SCHEDULE arm's magnitude
    // unit is `sessions_out_of_place`.
    expect(r?.previous.unit).toBe('sessions_out_of_place');
    expect(set.proposals.some(
      (p) => !NON_MOVING_DECISIONS.has(p.decision) && p.target === 'PACE',
    )).toBe(false);
  });

  it('a tired Friday reduces RECOVERY and never proposes a capacity change', () => {
    const i = baseInput();
    i.state = stateAt('reduce');
    const set = composeAdaptation(i);
    const reduce = set.proposals.find((p) => p.decision === 'REDUCE');
    expect(reduce?.previous.unit).toBe('quality_sessions_per_week');
    expect(set.proposals.filter((p) => p.decision === 'PROGRESS')).toHaveLength(0);
  });

  it('every proposal pairs its lever with exactly one legal domain', () => {
    const legal: Record<string, string> = {
      PACE: 'FITNESS', VOLUME: 'LOAD', DURATION: 'LOAD', DENSITY: 'FITNESS',
      QUALITY_VOLUME: 'FITNESS', SPECIFICITY: 'FITNESS', RECOVERY: 'SAFETY',
      SCHEDULE: 'SCHEDULE',
    };
    const worlds = [
      baseInput(),
      (() => { const i = withAbsorbedLoad(baseInput()); i.absorption = absorptionAt('strong'); return i; })(),
      (() => { const i = baseInput(); i.state = stateAt('stop'); return i; })(),
      (() => { const i = baseInput(); i.schedule = { sessionsOutOfPlace: 3, clearSlotsAvailable: 1 }; return i; })(),
      (() => { const i = baseInput(); i.absorption = absorptionAt('marginal'); return i; })(),
    ];
    for (const w of worlds) {
      for (const p of composeAdaptation(w).proposals) {
        expect(p.domain).toBe(legal[p.target]);
      }
    }
  });
});

describe('ADAPTATION ENGINE · doctrine · SAFETY OVERRIDES, and STATE WITHHOLDS', () => {
  it('a stopped runner gets no progression, however good the evidence', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    i.longRun.recent = [{
      activityId: 'long-1', dateISO: '2026-08-29', distanceMi: 16,
      durabilityEvidence: true, lateRunPacingCollapse: false,
      residualCardiovascularLoad: false, executionQuality: 'controlled',
    }];
    i.state = stateAt('stop');
    const set = composeAdaptation(i);
    expect(set.proposals.filter((p) => p.decision === 'PROGRESS')).toHaveLength(0);
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('the withheld progression becomes a HOLD that says WHY · never silence', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.state = stateAt('reduce');
    const set = composeAdaptation(i);
    const held = set.proposals.find((p) => p.target === 'VOLUME' && p.decision === 'HOLD');
    expect(held).toBeTruthy();
    expect(held?.reasonCodes).toContain('STATE_SAYS_TODAY_IS_NOT_THE_DAY');
    // The evidence that WOULD have progressed is preserved on the hold, so a
    // log can tell "never earned it" from "earned it and was withheld".
    expect(held?.whyNot[0]?.detail).toMatch(/evidence to progress/i);
  });

  it('the safety proposal outranks everything else in the list', () => {
    const i = baseInput();
    i.state = stateAt('recover');
    i.schedule = { sessionsOutOfPlace: 2, clearSlotsAvailable: 2 };
    const set = composeAdaptation(i);
    expect(set.proposals[0].domain).toBe('SAFETY');
  });
});

describe('ADAPTATION ENGINE · the absorption gate is the absorption model\'s own line', () => {
  it('the fixture\'s band → decision mapping matches the shipped classifier', async () => {
    // Rule 18 · a fixture that quietly disagrees with the model it stands in
    // for makes every scenario above a test of a system nobody ships. This
    // caught exactly that: the first draft mapped `normal` to STAY, and the
    // real classifier returns PROGRESS for `strong` AND `normal`.
    // Read from DISK, not from `Function.prototype.toString` — the transpiler
    // rewrites whitespace and the first attempt at this check failed against
    // its own transform rather than against a real divergence.
    const src = readFileSync(path.join(__dirname, 'adaptation-model.ts'), 'utf8');
    const mapping = src.slice(src.indexOf('let decision: CycleDecision;'));
    expect(mapping.length).toBeGreaterThan(100); // liveness · Rule 18 guard 2
    expect(mapping).toMatch(/band === 'strong'\)\s*\{\s*\n\s*decision = 'PROGRESS'/);
    expect(mapping).toMatch(/band === 'normal'\)\s*\{\s*\n\s*decision = 'PROGRESS'/);
    expect(mapping).toMatch(/band === 'marginal'\)\s*\{\s*\n\s*decision = 'STAY'/);
    expect(DECISION_FOR_BAND.normal).toBe('PROGRESS');
    expect(DECISION_FOR_BAND.marginal).toBe('STAY');
  });

  it('VOLUME and DURATION · two LOAD levers, one gate, never disagreeing', () => {
    // THE DEFECT THE SHADOW-MODE RUN CAUGHT. `detectVolume` respected absorption
    // and `detectDuration` did not, so a runner reading `marginal` had his week
    // held and his long run grown in the same breath.
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('marginal');
    i.longRun.recent = [{
      activityId: 'long-1', dateISO: '2026-08-29', distanceMi: 16,
      durabilityEvidence: true, lateRunPacingCollapse: false,
      residualCardiovascularLoad: false, executionQuality: 'controlled',
    }];
    const set = composeAdaptation(i);
    const volume = set.proposals.find((p) => p.target === 'VOLUME');
    const duration = set.proposals.find((p) => p.target === 'DURATION');
    expect(volume?.decision).toBe('HOLD');
    expect(duration?.decision).toBe('HOLD');
    expect(duration?.reasonCodes).toContain('ABSORPTION_MARGINAL');
  });

  it('PACE is gated LOWER than load, deliberately · marginal does not hold it', () => {
    const i = baseInput();
    i.absorption = absorptionAt('marginal');
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    expect(primaryProgress(set)?.target).toBe('PACE');
  });

  it('PACE is still held by a POOR band and by any veto', () => {
    for (const a of [absorptionAt('poor'), absorptionAt('normal', { veto: 'illness' })]) {
      const i = baseInput();
      i.absorption = a;
      i.capacity = capacityAt(388);
      i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
      const set = composeAdaptation(i);
      expect(set.proposals.filter((p) => p.decision === 'PROGRESS')).toHaveLength(0);
    }
  });
});

describe('ADAPTATION ENGINE · doctrine · FALLBACK CAPACITY IS NOT EVIDENCE (§17)', () => {
  it('a VDOT-fallback threshold estimate cannot drive a pace progression', () => {
    const i = baseInput();
    i.capacity = capacityAt(388, { sourceMode: 'vdot_fallback' });
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const p = set.proposals.find((x) => x.target === 'PACE');
    // An unmeasured capacity is an ABSENCE, so this is a refusal rather than a
    // finding that the pace should stay. See the REVIEW block below.
    expect(p?.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(p?.reasonCodes).toContain('CAPACITY_NOT_DIRECTLY_EVIDENCED');
  });
});

describe('ADAPTATION ENGINE · Rule 11 · a failed read is not a runner with no evidence', () => {
  it('an unreadable input refuses rather than holding', () => {
    const i = baseInput();
    i.readable = false;
    const set = composeAdaptation(i);
    expect(set.readable).toBe(false);
    expect(set.proposals).toHaveLength(0);
    expect(set.refusals.length).toBeGreaterThan(0);
  });

  it('DENSITY refuses when no plan row carries a progression block · authoring gap, not a hold', () => {
    const set = composeAdaptation(baseInput());
    const refusal = set.refusals.find((r) => r.lever === 'DENSITY');
    expect(refusal?.code).toBe('NO_PROGRESSION_TARGETS');
    expect(refusal?.detail).toMatch(/authoring gap/i);
    expect(set.proposals.some((p) => p.target === 'DENSITY')).toBe(false);
  });

  it('a week with no schedule is not a week scheduled at zero', () => {
    const i = baseInput();
    i.load.recentWeeks = [
      { weekStartISO: '2026-08-24', completedMi: 45, scheduledMi: null },
      { weekStartISO: '2026-08-17', completedMi: 44, scheduledMi: null },
    ];
    const set = composeAdaptation(i);
    const p = set.proposals.find((x) => x.target === 'VOLUME');
    // No comparable week is not a runner who completed nothing. The gate falls
    // to HISTORICAL TOLERANCE and says which question it answered, and it never
    // reports a scheduled-week failure it did not observe.
    expect(p?.reasonCodes).toContain('CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION');
    expect(p?.explanation).not.toMatch(/0 of the last/);
  });
});

describe('ADAPTATION ENGINE · doctrine caps are never widened', () => {
  it('a volume step never crosses the tier ceiling', async () => {
    const { MAX_WEEKLY_BUMP_MI } = await import('@/lib/plan/adaptive-ramp');
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.load.currentWeeklyMi = 68;
    i.load.tierWeeklyUpperMi = 70;
    i.load.recentWeeks = i.load.recentWeeks.map((w) => ({ ...w, completedMi: 68, scheduledMi: 68 }));
    const set = composeAdaptation(i);
    const p = set.proposals.find((x) => x.target === 'VOLUME');
    if (p?.decision === 'PROGRESS') {
      expect((p.proposed as { value: number }).value).toBeLessThanOrEqual(70);
      expect((p.proposed as { value: number }).value).toBeLessThanOrEqual(68 + MAX_WEEKLY_BUMP_MI);
    } else {
      expect(p?.reasonCodes).toContain('AT_TIER_CEILING');
    }
  });

  it('a duration step never crosses the long-run cap or the week-over-week fraction', async () => {
    const { MAX_LONG_BUMP_MI } = await import('@/lib/plan/adaptive-ramp');
    const i = baseInput();
    i.longRun = {
      prescribedLongMi: 21.5, longRunCapMi: 22, longRunWoWMaxFraction: 0.30,
      weekAhead: { readable: true, takesProgressionStep: true },
      recent: [{
        activityId: 'l', dateISO: '2026-08-29', distanceMi: 21,
        durabilityEvidence: true, lateRunPacingCollapse: false,
        residualCardiovascularLoad: false, executionQuality: 'controlled',
      }],
      lookback: freshLookback(),
    };
    const set = composeAdaptation(i);
    const p = set.proposals.find((x) => x.target === 'DURATION');
    if (p?.decision === 'PROGRESS') {
      expect((p.proposed as { value: number }).value).toBeLessThanOrEqual(22);
      expect((p.proposed as { value: number }).value).toBeLessThanOrEqual(21.5 + MAX_LONG_BUMP_MI);
    }
  });

  it('a pace step never exceeds the doctrinal soft-lead quantum', () => {
    const i = baseInput();
    i.capacity = capacityAt(300); // absurdly far ahead
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const p = primaryProgress(set);
    expect(p?.target).toBe('PACE');
    expect(p?.reasonCodes).toContain('PACE_STEP_CLAMPED_TO_DOCTRINE_QUANTUM');
    // One VDOT point at this level is worth well under 30 s/mi.
    expect(400 - (p?.proposed as { value: number }).value).toBeLessThan(30);
  });
});

describe('ADAPTATION ENGINE · Rule 9 · no cliff on the pace step', () => {
  it('the proposed pace moves continuously as capacity walks past the bar', () => {
    let previousProposed: number | null = null;
    const seen: Array<{ gain: number; proposed: number | null }> = [];
    for (let gain = 0; gain <= 20; gain += 0.5) {
      const i = baseInput();
      i.capacity = capacityAt(400 - gain);
      i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
      const p = composeAdaptation(i).proposals.find((x) => x.target === 'PACE');
      const proposed = p?.decision === 'PROGRESS' ? (p.proposed as { value: number }).value : null;
      seen.push({ gain, proposed });
      if (proposed != null && previousProposed != null) {
        // Monotone and small-stepped: half a second of extra capacity may never
        // buy more than half a second of extra prescription.
        expect(previousProposed - proposed).toBeLessThanOrEqual(0.75);
        expect(proposed).toBeLessThanOrEqual(previousProposed);
      }
      if (proposed != null) previousProposed = proposed;
    }
    // The first proposal appears at the minimum useful step, and when it does
    // it is a step of exactly that size — not a jump to the full gain.
    const first = seen.find((s) => s.proposed != null)!;
    expect(400 - first.proposed!).toBeLessThanOrEqual(first.gain + 0.05);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * RULE 22 · THE GATE'S OWN BIAS, MEASURED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ADAPTATION ENGINE · Rule 22 · this file\'s own distribution', () => {
  it('reads its own source and states how many scenarios sit on each side', () => {
    const src = readFileSync(path.join(__dirname, '_adaptation_engine.test.ts'), 'utf8');
    const count = (tag: string) => (src.match(new RegExp(`SCENARIO:${tag} `, 'g')) ?? []).length;
    const progress = count('PROGRESS');
    const downward = count('REDUCE') + count('HOLD') + count('RESTRUCTURE');

    // LIVENESS (Rule 18 guard 2): a regex that matches nothing would report a
    // perfectly balanced zero. Fail loudly instead.
    expect(progress).toBeGreaterThan(0);
    expect(downward).toBeGreaterThan(0);

    // THE RATCHET. The historical engine had 29 hold-side test files against 2
    // acceleration-side ones, and it could not push. This file may never drift
    // that way: upward scenarios must be at least a third of the total.
    // eslint-disable-next-line no-console
    console.log(
      `[rule-22] upward scenarios ${progress} · downward/hold scenarios ${downward} `
      + `· upward share ${(progress / (progress + downward) * 100).toFixed(0)}%`,
    );
    expect(progress / (progress + downward)).toBeGreaterThanOrEqual(1 / 3);
  });

  it('the engine can be made to fail · a falsifier for the one-stressor rule', () => {
    // Rule 18: break it on purpose and watch the check name it. The
    // contradiction checker is the thing under test here, not the composer.
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    const set = composeAdaptation(i);
    const real = primaryProgress(set)!;
    const tampered: AdaptationProposalSet = {
      ...set,
      proposals: [...set.proposals, { ...real }],
    };
    expect(contradictionsIn(tampered)).toContain('MORE_THAN_ONE_PRIMARY_STRESSOR');
  });

  it('the engine can be made to fail · a falsifier for the HOLD-moved-the-number rule', () => {
    const set = composeAdaptation(baseInput());
    const hold = set.proposals.find((p) => p.decision === 'HOLD' && p.target === 'VOLUME');
    expect(hold).toBeTruthy();
    const tampered: AdaptationProposalSet = {
      ...set,
      proposals: [{ ...hold!, proposed: { unit: 'weekly_mi', value: 999 } } as never],
    };
    expect(contradictionsIn(tampered)).toContain('HOLD_MOVED_THE_NUMBER');
  });
});

describe('ADAPTATION ENGINE · every proposal explains itself (§9, §27)', () => {
  it('carries reason codes, an explanation and a model version, in every world', () => {
    const worlds = [
      baseInput(),
      (() => { const i = withAbsorbedLoad(baseInput()); i.absorption = absorptionAt('strong'); return i; })(),
      (() => { const i = baseInput(); i.state = stateAt('stop'); return i; })(),
      (() => { const i = baseInput(); i.schedule = { sessionsOutOfPlace: 1, clearSlotsAvailable: 1 }; return i; })(),
      (() => { const i = baseInput(); i.density = { resolutions: [heldResolution()], gate: 'RESOLVED' }; return i; })(),
    ];
    for (const w of worlds) {
      const set = composeAdaptation(w);
      for (const p of [...set.proposals, ...set.deferred]) {
        expect(p.reasonCodes.length).toBeGreaterThan(0);
        expect(p.explanation.length).toBeGreaterThan(0);
        expect(p.modelVersion).toBe(set.modelVersion);
        // BRIEF 12 / the coach-voice lock: no em dashes, no exclamation marks.
        expect(p.explanation).not.toMatch(/[—!]/);
      }
      expect(contradictionsIn(set)).toEqual([]);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE 2026-08-31 REVIEW · the four fixes it produced, each with its falsifier
 *
 * WHAT THIS BLOCK CANNOT FAIL ON (Rule 22):
 *   · Whether the LOOKBACK the loader hands in was resolved correctly. That is
 *     `_normal_window.test.ts`; here the lookback is a fixture.
 *   · Whether `historicalTolerance` was measured over the right window. Same:
 *     the loader owns it, this asserts only what the gate DOES with it.
 *   · Whether the SIZE of a discounted confidence is the right size. It asserts
 *     the direction and the ordering, never the number.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('REVIEW §6 · insufficient evidence is not evidence against progression', () => {
  it('SCENARIO:INSUFFICIENT · PACE · a window with no quality session refuses, and does not hold', () => {
    // THE TAPER CASE, in the engine's units. The plan prescribed no threshold
    // work, so the runner had no opportunity to demonstrate anything. Reporting
    // that as a HOLD would be a sentence about him.
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = [];
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'PACE');
    expect(p?.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(p?.reasonCodes).toContain('NO_QUALITY_EVIDENCE_IN_WINDOW');
    expect(p?.previous).toEqual(p?.proposed);
  });

  it('SCENARIO:HOLD · PACE · sessions that were run and did NOT hold together is a HOLD', () => {
    // The other side of the same fork, and the whole point of the split: this
    // one IS a read, and it argues against moving the target.
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(2).map((s) => ({
      ...s, executionQuality: 'variable' as const, lateRunPacingCollapse: true,
    }));
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'PACE');
    expect(p?.decision).toBe('HOLD');
    expect(p?.reasonCodes).toContain('EXECUTION_BEAT_TARGET_WITHOUT_CONTROL');
  });

  it('SCENARIO:INSUFFICIENT · PACE · a fallback capacity is an absence, not a finding', () => {
    const i = baseInput();
    i.capacity = capacityAt(388, { sourceMode: 'vdot_fallback' });
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'PACE');
    expect(p?.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(p?.reasonCodes).toContain('CAPACITY_NOT_DIRECTLY_EVIDENCED');
  });

  it('SCENARIO:INSUFFICIENT · DURATION · no long run in the window refuses', () => {
    const i = baseInput();
    i.longRun.recent = [];
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'DURATION');
    expect(p?.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(p?.reasonCodes).toContain('NO_LONG_RUN_EVIDENCE_IN_WINDOW');
  });

  it('SCENARIO:HOLD · DURATION · a long run that came apart is a HOLD, not a refusal', () => {
    const i = baseInput();
    i.longRun.recent = [{
      activityId: 'l', dateISO: '2026-08-29', distanceMi: 16,
      durabilityEvidence: true, lateRunPacingCollapse: true,
      residualCardiovascularLoad: true, executionQuality: 'variable',
    }];
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'DURATION');
    expect(p?.decision).toBe('HOLD');
  });

  it('the five decisions are all reachable, and all distinguishable', () => {
    const seen = new Set<string>();
    const worlds: AdaptationEngineInput[] = [
      (() => { const i = withAbsorbedLoad(baseInput()); i.absorption = absorptionAt('strong'); return i; })(),
      baseInput(),
      (() => { const i = baseInput(); i.state = stateAt('recover'); return i; })(),
      (() => { const i = baseInput(); i.schedule = { sessionsOutOfPlace: 1, clearSlotsAvailable: 1 }; return i; })(),
      (() => { const i = baseInput(); i.longRun.recent = []; return i; })(),
    ];
    for (const w of worlds) for (const p of composeAdaptation(w).proposals) seen.add(p.decision);
    expect([...seen].sort()).toEqual(
      ['HOLD', 'INSUFFICIENT_EVIDENCE', 'PROGRESS', 'REDUCE', 'RESTRUCTURE'],
    );
  });

  it('a refusal may never carry a reason code that asserts a finding', () => {
    // The falsifier for the collapse this fix exists to stop. Hand the checker
    // a refusal wearing a finding and it must name it.
    const set = composeAdaptation((() => { const i = baseInput(); i.longRun.recent = []; return i; })());
    const refusal = set.proposals.find((p) => p.decision === 'INSUFFICIENT_EVIDENCE')!;
    expect(contradictionsIn(set)).toEqual([]);
    const tampered: AdaptationProposalSet = {
      ...set,
      proposals: [{ ...refusal, reasonCodes: [...refusal.reasonCodes, 'LOAD_NOT_YET_ABSORBED'] } as never],
    };
    expect(contradictionsIn(tampered)).toContain('INSUFFICIENT_EVIDENCE_CLAIMS_A_FINDING');
  });

  it('a refusal may not move the number either', () => {
    const set = composeAdaptation((() => { const i = baseInput(); i.longRun.recent = []; return i; })());
    const refusal = set.proposals.find((p) => p.decision === 'INSUFFICIENT_EVIDENCE')!;
    const tampered: AdaptationProposalSet = {
      ...set,
      proposals: [{ ...refusal, proposed: { unit: 'long_run_mi', value: 99 } } as never],
    };
    expect(contradictionsIn(tampered)).toContain('HOLD_MOVED_THE_NUMBER');
  });
});

describe('REVIEW §3 · historical volume tolerance is not current-plan absorption', () => {
  /** A plan authored days ago: one comparable week, and it went fine. */
  const youngPlan = (i: AdaptationEngineInput): AdaptationEngineInput => ({
    ...i,
    load: {
      ...i.load,
      recentWeeks: [
        { weekStartISO: '2026-08-24', completedMi: 44, scheduledMi: 45 },
        { weekStartISO: '2026-08-17', completedMi: 28, scheduledMi: null },
        { weekStartISO: '2026-08-10', completedMi: 23, scheduledMi: null },
      ],
    },
  });

  it('SCENARIO:PROGRESS · VOLUME · a week-old plan does not erase months of tolerance', () => {
    // THE DEFECT. One comparable week used to come back `LOAD_NOT_YET_ABSORBED`
    // — a finding about the runner, invented out of the engine's own youth.
    const i = youngPlan(baseInput());
    i.absorption = absorptionAt('strong');
    i.load.currentWeeklyMi = 40;
    i.load.historicalTolerance = {
      ok: true, sustainedWeeklyMi: 44, representativeDays: 84, oldestISO: '2026-06-02',
    };
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'VOLUME');
    expect(p?.decision).toBe('PROGRESS');
    expect(p?.reasonCodes).toContain('HISTORICAL_VOLUME_TOLERANCE_ESTABLISHED');
    expect(p?.reasonCodes).toContain('CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION');
  });

  it('and the step is HELD to what the history actually demonstrated', () => {
    // The safety half. History says he holds 44; it does not say he holds 45,
    // and spending an unproven ramp step off an unproven week is how a fallback
    // turns into a spike.
    const i = youngPlan(baseInput());
    i.absorption = absorptionAt('strong');
    i.load.currentWeeklyMi = 40;
    i.load.historicalTolerance = {
      ok: true, sustainedWeeklyMi: 44, representativeDays: 84, oldestISO: '2026-06-02',
    };
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'VOLUME');
    expect((p?.proposed as { value: number }).value).toBeLessThanOrEqual(44);
    expect(p?.reasonCodes).toContain('STEP_HELD_TO_DEMONSTRATED_HISTORICAL_VOLUME');
  });

  it('SCENARIO:HOLD · VOLUME · history BELOW the prescribed week is a read, so it holds', () => {
    const i = youngPlan(baseInput());
    i.absorption = absorptionAt('strong');
    i.load.currentWeeklyMi = 60;
    i.load.historicalTolerance = {
      ok: true, sustainedWeeklyMi: 40, representativeDays: 84, oldestISO: '2026-06-02',
    };
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'VOLUME');
    expect(p?.decision).toBe('HOLD');
    expect(p?.reasonCodes).toContain('LOAD_NOT_YET_ABSORBED');
  });

  it('SCENARIO:INSUFFICIENT · VOLUME · a young plan AND no history refuses', () => {
    const i = youngPlan(baseInput());
    i.absorption = absorptionAt('strong');
    i.load.historicalTolerance = { ok: false, reason: 'NOT_ENOUGH_REPRESENTATIVE_TRAINING' };
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'VOLUME');
    expect(p?.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(p?.reasonCodes).toContain('NO_VOLUME_TOLERANCE_EVIDENCE');
  });

  it('a REFUSED tolerance read never reads as a tolerance of zero · Rule 11', () => {
    const i = youngPlan(baseInput());
    i.absorption = absorptionAt('strong');
    i.load.historicalTolerance = { ok: false, reason: 'UNREADABLE' };
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'VOLUME');
    // A tolerance of zero would be `LOAD_NOT_YET_ABSORBED`, a finding. An
    // unreadable one is a refusal, and the two must never be the same output.
    expect(p?.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(p?.reasonCodes).not.toContain('LOAD_NOT_YET_ABSORBED');
  });
});

describe('REVIEW §1 · the lookback is confidence-weighted, not a cliff', () => {
  const threeControlled = () => controlledSessions(PACE_PROGRESS_MIN_SESSIONS);

  it('SCENARIO:PROGRESS · evidence reached back for still progresses, at lower confidence', () => {
    const fresh = baseInput();
    fresh.capacity = capacityAt(388);
    fresh.pace.sessions = threeControlled();
    const freshP = composeAdaptation(fresh).proposals.find((p) => p.target === 'PACE')!;

    const stale = baseInput();
    stale.capacity = capacityAt(388);
    stale.pace.sessions = threeControlled();
    stale.pace.lookback = extendedLookback(0.5);
    const staleP = composeAdaptation(stale).proposals.find((p) => p.target === 'PACE')!;

    expect(freshP.decision).toBe('PROGRESS');
    expect(staleP.decision).toBe('PROGRESS');
    // The MAGNITUDE is identical — older evidence is not evidence for a smaller
    // step, it is the same evidence trusted less.
    expect(staleP.proposed).toEqual(freshP.proposed);
    expect(staleP.confidence).toBeLessThan(freshP.confidence);
    expect(staleP.reasonCodes).toContain('CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE');
    expect(staleP.reasonCodes).toContain('LOOKBACK_EXTENDED_PAST_A_PRESCRIBED_PERIOD');
  });

  it('an unextended lookback says nothing about itself · the no-op property', () => {
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = threeControlled();
    const p = composeAdaptation(i).proposals.find((x) => x.target === 'PACE')!;
    expect(p.reasonCodes).not.toContain('LOOKBACK_EXTENDED_PAST_A_PRESCRIBED_PERIOD');
    expect(p.reasonCodes).not.toContain('CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE');
  });

  it('RULE 9 · confidence falls continuously with the staleness factor', () => {
    let previous = Infinity;
    for (let f = 1; f >= 0.2; f -= 0.05) {
      const i = baseInput();
      i.capacity = capacityAt(388);
      i.pace.sessions = threeControlled();
      i.pace.lookback = extendedLookback(f);
      const p = composeAdaptation(i).proposals.find((x) => x.target === 'PACE')!;
      expect(p.decision).toBe('PROGRESS');   // it never cliffs OFF
      expect(p.confidence).toBeLessThanOrEqual(previous + 1e-9);
      previous = p.confidence;
    }
  });
});

describe('REVIEW §4 · the density refusal names WHICH of the five reasons applies', () => {
  const CASES: Array<[DensityGateState, RegExp]> = [
    ['NO_AUTHORED_PROGRESSION_BLOCK', /authoring gap in the Plan Generator/i],
    ['PASS_NOT_DUE_THIS_WEEK', /once per training week/i],
    ['WEEK_TAKES_NO_PROGRESSION_STEP', /cutback, a race week or inside the taper/i],
    ['NO_ACTIVE_PLAN', /no active plan/i],
    ['UNREADABLE', /failure, not a finding/i],
  ];

  it('every gate state gets its own sentence, and no two share one', () => {
    const details = new Set<string>();
    for (const [gate, matcher] of CASES) {
      const i = baseInput();
      i.density = { resolutions: [], gate };
      const r = composeAdaptation(i).refusals.find((x) => x.lever === 'DENSITY');
      expect(r, `no refusal for ${gate}`).toBeTruthy();
      expect(r!.detail).toMatch(matcher);
      details.add(r!.detail);
      expect(densityRefusalFor(gate).detail).toBe(r!.detail);
    }
    expect(details.size).toBe(CASES.length);
  });

  it('the pass simply not being due is NOT reported as an authoring gap', () => {
    // The defect: on five days in seven the engine said the plan had been
    // authored wrong, when the truth was that the weekly pass had already run.
    const i = baseInput();
    i.density = { resolutions: [], gate: 'PASS_NOT_DUE_THIS_WEEK' };
    const r = composeAdaptation(i).refusals.find((x) => x.lever === 'DENSITY')!;
    expect(r.code).toBe('PROGRESSION_PASS_NOT_DUE');
    expect(r.detail).not.toMatch(/authoring gap/i);
  });

  it('an unreadable gate is a failure and never a gap · Rule 11', () => {
    const i = baseInput();
    i.density = { resolutions: [], gate: 'UNREADABLE' };
    const r = composeAdaptation(i).refusals.find((x) => x.lever === 'DENSITY')!;
    expect(r.code).toBe('PROGRESSION_GATE_UNREADABLE');
  });
});

describe('REVIEW §5 · one stimulus change per cycle, across decision types', () => {
  it('a promoted PROGRESS withdraws the FITNESS restructure rather than sitting beside it', () => {
    // THE COMPOUND. `marginal` absorption emits the SPECIFICITY restructure and
    // still permits a pace progression — the deliberate gate asymmetry — so the
    // runner was told to run threshold faster AND change the kind of quality he
    // does, in the same week. Two stressors.
    const i = baseInput();
    i.absorption = absorptionAt('marginal');
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);

    expect(set.proposals.filter((p) => p.decision === 'PROGRESS')).toHaveLength(1);
    expect(set.proposals.some((p) => p.target === 'SPECIFICITY')).toBe(false);
    expect(contradictionsIn(set)).toEqual([]);
    // WITHDRAWN, NOT FORGOTTEN. The log has to be able to tell "never
    // considered" from "considered and withheld".
    const progress = set.proposals.find((p) => p.decision === 'PROGRESS')!;
    expect(progress.whyNot.some((w) => w.lever === 'SPECIFICITY')).toBe(true);
  });

  it('a SCHEDULE restructure is not a stimulus change and survives beside a progression', () => {
    // Moving Tuesday to Wednesday preserves the intent; it does not add one.
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.schedule = { sessionsOutOfPlace: 2, clearSlotsAvailable: 2 };
    const set = composeAdaptation(i);
    expect(set.proposals.some((p) => p.target === 'SCHEDULE')).toBe(true);
    expect(set.proposals.filter((p) => p.decision === 'PROGRESS')).toHaveLength(1);
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('FOUR levers with simultaneous evidence promote exactly ONE and defer the rest', () => {
    // The owner's §5 acceptance test, spelled out: build a world where every
    // lever has clearing evidence at once and confirm the cycle spends one.
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    i.longRun.recent = [{
      activityId: 'long-1', dateISO: '2026-08-29', distanceMi: 16,
      durabilityEvidence: true, lateRunPacingCollapse: false,
      residualCardiovascularLoad: false, executionQuality: 'controlled',
    }];
    i.density = { resolutions: [denserResolution()], gate: 'RESOLVED' };

    const set = composeAdaptation(i);
    const promoted = set.proposals.filter((p) => p.decision === 'PROGRESS');
    expect(promoted).toHaveLength(1);
    expect(promoted[0].target).toBe('DENSITY');          // smallest useful first
    expect(set.deferred.map((d) => d.target).sort())
      .toEqual(['DURATION', 'PACE', 'VOLUME']);
    // AND NOTHING ELSE IN THE SET CHANGES THE STIMULUS. That is the property
    // the type system cannot reach, because each proposal is legal alone.
    expect(contradictionsIn(set)).not.toContain('MORE_THAN_ONE_STIMULUS_CHANGE');
    // No deferred proposal is applied anywhere: they are reported separately
    // and carry the lever that beat them.
    expect(set.deferred.every((d) => d.whyNot.some((w) => w.lever === 'DENSITY'))).toBe(true);
  });

  it('the compound check can be made to fail · Rule 18', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    const set = composeAdaptation(i);
    const progress = set.proposals.find((p) => p.decision === 'PROGRESS')!;
    const tampered: AdaptationProposalSet = {
      ...set,
      proposals: [...set.proposals, {
        ...progress, decision: 'RESTRUCTURE', target: 'SPECIFICITY', domain: 'FITNESS',
        previous: { unit: 'race_specific_minutes', value: 0 },
        proposed: { unit: 'race_specific_minutes', value: 0 },
      } as never],
    };
    expect(contradictionsIn(tampered)).toContain('MORE_THAN_ONE_STIMULUS_CHANGE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1.1.0 · THE LOAD LEVERS KNOW WHAT WEEK IT IS, AND WHETHER THEY CAN SEE YOU
 *
 * Both sides of every new gate (Rule 22): the case it blocks, and the control
 * case it must NOT block. A gate tested only on the side it refuses is a gate
 * that can pass an engine which only refuses.
 * ═══════════════════════════════════════════════════════════════════════ */

/** A tolerated long run, as the Evidence Engine would grade it. */
const toleratedLong = (dateISO = '2026-08-29') => ({
  activityId: `long-${dateISO}`, dateISO, distanceMi: 16,
  durabilityEvidence: true, lateRunPacingCollapse: false as boolean | null,
  residualCardiovascularLoad: false as boolean | null, executionQuality: 'controlled' as const,
});

describe('1.1.0 · phase-aware LOAD levers · the week ahead decides before the evidence does', () => {
  it('SCENARIO:HOLD · VOLUME · a cutback week ahead holds, whatever the load evidence says', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.load.weekAhead = { readable: true, takesProgressionStep: false, reason: 'CUTBACK' };
    const set = composeAdaptation(i);
    const volume = set.proposals.find((p) => p.target === 'VOLUME')!;
    expect(volume.decision).toBe('HOLD');
    expect(volume.reasonCodes).toEqual(['WEEK_AHEAD_TAKES_NO_PROGRESSION_STEP']);
    expect(volume.explanation).toMatch(/cutback week/);
    expect(volume.previous).toEqual(volume.proposed);
  });

  it('SCENARIO:HOLD · DURATION · a taper week ahead holds a long run the runner has plainly tolerated', () => {
    const i = baseInput();
    i.absorption = absorptionAt('strong');
    i.longRun.recent = [toleratedLong()];
    i.longRun.weekAhead = { readable: true, takesProgressionStep: false, reason: 'TAPER' };
    const set = composeAdaptation(i);
    const duration = set.proposals.find((p) => p.target === 'DURATION')!;
    expect(duration.decision).toBe('HOLD');
    expect(duration.reasonCodes).toEqual(['WEEK_AHEAD_TAKES_NO_PROGRESSION_STEP']);
    expect(duration.explanation).toMatch(/inside the taper/);
    expect(set.proposals.filter((p) => p.decision === 'PROGRESS')).toHaveLength(0);
  });

  it('SCENARIO:HOLD · a race week ahead names itself, and the long run does not grow into it', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.longRun.recent = [toleratedLong()];
    const week = { readable: true, takesProgressionStep: false, reason: 'RACE_WEEK' } as const;
    i.load.weekAhead = week;
    i.longRun.weekAhead = week;
    const set = composeAdaptation(i);
    for (const t of ['VOLUME', 'DURATION'] as const) {
      const p = set.proposals.find((x) => x.target === t)!;
      expect(p.decision).toBe('HOLD');
      expect(p.explanation).toMatch(/race week/);
    }
  });

  it('SCENARIO:PROGRESS · VOLUME · the SAME evidence on a progression week still progresses · the control case', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.load.weekAhead = { readable: true, takesProgressionStep: true };
    const set = composeAdaptation(i);
    expect(primaryProgress(set)?.target).toBe('VOLUME');
  });

  it('SCENARIO:PROGRESS · DURATION · the SAME long run on a progression week grows · the control case', () => {
    const i = baseInput();
    i.absorption = absorptionAt('strong');
    i.longRun.recent = [toleratedLong()];
    i.longRun.weekAhead = { readable: true, takesProgressionStep: true };
    const set = composeAdaptation(i);
    expect(primaryProgress(set)?.target).toBe('DURATION');
    expect(primaryProgress(set)?.proposed).toEqual({ unit: 'long_run_mi', value: 17 });
  });

  it('SCENARIO:INSUFFICIENT · week flags that could not be read refuse on both levers, and assert nothing', () => {
    const i = withAbsorbedLoad(baseInput());
    i.absorption = absorptionAt('strong');
    i.longRun.recent = [toleratedLong()];
    i.load.weekAhead = { readable: false };
    i.longRun.weekAhead = { readable: false };
    const set = composeAdaptation(i);
    for (const t of ['VOLUME', 'DURATION'] as const) {
      const p = set.proposals.find((x) => x.target === t)!;
      expect(p.decision).toBe('INSUFFICIENT_EVIDENCE');
      expect(p.reasonCodes).toEqual(['EVIDENCE_UNREADABLE']);
    }
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('the week-ahead gate is DENSITY\'s own predicate, not a second definition of a no-step week', async () => {
    // Rule 16 · one owner. The loader reduces `plan_weeks` flags through
    // `weekRowNoStepReason` in progression-pass.ts, the same function that
    // decides `WEEK_TAKES_NO_STEP` for the density gate.
    const { weekRowNoStepReason } = await import('@/lib/plan/progression-pass');
    expect(weekRowNoStepReason({ is_cutback: true, is_race_week: null, phase: 'QUALITY' })).toBe('CUTBACK');
    expect(weekRowNoStepReason({ is_cutback: null, is_race_week: true, phase: null })).toBe('RACE_WEEK');
    expect(weekRowNoStepReason({ is_cutback: false, is_race_week: false, phase: 'TAPER' })).toBe('TAPER');
    expect(weekRowNoStepReason({ is_cutback: false, is_race_week: false, phase: 'QUALITY' })).toBeNull();
    const src = readFileSync(path.join(__dirname, 'load-adaptation-engine.ts'), 'utf8');
    expect(src).toMatch(/r\.rows\.map\(weekRowNoStepReason\)/);
  });
});

describe('1.1.0 · Rule 11 · an absorption model that cannot see the runner does not license load', () => {
  /** The classifier's own "fewer than two readable dimensions" verdict. */
  const unreadableAbsorption = (): AdaptationVerdict => ({
    ...absorptionAt('normal'), confidence: 'low', evidenceSufficient: false,
  });

  it('SCENARIO:INSUFFICIENT · VOLUME · a runner the absorption model could not read is refused, not permitted', () => {
    // Before 1.1.0 this input produced a VOLUME PROGRESS: `decision === 'PROGRESS'`
    // was the whole gate, and the classifier's "proceed as planned" default
    // says PROGRESS. Historical tolerance then priced a +5 mi week for a runner
    // three days into an account.
    const i = withAbsorbedLoad(baseInput());
    i.absorption = unreadableAbsorption();
    const set = composeAdaptation(i);
    const volume = set.proposals.find((p) => p.target === 'VOLUME')!;
    expect(volume.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(volume.reasonCodes).toEqual(['ABSORPTION_NOT_YET_READABLE']);
    expect(set.proposals.filter((p) => p.decision === 'PROGRESS')).toHaveLength(0);
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('SCENARIO:INSUFFICIENT · DURATION · the same runner\'s long run is not grown either', () => {
    const i = baseInput();
    i.absorption = unreadableAbsorption();
    i.longRun.recent = [toleratedLong()];
    const set = composeAdaptation(i);
    const duration = set.proposals.find((p) => p.target === 'DURATION')!;
    expect(duration.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(duration.reasonCodes).toEqual(['ABSORPTION_NOT_YET_READABLE']);
  });

  it('SCENARIO:PROGRESS · VOLUME · a READ verdict at LOW confidence still permits · the gate keys on sufficiency, not confidence', () => {
    // Two readable dimensions is a read. Low confidence is the honest price of
    // a thin read, and it belongs in the proposal's confidence, not in a refusal.
    const i = withAbsorbedLoad(baseInput());
    i.absorption = { ...absorptionAt('normal'), confidence: 'low', evidenceSufficient: true };
    const set = composeAdaptation(i);
    const volume = primaryProgress(set)!;
    expect(volume.target).toBe('VOLUME');
    expect(volume.confidence).toBeCloseTo(0.4, 5);
  });

  it('a legacy verdict literal with no `evidenceSufficient` field flows exactly as before', () => {
    // The field is optional for the dozen hand-built fixtures outside this
    // directory. Only an explicit `false` is a refusal.
    const i = withAbsorbedLoad(baseInput());
    const legacy = absorptionAt('strong');
    delete (legacy as Partial<AdaptationVerdict>).evidenceSufficient;
    i.absorption = legacy;
    expect(primaryProgress(composeAdaptation(i))?.target).toBe('VOLUME');
  });

  it('the refusal is symmetric · the same unreadable runner is not REDUCED off this input either', () => {
    const i = baseInput();
    i.absorption = unreadableAbsorption();
    const set = composeAdaptation(i);
    expect(set.proposals.some((p) => p.decision === 'REDUCE')).toBe(false);
  });

  it('the classifier is the only producer, and it sets the field on every branch', async () => {
    const { classifyAdaptation } = await import('./adaptation-model');
    const blank = {
      keySessionExecutions: null, keySessionsPlanned: null, keySessionsCompleted: null,
      targetVerdicts: null, repConsistency: null, rpeReported: null, rpeHarderThanExpected: null,
      decouplingVerdicts: null, lateDriftBpm: null, easyDiscipline: null,
      recoveryPctOfExpected: null, readinessBelowNormalDays: null, readinessWindowDays: null,
      weeklyPlannedMi: null, weeklyActualMi: null, trainingForm: null,
      distinctEvidenceWeeks: null, adapterDowngrades: null,
      niggleSeverity: null, illnessActive: null, injuryActive: null,
    };
    expect(classifyAdaptation(blank).evidenceSufficient).toBe(false);
    expect(classifyAdaptation({ ...blank, injuryActive: true }).evidenceSufficient).toBe(true);
    expect(classifyAdaptation({
      ...blank, targetVerdicts: ['on', 'on'], trainingForm: 'PRODUCTIVE', distinctEvidenceWeeks: 2,
    }).evidenceSufficient).toBe(true);
  });
});

describe('1.1.0 · REDUCE is sized off the week ahead, not off the density pass', () => {
  it('SCENARIO:REDUCE · two quality days ahead reduce to one · previous is the real count', () => {
    const i = baseInput();
    i.state = stateAt('reduce');
    i.load.qualitySessionsWeekAhead = 2;
    const set = composeAdaptation(i);
    const reduce = set.proposals.find((p) => p.decision === 'REDUCE')!;
    expect(reduce.previous).toEqual({ unit: 'quality_sessions_per_week', value: 2 });
    expect(reduce.proposed).toEqual({ unit: 'quality_sessions_per_week', value: 1 });
  });

  it('SCENARIO:REDUCE · before 1.1.0 the same cycle proposed 0 → 0 · the density count on a non-pass day', () => {
    // The density gate returns no resolutions six days in seven. Reading its
    // length as "quality sessions per week" made REDUCE a proposal that
    // reduced nothing. The plan count is the number; the density count is
    // only the fallback when the plan could not be counted (Rule 11).
    const i = baseInput();
    i.state = stateAt('reduce');
    i.load.qualitySessionsWeekAhead = null;
    i.density = { resolutions: [], gate: 'PASS_NOT_DUE_THIS_WEEK' };
    const set = composeAdaptation(i);
    const reduce = set.proposals.find((p) => p.decision === 'REDUCE')!;
    expect(reduce.previous).toEqual({ unit: 'quality_sessions_per_week', value: 0 });
  });
});

describe('1.1.0 · the three DURATION sentences are three facts', () => {
  it('SCENARIO:HOLD · DURATION · a long run graded but run without control is a HOLD that says so', () => {
    const i = baseInput();
    i.absorption = absorptionAt('strong');
    i.longRun.recent = [{ ...toleratedLong(), executionQuality: 'variable' }];
    const set = composeAdaptation(i);
    const duration = set.proposals.find((p) => p.target === 'DURATION')!;
    expect(duration.decision).toBe('HOLD');
    expect(duration.reasonCodes).toContain('LONG_RUN_EXECUTION_UNCONTROLLED');
    expect(duration.reasonCodes).not.toContain('NO_LONG_RUN_EVIDENCE_IN_WINDOW');
    expect(duration.explanation).toMatch(/not under control/);
  });

  it('SCENARIO:INSUFFICIENT · DURATION · a long run the Evidence Engine could not grade is still an absence', () => {
    const i = baseInput();
    i.absorption = absorptionAt('strong');
    i.longRun.recent = [{ ...toleratedLong(), durabilityEvidence: false, executionQuality: 'indeterminate' }];
    const set = composeAdaptation(i);
    const duration = set.proposals.find((p) => p.target === 'DURATION')!;
    expect(duration.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(duration.reasonCodes).toEqual(['NO_LONG_RUN_EVIDENCE_IN_WINDOW']);
  });

  it('a refusal may not carry the new finding code either · the checker knows it', () => {
    const set = composeAdaptation(baseInput());
    const any = set.proposals.find((p) => p.target === 'DURATION')!;
    const tampered: AdaptationProposalSet = {
      ...set,
      proposals: [{ ...any, decision: 'INSUFFICIENT_EVIDENCE', reasonCodes: ['LONG_RUN_EXECUTION_UNCONTROLLED'] } as never],
    };
    expect(contradictionsIn(tampered)).toContain('INSUFFICIENT_EVIDENCE_CLAIMS_A_FINDING');
  });
});
