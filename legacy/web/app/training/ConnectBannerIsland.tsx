'use client';

/**
 * Tiny client island that fetches /api/connectors and conditionally
 * renders ConnectBanner. The parent /training page is a server
 * component (no client state allowed) so the connector check has to
 * live in its own client leaf.
 */

import { useEffect, useState } from 'react';
import { ConnectBanner } from '@/app/components/v4';

const ACTIVITY = new Set(['strava','garmin','apple_health','coros','polar','suunto','wahoo','google_fit']);

export function ConnectBannerIsland() {
  const [hasSource, setHasSource] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/connectors').then((r) => r.json()).then((j) => {
      setHasSource((j?.connectors || []).some((c: { provider: string }) => ACTIVITY.has(c.provider)));
    }).catch(() => setHasSource(false));
  }, []);
  if (hasSource !== false) return null;
  return <ConnectBanner />;
}
