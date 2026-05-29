'use client';

/**
 * SegmentedToggle — iOS-style segmented control (#160).
 *
 * Replaces the "two floating pills" pattern with a proper bound widget:
 * single rounded container, accent fill on selected, full-ink unselected
 * (so it reads as tappable, not dead text), divider lines between options.
 *
 * Used by: unit toggles (MI/KM, MIN/MI vs MIN/KM, F/C), Strava push card
 * privacy + title-format, post-run check-in chip rows, and anywhere
 * else a small bound multiple-choice selector is needed.
 *
 * Tokens: var(--f-label) for the labels (matches typography rule #159).
 */
import * as React from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional one-liner shown on hover/long-press; not rendered inline. */
  hint?: string;
}

interface Props<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  /** Solid fill color for the selected segment. Default: green. */
  accent?: string;
  /** Ink color on the selected segment. Default: dark for contrast. */
  selectedInk?: string;
  /** Size preset. "sm" is the default; "lg" used for prominent rows. */
  size?: 'sm' | 'lg';
  /** Visual disabled state — clicks are no-ops, opacity drops. */
  loading?: boolean;
  /** Optional `aria-label` for the group. */
  ariaLabel?: string;
}

export function SegmentedToggle<T extends string>({
  value, options, onChange, accent = 'var(--green)', selectedInk = '#0e1014',
  size = 'sm', loading = false, ariaLabel,
}: Props<T>) {
  const padY = size === 'lg' ? 10 : 6;
  const padX = size === 'lg' ? 16 : 12;
  const fontSize = size === 'lg' ? 11 : 10;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        background: 'var(--card-2)',
        borderRadius: size === 'lg' ? 10 : 8,
        padding: 2,
        opacity: loading ? 0.55 : 1,
        cursor: loading ? 'wait' : 'default',
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.hint}
            onClick={() => !loading && opt.value !== value && onChange(opt.value)}
            disabled={loading}
            style={{
              padding: `${padY}px ${padX}px`,
              borderRadius: size === 'lg' ? 8 : 6,
              border: 'none',
              background: active ? accent : 'transparent',
              color: active ? selectedInk : 'var(--ink)',
              fontFamily: 'var(--f-label)',
              fontSize,
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: loading ? 'wait' : (active ? 'default' : 'pointer'),
              transition: 'background .12s, color .12s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!loading && !active) {
                e.currentTarget.style.background = 'var(--card)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && !active) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
