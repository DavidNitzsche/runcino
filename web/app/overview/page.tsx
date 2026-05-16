'use client';

/**
 * /overview · v4 redesign (simplified).
 *
 * Three sections, top to bottom:
 *   1. CoachStrip — coach briefing left, today's check-in right.
 *   2. HeroCard   — workout title + stats + segments + actions LEFT,
 *                   readiness ring + fitness signals + intensity RIGHT.
 *   3. WeekStripCard — week header + 7-day strip + view-full link.
 *
 * Everything below was deliberately stripped from the v4 redesign —
 * the previous KPI band, PathToRace card, NextPush card, biometric
 * sparks, body systems, pace zones, VDOT card, load gauge, weekly
 * miles, long run, B-race, year heatmap, and YTD rings. Those
 * signals get rehomed when /training, /races, and /health get their
 * own v4 mockups.
 *
 * Data loading is unchanged — loadOverviewData / useActivities still
 * power everything. Only the rendering shape moved.
 */

import { useEffect, useState } from 'react';
import { Topbar, Stage, EmptyState, Skeleton } from '@/app/components';
import {
  CoachStrip,
  HeroCard,
  WeekStripCard,
  WorkoutDetailModal,
  ScheduleModal,
  type WeekDay,
  type SegmentRow,
  type FitnessSignal,
  type ReadinessLevel,
  type SchedulePhase,
} from '@/app/components/v4';
import { useActivities } from '@/lib/strava-activities';
import { loadOverviewData, type OverviewData } from './data';

export default function OverviewPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { activities, fetchedAt } = useActivities();
  const stravaFetchedAtMs = fetchedAt ? Date.parse(fetchedAt) : null;

  // Local UI state — modals + the optimistic skip flag. Skip persists
  // through GET /api/plan/skip on initial load.
  const [workoutModalOpen, setWorkoutModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [skipped, setSkipped] = useState<boolean>(false);

  useEffect(() => { setNow(new Date()); }, []);

  useEffect(() => {
    if (!now) return;
    let cancelled = false;
    setLoadError(null);
    loadOverviewData(activities, stravaFetchedAtMs)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => { cancelled = true; };
  }, [now, activities, stravaFetchedAtMs]);

  // Load today's skip state from the server so refreshing the page
  // doesn't lose it. POST goes back through the API.
  useEffect(() => {
    fetch('/api/plan/skip').then((r) => r.json()).then((j) => {
      if (j?.ok && j.skip) setSkipped(true);
    }).catch(() => {});
  }, []);

  const clock = now ? formatTopbarClock(now) : null;

  return (
    <Stage>
      <Topbar
        activeTab="overview"
        clock={clock !== null ? clock : <Skeleton width={140} height={12} />}
      />

      {loadError && (
        <EmptyState variant="error" title="Couldn&rsquo;t load Overview" body={loadError} />
      )}

      {data ? (
        <V4Body
          data={data}
          skipped={skipped}
          onSkipToggle={async (next) => {
            // Optimistic — flip the UI immediately, then sync DB.
            setSkipped(next);
            try {
              if (next) {
                const planToday = data.planWeekWorkouts?.find((w) => w.dateISO === data.today) ?? null;
                await fetch('/api/plan/skip', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    plannedWorkoutType: planToday?.type ?? data.coach.workout.answer.label ?? null,
                    plannedMi: planToday?.distanceMi ?? data.coach.workout.answer.distanceMi ?? null,
                  }),
                });
              } else {
                await fetch('/api/plan/skip', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ undo: true }),
                });
              }
            } catch {
              // If the network failed, revert.
              setSkipped(!next);
            }
          }}
          onOpenWorkout={() => setWorkoutModalOpen(true)}
          onOpenSchedule={() => setScheduleModalOpen(true)}
          workoutModalOpen={workoutModalOpen}
          onCloseWorkoutModal={() => setWorkoutModalOpen(false)}
          scheduleModalOpen={scheduleModalOpen}
          onCloseScheduleModal={() => setScheduleModalOpen(false)}
        />
      ) : (
        !loadError && <OverviewSkeleton />
      )}
    </Stage>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body — three sections + modals
// ─────────────────────────────────────────────────────────────────────

interface V4BodyProps {
  data: OverviewData;
  skipped: boolean;
  onSkipToggle: (next: boolean) => void;
  onOpenWorkout: () => void;
  onOpenSchedule: () => void;
  workoutModalOpen: boolean;
  onCloseWorkoutModal: () => void;
  scheduleModalOpen: boolean;
  onCloseScheduleModal: () => void;
}

function V4Body({
  data,
  skipped,
  onSkipToggle,
  onOpenWorkout,
  onOpenSchedule,
  workoutModalOpen,
  onCloseWorkoutModal,
  scheduleModalOpen,
  onCloseScheduleModal,
}: V4BodyProps) {
  const briefing = composeBriefing(data);
  const heroProps = composeHero(data);
  const weekProps = composeWeek(data, onOpenSchedule);
  const schedulePhases = composeSchedule(data);
  const raceMeta = composeRaceMeta(data);

  return (
    <>
      <CoachStrip label={briefing.label} briefing={briefing.text} />

      <HeroCard
        {...heroProps}
        skipped={skipped}
        onSkipToggle={onSkipToggle}
        onOpenWorkout={onOpenWorkout}
      />

      <WeekStripCard {...weekProps} />

      <WorkoutDetailModal
        open={workoutModalOpen}
        onClose={onCloseWorkoutModal}
        eyebrow={heroProps.eyebrow}
        title={heroProps.title}
        stats={heroProps.stats}
        segments={heroProps.segments}
        intensityPct={heroProps.intensityPct}
        intensityZone={heroProps.intensityZone}
        intensityNote={heroProps.intensityNote}
        onMarkComplete={() => {
          onCloseWorkoutModal();
          // TODO: wire to a "mark complete" endpoint when planned ↔ Strava
          // matching lands.
        }}
        onSkip={() => {
          onCloseWorkoutModal();
          onSkipToggle(!skipped);
        }}
      />

      <ScheduleModal
        open={scheduleModalOpen}
        onClose={onCloseScheduleModal}
        raceMeta={raceMeta}
        phases={schedulePhases}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Composition helpers — pull real data → v4 primitive props
// ─────────────────────────────────────────────────────────────────────

function composeBriefing(data: OverviewData): { label: string; text: string } {
  if (data.briefing) {
    return { label: data.briefing.label, text: data.briefing.text };
  }
  // Fallback: profile greeting + workout voice lead if briefing is null.
  const lead = data.coach.workout.answer.voiceLead ?? '';
  return {
    label: `COACH · ${todayLabel(data.today)}`,
    text: lead || `${data.profile.greeting}, ${data.profile.name}.`,
  };
}

interface HeroProps {
  eyebrow: string;
  title: string;
  stats: HeroStatPills;
  segments: SegmentRow[];
  readinessScore: number | null;
  readinessLevel: ReadinessLevel;
  readinessBadge: string;
  readinessCaption: string;
  signals: FitnessSignal[];
  intensityPct: number;
  intensityZone: string;
  intensityNote?: string;
  hasStrength: boolean;
}

interface HeroStatPills {
  distanceMi: number | null;
  paceSecPerMi: number | null;
  durationMin: number | null;
  hrCapBpm: number | null;
}

function composeHero(data: OverviewData): HeroProps {
  const phase = data.planCurrentPhase ?? data.coach.workout.answer.phaseLabel ?? null;
  const eyebrow = `TODAY${phase ? ` · ${phase.toUpperCase()}` : ''}`;

  const workout = data.coach.workout.answer;
  const planToday = data.planWeekWorkouts?.find((w) => w.dateISO === data.today) ?? null;
  const distanceMi = planToday?.distanceMi ?? workout.distanceMi ?? null;
  const paceMid = workout.paceTargetSPerMi
    ? (workout.paceTargetSPerMi.lower + workout.paceTargetSPerMi.upper) / 2
    : null;
  const durationMin = paceMid != null && distanceMi != null
    ? Math.round((paceMid * distanceMi) / 60)
    : null;
  // WorkoutPrescription doesn't expose a hard HR cap yet — pull it from
  // the runner's max-HR if available, otherwise omit the stat pill.
  const hrCapBpm: number | null = null;

  const segments: SegmentRow[] = (data.workoutStructure ?? []).map((b) => ({
    label: b.name.split('·')[0].trim().toUpperCase(),
    duration: b.timeOffset || '—',
    distance: b.distance || '—',
    pace: b.pace || '—',
    isMain: b.isMain,
  }));

  const readiness = data.coach.readiness.answer;
  const readinessScore =
    readiness.level === 'green' ? 88 :
    readiness.level === 'yellow' ? 62 :
    40;
  const readinessBadge =
    readiness.level === 'green' ? 'Ready' :
    readiness.level === 'yellow' ? 'Holding' :
    'Watching';
  const readinessCaption =
    readiness.level === 'green' ? 'Building' :
    readiness.level === 'yellow' ? 'Holding steady' :
    'Recovery focus';

  const signals = composeSignals(data);
  const intensityPct = computeIntensityPct(workout.label);
  const intensityZone = zoneNameFor(workout.label);
  // voiceLead is the verbatim coach paragraph for this workout; perfect
  // as the italic note under the intensity bar.
  const intensityNote = workout.voiceLead || undefined;

  return {
    eyebrow,
    title: titleFor(workout.label),
    stats: { distanceMi, paceSecPerMi: paceMid, durationMin, hrCapBpm },
    segments,
    readinessScore,
    readinessLevel: readiness.level,
    readinessBadge,
    readinessCaption,
    signals,
    intensityPct,
    intensityZone,
    intensityNote,
    hasStrength: planToday?.hasStrength === true,
  };
}

function composeSignals(data: OverviewData): FitnessSignal[] {
  const week = data.coach.weekDeltas.answer;
  const readiness = data.coach.readiness.answer;
  const acwr = readiness.acwr;
  const easyShare = readiness.easyShare;

  const signals: FitnessSignal[] = [];

  // Effort — net delta on the week vs plan, scaled.
  const effortDelta = week.netDeltaMi;
  signals.push({
    label: 'Effort',
    value: formatSigned(effortDelta, 2),
    fillPct: clampPct(50 + effortDelta * 10),
    tone: effortDelta > 0.5 ? 'green' : effortDelta < -0.5 ? 'warn' : 'dim',
  });

  // Load — ACWR.
  if (acwr != null) {
    signals.push({
      label: 'Load',
      value: acwr.toFixed(2),
      fillPct: clampPct(acwr * 50),
      tone: acwr >= 0.8 && acwr <= 1.3 ? 'green' : acwr > 1.3 ? 'amber' : 'dim',
    });
  } else {
    signals.push({ label: 'Load', value: '—', fillPct: 0, tone: 'dim' });
  }

  // Mileage — 4w vs prior 4w delta.
  const mDelta = data.state.volume.deltaPct4v4;
  signals.push({
    label: 'Mileage',
    value: mDelta != null ? `${mDelta >= 0 ? '+' : ''}${(mDelta * 100).toFixed(0)}%` : '—',
    fillPct: mDelta != null ? clampPct(50 + mDelta * 200) : 0,
    tone: mDelta != null ? (mDelta > 0 ? 'green' : mDelta < -0.1 ? 'warn' : 'dim') : 'dim',
  });

  // Easy Pace — easy share of the last 14 days.
  if (easyShare != null) {
    signals.push({
      label: 'Easy Share',
      value: `${Math.round(easyShare * 100)}%`,
      fillPct: clampPct(easyShare * 100),
      tone: easyShare >= 0.8 ? 'green' : easyShare >= 0.7 ? 'amber' : 'warn',
    });
  } else {
    signals.push({ label: 'Easy Share', value: '—', fillPct: 0, tone: 'dim' });
  }

  // Strain — placeholder until HealthKit lands. Render dim.
  signals.push({ label: 'Strain', value: '—', fillPct: 0, tone: 'dim' });

  return signals;
}

function composeWeek(data: OverviewData, onOpenSchedule: () => void) {
  const week = data.coach.weekDeltas.answer;
  const phase = data.planCurrentPhase ?? data.coach.workout.answer.phaseLabel ?? 'This Week';

  // Build the 7-day strip from data.planWeekWorkouts + week.days for
  // actual mileage. planWeekWorkouts is already keyed Mon→Sun.
  const days: WeekDay[] = (data.planWeekWorkouts ?? []).slice(0, 7).map((w) => {
    const d = new Date(w.dateISO + 'T12:00:00Z');
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const actual = week.days.find((dd) => dd.dateISO === w.dateISO);
    const hasActual = actual?.actualMi != null && actual.actualMi > 0;
    const isToday = w.dateISO === data.today;
    const isRest = w.type === 'rest' || w.distanceMi === 0;
    const status: WeekDay['status'] =
      isToday ? 'today' :
      hasActual ? 'done' :
      isRest ? 'rest' : 'planned';

    return {
      dow,
      dateNum: String(d.getUTCDate()),
      workoutName: workoutDisplayName(w.type),
      distance: isRest ? '' : `${w.distanceMi.toFixed(1)} mi`,
      status,
      hasStrength: w.hasStrength === true,
    };
  });

  // If planWeekWorkouts is empty (no plan yet), build empty 7 columns
  // so the strip still renders.
  while (days.length < 7) {
    days.push({ dow: '—', dateNum: '—', workoutName: '—', distance: '', status: 'rest' });
  }

  const loggedMi = week.loggedWeekMi || null;
  const plannedMi = week.plannedWeekMi || null;
  const loggedWorkouts = days.filter((d) => d.status === 'done').length;
  const totalWorkouts = days.filter((d) => d.status !== 'rest').length;

  const delta = week.netDeltaMi;
  const deltaLabel =
    delta > 0.5 ? `Projecting +${delta.toFixed(1)} over plan` :
    delta < -0.5 ? `Projecting ${delta.toFixed(1)} under plan` :
    'On plan';
  const deltaTone: 'green' | 'amber' | 'warn' | 'dim' =
    delta > 0.5 ? 'green' :
    delta < -0.5 ? 'warn' :
    'dim';

  const progressPct = plannedMi != null && plannedMi > 0
    ? clampPct((loggedMi ?? 0) / plannedMi * 100)
    : 0;

  return {
    eyebrow: 'This Week',
    title: phase,
    loggedMi,
    plannedMi,
    loggedWorkouts,
    totalWorkouts,
    deltaLabel,
    deltaTone,
    progressPct,
    days,
    onViewFullSchedule: onOpenSchedule,
  };
}

function composeSchedule(data: OverviewData): SchedulePhase[] {
  // For now, build a single-phase schedule using planWeekWorkouts +
  // planFutureLongRuns to communicate at least the next few weeks. When
  // /api/plan/active exposes the full Plan artifact end-to-end, this
  // becomes a richer multi-phase view grouped by Plan.phases.
  if (!data.planWeekWorkouts || data.planWeekWorkouts.length === 0) return [];

  // Group by ISO week start (Mon). For each, compute the week label
  // and roll up miles + a brief workout description.
  const weeksByMon = new Map<string, {
    miles: number;
    descParts: string[];
    hasToday: boolean;
    hasUnloggedToday: boolean;
  }>();

  for (const w of data.planWeekWorkouts) {
    const d = new Date(w.dateISO + 'T12:00:00Z');
    // Compute Monday of that week (dow 1).
    const dow = d.getUTCDay();
    const monOffset = dow === 0 ? -6 : 1 - dow;
    d.setUTCDate(d.getUTCDate() + monOffset);
    const monISO = d.toISOString().slice(0, 10);
    const entry = weeksByMon.get(monISO) ?? {
      miles: 0,
      descParts: [],
      hasToday: false,
      hasUnloggedToday: false,
    };
    entry.miles += w.distanceMi;
    if (w.type !== 'rest' && w.distanceMi > 0) {
      entry.descParts.push(workoutDisplayName(w.type));
    }
    if (w.dateISO === data.today) entry.hasToday = true;
    weeksByMon.set(monISO, entry);
  }

  const weeks = Array.from(weeksByMon.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([monISO, agg], idx) => {
      const m = new Date(monISO + 'T12:00:00Z');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateLabel = `${monthNames[m.getUTCMonth()]} ${m.getUTCDate()}`;
      const status: 'done' | 'current' | 'upcoming' =
        agg.hasToday ? 'current' :
        monISO < data.today ? 'done' :
        'upcoming';
      return {
        weekNum: idx + 1,
        dateLabel,
        miles: agg.miles,
        description: agg.descParts.slice(0, 5).join(' · ') || '—',
        status,
      };
    });

  return [
    { label: data.planCurrentPhase ? `${data.planCurrentPhase} Phase` : 'Plan', weeks },
  ];
}

function composeRaceMeta(data: OverviewData): string {
  const nextA = data.races.nextA;
  if (!nextA) return 'No A-race set';
  const m = nextA.meta.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return nextA.meta.name;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${nextA.meta.name} · ${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────

function clampPct(v: number): number { return Math.max(0, Math.min(100, v)); }

function formatSigned(v: number, dp: number): string {
  const s = v.toFixed(dp);
  return v >= 0 ? `+${s}` : s;
}

function titleFor(label: string): string {
  // Map workout label to the big Bebas Neue title — split 2-word labels
  // across two lines per the v4 mockup ("EASY\nRUN", "LONG\nRUN", etc.).
  const upper = label.toUpperCase();
  if (upper.length <= 6) return upper;
  // Find the first space and split there.
  const idx = upper.indexOf(' ');
  if (idx < 0) return upper;
  return `${upper.slice(0, idx)}\n${upper.slice(idx + 1)}`;
}

function workoutDisplayName(type: string): string {
  switch (type) {
    case 'easy': return 'Easy Run';
    case 'long': return 'Long Run';
    case 'long_steady': return 'Long Run';
    case 'long_progression': return 'Long Progression';
    case 'long_mp_block': return 'Long MP';
    case 'threshold': return 'Threshold';
    case 'threshold_intervals': return 'Threshold';
    case 'tempo': return 'Tempo';
    case 'interval': return 'Intervals';
    case 'intervals': return 'Intervals';
    case 'medium_long': return 'Medium Long';
    case 'marathon_specific': return 'MP Workout';
    case 'recovery': return 'Recovery';
    case 'strides': return 'Strides';
    case 'race': return 'Race';
    case 'rest': return 'Rest';
    case 'general_aerobic': return 'Easy Run';
    default: return 'Easy Run';
  }
}

function zoneNameFor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('easy') || l.includes('recovery') || l.includes('general')) return 'Easy · Zone 2';
  if (l.includes('threshold') || l.includes('tempo')) return 'Threshold · Zone 4';
  if (l.includes('interval')) return 'VO2max · Zone 5';
  if (l.includes('long')) return 'Aerobic · Zone 2';
  if (l.includes('race')) return 'Race · Zone 5';
  if (l.includes('rest')) return 'Rest';
  return 'Easy · Zone 2';
}

function computeIntensityPct(label: string): number {
  const l = label.toLowerCase();
  if (l.includes('rest')) return 0;
  if (l.includes('recovery')) return 12;
  if (l.includes('easy') || l.includes('general')) return 22;
  if (l.includes('long')) return 35;
  if (l.includes('tempo')) return 55;
  if (l.includes('threshold')) return 65;
  if (l.includes('interval')) return 82;
  if (l.includes('race')) return 95;
  return 22;
}

function todayLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const d = new Date(iso + 'T12:00:00Z');
  const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()];
  return `${dow} ${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function formatTopbarClock(d: Date): React.ReactNode {
  const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const date = `${months[d.getMonth()]} ${d.getDate()}`;
  const h = d.getHours();
  const m = d.getMinutes();
  const am = h < 12;
  const dispH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const time = `${dispH}:${m.toString().padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
  return <>{dow} · {date} · <b>{time}</b></>;
}

function OverviewSkeleton() {
  return (
    <div style={{ marginTop: 24 }}>
      <Skeleton height={160} width="100%" />
      <div style={{ height: 16 }} />
      <Skeleton height={520} width="100%" />
      <div style={{ height: 16 }} />
      <Skeleton height={280} width="100%" />
    </div>
  );
}
