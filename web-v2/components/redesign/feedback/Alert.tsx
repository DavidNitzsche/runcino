import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/feedback/Alert.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/feedback/Alert.jsx + .d.ts),
 * 2026-08-18. Faithful port: same TONE bg/bar table (info uses the flat
 * raised-tile surface; attention/fault use color-mix onto the tile surface
 * with the state's ink color, matching this codebase's existing `color-mix
 * (in oklab, ...)` idiom already used throughout colors.css).
 *
 * A persistent banner stating a condition. Three tones only; there is no
 * success tone — never used for praise, never for marketing. Real usage in
 * designs/design-review-0818/ui_kits/web/WebRaceWeek.jsx:
 * `<Alert tone="attention" title="Weather is still moving">…</Alert>`.
 */

export type AlertTone = 'info' | 'attention' | 'fault';

const TONE: Record<AlertTone, { bg: string; bar: string }> = {
  info: { bg: 'var(--surface-tile-raised)', bar: 'var(--state-phase-ink)' },
  attention: { bg: 'color-mix(in oklab, var(--state-quality) 14%, var(--surface-tile))', bar: 'var(--state-quality-ink)' },
  fault: { bg: 'color-mix(in oklab, var(--state-alarm) 12%, var(--surface-tile))', bar: 'var(--state-alarm-ink)' },
};

export interface AlertProps {
  children?: ReactNode;
  /** info = context. attention = provisional, stale or waiting. fault = we could not read something. */
  tone?: AlertTone;
  title?: string | null;
  action?: ReactNode;
  style?: CSSProperties;
}

export function Alert({ children, tone = 'info', title = null, action = null, style }: AlertProps) {
  const t = TONE[tone];
  return (
    <div style={{
      display: 'flex', gap: 'var(--sp-6)', background: t.bg, borderRadius: 'var(--radius-l)',
      padding: 'var(--sp-7)', ...style,
    }}>
      <span style={{ width: 3, alignSelf: 'stretch', background: t.bar, borderRadius: 2 }} />
      <div style={{ flex: 1, display: 'grid', gap: 'var(--sp-4)' }}>
        {title && <div style={{ fontSize: 'var(--type-label)', fontWeight: 'var(--weight-semibold)' }}>{title}</div>}
        <div style={{ fontSize: 'var(--type-body-s)', lineHeight: 'var(--lh-body-s)', color: 'var(--text-secondary)', textWrap: 'pretty' }}>
          {children}
        </div>
      </div>
      {action}
    </div>
  );
}
