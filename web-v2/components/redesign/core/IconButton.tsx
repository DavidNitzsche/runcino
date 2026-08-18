'use client';

import { useState, type CSSProperties } from 'react';
import { Icon } from '@/components/redesign/core/Icon';

/**
 * components/redesign/core/IconButton.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/core/IconButton.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same variant table, same
 * hover-only interaction (the source has no pressed state, unlike Button).
 * Built first in this batch — Sheet (item 12) renders one for its close
 * control, matching the source's own WebSheet.jsx.
 */

export type IconButtonVariant = 'secondary' | 'ghost' | 'accent';

export interface IconButtonProps {
  /** Lucide icon name. */
  name: string;
  size?: number;
  variant?: IconButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  /** Accessible label. Required in practice. */
  label?: string;
  style?: CSSProperties;
}

const BG: Record<IconButtonVariant, string> = {
  secondary: 'var(--surface-control)',
  ghost: 'transparent',
  accent: 'var(--action-accent)',
};

/** Square-ish tap target for a single action with no label. */
export function IconButton({
  name, size = 44, variant = 'secondary', disabled = false, onClick, label, style,
}: IconButtonProps) {
  const [hot, setHot] = useState(false);
  const fg = variant === 'accent' ? 'var(--text-on-signal)' : 'var(--text-primary)';
  return (
    <button
      aria-label={label || name}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{
        width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: 0, borderRadius: 'var(--radius-pill)',
        background: hot && !disabled ? 'var(--surface-control-hover)' : BG[variant],
        color: fg, opacity: disabled ? 0.38 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background var(--dur-2) var(--ease-out)',
        ...style,
      }}
    >
      <Icon name={name} size={Math.round(size * 0.45)} />
    </button>
  );
}
