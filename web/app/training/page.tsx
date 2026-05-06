'use client';

/**
 * /training — actual training executed (last 7 days from Strava) +
 * Coach's daily prescription.
 *
 * Stage 3: today's workout + readiness pill come from /api/coach/today,
 * which routes through `coach.prescribeWorkout` + `coach.assessReadiness`.
 * Both are deterministic (no LLM). The "Why?" toggle on the daily card
 * reveals the citations into docs/coaching-research.md.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Caption, Nav } from '../../components/nav';
import { listRaces, type SavedRace } from '../../lib/storage';
import { useActivities, onlyRuns } from '../../lib/strava-activities';
import { currentWeekDays, weeklyMiles } from '../../lib/strava-stats';
import { daysUntil, formatWeekRange, formatShort } from '../../lib/dates';

// ── Daily prescription shapes (from /api/coach/today) ───────────────
type Citation = { doc: string; section: string; snippet?: string };
type CoachDecision<T> = { answer: T; rationale: string; explanation?: string; citations: Citation[]; brain: 'deterministic' | 'llm' };
type WorkoutPrescription = {
  type: string;
  label: string;
  distanceMi: number;
  paceTargetSPerMi?: { lower: number; upper: number } | null;
  hrZone?: number | null;
  phaseLabel: string;
  voiceLead: string;
  isQuality: boolean;
  isLong: boolean;
};
type ReadinessAssessment = {
  level: 'green' | 'yellow' | 'red';
  message: string;
  acwr: number | null;
  easyShare: number | null;
};
type CoachTodayResponse = {
  ok: boolean;
  error?: string;
  coach?: {
    workout: CoachDecision<WorkoutPrescription>;
    readiness: CoachDecision<ReadinessAssessment>;
  };
  today?: {
    weekShape: Array<{ date: string; type: string; distanceMi: number; isToday: boolean; hasStrength: boolean }>;
    alerts: Array<{ severity: 'info' | 'warn' | 'rest'; message: string }>;
    mode: 'race' | 'base';
    phase: string;
    modeDetail: string;
  };
};

export default function TrainingPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [races, setRaces] = useState<SavedRace[] | null>(null);
  const [coachToday, setCoachToday] = useState<CoachTodayResponse | null>(null);
  const { activities } = useActivities();

  useEffect(() => {
    let cancelled = false;
    setNow(new Date());
    listRaces().then(rs => { if (!cancelled) setRaces(rs); });
    fetch('/api/coach/today')
      .then(r => r.json())
      .then((data: CoachTodayResponse) => { if (!cancelled) setCoachToday(data); })
      .catch(() => { /* non-fatal — card shows the unavailable state */ });
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

          <TodayCard data={coachToday} now={now} />

          {runs && <ActualThisWeekTile runs={runs} now={now} />}
          {runs && runs.length > 0 && <RecentWeeksTile runs={runs} />}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <Stub label="Build arc" range="16-week periodization" pill="M3" body="Visual phase progression — base / build / peak / taper — over the months leading to your goal race." />
            <Stub label="Watch-sync" range="CustomWorkout export" pill="M3" body="Push today's prescription to your Watch with target paces, HR zones, and lap structure — same pipeline as race-day intervals." />
          </div>

        </div>
      </div>
    </>
  );
}

// ── TodayCard — single source of truth for today ────────────────────
// Layout: header strip (Today + date + phase chip), big workout title,
// optional stats row, single voice-lead body paragraph (always
// visible), and only-when-actionable alerts. No competing pills, no
// duplicate description + italic, no toggleable Why panel — one
// coherent block.
function TodayCard({ data, now }: { data: CoachTodayResponse | null; now: Date }) {
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  // Loading
  if (!data) {
    return (
      <div className="tile" style={{ padding: '20px 24px', marginBottom: 10 }}>
        <div className="tile-h">
          <div>
            <div className="tile-sub">Today</div>
            <div className="tile-lbl">{dateLabel}</div>
          </div>
        </div>
        <div className="hint">Coach is checking in…</div>
      </div>
    );
  }

  // Error / no DB
  if (!data.ok || !data.coach) {
    return (
      <div className="tile" style={{ padding: '20px 24px', marginBottom: 10, borderStyle: 'dashed' }}>
        <div className="tile-h">
          <div>
            <div className="tile-sub">Today</div>
            <div className="tile-lbl">{dateLabel}</div>
          </div>
          <span className="chip">Coach unavailable</span>
        </div>
        <div className="hint" style={{ fontSize: 12 }}>
          {data.error ?? 'Need a connected Strava account + a saved goal race to generate today\'s prescription.'}
        </div>
      </div>
    );
  }

  const w = data.coach.workout.answer;
  const alerts = data.today?.alerts ?? [];

  return (
    <div className="tile" style={{ padding: '20px 24px', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Today</div>
          <div className="tile-lbl">{dateLabel}</div>
        </div>
        <span className="chip" style={{ background: 'var(--color-l3)', color: 'var(--color-t1)', fontWeight: 600, letterSpacing: '0.06em' }}>
          {w.phaseLabel}
        </span>
      </div>

      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 44, letterSpacing: '-.02em', textTransform: 'uppercase', lineHeight: 1 }}>
        {w.label}
      </div>

      {(w.distanceMi > 0 || w.paceTargetSPerMi || w.hrZone) && (
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          {w.distanceMi > 0 && (
            <Stat label="Distance" value={`${w.distanceMi.toFixed(1)} mi`} />
          )}
          {w.paceTargetSPerMi && (
            <Stat
              label="Pace"
              value={`${fmtPace(w.paceTargetSPerMi.lower)}–${fmtPace(w.paceTargetSPerMi.upper)}/mi`}
            />
          )}
          {w.hrZone != null && <Stat label="HR zone" value={`${w.hrZone}`} />}
        </div>
      )}

      {/* Single voice-lead body — combines situation + prescription +
          execution note. No headings, no toggle. */}
      <div style={{ fontSize: 14, color: 'var(--color-t0)', lineHeight: 1.65, maxWidth: 760 }}>
        {w.voiceLead}
      </div>

      {/* Alerts strip — only fires when the message ADDS information
          the voice lead doesn't already cover (rebuild warning, ACWR
          way over). Heavy-block + post-race alerts are suppressed
          server-side because the voice lead names them. */}
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {alerts.map((a, i) => (
            <div key={i} style={{
              padding: '8px 12px', borderRadius: 6, fontSize: 12,
              background: a.severity === 'rest' ? 'rgba(252,77,84,.1)' : a.severity === 'warn' ? 'rgba(243,173,59,.1)' : 'rgba(79,143,247,.1)',
              borderLeft: `3px solid ${a.severity === 'rest' ? 'var(--color-warning)' : a.severity === 'warn' ? 'var(--color-attention)' : 'var(--color-corporate)'}`,
              color: 'var(--color-t1)',
            }}>
              {a.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-t3)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'var(--font-data)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-t0)' }}>{value}</div>
    </div>
  );
}

function fmtPace(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
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
