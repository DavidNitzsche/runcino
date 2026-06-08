// POST /api/race/result
//
// Logs an authoritative chip-time result against a race row.
//
// This is the missing endpoint referenced in races-state.ts:60 ("canonical
// write from /results endpoint"). Writes to actual_result using Rule 6
// field-level update (jsonb merge, never full-replace) so future editor
// writes can't wipe the chip time, and the chip time can't wipe fields
// that future writers add to actual_result.
//
// Steps after writing:
//   1. Immediately fires projection snapshots for the race distance + 26.2M.
//   2. Logs a vdot_auto_recalc coach_intent (briefing layer signal).
//   3. Archives the active plan if this race is its goal race.
//   4. Auto-generates a plan for the next A/B race (if any).
//      generatePlan reads races.actual_result directly — not projection_snapshots —
//      so the finishS written in step 1 is visible here with no race condition.
//      No .catch on the nextRaceRow query: DB errors surface in nextPlan.reason
//      rather than silently returning null (runner must know why generation skipped).
//
// Returns vdotBefore / vdotAfter / projectionSec / nextPlan for client toast.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { vdotFromRace, predictRaceTime, parseRaceTime } from '@/lib/training/vdot';
import { recordProjectionSnapshot } from '@/lib/training/projection-snapshots';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

function fmtFinish(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function distFromLabel(label: string | null | undefined): number | null {
  const l = String(label ?? '').toLowerCase();
  if (l.includes('marathon') && !l.includes('half')) return 26.2;
  if (l.includes('half') || l.includes('21k')) return 13.1;
  if (l.includes('10k')) return 6.2;
  if (l.includes('5k')) return 3.1;
  return null;
}

interface NextPlanResult {
  ok: boolean;
  raceSlug: string;
  raceName: string;
  plan_id?: string;
  weeks_generated?: number;
  compressed?: boolean;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  // Accept either finishS (seconds) or finishDisplay ("1:29:45") — resolve to seconds.
  const finishS = body.finishS != null ? Number(body.finishS) : null;
  const fromDisplay = body.finishDisplay ? parseRaceTime(String(body.finishDisplay)) : null;
  const resolvedS = (finishS && finishS > 0) ? finishS : (fromDisplay && fromDisplay > 0 ? fromDisplay : null);
  if (!resolvedS) return NextResponse.json({ error: 'finishS or finishDisplay required' }, { status: 400 });

  const avgHrBpm = body.avgHrBpm != null ? Number(body.avgHrBpm) : null;

  try {
    // Load race — scoped to caller. DB errors surface as 500 (no .catch here).
    const raceRow = (await pool.query(
      `SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2`,
      [body.slug, userId],
    )).rows[0];
    if (!raceRow) return NextResponse.json({ error: 'race not found' }, { status: 404 });

    const meta = (raceRow.meta ?? {}) as Record<string, unknown>;
    const distanceMi = meta.distanceMi
      ? Number(meta.distanceMi)
      : distFromLabel(meta.distanceLabel as string);

    const finishDisplay = fmtFinish(resolvedS);

    // ── 1. Write actual_result + meta.finishTime ────────────────────────────
    // Rule 6: jsonb || merge preserves fields the caller doesn't touch.
    // COALESCE so a null actual_result starts from {} rather than erroring.
    await pool.query(
      `UPDATE races SET
         actual_result = (
           COALESCE(actual_result, '{}'::jsonb)
           || jsonb_build_object('finishS', $2::numeric, 'finishDisplay', $3::text)
           || CASE WHEN $4::numeric IS NOT NULL
                   THEN jsonb_build_object('avgHrBpm', $4::numeric)
                   ELSE '{}'::jsonb END
         ),
         meta = meta
           || jsonb_build_object('finishTime', $3::text)
           || CASE WHEN $4::numeric IS NOT NULL
                   THEN jsonb_build_object('avgHrBpm', $4::numeric)
                   ELSE '{}'::jsonb END
       WHERE slug = $1 AND user_uuid = $5`,
      [body.slug, resolvedS, finishDisplay, avgHrBpm, userId],
    );

    // ── 2. Immediate projection snapshots ──────────────────────────────────
    const today = await runnerToday(userId);
    const vdot = distanceMi ? vdotFromRace(resolvedS, distanceMi) : null;

    const priorSnap = (await pool.query<{ vdot: string | null }>(
      `SELECT vdot FROM projection_snapshots
        WHERE user_uuid = $1 AND distance_mi = $2
        ORDER BY snapshot_date DESC LIMIT 1`,
      [userId, distanceMi ?? 13.1],
    ).catch(() => ({ rows: [] }))).rows[0];
    const vdotBefore = priorSnap?.vdot ? Number(priorSnap.vdot) : null;

    const projSec = vdot != null && distanceMi ? predictRaceTime(vdot, distanceMi) : null;
    const mProjSec = vdot != null ? predictRaceTime(vdot, 26.2) : null;

    if (vdot != null && distanceMi) {
      await recordProjectionSnapshot(userId, today, distanceMi, vdot, projSec, body.slug, 'race-result').catch(() => null);
    }
    if (vdot != null) {
      await recordProjectionSnapshot(userId, today, 26.2, vdot, mProjSec, body.slug, 'race-result').catch(() => null);
    }

    if (vdot != null) {
      await pool.query(
        `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
         VALUES ($1, $1, 'vdot_auto_recalc', 'vdot', $2)`,
        [userId, String(vdot)],
      ).catch(() => null);
    }

    // ── 3. Archive active plan if this was its goal race ───────────────────
    // Two-attempt fallback: archive_reason column may not exist yet if the
    // migration hasn't run. archived_iso is the load-bearing field.
    let planArchived = false;
    try {
      const r = await pool.query(
        `UPDATE training_plans
           SET archived_iso = NOW(), archive_reason = 'race_completed'
         WHERE user_uuid = $1
           AND race_id = $2
           AND archived_iso IS NULL`,
        [userId, body.slug],
      );
      planArchived = (r.rowCount ?? 0) > 0;
    } catch {
      try {
        const r = await pool.query(
          `UPDATE training_plans SET archived_iso = NOW()
           WHERE user_uuid = $1 AND race_id = $2 AND archived_iso IS NULL`,
          [userId, body.slug],
        );
        planArchived = (r.rowCount ?? 0) > 0;
      } catch { /* best-effort */ }
    }

    // ── 4. Auto-generate plan for the next A/B race ────────────────────────
    // Inner try/catch: step 4 failures surface in nextPlan.reason, not as 500.
    // null = no future A/B race found (generation not attempted).
    // { ok: false } = generation was attempted but failed (DB error or plan error).
    let nextPlan: NextPlanResult | null = null;
    try {
      // No .catch here — DB errors throw to the inner catch below so the runner
      // sees the failure reason rather than a silent null.
      const nextRaceRow = (await pool.query<{ slug: string; name: string }>(
        `SELECT slug, meta->>'name' AS name FROM races
          WHERE user_uuid = $1
            AND (meta->>'date')::date > $2::date
            AND meta->>'priority' IN ('A', 'B')
          ORDER BY (meta->>'date')::date
          LIMIT 1`,
        [userId, (meta.date as string) ?? '9999-99-99'],
      )).rows[0];

      if (nextRaceRow) {
        const { generatePlan } = await import('@/lib/plan/generate');
        const gen = await generatePlan({ userId, raceSlug: nextRaceRow.slug });

        let compressed = false;
        if (gen.ok && gen.plan_id) {
          const stRow = (await pool.query<{ authored_state: Record<string, unknown> | null }>(
            `SELECT authored_state FROM training_plans WHERE id = $1`,
            [gen.plan_id],
          ).catch(() => ({ rows: [] }))).rows[0];
          compressed = Boolean(stRow?.authored_state?.compressed_timeline);
        }

        if (!gen.ok) {
          console.error('[race/result] next-plan generation failed:', nextRaceRow.slug, gen.reason);
        }
        nextPlan = {
          ok: gen.ok,
          raceSlug: nextRaceRow.slug,
          raceName: nextRaceRow.name ?? nextRaceRow.slug,
          plan_id: gen.plan_id,
          weeks_generated: gen.weeks_generated,
          compressed,
          reason: gen.reason,
        };
      }
      // nextRaceRow undefined → no future A/B race → nextPlan stays null
    } catch (genErr: unknown) {
      const msg = genErr instanceof Error ? genErr.message : String(genErr);
      console.error('[race/result] next-plan step failed:', msg);
      nextPlan = { ok: false, raceSlug: '', raceName: '', reason: msg };
    }

    await bustBriefingCacheForEvent(userId, 'race_crud');

    return NextResponse.json({
      ok: true,
      slug: body.slug,
      finishDisplay,
      vdotBefore,
      vdotAfter: vdot,
      projectionSec: projSec,
      marathonProjectionSec: mProjSec,
      planArchived,
      nextPlan,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[race/result] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
