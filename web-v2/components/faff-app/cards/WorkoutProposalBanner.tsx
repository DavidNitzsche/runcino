'use client';

/**
 * WorkoutProposalBanner · per-workout adapter proposal card.
 *
 * Renders one row of seed.pendingWorkoutProposals. The runner sees:
 *   · The proposed change ("Tomorrow's tempo → easy")
 *   · The reason ("HRV at or below baseline 5 days running")
 *   · Two buttons · [LET IT HAPPEN] (accept) · [KEEP ORIGINAL] (dismiss)
 *
 * David 2026-06-04 · "I dont want to wake up to change runs · that
 * was annoying." This card lets the runner gate the change before it
 * lands on plan_workouts.
 *
 * POSTs to /api/plan/workout-proposals/:id/accept or /dismiss.
 * On success · the card UI flips to a done state and the runner can
 * refresh to see the applied/unchanged plan.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Proposal = NonNullable<import('../types').FaffSeed['pendingWorkoutProposals']>[number];

type ActionState = 'idle' | 'accepting' | 'dismissing' | 'done' | 'error';

function dayLabelFor(iso: string, todayISO: string, tomorrowISO: string): string {
  if (iso === todayISO) return "Today's";
  if (iso === tomorrowISO) return "Tomorrow's";
  const d = new Date(iso + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', timeZone: 'UTC',
  }).format(d) + "'s";
}

function actionPhrase(p: Proposal): string {
  if (p.actionKind === 'downgrade') {
    const newType = p.actionPayload.newType ?? 'easy';
    return `swap to ${newType}`;
  }
  if (p.actionKind === 'shave') {
    const frac = p.actionPayload.shaveFraction ?? 0.15;
    return `trim by ${Math.round(frac * 100)}%`;
  }
  if (p.actionKind === 'reschedule') {
    return p.actionPayload.newDate
      ? `move to ${new Date(p.actionPayload.newDate + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`
      : 'reschedule';
  }
  return 'adjust';
}

export function WorkoutProposalBanner({ proposal }: { proposal: Proposal }) {
  const [state, setState] = useState<ActionState>('idle');
  const [resolved, setResolved] = useState<'accepted' | 'dismissed' | null>(null);
  const router = useRouter();

  const todayISO = new Date().toISOString().slice(0, 10);
  const tomorrowISO = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const dayLabel = dayLabelFor(proposal.workoutDateISO, todayISO, tomorrowISO);
  const phrase = actionPhrase(proposal);

  const handleAccept = async () => {
    setState('accepting');
    try {
      const r = await fetch(`/api/plan/workout-proposals/${proposal.id}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setState('error');
        return;
      }
      setResolved('accepted');
      setState('done');
      router.refresh();
    } catch {
      setState('error');
    }
  };

  const handleDismiss = async () => {
    setState('dismissing');
    try {
      const r = await fetch(`/api/plan/workout-proposals/${proposal.id}/dismiss`, {
        method: 'POST',
        credentials: 'include',
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setState('error');
        return;
      }
      setResolved('dismissed');
      setState('done');
      router.refresh();
    } catch {
      setState('error');
    }
  };

  if (state === 'done' && resolved) {
    return (
      <div className="wpb wpb-done">
        <div className="wpb-eyebrow">
          {resolved === 'accepted' ? '✓ PLAN UPDATED' : '✓ PLAN UNCHANGED'}
        </div>
        <div className="wpb-body">
          {resolved === 'accepted'
            ? `${dayLabel} workout updated · ${phrase}.`
            : `${dayLabel} workout stays as planned.`}
        </div>
      </div>
    );
  }

  const isPosting = state === 'accepting' || state === 'dismissing';

  return (
    <div className="wpb">
      <div className="wpb-eyebrow">COACH · PROPOSED</div>
      <div className="wpb-headline">
        Want to {phrase} on {dayLabel} workout?
      </div>
      <div className="wpb-reason">{proposal.reason}</div>
      <div className="wpb-actions">
        <button
          type="button"
          className="wpb-btn wpb-accept"
          onClick={handleAccept}
          disabled={isPosting}
        >
          {state === 'accepting' ? 'UPDATING…' : 'LET IT HAPPEN'}
        </button>
        <button
          type="button"
          className="wpb-btn wpb-dismiss"
          onClick={handleDismiss}
          disabled={isPosting}
        >
          {state === 'dismissing' ? 'KEEPING…' : 'KEEP ORIGINAL'}
        </button>
      </div>
      {state === 'error' ? (
        <div className="wpb-error">Something went wrong · try again in a moment.</div>
      ) : null}
    </div>
  );
}
