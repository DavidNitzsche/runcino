/**
 * POST /api/auth/login
 *
 * Body: { email, password }
 * Side effects: verifies bcrypt hash, sets session cookie on success.
 * Returns: { user } on success, 401 on bad creds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { loginUser } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  try {
    const user = await loginUser(email, password);
    return NextResponse.json({ user });
  } catch {
    // Don't leak whether email exists — generic 401
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }
}
