/**
 * lib/brain/_propose_up.test.ts · PROPOSEUP-1 · the runner can be offered MORE.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * `PROPOSABLE_KINDS` held exactly four kinds: `downgrade`, `shave`,
 * `reschedule`, `field_test`. Two take work away and two move it. So the
 * proposal card, which is the one runner-visible and runner-consented channel
 * this engine has for changing a plan, **could only ever offer to make training
 * easier.** An upward adaptation fell through `sealAutomaticActions` to
 * `toObservationalNote` and became a `coach_intents` row nobody reads.
 *
 * That is the mechanical half of the answer to "why does the brain never push
 * me", and it is separate from the authority seam. Opening
 * `AUTOMATIC_ADAPTATION_AUTHORITY` would not have fixed it: an upgrade would
 * then have been APPLIED silently rather than OFFERED.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * It cannot fail on whether an upward action is ever GENERATED. `mark_upgrade`
 * is produced by `lib/plan/adaptive-ramp.ts`, whose entry point
 * `tryAdaptiveBump` still returns null on its first line behind the owner's
 * seal. This file proves the lane is open, not that anything is walking down
 * it, and those are different facts (Rule 11).
 *
 * It also cannot fail on the runner ever SEEING the card. That needs the Today
 * payload and a rendered screen, which is Rule 13 and is not satisfied here.
 */
import { describe, it, expect } from 'vitest';
import {
  AUTOMATIC_ADAPTATION_AUTHORITY, PROPOSABLE_KINDS, automaticPlanMutationIsAuthorised,
  sealAutomaticActions,
} from '@/lib/plan/adaptation-authority';
import type { AdaptationAction } from '@/lib/plan/adapt';

const act = (kind: AdaptationAction['kind'], withIds = true): AdaptationAction => ({
  kind, why: 'test', workoutIds: withIds ? ['wko_1'] : undefined,
} as AdaptationAction);

describe('PROPOSEUP-1 · the proposal lane carries increases, not only decreases', () => {
  it('an upward action REACHES the propose lane', () => {
    const { propose, recorded } = sealAutomaticActions([act('mark_upgrade')]);
    expect(propose.map((a) => a.kind)).toContain('mark_upgrade');
    expect(recorded).toHaveLength(0);
  });

  it('`reshape` is HELD OUT, because the owner\'s ruling names it', () => {
    // Not an oversight and not a judgement of mine. `_seal_single_seam.test.ts`
    // GUARD 5 cites the 2026-09-02 ruling, which lists "reshape" among the
    // levers whose decision authority was removed. A proposal arguably has no
    // decision authority since the runner decides, but a doctrine-cited guard
    // is not weakened to make room for new work. The question is the owner's.
    const { propose, recorded } = sealAutomaticActions([act('reshape')]);
    expect(propose).toHaveLength(0);
    expect(recorded).toHaveLength(1);
  });

  it('the downward kinds are unchanged, so nothing was traded away', () => {
    const { propose } = sealAutomaticActions([act('downgrade'), act('shave')]);
    expect(propose.map((a) => a.kind).sort()).toEqual(['downgrade', 'shave']);
  });

  it('THE DISTRIBUTION · the lane is no longer one-directional', () => {
    // The finding, as a number. Before: 0 of 4 kinds could increase load.
    const increases = ['mark_upgrade'] as const;
    const decreases = ['downgrade', 'shave'] as const;
    for (const k of increases) expect(PROPOSABLE_KINDS.has(k), k).toBe(true);
    for (const k of decreases) expect(PROPOSABLE_KINDS.has(k), k).toBe(true);
  });

  it('an action with no workout to hang a card on is still RECORDED, not dropped', () => {
    // Rule 11: a dropped action is a lost fact, not a refusal. This is the
    // clause the seam already got right and it must survive the change.
    const { propose, recorded, apply } = sealAutomaticActions([act('mark_upgrade', false)]);
    expect(propose).toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(apply).toHaveLength(1);
  });

  it('the SEAM IS UNTOUCHED · proposing is not authorising', () => {
    // The whole point. A proposal changes nothing; the runner accepting it
    // does. This must stay false or the change means something else entirely.
    expect(AUTOMATIC_ADAPTATION_AUTHORITY).toBe(false);
    expect(automaticPlanMutationIsAuthorised()).toBe(false);
  });

  it('`recompute_paces` is deliberately absent · it has no single workout', () => {
    expect(PROPOSABLE_KINDS.has('recompute_paces')).toBe(false);
    expect(PROPOSABLE_KINDS.has('mark_dirty')).toBe(false);
  });
});
