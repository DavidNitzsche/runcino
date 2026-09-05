/**
 * lib/faff/_v5_decisions.test.ts · V5PROPOSALSURFACE-1 · the outcome vocabulary
 * is TOTAL, and no status silently becomes "still open".
 *
 * ── WHY THIS GATE ──────────────────────────────────────────────────────────
 *
 * Two status vocabularies feed one runner-facing word. `PlanProposalStatus`
 * has eight members and `plan_workout_proposals` has four, and the mapping is
 * the kind of switch that grows a hole the day somebody adds a ninth. A hole
 * here is not cosmetic: an unmapped status defaulting to `pending` would show
 * a settled decision as one the runner still owes an answer to.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * It cannot fail on the history being RENDERED, or on the merge order, or on
 * either table's rows being read correctly — it never touches a database. It
 * tests the two pure status maps and the vocabulary's reachability.
 *
 * It cannot fail on a status being mapped to the WRONG outcome where both are
 * plausible (`accepted` versus `applied`, say). It can only fail on a status
 * being unmapped, on the default being wrong, and on a member of the
 * vocabulary that nothing can ever produce.
 *
 * ── AND THE BALANCE CHECK RULE 22 ASKS FOR ─────────────────────────────────
 *
 * The outcome vocabulary is deliberately not symmetric and should not be made
 * so: there is one way to say yes (`accepted`) and one to say no (`declined`),
 * and the remaining five describe things that happened WITHOUT the runner
 * answering. That asymmetry is about the engine's autonomy, not its
 * disposition, so it is argued rather than corrected.
 */
import { describe, it, expect } from 'vitest';
import { DECISION_OUTCOMES, _internals, type V5DecisionOutcome } from '@/lib/faff/v5-decisions';

const { outcomeOfWorkoutRow, outcomeOfPlanRow } = _internals;

/** Every status `plan_proposals` can hold. Mirrors `PlanProposalStatus`. */
const PLAN_STATUSES = [
  'pending', 'auto_applied', 'accepted', 'dismissed',
  'superseded', 'expired', 'no_change', 'undone',
] as const;

/** Every status `plan_workout_proposals` can hold. */
const WORKOUT_STATUSES = ['pending', 'accepted', 'dismissed', 'expired'] as const;

describe('V5PROPOSALSURFACE-1 · the two status maps are total', () => {
  it('maps every plan_proposals status, and only no_change is dropped', () => {
    const dropped = PLAN_STATUSES.filter((s) => outcomeOfPlanRow(s) == null);
    // `no_change` is the cron saying it composed the same block. Its own doc
    // comment: "there is nothing to tell anyone." Everything else is news.
    expect(dropped).toEqual(['no_change']);
  });

  it('maps every plan_workout_proposals status', () => {
    for (const s of WORKOUT_STATUSES) {
      expect(outcomeOfWorkoutRow(s, false, false)).toBeTruthy();
    }
  });

  it('an UNKNOWN status is never reported as still open', () => {
    // Rule 11 pointed at a surface: the safe reading of a status we have not
    // been taught is the one that promises the runner nothing to answer.
    expect(outcomeOfWorkoutRow('some_future_status', false, false)).toBe('expired');
    expect(outcomeOfPlanRow('some_future_status')).toBeNull();
  });
});

describe('V5PROPOSALSURFACE-1 · a stored status is not the authority on a date', () => {
  it('a PAST-DATED pending row reads as expired, whatever the column says', () => {
    // Production row 6 has been `pending` since 2026-08-23 for a session on
    // 2026-08-25, because expiry only ran when a phone opened a screen. A
    // history that shows that as OPEN is lying about the runner's plan.
    expect(outcomeOfWorkoutRow('pending', true, false)).toBe('expired');
    // And the deferral reading does not rescue it: the day has gone either way.
    expect(outcomeOfWorkoutRow('pending', true, true)).toBe('expired');
  });

  it('a future-dated pending row is open, and a deferred one says so', () => {
    expect(outcomeOfWorkoutRow('pending', false, false)).toBe('pending');
    expect(outcomeOfWorkoutRow('pending', false, true)).toBe('deferred');
  });
});

describe('V5PROPOSALSURFACE-1 · every outcome is reachable', () => {
  it('no member of the vocabulary is decoration', () => {
    // Rule 15: a value no case can produce is untested by construction, and a
    // word the runner can never read has no business in the type.
    const reachable = new Set<V5DecisionOutcome>();
    for (const s of WORKOUT_STATUSES) {
      reachable.add(outcomeOfWorkoutRow(s, false, false));
      reachable.add(outcomeOfWorkoutRow(s, true, false));
      reachable.add(outcomeOfWorkoutRow(s, false, true));
    }
    for (const s of PLAN_STATUSES) {
      const o = outcomeOfPlanRow(s);
      if (o != null) reachable.add(o);
    }
    const unreachable = DECISION_OUTCOMES.filter((o) => !reachable.has(o));
    expect(unreachable).toEqual([]);
  });

  it('the vocabulary carries every outcome the maps can produce', () => {
    // The other direction, so the exported list cannot fall behind the maps.
    for (const s of WORKOUT_STATUSES) {
      expect(DECISION_OUTCOMES).toContain(outcomeOfWorkoutRow(s, false, false));
    }
    for (const s of PLAN_STATUSES) {
      const o = outcomeOfPlanRow(s);
      if (o != null) expect(DECISION_OUTCOMES).toContain(o);
    }
  });
});
