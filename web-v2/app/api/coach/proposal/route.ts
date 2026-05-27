/**
 * POST /api/coach/proposal
 *   { action: 'accept' | 'decline', proposal: ProposedAlternative, user_id? }
 *
 * P-COACH-PROPOSAL-1 — handles the two outcomes of an actionable swap
 * proposal the coach surfaced on /today.
 *
 *   accept  → lookup active plan, PATCH today's plan_workouts row to
 *             the proposed alt {type, distance_mi, sub_label=label},
 *             insert coach_intent {reason:'swap_accepted', field:today,
 *             value:proposal}, bust briefing cache.
 *
 *   decline → insert coach_intent {reason:'swap_declined', field:today,
 *             value:proposal}, bust briefing cache so the coach knows
 *             not to re-propose today.
 *
 * Both paths invalidate today's brief so the next render reflects the
 * new state — either the swapped workout, or the coach respecting the
 * decline.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

function todayPT(): string {
  // Match state-loader / tools.ts — PDT-shifted ISO date.
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.action || !body?.proposal) {
    return NextResponse.json({ error: 'action + proposal required' }, { status: 400 });
  }
  if (body.action !== 'accept' && body.action !== 'decline') {
    return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 });
  }

  const p = body.proposal ?? {};
  if (!p.alt_type || typeof p.alt_distance_mi !== 'number' || !p.alt_label) {
    return NextResponse.json({ error: 'proposal missing required fields' }, { status: 400 });
  }

  const userId = body.user_id ?? DAVID_USER_ID;
  const today = todayPT();

  if (body.action === 'decline') {
    // Just persist the decline + bust cache. The coach reads pendingIntents
    // and skips re-proposing for today.
    await pool.query(
      `INSERT INTO coach_intents (user_id, reason, field, value)
       VALUES ($1, 'swap_declined', $2, $3)`,
      [userId, today, JSON.stringify(p)]
    ).catch(() => {});
    await bustBriefingCacheForEvent(userId, 'plan_swap');
    return NextResponse.json({ ok: true, action: 'decline' });
  }

  // ── ACCEPT path — find active plan, find today's row, patch it ──
  const plan = (await pool.query(
    `SELECT id FROM training_plans
      WHERE (user_uuid = $1 OR user_id = 'me')
        AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];
  if (!plan) {
    return NextResponse.json({ error: 'no active plan' }, { status: 404 });
  }

  // The row may already exist (most days do) — UPDATE in place.
  // P15.11 alt rule: distance 0 means a rest day, type comes from
  // proposal. sub_label uses the human label.
  const patched = await pool.query(
    `UPDATE plan_workouts
       SET type = $3, distance_mi = $4, sub_label = $5
     WHERE plan_id = $1 AND date_iso = $2::text
     RETURNING date_iso, dow, type, distance_mi, sub_label`,
    [plan.id, today, p.alt_type, Number(p.alt_distance_mi) || 0, p.alt_label]
  );
  if (patched.rowCount === 0) {
    return NextResponse.json({ error: "today's plan row not found" }, { status: 404 });
  }

  // Log accept intent so the coach can acknowledge the swap landed
  // (reuses the existing 'workout_swapped' reason so the cache-bust +
  // ack pipeline already plumbed by /api/plan/workout PATCH catches
  // this too).
  await pool.query(
    `INSERT INTO coach_intents (user_id, reason, field, value)
     VALUES ($1, 'workout_swapped', $2, $3)`,
    [userId, today, JSON.stringify({ via: 'coach_proposal', proposal: p, applied: patched.rows[0] })]
  ).catch(() => {});

  await bustBriefingCacheForEvent(userId, 'plan_swap');
  return NextResponse.json({ ok: true, action: 'accept', updated: patched.rows[0] });
}
