'use client';

/**
 * /training — actual training executed (last 7 days from Strava) +
 * placeholder for the M3 Coach plan.
 *
 * The "this week so far" strip is real: Strava miles per day, today
 * highlighted, week total. Build arc / weekly plan / today workout
 * stay M3 stubs until Coach lands.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Caption, Nav } from '../../components/nav';
import { listRaces, type SavedRace } from '../../lib/storage';
import { useActivities, onlyRuns } from '../../lib/strava-activities';
import { currentWeekDays, weeklyMiles } from '../../lib/strava-stats';
import { daysUntil, formatWeekRange, formatShort } from '../../lib/dates';

export default function TrainingPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [races, setRaces] = useState<SavedRace[] | null>(null);
  const { activities } = useActivities();

  useEffect(() => {
    let cancelled = false;
    setNow(new Date());
    listRaces().then(rs => { if (!cancelled) setRaces(rs); });
    return () => { cancelled = true; };
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
  const runs = activities ? onlyRuns(activities) : null;

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

          {runs && <ActualThisWeekTile runs={runs} now={now} />}
          {runs && runs.length > 0 && <RecentWeeksTile runs={runs} />}

          <ComingSoon
            milestone="M3 · Coach"
            title="Adaptive weekly plan"
            body="Once Coach is on, your week auto-generates from your goal race + current fitness. HRV drops, missed runs, and race-week tapers all flow through. Each daily workout pushes to your Watch as a CustomWorkout — same pipeline as the race-day intervals."
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <Stub label="Today's plan" range={now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} pill="M3" body="The single workout for today, with target paces, HR zones, and Watch-sync button." />
            <Stub label="Build arc" range="16-week periodization" pill="M3" body="Visual phase progression — base / build / peak / taper — over the months leading to your goal race." />
          </div>

        </div>
      </div>
    </>
  );
}

function ActualThisWeekTile({ runs, now }: { runs: import('../../lib/strava-activities').NormalizedActivity[]; now: Date }) {
  const days = currentWeekDays(runs);
  const total = days.reduce((s, d) => s + d.miles, 0);
  const runsCount = days.reduce((s, d) => s + d.runs, 0);
  const max = Math.max(...days.map(d => d.miles), 1);
  const dayLabels = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  return (
    <div className="tile" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 10 }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">This week so far</div>
          <div className="tile-lbl">{formatWeekRange(now)}</div>
        </div>
        <span className="chip chip--success">{runsCount} RUN{runsCount === 1 ? '' : 'S'} · {total.toFixed(1)} MI</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 90 }}>
        {days.map((d, i) => {
          const h = d.miles > 0 ? Math.max(8, (d.miles / max) * 90) : 0;
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: d.miles > 0 ? 'var(--color-t1)' : 'var(--color-t3)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {d.miles > 0 ? d.miles.toFixed(1) : '—'}
              </div>
              <div style={{
                width: '100%',
                height: h ? `${h}px` : '6px',
                background: h ? (d.isToday ? 'var(--color-attention)' : 'var(--color-corporate)') : 'var(--color-l3)',
                borderRadius: 3,
                opacity: d.isFuture ? 0.5 : 1,
              }} />
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, color: d.isToday ? 'var(--color-attention)' : 'var(--color-t3)', fontWeight: 700, letterSpacing: '1.2px' }}>
                {dayLabels[i]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentWeeksTile({ runs }: { runs: import('../../lib/strava-activities').NormalizedActivity[] }) {
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

function Stub({ label, range, pill, body }: { label: string; range: string; pill: string; body: string }) {
  return (
    <div className="tile" style={{
      borderStyle: 'dashed', background: 'transparent',
      display: 'flex', flexDirection: 'column', gap: 14, minHeight: 180,
    }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">{label}</div>
          <div className="tile-lbl">{range}</div>
        </div>
        <span className="chip">{pill}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 48, color: 'var(--color-t3)', lineHeight: 1, letterSpacing: '-.025em' }}>—</div>
        <div className="tile-sub" style={{ color: 'var(--color-t3)' }}>No data</div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-t2)', lineHeight: 1.55, paddingTop: 12, borderTop: '1px solid var(--color-l4)' }}>
        {body}
      </div>
    </div>
  );
}
