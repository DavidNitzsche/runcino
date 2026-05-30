'use client';

import type { FaffSeed } from '../types';

export function TargetsView({
  seed, onOpenRace, onOpenReach,
}: { seed: FaffSeed; onOpenRace: (slug: string) => void; onOpenReach: () => void }) {
  const goal = seed.goalRace;
  return (
    <>
      <div className="top">
        <div>
          <div className="date">Targets</div>
          <div className="wk">Goals &amp; races</div>
        </div>
      </div>

      <div className="reachbn" onClick={onOpenReach} role="button" tabIndex={0}>
        <div className="ri">
          <svg viewBox="0 0 24 24" fill="none" stroke="#FFE9B0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>
        </div>
        <div className="rt">
          <div className="rl">COACH SPOTTED SOMETHING</div>
          <div className="rx">A 5K PR is within one good effort. Want to make it a goal?</div>
        </div>
        <span className="arr">›</span>
      </div>

      <div className="goalhero">
        <div className="ghleft">
          <div className="ghk">PRIMARY GOAL</div>
          <div className="ghtitle">{goal ? `SUB${'−'}${goal.goal}` : 'NO GOAL'}</div>
          <div className="ghsub">{goal ? `${goal.name}${goal.location ? ' · ' + goal.location : ''} · ${formatDate(goal.date)}` : 'Set a primary race to start tracking your gap'}</div>
          <div className="ghcd">
            <b>{goal?.daysAway ?? '·'}</b> days out · <span className={goal?.onTrack ? 'ok2' : ''}>{goal ? (goal.onTrack ? `on track · ${goal.delta}` : goal.delta) : '·'}</span>
          </div>
        </div>
        <div className="ghgauge">
          <svg viewBox="0 -14 300 176" width="220" style={{ height: 'auto' }}>
            <defs>
              <linearGradient id="gz2" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#FC4D64"/>
                <stop offset=".4" stopColor="#F3AD38"/>
                <stop offset=".6" stopColor="#3EBD41"/>
                <stop offset="1" stopColor="#3EBD41"/>
              </linearGradient>
            </defs>
            <path d="M30,150 A120,120 0 0 1 270,150" fill="none" stroke="url(#gz2)" strokeWidth="15" strokeLinecap="round"/>
            <line x1="166.9" y1="43.3" x2="170.6" y2="19.6" stroke="#fff" strokeWidth="3" />
            <text x="172.5" y="7.8" fill="#fff" fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="Inter">GOAL</text>
            <line x1="140.6" y1="162.9" x2="207.6" y2="70.7" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
            <circle cx="150" cy="150" r="9" fill="#fff" />
            <circle cx="150" cy="150" r="4" fill="#10131A" />
          </svg>
          <div className="gapval center">
            <div className="grbig">{goal?.projected ?? '·'}</div>
            <div className="grstat">PROJECTED</div>
          </div>
        </div>
      </div>

      <div className="fll" style={{ marginTop: 30 }}>PERSONAL RECORDS</div>
      <div className="prgrid">
        {seed.prs.map(p => (
          <div className="prt" key={p.k}>
            <div className="prd">{p.k}</div>
            <div className="prv">{p.v}</div>
            <div className="prm">{p.date}</div>
          </div>
        ))}
      </div>

      <div className="fll" style={{ marginTop: 30 }}>RACES</div>
      <div className="races">
        {seed.races.map((r, i) => (
          <div
            className="rcr"
            key={r.slug + i}
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenRace(r.slug)}
            role="button"
            tabIndex={0}
          >
            <div className="rcn">{r.name}<span className="rcm">{r.meta}</span></div>
            <span className={`rctag ${r.tag === 'GOAL' ? 'rc-goal' : ''}`}>{r.tag}</span>
            <span className="rcd">{r.days}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}
