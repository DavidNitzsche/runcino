'use client';

/**
 * ProposalCard — renders a pending coach proposal with accept/reject.
 * Per autonomy contract §10.2 + spec §27 U7.
 *
 * Coach proposes (goal time change, race priority shift, plan rewrite,
 * etc); runner decides. Acceptance triggers downstream cache invalidation
 * via the /api/coach/proposal POST handler.
 *
 * Fetches /api/coach/proposal on mount; renders only when pending
 * proposals exist.
 */

import { useEffect, useState } from 'react';

interface ProposalPayload {
  headline?: string;
  reasoning?: string;
  options?: { label: string; value: string }[];
  // For specific proposal types, payload carries the type-specific fields.
  current?: unknown;
  proposed?: unknown;
}

interface CoachProposal {
  id: number;
  proposalType: string;
  payload: ProposalPayload;
  createdAt: string;
}

interface ProposalsResponse {
  ok: boolean;
  pending: CoachProposal[];
}

export function ProposalCard() {
  const [pending, setPending] = useState<CoachProposal[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/coach/proposal').then((r) => r.json()).then((j: ProposalsResponse) => {
      if (j.ok) setPending(j.pending);
    }).catch(() => {});
  }, []);

  async function respond(id: number, decision: 'accept' | 'reject') {
    setBusy(id);
    try {
      const res = await fetch('/api/coach/proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      });
      if (res.ok) setPending((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setBusy(null);
    }
  }

  if (pending.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {pending.map((p) => (
        <div
          key={p.id}
          style={{
            background: 'var(--milestone-wash, rgba(245, 197, 24, 0.08))',
            border: '1px solid var(--milestone, #F5C518)',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{
            fontFamily: 'Oswald, sans-serif',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: 'var(--milestone, #F5C518)',
            marginBottom: 6,
          }}>
            Coach proposal · {p.proposalType.replace(/_/g, ' ')}
          </div>
          {p.payload?.headline && (
            <div style={{
              fontFamily: 'Oswald, sans-serif',
              fontWeight: 700,
              fontSize: 18,
              color: 'var(--ink, #0a0a0a)',
              marginBottom: 8,
              lineHeight: 1.25,
            }}>
              {p.payload.headline}
            </div>
          )}
          {p.payload?.reasoning && (
            <div style={{
              fontFamily: 'Jost, sans-serif',
              fontSize: 14,
              color: 'rgba(10,10,10,.78)',
              marginBottom: 14,
              lineHeight: 1.5,
            }}>
              {p.payload.reasoning}
            </div>
          )}
          {/* Button labels frame the choice as "accept new plan" vs
              "hold the line on what you committed to" — never "decline
              the coach." Per-proposal-type wording: goal_time_change
              compares old vs new goal time; other types fall back to
              the generic Accept/Hold pattern. The runner isn't
              declining the coach; they're keeping their goal. */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => respond(p.id, 'accept')}
              disabled={busy === p.id}
              style={{
                flex: 1,
                background: 'var(--milestone, #F5C518)',
                color: 'var(--ink, #0a0a0a)',
                border: 'none',
                borderRadius: 999,
                padding: '10px 18px',
                fontFamily: 'Oswald, sans-serif',
                fontSize: 12,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                fontWeight: 700,
                cursor: busy === p.id ? 'not-allowed' : 'pointer',
                opacity: busy === p.id ? 0.7 : 1,
              }}
            >
              {busy === p.id ? 'Saving…' : acceptLabel(p.proposalType)}
            </button>
            <button
              type="button"
              onClick={() => respond(p.id, 'reject')}
              disabled={busy === p.id}
              style={{
                background: 'transparent',
                color: 'rgba(10,10,10,.6)',
                border: '1px solid rgba(10,10,10,.2)',
                borderRadius: 999,
                padding: '10px 18px',
                fontFamily: 'Oswald, sans-serif',
                fontSize: 12,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                fontWeight: 700,
                cursor: busy === p.id ? 'not-allowed' : 'pointer',
              }}
            >
              {rejectLabel(p.proposalType)}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Per-proposal-type button labels. The framing is "accept the new
// thing" vs "hold what you already committed to" — the runner is
// never declining the coach, they're choosing to keep their goal.
function acceptLabel(proposalType: string): string {
  switch (proposalType) {
    case 'goal_time_change':       return 'Accept new goal';
    case 'race_priority_change':   return 'Change priority';
    case 'plan_rewrite':           return 'Apply the rewrite';
    case 'race_drop':              return 'Drop the race';
    case 'long_run_day_change':    return 'Change the day';
    case 'build_phase_extend':
    case 'build_phase_shorten':    return 'Update the phase';
    default:                       return 'Accept';
  }
}

function rejectLabel(proposalType: string): string {
  switch (proposalType) {
    case 'goal_time_change':       return 'Keep goal';
    case 'race_priority_change':   return 'Keep priority';
    case 'plan_rewrite':           return 'Keep plan';
    case 'race_drop':              return 'Keep the race';
    case 'long_run_day_change':    return 'Keep the day';
    case 'build_phase_extend':
    case 'build_phase_shorten':    return 'Keep phase';
    default:                       return 'Keep current';
  }
}
