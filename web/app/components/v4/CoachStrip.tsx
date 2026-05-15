'use client';

/**
 * v4 coach strip — the band that sits at the top of /overview.
 *
 *   ┌─────────────────────────────────────────┬────────────────────┐
 *   │ ● COACH · THU MAY 15 · BASE WEEK 3      │   Today's Check-In │
 *   │                                         │   Energy   [══]  6 │
 *   │ "Good morning, David. Your body is      │   Soreness [══]  4 │
 *   │  absorbing this block really well — ..."│   Stress   [══]  2 │
 *   │                                         │   [LOG CHECK-IN]   │
 *   └─────────────────────────────────────────┴────────────────────┘
 *
 * Left side stretches to fill horizontal space; right side is a fixed-
 * width card with the check-in form. Both stretch to the same height
 * via flex align-items: stretch.
 *
 * Check-in sliders POST to /api/health/checkin — endpoint already exists
 * (upserts to daily_checkin, keyed on user+date). Existing slider values
 * are pre-loaded via GET so re-visiting the page shows what you logged.
 */

import { useEffect, useState } from 'react';

export interface CoachStripProps {
  /** Pre-formatted label, e.g. "COACH · THU MAY 15 · BASE WEEK 3". */
  label: string;
  /** Multi-sentence coach briefing in the v4 voice. Supports bold via
   *  the `<strong>` token wrapped in `**…**` so the coach can emphasize. */
  briefing: string;
}

export function CoachStrip({ label, briefing }: CoachStripProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        paddingBottom: 0,
        minHeight: '160px',
        marginBottom: '16px',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            fontFamily: 'Inter, sans-serif',
            fontSize: '12px',
            letterSpacing: '2.5px',
            color: 'rgba(13,15,18,.35)',
            textTransform: 'uppercase',
            marginBottom: '14px',
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: 'var(--recovery, #2CA82F)',
              flexShrink: 0,
            }}
          />
          {label}
        </div>
        <p
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '22px',
            lineHeight: 1.5,
            color: 'var(--ink, #0D0F12)',
            fontWeight: 400,
          }}
          dangerouslySetInnerHTML={{ __html: parseBold(briefing) }}
        />
      </div>

      <CheckInCard />
    </div>
  );
}

/** Turn `**foo**` into `<strong>foo</strong>`. The coach briefing comes
 *  from a server-generated source and uses this markdown-light syntax to
 *  emphasize phrases ("**93 days to AFC. Go get it.**"). Escapes any
 *  other HTML to stay safe. */
function parseBold(input: string): string {
  const escaped = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// ─────────────────────────────────────────────────────────────────────
// Check-in card
// ─────────────────────────────────────────────────────────────────────

interface CheckinValues { energy: number; soreness: number; stress: number; }

function CheckInCard() {
  const [vals, setVals] = useState<CheckinValues>({ energy: 6, soreness: 4, stress: 2 });
  const [loaded, setLoaded] = useState(false);
  const [logged, setLogged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-load today's check-in if it exists.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health/checkin')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j && j.ok && j.checkin) {
          setVals({
            energy: j.checkin.energy,
            soreness: j.checkin.soreness,
            stress: j.checkin.stress,
          });
          setLogged(true);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/health/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vals),
      });
      const j = await r.json();
      if (j && j.ok) {
        setLogged(true);
      } else {
        setError(j?.error ?? 'Could not save check-in.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        flexShrink: 0,
        marginLeft: '48px',
        width: '300px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 0,
        background: 'var(--surface, #FFFFFF)',
        borderRadius: '20px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04)',
      }}
    >
      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '2px',
          color: 'rgba(13,15,18,.35)',
          textTransform: 'uppercase',
          marginBottom: '14px',
          alignSelf: 'flex-start',
        }}
      >
        Today&rsquo;s Check-In
      </div>

      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          marginBottom: '16px',
          opacity: loaded ? 1 : 0.6,
        }}
      >
        <SliderRow
          label="Energy"
          tone="energy"
          value={vals.energy}
          disabled={logged}
          onChange={(v) => setVals((p) => ({ ...p, energy: v }))}
        />
        <SliderRow
          label="Soreness"
          tone="soreness"
          value={vals.soreness}
          disabled={logged}
          onChange={(v) => setVals((p) => ({ ...p, soreness: v }))}
        />
        <SliderRow
          label="Stress"
          tone="stress"
          value={vals.stress}
          disabled={logged}
          onChange={(v) => setVals((p) => ({ ...p, stress: v }))}
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={logged || submitting || !loaded}
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: '12px',
          fontWeight: 600,
          color: '#fff',
          background: logged ? 'var(--recovery, #2CA82F)' : 'var(--ink, #0D0F12)',
          border: 'none',
          borderRadius: '8px',
          padding: '10px 20px',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          cursor: logged ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
          alignSelf: 'flex-end',
          opacity: submitting ? 0.5 : 1,
        }}
      >
        {logged ? '✓ Logged' : submitting ? 'Saving…' : 'Log Check-In'}
      </button>

      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--warn, #F43F5E)' }}>{error}</div>
      )}
    </div>
  );
}

function SliderRow({
  label,
  tone,
  value,
  disabled,
  onChange,
}: {
  label: string;
  tone: 'energy' | 'soreness' | 'stress';
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  // Background gradient per tone — matches the .checkin-range CSS classes.
  const toneColor = tone === 'energy' ? '#2CA82F' : tone === 'soreness' ? '#E85D26' : '#D4900A';
  const trackBg = `linear-gradient(to right, rgba(13,15,18,.10) 0%, ${toneColor} 100%)`;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '64px 1fr 24px',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <span
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          color: 'rgba(13,15,18,.35)',
          textAlign: 'right',
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{
          WebkitAppearance: 'none',
          appearance: 'none',
          width: '100%',
          height: '8px',
          borderRadius: '4px',
          outline: 'none',
          cursor: disabled ? 'default' : 'pointer',
          border: 'none',
          display: 'block',
          background: trackBg,
          opacity: disabled ? 0.5 : 1,
        }}
      />
      <span
        style={{
          fontFamily: 'Bebas Neue, sans-serif',
          fontSize: '20px',
          lineHeight: 1,
          color: 'rgba(13,15,18,.55)',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}
