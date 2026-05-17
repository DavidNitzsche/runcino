/**
 * GET /api/auth/me — returns the currently-logged-in user or null.
 * Used by client components to know if they should show signed-in UI.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}
