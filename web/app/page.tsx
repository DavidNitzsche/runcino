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
import { listRaces, type SavedRace } from '../lib/storage';
import { autoSyncStrava } from '../lib/strava-auto';
import { useActivities, onlyRuns, type NormalizedActivity } from '../lib/strava-activities';
import { rollupYear, weeklyMiles, currentWeekDays, funStats } from '../lib/strava-stats';
import { greeting, formatWeekRange, formatShort, daysUntil, todayISO, thisWeekRange } from '../lib/dates';

export default function OverviewPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [races, setRaces] = useState<SavedRace[] | null>(null);
  const { activities } = useActivities();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNow(new Date());
      const initial = await listRaces();
      if (cancelled) return;
      setRaces(initial);
      const sync = await autoSyncStrava();
      if (cancelled) return;
      if (sync.updatedSlugs.length > 0) {
        const refreshed = await listRaces(true);
        if (!cancelled) setRaces(refreshed);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (now === null || races === null) return <LoadingShell />;

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

          <Greeting now={now} next={next} daysToNext={daysToNext} lastCompleted={lastCompleted} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 10 }}>
            <NextRaceCard next={next} daysToNext={daysToNext} />
            <RecentRunCard lastRun={lastRun} />
            <WeeklyMilesCard runs={runs} />
            <YearMilesCard runs={runs} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <ThisWeekTile runs={runs} now={now} />
            <TodayTile now={now} next={next} daysToNext={daysToNext} runs={runs} />
          </div>

          <FunStatsSection runs={runs} />

          <SectionHeader title="Other surfaces" sub="What each tab unlocks" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            <SurfaceTile href="/races"    title="Races"    body="Build pacing plans, drop GPX, export to Watch."        chip="LIVE" />
            <SurfaceTile href="/log"      title="Log"      body="Every Strava run with route, splits, and PR detection." chip="LIVE" />
            <SurfaceTile href="/health"   title="Health"   body="HR + cadence trends from Strava. HRV/sleep in M2."     chip="LIVE" />
            <SurfaceTile href="/training" title="Training" body="Adaptive weekly plan from goal race + fitness."         chip="M3" muted />
          </div>

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
          <div className="hint" style={{ padding: 24 }}>Loading…</div>
        </div>
      </div>
    </>
  );
}

function Greeting({
  now, next, daysToNext, lastCompleted,
}: {
  now: Date; next: SavedRace | null; daysToNext: number | null; lastCompleted: SavedRace | null;
}) {
  const hl = (() => {
    if (daysToNext !== null && daysToNext === 0) return { text: 'Race day', style: 'race' as const };
    if (daysToNext !== null && daysToNext === 1) return { text: 'Race tomorrow', style: 'race' as const };
    if (daysToNext !== null && daysToNext <= 7) return { text: 'Race week', style: 'race' as const };
    if (daysToNext !== null && daysToNext <= 28) return { text: 'Race month', style: 'attention' as const };
    return null;
  })();

  const sub = (() => {
    if (next && daysToNext === 0) return `${next.meta.name} · today`;
    if (next && daysToNext === 1) return `${next.meta.name} · tomorrow`;
    if (next && daysToNext !== null) return <><b style={{ color: 'var(--color-t1)' }}>{next.meta.name}</b> · {daysToNext} days · goal {next.meta.goalDisplay}</>;
    if (lastCompleted) {
      const back = Math.abs(daysUntil(lastCompleted.meta.date));
      return <><b style={{ color: 'var(--color-t1)' }}>{lastCompleted.meta.name}</b> {back === 1 ? 'yesterday' : `${back} days ago`} · no upcoming race</>;
    }
    return 'No races yet — add one to start building plans.';
  })();

  return (
    <div style={{ marginBottom: 26, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', padding: '0 4px' }}>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 10.5, letterSpacing: 2.2, textTransform: 'uppercase', color: 'var(--color-t2)', fontWeight: 700 }}>
        {greeting(now)}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 96, fontWeight: 700, letterSpacing: '-.01em', lineHeight: .85, textTransform: 'uppercase', color: 'var(--color-t0)' }}>
        David
      </div>
      {hl && (
        <div style={{
          display: 'inline-block',
          background: hl.style === 'race' ? 'var(--color-attention)' : 'var(--color-corporate)',
          color: 'var(--color-l0)',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: '.01em',
          textTransform: 'uppercase',
          padding: '5px 12px 6px',
          lineHeight: 1,
        }}>{hl.text}</div>
      )}
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-t2)', fontWeight: 500 }}>{sub}</div>
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
  const todayISOStr = now.toISOString().slice(0, 10);
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

/* ── Fun stats ─────────────────────────────────────────────
   Headline numbers compared to relatable things — landmarks,
   road trips, screen-time references. Driven entirely by the
   year's Strava activity rollup. */
function FunStatsSection({ runs }: { runs: NormalizedActivity[] | null }) {
  if (!runs || runs.length === 0) return null;
  const r = rollupYear(runs);
  const stats = funStats(r);
  if (stats.length === 0) return null;
  return (
    <>
      <SectionHeader title="Fun stats" sub={`${r.totalRuns} runs · ${r.totalMiles.toFixed(1)} mi this year`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
        {stats.map((s, i) => (
          <div key={i} className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 140 }}>
            <div className="tile-sub">{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32, letterSpacing: '-.02em', lineHeight: 1, color: 'var(--color-t0)' }}>
              {s.value}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', lineHeight: 1.5, flex: 1 }}>{s.detail}</div>
          </div>
        ))}
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

function SurfaceTile({ href, title, body, chip, muted }: { href: string; title: string; body: string; chip: string; muted?: boolean }) {
  return (
    <Link href={href} className="tile" style={{
      textDecoration: 'none', color: 'inherit', cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 12, minHeight: 140,
      opacity: muted ? .65 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, textTransform: 'uppercase', letterSpacing: '-.005em' }}>{title}</div>
        <span className="chip" style={muted ? {} : { background: 'rgba(62,189,65,.12)', color: 'var(--color-success)', borderColor: 'rgba(62,189,65,.3)' }}>{chip}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-t2)', lineHeight: 1.55, flex: 1 }}>{body}</div>
      <div className="tile-sub" style={{ color: muted ? 'var(--color-t3)' : 'var(--color-corporate)' }}>{muted ? 'Locked' : 'Open →'}</div>
    </Link>
  );
}
