/**
 * Landing hero — Step 0 of the Lilian flow.
 *
 * Deck source: docs/2026-05-28-onboarding-lilian.html § HERO · LANDING.
 *
 * Just the verb + two CTAs. Primary advances into step 1; secondary
 * uses the existing /api/auth/strava OAuth handler — which is already
 * the production sign-in path for returning runners.
 */

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { buildOnboardingHref } from '@/lib/onboarding/state';

export function LandingHero() {
  const [signingIn, setSigningIn] = useState(false);

  async function signIn() {
    // Reuse the existing Strava OAuth handler exactly as /profile and
    // StravaPushButton do — fetch the connect URL, then redirect.
    setSigningIn(true);
    try {
      const r = await fetch('/api/auth/strava?action=connect');
      const j = await r.json().catch(() => ({}));
      if (j?.url) {
        window.location.href = j.url;
      } else {
        // Either env isn't configured locally or the handler returned an
        // error. Fall through to the goal step so the runner isn't stuck.
        window.location.href = buildOnboardingHref(
          { step: 'goal' } as any,
        );
      }
    } catch {
      setSigningIn(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ marginTop: 70 }} />
      <h1 style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        lineHeight: 0.86,
        fontSize: 'clamp(72px, 14vw, 132px)',
        margin: 0,
        color: '#fff',
        textTransform: 'uppercase',
      }}>
        RUN WITH<br />A PLAN.
      </h1>

      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 17,
        lineHeight: 1.55,
        color: 'rgba(255,255,255,0.86)',
        margin: '32px 0 0',
        maxWidth: 480,
      }}>
        Daily coach. Real plan. Built on Apple Watch + Strava.
      </p>

      <div style={{ flex: 1 }} />

      <Link href={buildOnboardingHref({ step: 'goal' } as any)} style={{
        display: 'block',
        marginTop: 32,
        background: '#fff',
        color: '#2a1a5a',
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        fontSize: 22,
        padding: '18px',
        borderRadius: 16,
        textAlign: 'center',
        textTransform: 'uppercase',
        textDecoration: 'none',
        maxWidth: 480,
      }}>
        Get started
      </Link>

      <div style={{
        marginTop: 14,
        fontFamily: 'var(--f-body)',
        fontSize: 13,
        color: 'rgba(255,255,255,0.7)',
        letterSpacing: '0.2px',
        maxWidth: 480,
        textAlign: 'left',
      }}>
        Already have an account?{' '}
        <button
          type="button"
          onClick={signIn}
          disabled={signingIn}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontWeight: 700,
            fontFamily: 'inherit',
            fontSize: 13,
            padding: 0,
            cursor: signingIn ? 'wait' : 'pointer',
            textDecoration: 'underline',
            opacity: signingIn ? 0.7 : 1,
          }}
        >
          {signingIn ? 'Redirecting…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
