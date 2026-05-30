'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FaffSeed } from '../types';
import { PHASE, PHASE_TPL, SEASON_TYPE_COLOR, SEASON_TYPE_NAME, type Mesh, type PhaseKey } from '../constants';

const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
const ANCH: { x: number; p: PhaseKey }[] = [
  { x: 3.5,  p: 'base'  },
  { x: 11.5, p: 'build' },
  { x: 18.5, p: 'peak'  },
  { x: 23.5, p: 'taper' },
  { x: 26,   p: 'race'  },
];

function hx(h: string) {
  const c = h.replace('#','');
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}
function rgb([r,g,b]: number[]) { return `rgb(${r},${g},${b})`; }

function meshAt(x: number): Mesh {
  const anchors = ANCH.map(a => ({ x: a.x, m: PHASE[a.p].mesh.map(hx) }));
  if (x <= anchors[0].x) return anchors[0].m.map(rgb) as Mesh;
  const last = anchors[anchors.length - 1];
  if (x >= last.x) return last.m.map(rgb) as Mesh;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (x >= anchors[i].x && x < anchors[i+1].x) {
      const lo = anchors[i], hi = anchors[i+1], t = (x - lo.x) / (hi.x - lo.x);
      return lo.m.map((c, k) => rgb(c.map((v, j) => Math.round(v + (hi.m[k][j] - v) * t)))) as Mesh;
    }
  }
  return last.m.map(rgb) as Mesh;
}

function barColor(i: number) {
  return i < 8 ? '#3FB6B0' : i < 16 ? '#F3AD38' : i < 22 ? '#FC4D64' : '#3EBD41';
}
function phaseOf(i: number, race: number): PhaseKey {
  if (i === race) return 'race';
  if (i < 8) return 'base';
  if (i < 16) return 'build';
  if (i < 22) return 'peak';
  return 'taper';
}

export function TrainView({
  seed, onOpenDetail, onMeshChange,
}: {
  seed: FaffSeed;
  onOpenDetail: (dayIdx: number) => void;
  onMeshChange: (mesh: Mesh | null) => void;
}) {
  const { nowIdx, raceIdx, miles, maxMi } = seed.season;
  const [locked, setLocked] = useState(nowIdx);
  const [focusIdx, setFocusIdx] = useState(nowIdx);

  const cur = focusIdx;
  const isRace = cur === raceIdx;
  const key = phaseOf(cur, raceIdx);
  const p = PHASE[key];

  // Apply per-scrubber mesh while Train is active.
  useEffect(() => {
    onMeshChange(isRace ? p.mesh : meshAt(cur));
    return () => onMeshChange(null);
  }, [cur, isRace, p.mesh, onMeshChange]);

  const phaseSpansFlex = useMemo(() => [['base',8],['build',8],['peak',6],['taper',4],['race',1]] as const, []);

  const label = isRace ? 'RACE DAY' :
    cur === nowIdx ? 'THIS WEEK' :
    cur < nowIdx ? `WEEK ${cur + 1} · DONE` :
    `WEEK ${cur + 1} · ${cur - nowIdx === 1 ? 'NEXT UP' : `${cur - nowIdx} WKS OUT`}`;

  return (
    <>
      <div className="top">
        <div>
          <div className="date">Marathon Block</div>
          <div className="wk">{seed.goalRace ? `${seed.goalRace.name} · ${formatDate(seed.goalRace.date)}` : 'CIM · Sacramento · Dec 6'}</div>
        </div>
      </div>

      <div className="season">
        <div className="season-top">
          <div className="season-head">
            <div className="season-eyebrow">ROAD TO <b>{(seed.goalRace?.name ?? 'CIM').split(' ')[0].toUpperCase()}</b> · SUB {seed.goalRace?.goal ?? '3:00'}</div>
            <div className="season-phase">{p.name}</div>
          </div>
          <div className="season-meta">
            <div className="season-readout">
              <span>{isRace ? `26.2 MI · SUB ${seed.goalRace?.goal ?? '3:00'}` : `WK ${cur + 1} · ${miles[cur]} MI`}</span>
              <span className={`now-tag${cur === nowIdx ? ' on' : ''}`}><i />NOW</span>
            </div>
            <div className="season-weeks">{p.lab}</div>
            <div className="season-countdown">
              {isRace ? <span>Race day. It&rsquo;s here.</span> :
                <><b>{(raceIdx - cur) * 7}</b> days to the start line</>}
            </div>
          </div>
        </div>

        <div className="season-focus">
          <span className="ct">FOCUS</span>
          <span className="cx">{p.focus}</span>
        </div>

        <div
          className="strip"
          onMouseLeave={() => setFocusIdx(locked)}
        >
          {miles.map((mi, i) => {
            const h = Math.round((mi / maxMi) * 100);
            const isNow = i === nowIdx;
            const isFocus = i === focusIdx;
            return (
              <div
                key={i}
                className={`swk${isNow ? ' now' : ''}${isFocus ? ' focus' : ''}`}
                onMouseEnter={() => setFocusIdx(i)}
                onClick={() => { setLocked(i); setFocusIdx(i); }}
                role="button"
                tabIndex={0}
              >
                <div className="bar" style={{ height: `${h}%`, background: barColor(i) }} />
                <span className="wn">{i + 1}</span>
              </div>
            );
          })}
          <div
            className={`swk swk-fin${focusIdx === raceIdx ? ' focus' : ''}${nowIdx === raceIdx ? ' now' : ''}`}
            onMouseEnter={() => setFocusIdx(raceIdx)}
            onClick={() => { setLocked(raceIdx); setFocusIdx(raceIdx); }}
            role="button"
            tabIndex={0}
          >
            <div className="rbar" />
            <span className="wn">RACE</span>
          </div>
        </div>

        <div className="strip-phases">
          {phaseSpansFlex.map(([pk, flex]) => (
            <span key={pk} style={{ flex }} className={pk === key ? 'on' : ''}>{(PHASE[pk as PhaseKey]?.name ?? pk).slice(0,5).toUpperCase()}</span>
          ))}
        </div>
      </div>

      <div className="fll" id="weekHeading" style={{ marginTop: 26, display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ opacity: 0.6 }}>{isRace ? `${formatDate(seed.goalRace?.date ?? '2026-12-06')}` : `${miles[cur]} MI`}</span>
      </div>

      {isRace ? (
        <div className="season-racestats" style={{ marginTop: 14 }}>
          <div className="rc"><div className="k">GOAL</div><div className="v">Sub {seed.goalRace?.goal ?? '3:00'}</div></div>
          <div className="rc"><div className="k">PACE</div><div className="v">6:51<span style={{ fontSize: 13, opacity: 0.6 }}>/mi</span></div></div>
          <div className="rc"><div className="k">DISTANCE</div><div className="v">26.2<span style={{ fontSize: 13, opacity: 0.6 }}> mi</span></div></div>
        </div>
      ) : (
        <div className="twk">
          {cur === nowIdx
            ? seed.week.map((d, wi) => {
                const col = (SEASON_TYPE_COLOR[d.type as keyof typeof SEASON_TYPE_COLOR] ?? '#8A90A0');
                const meta = d.dist === ' · ' ? 'full recovery' : `${parseFloat(d.dist)} mi · ${d.pace}`;
                return (
                  <div className="twr" key={wi} style={{ cursor: 'pointer' }} onClick={() => onOpenDetail(wi)} role="button" tabIndex={0}>
                    <span className="td">{d.dw}</span>
                    <span className="tdot" style={{ background: col }} />
                    <span className="tn">{d.name}</span>
                    <span className="tm">{meta}</span>
                    <span className="tc">
                      {d.done ? (
                        <svg className="ck" viewBox="0 0 24 24" fill="none" stroke="#3EBD41" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      ) : d.today ? (<span className="tdy">TODAY</span>) : null}
                    </span>
                  </div>
                );
              })
            : (PHASE_TPL[key as Exclude<PhaseKey,'race'>] ?? PHASE_TPL.build).map((row, di) => {
                const total = miles[cur];
                const type = row[1];
                const info = SEASON_TYPE_NAME[type];
                const col = SEASON_TYPE_COLOR[type] ?? '#8A90A0';
                const rest = type === 'rest';
                const mi = Math.round(total * row[2]);
                const meta = rest ? 'full recovery' : `${mi} mi · ${info[1]}`;
                const past = cur < nowIdx;
                return (
                  <div className="twr" key={di}>
                    <span className="td">{DOW[di]}</span>
                    <span className="tdot" style={{ background: col }} />
                    <span className="tn">{info[0]}</span>
                    <span className="tm">{meta}</span>
                    <span className="tc">
                      {past && (
                        <svg className="ck" viewBox="0 0 24 24" fill="none" stroke="#3EBD41" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      )}
                    </span>
                  </div>
                );
              })}
        </div>
      )}
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}
