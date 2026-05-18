'use client';

/**
 * WorkoutModalIsland — interactive layer for the overview hero +
 * week strip.
 *
 * Renders:
 *   - The OPEN WORKOUT and SKIP TODAY buttons in the hero card (mode:
 *     "actions"). Both open the modal; SKIP also posts to /api/plan/skip.
 *   - The 7-day week strip cells as clickable buttons (mode: "strip").
 *     Click any day → modal opens for that day.
 *   - The modal itself.
 *
 * The component manages its own modal state; the server-rendered page
 * just hands it the plan data + the set of completed dates. Two
 * instances render side by side and share state via the parent
 * `<WorkoutModalProvider>` wrapper.
 */

import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import { describeWorkout } from '@/lib/workout-descriptions';

export interface WorkoutDay {
  dow: string;
  date: string;            // YYYY-MM-DD
  type: string;            // easy | long | quality | rest | race | recovery
  label: string;
  distanceMi: number;
  isRest?: boolean;
  hasStrength?: boolean;
}

interface ModalContextValue {
  openFor: (d: WorkoutDay) => void;
}
const ModalContext = createContext<ModalContextValue | null>(null);

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtFullDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return `${DOW_LONG[d.getUTCDay()]} · ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/* ───────────────────────────────────────────────────────────────────
 * Provider — owns modal state, renders the modal itself
 * ─────────────────────────────────────────────────────────────────── */

export function WorkoutModalProvider({ children, today }: { children: ReactNode; today: string }) {
  const [openDay, setOpenDay] = useState<WorkoutDay | null>(null);

  const value = useMemo<ModalContextValue>(() => ({
    openFor: (d) => setOpenDay(d),
  }), []);

  return (
    <ModalContext.Provider value={value}>
      {children}
      {openDay && (
        <WorkoutModal day={openDay} today={today} onClose={() => setOpenDay(null)} />
      )}
    </ModalContext.Provider>
  );
}

function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('Wrap consumers in <WorkoutModalProvider>');
  return ctx;
}

/* ───────────────────────────────────────────────────────────────────
 * Hero actions — OPEN WORKOUT + SKIP TODAY
 * ─────────────────────────────────────────────────────────────────── */

export function HeroActions({ today, todayDay }: { today: string; todayDay: WorkoutDay | null }) {
  const { openFor } = useModal();
  const [skipping, setSkipping] = useState(false);
  const [skipped, setSkipped]   = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  async function onSkip() {
    if (!todayDay || skipping) return;
    if (!confirm('Skip today\'s workout? You can undo this from the log.')) return;
    setSkipping(true);
    setErr(null);
    try {
      const res = await fetch('/api/plan/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plannedWorkoutType: todayDay.type,
          plannedMi: todayDay.distanceMi,
          reason: 'runner-initiated',
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || 'Skip failed');
      } else {
        setSkipped(true);
      }
    } catch {
      setErr('Network error');
    } finally {
      setSkipping(false);
    }
  }

  if (!todayDay) return null;

  return (
    <>
      <button
        type="button"
        className="btn-primary"
        onClick={() => openFor(todayDay)}
      >
        ▶&nbsp;&nbsp;OPEN WORKOUT
      </button>
      <button
        type="button"
        className="btn-ghost"
        onClick={onSkip}
        disabled={skipping || skipped}
      >
        {skipped ? 'SKIPPED' : skipping ? 'SKIPPING…' : 'SKIP TODAY'}
      </button>
      {err && <span style={{ color: '#B00020', fontSize: 12, marginLeft: 8 }}>{err}</span>}
    </>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Week strip — clickable day cells
 * ─────────────────────────────────────────────────────────────────── */

export function WeekStripCells({
  days,
  today,
  completed,
}: {
  days: WorkoutDay[];
  today: string;
  completed: string[];
}) {
  const { openFor } = useModal();
  const completedSet = useMemo(() => new Set(completed), [completed]);

  return (
    <div className="day-grid">
      {days.map((d) => {
        const isToday = d.date === today;
        const isDone = !isToday && d.date < today && !d.isRest && completedSet.has(d.date);
        const dateNum = parseInt(d.date.slice(-2), 10);
        return (
          <button
            key={d.date}
            type="button"
            className={`day-col day-col-btn${isToday ? ' today' : ''}`}
            onClick={() => openFor(d)}
          >
            <div className="day-name">{d.dow}</div>
            <div className={`day-date${isToday ? ' amber' : ''}`}>{dateNum}</div>
            {d.isRest ? (
              <div className="day-rest">Rest</div>
            ) : (
              <>
                <div className="day-workout-name">{d.label}</div>
                <div className="day-distance">{d.distanceMi}<small>mi</small></div>
                {isDone && <div className="day-status-done">DONE</div>}
                {d.hasStrength && !isDone && <span className="day-strength" title="Strength training">S</span>}
              </>
            )}
          </button>
        );
      })}

      <style jsx>{`
        .day-col-btn {
          background: transparent;
          border: none;
          padding: 24px;
          font: inherit;
          color: inherit;
          text-align: left;
          cursor: pointer;
          width: 100%;
          transition: background 120ms ease;
        }
        .day-col-btn:hover { background: rgba(13, 15, 18, 0.03); }
      `}</style>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Modal
 * ─────────────────────────────────────────────────────────────────── */

function WorkoutModal({ day, today, onClose }: { day: WorkoutDay; today: string; onClose: () => void }) {
  const isRest = !!day.isRest || day.distanceMi === 0;
  const isToday = day.date === today;
  const isPast = !isToday && day.date < today;
  // Look up the label-specific description. Falls back to type-based
  // copy if the label isn't in the lookup (e.g. for an ad-hoc workout).
  const desc = describeWorkout(day.label, day.type);
  const paceTarget = isRest ? '' : desc.paceTarget;

  // Rough duration estimate from distance + the FIRST pace number in the
  // target (covers ranges like "9:00 – 9:30/mi" or progressive workouts).
  const paceMid = (() => {
    if (!paceTarget) return 0;
    const m = paceTarget.match(/(\d+):(\d+)/);
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  })();
  const durMin = paceMid > 0 ? Math.round((paceMid * day.distanceMi) / 60) : 0;

  return (
    <div className="wm-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="wm-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="wm-close" onClick={onClose} aria-label="Close">×</button>

        <div className="wm-eyebrow">
          {fmtFullDate(day.date)} {isToday && '· TODAY'} {isPast && '· PAST'}
        </div>
        <h2 className="wm-title">{isRest ? 'Rest' : day.label}</h2>

        {!isRest && (
          <>
            <div className="wm-stats">
              <div className="wm-stat">
                <div className="wm-stat-val">{day.distanceMi}<small>mi</small></div>
                <div className="wm-stat-label">Distance</div>
              </div>
              <div className="wm-stat">
                <div className="wm-stat-val">{paceTarget.split(' ')[0]}<small>/mi</small></div>
                <div className="wm-stat-label">Pace target</div>
              </div>
              <div className="wm-stat">
                <div className="wm-stat-val">~{durMin || '—'}<small>min</small></div>
                <div className="wm-stat-label">Duration</div>
              </div>
            </div>

            <div className="wm-section-label">{desc.zone}</div>
            <p className="wm-copy">{desc.copy}</p>

            {day.hasStrength && (
              <>
                <div className="wm-section-label">Strength session</div>
                <p className="wm-copy">Pair this run with the strength block — 30 min of lower-body + core after the run, or in a separate session same day.</p>
              </>
            )}
          </>
        )}

        {isRest && (
          <p className="wm-copy">No run today. Use the day for full recovery, mobility, or a non-running cross-train if you feel restless.</p>
        )}

        <div className="wm-actions">
          <button type="button" className="wm-btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>

      <style jsx>{`
        .wm-overlay {
          position: fixed; inset: 0;
          background: rgba(13,15,18,.55);
          display: flex; align-items: center; justify-content: center;
          z-index: 200;
          padding: 24px;
        }
        .wm-card {
          background: #fff; border-radius: 18px;
          width: 100%; max-width: 560px;
          padding: 36px 40px 32px;
          position: relative;
          box-shadow: 0 30px 80px rgba(0,0,0,.25);
        }
        .wm-close {
          position: absolute; top: 14px; right: 16px;
          width: 32px; height: 32px;
          background: transparent; border: none; cursor: pointer;
          font-size: 28px; line-height: 1; color: rgba(13,15,18,.45);
        }
        .wm-close:hover { color: #0D0F12; }
        .wm-eyebrow {
          font-family: 'Inter', sans-serif;
          font-size: 12px; letter-spacing: 2.5px;
          color: rgba(13,15,18,.45);
          text-transform: uppercase; margin-bottom: 8px;
        }
        .wm-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 64px; line-height: 0.9;
          letter-spacing: -1px; color: #0D0F12;
          margin: 0 0 20px;
          text-transform: uppercase;
        }
        .wm-stats {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 10px; margin-bottom: 24px;
        }
        .wm-stat {
          background: rgba(13,15,18,.03);
          border-radius: 10px;
          padding: 14px 14px 12px;
        }
        .wm-stat-val {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px; line-height: 1; color: #0D0F12;
        }
        .wm-stat-val small {
          font-family: 'Inter', sans-serif;
          font-size: 11px; font-weight: 500;
          color: rgba(13,15,18,.55);
          margin-left: 3px;
        }
        .wm-stat-label {
          font-family: 'Inter', sans-serif;
          font-size: 11px; letter-spacing: 1px;
          color: rgba(13,15,18,.45);
          text-transform: uppercase; margin-top: 6px;
        }
        .wm-section-label {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px;
          color: #2CA82F; text-transform: uppercase;
          margin: 0 0 6px;
        }
        .wm-copy {
          font-family: 'Inter', sans-serif;
          font-size: 14px; line-height: 1.55;
          color: rgba(13,15,18,.75);
          margin: 0 0 18px;
        }
        .wm-actions {
          display: flex; justify-content: flex-end;
          gap: 8px; margin-top: 8px;
        }
        .wm-btn-ghost {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
          padding: 10px 18px; border-radius: 8px; cursor: pointer;
          background: transparent; color: rgba(13,15,18,.55);
          border: 1px solid rgba(13,15,18,.16);
        }
        .wm-btn-ghost:hover { background: rgba(13,15,18,.04); color: #0D0F12; }
      `}</style>
    </div>
  );
}
