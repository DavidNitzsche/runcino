'use client';

import Link from 'next/link';
import { Poster } from '@/components/redesign/core/Poster';
import { Button } from '@/components/redesign/core/Button';

/**
 * components/redesign/onboarding/LandingHeroRedesign.tsx
 *
 * Reskin of the live components/onboarding/LandingHero.tsx. No mock in
 * this batch directly covers the landing/marketing screen — the task
 * brief is explicit that WebDayOne.jsx is step 1's mock, not landing's —
 * so this uses the design system's own hero primitive (Poster, state
 * "new" — a state that exists precisely for "day one, nothing logged
 * yet" moments per Poster.tsx's own doc comment) instead of inventing a
 * bespoke full-bleed treatment. Same copy as the live component (verb +
 * one sentence + two CTAs); no fabricated content.
 *
 * Read-only · no write side effects · safe to live-verify (confirmed
 * during this port: unauthenticated visit renders this screen cleanly).
 */
export function LandingHeroRedesign() {
  return (
    <Poster
      state="new"
      verb={<>Run with<br />a plan.</>}
      rx="Daily coach. Real plan. Built on Apple Watch and Strava."
      minHeight={420}
    >
      <div style={{ marginTop: 'auto', paddingTop: 'var(--sp-9)', display: 'grid', gap: 'var(--sp-6)', maxWidth: 360 }}>
        {/* No prior state to preserve on landing · same clean-URL entry
            the live LandingHero uses (buildOnboardingHref({step:'goal'})
            with every other field at its default emits exactly this). */}
        <Link href="/redesign/onboarding?step=goal" style={{ textDecoration: 'none' }}>
          <Button variant="secondary" size="lg" full style={{ color: '#221503' }}>Get started</Button>
        </Link>
        <div style={{ fontSize: 'var(--type-label-s)', color: 'rgba(255,255,255,.78)' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}>Sign in</Link>
        </div>
      </div>
    </Poster>
  );
}
