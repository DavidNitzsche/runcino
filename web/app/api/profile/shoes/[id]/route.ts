/**
 * /api/profile/shoes/[id] — edit / delete a single shoe.
 *
 *   GET    → return the row (used by the edit modal to pre-fill)
 *   PATCH  → partial update (brand/model/color/purposes/mileage/cap/preferred)
 *   DELETE → soft retire (sets retired=true). We never hard-delete because
 *            strava_activities.shoe_id references this row.
 *
 * All handlers require auth so anonymous callers can't poke at the
 * legacy single-user 'me' rows. The shoes table is currently shared
 * (one row per shoe, not per user), so we don't filter by user_uuid
 * here — that's a follow-up once the backfill is complete.
 */

import { requireUser } from '@/lib/auth';
import { getShoe, updateShoe } from '@/lib/shoe-store';
import type { RunType } from '@/lib/shoe-utils';

interface ShoePatchBody {
  brand?: string;
  model?: string;
  color?: string | null;
  run_types?: RunType[];
  mileage?: number;
  mileage_cap?: number | null;
  preferred?: boolean;
  retired?: boolean;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const shoe = await getShoe(Number(id));
    if (!shoe) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ shoe });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: msg },
      { status: /unauthorized/i.test(msg) ? 401 : 500 },
    );
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const body = (await req.json()) as ShoePatchBody;

    // Light validation. updateShoe ignores unset fields so a partial
    // patch only touches what the caller actually changed.
    if (body.brand !== undefined && !body.brand.trim()) {
      return Response.json({ error: 'Brand cannot be empty.' }, { status: 400 });
    }
    if (body.model !== undefined && !body.model.trim()) {
      return Response.json({ error: 'Model cannot be empty.' }, { status: 400 });
    }
    if (body.mileage !== undefined && (!Number.isFinite(body.mileage) || body.mileage < 0 || body.mileage > 5000)) {
      return Response.json({ error: 'Mileage must be 0–5000.' }, { status: 400 });
    }
    if (body.mileage_cap !== undefined && body.mileage_cap !== null && (!Number.isFinite(body.mileage_cap) || body.mileage_cap < 50 || body.mileage_cap > 2000)) {
      return Response.json({ error: 'Cap must be 50–2000 mi.' }, { status: 400 });
    }

    const shoe = await updateShoe(Number(id), {
      brand:       body.brand?.trim(),
      model:       body.model?.trim(),
      color:       body.color ?? undefined,
      run_types:   body.run_types,
      mileage:     body.mileage,
      mileage_cap: body.mileage_cap ?? undefined,
      preferred:   body.preferred,
      retired:     body.retired,
    });
    if (!shoe) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ shoe });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: msg },
      { status: /unauthorized/i.test(msg) ? 401 : 500 },
    );
  }
}

/** Soft-delete = retire. Hard-delete would orphan strava_activities.shoe_id. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const shoe = await updateShoe(Number(id), { retired: true, preferred: false });
    if (!shoe) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ shoe });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: msg },
      { status: /unauthorized/i.test(msg) ? 401 : 500 },
    );
  }
}
