'use client';

/**
 * GeneratePlanButton — POSTs /api/plan/generate then refreshes the page.
 *
 * Two surfaces:
 *   - <GeneratePlanCTA raceSlug=…> — full prompt when no plan exists
 *   - <RegeneratePlanButton raceSlug=…> — small pill inside an existing plan header
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props { raceSlug: string; raceName?: string }

export function GeneratePlanCTA({ raceSlug, raceName }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raceSlug }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'generation failed');
      startTransition(() => router.refresh());
    } catch (e: any) {
      setError(e?.message ?? 'something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 32 }}>
      <div className="card-eyebrow" style={{ color: 'var(--green)' }}>READY TO PLAN</div>
      <p style={{ color: 'var(--ink)', fontSize: 15, lineHeight: 1.55, margin: '8px 0 18px' }}>
        Build a training block around <span style={{ fontWeight: 600 }}>{raceName ?? 'your race'}</span>.
        The coach will lay out base → quality → race-specific → taper, sized to your recent weekly volume,
        with long runs on your preferred day.
      </p>
      <button
        onClick={run}
        disabled={busy || pending}
        style={{
          padding: '12px 24px',
          background: busy || pending ? 'rgba(62,189,65,0.18)' : 'var(--green)',
          color: busy || pending ? 'var(--green)' : '#0a0a0a',
          border: 'none', borderRadius: 8,
          fontFamily: 'var(--f-label)', fontSize: 14, letterSpacing: '1.2px',
          cursor: busy || pending ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'GENERATING…' : pending ? 'LOADING…' : 'GENERATE PLAN'}
      </button>
      {error && (
        <div style={{ color: 'var(--over)', fontSize: 12, marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function RegeneratePlanButton({ raceSlug }: { raceSlug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raceSlug }),
      });
      if (r.ok) startTransition(() => router.refresh());
    } finally {
      setBusy(false); setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        style={{
          padding: '5px 11px', background: 'transparent',
          border: '1px solid var(--line)', borderRadius: 999,
          color: 'var(--mute)', fontFamily: 'var(--f-body)', fontSize: 10, letterSpacing: '1.2px',
          cursor: 'pointer',
        }}
      >
        ↻ REGENERATE
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button onClick={run} disabled={busy || pending}
        style={{
          padding: '5px 11px', background: 'var(--over)', color: 'white',
          border: 'none', borderRadius: 999,
          fontFamily: 'var(--f-label)', fontSize: 10, letterSpacing: '1.2px', cursor: 'pointer',
        }}>
        {busy || pending ? '…' : 'CONFIRM · OVERWRITES PLAN'}
      </button>
      <button onClick={() => setConfirming(false)}
        style={{
          padding: '5px 11px', background: 'transparent', border: '1px solid var(--line)', borderRadius: 999,
          color: 'var(--mute)', fontSize: 10, letterSpacing: '1.2px', cursor: 'pointer',
        }}>
        CANCEL
      </button>
    </span>
  );
}
