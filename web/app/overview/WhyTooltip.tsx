'use client';

/**
 * C1 · "Why this workout" tooltip · /overview TodayCard
 *
 * Renders a small "Why?" button next to the workout title that
 * expands into a structured rationale (type, cycle position,
 * purpose, volume choice) plus uncertainty notes.
 *
 * Voice: educational + honest. Doesn't fabricate reasoning the
 * system doesn't have; surfaces what it knows and labels gaps.
 */

import { useState } from 'react';
import type { WhyThisWorkout } from '@/lib/why-this-workout';

interface Props {
  why: WhyThisWorkout;
}

export function WhyTooltip({ why }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          marginLeft: 12,
          padding: '4px 9px',
          background: 'transparent',
          border: '1px solid rgba(13,15,18,.18)',
          borderRadius: 4,
          fontFamily: 'Oswald, sans-serif',
          fontSize: 9.5,
          letterSpacing: 1.3,
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'rgba(13,15,18,.62)',
          cursor: 'pointer',
          verticalAlign: 'middle',
        }}
      >
        {open ? '× Close' : '? Why'}
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
            color: 'rgba(13,15,18,.82)',
            maxWidth: 600,
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: '#0D0F12' }}>Type:</strong> {why.type}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: '#0D0F12' }}>Where in the cycle:</strong> {why.cyclePosition}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: '#0D0F12' }}>Purpose:</strong> {why.purpose}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: '#0D0F12' }}>Volume choice:</strong> {why.volumeChoice}
          </div>
          {why.uncertaintyNotes.length > 0 && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: '1px solid rgba(13,15,18,.08)',
                fontSize: 11,
                color: 'rgba(13,15,18,.55)',
                fontStyle: 'italic',
              }}
            >
              <strong style={{ fontStyle: 'normal', color: 'rgba(13,15,18,.70)' }}>
                What the system knows · what it doesn't:{' '}
              </strong>
              {why.uncertaintyNotes.join(' · ')}
            </div>
          )}
        </div>
      )}
    </>
  );
}
