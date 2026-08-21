import { describe, it, expect } from 'vitest';
import { stateIsFresh, stateIssuedAt, STATE_TTL_MS } from './strava-state';

describe('Strava OAuth state freshness', () => {
  const now = 1_755_800_000_000;

  it('accepts a state signed moments ago', () => {
    expect(stateIsFresh(`${now - 3_000}-abcd1234`, now)).toBe(true);
  });

  it('refuses a state older than the TTL', () => {
    expect(stateIsFresh(`${now - STATE_TTL_MS - 1}-abcd1234`, now)).toBe(false);
  });

  it('refuses a nonce with no timestamp — the shape that used to work forever', () => {
    expect(stateIsFresh('abcd1234', now)).toBe(false);
  });

  it('refuses a state issued in the future', () => {
    expect(stateIsFresh(`${now + 60_000}-abcd1234`, now)).toBe(false);
  });

  it('reads the issue time back', () => {
    expect(stateIssuedAt(`${now}-xyz`)).toBe(now);
    expect(stateIssuedAt('xyz')).toBeNull();
    expect(stateIssuedAt('-xyz')).toBeNull();
    expect(stateIssuedAt('notanumber-xyz')).toBeNull();
  });
});
