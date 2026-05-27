'use client';

/**
 * Week-ahead grid — 7 days w/ DOW, miles, type, and bottom-anchored
 * target line (pace + HR/intent). Mirrors deck §3.
 *
 * Every tile is clickable → opens <DayDetailModal /> with the right view:
 *   - past + ran → recap (splits, HR zones, route, etc. via RunDetailTrigger)
 *   - today / future → planned-workout preview (steps, target pace, HR band)
 *   - rest → quiet rest-day note
 *   - unplanned → "no plan for this day yet" hint
 *
 * Same modal that /today's WeekStrip uses, so /training's WEEK AHEAD and
 * /today's strip behave identically on tap. PlanWeek's day shape is mapped
 * onto GlanceWeekDay via a tiny adapter — keeps the modal a single source
 * of truth.
 */
import { useEffect, useState } from 'react';
import type { PlanWeek } from '@/lib/coach/training-state';
import type { GlanceWeekDay } from '@/lib/coach/glance-state';
import type { Prescription } from '@/lib/training/prescriptions';
import type { RunDetail } from '@/lib/coach/run-state';
import { WorkoutSwapButton } from './WorkoutSwapButton';
import { DayDetailModal } from '@/components/today/DayDetailModal';

const DOW_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const QUALITY = new Set(['threshold', 'tempo', 'intervals']);

interface Target { pace: string; secondary: string }

/** Map a PlanWeek day onto the GlanceWeekDay shape DayDetailModal expects. */
function toGlanceDay(day: PlanWeek['days'][number], today: string): GlanceWeekDay {
  return {
    date: day.date,
    dow: day.dow,
    plannedMi: day.mi,
    plannedType: day.type,
    plannedLabel: day.label,
    doneMi: day.doneMi,
    activityId: day.activityId,
    isToday: day.date === today,
    isPast: day.date < today,
  };
}

function DayCell({
  day, today, planId, onOpen,
}: {
  day: PlanWeek['days'][number];
  today: string;
  planId?: string;
  onOpen: () => void;
}) {
  const isToday = day.date === today;
  const isPast = day.date < today;
  const isRest = day.type === 'rest' || day.mi === 0;
  const isQuality = QUALITY.has(day.type);
  const isLong = day.type === 'long';
  const isRace = day.type === 'race';
  const isEasy = day.type === 'easy' || day.type === 'shakeout';
  const ran = day.doneMi > 0 && day.activityId;
  const tgt = targetFor(day.type, day.mi, day.label);

  const typLabel = isRest && !ran ? 'REST'
    : (day.label ? day.label.toUpperCase() : day.type.toUpperCase());
  const dowName = DOW_NAMES[day.dow] ?? '';
  const typColor = isToday ? 'var(--green)'
    : isQuality ? 'var(--goal)'
    : isLong    ? 'var(--dist)'
    : isRace    ? 'var(--race)'
    : isEasy    ? 'var(--learn)'
                : 'var(--mute)';

  return (
    <button
      onClick={onOpen}
      type="button"
      style={{
        background: isToday ? 'rgba(62,189,65,0.10)'
          : ran ? 'rgba(62,189,65,0.05)'
                : 'rgba(255,255,255,0.025)',
        border: isToday ? '1px solid rgba(62,189,65,0.30)'
          : ran && isPast ? '1px solid rgba(62,189,65,0.18)'
                          : '1px solid transparent',
        borderRadius: 10, padding: '14px 11px',
        display: 'flex', flexDirection: 'column',
        cursor: 'pointer',
        transition: 'background .12s, border .12s, transform .08s',
        height: '100%',
        position: 'relative',
        textAlign: 'left',
        font: 'inherit', color: 'inherit',
        width: '100%',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Swap button — future workouts only, opens edit modal. stopPropagation
          so clicking the swap chip doesn't ALSO open the detail modal. */}
      {!isPast && planId && (
        <div onClick={(e) => e.stopPropagation()}>
          <WorkoutSwapButton
            planId={planId}
            date={day.date}
            currentType={day.type}
            currentMi={day.mi}
            currentLabel={day.label}
          />
        </div>
      )}
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: isToday ? 'var(--green)' : 'var(--mute)', letterSpacing: '1.4px' }}>
        {dowName}
      </div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 26, color: isRest && !ran ? 'var(--dim)' : 'var(--ink)', lineHeight: 1, marginTop: 4 }}>
        {ran ? day.doneMi.toFixed(day.doneMi % 1 === 0 ? 0 : 1)
          : isRest ? '—' : day.mi.toFixed(day.mi % 1 === 0 ? 0 : 1)}
      </div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: ran ? 'var(--green)' : typColor, letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 4 }}>
        {ran ? 'COMPLETED' : typLabel}{isToday ? ' · TODAY' : ''}
      </div>
      {/* Bottom-anchored target line */}
      <div style={{
        marginTop: 'auto', paddingTop: 12,
        borderTop: '1px solid var(--line-2)',
        fontFamily: 'var(--f-body)', fontSize: 11, color: isRest && !ran ? 'var(--dim)' : 'var(--ink)',
        fontWeight: 600, letterSpacing: '0.3px', lineHeight: 1.4,
      }}>
        {tgt.pace}
        <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: 'var(--mute)', letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 3 }}>
          {tgt.secondary}
        </span>
      </div>
    </button>
  );
}

function targetFor(type: string, _mi: number, label: string | null): Target {
  switch (type) {
    case 'easy':       return { pace: '9:00 /mi', secondary: 'HR < 140' };
    case 'long':       return { pace: '8:50 /mi', secondary: 'HR < 145 · fuel @45\'' };
    case 'threshold':  return { pace: '6:48 /mi', secondary: label ?? 'T pace' };
    case 'tempo':      return { pace: '6:35 /mi', secondary: label ?? 'tempo' };
    case 'intervals':  return { pace: '3:45 /K',   secondary: label ?? 'intervals' };
    case 'race':       return { pace: 'race effort', secondary: label ?? 'race day' };
    case 'rest':       return { pace: 'sleep +1h', secondary: 'recovery day' };
    default:           return { pace: '—', secondary: '' };
  }
}

export function WeekAhead({ week, today, planId }: { week: PlanWeek; today: string; planId?: string }) {
  const [openDay, setOpenDay] = useState<GlanceWeekDay | null>(null);

  // Same pre-fetch pattern as WeekStrip — kill the pop-in on /training too.
  // Planned days hit /api/prescription, ran days hit /api/runs/[id], both
  // in parallel on mount. By the time a tile is tapped, the modal renders
  // synchronously.
  const [presByDate, setPresByDate] = useState<Record<string, Prescription>>({});
  const [runByDate, setRunByDate] = useState<Record<string, RunDetail>>({});
  useEffect(() => {
    let mounted = true;
    const planned = week.days.filter((d) => {
      const ran = d.doneMi > 0 && d.activityId;
      const isRest = d.type === 'rest' || d.mi === 0;
      return !ran && !isRest && d.mi > 0 && d.type !== 'unplanned';
    });
    const ranDays = week.days.filter((d) => d.doneMi > 0 && d.activityId);
    Promise.all([
      ...planned.map((d) => {
        const proxyWeekly = Math.max(d.mi * 6, 25);
        return fetch(`/api/prescription?type=${encodeURIComponent(d.type)}&weeklyMi=${proxyWeekly}&targetMi=${d.mi}`)
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
  }, [week.days]);

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16,
      padding: '22px 24px',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.5px' }}>WEEK AHEAD</div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--mute)', letterSpacing: '0.5px' }}>
          {week.plannedMi} MI
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, flex: 1 }}>
        {week.days.map((d) => (
          <DayCell
            key={d.date}
            day={d}
            today={today}
            planId={planId}
            onOpen={() => setOpenDay(toGlanceDay(d, today))}
          />
        ))}
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
