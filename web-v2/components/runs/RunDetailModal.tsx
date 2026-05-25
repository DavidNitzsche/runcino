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

function RunDetailModal({ activityId, onClose }: { activityId: string; onClose: () => void }) {
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
  return (
    <>
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 36, margin: '4px 0 16px', letterSpacing: '0.5px', lineHeight: 1, color: 'var(--ink)' }}>
        {d.name ?? `${d.distance_mi.toFixed(1)} MI`}
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <BigStat v={d.distance_mi.toFixed(1)} u="miles" color="var(--dist)" />
        {d.pace        && <BigStat v={d.pace}              u="avg pace" color="var(--green)" />}
        {d.time_moving && <BigStat v={d.time_moving}       u="moving"   color="var(--ink)" />}
        {d.hr_avg != null && <BigStat v={String(d.hr_avg)} u="avg hr"   color="var(--mute)" />}
      </div>

      {d.splits.length > 0 && (
        <div className="card" style={{ padding: '16px 18px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--green)' }}>SPLITS · PACE PER MILE</div>
          <SplitsBars splits={d.splits} />
        </div>
      )}

      {(d.hrZonePcts.z2 + d.hrZonePcts.z3 + d.hrZonePcts.z4 + d.hrZonePcts.z5) > 0 && (
        <div className="card" style={{ padding: '16px 18px', marginBottom: 12, background: '#1f2226' }}>
          <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>HR · TIME IN ZONE</div>
          <HRZones pcts={d.hrZonePcts} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {d.cadence_avg && <Chip k="CAD" v={String(d.cadence_avg)} />}
        {d.temp_f != null && <Chip warm>{d.temp_f}° · {d.temp_f >= 75 ? 'warm' : 'cool'}</Chip>}
        {d.elev_gain_ft != null && <Chip k="GAIN" v={`${d.elev_gain_ft}ft`} />}
      </div>
    </>
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

function Chip({ k, v, warm, children }: { k?: string; v?: string; warm?: boolean; children?: React.ReactNode }) {
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
