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
import type { RunDetail } from '@/lib/coach/run-state';

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

  if (!activityId) {
    // No id yet (e.g. watch-synced run not yet linked to a Strava activity).
    // Show a muted hint instead of a dead link.
    return (
      <span style={{
        display: 'inline-block', marginTop: 12,
        fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--dim)',
        letterSpacing: '0.3px', fontStyle: 'italic',
        ...style,
      }}>
        Splits + route appear once the run finishes syncing.
      </span>
    );
  }

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

  useEffect(() => {
    let mounted = true;
    fetch(`/api/runs/${encodeURIComponent(activityId)}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error ?? 'failed'); }))
      .then((d) => { if (mounted) { setData(d); setLoading(false); } })
      .catch((e) => { if (mounted) { setError(e.message ?? String(e)); setLoading(false); } });
    return () => { mounted = false; };
  }, [activityId]);

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
        {data && <RunDetailBody d={data} />}
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

function RunDetailBody({ d }: { d: RunDetail }) {
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
            HR · TIME IN ZONE
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
        </div>
      )}

      {/* Route placeholder — shows when there's GPS data, even before we
          render the actual map */}
      {d.has_route && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--dist)' }}>ROUTE</div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', lineHeight: 1.55, marginTop: 6 }}>
            GPS recorded {d.elev_gain_ft != null ? `with ${d.elev_gain_ft}ft of climbing` : ''}.
            Map render lands in the next iteration.
          </div>
        </div>
      )}
    </>
  );
}

function SmallStat({ v, u }: { v: string; u: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.025)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--ink)', lineHeight: 1, letterSpacing: '0.3px' }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9.5, color: 'var(--mute)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 3 }}>{u}</div>
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
              <td style={{ padding: '7px 4px', fontFamily: 'var(--f-display)', color: 'var(--mute)', fontSize: 13 }}>{s.mile}</td>
              <td style={{ padding: '7px 4px', fontFamily: 'var(--f-display)', color: 'var(--ink)', fontSize: 13.5 }}>{s.pace ?? '—'}</td>
              <td style={{ padding: '7px 4px', textAlign: 'right', color: s.hr ? 'var(--ink)' : 'var(--dim)', fontFamily: 'var(--f-display)', fontSize: 13 }}>{s.hr ?? '—'}</td>
              <td style={{ padding: '7px 4px', textAlign: 'right', color: s.cadence ? 'var(--ink)' : 'var(--dim)', fontFamily: 'var(--f-display)', fontSize: 13 }}>{s.cadence ?? '—'}</td>
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
