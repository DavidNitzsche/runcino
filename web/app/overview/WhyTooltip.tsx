'use client';

/**
 * C1 · "Why this workout" tooltip · /overview TodayCard
 *
 * Renders a small "Why?" pill in the hero eyebrow row that
 * expands into a structured rationale (type, cycle position,
 * purpose, volume choice) plus uncertainty notes.
 *
 * Voice: educational + honest. Doesn't fabricate reasoning the
 * system doesn't have; surfaces what it knows and labels gaps.
 *
 * Layout note: this component renders OUTSIDE the giant `.hero-title`
 * Bebas wordmark so its panel lays out in normal document flow. Each
 * row is an explicit two-column (label · value) grid and resets
 * font/letter-spacing so it can never inherit the hero's collapsed
 * line-height or negative tracking (which previously caused the rows
 * to overprint each other).
 */

import { useState } from 'react';
import type { WhyThisWorkout } from '@/lib/why-this-workout';

interface Props {
  why: WhyThisWorkout;
}

interface RowProps {
  label: string;
  value: string;
}

function Row({ label, value }: RowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        columnGap: 14,
        alignItems: 'baseline',
        marginBottom: 8,
        letterSpacing: 'normal',
      }}
    >
      <span
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: 'rgba(13,15,18,.55)',
          lineHeight: 1.5,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span style={{ color: 'rgba(13,15,18,.85)' }}>{value}</span>
    </div>
  );
}

export function WhyTooltip({ why }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        marginTop: 14,
        fontFamily: 'Inter, sans-serif',
        letterSpacing: 'normal',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 11px',
          background: 'transparent',
          border: '1px solid rgba(13,15,18,.18)',
          borderRadius: 999,
          fontFamily: 'Oswald, sans-serif',
          fontSize: 9.5,
          letterSpacing: 1.3,
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'rgba(13,15,18,.62)',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        {open ? '× Close' : '? Why this workout'}
      </button>

      {open && (
        <div
          style={{
            marginTop: 12,
            padding: '14px 16px',
            background: 'rgba(13,15,18,.03)',
            border: '1px solid rgba(13,15,18,.08)',
            borderRadius: 8,
            fontFamily: 'Inter, sans-serif',
            fontSize: 12.5,
            lineHeight: 1.55,
            letterSpacing: 'normal',
            color: 'rgba(13,15,18,.82)',
            maxWidth: 600,
          }}
        >
          <Row label="Type" value={why.type} />
          <Row label="Where in cycle" value={why.cyclePosition} />
          <Row label="Purpose" value={why.purpose} />
          <Row label="Volume choice" value={why.volumeChoice} />
          {why.uncertaintyNotes.length > 0 && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: '1px solid rgba(13,15,18,.08)',
                fontSize: 11,
                lineHeight: 1.55,
                letterSpacing: 'normal',
                color: 'rgba(13,15,18,.55)',
                fontStyle: 'italic',
              }}
            >
              <strong style={{ fontStyle: 'normal', color: 'rgba(13,15,18,.70)' }}>
                What the system knows · what it doesn&rsquo;t:{' '}
              </strong>
              {why.uncertaintyNotes.join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
