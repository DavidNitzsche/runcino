'use client';

import { useEffect, useRef, useState } from 'react';
import type { FaffSeed } from '../types';
import { EFF, SEGS, KIT, ROLECOL } from '../constants';
import { elevPathFromSplits } from '@/lib/route/polyline';

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
  // 2026-05-30: lazy-fetch the real run summary for past days so the hero
  // stats grid + heroExtra row don't render seed.results placeholder "·"
  // values. Shared with WorkoutCard/CompletedResultCard.
  const { data: runData, loading: runLoading } = useRunSummary(d.done ? d.activityId : null);
  // Resolved values prefer the live fetch over the seed placeholder when
  // the fetch has landed. Until it lands we keep the placeholder so the
  // grid doesn't flash empty.
  const resolvedTime    = runData?.time_moving ?? result?.time;
  const resolvedPace    = runData?.pace ?? result?.apace;
  const resolvedHr      = runData?.hr_avg ?? result?.hr;
  const resolvedTempF   = runData?.temp_f ?? null;
  const resolvedGainFt  = runData?.elev_gain_ft != null ? Math.round(runData.elev_gain_ft) : result?.gain;
  const resolvedShoeNm  = (() => {
    if (runData?.shoe_id != null && runData.shoes) {
      const s = runData.shoes.find(x => x.id === runData.shoe_id);
      if (s) return `${s.brand} ${s.model}`.trim();
    }
    return result?.shoe;
  })();

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
                <div><div className="v">{formatSleep(seed.health.body.find(m => m.k === 'sleep')?.current)}</div><div className="k">SLEEP</div></div>
                <div><div className="v">{Math.round(seed.health.body.find(m => m.k === 'rhr')?.current ?? 0) || '·'}<small> bpm</small></div><div className="k">RESTING HR</div></div>
                <div><div className="v">{Math.round(seed.health.body.find(m => m.k === 'hrv')?.current ?? 0) || '·'}<small> ms</small></div><div className="k">HRV</div></div>
              </>
            ) : d.done && result ? (
              <>
                <div><div className="v">{d.dist}<small> mi</small></div><div className="k">DISTANCE</div></div>
                <div><div className="v">{resolvedTime ?? '·'}</div><div className="k">TIME{runLoading && !runData ? ' …' : ''}</div></div>
                <div><div className="v">{resolvedPace ?? '·'}<small>/mi</small></div><div className="k">AVG PACE</div></div>
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
                <span>avg ♥ <b>{resolvedHr || '·'}</b> · peak <b>{runData?.hr_max || result.peak || '·'}</b></span>
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
                <div><div className="kcl">WEATHER</div><div className="kcv">{resolvedTempF != null ? `${Math.round(resolvedTempF)}°F` : (result.weather?.trim() || '·')}</div></div>
                <div><div className="kcl">SHOE</div><div className="kcv">{resolvedShoeNm?.trim() || '·'}</div></div>
                <div><div className="kcl">ELEV GAIN</div><div className="kcv">{resolvedGainFt != null && resolvedGainFt > 0 ? `${resolvedGainFt} ft` : '·'}</div></div>
                {runData?.power_avg_w != null
                  ? <div><div className="kcl">AVG POWER</div><div className="kcv">{runData.power_avg_w} W</div></div>
                  : <div><div className="kcl">CALORIES</div><div className="kcv">{result.cal > 0 ? `${result.cal} kcal` : '·'}</div></div>}
              </div>
              {result.recap && <div className="hx-recap"><span className="ct">RECAP</span>{result.recap}</div>}
            </div>
          )}
        </div>
        <WorkoutCard
          d={d}
          done={!!d.done}
          result={result}
          runData={runData}
          runLoading={runLoading}
          shoes={seed.shoes}
          // 2026-05-30: shoe pick fallback chain:
          //   1. Persisted day_actions pick (seed.todayShoeId) — runner choice.
          //   2. Coach recommendation per effort type (seed.shoeRecByType) —
          //      computed via recommendShoe(shoes, runType) from the runner's
          //      actual garage. NOT Strava.
          //   3. KIT static default — only when garage is empty.
          seedShoe={(seed.todayShoeId != null
            ? seed.shoes.find(s => s.id === seed.todayShoeId)?.nm
            : null) ?? seed.shoeRecByType[d.type] ?? KIT[d.type].shoe}
          persistShoe={curDay === seed.todayIdx}
        />
      </div>

      <Tiles seed={seed} onOpenRace={onOpenRace} />
    </>
  );
}

type RunSummary = {
  pace: string | null; time_moving: string | null;
  hr_avg: number | null; hr_max: number | null;
  elev_gain_ft: number | null;
  temp_f: number | null;
  power_avg_w: number | null;
  shoe_id: number | null;
  shoes?: Array<{ id: number; brand: string; model: string }>;
  splits: Array<{ mile: number; pace: string | null; elev_change_ft: number | null }>;
  route_polyline?: string | null;
};

/** Lazy-fetch /api/runs/[id] for a past day. Shared by the TodayView hero
 *  stats grid AND the WorkoutCard's CompletedResultCard so both surfaces
 *  show real numbers (instead of seed.results placeholder · symbols). */
function useRunSummary(activityId: string | null | undefined): { data: RunSummary | null; loading: boolean } {
  const [data, setData] = useState<RunSummary | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!activityId) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/runs/${encodeURIComponent(activityId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: RunSummary | null) => { if (!cancelled && j) setData(j); })
      .catch(() => { /* swallow */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activityId]);
  return { data, loading };
}

function CompletedResultCard({ d, fallback, runData, loading }: { d: FaffSeed['week'][number]; fallback?: FaffSeed['results'][number]; runData: RunSummary | null; loading: boolean }) {
  const data = runData;
  const splits = data?.splits?.slice(0, 16) ?? [];
  const minPaceSec = Math.min(...splits.map(s => paceToSec(s.pace ?? '')).filter(n => n > 0), 999999);
  const maxPaceSec = Math.max(...splits.map(s => paceToSec(s.pace ?? '')).filter(n => n > 0), 0);
  const span = Math.max(1, maxPaceSec - minPaceSec);
  const gainFt = data?.elev_gain_ft != null ? Math.round(data.elev_gain_ft) : (fallback?.gain ?? 0);
  // 2026-05-30: real elevation profile from this run's actual splits.
  // Was a hardcoded zigzag — identical on every past run. Now we
  // integrate elev_change_ft cumulatively to draw the real shape. If the
  // run is essentially flat (<3ft swing) or has no elev data we hide the
  // chart entirely rather than show a fake.
  const elev = (() => {
    if (!splits.length) return null;
    return elevPathFromSplits(splits, 360, 58, 4);
  })();
  return (
    <div className="wcard">
      <div className="wcl">RESULT <span style={{ color: '#7BE8A0', marginLeft: 6 }}>✓ COMPLETED</span></div>
      {!data && loading && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>Loading run…</div>}
      {elev && (
        <div className="bk-elev" style={{ marginTop: 10 }}>
          <svg viewBox="0 0 360 58" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`bke-${d.activityId ?? d.dw}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={EFF[d.type].dot} stopOpacity=".4" />
                <stop offset="1" stopColor={EFF[d.type].dot} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={elev.area} fill={`url(#bke-${d.activityId ?? d.dw})`} />
            <path d={elev.line} fill="none" stroke={EFF[d.type].dot} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      )}
      <div className="bk-elevstat">
        <span>{d.dist} MI</span>
        {gainFt > 0 && <span>↗ {gainFt} FT</span>}
        {data?.time_moving && <span>{data.time_moving}</span>}
      </div>
      {splits.length > 0 ? (
        <>
          <div className="kcl" style={{ margin: '18px 0 9px' }}>MILE SPLITS</div>
          <div className="splits" style={{ marginTop: 4 }}>
            {splits.map((s, i) => {
              const sec = paceToSec(s.pace ?? '');
              const fill = sec > 0 ? Math.round(40 + (1 - (sec - minPaceSec) / span) * 55) : 30;
              return (
                <div className="spr" key={i}>
                  <span className="spm">{s.mile}</span>
                  <div className="sptrk"><div className="spf" style={{ width: `${fill}%`, background: EFF[d.type].dot }} /></div>
                  <span className="spp">{s.pace ?? '·'}<small>/mi</small></span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 14 }}>
          {d.activityId ? 'Splits unavailable for this run.' : 'No matched run yet for this day.'}
        </div>
      )}
    </div>
  );
}
function paceToSec(p: string): number {
  if (!p) return 0;
  const parts = p.split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function WorkoutCard({ d, done, result, runData, runLoading, shoes, seedShoe, persistShoe }: { d: FaffSeed['week'][number]; done: boolean; result?: FaffSeed['results'][number]; runData: RunSummary | null; runLoading: boolean; shoes: FaffSeed['shoes']; seedShoe: string; persistShoe: boolean }) {
  if (done) {
    return <CompletedResultCard d={d} fallback={result} runData={runData} loading={runLoading} />;
  }
  // Rest day gets a recovery-focused panel, not the workout shape.
  if (d.type === 'rest') {
    return (
      <div className="wcard">
        <div className="wcl">RECOVERY</div>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 28, fontWeight: 600, lineHeight: 1, marginTop: 4 }}>Today is for healing.</div>
        <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.5, opacity: 0.86, marginTop: 12 }}>
          Six days on. This is where the work sets in. Sleep, hydrate, mobilize. Let the load land.
        </div>
        <div className="kit" style={{ marginTop: 22 }}>
          <div className="kc"><div className="kcl">SLEEP TARGET</div><div className="kcv">8h</div></div>
          <div className="kc"><div className="kcl">MOBILITY</div><div className="kcv">15 min</div></div>
          <div className="kc"><div className="kcl">FUEL</div><div className="kcv">Balanced + hydrate</div></div>
        </div>
        <div className="wcoach"><span className="ct">COACH</span>Rest is training. An easy 20-min walk is fine, but do not turn it into a session.</div>
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
        <div className="kc">
          <div className="kcl">SHOE</div>
          <ShoePicker shoes={shoes} initial={seedShoe} persist={persistShoe} />
        </div>
        <div className="kc"><div className="kcl">FUEL</div><div className="kcv">{k.fuel}</div></div>
      </div>
      <div className="wcoach"><span className="ct">COACH</span>{k.coach}</div>
    </div>
  );
}

function ShoePicker({ shoes, initial, persist }: { shoes: FaffSeed['shoes']; initial: string; persist: boolean }) {
  const [picked, setPicked] = useState(initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  // 2026-05-30: persist today's shoe selection to day_actions via
  // /api/today/shoe so the choice survives reload + shows up on the past-run
  // detail modal once the run is logged. Optimistic — UI commits the pick
  // immediately, POST runs async, failures are silent (next reload reverts).
  async function commit(s: FaffSeed['shoes'][number]) {
    setPicked(s.nm);
    setOpen(false);
    if (!persist) return;
    setSaving(true);
    try {
      await fetch('/api/today/shoe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shoe_id: String(s.id) }),
      });
    } catch { /* swallow — UI is optimistic */ }
    finally { setSaving(false); }
  }
  if (!shoes.length) {
    return <div className="kcv">{picked}</div>;
  }
  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        className="kcv"
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: saving ? 0.7 : 1 }}
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
      >
        {picked}
        <span style={{ fontSize: 9, opacity: 0.55 }}>▾</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 80, top: '100%', left: 0, marginTop: 6,
          background: '#171922', border: '1px solid rgba(255,255,255,.16)',
          borderRadius: 13, padding: 6, boxShadow: '0 22px 54px -20px rgba(0,0,0,.85)',
          minWidth: 220,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, opacity: 0.5, padding: '6px 10px 8px' }}>WORN ON THIS RUN</div>
          {shoes.map(s => (
            <div
              key={s.nm}
              onClick={() => { void commit(s); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '9px 10px', borderRadius: 9, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: '#F6F7F8',
                background: s.nm === picked ? 'rgba(255,206,138,.12)' : undefined,
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: ROLECOL[s.role] ?? '#14C08C' }} />
              {s.nm}
              <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, opacity: 0.5 }}>{s.role}</span>
            </div>
          ))}
        </div>
      )}
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
          {/* 2026-05-30: when projection hasn't computed (no recent race result
              yet → no VDOT seed), show the goal as the big number so the tile
              doesn't read as broken. Bottom row explains why. */}
          <div className="cdbig" style={{ color: goal?.projected ? (goal.onTrack ? '#3EBD41' : '#FF8847') : '#9099A8' }}>
            {goal?.projected ?? goal?.goal ?? '—'}
          </div>
          <div className="cdlab">{goal?.projected ? 'PROJECTED FINISH' : (goal ? 'TARGET FINISH' : 'NO GOAL SET')}</div>
          {goal?.projected
            ? <div className="cdsub">Goal {goal.goal} · {goal.delta}</div>
            : (goal ? <div className="cdsub" style={{ opacity: 0.7 }}>Log a recent race to project</div> : <div className="cdsub" style={{ opacity: 0.7 }}>Pick a primary race on /races</div>)}
          <div className="cdbar"><div className="cdfill" style={{ width: `${goal?.goalPct ?? 0}%`, background: goal?.onTrack ? '#3EBD41' : '#FF8847' }} /></div>
          <div className="cdwk" style={{ color: goal?.onTrack ? '#7BE8A0' : '#FFCE8A', opacity: 1 }}>
            {goal
              ? (goal.projected
                  ? (goal.onTrack ? `On track for ${goal.goal}` : `${goal.delta}`)
                  : 'Projection pending')
              : 'No goal race set'}
          </div>
        </div>
      </div>

      <div className="tile click" onClick={onOpenRace} role="button" tabIndex={0}>
        <div className="fll">RACE DAY{goal ? ` · ${goal.name.toUpperCase().replace(' MARATHON','').slice(0,12)}` : ''}</div>
        <div className="tbody cd">
          <div className="cdbig">{goal?.daysAway ?? '—'}</div>
          <div className="cdlab">{goal ? 'DAYS TO GO' : 'NO GOAL SET'}</div>
          <div className="cdsub" style={{ opacity: goal ? 1 : 0.7 }}>
            {goal ? `${formatDate(goal.date)}${goal.location ? ' · ' + goal.location : ''}` : 'Pick a primary race on /races'}
          </div>
          <div className="cdbar"><div className="cdfill" style={{ width: `${goal?.goalPct ?? 0}%` }} /></div>
          <div className="cdwk">{goal?.phaseLabel ?? (goal ? 'Building' : '—')}</div>
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
              <b style={{ fontSize: 32, color: '#B084FF' }}>{seed.form.delta >= 0 ? '+' : '−'}{Math.abs(Math.round(seed.form.delta))}</b>
              <span>{seed.form.label}</span>
            </div>
          </div>
          <div className="formsub">Fitness {seed.form.fitness} · Fatigue {seed.form.fatigue}</div>
        </div>
      </div>
    </div>
  );
}

function formatSleep(hours: number | undefined): React.ReactNode {
  if (!hours || hours <= 0) return <>·</>;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return <>{h}:{String(m).padStart(2, '0')}<small> hrs</small></>;
}
function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}
