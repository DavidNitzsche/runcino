/**
 * /onboarding · Lilian onboarding flow (locked 2026-05-28).
 *
 * Six screens (URL-driven, no sessionStorage):
 *   - landing       · /onboarding                       · LandingHero
 *   - goal          · /onboarding?step=goal             · Step1Goal
 *   - goal-details  · /onboarding?step=goal-details     · Step1bGoalDetails (no-race only)
 *   - signals       · /onboarding?step=signals          · Step2Signals
 *   - confirm       · /onboarding?step=confirm          · Step3Confirm
 *   - done          · /onboarding?step=done             · CompletionScreen
 *
 * Per-step temp state lives in `searchParams`. Final write happens on
 * "Start training" → POST /api/onboarding/complete → profile.* columns
 * (migrations 115 + 118).
 *
 * Design source: docs/2026-05-28-onboarding-lilian.html
 */
import { pool } from '@/lib/db/pool';
import { hasStravaConnection } from '@/lib/strava/auth';
import {
  parseOnboardingParams,
  buildOnboardingHref,
  type OnboardingState,
} from '@/lib/onboarding/state';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { LandingHero } from '@/components/onboarding/LandingHero';
import { Step1Goal } from '@/components/onboarding/Step1Goal';
import { Step1bGoalDetails } from '@/components/onboarding/Step1bGoalDetails';
import { Step2Signals } from '@/components/onboarding/Step2Signals';
import { Step3Confirm } from '@/components/onboarding/Step3Confirm';
import { CompletionScreen } from '@/components/onboarding/CompletionScreen';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const state = parseOnboardingParams(sp);

  // Server-side enrichment: if landing on /signals OR /goal-details, check
  // whether the runner is actually already Strava-connected (so the tile
  // flips green / Strava history card renders without forcing OAuth bounce).
  if (state.step === 'signals' || state.step === 'goal-details') {
    try {
      const connected = await hasStravaConnection(DAVID_USER_ID);
      if (connected) state.stravaConnected = true;
    } catch {/* non-fatal */}
  }

  // Pre-compute Strava-derived avg weekly mi + longest recent run for the
  // Step 1b history card. Only when actually on that step + actually
  // connected — keeps the landing/goal pages cheap.
  let stravaHistory: { avgWeeklyMi: number; longestRecentMi: number } | null = null;
  if (state.step === 'goal-details' && state.stravaConnected) {
    stravaHistory = await loadStravaHistorySummary(DAVID_USER_ID).catch(() => null);
  }

  // Server-side enrichment for /confirm: pre-fill the name from profile
  // (which may already have Strava's first-name from a prior OAuth) and
  // pre-fill goal-summary copy from earlier URL state.
  let initialName: string | null = null;
  if (state.step === 'confirm') {
    initialName = await loadFirstNameGuess(DAVID_USER_ID);
  }

  // ── Route to the right step ──────────────────────────────────────
  if (state.step === 'landing') {
    return (
      <OnboardingShell state={state} variant="new" stepNumber={null}>
        <LandingHero />
      </OnboardingShell>
    );
  }

  if (state.step === 'goal') {
    return (
      <OnboardingShell
        state={state}
        variant="new"
        stepNumber={1}
        backHref={buildOnboardingHref(state, { step: 'landing' })}
      >
        <Step1Goal initial={state} />
      </OnboardingShell>
    );
  }

  if (state.step === 'goal-details') {
    return (
      <OnboardingShell
        state={state}
        variant="new"
        stepNumber={1}
        backHref={buildOnboardingHref(state, { step: 'goal' })}
      >
        <Step1bGoalDetails initial={state} stravaHistory={stravaHistory} />
      </OnboardingShell>
    );
  }

  if (state.step === 'signals') {
    return (
      <OnboardingShell
        state={state}
        variant="new"
        stepNumber={2}
        backHref={buildOnboardingHref(state, {
          // Bounce back to the right prior step for the no-race path.
          step: state.distance === 'none' ? 'goal-details' : 'goal',
        })}
      >
        <Step2Signals initial={state} />
      </OnboardingShell>
    );
  }

  if (state.step === 'confirm') {
    return (
      <OnboardingShell
        state={state}
        variant="new"
        stepNumber={3}
        backHref={buildOnboardingHref(state, { step: 'signals' })}
      >
        <Step3Confirm initial={state} initialName={initialName} />
      </OnboardingShell>
    );
  }

  // step === 'done'
  return (
    <OnboardingShell state={state} variant="done" stepNumber={null}>
      <CompletionScreen state={state} />
    </OnboardingShell>
  );
}

/**
 * Best-effort first-name guess for step 3.
 *
 * Priority:
 *   1. profile.full_name (if previously stamped) — first token only.
 *   2. Strava athlete `firstname` via existing token (if connected).
 *   3. null → input renders empty + runner types.
 *
 * Defensive · never throws. Onboarding shouldn't block on a name lookup.
 */
async function loadFirstNameGuess(userId: string): Promise<string | null> {
  try {
    const r = await pool.query(
      `SELECT full_name FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId]
    );
    const fullName = r.rows[0]?.full_name as string | null | undefined;
    if (fullName && fullName.trim()) {
      return fullName.split(/\s+/)[0] ?? null;
    }
  } catch { /* fall through */ }

  // Strava athlete lookup — keep cheap, skip on any error. We do NOT
  // trigger a token refresh here; if the access token is stale, just
  // return null and let the runner type their name.
  try {
    const r = await pool.query(
      `SELECT strava_access_token AS at
         FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId]
    );
    const at = r.rows[0]?.at as string | null | undefined;
    if (at) {
      const resp = await fetch('https://www.strava.com/api/v3/athlete', {
        headers: { Authorization: `Bearer ${at}` },
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        const j: any = await resp.json();
        if (j?.firstname) return String(j.firstname);
      }
    }
  } catch { /* swallow */ }

  return null;
}

/**
 * Compute Strava-derived running-history summary for the Step 1b card.
 *
 *   - avgWeeklyMi   = total miles in the last 28 days / 4 (rounded int).
 *   - longestRecentMi = single largest run distance in the last 28 days.
 *
 * Reads the same `strava_activities` table the coach state loaders use,
 * filters out merged-duplicate activities. Defensive — returns null on
 * any DB error or empty result so the UI falls back to the chip groups.
 */
async function loadStravaHistorySummary(
  userId: string
): Promise<{ avgWeeklyMi: number; longestRecentMi: number } | null> {
  try {
    const r = await pool.query(
      `SELECT
          COALESCE(SUM((data->>'distanceMi')::numeric), 0)  AS total_mi,
          COALESCE(MAX((data->>'distanceMi')::numeric), 0)  AS max_mi
         FROM strava_activities
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND NOT (data ? 'mergedIntoId')
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))
              >= (CURRENT_DATE - INTERVAL '28 days')::text`,
      [userId]
    );
    const totalMi = Number(r.rows[0]?.total_mi) || 0;
    const maxMi = Number(r.rows[0]?.max_mi) || 0;
    if (totalMi <= 0) return null;
    return {
      avgWeeklyMi: Math.max(1, Math.round(totalMi / 4)),
      longestRecentMi: Math.max(1, Math.round(maxMi)),
    };
  } catch {
    return null;
  }
}

// Hint to the OnboardingState type that landing-step IS a valid value
// (parser produces it, even though it isn't in VALID_STEPS).
export type _Unused = OnboardingState;
