/**
 * app/redesign/onboarding/page.tsx
 *
 * The redesigned Onboarding flow — a re-skin of the live /onboarding
 * route (app/onboarding/page.tsx) through the redesign component
 * library. Same URL-driven step state, same auth gate, same field
 * contract; only the visual layer changes.
 *
 * Structurally ported from designs/design-review-0818/ui_kits/web/
 * WebOnboarding.jsx + WebDayOne.jsx (WebDayOne is the mock's rendering of
 * step 1 — the goal-mode picker — not a separate feature; see the task
 * report / commit message for the full mapping). Everything below this
 * comment mirrors app/onboarding/page.tsx's own logic byte-for-byte
 * (same searchParams parsing via lib/onboarding/state.ts, same conditional
 * DB reads, same helper functions reproduced verbatim since they're
 * page-local/non-exported in the source file) — only the imported step
 * components differ (Redesign-suffixed, rendered inside
 * OnboardingShellRedesign instead of the live OnboardingShell).
 *
 * Steps (identical contract to the live route):
 *   landing      → LandingHeroRedesign        (no `step` param)
 *   goal         → Step1GoalRedesign          (?step=goal)
 *   goal-details → Step1bGoalDetailsRedesign  (?step=goal-details)
 *   signals      → Step2SignalsRedesign       (?step=signals)
 *   confirm      → Step3ConfirmRedesign       (?step=confirm)
 *   done         → CompletionScreenRedesign   (?step=done)
 *
 * Auth gate: identical to the live route — most steps require a
 * user_uuid (Strava OAuth pre-authenticates before reaching onboarding).
 * There is no server-side redirect for unauthenticated visitors; landing
 * and the goal step render chip-only UI without a session, and the
 * step-3 submit handler 401s → client redirects to /login?next=... . No
 * new auth behavior introduced here.
 *
 * SAFETY (see task report / commit message for full detail): the
 * completion / plan-generation path was verified STRUCTURALLY ONLY —
 * by reading route.ts and matching the submit payload — never fired
 * against a real account. David is already onboarded; running this flow
 * for real would create duplicate/corrupted data.
 */

import { OnboardingShellRedesign, type OnboardingIntent } from '@/components/redesign/onboarding/OnboardingShellRedesign';
import { LandingHeroRedesign } from '@/components/redesign/onboarding/LandingHeroRedesign';
import { Step1GoalRedesign } from '@/components/redesign/onboarding/Step1GoalRedesign';
import { Step1bGoalDetailsRedesign } from '@/components/redesign/onboarding/Step1bGoalDetailsRedesign';
import { Step2SignalsRedesign } from '@/components/redesign/onboarding/Step2SignalsRedesign';
import { Step3ConfirmRedesign } from '@/components/redesign/onboarding/Step3ConfirmRedesign';
import { CompletionScreenRedesign } from '@/components/redesign/onboarding/CompletionScreenRedesign';
import {
  parseOnboardingParams,
  type OnboardingState,
} from '@/lib/onboarding/state';
import { redesignOnboardingHref } from '@/components/redesign/onboarding/href';
import { loadStravaHistoryForOnboarding } from '@/lib/onboarding/strava-history';
import { resolveInitialName } from '@/lib/onboarding/initial-name';
import { userIdFromCookies } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RedesignOnboardingPage({ searchParams }: PageProps) {
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
    <div className="redesign-root" data-theme="light">
      <OnboardingShellRedesign
        state={state}
        variant={variant}
        intent={intent}
        backHref={backHref}
        stepNumber={stepNumber}
      >
        {state.step === 'landing' && <LandingHeroRedesign />}
        {state.step === 'goal' && <Step1GoalRedesign initial={state} />}
        {state.step === 'goal-details' && (
          <Step1bGoalDetailsRedesign initial={state} stravaHistory={stravaHistory} />
        )}
        {state.step === 'signals' && <Step2SignalsRedesign initial={state} />}
        {state.step === 'confirm' && (
          <Step3ConfirmRedesign initial={state} initialName={initialName} />
        )}
        {state.step === 'done' && <CompletionScreenRedesign state={state} />}
      </OnboardingShellRedesign>
    </div>
  );
}

/* ────────────────────────── Helpers ────────────────────────── */
/* Reproduced verbatim from app/onboarding/page.tsx — page-local, not
 * exported there, so mirrored here rather than imported. Same idiom as
 * BlockClient.tsx's reproduction of TrainView's phase helpers: if the
 * source file's logic at these functions ever changes, this copy must
 * change with it. */

/** Drive the gradient color per OnboardingShellRedesign.intent. */
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
  if (state.step === 'goal') return '/redesign/onboarding';
  if (state.step === 'goal-details') return redesignOnboardingHref(state, { step: 'goal' });
  if (state.step === 'signals') {
    // Coached skips 1b · every running path (race + none) walks it.
    return state.distance === 'coached'
      ? redesignOnboardingHref(state, { step: 'goal' })
      : redesignOnboardingHref(state, { step: 'goal-details' });
  }
  if (state.step === 'confirm') return redesignOnboardingHref(state, { step: 'signals' });
  return undefined;
}
