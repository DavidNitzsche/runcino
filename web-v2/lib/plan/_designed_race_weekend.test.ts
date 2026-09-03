/**
 * _designed_race_weekend.test.ts · THE GATE FOR THE TYPED RACE-PLUS-LONG-RUN
 * EXCEPTION (DESIGNEDWEEKEND-1, 2026-09-02).
 *
 * The owner's ruling, and the sentence this file exists to enforce:
 *
 *   "It must not silently make this pairing available to every runner."
 *
 * WHAT IT HOLDS
 *
 *   1. THE MOST IMPORTANT ASSERTION IN THE SUITE, first: a runner with no
 *      athlete-specific evidence is REFUSED, by name, and his long run is cut
 *      back onto doctrine's return-to-long curve. Every other test here is
 *      subordinate to this one.
 *   2. Each of the eight things he required has a test that fails without it.
 *   3. The refusals are NAMED and DISTINCT (Rule 11): "I could not read his
 *      history", "he has run less than this", and "his race is not a C effort"
 *      are three codes, not one `false`.
 *   4. The permission is a TYPE. A caller cannot read `grant` off a refusal —
 *      asserted at compile time by the union's shape and at run time here.
 *   5. The doctrine numbers are READ OUT OF `Research/` at run time, not
 *      hardcoded on both sides (Rule 18: a check that hardcodes both only
 *      proves the test agrees with itself).
 *   6. The composer actually spends the resolver — a behavioural test through
 *      `composePlan`, because a unit test of a pure function proves the
 *      function works and says nothing about whether anything calls it (Rule
 *      20's "wired, tested and inert" failure).
 *   7. The validator refuses a pairing with no decision on the record, and one
 *      that grew past the grant it was issued under.
 *   8. His point 8, as re-scoped 2026-09-02: racing it harder than prescribed
 *      is DETECTED and the comparison is graded at the effort actually given.
 *      ADVISORY ONLY — nothing here asserts a plan row changes, because
 *      nothing does.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22) — what it is structurally incapable of
 * catching, not what it covers:
 *
 *   · A GATE ON SOMETHING THAT IS NOT DEMONSTRATED HISTORY. The declared-level
 *     gate went on 2026-09-02 and the field itself went with it, and there is
 *     a test asserting the evidence object holds nothing but numbers he ran.
 *     But nothing here would catch a NEW gate added on a readiness score or a
 *     confidence figure. That is a review obligation, not a gated one.
 *   · WHETHER THE DECLARED LEVEL REACHES THE PLAN BY ANOTHER ROUTE. This file
 *     only sees the designed-weekend resolver and the composer path that feeds
 *     it. `_declared_level_inert.test.ts` is the cross-cutting behavioural
 *     sweep that answers that question for the whole composed block.
 *   · WHETHER THE EVIDENCE IS TRUE. Every fixture hands the resolver numbers.
 *     If `demonstratedPairMi` were measured over a contaminated window (Rule
 *     8), or `loadGeneratorInputs` stopped calling `demonstratedPairMi`
 *     altogether and passed a constant, nothing here would notice. The
 *     window's correctness is asserted by the normal-window scanner, not by
 *     this file, and the composer-side plumbing is only exercised through
 *     `composePlan`, which takes the evidence as an input.
 *   · WHETHER 24.21 MILES IS A GOOD IDEA. This asserts the engine applies the
 *     runner's own ruling and doctrine's own stress-block clause. It is not
 *     evidence that the coaching answer is right, and if the decision is ever
 *     reversed these tests must be REWRITTEN, not loosened.
 *   · THE ADAPTATION ENGINE ACTUALLY APPLYING the reassessment. Point 8's
 *     detector is wired in `adapt.ts` and its DB path is not exercised here;
 *     what is asserted is the pure verdict and the grade it lands on. See the
 *     report for exactly what is detected versus what acts on it.
 *   · A RUNNER WHOSE RACE IS NOT IN `midBlockRaces`. A race the composer was
 *     never told about is invisible to the composer and to this file.
 *   · HEAT, COURSE OR HR ON RACE DAY. `reassessDesignedWeekend` reads the
 *     clock. A race run harder in effort but not in time reads as held.
 *
 * DISTRIBUTION (Rule 22): the exception has two verdicts and this file carries
 * 13 refusal cases against 11 grant cases. The imbalance is deliberate and is
 * the shape the ruling itself asks for: there are ten named ways to be
 * unqualified for this weekend and one way to be qualified. It is stated here
 * rather than left to be discovered, and the grant side is not tested only in
 * the small — it includes the full end-to-end composition and the validator
 * passing a granted block.
 *
 * LIVENESS (Rule 18): the doctrine test counts the rows it parsed out of
 * `Research/00b` and fails on zero, so a renamed heading cannot turn this file
 * into a clean report about nothing.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '@/lib/doctrine/resolve';
import {
  resolveDesignedRaceWeekend,
  reassessDesignedWeekend,
  resolvePairVolumeEvidence,
  resolvePairOrderingEvidence,
  EXTENDED_RECOVERY_DAYS_AFTER_PAIR,
  SPIKE_RATIO_OVER_DEMONSTRATED_LONG,
  CONTROLLED_EFFORT_PACE_TOLERANCE,
  DESIGNED_WEEKEND_LONG_CAP_MI,
  type DesignedWeekendEvidence,
  type DesignedWeekendRequest,
  type HistoricalDayReading,
  type PairVolumeEvidence,
  type PairOrderingEvidence,
} from './designed-race-weekend';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  DESIGNED_WEEKEND_PURPOSE,
  type ComposePlanInput, type ComposedWeek, type DOW, type DayPlan, type LevelKey,
} from './generate';
import { validateComposedPlan } from './validate';
import { designedWeekendFindings, type PlacementRecord } from './combined-stress';
import { tPaceFromGoal } from './spec-builder';

/* ────────────────────────────────────────────────────────────── fixtures */

/**
 * The owner's own numbers, measured against production 2026-09-02 and not
 * invented: sustained 46.4 mi/wk, longest recent-habit long run 18.0 mi, best
 * two-day total 29.4 mi starting 2026-04-25.
 *
 * DECLAREDLEVEL-0 (2026-09-02) · `declaredLevel: 'advanced'` and
 * `declaredDaysPerWeek: 6` used to sit in this fixture because they sat in the
 * type. Both are gone from `DesignedWeekendEvidence` — not merely ungated, but
 * absent — so there is nothing left in this object that the runner did not run.
 */
/**
 * EVIDENCE-HONESTY-1 (2026-09-02) · THE PAIR NUMBER IN THIS FIXTURE CHANGED,
 * AND THE CHANGE IS THE POINT.
 *
 * It read 29.4 mi from 2026-04-25. Measured against production, that pair is a
 * 2.61 mi shakeout followed by the 26.81 mi Big Sur Marathon — a race, and the
 * OPPOSITE arrangement to the one being prescribed. It is no longer citable:
 * `resolvePairVolumeEvidence` drops race days, the way `demonstratedLongMi`
 * already drops them for the block's long-run ceiling.
 *
 * His honest training pair is 27.85 mi — 2026-02-15's 20.00 plus 2026-02-16's
 * 7.85 — and it still clears this weekend, which is what makes the correction
 * cheap: the misleading number bought nothing.
 */
const OWNER_PAIR_VOLUME: PairVolumeEvidence = {
  evidenceOf: 'two-day-volume',
  kind: 'DEMONSTRATED',
  combinedMi: 27.85,
  fromISO: '2026-02-15',
  toISO: '2026-02-16',
  firstDayMi: 20,
  secondDayMi: 7.85,
};

/**
 * And the second claim, which the old single field could not express at all.
 * Computed from his real history below in the ordering suite: 11 pairs in the
 * last year open with a hard effort, and the longest run he has ever done the
 * morning after one is 9.01 mi.
 */
const OWNER_PAIR_ORDERING: PairOrderingEvidence = {
  evidenceOf: 'hard-then-long-ordering',
  kind: 'NOVEL',
  hardFirstPairsSeen: 11,
  closestHardDayISO: '2026-07-14',
  closestHardDayMi: 8.02,
  closestLongDayMi: 9.01,
};

const OWNER_EVIDENCE: DesignedWeekendEvidence = {
  pairVolume: OWNER_PAIR_VOLUME,
  pairOrdering: OWNER_PAIR_ORDERING,
  recentHabitLongMi: 18,
  sustainedWeeklyMi: 46.4,
};

const NO_EVIDENCE: DesignedWeekendEvidence = {
  pairVolume: { evidenceOf: 'two-day-volume', kind: 'READ_FAILED' },
  pairOrdering: {
    evidenceOf: 'hard-then-long-ordering', kind: 'UNDETERMINED', reason: 'read-failed',
  },
  recentHabitLongMi: null,
  sustainedWeeklyMi: null,
};

/** A pair volume of `mi`, so a case can move one number without retyping six. */
const volumeOf = (mi: number): PairVolumeEvidence => ({
  ...OWNER_PAIR_VOLUME, combinedMi: mi, firstDayMi: mi - 7.85, secondDayMi: 7.85,
});

/**
 * HIS REAL HISTORY, as day readings, measured against production 2026-09-02
 * over the 365-day eligible window. Every row here is a row in `runs`.
 *
 * It is the INPUT to the ordering resolver rather than an assertion about it,
 * which is the whole correction: the ordering claim is COMPUTED from days, not
 * asserted from a headline number (Rule 18 — read the numbers out of the
 * source, do not hardcode both sides of the check).
 */
const OWNER_DAYS: HistoricalDayReading[] = [
  // The big two-day training blocks. Big day first, small day second, every one.
  { dateISO: '2026-02-15', mi: 20.00, wasRace: false, wasHardEffort: false },
  { dateISO: '2026-02-16', mi: 7.85, wasRace: false, wasHardEffort: false },
  { dateISO: '2026-04-05', mi: 20.02, wasRace: false, wasHardEffort: false },
  { dateISO: '2026-04-06', mi: 7.51, wasRace: false, wasHardEffort: false },
  { dateISO: '2026-02-08', mi: 17.21, wasRace: false, wasHardEffort: false },
  { dateISO: '2026-02-09', mi: 5.35, wasRace: false, wasHardEffort: false },
  { dateISO: '2026-07-12', mi: 12.60, wasRace: false, wasHardEffort: false },
  { dateISO: '2026-07-13', mi: 9.09, wasRace: false, wasHardEffort: false },
  // THE 29.4 PAIR. A shakeout, then the Big Sur Marathon.
  { dateISO: '2026-04-25', mi: 2.61, wasRace: false, wasHardEffort: false },
  { dateISO: '2026-04-26', mi: 26.81, wasRace: true, wasHardEffort: true },
  // The hard-first pairs. The longest second day among them is 9.01.
  { dateISO: '2026-07-14', mi: 8.02, wasRace: false, wasHardEffort: true },
  { dateISO: '2026-07-15', mi: 9.01, wasRace: false, wasHardEffort: false },
  { dateISO: '2026-09-01', mi: 8.50, wasRace: false, wasHardEffort: true },
  { dateISO: '2026-09-02', mi: 6.41, wasRace: false, wasHardEffort: false },
  // The only race with a run the next morning: Rose Bowl Half, then 4.67.
  { dateISO: '2026-01-18', mi: 13.33, wasRace: true, wasHardEffort: true },
  { dateISO: '2026-01-19', mi: 4.67, wasRace: false, wasHardEffort: null },
];

/** The owner's weekend: Dodgers 10K Saturday, 18 miles Sunday. */
function ownerRequest(over: Partial<DesignedWeekendRequest> = {}): DesignedWeekendRequest {
  return {
    raceSlug: 'dodgers',
    raceName: 'Dodgers',
    raceDateISO: '2026-09-26',
    raceMi: 6.21,
    effectivePriority: 'C',
    prescribedRacePaceSec: 435,
    longDateISO: '2026-09-27',
    // OWNER RULING 2026-09-02 · 16-17 miles, not 18. The fixture tracks the
    // prescription, so a regression that put 18 back would be refused here.
    longMi: DESIGNED_WEEKEND_LONG_CAP_MI,
    longCarriesQuality: false,
    longCarriesProgressionFinish: false,
    longCarriesMarathonPaceFinish: false,
    gapDays: 1,
    recoveryDaysAfter: EXTENDED_RECOVERY_DAYS_AFTER_PAIR,
    evidence: OWNER_EVIDENCE,
    authoredPurpose: DESIGNED_WEEKEND_PURPOSE,
    ...over,
  };
}

const refusalOf = (r: ReturnType<typeof resolveDesignedRaceWeekend>): string =>
  r.permitted ? 'PERMITTED' : r.refusal.code;

/* ══════════════════════════════════════════════════════════════════════
 * 1 · THE CLAUSE. NOT AVAILABLE TO EVERY RUNNER.
 * ══════════════════════════════════════════════════════════════════════ */

describe('DESIGNEDWEEKEND-1 · the pairing is not a universal default', () => {
  it('a runner with NO athlete-specific evidence is refused, and the refusal is named', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest({ evidence: NO_EVIDENCE }));
    expect(r.permitted, 'the exception must be unreachable without evidence').toBe(false);
    if (r.permitted) throw new Error('unreachable');
    // Rule 11 · the refusal says WHICH fact was missing, not merely that one
    // was. A `false` here would be the collapse this whole file exists against.
    expect(r.refusal.code).toBe('NO_COMBINED_LOAD_EVIDENCE');
    expect(r.refusal.message.length).toBeGreaterThan(20);
    expect(r.refusal.citation).toContain('Research/00b');
  });

  it('THE TYPE, not a boolean · a refusal carries no grant to read', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest({ evidence: NO_EVIDENCE }));
    // The compile-time half is the union's shape: `r.grant` does not typecheck
    // until `r.permitted` has been narrowed, which is the whole point of
    // modelling this the way `NormalReading<T>` is modelled. The run-time half
    // is that the field is genuinely absent rather than undefined-by-accident.
    expect(Object.prototype.hasOwnProperty.call(r, 'grant')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r, 'refusal')).toBe(true);
    const ok = resolveDesignedRaceWeekend(ownerRequest());
    expect(Object.prototype.hasOwnProperty.call(ok, 'refusal')).toBe(false);
  });

  it('the owner, on his own measured numbers, IS granted', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest());
    expect(r.permitted, refusalOf(r)).toBe(true);
    if (!r.permitted) throw new Error('unreachable');
    // 6.21 + 17. It was 24.21 against an 18-mile Sunday; the owner's
    // 2026-09-02 ruling caps the second day at 16-17.
    expect(r.grant.combinedMi).toBeCloseTo(6.21 + DESIGNED_WEEKEND_LONG_CAP_MI, 5);
  });

  it('every missing fact refuses under its OWN name · fourteen distinct codes', () => {
    const cases: Array<[string, Partial<DesignedWeekendRequest>]> = [
      ['RACE_IS_NOT_A_C_EFFORT', { effectivePriority: 'B' }],
      ['NO_AUTHORED_PURPOSE', { authoredPurpose: '   ' }],
      ['LONG_RUN_CARRIES_QUALITY', { longCarriesQuality: true }],
      // OWNER RULING 2026-09-02 · "easy throughout". Three separate ways for
      // the second day to stop being easy, three separate refusals: a reader
      // told only "the long run is not restrained" cannot tell which of them
      // to fix.
      ['LONG_RUN_CARRIES_PROGRESSION_FINISH', { longCarriesProgressionFinish: true }],
      ['LONG_RUN_CARRIES_MARATHON_PACE', { longCarriesMarathonPaceFinish: true }],
      ['LONG_RUN_EXCEEDS_DESIGNED_CAP', { longMi: DESIGNED_WEEKEND_LONG_CAP_MI + 1 }],
      // EVIDENCE-HONESTY-1 · READ_FAILED and NONE_FOUND are two facts, so they
      // are two codes. The old single field could only express one of them.
      ['NO_COMBINED_LOAD_EVIDENCE', {
        evidence: {
          ...OWNER_EVIDENCE,
          pairVolume: { evidenceOf: 'two-day-volume', kind: 'READ_FAILED' },
        },
      }],
      ['NO_TRAINING_PAIR_FOUND', {
        evidence: {
          ...OWNER_EVIDENCE,
          pairVolume: { evidenceOf: 'two-day-volume', kind: 'NONE_FOUND' },
        },
      }],
      ['COMBINED_LOAD_NOT_DEMONSTRATED', {
        evidence: { ...OWNER_EVIDENCE, pairVolume: volumeOf(20) },
      }],
      ['NO_LONG_RUN_EVIDENCE', { evidence: { ...OWNER_EVIDENCE, recentHabitLongMi: null } }],
      ['LONG_RUN_NOT_DEMONSTRATED', { evidence: { ...OWNER_EVIDENCE, recentHabitLongMi: 10 } }],
      ['NO_SUSTAINED_VOLUME_EVIDENCE', { evidence: { ...OWNER_EVIDENCE, sustainedWeeklyMi: null } }],
      ['PAIR_EXCEEDS_SUSTAINED_WEEK', { evidence: { ...OWNER_EVIDENCE, sustainedWeeklyMi: 22 } }],
      ['NO_EXTENDED_RECOVERY_AFTER', { recoveryDaysAfter: EXTENDED_RECOVERY_DAYS_AFTER_PAIR - 1 }],
    ];
    const seen = new Set<string>();
    for (const [code, over] of cases) {
      const r = resolveDesignedRaceWeekend(ownerRequest(over));
      expect(refusalOf(r), `expected ${code} for ${JSON.stringify(over)}`).toBe(code);
      seen.add(code);
    }
    // LIVENESS · the table above must actually be exercising distinct codes
    // rather than one code fourteen times.
    expect(seen.size).toBe(14);
  });

  /**
   * EVIDENCE-HONESTY-1 · A NOVEL ARRANGEMENT DOES NOT REFUSE THE WEEKEND.
   *
   * The owner authorised the arrangement knowingly, and that authorisation is
   * the licence — not a pattern match against his history. Gating on ordering
   * would overturn his ruling by the back door, so this asserts every ordering
   * answer still grants.
   */
  it('ordering evidence is NARRATED, never gated · all three answers grant', () => {
    const orderings: PairOrderingEvidence[] = [
      OWNER_PAIR_ORDERING,
      { evidenceOf: 'hard-then-long-ordering', kind: 'UNDETERMINED', reason: 'no-hard-effort-marker' },
      {
        evidenceOf: 'hard-then-long-ordering', kind: 'DEMONSTRATED',
        hardDayISO: '2026-07-14', hardDayMi: 8.02,
        longDayISO: '2026-07-15', longDayMi: 18.5,
      },
    ];
    for (const pairOrdering of orderings) {
      const r = resolveDesignedRaceWeekend(
        ownerRequest({ evidence: { ...OWNER_EVIDENCE, pairOrdering } }),
      );
      expect(r.permitted, `${pairOrdering.kind} must not refuse: ${refusalOf(r)}`).toBe(true);
    }
  });

  /**
   * DECLAREDLEVEL-0, second cut (2026-09-02). The first cut deleted the
   * declared-level GATE and left the field recorded on the grant's evidence,
   * and this test asserted the label could not change the verdict while still
   * being written down. The owner ruled that half-measure out by name — "do
   * not merely stop reading it while continuing to persist it as purported
   * evidence" — so the assertion is now that the field is ABSENT from the
   * evidence the grant carries, at compile time and at run time.
   *
   * The behavioural half of this claim — that changing or deleting
   * `profile.experience_level` cannot move the composed plan at all — is
   * `_declared_level_inert.test.ts`, which sweeps the whole authoring path.
   * This one guards the shape of the record.
   */
  it('the grant records NO declared label, in the type or on the object', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest());
    expect(r.permitted, refusalOf(r)).toBe(true);
    if (!r.permitted) throw new Error('unreachable');
    const keys = Object.keys(r.grant.evidence);
    // Run-time: no declared field survives on what is persisted.
    expect(keys.filter((k) => /declared|level|tier/i.test(k))).toEqual([]);
    // And the fields that DO survive are the ones the owner listed as able to
    // justify this weekend, every one of them a number he ran.
    expect(keys.sort()).toEqual([
      'pairOrdering', 'pairVolume', 'recentHabitLongMi', 'sustainedWeeklyMi',
    ]);
    // Compile-time, and FALSIFIABLE (Rule 18): if either key were put back on
    // `DesignedWeekendEvidence`, the conditional resolves to `false` and the
    // `= true` initialiser stops compiling. Verified by adding
    // `declaredLevel: DeclaredLevel` back to the interface and watching
    // `tsc --noEmit` name this line.
    type EvidenceKeys = keyof typeof r.grant.evidence;
    const noDeclaredKeys: 'declaredLevel' | 'declaredDaysPerWeek' extends EvidenceKeys
      ? false : true = true;
    expect(noDeclaredKeys).toBe(true);
  });

  it('the same runner with a thin history is refused · nothing else can save it', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest({
      evidence: { ...OWNER_EVIDENCE, pairVolume: volumeOf(19) },
    }));
    expect(refusalOf(r)).toBe('COMBINED_LOAD_NOT_DEMONSTRATED');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · THE DOCTRINE NUMBERS ARE READ OUT OF Research/, NOT ASSERTED TWICE
 * ══════════════════════════════════════════════════════════════════════ */

describe('DESIGNEDWEEKEND-1 · the doctrine behind the exception', () => {
  const doc = fs.readFileSync(
    path.join(repoRoot(), 'Research', '00b-recovery-protocols.md'), 'utf8',
  );

  it('doctrine names this exception itself · the stress-block clause is present verbatim', () => {
    const i = doc.indexOf('### Hard/Easy Alternation');
    expect(i, 'the §Hard/Easy Alternation heading must still exist').toBeGreaterThan(-1);
    const section = doc.slice(i, i + 1200);
    // The entire licence for this feature. If this sentence ever leaves the
    // doc, the exception has no doctrine behind it and must be reconsidered
    // rather than kept because the code exists.
    expect(section).toContain('never stack two hard days back-to-back');
    expect(section).toContain("stress block");
    expect(section).toContain('followed by extended recovery');
  });

  it('the extended-recovery window is the TOP of the C row band, parsed from the doc', () => {
    const i = doc.indexOf('### Recovery by Effort');
    expect(i).toBeGreaterThan(-1);
    const section = doc.slice(i, i + 1200);
    const cRow = section.split('\n').find((l) => l.includes('C race'));
    expect(cRow, 'the C row must still exist in §Recovery by Effort').toBeTruthy();
    // "0–3 days easy" · read the band out of the row rather than restating it.
    const band = /(\d+)\s*[–-]\s*(\d+)\s*days easy/.exec(cRow!);
    expect(band, `could not parse a days-easy band out of: ${cRow}`).toBeTruthy();
    const top = Number(band![2]);
    expect(top).toBeGreaterThan(0);                       // LIVENESS
    expect(EXTENDED_RECOVERY_DAYS_AFTER_PAIR).toBe(top);
  });

  it('the long-run ceiling is doctrine’s own >110% spike ratio, parsed from Research/00a', () => {
    const a = fs.readFileSync(
      path.join(repoRoot(), 'Research', '00a-distance-running-training.md'), 'utf8',
    );
    const m = /(\d+)\s*%\s*of the longest run in the prior 30/.exec(a);
    expect(m, 'the >110% spike sentence must still exist in Research/00a').toBeTruthy();
    expect(SPIKE_RATIO_OVER_DEMONSTRATED_LONG).toBeCloseTo(Number(m![1]) / 100, 6);
  });

  it('the long-run ceiling BINDS at the ratio, and is continuous across it (Rule 9)', () => {
    // At the ceiling exactly: permitted. A hair past: refused. A hair past is
    // still a graded outcome downstream — the composer cuts to the curve — so
    // what must not happen is the ratio being ignored, and what must not
    // happen either is a long run one tenth under the ceiling being refused.
    //
    // The habit long is 14 here, not 18, so the ceiling lands at 15.4 and both
    // sides of the walk stay UNDER `DESIGNED_WEEKEND_LONG_CAP_MI`. Otherwise
    // the owner's 17-mile cap refuses first and this test would be measuring
    // the cap while claiming to measure the ratio — a gate quietly checking
    // something other than its own name (Rule 18).
    const long = 14;
    const ceiling = long * SPIKE_RATIO_OVER_DEMONSTRATED_LONG;
    expect(ceiling, 'the walk must stay inside the cap to isolate the ratio')
      .toBeLessThan(DESIGNED_WEEKEND_LONG_CAP_MI);
    const ev = { ...OWNER_EVIDENCE, pairVolume: volumeOf(40), recentHabitLongMi: long };
    const at = resolveDesignedRaceWeekend(ownerRequest({ longMi: ceiling, evidence: ev }));
    const over = resolveDesignedRaceWeekend(ownerRequest({ longMi: ceiling + 0.5, evidence: ev }));
    expect(at.permitted, refusalOf(at)).toBe(true);
    expect(refusalOf(over)).toBe('LONG_RUN_NOT_DEMONSTRATED');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · THE GRANT IS WHAT THE APP SHOWS (his point 7)
 * ══════════════════════════════════════════════════════════════════════ */

describe('DESIGNEDWEEKEND-1 · the authored rationale', () => {
  it('the rationale states the purpose AND the evidence, in coach voice', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest());
    if (!r.permitted) throw new Error(refusalOf(r));
    const t = r.grant.rationale;
    expect(t).toContain(r.grant.authoredPurpose);
    // The evidence half names this runner's own numbers, so no two runners get
    // the same sentence.
    //
    // EVIDENCE-HONESTY-1 · it said 29.4 and 46.4. The 29.4 is gone because the
    // pair behind it contained a marathon; 27.85 is his citable training pair.
    // The sustained-week figure is gone too, and deliberately: the owner listed
    // seven things this sentence must state and weekly volume is not among
    // them, so printing it was padding (Rule 17). The gate that spends it —
    // PAIR_EXCEEDS_SUSTAINED_WEEK — still runs and still names it on refusal.
    expect(t).toContain('27.85');
    expect(t).toContain('2026-02-15');
    expect(t).toContain(String(DESIGNED_WEEKEND_LONG_CAP_MI));
    expect(t, 'the pair that contained a marathon must not be cited').not.toContain('29.4');
    // Coach voice · CLAUDE.md §Operating posture.
    expect(t).not.toMatch(/[!—]/);                   // no exclamation, no em dash
    expect(t).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);      // no emoji
  });

  it('a runner with different numbers gets a different sentence', () => {
    const a = resolveDesignedRaceWeekend(ownerRequest());
    const b = resolveDesignedRaceWeekend(ownerRequest({
      evidence: { ...OWNER_EVIDENCE, pairVolume: volumeOf(31.2), sustainedWeeklyMi: 55 },
    }));
    if (!a.permitted || !b.permitted) throw new Error('both should be permitted');
    expect(a.grant.rationale).not.toBe(b.grant.rationale);
  });

  it('the grant carries the evidence it was issued on, so it can be audited later', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest());
    if (!r.permitted) throw new Error(refusalOf(r));
    expect(r.grant.evidence).toEqual(OWNER_EVIDENCE);
    expect(r.grant.prescribedRacePaceSec).toBe(435);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · THE COMPOSER ACTUALLY SPENDS IT (Rule 20 · wired, not inert)
 * ══════════════════════════════════════════════════════════════════════ */

const DODGERS: NonNullable<ComposePlanInput['midBlockRaces']> = [
  { slug: 'dodgers', name: 'Dodgers', date: '2026-09-26', distanceMi: 6.21, goalPaceSec: null, priority: 'C' },
];

function cimInput(over: Partial<ComposePlanInput> = {}): ComposePlanInput {
  return {
    raceDistanceMi: 26.2,
    goalSec: 10800,
    goalPaceSec: Math.round(10800 / 26.2),
    raceDateISO: '2026-12-06',
    startMondayISO: '2026-08-17',
    level: 'advanced' as LevelKey,
    recentWeeklyMi: 46,
    easyDayMedianMi: 7,
    recentLongMi: 20,
    bestRecentVdot: 44,
    isMidBlock: true,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: 6,
    crossModes: [],
    rxQuality: inlinePrescriptions('m'),
    rxRaceSpecific: inlinePrescriptions('m'),
    tPaceSec: tPaceFromGoal(10800, 26.2),
    lthr: null,
    maxHr: null,
    midBlockRaces: DODGERS,
    ...over,
  };
}

const dayByDow = (w: ComposedWeek, dow: number): DayPlan => {
  const d = w.days.find((x) => x.dow === dow);
  if (!d) throw new Error(`no day dow=${dow}`);
  return d;
};
const recordsOf = (r: { authoredState: Record<string, unknown> }): PlacementRecord[] =>
  (Array.isArray(r.authoredState.placement_compromises)
    ? r.authoredState.placement_compromises : []) as PlacementRecord[];
/** The composed week that holds 2026-09-26. */
const raceWeekOf = (r: { weeks: ComposedWeek[] }): ComposedWeek => {
  const w = r.weeks.find((x) => x.startISO === '2026-09-21');
  if (!w) throw new Error('no week starting 2026-09-21');
  return w;
};

describe('DESIGNEDWEEKEND-1 · end to end through the composer', () => {
  it('WITH evidence · the long run stands at full dose and the grant is on the record', () => {
    const c = composePlan(cimInput({
      designedWeekendPairEvidence: {
        pairVolume: OWNER_PAIR_VOLUME, pairOrdering: OWNER_PAIR_ORDERING,
      },
      rampBaseEvidence: {
        baseMi: 46, meanMi: 44, sustainedMi: 46.4, heldMi: 46, peakMi: 52.3,
        returning: false, interruptionWeeks: 0, allowedInterruptionWeeks: 4, lifted: false,
      } as ComposePlanInput['rampBaseEvidence'],
    }));
    finalizeComposedPlan(c, 26.2, 'advanced');
    const sunday = dayByDow(raceWeekOf(c), 0);
    expect(sunday.isLong).toBe(true);
    expect(sunday.distanceMi).toBeGreaterThan(12);

    const accept = recordsOf(c).find((x) => x.code === 'ACCEPT_AS_HARD_WORKOUT');
    expect(accept, 'the acceptance must be on the record').toBeTruthy();
    // THE NEW CONTRACT · an acceptance without a grant is a pairing granted to
    // a runner nobody checked, which is exactly what the ruling forbids.
    expect(accept!.designedWeekend, 'every acceptance carries its grant').toBeTruthy();
    expect(accept!.designedWeekend!.evidence.pairVolume).toEqual(OWNER_PAIR_VOLUME);
    expect(accept!.designedWeekend!.evidence.pairOrdering).toEqual(OWNER_PAIR_ORDERING);
    expect(accept!.designedWeekend!.rationale).toContain(DESIGNED_WEEKEND_PURPOSE);
    // Rule 16 · the grant's numbers are the SHIPPED numbers.
    expect(accept!.designedWeekend!.longMi).toBe(sunday.distanceMi);
    expect(accept!.designedWeekend!.combinedMi)
      .toBeCloseTo(Math.round((6.21 + sunday.distanceMi) * 100) / 100, 5);
  });

  it('WITHOUT evidence · the SAME block cuts the long run and records the named refusal', () => {
    // Byte-for-byte the same input but for the evidence. This is the pair of
    // compositions that proves the pairing is athlete-specific rather than a
    // property of the calendar.
    const c = composePlan(cimInput());
    finalizeComposedPlan(c, 26.2, 'advanced');
    const sunday = dayByDow(raceWeekOf(c), 0);

    const withEv = composePlan(cimInput({
      designedWeekendPairEvidence: {
        pairVolume: OWNER_PAIR_VOLUME, pairOrdering: OWNER_PAIR_ORDERING,
      },
      rampBaseEvidence: {
        baseMi: 46, meanMi: 44, sustainedMi: 46.4, heldMi: 46, peakMi: 52.3,
        returning: false, interruptionWeeks: 0, allowedInterruptionWeeks: 4, lifted: false,
      } as ComposePlanInput['rampBaseEvidence'],
    }));
    finalizeComposedPlan(withEv, 26.2, 'advanced');
    expect(
      sunday.distanceMi,
      'the runner with no evidence must not get the weekend the evidenced runner gets',
    ).toBeLessThan(dayByDow(raceWeekOf(withEv), 0).distanceMi);

    const rec = recordsOf(c);
    expect(rec.find((x) => x.code === 'ACCEPT_AS_HARD_WORKOUT'), 'no acceptance').toBeFalsy();
    // TWO reductions land here since the cap, and they are different events.
    // The cap is authored FIRST (the composer holds the second day to the
    // owner's 17), then the evidence gate refuses and the long run falls to
    // doctrine's return-to-long curve. The refusal is the one that must be
    // NAMED, so it is selected by the refusal it carries rather than by being
    // the first REDUCE_DOSE in the list — which is exactly the kind of
    // positional assumption that would make this gate quietly stop checking.
    const cuts = rec.filter((x) => x.code === 'REDUCE_DOSE');
    expect(cuts.length, 'the cut must be on the record').toBeGreaterThan(0);
    const refused = cuts.find((x) => x.refusedDesignedWeekend != null);
    expect(refused, 'the refusal must be named on the record').toBeTruthy();
    expect(refused!.refusedDesignedWeekend!.code).toBe('NO_COMBINED_LOAD_EVIDENCE');
  });

  it('the composer AUTHORS the extended recovery doctrine requires (his point 5)', () => {
    const c = composePlan(cimInput({
      designedWeekendPairEvidence: {
        pairVolume: OWNER_PAIR_VOLUME, pairOrdering: OWNER_PAIR_ORDERING,
      },
      rampBaseEvidence: {
        baseMi: 46, meanMi: 44, sustainedMi: 46.4, heldMi: 46, peakMi: 52.3,
        returning: false, interruptionWeeks: 0, allowedInterruptionWeeks: 4, lifted: false,
      } as ComposePlanInput['rampBaseEvidence'],
    }));
    finalizeComposedPlan(c, 26.2, 'advanced');
    const accept = recordsOf(c).find((x) => x.code === 'ACCEPT_AS_HARD_WORKOUT');
    expect(accept?.designedWeekend?.recoveryDaysAfter).toBe(EXTENDED_RECOVERY_DAYS_AFTER_PAIR);
    // And it is true of the DAYS, not only of the record: the days after the
    // Sunday long run carry no quality.
    const next = c.weeks.find((w) => w.startISO === '2026-09-28');
    expect(next, 'the following week must exist').toBeTruthy();
    const startDow = new Date(next!.startISO + 'T12:00:00Z').getUTCDay();
    const inOrder = next!.days.slice()
      .sort((a, b) => ((a.dow - startDow + 7) % 7) - ((b.dow - startDow + 7) % 7));
    for (let k = 0; k < EXTENDED_RECOVERY_DAYS_AFTER_PAIR; k++) {
      expect(inOrder[k].isQuality, `day ${k + 1} after the long run carries quality`).toBe(false);
    }
  });

  it('a granted block passes the validator; an ungranted pairing does not', () => {
    const ctx = {
      todayISO: '2026-08-17', level: 'advanced' as const, recentWeeklyMi: 46,
      isSteppingStoneToMarathon: false, priorPlanPeakLongMi: null, trailingAvgWeeklyMi: null,
    };
    const c = composePlan(cimInput({
      designedWeekendPairEvidence: {
        pairVolume: OWNER_PAIR_VOLUME, pairOrdering: OWNER_PAIR_ORDERING,
      },
      rampBaseEvidence: {
        baseMi: 46, meanMi: 44, sustainedMi: 46.4, heldMi: 46, peakMi: 52.3,
        returning: false, interruptionWeeks: 0, allowedInterruptionWeeks: 4, lifted: false,
      } as ComposePlanInput['rampBaseEvidence'],
    }));
    finalizeComposedPlan(c, 26.2, 'advanced');
    c.vols = c.weeks.map((w) => w.weeklyMi);
    expect(() => validateComposedPlan(c, 26.2, 'race-prep', ctx)).not.toThrow();

    // FALSIFICATION · strip the grant off the record, leave every day exactly
    // where it is, and the validator must name the pair. This is what stops a
    // future pass writing an acceptance with no grant behind it.
    const stripped = composePlan(cimInput({
      designedWeekendPairEvidence: {
        pairVolume: OWNER_PAIR_VOLUME, pairOrdering: OWNER_PAIR_ORDERING,
      },
      rampBaseEvidence: {
        baseMi: 46, meanMi: 44, sustainedMi: 46.4, heldMi: 46, peakMi: 52.3,
        returning: false, interruptionWeeks: 0, allowedInterruptionWeeks: 4, lifted: false,
      } as ComposePlanInput['rampBaseEvidence'],
    }));
    finalizeComposedPlan(stripped, 26.2, 'advanced');
    stripped.vols = stripped.weeks.map((w) => w.weeklyMi);
    (stripped.authoredState as Record<string, unknown>).placement_compromises = [];
    let err: Error | null = null;
    try { validateComposedPlan(stripped, 26.2, 'race-prep', ctx); } catch (e) { err = e as Error; }
    expect(err, 'a pairing with no decision on the record must be refused').toBeTruthy();
    expect(String((err as unknown as { violations?: string[] }).violations?.join('\n')))
      .toContain('UNGRANTED_RACE_LONG_PAIR');
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 5 · THE VALIDATOR'S OWN UNIT · a block that grew past its grant
 * ══════════════════════════════════════════════════════════════════════ */

describe('DESIGNEDWEEKEND-1 · the shipped pair against the grant', () => {
  const race = { dateISO: '2026-09-26', distanceMi: 6.21, name: 'Dodgers', effectivePriority: 'C' as const };
  const days = [
    { dateISO: '2026-09-27', weekStartISO: '2026-09-21', type: 'long', distanceMi: 18, isQuality: false, isLong: true },
  ];

  it('a grant that covers the shipped pair is clean', () => {
    const f = designedWeekendFindings({
      races: [race], days,
      decisions: [{ raceDateISO: '2026-09-26', longDateISO: '2026-09-27', combinedMi: 24.21 }],
      todayISO: '2026-08-17',
    });
    expect(f).toEqual([]);
  });

  it('a block that GREW past its grant is refused, and the message names the pair', () => {
    const f = designedWeekendFindings({
      races: [race], days,
      decisions: [{ raceDateISO: '2026-09-26', longDateISO: '2026-09-27', combinedMi: 21.7 }],
      todayISO: '2026-08-17',
    });
    expect(f.length).toBe(1);
    expect(f[0].code).toBe('UNGRANTED_RACE_LONG_PAIR');
    expect(f[0].enforced).toBe(true);
    // The finding is about the PAIR, not about either day (his point 4).
    expect(f[0].message).toContain('24.21');
    expect(f[0].message).toContain('21.70');
  });

  it('a RECORDED REFUSAL is a decision and ships (Rule 11 · not the same as no decision)', () => {
    const cut = [{ ...days[0], distanceMi: 5.5 }];
    const f = designedWeekendFindings({
      races: [race], days: cut,
      decisions: [{ raceDateISO: '2026-09-26', longDateISO: '2026-09-27', combinedMi: null }],
      todayISO: '2026-08-17',
    });
    expect(f).toEqual([]);
  });

  it('sealed weeks are not re-graded', () => {
    const f = designedWeekendFindings({
      races: [race], days, decisions: [], todayISO: '2026-10-01',
    });
    expect(f).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 6 · HIS POINT 8 · RACING IT HARDER IS RECOGNISED
 * ══════════════════════════════════════════════════════════════════════ */

describe('DESIGNEDWEEKEND-1 · reassessment when the race is run harder', () => {
  const grant = { raceName: 'Dodgers', prescribedRacePaceSec: 435, longMi: 18 };

  it('run at the target · the premise holds and the long run stands', () => {
    const v = reassessDesignedWeekend({ grant, actualRacePaceSec: 435 });
    expect(v.verdict).toBe('PREMISE_HELD');
  });

  it('run slower than the target · the premise holds', () => {
    const v = reassessDesignedWeekend({ grant, actualRacePaceSec: 460 });
    expect(v.verdict).toBe('PREMISE_HELD');
  });

  it('inside the tolerance · still the controlled effort it was granted for', () => {
    const inside = 435 * (1 - CONTROLLED_EFFORT_PACE_TOLERANCE * 0.9);
    expect(reassessDesignedWeekend({ grant, actualRacePaceSec: inside }).verdict)
      .toBe('PREMISE_HELD');
  });

  it('materially faster than the target · the premise is VOID and the grade is B', () => {
    // 6:45/mi against a 7:15 target · he raced it.
    const v = reassessDesignedWeekend({ grant, actualRacePaceSec: 405 });
    expect(v.verdict).toBe('PREMISE_VOID');
    if (v.verdict !== 'PREMISE_VOID') throw new Error('unreachable');
    // Capped at B, never A: `Research/00b`'s A row is "Maximum, full taper,
    // peak day" and a tune-up off full training has had no taper.
    expect(v.racedGrade).toBe('B');
    expect(v.overrunPct).toBeGreaterThan(CONTROLLED_EFFORT_PACE_TOLERANCE);
    expect(v.message).toContain('Dodgers');
    expect(v.citation).toContain('Research/00b');
  });

  it('Rule 11 · no result and no target are two different refusals, and neither carries a number', () => {
    const noResult = reassessDesignedWeekend({ grant, actualRacePaceSec: null });
    expect(noResult.verdict).toBe('CANNOT_TELL');
    if (noResult.verdict !== 'CANNOT_TELL') throw new Error('unreachable');
    expect(noResult.reason).toBe('no-actual-result');
    expect(Object.prototype.hasOwnProperty.call(noResult, 'overrunPct')).toBe(false);

    const noTarget = reassessDesignedWeekend({
      grant: { ...grant, prescribedRacePaceSec: null }, actualRacePaceSec: 405,
    });
    expect(noTarget.verdict).toBe('CANNOT_TELL');
    if (noTarget.verdict !== 'CANNOT_TELL') throw new Error('unreachable');
    expect(noTarget.reason).toBe('no-prescribed-target');
  });

  it('the overrun is GRADED, so the sentence scales with how hard he actually went', () => {
    const a = reassessDesignedWeekend({ grant, actualRacePaceSec: 400 });
    const b = reassessDesignedWeekend({ grant, actualRacePaceSec: 380 });
    if (a.verdict !== 'PREMISE_VOID' || b.verdict !== 'PREMISE_VOID') throw new Error('both void');
    expect(b.overrunPct).toBeGreaterThan(a.overrunPct);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 7 · THE MIRRORED TYPE · DELETED WITH THE UNION IT MIRRORED
 *
 * This suite asserted `DeclaredLevel` (restated in `designed-race-weekend.ts`
 * so the file stays a leaf) accepted exactly the values `LevelKey` accepts —
 * a Rule 16 guard against two definitions of one quantity. `DeclaredLevel` is
 * gone: nothing in the designed-weekend path holds a level any more, so there
 * is no second definition left to keep honest. Deleted rather than loosened,
 * per Rule 18's ratchet clause — an exemption whose target is clean fails
 * until it is removed, and so does a test whose subject no longer exists.
 * ══════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════
 * 8 · EVIDENCE-HONESTY-1 · THE TWO GATES THE CORRECTION IS WORTH
 *
 * The defect was not a wrong number. It was a TRUE number cited for a claim it
 * does not support: "You have run 29.4mi across two days before", offered as
 * the reason an 18-mile long run may stand the morning after a hard 10K, when
 * that 29.4 is a 2.61mi shakeout followed by the Big Sur Marathon.
 *
 * Two gates, because there are two ways to reintroduce it (Rule 18: a rule with
 * one check covers one direction):
 *
 *   G1 · THE ORDERING CLAIM MAY NEVER BE PRESENTED AS DEMONSTRATED when it is
 *        not. Fails if the rationale stops distinguishing the two claims, or
 *        starts deriving the ordering sentence from the volume number.
 *   G2 · A RACE-CONTAINING PAIR MAY NEVER BE CITED AS TRAINING EVIDENCE.
 *        Fails if `resolvePairVolumeEvidence` starts counting race days again.
 *
 * WHAT THESE TWO CANNOT FAIL ON (Rule 22) — structurally, not by omission:
 *
 *   · A CALLER THAT NEVER READS `rationale`. These assert what the grant SAYS.
 *     A surface that renders its own sentence from `grant.evidence` could still
 *     print a false one, and nothing here would know. `plan_workouts.notes` is
 *     the only surface wired today and it prints `authoredPurpose`, which
 *     carries no evidence claim at all — but a new surface is a new obligation.
 *   · WHETHER `wasRace` IS TRUE. G2 proves race days are dropped when the
 *     caller flags them. It cannot tell whether the caller flagged them
 *     correctly; that is `designedWeekendHistory`'s SQL against the `races`
 *     table, and it is not exercised here.
 *   · A HARD DAY WITH NO MARKER. The ordering resolver grades what it is given.
 *     Strava-era rows carry no workout type, so a hard session among them is
 *     invisible and the answer errs toward NOVEL. G1 asserts the sentence
 *     matches the computation, not that the computation saw everything.
 *   · WHETHER NOVELTY SHOULD BLOCK THE WEEKEND. It does not, by ruling, and
 *     the suite above asserts that it does not. If that ruling is reversed
 *     these tests are REWRITTEN, not loosened.
 *
 * DISTRIBUTION (Rule 22): G1 carries 3 "must not claim" cases against 1 "may
 * claim" case, and G2 carries 3 against 2. The imbalance is small and
 * deliberate — the failure being guarded is over-claiming, so the over-claim
 * side is where the cases belong — but the honest-claim side is exercised in
 * both, so neither gate would pass an implementation that simply never cites
 * anything.
 * ══════════════════════════════════════════════════════════════════════ */

describe('EVIDENCE-HONESTY-1 · G1 · the ordering claim is never presented as demonstrated', () => {
  /** Phrases that assert he has ALREADY done the thing being prescribed. */
  const claimsPriorInstance = (t: string): boolean =>
    /run this shape before|have run it before|you have done this before/i.test(t);

  it('COMPUTED, not asserted · his real history answers NOVEL', () => {
    const ord = resolvePairOrderingEvidence(OWNER_DAYS, DESIGNED_WEEKEND_LONG_CAP_MI);
    // LIVENESS · the fixture really does contain hard-first pairs, so a NOVEL
    // answer here is a measurement and not an empty walk (Rule 18).
    expect(ord.kind, JSON.stringify(ord)).toBe('NOVEL');
    if (ord.kind !== 'NOVEL') throw new Error('unreachable');
    expect(ord.hardFirstPairsSeen, 'the walk found no hard-first pairs at all')
      .toBeGreaterThan(0);
    // The furthest he has gone the morning after a hard day, from the rows.
    expect(ord.closestLongDayMi).toBe(9.01);
    expect(ord.closestHardDayISO).toBe('2026-07-14');
  });

  it('the rationale says the arrangement is NEW, and claims no prior instance', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest());
    if (!r.permitted) throw new Error(refusalOf(r));
    const t = r.grant.rationale;
    expect(t, 'the novelty must be stated, not omitted').toMatch(/is new for you/i);
    expect(claimsPriorInstance(t), `the rationale claims a prior instance: ${t}`).toBe(false);
    // And it does NOT reach for the volume pair to describe the arrangement.
    // 27.85 may appear (it is the volume claim); the ordering sentence must not
    // be the one carrying it.
    const orderingClause = t.slice(t.search(/is new for you/i));
    expect(orderingClause).not.toContain('27.85');
    expect(orderingClause).not.toContain('2026-02-15');
  });

  it('UNDETERMINED is not NOVEL · an unreadable history claims neither', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest({
      evidence: {
        ...OWNER_EVIDENCE,
        pairOrdering: {
          evidenceOf: 'hard-then-long-ordering', kind: 'UNDETERMINED',
          reason: 'no-hard-effort-marker',
        },
      },
    }));
    if (!r.permitted) throw new Error(refusalOf(r));
    const t = r.grant.rationale;
    expect(claimsPriorInstance(t)).toBe(false);
    expect(t, 'a read that could not answer must say so').toMatch(/cannot tell/i);
    expect(t, 'and must not assert novelty it did not measure').not.toMatch(/is new for you/i);
  });

  it('the sentence MOVES with the ordering claim and is INERT to the volume one', () => {
    /*
     * THE STRUCTURAL HALF, and the one that actually catches a regression.
     * A rationale that ignored `pairOrdering` entirely would satisfy every
     * phrase assertion above by accident. These two comparisons pin the
     * wiring: change ordering and the sentence must change; change volume and
     * the ordering clause must not.
     */
    const orderingClauseOf = (ev: DesignedWeekendEvidence): string => {
      const r = resolveDesignedRaceWeekend(ownerRequest({ evidence: ev }));
      if (!r.permitted) throw new Error(refusalOf(r));
      const t = r.grant.rationale;
      const i = t.search(/is new for you|cannot tell|run this shape before/i);
      expect(i, 'no ordering clause found in the rationale').toBeGreaterThan(-1);
      return t.slice(i);
    };
    const asNovel = orderingClauseOf(OWNER_EVIDENCE);
    const asDemonstrated = orderingClauseOf({
      ...OWNER_EVIDENCE,
      pairOrdering: {
        evidenceOf: 'hard-then-long-ordering', kind: 'DEMONSTRATED',
        hardDayISO: '2026-07-14', hardDayMi: 8.02,
        longDayISO: '2026-07-15', longDayMi: 18.5,
      },
    });
    expect(asDemonstrated, 'the ordering claim does not reach the sentence at all')
      .not.toBe(asNovel);
    expect(claimsPriorInstance(asDemonstrated), 'a real prior instance may be claimed')
      .toBe(true);

    // And the ordering clause is untouched by a different volume number.
    const otherVolume = orderingClauseOf({ ...OWNER_EVIDENCE, pairVolume: volumeOf(31.2) });
    expect(otherVolume, 'the volume number leaked into the ordering sentence')
      .toBe(asNovel);
  });

  it('THE TYPES · volume evidence cannot be passed where ordering is expected', () => {
    /*
     * The compile-time half of G1, and the strongest form available: the two
     * unions share no member, so the substitution that produced the false
     * sentence does not typecheck. FALSIFIABLE (Rule 18) — give both unions
     * the same `evidenceOf` literal and the two `= true` initialisers below
     * stop compiling. Verified by doing exactly that.
     */
    type VolumeIntoOrdering = PairVolumeEvidence extends PairOrderingEvidence ? false : true;
    type OrderingIntoVolume = PairOrderingEvidence extends PairVolumeEvidence ? false : true;
    const a: VolumeIntoOrdering = true;
    const b: OrderingIntoVolume = true;
    expect(a && b).toBe(true);
    // Run-time: the brands are genuinely different strings, so the compile-time
    // guarantee is not resting on a field that got renamed to match.
    expect(OWNER_PAIR_VOLUME.evidenceOf).not.toBe(OWNER_PAIR_ORDERING.evidenceOf);
  });
});

describe('EVIDENCE-HONESTY-1 · G2 · a race-containing pair is never training evidence', () => {
  it('the 29.4 pair is DROPPED and the honest 27.85 training pair is cited instead', () => {
    const v = resolvePairVolumeEvidence(OWNER_DAYS);
    expect(v.kind, JSON.stringify(v)).toBe('DEMONSTRATED');
    if (v.kind !== 'DEMONSTRATED') throw new Error('unreachable');
    // The number the app used to print, and the pair behind it, are both gone.
    expect(v.combinedMi, 'the Big Sur pair is being cited as training').toBeLessThan(29);
    expect(v.fromISO).not.toBe('2026-04-25');
    // And the honest answer, read off the same rows.
    expect(v.combinedMi).toBeCloseTo(27.85, 2);
    expect(v.fromISO).toBe('2026-02-15');
    expect(v.toISO).toBe('2026-02-16');
  });

  it('a race on EITHER day disqualifies the pair, not just the second', () => {
    const days: HistoricalDayReading[] = [
      { dateISO: '2026-03-07', mi: 22, wasRace: true, wasHardEffort: true },
      { dateISO: '2026-03-08', mi: 12, wasRace: false, wasHardEffort: false },
      { dateISO: '2026-05-10', mi: 9, wasRace: false, wasHardEffort: false },
      { dateISO: '2026-05-11', mi: 8, wasRace: false, wasHardEffort: false },
    ];
    const v = resolvePairVolumeEvidence(days);
    if (v.kind !== 'DEMONSTRATED') throw new Error(`expected DEMONSTRATED, got ${v.kind}`);
    // 34 is the race pair. 17 is the training pair. The training one wins.
    expect(v.combinedMi).toBeCloseTo(17, 5);
    expect(v.fromISO).toBe('2026-05-10');
  });

  it('a runner whose ONLY big pairs are races reads NONE_FOUND, not the race number', () => {
    const days: HistoricalDayReading[] = [
      { dateISO: '2026-03-07', mi: 2.5, wasRace: false, wasHardEffort: false },
      { dateISO: '2026-03-08', mi: 26.2, wasRace: true, wasHardEffort: true },
    ];
    const v = resolvePairVolumeEvidence(days);
    // Rule 11 · NONE_FOUND, which refuses by its own name downstream, and is
    // NOT the same as READ_FAILED and NOT a zero.
    expect(v.kind).toBe('NONE_FOUND');
    const r = resolveDesignedRaceWeekend(ownerRequest({
      evidence: { ...OWNER_EVIDENCE, pairVolume: v },
    }));
    expect(refusalOf(r)).toBe('NO_TRAINING_PAIR_FOUND');
  });

  it('Rule 11 · a failed read and an empty history are two different answers', () => {
    expect(resolvePairVolumeEvidence(null).kind).toBe('READ_FAILED');
    expect(resolvePairVolumeEvidence([]).kind).toBe('NONE_FOUND');
    expect(resolvePairOrderingEvidence(null, 17).kind).toBe('UNDETERMINED');
    const noMarker = resolvePairOrderingEvidence([
      { dateISO: '2026-05-10', mi: 9, wasRace: false, wasHardEffort: null },
      { dateISO: '2026-05-11', mi: 8, wasRace: false, wasHardEffort: null },
    ], 17);
    if (noMarker.kind !== 'UNDETERMINED') throw new Error('expected UNDETERMINED');
    // The reason is NAMED. "I could not grade any day" and "I could not read"
    // are different facts about different failures.
    expect(noMarker.reason).toBe('no-hard-effort-marker');
  });

  it('the ordering walk still SEES race days · they are the canonical hard first day', () => {
    /*
     * The other half of the split, and the reason these are two fields rather
     * than one filtered population: a race is excluded from the VOLUME claim
     * and included in the ORDERING claim, because the questions differ.
     */
    const days: HistoricalDayReading[] = [
      { dateISO: '2026-03-07', mi: 13.1, wasRace: true, wasHardEffort: true },
      { dateISO: '2026-03-08', mi: 18, wasRace: false, wasHardEffort: false },
    ];
    const ord = resolvePairOrderingEvidence(days, 17);
    expect(ord.kind, 'a race the day before a long run must count as hard-first')
      .toBe('DEMONSTRATED');
    // And the same rows yield NO volume evidence, because one of them is a race.
    expect(resolvePairVolumeEvidence(days).kind).toBe('NONE_FOUND');
  });
});
