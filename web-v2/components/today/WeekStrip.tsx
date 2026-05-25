/**
 * WeekStrip — 7-day band across the top of /today.
 *
 * - Past days WITH a strava activity → clickable Link to /runs/[activity_id]
 * - Past days without a run → display only
 * - Today → highlighted, no click (TODAY surface is already here)
 * - Future days → display only (future workout view ships in P8)
 */
import Link from 'next/link';
import type { GlanceWeekDay } from '@/lib/coach/glance-state';

const DOW_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sun=0 indexed
const QUALITY = new Set(['threshold', 'tempo', 'intervals']);

export function WeekStrip({ days, weekDone, weekPlanned, phaseLabel }: {
  days: GlanceWeekDay[];
  weekDone: number;
  weekPlanned: number | null;
  phaseLabel: string | null;
}) {
  return (
    <div style={{ padding: '4px 24px 14px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginBottom: 10,
        fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 700, color: 'var(--mute)',
        letterSpacing: '1.6px', textTransform: 'uppercase',
      }}>
        <span>THIS WEEK{phaseLabel ? ` · ${phaseLabel}` : ''}</span>
        <span style={{ color: 'var(--green)' }}>
          {weekDone.toFixed(1)} / {weekPlanned ?? '?'} MI
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {days.map((d) => <DayTile key={d.date} day={d} />)}
      </div>
    </div>
  );
}

function DayTile({ day }: { day: GlanceWeekDay }) {
  const isRest = day.plannedType === 'rest' || day.plannedMi === 0;
  const isQuality = QUALITY.has(day.plannedType);
  const isLong = day.plannedType === 'long';
  const ran = day.doneMi > 0 && day.activityId;
  const displayMi = ran ? day.doneMi : day.plannedMi;

  const tile = (
    <div style={{
      background: day.isToday ? 'rgba(62,189,65,0.16)' : 'rgba(255,255,255,0.025)',
      boxShadow: day.isToday ? 'inset 0 0 0 1px rgba(62,189,65,0.35)' : 'none',
      borderRadius: 8, padding: '8px 2px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      transition: 'background .12s',
      cursor: ran ? 'pointer' : 'default',
    }}>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 700,
        color: day.isToday ? 'var(--green)' : 'var(--mute)',
        letterSpacing: '1px',
      }}>
        {DOW_NAMES[day.dow]}
      </div>
      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 14, fontWeight: 400, lineHeight: 1,
        letterSpacing: '0.5px',
        color: day.isToday ? 'var(--green)'
          : isRest ? 'var(--dim)'
          : ran ? 'var(--ink)' : 'var(--mute)',
      }}>
        {isRest && !ran ? '—' : displayMi.toFixed(displayMi % 1 === 0 ? 0 : 1)}
      </div>
      <div style={{
        width: 3, height: 3, borderRadius: '50%',
        background: ran ? 'var(--green)'
          : isQuality ? 'var(--goal)'
          : isLong    ? 'var(--dist)'
          : isRest    ? 'var(--dim)'
                      : 'var(--mute)',
        marginTop: 2,
      }} />
    </div>
  );

  // Past day with a logged run → clickable
  if (ran && day.isPast) {
    return (
      <Link href={`/runs/${encodeURIComponent(day.activityId!)}`} style={{ textDecoration: 'none' }}>
        {tile}
      </Link>
    );
  }
  return tile;
}
