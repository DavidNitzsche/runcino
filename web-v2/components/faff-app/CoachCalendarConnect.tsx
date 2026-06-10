'use client';

/**
 * Coach calendar connect affordance · lives on the COACHED hero
 * (coached-mode v2, 2026-06-10). Collapsed link → paste field → POST
 * /api/coach-calendar → router.refresh() so the seed re-renders with
 * the coach's workouts attached.
 *
 * Connected state shows feed freshness + a quiet disconnect. Errors
 * surface verbatim from the API (they're already runner-readable:
 * "that link is not a calendar feed — copy the Calendar Sync URL").
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CoachCalendarConnect({ cal }: {
  cal: { urlSet: boolean; fetchedAt: string | null; lastError: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/coach-calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) {
        setError(j.error ?? `failed (HTTP ${r.status})`);
        return;
      }
      setOpen(false);
      setUrl('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/coach-calendar', { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const label: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: '1.4px',
    textTransform: 'uppercase', opacity: 0.62,
  };

  if (cal.urlSet) {
    const ago = cal.fetchedAt
      ? `${Math.max(0, Math.round((Date.now() - new Date(cal.fetchedAt).getTime()) / 3600000))}h ago`
      : 'pending';
    return (
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={label}>CALENDAR CONNECTED · UPDATED {ago.toUpperCase()}</span>
        {cal.lastError && (
          <span style={{ ...label, opacity: 0.85 }} title={cal.lastError}>· LAST REFRESH FAILED</span>
        )}
        <button
          type="button"
          onClick={() => { void disconnect(); }}
          disabled={busy}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            ...label, textDecoration: 'underline', opacity: 0.5,
          }}
        >
          DISCONNECT
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        data-test="coach-cal-open"
        onClick={() => setOpen(true)}
        style={{
          marginTop: 14, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          ...label, textDecoration: 'underline', textAlign: 'left',
        }}
      >
        PASTE YOUR COACH&rsquo;S CALENDAR LINK · FINAL SURGE / TRAININGPEAKS
      </button>
    );
  }

  return (
    <div style={{ marginTop: 14, maxWidth: 460 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="url"
          value={url}
          data-test="coach-cal-url"
          onChange={(e) => setUrl(e.target.value)}
          placeholder="webcal:// or https:// calendar Sync URL"
          style={{
            flex: 1, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: 10, padding: '9px 11px', color: 'inherit',
            fontFamily: 'inherit', fontSize: 12.5, outline: 'none',
          }}
        />
        <button
          type="button"
          data-test="coach-cal-save"
          onClick={() => { void connect(); }}
          disabled={busy || !url.trim()}
          style={{
            background: '#fff', color: '#0b0b0b', border: 'none', borderRadius: 10,
            padding: '9px 14px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer', opacity: busy || !url.trim() ? 0.6 : 1,
          }}
        >
          {busy ? 'CHECKING…' : 'CONNECT'}
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: 10.5, opacity: 0.55, lineHeight: 1.5 }}>
        In Final Surge: Calendar Sync → copy the Sync URL. Faff reads it · never writes back.
      </div>
      {error && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: '#ffd6dd', lineHeight: 1.45 }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
