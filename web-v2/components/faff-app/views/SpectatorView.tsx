'use client';

import type { FaffSeed } from '../types';

export function SpectatorView({ seed, onExit }: { seed: FaffSeed; onExit: () => void }) {
  const goal = seed.goalRace;
  return (
    <>
      <div className="top">
        <div>
          <div className="date">Following {seed.user.name}</div>
          <div className="wk">Spectator mode</div>
        </div>
        <div className="exitspec" onClick={onExit} role="button" tabIndex={0}>Exit spectator ›</div>
      </div>

      <div className="specgrid">
        <div className="hcard">
          <div className="fll">TODAY</div>
          <div className="hcb">
            <div className="specnext">
              <span className="tdot" style={{ background: '#E88021' }} />
              <div>
                <div className="snn">Tempo Run</div>
                <div className="snm">8 mi · 6:38 target</div>
              </div>
            </div>
          </div>
        </div>
        <div className="hcard">
          <div className="fll">READINESS</div>
          <div className="hcb">
            <div className="rg" style={{ width: 108, height: 108 }}>
              <svg width="108" height="108" viewBox="0 0 108 108">
                <circle cx="54" cy="54" r="46" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="7"/>
                <circle cx="54" cy="54" r="46" fill="none" stroke="#3EBD41" strokeWidth="7" strokeLinecap="round"
                  strokeDasharray="289" strokeDashoffset={289 - (seed.readiness.score / 100) * 289} transform="rotate(-90 54 54)" />
              </svg>
              <div className="rgc">
                <b style={{ fontSize: 28, color: '#3EBD41' }}>{seed.readiness.score}</b>
                <span>{seed.readiness.label}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="hcard">
          <div className="fll">RACE DAY</div>
          <div className="hcb cd">
            <div className="cdbig" style={{ fontSize: 52 }}>{goal?.daysAway ?? '·'}</div>
            <div className="cdlab">DAYS TO {(goal?.name ?? 'GOAL').split(' ')[0].toUpperCase()}</div>
            <div className="cdsub">{goal ? `${formatDate(goal.date)}${goal.location ? ' · ' + goal.location : ''}` : '·'}</div>
          </div>
        </div>
      </div>

      <div className="fll" style={{ marginTop: 30 }}>{seed.user.name.toUpperCase()}&rsquo;S RECENT</div>
      <div className="log">
        {seed.activity.recent.slice(0, 3).map((r, i) => (
          <div className="lr nc" key={i}>
            <span className="ld">{r.date}</span>
            <span className="ldot" style={{ background: r.color }} />
            <span className="ln">{r.name}</span>
            <span className="lm">{r.meta}</span>
            {r.badge && <span className={`lb ${r.badge === 'NAILED IT' || r.badge === 'SOLID' ? 'ok' : 'pr'}`}>{r.badge}</span>}
          </div>
        ))}
      </div>
      <div className="speccta">Get notified the moment {seed.user.name} starts on race day ›</div>
    </>
  );
}

function formatDate(iso: string) {
  // noon-UTC anchor on the date part so the label never shifts a day by timezone.
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 10) + 'T12:00:00Z'));
}
