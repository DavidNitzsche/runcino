'use client';

/**
 * StravaConnectionCard — redesign per #161, upgraded for P-STRAVA-401-UX
 * (2026-05-28).
 *
 * Replaces the static "STRAVA · CONNECTED · Last sync 16h ago" row with
 * a card that exposes the push controls + three-state connection status:
 *   - connected:    green dot, last sync time, push controls visible.
 *   - needs_reauth: amber dot, "Reconnect Strava" CTA front-and-center,
 *                   explanation copy, push controls hidden.
 *   - disconnected: grey dot, "Connect Strava" CTA, controls hidden.
 *
 * Hooked by /api/strava/status (state) + /api/profile (push prefs) +
 * /api/strava/pushes (history). PATCHes /api/profile for toggle / privacy
 * / title-format changes.
 *
 * The wrapper carries `id="strava-card"` so the per-row chip on /log can
 * jump straight to it (`/profile#strava-card`).
 */

import { useEffect, useRef, useState } from 'react';

interface StravaPrefs {
  connected: boolean;
  lastSyncAgo?: string;
  autoPush: boolean;
  privacy: 'private' | 'followers' | 'public';
  titleFormat: 'type_phases' | 'tod_type_dist';
}

type ConnState = 'connected' | 'needs_reauth' | 'disconnected';

interface PushRow {
  id: number;
  run_id: string;
  status: 'pending' | 'uploaded' | 'failed' | 'duplicate';
  strava_activity_id: number | null;
  title: string | null;
  privacy: string | null;
  error_message: string | null;
  pushed_at: string;
}

export function StravaConnectionCard({ initial }: {
  initial: {
    connected: boolean;
    lastSyncAgo?: string;
    /**
     * P-STRAVA-401-UX: SSR-resolved tri-state (loadStravaConnectionStatus).
     * When passed, the card paints the right CTA on first render with no
     * client-flicker. Falls back to the legacy `connected` boolean when
     * absent so older callers stay working.
     */
    state?: ConnState;
  };
}) {
  const [prefs, setPrefs] = useState<StravaPrefs>({
    connected: initial.connected,
    lastSyncAgo: initial.lastSyncAgo,
    autoPush: false,
    privacy: 'private',
    titleFormat: 'type_phases',
  });
  const [pushes, setPushes] = useState<PushRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  // P-STRAVA-401-UX: tri-state connection status from /api/strava/status.
  // Seeded from the SSR-computed initial.state when present so first paint
  // shows the right CTA; falls back to the legacy connected boolean. The
  // mount effect re-fetches /api/strava/status to catch any drift since
  // SSR (e.g. user reconnected from another tab).
  const [connState, setConnState] = useState<ConnState>(
    initial.state ?? (initial.connected ? 'connected' : 'disconnected')
  );
  const [connecting, setConnecting] = useState(false);
  // Focus the Reconnect CTA when the page arrives at /#strava-card so
  // the per-row chip on /log lands the runner exactly where they need
  // to click.
  const ctaRef = useRef<HTMLButtonElement | null>(null);

  // Fetch full prefs + history + status once on mount.
  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (!j) return;
        setPrefs((p) => ({
          ...p,
          autoPush: Boolean(j.strava_auto_push),
          privacy: (j.strava_push_privacy ?? 'private') as StravaPrefs['privacy'],
          titleFormat: (j.strava_push_title_format ?? 'type_phases') as StravaPrefs['titleFormat'],
        }));
      })
      .catch(() => {});
    fetch('/api/strava/pushes')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.pushes) setPushes(j.pushes.slice(0, 3)); })
      .catch(() => {});
    fetch('/api/strava/status', { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j?.state === 'connected' || j?.state === 'needs_reauth' || j?.state === 'disconnected') {
          setConnState(j.state);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-focus the Reconnect CTA when the page lands on /profile#strava-card.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#strava-card') return;
    if (connState !== 'needs_reauth' && connState !== 'disconnected') return;
    // Tiny delay so the focus ring lands after the scroll anchor.
    const t = setTimeout(() => ctaRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [connState]);

  async function startReconnect() {
    if (connecting) return;
    setConnecting(true);
    try {
      const r = await fetch('/api/auth/strava?action=connect');
      const j = await r.json().catch(() => ({}));
      if (j?.url) window.location.href = j.url;
      else setConnecting(false);
    } catch {
      setConnecting(false);
    }
  }

  async function patch(field: keyof StravaPrefs, value: any) {
    const previous = (prefs as any)[field];
    setPrefs({ ...prefs, [field]: value });
    setSaving(field);
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [field === 'autoPush' ? 'strava_auto_push'
            : field === 'privacy' ? 'strava_push_privacy'
            : field === 'titleFormat' ? 'strava_push_title_format'
            : field]: value,
        }),
      });
    } catch {
      // rollback on failure
      setPrefs({ ...prefs, [field]: previous });
    } finally {
      setSaving(null);
    }
  }

  async function retryPush(runId: string) {
    setSaving(`retry-${runId}`);
    try {
      await fetch(`/api/strava/push/${encodeURIComponent(runId)}`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
      const r = await fetch('/api/strava/pushes');
      const j = await r.json().catch(() => null);
      if (j?.pushes) setPushes(j.pushes.slice(0, 3));
    } finally {
      setSaving(null);
    }
  }

  const titlePreview = prefs.titleFormat === 'tod_type_dist'
    ? 'Morning easy · 5.2 mi'
    : 'Threshold · 4×1mi @ 6:48';

  // ─── Three-state display ──────────────────────────────────────────────
  // Coupled to connState (from /api/strava/status). The legacy
  // `prefs.connected` boolean is kept as a fallback for first paint.
  const isReauth = connState === 'needs_reauth';
  const isDisconnected = connState === 'disconnected';
  const isHealthy = connState === 'connected';
  const statusDotColor = isHealthy
    ? 'var(--green)'
    : isReauth
      ? 'var(--goal)' // amber: alive but needs attention
      : 'var(--mute)'; // grey
  const statusLabel = isHealthy
    ? 'CONNECTED'
    : isReauth
      ? 'NEEDS REAUTH'
      : 'NOT CONNECTED';
  const statusLabelColor = isHealthy
    ? 'var(--green)'
    : isReauth
      ? 'var(--goal)'
      : 'var(--mute)';
  const subtitle = isHealthy
    ? `Connected${prefs.lastSyncAgo ? ` · last sync ${prefs.lastSyncAgo}` : ''}`
    : isReauth
      ? 'Reconnect required — your token expired or scopes changed.'
      : 'Not connected';

  return (
    <div id="strava-card" style={{ borderTop: '1px solid var(--line)', padding: '16px 0 4px', scrollMarginTop: 80 }}>
      {/* Header row: name + tri-state status pill */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 24, letterSpacing: '0.4px', lineHeight: 1 }}>STRAVA</div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 4 }}>
            {subtitle}
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--f-label)', fontSize: 11, color: statusLabelColor, letterSpacing: '1.2px',
        }}>
          <span
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: statusDotColor,
              boxShadow: isHealthy
                ? '0 0 8px rgba(62,189,65,0.5)'
                : isReauth
                  ? '0 0 8px rgba(244,180,90,0.5)'
                  : 'none',
            }}
          />
          {statusLabel}
        </div>
      </div>

      {/* P-STRAVA-401-UX: reauth CTA block. Front-and-center when the
          token is dead, explains why, single button to fix. */}
      {isReauth && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 10,
            background: 'rgba(252, 77, 100, 0.10)',
            border: '1px solid rgba(252, 77, 100, 0.30)',
            marginBottom: 14,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600,
              color: 'var(--ink)', marginBottom: 4,
            }}>
              Reconnect Strava
            </div>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', lineHeight: 1.5 }}>
              Your token expired or scopes changed. Reconnecting takes 10 seconds.
            </div>
          </div>
          <button
            ref={ctaRef}
            type="button"
            onClick={startReconnect}
            disabled={connecting}
            style={{
              background: 'var(--over)',
              color: '#0e1014',
              border: 'none',
              borderRadius: 'var(--r-pill, 999px)',
              padding: '9px 18px',
              fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700,
              letterSpacing: '1.4px',
              cursor: connecting ? 'wait' : 'pointer',
              opacity: connecting ? 0.6 : 1,
              flexShrink: 0,
            }}
          >
            {connecting ? 'OPENING…' : 'RECONNECT STRAVA'}
          </button>
        </div>
      )}

      {/* Disconnected: simple connect CTA. The card stays sparse — there's
          no history or controls to show until they connect. */}
      {isDisconnected && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--line)',
            marginBottom: 14,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600,
              color: 'var(--ink)', marginBottom: 4,
            }}>
              Connect Strava
            </div>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', lineHeight: 1.5 }}>
              Push your runs to Strava automatically + retry any that fail.
            </div>
          </div>
          <button
            ref={ctaRef}
            type="button"
            onClick={startReconnect}
            disabled={connecting}
            style={{
              background: 'var(--green)',
              color: '#0e1014',
              border: 'none',
              borderRadius: 'var(--r-pill, 999px)',
              padding: '9px 18px',
              fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700,
              letterSpacing: '1.4px',
              cursor: connecting ? 'wait' : 'pointer',
              opacity: connecting ? 0.6 : 1,
              flexShrink: 0,
            }}
          >
            {connecting ? 'OPENING…' : 'CONNECT STRAVA'}
          </button>
        </div>
      )}

      {/* Push controls only render when the connection is healthy. Hiding
          them in needs_reauth/disconnected keeps the card focused on the
          one action that matters. */}
      {isHealthy && (
        <>
          {/* Auto-push toggle row */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 0', borderTop: '1px solid var(--line)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                Auto-push every run
              </div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 3, lineHeight: 1.5 }}>
                When on, every run pushes to Strava ~30 seconds after Faff finishes processing it.
                Manual push still works from each run's detail modal.
              </div>
            </div>
            <Toggle
              on={prefs.autoPush}
              loading={saving === 'autoPush'}
              onChange={(v) => patch('autoPush', v)}
            />
          </div>

          {/* Privacy default */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 0', borderTop: '1px solid var(--line)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                Default privacy
              </div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 3 }}>
                Visibility for pushed runs on Strava.
              </div>
            </div>
            <Segmented
              value={prefs.privacy}
              loading={saving === 'privacy'}
              options={[
                { value: 'private', label: 'PRIVATE' },
                { value: 'followers', label: 'FOLLOWERS' },
                { value: 'public', label: 'PUBLIC' },
              ]}
              onChange={(v) => patch('privacy', v)}
            />
          </div>

          {/* Title format */}
          <div style={{
            padding: '14px 0', borderTop: '1px solid var(--line)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                  Title format
                </div>
                <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 3 }}>
                  How Faff names your runs on Strava.
                </div>
              </div>
              <Segmented
                value={prefs.titleFormat}
                loading={saving === 'titleFormat'}
                options={[
                  { value: 'type_phases', label: 'WORKOUT' },
                  { value: 'tod_type_dist', label: 'TIME OF DAY' },
                ]}
                onChange={(v) => patch('titleFormat', v as any)}
              />
            </div>
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: 4,
              background: 'var(--card-2)', border: '1px solid var(--line-2)',
              fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)',
            }}>
              <span style={{ color: 'var(--dim)' }}>Next push will be titled: </span>
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{titlePreview}</span>
            </div>
          </div>

          {/* Recent pushes */}
          {pushes.length > 0 && (
            <div style={{ padding: '14px 0 0', borderTop: '1px solid var(--line)' }}>
              <div className="card-eyebrow" style={{ color: 'var(--mute)', marginBottom: 10 }}>RECENT PUSHES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pushes.map((p) => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 4,
                    background: 'var(--card-2)', border: '1px solid var(--line-2)',
                    fontFamily: 'var(--f-body)', fontSize: 12,
                  }}>
                    <StatusDot status={p.status} />
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.title ?? p.run_id}
                    </div>
                    <span style={{
                      fontFamily: 'var(--f-label)', fontSize: 9, letterSpacing: '1px',
                      color: statusColor(p.status),
                    }}>{p.status.toUpperCase()}</span>
                    {p.status === 'failed' && (
                      <button
                        onClick={() => retryPush(p.run_id)}
                        disabled={saving === `retry-${p.run_id}`}
                        style={{
                          background: 'transparent', border: '1px solid rgba(252,77,100,0.4)',
                          color: 'var(--over)', borderRadius: 6,
                          padding: '3px 8px',
                          fontFamily: 'var(--f-label)', fontSize: 9, letterSpacing: '1px',
                          cursor: saving ? 'wait' : 'pointer',
                        }}
                      >
                        {saving === `retry-${p.run_id}` ? '…' : 'RETRY'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Toggle({ on, loading, onChange }: { on: boolean; loading: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => !loading && onChange(!on)}
      disabled={loading}
      style={{
        width: 44, height: 26, borderRadius: 999,
        background: on ? 'var(--green)' : 'rgba(255,255,255,0.12)',
        border: 'none',
        position: 'relative',
        cursor: loading ? 'wait' : 'pointer',
        transition: 'background .15s',
        opacity: loading ? 0.6 : 1,
        padding: 0, flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3, left: on ? 21 : 3,
        width: 20, height: 20, borderRadius: '50%',
        background: '#fff',
        transition: 'left .15s',
      }} />
    </button>
  );
}

function Segmented<T extends string>({ value, options, loading, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  loading: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{
      display: 'inline-flex',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: 8, padding: 2,
      opacity: loading ? 0.6 : 1,
    }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !loading && opt.value !== value && onChange(opt.value)}
            disabled={loading}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: active ? 'var(--green)' : 'transparent',
              color: active ? '#0e1014' : 'var(--ink)',
              fontFamily: 'var(--f-label)',
              fontSize: 10, fontWeight: 700, letterSpacing: '1px',
              cursor: loading ? 'wait' : 'pointer',
              transition: 'background .12s, color .12s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: PushRow['status'] }) {
  const c = statusColor(status);
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />;
}

function statusColor(s: PushRow['status']): string {
  switch (s) {
    case 'uploaded':  return 'var(--green)';
    case 'pending':   return 'var(--goal)';
    case 'duplicate': return 'var(--mute)';
    case 'failed':    return 'var(--over)';
    default:          return 'var(--mute)';
  }
}
