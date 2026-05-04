'use client';

/**
 * /runs/[id] — single Strava activity detail.
 *
 * Renders the route polyline (decoded inline, no map deps), per-mile
 * splits, best efforts, HR + cadence stats, suffer score, description.
 * Source: /api/strava/activity/[id], which Postgres-caches the detail
 * shape after first fetch.
 */

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Caption, Nav } from '../../../components/nav';
import { formatShort } from '../../../lib/dates';

interface RichActivity {
  id: number;
  name: string;
  type: string;
  startLocal: string;
  date: string;
  distanceMi: number;
  movingTimeS: number;
  paceSPerMi: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  elevGainFt: number;
  workoutType: number | null;
  kudosCount: number;
  achievementCount: number;
  sufferScore: number | null;
  summaryPolyline: string | null;
  description: string | null;
  miles: Array<{ mile: number; paceSPerMi: number; paceDisplay: string; elapsedS: number; avgHr: number | null; elevDeltaFt: number }> | null;
  bestEfforts: Array<{ name: string; elapsedS: number; elapsedDisplay: string; distanceMi: number; isPR: boolean; rank: number | null }> | null;
}

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activity, setActivity] = useState<RichActivity | null | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/strava/activity/${id}`, { cache: 'no-store' });
        const json = await res.json() as { activity: RichActivity | null; error?: string };
        if (cancelled) return;
        if (json.error) setError(json.error);
        setActivity(json.activity);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setActivity(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (activity === 'loading') {
    return <Shell><div className="hint" style={{ padding: 40 }}>Loading run…</div></Shell>;
  }
  if (!activity) {
    return (
      <Shell>
        <div className="page-head">
          <div>
            <h1>Run not found</h1>
            <div className="sub">{error || 'No activity matching that id.'}</div>
          </div>
          <div className="page-actions">
            <Link href="/log" className="btn">← All runs</Link>
          </div>
        </div>
      </Shell>
    );
  }

  const m = Math.floor(activity.paceSPerMi / 60);
  const s = activity.paceSPerMi % 60;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <div className="eyebrow">Strava run · {formatShort(activity.date)}</div>
          <h1 style={{ textTransform: 'uppercase' }}>{activity.name}</h1>
          <div className="sub">
            {activity.distanceMi.toFixed(2)} mi · {fmtT(activity.movingTimeS)} · {m}:{String(s).padStart(2, '0')}/mi
            {activity.workoutType === 1 && <> · <b style={{ color: 'var(--color-attention)' }}>RACE</b></>}
          </div>
        </div>
        <div className="page-actions">
          <Link href="/log" className="btn">← All runs</Link>
          <a href={`https://www.strava.com/activities/${activity.id}`} className="btn btn--primary" target="_blank" rel="noopener noreferrer">↗ Strava</a>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10, marginBottom: 10 }}>
        <RoutePoly polyline={activity.summaryPolyline} />
        <StatsTile activity={activity} />
      </div>

      {activity.bestEfforts && activity.bestEfforts.length > 0 && <BestEffortsTile efforts={activity.bestEfforts} />}
      {activity.miles && activity.miles.length > 0 && <SplitsTable miles={activity.miles} />}
      {activity.description && <DescriptionTile description={activity.description} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Caption left="Runcino · runs" />
      <div className="stage">
        <Nav active="log" />
        <div className="body">
          {children}
        </div>
      </div>
    </>
  );
}

/* ── Route polyline ─────────────────────────────────────────
   Decodes Strava's encoded summary polyline into lat/lon points,
   normalizes them to the SVG viewport, draws as a single <path>.
   No map provider, no API key, no tiles — just the route shape on
   a dark background. Good enough to confirm "yes that's the run." */
function RoutePoly({ polyline }: { polyline: string | null }) {
  if (!polyline) {
    return (
      <div className="tile" style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-t3)' }}>
        No GPS polyline
      </div>
    );
  }
  const points = decodePolyline(polyline);
  if (points.length < 2) {
    return (
      <div className="tile" style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-t3)' }}>
        Polyline too short
      </div>
    );
  }
  const lats = points.map(p => p[0]);
  const lons = points.map(p => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  // Aspect-correct longitudes by latitude (rough Web Mercator stretch).
  const latRange = maxLat - minLat || 1e-6;
  const lonRange = maxLon - minLon || 1e-6;
  const latCos = Math.cos((minLat + maxLat) * Math.PI / 360);
  const W = 600;
  const H = 320;
  const scale = Math.min(W / (lonRange * latCos), H / latRange) * 0.92;
  const cxLon = (minLon + maxLon) / 2;
  const cxLat = (minLat + maxLat) / 2;
  const project = (lat: number, lon: number): [number, number] => [
    W / 2 + (lon - cxLon) * latCos * scale,
    H / 2 - (lat - cxLat) * scale,
  ];
  const projected = points.map(([lat, lon]) => project(lat, lon));
  const path = projected.reduce((acc, [x, y], i) => acc + (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`), '');
  const [sx, sy] = projected[0];
  const [ex, ey] = projected[projected.length - 1];

  return (
    <div className="tile" style={{ padding: 0, overflow: 'hidden', minHeight: 320 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <rect width={W} height={H} fill="var(--color-l1)" />
        <path d={path} stroke="var(--color-attention)" strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx} cy={sy} r={6} fill="var(--color-success)" />
        <circle cx={ex} cy={ey} r={6} fill="var(--color-warning)" />
      </svg>
      <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--color-t3)' }}>
        <span><span style={{ color: 'var(--color-success)' }}>●</span> Start</span>
        <span>Strava polyline</span>
        <span><span style={{ color: 'var(--color-warning)' }}>●</span> Finish</span>
      </div>
    </div>
  );
}

function StatsTile({ activity }: { activity: RichActivity }) {
  const stats = [
    { label: 'Distance', value: `${activity.distanceMi.toFixed(2)} mi` },
    { label: 'Time', value: fmtT(activity.movingTimeS) },
    { label: 'Avg pace', value: `${Math.floor(activity.paceSPerMi / 60)}:${String(activity.paceSPerMi % 60).padStart(2, '0')}/mi` },
    { label: 'Elev gain', value: `${activity.elevGainFt.toLocaleString()} ft` },
    { label: 'Avg HR', value: activity.avgHr ? `${Math.round(activity.avgHr)} bpm` : '—' },
    { label: 'Max HR', value: activity.maxHr ? `${Math.round(activity.maxHr)} bpm` : '—' },
    { label: 'Cadence', value: activity.avgCadence ? `${Math.round(activity.avgCadence * 2)} spm` : '—' },
    { label: 'Suffer', value: activity.sufferScore != null ? String(activity.sufferScore) : '—' },
  ];
  return (
    <div className="tile" style={{ minHeight: 320, padding: 0 }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-l4)' }}>
        <div className="tile-sub">Run stats</div>
        <div className="tile-lbl">From Strava</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 0 }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{
            padding: '14px 18px',
            borderBottom: i < 6 ? '1px solid var(--color-l4)' : 'none',
            borderRight: i % 2 === 0 ? '1px solid var(--color-l4)' : 'none',
          }}>
            <div className="tile-sub" style={{ marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, letterSpacing: '-.01em', color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
          </div>
        ))}
      </div>
      {(activity.kudosCount > 0 || activity.achievementCount > 0) && (
        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--color-l4)', display: 'flex', gap: 14, fontSize: 12, color: 'var(--color-t2)' }}>
          <span>♡ {activity.kudosCount} kudos</span>
          {activity.achievementCount > 0 && <span style={{ color: 'var(--color-attention)' }}>★ {activity.achievementCount} achievement{activity.achievementCount === 1 ? '' : 's'}</span>}
        </div>
      )}
    </div>
  );
}

function BestEffortsTile({ efforts }: { efforts: NonNullable<RichActivity['bestEfforts']> }) {
  return (
    <div className="tile" style={{ marginBottom: 10, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Best efforts</div>
          <div className="tile-lbl">Standard distances clocked during this run</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {efforts.map((b, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: '10px 14px',
            background: b.isPR ? 'rgba(243,173,59,.12)' : 'var(--color-l2)',
            border: `1px solid ${b.isPR ? 'rgba(243,173,59,.3)' : 'var(--color-l4)'}`,
            borderRadius: 8,
            minWidth: 120,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.4px', textTransform: 'uppercase', color: b.isPR ? 'var(--color-attention)' : 'var(--color-t3)', fontWeight: 700 }}>{b.name}</span>
              {b.isPR && <span className="chip chip--attention" style={{ fontSize: 8 }}>PR</span>}
            </div>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: 'var(--color-t0)', letterSpacing: '-.01em' }}>{b.elapsedDisplay}</span>
            {b.rank != null && b.rank > 1 && (
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t3)', fontWeight: 700, letterSpacing: '1.2px' }}>#{b.rank} all-time</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitsTable({ miles }: { miles: NonNullable<RichActivity['miles']> }) {
  return (
    <div className="tile" style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-l4)' }}>
        <div className="tile-sub">Mile splits</div>
        <div className="tile-lbl">From Strava splits_standard</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--color-t3)', fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>
            <th style={{ textAlign: 'left', padding: '12px 18px', width: 80 }}>Mile</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Pace</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Time</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>HR</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Δ Elev</th>
          </tr>
        </thead>
        <tbody>
          {miles.map(m => (
            <tr key={m.mile} style={{ borderTop: '1px solid var(--color-l4)' }}>
              <td style={{ padding: '12px 18px', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t1)', fontWeight: 700 }}>{m.mile}</td>
              <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t0)', fontWeight: 700 }}>{m.paceDisplay}</td>
              <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t1)' }}>{fmtT(m.elapsedS)}</td>
              <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t2)' }}>{m.avgHr ? Math.round(m.avgHr) : '—'}</td>
              <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: m.elevDeltaFt > 0 ? '#f9a87c' : m.elevDeltaFt < 0 ? '#7fd6a1' : 'var(--color-t3)' }}>
                {m.elevDeltaFt > 0 ? '+' : ''}{m.elevDeltaFt}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DescriptionTile({ description }: { description: string }) {
  return (
    <div className="tile" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="tile-sub">Strava description</div>
      <div style={{ fontSize: 13.5, color: 'var(--color-t1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{description}</div>
    </div>
  );
}

function fmtT(s: number): string {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Decode a Google-style encoded polyline into [lat, lon][]. Self-
 *  contained (no deps) — based on the standard reference algorithm
 *  from Strava + Google maps documentation. */
function decodePolyline(str: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let lat = 0, lon = 0;
  let i = 0;
  while (i < str.length) {
    let result = 0, shift = 0, b: number;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    result = 0; shift = 0;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlon = (result & 1) ? ~(result >> 1) : (result >> 1);
    lon += dlon;

    out.push([lat * 1e-5, lon * 1e-5]);
  }
  return out;
}
