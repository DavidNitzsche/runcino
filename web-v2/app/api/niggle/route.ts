/**
 * GET    /api/niggle  — { active: NiggleRow | null }
 * POST   /api/niggle  — body { body_part, side?, severity, status, note? }
 *                       Returns { niggle_id, active: true }, plus
 *                       `deduplicated: true` when an IDENTICAL active niggle
 *                       already existed (TODAYWRITE-2, see POST below).
 * DELETE /api/niggle  — clears EVERY active niggle for this runner.
 *                       Returns { active: false, cleared: <count> }
 *
 * "Niggle" = mild musculoskeletal flag the runner reports. The runner can
 * still train; the plan does NOT pause. resolveDayState routes /today
 * through the `niggle` surface so the workout renders with awareness.
 *
 * v1 supports a SINGLE active niggle per user. The most recent active row
 * is treated as "the niggle"; older un-cleared rows are tolerated in the
 * schema but ignored by GET. (Multi-niggle is a v1.1 design problem per
 * the deck's footer Q3.)
 *
 * TODAYWRITE-2 · that "tolerated" used to mean STRANDED. An older active row
 * is invisible to GET, so the runner can never see it, and the clear paths
 * only ever cleared the newest — so it became "the niggle" the moment the
 * visible one was resolved, with no affordance anywhere to get rid of it.
 * POST now refuses to create an identical duplicate, and both clear paths
 * resolve every active row.
 *
 * Auth: requireUserId session auth · same posture as app/api/today/skip.
 *
 * Spec: docs/2026-05-28-niggle-sick-logging.html §SECTION 02 (modal),
 *       §SECTION 04 (state on /today), §SECTION 06 (recovery).
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { enqueueNotification, nextMorning0715 } from '@/lib/notifications/enqueue';
import { renderNiggleCheck } from '@/lib/notifications/templates';
import { requireUserId } from '@/lib/auth/session';
import { runnerTimezone } from '@/lib/runtime/runner-tz';
import { dayKeyInTz } from '@/lib/runtime/day-key';

interface NigglePostBody {
  body_part: string;
  side?: 'left' | 'right' | 'both' | null;
  severity: number;          // 1-10 (runner-anchored scale per deck §02)
  status: 'just_started' | 'few_days' | 'weeks';
  note?: string | null;
}

async function readJson<T>(req: NextRequest): Promise<Partial<T>> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as Partial<T>;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    const row = (await pool.query(
      `SELECT id, body_part, side, severity, status, note, logged_at, cleared_at
         FROM niggles
        WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC
        LIMIT 1`,
      [userId],
    )).rows[0];
    return NextResponse.json({ active: row ?? null });
  } catch (err: any) {
    return NextResponse.json({ active: null, warning: err?.message ?? String(err) });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await readJson<NigglePostBody>(req);
  if (!body.body_part || typeof body.severity !== 'number' || !body.status) {
    return NextResponse.json(
      { error: 'missing required fields', need: ['body_part', 'severity', 'status'] },
      { status: 400 },
    );
  }
  if (body.severity < 1 || body.severity > 10) {
    return NextResponse.json({ error: 'severity must be 1-10' }, { status: 400 });
  }

  try {
    // TODAYWRITE-2 (2026-09-08) · A RETRY MUST NOT OPEN A SECOND NIGGLE.
    // Identical guard, identical incident, as `app/api/sick/route.ts` POST —
    // read that route's comment for the 12-second-timeout mechanism, why the
    // key is natural rather than client-minted, why there is no time window,
    // and what this guard cannot do. The one difference is the comparison
    // columns: a niggle is identified by where it hurts and how bad, so a
    // re-report at a DIFFERENT severity is a real new report and still lands.
    const ins = await pool.query(
      `WITH existing AS (
         SELECT id FROM niggles
          WHERE COALESCE(user_uuid, user_id) = $1::uuid
            AND cleared_at IS NULL
            AND body_part = $2
            AND side IS NOT DISTINCT FROM $3
            AND severity = $4::int
            AND status = $5
            AND note IS NOT DISTINCT FROM $6
          ORDER BY logged_at ASC
          LIMIT 1
       ), inserted AS (
         INSERT INTO niggles (user_id, user_uuid, body_part, side, severity, status, note)
         SELECT $1::uuid, $1::uuid, $2, $3, $4::int, $5, $6
          WHERE NOT EXISTS (SELECT 1 FROM existing)
         RETURNING id
       )
       SELECT id, true  AS is_new FROM inserted
       UNION ALL
       SELECT id, false AS is_new FROM existing`,
      [
        userId,
        body.body_part,
        body.side ?? null,
        body.severity,
        body.status,
        body.note ?? null,
      ],
    );
    const niggleId = Number(ins.rows[0].id);
    // Already on file. Nothing written, and the daily check was enqueued when
    // the first one landed.
    if (ins.rows[0].is_new === false) {
      return NextResponse.json({ niggle_id: niggleId, active: true, deduplicated: true });
    }
    // Notifications v1 §E — enqueue the first daily check for tomorrow 07:15.
    try {
      // 2026-08-17 · resolve the runner's zone up front, so BOTH the fire
      // time and the date baked into the template body are runner-local.
      // Was: nextMorning0715(new Date()) → server-local 07:15 (07:15Z on
      // Railway = 00:15 PT), with dateIso sliced off that UTC instant.
      // enqueueNotification recomputes the FIRE TIME in the runner's zone
      // via its marker, but nothing recomputed date_iso — so the check-in
      // could be labelled with a day the runner never saw.
      const tz = await runnerTimezone(userId);
      const fireAt = nextMorning0715(new Date(), tz);
      const dateIso = dayKeyInTz(fireAt, tz);
      const tpl = renderNiggleCheck({
        user_id: userId,
        niggle_id: niggleId,
        date_iso: dateIso,
        body_part: body.body_part,
        days_active: 1,
      });
      await enqueueNotification(userId, tpl, fireAt);
    } catch { /* non-blocking */ }
    return NextResponse.json({ niggle_id: niggleId, active: true });
  } catch (err: any) {
    return NextResponse.json({
      error: 'niggle insert failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/116_niggles.sql?',
    }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    // TODAYWRITE-2 · EVERY active niggle, not just the newest. See the same
    // change in `app/api/sick/route.ts` DELETE for why an older active row
    // was both invisible to the runner and unreachable by this endpoint.
    const cleared = await pool.query(
      `UPDATE niggles
          SET cleared_at = now()
        WHERE COALESCE(user_uuid, user_id) = $1
          AND cleared_at IS NULL`,
      [userId],
    );
    return NextResponse.json({ active: false, cleared: cleared.rowCount ?? 0 });
  } catch (err: any) {
    return NextResponse.json({
      error: 'niggle delete failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
