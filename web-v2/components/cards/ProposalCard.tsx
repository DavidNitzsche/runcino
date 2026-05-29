'use client';

/**
 * ProposalCard — actionable swap recommendation from the coach.
 *
 * P-COACH-PROPOSAL-1. Renders below the CoachBlock on /today when the
 * briefing response carries a `proposed_alternative` field. Two buttons:
 *
 *   ACCEPT · SWAP    → POST /api/coach/proposal {action:'accept'},
 *                      which PATCHes today's plan_workouts row to the
 *                      proposed alt. Brief is cache-busted; next render
 *                      reflects the swap.
 *
 *   STICK WITH PLAN  → POST /api/coach/proposal {action:'decline'},
 *                      which writes a swap_declined coach_intent. The
 *                      coach reads pendingIntents on its next brief
 *                      and won't re-propose for today.
 *
 * Either outcome triggers a router.refresh() so the page re-fetches
 * the briefing without a hard reload.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Proposal {
  alt_type: string;
  alt_distance_mi: number;
  alt_label: string;
  reason: string;
}

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'accepting' | 'declining' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function act(action: 'accept' | 'decline') {
    setState(action === 'accept' ? 'accepting' : 'declining');
    setErrorMsg(null);
    try {
      const r = await fetch('/api/coach/proposal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, proposal }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      setState('done');
      // Refresh so the new briefing (with no proposed_alternative)
      // mounts in place. router.refresh re-fetches RSC + revalidates
      // the BriefingLoader's data.
      router.refresh();
    } catch (e: any) {
      setState('error');
      setErrorMsg(e?.message ?? String(e));
    }
  }

  if (state === 'done') return null; // brief re-fetch will mount the new card-free state

  const busy = state === 'accepting' || state === 'declining';

  return (
    <div
      role="region"
      aria-label="Coach proposal"
      style={{
        background: 'linear-gradient(135deg, rgba(243,173,56,0.12), rgba(243,173,56,0.04))',
        border: '1px solid rgba(243,173,56,0.35)',
        borderRadius: 12,
        padding: '14px 16px',
        margin: '12px 24px 0',
      }}
    >
      <div style={{
        fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
        color: 'var(--goal)', marginBottom: 8,
      }}>
        COACH PROPOSAL
      </div>

      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 20, lineHeight: 1.15,
        color: 'var(--ink)', marginBottom: 6,
      }}>
        Swap to: {proposal.alt_label}
      </div>

      <div style={{
        fontSize: 12, color: 'var(--mute)', lineHeight: 1.5, marginBottom: 14,
      }}>
        {proposal.reason}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => act('accept')}
          style={{
            flex: 1, minWidth: 160,
            background: 'var(--goal)',
            color: '#1a1407',
            border: 'none',
            borderRadius: 8,
            padding: '10px 14px',
            fontFamily: 'var(--f-body)',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.8px',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {state === 'accepting' ? 'SWAPPING…' : 'ACCEPT · SWAP TODAY'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act('decline')}
          style={{
            flex: 1, minWidth: 160,
            background: 'transparent',
            color: 'var(--ink)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '10px 14px',
            fontFamily: 'var(--f-body)',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.8px',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {state === 'declining' ? 'NOTING…' : 'STICK WITH PLAN'}
        </button>
      </div>

      {state === 'error' && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--over)' }}>
          Something went wrong: {errorMsg}. The coach will re-propose on the next brief.
        </div>
      )}
    </div>
  );
}
