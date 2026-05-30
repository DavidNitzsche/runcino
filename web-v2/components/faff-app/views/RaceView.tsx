'use client';

import { useState } from 'react';
import type { FaffSeed } from '../types';

async function patchRace(slug: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch('/api/race', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, ...payload }),
    });
    return res.ok;
  } catch { return false; }
}

export type RaceDetailSeed = {
  slug: string;
  name: string;
  date: string;
  startTime: string;
  course: string;
  certification: string;
  registered: boolean;
  bib: string;
  wave: string;
  daysAway: number;
  distanceMi: number;
  netElevFt: number;
  gainFt: number;
  goalPace: string;
  aGoal: string;
  bGoal: string;
  pacing: Array<{ seg: string; sub: string; bar: number; barColor: string; pace: string; cum: string }>;
  splits: Array<{ label: string; val: string }>;
  gels: Array<{ mi: string; left: number; caf?: boolean }>;
  preRace: string;
  onCourse: string;
  hydration: string;
  notables: Array<{ mi: string; tx: string }>;
  insight: string;
  start: { time: string; detail: string };
  shuttle: { value: string; detail: string };
  pickup: { value: string; detail: string };
  finish: { value: string; detail: string };
  elevPath: string;
};

const FALLBACK: RaceDetailSeed = {
  slug: 'race', name: 'Race', date: '', startTime: '·',
  course: '·', certification: '·',
  registered: false, bib: '·', wave: '·',
  daysAway: 0, distanceMi: 0, netElevFt: 0, gainFt: 0, goalPace: '·',
  aGoal: '·', bGoal: '·',
  pacing: [],
  splits: [],
  gels: [],
  preRace: '·', onCourse: '·', hydration: '·',
  notables: [],
  insight: 'Race details will appear here once the GPX and goal time are confirmed.',
  start:   { time: '·', detail: '·' },
  shuttle: { value: '·', detail: '·' },
  pickup:  { value: '·', detail: '·' },
  finish:  { value: '·', detail: '·' },
  elevPath: 'M0,58 L40,40 L80,70 L120,46 L160,78 L200,54 L240,86 L280,68 L320,96 L360,84 L400,104 L440,96 L480,112 L520,108 L560,120 L600,116 L640,128',
};

export function RaceView({ seed: _seed, race, onBack }: { seed: FaffSeed; race?: RaceDetailSeed; onBack: () => void }) {
  const r = race ?? FALLBACK;
  const [aGoal, setAGoal] = useState(r.aGoal);
  const [bGoal, setBGoal] = useState(r.bGoal);
  const [bib, setBib] = useState(r.bib);
  const [goalPace, setGoalPace] = useState(r.goalPace);

  function commitA(text: string) {
    const sec = parseHMS(text);
    if (sec <= 0) { setAGoal(r.aGoal); return; }
    const next = fmtHMS(sec);
    setAGoal(next);
    setGoalPace(sec2pace(sec));
    void patchRace(r.slug, { goal: next });
  }
  function commitB(text: string) {
    const sec = parseHMS(text);
    if (sec <= 0) { setBGoal(r.bGoal); return; }
    const next = fmtHMS(sec);
    setBGoal(next);
    void patchRace(r.slug, { goal_safe: next });
  }
  function commitBib(text: string) {
    const next = (text || '').trim() || r.bib;
    setBib(next);
    void patchRace(r.slug, { bib: next });
  }

  return (
    <>
      <div className="rp-back" onClick={onBack} role="button" tabIndex={0}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        TARGETS
      </div>

      <div className="rp-hero">
        <div>
          <div className="rp-eyebrow">GOAL RACE · MARATHON</div>
          <div className="rp-title">{r.name.split(' ').map((w, i) => <span key={i}>{w}<br/></span>)}</div>
          <div className="rp-meta">
            <span><b>{formatDateFull(r.date)}</b> · {r.startTime}</span>
            <span>{r.course}</span>
            <span>{r.certification}</span>
          </div>
          <div className="rp-chips">
            {r.registered && (
              <div className="rp-chip reg">
                <svg viewBox="0 0 24 24" fill="none" stroke="#7BE8A0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                Registered
              </div>
            )}
            <div className="rp-chip">
              Bib{' '}
              <span
                className="chip-edit"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onBlur={(e) => commitBib(e.currentTarget.textContent || '')}
              >{bib}</span>
            </div>
            <div className="rp-chip">{r.wave}</div>
          </div>
        </div>
        <div>
          <div className="rp-count">
            <div className="rp-countn">{r.daysAway}</div>
            <div className="rp-countl">DAYS TO GO</div>
            <div className="rp-goals">
              <div className="rp-goal a">
                <div className="gk">A · GOAL</div>
                <div
                  className="gv edit"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={(e) => commitA(e.currentTarget.textContent || '')}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
                >{aGoal}</div>
              </div>
              <div className="rp-goal gd" />
              <div className="rp-goal">
                <div className="gk">B · SAFE</div>
                <div
                  className="gv edit"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={(e) => commitB(e.currentTarget.textContent || '')}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
                >{bGoal}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rp-stripstats">
        <div className="rp-ss"><div className="k">DISTANCE</div><div className="v">{r.distanceMi}<small> mi</small></div></div>
        <div className="rp-ss"><div className="k">NET ELEVATION</div><div className="v down">{r.netElevFt > 0 ? `+${r.netElevFt}` : r.netElevFt}<small> ft</small></div></div>
        <div className="rp-ss"><div className="k">TOTAL GAIN</div><div className="v">+{r.gainFt.toLocaleString()}<small> ft</small></div></div>
        <div className="rp-ss"><div className="k">GOAL PACE</div><div className="v">{goalPace}<small>/mi</small></div></div>
      </div>

      <div className="rp-sec">THE COURSE<span className="rp-secr">{r.netElevFt < -100 ? 'Net downhill' : r.netElevFt > 100 ? 'Net uphill' : 'Net flat'}</span></div>
      <div className="rp-panel">
        <div className="rp-elevhead"><div className="t">Route{r.course ? ` · ${r.course}` : ''}</div><div className="s">GPX available</div></div>
        <div className="rp-map">
          <svg viewBox="0 0 640 158" preserveAspectRatio="none">
            <defs><pattern id="rmg" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="1"/></pattern></defs>
            <rect width="640" height="158" fill="url(#rmg)" />
          </svg>
          <svg viewBox="0 0 640 158" preserveAspectRatio="xMidYMid meet">
            <polyline points="40,118 90,96 140,108 196,74 250,88 300,60 356,76 410,52 470,70 524,44 580,58 606,40" fill="none" stroke="#FF8847" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="40" cy="118" r="6" fill="#04201f" stroke="#14C08C" strokeWidth="3" />
            <circle cx="606" cy="40" r="6" fill="#FF8847" stroke="#fff" strokeWidth="2" />
          </svg>
          <span className="rp-mtag s" style={{ left: 14, bottom: 32 }}>START</span>
          <span className="rp-mtag f" style={{ right: 14, top: 12 }}>FINISH</span>
          <div className="rp-mstat">
            <span>{r.distanceMi} MI</span>
            <span>{r.netElevFt < 0 ? '↘' : '↗'} {Math.abs(r.netElevFt)} FT NET</span>
            <span>↗ {r.gainFt.toLocaleString()} FT GAIN</span>
          </div>
        </div>
      </div>

      <div className="rp-2col" style={{ marginTop: 16 }}>
        <div className="rp-panel rp-elev">
          <div className="rp-elevhead"><div className="t">Elevation profile</div><div className="s">Start 360 ft → Finish 20 ft</div></div>
          <svg className="rp-elevsvg" viewBox="0 0 640 150" preserveAspectRatio="none">
            <defs><linearGradient id="elevfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF8847" stopOpacity=".42"/><stop offset="1" stopColor="#FF8847" stopOpacity="0"/></linearGradient></defs>
            <path d={`${r.elevPath} L640,150 L0,150 Z`} fill="url(#elevfill)" />
            <path d={r.elevPath} fill="none" stroke="#FF8847" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <line x1="320" y1="0" x2="320" y2="150" stroke="rgba(255,255,255,.18)" strokeWidth="1" strokeDasharray="3 4" />
          </svg>
          <div className="rp-elevx"><span>START</span><span>10K</span><span>HALF · 13.1</span><span>30K</span><span>FINISH</span></div>
        </div>
        <div className="rp-panel">
          <div className="rp-elevhead"><div className="t">Notable miles</div></div>
          <div className="rp-coursenotes">
            {r.notables.map((n, i) => (
              <div className="rp-cn" key={i}>
                <span className="mi">{n.mi}</span>
                <span className="tx" dangerouslySetInnerHTML={{ __html: n.tx }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rp-sec">PACING PLAN<span className="rp-secr">Even effort for {aGoal} · {goalPace}/mi avg</span></div>
      <div className="rp-panel rp-pace">
        {r.pacing.map((p, i) => (
          <div className="rp-pr" key={i}>
            <div className="seg">{p.seg}<small>{p.sub}</small></div>
            <div className="bar"><i style={{ width: `${p.bar}%`, background: p.barColor }} /></div>
            <div className="pp">{p.pace}</div>
            <div className="cum">{p.cum}</div>
          </div>
        ))}
        <div className="rp-5k">
          {r.splits.map(s => <span key={s.label}>{s.label} <b>{s.val}</b></span>)}
        </div>
      </div>

      <div className="rp-sec">FUELING PLAN<span className="rp-secr">~70g carbs/hr · {r.gels.length} gels · fluids every aid station</span></div>
      <div className="rp-panel">
        <div className="rp-fuel">
          <div className="rp-ftrack">
            {r.gels.map((g, i) => (
              <div key={i} className={`rp-fgel${g.caf ? ' caf' : ''}`} data-mi={g.mi} style={{ left: `${g.left}%` }} />
            ))}
          </div>
          <div className="rp-fx"><span>START</span><span>10K</span><span>HALF</span><span>30K</span><span>FINISH</span></div>
        </div>
        <div className="rp-fgrid">
          <div className="rp-fg"><div className="k">PRE-RACE</div><div className="v">{r.preRace}</div></div>
          <div className="rp-fg"><div className="k">ON COURSE</div><div className="v">{r.onCourse}</div></div>
          <div className="rp-fg"><div className="k">HYDRATION</div><div className="v">{r.hydration}</div></div>
        </div>
      </div>

      <div className="rp-sec">COURSE INSIGHT</div>
      <div className="rp-panel rp-insight">
        <span className="ct">COACH</span>
        <span className="cx" dangerouslySetInnerHTML={{ __html: r.insight }} />
      </div>

      <div className="rp-sec">RACE LOGISTICS<span className="rp-secr">Saved to your race plan</span></div>
      <div className="rp-logi">
        <LogisticsItem icon={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>} label="START"  value={r.start.time}    detail={r.start.detail} />
        <LogisticsItem icon={<path d="M4 16l4-8 4 5 4-9 4 12"/>}                                 label="SHUTTLE" value={r.shuttle.value} detail={r.shuttle.detail} />
        <LogisticsItem icon={<><path d="M6 2h9l3 3v17H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></>}   label="PACKET PICKUP" value={r.pickup.value} detail={r.pickup.detail} />
        <LogisticsItem icon={<><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.5"/></>} label="FINISH" value={r.finish.value} detail={r.finish.detail} />
      </div>
      <div className="rp-links">
        <div className="rp-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
          Official race site
        </div>
        <div className="rp-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20l-5-2V4l5 2 6-2 5 2v14l-5-2-6 2z"/><path d="M9 6v14M15 4v14"/></svg>
          Download GPX
        </div>
        <div className="rp-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5M9 19V9M14 19v-6M19 19V7"/></svg>
          Past results &amp; weather history
        </div>
      </div>
    </>
  );
}

function LogisticsItem({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rp-li">
      <div className="k">
        <svg viewBox="0 0 24 24" fill="none" stroke="#FFCE8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
        {label}
      </div>
      <div className="v">{value}</div>
      <div className="d">{detail}</div>
    </div>
  );
}

function formatDateFull(iso: string) {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
}
function parseHMS(t: string): number {
  const parts = (t || '').trim().split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  return 0;
}
function fmtHMS(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2,'0')}${s ? ':' + String(s).padStart(2,'0') : ''}`;
}
function sec2pace(sec: number): string {
  const per = sec / 26.2188;
  let m = Math.floor(per / 60);
  let s = Math.round(per % 60);
  if (s === 60) { m++; s = 0; }
  return `${m}:${String(s).padStart(2,'0')}`;
}
