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

  /**
   * 2026-05-27 P-STRAVA-401: when Strava returns 401, the OAuth grant
   * is missing activity:write (or was revoked). One-tap re-OAuth: pop a
   * window to the connect URL, return user to the same place.
   */
  async function reconnect() {
    try {
      const r = await fetch('/api/auth/strava?action=connect');
      const j = await r.json().catch(() => ({}));
      if (j?.url) {
        window.location.href = j.url;
      } else {
        setState({ kind: 'error', message: 'connect failed' });
      }
    } catch {
      setState({ kind: 'error', message: 'connect failed' });
    }
  }

  const busy = state.kind === 'busy';
  const success = state.kind === 'ok' || state.kind === 'dup';
  const errored = state.kind === 'error';
  // 2026-05-27 P-STRAVA-401: typed reauth error from push.ts. Surface
  // a "Reconnect" CTA instead of an opaque "401" — David: "401" alone
  // is meaningless. Clicking goes through the OAuth flow which now
  // UPSERTs connector_tokens with current scopes (incl. activity:write).
  const needsReauth = errored && (state as { message: string }).message === 'REAUTH_REQUIRED';

  const label =
    state.kind === 'busy'  ? 'Pushing…'
    : state.kind === 'ok'  ? 'On Strava'
    : state.kind === 'dup' ? 'On Strava'
    : needsReauth ? 'Reconnect Strava'
    : state.kind === 'error' ? 'Retry'
    : 'Strava';

  // 2026-05-27: David flagged the previous styling as "weird ass semi
  // transparent red/pink." Switched to real Strava orange (#FC4C02),
  // solid-filled, smaller footprint — designed to sit in the modal
  // header's top-right corner next to the close (X) button rather
  // than mid-modal. Title-case label so it doesn't shout.
  const STRAVA = '#FC4C02';
  const STRAVA_HOVER = '#E54300';
  const bg = errored ? 'rgba(252,77,100,0.12)'
    : success ? 'rgba(252,76,2,0.15)'
    : STRAVA;
  const fg = errored ? 'var(--over)'
    : success ? STRAVA
    : '#fff';
  const border = errored ? 'rgba(252,77,100,0.4)'
    : success ? 'rgba(252,76,2,0.4)'
    : 'transparent';

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <button
        type="button"
        onClick={needsReauth ? reconnect : push}
        disabled={busy || success}
        title={needsReauth
          ? "Strava revoked or missing 'activity:write' scope — reconnect to push"
          : "Push run to Strava"}
        style={{
          background: bg,
          color: fg,
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: '6px 11px',
          fontFamily: 'var(--f-body)',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.1px',
          cursor: busy || success ? 'default' : 'pointer',
          opacity: busy ? 0.7 : 1,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          transition: 'background .12s',
          height: 30,
          lineHeight: 1,
        }}
        onMouseEnter={(e) => { if (!busy && !success && !errored) e.currentTarget.style.background = STRAVA_HOVER; }}
        onMouseLeave={(e) => { if (!busy && !success && !errored) e.currentTarget.style.background = bg; }}
      >
        {/* Strava chevron logo (mark-only, no wordmark). 2 stacked chevrons. */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }} aria-label="Strava">
          <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
        </svg>
        {label}
      </button>
      {errored && !needsReauth && (
        <span style={{ fontSize: 10, color: 'var(--over)', letterSpacing: '0.3px' }}>
          {(state as { kind: 'error'; message: string }).message}
        </span>
      )}
      {needsReauth && (
        <span style={{ fontSize: 10, color: 'var(--mute)', letterSpacing: '0.3px' }}>
          tap to re-grant write access
        </span>
      )}
    </div>
  );
}
