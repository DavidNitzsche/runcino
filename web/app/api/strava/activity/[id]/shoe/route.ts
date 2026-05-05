import { query } from '../../../../../../lib/db';
import { addMileage } from '../../../../../../lib/shoe-store';

/** GET — return current shoe_id for this activity */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rows = await query<{ shoe_id: number | null }>(
      `SELECT shoe_id FROM strava_activities WHERE id = $1`,
      [Number(id)],
    );
    return Response.json({ shoe_id: rows[0]?.shoe_id ?? null });
  } catch (e) {
    return Response.json({ shoe_id: null, error: String(e) });
  }
}

/** PUT — assign a shoe to this activity, adjust mileage */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { shoe_id } = await req.json() as { shoe_id: number | null };
    const activityId = Number(id);

    // Get current state to compute mileage delta
    const rows = await query<{ shoe_id: number | null; distance_mi: number }>(
      `SELECT shoe_id, (data->>'distanceMi')::float AS distance_mi
       FROM strava_activities WHERE id = $1`,
      [activityId],
    );
    const row = rows[0];
    if (!row) return Response.json({ error: 'Activity not found' }, { status: 404 });

    const prevShoeId  = row.shoe_id;
    const distanceMi  = row.distance_mi ?? 0;

    // Deduct mileage from old shoe
    if (prevShoeId && prevShoeId !== shoe_id) {
      await addMileage(prevShoeId, -distanceMi);
    }

    // Add mileage to new shoe
    if (shoe_id && shoe_id !== prevShoeId) {
      await addMileage(shoe_id, distanceMi);
    }

    // Update the activity
    await query(
      `UPDATE strava_activities SET shoe_id = $1 WHERE id = $2`,
      [shoe_id, activityId],
    );

    return Response.json({ ok: true, shoe_id });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
