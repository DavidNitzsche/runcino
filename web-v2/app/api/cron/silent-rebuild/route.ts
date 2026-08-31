/**
 * POST /api/cron/silent-rebuild
 *
 * 2026-06-03 · one-shot silent plan rebuild · calls generatePlan
 * directly, bypassing fireAutoRebuild's plan_proposals audit + the
 * coach_intents pipeline. Used to land newly-shipped rules into a
 * runner's active plan without firing "your plan was adapted" banners
 * for what's essentially a backend code upgrade, not a coach decision.
 *
 * Caller:
 *   POST /api/cron/silent-rebuild
 *   Authorization: Bearer ${CRON_SECRET}
 *   Body: { userUuid: string, raceSlug?: string }
 *
 * When raceSlug is omitted, uses the active plan's race_id.
 *
 * Side effects:
 *   1. archives the current active plan (via persistPlan → clearActivePlansFor)
 *   2. inserts a fresh training_plans + plan_phases + plan_weeks + plan_workouts
 *   3. acks any plan_adapt_* coach_intents that point at the archived
 *      plan_workouts (those rows no longer exist · the banners are stale)
 *
 * 2026-08-28 · NOW WRITES THE plan_proposals ROW, THROUGH fireAutoRebuild.
 * This was the one plan writer the runner could not undo: it bypassed the
 * proposal-row write, so POST /api/plan/undo had no row pairing the archived
 * plan to its replacement and returned `not_undoable`. Routed through
 * `fireAutoRebuild` (kind 'silent_rebuild') it gains the `auto_applied`
 * pairing row, the 60-second double-dispatch dedupe, and the no_change
 * rollback. The cost, accepted: the runner sees the auto-applied notice card
 * for 24h ("engine updated · undo puts the old block back") — post-incident
 * doctrine is visibility-plus-undo, and an invisible irreversible rebuild was
 * the worse half of "silent".
 *
 * What it still does NOT do:
 *   · NO new coach_intents
 *   · NO authorship for a runner whose own coach writes their plan
 *     (COACHED-GATE-1, 2026-08-19). The gate lives at the top of
 *     `generatePlan`, so this route needs no line of its own — which is the
 *     point: this is the path that WAS missed when the gate was wired at each
 *     authoring route by hand. It is automatic and invisible by design, so a
 *     coached runner would have had their coach's plan quietly rewritten on
 *     every rules landing, with nothing on any surface to show it. Deliberate
 *     runner actions can opt out via `GenerateInput.allowCoached`; this is not
 *     one, and must never pass it.
 *
 * Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md (the rules being landed)
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { fireAutoRebuild } from '@/lib/plan/auto-rebuild';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { userUuid?: string; raceSlug?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const userUuid = body.userUuid;
  if (!userUuid) return NextResponse.json({ error: 'userUuid required' }, { status: 400 });

  // Resolve raceSlug from active plan if not provided
  let raceSlug = body.raceSlug;
  let priorPlanId: string | null = null;
  if (!raceSlug) {
    const prior = (await pool.query<{ id: string; race_id: string }>(
      `SELECT id, race_id FROM training_plans
        WHERE user_uuid = $1 AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userUuid],
    ).catch(() => ({ rows: [] }))).rows[0];
    if (!prior) {
      return NextResponse.json({ error: 'no active plan and no raceSlug provided' }, { status: 400 });
    }
    raceSlug = prior.race_id;
    priorPlanId = prior.id;
  } else {
    const prior = (await pool.query<{ id: string }>(
      `SELECT id FROM training_plans
        WHERE user_uuid = $1 AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userUuid],
    ).catch(() => ({ rows: [] }))).rows[0];
    priorPlanId = prior?.id ?? null;
  }

  // Run the rebuild · through fireAutoRebuild (2026-08-28), which runs
  // generatePlan with archiveReason 'silent_rebuild' exactly as before AND
  // writes the auto_applied plan_proposals row that pairs the archived plan
  // to its replacement — the pairing POST /api/plan/undo keys off. Also
  // brings the 60s double-dispatch dedupe and no_change handling.
  if (!raceSlug) {
    return NextResponse.json({ error: 'active plan has no race_id and no raceSlug provided' }, { status: 400 });
  }
  // ── 2026-08-30 · ENSURE THE ANCHOR BEFORE AUTHORING ──────────────────────
  //
  // The same defect plan-drift carried, in the third authoring path. This route
  // reaches `generatePlan`, which stamps `workout_spec.hr_cap_bpm` and
  // `lthr_bpm` on every easy, long and quality day from `profile.lthr` at that
  // instant and then freezes them for the length of the block. `reanchorLthr`
  // is the only thing that moves that anchor, and it runs inside a DIFFERENT
  // cron on a DIFFERENT clock.
  //
  // This route is worse-placed than plan-drift for that assumption, not better:
  // it is `workflow_dispatch` only, so it fires at an arbitrary hour chosen by
  // whoever dispatched it, with no relationship at all to 03:00 UTC. Its whole
  // purpose is to land an engine upgrade into a live block — authoring that
  // block off an anchor nobody confirmed is exactly the shape of bug it exists
  // to fix.
  //
  // `reanchorLthr` is idempotent, has a ±3 bpm noise floor, and never throws.
  let lthrEnsured = 'not_attempted';
  try {
    const { reanchorLthr } = await import('@/lib/training/lthr-reanchor-store');
    const re = await reanchorLthr(userUuid);
    lthrEnsured = re.written ? 'rewritten' : re.why;
  } catch (e) {
    lthrEnsured = 'ensure_failed';
    console.error('[silent-rebuild] LTHR ensure failed · authoring on an unconfirmed anchor:', e);
  }

  const result = await fireAutoRebuild({
    userUuid,
    raceSlug,
    kind: 'silent_rebuild',
    reasons: { trigger: 'operator_dispatch', message: 'The plan engine was updated · your block was rebuilt around the same goal. Undo puts the old block back.' },
    source: 'silent_rebuild_dispatch',
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 500 });
  }

  // Ack stale plan_adapt_* coach_intents that pointed at the now-archived
  // plan_workouts · their field column held the old workout_id. The
  // banner-rendering UI uses acknowledged_at IS NULL to surface, so
  // stamping it makes them stop showing without deleting the audit log.
  let ackedIntents = 0;
  // 2026-08-28 · only when a new block actually landed. On a no_change
  // rollback the prior plan is still the ACTIVE plan and its banners are not
  // stale — acking them would silently clear live adaptation history.
  if (priorPlanId && result.newPlanId && !result.unchanged) {
    const ack = await pool.query(
      `UPDATE coach_intents ci
          SET acknowledged_at = NOW()
        WHERE COALESCE(ci.user_uuid::text, ci.user_id::text) = $1
          AND ci.acknowledged_at IS NULL
          AND ci.reason LIKE 'plan_adapt_%'
          AND ci.field IN (
            SELECT id FROM plan_workouts WHERE plan_id = $2
          )`,
      [userUuid, priorPlanId],
    ).catch(() => ({ rowCount: 0 }));
    ackedIntents = ack.rowCount ?? 0;
  }

  return NextResponse.json({
    ok: true,
    prior_plan_id: priorPlanId,
    new_plan_id: result.newPlanId ?? null,
    // 2026-08-28 · the engine composed an identical block and rolled back —
    // nothing archived, nothing to undo, and the caller should know.
    unchanged: result.unchanged === true,
    // The undo pairing row (auto_applied) this route used to skip.
    proposal_id: result.proposalId ?? null,
    acked_stale_intents: ackedIntents,
    // 2026-08-30 · whether this route CONFIRMED profile.lthr before authoring,
    // rather than assuming run-adaptations had. `reanchorLthr`'s own reason
    // string, 'rewritten' when it moved the anchor, or 'ensure_failed'.
    lthr_ensured: lthrEnsured,
  });
}
