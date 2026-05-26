'use client';

/**
 * LogTable — client-side renderer for /log. Each row opens the full
 * RunDetailModal (same as /today). Never navigates away from /log.
 */
import { useState } from 'react';
import type { LogWeek, LogRun } from '@/lib/coach/log-state';
import { RunDetailModal } from '@/components/runs/RunDetailModal';

const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function LogTable({ weeks }: { weeks: LogWeek[] }) {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  return (
    <>
      <div>
        {weeks.map((w) => (
          <WeekBlock key={w.monday} week={w} onOpen={setOpenRunId} />
        ))}
      </div>
      {openRunId && <RunDetailModal activityId={openRunId} onClose={() => setOpenRunId(null)} />}
    </>
  );
}

function WeekBlock({ week, onOpen }: { week: LogWeek; onOpen: (id: string) => void }) {
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
        {week.runs.map((r) => <RunRow key={`${r.id}-${r.date}`} run={r} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function RunRow({ run, onOpen }: { run: LogRun; onOpen: (id: string) => void }) {
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
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
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
      <div style={{
        fontFamily: 'var(--f-display)',
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
