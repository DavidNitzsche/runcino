/**
 * Regression · a refused webhook event alerts on its own reason, and an
 * event for a non-user does not alert at all.
 *
 * 2026-08-21. ops_alerts held 73 webhook_failure rows. 52 were one athlete
 * who authorised the faff Strava application without having a faff
 * account — his ordinary runs, refused correctly, once a day, for two
 * months. The dedup window was kind-wide, so each of those benign rows
 * silenced the next six hours of webhook alerting.
 *
 * Underneath that noise, the alert that mattered was firing and being
 * missed: our own subscriptions table was empty from 2026-06-11 to
 * 2026-08-17, and 20 of David's own activities were refused at that gate.
 *
 * What David lost: the signal that his webhook was dead, for two months.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const raised = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...a: any[]) => query(...a) } }));
vi.mock('@/lib/ops/alerts', () => ({ raiseAlert: (...a: any[]) => raised(...a) }));

import { alertWebhookRejected, shouldAlert } from './webhook-alerts';

beforeEach(() => {
  query.mockReset();
  raised.mockReset();
  query.mockResolvedValue({ rows: [] }); // nothing recent → not deduped
});

describe('webhook rejection alerting', () => {
  it('does not alert for an athlete who simply has no faff account', async () => {
    await alertWebhookRejected('not_a_user', 'unknown owner_id=36523633', { ownerId: 36523633 });
    expect(raised).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(shouldAlert('not_a_user')).toBe(false);
  });

  it('alerts when our own subscription table is the problem', async () => {
    await alertWebhookRejected('our_fault', 'unknown subscription_id=347351', { subscriptionId: 347351 });
    expect(raised).toHaveBeenCalledTimes(1);
    const arg = raised.mock.calls[0][0];
    expect(arg.kind).toBe('webhook_failure');
    expect(arg.severity).toBe('error');
    expect(arg.metadata.reason).toBe('our_fault');
  });

  it('alerts on a forged event', async () => {
    await alertWebhookRejected('forged', 'delete refused, activity still exists', { objectId: 1 });
    expect(raised).toHaveBeenCalledTimes(1);
    expect(raised.mock.calls[0][0].metadata.reason).toBe('forged');
  });

  it('dedups on the reason, not on the kind', async () => {
    // The pre-fix bug in one assertion: the dedup lookup must be scoped to
    // this reason, so a different reason's recent row cannot silence it.
    await alertWebhookRejected('our_fault', 'x', {});
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toMatch(/metadata->>'reason'/);
    expect(params).toEqual(['our_fault']);
  });

  it('honours its own reason window', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] }); // recent same-reason row
    await alertWebhookRejected('our_fault', 'x', {});
    expect(raised).not.toHaveBeenCalled();
  });

  it('never throws, so the Strava ACK is never at risk', async () => {
    query.mockRejectedValue(new Error('ops_alerts missing'));
    await expect(alertWebhookRejected('our_fault', 'x', {})).resolves.toBeUndefined();
  });
});
