/**
 * C2 · Z2 pace sparkline · Coach Reads HR section
 *
 * Tiny inline SVG showing 8-week trend of weighted Z2 pace. Reads
 * Z2SparklineResult; renders nothing when hasSignal=false (insufficient
 * data — typically requires ≥3 weeks with Z2 splits).
 *
 * VISUAL CONVENTION
 *   - Y-axis is INVERTED (faster pace = up). A descending line on
 *     screen = pace getting slower = aerobic-base regression. An
 *     ASCENDING line = faster at fixed HR = fitness gain.
 *   - Most-recent point is rendered larger (orange dot).
 *   - Weeks with no data render no dot; line connects only across
 *     adjacent populated weeks.
 *   - Annotation line below: "8wk Z2 pace at HR X-Y · faster ↑"
 *     so the runner can read the y-axis direction explicitly.
 */

import type { Z2SparklineResult } from '@/lib/z2-sparkline';

interface Props {
  data: Z2SparklineResult;
}

function fmtPace(s: number): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function Z2Sparkline({ data }: Props) {
  if (!data.hasSignal || !data.paceRange || !data.z2Band) return null;

  const W = 280;
  const H = 56;
  const padX = 10;
  const padY = 8;

  const points = data.points;
  const N = points.length;
  // X positions: evenly spaced across plot width.
  const xs = points.map((_, i) => padX + (i * (W - 2 * padX)) / (N - 1));
  // Y positions: invert so faster pace renders HIGHER.
  // Add 5s padding above min + below max so endpoints don't sit on
  // the edge.
  const yMin = data.paceRange.min - 5;
  const yMax = data.paceRange.max + 5;
  const yRange = Math.max(1, yMax - yMin);
  const ys = points.map((p) =>
    p.paceSPerMi == null ? null : padY + ((p.paceSPerMi - yMin) / yRange) * (H - 2 * padY),
  );

  // Build the polyline string only across consecutive populated points.
  const linePath: string[] = [];
  let started = false;
  for (let i = 0; i < N; i++) {
    if (ys[i] == null) { started = false; continue; }
    linePath.push(`${started ? 'L' : 'M'}${xs[i]},${ys[i]}`);
    started = true;
  }
  const lineD = linePath.join(' ');

  // First-vs-last comparison for the trend label.
  const firstPace = points.find((p) => p.paceSPerMi != null)?.paceSPerMi ?? null;
  const lastPace = [...points].reverse().find((p) => p.paceSPerMi != null)?.paceSPerMi ?? null;
  const deltaS = (firstPace != null && lastPace != null) ? lastPace - firstPace : null;
  const trendLabel = deltaS == null ? null
    : deltaS <= -5 ? `↑ ${Math.abs(deltaS)}s/mi faster`
    : deltaS >= 5  ? `↓ ${deltaS}s/mi slower`
    : 'steady';
  const trendColor = deltaS == null ? '#888'
    : deltaS <= -5 ? '#3EBD41'
    : deltaS >= 5  ? '#b3450a'
    : '#666';

  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 12px',
        background: 'rgba(8,8,8,.025)',
        border: '1px solid rgba(8,8,8,.08)',
        borderRadius: 8,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontSize: 9.5,
          letterSpacing: 1.3,
          textTransform: 'uppercase',
          color: 'rgba(8,8,8,.55)',
          fontWeight: 700,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span>8wk Z2 pace · HR {data.z2Band.lo}-{data.z2Band.hi}</span>
        {trendLabel && (
          <span style={{ color: trendColor, fontWeight: 700 }}>{trendLabel}</span>
        )}
      </div>

      <svg width={W} height={H} role="img" aria-label="Z2 pace trend over 8 weeks">
        {/* Subtle baseline gridline at mid-y */}
        <line x1={padX} x2={W - padX} y1={H / 2} y2={H / 2}
          stroke="rgba(8,8,8,.08)" strokeDasharray="2 3" />
        {/* Trend line */}
        {lineD && (
          <path d={lineD} fill="none" stroke="rgba(8,8,8,.62)" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" />
        )}
        {/* Dots, most-recent highlighted */}
        {points.map((p, i) => {
          const y = ys[i];
          if (y == null) return null;
          const isLast = i === N - 1;
          return (
            <circle
              key={i}
              cx={xs[i]} cy={y}
              r={isLast ? 3.2 : 2}
              fill={isLast ? '#E85D26' : 'rgba(8,8,8,.55)'}
            />
          );
        })}
      </svg>

      <div
        style={{
          fontSize: 10.5,
          color: 'rgba(8,8,8,.55)',
          marginTop: 4,
          display: 'flex',
          justifyContent: 'space-between',
          paddingLeft: padX,
          paddingRight: padX,
        }}
      >
        <span>{firstPace != null ? `${fmtPace(firstPace)}/mi` : '—'}</span>
        <span style={{ color: '#E85D26', fontWeight: 600 }}>
          {lastPace != null ? `${fmtPace(lastPace)}/mi` : '—'} now
        </span>
      </div>

      <div style={{ fontSize: 11, color: 'rgba(8,8,8,.55)', marginTop: 6, lineHeight: 1.4 }}>
        Pace your Z2 splits average at fixed HR. Faster at fixed HR = aerobic gain.
        {' '}<span style={{ color: 'rgba(8,8,8,.42)' }}>Inverted: faster pace renders higher.</span>
      </div>

      {data.crossRef && (
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid rgba(8,8,8,.06)',
          fontSize: 11,
          color: 'rgba(8,8,8,.62)',
          lineHeight: 1.45,
        }}>
          {data.recalibrationHedge ? (
            <>
              {data.recalibrationHedge}{' '}
              <a
                href={data.crossRef.href}
                style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
              >
                {data.crossRef.text}
              </a>
              {'.'}
            </>
          ) : (
            <>
              Zones recalibrated this window — {' '}
              <a
                href={data.crossRef.href}
                style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
              >
                {data.crossRef.text}
              </a>
              {'.'}
            </>
          )}
        </div>
      )}
    </div>
  );
}
