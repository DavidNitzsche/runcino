/**
 * DAY-SIZE-1 (2026-08-17) · a quality day is warm-up + at-pace work + jog
 * floats + cool-down, not a flat share of weekly volume.
 *
 * The defect, in one sentence: `qualityShare = 0.22` charged a quality day's
 * EASY legs against the intensity budget, so a 55 mi/wk runner whose Daniels
 * cap permitted 5.5 threshold miles was prescribed about three, and the overload
 * trajectory's earned progression was cut back to the same session two weeks
 * running. The day budget had become the binding constraint on the runner's
 * improvement, ahead of every physiological cap in the engine.
 *
 * `lib/doctrine/registry.ts` holds the claims that bind the CONSTANTS to
 * `Research/04`. This file holds the two properties that only show up in a whole
 * composed plan:
 *
 *   1. Relocation, not inflation. The extra easy miles come off the standalone
 *      easy days; the week's total does not move.
 *   2. Consecutive build weeks differ. That is what the whole exercise was for.
 */
import { describe, it, expect } from 'vitest';
import {
  composePlan,
  finalizeComposedPlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type DOW,
} from './generate';
import { buildSimPlan } from './sim-inputs';
import { buildWorkoutSpec, totalDistanceMiFromSpec, tPaceFromGoal } from './spec-builder';
import { tPaceFromVdot } from '@/lib/training/vdot';
import { weekIntensity, EASY_SHARE_FLOOR } from './intensity-distribution';
import { AT_PACE_SESSION_MI, atPaceSessionCapMi } from '@/lib/prescription/levers';
import { composeQualityDay, warmupCooldownMi } from './quality-day';

/** David's CIM block: goal marathon 2026-12-06, authored 2026-08-31, VDOT 44.1. */
function cimBlock(): ComposePlanInput {
  const distanceMi = 26.2;
  const goalSec = 10800;
  const currentT = tPaceFromVdot(44.1);
  const goalT = tPaceFromGoal(goalSec, distanceMi);
  return {
    raceDistanceMi: distanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / distanceMi),
    raceDateISO: '2026-12-06',
    startMondayISO: '2026-08-31',
    level: 'advanced',
    recentWeeklyMi: 45,
    easyDayMedianMi: 6,
    recentLongMi: 14,
    bestRecentVdot: 44.1,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 5 as DOW,
    qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOfPublic(distanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOfPublic(distanceMi)),
    tPaceSec: (goalT != null && currentT != null ? Math.min(goalT, currentT) : goalT) ?? currentT ?? 480,
    lthr: null,
    maxHr: null,
  } as ComposePlanInput;
}

describe('DAY-SIZE-1 · a quality day is sized from its session', () => {
  it('relocates easy miles onto the quality day · it does not add volume', () => {
    // The property the whole change turns on. `layoutWeek` fills the remaining
    // days from `weeklyMi - allocated`, so a bigger quality day makes the
    // standalone easy days smaller by exactly as much. If this ever fails, the
    // change has stopped being a relocation and become a volume increase, which
    // is the wrong shape however good the sessions look.
    const res = composePlan(cimBlock());
    finalizeComposedPlan(res, 26.2, 'advanced');
    for (const [i, w] of res.weeks.entries()) {
      // The race week is excluded by the engine's own convention: `weeklyMi`
      // counts training volume, and the race is the event, not training.
      if (w.isRaceWeek) continue;
      const daySum = w.days.reduce((s, d) => s + (d.distanceMi || 0), 0);
      expect(Math.abs(daySum - w.weeklyMi), `wk${i}: days sum to ${daySum}, week says ${w.weeklyMi}`)
        .toBeLessThan(0.6);
    }
    // And the block as a whole sits where the volume curve put it.
    const total = res.weeks.reduce((s, w) => s + w.weeklyMi, 0);
    const curve = res.vols.reduce((s, v) => s + v, 0);
    expect(Math.abs(total - curve) / curve, 'block volume drifted from the volume curve').toBeLessThan(0.05);
  });

  it('holds every training week at or above the easy-share floor', () => {
    const res = composePlan(cimBlock());
    finalizeComposedPlan(res, 26.2, 'advanced');
    for (const [i, w] of res.weeks.entries()) {
      if (w.isRaceWeek || w.phase === 'TAPER') continue;
      const share = weekIntensity({ days: w.days, phase: w.phase }).easyShare;
      expect(share, `wk${i} (${w.phase}) ran at ${(share * 100).toFixed(1)}% easy`)
        .toBeGreaterThanOrEqual(EASY_SHARE_FLOOR - 0.005);
    }
  });

  it('consecutive build weeks prescribe different threshold sessions', () => {
    // The symptom that started this. Weeks 5 and 6 of the block rendered
    // IDENTICALLY — the trajectory earned 3x13 min and then 2x20 min, and the
    // day budget cut both back to the 26 minutes it could afford. A deload week
    // repeating the week before it is correct (doctrine §2's W4 holds the
    // stimulus), so only NON-deload neighbours are compared.
    const res = composePlan(cimBlock());
    finalizeComposedPlan(res, 26.2, 'advanced');
    const labels: Array<{ wk: number; label: string; cutback: boolean }> = [];
    for (const [i, w] of res.weeks.entries()) {
      if (w.phase !== 'QUALITY') continue;
      const th = w.days.find((d) => d.isQuality && d.type === 'threshold');
      if (th) labels.push({ wk: i, label: String(th.subLabel), cutback: Boolean(w.isCutback) });
    }
    expect(labels.length).toBeGreaterThan(2);
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].cutback) continue;
      expect(
        labels[i].label,
        `wk${labels[i].wk} repeats wk${labels[i - 1].wk} verbatim — the day budget is binding again`,
      ).not.toBe(labels[i - 1].label);
    }
  });

  it('the rendered label and the spec the watch runs agree on the session', () => {
    // Sizing the day from the session only helps if the spec built from that
    // day matches the label. This is the drift class the codebase has fixed
    // twice; the change touches both sides of it, so it is asserted here.
    const input = cimBlock();
    const res = composePlan(input);
    finalizeComposedPlan(res, 26.2, 'advanced');
    for (const w of res.weeks) {
      const weekT = (w as { tPaceSec?: number | null }).tPaceSec ?? input.tPaceSec;
      if (weekT == null) continue;
      for (const d of w.days) {
        if (!d.isQuality || d.type === 'race') continue;
        // The race-week tune-up keeps the pre-existing share-based budget
        // (Research/08 sizes it as a 3-5mi sharpener, capped independently), so
        // its half-mile of spec slack is not this change's to assert on.
        if (d.type === 'race_week_tuneup') continue;
        const built = buildWorkoutSpec(
          d.type, d.distanceMi, weekT, null, d.subLabel, null, input.goalPaceSec ?? null, null,
        );
        const total = totalDistanceMiFromSpec(built.spec, d.distanceMi);
        expect(Math.abs(total - d.distanceMi), `${w.startISO} ${d.type} "${d.subLabel}" spec ${total} vs day ${d.distanceMi}`)
          .toBeLessThan(0.35);
        const s = built.spec as Record<string, unknown> | null;
        if (!s) continue;
        // A rep count in the label is the rep count in the spec.
        const m = String(d.subLabel ?? '').match(/^(\d+)\s*[×xX]/);
        if (m && Number(s.rep_count ?? 0) > 0) {
          expect(Number(s.rep_count), `"${d.subLabel}" built ${s.rep_count} reps`).toBe(Number(m[1]));
        }
        // A tempo block declared in the label is the block in the spec.
        const t = String(d.subLabel ?? '').match(/^(\d+(?:\.\d+)?)mi\s+\D/);
        if (t && String(s.kind) === 'tempo') {
          expect(Number(s.tempo_distance_mi), `"${d.subLabel}" built a ${s.tempo_distance_mi}mi block`)
            .toBeCloseTo(Number(t[1]), 1);
        }
      }
    }
  });

  it('degrades sensibly for a low-mileage runner', () => {
    // The brief's explicit constraint: a 20 mi/wk runner cannot spend 4-6 miles
    // on a warm-up and cool-down, and the quality day must not swallow the week.
    for (const family of ['threshold', 'interval'] as const) {
      const small = atPaceSessionCapMi(20, family);
      const legs = warmupCooldownMi(family, small);
      const full = warmupCooldownMi(family, AT_PACE_SESSION_MI[family].min);
      expect(legs.warmupMi, `${family} warm-up did not scale down`).toBeLessThan(full.warmupMi);
      expect(legs.warmupMi, `${family} lost its warm-up entirely`).toBeGreaterThan(0);
      expect(legs.cooldownMi, `${family} lost its cool-down entirely`).toBeGreaterThan(0);
      const day = composeQualityDay({ family, atPaceMi: small });
      expect(day.dayMi / 20, `${family} quality day is ${day.dayMi}mi of a 20mi week`).toBeLessThan(0.3);
    }
  });

  it('a 20 mi/wk stated-frequency plan keeps every easy day a real run', () => {
    // The failure mode the week-budget ceiling exists for: doctrine's legs
    // taken out of a small week's easy days until one of them is a mile.
    const r = buildSimPlan({
      goalMode: 'goal', distance: 'half', experienceLevel: 'beginner',
      weeklyMileageBucket: 15, weeklyFrequency: 5, planWeeks: 12, goalTimeSec: 7800,
      longestRunBucket: '3-6', longRunDay: 'sun', restDay: 'sat',
      startDateISO: '2026-07-06', raceDateISO: '', lastRaceFinishedDaysAgo: 0,
      lastRaceDistance: null, raceHistory: [], availableDays: [],
    } as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const w of r.composed.weeks) {
      if (w.isRaceWeek) continue;
      const runs = w.days.filter((d) => d.type !== 'rest' && d.distanceMi > 0);
      const longMi = Math.max(0, ...runs.filter((d) => d.isLong).map((d) => d.distanceMi));
      const rest = runs.reduce((s, d) => s + d.distanceMi, 0) - longMi;
      // Only assert where the week could actually have afforded it.
      if (runs.length > 1 && rest >= 2 * (runs.length - 1)) {
        for (const d of runs) {
          // Easy days only. A taper tune-up is deliberately short — Research/08
          // sizes it as a 3-5mi sharpener and the low-volume taper scales that
          // down — and it keeps the pre-existing share-based sizing either way.
          if (d.type !== 'easy') continue;
          expect(d.distanceMi, `${w.startISO} ${d.type} is ${d.distanceMi}mi`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});
