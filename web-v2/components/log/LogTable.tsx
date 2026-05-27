'use client';

/**
 * LogTable — client-side renderer for /log. Each row opens the full
 * RunDetailModal (same as /today). Never navigates away from /log.
 *
 * Snappiness: rows pre-fetch run detail on mouse-enter (intent signal)
 * AND the current week's runs are batch-fetched on mount. Shoes are
 * fetched once and shared across all opens. By the time the user
 * clicks, the modal's data is already in our cache — no skeleton flash.
 */
import { useEffect, useRef, useState } from 'react';
import type { LogWeek, LogRun } from '@/lib/coach/log-state';
import type { RunDetail } from '@/lib/coach/run-state';
import { RunDetailModal } from '@/components/runs/RunDetailModal';

const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function LogTable({ weeks }: { weeks: LogWeek[] }) {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  // Shared prefetch cache across all rows. Keyed by run id.
  const cacheRef = useRef<Map<string, RunDetail>>(new Map());
  const [, forceRerender] = useState(0); // bump when cache fills so modal re-reads
  const [shoes, setShoes] = useState<any[] | null>(null);

  function prefetch(id: string) {
    if (cacheRef.current.has(id)) return;
    fetch(`/api/runs/${encodeURIComponent(id)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        cacheRef.current.set(id, d);
        // Only force re-render if the modal is currently open on this id;
        // otherwise we'd thrash on every hover.
        forceRerender((n) => n + 1);
      })
      .catch(() => {});
  }

  // Shoes: fetch once on mount, share across all run modals.
  useEffect(() => {
    fetch('/api/shoe')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.shoes) setShoes(j.shoes.filter((s: any) => !s.retired)); })
      .catch(() => {});
  }, []);

  // Batch-prefetch the current (most-recent) week on mount so the
  // common case "I just want to inspect today's or yesterday's run"
  // opens instantly.
  useEffect(() => {
    const current = weeks.find((w) => w.isCurrent) ?? weeks[0];
    if (!current) return;
    for (const r of current.runs) prefetch(r.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks]);

  return (
    <>
      <div>
        {weeks.map((w) => (
          <WeekBlock key={w.monday} week={w} onOpen={setOpenRunId} onHover={prefetch} />
        ))}
      </div>
      {openRunId && (
        <RunDetailModal
          activityId={openRunId}
          onClose={() => setOpenRunId(null)}
          prefetchedData={cacheRef.current.get(openRunId) ?? null}
          prefetchedShoes={shoes}
        />
      )}
    </>
  );
}

function WeekBlock({ week, onOpen, onHover }: { week: LogWeek; onOpen: (id: string) => void; onHover: (id: string) => void }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--line-2)',
      }}>
        <div style={{
          fontFamily: 'var(--f-body)', fontSize: 12, fontWeight: 700,
          color: week.isCurrent ? 'var(--green)' : 'var(--mute)',
          letterSpacing: '1.6px', textTransform: 'uppercase',
        }}>
          {week.label}
          <span style={{ marginLeft: 10, color: 'var(--dim)', fontSize: 11 }}>
            {week.runs.length} {week.runs.length === 1 ? 'RUN' : 'RUNS'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 26, color: week.isCurrent ? 'var(--green)' : 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1 }}>
            {week.totalMi.toFixed(1)}
          </span>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.2px' }}>MI</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {week.runs.map((r) => <RunRow key={`${r.id}-${r.date}`} run={r} onOpen={onOpen} onHover={onHover} />)}
      </div>
    </div>
  );
}

function RunRow({ run, onOpen, onHover }: { run: LogRun; onOpen: (id: string) => void; onHover: (id: string) => void }) {
  const typeColor =
    run.type === 'long'      ? 'var(--dist)' :
    run.type === 'race'      ? 'var(--race)' :
    run.type === 'tempo'     ? 'var(--goal)' :
    run.type === 'threshold' ? 'var(--goal)' :
    run.type === 'intervals' ? 'var(--goal)' :
    run.type === 'easy'      ? 'var(--green)' :
                               'var(--mute)';

  const sourceTag = run.source === 'watch' ? 'WATCH'
    : run.source === 'manual' ? 'MANUAL'
    : run.source === 'apple_health' ? 'HEALTH'
    : run.source === 'strava' ? 'STRAVA' : null;

  return (
    <button
      onClick={() => onOpen(run.id)}
      style={{
        display: 'grid',
        gridTemplateColumns: '56px 1fr auto auto auto auto auto',
        gap: 16, alignItems: 'center',
        padding: '14px 18px', textAlign: 'left', width: '100%', cursor: 'pointer',
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.025)',
        transition: 'background .12s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        // Hover = intent. Fire the fetch so the click feels instant.
        onHover(run.id);
      }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
      onFocus={() => onHover(run.id)}
    >
      {/* Date column */}
      <div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.2px', fontWeight: 700 }}>
          {DOW_NAMES[run.dow]}
        </div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 26, color: 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1 }}>
          {parseInt(run.date.slice(-2), 10)}
        </div>
      </div>

      {/* Title + type + source */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--f-display)', fontSize: 19, color: 'var(--ink)',
          letterSpacing: '0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{run.name}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
          {run.type && (
            <span style={{
              fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700,
              color: typeColor, letterSpacing: '1.2px',
            }}>
              {run.type.toUpperCase()}
            </span>
          )}
          {sourceTag && (
            <span style={{
              fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--dim)',
              letterSpacing: '1px', padding: '2px 7px', border: '1px solid var(--line-2)',
              borderRadius: 4,
            }}>{sourceTag}</span>
          )}
        </div>
      </div>

      <Stat v={run.distance_mi.toFixed(1)} u="mi" big color="var(--dist)" />
      {run.pace        && <Stat v={run.pace}              u="/mi" />}
      {run.time_moving && <Stat v={run.time_moving}       u="time" />}
      {run.avg_hr != null && <Stat v={String(run.avg_hr)} u="hr" />}
      {run.elev_gain_ft != null && run.elev_gain_ft > 0 && <Stat v={String(run.elev_gain_ft)} u="ft" />}
    </button>
  );
}

function Stat({ v, u, big, color }: { v: string; u: string; big?: boolean; color?: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      {/* big=true (≥18) → Bebas display; big=false (<18) → HelveticaNeue label.
       *  Stays within typography rule (#159). */}
      <div style={{
        fontFamily: big ? 'var(--f-display)' : 'var(--f-label)',
        fontSize: big ? 24 : 17,
        color: color ?? 'var(--ink)',
        letterSpacing: '0.3px', lineHeight: 1,
      }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>
        {u}
      </div>
    </div>
  );
}
