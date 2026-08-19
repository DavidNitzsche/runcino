'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@/components/redesign/core/Icon';

/**
 * components/redesign/nav/Rail.tsx
 *
 * The persistent web navigation, per this project's own design brief
 * (designs/design-review-0818/guidelines/navigation.html — "Navigation":
 * "Three places you can be and one thing you can do... On web it is a
 * rail."). Not ported from a coded component — the handoff's only coded
 * nav primitive, SurfaceNav.jsx, is explicitly documented as "the phone's
 * navigation" (bottom tab bar); the rail exists only as a CSS/HTML
 * specimen in the guideline doc (`.rail`/`.railitem` classes + the exact
 * five-item markup: Today, Activity, Block, Season, Log a run). This file
 * reconstructs that exact specimen as a real, routed component — same
 * classes, same icons (Lucide sun/list/grid/flag/plus, vendored at
 * public/redesign/icons/), same "Log a run pinned right via margin-left:
 * auto" layout.
 *
 * Five items, matching the guideline's Level 1 surfaces exactly:
 *   Today (sun) · Activity (list) · Block (grid) · Season (flag) ·
 *   Log a run (plus) — the verb, not a destination: "It is a button in
 *   the bar, not a fourth destination" (guideline), so it's wired to
 *   `onLogRun` (opens the Log Sheet as an overlay) rather than a Link.
 *
 * Settings has no rail slot in the guideline's own specimen ("Settings —
 * Account and units. Off Today, over whatever you were reading" — reached
 * FROM a surface, not a Level-1 destination). A small settings-gear
 * IconButton is appended after Log a run so it stays "reachable from
 * every surface" (guideline) without inventing a sixth rail destination
 * the design doc doesn't specify.
 *
 * Log a run / Settings are plain route pushes to /runs/new and /me, not
 * client-state overlays — both of those screens already self-wrap in the
 * shared <Sheet> shell (LogSheetClient, SettingsClient's non-Sheet
 * full-page exception noted in its own file) and manage their own
 * close-via-router.back()/push() behavior, so navigating to their real
 * route already reads as "a sheet arrives" per
 * the design brief, stays addressable ("a run, a week, a race each have
 * a URL" — guideline), and needed no new overlay-state plumbing.
 */

const ITEMS = [
  { id: 'today', href: '/today', label: 'Today', icon: 'sun' },
  { id: 'activity', href: '/log', label: 'Activity', icon: 'list' },
  { id: 'block', href: '/training', label: 'Block', icon: 'grid' },
  { id: 'season', href: '/goal', label: 'Season', icon: 'flag' },
] as const;

export function Rail() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div
      style={{
        display: 'flex', gap: 'var(--sp-7)', alignItems: 'center', flexWrap: 'wrap',
        background: 'var(--material-tile)', borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--elevation-flat)', padding: 'var(--sp-7)',
        margin: 'var(--sp-7) var(--sp-9) 0',
      }}
    >
      {ITEMS.map((it) => {
        const active = pathname === it.href || pathname?.startsWith(it.href + '/');
        return (
          <Link
            key={it.id}
            href={it.href}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 44,
              borderRadius: 'var(--radius-pill)', textDecoration: 'none',
              fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
              letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
              color: active ? 'var(--text-primary)' : 'var(--text-quiet)',
              background: active ? 'var(--surface-2)' : 'transparent',
            }}
          >
            <Icon name={it.icon} size={20} />
            {it.label}
          </Link>
        );
      })}
      <button
        onClick={() => router.push('/runs/new')}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 44, marginLeft: 'auto',
          borderRadius: 'var(--radius-pill)', border: 0, cursor: 'pointer', background: 'transparent',
          fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
          letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
        }}
      >
        <Icon name="plus" size={20} />
        Log a run
      </button>
      <button
        onClick={() => router.push('/me')}
        aria-label="Settings"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40,
          borderRadius: 'var(--radius-pill)', border: 0, cursor: 'pointer', background: 'transparent',
          color: 'var(--text-quiet)',
        }}
      >
        <Icon name="settings" size={20} />
      </button>
    </div>
  );
}
