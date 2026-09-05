/**
 * lib/faff/_v5_proposals.test.ts · V5PROPOSAL-1 · the runner can SEE a proposal.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * `plan_workout_proposals` has been the engine's one runner-consented channel
 * for changing a plan since 2026-06-04. It was served only at
 * `/api/plan/workout-proposals`, whose single Swift caller is
 * `Views/TodayView.swift` in the v4 shell, reachable only under `-faffLegacy`.
 * The V5 app that ships had no proposal surface. Production has SEVEN rows
 * ever written, zero accepted, zero dismissed, and one from 2026-08-25 still
 * pending eleven days later.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * It cannot fail on the card being RENDERED. This proves the payload carries
 * the rows and the mapping is honest; whether a runner sees anything needs a
 * built app and a screenshot, which is Rule 13 and is not satisfied here.
 *
 * It cannot fail on the wording being good. `headlineFor` is checked for
 * shape, not for coach voice; `check-coach-voice.sh` owns that.
 *
 * It cannot fail on the DIRECTION MAP BEING RIGHT, only on it being total and
 * stable. That `field_test` is a push and a `downgrade` to rest is recovery
 * are judgement calls argued in `v5-proposals.ts`'s header; a test can pin
 * them so they cannot drift silently, and cannot tell you they are correct.
 */
import { describe, it, expect } from 'vitest';
import { detailFor, directionOf, headlineFor, standingOf, toWire } from '@/lib/faff/v5-proposals';
import type { PendingProposal } from '@/lib/plan/workout-proposals';

const TODAY = '2026-09-05';

const base: PendingProposal = {
  id: 1, userUuid: 'u', planWorkoutId: 'wko_1', workoutDateISO: '2026-09-10',
  actionKind: 'mark_upgrade',
  actionPayload: { newDistanceMi: 9 },
  reason: 'you absorbed 47.3 miles against 45.5 prescribed with no late fade',
  evidence: {}, status: 'pending', createdAt: '2026-09-05T00:00:00Z',
} as PendingProposal;

describe('V5PROPOSAL-1 · direction is the objective\'s vocabulary, not a fourth one', () => {
  it('maps every proposable kind, in both directions', () => {
    expect(directionOf('mark_upgrade')).toBe('push');
    expect(directionOf('field_test')).toBe('push');
    expect(directionOf('shave')).toBe('pull_back');
    expect(directionOf('downgrade', { newType: 'easy' })).toBe('pull_back');
    expect(directionOf('reschedule')).toBe('move');
  });

  it('a downgrade to REST or RECOVERY is prescribed recovery, not a pull-back', () => {
    // Read off the payload, which `adapt.ts` constrains to easy|recovery|rest.
    // Being told to rest and being told to do less of the same session are
    // different things to be told, and `DeclineBasis` types them separately.
    expect(directionOf('downgrade', { newType: 'rest' })).toBe('recovery');
    expect(directionOf('downgrade', { newType: 'recovery' })).toBe('recovery');
  });

  it('REFUSES an unrecognised kind rather than guessing a direction', () => {
    // Rule 11. Showing a card whose direction we guessed is worse than showing
    // nothing: the runner would be asked to accept a change we cannot describe.
    expect(directionOf('reshape')).toBeNull();
    expect(directionOf('mark_dirty')).toBeNull();
    expect(toWire({ ...base, actionKind: 'reshape' } as unknown as PendingProposal, TODAY))
      .toBeNull();
  });

  it('AN UPWARD PROPOSAL REACHES THE WIRE · the whole point', () => {
    const w = toWire(base, TODAY);
    expect(w).not.toBeNull();
    expect(w?.direction).toBe('push');
    expect(w?.headline).toBe('Thursday goes to 9 mi');
    expect(w?.why).toMatch(/47.3 miles against 45.5/);
  });

  it('a downward proposal still reaches it, so nothing was traded away', () => {
    const w = toWire({
      ...base, actionKind: 'shave', actionPayload: { shaveFraction: 0.17 },
      reason: 'your last two long runs deteriorated in the final third',
    } as PendingProposal, TODAY);
    expect(w?.direction).toBe('pull_back');
    expect(w?.headline).toBe('Take 17% off Thursday');
  });

  it('WITHHOLDS a proposal that gives the runner no reason', () => {
    // The objective forbids asking someone to change what they do with nothing
    // said about why. A card with an empty reason is not shown.
    expect(toWire({ ...base, reason: '   ' } as PendingProposal, TODAY)).toBeNull();
  });

  it('names the day without a distance when the payload does not carry one', () => {
    expect(headlineFor({ ...base, actionPayload: {} } as PendingProposal))
      .toBe('Add to Thursday');
  });

  it('the headline follows the KIND, so two pushes do not read the same', () => {
    // Rule 17: direction and headline are two facts on one card. Deriving the
    // headline from the direction would have made a field test say "more".
    expect(headlineFor({ ...base, actionKind: 'field_test' } as PendingProposal))
      .toBe('Make Thursday a field test');
    expect(headlineFor({
      ...base, actionKind: 'downgrade', actionPayload: { newType: 'rest' },
    } as PendingProposal)).toBe('Thursday becomes a rest day');
    expect(headlineFor({
      ...base, actionKind: 'reschedule', actionPayload: { newDate: '2026-09-12' },
    } as PendingProposal)).toBe('Move Thursday to Saturday');
  });
});

describe('V5PROPOSALSURFACE-1 · standing · what the runner is being asked FOR', () => {
  it('an ordinary pending row is a proposal', () => {
    expect(standingOf(base, TODAY)).toBe('proposal');
  });

  it('an earning gate makes it a CONDITION, because it is not answerable yet', () => {
    const p = {
      ...base,
      evidence: { earningGate: { requires: [{ what: 'A 55 mile week, completed.' }] } },
    } as unknown as PendingProposal;
    expect(standingOf(p, TODAY)).toBe('condition');
  });

  it('a future reassessment date makes it a DEFERRAL', () => {
    const p = { ...base, evidence: { reassessOnISO: '2026-09-20' } } as unknown as PendingProposal;
    expect(standingOf(p, TODAY)).toBe('deferral');
  });

  it('a reassessment date already PAST is not a deferral · the wait is over', () => {
    const p = { ...base, evidence: { reassessOnISO: '2026-09-01' } } as unknown as PendingProposal;
    expect(standingOf(p, TODAY)).toBe('proposal');
  });
});

describe('V5PROPOSALSURFACE-1 · detail · null is not empty (Rule 11)', () => {
  it('sections nothing recorded come back NULL, not as empty lists', () => {
    // The whole reason these fields are nullable. "The coach considered no
    // alternatives" and "nobody wrote down which alternatives the coach
    // considered" are different facts, and the sheet draws different lines.
    const d = detailFor(base);
    expect(d.optionsConsidered).toBeNull();
    expect(d.earningConditions).toBeNull();
    expect(d.policyAssumptions).toBeNull();
    expect(d.reassessOnISO).toBeNull();
  });

  it('reads a recorded trace when one is there, with no further change', () => {
    const p = {
      ...base,
      evidence: {
        options: [{ option: 'HOLD', why: 'the same week again gives no new evidence' }],
        earningGate: { requires: [{ what: 'A 55 mile week, completed.' }] },
        policyAssumptions: ['Three comparables before a capacity ceiling is claimed'],
        reassessOnISO: '2026-09-20',
      },
    } as unknown as PendingProposal;
    const d = detailFor(p);
    expect(d.optionsConsidered).toEqual([
      { what: 'HOLD', why: 'the same week again gives no new evidence' },
    ]);
    expect(d.earningConditions).toEqual(['A 55 mile week, completed.']);
    expect(d.policyAssumptions).toHaveLength(1);
    expect(d.reassessOnISO).toBe('2026-09-20');
  });

  it('a null-valued evidence key is MISSING evidence, not absent evidence', () => {
    const d = detailFor({
      ...base,
      evidence: { lthr_stale: true, lthr_age_days: null },
    } as unknown as PendingProposal);
    expect(d.evidenceUsed).toContain('Threshold HR anchor stale: yes');
    expect(d.missingEvidence).toContain('Threshold HR anchor age, days');
  });

  it('NEVER leaks a Research citation or a row id to the runner', () => {
    // Every other runner-facing path runs `stripResearchCitations` over exactly
    // this shape. The details sheet is depth for the runner, not a console.
    const d = detailFor({
      ...base,
      evidence: {
        citation: 'Research/03-heart-rate-zones.md §6 (Friel)',
        workout_id: '8f1c-uuid',
        planned_type: 'threshold',
      },
    } as unknown as PendingProposal);
    const joined = (d.evidenceUsed ?? []).join(' ');
    expect(joined).not.toMatch(/Research\//);
    expect(joined).not.toMatch(/8f1c-uuid/);
    expect(joined).toContain('threshold');
  });

  it('always names at least the session it would change', () => {
    const d = detailFor({
      ...base, actionKind: 'reschedule', actionPayload: { newDate: '2026-09-12' },
      evidence: { planned_type: 'tempo', planned_distance_mi: 8 },
    } as unknown as PendingProposal);
    expect(d.affectedWorkouts).toEqual([
      { dateISO: '2026-09-10', what: 'tempo · 8 mi' },
      { dateISO: '2026-09-12', what: 'Where it would move to' },
    ]);
  });
});
