/**
 * OAuth `state` freshness for the Strava connect flow.
 *
 * The state is `<payload>.<issuedAtMs>-<nonce>.<hmac>`, signed at
 * `/api/auth/strava` and verified at the callback. The signature proves the
 * state was issued by us and names which runner it belongs to.
 *
 * 2026-08-21 · a signature alone is valid FOREVER. The nonce was random per
 * request but never recorded anywhere, so it could not be consumed, and
 * nothing carried a time. Anyone who obtained a victim's signed state once
 * could use it later to link THEIR Strava account to the victim's faff
 * account — backfilling a year of someone else's runs into it.
 *
 * The issue time now rides inside the signed material, so it cannot be
 * edited without breaking the HMAC, and a stale state fails the same check a
 * forged one does.
 *
 * This is a TTL, not single-use. Consuming a nonce needs somewhere to record
 * it. The window is ten minutes instead of unbounded, which closes the
 * practical attack; a store-backed one-shot is the follow-up.
 */

/// An OAuth round trip is seconds. Ten minutes is generous for a runner who
/// gets distracted on Strava's consent screen.
export const STATE_TTL_MS = 10 * 60 * 1000;

/// The issue time out of a nonce, or null for a nonce with no timestamp.
export function stateIssuedAt(nonce: string): number | null {
  const dash = nonce.indexOf('-');
  if (dash <= 0) return null;
  const ms = Number(nonce.slice(0, dash));
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function stateIsFresh(nonce: string, now: number = Date.now()): boolean {
  const issued = stateIssuedAt(nonce);
  // No timestamp means it was signed before this shipped. Those are exactly
  // the states the TTL exists to kill, so they are refused — an in-flight
  // OAuth at deploy time fails once and the runner taps Connect again.
  if (issued == null) return false;
  const age = now - issued;
  return age >= 0 && age <= STATE_TTL_MS;
}
