'use client';

/**
 * /health — honest empty state until HealthKit (M2) lands.
 *
 * iOS reads HealthKit (HRV, sleep, RHR, weekly mileage) → writes a
 * latest-fitness.json to iCloud Drive → web reads it. Until that
 * pipeline exists, every metric here shows "—".
 */

import { useEffect, useState } from 'react';
import { Caption, Nav } from '../../components/nav';

const METRICS: Array<{ label: string; sub: string; pill: string; }> = [
  { label: 'Resting HR',        sub: 'bpm', pill: 'M2 · HealthKit' },
  { label: 'HRV · 7-day avg',   sub: 'ms',  pill: 'M2 · HealthKit' },
  { label: 'Sleep · 7-day avg', sub: 'hr',  pill: 'M2 · HealthKit' },
  { label: 'Weekly mileage',    sub: 'mi',  pill: 'M2 · Strava' },
  { label: 'ACWR (load ratio)', sub: '',    pill: 'M2 · derived' },
  { label: 'Recovery score',    sub: '/100',pill: 'M2 · derived' },
  { label: 'Aerobic decoupling',sub: '%',   pill: 'M2 · derived' },
  { label: 'Cadence',           sub: 'spm', pill: 'M2 · Strava' },
];

export default function HealthPage() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

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
                Auto-populated from your iPhone HealthKit + Strava once those ship in M2. Until then, every metric reads <b>—</b>.
              </div>
            </div>
            <div className="page-actions">
              <button className="btn" disabled>Log symptom</button>
              <button className="btn" disabled>Manual entry</button>
            </div>
          </div>

          <div className="tile" style={{ padding: '36px 32px', borderStyle: 'dashed', background: 'transparent', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 10 }}>
            <span className="chip chip--corporate" style={{ alignSelf: 'flex-start' }}>M2 · HealthKit</span>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 38, textTransform: 'uppercase', letterSpacing: '-.01em', lineHeight: 1 }}>
              Connect HealthKit to populate
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-t2)', maxWidth: 720, lineHeight: 1.55 }}>
              The iOS app reads HRV, sleep, resting HR, and weekly mileage from your phone&apos;s Health data and writes a synced JSON to iCloud Drive. The web reads it on the next page load. No cloud, no third-party server.
            </div>
          </div>

          <SectionHeader title="Metrics" sub="What lights up when M2 ships" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {METRICS.map(m => <MetricCard key={m.label} {...m} />)}
          </div>

        </div>
      </div>
    </>
  );
}

function MetricCard({ label, sub, pill }: { label: string; sub: string; pill: string }) {
  return (
    <div className="tile" style={{
      borderStyle: 'dashed', background: 'transparent',
      display: 'flex', flexDirection: 'column', gap: 12, minHeight: 160,
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
