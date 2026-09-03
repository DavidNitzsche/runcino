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
import { buildInputAt, provenanceOf, SEED_THRESHOLD_SEC_PER_MI, weekStartOf } from './build-input';

const SNAP = realHistory();

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
   * 11 of his 15 long runs reach the engine with NO thirds at all, because the
   * prescription varies pace across them ("LONG · 10mi @ HM" finishes fast by
   * design) and Q13 forbids inferring deterioration from whole-run thirds in
   * that case. The refusal is doctrine-correct, and its consequence is that the
   * long-run lever's durability criterion cannot be evaluated for most of a
   * marathon build.
   *
   * This flag replaces those thirds with a clean, comparable set to measure how
   * much of the lever's inertia that one gap accounts for. It FABRICATES a
   * positive durability answer, so it is an UPPER BOUND on what better
   * segmentation could unlock and nothing more. It is never used by the pinned
   * distribution, and the engine is not changed to behave this way.
   */
  assumeDurabilityReadable?: boolean;
} = {}): WalkResult {
  const rows: LedgerRow[] = [];
  const records: WalkResult['records'] = [];
  const beliefTrail: WalkResult['beliefTrail'] = [];
  const couldNotBuild = new Set<string>();
  const notes = new Set<string>();

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
    }, SNAP);

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
        longRuns: windowed.longRuns.map((l) => (l.thirds.comparable ? l : {
          ...l,
          thirds: {
            middlePaceSecPerMi: measured(480),
            finalPaceSecPerMi: measured(479),
            middleHrBpm: measured(150),
            finalHrBpm: measured(150),
            comparable: true,
          },
        })),
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
    }, SNAP);
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
    }, SNAP);

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
    expect(dist).toEqual({ PROGRESS: 0, HOLD: 102, REGRESS: 4, REFUSE: 14 });
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

  it('THE FINDING · the engine never proposes an increase on his real data', () => {
    // The canonical engine exists because CLAUDE.md Rule 21 measured the old
    // one at "309 coach_intents rows ... the number of UPWARD adaptations is
    // ZERO". Replayed against the same runner's actual training, across 40
    // decision points and 120 records, this engine also proposes zero.
    //
    // The assertion is written as the observation rather than as a target, so
    // that the day a change makes it push, THIS TEST FAILS and the person who
    // made it has to come and delete this block. That is the point: a green
    // suite must not be able to coexist with a silent change in either
    // direction, which is the exact ambiguity Rule 21 says let the zero
    // survive unnoticed.
    const dist = distributionOf(RUN);
    expect(dist.PROGRESS).toBe(0);
    expect(dist.REGRESS).toBeGreaterThan(0);
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
    const upward = RUN.rows.filter(
      (r) => r.decision === 'REGRESS' && r.magnitude.startsWith('+'),
    ).map((r) => `${r.decisionDate} ${r.lever} ${r.magnitude} · ${r.reason}`);
    expect(upward).toEqual([]);
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
    // nothing and reporting confidence (Rule 18). It does: the long-run REASONS
    // change, and "how the final third went could not be read" disappears.
    const reasonsNow = new Set(longRun.map((r) => r.reason));
    const reasonsBefore = new Set(RUN.rows.filter((r) => r.lever === 'LONG_RUN').map((r) => r.reason));
    expect([...reasonsBefore].some((r) => /could not be read/.test(r))).toBe(true);
    expect([...reasonsNow].some((r) => /could not be read/.test(r))).toBe(false);

    // AND THE RESULT · the distribution does not move at all. The durability
    // gap is real and it is NOT what holds this lever: every decision point it
    // unblocks is caught immediately by the next criterion, which is either
    // "one of the last 2 came in below 95%" or "a key session after one of
    // these long runs did not go to plan". Both are Q22 criteria read off his
    // real execution, not walls.
    //
    // Asserted as an equality rather than described in prose, so that the day
    // better segmentation DOES unlock a proposal this test fails and somebody
    // has to come and update the finding.
    expect(dist).toEqual(distributionOf(RUN));
  });

  it('SENSITIVITY · pre-windowing the evidence does not unlock a single increase', () => {
    // If the engine were inert only because `evaluateWeeklyVolume` never
    // windows `keySessions`, trimming the evidence to 28 days would let it
    // push. It does not. So the finding is about the engine's bars against
    // this runner's real execution, not about where one window lives.
    const dist = distributionOf(RUN_WINDOWED);
    expect(dist.PROGRESS).toBe(0);
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
    SNAP,
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
