/**
 * coach-goal.test.ts · the coach-set A/B/C derivation, the personal Riegel
 * exponent fit, the marathon-specificity gating, and the framings that carry
 * no time at all.
 *
 * Doctrine under test:
 *   · Research/20 §Daniels' A/B/C tiered race goals (probability bands)
 *   · Research/02 §11.4 (two-point exponent fit) + §14 rule 3
 *   · Research/02 §13.1 :382 (+5% one-sided marathon specificity) + A5
 *   · Research/02 §13.7 (CI half-widths that size A and C)
 *   · Research/11 §Pacing Rule for Hilly Courses (effort, not pace)
 *   · The standing rule: a runner-stated goal is untouchable.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveCoachGoal,
  fitPersonalExponent,
  predictWithPersonalExponent,
  courseIsHilly,
  gradeCourse,
  hillAdjustmentSec,
  inferDistanceMiFromNameOrSlug,
  EXPONENT_FIT_WINDOW_DAYS,
  PERSONAL_EXPONENT_MIN,
  PERSONAL_EXPONENT_MAX,
  HILLY_GAIN_FT_PER_MI,
  STEEP_GAIN_FT_PER_MI,
  HILL_RATE_SEC_PER_MI_PER_100FT,
  HILL_EFFORT_LINE,
  type ExponentFitRace,
} from './coach-goal';
import { goalFramingCard, gradeGetsTheAsk, isGoalFraming } from './goal-framing';
import { predictRaceTime } from '@/lib/training/vdot';
import { marathonSpecificityAdjustment, MARATHON_SPECIFICITY_PENALTY_PCT } from '@/lib/training/goal-projection';
import { roundTargetSec } from './effective-race-target';

const TODAY = '2026-08-28';
const TENK = 6.21371;
const FIVEK = 3.10686;
const HM = 13.1094;
const M = 26.2188;

function fitRace(over: Partial<ExponentFitRace>): ExponentFitRace {
  return {
    slug: 'r', name: 'R', date: '2026-08-01', distance_mi: TENK,
    finish_seconds: 2500, priority: 'B', provisional: false,
    runner_authority_tier: null, hilly: false,
    ...over,
  };
}

describe('deriveCoachGoal · stated-goal untouchability', () => {
  it('refuses whenever a stated goal exists, whatever else is true', () => {
    for (const priority of ['A', 'B', 'C', null]) {
      const r = deriveCoachGoal({
        statedGoalSec: 3 * 3600, priority, distanceMi: M, hilly: true,
        vdot: 50, vdotAnchorDistanceMi: HM, todayISO: TODAY,
      });
      expect(r).toBeNull();
    }
  });
});

describe('deriveCoachGoal · time-less framings', () => {
  it('a C race gets an effort framing, never a time', () => {
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'C', distanceMi: TENK,
      vdot: 50, todayISO: TODAY,
    });
    expect(r?.kind).toBe('effort');
    if (r?.kind === 'effort') {
      expect(r.reason).toBe('c_priority');
      expect(r.coachSet).toBe(true);
      // Coach voice: no exclamation marks, no em dashes, no emoji.
      expect(r.line).not.toMatch(/[!—\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it('a hilly course gets effort framing, never a flat-equivalent time', () => {
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'B', distanceMi: TENK, hilly: true,
      vdot: 50, todayISO: TODAY,
    });
    expect(r?.kind).toBe('effort');
    if (r?.kind === 'effort') expect(r.reason).toBe('hilly');
  });

  it('C beats hilly for the reason label (Dodgers is both)', () => {
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'C', distanceMi: FIVEK, hilly: true,
      vdot: 50, todayISO: TODAY,
    });
    expect(r?.kind).toBe('effort');
    if (r?.kind === 'effort') expect(r.reason).toBe('c_priority');
  });
});

describe('deriveCoachGoal · A/B/C bands (fixed VDOT in, expected bands out)', () => {
  it('B is the equivalent-fitness prediction; A and C are one CI half-width off', () => {
    const vdot = 50;
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'B', distanceMi: TENK,
      vdot, vdotAnchorDistanceMi: TENK, todayISO: TODAY,
    });
    expect(r?.kind).toBe('time');
    if (r?.kind !== 'time') return;
    const base = predictRaceTime(vdot, TENK)!;
    // Same-distance anchor at 10K → §13.7 same-distance default: ±2.0%.
    expect(r.ciPct).toBe(2.0);
    expect(r.bSec).toBe(roundTargetSec(base));
    expect(r.aSec).toBe(roundTargetSec(base * 0.98));
    expect(r.cSec).toBe(roundTargetSec(base * 1.02));
    expect(r.aSec).toBeLessThan(r.bSec);
    expect(r.bSec).toBeLessThan(r.cSec);
    expect(r.modelled).toBe(true);
    expect(r.coachSet).toBe(true);
    expect(r.specificityAdjustedPct).toBeNull();
    expect(r.method).toBe('daniels-vdot');
    expect(r.vdotBasis).toBe(vdot);
  });

  it('no evidence at all → null, never a fabricated goal', () => {
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'B', distanceMi: TENK,
      vdot: null, todayISO: TODAY,
    });
    expect(r).toBeNull();
  });

  it('an ultra distance → null (no honest Daniels band to set)', () => {
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'B', distanceMi: 31.07,
      vdot: 50, todayISO: TODAY,
    });
    expect(r).toBeNull();
  });
});

describe('deriveCoachGoal · marathon specificity (Research/02 §13.1 :382 + A5)', () => {
  it('HM anchor, no block: A = raw equivalence, B carries +5%, C = B + the ±3% row', () => {
    const vdot = 46;
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'A', distanceMi: M,
      vdot, vdotAnchorDistanceMi: HM, marathonSpecificTraining: false,
      todayISO: TODAY,
    });
    expect(r?.kind).toBe('time');
    if (r?.kind !== 'time') return;
    const base = predictRaceTime(vdot, M)!;
    expect(r.specificityAdjustedPct).toBe(MARATHON_SPECIFICITY_PENALTY_PCT);
    expect(r.aSec).toBe(roundTargetSec(base));
    expect(r.bSec).toBe(roundTargetSec(base * 1.05));
    expect(r.ciPct).toBe(3.0); // §13.7 "Half → marathon, marathon-trained ±3%"
    expect(r.cSec).toBe(roundTargetSec(roundTargetSec(base * 1.05) * 1.03));
  });

  it('10K anchor, no block: one-sided ±10% row shapes C', () => {
    const vdot = 46;
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'A', distanceMi: M,
      vdot, vdotAnchorDistanceMi: TENK, marathonSpecificTraining: null,
      todayISO: TODAY,
    });
    expect(r?.kind).toBe('time');
    if (r?.kind !== 'time') return;
    const base = predictRaceTime(vdot, M)!;
    expect(r.oneSided).toBe(true);
    expect(r.ciPct).toBe(10.0);
    expect(r.aSec).toBe(roundTargetSec(base));
    expect(r.bSec).toBe(roundTargetSec(base * 1.05));
    expect(r.cSec).toBe(roundTargetSec(base * 1.10));
  });

  it('block in place: no adjustment, symmetric band around the equivalence', () => {
    const vdot = 46;
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'A', distanceMi: M,
      vdot, vdotAnchorDistanceMi: HM, marathonSpecificTraining: true,
      todayISO: TODAY,
    });
    expect(r?.kind).toBe('time');
    if (r?.kind !== 'time') return;
    const base = predictRaceTime(vdot, M)!;
    expect(r.specificityAdjustedPct).toBeNull();
    expect(r.bSec).toBe(roundTargetSec(base));
    expect(r.aSec).toBe(roundTargetSec(base * 0.97));
    expect(r.cSec).toBe(roundTargetSec(base * 1.03));
  });
});

describe('marathonSpecificityAdjustment · gating', () => {
  it('fires only for marathon target + sub-marathon anchor + no established block', () => {
    expect(marathonSpecificityAdjustment(M, HM, null)).toEqual({ pct: 5, oneSided: true });
    expect(marathonSpecificityAdjustment(M, TENK, false)).toEqual({ pct: 5, oneSided: true });
    expect(marathonSpecificityAdjustment(M, FIVEK, null)).toEqual({ pct: 5, oneSided: true });
    expect(marathonSpecificityAdjustment(M, HM, true)).toBeNull();   // block in place
    expect(marathonSpecificityAdjustment(HM, TENK, null)).toBeNull(); // not a marathon
    expect(marathonSpecificityAdjustment(M, M, null)).toBeNull();     // marathon evidence
    expect(marathonSpecificityAdjustment(M, null, null)).toBeNull();  // unknown anchor
  });
});

describe('fitPersonalExponent · Research/02 §11.4', () => {
  it('two qualifying races → the known b', () => {
    // 20:00 5K + 41:40 10K: b = ln(2500/1200)/ln(2) ≈ 1.0590.
    const fit = fitPersonalExponent([
      fitRace({ slug: '5k', date: '2026-08-10', distance_mi: FIVEK, finish_seconds: 1200 }),
      fitRace({ slug: '10k', date: '2026-08-20', distance_mi: TENK, finish_seconds: 2500 }),
    ], TODAY);
    expect(fit).not.toBeNull();
    const expected = Math.log(2500 / 1200) / Math.log(TENK / FIVEK);
    expect(fit!.b).toBeCloseTo(expected, 3);
    expect(fit!.b).toBeGreaterThanOrEqual(PERSONAL_EXPONENT_MIN);
    expect(fit!.b).toBeLessThanOrEqual(PERSONAL_EXPONENT_MAX);
    // Projection to the half uses the fitted b off the nearer race (the 10K).
    const hm = predictWithPersonalExponent(fit!, HM);
    expect(hm).toBe(Math.round(2500 * Math.pow(HM / TENK, fit!.b)));
  });

  it('rejects: a lone race, C races, provisional times, hilly courses, stale races', () => {
    const good = fitRace({ slug: 'good', date: '2026-08-20', distance_mi: FIVEK, finish_seconds: 1200 });
    expect(fitPersonalExponent([good], TODAY)).toBeNull();
    expect(fitPersonalExponent([good, fitRace({ priority: 'C' })], TODAY)).toBeNull();
    expect(fitPersonalExponent([good, fitRace({ provisional: true })], TODAY)).toBeNull();
    expect(fitPersonalExponent([good, fitRace({ hilly: true })], TODAY)).toBeNull();
    expect(fitPersonalExponent([good, fitRace({ runner_authority_tier: 'compromised' })], TODAY)).toBeNull();
    const staleDate = new Date(Date.parse(TODAY + 'T12:00:00Z') - (EXPONENT_FIT_WINDOW_DAYS + 5) * 86400000)
      .toISOString().slice(0, 10);
    expect(fitPersonalExponent([good, fitRace({ date: staleDate })], TODAY)).toBeNull();
  });

  it('rejects near-duplicate distances (noise amplification) and out-of-band exponents', () => {
    // 5K + 4mi: distance ratio 1.29 < 1.5 → no fit.
    expect(fitPersonalExponent([
      fitRace({ date: '2026-08-20', distance_mi: FIVEK, finish_seconds: 1200 }),
      fitRace({ date: '2026-08-15', distance_mi: 4.0, finish_seconds: 1600 }),
    ], TODAY)).toBeNull();
    // A 10K barely slower than the 5K → absurd flat exponent → rejected,
    // not clamped.
    expect(fitPersonalExponent([
      fitRace({ date: '2026-08-20', distance_mi: FIVEK, finish_seconds: 1200 }),
      fitRace({ date: '2026-08-15', distance_mi: TENK, finish_seconds: 1300 }),
    ], TODAY)).toBeNull();
  });

  it('feeds deriveCoachGoal as method personal-exponent', () => {
    const fit = fitPersonalExponent([
      fitRace({ slug: '5k', date: '2026-08-10', distance_mi: FIVEK, finish_seconds: 1200 }),
      fitRace({ slug: '10k', date: '2026-08-20', distance_mi: TENK, finish_seconds: 2500 }),
    ], TODAY);
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'B', distanceMi: HM,
      vdot: 50, vdotAnchorDistanceMi: TENK, exponentFit: fit,
      todayISO: TODAY,
    });
    expect(r?.kind).toBe('time');
    if (r?.kind !== 'time') return;
    expect(r.method).toBe('personal-exponent');
    expect(r.personalExponent).toBe(fit!.b);
    const base = predictWithPersonalExponent(fit!, HM)!;
    // 10K → half span: §13.7 ±2.5%, and it beats the HM same-distance 2.5 tie.
    expect(r.bSec).toBe(roundTargetSec(base));
    expect(r.ciPct).toBe(2.5);
  });
});

describe('display-default helpers', () => {
  it('infers a distance from name/slug patterns only when the row has none', () => {
    expect(inferDistanceMiFromNameOrSlug(null, 'santa-monica-10k-2026-09-13')).toBeCloseTo(TENK, 3);
    expect(inferDistanceMiFromNameOrSlug('Run Malibu Half', 'run-malibu-2026-11-08')).toBeCloseTo(HM, 3);
    expect(inferDistanceMiFromNameOrSlug('California International Marathon', 'cim')).toBeCloseTo(M, 3);
    expect(inferDistanceMiFromNameOrSlug('Turkey Trot 5K', null)).toBeCloseTo(FIVEK, 3);
    expect(inferDistanceMiFromNameOrSlug('Backyard 50K', null)).toBeNull();
    expect(inferDistanceMiFromNameOrSlug('Dodgers Foundation Run', 'dodgers-run')).toBeNull();
  });

  it('courseIsHilly: explicit terrain wins, else measured gain per mile, else no', () => {
    expect(courseIsHilly({ metaTerrain: 'hilly' })).toBe(true);
    expect(courseIsHilly({ metaTerrain: 'Rolling hills' })).toBe(true);
    expect(courseIsHilly({ elevationGainFt: 200, distanceMi: TENK })).toBe(true);  // 32 ft/mi
    expect(courseIsHilly({ elevationGainFt: 80, distanceMi: TENK })).toBe(false);  // 13 ft/mi
    expect(courseIsHilly({})).toBe(false); // unknown terrain is not hilly
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GOALFRAME-1 · the course bands (Research/02 §13.2, David 2026-08-28)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('gradeCourse · §13.2 tiers read per mile', () => {
  it('classifies by measured gain per mile against the 19 and 57 ft/mi boundaries', () => {
    const at = (perMi: number) =>
      gradeCourse({ elevationGainFt: perMi * TENK, distanceMi: TENK }).grade;
    expect(at(HILLY_GAIN_FT_PER_MI - 5)).toBe('flat');
    expect(at(HILLY_GAIN_FT_PER_MI)).toBe('rolling');       // floor is inclusive
    expect(at(32.5)).toBe('rolling');                        // Santa Monica territory
    expect(at(STEEP_GAIN_FT_PER_MI - 1)).toBe('rolling');
    expect(at(STEEP_GAIN_FT_PER_MI)).toBe('steep');          // Mountain floor
    expect(at(90)).toBe('steep');
  });

  it('terrain flags grade but cannot price: gainFtPerMi stays null', () => {
    expect(gradeCourse({ metaTerrain: 'hilly' })).toEqual({
      grade: 'rolling', gainFtPerMi: null, elevationGainFt: null,
    });
    expect(gradeCourse({ metaTerrain: 'mountain trail' }).grade).toBe('steep');
    expect(gradeCourse({}).grade).toBe('flat'); // absence of geometry is not evidence
  });
});

describe('hillAdjustmentSec · §13.2 rule of thumb (2-4 s/mi per 100 ft, gross, no refund)', () => {
  it('reproduces the doc arithmetic at the band floor and scales the rate inside it', () => {
    const gainAtFloor = HILLY_GAIN_FT_PER_MI * TENK;
    const atFloor = hillAdjustmentSec({ elevationGainFt: gainAtFloor, distanceMi: TENK, baseSec: 2755 })!;
    expect(atFloor.ratePer100Ft).toBeCloseTo(HILL_RATE_SEC_PER_MI_PER_100FT[0], 5);
    expect(atFloor.costSec).toBe(Math.round((gainAtFloor / 100) * 2 * TENK));
    // More climb costs more, at a higher rate.
    const mid = hillAdjustmentSec({ elevationGainFt: 202, distanceMi: TENK, baseSec: 2755 })!;
    expect(mid.costSec).toBeGreaterThan(atFloor.costSec);
    expect(mid.ratePer100Ft).toBeGreaterThan(atFloor.ratePer100Ft);
    expect(mid.ratePer100Ft).toBeLessThan(HILL_RATE_SEC_PER_MI_PER_100FT[1]);
  });

  it('never negative, null outside the rolling band', () => {
    expect(hillAdjustmentSec({ elevationGainFt: 0, distanceMi: TENK, baseSec: 2755 })).toBeNull();
    expect(hillAdjustmentSec({ elevationGainFt: -100, distanceMi: TENK, baseSec: 2755 })).toBeNull();
    expect(hillAdjustmentSec({ elevationGainFt: 50, distanceMi: TENK, baseSec: 2755 })).toBeNull();  // flat
    expect(hillAdjustmentSec({ elevationGainFt: 500, distanceMi: TENK, baseSec: 2755 })).toBeNull(); // steep
    expect(hillAdjustmentSec({ elevationGainFt: null, distanceMi: TENK, baseSec: 2755 })).toBeNull();
  });
});

describe('deriveCoachGoal · band matrix (flat / rolling / steep / C)', () => {
  const base = {
    statedGoalSec: null as number | null, priority: 'B', distanceMi: TENK,
    vdot: 50, vdotAnchorDistanceMi: TENK, todayISO: TODAY,
  };
  const rollingCourse = (gainFt: number) =>
    gradeCourse({ elevationGainFt: gainFt, distanceMi: TENK });

  it('flat: unchanged — no adjustment, no effort line', () => {
    const r = deriveCoachGoal({ ...base, course: rollingCourse(80) });
    expect(r?.kind).toBe('time');
    if (r?.kind !== 'time') return;
    expect(r.hillAdjustedSec).toBeNull();
    expect(r.effortLine).toBeNull();
    expect(r.bSec).toBe(roundTargetSec(predictRaceTime(50, TENK)!));
  });

  it('rolling: GRADED time by default — every tier shifted by the hill cost, effort line carried', () => {
    const flat = deriveCoachGoal({ ...base });
    const r = deriveCoachGoal({ ...base, course: rollingCourse(202) });
    expect(r?.kind).toBe('time');
    if (r?.kind !== 'time' || flat?.kind !== 'time') return;
    const raw = predictRaceTime(50, TENK)!;
    const cost = hillAdjustmentSec({ elevationGainFt: 202, distanceMi: TENK, baseSec: raw })!.costSec;
    expect(r.hillAdjustedSec).toBe(cost);
    expect(r.hillGainFtPerMi).toBeCloseTo(32.5, 0);
    expect(r.effortLine).toBe(HILL_EFFORT_LINE);
    expect(r.aSec).toBe(roundTargetSec(raw * 0.98 + cost));
    expect(r.bSec).toBe(roundTargetSec(raw + cost));
    expect(r.cSec).toBe(roundTargetSec(raw * 1.02 + cost));
    expect(r.bSec).toBeGreaterThan(flat.bSec);
    expect(r.line).toContain('graded for the climb');
  });

  it('steep: effort only, whatever the answer says', () => {
    for (const goalFraming of [null, 'time'] as const) {
      const r = deriveCoachGoal({
        ...base, course: rollingCourse(STEEP_GAIN_FT_PER_MI * TENK + 50), goalFraming,
      });
      expect(r?.kind).toBe('effort');
      if (r?.kind === 'effort') expect(r.reason).toBe('hilly');
    }
  });

  it('C beats the band: a rolling C race is still effort, c_priority', () => {
    const r = deriveCoachGoal({ ...base, priority: 'C', course: rollingCourse(202) });
    expect(r?.kind).toBe('effort');
    if (r?.kind === 'effort') expect(r.reason).toBe('c_priority');
  });

  it('a stated goal beats everything, rolling included', () => {
    expect(deriveCoachGoal({
      ...base, statedGoalSec: 2700, course: rollingCourse(202),
    })).toBeNull();
  });

  it('rolling with no measured gain (terrain flag only) → effort, never a fabricated number', () => {
    const r = deriveCoachGoal({ ...base, course: gradeCourse({ metaTerrain: 'hilly' }) });
    expect(r?.kind).toBe('effort');
  });
});

describe('deriveCoachGoal · the goalFraming answer (races.meta.goalFraming)', () => {
  const base = {
    statedGoalSec: null, priority: 'B', distanceMi: TENK,
    vdot: 50, vdotAnchorDistanceMi: TENK, todayISO: TODAY,
    course: gradeCourse({ elevationGainFt: 202, distanceMi: TENK }),
  };

  it("unanswered → the graded default stands", () => {
    const r = deriveCoachGoal({ ...base, goalFraming: null });
    expect(r?.kind).toBe('time');
    if (r?.kind === 'time') expect(r.hillAdjustedSec).not.toBeNull();
  });

  it("'time' confirms the graded numbers", () => {
    const r = deriveCoachGoal({ ...base, goalFraming: 'time' });
    expect(r?.kind).toBe('time');
  });

  it("'effort' flips the framing to effort-only", () => {
    const r = deriveCoachGoal({ ...base, goalFraming: 'effort' });
    expect(r?.kind).toBe('effort');
    if (r?.kind === 'effort') expect(r.reason).toBe('hilly');
  });

  it('an arbitrary jsonb string is ignored, not honored', () => {
    const r = deriveCoachGoal({ ...base, goalFraming: 'banana' });
    expect(r?.kind).toBe('time');
    expect(isGoalFraming('banana')).toBe(false);
    expect(isGoalFraming('time')).toBe(true);
    expect(isGoalFraming('effort')).toBe(true);
  });

  it('the answer is scoped to the rolling band: flat ignores it', () => {
    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'B', distanceMi: TENK,
      vdot: 50, vdotAnchorDistanceMi: TENK, todayISO: TODAY,
      course: gradeCourse({ elevationGainFt: 50, distanceMi: TENK }),
      goalFraming: 'effort',
    });
    expect(r?.kind).toBe('time'); // no hills to frame
  });
});

describe('Santa Monica 10K · the live fixture (202 ft, ~32 ft/mi, B, no stated goal)', () => {
  it('grades rolling and prices ~34 s over the flat equivalence', () => {
    const graded = gradeCourse({ elevationGainFt: 202, distanceMi: TENK });
    expect(graded.grade).toBe('rolling');
    expect(graded.gainFtPerMi!).toBeCloseTo(32.5, 0);
    // The doc's own arithmetic: 202 ft at a band-scaled ~2.7 s/mi per 100 ft
    // over 6.21 miles ≈ 34 s — B lands mid-46s off a flat ~45:55.
    const adj = hillAdjustmentSec({ elevationGainFt: 202, distanceMi: TENK, baseSec: 2755 })!;
    expect(adj.costSec).toBe(34);
    expect(adj.ratePer100Ft).toBeCloseTo(2.71, 1);
    // Applied to the flat-equivalent 45:55: B = 46:29 → rounded 46:30,
    // inside the owner's expected 46:20-46:40 window.
    expect(roundTargetSec(2755 + adj.costSec)).toBe(2790);
  });

  it('the ask card carries the exact copy contract', () => {
    const card = goalFramingCard({
      raceName: 'Santa Monica', distanceLabel: '10k',
      elevationGainFt: 202, gainFtPerMi: 202 / TENK,
    });
    expect(card.title).toBe('Santa Monica 10k. Time or effort?');
    expect(card.acceptVerb).toBe('RACE THE NUMBER');
    expect(card.keepVerb).toBe('KEEP IT ON EFFORT');
    expect(card.body).toContain('202 ft of climb');
    expect(card.body).toContain('Leave this and the graded numbers stand');
    // Coach voice: no hype, no exclamation marks, no emoji, no em dashes.
    expect(card.body).not.toMatch(/[!—\u{1F300}-\u{1FAFF}]/u);
    // A name that already carries its distance is not doubled.
    expect(goalFramingCard({
      raceName: 'Santa Monica 10K', distanceLabel: '10k',
      elevationGainFt: 202, gainFtPerMi: 202 / TENK,
    }).title).toBe('Santa Monica 10K. Time or effort?');
  });

  it('only the rolling band ever gets the ask', () => {
    expect(gradeGetsTheAsk('rolling')).toBe(true);
    expect(gradeGetsTheAsk('flat')).toBe(false);
    expect(gradeGetsTheAsk('steep')).toBe(false);
  });
});
