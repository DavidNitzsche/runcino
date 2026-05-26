'use client';

/**
 * WeekStrip — 7-day band across the top of /today.
 *
 * Every tile is clickable → opens DayDetailModal with the full workout
 * details (target, notes, splits if past + ran). No more navigation to
 * /runs/[id] route.
 *
 * Tile content (bigger than before so days carry more signal at a glance):
 *   - Day-of-week letter
 *   - Day-of-month number
 *   - Distance (planned or actual)
 *   - Workout type label
 *   - Status indicator (dot color: green=done, gold=quality, blue=long, red=race, dim=rest)
 */
import { useState } from 'react';
import type { GlanceWeekDay } from '@/lib/coach/glance-state';
import { DayDetailModal } from './DayDetailModal';

const DOW_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const QUALITY = new Set(['threshold', 'tempo', 'intervals']);

export function WeekStrip({ days, weekDone, weekPlanned, phaseLabel }: {
  days: GlanceWeekDay[];
  weekDone: number;
  weekPlanned: number | null;
  phaseLabel: string | null;
}) {
  const [openDay, setOpenDay] = useState<GlanceWeekDay | null>(null);
  return (
    <div style={{ padding: '4px 24px 14px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginBottom: 12,
        fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: 'var(--mute)',
        letterSpacing: '1.6px', textTransform: 'uppercase',
      }}>
        <span>THIS WEEK{phaseLabel ? ` · ${phaseLabel}` : ''}</span>
        <span style={{ color: 'var(--green)' }}>
          {weekDone.toFixed(1)} / {weekPlanned ?? '?'} MI
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {days.map((d) => <DayTile key={d.date} day={d} onClick={() => setOpenDay(d)} />)}
      </div>
      {openDay && <DayDetailModal day={openDay} onClose={() => setOpenDay(null)} />}
    </div>
  );
}

function DayTile({ day, onClick }: { day: GlanceWeekDay; onClick: () => void }) {
  const isRest = day.plannedType === 'rest';
  const isUnplanned = day.plannedType === 'unplanned';
  const isQuality = QUALITY.has(day.plannedType);
  const isLong = day.plannedType === 'long';
  const isRace = day.plannedType === 'race';
  const ran = day.doneMi >= 0.5;
  const displayMi = ran ? day.doneMi : day.plannedMi;

  const typeLabel = ran ? 'DONE'
    : isRest ? 'REST'
    : isUnplanned ? '—'
    : (day.plannedLabel ?? day.plannedType).toUpperCase().slice(0, 10);

  // EASY days used to fall through to a dim gray — they looked hidden
  // against LONG (blue) and QUALITY (gold). Now EASY = purple (learn),
  // distinct from every other workout type.
  const isEasy = day.plannedType === 'easy' || day.plannedType === 'shakeout';
  const dotColor = ran ? 'var(--green)'
    : isRace      ? 'var(--race)'
    : isQuality   ? 'var(--goal)'
    : isLong      ? 'var(--dist)'
    : isEasy      ? 'var(--learn)'
    : isRest      ? 'transparent'
    :               'rgba(255,255,255,0.20)';

  const mainColor = day.isToday ? 'var(--green)'
    : ran ? 'var(--ink)'
    : isRest ? 'rgba(246,247,248,0.35)'
    : isUnplanned ? 'rgba(246,247,248,0.35)'
    : 'rgba(246,247,248,0.85)';

  // Day-of-month number
  const dom = parseInt(day.date.slice(-2), 10);

  return (
    <button
      onClick={onClick}
      style={{
        background: day.isToday
          ? 'linear-gradient(180deg, rgba(62,189,65,0.16), rgba(62,189,65,0.06))'
          : 'rgba(255,255,255,0.03)',
        boxShadow: day.isToday ? 'inset 0 0 0 1px rgba(62,189,65,0.40)' : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
        borderRadius: 10, padding: '10px 6px 8px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        cursor: 'pointer', border: 'none', transition: 'background .12s, transform .08s',
        minHeight: 92,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = day.isToday ? 'rgba(62,189,65,0.22)' : 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = day.isToday ? 'rgba(62,189,65,0.16)' : 'rgba(255,255,255,0.03)'; }}
    >
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700,
        color: day.isToday ? 'var(--green)' : 'rgba(246,247,248,0.55)',
        letterSpacing: '1.2px',
      }}>
        {DOW_NAMES[day.dow]} · {dom}
      </div>

      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 400, lineHeight: 1.05,
        letterSpacing: '0.5px', color: mainColor, marginTop: 6,
      }}>
        {(isRest && !ran) || (isUnplanned && !ran) ? '—' : displayMi.toFixed(displayMi % 1 === 0 ? 0 : 1)}
      </div>

      {!(isUnplanned && !ran) && (
        <div style={{
          fontFamily: 'var(--f-body)', fontSize: 8.5, fontWeight: 700,
          color: dotColor === 'transparent' ? 'rgba(246,247,248,0.35)' : dotColor,
          letterSpacing: '1.2px', marginTop: 2,
        }}>
          {typeLabel}
        </div>
      )}

      <div style={{
        width: 4, height: 4, borderRadius: '50%',
        background: dotColor,
        marginTop: 4,
        outline: ran ? '2px solid rgba(62,189,65,0.25)' : 'none',
      }} />
    </button>
  );
}
