/**
 * Row — 12-column grid row.
 *
 * The May 2026 design system rests on a 12-column grid. `Row` is a thin
 * wrapper around `<div class="row">` which defaults to
 * `grid-template-columns: repeat(12, 1fr)`. Each child is expected to
 * carry a `span-N` class (1 ≤ N ≤ 12).
 *
 * If you need a different track count (e.g. 7 mile chips across the
 * full width), pass `columns` and the wrapper will set
 * `grid-template-columns: repeat(N, 1fr)` inline.
 */

import type { ReactNode, CSSProperties, HTMLAttributes } from 'react';

export interface RowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Override the default 12-column track count. */
  columns?: number;
  /** Override gap. Defaults to the design-system gap (10px). */
  gap?: number | string;
}

export function Row({ children, columns, gap, className, style, ...rest }: RowProps) {
  const merged: CSSProperties = { ...style };
  if (columns !== undefined) merged.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  if (gap !== undefined) merged.gap = typeof gap === 'number' ? `${gap}px` : gap;
  return (
    <div className={`row${className ? ` ${className}` : ''}`} style={merged} {...rest}>
      {children}
    </div>
  );
}
