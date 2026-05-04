'use client';

/**
 * /log — every Strava run YTD, grouped by month with PR detection,
 * weekly mileage rollup, and links to per-run detail pages.
 *
 * Reads from the shared client cache (lib/strava-activities.ts) which
 * pulls /api/strava/activities. Empty state shows a "Connect Strava"
 * banner with a deep-link to /api/strava/connect when the refresh
 * token isn't set yet.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Caption, Nav } from '../../components/nav';
import { listRaces, type SavedRace } from '../../lib/storage';
import { autoSyncStrava } from '../../lib/strava-auto';
import { useActivities, onlyRuns, type NormalizedActivity } from '../../lib/strava-activities';
import { rollupYear, naivePRs, isProbablyRace } from '../../lib/strava-stats';
import { formatShort } from '../../lib/dates';

export default function LogPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [races, setRaces] = useState<SavedRace[] | null>(null);
  const { activities, error, refetch } = useActivities();

  useEffect(() => {
    let cancelled = false;
    setNow(new Date());
    (async () => {
      const rs = await listRaces();
      if (!cancelled) setRaces(rs);
      // Trigger a sync so race rows reflect the latest Strava finish times.
      await autoSyncStrava();
    })();
    return () => { cancelled = true; };
  }, []);

  if (now === null || races === null || activities === null) {
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

  const runs = onlyRuns(activities);
  const sortedRuns = runs.slice().sort((a, b) => b.startLocal.localeCompare(a.startLocal));
  const roll = rollupYear(runs);
  const prs = naivePRs(runs);
  const noStrava = error?.includes('STRAVA_REFRESH_TOKEN') || (runs.length === 0 && error);

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
                {runs.length === 0
                  ? <>No runs yet. Connect Strava and they&apos;ll auto-import.</>
                  : <><b>{roll.totalRuns} runs · {roll.totalMiles.toFixed(1)} mi</b> this year · {roll.totalElevFt.toLocaleString()} ft climbed</>}
              </div>
            </div>
            <div className="page-actions">
              <button className="btn" onClick={() => refetch()}>↻ Refresh</button>
            </div>
          </div>

          {noStrava && <ConnectStravaBanner />}

          {/* Naïve PR shelf — ignores Strava best_efforts (which would
              require N detail fetches) in favor of "best whole run near
              that distance." Good enough as a top-level summary. */}
          {runs.length > 0 && <PRShelf prs={prs} />}

          {/* Race results — merge the two sources so every race YTD
              shows up: (a) saved races with plans + recorded results,
              (b) Strava activities flagged workout_type=1 that don\'t
              correspond to a saved race. Dedup is by stravaActivityId. */}
          {(() => {
            const savedActIds = new Set(
              races.filter(r => r.actualResult?.stravaActivityId).map(r => r.actualResult!.stravaActivityId!),
            );
            const savedRows: RaceRow[] = races
              .filter(r => r.actualResult)
              .map(r => ({ kind: 'saved', race: r, date: r.meta.date }));
            const stravaOnly: RaceRow[] = runs
              .filter(r => isProbablyRace(r) && !savedActIds.has(r.id))
              .map(a => ({ kind: 'strava', activity: a, date: a.date }));
            const allRows = [...savedRows, ...stravaOnly].sort((a, b) => b.date.localeCompare(a.date));
            return allRows.length > 0 ? <RacesShelf rows={allRows} /> : null;
          })()}

          {sortedRuns.length > 0 && <RunFeed runs={sortedRuns} />}

        </div>
      </div>
    </>
  );
}

function ConnectStravaBanner() {
  return (
    <div className="tile" style={{ padding: '36px 32px', borderStyle: 'dashed', background: 'transparent', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 10 }}>
      <span className="chip chip--corporate" style={{ alignSelf: 'flex-start' }}>STRAVA</span>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 38, textTransform: 'uppercase', letterSpacing: '-.01em', lineHeight: 1 }}>
        Connect Strava to populate
      </div>
      <div style={{ fontSize: 14, color: 'var(--color-t2)', maxWidth: 720, lineHeight: 1.55 }}>
        OAuth on the laptop, refresh-token stored server-side. Every Strava run pulls in with route map, splits, HR series, cadence, and elevation — the same shape that drives race-detail pages. PRs flag automatically.
      </div>
      <a href="/api/strava/connect" className="btn btn--primary" style={{ alignSelf: 'flex-start', marginTop: 8 }}>↗ Connect Strava</a>
    </div>
  );
}

function PRShelf({ prs }: { prs: ReturnType<typeof naivePRs> }) {
  const have = prs.filter(p => p.bestS != null);
  if (have.length === 0) return null;
  return (
    <div className="tile" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 10 }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">YTD bests</div>
          <div className="tile-lbl">Best run near each canonical distance</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${prs.length}, 1fr)`, gap: 14 }}>
        {prs.map(p => (
          <div key={p.label} style={{
            padding: '14px 16px',
            background: p.bestS != null ? 'var(--color-l2)' : 'transparent',
            border: '1px solid var(--color-l4)',
            borderRadius: 8,
            display: 'flex', flexDirection: 'column', gap: 6,
            opacity: p.bestS != null ? 1 : 0.5,
          }}>
            <div className="tile-sub">{p.label}</div>
            {p.bestS != null && p.activityId && p.date ? (
              <Link href={`/runs/${p.activityId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, color: 'var(--color-t0)', letterSpacing: '-.01em', lineHeight: 1 }}>
                  {fmtT(p.bestS)}
                </div>
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, color: 'var(--color-t3)', fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', marginTop: 6 }}>
                  {formatShort(p.date)}
                </div>
              </Link>
            ) : (
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, color: 'var(--color-t3)', lineHeight: 1 }}>—</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A unified row in the race-results shelf. Either a saved race
 *  (has plan + goal + delta-vs-goal) or a Strava activity flagged
 *  workout_type=1 with no saved plan (just date / distance / finish). */
type RaceRow =
  | { kind: 'saved';  race: SavedRace; date: string }
  | { kind: 'strava'; activity: NormalizedActivity; date: string };

function RacesShelf({ rows }: { rows: RaceRow[] }) {
  const total = rows.length;
  const totalMi = rows.reduce((s, r) => s + (r.kind === 'saved' ? r.race.meta.distanceMi : r.activity.distanceMi), 0);
  return (
    <>
      <SectionHeader title="Race results" sub={`${total} race${total === 1 ? '' : 's'} this year · ${totalMi.toFixed(1)} race miles`} />
      <div className="tile" style={{ padding: 0, overflow: 'hidden', marginBottom: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--color-t3)', fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>
              <th style={{ textAlign: 'left', padding: '12px 18px', width: 100 }}>Date</th>
              <th style={{ textAlign: 'left', padding: '12px 0' }}>Race</th>
              <th style={{ textAlign: 'right', padding: '12px 18px', width: 90 }}>Distance</th>
              <th style={{ textAlign: 'right', padding: '12px 18px', width: 100 }}>Goal</th>
              <th style={{ textAlign: 'right', padding: '12px 18px', width: 100 }}>Finish</th>
              <th style={{ textAlign: 'right', padding: '12px 18px', width: 90 }}>vs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => r.kind === 'saved' ? <SavedRaceRow key={`s-${r.race.slug}`} race={r.race} /> : <StravaRaceRow key={`a-${r.activity.id}`} activity={r.activity} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SavedRaceRow({ race }: { race: SavedRace }) {
  const result = race.actualResult!;
  const goalS = parseGoal(race.meta.goalDisplay);
  const delta = goalS != null ? result.finishS - goalS : null;
  return (
    <tr style={{ borderTop: '1px solid var(--color-l4)' }}>
      <td style={{ padding: '14px 18px', fontFamily: 'var(--font-data)', color: 'var(--color-t2)', fontWeight: 700, fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase' }}>
        {formatShort(race.meta.date)}
      </td>
      <td style={{ padding: '14px 0' }}>
        <Link href={`/races/${race.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, textTransform: 'uppercase', letterSpacing: '-.005em', color: 'var(--color-t0)' }}>{race.meta.name}</div>
        </Link>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {result.isPR && <span className="chip chip--attention" style={{ fontSize: 8 }}>PR</span>}
          <span className="chip" style={{ fontSize: 8, background: 'rgba(0,143,236,.12)', color: 'var(--color-corporate)', borderColor: 'rgba(0,143,236,.3)' }}>PLAN</span>
        </div>
      </td>
      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
        {race.meta.distanceMi.toFixed(1)} mi
      </td>
      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t2)', fontVariantNumeric: 'tabular-nums' }}>
        {race.meta.goalDisplay}
      </td>
      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
        {result.finishDisplay}
      </td>
      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: delta == null ? 'var(--color-t3)' : (delta <= 0 ? 'var(--color-success)' : 'var(--color-warning)') }}>
        {delta == null ? '—' : (delta === 0 ? '±0' : (delta > 0 ? '+' : '−') + fmtT(Math.abs(delta)))}
      </td>
    </tr>
  );
}

function StravaRaceRow({ activity }: { activity: NormalizedActivity }) {
  return (
    <tr style={{ borderTop: '1px solid var(--color-l4)' }}>
      <td style={{ padding: '14px 18px', fontFamily: 'var(--font-data)', color: 'var(--color-t2)', fontWeight: 700, fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase' }}>
        {formatShort(activity.date)}
      </td>
      <td style={{ padding: '14px 0' }}>
        <Link href={`/runs/${activity.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, textTransform: 'uppercase', letterSpacing: '-.005em', color: 'var(--color-t0)' }}>{activity.name}</div>
        </Link>
        {activity.achievementCount > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <span className="chip chip--attention" style={{ fontSize: 8 }}>{activity.achievementCount}× ACHIEVE</span>
          </div>
        )}
      </td>
      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
        {activity.distanceMi.toFixed(1)} mi
      </td>
      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t3)', fontVariantNumeric: 'tabular-nums' }}>
        —
      </td>
      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
        {fmtT(activity.movingTimeS)}
      </td>
      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t3)', fontVariantNumeric: 'tabular-nums' }}>
        —
      </td>
    </tr>
  );
}

function RunFeed({ runs }: { runs: NormalizedActivity[] }) {
  // Group by year-month for headers.
  const groups: Array<{ key: string; label: string; runs: NormalizedActivity[] }> = [];
  for (const r of runs) {
    const key = r.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (!last || last.key !== key) {
      const monthLabel = new Date(r.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      groups.push({ key, label: monthLabel, runs: [r] });
    } else {
      last.runs.push(r);
    }
  }

  return (
    <>
      <SectionHeader title="Runs" sub={`${runs.length} runs YTD`} />
      {groups.map(g => {
        const monthMi = g.runs.reduce((s, r) => s + r.distanceMi, 0);
        return (
          <div key={g.key} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 4px', borderBottom: '1px solid var(--color-l4)', marginBottom: 6 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, textTransform: 'uppercase', letterSpacing: '-.005em', color: 'var(--color-t1)' }}>{g.label}</div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)' }}>{g.runs.length} RUNS · {monthMi.toFixed(1)} MI</div>
            </div>
            <div className="tile" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--color-t3)', fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>
                    <th style={{ textAlign: 'left', padding: '10px 16px', width: 90 }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '10px 0' }}>Run</th>
                    <th style={{ textAlign: 'right', padding: '10px 14px', width: 80 }}>Dist</th>
                    <th style={{ textAlign: 'right', padding: '10px 14px', width: 80 }}>Pace</th>
                    <th style={{ textAlign: 'right', padding: '10px 14px', width: 80 }}>Time</th>
                    <th style={{ textAlign: 'right', padding: '10px 14px', width: 60 }}>HR</th>
                    <th style={{ textAlign: 'right', padding: '10px 14px', width: 80 }}>Elev</th>
                  </tr>
                </thead>
                <tbody>
                  {g.runs.map(r => {
                    const m = Math.floor(r.paceSPerMi / 60);
                    const s = r.paceSPerMi % 60;
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--color-l4)' }}>
                        <td style={{ padding: '12px 16px', fontFamily: 'var(--font-data)', color: 'var(--color-t2)', fontWeight: 700, fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase' }}>
                          {formatShort(r.date)}
                        </td>
                        <td style={{ padding: '12px 0' }}>
                          <Link href={`/runs/${r.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--color-t0)', letterSpacing: '-.005em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{r.name}</div>
                          </Link>
                          {(r.workoutType === 1 || r.achievementCount > 0) && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              {r.workoutType === 1 && <span className="chip chip--attention" style={{ fontSize: 8 }}>RACE</span>}
                              {r.achievementCount > 0 && <span className="chip" style={{ fontSize: 8 }}>{r.achievementCount}× ACHIEVE</span>}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                          {r.distanceMi.toFixed(1)}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums' }}>
                          {m}:{String(s).padStart(2, '0')}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                          {fmtT(r.movingTimeS)}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t2)', fontVariantNumeric: 'tabular-nums' }}>
                          {r.avgHr ? Math.round(r.avgHr) : '—'}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--color-t2)', fontVariantNumeric: 'tabular-nums' }}>
                          {r.elevGainFt > 0 ? '+' : ''}{r.elevGainFt}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

function fmtT(s: number): string {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function parseGoal(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
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
