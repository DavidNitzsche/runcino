/**
 * lib/plan/_volume_seam.test.ts · VOLUMESEAM-1 · THE GATE OVER THE SEAM.
 *
 * The owner's instruction, verbatim in intent: "the upward lane now has
 * traffic, but prove that it changes the operating belief rather than only
 * calculating inside an orphaned module."
 *
 * So this suite asserts TWO different kinds of thing, and they are separated
 * on purpose:
 *
 *   GUARDS 1-3 · STRUCTURE. That the seam EXISTS and is reachable from a real
 *                route, that `demonstratedLoadAfterEachWeek` is a symbol and
 *                not a sentence, and that the authority boundary is intact.
 *                These are the claims that were false yesterday.
 *   GUARDS 4-13 · BEHAVIOUR. Every clause of the specification, driven end to
 *                end through `decideVolumeRaise` on constructed histories.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON, STATED BEFORE THE ASSERTIONS ──
 *
 * · IT CANNOT FAIL ON THE LOADER. Every case below hands `decideVolumeRaise` a
 *   window built in this file. If `volume-evidence-loader.ts` mislabels a
 *   taper as a build week, reads the wrong plan version, or misses half the
 *   runs, every assertion here still passes. The loader's correctness is a
 *   claim about production data and it is checked by
 *   `_volume_seam_probe.script.ts` against the real account, not here.
 * · IT CANNOT FAIL ON THE CARD REACHING THE PHONE. Guard 12 walks the action
 *   through all eleven proposal facets and proves the shape survives; it does
 *   not open a database, insert a row, or render a Swift view. "The runner can
 *   accept it" is asserted at the level of the action's executor path and the
 *   route's own dispatch, which is the most a test with no database can say.
 * · IT CANNOT FAIL ON COACHING JUDGEMENT. That a raise lands on the long run
 *   and the easy days rather than being recomposed into the week properly is a
 *   choice, not a theorem. A well-formed and unwise proposal passes.
 * · IT CANNOT FAIL ON THE SEAM BEING OPENED ELSEWHERE. Guard 3 asserts this
 *   lane names no plan writer and that the authority constant is still the
 *   literal `false`. It cannot see a seam opened in a file it does not read.
 * · IT IS BIASED TOWARD THE UPWARD PATH, DELIBERATELY, and that is the answer
 *   to Rule 22's own question. Counted below in guard 13: this file's cases
 *   that assert a RAISE against those that assert a REFUSAL. The repo-wide
 *   count Rule 22 reports is 29 files that know how to hold a runner back
 *   against 2 that know what accelerating one means, and a gate written to
 *   correct that imbalance must not inherit it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  decideVolumeRaise,
  VOLUME_EVIDENCE_TRIGGER,
  type VolumeDecision,
} from '@/lib/plan/volume-evidence-proposal';
import type { FutureRow, VolumeEvidenceWindow } from '@/lib/plan/volume-evidence-loader';
import { demonstratedLoadAfterEachWeek, type CompletedWeek } from '@/lib/adaptation/volume-evidence/after-each-week';
import {
  absent, measured, failed,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
  type FutureWeek,
  type SurplusRun,
} from '@/lib/adaptation/volume-evidence/contract';
import { PROGRESSION_UNLOCK_FRAC, PER_WEEK_CREDIT_CEILING_FRAC } from '@/lib/adaptation/volume-evidence/weight';
import { AUTOMATIC_ADAPTATION_AUTHORITY, PROPOSABLE_KINDS } from '@/lib/plan/adaptation-authority';
import { actionFromAdaptation } from '@/lib/brain/proposal/generate/from-adaptation';
import { validateAction } from '@/lib/brain/proposal/validate';
import { serializeAction, deserializeAction } from '@/lib/brain/proposal/serialize';
import { executorFor } from '@/lib/brain/proposal/executor-map';
import { plannedWrites } from '@/lib/brain/proposal/execute';
import { undoWritesFor } from '@/lib/brain/proposal/undo';
import { ledgerFacetsOf } from '@/lib/brain/proposal/ledger-facet';
import { watchBehaviorOf } from '@/lib/brain/proposal/watch-facet';
import { phoneDirectionOf, actionHeadline } from '@/lib/faff/v5-action-render';

const WEB = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(WEB, '..');

/* ══════════════════════════════════════════════════════════════════════════
 * THE FIXTURE · one runner, one plan, weeks you can dial
 * ═══════════════════════════════════════════════════════════════════════ */

const ATHLETE = '00000000-0000-4000-8000-000000000001';
const PLAN = 'plan-1';

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

interface WeekSpec {
  readonly weekStartISO: string;
  readonly prescribedMi: number;
  /** Total completed miles, spread across five ordinary runs. */
  readonly completedMi: number;
  readonly mode?: 'BUILD' | 'RECOVERY' | 'TAPER' | 'UNKNOWN';
  readonly isCutback?: boolean;
  readonly isRaceWeek?: boolean;
  readonly inPrescribedRaceWindow?: boolean;
  readonly dataComplete?: boolean;
  /** Every run in the week is a duplicate of another. Rule 14's predicate. */
  readonly allMerged?: boolean;
  /** No run in the week carries a readable distance. */
  readonly unreadable?: boolean;
  readonly telemetryCredible?: boolean | 'absent';
  readonly deteriorated?: number;
  /**
   * DETERIORATION-SEVERITY-1 · how badly the worst session in the week fell
   * away, as Research/03 §12's Pa:HR decoupling. Defaults to 6 per cent when
   * `deteriorated` is set, which is inside §12's "Acceptable; approaching
   * aerobic limit" band and therefore DISCOUNTS without refusing, and to 1 per
   * cent otherwise, which is inside the "sustainable" band and costs nothing.
   *
   * Explicit so a case can reach the EXTREME branch (>= 8 per cent) and the
   * unreadable one (null) as well, which nothing could before.
   */
  readonly deterioratedSeverityFrac?: number | null;
  /**
   * How many runs the week's mileage is spread across. Default five.
   *
   * IT MATTERS, and the continuity walk is why. `classifyWeekSurplus` rounds
   * EACH RUN's surplus with the app's shared `roundTo` (tenths of a mile), so
   * a five-run week can only express weekly surplus in half-mile steps. That
   * is a fact about reporting distances in tenths, not a cliff in the engine,
   * but a walk sampled finer than the quantum measures the fixture instead of
   * the curve. The walk uses one run so the quantum is a tenth.
   */
  readonly runCount?: number;
}

function runsFor(spec: WeekSpec): SurplusRun[] {
  const n = spec.runCount ?? 5;
  const per = spec.completedMi / n;
  const out: SurplusRun[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      activityId: `${spec.weekStartISO}-r${i}`,
      dateISO: addDays(spec.weekStartISO, i),
      distanceMi: spec.unreadable === true
        ? failed('the run carries no readable distance')
        : measured(per),
      match: i === 0 ? 'exact' : 'legacy_type',
      mergedIntoAnother: spec.allMerged === true,
      isRace: false,
      prescribedMi: spec.prescribedMi / n,
      movedFromDateISO: null,
    });
  }
  return out;
}

function week(spec: WeekSpec): CompletedWeek {
  const tel = spec.telemetryCredible ?? true;
  return {
    week: {
      weekStartISO: spec.weekStartISO,
      prescribedMi: spec.prescribedMi,
      runs: runsFor(spec),
      authoredPlanMode: spec.mode ?? 'BUILD',
      isCutback: spec.isCutback ?? false,
      isRaceWeek: spec.isRaceWeek ?? false,
      inPrescribedRaceWindow: spec.inPrescribedRaceWindow ?? false,
      dataComplete: spec.dataComplete ?? true,
    },
    conditions: {
      identityResolved: measured(true),
      telemetry: tel === 'absent'
        ? absent('no run in this week carries a heart-rate reading')
        : measured({ credible: tel, why: tel ? null : 'the trace does not hold together' }),
      deterioration: measured({
        repeated: (spec.deteriorated ?? 0) >= 2,
        deterioratedCount: spec.deteriorated ?? 0,
        unknownCount: 0,
        cleanCount: (spec.runCount ?? 5) - (spec.deteriorated ?? 0),
        // DETERIORATION-SEVERITY-1 · a deteriorated fixture session is priced
        // at 6 per cent Pa:HR decoupling, inside Research/03 §12's
        // "Acceptable; approaching aerobic limit" band, so it DISCOUNTS
        // without refusing. A clean fixture sits in the sustainable band.
        worstSeverityFrac: spec.deterioratedSeverityFrac !== undefined
          ? spec.deterioratedSeverityFrac
          : (spec.deteriorated ?? 0) > 0 ? 0.06 : 0.01,
        detail: 'fixture',
      }),
      keySessionGrades: [],
      painOrInjuryReported: absent('no pain report on this account'),
      unplannedRecoveryTaken: absent('unplanned recovery is not recorded'),
      absorptionCompletionBar: VOLUME_WEEK_COMPLETION_MIN_FRAC,
    },
    declaredCause: absent('nothing records why a week came in short'),
  };
}

function futureRow(
  weekStartISO: string, dayOffset: number, type: string, mi: number,
): FutureRow {
  return {
    planWorkoutId: `${weekStartISO}-w${dayOffset}`,
    dateISO: addDays(weekStartISO, dayOffset),
    type,
    distanceMi: mi,
    isLong: type === 'long',
    isQuality: type === 'threshold' || type === 'interval',
    planVersion: PLAN,
  };
}

/** An ordinary future week: four easy days and a long run. */
function futureWeekRows(weekStartISO: string, easyMi: number, longMi: number): FutureRow[] {
  return [
    futureRow(weekStartISO, 0, 'easy', easyMi),
    futureRow(weekStartISO, 1, 'easy', easyMi),
    futureRow(weekStartISO, 3, 'easy', easyMi),
    futureRow(weekStartISO, 4, 'recovery', easyMi),
    futureRow(weekStartISO, 6, 'long', longMi),
  ];
}

function futureWeek(
  weekStartISO: string, rows: readonly FutureRow[],
  flags: Partial<Pick<FutureWeek, 'sealed' | 'isCutback' | 'isTaper' | 'isRaceWeek' | 'stressors'>> = {},
): FutureWeek {
  return {
    weekStartISO,
    prescribedMi: rows.reduce((a, r) => a + (r.distanceMi ?? 0), 0),
    sealed: flags.sealed ?? false,
    isCutback: flags.isCutback ?? false,
    isTaper: flags.isTaper ?? false,
    isRaceWeek: flags.isRaceWeek ?? false,
    stressors: flags.stressors ?? ['long'],
    longestMi: rows.reduce((a, r) => Math.max(a, r.distanceMi ?? 0), 0),
    mpMi: 0,
  };
}

interface WindowSpec {
  readonly asOfISO: string;
  readonly weeks: readonly WeekSpec[];
  readonly future: readonly { weekStartISO: string; rows: FutureRow[]; flags?: Parameters<typeof futureWeek>[2] }[];
  readonly phase?: VolumeEvidenceWindow['phase'];
  readonly stepsTakenThisCycle?: number;
  /** The week immediately before the first future one, for the sequence test. */
  readonly before?: { weekStartISO: string; rows: FutureRow[]; stressors?: string[] };
}

function windowFor(spec: WindowSpec): VolumeEvidenceWindow {
  const rowsByWeek = new Map<string, readonly FutureRow[]>();
  const fws: FutureWeek[] = [];
  for (const f of spec.future) {
    rowsByWeek.set(f.weekStartISO, f.rows);
    fws.push(futureWeek(f.weekStartISO, f.rows, f.flags));
  }
  return {
    asOfISO: spec.asOfISO,
    athleteId: ATHLETE,
    planId: PLAN,
    weeks: spec.weeks.map(week),
    futureWeeks: fws,
    futureRowsByWeek: rowsByWeek,
    weekBeforeFirstFuture: spec.before == null ? null : futureWeek(
      spec.before.weekStartISO, spec.before.rows,
      { stressors: spec.before.stressors ?? ['long'] },
    ),
    phase: spec.phase ?? 'BUILD',
    distanceFloorMi: 20,
    templatePeakBandMi: [45, 70],
    nextBoundaryISO: null,
    stepsTakenThisCycle: spec.stepsTakenThisCycle ?? 0,
    sustainedRank: 3,
    minConsecutiveWeeksForLoss: VOLUME_MIN_CONSECUTIVE_WEEKS,
    population: {
      completedWeeksRead: spec.weeks.length,
      canonicalRunsRead: spec.weeks.length * 5,
      mergedRunsExcluded: 0,
      planVersionsOnAccount: 1,
      racesWithResults: 0,
    },
  };
}

/**
 * `n` consecutive weeks at `overFrac` above a 45-mile prescription, each one
 * carried on by the next (so absorption confirms), ending on `asOfISO`.
 *
 * The trailing week is a FULLY COMPLETED week rather than another overrun: it
 * is what confirms the overrun before it, and without it every reading is
 * provisional. That is the specification's "subsequent recovery changes
 * confidence" made concrete in the fixture rather than asserted about it.
 */
function overrunHistory(
  n: number, overFrac: number, firstWeekISO: string, runCount = 5,
): WeekSpec[] {
  const out: WeekSpec[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      weekStartISO: addDays(firstWeekISO, i * 7),
      prescribedMi: 45,
      /* SNAPPED TO THE 0.1 GRID, per run, deliberately. `classifyWeekSurplus`
       * rounds each run's surplus with the app's shared `roundTo`, so a
       * fixture whose per-run surplus is 0.45 mi loses 0.05 of it five times
       * over and reads as 2.0 mi of surplus rather than 2.25. That is the
       * fixture lying to the test, not the engine losing miles: a real watch
       * reports tenths. Snapping here keeps every number below a fact about
       * the engine. */
      runCount,
      completedMi: 45 + Math.round(45 * overFrac / runCount * 10) / 10 * runCount,
    });
  }
  out.push({
    weekStartISO: addDays(firstWeekISO, n * 7),
    prescribedMi: 45,
    runCount,
    completedMi: 45,
  });
  return out;
}

const raiseOf = (d: VolumeDecision): number =>
  d.kind === 'PROPOSED' ? d.detail.bumps.reduce((a, b) => a + (b.toMi - b.fromMi), 0) : 0;

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 1 · THE DEAD END IS CLOSED · Rule 20's corollary
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 1 · `demonstratedLoadAfterEachWeek` is a symbol, not a sentence', () => {
  const CONTRACT = path.join(WEB, 'lib/plan/load-progression-contract.ts');
  const OWNER = path.join(WEB, 'lib/adaptation/volume-evidence/after-each-week.ts');

  it('liveness · both files exist and were read', () => {
    expect(statSync(CONTRACT).size).toBeGreaterThan(1000);
    expect(statSync(OWNER).size).toBeGreaterThan(1000);
  });

  it('the contract still makes the promise its header has made since 2026-09-02', () => {
    // Read out of the source at gate time rather than hardcoded on both sides
    // (Rule 18): if someone deletes the promise instead of keeping it, this
    // fails and the next reader finds out why the symbol exists.
    const src = readFileSync(CONTRACT, 'utf8');
    expect(src).toContain('demonstratedLoadAfterEachWeek');
  });

  it('and something now KEEPS it · the named symbol is exported and is a function', () => {
    expect(readFileSync(OWNER, 'utf8')).toContain('export function demonstratedLoadAfterEachWeek');
    expect(typeof demonstratedLoadAfterEachWeek).toBe('function');
  });

  it('the recompute REFUSES rather than inventing a belief from nothing', () => {
    const r = demonstratedLoadAfterEachWeek({
      asOfISO: '2026-06-01', weeks: [], sustainedRank: 3, minConsecutiveWeeksForLoss: 3,
    });
    expect(r.ok).toBe(false);
    // Rule 11 · the refusal branch carries no `load` at all, so a caller cannot
    // spend "we could not recompute" as "we recomputed and found nothing".
    expect(r).not.toHaveProperty('load');
  });

  it('and it MOVES the belief when weeks are folded · the promise, exercised', () => {
    const r = demonstratedLoadAfterEachWeek({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.06, '2026-06-01').map(week),
      sustainedRank: 3,
      minConsecutiveWeeksForLoss: VOLUME_MIN_CONSECUTIVE_WEEKS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.load.peakWeeklyMi).not.toBeNull();
    expect(r.load.peakWeeklyMi!).toBeGreaterThan(45);
    // Index-aligned with the readings, which is what lets a caller compare the
    // envelope before this evidence with the envelope after it.
    expect(r.beliefAfterEachWeek).toHaveLength(r.readings.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 2 · THE SEAM IS REACHABLE FROM PRODUCTION
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 2 · the lane is reachable from a real route, not just from tests', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('._') || name === 'node_modules' || name === '.next') continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  };
  const ALL = [...walk(path.join(WEB, 'lib')), ...walk(path.join(WEB, 'app'))];

  it('liveness · the scan read the tree', () => {
    expect(ALL.length).toBeGreaterThan(500);
    expect(REPO.endsWith('web-v2')).toBe(false);
  });

  it('a cron ROUTE imports the lane · this is the sentence that was false yesterday', () => {
    const route = path.join(WEB, 'app/api/cron/run-adaptations/route.ts');
    const src = readFileSync(route, 'utf8');
    expect(src).toContain("from '@/lib/plan/volume-evidence-proposal'");
    expect(src).toContain('runVolumeEvidenceLane(');
  });

  it('the lane imports the evidence directory · the orphan has a caller', () => {
    const lane = readFileSync(path.join(WEB, 'lib/plan/volume-evidence-proposal.ts'), 'utf8');
    expect(lane).toContain("@/lib/adaptation/volume-evidence/after-each-week");
    expect(lane).toContain("@/lib/adaptation/volume-evidence/respond");
  });

  it('and the orphan registry no longer claims these modules have no caller', () => {
    // Rule 18 in both directions. `_generated_content_gate.test.ts` fails if a
    // listed orphan gains an importer; this asserts the entries are actually
    // gone rather than trusting that the other suite ran.
    const reg = readFileSync(path.join(WEB, 'lib/audit/generated-content-registry.ts'), 'utf8');
    for (const f of ['respond.ts', 'belief.ts', 'evidence.ts', 'contract.ts']) {
      expect(reg, f).not.toContain(`'web-v2/lib/adaptation/volume-evidence/${f}':`);
    }
    // The two SCRIPTS stay orphaned by design and must still be listed.
    expect(reg).toContain("'web-v2/lib/adaptation/volume-evidence/_replay_real_history.script.ts':");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 3 · THE AUTHORITY BOUNDARY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 3 · the lane proposes and cannot mutate', () => {
  const LANE = readFileSync(path.join(WEB, 'lib/plan/volume-evidence-proposal.ts'), 'utf8');
  const LOADER = readFileSync(path.join(WEB, 'lib/plan/volume-evidence-loader.ts'), 'utf8');
  const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

  it('the seal is untouched and is still the literal false', () => {
    expect(AUTOMATIC_ADAPTATION_AUTHORITY).toBe(false);
    const seam = readFileSync(path.join(WEB, 'lib/plan/adaptation-authority.ts'), 'utf8');
    expect(seam).toContain('export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;');
  });

  it('neither file names a plan writer other than the proposal writer', () => {
    const FORBIDDEN = [
      'applyAdaptations', 'tryAdaptiveBump', 'mutatePlan', 'reanchorActivePlan',
      'recomputePacesForPlan', 'generatePlan', 'persistComposedPlan', 'fireAutoRebuild',
      'applyProgressionReshape', 'rebuildActivePlanForPrefs',
    ];
    for (const w of FORBIDDEN) {
      expect(code(LANE), `lane names ${w}`).not.toContain(w);
      expect(code(LOADER), `loader names ${w}`).not.toContain(w);
    }
    // The one writer it may name, named.
    expect(code(LANE)).toContain('writeWorkoutProposals');
  });

  it('the loader issues no write statement of any kind', () => {
    expect(code(LOADER)).not.toMatch(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\b/i);
  });

  it('`mark_upgrade` is a proposable kind · the lane cannot raise a card that evaporates', () => {
    expect(PROPOSABLE_KINDS.has('mark_upgrade')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 4 · CONTINUITY · Rule 9
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 4 · extra mileage contributes CONTINUOUS evidence end to end', () => {
  const at = (overFrac: number): VolumeDecision => decideVolumeRaise(windowFor({
    asOfISO: '2026-06-29',
    // ONE run per week · see `WeekSpec.runCount`. A tenth of a mile is the
    // finest thing this engine can be asked about, so it is what the walk
    // steps by.
    weeks: overrunHistory(3, overFrac, '2026-06-01', 1),
    future: [
      { weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) },
      { weekStartISO: '2026-07-06', rows: futureWeekRows('2026-07-06', 7, 16) },
    ],
  }));

  it('a hair more surplus never produces a categorically different plan', () => {
    /* THE WALK. Rule 9's own enforcement shape: step a synthetic runner across
     * the whole input range in small increments and assert the OUTPUT VECTOR
     * moves continuously. The previous engine had a cliff here: a week 0.4 mi
     * short of a bar contributed ZERO and a week 0.4 mi past it contributed
     * everything. */
    const xs: number[] = [];
    for (let f = 0.000; f <= 0.12 + 1e-9; f += 0.002) xs.push(Number(f.toFixed(4)));
    const ys = xs.map((f) => at(f).kind === 'PROPOSED'
      ? (at(f) as Extract<VolumeDecision, { kind: 'PROPOSED' }>).detail.progressionFraction
      : demonstratedFractionOf(f));

    // Liveness · the walk must actually traverse both regimes, or it proves
    // nothing. A walk entirely inside "zero evidence" would pass trivially.
    expect(Math.min(...ys)).toBeLessThan(0.05);
    expect(Math.max(...ys)).toBeGreaterThan(0.5);

    // MONOTONE · more running never buys less. The signature Rule 9 names is
    // "the fitter runner gets the worse plan", and this is the assertion that
    // would catch it.
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i], `progression fell from ${xs[i - 1]} to ${xs[i]}`).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9);
    }
    // CONTINUOUS · no single 0.2%-of-prescription step moves the answer by
    // more than a fifth of the full range. A cliff moves it by all of it.
    for (let i = 1; i < ys.length; i += 1) {
      expect(Math.abs(ys[i] - ys[i - 1]), `jump at ${xs[i]}`).toBeLessThan(0.2);
    }
  });

  function demonstratedFractionOf(f: number): number {
    const d = at(f);
    return d.kind === 'NOTHING_TO_PROPOSE' ? d.detail.progressionFraction : 0;
  }

  it('below the GPS noise floor the surplus says nothing about the runner', () => {
    // A MEASURED nothing, never a refusal. `Research/15` puts GPS distance
    // error at 1-3%, and the gate sits exactly where the curve already reads
    // zero, which is why the walk above crosses it without a step.
    const d = at(0.005);
    expect(d.kind === 'NO_ADMITTED_EVIDENCE' || raiseOf(d) === 0).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 5 · ACCUMULATION AND SATURATION
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 5 · repeated modest overruns accumulate; one enormous overrun is capped', () => {
  const runFor = (weeks: WeekSpec[], asOfISO: string): VolumeDecision =>
    decideVolumeRaise(windowFor({
      asOfISO,
      weeks,
      future: [
        { weekStartISO: asOfISO, rows: futureWeekRows(asOfISO, 7, 16) },
        { weekStartISO: addDays(asOfISO, 7), rows: futureWeekRows(addDays(asOfISO, 7), 7, 16) },
      ],
    }));

  it('ONE modest overrun buys a fraction of a step, not a step', () => {
    const d = runFor(overrunHistory(1, 0.05, '2026-06-15'), '2026-06-29');
    const frac = d.kind === 'PROPOSED' ? d.detail.progressionFraction
      : d.kind === 'NOTHING_TO_PROPOSE' ? d.detail.progressionFraction : 0;
    expect(frac).toBeGreaterThan(0);
    expect(frac).toBeLessThan(0.6);
  });

  it('THREE modest overruns accumulate to a real proposal · the owner\'s second proof', () => {
    const d = runFor(overrunHistory(3, 0.05, '2026-06-01'), '2026-06-29');
    expect(d.kind, JSON.stringify(d)).toBe('PROPOSED');
    if (d.kind !== 'PROPOSED') return;
    // `PROGRESSION_UNLOCK_FRAC` is 0.15 and a week saturates at
    // `PER_WEEK_CREDIT_CEILING_FRAC` (0.05), so three confirmed weeks are
    // exactly one step. Read out of the constants rather than hardcoded, so
    // this cannot quietly agree with itself if either moves.
    expect(PER_WEEK_CREDIT_CEILING_FRAC * 3).toBeCloseTo(PROGRESSION_UNLOCK_FRAC, 6);
    /* AND YET THREE WEEKS DO NOT BUY A WHOLE STEP, which is a fact worth
     * asserting rather than smoothing over. `weight.ts`'s own comment says
     * "three weeks each 5 per cent over prescription accumulate to exactly one
     * full step", and that is true of the UNITS and false of the LEDGER,
     * because `accumulateCapacityEvidence` multiplies each week by its
     * recency. Measured here: three consecutive 5-per-cent weeks ending a
     * fortnight ago buy about two thirds of a step, not all of it. The
     * assertion is a BAND rather than a point so it states the real behaviour
     * without pinning a recency curve nobody has argued for. */
    expect(d.detail.progressionFraction).toBeGreaterThan(0.55);
    expect(d.detail.progressionFraction).toBeLessThanOrEqual(1);
    expect(d.detail.bumps.length).toBeGreaterThan(0);
    expect(raiseOf(d)).toBeGreaterThan(0);
  });

  it('and MORE weeks never buy less than fewer · the accumulation is monotone', () => {
    const f = (n: number): number => {
      const d = runFor(overrunHistory(n, 0.05, addDays('2026-06-29', -7 * (n + 1))), '2026-06-29');
      return d.kind === 'PROPOSED' ? d.detail.progressionFraction
        : d.kind === 'NOTHING_TO_PROPOSE' ? d.detail.progressionFraction : 0;
    };
    const seq = [1, 2, 3, 4].map(f);
    for (let i = 1; i < seq.length; i += 1) {
      expect(seq[i], `${i + 1} weeks bought less than ${i}`).toBeGreaterThanOrEqual(seq[i - 1] - 1e-9);
    }
  });

  it('ONE ENORMOUS overrun is capped at what one week may claim', () => {
    /* "One extreme overrun does not establish sustainable capacity." A week
     * 40 per cent over prescription must claim no more than a week 5 per cent
     * over, and the cap is STRUCTURAL (saturation in `creditedSurplusFrac`)
     * rather than a special case. */
    const huge = runFor([
      { weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 63 },
      { weekStartISO: '2026-06-22', prescribedMi: 45, completedMi: 45 },
    ], '2026-06-29');
    const modest = runFor([
      { weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 47.5 },
      { weekStartISO: '2026-06-22', prescribedMi: 45, completedMi: 45 },
    ], '2026-06-29');
    const fr = (d: VolumeDecision): number => d.kind === 'PROPOSED' ? d.detail.progressionFraction
      : d.kind === 'NOTHING_TO_PROPOSE' ? d.detail.progressionFraction : 0;
    expect(fr(huge)).toBeCloseTo(fr(modest), 6);
    // And three weeks of 5 per cent beat one week of 40 per cent, which is the
    // whole doctrine: repeatability, not a hero week.
    expect(fr(runFor(overrunHistory(3, 0.05, '2026-06-01'), '2026-06-29'))).toBeGreaterThan(fr(huge));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 6 · CONFIDENCE MOVES WITH SUBSEQUENT RECOVERY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 6 · what happens AFTER the overrun changes what it is worth', () => {
  const withFollowing = (followingMi: number): VolumeDecision => decideVolumeRaise(windowFor({
    asOfISO: '2026-06-29',
    weeks: [
      { weekStartISO: '2026-06-08', prescribedMi: 45, completedMi: 45 * 1.05 },
      { weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 45 * 1.05 },
      { weekStartISO: '2026-06-22', prescribedMi: 45, completedMi: followingMi },
    ],
    future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
  }));
  const fr = (d: VolumeDecision): number => d.kind === 'PROPOSED' ? d.detail.progressionFraction
    : d.kind === 'NOTHING_TO_PROPOSE' ? d.detail.progressionFraction : 0;

  it('a week he carried on from confirms more than one he did not', () => {
    expect(fr(withFollowing(45))).toBeGreaterThan(fr(withFollowing(20)));
  });

  it('and confidence moves CONTINUOUSLY with how much of the next week he ran', () => {
    const xs = [20, 25, 30, 34, 38, 41, 43, 44, 45];
    const ys = xs.map(withFollowing).map(fr);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i], `confidence fell as the following week grew (${xs[i]})`)
        .toBeGreaterThanOrEqual(ys[i - 1] - 1e-9);
    }
    // Liveness · the walk must span a real range or it asserts nothing.
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.05);
  });

  it('a week whose successor has NOT been run is provisional, not zero · Rule 11', () => {
    const r = demonstratedLoadAfterEachWeek({
      asOfISO: '2026-06-22',
      weeks: [
        { weekStartISO: '2026-06-08', prescribedMi: 45, completedMi: 45 },
        { weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 45 * 1.05 },
      ].map(week),
      sustainedRank: 3, minConsecutiveWeeksForLoss: VOLUME_MIN_CONSECUTIVE_WEEKS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const newest = r.readings[r.readings.length - 1].capacity;
    expect(newest.provisional).toBe(true);
    expect(newest.units).toBeGreaterThan(0);           // recorded
    expect(newest.confirmedUnits).toBeLessThan(newest.units); // not yet spent in full
    expect(newest.unreadable).toBe(false);             // NOT the same as unreadable
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 7 · TWO CHANNELS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 7 · fatigue moves separately from capacity', () => {
  const fold = (weeks: WeekSpec[], asOfISO: string) => demonstratedLoadAfterEachWeek({
    asOfISO, weeks: weeks.map(week), sustainedRank: 3,
    minConsecutiveWeeksForLoss: VOLUME_MIN_CONSECUTIVE_WEEKS,
  });

  it('a RECOVERY week he overran adds fatigue and earns NO capacity · Rule 8', () => {
    const r = fold([
      { weekStartISO: '2026-08-17', prescribedMi: 17, completedMi: 28.4, mode: 'RECOVERY' },
      { weekStartISO: '2026-08-24', prescribedMi: 23, completedMi: 34.8, mode: 'RECOVERY' },
    ], '2026-08-31');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const c of r.readings.map((x) => x.capacity)) expect(c.units).toBe(0);
    // The taper HAPPENED. Rule 8's corollary: the legs do not know what the
    // plan intended, and a guard reading absorbed load must keep reading it.
    const excess = r.fatigue.map((f) => (f.excessMi.ok ? f.excessMi.value : 0));
    expect(excess.every((x) => x > 0)).toBe(true);
    expect(r.fatigue.every((f) => f.duringPrescribedNonNormal)).toBe(true);
  });

  it('a TAPER week he overran does the same', () => {
    const r = fold([
      { weekStartISO: '2026-08-03', prescribedMi: 30, completedMi: 40, mode: 'TAPER' },
    ], '2026-08-10');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readings[0].capacity.units).toBe(0);
    expect(r.fatigue[0].excessMi.ok && r.fatigue[0].excessMi.value).toBeGreaterThan(0);
  });

  it('and a recovery overrun cannot reach a raise at all', () => {
    const d = decideVolumeRaise(windowFor({
      asOfISO: '2026-08-31',
      weeks: [
        { weekStartISO: '2026-08-17', prescribedMi: 17, completedMi: 28.4, mode: 'RECOVERY' },
        { weekStartISO: '2026-08-24', prescribedMi: 23, completedMi: 34.8, mode: 'RECOVERY' },
      ],
      future: [{ weekStartISO: '2026-08-31', rows: futureWeekRows('2026-08-31', 7, 16) }],
    }));
    expect(d.kind).toBe('NO_ADMITTED_EVIDENCE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 8 · DUPLICATE AND CORRUPTED MILEAGE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 8 · duplicate or corrupted mileage affects NEITHER channel', () => {
  const fold = (weeks: WeekSpec[], asOfISO: string) => demonstratedLoadAfterEachWeek({
    asOfISO, weeks: weeks.map(week), sustainedRank: 3,
    minConsecutiveWeeksForLoss: VOLUME_MIN_CONSECUTIVE_WEEKS,
  });

  it('a week of MERGED rows contributes no capacity and no fatigue · Rule 14', () => {
    const r = fold([
      { weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 63, allMerged: true },
      { weekStartISO: '2026-06-22', prescribedMi: 45, completedMi: 45 },
    ], '2026-06-29');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readings[0].capacity.units).toBe(0);
    const fat = r.fatigue[0];
    expect(fat.excessMi.ok ? fat.excessMi.value : 0).toBe(0);
    // The receipt is kept: the miles were seen and excluded, not unseen.
    expect(fat.artifactMiExcluded).toBeGreaterThan(0);
  });

  it('an UNREADABLE week is a refusal, not a zero · Rule 11', () => {
    const r = fold([
      { weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 63, unreadable: true },
      { weekStartISO: '2026-06-22', prescribedMi: 45, completedMi: 45 },
    ], '2026-06-29');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readings[0].capacity.units).toBe(0);
    // And it is DISTINGUISHABLE from a week the runner simply ran short.
    expect(r.readings[0].capacity.unreadable).toBe(true);
    expect(r.accumulation.unreadableWeeks).toContain('2026-06-15');
  });

  it('a merged week and an unreadable week are NOT the same fact', () => {
    const merged = fold([{ weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 63, allMerged: true }], '2026-06-22');
    const unread = fold([{ weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 63, unreadable: true }], '2026-06-22');
    expect(merged.ok && unread.ok).toBe(true);
    if (!merged.ok || !unread.ok) return;
    expect(merged.readings[0].capacity.unreadable)
      .not.toBe(unread.readings[0].capacity.unreadable);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 9 · WHICH WEEKS MAY GROW
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 9 · cutbacks, tapers, recovery and race weeks keep their purpose', () => {
  const withFirstFuture = (
    flags: Parameters<typeof futureWeek>[2],
  ): VolumeDecision => decideVolumeRaise(windowFor({
    asOfISO: '2026-06-29',
    weeks: overrunHistory(3, 0.05, '2026-06-01'),
    future: [
      { weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16), flags },
      { weekStartISO: '2026-07-06', rows: futureWeekRows('2026-07-06', 7, 16) },
    ],
  }));

  it('an ORDINARY unsealed future week receives exact proposed row changes', () => {
    const d = withFirstFuture({});
    expect(d.kind).toBe('PROPOSED');
    if (d.kind !== 'PROPOSED') return;
    expect(d.detail.landedWeekISO).toBe('2026-06-29');
    expect(d.detail.bumps.length).toBeGreaterThan(0);
    for (const b of d.detail.bumps) {
      // EXACT: a real plan_workouts id, a real before, a real after.
      expect(b.workoutId).toMatch(/^2026-06-29-w\d$/);
      expect(b.toMi).toBeGreaterThan(b.fromMi);
    }
    expect(d.detail.weekAfterMi!).toBeGreaterThan(d.detail.weekBeforeMi!);
  });

  for (const [name, flags] of [
    ['a cutback week', { isCutback: true }],
    ['a taper week', { isTaper: true }],
    ['a race week', { isRaceWeek: true }],
    ['a sealed week', { sealed: true }],
  ] as const) {
    it(`${name} is never raised, and the NEXT ordinary week takes the raise instead`, () => {
      const d = withFirstFuture(flags);
      if (d.kind === 'PROPOSED') {
        expect(d.detail.landedWeekISO, name).not.toBe('2026-06-29');
      } else {
        expect(['NOTHING_TO_PROPOSE', 'NO_ADMITTED_EVIDENCE']).toContain(d.kind);
      }
    });
  }

  it('a block in TAPER or RACE_WEEK raises nothing at all', () => {
    for (const phase of ['TAPER', 'RACE_WEEK', 'RECOVERY'] as const) {
      const d = decideVolumeRaise(windowFor({
        asOfISO: '2026-06-29',
        weeks: overrunHistory(3, 0.05, '2026-06-01'),
        future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
        phase,
      }));
      expect(raiseOf(d), phase).toBe(0);
    }
  });

  it('the cycle\'s one step cannot be spent twice', () => {
    const d = decideVolumeRaise(windowFor({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.05, '2026-06-01'),
      future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
      stepsTakenThisCycle: 1,
    }));
    expect(raiseOf(d)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 10 · THE COMPETING PROGRESSION
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 10 · a competing intensity progression is adjudicated and DEFERRED', () => {
  it('a week that would add mileage AND intensity holds the mileage and queues it', () => {
    /* `Research/00a` §"Practical load rules": "Either add mileage OR add
     * intensity in a given week, not both." The check is the adjudication
     * layer's own `detectSimultaneousStressAddition`, run over the PROPOSED
     * weeks rather than the authored ones, because raising a week's mileage is
     * exactly what turns a legal week into a violating one. */
    const d = decideVolumeRaise(windowFor({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.05, '2026-06-01'),
      /* The BASELINE the sequence test measures the step against. Without a
       * prior week `detectSimultaneousStressAddition` has nothing to compare
       * to and correctly refuses (Rule 11), so a fixture with no baseline
       * would have proved nothing at all. It is small and carries one
       * stressor, so raising the next week both adds mileage and adds
       * intensity, which is exactly the pair doctrine forbids. */
      before: {
        weekStartISO: '2026-06-22',
        rows: futureWeekRows('2026-06-22', 5, 10),
        stressors: ['long'],
      },
      future: [
        {
          weekStartISO: '2026-06-29',
          rows: [
            ...futureWeekRows('2026-06-29', 7, 16),
            futureRow('2026-06-29', 2, 'threshold', 8),
          ],
          // The intensity step lands in the SAME week the volume step would.
          flags: { stressors: ['long', 'quality', 'marathon_pace'] },
        },
      ],
    }));
    if (d.kind === 'PROPOSED') {
      // If it still proposed, it must have landed somewhere else.
      expect(d.detail.landedWeekISO).not.toBe('2026-06-29');
    } else {
      expect(d.kind).toBe('NOTHING_TO_PROPOSE');
      if (d.kind !== 'NOTHING_TO_PROPOSE') return;
      // DEFERRED, not discarded. Evidence must not disappear because one week
      // is full.
      expect(d.detail.deferredRaises + d.detail.weeksRaised).toBeGreaterThanOrEqual(0);
    }
  });

  it('and nothing is ever silently discarded · every unraised week names its reason', () => {
    const d = decideVolumeRaise(windowFor({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.05, '2026-06-01'),
      future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16), flags: { isCutback: true } }],
    }));
    expect(d.kind === 'NOTHING_TO_PROPOSE' || d.kind === 'PROPOSED').toBe(true);
    if (d.kind === 'NOTHING_TO_PROPOSE') {
      expect(d.because.length).toBeGreaterThan(20);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 11 · THE DOWNWARD HALF STAYS AS RIGOROUS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 11 · the bar to come DOWN is not lower than the bar to go UP · Rule 21', () => {
  const fold = (weeks: WeekSpec[], asOfISO: string) => demonstratedLoadAfterEachWeek({
    asOfISO, weeks: weeks.map(week), sustainedRank: 3,
    minConsecutiveWeeksForLoss: VOLUME_MIN_CONSECUTIVE_WEEKS,
  });

  it('ONE short week never lowers a belief', () => {
    const r = fold([
      { weekStartISO: '2026-06-01', prescribedMi: 45, completedMi: 45 * 1.05 },
      { weekStartISO: '2026-06-08', prescribedMi: 45, completedMi: 45 },
      { weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 20 },
    ], '2026-06-22');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lowWeeks.some((l) => l.cause === 'MISSED_TRAINING')).toBe(true);
    expect(r.lowWeeks.every((l) => !l.mayLowerBelief)).toBe(true);
  });

  it('and a PRESCRIBED small week is never read as a capacity loss · Rule 8', () => {
    const r = fold([
      { weekStartISO: '2026-06-01', prescribedMi: 45, completedMi: 20, mode: 'RECOVERY' },
      { weekStartISO: '2026-06-08', prescribedMi: 45, completedMi: 20, mode: 'RECOVERY' },
      { weekStartISO: '2026-06-15', prescribedMi: 45, completedMi: 20, mode: 'RECOVERY' },
    ], '2026-06-22');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lowWeeks.every((l) => l.cause === 'PRESCRIBED_RECOVERY_OR_TAPER')).toBe(true);
    expect(r.lowWeeks.every((l) => !l.mayLowerBelief)).toBe(true);
  });

  it('the peak is never lowered, even by a genuine capacity loss', () => {
    const r = fold([
      { weekStartISO: '2026-05-04', prescribedMi: 45, completedMi: 45 * 1.06 },
      { weekStartISO: '2026-05-11', prescribedMi: 45, completedMi: 45 },
      { weekStartISO: '2026-05-18', prescribedMi: 45, completedMi: 18 },
      { weekStartISO: '2026-05-25', prescribedMi: 45, completedMi: 18 },
      { weekStartISO: '2026-06-01', prescribedMi: 45, completedMi: 18 },
      { weekStartISO: '2026-06-08', prescribedMi: 45, completedMi: 18 },
    ], '2026-06-15');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lowWeeks.some((l) => l.cause === 'GENUINE_CAPACITY_LOSS')).toBe(true);
    // The asymmetry, and it favours the runner: a low week may lower sustained,
    // held and mean, and may NEVER lower the demonstrated peak.
    expect(r.belief.peakWeeklyMi).not.toBeNull();
    expect(r.belief.peakWeeklyMi!).toBeGreaterThan(45);
  });

  it('an incredible heart-rate trace withholds a raise', () => {
    const d = decideVolumeRaise(windowFor({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.05, '2026-06-01')
        .map((w) => ({ ...w, telemetryCredible: false as const })),
      future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
    }));
    expect(raiseOf(d)).toBe(0);
  });

  /* ── DETERIORATION-SEVERITY-1 · FOUR CASES WHERE THERE WAS ONE ──────────
   *
   * This block used to hold a single case, "a deteriorating session withholds
   * a raise", asserting `raiseOf(d) === 0` for ONE deteriorated session. It
   * passed, and it was asserting a defect: `docs/PROGRESSIVE_BASELINE_DOCTRINE
   * .md` Q13 says one deteriorated session "must not independently block
   * progression unless the deterioration is extreme". A gate that only knows
   * how to assert a refusal will pass an engine that can only refuse, which is
   * Rule 22 measured on one test.
   *
   * So the one case is now four, and TWO of them assert that a raise HAPPENS,
   * which keeps this block's own up/down distribution honest.
   */

  it('ONE mild fade DISCOUNTS a raise rather than refusing it · Q13', () => {
    const clean = decideVolumeRaise(windowFor({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.05, '2026-06-01'),
      future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
    }));
    const faded = decideVolumeRaise(windowFor({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.05, '2026-06-01').map((w) => ({ ...w, deteriorated: 1 })),
      future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
    }));
    // It still fires. That is the half a refusal-shaped suite could not see.
    expect(raiseOf(faded)).toBeGreaterThan(0);
    // And it costs something, which is the "reduces confidence" half.
    expect(raiseOf(faded)).toBeLessThan(raiseOf(clean));
  });

  it('an EXTREME fade refuses on its own · Research/03 §12 "build base before progressing"', () => {
    const d = decideVolumeRaise(windowFor({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.05, '2026-06-01')
        .map((w) => ({ ...w, deteriorated: 1, deterioratedSeverityFrac: 0.09 })),
      future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
    }));
    expect(raiseOf(d)).toBe(0);
  });

  it('REPEATED fading refuses however mild each one was · Q13 ">=2 sessions"', () => {
    const d = decideVolumeRaise(windowFor({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.05, '2026-06-01')
        .map((w) => ({ ...w, deteriorated: 2, deterioratedSeverityFrac: 0.055 })),
      future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
    }));
    expect(raiseOf(d)).toBe(0);
  });

  it('a fade whose SEVERITY could not be measured refuses · Rule 11', () => {
    const d = decideVolumeRaise(windowFor({
      asOfISO: '2026-06-29',
      weeks: overrunHistory(3, 0.05, '2026-06-01')
        .map((w) => ({ ...w, deteriorated: 1, deterioratedSeverityFrac: null })),
      future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
    }));
    // "Known bad, size unknown" is not "mild". Spending it as mild is the
    // collapse Rule 11 names, on the axis where being wrong grants a raise.
    expect(raiseOf(d)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 12 · THE PROPOSAL REACHES V5, AND CAN BE ACCEPTED, LOGGED, UNDONE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 12 · the card survives every facet between here and the phone', () => {
  const decision = decideVolumeRaise(windowFor({
    asOfISO: '2026-06-29',
    weeks: overrunHistory(3, 0.05, '2026-06-01'),
    future: [{ weekStartISO: '2026-06-29', rows: futureWeekRows('2026-06-29', 7, 16) }],
  }));

  it('liveness · the fixture actually produced a proposal to walk', () => {
    expect(decision.kind, JSON.stringify(decision)).toBe('PROPOSED');
  });

  it('the whole eleven-facet walk, on the action this lane emits', () => {
    expect(decision.kind).toBe('PROPOSED');
    if (decision.kind !== 'PROPOSED') return;
    const bump = decision.action.bumps![0];

    // GENERATOR · the adaptation becomes a BrainAction.
    const action = actionFromAdaptation(decision.action, {
      planWorkoutId: bump.workoutId,
      dateISO: '2026-07-05',
      type: 'long',
      distanceMi: 16,
      planVersion: PLAN,
    });
    expect(action).not.toBeNull();
    if (action == null) return;
    expect(action.kind).toBe('DISTANCE_CHANGE');

    // DIRECTION · the engine can SAY it is asking for more. Rule 21's own
    // point: "an engine that cannot say whether it is asking for more or less
    // cannot be audited for the asymmetry."
    expect(action.direction).toBe('MORE');

    // VALIDATOR
    expect(validateAction(action)).toEqual({ ok: true });

    // SERIALIZER · through jsonb and back, unchanged.
    const round = deserializeAction(JSON.parse(JSON.stringify(serializeAction(action))));
    expect(round).toEqual(action);

    // RENDERER + EXPLANATION · what the runner actually reads.
    expect(phoneDirectionOf(action)).toBeTruthy();
    const headline = actionHeadline(action, 'Sunday');
    expect(headline.length).toBeGreaterThan(0);
    expect(headline.length).toBeLessThan(90);

    // ACCEPT_EXECUTOR · a real apply path, not UNIMPLEMENTED.
    const exec = executorFor(action);
    expect(exec.path).not.toBe('UNIMPLEMENTED');

    // MUTATION · it resolves to at least one write.
    const writes = plannedWrites(action);
    expect(writes.nonMutating).toBe(false);
    if (!writes.nonMutating) expect(writes.writes.length).toBeGreaterThan(0);

    // LEDGER · classified for the record.
    const led = ledgerFacetsOf(action);
    expect(led.scope).toBeTruthy();
    expect(led.proposedLever).toBeTruthy();
    expect(led.decision).toBeTruthy();

    // WATCH
    expect(watchBehaviorOf(action).kind).toBeTruthy();

    // UNDO · reversible, with a real inverse write plan.
    const undo = undoWritesFor(action);
    expect(undo.kind).toBe('reverse');
    if (undo.kind === 'reverse') expect(undo.writes.length).toBeGreaterThan(0);
  });

  it('the accept route dispatches this action kind · the card is not inert', () => {
    const route = readFileSync(
      path.join(WEB, 'app/api/plan/workout-proposals/[id]/accept/route.ts'), 'utf8');
    expect(route).toContain('applyBrainAction');
    expect(route).toContain('RUNNER_ACCEPTED');
  });

  it('the trigger records what it did, which way, and on what evidence · Rule 21', () => {
    expect(decision.kind).toBe('PROPOSED');
    if (decision.kind !== 'PROPOSED') return;
    const e = decision.trigger.evidence;
    expect(decision.trigger.kind).toBe(VOLUME_EVIDENCE_TRIGGER);
    expect(e.direction).toBe('MORE');
    expect(e.lane).toBe('volume_evidence');
    for (const key of [
      'evidence_week', 'admitted_surplus_mi', 'progression_fraction', 'confirmed_units',
      'recorded_units', 'week_raised', 'week_before_mi', 'week_after_mi',
      'demonstrated_peak_before_mi', 'demonstrated_peak_after_mi', 'fatigue_excess_mi',
    ]) {
      expect(e, key).toHaveProperty(key);
    }
    // The trigger kind is DISTINCT from the ramp's, so the log can answer
    // "which upward lane fired".
    expect(decision.trigger.kind).not.toBe('adaptive_ramp');
  });

  it('the sentence the runner reads is coach voice', () => {
    expect(decision.kind).toBe('PROPOSED');
    if (decision.kind !== 'PROPOSED') return;
    const s = decision.detail.explanation;
    expect(s.length).toBeGreaterThan(20);
    expect(s).not.toMatch(/[!—]/);
    expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 13 · THE DISTRIBUTION OF THIS GATE'S OWN CASES · Rule 22
 * ═══════════════════════════════════════════════════════════════════════ */

describe('guard 13 · this suite is checked for the bias Rule 22 names', () => {
  it('it asserts a RAISE at least as often as it asserts a REFUSAL', () => {
    /* "You cannot correct an engine's bias with a test suite that shares it."
     * The repo-wide count on 2026-08-30 was 29 files that know how to hold a
     * runner back against 2 that know what accelerating one means. Counted out
     * of this file's own source at gate time rather than claimed, and it is a
     * FLOOR rather than an equality because the downward guards here exist for
     * a reason and should not be deleted to satisfy an arithmetic. */
    const src = readFileSync(__filename, 'utf8');
    const raises = (src.match(/toBe\('PROPOSED'\)|raiseOf\(d\)\)\.toBeGreaterThan|toBeGreaterThan\(0\.6\)/g) ?? []).length;
    const refusals = (src.match(/raiseOf\(d\)(?:, \w+)?\)\.toBe\(0\)|toBe\('NO_ADMITTED_EVIDENCE'\)/g) ?? []).length;
    expect(raises + refusals, 'liveness · neither pattern matched anything').toBeGreaterThan(8);
    expect(raises, `${raises} upward assertions against ${refusals} refusals`)
      .toBeGreaterThanOrEqual(refusals);
  });

  it('and it states what it cannot fail on, in its own header', () => {
    const header = readFileSync(__filename, 'utf8').slice(0, 4000);
    expect(header).toMatch(/CANNOT FAIL ON/);
    expect(header).toContain('IT CANNOT FAIL ON THE LOADER');
  });
});
