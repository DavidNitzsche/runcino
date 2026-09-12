/**
 * ADJ-REACH-1 · A PROMOTION DIMENSION THAT LOOKS AT NOTHING IS NOT A PASS.
 *
 * ── THE HOLE THIS CLOSES ───────────────────────────────────────────────────
 *
 * `_promotion_dimensions.test.ts` proves each of the eleven can be made to
 * FAIL on its own. That is necessary and it is not sufficient, and
 * `adjudicate.ts`'s own Rule 22 header said so before this file existed:
 * "with ZERO traces, six of the ten dimensions are vacuously true — there is
 * no violation in an empty set."
 *
 * The consequence is the failure this repository keeps finding under a
 * different name. Rule 15: "a mechanism the test corpus cannot REACH is
 * untested, however many archetypes pass." Rule 21: three doctrine mechanisms
 * were "wired, tested and inert". A gate reporting eleven green dimensions on
 * a block where nine of them examined nothing is reporting confidence it has
 * not earned — and it is indistinguishable, from the outside, from a gate
 * whose clauses have been deleted.
 *
 * So `PlanAdjudication.examined` states the ELIGIBLE POPULATION each dimension
 * had, computed beside the filter that faults it, and this file is what makes
 * that number load-bearing:
 *
 *   1 · LIVENESS. It says how many blocks it read and fails on zero.
 *   2 · REACH. Every dimension not on the argued exemption list must be
 *       reached by at least one block of the corpus.
 *   3 · THE RATCHET (Rule 18 §4). The exemption list may shrink, never grow,
 *       and an exemption whose dimension IS now reached fails until deleted.
 *   4 · SILENT DEATH. A dimension whose clause stops running reports zero
 *       reach and is named here, even though its `check` value stays `true`.
 *
 * ── FALSIFICATION (Rule 18 §1), run before this landed ─────────────────────
 *
 * Each one done by breaking the engine, watching this file name the defect,
 * and restoring. Verbatim, from the actual runs on 2026-09-05:
 *
 *   · `provenanceExamined` increments removed →
 *       "AssertionError: evidenceProvenance · examined 0 items across the whole
 *        corpus. The dimension is decorative on this population: it cannot have
 *        failed, whatever `check.evidenceProvenance` says."
 *       …and, from the cold-start case below, the more useful sentence:
 *       "cold start · marathon · 12 weeks · only wholeBlockCoherence,
 *        progression, taperIntegrity, executionIdentity, coldStartHonesty
 *        looked at anything, so "eleven dimensions green" on this block is one
 *        dimension green and ten abstentions: expected 5 to be greater than or
 *        equal to 6"
 *   · `coldStartExamined += 1` removed →
 *       "AssertionError: coldStartHonesty · examined 0 items across the whole
 *        corpus. …"  and
 *       "cold start · marathon · 12 weeks · the cold start was never checked
 *        for honesty: expected 0 to be greater than 0"
 *   · `taperTraces` replaced with an empty array →
 *       "AssertionError: taperIntegrity · examined 0 items across the whole
 *        corpus. …"
 *   · `doctrineResolution` deleted from `UNREACHED_BY_THIS_CORPUS` →
 *       "AssertionError: doctrineResolution · examined 0 items across the whole
 *        corpus. …"
 *   · a DELIBERATELY STALE `taperIntegrity` entry planted on that same list →
 *       "AssertionError: taperIntegrity is exempted as unreachable by this
 *        corpus, and the corpus reached it 10 time(s). A stale exemption fails
 *        until it is deleted (Rule 18 §4)."
 *
 * The ratchet therefore fails in BOTH directions, which is what Rule 18 §1
 * asks for and what a one-directional allowlist check never proves.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · IT CANNOT TELL A DIMENSION THAT JUDGED CORRECTLY FROM ONE THAT LOOKED AND
 *   SHRUGGED. `examined > 0` proves the dimension had input, not that its
 *   predicate discriminates. A clause replaced by `if (false)` keeps its reach
 *   and passes here. `_promotion_dimensions.test.ts` is the half that catches
 *   that, and neither file is worth much without the other.
 * · IT CANNOT TELL YOU THE CORPUS IS THE RIGHT CORPUS. Reach is measured over
 *   the shapes below, which are the shapes the production replay drives. A
 *   twelfth shape nobody has thought of is invisible.
 * · IT CANNOT SEE THE PRODUCTION POPULATION. The read-only replay does, and
 *   it prints the same eleven counts per plan; this file is the CI half, which
 *   must pass on a clean checkout with no database.
 * · DISTRIBUTION, stated because Rule 22 asks for it: the corpus is
 *   deliberately unbalanced toward the COLD START, because that is the
 *   population six of seven active plans belong to and the one a bypass would
 *   hide in. It says nothing about how well the layer serves a runner with
 *   four years of history.
 */
import { describe, it, expect } from 'vitest';
import {
  adjudicateColdStartBlock, adjudicateComposedBlock, plannedWeeksFrom, type ComposedWeekLike,
} from '../adjudication-corpus';
import { containsRaceOf } from './adjudicate';
import { PROMOTION_DIMENSIONS } from './contract';
import type { PromotionCheck } from './contract';
import type { RenderedHistory } from '../history-shapes';

/* ══════════════════════════════════════════════════════════════════════════
 * THE CORPUS · the shapes the production replay actually drives
 * ═══════════════════════════════════════════════════════════════════════ */

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** A block that ramps, cuts back every fourth week, and tapers into a race. */
function block(opts: {
  readonly weeks: number;
  readonly openingMi: number;
  readonly stepPct: number;
  readonly withRace: boolean;
}): ComposedWeekLike[] {
  const out: ComposedWeekLike[] = [];
  let mi = opts.openingMi;
  for (let i = 0; i < opts.weeks; i += 1) {
    const startISO = addDays('2026-09-07', i * 7);
    const last = i === opts.weeks - 1;
    const isRaceWeek = opts.withRace && last;
    const longMi = Math.round(mi * 0.3 * 10) / 10;
    out.push({
      startISO,
      phase: isRaceWeek ? 'RACE' : i > opts.weeks - 4 ? 'TAPER' : 'BUILD',
      weeklyMi: mi,
      isRaceWeek,
      days: [
        { type: isRaceWeek ? 'race' : 'long', distanceMi: longMi, isQuality: false, isLong: true },
        { type: 'quality', distanceMi: 6, isQuality: true, isLong: false, subLabel: 'threshold' },
        { type: 'easy', distanceMi: Math.max(1, mi - longMi - 6), isQuality: false, isLong: false },
      ],
    });
    mi = (i + 1) % 4 === 0
      ? Math.round(mi * 0.8)
      : Math.round(mi * (1 + opts.stepPct));
  }
  return out;
}

/**
 * A block that ESCALATES: volume up and a stressor ADDED in the same week.
 *
 * The smooth block above cannot reach `recoverability` or `stackedStress`, and
 * the reach gate said so on its first run — which is the falsification Rule 18
 * asks for, arriving for free. Both dimensions ARE reached on the live
 * population (the read-only replay measures 1 of 7 and 4 of 7), so exempting
 * them would have been a CI corpus quietly asking less of the layer than
 * production does. The corpus grows instead.
 *
 * Doctrine's own rule is the thing being violated on purpose here:
 * `Research/00a` §"Practical load rules" · one primary stressor at a time.
 */
function escalatingBlock(weeks: number): ComposedWeekLike[] {
  const out: ComposedWeekLike[] = [];
  let mi = 28;
  for (let i = 0; i < weeks; i += 1) {
    const quality = 1 + i;                       // a NEW stressor every week
    const longMi = Math.round(mi * 0.3 * 10) / 10;
    out.push({
      startISO: addDays('2026-09-07', i * 7),
      phase: 'BUILD',
      weeklyMi: mi,
      isRaceWeek: false,
      days: [
        { type: 'long', distanceMi: longMi, isQuality: false, isLong: true },
        ...Array.from({ length: quality }, () => ({
          type: 'quality', distanceMi: 6, isQuality: true, isLong: false, subLabel: 'threshold',
        })),
        { type: 'easy', distanceMi: Math.max(1, mi - longMi - 6 * quality), isQuality: false, isLong: false },
      ],
    });
    mi = Math.round(mi * 1.12);                  // …and volume up at the same time
  }
  return out;
}

const HISTORY: RenderedHistory = {
  shapeId: 'reach-corpus',
  peakWeeklyMi: 48.5,
  longestRunMi: 21.5,
  maxStressorsInAWeek: 3,
  longRunComparables: [],
} as unknown as RenderedHistory;

interface Case { readonly name: string; readonly examined: Readonly<Record<keyof PromotionCheck, number>> }

function corpus(): readonly Case[] {
  const out: Case[] = [];

  // 1 · the cold start, sized inside the research band · the live majority
  out.push({
    name: 'cold start · marathon · 12 weeks',
    examined: adjudicateColdStartBlock({
      weeks: block({ weeks: 12, openingMi: 25, stepPct: 0.06, withRace: true }),
      raceDistance: 'marathon',
      why: 'no completed runs are recorded for this account',
    }).result.examined,
  });

  // 2 · the cold start with NO race, so no research allowance exists · the
  //     CONDITIONAL-and-gated path, which is where every earning gate on the
  //     live population comes from.
  out.push({
    name: 'cold start · no goal event · 11 weeks',
    examined: adjudicateColdStartBlock({
      weeks: block({ weeks: 11, openingMi: 30, stepPct: 0.06, withRace: false }),
      raceDistance: null,
      why: 'no completed runs and no goal race on this account',
    }).result.examined,
  });

  // 3 · the ONE-WEEK cold start · the shape that produced a false block
  out.push({
    name: 'cold start · one week left',
    examined: adjudicateColdStartBlock({
      weeks: block({ weeks: 1, openingMi: 20, stepPct: 0.06, withRace: false }),
      raceDistance: 'half',
      why: 'no completed runs are recorded for this account',
    }).result.examined,
  });

  // 4 · a block that adds volume AND intensity together, and stacks stressors
  //     into one week. Doctrine forbids it; the point is that the DIMENSIONS
  //     that own it get an item to judge.
  out.push({
    name: 'cold start · escalating · one stressor at a time violated',
    examined: adjudicateColdStartBlock({
      weeks: escalatingBlock(5),
      raceDistance: 'marathon',
      why: 'no completed runs are recorded for this account',
    }).result.examined,
  });

  // 5 · a runner WITH history · the path the cold-start policy does not touch
  const withHistory = adjudicateComposedBlock({
    rendered: HISTORY,
    weeks: block({ weeks: 13, openingMi: 44, stepPct: 0.05, withRace: true }),
    blockStartISO: '2026-09-07',
    windowDescribed: 'canonical runs, 2026 to date',
    raceDistance: 'marathon',
  });
  expect(withHistory, 'the history-bearing block refused a non-null history').not.toBeNull();
  out.push({ name: 'has history · marathon · 13 weeks', examined: withHistory!.result.examined });

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE RATCHET · dimensions this corpus structurally cannot reach
 *
 * Every entry is an argued reason, not a shrug, and every one of them is a
 * FINDING rather than a licence: a dimension listed here is DECORATIVE on the
 * population this app actually has, and the entry says what would be needed to
 * retire it. The list may shrink; it may never grow (Rule 18 §4).
 * ═══════════════════════════════════════════════════════════════════════ */
/**
 * ARBITRATION-DOCTRINE-1 (2026-09-05) · RETIRED, `doctrineResolution`.
 *
 * `adjudication-corpus.ts` now constructs a real `DoctrineConflict` — through
 * `adjudicate()`, never around it — whenever a week's own evidence would have
 * ranked PUSH first and the week is a taper or race week, which is exactly
 * the case the taper/race-week override two lines below it already existed
 * to handle silently. See that file's `ARBITRATION-DOCTRINE-1` header for the
 * full argument and the citations. This entry is deleted rather than left at
 * zero because the ratchet below means exactly that: an exemption whose
 * dimension is now reached fails until deleted, and leaving it here after
 * fixing the cause would be lying to the next reader about which is true.
 */
const UNREACHED_BY_THIS_CORPUS: Partial<Record<keyof PromotionCheck, string>> = {};

describe('ADJ-REACH-1 · every promotion dimension examined something', () => {
  const cases = corpus();

  it('LIVENESS · the corpus is non-empty and every block produced a verdict', () => {
    // Rule 18 §2 · a scanner that reports clean because it read nothing is the
    // worst outcome available, since it also reports confidence.
    expect(cases.length, 'the reach corpus is empty').toBeGreaterThan(0);
    for (const c of cases) {
      const total = PROMOTION_DIMENSIONS.reduce((n, d) => n + c.examined[d], 0);
      expect(total, `${c.name} produced a verdict in which NOTHING was examined at all`)
        .toBeGreaterThan(0);
    }
  });

  it('the examined record covers all eleven dimensions, with no gaps', () => {
    for (const c of cases) {
      for (const d of PROMOTION_DIMENSIONS) {
        expect(c.examined[d], `${c.name} · ${d} reports no eligible population at all`)
          .toBeTypeOf('number');
      }
    }
  });

  it('REACH · every dimension is reached by at least one block, or argued as unreachable', () => {
    const unreached: string[] = [];
    for (const d of PROMOTION_DIMENSIONS) {
      const total = cases.reduce((n, c) => n + c.examined[d], 0);
      if (total > 0) continue;
      if (UNREACHED_BY_THIS_CORPUS[d] != null) continue;
      unreached.push(`${d} · examined 0 items across the whole corpus. The dimension is `
        + `decorative on this population: it cannot have failed, whatever \`check.${d}\` says.`);
    }
    expect(unreached, unreached.join('\n')).toEqual([]);
  });

  it('THE RATCHET · an exemption whose dimension IS now reached fails until deleted', () => {
    const stale: string[] = [];
    for (const [d, why] of Object.entries(UNREACHED_BY_THIS_CORPUS)) {
      const key = d as keyof PromotionCheck;
      const total = cases.reduce((n, c) => n + c.examined[key], 0);
      if (total > 0) {
        stale.push(`${d} is exempted as unreachable by this corpus, and the corpus reached it `
          + `${total} time(s). A stale exemption fails until it is deleted (Rule 18 §4). The `
          + `entry reads: ${why}`);
      }
    }
    expect(stale, stale.join('\n')).toEqual([]);
  });

  it('every exemption carries an argued reason, not a shrug', () => {
    for (const [d, why] of Object.entries(UNREACHED_BY_THIS_CORPUS)) {
      expect(why.length, `${d}'s exemption is too short to be an argument`).toBeGreaterThan(120);
    }
  });

  it('THE COLD START SPECIFICALLY · it is adjudicated, not waved through', () => {
    /* The question the eleventh dimension exists to answer. A cold-start block
     * that promoted with `coldStartHonesty` examining nothing would be exactly
     * the silent bypass the policy is forbidden to be — and so would one where
     * the OTHER dimensions all passed vacuously, because then "eleven green"
     * would mean "one dimension ran".
     *
     * Six is the floor, not the count: it is asserted as a minimum so a future
     * change that reaches MORE of them does not fail this. */
    const cold = cases.filter((c) => c.name.startsWith('cold start'));
    expect(cold.length).toBeGreaterThan(0);
    for (const c of cold) {
      expect(c.examined.coldStartHonesty, `${c.name} · the cold start was never checked for honesty`)
        .toBeGreaterThan(0);
      const reached = PROMOTION_DIMENSIONS.filter((d) => c.examined[d] > 0);
      expect(reached.length, `${c.name} · only ${reached.join(', ')} looked at anything, so `
        + '"eleven dimensions green" on this block is one dimension green and ten abstentions')
        .toBeGreaterThanOrEqual(6);
    }
  });

  it('A COLD START NEVER REACHES SUPPORTED · on every block of the corpus', () => {
    // ALLOWED is the ceiling by construction. Asserted over the whole corpus
    // rather than one fixture, because the cap lives in `athleteEvidenceFor`
    // and a second caller is how a cap gets bypassed.
    for (const weeks of [
      block({ weeks: 12, openingMi: 25, stepPct: 0.06, withRace: true }),
      block({ weeks: 11, openingMi: 30, stepPct: 0.06, withRace: false }),
    ]) {
      const adj = adjudicateColdStartBlock({
        weeks, raceDistance: 'marathon', why: 'no completed runs on this account',
      });
      expect(adj.result.traces.length).toBeGreaterThan(0);
      for (const t of adj.result.traces) {
        expect(t.athlete.evidenceClass, `${t.decisionId} reached SUPPORTED on no evidence`)
          .not.toBe('SUPPORTED');
        expect(t.athlete.demonstratedMaxToday.value, `${t.decisionId} invented a demonstrated maximum`)
          .toBeNull();
      }
    }
  });
});

/**
 * RACEWEEK-CONSOLIDATION-1 (2026-09-11) · `plannedWeeksFrom` carried
 * `isRaceWeek` (goal-only) into every `PlannedWeek` this corpus ever built,
 * with no `containsRace` at all. Per Rule 15, that made `adjudicate.ts`'s
 * `containsRaceOf` branches (the `detectStackedStress` `longStep` null-out,
 * `checkPromotion`'s `executionIdentity` population) UNREACHABLE by
 * `_sweep_allusers.test.ts`'s 11,598 archetypes, however many of them embed a
 * B/C mid-block race — every one of them fell back to `isRaceWeek`, which is
 * false for a tune-up by construction.
 *
 * Neither `block()` above nor `_sweep_allusers.test.ts`'s own archetype
 * generator constructs a mid-block (non-terminal) race day, so this is a
 * dedicated, narrower fixture rather than a rewrite of the shared corpus —
 * extending that corpus to cover the tune-up shape end-to-end is named as a
 * follow-up, not done here.
 *
 * FALSIFIED: deleting the `containsRace: weekContainsRace(w)` line from
 * `plannedWeeksFrom` (or reverting it to only set `isRaceWeek`) makes the
 * tune-up-week assertion below read `false` instead of `true`.
 */
describe('RACEWEEK-CONSOLIDATION-1 · plannedWeeksFrom carries containsRace', () => {
  it('a mid-block B/C tune-up (isRaceWeek false) resolves containsRaceOf true', () => {
    const tuneUpWeek: ComposedWeekLike = {
      startISO: '2026-09-21',
      phase: 'BUILD',
      weeklyMi: 41,
      isRaceWeek: false,
      days: [
        { type: 'race', distanceMi: 6.21, isQuality: true, isLong: false },
        { type: 'easy', distanceMi: 5, isQuality: false, isLong: false },
        { type: 'long', distanceMi: 17, isQuality: false, isLong: true },
      ],
    };
    const goalWeek: ComposedWeekLike = {
      startISO: '2026-11-30',
      phase: 'RACE',
      weeklyMi: 30,
      isRaceWeek: true,
      days: [{ type: 'race', distanceMi: 26.2, isQuality: false, isLong: true }],
    };
    const [pw1, pw2] = plannedWeeksFrom([tuneUpWeek, goalWeek]);
    expect(pw1.isRaceWeek).toBe(false);
    expect(containsRaceOf(pw1)).toBe(true);
    expect(containsRaceOf(pw2)).toBe(true);

    const ordinaryWeek: ComposedWeekLike = {
      startISO: '2026-09-07', phase: 'BUILD', weeklyMi: 40, isRaceWeek: false,
      days: [{ type: 'long', distanceMi: 16, isQuality: false, isLong: true }],
    };
    expect(containsRaceOf(plannedWeeksFrom([ordinaryWeek])[0])).toBe(false);
  });
});
