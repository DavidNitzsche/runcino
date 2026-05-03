/**
 * Top nav — mirrors the dark Runcino design system from designs/runcino.css.
 * Tabs map to Next.js routes; pills indicate milestones not yet shipped.
 */

import Link from 'next/link';

type NavKey = 'races' | 'training' | 'retrospective' | 'research' | 'data';

const TABS: Array<{ key: NavKey; href: string; label: string; pill?: string }> = [
  { key: 'races',         href: '/races',                    label: 'Races' },
  { key: 'training',      href: '/training',                 label: 'Training',     pill: 'M3' },
  { key: 'retrospective', href: '/retrospective',            label: 'Retrospective', pill: 'M1' },
  { key: 'research',      href: '/research',                 label: 'Research' },
  { key: 'data',          href: '/settings/integrations',    label: 'Data',         pill: 'M2' },
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
      <div className="nav-r">
        <div className="nav-ic" title="Search">⌕</div>
        <div className="nav-ic" title="Notifications">◎</div>
        <div className="avatar" />
      </div>
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
