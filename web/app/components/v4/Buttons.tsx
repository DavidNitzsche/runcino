/**
 * v4 buttons — the two action affordances from overview-v4.html.
 *
 * Primary  → solid ink fill, white text, used for the "do it" action
 *            (OPEN WORKOUT, LOG CHECK-IN, MARK COMPLETE).
 * Ghost    → bordered, no fill, used for the secondary action
 *            (SKIP TODAY, etc.). Picks up amber when in "skipped" state.
 *
 * Inline styles only — no new CSS classes. Tokens come from globals.css
 * (--ink, --line-2, --milestone for amber).
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
};

const baseBtn = {
  padding: '14px 32px',
  borderRadius: '10px',
  fontFamily: 'Oswald, sans-serif',
  fontWeight: 600,
  fontSize: '13px',
  letterSpacing: '1.5px',
  textTransform: 'uppercase' as const,
  cursor: 'pointer',
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  whiteSpace: 'nowrap' as const,
};

export function PrimaryButton({ children, style, ...rest }: BaseProps) {
  return (
    <button
      type="button"
      style={{
        ...baseBtn,
        background: 'var(--ink, #0D0F12)',
        color: '#FFFFFF',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, style, ...rest }: BaseProps) {
  return (
    <button
      type="button"
      style={{
        ...baseBtn,
        background: 'transparent',
        border: '1.5px solid rgba(13,15,18,.2)',
        color: 'var(--ink, #0D0F12)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
