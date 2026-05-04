'use client';

/**
 * /health — what Strava can tell us today, plus M2 placeholders for
 * HealthKit. The Strava-driven panel surfaces avg HR + cadence trends
 * and recent suffer-score load. HRV / sleep / RHR stay stub until the
 * iOS app writes a HealthKit JSON to iCloud.
 */

import { useEffect, useState } from 'react';
import { Caption, Nav } from '../../components/nav';
import { useActivities, onlyRuns } from '../../lib/strava-activities';
import { rollupYear, weeklyAvgHr, weeklyAvgCadence, weeklyMiles } from '../../lib/strava-stats';

const HEALTHKIT_METRICS: Array<{ label: string; sub: string; pill: string; }> = [
  { label: 'Resting HR',         sub: 'bpm', pill: 'M2 · HealthKit' },
  { label: 'HRV · 7-day avg',    sub: 'ms',  pill: 'M2 · HealthKit' },
  { label: 'Sleep · 7-day avg',  sub: 'hr',  pill: 'M2 · HealthKit' },
  { label: 'Recovery score',     sub: '/100',pill: 'M2 · derived' },
];

export default function HealthPage() {
  const [now, setNow] = useState<Date | null>(null);
  const { activities } = useActivities();
  useEffect(() => { setNow(new Date()); }, []);

  const runs = activities ? onlyRuns(activities) : null;

  return (
    <>
      <Caption left="Runcino · health" right={`HEALTH · ${now ? now.toISOString().slice(0,10) : ''}`} />
      <div className="stage">
        <Nav active="health" />
        <div className="body">

          <div className="page-head">
            <div>
              <div className="eyebrow">Recovery · resilience · readiness</div>
              <h1>Health</h1>
              <div className="sub">
                {runs && runs.length > 0
                  ? <>Strava is feeding the HR / cadence / load panels below. HealthKit-only metrics light up in M2.</>
                  : <>Connect Strava (and HealthKit in M2) to populate.</>}
              </div>
            </div>
          </div>

          {runs && runs.length > 0 && (
            <>
              <SectionHeader title="Strava signals" sub="Mile-weighted across each week, last 12 weeks" />
              <FromStravaPanel runs={runs} />
            </>
          )}

          <SectionHeader title="HealthKit signals" sub="M2 — populated by the iOS app" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {HEALTHKIT_METRICS.map(m => <MetricCard key={m.label} {...m} />)}
          </div>

        </div>
      </div>
    </>
  );
}

function FromStravaPanel({ runs }: { runs: import('../../lib/strava-activities').NormalizedActivity[] }) {
  const r = rollupYear(runs);
  const hrSeries = weeklyAvgHr(runs, 12).filter(w => w.avgHr != null);
  const cadSeries = weeklyAvgCadence(runs, 12).filter(w => w.avgCadence != null);
  const miSeries = weeklyMiles(runs, 12);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 10 }}>
      <BigStat label="YTD avg HR" value={r.avgHr ? `${r.avgHr}` : '—'} sub="bpm · mile-weighted" trend={hrSeries.length > 1 ? hrSeries[hrSeries.length - 1].avgHr! - hrSeries[0].avgHr! : null} trendUnit="bpm" />
      <TrendCard title="HR trend" series={hrSeries.map(w => ({ x: w.weekStart, y: w.avgHr ?? 0 }))} unit="bpm" />
      <TrendCard title="Cadence" series={cadSeries.map(w => ({ x: w.weekStart, y: w.avgCadence ?? 0 }))} unit="spm" />
      <TrendCard title="Weekly mileage" series={miSeries.map(w => ({ x: w.weekStart, y: w.miles }))} unit="mi" />
    </div>
  );
}

function BigStat({ label, value, sub, trend, trendUnit }: { label: string; value: string; sub: string; trend: number | null; trendUnit: string }) {
  return (
    <div className="tile" style={{ minHeight: 160, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="tile-sub">{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, color: 'var(--color-t0)', letterSpacing: '-.025em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>{sub}</div>
      {trend != null && trend !== 0 && (
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: trend < 0 ? 'var(--color-success)' : 'var(--color-warning)', fontWeight: 700, letterSpacing: '1.2px' }}>
          {trend > 0 ? '+' : ''}{Math.round(trend)} {trendUnit} VS 12W AGO
        </div>
      )}
    </div>
  );
}

function TrendCard({ title, series, unit }: { title: string; series: Array<{ x: string; y: number }>; unit: string }) {
  if (series.length === 0) return <MetricCard label={title} sub={unit} pill="No data" />;
  const ys = series.map(p => p.y);
  const dataMax = Math.max(...ys);
  const dataMin = Math.min(...ys);
  // Pad the y-domain ~5% so the curve never grazes the chart edges,
  // which made the lines feel unanchored and abstract.
  const pad = (dataMax - dataMin) * 0.08 || dataMax * 0.05 || 1;
  const yMax = dataMax + pad;
  const yMin = Math.max(0, dataMin - pad);
  const range = yMax - yMin || 1;
  const median = ys.slice().sort((a, b) => a - b)[Math.floor(ys.length / 2)];

  // Chart geometry — leave room on the left for y-axis tick labels and
  // on the bottom for x-axis date labels, so this reads as a real chart.
  const W = 240;
  const H = 100;
  const padL = 30, padR = 10, padT = 8, padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const points = series.map((p, i) => {
    const x = padL + (i / (series.length - 1 || 1)) * innerW;
    const y = padT + (1 - (p.y - yMin) / range) * innerH;
    return [x, y, p] as const;
  });
  const path = points.reduce((acc, [x, y], i) => acc + (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`), '');
  const medianY = padT + (1 - (median - yMin) / range) * innerH;
  const last = series[series.length - 1];
  const first = series[0];
  const [lastX, lastY] = points[points.length - 1];

  // Format week-start ISO → "Mar 9" for axis ticks.
  const fmtWeek = (iso: string) => {
    const d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };

  return (
    <div className="tile" style={{ minHeight: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="tile-sub">{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 38, color: 'var(--color-t0)', letterSpacing: '-.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(last.y * 10) / 10}<small style={{ fontSize: '.4em', opacity: .55, marginLeft: 4 }}>{unit}</small>
        </div>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, color: 'var(--color-t3)', fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase' }}>
          week of {fmtWeek(last.x)}
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ flex: 1, marginTop: 4 }}>
        {/* Y-axis baseline + median guideline */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="var(--color-l4)" strokeWidth={0.5} />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--color-l4)" strokeWidth={0.5} />
        <line x1={padL} y1={medianY} x2={W - padR} y2={medianY} stroke="var(--color-l4)" strokeWidth={0.4} strokeDasharray="2 3" />

        {/* Y tick labels — top (max) + bottom (min) */}
        <text x={padL - 4} y={padT + 3} fontSize={7} fill="var(--color-t3)" textAnchor="end" fontFamily="var(--font-data)" fontWeight={700} letterSpacing={0.5}>
          {Math.round(dataMax)}
        </text>
        <text x={padL - 4} y={H - padB} fontSize={7} fill="var(--color-t3)" textAnchor="end" fontFamily="var(--font-data)" fontWeight={700} letterSpacing={0.5}>
          {Math.round(dataMin)}
        </text>

        {/* The trend line + every data point as a small dot */}
        <path d={path} stroke="var(--color-corporate)" strokeWidth={1.6} fill="none" strokeLinejoin="round" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={1.4} fill={i === points.length - 1 ? 'var(--color-attention)' : 'var(--color-corporate)'} />
        ))}

        {/* Highlighted latest point — bigger, with a halo */}
        <circle cx={lastX} cy={lastY} r={3.2} fill="var(--color-attention)" />
        <circle cx={lastX} cy={lastY} r={5.5} fill="var(--color-attention)" opacity={0.18} />

        {/* X-axis date ticks at first / mid / last */}
        <text x={padL} y={H - 4} fontSize={7} fill="var(--color-t3)" textAnchor="start" fontFamily="var(--font-data)" fontWeight={700} letterSpacing={0.5}>
          {fmtWeek(first.x)}
        </text>
        {series.length > 5 && (
          <text x={padL + innerW / 2} y={H - 4} fontSize={7} fill="var(--color-t3)" textAnchor="middle" fontFamily="var(--font-data)" fontWeight={700} letterSpacing={0.5}>
            {fmtWeek(series[Math.floor(series.length / 2)].x)}
          </text>
        )}
        <text x={W - padR} y={H - 4} fontSize={7} fill="var(--color-t3)" textAnchor="end" fontFamily="var(--font-data)" fontWeight={700} letterSpacing={0.5}>
          {fmtWeek(last.x)}
        </text>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-data)', fontSize: 9.5, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>
        <span>MIN {Math.round(dataMin * 10) / 10}{unit && ` ${unit.toUpperCase()}`}</span>
        <span>MEDIAN {Math.round(median * 10) / 10}</span>
        <span>MAX {Math.round(dataMax * 10) / 10}</span>
      </div>
    </div>
  );
}

function MetricCard({ label, sub, pill }: { label: string; sub: string; pill: string }) {
  return (
    <div className="tile" style={{
      borderStyle: 'dashed', background: 'transparent',
      display: 'flex', flexDirection: 'column', gap: 10, minHeight: 160,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="tile-sub">{label}</div>
        <span className="chip">{pill}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, color: 'var(--color-t3)', lineHeight: 1, letterSpacing: '-.025em' }}>
        —
        {sub && <small style={{ fontSize: '.3em', opacity: .5, fontWeight: 700, marginLeft: 4 }}>{sub}</small>}
      </div>
      <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>No data</div>
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="section-h">
      <div>
        <div className="tile-sub" style={{ marginBottom: 4 }}>{sub}</div>
        <h2>{title}</h2>
      </div>
    </div>
  );
}
