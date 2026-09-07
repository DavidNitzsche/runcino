/**
 * GET /api/up · DEPLOY-GAP-1 (2026-09-07)
 *
 * A pure liveness probe for Railway's deploy healthcheck — no DB, no auth,
 * no write-barrier concern, nothing that can be slow or flaky. Its only job
 * is answering "is this container's HTTP server actually accepting
 * connections", so Railway can hold traffic on the OLD instance until the
 * NEW one passes this before cutting over.
 *
 * Why this exists: `railway.json` had no `healthcheckPath` and the service
 * runs a single replica (no `overlapSeconds`), so every deploy was a hard
 * swap — the old container torn down before or as the new one came up, with
 * a real gap where nothing was listening. Found live: David saw "Can't
 * reach faff" recur, closely and repeatedly, timed almost exactly against
 * several deploys made DURING the session meant to fix the very thing being
 * reported — every attempted fix was generating a fresh instance of the
 * symptom via its own deploy. This route plus the `healthcheckPath` /
 * `overlapSeconds` fields in `railway.json` are what let Railway wait for
 * readiness and overlap the handoff, so a deploy stops being a blip a phone
 * mid-fetch can land in.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return new Response('ok', { status: 200 });
}
