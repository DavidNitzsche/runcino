/**
 * /api/profile/edit — read + write path for the EDIT PROFILE modal.
 *
 * GET  → return the raw profile row for user 'me' (or null when no
 *        row exists). Used by the modal to pre-fill its inputs.
 * POST → upsert the profile row for user 'me'.
 *   Body: { full_name, age, sex?, city?, hrmax?, since_year?, rhr? }
 *   Returns: { ok: true, profile: ProfileRow }
 *
 * Validation lives in lib/profile-store.validateProfileInput so the
 * unit tests can exercise it without a live DB. Errors come back as
 * 400 + { ok: false, error }; everything else is a 500.
 *
 * No auth yet — user_id is hard-coded to 'me' to match the rest of
 * the user-scoped tables until auth lands.
 */

import { getProfile } from '../../../../lib/profile-store';
import { saveProfile } from '../../../../lib/profile-write';
import type { ProfileInput } from '../../../../lib/profile-types';

export async function GET() {
  try {
    const profile = await getProfile();
    return Response.json({ ok: true, profile });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: ProfileInput;
  try {
    body = (await req.json()) as ProfileInput;
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const row = await saveProfile(body);
    return Response.json({ ok: true, profile: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Validation errors thrown by validateProfileInput are human-
    // readable and safe to surface verbatim. DB/unknown errors fall
    // into the same bucket — the modal renders the message.
    const isValidation = /required|must be|characters or less|must be one of/i.test(msg);
    return Response.json(
      { ok: false, error: msg },
      { status: isValidation ? 400 : 500 },
    );
  }
}
