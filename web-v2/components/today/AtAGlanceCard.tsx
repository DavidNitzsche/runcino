'use client';

/**
 * AtAGlanceCard — the "the why" panel on /today.
 *
 * 2026-05-27 P-AT-A-GLANCE: David picked Direction D from
 * docs/at-a-glance-directions-2026-05-27.html — 2×3 grid of
 * self-contained tiles with status dots (green/amber/red). Each tile
 * shows one signal: big number + label + one-line context + status
 * dot in the corner.
 *
 * Tiles (in render order):
 *   1. SLEEP · 7n      — sleep7Avg vs target (7.5h)
 *   2. HRV             — hrvCurrent vs hrvBaseline
 *   3. RHR             — rhrCurrent vs rhrBaseline
 *   4. LOAD · ACWR     — loadAcwr in Gabbett bands
 *   5. WEEK MI         — weekDone / weekPlanned
 *   6. RACE            — daysToARace + race name (race-orange)
 *
 * Status colors per band:
 *   green  = within target / healthy
 *   amber  = drifting / building / one signal off
 *   red    = real signal (HRV crash, sleep deeply short, ACWR spike)
 *
 * Reads from GlanceState (lib/coach/glance-state.ts). Zero LLM, no API
 * call — server-rendered with the rest of /today in one round trip.
 */
import type { GlanceState } from '@/lib/coach/glance-state';

export function AtAGlanceCard({ glance }: { glance: GlanceState }) {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--line)',
      borderRadius: 18,
      padding: 24,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 16,
      }}>
        <span style={{
          fontFamily: 'var(--f-display)',
          fontSize: 20,
          fontWeight: 900,
          letterSpacing: '-0.005em',
          lineHeight: 1,
        }}>At a glance</span>
        <span style={{
          fontFamily: 'var(--f-sub, Oswald)',
          fontSize: 10,
          letterSpacing: '1.6px',
          color: 'var(--mute)',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}>the why</span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 10,
      }}>
        <SleepTile glance={glance} />
        <HrvTile glance={glance} />
        <RhrTile glance={glance} />
        <LoadTile glance={glance} />
        <WeekTile glance={glance} />
        <RaceTile glance={glance} />
      </div>
    </div>
  );
}

/* ─────────────────────────── TILE ─────────────────────────── */

type Status = 'good' | 'warn' | 'bad' | 'none';

function Tile({
  label, value, meta, status, valueColor, labelColor,
}: {
  label: string;
  value: string;
  meta: React.ReactNode;
  status: Status;
  valueColor?: string;
  labelColor?: string;
}) {
  const dotColor = status === 'good' ? 'var(--green)'
    : status === 'warn' ? 'var(--goal)'
    : status === 'bad' ? 'var(--over)'
    : 'transparent';
  const resolvedValueColor = valueColor ?? (
    status === 'good' ? 'var(--green)'
    : status === 'warn' ? 'var(--goal)'
    : status === 'bad' ? 'var(--over)'
    : 'var(--ink)'
  );
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid rgba(255,255,255,0.04)',
      borderRadius: 12,
      padding: '14px 16px',
      position: 'relative',
    }}>
      {status !== 'none' && (
        <span style={{
          position: 'absolute',
          top: 14,
          right: 14,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dotColor,
        }} />
      )}
      <div style={{
        fontFamily: 'var(--f-sub, Oswald)',
        fontSize: 9,
        letterSpacing: '1.4px',
        color: labelColor ?? 'var(--mute)',
        fontWeight: 700,
        textTransform: 'uppercase',
        marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--f-display)',
        fontSize: 26,
        lineHeight: 1,
        fontWeight: 900,
        letterSpacing: '-0.01em',
        color: resolvedValueColor,
      }}>{value}</div>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontSize: 11,
        color: 'var(--mute)',
        marginTop: 6,
        lineHeight: 1.4,
      }}>{meta}</div>
    </div>
  );
}

/* ─────────────────────────── PER-TILE LOGIC ─────────────────── */

function SleepTile({ glance }: { glance: GlanceState }) {
  const v = glance.sleep7Avg;
  if (v == null) return <Tile label="sleep · 7n" value="—" meta="No data yet" status="none" />;
  // Status: green if ≥7.5, amber if 6.5-7.5, red if <6.5
  const status: Status = v >= 7.5 ? 'good' : v >= 6.5 ? 'warn' : 'bad';
  const deficit = glance.sleep7Deficit;
  const meta = deficit >= 0.5
    ? <>−{deficit.toFixed(1)} vs target.</>
    : <>At target.</>;
  return <Tile label="sleep · 7n" value={`${v.toFixed(1)}h`} meta={meta} status={status} />;
}

function HrvTile({ glance }: { glance: GlanceState }) {
  const v = glance.hrvCurrent;
  const b = glance.hrvBaseline;
  if (v == null) return <Tile label="hrv" value="—" meta="No data yet" status="none" />;
  if (b == null) return <Tile label="hrv" value={`${v}ms`} meta="No baseline yet" status="none" />;
  const delta = v - b;
  // Status: green if within ±3, amber if -4 to -7, red if ≤-8
  const status: Status = delta >= -3 ? 'good' : delta >= -7 ? 'warn' : 'bad';
  const meta = delta >= 0
    ? <>+{delta} vs baseline.</>
    : <>{delta} vs avg.</>;
  return <Tile label="hrv" value={`${v}ms`} meta={meta} status={status} />;
}

function RhrTile({ glance }: { glance: GlanceState }) {
  const v = glance.rhrCurrent;
  const b = glance.rhrBaseline;
  if (v == null) return <Tile label="rhr" value="—" meta="No data yet" status="none" />;
  if (b == null) return <Tile label="rhr" value={String(v)} meta="No baseline yet" status="none" />;
  const delta = v - b;
  // Status: green if within ±3, amber if +4 to +7, red if ≥+8
  const status: Status = delta <= 3 ? 'good' : delta <= 7 ? 'warn' : 'bad';
  const meta = delta === 0
    ? <>Steady at baseline.</>
    : <>{delta > 0 ? '+' : ''}{delta} vs baseline.</>;
  return <Tile label="rhr" value={String(v)} meta={meta} status={status} />;
}

function LoadTile({ glance }: { glance: GlanceState }) {
  const v = glance.loadAcwr;
  if (v == null) return <Tile label="load · acwr" value="—" meta="Building baseline" status="none" />;
  // Gabbett bands: 0.8-1.3 sweet, 1.3-1.5 productive build, ≥1.5 spike, <0.8 under
  const status: Status =
    v >= 1.5 ? 'bad'
    : v >= 1.3 ? 'warn'
    : v >= 0.8 ? 'good'
    : 'warn'; // under-loaded counts as warn (room to add)
  const band = v >= 1.5 ? 'Past spike line.'
    : v >= 1.3 ? 'Build band.'
    : v >= 0.8 ? 'Sweet spot.'
    : 'Under-loaded.';
  return <Tile label="load · acwr" value={v.toFixed(2)} meta={band} status={status} />;
}

function WeekTile({ glance }: { glance: GlanceState }) {
  const done = glance.weekDone;
  const planned = glance.weekPlanned;
  if (planned == null) {
    return <Tile label="week mi" value={`${done.toFixed(1)}`} meta="No plan for the week" status="none" />;
  }
  const delta = done - planned;
  // Status: green if within 3 mi of plan OR ahead, amber if 3-8 under, red if >8 under
  const status: Status = delta >= -3 ? 'good' : delta >= -8 ? 'warn' : 'bad';
  const display = `${done.toFixed(1)} / ${planned.toFixed(1)}`;
  const meta = Math.abs(delta) < 2
    ? <>On pace with plan.</>
    : delta >= 2
      ? <>{delta.toFixed(1)} ahead of plan.</>
      : <>{Math.abs(delta).toFixed(1)} mi still to go.</>;
  return <Tile label="week mi" value={display} meta={meta} status={status} />;
}

function RaceTile({ glance }: { glance: GlanceState }) {
  if (glance.daysToARace == null || glance.nextARaceName == null) {
    return <Tile label="race" value="—" meta="No A-race scheduled" status="none" labelColor="var(--race)" valueColor="var(--mute)" />;
  }
  const d = glance.daysToARace;
  const name = glance.nextARaceName;
  // Race tile doesn't get a status dot — race-orange always for identity.
  return <Tile
    label={`race · ${d}d`}
    value={name.length > 12 ? name.slice(0, 12) : name}
    meta={<>To race day.</>}
    status="none"
    labelColor="var(--race)"
    valueColor="var(--race)"
  />;
}
