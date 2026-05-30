'use client';

import { useState } from 'react';
import type { FaffSeed, HealthMetric } from '../types';

const GREEN = '#62e08a', AMBER = '#ffb24d', NEUT = '#bfeee2';
const STATUS_COLOR: Record<HealthMetric['status'], string> = { good: GREEN, warn: AMBER, neutral: NEUT };

function smooth(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i-1] || pts[i], p1 = pts[i], p2 = pts[i+1], p3 = pts[i+2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function fmt(m: HealthMetric, v: number): string {
  if (m.clock) {
    const h = Math.floor(v);
    const mn = Math.round((v - h) * 60);
    return `${h}:${String(mn).padStart(2, '0')}`;
  }
  return v.toFixed(m.decimals ?? 0);
}

function MetricCard({ m, active, onClick }: { m: HealthMetric; active: boolean; onClick: () => void }) {
  if (m.special === 'balance') {
    return (
      <div className={`mcard${active ? ' on' : ''}`} onClick={onClick} role="button" tabIndex={0}>
        <div className="mc-k"><span className="cdot" style={{ background: GREEN }} />L / R</div>
        <div className="mc-v">49.4<small> / 50.6%</small></div>
        <div className="mc-balmini"><div className="l" style={{ width: '49.4%' }} /><div className="r" style={{ width: '50.6%' }} /></div>
        <div className="mc-tgt">balanced</div>
      </div>
    );
  }
  const W = 150, H = 32, P = 4;
  const [lo, hi] = m.dom;
  const X = (i: number) => P + (i / (m.series.length - 1)) * (W - P * 2);
  const Y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - P * 2);
  const pts: [number, number][] = m.series.map((v, i) => [X(i), Y(v)]);
  const line = smooth(pts);
  const area = line + ` L${X(m.series.length - 1).toFixed(1)},${H - P} L${X(0).toFixed(1)},${H - P} Z`;
  const tgtMark = m.target != null ? (
    <line x1={P} y1={Y(m.target).toFixed(1)} x2={W - P} y2={Y(m.target).toFixed(1)} stroke="rgba(255,255,255,.28)" strokeWidth="1" strokeDasharray="2 3" />
  ) : m.band ? (
    <rect x={P} y={Y(m.band[1]).toFixed(1)} width={W - P * 2} height={(Y(m.band[0]) - Y(m.band[1])).toFixed(1)} fill="rgba(123,232,160,.10)" />
  ) : null;
  return (
    <div className={`mcard${active ? ' on' : ''}`} onClick={onClick} role="button" tabIndex={0}>
      <div className="mc-k"><span className="cdot" style={{ background: STATUS_COLOR[m.status] }} />{m.label.replace(' MAX','')}</div>
      <div className="mc-v">{fmt(m, m.current)}{m.unit && <small>{m.unit}</small>}</div>
      <svg className="mc-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {tgtMark}
        <path d={area} fill={`${STATUS_COLOR[m.status]}22`} />
        <path d={line} fill="none" stroke={STATUS_COLOR[m.status]} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mc-tgt">{m.target != null ? `target ${fmt(m, m.target)}` : m.band ? `band ${m.band[0]}–${m.band[1]}` : '30-day'}</div>
    </div>
  );
}

function Detail({ m, rangeLabel = '30-DAY', sliceN = 30 }: { m: HealthMetric; rangeLabel?: string; sliceN?: 7 | 30 }) {
  if (m.special === 'balance') {
    return (
      <>
        <div className="hd-head"><div className="hd-title">L / R BALANCE</div></div>
        <div className="balbar">
          <div className="lft" style={{ width: '49.4%' }} />
          <div className="rgt" style={{ width: '50.6%' }} />
          <div className="midl" />
        </div>
        <div className="ballbl"><span>L 49.4%</span><span>R 50.6%</span></div>
      </>
    );
  }
  const fullSeries = m.series;
  const sliced = fullSeries.slice(-sliceN);
  const W = 1040, H = 220, P = 16;
  const [lo, hi] = m.dom;
  const X = (i: number) => P + (i / (sliced.length - 1)) * (W - P * 2);
  const Y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - P * 2);
  const pts: [number, number][] = sliced.map((v, i) => [X(i), Y(v)]);
  const line = smooth(pts);
  const area = line + ` L${X(sliced.length - 1).toFixed(1)},${H - P} L${X(0).toFixed(1)},${H - P} Z`;
  const xlabels = sliceN === 7
    ? ['7D AGO', '5D', '3D', 'TODAY']
    : ['30D AGO', '20D', '10D', 'TODAY'];
  return (
    <>
      <div className="hd-head"><div className="hd-title">{m.label}</div></div>
      <div className="ftop">
        <div className="fname">{rangeLabel}</div>
        {m.target != null && <div className="ftgt">target {fmt(m, m.target)}{m.unit}</div>}
      </div>
      <div className="fval">
        <b>{fmt(m, m.current)}</b><span className="u">{m.unit}</span>
        <span className={`d ${m.status === 'good' ? 'good' : ''}`}>now</span>
      </div>
      <div className="chartwrap">
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {m.target != null && (
            <line x1={P} y1={Y(m.target).toFixed(1)} x2={W - P} y2={Y(m.target).toFixed(1)} stroke="rgba(255,255,255,.28)" strokeWidth="1" strokeDasharray="3 5" />
          )}
          <path d={area} fill={`${STATUS_COLOR[m.status]}22`} />
          <path d={line} fill="none" stroke={STATUS_COLOR[m.status]} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="xlabels">{xlabels.map((x, i) => <span key={i}>{x}</span>)}</div>
      <div className="ctx">
        <div className="c"><div className="cck">7-DAY AVG</div><div className="ccv">{fmt(m, avg(fullSeries.slice(-7)))}</div></div>
        <div className="c"><div className="cck">30-DAY AVG</div><div className="ccv">{fmt(m, avg(fullSeries))}</div></div>
        <div className="c"><div className="cck">DELTA</div><div className="ccv">{(sliced.at(-1)! - sliced[0]).toFixed(m.decimals ?? 0)}{m.unit}</div></div>
      </div>
    </>
  );
}

function avg(a: number[]) { return a.reduce((s, v) => s + v, 0) / a.length; }

export function HealthView({ seed }: { seed: FaffSeed }) {
  const { readiness, body, form } = seed.health;
  const [openBody, setOpenBody] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [range, setRange] = useState<7 | 30>(30);
  const bodyOpen = body.find(m => m.k === openBody);
  const formOpen = form.find(m => m.k === openForm);

  return (
    <>
      <div className="top">
        <div>
          <div className="date">Health</div>
          <div className="wk">Recovery &amp; form · {todayShort()}</div>
        </div>
      </div>

      <div className="hhero">
        <div className="hhero-grid">
          <div className="hg-gauge">
            <ReadinessGauge score={readiness.score} label={readiness.label} />
          </div>
          <div className="hg-info">
            <div className="hr-sec">WHAT IS DRIVING IT</div>
            <div className="drvlist">
              {readiness.drivers.map(d => (
                <div className="drv" key={d.name}>
                  <span className="drv-name">{d.name}</span>
                  <span className="drv-why">{d.why}</span>
                  <span className="drv-bar"><span className="z" /><span className={`f ${d.dir}`} style={{ width: `${d.pct}%` }} /></span>
                  <span className={`drv-pts ${d.dir}`}>{d.dir === 'pos' ? `+${d.pts}` : `−${d.pts}`}</span>
                </div>
              ))}
            </div>
            <div className="hr-base">
              Baseline <b>{readiness.baseline}</b> → today <b style={{ color: '#7BE8A0' }}>{readiness.score}</b>&nbsp;<span style={{ color: '#7BE8A0' }}>+{readiness.score - readiness.baseline}</span>
            </div>
            <div className="hr-bottom">
              <div className="feeders">
                <div className="feeder"><div className="fk">SLEEP</div><div className="fv">7:12</div></div>
                <div className="feeder"><div className="fk">HRV</div><div className="fv">68<span className="fg"> ↑</span></div></div>
                <div className="feeder"><div className="fk">RHR</div><div className="fv">48<span className="fg"> ↓</span></div></div>
              </div>
              <div className="hr-trendcol">
                <div className="hr-trendhead">
                  <span className="l">7-DAY READINESS</span>
                  <span className="r">
                    <span className="now">NOW {readiness.score}</span>
                    <span className="avg">AVG {Math.round(avg(readiness.trend))}</span>
                  </span>
                </div>
                <Trend trend={readiness.trend} />
                <div className="hr-days">
                  {readiness.trendDays.map((d, i) => <span key={i} className={i === readiness.trendDays.length - 1 ? 'tw' : ''}>{d}</span>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="hhero-sep" />
      <div className="hseclbl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
        <span>BODY · FORM</span>
        <RangeToggle range={range} onChange={setRange} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, opacity: 0.55, margin: '20px 0 0' }}>BODY</div>
      <div className="cardgrid">
        {body.map(m => (
          <MetricCard key={m.k} m={sliceMetric(m, range)} active={openBody === m.k} onClick={() => setOpenBody(openBody === m.k ? null : m.k)} />
        ))}
      </div>
      <div className="hdetail">{bodyOpen && <Detail m={bodyOpen} rangeLabel={range === 7 ? '7-DAY' : '30-DAY'} sliceN={range} />}</div>

      <div className="hseclbl">FORM</div>
      <div className="cardgrid">
        {form.map(m => (
          <MetricCard key={m.k} m={sliceMetric(m, range)} active={openForm === m.k} onClick={() => setOpenForm(openForm === m.k ? null : m.k)} />
        ))}
      </div>
      <div className="hdetail">{formOpen && <Detail m={formOpen} rangeLabel={range === 7 ? '7-DAY' : '30-DAY'} sliceN={range} />}</div>
    </>
  );
}

function sliceMetric(m: HealthMetric, range: 7 | 30): HealthMetric {
  if (m.special || !m.series.length || range === 30) return m;
  return { ...m, series: m.series.slice(-range) };
}
function RangeToggle({ range, onChange }: { range: 7 | 30; onChange: (r: 7 | 30) => void }) {
  return (
    <div style={{
      display: 'inline-flex', gap: 4, background: 'rgba(8,10,14,.4)',
      border: '1px solid rgba(255,255,255,.14)', borderRadius: 11, padding: 3,
      letterSpacing: '.4px',
    }}>
      {[7, 30].map(r => (
        <button
          key={r}
          onClick={() => onChange(r as 7 | 30)}
          style={{
            fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, color: range === r ? '#10131A' : 'rgba(255,255,255,.7)',
            background: range === r ? '#fff' : 'transparent', border: 'none',
            borderRadius: 8, padding: '6px 11px', cursor: 'pointer',
          }}
        >
          {r === 7 ? '7-DAY' : '30-DAY'}
        </button>
      ))}
    </div>
  );
}

function ReadinessGauge({ score, label }: { score: number; label: string }) {
  return (
    <div className="gauge">
      <svg viewBox="0 0 300 300" width="100%" height="100%">
        <defs>
          <linearGradient id="rgauge" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#FC4D64" />
            <stop offset=".5" stopColor="#FFCE8A" />
            <stop offset="1" stopColor="#3EBD41" />
          </linearGradient>
        </defs>
        <path d="M 50,250 A 110,110 0 1 1 250,250" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="18" strokeLinecap="round" />
        <path d="M 50,250 A 110,110 0 1 1 250,250" fill="none" stroke="url(#rgauge)" strokeWidth="18" strokeLinecap="round" strokeDasharray="518" strokeDashoffset={518 - (score / 100) * 518} />
        <circle cx="50" cy="250" r="9" fill="#FC4D64" />
      </svg>
      <div className="hrv2">
        <b>{score}</b>
        <div className="hst">{label}</div>
      </div>
    </div>
  );
}

function Trend({ trend }: { trend: number[] }) {
  const max = Math.max(...trend);
  return (
    <div className="rtrend" style={{ height: 46, marginTop: 2 }}>
      {trend.map((v, i) => (
        <i key={i} className={i === trend.length - 1 ? 'td' : ''} style={{ height: `${(v / max) * 100}%` }} />
      ))}
    </div>
  );
}

function todayShort() {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
}
