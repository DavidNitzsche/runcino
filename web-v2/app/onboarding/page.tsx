import { TopNav } from '@/components/layout/TopNav';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

export const dynamic = 'force-dynamic';

/**
 * Onboarding — zero-state runner to first briefing.
 *
 * Flow:
 *   1. Welcome + connect Strava + Apple Health (P6.b adds OAuth)
 *   2. Set goal (race-distance + target time)
 *   3. Add a race (or skip — coach surfaces "what's next?" mode)
 *   4. Confirm baseline data — coach generates first briefing
 */
export default function OnboardingPage() {
  return (
    <main>
      <TopNav />
      <div style={{ padding: '60px 40px 80px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--green)', letterSpacing: '1.6px', textTransform: 'uppercase', fontWeight: 700, marginBottom: 12 }}>
          ONBOARDING
        </div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
          Let's set you up.
        </h1>
        <p style={{ color: 'var(--mute)', fontSize: 15, lineHeight: 1.6, marginTop: 18, maxWidth: 580 }}>
          Four steps. Most of it lifts itself from Strava and Apple Health — the coach builds
          your baseline from what's already there.
        </p>
        <OnboardingFlow />
      </div>
    </main>
  );
}
