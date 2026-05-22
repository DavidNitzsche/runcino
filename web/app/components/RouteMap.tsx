/**
 * RouteMap, stylized GPS canvas from the locked run-detail template.
 *
 * Renders a SVG (viewBox 600×260) showing:
 *   · A subtle contour pattern (rotated, very low opacity)
 *   · An optional water/bay hint at the bottom edge
 *   · The route polyline as a wide soft halo + thin gradient stroke
 *   · Numbered mile markers (filled circles with stroke + numeric label)
 *   · Start dot (filled green) + finish dot (orange ring)
 *   · A small footer strip showing start time / loop label / link
 *
 * The polyline points are supplied as `[x, y]` pairs already projected
 * into the 600×260 viewBox by the caller. (Use `lib/gpx-analysis.ts` to
 * project lat/lon → viewBox before passing in.)
 *
 * If `points` is omitted, the canvas renders the contour + bay backdrop
 * only, useful as a placeholder while the GPX is loading.
 */

import type { ReactNode } from 'react';

export interface RouteMapPoint {
  x: number;
  y: number;
}

export interface RouteMapMarker extends RouteMapPoint {
  /** Display number, typically the mile number. */
  n: number | string;
  /** Render this marker a touch bigger (used to highlight peak / midway). */
  emphasize?: boolean;
}

export interface RouteMapProps {
  /** Polyline of [x, y] pairs in the 600×260 viewBox. Optional placeholder when absent. */
  points?: RouteMapPoint[];
  /** Mile markers. */
  miles?: RouteMapMarker[];
  /** Optional start coordinate (green filled dot). */
  start?: RouteMapPoint;
  /** Optional finish coordinate (orange ring dot). */
  finish?: RouteMapPoint;
  /** When true, draws the bay-hint band at the bottom of the canvas. */
  bayHint?: boolean;
  /** Caption shown left side of the footer (e.g. "▶ 8:42 AM"). */
  startTime?: ReactNode;
  /** Caption shown middle of the footer (e.g. "LOOP · 6.7 MI"). */
  routeLabel?: ReactNode;
  /** Caption shown right side of the footer (e.g. "OPEN →"). */
  finishLabel?: ReactNode;
  /** Override route stroke color. Defaults to var(--good). */
  strokeColor?: string;
  /** Unique id suffix used by the gradient/pattern defs (when multiple
   * RouteMaps render on a single page).
   */
  gradientId?: string;
}

export function RouteMap({
  points,
  miles = [],
  start,
  finish,
  bayHint = true,
  startTime,
  routeLabel,
  finishLabel,
  strokeColor = '#3EBD41',
  gradientId = 'rm',
}: RouteMapProps) {
  const polyline = points && points.length > 0
    ? points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ')
    : null;

  const contourId = `contours-${gradientId}`;
  const strokeGradientId = `route-${gradientId}`;

  return (
    <>
      <svg viewBox="0 0 600 260" style={{ width: '100%', height: 'auto', display: 'block', marginTop: 6 }}>
        <defs>
          <pattern
            id={contourId}
            patternUnits="userSpaceOnUse"
            width="50"
            height="50"
            patternTransform="rotate(8)"
          >
            <path d="M -10 25 Q 10 18, 25 25 T 60 25" fill="none" stroke="rgba(244,246,248,.025)" strokeWidth="1" />
            <path d="M -10 45 Q 10 38, 25 45 T 60 45" fill="none" stroke="rgba(244,246,248,.025)" strokeWidth="1" />
          </pattern>
          <linearGradient id={strokeGradientId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={strokeColor} stopOpacity=".7" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="1" />
          </linearGradient>
        </defs>

        <rect width="600" height="260" fill="#0B0E14" />
        <rect width="600" height="260" fill={`url(#${contourId})`} />

        {bayHint && (
          <>
            <path
              d="M -20 235 Q 100 222, 190 226 T 360 217 Q 450 214, 550 210 L 550 280 L -20 280 Z"
              fill="rgba(0,143,236,.06)"
              stroke="rgba(0,143,236,.18)"
              strokeWidth="1"
              strokeDasharray="3 5"
            />
            <text
              x="20"
              y="248"
              fontFamily="JetBrains Mono"
              fontSize="9"
              fontWeight="700"
              fill="rgba(0,143,236,.35)"
              letterSpacing=".8"
            >
              SD BAY
            </text>
          </>
        )}

        {polyline && (
          <>
            {/* Soft halo */}
            <path
              d={polyline}
              fill="none"
              stroke={`rgba(62,189,65,.18)`}
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Gradient stroke */}
            <path
              d={polyline}
              fill="none"
              stroke={`url(#${strokeGradientId})`}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {/* Mile markers */}
        <g fontFamily="JetBrains Mono" fontSize="9.5" fontWeight="700" fill="#F4F6F8">
          {miles.map((m, i) => (
            <g key={i}>
              <circle
                cx={m.x}
                cy={m.y}
                r={m.emphasize ? 10 : 9}
                fill="#10131A"
                stroke={strokeColor}
                strokeWidth={m.emphasize ? 2.5 : 2}
              />
              <text x={m.x} y={m.y + 4} textAnchor="middle">
                {m.n}
              </text>
            </g>
          ))}
        </g>

        {start && (
          <>
            <circle cx={start.x} cy={start.y} r="10" fill={strokeColor} stroke="#10131A" strokeWidth="2.5" />
            <circle cx={start.x} cy={start.y} r="3" fill="#10131A" />
          </>
        )}
        {finish && (
          <>
            <circle cx={finish.x} cy={finish.y} r="9" fill="#10131A" stroke="#FF5722" strokeWidth="2.5" />
            <circle cx={finish.x} cy={finish.y} r="4" fill="#FF5722" />
          </>
        )}

        {/* Compass */}
        <g transform="translate(560, 32)">
          <circle r="14" fill="rgba(16,19,26,.6)" stroke="rgba(244,246,248,.15)" />
          <path d="M 0 -9 L 3 0 L 0 9 L -3 0 Z" fill="#F4F6F8" opacity=".7" />
          <text
            y="-18"
            textAnchor="middle"
            fontFamily="JetBrains Mono"
            fontSize="7"
            fontWeight="700"
            fill="rgba(244,246,248,.6)"
            letterSpacing=".8"
          >
            N
          </text>
        </g>

        {/* Scale bar, fixed at 100 viewBox-units wide */}
        <g transform="translate(24, 230)">
          <line x1="0" y1="0" x2="100" y2="0" stroke="rgba(244,246,248,.4)" strokeWidth="1.5" />
          <line x1="0" y1="-3" x2="0" y2="3" stroke="rgba(244,246,248,.4)" strokeWidth="1.5" />
          <line x1="100" y1="-3" x2="100" y2="3" stroke="rgba(244,246,248,.4)" strokeWidth="1.5" />
        </g>
      </svg>

      {(startTime !== undefined || routeLabel !== undefined || finishLabel !== undefined) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '8px 18px',
            borderTop: '1px solid var(--l4)',
            fontFamily: 'var(--f-data)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '.4px',
            color: 'var(--t3)',
          }}
        >
          <span>{startTime}</span>
          <span style={{ color: 'var(--t2)' }}>{routeLabel}</span>
          <span style={{ color: 'var(--coach)' }}>{finishLabel}</span>
        </div>
      )}
    </>
  );
}
