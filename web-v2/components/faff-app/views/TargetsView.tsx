'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed } from '../types';
import { LogNonRunSheet, NewGoalSheet } from '../toolkit';

export function TargetsView({
  seed, onOpenRace,
}: { seed: FaffSeed; onOpenRace: (slug: string) => void; onOpenReach?: () => void }) {
  const router = useRouter();
  const goal = seed.goalRace;
  const [goalOpen, setGoalOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
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

      {/* Action pills · personal goals + non-run logging. POSTs to
          /api/goals and /api/strength|cross-training respectively.
          Closes coverage lines 1830 (personal goals) + 1847/1863 (non-run logging). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
        <button
          type="button"
          onClick={() => setGoalOpen(true)}
          style={{
            fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 1.4,
            textTransform: 'uppercase', color: 'var(--bg)', background: 'var(--txt)',
            border: 0, borderRadius: 14, padding: '11px 18px', cursor: 'pointer',
          }}
        >
          + New goal
        </button>
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          style={{
            fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 1.4,
            textTransform: 'uppercase', color: 'var(--txt)', background: 'rgba(255,255,255,.07)',
            border: '1px solid var(--glass-line)', borderRadius: 14,
            padding: '11px 18px', cursor: 'pointer',
          }}
        >
          + Log strength / cross
        </button>
      </div>

      {goalOpen ? (
        <SheetOverlay onDismiss={() => setGoalOpen(false)}>
          <NewGoalSheet onSaved={() => router.refresh()} onClose={() => setGoalOpen(false)} />
        </SheetOverlay>
      ) : null}
      {logOpen ? (
        <SheetOverlay onDismiss={() => setLogOpen(false)}>
          <LogNonRunSheet onSaved={() => router.refresh()} onClose={() => setLogOpen(false)} />
        </SheetOverlay>
      ) : null}
    </>
  );
}

function SheetOverlay({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'rgba(0,0,0,.55)',
      }}
      onClick={onDismiss}
    >
      <div style={{ width: '100%', maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
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
 * drawn across when goalSec is known.
 *
 * Rendering notes:
 *   · X axis is calendar-aware: points are positioned by their date span,
 *     not by index. 8 snapshots over 60 days now show real spacing instead
 *     of a uniform stripe.
 *   · When projection is steady (delta < 5s), the area fill is dropped and
 *     a clean horizontal line + endpoint dot render instead. Avoids the
 *     "solid green block" look when the trend is flat.
 *   · Y domain expands to include the goal line, so the line + goal sit
 *     in the same visual space regardless of distance between them.
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
  const PAD_Y = 22;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const secs = pts.map(p => p.projectionSec);
  const projMin = Math.min(...secs);
  const projMax = Math.max(...secs);
  const projSpan = projMax - projMin;
  const isFlat = projSpan < 5; // <5s drift over the series · render clean line

  // Y domain: extend to fit the goal line + give the projection room to
  // breathe even when it's identical to the goal. Floor at 60s so a
  // perfectly flat steady-state never collapses to a 1px-tall chart.
  const candidates = [...secs];
  if (goalSec != null) candidates.push(goalSec);
  const rawMin = Math.min(...candidates);
  const rawMax = Math.max(...candidates);
  const rawSpan = Math.max(60, rawMax - rawMin);
  const lo = rawMin - rawSpan * 0.18;
  const hi = rawMax + rawSpan * 0.18;
  const yFor = (sec: number) => PAD_Y + innerH - ((sec - lo) / (hi - lo)) * innerH;

  // Calendar-aware X positioning · snapshots spaced by their date offset,
  // not by index. Falls back to even spacing if dates can't be parsed.
  const ts = pts.map(p => {
    const d = new Date(p.date);
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
  });
  const usesCalendar = ts.every(v => v !== null);
  const t0 = usesCalendar ? (ts[0] as number) : 0;
  const tLast = usesCalendar ? (ts[ts.length - 1] as number) : pts.length - 1;
  const tSpan = Math.max(1, tLast - t0);
  const xFor = (i: number) =>
    PAD_X + innerW * (usesCalendar ? ((ts[i] as number) - t0) / tSpan : i / (pts.length - 1));

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p.projectionSec).toFixed(1)}`).join(' ');
  const goalY = goalSec != null ? yFor(goalSec) : null;
  const last = pts[pts.length - 1];
  const first = pts[0];
  const deltaSec = first.projectionSec - last.projectionSec; // positive = faster (lower sec)
  const trendLabel = isFlat
    ? 'steady'
    : deltaSec > 0
      ? `${formatHMS(deltaSec)} faster over ${pts.length} snapshots`
      : `${formatHMS(-deltaSec)} slower over ${pts.length} snapshots`;
  const trendColor = isFlat ? 'var(--text-mid)' : deltaSec > 0 ? '#3EBD41' : '#FC4D64';

  // Spanning label · "8 snapshots over N days" rather than just "8 days".
  let spanLabel = `${pts.length} snapshots`;
  if (usesCalendar) {
    const daySpan = Math.round((tLast - t0) / 86400000);
    if (daySpan > 0) spanLabel = `${pts.length} snapshots over ${daySpan} days`;
  }

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
              <stop offset="0" stopColor="#3EBD41" stopOpacity="0.22" />
              <stop offset="1" stopColor="#3EBD41" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ptLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#3EBD41" stopOpacity="0.35" />
              <stop offset="1" stopColor="#3EBD41" stopOpacity="1" />
            </linearGradient>
          </defs>
          {/* Goal line first so the projection sits on top */}
          {goalY != null ? (
            <>
              <line x1={PAD_X} x2={W - PAD_X} y1={goalY} y2={goalY} stroke="#F3AD38" strokeDasharray="4 4" strokeWidth="1.5" />
              <text x={W - PAD_X} y={goalY - 4} fill="#F3AD38" fontSize="10" fontWeight="700" textAnchor="end" fontFamily="Inter">GOAL</text>
            </>
          ) : null}
          {/* Area fill ONLY when there's real movement · steady-state runs
              read as a clean line, not a solid block. */}
          {!isFlat ? (
            <path
              d={`${path} L${xFor(pts.length - 1).toFixed(1)},${(H - PAD_Y).toFixed(1)} L${xFor(0).toFixed(1)},${(H - PAD_Y).toFixed(1)} Z`}
              fill="url(#ptArea)"
            />
          ) : null}
          <path d={path} fill="none" stroke="url(#ptLine)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {/* Render every snapshot as a small dot so the runner can see
              the underlying data density. Latest snapshot gets a bigger ring. */}
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={xFor(i)}
              cy={yFor(p.projectionSec)}
              r={i === pts.length - 1 ? 4.5 : 2}
              fill="#3EBD41"
              fillOpacity={i === pts.length - 1 ? 1 : 0.55}
            />
          ))}
          {pts.length > 0 ? (
            <circle
              cx={xFor(pts.length - 1)}
              cy={yFor(last.projectionSec)}
              r="8"
              fill="none"
              stroke="#3EBD41"
              strokeOpacity="0.35"
            />
          ) : null}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim, #5E6776)', marginTop: 6, letterSpacing: '0.06em' }}>
          <span>{formatShort(first.date)}</span>
          <span>{spanLabel} · {daysAway} until race</span>
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
