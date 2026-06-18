'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed } from '../types';
import { EFF, KIT, PLAN_CUES, ZC, hexA } from '../constants';
import { deriveSessionSegs, fallbackSessionSegs } from '../session-shape';
import { decodePolyline, polylineToSvgPath, polylineEndpoints } from '@/lib/route/polyline';
import { WatchPreviewTimeline } from '../toolkit';

// ── forecast helpers (mirrors TodayView · same /api/forecast/${date} source) ──
type DayForecast = {
  date: string;
  temp_min_f: number | null;
  temp_max_f: number | null;
  conditions: string | null;
  range_label?: string | null;
};
function useDayForecast(dateIso: string | null | undefined): DayForecast | null {
  const [data, setData] = useState<DayForecast | null>(null);
  useEffect(() => {
    if (!dateIso) { setData(null); return; }
    let cancelled = false;
    fetch(`/api/forecast/${dateIso}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: DayForecast | null) => { if (!cancelled && j) setData(j); })
      .catch(() => { /* swallow — static fallback covers it */ });
    return () => { cancelled = true; };
  }, [dateIso]);
  return data;
}
function prettyCondition(c: string): string {
  const map: Record<string, string> = {
    clear: 'Clear', mostly_clear: 'Mostly clear', cloudy: 'Cloudy',
    fog: 'Fog', rain: 'Rain', snow: 'Snow',
    rain_shower: 'Showers', snow_shower: 'Snow showers', thunderstorm: 'Storm',
  };
  return map[c] ?? c;
}
function formatForecast(f: DayForecast | null): string | null {
  if (!f) return null;
  if (f.range_label != null) return f.range_label;
  const lo = f.temp_min_f != null ? Math.round(f.temp_min_f) : null;
  const hi = f.temp_max_f != null ? Math.round(f.temp_max_f) : null;
  const range = lo != null && hi != null && lo !== hi
    ? `${lo}-${hi}°` : (hi != null ? `${hi}°` : (lo != null ? `${lo}°` : null));
  if (!range) return null;
  const cond = f.conditions ? prettyCondition(f.conditions) : null;
  return cond ? `${range} · ${cond}` : range;
}

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
           <PlannedBody d={d} seed={seed} />}
        </div>
      </div>
    </div>
  );
}

function CompletedHero({ d, dayIdx, seed }: { d: FaffSeed['week'][number]; dayIdx: number; seed: FaffSeed }) {
  const det = seed.results[dayIdx] ?? seed.results[0]!;
  return (
    <>
      {/* 2026-06-03 · David: drop the eyebrow above the workout title in
          every surface · pure repetition of the title + week-strip
          context. Same removal applied to the TodayView heroes. */}
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
  const badge = d.today ? <span className="wk-badge today">TODAY</span> : <span className="wk-badge plan">PLANNED · WK 14</span>;
  return (
    <>
      {/* 2026-06-03 · David: drop the "TODAY · TYPE" eyebrow · same
          removal as the TodayView + CompletedHero variants. */}
      <div className="wk-title">{d.name}{badge}</div>
    </>
  );
}

function RestHero({ d: _d }: { d: FaffSeed['week'][number] }) {
  return (
    <>
      {/* 2026-06-03 · David: drop the date eyebrow · matches the rest
          of the surfaces. */}
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
      <div className="band">
        <div className="fll">MILE SPLITS</div>
        <div className="splits">
          {det.splits.map((s, i) => (
            <div className="spr" key={i}>
              <span className="spm">{s[0]}</span>
              <div className="sptrk"><div className="spf" style={{ width: `${s[1]}%`, background: s[3] }} /></div>
              <span className="spp">{s[2]}<small>/mi</small></span>
            </div>
          ))}
        </div>
      </div>
      <div className="band">
        <div className="fll">TIME IN ZONES</div>
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
      </div>
      <div className="band">
        <div className="fll">CONDITIONS &amp; KIT</div>
        <div className="wk-grid">
          <div className="i"><div className="k">WEATHER</div><div className="v">{det.weather}</div></div>
          <div className="i"><div className="k">SHOE</div><div className="v">{det.shoe}</div></div>
          <div className="i"><div className="k">FUEL</div><div className="v">{det.fuel ?? ' · '}</div></div>
          <div className="i"><div className="k">CALORIES</div><div className="v">{det.cal} kcal</div></div>
        </div>
      </div>
      {det.recap && (
        <div className="coach">
          <span className="ct">COACH</span><span className="cx">{det.recap}</span>
        </div>
      )}
    </>
  );
}

function PlannedBody({ d, seed }: { d: FaffSeed['week'][number]; seed: FaffSeed }) {
  // 2026-06-02 · spec-driven session shape (was SEGS prototype data)
  const totalMi = parseFloat(d.dist || '0') || 0;
  const sg = deriveSessionSegs(d.workoutSpec ?? null, totalMi, d.type, d.pace)
    ?? fallbackSessionSegs(d.type, totalMi, d.pace)
    ?? [];
  const k = KIT[d.type];
  const pl = PLAN_CUES[d.type] ?? PLAN_CUES.easy;
  // Live forecast + shoe — same sources as the primary TodayView card.
  // 2026-06-10 honesty pass: no KIT placeholder fallbacks — when the
  // real chain is empty render '—', never a shoe the runner doesn't
  // own or weather nobody measured.
  const forecast = useDayForecast(d.iso ?? null);
  const weatherLabel = formatForecast(forecast) ?? null;
  const shoeLabel = (d.today && seed.todayShoeId != null
    ? seed.shoes.find((s) => s.id === seed.todayShoeId)?.nm
    : null) ?? (seed.shoeRecByType[d.type] || null);
  return (
    <>
      <AdaptationBlock d={d} />
      <div className="wk-keyrow">
        <div><div className="k">DISTANCE</div><div className="v">{d.dist}<small> mi</small></div></div>
        <div><div className="k">TARGET PACE</div><div className="v">{d.pace}<small>{/:/.test(d.pace) ? '/mi' : ''}</small></div></div>
        <div><div className="k">EST TIME</div><div className="v">{d.est.replace('~','')}</div></div>
      </div>
      {sg.length > 0 ? (
        <div className="band">
          <div className="fll">THE SHAPE</div>
          <div className="wk-shape">
            {sg.map((x, i) => <i key={i} style={{ width: `${x.w}%`, background: x.c }} />)}
          </div>
          <div className="wk-shapelab">
            <span>{sg[0].l}</span>
            {sg.length > 1 && <span>{sg[sg.length - 1].l}</span>}
          </div>
        </div>
      ) : null}
      <div className="band">
        <div className="fll">THE SESSION</div>
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
      </div>
      <div className="band">
        <div className="fll">CONDITIONS &amp; FUEL</div>
        <div className="wk-grid">
          <div className="i"><div className="k">WEATHER</div><div className="v">{weatherLabel ?? '—'}</div></div>
          <div className="i"><div className="k">SHOE</div>   <div className="v">{shoeLabel ?? '—'}</div></div>
          {pl.fuel.map((f, i) => (
            <div className="i" key={i}><div className="k">{f[0].toUpperCase()}</div><div className="v">{f[1]}</div></div>
          ))}
        </div>
      </div>
      <div className="band">
        <div className="fll">EXECUTE</div>
        <ul className="wk-cues">{pl.cues.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </div>
      <div className="coach">
        <span className="ct">COACH</span><span className="cx">{k.coach}</span>
      </div>
      {/* Watch preview · what the watch will buzz you through. Live
          fetch from /api/watch/today?date=. Closes coverage line 689. */}
      {d.iso ? (
        <>
          <div className="band">
            <div className="fll">WATCH PREVIEW</div>
            <WatchPreviewTimeline date={d.iso} />
          </div>
        </>
      ) : null}
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
      <div className="coach">
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
      <div className="fll">ROUTE</div>
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
            <path d={routePath} fill="none" stroke="#E88021" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            {endpoints && <circle cx={endpoints.start[0]} cy={endpoints.start[1]} r="6" fill="#04201f" stroke="#14C08C" strokeWidth="3" />}
            {endpoints && <circle cx={endpoints.end[0]} cy={endpoints.end[1]} r="6" fill="#E88021" stroke="#fff" strokeWidth="2" />}
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

/* ============================================================
   AdaptationBlock · "How it changed" section for adapted workouts.
   Renders only when d.adaptation.wasAdapted is true (backend's
   AdaptationInfo envelope · commit a54c7069). Honors the doctrine
   constraints from designs/briefs/readiness-drawer-redesign-data-
   brief.md · descriptive only (no prescription), surfaces the raw
   reason from coach_intents. The reason text style varies across
   historical vs new adaptations (backend honest about not falsifying
   audit history) · this component tolerates both voices.
   ============================================================ */
function AdaptationBlock({ d }: { d: FaffSeed['week'][number] }) {
  const a = d.adaptation;
  // Hooks must run unconditionally · early return AFTER hook declarations.
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  if (!a?.wasAdapted) return null;
  const wasLabel = a.originalSubLabel || a.originalType;
  const kindCopy: Record<string, string> = {
    downgrade:   'Downgraded',
    reschedule:  'Rescheduled',
    shave:       'Shortened',
    mark_dirty:  'Paces refreshed',
    other:       'Adjusted',
  };
  const verb = kindCopy[a.kind ?? 'other'] ?? 'Adjusted';
  const adaptedAtLabel = (() => {
    if (!a.adaptedAt) return null;
    const t = new Date(a.adaptedAt);
    if (!Number.isFinite(t.getTime())) return null;
    const today = new Date();
    const sameDay = t.toDateString() === today.toDateString();
    if (sameDay) return 'Earlier today';
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (t.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return t.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  })();
  // Distance change subline · only meaningful for shave kind (or any
  // adapt where original_distance differs from current). Avoids saying
  // "shortened" without a number.
  const shavedFrom = (a.originalDistanceMi != null && a.kind === 'shave')
    ? `${a.originalDistanceMi.toFixed(1)} mi → ${d.dist} mi`
    : null;
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(255,206,138,0.10), rgba(255,206,138,0.02))',
        border: '1px solid rgba(255,206,138,0.35)',
        borderRadius: 12,
        padding: 'var(--callout-padding)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--label-gap)',
      }}
      role="region"
      aria-label="How this workout changed"
    >
      <div style={{
        fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
        color: '#F3AD38',
      }}>
        HOW IT CHANGED
      </div>
      <div style={{
        fontSize: 14, fontWeight: 600, lineHeight: 1.35,
        color: 'var(--ink, #fff)',
      }}>
        {verb}{wasLabel ? <> from <b>{wasLabel}</b></> : null}
        {a.kind === 'downgrade' && d.name ? <> to <b>{d.name}</b></> : null}
        {shavedFrom ? <> · {shavedFrom}</> : null}
      </div>
      {adaptedAtLabel ? (
        <div style={{
          fontSize: 11, color: 'var(--mute, #8B95A7)',
        }}>
          {adaptedAtLabel}
        </div>
      ) : null}
      {a.reason ? (
        <div style={{
          fontSize: 13, lineHeight: 1.5,
          color: 'var(--ink, #fff)', opacity: 0.92,
        }}>
          {a.reason}
        </div>
      ) : null}

      {/* Restore button · POST /api/plan/restore (backend commit
          d8a4082d). Surfaces only when planWorkoutId is known and the
          day isn't already restored. After a successful restore the
          chip's "was X" subline clears on next refresh. */}
      {d.planWorkoutId && !restored ? (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            disabled={restoring}
            onClick={async () => {
              if (!d.planWorkoutId) return;
              setRestoring(true);
              setRestoreErr(null);
              try {
                const r = await fetch('/api/plan/restore', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ workoutId: d.planWorkoutId }),
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok || !(j as { ok?: boolean }).ok) {
                  const raw = (j as { error?: string }).error ?? `HTTP ${r.status}`;
                  // eslint-disable-next-line no-console
                  console.error('[restore] backend error', { raw, status: r.status, body: j, workoutId: d.planWorkoutId });
                  const friendly = /operator does not exist|relation|column.*does not exist/i.test(raw)
                      ? 'Cannot restore right now. Try again in a moment.'
                    : raw === 'not_adapted'         ? 'This run has no original to restore.'
                    : raw === 'missing_originals'   ? 'No original on record for this run.'
                    : raw === 'cannot_restore_past' ? "Can't restore a completed run."
                    : raw === 'workout_not_found'   ? "Couldn't find this run."
                    : raw === 'workoutId_required' || raw === 'invalid_json' ? 'Restore request was malformed.'
                    : 'Cannot restore right now. Try again in a moment.';
                  setRestoreErr(friendly);
                  return;
                }
                setRestored(true);
                router.refresh();
              } catch {
                setRestoreErr('Could not reach the server. Check your connection and try again.');
              } finally {
                setRestoring(false);
              }
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent',
              border: '1px solid rgba(255,206,138,0.42)',
              color: '#F3AD38',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
              textTransform: 'uppercase',
              cursor: restoring ? 'wait' : 'pointer',
              opacity: restoring ? 0.6 : 1,
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 4v6h6"/><path d="M20 20a8 8 0 0 0-13.6-5.6L4 17"/>
            </svg>
            {restoring ? 'Restoring…' : 'Restore original'}
          </button>
        </div>
      ) : null}

      {restored ? (
        <div style={{ fontSize: 12, color: '#F3AD38' }}>
          Restored to original. Refreshing…
        </div>
      ) : null}

      {restoreErr ? (
        <div style={{ fontSize: 12, color: '#FC4D64' }}>
          {restoreErr}
        </div>
      ) : null}
    </div>
  );
}
