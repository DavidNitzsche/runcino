/**
 * /api/runner-profile — single-row runner profile, server-side.
 *
 * Replaces the localStorage-only path so the profile (birth year,
 * sex, HRmax, RHR) is cross-device synced and visible to the
 * server-side coach engine. Single row, no auth yet.
 *
 *   GET  → { profile: RunnerProfile }
 *   PUT  → body: Partial<RunnerProfile> → { profile: RunnerProfile }
 */

import { getRunnerProfile, setRunnerProfile, type RunnerProfile } from '../../../lib/runner-profile-store';

export async function GET() {
  try {
    const profile = await getRunnerProfile();
    return Response.json({ profile });
  } catch (e) {
    return Response.json(
      { profile: null, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  let body: Partial<RunnerProfile>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  try {
    const profile = await setRunnerProfile(body);
    return Response.json({ profile });
  } catch (e) {
    return Response.json(
      { profile: null, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
