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
import { HubProvider, useHub } from '../../lib/hub-provider';
import { ReadinessBanner } from '../../components/coaching/ReadinessBanner';

const HEALTHKIT_METRICS: Array<{ label: string; sub: string; pill: string; }> = [
  { label: 'Resting HR',         sub: 'bpm', pill: 'M2 · HealthKit' },
  { label: 'HRV · 7-day avg',    sub: 'ms',  pill: 'M2 · HealthKit' },
  { label: 'Sleep · 7-day avg',  sub: 'hr',  pill: 'M2 · HealthKit' },
  { label: 'Recovery score',     sub: '/100',pill: 'M2 · derived' },
];

export default function HealthPage() {
  return (
    <HubProvider>
      <HealthInner />
    </HubProvider>
  );
}

function HealthInner() {
  const [now, setNow] = useState<Date | null>(null);
  const { activities } = useActivities();
  const hub = useHub();
  useEffect(() => { setNow(new Date()); }, []);

  const runs = activities ? onlyRuns(activities) : null;
  const readiness = hub?.coach.coach?.readiness?.answer ?? null;
  const rpe = hub?.coach.state?.rpe ?? null;
  const recoveryWindowEndsISO = hub?.coach.state?.recoveryWindowEndsISO ?? null;

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
                  ? <>Today&apos;s readiness verdict + the signals driving it. Strava + RPE inputs feed the panels; HealthKit metrics light up in M2.</>
                  : <>Connect Strava (and HealthKit in M2) to populate.</>}
              </div>
            </div>
          </div>

          {/* Recovery score — composite 0-100 from all the inputs we have */}
          <SectionHeader title="Recovery score" sub="Composite from training load + perceived effort + race recovery state" />
          <RecoveryScoreCard
            acwr={readiness?.acwr ?? null}
            easyShare={readiness?.easyShare ?? null}
            rpeAvg7d={rpe?.avg7d ?? null}
            rpeDrift={rpe?.drift ?? null}
            rpeRecentHeavy={rpe?.recentHeavy ?? false}
            inRecoveryWindow={!!recoveryWindowEndsISO}
            daysSinceLastRun={hub?.coach.state?.recovery?.daysSinceLastRun ?? null}
          />

          {/* Today's recovery picture — composite from the engine + RPE */}
          <SectionHeader title="Today's recovery picture" sub="Verdict + the signals driving it" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
            {readiness && <ReadinessBanner readiness={readiness} />}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {readiness?.acwr != null && (
                <RecoveryStat
                  label="ACWR"
                  value={readiness.acwr.toFixed(2)}
                  sub="Acute:chronic load ratio"
                  status={readiness.acwr > 1.5 || readiness.acwr < 0.5 ? 'bad' : (readiness.acwr > 1.3 || readiness.acwr < 0.7) ? 'warn' : 'ok'}
                  citation="Research/00b §load"
                />
              )}
              {readiness?.easyShare != null && (
                <RecoveryStat
                  label="Easy share · 14d"
                  value={`${Math.round(readiness.easyShare * 100)}%`}
                  sub="Polarized target ≥80%"
                  status={readiness.easyShare >= 0.78 ? 'ok' : readiness.easyShare >= 0.65 ? 'warn' : 'bad'}
                  citation="Research/00a §3.1"
                />
              )}
              {rpe?.avg7d != null && (
                <RecoveryStat
                  label="Avg RPE · 7d"
                  value={rpe.avg7d.toFixed(1)}
                  sub={rpe.drift != null ? `Drift ${rpe.drift >= 0 ? '+' : ''}${rpe.drift.toFixed(1)} vs prior 7d` : 'Self-reported effort'}
                  status={rpe.drift != null && rpe.drift >= 1.5 ? 'bad' : rpe.drift != null && rpe.drift >= 1 ? 'warn' : 'ok'}
                  citation="Research/00b §RPE"
                />
              )}
              <RecoveryStat
                label="In recovery window?"
                value={recoveryWindowEndsISO ? 'Yes' : 'No'}
                sub={recoveryWindowEndsISO ? `Until ${recoveryWindowEndsISO}` : 'Standard training day'}
                status={recoveryWindowEndsISO ? 'warn' : 'ok'}
                citation="Research/00b §post-race"
              />
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

/* ── Recovery score ──────────────────────────────────────────
   Composite 0-100 score derived from the signals we have without
   HealthKit:
     - ACWR (acute:chronic load ratio)
     - Easy share 14d (polarized adherence)
     - RPE drift (perceived effort 7d vs prior 7d)
     - Recent heavy RPE flag
     - Race-recovery window active
     - Days-since-last-run extremes

   Score band:
     90+: Push freely · ramp risk low
     75-89: Standard training · normal stress
     60-74: Multiple yellows · pull intensity back
     45-59: Significant fatigue · plan a cutback
     <45: Cut hard · 3-5 easy days

   Floor at 30 — sub-30 catastrophic numbers don't help anybody. */
function RecoveryScoreCard({ acwr, easyShare, rpeAvg7d, rpeDrift, rpeRecentHeavy, inRecoveryWindow, daysSinceLastRun }: {
  acwr: number | null;
  easyShare: number | null;
  rpeAvg7d: number | null;
  rpeDrift: number | null;
  rpeRecentHeavy: boolean;
  inRecoveryWindow: boolean;
  daysSinceLastRun: number | null;
}) {
  const factors: Array<{ label: string; cost: number; reason: string }> = [];
  let score = 100;

  // ACWR cost
  if (acwr != null) {
    if (acwr > 1.5 || acwr < 0.5) {
      factors.push({ label: 'ACWR out of band', cost: 15, reason: `Last 7 days ${Math.round(acwr * 100)}% of usual — a real load shock.` });
      score -= 15;
    } else if (acwr > 1.3 || acwr < 0.7) {
      factors.push({ label: 'ACWR running hot/cold', cost: 8, reason: `${acwr.toFixed(2)} — outside the 0.7-1.3 comfort band.` });
      score -= 8;
    }
  }

  // Easy share cost
  if (easyShare != null) {
    if (easyShare < 0.65) {
      factors.push({ label: 'Easy share low', cost: 12, reason: `${Math.round(easyShare * 100)}% easy in last 14d — too much hard, not enough easy.` });
      score -= 12;
    } else if (easyShare < 0.78) {
      factors.push({ label: 'Easy share marginal', cost: 5, reason: `${Math.round(easyShare * 100)}% easy in last 14d — a little under polarized target.` });
      score -= 5;
    }
  }

  // RPE drift cost
  if (rpeDrift != null) {
    if (rpeDrift >= 1.5) {
      factors.push({ label: 'Perceived effort drifting up', cost: 10, reason: `Same prescriptions feeling +${rpeDrift.toFixed(1)} harder than prior week.` });
      score -= 10;
    } else if (rpeDrift >= 1.0) {
      factors.push({ label: 'Mild perceived-effort drift', cost: 5, reason: `+${rpeDrift.toFixed(1)} vs prior week — watch for accumulation.` });
      score -= 5;
    }
  }

  // Recent heavy
  if (rpeRecentHeavy && !inRecoveryWindow) {
    factors.push({ label: 'Recent session(s) felt heavy', cost: 8, reason: 'Last 3 days had RPE 8+. If those weren\'t scheduled hard sessions, the body\'s telling you something.' });
    score -= 8;
  }

  // Days since last run extremes
  if (daysSinceLastRun != null) {
    if (daysSinceLastRun >= 7) {
      factors.push({ label: 'Long break', cost: 12, reason: `${daysSinceLastRun} days since last run — fitness erosion starts at ~7d.` });
      score -= 12;
    } else if (daysSinceLastRun >= 4) {
      factors.push({ label: 'Missed runs', cost: 5, reason: `${daysSinceLastRun} days since last run.` });
      score -= 5;
    }
  }

  // In recovery window — neutral, not a cost. Surface as a context note.
  const inRecoveryNote = inRecoveryWindow
    ? 'Race-recovery window active — the volume drops are intentional, not training failure.'
    : null;

  // Floor at 30, cap at 100.
  score = Math.max(30, Math.min(100, Math.round(score)));

  const band = score >= 90 ? { label: 'PUSH FREELY', color: 'var(--color-success)', detail: 'Recovery in great shape — green light for the day\'s plan.' }
             : score >= 75 ? { label: 'STANDARD', color: 'var(--color-success)', detail: 'Normal training stress, no flags. Trust the day\'s plan.' }
             : score >= 60 ? { label: 'EASE INTENSITY', color: 'var(--color-attention)', detail: 'Multiple yellows. Hold the easy days honestly; defer next quality 24-48h.' }
             : score >= 45 ? { label: 'CUTBACK', color: 'var(--color-attention)', detail: 'Significant fatigue. Plan a 3-5 day cutback (50% volume, no quality).' }
             : { label: 'CUT HARD', color: 'var(--color-warning)', detail: 'Body is asking for rest. 3-5 fully easy days minimum; revisit when signals reset.' };

  return (
    <div className="tile" style={{
      marginBottom: 18, padding: '24px 28px',
      borderLeft: `3px solid ${band.color}`,
      display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 24, alignItems: 'flex-start',
    }}>
      {/* Score number + band */}
      <div style={{ textAlign: 'center', minWidth: 140 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 96,
          letterSpacing: '-.04em', lineHeight: 1, color: band.color,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {score}
        </div>
        <div style={{
          fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 800, letterSpacing: '1.6px',
          color: band.color, marginTop: 6,
        }}>
          {band.label}
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-t3)', marginTop: 6 }}>out of 100</div>
      </div>

      {/* Detail + factor list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--color-t0)', lineHeight: 1.4 }}>
          {band.detail}
        </div>
        {inRecoveryNote && (
          <div style={{ fontSize: 12, color: 'var(--color-corporate)', lineHeight: 1.5, fontStyle: 'italic' }}>
            {inRecoveryNote}
          </div>
        )}

        {factors.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)', textTransform: 'uppercase' }}>
              Why this score · what's costing you
            </div>
            {factors.map((f, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'baseline',
                padding: '8px 12px', background: 'var(--color-l2)', borderRadius: 4,
                fontSize: 12, color: 'var(--color-t1)',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--color-t0)' }}>{f.label}</span>
                <span style={{ color: 'var(--color-t2)', lineHeight: 1.45 }}>{f.reason}</span>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, color: 'var(--color-warning)' }}>−{f.cost}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--color-t3)', fontStyle: 'italic' }}>
            No detected stress signals — the score reflects current best evidence.
          </div>
        )}

        <div style={{ marginTop: 8, fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-corporate)' }}>
          INPUTS · ACWR + EASY-SHARE + RPE DRIFT + RECOVERY WINDOW + LAST-RUN GAP
        </div>
      </div>
    </div>
  );
}

function RecoveryStat({ label, value, sub, status, citation }: {
  label: string;
  value: string;
  sub: string;
  status: 'ok' | 'warn' | 'bad';
  citation: string;
}) {
  const color = status === 'ok' ? 'var(--color-success)' : status === 'warn' ? 'var(--color-attention)' : 'var(--color-warning)';
  return (
    <div className="tile" style={{ borderLeft: `3px solid ${color}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32, color: 'var(--color-t0)', letterSpacing: '-.025em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-t2)', lineHeight: 1.4 }}>{sub}</div>
      <div style={{ marginTop: 'auto', fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-corporate)' }}>
        {citation}
      </div>
    </div>
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
