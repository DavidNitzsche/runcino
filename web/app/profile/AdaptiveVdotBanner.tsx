'use client';

/**
 * Adaptive VDOT banner — L7 surface.
 *
 * Renders on /profile Coach Reads when the verdict has a finding
 * (vdot-bump-suggested or vdot-downgrade-investigate). Same shape
 * as the suspect-ceiling banner: evidence, reasoning, math,
 * recommendation, falsifier, user agency (Apply / Keep current).
 *
 * Apply → POST /api/profile/adaptive-vdot { action: 'apply', vdot }
 *   sets users.vdot_manual_override; aggregate VDOT displays the
 *   new value until a fresh race result post-dates the override.
 *
 * Keep current → POST { action: 'dismiss' }
 *   suppresses banner for 30 days OR until new evidence fires.
 *
 * No auto-mutation. User retains agency. Same discipline as max HR.
 */

import { useState } from 'react';

type Evidence = {
  date: string;
  workoutLabel: string;
  prescribedPaceS: number | null;
  actualPaceS: number | null;
  actualAvgHr: number | null;
  /** Temperature at workout start in °F. When present and ≤78°F,
   *  shown beside HR as confirmation the evidence passed the heat
   *  filter. null when location unknown — display omits the chip. */
  temperatureF: number | null;
};

export type AdaptiveVdotVerdictForUI = {
  kind: 'vdot-bump-suggested' | 'vdot-downgrade-investigate';
  currentVdot: number;
  suggestedVdot?: number;
  suggestedDeltaPoints?: number;
  evidence: Evidence[];
  reason: string;
  falsifier: string;
};

function fmtPace(s: number | null): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}/mi`;
}

export function AdaptiveVdotBanner({ verdict }: { verdict: AdaptiveVdotVerdictForUI }) {
  const [busy, setBusy] = useState<null | 'apply' | 'dismiss'>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const isUp = verdict.kind === 'vdot-bump-suggested';
  const accent = isUp ? '#1f6a21' : '#b3450a';
  const bg = isUp ? 'rgba(44,168,47,.06)' : 'rgba(232,93,38,.06)';
  const border = isUp ? 'rgba(44,168,47,.30)' : 'rgba(232,93,38,.30)';
  const eyebrow = isUp ? '↑ FITNESS DRIFT · PROPOSED BUMP' : '⚠ INVESTIGATE · WORKOUTS TRENDING SLOW';

  async function onApply() {
    if (!verdict.suggestedVdot) return;
    setBusy('apply');
    setError(null);
    try {
      const res = await fetch('/api/profile/adaptive-vdot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', vdot: verdict.suggestedVdot }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  async function onDismiss() {
    setBusy('dismiss');
    setError(null);
    try {
      const res = await fetch('/api/profile/adaptive-vdot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setHidden(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: '14px 18px',
        marginTop: 14,
        marginBottom: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: 1.4,
          color: accent,
          textTransform: 'uppercase',
        }}
      >
        {eyebrow}
      </div>

      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 13,
          lineHeight: 1.55,
          color: 'rgba(13,15,18,.85)',
        }}
      >
        {verdict.reason}
      </div>

      {verdict.evidence.length > 0 && (
        <div
          style={{
            background: 'rgba(13,15,18,.03)',
            border: '1px solid rgba(13,15,18,.06)',
            borderRadius: 8,
            padding: '8px 10px',
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'rgba(13,15,18,.75)',
          }}
        >
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 9, letterSpacing: 1.2, color: 'rgba(13,15,18,.55)', textTransform: 'uppercase', marginBottom: 4, fontWeight: 700 }}>
            Evidence
          </div>
          {verdict.evidence.slice(0, 5).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'rgba(13,15,18,.55)', minWidth: 80 }}>
                {e.date}
              </span>
              <span style={{ flex: 1 }}>{e.workoutLabel}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                {fmtPace(e.actualPaceS)}
                {' '}vs{' '}
                <span style={{ color: 'rgba(13,15,18,.55)' }}>{fmtPace(e.prescribedPaceS)}</span>
                {e.actualAvgHr != null && <> · {e.actualAvgHr} bpm</>}
                {e.temperatureF != null && <> · {e.temperatureF}°F</>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 11,
          lineHeight: 1.5,
          color: 'rgba(13,15,18,.60)',
          fontStyle: 'italic',
        }}
      >
        <strong style={{ color: 'rgba(13,15,18,.75)', fontStyle: 'normal' }}>What would change our mind:</strong>{' '}
        {verdict.falsifier}
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#c92a2a', fontWeight: 600 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isUp && verdict.suggestedVdot != null && (
          <button
            type="button"
            onClick={onApply}
            disabled={busy != null}
            style={{
              background: accent,
              color: 'white',
              border: 'none',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy === 'apply' ? 'Applying…' : `Apply · bump to VDOT ${verdict.suggestedVdot.toFixed(1)}`}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy != null}
          style={{
            background: 'transparent',
            color: 'rgba(13,15,18,.65)',
            border: '1px solid rgba(13,15,18,.20)',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy === 'dismiss' ? 'Dismissing…' : 'Keep current'}
        </button>
      </div>
    </div>
  );
}
