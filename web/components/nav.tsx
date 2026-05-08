/**
 * Top nav — mirrors the dark Runcino design system from designs/runcino.css.
 * Tabs map to Next.js routes; pills indicate milestones not yet shipped.
 */

import Link from 'next/link';

type NavKey = 'overview' | 'today' | 'training' | 'library' | 'races' | 'season' | 'calibration' | 'research' | 'health' | 'log' | 'profile';

const TABS: Array<{ key: NavKey; href: string; label: string; pill?: string }> = [
  { key: 'today',       href: '/today',        label: 'Today' },
  { key: 'overview',    href: '/',             label: 'Overview' },
  { key: 'training',    href: '/training',     label: 'Training' },
  { key: 'library',     href: '/library',      label: 'Library' },
  { key: 'races',       href: '/races',        label: 'Races' },
  { key: 'season',      href: '/season',       label: 'Season' },
  { key: 'calibration', href: '/calibration',  label: 'Calibration' },
  { key: 'research',    href: '/research',     label: 'Research' },
  { key: 'health',      href: '/health',       label: 'Health' },
  { key: 'log',         href: '/log',          label: 'Log' },
  { key: 'profile',     href: '/profile',      label: 'Profile' },
];

export function Nav({ active }: { active?: NavKey }) {
  return (
    <div className="nav">
      <div className="nav-l">
        <Link href="/races" className="brand">R</Link>
        <div className="tabs">
          {TABS.map(t => (
            <Link
              key={t.key}
              href={t.href}
              className={`tab${t.key === active ? ' active' : ''}`}
            >
              {t.label}
              {t.pill && (
                <span style={{
                  marginLeft: 6,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'var(--color-l3)',
                  color: 'var(--color-t3)',
                  fontFamily: 'var(--font-data)',
                  fontSize: 8.5,
                  letterSpacing: '1.2px',
                  fontWeight: 700,
                }}>{t.pill}</span>
              )}
            </Link>
          ))}
        </div>
      </div>
      {/* Right-side icons (search / notifications / avatar) lived
          here in the design mockup but were inert decorations — no
          click handlers, no functionality. Removed until each one has
          a real job: search across runs/races, notifications for
          race-week reminders + sync status, avatar for auth. */}
    </div>
  );
}

export function Caption({ left, right }: { left?: string; right?: string }) {
  return (
    <div className="caption">
      <span>{left ?? 'Runcino · localhost'}</span>
      <b>{right ?? 'v0.1 · M0'}</b>
    </div>
  );
}

