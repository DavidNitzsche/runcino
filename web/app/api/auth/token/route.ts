/**
 * POST /api/auth/token
 *
 * Exchange email + password for an access + refresh token pair.  The
 * native-client equivalent of /api/auth/login (which sets a cookie).
 *
 * Request:  { email, password }
 * Response: { accessToken, refreshToken, expiresIn, user }
 *
 * Tier 1 stable public per docs/api/tier-1-stable-public.md.
 *
 * SECURITY NOTES
 * - Returns the same generic "Invalid email or password" for unknown
 *   email vs wrong password, to avoid user enumeration.
 * - No rate limiting implemented yet; same posture as /api/auth/login.
 *   Both should gain per-IP rate limits in a hardening pass before
 *   any non-trusted clients can hit them.
 * - Tokens are 32-byte base64url opaque strings, stored in the
 *   sessions table.  See lib/auth-tokens.ts for the token machinery.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyPassword } from '@/lib/auth';
import { query } from '@/lib/db';
import { issueTokens } from '@/lib/auth-tokens';

interface TokenRequest {
  email?: string;
  password?: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  onboarding_complete: boolean;
  location: string | null;
  status: string;
  is_admin: boolean;
  max_hr: number | null;
  accent_color: string | null;
  password_hash: string;
}

export async function POST(req: NextRequest) {
  let body: TokenRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  if (email.length > 254 || password.length > 256) {
    return NextResponse.json({ error: 'email or password too long' }, { status: 400 });
  }

  const rows = await query<UserRow>(
    `SELECT id, email, name, onboarding_complete, location, status, is_admin, max_hr, accent_color, password_hash
       FROM users
      WHERE email = $1
      LIMIT 1`,
    [email],
  );
  const user = rows[0];
  if (!user) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  if (user.status !== 'active') {
    // Match the web flow: pending users land at /pending, but for
    // native clients we surface the state explicitly so the iPhone
    // app can show the right UI (waiting-for-approval screen).
    return NextResponse.json(
      { error: 'Account not active', status: user.status },
      { status: 403 },
    );
  }

  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const userAgent = req.headers.get('user-agent') || null;

  const pair = await issueTokens(user.id, { ipAddress, userAgent });
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

  return NextResponse.json({
    ...pair,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      onboardingComplete: user.onboarding_complete,
      location: user.location,
      status: user.status,
      isAdmin: user.is_admin,
      maxHr: user.max_hr,
      accentColor: user.accent_color,
    },
  });
}
