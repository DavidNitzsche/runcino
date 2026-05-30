'use client';

import { useEffect, useState, useMemo } from 'react';
import { ZC } from '../constants';
import { decodePolyline, polylineToSvgPath, polylineEndpoints, elevPathFromSplits } from '@/lib/route/polyline';

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
  power_avg_w: number | null;
  splits: Array<{ mile: number; pace: string | null; hr: number | null; elev_change_ft: number | null }>;
  hrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number };
  has_route: boolean;
  route_polyline: string | null;
  shoes?: Array<{ id: number; brand: string; model: string }>;
  shoe_id?: number | null;
};

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function RunDetailModal({ open, runId, onClose }: { open: boolean; runId: string | null; onClose: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<RunDetail | null>(null);

  useEffect(() => {
    if (!open || !runId) return;
    let cancelled = false;
    setStatus('loading'); setData(null);
    fetch(`/api/runs/${encodeURIComponent(runId)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: RunDetail) => { if (!cancelled) { setData(j); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
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
              {data.splits?.length > 0 && (() => {
                const maxFill = Math.max(...data.splits.map(s => paceToSec(s.pace ?? '') || 0));
                const minFill = Math.min(...data.splits.filter(s => paceToSec(s.pace ?? '') > 0).map(s => paceToSec(s.pace!) || 0));
                const span = Math.max(1, maxFill - minFill);
                return (
                  <>
                    <div className="fll" style={{ marginTop: 8 }}>MILE SPLITS</div>
                    <div className="splits">
                      {data.splits.map((s, i) => {
                        const sec = paceToSec(s.pace ?? '');
                        const fillPct = sec > 0 ? Math.round(40 + (1 - (sec - minFill) / span) * 55) : 30;
                        return (
                          <div className="spr" key={i}>
                            <span className="spm">{s.mile}</span>
                            <div className="sptrk"><div className="spf" style={{ width: `${fillPct}%`, background: ZC[Math.min(4, Math.max(0, Math.round((sec - minFill) / span * 4)))] }} /></div>
                            <span className="spp">{s.pace ?? '·'}<small>/mi</small></span>
                          </div>
                        );
                      })}
                    </div>
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
                <div className="i"><div className="k">WEATHER</div><div className="v">{data.temp_f != null ? `${Math.round(data.temp_f)}°F` : '·'}</div></div>
                <div className="i"><div className="k">CADENCE</div><div className="v">{data.cadence_avg ? `${Math.round(data.cadence_avg)} spm` : '·'}</div></div>
                <div className="i"><div className="k">MAX HR</div><div className="v">{data.hr_max ? `${data.hr_max} bpm` : '·'}</div></div>
                {data.power_avg_w != null && (
                  <div className="i"><div className="k">AVG POWER</div><div className="v">{data.power_avg_w}<small> W</small></div></div>
                )}
                <div className="i"><div className="k">SHOE</div><div className="v">{currentShoeName(data) || '·'}</div></div>
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
function formatHeroDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d).toUpperCase();
}
function paceToSec(p: string): number {
  if (!p) return 0;
  const parts = p.split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
