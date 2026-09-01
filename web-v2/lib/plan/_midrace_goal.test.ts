/**
 * MIDGOAL-1 (2026-08-30) · A TUNE-UP RACE ALWAYS CARRIES A TARGET.
 *
 * ── The defect ─────────────────────────────────────────────────────────────
 *
 * `loadComposeInputs` derived a mid-block race's `goalPaceSec` from exactly
 * one field, `races.meta.goalDisplay`, and nothing filled the gap when it was
 * empty. `boundedRacePaceSPerMi` returns null for a null stated pace, so the
 * race day went out with `raceGoalPaceSec: null` and prose that named the race
 * and gave no number:
 *
 *     "RACE | Santa Monica 10k. B race · race effort."
 *
 * Of the owner's four future races only Santa Monica has an empty goal field,
 * and it is the race he designated his all-out fitness anchor. Owner ruling
 * (2026-08-28): "For races that have no goals lets have the coach set one
 * based on pushing the runner and current fitness."
 *
 * ── What is asserted here ──────────────────────────────────────────────────
 *
 * THE BYTE-SAFETY BAR FIRST. The stated-goal derivation was never broken —
 * Dodgers (0:45:00 over 6.21 mi → 435 s/mi) and Run Malibu (1:30:00 over
 * 13.1 mi → 412 s/mi) were always correct, and the CIM target itself
 * (3:00:00 over 26.22 mi → 412 s/mi) is composed by a different path again.
 * A change that moves any of those three has broken something that worked, so
 * they are pinned to their exact integers before anything else is checked.
 *
 * Then the new behaviour: a race whose goal the COACH set states its target in
 * the row's prose and says whose target it is, and a race whose goal the
 * RUNNER set says "Target" with no coach attribution. The coach's number is
 * modelled and `notes` is a bare string with no provenance carrier
 * (`FaffValue` on the phone, `<Modelled>` on web, neither here), so the
 * provenance is carried in the words — see the MIDGOAL-1 note in generate.ts.
 *
 * The derivation itself is `lib/race/coach-goal.ts`, tested at its own level.
 * These tests take the composer's side of the contract: given a race carrying
 * a coach-set goal, does the block state it honestly.
 *
 * Cite: Research/20-mental-training.md §Daniels' A/B/C (the B tier is the
 * ~50-60% realistic goal · the tier a race is paced off).
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  type ComposePlanInput, type DOW, type DayPlan,
} from './generate';
import { tPaceFromGoal } from './spec-builder';

const START_MONDAY = '2026-08-31';

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** The owner's real CIM frame: Sunday long, Saturday rest, Tue/Thu quality. */
function cimInput(midBlockRaces: NonNullable<ComposePlanInput['midBlockRaces']>): ComposePlanInput {
  const raceDistanceMi = 26.22;
  const goalSec = 10800; // 3:00:00
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / raceDistanceMi),
    raceDateISO: addDays(START_MONDAY, 14 * 7 - 1),
    startMondayISO: START_MONDAY,
    level: 'advanced',
    recentWeeklyMi: 30.5,
    easyDayMedianMi: 6,
    recentLongMi: 13,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    tPaceSec: tPaceFromGoal(goalSec, raceDistanceMi),
    lthr: null,
    maxHr: null,
    bestRecentVdot: 45.1,
    midBlockRaces,
  };
}

function build(midBlockRaces: NonNullable<ComposePlanInput['midBlockRaces']>) {
  const input = cimInput(midBlockRaces);
  const composed = composePlan(input);
  finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
  composed.vols = composed.weeks.map((w) => w.weeklyMi);
  return composed;
}

function dayAt(composed: ReturnType<typeof build>, iso: string): DayPlan | null {
  const off = Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(START_MONDAY + 'T12:00:00Z')) / 86400000);
  const wi = Math.floor(off / 7);
  const week = composed.weeks[wi];
  if (!week) return null;
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay() as DOW;
  return week.days.find((d) => d.dow === dow) ?? null;
}

// The owner's three real mid-block races, at the dates and priorities his
// `races` rows actually carry, on Sundays inside the block.
const SANTA_MONICA_ISO = addDays(START_MONDAY, 13); // week 2, Sunday
const DODGERS_ISO = addDays(START_MONDAY, 27);      // week 4, Sunday
const MALIBU_ISO = addDays(START_MONDAY, 69);       // week 10, Sunday

describe('MIDGOAL-1 · the stated-goal derivation is untouched (byte-safety bar)', () => {
  it('Dodgers keeps 435 s/mi · 0:45:00 over 6.21 mi, exactly as before', () => {
    const composed = build([
      { slug: 'dodgers', name: 'Dodgers', date: DODGERS_ISO, distanceMi: 6.21,
        goalPaceSec: 435, goalPaceIsCoachSet: false, priority: 'C' },
    ]);
    const day = dayAt(composed, DODGERS_ISO);
    expect(day?.type).toBe('race');
    // 0:45:00 / 6.21 mi = 434.78 → 435. The arithmetic that already worked.
    expect(Math.round(45 * 60 / 6.21)).toBe(435);
    expect(day?.raceGoalPaceSec).toBe(435);
  });

  it('Run Malibu still derives 412 s/mi, and RACEPACE-1 still bounds it to 420', () => {
    const composed = build([
      { slug: 'run-malibu', name: 'Run Malibu', date: MALIBU_ISO, distanceMi: 13.1,
        goalPaceSec: 412, goalPaceIsCoachSet: false, priority: 'B' },
    ]);
    const day = dayAt(composed, MALIBU_ISO);
    expect(day?.type).toBe('race');
    // The DERIVATION from the runner's stated goal · 1:30:00 over 13.1 mi.
    expect(Math.round(90 * 60 / 13.1)).toBe(412);
    // The COMPOSED row is not 412, and must not become it. `boundedRacePaceSPerMi`
    // clamps a stated goal to what this runner can actually run off this build
    // (RACEPACE-1, 2026-08-25) — and Run Malibu's 412 is the exact case that
    // rule's own doc comment was written for: a 1:30 half off a 1:41:53 half
    // three months earlier. 420 s/mi is that bound doing its job. A change that
    // returns this to 412 has re-opened the defect RACEPACE-1 closed.
    //
    // 2026-08-30 · Rule 9 moved this from 441 to 420, and the direction is the
    // whole point. 441 was the UNREDUCED ceiling: the old code spent doctrine's
    // 5% achievability band twice, so a goal just inside the band was prescribed
    // as stated while a goal just outside it was thrown back past the band edge
    // to the ceiling — the more ambitious runner handed the slower target. 420
    // is the band EDGE, which is the bound doctrine actually states
    // (Research/20 §"SMART criteria", "Within ~5% of current fitness ceiling").
    //
    // 2026-09-01 · AUTHORING-CANONICAL-1 moved this from 420 to 421, and the
    // ONE second is the whole change: `boundedRacePaceSPerMi`'s ceiling is
    // derived from the runner's CURRENT VDOT, and authoring now hands it the
    // CANONICAL threshold capacity's derived VDOT instead of
    // `conservativeVdotFromMileage`'s / the legacy cascade's. Same function,
    // same doctrine band, a fitness read that is one VDOT-tenth different — so
    // the band edge lands one second slower. Race Prediction's own question is
    // untouched (Constitution §J); what changed is that it and the block are
    // now read off ONE fitness (Rule 16), which is exactly what the migration
    // was for.
    // The assertion that matters is unchanged and still passes: the composed
    // row is NOT the unbounded 412.
    expect(day?.raceGoalPaceSec).toBe(421);
    expect(day?.raceGoalPaceSec).toBeGreaterThan(412);
  });

  it('the coach-set FLAG is inert for a stated goal · omitting it changes nothing', () => {
    // The field MIDGOAL-1 adds must not perturb a single stated-goal row.
    const withFlag = build([
      { slug: 'run-malibu', name: 'Run Malibu', date: MALIBU_ISO, distanceMi: 13.1,
        goalPaceSec: 412, goalPaceIsCoachSet: false, priority: 'B' },
    ]);
    const withoutFlag = build([
      // Exactly the shape callers passed before MIDGOAL-1 existed.
      { slug: 'run-malibu', name: 'Run Malibu', date: MALIBU_ISO, distanceMi: 13.1,
        goalPaceSec: 412, priority: 'B' },
    ]);
    expect(dayAt(withoutFlag, MALIBU_ISO)?.raceGoalPaceSec)
      .toBe(dayAt(withFlag, MALIBU_ISO)?.raceGoalPaceSec);
    expect(dayAt(withoutFlag, MALIBU_ISO)?.notes)
      .toBe(dayAt(withFlag, MALIBU_ISO)?.notes);
  });

  it('the CIM target itself still prices at 412 s/mi · 3:00:00 over 26.22 mi', () => {
    const input = cimInput([]);
    // The target race's goal pace is composed from goalSec/raceDistanceMi and
    // is a different path from the mid-block one. It must not move either.
    expect(input.goalPaceSec).toBe(412);
    expect(Math.round(10800 / 26.22)).toBe(412);
  });

  it('a stated goal states the target WITHOUT claiming the coach set it', () => {
    const composed = build([
      { slug: 'run-malibu', name: 'Run Malibu', date: MALIBU_ISO, distanceMi: 13.1,
        goalPaceSec: 412, goalPaceIsCoachSet: false, priority: 'B' },
    ]);
    const notes = dayAt(composed, MALIBU_ISO)?.notes ?? '';
    // The row states what it will actually ask for (the bounded 421 = 7:01/mi),
    // never the unbounded ambition. The stated goal still lives on
    // authored_state.goal_pace_s_per_mi and on every surface that shows it.
    // AUTHORING-CANONICAL-1 moved the bound by one second — see the note on
    // the 421 assertion above for why, and why it is the migration working.
    expect(notes).toContain('Target 7:01/mi');
    // The runner's own goal is never attributed to the coach.
    expect(notes).not.toContain('Coach target');
  });
});

describe('MIDGOAL-1 · a coach-set goal reaches the row and names its author', () => {
  it('states the target and attributes it to the coach', () => {
    const composed = build([
      { slug: 'santa-monica-10k-2026-09-13', name: 'Santa Monica 10k',
        date: SANTA_MONICA_ISO, distanceMi: 6.2,
        // What loadComposeInputs now resolves via loadCoachGoalForRace when
        // meta.goalDisplay is empty: the B tier, at this race's distance.
        goalPaceSec: 418, goalPaceIsCoachSet: true, priority: 'B' },
    ]);
    const day = dayAt(composed, SANTA_MONICA_ISO);
    expect(day?.type).toBe('race');
    expect(day?.raceGoalPaceSec).toBe(418);
    const notes = day?.notes ?? '';
    // The number is stated · this is the whole defect.
    expect(notes).toContain('6:58/mi');
    // And it says whose number it is. A modelled value in a string with no
    // provenance carrier names its author in words.
    expect(notes).toContain('Coach target');
    expect(notes).toContain('Yours to change');
  });

  it('the prose stays in coach voice · no hype, no exclamation, no em dash', () => {
    const composed = build([
      { slug: 'santa-monica-10k-2026-09-13', name: 'Santa Monica 10k',
        date: SANTA_MONICA_ISO, distanceMi: 6.2,
        goalPaceSec: 418, goalPaceIsCoachSet: true, priority: 'B' },
    ]);
    const notes = dayAt(composed, SANTA_MONICA_ISO)?.notes ?? '';
    expect(notes).not.toContain('!');
    expect(notes).not.toContain('—');
    // The mark belongs to FaffValue / <Modelled>, never typed into prose.
    expect(notes).not.toContain('~');
  });

  it('a race with no target at all states none · silence beats a fabricated number', () => {
    const composed = build([
      { slug: 'santa-monica-10k-2026-09-13', name: 'Santa Monica 10k',
        date: SANTA_MONICA_ISO, distanceMi: 6.2,
        // What an EFFORT framing produces (a C race, or a mountain course):
        // deriveCoachGoal withholds a time on purpose.
        goalPaceSec: null, goalPaceIsCoachSet: false, priority: 'B' },
    ]);
    const notes = dayAt(composed, SANTA_MONICA_ISO)?.notes ?? '';
    expect(notes).not.toContain('Target');
    expect(notes).not.toContain('/mi');
    // The race is still embedded · only the number is absent.
    expect(dayAt(composed, SANTA_MONICA_ISO)?.type).toBe('race');
  });
});

describe('MIDGOAL-1 · all three races in one block, the owner\'s real calendar', () => {
  it('each race carries its OWN target at its OWN distance', () => {
    const composed = build([
      { slug: 'santa-monica-10k-2026-09-13', name: 'Santa Monica 10k',
        date: SANTA_MONICA_ISO, distanceMi: 6.2, goalPaceSec: 418,
        goalPaceIsCoachSet: true, priority: 'B' },
      { slug: 'dodgers', name: 'Dodgers', date: DODGERS_ISO, distanceMi: 6.21,
        goalPaceSec: 435, goalPaceIsCoachSet: false, priority: 'C' },
      { slug: 'run-malibu', name: 'Run Malibu', date: MALIBU_ISO, distanceMi: 13.1,
        goalPaceSec: 412, goalPaceIsCoachSet: false, priority: 'B' },
    ]);
    // No race inherits another's pace, and none inherits CIM's 412.
    expect(dayAt(composed, SANTA_MONICA_ISO)?.raceGoalPaceSec).toBe(418);
    expect(dayAt(composed, DODGERS_ISO)?.raceGoalPaceSec).toBe(435);
    // Bounded from the stated 412 · see the RACEPACE-1 note above, and the
    // AUTHORING-CANONICAL-1 note beside it for the one-second move.
    expect(dayAt(composed, MALIBU_ISO)?.raceGoalPaceSec).toBe(421);
    // Only the goal-less one is attributed to the coach.
    expect(dayAt(composed, SANTA_MONICA_ISO)?.notes).toContain('Coach target');
    expect(dayAt(composed, DODGERS_ISO)?.notes).not.toContain('Coach target');
    expect(dayAt(composed, MALIBU_ISO)?.notes).not.toContain('Coach target');
  });
});
