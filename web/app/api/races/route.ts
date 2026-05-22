/**
 * /api/races, list + create race plans.
 *
 * GET → SavedRace[]   (sorted: upcoming first, then past by recency)
 * POST → SavedRace    (body is a SavedRace; upserts by slug)
 *
 * Source of truth lives in Postgres (lib/race-store.ts). The client
 * goes through this endpoint instead of localStorage so race plans
 * persist across browsers, devices, and Railway redeploys.
 */

import { listRacesDB, saveRaceDB } from '../../../lib/race-store';
import { ensureSeed } from '../../../lib/seed-server';
import { requireActiveUser } from '../../../lib/auth';
import type { SavedRace } from '../../../lib/storage-types';

export async function GET(req: Request) {
  await ensureSeed();
  let userId: string | undefined;
  try { userId = (await requireActiveUser(req)).id; } catch { /* anon ok */ }
  const races = await listRacesDB(userId);
  return Response.json({ races });
}

export async function POST(req: Request) {
  let body: SavedRace;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  if (!body || typeof body.slug !== 'string' || !body.slug || !body.plan || !body.gpxText || !body.meta) {
    return new Response('Missing required fields (slug, plan, gpxText, meta)', { status: 400 });
  }

  let userId: string | undefined;
  try { userId = (await requireActiveUser()).id; } catch { /* anon ok */ }
  await saveRaceDB(body, userId);
  return Response.json({ ok: true, slug: body.slug });
}
