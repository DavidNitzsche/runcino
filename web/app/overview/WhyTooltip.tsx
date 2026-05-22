'use client';

/**
 * "Why this workout" — a small pill in the hero that expands into a
 * short, plain-English reason for today's run. Three scannable lines:
 * what it is, where you are in the plan, and what it does for you.
 *
 * Layout note: renders OUTSIDE the giant `.hero-title` Bebas wordmark so
 * its panel lays out in normal document flow and never inherits the
 * hero's collapsed line-height or negative tracking.
 */

import { useState } from 'react';
import type { WhyThisWorkout } from '@/lib/why-this-workout';

interface Props {
  why: WhyThisWorkout;
}

export function WhyTooltip({ why }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: 14, fontFamily: 'Inter, sans-serif', letterSpacing: 'normal' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 11px',
          background: 'transparent',
          border: '1px solid rgba(8,8,8,.18)',
          borderRadius: 999,
          fontFamily: 'Oswald, sans-serif',
          fontSize: 9.5,
          letterSpacing: 1.3,
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'rgba(8,8,8,.62)',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        {open ? '× Close' : '? Why this run'}
      </button>

      {open && (
        <div
          style={{
            marginTop: 12,
            padding: '16px 18px',
            background: 'rgba(8,8,8,.03)',
            border: '1px solid rgba(8,8,8,.08)',
            borderRadius: 10,
            maxWidth: 460,
            letterSpacing: 'normal',
          }}
        >
          {/* Line 1 — what it is, as a headline */}
          <div
            style={{
              fontFamily: 'Oswald, sans-serif',
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: 0.2,
              color: 'rgba(8,8,8,.92)',
              lineHeight: 1.2,
            }}
          >
            {why.what}
          </div>

          {/* Line 2 — where you are in the plan */}
          <div
            style={{
              marginTop: 6,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: 'rgba(8,8,8,.62)',
            }}
          >
            {why.whereInPlan}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(8,8,8,.08)', margin: '12px 0' }} />

          {/* Line 3 — the point */}
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              color: 'rgba(8,8,8,.85)',
            }}
          >
            {why.thePoint}
          </div>
        </div>
      )}
    </div>
  );
}
