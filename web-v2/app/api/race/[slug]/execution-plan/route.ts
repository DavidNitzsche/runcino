/**
 * GET /api/race/[slug]/execution-plan
 *
 * 2026-06-09 state-audit Tier 1.1 · the Race Execution Plan as data.
 * One endpoint, every surface: web race page, iPhone race-day view,
 * and the race-week briefing all render the same plan from here
 * instead of re-deriving (or worse, improvising) race strategy.
 *
 * Composes lib/race/execution-plan.ts from:
 *   · races.meta — goalDisplay (A goal), goalSafeDisplay (B goal),
 *     startTime (the Gun chip), distanceMi
 *   · profile — lthr; users.max_hr via loadEffectiveMaxHr
 *   · projection_snapshots — current VDOT (ability tier for heat math)
 *   · computeConfidenceInterval — the CI band for the honesty note
 *
 * Returns 404 when the race has no parseable goal time — an execution
 * plan without a goal is fiction, and the surface should show the
 * "set a goal" affordance instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { parseRaceTime } from '@/lib/training/vdot';
import { composeRaceExecutionPlan } from '@/lib/race/execution-plan';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;

  try {
    const raceRow = (await pool.query<{ meta: Record<string, unknown> | null }>(
      `SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2 LIMIT 1`,
      [slug, userId],
    )).rows[0];
    if (!raceRow?.meta) {
      return NextResponse.json({ error: 'race not found' }, { status: 404 });
    }
    const meta = raceRow.meta;

    const goalSec = parseRaceTime(meta.goalDisplay as string)
      ?? parseRaceTime(meta.goalTime as string);
    const distanceMi = Number(meta.distanceMi) || null;
    if (!goalSec || !distanceMi) {
      return NextResponse.json(
        { error: 'no goal time set · execution plan needs a goal' },
        { status: 404 },
      );
    }
    const bGoalSec = parseRaceTime(meta.goalSafeDisplay as string)
      ?? parseRaceTime(meta.bGoalDisplay as string);
    const startTimeLocal =
      (meta.startTime as string) ?? (meta.gun_time as string) ?? (meta.start_time as string) ?? null;

    const [profileRow, maxHrEff, snapRow] = await Promise.all([
      pool.query<{ lthr: number | null }>(
        `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
        [userId],
      ).then((r) => r.rows[0] ?? null).catch(() => null),
      import('@/lib/training/max-hr').then((m) => m.loadEffectiveMaxHr(userId)).catch(() => null),
      pool.query<{ vdot: string | null; projection_sec: number | null }>(
        `SELECT vdot::text, projection_sec FROM projection_snapshots
          WHERE user_uuid = $1 AND distance_mi BETWEEN $2 * 0.95 AND $2 * 1.05
          ORDER BY snapshot_date DESC LIMIT 1`,
        [userId, distanceMi],
      ).then((r) => r.rows[0] ?? null).catch(() => null),
    ]);

    const vdot = snapRow?.vdot != null ? Number(snapRow.vdot) : null;

    // CI band for the honesty note · same math the Targets page shows
    // (computeConfidenceInterval) without re-running drift detection —
    // status enters only as a multiplier and the plan is a race-morning
    // artifact, not a drift gauge. on-track multiplier = the tightest
    // honest band; the note is context, not a promise.
    let ci: { loSec: number; hiSec: number } | null = null;
    if (snapRow?.projection_sec != null && snapRow.projection_sec > 0) {
      const { computeConfidenceInterval } = await import('@/lib/training/goal-projection');
      const band = computeConfidenceInterval({
        centerSec: snapRow.projection_sec,
        raceDistanceMi: distanceMi,
        status: 'on-track',
      });
      if (band) ci = { loSec: band.lo, hiSec: band.hi };
    }

    const plan = composeRaceExecutionPlan({
      goalSec,
      distanceMi,
      bGoalSec,
      lthr: profileRow?.lthr ?? null,
      maxHr: maxHrEff?.bpm ?? null,
      vdot,
      ci,
      startTimeLocal,
    });
    if (!plan) {
      return NextResponse.json({ error: 'plan composition failed' }, { status: 500 });
    }

    return NextResponse.json({
      slug,
      raceName: (meta.name as string) ?? slug,
      raceDateISO: (meta.date as string) ?? null,
      startTimeLocal,
      plan,
    });
  } catch (e: unknown) {
    console.error('[race/execution-plan]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
