/**
 * /overview, fresh React port of designs/overview-v4.html.
 *
 * Three sections matching the approved mockup:
 *   1. Coach strip, left coach voice + right Today's Check-In sliders
 *   2. Hero card, left today's workout (or rest day) + right readiness
 *      ring + 5 trend rows + Today's Intensity bar (rest-day variant
 *      hides the gradient bar)
 *   3. Week strip, Base Week N header + 7-day grid + View Full Schedule
 *
 * Replaces the prior /overview implementation. Backup at
 * page.tsx.pre-v4-port-bak.
 */

import { Topbar } from '@/app/components';
import { ConnectBannerIsland } from '../training/ConnectBannerIsland';
import { CoachAdaptedIsland } from './CoachAdaptedIsland';
import { CheckInIsland } from './CheckInIsland';
import { requireActiveUser } from '@/lib/auth';
import {
  todayISO,
  daysBetween,
  findCurrentWeek,
  findTodayWorkout,
  userTimezone,
  type PlanWeek,
} from '@/lib/synthetic-plan';
import { getRealPlanWeeks } from '@/lib/plan-weeks';
import { getCompletedMileageByDate, getLongestRunByDate, getWeekStats, isWorkoutComplete } from '@/lib/completed-runs';
import { listRecentSkips } from '@/lib/skip-store';
import { generateBriefing } from '@/lib/coach-briefing';
import { resolveFitness } from '@/lib/fitness-resolver';
import { describeWorkout } from '@/lib/workout-descriptions';
import { planTrainingFueling, type WorkoutFuelingType } from '@/lib/training-fueling';
import { resolvePlanUserId } from '@/lib/plan-user';
import { syncStravaIfStale } from '@/lib/sync-strava-user';
import { WorkoutModalProvider, HeroActions, WeekStripCells, InlineRecap, type WorkoutDay } from './WorkoutModalIsland';
import { computeZ2CoverageFinding } from '@/lib/z2-coverage';
import { computePostRaceFinding } from '@/lib/post-race-awareness';
import { PostRaceCard } from './PostRaceCard';
import { computeStravaGap } from '@/lib/strava-gap';
import { StravaGapCard } from './StravaGapCard';
import { computeReadinessScore } from '@/lib/readiness-score';
import { approxDuration } from '@/lib/duration';
import { buildWhyThisWorkout } from '@/lib/why-this-workout';
import { buildSubstitutionMenu } from '@/lib/workout-substitutions';
import { computeRaceTrajectory } from '@/lib/race-trajectory';
import { listRacesDB } from '@/lib/race-store';
import { SubstitutionMenu } from './SubstitutionMenu';
import './overview-v4.css';

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Human labels for the readiness score inputs (from computeReadinessScore).
 *  Replaces the old placeholder factor names (Effort/Load/Easy Pace/Strain)
 *  that never matched what actually moved the score. */
const READINESS_INPUT_LABELS: Record<string, string> = {
  yesterday: 'Yesterday',
  freshness: 'Freshness',
  'load-7d': '7-day load',
  'hr-pace-drift': 'HR / pace drift',
  hrv: 'HRV',
  'resting-hr': 'Resting HR',
  sleep: 'Sleep',
};

interface IntensityCfg { pos: number; label: string; color: string; copy: string; }
const INTENSITY_CFG: Record<string, IntensityCfg> = {
  // Easy bucket covers everything that used to be "recovery" too, 
  // they're the same physiological zone (Z1/Z2 conversational pace).
  easy:     { pos: 22, label: 'Easy · Zone 2',     color: 'var(--green)',  copy: 'Conversational pace throughout, if you can’t hold a sentence, slow down. This is where the aerobic engine gets built.' },
  recovery: { pos: 22, label: 'Easy · Zone 2',     color: 'var(--green)',  copy: 'Conversational pace throughout, if you can’t hold a sentence, slow down. This is where the aerobic engine gets built.' },
  long:     { pos: 30, label: 'Long · Zone 2',     color: 'var(--green)',  copy: 'Aerobic time on feet. Hold conversational pace; the duration is the stimulus, not the speed.' },
  quality:  { pos: 68, label: 'Threshold · Zone 4',color: 'var(--amber)',  copy: 'Comfortably hard, controlled effort at lactate threshold. You should feel work, not pain.' },
  race:     { pos: 88, label: 'Race · Zone 4–5',   color: 'var(--orange)', copy: 'Race day. Execute the plan; conserve early, commit late.' },
};

const PHASE_LABELS = { BASE: 'Base', BUILD: 'Build', PEAK: 'Peak', TAPER: 'Taper', RACE_WEEK: 'Race Week' } as const;

function lenBucket(label: string): 'xs' | 'sm' | 'md' | 'lg' | 'xl' {
  const n = label.length;
  if (n <= 6) return 'xs';
  if (n <= 12) return 'sm';
  if (n <= 20) return 'md';
  if (n <= 30) return 'lg';
  return 'xl';
}

export default async function OverviewPage() {
  const user = await requireActiveUser();

  // Auto-sync Strava if it's been more than 5 min since last refresh.
  // Awaited so the user always sees current data, no manual Sync Now
  // button click required. Failures fall through silently; we show
  // whatever's in the DB regardless.
  await syncStravaIfStale(user.id);

  // Compute "today" in the user's timezone: the device-reported IANA tz
  // (users.timezone) wins, falling back to the location guess (default LA)
  // so the page matches their wall clock, not UTC.
  const tz = user.timezone || userTimezone(user.location);
  const today = todayISO(tz);
  // The runner's REAL coach-generated plan (same artifact /api/overview
  // serves). No synthetic fallback, if there's no plan yet, say so.
  const weeks = await getRealPlanWeeks(await resolvePlanUserId());
  if (weeks.length === 0) {
    return (
      <div className="overview-v4-page">
        <Topbar activeTab="overview" showAdmin={user.is_admin} />
        <ConnectBannerIsland />
        <div className="page">
          <div className="coach-strip">
            <div className="coach-left">
              <div className="coach-label"><span className="dot-green"></span><span>Today</span></div>
              <p className="coach-briefing">
                No active training plan yet. Set a goal race in your profile and your coach will
                build your plan, today&apos;s session will appear here.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const currentWeek = findCurrentWeek(weeks, today);
  const todayDay = findTodayWorkout(weeks, today);
  const isRest = !todayDay || todayDay.isRest === true || todayDay.distanceMi === 0;
  const phaseLabel = PHASE_LABELS[currentWeek.phase];

  // Approximate phase-week position (week 1..4 of phase)
  const phaseWeeks = weeks.filter((w) => w.phase === currentWeek.phase);
  const phaseWeekIdx = phaseWeeks.findIndex((w) => w === currentWeek) + 1;

  // Per-date mileage map (SUM of all runs that day) — drives the WEEKLY
  // MILEAGE bar. And the per-date LONGEST-single-run map — drives the
  // workout-completion gate so a 2.4-mi short threshold + a separate
  // 5-mi easy doesn't false-DONE the threshold.
  const completedMileage = await getCompletedMileageByDate(user.id, currentWeek.startDate, today);
  const longestRunByDate = await getLongestRunByDate(user.id, currentWeek.startDate, today);
  const isComplete = (dateISO: string, plannedMi: number) =>
    isWorkoutComplete(dateISO, plannedMi, longestRunByDate);

  // Skipped workouts this week (the runner explicitly skipped), so the
  // hero + week strip can mark them, not show them as unaddressed.
  const weekSkips = await listRecentSkips({ sinceISO: currentWeek.startDate, untilISO: currentWeek.endDate }).catch(() => []);
  const skippedDates = weekSkips.map((s) => s.dateISO);
  const todaySkipped = skippedDates.includes(today);
  // Today done = today's run met the 60% completion bar.
  const todayActualMi = completedMileage.get(today) ?? 0;
  const todayComplete = !!todayDay && !todayDay.isRest && todayDay.distanceMi > 0 && isComplete(today, todayDay.distanceMi);

  // Stats the coach briefing references: previous calendar week +
  // current week through yesterday. Done as two ranged queries.
  const previousWeek = weeks[weeks.findIndex((w) => w === currentWeek) - 1] ?? null;
  const lastWeekStats = previousWeek
    ? await getWeekStats(user.id, previousWeek.startDate, previousWeek.endDate)
    : { totalMi: 0, runDays: 0, longest: null, quality: null, avgHr: null };

  // Yesterday's date string for "this week so far" cutoff.
  const yesterdayISO = (() => {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const thisWeekSoFar = yesterdayISO >= currentWeek.startDate
    ? await getWeekStats(user.id, currentWeek.startDate, yesterdayISO)
    : { totalMi: 0, runDays: 0, longest: null, quality: null, avgHr: null };

  // Session-progress: a session counts as done only when the actual
  // miles logged that day are ≥ 60% of the planned distance.
  const weekDaysWithWork = currentWeek.days.filter((d) => !d.isRest);
  const sessionsDone = weekDaysWithWork.filter((d) => isComplete(d.date, d.distanceMi)).length;
  const sessionsTotal = weekDaysWithWork.length;
  // Actual miles logged this week THROUGH TODAY, summed from the SAME
  // per-date map that drives the DONE marks, so the Mileage bar reconciles
  // with the week strip. (thisWeekSoFar stops at yesterday for the coach
  // briefing; the progress bar must include today's run and use one source.)
  const weekActualMi = Math.round(
    currentWeek.days.reduce((s, d) => s + (completedMileage.get(d.date) ?? 0), 0) * 10,
  ) / 10;
  // How far into the plan week we are. Mileage is only judged "behind" once
  // the week is essentially over (6th/7th day), before that you're just
  // partway, not behind.
  const daysIntoWeek = Math.floor(
    (Date.parse(today + 'T00:00:00Z') - Date.parse(currentWeek.startDate + 'T00:00:00Z')) / 86_400_000,
  );
  const weekEssentiallyComplete = daysIntoWeek >= 5;

  // Resolve fitness ONCE, paces and duration come from the same
  // source the modal + race plan use. Kills the legacy
  // paceTargetByType map that hardcoded 9:15 easy / 7:30 quality
  // regardless of the user's VDOT or race goal.
  const fitness = await resolveFitness(user.id, today);
  const todayDesc = todayDay && !todayDay.isRest
    ? describeWorkout(todayDay.label, todayDay.type, fitness)
    : null;
  // Pull a single representative pace string for the hero stat tile.
  // For the duration estimate we average any pace pair we find.
  const todayPace = (() => {
    if (!todayDesc?.paceTarget) return null;
    // Headline string from describeWorkout might be "8:49–9:19/mi"
    // or "6:42–7:02/mi (half-marathon goal)". Strip the suffix.
    return todayDesc.paceTarget.replace(/\/mi.*$/, '').trim();
  })();
  const paceSec = (() => {
    if (!todayPace) return 0;
    const matches = [...todayPace.matchAll(/(\d+):(\d{2})/g)]
      .map((m) => parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
    if (matches.length === 0) return 0;
    return Math.round(matches.reduce((a, b) => a + b, 0) / matches.length);
  })();
  const durMin = todayDay && !todayDay.isRest && todayDay.distanceMi && paceSec > 0
    ? Math.round((paceSec * todayDay.distanceMi) / 60) : null;

  // V5 · Z2 stimulus check, coaching finding when easy-run Z2
  // coverage drops below 40% over 3+ recent easy runs. Fires only
  // when HRR framework is calibrated (max HR + resting HR set) and
  // we're outside race-week / post-race recovery. Same SSR pass.
  const z2Finding = await computeZ2CoverageFinding(
    user.id,
    today,
    fitness.maxHr.value,
    fitness.restingHr.value,
    fitness.vdot.value,
  ).catch(() => null);

  // E2 · Post-race awareness, surfaces day-by-day reverse-taper
  // guidance the day after a race. Distance-aware stage windows
  // (marathon 14d, HM 9d, shorter 5d). Reads races.actual_result.
  const postRaceFinding = await computePostRaceFinding(user.id, today).catch(() => null);

  // E1 + E4 · Strava activity gap (3d / 5-7d / 8-14d / 15+d states).
  // Same state machine; surface acknowledges gap and offers planned /
  // injured / unexpected affordances. "Injured" mark suspends L7
  // signals + V5 until activity resumes.
  const stravaGap = await computeStravaGap(user.id, today).catch(() => null);

  // C6 · Daily readiness score (0-100). Composite from yesterday's
  // load + last-7d hard sessions + Signal 2 HR-pace drift. Surface-
  // only, never auto-modifies the plan. Suspended when user marked
  // injured.  z2Finding is threaded through for the V7 cross-reference
  // (V5 → C6 fires when both fatigue inputs and V5 are active).
  const readiness = await computeReadinessScore(
    user.id,
    today,
    fitness.maxHr.value,
    fitness.restingHr.value,
    z2Finding,
  ).catch(() => null);

  // Title bucket sizing
  const titleLabel = (todayDay?.label || (isRest ? 'REST' : 'RUN')).toUpperCase();
  const titleBucket = lenBucket(titleLabel);

  // Plain-language workout explanation, shown inline (always present, no
  // expander): where you are in the plan + what the run is for.
  const why = !isRest && todayDay
    ? buildWhyThisWorkout(
        todayDay.type,
        todayDay.label ?? '',
        todayDay.distanceMi,
        phaseLabel,
        phaseWeekIdx,
        fitness.vdot.value,
      )
    : null;

  // V7 item 3 · Pull race trajectory if the runner has an A-race set.
  // C8's substitution menu uses trajectory.state === 'behind' to flag
  // the quality-protective option as RECOMMENDED.  Computed once here
  // so the menu can derive its output from real state (test for
  // 'tied to' relation: V3 state structurally changes the menu).
  const userRacesForTrajectory = await listRacesDB(user.id).catch(() => []);
  const hasARace = userRacesForTrajectory.some((r) => r.meta.priority === 'A');
  const trajectory = hasARace
    ? await computeRaceTrajectory(user.id, new Date()).catch(() => null)
    : null;
  const trajectoryBehind = trajectory?.state === 'behind';

  // C8 · Workout substitution menu, populated when we have a real
  // workout. Surface as "⇄ Substitute" button alongside HeroActions.
  const substitutionMenu = !isRest && todayDay
    ? buildSubstitutionMenu(
        todayDay.type,
        todayDay.label ?? '',
        todayDay.distanceMi,
        trajectoryBehind,
      )
    : null;

  // Race countdown, race is week 14, last day
  const raceDate = weeks[13]?.days[6]?.date ?? '2026-08-16';
  const daysToRace = Math.max(0, daysBetween(today, raceDate));

  // Today's fueling plan — pure read on duration + workout type + race-aware
  // ramp + user's chosen gel. Renders one line on the Today card (pre-run)
  // and feeds the watch payload via /api/watch/today so haptics fire at the
  // right minute. null when the run doesn't warrant fueling.
  const todayFueling = todayDay && !todayDay.isRest && todayDay.distanceMi > 0
    ? (() => {
        const ftype: WorkoutFuelingType =
          todayDay.type === 'long' ? 'long'
          : todayDay.type === 'quality' ? 'quality'
          : todayDay.type === 'race' ? 'race'
          : 'easy';
        const dur = durMin ?? Math.round(todayDay.distanceMi * 9);   // ~9 min/mi fallback
        const plan = planTrainingFueling({
          durationEstMin: dur,
          distanceMi: todayDay.distanceMi,
          workoutType: ftype,
          daysToARace: daysToRace > 0 ? daysToRace : null,
          raceFuelTargetGPerHr: user.fuelTargetGPerHr,
          gelCarbsG: user.fuelGelCarbsG,
          gelLabel: user.fuelBrand,
        });
        return plan.needed ? plan : null;
      })()
    : null;

  // Build the coach briefing using real last-week + this-week data.
  // Monday reflects on last week; weekend days frame the long run;
  // mid-week days reference current-week mileage banked so far.
  // localHour drives the time-of-day greeting ("Good morning" vs
  // "Good evening") so the coach voice matches the runner's wall
  // clock. Computed from the user's IANA timezone via Intl.
  const tzForHour = user.timezone || userTimezone(user.location);
  const localHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: tzForHour, hour: 'numeric', hour12: false,
  }).format(new Date()));
  const briefing = generateBriefing({
    firstName: user.name?.split(' ')[0] || '',
    today,
    daysToRace,
    raceLabel: 'AFC Half',
    currentWeek,
    previousWeek,
    lastWeekStats,
    thisWeekSoFar,
    todayDay,
    localHour,
  });

  // Today's Intensity config
  const intensity = isRest
    ? null
    : INTENSITY_CFG[todayDay?.type ?? 'easy'] ?? INTENSITY_CFG.easy;

  // Week-progress bar, % of planned sessions actually completed this
  // week (matching Strava activity present), NOT % of days that have
  // ticked by. An empty week reads 0%, not 60% just because it's Friday.
  const weekProgressPct = sessionsTotal > 0 ? Math.round((sessionsDone / sessionsTotal) * 100) : 0;

  return (
    <div className="overview-v4-page">
      <Topbar activeTab="overview" showAdmin={user.is_admin} />
      <ConnectBannerIsland />
      <WorkoutModalProvider today={today}>

      <div className="page">

        {/* Coach adaptations, dismissible, only when something changed */}
        <CoachAdaptedIsland />

        {/* ── SECTION 1 · COACH STRIP ── */}
        <div className="coach-strip">
          <div className="coach-left">
            <div className="coach-label">
              <span className="dot-green"></span>
              COACH · {new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase()} · {phaseLabel.toUpperCase()} WEEK {phaseWeekIdx}
            </div>
            <p className="coach-briefing">{briefing}</p>
          </div>

          {/* Check-In is interactive (client island) */}
          <CheckInIsland today={today} />
        </div>

        {/* (No separate insights banner, anything worth saying is in the
            coach line above, not a second floating box.) */}

        {/* E1 + E4 · Activity gap surface, fires at 3d/5d/8d/15d
            thresholds. Renders above E2 so the gap acknowledgment
            comes before any post-race recovery guidance. */}
        {stravaGap && stravaGap.state !== 'silent' && stravaGap.daysSinceLastRun != null && (
          <StravaGapCard
            state={stravaGap.state}
            daysSinceLastRun={stravaGap.daysSinceLastRun}
            lastRunDate={stravaGap.lastRunDate}
          />
        )}

        {/* E2 · Post-race awareness, renders above hero TodayCard
            when within reverse-taper window of most recent race */}
        {postRaceFinding && <PostRaceCard finding={postRaceFinding} />}

        {/* ── SECTION 2 · HERO CARD ── */}
        <div className="hero-card">
          <div className="hero-left" id="hero-left">
            <div className="hero-eyebrow">TODAY · {phaseLabel.toUpperCase()} WEEK {phaseWeekIdx}</div>
            <div className="hero-title" data-len={titleBucket}>
              {titleLabel}
            </div>

            {isRest ? (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 16, lineHeight: 1.6, color: 'var(--t1)', marginTop: 24, maxWidth: 540 }}>
                No run on the schedule today. <strong style={{ color: 'var(--t0)' }}>Recovery is part of training</strong> &mdash; let the body absorb the work from this week and come into the next session fresh.
              </p>
            ) : todayComplete ? (
              <>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '7px 13px', borderRadius: 999, background: 'rgba(62,189,65,.12)', fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: '.04em', color: '#1f7a22' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3EBD41' }} />
                  COMPLETED · {todayActualMi.toFixed(1)} MI LOGGED
                </div>
                <InlineRecap day={todayDay as WorkoutDay} />
              </>
            ) : todaySkipped ? (
              <>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '7px 13px', borderRadius: 999, background: 'rgba(8,8,8,.06)', fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: '.04em', color: 'rgba(8,8,8,.55)' }}>
                  SKIPPED TODAY
                </div>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, lineHeight: 1.6, color: 'var(--t1)', marginTop: 16, maxWidth: 540 }}>
                  You marked today&rsquo;s {(todayDay?.label ?? 'workout').toLowerCase()} as skipped. The coach treats that as ground truth and will factor it into this week&rsquo;s load. Changed your mind?
                </p>
                <div className="hero-buttons" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 20 }}>
                  <HeroActions today={today} todayDay={todayDay as WorkoutDay | null} />
                </div>
              </>
            ) : (
              <>
                <div className="stats-row">
                  <div className="stat-pill"><div className="stat-value-row"><span className="stat-value">{todayDay?.distanceMi}</span><span className="stat-unit">mi</span></div><div className="stat-label">Distance</div></div>
                  <div className="stat-pill"><div className="stat-value-row"><span className="stat-value">{todayPace}</span><span className="stat-unit">/mi</span></div><div className="stat-label">Pace</div></div>
                  <div className="stat-pill"><div className="stat-value-row"><span className="stat-value">{approxDuration(durMin).value}</span>{approxDuration(durMin).unit && <span className="stat-unit">{approxDuration(durMin).unit}</span>}</div><div className="stat-label">Duration</div></div>
                  <div className="stat-pill"><div className="stat-value-row"><span className="stat-value" style={{ color: 'rgba(8,8,8,.32)' }}>-</span></div><div className="stat-label">Heart Rate</div></div>
                </div>
                {/* Fueling — one-line plan in the runner's chosen product
                    (e.g. "Fuel: 2 Maurten 100s, ~45 & ~90 min in"). Only
                    renders when the run actually warrants fuel; the watch
                    fires haptics at each gel mark during the session. */}
                {todayFueling && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 14,
                    padding: '8px 13px', borderRadius: 10,
                    background: todayFueling.isRehearsal ? 'rgba(62,189,65,.10)' : 'rgba(8,8,8,.04)',
                    border: `1px solid ${todayFueling.isRehearsal ? 'rgba(62,189,65,.30)' : 'rgba(8,8,8,.10)'}`,
                    fontFamily: 'Inter, sans-serif', fontSize: 13.5, color: 'var(--t0)',
                  }}>
                    <span style={{
                      fontFamily: 'Oswald, sans-serif', fontSize: 10, fontWeight: 700,
                      letterSpacing: 1.4, textTransform: 'uppercase',
                      color: todayFueling.isRehearsal ? '#1f6a21' : 'rgba(8,8,8,.55)',
                    }}>
                      {todayFueling.isRehearsal ? 'Race rehearsal' : 'Fuel'}
                    </span>
                    <span>{todayFueling.shortLine.replace(/^Fuel(?: rehearsal)?:\s*/, '')}</span>
                  </div>
                )}
                {/* One clean, always-present explanation, what this run is
                    for, in plain language. No expander, no stacked blocks. */}
                {why && (
                  <div style={{ marginTop: 22, maxWidth: 560 }}>
                    <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 10.5, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--accent, #E85D26)' }}>
                      {why.whereInPlan}
                    </div>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 15.5, lineHeight: 1.6, color: 'var(--t1)', margin: '8px 0 0' }}>
                      {why.thePoint}
                    </p>
                    {todayPace && (todayDay?.type === 'long' || (todayDay && !(['quality', 'race'] as string[]).includes(todayDay.type))) && (
                      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13.5, lineHeight: 1.55, color: 'var(--t2)', margin: '8px 0 0' }}>
                        Aim for <strong style={{ color: 'var(--t1)' }}>{todayPace}/mi</strong>, and let it drift slower if your legs are heavy or it&rsquo;s hot. On easy days the slow end of the range is the right call.
                      </p>
                    )}
                  </div>
                )}
                <div className="hero-buttons" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 24 }}>
                  <HeroActions today={today} todayDay={todayDay as WorkoutDay | null} />
                  {substitutionMenu && <SubstitutionMenu menu={substitutionMenu} />}
                </div>
              </>
            )}
          </div>

          <div className="hero-right">
            <div className="readiness-section">
              {/* C6 · Readiness score with three-state ring. Surface-only
                  per the locked spec, never auto-modifies plan. Falls
                  back to "Waiting on data" when score is null
                  (suspended via injury mark OR no activity history). */}
              {readiness && readiness.score != null ? (
                <>
                  {/* No "READINESS · GREEN" header, the ring + score + the
                      recommendation line below already say it. */}
                  <div className="readiness-ring-wrap">
                    {(() => {
                      const radius = 130;
                      const circumference = 2 * Math.PI * radius;  // ~816.81
                      const filled = (readiness.score / 100) * circumference * 0.75;  // 270° arc
                      const empty = circumference - filled;
                      const color = readiness.state === 'green' ? '#3EBD41'
                        : readiness.state === 'yellow' ? '#F3AD38'
                        : '#FC4D64';
                      return (
                        <svg width="300" height="300" viewBox="0 0 300 300">
                          {/* Track */}
                          <circle cx="150" cy="150" r={radius} fill="none"
                            stroke="rgba(8,8,8,.08)" strokeWidth="16"
                            strokeDasharray={`${circumference * 0.75} ${circumference}`}
                            strokeLinecap="round" transform="rotate(135 150 150)" />
                          {/* Fill */}
                          <circle cx="150" cy="150" r={radius} fill="none"
                            stroke={color} strokeWidth="16"
                            strokeDasharray={`${filled} ${empty + filled}`}
                            strokeLinecap="round" transform="rotate(135 150 150)" />
                          <text x="150" y="158" fontFamily="'Bebas Neue', sans-serif" fontSize="78" fill={color} textAnchor="middle">{readiness.score}</text>
                          <text x="150" y="190" fontFamily="'Inter', sans-serif" fontSize="11" fontWeight="600" fill="rgba(8,8,8,.55)" textAnchor="middle" letterSpacing="1">/ 100</text>
                        </svg>
                      );
                    })()}
                  </div>
                  <div
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: 'rgba(8,8,8,.78)',
                      textAlign: 'center',
                      padding: '0 20px',
                      marginTop: 6,
                    }}
                    title={
                      readiness.missingInputs.length > 0
                        ? `Inputs used: ${readiness.inputs.map(i => i.name).join(', ') || 'none'}\nMissing: ${readiness.missingInputs.join(', ')}`
                        : `Inputs: ${readiness.inputs.map(i => `${i.name}${i.delta >= 0 ? '+' : ''}${i.delta}`).join(' · ')}`
                    }
                  >
                    {readiness.recommendation}
                    {readiness.crossRef && (
                      <span style={{ fontSize: 13, color: 'rgba(8,8,8,.65)' }}>
                        {', '}
                        <a
                          href={readiness.crossRef.href}
                          style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                        >
                          {readiness.crossRef.text}
                        </a>
                        {'.'}
                      </span>
                    )}
                    {readiness.missingInputs.length > 0 && (
                      <div style={{ fontSize: 11, color: 'rgba(8,8,8,.55)', marginTop: 4, fontStyle: 'italic' }}>
                        {readiness.missingInputs.length === 1
                          ? `${readiness.missingInputs[0]} unavailable, score uses other inputs.`
                          : `${readiness.missingInputs.length} inputs unavailable, score uses what's available.`}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="readiness-header">
                    <span className="readiness-label-text">Readiness</span>
                    <span className="badge-ready" style={{ background: 'rgba(8,8,8,.05)', color: 'rgba(8,8,8,.45)' }}>
                      {readiness?.suppressReason === 'injured' ? 'Suspended' : 'No data'}
                    </span>
                  </div>
                  <div className="readiness-ring-wrap">
                    <svg width="300" height="300" viewBox="0 0 300 300">
                      <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(8,8,8,.08)" strokeWidth="16" strokeDasharray="816.81 0" strokeLinecap="round" transform="rotate(135 150 150)" />
                      <text x="150" y="166" fontFamily="'Bebas Neue', sans-serif" fontSize="64" fill="rgba(8,8,8,.32)" textAnchor="middle">-</text>
                      <text x="150" y="200" fontFamily="'Inter', sans-serif" fontSize="11" fontWeight="600" fill="rgba(8,8,8,.32)" textAnchor="middle" letterSpacing="1">NO DATA</text>
                    </svg>
                  </div>
                  <div className="readiness-building" style={{ color: 'rgba(8,8,8,.45)' }}>
                    {readiness?.suppressReason === 'injured' ? 'Suspended while injured' : 'Waiting on data'}
                  </div>
                </>
              )}
            </div>

            {/* What actually moved the score, the real readiness inputs (not
                placeholder factor names). Mileage stays as a separate real
                trend. Honest: shows the signals the engine used + their deltas. */}
            <div className="trend-rows">
              <TrendRow
                label="Mileage"
                value={`${weekActualMi} / ${currentWeek.plannedMi} mi`}
                /* Progress toward the week's mileage, only flag amber once the
                   week is essentially over AND you came up short. Mid-week
                   you're naturally partway, so it stays green ("on track")
                   rather than reading like a warning next to a green readiness. */
                tone={(weekEssentiallyComplete && weekActualMi < currentWeek.plannedMi * 0.85) ? 'amber' : 'green'}
                width={Math.min(100, Math.round((weekActualMi / Math.max(1, currentWeek.plannedMi)) * 100))}
              />
              {(readiness?.inputs ?? []).map((inp) => (
                <TrendRow
                  key={`${inp.name}-${inp.note}`}
                  label={READINESS_INPUT_LABELS[inp.name] ?? inp.name}
                  value={`${inp.delta >= 0 ? '+' : ''}${inp.delta}`}
                  tone={inp.delta >= 0 ? 'green' : 'amber'}
                  width={Math.min(100, Math.abs(inp.delta) * 6)}
                />
              ))}
            </div>

            {/* Today's Intensity, rest-day variant hides gradient bar */}
            <div className={`intensity-section${isRest ? ' rest' : ''}`}>
              <div className="intensity-heading">Today&apos;s Intensity</div>
              {!isRest && intensity && (
                <div className="intensity-bar-wrap">
                  <div className="intensity-bar"></div>
                  <div className="intensity-tick" style={{ left: `${intensity.pos}%` }}></div>
                  <div className="intensity-fade" style={{ left: `${intensity.pos}%` }}></div>
                </div>
              )}
              <div className="intensity-zone-name" style={{ color: isRest ? 'var(--t1)' : intensity?.color }}>
                {isRest ? 'Rest day · No intensity' : intensity?.label}
              </div>
              <p className="coach-note-inline">
                {isRest ? 'No run scheduled. The intensity scale returns tomorrow when the next workout posts.' : intensity?.copy}
              </p>
            </div>
          </div>
        </div>

        {/* ── SECTION 3 · WEEK STRIP ── */}
        <div className="week-card">
          <div className="week-header">
            <div className="week-header-top">
              <div className="week-label-group">
                <span className="week-header-sublabel">This Week</span>
                <span className="week-header-title">{phaseLabel} Week {phaseWeekIdx}</span>
              </div>
              <div className="week-meta">
                {sessionsDone} of {sessionsTotal} sessions done · {currentWeek.plannedMi} mi planned
              </div>
              <a className="week-view-link" href="/training#current-week">View Full Schedule →</a>
            </div>
            <div className="week-progress-bar">
              <div className="week-progress-fill" style={{ width: `${weekProgressPct}%` }}></div>
            </div>
          </div>

          <WeekStripCells
            days={currentWeek.days as WorkoutDay[]}
            today={today}
            completedMileage={Object.fromEntries(completedMileage)}
            longestRunByDate={Object.fromEntries(longestRunByDate)}
            skippedDates={skippedDates}
          />
        </div>
      </div>
      </WorkoutModalProvider>
    </div>
  );
}

function TrendRow({ label, value, tone, width }: { label: string; value: string; tone: 'green' | 'amber'; width: number }) {
  return (
    <div className="trend-row">
      <div className="trend-row-top">
        <span className="trend-row-label">{label}</span>
        <span className={`trend-row-value ${tone}`}>{value}</span>
      </div>
      <div className="trend-bar-track">
        <div className={`trend-bar-fill ${tone}`} style={{ width: `${width}%` }}></div>
      </div>
    </div>
  );
}
