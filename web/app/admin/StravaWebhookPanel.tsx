'use client';

/**
 * Strava webhook control panel on /admin.
 *
 * Lets an admin: see the current subscription state, register a new
 * subscription pointing at this deploy's /api/strava/webhook, or tear
 * down the existing subscription.
 *
 * Strava only allows ONE active subscription per app. Registering when
 * one exists tears down the old one first.
 */

import { useEffect, useState } from 'react';

interface Subscription {
  id: number;
  callback_url: string;
  created_at?: string;
}

interface PanelState {
  callbackUrl?: string;
  verifyToken?: string;
  subscriptions?: Subscription[];
  error?: string;
}

export function StravaWebhookPanel() {
  const [state, setState] = useState<PanelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/strava-webhook');
      const j = await res.json();
      if (res.ok) setState(j);
      else setState({ error: j?.error || `Strava lookup failed (${res.status})` });
    } catch {
      setState({ error: 'Network error contacting /api/admin/strava-webhook' });
    }
  }
  useEffect(() => { load(); }, []);

  async function subscribe() {
    if (busy) return;
    setBusy(true);
    setMsg('Registering subscription…');
    try {
      const res = await fetch('/api/admin/strava-webhook', { method: 'POST' });
      const j = await res.json();
      if (res.ok) {
        setMsg('Subscribed. Strava will now push activity events to /api/strava/webhook.');
      } else {
        setMsg(`Subscribe failed: ${j?.error || res.status}${j?.response ? ' — ' + JSON.stringify(j.response) : ''}`);
      }
      await load();
    } catch (e) {
      setMsg(`Network error: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    if (busy) return;
    if (!confirm('Tear down the Strava webhook subscription? Real-time activity sync will stop until you re-subscribe.')) return;
    setBusy(true);
    setMsg('Removing subscription…');
    try {
      const res = await fetch('/api/admin/strava-webhook', { method: 'DELETE' });
      const j = await res.json();
      setMsg(res.ok ? `Removed ${j.removed?.length ?? 0} subscription(s).` : `Delete failed: ${j?.error || res.status}`);
      await load();
    } catch (e) {
      setMsg(`Network error: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <div className="admin-empty">Loading…</div>;
  if (state.error) return <div className="admin-empty" style={{ color: '#FC4D64' }}>{state.error}</div>;

  const active = state.subscriptions ?? [];
  const isActive = active.length > 0;

  return (
    <div style={{ padding: '20px 24px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span
          style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: 999,
            background: isActive ? '#3EBD41' : '#FC4D64',
          }}
        />
        <span style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 600 }}>
          {isActive ? 'Active' : 'Not subscribed'}
        </span>
        {isActive && <span style={{ color: 'rgba(13,15,18,.55)', fontSize: 13 }}>· {active.length} subscription{active.length === 1 ? '' : 's'}</span>}
      </div>

      <div style={{ display: 'grid', gap: 4, marginBottom: 16, fontSize: 12, color: 'rgba(13,15,18,.55)' }}>
        <div><strong style={{ color: '#0D0F12' }}>Callback URL:</strong> {state.callbackUrl}</div>
        <div><strong style={{ color: '#0D0F12' }}>Verify token:</strong> <code style={{ background: 'rgba(13,15,18,.05)', padding: '1px 6px', borderRadius: 4 }}>{state.verifyToken}</code></div>
        {active.map((s) => (
          <div key={s.id}>
            <strong style={{ color: '#0D0F12' }}>Strava sub #{s.id}:</strong> {s.callback_url}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="admin-btn admin-btn-approve"
          onClick={subscribe}
          disabled={busy}
        >
          {isActive ? 'Re-register' : 'Register webhook'}
        </button>
        {isActive && (
          <button type="button" className="admin-btn admin-btn-deny" onClick={unsubscribe} disabled={busy}>
            Unsubscribe
          </button>
        )}
      </div>

      {msg && <div style={{ marginTop: 12, fontSize: 13, color: 'rgba(13,15,18,.65)' }}>{msg}</div>}

      <p style={{ marginTop: 18, fontSize: 12, color: 'rgba(13,15,18,.45)', lineHeight: 1.5 }}>
        Once registered, Strava pushes a webhook to <code>/api/strava/webhook</code> whenever any
        connected athlete posts, updates, or deletes a run. The handler refreshes only the
        affected activity — no polling, no waiting. Set <code>STRAVA_WEBHOOK_VERIFY_TOKEN</code> in
        Railway env if you want to override the default shared secret.
      </p>
    </div>
  );
}
