'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SettingsAvatarTrigger } from '@/components/settings/SettingsModal';

// Paper-overhaul 2026-05-29 · collapsed 7 tabs → 3 (TODAY / PLAN / ME).
// Races fold into PLAN (race-destination path), health into the /today
// body chips, log into a ME sub-page. The legacy routes still resolve by
// URL — they're just no longer in the top nav.
const TABS = [
  { href: '/today', label: 'TODAY' },
  { href: '/plan',  label: 'PLAN' },
  { href: '/me',    label: 'ME' },
];

export function TopNav({ avatarInitials = 'DN' }: { avatarInitials?: string }) {
  const pathname = usePathname();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 40, padding: '20px 40px 0' }}>
      <Link href="/today" style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)', letterSpacing: '1.2px' }}>
        faff
      </Link>
      <div style={{ display: 'flex', gap: 28, flex: 1 }}>
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                fontFamily: 'var(--f-label)',
                fontSize: 15,
                color: active ? 'var(--green)' : 'var(--mute)',
                letterSpacing: '1.4px',
                padding: '6px 0',
                borderBottom: active ? '2px solid var(--green)' : '2px solid transparent',
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <SettingsAvatarTrigger initials={avatarInitials} />
    </div>
  );
}
