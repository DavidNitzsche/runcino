'use client';

/**
 * / — Overview / Hub.
 *
 * Real React, date-driven, honest empty states. Replaces the embedded
 * designs/hub.html (which was frozen at "5 days to Big Sur" and now
 * reads as wrong since both Big Sur and Sombrero are in the past).
 *
 * Rules:
 *  - "Today" comes from new Date(). Greeting changes with time of day.
 *  - "Next race" / "Last race" / week range are computed from saved
 *    races + dates.ts helpers.
 *  - Recovery, weekly mileage, HRV, sleep, ACWR — all show "—" with a
 *    milestone pill (M2 · HealthKit / M2 · Strava) until those
 *    integrations land. No mock numbers anywhere.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Caption, Nav } from '../components/nav';
import { listRaces, type SavedRace } from '../lib/storage';
import { greeting, formatWeekRange, formatShort, daysUntil, todayISO } from '../lib/dates';

export default function OverviewPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [races, setRaces] = useState<SavedRace[] | null>(null);

  useEffect(() => {
    setNow(new Date());
    setRaces(listRaces());
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

  return (
    <>
      <Caption left="Runcino · overview" right={`OVERVIEW · ${todayISO()}`} />
      <div className="stage">
        <Nav active="overview" />
        <div className="body">

          <Greeting now={now} next={next} daysToNext={daysToNext} lastCompleted={lastCompleted} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 10 }}>
            <NextRaceCard next={next} daysToNext={daysToNext} />
            <RecentRaceCard last={lastCompleted} />
            <PlaceholderCard label="Recovery" pill="M2 · HealthKit" />
            <PlaceholderCard label="Weekly miles" pill="M2 · Strava" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <ThisWeekTile now={now} />
            <TodayTile now={now} next={next} daysToNext={daysToNext} />
          </div>

          <SectionHeader title="Other surfaces" sub="What each tab unlocks" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            <SurfaceTile href="/races"    title="Races"    body="Build pacing plans, drop GPX, export to Watch."        chip="LIVE" />
            <SurfaceTile href="/training" title="Training" body="Adaptive weekly plan from goal race + fitness."         chip="M3" muted />
            <SurfaceTile href="/health"   title="Health"   body="HRV / sleep / RHR trends auto-pulled from your phone." chip="M2" muted />
            <SurfaceTile href="/log"      title="Log"      body="Every run with route, splits, and PR detection."        chip="M2" muted />
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

function RecentRaceCard({ last }: { last: SavedRace | null }) {
  if (!last) {
    return <PlaceholderCard label="Last race" pill="No races yet" />;
  }
  const back = Math.abs(daysUntil(last.meta.date));
  return (
    <Link href={`/races/${last.slug}`} className="tile" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 160, gap: 14,
      textDecoration: 'none', color: 'inherit', cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="tile-sub">Last race</div>
        <span className="chip">{back === 1 ? 'YESTERDAY' : `${back}D AGO`}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, letterSpacing: '-.01em', lineHeight: .95, textTransform: 'uppercase', color: 'var(--color-t0)' }}>
        {last.meta.name}
      </div>
      <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>
        {last.meta.distanceMi.toFixed(1)} mi · result pending
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

function ThisWeekTile({ now }: { now: Date }) {
  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 220 }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">This week</div>
          <div className="tile-lbl">{formatWeekRange(now)}</div>
        </div>
        <span className="chip">M3 · COACH</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 12 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, color: 'var(--color-t3)', lineHeight: 1, letterSpacing: '-.025em' }}>—</div>
        <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>No training plan yet</div>
        <div style={{ fontSize: 13, color: 'var(--color-t2)', maxWidth: 360 }}>
          Once Coach (M3) is on, your weekly plan auto-generates from your goal race + current fitness, adapts to skipped days, and pushes daily workouts to your Watch.
        </div>
      </div>
    </div>
  );
}

function TodayTile({ now, next, daysToNext }: { now: Date; next: SavedRace | null; daysToNext: number | null }) {
  const isRaceToday = daysToNext === 0 && next;
  const isRaceTomorrow = daysToNext === 1 && next;
  const todayDow = now.toLocaleDateString('en-US', { weekday: 'long' });
  const todayShort = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 220, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: isRaceToday ? 'var(--color-attention)' : 'var(--color-corporate)' }} />
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
        {!isRaceToday && !isRaceTomorrow && (
          <>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, color: 'var(--color-t3)', lineHeight: 1, letterSpacing: '-.025em' }}>—</div>
            <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>No workout scheduled</div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', maxWidth: 360 }}>
              Today&apos;s workout shows here once Coach is on. For now, the next race plan lives at <Link href="/races" style={{ color: 'var(--color-corporate)', textDecoration: 'underline', textUnderlineOffset: 3 }}>/races</Link>.
            </div>
          </>
        )}
      </div>
    </div>
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
