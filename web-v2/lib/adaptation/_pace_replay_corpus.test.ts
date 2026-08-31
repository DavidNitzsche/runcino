/**
 * lib/adaptation/_pace_replay_corpus.test.ts · THE PACE REPLAY CORPUS.
 *
 * Explicit instruction (2026-09-01, verbatim): do NOT build a general
 * synthetic-history platform. Build a small, hand-authored fixture corpus at
 * the real `AdaptationEngineInput` shape (`web-v2/lib/adaptation/
 * adaptation-engine.ts`) and run it through the REAL engine — never a mock.
 * Same discipline `_absorption_split.test.ts` and
 * `_shadow_run_absorption_split.script.ts` already used for the
 * `AdaptationInput` (note: different type, different engine —
 * `adaptation-model.ts`'s absorption classifier) corpus the same night; see
 * `docs/reports/absorption-reader-split-2026-09-01.md` §4 for the pattern
 * this file follows on the Adaptation Engine's own input shape instead.
 *
 * ── WHAT "REAL ENGINE" MEANS HERE ────────────────────────────────────────
 *
 * `composeAdaptation` (this module) is PURE — every input is a plain value —
 * so it is exactly what `resolveAdaptationProposals`
 * (`load-adaptation-engine.ts`) calls after doing the (impure, DB-bound)
 * work of assembling an `AdaptationEngineInput` from a real account. There is
 * no exported `detectPace` — it is a private lever inside `composeAdaptation`
 * — so "run it through detectPace" means through `composeAdaptation` and
 * reading the `target: 'PACE'` arm of its output, which is the only way any
 * caller (including `shadow-compare.ts`) ever reaches it.
 *
 * `checkPaceHrCompatibility` (`pace-hr-compatibility.ts`) is likewise pure
 * and is called directly, unmocked, wherever a fixture concerns pace/HR
 * compatibility.
 *
 * `runPaceShadowCompareCycle` (`shadow-compare.ts`) is NOT called from this
 * file. It wraps `resolveAdaptationProposals`, which queries Postgres — there
 * is no way to hand it a synthetic `AdaptationEngineInput` without either
 * mocking the database (which the brief that produced `shadow-compare.ts`
 * explicitly built against, real, for the real account) or duplicating its
 * DB-shell logic here, which is exactly the "general synthetic-history
 * platform" this task was told not to build. Fixture 10 documents this gap
 * concretely rather than working around it with a mock.
 *
 * ── FIXTURE STYLE ─────────────────────────────────────────────────────────
 *
 * Every fixture builder mirrors `_adaptation_engine.test.ts`'s own
 * `capacityAt`/`stateAt`/`absorptionAt`/`session`/`baseInput` helpers
 * (duplicated here rather than imported, matching that file's own
 * un-shared, per-file convention — there is no shared fixture-builder
 * module in this codebase to import from). Every scenario prints its real
 * engine output via `console.log` so this file doubles as the source the
 * report (`docs/reports/pace-replay-corpus-2026-09-01.md`) quotes verbatim
 * from a real `npx vitest run` invocation, and asserts the decision so a
 * regression is caught, not just observed once.
 *
 * ── MULTI-DATE WALKS, HONESTLY SCOPED ────────────────────────────────────
 *
 * Fixtures 3 and 9 evaluate the SAME fixture at 2-4 adjacent SYNTHETIC
 * `todayISO` values to test boundary behaviour (does confidence decay
 * smoothly past the staleness half-life; does a taper-phase read stay
 * flat and non-punitive across its own boundary). This is a walk across
 * constructed dates in one process, in milliseconds — it is NOT a
 * substitute for observing the same account over real elapsed days, which
 * `docs/reports/pace-shadow-compare-2026-09-01.md` §2 already named as
 * separately needed and not yet available. See this file's own final
 * section, and the report, for that distinction stated again in the
 * open.
 */
import { describe, it, expect } from 'vitest';
import {
  composeAdaptation,
  contradictionsIn,
  sessionDemonstratesControl,
  NON_MOVING_DECISIONS,
  PACE_PROGRESS_MIN_SESSIONS,
  ADAPTATION_ENGINE_MODEL_VERSION,
  type AdaptationEngineInput,
  type AdaptationProposal,
  type AdaptationProposalSet,
  type EvidenceLookback,
  type PacePhaseRead,
  type QualitySessionRead,
} from './adaptation-engine';
import type { AdaptationVerdict } from './adaptation-model';
import type { ProgressionResolution } from '@/lib/plan/progression-pass';
import type { RunnerState, StateDecision } from '@/lib/training/runner-state';
import type { ResolvedCapacity } from '@/lib/training/prescription-resolver';
import { evidenceStalenessFactor } from '@/lib/training/normal-window';
import {
  checkPaceHrCompatibility,
  MATERIAL_INCOMPATIBILITY_MIN_SESSIONS,
  UNEXPLAINED_OVERAGE_MATERIAL_BPM,
  STALE_CEILING_UNDERSHOOT_BPM,
  type HrCheckedSession,
  type PaceHrCompatibilityResult,
} from './pace-hr-compatibility';

const TODAY = '2026-09-01';

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE BUILDERS — plain values, mirroring `_adaptation_engine.test.ts`
 * ═══════════════════════════════════════════════════════════════════════ */

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

const stateAt = (decision: StateDecision, todayISO = TODAY): RunnerState => ({
  decision,
  driver: decision === 'proceed' ? null : {
    kind: 'convergence', argues: decision, driving: true,
    detail: `convergence argues ${decision}`, evidence: {},
  },
  signals: [], readable: true, todayISO,
  resolvedAt: `${todayISO}T00:00:00Z`, modelVersion: '1.0.0',
});

const DECISION_FOR_BAND: Record<AdaptationVerdict['band'], AdaptationVerdict['decision']> = {
  strong: 'PROGRESS', normal: 'PROGRESS', marginal: 'STAY', poor: 'MODIFY',
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
  activityId: `run-${dateISO}-${Math.random().toString(36).slice(2, 7)}`,
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

const controlledSessions = (n: number, endingISO = '2026-08-28'): QualitySessionRead[] => {
  const end = Date.parse(`${endingISO}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    session(new Date(end - i * 3 * 86_400_000).toISOString().slice(0, 10)));
};

const freshLookback = (): EvidenceLookback => ({
  baseWindowDays: 28, windowDays: 28, representativeDays: 28,
  excludedDays: 0, stalenessFactor: 1, reachedOuterBound: false,
});

/** `baseInput()` — the neutral world, matching `_adaptation_engine.test.ts`'s
 *  own baseline: every non-PACE lever refuses or holds by default, so a
 *  fixture that only edits `pace` isolates the PACE lever exactly as the
 *  real `phaseStep`/`detectPace` logic would see it. */
const baseInput = (todayISO = TODAY): AdaptationEngineInput => ({
  todayISO,
  capacity: capacityAt(400),
  state: stateAt('proceed', todayISO),
  absorption: absorptionAt('normal'),
  pace: {
    phases: [{
      phaseLabel: null, prescribedSecPerMi: 400, rowCount: 1,
      firstDateISO: todayISO, lastDateISO: todayISO,
    }],
    sessions: [],
    lookback: freshLookback(),
  },
  load: {
    currentWeeklyMi: 45,
    recentWeeks: [
      { weekStartISO: '2026-08-24', completedMi: 20, scheduledMi: 45 },
      { weekStartISO: '2026-08-17', completedMi: 20, scheduledMi: 45 },
    ],
    historicalTolerance: { ok: true, sustainedWeeklyMi: 44, representativeDays: 84, oldestISO: '2026-06-02' },
    tierWeeklyUpperMi: 70,
  },
  longRun: {
    prescribedLongMi: 16, longRunCapMi: 22, longRunWoWMaxFraction: 0.30,
    recent: [], lookback: freshLookback(),
  },
  density: { resolutions: [], gate: 'NO_AUTHORED_PROGRESSION_BLOCK' },
  schedule: { sessionsOutOfPlace: 0, clearSlotsAvailable: 0 },
  readable: true,
});

const daysBetweenISO = (aISO: string, bISO: string): number =>
  Math.round((Date.parse(`${bISO}T00:00:00Z`) - Date.parse(`${aISO}T00:00:00Z`)) / 86_400_000);

/* ── Reporting helpers · print the REAL engine output so the report can
 *    quote it verbatim, and so a human reading test output sees the same
 *    thing the report shows ──────────────────────────────────────────── */

function paceOf(set: AdaptationProposalSet): AdaptationProposal | null {
  return set.proposals.find((p) => p.target === 'PACE')
    ?? set.deferred.find((p) => p.target === 'PACE')
    ?? null;
}

function fmtPace(p: AdaptationProposal | null): string {
  if (!p || p.target !== 'PACE') return '(no PACE proposal)';
  const breakdown = p.phaseBreakdown
    .map((b) => `${b.phaseLabel ?? 'unphased'} ${b.previousSecPerMi}->${b.proposedSecPerMi} `
      + `(step ${b.stepSecPerMi.toFixed(1)}, ${b.moved ? 'MOVED' : 'held'})`)
    .join('; ');
  return `${p.decision} conf=${p.confidence.toFixed(3)} [${p.reasonCodes.join(',')}] `
    + `${p.previous.value}->${p.proposed.value} :: ${breakdown} :: "${p.explanation}"`;
}

function fmtHr(r: PaceHrCompatibilityResult): string {
  return `${r.verdict} mayProceed=${r.paceProposalMayProceed} band=`
    + `${r.z4BandBpm ? `${r.z4BandBpm.lower}-${r.z4BandBpm.upper}` : 'null'} :: "${r.reason}"`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 1 · Improving threshold capacity, controlled corroboration — a
 * clean PROGRESS case
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 1 · improving threshold capacity, controlled corroboration → clean PROGRESS', () => {
  it('composeAdaptation proposes PACE PROGRESS off three controlled sessions', () => {
    const i = baseInput();
    i.capacity = capacityAt(388); // 12 s/mi faster than the 400 s/mi prescribed
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    console.log('[F1 PROGRESS]', fmtPace(paceOf(set)));

    const p = paceOf(set);
    expect(set.proposals.find((x) => x.decision === 'PROGRESS')?.target).toBe('PACE');
    expect(p?.decision).toBe('PROGRESS');
    if (p?.target === 'PACE') {
      expect(p.previous.value).toBe(400);
      expect(p.proposed.value).toBeLessThan(400);
      expect(p.reasonCodes).toContain('REPEATED_CONTROLLED_QUALITY_EXECUTION');
    }
    expect(contradictionsIn(set)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 2 · Apparently improving pace during taper/recovery — does the
 * engine get fooled by the taper's own volume reduction?
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 2 · taper/recovery pace, tested against the corroboration bar', () => {
  it('2a · ONE fast taper "sharpener" session is NOT corroboration — INSUFFICIENT_EVIDENCE, not PROGRESS', () => {
    const i = baseInput();
    i.capacity = capacityAt(430); // believed capacity, from before the taper
    i.pace.phases = [{
      phaseLabel: 'TAPER', prescribedSecPerMi: 475, rowCount: 2,
      firstDateISO: '2026-08-20', lastDateISO: '2026-08-24',
    }];
    // Exactly one controlled session inside the taper window — a real
    // sharpening workout, genuinely controlled, genuinely fast. If the
    // engine were fooled by taper's own volume/quality reduction, a single
    // strong session dressed up as "recent form" could look like proof.
    i.pace.sessions = [session('2026-08-19', { executionQuality: 'controlled', lateRunPacingCollapse: false })];
    const set = composeAdaptation(i);
    const p = paceOf(set);
    console.log('[F2a INSUFFICIENT]', fmtPace(p));

    expect(p?.decision).toBe('INSUFFICIENT_EVIDENCE');
    if (p?.target === 'PACE') {
      expect(p.previous.value).toBe(475);
      expect(p.proposed.value).toBe(475); // unmoved
      expect(p.reasonCodes).toContain('SINGLE_STRONG_SESSION_IS_NOT_CORROBORATION');
      expect(p.phaseBreakdown.every((b) => !b.moved)).toBe(true);
    }
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('2b · corroborated via the REAL lookback extension into the pre-taper block — moves, but confidence is honestly discounted for age', () => {
    const today = '2026-08-20'; // inside the taper
    const i = baseInput(today);
    i.capacity = capacityAt(430, { confidence: 0.8 });
    i.pace.phases = [{
      phaseLabel: 'TAPER', prescribedSecPerMi: 475, rowCount: 2,
      firstDateISO: '2026-08-20', lastDateISO: '2026-08-24',
    }];
    const taperSession = session('2026-08-19');
    const preTaper1 = session('2026-07-05');
    const preTaper2 = session('2026-07-08');
    i.pace.sessions = [taperSession, preTaper1, preTaper2]; // 3, corroborated

    // The REAL half-life function, not a hand-picked number — exactly what
    // `load-adaptation-engine.ts`'s `lookbackFor` computes.
    const controlledDates = [taperSession, preTaper1, preTaper2]
      .filter(sessionDemonstratesControl).map((s) => s.dateISO);
    const stalenessFactor = evidenceStalenessFactor(controlledDates, today, 28);
    i.pace.lookback = {
      baseWindowDays: 28, windowDays: 47, representativeDays: 3,
      excludedDays: 44, stalenessFactor, reachedOuterBound: false,
    };

    const set = composeAdaptation(i);
    const p = paceOf(set);
    console.log('[F2b PROGRESS, discounted]', `stalenessFactor=${stalenessFactor.toFixed(3)}`, fmtPace(p));

    expect(p?.decision).toBe('PROGRESS');
    if (p?.target === 'PACE') {
      // Moves — real corroboration, reached back for honestly — but the
      // confidence it moves with is discounted for how old two of the three
      // sessions are, not treated as fresh proof (capacity.confidence(0.8) *
      // stalenessFactor, strictly below the undiscounted 0.8).
      expect(p.confidence).toBeLessThan(0.8);
      expect(p.confidence).toBeCloseTo(0.8 * stalenessFactor, 6);
      expect(p.reasonCodes).toContain('LOOKBACK_EXTENDED_PAST_A_PRESCRIBED_PERIOD');
      expect(p.reasonCodes).toContain('CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE');
    }
    expect(contradictionsIn(set)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 3 · Old evidence crossing the staleness boundary — 4 adjacent
 * SYNTHETIC evaluation dates walking the REAL half-life function through its
 * own cutoff
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 3 · staleness boundary, walked across adjacent synthetic dates', () => {
  // Three FIXED session dates, two days apart. Only `todayISO` moves. Ages
  // (today - session date) grow together as today advances, so the MEDIAN
  // age (the quantity `evidenceStalenessFactor` actually keys on) walks
  // through the `baseWindowDays` (28) cutoff smoothly rather than jumping.
  const sessionDatesISO = ['2026-08-01', '2026-08-03', '2026-08-05'];

  const walkDates = [
    { todayISO: '2026-08-30', label: 'median age 27 (inside base window)' },
    { todayISO: '2026-08-31', label: 'median age 28 (exactly at the base window)' },
    { todayISO: '2026-09-01', label: 'median age 29 (one day past the cutoff)' },
    { todayISO: '2026-09-08', label: 'median age 36 (a week past the cutoff)' },
  ];

  it('confidence decays smoothly through day 28 — no cliff, matching Rule 9', () => {
    const results = walkDates.map(({ todayISO, label }) => {
      const i = baseInput(todayISO);
      i.capacity = capacityAt(430, { confidence: 0.8 });
      const windowDays = Math.max(28, daysBetweenISO(sessionDatesISO[0], todayISO) + 1);
      i.pace.phases = [{
        phaseLabel: null, prescribedSecPerMi: 460, rowCount: 3,
        firstDateISO: todayISO, lastDateISO: todayISO,
      }];
      i.pace.sessions = sessionDatesISO.map((d) => session(d));
      const stalenessFactor = evidenceStalenessFactor(sessionDatesISO, todayISO, 28);
      i.pace.lookback = {
        baseWindowDays: 28, windowDays, representativeDays: windowDays,
        excludedDays: 0, stalenessFactor, reachedOuterBound: false,
      };
      const set = composeAdaptation(i);
      const p = paceOf(set);
      console.log(`[F3 ${todayISO} · ${label}]`, `stalenessFactor=${stalenessFactor.toFixed(4)}`, fmtPace(p));
      return { todayISO, stalenessFactor, decision: p?.decision, confidence: p?.confidence ?? null };
    });

    // The cutoff itself (day 27 -> day 28) produces ZERO change — the median
    // has to exceed baseWindowDays before any discount applies at all.
    expect(results[0].stalenessFactor).toBeCloseTo(1, 6);
    expect(results[1].stalenessFactor).toBeCloseTo(1, 6);
    // One day past, the discount is small and continuous, not a jump.
    expect(results[2].stalenessFactor).toBeLessThan(1);
    expect(results[2].stalenessFactor).toBeGreaterThan(0.95);
    // A week further out, the discount has grown — monotonically, smoothly.
    expect(results[3].stalenessFactor).toBeLessThan(results[2].stalenessFactor);
    // Every step is decision-stable (still PROGRESS-eligible; the discount
    // prices confidence, it never itself flips the decision) — the boundary
    // is a confidence gradient, not a behavioural cliff.
    for (const r of results) expect(r.decision).toBe('PROGRESS');
    // Confidence itself tracks stalenessFactor exactly (capacity confidence
    // 0.8 * stalenessFactor), continuous across all four evaluation dates.
    for (const r of results) expect(r.confidence).toBeCloseTo(0.8 * r.stalenessFactor, 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 4 · Insufficient evidence — too few controlled sessions,
 * correctly distinct from HOLD
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 4 · insufficient evidence, distinct from a real HOLD', () => {
  it('4a · two controlled sessions, nothing arguing against — INSUFFICIENT_EVIDENCE (an absence)', () => {
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS - 1); // 2, one short
    const set = composeAdaptation(i);
    const p = paceOf(set);
    console.log('[F4a INSUFFICIENT]', fmtPace(p));
    expect(p?.decision).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('4b · same session count, but ONE session argues against — HOLD (a finding), never INSUFFICIENT_EVIDENCE', () => {
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = [
      ...controlledSessions(PACE_PROGRESS_MIN_SESSIONS - 1),
      session('2026-08-15', { executionQuality: 'variable' }), // beat the target, uncontrolled
    ];
    const set = composeAdaptation(i);
    const p = paceOf(set);
    console.log('[F4b HOLD]', fmtPace(p));
    expect(p?.decision).toBe('HOLD');
    if (p?.target === 'PACE') {
      expect(p.reasonCodes).toContain('EXECUTION_BEAT_TARGET_WITHOUT_CONTROL');
    }
    // Rule 11, checked structurally: a HOLD may carry a finding reason code;
    // an INSUFFICIENT_EVIDENCE proposal never may (§7's contradiction
    // checker owns this — asserted empty below rather than re-implemented).
    expect(contradictionsIn(set)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 5 · Conflicting pace and HR evidence — the compatibility
 * validator's REFUSE branch
 * ═══════════════════════════════════════════════════════════════════════ */

const Z4_LTHR = 168; // matches pace-hr-compatibility.test.ts's real-account case: z4 band 160-167

describe('FIXTURE 5 · conflicting pace and HR evidence → INCOMPATIBLE_REFUSE', () => {
  it('a PACE PROGRESS proposal whose backing sessions ran well over Z4 with no heat to explain it is refused', () => {
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const pace = paceOf(set);
    expect(pace?.decision).toBe('PROGRESS');
    if (pace?.target !== 'PACE') throw new Error('unreachable');

    const hrSessions: HrCheckedSession[] = i.pace.sessions.map((s, idx) => ({
      activityId: s.activityId, dateISO: s.dateISO,
      avgWorkHrBpm: 180 + idx, // 13-15 bpm over the 167 ceiling
      tempF: null, // no heat confounder available to explain it
    }));
    const result = checkPaceHrCompatibility({
      previousSecPerMi: pace.previous.value,
      proposedSecPerMi: pace.proposed.value,
      lthrBpm: Z4_LTHR,
      sessions: hrSessions,
    });
    console.log('[F5 REFUSE]', fmtPace(pace), '::', fmtHr(result));

    expect(result.verdict).toBe('INCOMPATIBLE_REFUSE');
    expect(result.paceProposalMayProceed).toBe(false);
    expect(result.sessionReads.filter((r) => r.classification === 'unexplained_hot').length)
      .toBeGreaterThanOrEqual(MATERIAL_INCOMPATIBILITY_MIN_SESSIONS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 6 · Heat-explained HR elevation → COMPATIBLE_ENVIRONMENTAL_EXPLAINED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 6 · heat explains the HR overage → the pace proposal is not penalized', () => {
  it('a hot session over Z4 whose overage the heat confounder table fully covers is compatible', () => {
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const pace = paceOf(set);
    if (pace?.target !== 'PACE') throw new Error('unreachable');

    const hrSessions: HrCheckedSession[] = i.pace.sessions.map((s) => ({
      activityId: s.activityId, dateISO: s.dateISO,
      avgWorkHrBpm: 178, // 11 bpm over the 167 ceiling
      tempF: 85, // heatHrBumpBpm(85) ≈ 14 bpm — fully covers the overage
    }));
    const result = checkPaceHrCompatibility({
      previousSecPerMi: pace.previous.value, proposedSecPerMi: pace.proposed.value,
      lthrBpm: Z4_LTHR, sessions: hrSessions,
    });
    console.log('[F6 ENVIRONMENT_EXPLAINED]', fmtHr(result));

    expect(result.verdict).toBe('COMPATIBLE_ENVIRONMENTAL_EXPLAINED');
    expect(result.paceProposalMayProceed).toBe(true);
    expect(result.sessionReads.every((r) => r.unexplainedOverageBpm === 0)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 7 · Stale HR guidance → COMPATIBLE_HR_CEILING_LIKELY_STALE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 7 · repeated controlled sessions well under the Z4 floor → stale-ceiling advisory', () => {
  it('the pace proposal proceeds AND flags the HR ceiling as the HR owner\'s own evidence to act on', () => {
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const pace = paceOf(set);
    if (pace?.target !== 'PACE') throw new Error('unreachable');

    const hrSessions: HrCheckedSession[] = i.pace.sessions.map((s, idx) => ({
      activityId: s.activityId, dateISO: s.dateISO,
      avgWorkHrBpm: 150 - idx, // well under the 160 floor (>= STALE_CEILING_UNDERSHOOT_BPM=5 under)
      tempF: 60,
    }));
    const result = checkPaceHrCompatibility({
      previousSecPerMi: pace.previous.value, proposedSecPerMi: pace.proposed.value,
      lthrBpm: Z4_LTHR, sessions: hrSessions,
      lthrReanchor: { stale: true, action: 'hold', why: 'below the re-test cadence but trending low' },
    });
    console.log('[F7 STALE_CEILING]', fmtHr(result));

    expect(result.verdict).toBe('COMPATIBLE_HR_CEILING_LIKELY_STALE');
    expect(result.paceProposalMayProceed).toBe(true);
    expect(result.sessionReads.filter((r) => r.classification === 'below_band').length)
      .toBeGreaterThanOrEqual(MATERIAL_INCOMPATIBILITY_MIN_SESSIONS);
    // Every session sits at least STALE_CEILING_UNDERSHOOT_BPM under the Z4
    // floor — the exact bar the validator requires before it will call the
    // ceiling itself stale rather than "a good day".
    for (const r of result.sessionReads) {
      expect(result.z4BandBpm!.lower - r.avgWorkHrBpm).toBeGreaterThanOrEqual(STALE_CEILING_UNDERSHOOT_BPM);
    }
    // This validator never re-anchors — it only echoes the advisory it was given.
    expect(result.lthrReanchorAdvisory?.action).toBe('hold');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 8 · A phase already faster than the proposed capacity holds — the
 * exact RACE-SPECIFIC bug pattern found and fixed 2026-09-01, replayed here
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 8 · a phase already priced faster than believed capacity is held, not dragged along', () => {
  it('replays the real account\'s own QUALITY/RACE-SPECIFIC/TAPER shape (435/424/475 vs believed 430)', () => {
    const i = baseInput();
    i.capacity = capacityAt(430);
    i.pace.phases = [
      { phaseLabel: 'QUALITY', prescribedSecPerMi: 435, rowCount: 6, firstDateISO: '2026-09-01', lastDateISO: '2026-10-13' },
      { phaseLabel: 'RACE-SPECIFIC', prescribedSecPerMi: 424, rowCount: 4, firstDateISO: '2026-10-20', lastDateISO: '2026-11-13' },
      { phaseLabel: 'TAPER', prescribedSecPerMi: 475, rowCount: 2, firstDateISO: '2026-11-17', lastDateISO: '2026-11-24' },
    ];
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const p = paceOf(set);
    console.log('[F8 RACE-SPECIFIC held]', fmtPace(p));

    if (p?.target !== 'PACE') throw new Error('unreachable');
    const byLabel = Object.fromEntries(p.phaseBreakdown.map((b) => [b.phaseLabel, b]));
    expect(byLabel['RACE-SPECIFIC']?.moved).toBe(false);
    expect(byLabel['RACE-SPECIFIC']?.proposedSecPerMi).toBe(424); // unchanged — already ahead
    expect(byLabel.QUALITY?.moved).toBe(true);
    expect(contradictionsIn(set)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 9 · Taper deliberately slower than capacity — held / clamped, and
 * NEVER read as under-performance, walked across the taper-start boundary
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 9 · a deliberately slower TAPER phase, walked across its own start boundary', () => {
  // Day A · one day BEFORE taper starts. The plan is authored whole, so the
  //   TAPER rows already exist ahead in the schedule alongside the current
  //   QUALITY phase (CLAUDE.md: "the block is built whole and flexes on two
  //   axes") — both phases are read, QUALITY has 3 corroborating sessions.
  // Day B · the day taper starts. QUALITY rows have rolled past `today`, so
  //   only TAPER remains in `phases`; no new quality work is prescribed
  //   inside it, so no fresh session exists yet.
  // Day C · well inside taper. Same shape as Day B, confirming stability.
  const walk = [
    { todayISO: '2026-08-15', phases: 'QUALITY + TAPER', hasSession: true },
    { todayISO: '2026-08-16', phases: 'TAPER only', hasSession: false },
    { todayISO: '2026-08-20', phases: 'TAPER only', hasSession: false },
  ];

  it('the TAPER phase never carries a finding reason code and never proposes a SLOWER pace', () => {
    const outcomes = walk.map(({ todayISO, hasSession }) => {
      const i = baseInput(todayISO);
      i.capacity = capacityAt(430);
      const taperPhase: PacePhaseRead = {
        phaseLabel: 'TAPER', prescribedSecPerMi: 475, rowCount: 2,
        firstDateISO: '2026-08-16', lastDateISO: '2026-08-24',
      };
      i.pace.phases = hasSession
        ? [
            { phaseLabel: 'QUALITY', prescribedSecPerMi: 435, rowCount: 6, firstDateISO: todayISO, lastDateISO: '2026-08-15' },
            taperPhase,
          ]
        : [taperPhase];
      i.pace.sessions = hasSession ? controlledSessions(PACE_PROGRESS_MIN_SESSIONS, '2026-08-14') : [];
      const set = composeAdaptation(i);
      const p = paceOf(set);
      console.log(`[F9 ${todayISO}]`, fmtPace(p));
      return { todayISO, p, set };
    });

    for (const { todayISO, p, set } of outcomes) {
      expect(p, `no PACE read on ${todayISO}`).not.toBeNull();
      // Never REDUCE, never a finding tied to the taper's own slower pricing.
      expect(p?.decision).not.toBe('REDUCE');
      const taper = p?.target === 'PACE' ? p.phaseBreakdown.find((b) => b.phaseLabel === 'TAPER') : undefined;
      expect(taper, `no TAPER phase read on ${todayISO}`).toBeDefined();
      // TAPER's own step is NEVER backwards — the engine never proposes
      // making a deliberately-slow taper phase even slower as if its gap
      // to capacity were evidence against the runner.
      expect(taper!.proposedSecPerMi).toBeLessThanOrEqual(taper!.previousSecPerMi);
      expect(contradictionsIn(set)).toEqual([]);
    }
    // Day A (corroborated elsewhere in the plan): TAPER is included in the
    // phase breakdown and nudged by its own small clamped step — never held
    // "because" it is slow; Days B/C (no fresh evidence once taper starts):
    // TAPER sits flat via `flatBreakdown` — an absence, not a finding.
    expect(outcomes[0].p?.decision).toBe('PROGRESS');
    expect(outcomes[1].p?.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(outcomes[2].p?.decision).toBe('INSUFFICIENT_EVIDENCE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 10 · A young plan not yet reanchored canonically — this is what
 * `composeAdaptation` alone STILL cannot tell apart from genuine PROGRESS.
 *
 * UPDATE 2026-09-01 (same night, later pass): the guard this fixture said
 * "does not exist yet" now does —
 * `web-v2/lib/adaptation/authoring-convergence.ts`'s
 * `resolveAuthoringReanchorConvergence`, called by `shadow-compare.ts` and
 * exposed on `ShadowCompareRecord.convergence`. It lives ONE LAYER UP from
 * this fixture, exactly where this fixture's own closing comment said it
 * would: `composeAdaptation` (§8's own header) deliberately does not own
 * capacity resolution, and the convergence guard is a capacity-resolution-
 * adjacent question, not a decision-layer one. So this fixture's ASSERTION
 * is unchanged and still correct — `composeAdaptation` on its own, fed this
 * exact contaminated shape, still cannot tell it apart from Fixture 1's
 * genuine gain, because nothing about that layer changed. What changed is
 * that a CALLER one layer up (`shadow-compare.ts`) now separately reads
 * `training_plans.authored_iso` against the last successful
 * `reanchorActivePlan` run and stamps `AUTHORED_TOO_RECENTLY` /
 * `REANCHOR_STATUS_UNKNOWN` on the record precisely when this fixture's
 * scenario applies — see `_shadow_compare.audit.test.ts` for that guard's
 * own real-account verification, which is a different file because it needs
 * a real database and this corpus deliberately does not (see this file's own
 * header on why `runPaceShadowCompareCycle` is not called from here).
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 10 · a young, not-yet-reanchored plan — composeAdaptation alone still cannot tell (the guard now lives one layer up)', () => {
  it('composeAdaptation on its own still cannot distinguish contaminated pricing from genuine gain — that is why the convergence guard had to live in shadow-compare.ts, not here', () => {
    // Confirmed by reading `web-v2/lib/adaptation/shadow-compare.ts` in full
    // for this task, THEN AGAIN after the guard landed: `composeAdaptation`
    // itself still has no function reading `training_plans.authored_iso` or
    // comparing it against the last successful `reanchorActivePlan` run, and
    // by design never will — that is `authoring-convergence.ts` +
    // `shadow-compare.ts`'s job now, one layer up from this pure engine.
    // `docs/reports/pace-shadow-compare-2026-09-01.md` §3 originally named
    // this exact guard as "not built tonight, out of scope per the brief"
    // and proposed it in the same shape `detectVolume` already uses for
    // it in the same shape `detectVolume` already uses for
    // `CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION` — applied to the
    // authoring/recomputation boundary instead of to absorption.
    //
    // What this fixture CAN do honestly: construct the exact shape the
    // report describes as contaminated — a phase's `prescribedSecPerMi`
    // still priced by the pre-migration cascade (`generate.ts`'s VDOT path)
    // while `capacity.threshold` already reflects the canonical resolver —
    // and show that `composeAdaptation`, TODAY, cannot tell this apart from
    // Fixture 1's genuine PROGRESS. That is not a defect in
    // `composeAdaptation` (§8's own header says capacity resolution and the
    // decision layer are deliberately different owners) — it is exactly the
    // gap the convergence guard would need to close, one layer up, before
    // this proposal could be trusted.
    const i = baseInput();
    // A plan authored minutes ago, still carrying the OLD cascade's pricing
    // on its threshold-phase row (per the report: up to ~24h of drift before
    // the nightly 07:30 UTC `reanchorActivePlan` pass corrects it).
    i.capacity = capacityAt(430, { sourceMode: 'direct', confidence: 0.8 }); // the NEW canonical resolver's belief
    i.pace.phases = [{
      phaseLabel: 'QUALITY', prescribedSecPerMi: 462, rowCount: 6, // the OLD cascade's number, not yet rewritten
      firstDateISO: TODAY, lastDateISO: '2026-10-13',
    }];
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    const set = composeAdaptation(i);
    const p = paceOf(set);
    console.log('[F10 indistinguishable-from-genuine, pending the guard]', fmtPace(p));

    // The engine proposes PROGRESS — structurally identical to Fixture 1 —
    // because it has no field to read that would tell "genuine gain" apart
    // from "two brains pricing the same phase differently". This assertion
    // is the finding: it documents that the proposal goes through TODAY,
    // not that it should.
    expect(p?.decision).toBe('PROGRESS');
    // Marked here as the ready-for-when-it-lands case: once the guard
    // exists, re-running this exact fixture with a synthetic
    // `authored_iso` newer than the last `reanchorActivePlan` success should
    // flip this to a refusal or an explicit "contaminated" flag instead.
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 11 · A stable HOLD — evidence genuinely doesn't support
 * progression, and stays that way across repeated evaluation
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 11 · a stable HOLD, deterministic across repeated evaluation', () => {
  it('poor absorption holds PACE, identically, across three independent calls (minus resolvedAt)', () => {
    const i = baseInput();
    i.capacity = capacityAt(388); // capacity WOULD support a move
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS); // sessions WOULD corroborate it
    i.absorption = absorptionAt('poor'); // but the block is not being absorbed
    const runs = [1, 2, 3].map(() => composeAdaptation(i));
    const paces = runs.map((r) => paceOf(r));
    console.log('[F11 stable HOLD x3]', paces.map((p) => fmtPace(p)).join(' | '));

    for (const p of paces) {
      expect(p?.decision).toBe('HOLD');
      if (p?.target === 'PACE') {
        expect(p.reasonCodes).toContain('ABSORPTION_POOR');
        expect(p.proposed.value).toBe(p.previous.value); // never moves
      }
    }
    // Byte-identical apart from the resolvedAt timestamp — a pure function
    // of its inputs, not a coin flip that happened to land the same way
    // three times.
    const strip = (p: AdaptationProposal | null) => p ? { ...p, resolvedAt: '' } : null;
    expect(strip(paces[0])).toEqual(strip(paces[1]));
    expect(strip(paces[1])).toEqual(strip(paces[2]));
    for (const r of runs) expect(contradictionsIn(r)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 12 · Downward or restructure pressure — evidence argues for
 * something other than a simple upward pace move
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 12 · downward / restructure pressure, three distinct grounds', () => {
  it('12a · a session displaced by life, with a clear slot open → RESTRUCTURE/SCHEDULE', () => {
    const i = baseInput();
    i.schedule = { sessionsOutOfPlace: 1, clearSlotsAvailable: 2 };
    const set = composeAdaptation(i);
    const r = set.proposals.find((p) => p.target === 'SCHEDULE');
    console.log('[F12a RESTRUCTURE/SCHEDULE]', r ? `${r.decision} :: ${r.explanation}` : '(none)');
    expect(r?.decision).toBe('RESTRUCTURE');
    expect(r?.domain).toBe('SCHEDULE');
  });

  it('12b · marginal absorption, no safety trigger → RESTRUCTURE/SPECIFICITY (change the kind, not the amount)', () => {
    const i = baseInput();
    i.absorption = absorptionAt('marginal');
    i.state = stateAt('proceed'); // not a safety-argues-reduce state
    const set = composeAdaptation(i);
    const r = set.proposals.find((p) => p.target === 'SPECIFICITY');
    console.log('[F12b RESTRUCTURE/SPECIFICITY]', r ? `${r.decision} :: ${r.explanation}` : '(none)');
    expect(r?.decision).toBe('RESTRUCTURE');
    expect(r?.reasonCodes).toContain('STIMULUS_TYPE_CHANGED_RATHER_THAN_REDUCED');
  });

  it('12c · state argues reduce (a tired/compromised day) → REDUCE/RECOVERY, ranked ahead of everything else', () => {
    const i = baseInput();
    i.capacity = capacityAt(388); // PACE would otherwise have evidence to progress
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);
    i.state = stateAt('reduce');
    const set = composeAdaptation(i);
    const reduce = set.proposals.find((p) => p.domain === 'SAFETY');
    console.log('[F12c REDUCE/RECOVERY]', reduce ? `${reduce.decision} :: ${reduce.explanation}` : '(none)');
    expect(reduce?.decision).toBe('REDUCE');
    expect(reduce?.target).toBe('RECOVERY');
    // Rule 21: the earned PACE progression does not vanish — it is
    // withheld and SAID, as a HOLD naming the state, never silently dropped.
    const paceHold = set.proposals.find((p) => p.target === 'PACE');
    expect(paceHold?.decision).toBe('HOLD');
    expect(paceHold?.reasonCodes).toContain('STATE_SAYS_TODAY_IS_NOT_THE_DAY');
    expect(contradictionsIn(set)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE 13 · An extreme stated-goal change proves no effect on capacity —
 * the capacity-boundary fix, demonstrated directly against the real type
 * ═══════════════════════════════════════════════════════════════════════ */

describe('FIXTURE 13 · a 5K goal vs. an ultramarathon goal, same evidence → byte-identical proposal', () => {
  it('composeAdaptation cannot see a goal at all — the SAME input produces the SAME output regardless of any goal a caller has in mind', () => {
    // `AdaptationEngineInput` (adaptation-engine.ts §3) has no goal field, and
    // `_NoGoalInInput` (§7) is a compile-time assertion that adding one is a
    // build error. This fixture demonstrates the RUNTIME consequence of that
    // structural fact: no caller-side annotation — a 5K goal, an ultra goal,
    // no goal at all — can reach into this function and move its answer,
    // because there is no parameter through which it could.
    const i = baseInput();
    i.capacity = capacityAt(388);
    i.pace.sessions = controlledSessions(PACE_PROGRESS_MIN_SESSIONS);

    // Two calls. The ONLY difference between them is a comment describing a
    // goal the function is never told about — there is no `goal` argument to
    // pass, by construction.
    const underA_5kGoal = composeAdaptation(i); // "runner has stated a 5K goal"
    const underB_ultraGoal = composeAdaptation(i); // "runner has stated a 100-mile ultra goal"

    console.log('[F13 goal-invariant]', fmtPace(paceOf(underA_5kGoal)), '==', fmtPace(paceOf(underB_ultraGoal)));

    const strip = (set: AdaptationProposalSet) => ({
      ...set, resolvedAt: '', proposals: set.proposals.map((p) => ({ ...p, resolvedAt: '' })),
      deferred: set.deferred.map((p) => ({ ...p, resolvedAt: '' })),
    });
    expect(strip(underA_5kGoal)).toEqual(strip(underB_ultraGoal));
    expect(contradictionsIn(underA_5kGoal)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CORPUS DOES AND DOES NOT PROVE — see the report for the full
 * statement. Restated here, briefly, next to the fixtures themselves.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('corpus scope, stated in the file that carries it', () => {
  it('is a marker, not an assertion — the honest claim lives in the report', () => {
    // This corpus proves: composeAdaptation and checkPaceHrCompatibility, the
    // REAL functions, produce the documented decision on 13 explicit,
    // hand-authored AdaptationEngineInput shapes, including two multi-date
    // boundary walks over SYNTHETIC adjacent dates.
    //
    // It does NOT prove: that these shapes occur with any particular
    // frequency in real training; that the real database-shell loader
    // (`load-adaptation-engine.ts`) assembles these exact shapes correctly
    // from raw activity data (that is `_adaptation_engine.audit.test.ts`'s
    // job, against the one real account); or that a proposal stays sensible
    // across REAL elapsed days rather than synthetic ones — see
    // `pace-shadow-compare-2026-09-01.md` §2's determinism section for that
    // distinction, which still stands unresolved.
    expect(ADAPTATION_ENGINE_MODEL_VERSION).toBe('1.0.0');
    expect(NON_MOVING_DECISIONS.has('HOLD')).toBe(true);
  });
});
