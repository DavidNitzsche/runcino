'use client';

/**
 * ReconnectBanner — app-wide nag rendered when a runner's Strava token
 * is alive on file but dead on the wire (401 on push, almost always the
 * activity:write-was-added-later case).
 *
 * Visual contract (per spec 2026-05-28):
 *   - Background: var(--over) at 12% alpha
 *   - Border-left: 3px solid var(--over)
 *   - Body: Inter 13px medium ("Strava lost its grip" — Oswald 700 verb,
 *     "Your runs aren't syncing — token expired. One click to fix.")
 *   - Right: "RECONNECT STRAVA" pill button → /api/auth/strava?action=connect
 *   - Dismiss "X" sets cookie `strava_banner_dismissed=<ms>` for 24h
 *
 * Mount points: /today (above the SimulatorBar/Poster), /log (above the
 * filter strip). One render per surface. Higher-traffic surfaces only —
 * we deliberately don't fire on every page (the runner already gets a
 * front-and-center CTA on /profile via StravaConnectionCard).
 *
 * The status fetch is client-side via /api/strava/status, NOT a server
 * prop. Two reasons:
 *   1. Banner appears/disappears reactively when the runner reconnects
 *      from another tab (next /today refresh shows the right state).
 *   2. Avoids re-plumbing every server page that wraps TodayClient/
 *      LogTable.
 */

import { useEffect, useState } from 'react';

const DISMISS_COOKIE = 'strava_banner_dismissed';
const DISMISS_WINDOW_MS = 24 * 3600 * 1000; // 24h

interface StatusPayload {
  state: 'connected' | 'needs_reauth' | 'disconnected';
  last_push_at: string | null;
  reason?: string;
}

export interface ReconnectBannerProps {
  /**
   * Optional server-rendered initial state. When supplied, the banner can
   * render immediately on first paint if the user already needs reauth —
   * no flash of "empty surface → banner pops in" after a /status round-trip.
   * The client still re-fetches /api/strava/status on mount to pick up
   * status changes (reconnect-from-another-tab, retry succeeded, etc.).
   */
  initialState?: StatusPayload['state'];
}

export function ReconnectBanner({ initialState }: ReconnectBannerProps = {}) {
  const [needsReauth, setNeedsReauth] = useState(initialState === 'needs_reauth');
  const [reconnecting, setReconnecting] = useState(false);
  // Start hidden until the cookie check runs in the effect; if SSR said
  // we need reauth, we'll show on first client paint and hide if the cookie
  // says we've been dismissed recently.
  const [dismissed, setDismissed] = useState(false);

  // Check dismissal cookie + status on mount.
  useEffect(() => {
    // 1. Cookie check: if dismissed within the last 24h, stay hidden.
    if (typeof document !== 'undefined') {
      const ts = readCookie(DISMISS_COOKIE);
      const tsNum = ts ? Number(ts) : 0;
      const fresh = tsNum > 0 && Date.now() - tsNum < DISMISS_WINDOW_MS;
      if (fresh) {
        setDismissed(true);
        return; // don't bother fetching if we're not going to show it
      }
    }
    // 2. Status fetch — refresh from server even if SSR said needs_reauth,
    //    so a fresh reconnect (from another tab) hides the banner.
    fetch('/api/strava/status', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: StatusPayload | null) => {
        setNeedsReauth(j?.state === 'needs_reauth');
      })
      .catch(() => { /* silent — banner is best-effort */ });
  }, []);

  async function reconnect() {
    if (reconnecting) return;
    setReconnecting(true);
    // 2026-06-01 fix: surface real errors instead of resetting the
    // spinner and pretending nothing happened. If the route 401's
    // (session expired), 503's (STRAVA_CLIENT_ID not set in env), or
    // returns a body without `url`, the runner needs to see WHY
    // clicking the button does nothing.
    try {
      const r = await fetch('/api/auth/strava?action=connect', { credentials: 'same-origin' });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        alert(`Couldn't start the Strava reconnect (HTTP ${r.status}). ${txt.slice(0, 200)}`);
        setReconnecting(false);
        return;
      }
      const j = await r.json().catch(() => null);
      if (j && typeof j.url === 'string') {
        window.location.href = j.url;
        return;
      }
      alert("Strava reconnect didn't return a redirect URL. The server may be misconfigured (missing STRAVA_CLIENT_ID).");
      setReconnecting(false);
    } catch (err: any) {
      alert(`Couldn't reach the reconnect endpoint: ${err?.message ?? 'network error'}`);
      setReconnecting(false);
    }
  }

  function dismiss() {
    // Persist for 24h. Plain cookie, no Secure flag (the app is HTTPS-only
    // in prod; dev gets non-secure which the browser accepts on localhost).
    if (typeof document !== 'undefined') {
      const expires = new Date(Date.now() + DISMISS_WINDOW_MS).toUTCString();
      document.cookie = `${DISMISS_COOKIE}=${Date.now()}; expires=${expires}; path=/; SameSite=Lax`;
    }
    setDismissed(true);
  }

  if (dismissed || !needsReauth) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        // var(--over) is the warn/race accent. 0x1F (~12% alpha) on hex tail.
        background: 'rgba(252, 77, 100, 0.12)',
        borderLeft: '3px solid var(--over)',
        padding: '12px 18px 12px 22px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        margin: '0 auto',
        maxWidth: 1440,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--f-body)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink)',
            lineHeight: 1.4,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              letterSpacing: '0.5px',
              fontSize: 15,
              color: 'var(--over)',
              marginRight: 10,
              textTransform: 'uppercase',
            }}
          >
            Strava lost its grip.
          </span>
          Your runs aren&apos;t syncing — token expired. One click to fix.
        </div>
      </div>
      <button
        type="button"
        onClick={reconnect}
        disabled={reconnecting}
        style={{
          background: 'var(--over)',
          color: '#0e1014',
          border: 'none',
          borderRadius: 'var(--r-pill, 999px)',
          padding: '8px 16px',
          fontFamily: 'var(--f-label)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '1.4px',
          cursor: reconnecting ? 'wait' : 'pointer',
          flexShrink: 0,
          opacity: reconnecting ? 0.6 : 1,
          transition: 'opacity .12s, filter .12s',
        }}
      >
        {reconnecting ? 'OPENING…' : 'RECONNECT STRAVA'}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss for 24 hours"
        title="Dismiss for 24 hours"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--mute)',
          cursor: 'pointer',
          padding: 4,
          fontSize: 16,
          lineHeight: 1,
          flexShrink: 0,
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ×
      </button>
    </div>
  );
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const entries = document.cookie.split(';');
  for (const raw of entries) {
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const k = raw.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(raw.slice(eq + 1).trim());
  }
  return null;
}
