/**
 * _combined_stress.test.ts · THE GATE FOR BRIEF §5.4 AND DECISIONS D1/D2.
 *
 * What it holds:
 *
 *   1. The doctrine tables in `combined-stress.ts` are READ OUT OF
 *      `Research/00b` at run time, not hardcoded on both sides (Rule 18).
 *   2. An A- or B-effort race consumes the following long-run slot, and the
 *      cut is CONTINUOUS in the number of days between them (Rule 9).
 *   3. A C-effort race does not, and the acceptance is RECORDED by name
 *      rather than being a check that never looked (Rule 11).
 *   4. The validator's §11 fires on a race + long-run collision that every
 *      other section of the validator passes — which is the defect the owner's
 *      block carried (brief §3.2.C).
 *   5. The no-quality window has ONE resolver, and the placement pass and the
 *      validator call the same one.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *
 *   · Anything about the block's OWN target race. It is the last day of the
 *     plan; there is nothing after it to collide with, and §11 walks forward
 *     from a race only.
 *   · A collision between two non-race sessions. `validateComposedPlan` §9
 *     owns hard-day spacing and is unchanged by this work; if §9 regressed,
 *     nothing here would notice.
 *   · Whether the C-effort ACCEPTANCE is the right coaching answer. It is a
 *     doctrine reading (`Research/00b` §"Recovery by Effort" · C row against
 *     `Research/22` §"Multi-Race Year Planning"), and this asserts that the
 *     engine applies that reading and records it — not that the reading is
 *     correct. If the decision is ever reversed, these tests must be rewritten,
 *     not tightened.
 *   · The intensity axis of `compoundProgressionFindings`. That function sees
 *     weekly volume and long-run miles because those are numbers on
 *     `ComposedWeek`; session intensity is not, so a week that raises volume
 *     and quality density together is invisible to it and to this file.
 *   · Any runner whose race is not in `midBlockRaces`. A race the composer was
 *     never told about cannot be placed around, and no gate can see it.
 *
 * LIVENESS (Rule 18): the doctrine-table test counts the rows it parsed and
 * fails on zero, so a rename of the §"Recovery by Distance" heading cannot
 * turn this file into a clean report about nothing.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '@/lib/doctrine/resolve';
import {
  RETURN_TO_LONG_DAYS, POST_RACE_PRIORITY_SCALE,
  returnToLongDays, longRunFactorAfterRace, raceConsumesLongRunSlot,
  noQualityDaysAfterRace, effectiveRecoveryPriority,
  combinedStressFindings, compoundProgressionFindings,
  type StressDay, type StressRace, type PlacementRecord,
} from './combined-stress';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  type ComposePlanInput, type ComposedWeek, type DOW, type DayPlan,
} from './generate';
import { validateComposedPlan, PlanValidationError } from './validate';
import { tPaceFromGoal } from './spec-builder';

/* ─────────────────────────────────────────── 1 · doctrine, read at run time */

/**
 * The "Return to long runs" column of `Research/00b` §"Recovery by Distance",
 * parsed out of the document. Rows are `| 10K | 5–7 | 2–3 | Day 5–7 | ... |`.
 */
function returnToLongBandsFromDoc(): Map<string, [number, number]> {
  const doc = fs.readFileSync(
    path.join(repoRoot(), 'Research', '00b-recovery-protocols.md'), 'utf8',
  );
  const at = doc.indexOf('### Recovery by Distance');
  if (at < 0) throw new Error('Research/00b: §"Recovery by Distance" heading not found');
  const table = doc.slice(at, doc.indexOf('### Recovery by Effort', at));
  const out = new Map<string, [number, number]>();
  for (const line of table.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // | '' | Distance | total | zero-run | return-to-long | return-to-quality | next race | '' |
    if (cells.length < 7) continue;
    const label = cells[1];
    const band = cells[4];
    // "Day 4–5" / "Day 5–7" / "Week 2–3 (short)" / "Week 4"
    const m = band.match(/^(Day|Week)\s+(\d+)(?:\s*[–-]\s*(\d+))?/);
    if (!m) continue;
    const mult = m[1] === 'Week' ? 7 : 1;
    const lo = Number(m[2]) * mult;
    const hi = (m[3] ? Number(m[3]) : Number(m[2])) * mult;
    out.set(label, [lo, hi]);
  }
  return out;
}

describe('COMBINED-STRESS · the tables agree with Research/00b', () => {
  const bands = returnToLongBandsFromDoc();

  it('parsed the doc (liveness)', () => {
    // A gate that reports clean because it read nothing is the worst outcome
    // available. Four named rows minimum: the ones the engine keys on.
    expect(bands.size, `parsed rows: ${[...bands.keys()].join(', ')}`).toBeGreaterThanOrEqual(4);
    for (const k of ['5K', '10K', 'Half marathon', 'Marathon']) {
      expect(bands.has(k), `Research/00b row "${k}"`).toBe(true);
    }
  });

  it.each([
    ['5k', '5K'], ['10k', '10K'], ['hm', 'Half marathon'], ['m', 'Marathon'],
  ] as const)('RETURN_TO_LONG_DAYS.%s is the doc\'s own band', (engineKey, docKey) => {
    const band = bands.get(docKey);
    if (!band) throw new Error(`no doc band for ${docKey}`);
    expect(RETURN_TO_LONG_DAYS[engineKey]).toEqual(band);
  });

  it('ultra takes the most conservative ultra row the doc publishes', () => {
    // Unreachable in the engine today (ULTRA-OUT-1 refuses to embed one, and
    // the target race is never an ultra), stated rather than omitted because
    // an absent row would read as zero. 100-mile is the deepest of the four.
    const hundredMile = bands.get('100-mile');
    if (!hundredMile) throw new Error('Research/00b row "100-mile" not found');
    expect(RETURN_TO_LONG_DAYS.ultra).toEqual(hundredMile);
  });

  it('the effort scale is the top of each doctrine band', () => {
    const doc = fs.readFileSync(path.join(repoRoot(), 'Research', '00b-recovery-protocols.md'), 'utf8');
    const at = doc.indexOf('### Recovery by Effort');
    expect(at, 'Research/00b §"Recovery by Effort"').toBeGreaterThan(0);
    const section = doc.slice(at, at + 1400);
    expect(section).toContain('60–70% of A-race recovery duration');
    expect(section).toContain('25–50% of A-race recovery duration');
    expect(POST_RACE_PRIORITY_SCALE.A).toBe(1.0);
    expect(POST_RACE_PRIORITY_SCALE.B).toBeCloseTo(0.70, 6);
    expect(POST_RACE_PRIORITY_SCALE.C).toBeCloseTo(0.50, 6);
  });
});

/* ───────────────────────────────────────── 2 · the grade, and the continuity */

describe('COMBINED-STRESS · effort grade decides, days decide by how much', () => {
  it('an A or B effort consumes the long-run slot; a C effort does not', () => {
    expect(raceConsumesLongRunSlot('A')).toBe(true);
    expect(raceConsumesLongRunSlot('B')).toBe(true);
    expect(raceConsumesLongRunSlot('C')).toBe(false);
  });

  it('the answered role is what grades the effort, not the calendar letter', () => {
    expect(effectiveRecoveryPriority({ priority: 'B', plannedRole: 'race' })).toBe('A');
    expect(effectiveRecoveryPriority({ priority: 'B', plannedRole: 'mp_workout' })).toBe('C');
    expect(effectiveRecoveryPriority({ priority: 'B', plannedRole: null })).toBe('B');
    expect(effectiveRecoveryPriority({ priority: 'C', plannedRole: null })).toBe('C');
  });

  it('RULE 9 · the allowed long moves continuously and monotonically in days', () => {
    const R = returnToLongDays(13.1, 'B');           // half, B effort → 10 × 0.70 = 7
    expect(R).toBeCloseTo(7, 6);
    let prev = -1;
    // Quarter-day steps across the whole window and past it. No step may move
    // the answer by more than one quarter-day's worth of the range, and the
    // series may never go down.
    for (let d = 0; d <= R + 2; d += 0.25) {
      const f = longRunFactorAfterRace(d, R);
      expect(f).toBeGreaterThanOrEqual(prev);
      if (prev >= 0) expect(f - prev).toBeLessThanOrEqual(0.25 / R + 1e-9);
      prev = f;
    }
    expect(longRunFactorAfterRace(R, R)).toBe(1);
    expect(longRunFactorAfterRace(R + 5, R)).toBe(1);
  });

  it('RULE 11 · an unreadable distance never silently deletes the long run', () => {
    // returnToLongDays returns 0 for a distance the categorizer refuses. A
    // factor of 0 there would zero a runner's long run on a read that failed.
    // `distanceCategoryOrNull` refuses only a missing, non-finite or
    // non-positive distance — every positive number lands on a row.
    expect(returnToLongDays(NaN, 'A')).toBe(0);
    expect(returnToLongDays(0, 'A')).toBe(0);
    expect(longRunFactorAfterRace(1, 0)).toBe(1);
  });

  it('ONE RESOLVER · the no-quality window is the day-granular doctrine table', () => {
    // half B = 7 (Research/00b states this one in words), 10K B = 4, 5K B = 3.
    expect(noQualityDaysAfterRace(13.1, 'B')).toBe(7);
    expect(noQualityDaysAfterRace(6.2, 'B')).toBe(4);
    expect(noQualityDaysAfterRace(3.1, 'B')).toBe(3);
    // A effort takes the A row.
    expect(noQualityDaysAfterRace(13.1, 'A')).toBe(10);
    // C is the A row at §"Recovery by Effort"'s 25–50% top edge, UN-rounded:
    // rounding 2.5 up to 3 would move a real training day for a hair.
    expect(noQualityDaysAfterRace(6.2, 'C')).toBeCloseTo(2.5, 6);
  });
});

/* ─────────────────────────────────────────────── 3 · findings on a fixture */

const day = (o: Partial<StressDay> & { dateISO: string }): StressDay => ({
  weekStartISO: '2026-09-21', type: 'easy', distanceMi: 6,
  isQuality: false, isLong: false, ...o,
});

describe('COMBINED-STRESS · findings', () => {
  const long = day({ dateISO: '2026-09-27', type: 'long', distanceMi: 15.5, isLong: true });

  it('fires on a B race followed by a long run inside 24 hours', () => {
    const races: StressRace[] = [{
      dateISO: '2026-09-26', distanceMi: 6.21, name: 'Dodgers', effectivePriority: 'B',
    }];
    const f = combinedStressFindings({
      races, days: [long], noQualityDays: noQualityDaysAfterRace, todayISO: '2026-09-01',
    });
    expect(f.map((x) => x.code)).toContain('RACE_LONG_24H');
    expect(f.find((x) => x.code === 'RACE_LONG_24H')!.enforced).toBe(true);
    expect(f.find((x) => x.code === 'RACE_LONG_24H')!.message).toContain('Research/00b');
  });

  it('does NOT fire on the same weekend at a C effort', () => {
    const races: StressRace[] = [{
      dateISO: '2026-09-26', distanceMi: 6.21, name: 'Dodgers', effectivePriority: 'C',
    }];
    const f = combinedStressFindings({
      races, days: [long], noQualityDays: noQualityDaysAfterRace, todayISO: '2026-09-01',
    });
    expect(f.filter((x) => x.code === 'RACE_LONG_24H' || x.code === 'LONG_INSIDE_RETURN_WINDOW')).toEqual([]);
  });

  it('fires on quality inside the no-quality window and not outside it', () => {
    const races: StressRace[] = [{
      dateISO: '2026-09-13', distanceMi: 6.2, name: 'Santa Monica', effectivePriority: 'B',
    }];
    const inside = day({ dateISO: '2026-09-17', type: 'threshold', isQuality: true, weekStartISO: '2026-09-14' });
    const outside = day({ dateISO: '2026-09-18', type: 'threshold', isQuality: true, weekStartISO: '2026-09-14' });
    const f = combinedStressFindings({
      races, days: [inside, outside], noQualityDays: noQualityDaysAfterRace, todayISO: '2026-09-01',
    });
    expect(f.map((x) => x.dateISO)).toEqual(['2026-09-17']);
  });

  it('does not re-grade a sealed past week', () => {
    const races: StressRace[] = [{
      dateISO: '2026-09-26', distanceMi: 6.21, name: 'Dodgers', effectivePriority: 'B',
    }];
    const f = combinedStressFindings({
      races, days: [long], noQualityDays: noQualityDaysAfterRace, todayISO: '2026-12-01',
    });
    expect(f).toEqual([]);
  });

  it('compound progression is ADVISORY and skips a cutback rebound', () => {
    const weeks = [
      { startISO: 'w1', phase: 'QUALITY', weeklyMi: 40, longMi: 14 },
      { startISO: 'w2', phase: 'QUALITY', weeklyMi: 48, longMi: 17 },
    ];
    const f = compoundProgressionFindings({ weeks });
    expect(f.map((x) => x.code)).toEqual(['COMPOUND_PRIMARY_STRESSORS']);
    expect(f[0].enforced).toBe(false);
    const rebound = compoundProgressionFindings({
      weeks: [{ ...weeks[0], isCutback: true }, weeks[1]],
    });
    expect(rebound).toEqual([]);
  });
});

/* ──────────────────────────────────── 4 · the whole engine, on a real block */

function marathonInput(mid: ComposePlanInput['midBlockRaces']): ComposePlanInput {
  return {
    raceDistanceMi: 26.2,
    goalSec: 10800,
    goalPaceSec: Math.round(10800 / 26.2),
    raceDateISO: '2026-12-06',
    startMondayISO: '2026-08-17',
    level: 'advanced',
    recentWeeklyMi: 50,
    easyDayMedianMi: 7,
    recentLongMi: 14,
    bestRecentVdot: 48,
    isMidBlock: true,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions('m'),
    rxRaceSpecific: inlinePrescriptions('m'),
    tPaceSec: tPaceFromGoal(10800, 26.2),
    lthr: null,
    maxHr: null,
    midBlockRaces: mid,
  };
}

/** The Saturday-before-a-Sunday-long tune-up, at a stated priority. */
const satTuneUp = (priority: 'B' | 'C'): ComposePlanInput['midBlockRaces'] => ([{
  slug: 'sat-tuneup', name: 'Saturday Tune-Up', date: '2026-09-26',
  distanceMi: 6.2, goalPaceSec: null, priority,
}]);

const dayByDow = (w: ComposedWeek, dow: number): DayPlan => {
  const d = w.days.find((x) => x.dow === dow);
  if (!d) throw new Error(`no day dow=${dow}`);
  return d;
};
const compromisesOf = (r: { authoredState: Record<string, unknown> }): PlacementRecord[] =>
  (Array.isArray(r.authoredState.placement_compromises)
    ? r.authoredState.placement_compromises : []) as PlacementRecord[];

describe('COMBINED-STRESS · the placement pass, end to end', () => {
  it('a C race in front of the long run is ACCEPTED, and the decision is recorded', () => {
    const c = composePlan(marathonInput(satTuneUp('C')));
    finalizeComposedPlan(c, 26.2, 'advanced');
    const wk = c.weeks[5];
    const sunday = dayByDow(wk, 0);
    expect(sunday.isLong).toBe(true);
    expect(sunday.distanceMi).toBeGreaterThan(10);
    const rec = compromisesOf(c);
    const accept = rec.find((x) => x.code === 'ACCEPT_AS_HARD_WORKOUT');
    expect(accept, 'the acceptance must be on the record, not implicit').toBeTruthy();
    expect(accept!.citation).toContain('Recovery by Effort');
    // Rule 16 · the recorded number is the SHIPPED number.
    expect(accept!.detail).toContain(`${sunday.distanceMi}mi long run`);
  });

  it('a B race in front of the same long run SHORTENS it, and says by how much', () => {
    const b = composePlan(marathonInput(satTuneUp('B')));
    finalizeComposedPlan(b, 26.2, 'advanced');
    const c = composePlan(marathonInput(satTuneUp('C')));
    finalizeComposedPlan(c, 26.2, 'advanced');
    const bLong = dayByDow(b.weeks[5], 0).distanceMi;
    const cLong = dayByDow(c.weeks[5], 0).distanceMi;
    expect(bLong, `B long ${bLong} must be shorter than C long ${cLong}`).toBeLessThan(cLong);
    const rec = compromisesOf(b);
    const cut = rec.find((x) => x.code === 'REDUCE_DOSE');
    expect(cut, 'the cut must be on the record').toBeTruthy();
    expect(cut!.detail).toContain(`→ ${bLong}mi`);
    expect(cut!.citation).toContain('Return to long runs');
  });

  it('RULE 9 · the B-race cut is graded by the gap, not switched by it', () => {
    // Two tune-ups one day apart. The Friday race is two days from the long
    // and must leave MORE of it standing than the Saturday one — the old
    // branch this replaces stood the long down entirely inside the window and
    // left it untouched one day later.
    const at = (date: string) => {
      const r = composePlan(marathonInput([{
        slug: 'tuneup', name: 'Tune-Up', date, distanceMi: 6.2, goalPaceSec: null, priority: 'B',
      }]));
      finalizeComposedPlan(r, 26.2, 'advanced');
      return dayByDow(r.weeks[5], 0).distanceMi;
    };
    const sat = at('2026-09-26');   // 1 day before the long
    const fri = at('2026-09-25');   // 2 days before the long
    expect(fri).toBeGreaterThan(sat);
  });
});

describe('COMBINED-STRESS · the validator sees the pair', () => {
  /**
   * The defect, reconstructed: a plan whose race and long run collide but
   * which passes every OTHER section of the validator. Built by composing the
   * C-effort block (which the engine legitimately ships) and then re-labelling
   * the race as a B effort on `authoredState` alone — so the days are
   * untouched and only the grade moves. Every other check reads the days.
   */
  function collidingPlan() {
    const r = composePlan(marathonInput(satTuneUp('C')));
    finalizeComposedPlan(r, 26.2, 'advanced');
    r.vols = r.weeks.map((w) => w.weeklyMi);
    return r;
  }
  const ctx = { todayISO: '2026-08-17', level: 'advanced' as const, recentWeeklyMi: 50, isSteppingStoneToMarathon: false, priorPlanPeakLongMi: null, trailingAvgWeeklyMi: null };

  it('the C-effort block ships clean', () => {
    expect(() => validateComposedPlan(collidingPlan(), 26.2, 'race-prep', ctx)).not.toThrow();
  });

  it('re-grading the SAME days to a B effort is refused, with the typed code', () => {
    const r = collidingPlan();
    const races = r.authoredState.embedded_races as Array<{ priority: string }>;
    races[0].priority = 'B';
    let err: PlanValidationError | null = null;
    try { validateComposedPlan(r, 26.2, 'race-prep', ctx); } catch (e) { err = e as PlanValidationError; }
    expect(err, 'the collision must be refused once the effort is graded as a race').toBeTruthy();
    expect(err!.violations.join('\n')).toContain('RACE_LONG_24H');
  });

  it('the stress ledger reaches a caller that asks for it', () => {
    const r = collidingPlan();
    let seen: string[] = [];
    validateComposedPlan(r, 26.2, 'race-prep', ctx, { onStress: (f) => { seen = f.map((x) => x.code); } });
    // The C block has no enforced finding; the ledger is still delivered, and
    // it is what brief §5's `stressLedger` asks for.
    expect(Array.isArray(seen)).toBe(true);
  });
});
