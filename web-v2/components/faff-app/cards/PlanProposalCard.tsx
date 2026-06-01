'use client';

/**
 * PlanProposalCard · render one row of seed.planProposals.
 *
 * Two visual modes, dispatched off PlanProposalSeed.status:
 *
 *   pending      · soft drift (volume / VDOT / staleness). Card with
 *                  Accept + Dismiss buttons. POSTs to
 *                  /api/plan/proposal {id, action: 'accept'|'dismiss'}.
 *                  Accept regenerates the plan; dismiss respects 14 days.
 *
 *   auto_applied · hard drift (race date / goal time / A-race add/remove).
 *                  Plan ALREADY rebuilt. Renders as a passive notification
 *                  with no buttons · optionally a "see what changed" link
 *                  to the new plan_id (deep-link to /training/plans/<id>).
 *                  Per David default 2026-06-01, the card stays up for
 *                  24h then a future cleanup hides it · for now it just
 *                  sticks until backend marks it superseded.
 *
 *   accepted, dismissed, superseded · not rendered (loader filters them).
 *
 * Tone (locked): coach voice, short, direct. No exclamation marks, no
 * emoji, no em dashes. Middot · for separators. Reasons are surfaced
 * inline from PlanProposalSeed.message (always populated by backend).
 *
 * Source brief · designs/briefs/backend-state-2026-06-01-landed.md §"Card
 * render matrix" · plan-auto-adapt-backend-landed.md for the full lifecycle.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PlanProposalSeed } from '../types';

type ActionState = 'idle' | 'accepting' | 'dismissing' | 'done' | 'error';

const KIND_LABELS: Record<PlanProposalSeed['kind'], string> = {
  volume_drift:      'Volume off plan',
  vdot_drift:        'Fitness moved',
  staleness:         'Plan getting stale',
  race_date_changed: 'Race date changed',
  goal_time_changed: 'Goal time updated',
  a_race_added:      'Goal race added',
  a_race_removed:    'Goal race removed',
};

const KIND_EYEBROWS: Record<PlanProposalSeed['kind'], string> = {
  volume_drift:      'VOLUME · DRIFT',
  vdot_drift:        'FITNESS · DRIFT',
  staleness:         'PLAN · STALE',
  race_date_changed: 'RACE · DATE',
  goal_time_changed: 'RACE · GOAL',
  a_race_added:      'RACE · ADDED',
  a_race_removed:    'RACE · REMOVED',
};

export function PlanProposalCard({ proposal }: { proposal: PlanProposalSeed }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isPending = proposal.status === 'pending';
  const isAutoApplied = proposal.status === 'auto_applied';

  // accepted / dismissed / superseded should not have reached this far
  // (loader filters), but guard so a future bug doesn't render an
  // orphan card.
  if (!isPending && !isAutoApplied) return null;
  if (state === 'done') return null;

  async function act(action: 'accept' | 'dismiss') {
    setState(action === 'accept' ? 'accepting' : 'dismissing');
    setErrorMsg(null);
    try {
      const r = await fetch('/api/plan/proposal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: proposal.id, action }),
      });
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (!r.ok && !(j as { ok?: boolean }).ok) {
        const errStr = typeof (j as { error?: unknown }).error === 'string'
          ? (j as { error: string }).error
          : `HTTP ${r.status}`;
        throw new Error(errStr);
      }
      setState('done');
      router.refresh();
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = state === 'accepting' || state === 'dismissing';
  const eyebrow = KIND_EYEBROWS[proposal.kind] ?? 'PLAN · UPDATE';
  const headline = KIND_LABELS[proposal.kind] ?? 'Plan update';

  // Pending = amber/warn gradient (action needed). Auto-applied = teal
  // (passive notification, recovery palette · the system did the work).
  const palette = isPending
    ? {
        bgGrad: 'linear-gradient(135deg, rgba(255,206,138,0.14), rgba(255,206,138,0.04))',
        border: 'rgba(255,206,138,0.42)',
        eyebrow: '#FFCE8A',
        accept: '#F3AD38',
      }
    : {
        bgGrad: 'linear-gradient(135deg, rgba(72,179,181,0.12), rgba(72,179,181,0.03))',
        border: 'rgba(72,179,181,0.32)',
        eyebrow: '#48B3B5',
        accept: '#48B3B5',
      };

  return (
    <div
      role="region"
      aria-label={isPending ? 'Plan proposal' : 'Plan auto-rebuild notice'}
      style={{
        background: palette.bgGrad,
        border: `1px solid ${palette.border}`,
        borderRadius: 14,
        padding: '16px 18px',
        margin: '14px 24px 0',
      }}
    >
      <div style={{
        fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
        color: palette.eyebrow, marginBottom: 8,
      }}>
        {eyebrow}{isAutoApplied ? ' · APPLIED' : ''}
      </div>

      <div style={{
        fontFamily: 'var(--f-display, "Bebas Neue", Inter, sans-serif)',
        fontSize: 24, lineHeight: 1.1, color: 'var(--ink, #fff)',
        marginBottom: 8, letterSpacing: '0.01em',
      }}>
        {headline}
      </div>

      {proposal.message ? (
        <div style={{
          fontSize: 13, color: 'var(--ink, #fff)', lineHeight: 1.55,
          marginBottom: isPending ? 14 : (proposal.newPlanId ? 12 : 0),
          opacity: 0.92,
        }}>
          {proposal.message}
        </div>
      ) : null}

      {isPending ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => act('accept')}
            style={{
              flex: 1, minWidth: 180,
              background: palette.accept,
              color: '#1a140a',
              border: 'none',
              borderRadius: 8,
              padding: '11px 14px',
              fontFamily: 'var(--f-body, Inter, sans-serif)',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {state === 'accepting' ? 'REBUILDING…' : 'ACCEPT · REBUILD PLAN'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act('dismiss')}
            style={{
              flex: 1, minWidth: 160,
              background: 'transparent',
              color: 'var(--ink, #fff)',
              border: '1px solid var(--line, rgba(255,255,255,0.18))',
              borderRadius: 8,
              padding: '11px 14px',
              fontFamily: 'var(--f-body, Inter, sans-serif)',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {state === 'dismissing' ? 'NOTING…' : 'DISMISS · KEEP CURRENT'}
          </button>
        </div>
      ) : null}

      {/* auto_applied: optional deep-link to the rebuilt plan. The link
          uses newPlanId; if backend left it null we skip the link rather
          than render a dead chevron. */}
      {isAutoApplied && proposal.newPlanId ? (
        <a
          href={`/training`}
          onClick={(e) => {
            // Stay on Today + just refresh so the new plan flows through
            // the seed loader · cheaper than a full nav.
            e.preventDefault();
            router.refresh();
          }}
          style={{
            display: 'inline-block',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
            color: palette.eyebrow,
            textDecoration: 'none',
            paddingTop: 2,
          }}
        >
          SEE THE NEW PLAN ›
        </a>
      ) : null}

      {state === 'error' && errorMsg ? (
        <div style={{ marginTop: 10, fontSize: 11, color: '#FC4D64' }}>
          Could not save: {errorMsg}
        </div>
      ) : null}
    </div>
  );
}
