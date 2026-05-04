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
  const max = Math.max(...ys);
  const min = Math.min(...ys);
  const range = max - min || 1;
  const W = 200, H = 60;
  const points = series.map((p, i) => {
    const x = (i / (series.length - 1 || 1)) * W;
    const y = H - ((p.y - min) / range) * H;
    return [x, y] as const;
  });
  const path = points.reduce((acc, [x, y], i) => acc + (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`), '');
  const last = series[series.length - 1].y;
  return (
    <div className="tile" style={{ minHeight: 160, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="tile-sub">{title}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 38, color: 'var(--color-t0)', letterSpacing: '-.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(last * 10) / 10}<small style={{ fontSize: '.4em', opacity: .55, marginLeft: 4 }}>{unit}</small>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ flex: 1, marginTop: 4 }}>
        <path d={path} stroke="var(--color-corporate)" strokeWidth={2} fill="none" strokeLinejoin="round" />
        {points.map(([x, y], i) => i === points.length - 1 && <circle key={i} cx={x} cy={y} r={3} fill="var(--color-attention)" />)}
      </svg>
      <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>Last 12 weeks</div>
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
