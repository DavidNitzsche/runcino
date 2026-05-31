'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FaffSeed } from '../types';
import { EFF, SEGS, KIT, ROLECOL } from '../constants';
import { elevPathFromSplits, decodePolyline, polylineToSvgPath, polylineEndpoints } from '@/lib/route/polyline';

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

      {/* 2026-05-31: post-run detail (v2) takes over the hero on done days.
          Layout per "Post-Run Detail (Easy)" handoff: leftstack (stats + zones
          + conditions incl. shoe picker) → GPS route map → wcard (HOW IT WENT
          verdict + recap + splits). Planned + rest days keep the existing
          hero layout below until the upcoming-run design lands. */}
      {d.done && !isRest ? (
        <CompletedHeroV2
          d={d}
          result={result}
          runData={runData}
          runLoading={runLoading}
          resolvedTime={resolvedTime}
          resolvedPace={resolvedPace}
          resolvedHr={resolvedHr}
          resolvedTempF={resolvedTempF}
          resolvedGainFt={resolvedGainFt ?? undefined}
          resolvedShoeNm={resolvedShoeNm ?? undefined}
          shoes={seed.shoes}
          seedShoe={(seed.todayShoeId != null
            ? seed.shoes.find(s => s.id === seed.todayShoeId)?.nm
            : null) ?? seed.shoeRecByType[d.type] ?? KIT[d.type].shoe}
          persistShoe={curDay === seed.todayIdx}
        />
      ) : (
        <div className="hero">
          <div className="hmain">
            <div className="htag">
              {(d.today ? 'TODAY · ' : `${d.dw} · `) + d.type.toUpperCase()}
            </div>
            <div className="htitle">{d.name}</div>
            <div className="stats">
              {isRest ? (
                <>
                  <div><div className="v">{formatSleep(seed.health.body.find(m => m.k === 'sleep')?.current)}</div><div className="k">SLEEP</div></div>
                  <div><div className="v">{Math.round(seed.health.body.find(m => m.k === 'rhr')?.current ?? 0) || '·'}<small> bpm</small></div><div className="k">RESTING HR</div></div>
                  <div><div className="v">{Math.round(seed.health.body.find(m => m.k === 'hrv')?.current ?? 0) || '·'}<small> ms</small></div><div className="k">HRV</div></div>
                </>
              ) : (
                <>
                  <div><div className="v">{d.dist}<small> mi</small></div><div className="k">DISTANCE</div></div>
                  <div><div className="v">{d.pace}<small>{/:/.test(d.pace) ? '/mi' : ''}</small></div><div className="k">TARGET PACE</div></div>
                  <div><div className="v">{d.est}<small></small></div><div className="k">EST TIME</div></div>
                </>
              )}
            </div>
            {!isRest && (
              <div className="effort">
                <div className="etrack">
                  <div className="emark" style={{ left: `${e.mark}%` }}>
                    <span className="elbl">{e.lbl}</span><span className="ecaret" />
                  </div>
                </div>
                <div className="ezones"><span>Z1</span><span>Z2</span><span>Z3</span><span>Z4</span><span>Z5</span></div>
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
            seedShoe={(seed.todayShoeId != null
              ? seed.shoes.find(s => s.id === seed.todayShoeId)?.nm
              : null) ?? seed.shoeRecByType[d.type] ?? KIT[d.type].shoe}
            persistShoe={curDay === seed.todayIdx}
          />
        </div>
      )}

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
  distance_mi?: number;
  hrZonePcts?: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
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

/* ───────────────  CompletedHeroV2 (Post-Run Detail · Easy)  ───────────────
 * Implements the approved 2026-05-31 design (project Post-Run Detail (Easy).html).
 * Layout:  [hmain (htag + title + check + hbody[leftstack + mapcol])]  [wcard]
 *  - hmain.titlerow:  "EASY"  +  green check (no "On plan" text)
 *  - hmain.leftstack: stats / time-in-zones / conditions grid w/ shoe picker
 *  - hmain.mapcol:    real GPS polyline (or "ROUTE FROM GPS" placeholder)
 *  - wcard:           "HOW IT WENT · ON PLAN" verdict + recap + mile splits
 *
 * Effort theme tokens are inherited from the surrounding mesh (Shell already
 * sets the effort-driven mesh on completed days), so the hero picks up the
 * green/teal "easy" feel without per-component overrides.
 */
function deriveVerdict(d: FaffSeed['week'][number], runData: RunSummary | null): string {
  const planned = Number(d.dist) || 0;
  const actual  = runData?.distance_mi ?? planned;
  if (planned && actual >= planned * 0.95 && actual <= planned * 1.1) {
    if (d.type === 'easy')      return 'Textbook easy day.';
    if (d.type === 'long')      return 'Held the long-run line.';
    if (d.type === 'tempo')     return 'Tempo locked in.';
    if (d.type === 'intervals') return 'Reps hit clean.';
    if (d.type === 'recovery')  return 'Recovery on target.';
    return 'On plan.';
  }
  if (planned && actual < planned * 0.95) return 'Tucked in under target.';
  if (planned && actual > planned * 1.1)  return 'Went a touch deeper than planned.';
  return 'Run logged.';
}

function deriveRecap(d: FaffSeed['week'][number], runData: RunSummary | null): string {
  const z = runData?.hrZonePcts;
  if (z) {
    const z2 = z.z2 ?? 0;
    const z4 = (z.z4 ?? 0) + (z.z5 ?? 0);
    if (d.type === 'easy' && z2 >= 60)
      return 'Held Zone 2 the whole way and never let the pace creep. The quiet aerobic work the plan wants.';
    if ((d.type === 'tempo' || d.type === 'intervals') && z4 >= 25)
      return 'Got into the threshold band and held it. Plan called for it, you delivered.';
    if (d.type === 'long' && z2 >= 50)
      return 'Aerobic the whole way. The miles bank for race day.';
  }
  if (d.type === 'easy')      return 'Easy day in the bank. Don\'t overthink it.';
  if (d.type === 'long')      return 'Long run done. Recover and roll into the next quality day.';
  if (d.type === 'tempo')     return 'Tempo in the book. Threshold work compounds.';
  if (d.type === 'intervals') return 'Reps done. The engine got a real ask.';
  if (d.type === 'recovery')  return 'Recovery jog logged. Easy is the assignment.';
  return 'Logged.';
}

function CompletedHeroV2({
  d, result, runData, runLoading,
  resolvedTime, resolvedPace, resolvedHr, resolvedTempF, resolvedGainFt, resolvedShoeNm,
  shoes, seedShoe, persistShoe,
}: {
  d: FaffSeed['week'][number];
  result?: FaffSeed['results'][number];
  runData: RunSummary | null;
  runLoading: boolean;
  resolvedTime: string | undefined;
  resolvedPace: string | undefined;
  resolvedHr: number | undefined;
  resolvedTempF: number | null;
  resolvedGainFt: number | undefined;
  resolvedShoeNm: string | undefined;
  shoes: FaffSeed['shoes'];
  seedShoe: string;
  persistShoe: boolean;
}) {
  // Decode the run's GPS polyline once per runData change.
  const route = (() => {
    if (!runData?.route_polyline) return null;
    const pts = decodePolyline(runData.route_polyline);
    const path = polylineToSvgPath(pts, 700, 360, 18);
    const ends = polylineEndpoints(pts, 700, 360, 18);
    return path ? { path, ends } : null;
  })();

  const verdict = deriveVerdict(d, runData);
  const recap   = (result?.recap?.trim()) || deriveRecap(d, runData);

  // Zones from runData (preferred) → seed.results placeholder fallback.
  const zonePcts = runData?.hrZonePcts
    ? [runData.hrZonePcts.z1 ?? 0, runData.hrZonePcts.z2 ?? 0, runData.hrZonePcts.z3 ?? 0, runData.hrZonePcts.z4 ?? 0, runData.hrZonePcts.z5 ?? 0]
    : (result?.zones ?? [0, 0, 0, 0, 0]);
  const zoneColors = ['#54ddd0', '#8ef0b0', '#ffe0a0', '#ff9560', '#ff5a52'];
  const peakHr = runData?.hr_max ?? result?.peak ?? null;

  const splits = (runData?.splits ?? []).slice(0, 8);

  return (
    <div className="hero-v2">
      <div className="hmain">
        <div className="htag">{(d.today ? 'TODAY' : d.dw) + ' · ' + d.type.toUpperCase() + ' · DONE'}</div>
        <div className="titlerow">
          <h1 className="htitle">{d.name}</h1>
          <span className="check" title="On plan" aria-label="On plan">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          </span>
        </div>

        <div className="hbody">
          <div className="leftstack">
            <div className="stats">
              <div><div className="v">{d.dist}<small> mi</small></div><div className="k">DISTANCE</div></div>
              <div><div className="v">{resolvedTime ?? '·'}</div><div className="k">TIME{runLoading && !runData ? ' …' : ''}</div></div>
              <div><div className="v">{resolvedPace ?? '·'}<small>/mi</small></div><div className="k">AVG PACE</div></div>
            </div>

            <div className="zones">
              <div className="zhead">
                <span>TIME IN ZONES</span>
                <span className="zmeta">avg ♥ <b>{resolvedHr ?? '·'}</b> · pk <b>{peakHr ?? '·'}</b></span>
              </div>
              <div className="zbar">
                {zonePcts.map((p, zi) => p > 0 && (
                  <i key={zi} style={{ width: `${p}%`, background: zoneColors[zi] }} />
                ))}
              </div>
              <div className="zleg">
                {zonePcts.map((p, zi) => (
                  <div key={zi} style={p === 0 ? { opacity: 0.4 } : undefined}>
                    <span className="zs" style={{ background: zoneColors[zi] }} />
                    Z{zi + 1} <b>{Math.round(p)}%</b>
                  </div>
                ))}
              </div>
            </div>

            <div className="cond">
              <div>
                <div className="kcl">WEATHER</div>
                <div className="kcv">{resolvedTempF != null ? `${Math.round(resolvedTempF)}°F` : '·'}</div>
              </div>
              <div>
                <div className="kcl">SHOE</div>
                <ShoePicker shoes={shoes} initial={resolvedShoeNm?.trim() || seedShoe} persist={persistShoe} />
              </div>
              <div>
                <div className="kcl">ELEV GAIN</div>
                <div className="kcv">{resolvedGainFt != null && resolvedGainFt > 0 ? `${resolvedGainFt} ft` : '·'}</div>
              </div>
              <div>
                <div className="kcl">{runData?.power_avg_w != null ? 'AVG POWER' : 'CALORIES'}</div>
                <div className="kcv">{runData?.power_avg_w != null ? `${runData.power_avg_w} W` : (result?.cal && result.cal > 0 ? `${result.cal} kcal` : '·')}</div>
              </div>
            </div>
          </div>

          <div className="mapcol">
            <div className="routemap">
              {route ? (
                <svg viewBox="0 0 700 360" preserveAspectRatio="xMidYMid meet">
                  <path d={route.path} fill="none" stroke="#FF8847" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                  {route.ends && <circle cx={route.ends.start[0]} cy={route.ends.start[1]} r="7" fill="#04201f" stroke="#14C08C" strokeWidth="3" />}
                  {route.ends && <circle cx={route.ends.end[0]} cy={route.ends.end[1]} r="7" fill="#FF8847" stroke="#fff" strokeWidth="2" />}
                </svg>
              ) : (
                <div className="ph">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20l-5.5 2.5V6L9 3.5m0 16.5l6 2.5m-6-2.5V3.5m6 19L20.5 20V3.5L15 6m0 16.5V6m0 0L9 3.5"/></svg>
                  <span>{runLoading ? 'LOADING ROUTE…' : 'NO GPS TRACK FOR THIS RUN'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <aside className="wcard">
        <div className="wcl">
          HOW IT WENT
          <span className="ok">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            ON PLAN
          </span>
        </div>
        <div className="verdict">{verdict}</div>
        <div className="recap">{recap}</div>
        <div className="divider" />
        <div className="reshead">
          <span>MILE SPLITS</span>
          {resolvedPace && <span className="rs">avg {resolvedPace}<small>/mi</small></span>}
        </div>
        <div className="splits">
          {splits.length > 0 ? splits.map((s, i) => {
            // Bar width: inverse-relative — faster splits read fuller. Falls
            // back to a neutral 60% when pace data is missing.
            const sec = paceToSec(s.pace ?? '');
            const all = splits.map(x => paceToSec(x.pace ?? '')).filter(n => n > 0);
            const lo = all.length ? Math.min(...all) : 0;
            const hi = all.length ? Math.max(...all) : 1;
            const span = Math.max(1, hi - lo);
            const w = sec > 0 ? Math.round(55 + (1 - (sec - lo) / span) * 40) : 60;
            return (
              <div className="spr" key={i}>
                <span className="spm">{s.mile}</span>
                <div className="sptrk"><div className="spf" style={{ width: `${w}%` }} /></div>
                <span className="spp">{s.pace ?? '·'}<small>/mi</small></span>
              </div>
            );
          }) : (
            <div style={{ fontSize: 12, opacity: 0.55, marginTop: 6 }}>
              {runLoading ? 'Loading splits…' : 'No mile splits available.'}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

type DayForecast = {
  date: string;
  temp_min_f: number | null;
  temp_max_f: number | null;
  conditions: string | null;
  precip_chance_pct: number | null;
  wind_mph: number | null;
};

/** Lazy-fetch the day's forecast for a planned (not done) date. Used to
 *  replace the old KIT[d.type].weather hardcoded "64° · Calm" placeholder
 *  with a real temp range + conditions. Past days surface actual Strava
 *  weather via the run-detail fetch. */
function useDayForecast(dateIso: string | null | undefined): DayForecast | null {
  const [data, setData] = useState<DayForecast | null>(null);
  useEffect(() => {
    if (!dateIso) { setData(null); return; }
    let cancelled = false;
    fetch(`/api/forecast/${dateIso}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: DayForecast | null) => { if (!cancelled && j) setData(j); })
      .catch(() => { /* swallow — card hides if no forecast */ });
    return () => { cancelled = true; };
  }, [dateIso]);
  return data;
}

/** "62-78° · cloudy" or "62-78°" when no condition label. Returns null
 *  when the forecast is missing both min and max. */
function formatForecast(f: DayForecast | null): string | null {
  if (!f) return null;
  const lo = f.temp_min_f != null ? Math.round(f.temp_min_f) : null;
  const hi = f.temp_max_f != null ? Math.round(f.temp_max_f) : null;
  const range = lo != null && hi != null && lo !== hi
    ? `${lo}-${hi}°`
    : (hi != null ? `${hi}°` : (lo != null ? `${lo}°` : null));
  if (!range) return null;
  const cond = f.conditions ? prettyCondition(f.conditions) : null;
  return cond ? `${range} · ${cond}` : range;
}
function prettyCondition(c: string): string {
  switch (c) {
    case 'clear':        return 'Clear';
    case 'mostly_clear': return 'Mostly clear';
    case 'cloudy':       return 'Cloudy';
    case 'fog':          return 'Fog';
    case 'rain':         return 'Rain';
    case 'snow':         return 'Snow';
    case 'rain_shower':  return 'Showers';
    case 'snow_shower':  return 'Snow showers';
    case 'thunderstorm': return 'Storm';
    default:             return c;
  }
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
  // 2026-05-30: real forecast for the day of the run replaces the
  // hardcoded "64° · Calm" placeholder. Shows a temp range (no run-time
  // pinned yet, so range is honest), conditions when present. Falls
  // through to "—" when no forecast is available (date out of range, or
  // no home GPS yet) — better than fake weather.
  const forecast = useDayForecast(d.iso);
  const weatherLabel = formatForecast(forecast) ?? '—';
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
        <div className="kc"><div className="kcl">WEATHER</div><div className="kcv">{weatherLabel}</div></div>
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
  const [mounted, setMounted] = useState(false);
  // 2026-05-30: dropdown menu rendered via React Portal to document.body.
  // The parent .wcard / .tile both have backdrop-filter, which establishes
  // a CSS stacking context — z-index on the menu can't escape it (David's
  // screenshot: dropdown rendered behind Training Form tile). Portaling
  // gets the menu out of the stacking hierarchy entirely.
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number }>({ top: 0, left: 0, minWidth: 220 });

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        top: r.bottom + window.scrollY + 6,
        left: r.left + window.scrollX,
        minWidth: Math.max(220, r.width),
      });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

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

  const menu = open && mounted ? createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'absolute', zIndex: 9999,
        top: pos.top, left: pos.left, minWidth: pos.minWidth,
        background: '#171922', border: '1px solid rgba(255,255,255,.16)',
        borderRadius: 13, padding: 6, boxShadow: '0 22px 54px -20px rgba(0,0,0,.85)',
      }}
    >
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
    </div>,
    document.body
  ) : null;

  return (
    <div ref={triggerRef} style={{ display: 'inline-block' }}>
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
      {menu}
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
