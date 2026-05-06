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
import { analyzeGpx, GRADE_COLORS, gradeColor, gradeColorContinuous, type CourseAnalysis } from '../lib/gpx-analysis';

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

// ── phase tinting ────────────────────────────────────────────────
// When the detail-page hero passes its plan phases + the canonical
// PHASE_COLORS palette, RouteMap and ElevationProfile color the
// polyline/area by phase instead of by per-segment grade.
export interface PhaseRange {
  start_mi: number;
  end_mi: number;
  label?: string;
}

function phaseIndexAt(mile: number, phases: PhaseRange[]): number {
  for (let i = 0; i < phases.length; i++) {
    if (mile <= phases[i].end_mi) return i;
  }
  return phases.length - 1;
}
function phaseColorAt(mile: number, phases: PhaseRange[], colors: string[]): string {
  return colors[phaseIndexAt(mile, phases)] ?? colors[colors.length - 1] ?? '#888888';
}

// Soft phase-boundary blend. Within fadeMi miles of a phase edge, lerp
// between this phase's color and the neighbor's so the elevation profile
// doesn't snap from one tint to the next. Default 0.1 mi keeps the fade
// narrow — most of each phase still reads as its own pure color.
function parseColor(c: string): [number, number, number] | null {
  if (c.startsWith('#')) {
    if (c.length === 7) return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    if (c.length === 4) return [parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16), parseInt(c[3] + c[3], 16)];
  }
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}
function mixColors(a: string, b: string, t: number): string {
  const ra = parseColor(a), rb = parseColor(b);
  if (!ra || !rb) return a;
  const r = Math.round(ra[0] + (rb[0] - ra[0]) * t);
  const g = Math.round(ra[1] + (rb[1] - ra[1]) * t);
  const bl = Math.round(ra[2] + (rb[2] - ra[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function phaseColorAtBlended(
  mile: number,
  phases: PhaseRange[],
  colors: string[],
  fadeMi = 0.1,
): string {
  const idx = phaseIndexAt(mile, phases);
  const here = colors[idx] ?? colors[colors.length - 1] ?? '#888888';
  const phase = phases[idx];
  if (!phase) return here;
  const distFromStart = mile - phase.start_mi;
  const distFromEnd = phase.end_mi - mile;
  // Fade INTO the previous phase as we approach our start boundary
  if (distFromStart < fadeMi && idx > 0) {
    const prev = colors[idx - 1] ?? here;
    // t = 0 right at boundary (full neighbor), 1 fully inside (full self)
    const t = Math.max(0, Math.min(1, (distFromStart + fadeMi) / (2 * fadeMi)));
    return mixColors(prev, here, t);
  }
  // Fade INTO the next phase as we approach our end boundary
  if (distFromEnd < fadeMi && idx < phases.length - 1) {
    const next = colors[idx + 1] ?? here;
    const t = Math.max(0, Math.min(1, (distFromEnd + fadeMi) / (2 * fadeMi)));
    return mixColors(next, here, t);
  }
  return here;
}

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
export function StatsGrid({ analysis }: { analysis: CourseAnalysis }) {
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

export interface RouteMapProps {
  analysis: CourseAnalysis;
  hoverIdx?: number | null;
  /** 'grade' tints each segment by its grade %; 'phase' tints by the
   *  phase that segment falls into (requires `phases` + `phaseColors`). */
  tinting?: 'grade' | 'phase';
  phases?: PhaseRange[];
  phaseColors?: string[];
  /** When true (default), Carto Dark tiles render under the polyline.
   *  When false, the polyline floats on a solid dark surface — matches
   *  the legacy poster aesthetic. */
  tiles?: boolean;
  height?: number;
  /** Specific peak point to mark with a "P · {ele} ft" pin. When
   *  omitted, the OAB turnaround pin renders for true out-and-backs. */
  peakIdx?: number;
  /** Show recenter button overlay top-right. Default true. */
  recenter?: boolean;
  /** Show dashed bbox rectangle. Default true. */
  showBbox?: boolean;
  /** Show grade legend below the map (only meaningful when tinting='grade'). */
  showLegend?: boolean;
}

export function RouteMap({
  analysis, hoverIdx,
  tinting = 'grade', phases, phaseColors,
  tiles = true, height = 480, peakIdx, recenter = true,
  showBbox = true, showLegend,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep the Leaflet map + hover marker as plain refs (not state) so
  // their lifecycle stays out of React's reconciliation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hoverRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitBoundsRef = useRef<(() => void) | null>(null);

  const legend = showLegend ?? (tinting === 'grade');

  // Build the map once per analysis. Recreate (cleanup + rebuild) when
  // the underlying GPX or render mode changes.
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
        // Canvas rendering is fast for many segments but requires a tile
        // layer (or some viewport-init signal) to size correctly. In
        // tile-less poster mode we use SVG rendering so polylines draw
        // even before fitBounds runs.
        preferCanvas: tiles,
        zoomControl: tiles, // hide +/- in tile-less poster mode
        // No Leaflet attribution badge anywhere — it visually clutters
        // the dark race poster. Tile attribution stays compliant by
        // being added to a separate footer (or, if you skip the
        // footer entirely, accepted as the trade-off).
        attributionControl: false,
      });
      mapRef.current = map;
      // Container background — controls what shows through when no tile
      // layer is attached (poster mode).
      map.getContainer().style.background = tiles ? '#0f1117' : '#0B0F17';

      const { trkpts, gradesPct, cumDistM, stats } = analysis;

      // Position viewport BEFORE adding vectors. fitBounds gives the
      // map a real zoom level. Without it (especially in tile-less
      // mode where there's no other viewport-init signal) polylines
      // get projected at the wrong scale and end up clustered to a
      // single point.
      if (tiles) {
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '© OSM · © CARTO',
          subdomains: 'abcd', maxZoom: 20,
        }).addTo(map);
      }
      map.fitBounds(
        [[stats.bbox.minLat, stats.bbox.minLon], [stats.bbox.maxLat, stats.bbox.maxLon]],
        { padding: [24, 24], animate: false },
      );
      // Force a layout pass so the SVG/canvas renderer picks up the
      // viewport set by fitBounds before polylines are added. Without
      // this, the renderer can latch onto the pre-init zoom and project
      // every segment to the same pixel (M40 232L40 232).
      map.invalidateSize({ animate: false });

      const colorFor = (segIdx: number): string => {
        if (tinting === 'phase' && phases && phaseColors) {
          const midM = (cumDistM[segIdx] + cumDistM[segIdx + 1]) / 2;
          return phaseColorAt(midM / M_PER_MI, phases, phaseColors);
        }
        // Continuous interpolation — lerps between bucket anchors so
        // segment-to-segment color seams fade out.
        return gradeColorContinuous(gradesPct[segIdx]);
      };
      for (let i = 1; i < trkpts.length; i++) {
        const a = trkpts[i - 1], b = trkpts[i];
        L.polyline([[a[0], a[1]], [b[0], b[1]]], {
          color: colorFor(i - 1),
          weight: tiles ? 4 : 3.5,
          opacity: 0.95,
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

      if (peakIdx != null && peakIdx >= 0 && peakIdx < trkpts.length) {
        // Explicit peak override — use it instead of the OAB turnaround.
        const p = trkpts[peakIdx];
        L.marker([p[0], p[1]], { icon: pin('#FC4D54', 'P') }).addTo(map)
          .bindPopup(`<strong>Peak</strong><br>${ft(p[2]).toFixed(0)} ft · mi ${(cumDistM[peakIdx] / M_PER_MI).toFixed(2)}`);
      } else if (stats.oabScorePct > 75) {
        const tp = trkpts[stats.turnIdx];
        L.marker([tp[0], tp[1]], { icon: pin('#a16207', 'T') }).addTo(map)
          .bindPopup(`<strong>Turnaround</strong><br>${mi(stats.maxFromStartM).toFixed(2)} mi from start`);
      }

      if (showBbox) {
        L.rectangle(
          [[stats.bbox.minLat, stats.bbox.minLon], [stats.bbox.maxLat, stats.bbox.maxLon]],
          { color: 'rgba(245,244,238,0.35)', weight: 1, fill: false, dashArray: '4,4', opacity: 0.5 },
        ).addTo(map);
      }

      const doFit = () => {
        map.fitBounds(
          [[stats.bbox.minLat, stats.bbox.minLon], [stats.bbox.maxLat, stats.bbox.maxLon]],
          { padding: [24, 24] },
        );
      };
      fitBoundsRef.current = doFit;
      doFit();
    })();

    return () => {
      cancelled = true;
      if (hoverRef.current && mapRef.current) {
        try { mapRef.current.removeLayer(hoverRef.current); } catch { /* noop */ }
      }
      hoverRef.current = null;
      fitBoundsRef.current = null;
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch { /* noop */ }
        mapRef.current = null;
      }
    };
  }, [analysis, tinting, phases, phaseColors, tiles, peakIdx, showBbox]);

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
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          height,
          borderRadius: 12,
          border: tiles ? `1px solid ${BORDER}` : 'none',
          overflow: 'hidden',
          background: tiles ? '#0f1117' : '#0B0F17',
        }}
      />
      {recenter && (
        <button
          type="button"
          onClick={() => fitBoundsRef.current?.()}
          aria-label="Recenter route"
          title="Recenter route"
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 500,
            width: 32, height: 32, borderRadius: 6,
            background: 'rgba(11,15,23,0.78)',
            border: '1px solid rgba(245,244,238,0.18)',
            color: 'rgba(245,244,238,0.9)',
            fontSize: 16, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            padding: 0, lineHeight: 1,
          }}
        >⌖</button>
      )}
      {legend && (
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'nowrap', marginTop: 10,
          fontSize: 10, color: TEXT_2, fontFamily: 'var(--font-data)',
          letterSpacing: '0.04em',
          alignItems: 'center', whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}>
          <strong style={{ color: TEXT_3, marginRight: 2, fontSize: 10, letterSpacing: '0.12em' }}>GRADE</strong>
          {GRADE_COLORS.map(({ color, label }) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, background: color, borderRadius: 2, flexShrink: 0 }} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ElevationProfileProps {
  analysis: CourseAnalysis;
  onHoverIdx?: (i: number | null) => void;
  /** 'flat' draws a single cyan line (default). 'phase' tints each
   *  segment using the phase that segment falls into. */
  tinting?: 'flat' | 'phase';
  phases?: PhaseRange[];
  phaseColors?: string[];
  /** Trackpoint index of the verified peak — adds a red dot at that
   *  point and a "PEAK · X FT · MI Y.Y" badge in the chart corner. */
  peakIdx?: number;
  /** Render a 0/mid/total mile axis below the chart. Default false. */
  showAxis?: boolean;
  /** Render Chart.js's own x/y scale ticks + title. Default true. Set
   *  to false when the parent has its own axis (the poster hero) so
   *  the chart sits clean. */
  chartAxisVisible?: boolean;
  /** Render a proportional phase strip below the axis. Default false.
   *  Requires phases + phaseColors. */
  showPhaseStrip?: boolean;
  /** Container height in px. Default 280. */
  height?: number;
  /** Override the chart's line color in 'flat' mode. */
  lineColor?: string;
  /** Override container chrome (border / padding / background) — when
   *  the chart sits inside another card the wrapper double-borders. */
  bare?: boolean;
}

export function ElevationProfile({
  analysis, onHoverIdx,
  tinting = 'flat', phases, phaseColors,
  peakIdx, showAxis = false, chartAxisVisible = true, showPhaseStrip = false,
  height = 280, lineColor = '#22d3ee', bare = false,
}: ElevationProfileProps) {
  const { trkpts, cumDistM } = analysis;
  const labels = useMemo(() => cumDistM.map(d => +mi(d).toFixed(4)), [cumDistM]);
  const values = useMemo(() => trkpts.map(p => +ft(p[2]).toFixed(2)), [trkpts]);
  const totalMi = mi(cumDistM[cumDistM.length - 1] ?? 0);

  // Build the segment color resolver once per render — Chart.js calls
  // this back for every segment between p0 and p1. Phase boundaries
  // get a small lerp window (0.1 mi each side) so the area-fill fades
  // softly between phase tints instead of switching abruptly.
  const segmentColor = useMemo(() => {
    if (tinting === 'phase' && phases && phaseColors) {
      return (segIdx: number, alpha = 1): string => {
        const midM = (cumDistM[segIdx] + cumDistM[segIdx + 1]) / 2;
        const c = phaseColorAtBlended(midM / M_PER_MI, phases, phaseColors, 0.1);
        return alpha < 1 ? withAlpha(c, alpha) : c;
      };
    }
    return null;
  }, [tinting, phases, phaseColors, cumDistM]);

  // Peak overlay dataset — one non-null point at peakIdx.
  const peakOverlay = useMemo(() => {
    if (peakIdx == null || peakIdx < 0 || peakIdx >= values.length) return null;
    const data = new Array(values.length).fill(null);
    data[peakIdx] = values[peakIdx];
    return data;
  }, [peakIdx, values]);

  return (
    <div style={bare ? { height } : {
      background: SURFACE, border: `1px solid ${BORDER}`,
      borderRadius: 12, padding: 14, height,
    }}>
      {/* Chart sized to fill the wrapper (or `height` if bare).
          onMouseLeave clears the synced hover marker on the map —
          Chart.js's onHover only fires on mousemove inside the chart,
          so without this the marker stays painted on the map after
          the cursor leaves. */}
      <div
        style={{ position: 'relative', width: '100%', height: bare ? height : '100%' }}
        onMouseLeave={() => onHoverIdx?.(null)}
      >
        <Line
          data={{
            labels,
            datasets: [
              // Main elevation line. When tinting==='phase', segment.borderColor +
              // segment.backgroundColor get called per segment with p0/p1 indices,
              // so we color by the phase that segment falls into.
              {
                label: 'Elevation (ft)',
                data: values,
                borderColor: lineColor,
                backgroundColor: withAlpha(lineColor, 0.18),
                fill: 'origin', tension: 0.25,
                pointRadius: 0, pointHoverRadius: 5, borderWidth: 2,
                ...(segmentColor ? {
                  segment: {
                    borderColor: (ctx: { p0DataIndex: number }) => segmentColor(ctx.p0DataIndex),
                    backgroundColor: (ctx: { p0DataIndex: number }) => segmentColor(ctx.p0DataIndex, 0.35),
                  },
                } : {}),
              },
              // Optional peak overlay — single visible point, no line.
              ...(peakOverlay ? [{
                label: 'Peak',
                data: peakOverlay,
                borderColor: 'transparent',
                backgroundColor: '#FC4D54',
                pointRadius: 5, pointHoverRadius: 7,
                pointBorderColor: '#fff', pointBorderWidth: 2,
                showLine: false,
                fill: false,
              }] : []),
            ],
          }}
          options={{
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            // Drive hover sync. Mouseleave on the wrapper above also
            // clears the marker — Chart.js onHover only fires inside.
            onHover: (_e, elements) => {
              if (!onHoverIdx) return;
              if (elements.length > 0) onHoverIdx(elements[0].index);
              else onHoverIdx(null);
            },
            // Pull right padding to 0 so the curve runs to the right
            // edge. Top padding leaves room for hover dots so they
            // don't clip on a high peak.
            layout: { padding: { left: 0, right: 0, top: 6, bottom: 0 } },
            plugins: {
              tooltip: {
                backgroundColor: 'rgba(11,15,23,0.96)',
                borderColor: 'rgba(245,197,24,0.45)', // milestone-yellow accent
                borderWidth: 1,
                cornerRadius: 6,
                padding: 10,
                caretSize: 6,
                caretPadding: 8,
                displayColors: false,
                titleColor: 'rgba(245,197,24,0.85)',
                titleFont: { family: "'JetBrains Mono', monospace", size: 11, weight: 700 },
                titleAlign: 'left',
                bodyColor: '#fff',
                bodyFont: { family: "'JetBrains Mono', monospace", size: 13, weight: 600 },
                bodySpacing: 4,
                filter: item => item.datasetIndex === 0, // suppress peak-overlay tooltip noise
                callbacks: {
                  title: items => `MI ${Number(items[0].label).toFixed(2)}`,
                  label: item => `${(item.parsed.y as number).toFixed(0)} FT  ·  ${((item.parsed.y as number) / FT_PER_M).toFixed(1)} M`,
                },
              },
            },
            scales: {
              x: {
                type: 'linear',
                // Hide entirely when chartAxisVisible=false so no left/
                // right padding is reserved (lets the curve fill edge
                // to edge). The poster's external `.axis` strip below
                // provides the 0/mid/total mile labels.
                display: chartAxisVisible,
                title: { display: chartAxisVisible, text: 'Distance (mi)' },
                ticks: { display: chartAxisVisible },
                grid: { color: chartAxisVisible ? 'rgba(245,244,238,0.06)' : 'transparent' },
                border: { display: false },
              },
              y: {
                // Y-axis stays visible even when chartAxisVisible=false
                // so the user has an elevation scale reference. Only
                // the title ("Elevation (ft)") is suppressed in poster
                // mode — the ticks themselves carry the unit.
                display: true,
                title: { display: chartAxisVisible, text: 'Elevation (ft)' },
                ticks: {
                  display: true,
                  color: 'rgba(245,244,238,0.45)',
                  font: { family: "'JetBrains Mono', monospace", size: 10 },
                  padding: 6,
                  callback: (value: string | number) => `${Math.round(Number(value))} ft`,
                },
                grid: { color: chartAxisVisible ? 'rgba(245,244,238,0.06)' : 'rgba(245,244,238,0.05)' },
                border: { display: false },
                beginAtZero: false,
              },
            },
          }}
        />
        {peakIdx != null && peakIdx >= 0 && peakIdx < trkpts.length && !bare && (
          <div style={{
            position: 'absolute', top: 6, right: 10,
            fontSize: 10.5, color: '#F5C518',
            fontFamily: 'var(--font-data)', letterSpacing: '0.08em',
            fontWeight: 700, textTransform: 'uppercase',
          }}>
            Peak <span style={{ color: 'rgba(245,197,24,0.7)' }}>{ft(trkpts[peakIdx][2]).toFixed(0)} ft · mi {(cumDistM[peakIdx] / M_PER_MI).toFixed(1)}</span>
          </div>
        )}
      </div>
      {showAxis && (
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 10.5, color: TEXT_3,
          fontFamily: 'var(--font-data)', letterSpacing: '0.08em',
          fontWeight: 600, marginTop: 6, padding: '0 4px',
        }}>
          <span>0</span>
          <span>{(totalMi / 2).toFixed(1)}</span>
          <span>{totalMi.toFixed(1)}</span>
        </div>
      )}
      {showPhaseStrip && phases && phaseColors && phases.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: phases.map(p => `${(p.end_mi - p.start_mi).toFixed(2)}fr`).join(' '),
          gap: 0, marginTop: 8,
        }}>
          {phases.map((p, i) => (
            <div key={i} style={{
              borderTop: `2px solid ${phaseColors[i] ?? '#444'}`,
              padding: '6px 8px',
              fontSize: 10, color: TEXT_2,
              fontFamily: 'var(--font-data)', letterSpacing: '0.08em',
              textTransform: 'uppercase', fontWeight: 600,
              display: 'flex', justifyContent: 'space-between', gap: 6,
              minWidth: 0, overflow: 'hidden',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label ?? `P${i + 1}`}</span>
              <span style={{ color: TEXT_3 }}>{(p.end_mi - p.start_mi).toFixed(1)}<small style={{ fontSize: 8, opacity: 0.7 }}>mi</small></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// alpha helper — prepends a 2-digit hex alpha to a #RRGGBB color, or
// passes through rgba()/hsla() (returns as-is if not a recognized
// color format).
function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith('#') && color.length === 7) {
    const ah = Math.round(a * 255).toString(16).padStart(2, '0');
    return color + ah;
  }
  // rgb(...) → rgba(...)
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  return color;
}

// ── Splits ───────────────────────────────────────────────────────
export function SplitsTables({ analysis }: { analysis: CourseAnalysis }) {
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
export function ChartsRow({ analysis }: { analysis: CourseAnalysis }) {
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

export function SpacingAndDistance({ analysis }: { analysis: CourseAnalysis }) {
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
export function Insights({ analysis }: { analysis: CourseAnalysis }) {
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
