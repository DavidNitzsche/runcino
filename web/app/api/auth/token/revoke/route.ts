/**
 * POST /api/auth/token/revoke
 *
 * Revoke a refresh token + its associated access tokens.  The
 * "log out this device" flow for native clients.  Idempotent: revoking
 * an already-revoked or unknown token returns ok without error (no
 * leakage about which case).
 *
 * Request:  { refreshToken }
 * Response: { ok: true }
 *
 * Tier 1 stable public.
 *
 * WHY ALSO REVOKE ACCESS TOKENS
 * Explicit logout should mean the device is fully signed out, not just
 * unable to refresh.  An access token with 12 hours left should not
 * remain valid after the user taps "Log out."  See lib/auth-tokens.ts
 * revokeRefreshToken() for the cascade.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { revokeRefreshToken } from '@/lib/auth-tokens';

interface RevokeRequest {
  refreshToken?: string;
}

export async function POST(req: NextRequest) {
  let body: RevokeRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const refreshToken = body.refreshToken;
  if (!refreshToken || typeof refreshToken !== 'string') {
    // Even with no token, return ok — idempotent / opaque.  Callers
    // who pass nothing get the same response as callers who pass a
    // valid token.
    return NextResponse.json({ ok: true });
  }

  await revokeRefreshToken(refreshToken);
  return NextResponse.json({ ok: true });
}
