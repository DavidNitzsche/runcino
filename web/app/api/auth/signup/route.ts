/**
 * POST /api/auth/signup
 *
 * Body: { email, password, name }
 * Side effects: creates user row, sets session cookie, may run legacy
 *   backfill (claims all single-user data for the configured owner email).
 * Returns: { user: { id, email, name, onboarding_complete } }
 *
 * No email verification — defer is the v1 choice. New users are
 * immediately logged in and redirected to /onboarding by the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { signupUser } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { email, password, name } = body;
  if (!email || !password || !name) {
    return NextResponse.json({ error: 'email, password, and name are required' }, { status: 400 });
  }

  try {
    const user = await signupUser(email, password, name);
    return NextResponse.json({ user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Signup failed';
    // Postgres unique-violation: code 23505
    if (typeof (e as { code?: string })?.code === 'string' && (e as { code: string }).code === '23505') {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
