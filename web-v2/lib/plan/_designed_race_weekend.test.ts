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
 *     gate was removed 2026-09-02 and there is a test asserting a label cannot
 *     change the verdict, but nothing here would catch a NEW gate added on a
 *     readiness score or a confidence figure. That is a review obligation, not
 *     a gated one.
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
  EXTENDED_RECOVERY_DAYS_AFTER_PAIR,
  SPIKE_RATIO_OVER_DEMONSTRATED_LONG,
  CONTROLLED_EFFORT_PACE_TOLERANCE,
  type DesignedWeekendEvidence,
  type DesignedWeekendRequest,
  type DeclaredLevel,
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
 * invented: sustained 46.4 mi/wk, longest 18.0 mi, best two-day total 29.4 mi
 * starting 2026-04-25, declared advanced, six days a week.
 */
const OWNER_EVIDENCE: DesignedWeekendEvidence = {
  demonstratedPairMi: 29.4,
  demonstratedPairFromISO: '2026-04-25',
  demonstratedLongMi: 18,
  sustainedWeeklyMi: 46.4,
  declaredLevel: 'advanced',
  declaredDaysPerWeek: 6,
};

const NO_EVIDENCE: DesignedWeekendEvidence = {
  demonstratedPairMi: null,
  demonstratedPairFromISO: null,
  demonstratedLongMi: null,
  sustainedWeeklyMi: null,
  declaredLevel: null,
  declaredDaysPerWeek: null,
};

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
    longMi: 18,
    longCarriesQuality: false,
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
    expect(r.grant.combinedMi).toBeCloseTo(24.21, 5);
  });

  it('every missing fact refuses under its OWN name · ten distinct codes', () => {
    const cases: Array<[string, Partial<DesignedWeekendRequest>]> = [
      ['RACE_IS_NOT_A_C_EFFORT', { effectivePriority: 'B' }],
      ['NO_AUTHORED_PURPOSE', { authoredPurpose: '   ' }],
      ['LONG_RUN_CARRIES_QUALITY', { longCarriesQuality: true }],
      ['NO_COMBINED_LOAD_EVIDENCE', { evidence: { ...OWNER_EVIDENCE, demonstratedPairMi: null } }],
      ['COMBINED_LOAD_NOT_DEMONSTRATED', { evidence: { ...OWNER_EVIDENCE, demonstratedPairMi: 20 } }],
      ['NO_LONG_RUN_EVIDENCE', { evidence: { ...OWNER_EVIDENCE, demonstratedLongMi: null } }],
      ['LONG_RUN_NOT_DEMONSTRATED', { evidence: { ...OWNER_EVIDENCE, demonstratedLongMi: 10 } }],
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
    // rather than one code ten times.
    expect(seen.size).toBe(10);
  });

  /**
   * REPLACES the two declared-level tests, 2026-09-02. They asserted that a
   * runner declaring 'advanced' could have this weekend and one declaring
   * 'intermediate' could not. The owner removed self-declared experience-level
   * bands from training decisions entirely — his own row reads 'advanced'
   * against a measured best week of 48.5 mi — so the gate is gone and this is
   * the assertion that it stays gone.
   */
  it('a LABEL cannot buy this weekend, and cannot lose it either', () => {
    const levels: DeclaredLevel[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus', null];
    const verdicts = levels.map((declaredLevel) =>
      resolveDesignedRaceWeekend(ownerRequest({ evidence: { ...OWNER_EVIDENCE, declaredLevel } })));
    for (let i = 0; i < levels.length; i++) {
      expect(
        verdicts[i].permitted,
        `declared level ${String(levels[i])} changed the verdict · ${refusalOf(verdicts[i])}`,
      ).toBe(true);
    }
    // And the label is still RECORDED, because a grant's account of the runner
    // should be complete even where a field is not gated on.
    const g = verdicts[2];
    if (!g.permitted) throw new Error('unreachable');
    expect(g.grant.evidence.declaredLevel).toBe('advanced');
  });

  it('the same runner with a thin history is refused, whatever his label says', () => {
    const r = resolveDesignedRaceWeekend(ownerRequest({
      evidence: { ...OWNER_EVIDENCE, declaredLevel: 'advanced_plus', demonstratedPairMi: 19 },
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
    const long = 18;
    const ceiling = long * SPIKE_RATIO_OVER_DEMONSTRATED_LONG;
    const at = resolveDesignedRaceWeekend(ownerRequest({ longMi: ceiling, evidence: { ...OWNER_EVIDENCE, demonstratedPairMi: 40 } }));
    const over = resolveDesignedRaceWeekend(ownerRequest({ longMi: ceiling + 0.5, evidence: { ...OWNER_EVIDENCE, demonstratedPairMi: 40 } }));
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
    expect(t).toContain('29.4');
    expect(t).toContain('18');
    expect(t).toContain('46.4');
    // Coach voice · CLAUDE.md §Operating posture.
    expect(t).not.toMatch(/[!—]/);                   // no exclamation, no em dash
    expect(t).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);      // no emoji
  });

  it('a runner with different numbers gets a different sentence', () => {
    const a = resolveDesignedRaceWeekend(ownerRequest());
    const b = resolveDesignedRaceWeekend(ownerRequest({
      evidence: { ...OWNER_EVIDENCE, demonstratedPairMi: 31.2, sustainedWeeklyMi: 55 },
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
      demonstratedPairMi: 29.4,
      demonstratedPairFromISO: '2026-04-25',
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
    expect(accept!.designedWeekend!.evidence.demonstratedPairMi).toBe(29.4);
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
      demonstratedPairMi: 29.4,
      demonstratedPairFromISO: '2026-04-25',
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
    const cut = rec.find((x) => x.code === 'REDUCE_DOSE');
    expect(cut, 'the cut must be on the record').toBeTruthy();
    expect(cut!.refusedDesignedWeekend, 'the refusal must be named on the record').toBeTruthy();
    expect(cut!.refusedDesignedWeekend!.code).toBe('NO_COMBINED_LOAD_EVIDENCE');
  });

  it('the composer AUTHORS the extended recovery doctrine requires (his point 5)', () => {
    const c = composePlan(cimInput({
      demonstratedPairMi: 29.4,
      demonstratedPairFromISO: '2026-04-25',
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
      demonstratedPairMi: 29.4,
      demonstratedPairFromISO: '2026-04-25',
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
      demonstratedPairMi: 29.4,
      demonstratedPairFromISO: '2026-04-25',
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
 * 7 · THE MIRRORED TYPE (Rule 16 · one quantity, one name)
 * ══════════════════════════════════════════════════════════════════════ */

describe('DESIGNEDWEEKEND-1 · the level union is not a second definition', () => {
  it('DeclaredLevel and LevelKey accept the same values', () => {
    // `designed-race-weekend.ts` restates the union to stay a leaf. This is
    // the assertion that keeps the restatement honest — a level added to
    // `LevelKey` and not here would compile until this line.
    const asLevelKey: LevelKey[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus', null];
    const asDeclared: DeclaredLevel[] = asLevelKey;
    const back: LevelKey[] = asDeclared;
    expect(back.length).toBe(5);
  });
});
