/**
 * ElevationGradient, smooth-grade-gradient elevation chart.
 *
 * Locked technique from the May 2026 run-detail template:
 *
 *   1. ONE elevation polygon (the entire profile, baseline-closed).
 *   2. Fill = a *horizontal* linearGradient whose stops are placed at
 *      mile boundaries (14.3%, 28.6%, ...) with a ~6% blend zone on
 *      either side of each grade change. Each stop carries the color
 *      for that mile's grade (red=steep, amber=up, white=flat,
 *      green=descent). The horizontal gradient softly blends across
 *      mile transitions.
 *   3. Mask = a *vertical* linearGradient (full white at top, 0 at
 *      bottom). Applied as a SVG mask to the fill, producing the
 *      classic "fade-to-baseline" elevation feel.
 *   4. On top of the filled polygon, the profile line is drawn at full
 *      opacity (no mask).
 *   5. Optional peak marker (filled circle, warn color).
 *
 * Caller supplies `points`, an array of {mile, elev, grade}. The
 * component projects them into a 1400×90 viewBox (preserveAspectRatio
 * = "none" so the path stretches horizontally to fit any width).
 */

import type { CSSProperties } from 'react';

export interface ElevationPoint {
  /** Mile-position. 0 ≤ mile ≤ totalMiles. */
  mile: number;
  /** Elevation in feet (or any unit, only the relative range matters). */
  elev: number;
  /** Grade percent at this point (-100..100). */
  grade?: number;
}

export interface ElevationPeak {
  /** Mile position of the peak. */
  mile: number;
  /** Elevation at the peak. */
  elev: number;
}

export interface ElevationGradientProps {
  points: ElevationPoint[];
  /** When set, marks the peak with a red dot. */
  peak?: ElevationPeak;
  /** Total course distance, used to project mile→x. Defaults to last point's mile. */
  totalMiles?: number;
  /** Override the viewBox height (default 90). */
  height?: number;
  /** Unique id for the gradient/mask defs (when multiple charts share a page). */
  gradientId?: string;
  /** Optional className for the wrapping SVG. */
  className?: string;
  style?: CSSProperties;
}

/**
 * Classify a grade percent into one of four color buckets.
 * Thresholds match the locked May 2026 run-detail template visual:
 *   ≥4%  → STEEP (red) · the headline climb
 *   ≥1%  → UP (amber) · sustained climb
 *   ≤-1% → DESCENT (green) · sustained descent
 *   else → FLAT (white) · ±1% wiggle
 * These are tighter than physics-strict (>6/3/-3) to make per-mile-average
 * grades visually classify the way runners feel them. Callers can pass an
 * explicit `terrainClass` on the point to override.
 */
function gradeColor(g: number | undefined): string {
  if (g === undefined) return 'rgba(244,246,248,.5)';
  if (g >= 4) return '#FC4D64'; // steep
  if (g >= 1) return '#F3AD38'; // up
  if (g <= -1) return '#3EBD41'; // descent
  return 'rgba(244,246,248,.5)';  // flat
}

const VIEW_W = 1400;

export function ElevationGradient({
  points,
  peak,
  totalMiles,
  height = 90,
  gradientId = 'eg',
  className,
  style,
}: ElevationGradientProps) {
  if (points.length < 2) {
    return null;
  }

  const total = totalMiles ?? points[points.length - 1].mile;
  const minE = Math.min(...points.map((p) => p.elev));
  const maxE = Math.max(...points.map((p) => p.elev));
  const eRange = maxE - minE || 1;

  const projX = (mile: number) => (mile / total) * VIEW_W;
  const projY = (elev: number) => {
    // 18 = top padding (so peak isn't flush) · 75 = baseline · 90 - 75 = ground tail
    const usable = 90 - 18 - 15;
    return 18 + usable * (1 - (elev - minE) / eRange);
  };

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${projX(p.mile).toFixed(1)} ${projY(p.elev).toFixed(1)}`)
    .join(' ');

  const fillPath =
    linePath +
    ` L ${projX(points[points.length - 1].mile).toFixed(1)} ${height} L ${projX(points[0].mile).toFixed(1)} ${height} Z`;

  // Build horizontal gradient stops. For each point, emit a stop with the
  // grade-class color at its x-percentage. We add a small blend zone (~3%)
  // on each side of a grade change to keep transitions soft.
  const gradientStops = points.map((p) => {
    const offset = (p.mile / total) * 100;
    return (
      <stop
        key={`g-${p.mile}`}
        offset={`${offset.toFixed(1)}%`}
        stopColor={gradeColor(p.grade)}
      />
    );
  });

  const polylineId = `${gradientId}-grad`;
  const maskId = `${gradientId}-mask`;
  const fadeId = `${gradientId}-fade`;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: '100%', height: 60, display: 'block', marginTop: 10, ...style }}
    >
      <defs>
        <linearGradient id={polylineId} x1="0" x2="1" y1="0" y2="0">
          {gradientStops}
        </linearGradient>
        <linearGradient id={fadeId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width={VIEW_W} height={height} fill={`url(#${fadeId})`} />
        </mask>
      </defs>

      {/* Filled polygon: horizontal grade-gradient + vertical fade mask */}
      <path d={fillPath} fill={`url(#${polylineId})`} opacity="0.40" mask={`url(#${maskId})`} />

      {/* Profile line on top */}
      <path
        d={linePath}
        fill="none"
        stroke="#F4F6F8"
        strokeWidth="2"
        strokeOpacity="0.85"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {peak && (
        <circle
          cx={projX(peak.mile)}
          cy={projY(peak.elev)}
          r="4"
          fill="#FC4D64"
          stroke="#10131A"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}
