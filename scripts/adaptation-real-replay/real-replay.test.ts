/**
 * scripts/adaptation-real-replay/real-replay.test.ts · THE CANONICAL
 * ADAPTATION ENGINE, REPLAYED AGAINST ONE REAL RUNNER'S ACTUAL TRAINING.
 *
 * The engine shipped with a 13-row ledger reading PROGRESS 6 · HOLD 3 ·
 * REFUSE 4 and zero disagreements, and its own header says what that ledger
 * is:
 *
 *     "It is a hand-authored reconstruction grounded in the documented figures
 *      ... not a database export. No production credentials were available in
 *      this worktree."
 *
 * This file replaces that caveat with evidence. `real-history.snapshot.json` is
 * a read-only export of the owner's production rows — 156 canonical runs from
 * 2026-01-01 to 2026-09-02, 9 plan versions, 570 prescriptions, 11 races — and
 * every decision point below is built from them by `build-input.ts`.
 *
 * ── NO LOOKAHEAD, ATTACKED RATHER THAN ASSUMED ─────────────────────────────
 *
 * `buildInputAt` is the only door and it filters every collection on
 * `dateISO < asOfISO`. Three tests attack it:
 *
 *   1. no record at any decision point cites INCLUDED evidence dated on or
 *      after that decision point;
 *   2. the same for EXCLUDED and CONTRADICTORY evidence, because a leak that
 *      only shows up in an exclusion list is still a leak;
 *   3. a fabricated 6:00/mi session planted on 2026-11-30 never appears in any
 *      earlier decision.
 *
 * FALSIFIED before being trusted, per Rule 18. Deleting the `< asOf` comparison
 * in `buildInputAt`'s `before()` was run and watched:
 *
 *   · test 2 failed with 537 leaks, naming his real 2026-08-11 and 2026-08-16
 *     sessions inside the 2026-08-03 and 2026-08-05 decisions;
 *   · test 3 failed with 40 POISON citations, from 2026-06-03 onward.
 *   · test 1 did NOT fail, and that is worth stating rather than hiding. The
 *     future sessions that leaked were EXCLUDED by grade or by window rather
 *     than included, so an included-only assertion could not see them. That is
 *     exactly why test 2 exists, and it is what test 1 alone cannot catch.
 *
 * The filter was then restored and all tests returned green.
 *
 * ── HOW A ROW IS SCORED ────────────────────────────────────────────────────
 *
 * Never by agreement with the legacy engine, which fired ZERO upward
 * adaptations across 309 production intents and is the thing this engine
 * exists to replace.
 *
 * This file asserts only what must be TRUE of any honest replay: no lookahead,
 * one record per lever per decision point, a failed read refusing on all three,
 * and the measured distribution pinned so it cannot move silently. The
 * per-cluster scoring — expected against the contract, judged against what
 * actually happened next, marked beneficial / neutral / harmful — is argued in
 * `docs/reports/complete-coaching-brain-handback-2026-09-02/ADAPTATION-REAL-REPLAY.md`,
 * because a disagreement between the engine and doctrine is a FINDING for a
 * person to rule on, not an assertion for a test to enforce on its own.
 *
 * ── RULE 22 · WHAT THIS REPLAY CANNOT FAIL ON ──────────────────────────────
 *
 * · A wrong input. Every criticism `build-input.ts` makes of itself applies
 *   here in full: a mis-matched prescription, a mis-segmented watch phase or a
 *   mis-read cutback flag produces a confident, well-formed, wrong row and
 *   nothing in this file would notice.
 * · Long-horizon consequence. "Beneficial" is judged against the following few
 *   weeks of his real history, not against a race result he has not run.
 * · Whether the engine's BOUNDS are right. It can show that the threshold
 *   lever moved 3 s/mi; it cannot show that 3 s/mi was the correct size.
 * · The counterfactual itself. The replay carries its own belief forward, so
 *   from the first move onward it is describing a season he did not have.
 *   Every later row is conditional on the earlier ones being right.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';
import type { CanonicalDecision, CanonicalDecisionRecord } from '@/lib/adaptation/canonical/decision-record';
import type { CanonicalLever, CapacityBelief, GradedSession } from '@/lib/adaptation/canonical/input';
import { measured, prescribedNonNormalWeek } from '@/lib/adaptation/canonical/input';
import { CANONICAL_LEVERS } from '@/lib/adaptation/canonical/input';
import { qualifiesAsThresholdEvidence } from '@/lib/adaptation/canonical/admissibility';
import {
  THRESHOLD_MIN_QUALIFYING_SESSIONS,
  THRESHOLD_EVIDENCE_WINDOW_DAYS,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
  LONG_RUN_LOOKBACK_COUNT,
  LONG_RUN_COMPLETION_MIN_FRAC,
} from '@/lib/adaptation/canonical/contract-constants';
import { realHistory } from './snapshot';
import {
  buildInputAt, paceSecFromClock, provenanceOf, SEED_THRESHOLD_SEC_PER_MI, weekStartOf,
} from './build-input';
import { sealHistory } from './sealed-history';

const SNAP = realHistory();
/**
 * The same rows, behind `asof.ts`'s fence. Every decision below is built from
 * this; `SNAP` is kept only for the extract-integrity assertions, which are not
 * decisions and are allowed to see the whole season at once.
 */
const SEALED = sealHistory(SNAP);

/* ══════════════════════════════════════════════════════════════════════════
 * THE POISON  ·  the lookahead tripwire
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A session he never ran, dated after every decision point, fast enough that
 * any leak would visibly move the anchor. It is present in the pool at every
 * decision point; the filter is the only thing keeping it out.
 */
const POISON: GradedSession = {
  provenance: {
    activityId: 'POISON',
    dateISO: '2026-11-30',
    paceFlags: [],
    truncation: { truncated: false, completeWorkPhasesCaptured: true, note: '' },
    treadmill: false,
  },
  tests: 'THRESHOLD',
  grade: 'FULL',
  workPaceSecPerMi: measured(360),
  thresholdEquivalentPaceSecPerMi: measured(360),
  thirds: {
    middlePaceSecPerMi: measured(360),
    finalPaceSecPerMi: measured(358),
    middleHrBpm: measured(160),
    finalHrBpm: measured(161),
    comparable: true,
  },
  raceDistance: null,
};

/* ══════════════════════════════════════════════════════════════════════════
 * THE WALK  ·  chronological, belief carried forward
 * ═══════════════════════════════════════════════════════════════════════ */

export interface LedgerRow {
  decisionDate: string;
  boundary: string;
  lever: CanonicalLever;
  evidenceAvailable: string;
  proposedLever: string;
  magnitude: string;
  decision: CanonicalDecision;
  suppressed: string;
  reason: string;
}

interface WalkResult {
  rows: LedgerRow[];
  records: Array<{ date: string; record: CanonicalDecisionRecord }>;
  beliefTrail: Array<{ date: string; threshold: number; weekly: number; long: number }>;
  /** Rule 18 liveness for the durability sensitivity probe. */
  durabilityPatches: number;
  diagnostics: { couldNotBuild: string[]; notes: string[] };
}

/** Every Monday from the first week with real history to the extract date. */
function mondays(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  let d = weekStartOf(fromISO);
  while (d <= toISO) {
    out.push(d);
    d = new Date(Date.parse(`${d}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  }
  return out;
}

/** The day after every completed quality session, long run and race. */
function sessionBoundaries(): string[] {
  const dayAfter = (iso: string) =>
    new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const qualityTypes = new Set(['threshold', 'tempo', 'intervals', 'race', 'race_week_tuneup', 'long']);
  const dates = new Set<string>();
  for (const r of SNAP.runs) {
    if (r.date < '2026-06-01') continue;
    const w = SNAP.planWorkouts.find((x) => x.dateISO === r.date && qualityTypes.has(x.type));
    if (w) dates.add(dayAfter(r.date));
  }
  return [...dates].sort();
}

/**
 * SENSITIVITY · pre-window the evidence before handing it to the engine.
 *
 * The threshold lever windows its own evidence to 28 days. `evaluateWeeklyVolume`
 * does NOT: it receives `input.qualitySessions` whole and marks every session
 * graded below SUBSTANTIAL as contradictory, with no date bound at all. Nothing
 * in `input.ts` says the caller must pre-window, and nothing in the contract
 * says a June session should still be blocking a September progression.
 *
 * So the walk is run twice. The difference between the two distributions is the
 * measurement of that gap, and it is the reason the report can say whether the
 * engine is inert because of HIS DATA or because of WHERE THE WINDOW LIVES.
 */
const SENSITIVITY_WINDOW_DAYS = 28;

function walk(opts: {
  poison?: boolean;
  preWindow?: boolean;
  /**
   * SENSITIVITY ONLY, and never the engine's behaviour · pretend every long run
   * finished strong.
   *
   * 2026-09-03 · this comment used to say 11 of his 15 long runs reached the
   * engine with no thirds "because the prescription varies pace across them",
   * and that attribution was wrong for most of them. Five arrived unreadable
   * because `normSplit` could not parse a `m:ss` clock string, which is the
   * shape 29 of his 146 split-carrying rows use. With that reader fixed, 8 of
   * the 15 are comparable and the remaining 7 divide honestly: SIX are genuine
   * Q13 refusals (the prescription really does change pace across the run) and
   * ONE is a week in which he did not run at all.
   *
   * This flag replaces the remaining unreadable thirds with a clean, comparable
   * set to measure how much of the lever's inertia that residual gap accounts
   * for. It FABRICATES a positive durability answer, so it is an UPPER BOUND on
   * what better segmentation could unlock and nothing more. It is never used by
   * the pinned distribution, and the engine is not changed to behave this way.
   */
  assumeDurabilityReadable?: boolean;
} = {}): WalkResult {
  const rows: LedgerRow[] = [];
  const records: WalkResult['records'] = [];
  const beliefTrail: WalkResult['beliefTrail'] = [];
  const couldNotBuild = new Set<string>();
  const notes = new Set<string>();
  /** How many long runs `assumeDurabilityReadable` actually rewrote. */
  let durabilityPatches = 0;

  // The carried belief. Seeded once, then moved ONLY by the engine's own
  // accepted proposals — never re-read from the plan, because re-reading would
  // import the legacy engine's opinion and stop this being a counterfactual.
  const belief: { -readonly [K in keyof CapacityBelief]: CapacityBelief[K] } = {
    thresholdPaceSecPerMi: SEED_THRESHOLD_SEC_PER_MI,
    // His first three prescribed weeks average 43.5 mi and his first prescribed
    // long run is 12 mi. Both are the plan's own opening numbers, taken once.
    weeklyVolumeMi: 43.5,
    longRunMi: 12,
    supportingSessionCount: 0,
    oldestSupportingDateISO: null,
  };

  const weekly = mondays('2026-06-08', '2026-09-03').map((d) => ({ date: d, boundary: 'WEEKLY_BOUNDARY' as const }));
  const session = sessionBoundaries().map((d) => ({ date: d, boundary: 'SESSION_COMPLETED' as const }));
  const points = [...weekly, ...session]
    .filter((p) => p.date <= '2026-09-03')
    .sort((a, b) => (a.date === b.date ? (a.boundary === 'WEEKLY_BOUNDARY' ? -1 : 1) : a.date < b.date ? -1 : 1));

  // Contract · one upward step per lever per cutback cycle, and no same-day
  // anchor oscillation. Both are STATE, so the walk has to carry them exactly
  // as a real deployment would.
  const steps: Record<CanonicalLever, number> = { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 };
  let lastCutbackSeen: string | null = null;
  let anchorMovedOn: string | null = null;

  for (const p of points) {
    const { input: rawInput, diagnostics } = buildInputAt({
      asOfISO: p.date,
      boundary: p.boundary,
      belief: { ...belief },
      stepsTakenThisCycle: steps,
      anchorMovedTodayForLever: { THRESHOLD_PACE: anchorMovedOn === p.date },
      poison: opts.poison ? POISON : undefined,
    }, SEALED);

    diagnostics.couldNotBuild.forEach((x) => couldNotBuild.add(x));
    diagnostics.notes.forEach((x) => notes.add(x));

    const cutoff = new Date(Date.parse(`${p.date}T12:00:00Z`) - SENSITIVITY_WINDOW_DAYS * 86_400_000)
      .toISOString().slice(0, 10);
    const windowed = opts.preWindow
      ? {
        ...rawInput,
        qualitySessions: rawInput.qualitySessions.filter((s) => s.provenance.dateISO >= cutoff),
        longRuns: rawInput.longRuns.slice(-2),
      }
      : rawInput;

    const input = opts.assumeDurabilityReadable
      ? {
        ...windowed,
        longRuns: windowed.longRuns.map((l) => {
          if (l.thirds.comparable) return l;
          // Rule 18 liveness · counted, so the probe can prove it reached the
          // engine even on a season where it changes no decision.
          durabilityPatches += 1;
          return {
            ...l,
            thirds: {
              middlePaceSecPerMi: measured(480),
              finalPaceSecPerMi: measured(479),
              middleHrBpm: measured(150),
              finalHrBpm: measured(150),
              comparable: true,
            },
          };
        }),
      }
      : windowed;

    // A cutback boundary resets the per-cycle step counters, which is what
    // "one step per cutback cycle" means.
    const cutback = [...input.weeks].reverse().find((w) => w.isCutback)?.weekStartISO ?? null;
    if (cutback !== null && cutback !== lastCutbackSeen) {
      lastCutbackSeen = cutback;
      steps.THRESHOLD_PACE = 0; steps.WEEKLY_VOLUME = 0; steps.LONG_RUN = 0;
    }

    const out = evaluateAdaptation(input);

    for (const r of out.records) {
      records.push({ date: p.date, record: r });
      rows.push({
        decisionDate: p.date,
        boundary: p.boundary,
        lever: r.lever,
        evidenceAvailable:
          `${input.weeks.length}w ${input.qualitySessions.length}q ${input.longRuns.length}lr`
          + ` · in ${r.evidenceIncluded.length} out ${r.evidenceExcluded.length} contra ${r.contradictory.length}`,
        proposedLever: r.lever,
        magnitude: r.magnitude
          ? `${r.magnitude.value > 0 ? '+' : ''}${r.magnitude.value} ${r.magnitude.unit} (limit ${r.magnitude.limit}, ${r.magnitude.limitConstant})`
          : '—',
        decision: r.decision,
        suppressed: r.suppressedBy ? `${r.suppressedBy.by} · ${r.suppressedBy.detail.slice(0, 80)}` : '',
        reason: r.reason,
      });

      // Apply the proposal exactly as a deployment would: only when it moves
      // and only when arbitration did not suppress it.
      const applies = r.proposedAfterValue !== null && r.suppressedBy === null
        && (r.decision === 'PROGRESS' || r.decision === 'REGRESS');
      if (!applies) continue;
      if (r.lever === 'THRESHOLD_PACE') {
        belief.thresholdPaceSecPerMi = r.proposedAfterValue!;
        anchorMovedOn = p.date;
        steps.THRESHOLD_PACE += 1;
      } else if (r.lever === 'WEEKLY_VOLUME') {
        belief.weeklyVolumeMi = r.proposedAfterValue!;
        steps.WEEKLY_VOLUME += 1;
      } else {
        belief.longRunMi = r.proposedAfterValue!;
        steps.LONG_RUN += 1;
      }
      belief.supportingSessionCount = r.confidence.supportingCount;
      belief.oldestSupportingDateISO =
        r.evidenceIncluded.map((e) => e.dateISO).sort()[0] ?? belief.oldestSupportingDateISO;
    }

    beliefTrail.push({
      date: p.date,
      threshold: belief.thresholdPaceSecPerMi,
      weekly: belief.weeklyVolumeMi,
      long: belief.longRunMi,
    });
  }

  return {
    rows,
    records,
    beliefTrail,
    durabilityPatches,
    diagnostics: { couldNotBuild: [...couldNotBuild], notes: [...notes] },
  };
}

const RUN = walk();
const RUN_WINDOWED = walk({ preWindow: true });

const distributionOf = (r: WalkResult): Record<CanonicalDecision, number> => {
  const d: Record<CanonicalDecision, number> = { PROGRESS: 0, HOLD: 0, REGRESS: 0, REFUSE: 0 };
  for (const x of r.rows) d[x.decision] += 1;
  return d;
};

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE REPLAY HAPPENED, AND IT HAPPENED ON REAL ROWS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the replay reads real production rows', () => {
  // Rule 18 · liveness. A gate that reports clean because it scanned nothing is
  // the worst available outcome, since it also reports confidence.
  it('the snapshot holds his real history, not a fixture', () => {
    expect(SNAP.athleteId).toBe('0645f40c-951d-4ccc-b86e-9979cd26c795');
    expect(SNAP.runs.length).toBeGreaterThan(120);
    expect(SNAP.planWorkouts.length).toBeGreaterThan(400);
    // The four race results the brief names, read from `races.actual_result`.
    const byslug = new Map(SNAP.races.map((r) => [r.slug, r.finishS]));
    expect(byslug.get('americas-finest-city')).toBe('6113');   // 1:41:53
    expect(byslug.get('disney-half-2026')).toBe('5694');       // 1:34:54
    expect(byslug.get('la-marathon-2026')).toBe('12700');      // 3:31:40
    expect(byslug.get('big-sur-marathon')).toBe('13015');
    // The truncated 2026-09-02 run, with the defect recorded on the row.
    const sep2 = SNAP.runs.find((r) => r.date === '2026-09-02');
    expect(sep2?.manualCorrection?.reason ?? '').toMatch(/truncated/i);
  });

  it('every decision point produced exactly one record per lever', () => {
    expect(RUN.rows.length).toBeGreaterThan(60);
    const byPoint = new Map<string, Set<string>>();
    for (const r of RUN.rows) {
      const k = `${r.decisionDate}·${r.boundary}`;
      if (!byPoint.has(k)) byPoint.set(k, new Set());
      byPoint.get(k)!.add(r.lever);
    }
    for (const [k, levers] of byPoint) {
      expect(levers.size, `${k} did not produce one record per lever`).toBe(CANONICAL_LEVERS.length);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · NO LOOKAHEAD  ·  attacked three ways
 * ═══════════════════════════════════════════════════════════════════════ */

describe('no future evidence reaches an earlier decision', () => {
  it('no record cites INCLUDED evidence dated on or after its own decision date', () => {
    const leaks: string[] = [];
    for (const { date, record } of RUN.records) {
      for (const e of record.evidenceIncluded) {
        if (e.dateISO >= date) leaks.push(`${date} ${record.lever} included ${e.activityId} @ ${e.dateISO}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('no record cites EXCLUDED or CONTRADICTORY evidence dated on or after its own decision date', () => {
    const leaks: string[] = [];
    for (const { date, record } of RUN.records) {
      for (const e of [...record.evidenceExcluded, ...record.contradictory]) {
        if (e.dateISO >= date) leaks.push(`${date} ${record.lever} cited ${e.activityId} @ ${e.dateISO}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('a fabricated future session never reaches any earlier decision', () => {
    const poisoned = walk({ poison: true });
    const cited = poisoned.records.flatMap(({ date, record }) => [
      ...record.evidenceIncluded, ...record.evidenceExcluded, ...record.contradictory,
    ].filter((e) => e.activityId === 'POISON').map((e) => `${date} ${record.lever}`));
    expect(cited).toEqual([]);
    // And the decision stream is byte-identical with and without the poison,
    // which is the stronger statement: the filter does not merely hide the
    // session from the record, it keeps it out of the reasoning.
    expect(poisoned.rows.map((r) => `${r.decisionDate}|${r.lever}|${r.decision}`))
      .toEqual(RUN.rows.map((r) => `${r.decisionDate}|${r.lever}|${r.decision}`));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · RULE 11  ·  a failed read is not a runner without evidence
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a failed read is its own fact', () => {
  it('readable:false refuses on every lever and says why', () => {
    const { input } = buildInputAt({
      asOfISO: '2026-09-02',
      boundary: 'WEEKLY_BOUNDARY',
      belief: {
        thresholdPaceSecPerMi: 430, weeklyVolumeMi: 45, longRunMi: 14,
        supportingSessionCount: 0, oldestSupportingDateISO: null,
      },
      readable: false,
    }, SEALED);
    const out = evaluateAdaptation(input);
    expect(out.records.map((r) => r.decision)).toEqual(['REFUSE', 'REFUSE', 'REFUSE']);
    for (const r of out.records) expect(r.reason).toMatch(/could not be read/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3b · Q29  ·  THE TRUNCATED 2026-09-02 RUN
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Q29 · the run the watch cut short', () => {
  // The real defect, recorded on the real row: the plan ended on a `.recovery`
  // phase, the watch drew no reachable End run, the run was force-quit through
  // crash recovery, and 0.43 mi / 292 s were lost. `manualCorrection` repaired
  // `distanceMi` to 6.41 from the runner's photographed watch display while
  // deliberately leaving `phases` and `splits` summing to 5.98 mi.
  it('counts its recorded distance toward the week and refuses it for durability', () => {
    const { input } = buildInputAt({
      asOfISO: '2026-09-03',
      boundary: 'SESSION_COMPLETED',
      belief: {
        thresholdPaceSecPerMi: 430, weeklyVolumeMi: 33.5, longRunMi: 12,
        supportingSessionCount: 2, oldestSupportingDateISO: '2026-08-16',
      },
    }, SEALED);

    // Q29 · "Count only recorded distance and duration ... the missing portion
    // is not failed training." The repaired 6.41 mi is inside the week total.
    const week = input.weeks.find((w) => w.weekStartISO === '2026-08-31');
    expect(week).toBeDefined();
    expect(week!.completedMi.ok).toBe(true);
    if (week!.completedMi.ok) expect(week!.completedMi.value).toBeGreaterThan(20);

    // It is an EASY run with six strides, so it is not threshold evidence at
    // all — which is the D13 case the brief asks about, reached by a real
    // session rather than a fixture. It never appears in `qualitySessions`.
    expect(input.qualitySessions.some((s) => s.provenance.dateISO === '2026-09-02')).toBe(false);
  });

  it('the truncation IS detected, and its work phases are known complete', () => {
    // Built directly, because the run is an easy day and so never becomes a
    // GradedSession in the walk. The provenance is still what a durability
    // reader would receive, and Q29's two halves are both present: truncated,
    // and the prescribed work (all six strides) captured before the cut.
    const sep2 = SNAP.runs.find((r) => r.date === '2026-09-02')!;
    const prov = provenanceOf(sep2, { couldNotBuild: [], notes: [] });
    expect(prov.truncation.truncated).toBe(true);
    expect(prov.truncation.completeWorkPhasesCaptured).toBe(true);
    // `assessDeterioration` returns UNKNOWN on any truncated activity, so the
    // contract's "absence of a captured late decline is not evidence of
    // durability" holds without this replay having to assert it separately.
    expect(sep2.phases.filter((p) => p.type === 'work').length).toBe(7);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3c · THE EVIDENCE LAYER READS WHAT IS ON THE ROW
 *
 * Rule 11's most expensive shape, found by the Rule 21 bar report: the
 * long-run durability gate was blocked at 40 of 40 decision points, and the
 * blockage was attributed to Q13 (the prescription varies pace across a long
 * run, so its thirds are not comparable). That was true of four of his fifteen
 * long runs. The rest were unreadable because `normSplit` read three numeric
 * spellings of pace and not the fourth — a `m:ss` clock string — while the
 * same rows carried a complete set of per-mile heart rates.
 *
 * ── RULE 22 · WHAT THIS BLOCK CANNOT FAIL ON ───────────────────────────────
 *
 * It cannot fail on a pace that parses but is WRONG. It checks that the string
 * is read, and sanity-bounds the result to 3:00-30:00 per mile; a systematic
 * unit error inside that band would pass here and poison every durability
 * comparison downstream.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the evidence layer reads what is on the row', () => {
  it('a "m:ss" pace string is a pace, not a missing pace', () => {
    // The census, read out of the snapshot at run time rather than hardcoded,
    // so the claim cannot quietly stop being about his real rows.
    let stringOnly = 0;
    let withSplits = 0;
    for (const r of SNAP.runs) {
      const sp = r.splits ?? [];
      if (sp.length === 0) continue;
      withSplits += 1;
      const rec = sp as unknown as Array<Record<string, unknown>>;
      const numeric = rec.some((x) => x.paceSecPerMi != null || x.paceSPerMi != null);
      const clock = rec.some((x) => typeof x.pace === 'string');
      if (!numeric && clock) stringOnly += 1;
    }
    // eslint-disable-next-line no-console
    console.log(
      `EVIDENCE · ${stringOnly} of ${withSplits} split-carrying runs record pace ONLY as a clock string`,
    );
    // Rule 18 liveness · a census that found nothing would make the assertion
    // below vacuous, so the shape has to still be present in his rows.
    expect(stringOnly).toBeGreaterThan(0);
    expect(paceSecFromClock('8:19')).toBe(499);
    // And it refuses rather than guessing on anything that is not a pace.
    expect(paceSecFromClock('0:45')).toBeNull();
    expect(paceSecFromClock('99:00')).toBeNull();
    expect(paceSecFromClock(499)).toBeNull();
    expect(paceSecFromClock('not a time')).toBeNull();
  });

  it('the long runs whose thirds are unreadable are unreadable for a NAMED reason', () => {
    const { input } = buildInputAt({
      asOfISO: '2026-09-03',
      boundary: 'WEEKLY_BOUNDARY',
      belief: {
        thresholdPaceSecPerMi: SEED_THRESHOLD_SEC_PER_MI, weeklyVolumeMi: 43.5, longRunMi: 12,
        supportingSessionCount: 0, oldestSupportingDateISO: null,
      },
    }, SEALED);

    const readable = input.longRuns.filter((l) => l.thirds.comparable);
    const why = input.longRuns
      .filter((l) => !l.thirds.comparable)
      .map((l) => {
        const m = l.thirds.middlePaceSecPerMi;
        if (m.ok) return 'ok';
        return 'what' in m.why ? m.why.what : m.why.kind;
      });
    // eslint-disable-next-line no-console
    console.log(
      `EVIDENCE · ${readable.length} of ${input.longRuns.length} long runs have comparable thirds\n`
      + `   the rest: ${JSON.stringify(why.reduce<Record<string, number>>((a, w) => {
        a[w] = (a[w] ?? 0) + 1; return a;
      }, {}), null, 0)}`,
    );

    // Before the reader fix this was 4. Pinned, so a regression in the split
    // reader reads as a durability finding again and this test says otherwise.
    expect(readable.length).toBe(8);

    // And every remaining refusal names a cause. "Too few readable splits" was
    // the reader's own failure wearing a data failure's clothes, so its total
    // absence is the property worth asserting: what is left is the honest set.
    expect(why.filter((w) => /too few to compare thirds/.test(w))).toEqual([]);
    expect(why.filter((w) => /changes pace across the run/.test(w))).toHaveLength(6);
    expect(why.filter((w) => /no activity was recorded/.test(w))).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE DISTRIBUTION  ·  Rule 22, counted rather than assumed
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the distribution across PROGRESS / HOLD / REGRESS / REFUSE', () => {
  it('is pinned, so a change to the engine has to explain itself', () => {
    const dist = distributionOf(RUN);
    // Rule 22's own instruction: check the DISTRIBUTION, not just the count.
    // These are the measured numbers on his real history as of the extract,
    // pinned so a later change to the engine cannot move them silently. They
    // are NOT an endorsement — PROGRESS 0 is the headline FINDING of this
    // replay and it is written up as one.
    expect(RUN.rows.length).toBe(120);
    // 2026-09-03 · re-pinned after the eight findings this replay raised were
    // fixed. The move, and what caused each part of it:
    //
    //   PROGRESS   0 ->   0   unchanged, and it is still the headline finding
    //   HOLD      94 -> 102
    //   REGRESS   20 ->   4   the cadence bound now applies to BOTH directions
    //   REFUSE     6 ->  14   a week with no prescribed long run now refuses
    //                         honestly instead of holding at "no distance"
    //
    // The REGRESS collapse is the substantive change. The contract's "one step
    // per cutback cycle" used to sit below the REGRESS early return in both
    // movable levers, so it governed only the upward path and the same missed
    // weeks were re-spent at every weekly boundary. Sixteen of the twenty
    // downward records were that repetition.
    //
    // 2026-09-03, second pass · re-pinned again after the upward-bar findings.
    // NOTHING moved into PROGRESS and nothing moved out of REGRESS. What moved
    // is the line between "the coach decided" and "the engine could not judge":
    //
    //   PROGRESS   0 ->   0
    //   HOLD     102 ->  63
    //   REGRESS    4 ->   4
    //   REFUSE    14 ->  53
    //
    // Thirty-nine records that read as a coaching decision were a missing
    // evaluation, and Rule 11 says those are different facts. Three causes,
    // each argued in the lever it belongs to: the threshold lever refuses
    // rather than holds when the window carries too little qualifying evidence
    // (34 of 40 readings had none at all); the long-run lever refuses rather
    // than holds when durability is unreadable, matching the refusal it
    // already gave for the truncation case; and the volume lever refuses
    // rather than passing vacuously when no key session in the window
    // established anything.
    //
    // The count is the FINDING, not the fix. A season in which 44% of records
    // are refusals is an engine starved of evidence, and saying so is what the
    // old distribution could not do.
    //
    // ── 2026-09-04 · THE STARVATION HAD A CAUSE, AND IT WAS OURS ───────────
    //
    // Previous pin: `{ PROGRESS: 0, HOLD: 63, REGRESS: 4, REFUSE: 53 }`.
    //
    // Two defects were found and fixed, and both were in the ENGINE, not the
    // runner (see `lib/adaptation/canonical/work-hr-ceiling.ts` for the full
    // measurement):
    //
    //   HRCEILING-1 · every threshold session in June and July was graded
    //     against an HR ceiling of 149 while his LTHR is 168. 149 is the
    //     easy-day aerobic cap; ZONEBAND-1 had already ruled that a generic
    //     aerobic cap does not belong on a quality row, and fixed the AUTHORING
    //     side, but nothing reached the GRADING side. Correctly-run tempos at
    //     155-167 bpm read as "completed at clearly excessive effort".
    //
    //   HRCHANNEL-1 · `gradeStimulus`'s "HR is not a channel for this session"
    //     escape was gated on `!hrReliable` — a dead strap — and did not cover
    //     an absent CEILING. That is the state of every quality session
    //     authored since ZONEBAND-1, so a perfect threshold session fell past
    //     every branch onto the final DIFFERENT and could never be evidence.
    //
    // REFUSE fell 53 -> 38 because the refusals that read "no qualifying
    // threshold session in the last 28 days" had qualifying sessions all along.
    // REGRESS is UNCHANGED at 4: nothing about the downward path moved, which
    // is the check that this was a readability fix and not a loosened bar.
    //
    // ── 2026-09-04, SECOND PASS · ARBITRATION READING C ────────────────────
    //
    // Previous pin: `{ PROGRESS: 14, HOLD: 64, REGRESS: 4, REFUSE: 38 }`.
    //
    // `lib/adaptation/canonical/arbitration.ts` rule 1 was changed from "a load
    // HOLD suppresses a material increase" to "the complete projected week must
    // not exceed the athlete's own demand ceiling", per the owner's ruling in
    // `docs/reports/core-closure-2026-09-04/ARBITRATION-CHOICE.md`. Rule 2's
    // materiality-keyed exception was DELETED rather than widened.
    //
    //   PROGRESS  14 ->   9
    //   HOLD      64 ->  67
    //   REGRESS    4 ->   6
    //   REFUSE    38 ->  38
    //
    // PROGRESS FALLING IS THE CHANGE WORKING, and it is worth reading twice
    // because the arrow points the wrong way at a glance. Under the old rule
    // the same 3 s/mi pace proposal was RE-MADE and RE-SUPPRESSED at four
    // successive boundaries, because the anchor never moved: four PROGRESS
    // records, one applied change. Under reading C the proposal is APPLIED, so
    // the next boundary sees a moved anchor and correctly HOLDs. Fewer records,
    // more movement. `docs/reports/core-closure-2026-09-04/COUNTERFACTUAL.md`
    // measures the same season through both readings and reports it directly:
    // the threshold anchor walks 7:22 -> 7:10 rather than 7:22 -> 7:19, which
    // is 12 s/mi against 3 across two months of his real training.
    //
    // REGRESS 4 -> 6 is the same mechanism in the other direction and is the
    // check that this was not a one-way loosening: a downward pace correction
    // that used to be suppressed alongside everything else now also lands.
    //
    // ── 2026-09-04, THIRD PASS · THE REAL DEMAND MODEL IS WIRED IN ─────────
    //
    // Previous pin: `{ PROGRESS: 9, HOLD: 67, REGRESS: 6, REFUSE: 38 }`.
    //
    // That pin was measured with `athleteCeilingWeeklyDemand` supplied as
    // `absent(...)`, here and in production alike, which meant arbitration's
    // rule 1 COULD NOT FIRE AT ANY BOUNDARY. Reading C was in force and its
    // only live effect was that a load HOLD no longer vetoed another lever.
    //
    // The ceiling is now resolved from `lib/plan/adjudication/weekly-demand.ts`
    // through `lib/adaptation/canonical/demand-ceiling.ts`, against this
    // athlete's own ABSORBED weeks. Rule 1 now fires: the counterfactual
    // reports the posture as READ at all 13 boundaries, where it was ABSENT at
    // all 13 before.
    //
    //   PROGRESS   9 ->  14
    //   HOLD      67 ->  64
    //   REGRESS    6 ->   4
    //   REFUSE    38 ->  38
    //
    // AND THE ARROW POINTS THE WRONG WAY AGAIN, FOR THE OPPOSITE REASON THIS
    // TIME. Read the second-pass note above: PROGRESS fell from 14 to 9 there
    // because proposals started LANDING, so the same proposal stopped being
    // re-made at four successive boundaries. This pass undoes exactly that —
    // 14 is the count of RE-MADE proposals, and it is back because rule 1 is
    // now DEFERRING them. The threshold anchor walks 7:22 -> 7:19 where the
    // no-ceiling world walked 7:22 -> 7:10.
    //
    // THAT IS A FINDING, NOT A TUNING TARGET, and it is written down rather
    // than smoothed away. The ceiling is his biggest week the plan did not
    // author as a cutback, a race week, a taper or a recovery block, and early
    // in a build block he has few such weeks while the plan is already
    // prescribing more than he has demonstrated. So the prescribed week sits
    // ABOVE the ceiling and every demand-increasing proposal — including a
    // 3 s/mi pace correction — is deferred. Measured here: 4 of 8 moving
    // proposals deferred in world C, and the deferred ones were re-offered and
    // then expired as their evidence aged.
    //
    // Whether that is the right coaching call is the owner's to settle, and
    // `docs/reports/core-closure-2026-09-04/COUNTERFACTUAL.md` puts the whole
    // season in front of him to settle it with. What this test asserts is only
    // that the engine now RESPONDS to a real ceiling instead of to nothing.
    //
    // REGRESS 6 -> 4 is the same mechanism and is the check that this is not a
    // one-way tightening reported as a safety improvement: the downward path
    // lost two landings too, for the same reason the upward path did.
    expect(dist).toEqual({ PROGRESS: 14, HOLD: 64, REGRESS: 4, REFUSE: 38 });
  });

  it('the belief no longer walks below the volume he demonstrably ran', () => {
    // The defect this replaces: 43.5 -> 30.2 mi/wk across seven applied steps,
    // landing within 4.5 mi of the 31.6 figure CLAUDE.md Rule 8 already lists
    // as a defect, while two of the three weeks in the final window read 39.8
    // and 47.5 mi completed.
    const weekly = RUN.beliefTrail.map((b) => b.weekly);
    const lowest = Math.min(...weekly);
    expect(lowest, 'the volume belief fell below his sustained level again')
      .toBeGreaterThan(35);
    // And it is still ALLOWED to fall. A floor that never binds downward would
    // be the opposite defect, and this asserts the lever still eases.
    expect(lowest).toBeLessThan(weekly[0]);
  });

  it('THE FINDING, RESOLVED · the engine now proposes increases he earned', () => {
    /* The block this replaces read "THE FINDING · the engine never proposes an
     * increase on his real data", and it said of itself:
     *
     *   "The assertion is written as the observation rather than as a target,
     *    so that the day a change makes it push, THIS TEST FAILS and the person
     *    who made it has to come and delete this block."
     *
     * 2026-09-04 is that day, and this is that deletion. The mechanism worked
     * exactly as designed: the change could not land quietly.
     *
     * CLAUDE.md Rule 21 measured the old engine at "309 coach_intents rows ...
     * the number of UPWARD adaptations is ZERO", and this replay reproduced the
     * zero on the canonical engine. It was never the runner. Two engine defects
     * — HRCEILING-1 and HRCHANNEL-1, both documented at the distribution pin
     * above — made a correctly-executed threshold session unable to count as
     * evidence at all.
     *
     * WHAT EARNS AN INCREASE, in the runner's terms, stated here because Rule
     * 21 asks for exactly this: two threshold sessions on SEPARATE days inside
     * 28 days, each completed at or near its prescribed work, each faster than
     * the current anchor and outnumbering any slower ones two to one. That buys
     * the ORDINARY step of 3 s/mi. Every one of the 14 proposals below is that
     * step; not one reaches the larger 5 s/mi step, which needs stronger and
     * more numerous evidence.
     *
     * The magnitude is the reassurance: across two months of real training the
     * anchor walks 7:22 -> 7:16, six seconds a mile, held there by the
     * one-step-per-cycle contract. His actual production anchor today is
     * 7:10/mi, so the replayed engine stays BEHIND where his fitness really
     * went rather than running ahead of it.
     */
    const dist = distributionOf(RUN);
    expect(dist.PROGRESS, 'the engine stopped proposing increases again').toBeGreaterThan(0);
    // The downward path must remain live. An engine that only pushes is the
    // opposite defect and Rule 22 is explicit that both directions are checked.
    expect(dist.REGRESS, 'the downward path went silent').toBeGreaterThan(0);
  });

  // Rule 20 · `evaluate.ts` computed `INV_WITHIN_LEVER_BOUND` from the day it
  // was written and had already marked the 2026-07-27 long-run record
  // `passed: false`. Nothing read it, so a record the engine itself knew was
  // invalid shipped through six green test files. The invariants are asserted
  // here, on the real rows, rather than merely computed.
  it('no record on his real history ships with a failed invariant', () => {
    const failures = RUN.records.flatMap(({ date, record }) => record.invariants
      .filter((i) => !i.passed)
      .map((i) => `${date} ${record.lever} ${record.decision} · ${i.id} · ${i.detail}`));
    expect(failures).toEqual([]);
  });

  it('and no REGRESS on his real history proposes an increase', () => {
    /* THE UNIT MATTERS, AND THIS TEST USED TO IGNORE IT (fixed 2026-09-04).
     *
     * It read `magnitude.startsWith('+')`, which is right for `weekly_mi` and
     * `long_run_mi` and WRONG for `sec_per_mi`: a faster threshold pace is a
     * SMALLER number of seconds, so a pace REGRESS is correctly `+2.4` and a
     * pace PROGRESS is correctly `-3`. The engine has owned that distinction
     * since `evaluate.ts`'s `directionOf` was written, and the assertion above
     * this one (`no record ships with a failed invariant`) already proves every
     * record agrees with it through `INV_DIRECTION_MATCHES_DECISION`.
     *
     * It never fired before because no pace REGRESS reached the ledger; the
     * arbitration change that let pace proposals land surfaced two, and this
     * assertion called them upward. A gate that is wrong in a way nothing has
     * yet reached is exactly the shape Rule 15 is about, so the fix is stated
     * rather than quietly applied.
     *
     * "An increase" is now asked in each unit's own terms. */
    const increasesDemand = (row: { lever: string; magnitude: string }): boolean =>
      row.magnitude.includes('sec_per_mi')
        ? row.magnitude.startsWith('-')   // faster is a smaller number
        : row.magnitude.startsWith('+');  // further is a larger number
    const upward = RUN.rows
      .filter((r) => r.decision === 'REGRESS' && increasesDemand(r))
      .map((r) => `${r.decisionDate} ${r.lever} ${r.magnitude} · ${r.reason}`);
    expect(upward).toEqual([]);

    // Rule 18 · the predicate is falsified here rather than only being trusted,
    // because it is the whole content of this test.
    expect(increasesDemand({ lever: 'THRESHOLD_PACE', magnitude: '-3 sec_per_mi' })).toBe(true);
    expect(increasesDemand({ lever: 'THRESHOLD_PACE', magnitude: '+2.4 sec_per_mi' })).toBe(false);
    expect(increasesDemand({ lever: 'WEEKLY_VOLUME', magnitude: '+2 weekly_mi' })).toBe(true);
    expect(increasesDemand({ lever: 'WEEKLY_VOLUME', magnitude: '-2 weekly_mi' })).toBe(false);
  });

  // Rule 17, and the coach-voice half of finding 8. `miText(0)` renders "no
  // distance", and three distinct reason strings reached the runner as "The
  // long run stays at no distance."
  it('no reason string tells the runner a lever stays at "no distance"', () => {
    const nonsense = RUN.rows
      .filter((r) => /no distance|no pace/.test(r.reason))
      .map((r) => `${r.decisionDate} ${r.lever} · ${r.reason}`);
    expect(nonsense).toEqual([]);
  });

  // The measurement the owner asked for: if PROGRESS is 0, WHICH bar is
  // binding? This isolates the one that turned out to matter most.
  it('SENSITIVITY · where the long-run lever is actually blocked', () => {
    const optimistic = walk({ assumeDurabilityReadable: true });
    const dist = distributionOf(optimistic);
    const longRun = optimistic.rows.filter((r) => r.lever === 'LONG_RUN');
    const byDecision: Record<string, number> = {};
    for (const r of longRun) byDecision[r.decision] = (byDecision[r.decision] ?? 0) + 1;
    // eslint-disable-next-line no-console
    console.log(
      'SENSITIVITY · assuming every long run could be read AND finished clean · '
      + `all levers ${JSON.stringify(dist)} · LONG_RUN ${JSON.stringify(byDecision)}`,
    );
    // eslint-disable-next-line no-console
    console.log('SENSITIVITY · long-run reasons under that assumption:\n'
      + [...new Set(longRun.map((r) => `   ${r.decision} · ${r.reason.slice(0, 120)}`))].sort().join('\n'));

    // LIVENESS · the probe must actually reach the engine, or it is measuring
    // nothing and reporting confidence (Rule 18).
    //
    // This assertion used to be "the long-run REASONS change, and 'how the
    // final third went could not be read' disappears", and the reader fix in
    // `build-input.ts` made it false: with the `m:ss` pace string parsed, no
    // long-run decision on his real history is reached by that branch at all,
    // so the probe changes no reason and no decision. A liveness check that
    // rests on the result is not a liveness check — it goes quiet exactly when
    // the thing it is probing stops mattering, which is when you most need to
    // know the instrument still ran.
    //
    // So liveness is now asserted on the INPUT: the flag rewrote this many
    // long runs. That is true whatever the engine then decides.
    expect(optimistic.durabilityPatches).toBeGreaterThan(0);
    expect(RUN.durabilityPatches).toBe(0);

    // AND THE RESULT · the distribution does not move at all — and after the
    // reader fix, neither does a single REASON string. The residual durability
    // gap is real, it is six long runs whose prescription genuinely varies
    // pace across the run, and it is NOT what holds this lever: every decision
    // point it unblocks is caught immediately by the next criterion, which is
    // either "one of the last 2 came in below 95%" or "a key session after one
    // of these long runs did not go to plan". Both are Q22 criteria read off
    // his real execution, not walls.
    //
    // Asserted as an equality rather than described in prose, so that the day
    // better segmentation DOES unlock a proposal this test fails and somebody
    // has to come and update the finding.
    expect(dist).toEqual(distributionOf(RUN));
    const reasonsNow = new Set(longRun.map((r) => r.reason));
    const reasonsBefore = new Set(RUN.rows.filter((r) => r.lever === 'LONG_RUN').map((r) => r.reason));
    expect([...reasonsNow].sort()).toEqual([...reasonsBefore].sort());
  });

  it('SENSITIVITY · the increases are not an artefact of where one window lives', () => {
    // Originally: "pre-windowing the evidence does not unlock a single
    // increase", which distinguished a real bar from a windowing accident while
    // the engine was inert. Now that it pushes, the same probe answers the
    // OPPOSITE question and is more useful for it: are the 14 proposals a
    // property of the evidence, or of `evaluateWeeklyVolume` not windowing
    // `keySessions`?
    //
    // Trimming the evidence to 28 days before it is handed over must not change
    // the answer. It does not, which is what makes the increases a fact about
    // his training rather than about one window's placement.
    const dist = distributionOf(RUN_WINDOWED);
    expect(dist.PROGRESS, 'the increases came from the window, not the evidence')
      .toBe(distributionOf(RUN).PROGRESS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4b · RULE 21 · IS THE BAR A BAR, OR A WALL?
 *
 * Rule 21's standard, verbatim: "compute what the runner would have had to DO
 * to trigger it, then check whether any week they have actually run would have.
 * If none could, the bar is not a bar, it is a wall."
 *
 * PROGRESS is 0 on his real history. That is only an acceptable answer if the
 * bars are clearable in principle and he did not clear them, and NOT acceptable
 * if they are unclearable by construction. This section measures the distance
 * between what he did and what each lever asks, using the LEVERS' OWN
 * CONSTANTS and the engine's OWN admissibility predicate rather than a
 * re-implementation, so it cannot drift from the thing it is describing.
 *
 * ── WHAT THIS SECTION CANNOT FAIL ON ───────────────────────────────────────
 *
 * It reads the same evidence pipeline the engine reads, so a session the
 * evidence layer mis-graded is mis-counted here in exactly the same way. It
 * measures whether the bar was REACHABLE, never whether it is the right bar.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RULE 21 · what he would have had to do, against what he did', () => {
  // Everything the engine ever saw, built once at the extract date.
  const { input: ALL } = buildInputAt(
    {
      asOfISO: '2026-09-03',
      boundary: 'WEEKLY_BOUNDARY',
      // The same seed the walk starts from. The belief does not affect which
      // evidence is ADMISSIBLE, which is all this section reads.
      belief: {
        thresholdPaceSecPerMi: SEED_THRESHOLD_SEC_PER_MI,
        weeklyVolumeMi: 43.5,
        longRunMi: 12,
        supportingSessionCount: 0,
        oldestSupportingDateISO: null,
      },
    },
    SEALED,
  );

  it('THRESHOLD · the longest run of qualifying sessions inside one window', () => {
    // The bar: at least THRESHOLD_MIN_QUALIFYING_SESSIONS qualifying sessions,
    // on separate days, inside THRESHOLD_EVIDENCE_WINDOW_DAYS, all graded FULL
    // or SUBSTANTIAL, admissible for road pace, and agreeing on direction.
    const qualifying = ALL.qualitySessions
      .filter((x) => qualifiesAsThresholdEvidence(x).admissible)
      .map((x) => x.provenance.dateISO)
      .sort();
    const distinctDays = [...new Set(qualifying)];

    // The best any 28-day window ever held.
    let best = 0;
    for (const anchor of distinctDays) {
      const from = new Date(Date.parse(`${anchor}T12:00:00Z`)
        - THRESHOLD_EVIDENCE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
      best = Math.max(best, distinctDays.filter((d) => d > from && d <= anchor).length);
    }
    // The census that explains the zero better than any single bar does: how
    // his quality sessions GRADED, before pace admissibility is even asked.
    const byGrade: Record<string, number> = {};
    for (const q of ALL.qualitySessions) byGrade[q.grade] = (byGrade[q.grade] ?? 0) + 1;

    // eslint-disable-next-line no-console
    console.log(
      `RULE 21 · THRESHOLD · ${distinctDays.length} qualifying sessions in 2026, `
      + `best ${THRESHOLD_EVIDENCE_WINDOW_DAYS}-day window held ${best}, bar is `
      + `${THRESHOLD_MIN_QUALIFYING_SESSIONS} · ${distinctDays.join(', ')}`
      + `\n   grades across all ${ALL.qualitySessions.length} quality sessions · ${JSON.stringify(byGrade)}`,
    );

    // The bar is CLEARABLE on his data: a window did reach it. What it did not
    // do is agree on direction, which is the 2026-09-02 record's 1-1 split.
    // Asserted so that a future change making the bar unreachable fails here
    // rather than quietly reporting another zero.
    expect(best, 'no 28-day window ever held the corroboration bar').toBeGreaterThanOrEqual(
      THRESHOLD_MIN_QUALIFYING_SESSIONS,
    );
  });

  it('VOLUME · the longest run of consecutive weeks at the completion bar', () => {
    // The bar: VOLUME_MIN_CONSECUTIVE_WEEKS consecutive NON-cutback weeks at
    // >= VOLUME_WEEK_COMPLETION_MIN_FRAC of prescribed.
    const ordinary = ALL.weeks.filter((w) => !prescribedNonNormalWeek(w).nonNormal);
    const fracs = ordinary.map((w) => ({
      week: w.weekStartISO,
      frac: w.completedMi.ok && w.prescribedMi > 0 ? w.completedMi.value / w.prescribedMi : 0,
    }));

    let run = 0;
    let best = 0;
    for (const f of fracs) {
      run = f.frac >= VOLUME_WEEK_COMPLETION_MIN_FRAC ? run + 1 : 0;
      best = Math.max(best, run);
    }
    // eslint-disable-next-line no-console
    console.log(
      `RULE 21 · VOLUME · best consecutive run at >=${Math.round(VOLUME_WEEK_COMPLETION_MIN_FRAC * 100)}% `
      + `was ${best}, bar is ${VOLUME_MIN_CONSECUTIVE_WEEKS} · `
      + fracs.map((f) => `${f.week} ${Math.round(f.frac * 100)}%`).join(', '),
    );

    // At least one week cleared the bar, so the bar is not unreachable. He
    // never strung three together, and THAT is the finding.
    expect(fracs.some((f) => f.frac >= VOLUME_WEEK_COMPLETION_MIN_FRAC),
      'not one single week ever reached the completion bar').toBe(true);
    expect(best, 'if this reaches the bar, volume should be proposing and is not')
      .toBeLessThan(VOLUME_MIN_CONSECUTIVE_WEEKS);
  });

  it('LONG RUN · how often consecutive long runs both met the completion bar', () => {
    // The bar: the LONG_RUN_LOOKBACK_COUNT most recent prescribed long runs
    // both at >= LONG_RUN_COMPLETION_MIN_FRAC, both fully recorded, neither
    // deteriorating late, and the key session after them intact.
    const fracs = ALL.longRuns.map((l) => ({
      date: l.provenance.dateISO,
      frac: l.completedMi.ok && l.prescribedMi > 0 ? l.completedMi.value / l.prescribedMi : 0,
      truncated: l.provenance.truncation.truncated,
      // Why the durability half of the bar could or could not be judged. These
      // three are the inputs `assessDeterioration` needs, and naming them
      // separately is what tells "he faded" apart from "nobody could tell"
      // (Rule 11) when a long run holds the lever.
      comparable: l.thirds.comparable,
      hr: l.thirds.middleHrBpm.ok && l.thirds.finalHrBpm.ok,
      pace: l.thirds.middlePaceSecPerMi.ok && l.thirds.finalPaceSecPerMi.ok,
      followUp: l.followingKeySessionOk.ok ? String(l.followingKeySessionOk.value) : 'unknown',
    }));

    // eslint-disable-next-line no-console
    console.log('RULE 21 · LONG RUN · durability readability, run by run:\n'
      + fracs.map((f) => `   ${f.date} ${Math.round(f.frac * 100)}%`
        + `${f.truncated ? ' TRUNCATED' : ''}`
        + ` comparable=${f.comparable} pace=${f.pace} hr=${f.hr} followUp=${f.followUp}`).join('\n'));

    let pairs = 0;
    for (let i = 1; i < fracs.length; i += 1) {
      const a = fracs[i - 1];
      const b = fracs[i];
      if (a.frac >= LONG_RUN_COMPLETION_MIN_FRAC && b.frac >= LONG_RUN_COMPLETION_MIN_FRAC
        && !a.truncated && !b.truncated) pairs += 1;
    }
    // eslint-disable-next-line no-console
    console.log(
      `RULE 21 · LONG RUN · ${pairs} consecutive pairs both at `
      + `>=${Math.round(LONG_RUN_COMPLETION_MIN_FRAC * 100)}% and both fully recorded, `
      + `lookback is ${LONG_RUN_LOOKBACK_COUNT} · `
      + fracs.map((f) => `${f.date} ${Math.round(f.frac * 100)}%${f.truncated ? ' cut' : ''}`).join(', '),
    );

    // The completion half of the bar IS cleared, repeatedly. What stops the
    // lever is everything downstream of completion — deterioration, unreadable
    // thirds, coherence with the week — and that is the finding, not the
    // completion bar being a wall.
    expect(pairs, 'no two consecutive long runs were ever both completed and fully recorded')
      .toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · WRITE THE LEDGER
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the ledger', () => {
  it('is written for the report', () => {
    const out = process.env.REPLAY_LEDGER_OUT;
    if (!out) return;
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({
      extractedAtISO: SNAP.extractedAtISO,
      rows: RUN.rows,
      distribution: distributionOf(RUN),
      distributionPreWindowed: distributionOf(RUN_WINDOWED),
      beliefTrailPreWindowed: RUN_WINDOWED.beliefTrail,
      beliefTrail: RUN.beliefTrail,
      diagnostics: RUN.diagnostics,
      perLever: CANONICAL_LEVERS.map((l) => {
        const rs = RUN.rows.filter((r) => r.lever === l);
        const d: Record<string, number> = { PROGRESS: 0, HOLD: 0, REGRESS: 0, REFUSE: 0 };
        for (const r of rs) d[r.decision] += 1;
        return { lever: l, ...d };
      }),
      reasonsSeen: [...new Set(RUN.rows.map((r) => `${r.lever} ${r.decision} :: ${r.reason}`))].sort(),
      // Rule 15 · which REAL session reached which mechanism. Reported as the
      // evidence each record actually cited, so "the corpus reaches it" is a
      // fact about named activities rather than a claim.
      evidence: RUN.records.map(({ date, record }) => ({
        date,
        lever: record.lever,
        decision: record.decision,
        included: record.evidenceIncluded.map((e) => `${e.dateISO} ${e.what}`),
        excluded: record.evidenceExcluded.map((e) => `${e.dateISO} ${e.reason}`),
        contradictory: record.contradictory.map((e) => `${e.dateISO} ${e.detail}`),
      })),
      exclusionReasonsSeen: [...new Set(
        RUN.records.flatMap(({ record }) => record.evidenceExcluded.map((e) => e.reason)),
      )].sort(),
    }, null, 2));
  });
});
