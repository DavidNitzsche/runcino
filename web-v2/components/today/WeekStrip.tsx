'use client';

/**
 * WeekStrip — 7-day band across the top of /today.
 *
 * Direction E (David approved 2026-05-26): each tile is a neutral card
 * with a 6px color band across the top in the workout's accent (two-
 * shade gradient — never fades to black/bg). Mileage gets full presence
 * on a calm canvas. Calendar-app vibe.
 *
 * Today gets a 2px green ink ring. DONE runs get a ✓ checkmark badge
 * in the top-right. Day label stacks "MON" over "27" — no awkward
 * separator.
 *
 * Every tile is clickable → opens DayDetailModal.
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
  /** 6px top-band gradient — two-shade of the workout's accent color. */
  band: string;
  /** Type label color sitting on the neutral card body. */
  typeColor: string;
  /** Type label text. */
  typeLabel: string;
}

/**
 * RULE: gradients are always two shades — never fade to black.
 * Each band uses a lighter + darker shade of the same accent.
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
      band: 'linear-gradient(90deg, #3EBD41, #2b8e2e)',
      typeColor: 'var(--green)',
      typeLabel: 'DONE',
    };
  }
  if (isRace) {
    return {
      band: 'linear-gradient(90deg, #FF8847, #c4541d)',
      typeColor: 'var(--race)',
      typeLabel: 'RACE',
    };
  }
  if (isQuality) {
    return {
      band: 'linear-gradient(90deg, #F3AD38, #c0871d)',
      typeColor: 'var(--goal)',
      typeLabel: (day.plannedLabel ?? day.plannedType).toUpperCase().slice(0, 12),
    };
  }
  if (isLong) {
    return {
      band: 'linear-gradient(90deg, #4DCDEB, #1f86a8)',
      typeColor: 'var(--dist)',
      typeLabel: 'LONG',
    };
  }
  if (isEasy) {
    return {
      band: 'linear-gradient(90deg, #B084FF, #7a52d4)',
      typeColor: 'var(--learn)',
      typeLabel: 'EASY',
    };
  }
  if (isRest) {
    return {
      band: 'linear-gradient(90deg, #4a5560, #2a3340)',
      typeColor: 'var(--mute)',
      typeLabel: 'REST',
    };
  }
  if (isUnplanned) {
    return {
      band: 'linear-gradient(90deg, #2a3038, #1a1f25)',
      typeColor: 'var(--dim)',
      typeLabel: '—',
    };
  }
  return {
    band: 'linear-gradient(90deg, #4a5560, #2a3340)',
    typeColor: 'var(--mute)',
    typeLabel: (day.plannedLabel ?? day.plannedType).toUpperCase().slice(0, 12),
  };
}

function DayTile({ day, onClick }: { day: GlanceWeekDay; onClick: () => void }) {
  const isRest = day.plannedType === 'rest';
  const isUnplanned = day.plannedType === 'unplanned';
  const ran = day.doneMi >= 0.5;
  const displayMi = ran ? day.doneMi : day.plannedMi;
  const s = styleFor(day, ran);
  const dom = parseInt(day.date.slice(-2), 10);

  const showDash = (isRest && !ran) || (isUnplanned && !ran);
  const miColor = isRest || isUnplanned ? 'var(--dim)' : 'var(--ink)';

  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        background: 'var(--card)',
        borderRadius: 12,
        padding: 0,
        overflow: 'hidden',
        boxShadow: day.isToday ? 'inset 0 0 0 2px var(--green)' : 'inset 0 0 0 1px var(--line)',
        cursor: 'pointer', border: 'none',
        transition: 'transform .08s, filter .12s',
        minHeight: 110,
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter = 'brightness(1.08)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'brightness(1)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* 6px color band across the top — the only color on the tile.
       *  Two-shade gradient of the workout's accent. */}
      <div style={{
        width: '100%', height: 6,
        background: s.band,
        flexShrink: 0,
      }} />

      {/* DONE checkmark — top-right corner, sits over the card body just
       *  below the band. */}
      {ran && (
        <span style={{
          position: 'absolute', top: 12, right: 8,
          width: 18, height: 18, borderRadius: '50%',
          background: 'var(--green)', color: '#0a0c10',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 900, lineHeight: 1,
        }}>✓</span>
      )}

      {/* Tile content — neutral card body. */}
      <div style={{
        flex: 1,
        padding: '12px 6px 12px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 4,
      }}>
        {/* Stacked day label */}
        <div style={{ textAlign: 'center', lineHeight: 1 }}>
          <div style={{
            fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700,
            color: day.isToday ? 'var(--green)' : 'var(--ink)',
            letterSpacing: '1.4px',
          }}>{DOW_NAMES[day.dow]}</div>
          <div style={{
            fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 600,
            color: 'var(--mute)', letterSpacing: '0.5px',
            marginTop: 2,
          }}>{dom}</div>
        </div>

        {/* Mileage */}
        <div style={{
          fontFamily: 'var(--f-display)', fontSize: 26, fontWeight: 800,
          lineHeight: 1.05, letterSpacing: '0.2px',
          color: miColor, marginTop: 4,
        }}>
          {showDash ? '—' : displayMi.toFixed(displayMi % 1 === 0 ? 0 : 1)}
        </div>

        {/* Type chip */}
        <div style={{
          fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700,
          color: s.typeColor,
          letterSpacing: '1.2px', marginTop: 2,
        }}>
          {s.typeLabel}
        </div>
      </div>
    </button>
  );
}
