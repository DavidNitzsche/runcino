/**
 * /api/runs/[id]/rpe — post-run subjective RPE + notes per activity.
 *
 * Ports the legacy /api/activity/rpe path (legacy/web/app/api/activity/rpe)
 * to the v2 URL shape `/api/runs/[id]/rpe`. Same write target:
 * `post_run_rpe` table (UNIQUE on user_id + activity_id).
 *
 * GET  /api/runs/{id}/rpe                → { ok, rpe: { rpe, notes, logged_at } | null }
 * POST /api/runs/{id}/rpe { rpe, notes }  → { ok, rpe: { rpe, notes, logged_at } }
 *
 * Coach reads via /api/runs/[id] (loadRunDetail) to enrich the FORM
 * verdict. When subjectiveRpe ≥ 7 on a planned-easy day, the coach
 * reads it as a fatigue signal and softens tomorrow's prescription.
 *
 * Cite: docs/SYSTEM_AUDIT_2026-05-30.md SIM-04 finding — the v2 stack
 * had no RPE writer (legacy route was orphaned by the v2 cutover).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CANONICAL-ROW RESOLUTION, ADDED 2026-09-03
 *
 * Every write here used to key on `activityId` LITERALLY — whatever string
 * the client sent, straight into `post_run_rpe.activity_id`, no check
 * against `runs` at all. `resolveCanonicalRunRowId` is this app's one
 * answer to "which row does this id actually name" (Rule 14: "a query
 * names the population it reads"), already load-bearing on the sibling
 * shoe-assignment PATCH in `app/api/runs/[id]/route.ts` for the identical
 * failure shape — a spelling of an id that resolves to an ABSORBED row
 * writes an RPE nobody's canonical run ever shows again, because every
 * reader of `post_run_rpe` (this GET, and `loadRunDetail`'s FORM read) joins
 * on the survivor's id, never the loser's.
 *
 * GET falls back to the OLD literal-id read only when the id could not be
 * resolved for the ordinary, non-adversarial reason ('no_such_run' — an id
 * from a source this resolver's five rungs do not cover yet) rather than
 * silently reading nothing; POST does not fall back at all, because
 * writing on an unresolved id is exactly the orphaned-record risk this
 * exists to close. An 'ambiguous_day' refusal is loud on both verbs — Rule
 * 11: a day that COULD be either of two runs is not the same fact as "no
 * run", and guessing between them is how the wrong run gets a rating that
 * looks like the runner logged it purposefully.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { resolveCanonicalRunRowId } from '@/lib/runs/canonical-ref';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  if (!id) return NextResponse.json({ ok: false, error: 'activity id required' }, { status: 400 });

  const ref = await resolveCanonicalRunRowId(userId, id);
  if (!ref.ok && ref.reason === 'ambiguous_day') {
    return NextResponse.json({
      ok: false,
      error: 'This date has more than one run and the id given does not name one of them.',
    }, { status: 409 });
  }
  // A resolved canonical id AND the literal fallback both reach the same
  // query — the fallback exists only for an id shape the resolver's five
  // rungs do not cover, so a legitimate read is never turned into a false
  // "nothing recorded" by this change.
  const keyId = ref.ok ? ref.rowId : id;

  const r = await pool.query(
    `SELECT rpe, notes, logged_at::text AS logged_at
       FROM post_run_rpe
      WHERE (user_uuid = $1 OR user_id::text = $1::text) AND activity_id = $2
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId, keyId],
  ).catch(() => ({ rows: [] }));
  return NextResponse.json({ ok: true, rpe: r.rows[0] ?? null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id: activityId } = await params;
  if (!activityId) return NextResponse.json({ ok: false, error: 'activity id required' }, { status: 400 });

  let body: { rpe?: number | null; notes?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  // RPE is 1-10 per Borg CR10. Clamp to range; null is allowed (clears
  // a previously-set value).
  const rpe = body.rpe == null ? null : Math.min(10, Math.max(1, Number(body.rpe)));
  const notes = (typeof body.notes === 'string' && body.notes.trim()) || null;

  // THE WRITE NEVER FALLS BACK TO THE LITERAL ID. Unlike the GET above, an
  // unresolved id here refuses outright — see the file header for why a
  // write is the exact risk this closes.
  const ref = await resolveCanonicalRunRowId(userId, activityId);
  if (!ref.ok) {
    const message = ref.reason === 'ambiguous_day'
      ? 'This date has more than one run and the id given does not name one of them.'
      : 'No run on this account matches that id.';
    return NextResponse.json({ ok: false, error: message }, { status: ref.reason === 'ambiguous_day' ? 409 : 404 });
  }
  const canonicalId = ref.rowId;

  try {
    // UPSERT — the table's UNIQUE constraint is (user_id, activity_id).
    // user_id is TEXT for legacy reasons; we pass the UUID as text so
    // the upsert key matches. `canonicalId`, never the raw request id, so
    // two different spellings of the same run's id can never produce two
    // rows.
    const r = await pool.query(
      `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
       VALUES ($1::text, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, activity_id) DO UPDATE
       SET rpe = EXCLUDED.rpe,
           notes = EXCLUDED.notes,
           user_uuid = COALESCE(post_run_rpe.user_uuid, EXCLUDED.user_uuid),
           logged_at = NOW()
       RETURNING rpe, notes, logged_at::text AS logged_at`,
      [userId, userId, canonicalId, rpe, notes],
    );

    // RPE feeds the FORM read of /api/runs/[id]. Bust the coach cache
    // so the next read sees the new value.
    await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});

    return NextResponse.json({ ok: true, rpe: r.rows[0] });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
