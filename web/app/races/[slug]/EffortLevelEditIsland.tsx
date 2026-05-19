'use client';

/**
 * Effort-level editor for /races/[slug].
 *
 * Per David 2026-05-19 round 2 U1: each past race needs a way to
 * express how it should weight in aggregate VDOT. Six levels:
 *
 *   A              full weight — primary goal effort
 *   B              0.7× — secondary checkpoint
 *   C              0.4× — minor race, partial effort
 *   tune-up        0.4× — explicit pre-race tune-up
 *   training-run   0.2× — race used as workout
 *   hilly-excluded 0.0× — course profile distorts VDOT mapping
 *
 *  Posts to PATCH /api/races/[slug]/priority on save, then reloads
 *  the page so the readiness math + Coach Reads pick up the new
 *  weighting.
 */

import { useState } from 'react';

type EffortLevel = 'A' | 'B' | 'C' | 'tune-up' | 'training-run' | 'hilly-excluded';

const OPTIONS: Array<{ value: EffortLevel; label: string; sub: string; weight: string }> = [
  { value: 'A',              label: 'A race',          sub: 'Primary goal effort',                    weight: '1.0×' },
  { value: 'B',              label: 'B race',          sub: 'Secondary checkpoint',                   weight: '0.7×' },
  { value: 'C',              label: 'C race',          sub: 'Minor race, partial effort',             weight: '0.4×' },
  { value: 'tune-up',        label: 'Tune-up',         sub: 'Pre-A-race sharpener',                   weight: '0.4×' },
  { value: 'training-run',   label: 'Training run',    sub: 'Ran the event, didn’t race it',     weight: '0.2×' },
  { value: 'hilly-excluded', label: 'Hilly — excluded',sub: 'Course distorts VDOT — remove from agg', weight: '0.0×' },
];

export function EffortLevelEditIsland({
  slug,
  currentPriority,
}: {
  slug: string;
  currentPriority: EffortLevel;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<EffortLevel>(currentPriority);

  const currentLabel = OPTIONS.find((o) => o.value === currentPriority)?.label ?? currentPriority;
  const currentWeight = OPTIONS.find((o) => o.value === currentPriority)?.weight ?? '—';

  async function save(picked: EffortLevel) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/races/${slug}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: picked }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // Hard reload so server-side compute-vdot re-runs with the new
      // effort-level + Coach Reads picks up the new aggregate.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: 'rgba(13,15,18,.04)',
          border: '1px solid rgba(13,15,18,.08)',
          borderRadius: 8,
          fontFamily: 'Inter, sans-serif',
          fontSize: 12,
          color: 'rgba(13,15,18,.70)',
        }}
      >
        <span style={{ fontWeight: 600, color: '#0D0F12' }}>{currentLabel}</span>
        <span style={{ color: 'rgba(13,15,18,.50)' }}>· weight {currentWeight}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--accent, #E85D26)',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            padding: 0,
            marginLeft: 4,
          }}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'rgba(13,15,18,.03)',
        border: '1px solid rgba(13,15,18,.10)',
        borderRadius: 10,
        padding: 12,
        marginTop: 8,
        maxWidth: 480,
      }}
    >
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: 1.3,
          color: 'rgba(13,15,18,.55)',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        Effort level · how this race weights in aggregate VDOT
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={saving}
            onClick={() => { setValue(opt.value); save(opt.value); }}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              padding: '8px 10px',
              background: value === opt.value ? 'rgba(232,93,38,.08)' : 'rgba(13,15,18,.02)',
              border: value === opt.value
                ? '1px solid rgba(232,93,38,.40)'
                : '1px solid rgba(13,15,18,.08)',
              borderRadius: 8,
              cursor: saving ? 'wait' : 'pointer',
              textAlign: 'left',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13, color: '#0D0F12' }}>{opt.label}</span>
            <span style={{ fontSize: 11, color: 'rgba(13,15,18,.60)', flex: 1 }}>{opt.sub}</span>
            <span
              style={{
                fontFamily: 'Bebas Neue, sans-serif',
                fontSize: 13,
                letterSpacing: 0.5,
                color: 'rgba(13,15,18,.65)',
              }}
            >
              {opt.weight}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <div style={{ fontSize: 11, color: '#c92a2a', fontWeight: 600, marginTop: 8 }}>{error}</div>
      )}
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          disabled={saving}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'rgba(13,15,18,.55)',
            cursor: saving ? 'wait' : 'pointer',
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            padding: '4px 0',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
