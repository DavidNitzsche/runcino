/**
 * lib/plan/_recovery_block_flags.test.ts · PEAK-NOT-NONBUILDING-1 (2026-09-03)
 *
 * RULE 20 · the authoring side of Rule 8 had no gate, and that is why it
 * shipped.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * `pln_eb73331e19230ad9`, `mode: 'recovery'`, authored the day after the
 * owner's A-race half (Americas Finest City, 2026-08-16, 1:41:53):
 *
 *     weekIdx 0  2026-08-17  is_cutback FALSE  is_peak FALSE
 *     weekIdx 1  2026-08-24  is_cutback FALSE  is_peak TRUE
 *
 * Two weeks of prescribed post-race recovery, and the engine stamped the
 * second one the PEAK WEEK of the block. Measured across all of production on
 * 2026-09-03 (`faff_readonly`), it is not one row: 4 recovery plans, 6 weeks,
 * `is_peak = TRUE` on FOUR of them. Two of those blocks are a single week
 * long, so their ONLY week — a prescribed post-race recovery week — is
 * recorded as the runner's peak.
 *
 * The cause is arithmetic, not a typo. `planWeekFlags` marked the
 * highest-mileage NON-RACE week, and a recovery block is a REVERSE taper:
 * `RECOVERY_WEEKLY_PCT_OF_BASE` rises every week for every distance, so the
 * argmax of a recovery block is always its last week. The rule could not have
 * produced any other answer.
 *
 * ── WHY A GATE AND NOT JUST A FIX ───────────────────────────────────────────
 *
 * Rule 8's READERS were taught about recovery blocks on 2026-09-02/03 —
 * `prescribedNonNormalWeek` (lib/adaptation/canonical/input.ts) reconciles the
 * week flag against `training_plans.mode`, and `weekRowNoStepReason`
 * (lib/plan/progression-pass.ts) gained the RECOVERY phase label. Both are
 * correct. But they are corrections applied to a row that asserts the
 * opposite, and Rule 20's whole argument is that a protection living only in
 * the readers is one new reader away from being absent. The row itself has to
 * be true.
 *
 * ── WHAT THIS GATE ASSERTS ──────────────────────────────────────────────────
 *
 * Driven through the REAL composer (`composeRecoveryPlan`) into the REAL flag
 * writer (`planWeekFlags`), because a gate over invented rows only proves the
 * test agrees with itself (Rule 18).
 *
 *   1 · No week of a recovery block is `is_peak`. A block the plan is easing
 *       through has no peak week.
 *   2 · Every week of a recovery block is recognisable as prescribed-non-normal
 *       by the canonical resolvers, so no reader has to know it is looking at
 *       one. Both rungs are checked: the phase label
 *       (`isNonBuildingPhaseLabel`) and the shared predicate
 *       (`weekRowNoStepReason`), which must answer RECOVERY rather than null.
 *   3 · The four production rows, replayed as a regression fixture.
 *   4 · LIVENESS (Rule 18 clause 2) · the sweep states how many blocks and
 *       weeks it examined and fails on zero. A gate that reports clean because
 *       it swept nothing is the worst outcome available.
 *
 * ── WHAT THIS GATE DELIBERATELY DOES NOT ASSERT ─────────────────────────────
 *
 * That `is_cutback` is TRUE on a recovery week. It is FALSE on all six
 * production rows and that is CORRECT, for the reason argued at length in
 * `non-building-week.ts`: the column means "a deload inserted INTO a build",
 * `established-cadence.ts` derives the runner's deload CADENCE from the
 * spacing of these flags, and the phase label is the carrier that does not
 * require a boolean to be bent. Rule 8's protection rides on the phase label
 * and on `training_plans.mode`, both of which are present and correct on every
 * production row. Assertion 2 is what makes that load-bearing.
 */

import { describe, it, expect } from 'vitest';
import {
  composeRecoveryPlan,
  planWeekFlags,
  inlinePrescriptions,
  type ComposeNonRaceInput,
  type DOW,
} from './generate';
import { isNonBuildingPhaseLabel } from './non-building-week';
import { weekRowNoStepReason } from './progression-pass';
import type { GoalTier } from './goal-tiers';

const SM = '2026-01-05'; // a Monday

function recoveryInput(o: {
  tier: GoalTier;
  raceMi: number;
  priority?: 'A' | 'B' | 'C';
  peak?: number;
  freq?: number | null;
  startMondayISO?: string;
  raceDate?: string;
}): ComposeNonRaceInput {
  return {
    startMondayISO: o.startMondayISO ?? SM,
    level: 'intermediate',
    recentWeeklyMi: 40,
    recentLongMi: 14,
    recentPeakWeeklyMi: o.peak ?? 45,
    easyDayMedianMi: 6,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [3] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: o.freq ?? null,
    crossModes: [],
    tier: o.tier,
    nextRace: null,
    lastRaceFinished: {
      slug: 'r', name: 'R', date: o.raceDate ?? '2026-01-04',
      distanceMi: o.raceMi, priority: o.priority ?? 'A',
    } as ComposeNonRaceInput['lastRaceFinished'],
    rxQuality: inlinePrescriptions('hm'),
    tPaceSec: 360,
    lthr: null,
  };
}

/** Every recovery-block shape the composer can actually produce. */
const TIERS: GoalTier[] = ['developing', 'intermediate', 'advanced', 'elite'];
const RACE_MI = [3.1, 6.2, 13.1, 26.2, 50];
const PRIORITIES: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
const PEAKS = [12, 25, 40, 55, 70];
const FREQS: Array<number | null> = [null, 3, 5, 6];

interface Swept {
  label: string;
  phase: string;
  weekIdx: number;
  isPeak: boolean;
  isCutback: boolean;
  isRaceWeek: boolean;
  weeklyMi: number;
}

function sweep(): Swept[] {
  const out: Swept[] = [];
  for (const tier of TIERS) {
    for (const raceMi of RACE_MI) {
      for (const priority of PRIORITIES) {
        for (const peak of PEAKS) {
          for (const freq of FREQS) {
            const input = recoveryInput({ tier, raceMi, priority, peak, freq });
            const res = composeRecoveryPlan(input);
            // `composeRecoveryPlan` falls through to maintenance when there is
            // no finished race; there always is one here, so every result is a
            // recovery block. Guard it anyway rather than assume (Rule 11).
            if (res.authoredState['mode'] !== 'recovery') continue;
            const flags = planWeekFlags(res.weeks);
            res.weeks.forEach((w, wi) => {
              out.push({
                label: `${tier}/${raceMi}mi/${priority}/peak${peak}/freq${freq ?? 'null'}`,
                phase: w.phase,
                weekIdx: w.blockWeekIdx ?? wi,
                isPeak: flags.isPeakByWeek[wi],
                isCutback: flags.isCutbackByWeek[wi],
                isRaceWeek: w.isRaceWeek,
                weeklyMi: flags.weeklyMiles[wi],
              });
            });
          }
        }
      }
    }
  }
  return out;
}

describe('RECOVERYFLAGS-1 · a prescribed recovery block is never authored as ordinary', () => {
  const swept = sweep();
  const blocks = new Set(swept.map((s) => s.label)).size;

  it('LIVENESS · the sweep read real composed blocks (Rule 18 clause 2)', () => {
    // A scanner states how many things it read and fails on zero. These two
    // numbers are the whole reason the assertions below mean anything.
    expect(blocks, 'the sweep composed zero recovery blocks').toBeGreaterThan(0);
    expect(swept.length, 'the sweep examined zero weeks').toBeGreaterThan(0);
    expect(blocks).toBe(TIERS.length * RACE_MI.length * PRIORITIES.length * PEAKS.length * FREQS.length);
    // eslint-disable-next-line no-console
    console.log(`RECOVERYFLAGS-1 · swept ${blocks} recovery blocks, ${swept.length} weeks`);
  });

  it('1 · no week of a recovery block is the peak week', () => {
    const peaks = swept.filter((s) => s.isPeak);
    expect(
      peaks.map((s) => `${s.label} wk${s.weekIdx} (${s.weeklyMi} mi)`),
      'a week the plan prescribed as recovery is stamped the block PEAK. '
      + 'A recovery block is a reverse taper, so its heaviest week is its last '
      + 'one, and marking it the peak tells every reader that a prescribed '
      + 'easing was this runner\'s hardest week. Rule 8.',
    ).toEqual([]);
  });

  it('2 · every recovery week is recognisable as prescribed-non-normal', () => {
    // Rung 1 · the phase label, the carrier that does not depend on a boolean
    // having been computed correctly.
    const unlabelled = swept.filter((s) => !isNonBuildingPhaseLabel(s.phase));
    expect(
      unlabelled.map((s) => `${s.label} wk${s.weekIdx} phase=${s.phase}`),
      'a recovery week carries a phase label no reader recognises as a '
      + 'prescribed easing. This is the rung Rule 8 rides on.',
    ).toEqual([]);

    // Rung 2 · the shared predicate the three progression levers read. The
    // property that matters is that it REFUSES: a null here means VOLUME,
    // DURATION and DENSITY would all take a progression step through a
    // post-race recovery block.
    //
    // It is allowed to answer CUTBACK rather than RECOVERY, and the sweep
    // proves the case is real rather than theoretical. `non-building-week.ts`
    // states that `is_cutback` is false on every recovery week "by
    // construction", because a recovery block is a reverse taper. That holds
    // for all six production rows and for every block this sweep composes at
    // 5, 6 and unset days a week — but NOT at three. A marathon recovery block
    // for a 3-day-a-week runner runs 6 → 15 → 12 → 18 mi: week 2 drops 20% off
    // week 1, the >15% rule fires honestly, and the flag outranks the label in
    // `weekRowNoStepReason` (pinned by `_non_building_week.test.ts`). The week
    // is still correctly no-step, which is the safety property; only the
    // logged REASON is the coarser of two true words. Rung 1 above is what
    // carries Rule 8, and it is unconditional.
    const steps = swept
      .map((s) => ({
        s,
        reason: weekRowNoStepReason({
          is_cutback: s.isCutback,
          is_race_week: s.isRaceWeek,
          phase: s.phase,
        }),
      }))
      .filter((x) => x.reason == null);
    expect(
      steps.map((x) => `${x.s.label} wk${x.s.weekIdx}`),
      'weekRowNoStepReason returns null for a recovery week. All three '
      + 'progression levers would take a step through a post-race recovery '
      + 'block.',
    ).toEqual([]);

    // And the label rung, read on its own, always says RECOVERY — so a reader
    // that wants the precise fact can always get it, whatever the flag did.
    const notRecovery = swept.filter((s) => s.phase.trim().toUpperCase() !== 'RECOVERY');
    expect(
      notRecovery.map((s) => `${s.label} wk${s.weekIdx} phase=${s.phase}`),
      'a recovery block emitted a week whose phase label is not RECOVERY',
    ).toEqual([]);
  });

  it('3 · the four production rows, replayed (2026-09-03, faff_readonly)', () => {
    // The measured defect, as its own case, so a future rewrite of the sweep
    // cannot lose it. Every one of these was `is_peak = TRUE` in production.
    //
    //   pln_36fe43db78fe177d  wk 1  2026-08-24
    //   pln_eb73331e19230ad9  wk 1  2026-08-24   ← the day after the A-race half
    //   pln_974c307d22ee0f61  wk 1  2026-08-24
    //   pln_0e635603799fd7b1  wk 0  2026-08-24   ← single-week block
    //
    // All four are half-marathon post-race recovery for an intermediate runner,
    // which is the shape below.
    const res = composeRecoveryPlan(recoveryInput({
      tier: 'intermediate', raceMi: 13.1, priority: 'A', peak: 33,
      startMondayISO: '2026-08-17', raceDate: '2026-08-16',
    }));
    const flags = planWeekFlags(res.weeks);

    expect(res.authoredState['mode']).toBe('recovery');
    expect(res.weeks.length, 'the owner\'s block was two weeks').toBe(2);
    expect(res.weeks.map((w) => w.phase)).toEqual(['RECOVERY', 'RECOVERY']);

    // The defect, stated as the row it produced.
    expect(
      flags.isPeakByWeek,
      'the 2026-08-17 recovery block still stamps a peak week',
    ).toEqual([false, false]);

    // And the reverse-taper shape that made the old rule pick week 1: the
    // block rises. Read out of the composer rather than hardcoded on both
    // sides, so this cannot pass by agreeing with itself (Rule 18).
    expect(
      flags.weeklyMiles[1],
      'the block no longer rises · this fixture is no longer a reverse taper '
      + 'and the regression it pins has changed shape',
    ).toBeGreaterThan(flags.weeklyMiles[0]);
  });

  it('4 · the argmax rule is what changed, and only for non-building weeks', () => {
    // The FALSIFIER, kept as a permanent assertion rather than a one-off
    // manual break: reconstruct the OLD rule (highest-mileage non-race week)
    // and prove it still disagrees on a recovery block. If this ever stops
    // disagreeing, the fix has been reverted or neutered and assertion 1 above
    // would go quiet without failing.
    const res = composeRecoveryPlan(recoveryInput({
      tier: 'intermediate', raceMi: 13.1, priority: 'A', peak: 33,
      startMondayISO: '2026-08-17', raceDate: '2026-08-16',
    }));
    const flags = planWeekFlags(res.weeks);
    const mi = flags.weeklyMiles;
    const oldMax = Math.max(...mi.filter((_, i) => !res.weeks[i].isRaceWeek), 0);
    let marked = false;
    const oldIsPeak = mi.map((m, i) => {
      if (!res.weeks[i].isRaceWeek && m === oldMax && !marked) { marked = true; return true; }
      return false;
    });
    expect(oldIsPeak, 'the pre-fix rule no longer reproduces the defect').toContain(true);
    expect(flags.isPeakByWeek, 'the fix no longer differs from the pre-fix rule')
      .not.toEqual(oldIsPeak);
  });

  it('5 · a BUILDING block still gets exactly one peak week', () => {
    // The other direction (Rule 18 clause 1: both directions where the gate has
    // two). Excluding non-building weeks must not switch `is_peak` off for the
    // blocks that legitimately have one.
    const build = [
      { isRaceWeek: false, phase: 'BASE', days: [{ distanceMi: 30 }] },
      { isRaceWeek: false, phase: 'BUILD', days: [{ distanceMi: 40 }] },
      { isRaceWeek: false, phase: 'PEAK', days: [{ distanceMi: 50 }] },
      { isRaceWeek: false, phase: 'TAPER', days: [{ distanceMi: 25 }] },
      { isRaceWeek: true, phase: 'RACE_WEEK', days: [{ distanceMi: 15 }] },
    ];
    const f = planWeekFlags(build);
    expect(f.isPeakByWeek).toEqual([false, false, true, false, false]);

    // And a taper week that happens to be the heaviest week in a degenerate
    // block is still not a peak.
    const taperHeavy = [
      { isRaceWeek: false, phase: 'TAPER', days: [{ distanceMi: 50 }] },
      { isRaceWeek: false, phase: 'BUILD', days: [{ distanceMi: 20 }] },
    ];
    expect(planWeekFlags(taperHeavy).isPeakByWeek).toEqual([false, true]);

    // A block with no building week at all has NO peak, rather than stamping
    // whichever zero-mile week came first.
    const allRest = [
      { isRaceWeek: false, phase: 'RECOVERY', days: [{ distanceMi: 0 }] },
      { isRaceWeek: false, phase: 'RECOVERY', days: [{ distanceMi: 0 }] },
    ];
    expect(planWeekFlags(allRest).isPeakByWeek).toEqual([false, false]);
  });
});
