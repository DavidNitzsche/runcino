/**
 * Topbar, page-top navigation band.
 *
 * Anatomy: optional BACK button · italic-gradient faff.run wordmark
 * (replaces the legacy single-letter brand mark) · tab row · clock /
 * sign-out menu.
 *
 * Tabs: Overview · Training · Races · Health · Log · Profile.
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
  /** Hide the brand mark entirely (rare, used on the very first onboarding screen). */
  hideBrand?: boolean;
  /** If true, appends a small "Admin" link at the end of the tab row. Render this only for admin users. */
  showAdmin?: boolean;
  /** Optional user prop (name/email) used by some standalone pages (e.g. /admin). Ignored on tabbed pages. */
  user?: { name?: string; email?: string };
}

// Tab labels: "Today" reads more honestly than "Overview" — the page
// is about today's run + this week. Training is the macro arc (phase,
// trajectory, build). Route paths stay as /overview etc so existing
// links don't break.
const TAB_LABELS: Record<TopbarTab, string> = {
  overview: 'Today',
  training: 'Training',
  races:    'Races',
  health:   'Health',
  log:      'Log',
  profile:  'Profile',
};

const TAB_HREFS: Record<TopbarTab, string> = {
  overview: '/overview',
  training: '/training',
  races:    '/races',
  health:   '/health',
  log:      '/log',
  profile:  '/profile',
};

export function Topbar({ activeTab, back, clock, hideBrand = false, showAdmin = false }: TopbarProps) {
  return (
    <div className="topbar">
      {back && (
        <a className="page-back" href={back.href}>
          ← {back.label ?? 'BACK'}
        </a>
      )}
      {!hideBrand && !back && (
        <a className="faff-topbar-logo" href="/overview">faff.run</a>
      )}
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
        {showAdmin && (
          <a
            className="topbar-tab topbar-tab-admin"
            href="/admin"
            role="tab"
            title="Private-beta gatekeeper"
            style={{ color: '#C73E0B' }}
          >
            Admin
          </a>
        )}
      </div>
      {clock !== undefined && <div className="clock">{clock}</div>}
    </div>
  );
}
