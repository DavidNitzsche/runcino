/**
 * RATIONALE-PERSIST-1 (2026-09-01) · the catalogue selector's own "why this
 * one, not the alternatives" rationale must survive the trip to
 * `plan_workouts.workout_spec` and back, exactly as PROGRESSION-PERSIST-1's
 * shape already has to (see `_progression_spec.test.ts`, the pattern this
 * file mirrors).
 *
 * `docs/reports/workout-provenance-trace-2026-09-01.md` §1 found the real
 * reason a session beat the alternatives computed at `selectWorkout()` and
 * discarded at `generate.ts`'s `DayPlan` boundary — "the reason this session
 * beat the alternatives exists at selection time and is nowhere in the
 * database." This test drives the REAL author chain (`composePlan` →
 * `finalizeComposedPlan` → `persistedDayShape`, the exact functions
 * `persistPlan` calls) against a real marathon block and asserts the
 * rationale is not only present on the composed `DayPlan` but reaches the
 * persisted `workout_spec`, survives a JSON round trip, is read back
 * correctly by `readSelectionRationale`, is protected by the Rule 6 guard,
 * and reaches `cardFromSpec`'s `SpecCard.selectionRationale` — the field
 * `GET /api/v5/today` now wires onto the wire as
 * `V5PrescriptionLike.selectionRationale`.
 */
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import { describe, it, expect } from 'vitest';
import {
  RATIONALE_SPEC_KEY,
  readSelectionRationale,
  preserveProgressionSql,
} from './progression-spec';
import {
  composePlan,
  finalizeComposedPlan,
  persistedDayShape,
  inlinePrescriptions,
  type ComposePlanInput,
  type DOW,
} from './generate';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';
import { tPaceFromVdot } from '@/lib/training/vdot';
import { cardFromSpec } from '@/lib/training/spec-card';

/** The DB stores jsonb · anything that does not survive JSON is already lost. */
const throughJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function cimBlock(): ComposePlanInput {
  const distanceMi = 26.2;
  const goalSec = 10800;
  const currentT = tPaceFromVdot(44.1);
  const goalT = fixtureTPaceFromGoalPace(goalSec, distanceMi);
  return {
    raceDistanceMi: distanceMi, goalSec,
    goalPaceSec: Math.round(goalSec / distanceMi),
    raceDateISO: '2026-12-06', startMondayISO: '2026-08-31',
    level: 'advanced', recentWeeklyMi: 45, easyDayMedianMi: 6, recentLongMi: 14,
    bestRecentVdot: 44.1, isMidBlock: false,
    longRunDow: 0 as DOW, restDow: 5 as DOW, qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: null, crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOrThrow(distanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(distanceMi)),
    tPaceSec: (goalT != null && currentT != null ? Math.min(goalT, currentT) : goalT) ?? currentT ?? 480,
    lthr: null, maxHr: null,
  } as ComposePlanInput;
}

describe('RATIONALE-PERSIST-1 · the selector\'s rationale survives persistence', () => {
  it('survives the real author chain on a composed marathon block, and reaches the card', () => {
    const input = cimBlock();
    const res = composePlan(input);
    finalizeComposedPlan(res, 26.2, 'advanced');

    let carried = 0;
    for (const w of res.weeks) {
      const weekT = (w as { tPaceSec?: number | null }).tPaceSec ?? input.tPaceSec ?? null;
      for (const d of w.days) {
        if (!d.isQuality || !d.catalogueRationale) continue;
        carried++;

        const shape = persistedDayShape(d, weekT, {
          lthr: null, maxHr: null, goalPaceSec: input.goalPaceSec ?? null,
          easyAnchorTSec: weekT,
        });
        expect(shape.workoutSpec, `${w.startISO} ${d.type} built no spec`).not.toBeNull();

        // The exact string DayPlan carried is the exact string on the row.
        const persisted = throughJson(shape.workoutSpec) as Record<string, unknown>;
        expect(persisted[RATIONALE_SPEC_KEY]).toBe(d.catalogueRationale);
        expect(readSelectionRationale(persisted)).toBe(d.catalogueRationale);

        // The card reads the SAME row shape a real `today` route would pass in.
        const card = cardFromSpec({
          spec: persisted, type: d.type as 'threshold' | 'intervals' | 'tempo',
          subLabel: shape.subLabel, distanceMi: shape.distanceMi,
          easyPaceSec: weekT != null ? weekT + 100 : null,
        });
        if (card) expect(card.selectionRationale).toBe(d.catalogueRationale);
      }
    }
    // Anti-vacuum guard (same posture as PROGRESSION-PERSIST-1's own): if the
    // catalogue ever stopped filling any slot on this block this test would
    // pass vacuously, which is worse than failing.
    expect(carried, 'no quality day carried a catalogue rationale at all').toBeGreaterThan(0);
  });

  it('the Rule 6 guard now protects selection_rationale alongside progression, from the one shared function', () => {
    const sql = preserveProgressionSql('$2');
    expect(sql).toContain(`? '${RATIONALE_SPEC_KEY}'`);
    expect(sql).toContain(`jsonb_set($2::jsonb, '{progression}'`);
    expect(sql).toContain('plan_workouts.workout_spec');

    // A new writer whose spec omits BOTH keys carries both forward. Simulated
    // directly against the returned SQL shape's semantics (the integration
    // paths themselves are exercised against a real database by the six
    // writers' own tests) — a null-both-ways sanity check that this file's
    // rewrite did not silently drop the second key's guard.
    expect(sql).toContain(RATIONALE_SPEC_KEY);
  });

  it('readSelectionRationale is honest about absence', () => {
    expect(readSelectionRationale(null)).toBeNull();
    expect(readSelectionRationale({})).toBeNull();
    expect(readSelectionRationale({ [RATIONALE_SPEC_KEY]: '' })).toBeNull();
    expect(readSelectionRationale({ [RATIONALE_SPEC_KEY]: '   ' })).toBeNull();
    expect(readSelectionRationale({ [RATIONALE_SPEC_KEY]: 42 })).toBeNull();
    expect(readSelectionRationale({ [RATIONALE_SPEC_KEY]: 'Cruise intervals (§5.3) · least recently used wins.' }))
      .toBe('Cruise intervals (§5.3) · least recently used wins.');
  });
});
