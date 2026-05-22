/**
 * v4 readiness ring, SVG gauge with a 270° arc (135° gap at the
 * bottom). Maths from overview-v4.html, kept exactly:
 *
 *   r=130 → full circumference = 2π × 130 ≈ 816.81
 *   270° arc = 816.81 × .75 = 612.61  (track stroke-dasharray)
 *   90° gap  = 816.81 × .25 = 204.20  (track dasharray gap)
 *   transform: rotate(135 150 150)    (opens gap at the bottom)
 *
 *   Score fill: dasharray = arc × (score/100), gap = full − arc
 *   For 88/100: 612.61 × .88 = 539.10, gap = 816.81 − 539.10 = 277.71
 *
 * Token: "Building" / "Ready" / "Watching", caption below the ring.
 */

export type ReadinessLevel = 'green' | 'yellow' | 'red';

export interface ReadinessRingProps {
  /** Score 0..100. Null renders an em-dash and dim track. */
  score: number | null;
  /** Threshold tier driving the arc color + the badge. */
  level: ReadinessLevel;
  /** Caption under the ring (e.g. "Building", "Ready", "Watching",
   *  "No data yet"). */
  caption?: string;
}

const TRACK_DASH = 612.61;
const TRACK_GAP  = 204.20;
const FULL_CIRC  = TRACK_DASH + TRACK_GAP; // 816.81

function colorFor(level: ReadinessLevel): string {
  switch (level) {
    case 'green':  return '#3EBD41';
    case 'yellow': return '#F3AD38';
    case 'red':    return '#FC4D64';
  }
}

export function ReadinessRing({ score, level, caption }: ReadinessRingProps) {
  const fillRatio = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const fillLen   = TRACK_DASH * fillRatio;
  const gapLen    = FULL_CIRC - fillLen;
  const color     = colorFor(level);
  const display   = score == null ? ', ' : String(Math.round(score));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg
          width={300}
          height={300}
          viewBox="0 0 300 300"
          style={{ overflow: 'visible' }}
        >
          {/* Track (background ring) */}
          <circle
            cx={150}
            cy={150}
            r={130}
            fill="none"
            stroke="rgba(8,8,8,.08)"
            strokeWidth={16}
            strokeDasharray={`${TRACK_DASH} ${TRACK_GAP}`}
            strokeLinecap="round"
            transform="rotate(135 150 150)"
          />
          {/* Score arc */}
          {score != null && (
            <circle
              cx={150}
              cy={150}
              r={130}
              fill="none"
              stroke={color}
              strokeWidth={16}
              strokeDasharray={`${fillLen.toFixed(2)} ${gapLen.toFixed(2)}`}
              strokeLinecap="round"
              transform="rotate(135 150 150)"
            />
          )}
          {/* Score number */}
          <text
            x={150}
            y={166}
            fontFamily="'Bebas Neue', sans-serif"
            fontSize={96}
            fill="#080808"
            textAnchor="middle"
          >
            {display}
          </text>
          <text
            x={150}
            y={188}
            fontFamily="'Inter', sans-serif"
            fontSize={13}
            fontWeight={600}
            fill="rgba(8,8,8,.32)"
            textAnchor="middle"
            letterSpacing={1}
          >
            / 100
          </text>
        </svg>
      </div>

      {caption && (
        <div
          style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            fontSize: '13px',
            letterSpacing: '3px',
            color,
            textAlign: 'center',
            textTransform: 'uppercase',
            marginTop: '16px',
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
