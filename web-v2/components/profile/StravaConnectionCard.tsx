'use client';

/**
 * StravaConnectionCard — redesign per #161.
 *
 * Replaces the static "STRAVA · CONNECTED · Last sync 16h ago" row with
 * a card that exposes the push controls:
 *   - Connection status (with green dot when active)
 *   - Auto-push toggle (the headline feature)
 *   - Privacy default selector (private / followers / public)
 *   - Title format picker with live preview of the next push title
 *   - Last 3 pushes with status + retry on failed
 *
 * Reads /api/profile for current state, /api/strava/pushes for history.
 * PATCHes /api/profile for toggle / privacy / title-format changes.
 */

import { useEffect, useState } from 'react';

interface StravaPrefs {
  connected: boolean;
  lastSyncAgo?: string;
  autoPush: boolean;
  privacy: 'private' | 'followers' | 'public';
  titleFormat: 'type_phases' | 'tod_type_dist';
}

interface PushRow {
  id: number;
  run_id: string;
  status: 'pending' | 'uploaded' | 'failed' | 'duplicate';
  strava_activity_id: number | null;
  title: string | null;
  privacy: string | null;
  error_message: string | null;
  pushed_at: string;
}

export function StravaConnectionCard({ initial }: { initial: StravaPrefs }) {
  const [prefs, setPrefs] = useState<StravaPrefs>(initial);
  const [pushes, setPushes] = useState<PushRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/strava/pushes')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.pushes) setPushes(j.pushes.slice(0, 3)); })
      .catch(() => {});
  }, []);

  async function patch(field: keyof StravaPrefs, value: any) {
    const previous = (prefs as any)[field];
    setPrefs({ ...prefs, [field]: value });
    setSaving(field);
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [field === 'autoPush' ? 'strava_auto_push'
            : field === 'privacy' ? 'strava_push_privacy'
            : field === 'titleFormat' ? 'strava_push_title_format'
            : field]: value,
        }),
      });
    } catch {
      // rollback on failure
      setPrefs({ ...prefs, [field]: previous });
    } finally {
      setSaving(null);
    }
  }

  async function retryPush(runId: string) {
    setSaving(`retry-${runId}`);
    try {
      await fetch(`/api/strava/push/${encodeURIComponent(runId)}`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
      const r = await fetch('/api/strava/pushes');
      const j = await r.json().catch(() => null);
      if (j?.pushes) setPushes(j.pushes.slice(0, 3));
    } finally {
      setSaving(null);
    }
  }

  const titlePreview = prefs.titleFormat === 'tod_type_dist'
    ? 'Morning easy · 5.2 mi'
    : 'Threshold · 4×1mi @ 6:48';

  return (
    <div className="card" style={{ padding: '20px 22px' }}>
      {/* Header row: name + connected status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 24, letterSpacing: '0.4px', lineHeight: 1 }}>STRAVA</div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 4 }}>
            {prefs.connected ? `Connected${prefs.lastSyncAgo ? ` · last sync ${prefs.lastSyncAgo}` : ''}` : 'Not connected'}
          </div>
        </div>
        {prefs.connected && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--f-label)', fontSize: 11, color: 'var(--green)', letterSpacing: '1.2px',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 8px rgba(62,189,65,0.5)' }} />
            CONNECTED
          </div>
        )}
      </div>

      {prefs.connected && (
        <>
          {/* Auto-push toggle row */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 0', borderTop: '1px solid var(--line)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                Auto-push every run
              </div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 3, lineHeight: 1.5 }}>
                When on, every run pushes to Strava ~30 seconds after Faff finishes processing it.
                Manual push still works from each run's detail modal.
              </div>
            </div>
            <Toggle
              on={prefs.autoPush}
              loading={saving === 'autoPush'}
              onChange={(v) => patch('autoPush', v)}
            />
          </div>

          {/* Privacy default */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 0', borderTop: '1px solid var(--line)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                Default privacy
              </div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 3 }}>
                Visibility for pushed runs on Strava.
              </div>
            </div>
            <Segmented
              value={prefs.privacy}
              loading={saving === 'privacy'}
              options={[
                { value: 'private', label: 'PRIVATE' },
                { value: 'followers', label: 'FOLLOWERS' },
                { value: 'public', label: 'PUBLIC' },
              ]}
              onChange={(v) => patch('privacy', v)}
            />
          </div>

          {/* Title format */}
          <div style={{
            padding: '14px 0', borderTop: '1px solid var(--line)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                  Title format
                </div>
                <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 3 }}>
                  How Faff names your runs on Strava.
                </div>
              </div>
              <Segmented
                value={prefs.titleFormat}
                loading={saving === 'titleFormat'}
                options={[
                  { value: 'type_phases', label: 'WORKOUT' },
                  { value: 'tod_type_dist', label: 'TIME OF DAY' },
                ]}
                onChange={(v) => patch('titleFormat', v as any)}
              />
            </div>
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.025)',
              fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)',
            }}>
              <span style={{ color: 'var(--dim)' }}>Next push will be titled: </span>
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{titlePreview}</span>
            </div>
          </div>

          {/* Recent pushes */}
          {pushes.length > 0 && (
            <div style={{ padding: '14px 0 0', borderTop: '1px solid var(--line)' }}>
              <div className="card-eyebrow" style={{ color: 'var(--mute)', marginBottom: 10 }}>RECENT PUSHES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pushes.map((p) => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.02)',
                    fontFamily: 'var(--f-body)', fontSize: 12,
                  }}>
                    <StatusDot status={p.status} />
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.title ?? p.run_id}
                    </div>
                    <span style={{
                      fontFamily: 'var(--f-label)', fontSize: 9, letterSpacing: '1px',
                      color: statusColor(p.status),
                    }}>{p.status.toUpperCase()}</span>
                    {p.status === 'failed' && (
                      <button
                        onClick={() => retryPush(p.run_id)}
                        disabled={saving === `retry-${p.run_id}`}
                        style={{
                          background: 'transparent', border: '1px solid rgba(252,77,100,0.4)',
                          color: 'var(--over)', borderRadius: 6,
                          padding: '3px 8px',
                          fontFamily: 'var(--f-label)', fontSize: 9, letterSpacing: '1px',
                          cursor: saving ? 'wait' : 'pointer',
                        }}
                      >
                        {saving === `retry-${p.run_id}` ? '…' : 'RETRY'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Toggle({ on, loading, onChange }: { on: boolean; loading: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => !loading && onChange(!on)}
      disabled={loading}
      style={{
        width: 44, height: 26, borderRadius: 999,
        background: on ? 'var(--green)' : 'rgba(255,255,255,0.12)',
        border: 'none',
        position: 'relative',
        cursor: loading ? 'wait' : 'pointer',
        transition: 'background .15s',
        opacity: loading ? 0.6 : 1,
        padding: 0, flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3, left: on ? 21 : 3,
        width: 20, height: 20, borderRadius: '50%',
        background: '#fff',
        transition: 'left .15s',
      }} />
    </button>
  );
}

function Segmented<T extends string>({ value, options, loading, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  loading: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{
      display: 'inline-flex',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: 8, padding: 2,
      opacity: loading ? 0.6 : 1,
    }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !loading && opt.value !== value && onChange(opt.value)}
            disabled={loading}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: active ? 'var(--green)' : 'transparent',
              color: active ? '#0e1014' : 'var(--ink)',
              fontFamily: 'var(--f-label)',
              fontSize: 10, fontWeight: 700, letterSpacing: '1px',
              cursor: loading ? 'wait' : 'pointer',
              transition: 'background .12s, color .12s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: PushRow['status'] }) {
  const c = statusColor(status);
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />;
}

function statusColor(s: PushRow['status']): string {
  switch (s) {
    case 'uploaded':  return 'var(--green)';
    case 'pending':   return 'var(--goal)';
    case 'duplicate': return 'var(--mute)';
    case 'failed':    return 'var(--over)';
    default:          return 'var(--mute)';
  }
}
