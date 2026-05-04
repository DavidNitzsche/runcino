/**
 * /api/races/[slug] — read / delete a single race, plus result PATCH.
 *
 * GET    → SavedRace | 404
 * DELETE → { ok: true }
 * PATCH  → updates only actual_result; safer than the POST /api/races
 *          full-overwrite path because the plan + GPX stay untouched.
 */

import { deleteRaceDB, getRaceDB, setActualResultDB } from '../../../../lib/race-store';
import type { ActualResult } from '../../../../lib/storage-types';
import { ensureSeed } from '../../../../lib/seed-server';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  await ensureSeed();
  const { slug } = await params;
  const race = await getRaceDB(slug);
  if (!race) return new Response('Not found', { status: 404 });
  return Response.json({ race });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await deleteRaceDB(slug);
  return Response.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let body: { actualResult: ActualResult | null };
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }
  await setActualResultDB(slug, body.actualResult ?? null);
  return Response.json({ ok: true });
}
