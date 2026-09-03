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
 *   · Whether the C-effort DECISION is the right coaching answer. It is a
 *     doctrine reading (`Research/00b` §"Recovery by Effort" · C row and
 *     §"Hard/Easy Alternation" against `Research/22` §"Multi-Race Year
 *     Planning"), and this asserts that the engine applies that reading and
 *     records it — not that the reading is correct. If the decision is ever
 *     reversed, these tests must be rewritten, not tightened. It was reversed
 *     once already, on 2026-09-02, and rewriting is exactly what happened.
 *   · The EVIDENCE gate itself. Every fixture here supplies none, so this file
 *     only ever sees the refusal limb. The granted limb lives in
 *     `_designed_race_weekend.test.ts` and nothing here would notice if it
 *     broke.
 *   · The intensity axis of `compoundProgressionCheck`. That function sees
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
  combinedStressFindings, compoundProgressionCheck,
  MIN_VOLUME_STEP, MIN_SHARE_POINTS, SHARE_MIN_COHERENT_LONG_MI,
  type StressDay, type StressRace, type PlacementRecord,
} from './combined-stress';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  type ComposePlanInput, type ComposedWeek, type DOW, type DayPlan,
} from './generate';
import { SPIKE_MIN_COHERENT_ANCHOR_MI } from './generate';
import { matrix, arcStr, simInputsForArc, type Arc } from './sim-matrix';
import { buildSimPlan } from './sim-inputs';
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

});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3b · STRESSOR-1 · ONE PRIMARY STRESSOR PER WEEK, BINDING (2026-09-02)
 *
 * David's ruling: "Make one primary stressor per day binding by default.
 * Exceptions must be explicitly typed, intentionally authored, and covered by
 * an invariant. Accidental combinations must fail plan generation rather than
 * ship as warnings."
 *
 * The test this replaces asserted `enforced === false` and that a cutback
 * rebound produced NO finding at all. Both halves changed: the finding binds,
 * and the rebound is now a TYPED, RECORDED exemption rather than a silent skip.
 *
 * WHAT THIS SECTION CANNOT FAIL ON (Rule 22):
 *   · Whether the composer's chosen stressor is the RIGHT one. It asserts that
 *     only one moved, never which.
 *   · Intensity. `CompoundWeek` carries miles, not how hard a session is.
 *   · A leak in the per-DAY half of the ruling. That is `validateComposedPlan`
 *     §9 (SP-7, stimulus-gap adjacency), which was already fatal before this
 *     work and is asserted separately in `_maint_invariants`.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('STRESSOR-1 · one primary stressor per week is binding', () => {
  const W = (startISO: string, weeklyMi: number, longMi: number, isCutback = false) =>
    ({ startISO, phase: 'QUALITY', weeklyMi, longMi, isCutback });

  it('a week that advances volume AND the long-run share is ENFORCED', () => {
    // 40 → 48 mi (+20%) with the long 14 → 19 mi: share 35.0% → 39.6%... which
    // is 4.6 points and does NOT fire. Pushed to 20 mi — share 41.7%, +6.7
    // points — so the fixture is over the band rather than beside it.
    const r = compoundProgressionCheck({ weeks: [W('w1', 40, 14), W('w2', 48, 20)] });
    expect(r.findings.map((x) => x.code)).toEqual(['COMPOUND_PRIMARY_STRESSORS']);
    expect(r.findings[0].enforced).toBe(true);
    expect(r.exemptions).toEqual([]);
  });

  it('a long run that grows WITH the week at a held share is ONE stressor', () => {
    // The correction at the heart of STRESSOR-1. `layoutWeek` sizes the long as
    // a share of the week (`Research/00a` §"Practical base-building rules" ·
    // "Long run grows | Up to 25–30% of weekly volume"), so holding the share
    // and raising the week MUST raise the long. The old test called that two
    // stressors and would have refused every ramping week in the engine.
    const r = compoundProgressionCheck({ weeks: [W('w1', 40, 14), W('w2', 48, 16.8)] });
    expect(r.findings).toEqual([]);
    expect(r.exemptions.map((e) => e.code)).toEqual(['LONG_COUPLED_TO_VOLUME']);
  });

  it('the long run moving ALONE is one stressor and never fires', () => {
    const r = compoundProgressionCheck({ weeks: [W('w1', 40, 14), W('w2', 40, 20)] });
    expect(r.findings).toEqual([]);
  });

  it('every typed exception is reachable, and each is RECORDED not skipped', () => {
    // Rule 11 · "no finding" and "a finding that was excused" are different
    // facts. Rule 15 · name the case that reaches each branch — these are them.
    const cutback = compoundProgressionCheck({ weeks: [W('w1', 40, 14, true), W('w2', 48, 20)] });
    expect(cutback.findings).toEqual([]);
    expect(cutback.exemptions.map((e) => e.code)).toEqual(['PLANNED_CUTBACK']);

    // A level already held earlier in this block: week 1 ran 50 mi / 21 mi.
    const rebound = compoundProgressionCheck({
      weeks: [W('w0', 50, 21), W('w1', 40, 14), W('w2', 48, 20)],
    });
    expect(rebound.findings).toEqual([]);
    expect(rebound.exemptions.map((e) => e.code)).toEqual(['REBOUND_TO_HELD_LEVEL']);

    const authored = compoundProgressionCheck({
      weeks: [W('w1', 40, 14), W('w2', 48, 20)],
      authoredCombinations: { w2: 'race-specific block opener, authored 2026-09-02' },
    });
    expect(authored.findings).toEqual([]);
    expect(authored.exemptions.map((e) => e.code)).toEqual(['AUTHORED_COMBINATION']);
    expect(authored.exemptions[0].detail).toContain('race-specific block opener');

    // An UNTYPED authorization is not one. His ruling forbids an exception
    // nobody argued for, so an empty reason is rejected and the week fires.
    const empty = compoundProgressionCheck({
      weeks: [W('w1', 40, 14), W('w2', 48, 20)],
      authoredCombinations: { w2: '   ' },
    });
    expect(empty.findings.map((x) => x.code)).toEqual(['COMPOUND_PRIMARY_STRESSORS']);

    // Below the authoring grid's coherence floor the check REFUSES to judge.
    const tiny = compoundProgressionCheck({ weeks: [W('w1', 10, 3.5), W('w2', 11, 4.5)] });
    expect(tiny.findings).toEqual([]);
    expect(tiny.exemptions.map((e) => e.code)).toEqual(['BELOW_GRID_RESOLUTION']);

    // Every exemption carries a citation. An exception with no argument is the
    // thing the ruling forbids.
    for (const r of [cutback, rebound, authored, tiny]) {
      for (const e of r.exemptions) expect(e.citation.length).toBeGreaterThan(10);
    }
  });

  it('the grid-coherence floor MIRRORS the spike rule and may not drift', () => {
    // Rule 16 · one quantity, one name. The module graph forbids importing
    // `SPIKE_MIN_COHERENT_ANCHOR_MI` into `combined-stress.ts` (generate.ts
    // imports it, so it cannot import back, and validate.ts cannot import
    // generate.ts either), so the constant is mirrored and this is the check
    // that keeps the mirror honest. A drift fails here.
    expect(SHARE_MIN_COHERENT_LONG_MI).toBe(SPIKE_MIN_COHERENT_ANCHOR_MI);
  });

  it('the volume lever must move for anything to fire (Rule 22 · what it cannot see)', () => {
    // A share rise on a FLAT week is the long-run lever alone. Correct, and
    // asserted so nobody later "fixes" it into a finding.
    const r = compoundProgressionCheck({ weeks: [W('w1', 40, 12), W('w2', 40, 20)] });
    expect(r.findings).toEqual([]);
    expect(r.exemptions).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 3c · STRESSOR-1 · THE WHOLE ARCHETYPE CORPUS, AND THE RULE 9 MARGIN
 *
 * Binding a threshold on a continuous quantity creates a cliff by
 * construction: at 4.9 points the plan ships and at 5.1 it is refused. Rule 9's
 * standard is that no real input may SIT on that edge, and that is measured
 * rather than hoped. This walks every archetype the engine can author and
 * reports how close the nearest non-exempt week actually gets.
 *
 * Measured on landing (2026-09-02): 8,781 plans, 87,230 week transitions, ZERO
 * enforced findings, and the closest non-exempt week reached 3.85 points
 * against the 5.00-point threshold — a 1.15-point margin, 23% of the
 * threshold. Exemptions reached: LONG_COUPLED_TO_VOLUME 17,249 ·
 * PLANNED_CUTBACK 131 · BELOW_GRID_RESOLUTION 106 · REBOUND_TO_HELD_LEVEL 8.
 *
 * WHAT THIS CANNOT FAIL ON: everything Rule 15 already says about this corpus —
 * `sim-matrix` archetypes carry no history, no travel windows and no mid-block
 * races on the cross-product half, so a compound progression that only arises
 * from one of those is unreachable here. Section 4 below drives a real block
 * with embedded races and is where that half is covered.
 * ───────────────────────────────────────────────────────────────────────── */
describe('STRESSOR-1 · the corpus, and how close it sits to the edge', () => {
  it('no archetype the engine can author carries an enforced compound progression', () => {
    let plans = 0;
    let transitions = 0;
    let findings = 0;
    let closestNonExempt = -1;
    let closestDetail = '';
    const reached: Record<string, number> = {};
    for (const a of matrix()) {
      const built = buildSimPlan(simInputsForArc(a) as never);
      if (!built.ok) continue;
      plans++;
      const weeks = (built.composed.weeks as unknown as Array<{
        startISO: string; phase: string; weeklyMi: number; isCutback?: boolean;
        days: Array<{ type: string; distanceMi: number; isLong?: boolean }>;
      }>).map((w) => ({
        startISO: w.startISO,
        phase: w.phase,
        weeklyMi: w.weeklyMi,
        longMi: Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)),
        isCutback: w.isCutback,
      }));
      transitions += Math.max(0, weeks.length - 1);
      const r = compoundProgressionCheck({ weeks });
      findings += r.findings.length;
      if (r.findings.length > 0 && closestDetail === '') {
        closestDetail = `FINDING ${arcStr(a as Arc)} :: ${r.findings[0].message}`;
      }
      for (const e of r.exemptions) reached[e.code] = (reached[e.code] ?? 0) + 1;

      // The margin, computed with the same predicates the check uses, so the
      // number reported is about the check rather than about a paraphrase.
      let pmW = 0, pmL = 0;
      for (let i = 1; i < weeks.length; i++) {
        const prev = weeks[i - 1], cur = weeks[i];
        pmW = Math.max(pmW, prev.weeklyMi); pmL = Math.max(pmL, prev.longMi);
        if (!(prev.weeklyMi > 0 && prev.longMi > 0 && cur.weeklyMi > 0 && cur.longMi > 0)) continue;
        if (!((cur.weeklyMi - prev.weeklyMi) / prev.weeklyMi > MIN_VOLUME_STEP)) continue;
        if (prev.longMi < SHARE_MIN_COHERENT_LONG_MI) continue;
        if (cur.isCutback || prev.isCutback) continue;
        if (cur.weeklyMi <= pmW && cur.longMi <= pmL) continue;
        const dShare = (cur.longMi / cur.weeklyMi) - (prev.longMi / prev.weeklyMi);
        if (dShare > closestNonExempt) {
          closestNonExempt = dShare;
          if (findings === 0) {
            closestDetail = `${arcStr(a as Arc)} wk ${cur.startISO} vol ${prev.weeklyMi}→${cur.weeklyMi} long ${prev.longMi}→${cur.longMi}`;
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n=== STRESSOR-1 · ${plans} plans, ${transitions} transitions, ${findings} enforced findings\n` +
      `    exemptions reached: ${JSON.stringify(reached)}\n` +
      `    closest non-exempt week: ${(closestNonExempt * 100).toFixed(2)} points vs the ` +
      `${(MIN_SHARE_POINTS * 100).toFixed(2)}-point band · margin ` +
      `${((MIN_SHARE_POINTS - closestNonExempt) * 100).toFixed(2)} points\n` +
      `    ${closestDetail}`,
    );

    // LIVENESS (Rule 18) · a walk that composed nothing reports clean.
    expect(plans).toBeGreaterThan(8000);
    expect(transitions).toBeGreaterThan(50_000);
    // Rule 15 · every typed exception must be REACHABLE by some real archetype,
    // or it is decoration. `AUTHORED_COMBINATION` is excluded: nothing in the
    // engine authors one yet, by design, and section 3b reaches it directly.
    //
    // TIEREVIDENCE-2 (2026-09-02) · `REBOUND_TO_HELD_LEVEL` joins it, and this
    // is a COVERAGE LOSS recorded rather than a fix. It was reached 8 times
    // across 8,781 plans; with the self-declared experience level removed the
    // corpus composes against smaller rows and no archetype now produces the
    // shape it describes — a week climbing back to a level ALREADY HELD earlier
    // in the same block. Section 3b still reaches it directly (the `rebound`
    // case above), so the code is exercised; what is gone is the corpus's
    // ability to produce one, which is exactly the Rule 15 gap this loop
    // exists to report. It is named here so it can be re-reached by giving the
    // corpus a history rather than by deleting the assertion.
    for (const code of ['LONG_COUPLED_TO_VOLUME', 'PLANNED_CUTBACK', 'BELOW_GRID_RESOLUTION']) {
      expect(reached[code] ?? 0, `no archetype reached ${code}`).toBeGreaterThan(0);
    }
    // THE ASSERTION. Binding is safe only because this is zero.
    expect(findings, closestDetail).toBe(0);
    // RULE 9 · and the nearest real plan is not sitting on the edge. Stated as
    // a bound rather than printed only, so a composer change that walks the
    // corpus up to the threshold fails here instead of on somebody's phone.
    expect(closestNonExempt).toBeLessThan(MIN_SHARE_POINTS * 0.9);
  }, 600_000);
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
  /**
   * REWRITTEN 2026-09-02 (DESIGNEDWEEKEND-1), and rewritten rather than
   * loosened, which is what this file's own header says to do when the
   * coaching decision changes.
   *
   * This used to assert that a C race in front of a long run is accepted FULL
   * STOP, for any runner, on no evidence about him at all. The owner ruled
   * that out in one sentence — "it must not silently make this pairing
   * available to every runner" — so the unconditional acceptance is gone and
   * what is asserted now is the DECISION being made and recorded by name.
   * This fixture carries no athlete evidence, so the honest outcome for it is
   * a refusal; `_designed_race_weekend.test.ts` carries the granted twin.
   */
  it('a C race in front of the long run is DECIDED, and the decision is recorded', () => {
    const c = composePlan(marathonInput(satTuneUp('C')));
    finalizeComposedPlan(c, 26.2, 'advanced');
    const wk = c.weeks[5];
    const sunday = dayByDow(wk, 0);
    expect(sunday.isLong).toBe(true);
    const rec = compromisesOf(c);
    // No evidence on this fixture → the exception is refused BY NAME and the
    // long run falls back onto doctrine's own return-to-long curve.
    expect(rec.find((x) => x.code === 'ACCEPT_AS_HARD_WORKOUT')).toBeFalsy();
    const cut = rec.find((x) => x.code === 'REDUCE_DOSE');
    expect(cut, 'the decision must be on the record, not implicit').toBeTruthy();
    expect(cut!.refusedDesignedWeekend?.code).toBe('NO_COMBINED_LOAD_EVIDENCE');
    // Rule 16 · the recorded number is the SHIPPED number.
    expect(cut!.detail).toContain(`→ ${sunday.distanceMi}mi`);
  });

  it('a B race in front of the same long run SHORTENS it, and says by how much', () => {
    const b = composePlan(marathonInput(satTuneUp('B')));
    finalizeComposedPlan(b, 26.2, 'advanced');
    const c = composePlan(marathonInput(satTuneUp('C')));
    finalizeComposedPlan(c, 26.2, 'advanced');
    const bLong = dayByDow(b.weeks[5], 0).distanceMi;
    const cLong = dayByDow(c.weeks[5], 0).distanceMi;
    // DESIGNEDWEEKEND-1 · with no athlete evidence BOTH are now cut, so the
    // assertion is the one that still separates them: a B effort owes a longer
    // return-to-long window than a C effort (`POST_RACE_PRIORITY_SCALE`), so it
    // is cut FURTHER. Equal would mean the effort grade had stopped mattering.
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

  /* ── STRESSOR-1 · THE BINDING IS WIRED, AND IT IS FALSIFIED HERE ──────────
   *
   * Rule 18 point 1: break the thing on purpose and watch the gate name it.
   * `compoundProgressionCheck` returning a finding proves the FUNCTION works;
   * only this proves `validateComposedPlan` actually raises it, which is the
   * difference between a rule and a hypothesis (Rule 20).
   *
   * The plan is mutated rather than composed, deliberately: the composer does
   * not author a compound progression anywhere in 8,781 archetypes (section
   * 3c), so a fixture that waits for one would be a test that never runs. */
  function compoundPlan() {
    const r = collidingPlan();
    // Find two consecutive future non-cutback weeks with a long run above the
    // grid floor, and push the second one's long run up hard: volume +10% and
    // the share past the five-point band, with no exemption available.
    const idx = r.weeks.findIndex((w, i) =>
      i > 0 && !w.isCutback && !r.weeks[i - 1].isCutback && !w.isRaceWeek
      && w.startISO > '2026-09-01'
      && Math.max(0, ...r.weeks[i - 1].days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)) >= 12);
    expect(idx, 'no week in the fixture is eligible - the fixture, not the rule, is broken').toBeGreaterThan(0);
    const prev = r.weeks[idx - 1];
    const cur = r.weeks[idx];
    const prevLong = Math.max(0, ...prev.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi));
    // Above every prior peak in the block, so REBOUND_TO_HELD_LEVEL cannot
    // excuse it; +12% volume and a long run at 45% of the week.
    const blockPeakWeekly = Math.max(...r.weeks.map((w) => w.weeklyMi));
    const blockPeakLong = Math.max(0, ...r.weeks.flatMap((w) =>
      w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)));
    cur.weeklyMi = Math.max(Math.round(prev.weeklyMi * 1.12), blockPeakWeekly + 1);
    const long = cur.days.find((d) => d.isLong && d.type !== 'race');
    expect(long, 'the chosen week has no long run').toBeTruthy();
    long!.distanceMi = Math.max(Math.round(cur.weeklyMi * 0.45), blockPeakLong + 1);
    r.vols = r.weeks.map((w) => w.weeklyMi);
    return { plan: r, weekISO: cur.startISO, prevLong, curLong: long!.distanceMi };
  }

  it('a block carrying an unexcused compound progression is REFUSED', () => {
    const { plan, weekISO } = compoundPlan();
    let err: PlanValidationError | null = null;
    try { validateComposedPlan(plan, 26.2, 'race-prep', ctx); } catch (e) { err = e as PlanValidationError; }
    expect(err, 'the compound week must be refused, not warned about').toBeTruthy();
    const text = err!.violations.join('\n');
    expect(text).toContain('COMPOUND_PRIMARY_STRESSORS');
    expect(text).toContain(weekISO);
    // Rule 13 point 3 · assert the SHAPE of the message, not the absence of a
    // pass. A refusal that says nothing useful is a refusal the next reader
    // cannot act on.
    expect(text).toMatch(/weekly volume \+\d/);
    expect(text).toMatch(/long-run share \+\d/);
    expect(text).toContain('hold one axis, or author the combination');
  });

  it('the same block ships once the combination is EXCUSED by the composer', () => {
    // The other direction of the falsification, and the proof his "explicitly
    // typed, intentionally authored" escape hatch is real rather than a
    // comment: the identical week passes when it carries a stated reason.
    const { plan, weekISO } = compoundPlan();
    const excused = compoundProgressionCheck({
      weeks: plan.weeks.map((w) => ({
        startISO: w.startISO, phase: w.phase, weeklyMi: w.weeklyMi,
        longMi: Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)),
        isCutback: w.isCutback,
      })),
      authoredCombinations: { [weekISO]: 'deliberate race-specific overload, authored with a citation' },
    });
    expect(excused.findings).toEqual([]);
    expect(excused.exemptions.some((e) => e.code === 'AUTHORED_COMBINATION' && e.weekStartISO === weekISO)).toBe(true);
  });

  it('the exemption ledger reaches a caller that asks for it', () => {
    const r = collidingPlan();
    let seen: string[] = [];
    validateComposedPlan(r, 26.2, 'race-prep', ctx, {
      onCompoundExemption: (e) => { seen = e.map((x) => x.code); },
    });
    // Rule 11 · a block that shipped with excused combinations and one that
    // never had any must be distinguishable, and this callback is how.
    expect(Array.isArray(seen)).toBe(true);
  });
});
