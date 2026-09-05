/**
 * POST /api/plan/replan · SUPERSEDED, in part, by POST /api/plan/change.
 *
 * ─── what was wrong with it ─────────────────────────────────────────────────
 *
 * This route accepted `{ reason: 'sick' | 'travel' | 'life', fromISO, toISO }`
 * and had, on 2026-08-19, no caller on either surface. Two defects mattered
 * more than the missing caller:
 *
 *   1. `fromISO` and `toISO` WERE INERT. They were validated, written into the
 *      audit blob, and never used to change a single row. All three reasons ran
 *      the same full re-author. The endpoint could not take a named week out;
 *      it could only rebuild and hope the new shape happened to suit.
 *   2. It 404'd unless the active plan carried a `race_id`, so a goal-mode or
 *      just-run runner could not use it at all — for a request ("I am away next
 *      week") that has nothing to do with whether a race is on file.
 *
 * ─── what happens now ───────────────────────────────────────────────────────
 *
 *   travel · life → `applyChange({scenario:'travel'})`. The named window is now
 *     the thing that changes: those days become rest, at most one long run is
 *     salvaged into a free day in its own week, and the return is ramped so the
 *     climb back stays under the acute-to-chronic line. Every write goes
 *     through `lib/plan/mutate.ts`, and the route no longer needs a race_id.
 *     `POST /api/plan/change` is the richer door — it previews first — and new
 *     callers should use it. This one stays for the fire-and-forget contract.
 *
 *   sick → UNCHANGED. Illness is not a scheduling problem. Research/05's
 *     return-to-run ladder resizes the block from the runner's re-entry, not
 *     from the calendar, and a surgical edit cannot express that. So this limb
 *     still rebuilds and still applies the 50 / 60 / 75% ladder, and it still
 *     requires a race to build toward.
 *
 * ─── the sick path, unchanged ───────────────────────────────────────────────
 *
 * Flow:
 *   1. Rebuild the plan via the SAME generatePlan the auto-rebuild path
 *      uses (archives the current plan, re-derives volume from current
 *      inputs, preserves race + taper shape, seals completed days).
 *   2. Apply the Research/05 return-to-run ladder to the new plan's first
 *      three weeks: 50% / 60% / 75% volume, week-1 quality downgraded to easy.
 *   3. Audit row in plan_proposals (kind 'replan', auto_applied — the
 *      runner asked for this explicitly; the diff page shows the result
 *      and a further rebuild can always re-cut it).
 *
 * Known approximation (minimum cut · documented): generatePlan derives
 * baseline volume from the last 28 days, which for an ONGOING gap still
 * includes pre-gap fitness — the week-1-3 ladder is what makes the
 * re-entry honest. Race-week rows are never touched by the ladder.
 *
 * Cite: Research/05 §return-to-run gates · Research/22 §compressed
 * timelines · docs/design/race-readiness-product-designs.md §3.5.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { mutatePlan } from '@/lib/plan/mutate';
import { generatePlan } from '@/lib/plan/generate';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { applyChange } from '@/lib/plan/replan-scenarios';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const LADDER: Array<{ scale: number; dropQuality: boolean }> = [
  { scale: 0.5, dropQuality: true },   // week 1 · 50% + no quality
  { scale: 0.6, dropQuality: false },  // week 2 · 60%
  { scale: 0.75, dropQuality: false }, // week 3 · 75%
];

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null) as
    { reason?: string; fromISO?: string; toISO?: string } | null;
  const reason = String(body?.reason ?? '');
  const fromISO = String(body?.fromISO ?? '');
  const toISO = String(body?.toISO ?? '');
  if (!['sick', 'travel', 'life'].includes(reason)
      || !/^\d{4}-\d{2}-\d{2}$/.test(fromISO) || !/^\d{4}-\d{2}-\d{2}$/.test(toISO)
      || toISO < fromISO) {
    return NextResponse.json(
      { error: 'reason (sick|travel|life) + fromISO ≤ toISO required' },
      { status: 400 },
    );
  }

  // TRAVEL and LIFE are the same request — days the runner cannot run — and
  // they are now answered by editing those days rather than re-authoring the
  // block. No race_id is needed to answer it, which is the second defect fixed.
  if (reason !== 'sick') {
    const todayISO = await runnerToday(userId);
    const out = await applyChange(userId, todayISO, { scenario: 'travel', fromISO, toISO }, null);
    if (!out.ok) {
      const status = out.code === 'no_plan' ? 404
        : out.code === 'bad_request' ? 400
        : out.code === 'unavailable' ? 422
        : 409;
      return NextResponse.json(
        {
          error: out.code,
          reason: out.reason,
          ...(out.violations ? { violations: out.violations } : {}),
          ...(out.findings ? { findings: out.findings } : {}),
        },
        { status },
      );
    }
    return NextResponse.json({
      ok: true,
      reason,
      planId: out.planId,
      // The window is no longer inert · these are the weeks it actually moved.
      weeksChanged: out.proposal.effect.weeks.map((w) => w.weekIdx),
      milesDelta: out.proposal.effect.milesDelta,
      tradeOff: out.proposal.tradeOff,
    });
  }

  // Active plan → the race we're still building toward. Illness only.
  const plan = (await pool.query<{ id: string; race_id: string | null }>(
    `SELECT id, race_id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!plan?.race_id) {
    return NextResponse.json({ error: 'no active race-prep plan to replan' }, { status: 404 });
  }

  try {
    // 1 · regenerate (archives the old plan internally · same path as
    // auto-rebuild race_date_changed).
    // COACHED-GATE-1 (2026-08-19) · a runner asking to replan after illness or
    // a missed block is asking for exactly this. Same reasoning as
    // /api/plan/generate; the gate is for the automatic paths.
    const result = await generatePlan({
      userId, raceSlug: String(plan.race_id), allowCoached: true,
      // 2026-08-25 · the runner asked for this one. Telling that apart from a
      // cron deciding it unasked is the whole reason the column exists.
      archiveReason: 'runner_replan',
    });
    const newPlanId = result.ok ? (result.plan_id ?? null) : null;
    if (!newPlanId) {
      return NextResponse.json(
        { error: `rebuild produced no plan${result.reason ? ` · ${result.reason}` : ''}` },
        { status: 500 },
      );
    }

    // 2 · sick ladder on the first three weeks of the NEW plan.
    let ladderApplied = 0;
    if (reason === 'sick') {
      const weeks = (await pool.query<{ id: string; week_start_iso: string; is_race_week: boolean }>(
        `SELECT id, week_start_iso, is_race_week FROM plan_weeks
          WHERE plan_id = $1 ORDER BY week_idx ASC LIMIT ${LADDER.length}`,
        [newPlanId],
      )).rows;
      // Routed through the plan mutation boundary (lib/plan/mutate.ts). The sick
      // ladder scales volume and strips quality from the first three weeks of a
      // freshly rebuilt plan — structural, and applied as one batch because a
      // half-applied ladder is worse than none.
      //
      // NOTE ON THE EXPECTED SHAPE. `dropQuality` deliberately empties week 1 of
      // quality (Research/05 return-to-run: easy only). If that week is a
      // QUALITY-phase week the validator's §5 fires — correctly describing what
      // the ladder did. That is a real conflict between two doctrines and it is
      // surfaced rather than suppressed: the boundary refuses, the plan stays as
      // the rebuild left it, `ladderWeeks` reports 0, and the refusal lands on
      // plan_mutation_rejections where it can be adjudicated. Silently applying
      // it and silently refusing it are both worse than a visible refusal.
      const ladderBoundary = await mutatePlan<number>({
    // AUTHORITY (2026-09-05) · he asked for a replan
    authority: 'RUNNER_INITIATED',
        userUuid: userId,
        source: 'api/plan/replan sick-ladder',
        todayISO: fromISO,
        planId: newPlanId,
        detail: { reason, ladder_weeks: weeks.length },
        apply: async (client) => {
        let applied = 0;
        for (let i = 0; i < weeks.length; i++) {
          const wk = weeks[i];
          if (wk.is_race_week) continue; // never ladder race week
          const { scale, dropQuality } = LADDER[i];
          // Volume scale on every run-type row (rest rows are 0 anyway).
          await client.query(
            `UPDATE plan_workouts
                SET distance_mi = ROUND(distance_mi * $2, 1)
              WHERE plan_id = $1 AND week_id = $3
                AND type NOT IN ('rest', 'race')`,
            [newPlanId, scale, wk.id],
          );
          if (dropQuality) {
            await client.query(
              `UPDATE plan_workouts
                  SET type = 'easy', is_quality = false, is_long = false,
                      sub_label = 'EASY',
                      pace_target_s_per_mi = NULL,
                      workout_spec = NULL,
                      notes = 'Return-to-run week 1 · easy only, stop if symptoms return. (Research/05)'
                WHERE plan_id = $1 AND week_id = $2
                  AND type IN ('tempo','threshold','intervals','long','race_week_tuneup')`,
              [newPlanId, wk.id],
            );
          }
          applied++;
        }
        return applied;
        },
      });
      if (ladderBoundary.ok) {
        ladderApplied = ladderBoundary.value ?? 0;
      } else {
        console.error(
          '[plan/replan] sick ladder REJECTED by the plan mutation boundary · ' +
          `${ladderBoundary.violations.length} introduced violation(s) · plan left as rebuilt`,
        );
      }
    }

    // 3 · audit row (auto_applied · the runner explicitly asked).
    await pool.query(
      `INSERT INTO plan_proposals
         (user_uuid, plan_id, proposal_kind, reasons, status, source, new_plan_id, created_at, resolved_at)
       VALUES ($1, $2, 'replan', $3::jsonb, 'auto_applied', 'plan-replan', $4, NOW(), NOW())`,
      [userId, plan.id, JSON.stringify({ reason, fromISO, toISO, ladderWeeks: ladderApplied }), newPlanId],
    ).catch((e) => console.warn('[plan/replan] audit row failed:', e?.message));

    return NextResponse.json({
      ok: true,
      reason,
      oldPlanId: plan.id,
      planId: newPlanId,
      ladderWeeks: ladderApplied,
      diffUrl: `/training/plans/${newPlanId}/diff`,
    });
  } catch (e: unknown) {
    console.error('[plan/replan]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'replan failed' }, { status: 500 });
  }
}
