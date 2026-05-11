'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { TrackPoint } from '../../lib/core/types';

interface Props {
  trackPoints: TrackPoint[] | null;
  startCoords: { lat: number; lon: number } | null;
  finishCoords: { lat: number; lon: number } | null;
  gpxSource: string | null;
  raceName: string;
}

function gradeColor(grade: number): string {
  if (grade > 4) return '#ef4444';
  if (grade > 1.5) return '#f97316';
  if (grade < -4) return '#14b8a6';
  if (grade < -1.5) return '#22c55e';
  return '#3b82f6';
}

export default function CourseMap({ trackPoints, startCoords, finishCoords, gpxSource, raceName }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  const hasRoute = trackPoints && trackPoints.length > 1;
  const hasCoords = startCoords || finishCoords;

  useEffect(() => {
    if (!mapRef.current) return;
    if (!hasRoute && !hasCoords) return;

    // Dynamic import to avoid SSR issues
    import('leaflet').then(L => {
      if (!mapRef.current) return;

      // Clean up previous instance
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
      }

      // Fix Leaflet icon paths in Next.js
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      // Determine center/bounds
      let center: [number, number];
      let zoom = 11;

      if (hasRoute) {
        const lats = trackPoints.map(p => p.lat);
        const lons = trackPoints.map(p => p.lon);
        center = [
          (Math.min(...lats) + Math.max(...lats)) / 2,
          (Math.min(...lons) + Math.max(...lons)) / 2,
        ];
      } else if (startCoords && finishCoords) {
        center = [
          (startCoords.lat + finishCoords.lat) / 2,
          (startCoords.lon + finishCoords.lon) / 2,
        ];
      } else {
        center = [startCoords?.lat ?? finishCoords!.lat, startCoords?.lon ?? finishCoords!.lon];
        zoom = 13;
      }

      const map = L.map(mapRef.current, {
        center,
        zoom,
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: false,
      });

      mapInstanceRef.current = map;

      // Dark-ish tile layer (Carto Voyager)
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
        { maxZoom: 19 }
      ).addTo(map);

      // Draw route
      if (hasRoute && trackPoints.length > 1) {
        if (gpxSource === 'osrm_synthetic') {
          // Single color for synthetic route
          const latlngs: [number, number][] = trackPoints.map(p => [p.lat, p.lon]);
          L.polyline(latlngs, { color: '#8888a0', weight: 3, opacity: 0.7 }).addTo(map);
        } else {
          // Color-coded by grade
          for (let i = 0; i < trackPoints.length - 1; i++) {
            const a = trackPoints[i];
            const b = trackPoints[i + 1];
            const distM = (b.distMi - a.distMi) * 1609.344;
            const riseM = (b.eleFt - a.eleFt) / 3.28084;
            const grade = distM > 0 ? (riseM / distM) * 100 : 0;
            const color = gradeColor(grade);
            L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color, weight: 4, opacity: 0.85 }).addTo(map);
          }
        }

        // Fit map to route
        const bounds = L.latLngBounds(trackPoints.map(p => [p.lat, p.lon] as [number, number]));
        map.fitBounds(bounds, { padding: [20, 20] });
      }

      // Start marker (green)
      const startPt = hasRoute ? trackPoints[0] : startCoords;
      if (startPt) {
        const startIcon = L.divIcon({
          html: `<div style="
            width:28px;height:28px;border-radius:50%;
            background:#22c55e;border:3px solid #fff;
            display:flex;align-items:center;justify-content:center;
            font-size:11px;font-weight:700;color:#fff;font-family:sans-serif;
            box-shadow:0 2px 6px rgba(0,0,0,0.5);
          ">S</div>`,
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        L.marker([startPt.lat, startPt.lon], { icon: startIcon })
          .addTo(map)
          .bindPopup(`<strong>Start</strong><br>${raceName}`);
      }

      // Finish marker (orange)
      const finishPt = hasRoute ? trackPoints[trackPoints.length - 1] : (finishCoords ?? startCoords);
      if (finishPt) {
        const finishIcon = L.divIcon({
          html: `<div style="
            width:28px;height:28px;border-radius:50%;
            background:#f97316;border:3px solid #fff;
            display:flex;align-items:center;justify-content:center;
            font-size:11px;font-weight:700;color:#fff;font-family:sans-serif;
            box-shadow:0 2px 6px rgba(0,0,0,0.5);
          ">F</div>`,
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        L.marker([finishPt.lat, finishPt.lon], { icon: finishIcon })
          .addTo(map)
          .bindPopup(`<strong>Finish</strong><br>${raceName}`);
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
    };
  }, [trackPoints, startCoords, finishCoords, gpxSource, raceName, hasRoute, hasCoords]);

  if (!hasRoute && !hasCoords) {
    return (
      <div style={{
        height: 200,
        background: '#18181c',
        border: '1px solid #2a2a32',
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 8,
        marginBottom: 20,
        color: '#55556a',
        fontSize: 13,
      }}>
        <span style={{ fontSize: 24 }}>🗺</span>
        <span>Course coordinates unavailable</span>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', marginBottom: 20 }}>
      {gpxSource === 'osrm_synthetic' && (
        <div style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1000,
          background: 'rgba(0,0,0,0.75)',
          color: '#8888a0',
          fontSize: 11,
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid #2a2a32',
        }}>
          Approximate route
        </div>
      )}
      {gpxSource === 'user_upload' && (
        <div style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1000,
          background: 'rgba(0,0,0,0.75)',
          color: '#22c55e',
          fontSize: 11,
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid #22c55e40',
        }}>
          Your recording
        </div>
      )}
      {gpxSource === 'official_download' && (
        <div style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1000,
          background: 'rgba(0,0,0,0.75)',
          color: '#3b82f6',
          fontSize: 11,
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid #3b82f640',
        }}>
          Official course
        </div>
      )}
      <div
        ref={mapRef}
        style={{
          height: 280,
          borderRadius: 10,
          border: '1px solid #2a2a32',
          overflow: 'hidden',
          background: '#0f0f11',
        }}
      />
      {/* Leaflet CSS */}
      <style>{`
        .leaflet-container { background: #0f0f11 !important; }
        .leaflet-control-zoom a { background: #18181c !important; color: #e8e8ee !important; border-color: #2a2a32 !important; }
        .leaflet-control-zoom a:hover { background: #1f1f25 !important; }
        .leaflet-popup-content-wrapper { background: #18181c !important; color: #e8e8ee !important; border: 1px solid #2a2a32 !important; box-shadow: none !important; }
        .leaflet-popup-tip { background: #18181c !important; }
        .leaflet-popup-close-button { color: #8888a0 !important; }
      `}</style>
    </div>
  );
}
