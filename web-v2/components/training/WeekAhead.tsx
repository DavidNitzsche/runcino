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
    // Migration 120 · workout_spec isn't surfaced via the PlanWeek shape
    // this component receives (lighter API for the WeekAhead grid). The
    // detail modal renders the placeholder fallback when null.
    plannedSpec: null,
    strengthSpec: null,
    doneMi: day.doneMi,
    activityId: day.activityId,
    isToday: day.date === today,
    isPast: day.date < today,
    adaptation: null,
  };
}

function DayCell({
  day, today, planId, pres, onOpen,
}: {
  day: PlanWeek['days'][number];
  today: string;
  planId?: string;
  /** Prefetched prescription for this day (when available) — used to
   *  render pace + HR on the tile so it matches the detail modal
   *  instead of hardcoded placeholders. */
  pres?: Prescription | null;
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
  // 2026-05-27 P-TILE-PRES-DRIFT: prefer the real prescription. The
  // hardcoded targetFor() returned generic "9:00 /mi · HR < 140" which
  // openly disagreed with the detail modal's "7:47-8:37 /mi · 138-144
  // bpm (Z2 Aerobic)" — same screen, two sources, different numbers.
  // When the prescription is loaded, pull the work step's pace_target
  // + hr_target so tile and detail can't drift.
  const tgt = targetFromPrescription(pres) ?? targetFor(day.type, day.mi, day.label);

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
                : 'transparent',
        border: isToday ? '1px solid rgba(62,189,65,0.30)'
          : ran && isPast ? '1px solid rgba(62,189,65,0.18)'
                          : '1px solid transparent',
        borderTop: isToday || (ran && isPast) ? undefined : '1px solid var(--line)',
        borderRadius: 0, padding: '14px 11px',
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
      {/* Swap button — only on days you can still change: not past, not
          already completed (swapping a done run is nonsense — it landed
          already). 2026-05-31 fix: was just `!isPast`, which left the
          button sitting on today's completed run. stopPropagation so the
          chip click doesn't ALSO open the detail modal. */}
      {!isPast && !ran && planId && (
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
  // Fallback only — only used when /api/prescription hasn't loaded yet.
  // Don't put doctrine-y bits like "fuel @45'" in here; fueling lives
  // in the DayDetailModal's FuelingCard, computed from Research/18 per
  // the runner's product preferences (gels brand, target g/hr, heat).
  switch (type) {
    case 'easy':       return { pace: '9:00 /mi', secondary: 'HR < 140' };
    case 'long':       return { pace: '8:50 /mi', secondary: 'HR < 145' };
    case 'threshold':  return { pace: '6:48 /mi', secondary: label ?? 'T pace' };
    case 'tempo':      return { pace: '6:35 /mi', secondary: label ?? 'tempo' };
    case 'intervals':  return { pace: '3:45 /K',   secondary: label ?? 'intervals' };
    case 'race':       return { pace: 'race effort', secondary: label ?? 'race day' };
    case 'rest':       return { pace: 'sleep +1h', secondary: 'recovery day' };
    default:           return { pace: '—', secondary: '' };
  }
}

/** 2026-05-27 P-TILE-PRES-DRIFT — pull pace + HR for the tile from the
 *  same Prescription that the detail modal renders. Picks the work
 *  step (skips warmup/cooldown when there's a meaningful middle step,
 *  e.g. threshold reps). Returns null when prescription has no useful
 *  step targets so caller can fall back to the hardcoded placeholder. */
function targetFromPrescription(pres: Prescription | null | undefined): Target | null {
  if (!pres || !Array.isArray(pres.steps) || pres.steps.length === 0) return null;
  // Prefer the step that has a real pace/HR target. For easy/long there's
  // usually only one step ("Run"); for threshold/intervals there's
  // warmup + reps + cooldown and we want the reps row. Scan for the
  // first step with BOTH pace and HR targets; fall back to first step
  // with EITHER; fall back to the longest-distance step.
  const withBoth = pres.steps.find((s) => s.pace_target && s.hr_target);
  const withEither = pres.steps.find((s) => s.pace_target || s.hr_target);
  const longest = [...pres.steps].sort(
    (a, b) => (b.distance_mi ?? 0) - (a.distance_mi ?? 0)
  )[0];
  const step = withBoth ?? withEither ?? longest;
  if (!step) return null;
  const pace = step.pace_target ?? '—';
  // Strip the parenthetical zone suffix from the HR target so the tile
  // stays compact — "138-144 bpm (Z2 Aerobic)" → "138-144 bpm".
  const hr = step.hr_target
    ? step.hr_target.replace(/\s*\([^)]*\)\s*$/, '')
    : '';
  if (!step.pace_target && !step.hr_target) return null;
  return { pace, secondary: hr };
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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {(() => {
        // 2026-05-27 P-DOCTRINE-WEEK-OVER mirror: show projected (done +
        // remaining planned), not just the original planned total, so
        // the header matches what the coach voice says elsewhere.
        const projected = week.days.reduce((sum, d) => {
          const useActual = d.doneMi > 0 && d.activityId;
          return sum + (useActual ? d.doneMi : d.mi);
        }, 0);
        const done = week.days.reduce((sum, d) => sum + (d.doneMi > 0 ? d.doneMi : 0), 0);
        const overPlanBy = Math.round((projected - week.plannedMi) * 10) / 10;
        return (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--mute)' }}>VOLUME · LOGGED / PROJECTED</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <div className="tabular" style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                {done.toFixed(1)} / {projected.toFixed(1)} MI
              </div>
              {Math.abs(overPlanBy) >= 3 && (
                <div style={{ fontSize: 10, color: 'var(--mute)', fontWeight: 600, letterSpacing: '0.5px' }}>
                  ({overPlanBy > 0 ? '+' : ''}{overPlanBy.toFixed(1)} vs {week.plannedMi.toFixed(1)} planned)
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, flex: 1 }}>
        {week.days.map((d) => (
          <DayCell
            key={d.date}
            day={d}
            today={today}
            planId={planId}
            pres={presByDate[d.date] ?? null}
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
