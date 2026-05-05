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

interface AggregatedBest {
  label: string;
  distMi: number;
  bestS: number | null;
  elapsedDisplay: string;
  activityId: number | null;
  activityName: string | null;
  date: string | null;
  isPR: boolean;
}
import { formatShort } from '../../lib/dates';

export default function LogPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [races, setRaces] = useState<SavedRace[] | null>(null);
  const [stravaBests, setStravaBests] = useState<AggregatedBest[] | null>(null);
  const { activities, error, refetch } = useActivities();

  useEffect(() => {
    let cancelled = false;
    setNow(new Date());
    (async () => {
      const rs = await listRaces();
      if (!cancelled) setRaces(rs);
      // Trigger a sync so race rows reflect the latest Strava finish times.
      await autoSyncStrava();
      // Pull aggregated best_efforts (server-side: fetches detail for
      // race-like activities that don't have it yet, caches results).
      // Hits Strava up to 8x per call so this fills in over a couple
      // of page loads.
      try {
        const res = await fetch('/api/strava/bests', { cache: 'no-store' });
        const json = await res.json() as { bests: AggregatedBest[] };
        if (!cancelled) setStravaBests(json.bests ?? null);
      } catch (e) {
        console.warn('Failed to fetch Strava bests:', e);
      }
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
  // PRs: prefer Strava's own best_efforts when we've got it (catches a
  // 5:27 mile inside a half-marathon race). Fall back to naïve "fastest
  // whole run near this distance" buckets per-label when best_efforts
  // hasn't loaded yet OR Strava reports no best_effort for that bucket.
  const naive = naivePRs(runs);
  const prs = naive.map(n => {
    const strava = stravaBests?.find(s => s.label === n.label);
    if (strava && strava.bestS != null) return strava;
    return n;
  });
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
    <div style={{
      padding: '24px 28px',
      borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(243,173,59,.10) 0%, rgba(243,173,59,.02) 50%, var(--color-l1) 100%)',
      border: '1px solid rgba(243,173,59,.28)',
      display: 'flex', flexDirection: 'column', gap: 18,
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, textTransform: 'uppercase',
          letterSpacing: '-.005em', color: 'var(--color-t0)',
        }}>
          ★ Your fastest times
        </div>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)' }}>
          {have.length} OF {prs.length}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`, gap: 10 }}>
        {prs.map(p => {
          const has = p.bestS != null && p.activityId && p.date;
          // PRs get a stronger medal treatment; missing buckets stay quiet.
          const cardStyle: React.CSSProperties = has
            ? {
                padding: '18px 18px 16px',
                background: 'linear-gradient(180deg, rgba(243,173,59,.10) 0%, var(--color-l2) 100%)',
                border: '1px solid rgba(243,173,59,.35)',
                borderRadius: 10,
                position: 'relative',
                overflow: 'hidden',
                cursor: 'pointer',
                textDecoration: 'none', color: 'inherit',
                display: 'flex', flexDirection: 'column', gap: 8,
                minHeight: 110,
              }
            : {
                padding: '18px 18px 16px',
                background: 'transparent',
                border: '1px dashed var(--color-l4)',
                borderRadius: 10,
                display: 'flex', flexDirection: 'column', gap: 8,
                minHeight: 110,
                opacity: 0.55,
              };
          const inner = (
            <>
              {/* Subtle gold accent stripe at the top of each PR card */}
              {has && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, var(--color-attention), transparent)' }} />}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{
                  fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.6px',
                  textTransform: 'uppercase', color: has ? 'var(--color-attention)' : 'var(--color-t3)',
                }}>{p.label}</div>
                {has && <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-attention)' }}>★</span>}
              </div>
              <div style={{
                fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32,
                color: has ? 'var(--color-t0)' : 'var(--color-t3)',
                letterSpacing: '-.015em', lineHeight: 1, fontVariantNumeric: 'tabular-nums',
              }}>
                {has ? fmtT(p.bestS!) : '—'}
              </div>
              {has && (
                <div style={{
                  fontFamily: 'var(--font-data)', fontSize: 9.5, color: 'var(--color-t3)',
                  fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', marginTop: 'auto',
                }}>
                  {formatShort(p.date!)}
                </div>
              )}
            </>
          );
          return has
            ? <Link key={p.label} href={`/runs/${p.activityId}`} style={cardStyle}>{inner}</Link>
            : <div key={p.label} style={cardStyle}>{inner}</div>;
        })}
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
              <th style={{ textAlign: 'right', padding: '12px 14px', width: 86 }}>Distance</th>
              <th style={{ textAlign: 'right', padding: '12px 14px', width: 80 }}>Pace</th>
              <th style={{ textAlign: 'right', padding: '12px 14px', width: 70 }}>HR</th>
              <th style={{ textAlign: 'right', padding: '12px 14px', width: 90 }}>Elev</th>
              <th style={{ textAlign: 'right', padding: '12px 14px', width: 70 }}>Suffer</th>
              <th style={{ textAlign: 'right', padding: '12px 14px', width: 90 }}>Goal</th>
              <th style={{ textAlign: 'right', padding: '12px 14px', width: 96 }}>Finish</th>
              <th style={{ textAlign: 'right', padding: '12px 18px', width: 80 }}>vs</th>
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

/* ── Cell helpers ──────────────────────────────────────────── */
function NumCell({ value, color = 'var(--color-t1)', muted = false, bold = false }: { value: React.ReactNode; color?: string; muted?: boolean; bold?: boolean }) {
  return (
    <td style={{
      padding: '14px 14px', textAlign: 'right',
      fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums',
      color: muted ? 'var(--color-t3)' : color,
      fontWeight: bold ? 700 : 500,
      whiteSpace: 'nowrap',
    }}>{value}</td>
  );
}

function fmtPace(s: number): string {
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
          {result.achievementCount != null && result.achievementCount > 0 && (
            <span className="chip" style={{ fontSize: 8 }}>{result.achievementCount}× ACHIEVE</span>
          )}
        </div>
      </td>
      <NumCell bold value={`${race.meta.distanceMi.toFixed(1)} mi`} />
      <NumCell value={result.paceDisplay ? `${result.paceDisplay}/mi` : '—'} muted={!result.paceDisplay} />
      <NumCell value={result.avgHr != null ? `${Math.round(result.avgHr)}` : '—'} muted={result.avgHr == null} />
      <NumCell value={result.totalGainFt != null ? `+${result.totalGainFt.toLocaleString()} ft` : '—'} muted={result.totalGainFt == null} />
      <NumCell value={result.sufferScore != null ? `${result.sufferScore}` : '—'} muted={result.sufferScore == null} color={result.sufferScore != null && result.sufferScore >= 250 ? 'var(--color-warning)' : 'var(--color-t1)'} />
      <NumCell value={race.meta.goalDisplay} muted />
      <NumCell bold color="var(--color-t0)" value={result.finishDisplay} />
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
            {/* Month header — bottom border removed; the table tile starts
                with no top border so they don't double up. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 4px 8px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, textTransform: 'uppercase', letterSpacing: '-.005em', color: 'var(--color-t1)' }}>{g.label}</div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-t3)' }}>{g.runs.length} RUNS · {monthMi.toFixed(1)} MI</div>
            </div>
            <div className="tile" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {g.runs.map((r, idx) => (
                    <tr key={r.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--color-l4)' }}>
                      <td style={{ padding: '12px 16px', width: 90, whiteSpace: 'nowrap', fontFamily: 'var(--font-data)', color: 'var(--color-t2)', fontWeight: 700, fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase' }}>
                        {formatShort(r.date)}
                      </td>
                      <td style={{ padding: '12px 0' }}>
                        <Link href={`/runs/${r.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--color-t0)', letterSpacing: '-.005em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>{r.name}</div>
                        </Link>
                        {(r.workoutType === 1 || r.achievementCount > 0) && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                            {r.workoutType === 1 && <span className="chip chip--attention" style={{ fontSize: 8 }}>RACE</span>}
                            {r.achievementCount > 0 && <span className="chip" style={{ fontSize: 8 }}>{r.achievementCount}× ACHIEVE</span>}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', width: 90, textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'var(--font-data)', color: 'var(--color-t1)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {r.distanceMi.toFixed(1)} mi
                      </td>
                      <td style={{ padding: '12px 18px', width: 100, textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'var(--font-data)', color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {fmtT(r.movingTimeS)}
                      </td>
                    </tr>
                  ))}
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
