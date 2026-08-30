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
// 2026-08-17 · race-lifecycle fixes:
//   · The post-result steps (projection snapshots → vdot coach_intent →
//     archive plan race_completed → next-plan generation) moved to
//     lib/race/result-chain.ts:runPostResultChain, shared with the
//     auto-provisional detector (lib/race/auto-result.ts). Behavior of
//     this route is unchanged — plus the snapshot-args bug fixed in the
//     chain (see result-chain.ts header) means snapshots actually land.
//   · The actual_result patch now stamps source:'manual' /
//     provisional:false so a manual chip time OVERRIDES a provisional
//     watch-time result the detector logged earlier (the jsonb || merge
//     replaces finishS/finishDisplay and clears the provisional flag,
//     preserving the matched runId as provenance).
//
// Returns vdotBefore / vdotAfter / projectionSec / nextPlan for client toast.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { parseRaceTime } from '@/lib/training/vdot';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { manualResultPatch, runPostResultChain } from '@/lib/race/result-chain';

// 2026-07-07 · ultra-honesty audit · was a local fork that recognized only
// marathon/half/10k/5k (no ultra labels at all — silently null, not a 13.1
// fallthrough, so no phantom plan risk here, but a 50K/100K chip-time result
// couldn't even resolve its OWN real distance for the actual_result write).
// Delegate to the shared parser so a real ultra finish still resolves a real
// distanceMi; vdotFromRace/predictRaceTime (in the chain) independently
// refuse to project past the marathon regardless of what distanceMi resolves to.
function distFromLabel(label: string | null | undefined): number | null {
  return distanceMiFromLabel(label);
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: 'slug_required', reason: 'No race was named, so there is nothing to record a time against.' }, { status: 400 });

  // Accept either finishS (seconds) or finishDisplay ("1:29:45") — resolve to seconds.
  const finishS = body.finishS != null ? Number(body.finishS) : null;
  const fromDisplay = body.finishDisplay ? parseRaceTime(String(body.finishDisplay)) : null;
  const resolvedS = (finishS && finishS > 0) ? finishS : (fromDisplay && fromDisplay > 0 ? fromDisplay : null);
  if (!resolvedS) return NextResponse.json({ error: 'finish_required', reason: 'A finish time is the one thing this needs.' }, { status: 400 });

  const avgHrBpm = body.avgHrBpm != null ? Number(body.avgHrBpm) : null;

  try {
    // Load race — scoped to caller. DB errors surface as 500 (no .catch here).
    const raceRow = (await pool.query(
      `SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2`,
      [body.slug, userId],
    )).rows[0];
    if (!raceRow) return NextResponse.json({ error: 'race_not_found', reason: 'That race is not on your schedule any more.' }, { status: 404 });

    const meta = (raceRow.meta ?? {}) as Record<string, unknown>;
    const distanceMi = meta.distanceMi
      ? Number(meta.distanceMi)
      : distFromLabel(meta.distanceLabel as string);

    // ── 1. Write actual_result + meta.finishTime ────────────────────────────
    // Rule 6: jsonb || merge preserves fields the caller doesn't touch.
    // COALESCE so a null actual_result starts from {} rather than erroring.
    // manualResultPatch stamps source:'manual' / provisional:false so this
    // entry overrides any auto-logged watch_provisional result.
    const patch = manualResultPatch(resolvedS, avgHrBpm);
    const finishDisplay = String(patch.finishDisplay);
    await pool.query(
      `UPDATE races SET
         actual_result = (COALESCE(actual_result, '{}'::jsonb) || $2::jsonb),
         meta = meta
           || jsonb_build_object('finishTime', $3::text)
           || CASE WHEN $4::numeric IS NOT NULL
                   THEN jsonb_build_object('avgHrBpm', $4::numeric)
                   ELSE '{}'::jsonb END
       WHERE slug = $1 AND user_uuid = $5`,
      [body.slug, JSON.stringify(patch), finishDisplay, avgHrBpm, userId],
    );

    // ── 2-5. Shared post-result chain ──────────────────────────────────────
    // Projection snapshots + vdot coach_intent + archive plan
    // (race_completed) + next-plan generation + briefing cache bust.
    const chain = await runPostResultChain({
      userId,
      raceSlug: body.slug,
      raceDateISO: (meta.date as string) ?? null,
      distanceMi,
      // 2026-08-19 · Research/00b scales the recovery window by A/B/C effort,
      // and the open block (nothing booked after this race) sizes itself off
      // that window. Absent → treated as A, the longer, safer window.
      racePriority: typeof meta.priority === 'string' ? meta.priority : null,
      finishS: resolvedS,
    });

    return NextResponse.json({
      ok: true,
      slug: body.slug,
      finishDisplay,
      vdotBefore: chain.vdotBefore,
      vdotAfter: chain.vdotAfter,
      projectionSec: chain.projectionSec,
      marathonProjectionSec: chain.marathonProjectionSec,
      planArchived: chain.planArchived,
      nextPlan: chain.nextPlan,
      // 2026-08-30 · the threshold-HR half of the recalc. Same shape the
      // race editor's `recalc` block returns, so RaceView's StateChangeToast
      // renders an LTHR row off either path.
      lthrBefore: chain.lthrBefore,
      lthrAfter: chain.lthrAfter,
      lthrMethod: chain.lthrMethod,
      // 2026-08-19 · what the runner got when there was no next race booked.
      openBlock: chain.openBlock,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[race/result] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
