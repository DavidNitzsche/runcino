/**
 * lib/plan/coaching-structural.test.ts · plan-structure coaching fixes
 * (2026-08-17).
 *
 * Locks four structural behaviors:
 *
 *   1. MIDRACE-1 · mid-block B/C races embed as tune-up race days in
 *      generated plans (B: mini-taper + race + recovery easy days; C:
 *      the race converts the week's nearest quality slot). Gated —
 *      plans with NO mid-block races stay byte-identical.
 *      Cite: Research/22-plan-templates.md §11 + §Marathon-Advanced
 *      ("tune-up half"), Research/01-pace-zones-vdot.md:679-682.
 *
 *   2. RERAMP-1 · after an 8-14 day absence, remaining authored weeks
 *      rescale to 70% of the pre-absence rolling 4-week average with a
 *      ≤10%/week climb. Cite: Research/22 §14 (:635, :648-651).
 *
 *   3. FIELD_TEST_DUE gating windows (pure gate).
 *      Cite: Research/01:684-686 + :700-703.
 *
 *   4. HEAT-DRIFT-1 · per-run heat normalization of quality-pace
 *      evidence; silent no-op without weather data.
 *      Cite: Research/06-weather-adjustments.md §1-§2.
 *
 * Fixture is David's CIM block: Dec 6 marathon with Santa Monica 10K
 * (Sep 13, B), Dodgers 10K (Sep 26, C), Run Malibu Half (Nov 8, B) on
 * the calendar — the exact calendar the audit found the generator
 * training straight over.
 */
import { describe, it, expect } from 'vitest';
import {
  composePlan,
  finalizeComposedPlan,
  inlinePrescriptions,
  embedMidBlockRaces,
  MIDRACE_RESUME_RX,
  CUTBACK_LONG_DROP,
  cutbackLongDropFor,
  type ComposePlanInput,
  type ComposedWeek,
  type DOW,
  type DayPlan,
} from './generate';
import { validateComposedPlan } from './validate';
import { tPaceFromGoal, buildWorkoutSpec } from './spec-builder';
import {
  buildReRampActions,
  reRampWeeklyCeilingMi,
  RERAMP_RESUME_FRACTION,
  RERAMP_WEEKLY_GROWTH,
  fieldTestGate,
  type GapPlanRow,
} from './adapt';
import { heatAdjustQualitySample } from './drift-monitor';

// ── Fixture · David's CIM block ─────────────────────────────────────────

const CIM_MID_BLOCK: NonNullable<ComposePlanInput['midBlockRaces']> = [
  { slug: 'santa-monica-classic-10k', name: 'Santa Monica Classic 10K', date: '2026-09-13', distanceMi: 6.2, goalPaceSec: null, priority: 'B' },
  { slug: 'dodgers-10k', name: 'Dodgers 10K', date: '2026-09-26', distanceMi: 6.2, goalPaceSec: null, priority: 'C' },
  { slug: 'run-malibu-half', name: 'Run Malibu Half', date: '2026-11-08', distanceMi: 13.1, goalPaceSec: null, priority: 'B' },
];

function davidCimInput(midBlockRaces?: ComposePlanInput['midBlockRaces']): ComposePlanInput {
  return {
    raceDistanceMi: 26.2,
    goalSec: 10800,                       // 3:00:00
    goalPaceSec: Math.round(10800 / 26.2),
    raceDateISO: '2026-12-06',            // CIM · Sunday
    startMondayISO: '2026-08-17',         // Monday · 16-week runway
    level: 'advanced',
    recentWeeklyMi: 50,
    easyDayMedianMi: 7,
    recentLongMi: 14,
    bestRecentVdot: 48,
    isMidBlock: true,
    longRunDow: 0 as DOW,                 // Sunday long
    restDow: 6 as DOW,                    // Saturday rest
    qualityDows: [2, 4] as DOW[],         // Tue + Thu
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions('m'),
    rxRaceSpecific: inlinePrescriptions('m'),
    tPaceSec: tPaceFromGoal(10800, 26.2),
    lthr: null,
    maxHr: null,
    midBlockRaces,
  };
}

const dayByDow = (w: ComposedWeek, dow: number): DayPlan => {
  const d = w.days.find((x) => x.dow === dow);
  if (!d) throw new Error(`no day dow=${dow}`);
  return d;
};

describe('MIDRACE-1 · mid-block tune-up race embedding', () => {
  const baseline = composePlan(davidCimInput(undefined));
  const embedded = composePlan(davidCimInput(CIM_MID_BLOCK));

  it('no mid-block races → byte-identical output (gating)', () => {
    const emptied = composePlan(davidCimInput([]));
    expect(JSON.stringify(emptied.weeks)).toBe(JSON.stringify(baseline.weeks));
    expect(JSON.stringify(emptied.vols)).toBe(JSON.stringify(baseline.vols));
  });

  it('records all three races in authoredState.embedded_races', () => {
    const rec = embedded.authoredState.embedded_races as Array<{ slug: string; weekIdx: number; priority: string }>;
    expect(rec.map((r) => r.slug)).toEqual([
      'santa-monica-classic-10k', 'dodgers-10k', 'run-malibu-half',
    ]);
    expect(rec.map((r) => r.weekIdx)).toEqual([3, 5, 11]);
  });

  it('Santa Monica (B 10K, Sun Sep 13) replaces the long run with a race day', () => {
    const wk = embedded.weeks[3];
    const raceDay = dayByDow(wk, 0);
    expect(raceDay.type).toBe('race');
    expect(raceDay.distanceMi).toBeCloseTo(6.2, 5);
    expect(raceDay.isQuality).toBe(true);
    expect(raceDay.isLong).toBe(true);           // race ON the long-run day replaces the long
    expect(raceDay.raceGoalPaceSec).toBeNull();  // tune-up's own goal pace (none set)
    // No other long run remains in the week.
    expect(wk.days.filter((d) => d.isLong).length).toBe(1);
    // Mini-taper: no quality on the 2 days before the race (Fri + Sat).
    expect(dayByDow(wk, 5).isQuality).toBe(false);
    expect(dayByDow(wk, 6).isQuality).toBe(false);
    // Planned-deload flag so the next week's volume return is exempt.
    expect(wk.isCutback).toBe(true);
  });

  it('Santa Monica recovery: no quality inside the 4-day post-10K window', () => {
    // D1 (2026-09-02) · THE WINDOW IS FOUR DAYS, NOT TWO.
    //
    // This test read "2-day" because the engine carried an uncited
    // `distanceMi >= 12 ? 4 : >= 5 ? 2 : 1` fallback for an unanswered B race,
    // sitting beside `ROLE_POST_QUALITY_FREE_DAYS` and below it in every row.
    // The uncited constant is deleted; an unanswered B 10K now takes the
    // b_effort row (4 days), which is `Research/00b` §"Recovery by Distance" ·
    // "Total recovery days (no quality)" (10K: 5–7) scaled by §"Recovery by
    // Effort" ("60–70% of A-race recovery duration").
    //
    // Recovery days are Mon Sep 14 through Thu Sep 17 (week 4). Tue AND Thu
    // are David's quality DOWs — both must have been converted to easy.
    const wk4 = embedded.weeks[4];
    for (const dow of [1, 2, 3, 4]) {
      expect(dayByDow(wk4, dow).isQuality, `dow ${dow} inside the window`).toBe(false);
    }
    expect(dayByDow(wk4, 2).type).toBe('easy');
    // Thursday was quality in the baseline — the wider window is what converted
    // it, and asserting that is what stops this test passing on a 2-day window.
    expect(dayByDow(baseline.weeks[4], 4).isQuality).toBe(true);
    expect(dayByDow(wk4, 4).isQuality).toBe(false);
    // Baseline had Tuesday as a quality day — the conversion is real.
    expect(dayByDow(baseline.weeks[4], 2).isQuality).toBe(true);
  });

  it('Dodgers (C 10K, Sat Sep 26) converts the nearest quality slot', () => {
    const wk = embedded.weeks[5];
    const raceDay = dayByDow(wk, 6);
    expect(raceDay.type).toBe('race');
    expect(raceDay.distanceMi).toBeCloseTo(6.2, 5);
    expect(raceDay.isLong).toBe(false);
    // Race consumed the Saturday rest slot → the displaced nearest quality
    // (Thursday) becomes the rest day; Tuesday quality survives.
    expect(dayByDow(wk, 4).isQuality).toBe(false);
    expect(dayByDow(wk, 4).type).toBe('rest');
    expect(dayByDow(baseline.weeks[5], 4).isQuality).toBe(true);
    expect(dayByDow(wk, 2).isQuality).toBe(true);
    // The Sunday long run is still the week's long run; whether it stands at
    // full dose is the next test's question, not this one's.
    const sunday = dayByDow(wk, 0);
    expect(sunday.isLong).toBe(true);
    expect(sunday.type).toBe('long');
  });

  /**
   * DESIGNEDWEEKEND-1 (2026-09-02) · THE SUNDAY LONG RUN IS NO LONGER FREE.
   *
   * This assertion used to read "the next-day Sunday long is PRESERVED after a
   * 10K (the Pfitz Saturday-tune-up → Sunday-long pattern)", unconditionally,
   * for every runner. The owner ruled that out in one sentence: "it must not
   * silently make this pairing available to every runner." `Research/22`'s own
   * multi-race row says "1 short quality (Tue) + race (Sat); rest of week is
   * E" — doctrine puts the race in the week and does NOT put a long run the
   * next morning, and `Research/00b` §"Hard/Easy Alternation" allows two hard
   * days back to back only where "the plan explicitly calls for a stress block
   * followed by extended recovery".
   *
   * `davidCimInput` supplies no athlete evidence, so it is refused, by name,
   * and the long run falls back onto doctrine's return-to-long curve. The
   * granted twin — the same weekend for a runner whose own history supports it
   * — is in `_designed_race_weekend.test.ts`.
   */
  it('the Sunday long after Dodgers is an athlete-specific decision, refused here by name', () => {
    const wk = embedded.weeks[5];
    const sunday = dayByDow(wk, 0);
    expect(sunday.distanceMi).toBeLessThan(dayByDow(baseline.weeks[5], 0).distanceMi);
    const rec = (Array.isArray(embedded.authoredState.placement_compromises)
      ? embedded.authoredState.placement_compromises : []) as Array<{
        code: string; raceSlug: string; refusedDesignedWeekend?: { code: string };
      }>;
    const decision = rec.find((r) => r.raceSlug === 'dodgers-10k');
    expect(decision, 'the decision must be on the record').toBeTruthy();
    expect(decision!.code).toBe('REDUCE_DOSE');
    expect(decision!.refusedDesignedWeekend?.code).toBe('NO_COMBINED_LOAD_EVIDENCE');
  });

  it('Run Malibu (B half, Sun Nov 8) replaces the long and stands down 7 recovery days', () => {
    // D1 (2026-09-02) · SEVEN, NOT FOUR, AND THE FOUR WAS NEVER CITED.
    //
    // `Research/00b` §"Recovery by Distance" · "Total recovery days (no
    // quality)" gives a half marathon 10–14 days; §"Recovery by Effort" scales
    // a B effort to "60–70% of A-race recovery duration" and states the worked
    // answer in words — "For a B-race half marathon, expect 7–10 days of
    // recovery rather than 14". `ROLE_POST_QUALITY_FREE_DAYS.hm.b_effort` is
    // that 7. The engine used to answer 4 here from an uncited constant.
    const wk = embedded.weeks[11];
    const raceDay = dayByDow(wk, 0);
    expect(raceDay.type).toBe('race');
    expect(raceDay.distanceMi).toBeCloseTo(13.1, 5);
    expect(raceDay.isLong).toBe(true);
    expect(wk.isCutback).toBe(true);
    // The window is Mon Nov 9 through Sun Nov 15 — the WHOLE of week 12. No
    // quality anywhere in it.
    const wk12 = embedded.weeks[12];
    for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
      expect(dayByDow(wk12, dow).isQuality, `dow ${dow} inside the 7-day window`).toBe(false);
    }
    // FRIDAY IS THE ROW THAT MOVED. Under the uncited 4-day window it carried
    // the restored quality session; under doctrine it is day 5 of 7 and is an
    // easy day. Asserting it explicitly is what stops this test passing on the
    // old constant.
    expect(dayByDow(wk12, 5).type).toBe('easy');
    // The baseline is what the window converted FROM. Week 12 is a
    // marathon-pace long week under DOCTRINE-MPLONG-1 (Research/04 §4.4's
    // "every 2-3 weeks" cadence), so it authors ONE structured session beside
    // the MP long rather than two — §16 forbids pairing that long with a hard
    // tempo. Asserted as "some quality inside the window" so the check
    // survives the next legitimate change to which weekday carries what.
    const baseWk12 = baseline.weeks[12];
    expect([1, 2, 3, 4, 5].filter((d) => dayByDow(baseWk12, d).isQuality).length).toBeGreaterThan(0);
    // AND THE PLAN STILL SHIPS. A doctrine recovery window that swallows a
    // whole quality-phase week is accepted by validateComposedPlan §5 through
    // POSTRACE-WEEK-1's argued exemption — the cited injury rule beats the
    // uncited shape preference — not by weakening the quality requirement.
    // Falsified: removing that exemption makes this line throw
    // "Week 2026-11-09 (RACE-SPECIFIC): no quality sessions prescribed".
    const finalized = composePlan(davidCimInput(CIM_MID_BLOCK));
    finalizeComposedPlan(finalized, 26.2, 'advanced');
    finalized.vols = finalized.weeks.map((w) => w.weeklyMi);
    expect(() => validateComposedPlan(finalized, 26.2, 'race-prep', { todayISO: '2026-08-17', level: 'advanced', recentWeeklyMi: 50, isSteppingStoneToMarathon: false, priorPlanPeakLongMi: null, trailingAvgWeeklyMi: null })).not.toThrow();
  });

  it('MIDRACE-RESUME-1 · the resume day carries a real light-threshold prescription', () => {
    // The restored day is never an unprescribed slot: it goes out as the
    // cruise-interval re-entry (Research/04 §5.3 light end, per Research/00b's
    // reverse-taper ordering), through the same parsePrescription →
    // buildWorkoutSpec machinery as every authored quality day.
    //
    // D1 (2026-09-02) · THIS MOVED FROM THE HALF TO THE 10K, AND IT IS THE
    // OWNER'S OWN CASE NOW. Under the doctrine window the Malibu half's seven
    // recovery days cover the whole of week 12, so nothing is restored there —
    // the resume mechanism only fires when the window ENDS inside a week that
    // still has an easy day after it. Santa Monica's four days do exactly
    // that: Mon-Thu of week 4 are cleared and Friday Sep 18 carries the
    // re-entry. That is the row the owner's live block ships (2026-09-18,
    // "2×1.5 mi @ T · 3 min jog"), so the fixture and production now agree.
    const friday = dayByDow(embedded.weeks[4], 5);
    expect(friday.notes).toContain('Quality resumes');
    expect(friday.type).not.toBe('intervals');   // gap-1 rule
    expect(friday.type).toBe('threshold');
    expect(friday.subLabel).toBe(MIDRACE_RESUME_RX);
    expect(friday.notes).toContain('Research/04 §5.3');
    const tSec = tPaceFromGoal(10800, 26.2);
    if (tSec == null) throw new Error('fixture T pace unresolvable');
    const resume = buildWorkoutSpec('threshold', friday.distanceMi, tSec, null, friday.subLabel).spec as {
      rep_count: number; rep_distance_mi: number; rep_rest_s: number; rep_pace_s_per_mi: number | null;
    };
    // The subLabel parsed into the spec — not the default fallback shape.
    expect(resume.rep_count).toBe(2);
    expect(resume.rep_distance_mi).toBeCloseTo(1.5, 5);
    expect(resume.rep_rest_s).toBe(180);
    expect(resume.rep_pace_s_per_mi).toBe(tSec);
    // And its at-pace dose sits below a normal (unprescribed-default)
    // threshold day's at the same distance — the day is light on purpose.
    const normal = buildWorkoutSpec('threshold', friday.distanceMi, tSec, null, null).spec as {
      rep_count: number; rep_distance_mi: number;
    };
    expect(resume.rep_count * resume.rep_distance_mi).toBeLessThan(normal.rep_count * normal.rep_distance_mi);
  });

  it('weekly mileage accounting includes tune-up race miles', () => {
    for (const wi of [3, 5, 11]) {
      const wk = embedded.weeks[wi];
      const daySum = Math.round(wk.days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
      expect(wk.weeklyMi).toBe(daySum);
      expect(embedded.vols[wi]).toBe(wk.weeklyMi);
      // The race day's miles are inside the sum.
      const raceMi = wk.days.filter((d) => d.type === 'race').reduce((s, d) => s + d.distanceMi, 0);
      expect(raceMi).toBeGreaterThan(0);
    }
  });

  it('weeks untouched by any race stay byte-identical to the baseline', () => {
    for (const wi of [0, 1, 2, 6, 7, 8, 9, 10, 13, 14, 15]) {
      expect(JSON.stringify(embedded.weeks[wi])).toBe(JSON.stringify(baseline.weeks[wi]));
    }
  });

  it('the plan survives the prod finalize + validate pipeline', () => {
    const composed = composePlan(davidCimInput(CIM_MID_BLOCK));
    finalizeComposedPlan(composed, 26.2);
    composed.vols = composed.weeks.map((w) => w.weeklyMi);
    expect(() => validateComposedPlan(composed, 26.2, 'race-prep', {
      level: 'advanced',
      isSteppingStoneToMarathon: false,
      priorPlanPeakLongMi: null,
      todayISO: '2026-08-17',
      trailingAvgWeeklyMi: 50,
      recentWeeklyMi: 50,
    })).not.toThrow();
    // Finalize's VOL-1 keeps the mid-block race miles in the week total.
    const wk3 = composed.weeks[3];
    const wk3Sum = Math.round(wk3.days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
    expect(wk3.weeklyMi).toBe(wk3Sum);
  });

  it('a race dated at/after the target race day is never embedded', () => {
    const weeks = composePlan(davidCimInput(undefined)).weeks;
    const vols = weeks.map((w) => w.weeklyMi);
    const out = embedMidBlockRaces(weeks, vols, {
      startMondayISO: '2026-08-17',
      raceDateISO: '2026-12-06',
      midBlockRaces: [
        { slug: 'late', name: 'Late Race', date: '2026-12-06', distanceMi: 6.2, goalPaceSec: null, priority: 'B' },
        { slug: 'later', name: 'Later Race', date: '2026-12-20', distanceMi: 6.2, goalPaceSec: null, priority: 'B' },
      ],
      trainingDaysPerWeek: null,
    });
    expect(out).toEqual([]);
  });
});

// ── CUTBACK-LONG-1 · cutback weeks drop the long run per Research/00b ────

describe('CUTBACK-LONG-1 · cutback long-run depth (Research/00b §Depth of Cutback by Mileage Tier)', () => {
  const plan = composePlan(davidCimInput(undefined));

  it('the drop table sits at the low end of each doc row (gate parses the doc side)', () => {
    expect(CUTBACK_LONG_DROP.map((t) => t.drop)).toEqual([0.20, 0.25, 0.25, 0.30]);
    expect(cutbackLongDropFor(55)).toBe(0.25);
    expect(cutbackLongDropFor(30)).toBe(0.20);
    expect(cutbackLongDropFor(90)).toBe(0.30);
  });

  it('every curve cutback drops its long to the tier target and keeps the week inside the 20-30% band', () => {
    let checked = 0;
    for (let wi = 0; wi < plan.weeks.length; wi++) {
      const w = plan.weeks[wi];
      if (!w.isCutback || w.isRaceWeek || w.phase === 'TAPER') continue;
      let refLong = 0;
      let refMpw = 0;
      for (let j = wi - 1; j >= 0; j--) {
        const p = plan.weeks[j];
        if (p.isCutback || p.isRaceWeek || p.phase === 'TAPER') break;
        refMpw = Math.max(refMpw, p.weeklyMi);
        const ld = p.days.find((d) => d.isLong && d.type !== 'race');
        if (ld) refLong = Math.max(refLong, ld.distanceMi);
      }
      if (!(refLong > 0) || !(refMpw > 0)) continue;
      const long = w.days.find((d) => d.isLong && d.type !== 'race');
      expect(long).toBeTruthy();
      const target = Math.round(refLong * (1 - cutbackLongDropFor(refMpw)));
      const maxOther = Math.max(0, ...w.days.filter((d) => d !== long).map((d) => d.distanceMi));
      // The long reaches its tier target unless a stated bound stopped it:
      // it must stay the week's longest run, and the week's total cut must
      // not blow past the doc's 30% ceiling.
      const atTarget = long!.distanceMi <= target;
      const flooredByWeekMax = long!.distanceMi <= maxOther + 0.001;
      const trimExhausted = w.weeklyMi <= refMpw * 0.70 + 0.5;
      expect(atTarget || flooredByWeekMax || trimExhausted).toBe(true);
      // And the week's total cut stays inside the doc's own band.
      expect(w.weeklyMi).toBeGreaterThanOrEqual(refMpw * 0.70 - 0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the David fixture cutbacks land in-band against their preceding load blocks', () => {
    /* TIEREVIDENCE-2 (2026-09-02) · THE REFERENCE NUMBERS ARE READ OFF THE PLAN
     * INSTEAD OF TRANSCRIBED FROM IT.
     *
     * The case list was `[[3, 55, 17], [7, 62, 20], [11, 65, 22.5]]` with a
     * comment transcribing the fixture's own composition. Those numbers were
     * the plan the fixture produced while its `level: 'advanced'` put it on
     * `TIER_TARGETS.m.advanced`; on the evidence it actually carries (a VDOT
     * 48, ~7:04/mi at the marathon) it composes against §"Marathon —
     * Intermediate" and every load week is smaller, so the transcript went
     * stale and the assertion measured a plan that no longer exists.
     *
     * The INVARIANT is unchanged and is the whole point of the case: each
     * cutback's long run and weekly total sit inside `Research/00b` §"Depth of
     * Cutback by Mileage Tier" against the LOAD BLOCK THAT PRECEDES IT. So the
     * reference is now derived from that block the same way the sweep above
     * derives it, which is also a stronger test: it cannot go stale again, and
     * it walks every cutback rather than three hand-picked indices.
     */
    const cases: Array<[number, number, number]> = [];
    for (let wi = 1; wi < plan.weeks.length; wi++) {
      const w = plan.weeks[wi];
      if (!w.isCutback || w.isRaceWeek || w.phase === 'TAPER') continue;
      let refMpw = 0;
      let refLong = 0;
      for (let j = wi - 1; j >= 0; j--) {
        const p = plan.weeks[j];
        if (p.isCutback || p.isRaceWeek || p.phase === 'TAPER') break;
        refMpw = Math.max(refMpw, p.weeklyMi);
        const ld = p.days.find((d) => d.isLong && d.type !== 'race');
        if (ld) refLong = Math.max(refLong, ld.distanceMi);
      }
      if (refMpw > 0 && refLong > 0) cases.push([wi, refMpw, refLong]);
    }
    // LIVENESS · three load-block/cutback pairs is what this fixture has always
    // produced; a fixture that stopped composing cutbacks would otherwise walk
    // an empty list and report clean (Rule 18 clause 2).
    expect(cases.length, 'no load-block/cutback pair found in the David fixture').toBeGreaterThanOrEqual(3);
    for (const [wi, refMpw, refLong] of cases) {
      const w = plan.weeks[wi];
      expect(w.isCutback).toBe(true);
      const long = w.days.find((d) => d.isLong)!;
      const dropPct = (refLong - long.distanceMi) / refLong;
      const weekCutPct = (refMpw - w.weeklyMi) / refMpw;
      // Long drop reaches the tier figure (to whole-mile rounding).
      expect(long.distanceMi).toBe(Math.round(refLong * (1 - cutbackLongDropFor(refMpw))));
      expect(dropPct).toBeGreaterThanOrEqual(0.20 - 0.03);   // rounding slack
      expect(dropPct).toBeLessThanOrEqual(0.30);
      // Weekly cut inside the doc's 20-30% band.
      expect(weekCutPct).toBeGreaterThanOrEqual(0.20 - 0.005);
      expect(weekCutPct).toBeLessThanOrEqual(0.30 + 0.005);
    }
  });
});

// ── RERAMP-1 · post-absence re-ramp ─────────────────────────────────────

describe('RERAMP-1 · comeback re-ramp of remaining weeks', () => {
  const TODAY = '2026-08-17';
  const mkWeek = (startISO: string, dists: number[], opts?: Partial<GapPlanRow>): { weekStartISO: string; rows: GapPlanRow[] } => ({
    weekStartISO: startISO,
    rows: dists.map((mi, i) => ({
      id: `${startISO}-w${i}`,
      dateISO: startISO < TODAY ? startISO : `${startISO.slice(0, 8)}${String(Number(startISO.slice(8)) + i).padStart(2, '0')}`,
      type: i === dists.length - 1 ? 'long' : i === 1 ? 'threshold' : 'easy',
      distanceMi: mi,
      inRaceWeek: false,
      ...opts,
    })),
  });

  it('ceiling math: 70% resume, ≤10%/week climb', () => {
    expect(reRampWeeklyCeilingMi(39, 1)).toBeCloseTo(39 * 0.70, 5);
    expect(reRampWeeklyCeilingMi(39, 2)).toBeCloseTo(39 * 0.70 * 1.10, 5);
    expect(reRampWeeklyCeilingMi(39, 3)).toBeCloseTo(39 * 0.70 * 1.21, 4);
    // The exported constants ARE the doctrine numbers.
    expect(RERAMP_RESUME_FRACTION).toBe(0.70);
    expect(RERAMP_WEEKLY_GROWTH).toBe(1.10);
    // Growth week-over-week never exceeds 10%.
    for (let k = 2; k <= 8; k++) {
      const ratio = reRampWeeklyCeilingMi(39, k) / reRampWeeklyCeilingMi(39, k - 1);
      expect(ratio).toBeCloseTo(1.10, 5);
    }
  });

  it('the audited case: authored 59.5/64.5 weeks rescale toward the 39-mpw base', () => {
    // Weeks starting today+14 (k=3) and today+21 (k=4), authored at the
    // pre-absence ramp as if the absence never happened.
    const w3 = mkWeek('2026-08-31', [10, 12, 10, 10, 17.5]);   // 59.5mi
    const w4 = mkWeek('2026-09-07', [11, 13, 11, 11, 18.5]);   // 64.5mi
    const actions = buildReRampActions({
      todayISO: TODAY, daysOff: 8, lastRunISO: '2026-08-08',
      preAbsenceWeeklyMi: 39, weeks: [w3, w4], raceDates: [],
    });
    expect(actions.length).toBe(2);
    const ceil3 = 39 * 0.70 * 1.21;   // 33.03
    const ceil4 = 39 * 0.70 * 1.331;  // 36.34
    expect(actions[0].kind).toBe('shave');
    expect(actions[0].shaveFraction).toBeCloseTo(Math.round((1 - ceil3 / 59.5) * 100) / 100, 5);
    expect(actions[1].shaveFraction).toBeCloseTo(Math.round((1 - ceil4 / 64.5) * 100) / 100, 5);
    // Realized volume after the shave sits at ~the ceiling, not the
    // authored 59.5/64.5.
    const realized3 = 59.5 * (1 - (actions[0].shaveFraction as number));
    expect(realized3).toBeGreaterThan(ceil3 * 0.9);
    expect(realized3).toBeLessThan(ceil3 * 1.1);
    // Proportional shave → the long keeps its authored share (long stays
    // capped "accordingly" — same fraction of a smaller week).
    expect(actions[0].workoutIds).toContain('2026-08-31-w4');
  });

  it('weeks the ramp has caught up to are left alone', () => {
    const caughtUp = mkWeek('2026-09-14', [6, 6, 6, 6, 8]);  // 32mi < ceiling(k=5) ~40mi
    const actions = buildReRampActions({
      todayISO: TODAY, daysOff: 9, lastRunISO: '2026-08-07',
      preAbsenceWeeklyMi: 39, weeks: [caughtUp], raceDates: [],
    });
    expect(actions).toEqual([]);
  });

  it('fires only in the 8-14 day band (≤7d resumes full plan; >14d is propose-only rebuild)', () => {
    const w = mkWeek('2026-08-31', [10, 12, 10, 10, 17.5]);
    for (const daysOff of [5, 7, 15, 30]) {
      expect(buildReRampActions({
        todayISO: TODAY, daysOff, lastRunISO: '2026-08-01',
        preAbsenceWeeklyMi: 39, weeks: [w], raceDates: [],
      })).toEqual([]);
    }
  });

  it('race-protected rows are never shaved (per-finding context filter)', () => {
    const w = {
      weekStartISO: '2026-08-31',
      rows: [
        { id: 'r1', dateISO: '2026-08-31', type: 'easy', distanceMi: 20, inRaceWeek: false },
        { id: 'r2', dateISO: '2026-09-01', type: 'race', distanceMi: 26.2, inRaceWeek: false },
        { id: 'r3', dateISO: '2026-09-02', type: 'threshold', distanceMi: 20, inRaceWeek: true },
      ] as GapPlanRow[],
    };
    const actions = buildReRampActions({
      todayISO: TODAY, daysOff: 10, lastRunISO: '2026-08-06',
      preAbsenceWeeklyMi: 39, weeks: [w], raceDates: [],
    });
    expect(actions.length).toBe(1);
    expect(actions[0].workoutIds).toEqual(['r1']);
  });

  it('weeks inside the first 14 days belong to the 70%/85% band shaves, not the re-ramp', () => {
    const early = mkWeek('2026-08-24', [10, 12, 10, 10, 17.5]);  // starts today+7
    const actions = buildReRampActions({
      todayISO: TODAY, daysOff: 8, lastRunISO: '2026-08-08',
      preAbsenceWeeklyMi: 39, weeks: [early], raceDates: [],
    });
    expect(actions).toEqual([]);
  });

  // LOWVOL-6 (2026-08-19) · this used to assert that a 3 mi/wk pre-absence
  // average produced NOTHING, under a `>= 5` gate. §14 is stated as a
  // proportion of the runner's own volume, so it applies at 3 mi/wk as much as
  // at 39 — and a 5-10 mi/wk runner's rolling four-week average drops under
  // five whenever they miss a week, which is exactly when the shave is needed.
  // The gate that remains is a NOISE guard: below one real run a week the
  // reading is not a base signal at all.
  it('a genuine low-volume base still gets the re-ramp', () => {
    const w = mkWeek('2026-08-31', [2, 2, 2, 2, 3]);
    const actions = buildReRampActions({
      todayISO: TODAY, daysOff: 9, lastRunISO: '2026-08-07',
      preAbsenceWeeklyMi: 4, weeks: [w], raceDates: [],
    });
    expect(actions.length).toBe(1);
    expect(actions[0].kind).toBe('shave');
  });

  it('a noise-level pre-absence reading is not a base signal', () => {
    const w = mkWeek('2026-08-31', [10, 12, 10, 10, 17.5]);
    expect(buildReRampActions({
      todayISO: TODAY, daysOff: 9, lastRunISO: '2026-08-07',
      preAbsenceWeeklyMi: 1, weeks: [w], raceDates: [],
    })).toEqual([]);
  });

  it('the shave is never deeper than half the week, however low the base reads', () => {
    const w = mkWeek('2026-08-31', [10, 12, 10, 10, 17.5]);
    const actions = buildReRampActions({
      todayISO: TODAY, daysOff: 9, lastRunISO: '2026-08-07',
      preAbsenceWeeklyMi: 3, weeks: [w], raceDates: [],
    });
    expect(actions.length).toBe(1);
    expect(actions[0].shaveFraction).toBeLessThanOrEqual(0.5);
  });
});

// ── FIELD_TEST_DUE · gating windows ─────────────────────────────────────

describe('field-test detector gating (Research/01:684-686)', () => {
  const clean = {
    recentResultISO: null,
    recentTestISO: null,
    recentProposalAt: null,
    recentIntentAt: null,
    upcomingRaceISO: null,
    upcomingARaceISO: null,
    planAgeDays: 30,
  };

  it('fires when no race/test signal exists in 42 days and the plan is settled', () => {
    expect(fieldTestGate(clean)).toEqual({ ok: true, blockedBy: null });
  });

  it.each([
    ['recent_race_result', { recentResultISO: '2026-08-01' }],
    ['recent_field_test', { recentTestISO: '2026-07-20' }],
    ['recent_proposal', { recentProposalAt: '2026-08-10T00:00:00Z' }],
    ['recent_intent', { recentIntentAt: '2026-08-10T00:00:00Z' }],
    ['race_within_14d', { upcomingRaceISO: '2026-08-25' }],
    ['a_race_within_21d', { upcomingARaceISO: '2026-09-05' }],
  ] as const)('blocked by %s', (blockedBy, patch) => {
    expect(fieldTestGate({ ...clean, ...patch })).toEqual({ ok: false, blockedBy });
  });

  it('a fresh or missing plan blocks (paces were just calibrated)', () => {
    expect(fieldTestGate({ ...clean, planAgeDays: 10 }).blockedBy).toBe('plan_too_fresh');
    expect(fieldTestGate({ ...clean, planAgeDays: null }).blockedBy).toBe('plan_too_fresh');
    expect(fieldTestGate({ ...clean, planAgeDays: 14 }).ok).toBe(true);
  });

  it('a declined proposal suppresses the whole 42-day window (never fires twice)', () => {
    // The shell feeds ANY proposal row (pending/dismissed/expired) from the
    // last 42d into recentProposalAt — a decline is respected, not re-nagged.
    expect(fieldTestGate({ ...clean, recentProposalAt: '2026-07-10T00:00:00Z' }).ok).toBe(false);
  });

  // ── LTHR staleness · 2026-08-30 ─────────────────────────────────────────
  //
  // "The race IS the natural test" is true of the PACE anchor and false of the
  // threshold-HR anchor: a marathon, a C-graded tune-up and a hilly-excluded
  // course all refresh the first and none of them can refresh the second
  // (Research/03 §6's protocol wants a sustained maximal effort of about an
  // hour). Without this limb a runner who raced monthly was blocked from a
  // field test monthly, on the grounds that they had just raced, while their
  // threshold HR aged indefinitely.
  describe('LTHR past its re-test cadence', () => {
    it('lifts the recent-race blocker, because that race could not measure LTHR', () => {
      const raced = { ...clean, recentResultISO: '2026-08-16' };
      expect(fieldTestGate(raced).blockedBy).toBe('recent_race_result');
      expect(fieldTestGate({ ...raced, lthrPastCadence: true })).toEqual({ ok: true, blockedBy: null });
    });

    it('lifts NOTHING else · a declined test, a taper and a fresh plan all still block', () => {
      const stale = { ...clean, lthrPastCadence: true };
      expect(fieldTestGate({ ...stale, recentTestISO: '2026-07-20' }).blockedBy).toBe('recent_field_test');
      expect(fieldTestGate({ ...stale, recentProposalAt: '2026-08-10T00:00:00Z' }).blockedBy).toBe('recent_proposal');
      expect(fieldTestGate({ ...stale, recentIntentAt: '2026-08-10T00:00:00Z' }).blockedBy).toBe('recent_intent');
      expect(fieldTestGate({ ...stale, upcomingRaceISO: '2026-08-25' }).blockedBy).toBe('race_within_14d');
      expect(fieldTestGate({ ...stale, upcomingARaceISO: '2026-09-05' }).blockedBy).toBe('a_race_within_21d');
      expect(fieldTestGate({ ...stale, planAgeDays: 10 }).blockedBy).toBe('plan_too_fresh');
    });

    it('changes nothing when the anchor is fresh · the flag is not a bypass', () => {
      expect(fieldTestGate({ ...clean, recentResultISO: '2026-08-16', lthrPastCadence: false }).blockedBy)
        .toBe('recent_race_result');
      // Absent behaves exactly as false · every existing caller is unaffected.
      expect(fieldTestGate({ ...clean, recentResultISO: '2026-08-16' }).blockedBy)
        .toBe('recent_race_result');
    });
  });
});

// ── HEAT-DRIFT-1 · REMOVED 2026-08-27 ────────────────────────────────────
// heatAdjustQualitySample no longer normalizes for heat (see its doc
// comment in drift-monitor.ts) — it's a pure passthrough kept only so
// callers don't need restructuring. These tests cover that passthrough,
// not the removed normalization.

describe('quality-drift heat context filter (Research/06 §1-§2)', () => {
  const base = {
    plannedSPerMi: 420,
    actualSPerMi: 450,
    workoutType: 'tempo',
    tempF: null as number | null,
    dewpointF: null as number | null,
    humidityPct: null as number | null,
    durationS: 3600 as number | null,
  };

  it('hot conditions → still unadjusted (heat normalization removed)', () => {
    const { adjustedSPerMi, slowdownPct } = heatAdjustQualitySample({ ...base, tempF: 80 });
    expect(adjustedSPerMi).toBe(450);
    expect(slowdownPct).toBe(0);
  });

  it('no weather data → silently unadjusted', () => {
    const { adjustedSPerMi, slowdownPct } = heatAdjustQualitySample(base);
    expect(adjustedSPerMi).toBe(450);
    expect(slowdownPct).toBe(0);
  });

  it('cool conditions → no adjustment (≤50°F is the reference)', () => {
    const { adjustedSPerMi, slowdownPct } = heatAdjustQualitySample({ ...base, tempF: 45 });
    expect(adjustedSPerMi).toBe(450);
    expect(slowdownPct).toBe(0);
  });

  it('intervals get no adjustment either (heat normalization removed)', () => {
    const cont = heatAdjustQualitySample({ ...base, tempF: 85 });
    const ints = heatAdjustQualitySample({ ...base, tempF: 85, workoutType: 'intervals' });
    expect(ints.slowdownPct).toBe(cont.slowdownPct);
    expect(ints.adjustedSPerMi).toBe(cont.adjustedSPerMi);
  });

  it('dewpoint no longer produces a surcharge (heat normalization removed)', () => {
    const dry = heatAdjustQualitySample({ ...base, tempF: 80 });
    const humid = heatAdjustQualitySample({ ...base, tempF: 80, dewpointF: 70 });
    expect(humid.slowdownPct).toBe(dry.slowdownPct);
  });
});
