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
  useEffect(() => { setRaces(listRaces()); }, []);

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
              <Grid>{upcoming.map(r => <RaceCard key={r.slug} race={r} highlight />)}</Grid>
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

function RaceCard({ race, highlight = false }: { race: SavedRace; highlight?: boolean }) {
  const days = daysUntil(race.meta.date);
  const isUpcoming = days >= 0;
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
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className="tile-sub">{fmtDate(race.meta.date)}</span>
        {isUpcoming
          ? <span className="chip chip--attention">{days === 0 ? 'TODAY' : `${days}D`}</span>
          : <span className="chip">DONE</span>}
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
        <span>GOAL</span>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '-.01em', color: 'var(--color-t0)', fontWeight: 800 }}>
          {race.meta.goalDisplay}
        </b>
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
