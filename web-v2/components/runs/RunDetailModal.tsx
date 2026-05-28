'use client';

/**
 * RunDetailModal — opens run detail (splits / HR zones / route) as a modal
 * overlay instead of navigating to /runs/[id]. Per user feedback: never
 * leave /today.
 *
 * Two-step: <RunDetailTrigger> renders the link/button; clicking opens
 * the modal which lazy-fetches /api/runs/[id].
 */

import { useState, useEffect, useRef } from 'react';
import type { RunDetail, PhaseBreakdown } from '@/lib/coach/run-state';
import { RouteSparkline } from './RouteSparkline';
import { FormStatButton } from './FormTipModal';

export function RunDetailTrigger({
  activityId,
  label = 'Splits · route · form data →',
  style,
  children,
  prefetchedData,
  prefetchedShoes,
}: {
  activityId: string | null | undefined;
  label?: string;
  style?: React.CSSProperties;
  /** Optional custom trigger contents — when provided, renders children
   *  instead of the label. Used by /today's hero so the whole headline
   *  block becomes the run-detail click target. */
  children?: React.ReactNode;
  /** Optional pre-fetched data so modal renders synchronously on open. */
  prefetchedData?: RunDetail | null;
  prefetchedShoes?: any[] | null;
}) {
  const [open, setOpen] = useState(false);

  // No id at all → render nothing (the surrounding card still shows the
  // basic stats). We don't show a "syncing" hint because the modal
  // resolves synthetic date-distance ids — most run sources work.
  if (!activityId) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-block', marginTop: children ? 0 : 12,
          background: 'transparent', border: 'none', padding: 0,
          fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 500,
          color: 'var(--mute)', letterSpacing: '0.3px', cursor: 'pointer',
          ...style,
        }}
      >
        {children ?? label}
      </button>
      {open && (
        <RunDetailModal
          activityId={activityId}
          onClose={() => setOpen(false)}
          prefetchedData={prefetchedData}
          prefetchedShoes={prefetchedShoes}
        />
      )}
    </>
  );
}

export function RunDetailModal({
  activityId,
  onClose,
  prefetchedData,
  prefetchedShoes,
}: {
  activityId: string;
  onClose: () => void;
  /** Pre-fetched run detail — when present, modal renders synchronously
   *  with no skeleton flash. Parents (LogTable, DayDetailModal, /today
   *  hero) hover-prefetch or batch-prefetch and pass it in. */
  prefetchedData?: RunDetail | null;
  prefetchedShoes?: any[] | null;
}) {
  // 2026-05-27: shoes now come embedded in the RunDetail response, so
  // the modal needs only ONE round-trip (down from two). Initial shoe
  // list pulls from prefetchedShoes (LogTable warm-up path) → falls
  // back to detail.shoes once the fetch lands → falls back to empty.
  const [data, setData] = useState<RunDetail | null>(prefetchedData ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(prefetchedData == null);
  const [shoes, setShoes] = useState<any[]>(prefetchedShoes ?? prefetchedData?.shoes ?? []);

  useEffect(() => {
    if (prefetchedData) {
      setData(prefetchedData);
      setLoading(false);
      // Trust prefetched shoes when explicitly supplied (LogTable batch
      // path), else use the inline list from the detail payload.
      setShoes(prefetchedShoes ?? prefetchedData.shoes ?? []);
      return;
    }
    let mounted = true;
    fetch(`/api/runs/${encodeURIComponent(activityId)}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error ?? 'failed'); }))
      .then((d: RunDetail) => {
        if (!mounted) return;
        setData(d);
        setLoading(false);
        // Server now bundles shoes inline — no second round-trip needed.
        if (Array.isArray(d.shoes)) setShoes(d.shoes);
      })
      .catch((e) => { if (mounted) { setError(e.message ?? String(e)); setLoading(false); } });
    return () => { mounted = false; };
  }, [activityId, prefetchedData, prefetchedShoes]);

  /** Update run.shoe_id via PATCH /api/runs/[id]. Optimistic — the server
   *  recomputes shoes.mileage on success, refresh of /profile reflects it. */
  async function pickShoe(shoeId: number | null) {
    if (!data) return;
    setData({ ...data, shoe_id: shoeId });
    try {
      await fetch(`/api/runs/${encodeURIComponent(activityId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shoe_id: shoeId }),
      });
    } catch {
      // best-effort; we don't roll back the optimistic update — the server
      // is the source of truth and a refresh will reconcile if it failed.
    }
  }

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.78)', backdropFilter: 'blur(10px)',
        zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#181a1d', border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)', borderRadius: 20,
          padding: '28px 32px', maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase' }}>
            RUN DETAIL
            {data?.date && <span style={{ marginLeft: 8, color: 'var(--dim)' }}>· {data.date}</span>}
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--mute)', fontSize: 22, cursor: 'pointer', lineHeight: 1,
          }} aria-label="Close">×</button>
        </div>

        {loading && <Skeleton />}
        {error && <ErrorState err={error} />}
        {data && <RunDetailBody d={data} shoes={shoes} onPickShoe={pickShoe} />}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div>
      <style>{`@keyframes shim { 0%{opacity:.35}50%{opacity:.7}100%{opacity:.35} }`}</style>
      {[60, 88, 76, 40].map((w, i) => (
        <div key={i} style={{
          height: 18, width: `${w}%`, background: 'var(--ink)', borderRadius: 4,
          marginBottom: 10, animation: 'shim 1.4s ease-in-out infinite',
        }} />
      ))}
    </div>
  );
}

function ErrorState({ err }: { err: string }) {
  return (
    <div style={{ padding: '12px 0', fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', lineHeight: 1.55 }}>
      Couldn't load this run yet — {err}. If you just finished it, the sync may still be in flight.
    </div>
  );
}

/**
 * Body content of the run-detail modal — extracted so other surfaces
 * (e.g. DayDetailModal's CompletedRunBody) can inline the full detail
 * instead of opening a second modal-on-top-of-modal.
 *
 * `inline` mode hides the title + source eyebrow + hero stats (the
 * outer surface already shows these on its own header) and starts the
 * body at the secondary stats / phase / splits / HR / form / route
 * stack. Default mode (non-inline) renders the full thing for the
 * standalone RunDetailModal.
 */
export function RunDetailBody({
  d, shoes, onPickShoe, inline = false,
}: {
  d: RunDetail;
  shoes: any[];
  onPickShoe: (id: number | null) => void;
  inline?: boolean;
}) {
  const sourceLabel = d.source === 'watch' ? 'WATCH'
    : d.source === 'apple_health' ? 'APPLE HEALTH'
    : d.source === 'manual' ? 'MANUAL ENTRY'
    : d.source === 'strava' ? 'STRAVA' : d.source.toUpperCase();

  return (
    <>
      {!inline && (
        <>
          <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 38, margin: '4px 0 6px', letterSpacing: '0.5px', lineHeight: 1, color: 'var(--ink)' }}>
            {d.name ?? `${d.distance_mi.toFixed(1)} MI ${(d.type ?? 'run').toUpperCase()}`}
          </h2>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 18, fontWeight: 600 }}>
            {sourceLabel}{d.type ? ` · ${d.type}` : ''}
          </div>

          {/* Hero stats — 4 most important numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
            <BigStat v={d.distance_mi.toFixed(2)} u="miles" color="var(--dist)" />
            {d.pace        && <BigStat v={d.pace}              u="avg pace" color="var(--green)" />}
            {d.time_moving && <BigStat v={d.time_moving}       u="moving"   color="var(--ink)" />}
            {d.hr_avg != null && <BigStat v={String(d.hr_avg)} u="avg hr"   color="var(--over)" />}
          </div>
        </>
      )}

      {/* Secondary stats row — what didn't fit above */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        {d.hr_max != null      && <SmallStat v={String(d.hr_max)}            u="max hr" />}
        {d.cadence_avg != null && <SmallStat v={String(d.cadence_avg)}       u="cadence" />}
        {d.elev_gain_ft != null&& <SmallStat v={`${d.elev_gain_ft}`}         u="elev ft" />}
        {d.avg_speed_mph != null && <SmallStat v={`${d.avg_speed_mph.toFixed(1)}`} u="mph" />}
        {d.time_elapsed && d.time_elapsed !== d.time_moving && <SmallStat v={d.time_elapsed} u="elapsed" />}
        {d.temp_f != null      && <SmallStat v={`${Math.round(d.temp_f)}°F`} u={d.temp_f >= 75 ? 'warm' : d.temp_f <= 45 ? 'cold' : 'cool'} />}
        {d.suffer_score != null&& <SmallStat v={String(d.suffer_score)}      u="suffer" />}
        {d.kudos != null && d.kudos > 0 && <SmallStat v={String(d.kudos)}    u="kudos" />}
      </div>

      {/* P42 + P45 — work-only averages when a planned quality workout
          matches. 2026-05-27: only render this card when work-only
          numbers ACTUALLY DIFFER from the all-in numbers above. For a
          single-phase easy run (no warmup/cooldown), work pace == run
          pace and the card just repeats info already on screen. David:
          "i know this is working but its confusing, not organized well,
          data heavy in a way where I don't know what I'm looking at."
          Also dropped the loud orange tint/border — eyebrow now reads
          mute since this isn't an alert, it's context. */}
      {hasMeaningfulWorkAverages(d) && (
        <div className="card" style={{ padding: '14px 16px', marginBottom: 14, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--mute)', marginBottom: 6 }}>
            WORK-PHASE AVERAGES · RECOVERIES EXCLUDED
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {d.pace_work != null && <SmallStat v={d.pace_work} u="work pace" />}
            {d.hr_avg_work != null && <SmallStat v={String(d.hr_avg_work)} u="avg hr" />}
            {d.cadence_avg_work != null && <SmallStat v={String(d.cadence_avg_work)} u="cadence" />}
            {d.work_seconds != null && <SmallStat v={`${Math.round(d.work_seconds / 60)}m`} u="work time" />}
          </div>
          <div style={{ marginTop: 8, fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', lineHeight: 1.5 }}>
            {d.pace_work && d.pace
              ? `Run average pace was ${d.pace}/mi all-in; ${d.pace_work}/mi just for the work phases.`
              : `These exclude warmups, cooldowns, and recovery jogs — the number that says whether you hit threshold today.`}
          </div>
        </div>
      )}

      {/* P32 — shoe picker. Pick the active shoe used; server bumps mileage.
          2026-05-27: dumped the native <select> — its popover (white list,
          bright iOS blue selection) was wildly off-theme. ShoePicker is a
          custom button+popover that stays in the app's palette. */}
      {shoes.length > 0 && (
        <div className="card" style={{ padding: '14px 16px', marginBottom: 14, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--green)', marginBottom: 8 }}>SHOES</div>
          <ShoePicker shoes={shoes} value={d.shoe_id ?? null} onChange={onPickShoe} />
        </div>
      )}

      {/* P44 — phase-by-phase breakdown when the watch did a structured
          workout. 2026-05-27: only render when there's MORE THAN ONE
          phase. A single "WORK Run 5.8mi" phase just restates the hero
          stats with extra chrome — pure noise on an easy day. The card
          becomes useful again the moment a real workout has warmup +
          reps + recoveries + cooldown. Recolored eyebrow to mute too —
          it's structural, not an alert. */}
      {d.phase_breakdown && d.phase_breakdown.length > 1 && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>BREAKDOWN · PLAN vs ACTUAL</div>
          <PhaseBreakdownTable phases={d.phase_breakdown} />
        </div>
      )}

      {/* Splits chart — bar per mile by pace, w/ HR overlay if we have it.
          2026-05-27: hidden when there's only 1 split AND no per-mile
          pace data (the "(no pace data)" empty row was contributing
          nothing). A single mile of useful data still renders. */}
      {d.splits.length > 1 && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>SPLITS · {d.splits.length} MILES</div>
          <SplitsBars splits={d.splits} />
          <SplitsTable splits={d.splits} />
        </div>
      )}

      {/* HR section — Round 4 combo (per docs/run-detail-redesign-2026-05-27.html).
          Hero zone tile + vertical spectrum rail + peak HR gauge +
          AVG-vs-LTHR donut + zone-colored HR timeline. */}
      {(d.hrZonePcts.z1 + d.hrZonePcts.z2 + d.hrZonePcts.z3 + d.hrZonePcts.z4 + d.hrZonePcts.z5) > 0 && (
        <HRSection d={d} />
      )}

      {/* Form metrics — cadence, ground contact, stride length, vert ratio.
          Pulled from health_samples for the run's date (Apple Watch).
          Each tile is clickable → opens a FormTipModal with definition,
          target bands, and drills when flagged. */}
      {hasFormData(d) && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--learn)' }}>FORM · APPLE WATCH · TAP A TILE</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 10 }}>
            {d.cadence_avg            != null && <FormStatButton metricKey="cadence_spm"             value={String(d.cadence_avg)}                    unit=""    label="cadence spm"       hint={cadenceHint(d.cadence_avg)} />}
            {d.form.ground_contact_ms != null && <FormStatButton metricKey="ground_contact_ms"       value={String(d.form.ground_contact_ms)}         unit=""    label="ground contact ms"  hint={gctHint(d.form.ground_contact_ms)} />}
            {d.form.stride_length_m   != null && <FormStatButton metricKey="stride_length_m"         value={d.form.stride_length_m.toFixed(2)}        unit=""    label="stride length m"    hint="" />}
            {d.form.vertical_oscillation_cm != null && <FormStatButton metricKey="vertical_oscillation_cm" value={d.form.vertical_oscillation_cm.toFixed(1)} unit="" label="vert. osc. cm"   hint={voHint(d.form.vertical_oscillation_cm)} />}
            {d.form.vertical_ratio_pct != null && <FormStatButton metricKey="vertical_ratio_pct"    value={d.form.vertical_ratio_pct.toFixed(1)}     unit="%"   label="vert. ratio"        hint={vrHint(d.form.vertical_ratio_pct)} />}
            {d.form.run_power_w        != null && <FormStatButton metricKey="run_power_w"            value={String(d.form.run_power_w)}              unit=""    label="power watts"        hint="" />}
            {d.form.spo2_pct           != null && <FormStatButton metricKey="spo2_pct"               value={d.form.spo2_pct.toFixed(1)}              unit="%"   label="SpO₂"               hint="" />}
            {d.form.respiratory_rate   != null && <FormStatButton metricKey="respiratory_rate"       value={d.form.respiratory_rate.toFixed(0)}      unit=""    label="breaths/min"        hint="" />}
          </div>
        </div>
      )}

      {/* Route — render the actual polyline as an SVG sparkline when we
          have it (Strava-encoded). Falls back to a stat-only note. */}
      {d.has_route && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--dist)' }}>
            ROUTE
            {d.elev_gain_ft != null && d.elev_gain_ft > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--mute)' }}>· {d.elev_gain_ft}ft climbed</span>
            )}
          </div>
          {d.route_polyline ? (
            <>
              <div style={{ marginTop: 10, marginLeft: -8, marginRight: -8 }}>
                <RouteSparkline polyline={d.route_polyline} height={220} />
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 6, fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '0.5px' }}>
                <span><span style={{ color: 'var(--green)' }}>●</span> start</span>
                <span><span style={{ color: 'var(--race)' }}>●</span> finish</span>
              </div>
            </>
          ) : (
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', lineHeight: 1.55, marginTop: 6 }}>
              GPS recorded but polyline not stored on this activity.
            </div>
          )}
        </div>
      )}
    </>
  );
}

function FormStat({ v, u, hint }: { v: string; u: string; hint: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.025)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 20, color: 'var(--ink)', lineHeight: 1, letterSpacing: '0.3px' }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9.5, color: 'var(--mute)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>{u}</div>
      {hint && <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--learn)', marginTop: 4, fontStyle: 'italic' }}>{hint}</div>}
    </div>
  );
}

function hasFormData(d: RunDetail): boolean {
  const f = d.form;
  return (d.cadence_avg ?? f.cadence_spm) != null
    || f.ground_contact_ms != null
    || f.stride_length_m != null
    || f.vertical_oscillation_cm != null
    || f.vertical_ratio_pct != null
    || f.run_power_w != null
    || f.respiratory_rate != null
    || f.spo2_pct != null;
}

function cadenceHint(c: number): string {
  if (c >= 175) return 'high — efficient turnover';
  if (c >= 165) return 'optimal range (170-180 target)';
  if (c >= 155) return 'fine, room to lift';
  return 'low — try shorter, quicker steps';
}

function gctHint(ms: number): string {
  if (ms <= 220) return 'fast — elite range';
  if (ms <= 260) return 'good — efficient ground contact';
  return 'longer contact — overstriding flag';
}

function voHint(cm: number): string {
  if (cm <= 7) return 'low bounce — efficient';
  if (cm <= 9) return 'good range';
  return 'high bounce — energy leak';
}

function vrHint(pct: number): string {
  if (pct <= 6.5) return 'elite efficiency';
  if (pct <= 8.5) return 'good';
  return 'room to reduce bounce';
}

function hrInterpretation(p: { z1: number; z2: number; z3: number; z4: number; z5: number }, runType: string | null): string {
  const z1 = p.z1, z2 = p.z2, z3 = p.z3, z4 = p.z4, z5 = p.z5;
  const easyZones = z1 + z2;
  const aerobic = z2 + z3;
  const hard = z4 + z5;

  // Easy run interpretations
  if (runType === 'easy') {
    if (z1 >= 75) return 'Mostly Z1 recovery — true easy, maybe a touch slow. That\'s right for the day after hard work.';
    if (easyZones >= 80) return 'Discipline win — kept it in the easy band. This is what easy is supposed to feel like.';
    if (z3 + z4 >= 30) return 'Drifted into Z3+ for a chunk — easy days were meant to be easier. Lock effort next time.';
    return `${easyZones}% Z1+Z2 is right where an easy run should land.`;
  }
  // Threshold / tempo
  if (runType === 'threshold' || runType === 'tempo') {
    if (z4 + z5 >= 35) return `${z4 + z5}% above LT — solid threshold work.`;
    if (hard >= 20) return 'Partial threshold execution — reps probably needed more pace or less recovery.';
    return 'Mostly aerobic for a quality day — check the splits, target pace may have been too soft.';
  }
  // Long run
  if (runType === 'long') {
    if (aerobic >= 70 && z4 < 10) return 'Aerobic long run — engine work without the cost. Right call.';
    if (z3 >= 30) return 'Drift into Z3 late is normal on a long run. As long as form held.';
    return `${aerobic}% in Z2-Z3 — that\'s a long-run profile.`;
  }
  // Race / generic
  if (hard >= 40) return `${hard}% above LT — race effort or hard quality.`;
  if (easyZones >= 70) return 'Aerobic-dominant — recovery or true easy.';
  return `Mostly Z${z3 >= z2 ? '3' : '2'} — steady aerobic territory.`;
}

function SmallStat({ v, u }: { v: string; u: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.025)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--ink)', lineHeight: 1, letterSpacing: '0.3px' }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9.5, color: 'var(--mute)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 3 }}>{u}</div>
    </div>
  );
}

/**
 * P44 — plan-vs-actual table. Each row is one phase of the workout.
 * Status pip on the right says "on target / fast / slow" so the runner
 * gets the headline answer at a glance.
 */
function PhaseBreakdownTable({ phases }: { phases: PhaseBreakdown[] }) {
  const fmtDur = (s: number | null): string => {
    if (!s || s <= 0) return '—';
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    if (m === 0) return `${r}s`;
    return `${m}:${String(r).padStart(2, '0')}`;
  };
  const statusColor = (st: PhaseBreakdown['status']): string =>
    st === 'on' ? 'var(--green)'
    : st === 'fast' ? 'var(--over)'
    : st === 'slow' ? 'var(--goal)'
    : 'var(--mute)';
  const statusLabel = (st: PhaseBreakdown['status']): string =>
    st === 'on' ? 'ON' : st === 'fast' ? 'FAST' : st === 'slow' ? 'SLOW' : '—';
  const typeBadge = (t: PhaseBreakdown['type']): string =>
    t === 'warmup' ? 'WARMUP'
    : t === 'cooldown' ? 'COOLDOWN'
    : t === 'recovery' ? 'RECOVERY'
    : t === 'work' ? 'WORK'
    : 'PHASE';
  const typeBadgeColor = (t: PhaseBreakdown['type']): string =>
    t === 'warmup' || t === 'cooldown' ? 'var(--rest)'
    : t === 'recovery' ? 'var(--mute)'
    : t === 'work' ? 'var(--goal)'
    : 'var(--ink)';

  return (
    <div style={{ marginTop: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--f-body)', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--mute)', fontSize: 9.5, letterSpacing: '1.1px', textTransform: 'uppercase', fontWeight: 700 }}>
            <th style={{ textAlign: 'left',  padding: '6px 4px' }}>PHASE</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>TARGET</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>ACTUAL</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>HR</th>
            <th style={{ textAlign: 'right', padding: '6px 4px', width: 50 }}>·</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => {
            // For recovery/warmup/cooldown: show duration as the headline.
            // For work phases: show pace as the headline; duration is secondary.
            const showPace = p.type === 'work';
            const targetCell = showPace
              ? (p.target_pace ?? '—')
              : (p.target_duration_sec ? fmtDur(p.target_duration_sec) : (p.target_pace ?? '—'));
            const actualCell = showPace
              ? (p.actual_pace ?? '—')
              : (p.actual_duration_sec ? fmtDur(p.actual_duration_sec) : (p.actual_pace ?? '—'));
            return (
              <tr key={p.index} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '8px 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                      background: 'rgba(255,255,255,0.05)', color: typeBadgeColor(p.type),
                      fontSize: 8.5, letterSpacing: '0.9px', fontWeight: 700,
                    }}>{typeBadge(p.type)}</span>
                    <span style={{ color: 'var(--ink)', fontSize: 12.5 }}>{p.label}</span>
                  </div>
                  {p.actual_distance_mi != null && (
                    <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 2, marginLeft: 0 }}>
                      {p.actual_distance_mi.toFixed(2)}mi
                      {p.actual_duration_sec && showPace ? ` · ${fmtDur(p.actual_duration_sec)}` : ''}
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'var(--f-label)', color: 'var(--mute)', fontSize: 13 }}>{targetCell}</td>
                <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'var(--f-label)', color: 'var(--ink)', fontSize: 13.5 }}>{actualCell}</td>
                <td style={{ padding: '8px 4px', textAlign: 'right', color: p.avg_hr ? 'var(--ink)' : 'var(--dim)', fontFamily: 'var(--f-label)', fontSize: 13 }}>
                  {p.avg_hr ?? '—'}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                  <span style={{
                    fontSize: 8.5, letterSpacing: '1px', fontWeight: 700,
                    color: statusColor(p.status),
                  }}>{statusLabel(p.status)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SplitsTable({ splits }: { splits: { mile: number; pace: string | null; hr: number | null; cadence: number | null }[] }) {
  return (
    <div style={{ marginTop: 14, maxHeight: 220, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--f-body)', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--mute)', fontSize: 9.5, letterSpacing: '1.1px', textTransform: 'uppercase', fontWeight: 700 }}>
            <th style={{ textAlign: 'left',  padding: '6px 4px', width: 40 }}>MI</th>
            <th style={{ textAlign: 'left',  padding: '6px 4px' }}>PACE</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>HR</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>CAD</th>
          </tr>
        </thead>
        <tbody>
          {splits.map((s) => (
            <tr key={s.mile} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <td style={{ padding: '7px 4px', fontFamily: 'var(--f-label)', color: 'var(--mute)', fontSize: 13 }}>{s.mile}</td>
              <td style={{ padding: '7px 4px', fontFamily: 'var(--f-label)', color: 'var(--ink)', fontSize: 13.5 }}>{s.pace ?? '—'}</td>
              <td style={{ padding: '7px 4px', textAlign: 'right', color: s.hr ? 'var(--ink)' : 'var(--dim)', fontFamily: 'var(--f-label)', fontSize: 13 }}>{s.hr ?? '—'}</td>
              <td style={{ padding: '7px 4px', textAlign: 'right', color: s.cadence ? 'var(--ink)' : 'var(--dim)', fontFamily: 'var(--f-label)', fontSize: 13 }}>{s.cadence ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Inline-copied presentational helpers (kept identical to /runs/[id] page) ──

function BigStat({ v, u, color }: { v: string; u: string; color: string }) {
  return (
    <div style={{ padding: '12px 14px', background: '#1f2226', borderRadius: 12 }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 30, color, lineHeight: 1 }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase', marginTop: 4 }}>{u}</div>
    </div>
  );
}

function SplitsBars({ splits }: { splits: { mile: number; pace: string | null; hr: number | null; cadence: number | null }[] }) {
  const paces = splits.map((s) => parsePace(s.pace)).filter((p): p is number => p != null);
  if (paces.length === 0) return <div style={{ color: 'var(--mute)', fontSize: 11, marginTop: 8 }}>(no pace data)</div>;
  const minP = Math.min(...paces);
  const maxP = Math.max(...paces);
  const range = Math.max(60, maxP - minP);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'end', gap: 2, height: 60, marginTop: 8 }}>
        {splits.map((s) => {
          const p = parsePace(s.pace) ?? maxP;
          const norm = 1 - Math.min(1, (p - minP) / range);
          return (
            <div key={s.mile} style={{
              flex: 1, height: `${20 + norm * 70}%`,
              background: s.mile === splits.length ? 'var(--goal)' : 'var(--green)',
              borderRadius: '2px 2px 0 0', opacity: 0.85,
            }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
        {splits.map((s) => (
          <div key={s.mile} style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)' }}>
            {s.mile}{s.pace ? ` · ${s.pace}` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ShoePicker — custom dropdown to replace the native <select> on the run
// detail modal. The native select's popover (white background, bright iOS
// blue selection) was wildly off-theme on every browser/OS combo. This
// renders a styled trigger button plus an absolutely-positioned popover
// that stays inside the app's dark palette. Click outside or pick a row
// to close.
// ─────────────────────────────────────────────────────────────────────
function ShoePicker({
  shoes,
  value,
  onChange,
}: {
  shoes: Array<any>;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on click outside / Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shoeLabel = (s: any) => {
    const name = [s.brand, s.model].filter(Boolean).join(' ') || s.name || `Shoe #${s.id}`;
    return name;
  };
  const shoeMileage = (s: any) => {
    if (s.mileage == null) return null;
    const used = Math.round(s.mileage);
    return s.mileage_cap ? `${used} / ${s.mileage_cap} mi` : `${used} mi`;
  };
  const selected = value != null ? shoes.find((s: any) => s.id === value) : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          background: 'rgba(255,255,255,0.05)',
          color: 'var(--ink)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          padding: '10px 12px',
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selected ? shoeLabel(selected) : <span style={{ color: 'var(--mute)' }}>— No shoe assigned —</span>}
          </span>
          {selected && shoeMileage(selected) && (
            <span style={{ color: 'var(--mute)', fontSize: 11, flexShrink: 0 }}>{shoeMileage(selected)}</span>
          )}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50,
            background: '#16191e',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding: 4,
            boxShadow: '0 12px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)',
            maxHeight: 280, overflowY: 'auto',
          }}
        >
          <ShoeRow
            label={<span style={{ color: 'var(--mute)' }}>— No shoe assigned —</span>}
            sub={null}
            selected={value == null}
            onClick={() => { onChange(null); setOpen(false); }}
          />
          {shoes.map((s: any) => {
            const mi = shoeMileage(s);
            const pct = s.mileage != null && s.mileage_cap ? s.mileage / s.mileage_cap : null;
            const wearColor = pct == null ? 'var(--mute)'
              : pct >= 0.9 ? 'var(--over)'
              : pct >= 0.75 ? 'var(--goal)'
              : 'var(--mute)';
            return (
              <ShoeRow
                key={s.id}
                label={shoeLabel(s)}
                sub={mi ? <span style={{ color: wearColor }}>{mi}</span> : null}
                selected={value === s.id}
                onClick={() => { onChange(s.id); setOpen(false); }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ShoeRow({
  label, sub, selected, onClick,
}: {
  label: React.ReactNode;
  sub: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        background: selected ? 'rgba(62,189,65,0.16)' : (hover ? 'rgba(255,255,255,0.05)' : 'transparent'),
        border: 'none',
        color: 'var(--ink)',
        padding: '9px 10px',
        borderRadius: 7,
        fontFamily: 'var(--f-body)',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {selected && (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ color: 'var(--green)', flexShrink: 0 }}>
            <path d="M2 5.5l2.5 2.5L9 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </span>
      {sub && <span style={{ fontSize: 11, flexShrink: 0 }}>{sub}</span>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HRSection — Round 4 combo from docs/run-detail-redesign-2026-05-27.html.
// Hero zone tile (with vertical spectrum rail) + peak HR gauge +
// AVG-vs-LTHR donut + zone-colored HR timeline.
//
// Auto-picks dominant zone label (Z2 / Z3-Z4 / MIXED). Builds timeline
// trace from phase_breakdown when available, falls back to splits.
// Renders nothing if no HR data exists.
// ─────────────────────────────────────────────────────────────────────

type ZoneKey = 'z1' | 'z2' | 'z3' | 'z4' | 'z5';
type ZonePcts = Record<ZoneKey, number>;

const ZONE_COLOR: Record<ZoneKey, string> = {
  z1: '#008FEC', z2: '#3EBD41', z3: '#F3AD38', z4: '#FC4D64', z5: '#FC4D64',
};
const ZONE_NAME: Record<ZoneKey, string> = {
  z1: 'Z1', z2: 'Z2', z3: 'Z3', z4: 'Z4', z5: 'Z5',
};
const ZONE_BLURB: Record<ZoneKey, string> = {
  z1: 'recovery',
  z2: 'aerobic',
  z3: 'tempo',
  z4: 'threshold',
  z5: 'VO2 max',
};

/** Pick the headline label for the hero tile.
 *   - Single zone ≥ 60% → that zone (e.g. "Z2")
 *   - Two adjacent zones ≥ 70% combined → combo ("Z3-Z4")
 *   - Otherwise → "MIXED" */
function dominantZoneLabel(p: ZonePcts): { label: string; color: string; key: ZoneKey | 'mixed' } {
  const zones: ZoneKey[] = ['z1', 'z2', 'z3', 'z4', 'z5'];
  const top = zones.reduce((a, b) => (p[a] >= p[b] ? a : b));
  if (p[top] >= 60) return { label: ZONE_NAME[top], color: ZONE_COLOR[top], key: top };
  // Adjacent-pair fallback
  for (let i = 0; i < zones.length - 1; i++) {
    const a = zones[i], b = zones[i + 1];
    const sum = p[a] + p[b];
    if (sum >= 70 && p[a] >= 15 && p[b] >= 15) {
      const higher = p[a] > p[b] ? a : b;
      return { label: `${ZONE_NAME[a]}-${ZONE_NAME[b]}`, color: ZONE_COLOR[higher], key: higher };
    }
  }
  return { label: 'MIXED', color: 'var(--mute)', key: 'mixed' };
}

/** Build a {tFrac, hr} series for the timeline trace. Prefer phases
 *  (richer for structured workouts) and fall back to splits. Returns
 *  null if neither source has enough data. tFrac is 0→1 along the run. */
function buildTimelineSeries(d: RunDetail): { points: { t: number; hr: number }[]; phases: { tStart: number; tEnd: number; type: PhaseBreakdown['type']; label: string }[] } | null {
  // Phase path — when watch shipped per-phase data with durations + HR.
  const phasesWithHR = d.phase_breakdown.filter(
    (p) => (p.avg_hr ?? 0) > 0 && (p.actual_duration_sec ?? 0) > 0
  );
  if (phasesWithHR.length >= 2) {
    const totalSec = phasesWithHR.reduce((s, p) => s + (p.actual_duration_sec ?? 0), 0);
    const pts: { t: number; hr: number }[] = [];
    const phaseSpans: { tStart: number; tEnd: number; type: PhaseBreakdown['type']; label: string }[] = [];
    let acc = 0;
    for (const p of phasesWithHR) {
      const dur = p.actual_duration_sec ?? 0;
      const tStart = acc / totalSec;
      const tEnd = (acc + dur) / totalSec;
      // Two points per phase for a flat-top step look (cleaner than
      // single-point interpolation between phase centroids).
      pts.push({ t: tStart, hr: p.avg_hr! });
      pts.push({ t: tEnd,   hr: p.avg_hr! });
      phaseSpans.push({ tStart, tEnd, type: p.type, label: p.label });
      acc += dur;
    }
    return { points: pts, phases: phaseSpans };
  }
  // Splits fallback — one HR sample per mile.
  const splitHR = d.splits.filter((s) => s.hr != null && s.hr > 0);
  if (splitHR.length >= 2) {
    const n = splitHR.length;
    const pts = splitHR.map((s, i) => ({ t: i / (n - 1), hr: s.hr! }));
    return { points: pts, phases: [] };
  }
  return null;
}

/** Convert HR bpm → SVG y coordinate in a 0–80 viewBox. Maps the
 *  full visible HR range so the trace fills the chart. */
function hrToY(bpm: number, minHR: number, maxHR: number): number {
  const span = Math.max(20, maxHR - minHR);
  const clamped = Math.max(minHR, Math.min(maxHR, bpm));
  // Margin at top (8) and bottom (8) so trace doesn't touch edges.
  return 8 + (1 - (clamped - minHR) / span) * 64;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

function HRSection({ d }: { d: RunDetail }) {
  const pcts = d.hrZonePcts;
  const dom = dominantZoneLabel(pcts);
  const lthr = d.hr_zones_from_lthr?.lthr ?? null;
  const ranges = d.hr_zones_from_lthr?.ranges ?? [];

  // Stable lookup for range bpm strings.
  const rangeBpm = (key: ZoneKey): string => {
    const r = ranges.find((x) => x.label.toLowerCase() === key);
    return r ? `${r.lower}-${r.upper}` : '';
  };

  // Hero subline — % + bpm range or descriptive blurb.
  const heroSubline = dom.key === 'mixed'
    ? `MIXED ZONES · NO SINGLE DOMINANT`
    : `${Math.round(pcts[dom.key])}% IN ZONE${rangeBpm(dom.key) ? ` · ${rangeBpm(dom.key)} BPM` : ''}`;

  // Hero note — interpretive one-liner from existing hrInterpretation.
  const heroNote = hrInterpretation(pcts, d.type);

  // Total run time in seconds for the timeline.
  const totalSec = (() => {
    if (!d.time_moving) return 0;
    const parts = d.time_moving.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  })();

  // Peak HR gauge marker position. Linear scale 100-200 bpm.
  const peakLeftPct = d.hr_max != null
    ? Math.max(0, Math.min(100, ((d.hr_max - 100) / 100) * 100))
    : 0;

  // LTHR ratio (avg / LTHR) for the donut.
  const lthrRatio = (d.hr_avg != null && lthr != null && lthr > 0)
    ? Math.round((d.hr_avg / lthr) * 100)
    : null;
  const lthrRatioColor = lthrRatio == null ? 'var(--mute)'
    : lthrRatio >= 100 ? 'var(--over)'
    : lthrRatio >= 88  ? 'var(--goal)'
    : 'var(--green)';
  // Donut: full circle dasharray = 163 (2πr where r=26). Offset shrinks
  // the visible arc to the ratio %.
  const donutOffset = lthrRatio == null ? 163 : 163 * (1 - Math.min(105, lthrRatio) / 105);

  // Timeline data
  const series = buildTimelineSeries(d);
  const timelineMinHR = Math.max(60, (lthr ?? 160) - 80);
  const timelineMaxHR = Math.max((d.hr_max ?? 0) + 6, (lthr ?? 160) + 16);

  // Build SVG path string for the trace.
  const tracePath = series && series.points.length > 0
    ? series.points.reduce((acc, p, i) => {
        const x = p.t * 400;
        const y = hrToY(p.hr, timelineMinHR, timelineMaxHR);
        return acc + (i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`);
      }, '')
    : '';

  // Peak marker on the trace — find max-HR point in the series.
  const peakPoint = series?.points.reduce((best, p) => (p.hr > best.hr ? p : best), series.points[0]);
  const peakX = peakPoint ? peakPoint.t * 100 : 0;
  const peakY = peakPoint && timelineMaxHR > timelineMinHR
    ? hrToY(peakPoint.hr, timelineMinHR, timelineMaxHR)
    : 0;
  const peakYPct = (peakY / 80) * 100;

  // Y position of LTHR and AVG lines (in viewBox 0-80).
  const lthrY = lthr != null ? hrToY(lthr, timelineMinHR, timelineMaxHR) : null;
  const avgY = d.hr_avg != null ? hrToY(d.hr_avg, timelineMinHR, timelineMaxHR) : null;

  // Spectrum rail flex values — give a min weight to zero-zones so they
  // remain visible as thin slivers.
  const railFlex = (z: ZoneKey): number => Math.max(0.5, pcts[z] / 10);

  // Time tick labels for x-axis (5 evenly spaced).
  const tickLabels = totalSec > 0
    ? [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => f === 0 ? '0' : f === 1 ? fmtTime(totalSec) : fmtTime(Math.round(totalSec * f)))
    : ['', '', '', '', '', ''];

  return (
    <div style={{
      // 2026-05-27: was #06080b (near-black) → reads as a hole punched in the
      // modal. Other run-detail cards use #1f2226; matching that here lets the
      // HR block sit in the visual stack instead of plunging out of it.
      background: '#1f2226', borderRadius: 14, padding: 14, border: '1px solid var(--line2)',
      display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gridTemplateRows: 'auto auto', gap: 10,
      marginBottom: 12,
    }}>
      {/* Vertical zone-trace gradient — used by the timeline below */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="zoneTraceGrad" x1="0" y1="0" x2="0" y2="80" gradientUnits="userSpaceOnUse">
            <stop offset="0"     stopColor="#FC4D64" />
            <stop offset="0.16"  stopColor="#FC4D64" />
            <stop offset="0.34"  stopColor="#F3AD38" />
            <stop offset="0.55"  stopColor="#3EBD41" />
            <stop offset="0.85"  stopColor="#008FEC" />
            <stop offset="1"     stopColor="#008FEC" />
          </linearGradient>
        </defs>
      </svg>

      {/* HERO TILE — spans 2 rows. Includes spectrum rail on the right. */}
      <div style={{
        gridRow: 'span 2',
        background: `linear-gradient(135deg, ${dom.color === 'var(--mute)' ? 'rgba(138,144,160,0.10)' : `${dom.color}1a`} 0%, transparent 100%)`,
        borderRadius: 12, padding: 22, border: `1px solid ${dom.color === 'var(--mute)' ? 'rgba(138,144,160,0.25)' : `${dom.color}33`}`,
        display: 'grid', gridTemplateColumns: '1fr 70px', gap: 14,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <svg width="11" height="10" viewBox="0 0 11 10" fill="var(--mute)" style={{ opacity: 0.55 }}>
                <path d="M5.5 9.3 1 5C-0.6 3.4 0.6 0.7 2.9 0.7c1 0 1.9.5 2.6 1.4C6.2 1.2 7.1.7 8.1.7c2.3 0 3.5 2.7 1.9 4.3L5.5 9.3z"/>
              </svg>
              <span style={{ fontSize: 10, color: 'var(--mute)', letterSpacing: '1.6px', fontWeight: 700 }}>HEART RATE</span>
            </div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 56, lineHeight: 0.85, letterSpacing: '-0.02em', color: dom.color }}>
              {dom.label}
            </div>
            {d.time_moving && (
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 26, color: 'var(--ink)', marginTop: 8, lineHeight: 1 }}>
                {d.time_moving}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--mute)', letterSpacing: '1.3px', marginTop: 4, fontWeight: 700 }}>
              {heroSubline}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(246,247,248,0.7)', fontStyle: 'italic', lineHeight: 1.5, marginTop: 12 }}>
            {heroNote}
          </div>
        </div>

        {/* Spectrum rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, height: '100%' }}>
          <div style={{ fontSize: 8, color: 'var(--mute)', letterSpacing: '1.2px', fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>SPECTRUM</div>
          {(['z5', 'z4', 'z3', 'z2', 'z1'] as ZoneKey[]).map((z) => {
            const isDominant = pcts[z] >= 25;
            const flex = railFlex(z);
            const pct = pcts[z];
            return (
              <div key={z} style={{
                flex,
                background: isDominant
                  ? `linear-gradient(180deg, ${ZONE_COLOR[z]}, ${ZONE_COLOR[z]}cc)`
                  : `${ZONE_COLOR[z]}1c`,
                borderRadius: 4,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                minHeight: 14, padding: 2,
                boxShadow: isDominant ? `inset 0 0 0 1px rgba(255,255,255,0.12)` : 'none',
              }}>
                <div style={{
                  fontFamily: 'var(--f-display)', fontSize: isDominant ? 12 : 10, letterSpacing: '0.5px', lineHeight: 1,
                  color: isDominant ? '#fff' : `${ZONE_COLOR[z]}80`,
                }}>{ZONE_NAME[z]}</div>
                {pct >= 5 && (
                  <div style={{
                    fontSize: 8, letterSpacing: '0.5px', marginTop: 1,
                    color: isDominant ? '#fff' : `${ZONE_COLOR[z]}b0`,
                    opacity: 0.85,
                  }}>{Math.round(pct)}%</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* PEAK HR GAUGE */}
      <div style={{ background: 'rgba(255,255,255,0.035)', borderRadius: 12, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 9, color: 'var(--mute)', letterSpacing: '1.4px', fontWeight: 700, marginBottom: 8 }}>PEAK HR</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 24, color: 'var(--ink)', lineHeight: 1 }}>{d.hr_max ?? '—'}</span>
          <span style={{ fontSize: 10, color: 'var(--mute)' }}>bpm</span>
        </div>
        <div style={{
          height: 6, borderRadius: 3, position: 'relative',
          background: 'linear-gradient(90deg, var(--rest), var(--green) 40%, var(--goal) 65%, var(--over) 85%)',
        }}>
          {d.hr_max != null && (
            <div style={{
              position: 'absolute', top: -3, left: `${peakLeftPct}%`,
              width: 2, height: 12, background: '#fff', borderRadius: 1,
            }}/>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 8, color: 'var(--mute)', letterSpacing: '0.8px' }}>
          <span>100</span><span>{lthr ? `LTHR ${lthr}` : ''}</span><span>200</span>
        </div>
      </div>

      {/* AVG vs LTHR DONUT */}
      <div style={{ background: 'rgba(255,255,255,0.035)', borderRadius: 12, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg viewBox="0 0 60 60" style={{ width: 54, height: 54, flexShrink: 0, transform: 'rotate(-90deg)' }}>
          <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          {lthrRatio != null && (
            <circle cx="30" cy="30" r="26" fill="none" stroke={lthrRatioColor} strokeWidth="6"
                    strokeDasharray="163" strokeDashoffset={donutOffset} strokeLinecap="round"/>
          )}
        </svg>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 20, color: 'var(--ink)', lineHeight: 1 }}>
            {lthrRatio != null ? lthrRatio : '—'}
            <span style={{ fontSize: 10, color: 'var(--mute)' }}>%</span>
          </div>
          <div style={{ fontSize: 8, color: 'var(--mute)', letterSpacing: '1.2px', fontWeight: 700, marginTop: 4, textTransform: 'uppercase' }}>AVG vs LTHR</div>
          <div style={{ fontSize: 9, marginTop: 2, color: lthrRatioColor }}>
            {d.hr_avg ?? '—'} / {lthr ?? '—'} bpm
          </div>
        </div>
      </div>

      {/* HR TIMELINE / SUMMARY — spans 2 cols on bottom row.
          2026-05-27: when no per-time data, swap header label from
          "HR TIMELINE" to "HR SUMMARY" and drop the "line color = zone"
          hint — it was promising a chart we couldn't draw, then saying
          "no data" right below. Honest. */}
      <div style={{
        gridColumn: 'span 2',
        background: 'rgba(255,255,255,0.035)', borderRadius: 12, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--mute)', letterSpacing: '1.4px', fontWeight: 700 }}>
            {series ? 'HR TIMELINE' : 'HR SUMMARY'}{totalSec > 0 ? ` · ${fmtTime(totalSec)}` : ''}
            {d.hr_avg != null ? ` · AVG ${d.hr_avg}` : ''}
            {d.hr_max != null ? ` · PEAK ${d.hr_max}` : ''}
          </span>
          {series && (
            <span style={{ fontSize: 10, color: 'var(--mute)', letterSpacing: '1.4px', fontWeight: 700 }}>line color = zone</span>
          )}
        </div>

        {series ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 36px', gap: 0, position: 'relative' }}>
              {/* Left gutter: LTHR + AVG labels positioned by y-fraction */}
              <div style={{ position: 'relative', height: 80 }}>
                {lthrY != null && (
                  <div style={{
                    position: 'absolute', right: 8, top: `${(lthrY / 80) * 100}%`, transform: 'translateY(-50%)',
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.4px', color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap',
                  }}>LTHR</div>
                )}
                {avgY != null && d.hr_avg != null && Math.abs((avgY ?? 0) - (lthrY ?? -999)) > 7 && (
                  <div style={{
                    position: 'absolute', right: 8, top: `${(avgY / 80) * 100}%`, transform: 'translateY(-50%)',
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.4px', color: dom.color, whiteSpace: 'nowrap',
                  }}>AVG {d.hr_avg}</div>
                )}
              </div>

              {/* Chart column */}
              <div style={{ position: 'relative', height: 80 }}>
                <svg viewBox="0 0 400 80" preserveAspectRatio="none" style={{ width: '100%', height: 80, display: 'block' }}>
                  {/* LTHR reference */}
                  {lthrY != null && (
                    <line x1="0" x2="400" y1={lthrY} y2={lthrY}
                          stroke="rgba(255,255,255,0.30)" strokeWidth="0.7" strokeDasharray="4,3"/>
                  )}
                  {/* AVG HR reference */}
                  {avgY != null && (
                    <line x1="0" x2="400" y1={avgY} y2={avgY}
                          stroke={`${dom.color}80`} strokeWidth="0.5" strokeDasharray="3,4"/>
                  )}
                  {/* Phase span tints (warmup green, work red, recovery blue, cooldown green) */}
                  {series.phases.map((ph, i) => {
                    const x = ph.tStart * 400;
                    const w = (ph.tEnd - ph.tStart) * 400;
                    const fill = ph.type === 'work' ? 'rgba(252,77,100,0.04)'
                      : ph.type === 'recovery' ? 'rgba(0,143,236,0.03)'
                      : ph.type === 'warmup' || ph.type === 'cooldown' ? 'rgba(62,189,65,0.03)'
                      : 'transparent';
                    return <rect key={i} x={x} y="6" width={w} height="64" fill={fill} />;
                  })}
                  {/* Trace */}
                  <path d={tracePath} fill="none" stroke="url(#zoneTraceGrad)"
                        strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"/>
                  {/* Peak dot */}
                  {peakPoint && (
                    <circle cx={peakX * 4} cy={peakY} r="3" fill="#FC4D64"/>
                  )}
                </svg>

                {/* Peak HR floating tag */}
                {peakPoint && d.hr_max != null && (
                  <div style={{
                    position: 'absolute', left: `${peakX}%`, top: `${peakYPct}%`,
                    transform: 'translate(-50%, -100%)',
                    background: 'rgba(15,17,21,0.92)', border: '1px solid rgba(252,77,100,0.5)', borderRadius: 4,
                    padding: '2px 6px', fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '0.3px',
                    whiteSpace: 'nowrap', zIndex: 3, lineHeight: 1.2, marginTop: -4,
                    pointerEvents: 'none',
                  }}>
                    {d.hr_max} PEAK
                  </div>
                )}

                {/* Phase chips overlay (HTML for crispness) */}
                {series.phases.length > 1 && (
                  <div style={{ position: 'absolute', inset: '0 0 0 0', pointerEvents: 'none' }}>
                    {series.phases.map((ph, i) => {
                      const center = ((ph.tStart + ph.tEnd) / 2) * 100;
                      const color = ph.type === 'work' ? '#FC4D64'
                        : ph.type === 'recovery' ? 'var(--mute)'
                        : 'var(--mute)';
                      const shortLabel = ph.type === 'warmup' ? 'W'
                        : ph.type === 'cooldown' ? 'CD'
                        : ph.type === 'recovery' ? 'r'
                        : ph.label.replace(/Rep\s*/i, 'R').replace(/\s*\/\s*\d+/, '');
                      return (
                        <div key={i} style={{
                          position: 'absolute', left: `${center}%`, bottom: -2, transform: 'translateX(-50%)',
                          fontSize: 9, fontWeight: 700, color, letterSpacing: '0.3px',
                        }}>{shortLabel}</div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right gutter: zone labels */}
              <div style={{
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 80,
                padding: '2px 4px 2px 8px', fontSize: 9, fontWeight: 700, letterSpacing: '0.4px', lineHeight: 1,
              }}>
                {(['z5','z4','z3','z2','z1'] as ZoneKey[]).map((z) => {
                  const active = pcts[z] >= 10;
                  return (
                    <div key={z} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', height: 14,
                      color: active ? ZONE_COLOR[z] : `${ZONE_COLOR[z]}55`,
                    }}>{ZONE_NAME[z]}</div>
                  );
                })}
              </div>
            </div>
            {/* X-axis ticks */}
            <div style={{
              display: 'grid', gridTemplateColumns: '50px 1fr 36px', marginTop: 6,
              fontSize: 10, color: 'var(--mute)', letterSpacing: '0.4px', fontWeight: 600,
            }}>
              <div/>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px' }}>
                {tickLabels.map((t, i) => <span key={i}>{t}</span>)}
              </div>
              <div/>
            </div>
          </>
        ) : (
          <HrSummaryFallback
            pcts={pcts}
            totalSec={totalSec}
            hrAvg={d.hr_avg}
            hrMax={d.hr_max}
            lthr={lthr}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Honest fallback when we have aggregate HR but no per-time series.
 * Was previously "No per-phase or per-mile HR data on this run" — read
 * as a contradiction because the header right above said "AVG 140 ·
 * PEAK 153". David flagged it. New version uses real data we have:
 *   - horizontal time-in-zone stacked bar (zone pcts × total time)
 *   - bpm scale with AVG, PEAK, LTHR markers
 *   - short summary line
 */
function HrSummaryFallback({
  pcts, totalSec, hrAvg, hrMax, lthr,
}: {
  pcts: ZonePcts;
  totalSec: number;
  hrAvg: number | null;
  hrMax: number | null;
  lthr: number | null;
}) {
  const zones: ZoneKey[] = ['z1', 'z2', 'z3', 'z4', 'z5'];
  const hasZoneData = zones.some((z) => pcts[z] > 0.5);

  // bpm axis — anchor on LTHR when present, otherwise span 100-200.
  const axisMin = lthr ? Math.max(80, lthr - 60) : 100;
  const axisMax = lthr ? Math.max((hrMax ?? 0) + 8, lthr + 20) : 200;
  const axisSpan = axisMax - axisMin;
  const pctOnAxis = (bpm: number) =>
    Math.max(0, Math.min(100, ((bpm - axisMin) / axisSpan) * 100));

  // Pick dominant zone for the one-liner.
  const dominantKey: ZoneKey = zones.reduce((best, k) => (pcts[k] > pcts[best] ? k : best), 'z2');
  const dominantPct = Math.round(pcts[dominantKey]);
  const fmtZoneTime = (z: ZoneKey) => {
    const sec = Math.round(totalSec * (pcts[z] / 100));
    if (sec <= 0) return '0';
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    return `${m}m`;
  };

  // Build a one-line interpretive summary.
  const summary: string = (() => {
    if (!hasZoneData) {
      if (hrAvg != null) {
        return `Averaged ${hrAvg} bpm${hrMax != null ? `, peaked at ${hrMax}` : ''}. No per-time HR samples on this run, so no second-by-second trace.`;
      }
      return 'No detailed HR breakdown for this run.';
    }
    const zoneName = ZONE_NAME[dominantKey];
    return `${dominantPct}% of moving time in ${zoneName}${
      hrMax != null && hrAvg != null ? `. Averaged ${hrAvg} bpm, peaked at ${hrMax}` : ''
    }. Per-time samples aren't available — the bar shows time-in-zone, the scale shows where AVG and PEAK landed.`;
  })();

  return (
    <div style={{ paddingTop: 4, paddingBottom: 2 }}>
      {/* TIME-IN-ZONE STACKED BAR */}
      {hasZoneData && (
        <div>
          <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
            {zones.map((z) => {
              const pct = pcts[z];
              if (pct < 0.5) return null;
              return (
                <div key={z} style={{
                  flex: pct, background: ZONE_COLOR[z],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 18,
                }}>
                  {pct >= 8 && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: '0.4px' }}>
                      {ZONE_NAME[z]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', marginTop: 4, fontSize: 9, color: 'var(--mute)', letterSpacing: '0.3px', fontWeight: 600 }}>
            {zones.map((z) => {
              const pct = pcts[z];
              if (pct < 0.5) return null;
              return (
                <div key={z} style={{ flex: pct, textAlign: 'center', minWidth: 18 }}>
                  {Math.round(pct)}% · {fmtZoneTime(z)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* BPM SCALE — AVG, PEAK, LTHR markers + collision-staggered labels.
          2026-05-27: David flagged the labels collide when AVG/PEAK/LTHR
          cluster (e.g. avg 140 / peak 153 / LTHR 162 on a narrow card).
          Refactored: ticks-only on the track, labels rendered in a
          separate row underneath with vertical stagger when neighbours
          would overlap. Three-row max (ticks + label row A + label row B). */}
      {(hrAvg != null || hrMax != null) && (() => {
        // Collect markers in left-to-right order with their style + label.
        type Marker = { id: 'lthr' | 'avg' | 'peak'; pct: number; label: string; color: string; tickColor: string; bold: boolean };
        const markers: Marker[] = [];
        if (lthr != null && lthr >= axisMin && lthr <= axisMax) {
          markers.push({ id: 'lthr', pct: pctOnAxis(lthr), label: `LTHR ${lthr}`, color: 'rgba(255,255,255,0.55)', tickColor: 'rgba(255,255,255,0.35)', bold: false });
        }
        if (hrAvg != null && hrAvg >= axisMin && hrAvg <= axisMax) {
          markers.push({ id: 'avg', pct: pctOnAxis(hrAvg), label: `AVG ${hrAvg}`, color: '#fff', tickColor: '#fff', bold: true });
        }
        if (hrMax != null && hrMax >= axisMin && hrMax <= axisMax) {
          markers.push({ id: 'peak', pct: pctOnAxis(hrMax), label: `PEAK ${hrMax}`, color: '#FC4D64', tickColor: '#FC4D64', bold: true });
        }
        markers.sort((a, b) => a.pct - b.pct);
        // Assign each marker to row A or B based on horizontal distance
        // from the previous label. <14% of axis width → must go on the
        // other row so labels don't collide.
        const rows: Record<string, 'A' | 'B'> = {};
        let lastA: number | null = null;
        let lastB: number | null = null;
        for (const m of markers) {
          const aClear = lastA == null || (m.pct - lastA) >= 14;
          const bClear = lastB == null || (m.pct - lastB) >= 14;
          // Prefer row A; spill to B only when A would collide.
          if (aClear) { rows[m.id] = 'A'; lastA = m.pct; }
          else if (bClear) { rows[m.id] = 'B'; lastB = m.pct; }
          else { rows[m.id] = 'A'; lastA = m.pct; }  // overflow — pick anyway
        }
        const labelRowB = Object.values(rows).includes('B');

        return (
          <div style={{ marginTop: hasZoneData ? 16 : 4 }}>
            {/* Track + tick row (28px tall) */}
            <div style={{ position: 'relative', height: 28 }}>
              {/* base track */}
              <div style={{
                position: 'absolute', left: 0, right: 0, top: 12, height: 4, borderRadius: 2,
                background: 'linear-gradient(90deg, rgba(0,143,236,0.35), rgba(62,189,65,0.45) 40%, rgba(243,173,56,0.5) 70%, rgba(252,77,100,0.55) 100%)',
              }}/>
              {markers.map((m) => (
                <div key={m.id} style={{ position: 'absolute', left: `${m.pct}%`, top: 0, transform: 'translateX(-50%)' }}>
                  {m.id === 'peak' ? (
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: m.tickColor, margin: '11px auto 0', boxShadow: `0 0 0 2px ${m.tickColor}40` }}/>
                  ) : (
                    <div style={{ width: m.bold ? 2 : 1, height: 16, background: m.tickColor, margin: '4px auto 0', borderRadius: 1 }}/>
                  )}
                </div>
              ))}
            </div>
            {/* Label row A — anchored to ticks, no collisions within row */}
            <div style={{ position: 'relative', height: 14, marginTop: 2 }}>
              {markers.filter((m) => rows[m.id] === 'A').map((m) => (
                <div key={m.id} style={{
                  position: 'absolute', left: `${m.pct}%`, transform: 'translateX(-50%)',
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.3px',
                  color: m.color, whiteSpace: 'nowrap',
                }}>{m.label}</div>
              ))}
            </div>
            {/* Label row B — only renders when a marker had to spill */}
            {labelRowB && (
              <div style={{ position: 'relative', height: 14, marginTop: 2 }}>
                {markers.filter((m) => rows[m.id] === 'B').map((m) => (
                  <div key={m.id} style={{
                    position: 'absolute', left: `${m.pct}%`, transform: 'translateX(-50%)',
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.3px',
                    color: m.color, whiteSpace: 'nowrap',
                  }}>{m.label}</div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Honest one-liner */}
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mute)', lineHeight: 1.5 }}>
        {summary}
      </div>
    </div>
  );
}

function HRZones({
  pcts,
  ranges,
}: {
  pcts: { z1: number; z2: number; z3: number; z4: number; z5: number };
  /** Optional LTHR-derived bpm ranges per zone, rendered alongside each row. */
  ranges?: { label: string; lower: number; upper: number }[] | null;
}) {
  // 2026-05-27 redesign: was a single thin stacked bar where every
  // segment was the same color in practice (100% in one zone → solid
  // green blob, no zone labeling on the bar). David: "no idea what
  // this is showing." Now one row per zone — zone label · bpm range ·
  // proportional bar in the zone's color · % at the right edge. You
  // can see at a glance which zones the run actually hit.
  const colors: Record<'z1'|'z2'|'z3'|'z4'|'z5', string> = {
    z1: 'var(--rest)',
    z2: 'var(--green)',
    z3: 'var(--goal)',
    z4: 'var(--over)',
    z5: 'var(--over)',
  };
  const rangeByLabel = new Map<string, { lower: number; upper: number }>();
  (ranges ?? []).forEach((r) => rangeByLabel.set(r.label.toLowerCase(), r));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      {(['z1','z2','z3','z4','z5'] as const).map((z) => {
        const pct = Math.max(0, Math.min(100, pcts[z] ?? 0));
        const rng = rangeByLabel.get(z);
        return (
          <div key={z} style={{
            display: 'grid',
            gridTemplateColumns: '36px 64px 1fr 48px',
            alignItems: 'center', gap: 10,
            opacity: pct > 0 ? 1 : 0.4,
          }}>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px', color: colors[z] }}>
              {z.toUpperCase()}
            </span>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '0.3px' }}>
              {rng ? `${rng.lower}–${rng.upper}` : ''}
            </span>
            <div style={{ position: 'relative', height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', inset: 0, width: `${pct}%`,
                background: colors[z], borderRadius: 4,
              }} />
            </div>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 600, color: 'var(--ink)', textAlign: 'right' }}>
              {Math.round(pct)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Chip helper kept inline-private — only used by /runs/[id] which still
// renders its own copy. Marked unused here intentionally.
function _Chip({ k, v, warm, children }: { k?: string; v?: string; warm?: boolean; children?: React.ReactNode }) {
  return (
    <span style={{
      background: warm ? 'rgba(243,173,56,0.08)' : 'rgba(255,255,255,0.04)',
      border: warm ? '1px solid rgba(243,173,56,0.30)' : '1px solid var(--line)',
      borderRadius: 999, padding: '6px 11px', fontSize: 11, color: warm ? 'var(--goal)' : 'var(--ink)',
    }}>
      {k && <span style={{ color: 'var(--mute)', marginRight: 4, fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase' }}>{k}</span>}
      {v && <span style={{ fontWeight: 600 }}>{v}</span>}
      {children}
    </span>
  );
}

function parsePace(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * True only when the work-only averages tell the runner something the
 * all-in averages above don't. For a single-phase easy run with no
 * warmup/cooldown, work pace ≈ all-in pace, work HR ≈ all-in HR, and
 * the card just duplicates info already on screen. We render it only
 * when at least one of pace/HR/cadence DIFFERS materially — that's
 * exactly the case the card was designed for (a quality workout where
 * recoveries pull the all-in averages soft).
 */
function hasMeaningfulWorkAverages(d: RunDetail): boolean {
  const noWorkData =
    d.pace_work == null &&
    d.hr_avg_work == null &&
    d.cadence_avg_work == null;
  if (noWorkData) return false;

  // Pace: differ by ≥ 5 seconds/mi → meaningful.
  const pAll = parsePace(d.pace ?? null);
  const pWork = parsePace(d.pace_work ?? null);
  if (pAll != null && pWork != null && Math.abs(pAll - pWork) >= 5) return true;

  // HR: differ by ≥ 3 bpm.
  if (d.hr_avg != null && d.hr_avg_work != null && Math.abs(d.hr_avg - d.hr_avg_work) >= 3) return true;

  // Cadence: differ by ≥ 3 spm.
  if (d.cadence_avg != null && d.cadence_avg_work != null && Math.abs(d.cadence_avg - d.cadence_avg_work) >= 3) return true;

  return false;
}
