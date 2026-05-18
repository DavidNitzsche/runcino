/**
 * /races — fresh React port of designs/races-v4.html.
 *
 * Sections:
 *   1. Coach strip — race calendar narrative + VDOT anchor card
 *   2. A-race hero — AFC Half wordmark + 3 stats + Path to the Line
 *      + Coach's next move + coach take
 *   3. Upcoming Races — horizontal timeline (race stations)
 *   4. Recent Races — past finishes
 *   5. PRs by distance — 6 PR cards
 *
 * Seed data mirrors designs/races-v4.html for the legacy owner. Real
 * race CRUD wiring is a follow-up.
 */

import { Topbar } from '@/app/components';
import { ConnectBannerIsland } from '../training/ConnectBannerIsland';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';
import './races-v4.css';

interface UpcomingRace {
  name: string;
  date: string;
  daysAway: number;
  distanceLabel: string;
  goal: string;
  priority: 'A' | 'B' | 'C';
  slug?: string;
}
interface RecentRace {
  date: string;
  name: string;
  distanceLabel: string;
  finish: string;
  pace: string;
  priority: 'A' | 'B' | 'C';
  note?: string;
  currentAnchor?: boolean;
}

function fmtMonthDay(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : ''));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
function fmtTime(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
function fmtPace(sPerMi: number): string {
  if (!sPerMi || sPerMi <= 0) return '—';
  const m = Math.floor(sPerMi / 60);
  const s = sPerMi % 60;
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

export default async function RacesPage() {
  const auth = await requireActiveUser();

  const todayMs = Date.now();

  // ── 1. Upcoming + saved races from the `races` table ──
  interface RaceRow { slug: string; meta: { name: string; date: string; distanceMi: number; goalDisplay?: string; priority?: 'A'|'B'|'C' }; actual_result: { finishS?: number; paceSPerMi?: number } | null }
  const savedRaces = await query<RaceRow>(
    `SELECT slug, meta, actual_result
       FROM races
      WHERE user_uuid = $1 OR user_uuid IS NULL`,
    [auth.id],
  );

  const upcoming: UpcomingRace[] = savedRaces
    .filter((r) => Date.parse(r.meta.date) >= todayMs)
    .sort((a, b) => Date.parse(a.meta.date) - Date.parse(b.meta.date))
    .map((r) => {
      const daysAway = Math.max(0, Math.round((Date.parse(r.meta.date) - todayMs) / 86400000));
      const dist = r.meta.distanceMi;
      const distLabel = dist >= 26.1 ? `Marathon · ${dist.toFixed(2)} mi`
        : dist >= 13.0 ? `Half Marathon · ${dist.toFixed(2)} mi`
        : dist >= 6.1 ? `10K · ${dist.toFixed(2)} mi`
        : dist >= 3.0 ? `5K · ${dist.toFixed(2)} mi`
        : `${dist.toFixed(1)} mi`;
      return {
        name: r.meta.name,
        date: fmtMonthDay(r.meta.date),
        daysAway,
        distanceLabel: distLabel,
        goal: r.meta.goalDisplay || '—',
        priority: r.meta.priority ?? 'A',
        slug: r.slug,
      };
    });

  // ── 2. Recent races: union of races-table finishes + strava-tagged Race activities ──
  interface RaceActivityRow { id: string; data: { name?: string; startLocal?: string; date?: string; distanceMi?: number; movingTimeS?: number; paceSPerMi?: number; workoutType?: number; canonicalFinishS?: number | null; canonicalDistanceMi?: number | null; canonicalLabel?: string | null } }
  const raceActivities = await query<RaceActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'workoutType')::int = 1
      ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) DESC
      LIMIT 50`,
    [auth.id],
  );

  const recent: RecentRace[] = [
    // First: races-table entries that have an actualResult (the user logged a finish)
    ...savedRaces
      .filter((r) => r.actual_result && Date.parse(r.meta.date) < todayMs)
      .map((r): RecentRace => {
        const dist = r.meta.distanceMi;
        const finishS = Number(r.actual_result?.finishS) || 0;
        const paceSec = Number(r.actual_result?.paceSPerMi) || (finishS > 0 && dist > 0 ? Math.round(finishS / dist) : 0);
        const distLabel = dist >= 26.1 ? 'Marathon'
          : dist >= 13.0 ? 'Half Marathon'
          : dist >= 6.1 ? '10K'
          : dist >= 3.0 ? '5K'
          : `${dist.toFixed(1)} mi`;
        return {
          date: r.meta.date,
          name: r.meta.name,
          distanceLabel: distLabel,
          finish: fmtTime(finishS),
          pace: fmtPace(paceSec),
          priority: r.meta.priority ?? 'A',
        };
      }),
    // Then: Strava activities tagged as Race that aren't already in saved races (best-effort dedupe by date)
    ...raceActivities.map((a): RecentRace => {
      const dist = Number(a.data.distanceMi) || 0;
      const finishS = Number(a.data.canonicalFinishS ?? a.data.movingTimeS) || 0;
      const canonMi = Number(a.data.canonicalDistanceMi) || dist;
      const paceSec = canonMi > 0 ? Math.round(finishS / canonMi) : 0;
      const distLabel = a.data.canonicalLabel
        || (dist >= 26.1 ? 'Marathon'
          : dist >= 13.0 ? 'Half Marathon'
          : dist >= 6.1 ? '10K'
          : dist >= 3.0 ? '5K'
          : `${dist.toFixed(1)} mi`);
      return {
        date: a.data.date || (a.data.startLocal || '').slice(0, 10),
        name: a.data.name || 'Race',
        distanceLabel: distLabel,
        finish: fmtTime(finishS),
        pace: fmtPace(paceSec),
        priority: 'A',
      };
    }),
  ]
    // De-duplicate: if the same date appears in saved races + activities, keep the saved-race entry
    .filter((r, i, arr) => arr.findIndex((x) => x.date === r.date) === i)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 12);

  const aRace = upcoming.find((r) => r.priority === 'A');

  // ── 3. PRs by canonical distance from strava canonical bests ──
  interface BestRow { canonical_label: string; finish_s: number; date: string }
  const bestRows = await query<BestRow>(
    `WITH bests AS (
       SELECT data->>'canonicalLabel'                    AS canonical_label,
              (data->>'canonicalFinishS')::NUMERIC       AS finish_s,
              COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS date,
              ROW_NUMBER() OVER (PARTITION BY data->>'canonicalLabel'
                                 ORDER BY (data->>'canonicalFinishS')::NUMERIC ASC) AS rn
         FROM strava_activities
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND data->>'canonicalLabel' IS NOT NULL
          AND (data->>'canonicalFinishS')::NUMERIC > 0
     )
     SELECT canonical_label, finish_s::int AS finish_s, date
       FROM bests WHERE rn = 1
       ORDER BY canonical_label`,
    [auth.id],
  );
  const PRs: Array<{ distance: string; time: string; when: string; current?: boolean }> = bestRows.map((b) => ({
    distance: b.canonical_label === 'Half' ? '13.1 (HM)'
      : b.canonical_label === 'Marathon' ? '26.2'
      : b.canonical_label,
    time: fmtTime(b.finish_s),
    when: b.date ? fmtMonthDay(b.date) : '',
  }));

  return (
    <div className="races-v4-page">
      <Topbar activeTab="races" showAdmin={auth.is_admin} />
      <ConnectBannerIsland />

      <div className="page">

        {/* ── COACH STRIP ── */}
        <div className="coach-strip">
          <div className="coach-left">
            <div className="coach-label">
              <span className="dot-green"></span>
              COACH · RACE CALENDAR · WHAT&apos;S NEXT
            </div>
            <p className="coach-briefing">
              {aRace ? (
                <>
                  <strong>{aRace.name} is {aRace.daysAway} days out</strong> — your A-race for this cycle and the only one that counts on the fitness ledger. You&apos;re in week 1 of 14, banking base miles. First half-pace work lands at week 5 — that&apos;s where the <strong>{aRace.goal} starts to feel real</strong>. No tune-up B-race on the calendar yet; we&apos;ll slot one around week 10 if you want a dress rehearsal.
                </>
              ) : (
                <>No upcoming races yet. Add your A-race in onboarding or from this page to start the race-pointed plan.</>
              )}
            </p>
          </div>

          <div className="vdot-anchor-card">
            <div className="vdot-anchor-label">Your VDOT</div>
            <div className="vdot-anchor-row">
              <span className="vdot-anchor-num" style={{ color: 'rgba(13,15,18,.32)' }}>—</span>
            </div>
            <div className="vdot-anchor-fresh">
              <span className="vdot-anchor-fresh-dot" style={{ background: 'rgba(13,15,18,.25)' }}></span>
              <span className="vdot-anchor-fresh-text" style={{ color: 'rgba(13,15,18,.55)' }}>
                No data · log a race to set
              </span>
            </div>
          </div>
        </div>

        {/* ── A-RACE HERO ── */}
        {aRace && (() => {
          // Build a short Bebas title from the race name initials when 3+ words,
          // otherwise just use the name. AFC HALF for "Americas Finest City" etc.
          const words = aRace.name.split(/\s+/);
          const titleText = words.length >= 3
            ? words.map((w) => w[0]).join('').toUpperCase().slice(0, 4)
            : aRace.name.toUpperCase();
          const distSub = aRace.distanceLabel.includes('Half') ? 'HALF'
            : aRace.distanceLabel.includes('Marathon') ? 'MARATHON'
            : aRace.distanceLabel.includes('10K') ? '10K'
            : aRace.distanceLabel.includes('5K') ? '5K' : '';
          const HeroWrap = aRace.slug
            ? ({ children }: { children: React.ReactNode }) => <a href={`/races/${aRace.slug}`} className="a-race-card" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>{children}</a>
            : ({ children }: { children: React.ReactNode }) => <div className="a-race-card">{children}</div>;
          return (
          <HeroWrap>
            <div className="a-race-left">
              <div className="a-race-eyebrow">A-RACE · GOAL TIME {aRace.goal}{aRace.slug && ' · CLICK FOR FULL PLAN'}</div>
              <div className="a-race-title">{titleText}{distSub && <><br />{distSub}</>}</div>
              <div className="a-race-sub">{aRace.name} · {aRace.date.replace(/, \d{4}$/, '')}</div>
              <p className="a-race-explainer">
                The full 14-week plan points here. Once a recent race finish is logged we&apos;ll
                show your current fitness, the gap to {aRace.goal}, and the feasibility read.
              </p>

              <div className="path-stats">
                <div className="path-stat">
                  <div className="path-stat-label">Current Fitness</div>
                  <div className="path-stat-value" style={{ color: 'rgba(13,15,18,.32)' }}>—</div>
                  <div className="path-stat-sub">No data</div>
                </div>
                <div className="path-stat">
                  <div className="path-stat-label">Gap to Goal</div>
                  <div className="path-stat-value" style={{ color: 'rgba(13,15,18,.32)' }}>—</div>
                  <div className="path-stat-sub">No data</div>
                </div>
                <div className="path-stat">
                  <div className="path-stat-label">Feasibility</div>
                  <div className="path-stat-value" style={{ color: 'rgba(13,15,18,.32)' }}>—</div>
                  <div className="path-stat-sub">No data</div>
                </div>
              </div>
            </div>

            <div className="a-race-right">
              <div>
                <div className="path-section-label">Path to the Line</div>
                <div className="path-progress">
                  <div className="path-progress-bar">
                    <div className="path-progress-fill" style={{ width: '7%' }}></div>
                  </div>
                  <div className="path-progress-meta">
                    <span><strong>Week 1</strong> of 14 · Base phase</span>
                    <span>7%</span>
                  </div>
                </div>

                <div style={{ marginTop: 28 }}>
                  <div className="path-section-label">Coach&apos;s Next Move</div>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1.55 }}>
                    Build the aerobic base for four weeks. First real threshold dose lands in
                    <strong> 24 days</strong> when the Build phase opens. That&apos;s where the half-marathon
                    pace starts to feel sustainable.
                  </p>
                </div>
              </div>

              <p className="coach-take">
                <strong>Trust the easy.</strong> The race is won in the workouts you didn&apos;t try to win.
              </p>
            </div>
          </HeroWrap>
          );
        })()}

        {/* ── UPCOMING RACES TIMELINE ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Upcoming Races</div>
            </div>
          </div>

          <div className="races-timeline">
            {upcoming.length === 0 ? (
              <div style={{ padding: '40px 28px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
                No upcoming races on the calendar.
              </div>
            ) : (
              <div className="races-timeline-track-area">
                <div className="races-timeline-track-line"></div>
                {/* "TODAY" marker at the left edge */}
                <div className="races-timeline-now">
                  <div className="races-timeline-now-dot" />
                  <div className="races-timeline-now-info">
                    <div className="races-timeline-now-label">Today</div>
                  </div>
                </div>
                {upcoming.map((race, i) => {
                  const maxDays = Math.max(...upcoming.map((r) => r.daysAway), 1);
                  const pos = (race.daysAway / maxDays) * 100;
                  const above = i % 2 === 0;
                  const isLast = i === upcoming.length - 1 && pos > 90;
                  const priorityClass =
                    race.priority === 'A' ? 'a' :
                    race.priority === 'B' ? 'b' : 'c';
                  const stationCls = [
                    'races-timeline-station',
                    above ? 'placement-above' : 'placement-below',
                    `priority-${priorityClass}`,
                    isLast ? 'is-last' : '',
                  ].filter(Boolean).join(' ');
                  const Wrapper = race.slug
                    ? ({ children }: { children: React.ReactNode }) => <a href={`/races/${race.slug}`} className={stationCls} style={{ left: `${pos}%`, textDecoration: 'none', color: 'inherit' }}>{children}</a>
                    : ({ children }: { children: React.ReactNode }) => <div className={stationCls} style={{ left: `${pos}%` }}>{children}</div>;
                  return (
                    <Wrapper key={`${race.name}-${race.date}`}>
                      <div className={`races-timeline-tag ${priorityClass}`}>{race.priority}</div>
                      <div className="races-timeline-station-info">
                        <div className="races-timeline-date">{race.date}</div>
                        <div className="races-timeline-name">{race.name}</div>
                        <div className="races-timeline-pace">{race.distanceLabel}</div>
                        <div className="races-timeline-goal">{race.goal !== '—' ? race.goal : ''}</div>
                        <div className="races-timeline-away">{race.daysAway}d away</div>
                      </div>
                    </Wrapper>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── RECENT RACES ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Recent Races</div>
            </div>
          </div>

          {recent.length === 0 ? (
            <div style={{ padding: '40px 28px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
              No past races logged. Add a recent race finish to seed your VDOT anchor.
            </div>
          ) : (
            <div className="races-recent-list">
              {recent.map((r) => (
                <div key={`${r.date}-${r.name}`} className={`races-recent-row ${r.currentAnchor ? 'is-anchor' : ''}`}>
                  <div className="races-recent-date">{r.date.slice(5).replace('-', '/')}</div>
                  <span className={`races-recent-priority p-${r.priority.toLowerCase()}`}>{r.priority}</span>
                  <div className="races-recent-info">
                    <div className="races-recent-name">{r.name}</div>
                    <div className="races-recent-meta">{r.distanceLabel}{r.note ? ` · ${r.note}` : ''}</div>
                  </div>
                  <div className="races-recent-time">{r.finish}</div>
                  <div className="races-recent-pace">{r.pace}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── PRs ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Personal Records</div>
              <div className="card-sub">Per distance · current anchor highlighted</div>
            </div>
          </div>

          {PRs.length === 0 ? (
            <div style={{ padding: '40px 28px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
              No PRs yet — log past races to populate.
            </div>
          ) : (
            <div className="races-pr-grid">
              {PRs.map((pr) => (
                <div key={pr.distance} className={`pr-cell ${pr.current ? 'is-current' : ''}`}>
                  <div className="pr-distance">{pr.distance}</div>
                  <div className="pr-time">{pr.time}</div>
                  <div className="pr-meta">{pr.when}</div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
