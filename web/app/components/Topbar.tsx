/**
 * Topbar — page-top navigation band.
 *
 * Anatomy: optional BACK button · brand mark · tab row · clock.
 * Tabs are: Overview · Training · Races · Health · Log · Profile.
 *
 * The Topbar is the canonical primitive at the top of every May 2026 page.
 * It owns the page back-nav (when on a detail view), the tab nav, and the
 * clock. The clock can either show the real time (default) or any string
 * supplied by the caller.
 */

import type { ReactNode } from 'react';

export type TopbarTab = 'overview' | 'training' | 'races' | 'health' | 'log' | 'profile';

export interface TopbarProps {
  /** Active tab key. Pass null/undefined on a detail view where no tab is selected. */
  activeTab?: TopbarTab | null;
  /** When provided, renders a "← BACK" button left of the brand. */
  back?: { href: string; label?: string };
  /** Right-side clock content. Default: hidden. */
  clock?: ReactNode;
  /** Override which brand glyph appears in the mark. Default: "R". */
  brandGlyph?: string;
  /** Hide the brand mark entirely (rare — used on the very first onboarding screen). */
  hideBrand?: boolean;
}

const TAB_LABELS: Record<TopbarTab, string> = {
  overview: 'Overview',
  training: 'Training',
  races:    'Races',
  health:   'Health',
  log:      'Log',
  profile:  'Profile',
};

const TAB_HREFS: Record<TopbarTab, string> = {
  overview: '/',
  training: '/training',
  races:    '/races',
  health:   '/health',
  log:      '/log',
  profile:  '/profile',
};

export function Topbar({ activeTab, back, clock, brandGlyph = 'R', hideBrand = false }: TopbarProps) {
  return (
    <div className="topbar">
      {back && (
        <a className="page-back" href={back.href}>
          ← {back.label ?? 'BACK'}
        </a>
      )}
      {!hideBrand && !back && <div className="brand">{brandGlyph}</div>}
      <div className="topbar-tabs" role="tablist">
        {(Object.keys(TAB_LABELS) as TopbarTab[]).map((key) => (
          <a
            key={key}
            className={`topbar-tab${activeTab === key ? ' active' : ''}`}
            href={TAB_HREFS[key]}
            role="tab"
            aria-selected={activeTab === key}
          >
            {TAB_LABELS[key]}
          </a>
        ))}
      </div>
      {clock !== undefined && <div className="clock">{clock}</div>}
    </div>
  );
}
