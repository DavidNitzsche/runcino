/**
 * decision-cards.test · deck Decision 2 · the one interruption grammar.
 *
 * What these lock:
 *   · kind is derived, never passed in (pending → decision, auto_applied
 *     and adaptations → notice)
 *   · decisions outrank notices no matter what order the loaders ran in
 *   · the ACCEPT / KEEP button grammar holds on every decision
 *   · both endpoints the deck said must keep working are still wired
 *   · pager selection: silent at one, 1-based and counting at many
 *
 * The bug class this exists to prevent: a "unified" card that quietly
 * reintroduces per-source dressing, or a priority sort that lets a
 * passive "we already did this" notice bury an injury proposal.
 */
import { describe, it, expect } from 'vitest';
import {
  selectCoachDecisions,
  decisionAccent,
  pagerLabel,
  TARGETS_OWNED_PLAN_KINDS,
  workoutDayLabel,
  workoutActionPhrase,
  type CoachProposalInput,
  type PlanProposalInput,
  type WorkoutProposalInput,
  type AdaptationInput,
} from './decision-cards';

const TODAY = '2026-08-17';

const injury: CoachProposalInput = {
  id: 7,
  proposal_type: 'injury_adjust',
  reason: 'Three runs cut short with the same calf note.',
  suggested: 'Two weeks of the injury-return progression, then reassess.',
  created_at: '2026-08-16T14:00:00Z',
};

const pendingDrift: PlanProposalInput = {
  id: 21,
  kind: 'volume_drift',
  status: 'pending',
  message: 'You are running 22 percent under the plan across four weeks.',
  createdAt: '2026-08-15T09:00:00Z',
};

const appliedRebuild: PlanProposalInput = {
  id: 22,
  kind: 'race_date_changed',
  status: 'auto_applied',
  message: 'CIM moved a week. The block was rebuilt around the new date.',
  createdAt: '2026-08-14T09:00:00Z',
  newPlanId: 'plan-new',
  previousPlanId: 'plan-old',
};

const swap: WorkoutProposalInput = {
  id: 33,
  workoutDateISO: '2026-08-18',
  actionKind: 'downgrade',
  actionPayload: { newType: 'easy' },
  reason: 'HRV at or below baseline five days running.',
  createdAt: '2026-08-17T05:00:00Z',
};

const adapted: AdaptationInput = {
  ts: '2026-08-14T18:00:00Z',
  summary: 'Sunday long run moved to Saturday.',
  severity: 'info',
};

describe('kind is derived from the row, not the source', () => {
  it('pending plan drift is a decision, auto-applied is a notice', () => {
    const q = selectCoachDecisions({
      planProposals: [pendingDrift, appliedRebuild],
      todayISO: TODAY,
    });
    const byKey = Object.fromEntries(q.map((d) => [d.key, d]));
    expect(byKey['plan-21'].kind).toBe('decision');
    expect(byKey['plan-22'].kind).toBe('notice');
  });

  it('resolved plan rows never interrupt at all', () => {
    for (const status of ['accepted', 'dismissed', 'superseded', 'expired']) {
      const q = selectCoachDecisions({
        planProposals: [{ ...pendingDrift, status }],
        todayISO: TODAY,
      });
      expect(q).toHaveLength(0);
    }
  });

  it('adaptation intents are always notices', () => {
    const q = selectCoachDecisions({ adaptations: [adapted], todayISO: TODAY });
    expect(q[0].kind).toBe('notice');
    expect(q[0].eyebrow).toBe('COACH · APPLIED');
  });

  it('eyebrow copy is kind-driven and only ever takes two values', () => {
    const q = selectCoachDecisions({
      coachProposals: [injury],
      planProposals: [pendingDrift, appliedRebuild],
      workoutProposals: [swap],
      adaptations: [adapted],
      todayISO: TODAY,
    });
    const eyebrows = new Set(q.map((d) => d.eyebrow));
    expect(eyebrows).toEqual(new Set(['COACH · NEEDS A DECISION', 'COACH · APPLIED']));
  });

  it('accent is amber for decisions and recovery blue for notices', () => {
    expect(decisionAccent('decision')).toBe('#F3AD38');
    expect(decisionAccent('notice')).toBe('#27B4E0');
  });
});

describe('decisions outrank notices', () => {
  it('every decision precedes every notice regardless of input order', () => {
    const q = selectCoachDecisions({
      // deliberately worst case: notices fed first, decisions last
      adaptations: [adapted],
      planProposals: [appliedRebuild, pendingDrift],
      workoutProposals: [swap],
      coachProposals: [injury],
      todayISO: TODAY,
    });
    const kinds = q.map((d) => d.kind);
    const firstNotice = kinds.indexOf('notice');
    expect(firstNotice).toBeGreaterThan(-1);
    expect(kinds.slice(firstNotice).every((k) => k === 'notice')).toBe(true);
  });

  it('an injury proposal is never buried by an applied notice', () => {
    const q = selectCoachDecisions({
      adaptations: [adapted],
      planProposals: [appliedRebuild],
      coachProposals: [injury],
      todayISO: TODAY,
    });
    expect(q[0].source).toBe('coach_proposal');
  });

  it('within decisions the ladder is coach, then plan, then workout', () => {
    const q = selectCoachDecisions({
      workoutProposals: [swap],
      planProposals: [pendingDrift],
      coachProposals: [injury],
      todayISO: TODAY,
    });
    expect(q.map((d) => d.source)).toEqual([
      'coach_proposal', 'plan_proposal', 'workout_proposal',
    ]);
  });

  it('ordering is stable across repeated selection', () => {
    const input = {
      coachProposals: [injury],
      planProposals: [pendingDrift, appliedRebuild],
      workoutProposals: [swap],
      adaptations: [adapted],
      todayISO: TODAY,
    };
    const a = selectCoachDecisions(input).map((d) => d.key);
    const b = selectCoachDecisions(input).map((d) => d.key);
    expect(a).toEqual(b);
  });
});

describe('one button grammar', () => {
  it('every decision offers exactly one ACCEPT and one KEEP', () => {
    const q = selectCoachDecisions({
      coachProposals: [injury],
      planProposals: [pendingDrift],
      workoutProposals: [swap],
      todayISO: TODAY,
    });
    for (const d of q) {
      const roles = d.actions.map((a) => a.role);
      expect(roles).toEqual(['accept', 'keep']);
      expect(d.actions[0].label.startsWith('ACCEPT')).toBe(true);
      expect(d.actions[1].label.startsWith('KEEP')).toBe(true);
    }
  });

  it('notices never ask the runner to accept or keep anything', () => {
    // 2026-08-25 · this used to read "only a quiet link", and the rule behind
    // it was: a notice already happened, so there is nothing to decide. That
    // held while an applied change was irreversible. It is not any more — the
    // ruling was "apply, but let me undo" — so a notice may now carry an UNDO
    // alongside its link.
    //
    // What has NOT changed, and is the part actually worth locking: a notice
    // never carries ACCEPT or KEEP. Those two are the vocabulary of a decision
    // the coach is waiting on, and offering "KEEP THE CURRENT PLAN" against a
    // change that already landed would be offering to keep the very thing the
    // runner is trying to get rid of.
    const q = selectCoachDecisions({
      planProposals: [appliedRebuild],
      adaptations: [adapted],
      todayISO: TODAY,
    });
    for (const d of q) {
      expect(d.kind).toBe('notice');
      for (const a of d.actions) {
        expect(a.role === 'link' || a.role === 'undo', `unexpected role ${a.role} on a notice`).toBe(true);
      }
    }
    const applied = q.find((d) => d.key === 'plan-22')!;
    expect(applied.actions.find((a) => a.role === 'link')!.href)
      .toBe('/training/plans/plan-new/diff?from=plan-old');
    expect(applied.actions.find((a) => a.role === 'undo')!.label).toBe('PUT THE OLD BLOCK BACK');

    // An auto-applied row with nowhere to link renders no button at all rather
    // than a dead one — and no undo either, because the missing `newPlanId` is
    // exactly the pairing the undo route needs to reverse the swap.
    const noLink = selectCoachDecisions({
      planProposals: [{ ...appliedRebuild, newPlanId: null }],
      todayISO: TODAY,
    });
    expect(noLink[0].actions).toHaveLength(0);
  });

  it('no button copy carries an em dash, an exclamation or an emoji', () => {
    const q = selectCoachDecisions({
      coachProposals: [injury],
      planProposals: [pendingDrift, appliedRebuild],
      workoutProposals: [swap],
      adaptations: [adapted],
      todayISO: TODAY,
    });
    for (const d of q) {
      for (const text of [d.title, ...d.actions.map((a) => a.label)]) {
        expect(text).not.toMatch(/—|!|\p{Extended_Pictographic}/u);
      }
    }
  });
});

describe('both endpoints the deck required stay wired', () => {
  it('plan proposals still POST {id, action} to /api/plan/proposal', () => {
    const [d] = selectCoachDecisions({ planProposals: [pendingDrift], todayISO: TODAY });
    expect(d.actions[0].endpoint).toBe('/api/plan/proposal');
    expect(d.actions[0].body).toEqual({ id: 21, action: 'accept' });
    expect(d.actions[1].endpoint).toBe('/api/plan/proposal');
    expect(d.actions[1].body).toEqual({ id: 21, action: 'dismiss' });
  });

  it('coach proposals still POST to /api/coach/proposal/[id]/accept', () => {
    const [d] = selectCoachDecisions({ coachProposals: [injury], todayISO: TODAY });
    expect(d.actions[0].endpoint).toBe('/api/coach/proposal/7/accept');
    expect(d.actions[1].endpoint).toBe('/api/coach/proposal/7/decline');
  });

  it('workout proposals still POST to the per-id accept and dismiss routes', () => {
    const [d] = selectCoachDecisions({ workoutProposals: [swap], todayISO: TODAY });
    expect(d.actions[0].endpoint).toBe('/api/plan/workout-proposals/33/accept');
    expect(d.actions[1].endpoint).toBe('/api/plan/workout-proposals/33/dismiss');
  });

  it('keys are source-scoped so ids from different tables cannot collide', () => {
    const q = selectCoachDecisions({
      coachProposals: [{ ...injury, id: 1 }],
      planProposals: [{ ...pendingDrift, id: 1 }],
      workoutProposals: [{ ...swap, id: 1 }],
      todayISO: TODAY,
    });
    expect(new Set(q.map((d) => d.key)).size).toBe(3);
  });
});

describe('surface-owned kinds do not double-ask', () => {
  const outlook: PlanProposalInput = {
    id: 44,
    kind: 'goal_outlook',
    status: 'pending',
    message: 'This build projects 3:22:17. The 3:00:00 stays on the board as the season ambition.',
    createdAt: '2026-08-16T09:00:00Z',
  };
  // The owner's standing prod row, retired kind and all. It must keep
  // rendering, and it must render as a NOTICE.
  const retired: PlanProposalInput = { ...outlook, id: 57, kind: 'goal_renegotiation' };

  it('both goal-outlook kinds are in the Targets-owned list', () => {
    expect(TARGETS_OWNED_PLAN_KINDS).toContain('goal_outlook');
    expect(TARGETS_OWNED_PLAN_KINDS).toContain('goal_renegotiation');
  });

  it('Today excludes them so the runner is not told the same thing twice', () => {
    // Wave 2 mounts these inside THE PATH on Targets, beside the number they
    // speak about. Today must not render them as generic plan proposals.
    const q = selectCoachDecisions({
      planProposals: [outlook, retired, pendingDrift],
      excludeKinds: TARGETS_OWNED_PLAN_KINDS,
      todayISO: TODAY,
    });
    expect(q.map((d) => d.key)).toEqual(['plan-21']);
  });

  it('without the exclusion it still renders · the filter is the caller’s call', () => {
    const q = selectCoachDecisions({ planProposals: [outlook], todayISO: TODAY });
    expect(q).toHaveLength(1);
    expect(q[0].title).toBe('Where this build projects');
  });

  // 2026-08-30 · THE VIOLATION, ASSERTED AS A SHAPE.
  //
  // A pending `goal_renegotiation` used to come out of here as kind
  // 'decision' with `ACCEPT · MOVE THE TARGET` wired to POST
  // /api/plan/proposal { action: 'accept' }. The owner's locked rule: the
  // coach projects, it never renegotiates a stated goal via a card or a
  // button. Both goal-outlook kinds are notices with one KEEP.
  it('neither goal-outlook kind can produce an accept action', () => {
    for (const p of [outlook, retired]) {
      const [d] = selectCoachDecisions({ planProposals: [p], todayISO: TODAY });
      expect(d.kind).toBe('notice');
      expect(d.actions.map((a) => a.role)).toEqual(['keep']);
      expect(d.actions[0].body).toEqual({ id: p.id, action: 'dismiss' });
      expect(JSON.stringify(d)).not.toMatch(/goalSec|renegotiate|MOVE THE TARGET|REVISED TARGET/i);
    }
  });

  it('a writer-composed accept_verb cannot buy an informational kind a button', () => {
    // `reasons.accept_verb` is the RACEROLE-1 escape hatch that lets a writer
    // name its own verb. The informational branch is taken before it is read,
    // so a row carrying one still renders as a notice.
    const [d] = selectCoachDecisions({
      planProposals: [{ ...retired, reasons: { accept_verb: 'MOVE THE TARGET' } }],
      todayISO: TODAY,
    });
    expect(d.kind).toBe('notice');
    expect(d.actions.every((a) => a.role !== 'accept')).toBe(true);
  });

  it('excluding a kind never removes an unrelated one', () => {
    const q = selectCoachDecisions({
      coachProposals: [injury],
      planProposals: [outlook, appliedRebuild],
      workoutProposals: [swap],
      excludeKinds: TARGETS_OWNED_PLAN_KINDS,
      todayISO: TODAY,
    });
    expect(q.map((d) => d.key)).toEqual(['coach-7', 'workout-33', 'plan-22']);
  });
});

describe('pager selection', () => {
  it('stays silent when one item waits', () => {
    expect(pagerLabel(0, 1)).toBeNull();
    expect(pagerLabel(0, 0)).toBeNull();
  });

  it('counts from one and names the total', () => {
    expect(pagerLabel(0, 2)).toBe('1 OF 2 WAITING ›');
    expect(pagerLabel(1, 2)).toBe('2 OF 2 WAITING ›');
    expect(pagerLabel(2, 4)).toBe('3 OF 4 WAITING ›');
  });

  it('the queue length the pager reports is the whole queue, not one kind', () => {
    const q = selectCoachDecisions({
      coachProposals: [injury],
      planProposals: [pendingDrift, appliedRebuild],
      workoutProposals: [swap],
      adaptations: [adapted],
      todayISO: TODAY,
    });
    expect(q).toHaveLength(5);
    expect(pagerLabel(0, q.length)).toBe('1 OF 5 WAITING ›');
  });
});

describe('workout proposal phrasing', () => {
  it('names the day relative to today', () => {
    expect(workoutDayLabel('2026-08-17', TODAY)).toBe('Today’s');
    expect(workoutDayLabel('2026-08-18', TODAY)).toBe('Tomorrow’s');
    expect(workoutDayLabel('2026-08-20', TODAY)).toBe('Thursday’s');
  });

  it('phrases each action kind concretely', () => {
    expect(workoutActionPhrase(swap)).toBe('swap to easy');
    expect(workoutActionPhrase({
      ...swap, actionKind: 'shave', actionPayload: { shaveFraction: 0.2 },
    })).toBe('trim by 20%');
    expect(workoutActionPhrase({
      ...swap, actionKind: 'field_test', actionPayload: {},
    })).toBe('run as a 30 minute field test');
    expect(workoutActionPhrase({
      ...swap, actionKind: 'reschedule', actionPayload: { newDate: '2026-08-22' },
    })).toBe('move to Sat, Aug 22');
  });

  it('the accept button repeats the same phrase the title used', () => {
    const [d] = selectCoachDecisions({ workoutProposals: [swap], todayISO: TODAY });
    expect(d.title).toBe('Tomorrow’s workout could swap to easy');
    expect(d.actions[0].label).toBe('ACCEPT · SWAP TO EASY');
  });
});

describe('empty and missing input', () => {
  it('no sources means no queue', () => {
    expect(selectCoachDecisions({})).toEqual([]);
    expect(selectCoachDecisions({
      coachProposals: null, planProposals: null,
      workoutProposals: null, adaptations: null,
    })).toEqual([]);
  });
});
