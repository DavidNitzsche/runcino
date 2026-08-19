import { buildOnboardingHref, type OnboardingState } from '@/lib/onboarding/state';

/**
 * components/redesign/onboarding/href.ts
 *
 * buildOnboardingHref (lib/onboarding/state.ts) always emits `/onboarding
 * ?...` — hardcoded, since it's the live route's own URL builder. The
 * redesigned flow lives at `/redesign/onboarding` and must stay
 * self-contained (a Continue tap should never bounce the runner onto the
 * live, differently-skinned route mid-flow). This wrapper reuses
 * buildOnboardingHref's encoding VERBATIM — same fields, same param
 * names, same defaults-preservation — and only rewrites the path prefix.
 * Every redesigned step component calls this instead of the raw
 * buildOnboardingHref for navigation, so the URL-driven state contract
 * (parseOnboardingParams / canAdvanceFrom* / etc., all still imported
 * directly from lib/onboarding/state.ts unchanged) is identical to the
 * live route's — only the path differs.
 */
export function redesignOnboardingHref(
  current: OnboardingState,
  next: Partial<OnboardingState> = {},
): string {
  return buildOnboardingHref(current, next).replace(/^\/onboarding/, '/redesign/onboarding');
}
