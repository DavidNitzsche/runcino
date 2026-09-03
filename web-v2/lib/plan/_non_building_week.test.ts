/**
 * THE CLASS · A SINGLE UNVALIDATED FLAG CARRYING A WHOLE PROTECTION, and two
 * predicates answering one question differently (Rules 14, 16, 20).
 *
 * "Is the plan deliberately not building this week" had two answers:
 *
 *   `coaching-thesis.ts`     TAPER, RECOVERY, race week, cutback   ← right
 *   `progression-pass.ts`    TAPER,           race week, cutback   ← the levers
 *
 * The second is the one the DENSITY pass reads and, since 2026-09-02, the one
 * the Adaptation Engine's VOLUME and DURATION levers read through
 * `load-adaptation-engine.ts`. Its own doc comment calls itself "THE one
 * definition (Rule 16)". It was missing the phase under which the plan is most
 * deliberately not building.
 *
 * ── WHY NO FLAG COVERED FOR IT ──────────────────────────────────────────────
 *
 * A recovery block is a REVERSE taper: `RECOVERY_WEEKLY_PCT_OF_BASE` in
 * `lib/plan/goal-tiers.ts` rises every week, for every distance. So
 * `is_cutback` — "a drop of more than 15% off the week before", per
 * `generate.ts#planWeekFlags` — is FALSE on every recovery week by
 * construction, and correctly so. Measured on production 2026-09-03 as
 * `faff_readonly`:
 *
 *     4 recovery plans · 6 weeks · is_cutback FALSE on 6 of 6
 *                                 is_peak    TRUE  on 4 of 4 plans
 *
 * `pln_eb73331e19230ad9` week 1 — 23.0 mi, the week after his A-race half — is
 * flagged the PEAK week of its block, because the argmax of a monotonically
 * rising block is always its last week. That data is inert (all four plans are
 * archived and `is_peak` has no reader in `lib/**` or `app/**`), which is why
 * this file gates the PREDICATE rather than the rows: the boolean was never
 * what carried the protection, and a repair to four archived rows would have
 * left the real gap open.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · Whether the FLAGS handed to the predicate are correct. It reads
 *     `is_cutback` and `is_race_week` as given. A week wrongly flagged a
 *     cutback still reads as one, and nothing here can tell. That is the
 *     motivation for keying RECOVERY on the phase LABEL, which is written by
 *     the phase author rather than derived from a volume curve.
 *   · `is_race_week`, which production shows FALSE on three race weeks of the
 *     runner's ACTIVE plan. Different flag, different owner, reported
 *     separately — this file would pass with that defect fully live.
 *   · Whether the levers CALL the predicate. `_adaptation_engine.test.ts`
 *     asserts `r.rows.map(weekRowNoStepReason)` by source match; this file
 *     asserts what the predicate answers.
 *   · Any phase label that does not exist yet. The last block enumerates the
 *     nine labels production actually holds, so a tenth invented tomorrow is
 *     outside its reach until someone adds it.
 *   · A shared set that is WRONG. The agreement test only catches the two
 *     predicates DRIFTING; now that both read one set, removing RECOVERY from
 *     it moves both sides together and that test stays green. Falsified both
 *     ways to prove the split: dropping RECOVERY from the shared set fails
 *     three of the direct assertions below, and restoring the thesis's own
 *     private copy additionally fails the agreement test with
 *     "RECOVERY: levers=false thesis=true". The direct assertions are what
 *     guard the answer; the agreement test guards the architecture.
 */
import { describe, it, expect } from 'vitest';
import {
  NON_BUILDING_PHASE_LABELS,
  isNonBuildingPhaseLabel,
} from './non-building-week';
import { weekRowNoStepReason } from './progression-pass';
import { assessWeekAgainstThesis } from '@/lib/training/coaching-thesis';

/** Every `plan_phases.label` in production, 2026-09-03, with its row count.
 *  Read as `faff_readonly`. The corpus is the real one, so a phase the engine
 *  writes cannot be missing from this walk (Rule 15). */
const PRODUCTION_PHASE_LABELS: ReadonlyArray<readonly [string, number]> = [
  ['TAPER', 49], ['BASE', 36], ['RACE_WEEK', 27], ['PEAK', 27], ['BUILD', 27],
  ['RACE-SPECIFIC', 22], ['QUALITY', 22], ['MAINTENANCE', 5], ['RECOVERY', 4],
];

const week = (over: Partial<{ is_cutback: boolean | null; is_race_week: boolean | null; phase: string | null }> = {}) => ({
  is_cutback: false as boolean | null,
  is_race_week: false as boolean | null,
  phase: 'QUALITY' as string | null,
  ...over,
});

/** The thesis side of the same question, reduced to a yes/no.
 *  The week carries a LONG run, which is the DURABILITY family, so without the
 *  non-normal branch the verdict would be WEEK_ADDRESSES_LIMITER — the two
 *  answers are distinguishable rather than both falling through to the same
 *  default. */
const thesisSaysNonNormal = (phaseLabel: string | null) =>
  assessWeekAgainstThesis('DURABILITY', [{
    id: 'w1',
    dateIso: '2026-09-06',
    type: 'long',
    subLabel: null,
    isLong: true,
    distanceMi: 15,
    workoutSpec: null,
    phaseLabel,
    isRaceWeek: false,
    isCutback: false,
  }]).code === 'WEEK_IS_NON_NORMAL';

describe('the corpus is the real one (liveness · Rule 18.2)', () => {
  it('walks every phase label production holds, and RECOVERY is among them', () => {
    expect(PRODUCTION_PHASE_LABELS.length).toBe(9);
    expect(PRODUCTION_PHASE_LABELS.map(([l]) => l)).toContain('RECOVERY');
    // A block whose weeks exist. If this ever reads zero, the defect this
    // file gates has become unreachable for reasons worth knowing about.
    expect(PRODUCTION_PHASE_LABELS.find(([l]) => l === 'RECOVERY')?.[1]).toBeGreaterThan(0);
  });
});

describe('a recovery week takes no progression step', () => {
  it('the levers now say so, and say WHICH phase', () => {
    expect(weekRowNoStepReason(week({ phase: 'RECOVERY' }))).toBe('RECOVERY');
  });

  it('and it is not narrated as a taper', () => {
    // Rule 21 · a log that records that something happened but not what is
    // not a log. "The plan is in recovery" and "the plan is tapering" are
    // different facts and the adaptation log is where that has to survive.
    expect(weekRowNoStepReason(week({ phase: 'RECOVERY' }))).not.toBe('TAPER');
  });

  it('without needing is_cutback, which is false on every real recovery week', () => {
    // The exact shape of all six production rows: rising volume, so no
    // cutback flag, and not a race week.
    expect(weekRowNoStepReason({ is_cutback: false, is_race_week: false, phase: 'RECOVERY' }))
      .toBe('RECOVERY');
  });
});

describe('the two predicates agree, label for label (Rule 16)', () => {
  it('across every phase label in production', () => {
    const disagreements: string[] = [];
    for (const [label] of PRODUCTION_PHASE_LABELS) {
      const levers = weekRowNoStepReason(week({ phase: label })) != null;
      const thesis = thesisSaysNonNormal(label);
      if (levers !== thesis) disagreements.push(`${label}: levers=${levers} thesis=${thesis}`);
    }
    // Falsified against the unfixed engine: RECOVERY appeared here as
    // "levers=false thesis=true", which is the whole defect in one line.
    expect(disagreements, disagreements.join('\n')).toEqual([]);
  });

  it('and both read the SAME set, not two that happen to match today', () => {
    // A behavioural agreement test alone cannot catch two copies drifting
    // apart later. This is the structural half.
    for (const label of NON_BUILDING_PHASE_LABELS) {
      expect(isNonBuildingPhaseLabel(label)).toBe(true);
      expect(weekRowNoStepReason(week({ phase: label }))).toBe(label);
      expect(thesisSaysNonNormal(label)).toBe(true);
    }
    expect(NON_BUILDING_PHASE_LABELS.size).toBeGreaterThan(0);
  });
});

describe('the building weeks still build (Rule 22 · the opposite verdict)', () => {
  it('a normal quality or base week takes its step', () => {
    // 29 files in this repo know how to hold a runner back and 2 know what it
    // means to accelerate one. A gate that only asks "did you correctly
    // refuse?" passes an engine that can only refuse.
    for (const label of ['BASE', 'BUILD', 'QUALITY', 'PEAK', 'RACE-SPECIFIC', 'MAINTENANCE']) {
      expect(weekRowNoStepReason(week({ phase: label })), label).toBeNull();
    }
  });

  it('MAINTENANCE is deliberately a building week', () => {
    // Not building toward a race is not the same as being eased on purpose.
    expect(isNonBuildingPhaseLabel('MAINTENANCE')).toBe(false);
  });
});

describe('the flags keep their own rungs, and rank above the label', () => {
  it('cutback and race week still answer first', () => {
    expect(weekRowNoStepReason(week({ is_cutback: true }))).toBe('CUTBACK');
    expect(weekRowNoStepReason(week({ is_race_week: true }))).toBe('RACE_WEEK');
    expect(weekRowNoStepReason(week({ is_cutback: true, phase: 'RECOVERY' }))).toBe('CUTBACK');
  });

  it('an absent label is no information, never "not building" (Rule 11)', () => {
    expect(isNonBuildingPhaseLabel(null)).toBe(false);
    expect(isNonBuildingPhaseLabel(undefined)).toBe(false);
    expect(isNonBuildingPhaseLabel('')).toBe(false);
    expect(weekRowNoStepReason(week({ phase: null }))).toBeNull();
  });

  it('reads the label case-insensitively and trimmed, as stored', () => {
    expect(isNonBuildingPhaseLabel(' recovery ')).toBe(true);
    expect(isNonBuildingPhaseLabel('Taper')).toBe(true);
  });
});
