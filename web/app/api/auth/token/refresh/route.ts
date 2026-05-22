/**
 * POST /api/auth/token/refresh
 *
 * Exchange a refresh token for a NEW access + refresh token pair.
 * The old refresh token is revoked atomically, refresh rotation
 * defends against replay if a token leaks.
 *
 * Request:  { refreshToken }
 * Response: { accessToken, refreshToken, expiresIn }
 *
 * Tier 1 stable public.
 *
 * SECURITY
 * - Returns generic "Invalid refresh token" for any failure mode
 *   (unknown / expired / revoked / not a refresh kind).  Don't leak
 *   which one.
 * - Each successful refresh INVALIDATES the old refresh token.  If a
 *   client tries to refresh with a stale token after rotation, they
 *   get 401, caller must re-authenticate with password.
 * - Replay window: between the moment a token is leaked and the
 *   legitimate user's next refresh, the attacker gets ONE rotation.
 *   This is the canonical refresh-rotation guarantee.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { rotateRefreshToken } from '@/lib/auth-tokens';

interface RefreshRequest {
  refreshToken?: string;
}

export async function POST(req: NextRequest) {
  let body: RefreshRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const refreshToken = body.refreshToken;
  if (!refreshToken || typeof refreshToken !== 'string') {
    return NextResponse.json({ error: 'refreshToken is required' }, { status: 400 });
  }

  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const userAgent = req.headers.get('user-agent') || null;

  const newPair = await rotateRefreshToken(refreshToken, { ipAddress, userAgent });
  if (!newPair) {
    return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
  }

  return NextResponse.json(newPair);
}
