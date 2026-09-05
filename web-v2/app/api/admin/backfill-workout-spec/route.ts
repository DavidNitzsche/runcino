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
 *
 * ── 2026-08-24 · THIS IS NOT AN INSTRUMENT FOR ARCHIVED PLANS ─────────────
 *
 * Asked to point this at the null-spec rows on ARCHIVED plans. It must not go
 * there, and the reasons compound. Measured against prod on 2026-08-24:
 *
 *   1. IT CANNOT REACH THEM. The plan query is `archived_iso IS NULL`. Every
 *      archived row is out of scope by construction, so "run the backfill over
 *      archived plans" is not a run of this route — it is a different route
 *      wearing its name.
 *
 *   2. IT IS NOT DETERMINISTIC ACROSS TIME, and that is the disqualifying one.
 *      T-pace comes from the runner's NEXT upcoming A-race
 *      (`meta->>'date' >= CURRENT_DATE - 1 day`), and the HR anchors come from
 *      today's profile LTHR and today's effective maxHR. Point that at a week
 *      from May and you write December's goal paces into it. The row would then
 *      SAY it prescribed something it never prescribed — a modelled number
 *      wearing the clothes of a measured one, in the one place the app keeps as
 *      a record of what was actually asked. Filling a gap and rewriting history
 *      are not the same operation, and this route can only do the second one to
 *      an archived plan.
 *
 *   3. THERE IS NOTHING TO GAIN ON THE PLANS IT CAN REACH. Of the 165 null-spec
 *      rows on active plans in prod, every single one is `type='rest'` — and
 *      `buildWorkoutSpec` returns `{ spec: null }` for rest/cross/strength, so
 *      `if (spec === null) continue` skips all 165. A permitted run updates
 *      zero rows. The remaining 3,079 null-spec rows are all on archived plans.
 *
 *   4. EVERY ONE OF THOSE ROWS BELONGS TO A PROTECTED ACCOUNT — dnitch85@me.com
 *      (3,005), apple-review@faff.run (80), and four qa-* accounts (159).
 *
 * The default path already cannot touch a populated row (`workout_spec IS
 * NULL`); `?force=1` can, but only rows missing the `kind` discriminator, and
 * prod has none of those, so force=1 is a no-op today. Both remain true and
 * both should stay checked before any future run.
 *
 * If a genuine need to give archived weeks their specs ever appears, the honest
 * version reconstructs each plan's OWN authoring-time anchors from
 * `training_plans.authored_state` rather than today's race. Note that in prod
 * zero archived plans with null-spec rows carry `authored_state.danielsPaces`,
 * so that reconstruction has no inputs either. The correct answer today is that
 * a past week with no spec recorded is a past week with no spec recorded.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireAdmin } from '@/lib/auth/session';
import { buildWorkoutSpec } from '@/lib/plan/spec-builder';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { preserveProgressionSql } from '@/lib/plan/progression-spec';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { mutatePlan } from '@/lib/plan/mutate';
import { runnerToday } from '@/lib/runtime/runner-tz';

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
    /* ── SECOND-OWNER-1b (2026-09-02) · T CAME OFF THE GOAL, AND WAS WRITTEN ──
     *
     * This was `const t = tPaceFromGoal(goalSec, goalDistMi)`, and `t` is the
     * threshold pace every `buildWorkoutSpec` call below is built from — so a
     * backfill PERSISTED the runner's aspiration into `plan_workouts
     * .workout_spec` for every spec-less row on his active plan. Constitution
     * §7 names the shape; measured on the owner's account the goal-derived
     * answer is 394 s/mi against a canonical 430, and this route would have
     * written the 394.
     *
     * `resolvePrescribedPaceAnchors(userId)` takes the user and the date and
     * NOTHING ELSE, so no goal can reach it, and it is the same resolver plan
     * authoring and the nightly flex price the block from — a backfilled row
     * now lands on the number the rows beside it already carry (Rule 16).
     *
     * The PACE-5 ultra guard the old comment defended is not lost by this: it
     * existed because a 50K FINISH pace is not a threshold pace, and nothing
     * here reads a finish pace any more. The anchors are capacity, whatever the
     * runner's goal distance is.
     *
     * `goalPaceSPerMi` stays and is still the goal: it is `buildWorkoutSpec`'s
     * RACE-day argument, which Constitution §J says IS priced from the stated
     * goal. Two different questions, and now two different values. */
    const anchorRead = await resolvePrescribedPaceAnchors(userId);
    const t = anchorRead.ok ? anchorRead.anchors.thresholdSecPerMi : null;
    const goalPaceSPerMi = goalSec > 0 && goalDistMi ? Math.round(goalSec / goalDistMi) : null;

    if (t == null) {
      // Rule 11 · a REFUSED capacity read is not "no goal race". Say which.
      return NextResponse.json({
        ok: false,
        error: anchorRead.ok
          ? 'the canonical pace anchors resolved but carry no threshold pace'
          : `pace anchors REFUSED (${anchorRead.reason}): ${anchorRead.detail}. The runner has ` +
            'no capacity read to price a spec from; backfilling off anything else would write ' +
            'a number nobody resolved.',
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

    // ── ROUTED THROUGH THE PLAN MUTATION BOUNDARY (2026-08-18) ─────────────
    //
    // This is the admin backfill, and it does NOT get a validation bypass —
    // because it does not need one, which is a better answer than an exemption.
    // Every statement below writes exactly one column, `workout_spec`, and no
    // invariant in `validate.ts` reads it. That makes this a `'derivations'`
    // mutation, and the boundary PROVES the claim by fingerprinting the
    // structural columns (date_iso, dow, type, distance_mi, is_quality,
    // is_long, and the row set) before and after. If a future edit to this
    // route ever starts moving one of those, the boundary rolls the backfill
    // back and records `undeclared_structural` rather than letting an admin
    // endpoint quietly restructure a live plan.
    //
    // THE ESCAPE HATCH, if a later backfill genuinely needs it: pass
    // `bypass: { reason: '…' }` to `mutatePlan`. It skips validation entirely,
    // logs a `[plan/mutate] BYPASS` line, and lands a `bypassed` row on
    // `plan_mutation_rejections` carrying the reason. It is deliberately the
    // only way past the door, and it is deliberately loud: an unmarked bypass
    // is how the unguarded-write problem started.
    //
    // One boundary per plan (the boundary is plan-scoped). `dry=1` writes
    // nothing, so it never enters the door at all.
    const boundaryRefusals: Array<{ planId: string; violations: string[] }> = [];
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

      const writeSpecs = async (tx: { query: typeof pool.query }): Promise<number> => {
        let n = 0;
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
            await tx.query(
              // Rule 6 · the backfill rebuilds a spec from the row's own
              // sub_label and knows nothing about the overload trajectory. Under
              // `force=1` it rewrites rows that ALREADY have a spec, so without
              // this guard a maintenance sweep would strip every shape the
              // author wrote.
              `UPDATE plan_workouts SET workout_spec = ${preserveProgressionSql('$1')} WHERE id = $2`,
              [spec, row.id],
            );
          }
          n += 1;
          if (samples.length < 6) samples.push({ id: row.id, type: row.type, before: null, after: spec });
        }
        return n;
      };

      if (dry) {
        totalUpdated += await writeSpecs(pool);
        continue;
      }

      const boundary = await mutatePlan<number>({
    // AUTHORITY (2026-09-05) · an admin backfill of a derived spec, changing no prescribed demand
    authority: 'LIFECYCLE',
        userUuid: userId,
        source: 'admin/backfill-workout-spec',
        todayISO: await runnerToday(userId),
        planId: plan.id,
        touches: 'derivations',
        detail: { force, rows: rows.length },
        apply: async (tx) => writeSpecs(tx),
      });
      if (boundary.ok) {
        totalUpdated += boundary.value ?? 0;
      } else {
        boundaryRefusals.push({ planId: plan.id, violations: boundary.violations });
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
      // Empty unless the boundary refused a plan. A non-empty array means this
      // route tried to move a structural column, which it must never do.
      boundary_refusals: boundaryRefusals,
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
