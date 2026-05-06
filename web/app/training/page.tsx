'use client';

/**
 * /training — daily briefing.
 *
 * Newsroom skeleton with Poster typography injected: masthead, big
 * Oswald date hero, phase line with orange dot, big Oswald workout
 * title, two-column lead (voice body + stats sidebar), this-week grid
 * with solid-orange today, next-up list, and the last-12-weeks chart
 * underneath.
 *
 * Today's prescription comes from /api/coach/today (deterministic
 * Coach: prescribeWorkout + voiceLead). The week-strip combines past
 * Strava actuals with future planned distance from coach.today.weekShape.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Caption, Nav } from '../../components/nav';
import { listRaces, type SavedRace } from '../../lib/storage';
import { useActivities, onlyRuns, type NormalizedActivity } from '../../lib/strava-activities';
import { currentWeekDays, weeklyMiles } from '../../lib/strava-stats';
import { daysUntil, formatShort, todayISO } from '../../lib/dates';

// ── Types from /api/coach/today ─────────────────────────────────────
type Citation = { doc: string; section: string; snippet?: string };
type CoachDecision<T> = { answer: T; rationale: string; explanation?: string; citations: Citation[]; brain: 'deterministic' | 'llm' };
type WorkoutPrescription = {
  type: string;
  label: string;
  distanceMi: number;
  paceTargetSPerMi?: { lower: number; upper: number } | null;
  hrZone?: number | null;
  phaseLabel: string;
  voiceLead: string;
  isQuality: boolean;
  isLong: boolean;
};
type ReadinessAssessment = {
  level: 'green' | 'yellow' | 'red';
  message: string;
  acwr: number | null;
  easyShare: number | null;
};
type WeekShapeDay = { date: string; type: string; distanceMi: number; isToday: boolean; hasStrength: boolean };
type CoachTodayResponse = {
  ok: boolean;
  error?: string;
  coach?: {
    workout: CoachDecision<WorkoutPrescription>;
    readiness: CoachDecision<ReadinessAssessment>;
  };
  today?: {
    weekShape: WeekShapeDay[];
    alerts: Array<{ severity: 'info' | 'warn' | 'rest'; message: string }>;
    mode: 'race' | 'base';
    phase: string;
    modeDetail: string;
  };
};

// ── Glyph + label tables ────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  rest: 'Rest',
  recovery: 'Recovery',
  easy: 'Easy',
  general_aerobic: 'Easy',
  medium_long: 'Medium-long',
  long_steady: 'Long',
  long_progression: 'Long · prog',
  long_mp_block: 'Long · MP',
  long_fast_finish: 'Long · FF',
  threshold_intervals: 'Threshold',
  tempo_continuous: 'Tempo',
  sub_threshold: 'Sub-threshold',
  vo2: 'VO2',
  marathon_specific: 'MP-specific',
  marathon_specific_combo: 'MP-specific',
  marathon_specific_long: 'MP-specific',
  strides: 'Strides',
  hill_sprints: 'Hills',
  race: 'Race',
  shakeout: 'Shakeout',
};

// ── Page ────────────────────────────────────────────────────────────
export default function TrainingPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [races, setRaces] = useState<SavedRace[] | null>(null);
  const [coachToday, setCoachToday] = useState<CoachTodayResponse | null>(null);
  const { activities } = useActivities();

  useEffect(() => {
    let cancelled = false;
    setNow(new Date());
    listRaces().then(rs => { if (!cancelled) setRaces(rs); });
    fetch('/api/coach/today')
      .then(r => r.json())
      .then((data: CoachTodayResponse) => { if (!cancelled) setCoachToday(data); })
      .catch(() => { /* non-fatal — briefing shows the unavailable state */ });
    return () => { cancelled = true; };
  }, []);

  if (now === null || races === null) {
    return (
      <>
        <Caption left="Runcino · training" />
        <div className="stage">
          <Nav active="training" />
          <div className="body"><div className="hint" style={{ padding: 24 }}>Loading…</div></div>
        </div>
      </>
    );
  }

  const upcoming = races.filter(r => daysUntil(r.meta.date) >= 0).sort((a, b) => daysUntil(a.meta.date) - daysUntil(b.meta.date));
  const goalRace = upcoming[0] ?? null;
  const runs = activities ? onlyRuns(activities) : null;

  return (
    <>
      <Caption left="Runcino · training" right={`TRAINING · ${now.toISOString().slice(0, 10)}`} />
      <div className="stage">
        <Nav active="training" />
        <div className="body">

          <DailyBriefing
            now={now}
            data={coachToday}
            goalRace={goalRace}
            runs={runs}
          />

          {runs && runs.length > 0 && <RecentWeeksTile runs={runs} />}

        </div>
      </div>
    </>
  );
}

// ── Daily Briefing ──────────────────────────────────────────────────
// Variant C: newsroom skeleton + Poster typography.
function DailyBriefing({
  now,
  data,
  goalRace,
  runs,
}: {
  now: Date;
  data: CoachTodayResponse | null;
  goalRace: SavedRace | null;
  runs: NormalizedActivity[] | null;
}) {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const mdy = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const year = now.getFullYear();
  const todayIso = todayISO();

  // ── Loading state ─────────────────────────────────────────────────
  if (!data) {
    return (
      <BriefingShell weekday={weekday} mdy={mdy} year={year}>
        <div className="hint" style={{ paddingTop: 28 }}>Coach is checking in…</div>
      </BriefingShell>
    );
  }

  // ── Coach unavailable (no DB / no Strava / no goal race) ──────────
  if (!data.ok || !data.coach) {
    return (
      <BriefingShell weekday={weekday} mdy={mdy} year={year}>
        <div style={{
          paddingTop: 28, fontSize: 14, color: 'var(--color-t1)',
          lineHeight: 1.65, maxWidth: 720,
        }}>
          {data.error ?? "Need a connected Strava account and a saved goal race to generate today's prescription."}
        </div>
        <div style={{ paddingTop: 18, display: 'flex', gap: 10 }}>
          <Link href="/races" className="btn">All races</Link>
          {!goalRace && <Link href="/races/new" className="btn btn--primary">+ Add race</Link>}
        </div>
      </BriefingShell>
    );
  }

  const w = data.coach.workout.answer;
  const weekShape = data.today?.weekShape ?? [];
  const daysOut = goalRace ? daysUntil(goalRace.meta.date) : null;

  // ── Build the 7-day strip: actuals (past) + planned (today/future) ─
  const weekStrip = buildWeekStrip(runs, weekShape, todayIso);
  const stripActualMi = Math.round(weekStrip.reduce((s, d) => s + (d.actualMi ?? 0), 0) * 10) / 10;
  const stripActualRuns = weekStrip.reduce((s, d) => s + (d.actualMi && d.actualMi > 0 ? 1 : 0), 0);

  // ── Next up: next 4 days from weekShape after today ───────────────
  const ahead = weekShape
    .filter(d => d.date > todayIso)
    .slice(0, 4);

  return (
    <BriefingShell weekday={weekday} mdy={mdy} year={year}>
      {/* Phase + days-to-goal */}
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 11.5,
        color: 'var(--color-t2)', letterSpacing: '0.18em',
        textTransform: 'uppercase', fontWeight: 700, marginBottom: 28,
      }}>
        <span style={{ color: 'var(--color-race)' }}>● {w.phaseLabel}</span>
        {goalRace && daysOut != null && daysOut > 0 && (
          <>
            <span style={{ margin: '0 10px', color: 'var(--color-t3)' }}>·</span>
            <Link
              href={`/races/${goalRace.slug}`}
              style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dotted var(--color-l4)' }}
            >
              {daysOut} day{daysOut === 1 ? '' : 's'} to {goalRace.meta.name}
            </Link>
          </>
        )}
        {goalRace && daysOut === 0 && (
          <>
            <span style={{ margin: '0 10px', color: 'var(--color-t3)' }}>·</span>
            <span>Race day · {goalRace.meta.name}</span>
          </>
        )}
      </div>

      {/* Workout title — Oswald caps */}
      <div style={{
        fontFamily: 'Oswald, sans-serif', fontWeight: 700,
        fontSize: 56, lineHeight: 0.95, letterSpacing: '-0.02em',
        textTransform: 'uppercase',
        color: 'var(--color-t0)', marginBottom: 28,
      }}>
        {w.label}
      </div>

      {/* Two-column lead — body + stats sidebar */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 56,
        paddingBottom: 32, borderBottom: '1px solid var(--color-l4)',
      }}>
        <div style={{
          fontSize: 15, color: 'var(--color-t1)',
          lineHeight: 1.7, fontFamily: 'var(--font-body)',
        }}>
          {w.voiceLead}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {(w.distanceMi > 0 || w.paceTargetSPerMi || w.hrZone != null) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {w.distanceMi > 0 && (
                <Stat label="Distance" value={`${w.distanceMi.toFixed(w.distanceMi >= 10 ? 0 : 1)} mi`} />
              )}
              {w.paceTargetSPerMi && (
                <Stat label="Pace" value={`${fmtPace(w.paceTargetSPerMi.lower)}–${fmtPace(w.paceTargetSPerMi.upper)}/mi`} />
              )}
              {w.hrZone != null && <Stat label="HR zone" value={`${w.hrZone}`} />}
            </div>
          )}

          {goalRace && daysOut != null && daysOut > 0 && (
            <div style={{ padding: '14px 0', borderTop: '1px solid var(--color-l4)' }}>
              <div style={{
                fontFamily: 'var(--font-data)', fontSize: 9.5,
                color: 'var(--color-t3)', letterSpacing: '0.18em',
                textTransform: 'uppercase', fontWeight: 700, marginBottom: 6,
              }}>Goal race</div>
              <Link
                href={`/races/${goalRace.slug}`}
                style={{ fontSize: 15, color: 'var(--color-t0)', fontWeight: 600, marginBottom: 4, textDecoration: 'none', display: 'block' }}
              >
                {goalRace.meta.name}
              </Link>
              <div style={{
                fontFamily: 'var(--font-data)', fontSize: 12,
                color: 'var(--color-t2)', fontVariantNumeric: 'tabular-nums',
              }}>
                {formatShort(goalRace.meta.date)} · {daysOut} day{daysOut === 1 ? '' : 's'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* This week — solid-orange today */}
      {weekStrip.length === 7 && (
        <div style={{ paddingTop: 24, marginBottom: 24 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            marginBottom: 14,
          }}>
            <div style={{
              fontFamily: 'var(--font-data)', fontSize: 10.5,
              color: 'var(--color-t3)', letterSpacing: '0.22em',
              textTransform: 'uppercase', fontWeight: 700,
            }}>This week</div>
            {stripActualMi > 0 && (
              <div style={{
                fontFamily: 'var(--font-data)', fontSize: 11,
                color: 'var(--color-t2)', fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.06em',
              }}>
                {stripActualRuns} run{stripActualRuns === 1 ? '' : 's'} · {stripActualMi} mi so far
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--color-l4)', border: '1px solid var(--color-l4)' }}>
            {weekStrip.map(d => {
              const showMi = d.actualMi != null && d.actualMi > 0
                ? d.actualMi
                : d.plannedMi != null && d.plannedMi > 0
                  ? d.plannedMi
                  : null;
              return (
                <div key={d.date} style={{
                  padding: '14px 6px', textAlign: 'center',
                  background: d.isToday ? 'var(--color-race)' : 'var(--color-l1)',
                  opacity: d.isFuture && !d.isToday ? 0.7 : 1,
                }}>
                  <div style={{
                    fontFamily: 'var(--font-data)', fontSize: 10,
                    letterSpacing: '0.16em', fontWeight: 700,
                    color: d.isToday ? '#fff' : 'var(--color-t3)',
                    marginBottom: 8,
                  }}>{d.dow}</div>
                  <div style={{
                    fontFamily: 'var(--font-data)', fontSize: 16,
                    fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: d.isToday ? '#fff' : showMi != null ? 'var(--color-t0)' : 'var(--color-t3)',
                  }}>{showMi != null ? (showMi >= 10 ? Math.round(showMi) : showMi.toFixed(1)) : '·'}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Next up */}
      {ahead.length > 0 && (
        <div>
          <div style={{
            fontFamily: 'var(--font-data)', fontSize: 10.5,
            color: 'var(--color-t3)', letterSpacing: '0.22em',
            textTransform: 'uppercase', fontWeight: 700, marginBottom: 14,
          }}>Next up</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {ahead.map((a, i) => (
              <div key={a.date} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                padding: '10px 0',
                borderBottom: i === ahead.length - 1 ? 'none' : '1px solid var(--color-l4)',
              }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                  <span style={{
                    fontFamily: 'var(--font-data)', fontSize: 10.5,
                    color: 'var(--color-t3)', letterSpacing: '0.16em',
                    fontWeight: 700, textTransform: 'uppercase', width: 36,
                  }}>{dowShort(a.date)}</span>
                  <span style={{ fontSize: 14, color: 'var(--color-t1)' }}>{TYPE_LABEL[a.type] ?? a.type}</span>
                </div>
                <span style={{
                  fontFamily: 'var(--font-data)', fontSize: 12,
                  color: 'var(--color-t2)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {a.distanceMi > 0 ? `${a.distanceMi >= 10 ? Math.round(a.distanceMi) : a.distanceMi.toFixed(1)} mi` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </BriefingShell>
  );
}

// ── Briefing shell — masthead + big date hero ───────────────────────
function BriefingShell({
  weekday, mdy, year, children,
}: { weekday: string; mdy: string; year: number; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--color-l1)',
      borderRadius: 4,
      padding: '36px 44px',
      border: '1px solid var(--color-l4)',
      marginBottom: 10,
    }}>
      {/* Masthead */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        paddingBottom: 14,
        borderBottom: '2px solid var(--color-t0)',
        marginBottom: 28,
      }}>
        <div style={{
          fontFamily: 'var(--font-data)', fontSize: 10,
          color: 'var(--color-t1)', letterSpacing: '0.24em',
          textTransform: 'uppercase', fontWeight: 700,
        }}>
          Training · Daily Briefing
        </div>
        <div style={{
          fontFamily: 'var(--font-data)', fontSize: 10,
          color: 'var(--color-t2)', letterSpacing: '0.16em',
          textTransform: 'uppercase', fontWeight: 600,
        }}>
          {mdy} · {year}
        </div>
      </div>

      {/* Date hero */}
      <div style={{
        fontFamily: 'Oswald, sans-serif', fontWeight: 700,
        fontSize: 88, lineHeight: 0.9, letterSpacing: '-0.025em',
        textTransform: 'uppercase',
        color: 'var(--color-t0)', marginBottom: 6,
      }}>
        {weekday}
      </div>

      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 9.5,
        color: 'var(--color-t3)', letterSpacing: '0.18em',
        textTransform: 'uppercase', fontWeight: 700, marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 18,
        fontWeight: 700, color: 'var(--color-t0)',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
}

function fmtPace(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── Last 12 weeks chart ─────────────────────────────────────────────
function RecentWeeksTile({ runs }: { runs: NormalizedActivity[] }) {
  const weeks = weeklyMiles(runs, 12);
  const max = Math.max(...weeks.map(w => w.miles), 1);
  return (
    <div className="tile" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 10 }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Last 12 weeks</div>
          <div className="tile-lbl">Mileage by week · current week last</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
        {weeks.map((w, i) => {
          const isThis = i === weeks.length - 1;
          const h = w.miles > 0 ? Math.max(6, (w.miles / max) * 80) : 0;
          return (
            <div key={w.weekStart} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: w.miles > 0 ? 'var(--color-t2)' : 'var(--color-t3)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {w.miles > 0 ? Math.round(w.miles) : '—'}
              </div>
              <div title={`Week of ${w.weekStart}: ${w.miles} mi · ${w.runs} runs`} style={{
                width: '100%',
                height: h ? `${h}px` : '4px',
                background: h ? (isThis ? 'var(--color-attention)' : 'var(--color-corporate)') : 'var(--color-l3)',
                borderRadius: 2,
              }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────
interface StripDay {
  date: string;
  dow: string;            // M / T / W / T / F / S / S
  isToday: boolean;
  isFuture: boolean;
  actualMi: number | null;  // from Strava
  plannedMi: number | null; // from coach weekShape
}

function buildWeekStrip(
  runs: NormalizedActivity[] | null,
  weekShape: WeekShapeDay[],
  todayIso: string,
): StripDay[] {
  // Pull the 7-day Mon→Sun frame from Strava actuals (handles
  // timezone + week-start logic). If no runs are loaded yet, fall back
  // to weekShape's date sequence.
  const frame = runs ? currentWeekDays(runs) : weekShape.map(d => ({
    date: d.date,
    miles: 0,
    runs: 0,
    isToday: d.isToday,
    isFuture: d.date > todayIso,
  }));

  const planByDate = new Map<string, WeekShapeDay>();
  for (const d of weekShape) planByDate.set(d.date, d);

  const dows = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return frame.map((f, i) => {
    const planned = planByDate.get(f.date);
    return {
      date: f.date,
      dow: dows[i] ?? '',
      isToday: f.isToday,
      isFuture: f.isFuture,
      actualMi: f.miles > 0 ? f.miles : null,
      plannedMi: planned ? planned.distanceMi : null,
    };
  });
}

function dowShort(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
