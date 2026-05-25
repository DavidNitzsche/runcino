/**
 * POST /api/auth/logout, deletes the session row + clears cookie.
 * Always returns 200 (idempotent, calling on a non-session is fine).
 */

import { NextResponse } from 'next/server';
import { logoutUser } from '../../../../lib/auth';

export async function POST() {
  await logoutUser();
  return NextResponse.json({ ok: true });
}
