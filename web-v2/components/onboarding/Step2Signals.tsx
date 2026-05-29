/**
 * Step 2 · Signals · Lilian onboarding.
 *
 * Deck source: docs/2026-05-28-onboarding-lilian.html § STEP 2 · SIGNALS.
 *
 * Three tiles · Strava (real OAuth), Apple Health (iPhone-only), Apple
 * Watch (iPhone-only). The two HealthKit tiles are explicit deferrals
 * per CLAUDE.md memory "iPhone stays fully native — no web-views" —
 * they don't try to do a web flow.
 *
 * Strava reuse pattern: GET /api/auth/strava?action=connect → JSON
 * { url } → window.location.href = url. Strava callback returns the
 * runner to /onboarding?step=signals&strava=connected (handled by the
 * page's URL state parser).
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  buildOnboardingHref,
  type OnboardingState,
} from '@/lib/onboarding/state';

export function Step2Signals({ initial }: { initial: OnboardingState }) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);

  async function connectStrava() {
    setConnecting(true);
    try {
      const r = await fetch('/api/auth/strava?action=connect');
      const j = await r.json().catch(() => ({}));
      if (j?.url) {
        // Strava will return the runner to the configured redirect URI;
        // the existing callback redirects to wherever was configured.
        // For onboarding we want to come back to /onboarding?step=signals.
        // The handler doesn't currently support a runtime returnTo
        // override — for now, the runner returns to /api/auth/strava
        // (the callback URL) and is sent home; they re-enter onboarding
        // from /onboarding manually. Note open issue (a) in the report.
        window.location.href = j.url;
      } else {
        setConnecting(false);
      }
    } catch {
      setConnecting(false);
    }
  }

  function onContinue(skipped: boolean) {
    router.push(buildOnboardingHref(initial, {
      step: 'confirm',
      connectionsSkipped: skipped || initial.connectionsSkipped,
    }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <h1 style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        lineHeight: 0.86,
        fontSize: 'clamp(48px, 8vw, 84px)',
        margin: 0,
        color: '#fff',
      }}>
        Let Faff see<br />your runs<br />and body.
      </h1>

      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 17,
        lineHeight: 1.55,
        color: 'rgba(255,255,255,0.86)',
        margin: '24px 0 32px',
        maxWidth: 520,
      }}>
        Connect any combination. Faff needs at least one source to build the plan around real data.
      </p>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginBottom: 24,
        maxWidth: 560,
      }}>
        <SignalTile
          icon="S"
          iconBg="#FC4C02"
          name="Strava"
          meta="Run history · pace · routes"
          connected={initial.stravaConnected}
          cta={initial.stravaConnected
            ? 'Strava connected · runs sync now'
            : (connecting ? 'OPENING…' : 'CONNECT STRAVA')}
          onClick={initial.stravaConnected ? undefined : connectStrava}
          disabled={connecting}
        />
        <SignalTile
          icon="+"
          iconBg="#FA2D48"
          name="Apple Health"
          meta="RHR · sleep · HRV · VO2max"
          connected={false}
          cta="OPEN ON IPHONE"
          help="HealthKit lives on your iPhone. Open Faff there to grant access."
        />
        <SignalTile
          icon="W"
          iconBg="#1d1d1f"
          iconBorder={true}
          name="Apple Watch"
          meta="Live HR · on-wrist coach"
          connected={false}
          cta="OPEN ON IPHONE"
          help="Pair from the iPhone app · the watch app installs automatically."
        />
      </div>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={() => onContinue(false)}
        style={{
          background: '#fff',
          color: '#2a1a5a',
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          fontSize: 22,
          padding: 18,
          borderRadius: 16,
          textAlign: 'center',
          textTransform: 'uppercase',
          border: 'none',
          cursor: 'pointer',
          maxWidth: 480,
          marginTop: 24,
        }}
      >
        Continue
      </button>
      <button
        type="button"
        onClick={() => onContinue(true)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          padding: '14px 0 0',
          cursor: 'pointer',
          textAlign: 'left',
          textDecoration: 'underline',
          maxWidth: 480,
        }}
      >
        Skip for now
      </button>
    </div>
  );
}

interface SignalTileProps {
  icon: string;
  iconBg: string;
  iconBorder?: boolean;
  name: string;
  meta: string;
  connected: boolean;
  cta: string;
  help?: string;
  onClick?: () => void;
  disabled?: boolean;
}

function SignalTile({
  icon, iconBg, iconBorder, name, meta, connected, cta, help, onClick, disabled,
}: SignalTileProps) {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: connected
          ? 'rgba(255,255,255,0.10)'
          : 'rgba(255,255,255,0.06)',
        border: `1px solid ${connected
          ? 'rgba(255,255,255,0.22)'
          : 'rgba(255,255,255,0.14)'}`,
        borderRadius: 14,
        padding: '16px 16px',
        textAlign: 'left' as const,
        color: '#fff',
        fontFamily: 'inherit',
        cursor: onClick && !disabled ? 'pointer' : 'default',
        opacity: disabled ? 0.6 : 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 14,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: iconBg,
            border: iconBorder ? '1px solid rgba(255,255,255,0.22)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--f-display)',
            fontWeight: 700,
            fontSize: 18,
            color: '#fff',
            flexShrink: 0,
          }}>
            {icon}
          </div>
          <div>
            <div style={{
              fontFamily: 'var(--f-body)',
              fontWeight: 700,
              fontSize: 14,
              color: '#fff',
              marginBottom: 2,
            }}>
              {name}
            </div>
            <div style={{
              fontFamily: 'var(--f-body)',
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
              letterSpacing: '0.2px',
            }}>
              {meta}
            </div>
          </div>
        </div>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: connected ? 'var(--green)' : 'rgba(255,255,255,0.22)',
          boxShadow: connected ? '0 0 10px rgba(62,189,65,0.6)' : 'none',
          flexShrink: 0,
        }} />
      </div>
      {help ? (
        <div style={{
          fontFamily: 'var(--f-body)',
          fontSize: 12,
          color: 'rgba(255,255,255,0.7)',
          lineHeight: 1.5,
        }}>
          {help}
        </div>
      ) : null}
      <div style={{
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '1.6px',
        textTransform: 'uppercase',
        color: connected ? '#d2ffce' : 'rgba(255,255,255,0.85)',
      }}>
        {cta}
      </div>
    </Tag>
  );
}
