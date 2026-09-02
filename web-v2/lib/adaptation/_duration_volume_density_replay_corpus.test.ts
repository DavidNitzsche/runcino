/**
 * lib/adaptation/_duration_volume_density_replay_corpus.test.ts · THE
 * DURATION / VOLUME / DENSITY REPLAY CORPUS.
 *
 * `docs/reports/pace-replay-corpus-2026-09-01.md` built 13 hand-authored
 * fixtures for the PACE lever, at the real `AdaptationEngineInput` shape, run
 * through the real unmodified `composeAdaptation`. It did not cover DURATION,
 * VOLUME or DENSITY with the same rigor. This file is that corpus's sibling
 * for the other three levers — same discipline, same explicit instruction:
 * do NOT build a general synthetic-history platform. A small, named,
 * hand-authored fixture set, run through the real engine, never a mock.
 *
 * ── WHAT "REAL ENGINE" MEANS HERE (identical to the PACE corpus) ───────────
 *
 * `composeAdaptation` (`adaptation-engine.ts`) is PURE — every input is a
 * plain value — so calling it directly IS calling the real decision layer,
 * the same one `resolveAdaptationProposals` (`load-adaptation-engine.ts`)
 * calls once it has finished the impure, DB-bound work of assembling a real
 * `AdaptationEngineInput`. There is no exported `detectVolume`/`detectDuration`/
 * `detectDensity` — each is a private lever inside `composeAdaptation`,
 * reached the same way every real caller reaches it: by reading the
 * `target: 'VOLUME'` / `'DURATION'` / `'DENSITY'` (or `'QUALITY_VOLUME'`, the
 * session lever's other name) arm of its output.
 *
 * Fixture 3 additionally calls `classifyAdaptation` (`adaptation-model.ts`)
 * and `filterExecutionEvidenceByPrescribedWindow` / `prescribedWindowsFrom`
 * (`load.ts` / `normal-window.ts`) directly and unmocked — the exact same
 * real, pure functions `_absorption_split.test.ts` and
 * `docs/reports/absorption-reader-split-2026-09-01.md` already exercised for
 * the `representative_execution` shadow-mode split, reused here to build the
 * ABSORPTION verdict half of a DURATION fixture instead of reading it off a
 * database. `load.ts` is on this task's do-not-touch list — nothing in this
 * file edits it; `filterExecutionEvidenceByPrescribedWindow` is only ever
 * CALLED, at its existing exported signature, never modified.
 *
 * ── FIXTURE STYLE ─────────────────────────────────────────────────────────
 *
 * Every fixture builder mirrors `_adaptation_engine.test.ts`'s /
 * `_pace_replay_corpus.test.ts`'s own `capacityAt`/`stateAt`/`absorptionAt`/
 * `session`/`baseInput` helpers (duplicated here rather than imported,
 * matching those files' own un-shared, per-file convention). Every scenario
 * prints its real engine output via `console.log` so this file doubles as
 * the source `docs/reports/duration-volume-density-fixture-corpus-2026-09-01.md`
 * quotes verbatim from a real `npx vitest run --reporter=verbose` invocation.
 *
 * ── FALSIFICATION (Rule 18) ──────────────────────────────────────────────
 *
 * At least 2-3 fixtures per lever are falsified: the specific input clause
 * argued to drive the decision is flipped (or, for Fixture 3, the real
 * `filterExecutionEvidenceByPrescribedWindow` is called with an EMPTY window
 * list — the exact input state that exists when the Rule-8 exclusion is
 * inert, since editing `load.ts` itself is off-limits) and the decision is
 * asserted to come back WRONG, before the real, unbroken call is asserted to
 * come back right. A fixture that cannot be made to fail this way is not
 * proven to test anything.
 */
import { describe, it, expect } from 'vitest';
import {
  composeAdaptation,
  contradictionsIn,
  ADAPTATION_ENGINE_MODEL_VERSION,
  VOLUME_PROGRESS_MIN_ABSORBED_WEEKS,
  DURATION_PROGRESS_MIN_TOLERATED_LONGS,
  densityRefusalFor,
  type AdaptationEngineInput,
  type AdaptationProposal,
  type AdaptationProposalSet,
  type EngineRefusal,
  type EvidenceLookback,
  type LongRunRead,
  type QualitySessionRead,
} from './adaptation-engine';
import { classifyAdaptation, type AdaptationInput } from './adaptation-model';
import { filterExecutionEvidenceByPrescribedWindow } from './load';
import { prescribedWindowsFrom, type RanRace } from '@/lib/training/normal-window';
import type { ProgressionResolution } from '@/lib/plan/progression-pass';
import type { RunnerState, StateDecision } from '@/lib/training/runner-state';
import type { ResolvedCapacity } from '@/lib/training/prescription-resolver';
import type { AdaptationVerdict } from './adaptation-model';

const TODAY = '2026-09-01';

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE BUILDERS — mirroring `_pace_replay_corpus.test.ts` exactly
 * ═══════════════════════════════════════════════════════════════════════ */

const capacityAt = (thresholdSecPerMi = 400): ResolvedCapacity => ({
  threshold: {
    paceSecPerMi: thresholdSecPerMi, vdot: 50, confidence: 0.8, sourceMode: 'direct',
    evidenceIds: ['cap-1', 'cap-2', 'cap-3'], resolvedAt: `${TODAY}T00:00:00Z`,
    reasons: ['DIRECT_CORROBORATED_THRESHOLD_EVIDENCE'], modelVersion: '1.0.0',
  },
  highIntensity: {
    intervalPaceSecPerMi: thresholdSecPerMi - 25, repetitionPaceSecPerMi: thresholdSecPerMi - 45,
    vdot: 50, confidence: 0.6, sourceMode: 'vdot_fallback', evidenceIds: [],
    resolvedAt: `${TODAY}T00:00:00Z`, reasons: [], modelVersion: '1.0.0',
  },
  easyCeiling: {
    ceilingSecPerMi: thresholdSecPerMi + 90, confidence: 0.7, sourceMode: 'direct', evidenceIds: [],
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

const stateAt = (decision: StateDecision = 'proceed'): RunnerState => ({
  decision,
  driver: decision === 'proceed' ? null : {
    kind: 'convergence', argues: decision, driving: true,
    detail: `convergence argues ${decision}`, evidence: {},
  },
  signals: [], readable: true, todayISO: TODAY,
  resolvedAt: `${TODAY}T00:00:00Z`, modelVersion: '1.0.0',
});

const DECISION_FOR_BAND: Record<AdaptationVerdict['band'], AdaptationVerdict['decision']> = {
  strong: 'PROGRESS', normal: 'PROGRESS', marginal: 'STAY', poor: 'MODIFY',
};

const absorptionAt = (band: AdaptationVerdict['band']): AdaptationVerdict => ({
  band, confidence: 'high', decision: DECISION_FOR_BAND[band],
  stepMultiplier: band === 'strong' ? 1.25 : band === 'normal' ? 1 : band === 'marginal' ? 0 : -0.5,
  dimensions: [], veto: null, summary: `absorption reads ${band}`,
});

const freshLookback = (): EvidenceLookback => ({
  baseWindowDays: 28, windowDays: 28, representativeDays: 28,
  excludedDays: 0, stalenessFactor: 1, reachedOuterBound: false,
});

const longRun = (dateISO: string, overrides: Partial<LongRunRead> = {}): LongRunRead => ({
  activityId: `long-${dateISO}`,
  dateISO,
  distanceMi: 16,
  durabilityEvidence: true,
  lateRunPacingCollapse: false,
  residualCardiovascularLoad: false,
  executionQuality: 'controlled',
  ...overrides,
});

/** The neutral world: nothing earned, nothing wrong, every lever refuses or
 *  holds by default — mirrors `_adaptation_engine.test.ts`'s own baseline
 *  exactly, so editing only ONE lever's slice isolates it the same way the
 *  real loader's per-lever inputs would. */
const baseInput = (): AdaptationEngineInput => ({
  todayISO: TODAY,
  capacity: capacityAt(400),
  state: stateAt('proceed'),
  absorption: absorptionAt('normal'),
  pace: {
    phases: [{ phaseLabel: null, prescribedSecPerMi: 400, rowCount: 1, firstDateISO: TODAY, lastDateISO: TODAY }],
    sessions: [],
    lookback: freshLookback(),
  },
  load: {
    currentWeeklyMi: 45,
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

/* ── Reporting helpers — print the REAL engine output verbatim ─────────── */

function targetOf(set: AdaptationProposalSet, target: AdaptationProposal['target']): AdaptationProposal | null {
  return set.proposals.find((p) => p.target === target)
    ?? set.deferred.find((p) => p.target === target)
    ?? null;
}
const durationOf = (set: AdaptationProposalSet) => targetOf(set, 'DURATION');
const volumeOf = (set: AdaptationProposalSet) => targetOf(set, 'VOLUME');
const densityOf = (set: AdaptationProposalSet) =>
  targetOf(set, 'DENSITY') ?? targetOf(set, 'QUALITY_VOLUME');
const refusalFor = (set: AdaptationProposalSet, lever: EngineRefusal['lever']): EngineRefusal | null =>
  set.refusals.find((r) => r.lever === lever) ?? null;

function fmtMag(p: AdaptationProposal | null): string {
  if (!p) return '(no proposal)';
  const v = (m: { value?: number; reps?: number }) =>
    m.value != null ? m.value : `reps=${m.reps}`;
  return `${p.decision} conf=${p.confidence.toFixed(3)} [${p.reasonCodes.join(',')}] `
    + `${v(p.previous as { value?: number; reps?: number })}->${v(p.proposed as { value?: number; reps?: number })} `
    + `:: "${p.explanation}"`;
}
function fmtRefusal(r: EngineRefusal | null): string {
  if (!r) return '(no refusal)';
  return `REFUSED lever=${r.lever} code=${r.code} :: "${r.detail}"`;
}
function fmtVerdict(v: AdaptationVerdict): string {
  const exec = v.dimensions.find((d) => d.dimension === 'execution');
  return `${v.band}/${v.decision} execution=${exec?.score?.toFixed(3) ?? 'null'} :: "${v.summary}"`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * DURATION · 1 — a long run tolerated cleanly, absorption genuinely good
 * ═══════════════════════════════════════════════════════════════════════ */

describe('DURATION 1 · long run tolerated cleanly, absorption good → PROGRESS', () => {
  it('composeAdaptation proposes DURATION PROGRESS off one controlled long run', () => {
    const i = baseInput();
    i.absorption = absorptionAt('normal');
    i.longRun.recent = [longRun('2026-08-24')];
    const set = composeAdaptation(i);
    const p = durationOf(set);
    console.log('[DURATION-1 PROGRESS]', fmtMag(p));

    expect(p?.decision).toBe('PROGRESS');
    expect(p?.domain).toBe('LOAD');
    expect(p?.previous).toEqual({ unit: 'long_run_mi', value: 16 });
    expect((p?.proposed as { value: number }).value).toBeGreaterThan(16);
    expect(p?.reasonCodes).toContain('LONG_RUN_TOLERATED_WITHOUT_COLLAPSE');
    expect(contradictionsIn(set)).toEqual([]);

    // FALSIFY · the same clean long run, with absorption pulled to marginal,
    // must NOT still progress — proving the PROGRESS above genuinely rests
    // on the absorption read, not merely on the long run being present.
    const broken = composeAdaptation({ ...i, absorption: absorptionAt('marginal') });
    console.log('[DURATION-1 FALSIFY · absorption forced marginal]', fmtMag(durationOf(broken)));
    expect(durationOf(broken)?.decision).toBe('HOLD');
    expect(durationOf(broken)?.reasonCodes).toContain('ABSORPTION_MARGINAL');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DURATION · 2 — long run tolerated but absorption marginal → held correctly
 * ═══════════════════════════════════════════════════════════════════════ */

describe('DURATION 2 · long run tolerated but absorption marginal → HOLD (never a finding about the run itself)', () => {
  it('the absorption gate blocks DURATION before the long run evidence is even read', () => {
    const i = baseInput();
    i.absorption = absorptionAt('marginal');
    i.longRun.recent = [longRun('2026-08-24')]; // the exact same clean long run as DURATION-1
    const set = composeAdaptation(i);
    const p = durationOf(set);
    console.log('[DURATION-2 HOLD]', fmtMag(p));

    expect(p?.decision).toBe('HOLD');
    expect(p?.previous).toEqual({ unit: 'long_run_mi', value: 16 });
    expect(p?.proposed).toEqual({ unit: 'long_run_mi', value: 16 }); // unmoved
    expect(p?.reasonCodes).toContain('ABSORPTION_MARGINAL');
    expect(contradictionsIn(set)).toEqual([]);

    // FALSIFY · restore absorption to normal on the identical long-run
    // evidence and confirm it flips to PROGRESS — proving the hold above is
    // driven by the absorption band, not by some property of the run itself.
    const fixed = composeAdaptation({ ...i, absorption: absorptionAt('normal') });
    console.log('[DURATION-2 FALSIFY · absorption restored to normal]', fmtMag(durationOf(fixed)));
    expect(durationOf(fixed)?.decision).toBe('PROGRESS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DURATION · 3 — a long run inside a taper/recovery window: today's LIVE
 * behaviour (unfiltered absorption) vs. the not-yet-promoted
 * `representative_execution` counterfactual
 *
 * `docs/reports/absorption-reader-split-2026-09-01.md` traced `detectDuration`
 * directly and found its absorption gate is fed `actual_load_absorption` —
 * the RAW 42-day window, no taper/race/recovery exclusion — and named this
 * as the exact live mechanism that would flip once a human promotes
 * `representative_execution`. This fixture builds that concrete shape: the
 * same 8-session history read two ways through the REAL `classifyAdaptation`,
 * feeding each verdict into the REAL `composeAdaptation` and showing
 * DURATION's decision differ.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('DURATION 3 · taper-masked absorption — live (unfiltered) vs. not-yet-promoted representative_execution', () => {
  const RACE: RanRace = { slug: 'fixture-half-d3', dateISO: '2026-08-16', distanceMi: 13.1, priority: 'A' };
  // prescribedWindowsFrom([this race]) excludes 2026-08-02..2026-08-30 — the
  // identical half-marathon taper+recovery shape `_absorption_split.test.ts`
  // uses for its own HALF_A fixture.

  const planned = (dateISO: string) =>
    ({ dateISO, readable: true, read: { state: 'AS_PLANNED' as const, stimulusCompletion: 1 }, earnsProgression: true });
  const missed = (dateISO: string) =>
    ({ dateISO, readable: true, read: { state: 'MISSED' as const, stimulusCompletion: 0 }, earnsProgression: false });

  // 3 genuinely clean sessions BEFORE the taper window, 5 missed INSIDE it —
  // a taper+recovery block that eats most of an otherwise-clean runner's
  // 8-session read.
  const raw = [
    planned('2026-07-07'), planned('2026-07-14'), planned('2026-07-21'),
    missed('2026-08-05'), missed('2026-08-10'), missed('2026-08-15'),
    missed('2026-08-20'), missed('2026-08-25'),
  ];
  // Present identically in both outputs by design (this split forks the
  // execution dimension only, per `load.ts`'s own header) — a steady,
  // unremarkable consistency read so it never itself decides the band.
  const CONSISTENCY: Pick<AdaptationInput, 'weeklyPlannedMi' | 'weeklyActualMi'> = {
    weeklyPlannedMi: [40, 40, 40], weeklyActualMi: [38, 38, 38],
  };
  const BLANK: AdaptationInput = {
    keySessionExecutions: null, keySessionsPlanned: null, keySessionsCompleted: null,
    targetVerdicts: null, repConsistency: null, rpeReported: null, rpeHarderThanExpected: null,
    decouplingVerdicts: null, lateDriftBpm: null, easyDiscipline: null,
    recoveryPctOfExpected: null, readinessBelowNormalDays: null, readinessWindowDays: null,
    weeklyPlannedMi: null, weeklyActualMi: null, trainingForm: null,
    distinctEvidenceWeeks: null, adapterDowngrades: null,
    niggleSeverity: null, illnessActive: null, injuryActive: null,
  };

  const unfilteredVerdict = classifyAdaptation({
    ...BLANK, ...CONSISTENCY,
    keySessionExecutions: raw.map((r) => ({
      state: r.read.state, stimulusCompletion: r.read.stimulusCompletion, earnsProgression: r.earnsProgression,
    })),
  });

  const realWindows = prescribedWindowsFrom([RACE]);
  const filteredRealFields = filterExecutionEvidenceByPrescribedWindow(raw, [], realWindows);
  const filteredRealVerdict = classifyAdaptation({ ...BLANK, ...CONSISTENCY, ...filteredRealFields });

  it('today, LIVE: the unfiltered (taper-diluted) verdict blocks DURATION even though the long run itself was tolerated', () => {
    console.log('[DURATION-3 unfiltered/actual_load_absorption]', fmtVerdict(unfilteredVerdict));
    const i = baseInput();
    i.absorption = unfilteredVerdict;
    i.longRun.recent = [longRun('2026-08-24')]; // tolerated, controlled, no collapse
    const set = composeAdaptation(i);
    const p = durationOf(set);
    console.log('[DURATION-3 LIVE]', fmtMag(p));

    expect(unfilteredVerdict.band).toBe('marginal');
    expect(p?.decision).toBe('HOLD');
    expect(p?.reasonCodes).toContain('ABSORPTION_MARGINAL');
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('counterfactual: the representative_execution verdict (not wired live) would permit DURATION to read the same long run', () => {
    console.log('[DURATION-3 filtered/representative_execution]', fmtVerdict(filteredRealVerdict));
    const i = baseInput();
    i.absorption = filteredRealVerdict;
    i.longRun.recent = [longRun('2026-08-24')];
    const set = composeAdaptation(i);
    const p = durationOf(set);
    console.log('[DURATION-3 COUNTERFACTUAL]', fmtMag(p));

    expect(filteredRealVerdict.band).toBe('normal');
    expect(p?.decision).toBe('PROGRESS');
    expect(p?.reasonCodes).toContain('LONG_RUN_TOLERATED_WITHOUT_COLLAPSE');
    expect(contradictionsIn(set)).toEqual([]);
  });

  it('FALSIFY · calling the real filter with NO prescribed windows (the "filtering is inert" state) collapses back to the live HOLD', () => {
    // `load.ts` is off-limits to edit, so the break is applied at the INPUT
    // the real, unmodified `filterExecutionEvidenceByPrescribedWindow` is
    // given, not to its source: an empty window list is exactly the state
    // that exists when `isPrescribedNonNormal` can exclude nothing.
    const brokenFields = filterExecutionEvidenceByPrescribedWindow(raw, [], []);
    const brokenVerdict = classifyAdaptation({ ...BLANK, ...CONSISTENCY, ...brokenFields });
    console.log('[DURATION-3 FALSIFY · windows=[]]', fmtVerdict(brokenVerdict));
    expect(brokenVerdict.band).toBe(unfilteredVerdict.band); // collapses to the live read
    expect(brokenVerdict.band).not.toBe(filteredRealVerdict.band); // and is NOT the counterfactual

    const i = baseInput();
    i.absorption = brokenVerdict;
    i.longRun.recent = [longRun('2026-08-24')];
    const set = composeAdaptation(i);
    console.log('[DURATION-3 FALSIFY compose]', fmtMag(durationOf(set)));
    expect(durationOf(set)?.decision).toBe('HOLD'); // the wrong verdict, confirming the real windows were load-bearing
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DURATION · 4 — insufficient long-run evidence in the window
 * ═══════════════════════════════════════════════════════════════════════ */

describe('DURATION 4 · no long run in the window → INSUFFICIENT_EVIDENCE, never a HOLD', () => {
  it('an empty longRun.recent is an absence, not a finding against the runner', () => {
    const i = baseInput();
    i.absorption = absorptionAt('normal'); // permits — isolates the "no evidence" branch
    i.longRun.recent = [];
    const set = composeAdaptation(i);
    const p = durationOf(set);
    console.log('[DURATION-4 INSUFFICIENT]', fmtMag(p));

    expect(p?.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(p?.reasonCodes).toContain('NO_LONG_RUN_EVIDENCE_IN_WINDOW');
    expect(p?.proposed).toEqual({ unit: 'long_run_mi', value: 16 });
    expect(contradictionsIn(set)).toEqual([]);
    // Rule 11, asserted structurally: an INSUFFICIENT_EVIDENCE proposal may
    // never carry a reason code that asserts a finding.
    expect(p?.reasonCodes).not.toContain('LONG_RUN_SHOWED_LATE_COLLAPSE');

    // FALSIFY · add exactly the one tolerated long run this bar requires
    // (DURATION_PROGRESS_MIN_TOLERATED_LONGS) and confirm it stops refusing
    // — proving "empty window" is genuinely what drove the refusal above.
    expect(DURATION_PROGRESS_MIN_TOLERATED_LONGS).toBe(1);
    const fixed = composeAdaptation({ ...i, longRun: { ...i.longRun, recent: [longRun('2026-08-24')] } });
    console.log('[DURATION-4 FALSIFY · one long run added]', fmtMag(durationOf(fixed)));
    expect(durationOf(fixed)?.decision).toBe('PROGRESS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * VOLUME · 5 — a mature, absorbed plan with headroom → PROGRESS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('VOLUME 5 · load absorbed for the required weeks, headroom in the band → PROGRESS', () => {
  it('composeAdaptation proposes VOLUME PROGRESS off three absorbed weeks', () => {
    const i = baseInput();
    i.load.currentWeeklyMi = 45;
    i.load.recentWeeks = [
      { weekStartISO: '2026-08-24', completedMi: 45, scheduledMi: 45 },
      { weekStartISO: '2026-08-17', completedMi: 44, scheduledMi: 45 },
      { weekStartISO: '2026-08-10', completedMi: 43, scheduledMi: 45 },
    ];
    // Present but NOT the ceiling on this path — the mature branch never
    // reaches `historicalTolerance` at all (see `detectVolume`'s "two
    // questions kept apart"). Set consistently anyway to show it agrees
    // rather than to exercise it.
    i.load.historicalTolerance = { ok: true, sustainedWeeklyMi: 50, representativeDays: 90, oldestISO: '2026-06-01' };
    const set = composeAdaptation(i);
    const p = volumeOf(set);
    console.log('[VOLUME-5 PROGRESS]', fmtMag(p));

    expect(p?.decision).toBe('PROGRESS');
    expect(p?.previous).toEqual({ unit: 'weekly_mi', value: 45 });
    expect((p?.proposed as { value: number }).value).toBeGreaterThan(45);
    expect(p?.reasonCodes).toContain('RECENT_LOAD_ABSORBED');
    expect(p?.reasonCodes).not.toContain('HISTORICAL_VOLUME_TOLERANCE_ESTABLISHED'); // this path never reads it
    expect(contradictionsIn(set)).toEqual([]);

    // FALSIFY · drop two of the three weeks below the 90% absorbed share and
    // confirm it holds — proving the PROGRESS above genuinely rests on
    // `absorbed.length >= VOLUME_PROGRESS_MIN_ABSORBED_WEEKS`.
    expect(VOLUME_PROGRESS_MIN_ABSORBED_WEEKS).toBe(2);
    const broken = composeAdaptation({
      ...i,
      load: {
        ...i.load,
        recentWeeks: [
          { weekStartISO: '2026-08-24', completedMi: 20, scheduledMi: 45 },
          { weekStartISO: '2026-08-17', completedMi: 20, scheduledMi: 45 },
          { weekStartISO: '2026-08-10', completedMi: 43, scheduledMi: 45 },
        ],
      },
    });
    console.log('[VOLUME-5 FALSIFY · only 1 of 3 weeks absorbed]', fmtMag(volumeOf(broken)));
    expect(volumeOf(broken)?.decision).toBe('HOLD');
    expect(volumeOf(broken)?.reasonCodes).toContain('LOAD_NOT_YET_ABSORBED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * VOLUME · 6 — historical tolerance BELOW the prescribed week: the exact
 * pattern found on the owner's real account the night
 * absorption-reader-split-2026-09-01.md was written (current 45 mi/wk
 * prescribed, one-day-old plan, historical tolerance 33.4 mi/wk)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('VOLUME 6 · historical tolerance below the prescribed week → HOLD, correctly reasoned', () => {
  it('mirrors the owner\'s real account: plan one week old, current 45 mi/wk, history 33.4 mi/wk', () => {
    const i = baseInput();
    i.load.currentWeeklyMi = 45;
    i.load.recentWeeks = [{ weekStartISO: '2026-08-31', completedMi: 20, scheduledMi: 45 }]; // 1 week — too young
    i.load.historicalTolerance = { ok: true, sustainedWeeklyMi: 33.4, representativeDays: 84, oldestISO: '2026-06-02' };
    const set = composeAdaptation(i);
    const p = volumeOf(set);
    console.log('[VOLUME-6 HOLD]', fmtMag(p));

    expect(p?.decision).toBe('HOLD');
    expect(p?.previous).toEqual({ unit: 'weekly_mi', value: 45 });
    expect(p?.proposed).toEqual({ unit: 'weekly_mi', value: 45 }); // unmoved
    expect(p?.reasonCodes).toContain('CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION');
    expect(p?.reasonCodes).toContain('LOAD_NOT_YET_ABSORBED');
    expect(contradictionsIn(set)).toEqual([]);

    // FALSIFY · raise the SAME young plan's historical tolerance clearly
    // above the CURRENT week (not merely above the 90% bar — a value between
    // the two, like 44, clears the absorption test but still sits below
    // `current`, which correctly holds too, for a different reason: the
    // ceiling itself has no headroom past 45. 50 clears both) and confirm it
    // flips to PROGRESS — proving the hold above genuinely rests on
    // `33.4 < 45*0.9`, not merely on the plan being young.
    const fixed = composeAdaptation({
      ...i,
      load: { ...i.load, historicalTolerance: { ok: true, sustainedWeeklyMi: 50, representativeDays: 84, oldestISO: '2026-06-02' } },
    });
    console.log('[VOLUME-6 FALSIFY · historical raised to 50]', fmtMag(volumeOf(fixed)));
    expect(volumeOf(fixed)?.decision).toBe('PROGRESS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * VOLUME · 7 — a plan too young to judge current-week absorption, correctly
 * falling back to (already-filtered) historical tolerance: the Rule 8 fix
 * this file's own header names — "a plan authored yesterday knows nothing
 * about a runner who has held 43 mi/wk since June"
 * ═══════════════════════════════════════════════════════════════════════ */

describe('VOLUME 7 · young plan falls back to historical tolerance → PROGRESS, capped to what history actually supports', () => {
  it('a one-day-old plan at 38 mi/wk does not erase months of 44 mi/wk tolerance', () => {
    const i = baseInput();
    i.load.currentWeeklyMi = 38;
    i.load.recentWeeks = [{ weekStartISO: '2026-08-31', completedMi: 10, scheduledMi: 38 }]; // 1 week — too young
    i.load.historicalTolerance = { ok: true, sustainedWeeklyMi: 44, representativeDays: 90, oldestISO: '2026-06-01' };
    const set = composeAdaptation(i);
    const p = volumeOf(set);
    console.log('[VOLUME-7 PROGRESS via fallback]', fmtMag(p));

    expect(p?.decision).toBe('PROGRESS');
    expect(p?.previous).toEqual({ unit: 'weekly_mi', value: 38 });
    const proposedVal = (p?.proposed as { value: number }).value;
    expect(proposedVal).toBeGreaterThan(38);
    // Capped to what history demonstrates, never past it (Rule 8's corollary
    // in the other direction — "the history says he tolerates 43, not 48").
    expect(proposedVal).toBeLessThanOrEqual(44);
    expect(p?.reasonCodes).toContain('HISTORICAL_VOLUME_TOLERANCE_ESTABLISHED');
    expect(p?.reasonCodes).toContain('CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION');
    expect(p?.reasonCodes).toContain('STEP_HELD_TO_DEMONSTRATED_HISTORICAL_VOLUME');
    expect(contradictionsIn(set)).toEqual([]);

    // FALSIFY · the identical young plan with history BELOW the bar (VOLUME-6's
    // own number) must hold instead — proving the fallback ceiling, not plan
    // youth alone, is what licenses PROGRESS here.
    const broken = composeAdaptation({
      ...i,
      load: { ...i.load, historicalTolerance: { ok: true, sustainedWeeklyMi: 33.4, representativeDays: 84, oldestISO: '2026-06-02' } },
    });
    console.log('[VOLUME-7 FALSIFY · historical dropped to 33.4]', fmtMag(volumeOf(broken)));
    expect(volumeOf(broken)?.decision).toBe('HOLD');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DENSITY · 8 — a plan row that DOES carry a progression-block marker →
 * evaluable, not refused
 * ═══════════════════════════════════════════════════════════════════════ */

describe('DENSITY 8 · an authored progression block is evaluable → PROGRESS, never refused', () => {
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

  it('a resolved gate with a denser resolution proposes DENSITY PROGRESS, not a refusal', () => {
    const i = baseInput();
    i.density = { gate: 'RESOLVED', resolutions: [denserResolution()] };
    const set = composeAdaptation(i);
    const p = densityOf(set);
    console.log('[DENSITY-8 PROGRESS]', fmtMag(p));
    console.log('[DENSITY-8 refusals]', set.refusals.map((r) => fmtRefusal(r)).join(' | ') || '(none)');

    expect(p?.decision).toBe('PROGRESS');
    expect(p?.target).toBe('DENSITY');
    expect(p?.reasonCodes).toContain('PROGRESSION_GATE_RESOLVED_A_DENSER_SESSION');
    expect(refusalFor(set, 'DENSITY')).toBeNull();
    expect(contradictionsIn(set)).toEqual([]);

    // FALSIFY · the identical resolution, but the gate reports no authored
    // block (DENSITY-9's own shape) — confirms the evaluability above rests
    // on `gate === 'RESOLVED'`, not on the resolution content alone.
    const broken = composeAdaptation({ ...i, density: { gate: 'NO_AUTHORED_PROGRESSION_BLOCK', resolutions: [] } });
    console.log('[DENSITY-8 FALSIFY · gate forced to NO_AUTHORED_PROGRESSION_BLOCK]', fmtRefusal(refusalFor(broken, 'DENSITY')));
    expect(densityOf(broken)).toBeNull();
    expect(refusalFor(broken, 'DENSITY')?.code).toBe('NO_PROGRESSION_TARGETS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DENSITY · 9 — a plan row that does NOT carry a progression-block marker →
 * refuses with NO_PROGRESSION_TARGETS, never silently does nothing
 * ═══════════════════════════════════════════════════════════════════════ */

describe('DENSITY 9 · no authored progression block → an explicit NO_PROGRESSION_TARGETS refusal', () => {
  it('the authoring gap is named, not silence', () => {
    const i = baseInput(); // default density slice: gate 'NO_AUTHORED_PROGRESSION_BLOCK', resolutions: []
    const set = composeAdaptation(i);
    const r = refusalFor(set, 'DENSITY');
    console.log('[DENSITY-9 REFUSAL]', fmtRefusal(r));

    expect(densityOf(set)).toBeNull();
    expect(r).not.toBeNull();
    expect(r?.code).toBe('NO_PROGRESSION_TARGETS');
    expect(r?.detail).toMatch(/authoring gap/i);
    // The refusal names WHICH reason applies — matches the exported helper
    // exactly, so a consumer and this corpus read the same sentence.
    expect(r).toEqual(densityRefusalFor('NO_AUTHORED_PROGRESSION_BLOCK'));
    expect(contradictionsIn(set)).toEqual([]);

    // FALSIFY · hand the gate a resolved block (DENSITY-8's own resolution)
    // and confirm the refusal disappears and a PROGRESS proposal appears in
    // its place — proving the refusal above is not simply "density never
    // fires," but genuinely gated on `gate !== 'RESOLVED'`.
    const fixed = composeAdaptation({
      ...i,
      density: {
        gate: 'RESOLVED',
        resolutions: [{
          workoutId: 'pw-2', dateISO: '2026-09-02', family: 'threshold', action: 'ACCELERATE',
          shape: { reps: 4, repMinutes: 10, recoveryMinutes: 2, paceSPerMi: 400, zone: 'PROGRESSIVE' },
          authored: { reps: 4, repMinutes: 8, recoveryMinutes: 3, paceSPerMi: 400, zone: 'ESTABLISHED' },
          authoredLever: 'quality_duration', lever: 'work_density',
          why: 'Absorbing the block well. Same pace, less recovery.', changed: true,
        }],
      },
    });
    console.log('[DENSITY-9 FALSIFY · gate resolved]', fmtMag(densityOf(fixed)));
    expect(refusalFor(fixed, 'DENSITY')).toBeNull();
    expect(densityOf(fixed)?.decision).toBe('PROGRESS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SHAPE CHECK · the model version this corpus was run against, so a future
 * bump is visible in the report rather than silently re-dating it
 * ═══════════════════════════════════════════════════════════════════════ */

describe('DVD corpus · model version pin', () => {
  it('records the engine version this corpus ran against', () => {
    console.log('[DVD CORPUS] ADAPTATION_ENGINE_MODEL_VERSION =', ADAPTATION_ENGINE_MODEL_VERSION);
    // 1.1.0 (2026-09-02) · the LOAD levers this corpus exercises gained three
    // evidence requirements (see the constant's own changelog). Every fixture
    // above still lands on its documented decision because each one describes
    // a progression week with a READ absorption verdict — the new gates bite
    // only on a cutback/race/taper week ahead or an unreadable runner, both
    // covered in `_adaptation_engine.test.ts` on both sides.
    expect(ADAPTATION_ENGINE_MODEL_VERSION).toBe('1.1.0');
  });
});
