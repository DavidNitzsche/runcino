'use client';

/**
 * /runs/[id], single Strava activity detail.
 *
 * Renders the route polyline (decoded inline, no map deps), per-mile
 * splits, best efforts, HR + cadence stats, suffer score, description.
 * Source: /api/strava/activity/[id], which Postgres-caches the detail
 * shape after first fetch.
 */

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Caption } from '../../../components/nav';
import { Topbar } from '../../components/Topbar';
import { TopbarClock } from '../../components/TopbarClock';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { formatShort } from '../../../lib/dates';
import { recommendShoe, inferRunType, type Shoe } from '../../../lib/shoe-utils';

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

interface RunDynamics {
  cadence: number | null;
  stride_length: number | null;
  vertical_oscillation: number | null;
  ground_contact_time: number | null;
  vertical_ratio: number | null;
  run_power: number | null;
}

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activity, setActivity] = useState<RichActivity | null | 'loading'>('loading');
  const [error, setError]       = useState<string | null>(null);
  const [shoes, setShoes]       = useState<Shoe[]>([]);
  const [shoeId, setShoeId]     = useState<number | null>(null);
  const [dynamics, setDynamics] = useState<RunDynamics | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [actRes, shoeRes, assignRes] = await Promise.all([
          fetch(`/api/strava/activity/${id}`, { cache: 'no-store' }),
          fetch('/api/shoes'),
          fetch(`/api/strava/activity/${id}/shoe`),
        ]);
        const [actJson, shoeJson, assignJson] = await Promise.all([
          actRes.json() as Promise<{ activity: RichActivity | null; error?: string }>,
          shoeRes.json() as Promise<{ shoes: Shoe[] }>,
          assignRes.json() as Promise<{ shoe_id: number | null }>,
        ]);
        if (cancelled) return;
        if (actJson.error) setError(actJson.error);
        setActivity(actJson.activity);
        setShoes(shoeJson.shoes ?? []);
        setShoeId(assignJson.shoe_id ?? null);
        // Per-run running form from Apple Health (the day's dynamics).
        if (actJson.activity?.date) {
          fetch(`/api/health/run-dynamics?date=${actJson.activity.date}`)
            .then((r) => r.json() as Promise<{ dynamics?: RunDynamics }>)
            .then((d) => { if (!cancelled && d.dynamics) setDynamics(d.dynamics); })
            .catch(() => {});
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setActivity(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  async function assignShoe(newShoeId: number | null) {
    setShoeId(newShoeId);
    await fetch(`/api/strava/activity/${id}/shoe`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shoe_id: newShoeId }),
    });
    // Refresh shoe list for updated mileage
    const r = await fetch('/api/shoes');
    const d = await r.json() as { shoes: Shoe[] };
    setShoes(d.shoes ?? []);
  }

  if (activity === 'loading') {
    return (
      <Shell>
        <div className="greet">
          <div className="greet-id">
            <Skeleton width={200} height={11} style={{ marginBottom: 8 }} />
            <Skeleton width={320} height={36} />
          </div>
          <div className="greet-state">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="greet-tile">
                <Skeleton width={56} height={9} style={{ marginBottom: 8 }} />
                <Skeleton width={90} height={22} />
              </div>
            ))}
          </div>
        </div>
        <div className="row" style={{ gridTemplateColumns: 'repeat(12, 1fr)' }}>
          <div className="card" style={{ gridColumn: 'span 12' }}>
            <Skeleton height={280} />
          </div>
        </div>
      </Shell>
    );
  }
  if (!activity) {
    return (
      <Shell>
        <div className="row" style={{ gridTemplateColumns: 'repeat(12, 1fr)' }}>
          <div className="card" style={{ gridColumn: 'span 12' }}>
            <EmptyState
              variant="error"
              title="Run not found"
              body={error || 'No Strava activity matching that id. It may have been deleted.'}
              cta={
                <Link href="/log" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                  ← BACK TO LOG
                </Link>
              }
            />
          </div>
        </div>
      </Shell>
    );
  }

  const pacePerMi = `${Math.floor(activity.paceSPerMi / 60)}:${String(activity.paceSPerMi % 60).padStart(2, '0')}`;
  const isRace = activity.workoutType === 1;

  return (
    <Shell>
      <RunHero activity={activity} pacePerMi={pacePerMi} isRace={isRace} />

      <div className="row" style={{ gridTemplateColumns: 'repeat(12, 1fr)', marginBottom: 10 }}>
        <div className="card" style={{ gridColumn: 'span 7', padding: 0, overflow: 'hidden' }}>
          <RoutePoly polyline={activity.summaryPolyline} />
        </div>
        <div className="card" style={{ gridColumn: 'span 5' }}>
          <DescriptionOrMeta activity={activity} />
        </div>
      </div>

      <RunningFormTile dynamics={dynamics} avgCadence={activity.avgCadence} />

      <ShoeTile
        shoes={shoes}
        shoeId={shoeId}
        runType={inferRunType(activity.workoutType, activity.name)}
        onAssign={assignShoe}
      />
      {activity.bestEfforts && activity.bestEfforts.length > 0 && <BestEffortsTile efforts={activity.bestEfforts} />}
      {activity.miles && activity.miles.length > 0 && <SplitsTable miles={activity.miles} />}
    </Shell>
  );
}

/** Canonical hero matching _template-detail-2026-05-09.html, eyebrow + h1 left,
 *  5 KPI tiles right (Distance / Time / Pace / HR / Elev). */
function RunHero({ activity, pacePerMi, isRace }: { activity: RichActivity; pacePerMi: string; isRace: boolean }) {
  return (
    <div className="greet">
      <div className="greet-id">
        <div className="hi">
          STRAVA RUN · {formatShort(activity.date)}
          {isRace && <> · <span style={{ color: 'var(--race)' }}>RACE</span></>}
        </div>
        <h1>{activity.name}</h1>
      </div>
      <div className="greet-state">
        <KpiTile label="DISTANCE" value={activity.distanceMi.toFixed(1)} unit="MI" />
        <KpiTile label="TIME" value={fmtT(activity.movingTimeS)} />
        <KpiTile
          label="AVG PACE"
          value={pacePerMi}
          unit="/MI"
          variant={isRace ? 'race' : 'good'}
        />
        <KpiTile
          label="AVG HR"
          value={activity.avgHr ? String(Math.round(activity.avgHr)) : '-'}
          unit={activity.avgHr ? 'BPM' : undefined}
        />
        <KpiTile
          label="CADENCE"
          value={activity.avgCadence ? String(Math.round(activity.avgCadence)) : '-'}
          unit={activity.avgCadence ? 'SPM' : undefined}
        />
        <KpiTile
          label="ELEV"
          value={activity.elevGainFt.toLocaleString()}
          unit="FT"
        />
      </div>
    </div>
  );
}

function KpiTile({ label, value, unit, variant }: { label: string; value: string; unit?: string; variant?: 'race' | 'good' | 'amber' | 'coach' }) {
  return (
    <div className={`greet-tile${variant ? ` ${variant}` : ''}`}>
      <div className="l">{label}</div>
      <div className="v">
        {value}
        {unit && <small>{unit}</small>}
      </div>
    </div>
  );
}

function DescriptionOrMeta({ activity }: { activity: RichActivity }) {
  return (
    <>
      <div className="card-h">
        <div className="card-l">{activity.description ? 'DESCRIPTION' : 'METADATA'}</div>
        {(activity.kudosCount > 0 || activity.achievementCount > 0) && (
          <span className="card-pin">
            {activity.kudosCount > 0 && <>♡ {activity.kudosCount}</>}
            {activity.achievementCount > 0 && <> · ★ {activity.achievementCount}</>}
          </span>
        )}
      </div>
      {activity.description ? (
        <div className="t-body" style={{ whiteSpace: 'pre-wrap', color: 'var(--t1)' }}>
          {activity.description}
        </div>
      ) : (
        <div className="t-body" style={{ color: 'var(--t2)', fontStyle: 'italic' }}>
          No description on this run.
        </div>
      )}
      <div style={{
        marginTop: 'auto', display: 'flex', gap: 12, paddingTop: 14,
        borderTop: '1px solid var(--l4)',
      }}>
        <a
          href={`https://www.strava.com/activities/${activity.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{ textDecoration: 'none' }}
        >↗ View on Strava</a>
        {activity.maxHr && (
          <div style={{
            display: 'flex', alignItems: 'center',
            fontFamily: 'var(--f-data)', fontSize: 11, color: 'var(--t3)',
            letterSpacing: '.06em', fontWeight: 600,
          }}>MAX HR · {Math.round(activity.maxHr)} BPM</div>
        )}
      </div>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Caption left="faff.run · runs" />
      <div className="stage">
        <Topbar activeTab="log" clock={<TopbarClock />} />
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
   No map provider, no API key, no tiles, just the route shape on
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
              <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t2)' }}>{m.avgHr ? Math.round(m.avgHr) : '-'}</td>
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

/** Per-run running form from Apple Health (the run's day dynamics) + the
 *  Strava cadence. Renders only when at least one metric is present. */
function RunningFormTile({ dynamics, avgCadence }: { dynamics: RunDynamics | null; avgCadence: number | null }) {
  const cadence = avgCadence ?? dynamics?.cadence ?? null;
  const cells: Array<{ label: string; value: string; unit: string }> = [
    { label: 'Cadence',      value: cadence != null ? String(Math.round(cadence)) : '-', unit: cadence != null ? 'spm' : '' },
    { label: 'Stride',       value: dynamics?.stride_length != null ? dynamics.stride_length.toFixed(2) : '-', unit: dynamics?.stride_length != null ? 'm' : '' },
    { label: 'Vert Osc',     value: dynamics?.vertical_oscillation != null ? dynamics.vertical_oscillation.toFixed(1) : '-', unit: dynamics?.vertical_oscillation != null ? 'cm' : '' },
    { label: 'Grnd Contact', value: dynamics?.ground_contact_time != null ? String(Math.round(dynamics.ground_contact_time)) : '-', unit: dynamics?.ground_contact_time != null ? 'ms' : '' },
    { label: 'Vert Ratio',   value: dynamics?.vertical_ratio != null ? dynamics.vertical_ratio.toFixed(1) : '-', unit: dynamics?.vertical_ratio != null ? '%' : '' },
    { label: 'Run Power',    value: dynamics?.run_power != null ? String(Math.round(dynamics.run_power)) : '-', unit: dynamics?.run_power != null ? 'W' : '' },
  ];
  const hasAny = cells.some((c) => c.value !== ', ');
  if (!hasAny) return null;

  return (
    <div className="tile" style={{ marginBottom: 10, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Running form</div>
          <div className="tile-lbl">Dynamics from Apple Health for this run</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 10 }}>
        {cells.map((c) => (
          <div key={c.label} style={{
            display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px',
            background: 'var(--color-l2)', border: '1px solid var(--color-l4)', borderRadius: 8,
          }}>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--color-t3)', fontWeight: 700 }}>{c.label}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: c.value === ', ' ? 'var(--color-t3)' : 'var(--color-t0)', letterSpacing: '-.01em' }}>
              {c.value}{c.unit && <small style={{ fontSize: 11, color: 'var(--color-t3)', marginLeft: 2 }}>{c.unit}</small>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShoeTile({ shoes, shoeId, runType, onAssign }: {
  shoes: Shoe[];
  shoeId: number | null;
  runType: ReturnType<typeof inferRunType>;
  onAssign: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const assigned  = shoes.find(s => s.id === shoeId) ?? null;
  const suggested = recommendShoe(shoes, runType);
  const active    = shoes.filter(s => !s.retired);

  return (
    <div className="tile" style={{ marginBottom: 10, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="tile-sub">Shoe</div>
          {assigned
            ? <div className="tile-lbl" style={{ fontSize: 18 }}>{assigned.brand} {assigned.model}</div>
            : suggested
              ? <div style={{ fontSize: 15, color: 'var(--color-t2)' }}>
                  Suggested: <b style={{ color: 'var(--color-t0)' }}>{suggested.brand} {suggested.model}</b>
                </div>
              : <div style={{ fontSize: 15, color: 'var(--color-t3)' }}>No shoe assigned</div>
          }
          {assigned?.color && (
            <div style={{ fontSize: 12, color: 'var(--color-t3)', marginTop: 2 }}>{assigned.color}</div>
          )}
        </div>
        <button className="btn btn--ghost" style={{ fontSize: 12, padding: '7px 14px' }} onClick={() => setOpen(o => !o)}>
          {open ? 'Close' : assigned ? 'Change' : 'Assign'}
        </button>
      </div>

      {!assigned && suggested && !open && (
        <button
          className="btn btn--primary"
          style={{ alignSelf: 'flex-start', fontSize: 12, padding: '7px 14px' }}
          onClick={() => onAssign(suggested.id)}
        >
          Confirm: {suggested.model}
        </button>
      )}

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--color-l4)', paddingTop: 12 }}>
          {active.map(s => (
            <button key={s.id} onClick={() => { onAssign(s.id); setOpen(false); }} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', borderRadius: 8,
              background: s.id === shoeId ? 'rgba(243,173,59,.1)' : 'var(--color-l2)',
              border: `1px solid ${s.id === shoeId ? 'var(--color-attention)' : 'var(--color-l4)'}`,
              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-t0)' }}>{s.brand} {s.model}</div>
                <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 2 }}>
                  {s.run_types.join(' · ')} · {s.mileage.toFixed(0)} mi
                </div>
              </div>
              {s.id === shoeId && <span style={{ color: 'var(--color-attention)', fontSize: 16 }}>✓</span>}
              {s.id !== shoeId && suggested?.id === s.id && (
                <span className="chip chip--attention" style={{ fontSize: 9 }}>suggested</span>
              )}
            </button>
          ))}
          {shoeId && (
            <button onClick={() => { onAssign(null); setOpen(false); }} style={{
              padding: '8px 14px', borderRadius: 8, background: 'transparent',
              border: '1px solid var(--color-l4)', color: 'var(--color-t3)',
              fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}>
              Remove shoe
            </button>
          )}
        </div>
      )}
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
 *  contained (no deps), based on the standard reference algorithm
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
