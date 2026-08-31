/**
 * POST /api/v5/race-authority · "did this race count?"
 *
 * The engine already tiers every race automatically from splits, weather and
 * wind (`lib/race/representativeness.ts`, `lib/race/effort-authority.ts`) and
 * there was no user-facing path to it at all. Heat, illness, ran-it-as-a-
 * workout and paced-a-friend are things the runner knows and the engine does
 * not — this is that report.
 *
 * Body: `{ slug, tier, note? }` where `tier` is `representative | compromised
 * | unrepresentative`. NOT "do you accept these paces" — paces come from
 * evidence, and declining them outright would mean training at paces the
 * runner's fitness does not support.
 *
 * HARD CONSTRAINT. `compromised` / `unrepresentative` falls back to the
 * NEXT-BEST anchor (`lib/race/next-best-anchor.ts`) — never to the plan's
 * pre-race paces. Otherwise the question is a disguised "make me faster"
 * button. The server owns the fallback; there is deliberately no request
 * parameter for "go back to my old paces" — see
 * `native-v2/Faff/Faff/DesignV5/APIV5.swift#confirmRaceAuthority`, which
 * carries only `slug` and `tier`.
 *
 * Rule 6 (CLAUDE.md) · `races.actual_result` is a multi-writer jsonb column
 * (`manualResultPatch` / the watch auto-provisional detector also write it),
 * so the runner's answer is a field-level `||` merge, never a full replace —
 * an automatic re-tier elsewhere must not silently overwrite a human's report
 * of their own race, and this write must not erase a chip time either.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { EVIDENCE_RUN_FLOOR_MI } from '@/lib/training/vdot';
import { nextBestVdotExcludingRace } from '@/lib/race/next-best-anchor';
import { forceReanchorActivePlan } from '@/lib/plan/reanchor-plan';
import { outage } from '@/lib/route/failure';

const TIERS = ['representative', 'compromised', 'unrepresentative'] as const;
type Tier = (typeof TIERS)[number];

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * RULE THREE, at the transport edge. This handler had no `try` around it, so
 * any read that threw left it as an unhandled route error. `outage()` is a
 * 503 with no `reason` key, which is what the phone maps to its data-outage
 * screen; the deliberate refusals inside keep their own 4xx and their own
 * sentence, and stay refusals.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await setRaceAuthority(req);
  } catch (err) {
    return outage('v5/race-authority', err);
  }
}

async function setRaceAuthority(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  const tier = typeof body?.tier === 'string' ? (body.tier as Tier) : null;
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;

  if (!slug || !tier || !TIERS.includes(tier)) {
    return NextResponse.json(
      // RULE FOUR · `reason` is printed at the runner by `v5Write`, so it is
      // copy, not a log line. Naming a request field and a list of enum
      // values at someone who just tapped an answer chip is the engine
      // talking to its own client with the runner in the room.
      { ok: false, error: 'bad_request', reason: 'That is not one of the answers this question offers.' },
      { status: 400 },
    );
  }

  // RULE THREE. No `.catch`. Empty here means "no such race for you", which
  // is the 404 below; a failed read is not that answer.
  const raceRow = (await pool.query<{ slug: string }>(
    `SELECT slug FROM races WHERE slug = $1 AND user_uuid = $2`,
    [slug, userId],
  )).rows[0];
  if (!raceRow) {
    return NextResponse.json({ ok: false, error: 'not_found', reason: 'That race is not on your schedule any more.' }, { status: 404 });
  }

  const confirmedAt = new Date().toISOString();

  // ── 1 · record the runner's own answer · field-level jsonb merge ──────────
  await pool.query(
    `UPDATE races SET
       actual_result = (COALESCE(actual_result, '{}'::jsonb) || $2::jsonb)
     WHERE slug = $1 AND user_uuid = $3`,
    [slug, JSON.stringify({
      authority_tier: tier,
      authority_note: note,
      authority_source: 'runner',
      authority_confirmed_at: confirmedAt,
    }), userId],
  );

  // 'representative' — the race already counts at full weight. Nothing to
  // fall back to; just acknowledge any pace-drop card this race was tied to
  // so GET /api/v5/paces stops presenting it as a pending question.
  if (tier === 'representative') {
    try {
      const { loadPaceZoneEvent, acknowledgePaceZoneEvent } = await import('@/lib/plan/pace-drop-event');
      const planId = await activePlanId(userId);
      if (planId) {
        const event = await loadPaceZoneEvent(planId);
        if (event?.evidenceRaceSlug === slug) await acknowledgePaceZoneEvent(planId, confirmedAt);
      }
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, slug, tier, fallback: null, reanchored: false });
  }

  // ── 2 · compromised / unrepresentative → the NEXT-BEST anchor, computed
  // fresh with this race EXCLUDED from the candidate pool entirely ─────────
  const today = await runnerToday(userId);
  const runFloorMi = EVIDENCE_RUN_FLOOR_MI;
  const { raceCandidates, runCandidates } = await loadVdotInputs(userId, today, undefined, runFloorMi);
  const fallback = nextBestVdotExcludingRace(raceCandidates, runCandidates, slug, today, runFloorMi);

  if (fallback.vdot == null) {
    // No honest evidence remains at all. Do NOT invent a floor and do NOT
    // leave the flagged race's inflated paces standing either — refuse the
    // fallback and say so; the next real evidence (a race, a qualifying run)
    // resolves it.
    return NextResponse.json({
      ok: true,
      slug,
      tier,
      fallback: null,
      reanchored: false,
      reason: 'No other evidence in the window to anchor paces to. Paces hold until the next race or qualifying effort.',
    });
  }

  const reanchor = await forceReanchorActivePlan(userId, fallback.vdot, today, {
    source: fallback.source,
    refId: fallback.refId,
  }).catch(() => null);

  return NextResponse.json({
    ok: true,
    slug,
    tier,
    fallback: { vdot: fallback.vdot, source: fallback.source, refId: fallback.refId },
    reanchored: reanchor != null,
    ...(reanchor ? { workoutsUpdated: reanchor.workoutsUpdated, workoutsSealed: reanchor.workoutsSealed } : {}),
  });
}

async function activePlanId(userId: string): Promise<string | null> {
  const row = (await pool.query<{ id: string }>(
    `SELECT id FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  return row?.id ?? null;
}
