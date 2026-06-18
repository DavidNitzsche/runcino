'use client';

/**
 * RouteMap · Style F+ from the /dev/route-map-mockups review · pace-graded
 * route on a free OSM-derived dark map.
 *
 * Stack:
 *  · CartoDB Dark Matter raster tiles (OpenStreetMap data, free, no token,
 *    CDN-served from basemaps.cartocdn.com).
 *  · Leaflet 1.9 (~40KB gzip, MIT-licensed) renders the tiles + polylines.
 *    All interaction (zoom, pan, scroll, keyboard, tap) disabled so the
 *    map reads as a still image embedded in the hero.
 *  · Per-mile pace bucketing · five quintile buckets across the run's own
 *    splits, colored from #FC4D64 (fastest 20%) to #27B4E0 (slowest 20%).
 *    The map is darker than the route so the line always pops.
 *  · Endpoint dots · start green ring, finish coral.
 *  · Baseline coral underlayer painted first so the route is always
 *    visible even if the bucket walker errors out (belt + suspenders).
 *
 * Attribution · OSM + CARTO require credit somewhere. We disable Leaflet's
 * default attribution control (it ships a Ukraine flag in 1.9 plus the
 * "Leaflet | ..." watermark) and put a single faded line in the corner of
 * the card itself via CSS in globals.css.
 */
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as LeafletNS from 'leaflet';
import { decodePolyline } from '@/lib/route/polyline';

type Split = { mile: number; pace: string | null };

export function RouteMap({
  polyline, points: pointsProp, splits, height = 480,
}: {
  /** Encoded polyline string (post-run path · Strava-style). Optional —
   *  pass `points` instead for race courses where trackPoints are already
   *  available as raw lat/lng arrays. */
  polyline?: string;
  /** Raw lat/lng points. Takes precedence over `polyline` when provided. */
  points?: Array<[number, number]>;
  splits: Split[];
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hostRef.current) return;
    if (!polyline && (!pointsProp || pointsProp.length < 2)) return;

    (async () => {
      // Lazy-load Leaflet so SSR doesn't try to evaluate it.
      const L = (await import('leaflet')).default;
      if (cancelled || !hostRef.current) return;

      // Resolve points · raw array wins, fall back to decoding the
      // polyline string. Short-circuit if either path leaves us degenerate.
      const points = pointsProp && pointsProp.length >= 2
        ? pointsProp
        : (polyline ? decodePolyline(polyline) : []);
      if (points.length < 2) return;

      // Tear down any prior instance (re-render on prop change).
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(hostRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        touchZoom: false,
        doubleClickZoom: false,
        scrollWheelZoom: false,
        boxZoom: false,
        keyboard: false,
        // tap option removed in Leaflet 2.0 · keep for 1.9 type compat by
        // casting; harmless extra key on older releases.
        ...(({ tap: false }) as Record<string, boolean>),
      });
      mapRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png', {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution: '',
      }).addTo(map);

      // Baseline route · single coral polyline drawn first so the line is
      // visible regardless of bucket logic outcomes.
      L.polyline(points as LeafletNS.LatLngTuple[], {
        color: '#D03F3F',
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      // Pace-graded overlay · walks the polyline by Haversine distance,
      // emits a Leaflet polyline per pace-bucket-change. Each segment
      // gets a single solid color from the warm-to-cool quintile palette.
      const buckets = paceBuckets(splits);
      if (buckets && splits.length >= 2) {
        let total = 0;
        let segStartIdx = 0;
        let lastBucket: number | null = null;
        const flush = (endIdx: number, b: number | null) => {
          if (segStartIdx >= endIdx || b == null) return;
          const segPts = points.slice(segStartIdx, endIdx + 1) as LeafletNS.LatLngTuple[];
          L.polyline(segPts, {
            color: BUCKET_COLORS[b],
            weight: 6,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(map);
        };
        for (let i = 0; i < points.length; i++) {
          if (i > 0) total += haversineMi(points[i - 1], points[i]);
          const mile = Math.floor(total);
          const split = splits[Math.min(mile, splits.length - 1)];
          const sec = split ? paceToSec(split.pace) : null;
          const b = sec != null ? buckets.bucket(sec) : null;
          if (lastBucket == null) lastBucket = b;
          if (b !== lastBucket) {
            flush(i, lastBucket);
            segStartIdx = i;
            lastBucket = b;
          }
        }
        flush(points.length - 1, lastBucket);
      }

      // Endpoint markers · last so they sit above all polylines.
      L.circleMarker(points[0] as LeafletNS.LatLngTuple, {
        radius: 7, fillColor: '#04201f', color: '#14C08C',
        weight: 3, fillOpacity: 1,
      }).addTo(map);
      L.circleMarker(points[points.length - 1] as LeafletNS.LatLngTuple, {
        radius: 7, fillColor: '#FC4D64', color: '#fff',
        weight: 2, fillOpacity: 1,
      }).addTo(map);

      const bounds = L.latLngBounds(points as LeafletNS.LatLngTuple[]);
      map.fitBounds(bounds, { padding: [24, 24] });

      // Second pass after CSS settles · Leaflet sometimes measures the
      // container before the flexbox layout is final, leaving the map
      // at the wrong zoom. invalidateSize + refit picks up the final
      // dimensions.
      setTimeout(() => {
        if (cancelled || !mapRef.current) return;
        mapRef.current.invalidateSize();
        mapRef.current.fitBounds(bounds, { padding: [24, 24] });
      }, 80);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [polyline, pointsProp, splits]);

  const hasPaceData = splits.length >= 2 && splits.some(s => s.pace);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: height, borderRadius: 16, overflow: 'hidden' }}>
      <div
        ref={hostRef}
        className="routemap-leaflet"
        style={{
          width: '100%',
          height: '100%',
          minHeight: height,
          borderRadius: 16,
          overflow: 'hidden',
          background: '#0a0e16',
        }}
        aria-label="Run route map"
      />
      {/* Pace color legend · only when per-mile splits are available */}
      {hasPaceData && (
        <div style={{
          position: 'absolute', bottom: 10, left: 10, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'rgba(8,12,20,.72)', backdropFilter: 'blur(6px)',
          borderRadius: 6, padding: '4px 8px',
          fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
          color: 'rgba(255,255,255,.7)',
          pointerEvents: 'none',
        }}>
          <span>FASTER</span>
          {/* Color swatches: bucket 0 (fastest) → bucket 4 (slowest) */}
          {BUCKET_COLORS.map((c, i) => (
            <div key={i} style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
          ))}
          <span>SLOWER</span>
        </div>
      )}
    </div>
  );
}

const BUCKET_COLORS = ['#FC4D64', '#D03F3F', '#F3AD38', '#14C08C', '#27B4E0'];

function paceToSec(s: string | null): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function paceBuckets(splits: Split[]): { bucket: (sec: number) => number } | null {
  const seconds = splits
    .map(s => paceToSec(s.pace))
    .filter((n): n is number => n != null && n > 0);
  if (seconds.length < 2) return null;
  const sorted = seconds.slice().sort((a, b) => a - b);
  // Quintile thresholds · fastest 20%, then 20% increments.
  const q = [
    sorted[Math.floor(sorted.length * 0.2)],
    sorted[Math.floor(sorted.length * 0.4)],
    sorted[Math.floor(sorted.length * 0.6)],
    sorted[Math.floor(sorted.length * 0.8)],
  ];
  return {
    bucket(sec: number): number {
      if (sec <= q[0]) return 0;
      if (sec <= q[1]) return 1;
      if (sec <= q[2]) return 2;
      if (sec <= q[3]) return 3;
      return 4;
    },
  };
}

const EARTH_MI = 3958.7613;
function haversineMi(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x = Math.sin(dLat / 2) ** 2
    + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(x)));
}
