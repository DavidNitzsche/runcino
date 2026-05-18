/**
 * /api/profile/accent — write-only accent color picker.
 *
 * Separate from /api/profile/edit because the picker should work even
 * before the user has filled in name/age (the validator on /edit
 * rejects empty identity fields).
 *
 * POST { accent_color: '#RRGGBB' | null } → { ok, accent_color }
 *   null resets to the canonical Runcino blue.
 */

import { saveAccentColor } from '../../../../lib/profile-write';

export async function POST(req: Request) {
  let body: { accent_color?: string | null };
  try {
    body = (await req.json()) as { accent_color?: string | null };
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const accent_color = await saveAccentColor(body.accent_color ?? null);
    return Response.json({ ok: true, accent_color });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isValidation = /hex|must be/i.test(msg);
    return Response.json({ ok: false, error: msg }, { status: isValidation ? 400 : 500 });
  }
}
