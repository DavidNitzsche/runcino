'use client';

/**
 * /profile · Connectors card.
 *
 * Source-of-truth for what activity sources / coach platforms / recovery
 * wearables the user has connected. Reads /api/connectors. Matches the
 * design in designs/profile-v4.html §CONNECTORS.
 *
 * Layout:
 *   - Card header with title + sub + connected-count meta
 *   - Section: Connected (full-width rows with action buttons)
 *   - Section: Manual entry + GPX upload (always-on / coming-soon)
 *   - Section: Coming soon · activity sources (compact pill row)
 *   - Section: Coach plan platforms · planned (compact pill row)
 *   - Section: Recovery + sleep signal (compact pill row)
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardLabel, CardPin } from '@/app/components';

interface ConnectorRow {
  provider: string;
  provider_user_id: string | null;
  connected_at: string;
  disconnected_at: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  activities_count: number;
}

const PROVIDER_INFO: Record<string, { name: string; glyph: string; color: string; cls: string }> = {
  strava:         { name: 'Strava',         glyph: 'S',   color: '#FC4C02', cls: 'strava' },
  garmin:         { name: 'Garmin Connect', glyph: 'G',   color: '#000000', cls: 'garmin' },
  apple_health:   { name: 'Apple Health',   glyph: '♥',   color: '#FB264E', cls: 'apple' },
  coros:          { name: 'Coros',          glyph: 'C',   color: '#FF4D00', cls: 'coros' },
  polar:          { name: 'Polar Flow',     glyph: 'P',   color: '#C8102E', cls: 'polar' },
  suunto:         { name: 'Suunto App',     glyph: 'S',   color: '#003B5C', cls: 'suunto' },
  wahoo:          { name: 'Wahoo Fitness',  glyph: 'W',   color: '#00A0DC', cls: 'wahoo' },
  google_fit:     { name: 'Google Fit',     glyph: 'GF',  color: '#4285F4', cls: 'gfit' },
  final_surge:    { name: 'Final Surge',    glyph: 'F',   color: '#0088CC', cls: 'fs' },
  training_peaks: { name: 'TrainingPeaks',  glyph: 'TP',  color: '#E32D2D', cls: 'tp' },
  whoop:          { name: 'Whoop',          glyph: 'W',   color: '#000000', cls: 'whoop' },
  oura:           { name: 'Oura Ring',      glyph: 'O',   color: '#1A1A1A', cls: 'oura' },
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function ConnectorsCard() {
  const [connectors, setConnectors] = useState<ConnectorRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [writeback, setWriteback] = useState<boolean | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/connectors');
      const j = await res.json();
      setConnectors(j.connectors || []);
    } catch {
      setConnectors([]);
    }
  }

  async function loadWriteback() {
    try {
      const res = await fetch('/api/profile/writeback');
      const j = await res.json();
      setWriteback(!!j.enabled);
    } catch { setWriteback(true); }
  }

  useEffect(() => { load(); loadWriteback(); }, []);

  async function toggleWriteback() {
    const next = !writeback;
    setWriteback(next);
    try {
      await fetch('/api/profile/writeback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    } catch {
      setWriteback(!next); // revert
    }
  }

  async function disconnect(provider: string) {
    if (!confirm(`Disconnect ${PROVIDER_INFO[provider]?.name || provider}? Your run history stays — re-connect any time to resume syncing.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/connectors/${provider}/disconnect`, { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function syncStrava() {
    if (busy) return;
    setBusy(true);
    setSyncMsg('Syncing…');
    try {
      const res = await fetch('/api/strava/sync-me', { method: 'POST' });
      const j = await res.json();
      if (!res.ok) {
        if (j?.needsReconnect) {
          setSyncMsg('Token expired — reconnect Strava');
        } else {
          setSyncMsg(j?.error || 'Sync failed');
        }
      } else {
        setSyncMsg(`Synced · ${j.totalAfter} activities`);
        await load();
        // Hard reload after a beat so /log and /overview re-read activities.
        setTimeout(() => { window.location.reload(); }, 500);
      }
    } catch {
      setSyncMsg('Network error');
    } finally {
      setBusy(false);
    }
  }

  const isLoaded = connectors !== null;
  const connectedSet = new Set((connectors || []).map((c) => c.provider));
  const stravaConn = (connectors || []).find((c) => c.provider === 'strava');

  return (
    <Card span={12}>
      <CardHeader>
        <CardLabel>CONNECTORS · WHERE YOUR DATA COMES IN</CardLabel>
        <CardPin variant={connectedSet.has('strava') ? 'green' : 'muted'}>
          {(connectors || []).length} CONNECTED · 1 ALWAYS-ON
        </CardPin>
      </CardHeader>

      <div className="faff-conn-body">

        <div className="faff-conn-section-label">Connected</div>

        {/* Strava row — either connected (with sync info + disconnect) or
            available (with connect button). */}
        {stravaConn ? (
          <>
          <div className="faff-conn-row connected">
            <div className="faff-conn-icon strava">S</div>
            <div>
              <div className="faff-conn-name">Strava</div>
              <div className="faff-conn-meta">
                <span className="faff-dot green" />
                <strong>Syncing</strong> · last sync {timeAgo(stravaConn.last_sync_at)}
                {stravaConn.activities_count > 0 && <> · <strong>{stravaConn.activities_count}</strong> activities pulled</>}
                {syncMsg && <> · <em>{syncMsg}</em></>}
              </div>
            </div>
            <div className="faff-conn-actions">
              <button className="faff-conn-btn" type="button" disabled={busy} onClick={syncStrava}>{busy ? 'Syncing…' : 'Sync now'}</button>
              <button className="faff-conn-btn danger" type="button" disabled={busy} onClick={() => disconnect('strava')}>Disconnect</button>
            </div>
          </div>
          {/* Writeback toggle — auto-names Strava activities to match the planned workout */}
          <div className="faff-conn-subrow">
            <label className="faff-writeback-toggle">
              <input
                type="checkbox"
                checked={writeback === null ? true : writeback}
                disabled={writeback === null}
                onChange={toggleWriteback}
              />
              <span>
                <strong>Auto-name Strava activities</strong>
                <span className="faff-writeback-sub">When you post a run that matches a planned workout, faff.run renames the Strava activity (e.g. <em>“Threshold · Cruise Intervals · Base Week 2”</em>) and adds the plan/actual breakdown to the description. Skips races and anything you&rsquo;ve manually named.</span>
              </span>
            </label>
          </div>
          </>
        ) : (
          <div className="faff-conn-row">
            <div className="faff-conn-icon strava">S</div>
            <div>
              <div className="faff-conn-name">Strava</div>
              <div className="faff-conn-meta">
                <span className="faff-dot amber" />
                Not connected · we backfill your full activity history on first connect
              </div>
            </div>
            <div className="faff-conn-actions">
              <a className="faff-conn-btn primary" href="/api/strava/connect">Connect Strava</a>
            </div>
          </div>
        )}

        {/* Always-on entries */}
        <div className="faff-conn-row">
          <div className="faff-conn-icon manual">✎</div>
          <div>
            <div className="faff-conn-name">Manual entry</div>
            <div className="faff-conn-meta">
              <span className="faff-dot green" />Always on · log runs from /log when you want
            </div>
          </div>
          <div className="faff-conn-actions">
            <Link className="faff-conn-btn" href="/log">Open log →</Link>
          </div>
        </div>

        <div className="faff-conn-row">
          <div className="faff-conn-icon gpx">GPX</div>
          <div>
            <div className="faff-conn-name">GPX / FIT upload</div>
            <div className="faff-conn-meta">
              <span className="faff-dot amber" />Soon · upload a watch export to backfill or correct a missing run
            </div>
          </div>
          <div className="faff-conn-actions">
            <button className="faff-conn-btn" disabled>Notify me</button>
          </div>
        </div>

        {/* Compact future-connectors */}
        <div className="faff-conn-section-label">Coming soon · activity sources</div>
        <div className="faff-conn-pills">
          {['apple_health','garmin','coros','polar','suunto','wahoo','google_fit'].map((p) => (
            <FuturePill key={p} provider={p} status={p === 'apple_health' || p === 'garmin' ? 'soon' : 'planned'} statusLabel={p === 'apple_health' ? 'iOS app' : p === 'garmin' ? 'Soon' : 'Planned'} />
          ))}
        </div>

        <div className="faff-conn-section-label">Coach plan platforms · plan-source mode</div>
        <div className="faff-conn-pills">
          <FuturePill provider="final_surge" status="planned" statusLabel="Planned" />
          <FuturePill provider="training_peaks" status="planned" statusLabel="Planned" />
        </div>

        <div className="faff-conn-section-label">Recovery + sleep signal</div>
        <div className="faff-conn-pills">
          <FuturePill provider="whoop" status="planned" statusLabel="Planned" />
          <FuturePill provider="oura" status="planned" statusLabel="Planned" />
        </div>

        {!isLoaded && (
          <div className="faff-conn-loading">Loading connector status…</div>
        )}
      </div>

      <style jsx>{`
        .faff-conn-body { padding: 12px 0 0; display: flex; flex-direction: column; gap: 14px; }
        .faff-conn-section-label {
          font-family: 'Inter', sans-serif;
          font-size: 11px; letter-spacing: 1.5px;
          color: rgba(13,15,18,.40); text-transform: uppercase;
          font-weight: 600; margin-top: 14px;
        }
        .faff-conn-section-label:first-of-type { margin-top: 0; }

        .faff-conn-row {
          background: rgba(13,15,18,.03);
          border: 1px solid rgba(13,15,18,.08);
          border-radius: 12px;
          padding: 18px 20px;
          display: grid;
          grid-template-columns: 44px 1fr auto;
          gap: 16px;
          align-items: center;
        }
        .faff-conn-row.connected {
          background: rgba(44,168,47,.05);
          border-color: rgba(44,168,47,.20);
        }
        .faff-conn-icon {
          width: 44px; height: 44px; border-radius: 11px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Bebas Neue', sans-serif; font-size: 20px;
          color: #fff; letter-spacing: 0.5px;
        }
        .faff-conn-icon.strava { background: #FC4C02; }
        .faff-conn-icon.manual { background: #0D0F12; color: #D4900A;
          font-family: 'Inter', sans-serif; font-weight: 700; font-size: 17px; }
        .faff-conn-icon.gpx    { background: #0D0F12; color: #2563EB;
          font-family: 'Inter', sans-serif; font-weight: 700; font-size: 12px; letter-spacing: .5px; }
        .faff-conn-name {
          font-family: 'Inter', sans-serif; font-weight: 700;
          font-size: 14px; color: #0D0F12;
        }
        .faff-conn-meta {
          font-family: 'Inter', sans-serif; font-size: 12px;
          color: rgba(13,15,18,.55); margin-top: 3px; line-height: 1.5;
        }
        .faff-conn-meta strong { color: rgba(13,15,18,.75); font-weight: 600; }
        .faff-dot {
          display: inline-block; width: 7px; height: 7px;
          border-radius: 50%; margin-right: 6px; vertical-align: middle;
        }
        .faff-dot.green { background: #2CA82F; }
        .faff-dot.amber { background: #D4900A; }
        .faff-conn-actions { display: flex; gap: 8px; align-items: center; }
        .faff-conn-btn {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
          padding: 9px 14px; border-radius: 8px; cursor: pointer;
          border: 1px solid rgba(13,15,18,.16);
          background: transparent; color: rgba(13,15,18,.55);
          text-decoration: none; white-space: nowrap;
        }
        .faff-conn-btn:hover { background: rgba(13,15,18,.04); color: #0D0F12; }
        .faff-conn-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .faff-conn-btn.primary {
          background: #FC4C02; color: #fff; border-color: #FC4C02;
        }
        .faff-conn-btn.primary:hover { background: #E04400; color: #fff; }
        .faff-conn-btn.danger {
          color: #F43F5E; border-color: rgba(244,63,94,.25);
        }
        .faff-conn-btn.danger:hover { background: rgba(244,63,94,.06); color: #F43F5E; }

        .faff-conn-pills { display: flex; flex-wrap: wrap; gap: 6px; }

        .faff-conn-subrow {
          padding: 0 4px 4px 8px;
        }
        .faff-writeback-toggle {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 14px 18px;
          background: rgba(13,15,18,.02);
          border: 1px solid rgba(13,15,18,.06);
          border-radius: 10px;
          cursor: pointer;
          font-family: 'Inter', sans-serif; font-size: 13px;
          color: rgba(13,15,18,.85);
        }
        .faff-writeback-toggle input { margin-top: 3px; width: 16px; height: 16px; cursor: pointer; accent-color: #FC4C02; }
        .faff-writeback-toggle strong { display: block; font-weight: 600; color: #0D0F12; margin-bottom: 3px; font-size: 13px; }
        .faff-writeback-sub { display: block; font-size: 12px; color: rgba(13,15,18,.55); line-height: 1.5; font-weight: 400; }
        .faff-writeback-sub em { font-style: italic; color: rgba(13,15,18,.75); }
        .faff-conn-loading {
          padding: 16px 20px; text-align: center;
          font-family: 'Inter', sans-serif; font-size: 12px;
          color: rgba(13,15,18,.40);
        }
      `}</style>
    </Card>
  );
}

function FuturePill({ provider, status, statusLabel }: { provider: string; status: 'soon' | 'planned'; statusLabel: string }) {
  const info = PROVIDER_INFO[provider];
  return (
    <span className="faff-future">
      <span className="faff-future-dot" style={{ background: info?.color || '#0D0F12' }} />
      {info?.name || provider}
      <span className={`faff-future-tag ${status}`}>{statusLabel}</span>
      <style jsx>{`
        .faff-future {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 12px;
          background: rgba(13,15,18,.03);
          border: 1px solid rgba(13,15,18,.08);
          border-radius: 9px;
          font-family: 'Inter', sans-serif;
          font-size: 12px; color: rgba(13,15,18,.55); font-weight: 500;
        }
        .faff-future-dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }
        .faff-future-tag {
          font-family: 'Inter', sans-serif; font-size: 9.5px;
          letter-spacing: 1.2px; text-transform: uppercase;
          font-weight: 600; margin-left: 4px;
        }
        .faff-future-tag.soon    { color: #D4900A; }
        .faff-future-tag.planned { color: rgba(13,15,18,.40); }
      `}</style>
    </span>
  );
}
