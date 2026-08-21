/**
 * Regression tests for the Strava webhook claim verification.
 *
 * Each test below fails against the pre-2026-08-21 code, which acted on
 * the webhook body directly. The hole: Strava does not sign webhook
 * deliveries, and neither surviving gate on the route was a secret —
 * subscription_id is a small integer that appeared in a source comment,
 * and owner_id is a PUBLIC Strava athlete id. An unauthenticated caller
 * could therefore hard-delete a named runner's runs, inject a stranger's
 * activity into their log, or sever their Strava connection.
 *
 * The rule these lock in: the body is a hint, the runner's own OAuth
 * token is the proof, and an unverifiable claim is refused.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  decideDelete,
  decideDeauth,
  activityBelongsToOwner,
  probeActivityStatus,
  probeAthleteStatus,
} from './webhook-verify';

describe('decideDelete · a delete claim is verified against Strava', () => {
  it('refuses when Strava says the activity is still there (the forged-delete case)', () => {
    // This is the exploit: attacker POSTs aspect_type:'delete' for an
    // activity that very much still exists. Old code deleted the row.
    const v = decideDelete(200);
    expect(v.act).toBe(false);
    expect(v.reason).toBe('still_exists');
  });

  it('acts only when Strava confirms the activity is gone', () => {
    expect(decideDelete(404)).toEqual({ act: true, reason: 'confirmed_gone' });
    expect(decideDelete(410)).toEqual({ act: true, reason: 'confirmed_gone' });
  });

  it('refuses when the claim cannot be verified — no token, rate limit, outage', () => {
    // Fail safe. A delete we could not confirm is not a delete we perform.
    for (const status of [null, 401, 403, 429, 500, 502, 503]) {
      const v = decideDelete(status);
      expect(v.act, `status ${status} must not delete`).toBe(false);
      expect(v.reason).toBe('unverifiable');
    }
  });
});

describe('decideDeauth · a revocation claim is verified against Strava', () => {
  it('refuses when the runner token still authenticates (the forged-deauth case)', () => {
    const v = decideDeauth(200);
    expect(v.act).toBe(false);
    expect(v.reason).toBe('token_still_valid');
  });

  it('acts only when Strava rejects the stored token', () => {
    expect(decideDeauth(401)).toEqual({ act: true, reason: 'confirmed_revoked' });
    expect(decideDeauth(403)).toEqual({ act: true, reason: 'confirmed_revoked' });
  });

  it('refuses on an unverifiable probe', () => {
    for (const status of [null, 429, 500]) {
      expect(decideDeauth(status).act, `status ${status}`).toBe(false);
    }
  });
});

describe('activityBelongsToOwner · a run is only stored for the athlete who owns it', () => {
  it('rejects a stranger activity aimed at another runner log', () => {
    // Forged create naming a public activity belonging to someone else.
    const foreign = { id: 555, athlete: { id: 99999 } };
    expect(activityBelongsToOwner(foreign, 12345)).toBe(false);
  });

  it('accepts the owner own activity', () => {
    expect(activityBelongsToOwner({ id: 555, athlete: { id: 12345 } }, 12345)).toBe(true);
  });

  it('compares across the number and string forms Strava mixes', () => {
    expect(activityBelongsToOwner({ athlete: { id: '12345' } }, 12345)).toBe(true);
    expect(activityBelongsToOwner({ athlete: { id: 12345 } }, 12345)).toBe(true);
  });

  it('rejects anything it cannot attribute', () => {
    expect(activityBelongsToOwner(null, 1)).toBe(false);
    expect(activityBelongsToOwner(undefined, 1)).toBe(false);
    expect(activityBelongsToOwner({}, 1)).toBe(false);
    expect(activityBelongsToOwner({ athlete: {} }, 1)).toBe(false);
    expect(activityBelongsToOwner({ athlete: { id: null } }, 1)).toBe(false);
    expect(activityBelongsToOwner('not an object', 1)).toBe(false);
  });
});

describe('probes report status and never throw', () => {
  it('probeActivityStatus returns the HTTP status', async () => {
    const fake = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await probeActivityStatus('tok', 123, fake)).toBe(404);
  });

  it('probeActivityStatus returns null on a network failure so the caller refuses', async () => {
    const fake = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const status = await probeActivityStatus('tok', 123, fake);
    expect(status).toBeNull();
    expect(decideDelete(status).act).toBe(false);
  });

  it('probeAthleteStatus returns the HTTP status and null on failure', async () => {
    const ok = (async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    expect(await probeAthleteStatus('tok', ok)).toBe(200);
    const bad = (async () => { throw new Error('timeout'); }) as unknown as typeof fetch;
    expect(await probeAthleteStatus('tok', bad)).toBeNull();
  });

  it('sends the runner own bearer token, which is what a forger cannot supply', async () => {
    let seen: string | null = null;
    const fake = (async (_url: string, init: RequestInit) => {
      seen = (init.headers as Record<string, string>).Authorization;
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    await probeActivityStatus('runner-token-abc', 77, fake);
    expect(seen).toBe('Bearer runner-token-abc');
  });
});

/**
 * Wiring lock. The pure functions above can pass while the route ignores
 * them — which is exactly the state the audit found. These assertions
 * fail if the route goes back to acting on the webhook body directly.
 */
describe('the webhook route actually calls the verification', () => {
  const routeSrc = readFileSync(
    join(process.cwd(), 'app/api/strava/webhook/route.ts'),
    'utf8',
  );

  it('probes Strava before the destructive DELETE FROM runs', () => {
    const probeAt = routeSrc.indexOf('probeActivityStatus');
    const deleteAt = routeSrc.indexOf('DELETE FROM runs');
    expect(probeAt, 'route must call probeActivityStatus').toBeGreaterThan(-1);
    expect(deleteAt, 'route still deletes runs').toBeGreaterThan(-1);
    expect(probeAt, 'the probe must come BEFORE the delete').toBeLessThan(deleteAt);
    expect(routeSrc).toContain('decideDelete');
    expect(routeSrc).toContain('delete refused');
  });

  it('verifies a claimed deauthorization before disconnecting the runner', () => {
    const probeAt = routeSrc.indexOf('probeAthleteStatus');
    const updateAt = routeSrc.indexOf('UPDATE connector_tokens');
    expect(probeAt, 'route must call probeAthleteStatus').toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(probeAt, 'the probe must come BEFORE the disconnect').toBeLessThan(updateAt);
    expect(routeSrc).toContain('decideDeauth');
  });

  it('checks activity ownership before the upsert', () => {
    const ownerAt = routeSrc.indexOf('activityBelongsToOwner');
    const upsertAt = routeSrc.indexOf('await upsertStravaActivity');
    expect(ownerAt, 'route must call activityBelongsToOwner').toBeGreaterThan(-1);
    expect(upsertAt).toBeGreaterThan(-1);
    expect(ownerAt, 'ownership check must precede the upsert').toBeLessThan(upsertAt);
  });
});
