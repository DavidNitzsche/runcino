'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FaffSeed, ViewKey } from './types';

/** ISO week number (1-53). Mirrors Shell.tsx so the chip's dismissal key
 *  matches the auto-open modal's. */
function isoWeekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const TABS: Array<{ k: ViewKey; href: string; label: string; icon: React.ReactNode }> = [
  { k: 'today',    href: '/today',    label: 'Today',    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8M5 10v10h14V10"/></svg> },
  { k: 'train',    href: '/training', label: 'Train',    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-6 4 3 5-8 4 5"/></svg> },
  { k: 'health',   href: '/health',   label: 'Health',   icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2 5 4-12 2 7h6"/></svg> },
  { k: 'targets',  href: '/races',    label: 'Goal',     icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg> },
  { k: 'activity', href: '/log',      label: 'Activity', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5M9 19V9M14 19v-6M19 19V7"/></svg> },
];

export function Sidebar({
  seed, active, onNav, collapsed, onToggleCollapse, onOpenUpsell, onOpenRecap,
}: {
  seed: FaffSeed;
  active: ViewKey;
  onNav: (v: ViewKey) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenUpsell: () => void;
  onOpenRecap: () => void;
}) {
  // 2026-05-30: Week Recap chip only surfaces on Monday — the week closes
  // after Sunday's long run, recap appears Monday morning. Stash a per-ISO-
  // week dismissal flag in localStorage so tapping it (or auto-open) hides
  // the chip for the rest of the week. Matches the auto-open key in Shell.tsx.
  const [showRecap, setShowRecap] = useState(false);
  useEffect(() => {
    const now = new Date();
    if (now.getDay() !== 1) { setShowRecap(false); return; }   // Monday only
    try {
      const key = `faffWeekRecap-${now.getFullYear()}-W${isoWeekNumber(now)}`;
      setShowRecap(!localStorage.getItem(key));
    } catch {
      setShowRecap(true);
    }
  }, []);
  function handleOpenRecap() {
    onOpenRecap();
    // Tapping the chip dismisses it for the week (same key the auto-open uses).
    try {
      const now = new Date();
      const key = `faffWeekRecap-${now.getFullYear()}-W${isoWeekNumber(now)}`;
      localStorage.setItem(key, '1');
    } catch { /* SSR / private mode safe */ }
    setShowRecap(false);
  }
  return (
    <aside className="side">
      <div className="panel">
        <div className="sb-head">
          <div className="brandmark">Faff<span className="bdot"></span>Run</div>
          <button className="sb-toggle" onClick={onToggleCollapse} aria-label="Collapse sidebar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
          </button>
        </div>

        <nav className="nav">
          {TABS.map(t => (
            <Link
              key={t.k}
              href={t.href}
              className={t.k === active ? 'on' : ''}
              onClick={(e) => { e.preventDefault(); onNav(t.k); }}
            >
              <span className="ic">{t.icon}</span>
              <span className="lbl">{t.label}</span>
            </Link>
          ))}
        </nav>

        {showRecap && (
          <button className="sb-recap" onClick={handleOpenRecap}>
            <span className="dot" />
            <span className="tx">
              {/* The chip recaps LAST week (the one that just closed), so the
                  label points back, not at the in-progress nowIdx week. */}
              <span className="el">WEEK {Math.max(1, seed.season.nowIdx)} RECAP</span>
              <span className="et">Ready to review</span>
            </span>
            <span className="arr">›</span>
          </button>
        )}

        <div className="spacer" />

        {/* 2026-05-31 (David call): Upgrade-to-Pro upsell removed from the
            sidebar. Billing isn't wired and the upsell modal didn't
            actually upgrade anything, so it was honest-only chrome on
            the sidebar of a single-user beta. If real billing ships, the
            block goes back in here, gated on `!seed.user.pro`. The
            onOpenUpsell prop is still threaded through the Shell so the
            modal can be opened from elsewhere (e.g. Profile) if needed. */}

        <div className="me" style={{ cursor: 'pointer' }} onClick={() => onNav('profile')}>
          <div className="av">{seed.user.initial}</div>
          <div className="nm">{seed.user.name}<small>{seed.user.city}</small></div>
          <div className="gear">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </div>
          {/* 2026-06-10 (David: "no way to sign out") · revokes the
              session server-side, clears the cookie, lands on /login.
              stopPropagation so the chip's profile-nav doesn't fire. */}
          <div
            className="gear"
            title="Sign out"
            role="button"
            data-test="sign-out"
            onClick={(e) => {
              e.stopPropagation();
              void fetch('/api/auth/logout', { method: 'POST' })
                .catch(() => {})
                .finally(() => { window.location.href = '/login'; });
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
        </div>
      </div>
    </aside>
  );
}
