import { NextRequest, NextResponse } from 'next/server';

/**
 * CORS middleware for /api/* routes.
 *
 * The Runcino v4 redesign mockups (designs/*-v4.html) want to fetch
 * live data from the production API when opened locally or hosted on
 * a different origin. Without these headers, browsers block the
 * cross-origin requests and the pages fall back to embedded snapshot
 * data.
 *
 * Permissive (*) is acceptable here because the API is read-only and
 * returns the same data anyone with an account can see. Tighten to
 * specific origins later if a write API is added.
 */
export function middleware(req: NextRequest) {
  // Pre-flight OPTIONS — short-circuit with the CORS headers.
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Pass through and attach CORS headers to the actual response.
  const res = NextResponse.next();
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

export const config = {
  matcher: '/api/:path*',
};
