/**
 * DOCTRINE-DOSING-1 · Daniels' WEEKLY quality caps, which nothing summed.
 *
 * `Research/01-pace-zones-vdot.md` §"Dosing rules — Daniels' caps" gives every
 * quality pace two caps: one on a single workout, one on the WEEK. The engine
 * has enforced the first since the progression engine landed
 * (`atPaceSessionCapMi`) and has never computed the second. A week carrying a
 * cruise session and a continuous tempo, each individually legal at 10% of
 * weekly mileage, puts 20% of the week at threshold — and every gate passes it.
 *
 * That is not hypothetical. It is the dominant shape in the archetype corpus
 * and it is in the owner's own marathon build: five of its sixteen weeks pair
 * `N× M min @ T pace` with `5mi continuous tempo`, landing at 13-19% of the
 * week at T against doctrine's 10%.
 *
 * ── DOCTRINE-DOSING-2 (2026-08-18) · this is now a GATE, and it asserts ZERO ──
 *
 * The counts here landed as ratchets — 1750 findings across 178 of 180
 * archetypes — because enforcing the caps would re-prescribe existing plans and
 * that was the owner's call. He made it: "if my plan has a chance of breaking
 * rules, then we need to insert something into the code that would never allow
 * that."
 *
 * So the composer was fixed rather than the detector loosened, and the corpus
 * census below asserts zero ENFORCED breaches instead of a ceiling. What
 * changed in the engine, in the order it matters:
 *
 *   1. `qualityTypesFor` stopped pairing two sessions of one pace family.
 *      `threshold` and `tempo` are both T; the mixes now alternate the FORM
 *      week to week, which is what §5.2's "1×/week or alternating with cruise
 *      intervals" asks for, and spend the freed slot on a family with budget.
 *   2. The day sizers spend a WEEKLY budget (`slotDoseBudgetMi`) rather than a
 *      per-session share, so two sessions can never each claim the whole 10%.
 *   3. `applyDosingCaps` reconciles after every pass that moves mileage, since
 *      the caps are percentages of a denominator VOL-1 and the taper rescale
 *      both rewrite after the sessions were sized.
 *   4. `validateComposedPlan` turns any remaining enforced finding into a fatal
 *      violation, unconditionally, on every path that writes a plan.
 *
 * The findings that REMAIN are all percentage findings in tapers and race
 * weeks, and they are reported rather than enforced: Research/08 §9.1 holds
 * intensity while volume falls, and §9.2 states its taper sessions by name at
 * doses outside Research/01's percentages. `capEnforced` carries that argument
 * and `DOSING.taper-percentage-exemption` binds it to the document.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_dosing_doctrine.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import {
  dosePaceOf,
  weekDose,
  weekDosingFindings,
  planDosingFindings,
  summarizeDosing,
  weeklyShareCap,
  MARATHON_PACE_WORKOUT_CAP,
  CUMULATIVE_CEILING_KM,
  type DosingFinding,
} from './dosing';
import { validateComposedPlan, PlanValidationError } from './validate';
import type { SimDistance } from './sim-constants';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '2027-03-01', lastRaceFinishedDaysAgo: 0,
  lastRaceDistance: null, raceHistory: [], longRunDay: 'sun', restDay: 'sat', availableDays: [],
} as any;

const GOAL_SEC: Record<SimDistance, number> = {
  '5k': 1350, '10k': 2700, half: 6300, marathon: 13500, '50k': 18000, '100k': 43200,
};
const WEEKS: Record<SimDistance, number> = {
  '5k': 12, '10k': 12, half: 14, marathon: 18, '50k': 22, '100k': 24,
};

describe('DOCTRINE-DOSING-1 · pace attribution', () => {
  it('puts each session s hard miles in the pace bucket its prescription declares', () => {
    // Threshold reps → T. The miles are splitDay's, so warm-up, cool-down and
    // the jog floats are already out.
    const t = { type: 'threshold', distanceMi: 9, subLabel: '4×1mi @ T pace · 60s jog' };
    expect(dosePaceOf(t)).toBe('T');

    // A continuous block is T unless the prescription says MP — the same
    // distinction spec-builder draws, and the reason it draws it.
    expect(dosePaceOf({ type: 'tempo', distanceMi: 8, subLabel: '2 mi WU · 4 mi @ T · 2 mi CD' })).toBe('T');
    expect(dosePaceOf({ type: 'tempo', distanceMi: 15, subLabel: '2.5 mi WU · 11 mi @ MP · 1.5 mi CD' })).toBe('M');

    expect(dosePaceOf({ type: 'intervals', distanceMi: 8, subLabel: '5×1mi @ I pace · 90s jog' })).toBe('I');

    // A long run doses only its finish, and which pace depends on the tag.
    // Research/01 §"Pace conversion": T is "~half-marathon pace to 15K pace".
    expect(dosePaceOf({ type: 'long', distanceMi: 20, subLabel: 'LONG · 8mi @ MP', isLong: true })).toBe('M');
    expect(dosePaceOf({ type: 'long', distanceMi: 16, subLabel: 'LONG · 4mi @ HM', isLong: true })).toBe('T');
    expect(dosePaceOf({ type: 'long', distanceMi: 20, subLabel: 'LONG', isLong: true })).toBeNull();

    // A race is raced, not dosed — otherwise a marathon race day reads as a
    // 26.2 mi marathon-pace workout. `validate.ts` draws the same line.
    expect(dosePaceOf({ type: 'race', distanceMi: 26.2, subLabel: 'RACE' })).toBeNull();

    // Easy days and rest dose nothing, and strides on an easy day are "Not a
    // workout" (Research/04 §7.2) — splitDay already gives them zero hard miles.
    expect(dosePaceOf({ type: 'easy', distanceMi: 6, subLabel: 'EASY · 6×20s strides' })).toBeNull();
    expect(dosePaceOf({ type: 'rest', distanceMi: 0, subLabel: null })).toBeNull();

    // The tune-up emits a `threshold` SPEC whatever its rep pace, so the bucket
    // has to come from the prescription rather than the spec kind.
    expect(dosePaceOf({ type: 'race_week_tuneup', distanceMi: 5, subLabel: '5×400m @ 5K pace · 2min jog' })).toBe('I');
    expect(dosePaceOf({ type: 'race_week_tuneup', distanceMi: 5, subLabel: '3×1mi @ HM race pace' })).toBe('T');
  });

  it('sums a week s dosed miles and leaves the race out of the denominator', () => {
    const week = {
      startISO: '2026-07-06',
      phase: 'QUALITY',
      days: [
        { type: 'easy', distanceMi: 6, subLabel: 'EASY' },
        { type: 'threshold', distanceMi: 9, subLabel: '4×1mi @ T pace · 60s jog' },
        { type: 'easy', distanceMi: 6, subLabel: 'EASY' },
        { type: 'long', distanceMi: 16, subLabel: 'LONG · 4mi @ MP', isLong: true },
        { type: 'rest', distanceMi: 0, subLabel: null },
      ],
    };
    const d = weekDose(week as never);
    expect(d.weeklyMi).toBe(37);
    expect(d.byPace.T).toBeCloseTo(4, 1);
    expect(d.byPace.M).toBeCloseTo(4, 1);
    expect(d.byPace.I).toBe(0);
    expect(d.sessions).toHaveLength(2);

    // The same week with a race in it: the race neither doses nor inflates the
    // denominator the doses are measured against.
    const withRace = { ...week, days: [...week.days, { type: 'race', distanceMi: 13.1, subLabel: 'RACE' }] };
    expect(weekDose(withRace as never).weeklyMi).toBe(37);
    expect(weekDose(withRace as never).byPace.M).toBeCloseTo(4, 1);
  });

  it('fires on the two-legal-sessions week that no existing gate catches', () => {
    // THE GAP, in one week. Each session is inside atPaceSessionCapMi
    // (10% of 60 = 6 mi); together they are 15% of the week at threshold.
    const week = {
      startISO: '2026-07-06',
      phase: 'QUALITY',
      days: [
        { type: 'easy', distanceMi: 10, subLabel: 'EASY' },
        { type: 'threshold', distanceMi: 9, subLabel: '4×1mi @ T pace · 60s jog' },
        { type: 'easy', distanceMi: 10, subLabel: 'EASY' },
        { type: 'tempo', distanceMi: 10, subLabel: '2 mi WU · 5 mi @ T · 3 mi CD' },
        { type: 'easy', distanceMi: 7, subLabel: 'EASY' },
        { type: 'long', distanceMi: 14, subLabel: 'LONG', isLong: true },
      ],
    };
    const f = weekDosingFindings(week as never);
    const weekly = f.filter((x) => x.scope === 'weekly' && x.pace === 'T');
    expect(weekly).toHaveLength(1);
    expect(weekly[0].doseMi).toBeCloseTo(9, 1);
    expect(weekly[0].weeklyMi).toBe(60);
    expect(weekly[0].capMi).toBeCloseTo(6, 1);
    expect(weekly[0].context).toBe('training');

    // Neither session alone breaches the single-workout cap · that is precisely
    // why the weekly column had to be read.
    expect(f.filter((x) => x.scope === 'single-workout')).toHaveLength(0);
  });

  it('says nothing about a week that doses nothing, or a week with no running', () => {
    const baseWeek = {
      startISO: '2026-07-06', phase: 'BASE',
      days: [
        { type: 'easy', distanceMi: 8, subLabel: 'EASY' },
        { type: 'easy', distanceMi: 8, subLabel: 'EASY · 6×20s strides' },
        { type: 'long', distanceMi: 14, subLabel: 'LONG', isLong: true },
        { type: 'rest', distanceMi: 0, subLabel: null },
      ],
    };
    expect(weekDosingFindings(baseWeek as never)).toEqual([]);

    // A percentage of zero is zero · reporting "0 mi at T exceeds 0 mi" is noise.
    expect(weekDosingFindings({ startISO: '2026-07-06', phase: 'BASE', days: [
      { type: 'rest', distanceMi: 0, subLabel: null },
    ] } as never)).toEqual([]);
  });

  it('carries the context per finding rather than suppressing whole weeks', () => {
    // Research/08 §9.1 — a taper holds intensity while volume falls, so its
    // percentages rise by design. That is a different FACT from a build week
    // over its cap, and CLAUDE.md §"Per-finding context filters" says the
    // distinction belongs on the finding, not in a whole-week guard.
    const days = [
      { type: 'easy', distanceMi: 5, subLabel: 'EASY' },
      { type: 'threshold', distanceMi: 9, subLabel: '4×1mi @ T pace · 60s jog' },
      { type: 'easy', distanceMi: 5, subLabel: 'EASY' },
      { type: 'long', distanceMi: 11, subLabel: 'LONG', isLong: true },
    ];
    expect(weekDosingFindings({ startISO: '2026-07-06', phase: 'TAPER', days } as never)[0].context).toBe('taper');
    expect(weekDosingFindings({ startISO: '2026-07-06', phase: 'TAPER', days, isRaceWeek: true } as never)[0].context)
      .toBe('race-week');
    expect(weekDosingFindings({ startISO: '2026-07-06', phase: 'QUALITY', days } as never)[0].context).toBe('training');
  });

  it('binds the absolute ceilings that a share cap stops protecting', () => {
    // 8% of a 100 mi week is 8 miles of VO2 work. Doctrine's "max 10K
    // cumulative" (6.21 mi) forbids it, and the percentage alone would not.
    const week = {
      startISO: '2026-07-06', phase: 'QUALITY',
      days: [
        { type: 'easy', distanceMi: 46, subLabel: 'EASY' },
        { type: 'intervals', distanceMi: 12, subLabel: '8×1mi @ I pace · 90s jog' },
        { type: 'easy', distanceMi: 22, subLabel: 'EASY' },
        { type: 'long', distanceMi: 20, subLabel: 'LONG', isLong: true },
      ],
    };
    const f = weekDosingFindings(week as never);
    expect(f.some((x) => x.pace === 'I' && x.scope === 'cumulative')).toBe(true);
    expect(CUMULATIVE_CEILING_KM.I).toBe(10);
    expect(CUMULATIVE_CEILING_KM.R).toBe(8);
    // Doctrine states no cumulative ceiling for T or M · the engine must not invent one.
    expect(CUMULATIVE_CEILING_KM.T).toBeUndefined();
    expect(CUMULATIVE_CEILING_KM.M).toBeUndefined();
  });

  it('caps a marathon-pace workout at the lesser of 18 mi and 20% of the week', () => {
    expect(MARATHON_PACE_WORKOUT_CAP).toEqual({ absMi: 18, pctOfWeekly: 0.20 });
    // Doctrine writes "n/a" in M's weekly column · the engine records the
    // silence rather than inventing a weekly cap for marathon pace.
    expect(weeklyShareCap('M')).toBeNull();
    expect(weeklyShareCap('T')).toBe(0.10);
    expect(weeklyShareCap('I')).toBe(0.08);
    expect(weeklyShareCap('R')).toBe(0.05);

    // 20% binds on a small week; the 18 mi ceiling binds on a big one.
    const mk = (weekMi: number, mpMi: number) => weekDosingFindings({
      startISO: '2026-07-06', phase: 'RACE-SPECIFIC',
      days: [
        { type: 'easy', distanceMi: weekMi - 20, subLabel: 'EASY' },
        { type: 'long', distanceMi: 20, subLabel: `LONG · ${mpMi}mi @ MP`, isLong: true },
      ],
    } as never).filter((x) => x.pace === 'M');

    expect(mk(50, 12).length).toBe(1);          // 12 > 20% of 50 = 10
    expect(mk(50, 9).length).toBe(0);           // 9 < 10
    expect(mk(120, 19)[0]?.capMi).toBe(18);     // 20% of 120 = 24, but 18 wins
  });
});

describe('DOCTRINE-DOSING-2 · the gate is FATAL, and the composer never reaches it', () => {
  it('validateComposedPlan passes a composed plan and reports the taper exemptions', () => {
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: 'marathon', experienceLevel: 'advanced',
      weeklyMileageBucket: 45, weeklyFrequency: 6, planWeeks: 18,
      goalTimeSec: GOAL_SEC.marathon, longestRunBucket: '10+',
    } as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // This archetype used to breach the weekly T cap; the composer now sizes
    // to the same budget the gate checks, so validation passes with the caps
    // FATAL. Both call shapes must behave identically — enforcement is
    // unconditional, not something the caller opts into.
    const seen: DosingFinding[] = [];
    expect(() =>
      validateComposedPlan(r.composed, r.raceDistanceMi, r.mode, r.validateCtx, {
        onDosing: (f) => seen.push(...f),
      }),
    ).not.toThrow();
    expect(() => validateComposedPlan(r.composed, r.raceDistanceMi, r.mode, r.validateCtx)).not.toThrow();

    // What IS reported is the taper's percentage findings — Research/08 §9.1
    // holds intensity while volume falls, so the share rises by design. They
    // are visible and non-fatal, which is the whole point of keeping the sink.
    for (const f of seen) {
      expect(f.enforced, `a fatal finding survived composition: ${f.message}`).toBe(false);
      expect(['taper', 'race-week']).toContain(f.context);
      expect(f.basis).toBe('percentage');
    }
  });

  it('a hand-built violating week is REJECTED, not merely reported', () => {
    // The gate has to be able to say no, or the zero above proves nothing. This
    // is the two-legal-sessions week from the attribution suite, asserted at the
    // validator rather than at the detector.
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: 'marathon', experienceLevel: 'advanced',
      weeklyMileageBucket: 45, weeklyFrequency: 6, planWeeks: 18,
      goalTimeSec: GOAL_SEC.marathon, longestRunBucket: '10+',
    } as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const wk = r.composed.weeks.find((w: { phase: string; isRaceWeek?: boolean }) =>
      w.phase === 'QUALITY' && !w.isRaceWeek);
    expect(wk).toBeTruthy();
    if (!wk) return;
    // Give the week a second threshold session at a full doctrinal dose. Nothing
    // else moves, so the only thing that can fail is the dosing cap.
    // TIEREVIDENCE-2 (2026-09-02) · the LARGEST easy day, not the first one.
    // The dose the validator counts for a session is bounded by the day's own
    // distance, so converting a 3-mile recovery day into "5x1mi @ T" adds three
    // miles at T, not five. That was enough to violate while this fixture
    // composed against `TIER_TARGETS.m.advanced` — a row it reached because it
    // typed `experienceLevel: 'advanced'`; on the evidence it carries (none: no
    // `bestRecentVdotOverride`) it composes against a smaller row, its easy days
    // are shorter, and the hand-built week stopped violating. The case is about
    // the validator being ABLE to say no, so it hands it a session big enough
    // to be the violation it names.
    const victim = wk.days
      .filter((d: { type: string }) => d.type === 'easy')
      .sort((a: { distanceMi: number }, b: { distanceMi: number }) => b.distanceMi - a.distanceMi)[0];
    expect(victim).toBeTruthy();
    if (!victim) return;
    victim.type = 'threshold';
    victim.isQuality = true;
    victim.subLabel = '5×1mi @ T pace · 60s jog';

    let err: unknown;
    try { validateComposedPlan(r.composed, r.raceDistanceMi, r.mode, r.validateCtx); }
    catch (e) { err = e; }
    expect(err).toBeInstanceOf(PlanValidationError);
    expect((err as PlanValidationError).violations.some((v) => /mi at T/.test(v))).toBe(true);
  });
});

describe('DOCTRINE-DOSING-1 · corpus census', () => {
  it('measures the archetype matrix and holds the ratchet', () => {
    let archetypes = 0;
    let breaching = 0;
    const findings: DosingFinding[] = [];

    // ULTRA-OUT-1 (2026-08-19) · '50k' left this corpus with ultra authorship.
    // `buildSimPlan` now refuses it, so its 36 archetypes were being silently
    // skipped by the `if (!r.ok) continue` below — a census quietly measuring
    // 144 rows while its own gate asserted more than 150. Removed from the list
    // rather than left to be skipped, and the gate below now asserts the EXACT
    // matrix size so a shrinking corpus can never hide behind an inequality.
    const CORPUS_DISTANCES = ['5k', '10k', 'half', 'marathon'] as SimDistance[];
    const CORPUS_SIZE = 4 * 3 * 4 * 3;
    for (const distance of CORPUS_DISTANCES) {
      for (const experienceLevel of ['beginner', 'intermediate', 'advanced'] as const) {
        for (const weeklyMileageBucket of [15, 25, 35, 45]) {
          for (const weeklyFrequency of [4, 5, 6]) {
            const r = buildSimPlan({
              ...base, goalMode: 'goal', distance, experienceLevel, weeklyMileageBucket,
              weeklyFrequency, planWeeks: WEEKS[distance], goalTimeSec: GOAL_SEC[distance],
              longestRunBucket: weeklyMileageBucket >= 35 ? '10+' : '6-10',
            } as any);
            if (!r.ok) continue;
            archetypes++;
            const f = planDosingFindings(r.composed.weeks as never);
            if (f.length) breaching++;
            findings.push(...f);
          }
        }
      }
    }

    const byCtx = summarizeDosing(findings);
    const byPaceScope: Record<string, number> = {};
    for (const f of findings) {
      const k = `${f.pace}/${f.scope}`;
      byPaceScope[k] = (byPaceScope[k] ?? 0) + 1;
    }
    console.log(
      `\n=== DOSING · ${breaching}/${archetypes} archetypes breach · ${findings.length} findings ===\n` +
        `  by context: ${JSON.stringify(byCtx)}\n` +
        `  by cap:     ${JSON.stringify(byPaceScope)}\n`,
    );

    // Every finding is well-formed · a detector that reports a breach it cannot
    // substantiate is worse than no detector.
    for (const f of findings) {
      expect(f.doseMi).toBeGreaterThan(f.capMi);
      expect(f.overByMi).toBeGreaterThan(0);
      expect(f.weeklyMi).toBeGreaterThan(0);
      expect(['training', 'taper', 'race-week']).toContain(f.context);
    }

    // ── THE GATE · ZERO, not a ratchet ──────────────────────────────────────
    //
    // This landed as a ratchet at 1750 findings across 178 of 180 archetypes,
    // on the reasoning that enforcing the caps was the owner's call. He made
    // it, and the composer was fixed rather than the detector loosened: the
    // type mixes stopped running two sessions of one pace family, the day
    // sizers spend a weekly budget instead of a per-session one, and
    // `applyDosingCaps` reconciles after every pass that moves mileage.
    //
    // What must be zero is every ENFORCED finding — the absolute ceilings in
    // any week, the percentage caps on training weeks. The percentage findings
    // that remain are all in tapers and race weeks, where Research/08 §9.1
    // holds intensity while volume falls and §9.2 prescribes doses outside the
    // percentage by name; `capEnforced` carries that reasoning and
    // DOSING.taper-percentage-exemption binds it to the doc.
    // Every archetype in the matrix must BUILD · a refusal here is a plan the
    // engine owes a runner and did not write, and it must not be absorbed by a
    // greater-than.
    expect(archetypes).toBe(CORPUS_SIZE);
    const enforced = findings.filter((f) => f.enforced);
    expect(
      enforced.length,
      `${enforced.length} enforced dosing breaches the composer should never have authored:\n` +
        enforced.slice(0, 8).map((f) => `  · ${f.phase} ${f.weekStartISO}: ${f.message}`).join('\n'),
    ).toBe(0);
    // And no TRAINING week may carry a percentage finding at all — that is the
    // same statement from the other side, and it is the number that was 1547.
    expect(summarizeDosing(findings).training).toBe(0);
  }, 120_000);
});
