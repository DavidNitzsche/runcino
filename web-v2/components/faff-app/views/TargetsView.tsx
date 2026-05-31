'use client';

import type { FaffSeed } from '../types';

export function TargetsView({
  seed, onOpenRace,
}: { seed: FaffSeed; onOpenRace: (slug: string) => void; onOpenReach?: () => void }) {
  const goal = seed.goalRace;
  // The "Coach spotted something" banner stays hidden until the coach
  // engine actually emits a within-reach signal (no such surface yet).
  // When that ships, accept a `coachInsight` prop and render the banner
  // conditionally on its presence.
  return (
    <>
      <div className="top">
        <div>
          <div className="date">Targets</div>
          <div className="wk">Goals &amp; races</div>
        </div>
      </div>

      <div className="goalhero">
        <div className="ghleft">
          <div className="ghk">PRIMARY GOAL</div>
          <div className="ghtitle">{goal ? `SUB${'−'}${goal.goal}` : 'NO GOAL'}</div>
          <div className="ghsub">{goal ? `${goal.name}${goal.location ? ' · ' + goal.location : ''} · ${formatDate(goal.date)}` : 'Set a primary race to start tracking your gap'}</div>
          <div className="ghcd">
            <b>{goal?.daysAway ?? '·'}</b> days out · <span className={goal?.onTrack ? 'ok2' : ''}>{goal ? (goal.onTrack ? `on track · ${goal.delta}` : goal.delta) : '·'}</span>
          </div>
        </div>
        <div className="ghgauge">
          <svg viewBox="0 -14 300 176" width="220" style={{ height: 'auto' }}>
            <defs>
              <linearGradient id="gz2" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#FC4D64"/>
                <stop offset=".4" stopColor="#F3AD38"/>
                <stop offset=".6" stopColor="#3EBD41"/>
                <stop offset="1" stopColor="#3EBD41"/>
              </linearGradient>
            </defs>
            <path d="M30,150 A120,120 0 0 1 270,150" fill="none" stroke="url(#gz2)" strokeWidth="15" strokeLinecap="round"/>
            <line x1="166.9" y1="43.3" x2="170.6" y2="19.6" stroke="#fff" strokeWidth="3" />
            <text x="172.5" y="7.8" fill="#fff" fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="Inter">GOAL</text>
            <line x1="140.6" y1="162.9" x2="207.6" y2="70.7" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
            <circle cx="150" cy="150" r="9" fill="#fff" />
            <circle cx="150" cy="150" r="4" fill="#10131A" />
          </svg>
          <div className="gapval center">
            <div className="grbig">{goal?.projected ?? '·'}</div>
            <div className="grstat">PROJECTED</div>
          </div>
        </div>
      </div>

      {seed.projectionTrend.length >= 2 && goal ? (
        <ProjectionTrend
          series={seed.projectionTrend}
          goalSec={parseClockToSec(goal.goal)}
          projectedLabel={goal.projected}
          daysAway={goal.daysAway}
        />
      ) : null}

      <div className="fll" style={{ marginTop: 30 }}>PERSONAL RECORDS</div>
      <div className="prgrid">
        {seed.prs.map(p => (
          <div className="prt" key={p.k}>
            <div className="prd">{p.k}</div>
            <div className="prv">{p.v}</div>
            <div className="prm">{p.date}</div>
          </div>
        ))}
      </div>

      <div className="fll" style={{ marginTop: 30 }}>RACES</div>
      <div className="races">
        {seed.races.map((r, i) => (
          <div
            className="rcr"
            key={r.slug + i}
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenRace(r.slug)}
            role="button"
            tabIndex={0}
          >
            <div className="rcn">{r.name}<span className="rcm">{r.meta}</span></div>
            <span className={`rctag ${r.tag === 'GOAL' ? 'rc-goal' : ''}`}>{r.tag}</span>
            <span className="rcd">{r.days}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

function parseClockToSec(s: string): number | null {
  if (!s || s === '·') return null;
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function formatHMS(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/**
 * ProjectionTrend — sparkline of the runner's projected finish time at the
 * goal race's distance, from projection_snapshots (90 days). Goal line
 * drawn across when goalSec is known. Older snapshots fade out at the left.
 */
function ProjectionTrend({
  series, goalSec, projectedLabel, daysAway,
}: {
  series: Array<{ date: string; projectionSec: number | null; vdot: number | null }>;
  goalSec: number | null;
  projectedLabel: string;
  daysAway: number;
}) {
  const pts = series.filter(s => s.projectionSec != null) as Array<{ date: string; projectionSec: number; vdot: number | null }>;
  if (pts.length < 2) return null;

  const W = 720;
  const H = 160;
  const PAD_X = 16;
  const PAD_Y = 18;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const secs = pts.map(p => p.projectionSec);
  const minSec = Math.min(...secs, goalSec ?? Infinity);
  const maxSec = Math.max(...secs, goalSec ?? -Infinity);
  // Pad domain so the line never sits on the edge.
  const span = Math.max(30, maxSec - minSec);
  const lo = minSec - span * 0.1;
  const hi = maxSec + span * 0.1;
  const yFor = (sec: number) => PAD_Y + innerH - ((sec - lo) / (hi - lo)) * innerH;
  const xFor = (i: number) => PAD_X + (innerW * i) / (pts.length - 1);

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p.projectionSec).toFixed(1)}`).join(' ');
  const area = `${path} L${xFor(pts.length - 1).toFixed(1)},${(H - PAD_Y).toFixed(1)} L${xFor(0).toFixed(1)},${(H - PAD_Y).toFixed(1)} Z`;
  const goalY = goalSec != null ? yFor(goalSec) : null;

  const last = pts[pts.length - 1];
  const first = pts[0];
  const deltaSec = first.projectionSec - last.projectionSec; // positive = faster (lower sec)
  const trendLabel = Math.abs(deltaSec) < 5 ? 'steady' : deltaSec > 0 ? `${formatHMS(deltaSec)} faster over ${pts.length} days` : `${formatHMS(-deltaSec)} slower over ${pts.length} days`;
  const trendColor = Math.abs(deltaSec) < 5 ? 'var(--text-mid)' : deltaSec > 0 ? '#3EBD41' : '#FC4D64';

  return (
    <div style={{ marginTop: 30 }}>
      <div className="fll">PROJECTION TREND</div>
      <div style={{
        marginTop: 12,
        padding: '18px 18px 14px',
        background: 'var(--surface-1, #161A22)',
        border: '1px solid var(--border-low, #222630)',
        borderRadius: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-mid, #8B95A7)', fontWeight: 600 }}>NOW PROJECTED</div>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 2 }}>{projectedLabel}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-mid, #8B95A7)', fontWeight: 600 }}>TREND</div>
            <div style={{ fontSize: 13, color: trendColor, marginTop: 4, fontWeight: 600 }}>{trendLabel}</div>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: 'auto', display: 'block' }}>
          <defs>
            <linearGradient id="ptArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3EBD41" stopOpacity="0.32" />
              <stop offset="1" stopColor="#3EBD41" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ptLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#3EBD41" stopOpacity="0.4" />
              <stop offset="1" stopColor="#3EBD41" stopOpacity="1" />
            </linearGradient>
          </defs>
          {goalY != null ? (
            <>
              <line x1={PAD_X} x2={W - PAD_X} y1={goalY} y2={goalY} stroke="#F3AD38" strokeDasharray="4 4" strokeWidth="1.5" />
              <text x={W - PAD_X} y={goalY - 4} fill="#F3AD38" fontSize="10" fontWeight="700" textAnchor="end" fontFamily="Inter">GOAL</text>
            </>
          ) : null}
          <path d={area} fill="url(#ptArea)" />
          <path d={path} fill="none" stroke="url(#ptLine)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={xFor(pts.length - 1)} cy={yFor(last.projectionSec)} r="4" fill="#3EBD41" />
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim, #5E6776)', marginTop: 6, letterSpacing: '0.06em' }}>
          <span>{formatShort(first.date)}</span>
          <span>{pts.length} days · {daysAway} until race</span>
          <span>{formatShort(last.date)}</span>
        </div>
      </div>
    </div>
  );
}

function formatShort(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d).toUpperCase();
}
