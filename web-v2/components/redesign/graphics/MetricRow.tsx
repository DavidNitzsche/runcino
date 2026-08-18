import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/graphics/MetricRow.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/MetricRow.jsx + .d.ts),
 * 2026-08-18. Faithful port: uses the `faff-metric-row` / `faff-mv` CSS
 * classes already defined in app/redesign/tokens/base.css (same grid +
 * value-register rules the source .jsx assumes exist as a global stylesheet).
 */

export interface MetricRowItem {
  label: string;
  /** Optional qualifier. Its line is reserved in every column whether filled or not. */
  sub?: string;
  value: ReactNode;
  /** Unit, set small beside the value. */
  unit?: string;
  size?: 'md' | 'lg';
  tone?: 'primary' | 'attention' | 'quiet';
  /** The column's RangeScale. Pass it with style={{marginTop:0}} so the grid owns the spacing. */
  scale?: ReactNode;
}

export interface MetricRowProps {
  items?: MetricRowItem[];
  /** Override the column template. Defaults to one equal minmax(0,1fr) column per item. */
  columns?: string | null;
  style?: CSSProperties;
}

/**
 * A row of ranged quantities on one grid: labels, values and scales each share a baseline
 * across every column, whether or not a column has a sub-label. Never hand-lay a metric row.
 * The value register steps down with the column width, so the row cannot wrap or overflow.
 */
export function MetricRow({ items = [], columns = null, style }: MetricRowProps) {
  return (
    <div
      className="faff-metric-row"
      style={{ ['--faff-cols' as string]: items.length, gridTemplateColumns: columns || undefined, ...style }}
    >
      {items.map((it, i) => (
        <div key={`l${i}`}>
          <div style={{ fontSize: 'var(--type-label)', lineHeight: 'var(--lh-label)', color: 'var(--text-secondary)' }}>{it.label}</div>
          <div style={{ fontSize: 'var(--type-label-s)', lineHeight: 'var(--lh-label)', color: 'var(--text-quiet)', marginTop: 4, minHeight: 16 }}>{it.sub || ''}</div>
        </div>
      ))}
      {items.map((it, i) => (
        <div
          key={`v${i}`}
          className="faff-mv"
          style={{ color: it.tone === 'attention' ? 'var(--attention)' : it.tone === 'quiet' ? 'var(--text-quiet)' : 'var(--text-primary)' }}
        >
          {it.value}{it.unit && <span>{it.unit}</span>}
        </div>
      ))}
      {items.map((it, i) => <div key={`s${i}`}>{it.scale || null}</div>)}
    </div>
  );
}
