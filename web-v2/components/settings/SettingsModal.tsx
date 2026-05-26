'use client';

/**
 * SettingsModal — opens settings as an overlay instead of routing to /settings.
 * Trigger lives in the TopNav avatar. Same opaque-card pattern as the other
 * modals (run detail, learn, readiness).
 */
import { useEffect, useState } from 'react';
import { SettingsForm } from './SettingsForm';
import type { UserSettings } from '@/lib/coach/settings';

export function SettingsAvatarTrigger({ initials = 'DN' }: { initials?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Settings"
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--learn), var(--race))',
          color: '#1a0f33', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--f-display)', fontSize: 14,
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
  const [data, setData] = useState<UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/settings')
      .then((r) => r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error ?? 'load failed'); }))
      .then((d) => { if (mounted) setData(d); })
      .catch((e) => { if (mounted) setError(e.message ?? String(e)); });
    return () => { mounted = false; };
  }, []);

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
