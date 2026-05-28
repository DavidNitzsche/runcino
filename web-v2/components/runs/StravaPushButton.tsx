'use client';

/**
 * StravaPushButton — manual push of a single run to Strava from
 * RunDetailModal (opened from /log or /today's day modal).
 *
 * P-STRAVA-MANUAL-PUSH 2026-05-27. Strava push infrastructure already
 * existed at POST /api/strava/push/[runId] (used by the auto-push
 * toggle on connection settings). This button surfaces the same path
 * as a one-tap action from the run-detail view.
 *
 * Idempotent on the server: re-clicking after a successful push returns
 * `status: 'duplicate'` instead of re-uploading.
 *
 * State machine:
 *   idle   →  PUSH TO STRAVA
 *   busy   →  PUSHING…   (disabled)
 *   ok     →  PUSHED ✓   (sticky for the session)
 *   dup    →  ALREADY ON STRAVA ✓
 *   error  →  PUSH FAILED  (one retry button, surfaces error)
 *
 * Hidden entirely when the run's source IS Strava — pushing a Strava
 * run back to Strava is nonsense.
 */
import { useState } from 'react';

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; stravaActivityId?: string }
  | { kind: 'dup' }
  | { kind: 'error'; message: string };

export function StravaPushButton({
  runId,
  source,
  isRace = false,
}: {
  runId: string;
  source: string | null | undefined;
  isRace?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  if (source === 'strava') return null;

  async function push() {
    setState({ kind: 'busy' });
    try {
      const r = await fetch(`/api/strava/push/${encodeURIComponent(runId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRace }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.status === 'failed') {
        setState({ kind: 'error', message: j.error ?? `HTTP ${r.status}` });
        return;
      }
      if (j.status === 'duplicate') {
        setState({ kind: 'dup' });
      } else if (j.status === 'uploaded' || j.status === 'pending') {
        setState({ kind: 'ok', stravaActivityId: j.stravaActivityId });
      } else {
        setState({ kind: 'ok', stravaActivityId: j.stravaActivityId });
      }
    } catch (e: any) {
      setState({ kind: 'error', message: e?.message ?? 'network error' });
    }
  }

  const busy = state.kind === 'busy';
  const success = state.kind === 'ok' || state.kind === 'dup';
  const errored = state.kind === 'error';

  const label =
    state.kind === 'busy'  ? 'PUSHING…'
    : state.kind === 'ok'  ? 'PUSHED TO STRAVA ↗'
    : state.kind === 'dup' ? 'ALREADY ON STRAVA ↗'
    : state.kind === 'error' ? 'RETRY PUSH'
    : 'PUSH TO STRAVA';

  const bg = success ? 'rgba(252,89,52,0.15)'
    : errored ? 'rgba(252,77,100,0.12)'
    : 'rgba(252,89,52,0.10)';
  const fg = success ? '#FC5934'
    : errored ? 'var(--over)'
    : '#FC5934';
  const border = success ? 'rgba(252,89,52,0.35)'
    : errored ? 'rgba(252,77,100,0.35)'
    : 'rgba(252,89,52,0.25)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
      <button
        type="button"
        onClick={push}
        disabled={busy || success}
        style={{
          background: bg,
          color: fg,
          border: `1px solid ${border}`,
          borderRadius: 999,
          padding: '6px 14px',
          fontFamily: 'var(--f-label)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '1.2px',
          cursor: busy || success ? 'default' : 'pointer',
          opacity: busy ? 0.7 : 1,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          transition: 'background .12s',
        }}
        onMouseEnter={(e) => { if (!busy && !success && !errored) e.currentTarget.style.background = 'rgba(252,89,52,0.18)'; }}
        onMouseLeave={(e) => { if (!busy && !success && !errored) e.currentTarget.style.background = bg; }}
      >
        {/* Tiny Strava-like icon */}
        <svg width="9" height="11" viewBox="0 0 9 11" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M3.5 0 0 7h2L3.5 4 5 7h2L3.5 0zm2 8L7 11 8.5 8H7l-1.5 1L4 8H5.5z"/>
        </svg>
        {label}
      </button>
      {errored && (
        <span style={{ fontSize: 10, color: 'var(--over)', letterSpacing: '0.3px' }}>
          {(state as { kind: 'error'; message: string }).message}
        </span>
      )}
    </div>
  );
}
