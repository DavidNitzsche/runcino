'use client';

import { useState } from 'react';
import type { FaffSeed, HeatCell, EfficiencyTrend } from '../types';
import { StreakPill } from '../toolkit';

const EC: Record<string,string> = {
  recovery: '#27B4E0', easy: '#14C08C', long: '#F3AD38',
  tempo: '#FF5722', intervals: '#F43F5E', race: '#FF5722',
};
// 2026-06-04 · level 0 lifted from rgba(255,255,255,.07) → .14
// after the Activity mesh moved to charcoal · the old level-0 cell
// color was essentially identical to the new dark-glass panel
// (rgba(8,10,14,.4) over charcoal ≈ #181B20, and white-7-alpha
// blended in there matched within a couple of % · the heatmap grid
// vanished).  .14 alpha gives the empty cells enough lift to read
// as a grid without competing with the populated cells.
const HEATC = ['rgba(255,255,255,.14)', '#1f6f7a', '#2f9a7e', '#E0913A', '#EF6038'];
const ICON: Record<string, React.ReactNode> = {
  mtn:   <path d="M3 19l6-11 4 6 3-5 5 10z"/>,
  route: <><path d="M6 19a3 3 0 0 1 0-6h9a3 3 0 0 0 0-6H7"/><circle cx="6" cy="19" r="1.6"/><circle cx="18" cy="5" r="1.6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  cal:   <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
};

export function ActivityView({ seed, onOpenRun }: { seed: FaffSeed; onOpenRun?: (runId: string) => void }) {
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
        {/* 2026-06-03 · StreakPill GUTTED per David: "I also dont like
            streaks. Its not about running all these days in a row. I
            think thats bad to have, right?" Run-streak culture
            encourages compulsive training · skipping rest days, ignoring
            overreach signals · which is the opposite of what the
            engine should reinforce. Signal streaks in the readiness
            brief (HRV / sleep chronic deficits) stay because they
            detect OVERREACH not glorify volume. The endpoint
            /api/streak and the StreakPill component remain in source
            for future re-enable as an opt-in setting. */}
        {false && <div style={{ marginTop: 6 }}><StreakPill /></div>}
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

      <div className="band">
      <div className="fll">VOLUME</div>
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
      </div>{/* .band */}

      {/* EFFICIENCY TREND band hidden — easy pace is intentionally slow,
          making the pace-at-HR signal always read DECLINING for a runner
          executing correctly. Redesign pending: use tempo/threshold pace
          vs HR as the efficiency signal for the CIM block. All supporting
          code (buildEfficiencyTrend, EfficiencyTrendCard, EfficiencySparkline,
          EfficiencyTrend type, .av-et-* CSS) is preserved for the rewrite. */}
      {false && d.efficiencyTrend && <EfficiencyTrendBand et={d.efficiencyTrend as EfficiencyTrend} />}

      <div className="band">
      <div className="fll">PERSONAL RECORDS</div>
      <div className="av-recs">
        {d.recs.map(r => (
          <div className="av-rec" key={r.k} style={{ ['--ec' as string]: EC[r.t] } as React.CSSProperties}>
            <div className="rk">{r.k}</div>
            <div className="rv" dangerouslySetInnerHTML={{ __html: r.v }} />
            <div className="rc">{r.c}</div>
          </div>
        ))}
      </div>
      </div>{/* .band */}

      <div className="band">
      <div className="fll" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>CONSISTENCY</span>
        <span style={{ opacity: 0.55, fontWeight: 700, letterSpacing: '2px' }}>LAST 18 WEEKS</span>
      </div>
      <div className="av-panel">
        <Heatmap cols={d.heat} labels={d.heatLabels} onOpenRun={onOpenRun} />
        <div className="av-hkey">
          LESS
          {HEATC.map((c, i) => <i key={i} style={{ background: c }} />)}
          MORE
        </div>
      </div>
      </div>{/* .band */}

      <div className="band">
      <div className="fll">BY THE NUMBERS</div>
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
      </div>{/* .band */}

      <div className="band">
      <div className="fll">RECENT RUNS</div>
      <div className="log">
        {seed.activity.recent.map((r, i) => (
          <div
            className="lr"
            key={i}
            onClick={() => r.slug && onOpenRun?.(r.slug)}
            role={r.slug ? 'button' : undefined}
            tabIndex={r.slug ? 0 : undefined}
            style={r.slug ? { cursor: 'pointer' } : undefined}
          >
            <span className="ld">{r.date}</span>
            <span className="ldot" style={{ background: r.color }} />
            <span className="ln">{r.name}</span>
            <span className="lm">{r.meta}</span>
            {r.badge && <span className={`lb ${r.badge === 'NAILED IT' || r.badge === 'SOLID' ? 'ok' : 'pr'}`}>{r.badge}</span>}
            <span className="lgo">›</span>
          </div>
        ))}
      </div>
      </div>{/* .band */}
    </>
  );
}

function EfficiencyTrendBand({ et }: { et: EfficiencyTrend }) {
  return (
    <div className="band">
    <div className="fll" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>EFFICIENCY TREND</span>
      {et.runsUsed >= 4 && (
        <span className={`av-et-chip av-et-chip--${et.direction}`}>
          {et.direction === 'improving' ? 'IMPROVING ↑'
            : et.direction === 'declining' ? 'DECLINING ↓'
            : 'FLAT →'}
        </span>
      )}
    </div>
    <div className="av-panel">
      {et.runsUsed >= 4 ? (
        <EfficiencyTrendCard trend={et} />
      ) : (
        <div className="av-et-empty">
          <div className="av-et-emptytitle">Not enough data yet.</div>
          <div className="av-et-emptysub">
            Easy runs with heart rate logged: {et.runsUsed} of 4 needed.
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

function fmtPaceDelta(sec: number): string {
  const m = Math.floor(Math.abs(sec) / 60);
  const s = Math.abs(sec) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function EfficiencyTrendCard({ trend }: { trend: EfficiencyTrend }) {
  const deltaColor =
    trend.direction === 'improving' ? '#F3AD38'
    : trend.direction === 'declining' ? '#FC4D64'
    : 'rgba(255,255,255,.55)';

  const deltaLabel =
    trend.paceChangeSec === 0 ? 'no change'
    : trend.paceChangeSec < 0 ? `−${fmtPaceDelta(trend.paceChangeSec)}/mi`
    : `+${fmtPaceDelta(trend.paceChangeSec)}/mi`;

  const hrDeltaLabel =
    trend.hrChangeBpm === 0 ? '—'
    : trend.hrChangeBpm < 0 ? `−${Math.abs(trend.hrChangeBpm)} bpm`
    : `+${trend.hrChangeBpm} bpm`;

  return (
    <>
      <div className="av-et-top">
        <div>
          <div className="av-et-delta" style={{ color: deltaColor }}>{deltaLabel}</div>
          <div className="av-et-label">
            pace change · {trend.periodWeeks} wk{trend.periodWeeks === 1 ? '' : 's'} · {trend.runsUsed} easy runs
          </div>
        </div>
        <div className="av-et-stats">
          <div className="av-et-stat">
            <span className="k">HR AVG</span>
            <span className="v">{trend.hrAvgBpm} bpm</span>
          </div>
          <div className="av-et-stat">
            <span className="k">HR CHANGE</span>
            <span className="v">{hrDeltaLabel}</span>
          </div>
        </div>
      </div>
      <div className="av-et-chart">
        <EfficiencySparkline points={trend.points} direction={trend.direction} />
      </div>
      <div className="av-et-footer">
        Pace at aerobic HR. A downward line means your engine is getting more efficient.
      </div>
    </>
  );
}

function EfficiencySparkline({ points, direction }: {
  points: { date: string; paceSec: number; hrBpm: number }[];
  direction: 'improving' | 'flat' | 'declining';
}) {
  if (points.length < 2) return null;
  const W = 400, H = 80, PAD = 12;
  const paces = points.map(p => p.paceSec);
  const minP = Math.min(...paces);
  const maxP = Math.max(...paces);
  const range = maxP - minP || 30;

  // Y inverted: fast (low sec) → low y (top of chart). Up = faster = better.
  const xOf = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const yOf = (sec: number) => PAD + ((sec - minP) / range) * (H - 2 * PAD);

  // Linear regression on y-coordinates vs index.
  const n = points.length;
  const ys = points.map(p => yOf(p.paceSec));
  const sumX = (n * (n - 1)) / 2;
  const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = ys.reduce((s, y) => s + y, 0);
  const sumXY = ys.reduce((s, y, i) => s + i * y, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  const regY0 = Math.max(PAD, Math.min(H - PAD, intercept));
  const regY1 = Math.max(PAD, Math.min(H - PAD, slope * (n - 1) + intercept));

  const dotColor = direction === 'declining' ? '#FC4D64' : '#14C08C';
  const lineColor = direction === 'declining' ? 'rgba(252,77,100,.4)' : 'rgba(20,192,140,.4)';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="none">
      <line
        x1={xOf(0)} y1={regY0} x2={xOf(n - 1)} y2={regY1}
        stroke={lineColor} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 4"
      />
      {points.map((p, i) => (
        <circle key={i} cx={xOf(i)} cy={yOf(p.paceSec)} r="5" fill={dotColor} opacity="0.85" />
      ))}
    </svg>
  );
}

function Heatmap({ cols, labels, onOpenRun }: { cols: HeatCell[][]; labels: string[]; onOpenRun?: (id: string) => void }) {
  const [tip, setTip] = useState<{ x: number; y: number; label: string; mi: number; clickable: boolean } | null>(null);
  return (
    <div className="av-heat" style={{ position: 'relative' }}>
      {cols.map((col, ci) => (
        <div key={ci} className="av-hcol">
          {col.map((cell, di) => {
            const clickable = !!(cell.runId && onOpenRun);
            return (
              <div
                key={di}
                className="av-hcell"
                style={{ background: HEATC[cell.lv], cursor: clickable ? 'pointer' : 'default' }}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const host = (e.currentTarget.parentElement?.parentElement as HTMLDivElement | null)?.getBoundingClientRect();
                  if (host) {
                    setTip({
                      x: rect.left + rect.width / 2 - host.left,
                      y: rect.top - host.top - 4,
                      label: cell.label,
                      mi: cell.mi,
                      clickable,
                    });
                  }
                }}
                onMouseLeave={() => setTip(null)}
                onClick={() => { if (clickable && cell.runId) onOpenRun!(cell.runId); }}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
              />
            );
          })}
        </div>
      ))}
      <div className="av-hmlabels" style={{ width: '100%' }}>
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
      {tip && (
        <div
          style={{
            position: 'absolute',
            left: tip.x,
            top: tip.y,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            background: '#0A0C10',
            border: '1px solid rgba(255,255,255,.18)',
            borderRadius: 8,
            padding: '7px 11px',
            fontSize: 11.5,
            fontWeight: 700,
            color: '#F6F7F8',
            whiteSpace: 'nowrap',
            boxShadow: '0 8px 22px -10px rgba(0,0,0,.5)',
            zIndex: 5,
          }}
        >
          {tip.label}{tip.clickable ? ' · click for detail' : ''}
        </div>
      )}
    </div>
  );
}
