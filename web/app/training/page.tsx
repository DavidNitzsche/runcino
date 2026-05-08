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

          {/* Plan-integrity validator output is in the response
              (hub.coach.today.planIssues) — read by the developer,
              NOT surfaced to the runner as a panel. The runner
              shouldn't see "your plan has 13 errors" as a front-page
              banner; the validator's job is to make engine bugs
              visible to me so I fix them, not to shake the runner's
              trust in the plan. Re-enable here when issues become
              runner-actionable (e.g. "your long run is too aggressive
              given recent training" → 1 plain-language line). */}

          <DailyBriefing
            now={now}
            data={coachToday}
            goalRace={goalRace}
            runs={runs}
          />

          <DailyFeedbackTile now={now} runs={runs} />

          {/* THIS WEEK — full day-cards (replaces the chip strip
              that used to live inside DailyBriefing). Answers
              "what's the rhythm of this week?" */}
          <ThisWeekSection now={now} runs={runs} hub={hub} />

          {/* NEXT 4 WEEKS — week-cards with theme + stats, click to
              expand the day-by-day. Answers "where am I going?" */}
          <NextFourWeeksSection now={now} hub={hub} goalRace={goalRace} />

          {/* Long-arc visual context — repositioned below the
              concrete plan above. Answers "the big picture." */}
          {runs && runs.length > 0 && <BuildCurveTile runs={runs} now={now} goalRace={goalRace} buildCurve={hub.coach.today?.buildCurve ?? []} />}

          {/* Pattern of what landed — retrospective. */}
          {runs && runs.length > 0 && <QualityDayGridTile runs={runs} />}

        </div>
      </div>
    </>
  );
}

/* ── PLAN INTEGRITY banner ──────────────────────────────────
   Surfaces validator issues from coach/plan-validator.ts when the
   engine generates a plan that violates doctrine rules
   (plan_integrity.ts). Errors show prominently; warnings show in
   a collapsed form. Each issue includes the doctrine citation so
   the runner sees WHY the rule exists. The banner is the primary
   visible mechanism that catches engine regressions automatically.
   Empty array = no issues = banner doesn't render. */
function PlanIntegrityBanner({ issues }: {
  issues: Array<{ rule: string; severity: 'error' | 'warn' | 'info'; message: string; location: string; doctrineCitation: string }>;
}) {
  if (!issues || issues.length === 0) return null;
  const errors = issues.filter(i => i.severity === 'error');
  const warns = issues.filter(i => i.severity === 'warn');
  const accent = errors.length > 0 ? 'var(--color-warning)' : 'var(--color-attention)';
  const bg = errors.length > 0 ? 'rgba(252, 77, 84, 0.08)' : 'rgba(243, 173, 59, 0.08)';
  const border = errors.length > 0 ? 'rgba(252, 77, 84, 0.30)' : 'rgba(243, 173, 59, 0.30)';
  return (
    <div className="tile" style={{
      marginBottom: 14, padding: '16px 20px',
      background: bg,
      borderLeftWidth: 3, borderLeftColor: accent, borderColor: border,
    }}>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px',
        color: accent, fontWeight: 800, textTransform: 'uppercase',
      }}>
        PLAN INTEGRITY · {errors.length} {errors.length === 1 ? 'ERROR' : 'ERRORS'}
        {warns.length > 0 ? ` · ${warns.length} WARN` : ''}
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...errors, ...warns].slice(0, 5).map((iss, i) => (
          <div key={i}>
            <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.5, fontWeight: 500 }}>
              {iss.message}
            </div>
            <div style={{
              fontFamily: 'var(--font-data)', fontSize: 9.5, color: 'var(--color-t3)',
              letterSpacing: '0.6px', marginTop: 3,
            }}>
              {iss.location} · {iss.doctrineCitation}
            </div>
          </div>
        ))}
      </div>
      <div style={{
        fontSize: 11, color: 'var(--color-t3)', marginTop: 12, lineHeight: 1.5,
        paddingTop: 10, borderTop: '1px solid var(--color-l4)', fontStyle: 'italic',
      }}>
        These warnings come from the plan-integrity validator (doctrine: plan_integrity.ts). They mean the engine produced a plan that violates a research-backed rule — surfacing instead of silently shipping a broken week.
      </div>
    </div>
  );
}

/* ── THIS WEEK section ──────────────────────────────────────
   Replaces the chip strip that used to live inside DailyBriefing.
   Renders Mon→Sun as 7 full day-cards with workout label, distance,
   estimated duration, pace target band, HR zone, one-line description,
   and done-mark + actual-vs-prescribed delta on past days. Today
   highlighted. Click any card → /workout/[date]. */
function ThisWeekSection({ now, runs, hub }: {
  now: Date;
  runs: NormalizedActivity[] | null;
  hub: import('../../lib/hub-types').RunnerHub;
}) {
  const todayISO = now.toISOString().slice(0, 10);
  const weekShape = hub.coach.today?.weekShape ?? [];
  if (weekShape.length !== 7) return null;

  // Build per-day actuals from Strava
  const actualByDate = new Map<string, NormalizedActivity>();
  if (runs) {
    for (const r of runs) {
      if (!actualByDate.has(r.date) || r.distanceMi > (actualByDate.get(r.date)?.distanceMi ?? 0)) {
        actualByDate.set(r.date, r);
      }
    }
  }

  const totalPlannedMi = weekShape.reduce((s, d) => s + d.distanceMi, 0);
  const totalActualMi = weekShape.reduce((s, d) => s + (actualByDate.get(d.date)?.distanceMi ?? 0), 0);
  const qualityCount = weekShape.filter(d => d.isQuality).length;
  const longCount = weekShape.filter(d => d.isLong).length;

  // Theme line — derived from phase + race recovery state
  const phase = hub.coach.today?.phase ?? null;
  const recentRace = hub.coach.state?.races?.recent?.[0];
  const inRecovery = recentRace && recentRace.daysAgo <= 14;
  const theme = (() => {
    if (inRecovery && recentRace) return `Recovery week — volume drop is by design (${recentRace.daysAgo}d post-${recentRace.name})`;
    if (phase === 'TAPER') return 'Taper week — protect freshness, no new fitness';
    if (phase === 'PEAK') return 'Peak block — the hardest training of the cycle';
    if (phase === 'BUILD') return 'Build phase — adding fitness through quality + volume';
    if (phase === 'BASE' || phase === 'BASE_MAINTENANCE') return 'Base block — frequent + easy, building the foundation';
    if (phase === 'POST_RACE') return 'Post-race recovery — reverse taper, no quality yet';
    if (phase === 'REBUILD') return 'Rebuild phase — gentle ramp back from break';
    return 'Standard training week';
  })();

  return (
    <div className="tile" style={{ marginTop: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="tile-sub">This week</div>
          <div className="tile-lbl">
            {weekRangeLabel(weekShape)} · {totalPlannedMi.toFixed(1)} mi · {qualityCount} quality · {longCount} long
          </div>
        </div>
        {totalActualMi > 0 && (
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 10.5, color: 'var(--color-t2)', letterSpacing: '1.2px', fontVariantNumeric: 'tabular-nums' }}>
            {totalPlannedMi > 0
              ? `${totalActualMi.toFixed(1)} MI LOGGED · ${Math.round((totalActualMi / totalPlannedMi) * 100)}% OF PLAN`
              : `${totalActualMi.toFixed(1)} MI LOGGED · ON A REST WEEK`}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-t2)', marginTop: 6, lineHeight: 1.5 }}>
        {theme}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8,
        marginTop: 16,
      }}>
        {weekShape.map(d => (
          <DayCard
            key={d.date}
            day={d}
            actual={actualByDate.get(d.date) ?? null}
            isToday={d.date === todayISO}
            isPast={d.date < todayISO}
          />
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-t3)', lineHeight: 1.5, fontStyle: 'italic' }}>
        Click any day → full workout detail · pace targets · structure · post-run RPE log.
      </div>
    </div>
  );
}

interface WeekShapeDayCard {
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
}

function DayCard({ day, actual, isToday, isPast }: {
  day: WeekShapeDayCard;
  actual: NormalizedActivity | null;
  isToday: boolean;
  isPast: boolean;
}) {
  const typeColor: Record<string, string> = {
    rest:                 'var(--color-t3)',
    recovery:             'var(--color-success)',
    general_aerobic:      'var(--color-success)',
    easy:                 'var(--color-success)',
    medium_long:          'var(--color-corporate)',
    long_steady:          'var(--color-corporate)',
    long_progression:     'var(--color-corporate)',
    long_mp_block:        'var(--color-attention)',
    long_fast_finish:     'var(--color-attention)',
    threshold_intervals:  'var(--color-attention)',
    tempo_continuous:     'var(--color-attention)',
    sub_threshold:        'var(--color-attention)',
    vo2:                  'var(--color-warning)',
    marathon_specific:    'var(--color-attention)',
    strides:              'var(--color-success)',
    hill_sprints:         'var(--color-warning)',
    shakeout:             'var(--color-success)',
    race:                 'var(--color-warning)',
  };
  const accent = typeColor[day.type] ?? 'var(--color-t2)';
  const dow = new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase();
  const dayNum = new Date(day.date + 'T12:00:00Z').getUTCDate();
  const estMin = day.distanceMi > 0 ? estimateDuration(day) : null;
  const paceLabel = day.paceTargetSPerMi
    ? `${formatPaceMin(day.paceTargetSPerMi.lowS)}–${formatPaceMin(day.paceTargetSPerMi.highS)}`
    : null;
  const ranOnRest = day.type === 'rest' && actual && actual.distanceMi > 0;
  const distMatch = actual && day.distanceMi > 0
    ? Math.abs(actual.distanceMi - day.distanceMi) / day.distanceMi
    : null;

  return (
    <Link
      href={`/workout/${day.date}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '12px 10px',
        background: isToday ? `linear-gradient(135deg, var(--color-l2) 0%, ${accent}15 100%)` : 'var(--color-l2)',
        borderRadius: 8,
        borderLeft: `3px solid ${isToday ? accent : 'var(--color-l4)'}`,
        opacity: isPast && !actual ? 0.5 : 1,
        textDecoration: 'none',
        minHeight: 140,
        position: 'relative',
        transition: 'background 0.12s',
      }}
    >
      {/* Day-of-week + date number */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: isToday ? accent : 'var(--color-t3)' }}>
          {dow}
        </span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: isToday ? 'var(--color-t0)' : 'var(--color-t2)' }}>
          {dayNum}
        </span>
      </div>

      {/* Workout label — color-coded */}
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
        color: 'var(--color-t0)', lineHeight: 1.2,
      }}>
        {day.label}
      </div>

      {/* Distance + duration */}
      {day.distanceMi > 0 ? (
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700, color: accent, fontVariantNumeric: 'tabular-nums' }}>
          {day.distanceMi.toFixed(1)} mi
          {estMin && <span style={{ color: 'var(--color-t3)', fontWeight: 400, marginLeft: 4 }}>· {Math.round(estMin)} min</span>}
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--color-t3)' }}>—</div>
      )}

      {/* Pace + HR */}
      {(paceLabel || day.hrZone) && (
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, color: 'var(--color-t3)', letterSpacing: '0.4px' }}>
          {paceLabel && <span>{paceLabel}/mi</span>}
          {paceLabel && day.hrZone != null && <span> · </span>}
          {day.hrZone != null && <span>Z{day.hrZone}</span>}
        </div>
      )}

      {/* Quality / long flag chips */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 'auto' }}>
        {day.isQuality && <span style={{ fontFamily: 'var(--font-data)', fontSize: 8, fontWeight: 700, letterSpacing: '0.8px', padding: '1px 4px', borderRadius: 2, background: 'rgba(243,173,59,0.18)', color: 'var(--color-attention)' }}>QUAL</span>}
        {day.isLong && <span style={{ fontFamily: 'var(--font-data)', fontSize: 8, fontWeight: 700, letterSpacing: '0.8px', padding: '1px 4px', borderRadius: 2, background: 'rgba(79,143,247,0.18)', color: 'var(--color-corporate)' }}>LONG</span>}
      </div>

      {/* Actual on past day — done-mark + delta */}
      {actual && (
        <div style={{
          paddingTop: 6, marginTop: 4, borderTop: '1px solid var(--color-l4)',
          fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ color: 'var(--color-success)', fontSize: 11 }}>✓</span>
            <span style={{ fontWeight: 700, color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums' }}>{actual.distanceMi.toFixed(1)} mi</span>
          </div>
          {ranOnRest && (
            <div style={{ fontSize: 9, color: 'var(--color-attention)', marginTop: 2 }}>
              ran on rest day
            </div>
          )}
          {!ranOnRest && distMatch != null && distMatch > 0.15 && (
            <div style={{ fontSize: 9, color: actual.distanceMi > day.distanceMi ? 'var(--color-corporate)' : 'var(--color-attention)', marginTop: 2 }}>
              {actual.distanceMi > day.distanceMi ? '+' : ''}{(actual.distanceMi - day.distanceMi).toFixed(1)} mi vs plan
            </div>
          )}
        </div>
      )}

      {/* Today indicator */}
      {isToday && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          width: 6, height: 6, borderRadius: '50%',
          background: accent,
        }} />
      )}
    </Link>
  );
}

/* ── NEXT 4 WEEKS section ───────────────────────────────────
   4 week-cards in a row with theme + total miles + quality count
   + long run + phase chip. Click any card → expand inline to show
   the 7-day breakdown for that week.

   Source: hub.coach.today.next30Days (the engine's 30-day forecast).
   Group into weeks starting from next Monday so the rendering aligns
   to calendar weeks. */
function NextFourWeeksSection({ now, hub, goalRace }: {
  now: Date;
  hub: import('../../lib/hub-types').RunnerHub;
  goalRace: SavedRace | null;
}) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const next30 = hub.coach.today?.next30Days ?? [];
  if (next30.length === 0) return null;

  const todayISO = today.toISOString().slice(0, 10);
  const dow = today.getDay();
  const daysToMonday = dow === 0 ? 1 : (8 - dow);
  const nextMonday = new Date(today);
  nextMonday.setDate(nextMonday.getDate() + daysToMonday);

  const byDate = new Map<string, typeof next30[number]>();
  for (const d of next30) byDate.set(d.date, d);

  // Build 4 weeks, each Mon→Sun, starting from nextMonday
  const weeks: Array<{
    start: Date;
    days: Array<{ date: string; entry: typeof next30[number] | null }>;
  }> = [];
  for (let w = 0; w < 4; w++) {
    const start = new Date(nextMonday);
    start.setDate(start.getDate() + w * 7);
    const days: Array<{ date: string; entry: typeof next30[number] | null }> = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(day.getDate() + d);
      const iso = day.toISOString().slice(0, 10);
      days.push({ date: iso, entry: byDate.get(iso) ?? null });
    }
    weeks.push({ start, days });
  }

  // Theme inference per week — uses the engine's current phase as
  // first signal, then race-week proximity, then per-week composition.
  // Each week of next30 inherits the engine's current phase (POST_RACE,
  // BUILD, etc) unless its own composition + days-from-goal say otherwise.
  const goalDateMs = goalRace ? Date.parse(goalRace.meta.date + 'T12:00:00Z') : null;
  const enginePhase = hub.coach.today?.phase ?? null;
  const recentRace = hub.coach.state?.races?.recent?.[0];
  const inPostRaceRecovery = recentRace && recentRace.daysAgo <= 14;
  function themeFor(week: typeof weeks[number], wIdx: number): { label: string; phase: string; color: string } {
    const totalMi = week.days.reduce((s, d) => s + (d.entry?.distanceMi ?? 0), 0);
    const restCount = week.days.filter(d => d.entry == null || d.entry.type === 'rest').length;
    const qualityCount = week.days.filter(d => d.entry?.isQuality).length;
    const hasRace = week.days.some(d => d.entry?.raceName != null);

    if (hasRace) return { label: 'Race week', phase: 'TAPER', color: 'var(--color-warning)' };

    // Race proximity wins when there's a goal race
    if (goalDateMs) {
      const daysFromGoal = Math.round((goalDateMs - week.start.getTime()) / 86_400_000);
      if (daysFromGoal >= 0 && daysFromGoal <= 7) return { label: 'Race week', phase: 'TAPER', color: 'var(--color-warning)' };
      if (daysFromGoal > 7 && daysFromGoal <= 21) return { label: 'Sharpening · race-specific work', phase: 'PEAK', color: 'var(--color-attention)' };
      if (daysFromGoal > 21 && daysFromGoal <= 56) return { label: qualityCount >= 2 ? 'Build · adding quality' : 'Build · volume foundation', phase: 'BUILD', color: 'var(--color-success)' };
    }

    // POST-RACE — runner is in active recovery. The first week or two
    // of next30 will show all-rest because the engine prescribes rest
    // through the recovery window. Honor that.
    if (inPostRaceRecovery && wIdx <= 1 && (restCount >= 5 || totalMi < 5)) {
      return { label: 'Recovery week · reverse taper', phase: 'POST_RACE', color: 'var(--color-corporate)' };
    }

    // Heuristic for everything else — cutback if miles drop sharply.
    // Skip during post-race recovery: any miles drop in the recovery
    // window is BY DESIGN (volume rebuild), not a cutback.
    const priorWk = wIdx > 0 ? weeks[wIdx - 1] : null;
    const priorMi = priorWk ? priorWk.days.reduce((s, d) => s + (d.entry?.distanceMi ?? 0), 0) : 0;
    if (priorWk && priorMi > 5 && totalMi < priorMi * 0.75 && !inPostRaceRecovery) {
      return { label: 'Cutback week', phase: 'BASE', color: 'var(--color-corporate)' };
    }

    // Use engine's current phase as the carry-forward when nothing else fires
    if (enginePhase === 'POST_RACE' || enginePhase === 'REBUILD') {
      return { label: enginePhase === 'POST_RACE' ? 'Returning to volume' : 'Rebuild phase', phase: enginePhase, color: 'var(--color-corporate)' };
    }
    if (enginePhase === 'BUILD') {
      return { label: qualityCount >= 1 ? 'Build · maintaining quality' : 'Build · volume foundation', phase: 'BUILD', color: 'var(--color-success)' };
    }
    if (enginePhase === 'PEAK') {
      return { label: 'Peak block · top-end work', phase: 'PEAK', color: 'var(--color-attention)' };
    }
    return { label: 'Steady aerobic build', phase: 'BASE', color: 'var(--color-t2)' };
  }

  return (
    <div className="tile" style={{ marginTop: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="tile-sub">Next 4 weeks</div>
          <div className="tile-lbl">
            {goalRace
              ? `${goalRace.meta.name} in ${Math.round((Date.parse(goalRace.meta.date) - today.getTime()) / 86_400_000)} days · the engine projects forward`
              : 'No goal race · projecting from current training state'}
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
        marginTop: 16,
      }}>
        {weeks.map((wk, i) => {
          const totalMi = wk.days.reduce((s, d) => s + (d.entry?.distanceMi ?? 0), 0);
          const qualityCount = wk.days.filter(d => d.entry?.isQuality).length;
          const longRunMi = Math.max(0, ...wk.days.filter(d => d.entry?.isLong).map(d => d.entry?.distanceMi ?? 0));
          const theme = themeFor(wk, i);
          const priorMi = i > 0 ? weeks[i - 1].days.reduce((s, d) => s + (d.entry?.distanceMi ?? 0), 0) : 0;
          const milesDelta = priorMi > 0 ? totalMi - priorMi : 0;

          return (
            <WeekCard
              key={i}
              week={wk}
              theme={theme}
              totalMi={totalMi}
              qualityCount={qualityCount}
              longRunMi={longRunMi}
              milesDelta={milesDelta}
              isFirst={i === 0}
              todayISO={todayISO}
            />
          );
        })}
      </div>
    </div>
  );
}

function WeekCard({ week, theme, totalMi, qualityCount, longRunMi, milesDelta, isFirst, todayISO }: {
  week: { start: Date; days: Array<{ date: string; entry: import('../../lib/coach-engine').CoachToday['next30Days'][number] | null }> };
  theme: { label: string; phase: string; color: string };
  totalMi: number;
  qualityCount: number;
  longRunMi: number;
  milesDelta: number;
  isFirst: boolean;
  todayISO: string;
}) {
  const [open, setOpen] = useState(false);
  const startLabel = week.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: '14px 14px',
      background: 'var(--color-l2)',
      borderRadius: 8,
      borderLeft: `3px solid ${theme.color}`,
      cursor: 'pointer',
      gridColumn: open ? '1 / -1' : 'auto',
      transition: 'border-color 0.12s',
    }} onClick={() => setOpen(o => !o)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>
          {isFirst ? 'NEXT WEEK' : `WEEK OF ${startLabel.toUpperCase()}`}
        </span>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1px', color: theme.color }}>
          {theme.phase}
        </span>
      </div>

      <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--color-t0)', lineHeight: 1.3 }}>
        {theme.label}
      </div>

      <div style={{ display: 'flex', gap: 12, fontFamily: 'var(--font-data)', fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--color-t1)' }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--color-t3)', letterSpacing: '0.6px' }}>TOTAL</div>
          <div style={{ fontWeight: 700 }}>
            {totalMi.toFixed(0)} mi
            {milesDelta !== 0 && (
              <span style={{ fontSize: 9, color: milesDelta > 0 ? 'var(--color-success)' : 'var(--color-t3)', marginLeft: 4 }}>
                {milesDelta > 0 ? '+' : ''}{milesDelta.toFixed(0)}
              </span>
            )}
          </div>
        </div>
        {qualityCount > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--color-t3)', letterSpacing: '0.6px' }}>QUALITY</div>
            <div style={{ fontWeight: 700 }}>{qualityCount}</div>
          </div>
        )}
        {longRunMi > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--color-t3)', letterSpacing: '0.6px' }}>LONG</div>
            <div style={{ fontWeight: 700 }}>{longRunMi.toFixed(0)} mi</div>
          </div>
        )}
      </div>

      {/* Click-to-expand caret */}
      <div style={{
        marginTop: 'auto', display: 'flex', justifyContent: 'flex-end',
        fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t3)',
      }}>
        {open ? '▾ HIDE DAYS' : '▸ EXPAND'}
      </div>

      {/* Expanded day-by-day breakdown */}
      {open && (
        <div onClick={e => e.stopPropagation()} style={{
          marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--color-l4)',
          display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6,
        }}>
          {week.days.map(d => {
            if (!d.entry) {
              return (
                <div key={d.date} style={{
                  padding: '8px 6px', background: 'var(--color-l3)', borderRadius: 4,
                  fontSize: 9, color: 'var(--color-t3)', textAlign: 'center', minHeight: 56,
                }}>
                  <div style={{ fontFamily: 'var(--font-data)', fontWeight: 700, letterSpacing: '0.6px' }}>
                    {new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase().slice(0, 1)}
                  </div>
                </div>
              );
            }
            const accent = d.entry.type === 'rest' ? 'var(--color-t3)'
              : d.entry.isQuality ? 'var(--color-attention)'
              : d.entry.isLong ? 'var(--color-corporate)'
              : 'var(--color-success)';
            const dow = new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase().slice(0, 1);
            return (
              <Link key={d.date} href={`/workout/${d.date}`} onClick={e => e.stopPropagation()} style={{
                display: 'flex', flexDirection: 'column', gap: 3,
                padding: '8px 6px', background: 'var(--color-l3)', borderRadius: 4,
                textDecoration: 'none', borderLeft: `2px solid ${accent}`,
                minHeight: 56,
              }}>
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', color: 'var(--color-t3)' }}>
                  {dow}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, color: 'var(--color-t0)', lineHeight: 1.2 }}>
                  {d.entry.label}
                </div>
                {d.entry.distanceMi > 0 && (
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, color: accent, fontVariantNumeric: 'tabular-nums' }}>
                    {d.entry.distanceMi.toFixed(1)}mi
                  </div>
                )}
                {d.entry.raceName && (
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 8, color: 'var(--color-warning)', letterSpacing: '0.6px' }}>
                    🏁 {d.entry.racePriority ?? 'A'}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helper: estimate workout duration from distance + pace ─────────
function estimateDuration(d: WeekShapeDayCard): number {
  if (d.distanceMi <= 0) return 0;
  if (d.paceTargetSPerMi) {
    const avg = (d.paceTargetSPerMi.lowS + d.paceTargetSPerMi.highS) / 2;
    return (d.distanceMi * avg) / 60;
  }
  // Fallback paces by intensity
  const fallbackSec = d.isQuality ? 450 : d.type === 'recovery' ? 600 : d.isLong ? 570 : 540;
  return (d.distanceMi * fallbackSec) / 60;
}

function formatPaceMin(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function weekRangeLabel(weekShape: Array<{ date: string }>): string {
  if (weekShape.length === 0) return '';
  const start = new Date(weekShape[0].date + 'T12:00:00Z');
  const end = new Date(weekShape[weekShape.length - 1].date + 'T12:00:00Z');
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(end)}`;
}

/* ── Quality day grid — 12-week heatmap of when quality landed ────
   Section 8b of the inventory. Each cell = one day. Columns = weeks
   (oldest left, current right). Rows = days of week (Mon top, Sun
   bottom). Cell color/intensity reflects what actually happened:
   quality (red), long (blue), easy (green), rest (dark). Lets the
   runner see their training rhythm at a glance — "I always skip
   Wednesday tempos when work is busy" patterns become visible. */
/* ── Build curve ─────────────────────────────────────────────
   16-week training arc visualization. Bars = actual weekly mileage
   for past weeks + projected for future weeks (the engine's
   week-shape distance prescription summed). Phase shading
   color-codes BASE / BUILD / PEAK / TAPER blocks based on the
   distance to the next A-race.

   The runner reads the macro shape: "I'm 6 weeks out, in PEAK
   block, last week was 32 mi, the curve is climbing on schedule."
   Hides if there's no next race (no taper math to anchor against). */
function BuildCurveTile({ runs, now, goalRace, buildCurve }: {
  runs: NormalizedActivity[];
  now: Date;
  goalRace: SavedRace | null;
  buildCurve: Array<{ weekStartISO: string; weekIndex: number; daysToRace: number; phase: string; totalMi: number; longRunMi: number; qualityCount: number; hasMpBlock: boolean; isRaceWeek: boolean }>;
}) {
  if (!goalRace) return null;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const raceDate = new Date(goalRace.meta.date + 'T12:00:00Z');
  const daysToRace = Math.round((raceDate.getTime() - today.getTime()) / 86_400_000);
  if (daysToRace < 0) return null;  // race already happened

  // 12 weeks past + N forward (from engine buildCurve)
  type WeekRow = {
    start: Date;
    weekISO: string;
    miles: number;
    longRunMi: number | null;
    qualityCount: number | null;
    isFuture: boolean;
    isRaceWeek: boolean;
    phase: 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'POST';
    isProjected: boolean;
  };
  const weeks: WeekRow[] = [];
  const dow = today.getDay();
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(today); thisMonday.setDate(thisMonday.getDate() + daysToMonday);

  // Build a lookup of engine-projected weeks by Monday-ISO so we can
  // splice real engine output into the future strip.
  const projectedByMonday = new Map(buildCurve.map(b => [b.weekStartISO, b]));

  // 12 weeks back + (engine projection length, capped 12 weeks fwd)
  const forwardWeeks = Math.min(12, Math.max(8, buildCurve.length));
  for (let w = -12; w <= forwardWeeks; w++) {
    const start = new Date(thisMonday);
    start.setDate(start.getDate() + w * 7);
    const weekEnd = new Date(start); weekEnd.setDate(weekEnd.getDate() + 7);
    const startISO = start.toISOString().slice(0, 10);
    const endISO = weekEnd.toISOString().slice(0, 10);
    const isFuture = start > today;
    const daysFromRace = Math.round((raceDate.getTime() - start.getTime()) / 86_400_000);
    const isRaceWeek = daysFromRace >= 0 && daysFromRace < 7;

    // Phase by distance-to-race (mirrors engine's raceSubPhase):
    const phase: 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'POST' = (() => {
      if (daysFromRace < 0) return 'POST';
      if (daysFromRace <= 7) return 'TAPER';
      if (daysFromRace <= 21) return 'PEAK';
      if (daysFromRace <= 56) return 'BUILD';
      return 'BASE';
    })();

    // Past weeks: real activity miles. Future weeks: prefer engine
    // projection if available; fall back to last-4-week trailing.
    if (!isFuture) {
      const weekMi = runs
        .filter(r => r.date >= startISO && r.date < endISO)
        .reduce((s, r) => s + r.distanceMi, 0);
      weeks.push({
        start, weekISO: startISO, miles: weekMi, longRunMi: null, qualityCount: null,
        isFuture: false, isRaceWeek, phase, isProjected: false,
      });
    } else {
      const proj = projectedByMonday.get(startISO);
      if (proj) {
        weeks.push({
          start, weekISO: startISO, miles: proj.totalMi,
          longRunMi: proj.longRunMi, qualityCount: proj.qualityCount,
          isFuture: true, isRaceWeek: proj.isRaceWeek || isRaceWeek, phase, isProjected: true,
        });
      } else {
        weeks.push({
          start, weekISO: startISO, miles: 0, longRunMi: null, qualityCount: null,
          isFuture: true, isRaceWeek, phase, isProjected: false,
        });
      }
    }
  }

  const max = Math.max(...weeks.map(w => w.miles), 1);
  const last4Avg = (() => {
    const past4 = weeks.filter(w => !w.isFuture).slice(-4);
    return past4.length > 0 ? past4.reduce((s, w) => s + w.miles, 0) / past4.length : 0;
  })();
  // Peak projected week — for the "you'll be at X mpw at peak" callout.
  // Picks the LAST week tied for max mileage (closest to the race), so a
  // flat plateau labels the latest week as "peak" rather than the
  // earliest. Also surfaces whether the engine's curve is actually
  // ramping (true peak) or just flat (engine prescribes peak-week
  // pattern across all build weeks — a known engine limitation).
  const futureProjected = weeks.filter(w => w.isFuture && w.isProjected);
  const maxMi = futureProjected.reduce((m, w) => Math.max(m, w.miles), 0);
  const peakProjected = [...futureProjected].reverse().find(w => w.miles === maxMi) ?? null;
  // Curve is "flat" when ≥3 consecutive future weeks all hit max
  // mileage — that's a sign the engine isn't progressively ramping.
  const flatPlateauCount = peakProjected
    ? futureProjected.filter(w => w.miles >= maxMi * 0.95).length
    : 0;
  const isFlatCurve = flatPlateauCount >= 3;

  const phaseColor: Record<typeof weeks[number]['phase'], string> = {
    BASE:  'rgba(120, 120, 120, 0.10)',
    BUILD: 'rgba(62, 189, 65, 0.10)',
    PEAK:  'rgba(243, 173, 59, 0.14)',
    TAPER: 'rgba(252, 77, 84, 0.16)',
    POST:  'rgba(120, 120, 120, 0.06)',
  };
  const phaseAccent: Record<typeof weeks[number]['phase'], string> = {
    BASE:  'var(--color-t3)',
    BUILD: 'var(--color-success)',
    PEAK:  'var(--color-attention)',
    TAPER: 'var(--color-warning)',
    POST:  'var(--color-t3)',
  };

  return (
    <div className="tile" style={{ marginTop: 10, padding: '20px 24px' }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Build curve</div>
          <div className="tile-lbl">{daysToRace} days to {goalRace.meta.name} · 12 weeks back, 8 forward</div>
        </div>
      </div>

      {/* Bar chart */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 140, marginTop: 16, position: 'relative' }}>
        {weeks.map((w, i) => {
          // Future weeks now use the engine projection (real per-day
          // simulation rolled to weekly totals). Falls back to last-4-
          // week trailing avg only if the engine projection didn't
          // cover this week (rare — happens beyond the 14-week cap).
          const heightMi = !w.isFuture
            ? w.miles
            : (w.isProjected ? w.miles : (last4Avg > 0 ? last4Avg : 0));
          const heightPct = heightMi > 0 ? (heightMi / max) * 100 : 0;
          const color = phaseAccent[w.phase];
          const tooltip = w.isFuture
            ? (w.isProjected
                ? `${w.weekISO} · ${heightMi.toFixed(1)} mi projected · ${w.phase}${w.longRunMi ? ` · long ${w.longRunMi.toFixed(1)} mi` : ''}${w.qualityCount ? ` · ${w.qualityCount} quality` : ''}`
                : `${w.weekISO} · ~${heightMi.toFixed(0)} mi (last-4-wk fallback) · ${w.phase}`)
            : `${w.weekISO} · ${w.miles.toFixed(1)} mi · ${w.phase}`;
          return (
            <div key={i} style={{
              flex: 1, height: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
              position: 'relative',
              background: phaseColor[w.phase],
              borderRadius: 3,
              outline: w.isRaceWeek ? '2px solid var(--color-warning)' : 'none',
            }}>
              {heightMi > 0 && (
                <div style={{
                  width: '70%',
                  height: `${heightPct}%`,
                  // Future weeks: dashed-border outline if engine-projected,
                  // dotted if fallback. Solid for past actual.
                  background: w.isFuture ? `${color}55` : color,
                  border: w.isFuture
                    ? (w.isProjected ? `2px dashed ${color}` : `1px dotted ${color}`)
                    : 'none',
                  borderRadius: 2,
                  boxSizing: 'border-box',
                }} title={tooltip} />
              )}
            </div>
          );
        })}
      </div>

      {/* Week-start labels (every 4 weeks) */}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {weeks.map((w, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center',
            fontFamily: 'var(--font-data)', fontSize: 8, color: 'var(--color-t3)',
            letterSpacing: '0.6px', textTransform: 'uppercase',
            visibility: i % 4 === 0 || w.isRaceWeek ? 'visible' : 'hidden',
          }}>
            {w.isRaceWeek ? 'RACE' : w.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        ))}
      </div>

      {/* Phase legend */}
      <div style={{
        display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14, paddingTop: 10,
        borderTop: '1px solid var(--color-l4)',
        fontFamily: 'var(--font-data)', fontSize: 9.5, color: 'var(--color-t3)',
        letterSpacing: '1.3px', textTransform: 'uppercase',
      }}>
        <PhaseLegend bg="rgba(120, 120, 120, 0.10)" accent="var(--color-t3)" label="Base" />
        <PhaseLegend bg="rgba(62, 189, 65, 0.10)" accent="var(--color-success)" label="Build" />
        <PhaseLegend bg="rgba(243, 173, 59, 0.14)" accent="var(--color-attention)" label="Peak" />
        <PhaseLegend bg="rgba(252, 77, 84, 0.16)" accent="var(--color-warning)" label="Taper" />
      </div>

      {peakProjected && (
        <div style={{
          marginTop: 12, padding: '10px 12px',
          background: 'rgba(243, 173, 59, 0.08)',
          border: '1px solid rgba(243, 173, 59, 0.20)',
          borderRadius: 6,
          fontSize: 12.5, color: 'var(--color-t1)', lineHeight: 1.55,
        }}>
          {isFlatCurve ? (
            <>
              Engine projects build weeks at <strong style={{ color: 'var(--color-attention)' }}>~{peakProjected.miles.toFixed(0)} mi</strong>
              {peakProjected.longRunMi ? ` with a ${peakProjected.longRunMi.toFixed(0)}-mile long run` : ''} through the build window. <em>(Real Pfitz/Daniels plans ramp toward peak; Runcino's progressive ramp is a known engine gap — work in progress.)</em>
            </>
          ) : (
            <>
              Engine projects peak week at <strong style={{ color: 'var(--color-attention)' }}>{peakProjected.miles.toFixed(0)} mi</strong>{peakProjected.longRunMi ? ` with a ${peakProjected.longRunMi.toFixed(0)}-mile long run` : ''} — {Math.max(0, Math.round((raceDate.getTime() - peakProjected.start.getTime()) / 86_400_000))} days out from {goalRace.meta.name}.
            </>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 8, lineHeight: 1.5, fontStyle: 'italic' }}>
        Past weeks solid; future weeks dashed are engine-projected (per-day simulation rolled up). Hover for details.
      </div>
    </div>
  );
}

function PhaseLegend({ bg, accent, label }: { bg: string; accent: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 14, height: 8, background: bg, borderLeft: `2px solid ${accent}`, borderRadius: 2 }} />
      <span>{label}</span>
    </div>
  );
}

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
  const daysOut = goalRace ? daysUntil(goalRace.meta.date) : null;
  // weekStrip + nextUp logic moved to ThisWeekSection / NextFourWeeksSection
  // below the briefing. Hero stays focused on TODAY only.

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

      {/* THIS WEEK chip strip + NEXT UP list moved out of the
          DailyBriefing and into the dedicated ThisWeekSection /
          NextFourWeeksSection rendered below. The hero now stays
          focused on TODAY only — title, voice, stats, goal sidebar. */}
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
