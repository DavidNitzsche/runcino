'use client';

/**
 * / — Overview / Hub.
 *
 * Real React, date-driven, honest empty states. Replaces the embedded
 * designs/hub.html. Wired to live Strava data via useActivities():
 * weekly miles, YTD totals, last run, fun-stat comparisons, last-7-day
 * mileage strip. Falls back to "no data" empties when Strava isn't
 * connected.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Caption, Nav } from '../components/nav';
import { Modal } from '../components/modal';
import type { SavedRace } from '../lib/storage';
import { HubProvider, useHub, useHubContext } from '../lib/hub-provider';
import { autoSyncStrava } from '../lib/strava-auto';
import { useActivities, onlyRuns, type NormalizedActivity } from '../lib/strava-activities';
import { rollupYear, weeklyMiles, currentWeekDays, funStats, trainingPulse, effortBalance, yearOfRunningHeatmap, type TrainingPulse } from '../lib/strava-stats';
import { greeting, formatWeekRange, formatShort, daysUntil, todayISO, thisWeekRange } from '../lib/dates';
import { loadRunnerProfile, ageFromBirthDate, resolveHrmax } from '../lib/runner-profile';
import { gradeVdot, HRMAX_ZONES_5, TAPER_VOLUME_REDUCTION, TAPER_INTENSITY_PRESERVATION, TAPER_ERRORS, TAPER_BENEFIT, POST_RACE_STAGES, VDOT_FIELD_TESTS, MILEAGE_TIER_RECOVERY, mileageTier, type RunnerSex } from '../coach/doctrine';
import { LONG_RUN_HARD_CAP_MULTIPLIER, TRAINING_PULSE_TO_ENGINE_PHASE, longRunTargetMi } from '../lib/long-run-cap';
import { RpeInput } from '../components/RpeInput';
import { ReadinessBanner } from '../components/coaching/ReadinessBanner';
// CoachDailyBrief import removed — voice paragraph lives on /training (audit #19)

export default function OverviewPage() {
  // The whole page is wrapped in HubProvider so every consumer below
  // — Greeting, NextRaceCard, the coach cards, the recovery widget —
  // sees ONE canonical hub payload. No per-page localStorage caches.
  return (
    <HubProvider>
      <OverviewPageInner />
    </HubProvider>
  );
}

function OverviewPageInner() {
  const [now, setNow] = useState<Date | null>(() => typeof window !== 'undefined' ? new Date() : null);
  const hub = useHub();
  const { refresh } = useHubContext();
  const { activities } = useActivities();

  // One-shot Strava actual-result sync on mount. If anything updates,
  // refresh the hub so the dashboard repaints with the freshly-imported
  // finishes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNow(new Date());
      const sync = await autoSyncStrava();
      if (cancelled) return;
      if (sync.updatedSlugs.length > 0) await refresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (now === null || hub === null) return <LoadingShell />;

  const races: SavedRace[] = hub.races;
  const upcoming = races
    .filter(r => daysUntil(r.meta.date) >= 0)
    .sort((a, b) => daysUntil(a.meta.date) - daysUntil(b.meta.date));
  const past = races
    .filter(r => daysUntil(r.meta.date) < 0)
    .sort((a, b) => daysUntil(b.meta.date) - daysUntil(a.meta.date));

  const next = upcoming[0] ?? null;
  const lastCompleted = past[0] ?? null;
  const daysToNext = next ? daysUntil(next.meta.date) : null;

  const runs = activities ? onlyRuns(activities) : null;
  const lastRun = runs && runs.length > 0
    ? runs.slice().sort((a, b) => b.startLocal.localeCompare(a.startLocal))[0]
    : null;

  return (
    <>
      <Caption left="Runcino · overview" right={`OVERVIEW · ${todayISO()}`} />
      <div className="stage">
        <Nav active="overview" />
        <div className="body">

          {/* HERO — name + mode tagline left, 4 stat cards right */}
          <div className="dash-hero">
            <HeroName now={now} hub={hub} daysToNext={daysToNext} next={next} />
            <div className="dash-hero-stats">
              <MonthMilesCard runs={runs} />
              <YtdMilesStatCard runs={runs} />
              <RecentRunCard lastRun={lastRun} />
              <NextRaceCard next={next} daysToNext={daysToNext} />
            </div>
          </div>

          {/* MAIN ROW — this week | next 30 days | today's workout */}
          <div className="dash-main-row">
            <ThisWeekTile runs={runs} now={now} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Next30DaysCard />
            </div>
            <TodayWorkoutCard runs={runs} />
          </div>

          {/* ALERTS + RPE LOG */}
          <CoachAlertsRow />
          <WorkoutRpeCard />

          {/* BODY CONTEXT — flat adaptation card grid */}
          <BodyContextCard />

          {/* PHASE GUIDANCE — taper / post-race / rebuild only */}
          <PhaseGuidanceCard />

          {/* VDOT — 6-card flat row */}
          <VdotCard />

          {/* HR ZONES — 5-card flat row */}
          <HrZonesCard />

          {/* TRAINING PULSE — 4 cards */}
          {runs && runs.length > 0 && (
            <TrainingPulseTile pulse={trainingPulse(runs, next?.meta.date ?? null, next?.meta.name ?? null)} runs={runs} />
          )}

          <FunStatsSection runs={runs} />

        </div>
      </div>
    </>
  );
}

function LoadingShell() {
  return (
    <>
      <Caption left="Runcino · overview" />
      <div className="stage">
        <Nav active="overview" />
        <div className="body">
          {/* Empty placeholder during SSR + cold hydration — keeps layout
              stable and avoids the visible "Loading…" flash. The hub
              fills in on client mount, usually within ~50ms. */}
          <div style={{ minHeight: 320 }} aria-busy="true" />
        </div>
      </div>
    </>
  );
}

/** Whether the runner is in a "special" mode that warrants the
 *  rich ModeHero card instead of the one-line ModeBanner. Mirror
 *  of the conditions inside ModeHero — kept here so callers can
 *  branch BEFORE rendering and avoid stacking both. */
function isSpecialMode(hub: import('../lib/hub-types').RunnerHub | null, daysToNext: number | null): boolean {
  if (!hub) return false;
  return daysToNext != null && daysToNext <= 7;
}

/* ── Hero name — large name + current mode tagline (left side of dash-hero) */
function HeroName({ now, hub, daysToNext, next }: {
  now: Date;
  hub: import('../lib/hub-types').RunnerHub | null;
  daysToNext: number | null;
  next: SavedRace | null;
}) {
  const phase = hub?.coach.today?.phase ?? null;
  const recentRaceDays = hub?.coach.state?.races?.recent?.[0]?.daysAgo ?? null;
  const heavyBlock = hub?.coach.state?.flags?.heavyBlockSuspected ?? false;

  type ModeEntry = { label: string; accent: string; wash: string };
  const mode: ModeEntry = (() => {
    if (daysToNext === 0) return { label: 'Race day', accent: 'var(--color-warning)', wash: 'rgba(244,63,94,.12)' };
    if (daysToNext === 1) return { label: 'Race tomorrow', accent: 'var(--color-warning)', wash: 'rgba(244,63,94,.12)' };
    if (daysToNext != null && daysToNext <= 7) return { label: `${daysToNext} days to race`, accent: 'var(--color-warning)', wash: 'rgba(244,63,94,.12)' };
    if (daysToNext != null && daysToNext <= 28) return { label: `${daysToNext} days to race`, accent: 'var(--color-attention)', wash: 'rgba(255,87,34,.10)' };
    if (heavyBlock) return { label: 'Heavy block recovery', accent: 'var(--color-corporate)', wash: 'rgba(79,143,247,.10)' };
    if (recentRaceDays != null && recentRaceDays <= 14) return { label: `Day ${recentRaceDays} post-race`, accent: 'var(--color-corporate)', wash: 'rgba(79,143,247,.10)' };
    if (phase === 'TAPER') return { label: 'Taper week', accent: 'var(--color-attention)', wash: 'rgba(255,87,34,.10)' };
    if (phase === 'PEAK') return { label: 'Peak block', accent: 'var(--color-attention)', wash: 'rgba(255,87,34,.10)' };
    if (phase === 'BUILD') return { label: 'Build phase', accent: 'var(--color-success)', wash: 'rgba(20,192,140,.10)' };
    if (phase === 'BASE_MAINTENANCE' || phase === 'BASE') return { label: 'Base maintenance', accent: 'var(--color-corporate)', wash: 'rgba(79,143,247,.10)' };
    if (phase === 'POST_RACE') return { label: 'Post-race recovery', accent: 'var(--color-corporate)', wash: 'rgba(79,143,247,.10)' };
    if (phase === 'REBUILD') return { label: 'Rebuilding', accent: 'var(--color-attention)', wash: 'rgba(255,87,34,.10)' };
    if (next) return { label: `${daysToNext != null ? `${daysToNext}d to ${next.meta.name}` : next.meta.name}`, accent: 'var(--color-t2)', wash: 'transparent' };
    return { label: 'Off season', accent: 'var(--color-t2)', wash: 'transparent' };
  })();

  const greetingText = greeting(now);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700,
        letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--color-t3)',
      }}>
        {greetingText}
      </div>
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 800,
        fontSize: 'clamp(42px, 5vw, 68px)',
        letterSpacing: '-.03em', lineHeight: .92,
        textTransform: 'uppercase', color: 'var(--color-t0)',
      }}>
        David<br />Nitzsche
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
        <div style={{ width: 28, height: 3, borderRadius: 2, background: mode.accent, flexShrink: 0 }} />
        <span style={{
          fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700,
          letterSpacing: '1.8px', textTransform: 'uppercase', color: mode.accent,
        }}>
          {mode.label}
        </span>
      </div>
    </div>
  );
}

/* ── Month miles hero stat card */
function MonthMilesCard({ runs }: { runs: NormalizedActivity[] | null }) {
  const now = new Date();
  const monthName = now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  const year = now.getFullYear();
  const monthStr = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevMonthDate = new Date(year, now.getMonth() - 1, 1);
  const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

  if (!runs) {
    return (
      <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 140 }}>
        <div className="tile-sub">MILES · {monthName}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 44, color: 'var(--color-t3)', lineHeight: 1 }}>—</div>
      </div>
    );
  }

  const thisMo = runs.filter(r => r.date.startsWith(monthStr)).reduce((s, r) => s + r.distanceMi, 0);
  const prevMo = runs.filter(r => r.date.startsWith(prevMonthStr)).reduce((s, r) => s + r.distanceMi, 0);
  const delta = prevMo > 0 ? ((thisMo - prevMo) / prevMo) : null;
  const deltaText = delta != null ? `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}%` : null;
  const deltaColor = delta == null ? 'var(--color-t3)' : delta >= 0.05 ? 'var(--color-success)' : delta <= -0.1 ? 'var(--color-warning)' : 'var(--color-t2)';

  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 140 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--color-t3)' }}>
          MILES · {monthName.slice(0, 3)}
        </div>
        {deltaText && (
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', padding: '2px 6px', borderRadius: 3, background: delta != null && delta >= 0 ? 'rgba(20,192,140,.18)' : 'rgba(244,63,94,.18)', color: deltaColor }}>
            {deltaText}
          </span>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 44, letterSpacing: '-.025em', lineHeight: 1, color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums' }}>
        {thisMo.toFixed(0)}<small style={{ fontSize: '.32em', opacity: .55, marginLeft: 3 }}>mi</small>
      </div>
      {prevMo > 0 && (
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t3)', fontWeight: 600, letterSpacing: '.4px', marginTop: 'auto' }}>
          vs {prevMonthDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} · {prevMo.toFixed(0)} mi
        </div>
      )}
    </div>
  );
}

/* ── YTD miles hero stat card */
function YtdMilesStatCard({ runs }: { runs: NormalizedActivity[] | null }) {
  if (!runs) {
    return (
      <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 140 }}>
        <div className="tile-sub">MILES · YTD</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 44, color: 'var(--color-t3)', lineHeight: 1 }}>—</div>
      </div>
    );
  }
  const r = rollupYear(runs);
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const onPacePerYear = r.totalMiles > 0 ? Math.round((r.totalMiles / dayOfYear) * 365) : 0;
  const pctOfYear = Math.round((dayOfYear / 365) * 100);

  return (
    <Link href="/log" className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 140, textDecoration: 'none', color: 'inherit',
      background: 'linear-gradient(135deg, rgba(144,19,254,.10) 0%, var(--color-l1) 100%)',
      borderColor: 'rgba(144,19,254,.28)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'rgba(144,19,254,.8)' }}>
          MILES · {now.getFullYear()} YTD
        </div>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', padding: '2px 6px', borderRadius: 3, background: 'rgba(144,19,254,.18)', color: 'rgba(180,80,255,1)' }}>
          {pctOfYear}%
        </span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 44, letterSpacing: '-.025em', lineHeight: 1, color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(r.totalMiles).toLocaleString()}<small style={{ fontSize: '.32em', opacity: .55, marginLeft: 3 }}>mi</small>
      </div>
      {onPacePerYear > 0 && (
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'rgba(180,80,255,.7)', fontWeight: 600, letterSpacing: '.4px', marginTop: 'auto' }}>
          on pace · {onPacePerYear.toLocaleString()} / yr
        </div>
      )}
    </Link>
  );
}

/* ── Today workout card — the big center card */
function TodayWorkoutCard({ runs }: { runs: NormalizedActivity[] | null }) {
  const ctx = useCoachToday();
  if (!ctx || !ctx.ok || !ctx.today) return null;
  const payload = ctx.today;
  const t = payload.today;

  const typeColor: Record<string, string> = {
    recovery:            'var(--color-t2)',
    general_aerobic:     'var(--color-success)',
    medium_long:         'var(--color-corporate)',
    long_steady:         'var(--color-corporate)',
    long_progression:    'var(--color-corporate)',
    long_mp_block:       'var(--color-attention)',
    threshold:           'var(--color-attention)',
    threshold_intervals: 'var(--color-attention)',
    sub_threshold:       'var(--color-attention)',
    vo2:                 'var(--color-warning)',
    marathon_specific:   'var(--color-attention)',
    strides_appended:    'var(--color-success)',
    shakeout:            'var(--color-success)',
    rest:                'var(--color-t3)',
    race:                'var(--color-warning)',
    vdot_test_5k:        'var(--color-warning)',
  };

  const dayLabels = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  const todayDowEntry = payload.weekShape.find(d => d.isToday);
  const todayUtcDow = new Date((todayDowEntry?.date ?? new Date().toISOString().slice(0,10)) + 'T12:00:00Z').getUTCDay();
  const todayLabel = dayLabels[(todayUtcDow + 6) % 7];
  const color = typeColor[t.type] ?? 'var(--color-t2)';
  const todayISOStr = new Date().toISOString().slice(0, 10);

  const actualByDate = new Map<string, number>();
  if (runs) {
    for (const r of runs) {
      const prev = actualByDate.get(r.date) ?? 0;
      if (r.distanceMi > prev) actualByDate.set(r.date, r.distanceMi);
    }
  }

  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color }}>
          TODAY · {todayLabel}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {payload.isPlaceholder && (
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 8, fontWeight: 700, letterSpacing: '1px', padding: '2px 6px', borderRadius: 3, background: 'var(--color-l3)', color: 'var(--color-t3)' }}>PLACEHOLDER</span>
          )}
        </div>
      </div>

      {/* Workout name — large */}
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, letterSpacing: '-.015em', lineHeight: 1.05, color, textTransform: 'uppercase' }}>
        {t.label || t.type.replace(/_/g, ' ')}
      </div>

      {/* Data row */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {t.distanceMi > 0 && (
          <div>
            <div style={{ fontFamily: 'var(--font-data)', fontWeight: 800, fontSize: 20, color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{t.distanceMi.toFixed(1)}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, color: 'var(--color-t3)', letterSpacing: '1px', marginTop: 2 }}>MI</div>
          </div>
        )}
        {t.hrZone != null && (
          <div>
            <div style={{ fontFamily: 'var(--font-data)', fontWeight: 800, fontSize: 20, color: 'var(--color-t0)', lineHeight: 1 }}>Z{t.hrZone}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, color: 'var(--color-t3)', letterSpacing: '1px', marginTop: 2 }}>HR ZONE</div>
          </div>
        )}
        {t.paceTargetSPerMi && (
          <div>
            <div style={{ fontFamily: 'var(--font-data)', fontWeight: 800, fontSize: 20, color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtPaceBand(t.paceTargetSPerMi)}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, color: 'var(--color-t3)', letterSpacing: '1px', marginTop: 2 }}>/MI</div>
          </div>
        )}
      </div>

      {/* Description */}
      <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.55, flex: 1 }}>{t.description}</div>

      {/* Week shape strip */}
      <div style={{ borderTop: '1px solid var(--color-l4)', paddingTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {payload.weekShape.map(d => {
            const dayDow = new Date(d.date + 'T12:00:00Z').getUTCDay();
            const dowLabel = dayLabels[(dayDow + 6) % 7];
            const c = typeColor[d.type] ?? 'var(--color-t3)';
            const isPast = d.date < todayISOStr;
            const actualMi = actualByDate.get(d.date);
            const showActual = (isPast || d.isToday) && actualMi != null;
            return (
              <div key={d.date} style={{
                padding: '8px 6px', borderRadius: 6,
                background: d.isToday ? 'rgba(255,87,34,.08)' : 'var(--color-l2)',
                border: `1px solid ${d.isToday ? 'rgba(255,87,34,.35)' : 'var(--color-l4)'}`,
                display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center',
                opacity: isPast && !actualMi ? 0.5 : 1,
              }}>
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 8, fontWeight: 700, letterSpacing: '1px', color: d.isToday ? 'var(--color-attention)' : 'var(--color-t3)' }}>{dowLabel}</div>
                {showActual && actualMi != null ? (
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 800, color: 'var(--color-success)', lineHeight: 1 }}>{actualMi.toFixed(1)}</div>
                ) : (
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, fontWeight: 700, color: c, textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.1 }}>
                    {d.distanceMi > 0 ? d.distanceMi.toFixed(1) : d.type === 'rest' ? 'R' : '—'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Strength if today has it */}
      {payload.strength && (
        <div style={{ borderTop: '1px solid var(--color-l4)', paddingTop: 12 }}>
          <StrengthTile strength={payload.strength} />
        </div>
      )}
    </div>
  );
}

/* ── Coach alerts row — readiness + alert chips below the main row */
function CoachAlertsRow() {
  const ctx = useCoachToday();
  if (!ctx || !ctx.ok || !ctx.today) return null;
  const payload = ctx.today;
  const readiness = ctx.coach?.readiness?.answer ?? null;
  const hasAlerts = payload.alerts.length > 0;
  const hasReadiness = readiness && (readiness.level !== 'green' || readiness.signals.length > 0);
  if (!hasAlerts && !hasReadiness) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
      {hasReadiness && readiness && <ReadinessBanner readiness={readiness} />}
      {payload.alerts.map((a, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8,
          fontSize: 13, lineHeight: 1.4,
          background: a.severity === 'rest' ? 'rgba(252,77,84,.10)' : a.severity === 'warn' ? 'rgba(243,173,59,.08)' : 'var(--color-l2)',
          border: `1px solid ${a.severity === 'rest' ? 'rgba(252,77,84,.3)' : a.severity === 'warn' ? 'rgba(243,173,59,.3)' : 'var(--color-l4)'}`,
          color: 'var(--color-t1)',
        }}>
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px',
            color: a.severity === 'rest' ? 'var(--color-warning)' : a.severity === 'warn' ? 'var(--color-attention)' : 'var(--color-corporate)',
            padding: '3px 8px', borderRadius: 4, border: '1px solid currentColor',
          }}>{a.severity === 'rest' ? 'REST' : a.severity === 'warn' ? 'WARN' : 'INFO'}</span>
          <span>{a.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Mode banner — current training-mode pill at the top of the
   dashboard. Maps the engine's phase + the next race's daysToNext
   into a one-line "what mode are we in" header that color-shifts
   with the season. Per Section 8a of the inventory: mode shapes
   composition, not new pages. */
function ModeBanner({ daysToNext, hub }: { daysToNext: number | null; hub: import('../lib/hub-types').RunnerHub | null }) {
  const phase = hub?.coach.today?.phase ?? null;
  const recentRaceDays = hub?.coach.state?.races?.recent?.[0]?.daysAgo ?? null;
  const heavyBlock = hub?.coach.state?.flags?.heavyBlockSuspected ?? false;

  // Mode resolution — first match wins.
  const mode = (() => {
    if (daysToNext != null && daysToNext === 0) return { label: 'Race day', accent: 'var(--color-warning)', detail: 'Trust the prep. Run the race in the first half-mile, not the last' };
    if (daysToNext != null && daysToNext === 1) return { label: 'Race tomorrow', accent: 'var(--color-warning)', detail: 'Last shakeout, hydrate, fuel, sleep. The work is done' };
    if (daysToNext != null && daysToNext <= 7) return { label: 'Race week', accent: 'var(--color-warning)', detail: 'Taper week — protect freshness, no new fitness' };
    if (daysToNext != null && daysToNext <= 28) return { label: 'Race month', accent: 'var(--color-attention)', detail: 'Sharpening phase — race-specific work, accumulating taper' };
    if (heavyBlock) return { label: 'Heavy-block recovery', accent: 'var(--color-corporate)', detail: 'Recovery is the work — let stacked races absorb' };
    if (recentRaceDays != null && recentRaceDays <= 14) return { label: 'Post-race recovery', accent: 'var(--color-corporate)', detail: `${recentRaceDays} day${recentRaceDays === 1 ? '' : 's'} since the last race — easing back in` };
    if (phase === 'PEAK') return { label: 'Peak block', accent: 'var(--color-attention)', detail: 'The hardest training of the cycle — ride the line' };
    if (phase === 'BUILD') return { label: 'Build phase', accent: 'var(--color-success)', detail: 'Aerobic base + quality work — adding fitness' };
    if (phase === 'BASE_MAINTENANCE' || phase === 'BASE') return { label: 'Base block', accent: 'var(--color-corporate)', detail: 'Maintaining the base — easy + frequent' };
    if (phase === 'POST_RACE') return { label: 'Post-race recovery', accent: 'var(--color-corporate)', detail: 'Reverse taper — rebuild volume before quality' };
    if (phase === 'REBUILD') return { label: 'Rebuild', accent: 'var(--color-attention)', detail: 'Returning from a break — gentle ramp back' };
    return { label: 'Off-season', accent: 'var(--color-t2)', detail: 'No race in sight — recharge, cross-train, set the next goal' };
  })();

  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 16, flexWrap: 'wrap',
      padding: '14px 18px',
      borderRadius: 8,
      marginBottom: 12,
      background: `linear-gradient(90deg, ${mode.accent.replace('var(', 'rgba(').replace(')', ', 0.10)')} 0%, transparent 60%)`,
      borderLeft: `3px solid ${mode.accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: 1, minWidth: 280 }}>
        <span style={{
          fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 800, letterSpacing: '1.6px',
          color: mode.accent, textTransform: 'uppercase',
        }}>
          MODE
        </span>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700,
          color: 'var(--color-t0)', letterSpacing: '-.005em',
        }}>
          {mode.label}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.4 }}>
          {mode.detail}
        </span>
      </div>
      {phase && (
        <span style={{
          fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px',
          padding: '3px 7px', borderRadius: 3,
          border: `1px solid ${mode.accent}`,
          color: mode.accent,
          textTransform: 'uppercase',
        }}>
          {phase}
        </span>
      )}
    </div>
  );
}

/* ── Mode-specific hero — overlay above the standard dashboard
   when the runner is in a "special" mode (race-day / race-week /
   post-race / heavy-block). Renders nothing in normal training so
   the regular Greeting + 4-card grid + Today tile take over. */
function ModeHero({ daysToNext, next, hub }: {
  daysToNext: number | null;
  next: SavedRace | null;
  hub: import('../lib/hub-types').RunnerHub | null;
}) {
  if (!hub) return null;
  const recentRace = hub.coach.state?.races?.recent?.[0] ?? null;
  const heavyBlock = hub.coach.state?.flags?.heavyBlockSuspected ?? false;

  // Race-day hero — dominant countdown, race-day-essentials list,
  // direct link to the race detail page.
  if (daysToNext === 0 && next) {
    return (
      <div className="tile" style={{
        marginBottom: 14, padding: '32px 36px',
        background: `linear-gradient(135deg, var(--color-l2) 0%, rgba(252, 77, 84, 0.18) 100%)`,
        borderColor: 'rgba(252, 77, 84, 0.4)',
        borderLeftWidth: 4,
        borderLeftColor: 'var(--color-warning)',
      }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.8px', color: 'var(--color-warning)', fontWeight: 800 }}>
          RACE DAY · TODAY
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56,
          letterSpacing: '-.018em', lineHeight: 1, color: 'var(--color-t0)',
          marginTop: 6, textTransform: 'uppercase',
        }}>
          {next.meta.name}
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-t1)', marginTop: 10, maxWidth: 600, lineHeight: 1.55 }}>
          The training is done. First three miles slower than you want; whatever you feel right now is nerves, not fitness. Trust the plan, eat the gels, hit your mile splits, and let the race come to you.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <Link href={`/races/${next.slug}`} className="btn btn--primary">
            Open race plan →
          </Link>
        </div>
      </div>
    );
  }

  // Race-week hero — countdown + taper essentials checklist.
  if (daysToNext != null && daysToNext > 0 && daysToNext <= 7 && next) {
    const checklist = [
      'Sleep — bank the hours, especially 2 nights out',
      'Hydration — carry a bottle through the day, sodium-rich foods',
      'Nothing new — no new shoes, no new fueling, no new routes',
      'Light shakeout 2 days out, full rest day before',
      'Lay out kit + pin bib the night before',
    ];
    return (
      <div className="tile" style={{
        marginBottom: 14, padding: '24px 28px',
        background: `linear-gradient(135deg, var(--color-l2) 0%, rgba(243, 173, 59, 0.10) 100%)`,
        borderColor: 'rgba(243, 173, 59, 0.32)',
        borderLeftWidth: 3,
        borderLeftColor: 'var(--color-attention)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.8px', color: 'var(--color-attention)', fontWeight: 800 }}>
              RACE WEEK · {daysToNext} DAY{daysToNext === 1 ? '' : 'S'} OUT
            </div>
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36,
              letterSpacing: '-.005em', lineHeight: 1.05, color: 'var(--color-t0)', marginTop: 4,
            }}>
              {next.meta.name}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-t2)', marginTop: 6, maxWidth: 480, lineHeight: 1.5 }}>
              Taper protects freshness — no new fitness this week, just maintenance. Your job: protect sleep, fuel well, stay calm.
            </div>
          </div>
          <Link href={`/races/${next.slug}`} className="btn btn--primary">Race plan →</Link>
        </div>
        <ul style={{ marginTop: 14, paddingLeft: 18, fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.6 }}>
          {checklist.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>
    );
  }

  // Post-race hero — graduated recovery panel using REVERSE_TAPER focus.
  if (recentRace && recentRace.daysAgo <= 21) {
    const weekPostRace = Math.floor(recentRace.daysAgo / 7) + 1;
    const focusByWeek: Record<number, string> = {
      1: 'Rest / walk / minimal jog. Days 0-3: walks only or rest. Days 4-7: 20-30 min very easy jogs every other day.',
      2: 'Rebuild frequency — most days a short easy run. All easy, RPE 3-4. Strides only if legs feel clean.',
      3: 'Rebuild duration — longer easy runs, no quality. First structured surges late in the week (4-6 × 1 min @ 10K effort).',
      4: 'Reintroduce strides + one light tempo (15-20 min @ HMP). First true workout — re-evaluate before adding a second.',
    };
    const focus = focusByWeek[Math.min(weekPostRace, 4)] ?? 'Returning to full structure — quality work resumes this week.';
    return (
      <div className="tile" style={{
        marginBottom: 14, padding: '24px 28px',
        background: `linear-gradient(135deg, var(--color-l2) 0%, rgba(79, 143, 247, 0.12) 100%)`,
        borderColor: 'rgba(79, 143, 247, 0.3)',
        borderLeftWidth: 3,
        borderLeftColor: 'var(--color-corporate)',
      }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.8px', color: 'var(--color-corporate)', fontWeight: 800 }}>
          POST-RACE · WEEK {weekPostRace} OF RECOVERY
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30,
          letterSpacing: '-.005em', lineHeight: 1.1, color: 'var(--color-t0)', marginTop: 4,
        }}>
          {recentRace.daysAgo === 0 ? 'Today' : `${recentRace.daysAgo} day${recentRace.daysAgo === 1 ? '' : 's'} since`} {recentRace.name}
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-t1)', marginTop: 10, lineHeight: 1.55 }}>
          {focus}
        </div>
      </div>
    );
  }

  // Heavy-block hero — when the engine flagged stacked races/load.
  // Tier-aware copy: shows the runner what posture the engine is
  // taking for THEIR mileage history, not a generic "rest two weeks".
  if (heavyBlock) {
    const weeklyAvg4w = hub.coach.state?.volume?.weeklyAvg4w ?? 0;
    const tier = mileageTier(weeklyAvg4w);
    const tierData = MILEAGE_TIER_RECOVERY.value[tier];
    const restDays = tierData.restDaysPerWeekHigh;
    return (
      <div className="tile" style={{
        marginBottom: 14, padding: '20px 24px',
        background: `linear-gradient(135deg, var(--color-l2) 0%, rgba(252, 77, 84, 0.08) 100%)`,
        borderLeftWidth: 3,
        borderLeftColor: 'var(--color-warning)',
      }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.8px', color: 'var(--color-warning)', fontWeight: 800 }}>
          HEAVY BLOCK · DEEP RECOVERY
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--color-t1)', marginTop: 8, lineHeight: 1.55, maxWidth: 600 }}>
          Recent training stacked harder than typical — multiple races, sustained high mileage, or both. Recovery IS the work right now. Volume drops are intentional, not a failure of consistency.
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-t2)', marginTop: 8, lineHeight: 1.55, maxWidth: 600 }}>
          Calibrated to your <strong style={{ color: 'var(--color-t1)' }}>{tierData.label}</strong> tier ({Math.round(weeklyAvg4w)} mi/wk avg):
          {restDays >= 1 ? ` ${restDays} rest day${restDays === 1 ? '' : 's'}/wk,` : ''} reduced-volume easy aerobic the rest of the week — not weeks of zero running.
        </div>
      </div>
    );
  }

  // Standard mode — no hero needed. The Greeting + 4-card grid +
  // CoachTodayCard handle daily prescription clearly.
  return null;
}

function Greeting({
  now, next, daysToNext,
}: {
  now: Date; next: SavedRace | null; daysToNext: number | null; lastCompleted: SavedRace | null;
}) {
  const chipLabel = (() => {
    if (daysToNext === 0) return { text: 'Race day', accent: 'var(--color-warning)' };
    if (daysToNext === 1) return { text: 'Race tomorrow', accent: 'var(--color-warning)' };
    if (daysToNext != null && daysToNext <= 7) return { text: 'Race week', accent: 'var(--color-warning)' };
    if (daysToNext != null && daysToNext <= 28) return { text: 'Race month', accent: 'var(--color-attention)' };
    return null;
  })();

  return (
    <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, padding: '0 2px', flexWrap: 'wrap' }}>
      <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--color-t3)', fontWeight: 700 }}>
        {greeting(now)}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, letterSpacing: '-.01em', textTransform: 'uppercase', color: 'var(--color-t0)', lineHeight: 1 }}>
        David
      </span>
      {chipLabel && (
        <span style={{
          fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 800, letterSpacing: '1.4px',
          textTransform: 'uppercase', color: chipLabel.accent,
          padding: '3px 8px', borderRadius: 3,
          border: `1px solid ${chipLabel.accent}`,
        }}>
          {chipLabel.text}
        </span>
      )}
      {next && daysToNext != null && daysToNext > 7 && (
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t3)', fontWeight: 600 }}>
          · {daysToNext}d to {next.meta.name}
        </span>
      )}
    </div>
  );
}

function NextRaceCard({ next, daysToNext }: { next: SavedRace | null; daysToNext: number | null }) {
  if (!next) {
    return (
      <Link href="/races/new" className="tile" style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 160, gap: 14,
        textDecoration: 'none', color: 'inherit', cursor: 'pointer',
        background: 'linear-gradient(135deg, rgba(243,173,59,.08), var(--color-l1))',
        borderColor: 'rgba(243,173,59,.25)',
      }}>
        <div className="tile-sub" style={{ color: 'var(--color-attention)' }}>Next race</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', color: 'var(--color-t0)', lineHeight: .95 }}>
          + Add race
        </div>
        <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>None scheduled</div>
      </Link>
    );
  }
  return (
    <Link href={`/races/${next.slug}`} className="tile" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 160, gap: 14,
      textDecoration: 'none', color: 'inherit', cursor: 'pointer',
      background: 'linear-gradient(135deg, rgba(243,173,59,.18), var(--color-l1))',
      borderColor: 'rgba(243,173,59,.4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="tile-sub" style={{ color: 'var(--color-attention)' }}>Next race</div>
        <span className="chip chip--attention">
          {daysToNext === 0 ? 'TODAY' : daysToNext === 1 ? 'TOMORROW' : `${daysToNext} DAYS`}
        </span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32, letterSpacing: '-.015em', color: 'var(--color-attention)', lineHeight: .95, textTransform: 'uppercase' }}>
        {next.meta.name}
      </div>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, letterSpacing: 1.4, color: 'var(--color-t2)', fontWeight: 700 }}>
        Goal {next.meta.goalDisplay} · {formatShort(next.meta.date)}
      </div>
    </Link>
  );
}

function RecentRunCard({ lastRun }: { lastRun: NormalizedActivity | null }) {
  if (!lastRun) {
    return <PlaceholderCard label="Last run" pill="No data" />;
  }
  const back = Math.abs(daysUntil(lastRun.date));
  const paceMin = Math.floor(lastRun.paceSPerMi / 60);
  const paceSec = lastRun.paceSPerMi % 60;
  return (
    <Link href={`/runs/${lastRun.id}`} className="tile" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 160, gap: 12,
      textDecoration: 'none', color: 'inherit', cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="tile-sub">Last run</div>
        <span className="chip">{back === 0 ? 'TODAY' : back === 1 ? 'YESTERDAY' : `${back}D AGO`}</span>
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 38, letterSpacing: '-.02em', lineHeight: .95, color: 'var(--color-t0)' }}>
          {lastRun.distanceMi.toFixed(1)}<small style={{ fontSize: '.4em', opacity: .55, marginLeft: 4 }}>mi</small>
        </div>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, letterSpacing: 1.4, color: 'var(--color-t2)', fontWeight: 700, marginTop: 4 }}>
          {paceMin}:{String(paceSec).padStart(2, '0')}/MI{lastRun.avgHr ? ` · ${Math.round(lastRun.avgHr)} BPM` : ''}
        </div>
      </div>
      <div className="tile-sub" style={{ color: 'var(--color-t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {lastRun.name}
      </div>
    </Link>
  );
}

function WeeklyMilesCard({ runs }: { runs: NormalizedActivity[] | null }) {
  if (!runs) return <PlaceholderCard label="This week" pill="Connect Strava" />;
  const { start, end } = thisWeekRange();
  const inWeek = runs.filter(r => r.date >= start && r.date <= end);
  const miles = inWeek.reduce((s, a) => s + a.distanceMi, 0);
  const last4 = weeklyMiles(runs, 4);
  const max4 = Math.max(...last4.map(w => w.miles), 1);
  return (
    <Link href="/log" className="tile" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 160, gap: 10,
      textDecoration: 'none', color: 'inherit', cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="tile-sub">Week miles</div>
        <span className="chip">{inWeek.length} RUN{inWeek.length === 1 ? '' : 'S'}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, letterSpacing: '-.025em', lineHeight: 1, color: 'var(--color-t0)' }}>
        {miles.toFixed(1)}<small style={{ fontSize: '.3em', opacity: .55, marginLeft: 4 }}>mi</small>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 28 }}>
        {last4.map((w, i) => (
          <div key={i} style={{
            flex: 1,
            height: `${Math.max(2, (w.miles / max4) * 28)}px`,
            background: i === last4.length - 1 ? 'var(--color-corporate)' : 'var(--color-l4)',
            borderRadius: 2,
          }} title={`Week of ${w.weekStart}: ${w.miles} mi`} />
        ))}
      </div>
    </Link>
  );
}

function YearMilesCard({ runs }: { runs: NormalizedActivity[] | null }) {
  if (!runs) return <PlaceholderCard label="Year miles" pill="Connect Strava" />;
  const r = rollupYear(runs);
  return (
    <Link href="/log" className="tile" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 160, gap: 10,
      textDecoration: 'none', color: 'inherit', cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="tile-sub">YTD miles</div>
        <span className="chip">{r.totalRuns} RUN{r.totalRuns === 1 ? '' : 'S'}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, letterSpacing: '-.025em', lineHeight: 1, color: 'var(--color-t0)' }}>
        {Math.round(r.totalMiles).toLocaleString()}<small style={{ fontSize: '.3em', opacity: .55, marginLeft: 4 }}>mi</small>
      </div>
      <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>
        {r.totalElevFt.toLocaleString()} ft climbed · longest {r.longestRunMi} mi
      </div>
    </Link>
  );
}

function PlaceholderCard({ label, pill }: { label: string; pill: string }) {
  return (
    <div className="tile" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 160, gap: 14,
      borderStyle: 'dashed', background: 'transparent',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="tile-sub">{label}</div>
        <span className="chip">{pill}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 64, color: 'var(--color-t3)', lineHeight: 1 }}>—</div>
      <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>No data</div>
    </div>
  );
}

function ThisWeekTile({ runs, now }: { runs: NormalizedActivity[] | null; now: Date }) {
  if (!runs) {
    return (
      <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 220 }}>
        <div className="tile-h">
          <div>
            <div className="tile-sub">This week</div>
            <div className="tile-lbl">{formatWeekRange(now)}</div>
          </div>
          <span className="chip">CONNECT STRAVA</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, color: 'var(--color-t3)', lineHeight: 1, letterSpacing: '-.025em' }}>—</div>
          <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>No data</div>
        </div>
      </div>
    );
  }
  const days = currentWeekDays(runs);
  const totalMi = days.reduce((s, d) => s + d.miles, 0);
  const totalRuns = days.reduce((s, d) => s + d.runs, 0);
  const max = Math.max(...days.map(d => d.miles), 1);
  const dayLabels = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 220 }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">This week</div>
          <div className="tile-lbl">{formatWeekRange(now)}</div>
        </div>
        <span className="chip chip--success">{totalRuns} RUN{totalRuns === 1 ? '' : 'S'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, color: 'var(--color-t0)', lineHeight: 1, letterSpacing: '-.025em' }}>
          {totalMi.toFixed(1)}<small style={{ fontSize: '.3em', opacity: .55, marginLeft: 4 }}>mi</small>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, flex: 1 }}>
        {days.map((d, i) => {
          const h = d.miles > 0 ? Math.max(6, (d.miles / max) * 80) : 0;
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, color: d.miles > 0 ? 'var(--color-t1)' : 'var(--color-t3)', fontWeight: 700 }}>
                {d.miles > 0 ? d.miles.toFixed(1) : '—'}
              </div>
              <div style={{
                width: '100%',
                height: h ? `${h}px` : '6px',
                background: h ? (d.isToday ? 'var(--color-attention)' : 'var(--color-corporate)') : 'var(--color-l3)',
                borderRadius: 2,
                opacity: d.isFuture ? 0.5 : 1,
              }} />
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: d.isToday ? 'var(--color-attention)' : 'var(--color-t3)', fontWeight: 700, letterSpacing: '1.2px' }}>
                {dayLabels[i]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TodayTile({ now, next, daysToNext, runs }: { now: Date; next: SavedRace | null; daysToNext: number | null; runs: NormalizedActivity[] | null }) {
  const isRaceToday = daysToNext === 0 && next;
  const isRaceTomorrow = daysToNext === 1 && next;
  const todayDow = now.toLocaleDateString('en-US', { weekday: 'long' });
  const todayShort = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  // todayISO() is LA-tz-aware; raw `now.toISOString().slice(0,10)` would
  // return the UTC date and miss runs after ~4pm PT (when UTC has already
  // ticked over to "tomorrow").
  const todayISOStr = todayISO();
  const todayRuns = runs ? runs.filter(r => r.date === todayISOStr) : [];

  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 220, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: isRaceToday ? 'var(--color-attention)' : todayRuns.length > 0 ? 'var(--color-success)' : 'var(--color-corporate)' }} />
      <div className="tile-h">
        <div>
          <div className="tile-sub" style={{ color: isRaceToday ? 'var(--color-attention)' : 'var(--color-corporate)' }}>Today</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, textTransform: 'uppercase', letterSpacing: '.005em', lineHeight: 1, color: 'var(--color-t0)' }}>
            {todayDow}, {todayShort}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 12 }}>
        {isRaceToday && next && (
          <>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, lineHeight: .95, textTransform: 'uppercase' }}>{next.meta.name}</div>
            <Link href={`/races/${next.slug}`} className="btn btn--primary">Open race plan →</Link>
          </>
        )}
        {!isRaceToday && isRaceTomorrow && next && (
          <>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, color: 'var(--color-attention)', textTransform: 'uppercase' }}>Race tomorrow</div>
            <Link href={`/races/${next.slug}`} className="btn">Review {next.meta.name} →</Link>
          </>
        )}
        {!isRaceToday && !isRaceTomorrow && todayRuns.length > 0 && (
          <>
            <span className="chip chip--success" style={{ alignSelf: 'flex-start' }}>RAN TODAY</span>
            {todayRuns.map(r => {
              const m = Math.floor(r.paceSPerMi / 60);
              const s = r.paceSPerMi % 60;
              return (
                <Link key={r.id} href={`/runs/${r.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32, color: 'var(--color-t0)', letterSpacing: '-.02em', lineHeight: 1 }}>
                    {r.distanceMi.toFixed(1)} mi · {m}:{String(s).padStart(2, '0')}/mi
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-t2)', marginTop: 4 }}>{r.name}</div>
                </Link>
              );
            })}
          </>
        )}
        {!isRaceToday && !isRaceTomorrow && todayRuns.length === 0 && (
          <>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, color: 'var(--color-t3)', lineHeight: 1, letterSpacing: '-.025em' }}>—</div>
            <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>No run logged today</div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', maxWidth: 360 }}>
              Today&apos;s coach workout shows here once Coach is on. For now, head to <Link href="/races" style={{ color: 'var(--color-corporate)', textDecoration: 'underline', textUnderlineOffset: 3 }}>/races</Link> for race plans or <Link href="/log" style={{ color: 'var(--color-corporate)', textDecoration: 'underline', textUnderlineOffset: 3 }}>/log</Link> for run history.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Coach today card ───────────────────────────────────────
   Calls /api/coach/today and renders the daily prescription. Engine
   logic is placeholder until the coaching research doc lands — the
   PLACEHOLDER chip on the card surfaces that explicitly so users
   don't trust heuristic guidance as final recommendation. */

interface CoachAlert { severity: 'info' | 'warn' | 'rest'; message: string }
interface CoachStrengthPayload {
  type: 'heavy' | 'power' | 'maintenance' | 'mobility' | 'rest';
  label: string;
  durationMin: number;
  description: string;
  ampMode: 'Fixed' | 'Band' | 'Eccentric' | 'Mobility';
  workout: CoachAmpWorkout | null;
  ampSuggestions: string[];
  focus: string[];
}
interface CoachAmpWorkout {
  id: string;
  name: string;
  durationMin: 30 | 45;
  ampMode: 'Fixed' | 'Band' | 'Eccentric' | 'Mobility';
  intent: string;
  blocks: Array<{ section: string; items: Array<{ name: string; sets: string; notes?: string }> }>;
  benefit: string;
}
/* ── Shared coach payload, sourced from the unified RunnerHub ─
   This dashboard previously had its own CoachTodayProvider + a
   localStorage cache that paralleled the rest of the app. Both
   collapsed into the unified `HubProvider` (lib/hub-provider.tsx),
   which carries the same coach payload plus races + profile so
   pages don't each round-trip the server.

   `useCoachToday()` is now a back-compat shim that projects the
   hub's `.coach` slice into the legacy CoachTodayApiResponse shape,
   keeping every existing consumer below unchanged. */
interface CoachTodayApiResponse {
  ok: boolean;
  today?: CoachTodayPayload;
  state?: {
    races?: {
      nextA?: { name: string; daysAway: number; distanceMi: number } | null;
      recent?: Array<{ name: string; daysAgo: number; distanceMi: number }>;
    };
  };
  vdot?: VdotTilePayload | null;
  vdotTestPrompt?: boolean;
  dailyBrief?: DailyBriefPayload | null;
  coach?: { readiness?: ReadinessPayload };
  error?: string;
}
function useCoachToday(): CoachTodayApiResponse | null {
  const hub = useHub();
  if (!hub) return null;
  const c = hub.coach as unknown as {
    today?: CoachTodayPayload;
    state?: CoachTodayApiResponse['state'];
    vdot?: VdotTilePayload | null;
    vdotTestPrompt?: boolean;
    dailyBrief?: DailyBriefPayload | null;
    coach?: { readiness?: ReadinessPayload };
  };
  return {
    ok: true,
    today: c.today,
    state: c.state,
    vdot: c.vdot ?? null,
    vdotTestPrompt: c.vdotTestPrompt,
    dailyBrief: c.dailyBrief ?? null,
    coach: { readiness: c.coach?.readiness },
  };
}

interface CoachTodayPayload {
  mode: 'race' | 'base';
  modeDetail: string;
  phase: string;
  today: {
    type: string;
    label: string;
    distanceMi: number;
    paceTargetSPerMi: { lowS: number; highS: number } | null;
    hrZone: number | null;
    description: string;
  };
  strength: CoachStrengthPayload | null;
  rationale: string;
  weekShape: Array<{ date: string; type: string; distanceMi: number; isToday: boolean; hasStrength: boolean }>;
  next30Days: Array<{
    date: string;
    type: string;
    label: string;
    distanceMi: number;
    isQuality: boolean;
    isLong: boolean;
    isToday: boolean;
    raceName: string | null;
    racePriority: 'A' | 'B' | 'C' | null;
  }>;
  alerts: CoachAlert[];
  isPlaceholder: boolean;
}

interface DailyBriefPayload {
  answer: string;
  rationale?: string;
  citations?: Array<{ doc: string; section: string; snippet?: string }>;
  brain?: 'deterministic' | 'llm';
}

interface ReadinessPayload {
  answer: {
    level: 'green' | 'yellow' | 'red';
    message: string;
    acwr: number | null;
    easyShare: number | null;
    signals: Array<{ label: string; severity: 'info' | 'warn'; detail: string }>;
    recommendedAction: string;
  };
}

function CoachTodayCard({ runs }: { runs: NormalizedActivity[] | null }) {
  const ctx = useCoachToday();
  if (!ctx || !ctx.ok || !ctx.today) return null;
  const payload = ctx.today;
  const readiness = ctx.coach?.readiness?.answer ?? null;
  // dailyBrief / voice paragraph dropped from dashboard — it lives on
  // /training daily-briefing now (audit #19). Dashboard role is at-a-glance.

  // Build a map of actual run miles by date so the week strip can
  // reflect what HAPPENED on past days instead of the prescription
  // it was given (which is all REST during post-race recovery).
  // Audit #11.
  const actualByDate = new Map<string, number>();
  if (runs) {
    for (const r of runs) {
      const prev = actualByDate.get(r.date) ?? 0;
      if (r.distanceMi > prev) actualByDate.set(r.date, r.distanceMi);
    }
  }
  const todayISOStr = new Date().toISOString().slice(0, 10);

  const t = payload.today;
  // Workout types map to a color so the type word reads as a visual
  // chip in the Coach card + week shape. New engine vocabulary covers
  // all 9 categories from the doc + a few helpers.
  const typeColor: Record<string, string> = {
    recovery:            'var(--color-t2)',
    general_aerobic:     'var(--color-success)',
    medium_long:         'var(--color-corporate)',
    long_steady:         'var(--color-corporate)',
    long_progression:    'var(--color-corporate)',
    long_mp_block:       'var(--color-attention)',
    threshold:           'var(--color-attention)',
    threshold_intervals: 'var(--color-attention)',
    sub_threshold:       'var(--color-attention)',
    vo2:                 'var(--color-warning)',
    marathon_specific:   'var(--color-attention)',
    strides_appended:    'var(--color-success)',
    shakeout:            'var(--color-success)',
    rest:                'var(--color-t3)',
    race:                'var(--color-attention)',
    vdot_test_5k:        'var(--color-warning)',
  };
  const dayLabels = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  const todayUtcDow = new Date(payload.weekShape.find(d => d.isToday)?.date + 'T12:00:00Z').getUTCDay();
  const todayLabel = dayLabels[(todayUtcDow + 6) % 7];

  return (
    <>
      <SectionHeader title="Coach says" sub={payload.modeDetail} />

      {/* Alert chips render above the prescription tile when state-
          driven flags fire. These are real signals (heavy block,
          rebuild, taper window) — not placeholder. */}
      {payload.alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {payload.alerts.map((a, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13, lineHeight: 1.4,
              background: a.severity === 'rest' ? 'rgba(252,77,84,.10)' : a.severity === 'warn' ? 'rgba(243,173,59,.08)' : 'var(--color-l2)',
              border: `1px solid ${a.severity === 'rest' ? 'rgba(252,77,84,.3)' : a.severity === 'warn' ? 'rgba(243,173,59,.3)' : 'var(--color-l4)'}`,
              color: 'var(--color-t1)',
            }}>
              <span style={{
                fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px',
                color: a.severity === 'rest' ? 'var(--color-warning)' : a.severity === 'warn' ? 'var(--color-attention)' : 'var(--color-corporate)',
                padding: '3px 8px', borderRadius: 4, border: '1px solid currentColor',
              }}>{a.severity === 'rest' ? 'REST' : a.severity === 'warn' ? 'WARN' : 'INFO'}</span>
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="tile" style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 10 }}>
        {/* Readiness banner — green/yellow/red with the recovery
            signals from doctrine Research/00b. Hidden when null
            (legacy clients without readiness data) or when GREEN +
            no signals (don't show "everything's fine"). */}
        {readiness && (readiness.level !== 'green' || readiness.signals.length > 0) && (
          <ReadinessBanner readiness={readiness} />
        )}

        {/* Run + Strength prescription, side-by-side when both, run alone when no strength */}
        <div style={{ display: 'grid', gridTemplateColumns: payload.strength ? '1.4fr 1fr' : '1fr', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="tile-sub">Run · {todayLabel}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 48, letterSpacing: '-.025em', lineHeight: 1, color: typeColor[t.type] ?? 'var(--color-t0)', textTransform: 'uppercase' }}>
              {t.label || t.type.replace(/_/g, ' ')}
            </div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, letterSpacing: '0.5px' }}>
              {t.distanceMi > 0 ? `${t.distanceMi.toFixed(1)} MI` : '0 MI · REST DAY'}
              {t.hrZone != null && ` · HR Z${t.hrZone}`}
              {t.paceTargetSPerMi && ` · ${fmtPaceBand(t.paceTargetSPerMi)}/MI`}
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-t1)', lineHeight: 1.55, marginTop: 4 }}>
              {t.description}
            </div>
          </div>

          {payload.strength && <StrengthTile strength={payload.strength} />}
        </div>

        {/* Voice paragraph (CoachDailyBrief) lives on /training only —
            audit #19. Dashboard keeps the engine-rationale one-liner
            as a small WHY chip for traceability. */}
        <div style={{
          fontSize: 12.5, color: 'var(--color-t2)', lineHeight: 1.55,
          padding: '10px 14px', background: 'var(--color-l2)', borderRadius: 8,
          borderLeft: '3px solid var(--color-corporate)',
        }}>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-corporate)', display: 'block', marginBottom: 4 }}>WHY</span>
          {payload.rationale}
          <Link href="/training" style={{
            display: 'inline-block', marginLeft: 8,
            fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700,
            letterSpacing: '1.2px', color: 'var(--color-corporate)',
            textDecoration: 'none',
          }}>
            FULL VOICE BRIEF →
          </Link>
        </div>

        {/* Plausible week shape — re-derived every morning, not promised */}
        <div style={{ borderTop: '1px solid var(--color-l4)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="tile-sub">This Week</div>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>RE-DERIVED DAILY · NOT A PLAN</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {payload.weekShape.map(d => {
              const dayDow = new Date(d.date + 'T12:00:00Z').getUTCDay();
              const dowLabel = dayLabels[(dayDow + 6) % 7];
              const c = typeColor[d.type] ?? 'var(--color-t3)';
              const typeLabel = d.type.replace(/_/g, ' ');
              const isPast = d.date < todayISOStr;
              const actualMi = actualByDate.get(d.date);
              // Show actuals on past days OR on today when the runner
              // has already run (avoids "FRI · REST" for today after
              // a 7.4 mi rest-day override has been logged to Strava).
              const showActual = (isPast || d.isToday) && actualMi != null;
              const ranOnRest = d.type === 'rest' && actualMi != null && actualMi > 0;
              return (
                <div key={d.date} style={{
                  padding: '10px',
                  borderRadius: 8,
                  background: d.isToday ? 'rgba(243,173,59,.06)' : 'var(--color-l2)',
                  border: `1px solid ${d.isToday ? 'rgba(243,173,59,.4)' : 'var(--color-l4)'}`,
                  display: 'flex', flexDirection: 'column', gap: 6,
                  minHeight: 76,
                  opacity: isPast && !actualMi ? 0.55 : 1,
                }}>
                  {/* Top: day-of-week */}
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: d.isToday ? 'var(--color-attention)' : 'var(--color-t3)' }}>{dowLabel}</div>

                  {/* Middle: actual run on past days, prescription on
                      today/future. Past rest days with an override run
                      get an "ACTUAL" stamp + the actual miles + a
                      "ran on rest day" footnote. Audit #11. */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {showActual && actualMi != null ? (
                      <>
                        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: 'var(--color-success)', textTransform: 'uppercase', letterSpacing: '-.005em', lineHeight: 1.1 }}>
                          DONE
                        </div>
                        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                          {actualMi.toFixed(1)} MI
                        </div>
                        {ranOnRest && (
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: 8, color: 'var(--color-attention)', letterSpacing: '0.6px' }}>
                            ON REST DAY
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: c, textTransform: 'uppercase', letterSpacing: '-.005em', lineHeight: 1.1 }}>{typeLabel}</div>
                        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t2)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                          {d.distanceMi > 0 ? `${d.distanceMi.toFixed(1)} MI` : d.type === 'rest' ? 'REST' : '—'}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Bottom: strength chip (visible, color-stamped, not a tiny corner dot) */}
                  <div style={{ marginTop: 'auto' }}>
                    {d.hasStrength ? (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '4px 8px',
                        background: 'rgba(144,19,254,.12)',
                        border: '1px solid rgba(144,19,254,.32)',
                        borderRadius: 4,
                        fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700,
                        letterSpacing: '1px', color: '#B26CFF',
                      }}>
                        <span style={{ fontSize: 8 }}>●</span>
                        <span>+ STRENGTH</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Strength tile ──────────────────────────────────────────
   Renders the Amp prescription with the full curated workout when
   one is attached: name, intent, blocks (warm-up / main / finisher),
   each block listing every movement with sets + notes. Falls back
   to the legacy "focus list" rendering when no full workout is
   attached. */
function StrengthTile({ strength }: { strength: CoachStrengthPayload }) {
  const [expanded, setExpanded] = useState(false);
  const w = strength.workout;
  return (
    <div style={{
      padding: '16px 18px', borderRadius: 10,
      background: 'linear-gradient(135deg, rgba(144,19,254,.08), var(--color-l2))',
      border: '1px solid rgba(144,19,254,.25)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: '#B26CFF' }}>Strength · Amp</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', padding: '2px 6px', borderRadius: 3, background: 'rgba(144,19,254,.18)', color: '#B26CFF' }}>
            {(w?.ampMode ?? strength.ampMode).toUpperCase()} MODE
          </span>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>{w?.durationMin ?? strength.durationMin} MIN</span>
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, letterSpacing: '-.015em', lineHeight: 1, color: 'var(--color-t0)', textTransform: 'uppercase' }}>
        {w?.name ?? strength.label}
      </div>

      <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.55 }}>
        {w?.intent ?? strength.description}
      </div>

      {w && w.blocks.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 12px',
              fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.4px',
              background: 'transparent',
              color: '#B26CFF',
              border: '1px solid rgba(144,19,254,.35)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >{expanded ? '▾ HIDE WORKOUT' : '▸ SHOW WORKOUT'}</button>

          {expanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
              {w.blocks.map((b, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: '#B26CFF' }}>
                    {b.section}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 6, borderLeft: '2px solid rgba(144,19,254,.25)' }}>
                    {b.items.map((it, j) => (
                      <div key={j} style={{ paddingLeft: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--color-t0)' }}>{it.name}</span>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--color-t2)' }}>{it.sets}</span>
                        </div>
                        {it.notes && (
                          <div style={{ fontSize: 12, color: 'var(--color-t3)', lineHeight: 1.45, marginTop: 2 }}>{it.notes}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.55, marginTop: 4, paddingTop: 10, borderTop: '1px solid var(--color-l4)' }}>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)' }}>WHY · </span>
                {w.benefit}
              </div>
            </div>
          )}
        </>
      )}

      {!w && strength.focus.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-t2)', lineHeight: 1.5, marginTop: 4 }}>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>FOCUS · </span>
          {strength.focus.join(' · ')}
        </div>
      )}
    </div>
  );
}

function fmtPaceBand(p: { lowS: number; highS: number }): string {
  return `${fmtMinSec(p.lowS)}–${fmtMinSec(p.highS)}`;
}
function fmtMinSec(s: number): string {
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtHMS(s: number): string {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/* ── VDOT fitness tile ───────────────────────────────────────
   Surfaces the runner's current Daniels VDOT and the full set of
   E/M/T/I/R training pace bands. The number is anchored on the
   strongest race in the last 28 days (state.races.recent), which
   we surface as "last tested" so the runner knows how fresh the
   estimate is. Hides itself when no recent race is available —
   the engine falls back to goal pace + offsets in that case. */

interface VdotTilePayload {
  vdot: number;
  /** Tier classification — Novice / Intermediate / Advanced / Elite. */
  tier: 'novice' | 'intermediate' | 'advanced' | 'elite';
  tierLabel: string;
  /** Freshness state of the signal (how stale is the source race). */
  freshness: 'fresh' | 'stale_soon' | 'stale' | 'expired';
  freshnessNote: string;
  source: {
    name: string;
    date: string;
    daysAgo: number;
    distanceMi: number;
    timeS: number;
    paceSPerMi: number;
  };
  paces: {
    vdot: number;
    E: { lowS: number; highS: number };
    M: { lowS: number; highS: number };
    T: { lowS: number; highS: number };
    I: { lowS: number; highS: number };
    R: { lowS: number; highS: number };
  };
}

const ZONE_DEFS: Array<{
  key: 'E' | 'M' | 'T' | 'I' | 'R';
  label: string;
  sub: string;
  color: string;
  blurb: string;
  iconKey: BodyIconKey;
}> = [
  { key: 'E', label: 'Easy',      sub: 'Aerobic / recovery',   color: 'var(--color-success)',   blurb: 'Most of your weekly mileage. Conversational.', iconKey: 'spiral'  },
  { key: 'M', label: 'Marathon',  sub: 'Goal-race pace',        color: 'var(--color-corporate)', blurb: 'MP work on long-run finishers + race rehearsals.', iconKey: 'flag'    },
  { key: 'T', label: 'Threshold', sub: 'Lactate threshold',     color: 'var(--color-attention)', blurb: 'Comfortably hard · ~hour-race effort.', iconKey: 'flame'   },
  { key: 'I', label: 'Intervals', sub: 'VO₂max · ~5K pace',     color: 'var(--color-warning)',   blurb: '3–5 min reps with equal jog.', iconKey: 'bolt'    },
  { key: 'R', label: 'Reps',      sub: 'Mile pace · speed',     color: 'var(--color-active)',    blurb: '200–400m fast with full recovery.', iconKey: 'spring'  },
];

/* ── Readiness banner ──────────────────────────────────────
   Surfaces the engine's green/yellow/red readiness verdict +
   the recovery signals it detected, with the recommended action
   from doctrine Research/00b's incomplete-recovery decision matrix.
   Sits at the top of CoachTodayCard so the runner sees the read
   on themselves before they see the prescription. */
// ReadinessBanner extracted to web/components/coaching/ReadinessBanner.tsx

/* ── Daily brief + "why?" affordance ─────────────────────────
   The brief is the voice paragraph from coach.briefDailyTraining.
   Below it sits a "Why?" toggle that expands into the engine's
   structured rationale + research citations. Same affordance is
   used on the race brief — keeps the model + reasoning visible
   without cluttering the default view. */
// CoachDailyBrief extracted to web/components/coaching/CoachDailyBrief.tsx

/* ── Next-30-days tile ──────────────────────────────────────
   Bridges "today's prescription" and "the race calendar" with a
   30-day strip color-coded by workout type. Long runs get a
   darker chip; races flag with a colored bar above the cell.
   Re-derived every dashboard load (same engine path as weekShape). */
function Next30DaysCard() {
  const ctx = useCoachToday();
  const days = ctx?.today?.next30Days ?? null;
  if (!days || days.length === 0) return null;
  return <Next30DaysTile days={days} />;
}

function Next30DaysTile({ days }: { days: NonNullable<CoachTodayPayload['next30Days']> }) {
  // Same color vocabulary as CoachTodayCard's typeColor map; kept
  // local so the strip can evolve independently.
  const typeColor: Record<string, string> = {
    recovery:            'var(--color-t3)',
    general_aerobic:     'var(--color-success)',
    medium_long:         'var(--color-corporate)',
    long_steady:         'var(--color-corporate)',
    long_progression:    'var(--color-corporate)',
    long_mp_block:       'var(--color-attention)',
    threshold:           'var(--color-attention)',
    threshold_intervals: 'var(--color-attention)',
    sub_threshold:       'var(--color-attention)',
    vo2:                 'var(--color-warning)',
    vdot_test_5k:        'var(--color-warning)',
    marathon_specific:   'var(--color-attention)',
    strides_appended:    'var(--color-success)',
    shakeout:            'var(--color-success)',
    rest:                'var(--color-l4)',
    race:                'var(--color-attention)',
  };
  const racePriorityColor: Record<'A' | 'B' | 'C', string> = {
    A: 'var(--color-warning)',
    B: 'var(--color-attention)',
    C: 'var(--color-corporate)',
  };
  const totalMi = days.reduce((s, d) => s + d.distanceMi, 0);
  const qualityCount = days.filter(d => d.isQuality).length;
  const longCount = days.filter(d => d.isLong).length;
  const races = days.filter(d => d.raceName);

  const dayLabels = ['M','T','W','T','F','S','S'];
  const dowLabel = (iso: string) => {
    const d = new Date(iso + 'T12:00:00Z').getUTCDay();
    return dayLabels[(d + 6) % 7];
  };

  // First non-rest day in the strip — when the strip is mostly empty
  // (post-race, taper, etc), surface "Returns Day X: ..." so the
  // dashboard isn't a silent grey row. Audit #20.
  const firstActiveIdx = days.findIndex(d => d.type !== 'rest' && d.distanceMi > 0);
  const returnsCallout = firstActiveIdx > 0 && firstActiveIdx < days.length
    ? { idx: firstActiveIdx, day: days[firstActiveIdx] }
    : null;
  const subPieces = [
    `${Math.round(totalMi)} mi`,
    `${qualityCount} quality`,
    `${longCount} long`,
  ];
  if (returnsCallout) {
    subPieces.push(`returns Day ${returnsCallout.idx + 1}: ${returnsCallout.day.label.toLowerCase()}`);
  }

  return (
    <>
      <SectionHeader title="Next 30 days" sub={subPieces.join(' · ')} />

      <div className="tile" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 10 }}>
        {/* 30-day strip — cells scale to fill container width. */}
        <div style={{ overflowX: 'auto' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(30, 1fr)', gap: 4,
          minWidth: 480,
        }}>
          {days.map((d, idx) => {
            const c = typeColor[d.type] ?? 'var(--color-l3)';
            const isRest = d.type === 'rest';
            const raceColor = d.racePriority ? racePriorityColor[d.racePriority] : null;
            const isFirstOfMonth = new Date(d.date + 'T12:00:00Z').getUTCDate() <= 7 && idx > 0 && new Date(days[idx - 1].date + 'T12:00:00Z').getUTCMonth() !== new Date(d.date + 'T12:00:00Z').getUTCMonth();
            return (
              <div key={d.date} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                position: 'relative',
                marginLeft: isFirstOfMonth ? 4 : 0,
                paddingLeft: isFirstOfMonth ? 4 : 0,
                borderLeft: isFirstOfMonth ? '1px solid var(--color-l5)' : 'none',
              }}>
                {/* Race flag */}
                {raceColor && (
                  <div title={d.raceName ?? ''} style={{
                    height: 4, width: '100%', borderRadius: 2, background: raceColor, marginBottom: 2,
                  }} />
                )}
                {/* Day-of-week + date */}
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 8, color: 'var(--color-t3)', fontWeight: 700, lineHeight: 1 }}>
                  {dowLabel(d.date)}
                </div>
                {/* Workout type cell */}
                <div title={`${d.label} · ${d.distanceMi.toFixed(1)} mi`} style={{
                  width: '100%',
                  minHeight: d.isLong ? 38 : isRest ? 14 : d.isQuality ? 30 : 22,
                  borderRadius: 3,
                  background: isRest ? 'var(--color-l3)' : c,
                  opacity: d.isToday ? 1 : (isRest ? 0.6 : 0.85),
                  border: d.isToday ? '1.5px solid var(--color-attention)' : '1px solid transparent',
                  marginTop: 2,
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                  paddingBottom: 2,
                }}>
                  {!isRest && d.distanceMi >= 8 && (
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 8, fontWeight: 800, color: 'var(--color-l0)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                      {Math.round(d.distanceMi)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>{/* end overflow wrapper */}

        {/* Race callouts */}
        {races.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8, borderTop: '1px solid var(--color-l4)' }}>
            {races.map(r => {
              const daysOut = Math.round((new Date(r.date + 'T12:00:00Z').getTime() - new Date(days[0].date + 'T12:00:00Z').getTime()) / 86_400_000);
              const c = r.racePriority ? racePriorityColor[r.racePriority] : 'var(--color-corporate)';
              return (
                <div key={r.date} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-t1)' }}>
                  <span style={{
                    fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
                    padding: '2px 6px', borderRadius: 3,
                    background: 'rgba(255,255,255,.04)', color: c,
                  }}>{r.racePriority} · {daysOut === 0 ? 'TODAY' : `${daysOut}D`}</span>
                  <span>{r.raceName}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)', paddingTop: 4 }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--color-success)', borderRadius: 2, marginRight: 4 }} /> EASY</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--color-corporate)', borderRadius: 2, marginRight: 4 }} /> LONG</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--color-attention)', borderRadius: 2, marginRight: 4 }} /> QUALITY</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--color-warning)', borderRadius: 2, marginRight: 4 }} /> VO2 / TT</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--color-l3)', borderRadius: 2, marginRight: 4 }} /> REST</span>
        </div>
      </div>
    </>
  );
}

/* ── Workout RPE card ────────────────────────────────────────
   Post-workout perceived-effort logger. Lives directly under the
   Coach card so the runner taps a number right after the run.
   Doctrine: Research/00b §INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS
   uses RPE drift between similarly-prescribed sessions to flag
   accumulating fatigue. Visible whenever the runner has SOMETHING
   to rate — either a prescribed workout, an actual run today
   (even on a rest day — the override case), or an already-logged
   entry they might want to edit. Reads existing entry from the
   hub so taps pre-fill. */
function WorkoutRpeCard() {
  const hub = useHub();
  if (!hub) return null;
  const todayPrescription = hub.coach.today;
  if (!todayPrescription) return null;
  const todayISO = hub.meta.cacheDate;
  const existing = hub.recentRpe.find(e => e.workoutDate === todayISO) ?? null;
  // Only hide when there's NOTHING to rate: prescription was rest,
  // no actual run, and no existing entry. The "ran on a rest day"
  // case (today's bug — user logged 7.4 mi when plan was recovery)
  // now shows the slot so they can feed back.
  const ranToday = hub.coach.state?.recovery?.today != null;
  const isRestDay = todayPrescription.today.type === 'rest';
  if (isRestDay && !ranToday && !existing) return null;
  return (
    <div className="tile" style={{
      marginBottom: 10, padding: '18px 22px',
      display: 'flex', flexDirection: 'column', gap: 12,
      borderColor: existing ? 'var(--color-l4)' : 'var(--color-attention)',
      borderStyle: existing ? 'solid' : 'dashed',
    }}>
      <RpeInput workoutDate={todayISO} existing={existing} />
      {hub.recentRpe.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: '1px solid var(--color-l4)' }}>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)' }}>
            RECENT
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {hub.recentRpe.slice(0, 7).map(e => (
              <span key={e.workoutDate} title={`${e.workoutDate}${e.notes ? ` · ${e.notes}` : ''}`} style={{
                fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 800,
                padding: '3px 7px', borderRadius: 3,
                background: e.rpe >= 8 ? 'rgba(252,77,84,.18)'
                          : e.rpe >= 6 ? 'rgba(243,173,59,.18)'
                          : 'rgba(62,189,65,.18)',
                color: e.rpe >= 8 ? 'var(--color-warning)'
                     : e.rpe >= 6 ? 'var(--color-attention)'
                     : 'var(--color-success)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {e.rpe}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Phase guidance card ─────────────────────────────────────
   When the runner is in a "special" phase (TAPER / POST_RACE /
   REBUILD), surface research-backed guidance for that phase.
   Hidden during BASE / BUILD / PEAK because the regular daily
   brief already covers those — this card is for the moments
   when the playbook is non-obvious. */
/* ── BODY CONTEXT card ───────────────────────────────────────
   Plain-language physiological narrative — what the body is
   actually doing right now and WHY today's prescription is what it
   is. Doctrine-grounded (TISSUE_RECOVERY_TIMELINES,
   MARATHON_BIOMARKER_TIMELINE, MILEAGE_TIER_RECOVERY) so this isn't
   filler text — it's the science the engine is acting on.
   The runner asked: "it would help me recover better and be okay
   with it if I know why/what is happening." This tile answers that
   directly with named tissues, real timelines, and concrete what-to-do. */
type BodyIconKey = 'bolt' | 'muscle' | 'chain' | 'neural' | 'shield'
                 | 'spiral' | 'network' | 'stairs' | 'lungs' | 'spring'
                 | 'heart' | 'flame' | 'flag' | 'gauge';

function BodyIcon({ k, size = 22, color }: { k: BodyIconKey; size?: number; color: string }) {
  const s = { display: 'block' as const, color };
  if (k === 'bolt') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" style={s}>
      <path d="M12 2L5 11h5l-2 8 8-11h-5l1-6z"/>
    </svg>
  );
  if (k === 'muscle') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={s}>
      <path d="M1 7C3.5 4.5 5.5 9.5 8 7C10.5 4.5 12.5 9.5 15 7C17 4.5 18.5 7.5 19 7"/>
      <path d="M1 13C3.5 10.5 5.5 15.5 8 13C10.5 10.5 12.5 15.5 15 13C17 10.5 18.5 13.5 19 13"/>
    </svg>
  );
  if (k === 'chain') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={s}>
      <rect x="1" y="7" width="7" height="6" rx="3"/>
      <rect x="12" y="7" width="7" height="6" rx="3"/>
      <line x1="8" y1="10" x2="12" y2="10"/>
    </svg>
  );
  if (k === 'neural') return (
    <svg width={size} height={size} viewBox="0 0 20 20" strokeLinecap="round" strokeWidth="1.8" style={s}>
      <circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none"/>
      <line x1="10" y1="1"  x2="10" y2="7"    stroke="currentColor" fill="none"/>
      <line x1="10" y1="13" x2="10" y2="19"   stroke="currentColor" fill="none"/>
      <line x1="1"  y1="10" x2="7"  y2="10"   stroke="currentColor" fill="none"/>
      <line x1="13" y1="10" x2="19" y2="10"   stroke="currentColor" fill="none"/>
      <line x1="3.5" y1="3.5" x2="6.8" y2="6.8"   stroke="currentColor" fill="none"/>
      <line x1="13.2" y1="13.2" x2="16.5" y2="16.5" stroke="currentColor" fill="none"/>
    </svg>
  );
  if (k === 'shield') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" style={s}>
      <path d="M10 1.5L3 4.5v5C3 14.5 6.5 17.5 10 19c3.5-1.5 7-4.5 7-9.5v-5L10 1.5z"/>
      <path d="M7 10l2 2 4-4"/>
    </svg>
  );
  if (k === 'spiral') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={s}>
      <ellipse cx="10" cy="10" rx="7.5" ry="4.5"/>
      <path d="M6.5 10C6.5 7.5 10 7.5 10 10C10 12.5 13.5 12.5 13.5 10"/>
    </svg>
  );
  if (k === 'network') return (
    <svg width={size} height={size} viewBox="0 0 20 20" strokeLinecap="round" strokeWidth="1.8" style={s}>
      <circle cx="10" cy="3.5" r="2" fill="currentColor" stroke="none"/>
      <circle cx="4"  cy="16" r="2" fill="currentColor" stroke="none"/>
      <circle cx="16" cy="16" r="2" fill="currentColor" stroke="none"/>
      <line x1="10" y1="5.5" x2="7"  y2="14" stroke="currentColor" fill="none"/>
      <line x1="10" y1="5.5" x2="13" y2="14" stroke="currentColor" fill="none"/>
    </svg>
  );
  if (k === 'stairs') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <polyline points="2,18 2,13 6,13 6,9 10,9 10,6 14,6 14,3 18,3"/>
    </svg>
  );
  if (k === 'lungs') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <path d="M10 3v7"/>
      <path d="M10 10C10 10 6 10 5 12C4 14 4 17 7 17C9 17 10 16 10 14"/>
      <path d="M10 10C10 10 14 10 15 12C16 14 16 17 13 17C11 17 10 16 10 14"/>
      <polyline points="7,3 10,1 13,3"/>
    </svg>
  );
  if (k === 'heart') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <path d="M10 17C10 17 2.5 12 2.5 7A4 4 0 0 1 10 5.5 4 4 0 0 1 17.5 7C17.5 12 10 17 10 17z"/>
    </svg>
  );
  if (k === 'flame') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <path d="M10 2c0 0 4 5 4 9a4 4 0 0 1-8 0c0-2 1-4 1-4s-3 3-3 5.5A6 6 0 0 0 10 18a6 6 0 0 0 6-5.5C16 8 10 2 10 2z"/>
    </svg>
  );
  if (k === 'flag') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <line x1="4" y1="1.5" x2="4" y2="18.5"/>
      <path d="M4 2L16 5L4 8"/>
    </svg>
  );
  if (k === 'gauge') return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={s}>
      <path d="M3 14A8 8 0 0 1 17 14"/>
      <line x1="10" y1="14" x2="7.5" y2="8"/>
      <circle cx="10" cy="14" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  );
  // spring (tendon)
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <line x1="10" y1="1" x2="10" y2="4"/>
      <polyline points="10,4 6,6.5 14,9 6,11.5 14,14 10,16.5"/>
      <line x1="10" y1="16.5" x2="10" y2="19"/>
    </svg>
  );
}

type TissueItem = {
  name: string;
  detail: string;
  window: string;
  maxDays: number;
  status: 'done' | 'healing' | 'slow';
  note: string;
  iconKey: BodyIconKey;
};

function TissueGrid({ tissues, daysAgo }: { tissues: TissueItem[]; daysAgo: number }) {
  const statusColor: Record<TissueItem['status'], string> = {
    done:    'var(--color-success)',
    healing: 'var(--color-corporate)',
    slow:    'var(--color-warning)',
  };
  const statusLabel: Record<TissueItem['status'], string> = {
    done:    'DONE',
    healing: 'HEALING',
    slow:    'SLOW',
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
      {tissues.map((t, i) => {
        const pct = Math.min(1, daysAgo / t.maxDays);
        const c = statusColor[t.status];
        const isSlow = t.status === 'slow';
        return (
          <div key={i} style={{
            padding: '14px', borderRadius: 10,
            background: isSlow ? 'rgba(252,77,84,.06)' : 'var(--color-l2)',
            border: `1px solid ${isSlow ? 'rgba(252,77,84,.28)' : 'var(--color-l4)'}`,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <BodyIcon k={t.iconKey} size={26} color={c} />
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--color-t0)', lineHeight: 1.2 }}>{t.name}</div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, color: 'var(--color-t3)', letterSpacing: '0.5px', marginTop: 2 }}>{t.detail}</div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 8, fontWeight: 800, letterSpacing: '1.2px', color: c }}>{statusLabel[t.status]}</span>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 8, fontWeight: 700, color: 'var(--color-t3)', letterSpacing: '0.8px' }}>{t.window}</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: 'var(--color-l4)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct * 100}%`, background: c, borderRadius: 3 }} />
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--color-t2)', lineHeight: 1.4 }}>{t.note}</div>
          </div>
        );
      })}
    </div>
  );
}

function BodyContextCard() {
  const hub = useHub();
  if (!hub) return null;

  const state = hub.coach.state;
  if (!state) return null;
  const phase = hub.coach.today?.phase ?? null;
  const heavyBlock = state.flags?.heavyBlockSuspected ?? false;
  const recent = state.races?.recent ?? [];
  const mostRecent = recent[0] ?? null;
  const biggest = recent.length > 0
    ? recent.reduce((a, b) => a.distanceMi >= b.distanceMi ? a : b)
    : null;

  // ── Post-race: visual tissue recovery grid ───────────────────
  if (mostRecent && mostRecent.daysAgo <= 14) {
    const days = mostRecent.daysAgo;
    const dist = biggest?.distanceMi ?? mostRecent.distanceMi;
    const isMarathon = dist >= 22;
    const isHalf = dist >= 11 && dist < 22;

    const tissues: TissueItem[] = [
      {
        name: 'Glycogen',
        detail: 'Energy stores',
        window: '24–72h',
        maxDays: 3,
        status: days <= 3 ? 'healing' : 'done',
        note: days <= 3 ? 'Refilling — prioritise carbs' : 'Fully restored',
        iconKey: 'bolt',
      },
      {
        name: 'Muscle fibers',
        detail: 'CK · LDH biomarkers',
        window: '5–10 days',
        maxDays: 10,
        status: days <= 10 ? 'healing' : 'done',
        note: days <= 6 ? 'Microdamage actively healing' : days <= 10 ? 'Nearly resolved' : 'Healed',
        iconKey: 'muscle',
      },
      {
        name: 'Connective tissue',
        detail: 'Tendons · fascia',
        window: '2–4 weeks',
        maxDays: 28,
        status: 'slow',
        note: 'Slowest to heal — #1 injury risk now',
        iconKey: 'chain',
      },
      ...(isMarathon ? [{
        name: 'CNS + hormones',
        detail: 'Cortisol · neuromuscular',
        window: '2–4 weeks',
        maxDays: 28,
        status: 'healing' as const,
        note: 'Easy aerobic resets; hard work delays',
        iconKey: 'neural' as BodyIconKey,
      }] : []),
      {
        name: 'Immune system',
        detail: 'Open window',
        window: '1–3 weeks',
        maxDays: 21,
        status: days <= 14 ? 'healing' : 'done',
        note: 'Sleep + carbs are protective',
        iconKey: 'shield',
      },
    ];

    return (
      <>
        <SectionHeader title="What's healing" sub={`Day ${days} since ${mostRecent.name} · ${isMarathon ? 'marathon' : isHalf ? 'half marathon' : `${dist.toFixed(1)} mi race`}`} />
        <TissueGrid tissues={tissues} daysAgo={days} />
        {(heavyBlock || phase === 'POST_RACE') && (
          <div style={{ marginTop: 10, padding: '12px 18px', borderRadius: 8, background: 'var(--color-l2)', borderLeft: `3px solid ${heavyBlock ? 'var(--color-warning)' : 'var(--color-corporate)'}`, fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.55, marginBottom: 14 }}>
            {heavyBlock
              ? `${recent.length} race${recent.length === 1 ? '' : 's'} stacked — micro-damage overlaps before the previous heals. Bone remodeling lags muscle healing by 3–6 weeks. Rest days are the plan.`
              : 'Easy aerobic + protective rest restores frequency before duration before intensity. Connective tissue and CNS adapt slowest; loading too early is when injuries land.'}
          </div>
        )}
      </>
    );
  }

  // ── Build / Peak / Taper / Base: visual adaptation grid ──────
  type AdaptItem = { name: string; detail: string; window: string; note: string; color: string; iconKey: BodyIconKey };
  let introHeading = '';
  let introSub = '';
  let adaptItems: AdaptItem[] = [];

  if (phase === 'BUILD' || phase === 'PEAK') {
    introHeading = 'What\'s adapting';
    introSub = 'Build phase · fitness gains landing now';
    adaptItems = [
      { name: 'Mitochondria',      detail: 'Density + efficiency',  window: 'Ongoing',   note: 'Every easy mile feeds this',             color: 'var(--color-success)',   iconKey: 'spiral'  },
      { name: 'Capillarization',   detail: 'Muscle fiber networks', window: '2–4 weeks', note: 'New capillaries forming now',            color: 'var(--color-corporate)', iconKey: 'network' },
      { name: 'Lactate threshold', detail: 'T-zone work',          window: '3–6 weeks', note: 'Shifts upward with consistent tempo',    color: 'var(--color-attention)', iconKey: 'stairs'  },
      { name: 'VO₂max',            detail: 'Interval response',    window: '4–6 weeks', note: 'Responds to short fast reps',            color: 'var(--color-warning)',   iconKey: 'lungs'   },
      { name: 'Tendon stiffness',  detail: 'Load tolerance',       window: 'Gradual',   note: 'Hard sessions feel easier over time',   color: 'var(--color-t2)',        iconKey: 'spring'  },
    ];
  } else if (phase === 'TAPER') {
    introHeading = 'What\'s storing';
    introSub = 'Taper week · banking fitness for race day';
    adaptItems = [
      { name: 'Glycogen stores',   detail: 'Race-day fuel',         window: 'Building',    note: 'Peak carb load heading to race day',     color: 'var(--color-success)',   iconKey: 'bolt'    },
      { name: 'Mitochondria',      detail: 'Erosion: 4–6 weeks',   window: 'Holding',     note: 'Safely holding on reduced load',         color: 'var(--color-corporate)', iconKey: 'spiral'  },
      { name: 'CNS',               detail: 'Neuromuscular',        window: 'Freshening',  note: 'Legs feel snappier toward race day',     color: 'var(--color-attention)', iconKey: 'neural'  },
      { name: 'Immune system',     detail: 'URI risk',             window: 'Rebounding',  note: 'Load drop lowers illness risk',          color: 'var(--color-success)',   iconKey: 'shield'  },
      { name: 'Hormonal balance',  detail: 'Cortisol · testost.',  window: 'Normalising', note: 'Cortisol drops, testosterone normalises', color: 'var(--color-corporate)', iconKey: 'neural'  },
    ];
  } else {
    introHeading = 'What\'s building';
    introSub = 'Base block · durability and aerobic foundation';
    adaptItems = [
      { name: 'Mitochondria',      detail: 'Density + efficiency', window: 'Ongoing',   note: 'Every easy mile feeds this',             color: 'var(--color-success)',   iconKey: 'spiral'  },
      { name: 'Capillarization',   detail: 'Muscle fiber networks',window: '2–4 weeks', note: 'Steady aerobic builds new networks',     color: 'var(--color-corporate)', iconKey: 'network' },
      { name: 'Connective tissue', detail: 'Tendons · fascia',     window: 'Gradual',   note: 'Durability builds with easy mileage',   color: 'var(--color-t2)',        iconKey: 'chain'   },
    ];
  }

  if (!introHeading) return null;

  return (
    <>
      <SectionHeader title={introHeading} sub={introSub} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        {adaptItems.map((a, i) => (
          <div key={i} className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 160 }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: a.color }}>
              {a.window}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--color-t0)', lineHeight: 1.2 }}>{a.name}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, color: 'var(--color-t3)', letterSpacing: '0.5px' }}>{a.detail}</div>
            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ height: 3, borderRadius: 2, background: a.color, opacity: 0.4 }} />
              <div style={{ fontSize: 10.5, color: 'var(--color-t2)', lineHeight: 1.4 }}>{a.note}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PhaseGuidanceCard() {
  const ctx = useCoachToday();
  if (!ctx || !ctx.ok) return null;
  const phase = ctx.today?.phase ?? null;
  const nextRace = ctx.state?.races?.nextA ?? null;
  // Largest recent race drives post-race guidance.
  const recentList = ctx.state?.races?.recent ?? [];
  const recentRace = recentList.length > 0
    ? recentList.reduce((a, b) => a.distanceMi >= b.distanceMi ? a : b)
    : null;
  if (!phase) return null;
  // Only fire on special phases — others use the regular brief.
  if (phase !== 'TAPER' && phase !== 'POST_RACE' && phase !== 'REBUILD') return null;

  if (phase === 'TAPER' && nextRace) {
    return <TaperGuidancePanel race={nextRace} />;
  }
  if (phase === 'POST_RACE' && recentRace) {
    return <PostRaceGuidancePanel race={recentRace} />;
  }
  if (phase === 'REBUILD') {
    return <RebuildGuidancePanel />;
  }
  return null;
}

function TaperGuidancePanel({ race }: { race: { name: string; daysAway: number; distanceMi: number } }) {
  // Distance-aware taper window per doctrine TAPER_DURATION_WEEKS.
  const distance = race.distanceMi >= 22 ? 'marathon' : race.distanceMi >= 11 ? 'half_marathon' : race.distanceMi >= 5 ? 'tenK' : 'fiveK';
  const taperLabel = { marathon: 'Marathon (2-3wk)', half_marathon: 'Half (1-2wk)', tenK: '10K (1wk)', fiveK: '5K (1wk)' }[distance];
  const vol = TAPER_VOLUME_REDUCTION.value;
  const benefit = TAPER_BENEFIT.value;

  return (
    <>
      <SectionHeader title="Taper guidance" sub={`${race.daysAway} days to ${race.name} · ${taperLabel}`} />
      <div className="tile" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-t1)' }}>
          The fitness is built. The job now is to arrive at the start line rested without losing edge.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <PhaseGuidanceBlock
            label="VOLUME"
            primary={`Cut ${vol.totalReductionPctLow}–${vol.totalReductionPctHigh}% from peak`}
            detail={`Frequency stays near ${vol.frequencyPctOfNormal}% of normal. Keep the rhythm — don't suddenly add rest days.`}
          />
          <PhaseGuidanceBlock
            label="INTENSITY"
            primary="Preserve short, sharp work at race pace"
            detail={TAPER_INTENSITY_PRESERVATION.value.noIntensityIsBad ? 'Eliminating intensity entirely is detrimental.' : ''}
          />
          <PhaseGuidanceBlock
            label="EXPECTED BENEFIT"
            primary={`~${benefit.marathonImprovementMinutes}:${String(benefit.marathonImprovementSeconds).padStart(2, '0')} marathon improvement`}
            detail="Average across one large recreational-runner data set."
          />
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-warning)', marginBottom: 6 }}>
            COMMON ERRORS
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.55 }}>
            {TAPER_ERRORS.value.map(err => (
              <li key={err} style={{ marginBottom: 3 }}>{err}</li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function PostRaceGuidancePanel({ race }: { race: { name: string; daysAgo: number; distanceMi: number } }) {
  // Pick the matching POST_RACE_STAGES entry by distance band.
  const stage = POST_RACE_STAGES.value.stages.find(s => race.distanceMi >= s.minRaceMi)!;
  const day = race.daysAgo;
  const phase = day <= stage.restEndDay ? 'REST'
    : day <= stage.lightEndDay ? 'LIGHT'
    : day <= stage.easyEndDay ? 'EASY'
    : 'RETURN';
  const daysLeftInWindow = phase === 'REST' ? stage.restEndDay - day
    : phase === 'LIGHT' ? stage.lightEndDay - day
    : phase === 'EASY' ? stage.easyEndDay - day
    : 0;
  const phaseColors: Record<typeof phase, string> = {
    REST:   'var(--color-warning)',
    LIGHT:  'var(--color-attention)',
    EASY:   'var(--color-corporate)',
    RETURN: 'var(--color-success)',
  };
  const phaseDesc: Record<typeof phase, string> = {
    REST:   'Full rest is the highest-leverage workout right now. Sleep, eat, walk only.',
    LIGHT:  'Easy 2-3 mi recovery jogs. No quality. Skin still moves; muscle damage is still resolving.',
    EASY:   'Easy aerobic miles at 30-50% of peak volume. Long run can return at moderate length. No quality.',
    RETURN: 'Window closed — base training resumes. Doctrine: ready for structured workouts again.',
  };

  return (
    <>
      <SectionHeader title="Post-race recovery" sub={`Day ${day} since ${race.name} · ${race.distanceMi.toFixed(1)}mi`} />
      <div className="tile" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36,
            color: phaseColors[phase], lineHeight: 1, textTransform: 'uppercase',
          }}>{phase}</div>
          <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.5 }}>
            {phaseDesc[phase]}
            {daysLeftInWindow > 0 && (
              <span style={{ color: 'var(--color-t3)', display: 'block', marginTop: 4 }}>
                {daysLeftInWindow} day{daysLeftInWindow === 1 ? '' : 's'} until next stage.
              </span>
            )}
          </div>
        </div>
        {/* Stage progress bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--color-l3)' }}>
            <div style={{
              flex: stage.restEndDay,
              background: phase === 'REST' ? 'var(--color-warning)' : 'var(--color-l5)',
              borderRight: '2px solid var(--color-l1)',
            }} />
            <div style={{
              flex: stage.lightEndDay - stage.restEndDay,
              background: phase === 'LIGHT' ? 'var(--color-attention)' : 'var(--color-l5)',
              borderRight: '2px solid var(--color-l1)',
            }} />
            <div style={{
              flex: stage.easyEndDay - stage.lightEndDay,
              background: phase === 'EASY' ? 'var(--color-corporate)' : 'var(--color-l5)',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', color: 'var(--color-t3)' }}>
            <span>D0</span>
            <span>D{stage.restEndDay} · END REST</span>
            <span>D{stage.lightEndDay} · END LIGHT</span>
            <span>D{stage.easyEndDay} · BACK TO BASE</span>
          </div>
        </div>
      </div>
    </>
  );
}

function RebuildGuidancePanel() {
  return (
    <>
      <SectionHeader title="Rebuild" sub="Coming back from a layoff — handle gently" />
      <div className="tile" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-t1)' }}>
          Volume drop is big enough that the engine's flagging this as a rebuild block. Easy mileage at 30-50% of pre-layoff peak, no quality work, until volume returns to ~80% of baseline.
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--color-t2)', lineHeight: 1.55 }}>
          <li>Don't try to make up missed miles in one week — Daniels: ramp ≤10% per week.</li>
          <li>VDOT estimate has dropped 3-8 points (depends on layoff length); field-test only after 2-3 weeks of consistent base.</li>
          <li>First quality work returns when easy share consistently hits ≥85%.</li>
        </ul>
      </div>
    </>
  );
}

function PhaseGuidanceBlock({ label, primary, detail }: { label: string; primary: string; detail: string }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 8,
      background: 'var(--color-l2)', border: '1px solid var(--color-l4)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-corporate)' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--color-t0)', lineHeight: 1.4 }}>
        {primary}
      </div>
      {detail && (
        <div style={{ fontSize: 11, color: 'var(--color-t2)', lineHeight: 1.45 }}>
          {detail}
        </div>
      )}
    </div>
  );
}

/* ── HR zones tile ───────────────────────────────────────────
   Surfaces the runner's 5 HR zones derived from their HRmax (or
   estimated from age via Tanaka when HRmax is unset). Doctrine:
   HRMAX_ZONES_5 (Research/03). Hides itself entirely when neither
   HRmax nor age is known — no zones to compute, no point showing
   a placeholder. */
function HrZonesCard() {
  const [hrmax, setHrmax] = useState<{ bpm: number; source: 'measured' | 'tanaka_estimate' } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const profile = await loadRunnerProfile();
      if (cancelled) return;
      setHrmax(resolveHrmax(profile));
    })();
    return () => { cancelled = true; };
  }, []);

  if (!hrmax) return null;
  return <HrZonesTile hrmax={hrmax} />;
}

function HrZonesTile({ hrmax }: { hrmax: { bpm: number; source: 'measured' | 'tanaka_estimate' } }) {
  const zones: Array<{
    key: keyof typeof HRMAX_ZONES_5.value;
    name: string;
    detail: string;
    color: string;
    zNum: number;
  }> = [
    { key: 'recovery',      name: 'Recovery',   detail: '50–60% HRmax', color: 'var(--color-t2)',        zNum: 1 },
    { key: 'easy',          name: 'Easy',        detail: '60–70% HRmax', color: 'var(--color-success)',   zNum: 2 },
    { key: 'aerobic_tempo', name: 'Aerobic',     detail: '70–80% HRmax', color: 'var(--color-corporate)', zNum: 3 },
    { key: 'threshold',     name: 'Threshold',   detail: '80–90% HRmax', color: 'var(--color-attention)', zNum: 4 },
    { key: 'vo2max',        name: 'VO₂max',      detail: '90–100% HRmax',color: 'var(--color-warning)',   zNum: 5 },
  ];

  return (
    <>
      <SectionHeader title="HR zones" sub={`HRmax ${hrmax.bpm} BPM · ${hrmax.source === 'tanaka_estimate' ? 'Tanaka estimate' : 'measured'}`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
        {zones.map(z => {
          const def = HRMAX_ZONES_5.value[z.key];
          const lo = Math.round((def.pctLow / 100) * hrmax.bpm);
          const hi = Math.round((def.pctHigh / 100) * hrmax.bpm);
          return (
            <div key={z.key} className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 160 }}>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: z.color }}>
                Z{z.zNum} · {z.name}
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-data)', fontWeight: 800, fontSize: 26, color: z.color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', lineHeight: 1 }}>
                  {lo}–{hi}
                </div>
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, color: 'var(--color-t3)', letterSpacing: '0.8px', marginTop: 2 }}>BPM</div>
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ height: 3, borderRadius: 2, background: z.color, opacity: 0.4 }} />
                <div style={{ fontSize: 10.5, color: 'var(--color-t3)', lineHeight: 1.4 }}>{z.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function VdotCard() {
  const ctx = useCoachToday();
  if (!ctx || !ctx.ok) return null;
  const vdot = ctx.vdot ?? null;
  const testPrompt = ctx.vdotTestPrompt ?? false;
  if (vdot == null && testPrompt) return <NoVdotPanel />;
  if (vdot == null) return null;
  return <VdotTile vdot={vdot} />;
}

/** When there's no recent race to anchor a VDOT, surface the
 *  field-test options so the runner has an actionable next step
 *  instead of just hiding the tile. Mirrors the protocols documented
 *  in Research/01 + VDOT_FIELD_TESTS doctrine. */
function NoVdotPanel() {
  return (
    <div>
      <SectionHeader title="VDOT fitness" sub="DANIELS · NEEDS A FRESH RACE TO ANCHOR" />
      <div className="tile" style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="tile-sub">No current VDOT</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: 'var(--color-t0)', lineHeight: 1.3 }}>
            Run a hard effort to anchor your training paces.
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-t2)', lineHeight: 1.55 }}>
            VDOT maps a race result onto your full E/M/T/I/R pace prescription. Without one, paces fall back to a goal-anchored estimate that&apos;s less precise. Pick the test that fits — Daniels recommends one every 4–6 weeks during a build.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 4 }}>
          {/* Field-test options sourced from VDOT_FIELD_TESTS doctrine
              (Research/01) — when doctrine evolves, this surface
              follows. Plus a "Race anything" catch-all that doesn't
              live in the doctrine since it's a UX prompt, not a test
              protocol. */}
          {[
            ...VDOT_FIELD_TESTS.value.map(t => ({
              label: t.label,
              dur: t.durationMin > 0 ? `~${t.durationMin} min` : '2 days',
              note: `${t.description} ${t.accuracyNote}${t.vdotCorrection ? ` · ${t.vdotCorrection}.` : ''}`,
            })),
            { label: 'Race anything', dur: 'Whenever', note: 'Mile / 5K / 10K / 15K / Half / Marathon — any all-out, well-paced race anchors VDOT directly.' },
          ].map(t => (
            <div key={t.label} style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'var(--color-l2)',
              border: '1px solid var(--color-l4)',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--color-t0)' }}>{t.label}</span>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>{t.dur}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.45 }}>{t.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VdotTile({ vdot }: { vdot: VdotTilePayload }) {
  const ageLabel = vdot.source.daysAgo === 0
    ? 'today'
    : vdot.source.daysAgo === 1
    ? 'yesterday'
    : `${vdot.source.daysAgo} days ago`;

  // Age + sex grading (Research/24). Profile lives server-side
  // (Postgres) — fetched async on mount. Until it resolves we
  // render raw VDOT; the age-graded line appears once profile
  // lands. SSR-safe via DEFAULT_PROFILE.
  const [profile, setProfile] = useState<{ birthDate: string | null; sex: RunnerSex; hrmaxBpm: number | null; rhrBpm: number | null }>({ birthDate: null, sex: 'unspecified', hrmaxBpm: null, rhrBpm: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await loadRunnerProfile();
      if (!cancelled) setProfile(p);
    })();
    return () => { cancelled = true; };
  }, []);
  const runnerAge = ageFromBirthDate(profile.birthDate);
  const grading = gradeVdot(vdot.vdot, runnerAge, profile.sex);
  const showAgeGraded = grading.ageGraded != null && runnerAge != null && runnerAge > 30 && Math.abs(grading.ageGraded - vdot.vdot) >= 1;

  // Color-code tier so the badge has visual weight.
  const tierColor: Record<VdotTilePayload['tier'], string> = {
    novice:       'var(--color-t2)',
    intermediate: 'var(--color-corporate)',
    advanced:     'var(--color-attention)',
    elite:        'var(--color-warning)',
  };
  // Color-code freshness so stale chips read as warnings.
  const freshChipColors: Record<VdotTilePayload['freshness'], { bg: string; fg: string; label: string }> = {
    fresh:      { bg: 'rgba(16,185,129,.18)', fg: 'var(--color-success)',   label: 'FRESH' },
    stale_soon: { bg: 'rgba(38,127,255,.18)', fg: 'var(--color-corporate)', label: 'STALE SOON' },
    stale:      { bg: 'rgba(243,173,59,.18)', fg: 'var(--color-attention)', label: 'STALE' },
    expired:    { bg: 'rgba(252,77,84,.18)',  fg: 'var(--color-warning)',   label: 'EXPIRED' },
  };
  const freshChip = freshChipColors[vdot.freshness];

  return (
    <>
      <SectionHeader title="VDOT fitness" sub="DANIELS · ANCHORED ON YOUR LAST RACE" />

      <div className="dash-vdot-row">
        {/* Card 1: VDOT summary — big number + source race */}
        <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 180 }}>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: tierColor[vdot.tier] }}>
            {showAgeGraded ? 'Age-graded VDOT' : 'VDOT'} · {vdot.tierLabel}
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56,
            letterSpacing: '-.03em', lineHeight: 1, color: 'var(--color-corporate)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {showAgeGraded && grading.ageGraded != null ? grading.ageGraded.toFixed(1) : vdot.vdot.toFixed(1)}
          </div>
          {showAgeGraded && (
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t3)', letterSpacing: '0.6px' }}>
              Raw · {vdot.vdot.toFixed(1)}
            </div>
          )}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--color-t0)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {vdot.source.name}
            </div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t3)', fontWeight: 700, letterSpacing: '0.5px' }}>
              {vdot.source.distanceMi.toFixed(2)} MI · {fmtHMS(vdot.source.timeS)} · {ageLabel}
            </div>
            <span style={{
              alignSelf: 'flex-start',
              fontFamily: 'var(--font-data)', fontSize: 8, fontWeight: 700, letterSpacing: '1.2px',
              padding: '2px 6px', borderRadius: 3,
              background: freshChip.bg, color: freshChip.fg,
            }}>{freshChip.label}</span>
          </div>
        </div>

        {/* Cards 2–6: E/M/T/I/R pace zones — pace is the hero */}
        {ZONE_DEFS.map(z => {
          const band = vdot.paces[z.key];
          return (
            <div key={z.key} className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 180 }}>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: z.color }}>
                {z.key} · {z.label}
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-data)', fontWeight: 800, fontSize: 22, color: z.color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', lineHeight: 1 }}>
                  {fmtPaceBand(band)}
                </div>
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, color: 'var(--color-t3)', letterSpacing: '0.8px', marginTop: 2 }}>/MI</div>
              </div>
              <div style={{ marginTop: 'auto', fontSize: 10.5, color: 'var(--color-t3)', lineHeight: 1.4 }}>{z.sub}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Training pulse ─────────────────────────────────────────
   "Living" training summary that adapts to the runner's actual
   state: phase chip (BUILDING / TAPER / etc), 8-week mileage
   trend, week-over-week delta, long-run progression, quality-
   day count this week. Lives between Today and Fun Stats so
   the dashboard always tells you "where you're at" before
   diving into vanity numbers. */
function TrainingPulseTile({ pulse, runs }: { pulse: TrainingPulse; runs: import('../lib/strava-activities').NormalizedActivity[] }) {
  // Pull VDOT + phase-aware easy-share target from the shared
  // CoachToday context so the effort classifier uses pace-zone
  // signals (research-anchored) and the "On target" verdict matches
  // the runner's actual phase. Engine phase wins when available;
  // local heuristic is the backup before context resolves.
  const ctx = useCoachToday();
  const vdot = ctx?.vdot?.vdot ?? null;
  const enginePhaseRaw = ctx?.today?.phase ?? null;
  const phaseTargets: Record<string, { min: number; label: string; display: string }> = {
    TAPER:            { min: 0.78, label: 'taper',            display: 'TAPER' },
    PEAK:             { min: 0.75, label: 'peak',             display: 'PEAK' },
    BUILD:            { min: 0.70, label: 'build',            display: 'BUILDING' },
    BASE:             { min: 0.80, label: 'base',             display: 'BASE BLOCK' },
    BASE_MAINTENANCE: { min: 0.78, label: 'base maintenance', display: 'BASE BLOCK' },
    POST_RACE:        { min: 0.90, label: 'post-race',        display: 'POST-RACE' },
    REBUILD:          { min: 0.85, label: 'rebuild',          display: 'REBUILD' },
  };
  const phaseTarget = enginePhaseRaw ? phaseTargets[enginePhaseRaw] : null;
  const easyShareMin = phaseTarget?.min ?? 0.80;
  const phaseLabel = phaseTarget?.label ?? 'base maintenance';
  const displayPhase = (phaseTarget?.display ?? pulse.phase) as TrainingPulse['phase'];
  const weeks = weeklyMiles(runs, 8);
  const max = Math.max(...weeks.map(w => w.miles), 1);
  // Cutback detection — Daniels' 3+1 / 4+1 cycle (Research/00b
  // CUTBACK_FREQUENCY). A "cutback week" is one where miles dropped
  // ≥30% from the prior 3-week running max (so we're not flagging
  // single low weeks during a build, only intentional drops). This
  // surfaces "X weeks since last cutback" + "cutback recommended
  // next week" timing under the bar chart.
  const cutbackInfo = (() => {
    if (weeks.length < 4) return null;
    let lastCutbackIdx: number | null = null;
    for (let i = 1; i < weeks.length; i++) {
      const prior = weeks.slice(Math.max(0, i - 3), i);
      const priorMax = Math.max(...prior.map(w => w.miles), 0);
      if (priorMax > 0 && weeks[i].miles < priorMax * 0.7 && weeks[i].miles > 0) {
        lastCutbackIdx = i;
      }
    }
    // Don't count the in-progress current week as a cutback yet.
    const currentIdx = weeks.length - 1;
    const referenceIdx = lastCutbackIdx === currentIdx ? null : lastCutbackIdx;
    if (referenceIdx == null) {
      return { weeksSince: null, recommendNext: weeks.length >= 4, isCutbackThisWeek: false };
    }
    const weeksSince = currentIdx - referenceIdx;
    return {
      weeksSince,
      recommendNext: weeksSince >= 3,
      isCutbackThisWeek: lastCutbackIdx === currentIdx,
    };
  })();
  const phaseColor: Record<TrainingPulse['phase'], string> = {
    'TAPER':       'var(--color-attention)',
    'PEAK':        'var(--color-attention)',
    'RACE MONTH':  'var(--color-attention)',
    'POST-RACE':   'var(--color-corporate)',
    'BUILDING':    'var(--color-success)',
    'BASE BLOCK':  'var(--color-corporate)',
  };
  const phaseDescriptor = (() => {
    // Engine phase wins — falls back to local heuristic before the
    // first /api/coach/today resolves.
    const p = displayPhase;
    if (p === 'TAPER')      return pulse.daysToRace === 0 ? 'Race day' : pulse.daysToRace === 1 ? 'Race tomorrow' : `${pulse.daysToRace} days to ${pulse.raceName ?? 'race day'} — taper week`;
    if (p === 'PEAK')       return pulse.daysToRace != null ? `${pulse.daysToRace} days to ${pulse.raceName ?? 'race day'} — peak block` : 'Peak block — race-specific work';
    if (p === 'RACE MONTH') return pulse.daysToRace != null ? `${pulse.daysToRace} days to ${pulse.raceName ?? 'race day'} — building` : 'Race-month build';
    if (p === 'POST-RACE')  return 'Recovery week — volume drop is by design, not detraining';
    if (p === 'BUILDING')   return 'Mileage trending up over the last 4 weeks';
    if (p === 'REBUILD' as TrainingPulse['phase']) return 'Rebuilding from a layoff — handle gently';
    return 'Maintain the base — steady volume, weekly long run, no peaking';
  })();
  const deltaText = pulse.deltaPct == null
    ? null
    : (pulse.deltaPct > 0 ? '+' : '') + Math.round(pulse.deltaPct * 100) + '%';
  const deltaColor = pulse.deltaPct == null ? 'var(--color-t3)'
    : pulse.deltaPct > 0.10 ? 'var(--color-success)'
    : pulse.deltaPct < -0.15 ? 'var(--color-warning)'
    : 'var(--color-t2)';
  // Pass VDOT into the classifier so name patterns + pace zones drive
  // the effort split (research-anchored). Without VDOT it falls back
  // to name + HR + long-run defaults.
  const balance = effortBalance(runs, 14, 152, vdot);
  const easyPct = Math.round(balance.easyShare * 100);
  const easyShareMinPct = Math.round(easyShareMin * 100);
  // Phase-aware verdict: the runner's actual phase target replaces
  // the static 75% threshold. For BASE/POST_RACE the target is
  // higher (≥80% / ≥90%); for BUILD/PEAK it can drop to 70-75%.
  const easyColor = easyPct >= easyShareMinPct
    ? 'var(--color-success)'
    : easyPct >= easyShareMinPct - 15
    ? 'var(--color-attention)'
    : 'var(--color-warning)';
  const easyVerdict = easyPct >= easyShareMinPct
    ? `On target (≥${easyShareMinPct}% for ${phaseLabel})`
    : easyPct >= easyShareMinPct - 15
    ? `Below ${phaseLabel} target (≥${easyShareMinPct}%) — back off intensity`
    : `Way too hard for ${phaseLabel} (target ≥${easyShareMinPct}%) — drop intensity`;

  // Format week-start ISO → "Mar 9" for bar labels
  const fmtBar = (iso: string) => {
    const d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
  };

  return (
    <>
      <SectionHeader title="Training pulse" sub={`Where you are vs where you should be · ${phaseDescriptor.toLowerCase()}`} />
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
        {/* Phase + 8-week mileage trend with per-bar labels */}
        <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 220 }}>
          <div className="tile-h">
            <div>
              <div className="tile-sub">Phase</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, letterSpacing: '-.01em', color: phaseColor[displayPhase] ?? phaseColor[pulse.phase], marginTop: 4, lineHeight: 1, textTransform: 'uppercase' }}>
                {displayPhase}
              </div>
            </div>
            <span className="chip" style={{ fontSize: 9 }}>WEEKLY MI · LAST 8 WK</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, flex: 1 }}>
            {weeks.map((w, i) => {
              const isCurrentWeek = i === weeks.length - 1;
              // Detect cutback weeks for visual coding — same heuristic
              // the cutbackInfo computation uses (≥30% drop from prior
              // 3-week max). Highlights so the runner sees the cycle.
              const isCutback = (() => {
                if (i === 0) return false;
                const prior = weeks.slice(Math.max(0, i - 3), i);
                const priorMax = Math.max(...prior.map(pw => pw.miles), 0);
                return priorMax > 0 && w.miles > 0 && w.miles < priorMax * 0.7;
              })();
              const h = w.miles > 0 ? Math.max(6, (w.miles / max) * 80) : 0;
              return (
                <div key={w.weekStart} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontVariantNumeric: 'tabular-nums', color: w.miles > 0 ? 'var(--color-t1)' : 'var(--color-t3)', fontWeight: 700 }}>
                    {w.miles > 0 ? Math.round(w.miles) : '—'}
                  </div>
                  <div style={{
                    width: '100%',
                    height: h ? `${h}px` : '4px',
                    background: h
                      ? (isCurrentWeek ? 'var(--color-attention)'
                        : isCutback ? 'var(--color-t3)'
                        : 'var(--color-corporate)')
                      : 'var(--color-l3)',
                    borderRadius: 2,
                  }} title={`Week of ${w.weekStart} · ${w.miles.toFixed(1)} mi · ${w.runs} runs${isCutback ? ' · cutback week' : ''}${isCurrentWeek ? ' · this week (in progress)' : ''}`} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1px', color: 'var(--color-t3)' }}>
            {weeks.map((w, i) => (
              <div key={w.weekStart} style={{ flex: 1, textAlign: 'center', opacity: i === 0 || i === weeks.length - 1 || i === Math.floor(weeks.length / 2) ? 1 : 0.45 }}>
                {fmtBar(w.weekStart)}
              </div>
            ))}
          </div>
          {/* Quality day count this week vs phase target. Sourced from
              the same HARD_NAME_RE the effort classifier uses (after
              the parallel Strava workoutType check). */}
          {(() => {
            const qualityTarget: Record<string, number> = {
              'TAPER': 1, 'PEAK': 2, 'BUILDING': 2, 'BASE BLOCK': 1, 'POST-RACE': 0, 'REBUILD': 0, 'RACE MONTH': 2,
            };
            const tgt = qualityTarget[displayPhase] ?? 1;
            const c = pulse.qualityDaysThisWeek > tgt ? 'var(--color-warning)'
              : pulse.qualityDaysThisWeek === tgt ? 'var(--color-success)'
              : pulse.qualityDaysThisWeek === 0 && tgt > 0 ? 'var(--color-attention)'
              : 'var(--color-t2)';
            return (
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.1px', color: c, paddingTop: 4, borderTop: '1px solid var(--color-l4)' }}>
                {pulse.qualityDaysThisWeek} / {tgt} QUALITY THIS WEEK
              </div>
            );
          })()}
          {/* Cutback timing per Daniels 3+1 cycle (Research/00b
              CUTBACK_FREQUENCY). Hidden during taper / post-race /
              rebuild — those phases drive volume separately. */}
          {cutbackInfo && displayPhase !== 'TAPER' && displayPhase !== 'POST-RACE' && (displayPhase as string) !== 'REBUILD' && (() => {
            const text = cutbackInfo.isCutbackThisWeek
              ? 'CUTBACK WEEK · DOWN-VOLUME ON PURPOSE'
              : cutbackInfo.recommendNext
              ? `CUTBACK RECOMMENDED NEXT WEEK${cutbackInfo.weeksSince != null ? ` · ${cutbackInfo.weeksSince}W SINCE LAST` : ''}`
              : cutbackInfo.weeksSince != null
              ? `WEEK ${cutbackInfo.weeksSince + 1} OF BUILD CYCLE · CUTBACK IN ${3 - cutbackInfo.weeksSince}W`
              : null;
            const color = cutbackInfo.isCutbackThisWeek ? 'var(--color-corporate)'
              : cutbackInfo.recommendNext ? 'var(--color-attention)'
              : 'var(--color-t3)';
            if (!text) return null;
            return (
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, fontWeight: 700, letterSpacing: '1.1px', color, lineHeight: 1.4 }}>
                {text}
              </div>
            );
          })()}
        </div>

        {/* Weekly avg + delta vs prior 4w */}
        <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 220 }}>
          <div className="tile-sub">Weekly avg</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 44, color: 'var(--color-t0)', letterSpacing: '-.025em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {pulse.weeklyAvg.toFixed(1)}<small style={{ fontSize: '.32em', opacity: .55, marginLeft: 4 }}>mi</small>
          </div>
          <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>Last 4 weeks · {pulse.recent4wkMi.toFixed(0)} mi total</div>
          {deltaText && (
            <div style={{ marginTop: 'auto', fontFamily: 'var(--font-data)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: deltaColor, lineHeight: 1.4 }}>
              {deltaText} VS PRIOR 4 WK<br />
              <span style={{ color: 'var(--color-t3)', fontWeight: 700 }}>WAS {pulse.prior4wkMi.toFixed(0)} MI</span>
            </div>
          )}
        </div>

        {/* Long run trend + Daniels' 10% cap. The cap is the largest
            safe long run for the next week — capped at +10% of the
            longest recent (Daniels: no >10% week-over-week long-run
            spike) AND a phase ceiling (TAPER < ongoing build).
            Doctrine source: Research/01 §"Triggers to retest" + the
            general Daniels long-run progression rule. */}
        <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 220 }}>
          <div className="tile-sub">Long run avg</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 44, color: 'var(--color-t0)', letterSpacing: '-.025em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {pulse.longRunAvgMi != null ? pulse.longRunAvgMi.toFixed(1) : '—'}<small style={{ fontSize: '.32em', opacity: .55, marginLeft: 4 }}>mi</small>
          </div>
          <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>Longest run, each of last 4 weeks</div>
          {pulse.longestRecentMi > 0 && (
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t2)', lineHeight: 1.4 }}>
              PEAK LONG RUN<br />
              <span style={{ color: 'var(--color-t1)' }}>{pulse.longestRecentMi.toFixed(1)} MI · LAST 28 DAYS</span>
            </div>
          )}
          {/* Next-week long-run cap. Routes through the canonical
              long-run cap function (lib/long-run-cap.ts) — the SAME
              source the engine's longRunTarget() uses, so dashboard
              and prescription cannot disagree. Hard ceiling is
              doctrine §13.1 (Daniels' single-session-spike rule). */}
          {pulse.longestRecentMi > 0 && (() => {
            const peakLast = pulse.longestRecentMi;
            const hardCap = peakLast * LONG_RUN_HARD_CAP_MULTIPLIER;
            const enginePhase = TRAINING_PULSE_TO_ENGINE_PHASE[displayPhase] ?? 'BASE_MAINTENANCE';
            const cap = Math.min(hardCap, longRunTargetMi(enginePhase, peakLast));
            return (
              <div style={{ marginTop: 'auto', fontFamily: 'var(--font-data)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-corporate)', lineHeight: 1.4, paddingTop: 6, borderTop: '1px solid var(--color-l4)' }}>
                NEXT-WEEK CAP<br />
                <span style={{ color: 'var(--color-t1)' }}>≤ {cap.toFixed(1)} MI <span style={{ color: 'var(--color-t3)', fontSize: 9 }}>· {displayPhase} TARGET</span></span>
              </div>
            );
          })()}
        </div>

        {/* Easy / hard balance — 80/20 polarized training, classified
            from name patterns + VDOT pace zones + HR fallback. The
            "unknown" bucket is explicit — better than hiding the
            uncertainty in either side of the ratio. */}
        <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 220 }}>
          <div className="tile-h" style={{ alignItems: 'flex-start' }}>
            <div className="tile-sub">Easy ratio</div>
            {!balance.highConfidence && balance.totalMi > 0 && (
              <span title="Low classification confidence — not enough name/pace/HR signal" style={{
                fontFamily: 'var(--font-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1px',
                padding: '2px 6px', borderRadius: 3,
                background: 'rgba(243,173,59,.15)', color: 'var(--color-attention)',
              }}>LOW CONF</span>
            )}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 44, color: easyColor, letterSpacing: '-.025em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {balance.totalMi > 0 && (balance.easyMi + balance.hardMi) > 0 ? `${easyPct}` : '—'}<small style={{ fontSize: '.32em', opacity: .55, marginLeft: 2 }}>%</small>
          </div>
          <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>
            Last 14 days · target ≥{easyShareMinPct}% ({phaseLabel})
          </div>
          {/* Stacked bar showing easy / hard / unknown split */}
          {balance.totalMi > 0 && (
            <>
              {(() => {
                const easyW = (balance.easyMi / balance.totalMi) * 100;
                const hardW = (balance.hardMi / balance.totalMi) * 100;
                const unkW  = (balance.unknownMi / balance.totalMi) * 100;
                return (
                  <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--color-l3)' }}>
                    <div style={{ width: `${easyW}%`, background: 'var(--color-success)' }} title={`Easy ${balance.easyMi.toFixed(1)} mi`} />
                    <div style={{ width: `${hardW}%`, background: 'var(--color-attention)' }} title={`Hard ${balance.hardMi.toFixed(1)} mi`} />
                    <div style={{ width: `${unkW}%`,  background: 'var(--color-l4)' }} title={`Unclassified ${balance.unknownMi.toFixed(1)} mi`} />
                  </div>
                );
              })()}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--color-t3)' }}>
                <span style={{ color: 'var(--color-success)' }}>{balance.easyMi.toFixed(1)} EASY</span>
                <span style={{ color: 'var(--color-attention)' }}>{balance.hardMi.toFixed(1)} HARD</span>
                {balance.unknownMi > 0 && (
                  <span style={{ color: 'var(--color-t3)' }}>{balance.unknownMi.toFixed(1)} ?</span>
                )}
              </div>
              <div style={{ marginTop: 'auto', fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.1px', color: easyColor, lineHeight: 1.4 }}>
                {balance.easyMi + balance.hardMi > 0 ? easyVerdict : `${balance.unknownMi.toFixed(1)} mi unclassified — name your runs or wire HR data`}
              </div>
            </>
          )}
          {balance.totalMi === 0 && (
            <div style={{ marginTop: 'auto', fontSize: 12, color: 'var(--color-t3)' }}>No runs in window</div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Year of running heatmap ────────────────────────────────
   GitHub-style contribution grid: one cell per day from Jan 1 to
   today, colored by mile intensity. Visually communicates "what
   this year of training looks like" at a glance. Hovering a cell
   shows the date + miles. */
function YearHeatmapSection({ runs }: { runs: NormalizedActivity[] }) {
  const days = yearOfRunningHeatmap(runs);
  if (days.length === 0) return null;

  // Bucket each day into a 5-step intensity scale based on miles.
  function intensity(mi: number): number {
    if (mi <= 0) return 0;
    if (mi < 3) return 1;
    if (mi < 6) return 2;
    if (mi < 10) return 3;
    if (mi < 16) return 4;
    return 5;
  }
  const intensityColors = [
    'var(--color-l3)',                       // 0 = no run
    'rgba(0, 143, 236, .25)',                // 1 = short
    'rgba(0, 143, 236, .50)',                // 2
    'rgba(0, 143, 236, .80)',                // 3
    'var(--color-corporate)',                // 4
    'var(--color-attention)',                // 5 = long run / race
  ];

  // Group days into columns by ISO week (Mon = column start). Since
  // year may not start on Monday, pad the first column with empty
  // cells. JS Date.getDay(): 0=Sun, 1=Mon, ..., 6=Sat.
  const firstDay = new Date(days[0].date + 'T12:00:00Z');
  const firstDow = firstDay.getUTCDay();
  // Convert to Mon=0...Sun=6
  const firstOffset = (firstDow + 6) % 7;
  const cells: Array<{ date: string; miles: number; runs: number; level: number } | null> = [];
  for (let i = 0; i < firstOffset; i++) cells.push(null);
  for (const d of days) cells.push({ ...d, level: intensity(d.miles) });
  // Pad to a full final column.
  while (cells.length % 7 !== 0) cells.push(null);
  const cols = cells.length / 7;

  // Month labels above the grid — only show one per month, on the
  // column where that month starts.
  const monthLabels: Array<{ col: number; label: string }> = [];
  let lastMonth = -1;
  for (let c = 0; c < cols; c++) {
    const cell = cells[c * 7];  // top of column = Monday
    const ref = cell ?? cells[c * 7 + 1] ?? cells[c * 7 + 6];
    if (!ref) continue;
    const m = new Date(ref.date + 'T12:00:00Z').getUTCMonth();
    if (m !== lastMonth) {
      monthLabels.push({ col: c, label: new Date(ref.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase() });
      lastMonth = m;
    }
  }

  const totalMi = days.reduce((s, d) => s + d.miles, 0);
  const daysRun = days.filter(d => d.miles > 0).length;
  const dowLabels = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

  return (
    <>
      <SectionHeader title="Year on foot" sub={`${daysRun} run days · ${totalMi.toFixed(1)} mi · every day of ${new Date().getFullYear()}`} />
      <div className="tile" style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Day-of-week labels on the left */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 18, fontFamily: 'var(--font-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>
            {dowLabels.map((d, i) => (
              <div key={d} style={{ height: 12, display: 'flex', alignItems: 'center', visibility: i % 2 === 0 ? 'visible' : 'hidden' }}>{d}</div>
            ))}
          </div>
          {/* The grid */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowX: 'auto' }}>
            {/* Month labels */}
            <div style={{ position: 'relative', height: 14, fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>
              {monthLabels.map(m => (
                <span key={m.col} style={{ position: 'absolute', left: `calc(${m.col} * (100% / ${cols}))` }}>{m.label}</span>
              ))}
            </div>
            {/* The actual heatmap */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(8px, 1fr))`, gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gap: 3 }}>
              {cells.map((c, i) => (
                <div key={i}
                  title={c ? `${c.date} · ${c.miles.toFixed(1)} mi · ${c.runs} run${c.runs === 1 ? '' : 's'}` : ''}
                  style={{
                    aspectRatio: '1 / 1',
                    minHeight: 10,
                    background: c ? intensityColors[c.level] : 'transparent',
                    borderRadius: 2,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>
          <span>LESS</span>
          {[0, 1, 2, 3, 4, 5].map(lvl => (
            <div key={lvl} style={{ width: 12, height: 12, borderRadius: 2, background: intensityColors[lvl] }} />
          ))}
          <span>MORE</span>
        </div>
      </div>
    </>
  );
}

/* ── Fun stats ─────────────────────────────────────────────
   Headline numbers compared to relatable things — landmarks,
   road trips, screen-time references. Each card gets its own
   palette accent so the section reads as a colorful row, not
   a uniform grid of dark tiles. */
function FunStatsSection({ runs }: { runs: NormalizedActivity[] | null }) {
  if (!runs || runs.length === 0) return null;
  const r = rollupYear(runs);
  const stats = funStats(r);
  if (stats.length === 0) return null;
  // Cycle through six palette accents so adjacent cards never share
  // a color. Keeps the section visually energetic without becoming
  // confetti.
  const accents = [
    { color: 'var(--color-attention)', tint: 'rgba(243,173,59,.10)', border: 'rgba(243,173,59,.25)' },
    { color: 'var(--color-corporate)', tint: 'rgba(0,143,236,.08)',  border: 'rgba(0,143,236,.22)'  },
    { color: 'var(--color-success)',   tint: 'rgba(62,189,65,.08)',  border: 'rgba(62,189,65,.22)'  },
    { color: '#9013FE',                tint: 'rgba(144,19,254,.08)', border: 'rgba(144,19,254,.22)' },
    { color: '#27E087',                tint: 'rgba(39,224,135,.08)', border: 'rgba(39,224,135,.22)' },
    { color: '#E88221',                tint: 'rgba(232,130,33,.08)', border: 'rgba(232,130,33,.22)' },
  ];
  return (
    <>
      <SectionHeader title="Fun stats" sub={`${r.totalRuns} runs · ${r.totalMiles.toFixed(1)} mi this year`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, marginBottom: 10 }}>
        {stats.map((s, i) => {
          const a = accents[i % accents.length];
          return (
            <div key={i} style={{
              padding: '20px 22px', borderRadius: 12,
              background: `linear-gradient(135deg, ${a.tint}, var(--color-l1))`,
              border: `1px solid ${a.border}`,
              display: 'flex', flexDirection: 'column', gap: 10, minHeight: 160,
            }}>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: a.color }}>
                {s.label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, letterSpacing: '-.02em', lineHeight: 1, color: 'var(--color-t0)' }}>
                {s.value}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.55, flex: 1 }}>{s.detail}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="section-h">
      <div>
        <div className="tile-sub" style={{ marginBottom: 4 }}>{sub}</div>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

/* ── Recovery Widget ─────────────────────────────────────────
   Shows today's Pause credit balance + any scheduled recovery
   sessions for the next 7 days. Lets you mark sessions done
   and add one from the coach suggestion. */

interface RecoverySession {
  id: number;
  date: string;
  service: string;
  credits: number;
  done: boolean;
  note: string | null;
}
interface RecoveryCredits {
  total: number;
  used: number;
  spent: number;
  remaining: number;
  resetDate: string;
}
interface ServiceDef { name: string; credits: number; category: string; description?: string }

// Groups for the service picker modal
const SERVICE_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Recovery',    keys: ['cryo', 'contrast_30', 'contrast_60', 'float', 'massage_60', 'iv_recover', 'iv_hydrate'] },
  { label: 'Performance', keys: ['sauna_30', 'sauna_60', 'iv_invigorate', 'iv_turbo'] },
  { label: 'Maintenance', keys: ['led', 'iv_balance', 'iv_defense', 'iv_radiate', 'iv_pause'] },
];

function RecoveryWidget() {
  const [sessions, setSessions] = useState<RecoverySession[]>([]);
  const [credits, setCredits]   = useState<RecoveryCredits | null>(null);
  const [services, setServices] = useState<Record<string, ServiceDef>>({});
  const [picking, setPicking]   = useState(false);
  const [addDate, setAddDate]   = useState(todayISO());
  const [addService, setAddService] = useState('');
  const [addNote, setAddNote]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [pickTab, setPickTab]   = useState(0);

  const today = todayISO();
  const weekEnd = (() => {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  })();

  const load = async () => {
    try {
      const res = await fetch(`/api/recovery?from=${today}&to=${weekEnd}&today=${today}`, { cache: 'no-store' });
      const json = await res.json() as { sessions: RecoverySession[]; credits: RecoveryCredits | null; services: Record<string, ServiceDef> };
      setSessions(json.sessions ?? []);
      setCredits(json.credits ?? null);
      setServices(json.services ?? {});
    } catch { /* silent */ }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDone = async (id: number, done: boolean) => {
    await fetch(`/api/recovery/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }) });
    void load();
  };

  const deleteSession = async (id: number) => {
    await fetch(`/api/recovery/${id}`, { method: 'DELETE' });
    void load();
  };

  const scheduleSession = async () => {
    if (!addDate || !addService) return;
    setSaving(true);
    await fetch('/api/recovery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: addDate, service: addService, note: addNote || undefined, source: 'manual' }),
    });
    setSaving(false);
    setPicking(false);
    setAddService('');
    setAddNote('');
    setAddDate(todayISO());
    void load();
  };

  if (!credits && sessions.length === 0 && Object.keys(services).length === 0) return null;

  const creditPct   = credits ? Math.max(0, Math.min(100, (credits.remaining / credits.total) * 100)) : 0;
  const creditColor = creditPct > 50 ? 'var(--color-recovery)' : creditPct > 20 ? 'var(--color-warn)' : 'var(--color-race)';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, marginTop: 4, padding: '0 2px' }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.8px', textTransform: 'uppercase', color: 'var(--color-mute)' }}>
          Pause Studio City
        </div>
        {credits && (
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--color-mute)' }}>
            {credits.remaining} / {credits.total} CR · resets {credits.resetDate}
          </div>
        )}
      </div>

      <div className="tile" style={{ padding: '18px 22px', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {credits && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32, letterSpacing: '-.02em', color: creditColor, lineHeight: 1 }}>
                {credits.remaining} <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, fontWeight: 700, letterSpacing: '1px', color: 'var(--color-mute)' }}>CREDITS LEFT</span>
              </div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-mute)', letterSpacing: '.5px' }}>
                {credits.used} scheduled · {credits.spent} done
              </div>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--color-surface)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${creditPct}%`, background: creditColor, borderRadius: 2, transition: 'width .3s' }} />
            </div>
          </div>
        )}

        {sessions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sessions.map(s => {
              const svc   = services[s.service];
              const isPast = s.date < today;
              return (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  background: s.done ? 'rgba(78,205,149,.06)' : isPast && !s.done ? 'rgba(252,77,84,.06)' : 'var(--color-surface)',
                  border: `1px solid ${s.done ? 'rgba(78,205,149,.25)' : isPast && !s.done ? 'rgba(252,77,84,.25)' : 'transparent'}`,
                  opacity: s.done ? 0.7 : 1,
                }}>
                  <button type="button" onClick={() => void toggleDone(s.id, !s.done)} style={{
                    width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${s.done ? 'var(--color-recovery)' : 'var(--color-mute)'}`,
                    background: s.done ? 'var(--color-recovery)' : 'transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 11, fontWeight: 800,
                  }}>{s.done ? '✓' : ''}</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--color-ink)', textDecoration: s.done ? 'line-through' : 'none' }}>
                        {svc?.name ?? s.service}
                      </span>
                      <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--color-mute)' }}>{s.credits} CR</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-mute)', letterSpacing: '.3px' }}>
                      {s.date === today ? 'TODAY' : s.date}{s.note ? ` · ${s.note}` : ''}
                    </div>
                  </div>
                  <button type="button" onClick={() => void deleteSession(s.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-mute)', fontSize: 16, padding: '0 4px', flexShrink: 0 }}
                    title="Remove">×</button>
                </div>
              );
            })}
          </div>
        )}

        {sessions.length === 0 && (
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--color-mute)', letterSpacing: '.5px' }}>
            No sessions scheduled this week
          </div>
        )}

        <button type="button" onClick={() => setPicking(true)} style={{
          alignSelf: 'flex-start', background: 'none',
          border: '1px solid var(--color-l4)', borderRadius: 6,
          padding: '6px 14px', cursor: 'pointer',
          fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700,
          letterSpacing: '1.2px', color: 'var(--color-mute)',
        }}>
          + SCHEDULE SESSION
        </button>
      </div>

      {picking && (
        <Modal title="Schedule a Pause session" onClose={() => { setPicking(false); setAddService(''); setAddNote(''); setPickTab(0); }} width={520}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Date */}
            <div>
              <div className="runcino-label">Date</div>
              <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)}
                className="runcino-input" style={{ maxWidth: 180 }} />
            </div>

            {/* Tab strip */}
            <div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {SERVICE_GROUPS.map((g, idx) => (
                  <button key={g.label} type="button" onClick={() => setPickTab(idx)} style={{
                    flex: 1, padding: '7px 0', borderRadius: 7, border: '1px solid', cursor: 'pointer',
                    fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.2px',
                    textTransform: 'uppercase',
                    borderColor: pickTab === idx ? 'var(--color-recovery)' : 'var(--color-l4)',
                    background: pickTab === idx ? 'var(--recovery-wash)' : 'transparent',
                    color: pickTab === idx ? 'var(--color-recovery)' : 'var(--color-t3)',
                  }}>{g.label}</button>
                ))}
              </div>

              {/* 2-column compact grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {SERVICE_GROUPS[pickTab].keys.map(key => {
                  const svc = services[key];
                  if (!svc) return null;
                  const sel = addService === key;
                  const affordable = credits ? svc.credits <= credits.remaining : true;
                  return (
                    <button key={key} type="button" onClick={() => setAddService(sel ? '' : key)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: 8, border: '1.5px solid', cursor: 'pointer',
                      fontFamily: 'inherit', textAlign: 'left',
                      borderColor: sel ? 'var(--color-race)' : 'var(--color-l4)',
                      background: sel ? 'var(--race-wash)' : 'var(--color-l2)',
                      opacity: affordable ? 1 : 0.4,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: sel ? 'var(--color-race)' : 'var(--color-t1)' }}>
                        {svc.name}
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700,
                        color: sel ? 'var(--color-race)' : 'var(--color-mute)',
                        letterSpacing: '0.5px', flexShrink: 0, marginLeft: 8,
                      }}>{svc.credits} CR</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note */}
            <div>
              <div className="runcino-label">Note (optional)</div>
              <input className="runcino-input" value={addNote} onChange={e => setAddNote(e.target.value)} placeholder="e.g. post-long run" />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => void scheduleSession()}
                disabled={!addDate || !addService || saving}
                className="btn btn--primary" style={{ flex: 1 }}>
                {saving ? 'Scheduling…' : 'Schedule'}
              </button>
              <button type="button" onClick={() => { setPicking(false); setAddService(''); setAddNote(''); setPickTab(0); }}
                className="btn btn--ghost">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

