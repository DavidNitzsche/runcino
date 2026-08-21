/**
 * GET /api/v5/block — the iPhone v5 Block screen.
 *
 * Thin route: auth, then hand off to `lib/plan/v5-block.ts`, which composes
 * the payload from `loadTrainingState` (phase arc, all sixteen weeks, panel
 * stats) plus the workout library (Gap B1) and the change-the-plan sheet's
 * scenario-availability list. See that file's header for the full picture.
 *
 * READ-ONLY — nothing here writes a row.
 *
 * 2026-08-21 · RACE-MODE GATE. This route had none, unlike `/api/v5/today`,
 * so a runner with no plan at all was handed the whole block scaffold: "NO
 * BLOCK" over an empty arc, "EVERY WEEK · All 0", and a "Change the plan" row
 * offering cutback, travel, extra day, another race and move a day against a
 * plan that does not exist. Every one of those five would have been refused
 * by the engine, one tap later, with a different reason each time.
 *
 * A refusal is a correct answer, not an empty scaffold. The gate mirrors
 * Today's exactly — including its "has EVER been on a race-prep block" arm,
 * so the off-season gap between blocks still reads as race mode.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { pool } from '@/lib/db/pool';
import { loadV5Block } from '@/lib/plan/v5-block';
import { loadActivePlan } from '@/lib/plan/lookup';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    // ── Race-mode gate · mirrors /api/v5/today ──────────────────────────
    const activePlan = await loadActivePlan(userId);
    let raceMode = activePlan != null && (activePlan.mode === 'race-prep' || activePlan.race_id != null);
    if (!activePlan) {
      const everRacePrep = await pool.query(
        `SELECT 1 FROM training_plans WHERE user_uuid = $1 AND (mode = 'race-prep' OR race_id IS NOT NULL) LIMIT 1`,
        [userId],
      ).catch(() => ({ rows: [] as unknown[] }));
      raceMode = everRacePrep.rows.length > 0;
    }
    if (!raceMode) {
      // RULE THREE. The comment here used to say "404 + a reason is the shape
      // the phone reads as `absentReason`" — and the body carried no `reason`
      // at all. `API.v5(...)` in APIV5.swift decodes `V5Refusal` and requires
      // `reason` non-empty before it returns `.absent`; a 4xx with only
      // `error` falls straight through to `.failed`. So the fix that stopped
      // Block handing a plan-less runner a scaffold replaced it with the
      // DATA-OUTAGE screen: "The block did not load. Your plan is intact, we
      // just cannot see it." We could see it perfectly. The answer was no.
      //
      // `error` is the code, `reason` is the sentence. /api/v5/race/[slug]
      // already had this right and says so in its own comment.
      return NextResponse.json(
        {
          error: 'no_block',
          reason: 'There is no block yet. Set a goal race and the plan gets written around it.',
        },
        { status: 404 },
      );
    }

    // RULE THREE, the sibling of the gate above. `raceMode` is satisfied by
    // having EVER been on a race-prep block, so an off-season runner passes it
    // with no active plan — and `loadV5Block` answers that with `emptyBlock`:
    // the word NO BLOCK over an empty phase arc, an empty week list, and five
    // "Change the plan" scenarios each refused in turn. That is a scaffold
    // offering to change a plan that does not exist, which is the exact shape
    // the plan-less-runner fix removed one branch earlier. Today already has
    // the honest answer for this runner (its own `off_season` state); Block
    // does not, so Block says so and stops.
    if (!activePlan) {
      return NextResponse.json(
        {
          error: 'no_active_block',
          reason: 'No block is running right now. Set a goal race and the next one gets written around it.',
        },
        { status: 404 },
      );
    }

    const block = await loadV5Block(userId);
    return NextResponse.json(block);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
