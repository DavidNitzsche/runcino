'use client';

/**
 * RouteMap, Leaflet map showing the Strava activity's route.
 *
 * Renders OpenStreetMap tiles (CartoDB Voyager, cleaner styling
 * than vanilla OSM) with the polyline trace in Strava-orange and
 * green/orange circle markers at the start + end.
 *
 * Wrapped with `dynamic({ ssr: false })` because Leaflet touches
 * `window` on mount.
 */

import { useEffect, useRef } from 'react';

interface Props {
  /** Strava `summary_polyline` (encoded with Google polyline algo).
   *  Optional, pass either this or `coords`. */
  polyline?: string;
  /** Pre-decoded coordinates as [lat, lon] pairs. Used when we have
   *  direct GPX trackpoint data instead of an encoded polyline. */
  coords?: Array<[number, number]>;
  startLatLng?: [number, number] | null;
  endLatLng?: [number, number] | null;
  height?: number | string;
}

/** Decodes Google's encoded polyline format into [lat,lng] pairs. */
function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    points.push([lat * 1e-5, lng * 1e-5]);
  }
  return points;
}

export default function RouteMap({ polyline, coords: coordsProp, startLatLng, endLatLng, height = 260 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<unknown>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return; // already initialized

    let cancelled = false;
    // Lazy-import Leaflet (it needs window, safe to do here in a client
    // component effect). Also import the CSS.
    (async () => {
      const L = (await import('leaflet')).default;
      // CSS via link tag, leaflet/dist/leaflet.css ships with the package
      if (!document.querySelector('link[data-leaflet-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.crossOrigin = '';
        link.dataset.leafletCss = 'true';
        document.head.appendChild(link);
      }
      if (cancelled || !containerRef.current) return;

      const coords = coordsProp && coordsProp.length > 0
        ? coordsProp
        : polyline ? decodePolyline(polyline) : [];
      if (coords.length === 0) return;

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: true,
      });
      mapRef.current = map;

      // CartoDB Voyager tiles, clean, readable, free.
      // Attribution suppressed in the visual; OSM/CARTO require it per
      // ToS for production use, keep their credit somewhere in the UI
      // (footer / about page) before going public.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution: '',
      }).addTo(map);

      // The route trace
      const trace = L.polyline(coords, {
        color: '#FC4C02',
        weight: 4,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(map);

      // Start + end markers
      const start = startLatLng ?? coords[0];
      const end = endLatLng ?? coords[coords.length - 1];
      L.circleMarker(start as [number, number], {
        radius: 6, weight: 2, color: '#fff', fillColor: '#3EBD41', fillOpacity: 1,
      }).addTo(map);
      L.circleMarker(end as [number, number], {
        radius: 6, weight: 2, color: '#fff', fillColor: '#FC4C02', fillOpacity: 1,
      }).addTo(map);

      map.fitBounds(trace.getBounds(), { padding: [16, 16] });
    })();

    return () => {
      cancelled = true;
      // Tear down on unmount
      const m = mapRef.current as { remove?: () => void } | null;
      if (m && typeof m.remove === 'function') {
        m.remove();
        mapRef.current = null;
      }
    };
  }, [polyline, coordsProp, startLatLng, endLatLng]);

  return (
    <div
      ref={containerRef}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        width: '100%',
        borderRadius: '10px',
        overflow: 'hidden',
        border: '1px solid rgba(8,8,8,.08)',
      }}
    />
  );
}
