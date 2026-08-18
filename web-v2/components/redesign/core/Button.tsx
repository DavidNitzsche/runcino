'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';

/**
 * components/redesign/core/Button.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (docs/design/DESIGN-BRIEF-site-wide-redesign.md, components/core/Button)
 * 2026-08-18. Faithful port: same tokens, same variant/size tables, same
 * hover/press interaction — converted from the handoff's inline-style JS
 * object pattern to typed TSX, matching this file's real environment
 * (this app has no Tailwind/CSS-in-JS library; inline styles keyed to
 * CSS custom properties is the idiomatic match, same as every existing
 * faff-app component already does).
 */

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'lg' | 'md' | 'sm';

const BASE: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-4)',
  border: 0, cursor: 'pointer', fontFamily: 'var(--font-core)', fontWeight: 'var(--weight-semibold)',
  letterSpacing: '-.01em', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
  transition: 'filter var(--dur-1) var(--ease-out), background var(--dur-2) var(--ease-out), transform var(--dur-1) var(--ease-out)',
};

const SIZES: Record<ButtonSize, CSSProperties> = {
  lg: { height: 56, padding: '0 28px', fontSize: 17 },
  md: { height: 50, padding: '0 24px', fontSize: 16 },
  sm: { height: 44, padding: '0 18px', fontSize: 15 },
};

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--material-action)', color: 'var(--action-primary-text)', boxShadow: 'var(--elevation-control)' },
  accent: { backgroundImage: 'var(--g-quality)', color: '#221503', boxShadow: '0 8px 22px -10px rgba(232,93,38,.6)' },
  secondary: { background: 'var(--material-control)', color: 'var(--text-primary)', boxShadow: 'var(--elevation-control)' },
  ghost: { background: 'transparent', color: 'var(--text-secondary)' },
  destructive: { background: 'transparent', color: 'var(--fault)', boxShadow: 'inset 0 0 0 2px var(--fault)' },
};

export interface ButtonProps {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  full?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  style?: CSSProperties;
}

/** Concrete verbs only. Never "Accept" or "Dismiss". */
export function Button({
  children, variant = 'primary', size = 'md', disabled = false, full = false,
  icon = null, onClick, type = 'button', style,
}: ButtonProps) {
  const [hot, setHot] = useState(false);
  const [down, setDown] = useState(false);
  const s: CSSProperties = {
    ...BASE, ...SIZES[size], ...VARIANTS[variant],
    width: full ? '100%' : undefined,
    filter: hot && !disabled ? 'var(--hover-lift)' : 'none',
    transform: down && !disabled ? 'scale(var(--press-scale))' : 'none',
    opacity: disabled ? 0.38 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    ...style,
  };
  return (
    <button
      type={type}
      style={s}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => { setHot(false); setDown(false); }}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
    >
      {icon}{children}
    </button>
  );
}
