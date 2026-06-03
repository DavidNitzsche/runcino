'use client';

import { useState } from 'react';
import type { FaffSeed, HeatCell } from '../types';
import { StreakPill } from '../toolkit';

const EC: Record<string,string> = {
  recovery: '#27B4E0', easy: '#14C08C', long: '#F3AD38',
  tempo: '#FF8847', intervals: '#FC4D64', race: '#D6263C',
};
const HEATC = ['rgba(255,255,255,.07)', '#1f6f7a', '#2f9a7e', '#E0913A', '#EF6038'];
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

      <div className="fll" style={{ marginTop: 30, display: 'flex', justifyContent: 'space-between' }}>
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
    </>
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
