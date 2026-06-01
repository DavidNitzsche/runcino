'use client';

import { useEffect, useState, useMemo } from 'react';
import { ZC } from '../constants';
import { decodePolyline, polylineToSvgPath, polylineEndpoints, elevPathFromSplits } from '@/lib/route/polyline';
import { PostRunCheckinChips, RPEEntryCard } from '../toolkit';

/**
 * Run-detail overlay. Opens off Activity / Recent Runs / Heatmap clicks
 * and lazy-fetches /api/runs/[id]. Shape mirrors the rich completed-run
 * card from the Faff Web App design.
 */

type RunDetail = {
  id: string;
  date: string;
  start_local: string | null;
  name: string | null;
  type: string | null;
  distance_mi: number;
  pace: string | null;
  time_moving: string | null;
  hr_avg: number | null;
  hr_max: number | null;
  cadence_avg: number | null;
  elev_gain_ft: number | null;
  temp_f: number | null;
  /** "Hotter than usual" context — run-state.ts computes weatherContext
   *  vs baseline from workout_weather_cache and stamps a one-liner when
   *  the delta is meaningful (≥8°F). null otherwise. */
  weather_context: { message: string; hr_bump_bpm: number } | null;
  /** Span-aware temp arc · "65°F → 77°F (peak 78°F)" rendering. Null on
   *  legacy single-point rows or runs without GPS. */
  temp_range_f?: { start: number | null; end: number | null; peak: number | null; mean: number | null } | null;
  /** Total calories. Strava > HK active_energy fallback. Null when
   *  neither writer had a value. */
  calories_kcal?: number | null;
  /** HR-vs-baseline delta at today's pace bucket. ≥5 bpm = meaningful
   *  for steady efforts. Null when no comparable baseline. */
  hr_on_pace_delta_bpm?: number | null;
  power_avg_w: number | null;
  splits: Array<{
    mile: number;
    pace: string | null;
    hr: number | null;
    /** Per-mile cadence (steps per minute). Surfaced under the split
     *  pace row when present so the runner can see cadence drift through
     *  the run (drops during fatigue, spikes during MP pickups). */
    cadence?: number | null;
    elev_change_ft: number | null;
    phase?: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown' | null;
  }>;
  hrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number };
  has_route: boolean;
  route_polyline: string | null;
  shoes?: Array<{ id: number; brand: string; model: string }>;
  shoe_id?: number | null;
};

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** Coach-derived "what this run did" payload from /api/runs/[id]/recap.
 *  Heat-aware: when conditions earn it the engine frames HR drift as
 *  thermoregulation (not fitness regression) and surfaces a forward-
 *  looking coach tip. Hooked here so the Activity drawer renders the
 *  same recap the Today CompletedHero shows. */
type RecapPayload = {
  verdict: string;
  facts: string[];
  coach_tip: string | null;
  conditions_note: string | null;
};

export function RunDetailModal({ open, runId, onClose }: { open: boolean; runId: string | null; onClose: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<RunDetail | null>(null);
  const [recap, setRecap] = useState<RecapPayload | null>(null);

  useEffect(() => {
    if (!open || !runId) return;
    let cancelled = false;
    setStatus('loading'); setData(null); setRecap(null);
    fetch(`/api/runs/${encodeURIComponent(runId)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: RunDetail) => { if (!cancelled) { setData(j); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    // Recap fetch runs in parallel · failure is silent so the drawer
    // renders splits + route even if the engine 404s on a malformed id.
    fetch(`/api/runs/${encodeURIComponent(runId)}/recap`)
      .then(r => r.ok ? r.json() : null)
      .then((j: any) => {
        if (cancelled || !j || j.ok !== true) return;
        setRecap({
          verdict: j.verdict,
          facts: j.facts ?? [],
          coach_tip: j.coach_tip ?? null,
          conditions_note: j.conditions_note ?? null,
        });
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [open, runId]);

  if (!open) return null;
  return (
    <div className="ov open">
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard wkdet">
        <div className="wk-hero" style={{ background: 'linear-gradient(150deg,rgba(40,28,8,.42),rgba(40,28,8,.18) 60%,transparent)' }}>
          <div className="ovx" onClick={onClose} role="button" tabIndex={0} aria-label="Close" style={{ top: 22, right: 22 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </div>
          {status === 'loading' && <div className="wk-title">Loading run…</div>}
          {status === 'error' && (
            <>
              <div className="wk-eyebrow">RUN UNAVAILABLE</div>
              <div className="wk-title">Could not load this run</div>
            </>
          )}
          {status === 'ready' && data && (
            <>
              <div className="wk-eyebrow">{formatHeroDate(data.date)} · {(data.type ?? 'RUN').toUpperCase()}</div>
              <div className="wk-title">
                {data.name || 'Run'}
                <span className="wk-badge done">DONE</span>
              </div>
            </>
          )}
        </div>
        <div className="wk-body">
          {status === 'ready' && data && (
            <>
              <div className="wk-keyrow">
                <div><div className="k">DISTANCE</div><div className="v">{data.distance_mi.toFixed(1)}<small> mi</small></div></div>
                {data.time_moving && <div><div className="k">TIME</div><div className="v">{data.time_moving}</div></div>}
                {data.pace && <div><div className="k">AVG PACE</div><div className="v">{data.pace}<small>/mi</small></div></div>}
                {data.hr_avg && <div><div className="k">AVG HR</div><div className="v">{data.hr_avg}<small> bpm</small></div></div>}
                {data.elev_gain_ft != null && data.elev_gain_ft > 0 && <div><div className="k">GAIN</div><div className="v">{Math.round(data.elev_gain_ft)}<small> ft</small></div></div>}
              </div>
              <RouteAndElev data={data} />

              {/* COACH RECAP · "what this run did" from the deterministic
                  engine. Verdict + facts replace generic "Run logged" copy
                  with research-cited framing. conditions_note + coach_tip
                  earn their own callouts when material. */}
              {recap && (
                <div style={{ marginTop: 18 }}>
                  <div className="fll" style={{ marginBottom: 6 }}>HOW IT WENT</div>
                  <div style={{
                    fontFamily: 'var(--f-display)', fontSize: 22, lineHeight: 1.15,
                    color: '#fff', marginBottom: 8,
                  }}>
                    {recap.verdict}
                  </div>
                  {recap.facts.map((f, i) => (
                    <p key={i} style={{
                      margin: '0 0 8px', fontSize: 13.5, lineHeight: 1.55,
                      color: 'rgba(255,255,255,0.86)',
                    }}>
                      {f}
                    </p>
                  ))}
                  {recap.conditions_note && (
                    // Dark glass scrim with colored accent on the label
                    // and border ONLY. Body text stays full-opacity #fff
                    // so it never fades into a warm mesh. Per the four
                    // legibility laws — guarantee contrast on the mesh,
                    // secondary text is solid, color the accent not the
                    // sentence.
                    <div style={{
                      marginTop: 10, padding: '11px 13px', borderRadius: 10,
                      background: 'rgba(10,12,16,0.62)',
                      border: '1px solid rgba(255,136,71,0.55)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                      fontSize: 13, lineHeight: 1.55, color: '#FFFFFF',
                      fontWeight: 500,
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: '1.4px',
                        textTransform: 'uppercase', color: '#FFB07A', marginBottom: 5,
                      }}>CONDITIONS</div>
                      {recap.conditions_note}
                    </div>
                  )}
                  {recap.coach_tip && (
                    <div style={{
                      marginTop: 8, padding: '11px 13px', borderRadius: 10,
                      background: 'rgba(10,12,16,0.62)',
                      border: '1px solid rgba(85,221,208,0.55)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                      fontSize: 13, lineHeight: 1.55, color: '#FFFFFF',
                      fontWeight: 500,
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: '1.4px',
                        textTransform: 'uppercase', color: '#7BE8DC', marginBottom: 5,
                      }}>COACH TIP</div>
                      {recap.coach_tip}
                    </div>
                  )}
                </div>
              )}

              {data.splits?.length > 0 && (() => {
                const maxFill = Math.max(...data.splits.map(s => paceToSec(s.pace ?? '') || 0));
                const minFill = Math.min(...data.splits.filter(s => paceToSec(s.pace ?? '') > 0).map(s => paceToSec(s.pace!) || 0));
                const span = Math.max(1, maxFill - minFill);
                const hasPhase = data.splits.some(s => s.phase && s.phase !== 'unknown');
                return (
                  <>
                    <div className="fll" style={{ marginTop: 8 }}>MILE SPLITS</div>
                    <div className="splits">
                      {data.splits.map((s, i) => {
                        const sec = paceToSec(s.pace ?? '');
                        const fillPct = sec > 0 ? Math.round(40 + (1 - (sec - minFill) / span) * 55) : 30;
                        const phaseColor = phaseColorFor(s.phase);
                        // When phase data is present, color the bar by phase
                        // (warmup → green / work → amber / recovery → blue /
                        // cooldown → mute) so MP-finish miles read distinctly
                        // from the easy build. Falls back to pace-buckets when
                        // phase data is unknown (Strava-only / apple_watch).
                        const barColor = hasPhase && phaseColor
                          ? phaseColor
                          : ZC[Math.min(4, Math.max(0, Math.round((sec - minFill) / span * 4)))];
                        return (
                          <div className="spr" key={i}>
                            <span className="spm">{s.mile}</span>
                            <div className="sptrk"><div className="spf" style={{ width: `${fillPct}%`, background: barColor }} /></div>
                            <span className="spp">{s.pace ?? '·'}<small>/mi</small></span>
                          </div>
                        );
                      })}
                    </div>
                    {hasPhase ? (
                      <div style={{
                        marginTop: 6, display: 'flex', gap: 12,
                        fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
                        textTransform: 'uppercase', color: 'var(--fa-mute, #D6DAE2)',
                      }}>
                        <span><i style={{
                          display: 'inline-block', width: 8, height: 8, background: 'var(--eff-easy, #14C08C)',
                          borderRadius: 2, marginRight: 5, verticalAlign: 'middle',
                        }} />Warmup</span>
                        <span><i style={{
                          display: 'inline-block', width: 8, height: 8, background: 'var(--eff-tempo, #FF8847)',
                          borderRadius: 2, marginRight: 5, verticalAlign: 'middle',
                        }} />Work</span>
                        <span><i style={{
                          display: 'inline-block', width: 8, height: 8, background: 'var(--eff-recovery, #27B4E0)',
                          borderRadius: 2, marginRight: 5, verticalAlign: 'middle',
                        }} />Recovery</span>
                        <span><i style={{
                          display: 'inline-block', width: 8, height: 8, background: 'rgba(255,255,255,.3)',
                          borderRadius: 2, marginRight: 5, verticalAlign: 'middle',
                        }} />Cooldown</span>
                      </div>
                    ) : null}
                  </>
                );
              })()}
              {data.hrZonePcts && (
                <>
                  <div className="fll" style={{ marginTop: 22 }}>TIME IN ZONES</div>
                  <div className="wk-zbar">
                    {([data.hrZonePcts.z1, data.hrZonePcts.z2, data.hrZonePcts.z3, data.hrZonePcts.z4, data.hrZonePcts.z5]).map((p, zi) => (
                      <i key={zi} style={{ width: `${p ?? 0}%`, background: ZC[zi] }} />
                    ))}
                  </div>
                  <div className="wk-zleg">
                    {([data.hrZonePcts.z1, data.hrZonePcts.z2, data.hrZonePcts.z3, data.hrZonePcts.z4, data.hrZonePcts.z5]).map((p, zi) => (
                      <div key={zi}>
                        <span className="sw" style={{ background: ZC[zi] }} />
                        <span className="zn">Z{zi + 1}</span>
                        <span className="zp">{Math.round(p ?? 0)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="fll" style={{ marginTop: 22 }}>CONDITIONS &amp; KIT</div>
              <div className="wk-grid">
                <div className="i">
                  <div className="k">WEATHER</div>
                  <div className="v">{renderTempRange(data) || '·'}</div>
                </div>
                <div className="i"><div className="k">CADENCE</div><div className="v">{data.cadence_avg ? `${Math.round(data.cadence_avg)} spm` : '·'}</div></div>
                <div className="i"><div className="k">MAX HR</div><div className="v">{data.hr_max ? `${data.hr_max} bpm` : '·'}</div></div>
                {data.power_avg_w != null && (
                  <div className="i"><div className="k">AVG POWER</div><div className="v">{data.power_avg_w}<small> W</small></div></div>
                )}
                <div className="i"><div className="k">CALORIES</div><div className="v">{data.calories_kcal != null ? `${data.calories_kcal}` : '·'}{data.calories_kcal != null ? <small> kcal</small> : null}</div></div>
                <div className="i"><div className="k">SHOE</div><div className="v">{currentShoeName(data) || '·'}</div></div>
              </div>
              {data.weather_context && (
                <div style={{
                  marginTop: 14, padding: '12px 14px',
                  background: 'rgba(255,206,138,0.08)', border: '1px solid rgba(255,206,138,0.28)',
                  borderRadius: 10, fontSize: 13, fontWeight: 500, lineHeight: 1.5,
                  color: 'rgba(255,255,255,0.88)',
                }}>
                  <span style={{
                    display: 'inline-block', marginRight: 8, fontSize: 9, fontWeight: 800, letterSpacing: 1,
                    color: '#FFCE8A', border: '1px solid rgba(255,206,138,.4)', borderRadius: 4, padding: '2px 6px',
                  }}>HEAT</span>
                  {data.weather_context.message}
                </div>
              )}
              {/* HR-on-pace delta vs baseline · only surface when the
                  signal is meaningful (|delta| ≥ 5 bpm for steady runs).
                  Closes coverage row 1015 ("How it went" heat-aware verdict). */}
              {data.hr_on_pace_delta_bpm != null && Math.abs(data.hr_on_pace_delta_bpm) >= 5 && (
                <div style={{
                  marginTop: 10, padding: '12px 14px',
                  background: data.hr_on_pace_delta_bpm > 0 ? 'rgba(252,77,100,.07)' : 'rgba(123,232,160,.07)',
                  border: data.hr_on_pace_delta_bpm > 0 ? '1px solid rgba(252,77,100,.28)' : '1px solid rgba(123,232,160,.28)',
                  borderRadius: 10, fontSize: 13, fontWeight: 500, lineHeight: 1.5,
                  color: 'rgba(255,255,255,0.88)',
                }}>
                  <span style={{
                    display: 'inline-block', marginRight: 8, fontSize: 9, fontWeight: 800, letterSpacing: 1,
                    color: data.hr_on_pace_delta_bpm > 0 ? '#FF9088' : '#7BE8A0',
                    border: data.hr_on_pace_delta_bpm > 0 ? '1px solid rgba(252,77,100,.4)' : '1px solid rgba(123,232,160,.4)',
                    borderRadius: 4, padding: '2px 6px',
                  }}>HR vs USUAL</span>
                  HR ran <b>{data.hr_on_pace_delta_bpm > 0 ? '+' : ''}{data.hr_on_pace_delta_bpm} bpm</b> {data.hr_on_pace_delta_bpm > 0 ? 'above' : 'below'} your typical at this pace.
                </div>
              )}
              {/* RPE entry (Borg CR10) · post-run subjective rating. The
                  card lazy-fetches the prior RPE so re-opening a rated
                  run shows the existing value. Closes coverage row 727
                  ("RPE + post-run notes") + line 787 ("Show prior RPE
                  on re-open"). */}
              <div className="fll" style={{ marginTop: 22 }}>HOW IT FELT</div>
              <div style={{ marginTop: 6 }}>
                <RPEEntryCard runId={data.id} />
              </div>
              {/* Post-run check-in · execution + body chips, canned
                  coach reply from /api/checkin. Closes coverage row 453
                  ("Post-run check-in canned coach reply"). */}
              <div className="fll" style={{ marginTop: 22 }}>CHECK IN</div>
              <div style={{ marginTop: 6 }}>
                <PostRunCheckinChips runId={data.id} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Route map + elevation profile. Both pull from real run data:
 *   - Route: decoded Strava polyline (lat/lng pairs projected to SVG).
 *   - Elev: cumulative integration of splits[].elev_change_ft.
 *  Each renders only when the underlying data exists — no fake fallbacks. */
function RouteAndElev({ data }: { data: RunDetail }) {
  const route = useMemo(() => {
    if (!data.route_polyline) return null;
    const decoded = decodePolyline(data.route_polyline);
    const path = polylineToSvgPath(decoded, 700, 168, 14);
    const ends = polylineEndpoints(decoded, 700, 168, 14);
    return path ? { path, endpoints: ends } : null;
  }, [data.route_polyline]);
  const elev = useMemo(() => {
    if (!data.splits?.length) return null;
    return elevPathFromSplits(data.splits, 360, 58, 4);
  }, [data.splits]);

  if (!route && !elev) return null;
  return (
    <>
      {route && (
        <>
          <div className="fll" style={{ marginTop: 22 }}>ROUTE</div>
          <div className="rdmap">
            <svg viewBox="0 0 700 168" preserveAspectRatio="none">
              <defs>
                <pattern id="rdm-rdmodal" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M40 0H0V40" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="1"/>
                </pattern>
              </defs>
              <rect width="700" height="168" fill="url(#rdm-rdmodal)" />
            </svg>
            <svg viewBox="0 0 700 168" preserveAspectRatio="xMidYMid meet">
              <path d={route.path} fill="none" stroke="#FF8847" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              {route.endpoints && <circle cx={route.endpoints.start[0]} cy={route.endpoints.start[1]} r="6" fill="#04201f" stroke="#14C08C" strokeWidth="3" />}
              {route.endpoints && <circle cx={route.endpoints.end[0]} cy={route.endpoints.end[1]} r="6" fill="#FF8847" stroke="#fff" strokeWidth="2" />}
            </svg>
            <span className="rdmaptag start">START</span>
            <span className="rdmaptag end">FINISH</span>
            <div className="rdmapstat">
              <span>{data.distance_mi.toFixed(1)} MI</span>
              {data.elev_gain_ft != null && data.elev_gain_ft > 0 && <span>↗ {Math.round(data.elev_gain_ft)} FT</span>}
            </div>
          </div>
        </>
      )}
      {elev && (
        <>
          <div className="fll" style={{ marginTop: 22 }}>ELEVATION</div>
          <div className="bk-elev" style={{ marginTop: 6 }}>
            <svg viewBox="0 0 360 58" preserveAspectRatio="none">
              <defs>
                <linearGradient id="rdmev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#FF8847" stopOpacity=".42" />
                  <stop offset="1" stopColor="#FF8847" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={elev.area} fill="url(#rdmev)" />
              <path d={elev.line} fill="none" stroke="#FF8847" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        </>
      )}
    </>
  );
}

function currentShoeName(d: RunDetail): string {
  if (!d.shoes || d.shoe_id == null) return '';
  const s = d.shoes.find(x => x.id === d.shoe_id);
  return s ? `${s.brand} ${s.model}`.trim() : '';
}
/**
 * Render the temp range as "65°F → 77°F" when the span shifted ≥3°F,
 * otherwise fall back to peak (or start, or single temp_f).
 *
 * Per the backend agent's contract (2026-05-31 confirmation):
 *   · start + end differ ≥3°F → "65°F → 77°F"
 *   · otherwise → peak (most representative for the runner)
 *   · legacy single-point rows have temp_range_f=null → temp_f
 *
 * Closes coverage row 945 (single-point temp) and row 904 (PARTIAL
 * temp_f_peak surfacing) on the WEB Run Detail surface.
 */
function renderTempRange(d: RunDetail): string {
  const tr = d.temp_range_f;
  if (tr && tr.start != null && tr.end != null && Math.abs(tr.end - tr.start) >= 3) {
    return `${Math.round(tr.start)}°F → ${Math.round(tr.end)}°F`;
  }
  // Span enrichment present but didn't shift much · prefer peak as the
  // honest "what you ran in" snapshot.
  if (tr && tr.peak != null) return `${Math.round(tr.peak)}°F`;
  // Legacy single-point fallback.
  if (d.temp_f != null) return `${Math.round(d.temp_f)}°F`;
  return '';
}
function formatHeroDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d).toUpperCase();
}
/** Map a split's phase tag to its accent color. Null when phase data
 *  is absent or unknown (Strava / apple_watch source paths). */
function phaseColorFor(phase: string | null | undefined): string | null {
  switch (phase) {
    case 'warmup':   return 'var(--eff-easy, #14C08C)';
    case 'work':     return 'var(--eff-tempo, #FF8847)';
    case 'recovery': return 'var(--eff-recovery, #27B4E0)';
    case 'cooldown': return 'rgba(255,255,255,.3)';
    default:         return null;
  }
}
function paceToSec(p: string): number {
  if (!p) return 0;
  const parts = p.split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
