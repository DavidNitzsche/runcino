/**
 * /api/profile/accent, write the brand accent color on the user row.
 *
 * Stored on users.accent_color. The root layout reads it server-side
 * and stamps --accent / --orange onto <html>, so the entire app picks
 * the new color up on the next request.
 *
 * POST { accent_color: '#RRGGBB' | null } → { ok, accent_color }
 *   null resets to the canonical faff.run orange (#E85D26).
 */

import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

function normalizeHex(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  if (!m) throw new Error('Accent color must be a 6-digit hex like #E85D26.');
  return `#${m[1].toUpperCase()}`;
}

export async function POST(req: Request) {
  let body: { accent_color?: string | null };
  try {
    body = (await req.json()) as { accent_color?: string | null };
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  let color: string | null;
  try {
    color = normalizeHex(body.accent_color);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  try {
    const user = await requireUser();
    await query(
      `UPDATE users SET accent_color = $1, updated_at = NOW() WHERE id = $2`,
      [color, user.id],
    );
    return Response.json({ ok: true, accent_color: color });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isUnauth = /unauthorized/i.test(msg);
    return Response.json(
      { ok: false, error: msg },
      { status: isUnauth ? 401 : 500 },
    );
  }
}
