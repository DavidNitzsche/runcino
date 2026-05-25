/**
 * HealthBars — daily bar charts for sleep / RHR / HRV / weight.
 * Each bar = one honest data point. No smoothed lines.
 */

interface BarProps {
  series: number[];        // values (one per day)
  min: number; max: number; // domain
  color: string;
  baselineFraction?: number; // 0..1 — where to draw a dashed line, or undefined
  height?: number;
}

export function BarChart({ series, min, max, color, baselineFraction, height = 54 }: BarProps) {
  if (series.length === 0) {
    return <div style={{ height, color: 'var(--mute)', fontSize: 11, fontStyle: 'italic' }}>(no data)</div>;
  }
  const W = 300;
  const slot = W / Math.max(series.length, 1);
  const barW = Math.max(2, slot - 2);
  const range = max - min || 1;
  return (
    <svg viewBox={`0 0 ${W} ${height + 4}`} style={{ width: '100%', height: height + 4 }}>
      {baselineFraction != null && (
        <line
          x1={0} y1={height - baselineFraction * (height - 6)}
          x2={W} y2={height - baselineFraction * (height - 6)}
          stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="3 4"
        />
      )}
      {series.map((v, i) => {
        const norm = Math.max(0, Math.min(1, (v - min) / range));
        const h = norm * (height - 6);
        const x = i * slot + 1;
        const y = height - h;
        // Mild opacity ramp — recent days more solid
        const opacity = 0.55 + (i / Math.max(1, series.length - 1)) * 0.45;
        return (
          <rect key={i} x={x} y={y} width={barW} height={h} fill={color} opacity={opacity} rx={1.5} />
        );
      })}
    </svg>
  );
}
