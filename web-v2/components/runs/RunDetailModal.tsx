'use client';

/**
 * RunDetailModal — opens run detail (splits / HR zones / route) as a modal
 * overlay instead of navigating to /runs/[id]. Per user feedback: never
 * leave /today.
 *
 * Two-step: <RunDetailTrigger> renders the link/button; clicking opens
 * the modal which lazy-fetches /api/runs/[id].
 */

import { useState, useEffect } from 'react';
import type { RunDetail, PhaseBreakdown } from '@/lib/coach/run-state';
import { RouteSparkline } from './RouteSparkline';
import { FormStatButton } from './FormTipModal';

export function RunDetailTrigger({
  activityId,
  label = 'Splits · route · form data →',
  style,
}: {
  activityId: string | null | undefined;
  label?: string;
  style?: React.CSSProperties;
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
          display: 'inline-block', marginTop: 12,
          background: 'transparent', border: 'none', padding: 0,
          fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 500,
          color: 'var(--mute)', letterSpacing: '0.3px', cursor: 'pointer',
          ...style,
        }}
      >
        {label}
      </button>
      {open && <RunDetailModal activityId={activityId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function RunDetailModal({ activityId, onClose }: { activityId: string; onClose: () => void }) {
  const [data, setData] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shoes, setShoes] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/runs/${encodeURIComponent(activityId)}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error ?? 'failed'); }))
      .then((d) => { if (mounted) { setData(d); setLoading(false); } })
      .catch((e) => { if (mounted) { setError(e.message ?? String(e)); setLoading(false); } });
    // P32 — fetch shoes for the picker (active only)
    fetch('/api/shoe')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (mounted && j?.shoes) setShoes(j.shoes.filter((s: any) => !s.retired)); })
      .catch(() => {});
    return () => { mounted = false; };
  }, [activityId]);

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

function RunDetailBody({ d, shoes, onPickShoe }: { d: RunDetail; shoes: any[]; onPickShoe: (id: number | null) => void }) {
  const sourceLabel = d.source === 'watch' ? 'WATCH'
    : d.source === 'apple_health' ? 'APPLE HEALTH'
    : d.source === 'manual' ? 'MANUAL ENTRY'
    : d.source === 'strava' ? 'STRAVA' : d.source.toUpperCase();

  return (
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
          matches. Shows alongside the all-in numbers so the runner sees
          the "real" effort filter out recovery jogs.
          Phase data (Faff watch) wins over the splits heuristic. */}
      {(d.pace_work != null || d.hr_avg_work != null || d.cadence_avg_work != null) && (
        <div className="card" style={{ padding: '14px 16px', marginBottom: 14, background: 'rgba(243,173,56,0.05)', border: '1px solid rgba(243,173,56,0.20)' }}>
          <div className="card-eyebrow" style={{ color: 'var(--goal)', marginBottom: 6 }}>
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

      {/* P32 — shoe picker. Pick the active shoe used; server bumps mileage. */}
      {shoes.length > 0 && (
        <div className="card" style={{ padding: '14px 16px', marginBottom: 14, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--green)', marginBottom: 8 }}>SHOES</div>
          <select
            value={d.shoe_id ?? ''}
            onChange={(e) => onPickShoe(e.target.value ? Number(e.target.value) : null)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--ink)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: '8px 12px',
              fontFamily: 'var(--f-body)',
              fontSize: 13,
              width: '100%',
              cursor: 'pointer',
            }}
          >
            <option value="">— No shoe assigned —</option>
            {shoes.map((s: any) => (
              <option key={s.id} value={s.id}>
                {[s.brand, s.model].filter(Boolean).join(' ')}
                {s.mileage != null ? ` · ${Math.round(s.mileage)}mi` : ''}
                {s.mileage_cap ? ` / ${s.mileage_cap}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* P44 — phase-by-phase breakdown when the watch did a structured
          workout. Plan vs actual, one row per phase (warmup, reps,
          recoveries, cooldown). Empty for non-watch runs. */}
      {d.phase_breakdown && d.phase_breakdown.length > 0 && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>BREAKDOWN · PLAN vs ACTUAL</div>
          <PhaseBreakdownTable phases={d.phase_breakdown} />
        </div>
      )}

      {/* Splits chart — bar per mile by pace, w/ HR overlay if we have it */}
      {d.splits.length > 0 && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--green)' }}>SPLITS · {d.splits.length} MILES</div>
          <SplitsBars splits={d.splits} />
          <SplitsTable splits={d.splits} />
        </div>
      )}

      {/* HR Zone breakdown — shows where this run actually landed, plus
          the user's LTHR zone bands so they can see the relationship */}
      {(d.hrZonePcts.z1 + d.hrZonePcts.z2 + d.hrZonePcts.z3 + d.hrZonePcts.z4 + d.hrZonePcts.z5) > 0 && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>
            TIME IN HR ZONE · WHERE THIS RUN LANDED
            {d.hr_zones_from_lthr?.lthr ? <span style={{ marginLeft: 8, color: 'var(--mute)' }}>· LTHR {d.hr_zones_from_lthr.lthr}</span> : null}
          </div>
          <HRZones pcts={d.hrZonePcts} />
          {d.hr_zones_from_lthr && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginTop: 12 }}>
              {d.hr_zones_from_lthr.ranges.map((r) => (
                <div key={r.label} style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '0.5px', textAlign: 'center' }}>
                  <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.label}</span> {r.lower}-{r.upper}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, fontFamily: 'var(--f-body)', fontSize: 12, color: 'rgba(246,247,248,0.72)', lineHeight: 1.5 }}>
            {hrInterpretation(d.hrZonePcts, d.type)}
          </div>
        </div>
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

function HRZones({ pcts }: { pcts: { z1: number; z2: number; z3: number; z4: number; z5: number } }) {
  const colors = { z1: 'var(--rest)', z2: 'var(--green)', z3: 'var(--goal)', z4: 'var(--over)', z5: 'var(--over)' };
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginTop: 8 }}>
        {(['z1','z2','z3','z4','z5'] as const).map((z) => {
          if (pcts[z] <= 0) return null;
          return <div key={z} style={{ flex: pcts[z], background: colors[z] }} />;
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', marginTop: 6, letterSpacing: '0.5px' }}>
        {(['z1','z2','z3','z4','z5'] as const).map((z) => (
          <span key={z}>{z.toUpperCase()} {Math.round(pcts[z])}%</span>
        ))}
      </div>
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
