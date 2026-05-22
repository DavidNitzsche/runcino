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

import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { describeWorkout } from '@/lib/workout-descriptions';
import { generateRunDebrief, parsePaceBounds } from '@/lib/run-debrief';

const RouteMap = dynamic(() => import('@/app/log/RouteMap'), { ssr: false, loading: () => <div style={{ height: 260, borderRadius: 10, background: 'rgba(8,8,8,.04)' }} /> });

export interface WorkoutDay {
  dow: string;
  date: string;            // YYYY-MM-DD
  type: string;            // easy | long | quality | rest | race | recovery
  label: string;
  distanceMi: number;
  isRest?: boolean;
  hasStrength?: boolean;
  /** When this cell IS a race day (type='race'), the saved race's
   *  slug. Cells with raceSlug navigate to /races/[slug] on click
   *  instead of opening the workout modal — the race plan has
   *  more depth than a generic workout card. */
  raceSlug?: string;
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

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('Wrap consumers in <WorkoutModalProvider>');
  return ctx;
}

/* ───────────────────────────────────────────────────────────────────
 * Hero actions — OPEN WORKOUT + SKIP TODAY
 * ─────────────────────────────────────────────────────────────────── */

export function HeroActions({ today, todayDay, completed }: { today: string; todayDay: WorkoutDay | null; completed?: boolean }) {
  const { openFor } = useModal();
  const [skipping, setSkipping] = useState(false);
  const [skipped, setSkipped]   = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  // Mirror the skipped state to a body data attribute so the parent
  // hero card can dim itself via CSS. Querying the existing state on
  // mount keeps the toggle in sync if the runner navigates back.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/plan/skip').then((r) => r.json()).then((j) => {
      if (cancelled) return;
      if (j.skip && j.skip.dateISO === today) setSkipped(true);
    }).catch(() => { /* no-op */ });
    return () => { cancelled = true; };
  }, [today]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.skippedToday = skipped ? 'true' : 'false';
    }
    return () => {
      if (typeof document !== 'undefined') {
        delete document.body.dataset.skippedToday;
      }
    };
  }, [skipped]);

  async function onSkipToggle() {
    if (!todayDay || skipping) return;
    if (!skipped && !confirm("Skip today's workout?")) return;
    setSkipping(true);
    setErr(null);
    try {
      const res = await fetch('/api/plan/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skipped
          ? { undo: true }
          : {
              plannedWorkoutType: todayDay.type,
              plannedMi: todayDay.distanceMi,
              reason: 'runner-initiated',
            }
        ),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || (skipped ? 'Undo failed' : 'Skip failed'));
      } else {
        setSkipped((s) => !s);
      }
    } catch {
      setErr('Network error');
    } finally {
      setSkipping(false);
    }
  }

  if (!todayDay) return null;

  // Post-run: the workout's done — the only action is reviewing it.
  if (completed) {
    return (
      <button type="button" className="btn-primary" onClick={() => openFor(todayDay)}>
        ▶&nbsp;&nbsp;VIEW RECAP
      </button>
    );
  }

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
        onClick={onSkipToggle}
        disabled={skipping}
      >
        {skipping ? (skipped ? 'UNDOING…' : 'SKIPPING…')
         : skipped ? '↩ UNDO SKIP TODAY'
         : 'SKIP TODAY'}
      </button>
      {err && <span style={{ color: '#B00020', fontSize: 12, marginLeft: 8 }}>{err}</span>}
      {/* Body-attribute-driven dim — applied site-wide whenever today
          is skipped. Parent hero card opts in by selecting on this
          attribute. */}
      <style jsx global>{`
        body[data-skipped-today="true"] .hero-card,
        body[data-skipped-today="true"] .today-card {
          opacity: 0.55;
          transition: opacity 200ms ease;
        }
        body[data-skipped-today="true"] .hero-card .btn-ghost,
        body[data-skipped-today="true"] .today-card .btn-ghost {
          opacity: 1;
        }
      `}</style>
    </>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Week strip — clickable day cells
 * ─────────────────────────────────────────────────────────────────── */

export function WeekStripCells({
  days,
  today,
  completedMileage,
  skippedDates = [],
}: {
  days: WorkoutDay[];
  today: string;
  /** Map YYYY-MM-DD → actual miles run that day. A day is "done" only
   *  when actual is ≥ 60% of planned. Serialized from a Map at the
   *  server-component boundary. */
  completedMileage: Record<string, number>;
  /** Dates the runner explicitly skipped. */
  skippedDates?: string[];
}) {
  const { openFor } = useModal();
  const skipSet = new Set(skippedDates);

  return (
    <div className="day-grid">
      {days.map((d) => {
        const isToday = d.date === today;
        const actual = completedMileage[d.date] ?? 0;
        // Bug fix: TODAY counts as done too when the run is logged.
        // Previously `!isToday && d.date < today` excluded today, so a
        // completed run never showed ✓ on its own day — the runner
        // had to wait until tomorrow for confirmation. Now: today
        // shows DONE the moment actual ≥ 60% planned.
        const isDone = d.date <= today && !d.isRest && d.distanceMi > 0 && actual >= d.distanceMi * 0.6;
        const isSkipped = !isDone && !d.isRest && skipSet.has(d.date);
        // A past planned day with no run and no explicit skip = missed.
        const isMissed = !isDone && !isSkipped && !d.isRest && d.distanceMi > 0 && d.date < today;
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
                {isSkipped && <div className="day-status-skipped">SKIPPED</div>}
                {isMissed && <div className="day-status-missed">MISSED</div>}
                {d.hasStrength && !isDone && !isSkipped && !isMissed && <span className="day-strength" title="Strength training">S</span>}
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
        .day-status-skipped {
          margin-top: 6px;
          font-family: 'Inter', sans-serif;
          font-size: 9.5px; font-weight: 700; letter-spacing: .12em;
          text-transform: uppercase; color: rgba(8,8,8,.40);
        }
        .day-status-missed {
          margin-top: 6px;
          font-family: 'Inter', sans-serif;
          font-size: 9.5px; font-weight: 700; letter-spacing: .12em;
          text-transform: uppercase; color: #C97000;
        }
      `}</style>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Modal
 * ─────────────────────────────────────────────────────────────────── */

/** Parse the paceTarget string into a display-friendly { primary, unit }.
 *  Handles ranges ("7:20 – 7:40 per mile"), progressive ("9:45 → 8:30
 *  per mile"), mixed ("9:30 easy → half-marathon goal pace"), and
 *  text-only ("Half-marathon goal pace", "—"). */
function parsePaceTarget(paceTarget: string): { primary: string; unit: string } {
  if (!paceTarget || paceTarget === '—') return { primary: '—', unit: '' };
  // Range with the same unit on the end: "7:20 – 7:40 per mile"
  const range = paceTarget.match(/^(\d+:\d{2})\s*[–-]\s*(\d+:\d{2})\s*per\s*mile/i);
  if (range) return { primary: `${range[1]}–${range[2]}`, unit: '/mi' };
  // Progressive numeric: "9:45 → 8:30 per mile across the run"
  const prog = paceTarget.match(/^(\d+:\d{2})\s*[→]\s*(\d+:\d{2})\s*per\s*mile/i);
  if (prog) return { primary: `${prog[1]}→${prog[2]}`, unit: '/mi' };
  // Numeric → text: "9:30 easy → half-marathon goal pace"
  if (/easy\s*→\s*half/i.test(paceTarget)) {
    const start = paceTarget.match(/^(\d+:\d{2})/);
    return { primary: start ? `${start[1]}→HM` : 'Easy→HM', unit: 'pace' };
  }
  // Single numeric: "9:00 – 9:30 per mile" already covered above. Lone "9:30 per mile"
  const single = paceTarget.match(/^(\d+:\d{2})\s*per\s*mile/i);
  if (single) return { primary: single[1], unit: '/mi' };
  // Text-only ("Half-marathon goal pace", "Race pace")
  return { primary: paceTarget, unit: '' };
}

interface ActualSplit {
  mile: number;
  paceSPerMi: number;
  paceDisplay: string;
  avgHr: number | null;
  elevDeltaFt: number;
}

interface ActualRun {
  id: string;
  name: string;
  distanceMi: number;
  movingTimeS: number;
  paceSPerMi: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  elevGainFt: number;
  workoutType: number | null;
  splits: ActualSplit[];
  summaryPolyline: string | null;
  startLatLng: [number, number] | null;
  endLatLng: [number, number] | null;
}

interface RecoveryCtx {
  hrvMs: number | null; hrvBaselineMs: number | null;
  restingHrBpm: number | null; restingHrBaselineBpm: number | null;
  sleepHours: number | null; respiratoryRate: number | null;
}
interface RunDynamics {
  cadence: number | null; strideLength: number | null;
  verticalOscillation: number | null; groundContactTime: number | null;
  verticalRatio: number | null; runPower: number | null;
}
interface RunWeatherT {
  tempF: number; humidityPct: number; windMph: number; label: string; isHot: boolean;
}

function fmtPaceMS(sPerMi: number): string {
  if (!sPerMi || sPerMi <= 0) return '—';
  const m = Math.floor(sPerMi / 60);
  const s = sPerMi % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtTime(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function WorkoutModal({ day, today, onClose }: { day: WorkoutDay; today: string; onClose: () => void }) {
  const isRest = !!day.isRest || day.distanceMi === 0;
  const isToday = day.date === today;
  const isPast = !isToday && day.date < today;
  const canHaveActual = day.date <= today; // today or past

  // User's resolved fitness — loaded via /api/runs/by-date. Until it
  // arrives, describeWorkout falls back to VDOT-45 default paces, so
  // the modal renders with generic strings briefly, then re-renders
  // with the user's actual paces (e.g. 6:52/mi HM goal pace for a
  // 1:30 target instead of the old hardcoded 7:30-7:50).
  const [userFitness, setUserFitness] = useState<{
    paces: { E: { lowS: number; highS: number }; M: { lowS: number; highS: number }; T: { lowS: number; highS: number }; I: { lowS: number; highS: number }; R: { lowS: number; highS: number }; vdot: number };
    racePaceBand: { lowS: number; highS: number; label: string };
    activeRace: { name: string; goalPaceSPerMi: number; goalDisplay: string } | null;
    vdot: number;
  } | null>(null);

  // Look up the label-specific description. Falls back to type-based
  // copy if the label isn't in the lookup (e.g. for an ad-hoc workout).
  // describeWorkout pulls pace strings from userFitness when set.
  // Cast: the fitness shape we accept is structurally compatible with
  // ResolvedFitness's subset that describeWorkout reads (paces +
  // racePaceBand).
  const desc = describeWorkout(day.label, day.type, userFitness as unknown as Parameters<typeof describeWorkout>[2]);
  const paceTarget = isRest ? '' : desc.paceTarget;
  const paceDisplay = parsePaceTarget(paceTarget);

  // Duration estimate using the mid-point of any pace range we can find.
  // For "7:20 – 7:40" we average to ~7:30; for single values we use that.
  const paceMid = (() => {
    if (!paceTarget) return 0;
    const matches = [...paceTarget.matchAll(/(\d+):(\d{2})/g)].map((m) =>
      parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
    );
    if (matches.length === 0) return 0;
    return Math.round(matches.reduce((a, b) => a + b, 0) / matches.length);
  })();
  const durMin = paceMid > 0 ? Math.round((paceMid * day.distanceMi) / 60) : 0;

  // Fetch the actual run for this date (if any) — only for today + past
  const [actual, setActual] = useState<ActualRun | null | undefined>(undefined); // undefined = loading
  const [userMaxHr, setUserMaxHr] = useState<number | null>(null);
  const [userMaxHrSource, setUserMaxHrSource] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryCtx | null>(null);
  const [dynamics, setDynamics] = useState<RunDynamics | null>(null);
  const [weather, setWeather] = useState<RunWeatherT | null>(null);

  // Always load fitness on modal open — even for future workouts where
  // we never hit by-date. This is what threads the user's actual race
  // goal pace + Daniels bands into the recipe steps.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/fitness')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok) {
          setUserFitness({
            paces: j.paces,
            racePaceBand: j.racePaceBand,
            activeRace: j.activeRace,
            vdot: j.vdot?.value ?? 45,
          });
        }
      })
      .catch(() => { /* keep fallback paces */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!canHaveActual) { setActual(null); return; }
    let cancelled = false;
    fetch(`/api/runs/by-date?date=${day.date}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setActual(j.run ?? null);
        setUserMaxHr(j.maxHr ?? null);
        setUserMaxHrSource(j.maxHrSource ?? null);
        setRecovery(j.recovery ?? null);
        setDynamics(j.dynamics ?? null);
        setWeather(j.weather ?? null);
        if (j.fitness) setUserFitness(j.fitness);
      })
      .catch(() => { if (!cancelled) setActual(null); });
    return () => { cancelled = true; };
  }, [day.date, canHaveActual]);

  // Plan vs actual: percentage of planned distance + status badge
  const planComparison = (() => {
    if (!actual || isRest || day.distanceMi <= 0) return null;
    const ranPct = Math.round((actual.distanceMi / day.distanceMi) * 100);
    const status =
      ranPct >= 90 && ranPct <= 110 ? { label: 'ON PLAN', tone: 'green' as const } :
      ranPct >= 60 ? { label: `${ranPct}% OF PLAN`, tone: 'amber' as const } :
      { label: `BELOW PLAN`, tone: 'amber' as const };
    return { ranPct, status };
  })();

  return (
    <div className="wm-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`wm-card${actual && !isRest ? ' wm-card-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="wm-close" onClick={onClose} aria-label="Close">×</button>

        <div className="wm-eyebrow">
          {fmtFullDate(day.date)}
          {isToday && ' · TODAY'}
          {isPast && actual && ' · COMPLETED'}
          {isPast && !actual && actual !== undefined && ' · MISSED'}
          {actual?.workoutType === 1 && <span className="wm-pill race">RACE</span>}
          {actual?.workoutType === 2 && <span className="wm-pill long">LONG</span>}
          {actual?.workoutType === 3 && <span className="wm-pill workout">WORKOUT</span>}
        </div>
        <div className="wm-title-block">
          <h2 className="wm-title">{isRest ? 'Rest' : day.label.toUpperCase()}</h2>
          {!isRest && <div className="wm-title-sub">{desc.zone}</div>}
        </div>

        {/* ════════════════════════════════════════════════
            DEBRIEF MODE — Completed run with actual data
            ════════════════════════════════════════════════ */}
        {actual && !isRest && (
          <>
            {/* Headline stats — full width across the top */}
            <div className="wm-stats wm-stats-debrief">
              <div className="wm-stat">
                <div className="wm-stat-val">{actual.distanceMi.toFixed(1)}<small>mi</small></div>
                <div className="wm-stat-label">Distance</div>
              </div>
              <div className="wm-stat">
                <div className="wm-stat-val">{fmtTime(actual.movingTimeS)}</div>
                <div className="wm-stat-label">Time</div>
              </div>
              <div className="wm-stat">
                <div className="wm-stat-val">{fmtPaceMS(actual.paceSPerMi)}<small>/mi</small></div>
                <div className="wm-stat-label">Avg pace</div>
              </div>
              <div className="wm-stat">
                <div className="wm-stat-val">{actual.avgHr ?? '—'}<small>bpm</small></div>
                <div className="wm-stat-label">Avg HR</div>
              </div>
            </div>

            {(actual.elevGainFt > 0 || actual.maxHr || actual.avgCadence) && (
              <div className="wm-debrief-meta">
                {actual.elevGainFt > 0 && <span><strong>{actual.elevGainFt}</strong> ft elev</span>}
                {actual.maxHr && <span><strong>{actual.maxHr}</strong> max HR</span>}
                {actual.avgCadence && <span><strong>{actual.avgCadence}</strong> cadence</span>}
                <span>{actual.name}</span>
              </div>
            )}

            {/* Horizontal 3-col layout: vs Plan · Route · Splits */}
            <div className="wm-debrief-grid-3col">
              <div className="wm-debrief-col">
                <div className="wm-sub-label">vs Plan</div>
                <div className="wm-vs-plan">
                  {planComparison && (
                    <div className={`wm-vs-status ${planComparison.status.tone}`}>{planComparison.status.label}</div>
                  )}
                  <div className="wm-vs-row">
                    <span className="wm-vs-key">Workout</span>
                    <span className="wm-vs-val">{day.label}</span>
                  </div>
                  <div className="wm-vs-row">
                    <span className="wm-vs-key">Planned</span>
                    <span className="wm-vs-val">{day.distanceMi} mi</span>
                  </div>
                  <div className="wm-vs-row">
                    <span className="wm-vs-key">Pace target</span>
                    <span className="wm-vs-val">{paceTarget}</span>
                  </div>
                  <div className="wm-vs-row">
                    <span className="wm-vs-key">Actual pace</span>
                    <span className="wm-vs-val">{fmtPaceMS(actual.paceSPerMi)}/mi</span>
                  </div>
                  {planComparison && (
                    <div className="wm-vs-row">
                      <span className="wm-vs-key">% of plan</span>
                      <span className="wm-vs-val">{planComparison.ranPct}%</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="wm-debrief-col">
                <div className="wm-sub-label">Route</div>
                {actual.summaryPolyline ? (
                  <RouteMap
                    polyline={actual.summaryPolyline}
                    startLatLng={actual.startLatLng}
                    endLatLng={actual.endLatLng}
                    height={300}
                  />
                ) : (
                  <div className="wm-no-map">
                    No GPS data — looks like this run was logged from a treadmill or as a manual entry.
                  </div>
                )}
              </div>

              <div className="wm-debrief-col">
                <div className="wm-sub-label">Per-mile splits</div>
                {actual.splits.length > 0 ? (
                  <div className="wm-splits">
                    <div className="wm-splits-head">
                      <span>Mi</span>
                      <span>Pace</span>
                      <span className="right">HR</span>
                      <span className="right">Elev</span>
                    </div>
                    {actual.splits.map((s) => {
                      const allPaces = actual.splits.map((x) => x.paceSPerMi);
                      const fastest = Math.min(...allPaces);
                      const slowest = Math.max(...allPaces);
                      const tone =
                        s.paceSPerMi === fastest ? 'fast' :
                        s.paceSPerMi === slowest ? 'slow' : '';
                      return (
                        <div key={s.mile} className={`wm-split-row ${tone}`}>
                          <span className="wm-split-num">{s.mile}</span>
                          <span className="wm-split-pace">{s.paceDisplay}<small>/mi</small></span>
                          <span className="wm-split-hr">{s.avgHr ?? '—'}</span>
                          <span className="wm-split-elev">
                            {s.elevDeltaFt !== 0 && (s.elevDeltaFt > 0 ? `+${s.elevDeltaFt}` : `${s.elevDeltaFt}`)}
                          </span>
                        </div>
                      );
                    })}
                    <div className="wm-split-legend">
                      <span><span className="dot fast"></span>fastest</span>
                      <span><span className="dot slow"></span>slowest</span>
                    </div>
                  </div>
                ) : (
                  <div className="wm-no-splits">
                    No mile splits yet — Strava is still processing the activity.
                  </div>
                )}
              </div>
            </div>

            {/* Running form — per-run dynamics from Apple Health */}
            {(() => {
              const cad = actual.avgCadence ?? dynamics?.cadence ?? null;
              const cells: Array<{ label: string; value: string; unit: string }> = [
                { label: 'Cadence',      value: cad != null ? String(Math.round(cad)) : '—', unit: cad != null ? 'spm' : '' },
                { label: 'Stride',       value: dynamics?.strideLength != null ? dynamics.strideLength.toFixed(2) : '—', unit: dynamics?.strideLength != null ? 'm' : '' },
                { label: 'Vert Osc',     value: dynamics?.verticalOscillation != null ? dynamics.verticalOscillation.toFixed(1) : '—', unit: dynamics?.verticalOscillation != null ? 'cm' : '' },
                { label: 'Grnd Contact', value: dynamics?.groundContactTime != null ? String(Math.round(dynamics.groundContactTime)) : '—', unit: dynamics?.groundContactTime != null ? 'ms' : '' },
                { label: 'Vert Ratio',   value: dynamics?.verticalRatio != null ? dynamics.verticalRatio.toFixed(1) : '—', unit: dynamics?.verticalRatio != null ? '%' : '' },
                { label: 'Run Power',    value: dynamics?.runPower != null ? String(Math.round(dynamics.runPower)) : '—', unit: dynamics?.runPower != null ? 'W' : '' },
              ];
              const anyData = cells.some((c) => c.value !== '—');
              return (
                <div className="wm-form">
                  <div className="wm-sub-label">Running form · Apple Health</div>
                  <div className="wm-form-grid">
                    {cells.map((c) => (
                      <div key={c.label} className="wm-form-cell">
                        <div className="wm-form-val">{c.value}{c.unit && <small>{c.unit}</small>}</div>
                        <div className="wm-form-lbl">{c.label}</div>
                      </div>
                    ))}
                  </div>
                  {!anyData && (
                    <div style={{ marginTop: 8, fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: 'rgba(8,8,8,.45)' }}>
                      Syncs from your Apple Watch via Apple Health — connect it in Profile and run-by-run form lands here.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Coach take — dynamic response based on actuals vs plan */}
            {(() => {
              const [paceLow, paceHigh] = parsePaceBounds(desc.paceTarget);
              const debrief = generateRunDebrief({
                planLabel: day.label,
                planType: day.type,
                planDistanceMi: day.distanceMi,
                paceLow,
                paceHigh,
                actualDistanceMi: actual.distanceMi,
                actualPaceSPerMi: actual.paceSPerMi,
                actualAvgHr: actual.avgHr,
                splits: actual.splits.map((s) => ({ mile: s.mile, paceSPerMi: s.paceSPerMi, avgHr: s.avgHr })),
                maxHr: userMaxHr,
                recovery: recovery ? {
                  hrvMs: recovery.hrvMs, hrvBaselineMs: recovery.hrvBaselineMs,
                  restingHrBpm: recovery.restingHrBpm, restingHrBaselineBpm: recovery.restingHrBaselineBpm,
                  sleepHours: recovery.sleepHours,
                } : null,
                weather: weather ? { tempF: weather.tempF, humidityPct: weather.humidityPct, isHot: weather.isHot } : null,
              });
              const maxHrLabel = userMaxHr
                ? `Max HR ${userMaxHr} · ${userMaxHrSource === 'manual' ? 'manual' : userMaxHrSource === 'computed' ? 'auto from your races' : 'auto'} · zones tuned to you`
                : 'Max HR not set — using generic HR bands. Set yours on /profile for personalized zones.';
              return (
                <div className="wm-debrief-footer">
                  <div className="wm-debrief-footer-notes">
                    <span className="wm-debrief-footer-label">Coach take</span>
                    <span className="wm-debrief-footer-copy">{debrief}</span>
                    <span className="wm-debrief-footer-meta">{maxHrLabel}</span>
                  </div>
                  <a className="wm-strava-link" href={`https://www.strava.com/activities/${actual.id}`} target="_blank" rel="noreferrer">
                    View full activity on Strava ↗
                  </a>
                </div>
              );
            })()}
          </>
        )}

        {/* Missed: past date but no matching run logged */}
        {!actual && actual !== undefined && isPast && !isRest && (
          <div className="wm-missed">
            No run logged for this date — the planned workout was missed or hasn&rsquo;t synced yet.
          </div>
        )}

        {/* ════════════════════════════════════════════════
            PLAN MODE — Future / today / missed: show the recipe
            ════════════════════════════════════════════════ */}
        {!isRest && !actual && (
          <>
            <div className="wm-stats">
              <div className="wm-stat">
                <div className="wm-stat-val">{day.distanceMi}<small>mi</small></div>
                <div className="wm-stat-label">Distance</div>
              </div>
              <div className="wm-stat">
                <div className="wm-stat-val wm-stat-pace">{paceDisplay.primary}{paceDisplay.unit && <small>{paceDisplay.unit}</small>}</div>
                <div className="wm-stat-label">Pace target</div>
              </div>
              <div className="wm-stat">
                <div className="wm-stat-val">~{durMin || '—'}<small>min</small></div>
                <div className="wm-stat-label">Duration</div>
              </div>
            </div>

            {desc.steps.length > 0 && (
              <ol className="wm-recipe">
                {desc.steps.map((s, i) => (
                  <li className="wm-recipe-item" key={i}>
                    <span className="wm-recipe-num">{i + 1}</span>
                    <div className="wm-recipe-body">
                      {s.kind === 'simple' ? (
                        <div className="wm-recipe-line">
                          <strong className="wm-step-name">{s.name}</strong>
                          {' — '}
                          <strong>{s.duration}</strong>
                          {' at '}
                          <strong>{s.pace}</strong>
                          {' '}
                          <span className="wm-zone-suffix">({s.zone})</span>
                          {s.hrTarget && (
                            <span className="wm-hr-target"> · HR <strong>{s.hrTarget}</strong></span>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="wm-recipe-line">
                            <strong className="wm-step-name">{s.name}</strong>
                          </div>
                          <div className="wm-loop-header">
                            <span className="wm-loop-num">{s.times}</span> rounds of:
                          </div>
                          <ul className="wm-loop-items">
                            {s.items.map((it, j) => (
                              <li key={j} className="wm-loop-item">
                                {it.verb}{' '}
                                <strong>{it.duration}</strong>
                                {it.pace && <> at <strong>{it.pace}</strong></>}
                                {it.zone && <> <span className="wm-zone-suffix">({it.zone})</span></>}
                                {it.hrTarget && <> · HR <strong>{it.hrTarget}</strong></>}
                                {it.suffix && <> {it.suffix}</>}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="wm-sub-label">How it should feel</div>
            <p className="wm-copy">{desc.effort}</p>

            <div className="wm-sub-label">Why this workout</div>
            <p className="wm-copy">{desc.why}</p>

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
          background: rgba(8,8,8,.55);
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
          max-height: 92vh; overflow-y: auto;
        }
        /* Wider variant for completed-run debrief — 3-column horizontal */
        .wm-card.wm-card-wide {
          max-width: 1180px;
        }
        .wm-close {
          position: absolute; top: 14px; right: 16px;
          width: 32px; height: 32px;
          background: transparent; border: none; cursor: pointer;
          font-size: 28px; line-height: 1; color: rgba(8,8,8,.45);
        }
        .wm-close:hover { color: #080808; }
        .wm-eyebrow {
          font-family: 'Inter', sans-serif;
          font-size: 12px; letter-spacing: 2.5px;
          color: rgba(8,8,8,.45);
          text-transform: uppercase; margin-bottom: 8px;
        }
        /* Title block — workout name + zone subtitle.
           Bebas Neue + italic for stronger faff.run brand match.
           Clamps grow on wide modal, shrink on narrow viewports. */
        .wm-title-block {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 0 0 26px;
        }
        .wm-title {
          font-family: 'Bebas Neue', sans-serif;
          font-style: italic;
          font-size: clamp(56px, 7.5vw, 88px);
          line-height: 0.88;
          letter-spacing: -1.5px;
          color: #080808;
          margin: 0;
          /* Subtle gradient on the bottom — faff brand accent without overdoing it */
          background: linear-gradient(135deg, #080808 0%, #080808 70%, #E85D26 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .wm-title-sub {
          font-family: 'Oswald', sans-serif;
          font-weight: 600;
          font-size: 11px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: rgba(8,8,8,.55);
          margin-top: 6px;
        }
        .wm-stats {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 10px; margin-bottom: 24px;
        }
        .wm-stat {
          background: rgba(8,8,8,.03);
          border-radius: 10px;
          padding: 14px 14px 12px;
        }
        .wm-stat-val {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px; line-height: 1; color: #080808;
        }
        .wm-stat-val small {
          font-family: 'Inter', sans-serif;
          font-size: 11px; font-weight: 500;
          color: rgba(8,8,8,.55);
          margin-left: 3px;
        }
        .wm-stat-label {
          font-family: 'Inter', sans-serif;
          font-size: 11px; letter-spacing: 1px;
          color: rgba(8,8,8,.45);
          text-transform: uppercase; margin-top: 6px;
        }
        .wm-section-label {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px;
          color: #3EBD41; text-transform: uppercase;
          margin: 0 0 10px;
        }
        .wm-sub-label {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 10px; letter-spacing: 1.5px;
          color: rgba(8,8,8,.55); text-transform: uppercase;
          margin: 0 0 6px;
        }
        .wm-copy {
          font-family: 'Inter', sans-serif;
          font-size: 13px; line-height: 1.55;
          color: rgba(8,8,8,.75);
          margin: 0 0 16px;
        }
        /* Zone chip at the top of the recipe */
        /* Workout-type pill in the eyebrow */
        .wm-pill {
          font-family: 'Oswald', sans-serif; font-weight: 700;
          font-size: 9px; letter-spacing: 1.5px;
          padding: 2px 8px; border-radius: 4px;
          color: #fff;
          margin-left: 8px;
        }
        .wm-pill.race    { background: #E85D26; }
        .wm-pill.long    { background: #3EBD41; }
        .wm-pill.workout { background: #C97000; }

        /* What you ran — surfaced ABOVE the plan when a matching activity exists */
        .wm-actual {
          background: rgba(62,189,65,.05);
          border: 1px solid rgba(62,189,65,.20);
          border-radius: 12px;
          padding: 18px 20px 16px;
          margin-bottom: 24px;
        }
        .wm-actual-head {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 4px;
        }
        .wm-actual-label {
          font-family: 'Oswald', sans-serif;
          font-weight: 600;
          font-size: 10px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #3EBD41;
        }
        .wm-actual-status {
          font-family: 'Oswald', sans-serif; font-weight: 700;
          font-size: 9.5px; letter-spacing: 1.5px;
          padding: 3px 9px; border-radius: 999px;
          text-transform: uppercase;
        }
        .wm-actual-status.green { background: rgba(62,189,65,.15); color: #3EBD41; }
        .wm-actual-status.amber { background: rgba(243,173,56,.15); color: #C97000; }
        .wm-actual-name {
          font-family: 'Inter', sans-serif;
          font-weight: 600; font-size: 14px;
          color: #080808;
          margin-bottom: 14px;
        }
        .wm-stats-actual { margin-bottom: 8px; }
        .wm-actual-meta {
          display: flex; gap: 12px; flex-wrap: wrap;
          font-family: 'Inter', sans-serif;
          font-size: 12px; color: rgba(8,8,8,.55);
          padding-top: 6px;
        }
        .wm-actual-meta strong { color: #080808; font-weight: 600; }
        .wm-strava-link {
          display: inline-block;
          margin-top: 10px;
          font-family: 'Oswald', sans-serif;
          font-weight: 600; font-size: 10.5px;
          letter-spacing: 1.5px; text-transform: uppercase;
          color: #FC4C02;
          text-decoration: none;
        }
        .wm-strava-link:hover { text-decoration: underline; }

        /* Missed-day note */
        .wm-missed {
          padding: 14px 18px;
          background: rgba(243,173,56,.06);
          border: 1px solid rgba(243,173,56,.18);
          border-radius: 10px;
          margin-bottom: 24px;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: rgba(8,8,8,.65);
        }

        /* "The plan:" header — appears above the planned stats block
           when actuals are present, so the plan becomes the secondary view */
        .wm-plan-header {
          font-family: 'Oswald', sans-serif;
          font-weight: 600;
          font-size: 10px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: rgba(8,8,8,.45);
          margin-bottom: 8px;
        }

        .wm-zone-chip {
          display: inline-block;
          font-family: 'Oswald', sans-serif;
          font-weight: 600;
          font-size: 11px;
          letter-spacing: 1.5px;
          color: #C97000;
          text-transform: uppercase;
          padding: 4px 10px;
          border: 1px solid rgba(201,112,0,.25);
          border-radius: 999px;
          background: rgba(201,112,0,.06);
          margin-bottom: 20px;
        }

        /* Recipe — numbered list, no boxes inside */
        .wm-recipe {
          list-style: none;
          padding: 0;
          margin: 0 0 28px;
          display: flex; flex-direction: column;
          gap: 22px;
        }
        .wm-recipe-item {
          display: grid;
          grid-template-columns: 28px 1fr;
          gap: 14px;
          align-items: baseline;
        }
        .wm-recipe-num {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 22px;
          line-height: 1;
          color: #080808;
        }
        .wm-recipe-body { min-width: 0; }
        .wm-recipe-line {
          font-family: 'Inter', sans-serif;
          font-size: 14.5px;
          color: rgba(8,8,8,.85);
          line-height: 1.5;
        }
        .wm-recipe-line strong { color: #080808; font-weight: 600; }
        .wm-recipe-line .wm-step-name {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 15px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: #080808;
        }
        .wm-zone-suffix {
          color: rgba(8,8,8,.45);
          font-weight: 400;
        }
        .wm-hr-target {
          color: rgba(8,8,8,.55);
          font-size: 12px;
        }
        .wm-hr-target strong {
          color: #E85D26;
          font-weight: 600;
        }

        /* "5 ROUNDS OF:" header above the loop body */
        .wm-loop-header {
          margin-top: 8px;
          font-family: 'Oswald', sans-serif;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: #C97000;
        }
        .wm-loop-num {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 17px;
          margin-right: 1px;
        }
        .wm-loop-items {
          list-style: none;
          padding: 8px 0 0 18px;
          margin: 0;
          display: flex; flex-direction: column; gap: 5px;
        }
        .wm-loop-item {
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          color: rgba(8,8,8,.75);
          line-height: 1.5;
          position: relative;
        }
        .wm-loop-item::before {
          content: '·';
          position: absolute;
          left: -14px; top: -2px;
          color: rgba(8,8,8,.25);
          font-weight: 700;
          font-size: 20px;
        }
        .wm-loop-item strong { color: #080808; font-weight: 600; }
        .wm-actions {
          display: flex; justify-content: flex-end;
          gap: 8px; margin-top: 8px;
        }
        .wm-btn-ghost {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
          padding: 10px 18px; border-radius: 8px; cursor: pointer;
          background: transparent; color: rgba(8,8,8,.55);
          border: 1px solid rgba(8,8,8,.16);
        }
        .wm-btn-ghost:hover { background: rgba(8,8,8,.04); color: #080808; }

        /* ════ DEBRIEF MODE styles (completed-run modal) ════ */
        .wm-stats-debrief {
          margin-bottom: 12px;
        }
        .wm-debrief-meta {
          display: flex; flex-wrap: wrap; gap: 14px;
          padding-bottom: 18px;
          border-bottom: 1px solid rgba(8,8,8,.06);
          margin-bottom: 22px;
          font-family: 'Inter', sans-serif;
          font-size: 12px; color: rgba(8,8,8,.55);
        }
        .wm-debrief-meta strong { color: #080808; font-weight: 600; }

        .wm-form { margin-bottom: 22px; }
        .wm-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
          gap: 8px;
          margin-top: 8px;
        }
        .wm-form-cell {
          background: rgba(8,8,8,.03);
          border: 1px solid rgba(8,8,8,.06);
          border-radius: 8px;
          padding: 10px 12px;
        }
        .wm-form-val {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 24px; line-height: 1; color: #080808;
        }
        .wm-form-val small {
          font-family: 'Inter', sans-serif;
          font-size: 10px; font-weight: 600; color: rgba(8,8,8,.40);
          margin-left: 2px;
        }
        .wm-form-lbl {
          font-family: 'Inter', sans-serif;
          font-size: 8.5px; font-weight: 700; letter-spacing: .08em;
          text-transform: uppercase; color: rgba(8,8,8,.40);
          margin-top: 4px;
        }

        .wm-debrief-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 28px;
          margin-bottom: 18px;
        }
        /* Horizontal 3-col layout for the wide debrief modal */
        .wm-debrief-grid-3col {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr) minmax(0, 1fr);
          gap: 20px;
          margin-bottom: 22px;
        }
        @media (max-width: 960px) {
          .wm-debrief-grid-3col {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          }
          .wm-debrief-grid-3col > .wm-debrief-col:nth-child(2) {
            grid-column: 1 / -1;
            order: -1;
          }
        }
        @media (max-width: 700px) {
          .wm-debrief-grid { grid-template-columns: 1fr; }
          .wm-debrief-grid-3col { grid-template-columns: 1fr; }
          .wm-debrief-grid-3col > .wm-debrief-col:nth-child(2) { order: 0; }
        }
        .wm-debrief-col { min-width: 0; }

        /* Footer row with coach take + Strava link */
        .wm-debrief-footer {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          padding-top: 18px;
          border-top: 1px solid rgba(8,8,8,.06);
          margin-top: 8px;
        }
        .wm-debrief-footer-notes { flex: 1; min-width: 0; }
        .wm-debrief-footer-label {
          display: block;
          font-family: 'Oswald', sans-serif;
          font-weight: 600;
          font-size: 10px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: rgba(8,8,8,.45);
          margin-bottom: 4px;
        }
        .wm-debrief-footer-copy {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          line-height: 1.5;
          color: rgba(8,8,8,.75);
          display: block;
        }
        .wm-debrief-footer-meta {
          display: block;
          margin-top: 8px;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          color: rgba(8,8,8,.45);
          font-style: italic;
        }
        @media (max-width: 700px) {
          .wm-debrief-footer { flex-direction: column; }
        }

        /* Mile splits */
        .wm-splits {
          background: rgba(8,8,8,.025);
          border: 1px solid rgba(8,8,8,.06);
          border-radius: 10px;
          overflow: hidden;
        }
        .wm-splits-head {
          display: grid;
          grid-template-columns: 32px 1fr 50px 50px;
          gap: 8px;
          padding: 8px 14px;
          background: rgba(8,8,8,.04);
          font-family: 'Inter', sans-serif;
          font-size: 10px; letter-spacing: 1.2px;
          color: rgba(8,8,8,.45);
          text-transform: uppercase; font-weight: 600;
        }
        .wm-splits-head .right { text-align: right; }
        .wm-split-row {
          display: grid;
          grid-template-columns: 32px 1fr 50px 50px;
          gap: 8px;
          align-items: center;
          padding: 8px 14px;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: rgba(8,8,8,.85);
        }
        .wm-split-row + .wm-split-row { border-top: 1px solid rgba(8,8,8,.05); }
        .wm-split-row.fast { background: rgba(62,189,65,.06); }
        .wm-split-row.slow { background: rgba(243,173,56,.05); }
        .wm-split-num {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 12px; color: rgba(8,8,8,.55);
          letter-spacing: 0.5px;
          text-align: center;
        }
        .wm-split-pace {
          font-family: 'JetBrains Mono', monospace;
          font-weight: 600; color: #080808;
          font-size: 13px;
        }
        .wm-split-pace small {
          font-family: 'Inter', sans-serif;
          font-size: 10px; color: rgba(8,8,8,.45); font-weight: 500;
          margin-left: 2px;
        }
        .wm-split-hr {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px; color: rgba(8,8,8,.55);
          text-align: right;
        }
        .wm-split-elev {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px; color: rgba(8,8,8,.45);
          text-align: right;
        }
        .wm-split-legend {
          display: flex; gap: 14px;
          padding: 8px 12px;
          background: rgba(8,8,8,.015);
          border-top: 1px solid rgba(8,8,8,.05);
          font-family: 'Inter', sans-serif;
          font-size: 10.5px; color: rgba(8,8,8,.45);
          letter-spacing: 0.5px;
          text-transform: uppercase; font-weight: 600;
        }
        .wm-split-legend .dot {
          display: inline-block;
          width: 8px; height: 8px;
          border-radius: 50%;
          margin-right: 5px;
          vertical-align: middle;
        }
        .wm-split-legend .dot.fast { background: #3EBD41; }
        .wm-split-legend .dot.slow { background: #F3AD38; }
        .wm-no-splits, .wm-no-map {
          padding: 14px 16px;
          background: rgba(8,8,8,.025);
          border: 1px solid rgba(8,8,8,.06);
          border-radius: 10px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: rgba(8,8,8,.55);
          line-height: 1.5;
        }
        .wm-no-map {
          height: 260px;
          display: flex; align-items: center; justify-content: center;
          text-align: center;
        }

        /* vs Plan table */
        .wm-vs-plan {
          background: rgba(8,8,8,.025);
          border: 1px solid rgba(8,8,8,.06);
          border-radius: 10px;
          padding: 14px 16px;
        }
        .wm-vs-status {
          display: inline-block;
          font-family: 'Oswald', sans-serif; font-weight: 700;
          font-size: 10px; letter-spacing: 1.5px;
          padding: 4px 10px; border-radius: 999px;
          text-transform: uppercase;
          margin-bottom: 12px;
        }
        .wm-vs-status.green { background: rgba(62,189,65,.15); color: #3EBD41; }
        .wm-vs-status.amber { background: rgba(243,173,56,.15); color: #C97000; }
        .wm-vs-row {
          display: grid;
          grid-template-columns: minmax(95px, auto) 1fr;
          gap: 12px;
          padding: 6px 0;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          border-top: 1px solid rgba(8,8,8,.05);
        }
        .wm-vs-row:first-of-type { border-top: none; }
        .wm-vs-key {
          color: rgba(8,8,8,.55);
          font-weight: 500;
        }
        .wm-vs-val {
          color: #080808;
          font-weight: 600;
          text-align: right;
        }
        .wm-vs-muted { color: rgba(8,8,8,.45); font-style: normal; font-weight: 500; margin-left: 4px; }
      `}</style>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * InlineRecap — the completed-run recap rendered straight into the hero
 * (no modal hop, no wasted space). Stats + coach take + running form
 * (with placeholders) inline; "full recap" opens the modal for route +
 * splits.
 * ─────────────────────────────────────────────────────────────────── */

export function InlineRecap({ day }: { day: WorkoutDay }) {
  const { openFor } = useModal();
  const [actual, setActual] = useState<ActualRun | null | undefined>(undefined);
  const [recovery, setRecovery] = useState<RecoveryCtx | null>(null);
  const [dynamics, setDynamics] = useState<RunDynamics | null>(null);
  const [weather, setWeather] = useState<RunWeatherT | null>(null);
  const [maxHr, setMaxHr] = useState<number | null>(null);
  const [maxHrSource, setMaxHrSource] = useState<string | null>(null);
  const [fitness, setFitness] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/by-date?date=${day.date}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setActual(j.run ?? null);
        setRecovery(j.recovery ?? null);
        setDynamics(j.dynamics ?? null);
        setWeather(j.weather ?? null);
        setMaxHr(j.maxHr ?? null);
        setMaxHrSource(j.maxHrSource ?? null);
        if (j.fitness) setFitness(j.fitness);
      })
      .catch(() => { if (!cancelled) setActual(null); });
    return () => { cancelled = true; };
  }, [day.date]);

  if (actual === undefined) {
    return <div style={{ marginTop: 18, fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(8,8,8,.45)' }}>Loading your run…</div>;
  }
  if (!actual) {
    return <div style={{ marginTop: 18, fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(8,8,8,.45)' }}>Run is still syncing from Strava — check back in a minute.</div>;
  }

  const desc = describeWorkout(day.label, day.type, fitness as Parameters<typeof describeWorkout>[2]);
  const [paceLow, paceHigh] = parsePaceBounds(desc.paceTarget);
  const debrief = generateRunDebrief({
    planLabel: day.label, planType: day.type, planDistanceMi: day.distanceMi,
    paceLow, paceHigh,
    actualDistanceMi: actual.distanceMi, actualPaceSPerMi: actual.paceSPerMi, actualAvgHr: actual.avgHr,
    splits: actual.splits.map((s) => ({ mile: s.mile, paceSPerMi: s.paceSPerMi, avgHr: s.avgHr })),
    maxHr,
    recovery: recovery ? {
      hrvMs: recovery.hrvMs, hrvBaselineMs: recovery.hrvBaselineMs,
      restingHrBpm: recovery.restingHrBpm, restingHrBaselineBpm: recovery.restingHrBaselineBpm,
      sleepHours: recovery.sleepHours,
    } : null,
    weather: weather ? { tempF: weather.tempF, humidityPct: weather.humidityPct, isHot: weather.isHot } : null,
  });
  const maxHrLabel = maxHr
    ? `Max HR ${maxHr} · ${maxHrSource === 'manual' ? 'manual' : maxHrSource === 'computed' ? 'auto from your races' : 'auto'} · zones tuned to you`
    : 'Max HR not set — using generic HR bands. Set yours on /profile.';

  const cad = actual.avgCadence ?? dynamics?.cadence ?? null;
  const stats: Array<{ v: string; u?: string; l: string }> = [
    { v: actual.distanceMi.toFixed(1), u: 'mi', l: 'Distance' },
    { v: fmtTime(actual.movingTimeS), l: 'Time' },
    { v: fmtPaceMS(actual.paceSPerMi), u: '/mi', l: 'Avg pace' },
    { v: actual.avgHr ? String(actual.avgHr) : '—', u: actual.avgHr ? 'bpm' : '', l: 'Avg HR' },
    { v: cad != null ? String(Math.round(cad)) : '—', u: cad != null ? 'spm' : '', l: 'Cadence' },
  ];
  const form: Array<{ v: string; u: string; l: string }> = [
    { l: 'Stride', v: dynamics?.strideLength != null ? dynamics.strideLength.toFixed(2) : '—', u: dynamics?.strideLength != null ? 'm' : '' },
    { l: 'Vert Osc', v: dynamics?.verticalOscillation != null ? dynamics.verticalOscillation.toFixed(1) : '—', u: dynamics?.verticalOscillation != null ? 'cm' : '' },
    { l: 'Grnd Contact', v: dynamics?.groundContactTime != null ? String(Math.round(dynamics.groundContactTime)) : '—', u: dynamics?.groundContactTime != null ? 'ms' : '' },
    { l: 'Vert Ratio', v: dynamics?.verticalRatio != null ? dynamics.verticalRatio.toFixed(1) : '—', u: dynamics?.verticalRatio != null ? '%' : '' },
    { l: 'Run Power', v: dynamics?.runPower != null ? String(Math.round(dynamics.runPower)) : '—', u: dynamics?.runPower != null ? 'W' : '' },
  ];
  const hasForm = form.some((c) => c.v !== '—');
  const hasRecovery = recovery && (recovery.hrvMs != null || recovery.restingHrBpm != null || recovery.sleepHours != null);

  return (
    <div style={{ marginTop: 18, maxWidth: 760 }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
        {stats.map((s) => (
          <div key={s.l} style={{ padding: '12px 14px', background: 'rgba(8,8,8,.03)', border: '1px solid rgba(8,8,8,.06)', borderRadius: 10 }}>
            <div style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: 28, lineHeight: 1, color: '#080808' }}>
              {s.v}{s.u && <small style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: 'rgba(8,8,8,.40)', marginLeft: 2 }}>{s.u}</small>}
            </div>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(8,8,8,.40)', marginTop: 5 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Weather at the start */}
      {weather && (
        <div style={{ marginTop: 12, fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: 'rgba(8,8,8,.55)' }}>
          <strong style={{ color: '#080808' }}>{weather.tempF}°F</strong> · {weather.humidityPct}% humidity · {weather.windMph} mph wind · {weather.label}
          {weather.isHot && <span style={{ color: '#C97000' }}> · warm</span>}
        </div>
      )}

      {/* Coach take */}
      <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(8,8,8,.04)', borderLeft: '3px solid #E85D26', borderRadius: '0 8px 8px 0' }}>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(8,8,8,.40)', marginBottom: 6 }}>Coach take</div>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1.55, color: 'rgba(8,8,8,.82)', margin: 0 }}>{debrief}</p>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(8,8,8,.40)', marginTop: 8 }}>{maxHrLabel}</div>
      </div>

      {/* Running form (always shown — placeholders until Apple Health syncs) */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(8,8,8,.40)', marginBottom: 8 }}>Running form · Apple Health</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8 }}>
          {[{ l: 'Cadence', v: cad != null ? String(Math.round(cad)) : '—', u: cad != null ? 'spm' : '' }, ...form].map((c) => (
            <div key={c.l} style={{ padding: '10px 12px', background: 'rgba(8,8,8,.03)', border: '1px solid rgba(8,8,8,.06)', borderRadius: 8 }}>
              <div style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: 22, lineHeight: 1, color: c.v === '—' ? 'rgba(8,8,8,.32)' : '#080808' }}>
                {c.v}{c.u && <small style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: 'rgba(8,8,8,.40)', marginLeft: 2 }}>{c.u}</small>}
              </div>
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 8.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'rgba(8,8,8,.40)', marginTop: 4 }}>{c.l}</div>
            </div>
          ))}
        </div>
        {(!hasForm || !hasRecovery) && (
          <div style={{ marginTop: 8, fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: 'rgba(8,8,8,.45)' }}>
            {hasForm ? '' : 'Form metrics '}{!hasForm && !hasRecovery ? 'and recovery vitals ' : ''}{hasRecovery ? '' : (hasForm ? 'Recovery vitals ' : '')}sync from your Apple Watch via Apple Health — connect it in Profile and they fill in here per run.
          </div>
        )}
      </div>

      <button type="button" onClick={() => openFor(day)} style={{ marginTop: 16, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 700, letterSpacing: '.04em', color: '#E85D26' }}>
        View full recap · route + splits →
      </button>
    </div>
  );
}
