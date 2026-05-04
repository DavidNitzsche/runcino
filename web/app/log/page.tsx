'use client';

/**
 * /log — honest empty state until Strava (M2) lands.
 *
 * Once Strava OAuth is wired, every run auto-imports with route, HR,
 * pace, and split detection. PRs flag automatically. Until then, this
 * page shows what's coming + the existing race results.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Caption, Nav } from '../../components/nav';
import { listRaces, type SavedRace } from '../../lib/storage';
import { daysUntil, formatShort } from '../../lib/dates';

export default function LogPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [races, setRaces] = useState<SavedRace[] | null>(null);

  useEffect(() => {
    setNow(new Date());
    setRaces(listRaces());
  }, []);

  if (now === null || races === null) {
    return (
      <>
        <Caption left="Runcino · log" />
        <div className="stage">
          <Nav active="log" />
          <div className="body"><div className="hint" style={{ padding: 24 }}>Loading…</div></div>
        </div>
      </>
    );
  }

  const past = races.filter(r => daysUntil(r.meta.date) < 0).sort((a, b) => daysUntil(b.meta.date) - daysUntil(a.meta.date));

  return (
    <>
      <Caption left="Runcino · log" right={`LOG · ${now.toISOString().slice(0,10)}`} />
      <div className="stage">
        <Nav active="log" />
        <div className="body">

          <div className="page-head">
            <div>
              <div className="eyebrow">Every run, recorded</div>
              <h1>Log</h1>
              <div className="sub">
                {past.length === 0
                  ? <>No runs logged yet. Strava sync (M2) auto-imports from there.</>
                  : <><b>{past.length} race{past.length === 1 ? '' : 's'}</b> on the books. Daily runs join in M2.</>}
              </div>
            </div>
            <div className="page-actions">
              <button className="btn" disabled>+ Log a run</button>
              <button className="btn" disabled>Sync Strava</button>
            </div>
          </div>

          <div className="tile" style={{ padding: '36px 32px', borderStyle: 'dashed', background: 'transparent', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 10 }}>
            <span className="chip chip--corporate" style={{ alignSelf: 'flex-start' }}>M2 · Strava</span>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 38, textTransform: 'uppercase', letterSpacing: '-.01em', lineHeight: 1 }}>
              Connect Strava to populate
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-t2)', maxWidth: 720, lineHeight: 1.55 }}>
              OAuth on the laptop, refresh-token stored locally. Every Strava run pulls in with route map, splits, HR series, cadence, and elevation — the same shape that drives race-detail pages. PRs flag automatically across distance buckets (1mi / 5K / 10K / Half / Marathon).
            </div>
          </div>

          <SectionHeader title="Races on the books" sub={`${past.length} completed`} />
          {past.length === 0 ? (
            <div className="tile" style={{ padding: '36px 32px', textAlign: 'center', borderStyle: 'dashed', background: 'transparent' }}>
              <div className="tile-sub" style={{ marginBottom: 10 }}>No races yet</div>
              <div style={{ fontSize: 14, color: 'var(--color-t2)', marginBottom: 18 }}>Add a race + drop a GPX to start the log.</div>
              <Link href="/races/new" className="btn btn--primary">+ Add race</Link>
            </div>
          ) : (
            <div className="tile" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--color-t3)', fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>
                    <th style={{ textAlign: 'left', padding: '12px 18px', width: 100 }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '12px 0' }}>Race</th>
                    <th style={{ textAlign: 'right', padding: '12px 18px', width: 100 }}>Distance</th>
                    <th style={{ textAlign: 'right', padding: '12px 18px', width: 110 }}>Goal</th>
                    <th style={{ textAlign: 'right', padding: '12px 18px', width: 110 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map(r => (
                    <tr key={r.slug} style={{ borderTop: '1px solid var(--color-l4)' }}>
                      <td style={{ padding: '14px 18px', fontFamily: 'var(--font-data)', color: 'var(--color-t2)', fontWeight: 700, fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase' }}>
                        {formatShort(r.meta.date)}
                      </td>
                      <td style={{ padding: '14px 0' }}>
                        <Link href={`/races/${r.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, textTransform: 'uppercase', letterSpacing: '-.005em', color: 'var(--color-t0)' }}>{r.meta.name}</div>
                        </Link>
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {r.meta.distanceMi.toFixed(1)} mi
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums' }}>
                        {r.meta.goalDisplay}
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        <span className="chip">RESULT PENDING</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
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
