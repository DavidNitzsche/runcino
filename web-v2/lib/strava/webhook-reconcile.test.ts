/**
 * Drift matrix for the Strava Push API subscription.
 *
 * The outage this guards: Strava held a live subscription (347351,
 * callback https://www.faff.run/api/strava/webhook) and delivered events
 * continuously from 2026-05-29 to 2026-08-17, while our mirror table was
 * empty — so the webhook route's subscription_id check rejected every
 * one. Nobody had enumerated "Strava has one, we don't", so no code path
 * could reach it: subscribe hit Strava's one-per-app rule, unsubscribe
 * early-returned on the empty local read.
 *
 * Each state below is a state prod can actually be in. The plan is pure,
 * so they are all cheap to assert.
 */
import { describe, it, expect } from 'vitest';
import { planSubscriptionReconcile } from './webhook';

const CALLBACK = 'https://www.faff.run/api/strava/webhook';
const live = (id: number, cb: string = CALLBACK) => ({ id, callback_url: cb });

describe('planSubscriptionReconcile', () => {
  it('adopts when Strava is delivering and the local mirror is empty (the 2026-05-29 outage)', () => {
    const plan = planSubscriptionReconcile({
      strava: [live(347351)],
      local: null,
      expectedCallbackUrl: CALLBACK,
    });
    expect(plan.action).toBe('adopt');
    expect(plan.stravaSubscriptionId).toBe(347351);
    expect(plan.callbackUrl).toBe(CALLBACK);
    // Adoption is a local write only. Nothing about Strava changes, which
    // is why it is safe to run automatically.
    expect(plan.mutatesStrava).toBe(false);
  });

  it('reports in_sync when both sides name the same subscription', () => {
    const plan = planSubscriptionReconcile({
      strava: [live(347351)],
      local: { subscription_id: 347351, callback_url: CALLBACK },
      expectedCallbackUrl: CALLBACK,
    });
    expect(plan.action).toBe('in_sync');
    expect(plan.mutatesStrava).toBe(false);
  });

  it('re-points the mirror when the local row names a different subscription', () => {
    const plan = planSubscriptionReconcile({
      strava: [live(999888)],
      local: { subscription_id: 347351, callback_url: CALLBACK },
      expectedCallbackUrl: CALLBACK,
    });
    expect(plan.action).toBe('adopt');
    expect(plan.stravaSubscriptionId).toBe(999888);
  });

  it('drops a stale local row when Strava has no subscription at all', () => {
    const plan = planSubscriptionReconcile({
      strava: [],
      local: { subscription_id: 347351, callback_url: CALLBACK },
      expectedCallbackUrl: CALLBACK,
    });
    expect(plan.action).toBe('drop_stale_local');
    expect(plan.mutatesStrava).toBe(false);
  });

  it('asks for a create when neither side has a subscription', () => {
    const plan = planSubscriptionReconcile({
      strava: [],
      local: null,
      expectedCallbackUrl: CALLBACK,
    });
    expect(plan.action).toBe('create');
    // Creating registers a webhook with a third party — never automatic.
    expect(plan.mutatesStrava).toBe(true);
  });

  it('refuses to adopt a subscription pointing at the wrong callback host', () => {
    // The apex faff.run 404s on /api/strava/webhook; only www serves it.
    // A subscription registered against the apex would be delivering into
    // a 404 — adopting it would record a healthy-looking mirror row for a
    // subscription that can never work.
    const plan = planSubscriptionReconcile({
      strava: [live(347351, 'https://faff.run/api/strava/webhook')],
      local: null,
      expectedCallbackUrl: CALLBACK,
    });
    expect(plan.action).toBe('recreate_callback_drift');
    expect(plan.mutatesStrava).toBe(true);
    expect(plan.reason).toContain('faff.run/api/strava/webhook');
  });

  it('treats a trailing slash as the same callback, not drift', () => {
    const plan = planSubscriptionReconcile({
      strava: [live(347351, `${CALLBACK}/`)],
      local: null,
      expectedCallbackUrl: CALLBACK,
    });
    expect(plan.action).toBe('adopt');
  });

  it('adopts without a callback expectation rather than guessing drift', () => {
    // STRAVA_WEBHOOK_CALLBACK unset in an environment is not evidence the
    // live callback is wrong. Silence must not be read as a mismatch.
    const plan = planSubscriptionReconcile({
      strava: [live(347351)],
      local: null,
      expectedCallbackUrl: null,
    });
    expect(plan.action).toBe('adopt');
  });

  it('every non-create plan is applicable without touching Strava', () => {
    const states = [
      { strava: [live(347351)], local: null },
      { strava: [live(347351)], local: { subscription_id: 347351, callback_url: CALLBACK } },
      { strava: [], local: { subscription_id: 347351, callback_url: CALLBACK } },
    ];
    for (const s of states) {
      expect(planSubscriptionReconcile({ ...s, expectedCallbackUrl: CALLBACK }).mutatesStrava).toBe(false);
    }
  });
});
