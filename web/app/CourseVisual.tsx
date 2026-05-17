'use client';

import { useEffect, useMemo, useRef } from 'react';

interface GpxPoint {
  lat: number;
  lon: number;
  eleM: number;
  distMi: number;
}

interface PhaseInfo {
  startMi: number;
  endMi: number;
  label: string;
  grade: number;
}

interface CourseVisualProps {
  gpxText: string;
  phases?: PhaseInfo[];
}

const R_MI = 3958.8;

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGpxPoints(xml: string): GpxPoint[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const nodes = Array.from(doc.querySelectorAll('trkpt'));
  const pts: GpxPoint[] = [];
  let distMi = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const lat = parseFloat(n.getAttribute('lat') ?? '0');
    const lon = parseFloat(n.getAttribute('lon') ?? '0');
    const eleEl = n.querySelector('ele');
    const eleM = eleEl ? parseFloat(eleEl.textContent ?? '0') : 0;
    if (i > 0) {
      const p = pts[i - 1];
      distMi += haversineMi(p.lat, p.lon, lat, lon);
    }
    pts.push({ lat, lon, eleM, distMi });
  }
  return pts;
}

function downsample(pts: GpxPoint[], n: number): GpxPoint[] {
  if (pts.length <= n) return pts;
  const result: GpxPoint[] = [];
  const step = (pts.length - 1) / (n - 1);
  for (let i = 0; i < n - 1; i++) result.push(pts[Math.round(i * step)]);
  result.push(pts[pts.length - 1]);
  return result;
}

function gradeColor(grade: number): string {
  if (grade > 6) return '#c0392b';
  if (grade > 3) return '#e67e22';
  if (grade > 0) return '#f0c040';
  if (grade > -3) return '#4caf7d';
  if (grade > -6) return '#5b9bd5';
  return '#2471a3';
}

export function CourseVisual({ gpxText, phases }: CourseVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const points = useMemo(() => {
    try {
      return downsample(parseGpxPoints(gpxText), 600);
    } catch {
      return [];
    }
  }, [gpxText]);

  const totalMi = points.length > 0 ? points[points.length - 1].distMi : 0;
  const elevsFt = points.map(p => p.eleM * 3.28084);
  const minEleFt = Math.min(...elevsFt);
  const maxEleFt = Math.max(...elevsFt);
  const elePad = Math.max((maxEleFt - minEleFt) * 0.12, 30);

  // SVG dimensions
  const W = 800, H = 160;
  const PAD = { top: 14, right: 12, bottom: 28, left: 44 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const eleBot = minEleFt - elePad;
  const eleTop = maxEleFt + elePad;

  function xOf(mi: number) {
    return PAD.left + (mi / (totalMi || 1)) * chartW;
  }
  function yOf(eleFt: number) {
    return PAD.top + chartH - ((eleFt - eleBot) / (eleTop - eleBot)) * chartH;
  }

  const pathD = points.length === 0 ? '' : points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.distMi).toFixed(1)},${yOf(p.eleM * 3.28084).toFixed(1)}`)
    .join(' ');

  const fillD = pathD
    ? `${pathD} L${xOf(totalMi).toFixed(1)},${(PAD.top + chartH).toFixed(1)} L${xOf(0).toFixed(1)},${(PAD.top + chartH).toFixed(1)} Z`
    : '';

  const mileMarkers: number[] = [];
  for (let m = 5; m < totalMi; m += 5) mileMarkers.push(m);

  // Route map canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cW = canvas.width;
    const cH = canvas.height;
    ctx.clearRect(0, 0, cW, cH);

    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const latRange = maxLat - minLat || 0.01;
    const lonRange = maxLon - minLon || 0.01;
    const pad = 24;

    const scaleX = (cW - pad * 2) / lonRange;
    const scaleY = (cH - pad * 2) / latRange;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = pad + (cW - pad * 2 - lonRange * scale) / 2;
    const offsetY = pad + (cH - pad * 2 - latRange * scale) / 2;

    function toCanvas(lat: number, lon: number): [number, number] {
      return [
        offsetX + (lon - minLon) * scale,
        offsetY + (maxLat - lat) * scale,
      ];
    }

    // Draw grade-colored segments
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const distM = haversineMi(prev.lat, prev.lon, cur.lat, cur.lon) * 1609.34;
      const eleChangeM = cur.eleM - prev.eleM;
      const grade = distM > 1 ? (eleChangeM / distM) * 100 : 0;

      ctx.strokeStyle = gradeColor(grade);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(...toCanvas(prev.lat, prev.lon));
      ctx.lineTo(...toCanvas(cur.lat, cur.lon));
      ctx.stroke();
    }

    // Start dot
    const [sx, sy] = toCanvas(points[0].lat, points[0].lon);
    ctx.fillStyle = '#4caf7d';
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Finish dot
    const last = points[points.length - 1];
    const [fx, fy] = toCanvas(last.lat, last.lon);
    ctx.fillStyle = '#a83b2b';
    ctx.beginPath();
    ctx.arc(fx, fy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [points]);

  if (points.length === 0) return null;

  return (
    <div className="faff-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--color-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="eyebrow">Course visual</div>
        <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
          {totalMi.toFixed(1)} mi · {Math.round(minEleFt)}–{Math.round(maxEleFt)} ft
        </div>
      </div>

      {/* Elevation profile */}
      <div style={{ borderBottom: '1px solid var(--color-line)' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
          {/* Phase background strips */}
          {phases?.map((ph, i) => (
            <rect
              key={i}
              x={xOf(ph.startMi)}
              y={PAD.top}
              width={Math.max(0, xOf(ph.endMi) - xOf(ph.startMi))}
              height={chartH}
              fill={ph.grade > 2 ? 'rgba(168,59,43,0.07)' : ph.grade < -2 ? 'rgba(91,155,213,0.07)' : 'transparent'}
            />
          ))}

          {/* Elevation fill + stroke */}
          <path d={fillD} fill="rgba(168,59,43,0.12)" />
          <path d={pathD} fill="none" stroke="var(--color-terracotta)" strokeWidth={1.5} />

          {/* Phase labels */}
          {phases?.map((ph, i) => {
            const cx = xOf((ph.startMi + ph.endMi) / 2);
            if (cx < PAD.left + 20 || cx > W - PAD.right - 20) return null;
            return (
              <text key={i} x={cx} y={PAD.top + 10} textAnchor="middle" fontSize={9} fill="var(--color-ink-4)" fontFamily="inherit">
                {ph.label}
              </text>
            );
          })}

          {/* Mile markers */}
          {mileMarkers.map(m => (
            <g key={m}>
              <line x1={xOf(m)} y1={PAD.top} x2={xOf(m)} y2={PAD.top + chartH} stroke="var(--color-line)" strokeWidth={1} />
              <text x={xOf(m)} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--color-ink-4)" fontFamily="inherit">
                {m}
              </text>
            </g>
          ))}

          {/* Elevation y-axis */}
          <text x={PAD.left - 6} y={PAD.top + 6} textAnchor="end" fontSize={9} fill="var(--color-ink-4)" fontFamily="inherit">
            {Math.round(maxEleFt)}ft
          </text>
          <text x={PAD.left - 6} y={PAD.top + chartH} textAnchor="end" fontSize={9} fill="var(--color-ink-4)" fontFamily="inherit">
            {Math.round(minEleFt)}ft
          </text>
        </svg>
      </div>

      {/* Route map */}
      <div style={{ position: 'relative', background: 'var(--color-paper-2)' }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={220}
          style={{ width: '100%', display: 'block' }}
        />
        <div style={{ position: 'absolute', bottom: 10, right: 14, display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-ink-3)', background: 'rgba(248,246,241,0.85)', padding: '4px 8px', borderRadius: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 3, background: '#c0392b', display: 'inline-block', borderRadius: 2 }} /> climb
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 3, background: '#4caf7d', display: 'inline-block', borderRadius: 2 }} /> flat
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 3, background: '#5b9bd5', display: 'inline-block', borderRadius: 2 }} /> descent
          </span>
        </div>
      </div>
    </div>
  );
}
