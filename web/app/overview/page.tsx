/**
 * /overview — fresh React port of designs/overview-v4.html.
 *
 * Three sections matching the approved mockup:
 *   1. Coach strip — left coach voice + right Today's Check-In sliders
 *   2. Hero card — left today's workout (or rest day) + right readiness
 *      ring + 5 trend rows + Today's Intensity bar (rest-day variant
 *      hides the gradient bar)
 *   3. Week strip — Base Week N header + 7-day grid + View Full Schedule
 *
 * Replaces the prior /overview implementation. Backup at
 * page.tsx.pre-v4-port-bak.
 */

import { Topbar } from '@/app/components';
import { ConnectBannerIsland } from '../training/ConnectBannerIsland';
import { CheckInIsland } from './CheckInIsland';
import { requireActiveUser } from '@/lib/auth';
import {
  buildSyntheticPlan,
  todayISO,
  daysBetween,
  findCurrentWeek,
  findTodayWorkout,
  userTimezone,
  type PlanWeek,
} from '@/lib/synthetic-plan';
import { getCompletedDates, getWeekStats } from '@/lib/completed-runs';
import { generateBriefing } from '@/lib/coach-briefing';
import { WorkoutModalProvider, HeroActions, WeekStripCells, type WorkoutDay } from './WorkoutModalIsland';
import './overview-v4.css';

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface IntensityCfg { pos: number; label: string; color: string; copy: string; }
const INTENSITY_CFG: Record<string, IntensityCfg> = {
  // Easy bucket covers everything that used to be "recovery" too —
  // they're the same physiological zone (Z1/Z2 conversational pace).
  easy:     { pos: 22, label: 'Easy · Zone 2',     color: 'var(--green)',  copy: 'Conversational pace throughout — if you can’t hold a sentence, slow down. This is where the aerobic engine gets built.' },
  recovery: { pos: 22, label: 'Easy · Zone 2',     color: 'var(--green)',  copy: 'Conversational pace throughout — if you can’t hold a sentence, slow down. This is where the aerobic engine gets built.' },
  long:     { pos: 30, label: 'Long · Zone 2',     color: 'var(--green)',  copy: 'Aerobic time on feet. Hold conversational pace; the duration is the stimulus, not the speed.' },
  quality:  { pos: 68, label: 'Threshold · Zone 4',color: 'var(--amber)',  copy: 'Comfortably hard — controlled effort at lactate threshold. You should feel work, not pain.' },
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

  // Compute "today" in the user's timezone (inferred from location, default LA)
  // so the page matches their wall clock, not UTC.
  const tz = userTimezone(user.location);
  const today = todayISO(tz);
  const weeks = buildSyntheticPlan();
  const currentWeek = findCurrentWeek(weeks, today);
  const todayDay = findTodayWorkout(weeks, today);
  const isRest = !todayDay || todayDay.isRest === true || todayDay.distanceMi === 0;
  const phaseLabel = PHASE_LABELS[currentWeek.phase];

  // Approximate phase-week position (week 1..4 of phase)
  const phaseWeeks = weeks.filter((w) => w.phase === currentWeek.phase);
  const phaseWeekIdx = phaseWeeks.findIndex((w) => w === currentWeek) + 1;

  // Look up which dates this user actually has a logged Strava activity
  // for. A workout is only "done" when there's evidence — date alone is
  // not enough.
  const completed = await getCompletedDates(user.id, currentWeek.startDate, today);
  const isComplete = (dateISO: string) => completed.has(dateISO);

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

  // Session-progress: count days the user actually has an activity for.
  const weekDaysWithWork = currentWeek.days.filter((d) => !d.isRest);
  const sessionsDone = weekDaysWithWork.filter((d) => isComplete(d.date)).length;
  const sessionsTotal = weekDaysWithWork.length;

  // Approximate duration from distance + paceMin
  const paceTargetByType: Record<string, string> = {
    easy: '9:15', recovery: '10:00', long: '9:30', quality: '7:30', race: '7:15',
  };
  const todayPace = todayDay && !todayDay.isRest ? paceTargetByType[todayDay.type] ?? '9:00' : null;
  const [paceM, paceS] = (todayPace ?? '0:00').split(':').map(Number);
  const paceSec = paceM * 60 + paceS;
  const durMin = todayDay && !todayDay.isRest && todayDay.distanceMi ? Math.round((paceSec * todayDay.distanceMi) / 60) : null;

  // Title bucket sizing
  const titleLabel = (todayDay?.label || (isRest ? 'REST' : 'RUN')).toUpperCase();
  const titleBucket = lenBucket(titleLabel);

  // Race countdown — race is week 14, last day
  const raceDate = weeks[13]?.days[6]?.date ?? '2026-08-16';
  const daysToRace = Math.max(0, daysBetween(today, raceDate));

  // Build the coach briefing using real last-week + this-week data.
  // Monday reflects on last week; weekend days frame the long run;
  // mid-week days reference current-week mileage banked so far.
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
  });

  // Today's Intensity config
  const intensity = isRest
    ? null
    : INTENSITY_CFG[todayDay?.type ?? 'easy'] ?? INTENSITY_CFG.easy;

  // Week-progress bar — % of planned sessions actually completed this
  // week (matching Strava activity present), NOT % of days that have
  // ticked by. An empty week reads 0%, not 60% just because it's Friday.
  const weekProgressPct = sessionsTotal > 0 ? Math.round((sessionsDone / sessionsTotal) * 100) : 0;

  return (
    <div className="overview-v4-page">
      <Topbar activeTab="overview" showAdmin={user.is_admin} />
      <ConnectBannerIsland />
      <WorkoutModalProvider today={today}>

      <div className="page">

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

        {/* ── SECTION 2 · HERO CARD ── */}
        <div className="hero-card">
          <div className="hero-left" id="hero-left">
            <div className="hero-eyebrow">TODAY · {phaseLabel.toUpperCase()} WEEK {phaseWeekIdx}</div>
            <div className="hero-title" data-len={titleBucket}>{titleLabel}</div>

            {isRest ? (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 16, lineHeight: 1.6, color: 'var(--t1)', marginTop: 24, maxWidth: 540 }}>
                No run on the schedule today. <strong style={{ color: 'var(--t0)' }}>Recovery is part of training</strong> &mdash; let the body absorb the work from this week and come into the next session fresh.
              </p>
            ) : (
              <>
                <div className="stats-row">
                  <div className="stat-pill"><div className="stat-value-row"><span className="stat-value">{todayDay?.distanceMi}</span><span className="stat-unit">mi</span></div><div className="stat-label">Distance</div></div>
                  <div className="stat-pill"><div className="stat-value-row"><span className="stat-value">{todayPace}</span><span className="stat-unit">/mi</span></div><div className="stat-label">Pace</div></div>
                  <div className="stat-pill"><div className="stat-value-row"><span className="stat-value">~{durMin}</span><span className="stat-unit">min</span></div><div className="stat-label">Duration</div></div>
                  <div className="stat-pill"><div className="stat-value-row"><span className="stat-value">≤145</span><span className="stat-unit">bpm</span></div><div className="stat-label">Heart Rate</div></div>
                </div>
                <div className="hero-buttons">
                  <HeroActions today={today} todayDay={todayDay as WorkoutDay | null} />
                </div>
              </>
            )}
          </div>

          <div className="hero-right">
            <div className="readiness-section">
              <div className="readiness-header">
                <span className="readiness-label-text">Readiness</span>
                <span className="badge-ready">Ready</span>
              </div>
              <div className="readiness-ring-wrap">
                <svg width="300" height="300" viewBox="0 0 300 300">
                  <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(13,15,18,.08)" strokeWidth="16" strokeDasharray="612.61 204.20" strokeLinecap="round" transform="rotate(135 150 150)" />
                  <circle cx="150" cy="150" r="130" fill="none" stroke="#2CA82F" strokeWidth="16" strokeDasharray="539.10 277.70" strokeLinecap="round" transform="rotate(135 150 150)" />
                  <text x="150" y="166" fontFamily="'Bebas Neue', sans-serif" fontSize="96" fill="#0D0F12" textAnchor="middle">88</text>
                  <text x="150" y="188" fontFamily="'Inter', sans-serif" fontSize="13" fontWeight="600" fill="rgba(13,15,18,.32)" textAnchor="middle" letterSpacing="1">/ 100</text>
                </svg>
              </div>
              <div className="readiness-building">Building</div>
            </div>

            <div className="trend-rows">
              <TrendRow label="Effort"    value="+0.25"   tone="green" width={65} />
              <TrendRow label="Load"      value="1.01"    tone="green" width={50} />
              <TrendRow label="Mileage"   value="On plan" tone="green" width={50} />
              <TrendRow label="Easy Pace" value="+0.25"   tone="green" width={60} />
              <TrendRow label="Strain"    value="−0.25"   tone="amber" width={35} />
            </div>

            {/* Today's Intensity — rest-day variant hides gradient bar */}
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
            completed={Array.from(completed)}
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
