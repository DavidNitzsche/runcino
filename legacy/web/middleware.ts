import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from './lib/auth-constants';

/**
 * Middleware: CORS on /api/* + auth gate on protected pages.
 *
 * CORS: same permissive `*` headers as before, so the v4 mockup pages
 * hosted elsewhere can still hit the read-only API.
 *
 * Auth gate: pages outside the signed-out allowlist (landing, signup,
 * login, /api/auth/*, /api/strava/callback, static assets) require a
 * faff_session cookie. If missing, redirect to /login. The actual
 * session validity check (token exists in DB, not expired) happens in
 * server components via getCurrentUser() — middleware just checks
 * cookie presence, since middleware runs on the Edge runtime and can't
 * touch the Postgres pool.
 */

// Routes that DON'T require a session cookie
const PUBLIC_PATHS = new Set<string>([
  '/',
  '/landing',
  '/signup',
  '/login',
  '/pending',          // approval waiting room — gated by getCurrentUser internally
  '/forgot-password',
  '/reset-password',
]);

const PUBLIC_PREFIXES = [
  '/_next/',           // Next.js internals
  '/api/auth/',        // signup, login, logout, me (the routes that establish auth)
  '/api/strava/callback', // OAuth callback
  '/favicon',
  '/static/',
  '/images/',
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── CORS handling on /api/* ─────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return res;
  }

  // ── Auth gate on app pages ──────────────────────────────────────
  if (isPublic(pathname)) {
    return NextResponse.next();
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    // Not signed in → bounce to /login with a return-to param.
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  // Has a cookie — let it through. Server components will validate the
  // session against the DB and redirect if it turns out to be stale.
  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals + public assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
