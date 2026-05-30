'use client';

import { useEffect, useState } from 'react';
import type { FaffSeed } from '../types';
import { EFF, SEGS, KIT, PLAN_CUES, ZC, hexA } from '../constants';
import { decodePolyline, polylineToSvgPath, polylineEndpoints } from '@/lib/route/polyline';

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
);

function CloseX({ onClose }: { onClose: () => void }) {
  return (
    <div className="ovx" onClick={onClose} role="button" tabIndex={0} aria-label="Close" style={{ top: 22, right: 22 }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </div>
  );
}

export function WorkoutDetail({ open, onClose, dayIdx, seed }: {
  open: boolean; onClose: () => void; dayIdx: number; seed: FaffSeed;
}) {
  if (!open) return null;
  const d = seed.week[dayIdx];
  if (!d) return null;
  const e = EFF[d.type];
  const m = e.mesh;
  const heroStyle = { background: `linear-gradient(150deg,${hexA(m[3], 0.42)},${hexA(m[4], 0.18)} 60%,transparent)` };
  const cardStyle = { background: `linear-gradient(180deg,${hexA(m[5], 0)} 0%,transparent 40%),#12131A` };

  return (
    <div className="ov open">
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard wkdet" style={cardStyle}>
        <div className="wk-hero" style={heroStyle}>
          <CloseX onClose={onClose} />
          {d.done ? <CompletedHero d={d} dayIdx={dayIdx} seed={seed} /> :
           d.type === 'rest' ? <RestHero d={d} /> :
           <PlannedHero d={d} />}
        </div>
        <div className="wk-body">
          {d.done ? <CompletedBody d={d} dayIdx={dayIdx} seed={seed} /> :
           d.type === 'rest' ? <RestBody /> :
           <PlannedBody d={d} />}
        </div>
      </div>
    </div>
  );
}

function CompletedHero({ d, dayIdx, seed }: { d: FaffSeed['week'][number]; dayIdx: number; seed: FaffSeed }) {
  const det = seed.results[dayIdx] ?? seed.results[0]!;
  return (
    <>
      <div className="wk-eyebrow">{d.full.toUpperCase()}</div>
      <div className="wk-title">
        {d.name}
        <span className="wk-badge done"><Check />DONE</span>
      </div>
      <div className="wk-win">
        <span className="c"><Check /></span>{det.win}<small>{det.winx}</small>
      </div>
    </>
  );
}

function PlannedHero({ d }: { d: FaffSeed['week'][number] }) {
  const dateLbl = (d.today ? 'TODAY · ' : `${d.dw} · `) + d.type.toUpperCase();
  const badge = d.today ? <span className="wk-badge today">TODAY</span> : <span className="wk-badge plan">PLANNED · WK 14</span>;
  return (
    <>
      <div className="wk-eyebrow">{dateLbl}</div>
      <div className="wk-title">{d.name}{badge}</div>
    </>
  );
}

function RestHero({ d }: { d: FaffSeed['week'][number] }) {
  return (
    <>
      <div className="wk-eyebrow">{d.full.toUpperCase()}</div>
      <div className="wk-title">Rest Day<span className="wk-badge plan">OFF</span></div>
    </>
  );
}

function CompletedBody({ d, dayIdx, seed }: { d: FaffSeed['week'][number]; dayIdx: number; seed: FaffSeed }) {
  const det = seed.results[dayIdx] ?? seed.results[0]!;
  return (
    <>
      <div className="wk-keyrow">
        <div><div className="k">DISTANCE</div><div className="v">{d.dist}<small> mi</small></div></div>
        <div><div className="k">TIME</div>    <div className="v">{det.time}</div></div>
        <div><div className="k">AVG PACE</div><div className="v">{det.apace}<small>/mi</small></div></div>
        <div><div className="k">AVG HR</div>  <div className="v">{det.hr}<small> bpm</small></div></div>
        <div><div className="k">GAIN</div>    <div className="v">{det.gain}<small> ft</small></div></div>
      </div>
      <RouteMap dist={d.dist} gain={det.gain} activityId={d.activityId ?? null} />
      <div className="fll" style={{ marginTop: 22 }}>MILE SPLITS</div>
      <div className="splits">
        {det.splits.map((s, i) => (
          <div className="spr" key={i}>
            <span className="spm">{s[0]}</span>
            <div className="sptrk"><div className="spf" style={{ width: `${s[1]}%`, background: s[3] }} /></div>
            <span className="spp">{s[2]}<small>/mi</small></span>
          </div>
        ))}
      </div>
      <div className="fll" style={{ marginTop: 22 }}>TIME IN ZONES</div>
      <div className="wk-zbar">
        {det.zones.map((p, zi) => <i key={zi} style={{ width: `${p}%`, background: ZC[zi] }} />)}
      </div>
      <div className="wk-zleg">
        {det.zones.map((p, zi) => (
          <div key={zi}>
            <span className="sw" style={{ background: ZC[zi] }} />
            <span className="zn">Z{zi + 1}</span>
            <span className="zp">{p}%</span>
          </div>
        ))}
      </div>
      <div className="fll" style={{ marginTop: 22 }}>CONDITIONS &amp; KIT</div>
      <div className="wk-grid">
        <div className="i"><div className="k">WEATHER</div><div className="v">{det.weather}</div></div>
        <div className="i"><div className="k">SHOE</div><div className="v">{det.shoe}</div></div>
        <div className="i"><div className="k">FUEL</div><div className="v">{det.fuel ?? ' · '}</div></div>
        <div className="i"><div className="k">CALORIES</div><div className="v">{det.cal} kcal</div></div>
      </div>
      {det.recap && (
        <div className="coach" style={{ marginTop: 22 }}>
          <span className="ct">COACH</span><span className="cx">{det.recap}</span>
        </div>
      )}
    </>
  );
}

function PlannedBody({ d }: { d: FaffSeed['week'][number] }) {
  const sg = SEGS[d.type];
  const k = KIT[d.type];
  const pl = PLAN_CUES[d.type] ?? PLAN_CUES.easy;
  return (
    <>
      <div className="wk-keyrow">
        <div><div className="k">DISTANCE</div><div className="v">{d.dist}<small> mi</small></div></div>
        <div><div className="k">TARGET PACE</div><div className="v">{d.pace}<small>{/:/.test(d.pace) ? '/mi' : ''}</small></div></div>
        <div><div className="k">EST TIME</div><div className="v">{d.est.replace('~','')}</div></div>
      </div>
      <div className="fll">THE SHAPE</div>
      <div className="wk-shape">
        {sg.map((x, i) => <i key={i} style={{ width: `${x.w}%`, background: x.c }} />)}
      </div>
      <div className="wk-shapelab">
        <span>{sg[0].l}</span>
        {sg.length > 1 && <span>{sg[sg.length - 1].l}</span>}
      </div>
      <div className="fll" style={{ marginTop: 22 }}>THE SESSION</div>
      <div className="wk-sess">
        {sg.map((x, i) => (
          <div className="wk-srow" key={i}>
            <span className="tick" style={{ background: x.c }} />
            <div>
              <div className="sl">{x.l}</div>
              <div className="sd">{x.sub}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="fll" style={{ marginTop: 22 }}>CONDITIONS &amp; FUEL</div>
      <div className="wk-grid">
        <div className="i"><div className="k">WEATHER</div><div className="v">{k.weather}</div></div>
        <div className="i"><div className="k">SHOE</div>   <div className="v">{k.shoe}</div></div>
        {pl.fuel.map((f, i) => (
          <div className="i" key={i}><div className="k">{f[0].toUpperCase()}</div><div className="v">{f[1]}</div></div>
        ))}
      </div>
      <div className="fll" style={{ marginTop: 22 }}>EXECUTE</div>
      <ul className="wk-cues">{pl.cues.map((c, i) => <li key={i}>{c}</li>)}</ul>
      <div className="coach" style={{ marginTop: 20 }}>
        <span className="ct">COACH</span><span className="cx">{k.coach}</span>
      </div>
    </>
  );
}

function RestBody() {
  return (
    <>
      <div className="wk-rest">
        <div className="rh">Recover.</div>
        <div className="rs">Six days on. This is where the work sets in. Let the adaptation happen. Nothing to chase today.</div>
      </div>
      <div className="wk-recov">
        <div className="wk-rcard">
          <div className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="#8fe9d8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
          </div>
          <div>
            <div className="t">Sleep</div>
            <div className="d">your biggest recovery lever</div>
          </div>
          <span className="vv">8h target</span>
        </div>
        <div className="wk-rcard">
          <div className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="#8fe9d8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4v16M4 8h10l-2 4 2 4H4"/></svg>
          </div>
          <div>
            <div className="t">Mobility &amp; Normatec</div>
            <div className="d">15 min, optional</div>
          </div>
          <span className="vv">→</span>
        </div>
      </div>
      <div className="coach" style={{ marginTop: 24 }}>
        <span className="ct">COACH</span>
        <span className="cx">Rest is training. Sleep, hydrate, mobilize. Let the work land. Feeling antsy? An easy 20-min shakeout is fine, but don&rsquo;t turn it into a session.</span>
      </div>
    </>
  );
}

function RouteMap({ dist, gain, activityId }: { dist: string; gain: number; activityId: string | null }) {
  // 2026-05-30: lazy-fetch the run detail so we can render the actual
  // encoded route polyline instead of a hardcoded zigzag. When the run
  // has no GPS payload, show an honest "Route unavailable" surface.
  const [routePath, setRoutePath] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<{ start: [number, number]; end: [number, number] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activityId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/runs/${encodeURIComponent(activityId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j: { route_polyline?: string | null } | null) => {
        if (cancelled || !j?.route_polyline) return;
        const decoded = decodePolyline(j.route_polyline);
        const path = polylineToSvgPath(decoded, 700, 168, 14);
        const ends = polylineEndpoints(decoded, 700, 168, 14);
        if (path) setRoutePath(path);
        if (ends) setEndpoints(ends);
      })
      .catch(() => { /* swallow — fall through to unavailable state */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activityId]);

  return (
    <>
      <div className="fll" style={{ marginTop: 8 }}>ROUTE</div>
      <div className="rdmap">
        <svg viewBox="0 0 700 168" preserveAspectRatio="none">
          <defs>
            <pattern id="rdg2" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="700" height="168" fill="url(#rdg2)" />
        </svg>
        {routePath ? (
          <svg viewBox="0 0 700 168" preserveAspectRatio="xMidYMid meet">
            <path d={routePath} fill="none" stroke="#FF8847" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            {endpoints && <circle cx={endpoints.start[0]} cy={endpoints.start[1]} r="6" fill="#04201f" stroke="#14C08C" strokeWidth="3" />}
            {endpoints && <circle cx={endpoints.end[0]} cy={endpoints.end[1]} r="6" fill="#FF8847" stroke="#fff" strokeWidth="2" />}
          </svg>
        ) : (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, letterSpacing: 2, opacity: 0.55, pointerEvents: 'none',
          }}>
            {loading ? 'LOADING ROUTE…' : 'NO GPS TRACK FOR THIS RUN'}
          </div>
        )}
        {routePath && <span className="rdmaptag start">START</span>}
        {routePath && <span className="rdmaptag end">FINISH</span>}
        <div className="rdmapstat">
          <span>{dist} MI</span>{gain > 0 && <span>↗ {gain} FT</span>}
        </div>
      </div>
    </>
  );
}
