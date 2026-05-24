'use client';

/**
 * RunDetailModal, modal showing a completed run's details + the
 * matching planned workout.
 *
 * Triggered by clicking a row in /log's Recent Runs list. Fetches
 * /api/runs/[id] which returns:
 *   { run: { …actual Strava metrics… }, plan: { …matched plan day… } | null }
 *
 * Provider pattern: <RunDetailModalProvider> wraps the log page; rows
 * use openRunDetail(runId) to trigger.
 */

import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react';

interface ShoeInfo { brand: string; model: string; color: string | null }

interface MergedSource {
  id: number;
  name: string;
  distanceMi: number;
  movingTimeS: number;
  startLocal: string;
  source: string;
}

interface RunDetail {
  id: string;
  name: string;
  description: string | null;
  date: string;
  distanceMi: number;
  movingTimeS: number;
  paceSPerMi: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  elevGainFt: number;
  type: string;
  workoutType: number | null;
  summaryPolyline: string | null;
  shoe: ShoeInfo | null;
  /** Other rows folded into this canonical by auto-dedup. Empty when none. */
  mergedSources: MergedSource[];
  /** If THIS row was folded into another canonical, the canonical's id. */
  mergedIntoId: number | null;
}

interface PlanInfo {
  label: string;
  type: string;
  distanceMi: number;
  isRest: boolean;
  phase: string;
  paceTarget: string;
  zone: string | null;
}

interface ModalContextValue {
  open: (runId: string) => void;
}
const ModalContext = createContext<ModalContextValue | null>(null);

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return `${DOW_LONG[d.getUTCDay()]} · ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
function fmtPace(sPerMi: number): string {
  if (!sPerMi || sPerMi <= 0) return ', ';
  const m = Math.floor(sPerMi / 60);
  const s = sPerMi % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtTime(sec: number): string {
  if (!sec || sec <= 0) return ', ';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

export function RunDetailModalProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo<ModalContextValue>(() => ({ open: setOpenId }), []);
  return (
    <ModalContext.Provider value={value}>
      {children}
      {openId && <RunDetailModal runId={openId} onClose={() => setOpenId(null)} />}
    </ModalContext.Provider>
  );
}

export function useRunDetailModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('Wrap in <RunDetailModalProvider>');
  return ctx;
}

function RunDetailModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/${runId}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) setErr(j.error || 'Failed to load run');
        else { setRun(j.run); setPlan(j.plan); }
      })
      .catch(() => { if (!cancelled) setErr('Network error'); });
    return () => { cancelled = true; };
  }, [runId]);

  // Plan vs actual comparison
  const planComparison = (() => {
    if (!run || !plan || plan.isRest) return null;
    const ranPct = plan.distanceMi > 0 ? Math.round((run.distanceMi / plan.distanceMi) * 100) : 0;
    const status =
      ranPct >= 90 && ranPct <= 110 ? { label: 'ON PLAN', tone: 'green' as const } :
      ranPct >= 60 ? { label: `${ranPct}% OF PLAN`, tone: 'amber' as const } :
      { label: `BELOW PLAN (${ranPct}%)`, tone: 'amber' as const };
    return { ranPct, status };
  })();

  return (
    <div className="rd-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="rd-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="rd-close" onClick={onClose} aria-label="Close">×</button>

        {err && <div className="rd-error">{err}</div>}

        {!err && !run && (
          <div className="rd-loading">Loading…</div>
        )}

        {run && (
          <>
            <div className="rd-eyebrow">
              {fmtDate(run.date)}
              {run.workoutType === 1 && <span className="rd-pill race">RACE</span>}
              {run.workoutType === 2 && <span className="rd-pill long">LONG</span>}
              {run.workoutType === 3 && <span className="rd-pill workout">WORKOUT</span>}
            </div>
            <h2 className="rd-title">{run.name}</h2>

            <div className="rd-stats">
              <div className="rd-stat">
                <div className="rd-stat-val">{run.distanceMi.toFixed(1)}<small>mi</small></div>
                <div className="rd-stat-label">Distance</div>
              </div>
              <div className="rd-stat">
                <div className="rd-stat-val">{fmtTime(run.movingTimeS)}</div>
                <div className="rd-stat-label">Moving time</div>
              </div>
              <div className="rd-stat">
                <div className="rd-stat-val">{fmtPace(run.paceSPerMi)}<small>/mi</small></div>
                <div className="rd-stat-label">Pace</div>
              </div>
              <div className="rd-stat">
                <div className="rd-stat-val">{run.avgHr ?? '-'}<small>bpm</small></div>
                <div className="rd-stat-label">Avg HR</div>
              </div>
            </div>

            {/* Secondary metrics */}
            <div className="rd-meta-row">
              {run.elevGainFt > 0 && <span><strong>{run.elevGainFt}</strong> ft elev</span>}
              {run.maxHr && <span><strong>{run.maxHr}</strong> max HR</span>}
              {run.avgCadence && <span><strong>{Math.round(run.avgCadence)}</strong> cadence</span>}
              {run.shoe && <span>{run.shoe.brand} {run.shoe.model}</span>}
            </div>

            {/* Plan comparison block */}
            {plan && !plan.isRest && planComparison && (
              <div className="rd-section">
                <div className="rd-section-label">Planned workout</div>
                <div className="rd-plan-row">
                  <div className="rd-plan-name">{plan.label}</div>
                  <div className={`rd-plan-status ${planComparison.status.tone}`}>{planComparison.status.label}</div>
                </div>
                <div className="rd-plan-detail">
                  Plan: <strong>{plan.distanceMi} mi</strong> at <strong>{plan.paceTarget}</strong>
                </div>
                <div className="rd-plan-detail">
                  Ran:  <strong>{run.distanceMi.toFixed(1)} mi</strong> at <strong>{fmtPace(run.paceSPerMi)}/mi</strong>
                  {' · '}{planComparison.ranPct}% of planned distance
                </div>
              </div>
            )}

            {plan && plan.isRest && (
              <div className="rd-section">
                <div className="rd-section-label">Planned workout</div>
                <div className="rd-plan-detail">Today was a rest day. Bonus miles!</div>
              </div>
            )}

            {!plan && (
              <div className="rd-section">
                <div className="rd-section-label">Planned workout</div>
                <div className="rd-plan-detail" style={{ color: 'rgba(8,8,8,.55)' }}>
                  No planned workout for this date (off-plan run).
                </div>
              </div>
            )}

            {run.description && (
              <div className="rd-section">
                <div className="rd-section-label">Notes</div>
                <p className="rd-desc">{run.description}</p>
              </div>
            )}

            {/* Dedup provenance + unmerge controls. Renders when this row
                has merged sources (canonical with N folded-in dupes) OR was
                itself folded into another (this row is a merged source). */}
            {run.mergedSources && run.mergedSources.length > 0 && (
              <div className="rd-section">
                <div className="rd-section-label">Merged from {run.mergedSources.length} other {run.mergedSources.length === 1 ? 'row' : 'rows'}</div>
                <p className="rd-desc" style={{ fontSize: 12.5, color: 'rgba(8,8,8,.6)', marginBottom: 10 }}>
                  Auto-dedupe collapsed these matching-start rows into this one. Unmerge any to extract it back as its own line.
                </p>
                <ul className="rd-merged-list">
                  {run.mergedSources.map((src) => (
                    <li key={src.id} className="rd-merged-row">
                      <div className="rd-merged-meta">
                        <strong>{src.name}</strong>
                        <span>{src.distanceMi.toFixed(1)} mi · {fmtTime(src.movingTimeS)} · {src.source}</span>
                      </div>
                      <button
                        type="button"
                        className="rd-btn rd-btn-ghost rd-merged-btn"
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/runs/${src.id}/unmerge`, { method: 'POST' });
                            if (!res.ok) {
                              const j = await res.json().catch(() => ({}));
                              alert(`Unmerge failed: ${j?.error ?? res.statusText}`);
                              return;
                            }
                            if (typeof window !== 'undefined') window.location.reload();
                          } catch (e) {
                            alert(`Unmerge failed: ${e instanceof Error ? e.message : 'unknown'}`);
                          }
                        }}
                      >Unmerge</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {run.mergedIntoId != null && (
              <div className="rd-section">
                <div className="rd-section-label">This row was merged into another</div>
                <p className="rd-desc" style={{ fontSize: 12.5, color: 'rgba(8,8,8,.6)', marginBottom: 10 }}>
                  Auto-dedupe folded this row into a canonical session. Unmerge to extract it back as its own line on /log.
                </p>
                <button
                  type="button"
                  className="rd-btn rd-btn-ghost"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/runs/${runId}/unmerge`, { method: 'POST' });
                      if (!res.ok) {
                        const j = await res.json().catch(() => ({}));
                        alert(`Unmerge failed: ${j?.error ?? res.statusText}`);
                        return;
                      }
                      if (typeof window !== 'undefined') window.location.reload();
                    } catch (e) {
                      alert(`Unmerge failed: ${e instanceof Error ? e.message : 'unknown'}`);
                    }
                  }}
                >Unmerge this row</button>
              </div>
            )}

            <div className="rd-actions">
              <a href={`https://www.strava.com/activities/${run.id}`} target="_blank" rel="noreferrer" className="rd-btn rd-btn-ghost">View on Strava ↗</a>
              <button
                type="button"
                className="rd-btn rd-btn-danger"
                onClick={async () => {
                  if (!confirm('Delete this run? This is for mistake imports — you can’t undo it from the app.')) return;
                  try {
                    const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
                    if (!res.ok) {
                      const j = await res.json().catch(() => ({}));
                      alert(`Delete failed: ${j?.error ?? res.statusText}`);
                      return;
                    }
                    onClose();
                    // Reload so the recent-runs list refreshes without
                    // the deleted row sitting around stale.
                    if (typeof window !== 'undefined') window.location.reload();
                  } catch (e) {
                    alert(`Delete failed: ${e instanceof Error ? e.message : 'unknown'}`);
                  }
                }}
              >Delete run</button>
              <button type="button" className="rd-btn rd-btn-ghost" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        <style jsx>{`
          .rd-overlay {
            position: fixed; inset: 0;
            background: rgba(8,8,8,.55);
            display: flex; align-items: center; justify-content: center;
            z-index: 200;
            padding: 24px;
            overflow-y: auto;
          }
          .rd-card {
            background: #fff;
            border-radius: 18px;
            width: 100%;
            max-width: 600px;
            padding: 36px 40px 32px;
            position: relative;
            box-shadow: 0 30px 80px rgba(0,0,0,.25);
            max-height: 90vh;
            overflow-y: auto;
          }
          .rd-close {
            position: absolute; top: 14px; right: 16px;
            width: 32px; height: 32px;
            background: transparent; border: none; cursor: pointer;
            font-size: 28px; line-height: 1;
            color: rgba(8,8,8,.45);
          }
          .rd-close:hover { color: #080808; }
          .rd-error { color: #FC4D64; font-family: 'Inter', sans-serif; padding: 20px; text-align: center; }
          .rd-loading { padding: 40px; text-align: center; color: rgba(8,8,8,.55); font-family: 'Inter', sans-serif; font-size: 13px; }

          .rd-eyebrow {
            font-family: 'Inter', sans-serif;
            font-size: 12px; letter-spacing: 2.5px;
            color: rgba(8,8,8,.45);
            text-transform: uppercase;
            margin-bottom: 8px;
            display: flex; align-items: center; gap: 10px;
          }
          .rd-pill {
            font-family: 'Oswald', sans-serif; font-weight: 700;
            font-size: 9px; letter-spacing: 1.5px;
            padding: 2px 8px; border-radius: 4px;
            color: #fff;
          }
          .rd-pill.race    { background: #E85D26; }
          .rd-pill.long    { background: #3EBD41; }
          .rd-pill.workout { background: #C97000; }

          .rd-title {
            font-family: 'Bebas Neue', sans-serif;
            font-size: 44px; line-height: 0.95;
            letter-spacing: -1px; color: #080808;
            margin: 0 0 24px;
          }

          .rd-stats {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            margin-bottom: 14px;
          }
          .rd-stat {
            background: rgba(8,8,8,.03);
            border-radius: 10px;
            padding: 14px 12px 12px;
          }
          .rd-stat-val {
            font-family: 'Bebas Neue', sans-serif;
            font-size: 26px; line-height: 1;
            color: #080808;
            letter-spacing: -0.5px;
          }
          .rd-stat-val small {
            font-family: 'Inter', sans-serif;
            font-size: 11px; font-weight: 500;
            color: rgba(8,8,8,.55);
            margin-left: 3px;
          }
          .rd-stat-label {
            font-family: 'Inter', sans-serif;
            font-size: 10.5px; letter-spacing: 1.2px;
            color: rgba(8,8,8,.45);
            text-transform: uppercase;
            margin-top: 6px;
            font-weight: 600;
          }

          .rd-meta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 14px;
            font-family: 'Inter', sans-serif;
            font-size: 12.5px;
            color: rgba(8,8,8,.55);
            padding: 10px 4px 0;
            border-bottom: 1px solid rgba(8,8,8,.05);
            padding-bottom: 18px;
            margin-bottom: 22px;
          }
          .rd-meta-row strong { color: #080808; font-weight: 600; }

          .rd-section { margin-bottom: 22px; }
          .rd-section-label {
            font-family: 'Oswald', sans-serif;
            font-weight: 600; font-size: 10px;
            letter-spacing: 1.5px; color: rgba(8,8,8,.55);
            text-transform: uppercase; margin-bottom: 8px;
          }
          .rd-plan-row {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 6px;
          }
          .rd-plan-name {
            font-family: 'Oswald', sans-serif; font-weight: 700;
            font-size: 15px; letter-spacing: 0.5px; text-transform: uppercase;
            color: #080808;
          }
          .rd-plan-status {
            font-family: 'Oswald', sans-serif; font-weight: 700;
            font-size: 10px; letter-spacing: 1.5px;
            padding: 4px 10px; border-radius: 999px;
            text-transform: uppercase;
          }
          .rd-plan-status.green { background: rgba(62,189,65,.10); color: #3EBD41; }
          .rd-plan-status.amber { background: rgba(243,173,56,.10); color: #C97000; }
          .rd-plan-detail {
            font-family: 'Inter', sans-serif; font-size: 13.5px;
            color: rgba(8,8,8,.75); line-height: 1.5;
            margin-top: 4px;
          }
          .rd-plan-detail strong { color: #080808; font-weight: 600; }

          .rd-desc {
            font-family: 'Inter', sans-serif; font-size: 13px;
            color: rgba(8,8,8,.75); line-height: 1.55;
            margin: 0; white-space: pre-wrap;
          }

          .rd-actions {
            display: flex; justify-content: flex-end;
            gap: 8px; margin-top: 8px;
            padding-top: 18px;
            border-top: 1px solid rgba(8,8,8,.05);
          }
          .rd-btn {
            font-family: 'Oswald', sans-serif; font-weight: 600;
            font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
            padding: 10px 18px; border-radius: 8px; cursor: pointer;
            text-decoration: none;
            background: transparent; color: rgba(8,8,8,.55);
            border: 1px solid rgba(8,8,8,.16);
          }
          .rd-btn-ghost:hover { background: rgba(8,8,8,.04); color: #080808; }
          .rd-btn-danger {
            color: #FC4D64; border-color: rgba(252,77,100,.35);
          }
          .rd-btn-danger:hover { background: rgba(252,77,100,.08); }

          .rd-merged-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
          .rd-merged-row {
            display: flex; align-items: center; justify-content: space-between;
            gap: 12px; padding: 10px 12px;
            background: rgba(8,8,8,.03); border-radius: 8px;
          }
          .rd-merged-meta { display: flex; flex-direction: column; gap: 2px; font-family: 'Inter', sans-serif; font-size: 12.5px; color: rgba(8,8,8,.85); }
          .rd-merged-meta span { font-size: 11px; color: rgba(8,8,8,.55); }
          .rd-merged-btn { padding: 6px 12px; font-size: 10px; letter-spacing: 1.3px; }

          @media (max-width: 600px) {
            .rd-stats { grid-template-columns: 1fr 1fr; }
          }
        `}</style>
      </div>
    </div>
  );
}
