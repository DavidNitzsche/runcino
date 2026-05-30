'use client';

import type { Readiness } from '../types';

export function Drawer({
  open, onClose, readiness, onViewFullHealth,
}: { open: boolean; onClose: () => void; readiness: Readiness; onViewFullHealth: () => void }) {
  const delta = readiness.score - readiness.baseline;
  return (
    <>
      <div className={`scrim${open ? ' show' : ''}`} onClick={onClose} />
      <div className={`drawer${open ? ' open' : ''}`}>
        <div className="dh">
          <div className="dt">READINESS · TODAY</div>
          <div className="dx" onClick={onClose} role="button" tabIndex={0} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </div>
        </div>
        <div className="dring">
          <div className="big">
            <svg width="96" height="96" viewBox="0 0 96 96">
              <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="6"/>
              <circle cx="48" cy="48" r="40" fill="none" stroke="#3EBD41" strokeWidth="6" strokeLinecap="round" strokeDasharray="251" strokeDashoffset={251 - (readiness.score/100)*251} transform="rotate(-90 48 48)"/>
            </svg>
            <div className="rv"><b>{readiness.score}</b><span>{readiness.label}</span></div>
          </div>
          <div className="dd">Everything is trending <b>up</b> overnight. You are cleared for today’s session.</div>
        </div>
        <div className="dcl">WHAT IS DRIVING IT</div>
        <div className="contrib">
          {readiness.drivers.map(d => (
            <div className="crow" key={d.name}>
              <span className="ck">{d.name.split(' ')[0]}</span>
              <div className="cbar">
                <i style={d.dir === 'pos'
                  ? { left: '50%', width: `${d.pct}%`, background: '#3EBD41' }
                  : { right: '50%', width: `${d.pct}%`, background: '#ffb24d' }} />
              </div>
              <span className={`cv ${d.dir === 'pos' ? 'good' : ''}`} style={d.dir === 'neg' ? { color: '#ffb24d' } : undefined}>
                {d.dir === 'pos' ? `+${d.pts}` : `−${d.pts}`}
              </span>
            </div>
          ))}
        </div>
        <div className="dbaseline">Baseline <b>{readiness.baseline}</b> &rarr; today <b style={{ color: '#7BE8A0' }}>{readiness.score}</b>&nbsp;<span style={{ color: '#7BE8A0' }}>{delta >= 0 ? `+${delta}` : delta}</span></div>
        <div className="coach"><span className="ct">COACH</span><span className="cx">{readiness.coach}</span></div>
        <div className="dcl">7-DAY TREND</div>
        <div className="rtrend">
          {readiness.trend.map((v, i) => (
            <i key={i} className={i === readiness.trend.length - 1 ? 'td' : ''} style={{ height: `${v}%` }} />
          ))}
        </div>
        <div className="rtlabels">{readiness.trendDays.map((d, i) => <span key={i} className={i === readiness.trendDays.length - 1 ? 'tw' : ''}>{d}</span>)}</div>
        <div className="rtnote">{trendNote(readiness)}</div>
        <div className="dlink" onClick={onViewFullHealth} role="button" tabIndex={0}>
          View full health{' '}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </div>
      </div>
    </>
  );
}

function trendNote(r: { score: number; trend: number[] }): React.ReactNode {
  const trend = r.trend ?? [];
  if (trend.length === 0) return 'Trend will appear once a week of readings is in.';
  const prior = trend.slice(0, Math.max(1, trend.length - 1));
  const priorAvg = Math.round(prior.reduce((s, v) => s + v, 0) / prior.length);
  const delta = r.score - priorAvg;
  if (Math.abs(delta) <= 2) return <>Holding around <b>{priorAvg}</b>. Steady week.</>;
  if (delta > 0) return <>Up from a <b>{priorAvg}</b> average. You are trending into a peak.</>;
  return <>Down from a <b>{priorAvg}</b> average. Watch the load.</>;
}
