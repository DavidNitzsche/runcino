/**
 * POST /api/admin/backfill-workout-spec
 *
 * P0 #4 backfill (2026-05-30). plan_workouts.workout_spec is a jsonb
 * column populated by the plan-builder at generation time (migration 120)
 * but the live plan for David's americas-finest-city has mostly NULL
 * spec rows — so /today + /train fall back to placeholder strings rather
 * than real Daniels-VDOT paces.
 *
 * Strategy:
 *   1. Find the active plan row(s) for the user.
 *   2. Find the user's A-race goal (priority='A', upcoming, with
 *      meta.goalDisplay = "H:MM:SS" and meta.distanceLabel).
 *   3. For each plan_workouts row with NULL workout_spec, build the spec with
 *      `buildWorkoutSpec` — THE canonical builder, the same function the
 *      generator and the adapter call.
 *   4. UPDATE plan_workouts SET workout_spec = $1 WHERE id = $2.
 *
 * No-op if no active plan, no goal race, or every row already has spec.
 * Self-invocable per CLAUDE.md operational-task rule (built it → safe
 * to run → run it ourselves, surface results not "go click this").
 *
 * Query: ?dry=1 to print without writing (default writes).
 *
 * ── 2026-08-17 · DE-FORKED. This route was writing stale doctrine. ────────
 *
 * `lib/plan/spec-builder.ts` opens by saying it was "extracted from
 * app/api/admin/backfill-workout-spec/route.ts so the generator + backfill
 * cron + adapter all derive the same way". The extraction happened. The route
 * was never re-pointed at it — it kept a complete private copy of
 * `buildSpec`, `hrCapEasy`, `hrCapLong`, `hrLthrBpm`, `tPaceSPerMi`,
 * `fuelMi` and `distanceMiFromLabel`, frozen at the 2026-05-30 state, and
 * every correction since landed only in `lib/`. Running it would have
 * overwritten good specs with retired numbers:
 *
 *   easy/long HR cap   0.80 / 0.85 × LTHR, no maxHr branch, against the
 *                      canonical MAX(0.89×LTHR, 0.78×maxHR). At LTHR 162 /
 *                      maxHR 188 that is 130 bpm where doctrine says 147 —
 *                      the exact band spec-builder's own comment calls "way
 *                      too tight" (Rule 16, 2026-06-03).
 *   easy pace band     T+60 / T+110 against PACE-E-2's T+80 / T+120 — 20 s/mi
 *                      too fast at the floor.
 *   tempo pace         T+5 against PACE-T-1's "the headline tempo pace == T"
 *                      (2026-06-23, explicitly approved).
 *   race row           T-anchored band and a 0.95×LTHR cap — the retired
 *                      constant that "sat BELOW honest HM effort and would
 *                      alarm the entire race".
 *   ultra T-pace       no PACE-5 guard, so a 50K goal yielded finishPace−18
 *                      as "threshold", which the canonical path refuses.
 *   distance labels    26.2188 / 13.1094 / 6.21371 / 3.10686 and no ultra
 *                      rows, against `lib/race/distance.ts`.
 *
 * Nothing tested any of it. The fix is delegation, not repair: the route now
 * calls `buildWorkoutSpec`, `tPaceFromGoal` and `distanceMiFromLabel`, and it
 * threads the inputs the canonical builder wants (the row's own sub_label as
 * the prescription, maxHR, goal pace) so a backfilled spec is byte-identical
 * to what the generator would have authored for the same row. There is no
 * spec-shaping logic left in this file to go stale.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireAdmin } from '@/lib/auth/session';
import { buildWorkoutSpec, tPaceFromGoal } from '@/lib/plan/spec-builder';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';

function parseHMS(t: string): number {
  const parts = (t || '').trim().split(':').map((x) => parseInt(x, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  return 0;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  // force=1 also rewrites EXISTING workout_spec rows that are missing the
  // `kind` discriminator. The first backfill pass shipped specs without
  // `kind`, which made every downstream `switch (spec.kind)` consumer
  // (paceFromSpec, glance-adapter) silently fall through to PACE_DEFAULT.
  const force = req.nextUrl.searchParams.get('force') === '1';

  try {
    // 1. Find the active plan(s) for this user. archived_iso IS NULL matches
    //    the active-plan filter used everywhere else in the coach loaders
    //    (state-loader.ts, training-state.ts, race-header.ts).
    const planRows = (await pool.query(
      `SELECT id, race_id FROM training_plans
        WHERE user_uuid = $1
          AND archived_iso IS NULL
        ORDER BY authored_iso DESC NULLS LAST`,
      [userId],
    ).catch(() => ({ rows: [] as Array<{ id: string; race_id: string | null }> }))).rows;

    if (planRows.length === 0) {
      return NextResponse.json({ ok: true, message: 'no active plan, nothing to backfill', updated: 0 });
    }

    // 2. Goal race → T-pace.
    const raceRow = (await pool.query(
      `SELECT meta FROM races
        WHERE user_uuid = $1
          AND meta->>'priority' = 'A'
          AND meta->>'goalDisplay' IS NOT NULL
          AND (meta->>'date')::date >= CURRENT_DATE - INTERVAL '1 day'
        ORDER BY (meta->>'date') ASC LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] as Array<{ meta: Record<string, unknown> }> }))).rows[0];

    const meta = raceRow?.meta ?? {};
    const goalSec = parseHMS(String((meta as { goalDisplay?: string }).goalDisplay ?? ''));
    const goalDistMi =
      Number((meta as { distanceMi?: number }).distanceMi ?? 0) ||
      distanceMiFromLabel((meta as { distanceLabel?: string }).distanceLabel);
    // `tPaceFromGoal` is the canonical derivation and carries the PACE-5 ultra
    // guard: a 50K finish pace is an arbitrary slow target, not threshold, so
    // it returns null rather than shipping finishPace−18 as "T". The old local
    // copy had no such guard.
    const t = goalSec > 0 && goalDistMi ? tPaceFromGoal(goalSec, goalDistMi) : null;
    const goalPaceSPerMi = goalSec > 0 && goalDistMi ? Math.round(goalSec / goalDistMi) : null;

    if (t == null) {
      return NextResponse.json({
        ok: false,
        error: goalDistMi != null && goalDistMi >= 31
          ? 'ultra goal · T-pace is not derivable from finish pace (PACE-5). Regenerate the plan instead of backfilling.'
          : 'no goal race with parseable goalDisplay + distance',
        plans: planRows.map((p) => p.id),
      }, { status: 400 });
    }

    // 3. HR anchors. LTHR from the profile; max HR from the canonical resolver
    //    (`user_override → 12-month observed → stored → null`) rather than the
    //    non-existent `profile.max_hr`. Rule 16 (2026-06-03) takes the HIGHER
    //    of the two anchor-derived easy caps, so omitting maxHR — as the forked
    //    copy did — silently wrote the tighter, wrong one.
    const profRow = (await pool.query(
      `SELECT lthr FROM profile WHERE user_uuid = $1`,
      [userId],
    ).catch(() => ({ rows: [] as Array<{ lthr: number | null }> }))).rows[0];
    const lthr = profRow?.lthr != null ? Number(profRow.lthr) : null;
    const maxHr = await loadEffectiveMaxHr(userId).then((r) => r.bpm).catch(() => null);

    // 4. Walk plan_workouts with NULL spec, build + UPDATE.
    let totalUpdated = 0;
    const samples: Array<{ id: string; type: string; before: null; after: Record<string, unknown> | null }> = [];

    for (const plan of planRows) {
      // Default: only NULL specs. force=1: also kind-less existing specs
      // (the post-mortem case from the first backfill pass).
      const whereSpec = force
        ? `(workout_spec IS NULL OR (workout_spec IS NOT NULL AND NOT (workout_spec ? 'kind')))`
        : `workout_spec IS NULL`;
      // sub_label comes along because the canonical builder READS it: the
      // prescription string is what sizes a tempo block, a rep set, a stride
      // suffix and a long run's race-pace finish. The forked copy ignored it
      // and invented generic shapes, so a backfilled "5×2K descend MP → T"
      // row came back as an anonymous 4×1mi.
      const rows = (await pool.query(
        `SELECT id, type, distance_mi, sub_label FROM plan_workouts
          WHERE plan_id = $1 AND ${whereSpec}`,
        [plan.id],
      )).rows as Array<{ id: string; type: string; distance_mi: number | null; sub_label: string | null }>;

      for (const row of rows) {
        // THE canonical builder — same call shape the generator uses
        // (lib/plan/generate.ts, persistPlan).
        const { spec } = buildWorkoutSpec(
          row.type,
          row.distance_mi != null ? Number(row.distance_mi) : null,
          t,
          lthr,
          row.sub_label,
          maxHr,
          goalPaceSPerMi,
        );
        if (spec === null) continue;   // null-spec types (rest/cross/strength) — leave as NULL
        if (!dry) {
          await pool.query(
            `UPDATE plan_workouts SET workout_spec = $1 WHERE id = $2`,
            [spec, row.id],
          );
        }
        totalUpdated += 1;
        if (samples.length < 6) samples.push({ id: row.id, type: row.type, before: null, after: spec });
      }
    }

    if (!dry && totalUpdated > 0) {
      // plan_swap is the canonical RegenEvent for any plan-row mutation
      // (see the RegenEvent union in lib/coach/cache.ts § plan_swap).
      await bustBriefingCacheForEvent(userId, 'plan_swap');
    }

    return NextResponse.json({
      ok: true,
      dry,
      updated: totalUpdated,
      tPaceSec: t,
      goalSeconds: goalSec,
      goalDistMi,
      lthr,
      maxHr,
      builder: 'lib/plan/spec-builder#buildWorkoutSpec',
      planIds: planRows.map((p) => p.id),
      samples,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
