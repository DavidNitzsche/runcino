/**
 * /onboarding · Lilian deck entry point.
 *
 * URL-driven state · all step data lives in searchParams (parsed by
 * lib/onboarding/state.ts). Refresh + back-button safe.
 *
 * Steps:
 *   landing  → LandingHero          (no `step` param)
 *   goal     → Step1Goal            (?step=goal)
 *   goal-details → Step1bGoalDetails(?step=goal-details)
 *   signals  → Step2Signals         (?step=signals)
 *   confirm  → Step3Confirm         (?step=confirm)
 *   done     → CompletionScreen     (?step=done)
 *
 * Auth gate: most steps require a user_uuid (the Strava OAuth flow
 * pre-authenticates before reaching /onboarding). Unauthenticated
 * users on /onboarding bounce to the landing page which surfaces
 * "Already have an account? Sign in" routing to Strava OAuth.
 *
 * Replaces the prior `redirect('/today')` stub. Pairs with:
 *   · designs/briefs/onboarding-master.md
 *   · designs/briefs/onboarding-master-execution.md § TASK B1
 */

import { OnboardingShell, type OnboardingIntent } from '@/components/onboarding/OnboardingShell';
import { LandingHero } from '@/components/onboarding/LandingHero';
import { Step1Goal } from '@/components/onboarding/Step1Goal';
import { Step1bGoalDetails } from '@/components/onboarding/Step1bGoalDetails';
import { Step2Signals } from '@/components/onboarding/Step2Signals';
import { Step3Confirm } from '@/components/onboarding/Step3Confirm';
import { CompletionScreen } from '@/components/onboarding/CompletionScreen';
import {
  parseOnboardingParams,
  buildOnboardingHref,
  type OnboardingState,
} from '@/lib/onboarding/state';
import { loadStravaHistoryForOnboarding } from '@/lib/onboarding/strava-history';
import { resolveInitialName } from '@/lib/onboarding/initial-name';
import { userIdFromCookies } from '@/lib/auth/session';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OnboardingPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const state = parseOnboardingParams(sp);
  const intent = intentFor(state);
  const stepNumber = stepNumberFor(state.step);
  const variant: 'new' | 'done' = state.step === 'done' ? 'done' : 'new';
  const backHref = backHrefFor(state);

  // Resolve user for the steps that need DB reads. Landing + goal step
  // don't need a user; goal-details / confirm do. Falls back to null
  // when no session · steps render with chip-only UI in that case.
  let userUuid: string | null = null;
  if (['goal-details', 'confirm', 'done'].includes(state.step)) {
    userUuid = await userIdFromCookies().catch(() => null);
  }

  // Step 1b Strava history pre-fill · only when connected AND auth'd.
  let stravaHistory = null;
  if (state.step === 'goal-details' && state.stravaConnected && userUuid) {
    stravaHistory = await loadStravaHistoryForOnboarding(userUuid).catch(() => null);
  }

  // Step 3 name pre-fill · ladder of URL → DB → null.
  let initialName: string | null = null;
  if (state.step === 'confirm' && userUuid) {
    initialName = await resolveInitialName({
      userUuid,
      urlName: state.name,
    }).catch(() => null);
  }

  return (
    <OnboardingShell
      state={state}
      variant={variant}
      intent={intent}
      backHref={backHref}
      stepNumber={stepNumber}
    >
      {state.step === 'landing' && <LandingHero />}
      {state.step === 'goal' && <Step1Goal initial={state} />}
      {state.step === 'goal-details' && (
        <Step1bGoalDetails initial={state} stravaHistory={stravaHistory} />
      )}
      {state.step === 'signals' && <Step2Signals initial={state} />}
      {state.step === 'confirm' && (
        <Step3Confirm initial={state} initialName={initialName} />
      )}
      {state.step === 'done' && <CompletionScreen state={state} />}
    </OnboardingShell>
  );
}

/* ────────────────────────── Helpers ────────────────────────── */

/** Drive the gradient color per OnboardingShell.intent. */
function intentFor(state: OnboardingState): OnboardingIntent {
  if (state.step === 'landing') return 'landing';
  if (state.distance === 'none') {
    // TT goal selected on the no-race path drives the amber intent;
    // otherwise consistency-blue.
    return state.ttDistance ? 'tt-goal' : 'consistency';
  }
  // Coached mode rides the consistency-blue skin · no race anchor.
  if (state.distance === 'coached') return 'consistency';
  if (state.distance) return 'race';
  return 'landing';
}

/** 1/2/3 step number for the indicator · null on landing + done. */
function stepNumberFor(step: OnboardingState['step']): 1 | 2 | 3 | null {
  if (step === 'goal' || step === 'goal-details') return 1;
  if (step === 'signals') return 2;
  if (step === 'confirm') return 3;
  return null;
}

/** Where the ← BACK link in the top strip goes. */
function backHrefFor(state: OnboardingState): string | undefined {
  if (state.step === 'landing' || state.step === 'done') return undefined;
  if (state.step === 'goal') return '/onboarding';
  if (state.step === 'goal-details') return buildOnboardingHref(state, { step: 'goal' });
  if (state.step === 'signals') {
    // Coached skips 1b · every running path (race + none) walks it.
    return state.distance === 'coached'
      ? buildOnboardingHref(state, { step: 'goal' })
      : buildOnboardingHref(state, { step: 'goal-details' });
  }
  if (state.step === 'confirm') return buildOnboardingHref(state, { step: 'signals' });
  return undefined;
}
