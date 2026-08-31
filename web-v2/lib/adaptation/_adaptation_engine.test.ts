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
  PACE_PROGRESS_MIN_SESSIONS,
  PROGRESS_LEVER_ORDER,
  composeAdaptation,
  contradictionsIn,
  sessionDemonstratesControl,
  type AdaptationEngineInput,
  type AdaptationProposalSet,
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
const baseInput = (): AdaptationEngineInput => ({
  todayISO: TODAY,
  capacity: capacityAt(400),
  state: stateAt('proceed'),
  absorption: absorptionAt('normal'),
  pace: { prescribedThresholdSecPerMi: 400, sessions: [] },
  load: {
    currentWeeklyMi: 45,
    recentWeeks: [
      { weekStartISO: '2026-08-24', completedMi: 20, scheduledMi: 45 },
      { weekStartISO: '2026-08-17', completedMi: 20, scheduledMi: 45 },
    ],
    tierWeeklyUpperMi: 70,
  },
  longRun: { prescribedLongMi: 16, longRunCapMi: 22, longRunWoWMaxFraction: 0.30, recent: [] },
  density: { resolutions: [], noAuthoredTargets: true },
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

  it('SCENARIO:PROGRESS · DENSITY · the progression gate resolved a denser session', () => {
    const i = baseInput();
    i.density = { resolutions: [denserResolution()], noAuthoredTargets: false };
    const set = composeAdaptation(i);
    const p = primaryProgress(set);
    expect(p?.target).toBe('DENSITY');
    expect(p?.reasonCodes).toContain('PROGRESSION_GATE_RESOLVED_A_DENSER_SESSION');
    // The gate's own resolution is CARRIED, not re-decided.
    expect(p && 'resolution' in p ? p.resolution.action : null).toBe('ACCELERATE');
    expect(contradictionsIn(set)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SCENARIO:HOLD / SCENARIO:REDUCE / SCENARIO:RESTRUCTURE — the other three
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ADAPTATION ENGINE · HOLD, REDUCE and RESTRUCTURE are all reachable', () => {
  it('SCENARIO:HOLD · nothing earned · one HOLD, and it says the training is working', () => {
    const set = composeAdaptation(baseInput());
    expect(set.proposals.every((p) => p.decision === 'HOLD')).toBe(true);
    expect(set.proposals.length).toBeGreaterThan(0);
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('SCENARIO:HOLD · PACE · evidence present but one session short of corroboration', () => {
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS - 1);
    const set = composeAdaptation(i);
    const hold = set.proposals.find((p) => p.target === 'PACE');
    expect(hold?.decision).toBe('HOLD');
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

  it('all four decisions are reachable from the same fixture family', () => {
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
    expect([...seen].sort()).toEqual(['HOLD', 'PROGRESS', 'REDUCE', 'RESTRUCTURE']);
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
    expect(p?.decision).toBe('HOLD');
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
    i.density = { resolutions: [denserResolution()], noAuthoredTargets: false };

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
    i.density = { resolutions: [denserResolution()], noAuthoredTargets: false };
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
    expect(set.proposals.some((p) => p.decision !== 'HOLD' && p.target === 'PACE')).toBe(false);
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
      SPECIFICITY: 'FITNESS', RECOVERY: 'SAFETY', SCHEDULE: 'SCHEDULE',
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
    expect(p?.decision).toBe('HOLD');
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
    expect(p?.decision).toBe('HOLD');
    expect(p?.reasonCodes).toContain('LOAD_NOT_YET_ABSORBED');
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
      recent: [{
        activityId: 'l', dateISO: '2026-08-29', distanceMi: 21,
        durabilityEvidence: true, lateRunPacingCollapse: false,
        residualCardiovascularLoad: false, executionQuality: 'controlled',
      }],
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
      (() => { const i = baseInput(); i.density = { resolutions: [heldResolution()], noAuthoredTargets: false }; return i; })(),
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
