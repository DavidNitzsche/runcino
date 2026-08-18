import type { CSSProperties, ReactNode } from 'react';
import { Button } from '@/components/redesign/core/Button';

/**
 * components/redesign/feedback/Dialog.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/feedback/Dialog.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, delegates to the already-ported
 * Button for its two actions (matches the source's own import of
 * ../core/Button.jsx).
 */

export interface DialogProps {
  open?: boolean;
  title: string;
  children?: ReactNode;
  /** Concrete verb, e.g. "Retire them". */
  confirmLabel?: string;
  /** The way out, phrased as keeping the status quo. */
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  width?: number;
  style?: CSSProperties;
}

/** Modal confirmation. Only for irreversible acts: deleting a race, discarding a block, retiring a shoe. */
export function Dialog({
  open = true, title, children, confirmLabel = 'Confirm', cancelLabel = 'Keep it',
  destructive = false, onConfirm, onCancel, width = 440, style,
}: DialogProps) {
  if (!open) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'var(--scrim)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-9)', ...style,
    }}>
      <div style={{
        width, background: 'var(--surface-tile-raised)', borderRadius: 'var(--radius-2xl)',
        padding: 'var(--tile-pad-lg)', boxShadow: 'var(--elevation-overlay)', display: 'grid', gap: 'var(--sp-7)',
      }}>
        <div style={{ fontSize: 'var(--type-value-4)', fontWeight: 'var(--weight-semibold)', letterSpacing: '-.02em' }}>{title}</div>
        <div style={{ fontSize: 'var(--type-body-s)', lineHeight: 'var(--lh-body-s)', color: 'var(--text-secondary)', textWrap: 'pretty' }}>{children}</div>
        <div style={{ display: 'flex', gap: 'var(--sp-5)', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
