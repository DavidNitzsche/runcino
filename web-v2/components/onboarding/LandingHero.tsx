/**
 * Landing hero — Step 0 of the Lilian flow.
 *
 * Deck source: docs/2026-05-28-onboarding-lilian.html § HERO · LANDING.
 *
 * Just the verb + two CTAs. Primary advances into step 1; secondary
 * links to /login, the canonical sign-in surface (Apple + email +
 * create-account).
 *
 * 2026-06-10 · the old secondary CTA fetched /api/auth/strava?action=
 * connect — but that handler requires an existing session (it CONNECTS
 * Strava to a signed-in account, it doesn't sign you in), so for the
 * signed-out runners this CTA exists for it always 401'd and silently
 * fell through to the goal step. /login is the real path.
 */

'use client';

import Link from 'next/link';
import { buildOnboardingHref } from '@/lib/onboarding/state';

export function LandingHero() {

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
        <Link
          href="/login"
          style={{
            color: '#fff',
            fontWeight: 700,
            fontFamily: 'inherit',
            fontSize: 13,
            textDecoration: 'underline',
          }}
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
