'use client';

/**
 * WeekStrip — 7-day band across the top of /today.
 *
 * Design rules (David approved 2026-05-26):
 *  - NO outlines + semi-transparent fills anywhere. Solid gradient
 *    backgrounds, full opacity. Outlines reserved for the current-day
 *    ring only.
 *  - Done runs get a green ✓ check badge in the top-right corner
 *    (not just a dim dot).
 *  - Day label: stacked "MON" / "27" — no awkward "M · 27" separator.
 *  - Type label: real chip-sized text, not 8.5pt invisible.
 *
 * Every tile is clickable → opens DayDetailModal with the full workout
 * details.
 */
import { useState } from 'react';
import type { GlanceWeekDay } from '@/lib/coach/glance-state';
import { DayDetailModal } from './DayDetailModal';

const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
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
        fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, color: 'var(--mute)',
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

interface TypeStyle {
  /** Solid background gradient — strong color, no semi-transparent outlines. */
  background: string;
  /** Main text color used for mileage + type label. */
  ink: string;
  /** Type label text. */
  typeLabel: string;
}

/**
 * Style per workout type. RULE: always two colors / two shades. Never
 * fade to black or card-bg. Gradient stops are paired hues of the same
 * accent — lighter at the top-left, darker at the bottom-right.
 */
function styleFor(day: GlanceWeekDay, ran: boolean): TypeStyle {
  const isRest = day.plannedType === 'rest';
  const isUnplanned = day.plannedType === 'unplanned';
  const isQuality = QUALITY.has(day.plannedType);
  const isLong = day.plannedType === 'long';
  const isRace = day.plannedType === 'race';
  const isEasy = day.plannedType === 'easy' || day.plannedType === 'shakeout';

  if (ran) {
    return {
      background: 'linear-gradient(160deg, #2b6230 0%, #143a1d 100%)',
      ink: '#c8f0c9',
      typeLabel: 'DONE',
    };
  }
  if (isRace) {
    return {
      background: 'linear-gradient(160deg, #b14d2a 0%, #5a2014 100%)',
      ink: '#ffd4be',
      typeLabel: 'RACE',
    };
  }
  if (isQuality) {
    return {
      background: 'linear-gradient(160deg, #b88224 0%, #4a2e0e 100%)',
      ink: '#f8d899',
      typeLabel: (day.plannedLabel ?? day.plannedType).toUpperCase().slice(0, 12),
    };
  }
  if (isLong) {
    return {
      background: 'linear-gradient(160deg, #1f7aa2 0%, #0d2e44 100%)',
      ink: '#a7dbef',
      typeLabel: 'LONG',
    };
  }
  if (isEasy) {
    return {
      background: 'linear-gradient(160deg, #5b46a5 0%, #25184b 100%)',
      ink: '#dccaff',
      typeLabel: 'EASY',
    };
  }
  if (isRest) {
    return {
      background: 'linear-gradient(160deg, #2a3a4a 0%, #14202b 100%)',
      ink: 'rgba(246,247,248,0.65)',
      typeLabel: 'REST',
    };
  }
  if (isUnplanned) {
    return {
      background: 'linear-gradient(160deg, #232730 0%, #14171c 100%)',
      ink: 'rgba(246,247,248,0.45)',
      typeLabel: '—',
    };
  }
  // Fallback — same as unplanned but slightly brighter so it's clear something's there
  return {
    background: 'linear-gradient(160deg, #2a2f38 0%, #181c22 100%)',
    ink: 'rgba(246,247,248,0.7)',
    typeLabel: (day.plannedLabel ?? day.plannedType).toUpperCase().slice(0, 12),
  };
}

function DayTile({ day, onClick }: { day: GlanceWeekDay; onClick: () => void }) {
  const isRest = day.plannedType === 'rest';
  const isUnplanned = day.plannedType === 'unplanned';
  const ran = day.doneMi >= 0.5;
  const displayMi = ran ? day.doneMi : day.plannedMi;
  const s = styleFor(day, ran);

  // Day-of-month number
  const dom = parseInt(day.date.slice(-2), 10);

  const showDash = (isRest && !ran) || (isUnplanned && !ran);

  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        background: s.background,
        boxShadow: day.isToday
          ? 'inset 0 0 0 2px var(--green)'
          : 'none',
        borderRadius: 10, padding: '10px 6px 10px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        cursor: 'pointer', border: 'none',
        transition: 'transform .08s, filter .12s',
        minHeight: 100,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter = 'brightness(1.15)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'brightness(1)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* DONE checkmark badge — replaces the old colored dot below the type
       * label. Top-right corner. Shows only when ran. */}
      {ran && (
        <span style={{
          position: 'absolute', top: 6, right: 6,
          width: 18, height: 18, borderRadius: '50%',
          background: 'var(--green)', color: '#0e1014',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 900, lineHeight: 1,
        }}>✓</span>
      )}

      {/* Day stack: "MON" big on top, "27" small below — drops the
       * awkward "M · 27" separator the previous version had. */}
      <div style={{ textAlign: 'center', lineHeight: 1 }}>
        <div style={{
          fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700,
          color: day.isToday ? 'var(--green)' : 'rgba(246,247,248,0.65)',
          letterSpacing: '1.4px',
        }}>{DOW_NAMES[day.dow]}</div>
        <div style={{
          fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 600,
          color: 'rgba(246,247,248,0.45)', letterSpacing: '0.5px',
          marginTop: 2,
        }}>{dom}</div>
      </div>

      {/* Mileage hero */}
      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 700, lineHeight: 1.05,
        letterSpacing: '0.3px', color: s.ink, marginTop: 4,
      }}>
        {showDash ? '—' : displayMi.toFixed(displayMi % 1 === 0 ? 0 : 1)}
      </div>

      {/* Type chip — bigger and clearer than the old 8.5pt label. */}
      <div style={{
        fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700,
        color: s.ink, opacity: 0.92,
        letterSpacing: '1.2px', marginTop: 2,
      }}>
        {s.typeLabel}
      </div>
    </button>
  );
}
