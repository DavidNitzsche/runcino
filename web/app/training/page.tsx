/**
 * /training — fresh React port of designs/training-v4.html.
 *
 * Five sections matching the approved mockup:
 *   1. Coach strip — cycle voice + Next-Milestone countdown card
 *   2. Phase Hero — massive "BASE" phase wordmark + 4 stat pills /
 *                   Plan Arc · 14 Weeks Total timeline (right column)
 *   3. Full Schedule — 14-bar volume curve + 14-week calendar grid
 *   4. Plan Adapted feed — last 7 days of coach adjustments
 *   5. Your Paces — VDOT-derived training zones (E/M/T/I/R)
 *
 * Server component: requires auth via getCurrentUser, fetches the
 * active plan + user prefs from Postgres, computes phase context,
 * renders the v4 layout server-side. The optional ConnectBanner
 * rendering is delegated to a small client island.
 *
 * Replaces the prior /training implementation (~2400 lines against
 * an earlier mockup). Backup at page.tsx.pre-v4-port-bak.
 */

import { Topbar } from '@/app/components';
import { ConnectBannerIsland } from './ConnectBannerIsland';
import { requireActiveUser } from '@/lib/auth';
import { syncStravaIfStale } from '@/lib/sync-strava-user';
import { buildSyntheticPlan, todayISO, daysBetween, fmtShortDate, userTimezone, type PlanWeek } from '@/lib/synthetic-plan';
import { getCompletedMileageByDate, isWorkoutComplete } from '@/lib/completed-runs';
import { WorkoutModalProvider, type WorkoutDay } from '@/app/overview/WorkoutModalIsland';
import { TrainingCell } from './TrainingCellIsland';
import { listRacesDB } from '@/lib/race-store';
import './training-v4.css';

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface PhaseSpec {
  key: PlanWeek['phase'];
  label: string;
  cls: string;
  weeksLabel: string;
}
const PHASES: PhaseSpec[] = [
  { key: 'BASE',      label: 'Base',      cls: 'base',  weeksLabel: 'Weeks 1 – 4' },
  { key: 'BUILD',     label: 'Build',     cls: 'build', weeksLabel: 'Weeks 5 – 8' },
  { key: 'PEAK',      label: 'Peak',      cls: 'peak',  weeksLabel: 'Weeks 9 – 12' },
  { key: 'TAPER',     label: 'Taper',     cls: 'taper', weeksLabel: 'Week 13' },
  { key: 'RACE_WEEK', label: 'Race',      cls: 'race-week', weeksLabel: 'Week 14' },
];

export default async function TrainingPage() {
  const user = await requireActiveUser();
  await syncStravaIfStale(user.id);

  const tz = userTimezone(user.location);
  const today = todayISO(tz);
  const weeks = buildSyntheticPlan();
  const currentWeek = weeks.find((w) => w.days.some((d) => d.date === today)) ?? weeks[0];

  // DONE only when actual miles ≥ 60% of planned. Bracket the full
  // 14-week plan so every cell can be checked.
  const planStart = weeks[0]?.startDate ?? today;
  const planEnd   = weeks[weeks.length - 1]?.endDate ?? today;
  const completedMileage = await getCompletedMileageByDate(user.id, planStart, planEnd);
  const isComplete = (dateISO: string, plannedMi: number) =>
    isWorkoutComplete(dateISO, plannedMi, completedMileage);

  // Map race dates → slug so race-day cells in the calendar can link
  // to their full race plan instead of opening the generic modal.
  const userRaces = await listRacesDB(user.id).catch(() => []);
  const raceSlugByDate = new Map<string, string>();
  for (const r of userRaces) raceSlugByDate.set(r.meta.date, r.slug);
  const phaseKey = currentWeek.phase;
  const phaseWeeks = weeks.filter((w) => w.phase === phaseKey);
  const phaseWeekIdx = phaseWeeks.findIndex((w) => w === currentWeek) + 1;
  const phaseWeekTotal = phaseWeeks.length;
  const raceDate = weeks[13]?.days[6]?.date ?? '2026-08-16';
  const daysToRace = Math.max(0, daysBetween(today, raceDate));

  const phasePeak = Math.max(...phaseWeeks.map((w) => w.plannedMi));
  const phaseLong = Math.max(...phaseWeeks.flatMap((w) => w.days.map((d) => d.distanceMi)));
  const daysInPhase = Math.max(0, daysBetween(phaseWeeks[0].startDate, today));
  const daysUntilNextPhase = (() => {
    const next = PHASES.findIndex((p) => p.key === phaseKey) + 1;
    if (next >= PHASES.length) return 0;
    const nextStart = weeks.find((w) => w.phase === PHASES[next].key)?.startDate;
    if (!nextStart) return 0;
    return Math.max(0, daysBetween(today, nextStart));
  })();

  const totalMiPlan = Math.round(weeks.reduce((s, w) => s + w.plannedMi, 0));
  const peakWeekMi = Math.max(...weeks.map((w) => w.plannedMi));
  const planProgressPct = Math.max(0, Math.min(100, Math.round(((currentWeek.weekNum - 1 + 1) / 14) * 100)));

  const PHASE_TIMELINE = PHASES.map((p) => {
    const ws = weeks.filter((w) => w.phase === p.key);
    if (!ws.length) return null;
    const start = ws[0].startDate;
    const end = ws[ws.length - 1].days[6].date;
    const startsIn = daysBetween(today, start);
    const endsIn = daysBetween(today, end);
    const isCurrent = p.key === phaseKey;
    const isPast = endsIn < 0;
    return {
      key: p.key,
      label: p.label,
      dateRange: `${fmtShortDate(start)} → ${fmtShortDate(end)}`,
      statusLabel: isCurrent ? 'Current' : isPast ? 'Done' : startsIn === 0 ? 'Today' : `in ${startsIn}d`,
      isCurrent, isPast,
      cls: p.cls,
    };
  }).filter((p): p is NonNullable<typeof p> => p !== null);

  const VOLUME_BARS = weeks.map((w) => ({
    weekNum: w.weekNum,
    plannedMi: w.plannedMi,
    phase: w.phase.toLowerCase().replace('_week', ''),
    heightPct: Math.round((w.plannedMi / peakWeekMi) * 100 * 10) / 10,
    isCurrent: w === currentWeek,
    isPast: w.days.every((d) => d.date < today),
    isPeak: w.plannedMi === peakWeekMi,
    isRace: w.phase === 'RACE_WEEK',
  }));

  // Plan Adapted feed — real entries will come from plan_mutations
  // once the engine wires through. For now: empty unless populated.
  const ADAPTED_ITEMS: ReadonlyArray<{ dir: 'up' | 'down'; date: string; change: React.ReactNode; why: string }> = [];

  // VDOT-derived pace zones — only populated once the runner logs a
  // recent race finish (we anchor VDOT off race results). Until then,
  // we don't fake training paces.
  const VDOT: number | null = null;
  const PACES: Array<{ zone: string; pace: string; when: string; cls?: string }> = [];

  return (
    <WorkoutModalProvider today={today}>
    <div className="training-v4-page">
      <Topbar activeTab="training" showAdmin={user.is_admin} />
      <ConnectBannerIsland />

      <div className="page">

        {/* ── SECTION 1 · COACH STRIP ── */}
        <div className="coach-strip">
          <div className="coach-left">
            <div className="coach-label">
              <span className="dot-green"></span>
              COACH · THE ARC · BUILDING TOWARD AFC
            </div>
            <p className="coach-briefing">
              You&rsquo;re in week {currentWeek.weekNum} of {PHASES.find((p) => p.key === phaseKey)?.label} — <strong>the aerobic engine is just starting to take shape</strong>. The Build phase opens in {daysUntilNextPhase} days and brings the first real threshold dose; that&rsquo;s where the half-marathon pace starts to feel sustainable. <strong>Trust the easy. The fast pays for the patient.</strong>
            </p>
          </div>
          <div className="cycle-next">
            <div className="cycle-next-label">Next milestone</div>
            <div className="cycle-next-race">Americas Finest City Half</div>
            <div className="cycle-next-race-meta">Aug 16, 2026 · 13.1 mi</div>
            <div className="cycle-next-days-row">
              <span className="cycle-next-days">{daysToRace}</span>
              <span className="cycle-next-days-unit">days<br />to race</span>
            </div>
            <div className="cycle-next-progress">
              <div className="cycle-next-progress-bar">
                <div className="cycle-next-progress-fill" style={{ width: `${planProgressPct}%` }} />
              </div>
              <div className="cycle-next-progress-meta">
                <span><strong>Week {currentWeek.weekNum}</strong> of 14</span>
                <span>{planProgressPct}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── SECTION 2 · PHASE HERO ── */}
        <div className="hero-card">
          <div className="hero-left">
            <div className="hero-eyebrow">CURRENT PHASE · WEEK {phaseWeekIdx} OF {phaseWeekTotal}</div>
            <div className="hero-title">{PHASES.find((p) => p.key === phaseKey)?.label.toUpperCase() ?? 'BASE'}</div>
            <div className="hero-sub">{phaseKey === 'BASE' ? 'Aerobic Foundation' : phaseKey === 'BUILD' ? 'Threshold Build' : phaseKey === 'PEAK' ? 'Race Specificity' : phaseKey === 'TAPER' ? 'Sharpen' : 'Race Week'}</div>
            <p className="hero-explainer">
              The {PHASES.find((p) => p.key === phaseKey)?.label} phase builds the engine — frequency over intensity, easy miles over fast ones. You&rsquo;re stacking weeks of consistent volume so the harder work later has somewhere to land. One quality session per week (threshold tempo); everything else stays conversational.
            </p>
            <div className="stats-row">
              <div className="stat-pill">
                <div className="stat-value-row">
                  <span className="stat-value">{Math.round(phasePeak)}</span>
                  <span className="stat-unit">mi/wk</span>
                </div>
                <div className="stat-label">{PHASES.find((p) => p.key === phaseKey)?.label} Peak</div>
              </div>
              <div className="stat-pill">
                <div className="stat-value-row">
                  <span className="stat-value">{phaseLong}</span>
                  <span className="stat-unit">mi</span>
                </div>
                <div className="stat-label">{PHASES.find((p) => p.key === phaseKey)?.label} Long</div>
              </div>
              <div className="stat-pill">
                <div className="stat-value-row">
                  <span className="stat-value">{daysInPhase}</span>
                  <span className="stat-unit">days</span>
                </div>
                <div className="stat-label">In Phase</div>
              </div>
              <div className="stat-pill">
                <div className="stat-value-row">
                  <span className="stat-value">{daysUntilNextPhase}</span>
                  <span className="stat-unit">days</span>
                </div>
                <div className="stat-label">Until {PHASES[Math.min(PHASES.length - 1, PHASES.findIndex((p) => p.key === phaseKey) + 1)]?.label ?? 'Race'}</div>
              </div>
            </div>
          </div>
          <div className="hero-right">
            <div>
              <div className="timeline-label">Plan Arc · 14 Weeks Total</div>
              <div className="timeline-list">
                {PHASE_TIMELINE.map((p) => (
                  <div key={p.key} className={`timeline-row ${p.isCurrent ? 'current' : p.isPast ? 'past' : 'future'}`}>
                    <div className="timeline-phase">{p.label}</div>
                    <div className="timeline-dates">{p.dateRange}</div>
                    <div className="timeline-status" style={p.key === 'RACE_WEEK' && !p.isCurrent && !p.isPast ? { color: 'var(--orange)' } : undefined}>
                      {p.key === 'RACE_WEEK' && !p.isCurrent && !p.isPast ? '🏁 ' : ''}{p.statusLabel}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── SECTION 3 · FULL SCHEDULE ── */}
        <div className="schedule-card">
          <div className="schedule-header">
            <div className="schedule-title-group">
              <div className="schedule-title">Full Schedule</div>
              <div className="schedule-sub"><strong>14 weeks</strong> · Americas Finest City Half · Aug 16, 2026</div>
            </div>
            <div className="schedule-meta">
              Total <strong>{totalMiPlan}</strong> mi · Peak week <strong>{peakWeekMi}</strong> mi
            </div>
          </div>

          <div className="volume-curve">
            <div className="volume-bars">
              {VOLUME_BARS.map((b) => (
                <div
                  key={b.weekNum}
                  className={`volume-bar ${b.phase} ${b.isPast ? 'past' : 'future'} ${b.isCurrent ? 'current' : ''} ${b.isPeak ? 'peakmark' : ''}`}
                  style={{ height: `${b.heightPct}%` }}
                >
                  <span className="volume-bar-value" style={b.isRace ? { color: 'var(--orange)' } : undefined}>
                    {b.isRace ? '🏁 ' : ''}{b.plannedMi}{b.isPeak ? ' ↑ PEAK' : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="volume-axis">
              {VOLUME_BARS.map((b) => (
                <span key={b.weekNum} className={`volume-axis-week ${b.isCurrent ? 'current' : ''}`}>W{b.weekNum}</span>
              ))}
            </div>
            <div className="volume-phase-labels">
              <div className="volume-phase-label base"  style={{ gridColumn: 'span 4' }}>Base</div>
              <div className="volume-phase-label build" style={{ gridColumn: 'span 4' }}>Build</div>
              <div className="volume-phase-label peak"  style={{ gridColumn: 'span 4' }}>Peak</div>
              <div className="volume-phase-label taper" style={{ gridColumn: 'span 1' }}>Taper</div>
              <div className="volume-phase-label race"  style={{ gridColumn: 'span 1' }}>🏁</div>
            </div>
          </div>

          <div className="cal-grid">
            <div className="cal-head">
              <div className="cal-head-cell cal-week-col">Week</div>
              {DOW_LABELS.map((d) => <div key={d} className="cal-head-cell">{d}</div>)}
              <div className="cal-head-cell cal-mileage-col">Total</div>
            </div>
            {(() => {
              const rows: React.ReactNode[] = [];
              let lastPhase: PlanWeek['phase'] | null = null;
              weeks.forEach((w) => {
                if (w.phase !== lastPhase) {
                  const ph = PHASES.find((p) => p.key === w.phase);
                  rows.push(
                    <div key={`ph-${w.phase}`} className={`cal-phase-row ${ph?.cls ?? ''}`}>
                      {ph?.label} Phase <span className="cal-phase-row-meta">{ph?.weeksLabel}</span>
                    </div>
                  );
                  lastPhase = w.phase;
                }
                const isCurrentWk = w.days.some((d) => d.date === today);
                rows.push(
                  <div key={`wk-${w.weekNum}`} className="cal-week-cell" id={isCurrentWk ? 'current-week' : undefined}>
                    Week {w.weekNum}
                    <div className="cal-week-cell-date">{fmtShortDate(w.startDate)}</div>
                  </div>
                );
                w.days.forEach((d) => {
                  const isToday = d.date === today;
                  // Workouts past their date stay un-DONE unless logged
                  // miles cover ≥60% of the planned distance.
                  const isDone = !isToday && d.date < today && !d.isRest && isComplete(d.date, d.distanceMi);
                  const classes = `cal-cell ${d.type}${d.hasStrength ? ' has-str' : ''}${isDone ? ' done' : ''}${isToday ? ' today' : ''}`;
                  const cellDay: WorkoutDay = {
                    ...(d as WorkoutDay),
                    raceSlug: d.type === 'race' ? raceSlugByDate.get(d.date) : undefined,
                  };
                  rows.push(
                    <TrainingCell key={`d-${d.date}`} day={cellDay} className={classes}>
                      {d.isRest ? (
                        <>
                          <span className="cal-cell-type" style={isToday ? { color: 'var(--amber)' } : undefined}>
                            {isToday ? 'Rest · Today' : 'Rest'}
                          </span>
                          <span className="cal-cell-rest-dash">—</span>
                        </>
                      ) : (
                        <>
                          {isDone && <span className="cal-cell-done">✓</span>}
                          <span className="cal-cell-type" style={isToday ? { color: 'var(--amber)' } : undefined}>
                            {d.label}{isToday ? ' · Today' : ''}
                          </span>
                          <span className="cal-cell-dist">{d.distanceMi}<span className="cal-cell-dist-unit">mi</span></span>
                          {d.hasStrength && !isDone && <span className="cal-cell-strength" title="Strength training">S</span>}
                        </>
                      )}
                    </TrainingCell>
                  );
                });
                rows.push(
                  <div key={`mi-${w.weekNum}`} className="cal-mileage-cell">
                    {w.plannedMi}<span className="cal-mileage-cell-unit">MI</span>
                  </div>
                );
              });
              return rows;
            })()}
          </div>
        </div>

        {/* ── SECTION 4 · PLAN ADAPTED ── */}
        <div className="adapted-card">
          <div className="adapted-header">
            <div className="adapted-title-group">
              <div className="adapted-title">{ADAPTED_ITEMS.length} adjustments this week</div>
              <div className="adapted-sub">Plan adapted · Last 7 days</div>
            </div>
            <span className="adapted-pin">Doctrine driven</span>
          </div>
          <div className="adapted-items">
            {ADAPTED_ITEMS.length === 0 ? (
              <div style={{ padding: '24px 40px 28px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)', textAlign: 'center' }}>
                No adjustments yet. As you log check-ins and runs, the coach engine will surface
                plan changes here with the reasoning behind each one.
              </div>
            ) : (
              ADAPTED_ITEMS.map((item, i) => (
                <div key={i} className="adapted-item">
                  <span className={`adapted-direction ${item.dir}`} title={item.dir === 'up' ? 'Coach stepped the plan up' : 'Coach softened the plan'}>
                    {item.dir === 'up' ? '↑' : '↓'}
                  </span>
                  <div className="adapted-date">{item.date}</div>
                  <div>
                    <div className="adapted-change">{item.change}</div>
                    <div className="adapted-why">{item.why}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── SECTION 5 · YOUR PACES ── */}
        <div className="paces-card">
          <div className="paces-header">
            <div className="paces-title-group">
              <div className="paces-title">Your Paces</div>
              <div className="paces-sub">{VDOT ? <><strong>VDOT {VDOT}</strong> · Daniels training zones</> : 'No data — log a recent race to anchor your training paces'}</div>
            </div>
          </div>
          {PACES.length === 0 ? (
            <div style={{ padding: '20px 40px 28px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
              We compute easy / marathon / threshold / interval / repetition paces from your
              VDOT, which we anchor off a recent race result. Once a race finish is logged,
              this card fills in.
            </div>
          ) : (
            <div className="paces-grid">
              {PACES.map((p) => (
                <div key={p.zone} className={`pace-cell ${p.cls ?? ''}`}>
                  <div className="pace-cell-zone">{p.zone}</div>
                  <div className="pace-cell-pace">{p.pace}<span className="pace-cell-pace-unit">/mi</span></div>
                  <div className="pace-cell-when">{p.when}</div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
    </WorkoutModalProvider>
  );
}
