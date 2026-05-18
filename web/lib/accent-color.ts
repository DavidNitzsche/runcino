/**
 * accent-color · server-side resolver for the user's brand accent.
 *
 * The root layout calls getAccentColor() once per render and stamps
 * `--corp` / `--accent` onto <html> so the entire app picks up the
 * user's chosen color without per-component plumbing.
 *
 * Resolves defensively: if the DB is unreachable (cold start, missing
 * DATABASE_URL, schema not yet bootstrapped) we return the canonical
 * Runcino blue rather than blow up the request.
 */

import { getProfile } from './profile-store';

/** Canonical Runcino brand accent — matches `--corp` in globals.css. */
export const DEFAULT_ACCENT = '#008FEC';

export async function getAccentColor(userId = 'me'): Promise<string> {
  try {
    const p = await getProfile(userId);
    const c = p?.accent_color;
    if (c && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
    return DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}
