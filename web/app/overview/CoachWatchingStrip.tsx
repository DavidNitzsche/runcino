'use client';

/**
 * CoachWatchingStrip · Wave G-1
 *
 * The horizontal "coach is watching" strip that sits just under the
 * /overview header. Each chip surfaces one real signal the coach is
 * monitoring right now, with a freshness/state value and a colour
 * variant that reflects how that signal is reading.
 *
 * Source mockup: Wave G goal, "make the coach feel always on" without
 * inventing numbers.
 *
 * Data flows in via `_alive-coach.ts`'s `loadAliveCoachData()` →
 * `AliveCoachData.watching` (WatchingChip[]).
 *
 * No file in this component edits data.ts, page.tsx, TodayCard, or the
 * plan-adapted card, Wave F owns those. Integration into /overview/
 * page.tsx happens in a follow-up after Wave F lands.
 */

import type { WatchingChip } from './_alive-coach';

export interface CoachWatchingStripProps {
  /** The chips to render, left → right. Order set by the loader. */
  chips: WatchingChip[];
}

/** Per-variant CSS, drives the chip background + accent stripe.
 *  Mirrors the existing card-pin palette so the strip reads as a
 *  natural extension of the page's design system. */
const VARIANT_STYLES: Record<WatchingChip['variant'], {
  background: string;
  border: string;
  color: string;
  accent: string;
}> = {
  green: {
    background: 'rgba(62,189,65,.10)',
    border: 'rgba(62,189,65,.32)',
    color: '#7CD97F',
    accent: '#3EBD41',
  },
  amber: {
    background: 'rgba(243,173,56,.10)',
    border: 'rgba(243,173,56,.32)',
    color: '#F3AD38',
    accent: '#F3AD38',
  },
  warn: {
    background: 'rgba(252,77,100,.10)',
    border: 'rgba(252,77,100,.32)',
    color: '#FC4D64',
    accent: '#FC4D64',
  },
  muted: {
    background: 'rgba(244,246,248,.04)',
    border: 'rgba(244,246,248,.10)',
    color: 'var(--t2)',
    accent: 'var(--t2)',
  },
};

export function CoachWatchingStrip({ chips }: CoachWatchingStripProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        background: 'var(--l1)',
        border: '1px solid var(--l4)',
        borderRadius: 14,
        overflowX: 'auto',
      }}
      aria-label="Coach is watching"
    >
      {/* The pulse dot, implies the coach is live, scanning all
          signals. CSS keyframe lives in globals.css; here we set the
          base styles. */}
      <span
        style={{
          flexShrink: 0,
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#3EBD41',
          boxShadow: '0 0 0 0 rgba(62,189,65,.5)',
          animation: 'pulse-dot 2s infinite ease-out',
        }}
        aria-hidden
      />

      <span
        style={{
          flexShrink: 0,
          fontFamily: 'var(--f-data)',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--t2)',
          letterSpacing: '1.6px',
          textTransform: 'uppercase',
          marginRight: 4,
        }}
      >
        Coach Watching
      </span>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'nowrap' }}>
        {chips.map((chip) => {
          const v = VARIANT_STYLES[chip.variant];
          return (
            <div
              key={chip.id}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                padding: '8px 12px',
                minWidth: 96,
                background: v.background,
                border: `1px solid ${v.border}`,
                borderRadius: 10,
                flexShrink: 0,
              }}
            >
              {/* Left accent bar, louder for fresh signals so the eye
                  is drawn to whatever the coach just acted on. */}
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 6,
                  bottom: 6,
                  width: chip.isFresh ? 3 : 2,
                  background: v.accent,
                  borderRadius: 2,
                  opacity: chip.isFresh ? 1 : 0.6,
                }}
                aria-hidden
              />
              <span
                style={{
                  fontFamily: 'var(--f-data)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '1.6px',
                  color: 'var(--t2)',
                  textTransform: 'uppercase',
                }}
              >
                {chip.label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--f-data)',
                  fontSize: 12,
                  fontWeight: 700,
                  color: v.color,
                  letterSpacing: '0.6px',
                }}
              >
                {chip.value}
              </span>
              {chip.hint && (
                <span
                  style={{
                    fontFamily: 'var(--f-data)',
                    fontSize: 9,
                    fontWeight: 500,
                    color: 'var(--t3, var(--t2))',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    opacity: 0.7,
                  }}
                >
                  {chip.hint}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Keyframes for the pulse dot. Scoped via the global tag so the
          component is self-contained (no globals.css edit needed). */}
      <style>{`
        @keyframes pulse-dot {
          0%   { box-shadow: 0 0 0 0 rgba(62,189,65,.55); }
          70%  { box-shadow: 0 0 0 8px rgba(62,189,65,0); }
          100% { box-shadow: 0 0 0 0 rgba(62,189,65,0); }
        }
      `}</style>
    </div>
  );
}
