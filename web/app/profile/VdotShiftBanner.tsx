'use client';

/**
 * Ongoing large-shift guard banner · /profile Coach Reads
 *
 * Surfaces when aggregate VDOT has shifted >2 points since the user
 * last reviewed (Apply event OR initial baseline at first profile
 * load). Same adaptive-banner shape as suspect-ceiling + L7.
 *
 * Three actions:
 *   Apply        · accept new VDOT, record review at current
 *   Dismiss(30D) · suppress for 30 days
 *   Investigate  · 24-hour snooze ("I'm looking into this")
 */

import { useState } from 'react';

export interface VdotShiftBannerProps {
  oldVdot: number;
  newVdot: number;
  shiftPoints: number;
  direction: 'up' | 'down';
  lastReviewedAt: string | null;
}

function fmtDateAgo(iso: string | null): string {
  if (!iso) return 'baseline';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'baseline';
  const days = Math.round((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  if (days < 60) return 'about a month ago';
  return `${Math.round(days / 30)} months ago`;
}

export function VdotShiftBanner({ oldVdot, newVdot, shiftPoints, direction, lastReviewedAt }: VdotShiftBannerProps) {
  const [busy, setBusy] = useState<null | 'apply' | 'dismiss' | 'investigate'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const isUp = direction === 'up';
  const accent = isUp ? '#1f6a21' : '#b3450a';
  const bg = isUp ? 'rgba(62,189,65,.06)' : 'rgba(232,128,33,.06)';
  const border = isUp ? 'rgba(62,189,65,.30)' : 'rgba(232,128,33,.30)';
  const eyebrow = isUp ? '↑ VDOT MOVED UP · REVIEW' : '↓ VDOT MOVED DOWN · REVIEW';
  const absShift = Math.abs(shiftPoints);

  async function call(action: 'apply' | 'dismiss' | 'investigate') {
    setBusy(action);
    setErr(null);
    try {
      const body: { action: string; currentVdot?: number } = { action };
      if (action === 'apply') body.currentVdot = newVdot;
      const res = await fetch('/api/profile/vdot-shift/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      // Soft hide for dismiss/investigate so the page doesn't reload
      // for a 30-day or 24-hour suppression — the banner already
      // marked itself dismissed server-side. Apply reloads to refresh
      // the aggregate-VDOT-display surfaces (Coach Reads pace bands).
      if (action === 'apply') {
        window.location.reload();
      } else {
        setHidden(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        margin: '12px 40px 0',
        padding: '14px 16px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        fontFamily: 'Inter, sans-serif',
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontSize: 10.5,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: accent,
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        {eyebrow}
      </div>

      <div style={{ marginBottom: 8, color: 'rgba(8,8,8,.85)' }}>
        Your VDOT moved from <strong style={{ color: '#080808' }}>{oldVdot.toFixed(1)}</strong>{' '}
        to <strong style={{ color: '#080808' }}>{newVdot.toFixed(1)}</strong>{' '}
        ({isUp ? '+' : ''}{shiftPoints.toFixed(1)} pts) since you last reviewed
        {lastReviewedAt && <> ({fmtDateAgo(lastReviewedAt)})</>}.
      </div>

      <div style={{ marginBottom: 12, color: 'rgba(8,8,8,.70)', fontSize: 12.5 }}>
        {isUp
          ? `A ${absShift.toFixed(1)}-point bump usually means a fresh race result landed faster than your aggregate. Worth checking what changed — every aggregate contributor is visible below.`
          : `A ${absShift.toFixed(1)}-point drop usually means a recent race underperformed your aggregate. Worth checking the context — sickness, heat, hilly course, race effort — before accepting the new value.`}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => call('apply')}
          disabled={busy !== null}
          style={{
            fontFamily: 'Oswald, sans-serif', fontWeight: 600,
            fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
            padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
            background: '#080808', color: '#fff',
            border: '1px solid #080808',
            opacity: busy !== null ? 0.5 : 1,
          }}
        >
          {busy === 'apply' ? 'Applying…' : `Apply · ${newVdot.toFixed(1)}`}
        </button>
        <button
          type="button"
          onClick={() => call('investigate')}
          disabled={busy !== null}
          style={{
            fontFamily: 'Oswald, sans-serif', fontWeight: 600,
            fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
            padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', color: 'rgba(8,8,8,.78)',
            border: '1px solid rgba(8,8,8,.32)',
            opacity: busy !== null ? 0.5 : 1,
          }}
        >
          {busy === 'investigate' ? 'Snoozing…' : 'Investigate (24h)'}
        </button>
        <button
          type="button"
          onClick={() => call('dismiss')}
          disabled={busy !== null}
          style={{
            fontFamily: 'Oswald, sans-serif', fontWeight: 600,
            fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
            padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', color: 'rgba(8,8,8,.55)',
            border: '1px solid rgba(8,8,8,.18)',
            opacity: busy !== null ? 0.5 : 1,
          }}
        >
          {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss (30d)'}
        </button>
        {err && <span style={{ fontSize: 11, color: '#B00020' }}>{err}</span>}
      </div>

      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: '1px solid rgba(8,8,8,.10)',
          fontStyle: 'italic',
          fontSize: 11,
          color: 'rgba(8,8,8,.55)',
        }}
      >
        <strong style={{ fontStyle: 'normal', color: 'rgba(8,8,8,.70)' }}>What would change our mind: </strong>
        If you re-run the same race in similar conditions and the result falls between the old and new VDOT,
        that'd suggest both values are honest and the new one reflects real fitness movement worth applying.
      </div>
    </div>
  );
}
