/**
 * ConnectBanner, the orange-tinted "Connect Strava to start tracking"
 * banner that rides at the top of every in-app page when the user has
 * zero activity-source connectors active.
 *
 * Source spec: designs/empty-states-v4.html §Shared component.
 *
 * The banner is dismissible per-session via local state but reappears
 * on every page reload until a source is connected, that's intentional;
 * the prompt is too important to permanently dismiss.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Props {
  /** Set false to hide entirely (e.g. when a connector is already active). */
  show?: boolean;
}

export function ConnectBanner({ show = true }: Props) {
  const [dismissed, setDismissed] = useState(false);

  // If the URL has ?connect=success (just back from Strava OAuth), hide
  // the banner immediately even before the connector status fetch lands.
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('connect') === 'success') {
      setDismissed(true);
    }
  }, []);

  if (!show || dismissed) return null;

  return (
    <div className="faff-connect-banner">
      <div className="faff-connect-banner-icon">S</div>
      <div>
        <div className="faff-connect-banner-title">Connect Strava to start tracking</div>
        <div className="faff-connect-banner-sub">
          Your plan is set. Pull in your runs to see{' '}
          <strong>readiness, form, and load</strong>. We backfill your full activity history
          on connect, usually under a minute.
        </div>
      </div>
      <div className="faff-connect-banner-actions">
        <Link className="faff-btn-strava" href="/api/strava/connect">Connect Strava</Link>
        <button type="button" className="faff-btn-quiet" onClick={() => setDismissed(true)}>
          Maybe later
        </button>
      </div>

      <style jsx>{`
        .faff-connect-banner {
          display: grid;
          grid-template-columns: 56px 1fr auto;
          gap: 20px;
          align-items: center;
          padding: 18px 24px;
          background: linear-gradient(90deg, rgba(252,76,2,.06) 0%, rgba(252,76,2,.02) 100%);
          border: 1px solid rgba(252,76,2,.18);
          border-radius: 14px;
          margin: 16px auto 16px;
          max-width: 1440px;
          width: calc(100% - 80px);
        }
        @media (max-width: 960px) {
          .faff-connect-banner {
            width: calc(100% - 48px);
            grid-template-columns: 1fr;
            text-align: center;
          }
          .faff-connect-banner-icon { justify-self: center; }
          .faff-connect-banner-actions { justify-content: center; }
        }
        @media (max-width: 640px) {
          .faff-connect-banner { width: calc(100% - 32px); }
        }
        .faff-connect-banner-icon {
          width: 44px; height: 44px; border-radius: 11px;
          background: #FC4C02;
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-family: 'Bebas Neue', sans-serif; font-size: 22px;
        }
        .faff-connect-banner-title {
          font-family: 'Inter', sans-serif; font-weight: 700; font-size: 14px;
          color: #080808;
        }
        .faff-connect-banner-sub {
          font-family: 'Inter', sans-serif; font-size: 13px;
          color: rgba(8,8,8,.55); margin-top: 2px; line-height: 1.5;
        }
        .faff-connect-banner-actions { display: flex; gap: 8px; }
        .faff-btn-strava {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
          padding: 10px 16px; border-radius: 8px; cursor: pointer; border: none;
          background: #FC4C02; color: #fff; text-decoration: none; white-space: nowrap;
        }
        .faff-btn-strava:hover { background: #E04400; }
        .faff-btn-quiet {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
          padding: 10px 16px; border-radius: 8px; cursor: pointer;
          border: 1px solid rgba(8,8,8,.25);
          background: transparent; color: rgba(8,8,8,.55); white-space: nowrap;
        }
        .faff-btn-quiet:hover { background: rgba(8,8,8,.04); color: #080808; }
      `}</style>
    </div>
  );
}
