'use client';
/**
 * CoursePreview — full GPX analysis surface used by the race form
 * (after upload, as a verification view) and the race detail page
 * (replacing the legacy SVG map + SVG elevation profile).
 *
 * Renders, top to bottom:
 *   • narrative one-liner
 *   • 12-card stats grid (distance, gain/loss, min/max ele, steepest,
 *     start→end gap, OAB match, farthest from start, bbox, center)
 *   • Leaflet map — polyline tinted by per-segment grade, S/F/T pins,
 *     dashed bbox rectangle, dark Carto basemap
 *   • Chart.js elevation profile — hover sync to a marker on the map
 *   • per-mile + per-km split tables (signed Δ ele, color coded)
 *   • gradient histogram + heading rose
 *   • crow-fly-from-start chart + segment-spacing histogram
 *   • course insights panel
 *
 * Pass either `gpxText` (parsed in-component) or a pre-computed
 * `analysis` (already analyzed). `compact` collapses the verbose
 * histograms/rose for tighter form layout.
 */
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, RadialLinearScale,
  PointElement, LineElement, BarElement, ArcElement,
  Tooltip, Filler,
} from 'chart.js';
import { Line, Bar, PolarArea } from 'react-chartjs-2';
import { analyzeGpx, GRADE_COLORS, gradeColor, type CourseAnalysis } from '../lib/gpx-analysis';

ChartJS.register(
  CategoryScale, LinearScale, RadialLinearScale,
  PointElement, LineElement, BarElement, ArcElement,
  Tooltip, Filler,
);
ChartJS.defaults.color = 'rgba(245,244,238,0.7)';
ChartJS.defaults.borderColor = 'rgba(245,244,238,0.08)';
ChartJS.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
ChartJS.defaults.font.size = 11;

// ── unit helpers ─────────────────────────────────────────────────
const FT_PER_M = 3.28084;
const M_PER_MI = 1609.344;
const ft = (m: number) => m * FT_PER_M;
const mi = (m: number) => m / M_PER_MI;
const km = (m: number) => m / 1000;
const fmt = (n: number, d = 1) =>
  n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtInt = (n: number) => Math.round(n).toLocaleString();

// ── visual tokens (dark theme) ───────────────────────────────────
const SURFACE = 'var(--color-l1)';
const SURFACE_2 = 'var(--color-l2)';
const BORDER = 'var(--color-l4)';
const TEXT = 'var(--color-t0)';
const TEXT_2 = 'var(--color-t2)';
const TEXT_3 = 'var(--color-t3)';
const ACCENT = 'var(--color-race)';

export interface CoursePreviewProps {
  gpxText?: string;
  analysis?: CourseAnalysis;
  /** When true, hide the rose/histograms/spacing charts (useful for
   *  the form's narrower review column). Map + elevation + stats +
   *  splits + insights still render. */
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function CoursePreview({
  gpxText, analysis: providedAnalysis, compact = false, className, style,
}: CoursePreviewProps) {
  const analysis = useMemo<CourseAnalysis | null>(() => {
    if (providedAnalysis) return providedAnalysis;
    if (!gpxText) return null;
    try { return analyzeGpx(gpxText); } catch { return null; }
  }, [gpxText, providedAnalysis]);

  if (!analysis) {
    return (
      <div className={className} style={{ ...style, padding: 24, color: TEXT_3, fontSize: 13 }}>
        Upload a GPX file to see the course preview.
      </div>
    );
  }

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 18, ...style }}>
      <Narrative analysis={analysis} />
      <StatsGrid analysis={analysis} />
      <MapAndElevation analysis={analysis} />
      <SplitsTables analysis={analysis} />
      {!compact && <ChartsRow analysis={analysis} />}
      {!compact && <SpacingAndDistance analysis={analysis} />}
      <Insights analysis={analysis} />
    </div>
  );
}

// ── Narrative ────────────────────────────────────────────────────
function Narrative({ analysis }: { analysis: CourseAnalysis }) {
  const { stats } = analysis;
  const oab =
    stats.oabScorePct > 75 ? 'true out-and-back' :
    stats.startToEndM < 100 ? 'closed loop' : 'point-to-point';
  const flatness =
    stats.meanGradePct < 1.5 ? 'mostly flat' :
    stats.meanGradePct < 4   ? 'rolling'      : 'hilly';
  return (
    <div style={{
      background: SURFACE, border: `1px solid ${BORDER}`,
      borderRadius: 12, padding: '14px 18px', color: TEXT,
      fontSize: 13.5, lineHeight: 1.55,
    }}>
      <strong>{mi(stats.totalDistM).toFixed(2)} mi</strong>
      {' '}<span style={{ color: TEXT_2 }}>({km(stats.totalDistM).toFixed(2)} km)</span>
      {' '}<strong>{oab}</strong> course, {flatness}
      {' '}<span style={{ color: TEXT_2 }}>(mean |grade| {stats.meanGradePct.toFixed(1)}%)</span>.
      {' '}Elevation <strong>{ft(stats.minEleM).toFixed(0)}–{ft(stats.maxEleM).toFixed(0)} ft</strong>,
      gain <strong>{fmtInt(stats.gainFt)} ft</strong>
      {' '}/ loss <strong>{fmtInt(stats.lossFt)} ft</strong>.
      {' '}<span style={{ color: TEXT_3, fontSize: 12 }}>
        {stats.numPoints} trackpoints · {fmt(ft(stats.totalDistM / stats.numPoints), 0)} ft avg spacing
      </span>
    </div>
  );
}

// ── Stats grid ───────────────────────────────────────────────────
function StatsGrid({ analysis }: { analysis: CourseAnalysis }) {
  const { stats, cumDistM } = analysis;
  const items: Array<[string, string, string]> = [
    ['Distance', `${mi(stats.totalDistM).toFixed(2)} mi`, `${km(stats.totalDistM).toFixed(2)} km`],
    ['Elev. gain',  `${fmtInt(stats.gainFt)} ft`, `${fmtInt(stats.gainFt / FT_PER_M)} m · 2 m threshold`],
    ['Elev. loss',  `${fmtInt(stats.lossFt)} ft`, `${fmtInt(stats.lossFt / FT_PER_M)} m · 2 m threshold`],
    ['Min elevation', `${ft(stats.minEleM).toFixed(1)} ft`, `${stats.minEleM.toFixed(2)} m · pt #${stats.minEleIdx + 1}`],
    ['Max elevation', `${ft(stats.maxEleM).toFixed(1)} ft`, `${stats.maxEleM.toFixed(2)} m · pt #${stats.maxEleIdx + 1}`],
    ['Steepest ascent',  `+${stats.maxUpGradePct.toFixed(1)}%`,  `at ${mi(cumDistM[stats.maxUpIdx + 1] ?? cumDistM[stats.maxUpIdx]).toFixed(2)} mi`],
    ['Steepest descent', `${stats.maxDownGradePct.toFixed(1)}%`, `at ${mi(cumDistM[stats.maxDownIdx + 1] ?? cumDistM[stats.maxDownIdx]).toFixed(2)} mi`],
    ['Start → end gap',  `${fmt(ft(stats.startToEndM), 1)} ft`, stats.startToEndM < 50 ? 'closed loop' : 'open route'],
    ['Out-and-back match', `${fmt(stats.oabScorePct, 0)}%`, 'return pts within 33 ft'],
    ['Farthest from start', `${mi(stats.maxFromStartM).toFixed(2)} mi`, `pt #${stats.turnIdx + 1}`],
    ['Bounding box', `${mi(stats.bboxWidthM).toFixed(2)} × ${mi(stats.bboxHeightM).toFixed(2)} mi`,
      `${fmt(stats.bbox.maxLat - stats.bbox.minLat, 4)}° × ${fmt(stats.bbox.maxLon - stats.bbox.minLon, 4)}°`],
    ['Center', `${stats.center[0].toFixed(4)}, ${stats.center[1].toFixed(4)}`, `${stats.numPoints} pts`],
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10,
    }}>
      {items.map(([label, value, sub]) => (
        <div key={label} style={{
          background: SURFACE, border: `1px solid ${BORDER}`,
          borderRadius: 10, padding: '12px 14px',
        }}>
          <div style={{
            fontSize: 10.5, color: TEXT_3,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            fontWeight: 500, fontFamily: 'var(--font-data)',
          }}>{label}</div>
          <div style={{
            fontSize: 20, fontWeight: 600, marginTop: 3, color: TEXT,
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
          }}>{value}</div>
          <div style={{ fontSize: 11.5, color: TEXT_3, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Map + Elevation (hover synced) ───────────────────────────────
function MapAndElevation({ analysis }: { analysis: CourseAnalysis }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <RouteMap analysis={analysis} hoverIdx={hoverIdx} />
      <ElevationProfile analysis={analysis} onHoverIdx={setHoverIdx} />
    </div>
  );
}

function RouteMap({ analysis, hoverIdx }: { analysis: CourseAnalysis; hoverIdx: number | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep the Leaflet map + hover marker as plain refs (not state) so
  // their lifecycle stays out of React's reconciliation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hoverRef = useRef<any>(null);

  // Build the map once per analysis. Recreate (cleanup + rebuild) when
  // the underlying GPX changes.
  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;

      // Fix Leaflet's broken default marker icon paths (no markers
      // currently use the default, but future additions will).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(containerRef.current, {
        scrollWheelZoom: true,
        preferCanvas: true,
      });
      mapRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OSM · © CARTO',
        subdomains: 'abcd', maxZoom: 20,
      }).addTo(map);

      const { trkpts, gradesPct, stats } = analysis;
      for (let i = 1; i < trkpts.length; i++) {
        const a = trkpts[i - 1], b = trkpts[i];
        L.polyline([[a[0], a[1]], [b[0], b[1]]], {
          color: gradeColor(gradesPct[i - 1]),
          weight: 4, opacity: 0.95,
        }).addTo(map);
      }

      const pin = (bg: string, letter: string) => L.divIcon({
        html: `<div style="background:${bg};color:#fff;border:2px solid #fff;border-radius:50%;width:22px;height:22px;text-align:center;font-size:11px;line-height:18px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.45)">${letter}</div>`,
        className: '', iconSize: [22, 22], iconAnchor: [11, 11],
      });
      L.marker([trkpts[0][0], trkpts[0][1]], { icon: pin('#16a34a', 'S') }).addTo(map)
        .bindPopup(`<strong>Start</strong><br>${trkpts[0][0].toFixed(5)}, ${trkpts[0][1].toFixed(5)}<br>Ele: ${ft(trkpts[0][2]).toFixed(1)} ft`);
      const last = trkpts[trkpts.length - 1];
      L.marker([last[0], last[1]], { icon: pin('#dc2626', 'F') }).addTo(map)
        .bindPopup(`<strong>Finish</strong><br>${last[0].toFixed(5)}, ${last[1].toFixed(5)}<br>Ele: ${ft(last[2]).toFixed(1)} ft`);
      if (stats.oabScorePct > 75) {
        const tp = trkpts[stats.turnIdx];
        L.marker([tp[0], tp[1]], { icon: pin('#a16207', 'T') }).addTo(map)
          .bindPopup(`<strong>Turnaround</strong><br>${mi(stats.maxFromStartM).toFixed(2)} mi from start`);
      }

      L.rectangle(
        [[stats.bbox.minLat, stats.bbox.minLon], [stats.bbox.maxLat, stats.bbox.maxLon]],
        { color: 'rgba(245,244,238,0.4)', weight: 1, fill: false, dashArray: '4,4', opacity: 0.5 },
      ).addTo(map);

      map.fitBounds(
        [[stats.bbox.minLat, stats.bbox.minLon], [stats.bbox.maxLat, stats.bbox.maxLon]],
        { padding: [24, 24] },
      );
    })();

    return () => {
      cancelled = true;
      if (hoverRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(hoverRef.current); } catch { /* noop */ }
      }
      hoverRef.current = null;
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch { /* noop */ }
        mapRef.current = null;
      }
    };
  }, [analysis]);

  // Drive the hover marker from props.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mapRef.current) return;
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      if (hoverRef.current) {
        mapRef.current.removeLayer(hoverRef.current);
        hoverRef.current = null;
      }
      if (hoverIdx == null) return;
      const p = analysis.trkpts[hoverIdx];
      if (!p) return;
      hoverRef.current = L.circleMarker([p[0], p[1]], {
        radius: 8, color: '#fff', weight: 2,
        fillColor: '#FF5722', fillOpacity: 1,
      }).addTo(mapRef.current);
    })();
    return () => { cancelled = true; };
  }, [hoverIdx, analysis]);

  return (
    <div>
      <div
        ref={containerRef}
        style={{
          height: 480,
          borderRadius: 12,
          border: `1px solid ${BORDER}`,
          overflow: 'hidden',
          background: '#0f1117',
        }}
      />
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10,
        fontSize: 11, color: TEXT_2, fontFamily: 'var(--font-data)',
        letterSpacing: '0.04em',
      }}>
        <strong style={{ color: TEXT_3, marginRight: 4 }}>GRADE</strong>
        {GRADE_COLORS.map(({ color, label }) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, background: color, borderRadius: 2 }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ElevationProfile({
  analysis,
  onHoverIdx,
}: {
  analysis: CourseAnalysis;
  onHoverIdx: (i: number | null) => void;
}) {
  const { trkpts, cumDistM } = analysis;
  const labels = useMemo(() => cumDistM.map(d => +mi(d).toFixed(4)), [cumDistM]);
  const values = useMemo(() => trkpts.map(p => +ft(p[2]).toFixed(2)), [trkpts]);

  return (
    <div style={{
      background: SURFACE, border: `1px solid ${BORDER}`,
      borderRadius: 12, padding: 14, height: 280,
    }}>
      <Line
        data={{
          labels,
          datasets: [{
            label: 'Elevation (ft)',
            data: values,
            borderColor: '#22d3ee',
            backgroundColor: 'rgba(34,211,238,0.18)',
            fill: true, tension: 0.25,
            pointRadius: 0, pointHoverRadius: 5, borderWidth: 2,
          }],
        }}
        options={{
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          onHover: (_e, elements) => {
            if (elements.length > 0) onHoverIdx(elements[0].index);
            else onHoverIdx(null);
          },
          plugins: {
            tooltip: {
              backgroundColor: 'rgba(11,15,23,0.95)',
              borderColor: 'rgba(245,244,238,0.15)',
              borderWidth: 1,
              callbacks: {
                title: items => `${Number(items[0].label).toFixed(2)} mi`,
                label: item => `Elevation: ${(item.parsed.y as number).toFixed(1)} ft (${((item.parsed.y as number) / FT_PER_M).toFixed(1)} m)`,
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: 'Distance (mi)' },
              grid: { color: 'rgba(245,244,238,0.06)' },
            },
            y: {
              title: { display: true, text: 'Elevation (ft)' },
              grid: { color: 'rgba(245,244,238,0.06)' },
              beginAtZero: false,
            },
          },
        }}
      />
    </div>
  );
}

// ── Splits ───────────────────────────────────────────────────────
function SplitsTables({ analysis }: { analysis: CourseAnalysis }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
      <SplitTable title="Per-mile splits" unit="mi" splits={analysis.mileSplits.map(s => ({
        idx: s.idx, startEle: ft(s.startEleM), endEle: ft(s.endEleM), delta: ft(s.deltaEleM),
      }))} />
      <SplitTable title="Per-km splits" unit="km" splits={analysis.kmSplits.map(s => ({
        idx: s.idx, startEle: ft(s.startEleM), endEle: ft(s.endEleM), delta: ft(s.deltaEleM),
      }))} />
    </div>
  );
}

function SplitTable({
  title, unit, splits,
}: {
  title: string; unit: string;
  splits: Array<{ idx: number; startEle: number; endEle: number; delta: number }>;
}) {
  return (
    <div>
      <div style={{
        fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 8,
      }}>{title}</div>
      <div style={{
        background: SURFACE, border: `1px solid ${BORDER}`,
        borderRadius: 10, maxHeight: 320, overflowY: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={thStyle(true)}>{unit}</th>
              <th style={thStyle()}>Start (ft)</th>
              <th style={thStyle()}>End (ft)</th>
              <th style={thStyle()}>Δ (ft)</th>
            </tr>
          </thead>
          <tbody>
            {splits.map(s => {
              const cls = s.delta > 1 ? '#F3AD3B' : s.delta < -1 ? '#4F8FF7' : TEXT_3;
              const sign = s.delta > 0 ? '+' : '';
              return (
                <tr key={s.idx}>
                  <td style={tdStyle(true)}>{s.idx}</td>
                  <td style={tdStyle()}>{s.startEle.toFixed(1)}</td>
                  <td style={tdStyle()}>{s.endEle.toFixed(1)}</td>
                  <td style={{ ...tdStyle(), color: cls, fontWeight: 500 }}>{sign}{s.delta.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = (first = false): React.CSSProperties => ({
  background: SURFACE_2, position: 'sticky', top: 0,
  fontWeight: 500, color: TEXT_3, fontSize: 10.5,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  padding: '8px 12px', textAlign: first ? 'left' : 'right',
  borderBottom: `1px solid ${BORDER}`,
});
const tdStyle = (first = false): React.CSSProperties => ({
  padding: '7px 12px', textAlign: first ? 'left' : 'right',
  borderBottom: `1px solid ${BORDER}`, color: TEXT,
});

// ── Charts row (gradient histogram + heading rose) ───────────────
function ChartsRow({ analysis }: { analysis: CourseAnalysis }) {
  const { gradesPct, bearingsDeg } = analysis;
  const gradeBins = ['< -8', '-8 to -5', '-5 to -3', '-3 to -1', 'flat ±1', '1 to 3', '3 to 5', '5 to 8', '> 8'];
  const gradeBinColors = ['#1e3a8a', '#2563eb', '#3b82f6', '#60a5fa', '#10b981', '#84cc16', '#eab308', '#f97316', '#dc2626'];
  const gradeCounts = useMemo(() => {
    const counts = new Array(gradeBins.length).fill(0);
    for (const g of gradesPct) {
      let bin: number;
      if (g < -8) bin = 0;
      else if (g < -5) bin = 1;
      else if (g < -3) bin = 2;
      else if (g < -1) bin = 3;
      else if (g < 1)  bin = 4;
      else if (g < 3)  bin = 5;
      else if (g < 5)  bin = 6;
      else if (g < 8)  bin = 7;
      else             bin = 8;
      counts[bin]++;
    }
    return counts;
  }, [gradesPct]);

  const dirLabels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const dirCounts = useMemo(() => {
    const counts = new Array(16).fill(0);
    for (const b of bearingsDeg) {
      const i = Math.floor(((b + 11.25) % 360) / 22.5);
      counts[i] += 1;
    }
    return counts;
  }, [bearingsDeg]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
      <ChartCard title="Gradient distribution" height={280}>
        <Bar
          data={{
            labels: gradeBins,
            datasets: [{ data: gradeCounts, backgroundColor: gradeBinColors, borderRadius: 4 }],
          }}
          options={{
            responsive: true, maintainAspectRatio: false,
            plugins: { tooltip: { callbacks: { label: c => `${c.parsed.y} segments` } } },
            scales: {
              x: { title: { display: true, text: 'Grade %' }, grid: { color: 'rgba(245,244,238,0.04)' } },
              y: { title: { display: true, text: 'Segments' }, beginAtZero: true, grid: { color: 'rgba(245,244,238,0.06)' } },
            },
          }}
        />
      </ChartCard>
      <ChartCard title="Heading rose" height={280}>
        <PolarArea
          data={{
            labels: dirLabels,
            datasets: [{
              data: dirCounts,
              backgroundColor: dirLabels.map((_, i) => `hsla(${i * 22},70%,55%,0.55)`),
              borderColor: 'rgba(245,244,238,0.1)',
              borderWidth: 1,
            }],
          }}
          options={{
            responsive: true, maintainAspectRatio: false,
            plugins: { tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed} segments` } } },
            scales: {
              r: {
                ticks: { display: false, color: 'rgba(245,244,238,0.5)' },
                grid: { color: 'rgba(245,244,238,0.08)' },
                angleLines: { color: 'rgba(245,244,238,0.08)' },
              },
            },
          }}
        />
      </ChartCard>
    </div>
  );
}

function SpacingAndDistance({ analysis }: { analysis: CourseAnalysis }) {
  const { trkpts, cumDistM, segDistsM } = analysis;
  const distFromStart = useMemo(() => {
    const a = trkpts[0];
    const lat0 = (a[0] * Math.PI) / 180;
    return trkpts.map(p => {
      const lat1 = (p[0] * Math.PI) / 180;
      const dLat = lat1 - lat0;
      const dLon = ((p[1] - a[1]) * Math.PI) / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat0) * Math.cos(lat1) * Math.sin(dLon / 2) ** 2;
      return mi(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
    });
  }, [trkpts]);

  const labels = useMemo(() => cumDistM.map(d => +mi(d).toFixed(4)), [cumDistM]);
  const spacingEdgesFt = [0, 25, 50, 100, 200, 400, 800, 1600, Infinity];
  const spacingLabels  = ['0–25', '25–50', '50–100', '100–200', '200–400', '400–800', '800–1600', '1600+'];
  const spacingCounts = useMemo(() => {
    const counts = new Array(spacingLabels.length).fill(0);
    for (const d of segDistsM) {
      const dFt = ft(d);
      for (let i = 1; i < spacingEdgesFt.length; i++) {
        if (dFt < spacingEdgesFt[i]) { counts[i - 1]++; break; }
      }
    }
    return counts;
  }, [segDistsM]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
      <ChartCard title="Crow-fly distance from start" height={260}>
        <Line
          data={{
            labels,
            datasets: [{
              data: distFromStart,
              borderColor: '#a78bfa',
              backgroundColor: 'rgba(167,139,250,0.18)',
              fill: true, pointRadius: 0, borderWidth: 2, tension: 0.2,
            }],
          }}
          options={{
            responsive: true, maintainAspectRatio: false,
            plugins: {
              tooltip: {
                callbacks: {
                  title: items => `${Number(items[0].label).toFixed(2)} mi traveled`,
                  label: item => `Crow-fly: ${(item.parsed.y as number).toFixed(2)} mi from start`,
                },
              },
            },
            scales: {
              x: { type: 'linear', title: { display: true, text: 'Distance traveled (mi)' }, grid: { color: 'rgba(245,244,238,0.04)' } },
              y: { title: { display: true, text: 'From start (mi)' }, beginAtZero: true, grid: { color: 'rgba(245,244,238,0.06)' } },
            },
          }}
        />
      </ChartCard>
      <ChartCard title="Trackpoint spacing" height={260}>
        <Bar
          data={{
            labels: spacingLabels,
            datasets: [{ data: spacingCounts, backgroundColor: '#0e7490', borderRadius: 4 }],
          }}
          options={{
            responsive: true, maintainAspectRatio: false,
            scales: {
              x: { title: { display: true, text: 'Segment length (ft)' }, grid: { color: 'rgba(245,244,238,0.04)' } },
              y: { title: { display: true, text: 'Count' }, beginAtZero: true, grid: { color: 'rgba(245,244,238,0.06)' } },
            },
          }}
        />
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, height, children }: { title: string; height: number; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 8 }}>{title}</div>
      <div style={{
        background: SURFACE, border: `1px solid ${BORDER}`,
        borderRadius: 12, padding: 12, height,
      }}>
        {children}
      </div>
    </div>
  );
}

// ── Insights panel ────────────────────────────────────────────────
function Insights({ analysis }: { analysis: CourseAnalysis }) {
  const { stats, cumDistM } = analysis;
  const oab =
    stats.oabScorePct > 75 ? 'True out-and-back' :
    stats.startToEndM < 100 ? 'Closed loop' : 'Point-to-point';
  const ascentEvery = stats.gainFt > 0 ? ft(stats.totalDistM) / stats.gainFt : 0;

  const lines: Array<[string, string]> = [
    ['Course shape', `${oab}${stats.oabScorePct > 75 ? ` (${stats.oabScorePct.toFixed(0)}% return overlap)` : ''}`],
    ['Total ascent over distance', stats.gainFt > 0 ? `1 ft gain per ${ascentEvery.toFixed(0)} ft run` : 'flat course'],
    ['Avg pace of elev. change', `${stats.meanGradePct.toFixed(2)}% mean absolute grade`],
    ['Highest point along route', `pt #${stats.maxEleIdx + 1} · ${mi(cumDistM[stats.maxEleIdx]).toFixed(2)} mi · ${ft(stats.maxEleM).toFixed(1)} ft`],
    ['Lowest point along route',  `pt #${stats.minEleIdx + 1} · ${mi(cumDistM[stats.minEleIdx]).toFixed(2)} mi · ${ft(stats.minEleM).toFixed(1)} ft`],
    ['Sea-level proximity', stats.minEleM < 5 ? 'Yes — minimum within 16 ft of sea level (coastal)' : 'No'],
    ['GPX timestamps', 'None — Strava route export, no time/HR/cadence'],
  ];

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 8 }}>Course insights</div>
      <div style={{
        background: SURFACE, border: `1px solid ${BORDER}`,
        borderRadius: 12, padding: '4px 18px',
      }}>
        {lines.map(([lbl, val]) => (
          <div key={lbl} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            padding: '10px 0', borderBottom: `1px solid ${BORDER}`,
            fontSize: 13.5, gap: 16,
          }}>
            <span style={{ color: TEXT_2 }}>{lbl}</span>
            <span style={{ fontWeight: 500, color: TEXT, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
