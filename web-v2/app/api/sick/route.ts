/**
 * GET    /api/sick  — { active: SickRow | null }
 * POST   /api/sick  — body { symptoms[], started, has_fever, note? }
 *                     Returns { episode_id, active: true }, plus
 *                     `deduplicated: true` when an IDENTICAL active episode
 *                     already existed — a retried report is the same report,
 *                     not a second illness (TODAYWRITE-2, see POST below).
 * DELETE /api/sick  — clears EVERY active episode for this runner.
 *                     Returns { active: false, cleared: <count> }
 *
 * "Sick" = systemic illness. UNLIKE niggle, this PAUSES the plan —
 * resolveDayState routes /today through the `sick` state which renders
 * REST + a return-gate card.
 *
 * symptoms is a string[] of: head_cold|chest|fever|gi|aches|fatigue|voice|other
 * started:   today|yesterday|few_days|week_plus
 * has_fever: boolean (denormalized · gates DO-NOT-RUN copy + the return gate)
 *
 * Auth: requireUserId session auth (multi-user since 2026-05-30).
 *
 * Spec: docs/2026-05-28-niggle-sick-logging.html §SECTION 03 (modal),
 *       §SECTION 05 (state on /today), §SECTION 07 (recovery + gates).
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { enqueueNotification, nextMorning0715 } from '@/lib/notifications/enqueue';
import { renderSickCheck } from '@/lib/notifications/templates';
import { requireUserId } from '@/lib/auth/session';
import { runnerTimezone } from '@/lib/runtime/runner-tz';
import { dayKeyInTz } from '@/lib/runtime/day-key';

interface SickPostBody {
  symptoms: string[];
  started: 'today' | 'yesterday' | 'few_days' | 'week_plus';
  has_fever: boolean;
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
      `SELECT id, symptoms, started, has_fever, note, logged_at, cleared_at
         FROM sick_episodes
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
  const body = await readJson<SickPostBody>(req);

  if (!Array.isArray(body.symptoms) || body.symptoms.length === 0) {
    return NextResponse.json(
      { error: 'symptoms must be a non-empty array' },
      { status: 400 },
    );
  }
  if (!body.started) {
    return NextResponse.json({ error: 'started is required' }, { status: 400 });
  }
  if (typeof body.has_fever !== 'boolean') {
    return NextResponse.json({ error: 'has_fever is required (boolean)' }, { status: 400 });
  }

  try {
    // ─────────────────────────────────────────────────────────────────────
    // TODAYWRITE-2 (2026-09-08) · A RETRY MUST NOT OPEN A SECOND EPISODE.
    //
    // This was a bare INSERT. `API.authedSend` on the phone bounds a request
    // at 12 seconds (TIMEOUT-1), so a write that REACHES this route and is
    // saved, but whose answer is slower than that, settles on the phone as
    // `.didNotLand` — indistinguishable from a write that never arrived. The
    // row then offered Retry, the runner took it, and a SECOND active episode
    // was inserted.
    //
    // What that cost: GET and `/api/sick/recovery` both read
    // `ORDER BY logged_at DESC LIMIT 1`, and recovery cleared only that one
    // row. So the FIRST episode stayed active forever, the resolver kept
    // routing /today through the `sick` state, and a runner who had told the
    // app they were better stayed in forced rest with no way to say otherwise.
    //
    // The guard is a NATURAL key, not a client-minted one: an identical
    // report that is ALREADY ACTIVE is not a second illness, it is the same
    // one. That matches this table's own documented v1 contract (one active
    // episode per runner) and needs no schema change, so it is live on the
    // database as it stands today — the `idempotency_key` + partial-unique
    // pattern used by `plan_decision_ledger` rides on migrations 165-169,
    // which are NOT applied to production.
    //
    // No time window on purpose. A window would be a Rule 9 cliff: two taps a
    // hair either side of it would differ in KIND (deduped vs duplicated).
    // `cleared_at IS NULL` is the honest discrete fact, and it already lets a
    // genuinely new episode with the same symptoms open once the old one is
    // resolved.
    //
    // Symptoms are compared ORDER-INSENSITIVELY. The phone builds this array
    // from a `Set`, so two sends of one report can legitimately differ in
    // element order, and a plain jsonb `=` would call them different reports.
    //
    // WHAT THIS GUARD CANNOT DO (Rule 22): it is not atomic. Without a unique
    // index, two GENUINELY concurrent identical inserts can both see no row
    // and both write. It is a single statement, and the phone blocks a second
    // submit while one is in flight (`V5RowWriteState.isSending`), so the
    // sequential-retry case this exists for is closed; the concurrent case
    // degrades to today's behaviour, never worse.
    const CANONICAL_SYMPTOMS = `
      (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
         FROM jsonb_array_elements_text(%s) x)`;
    const ins = await pool.query(
      `WITH existing AS (
         SELECT id FROM sick_episodes
          WHERE COALESCE(user_uuid, user_id) = $1::uuid
            AND cleared_at IS NULL
            AND started = $3
            AND has_fever = $4::boolean
            AND note IS NOT DISTINCT FROM $5
            AND ${CANONICAL_SYMPTOMS.replace('%s', 'symptoms')}
              = ${CANONICAL_SYMPTOMS.replace('%s', '$2::jsonb')}
          ORDER BY logged_at ASC
          LIMIT 1
       ), inserted AS (
         INSERT INTO sick_episodes (user_id, user_uuid, symptoms, started, has_fever, note)
         SELECT $1::uuid, $1::uuid, $2::jsonb, $3, $4::boolean, $5
          WHERE NOT EXISTS (SELECT 1 FROM existing)
         RETURNING id
       )
       SELECT id, true  AS is_new FROM inserted
       UNION ALL
       SELECT id, false AS is_new FROM existing`,
      [
        userId,
        JSON.stringify(body.symptoms),
        body.started,
        body.has_fever,
        body.note ?? null,
      ],
    );
    const episodeId = Number(ins.rows[0].id);
    // The report was already on file. Nothing was written, and the daily
    // check was enqueued when the first one landed, so enqueueing again
    // would notify the runner twice for one illness.
    if (ins.rows[0].is_new === false) {
      return NextResponse.json({ episode_id: episodeId, active: true, deduplicated: true });
    }
    // Notifications v1 §E — enqueue the first daily sick check for tomorrow 07:15.
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
      const tpl = renderSickCheck({
        user_id: userId,
        episode_id: episodeId,
        date_iso: dateIso,
        days_active: 1,
      });
      await enqueueNotification(userId, tpl, fireAt);
    } catch { /* non-blocking */ }
    return NextResponse.json({ episode_id: episodeId, active: true });
  } catch (err: any) {
    return NextResponse.json({
      error: 'sick insert failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/117_sick_episodes.sql?',
    }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    // TODAYWRITE-2 · EVERY active episode, not just the newest.
    //
    // This cleared `id = (… ORDER BY logged_at DESC LIMIT 1)`. GET reads the
    // newest active row too, so any older active row was invisible to the
    // runner AND unreachable by this endpoint: it could never be cleared, and
    // it became "the episode" the moment the newest one was resolved. The
    // runner said they were better and the app put them straight back into
    // forced rest. Clearing is the runner's statement about THEMSELVES, so it
    // resolves everything that statement covers.
    const cleared = await pool.query(
      `UPDATE sick_episodes
          SET cleared_at = now()
        WHERE COALESCE(user_uuid, user_id) = $1
          AND cleared_at IS NULL`,
      [userId],
    );
    return NextResponse.json({ active: false, cleared: cleared.rowCount ?? 0 });
  } catch (err: any) {
    return NextResponse.json({
      error: 'sick delete failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
