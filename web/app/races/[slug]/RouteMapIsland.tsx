'use client';

/**
 * RouteMapIsland — thin client-side wrapper around RouteMap.
 *
 * RouteMap relies on Leaflet (window-only), so it has to be loaded
 * via `next/dynamic({ ssr: false })`. Next 16 disallows `ssr: false`
 * in server components, so we host the dynamic import in this
 * client island and let the server page just render the island.
 */

import dynamic from 'next/dynamic';

const RouteMap = dynamic(() => import('@/app/log/RouteMap'), {
  ssr: false,
  loading: () => <div style={{ height: 280, borderRadius: 12, background: 'rgba(13,15,18,.04)' }} />,
});

interface Props {
  coords: Array<[number, number]>;
  /** Pass "100%" to fill the parent (useful inside a stretching grid
   *  cell where the parent has a defined height). */
  height?: number | string;
}

export function RouteMapIsland({ coords, height = 300 }: Props) {
  return <RouteMap coords={coords} height={height} />;
}
