'use client';

import type { FaffSeed } from '../types';
import { EFF } from '../constants';

/**
 * Weekly check-in overlay. Pulls the previous calendar week's structure
 * + Faff's goal-race context from the seed so the recap reflects the
 * real plan, not a hard-coded CIM teaser.
 */
export function WeeklyCheckIn({ open, onClose, seed }: { open: boolean; onClose: () => void; seed: FaffSeed }) {
  // Use last week's totals from the volume strip + this week's plan
  // for the "NEXT WEEK" hero. Best-effort; we degrade gracefully.
  const prevWeekMi = seed.volumeBars.length >= 2 ? seed.volumeBars[seed.volumeBars.length - 2].mi : 0;
  const thisWeekMi = seed.thisWeekMiles;
  const delta = thisWeekMi - prevWeekMi;
  const phaseFull = seed.goalRace?.phaseLabel ?? 'Active block';
  const phaseTop = phaseFull.split(' · ')[0] ?? 'Active block';
  const max = Math.max(1, ...seed.week.map(d => parseFloat(d.dist) || 0));
  const sessionsDone = seed.week.filter(d => d.done).length;
  const sessionsPlanned = seed.week.filter(d => d.type !== 'rest').length;

  return (
    <div className={`ov${open ? ' open' : ''}`}>
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard weekci">
        <div className="ovx" onClick={onClose} role="button" tabIndex={0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <div className="wc-body">
          <div className="wc-tag">{phaseTop.toUpperCase()}</div>
          <div className="wc-h">{deltaHeadline(delta)}</div>
          <div className="wc-sub">{seed.topDate}</div>
          <div className="wc-stats">
            <div><div className="v">{prevWeekMi}<small> mi</small></div><div className="k">LAST WEEK</div></div>
            <div><div className="v">{sessionsDone}<small>/{sessionsPlanned}</small></div><div className="k">SESSIONS</div></div>
            <div><div className={`v ${delta >= 0 ? 'up' : ''}`}>{delta >= 0 ? '+' : ''}{delta}<small> mi</small></div><div className="k">VS LAST WK</div></div>
          </div>
          <div className="wc-lbl">THIS WEEK</div>
          <div className="wc-week">
            {seed.week.map((d, i) => {
              const dist = parseFloat(d.dist) || 0;
              const h = dist > 0 ? Math.round((dist / max) * 100) : 6;
              const c = d.type === 'rest' ? null : EFF[d.type].dot;
              return (
                <div key={i} className={`wc-day${d.done ? '' : (d.type === 'rest' ? '' : ' miss')}`}>
                  {dist > 0 ? (
                    <div className="bar" style={{ height: `${h}%`, background: c ?? 'transparent' }}>
                      {d.done && (
                        <svg className="chk" viewBox="0 0 24 24" fill="none" stroke="#9af0bf" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      )}
                    </div>
                  ) : (
                    <div className="bar" style={{ height: '6%', background: 'rgba(255,255,255,.12)' }} />
                  )}
                  <div className="dn">{d.dw[0]}</div>
                  <div className="dm">{dist > 0 ? `${dist} ${d.type}` : 'rest'}</div>
                </div>
              );
            })}
          </div>
          <div className="wc-lbl">FAFF SAYS</div>
          <div className="wc-coach">
            <span className="ct">COACH</span>
            <span className="cx">{seed.readiness.coach}</span>
          </div>
          {seed.goalRace && (
            <>
              <div className="wc-lbl">RACE WATCH</div>
              <div className="wc-next">
                <div className="wc-nexthero">{seed.goalRace.name}<small>{seed.goalRace.location ? `${seed.goalRace.location} · ` : ''}{formatDate(seed.goalRace.date)}</small></div>
                <div className="wc-nrow"><span className="nk">Goal</span><span className="nv">{seed.goalRace.goal}</span></div>
                <div className="wc-nrow"><span className="nk">Projected</span><span className="nv">{seed.goalRace.projected}</span></div>
                <div className="wc-nrow"><span className="nk">Days out</span><span className="nv">{seed.goalRace.daysAway}</span></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function deltaHeadline(delta: number): React.ReactNode {
  if (delta > 5) return <>Pushed the load.</>;
  if (delta > 0) return <>Steady gain.</>;
  if (delta === 0) return <>Held the line.</>;
  if (delta > -5) return <>Soft step back.</>;
  return <>Cutback week.</>;
}
function formatDate(iso: string) {
  // noon-UTC anchor on the date part so the label never shifts a day by timezone.
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 10) + 'T12:00:00Z'));
}
