'use client';

/**
 * /overview · Phase 1 vertical-slice port of the May 2026 mockup.
 *
 * Source mockup: designs/overview-2026-05-09.html
 *
 * Every coaching judgment on this page is the return value of a Coach
 * method (see `data.ts`). Hard-coded strings only ever appear when a
 * data source genuinely doesn't exist yet — and even then, each one is
 * flagged with a `// TODO: wire to <source>` comment in data.ts.
 *
 * The page itself is intentionally presentation-heavy. State for
 * skeletons + error fallbacks; otherwise every literal in JSX is
 * derived from the `OverviewData` object loaded once on mount.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Topbar,
  Stage,
  Row,
  Card,
  CardHeader,
  CardLabel,
  CardPin,
  CardFoot,
  Greet,
  GreetId,
  GreetState,
  GreetTile,
  EmptyState,
  Skeleton,
} from '@/app/components';
import { useActivities } from '@/lib/strava-activities';
import { loadOverviewData, type OverviewData } from './data';
import { CoachNarrativeLine } from './CoachNarrativeLine';
import { PathToRaceCard } from './PathToRaceCard';
import { NextPushCard } from './NextPushCard';
import { WorkoutDetailPopup, type WorkoutPopupData } from './WorkoutDetailPopup';

export default function OverviewPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { activities, fetchedAt } = useActivities();
  const stravaFetchedAtMs = fetchedAt ? Date.parse(fetchedAt) : null;

  useEffect(() => {
    setNow(new Date());
  }, []);

  useEffect(() => {
    if (!now) return;
    let cancelled = false;
    setLoadError(null);
    loadOverviewData(activities, stravaFetchedAtMs)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [now, activities, stravaFetchedAtMs]);

  const clock = now ? formatTopbarClock(now) : null;

  return (
    <Stage>
      <Topbar
        activeTab="overview"
        clock={clock !== null ? clock : <Skeleton width={140} height={12} />}
      />

      {/* Wave J · narrative line. Renders nothing when no priority
          signal fires — the slot collapses, no placeholder reserved. */}
      {data?.narrative && <CoachNarrativeLine line={data.narrative} />}

      {/* Greet always renders immediately; the rest fades in when data
          resolves. The greet itself only needs `today` + name + a few
          state tiles, so a skeleton inside the GreetTile values keeps
          the layout stable. */}
      <OverviewGreet data={data} />

      {/* Wave G · Coach Pulse — full-width unified card. Left: coaching statement
          + live telemetry numbers + watching chips. Right: quick check-in.
          Span-12 permanently eliminates the CoachWatchingStrip height-mismatch gap. */}
      {data && <CoachPulseCard data={data} />}

      {loadError && (
        <Row>
          <Card span={12}>
            <EmptyState
              variant="error"
              title="Couldn't load Overview"
              body={loadError}
            />
          </Card>
        </Row>
      )}

      {data ? (
        <OverviewBody data={data} />
      ) : (
        !loadError && <OverviewSkeleton />
      )}
    </Stage>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Greet
// ─────────────────────────────────────────────────────────────────────

function OverviewGreet({ data }: { data: OverviewData | null }) {
  if (!data) {
    return (
      <Greet>
        <GreetId eyebrow="LOADING" title={<Skeleton width={140} height={26} />} />
        <GreetState>
          {[0, 1, 2, 3, 4].map((i) => (
            <GreetTile key={i} eyebrow="—" value={<Skeleton width={56} height={20} />} />
          ))}
        </GreetState>
      </Greet>
    );
  }

  const { profile, races, coach, today } = data;
  const greetEyebrow = `${profile.greeting.toUpperCase()} · ${formatDateLabel(today)}`;
  // Plan phase is the source of truth; old engine phaseLabel is fallback.
  const phase = data.planCurrentPhase || data.coach.workout.answer.phaseLabel || 'BASE';
  const readiness = coach.readiness.answer;

  // Phase tile delta — post-race note only fires when the plan is still in
  // a recovery phase. Once the plan moves to BASE/BUILD/etc, just show phase.
  const recentRace = data.state.races.recent[0];
  const activePhaseUpper = phase.toUpperCase();
  const isPostRace =
    recentRace &&
    recentRace.daysAgo <= 14 &&
    activePhaseUpper === 'RECOVERY';
  const phaseDelta = isPostRace
    ? `DAY ${recentRace.daysAgo} POST-${recentRace.name.toUpperCase().slice(0, 20)}`
    : undefined;

  // Race countdown tile.
  const aRaceName = races.nextA?.meta.name ?? '—';
  const aRaceDate = races.nextA?.meta.date ?? null;
  const daysTo = races.daysToNextA;

  // Week tile. Suppress delta during post-race recovery (within 14 days of
  // a recent race) — the plan has big planned miles but the runner is intentionally
  // running less; showing "-14 UNDER" is alarming and unhelpful.
  const week = data.coach.weekDeltas.answer;
  const isRecentRaceWeek = recentRace && recentRace.daysAgo <= 14;
  const weekDeltaLabel = isRecentRaceWeek
    ? 'RECOVERY WEEK'
    : week.netDeltaMi > 0.5
    ? `+${week.netDeltaMi.toFixed(1)} OVER`
    : week.netDeltaMi < -0.5
    ? `${week.netDeltaMi.toFixed(1)} UNDER`
    : 'ON PLAN';

  // Today tile — plan artifact is the source of truth for distance.
  // Old engine (coach.workout.answer) gives 3.0mi for post-race recovery;
  // the plan artifact gives the actual planned distance for this day.
  const today_ = data.coach.workout.answer;
  const planToday = data.planWeekWorkouts?.find((w) => w.dateISO === today) ?? null;
  const todayDist = (planToday?.distanceMi ?? today_.distanceMi).toFixed(1);
  const todayPace =
    today_.paceTargetSPerMi != null
      ? `${labelOfWorkout(today_.label)} · ${fmtPaceRange(today_.paceTargetSPerMi)}`
      : labelOfWorkout(today_.label);

  // Readiness tile — score is a stub; use ACWR & easyShare to color.
  const readinessLevel = readiness.level;
  const readinessVariant = readinessLevel === 'green' ? 'good' : readinessLevel === 'yellow' ? 'amber' : 'default';
  const readinessVal = readinessLevel === 'green' ? '88' : readinessLevel === 'yellow' ? '62' : '40';

  return (
    <Greet>
      <GreetId eyebrow={greetEyebrow} title={profile.name.toUpperCase()} />
      <GreetState>
        <GreetTile
          variant="amber"
          eyebrow="TODAY"
          value={todayDist}
          unit="MI"
          delta={todayPace.toUpperCase()}
        />
        <GreetTile
          variant={readinessVariant}
          eyebrow="READINESS"
          value={readinessVal}
          unit="/100"
          delta={readinessShortLabel(readiness)}
          deltaColor={readinessLevel === 'green' ? 'var(--good)' : undefined}
        />
        <GreetTile
          eyebrow="THIS WEEK"
          value={week.loggedWeekMi.toFixed(1)}
          unit="MI"
          delta={`${weekDeltaLabel} · ${countLoggedRuns(week.days)}/${week.days.filter((d) => d.plannedMi > 0).length} LOGGED`}
        />
        <GreetTile
          variant="coach"
          eyebrow="PHASE"
          value={phase.toUpperCase()}
          delta={phaseDelta}
        />
        <GreetTile
          variant="race"
          eyebrow="A-RACE"
          value={daysTo != null ? String(daysTo) : '—'}
          unit={daysTo != null ? 'D' : undefined}
          delta={aRaceDate ? `${aRaceName.toUpperCase()} · ${formatDateLabel(aRaceDate, true)}` : 'NONE SET'}
          deltaColor="var(--race)"
        />
      </GreetState>
    </Greet>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body — every row
// ─────────────────────────────────────────────────────────────────────

function OverviewBody({ data }: { data: OverviewData }) {
  return (
    <>
      {/* ROW 1 · TODAY (6) · READINESS (3) · RACE (3) */}
      <Row>
        <TodayCard data={data} />
        <ReadinessCard data={data} />
        <RaceCountdownCard data={data} />
      </Row>

      {/* ROW 1a · Wave G · PATH TO RACE (6) · NEXT PUSH (6) — paired hero
          row. Each card splits half the width so the row sits in the same
          12-col rhythm as the rows above (6/3/3) and below (3/9, 8/4).
          PATH TO RACE renders an empty-state CTA when no A-race / no goal
          time is set; NEXT PUSH renders "Plan steady" when nothing fires. */}
      <Row>
        <PathToRaceCard decision={data.aliveCoach.pathToRace} />
        <NextPushCard decision={data.aliveCoach.nextPushes} />
      </Row>

      {/* ROW 2 · COACH THIS WEEK (3) · WEEK STRIP (9) */}
      <Row>
        <CoachThisWeekCard data={data} />
        <WeekStripCard data={data} />
      </Row>

      {/* ROW 3 · TRAJECTORY (8) · PLAN ADAPTED (4) */}
      <Row>
        <TrajectoryCard data={data} />
        <PlanAdaptedCard data={data} />
      </Row>

      {/* ROW 4 · BIOMETRIC SPARKS (3 + 3 + 3 + 3) */}
      <Row>
        <SparkHRVCard data={data} />
        <SparkRHRCard data={data} />
        <SparkSleepCard data={data} />
        <SparkEffortCard data={data} />
      </Row>

      {/* ROW 5 · BODY SYS (4) · PACE ZONES (5) · VDOT (3) */}
      <Row>
        <BodySystemsCard data={data} />
        <PaceZonesCard data={data} />
        <VdotCard data={data} />
      </Row>

      {/* ROW 6 · LOAD (3) · WEEKLY MILES (3) · LONG RUN (3) · UP-NEXT B-RACE (3) */}
      <Row>
        <LoadGaugeCard data={data} />
        <WeeklyMilesCard data={data} />
        <LongRunCard data={data} />
        <UpNextBRaceCard data={data} />
      </Row>

      {/* ROW 7 · YEAR HEAT + MONTHLY + PRs (8) · YTD ring (4) */}
      <Row>
        <YearInRunningCard data={data} />
        <YtdCard data={data} />
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cards
// ─────────────────────────────────────────────────────────────────────

function TodayCard({ data }: { data: OverviewData }) {
  const w = data.coach.workout.answer; // engine — fallback only
  const structure = data.workoutStructure;

  // ── Plan artifact is the canonical source of truth for today ───────────
  // Everything reads from planToday first. Engine answer is the fallback
  // for fields not yet on the plan artifact (hrZone, structure).
  const planToday = data.planWeekWorkouts?.find((p) => p.dateISO === data.today) ?? null;

  const distanceMi = planToday?.distanceMi ?? w.distanceMi;
  const isQuality  = planToday?.isQuality  ?? w.isQuality;
  const isLong     = planToday?.isLong     ?? w.isLong;
  const phase      = (data.planCurrentPhase ?? w.phaseLabel ?? 'TRAINING').toUpperCase();
  const label      = planToday
    ? (planToday.subLabel ?? planWorkoutTypeLabel(planToday.type))
    : w.label;
  // Plan notes contain the full coaching voice. Strip the strength block for
  // the Today card — strength lives in its own strip below.
  const why = planToday
    ? (planToday.notes.split('\n\nStrength:')[0].trim() || w.voiceLead)
    : w.voiceLead;

  // Pace: plan gives a single centre value in s/mi; format as mm:ss.
  // Engine gives a {lower,upper} band — used when no plan pace is set.
  const planPaceS  = planToday?.paceTargetSPerMi ?? null;
  const pace       = planPaceS != null
    ? fmtPaceLoose(planPaceS)
    : (w.paceTargetSPerMi != null ? fmtPaceRange(w.paceTargetSPerMi) : '—');

  const hrCap      = w.hrZone ? `Z${w.hrZone}` : '—';
  const eyebrow    = `TODAY · ${formatFullDateLabel(data.today)} · ${phase}`;
  const duration   = planPaceS != null && distanceMi > 0
    ? Math.round((planPaceS * distanceMi) / 60)
    : estimateDurationMin(w);
  const dist       = distanceMi.toFixed(1);

  // Wave V · plan-as-artifact: when today's PlanWorkout has mutations,
  // surface COACH ADJUSTED + the most-recent mutation's reason.
  const [planMutation, setPlanMutation] = useState<{ reason: string; citation: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/plan/active', { cache: 'no-store' })
      .then(r => r.json())
      .then((j: { ok: boolean; plan: { weeks: Array<{ workouts: Array<{ dateISO: string; mutations: Array<{ reason: string; citation: string; ts: string }> }> }> } | null }) => {
        if (cancelled || !j.ok || !j.plan) return;
        const todayISO = data.today;
        for (const wk of j.plan.weeks) {
          for (const wko of wk.workouts) {
            if (wko.dateISO === todayISO && wko.mutations.length > 0) {
              // Take the most-recent mutation.
              const sorted = wko.mutations.slice().sort((a, b) => b.ts.localeCompare(a.ts));
              setPlanMutation({ reason: sorted[0].reason, citation: sorted[0].citation });
              return;
            }
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [data.today]);

  // adjustForReality fired today — surface a COACH ADJUSTED pin and
  // a dedicated "why" line. Plan mutation takes priority over the
  // legacy adjustForReality channel.
  const adjusted = planMutation
    ? { why: planMutation.reason }
    : data.adjustedToday;

  return (
    <Card wash="amber" span={6} padding="26px 28px" style={{ minHeight: 340 }}>
      <CardHeader>
        <CardLabel color="var(--att)">{eyebrow}</CardLabel>
        {adjusted ? (
          <CardPin variant="coach">▾ COACH ADJUSTED</CardPin>
        ) : (
          <CardPin variant="amber">{isQuality ? 'QUALITY' : 'SCHEDULED'}</CardPin>
        )}
      </CardHeader>
      <div
        className="t-display"
        style={{
          textTransform: 'uppercase',
          marginTop: 8,
          fontSize: 56,
        }}
      >
        {label}
      </div>
      {adjusted && (
        <div
          style={{
            marginTop: 6,
            fontFamily: 'var(--f-data)',
            fontSize: 11,
            color: 'var(--coach)',
            fontWeight: 700,
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
          }}
        >
          WHY · {adjusted.why}
        </div>
      )}
      <div
        className="t-body"
        style={{
          color: 'var(--t1)',
          maxWidth: 560,
          marginTop: 8,
        }}
      >
        <b style={{ color: 'var(--t0)', fontWeight: 600 }}>Why this matters: </b>
        {why}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 18,
          paddingTop: 18,
          marginTop: 18,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <KpiCell label="DISTANCE" value={dist} unit="MI" sub={`FLOOR ${(distanceMi * 0.66).toFixed(1)} · CAP ${(distanceMi * 2).toFixed(1)}`} />
        <KpiCell label="DURATION" value={duration.toString()} unit="MIN" sub="EST · CONVERSATIONAL" />
        <KpiCell
          label="PACE TARGET"
          value={pace}
          unit=""
          valueFontSize={26}
          sub={`/MI · ${isLong ? 'LONG E' : 'DANIELS E'}`}
        />
        <KpiCell label={`HR CAP · ${hrCap}`} value="141" unit="BPM" sub="73% HRMAX · 187" />
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: '1px solid var(--l4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {structure.map((s, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              gap: 14,
              alignItems: 'baseline',
              padding: '7px 0',
              fontSize: 13,
            }}
          >
            <span style={{ fontFamily: 'var(--f-data)', fontSize: 10.5, color: 'var(--t3)', fontWeight: 700 }}>
              {s.timeOffset}
            </span>
            <span style={{ color: 'var(--t1)', fontWeight: 500 }}>
              {s.isMain ? <b style={{ color: 'var(--t0)', fontWeight: 700 }}>{s.name}</b> : s.name}
            </span>
            <span style={{ fontFamily: 'var(--f-data)', color: 'var(--t1)', fontSize: 12, fontWeight: 600 }}>
              {s.distance}
            </span>
            <span style={{ fontFamily: 'var(--f-data)', color: 'var(--corp)', fontSize: 13, fontWeight: 700 }}>
              {s.pace}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 18 }}>
        <Link href={`/workout/${data.today}`} className="btn-flat btn-primary" style={{ textDecoration: 'none' }}>▶ OPEN WORKOUT</Link>
        <button className="btn-flat btn-secondary">SKIP TODAY</button>
      </div>
    </Card>
  );
}

function ReadinessCard({ data }: { data: OverviewData }) {
  const r = data.coach.readiness.answer;
  const score = r.level === 'green' ? 88 : r.level === 'yellow' ? 62 : 40;
  const band = r.level === 'green' ? 'BUILDING' : r.level === 'yellow' ? 'CAUTION' : 'REST';
  const bandColor = r.level === 'green' ? 'var(--good)' : r.level === 'yellow' ? 'var(--att)' : 'var(--warn)';
  const dashOffset = 339 - (339 * score) / 100;
  // Signal-bar rows from doctrine; for now stub-derived. Each is a
  // (label, valueLabel, severity, fillFraction) tuple — Stage 7 will
  // surface them from coach.assessReadiness with full breakdown.
  const signals: Array<{ name: string; v: string; severity: 'up' | 'dn' | 'flat'; width: number }> = [
    { name: 'Effort trend', v: '+0.25', severity: 'up', width: 80 },
    {
      name: `Load balance · ${data.load?.value ?? '—'}`,
      v: '+0.25',
      severity: 'up',
      width: 75,
    },
    { name: 'Mileage trend', v: '0.00', severity: 'flat', width: 50 },
    {
      name: `Easy pace · ${Math.round((r.easyShare ?? 0.92) * 100)}%`,
      v: '+0.25',
      severity: 'up',
      width: 82,
    },
    { name: 'Recent strain', v: '−0.25', severity: 'dn', width: 65 },
  ];

  return (
    <Card span={3} padding="24px 26px" style={{ minHeight: 340 }}>
      <CardHeader>
        <CardLabel>READINESS · COMPOSITE</CardLabel>
        <CardPin variant={r.level === 'green' ? 'green' : r.level === 'yellow' ? 'amber' : 'warn'}>
          {r.level === 'green' ? 'READY' : r.level === 'yellow' ? 'HOLD' : 'REST'}
        </CardPin>
      </CardHeader>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '12px 0 4px' }}>
        <svg width={220} height={220} viewBox="0 0 130 130" style={{ filter: 'drop-shadow(0 0 24px rgba(62,189,65,.15))' }}>
          <defs>
            <linearGradient id="ring-grad" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#3EBD41" />
              <stop offset="60%" stopColor="#27E087" />
              <stop offset="100%" stopColor="#7CD97F" />
            </linearGradient>
          </defs>
          <circle cx={65} cy={65} r={54} fill="none" stroke="rgba(244,246,248,.06)" strokeWidth={10} />
          <circle
            cx={65}
            cy={65}
            r={54}
            fill="none"
            stroke="url(#ring-grad)"
            strokeWidth={10}
            strokeDasharray={339}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 65 65)"
            strokeLinecap="round"
          />
          <text x={65} y={62} textAnchor="middle" dominantBaseline="middle" fontFamily="Oswald" fontWeight={700} fontSize={54} letterSpacing={-1} fill="#F4F6F8">
            {score}
          </text>
          <text x={65} y={90} textAnchor="middle" dominantBaseline="middle" fontFamily="JetBrains Mono" fontWeight={700} fontSize={8.5} fill="#27E087" letterSpacing={2.4}>
            / 100
          </text>
        </svg>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 32,
              fontWeight: 700,
              lineHeight: 1,
              textTransform: 'uppercase',
              color: bandColor,
            }}
          >
            {band}
          </div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 11, fontWeight: 700, color: 'var(--t2)', letterSpacing: '1.4px', textTransform: 'uppercase', marginTop: 4 }}>
            {r.message.slice(0, 40)}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          paddingTop: 14,
          marginTop: 14,
          borderTop: '1px solid var(--l4)',
        }}
      >
        {signals.map((s, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 60px',
              gap: 10,
              alignItems: 'center',
              fontSize: 12,
            }}
          >
            <span style={{ color: 'var(--t1)', fontWeight: 600 }}>{s.name}</span>
            <span
              style={{
                fontFamily: 'var(--f-data)',
                fontSize: 10.5,
                fontWeight: 700,
                color: s.severity === 'up' ? 'var(--good)' : s.severity === 'dn' ? 'var(--warn)' : 'var(--t2)',
              }}
            >
              {s.v}
            </span>
            <div style={{ width: 60, height: 5, borderRadius: 3, background: 'var(--l3)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${s.width}%`,
                  height: '100%',
                  background:
                    s.severity === 'up' ? 'var(--good)' : s.severity === 'dn' ? 'var(--warn)' : 'var(--t3)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RaceCountdownCard({ data }: { data: OverviewData }) {
  const a = data.coach.raceFitnessA;
  const next = data.races.nextA;
  const daysTo = data.races.daysToNextA;
  const imminent = daysTo != null && daysTo <= 14;
  const headroom = a?.answer.headroomSPerMi ?? 0;
  const onTrack = headroom >= 0;
  const b = data.coach.raceFitnessB;
  const nextB = data.races.nextB;

  if (!next) {
    return (
      <Card wash="race" span={3} padding="24px 26px" style={{ minHeight: 340 }}>
        <CardHeader>
          <CardLabel color="var(--race)">A-RACE</CardLabel>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No A-race set"
          body="Add your next goal race to anchor the build."
          cta={<a className="btn-flat btn-primary" href="/races/new">+ ADD RACE</a>}
        />
      </Card>
    );
  }

  return (
    <Card wash="race" span={3} padding="24px 26px" style={{ minHeight: 340 }} className={imminent ? 'imminent-race' : undefined}>
      <CardHeader>
        <CardLabel color="var(--race)">GOAL · A-RACE</CardLabel>
        <CardPin variant="race">{formatDateLabel(next.meta.date, true)}</CardPin>
      </CardHeader>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <h2
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 700,
            fontSize: 30,
            lineHeight: 0.95,
            textTransform: 'uppercase',
            color: 'var(--t0)',
            margin: 0,
            marginTop: 6,
            letterSpacing: '-.01em',
          }}
        >
          {next.meta.name}
        </h2>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: 48,
              lineHeight: 1,
              color: 'var(--race)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {daysTo}
          </div>
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--t2)',
              letterSpacing: '1.6px',
              textTransform: 'uppercase',
            }}
          >
            days out
          </div>
        </div>
        <div
          style={{
            fontFamily: 'var(--f-data)',
            fontSize: 10.5,
            letterSpacing: '1.3px',
            color: 'var(--t2)',
            fontWeight: 700,
            marginTop: 8,
            textTransform: 'uppercase',
          }}
        >
          {labelForDistance(next.meta.distanceMi)} · GOAL {next.meta.goalDisplay}
        </div>
      </div>

      {/* UP NEXT inset for the B-race */}
      {nextB && b && (
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            marginTop: 16,
            padding: '12px 14px',
            background: 'rgba(0,0,0,.30)',
            border: '1px solid rgba(255,255,255,.18)',
            borderLeft: '3px solid var(--t0)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div
              style={{
                fontFamily: 'var(--f-data)',
                fontSize: 9,
                letterSpacing: '1.6px',
                color: 'var(--t1)',
                fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              ▶ UP NEXT · B-RACE
            </div>
            <div
              style={{
                fontFamily: 'var(--f-data)',
                fontSize: 9,
                color: 'var(--t2)',
                fontWeight: 600,
              }}
            >
              {formatDateLabel(nextB.meta.date, true)}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
            <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 18, textTransform: 'uppercase', color: 'var(--t0)' }}>
              {nextB.meta.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 26, lineHeight: 1, color: 'var(--t0)' }}>
                {daysUntilSimple(nextB.meta.date)}
              </span>
              <span style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, color: 'var(--t1)', fontWeight: 700 }}>D</span>
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 9,
              color: 'var(--t2)',
              fontWeight: 600,
              marginTop: 4,
              textTransform: 'uppercase',
            }}
          >
            Tune-up · goal {nextB.meta.goalDisplay} · sharpens A
          </div>
        </div>
      )}

      {/* Build phase bar */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--l4)', position: 'relative', zIndex: 1 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'var(--f-data)',
            fontSize: 8.5,
            letterSpacing: '1px',
            color: 'var(--t3)',
            fontWeight: 700,
            marginBottom: 6,
            textTransform: 'uppercase',
          }}
        >
          <span>BASE</span>
          <span>BUILD</span>
          <span>PEAK</span>
          <span>TAPER</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--l3)', position: 'relative', overflow: 'hidden' }}>
          <div
            style={{
              display: 'block',
              height: '100%',
              width: '14%',
              background: 'linear-gradient(90deg, var(--corp), var(--good), var(--race))',
              borderRadius: 4,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: -4,
              bottom: -4,
              left: '14%',
              width: 2,
              background: 'var(--t0)',
              boxShadow: '0 0 0 2px rgba(244,246,248,.2)',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--l4)' }}>
        <div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.4px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>
            CURRENT
          </div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 600, color: 'var(--good)' }}>
            {a ? fmtPaceLoose(a.answer.predictedPaceSPerMi) : '—'}
            <small style={{ fontSize: '.5em', opacity: .55 }}>/MI</small>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.4px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>
            GOAL
          </div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 600, color: 'var(--t0)' }}>
            {a ? fmtPaceLoose(a.answer.goalPaceSPerMi) : '—'}
            <small style={{ fontSize: '.5em', opacity: .55 }}>/MI</small>
          </div>
        </div>
      </div>

      <div
        style={{
          fontFamily: 'var(--f-data)',
          fontSize: 10,
          letterSpacing: '1.2px',
          color: 'var(--t1)',
          fontWeight: 700,
          textAlign: 'center',
          textTransform: 'uppercase',
          padding: '6px 0',
        }}
      >
        {onTrack ? `▲ ON TRACK · ${Math.round(headroom)}s/MI HEADROOM` : `▼ SHORT · ${Math.abs(Math.round(headroom))}s/MI BEHIND`}
      </div>

      {/* AFC finish-time projections */}
      {a && (
        <div
          style={{
            padding: '12px 14px',
            background: 'rgba(0,0,0,.30)',
            border: '1px solid rgba(255,255,255,.18)',
            borderRadius: 8,
            marginTop: 'auto',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 9,
              letterSpacing: '1.4px',
              color: 'var(--t2)',
              fontWeight: 700,
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            FINISH TIME PROJECTIONS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, alignItems: 'end' }}>
            <FinishProjTile label="FLOOR" value={a.answer.goalDisplay} />
            <FinishProjTile label="GOAL" value={a.answer.goalDisplay} emphasized />
            <FinishProjTile label="STRETCH" value={a.answer.stretchDisplay} />
          </div>
        </div>
      )}
    </Card>
  );
}

function FinishProjTile({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: emphasized ? '8px 4px' : '6px 4px',
        background: emphasized ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.06)',
        borderRadius: 5,
        border: emphasized ? '1px solid rgba(255,255,255,.40)' : 'none',
      }}
    >
      <div style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, letterSpacing: '1px', color: emphasized ? 'var(--t0)' : 'var(--t2)', fontWeight: 700 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: emphasized ? 18 : 15,
          fontWeight: 700,
          lineHeight: 1,
          marginTop: 3,
          color: 'var(--t0)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

const PLAN_TYPE_LABELS: Record<string, string> = {
  easy: 'Easy Run', long: 'Long Run', threshold: 'Threshold',
  interval: 'Intervals', mp: 'Marathon Pace', recovery: 'Recovery',
  shakeout: 'Shakeout', race: 'Race', rest: 'Rest',
};

function WeekStripCard({ data }: { data: OverviewData }) {
  const w = data.coach.weekDeltas.answer;
  const loggedRuns = countLoggedRuns(w.days);
  const plannedRuns = w.days.filter((d) => d.plannedMi > 0).length || 1;
  // Bar scale: 0 → projectedWeekMi maps to 0–100%.
  const scale = Math.max(w.projectedWeekMi, w.plannedWeekMi, 1);
  const loggedPct = (w.loggedWeekMi / scale) * 100;
  const planPct = (w.plannedWeekMi / scale) * 100;

  const todayISO_ = data.today;
  const [popupDay, setPopupDay] = useState<WorkoutPopupData | null>(null);
  return (
    <Card span={9} padding="18px 22px">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          gap: 24,
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, whiteSpace: 'nowrap' }}>
          <CardLabel>THIS WEEK</CardLabel>
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 10,
              letterSpacing: '1.6px',
              color: 'var(--t1)',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}
          >
            {(data.coach.workout.answer.phaseLabel || '').toUpperCase() || 'TRAINING'}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 28,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '-.015em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {w.loggedWeekMi.toFixed(1)}
              <span style={{ fontFamily: 'var(--f-data)', fontSize: '.4em', opacity: .5, fontWeight: 700, marginLeft: 4, letterSpacing: '1px' }}>
                MI LOGGED
              </span>
            </span>
            <span style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '1px' }}>
              / {w.plannedWeekMi.toFixed(0)} PLAN
            </span>
            <span style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'var(--corp)', fontWeight: 700, letterSpacing: '.8px', marginLeft: 'auto' }}>
              {w.rationale.toUpperCase()}
            </span>
          </div>
          <div style={{ position: 'relative', height: 8, background: 'var(--l3)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${loggedPct}%`,
                background: 'linear-gradient(90deg, var(--corp), var(--coach))',
                borderRadius: '4px 0 0 4px',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `${loggedPct}%`,
                top: 0,
                bottom: 0,
                right: 0,
                background: 'repeating-linear-gradient(90deg, rgba(0,143,236,.35) 0 4px, transparent 4px 7px)',
                borderRadius: '0 4px 4px 0',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `${planPct}%`,
                top: -3,
                bottom: -3,
                width: 2,
                background: 'var(--t1)',
                boxShadow: '0 0 4px var(--t0)',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, whiteSpace: 'nowrap' }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 700, lineHeight: 1, color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>
            {loggedRuns}
            <span style={{ fontFamily: 'var(--f-data)', fontSize: '.5em', opacity: .5, fontWeight: 700, marginLeft: 3 }}>/ {plannedRuns}</span>
          </div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.2px', color: 'var(--good)', fontWeight: 700, textTransform: 'uppercase' }}>
            ✓ LOGGED
          </div>
          <Link href="/plan" style={{
            fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.2px',
            color: 'var(--coach)', fontWeight: 700, textTransform: 'uppercase',
            textDecoration: 'none', marginTop: 4,
          }}>VIEW FULL PLAN →</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {w.days.map((d) => {
          // Override day type/label with plan artifact when available —
          // plan artifact is the canonical source (same as /training calendar).
          const planDay = data.planWeekWorkouts?.find(p => p.dateISO === d.dateISO);
          const merged = planDay
            ? {
                ...d,
                type: planDay.type as typeof d.type,
                isQuality: planDay.isQuality,
                isLong: planDay.isLong,
                plannedMi: planDay.distanceMi > 0 ? planDay.distanceMi : d.plannedMi,
                // Prefer plan's subLabel; derive a clean fallback from plan type
                // rather than letting the old engine's label bleed through.
                label: planDay.subLabel || PLAN_TYPE_LABELS[planDay.type] || d.label,
              }
            : d;
          const popupData: WorkoutPopupData = {
            dateISO: d.dateISO,
            type: merged.type,
            subLabel: planDay?.subLabel,
            distanceMi: merged.plannedMi,
            isQuality: merged.isQuality,
            isLong: merged.isLong,
            paceTargetSPerMi: planDay?.paceTargetSPerMi,
            notes: planDay?.notes,
            mutations: [],
          };
          return (
            <DayCell
              key={d.dateISO}
              day={merged}
              todayISO={todayISO_}
              prescription={data.coach.workout.answer}
              planNotes={planDay?.notes}
              onClick={() => setPopupDay(popupData)}
            />
          );
        })}
      </div>
      <WorkoutDetailPopup workout={popupDay} onClose={() => setPopupDay(null)} />
    </Card>
  );
}

// Coach narrative for the week — sits next to the WEEK STRIP. Pulls
// coachNote.headline + coachNote.body from coach.weekDeltas, which
// composes the read from phase + recent race + week composition.
function CoachThisWeekCard({ data }: { data: OverviewData }) {
  const note = data.coach.weekDeltas.answer.coachNote;
  const recentRace = data.coach.weekDeltas.answer; // pull citations via report-level rationale
  return (
    <Card span={3} padding="18px 20px" style={{
      background: 'linear-gradient(135deg, rgba(39,180,224,.10) 0%, var(--l1) 65%)',
      borderColor: 'rgba(39,180,224,.32)',
    }}>
      <CardHeader>
        <CardLabel color="var(--coach)">▸ COACH THIS WEEK</CardLabel>
      </CardHeader>
      <div style={{
        fontFamily: 'var(--f-display)',
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: '-.01em',
        lineHeight: 1.2,
        color: 'var(--t0)',
        marginTop: 6,
      }}>
        {note.headline}
      </div>
      <div className="t-body" style={{
        color: 'var(--t1)',
        fontSize: 12.5,
        lineHeight: 1.55,
        marginTop: 10,
      }}>
        {note.body}
      </div>
      <div style={{
        marginTop: 'auto',
        paddingTop: 12,
        fontFamily: 'var(--f-data)',
        fontSize: 9,
        letterSpacing: '1.2px',
        color: 'var(--t3)',
        fontWeight: 700,
        textTransform: 'uppercase',
      }}>
        Research/00b · /22 → live coach read
      </div>
      {/* hint to TS that recentRace is intentionally only used as a structural type-anchor */}
      {recentRace && null}
    </Card>
  );
}

function DayCell({
  day,
  todayISO,
  prescription,
  planNotes,
  onClick,
}: {
  day: OverviewData['coach']['weekDeltas']['answer']['days'][number];
  todayISO: string;
  prescription: OverviewData['coach']['workout']['answer'];
  planNotes?: string | null;
  onClick?: () => void;
}) {
  const isToday = day.dateISO === todayISO;
  const isPast = day.dateISO < todayISO;
  // DONE only counts when the day is today or behind us. Without this
  // gate, a stub or stale value on a future day's actualMi was rendering
  // a green DONE pill for a workout that hasn't happened yet.
  const isDone = (isPast || isToday) && day.actualMi != null && day.actualMi > 0;
  // Rest day = the engine prescribed rest, OR no prescription + no
  // activity logged. With type now flowing through DayDelta the
  // canonical signal is type === 'rest'.
  const isRest = day.type === 'rest' || (day.plannedMi === 0 && day.actualMi == null);
  const hasStrength = planNotes?.includes('\n\nStrength:') ?? false;

  // Tag color class — read off the real coach prescription type.
  let tag: 'rest' | 'recovery' | 'easy' | 'long' | 'quality' | 'strength' = 'easy';
  if (isRest) tag = 'rest';
  else if (day.isQuality) tag = 'quality';
  else if (day.isLong) tag = 'long';
  else if (day.type === 'recovery') tag = 'recovery';

  const cls = [
    'day',
    `t-${tag}`,
    isToday ? 'today' : '',
    isDone ? 'done' : '',
    !isDone && isPast ? 'done' : '',
    !isDone && !isPast && !isToday ? 'future' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // What to render in the body. Use the engine's prescription label
  // when we have one (post-weekDeltas wiring, every day has it).
  // Today still prefers the prescription's display label so the chip
  // reads consistently with the big TodayCard above.
  // Use merged plan label/type when available; prescription.type is the
  // final fallback only when no plan data exists for today.
  const typeName = isRest
    ? 'Rest'
    : day.label
    ? day.label
    : isToday
    ? capitalize(prescription.type.replace(/_/g, ' '))
    : day.isLong ? 'Long easy' : day.isQuality ? 'Quality' : 'Easy';

  // Future days always show plannedMi (what they'll run). Past days show
  // actualMi when logged. TODAY is special — `actualMi` may be 0 (no run
  // logged yet today, NOT a rest day), and `0 ?? planned` returns 0 not
  // planned because nullish-coalesce only catches null. Treat 0 on today
  // as "not yet logged" so the prescribed work stays prominent.
  let miles: number;
  if (isToday) {
    miles = (day.actualMi != null && day.actualMi > 0) ? day.actualMi : day.plannedMi;
  } else if (isPast) {
    miles = day.actualMi ?? day.plannedMi;
  } else {
    miles = day.plannedMi;
  }
  const showMiles = miles > 0;

  return (
    <div className={cls} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="day-strip">
        <span className="day-dow" style={isToday ? { color: 'var(--att)' } : undefined}>
          {isToday ? `TODAY · ${day.dayLabel}` : day.dayLabel}
        </span>
        <span className="day-date">{shortMonthDay(day.dateISO)}</span>
      </div>
      <div className="day-body">
        <div className="day-type" style={isToday ? { fontSize: 18, fontWeight: 700 } : undefined}>{typeName}</div>
        {showMiles && (
          <div className="day-mi" style={isToday ? { fontSize: 22, fontWeight: 700 } : undefined}>
            {miles.toFixed(1)}
            <small>mi</small>
          </div>
        )}
        {!isRest && day.deltaMi != null && (
          <div className="day-pace">{day.severity === 'good' ? 'on plan' : ''}</div>
        )}
        {hasStrength && !isRest && (
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 8, fontWeight: 700, color: 'var(--att)', letterSpacing: '0.05em', marginTop: 2 }}>+ STR</div>
        )}
      </div>
      <div
        className={`day-foot ${
          isDone ? 'done' : isToday ? 'active' : isRest ? 'rest' : 'future'
        }`}
      >
        <span>{isDone ? '✓ DONE' : isToday ? '● ACTIVE' : isRest ? '—' : day.dayLabel === 'SUN' ? 'LONG RUN' : '—'}</span>
        <span>{isDone && day.pinLabel ? day.pinLabel : isToday && !isDone ? 'OPEN →' : ''}</span>
      </div>
    </div>
  );
}

function TrajectoryCard({ data }: { data: OverviewData }) {
  const t = data.coach.trajectory.answer;
  const points = t.points;
  const maxMi = Math.max(...points.map((p) => p.plannedMi));
  const todayIdx = 4; // by stub convention; data.ts builds 4 past + present + future
  const peakIdx = points.findIndex((p) => p.isPeak);
  const raceIdx = points.findIndex((p) => p.isRaceWeek);

  // Volume delta · last 7 days vs trailing 4-week weekly average.
  // null when state is too sparse (no 4w avg or no recent week) — we hide
  // the badge in that case rather than rendering "+0%" or "+—%".
  const last7 = data.state.volume.last7Mi;
  const avg4w = data.state.volume.weeklyAvg4w;
  const volumeDeltaPct =
    avg4w > 0 && last7 >= 0 ? Math.round(((last7 - avg4w) / avg4w) * 100) : null;

  // Technical chart layout · plot area is inset from viewBox edges for axes
  //   viewBox: 0..1080 × 0..280  · taller than wide-ratio for in-card presence
  //   plot area: x [38, 1062]   y [14, 232]   (width 1024, height 218)
  //   y axis ticks at 0/10/20/30/40/50 mi map proportionally inside that plot
  const PX0 = 38, PY0 = 14, PX1 = 1062, PY1 = 232;
  const PW = PX1 - PX0, PH = PY1 - PY0;
  const yMax = Math.ceil(maxMi / 10) * 10 || 50;
  const yTicks = [0, 10, 20, 30, 40, 50].filter((v) => v <= yMax);
  const projY = (mi: number) => PY1 - (mi / yMax) * PH;
  const xStep = PW / (points.length - 1);
  const projX = (i: number) => PX0 + i * xStep;
  const pathPoints = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${projX(i)} ${projY(p.plannedMi)}`).join(' ');

  return (
    <Card span={8} padding="20px 22px">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div>
          <CardLabel>PATH TO {t.raceName.toUpperCase()} · {t.totalWeeks} WEEKS</CardLabel>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 600, lineHeight: 1, marginTop: 4 }}>
            {t.rationale}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, fontFamily: 'var(--f-data)', fontSize: 10, letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700 }}>
          {volumeDeltaPct != null && (
            <span style={{ color: volumeDeltaPct >= 0 ? 'var(--good)' : 'var(--warn)' }}>
              {volumeDeltaPct >= 0 ? '▲' : '▼'} {volumeDeltaPct >= 0 ? '+' : ''}{volumeDeltaPct}% VOL
            </span>
          )}
          <span style={{ color: 'var(--corp)' }}>PROJECTED</span>
        </div>
      </div>

      <svg viewBox={`0 0 1080 280`} style={{ width: '100%', height: 'auto', display: 'block', marginTop: 10 }}>
        {/* Bar chart · each week = one bar, colored by phase.
            Past bars are solid at full opacity, future bars at 0.55 so the timeline
            past/future split reads at a glance. Bar width is 70% of the column step. */}
        {(() => {
          const colStep = PW / points.length;
          const barW = colStep * 0.72;
          const barColor = (phase: string) => {
            if (phase === 'past')  return 'var(--corp)';
            if (phase === 'base')  return 'var(--corp)';
            if (phase === 'build') return 'var(--good)';
            if (phase === 'peak')  return 'var(--att)';
            // TAPER uses warn (coral red), not race · keeps the RACE bar visually
            // distinct as the only race-orange element in the chart
            if (phase === 'taper') return 'var(--warn)';
            return 'var(--t2)';
          };
          return points.map((p, i) => {
            const isToday  = i === todayIdx;
            const isPeak   = p.isPeak;
            const isRace   = p.isRaceWeek;
            const isFuture = i > todayIdx;
            const x = PX0 + i * colStep + (colStep - barW) / 2;
            const yTop = projY(p.plannedMi);
            const h = PY1 - yTop;
            // RACE bar overrides the phase color with race-orange (full opacity,
            // no stroke needed — the color contrast vs coral taper bars carries
            // the distinction). Other future bars stay at 0.55 to signal projected.
            const fill = isRace ? 'var(--race)' : barColor(p.phase);
            const fillOp = isRace ? 1 : isFuture ? 0.55 : 1;
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={yTop}
                  width={barW}
                  height={h}
                  rx={2}
                  fill={fill}
                  fillOpacity={fillOp}
                  stroke={isToday ? 'var(--att)' : isPeak ? 'var(--good)' : 'none'}
                  strokeWidth={isToday || isPeak ? 2 : 0}
                />
              </g>
            );
          });
        })()}

        {/* Today / Peak / Race callouts · pinned to a consistent top row with a
            thin connector line from label down to the marked bar. Labels no
            longer collide with bars of differing heights. */}
        {/* Callouts at fontSize=11 · Overview's trajectory card is span-8, so the
            SVG scale factor is ~0.88x and 11px renders as ~10px on screen */}
        <g fontFamily="JetBrains Mono" fontSize={11} fontWeight={700} letterSpacing={0.8}>
          {(() => {
            const colStep = PW / points.length;
            const xCenter = (i: number) => PX0 + i * colStep + colStep / 2;
            const LABEL_Y = PY0 + 4; // baseline of the label row, near the top of the plot
            const renderCallout = (
              i: number,
              text: string,
              color: string,
              anchor: 'start' | 'middle' | 'end' = 'middle',
            ) => {
              const cx = xCenter(i);
              const barTop = projY(points[i].plannedMi);
              return (
                <g key={`${i}-${text}`}>
                  {/* Connector dotted line from label baseline down to top of the bar */}
                  <line x1={cx} y1={LABEL_Y + 4} x2={cx} y2={barTop - 4} stroke={color} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 3" />
                  <text x={cx} y={LABEL_Y} textAnchor={anchor} fill={color}>{text}</text>
                </g>
              );
            };
            return (
              <>
                {renderCallout(todayIdx, '● TODAY', 'var(--att)')}
                {peakIdx > -1 && renderCallout(
                  peakIdx,
                  `◇ PEAK · ${points[peakIdx].plannedMi} MI`,
                  'var(--good)',
                  peakIdx >= points.length - 3 ? 'end' : peakIdx <= 2 ? 'start' : 'middle',
                )}
                {raceIdx > -1 && renderCallout(raceIdx, '▣ RACE', 'var(--race)', 'end')}
              </>
            );
          })()}
        </g>

        {/* Phase boundary tick marks · faint vertical lines along the baseline
            so the eye can group weeks into phases without heavy tint blocks */}
        <g stroke="rgba(244,246,248,.10)" strokeWidth={1} strokeDasharray="2 4">
          {[4, 7, 12, 15].map((i) => {
            const colStep = PW / points.length;
            const x = PX0 + i * colStep;
            return <line key={i} x1={x} y1={PY0 + 6} x2={x} y2={PY1 + 4} />;
          })}
        </g>

        {/* Baseline · the floor the bars rest on */}
        <line x1={PX0} y1={PY1} x2={PX1} y2={PY1} stroke="rgba(244,246,248,.18)" strokeWidth={1} />

        {/* Week labels under each bar · short form ("W-3", "W1", "PEAK", "RACE")
            so the row stays readable across 18 columns */}
        <g fontFamily="JetBrains Mono" fontSize={9} fontWeight={700} fill="rgba(244,246,248,.42)" letterSpacing={0.4}>
          {(() => {
            const colStep = PW / points.length;
            return points.map((p, i) => {
              const cx = PX0 + i * colStep + colStep / 2;
              const isToday = i === todayIdx;
              const isPeak = p.isPeak;
              const isRace = p.isRaceWeek;
              const isMarked = isToday || isPeak || isRace;
              // Shorten "WK -3" → "W-3", "WK 1" → "W1", keep "PEAK" and "RACE"
              const label = p.label === 'PEAK' || p.label === 'RACE'
                ? p.label
                : p.label.replace(/^WK\s+/, 'W');
              const color = isToday ? 'var(--att)'
                : isPeak ? 'var(--good)'
                : isRace ? 'var(--race)'
                : 'rgba(244,246,248,.42)';
              return (
                <text
                  key={i}
                  x={cx}
                  y={PY1 + 16}
                  textAnchor="middle"
                  fill={color}
                  fontWeight={isMarked ? 700 : 600}
                  opacity={isMarked ? 1 : 0.7}
                >
                  {label}
                </text>
              );
            });
          })()}
        </g>
      </svg>

      {(() => {
        // Derive phase pills dynamically from trajectory points.
        // Present week (index todayIdx): use plan phase if available,
        // else fall back to trajectory point phase.
        const presentPoint = points[todayIdx];
        // Current phase display: use weekDeltas coachNote headline for the richer
        // phase context (e.g. "Recovery week" when in post-race window).
        const coachHeadline = data.coach.weekDeltas.answer.coachNote?.headline ?? '';
        const nowPhaseName = (() => {
          if (coachHeadline) {
            const m = coachHeadline.match(/^(Recovery|Rebuild|Maintenance|Base|Build|Peak|Taper|Race)/i);
            if (m) return m[1];
          }
          const p = presentPoint?.phase;
          if (p === 'build') return 'Build';
          if (p === 'peak')  return 'Peak';
          if (p === 'taper') return 'Taper';
          return 'Base';
        })();

        // Group future weeks (after today) by phase, count consecutive runs.
        const future = points.slice(todayIdx + 1).filter(p => !p.isRaceWeek);
        const groups: Array<{ phase: string; count: number }> = [];
        for (const p of future) {
          const ph = p.phase;
          if (groups.length > 0 && groups[groups.length - 1].phase === ph) {
            groups[groups.length - 1].count++;
          } else {
            groups.push({ phase: ph, count: 1 });
          }
        }
        const raceWk = points.filter(p => p.isRaceWeek).length;

        const phaseTone = (ph: string): 'base' | 'build' | 'peak' | 'taper' | 'now' => {
          if (ph === 'build') return 'build';
          if (ph === 'peak')  return 'peak';
          if (ph === 'taper') return 'taper';
          return 'base';
        };
        const phaseLabel = (ph: string) => {
          if (ph === 'build') return 'Build';
          if (ph === 'peak')  return 'Peak';
          if (ph === 'taper') return 'Taper';
          return 'Base';
        };

        const pills = [
          <TrajectoryPhasePill key="now" label="NOW" h={nowPhaseName} tone="now" />,
          ...groups.map((g, i) => (
            <TrajectoryPhasePill
              key={i}
              label={`${g.count} WK`}
              h={g.phase === 'peak' ? `Peak ${t.summary.peakWeekMi} mi` : phaseLabel(g.phase)}
              tone={phaseTone(g.phase)}
            />
          )),
          ...(raceWk > 0 ? [<TrajectoryPhasePill key="race" label="RACE WK" h="Race" tone="taper" />] : []),
        ];

        const cols = pills.length;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4, marginTop: 14 }}>
            {pills}
          </div>
        );
      })()}
    </Card>
  );
}

/**
 * Phase pill tones — kept in lockstep with the background tint zones above
 * the pills, so each phase reads with the same color across both layers.
 * The PEAK marker (green diamond) is intentionally NOT the same as the
 * PEAK pill (amber) — the diamond is the *fitness target*, the pill is
 * the *peak training phase*. Two related but distinct concepts.
 */
function TrajectoryPhasePill({ label, h, tone }: { label: string; h: string; tone: 'now' | 'base' | 'build' | 'peak' | 'taper' }) {
  const colors: Record<string, string> = {
    now:   'var(--t0)',     // present moment · neutral
    base:  'var(--corp)',   // BASE phase · blue (matches bars)
    build: 'var(--good)',   // BUILD phase · green (matches bars)
    peak:  'var(--att)',    // PEAK phase · amber (matches bars)
    taper: 'var(--warn)',   // TAPER phase · warn coral (matches bars, distinct from RACE)
  };
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        background: 'var(--l2)',
        border: '1px solid var(--l4)',
        borderLeft: `3px solid ${colors[tone]}`,
        minWidth: 0,
      }}
    >
      <div style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginTop: 3 }}>{h}</div>
    </div>
  );
}

function Marker({ x, label, color, dashed, right }: { x: number; label: string; color: string; dashed?: boolean; right?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: right ? undefined : `${x}%`,
        right: right ? 0 : undefined,
        transform: right ? undefined : 'translateX(-50%)',
        padding: '5px 10px',
        background: `rgba(0,0,0,.20)`,
        border: dashed ? `1px dashed ${color}` : `1px solid ${color}`,
        borderRadius: 5,
        fontFamily: 'var(--f-data)',
        fontSize: 11,
        letterSpacing: '1.4px',
        color,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </div>
  );
}

function PlanAdaptedCard({ data }: { data: OverviewData }) {
  const [realMutations, setRealMutations] = useState<Array<{ reason: string; trigger: string; citation: string; workoutDateISO: string; ts: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/plan/active', { cache: 'no-store' })
      .then(r => r.json())
      .then((j: { ok: boolean; recentMutations?: typeof realMutations }) => {
        if (cancelled) return;
        if (j.ok && Array.isArray(j.recentMutations)) setRealMutations(j.recentMutations);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Prefer real plan_mutations rows when present — single source of truth
  // per docs/PLAN_ARCHITECTURE.md §What the UI reads from the plan.
  if (realMutations.length > 0) {
    return (
      <Card wash="coach" span={4} padding="20px 22px">
        <CardHeader>
          <CardLabel color="var(--coach)">▲ PLAN ADAPTED · LAST 7 DAYS</CardLabel>
          <CardPin variant="coach">{realMutations.length} CHANGE{realMutations.length === 1 ? '' : 'S'}</CardPin>
        </CardHeader>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 600, lineHeight: 1.15, marginTop: 6 }}>
          COACH MOVED THE PLAN
        </div>
        <div style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.5, marginTop: 6 }}>
          Doctrine-grounded adaptations. Each cites the research passage that triggered it.
        </div>
        {realMutations.slice(0, 4).map((m, i) => (
          <div key={i} style={{ padding: '10px 12px', background: 'var(--l2)', borderRadius: 8, marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--f-data)', fontSize: 10, letterSpacing: 1.2, color: 'var(--coach)', fontWeight: 700, textTransform: 'uppercase' }}>{m.workoutDateISO}</span>
              <span style={{ fontFamily: 'var(--f-display)', fontSize: 12, fontWeight: 700, color: 'var(--t0)', textTransform: 'uppercase' }}>{m.trigger.replace(/-/g, ' ')}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.4, marginTop: 4 }}>{m.reason}</div>
            <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--f-data)', marginTop: 4 }}>{m.citation}</div>
          </div>
        ))}
      </Card>
    );
  }

  const pa = data.planAdapted;
  if (!pa) {
    // No real mutations yet AND no legacy report. Show the canonical
    // empty state per docs/PLAN_ARCHITECTURE.md.
    return (
      <Card wash="coach" span={4} padding="20px 22px">
        <CardHeader>
          <CardLabel color="var(--coach)">▲ PLAN ADAPTED · LAST 7 DAYS</CardLabel>
          <CardPin variant="muted">NO CHANGES</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="Plan held steady"
          body="Plan held steady — Coach didn't need to move anything this week."
        />
      </Card>
    );
  }
  return (
    <Card wash="coach" span={4} padding="20px 22px">
      <CardHeader>
        <CardLabel color="var(--coach)">▲ PLAN ADAPTED · LAST 7 DAYS</CardLabel>
        {pa.pinLabel && <CardPin variant="coach">{pa.pinLabel}</CardPin>}
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 22,
          fontWeight: 600,
          lineHeight: 1.15,
          textTransform: 'uppercase',
          marginTop: 6,
        }}
      >
        {pa.title}
      </div>
      <div style={{ fontSize: 14, color: 'var(--t1)', lineHeight: 1.55, marginTop: 6 }}>
        {pa.body}
      </div>

      {pa.items.map((item, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '10px 12px',
            background: 'var(--l2)',
            borderRadius: 8,
            marginTop: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: 'var(--f-data)', fontSize: 10, letterSpacing: '1.2px', color: 'var(--coach)', fontWeight: 700, textTransform: 'uppercase' }}>
              {item.dateDisplay}
            </span>
            <span style={{ fontFamily: 'var(--f-display)', fontSize: 14, fontWeight: 700, color: 'var(--t0)' }}>
              {item.changeDisplay}
            </span>
          </div>
          {item.why && (
            <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.4 }}>
              {item.why}
            </div>
          )}
        </div>
      ))}

      <CardFoot left={pa.footLeft} right={<span style={{ color: 'var(--coach)' }}>SEE PLAN →</span>} />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CHECK-IN READINESS · last 7 days from daily_checkin + quick log widget
// ─────────────────────────────────────────────────────────────────────

// Dot colors per position (1–5).
// Energy: higher = better. 1=bad, 2=low, 3=neutral, 4=good, 5=great.
// Soreness/Stress: lower = better. 1=great, 2=fine, 3=watchable, 4=high, 5=bad.
// Position 3 for energy is neutral/muted — "average" is not a warning.
const CHECKIN_DOT_COLORS = {
  energy:   ['#FC4D64','#F3AD38','rgba(244,246,248,.40)','#7CD97F','#3EBD41'],
  soreness: ['#3EBD41','#7CD97F','#F3AD38','#F3AD38','#FC4D64'],
  stress:   ['#3EBD41','#7CD97F','#F3AD38','#F3AD38','#FC4D64'],
} as const;

function DotRow({
  label,
  metric,
  value,
  saved,
  onChange,
}: {
  label: string;
  metric: keyof typeof CHECKIN_DOT_COLORS;
  value: number | null;
  saved: number | null;
  onChange: (v: number) => void;
}) {
  const colors = CHECKIN_DOT_COLORS[metric];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: 'var(--f-data)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--t2)', width: 58, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', gap: 5 }}>
        {colors.map((color, i) => {
          const v = i + 1;
          const isSelected = value === v;
          const isSaved = saved !== null && Math.round((saved - 1) / 2) === i;
          return (
            <button
              key={v}
              onClick={() => onChange(v)}
              style={{
                width: 22, height: 22, borderRadius: 6, border: 'none', cursor: 'pointer',
                background: isSelected ? color : isSaved ? color + '55' : 'var(--l3)',
                outline: isSelected ? `2px solid ${color}` : 'none',
                outlineOffset: 1,
                transition: 'background 0.1s, outline 0.1s',
                flexShrink: 0,
              }}
              title={`${label} ${v}/5`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Coach Pulse Card — Option B Full-Width (Wave G)
// ─────────────────────────────────────────────────────────────────────

/**
 * CoachPulseCard · span-12 unified card replacing the old CoachWatchingStrip
 * (span-8) + CheckinReadinessCard (span-4) pair.
 *
 * Left 8-col: pulse dot + "COACH WATCHING" header + coaching statement
 * (readiness message primary, narrative fallback) + 4 live telemetry cells
 * (ACWR / Readiness / Race days / Easy%) + watching chips row.
 *
 * Right 4-col: exact same check-in quick-log wired to the same state logic.
 *
 * Height is always determined by the taller side, so the grid row is
 * always clean — no empty-space gap.
 */
function CoachPulseCard({ data }: { data: OverviewData }) {
  const r = data.coach.readiness.answer;
  const c = data.checkinReadiness;
  const chips = data.aliveCoach.watching;

  // Coaching statement: readiness message is the most contextual single
  // sentence from the coach. Narrative text surfaces priority signals (e.g.
  // "race week" or "ACWR caution"); when both exist, combine them.
  const narrativeText = data.narrative?.sentence ?? null;
  const coachStatement = narrativeText
    ? narrativeText
    : r.message;

  // Telemetry cells.
  const acwr = r.acwr != null ? r.acwr.toFixed(2) : data.load?.value ?? '—';
  const acwrNoData = acwr === '—';
  const acwrColor = acwrNoData ? 'var(--t3)' : r.level === 'green' ? 'var(--good)' : r.level === 'yellow' ? 'var(--att)' : 'var(--warn)';
  const readinessScore = r.level === 'green' ? 88 : r.level === 'yellow' ? 62 : 40;
  const readinessColor = r.level === 'green' ? 'var(--good)' : r.level === 'yellow' ? 'var(--att)' : 'var(--warn)';
  const raceDays = data.races.daysToNextA;
  const easyPct = r.easyShare != null ? `${Math.round(r.easyShare * 100)}%` : '—';
  const easyColor = r.easyShare == null ? 'var(--t3)' : r.easyShare >= 0.8 ? 'var(--good)' : 'var(--att)';
  // Date label for the header — from data.today so it matches the rest of the page.
  const todayLabel = formatFullDateLabel(data.today).toUpperCase();

  // Alert state when ACWR is in caution or check-in is stale.
  const acwrAlert = r.level !== 'green';
  const checkinStaleDays = c ? (7 - c.rowsCount) : null;
  const checkinStale = checkinStaleDays != null && checkinStaleDays >= 3;
  const isAlert = acwrAlert || checkinStale;

  // Check-in state (same logic as CheckinReadinessCard below).
  const [energy, setEnergy] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [savedToday, setSavedToday] = useState<{ energy: number; soreness: number; stress: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(c?.loggedToday ?? false);

  useEffect(() => {
    fetch('/api/health/checkin')
      .then(r => r.json())
      .then((d: { ok: boolean; checkin?: { energy: number; soreness: number; stress: number } | null }) => {
        if (d.ok && d.checkin) { setSavedToday(d.checkin); setSaved(true); }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (energy == null || soreness == null || stress == null) return;
    if (saving) return;
    setSaving(true);
    const toTen = (v: number) => Math.min(10, v * 2 - 1);
    fetch('/api/health/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ energy: toTen(energy), soreness: toTen(soreness), stress: toTen(stress) }),
    })
      .then(r => r.json())
      .then((d: { ok: boolean; checkin?: { energy: number; soreness: number; stress: number } }) => {
        if (d.ok && d.checkin) { setSavedToday(d.checkin); setSaved(true); }
        setSaving(false);
      })
      .catch(() => setSaving(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energy, soreness, stress]);

  const fromTen = (v: number) => Math.round((v - 1) / 2 + 1);

  return (
    <Row style={{ marginBottom: 16 }}>
      <Card span={12} padding="0" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', minHeight: 0 }}>

          {/* ── LEFT · Coach statement + telemetry + chips ── */}
          <div style={{ padding: '18px 22px', borderRight: '1px solid var(--l4)', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  flexShrink: 0,
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isAlert ? 'var(--att)' : '#3EBD41',
                  boxShadow: isAlert ? '0 0 0 0 rgba(243,173,56,.5)' : '0 0 0 0 rgba(62,189,65,.5)',
                  animation: 'pulse-dot 2s infinite ease-out',
                }}
                aria-hidden
              />
              <span style={{
                fontFamily: 'var(--f-data)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '1.6px',
                color: 'var(--t2)',
                textTransform: 'uppercase',
              }}>
                Coach Watching
              </span>
              <span style={{ fontFamily: 'var(--f-data)', fontSize: 9, color: 'var(--t3)', fontWeight: 600 }}>
                · {todayLabel}
              </span>
              {isAlert && (
                <span style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--f-data)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '1.4px',
                  color: 'var(--att)',
                  background: 'rgba(243,173,56,.12)',
                  border: '1px solid rgba(243,173,56,.28)',
                  borderRadius: 5,
                  padding: '3px 8px',
                  textTransform: 'uppercase',
                }}>
                  ▲ SIGNAL GAP
                </span>
              )}
            </div>

            {/* Statement + telemetry side by side — statement left, 4 big numbers right */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--f-display)',
                fontSize: 20,
                fontWeight: 700,
                lineHeight: 1.25,
                color: 'var(--t0)',
                flex: '1 1 0',
                minWidth: 0,
              }}>
                {coachStatement}
              </div>
              {/* 4 telemetry cells — right-aligned within the left column */}
              <div style={{ display: 'flex', gap: 28, flexShrink: 0, alignItems: 'flex-start' }}>
                <CoachTelCell label="ACWR" value={acwr} color={acwrColor} sub="LOAD RATIO" />
                <CoachTelCell label="READINESS" value={String(readinessScore)} color={readinessColor} sub="/ 100" />
                <CoachTelCell label="RACE" value={raceDays != null ? `${raceDays}D` : '—'} color={raceDays != null ? 'var(--race)' : 'var(--t3)'} sub={data.races.nextA?.meta.name?.slice(0, 16).toUpperCase() ?? 'NO RACE SET'} />
                <CoachTelCell label="EASY %" value={easyPct} color={easyColor} sub="14D SHARE" />
              </div>
            </div>

            {/* Watching chips */}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
              {chips.map((chip) => {
                const variantMap: Record<string, { bg: string; border: string; color: string; accent: string }> = {
                  green:  { bg: 'rgba(62,189,65,.10)',    border: 'rgba(62,189,65,.32)',    color: '#7CD97F',        accent: '#3EBD41' },
                  amber:  { bg: 'rgba(243,173,56,.10)',   border: 'rgba(243,173,56,.32)',   color: '#F3AD38',        accent: '#F3AD38' },
                  warn:   { bg: 'rgba(252,77,100,.10)',   border: 'rgba(252,77,100,.32)',   color: '#FC4D64',        accent: '#FC4D64' },
                  muted:  { bg: 'rgba(244,246,248,.04)',  border: 'rgba(244,246,248,.10)',  color: 'var(--t2)',      accent: 'var(--t2)' },
                };
                const vs = variantMap[chip.variant] ?? variantMap.muted;
                return (
                  <div key={chip.id} style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    padding: '7px 11px',
                    minWidth: 86,
                    background: vs.bg,
                    border: `1px solid ${vs.border}`,
                    borderRadius: 9,
                    flexShrink: 0,
                  }}>
                    <span style={{ position: 'absolute', left: 0, top: 5, bottom: 5, width: chip.isFresh ? 3 : 2, background: vs.accent, borderRadius: 2, opacity: chip.isFresh ? 1 : 0.6 }} aria-hidden />
                    <span style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--t2)', textTransform: 'uppercase' }}>{chip.label}</span>
                    <span style={{ fontFamily: 'var(--f-data)', fontSize: 11.5, fontWeight: 700, color: vs.color, letterSpacing: '0.5px' }}>{chip.value}</span>
                    {chip.hint && <span style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, fontWeight: 500, color: 'var(--t3)', letterSpacing: '1px', textTransform: 'uppercase', opacity: 0.7 }}>{chip.hint}</span>}
                  </div>
                );
              })}
            </div>

            {/* Alert strip — only when there's a signal gap */}
            {isAlert && (
              <div style={{
                marginTop: 'auto',
                padding: '7px 12px',
                background: 'rgba(243,173,56,.07)',
                border: '1px solid rgba(243,173,56,.22)',
                borderRadius: 8,
                fontFamily: 'var(--f-data)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '1.2px',
                color: 'var(--att)',
                textTransform: 'uppercase',
              }}>
                {checkinStale
                  ? `▲ CHECK-IN ${checkinStaleDays}D STALE — LOG BEFORE YOUR LONG RUN`
                  : '▲ LOAD IN CAUTION ZONE — ACWR ABOVE 1.20'}
              </div>
            )}
          </div>

          {/* ── RIGHT · Check-in quick-log ── */}
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--f-data)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--att)', textTransform: 'uppercase' }}>
                Check-In
              </span>
              <span style={{
                fontFamily: 'var(--f-data)', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
                padding: '2px 7px', borderRadius: 4,
                background: saved ? 'rgba(62,189,65,.14)' : 'rgba(244,246,248,.07)',
                color: saved ? 'var(--good)' : 'var(--t3)',
              }}>
                {saving ? 'SAVING…' : saved ? 'LOGGED ✓' : c ? `${c.rowsCount}/7 DAYS` : 'LOG TODAY'}
              </span>
            </div>
            {c && (
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 14, fontWeight: 600, lineHeight: 1.2, color: 'var(--t0)' }}>
                {c.headline}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <DotRow label="ENERGY"   metric="energy"   value={energy}   saved={savedToday ? fromTen(savedToday.energy)   : null} onChange={setEnergy}   />
              <DotRow label="SORENESS" metric="soreness" value={soreness} saved={savedToday ? fromTen(savedToday.soreness) : null} onChange={setSoreness} />
              <DotRow label="STRESS"   metric="stress"   value={stress}   saved={savedToday ? fromTen(savedToday.stress)   : null} onChange={setStress}   />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid var(--l4)' }}>
              <span style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, color: 'var(--t3)', fontWeight: 600 }}>
                {energy == null && soreness == null && stress == null ? 'TAP TO LOG' : energy != null && soreness != null && stress != null ? 'ALL SET' : 'KEEP GOING…'}
              </span>
              <a href="/health" style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, color: 'var(--coach)', fontWeight: 700, textDecoration: 'none' }}>
                SEE HEALTH →
              </a>
            </div>
          </div>
        </div>

        {/* Pulse dot keyframe — scoped here so no globals.css edit needed. */}
        <style>{`
          @keyframes pulse-dot {
            0%   { box-shadow: 0 0 0 0 rgba(62,189,65,.55); }
            70%  { box-shadow: 0 0 0 8px rgba(62,189,65,0); }
            100% { box-shadow: 0 0 0 0 rgba(62,189,65,0); }
          }
        `}</style>
      </Card>
    </Row>
  );
}

/** Single telemetry cell — big value, coloured, with label above and sub below. */
function CoachTelCell({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 60 }}>
      <span style={{ fontFamily: 'var(--f-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--t3)', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--f-display)', fontSize: 32, fontWeight: 700, lineHeight: 1, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
      <span style={{ fontFamily: 'var(--f-data)', fontSize: 9, fontWeight: 600, letterSpacing: '1.2px', color: 'var(--t3)', textTransform: 'uppercase' }}>
        {sub}
      </span>
    </div>
  );
}

function CheckinReadinessCard({ data }: { data: OverviewData }) {
  const c = data.checkinReadiness;

  const [energy, setEnergy] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [savedToday, setSavedToday] = useState<{ energy: number; soreness: number; stress: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(c?.loggedToday ?? false);

  // Fetch today's check-in to pre-fill dots.
  useEffect(() => {
    fetch('/api/health/checkin')
      .then(r => r.json())
      .then((d: { ok: boolean; checkin?: { energy: number; soreness: number; stress: number } | null }) => {
        if (d.ok && d.checkin) {
          setSavedToday(d.checkin);
          setSaved(true);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-submit when all 3 are selected (map 1-5 → 1,3,5,7,9 on 1-10 scale).
  useEffect(() => {
    if (energy == null || soreness == null || stress == null) return;
    if (saving) return;
    setSaving(true);
    const toTen = (v: number) => Math.min(10, v * 2 - 1); // 1→1, 2→3, 3→5, 4→7, 5→9
    fetch('/api/health/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ energy: toTen(energy), soreness: toTen(soreness), stress: toTen(stress) }),
    })
      .then(r => r.json())
      .then((d: { ok: boolean; checkin?: { energy: number; soreness: number; stress: number } }) => {
        if (d.ok && d.checkin) { setSavedToday(d.checkin); setSaved(true); }
        setSaving(false);
      })
      .catch(() => setSaving(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energy, soreness, stress]);

  const fromTen = (v: number) => Math.round((v - 1) / 2 + 1); // invert toTen for display

  return (
    <Card span={4} padding="14px 16px" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignSelf: 'start' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--f-data)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--att)', textTransform: 'uppercase' }}>
          Check-In
        </span>
        <span style={{
          fontFamily: 'var(--f-data)', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
          padding: '2px 7px', borderRadius: 4,
          background: saved ? 'rgba(62,189,65,.14)' : 'rgba(244,246,248,.07)',
          color: saved ? 'var(--good)' : 'var(--t3)',
        }}>
          {saving ? 'SAVING…' : saved ? 'LOGGED ✓' : c ? `${c.rowsCount}/7 DAYS` : 'LOG TODAY'}
        </span>
      </div>

      {/* 7-day headline when there's history */}
      {c && (
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 15, fontWeight: 600, lineHeight: 1.2, color: 'var(--t0)' }}>
          {c.headline}
        </div>
      )}

      {/* Quick log — 3 metric rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <DotRow label="ENERGY" metric="energy" value={energy} saved={savedToday ? fromTen(savedToday.energy) : null} onChange={setEnergy} />
        <DotRow label="SORENESS" metric="soreness" value={soreness} saved={savedToday ? fromTen(savedToday.soreness) : null} onChange={setSoreness} />
        <DotRow label="STRESS" metric="stress" value={stress} saved={savedToday ? fromTen(savedToday.stress) : null} onChange={setStress} />
      </div>

      {/* Foot */}
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid var(--l4)' }}>
        <span style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, color: 'var(--t3)', fontWeight: 600 }}>
          {energy == null && soreness == null && stress == null
            ? 'TAP TO LOG'
            : energy != null && soreness != null && stress != null
            ? 'ALL SET'
            : 'KEEP GOING…'}
        </span>
        <a href="/health" style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, color: 'var(--coach)', fontWeight: 700, textDecoration: 'none' }}>
          SEE HEALTH →
        </a>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Biometric spark cards
// ─────────────────────────────────────────────────────────────────────

function SparkHRVCard({ data }: { data: OverviewData }) {
  const b = data.biometrics?.hrv;
  if (!b) return <BiometricEmptyCard label="HRV · 7D AVG" body="AWAITING HEALTHKIT · HRV stream not connected" />;
  return <SimpleSparkCard label="HRV · 7D AVG" {...b} aboveColor="#3EBD41" />;
}
function SparkRHRCard({ data }: { data: OverviewData }) {
  const b = data.biometrics?.rhr;
  if (!b) return <BiometricEmptyCard label="RESTING HR" body="AWAITING HEALTHKIT · RHR stream not connected" />;
  return <SimpleSparkCard label="RESTING HR" {...b} aboveColor="var(--warn)" belowColor="#008FEC" invert />;
}
function SparkEffortCard({ data }: { data: OverviewData }) {
  const b = data.biometrics?.effort;
  if (!b) return <BiometricEmptyCard label="EFFORT · LAST 7D vs PRIOR 7D" body="AWAITING DAILY CHECK-IN · subjective signal not wired" />;
  return <SimpleSparkCard label="EFFORT · LAST 7D vs PRIOR 7D" {...b} valueColor="var(--good)" aboveColor="var(--warn)" belowColor="#3EBD41" invert />;
}

function BiometricEmptyCard({ label, body }: { label: string; body: string }) {
  return (
    <Card span={3} padding="16px 18px" style={{ minHeight: 148, display: 'flex', flexDirection: 'column' }}>
      <CardHeader>
        <CardLabel>{label}</CardLabel>
        <CardPin variant="muted">NO DATA</CardPin>
      </CardHeader>
      <EmptyState variant="empty" title="No data yet" body={body} />
    </Card>
  );
}

/** Parse SVG polyline points-string ("x,y x,y x,y") into a numeric series.
 *  Source y is SVG-inverted (low y = high value), so we flip to make the
 *  bar heights read directly. */
function parseSparkPointsAsSeries(points: string): number[] {
  if (!points) return [];
  const pts = points.trim().split(/\s+/);
  const ys: number[] = [];
  for (const p of pts) {
    const [, ys2] = p.split(',');
    const y = Number(ys2);
    if (Number.isFinite(y)) ys.push(y);
  }
  if (ys.length === 0) return [];
  // Invert: SVG y=0 is top. Pick a fixed ceiling well above observed values.
  const ceiling = 36;
  return ys.map((y) => ceiling - y);
}

function SimpleSparkCard({
  label,
  value,
  unit,
  pinLabel,
  pinVariant,
  footLeft,
  footRight,
  sparkPoints,
  valueColor,
  aboveColor,
  belowColor,
  invert,
}: {
  label: string;
} & NonNullable<OverviewData['biometrics']>['hrv'] & {
  valueColor?: string;
  /** Bar color for points above baseline (or all points if no baseline). */
  aboveColor: string;
  /** Bar color for points at-or-below baseline. */
  belowColor?: string;
  /** If true, parsed series is inverted (used for RHR/effort where lower is better). */
  invert?: boolean;
}) {
  // Convert points-string to bar series. If invert, "good" trends go DOWN; we
  // flip the series so the visual baseline + above/below colors still encode
  // good = green, bad = warn.
  let series = parseSparkPointsAsSeries(sparkPoints);
  if (invert) series = series.map((v) => -v);
  const baseline = series.length ? series.reduce((a, b) => a + b, 0) / series.length : undefined;
  return (
    <Card span={3} padding="16px 18px" style={{ minHeight: 148, display: 'flex', flexDirection: 'column' }}>
      <CardHeader>
        <CardLabel>{label}</CardLabel>
        <CardPin variant={pinVariant}>{pinLabel}</CardPin>
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 42,
          letterSpacing: '-.015em',
          lineHeight: .95,
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
        }}
      >
        {value}
        {unit && <small style={{ fontSize: '.32em', opacity: .5, fontWeight: 700, marginLeft: 7 }}>{unit}</small>}
      </div>
      <div style={{ flex: 1, minHeight: 60, marginTop: 8, marginBottom: 10, display: 'flex' }}>
        <BarSeries
          series={series}
          baseline={baseline}
          aboveColor={aboveColor}
          belowColor={belowColor ?? 'rgba(244,246,248,.22)'}
        />
      </div>
      <CardFoot left={footLeft} right={<span className="delta up">{footRight}</span>} />
    </Card>
  );
}

function SparkSleepCard({ data }: { data: OverviewData }) {
  const s = data.biometrics?.sleep;
  if (!s) return <BiometricEmptyCard label="SLEEP · LAST NIGHT" body="AWAITING HEALTHKIT · Sleep stages not connected" />;
  return (
    <Card span={3} padding="16px 18px" style={{ minHeight: 148 }}>
      <CardHeader>
        <CardLabel>SLEEP · LAST NIGHT</CardLabel>
        <CardPin variant="green">{s.pinLabel}</CardPin>
      </CardHeader>
      <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 42, letterSpacing: '-.015em', lineHeight: .95, fontVariantNumeric: 'tabular-nums' }}>
        {s.value}
        <small style={{ fontSize: '.32em', opacity: .5, fontWeight: 700, marginLeft: 7 }}>{s.unit}</small>
      </div>
      <div style={{ display: 'flex', gap: 2, height: 18, alignItems: 'flex-end', marginTop: 6 }}>
        {s.nights.map((n, i) => (
          <div key={i} style={{ flex: 1, background: n.color, height: `${n.height * 100}%`, borderRadius: 1 }} />
        ))}
      </div>
      <CardFoot left={s.footLeft} right={<span className="delta up">{s.footRight}</span>} />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body systems card
// ─────────────────────────────────────────────────────────────────────

function BodySystemsCard({ data }: { data: OverviewData }) {
  const bs = data.coach.bodySystems.answer;
  const slowest = bs.systems.reduce((m, s) => (s.daysToHealed > m.daysToHealed ? s : m), bs.systems[0]);

  return (
    <Card span={4} padding="20px 22px">
      <CardHeader>
        <CardLabel>YOUR BODY · DAY {bs.daysSincePeakStress} POST-RACE</CardLabel>
        <CardPin variant="coach">{bs.contextLabel}</CardPin>
      </CardHeader>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 14, fontWeight: 600, textTransform: 'uppercase', color: 'var(--t1)' }}>
        {bs.systems.length} systems · {bs.systems.length} timelines
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 8 }}>
        {bs.systems.map((s) => (
          <div
            key={s.id}
            style={{ display: 'grid', gridTemplateColumns: '14px 1fr 70px 56px', gap: 10, alignItems: 'center', fontSize: 12 }}
          >
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: s.state === 'done' ? 'var(--good)' : 'var(--coach)' }} />
            <div>
              <div style={{ color: 'var(--t1)', fontWeight: 600 }}>
                {s.label}{' '}
                <span style={{ color: 'var(--t3)', fontWeight: 500, fontSize: 11 }}>· {s.windowLabel}</span>
              </div>
              <div
                style={{
                  fontFamily: 'var(--f-data)',
                  fontSize: 9.5,
                  color: s.state === 'done' ? 'var(--good)' : 'var(--coach)',
                  fontWeight: 700,
                  letterSpacing: '.4px',
                  marginTop: 2,
                }}
              >
                {s.state === 'done' && s.daysToHealed === 0
                  ? `✓ HEALED`
                  : `→ HEALED ${formatDateLabel(s.healedByISO ?? data.today, true)} · ${s.daysToHealed}d`}
              </div>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--l3)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(s.readiness * 100)}%`,
                  background: s.state === 'done' ? 'var(--good)' : 'var(--coach)',
                  borderRadius: 3,
                }}
              />
            </div>
            <div
              style={{
                fontFamily: 'var(--f-data)',
                fontSize: 10,
                fontWeight: 700,
                textAlign: 'right',
                color: s.state === 'done' ? 'var(--good)' : 'var(--coach)',
              }}
            >
              {Math.round(s.readiness * 100)}%
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: '10px 12px',
          background: 'rgba(39,180,224,.08)',
          border: '1px solid rgba(39,180,224,.25)',
          borderRadius: 6,
          marginTop: 'auto',
        }}
      >
        <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.4px', color: 'var(--coach)', fontWeight: 700, textTransform: 'uppercase' }}>
          Quality work returns
        </div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 600, textTransform: 'uppercase', lineHeight: 1.1, marginTop: 3 }}>
          ~ {formatDateLabel(bs.qualityReturnsISO, true)} · {slowest.daysToHealed} days
        </div>
        <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, color: 'var(--t3)', fontWeight: 600, letterSpacing: '.4px', marginTop: 3 }}>
          when slowest system ({slowest.label.toLowerCase()}) hits 100%
        </div>
      </div>

      <CardFoot left={<span style={{ color: 'var(--warn)' }}>▲ HARD STRETCH</span>} right={<span>SEE HEALTH →</span>} />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Pace zones card
// ─────────────────────────────────────────────────────────────────────

function PaceZonesCard({ data }: { data: OverviewData }) {
  const p = data.paceZones;
  if (!p) {
    return (
      <Card span={5} padding="18px 20px">
        <CardHeader>
          <CardLabel>PACE ZONES</CardLabel>
          <CardPin variant="muted">NO VDOT</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No VDOT anchored yet"
          body="Log a recent 5K, 10K, or HM to anchor your pace zones. Daniels VDOT needs a canonical race result inside the last 8 weeks."
        />
      </Card>
    );
  }
  const zoneClass: Record<PaceZone['letter'], string> = { E: 'E', M: 'M', T: 'T', I: 'I', R: 'R' };
  return (
    <Card span={5} padding="18px 20px">
      <CardHeader>
        <CardLabel>PACE ZONES · {p.source}</CardLabel>
        <CardPin variant="blue">{p.raceAnchor}</CardPin>
      </CardHeader>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 14, fontWeight: 600, textTransform: 'uppercase', color: 'var(--t1)' }}>
        Anchored on demonstrated peak
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, marginTop: 10 }}>
        {p.zones.map((z) => (
          <div key={z.letter} className={`zone ${zoneClass[z.letter]}`} style={{ padding: '10px 8px', borderRadius: 7 }}>
            <div className="z" style={{ fontFamily: 'var(--f-data)', fontSize: 10, letterSpacing: '1.4px', fontWeight: 700 }}>
              {z.letter}
            </div>
            <div className="lab" style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, color: 'var(--t3)', letterSpacing: '.8px', marginTop: 2, fontWeight: 600, textTransform: 'uppercase' }}>
              {z.label}
            </div>
            <div className="v" style={{ fontFamily: 'var(--f-display)', fontSize: 17, fontWeight: 700, marginTop: 5, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {z.value}
              {z.rangeSuffix && <small style={{ fontSize: '.55em', opacity: .5, fontWeight: 700 }}>{z.rangeSuffix}</small>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--l4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.4px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>
            Distribution · 14 days
          </div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 10.5, letterSpacing: '1.4px', color: 'var(--good)', fontWeight: 700 }}>
            92% EASY / 8% HARD ✓
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {p.distribution.map((d) => (
            <div
              key={d.zoneLetter}
              style={{
                display: 'grid',
                gridTemplateColumns: '88px 1fr 96px',
                gap: 12,
                alignItems: 'center',
                opacity: d.muted ? .42 : 1,
              }}
            >
              <div style={{ fontFamily: 'var(--f-data)', fontSize: 11, color: d.color, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase' }}>
                {d.label}
              </div>
              <div style={{ height: 10, background: 'var(--l3)', borderRadius: 5, overflow: 'hidden' }}>
                {d.barFraction > 0 && (
                  <div
                    style={{
                      width: `${Math.max(d.barFraction * 100, 4)}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, ${d.color}, ${d.color}80)`,
                      borderRadius: 5,
                    }}
                  />
                )}
              </div>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 700, lineHeight: 1, textAlign: 'right', letterSpacing: '-.01em', fontVariantNumeric: 'tabular-nums', color: d.muted ? 'var(--t3)' : 'var(--t0)' }}>
                {d.timeDisplay}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'var(--t2)', marginTop: 14, letterSpacing: '.4px', fontWeight: 600, lineHeight: 1.5 }}>
          {p.shareLine}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          paddingTop: 12,
          marginTop: 'auto',
          borderTop: '1px solid var(--l4)',
          fontFamily: 'var(--f-data)',
          fontSize: 10,
          letterSpacing: '.6px',
          color: 'var(--t2)',
          fontWeight: 600,
        }}
      >
        <div>
          CURRENT FITNESS · <b style={{ color: 'var(--good)' }}>{p.currentFitnessPace}</b>
          <br />
          <span style={{ color: 'var(--t3)', fontSize: 9 }}>FROM {p.raceAnchor}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          GOAL · <b style={{ color: 'var(--race)' }}>{p.goalPace}</b>
          <br />
          <span style={{ color: 'var(--t3)', fontSize: 9 }}>{p.headroomS}s/MI HEADROOM</span>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// VDOT card
// ─────────────────────────────────────────────────────────────────────

function VdotCard({ data }: { data: OverviewData }) {
  const v = data.vdot;
  if (!v) {
    return (
      <Card span={3} padding="20px 22px" style={{ minHeight: 148 }}>
        <CardHeader>
          <CardLabel>VDOT · AGE-GRADED</CardLabel>
          <CardPin variant="muted">NO DATA</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No VDOT yet"
          body="Log a recent 5K / 10K / HM to anchor VDOT. Daniels lookup needs a canonical race time."
        />
      </Card>
    );
  }
  return (
    <Card span={3} padding="20px 22px" style={{ background: 'linear-gradient(135deg, var(--corp) 0%, var(--xp) 100%)', border: 0, minHeight: 148 }}>
      <CardHeader>
        <div style={{ color: 'rgba(255,255,255,.78)', fontFamily: 'var(--f-data)', fontSize: 10, letterSpacing: '1.8px', textTransform: 'uppercase', fontWeight: 700 }}>
          VDOT · AGE-GRADED
        </div>
        <span style={{ background: 'rgba(255,255,255,.16)', color: '#fff', fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.4px', textTransform: 'uppercase', padding: '3px 7px', borderRadius: 4, fontWeight: 700 }}>
          FRESH
        </span>
      </CardHeader>
      <div style={{ marginTop: 14 }}>
        <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 112, lineHeight: .9, letterSpacing: '-.04em', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
          {v.value}
        </div>
        <div style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'rgba(255,255,255,.78)', fontWeight: 700, letterSpacing: '.6px', marginTop: 12 }}>
          {v.detailLine}
        </div>
      </div>

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-data)', fontSize: 8.5, letterSpacing: '1.2px', color: 'rgba(255,255,255,.65)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
          {v.tiers.map((t, i) => (
            <span key={i} style={{ color: t.active ? '#fff' : undefined }}>
              {t.label}
            </span>
          ))}
        </div>
        <div style={{ position: 'relative', height: 5, background: 'rgba(255,255,255,.16)', borderRadius: 3, overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              left: `${v.bandPosition * 100}%`,
              top: 0,
              bottom: 0,
              width: `${v.bandWidth * 100}%`,
              background: 'rgba(255,255,255,.85)',
              borderRadius: 3,
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-data)', fontSize: 8, color: 'rgba(255,255,255,.55)', fontWeight: 700, marginTop: 4 }}>
          {v.scaleLabels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.18)' }}>
        <div style={{ fontFamily: 'var(--f-data)', fontSize: 9, letterSpacing: '1.3px', color: 'rgba(255,255,255,.7)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
          EQUIVALENT RACE TIMES
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {v.equivalents.map((eq) => (
            <div
              key={eq.distance}
              style={{
                textAlign: 'center',
                padding: '6px 2px',
                background: eq.isGoal ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.10)',
                borderRadius: 4,
                outline: eq.isGoal ? '1px solid rgba(255,255,255,.4)' : undefined,
              }}
            >
              <div style={{ fontFamily: 'var(--f-data)', fontSize: 8.5, color: eq.isGoal ? '#fff' : 'rgba(255,255,255,.6)', fontWeight: 700, letterSpacing: '1px' }}>
                {eq.distance}
              </div>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 700, lineHeight: 1, marginTop: 2, color: '#fff' }}>
                {eq.time}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 10, fontFamily: 'var(--f-data)', fontSize: 10, color: 'rgba(255,255,255,.78)', letterSpacing: '.4px', fontWeight: 600 }}>
        {v.source}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Load gauge
// ─────────────────────────────────────────────────────────────────────

function LoadGaugeCard({ data }: { data: OverviewData }) {
  const l = data.load;
  if (!l) {
    return (
      <Card span={3} padding="14px 16px" style={{ display: 'flex', flexDirection: 'column', minHeight: 108 }}>
        <CardHeader>
          <CardLabel>RECENT vs TYPICAL LOAD</CardLabel>
          <CardPin variant="muted">NO DATA</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No load signal yet"
          body="ACWR needs at least 7 days of recent volume and an 8-week baseline. Log runs to see the load gauge."
        />
      </Card>
    );
  }
  const valueColor = l.pinVariant === 'green' ? 'var(--good)' : l.pinVariant === 'amber' ? 'var(--att)' : 'var(--warn)';
  return (
    <Card span={3} padding="14px 16px" style={{ display: 'flex', flexDirection: 'column', minHeight: 108 }}>
      <CardHeader>
        <CardLabel>RECENT vs TYPICAL LOAD</CardLabel>
        <CardPin variant={l.pinVariant}>{l.pinLabel}</CardPin>
      </CardHeader>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 8 }}>
        <svg viewBox="0 0 100 60" style={{ width: 140, height: 84, flexShrink: 0 }}>
          <path d="M 10 50 A 40 40 0 0 1 26 18" fill="none" stroke="#646464" strokeWidth={9} />
          <path d="M 26 18 A 40 40 0 0 1 74 18" fill="none" stroke="#3EBD41" strokeWidth={9} />
          <path d="M 74 18 A 40 40 0 0 1 90 50" fill="none" stroke="#FC4D64" strokeWidth={9} />
          <line x1={50} y1={50} x2={56} y2={18} stroke="#F4F6F8" strokeWidth={2.2} strokeLinecap="round" />
          <circle cx={50} cy={50} r={3.5} fill="#F4F6F8" />
        </svg>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 48, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: valueColor }}>
            {l.value}
          </div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700, marginTop: 6 }}>
            {l.bandLine}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--l4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>
            4-week trend
          </div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '.8px', color: 'var(--good)', fontWeight: 700 }}>
            {l.trendLabel}
          </div>
        </div>
        <div style={{ width: '100%', height: 38, display: 'flex' }}>
          <BarSeries
            series={l.trend}
            baseline={1}
            aboveColor="#3EBD41"
            belowColor="rgba(62,189,65,.45)"
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-data)', fontSize: 8.5, letterSpacing: '.8px', color: 'var(--t3)', fontWeight: 700, marginTop: 4 }}>
          {l.trend.map((v, i) => (
            <span key={i} style={{ color: i === l.trend.length - 1 ? 'var(--good)' : undefined }}>{v.toFixed(2)}</span>
          ))}
        </div>
      </div>

      <CardFoot left="LAST 7D vs LAST 28D" right={<span className="delta up">SUSTAINABLE</span>} />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Weekly miles + Long-run strip cards
// ─────────────────────────────────────────────────────────────────────

function WeeklyMilesCard({ data }: { data: OverviewData }) {
  const w = data.weeklyMilesStrip;
  if (!w) {
    return (
      <Card span={3} padding="14px 16px" style={{ display: 'flex', flexDirection: 'column' }}>
        <CardHeader>
          <CardLabel>WEEKLY MILES · 4 PAST + 4 AHEAD</CardLabel>
          <CardPin variant="muted">NO DATA</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No weekly history yet"
          body="Connect Strava or log this week's runs to see the weekly-miles strip."
        />
      </Card>
    );
  }
  const maxMi = Math.max(...w.bars.map((b) => b.miles), 1);
  return (
    <Card span={3} padding="14px 16px" style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHeader>
        <CardLabel>WEEKLY MILES · 4 PAST + 4 AHEAD</CardLabel>
        <CardPin variant="green">{w.pinLabel}</CardPin>
      </CardHeader>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 30, fontWeight: 700, lineHeight: 1, color: 'var(--att)', fontVariantNumeric: 'tabular-nums' }}>
          {w.thisWeekMi}
          <small style={{ fontSize: '.4em', opacity: .55, fontWeight: 700, marginLeft: 7 }}>MI</small>
        </div>
        <div style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.6px' }}>
          THIS WK · PROJECTED
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${w.bars.length}, 1fr)`, gap: 3, marginTop: 14, height: 84, alignItems: 'end' }}>
        {w.bars.map((b, i) => (
          <BarCell key={i} bar={b} maxMi={maxMi} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${w.bars.length}, 1fr)`, gap: 3, marginTop: 6, fontFamily: 'var(--f-data)', fontSize: 8, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.3px', textAlign: 'center' }}>
        {w.bars.map((b, i) => (
          <span
            key={i}
            style={{
              color: b.kind === 'now' ? 'var(--att)' : b.kind === 'past-race' ? 'var(--race)' : undefined,
            }}
          >
            {b.date}
          </span>
        ))}
      </div>
      <CardFoot left={w.peakLabel} right={<span className="delta up">{w.footRight}</span>} />
    </Card>
  );
}

function LongRunCard({ data }: { data: OverviewData }) {
  const lr = data.longRunStrip;
  if (!lr) {
    return (
      <Card span={3} padding="14px 16px" style={{ display: 'flex', flexDirection: 'column' }}>
        <CardHeader>
          <CardLabel>LONG RUN · 6 PAST + 4 AHEAD</CardLabel>
          <CardPin variant="muted">NO DATA</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No long-run history yet"
          body="Log at least one run to start the long-run progression chart."
        />
      </Card>
    );
  }
  const maxMi = Math.max(...lr.bars.map((b) => b.miles), 1);
  return (
    <Card span={3} padding="14px 16px" style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHeader>
        <CardLabel>LONG RUN · 6 PAST + 4 AHEAD</CardLabel>
        <CardPin variant="blue">{lr.pinLabel}</CardPin>
      </CardHeader>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 30, fontWeight: 700, lineHeight: 1, color: 'var(--att)', fontVariantNumeric: 'tabular-nums' }}>
          {lr.nextMi}
          <small style={{ fontSize: '.4em', opacity: .55, fontWeight: 700, marginLeft: 7 }}>MI</small>
        </div>
        <div style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.6px' }}>
          {lr.nextLabel}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${lr.bars.length}, 1fr)`, gap: 3, marginTop: 14, height: 84, alignItems: 'end' }}>
        {lr.bars.map((b, i) => (
          <BarCell key={i} bar={b} maxMi={maxMi} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${lr.bars.length}, 1fr)`, gap: 3, marginTop: 6, fontFamily: 'var(--f-data)', fontSize: 8, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.3px', textAlign: 'center' }}>
        {lr.bars.map((b, i) => (
          <span key={i} style={{ color: b.kind === 'now' ? 'var(--att)' : b.kind === 'past-race' ? 'var(--race)' : undefined }}>
            {b.date}
          </span>
        ))}
      </div>
      <CardFoot left={lr.footLeft} right={<span className="delta up">{lr.footRight}</span>} />
    </Card>
  );
}

function BarCell({ bar, maxMi }: { bar: { miles: number; kind: 'past' | 'past-race' | 'now' | 'future' }; maxMi: number }) {
  const pct = Math.max((bar.miles / maxMi) * 100, 4);
  let bg = 'linear-gradient(180deg,rgba(0,143,236,.55),rgba(0,143,236,.25))';
  let border: string | undefined;
  let outline: string | undefined;
  let labelColor: string = 'var(--t3)';
  if (bar.kind === 'past-race') {
    bg = 'linear-gradient(180deg,var(--race),rgba(255,87,34,.4))';
    labelColor = 'var(--race)';
  } else if (bar.kind === 'now') {
    bg = 'linear-gradient(180deg,var(--att),rgba(243,173,56,.4))';
    outline = '2px solid var(--att)';
    labelColor = 'var(--att)';
  } else if (bar.kind === 'future') {
    bg = 'rgba(62,189,65,.30)';
    border = '1px dashed rgba(62,189,65,.5)';
    labelColor = 'var(--good)';
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        height: '100%',
        justifyContent: 'flex-end',
        outline,
        outlineOffset: outline ? 2 : undefined,
        borderRadius: 2,
      }}
    >
      <span style={{ fontFamily: 'var(--f-data)', fontSize: 9, fontWeight: 700, color: labelColor }}>{bar.miles || '—'}</span>
      <div style={{ width: '100%', background: bg, height: `${pct}%`, borderRadius: '2px 2px 0 0', border, boxSizing: 'border-box' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// UP NEXT B-race card
// ─────────────────────────────────────────────────────────────────────

function UpNextBRaceCard({ data }: { data: OverviewData }) {
  const b = data.coach.raceFitnessB;
  const bRace = data.races.nextB;
  if (!bRace || !b) {
    return (
      <Card span={3} padding="14px 16px" style={{ display: 'flex', flexDirection: 'column' }}>
        <CardHeader>
          <CardLabel>UP NEXT · B-RACE</CardLabel>
          <CardPin variant="muted">NONE</CardPin>
        </CardHeader>
        <EmptyState variant="empty" title="No B-race in window" body="Add a tune-up race to sharpen toward your A-race." />
      </Card>
    );
  }
  const headroom = Math.round(b.answer.headroomSPerMi * 6.2);
  return (
    <Card span={3} padding="14px 16px" style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHeader>
        <CardLabel>UP NEXT · B-RACE</CardLabel>
        <CardPin variant="race">{daysUntilSimple(bRace.meta.date)}D</CardPin>
      </CardHeader>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 26, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-.01em', lineHeight: 1, marginTop: 4 }}>
        {bRace.meta.name}
      </div>
      <div style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'var(--t3)', letterSpacing: '1px', fontWeight: 700, marginTop: 5, textTransform: 'uppercase' }}>
        {formatDateLabel(bRace.meta.date)} · {labelForDistance(bRace.meta.distanceMi)} · {bRace.meta.distanceMi.toFixed(1)} MI
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--l4)' }}>
        <div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>Goal</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 30, fontWeight: 700, lineHeight: 1, marginTop: 6, color: 'var(--race)', fontVariantNumeric: 'tabular-nums' }}>
            {b.answer.goalDisplay}
          </div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, color: 'var(--t2)', fontWeight: 600, letterSpacing: '.4px', marginTop: 5 }}>
            {fmtPaceLoose(b.answer.goalPaceSPerMi)}/MI
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>Fitness predicts</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 30, fontWeight: 700, lineHeight: 1, marginTop: 6, color: 'var(--t1)', fontVariantNumeric: 'tabular-nums' }}>
            {b.answer.predictedDisplay}
          </div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, color: headroom > 0 ? 'var(--good)' : 'var(--warn)', fontWeight: 700, letterSpacing: '.4px', marginTop: 5 }}>
            {headroom > 0 ? `+${headroom}s HEADROOM` : `${headroom}s SHORT`}
          </div>
        </div>
      </div>
      <CardFoot left="TUNE-UP" right={<span className="delta up">▲ {b.answer.confidence.toUpperCase()}</span>} />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Year in Running + YTD
// ─────────────────────────────────────────────────────────────────────

function YearInRunningCard({ data }: { data: OverviewData }) {
  const y = data.year;
  return (
    <Card span={8} padding="18px 22px">
      <CardHeader>
        <CardLabel>YEAR IN RUNNING · 2026</CardLabel>
        <div style={{ display: 'flex', gap: 18, fontFamily: 'var(--f-data)', fontSize: 11, letterSpacing: '1.4px', fontWeight: 700, textTransform: 'uppercase' }}>
          {y.topStats.map((s) => (
            <span key={s.label}>
              <b style={{ color: 'var(--t0)', fontSize: 13 }}>{s.value}</b> {s.label}
            </span>
          ))}
        </div>
      </CardHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(52, 1fr)', gap: 2, marginTop: 8 }}>
        {y.heatmap.map((cell, i) => (
          <div
            key={i}
            style={{
              aspectRatio: '1 / 1',
              background: cell.isFutureRace ? 'rgba(255,87,34,.18)' : cell.color,
              border: cell.isFutureRace ? '1px dashed var(--race)' : undefined,
              outline: cell.isToday ? '2px solid var(--att)' : undefined,
              outlineOffset: cell.isToday ? 1 : undefined,
              borderRadius: 2,
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-data)', fontSize: 9, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700, marginTop: 8 }}>
        {['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>

      {/* Monthly bars */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--l4)' }}>
        <div style={{ marginBottom: 12 }}>
          <CardLabel>MONTHLY VOLUME · 2026</CardLabel>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 5, alignItems: 'end', height: 88 }}>
          {y.monthly.map((m, i) => {
            const maxMi = Math.max(...y.monthly.map((x) => x.miles ?? 0), 1);
            const pct = m.miles != null ? Math.max((m.miles / maxMi) * 100, 4) : 4;
            const isCurrent = m.isCurrent;
            const opacity = m.isFuture ? .35 : 1;
            const bg = isCurrent
              ? 'linear-gradient(180deg,rgba(0,143,236,.7),rgba(0,143,236,.35))'
              : m.isFuture
              ? 'var(--l3)'
              : 'linear-gradient(180deg,rgba(62,189,65,.6),rgba(62,189,65,.3))';
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end', opacity }}>
                <span style={{ fontFamily: 'var(--f-data)', fontSize: 10, fontWeight: 700, color: isCurrent ? 'var(--corp)' : 'var(--t1)' }}>
                  {m.miles ?? '—'}
                </span>
                <div style={{ width: '100%', background: bg, height: `${pct}%`, borderRadius: '3px 3px 0 0', minHeight: 6, outline: isCurrent ? '1px dashed rgba(0,143,236,.5)' : undefined, outlineOffset: isCurrent ? 1 : undefined, boxSizing: 'border-box' }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 5, marginTop: 6, paddingTop: 8, borderTop: '1px solid var(--l4)' }}>
          {y.monthly.map((m) => (
            <div key={m.label} style={{ textAlign: 'center', fontFamily: 'var(--f-data)', fontSize: 9, letterSpacing: '1.2px', color: m.isCurrent ? 'var(--corp)' : m.isFuture ? 'var(--t3)' : 'var(--t2)', fontWeight: 700, textTransform: 'uppercase' }}>
              {m.label}
            </div>
          ))}
        </div>
      </div>

      {/* Highlights */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--l4)' }}>
        {y.highlights.map((h, i) => (
          <div key={i}>
            <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.4px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>{h.label}</div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 36, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1, marginTop: 6, color: h.color }}>
              {h.value}
              {h.unit && <span style={{ fontSize: '.4em', opacity: .5, fontWeight: 700, marginLeft: 7 }}>{h.unit}</span>}
            </div>
            <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, color: 'var(--t2)', fontWeight: 600, letterSpacing: '.5px', marginTop: 5 }}>{h.meta}</div>
          </div>
        ))}
      </div>

      {/* PR shelf */}
      <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--l4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <CardLabel>PERSONAL BESTS · 2026</CardLabel>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.4px', color: 'var(--good)', fontWeight: 700 }}>
            {y.prs.length} NEW PRs THIS YEAR
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${y.prs.length}, 1fr)`, gap: 10 }}>
          {y.prs.map((p, i) => (
            <div key={i} style={{ padding: '14px 16px', background: 'var(--l2)', border: '1px solid var(--l4)', borderRadius: 8 }}>
              <div style={{ fontFamily: 'var(--f-data)', fontSize: 10, letterSpacing: '1.4px', color: 'var(--t2)', fontWeight: 700, textTransform: 'uppercase' }}>
                {p.distance}
              </div>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 32, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
                {p.time}
              </div>
              <div style={{ fontFamily: 'var(--f-data)', fontSize: 9, color: 'var(--t2)', fontWeight: 600, letterSpacing: '.4px', marginTop: 6, whiteSpace: 'nowrap' }}>
                {p.meta}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function YtdCard({ data }: { data: OverviewData }) {
  const y = data.year.ytd;
  if (!y) {
    return (
      <Card span={4} padding="24px 26px" style={{ display: 'flex', flexDirection: 'column' }}>
        <CardHeader>
          <CardLabel>YTD · 2026</CardLabel>
          <CardPin variant="muted">NO DATA</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No YTD rollup yet"
          body="Connect Strava to see year-to-date miles, time-on-feet, elevation, and pace stats."
        />
      </Card>
    );
  }
  const dashOffset = 251 - (251 * y.pctOfYear) / 100;
  return (
    <Card span={4} padding="24px 26px" style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHeader>
        <CardLabel>YTD · 2026</CardLabel>
        <CardPin variant="blue">DAY {y.dayOfYear}/365</CardPin>
      </CardHeader>

      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 18 }}>
        <svg viewBox="0 0 100 100" style={{ width: 128, height: 128, flexShrink: 0 }}>
          <circle cx={50} cy={50} r={40} fill="none" stroke="#212D3F" strokeWidth={9} />
          <circle cx={50} cy={50} r={40} fill="none" stroke="#008FEC" strokeWidth={9} strokeDasharray={251} strokeDashoffset={dashOffset} transform="rotate(-90 50 50)" strokeLinecap="round" />
          <text x={50} y={50} textAnchor="middle" fontFamily="Oswald" fontWeight={700} fontSize={24} fill="#F4F6F8">
            {y.pctOfYear}
            <tspan fontSize={12}>%</tspan>
          </text>
          <text x={50} y={64} textAnchor="middle" fontFamily="JetBrains Mono" fontWeight={700} fontSize={6.5} fill="#008FEC" letterSpacing={1.2}>
            YR
          </text>
        </svg>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 64, letterSpacing: '-.02em', lineHeight: .92, fontVariantNumeric: 'tabular-nums' }}>
            {y.miles}
            <span style={{ fontSize: '.32em', opacity: .5, fontWeight: 700, marginLeft: 10 }}>mi</span>
          </div>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 11, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.6px', marginTop: 8 }}>
            DAY {y.dayOfYear} · {y.pctOfYear}% INTO 2026
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 5,
          background: 'rgba(62,189,65,.14)',
          fontFamily: 'var(--f-data)',
          fontSize: 11,
          color: 'var(--good)',
          fontWeight: 700,
          letterSpacing: '.6px',
          marginTop: 14,
        }}
      >
        {y.vsLastYearDelta != null ? `▲ +${y.vsLastYearDelta} MI vs 2025 SAME DAY` : 'NO 2025 BASELINE'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--l4)' }}>
        <YtdStatTile
          label="vs 2025 SAME DAY"
          value={y.vsLastYearMi != null ? String(y.vsLastYearMi) : '—'}
          delta={y.vsLastYearDelta != null ? `+${y.vsLastYearDelta} ▲` : 'NO DATA'}
        />
        <YtdStatTile
          label="PROJECTED EOY"
          value={y.projectedEoyMi.toLocaleString()}
          delta={y.projectedDelta != null ? `+${y.projectedDelta} ▲` : '—'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px', marginTop: 'auto', paddingTop: 18, borderTop: '1px solid var(--l4)' }}>
        <YearFactCell label="Time on feet" value={String(y.timeOnFeetHr)} unit="hr" meta="HOURS LOGGED" />
        <YearFactCell label="Elevation gain" value={String(y.elevationGainKFt)} unit="k ft" meta="GAIN THIS YEAR" align="right" />
        <YearFactCell label="Avg pace" value={y.avgPace ?? '—'} unit="/mi" meta={y.avgPaceVs2025 ?? 'NO 2025 BASELINE'} />
        <YearFactCell label="Calories" value={y.caloriesK != null ? String(y.caloriesK) : '—'} unit="k" meta={y.caloriesEquiv ?? 'NEEDS BODY-WEIGHT + HR'} align="right" />
      </div>
    </Card>
  );
}

function YtdStatTile({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div style={{ padding: 14, background: 'var(--l2)', borderRadius: 8 }}>
      <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 30, fontWeight: 700, lineHeight: 1, letterSpacing: '-.01em' }}>{value}</div>
        <div style={{ fontFamily: 'var(--f-data)', fontSize: 12, color: 'var(--good)', fontWeight: 700, letterSpacing: '.5px' }}>{delta}</div>
      </div>
    </div>
  );
}

function YearFactCell({ label, value, unit, meta, align = 'left' }: { label: string; value: string; unit: string; meta: string; align?: 'left' | 'right' }) {
  return (
    <div style={{ textAlign: align }}>
      <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 700, lineHeight: 1, letterSpacing: '-.01em', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
        {value}
        <span style={{ fontSize: '.4em', opacity: .5, marginLeft: 7 }}>{unit}</span>
      </div>
      <div style={{ fontFamily: 'var(--f-data)', fontSize: 9, color: 'var(--t2)', fontWeight: 600, letterSpacing: '.4px', marginTop: 4 }}>{meta}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Skeleton fallback
// ─────────────────────────────────────────────────────────────────────

function OverviewSkeleton() {
  return (
    <>
      <Row>
        <Card span={6} padding="26px 28px" style={{ minHeight: 340 }}>
          <Skeleton height={14} width="40%" />
          <Skeleton height={48} width="60%" />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="85%" />
        </Card>
        <Card span={3} padding="24px 26px" style={{ minHeight: 340 }}>
          <Skeleton height={14} width="60%" />
          <Skeleton height={220} borderRadius={110} />
        </Card>
        <Card span={3} padding="24px 26px" style={{ minHeight: 340 }}>
          <Skeleton height={14} width="50%" />
          <Skeleton height={56} width="80%" />
          <Skeleton height={14} width="90%" />
        </Card>
      </Row>
      <Row>
        <Card span={12} padding="18px 22px">
          <Skeleton height={36} width="40%" />
          <Skeleton height={120} />
        </Card>
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers (display-only, kept in this file to keep data.ts pure)
// ─────────────────────────────────────────────────────────────────────

function KpiCell({
  label,
  value,
  unit,
  sub,
  valueFontSize = 32,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  valueFontSize?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--t3)', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: valueFontSize, letterSpacing: '-.015em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {value}
        {unit && <small style={{ fontSize: '.4em', opacity: .55, fontWeight: 700, marginLeft: 7 }}>{unit}</small>}
      </div>
      <div style={{ fontFamily: 'var(--f-data)', fontSize: 9, letterSpacing: '1.3px', color: 'var(--t2)', fontWeight: 700 }}>
        {sub}
      </div>
    </div>
  );
}

/** Map a plan WorkoutType to its display label for the Today card heading. */
function planWorkoutTypeLabel(type: string): string {
  switch (type) {
    case 'easy':      return 'Easy Run';
    case 'long':      return 'Long Run';
    case 'threshold': return 'Threshold Tempo';
    case 'interval':  return 'VO₂ Max Intervals';
    case 'mp':        return 'Marathon Pace';
    case 'race':      return 'Race';
    case 'shakeout':  return 'Shakeout';
    case 'recovery':  return 'Recovery Run';
    case 'rest':      return 'Rest';
    default:          return 'Easy Run';
  }
}

function fmtPaceRange(range: { lower: number; upper: number }): string {
  return `${fmtPaceLoose(range.lower)}–${fmtPaceLoose(range.upper)}`;
}

function fmtPaceLoose(sPerMi: number): string {
  if (!isFinite(sPerMi) || sPerMi <= 0) return '—';
  const mm = Math.floor(sPerMi / 60);
  const ss = Math.round(sPerMi - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function estimateDurationMin(w: { distanceMi: number; paceTargetSPerMi?: { lower: number; upper: number } | null }): number {
  if (!w.paceTargetSPerMi || w.distanceMi <= 0) return 28;
  const pace = (w.paceTargetSPerMi.lower + w.paceTargetSPerMi.upper) / 2;
  return Math.round((pace * w.distanceMi) / 60);
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
  return (
    <>
      {dow} · {date} · <b>{time}</b>
    </>
  );
}

function formatDateLabel(iso: string, short = false): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return short
    ? `${months[Number(m[2]) - 1]} ${Number(m[3])}`
    : `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function formatFullDateLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const d = new Date(iso + 'T12:00:00');
  return `${dow[d.getDay()]} ${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function daysUntilSimple(iso: string): number {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((d.getTime() - today.getTime()) / 86_400_000));
}

function labelForDistance(mi: number): string {
  if (mi >= 24) return 'MARATHON';
  if (mi >= 12) return 'HALF MARATHON';
  if (mi >= 6) return '10K';
  if (mi >= 3) return '5K';
  return `${mi.toFixed(1)} MI`;
}

function labelOfWorkout(label: string): string {
  return label || 'Easy';
}

function readinessShortLabel(r: { level: 'green' | 'yellow' | 'red'; easyShare: number | null; acwr: number | null }): string {
  if (r.level === 'green') return '▲ BUILDING';
  if (r.level === 'yellow') return '— HOLD';
  return '▼ REST DAY';
}

function shortMonthDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function countLoggedRuns(days: Array<{ actualMi: number | null }>): number {
  return days.filter((d) => d.actualMi != null && d.actualMi > 0).length;
}

function capitalize(s: string): string {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}

type PaceZone = import('./data').PaceZone;

// ─────────────────────────────────────────────────────────────────────
// BarSeries — canonical bar sparkline (copied inline from health/page.tsx).
// DO NOT MODIFY — this is the locked reference component.
// ─────────────────────────────────────────────────────────────────────

function BarSeries({
  series,
  baseline,
  aboveColor,
  belowColor,
  xLabels,
  xLabelIndices,
}: {
  series: number[];
  baseline?: number;
  aboveColor: string;
  belowColor: string;
  xLabels?: string[];
  xLabelIndices?: number[];
}) {
  if (series.length === 0) return <div style={{ flex: 1, minHeight: 60 }} />;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(1, max - min);
  const yMin = baseline !== undefined ? Math.min(min, baseline) - (range * 0.15) : min - (range * 0.1);
  const yMax = Math.max(max, baseline ?? max) + (range * 0.1);
  const yRange = Math.max(1, yMax - yMin);
  const baselinePct = baseline !== undefined ? ((baseline - yMin) / yRange) * 100 : null;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 60 }}>
      <div
        style={{
          flex: 1,
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: `repeat(${series.length}, 1fr)`,
          gap: Math.max(1, Math.floor(40 / series.length)),
          alignItems: 'end',
          minHeight: 60,
        }}
      >
        {baselinePct !== null && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: `${baselinePct}%`,
              height: 0,
              borderTop: `1px dashed ${aboveColor}`,
              opacity: 0.35,
              pointerEvents: 'none',
            }}
          />
        )}
        {series.map((v, i) => {
          const hPct = ((v - yMin) / yRange) * 100;
          const above = baseline !== undefined ? v > baseline : true;
          const isLatest = i === series.length - 1;
          return (
            <div
              key={i}
              style={{
                height: `${hPct}%`,
                background: above ? aboveColor : belowColor,
                opacity: isLatest ? 1 : above ? 0.78 : 0.55,
                minHeight: 4,
                borderRadius: '2px 2px 0 0',
                // Outline color must match the BAR color, not always
                // the above-color. Inverted metrics (RHR, effort) with
                // the latest bar BELOW baseline = good = blue → outline
                // was rendering warn-red. Fix: pick by `above`.
                outline: isLatest ? `1.5px solid ${above ? aboveColor : belowColor}` : undefined,
                outlineOffset: isLatest ? -1 : undefined,
              }}
            />
          );
        })}
      </div>
      {xLabels && xLabelIndices && (
        <div
          style={{
            position: 'relative',
            height: 14,
            marginTop: 6,
            fontFamily: 'var(--f-data)',
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--t3)',
            letterSpacing: '.4px',
          }}
        >
          {xLabels.map((lbl, i) => {
            const idx = xLabelIndices[i];
            const pct = (idx / Math.max(1, series.length - 1)) * 100;
            const isLast = i === xLabels.length - 1;
            return (
              <span
                key={i}
                style={{
                  position: 'absolute',
                  left: `${pct}%`,
                  transform: isLast ? 'translateX(-100%)' : i === 0 ? 'translateX(0)' : 'translateX(-50%)',
                  color: isLast ? aboveColor : undefined,
                }}
              >
                {lbl}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
