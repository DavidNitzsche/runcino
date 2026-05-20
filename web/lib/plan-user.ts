/**
 * resolvePlanUserId — the SINGLE source of truth for "whose training
 * plan" a request operates on.
 *
 * The app is currently single-tenant: every plan (and the demo) lives
 * under the legacy 'me' key, so this returns 'me' for everyone. That
 * keeps plan READS (overview, plan-range, training, watch, the server
 * pages) and plan WRITES (skip, reschedule, adapt) pointed at the SAME
 * plan — previously reschedule resolved the real user id while reads
 * hardcoded 'me', so a logged-in user's reschedule could write to a
 * plan no read ever fetched.
 *
 * When per-user plans land, flip the policy HERE (resolve the authed
 * user via requireActiveUser, fall back to 'me' for anon) and migrate
 * plan storage — every caller stays correct because they all route
 * through this one function.
 */
export async function resolvePlanUserId(): Promise<string> {
  return 'me';
}
