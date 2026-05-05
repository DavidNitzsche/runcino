'use client';

/**
 * /races — index of every saved race plan.
 *
 * Reads from localStorage (lib/storage.ts) on the client. Splits into
 * "Upcoming" and "Completed" by race date and renders a card for each.
 * Empty state surfaces a single CTA pointing at /races/new.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Caption, Nav } from '../../components/nav';
import { listRaces, type SavedRace } from '../../lib/storage';
import { autoSyncStrava } from '../../lib/strava-auto';

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T12:00:00Z');
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export default function RacesIndexPage() {
  const [races, setRaces] = useState<SavedRace[] | null>(null);

  // Read from localStorage on mount; the SSR pass shows the loading shell.
  // Seeds Big Sur + Sombrero on first visit (idempotent), then pulls
  // any Strava-sourced actualResult updates in the background.
  useEffect(() => {
    let cancelled = false;
    (async () => {
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

  const upcoming = races?.filter(r => daysUntil(r.meta.date) >= 0) ?? [];
  const past     = races?.filter(r => daysUntil(r.meta.date) < 0) ?? [];

  return (
    <>
      <Caption left="Runcino · races" right={`v0.1 · ${new Date().toISOString().slice(0, 10)}`} />
      <div className="stage">
        <Nav active="races" />
        <div className="body">
          <div className="page-head">
            <div>
              <div className="eyebrow">Your season</div>
              <h1>Races</h1>
              <div className="sub">
                {races === null
                  ? 'Loading…'
                  : races.length === 0
                  ? <><b>No races yet.</b> Add a race to build a Watch-ready pacing plan.</>
                  : <><b>{upcoming.length} upcoming</b> · {past.length} completed.</>}
              </div>
            </div>
            <div className="page-actions">
              <Link href="/races/new" className="btn btn--primary">+ Add race</Link>
            </div>
          </div>

          {races === null && <div className="hint" style={{ padding: 16 }}>Reading saved plans from localStorage…</div>}

          {races !== null && races.length === 0 && (
            <EmptyState />
          )}

          {upcoming.length > 0 && (
            <Section title="Upcoming">
              {/* First upcoming race takes the full-width hero with rich
                  course detail. Remaining upcoming races stack beneath
                  as standard cards. */}
              <UpcomingRaceHero race={upcoming[0]} />
              {upcoming.length > 1 && (
                <div style={{ marginTop: 10 }}>
                  <Grid>{upcoming.slice(1).map(r => <RaceCard key={r.slug} race={r} highlight />)}</Grid>
                </div>
              )}
            </Section>
          )}

          {past.length > 0 && (
            <Section title="Completed">
              <Grid>{past.map(r => <RaceCard key={r.slug} race={r} />)}</Grid>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="section-h">
        <div>
          <div className="tile-sub" style={{ marginBottom: 4 }}>Saved race plans</div>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 10,
    }}>{children}</div>
  );
}

function parseGoalS(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
function fmtDelta(s: number): string {
  s = Math.round(Math.abs(s));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function RaceCard({ race, highlight = false }: { race: SavedRace; highlight?: boolean }) {
  const days = daysUntil(race.meta.date);
  const isUpcoming = days >= 0;
  const result = race.actualResult ?? null;
  const goalS = parseGoalS(race.meta.goalDisplay);
  const delta = result && goalS != null ? result.finishS - goalS : null;
  return (
    <Link
      href={`/races/${race.slug}`}
      className="tile"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        cursor: 'pointer',
        minHeight: 200,
        textDecoration: 'none',
        ...(highlight && {
          borderColor: 'rgba(243,173,59,.4)',
          background: 'linear-gradient(135deg, rgba(243,173,59,.06) 0%, var(--color-l1) 80%)',
        }),
        ...(!isUpcoming && result && {
          borderColor: 'rgba(62,189,65,.3)',
          background: 'linear-gradient(135deg, rgba(62,189,65,.05) 0%, var(--color-l1) 80%)',
        }),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <span className="tile-sub">{fmtDate(race.meta.date)}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {race.meta.priority && race.meta.priority !== 'A' && (
            <span className="chip" style={{ fontSize: 9, color: race.meta.priority === 'B' ? 'var(--color-corporate)' : 'var(--color-t2)', borderColor: race.meta.priority === 'B' ? 'rgba(0,143,236,.4)' : 'var(--color-l4)' }}>{race.meta.priority}</span>
          )}
          {isUpcoming && <span className="chip chip--attention">{days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : `${days}D`}</span>}
          {!isUpcoming && result?.isPR && <span className="chip chip--attention">PR</span>}
          {!isUpcoming && result && !result.isPR && <span className="chip chip--success">FINISHED</span>}
          {!isUpcoming && !result && <span className="chip">RESULT PENDING</span>}
        </div>
      </div>
      <div>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 28,
          letterSpacing: '-.005em',
          lineHeight: 0.95,
          textTransform: 'uppercase',
          color: 'var(--color-t0)',
        }}>{race.meta.name}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-t2)', fontWeight: 500, marginTop: 4 }}>
          {race.meta.distanceMi.toFixed(1)} mi
          {result?.avgHr ? ` · ${Math.round(result.avgHr)} bpm avg` : ''}
        </div>
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginTop: 'auto',
        fontFamily: 'var(--font-data)',
        fontSize: 10,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: 'var(--color-t3)',
        fontWeight: 700,
        paddingTop: 16,
        borderTop: '1px solid var(--color-l4)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>{!isUpcoming && result ? 'FINISH' : 'GOAL'}</span>
          {!isUpcoming && result && (
            <span style={{ color: 'var(--color-t3)', fontSize: 9, fontWeight: 700 }}>vs goal {race.meta.goalDisplay}</span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '-.01em', color: 'var(--color-t0)', fontWeight: 800 }}>
            {!isUpcoming && result ? result.finishDisplay : race.meta.goalDisplay}
          </b>
          {delta != null && (
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 800, letterSpacing: '-.005em', color: delta <= 0 ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {delta === 0 ? '±0' : (delta > 0 ? '+' : '−') + fmtDelta(delta)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="tile" style={{
      padding: 64,
      textAlign: 'center',
      borderStyle: 'dashed',
      background: 'transparent',
    }}>
      <div className="tile-sub" style={{ marginBottom: 12 }}>Empty state</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, textTransform: 'uppercase', marginBottom: 12 }}>
        First race in 3 inputs.
      </div>
      <div style={{ color: 'var(--color-t2)', maxWidth: 480, margin: '0 auto 24px' }}>
        Type the race name + date, drop a GPX, set a goal time. The pacing plan, fueling schedule, and Watch intervals fall out the other side.
      </div>
      <Link href="/races/new" className="btn btn--primary" style={{ padding: '14px 28px' }}>+ Add your first race</Link>
    </div>
  );
}

/* ── Upcoming race hero ────────────────────────────────────────
   Replaces the tiny "AMERICAS FINEST CITY 13.2 mi 1:30:00" card with
   a full-width hero that surfaces every interesting fact we have
   about the race: countdown, goal pace, course profile via the
   phase-color strip, elevation gain, peak elevation, plan stats,
   priority chip. Computed entirely from the SavedRace plan + meta. */
const PHASE_COLORS_HERO = [
  '#3EBD41', '#F3AD3B', '#FC4D54', '#008FEC', '#9013FE',
  '#CD317C', '#27E087', '#E88221',
];

function parseGoalSecs(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
function fmtPace(s: number): string {
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function priorityColor(p: 'A' | 'B' | 'C'): string {
  return p === 'A' ? 'var(--color-attention)' : p === 'B' ? 'var(--color-corporate)' : 'var(--color-t2)';
}

function UpcomingRaceHero({ race }: { race: SavedRace }) {
  const days = daysUntil(race.meta.date);
  const goalS = parseGoalSecs(race.meta.goalDisplay);
  const goalPaceS = goalS && race.meta.distanceMi > 0 ? Math.round(goalS / race.meta.distanceMi) : null;
  const totalGain = race.plan.race.total_gain_ft;
  const phases = race.plan.phases;
  const totalDist = race.meta.distanceMi;
  const priority: 'A' | 'B' | 'C' = race.meta.priority ?? 'A';

  // Days-to-race chip color: imminent = warning, race-week = attention,
  // race-month = corporate, far out = muted.
  const daysColor = days <= 1 ? 'var(--color-warning)'
    : days <= 7 ? 'var(--color-attention)'
    : days <= 28 ? 'var(--color-corporate)'
    : 'var(--color-t2)';
  const daysLabel = days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : `${days} DAYS`;

  return (
    <Link href={`/races/${race.slug}`} style={{
      display: 'block', textDecoration: 'none', color: 'inherit',
      borderRadius: 16, overflow: 'hidden',
      background: 'linear-gradient(135deg, rgba(243,173,59,.10) 0%, rgba(243,173,59,.02) 45%, var(--color-l1) 100%)',
      border: '1px solid rgba(243,173,59,.32)',
      padding: '28px 32px',
    }}>
      {/* Header strip — eyebrow date + days chip + priority chip */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '2.2px', textTransform: 'uppercase', color: 'var(--color-attention)', marginBottom: 6 }}>
            COMING UP · {fmtDate(race.meta.date).toUpperCase()}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 56, letterSpacing: '-.015em', lineHeight: 0.92, textTransform: 'uppercase', color: 'var(--color-t0)' }}>
            {race.meta.name}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700, letterSpacing: '1.6px',
            padding: '6px 12px', borderRadius: 6,
            background: 'transparent', color: daysColor, border: `1.5px solid ${daysColor}`,
          }}>{daysLabel}</span>
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 9.5, fontWeight: 700, letterSpacing: '1.6px',
            padding: '4px 9px', borderRadius: 4,
            color: priorityColor(priority), border: `1px solid ${priorityColor(priority)}`,
          }}>RACE {priority}</span>
        </div>
      </div>

      {/* Stats row — distance / goal time / goal pace / elev gain / peak */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 18, paddingTop: 18, paddingBottom: 18,
        borderTop: '1px solid var(--color-l4)', borderBottom: '1px solid var(--color-l4)',
        marginBottom: 18,
      }}>
        <HeroStat label="Distance" value={`${totalDist.toFixed(1)}`} unit="mi" />
        <HeroStat label="Goal time" value={race.meta.goalDisplay} unit="" big />
        {goalPaceS && <HeroStat label="Goal pace" value={fmtPace(goalPaceS)} unit="/mi" />}
        <HeroStat label="Elevation gain" value={`+${totalGain.toLocaleString()}`} unit="ft" />
      </div>

      {/* Phase color strip — proportional widths, named below */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--color-t3)', marginBottom: 8 }}>
          Course profile · {phases.length} phases
        </div>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1, marginBottom: 6 }}>
          {phases.map((p, i) => {
            const widthPct = ((p.end_mi - p.start_mi) / totalDist) * 100;
            return (
              <div key={i} title={`${p.label} · mi ${p.start_mi.toFixed(1)}–${p.end_mi.toFixed(1)} · ${p.target_pace_display}/mi`} style={{
                width: `${widthPct}%`,
                background: PHASE_COLORS_HERO[i] ?? '#444',
              }} />
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 1 }}>
          {phases.map((p, i) => {
            const widthPct = ((p.end_mi - p.start_mi) / totalDist) * 100;
            return (
              <div key={i} style={{
                width: `${widthPct}%`,
                fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
                color: 'var(--color-t2)', textTransform: 'uppercase',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                paddingRight: 4,
              }}>{p.label}</div>
            );
          })}
        </div>
      </div>

      {/* Footer chips */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)' }}>
          {race.plan.intervals.length} intervals · ready for Watch
        </div>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-attention)' }}>
          OPEN RACE PLAN →
        </div>
      </div>
    </Link>
  );
}

function HeroStat({ label, value, unit, big }: { label: string; value: string; unit: string; big?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--color-t3)' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: big ? 36 : 30,
        letterSpacing: '-.015em', lineHeight: 1, color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums',
      }}>
        {value}{unit && <span style={{ fontSize: '.45em', opacity: .55, marginLeft: 4, fontWeight: 700 }}>{unit}</span>}
      </div>
    </div>
  );
}
