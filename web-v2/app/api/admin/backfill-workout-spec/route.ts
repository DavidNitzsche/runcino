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
 *   3. For each plan_workouts row with NULL workout_spec, build a
 *      type-aware spec using the same T-pace derivation as
 *      `lib/training/prescriptions.ts` so the numbers match what the
 *      coach voice would prescribe.
 *   4. UPDATE plan_workouts SET workout_spec = $1 WHERE id = $2.
 *
 * No-op if no active plan, no goal race, or every row already has spec.
 * Self-invocable per CLAUDE.md operational-task rule (built it → safe
 * to run → run it ourselves, surface results not "go click this").
 *
 * Query: ?dry=1 to print without writing (default writes).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

function distanceMiFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const s = String(label).toLowerCase().trim();
  if (s === 'marathon' || s === '26.2') return 26.2188;
  if (s === 'half marathon' || s === 'half' || s === '13.1') return 13.1094;
  if (s === '10k') return 6.21371;
  if (s === '5k') return 3.10686;
  if (s === '15k') return 9.32057;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(mi|km|k)?$/);
  if (m) {
    const n = parseFloat(m[1]);
    if (!m[2] || m[2] === 'mi') return n;
    if (m[2] === 'km' || m[2] === 'k') return n / 1.609344;
  }
  return null;
}

function parseHMS(t: string): number {
  const parts = (t || '').trim().split(':').map((x) => parseInt(x, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  return 0;
}

/**
 * Daniels T-pace (Threshold) in s/mi, derived from goal_seconds + distance_mi
 * via the same offsets as prescriptions.ts → tPaceSecPerMi.
 *   marathon goal → T = goal pace − 18 s/mi
 *   half goal     → T = goal pace − 5 s/mi
 *   10K goal      → T = goal pace + 8 s/mi
 *   5K goal       → T = goal pace + 15 s/mi
 */
function tPaceSPerMi(goalSec: number, distMi: number): number | null {
  if (!goalSec || !distMi) return null;
  const gp = Math.round(goalSec / distMi);
  if (distMi >= 25) return gp - 18;
  if (distMi >= 12) return gp - 5;
  if (distMi >= 5) return gp + 8;
  return gp + 15;
}

/** LTHR-derived heart-rate cap for easy/long. Per Friel zones, easy is
 *  Z2 (≤80% LTHR), long is Z2-Z3 ceiling (≤85% LTHR). Without LTHR we
 *  leave hr_cap_bpm null and the consumer falls back to a pace-only spec. */
function hrCapEasy(lthr: number | null): number | null {
  return lthr ? Math.round(lthr * 0.80) : null;
}
function hrCapLong(lthr: number | null): number | null {
  return lthr ? Math.round(lthr * 0.85) : null;
}
function hrLthrBpm(lthr: number | null): number | null {
  return lthr ?? null;
}

/** Build a v1-shaped workout_spec by type. Returns null for types whose
 *  spec is supposed to be null (rest/strength/cross/shakeout). */
function buildSpec(
  type: string,
  distance_mi: number | null,
  t: number,
  lthr: number | null,
): Record<string, unknown> | null {
  // T-pace offsets per Daniels Table 2 / prescriptions.ts paces().
  const easyLo = t + 60, easyHi = t + 110;
  const longLo = t + 55, longHi = t + 90;
  const tempo  = t + 5;                  // tempo ≈ T + 5-18 s/mi
  const interval = t - 18;               // ~10K pace
  const recovery = t + 100;              // very easy

  const fuelMi = (dist: number | null): number[] => {
    if (!dist || dist < 8) return [];
    const out: number[] = [];
    // First fuel at mi 5, then every 4 mi
    for (let m = 5; m < dist; m += 4) out.push(m);
    return out;
  };

  switch (type) {
    case 'easy':
    case 'recovery':
      return {
        pace_target_s_per_mi_lo: type === 'recovery' ? recovery : easyLo,
        pace_target_s_per_mi_hi: type === 'recovery' ? recovery + 30 : easyHi,
        hr_cap_bpm: hrCapEasy(lthr),
        fuel_mi: [],
      };
    case 'long':
      return {
        pace_target_s_per_mi_lo: longLo,
        pace_target_s_per_mi_hi: longHi,
        hr_cap_bpm: hrCapLong(lthr),
        fuel_mi: fuelMi(distance_mi),
      };
    case 'tempo': {
      const tempoDist = Math.max(2, Math.min(7, (distance_mi ?? 8) - 3));
      const wu = ((distance_mi ?? 8) - tempoDist) / 2;
      return {
        warmup_mi: Number(wu.toFixed(1)),
        tempo_distance_mi: Number(tempoDist.toFixed(1)),
        tempo_pace_s_per_mi: tempo,
        cooldown_mi: Number(wu.toFixed(1)),
        hr_target_bpm: lthr ? Math.round(lthr * 0.92) : null,
      };
    }
    case 'threshold': {
      // Cruise-intervals default: 4 × 1mi @ T-pace w/ 60s recovery.
      const repCount = 4;
      const repMi = 1.0;
      const wu = ((distance_mi ?? 7) - repCount * repMi - 1) / 2;
      return {
        warmup_mi: Number(Math.max(1.5, wu).toFixed(1)),
        rep_count: repCount,
        rep_distance_mi: repMi,
        rep_pace_s_per_mi: t,
        rep_rest_s: 60,
        cooldown_mi: Number(Math.max(1.0, wu).toFixed(1)),
        lthr_bpm: hrLthrBpm(lthr),
      };
    }
    case 'intervals':
    case 'vo2max': {
      // VO2max default: 5 × 1km (≈0.62mi) at I-pace w/ 90s recovery.
      const repCount = 5;
      const repMi = 0.62;
      const wu = ((distance_mi ?? 7) - repCount * repMi - 1) / 2;
      return {
        warmup_mi: Number(Math.max(1.5, wu).toFixed(1)),
        rep_count: repCount,
        rep_distance_mi: repMi,
        rep_pace_s_per_mi: interval,
        rep_rest_s: 90,
        cooldown_mi: Number(Math.max(1.0, wu).toFixed(1)),
        lthr_bpm: hrLthrBpm(lthr),
      };
    }
    case 'race':
      return {
        pace_target_s_per_mi_lo: t - 10,
        pace_target_s_per_mi_hi: t + 5,
        hr_cap_bpm: lthr ? Math.round(lthr * 0.95) : null,
        fuel_mi: fuelMi(distance_mi),
      };
    case 'shakeout':
      return {
        pace_target_s_per_mi_lo: easyHi,
        pace_target_s_per_mi_hi: easyHi + 30,
        hr_cap_bpm: hrCapEasy(lthr),
        fuel_mi: [],
      };
    case 'rest':
    case 'cross':
    case 'strength':
      return null;
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id') ?? DAVID_USER_ID;
  const dry = req.nextUrl.searchParams.get('dry') === '1';

  try {
    // 1. Find the active plan(s) for this user. archived_iso IS NULL matches
    //    the active-plan filter used everywhere else in the coach loaders
    //    (state-loader.ts, training-state.ts, race-header.ts).
    const planRows = (await pool.query(
      `SELECT id, race_id FROM training_plans
        WHERE (user_uuid = $1 OR user_id = 'me')
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
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
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
    const t = goalSec > 0 && goalDistMi ? tPaceSPerMi(goalSec, goalDistMi) : null;

    if (t == null) {
      return NextResponse.json({
        ok: false,
        error: 'no goal race with parseable goalDisplay + distance',
        plans: planRows.map((p) => p.id),
      }, { status: 400 });
    }

    // 3. LTHR for HR cap derivation.
    const profRow = (await pool.query(
      `SELECT lthr FROM profile WHERE user_uuid = $1`,
      [userId],
    ).catch(() => ({ rows: [] as Array<{ lthr: number | null }> }))).rows[0];
    const lthr = profRow?.lthr != null ? Number(profRow.lthr) : null;

    // 4. Walk plan_workouts with NULL spec, build + UPDATE.
    let totalUpdated = 0;
    const samples: Array<{ id: string; type: string; before: null; after: Record<string, unknown> | null }> = [];

    for (const plan of planRows) {
      const rows = (await pool.query(
        `SELECT id, type, distance_mi FROM plan_workouts
          WHERE plan_id = $1
            AND workout_spec IS NULL`,
        [plan.id],
      )).rows as Array<{ id: string; type: string; distance_mi: number | null }>;

      for (const row of rows) {
        const spec = buildSpec(row.type, row.distance_mi != null ? Number(row.distance_mi) : null, t, lthr);
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
      // (rationale in lib/coach/regen-policy.ts § plan_swap).
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
      planIds: planRows.map((p) => p.id),
      samples,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
