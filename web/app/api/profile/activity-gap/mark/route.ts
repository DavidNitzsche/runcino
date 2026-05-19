/**
 * POST /api/profile/activity-gap/mark
 *
 * Body: { mark: 'planned' | 'injured' | null }
 *
 * Records the user's response to E1/E4 surface affordances. null
 * clears any existing mark (resume normal training prompts).
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { setActivityGapMark } from '@/lib/strava-gap';

interface Body { mark?: 'planned' | 'injured' | null }

export async function POST(req: Request) {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const mark = body.mark;
  if (mark !== null && mark !== 'planned' && mark !== 'injured') {
    return NextResponse.json({ error: 'mark must be planned, injured, or null' }, { status: 400 });
  }

  await setActivityGapMark(user.id, mark);
  return NextResponse.json({ ok: true, mark });
}
