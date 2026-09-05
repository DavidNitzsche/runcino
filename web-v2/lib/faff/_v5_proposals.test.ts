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
 */
import { describe, it, expect } from 'vitest';
import { directionOf, headlineFor, toWire } from '@/lib/faff/v5-proposals';
import type { PendingProposal } from '@/lib/plan/workout-proposals';

const base: PendingProposal = {
  id: 1, userUuid: 'u', planWorkoutId: 'wko_1', workoutDateISO: '2026-09-10',
  actionKind: 'mark_upgrade',
  actionPayload: { newDistanceMi: 9 },
  reason: 'you absorbed 47.3 miles against 45.5 prescribed with no late fade',
  evidence: {}, status: 'pending', createdAt: '2026-09-05T00:00:00Z',
} as PendingProposal;

describe('V5PROPOSAL-1 · direction is the runner\'s question, not the engine\'s word', () => {
  it('maps every proposable kind, in both directions', () => {
    expect(directionOf('mark_upgrade')).toBe('more');
    expect(directionOf('downgrade')).toBe('less');
    expect(directionOf('shave')).toBe('less');
    expect(directionOf('reschedule')).toBe('move');
    expect(directionOf('field_test')).toBe('test');
  });

  it('REFUSES an unrecognised kind rather than guessing a direction', () => {
    // Rule 11. Showing a card whose direction we guessed is worse than showing
    // nothing: the runner would be asked to accept a change we cannot describe.
    expect(directionOf('reshape')).toBeNull();
    expect(directionOf('mark_dirty')).toBeNull();
    expect(toWire({ ...base, actionKind: 'reshape' } as unknown as PendingProposal)).toBeNull();
  });

  it('AN UPWARD PROPOSAL REACHES THE WIRE · the whole point', () => {
    const w = toWire(base);
    expect(w).not.toBeNull();
    expect(w?.direction).toBe('more');
    expect(w?.headline).toBe('Thursday goes to 9 mi');
    expect(w?.why).toMatch(/47.3 miles against 45.5/);
  });

  it('a downward proposal still reaches it, so nothing was traded away', () => {
    const w = toWire({
      ...base, actionKind: 'shave', actionPayload: { shaveFraction: 0.17 },
      reason: 'your last two long runs deteriorated in the final third',
    } as PendingProposal);
    expect(w?.direction).toBe('less');
    expect(w?.headline).toBe('Take 17% off Thursday');
  });

  it('WITHHOLDS a proposal that gives the runner no reason', () => {
    // The objective forbids asking someone to change what they do with nothing
    // said about why. A card with an empty reason is not shown.
    expect(toWire({ ...base, reason: '   ' } as PendingProposal)).toBeNull();
  });

  it('names the day without a distance when the payload does not carry one', () => {
    expect(headlineFor({ ...base, actionPayload: {} } as PendingProposal, 'more'))
      .toBe('Add to Thursday');
  });
});
