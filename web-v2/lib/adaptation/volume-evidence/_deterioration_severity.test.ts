/**
 * lib/adaptation/volume-evidence/_deterioration_severity.test.ts
 *
 * DETERIORATION-SEVERITY-1 · THE GATE over the one question two files answered
 * differently.
 *
 * ── THE CONTRADICTION THIS SUITE EXISTS TO KEEP CLOSED ────────────────────
 *
 * `lib/adaptation/canonical/deterioration.ts`, for exactly one deteriorated
 * session, wrote:
 *
 *     "One session showed late deterioration, which reduces confidence without
 *      blocking progression."
 *
 * `admit.ts` condition 3 then refused the whole week on `deterioratedCount >
 * 0`. Two answers to one question (Rule 16), and doctrine states the first:
 * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q13 says one deteriorated session
 * "must not independently block progression unless the deterioration is
 * extreme or that session was the direct prerequisite".
 *
 * The measured cost was not academic. It was the ONLY reason 2026-06-15 -- the
 * one week on the reference account carrying a real admissible surplus, 47.3
 * mi run against 45.5 prescribed -- contributed nothing through the live path.
 *
 * ── THE OWNER'S GOVERNING INSTRUCTION, AND HOW THIS FILE OBEYS IT ─────────
 *
 *     "Do not weaken the threshold merely to make my historical week fire.
 *      Apply the same rule symmetrically across constructed cases, then replay
 *      my data."
 *
 * So NOTHING here is tuned to his week. The two edges of the severity ramp are
 * READ OUT OF `Research/03-heart-rate-zones.md` §12 AT GATE TIME (part 0), the
 * constructed cases in part 2 run in BOTH directions, and his real history is
 * replayed afterwards by `_replay_real_history.script.ts` and
 * `_volume_seam_probe.script.ts` against whatever this rule produces. If his
 * week still contributed nothing that would be a correct result, and the
 * report says so.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ──────────────────────────────
 *
 * Stated first, because everything below is green and green is worth less than
 * it looks.
 *
 * · IT CANNOT FAIL ON THE BAND TABLE BEING THE WRONG TABLE FOR THIS QUESTION.
 *   `Research/03` §12 states its bands for a STEADY 60-90 minute aerobic run
 *   compared FIRST HALF against SECOND HALF. Q13 compares the MIDDLE third
 *   against the FINAL third of any comparable session. The transfer is
 *   declared in `deterioration.ts`'s own doc comment and it is a judgement no
 *   citation settles. If it is wrong, every case here is confidently wrong
 *   with it.
 * · IT CANNOT FAIL ON THE SHAPE OF THE RAMP. Doctrine supplies the two edges,
 *   5 per cent and 8 per cent. That the curve between them is a straight line
 *   rather than a smoothstep is the engine's choice, and no document
 *   constrains it.
 * · IT CANNOT FAIL ON Q13's SECOND ESCAPE. Q13 also permits one session to
 *   block when it "was the direct prerequisite". Nothing in this engine knows
 *   which session is a prerequisite for which progression, so that escape is
 *   unimplemented and no case here can notice its absence.
 * · IT CANNOT FAIL ON A WRONG VERDICT UPSTREAM. `assessDeterioration` decides
 *   whether a session fell away; this suite prices the answer. A signal that
 *   fires on a cool-down produces a confident, smooth, wrong discount.
 * · IT CANNOT FAIL ON A CLIFF BETWEEN SAMPLE POINTS. The walks step at 1e-5 to
 *   1e-4 of their input, far finer than anything this engine expresses, but a
 *   narrower discontinuity would be invisible.
 * · IT CANNOT FAIL ON THE SEAM. `AUTOMATIC_ADAPTATION_AUTHORITY` is false and
 *   this directory has no writer. Every case proves an advisory is correct.
 *
 * ── RULE 22 · THE DISTRIBUTION, COUNTED AND ASSERTED ──────────────────────
 *
 * "Count the cases on each side. A large imbalance is a finding in itself."
 * Counted mechanically in the last block rather than claimed here, because the
 * failure this whole change corrects is a suite that only knew how to assert a
 * refusal. The behavioural block admits and refuses, and the assertion is that
 * NEITHER side is empty and neither is more than twice the other.
 *
 * ── RULE 18 · THIS GATE HAS BEEN MADE TO FAIL ─────────────────────────────
 *
 * Part 3 case C runs the REAL `assertContinuousAndMonotone` over the design
 * this change rejected -- a discount gated on the VERDICT rather than on the
 * severity -- and the assertion names the cliff. The negative control on the
 * next line runs the identical assertion over the real curve and it passes.
 * `_falsify_deterioration_severity.script.ts` plants eight defects in the real
 * source tree and records the verbatim failures.
 *
 * ── ONE WART, SAID RATHER THAN LEFT TO BE FOUND ───────────────────────────
 *
 * This file imports `walk` and `assertContinuousAndMonotone` FROM
 * `_continuity_walk.test.ts`, which means that suite's own `describe` blocks
 * execute here as well and its cases are counted twice in a full run. That is
 * deliberate and it is the same trade `_falsify_continuity.script.ts` already
 * makes: Rule 18 says a falsifier that re-implements the check proves the
 * re-implementation fails, not the check, and importing the real assertion is
 * worth more than a tidy test count. Read this file's own case count as the
 * total minus that suite's.
 */
import { describe, expect, it } from 'vitest';
import { parsePctBand, resolveCitation } from '@/lib/doctrine/resolve';
import {
  assessDeterioration,
  decouplingReadabilityFrac,
  deteriorationPattern,
  paHrDecouplingFrac,
  DECOUPLING_READABILITY_DURATION_CEIL_MIN,
  DECOUPLING_READABILITY_DURATION_FLOOR_MIN,
  DECOUPLING_READABILITY_HEAT_HI_F,
  DECOUPLING_READABILITY_HEAT_LO_F,
  DECOUPLING_READABILITY_TERRAIN_HI_S_PER_MI,
  DECOUPLING_READABILITY_TERRAIN_LO_S_PER_MI,
  steadyEffortReadabilityFrac,
  type DeteriorationResult,
  type SessionEnvironmentalContext,
} from '@/lib/adaptation/canonical/deterioration';
import type { ComparableThirds, Truncation } from '@/lib/adaptation/canonical/input';
import { admitSurplus, type AdmissionInput } from './admit';
import { classifyWeekSurplus } from './classify';
import { readWeekEvidence } from './evidence';
import { assertContinuousAndMonotone, walk } from './_continuity_walk.test';
import {
  DETERIORATION_DECOUPLING_FRAC,
  DETERIORATION_SEVERITY_EXTREME_FRAC,
  deteriorationConfidenceWeight,
} from './weight';
import {
  absent, failed, measured,
  type Measured, type SurplusRun, type WeekSurplusInput,
} from './contract';
import type { HrTraceVerdict } from '@/lib/adaptation/canonical/hr-trace-credibility';

const RESEARCH_03 = 'Research/03-heart-rate-zones.md';
/** The table header row, verbatim. Never a line number (Rule 7 point 1). */
const DECOUPLING_TABLE = '| Decoupling % | Meaning |';

/* ══════════════════════════════════════════════════════════════════════════
 * PART 0 · THE DOCTRINE, READ OUT OF THE DOCUMENT AT GATE TIME
 *
 * Rule 7 point 2 and Rule 18: "a check that hardcodes both sides only proves
 * the test agrees with itself." Neither number below is typed here.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('0 · the severity band is Research/03 §12\'s own table, today', () => {
  const table = () => resolveCitation(RESEARCH_03, DECOUPLING_TABLE).table();

  /* Rows are found by what they MEAN rather than by their label, because the
   * labels carry en-dashes and a claim that depends on a dash character is a
   * claim that will rot on a copy-edit. The meaning is also the half the
   * mapping actually rests on. */
  const rowSaying = (re: RegExp): Record<string, string> => {
    const hit = table().rows.find((r) => re.test(r.Meaning));
    if (hit == null) {
      throw new Error(
        `DOCTRINE · no row of ${RESEARCH_03} §12's decoupling table means ${re}. `
        + `Rows: ${table().rows.map((r) => `${r['Decoupling %']} = ${r.Meaning}`).join(' · ')}`,
      );
    }
    return hit;
  };

  it('the point where a fade starts to cost anything is the top of the SUSTAINABLE row', () => {
    const row = rowSaying(/sustainable/i);
    const [, hi] = parsePctBand(row['Decoupling %']);
    expect(DETERIORATION_DECOUPLING_FRAC).toBe(hi);
    // The wording is the argument, so it is asserted too: a session inside
    // this band costs nothing BECAUSE doctrine calls it sustainable. If that
    // word goes, the zero-cost floor has to be re-argued rather than kept.
    expect(row.Meaning.toLowerCase()).toContain('sustainable');
  });

  it('the point where one session may block on its own is the floor of the ENDURANCE GAP row', () => {
    const row = rowSaying(/before progressing/i);
    const [lo] = parsePctBand(row['Decoupling %']);
    expect(DETERIORATION_SEVERITY_EXTREME_FRAC).toBe(lo);
    // Q13 never defines "extreme". This row is where doctrine defines it, in
    // its own words, and those words are what license a categorical refusal.
    expect(row.Meaning.toLowerCase()).toContain('build base before progressing');
  });

  it('the ramp runs across the band doctrine itself calls a transition, and nowhere else', () => {
    const middle = rowSaying(/approaching aerobic limit/i);
    const [lo, hi] = parsePctBand(middle['Decoupling %']);
    expect(lo).toBe(DETERIORATION_DECOUPLING_FRAC);
    expect(hi).toBe(DETERIORATION_SEVERITY_EXTREME_FRAC);
    // So the interpolation happens exactly where doctrine is ambiguous, and
    // nowhere doctrine has already stated an answer.
    expect(DETERIORATION_SEVERITY_EXTREME_FRAC).toBeGreaterThan(DETERIORATION_DECOUPLING_FRAC);
  });

  it('LIVENESS · the table really was read, and it has four rows', () => {
    // Rule 18 point 2. A resolver that silently returned an empty section
    // would make every case above vacuous while reporting confidence.
    const rows = table().rows;
    expect(rows.length).toBe(4);
    expect(table().headers).toEqual(['Decoupling %', 'Meaning']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART 1 · THE MEASUREMENT
 * ═══════════════════════════════════════════════════════════════════════ */

const thirds = (o: {
  midPace?: number; finPace?: number;
  midHr?: number | null; finHr?: number | null;
  comparable?: boolean;
}): ComparableThirds => ({
  middlePaceSecPerMi: measured(o.midPace ?? 480),
  finalPaceSecPerMi: measured(o.finPace ?? 480),
  middleHrBpm: o.midHr == null ? failed('no heart-rate trace') : measured(o.midHr),
  finalHrBpm: o.finHr == null ? failed('no heart-rate trace') : measured(o.finHr),
  comparable: o.comparable ?? true,
});

const INTACT: Truncation = { truncated: false, completeWorkPhasesCaptured: true, note: '' };

describe('1 · severity is Research/03 §12\'s formula, and it is null exactly when the verdict is UNKNOWN', () => {
  it('reproduces ((EF_1st / EF_2nd) - 1) computed independently from speed and HR', () => {
    const midPace = 480;
    const finPace = 504;
    const midHr = 150;
    const finHr = 158;
    // The doc's own formula, in the doc's own units: EF = speed / HR.
    const efMid = (1 / midPace) / midHr;
    const efFin = (1 / finPace) / finHr;
    const fromDoc = (efMid / efFin) - 1;
    expect(paHrDecouplingFrac(midPace, finPace, midHr, finHr)).toBeCloseTo(fromDoc, 12);
    // And it is POSITIVE here: slower, at a higher heart rate, is efficiency
    // falling. The sign convention is load-bearing for the whole ramp.
    expect(fromDoc).toBeGreaterThan(0);
  });

  it('goes NEGATIVE for a session that got more efficient, and is not clamped · Rule 11', () => {
    // Faster final third at a lower heart rate. "Improved" and "held" are
    // different facts and clamping would collapse them.
    expect(paHrDecouplingFrac(480, 460, 150, 146)).toBeLessThan(0);
  });

  const GRID: readonly ComparableThirds[] = [
    thirds({}),
    thirds({ finPace: 520 }),
    thirds({ finPace: 520, midHr: 150, finHr: 160 }),
    thirds({ finPace: 470, midHr: 150, finHr: 168 }),
    thirds({ midHr: 150, finHr: 158 }),
    thirds({ midHr: null, finHr: null }),
    thirds({ midHr: 150, finHr: null }),
    thirds({ comparable: false, midHr: 150, finHr: 160 }),
  ];

  it('THE INVARIANT · severityFrac is null if and only if the verdict is UNKNOWN', () => {
    let unknown = 0;
    let readable = 0;
    for (const t of GRID) {
      for (const trunc of [INTACT, { ...INTACT, truncated: true }]) {
        const r = assessDeterioration(t, trunc);
        if (r.verdict === 'UNKNOWN') {
          unknown += 1;
          expect(r.severityFrac, `UNKNOWN carried a severity: ${r.detail}`).toBeNull();
        } else {
          readable += 1;
          expect(r.severityFrac, `${r.verdict} carried no severity: ${r.detail}`)
            .not.toBeNull();
        }
      }
    }
    // LIVENESS · both branches were actually reached. A grid that only
    // produced one verdict would pass the loop above and mean nothing.
    expect(unknown).toBeGreaterThan(0);
    expect(readable).toBeGreaterThan(0);
  });

  it('the roll-up takes the WORST readable session, and null only when none was readable', () => {
    const mk = (s: number | null): DeteriorationResult => ({
      verdict: s == null ? 'UNKNOWN' : 'CLEAN', signals: [], severityFrac: s, detail: 'f',
    });
    expect(deteriorationPattern([mk(0.01), mk(0.07), mk(0.03)]).worstSeverityFrac).toBe(0.07);
    expect(deteriorationPattern([mk(null), mk(0.02)]).worstSeverityFrac).toBe(0.02);
    expect(deteriorationPattern([mk(null), mk(null)]).worstSeverityFrac).toBeNull();
    // An EMPTY window is null too, not zero: there was no session, which is
    // not the same as a session that held (Rule 11).
    expect(deteriorationPattern([]).worstSeverityFrac).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART 2 · THE BEHAVIOUR, IN BOTH DIRECTIONS
 *
 * One week shape throughout -- the owner's, so the magnitudes are real -- with
 * exactly one input perturbed per case. Every case records which side it
 * landed on and the last block asserts the distribution.
 * ═══════════════════════════════════════════════════════════════════════ */

const PRESCRIBED = 45.5;
const COMPLETED = 47.3;
const WEEK = '2026-06-15';

function weekAt(completedMi: number): WeekSurplusInput {
  const perDay = PRESCRIBED / 7;
  const runs: SurplusRun[] = [];
  for (let i = 0; i < 7; i += 1) {
    runs.push({
      activityId: `d${i}`,
      dateISO: `2026-06-${String(15 + i).padStart(2, '0')}`,
      distanceMi: measured(i < 6 ? perDay : perDay + (completedMi - PRESCRIBED)),
      match: 'legacy_type',
      mergedIntoAnother: false,
      isRace: false,
      prescribedMi: perDay,
      movedFromDateISO: null,
    });
  }
  return {
    weekStartISO: WEEK,
    prescribedMi: PRESCRIBED,
    runs,
    authoredPlanMode: 'BUILD',
    isCutback: false,
    isRaceWeek: false,
    inPrescribedRaceWindow: false,
    dataComplete: true,
  };
}

interface Fade {
  readonly deterioratedCount: number;
  readonly worstSeverityFrac: number | null;
  readonly unknownCount?: number;
}

const conditions = (
  fade: Fade,
  followingFrac: number | null = 1,
): Omit<AdmissionInput, 'week'> => ({
  identityResolved: measured(true),
  telemetry: absent<HrTraceVerdict>('this lever spends distance'),
  deterioration: measured({
    repeated: fade.deterioratedCount >= 2,
    deterioratedCount: fade.deterioratedCount,
    unknownCount: fade.unknownCount ?? 0,
    cleanCount: 3 - fade.deterioratedCount,
    worstSeverityFrac: fade.worstSeverityFrac,
    detail: 'constructed',
  }),
  keySessionGrades: [],
  painOrInjuryReported: measured(false),
  unplannedRecoveryTaken: measured(false),
  followingWeekCompletionFrac: followingFrac == null
    ? absent('the week after this one has not been run yet')
    : measured(followingFrac),
  absorptionCompletionBar: 0.95,
});

const read = (fade: Fade, followingFrac: number | null = 1, completedMi = COMPLETED) =>
  readWeekEvidence({
    asOfISO: '2026-06-22',
    week: weekAt(completedMi),
    conditions: conditions(fade, followingFrac),
  });

const CLEAN: Fade = { deterioratedCount: 0, worstSeverityFrac: 0.01 };

/** Counted, not claimed. Rule 22's distribution check reads these. */
const LANDED = { credited: 0, refused: 0 };
const credited = <T>(x: T): T => { LANDED.credited += 1; return x; };
const refused = <T>(x: T): T => { LANDED.refused += 1; return x; };

describe('2 · what one fade does · Q13 in both directions', () => {
  it('CREDITS · a clean week is the control, and it is worth a real share of a step', () => {
    const r = credited(read(CLEAN));
    expect(r.admission.admitted).toBe(true);
    expect(r.capacity.deteriorationWeight).toBe(1);
    expect(r.capacity.units).toBeGreaterThan(0);
  });

  it('CREDITS · ONE fade inside the SUSTAINABLE band costs nothing, because doctrine says it held', () => {
    // 4 per cent decoupling. Q13's FIRST signal can flag a session here -- a
    // final third 4 per cent slower at equal heart rate -- and Research/03 §12
    // still calls that band sustainable. Zero cost is doctrine's answer, not a
    // loosening, and saying so is what stops the next reader "fixing" it.
    const r = credited(read({ deterioratedCount: 1, worstSeverityFrac: 0.04 }));
    expect(r.admission.admitted).toBe(true);
    expect(r.capacity.deteriorationWeight).toBe(1);
    expect(r.capacity.units).toBe(read(CLEAN).capacity.units);
  });

  it('CREDITS AND DISCOUNTS · ONE fade inside the TRANSITION band is admitted at less than face value', () => {
    const r = credited(read({ deterioratedCount: 1, worstSeverityFrac: 0.065 }));
    // The half a refusal-shaped suite could not see: it is ADMITTED.
    expect(r.admission.admitted).toBe(true);
    expect(r.capacity.units).toBeGreaterThan(0);
    // And the half doctrine insists on: it costs something.
    expect(r.capacity.deteriorationWeight).toBeGreaterThan(0);
    expect(r.capacity.deteriorationWeight).toBeLessThan(1);
    expect(r.capacity.units).toBeLessThan(read(CLEAN).capacity.units);
    // Exactly halfway across the band is exactly half the credit. The ramp is
    // linear and this is the arithmetic, stated so a silent reshaping fails.
    expect(r.capacity.deteriorationWeight).toBeCloseTo(0.5, 10);
  });

  it('AND IT SAYS SO · the decision record explains the discount rather than only being smaller', () => {
    const r = read({ deterioratedCount: 1, worstSeverityFrac: 0.065 });
    const c = r.admission.conditions.find((x) => x.condition === 'NO_MATERIAL_DETERIORATION');
    expect(c?.verdict).toBe('MET');
    expect(c?.detail).toContain('per cent of this week\'s evidence is kept');
    const factor = r.capacity.factors.find((f) => f.name === 'deteriorationConfidenceWeight');
    expect(factor?.value).toBeCloseTo(0.5, 10);
    expect(factor?.why).toContain('decoupling');
  });

  it('REFUSES · ONE fade at or past the ENDURANCE GAP blocks on its own · Q13 "extreme"', () => {
    const r = refused(read({ deterioratedCount: 1, worstSeverityFrac: 0.085 }));
    expect(r.admission.admitted).toBe(false);
    expect(r.admission.admitted === false && r.admission.outcome).toBe('NOT_SUPPORTED');
    expect(r.admission.admitted === false && r.admission.blocking)
      .toContain('NO_MATERIAL_DETERIORATION');
    expect(r.capacity.units).toBe(0);
  });

  it('REFUSES · a window past the edge with NO session FLAGGED is still past the edge', () => {
    /* Rule 15 · the real case that reaches this branch, named: 2026-07-20 on
     * the reference account measures 8.127 per cent Pa:HR decoupling across
     * two key sessions and Q13's three signals flag NEITHER of them. Doctrine
     * §12 does not ask whether a detector fired; it says what that decoupling
     * means, and it means build base before progressing.
     *
     * The refusal changes the REASON and not the number: the curve is already
     * exactly zero there, so this week buys nothing either way. What it buys
     * is a decision record that says which doctrine applied. */
    const r = refused(read({ deterioratedCount: 0, worstSeverityFrac: 0.08127 }));
    expect(r.admission.admitted).toBe(false);
    expect(r.capacity.units).toBe(0);
    // And the sentence reports the MEASUREMENT rather than claiming a session
    // fell away, because the grader said it did not (Rule 16).
    const c = r.admission.admitted === false
      ? r.admission.conditions.find((x) => x.condition === 'NO_MATERIAL_DETERIORATION')
      : undefined;
    expect(c?.detail).toContain('pace-to-heart-rate decoupling');
    expect(c?.detail).not.toContain('fell away');
  });

  it('REFUSES · REPEATED fading blocks however mild each one was · Q13 ">=2 sessions"', () => {
    const r = refused(read({ deterioratedCount: 2, worstSeverityFrac: 0.052 }));
    expect(r.admission.admitted).toBe(false);
    expect(r.admission.admitted === false && r.admission.blocking)
      .toContain('NO_MATERIAL_DETERIORATION');
    // The count is the reason, and the count is categorical. A session pair
    // this mild would each be worth 93 per cent on their own.
    expect(deteriorationConfidenceWeight(0.052)).toBeGreaterThan(0.9);
  });

  it('REFUSES AS UNREADABLE · a fade whose size could not be measured is not a mild fade · Rule 11', () => {
    const r = refused(read({ deterioratedCount: 1, worstSeverityFrac: null }));
    expect(r.admission.admitted).toBe(false);
    // UNREADABLE, not NOT_SUPPORTED. The two produce different sentences
    // downstream and collapsing them is the defect this engine keeps making.
    expect(r.admission.admitted === false && r.admission.outcome).toBe('UNREADABLE');
    expect(r.capacity.unreadable).toBe(true);
  });

  it('WITHHOLDS NOTHING · a week where NO session could be read neither blocks nor discounts', () => {
    // Rule 21's ledger row 8: cutting a runner's plan on a session nobody
    // could read costs him the block; withholding a raise costs him a week.
    // So an all-UNKNOWN window is priced exactly like a clean one, and that
    // asymmetry is argued rather than assumed.
    const r = credited(read({ deterioratedCount: 0, worstSeverityFrac: null, unknownCount: 3 }));
    expect(r.admission.admitted).toBe(true);
    expect(r.capacity.deteriorationWeight).toBe(1);
    expect(r.capacity.units).toBe(read(CLEAN).capacity.units);
  });

  it('THE CHANNELS STAY APART · a fade discounts CAPACITY and never touches FATIGUE', () => {
    const clean = read(CLEAN);
    const faded = read({ deterioratedCount: 1, worstSeverityFrac: 0.07 });
    expect(faded.capacity.units).toBeLessThan(clean.capacity.units);
    // Rule 8's corollary. The miles happened. What the connective tissue
    // carried is not a function of how the session felt at the end.
    expect(faded.fatigue.excessMi).toEqual(clean.fatigue.excessMi);
    expect(faded.fatigue.absorbedMi).toEqual(clean.fatigue.absorbedMi);
  });

  it('ABSORPTION STILL GOVERNS SEPARATELY · a fade cannot stand in for the following week', () => {
    // Two independent factors, and the case matters because a single "quality"
    // multiplier would let one of them mask the other (Rule 16).
    const fade: Fade = { deterioratedCount: 1, worstSeverityFrac: 0.065 };
    const carriedOn = read(fade, 1);
    const collapsed = read(fade, 0.5);
    const notYet = read(fade, null);
    // Same evidence recorded in all three.
    expect(collapsed.capacity.units).toBeCloseTo(carriedOn.capacity.units, 12);
    expect(notYet.capacity.units).toBeCloseTo(carriedOn.capacity.units, 12);
    // Different amounts of it CONFIRMED.
    expect(carriedOn.capacity.confirmedUnits).toBeGreaterThan(0);
    expect(collapsed.capacity.confirmedUnits).toBe(0);
    expect(notYet.capacity.provisional).toBe(true);
    expect(notYet.capacity.confirmedUnits).toBeLessThan(carriedOn.capacity.confirmedUnits);
    expect(notYet.capacity.confirmedUnits).toBeGreaterThan(0);
  });

  it('THE OWNER\'S OWN WEEK · 47.3 against 45.5 with one mild fade now contributes something', () => {
    // NOT a tuning case. The rule was fixed on the doctrine above and this
    // asserts what the fixed rule does to his shape, with the fade priced
    // mid-band rather than at whatever value would be convenient.
    const before = read({ deterioratedCount: 1, worstSeverityFrac: 0.065 });
    expect(before.admission.admitted).toBe(true);
    expect(before.capacity.fractionOfFullStep).toBeGreaterThan(0);
    // And a fade that IS extreme still takes it all away, on the same week.
    const extreme = read({ deterioratedCount: 1, worstSeverityFrac: 0.09 });
    expect(extreme.capacity.fractionOfFullStep).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART 3 · THE WALKS
 *
 * CLAUDE.md Rule 9's enforcement clause, and its own warning: walk the
 * CONTINUOUS QUANTITY behind a verdict, never the verdict, because a step
 * function flips exactly once too and will pass a verdict walk.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('3 · the severity to confidence mapping is continuous and monotone', () => {
  it('A · the curve itself, walked across BOTH doctrine edges', () => {
    // Walked as `1 - weight` so the quantity is non-decreasing, which is the
    // direction `assertContinuousAndMonotone` checks. The bound is the
    // ANALYTIC slope of the ramp, 1 / (0.08 - 0.05) = 33.3, plus a whisker --
    // derived from the curve, never chosen to make the case pass.
    const r = walk((s) => 1 - deteriorationConfidenceWeight(s), 0, 0.15, 0.00001);
    assertContinuousAndMonotone('deteriorationConfidenceWeight', r, 34);
    // The endpoints are doctrine's, exactly, with no rounding slack.
    expect(deteriorationConfidenceWeight(0)).toBe(1);
    expect(deteriorationConfidenceWeight(DETERIORATION_DECOUPLING_FRAC)).toBe(1);
    expect(deteriorationConfidenceWeight(DETERIORATION_SEVERITY_EXTREME_FRAC)).toBe(0);
    expect(deteriorationConfidenceWeight(0.5)).toBe(0);
    // A session that got MORE efficient is not penalised.
    expect(deteriorationConfidenceWeight(-0.04)).toBe(1);
  });

  it('B · THE GATE SITS WHERE THE CURVE IS ALREADY ZERO, so the refusal is not a cliff', () => {
    // This is the structural property the whole pipeline rests on, and it is
    // the same one `admit.ts` step 0b uses for the GPS noise floor. Walk the
    // PIPELINE's credited units as a function of severity, straight through
    // the categorical refusal at 8 per cent.
    const unitsAt = (s: number): number => read({
      deterioratedCount: 1, worstSeverityFrac: s,
    }).capacity.units;
    const r = walk((s) => -unitsAt(s), 0.04, 0.09, 0.00002);
    // Units fall as severity rises, so the negation is non-decreasing. The
    // bound: units span at most PER_WEEK_CREDIT_CEILING_FRAC (0.05) across a
    // 0.03-wide band, so the analytic slope is at most 0.05 / 0.03 = 1.67.
    assertContinuousAndMonotone('pipeline units across the extreme edge', r, 2);
    // And it really does reach zero AT the edge rather than jumping to it. A
    // millionth of a percentage point inside the band is worth a millionth of
    // a percentage point of the week, which is the arithmetic of the ramp
    // rather than a tolerance: the analytic value is the clean week's units
    // times 1e-6 / (0.08 - 0.05).
    const cleanUnits = read(CLEAN).capacity.units;
    const bandWidth = DETERIORATION_SEVERITY_EXTREME_FRAC - DETERIORATION_DECOUPLING_FRAC;
    expect(unitsAt(DETERIORATION_SEVERITY_EXTREME_FRAC)).toBe(0);
    expect(unitsAt(DETERIORATION_SEVERITY_EXTREME_FRAC - 1e-6)).toBeGreaterThan(0);
    expect(unitsAt(DETERIORATION_SEVERITY_EXTREME_FRAC - 1e-6))
      .toBeCloseTo(cleanUnits * (1e-6 / bandWidth), 12);
  });

  it('C · THE REJECTED DESIGN · a discount gated on the VERDICT has a measurable cliff', () => {
    /* WHY THE FACTOR READS EVERY READABLE SESSION AND NOT ONLY FLAGGED ONES,
     * measured rather than argued.
     *
     * Hold the final third's heart rate 9.3 per cent above the middle third's
     * and walk the PACE of the final third across Q13's second signal, which
     * fires when pace is "within ~2%" and HR rises more than 6 bpm. At 1.9 per
     * cent FASTER the signal fires and the session is DETERIORATED; at 2.1 per
     * cent faster it does not and the session is CLEAN. Decoupling moves by
     * about two tenths of a percentage point across that hair.
     *
     * The severity-gated factor does not notice the boundary. A verdict-gated
     * one jumps from a deep discount to full credit, which is Rule 9 exactly:
     * a hair's difference in input producing a categorically different answer.
     */
    const MID_PACE = 480;
    const MID_HR = 150;
    const FIN_HR = MID_HR * 1.093;

    const at = (slowdown: number) => assessDeterioration(
      thirds({
        midPace: MID_PACE,
        finPace: MID_PACE * (1 + slowdown),
        midHr: MID_HR,
        finHr: FIN_HR,
      }),
      INTACT,
    );

    // LIVENESS · the walk really does straddle a verdict flip. Without this
    // the two walks below would compare two identical curves and pass.
    expect(at(-0.019).verdict).toBe('DETERIORATED');
    expect(at(-0.021).verdict).toBe('CLEAN');

    const severityGated = (slowdown: number): number =>
      1 - deteriorationConfidenceWeight(at(slowdown).severityFrac);
    const verdictGated = (slowdown: number): number => {
      const r = at(slowdown);
      return r.verdict === 'DETERIORATED'
        ? 1 - deteriorationConfidenceWeight(r.severityFrac)
        : 0;
    };

    const from = -0.025;
    const to = -0.015;
    const step = 0.00002;

    // THE REAL DESIGN passes. Analytic slope: d(severity)/d(slowdown) is about
    // 1.09, times the ramp's 33.3, is about 37.
    assertContinuousAndMonotone(
      'severity-gated discount across the signal-2 boundary',
      walk(severityGated, from, to, step), 40,
    );

    // THE REJECTED DESIGN fails the IDENTICAL assertion. Imported, not
    // paraphrased (Rule 18: a falsifier that re-implements the check proves
    // the re-implementation fails, not the check).
    let message = '';
    try {
      assertContinuousAndMonotone(
        'verdict-gated discount across the signal-2 boundary',
        walk(verdictGated, from, to, step), 40,
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, 'THE WALK DID NOT NOTICE THE VERDICT-GATED STEP. The gate is dead.')
      .not.toBe('');
    expect(message).toContain('HAS A CLIFF');
    expect(message).toContain('Rule 9');
    // eslint-disable-next-line no-console
    console.log(`\n[severity walk] the rejected verdict-gated design was rejected:\n    ${message}\n`);
  });

  it('D · MONOTONE IN THE RIGHT DIRECTION · a worse fade never buys MORE', () => {
    // Rule 9's own signature is "the fitter runner gets the worse plan", so
    // the reverse is asserted explicitly rather than left to the walk.
    let prev = Infinity;
    for (let s = 0; s <= 0.12; s += 0.001) {
      const u = read({ deterioratedCount: 1, worstSeverityFrac: s }).capacity.units;
      expect(u).toBeLessThanOrEqual(prev + 1e-12);
      prev = u;
    }
    expect(prev).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART 4 · RULE 22 · THE DISTRIBUTION AND THE LIVENESS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('4 · what this suite exercised, counted', () => {
  it('admits and refuses in comparable numbers, and neither side is empty', () => {
    // Counted from the cases that actually ran, not from a comment. A suite
    // that only knew how to assert a refusal would pass an engine that could
    // only refuse, which is the exact failure CLAUDE.md Rule 22 names and the
    // exact failure this change corrects.
    expect(LANDED.credited, 'no case in this suite credited anything').toBeGreaterThan(0);
    expect(LANDED.refused, 'no case in this suite refused anything').toBeGreaterThan(0);
    const ratio = LANDED.credited / LANDED.refused;
    expect(ratio, `credited ${LANDED.credited} against refused ${LANDED.refused}`)
      .toBeGreaterThan(0.5);
    expect(ratio, `credited ${LANDED.credited} against refused ${LANDED.refused}`)
      .toBeLessThan(2);
  });

  it('and the surplus it walked is a real one, not a fixture that could never be admitted', () => {
    const surplus = classifyWeekSurplus(weekAt(COMPLETED));
    expect(surplus.admissibleSurplusMi.ok).toBe(true);
    const v: Measured<number> = surplus.admissibleSurplusMi;
    expect(v.ok && v.value).toBeGreaterThan(0);
    // The categorical gates upstream of deterioration all pass, so a refusal
    // in part 2 is attributable to the fade and to nothing else.
    expect(admitSurplus({ ...conditions(CLEAN), week: surplus }).admitted).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART 5 · PAHR-QUANTITY-1 (2026-09-05) · READABILITY
 *
 * "First establish whether Research/03 §12 measures the SAME QUANTITY as the
 * app." `deterioration.ts`'s own PAHR-QUANTITY-1 section carries the argued
 * verdict: the FORMULA is identical (asserted independently in part 1 above),
 * the WINDOW is not (thirds versus halves, kept as thirds for Q13's own
 * reason), and the app's thirds path enforced NONE of §12's own duration,
 * terrain or heat preconditions before this change. This part prices that gap.
 *
 * ── RULE 22 · WHAT THIS PART CANNOT FAIL ON ───────────────────────────────
 *
 * · It cannot fail on the READABILITY FORMULA being the wrong shape. Three
 *   ramps multiplied is a POLICY_ASSUMPTION about composition, argued in
 *   `decouplingReadabilityFrac`'s own doc by analogy to `composeEffortFactor`,
 *   and no citation proves multiplicative is the right combination rule for
 *   THESE three factors specifically.
 * · It cannot fail on the STEADY-EFFORT precondition, which is not built.
 *   A deliberate fast finish in perfect conditions still reads at full
 *   readability and can still discount to zero. `deterioration.ts`'s own
 *   header names this gap; nothing here hides it.
 * · It cannot fail on the EDGES being the wrong number. 30 minutes, 20 s/mi,
 *   60°F are POLICY_ASSUMPTION and argued, not derived; only the CEILINGS
 *   (60 minutes, the terrain materiality floor, 77°F) are read from a citation.
 */

const ctx = (o: {
  durationMin?: number | null;
  terrainDeltaSPerMi?: number | null;
  tempF?: number | null;
  /** STEADYEFFORT-1 · omitted means "no prescription to check", which reads
   *  as fully readable (1) — every existing call site in this file predates
   *  this factor and keeps passing unchanged. */
  steadyEffortFrac?: number | null;
}): SessionEnvironmentalContext => ({
  analyzedDurationMin: o.durationMin == null ? absent('no moving time recorded') : measured(o.durationMin),
  terrainDeltaSPerMi: o.terrainDeltaSPerMi == null ? absent('no elevation signal') : measured(o.terrainDeltaSPerMi),
  tempF: o.tempF == null ? absent('no weather recorded') : measured(o.tempF),
  steadyEffortFrac: o.steadyEffortFrac === undefined ? measured(1)
    : o.steadyEffortFrac == null ? absent('no prescription to check') : measured(o.steadyEffortFrac),
});

describe('5A · decouplingReadabilityFrac · each factor, independently', () => {
  it('a run with no environmental facts at all reads fully readable · Rule 11', () => {
    // "An absence of grounds to refuse is not grounds to refuse" —
    // `hr-trace-credibility.ts`'s own sentence, applied here to a fact this
    // engine simply never learned rather than one that was checked and found
    // clean.
    const r = decouplingReadabilityFrac(ctx({}));
    expect(r.value).toBe(1);
    expect(r.detail).toBe('');
  });

  it('duration ramps from the confounder-table floor to §12\'s own protocol ceiling', () => {
    expect(decouplingReadabilityFrac(ctx({ durationMin: DECOUPLING_READABILITY_DURATION_FLOOR_MIN })).value).toBe(0);
    expect(decouplingReadabilityFrac(ctx({ durationMin: DECOUPLING_READABILITY_DURATION_CEIL_MIN })).value).toBe(1);
    const mid = (DECOUPLING_READABILITY_DURATION_FLOOR_MIN + DECOUPLING_READABILITY_DURATION_CEIL_MIN) / 2;
    expect(decouplingReadabilityFrac(ctx({ durationMin: mid })).value).toBeCloseTo(0.5, 10);
    // Below the floor there has not been time for real drift at all — the
    // ramp does not go negative, it stays at the floor's own zero.
    expect(decouplingReadabilityFrac(ctx({ durationMin: 5 })).value).toBe(0);
  });

  it('terrain ramps from grade-adjust.ts\'s OWN materiality floor to aerobic-decoupling.ts\'s OWN steady-state ceiling', () => {
    expect(decouplingReadabilityFrac(ctx({ terrainDeltaSPerMi: DECOUPLING_READABILITY_TERRAIN_LO_S_PER_MI })).value).toBe(1);
    expect(decouplingReadabilityFrac(ctx({ terrainDeltaSPerMi: DECOUPLING_READABILITY_TERRAIN_HI_S_PER_MI })).value).toBe(0);
    // Signed input, unsigned effect: a net DESCENT confounds the comparison
    // exactly as much as a net CLIMB of the same size, because either one
    // means the thirds are not comparing like-for-like effort.
    expect(decouplingReadabilityFrac(ctx({ terrainDeltaSPerMi: -DECOUPLING_READABILITY_TERRAIN_HI_S_PER_MI })).value).toBe(0);
  });

  it('heat ramps from an ordinary training temperature to §1\'s OWN cited confounder trigger', () => {
    expect(decouplingReadabilityFrac(ctx({ tempF: DECOUPLING_READABILITY_HEAT_LO_F })).value).toBe(1);
    expect(decouplingReadabilityFrac(ctx({ tempF: DECOUPLING_READABILITY_HEAT_HI_F })).value).toBe(0);
    // Cold is not heat. The ramp has no lower tail: 20°F reads exactly like
    // 60°F, because §1's confounder row this ramp transcribes is about HEAT.
    expect(decouplingReadabilityFrac(ctx({ tempF: 20 })).value).toBe(1);
  });

  it('THE COMPOSITION IS MULTIPLICATIVE, not additive · matches grade-adjust.ts\'s own composeEffortFactor', () => {
    // Half duration-readable AND half terrain-readable is a QUARTER readable,
    // not zero and not three-quarters. `composeEffortFactor`'s own citation
    // ("Add adjustments multiplicatively, not additively") is the doctrine
    // this mirrors, applied to a confidence factor instead of a pace factor.
    const durMid = (DECOUPLING_READABILITY_DURATION_FLOOR_MIN + DECOUPLING_READABILITY_DURATION_CEIL_MIN) / 2;
    const terrMid = (DECOUPLING_READABILITY_TERRAIN_LO_S_PER_MI + DECOUPLING_READABILITY_TERRAIN_HI_S_PER_MI) / 2;
    const r = decouplingReadabilityFrac(ctx({ durationMin: durMid, terrainDeltaSPerMi: terrMid }));
    expect(r.value).toBeCloseTo(0.25, 10);
    expect(r.detail).toContain('min is short of');
    expect(r.detail).toContain('terrain was worth about');
  });

  it('LIVENESS · a compound-contaminated session (short, hilly, hot) reads near zero, not merely reduced', () => {
    const r = decouplingReadabilityFrac(ctx({
      durationMin: 35, terrainDeltaSPerMi: 18, tempF: 76,
    }));
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThan(0.1);
  });
});

describe('5A2 · steadyEffortReadabilityFrac · STEADYEFFORT-1, the precondition this file used to leave open', () => {
  it('no prescription at all reads fully readable · Rule 11, absence is not evidence of a uniform run', () => {
    const a = steadyEffortReadabilityFrac(null, 18);
    const b = steadyEffortReadabilityFrac('', 18);
    expect(a.ok && a.value).toBe(1);
    expect(b.ok && b.value).toBe(1);
  });

  it('a pure easy prescription with no quality tail reads fully readable', () => {
    const r = steadyEffortReadabilityFrac('LONG · easy', 18);
    expect(r.ok && r.value).toBe(1);
  });

  it('THE CANONICAL CASE · an easy bulk then a quality tail exactly filling the final third reads ZERO', () => {
    // 12mi run, "8mi @ E + 4mi @ M": the quality tail is exactly the final
    // third (miles 8-12), the middle third (miles 4-8) is entirely easy. This
    // is precisely the shape Q13 warns about — a fast-finish executed exactly
    // as prescribed — and it must read as fully UNREADABLE for fatigue, not
    // partially.
    const r = steadyEffortReadabilityFrac('LONG · 8mi @ E + 4mi @ M', 12);
    expect(r.ok && r.value).toBe(0);
  });

  it('a quality tail that only PARTLY overlaps the final third reads a PARTIAL discount, not a cliff · Rule 9', () => {
    // 18mi run, "15mi @ E + 3mi @ M": quality starts at mile 15. Thirds are
    // 6-mile each (0-6, 6-12, 12-18). The final third (12-18) is half quality
    // (15-18) and half easy (12-15); the middle third (6-12) is fully easy.
    // Continuous, not 0 or 1.
    const r = steadyEffortReadabilityFrac('LONG · 15mi @ E + 3mi @ M', 18);
    expect(r.ok && r.value).toBeCloseTo(0.5, 10);
  });

  it('a quality tail entirely BEFORE the final third (an odd but possible prescription) reads fully readable', () => {
    // A tail shorter than a third and far enough from the finish that it
    // never reaches the final-third window at all — no differential
    // engagement between the two windows being compared.
    const r = steadyEffortReadabilityFrac('LONG · 16mi @ E + 0.5mi @ M', 16.5);
    // thirdMi = 5.5, so thirds are [0,5.5) [5.5,11) [11,16.5). Quality starts
    // at 16. Final third [11,16.5) overlaps quality by 0.5/5.5; middle third
    // overlaps by 0. Small but non-zero mismatch — not the "entirely before"
    // case the comment above describes; kept as the honest boundary example
    // rather than restated to fit a false claim.
    expect(r.ok && r.value).toBeGreaterThan(0.85);
    expect(r.ok && r.value).toBeLessThan(1);
  });

  it('BOTH windows equally engaged with the tail reads fully readable · the confound is a MISMATCH, not the tail\'s mere presence', () => {
    // A quality tail so long it swallows both the middle and final thirds
    // entirely — both windows are comparing quality-to-quality, which is
    // still a meaningful (if different-baseline) fatigue question, not the
    // "different prescribed phases" confound Q13 names.
    const r = steadyEffortReadabilityFrac('LONG · 2mi @ E + 16mi @ M', 18);
    expect(r.ok && r.value).toBe(1);
  });

  it('no total distance to place the segments against refuses honestly, not a fabricated 1 or 0', () => {
    const r = steadyEffortReadabilityFrac('LONG · 15mi @ E + 3mi @ M', 0);
    expect(r.ok).toBe(false);
  });

  it('FALSIFICATION-READY · a fast-finish long run composes into decouplingReadabilityFrac and discounts the reading to zero', () => {
    // The end-to-end proof this section exists for: a session whose PACE and
    // HR would show large "decoupling" purely because the runner executed a
    // prescribed fast finish must not spend that decoupling as fatigue
    // evidence once this factor is wired in.
    const r = decouplingReadabilityFrac(ctx({ steadyEffortFrac: 0 }));
    expect(r.value).toBe(0);
    expect(r.detail).toContain('Q13');
  });
});

describe('5B · deteriorationConfidenceWeight(severity, readability) · the SECOND axis', () => {
  it('readability = 1 (the default) reproduces the ORIGINAL one-argument function, bit for bit', () => {
    for (const s of [0, 0.02, 0.05, 0.065, 0.08, 0.09, 0.5]) {
      expect(deteriorationConfidenceWeight(s, 1)).toBe(deteriorationConfidenceWeight(s));
    }
  });

  it('readability = 0 costs NOTHING, however extreme the raw severity · Rule 11 generalised', () => {
    // The same posture `null` severity already had (line 517 above), now
    // reached by a DIFFERENT axis: a reading this file cannot vouch for is
    // spent as "no penalty", never as "mild penalty" and never as "refuse".
    expect(deteriorationConfidenceWeight(0.5, 0)).toBe(1);
    expect(deteriorationConfidenceWeight(DETERIORATION_SEVERITY_EXTREME_FRAC, 0)).toBe(1);
  });

  it('a PARTIALLY readable extreme session is DISCOUNTED, not refused and not waved through', () => {
    const w = deteriorationConfidenceWeight(DETERIORATION_SEVERITY_EXTREME_FRAC, 0.4);
    expect(w).toBeCloseTo(0.6, 10);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
  });

  it('C · THE READABILITY AXIS ITSELF is continuous and monotone, held at the EXTREME edge', () => {
    // Holding severity fixed at the edge where the severity axis already
    // proved a slope bound of 34 (part 3A), walk READABILITY from 0 to 1. The
    // function is `1 - readability * 1` there (penalty saturates to 1 at the
    // edge), so the analytic slope is exactly 1 — the bound this file's own
    // header comment in weight.ts derives.
    const r = walk((rd) => 1 - deteriorationConfidenceWeight(DETERIORATION_SEVERITY_EXTREME_FRAC, rd), 0, 1, 0.0001);
    assertContinuousAndMonotone('deteriorationConfidenceWeight across readability at the extreme edge', r, 1.01);
    expect(r.range).toBeCloseTo(1, 10);
  });
});

describe('5C · admit.ts\'s extreme gate now asks BOTH axes, not severity alone', () => {
  it('a FULLY READABLE extreme session still categorically refuses · the citation is not weakened', () => {
    const r = refused(read({ deterioratedCount: 1, worstSeverityFrac: 0.09 }));
    expect(r.admission.admitted).toBe(false);
    expect(r.capacity.units).toBe(0);
  });

  it('the IDENTICAL raw severity, marked UNREADABLE by environment, is ADMITTED at a discount instead', () => {
    // Same 0.09 as the case immediately above. The only difference is that
    // this fixture also carries `worstSeverityReadabilityFrac`, which a real
    // `DeteriorationPattern` built from `deteriorationOf` would compute from
    // the session's own duration, terrain and heat.
    const fade: Fade & { worstSeverityReadabilityFrac?: number } = {
      deterioratedCount: 1, worstSeverityFrac: 0.09, worstSeverityReadabilityFrac: 0.3,
    };
    const r = credited(readWeekEvidence({
      asOfISO: '2026-06-22',
      week: weekAt(COMPLETED),
      conditions: {
        ...conditions(fade),
        deterioration: measured({
          repeated: false, deterioratedCount: 1, unknownCount: 0, cleanCount: 2,
          worstSeverityFrac: 0.09, worstSeverityReadabilityFrac: 0.3, detail: 'constructed',
        }),
      },
    }));
    expect(r.admission.admitted).toBe(true);
    expect(r.capacity.deteriorationWeight).toBeCloseTo(0.7, 10);
    expect(r.capacity.units).toBeGreaterThan(0);
    expect(r.capacity.units).toBeLessThan(read(CLEAN).capacity.units);
  });

  it('a DeteriorationPattern with no readability field at all (pre-PAHR-QUANTITY-1 shape) still refuses · backward compatible', () => {
    // No caller was broken by this change: a fixture that predates
    // `worstSeverityReadabilityFrac` defaults to 1, which is the OLD
    // behaviour, exactly.
    const r = refused(read({ deterioratedCount: 1, worstSeverityFrac: 0.09 }));
    expect(r.admission.admitted).toBe(false);
  });
});

describe('5D · assessDeterioration(thirds, truncation, env) · the wiring, end to end', () => {
  const CLEAN_THIRDS = thirds({ midPace: 480, finPace: 480, midHr: 150, finHr: 150 });

  it('two calls with the same thirds but different environments produce the same VERDICT and DIFFERENT readability', () => {
    const hot = assessDeterioration(CLEAN_THIRDS, INTACT, ctx({ tempF: 90 }));
    const cool = assessDeterioration(CLEAN_THIRDS, INTACT, ctx({ tempF: 50 }));
    expect(hot.verdict).toBe(cool.verdict);
    expect(hot.severityFrac).toBe(cool.severityFrac);
    expect(hot.readabilityFrac).toBeLessThan(cool.readabilityFrac ?? 1);
    expect(cool.readabilityFrac).toBe(1);
  });

  it('calling with NO third argument at all matches calling with a fully-readable one · the default is additive, not a behaviour change', () => {
    const withoutEnv = assessDeterioration(CLEAN_THIRDS, INTACT);
    const withCoolEnv = assessDeterioration(CLEAN_THIRDS, INTACT, ctx({ tempF: 50, durationMin: 90, terrainDeltaSPerMi: 0 }));
    expect(withoutEnv.readabilityFrac).toBe(1);
    expect(withCoolEnv.readabilityFrac).toBe(1);
    expect(withoutEnv.severityFrac).toBe(withCoolEnv.severityFrac);
  });
});
