/**
 * POST /api/sick/recovery — body { today: 'better'|'same'|'worse'|'recovered' }
 *
 * Records one daily trend check on the runner's active sick episode. The
 * "Ready to run?" CTA on the return-gate card POSTs { today: 'recovered' }.
 *
 * Rules per the design doc §07:
 *   - 'recovered' → clears the episode (sets cleared_at = now()). The
 *                   resolver next reads no active episode → returns to
 *                   the base-4 surface (easy/long/quality/rest).
 *   - 'better'    → trend logged.
 *   - 'same'      → trend logged.
 *   - 'worse'     → trend logged. (Future · could escalate to a
 *                   "consider clinical input" surface on day 7+.)
 *
 * The recovery gates (fever-free 24h + sleep ≥ 7h + RHR within +5 of
 * baseline) are EVALUATED in the resolver/glance-state — the API doesn't
 * gate the 'recovered' POST. The UI hides the CTA until gates clear.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { attempt } from '@/lib/db/read';
import { requireUserId } from '@/lib/auth/session';
import { runnerTimezone } from '@/lib/runtime/runner-tz';
import { nothingOpenBody } from '@/lib/health/checkin-refusal';

type SickTrend = 'better' | 'same' | 'worse' | 'recovered';

interface RecoveryBody {
  today: SickTrend;
}

async function readJson(req: NextRequest): Promise<Partial<RecoveryBody>> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as Partial<RecoveryBody>;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await readJson(req);
  const valid: SickTrend[] = ['better', 'same', 'worse', 'recovered'];
  if (!body.today || !valid.includes(body.today)) {
    return NextResponse.json(
      { error: 'today must be one of better|same|worse|recovered' },
      { status: 400 },
    );
  }

  try {
    const active = (await pool.query(
      `SELECT id FROM sick_episodes
        WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC
        LIMIT 1`,
      [userId],
    )).rows[0];

    if (!active) {
      // INJURYCHECKIN-1 · the same permanent refusal as the niggle twin. A
      // "recovered" that landed and lost its answer clears the episode, so the
      // Retry the phone offers arrives HERE — and "trying again is safe" over
      // a request that can never succeed again is the lie this closes.
      return NextResponse.json(nothingOpenBody('sick'), { status: 404 });
    }

    // 2026-08-24 · `sick_recovery` did not exist in production — migration 117
    // declares it alongside `sick_episodes` and only the first table landed.
    // This INSERT threw, the handler answered 500 "recovery insert failed", and
    // the `cleared_at` update below never ran. A runner tapping "recovered" got
    // an error and STAYED MARKED SICK, so the plan stayed paused on an illness
    // they had told us was over.
    //
    // Two fixes, and the order matters. The table now exists (migration 154,
    // applied to prod 2026-08-24), so the trend row lands. And this `attempt()`
    // stays regardless: clearing the episode is what the runner asked for, the
    // append-only log is not worth blocking it, and the state change must not
    // be reachable by a failure in the line above it. Falsified by injecting an
    // INSERT failure on a local clone — the episode still cleared, Today still
    // handed the day back to the plan, and the failure was loud in the log.
    // INJURYCHECKIN-1 · A RETRY MUST NOT LOG THE SAME ANSWER TWICE.
    // Identical guard, identical mechanism, as `api/niggle/recovery` — read
    // that route's comment for why the natural key is (episode, answer, the
    // RUNNER'S day) and what it deliberately still lets through.
    const tz = await runnerTimezone(userId);
    const trendRow = await attempt(
      'api/sick/recovery · trend row',
      pool.query(
        `WITH existing AS (
           SELECT id FROM sick_recovery
            WHERE episode_id = $1::bigint
              AND response = $2
              AND (logged_at AT TIME ZONE $3)::date = (now() AT TIME ZONE $3)::date
            ORDER BY logged_at ASC
            LIMIT 1
         ), inserted AS (
           INSERT INTO sick_recovery (episode_id, response)
           SELECT $1::bigint, $2
            WHERE NOT EXISTS (SELECT 1 FROM existing)
           RETURNING id
         )
         SELECT id, true  AS is_new FROM inserted
         UNION ALL
         SELECT id, false AS is_new FROM existing`,
        [active.id, body.today, tz],
      ),
    );
    // Rule 11 · THREE facts, not two. `attempt` returns null when the append
    // -only log could not be written at all, and that is NOT the same as
    // "already had it". A failed log must never read as a successful dedup,
    // so `deduplicated` is only ever true on a row this query actually saw.
    const deduplicated = trendRow.ok && trendRow.value.rows[0]?.is_new === false;

    if (body.today === 'recovered') {
      // ───────────────────────────────────────────────────────────────────
      // TODAYWRITE-2 (2026-09-08) · "RECOVERED" RESOLVES EVERY ACTIVE
      // EPISODE, NOT THE ONE ROW THIS HANDLER HAPPENED TO SELECT.
      //
      // This was `WHERE id = $1` off the `LIMIT 1` select above. With the
      // POST route's old bare INSERT, a phone retry after a lost response
      // opened a SECOND active episode — so "recovered" cleared the newest
      // and the FIRST one stayed active forever. The runner had said they
      // were better, the app agreed for one request, and the next read
      // picked up the leftover row and put them back in forced rest with no
      // affordance anywhere to clear it.
      //
      // POST now refuses to create the duplicate in the first place. This is
      // the second half: the runner's "I am better" is a statement about
      // THEMSELVES, so it resolves everything that statement covers,
      // including any duplicate already sitting in the table from before
      // that guard existed. The trend row above is still recorded against
      // the episode the runner was actually looking at.
      const cleared = await pool.query(
        `UPDATE sick_episodes
            SET cleared_at = now()
          WHERE COALESCE(user_uuid, user_id) = $1
            AND cleared_at IS NULL`,
        [userId],
      );
      return NextResponse.json({
        active: false,
        trend: 'recovered',
        // Observable on purpose: >1 means a duplicate existed and was
        // resolved rather than silently left behind.
        cleared: cleared.rowCount ?? 0,
        deduplicated,
      });
    }

    return NextResponse.json({ active: true, trend: body.today, deduplicated });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'recovery insert failed', detail: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
