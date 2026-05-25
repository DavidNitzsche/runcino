/**
 * EmptyState · Skeleton
 *
 * The three-state primitive set from _template-empty-2026-05-09.
 *
 * <EmptyState> is used for empty / error / success states. Variants
 * change only the glyph color. The glyph itself defaults sensibly per
 * variant (∅ for empty, ! for error, ✓ for success) but can be overridden.
 *
 * <Skeleton> is a shimmering rectangle for loading placeholders. Width,
 * height, and border-radius are all configurable.
 */

import type { ReactNode, CSSProperties } from 'react';

export type EmptyStateVariant = 'empty' | 'error' | 'success';

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  /** Override the default glyph. */
  glyph?: ReactNode;
  title: ReactNode;
  /** Body text, short paragraph beneath the title. */
  body?: ReactNode;
  /** Optional CTA, typically a <button className="btn-flat btn-primary">. */
  cta?: ReactNode;
}

const DEFAULT_GLYPHS: Record<EmptyStateVariant, string> = {
  empty: '∅',
  error: '!',
  success: '✓',
};

export function EmptyState({
  variant = 'empty',
  glyph,
  title,
  body,
  cta,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div
        className={`empty-glyph${variant !== 'empty' ? ` ${variant}` : ''}`}
        aria-hidden
      >
        {glyph ?? DEFAULT_GLYPHS[variant]}
      </div>
      <h3>{title}</h3>
      {body !== undefined && <p>{body}</p>}
      {cta !== undefined && <div>{cta}</div>}
    </div>
  );
}

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number | string;
  /** Optional extra className. */
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({
  width = '100%',
  height = 14,
  borderRadius,
  className,
  style,
}: SkeletonProps) {
  const merged: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    ...style,
  };
  if (borderRadius !== undefined) {
    merged.borderRadius = typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius;
  }
  return <div className={`skeleton${className ? ` ${className}` : ''}`} style={merged} />;
}
