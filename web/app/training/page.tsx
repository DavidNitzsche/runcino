'use client';

/**
 * /training — honest empty state until Coach (M3) lands.
 *
 * Replaces the embedded designs/training.html mock. The math libs
 * (lib/training.ts, /api/plan-week) exist; once they're wired into
 * the app this page becomes the daily/weekly plan view.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Caption, Nav } from '../../components/nav';
import { listRaces, type SavedRace } from '../../lib/storage';
import { daysUntil, formatWeekRange, formatShort } from '../../lib/dates';

export default function TrainingPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [races, setRaces] = useState<SavedRace[] | null>(null);

  useEffect(() => {
    setNow(new Date());
    setRaces(listRaces());
  }, []);

  if (now === null || races === null) {
    return (
      <>
        <Caption left="Runcino · training" />
        <div className="stage">
          <Nav active="training" />
          <div className="body"><div className="hint" style={{ padding: 24 }}>Loading…</div></div>
        </div>
      </>
    );
  }

  const upcoming = races.filter(r => daysUntil(r.meta.date) >= 0).sort((a, b) => daysUntil(a.meta.date) - daysUntil(b.meta.date));
  const goalRace = upcoming[0] ?? null;

  return (
    <>
      <Caption left="Runcino · training" right={`TRAINING · ${now.toISOString().slice(0,10)}`} />
      <div className="stage">
        <Nav active="training" />
        <div className="body">

          <div className="page-head">
            <div>
              <div className="eyebrow">Build · adapt · ship to Watch</div>
              <h1>Training</h1>
              <div className="sub">
                {goalRace
                  ? <>Goal race: <b>{goalRace.meta.name}</b> · {formatShort(goalRace.meta.date)} · {daysUntil(goalRace.meta.date)} days out.</>
                  : <>No goal race set. Add one to anchor your training plan.</>}
              </div>
            </div>
            <div className="page-actions">
              <Link href="/races" className="btn">All races</Link>
              {!goalRace && <Link href="/races/new" className="btn btn--primary">+ Add race</Link>}
            </div>
          </div>

          <ComingSoon
            milestone="M3 · Coach"
            title="Adaptive weekly plan"
            body="Once Coach is on, your week auto-generates from your goal race + current fitness. HRV drops, missed runs, and race-week tapers all flow through. Each daily workout pushes to your Watch as a CustomWorkout — same pipeline as the race-day intervals."
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <Stub label="This week" range={formatWeekRange(now)} pill="M3" body="Mile-by-mile plan with HR zones, fueling, and warm-up/cool-down structure. Drag-drop to reschedule. Quality / long / easy / rest auto-balanced." />
            <Stub label="Today" range={now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} pill="M3" body="The single workout for today, with target paces, HR zones, and Watch-sync button. Full execution detail like the race-day surface." />
          </div>

          <Stub
            label="Build arc"
            range="16-week periodization"
            pill="M3"
            body="Visual phase progression — base / build / peak / taper — over the months leading to your goal race. Each week sized by mileage, color-coded by phase, with milestone markers (peak week, longest run, taper start)."
            tall
          />

          <SectionHeader title="What works today" sub="Available now without Coach" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <SurfaceTile href="/races/new" title="Build a race plan" body="GPX → Minetti pacing + fueling + Watch intervals." />
            <SurfaceTile href="/races"     title="Saved race plans" body="Your built plans. Download .runcino.json, AirDrop to phone." />
            <SurfaceTile href="/health"    title="Health snapshot"  body="HRV / sleep / RHR — once HealthKit is on." muted />
          </div>

        </div>
      </div>
    </>
  );
}

function ComingSoon({ milestone, title, body }: { milestone: string; title: string; body: string }) {
  return (
    <div className="tile" style={{
      padding: '36px 32px', borderStyle: 'dashed', background: 'transparent',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <span className="chip chip--attention" style={{ alignSelf: 'flex-start' }}>{milestone}</span>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 38, textTransform: 'uppercase', letterSpacing: '-.01em', lineHeight: 1 }}>
        {title}
      </div>
      <div style={{ fontSize: 14, color: 'var(--color-t2)', maxWidth: 720, lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function Stub({ label, range, pill, body, tall }: { label: string; range: string; pill: string; body: string; tall?: boolean }) {
  return (
    <div className="tile" style={{
      borderStyle: 'dashed', background: 'transparent',
      display: 'flex', flexDirection: 'column', gap: 14, minHeight: tall ? 220 : 180,
    }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">{label}</div>
          <div className="tile-lbl">{range}</div>
        </div>
        <span className="chip">{pill}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: tall ? 72 : 48, color: 'var(--color-t3)', lineHeight: 1, letterSpacing: '-.025em' }}>—</div>
        <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>No data</div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-t2)', lineHeight: 1.55, paddingTop: 12, borderTop: '1px solid var(--color-l4)' }}>
        {body}
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

function SurfaceTile({ href, title, body, muted }: { href: string; title: string; body: string; muted?: boolean }) {
  return (
    <Link href={href} className="tile" style={{
      textDecoration: 'none', color: 'inherit', cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 10, minHeight: 120,
      opacity: muted ? .55 : 1,
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, textTransform: 'uppercase', letterSpacing: '-.005em' }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--color-t2)', lineHeight: 1.5, flex: 1 }}>{body}</div>
      <div className="tile-sub" style={{ color: muted ? 'var(--color-t3)' : 'var(--color-corporate)' }}>{muted ? 'Locked' : 'Open →'}</div>
    </Link>
  );
}
