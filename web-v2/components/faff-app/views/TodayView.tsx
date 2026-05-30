'use client';

import { useState } from 'react';
import type { FaffSeed } from '../types';
import { EFF, SEGS, KIT } from '../constants';

export function TodayView({
  seed, curDay, onPickDay, onOpenDrawer, onOpenRace,
}: {
  seed: FaffSeed; curDay: number;
  onPickDay: (i: number) => void;
  onOpenDrawer: () => void;
  onOpenRace: () => void;
}) {
  const d = seed.week[curDay] ?? seed.week[seed.todayIdx];
  const e = EFF[d.type];
  const isRest = d.type === 'rest';
  const result = d.done ? (seed.results[curDay] ?? seed.results[0]) : undefined;

  return (
    <>
      <div className="top">
        <div>
          <div className="date">{d.full}</div>
          <div className="wk">{seed.weekOf}</div>
        </div>
        <div className="rbtn" onClick={onOpenDrawer} role="button" tabIndex={0}>
          <div className="rt">
            <div className="rl">
              READINESS{' '}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </div>
            <div className="rs">{seed.readiness.label}</div>
          </div>
          <div className="ringwrap">
            <svg width="56" height="56" viewBox="0 0 56 56">
              <circle cx="28" cy="28" r="23" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="5"/>
              <circle cx="28" cy="28" r="23" fill="none" stroke="#3EBD41" strokeWidth="5" strokeLinecap="round" strokeDasharray="144.5" strokeDashoffset={144.5 - (seed.readiness.score / 100) * 144.5} transform="rotate(-90 28 28)"/>
            </svg>
            <div className="rv">{seed.readiness.score}</div>
          </div>
        </div>
      </div>

      <div className="weeklab">THIS WEEK</div>
      <div className="week">
        {seed.week.map((day, i) => (
          <div
            key={i}
            className={`day${i === curDay ? ' on' : ''}`}
            onClick={() => onPickDay(i)}
            role="button"
            tabIndex={0}
          >
            <div className="dtop">
              <span className="dday">
                {day.today ? <span className="dw tw">TODAY</span> : <span className="dw">{day.dw}</span>}
                <span className="dn">{day.dn}</span>
              </span>
              <span className="dstate">
                {day.done && (
                  <svg className="ck" viewBox="0 0 24 24" fill="none" stroke="#3EBD41" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                )}
              </span>
            </div>
            <div className="dname">{day.name}</div>
            <div className="dmeta">
              <span className="ddot" style={{ background: EFF[day.type].dot }} />
              <span className="ddist">
                {day.dist === ' · ' ? 'rest' : `${day.dist} mi · ${day.pace}`}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="hero">
        <div className="hmain">
          <div className="htag">
            {(d.today ? 'TODAY · ' : `${d.dw} · `) + d.type.toUpperCase() + (d.done ? ' · DONE' : '')}
          </div>
          <div className="htitle">{d.name}</div>
          {result && (
            <div className="hwin">
              <span className="c">
                <svg viewBox="0 0 24 24" fill="none" stroke="#06210a" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              </span>
              {result.win}<small>{result.winx}</small>
            </div>
          )}
          <div className="stats">
            {isRest ? (
              <>
                <div><div className="v">7:42<small> hrs</small></div><div className="k">SLEEP</div></div>
                <div><div className="v">48<small> bpm</small></div><div className="k">RESTING HR</div></div>
                <div><div className="v">62<small> ms</small></div><div className="k">HRV</div></div>
              </>
            ) : d.done && result ? (
              <>
                <div><div className="v">{d.dist}<small> mi</small></div><div className="k">DISTANCE</div></div>
                <div><div className="v">{result.time}</div><div className="k">TIME</div></div>
                <div><div className="v">{result.apace}<small>/mi</small></div><div className="k">AVG PACE</div></div>
              </>
            ) : (
              <>
                <div><div className="v">{d.dist}<small> mi</small></div><div className="k">DISTANCE</div></div>
                <div><div className="v">{d.pace}<small>{/:/.test(d.pace) ? '/mi' : ''}</small></div><div className="k">TARGET PACE</div></div>
                <div><div className="v">{d.est}<small></small></div><div className="k">EST TIME</div></div>
              </>
            )}
          </div>
          {!isRest && !d.done && (
            <div className="effort">
              <div className="etrack">
                <div className="emark" style={{ left: `${e.mark}%` }}>
                  <span className="elbl">{e.lbl}</span><span className="ecaret" />
                </div>
              </div>
              <div className="ezones"><span>Z1</span><span>Z2</span><span>Z3</span><span>Z4</span><span>Z5</span></div>
            </div>
          )}
          {!isRest && d.done && result && (
            <div className="effort done">
              <div className="ehr">
                <span>TIME IN ZONES</span>
                <span>avg ♥ <b>{result.hr}</b> · peak <b>{result.peak}</b></span>
              </div>
              <div className="bk-zbar">
                {result.zones.map((p, zi) => p > 0 ? (
                  <i key={zi} style={{ width: `${p}%`, background: ['#54ddd0','#8ef0b0','#ffe0a0','#ff9560','#ff5a52'][zi] }} />
                ) : null)}
              </div>
              <div className="bk-zleg">
                {result.zones.map((p, zi) => (
                  <div key={zi} style={p === 0 ? { opacity: 0.35 } : undefined}>
                    <span className="zs" style={{ background: ['#54ddd0','#8ef0b0','#ffe0a0','#ff9560','#ff5a52'][zi] }} />
                    Z{zi+1} <b>{p}%</b>
                  </div>
                ))}
              </div>
            </div>
          )}
          {d.done && result && (
            <div className="heroExtra on">
              <div className="hx-cond">
                <div><div className="kcl">WEATHER</div><div className="kcv">{result.weather}</div></div>
                <div><div className="kcl">SHOE</div><div className="kcv">{result.shoe}</div></div>
                <div><div className="kcl">ELEV GAIN</div><div className="kcv">{result.gain} ft</div></div>
                <div><div className="kcl">CALORIES</div><div className="kcv">{result.cal} kcal</div></div>
              </div>
              <div className="hx-recap"><span className="ct">RECAP</span>{result.recap}</div>
            </div>
          )}
        </div>
        <WorkoutCard d={d} done={!!d.done} result={result} />
      </div>

      <Tiles seed={seed} onOpenRace={onOpenRace} />
    </>
  );
}

function WorkoutCard({ d, done, result }: { d: FaffSeed['week'][number]; done: boolean; result?: FaffSeed['results'][number] }) {
  if (done && result) {
    return (
      <div className="wcard">
        <div className="wcl">RESULT <span style={{ color: '#7BE8A0', marginLeft: 6 }}>✓ COMPLETED</span></div>
        <div className="kcl" style={{ margin: '2px 0 0' }}>ROUTE · RESEDA LOOP</div>
        <div className="bk-elev">
          <svg viewBox="0 0 360 58" preserveAspectRatio="none">
            <defs>
              <linearGradient id="bke" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={EFF[d.type].dot} stopOpacity=".4" />
                <stop offset="1" stopColor={EFF[d.type].dot} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0,38 L40,24 L80,42 L120,18 L160,34 L200,15 L240,33 L280,22 L320,40 L360,28 L360,58 L0,58 Z" fill="url(#bke)" />
            <path d="M0,38 L40,24 L80,42 L120,18 L160,34 L200,15 L240,33 L280,22 L320,40 L360,28" fill="none" stroke={EFF[d.type].dot} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="bk-elevstat">
          <span>{d.dist} MI</span>
          <span>↗ {result.gain} FT</span>
          <span>34.20° N</span>
        </div>
        <div className="kcl" style={{ margin: '18px 0 9px' }}>MILE SPLITS</div>
        <div className="splits" style={{ marginTop: 4 }}>
          {result.splits.map((s, i) => (
            <div className="spr" key={i}>
              <span className="spm">{s[0]}</span>
              <div className="sptrk"><div className="spf" style={{ width: `${s[1]}%`, background: EFF[d.type].dot }} /></div>
              <span className="spp">{s[2]}<small>/mi</small></span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const sg = SEGS[d.type];
  const k = KIT[d.type];
  return (
    <div className="wcard">
      <div className="wcl">WORKOUT</div>
      <div className="shape">
        {sg.map((x, i) => <i key={i} style={{ width: `${x.w}%`, background: x.c }} />)}
      </div>
      <div className="segs">
        {sg.map((x, i) => (
          <div className="seg" key={i}>
            <span className="sd" style={{ background: x.c }} />
            <span className="sl">{x.l}</span>
            <span className="ss">{x.sub}</span>
          </div>
        ))}
      </div>
      <div className="kit">
        <div className="kc"><div className="kcl">WEATHER</div><div className="kcv">{k.weather}</div></div>
        <div className="kc"><div className="kcl">SHOE</div><div className="kcv">{k.shoe}</div></div>
        <div className="kc"><div className="kcl">FUEL</div><div className="kcv">{k.fuel}</div></div>
      </div>
      <div className="wcoach"><span className="ct">COACH</span>{k.coach}</div>
    </div>
  );
}

function Tiles({ seed, onOpenRace }: { seed: FaffSeed; onOpenRace: () => void }) {
  const goal = seed.goalRace;
  const [hoverBar, setHoverBar] = useState<number | null>(null);
  const bar = hoverBar != null ? seed.volumeBars[hoverBar] : null;
  const num = bar ? `${bar.mi}` : `${seed.thisWeekMiles}`;
  const sub = bar ? ` mi · ${bar.label}` : ` mi · 8-wk avg ${seed.weeklyAvg}`;

  return (
    <div className="tiles">
      <div className="tile">
        <div className="fll">THE GAP{goal ? ` · ${goal.name.toUpperCase().replace(' MARATHON','').slice(0,12)}` : ''}</div>
        <div className="tbody cd">
          <div className="cdbig" style={{ color: goal?.onTrack ? '#3EBD41' : '#FF8847' }}>{goal?.projected ?? '·'}</div>
          <div className="cdlab">PROJECTED FINISH</div>
          <div className="cdsub">Goal {goal?.goal ?? '·'} · {goal?.delta ?? '·'}</div>
          <div className="cdbar"><div className="cdfill" style={{ width: `${goal?.goalPct ?? 0}%`, background: goal?.onTrack ? '#3EBD41' : '#FF8847' }} /></div>
          <div className="cdwk" style={{ color: '#7be89a', opacity: 1 }}>
            {goal?.onTrack ? 'On track for sub-3' : 'Behind goal pace'}
          </div>
        </div>
      </div>

      <div className="tile click" onClick={onOpenRace} role="button" tabIndex={0}>
        <div className="fll">RACE DAY{goal ? ` · ${goal.name.toUpperCase().replace(' MARATHON','').slice(0,12)}` : ''}</div>
        <div className="tbody cd">
          <div className="cdbig">{goal?.daysAway ?? '·'}</div>
          <div className="cdlab">DAYS TO GO</div>
          <div className="cdsub">{goal ? `${formatDate(goal.date)} · Sacramento` : '·'}</div>
          <div className="cdbar"><div className="cdfill" style={{ width: `${goal?.goalPct ?? 0}%` }} /></div>
          <div className="cdwk">{goal?.phaseLabel ?? '·'}</div>
        </div>
      </div>

      <div className="tile">
        <div className="fll">WEEKLY VOLUME</div>
        <div className="tbody vfill">
          <div className="vol">
            {seed.volumeBars.map((b, i) => (
              <i
                key={i}
                onMouseEnter={() => setHoverBar(i)}
                onMouseLeave={() => setHoverBar(null)}
                style={{
                  height: `${(b.mi / Math.max(...seed.volumeBars.map(x => x.mi))) * 100}%`,
                  background: b.current ? '#FFFFFF' : 'rgba(255,255,255,.30)',
                }}
              />
            ))}
          </div>
          <div className="volnum">{num}<small>{sub}</small></div>
        </div>
      </div>

      <div className="tile">
        <div className="fll">TRAINING FORM</div>
        <div className="tbody">
          <div className="rg" style={{ width: 124, height: 124 }}>
            <svg width="124" height="124" viewBox="0 0 124 124">
              <circle cx="62" cy="62" r="54" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="7"/>
              <circle cx="62" cy="62" r="54" fill="none" stroke="#B084FF" strokeWidth="7" strokeLinecap="round" strokeDasharray="339.3" strokeDashoffset="169.6" transform="rotate(-90 62 62)"/>
            </svg>
            <div className="rgc">
              <b style={{ fontSize: 32, color: '#B084FF' }}>{seed.form.delta >= 0 ? '+' : '−'}{Math.abs(seed.form.delta)}</b>
              <span>{seed.form.label}</span>
            </div>
          </div>
          <div className="formsub">Fitness {seed.form.fitness} · Fatigue {seed.form.fatigue}</div>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}
