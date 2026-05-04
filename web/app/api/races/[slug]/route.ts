/**
 * /api/races/[slug] — read / delete a single race, plus PATCH for
 * meta + actualResult.
 *
 * GET    → SavedRace | 404
 * DELETE → { ok: true }
 * PATCH  → updates meta and/or actual_result. Both fields optional;
 *          send only what you want to change. The plan + GPX are
 *          NEVER touched here — use /rebuild for that.
 */

import { deleteRaceDB, getRaceDB, setActualResultDB, saveRaceDB } from '../../../../lib/race-store';
import type { ActualResult, SavedRace } from '../../../../lib/storage-types';
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
  let body: { actualResult?: ActualResult | null; meta?: SavedRace['meta'] };
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  if (body.actualResult !== undefined) {
    await setActualResultDB(slug, body.actualResult);
  }
  if (body.meta) {
    const existing = await getRaceDB(slug);
    if (!existing) return new Response('Not found', { status: 404 });
    // Merge — don\'t let a partial meta erase fields the caller didn\'t send.
    const mergedMeta = { ...existing.meta, ...body.meta };
    await saveRaceDB({ ...existing, meta: mergedMeta });
  }
  return Response.json({ ok: true });
}
