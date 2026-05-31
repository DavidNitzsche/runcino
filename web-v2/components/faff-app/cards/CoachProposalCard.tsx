'use client';

/**
 * CoachProposalCard — accept/decline UI for a coach_proposals DB row
 * (injury_adjust / illness_adjust). Distinct from the inline workout-swap
 * ProposalCard in components/cards/ — that one POSTs to /api/coach/proposal;
 * this one POSTs to /api/coach/proposal/[id]/{accept,decline}.
 *
 * Visual treatment matches the "coach watching" gradient (warn/race palette)
 * because both proposal types are triggered by something the runner needs
 * to react to (illness / injury) — they're not casual suggestions.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Proposal = {
  id: number;
  proposal_type: string;
  reason: string;
  suggested: string;
  evidence: Record<string, unknown>;
  created_at: string;
};

type ActionState = 'idle' | 'accepting' | 'declining' | 'done' | 'error';

export function CoachProposalCard({ proposal }: { proposal: Proposal }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function act(action: 'accept' | 'decline') {
    setState(action === 'accept' ? 'accepting' : 'declining');
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/coach/proposal/${proposal.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

  if (state === 'done') return null;

  const busy = state === 'accepting' || state === 'declining';
  const isInjury = proposal.proposal_type === 'injury_adjust';
  const isIllness = proposal.proposal_type === 'illness_adjust';
  const eyebrow = isInjury ? 'INJURY · COACH PROPOSAL'
    : isIllness ? 'ILLNESS · COACH PROPOSAL'
    : 'COACH PROPOSAL';
  const headline = isInjury ? 'Switch to injury-return plan'
    : isIllness ? 'Acknowledge recovery week'
    : 'Coach proposal';
  const acceptCopy = isInjury ? 'ACCEPT · BUILD INJURY PLAN'
    : isIllness ? 'ACCEPT · DROP QUALITY'
    : 'ACCEPT';
  const declineCopy = 'STICK WITH CURRENT PLAN';

  // Race-warn gradient: signals "something happened, you need to decide."
  return (
    <div
      role="region"
      aria-label="Coach proposal"
      style={{
        background: 'linear-gradient(135deg, rgba(252,77,100,0.14), rgba(252,77,100,0.04))',
        border: '1px solid rgba(252,77,100,0.4)',
        borderRadius: 14,
        padding: '16px 18px',
        margin: '14px 24px 0',
      }}
    >
      <div style={{
        fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
        color: '#FC4D64', marginBottom: 8,
      }}>
        {eyebrow}
      </div>

      <div style={{
        fontFamily: 'var(--f-display, "Bebas Neue", Inter, sans-serif)',
        fontSize: 24, lineHeight: 1.1, color: 'var(--ink, #fff)',
        marginBottom: 8, letterSpacing: '0.01em',
      }}>
        {headline}
      </div>

      {proposal.reason ? (
        <div style={{
          fontSize: 12, color: 'var(--mute, #8B95A7)', lineHeight: 1.5,
          marginBottom: 8,
        }}>
          What we noticed: {proposal.reason}
        </div>
      ) : null}

      {proposal.suggested ? (
        <div style={{
          fontSize: 13, color: 'var(--ink, #fff)', lineHeight: 1.55,
          marginBottom: 14, opacity: 0.9,
        }}>
          {proposal.suggested}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => act('accept')}
          style={{
            flex: 1, minWidth: 180,
            background: '#FC4D64',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '11px 14px',
            fontFamily: 'var(--f-body, Inter, sans-serif)',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {state === 'accepting' ? 'BUILDING…' : acceptCopy}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act('decline')}
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
          {state === 'declining' ? 'NOTING…' : declineCopy}
        </button>
      </div>

      {state === 'error' && errorMsg ? (
        <div style={{ marginTop: 10, fontSize: 11, color: '#FC4D64' }}>
          Could not save: {errorMsg}
        </div>
      ) : null}
    </div>
  );
}
