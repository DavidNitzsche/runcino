'use client';

/**
 * ActiveModeBanner — single banner that renders whichever mode is
 * active (injury, illness, race-day, race-week, race-conflict). One
 * source for all cross-page mode chrome.
 *
 * Fetches /api/coach/mode on mount. Renders null when no banner is
 * active (mode === 'active' or 'maintenance' or 'onboarding' with no
 * banner). Per spec §7 + §27 U9/U12/U13/U15.
 *
 * Render this inside app/layout.tsx so every page picks it up.
 */

import { useEffect, useState } from 'react';

interface ModeBanner {
  kind: 'active_injury' | 'active_illness' | 'race_conflict' | 'race_day' | 'race_week' | 'onboarding';
  severity: 'info' | 'warn' | 'urgent';
  headline: string;
  subline?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

interface ModeResponse {
  ok: boolean;
  mode: string;
  banner: ModeBanner | null;
}

export function ActiveModeBanner() {
  const [banner, setBanner] = useState<ModeBanner | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/coach/mode')
      .then((r) => r.json())
      .then((j: ModeResponse) => { if (!cancelled && j.ok) setBanner(j.banner); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!banner) return null;

  const bg = banner.severity === 'urgent'
    ? 'var(--warn, #E0383F)'
    : banner.severity === 'warn'
      ? 'var(--active, #F58A20)'
      : 'var(--corp, #1F3B82)';

  return (
    <div
      role="alert"
      style={{
        background: bg,
        color: '#fff',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontFamily: 'Oswald, sans-serif',
        borderBottom: '1px solid rgba(0,0,0,.12)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          lineHeight: 1.2,
        }}>{banner.headline}</div>
        {banner.subline && (
          <div style={{
            fontFamily: 'Jost, sans-serif',
            fontSize: 13,
            opacity: 0.92,
            marginTop: 2,
            lineHeight: 1.35,
          }}>{banner.subline}</div>
        )}
      </div>
      {banner.ctaLabel && banner.ctaHref && (
        <a
          href={banner.ctaHref}
          style={{
            color: '#fff',
            background: 'rgba(255,255,255,.18)',
            border: '1px solid rgba(255,255,255,.32)',
            borderRadius: 999,
            padding: '6px 14px',
            fontFamily: 'Oswald, sans-serif',
            fontSize: 11,
            letterSpacing: 1.1,
            textTransform: 'uppercase',
            fontWeight: 700,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {banner.ctaLabel}
        </a>
      )}
    </div>
  );
}
