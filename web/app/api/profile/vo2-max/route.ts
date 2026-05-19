/**
 * /api/profile/vo2-max — read + write for the Apple Health VO2max
 *  manual entry.
 *
 *  GET  → { ok, value, updatedAt, source } — current Apple VO2max.
 *  POST { value: number | null } → upsert (null clears).
 *
 *  Apple VO2max is a WELLNESS signal. This endpoint exists to capture
 *  it for trend display and cold-start fallback only — it never feeds
 *  the pace/zone/feasibility engine. See lib/vo2max-apple.ts.
 *
 *  Separate from /api/profile/edit because the value needs to be
 *  editable even when the user hasn't filled in name/age (the full
 *  profile validator rejects empty identity fields).
 */

import { getProfile } from '../../../../lib/profile-store';
import { saveVo2MaxApple } from '../../../../lib/profile-write';
import { buildVo2MaxApple } from '../../../../lib/vo2max-apple';

export async function GET() {
  try {
    const profile = await getProfile();
    const apple = buildVo2MaxApple(
      profile?.vo2max_apple ?? null,
      profile?.vo2max_apple_updated_at ?? null,
    );
    return Response.json({
      ok: true,
      value: apple.value,
      updatedAt: apple.updatedAt,
      source: apple.source,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { value?: number | string | null };
  try {
    body = (await req.json()) as { value?: number | string | null };
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const saved = await saveVo2MaxApple(body.value ?? null);
    const apple = buildVo2MaxApple(saved.value, saved.updatedAt);
    return Response.json({
      ok: true,
      value: apple.value,
      updatedAt: apple.updatedAt,
      source: apple.source,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isValidation = /between 25 and 90|must be a number/i.test(msg);
    return Response.json(
      { ok: false, error: msg },
      { status: isValidation ? 400 : 500 },
    );
  }
}
