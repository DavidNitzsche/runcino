/**
 * PROPOSEUP-2 · THE UPWARD LEVER MUST BE ABLE TO REACH THE RUNNER.
 *
 * Rule 21 measured 309 production intents and zero upward adaptations, and the
 * mechanism behind that number was not one bug. It was three, in series:
 *
 *   1 · `PROPOSABLE_KINDS` held no upward kind, so an upgrade could not be
 *       offered — only applied, or dropped. (Closed by PROPOSEUP-1.)
 *   2 · `tryAdaptiveBump` returns null before reading anything while the seam
 *       is closed, so the detector had no consumer at all.
 *   3 · the proposal payload had no field for a target distance, so even a
 *       `mark_upgrade` that WAS written produced a card the accept path could
 *       not act on.
 *
 * Any one of them left in place makes the other two pointless, which is why
 * this file checks all three.
 *
 * WHAT IT CANNOT FAIL ON (Rule 22):
 *   · Whether the ramp detector's THRESHOLDS are right. It checks that a
 *     detection can travel, not that detections are correctly made.
 *   · Whether the runner ever taps Accept. A card raised is not a plan changed,
 *     and this file deliberately cannot tell those apart — the ledger must.
 *   · Whether the cron calls any of this on a schedule (Rule 23's question).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROPOSABLE_KINDS } from './adaptation-authority';
import { actionFromPending } from '@/lib/brain/proposal/staleness';
import { plannedWrites } from '@/lib/brain/proposal/execute';

const SRC = readFileSync(join(process.cwd(), 'lib/plan/adaptive-ramp.ts'), 'utf8');

describe('PROPOSEUP-2 · the offer path exists and cannot write the plan', () => {
  it('reads the module it audits', () => {
    // Liveness (Rule 18): a scan that reports clean on an empty read is the
    // worst outcome available, because it also reports confidence.
    expect(SRC.length).toBeGreaterThan(2000);
    expect(SRC).toContain('proposeAdaptiveBump');
  });

  it('a closed seam routes to the proposer instead of returning nothing', () => {
    const seam = SRC.indexOf('if (!automaticPlanMutationIsAuthorised())');
    expect(seam).toBeGreaterThan(-1);
    const branch = SRC.slice(seam, seam + 240);
    expect(branch, 'the closed-seam branch no longer offers the bump')
      .toContain('proposeAdaptiveBump');
  });

  it('the proposer cannot reach applyAdaptations', () => {
    /* The seal's guarantee is that this entry point has NO path to the plan
     * writer. That was a comment; this is the check. The proposer's body may
     * name `writeWorkoutProposals` and must not name `applyAdaptations` — a
     * dynamic import is still a path, so matching on the text is the right
     * granularity here. */
    const start = SRC.indexOf('export async function proposeAdaptiveBump');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start);
    expect(body).toContain('writeWorkoutProposals');
    expect(body, 'the offer path can reach the plan writer').not.toContain('applyAdaptations');
  });

  it('applies the same pull-back guard to the offer as to the write', () => {
    // Offering more the morning after the engine took work away is incoherent
    // whether or not the runner gets a say.
    const start = SRC.indexOf('export async function proposeAdaptiveBump');
    const body = SRC.slice(start);
    expect(body).toContain('pullbackBlocksBump');
    expect(body).toContain('pullback.failed');
  });

  it('the upward kind is proposable at all', () => {
    expect(PROPOSABLE_KINDS.has('mark_upgrade')).toBe(true);
  });

  it('the proposal WRITER puts the target distance in the payload', () => {
    /* Added because falsifying this file caught it missing: deleting
     * `newDistanceMi` from the payload construction broke nothing. Every other
     * test here reads a payload that already has the field, so they all passed
     * while the only code that PRODUCES one had stopped writing it — a card
     * that renders "Add to Thursday" and cannot be accepted.
     *
     * Rule 18's whole point: a gate that has never been made to fail is a
     * hypothesis, and this one was, twice, before it was worth anything. */
    const wp = readFileSync(join(process.cwd(), 'lib/plan/workout-proposals.ts'), 'utf8');
    expect(wp.length).toBeGreaterThan(2000);
    const start = wp.indexOf('const payload = {');
    expect(start).toBeGreaterThan(-1);
    const payload = wp.slice(start, wp.indexOf('};', start));
    expect(payload, 'an upgrade proposal is written with no distance to apply')
      .toContain('newDistanceMi');
    expect(payload).toContain('bumpForRow');
  });

  it('the proposal WRITER records the session as it stands, for the staleness check', () => {
    const wp = readFileSync(join(process.cwd(), 'lib/plan/workout-proposals.ts'), 'utf8');
    expect(wp).toContain('planned_distance_mi: row.distance_mi');
    expect(wp).toContain('planned_type: row.type');
  });
});

describe('PROPOSEUP-2 · an offered upgrade must be acceptable', () => {
  const row = {
    actionKind: 'mark_upgrade',
    planWorkoutId: 'pw_1',
    workoutDateISO: '2026-09-27',
    evidence: { planned_type: 'long', planned_distance_mi: 17 },
  };

  it('a bump carrying its target distance resolves to a real write', () => {
    const action = actionFromPending({ ...row, actionPayload: { newDistanceMi: 18 } });
    expect(action).not.toBeNull();
    const plan = plannedWrites(action!);
    expect(plan.nonMutating).toBe(false);
    if (!plan.nonMutating) {
      expect(plan.writes).toHaveLength(1);
      expect(plan.writes[0]).toMatchObject({ op: 'update', set: { distance_mi: 18 } });
    }
  });

  it('a bump with no target distance is refused, not silently applied as nothing', () => {
    // This is the defect the payload fix closes: the card rendered, the runner
    // tapped, and there was no number to write. Refusing out loud is the only
    // honest outcome — `{ ok: true, applied: 0 }` is the shape this repo has
    // been burned by.
    const action = actionFromPending({ ...row, actionPayload: {} });
    expect(action).not.toBeNull();
    const plan = plannedWrites(action!);
    expect(plan.nonMutating).toBe(true);
    if (plan.nonMutating) expect(plan.because).toContain('no target distance');
  });

  it('reads as a push, not as a pull-back', () => {
    const action = actionFromPending({ ...row, actionPayload: { newDistanceMi: 18 } });
    expect(action!.direction).toBe('MORE');
  });
});
