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
import type { SavedRace } from '../../lib/storage';
import { HubProvider, useHub } from '../../lib/hub-provider';
import { useActivities, onlyRuns, type NormalizedActivity } from '../../lib/strava-activities';
import { currentWeekDays, weeklyMiles } from '../../lib/strava-stats';
import { daysUntil, formatShort, todayISO } from '../../lib/dates';
import { RpeInput } from '../../components/RpeInput';

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
type WeekShapeDay = {
  date: string;
  type: string;
  label: string;
  distanceMi: number;
  description: string;
  paceTargetSPerMi: { lowS: number; highS: number } | null;
  hrZone: number | null;
  isQuality: boolean;
  isLong: boolean;
  isToday: boolean;
  hasStrength: boolean;
};
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
// Page is a thin HubProvider wrapper around the inner content.
// Everything below useHub()s — no per-page localStorage cache anymore.
export default function TrainingPage() {
  return (
    <HubProvider>
      <TrainingPageInner />
    </HubProvider>
  );
}

function TrainingPageInner() {
  const [now, setNow] = useState<Date | null>(() => typeof window !== 'undefined' ? new Date() : null);
  const hub = useHub();
  const { activities } = useActivities();

  useEffect(() => {
    setNow(new Date());
  }, []);

  if (now === null || hub === null) {
    return (
      <>
        <Caption left="Runcino · training" />
        <div className="stage">
          <Nav active="training" />
          <div className="body"><div style={{ minHeight: 320 }} aria-busy="true" /></div>
        </div>
      </>
    );
  }

  const races = hub.races;
  const upcoming = races.filter(r => daysUntil(r.meta.date) >= 0).sort((a, b) => daysUntil(a.meta.date) - daysUntil(b.meta.date));
  const goalRace = upcoming[0] ?? null;
  const runs = activities ? onlyRuns(activities) : null;

  // Hub.coach is structurally the same as the legacy CoachTodayResponse
  // — same shape /api/coach/today used to return. Cast it to the local
  // narrower view so the existing DailyBriefing component is unchanged.
  const coachToday = hub.coach as unknown as CoachTodayResponse;

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

          <DailyFeedbackTile now={now} runs={runs} />

          {runs && runs.length > 0 && <RecentWeeksTile runs={runs} />}

          {runs && runs.length > 0 && <QualityDayGridTile runs={runs} />}

        </div>
      </div>
    </>
  );
}

/* ── Quality day grid — 12-week heatmap of when quality landed ────
   Section 8b of the inventory. Each cell = one day. Columns = weeks
   (oldest left, current right). Rows = days of week (Mon top, Sun
   bottom). Cell color/intensity reflects what actually happened:
   quality (red), long (blue), easy (green), rest (dark). Lets the
   runner see their training rhythm at a glance — "I always skip
   Wednesday tempos when work is busy" patterns become visible. */
/* ── Daily feedback ──────────────────────────────────────────
   The "tell the coach how it actually felt" tile. Lives directly
   under the daily briefing on /training so the runner reads the
   prescription, runs (or doesn't), and immediately feeds back.
   Three flavors based on what the runner did vs what was prescribed:

   1. Prescription was a workout, runner ran → "How did it feel?"
   2. Prescription was rest, runner ran anyway → "Logged a run on
      a planned rest day — talk to me about it" (the case the user
      hit today: ran 7.4 mi when the engine had it as recovery)
   3. Prescription was rest, runner rested → "Resting today?"
      with a smaller "wasn't a true rest" affordance for honesty
      ("crossfit / hike / lifted heavy" → still useful signal). */
function DailyFeedbackTile({ now, runs }: { now: Date; runs: NormalizedActivity[] | null }) {
  const hub = useHub();
  if (!hub) return null;

  const todayISOStr = now.toISOString().slice(0, 10);
  const todayPres = hub.coach.today?.today ?? null;
  const presIsRest = todayPres?.type === 'rest';
  const todayRun = runs?.find(r => r.date === todayISOStr) ?? null;
  const ranToday = todayRun != null && todayRun.distanceMi > 0;
  const existing = hub.recentRpe.find(e => e.workoutDate === todayISOStr) ?? null;

  // Headline copy — context-driven so the prompt matches what the
  // runner just did, not a generic "rate today".
  const headline = (() => {
    if (presIsRest && ranToday) return 'You ran on a rest day — how did it feel?';
    if (presIsRest && !ranToday) return 'Resting today — anything to flag?';
    if (ranToday) return 'How did today\'s session feel?';
    return 'Run not logged yet — come back after';
  })();

  const sublede = (() => {
    if (presIsRest && ranToday) {
      return `You logged ${todayRun!.distanceMi.toFixed(1)} mi when the plan was rest. The coach reads this — if it felt easy, that\'s useful information; if it felt like work, that\'s a signal to honor tomorrow\'s rest fully.`;
    }
    if (presIsRest && !ranToday) {
      return 'Optional. If you cross-trained, slept poorly, or have anything else worth noting (weather, niggle, life stress), drop it in the notes — the coach reads it for tomorrow\'s context.';
    }
    if (ranToday) {
      return `${todayRun!.distanceMi.toFixed(1)} mi · ${formatPaceFromActivity(todayRun!)}/mi · ${todayRun!.avgHr ? `${todayRun.avgHr} bpm avg HR` : 'no HR data'}. Tap a number — RPE 1 (barely working) → 10 (max effort).`;
    }
    return 'Once you log a run on Strava, this card will give you a one-tap effort feedback slot.';
  })();

  // Border color reflects the situation:
  // - dashed warn when the runner ran on a rest day (the override case)
  // - dashed attention when there's no entry yet on a workout day
  // - solid when an entry already exists
  const borderStyle = existing ? 'solid' : 'dashed';
  const borderColor = existing
    ? 'var(--color-l4)'
    : (presIsRest && ranToday) ? 'var(--color-warning)'
    : ranToday ? 'var(--color-attention)'
    : 'var(--color-l4)';

  return (
    <div className="tile" style={{
      marginTop: 14, padding: '20px 24px',
      borderStyle, borderColor,
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{
          fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px',
          color: 'var(--color-attention)', fontWeight: 700, textTransform: 'uppercase',
        }}>
          Daily feedback
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--color-t0)', lineHeight: 1.25 }}>
          {headline}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-t2)', lineHeight: 1.55, marginTop: 4 }}>
          {sublede}
        </div>
      </div>

      {/* Show the rating slot whenever the runner ran today OR they
          want to leave a note on a rest day. Hide entirely if no
          run + no existing entry — they have nothing to feed back yet. */}
      {(ranToday || existing || presIsRest) && (
        <RpeInput workoutDate={todayISOStr} existing={existing} />
      )}
    </div>
  );
}

function formatPaceFromActivity(a: NormalizedActivity): string {
  const m = Math.floor(a.paceSPerMi / 60);
  const s = Math.round(a.paceSPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function QualityDayGridTile({ runs }: { runs: NormalizedActivity[] }) {
  // Build 12 weeks × 7 days grid. Today is the rightmost column,
  // bottom-aligned to the runner's own week (Mon-start).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Find this week's Monday
  const dow = today.getDay(); // 0=Sun, 1=Mon, ...
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const thisWeekMonday = new Date(today);
  thisWeekMonday.setDate(thisWeekMonday.getDate() + daysToMonday);

  const weeks: Array<{ start: Date; days: Array<{ date: string; activity: NormalizedActivity | null }> }> = [];
  for (let w = 11; w >= 0; w--) {
    const start = new Date(thisWeekMonday);
    start.setDate(start.getDate() - w * 7);
    const days: Array<{ date: string; activity: NormalizedActivity | null }> = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(day.getDate() + d);
      const dayISO = day.toISOString().slice(0, 10);
      const match = runs.find(r => r.date === dayISO) ?? null;
      days.push({ date: dayISO, activity: match });
    }
    weeks.push({ start, days });
  }

  function classify(a: NormalizedActivity | null, dayISO: string): { color: string; label: string } {
    if (dayISO > today.toISOString().slice(0, 10)) {
      return { color: 'var(--color-l2)', label: 'Future' };
    }
    if (!a) return { color: 'var(--color-l2)', label: 'Rest / no run' };
    // Workout type 3 = workout (Strava), 1 = race
    if (a.workoutType === 1) return { color: 'var(--color-warning)', label: 'Race' };
    if (a.workoutType === 3) return { color: 'var(--color-attention)', label: 'Quality workout' };
    if (/race|tempo|threshold|interval|repeat|fartlek/i.test(a.name)) return { color: 'var(--color-attention)', label: 'Quality (by name)' };
    if (a.distanceMi >= 12) return { color: 'var(--color-corporate)', label: 'Long run' };
    if (a.distanceMi >= 5) return { color: 'var(--color-success)', label: 'Easy run' };
    return { color: 'rgba(62,189,65,0.5)', label: 'Recovery / short' };
  }

  const dowLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div className="tile" style={{ marginTop: 10, padding: '18px 22px' }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Quality day grid</div>
          <div className="tile-lbl">12 weeks · pattern of what landed when</div>
        </div>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-corporate)' }}>
          RESEARCH/00b
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'flex-start' }}>
        {/* Day-of-week label column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 22 }}>
          {dowLabels.map((d, i) => (
            <div key={i} style={{
              fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, color: 'var(--color-t3)',
              width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* The grid */}
        <div style={{ display: 'flex', gap: 3, flex: 1 }}>
          {weeks.map((wk, wi) => {
            const isCurrent = wi === weeks.length - 1;
            return (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                <div style={{
                  fontFamily: 'var(--font-data)', fontSize: 8, fontWeight: 700, letterSpacing: '0.6px',
                  color: isCurrent ? 'var(--color-warning)' : 'var(--color-t3)',
                  textAlign: 'center', marginBottom: 3, height: 14,
                  textTransform: 'uppercase',
                }}>
                  {wk.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
                {wk.days.map((d, di) => {
                  const c = classify(d.activity, d.date);
                  return (
                    <div
                      key={di}
                      title={`${d.date} · ${c.label}${d.activity ? ` · ${d.activity.distanceMi.toFixed(1)} mi` : ''}`}
                      style={{
                        background: c.color,
                        borderRadius: 3,
                        height: 14,
                        cursor: 'pointer',
                        transition: 'transform 0.1s',
                        opacity: d.date > today.toISOString().slice(0, 10) ? 0.3 : 1,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14, paddingTop: 10,
        borderTop: '1px solid var(--color-l4)',
        fontFamily: 'var(--font-data)', fontSize: 9.5, color: 'var(--color-t3)',
        letterSpacing: '1.3px', textTransform: 'uppercase',
      }}>
        <Legend color="var(--color-warning)" label="Race" />
        <Legend color="var(--color-attention)" label="Quality" />
        <Legend color="var(--color-corporate)" label="Long" />
        <Legend color="var(--color-success)" label="Easy" />
        <Legend color="rgba(62,189,65,0.5)" label="Recovery" />
        <Legend color="var(--color-l2)" label="Rest" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 12, height: 8, background: color, borderRadius: 2 }} />
      <span>{label}</span>
    </div>
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

      {/* This week — each cell carries the day's full prescription:
          short type label + distance + pace (when prescribed). Today
          gets the solid-orange treatment. */}
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
            {weekStrip.map(d => <WeekCell key={d.date} day={d} />)}
          </div>
        </div>
      )}

      {/* Next up — each row stacks day · workout summary on top with a
          one-line description below. The description is the
          prescription's own write-up (already plain-English, e.g.
          "2-3 mi very easy · circulation, not adaptation"). */}
      {ahead.length > 0 && (
        <div>
          <div style={{
            fontFamily: 'var(--font-data)', fontSize: 10.5,
            color: 'var(--color-t3)', letterSpacing: '0.22em',
            textTransform: 'uppercase', fontWeight: 700, marginBottom: 14,
          }}>Next up</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {ahead.map((a, i) => (
              <NextUpRow key={a.date} day={a} isLast={i === ahead.length - 1} />
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

// ── Week strip cell + Next-up row ───────────────────────────────────

function WeekCell({ day }: { day: StripDay }) {
  const isToday = day.isToday;
  const isPast = !day.isFuture && !isToday;
  const isRest = day.plannedType === 'rest';

  // Resolved values:
  //   - past + actual ran   → show actual
  //   - today + actual ran  → show actual (the run that just happened
  //                           takes precedence over the prescription)
  //   - else                → show planned
  // distanceMi can be 0 (rest day) — that's a real value, not "missing".
  const ranActual = day.actualMi != null && day.actualMi > 0;
  const distance: number | null =
    (isPast || isToday) && ranActual
      ? day.actualMi
      : day.plannedMi;

  // When today's actual run shows up, label it "Done" so the cell
  // visibly reconciles with the run rather than continuing to render
  // the prescribed type ("Rest").
  const showLabel = isToday && ranActual
    ? 'Done'
    : day.plannedLabel ?? null;

  // Color logic — today = white on orange; rest = dim; everything else
  // gets the standard t0/t2 palette.
  const dayColor = isToday ? '#fff' : 'var(--color-t3)';
  const labelColor = isToday ? 'rgba(255,255,255,0.9)' : isRest ? 'var(--color-t3)' : 'var(--color-t1)';
  const distColor = isToday ? '#fff' : (distance != null && distance > 0) ? 'var(--color-t0)' : 'var(--color-t3)';
  const paceColor = isToday ? 'rgba(255,255,255,0.85)' : 'var(--color-t3)';

  return (
    <div style={{
      padding: '12px 8px', textAlign: 'center',
      background: isToday ? 'var(--color-race)' : 'var(--color-l1)',
      opacity: day.isFuture && !isToday && isRest ? 0.7 : 1,
      display: 'flex', flexDirection: 'column', gap: 6, minHeight: 96,
    }}>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 10,
        letterSpacing: '0.16em', fontWeight: 700, color: dayColor,
      }}>{day.dow}</div>

      {showLabel && (
        <div style={{
          fontFamily: 'var(--font-data)', fontSize: 10,
          color: labelColor, letterSpacing: '0.06em',
          textTransform: 'uppercase', fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{showLabel}</div>
      )}

      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 18,
        fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: distColor, lineHeight: 1.1,
      }}>
        {distance != null && distance > 0
          ? (distance >= 10 ? Math.round(distance) : distance.toFixed(1))
          : '·'}
      </div>

      {day.plannedPaceLabel && (
        <div style={{
          fontFamily: 'var(--font-data)', fontSize: 10,
          color: paceColor, fontVariantNumeric: 'tabular-nums',
        }}>{day.plannedPaceLabel}</div>
      )}
    </div>
  );
}

function NextUpRow({ day, isLast }: { day: WeekShapeDay; isLast: boolean }) {
  const dist = day.distanceMi > 0
    ? (day.distanceMi >= 10 ? Math.round(day.distanceMi) : day.distanceMi.toFixed(1))
    : null;
  const pace = day.paceTargetSPerMi
    ? `${fmtPace(day.paceTargetSPerMi.lowS)}–${fmtPace(day.paceTargetSPerMi.highS)}`
    : null;

  return (
    <div style={{
      padding: '14px 0',
      borderBottom: isLast ? 'none' : '1px solid var(--color-l4)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', gap: 12,
      }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', minWidth: 0, flex: 1 }}>
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 10.5,
            color: 'var(--color-t3)', letterSpacing: '0.16em',
            fontWeight: 700, textTransform: 'uppercase', width: 36, flexShrink: 0,
          }}>{dowShort(day.date)}</span>
          <span style={{
            fontSize: 14, color: 'var(--color-t0)', fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{day.label}</span>
        </div>
        <div style={{
          fontFamily: 'var(--font-data)', fontSize: 12,
          color: 'var(--color-t2)', fontVariantNumeric: 'tabular-nums',
          textAlign: 'right', flexShrink: 0,
        }}>
          {dist != null && <span>{dist} mi</span>}
          {dist != null && pace != null && <span style={{ color: 'var(--color-t3)' }}> · </span>}
          {pace != null && <span>{pace}/mi</span>}
          {dist == null && pace == null && <span>—</span>}
        </div>
      </div>
      {day.description && (
        <div style={{
          fontSize: 12.5, color: 'var(--color-t2)',
          lineHeight: 1.55, paddingLeft: 50,
        }}>
          {day.description}
        </div>
      )}
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
  plannedType: string | null;
  plannedLabel: string | null;
  plannedPaceLabel: string | null;
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
    const planned = planByDate.get(f.date) ?? null;
    return {
      date: f.date,
      dow: dows[i] ?? '',
      isToday: f.isToday,
      isFuture: f.isFuture,
      actualMi: f.miles > 0 ? f.miles : null,
      plannedMi: planned ? planned.distanceMi : null,
      plannedType: planned?.type ?? null,
      plannedLabel: planned ? shortStripLabel(planned) : null,
      plannedPaceLabel: planned?.paceTargetSPerMi
        ? `${fmtPace(planned.paceTargetSPerMi.lowS)}–${fmtPace(planned.paceTargetSPerMi.highS)}`
        : null,
    };
  });
}

/** Compact workout label for the 7-cell week strip. The full prescription
 *  label ("6 × 1 mile threshold") is too wide for ~120px columns; this
 *  trims to a 1-2 word category. */
function shortStripLabel(d: WeekShapeDay): string {
  const COMPACT: Record<string, string> = {
    rest: 'Rest',
    recovery: 'Recovery',
    general_aerobic: 'Easy',
    easy: 'Easy',
    medium_long: 'Medium-long',
    long_steady: 'Long',
    long_progression: 'Long · prog',
    long_mp_block: 'Long · MP',
    long_fast_finish: 'Long · FF',
    threshold: 'Threshold',
    threshold_intervals: 'Threshold',
    tempo_continuous: 'Tempo',
    sub_threshold: 'Sub-thr',
    vo2: 'VO2',
    marathon_specific: 'MP',
    marathon_specific_combo: 'MP',
    marathon_specific_long: 'MP',
    strides: 'Strides',
    hill_sprints: 'Hills',
    race: 'Race',
    shakeout: 'Shakeout',
    strides_appended: 'Easy + str',
  };
  return COMPACT[d.type] ?? d.label;
}

function dowShort(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
