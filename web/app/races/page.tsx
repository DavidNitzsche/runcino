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

export default async function RacesPage() {
  const auth = await requireActiveUser();

  // No more seeded mockup data — every section starts empty until the
  // runner adds real races. PRs come from Strava activity history once
  // we wire the best_efforts lookup.
  const upcoming: UpcomingRace[] = [];
  const recent: RecentRace[] = [];
  const aRace = upcoming.find((r) => r.priority === 'A');
  const PRs: Array<{ distance: string; time: string; when: string; current?: boolean }> = [];

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
        {aRace && (
          <div className="a-race-card">
            <div className="a-race-left">
              <div className="a-race-eyebrow">A-RACE · GOAL TIME {aRace.goal}</div>
              <div className="a-race-title">AFC<br />HALF</div>
              <div className="a-race-sub">{aRace.name} · {aRace.date.replace(', 2026', '')}</div>
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
          </div>
        )}

        {/* ── UPCOMING RACES TIMELINE ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Upcoming Races</div>
            </div>
          </div>

          <div className="races-timeline">
            <div className="races-timeline-track-area">
              <div className="races-timeline-track-line"></div>
              {upcoming.length === 0 ? (
                <div style={{ padding: '40px 28px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
                  No upcoming races on the calendar.
                </div>
              ) : (
                upcoming.map((race, i) => {
                  const maxDays = Math.max(...upcoming.map((r) => r.daysAway));
                  const pos = (race.daysAway / maxDays) * 100;
                  const above = i % 2 === 0;
                  return (
                    <div key={race.name} className={`race-station ${above ? 'above' : 'below'} ${race.priority === 'A' ? 'a-race' : race.priority === 'B' ? 'b-race' : 'c-race'}`} style={{ left: `${pos}%` }}>
                      <div className="race-station-dot"></div>
                      <div className="race-station-label">
                        <div className="race-station-priority">{race.priority}</div>
                        <div className="race-station-name">{race.name}</div>
                        <div className="race-station-meta">{race.date}</div>
                        <div className="race-station-meta">{race.distanceLabel}</div>
                        <div className="race-station-meta">Goal: {race.goal} · {race.daysAway}d away</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
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
            <div>
              {recent.map((r) => (
                <div key={`${r.date}-${r.name}`} className={`recent-row ${r.currentAnchor ? 'current-anchor' : ''}`}>
                  <div className="recent-date">{r.date.slice(5).replace('-', '/')}</div>
                  <span className={`recent-priority ${r.priority === 'A' ? 'a-race' : r.priority === 'B' ? 'b-race' : 'c-race'}`}>{r.priority}</span>
                  <div>
                    <div className="recent-name">{r.name}</div>
                    <div className="recent-meta">{r.distanceLabel}{r.note ? ` · ${r.note}` : ''}</div>
                  </div>
                  <div className="recent-time">{r.finish}</div>
                  <div className="recent-pace">{r.pace}</div>
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

          <div className="pr-grid">
            {PRs.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '40px 28px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
                No PRs yet — log past races to populate.
              </div>
            ) : (
              PRs.map((pr) => (
                <div key={pr.distance} className={`pr-card ${pr.current ? 'current' : ''}`}>
                  <div className="pr-distance">{pr.distance}</div>
                  <div className="pr-time">{pr.time}</div>
                  <div className="pr-when">{pr.when}</div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
