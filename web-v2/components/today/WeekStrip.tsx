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
import { useEffect, useState } from 'react';
import type { GlanceWeekDay } from '@/lib/coach/glance-state';
import type { Prescription } from '@/lib/training/prescriptions';
import type { RunDetail } from '@/lib/coach/run-state';
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

  // Pre-fetch every planned day's prescription AND every ran day's
  // run-detail so the modal renders synchronously when tapped.
  // Eliminates the half-tick pop-in between modal open and detail
  // arrival. Keyed by date so we can look up the right one on click.
  const [presByDate, setPresByDate] = useState<Record<string, Prescription>>({});
  const [runByDate, setRunByDate] = useState<Record<string, RunDetail>>({});
  useEffect(() => {
    let mounted = true;
    const planned = days.filter((d) => {
      const ran = d.doneMi >= 0.5;
      const isRest = d.plannedType === 'rest';
      const isUnplanned = d.plannedType === 'unplanned' || (d.plannedMi === 0 && !isRest);
      return !ran && !isRest && !isUnplanned && d.plannedMi > 0;
    });
    const ranDays = days.filter((d) => d.doneMi >= 0.5 && d.activityId);
    Promise.all([
      ...planned.map((d) => {
        const proxyWeekly = Math.max(d.plannedMi * 6, 25);
        return fetch(`/api/prescription?type=${encodeURIComponent(d.plannedType)}&weeklyMi=${proxyWeekly}&targetMi=${d.plannedMi}`)
          .then((r) => r.ok ? r.json() : null)
          .then((p) => p ? { kind: 'pres' as const, date: d.date, payload: p as Prescription } : null)
          .catch(() => null);
      }),
      ...ranDays.map((d) =>
        fetch(`/api/runs/${encodeURIComponent(d.activityId!)}`)
          .then((r) => r.ok ? r.json() : null)
          .then((p) => p ? { kind: 'run' as const, date: d.date, payload: p as RunDetail } : null)
          .catch(() => null)
      ),
    ]).then((results) => {
      if (!mounted) return;
      const pMap: Record<string, Prescription> = {};
      const rMap: Record<string, RunDetail> = {};
      for (const r of results) {
        if (!r) continue;
        if (r.kind === 'pres') pMap[r.date] = r.payload;
        if (r.kind === 'run')  rMap[r.date] = r.payload;
      }
      setPresByDate(pMap);
      setRunByDate(rMap);
    });
    return () => { mounted = false; };
  }, [days]);

  return (
    <div style={{ padding: '4px 24px 14px' }}>
      {(() => {
        // P-DOCTRINE-WEEK-OVER 2026-05-27 — header denominator was the
        // ORIGINAL planned total (e.g. 43.8). Coach voice says
        // "tracking for 50.1" (done + remaining planned). Two
        // numbers on the same screen = the runner has to reconcile
        // them. Compute the projected total from days[] (actual for
        // past + today-if-ran, planned for the rest) and use that
        // as the denominator instead. Renders "25.8 / 50.1 MI"
        // matching what the coach is saying.
        const projected = days.reduce((sum, d) => {
          const useActual = d.doneMi >= 0.5 && d.activityId;
          return sum + (useActual ? d.doneMi : d.plannedMi);
        }, 0);
        const overPlanBy = weekPlanned != null
          ? Math.round((projected - weekPlanned) * 10) / 10
          : 0;
        return (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12,
            fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, color: 'var(--mute)',
            letterSpacing: '1.6px', textTransform: 'uppercase',
          }}>
            <span>THIS WEEK{phaseLabel ? ` · ${phaseLabel}` : ''}</span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--green)' }}>
                {weekDone.toFixed(1)} / {projected.toFixed(1)} MI
              </span>
              {/* When projected materially differs from the original plan,
                  show the original number small so the runner can see
                  the trajectory without reading the coach voice. */}
              {weekPlanned != null && Math.abs(overPlanBy) >= 3 && (
                <span style={{
                  fontSize: 9, color: 'var(--mute)', fontWeight: 600, letterSpacing: '1px',
                  textTransform: 'none',
                }}>
                  ({overPlanBy > 0 ? '+' : ''}{overPlanBy.toFixed(1)} vs {weekPlanned.toFixed(1)} planned)
                </span>
              )}
            </span>
          </div>
        );
      })()}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {days.map((d) => <DayTile key={d.date} day={d} onClick={() => setOpenDay(d)} />)}
      </div>
      {openDay && (
        <DayDetailModal
          day={openDay}
          prefetchedPres={presByDate[openDay.date] ?? null}
          prefetchedRun={runByDate[openDay.date] ?? null}
          onClose={() => setOpenDay(null)}
        />
      )}
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
