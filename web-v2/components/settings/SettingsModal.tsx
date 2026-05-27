'use client';

/**
 * SettingsModal — opens settings as an overlay instead of routing to /settings.
 * Trigger lives in the TopNav avatar. Same opaque-card pattern as the other
 * modals (run detail, learn, readiness).
 *
 * Snappiness: settings is fetched once via a module-scope shared cache.
 * Both triggers (avatar + link) prefetch on hover/focus AND on mount, so
 * by the time the user clicks, the data is already there. The cache
 * survives close/reopen cycles for the whole session.
 */
import { useEffect, useState } from 'react';
import { SettingsForm } from './SettingsForm';
import type { UserSettings } from '@/lib/coach/settings';

// Shared module-scope cache. Single source of truth for the modal payload.
let cachedSettings: UserSettings | null = null;
let inflight: Promise<UserSettings | null> | null = null;
function prefetchSettings(): Promise<UserSettings | null> {
  if (cachedSettings) return Promise.resolve(cachedSettings);
  if (inflight) return inflight;
  inflight = fetch('/api/settings')
    .then((r) => r.ok ? r.json() : null)
    .then((d) => { if (d) cachedSettings = d; inflight = null; return d; })
    .catch(() => { inflight = null; return null; });
  return inflight;
}

export function SettingsAvatarTrigger({ initials = 'DN' }: { initials?: string }) {
  const [open, setOpen] = useState(false);
  // Avatar is always visible in TopNav, so this is effectively an
  // app-wide warm-up of /api/settings on every page load. Cheap.
  useEffect(() => { prefetchSettings(); }, []);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        onMouseEnter={() => prefetchSettings()}
        onFocus={() => prefetchSettings()}
        aria-label="Settings"
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--learn), var(--race))',
          color: '#1a0f33', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--f-label)', fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {initials}
      </button>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

/** Inline "EDIT →" link trigger — used in section headers + anywhere else
 *  we want to pop the settings modal without an avatar. */
export function SettingsLinkTrigger({ children = 'EDIT →' }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        onMouseEnter={() => prefetchSettings()}
        onFocus={() => prefetchSettings()}
        style={{
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--learn)', fontFamily: 'var(--f-body)',
          fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit',
        }}>
        {children}
      </button>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  // Seed synchronously from the shared cache so first paint is complete
  // when the cache is warm (which it will be after any hover/focus or
  // page load where TopNav rendered).
  const [data, setData] = useState<UserSettings | null>(cachedSettings);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) return;
    let mounted = true;
    prefetchSettings().then((d) => {
      if (!mounted) return;
      if (d) setData(d);
      else setError('load failed');
    });
    return () => { mounted = false; };
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.78)', backdropFilter: 'blur(10px)',
        zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 32,
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#181a1d', border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)', borderRadius: 20,
          padding: '32px 36px', maxWidth: 720, width: '100%', marginTop: 40, marginBottom: 60,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 44, letterSpacing: '0.5px', margin: 0, color: 'var(--ink)', lineHeight: 1 }}>
              Settings.
            </h2>
            <div style={{ color: 'var(--mute)', fontSize: 14, marginTop: 8 }}>
              Notifications, units, integrations, account.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--mute)', fontSize: 26, cursor: 'pointer', lineHeight: 1,
          }} aria-label="Close">×</button>
        </div>

        {error && (
          <div style={{ padding: '14px 0', color: 'var(--over)', fontSize: 13 }}>{error}</div>
        )}
        {!data && !error && (
          <div style={{ padding: '40px 0', color: 'var(--mute)', fontSize: 13, fontStyle: 'italic' }}>Loading…</div>
        )}
        {data && <SettingsForm initial={data} />}
      </div>
    </div>
  );
}
