/**
 * lib/plan/_v5_block_scenarios.test.ts · `GET /api/v5/block`'s
 * scenario-availability matrix — the part of `lib/plan/v5-block.ts` that is
 * checkable without a live plan and a database.
 *
 * `buildScenarios` itself (lib/plan/v5-block.ts) needs a real user with a
 * real plan, the same reason `_replan_scenarios.test.ts` tests
 * `cutbackLongTarget` / `reentryCeilingMi` in isolation rather than
 * `proposeChange` end to end. What IS pure here, and is exactly what this
 * route relies on for "is this scenario reachable at all":
 *
 *   1. `anotherRaceBlockGate` (lib/plan/replan-scenarios.ts) — the three
 *      structural gates on "another race" that hold regardless of which race
 *      gets picked. This is the SAME function `planAnotherRace` calls first,
 *      so a fixture that exercises the refusal here is a real refusal, not a
 *      re-implementation of one.
 *   2. `findMoveDayCandidate` (lib/plan/v5-block.ts) — picking a real
 *      (from, to) argument pair for `move_day`, and the honest "there is
 *      nothing to test" case when no pair exists.
 *   3. `libraryPhaseKey` (lib/plan/v5-block.ts) — the phase-label →
 *      workout_library.phase_fit vocabulary mapping the catalogue filter
 *      depends on.
 */
import { describe, it, expect } from 'vitest';
import { anotherRaceBlockGate, type PlanShape } from './replan-scenarios';
import { findMoveDayCandidate, libraryPhaseKey } from './v5-block';

// ── fixtures ─────────────────────────────────────────────────────────────

function day(over: Partial<PlanShape['weeks'][number]['days'][number]> = {}) {
  return {
    id: 'day-1', weekId: 'week-1', dateISO: '2026-09-01', dow: 2, type: 'easy',
    distanceMi: 5, isQuality: false, isLong: false, subLabel: null,
    paceTargetSPerMi: null, spec: null,
    ...over,
  };
}

function week(over: Partial<PlanShape['weeks'][number]> = {}): PlanShape['weeks'][number] {
  return {
    id: 'week-1', weekIdx: 0, startISO: '2026-08-31', endISO: '2026-09-06',
    phase: 'BASE', isRaceWeek: false, isCutback: false, days: [],
    ...over,
  };
}

function shape(over: Partial<PlanShape> = {}): PlanShape {
  return {
    planId: 'plan-1', userUuid: 'user-1', mode: 'race-prep',
    raceId: 'chicago-2026', goalISO: '2026-12-01', weeks: [],
    ...over,
  };
}

const TODAY = '2026-08-19';

// ── 1 · anotherRaceBlockGate — three real refusals, one real pass ──────────

describe('anotherRaceBlockGate · the structural checks that do not need a race picked yet', () => {
  it('refuses a block that is holding a base rather than building to a race', () => {
    const out = anotherRaceBlockGate(shape({ mode: 'maintenance' }), TODAY);
    expect('unavailable' in out).toBe(true);
    if ('unavailable' in out) {
      expect(out.unavailable).toMatch(/holding a base/);
    }
  });

  it('refuses inside the two-week race-week suppression window', () => {
    // 5 days out — inside suppressDriftNearRace's own 14-day line.
    const out = anotherRaceBlockGate(shape({ goalISO: '2026-08-24' }), TODAY);
    expect('unavailable' in out).toBe(true);
    if ('unavailable' in out) {
      expect(out.unavailable).toMatch(/last two weeks/);
    }
  });

  it('refuses a block with no target race to rebuild around', () => {
    const out = anotherRaceBlockGate(shape({ raceId: null }), TODAY);
    expect('unavailable' in out).toBe(true);
    if ('unavailable' in out) {
      expect(out.unavailable).toMatch(/no target/);
    }
  });

  it('passes a normal race-prep block outside the suppression window', () => {
    const out = anotherRaceBlockGate(shape(), TODAY);
    expect(out).toEqual({ ok: true });
  });

  it('agrees with proposeChange\'s own order: mode is checked before the suppression window', () => {
    // Both would fire; the mode check is first, so its message is the one
    // that comes back — matching planAnotherRace's own check order exactly
    // (anotherRaceBlockGate is that same code, extracted).
    const out = anotherRaceBlockGate(shape({ mode: 'maintenance', goalISO: '2026-08-24' }), TODAY);
    expect('unavailable' in out && out.unavailable).toMatch(/holding a base/);
  });
});

// ── 2 · findMoveDayCandidate — a real pair, or the honest absence of one ───

describe('findMoveDayCandidate · a representative argument for planMoveDay, not a rule', () => {
  it('finds a running day and a rest day in the same future week', () => {
    const s = shape({
      weeks: [
        week({
          id: 'w1', days: [
            day({ id: 'd-mon', dateISO: '2026-08-24', type: 'easy' }),
            day({ id: 'd-tue', dateISO: '2026-08-25', type: 'rest', distanceMi: 0 }),
          ],
        }),
      ],
    });
    const found = findMoveDayCandidate(s, TODAY);
    expect(found).toEqual({ from: '2026-08-24', to: '2026-08-25' });
  });

  it('prefers an easy day over the long or a quality session as the one that moves', () => {
    const s = shape({
      weeks: [
        week({
          id: 'w1', days: [
            day({ id: 'd-long', dateISO: '2026-08-23', type: 'long', isLong: true, distanceMi: 14 }),
            day({ id: 'd-quality', dateISO: '2026-08-24', type: 'threshold', isQuality: true, distanceMi: 6 }),
            day({ id: 'd-easy', dateISO: '2026-08-25', type: 'easy', distanceMi: 5 }),
            day({ id: 'd-rest', dateISO: '2026-08-26', type: 'rest', distanceMi: 0 }),
          ],
        }),
      ],
    });
    const found = findMoveDayCandidate(s, TODAY);
    expect(found?.from).toBe('2026-08-25'); // the easy day, not the long or the quality session
  });

  it('returns null when no future week pairs a running day with a rest day', () => {
    // Every day is already running · nowhere honest to move one into.
    const s = shape({
      weeks: [
        week({
          id: 'w1', days: [
            day({ id: 'd1', dateISO: '2026-08-24', type: 'easy' }),
            day({ id: 'd2', dateISO: '2026-08-25', type: 'easy' }),
          ],
        }),
      ],
    });
    expect(findMoveDayCandidate(s, TODAY)).toBeNull();
  });

  it('never returns a day that is today or in the past', () => {
    const s = shape({
      weeks: [
        week({
          id: 'w1', days: [
            day({ id: 'd-past', dateISO: '2026-08-15', type: 'easy' }),
            day({ id: 'd-rest-past', dateISO: '2026-08-16', type: 'rest', distanceMi: 0 }),
          ],
        }),
      ],
    });
    expect(findMoveDayCandidate(s, TODAY)).toBeNull();
  });
});

// ── 3 · libraryPhaseKey — the catalogue filter's vocabulary mapping ────────

describe('libraryPhaseKey · plan_phases.label → workout_library.phase_fit', () => {
  it('maps every real phase label the engine emits', () => {
    expect(libraryPhaseKey('BASE', false)).toBe('base');
    expect(libraryPhaseKey('QUALITY', false)).toBe('quality');
    expect(libraryPhaseKey('RACE-SPECIFIC', false)).toBe('race_specific');
    expect(libraryPhaseKey('TAPER', false)).toBe('taper');
    expect(libraryPhaseKey('MAINTENANCE', false)).toBe('maintenance');
  });

  it('race week overrides whatever phase it sits inside', () => {
    expect(libraryPhaseKey('TAPER', true)).toBe('race_week');
    expect(libraryPhaseKey('RACE-SPECIFIC', true)).toBe('race_week');
  });

  it('an unrecognised label maps to null rather than a guess', () => {
    expect(libraryPhaseKey('SOMETHING-NEW', false)).toBeNull();
    expect(libraryPhaseKey(null, false)).toBeNull();
  });

  it('RECOVERY (generate.ts\'s post-race composer) has no phase_fit value of its own — null, not a guess', () => {
    expect(libraryPhaseKey('RECOVERY', false)).toBeNull();
  });
});
