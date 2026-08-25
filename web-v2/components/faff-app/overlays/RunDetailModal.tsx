'use client';

import { useEffect, useState, useMemo } from 'react';
import { ZC } from '../constants';
import { elevPathFromSplits } from '@/lib/route/polyline';
import { PostRunCheckinChips, RPEEntryCard } from '../toolkit';
import { RouteMap } from '../RouteMap';
import { Modelled } from '../Modelled';

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
  /**
   * 2026-08-24 · the interval each whole-run average above is actually the
   * average of. Derived server-side in `lib/coach/reading-scope.ts`; optional
   * here so a cached payload without it renders exactly as before.
   *
   * `hr.scope === 'none'` is a refusal — draw no HR figure at all rather than
   * falling back to `hr_avg`, which is the defect this field exists to close.
   */
  readings?: {
    hr: { scope: 'whole' | 'work' | 'none'; value: number | null; note: string | null };
    cadence: { scope: 'whole' | 'work' | 'none'; value: number | null; note: string | null };
    /** Seconds per mile. Never 'none' — a pace always has a true whole-run
     *  value; only its label changes. */
    pace: { scope: 'whole' | 'work' | 'none'; value: number | null; note: string | null };
    splitsMeaningful: boolean;
    zoneBarMeaningful: boolean;
    isRepSet: boolean;
  } | null;
  elev_gain_ft: number | null;
  temp_f: number | null;
  /** "Hotter than usual" context — run-state.ts computes weatherContext
   *  vs baseline from workout_weather_cache and stamps a one-liner when
   *  the delta is meaningful (≥8°F). null otherwise. */
  weather_context: { message: string; hr_bump_bpm: number } | null;
  /** Span-aware temp arc · "65°F → 77°F (peak 78°F)" rendering. Null on
   *  legacy single-point rows or runs without GPS. */
  temp_range_f?: { start: number | null; end: number | null; peak: number | null; mean: number | null } | null;
  /** Which instrument produced `calories_kcal`. */
  calories_source?: 'watch' | 'healthkit' | 'estimate' | null;
  /** False when the figure is modelled. The label says APPROX when it is. */
  calories_measured?: boolean | null;
  /** ACTIVE calories. Watch > HK active_energy > marked estimate. Null when
   *  neither writer had a value. */
  calories_kcal?: number | null;
  /** HR-vs-baseline delta at today's pace bucket. ≥5 bpm = meaningful
   *  for steady efforts. Null when no comparable baseline. */
  hr_on_pace_delta_bpm?: number | null;
  power_avg_w: number | null;
  /** A5 — GPS splits unreliable; do not render MILE SPLITS. */
  splits_unreliable?: boolean;
  /** The splits do not sum to this run's distance. See `splits_note`. */
  splits_cover_run?: boolean | null;
  /** One line saying so, when they do not. Null otherwise. */
  splits_note?: string | null;
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
  /**
   * 2026-08-24 · the session at the grain it was actually run at.
   *
   * It has been on this endpoint since P44 and this modal never asked for it,
   * which is why a 4×1km and a recovery jog rendered the identical row set
   * here. Optional so an older cached payload degrades to no section rather
   * than an empty one.
   */
  phase_breakdown?: Array<{
    index: number;
    label: string;
    type: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown' | string;
    target_pace: string | null;
    actual_pace: string | null;
    actual_distance_mi: number | null;
    actual_duration_sec: number | null;
    avg_hr: number | null;
    verdict: string | null;
    time_in_tolerance_sec: number | null;
    time_out_of_tolerance_sec: number | null;
  }>;
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
                {/* "AVG PACE 7:18" over a session whose reps ran 6:2x invites
                    exactly one comparison, and it is the wrong one — the 7:18
                    is a warm-up, four reps, three jogs and a cool-down. On a
                    structured run this becomes WORK PACE, which the phone's
                    post-run body has done for quality sessions since P42;
                    this is the same rule, applied by structure rather than by
                    a type that three quarters of his runs do not carry. */}
                {(() => {
                  const r = data.readings?.pace;
                  if (r && r.scope === 'work' && r.value) {
                    const mm = Math.floor(r.value / 60);
                    const ss = String(Math.round(r.value % 60)).padStart(2, '0');
                    return <div><div className="k">WORK PACE</div><div className="v">{`${mm}:${ss}`}<small>/mi</small></div></div>;
                  }
                  return data.pace ? <div><div className="k">AVG PACE</div><div className="v">{data.pace}<small>/mi</small></div></div> : null;
                })()}
                {/* AVG HR, SCOPED OR ABSENT — never unlabelled.
                    This row printed `hr_avg` on every run, so a 4×1km session
                    whose reps ran 164/169/168/160 showed "AVG HR 153": the
                    mean of hard reps and slow jogs, a value nothing on the run
                    happened at. `readings.hr` names the interval instead, and
                    on reps under two minutes it refuses outright — `Research/03`
                    §14, "Reps / R-pace (<2 min) → Ignore HR". */}
                {(() => {
                  const r = data.readings?.hr;
                  if (r) {
                    if (r.scope === 'none' || r.value == null) return null;
                    return (
                      <div>
                        <div className="k">{r.scope === 'whole' ? 'AVG HR' : `HR ${(r.note ?? 'on the work').toUpperCase()}`}</div>
                        <div className="v">{r.value}<small> bpm</small></div>
                      </div>
                    );
                  }
                  return data.hr_avg ? <div><div className="k">AVG HR</div><div className="v">{data.hr_avg}<small> bpm</small></div></div> : null;
                })()}
                {data.elev_gain_ft != null && data.elev_gain_ft > 0 && <div><div className="k">GAIN</div><div className="v">{Math.round(data.elev_gain_ft)}<small> ft</small></div></div>}
              </div>
              <RouteAndElev data={data} />

              {/* COACH RECAP · "what this run did" from the deterministic
                  engine. Verdict + facts replace generic "Run logged" copy
                  with research-cited framing. conditions_note + coach_tip
                  earn their own callouts when material. */}
              {recap && (
                <div className="band">
                  <div className="fll">HOW IT WENT</div>
                  <div style={{
                    fontFamily: 'var(--f-display)', fontSize: 22, lineHeight: 1.15,
                    color: '#fff',
                  }}>
                    {recap.verdict}
                  </div>
                  {recap.facts.map((f, i) => (
                    <p key={i} style={{
                      margin: 0, fontSize: 13.5, lineHeight: 1.55,
                      color: 'var(--fg-muted)',
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
                      padding: 'var(--callout-padding)', borderRadius: 10,
                      background: 'rgba(10,12,16,0.62)',
                      border: 0,
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                      fontSize: 13, lineHeight: 1.55, color: '#FFFFFF',
                      fontWeight: 500,
                      display: 'flex', flexDirection: 'column', gap: 'var(--label-gap)',
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: '1.4px',
                        textTransform: 'uppercase', color: '#FFB07A',
                      }}>CONDITIONS</div>
                      {recap.conditions_note}
                    </div>
                  )}
                  {recap.coach_tip && (
                    <div style={{
                      padding: 'var(--callout-padding)', borderRadius: 10,
                      background: 'rgba(10,12,16,0.62)',
                      border: 0,
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                      fontSize: 13, lineHeight: 1.55, color: '#FFFFFF',
                      fontWeight: 500,
                      display: 'flex', flexDirection: 'column', gap: 'var(--label-gap)',
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: '1.4px',
                        textTransform: 'uppercase', color: '#7BE8DC',
                      }}>COACH TIP</div>
                      {recap.coach_tip}
                    </div>
                  )}
                </div>
              )}

              {data.splits_unreliable && (
                <div style={{ fontSize: 11, opacity: 0.5, margin: '12px 0', lineHeight: 1.5 }}>
                  GPS pacing not shown. Splits couldn't be verified for this run.
                </div>
              )}
              {/* The DISTANCE verdict, beside the time verdict above. A run
                  can fail either alone, and 26 production rows fail this one
                  while passing that one. The rows below are still drawn —
                  their paces and heart rates were measured — but the table
                  is not a decomposition of the run, and drawing it silently
                  lets it read as one. */}
              {!data.splits_unreliable && data.splits_note && (
                <div style={{ fontSize: 11, opacity: 0.5, margin: '12px 0', lineHeight: 1.5 }}>
                  {data.splits_note}
                </div>
              )}
              {/* REP BY REP · the replacement, not merely a removal.
                  Taking the mile chart off a rep session and putting nothing
                  back would leave the runner with less than before, however
                  much more honest it was. This is the same evidence at the
                  grain the plan actually asked for, and it goes ABOVE the mile
                  chart for the runs that still draw one: a runner opening a
                  tune-up wants rep three, and no row of a mile table is rep
                  three. Mirrors `RepBreakdownV5` on the phone. */}
              {(data.phase_breakdown?.length ?? 0) > 1 && (() => {
                const phases = data.phase_breakdown!;
                const work = phases.filter(p => p.type === 'work');
                // "In the band for X of Y" — the deciding measure for a tempo
                // or a threshold set (`Research/04` §5.2, §5.3: the dose and
                // the discipline, not the average). The watch has counted this
                // per phase since P44 and no web surface has ever shown it.
                // WORK PHASES ONLY: a long steady cool-down counted against
                // easy pace would drown the four kilometres that were the
                // session.
                const inSec = work.reduce((s, p) => s + (p.time_in_tolerance_sec ?? 0), 0);
                const outSec = work.reduce((s, p) => s + (p.time_out_of_tolerance_sec ?? 0), 0);
                const graded = inSec + outSec;
                const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
                return (
                  <div className="band">
                    <div className="fll">{work.length >= 2 ? 'REP BY REP' : 'PIECE BY PIECE'}</div>
                    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                      {phases.map(p => {
                        const isWork = p.type === 'work';
                        return (
                          <div
                            key={p.index}
                            style={{
                              display: 'flex', justifyContent: 'space-between', gap: 12,
                              fontSize: 12, lineHeight: 1.4,
                              // The jogs are context, not results. Dimming them
                              // is the whole visual grammar of this list.
                              opacity: isWork ? 1 : 0.45,
                            }}
                          >
                            <span style={{ fontWeight: isWork ? 600 : 400 }}>{p.label}</span>
                            <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {p.actual_pace ? `${p.actual_pace}/mi` : '·'}
                              {/* A RECOVERY JOG'S "TARGET" IS NOT A TARGET.
                                  The server writes easy pace into every
                                  recovery phase because the watch needs
                                  something to draw a band against; printing it
                                  here would assert a prescription the plan
                                  never wrote, and make a 90-second jog between
                                  two hard kilometres look like a two-minute
                                  miss. Same rule the phone applies. */}
                              {isWork && p.target_pace && (
                                <small style={{ opacity: 0.6 }}>{` asked ${p.target_pace}`}</small>
                              )}
                              {p.avg_hr && <small style={{ opacity: 0.6 }}>{` · HR ${p.avg_hr}`}</small>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {graded > 0 && (
                      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 10, lineHeight: 1.5 }}>
                        {`The watch had you inside the target pace for ${clock(inSec)} of the ${clock(graded)} of work it graded.`}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* A THIRD REASON NOT TO DRAW THIS TABLE, beside "unreliable"
                  and "does not sum". A rep session was not run in miles: mile
                  two of a 4×1km is the back of rep one, a recovery jog and the
                  front of rep two averaged into one row, and no colouring
                  rescues that. `Research/01` §"Pace zone width and lock-in
                  rules" asks for reps "by interval time, not by per-mile
                  pace". The phase legend below was an attempt to survive this;
                  the honest move is not to draw it. */}
              {!data.splits_unreliable && (data.readings?.splitsMeaningful ?? true) && data.splits?.length > 0 && (() => {
                const maxFill = Math.max(...data.splits.map(s => paceToSec(s.pace ?? '') || 0));
                const minFill = Math.min(...data.splits.filter(s => paceToSec(s.pace ?? '') > 0).map(s => paceToSec(s.pace!) || 0));
                const span = Math.max(1, maxFill - minFill);
                const hasPhase = data.splits.some(s => s.phase && s.phase !== 'unknown');
                return (
                  <div className="band">
                    <div className="fll">MILE SPLITS</div>
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
                        display: 'flex', gap: 12,
                        fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
                        textTransform: 'uppercase', color: 'var(--fa-mute, #D6DAE2)',
                      }}>
                        <span><i style={{
                          display: 'inline-block', width: 8, height: 8, background: 'var(--eff-easy, #3EBD41)',
                          borderRadius: 2, marginRight: 5, verticalAlign: 'middle',
                        }} />Warmup</span>
                        <span><i style={{
                          display: 'inline-block', width: 8, height: 8, background: 'var(--eff-tempo, #D03F3F)',
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
                  </div>
                );
              })()}
              {/* Suppressed on a rep set for the same reason. The bar spans a
                  warm-up, the reps, the jogs between them and a cool-down; it
                  is mostly the jogs and mostly HR's own rise time, and the zone
                  the session asked for is unreachable across that span by
                  construction — so it can only ever report a miss on a session
                  that was executed as written. */}
              {data.hrZonePcts && (data.readings?.zoneBarMeaningful ?? true) && (
                <div className="band">
                  <div className="fll">TIME IN ZONES</div>
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
                </div>
              )}
              <div className="band">
                <div className="fll">CONDITIONS &amp; KIT</div>
                <div className="wk-grid">
                  <div className="i">
                    <div className="k">WEATHER</div>
                    <div className="v">{renderTempRange(data) || '·'}</div>
                  </div>
                  {/* Cadence tracks pace, gradient and fatigue (`Research/16`
                      §2.3), so a single figure across a run that changed pace
                      four times is the mean of four distributions. On the
                      2026-08-11 session the reps ran 162–174 spm and two of the
                      jogs ran 115 — one number for both is not a summary. */}
                  {(() => {
                    const r = data.readings?.cadence;
                    const value = r ? r.value : data.cadence_avg;
                    if (r?.scope === 'none' || value == null) return null;
                    const label = !r || r.scope === 'whole' ? 'CADENCE' : `CADENCE ${(r.note ?? 'on the work').toUpperCase()}`;
                    return <div className="i"><div className="k">{label}</div><div className="v">{`${Math.round(value)} spm`}</div></div>;
                  })()}
                  <div className="i"><div className="k">MAX HR</div><div className="v">{data.hr_max ? `${data.hr_max} bpm` : '·'}</div></div>
                  {data.power_avg_w != null && (
                    <div className="i"><div className="k">AVG POWER</div><div className="v">{data.power_avg_w}<small> W</small></div></div>
                  )}
                  {/* ACTIVE energy, never Strava's total — see lib/runs/energy.ts.
                      The estimator's answer wears the amber tilde, because a
                      modelled number must never look measured and this one used
                      to print bare beside the watch's real measurements. */}
                  <div className="i">
                    <div className="k">CALORIES</div>
                    <div className="v">
                      {data.calories_kcal == null ? '·' : data.calories_measured === false ? (
                        <Modelled title="Estimated from distance, body mass and average heart rate">
                          {data.calories_kcal}<small> kcal</small>
                        </Modelled>
                      ) : (
                        <>{data.calories_kcal}<small> kcal</small></>
                      )}
                    </div>
                  </div>
                  <div className="i"><div className="k">SHOE</div><div className="v">{currentShoeName(data) || '·'}</div></div>
                </div>
              </div>
              {data.weather_context && (
                <div style={{
                  padding: 'var(--callout-padding)',
                  background: 'rgba(255,206,138,0.08)', border: '1px solid rgba(255,206,138,0.28)',
                  borderRadius: 10, fontSize: 13, fontWeight: 500, lineHeight: 1.5,
                  color: 'rgba(255,255,255,0.88)',
                }}>
                  <span style={{
                    display: 'inline-block', marginRight: 8, fontSize: 9, fontWeight: 800, letterSpacing: 1,
                    color: '#F3AD38', border: '1px solid rgba(255,206,138,.4)', borderRadius: 4, padding: '2px 6px',
                  }}>HEAT</span>
                  {data.weather_context.message}
                </div>
              )}
              {/* HR-on-pace delta vs baseline · only surface when the
                  signal is meaningful (|delta| ≥ 5 bpm for steady runs).
                  Closes coverage row 1015 ("How it went" heat-aware verdict). */}
              {data.hr_on_pace_delta_bpm != null && Math.abs(data.hr_on_pace_delta_bpm) >= 5 && (
                <div style={{
                  padding: 'var(--callout-padding)',
                  background: data.hr_on_pace_delta_bpm > 0 ? 'rgba(252,77,100,.07)' : 'rgba(123,232,160,.07)',
                  border: data.hr_on_pace_delta_bpm > 0 ? '1px solid rgba(252,77,100,.28)' : '1px solid rgba(123,232,160,.28)',
                  borderRadius: 10, fontSize: 13, fontWeight: 500, lineHeight: 1.5,
                  color: 'rgba(255,255,255,0.88)',
                }}>
                  <span style={{
                    display: 'inline-block', marginRight: 8, fontSize: 9, fontWeight: 800, letterSpacing: 1,
                    color: data.hr_on_pace_delta_bpm > 0 ? '#FC4D64' /* --over */ : '#7BE8A0',
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
              <div className="band">
                <div className="fll">HOW IT FELT</div>
                <RPEEntryCard runId={data.id} />
              </div>
              {/* Post-run check-in · execution + body chips, canned
                  coach reply from /api/checkin. Closes coverage row 453
                  ("Post-run check-in canned coach reply"). */}
              <div className="band">
                <div className="fll">CHECK IN</div>
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
 *   - Route: the SHARED RouteMap treatment (CartoDB dark tiles + pace-graded
 *     polyline) — the design-locked canonical map used by TodayView/RaceView.
 *     2026-08-17 truth audit #4: this modal previously drew a bare SVG
 *     polyline on a grid; David has ruled "don't revert" from the RouteMap
 *     treatment, so the modal now renders the same component. Leaflet is
 *     already lazy-loaded inside RouteMap (dynamic import), so the modal
 *     bundle stays light until a route actually renders.
 *   - Elev: cumulative integration of splits[].elev_change_ft.
 *  Each renders only when the underlying data exists — no fake fallbacks. */
function RouteAndElev({ data }: { data: RunDetail }) {
  const elev = useMemo(() => {
    if (!data.splits?.length) return null;
    return elevPathFromSplits(data.splits, 360, 58, 4);
  }, [data.splits]);

  if (!data.route_polyline && !elev) return null;
  return (
    <>
      {data.route_polyline && (
        <div className="band">
          <div className="fll">ROUTE</div>
          <div style={{ position: 'relative' }}>
            <RouteMap
              polyline={data.route_polyline}
              // Unverified splits must not pace-grade the line — pass none so
              // RouteMap falls back to the plain coral route.
              splits={data.splits_unreliable ? [] : (data.splits ?? [])}
              height={280}
            />
            {/* Distance/gain overlay · top of the card so it never collides
                with RouteMap's own FASTER→SLOWER legend (bottom-left). */}
            <div className="rdmapstat" style={{ zIndex: 1000, top: 10, bottom: 'auto', pointerEvents: 'none' }}>
              <span>{data.distance_mi.toFixed(1)} MI</span>
              {data.elev_gain_ft != null && data.elev_gain_ft > 0 && <span>↗ {Math.round(data.elev_gain_ft)} FT</span>}
            </div>
          </div>
        </div>
      )}
      {elev && (
        <div className="band">
          <div className="fll">ELEVATION</div>
          <div className="bk-elev">
            <svg viewBox="0 0 360 58" preserveAspectRatio="none">
              <defs>
                <linearGradient id="rdmev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#D03F3F" stopOpacity=".42" />
                  <stop offset="1" stopColor="#D03F3F" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={elev.area} fill="url(#rdmev)" />
              <path d={elev.line} fill="none" stroke="#D03F3F" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        </div>
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
    case 'warmup':   return 'var(--eff-easy, #3EBD41)';
    case 'work':     return 'var(--eff-tempo, #D03F3F)';
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
