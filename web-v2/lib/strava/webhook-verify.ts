/**
 * Strava webhook claim verification.
 *
 * ── Why this exists (2026-08-21 · multi-tenancy audit) ────────────────
 *
 * Strava does not sign webhook deliveries. There is no HMAC, no shared
 * secret in a header, nothing that proves a POST to our callback came
 * from Strava rather than from anyone on the internet. The route's three
 * gates were:
 *
 *   Layer 1  subscription_id must exist in strava_webhook_subscriptions
 *   Layer 2  owner_id must map to one of our runners
 *   Layer 3  optional ?key= shared secret on the callback URL
 *
 * Layer 3 is off in production (STRAVA_WEBHOOK_SECRET_PATH unset, and
 * `secretKeyOk` returns true when unset). Layer 1 is a small integer that
 * appears in a source comment. Layer 2 is a Strava athlete id, which is
 * PUBLIC — strava.com/athletes/<id>. So neither remaining layer is a
 * secret, and every field the processor acted on came from the request
 * body. A forged `aspect_type: 'delete'` hard-deleted a named runner's
 * runs; a forged `create` injected a foreign activity into their log; a
 * forged athlete deauthorize severed their Strava connection.
 *
 * ── The rule this module encodes ─────────────────────────────────────
 *
 * The webhook body is a HINT that something may have changed. It is not
 * an instruction. Before any destructive or state-changing action, the
 * claim is re-verified against Strava's API using THAT RUNNER'S OWN
 * OAuth token — the one piece of the exchange an attacker cannot forge.
 *
 * Verification fails safe. If Strava contradicts the claim we refuse. If
 * we cannot reach Strava, or the runner has no usable token, we also
 * refuse — a delete we could not confirm is not a delete we perform. The
 * nightly poll heals anything a refusal defers, so the cost of refusing
 * is latency; the cost of acting is another runner's training history.
 *
 * This closes the hole without an ops action. Turning Layer 3 on is
 * still worth doing (it needs a re-subscribe so the key lands in the
 * registered callback URL), but it is a second lock on the same door,
 * not a substitute for not trusting the body.
 */

/** What the processor should do with a claimed deletion. */
export type DeleteVerdict =
  | { act: true; reason: 'confirmed_gone' }
  | { act: false; reason: 'still_exists' | 'unverifiable' };

/** What the processor should do with a claimed deauthorization. */
export type DeauthVerdict =
  | { act: true; reason: 'confirmed_revoked' }
  | { act: false; reason: 'token_still_valid' | 'unverifiable' };

/**
 * Decide whether a claimed activity deletion is real, given the HTTP
 * status Strava returned when we asked for that activity with the
 * owner's token.
 *
 *   404 / 410 → Strava agrees the activity is gone. Act.
 *   2xx       → the activity is still there. The claim is false; refuse.
 *   anything else (401, 429, 5xx, network error → null) → we do not
 *               know. Refuse. A poll will heal it.
 */
export function decideDelete(stravaStatus: number | null): DeleteVerdict {
  if (stravaStatus === 404 || stravaStatus === 410) {
    return { act: true, reason: 'confirmed_gone' };
  }
  if (stravaStatus != null && stravaStatus >= 200 && stravaStatus < 300) {
    return { act: false, reason: 'still_exists' };
  }
  return { act: false, reason: 'unverifiable' };
}

/**
 * Decide whether a claimed athlete deauthorization is real, given the
 * HTTP status Strava returned for an authenticated probe with the
 * runner's stored token.
 *
 *   401 / 403 → the token no longer works. The revocation is real. Act.
 *   2xx       → the token still works. The claim is false; refuse.
 *   anything else → unknown. Refuse.
 */
export function decideDeauth(stravaStatus: number | null): DeauthVerdict {
  if (stravaStatus === 401 || stravaStatus === 403) {
    return { act: true, reason: 'confirmed_revoked' };
  }
  if (stravaStatus != null && stravaStatus >= 200 && stravaStatus < 300) {
    return { act: false, reason: 'token_still_valid' };
  }
  return { act: false, reason: 'unverifiable' };
}

/**
 * Confirm a fetched activity actually belongs to the athlete the event
 * named. Strava's /activities/{id} can return activities the token can
 * merely SEE rather than own, so a forged create/update naming a
 * stranger's public activity would otherwise land that stranger's run
 * in our runner's log — inflating their volume and their fitness read.
 *
 * Absent athlete id is treated as NOT matching. An activity we cannot
 * attribute is one we do not store.
 */
export function activityBelongsToOwner(activity: unknown, ownerId: number): boolean {
  if (activity == null || typeof activity !== 'object') return false;
  const athlete = (activity as { athlete?: unknown }).athlete;
  if (athlete == null || typeof athlete !== 'object') return false;
  const id = (athlete as { id?: unknown }).id;
  if (id == null) return false;
  return String(id) === String(ownerId);
}

/**
 * Ask Strava for one activity and return only the HTTP status. Used to
 * verify a delete claim — we do not care about the body, only whether
 * the activity is still there.
 *
 * Returns null when the request could not be made or completed, which
 * both verdict functions treat as "unverifiable" → refuse.
 */
export async function probeActivityStatus(
  token: string,
  activityId: number | string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const resp = await fetchImpl(
      `https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=false`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    return resp.status;
  } catch {
    return null;
  }
}

/**
 * Probe whether a runner's stored Strava token still authenticates.
 * /athlete is the cheapest authenticated endpoint Strava offers.
 */
export async function probeAthleteStatus(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const resp = await fetchImpl('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    return resp.status;
  } catch {
    return null;
  }
}
