/**
 * PATCH /api/plan/workout
 *   { plan_id, date_iso, type?, distance_mi?, sub_label? }
 *
 * Updates one plan_workouts row IN PLACE — type, distance, sub-label. It does
 * NOT move a session to another day.
 *
 * Coach picks up the change on next briefing — no separate write needed.
 *
 * ── MOVEREADJUDICATE-1 (2026-09-05) · new_date_iso RETIRED, not wired ───────
 *
 * This route used to accept `new_date_iso` and, when present, update
 * `date_iso` + `dow` + `week_id` directly against `plan_workouts` — a second,
 * silent way to move a scheduled session with NONE of the nine re-adjudication
 * checks Move-a-Run runs (no race-proximity read, no demand recompute, no
 * hard-session-spacing check, no ledger row naming what moved). The mover
 * census in `lib/brain/orchestration/_move_readjudication.test.ts` named it as
 * one of the paths bypassing re-adjudication.
 *
 * Retired rather than wired, because it was genuinely dead: `new_date_iso` had
 * exactly one caller in the whole app — `API+Toolkit.swift`'s
 * `patchPlannedWorkout(newDateIso:)` — and THAT function itself had zero
 * callers anywhere in native-v2, and nothing in web-v2 posted `new_date_iso`
 * to this route either. Per CLAUDE.md's move-census instruction ("route it
 * through MoveOrchestrator, or retire the path if it's genuinely dead"): a
 * bypass nothing calls is a bigger risk left in place than removed, because
 * the day a first caller appears it would silently reach production with no
 * re-adjudication and no discovery — this comment and the 400 below are what
 * stop that. A session that genuinely needs to move belongs on
 * `POST /api/plan/move` or `POST /api/today/reschedule`, both of which are
 * WIRED movers per that same census.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireUserId } from '@/lib/auth/session';
import { mutatePlan } from '@/lib/plan/mutate';
import { runnerToday } from '@/lib/runtime/runner-tz';

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.plan_id || !body?.date_iso) {
    return NextResponse.json({ error: 'plan_id + date_iso required' }, { status: 400 });
  }

  // Resolve plan + auth (the row must belong to the user AND be the runner's
  // ACTIVE plan · ARCHIVEDGUARD-1 (2026-09-12), Rule 14 — a plan_id the runner
  // has ever owned, including one a rebuild has already archived, must never
  // reach a write. Without `archived_iso IS NULL` here this query returned an
  // archived plan just as readily as the active one, and `mutatePlan` below
  // trusted an explicitly-supplied planId as-is (see mutate.ts's own
  // ARCHIVEDGUARD-1 comment for the shared-boundary half of this fix).
  const plan = (await pool.query(
    `SELECT id FROM training_plans WHERE id = $1 AND user_uuid = $2 AND archived_iso IS NULL`,
    [body.plan_id, userId]
  )).rows[0];
  if (!plan) return NextResponse.json({ error: 'plan not found' }, { status: 404 });

  const updates: Record<string, any> = {};
  if (body.type != null)         updates.type = body.type;
  if (body.distance_mi != null) {
    // 2026-06-01 · round all plan-row distance writes to nearest 0.5
    // (David's locked rule · "annoying numbers like 5.8"). Race rows
    // keep their exact distance (13.1 / 26.2 / 6.2 etc) · skip the
    // round when type='race'.
    const raw = Number(body.distance_mi) || 0;
    updates.distance_mi = body.type === 'race' ? raw : Math.max(0, Math.round(raw * 2) / 2);
  }
  if (body.sub_label !== undefined) updates.sub_label = body.sub_label;

  // RETIRED (2026-09-05) · see this file's header. This route no longer moves
  // a session. A caller that still sends `new_date_iso` is told exactly why
  // and where to go instead, rather than being silently ignored — Rule 11,
  // an unsupported request is a refusal, not a no-op.
  if (body.new_date_iso && body.new_date_iso !== body.date_iso) {
    return NextResponse.json(
      {
        error: 'move_not_supported',
        reason: 'This route no longer moves a workout to another day — new_date_iso was retired '
          + 'because it bypassed re-adjudication (race proximity, demand, hard-session spacing, '
          + 'the ledger). Use POST /api/plan/move or POST /api/today/reschedule instead.',
      },
      { status: 400 },
    );
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no changes' }, { status: 400 });
  }

  const cols = Object.keys(updates);
  const setSql = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const values = cols.map((c) => updates[c]);

  try {
    // Routed through the plan mutation boundary (lib/plan/mutate.ts). A manual
    // swap can change type / distance / date, so it is a 'structural' mutation:
    // the boundary rehydrates the plan before and after and refuses the edit if
    // it introduced a doctrine violation the plan did not already carry.
    const boundary = await mutatePlan<{ rowCount: number; row: unknown }>({
    // AUTHORITY (2026-09-05) · he edited this workout in the app
    authority: 'RUNNER_INITIATED',
      userUuid: userId,
      source: 'api/plan/workout PATCH',
      todayISO: await runnerToday(userId),
      planId: body.plan_id,
      detail: { date_iso: body.date_iso, updates },
      apply: async (tx) => {
        const res = await tx.query(
          `UPDATE plan_workouts SET ${setSql}
            WHERE plan_id = $1 AND date_iso = $2::text
            RETURNING date_iso, dow, type, distance_mi, sub_label`,
          [body.plan_id, body.date_iso, ...values]
        );
        return { rowCount: res.rowCount ?? 0, row: res.rows[0] };
      },
    });
    if (!boundary.ok) {
      return NextResponse.json(
        { error: 'plan_invariant_violation', violations: boundary.violations },
        { status: 409 },
      );
    }
    const r = { rowCount: boundary.value?.rowCount ?? 0, rows: [boundary.value?.row] };
    if (r.rowCount === 0) return NextResponse.json({ error: 'workout not found' }, { status: 404 });

    // Log intent so coach acknowledges the swap once. 'workout_swapped' is a
    // shared reason string other routes reuse (api/coach/proposal, api/today/
    // reschedule) so the cache-bust + acknowledgment reader matches all three —
    // left as-is; only the date-move capability above was retired.
    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, 'workout_swapped', $2, $3)`,
      [userId, body.date_iso, JSON.stringify({ date_iso: body.date_iso, ...updates })]
    ).catch(() => {});

    await bustBriefingCacheForEvent(userId, 'plan_swap');

    return NextResponse.json({ ok: true, updated: r.rows[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
