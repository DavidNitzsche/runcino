'use client';

import { useState } from 'react';
import type { FaffSeed } from '../types';

const EC: Record<string,string> = {
  recovery: '#27B4E0', easy: '#14C08C', long: '#F3AD38',
  tempo: '#FF8847', intervals: '#FC4D64', race: '#D6263C',
};
const HEATC = ['rgba(255,255,255,.07)', '#1f6f7a', '#2f9a7e', '#E0913A', '#EF6038'];
const HLBL = ['Rest day','4.0 mi · Recovery','7.2 mi · Easy','12.0 mi · Tempo','18.0 mi · Long'];
const ICON: Record<string, React.ReactNode> = {
  mtn:   <path d="M3 19l6-11 4 6 3-5 5 10z"/>,
  route: <><path d="M6 19a3 3 0 0 1 0-6h9a3 3 0 0 0 0-6H7"/><circle cx="6" cy="19" r="1.6"/><circle cx="18" cy="5" r="1.6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  cal:   <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
};

export function ActivityView({ seed }: { seed: FaffSeed }) {
  const [range, setRange] = useState<'month'|'year'|'all'>('year');
  const d = seed.activity.ranges[range];
  const max = Math.max(...d.vol.map(x => x.v));
  const avgVal = Math.round(d.vol.reduce((s, x) => s + x.v, 0) / d.vol.length);

  // Donut math.
  const C = 2 * Math.PI * 42;
  let acc = 0;
  const mixCircles = d.mix.map(m => {
    const len = (m[2] / 100) * C;
    const el = (
      <circle
        key={m[0]}
        cx="50" cy="50" r="42" fill="none" stroke={EC[m[0]]} strokeWidth="14"
        strokeDasharray={`${len} ${C - len}`}
        strokeDashoffset={-acc}
        transform="rotate(-90 50 50)"
      />
    );
    acc += len;
    return el;
  });

  return (
    <>
      <div className="top">
        <div>
          <div className="date">Activity</div>
          <div className="wk">Your training log</div>
        </div>
      </div>

      <div className="av-top">
        <div className="av-hero">
          <div className="av-eyebrow">{d.eyebrow}</div>
          <div className="av-big">{d.big}<small>MI</small></div>
          <div className="av-herosub">{d.sub}</div>
        </div>
        <div className="av-range">
          {(['month','year','all'] as const).map(r => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r === 'all' ? 'All time' : r[0].toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="av-totals">
        {d.totals.map(t => (
          <div className="av-tot" key={t[0]}>
            <div className="k">{t[0]}</div>
            <div className="v" dangerouslySetInnerHTML={{ __html: t[1] }} />
          </div>
        ))}
      </div>

      <div className="fll" style={{ marginTop: 30 }}>VOLUME</div>
      <div className="av-grid2">
        <div className="av-panel">
          <div className="av-ph"><div className="t">{d.volT}</div><div className="s">{d.volS}</div></div>
          <div className="av-vol">
            {d.vol.map((x, i) => (
              <div key={i} className="av-vbar">
                <div className="bar" style={{ height: `${(x.v / max) * 100}%` }} />
                <span className="vx">{x.l}</span>
              </div>
            ))}
            <div className="av-avgline" style={{ bottom: `${(avgVal / max) * 100}%` }}>
              <span>AVG {avgVal}</span>
            </div>
          </div>
        </div>
        <div className="av-panel">
          <div className="av-ph"><div className="t">Effort mix</div><div className="s">share of miles</div></div>
          <div className="av-donutwrap">
            <div className="av-donut">
              <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>{mixCircles}</svg>
              <div className="ctr"><b>{d.mix[0]?.[2] ?? 0}%</b><span>{(d.mix[0]?.[1] ?? '').toUpperCase()}</span></div>
            </div>
            <div className="av-legend">
              {d.mix.map(m => (
                <div className="av-lg" key={m[0]}>
                  <span className="sw" style={{ background: EC[m[0]] }} />
                  <span className="nm">{m[1]}</span>
                  <span className="pc">{m[2]}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="fll" style={{ marginTop: 30 }}>PERSONAL RECORDS</div>
      <div className="av-recs">
        {d.recs.map(r => (
          <div className="av-rec" key={r.k} style={{ ['--ec' as string]: EC[r.t] } as React.CSSProperties}>
            <div className="rk">{r.k}</div>
            <div className="rv" dangerouslySetInnerHTML={{ __html: r.v }} />
            <div className="rc">{r.c}</div>
          </div>
        ))}
      </div>

      <div className="fll" style={{ marginTop: 30 }}>CONSISTENCY</div>
      <div className="av-panel">
        <div className="av-streakrow">
          <span className="av-streak"><span className="fl">▲</span> 21-day run streak</span>
          <span className="av-streaksub">LAST 18 WEEKS</span>
        </div>
        <div className="av-heat">
          {d.heat.map((col, ci) => (
            <div key={ci} className="av-hcol">
              {col.map((lv, di) => (
                <div key={di} className="av-hcell" style={{ background: HEATC[lv] }} title={HLBL[lv]} />
              ))}
            </div>
          ))}
        </div>
        <div className="av-hmlabels">
          {d.heatLabels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
        <div className="av-hkey">
          LESS
          {HEATC.map((c, i) => <i key={i} style={{ background: c }} />)}
          MORE
        </div>
      </div>

      <div className="fll" style={{ marginTop: 30 }}>BY THE NUMBERS</div>
      <div className="av-facts">
        {d.facts.map((f, i) => (
          <div className="av-fact" key={i}>
            <div className="fi">
              <svg viewBox="0 0 24 24" fill="none" stroke="#FFCE8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON[f.i]}</svg>
            </div>
            <div>
              <div className="fv">{f.v}</div>
              <div className="fc">{f.c}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="fll" style={{ marginTop: 30 }}>RECENT RUNS</div>
      <div className="log">
        {seed.activity.recent.map((r, i) => (
          <div className="lr" key={i}>
            <span className="ld">{r.date}</span>
            <span className="ldot" style={{ background: r.color }} />
            <span className="ln">{r.name}</span>
            <span className="lm">{r.meta}</span>
            {r.badge && <span className={`lb ${r.badge === 'NAILED IT' || r.badge === 'SOLID' ? 'ok' : 'pr'}`}>{r.badge}</span>}
            <span className="lgo">›</span>
          </div>
        ))}
      </div>
    </>
  );
}
