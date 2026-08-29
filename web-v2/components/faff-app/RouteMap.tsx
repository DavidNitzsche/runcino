'use client';

/**
 * RouteMap · MapLibre GL JS vector-tile edition (2026-08-28).
 *
 * WHY THIS CHANGED: CARTO retired its raster tile CDN. The old
 * `basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png` endpoint this
 * component used now returns an "API KEY REQUIRED" watermark tile
 * UNCONDITIONALLY — confirmed a valid key makes no difference. CARTO only
 * continues to serve vector tiles (MVT), consumed either as raw tiles or
 * via a ready-made MapLibre GL style JSON. We use the style JSON — it's
 * CARTO's own "Dark Matter" style, which is the exact look this component
 * was already going for.
 *
 * Stack:
 *  · CARTO's "Dark Matter" vector-tile GL style
 *    (basemaps.cartocdn.com/gl/dark-matter-gl-style) — OpenStreetMap data,
 *    fair-use rate-limited by a style key (NEXT_PUBLIC_CARTO_API_KEY, see
 *    below), not a raster tile CDN.
 *  · MapLibre GL JS (BSD-3, the CDN's own recommended client) renders the
 *    vector tiles + our route polylines. Replaces Leaflet entirely for
 *    this component — Leaflet has no first-party vector-tile story, and
 *    this was Leaflet's only remaining call site in the app (see the
 *    RouteMap.tsx history: `leaflet` was added solely for this component).
 *    All interaction (zoom, pan, scroll, keyboard, tap) disabled so the
 *    map reads as a still image embedded in the hero — same as before.
 *  · Per-mile pace bucketing · five quintile buckets across the run's own
 *    splits, colored from #FC4D64 (fastest 20%) to #27B4E0 (slowest 20%).
 *    Rendered as one GeoJSON source of short LineString segments + one
 *    data-driven line layer, instead of Leaflet's many stacked
 *    `L.polyline` calls — same visual result (a segment per bucket
 *    change), cheaper to render.
 *  · Endpoint dots · start green ring, finish coral — one GeoJSON point
 *    source + one data-driven circle layer.
 *  · Baseline coral underlayer painted first (added to the map before the
 *    gradient layer) so the route is always visible even if the bucket
 *    walker errors out (belt + suspenders).
 *  · `showLabels=false` swaps in CARTO's "Dark Matter without labels" GL
 *    style — the vector-tile equivalent of the old `dark_nolabels` raster
 *    variant, for callers whose route spans a whole city where CARTO's
 *    baked place labels would render huge over the route (mirrors the
 *    native RouteMapView's `showLabels` prop; no current web call site
 *    passes false yet, but the option exists for race-course maps).
 *
 * Secret: NEXT_PUBLIC_CARTO_API_KEY (see web-v2/.env.example). Baked into
 * the client bundle at Next.js build time — this component renders
 * client-side, same as Leaflet did, so there's no way around that for a
 * key MapLibre GL JS needs in the browser. CARTO's own docs describe this
 * key as fair-use rate-limiting, not a security boundary, but it's still
 * wired as an env var rather than sitting as a literal in git history.
 *
 * Attribution · OSM + CARTO require credit somewhere. MapLibre's default
 * attribution control is disabled (attributionControl: false); callers
 * that want a visible credit render their own `.routemap-attribution`
 * overlay on top (see TodayView.tsx), same as under Leaflet.
 */
import { useEffect, useRef } from 'react';
import type * as MapLibreGL from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { decodePolyline } from '@/lib/route/polyline';

type Split = { mile: number; pace: string | null };

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY ?? '';

function styleUrl(showLabels: boolean): string {
  const variant = showLabels ? 'dark-matter-gl-style' : 'dark-matter-nolabels-gl-style';
  const base = `https://basemaps.cartocdn.com/gl/${variant}/style.json`;
  return CARTO_KEY ? `${base}?key=${CARTO_KEY}` : base;
}

export function RouteMap({
  polyline, points: pointsProp, splits, height = 480, showLabels = true,
}: {
  /** Encoded polyline string (post-run path · Strava-style). Optional —
   *  pass `points` instead for race courses where trackPoints are already
   *  available as raw lat/lng arrays. */
  polyline?: string;
  /** Raw lat/lng points. Takes precedence over `polyline` when provided. */
  points?: Array<[number, number]>;
  splits: Split[];
  height?: number;
  /** false → CARTO's label-free GL style, for routes that span a whole
   *  city (race courses) where baked place labels would dominate the map.
   *  Defaults true (unchanged behavior at every existing call site). */
  showLabels?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreGL.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hostRef.current) return;
    if (!polyline && (!pointsProp || pointsProp.length < 2)) return;

    (async () => {
      // Lazy-load MapLibre so SSR doesn't try to evaluate it. v6 ships only
      // named exports (no default) — unlike Leaflet's `.default`.
      const maplibregl = await import('maplibre-gl');
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

      // GeoJSON is [lng, lat]; our points arrive as [lat, lng] (Leaflet
      // convention, kept for caller compatibility).
      const lngLat: [number, number][] = points.map(([lat, lng]) => [lng, lat]);

      const map = new maplibregl.Map({
        container: hostRef.current,
        style: styleUrl(showLabels),
        interactive: false,
        attributionControl: false,
        center: lngLat[0],
        zoom: 12,
      });
      mapRef.current = map;

      map.on('load', () => {
        if (cancelled || mapRef.current !== map) return;

        // Baseline route · single coral polyline drawn first so the line is
        // visible regardless of bucket logic outcomes.
        map.addSource('faff-baseline', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: lngLat },
          },
        });
        map.addLayer({
          id: 'faff-baseline-line',
          type: 'line',
          source: 'faff-baseline',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#D03F3F', 'line-width': 5, 'line-opacity': 0.95 },
        });

        // Pace-graded overlay · walks the route by Haversine distance,
        // emits one LineString feature per pace-bucket-change. A single
        // data-driven line layer colors each feature from its own `color`
        // property — the warm-to-cool quintile palette.
        const buckets = paceBuckets(splits);
        const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
        if (buckets && splits.length >= 2) {
          let total = 0;
          let segStartIdx = 0;
          let lastBucket: number | null = null;
          const flush = (endIdx: number, b: number | null) => {
            if (segStartIdx >= endIdx || b == null) return;
            features.push({
              type: 'Feature',
              properties: { color: BUCKET_COLORS[b] },
              geometry: { type: 'LineString', coordinates: lngLat.slice(segStartIdx, endIdx + 1) },
            });
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
        map.addSource('faff-gradient', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        });
        map.addLayer({
          id: 'faff-gradient-line',
          type: 'line',
          source: 'faff-gradient',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 1 },
        });

        // Endpoint markers · one circle layer above all lines, colored by
        // a `kind` property so start/finish share one source.
        map.addSource('faff-endpoints', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { kind: 'start' },
                geometry: { type: 'Point', coordinates: lngLat[0] },
              },
              {
                type: 'Feature',
                properties: { kind: 'finish' },
                geometry: { type: 'Point', coordinates: lngLat[lngLat.length - 1] },
              },
            ],
          },
        });
        map.addLayer({
          id: 'faff-endpoints-circle',
          type: 'circle',
          source: 'faff-endpoints',
          paint: {
            'circle-radius': 7,
            'circle-color': ['match', ['get', 'kind'], 'start', '#04201f', '#FC4D64'],
            'circle-stroke-color': ['match', ['get', 'kind'], 'start', '#3EBD41', '#ffffff'],
            'circle-stroke-width': ['match', ['get', 'kind'], 'start', 3, 2],
            'circle-opacity': 1,
          },
        });

        const bounds = lngLat.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(lngLat[0], lngLat[0]),
        );
        map.fitBounds(bounds, { padding: 24, animate: false });

        // Second pass after CSS settles · MapLibre sometimes measures the
        // container before the flexbox layout is final, leaving the map
        // at the wrong zoom. resize + refit picks up the final dimensions.
        setTimeout(() => {
          if (cancelled || mapRef.current !== map) return;
          map.resize();
          map.fitBounds(bounds, { padding: 24, animate: false });
        }, 80);
      });
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [polyline, pointsProp, splits, showLabels]);

  const hasPaceData = splits.length >= 2 && splits.some(s => s.pace);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: height, borderRadius: 16, overflow: 'hidden' }}>
      <div
        ref={hostRef}
        className="routemap-maplibre"
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

const BUCKET_COLORS = ['#FC4D64', '#D03F3F', '#F3AD38', '#3EBD41', '#27B4E0'];

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
