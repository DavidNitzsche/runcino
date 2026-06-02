/**
 * POST /api/plan/workout/[id]/accept-standing
 *
 * Runner taps "Accept" on the standing-recommendation advisory · the
 * coach's forward counsel that shows up after a restore when readiness
 * signals still say the original prescription should ease back down.
 *
 * The standing recommendation is "second opinion forward counsel" ·
 * after the runner override the auto-adapter, the engine respectfully
 * holds its view. Accepting it = the runner says "OK, the coach was
 * right · apply that prescription."
 *
 * Body: { suggestion: {
 *   proposedType?: string;          // 'easy' | 'recovery' | 'long' | etc.
 *   proposedDistanceMi?: number;
 *   proposedDateIso?: string;       // YYYY-MM-DD for a reschedule
 * } }
 *
 * → 200 { ok: true, applied: { type, distance_mi, date_iso } }
 * → 400 { ok: false, error: 'no_changes' | 'invalid_suggestion' | 'invalid_json' }
 * → 404 { ok: false, error: 'workout_not_found' }
 *
 * Behavior (single transaction):
 *   1. Read plan_workouts by id, owner-scoped via training_plans.user_uuid
 *   2. Validate the suggestion has at least one non-null field
 *   3. Apply the suggestion to plan_workouts (type / distance_mi / date_iso)
 *   4. Coherent downgrade · when proposedType is easy/recovery/rest, ALSO
 *      clear sub_label + pace_target + workout_spec + is_quality (same
 *      coherence rule as the auto-adapter's downgrade path at
 *      lib/plan/adapt.ts:200-211)
 *   5. Write coach_intents row · reason='plan_adapt_accepted' so the
 *      standing-recommendation composer at lib/coach/standing-
 *      recommendation.ts:checkAcceptedProposal clears the row on next
 *      render (the composer reads this exact reason · see line 242)
 *   6. Return the applied fields so frontend can optimistically update
 *
 * Brief: designs/briefs/standing-recommendation-accept-endpoint-brief.md
 * Companion to: /api/plan/restore (the override path) ·
 *               lib/coach/standing-recommendation.ts (the read composer)
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface SuggestionBody {
  proposedType?: string;
  proposedDistanceMi?: number;
  proposedDateIso?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { id: workoutId } = await params;
  if (!workoutId || workoutId === 'null' || workoutId === 'undefined') {
    return NextResponse.json({ ok: false, error: 'workout_not_found' }, { status: 404 });
  }

  let body: { suggestion?: SuggestionBody };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const sug = body?.suggestion;
  if (!sug || typeof sug !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_suggestion' }, { status: 400 });
  }

  const proposedType = typeof sug.proposedType === 'string' ? sug.proposedType.trim().toLowerCase() : null;
  const proposedDistanceMi = typeof sug.proposedDistanceMi === 'number' && Number.isFinite(sug.proposedDistanceMi)
    ? sug.proposedDistanceMi
    : null;
  const proposedDateIso = typeof sug.proposedDateIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sug.proposedDateIso)
    ? sug.proposedDateIso
    : null;

  if (proposedType == null && proposedDistanceMi == null && proposedDateIso == null) {
    return NextResponse.json({ ok: false, error: 'no_changes' }, { status: 400 });
  }

  // Validate proposedType against the canonical set the adapter uses.
  const VALID_TYPES = new Set(['easy', 'recovery', 'rest', 'long', 'tempo', 'threshold', 'intervals']);
  if (proposedType != null && !VALID_TYPES.has(proposedType)) {
    return NextResponse.json({ ok: false, error: 'invalid_suggestion' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Read · owner-scoped via training_plans.user_uuid join.
    const row = (await client.query<{
      id: string;
      plan_id: string;
      type: string;
      sub_label: string | null;
      distance_mi: string | null;
      date_iso: string;
    }>(
      `SELECT pw.id, pw.plan_id, pw.type, pw.sub_label,
              pw.distance_mi::text, pw.date_iso::text
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE pw.id = $1
          AND tp.user_uuid = $2::uuid
          AND tp.archived_iso IS NULL
        LIMIT 1`,
      [workoutId, userId],
    )).rows[0];

    if (!row) {
      await client.query('ROLLBACK');
      return NextResponse.json({ ok: false, error: 'workout_not_found' }, { status: 404 });
    }

    // 2. Apply the suggestion. Coherent-downgrade rule mirrors the
    //    auto-adapter (lib/plan/adapt.ts:200-211) · when the new type
    //    is easy/recovery/rest, also clear sub_label + pace_target +
    //    workout_spec + is_quality so downstream consumers don't read
    //    contradictory signals.
    const clearsQuality = proposedType != null && ['easy', 'recovery', 'rest'].includes(proposedType);

    // Build the UPDATE dynamically so we only touch fields the
    // suggestion specifies (a date-only reschedule shouldn't reset type).
    const setClauses: string[] = [];
    const params_: unknown[] = [];
    let p = 1;

    if (proposedType != null) {
      setClauses.push(`type = $${p++}`);
      params_.push(proposedType);
      if (clearsQuality) {
        // PRESERVE original_sub_label so the chip can render "was X"
        // if it isn't already preserved · same logic as the adapter.
        setClauses.push(`original_sub_label = COALESCE(original_sub_label, sub_label)`);
        setClauses.push(`sub_label = NULL`);
        setClauses.push(`pace_target_s_per_mi = NULL`);
        setClauses.push(`is_quality = false`);
        setClauses.push(`workout_spec = NULL`);
        setClauses.push(`is_long = (CASE WHEN $${p} = 'long' THEN is_long ELSE false END)`);
        params_.push(proposedType); // reuse for the CASE check (same value)
        p++;
      }
    }
    if (proposedDistanceMi != null) {
      setClauses.push(`distance_mi = $${p++}`);
      params_.push(proposedDistanceMi);
    }
    if (proposedDateIso != null) {
      setClauses.push(`date_iso = $${p++}::date`);
      params_.push(proposedDateIso);
    }

    params_.push(workoutId);
    await client.query(
      `UPDATE plan_workouts SET ${setClauses.join(', ')} WHERE id = $${p}`,
      params_,
    );

    // 3. Audit · plan_adapt_accepted row in coach_intents. The standing-
    //    recommendation composer (lib/coach/standing-recommendation.ts:
    //    checkAcceptedProposal) reads exactly this reason+field combo
    //    to clear the standing rec on next render. Without this row the
    //    composer would re-emit the same advisory.
    await client.query(
      `INSERT INTO coach_intents
         (user_id, user_uuid, ts, reason, field, value)
       VALUES ($1::uuid, $1::uuid, NOW(), 'plan_adapt_accepted', $2::text, $3::jsonb)`,
      [
        userId,
        workoutId,
        JSON.stringify({
          domain: 'plan',
          severity: 'soft',
          body: `Runner accepted standing recommendation · applied ${proposedType ?? 'change'}.`,
          source: 'standing_recommendation_accept',
          accepted_type: proposedType,
          accepted_distance_mi: proposedDistanceMi,
          accepted_date_iso: proposedDateIso,
        }),
      ],
    );

    // 4. Read back the applied fields so caller can optimistically update.
    const after = (await client.query<{ type: string; distance_mi: string; date_iso: string }>(
      `SELECT type, distance_mi::text, date_iso::text FROM plan_workouts WHERE id = $1`,
      [workoutId],
    )).rows[0];

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      applied: {
        type: after.type,
        distance_mi: after.distance_mi ? Number(after.distance_mi) : null,
        date_iso: after.date_iso,
      },
    });
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[accept-standing] failed:', msg);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
