/**
 * HealthBars — daily bar charts for sleep / RHR / HRV / weight.
 * Each bar = one honest data point. No smoothed lines.
 *
 * Labeled version: y-axis shows min/max with units, x-axis shows
 * the time window (e.g. "30D AGO → TODAY"), most-recent bar is
 * highlighted, baseline gets an inline label.
 */

interface BarProps {
  series: number[];          // values (one per day), oldest first → newest last
  min: number; max: number;  // y-domain (display bounds)
  color: string;
  unit?: string;             // e.g. "h", "bpm", "ms", "lb"
  baseline?: number;         // optional baseline value (drawn as dashed line + labeled)
  xLabel?: string;           // override x-axis label; default "30D AGO → TODAY"
  height?: number;
}

export function BarChart({
  series, min, max, color, unit = '', baseline, xLabel, height = 64,
}: BarProps) {
  if (series.length === 0) {
    return (
      <div style={{ height: height + 36, color: 'var(--mute)', fontSize: 11, fontStyle: 'italic', display: 'flex', alignItems: 'center' }}>
        (no data yet)
      </div>
    );
  }

  // SVG layout — leave room on the left for the y-axis label.
  const W = 320;
  const PAD_L = 32;      // y-axis label column
  const PAD_R = 4;
  const plotW = W - PAD_L - PAD_R;
  const slot  = plotW / Math.max(series.length, 1);
  const barW  = Math.max(2, slot - 2);
  const range = max - min || 1;

  const yFor = (v: number) => height - Math.max(0, Math.min(1, (v - min) / range)) * (height - 6);

  // Default x-axis label = window in days
  const xText = xLabel ?? `${series.length}D AGO → TODAY`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height + 4}`} style={{ width: '100%', height: height + 4, display: 'block' }}>
        {/* Y-axis range labels */}
        <text x={PAD_L - 4} y={10} fontSize={9} fill="rgba(255,255,255,0.42)" textAnchor="end" fontFamily="var(--f-body)">
          {max}{unit}
        </text>
        <text x={PAD_L - 4} y={height - 1} fontSize={9} fill="rgba(255,255,255,0.42)" textAnchor="end" fontFamily="var(--f-body)">
          {min}{unit}
        </text>

        {/* Subtle horizontal frame top/bottom */}
        <line x1={PAD_L} y1={0.5} x2={W - PAD_R} y2={0.5} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        <line x1={PAD_L} y1={height - 0.5} x2={W - PAD_R} y2={height - 0.5} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

        {/* Baseline dashed line + label */}
        {baseline != null && baseline >= min && baseline <= max && (
          <>
            <line
              x1={PAD_L} y1={yFor(baseline)}
              x2={W - PAD_R} y2={yFor(baseline)}
              stroke="rgba(255,255,255,0.22)" strokeWidth={1} strokeDasharray="3 4"
            />
            <text
              x={W - PAD_R - 2} y={yFor(baseline) - 3}
              fontSize={8.5} fill="rgba(255,255,255,0.5)" textAnchor="end" fontFamily="var(--f-body)" letterSpacing="0.4"
            >
              BASE {baseline}{unit}
            </text>
          </>
        )}

        {/* Bars */}
        {series.map((v, i) => {
          const norm = Math.max(0, Math.min(1, (v - min) / range));
          const h = norm * (height - 6);
          const x = PAD_L + i * slot + 1;
          const y = height - h;
          const isLast = i === series.length - 1;
          // Recent days more solid; today fully opaque.
          const opacity = isLast ? 1 : 0.45 + (i / Math.max(1, series.length - 1)) * 0.4;
          return (
            <rect
              key={i} x={x} y={y} width={barW} height={h}
              fill={color} opacity={opacity} rx={1.5}
            />
          );
        })}
      </svg>

      {/* X-axis label row — left = oldest, right = today */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        paddingLeft: (PAD_L / W) * 100 + '%',
        marginTop: 4,
        fontFamily: 'var(--f-body)', fontSize: 9, letterSpacing: '1.2px',
        color: 'rgba(255,255,255,0.42)',
      }}>
        <span>{xText.split('→')[0]?.trim() ?? ''}</span>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>{xText.split('→')[1]?.trim() ?? ''}</span>
      </div>
    </div>
  );
}
