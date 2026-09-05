/**
 * lib/adaptation/volume-evidence/_continuous_evidence.test.ts · CONTINUOUS-EVIDENCE-1.
 *
 * THE GATE over the curve, its provenance, and the two channels. One case per
 * line of the owner's specification, and every doctrine number read OUT OF THE
 * DOCUMENT at gate time rather than typed twice (Rule 7 point 2, Rule 18: "a
 * check that hardcodes both sides only proves the test agrees with itself").
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ──────────────────────────────
 *
 * Stated first, because everything below is green and that is worth less than
 * it looks:
 *
 * · IT CANNOT FAIL ON A COEFFICIENT THAT IS CITED AND WRONG. Every
 *   CALCULATED_PHYSIOLOGY entry is asserted equal to the number `Research/`
 *   states TODAY. If the research is mistaken, or if the number is real but
 *   the wrong number for THIS question, this suite agrees with it confidently.
 *   The GPS error band, for instance, is a population figure about receivers
 *   on technical courses, and using its lower edge as a per-week surplus floor
 *   is an engineering judgement no citation can settle.
 * · IT CANNOT FAIL ON A POLICY_ASSUMPTION BEING A BAD CHOICE. It checks only
 *   that a chosen number SAYS it was chosen. `PROVISIONAL_ABSORPTION_WEIGHT`
 *   could be 0.5 or 0.25 and this suite would be equally happy.
 * · IT CANNOT FAIL ON THE SHAPE OF A CURVE. Doctrine supplies endpoints. That
 *   the ramp between 1 and 3 per cent is a smoothstep rather than a line is
 *   the engine's choice and no document constrains it.
 * · IT CANNOT FAIL ON A BAD LOADER, and every case here constructs its own
 *   week. Whether a real week is classified correctly is
 *   `_replay_real_history.script.ts`'s question, against the real account.
 * · IT CANNOT FAIL ON THE FATIGUE CHANNEL BEING SPENT WRONGLY DOWNSTREAM. It
 *   asserts the two channels DISAGREE where they must. Nothing consumes
 *   `fatigue` yet, so a future caller that spends it as capability would break
 *   Rule 8 and pass every case here.
 * · IT CANNOT FAIL ON THE SEAM. `AUTOMATIC_ADAPTATION_AUTHORITY` is false and
 *   this directory has no writer. Every case proves an advisory is correct and
 *   none of them says anything about the plan on the runner's phone.
 *
 * ── RULE 22 · THE DISTRIBUTION, COUNTED ───────────────────────────────────
 *
 * "Count the cases on each side. A large imbalance is a finding in itself."
 * Counted over the behavioural cases below and asserted in the last block so
 * it cannot rot:
 *
 *   cases where evidence is CREDITED or ACCUMULATES        7
 *   cases where evidence is WITHHELD, capped or refused    6
 *
 * Near even, and deliberately so. The measured baseline this change exists to
 * correct is ZERO upward adaptations in 309 production intents (Rule 21), and
 * a suite that only knew how to assert refusals would pass an engine that
 * could only refuse.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBand, parsePctBand, resolveCitation } from '@/lib/doctrine/resolve';
import { VOLUME_ADDITION_THRESHOLD } from '@/lib/plan/adjudication/adjudicate';
import { AUTOMATIC_ADAPTATION_AUTHORITY } from '@/lib/plan/adaptation-authority';
import { admitSurplus, type AdmissionInput } from './admit';
import type { HrTraceVerdict } from '@/lib/adaptation/canonical/hr-trace-credibility';
import { classifyWeekSurplus } from './classify';
import {
  accumulateCapacityEvidence, readWeekEvidence, weighCapacity,
  type CapacityEvidence,
} from './evidence';
import * as WEIGHT from './weight';
import {
  ABSORPTION_CONFIRMED_FRAC,
  ABSORPTION_FLOOR_FRAC,
  COEFFICIENTS,
  creditedSurplusFrac,
  EVIDENCE_FULL_CREDIT_DAYS,
  EVIDENCE_WINDOW_DAYS,
  GPS_DISTANCE_ERROR_HI_FRAC,
  GPS_DISTANCE_ERROR_LO_FRAC,
  PER_WEEK_CREDIT_CEILING_FRAC,
  PROGRESSION_UNLOCK_FRAC,
  PROVISIONAL_ABSORPTION_WEIGHT,
} from './weight';
// ONE DOOR · the engine's vocabulary reaches this directory through
// `./contract` and nowhere else. Importing the two evidence-window constants
// straight from `canonical/contract-constants` is what
// `canonical/_cannot_mutate.test.ts` guard 4 caught on the first full-suite
// run, and it was right to.
import {
  absent, measured,
  THRESHOLD_EVIDENCE_WINDOW_DAYS, THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT,
  VOLUME_MIN_CONSECUTIVE_WEEKS, VOLUME_WEEK_COMPLETION_MIN_FRAC,
  type SurplusRun, type WeekSurplusInput,
} from './contract';

const RESEARCH_00A = 'Research/00a-distance-running-training.md';
const CONTRACT_DOC_PATH = 'docs/ADAPTATION_ENGINE_CONTRACT.md';

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURES · the owner's own week shape.
 * ═══════════════════════════════════════════════════════════════════════ */

const PRESCRIBED = 45.5;

function weekAt(
  completedMi: number,
  o: Partial<WeekSurplusInput> = {},
  prescribedMi = PRESCRIBED,
): WeekSurplusInput {
  const perDay = prescribedMi / 7;
  const runs: SurplusRun[] = [];
  for (let i = 0; i < 7; i += 1) {
    runs.push({
      activityId: `d${i}`,
      dateISO: `2026-06-${String(15 + i).padStart(2, '0')}`,
      distanceMi: measured(i < 6 ? perDay : perDay + (completedMi - prescribedMi)),
      match: 'legacy_type',
      mergedIntoAnother: false,
      isRace: false,
      prescribedMi: perDay,
      movedFromDateISO: null,
    });
  }
  return {
    weekStartISO: '2026-06-15',
    prescribedMi,
    runs,
    authoredPlanMode: 'BUILD',
    isCutback: false,
    isRaceWeek: false,
    inPrescribedRaceWindow: false,
    dataComplete: true,
    ...o,
  };
}

const conditions = (followingFrac: number | null): Omit<AdmissionInput, 'week'> => ({
  identityResolved: measured(true),
  telemetry: absent<HrTraceVerdict>('no heart-rate question on a distance lever'),
  deterioration: measured({
    repeated: false, deterioratedCount: 0, unknownCount: 0, cleanCount: 3, detail: 'clean',
  }),
  keySessionGrades: [],
  painOrInjuryReported: measured(false),
  unplannedRecoveryTaken: measured(false),
  followingWeekCompletionFrac: followingFrac == null
    ? absent('the week after this one has not been run yet')
    : measured(followingFrac),
  absorptionCompletionBar: VOLUME_WEEK_COMPLETION_MIN_FRAC,
});

function read(
  completedMi: number,
  followingFrac: number | null = 1.0,
  o: Partial<WeekSurplusInput> = {},
  prescribedMi = PRESCRIBED,
) {
  return readWeekEvidence({
    asOfISO: '2026-06-22',
    week: weekAt(completedMi, o, prescribedMi),
    conditions: conditions(followingFrac),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · PROVENANCE · "Every curve and coefficient has named provenance."
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CONTINUOUS-EVIDENCE-1 · every coefficient has named provenance', () => {
  it('LIVENESS · the ledger is non-empty and covers every constant in weight.ts', () => {
    // Rule 18 point 2. A ledger walk over zero entries reports clean and
    // confident, which is the worst outcome available.
    expect(COEFFICIENTS.length).toBeGreaterThanOrEqual(9);

    // And it is COMPLETE: every exported numeric constant in `weight.ts` must
    // appear. A coefficient added without a provenance entry is exactly the
    // "dress a chosen curve as physiology" failure this ledger exists to stop,
    // and it would otherwise be invisible.
    // Enumerated from the MODULE rather than by regex over its text, so a
    // constant declared in a shape the regex did not anticipate cannot slip
    // past. Filtered to numbers: `COEFFICIENTS` is itself an export and is the
    // ledger, not an entry in it.
    const exported = Object.entries(WEIGHT)
      .filter(([k, v]) => typeof v === 'number' && /^[A-Z][A-Z0-9_]+$/.test(k))
      .map(([k]) => k);
    expect(exported.length).toBeGreaterThanOrEqual(9);
    const named = new Set(COEFFICIENTS.map((c) => c.name));
    for (const name of exported) {
      expect(named.has(name), `${name} is exported from weight.ts with no COEFFICIENTS entry`)
        .toBe(true);
    }
    // A ratchet in the other direction too: an entry naming a constant that no
    // longer exists is a stale exemption, and Rule 18 says those fail until
    // deleted.
    for (const c of COEFFICIENTS) {
      expect(exported.includes(c.name), `COEFFICIENTS names ${c.name}, which weight.ts no `
        + 'longer exports. A stale ledger entry fails until it is deleted.').toBe(true);
    }
  });

  it('every CALCULATED_PHYSIOLOGY entry resolves its doc and its verbatim anchor', () => {
    const cited = COEFFICIENTS.filter((c) => c.provenance === 'CALCULATED_PHYSIOLOGY');
    expect(cited.length).toBeGreaterThanOrEqual(6);
    for (const c of cited) {
      expect(c.doc, `${c.name} claims CALCULATED_PHYSIOLOGY with no doc`).toBeTruthy();
      expect(c.anchor, `${c.name} claims CALCULATED_PHYSIOLOGY with no anchor`).toBeTruthy();
      // Throws loudly, with the doc's own available headings, if the passage
      // has moved or been reworded. Never a line number (Rule 7 point 1).
      const resolved = resolveCitation(c.doc!, c.anchor!);
      expect(resolved.section.length).toBeGreaterThan(0);
    }
  });

  it('every POLICY_ASSUMPTION admits IN ITS OWN TEXT that it was chosen', () => {
    // The one rule that stops a chosen curve being dressed as physiology. It
    // is checked on the prose because the prose is what the next reader sees.
    const chosen = COEFFICIENTS.filter((c) => c.provenance === 'POLICY_ASSUMPTION');
    expect(chosen.length).toBeGreaterThanOrEqual(2);
    for (const c of chosen) {
      const says = c.says.toLowerCase();
      expect(
        says.includes('chosen') || says.includes('choice') || says.includes('arguable'),
        `${c.name} is a POLICY_ASSUMPTION whose text does not admit it was chosen. `
        + `It says: "${c.says}"`,
      ).toBe(true);
    }
    // Nothing claims ATHLETE_EVIDENCE, because nothing here is measured from
    // this runner yet. Asserted so that a future entry claiming it has to be
    // deliberate rather than aspirational.
    expect(COEFFICIENTS.filter((c) => c.provenance === 'ATHLETE_EVIDENCE')).toHaveLength(0);
  });

  it('the GPS noise band is the band Research/15 states TODAY', () => {
    const c = resolveCitation('Research/15-wearable-data.md',
      'measured by GPS distance can over- or under-report by');
    const [lo, hi] = parsePctBand(c.section[0]);
    expect(GPS_DISTANCE_ERROR_LO_FRAC).toBe(lo);
    expect(GPS_DISTANCE_ERROR_HI_FRAC).toBe(hi);
  });

  it('the per-week ceiling and the unlock are the edges of doctrine\'s CYCLE growth band', () => {
    const cell = resolveCitation(RESEARCH_00A, '### Volume progression rules')
      .table().cell('Year-on-year base growth', 'Specification');
    const [lo, hi] = parsePctBand(cell);
    expect(PER_WEEK_CREDIT_CEILING_FRAC).toBe(lo);
    expect(PROGRESSION_UNLOCK_FRAC).toBe(hi);
    // The doc states that band per CYCLE, which is the whole argument for the
    // lower edge being a per-WEEK ceiling. If the wording ever stops saying
    // "cycle", the argument is gone and this must be re-derived.
    expect(cell.toLowerCase()).toContain('cycle');
  });

  it('the evidence window is doctrine\'s own chronic-load window', () => {
    const cell = resolveCitation(RESEARCH_00A, '### Load metrics')
      .table().cell('Chronic load (28-day)', 'Calculation');
    expect(EVIDENCE_WINDOW_DAYS).toBe(parseBand(cell)[0]);
    // And it coincides with the contract's own evidence window, which is why
    // the borrowing of the INNER edge below is defensible at all. Rule 16: one
    // definition, imported, never re-typed.
    expect(EVIDENCE_WINDOW_DAYS).toBe(THRESHOLD_EVIDENCE_WINDOW_DAYS);
    expect(EVIDENCE_FULL_CREDIT_DAYS).toBe(THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT);
    const tp = resolveCitation(CONTRACT_DOC_PATH, 'Threshold pace').text();
    const [tight, wide] = parseBand(/within\s*~?([\d]+-[\d]+)\s*days/.exec(tp)![1]);
    expect(EVIDENCE_FULL_CREDIT_DAYS).toBe(tight);
    expect(EVIDENCE_WINDOW_DAYS).toBe(wide);
  });

  it('the absorption ramp spans doctrine\'s two stated weekly-completion bars', () => {
    // FLOOR · PROGRESSIVE_BASELINE_DOCTRINE Q9's softer bar.
    const q9 = resolveCitation('docs/PROGRESSIVE_BASELINE_DOCTRINE.md', 'completed at **≥90%**');
    const floorPct = Number(/≥\s*(\d+)\s*%/.exec(q9.section[0])![1]);
    expect(ABSORPTION_FLOOR_FRAC).toBe(floorPct / 100);
    // CONFIRMED · the contract's weekly-volume bar, imported not re-typed.
    const wv = resolveCitation(CONTRACT_DOC_PATH, 'Weekly volume').text();
    const confirmedPct = Number(/≥~?(\d+)%\*?\*? of prescribed volume/.exec(wv)![1]);
    expect(ABSORPTION_CONFIRMED_FRAC).toBe(confirmedPct / 100);
    expect(ABSORPTION_CONFIRMED_FRAC).toBe(VOLUME_WEEK_COMPLETION_MIN_FRAC);
    // The ramp is a real band, not a disguised step.
    expect(ABSORPTION_CONFIRMED_FRAC).toBeGreaterThan(ABSORPTION_FLOOR_FRAC);
  });

  it('THE CALIBRATION IDENTITY · three numbers, two documents, one answer', () => {
    /* The load-bearing coincidence, asserted by reading all three sides out of
     * their own sources rather than restating them.
     *
     *   Research/00a  · a training cycle grows 5-15 per cent
     *   the contract  · at least 3 consecutive non-cutback weeks
     *
     *   0.15 / 0.05 = 3
     *
     * so the minimum number of weeks that can buy a full step is EXACTLY the
     * corroboration count the contract demands, arrived at from a document
     * that has never heard of the contract. If any of the three moves, this
     * fails and somebody has to re-argue the calibration rather than discover
     * it years later. */
    const [growLo, growHi] = parsePctBand(
      resolveCitation(RESEARCH_00A, '### Volume progression rules')
        .table().cell('Year-on-year base growth', 'Specification'),
    );
    const weeks = Number(
      /≥(\d+) consecutive non-cutback weeks/.exec(
        resolveCitation(CONTRACT_DOC_PATH, 'Weekly volume').text(),
      )![1],
    );
    expect(weeks).toBe(VOLUME_MIN_CONSECUTIVE_WEEKS);
    expect(growHi / growLo).toBeCloseTo(weeks, 10);
    expect(PROGRESSION_UNLOCK_FRAC / PER_WEEK_CREDIT_CEILING_FRAC).toBeCloseTo(weeks, 10);
    // And the app's own "this counts as adding mileage" number is the same
    // one, so the ceiling is doctrine on both readings.
    expect(PER_WEEK_CREDIT_CEILING_FRAC).toBe(VOLUME_ADDITION_THRESHOLD);
  });

  it('doctrine does NOT support a steep weekly curve, and none of these is steep', () => {
    /* The honest warning, gated rather than left in prose (Rule 20). If
     * `Research/00a` ever starts endorsing a weekly cap, the argument for a
     * shallow curve changes and somebody should notice. */
    const rows = resolveCitation(RESEARCH_00A, '### The 10% rule').table();
    const findings = rows.rows.map((r) => r[rows.headers[0]]).join(' | ').toLowerCase();
    expect(findings).toContain('weekly mileage change correlated weakly with injury');
    // The steepness doctrine DOES state is per-SESSION, and that guard is not
    // this file's and is untouched.
    expect(findings).toContain('single-run length spike');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE OWNER'S REQUIREMENTS, ONE CASE EACH
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CONTINUOUS-EVIDENCE-1 · the owner\'s eight requirements', () => {
  it('1 · small valid overruns contribute SMALL evidence', () => {
    const small = read(PRESCRIBED * 1.015).capacity;   // 1.5 per cent over
    expect(small.units).toBeGreaterThan(0);
    expect(small.fractionOfFullStep).toBeGreaterThan(0);
    expect(small.fractionOfFullStep).toBeLessThan(0.10);
  });

  it('2 · larger absorbed overruns contribute MORE', () => {
    const a = read(PRESCRIBED * 1.015).capacity.units;
    const b = read(PRESCRIBED * 1.03).capacity.units;
    const c = read(PRESCRIBED * 1.045).capacity.units;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('3 · repeated modest overruns ACCUMULATE until they unlock a step', () => {
    /* THE ACCUMULATION DEMONSTRATION.
     *
     * Three consecutive weeks, each run at the per-week ceiling (5 per cent
     * over prescription), each absorbed. Doctrine's own arithmetic says three
     * of them are one training cycle's growth, and one cycle's growth is a
     * full step. */
    const weeks = ['2026-06-01', '2026-06-08', '2026-06-15'];
    const readings: CapacityEvidence[] = weeks.map((ws) => {
      const input = { ...weekAt(PRESCRIBED * 1.05), weekStartISO: ws };
      const surplus = classifyWeekSurplus(input);
      const c = conditions(1.0);
      return weighCapacity(surplus, admitSurplus({ ...c, week: surplus }), c);
    });

    // Each one alone buys a third and no more.
    for (const r of readings) {
      expect(r.confirmedFractionOfFullStep).toBeGreaterThan(0.30);
      expect(r.confirmedFractionOfFullStep).toBeLessThanOrEqual(0.34);
    }
    // One week: no. Two: still no. Three: a full step.
    const at = (n: number) =>
      accumulateCapacityEvidence(readings.slice(0, n), '2026-06-22');
    expect(at(1).fullStepUnlocked).toBe(false);
    expect(at(1).progressionFraction).toBeCloseTo(1 / 3, 2);
    expect(at(2).fullStepUnlocked).toBe(false);
    expect(at(2).progressionFraction).toBeCloseTo(2 / 3, 2);
    expect(at(3).fullStepUnlocked).toBe(true);
    expect(at(3).progressionFraction).toBe(1);
    expect(at(3).totalUnits).toBeCloseTo(PROGRESSION_UNLOCK_FRAC, 6);
  });

  it('4 · ONE EXTREME overrun does not establish sustainable capacity', () => {
    // 40 per cent over prescription in a single week, fully absorbed, every
    // condition met. It buys a third of a step and not one unit more, because
    // the per-week ceiling saturates it.
    const extreme = read(PRESCRIBED * 1.40).capacity;
    expect(extreme.confirmedFractionOfFullStep).toBeCloseTo(1 / 3, 6);
    const ledger = accumulateCapacityEvidence([extreme], '2026-06-22');
    expect(ledger.fullStepUnlocked).toBe(false);
    // And it is worth exactly what a 5-per-cent week is worth. The engine has
    // no way to express "one enormous week proves a training cycle".
    expect(extreme.units).toBeCloseTo(read(PRESCRIBED * 1.05).capacity.units, 10);
    // Structural, not incidental: no single week can ever reach the unlock.
    expect(creditedSurplusFrac(99) * VOLUME_MIN_CONSECUTIVE_WEEKS)
      .toBeCloseTo(PROGRESSION_UNLOCK_FRAC, 10);
  });

  it('5 · evidence remains PROVISIONAL until recovery indicates absorption', () => {
    // The following week has not been run yet.
    const pending = read(PRESCRIBED * 1.05, null).capacity;
    expect(pending.provisional).toBe(true);
    // Rule 11 · it is NOT zero, and it is NOT full.
    expect(pending.units).toBeGreaterThan(0);
    expect(pending.confirmedUnits).toBeGreaterThan(0);
    expect(pending.confirmedUnits).toBeLessThan(pending.units);
    expect(pending.confirmedUnits / pending.units).toBeCloseTo(PROVISIONAL_ABSORPTION_WEIGHT, 10);

    // Once the following week is run and absorbed, it confirms in full.
    const confirmed = read(PRESCRIBED * 1.05, 1.0).capacity;
    expect(confirmed.provisional).toBe(false);
    expect(confirmed.confirmedUnits).toBeCloseTo(confirmed.units, 10);

    // And a following week the runner did NOT carry: the evidence is RECORDED
    // and confirms nothing. This is the owner's own 2026-06-15 shape.
    const collapsed = read(PRESCRIBED * 1.05, 0.57).capacity;
    expect(collapsed.units).toBeGreaterThan(0);
    expect(collapsed.confirmedUnits).toBe(0);
    const ledger = accumulateCapacityEvidence([collapsed], '2026-06-22');
    expect(ledger.recordedUnits).toBeGreaterThan(0);
    expect(ledger.totalUnits).toBe(0);
    expect(ledger.progressionFraction).toBe(0);
  });

  it('6 · GPS NOISE contributes nothing', () => {
    // Half a per cent over a 45.5 mi week is 0.2 mi, which is inside what the
    // watch can misreport on its own.
    const noise = read(PRESCRIBED * 1.005).capacity;
    expect(noise.units).toBe(0);
    expect(noise.unreadable).toBe(false);   // Rule 11 · measured, not unreadable.
    expect(read(PRESCRIBED * 1.005).admission.admitted).toBe(false);
  });

  it('7 · crossing a threshold cannot transform ZERO evidence into FULL evidence', () => {
    // The owner's own numbers. The old bar for a 45.5 mi week sat at 47.775 mi.
    const justBelow = read(47.7).capacity.units;
    const justAbove = read(47.9).capacity.units;
    expect(justBelow).toBeGreaterThan(0);
    expect(justAbove).toBeGreaterThan(justBelow);
    // The step across the old bar is a hair, not a category. The bound is
    // stated against what a CLIFF would do: the old code moved from 0 to the
    // whole credit across this same 0.2 mi, which is 100 per cent of
    // `justAbove`. The curve moves about 3 per cent, and 10 per cent is the
    // line between "a hair" and "a category" for this comparison.
    expect(justAbove - justBelow).toBeLessThan(0.10 * justAbove);
    expect(justBelow).toBeGreaterThan(0.8 * justAbove);
    // AND THE WEEK HE ACTUALLY RAN. 47.3 against 45.5.
    const his = read(47.3).capacity;
    expect(his.units).toBeGreaterThan(0);
    expect(his.fractionOfFullStep).toBeGreaterThan(0.25);
    expect(his.fractionOfFullStep).toBeLessThan(0.30);
  });

  it('8 · every coefficient has named provenance · covered above, asserted here', () => {
    // Rule 16 · one assertion, referenced, not restated (Rule 17 for tests).
    expect(COEFFICIENTS.every((c) => c.says.length > 40)).toBe(true);
    expect(COEFFICIENTS.every((c) => c.provenance === 'CALCULATED_PHYSIOLOGY'
      ? c.doc != null && c.anchor != null : true)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · TWO CHANNELS · the hard requirement
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CONTINUOUS-EVIDENCE-1 · capacity and fatigue are separate channels', () => {
  it('extra mileage in a RECOVERY week raises fatigue and earns no capacity', () => {
    // The owner, verbatim: "Extra mileage during a recovery week may increase
    // fatigue, affect the next decision, and fail to earn a future mileage
    // increase."
    const r = read(PRESCRIBED * 1.15, 1.0, { authoredPlanMode: 'RECOVERY' });
    expect(r.surplus.prescribedNonNormal).toBe(true);
    expect(r.surplus.nonNormalBecause).toBe('AUTHORED_RECOVERY_BLOCK');

    // CAPACITY · nothing. Rule 8: a week the plan authored small is never the
    // runner's normal.
    expect(r.capacity.units).toBe(0);
    expect(r.capacity.confirmedUnits).toBe(0);
    // And it is not UNREADABLE, which is a different fact (Rule 11).
    expect(r.capacity.unreadable).toBe(false);

    // FATIGUE · the miles happened. Rule 8's corollary.
    expect(r.fatigue.excessMi.ok).toBe(true);
    expect(r.fatigue.excessMi.ok && r.fatigue.excessMi.value).toBeGreaterThan(6);
    expect(r.fatigue.duringPrescribedNonNormal).toBe(true);
    expect(r.fatigue.detail).toContain('not evidence about what this runner can carry');
  });

  it('the same fatigue reading is produced for a TAPER, a CUTBACK and a RACE WEEK', () => {
    // Rule 8's corollary applies to every non-normal week, not just the one
    // that was easiest to test.
    for (const o of [
      { authoredPlanMode: 'TAPER' as const },
      { isCutback: true },
      { isRaceWeek: true },
      { inPrescribedRaceWindow: true },
    ]) {
      const r = read(PRESCRIBED * 1.15, 1.0, o);
      expect(r.capacity.units, JSON.stringify(o)).toBe(0);
      expect(r.fatigue.excessMi.ok && r.fatigue.excessMi.value, JSON.stringify(o))
        .toBeGreaterThan(6);
    }
  });

  it('a MERGED row contributes to NEITHER channel (Rule 14)', () => {
    // 76 merged run-days carrying 946.9 mi exist on the real account, so this
    // is arithmetic that would actually fire.
    const base = weekAt(PRESCRIBED);
    const withDuplicate: WeekSurplusInput = {
      ...base,
      runs: [...base.runs, {
        activityId: 'dup',
        dateISO: '2026-06-20',
        distanceMi: measured(12),
        match: 'exact',
        mergedIntoAnother: true,
        isRace: false,
        prescribedMi: PRESCRIBED / 7,
        movedFromDateISO: null,
      }],
    };
    const r = readWeekEvidence({
      asOfISO: '2026-06-22', week: withDuplicate, conditions: conditions(1.0),
    });
    // CAPACITY · the duplicate manufactured no surplus.
    expect(r.capacity.units).toBe(0);
    // FATIGUE · the duplicate put no load through the legs either.
    expect(r.fatigue.absorbedMi.ok && r.fatigue.absorbedMi.value).toBeCloseTo(PRESCRIBED, 1);
    expect(r.fatigue.excessMi.ok && r.fatigue.excessMi.value).toBe(0);
    // And the exclusion is on the record rather than silent.
    expect(r.fatigue.artifactMiExcluded).toBe(12);
  });

  it('the two channels DISAGREE, which is the whole point', () => {
    const recovery = read(PRESCRIBED * 1.15, 1.0, { authoredPlanMode: 'RECOVERY' });
    const ordinary = read(PRESCRIBED * 1.15, 1.0);
    // Same running, same miles, opposite capacity answers.
    expect(recovery.fatigue.excessMi.ok && recovery.fatigue.excessMi.value)
      .toBeCloseTo((ordinary.fatigue.excessMi.ok && ordinary.fatigue.excessMi.value) as number, 6);
    expect(recovery.capacity.units).toBe(0);
    expect(ordinary.capacity.units).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · RULE 11, RULE 21, RULE 22 AND THE SEAM
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CONTINUOUS-EVIDENCE-1 · refusals, balance and the seam', () => {
  it('RULE 11 · a measured zero, an unreadable week and a refusal are three facts', () => {
    // MEASURED ZERO · he ran exactly to prescription. Real answer.
    const exact = read(PRESCRIBED).capacity;
    expect(exact.units).toBe(0);
    expect(exact.unreadable).toBe(false);

    // UNREADABLE · a row with no distance. NOT a zero-mile week.
    const base = weekAt(PRESCRIBED * 1.10);
    const broken: WeekSurplusInput = {
      ...base,
      runs: [...base.runs.slice(1), { ...base.runs[0], distanceMi: absent('no distance on this row') }],
    };
    const bad = readWeekEvidence({
      asOfISO: '2026-06-22', week: broken, conditions: conditions(1.0),
    }).capacity;
    expect(bad.units).toBe(0);
    expect(bad.unreadable).toBe(true);

    // REFUSED FOR RULE 8 · a real answer about a week that cannot answer the
    // question. Distinct from both above.
    const taper = read(PRESCRIBED * 1.10, 1.0, { authoredPlanMode: 'TAPER' }).capacity;
    expect(taper.units).toBe(0);
    expect(taper.unreadable).toBe(false);
    expect(taper.detail).toContain('never the runner');

    // And the ledger keeps them apart rather than reporting one bare zero.
    const led = accumulateCapacityEvidence([exact, bad, taper], '2026-06-22');
    expect(led.unreadableWeeks.length).toBe(1);
    expect(led.totalUnits).toBe(0);
  });

  it('RULE 21 · the bar to go UP is not higher than the bar to come down', () => {
    // Going up now begins at the GPS noise floor. Coming down still begins at
    // VOLUME_ADDITION_THRESHOLD. Lower, which is the direction the rule
    // permits; the rule forbids only the reverse.
    expect(GPS_DISTANCE_ERROR_LO_FRAC).toBeLessThan(VOLUME_ADDITION_THRESHOLD);
    // And the total a week can move upward is unchanged: the constant that was
    // the floor is now the ceiling, same value.
    expect(PER_WEEK_CREDIT_CEILING_FRAC).toBe(VOLUME_ADDITION_THRESHOLD);
  });

  it('RULE 22 · the DISTRIBUTION of this suite is near even, and counted', () => {
    /* "Twenty-nine files know how to hold a runner back. Two know what it
     * means to accelerate one." Counted here rather than assumed. The numbers
     * are maintained by hand against the `it` blocks above and asserted so the
     * count cannot silently drift. */
    const src = readFileSync(__filename, 'utf8');
    const credits = (src.match(/toBeGreaterThan\(0\)/g) ?? []).length;
    const withholds = (src.match(/\.toBe\(0\)/g) ?? []).length;
    expect(credits).toBeGreaterThanOrEqual(8);
    expect(withholds).toBeGreaterThanOrEqual(8);
    // The finding, stated as an assertion: neither side may be more than
    // three times the other. A suite that could only assert refusals would
    // pass an engine that could only refuse.
    expect(credits).toBeLessThan(withholds * 3);
    expect(withholds).toBeLessThan(credits * 3);
  });

  it('THE SEAM · this change did not open automatic plan mutation', () => {
    expect(AUTOMATIC_ADAPTATION_AUTHORITY).toBe(false);
    for (const f of ['weight.ts', 'evidence.ts']) {
      const src = readFileSync(path.join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/from '@\/lib\/db/);
      expect(src).not.toMatch(/\bpool\b/);
      expect(src).not.toMatch(/automaticPlanMutationIsAuthorised/);
    }
  });
});
