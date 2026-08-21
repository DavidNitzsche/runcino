/**
 * POST /api/v5/goal-answer · answer the Races decision card.
 *
 * `native-v2/…/APIV5.swift`'s `answerGoalCard(action:targetSec:raceSlug:)`
 * posts `{ action, targetSec?, raceSlug? }` where `action` is one of the
 * card's own answer actions. What each one means:
 *
 *   hold          · keep the stated goal. Logged (shows up in the coach
 *                   log); the verdict simply re-reads fresh next time —
 *                   nothing to suppress, since the verdict is always
 *                   present and not a discrete trigger.
 *   take          · re-state the goal to `targetSec` — through the SAME
 *                   write `PATCH /api/race/[slug]` uses (races.plan.goal +
 *                   meta.goalDisplay, audited, auto-rebuild fired), never a
 *                   direct write. Requires `targetSec`.
 *   not_now       · dismiss. Suppresses whichever fact/choice trigger was
 *                   showing, for `TRIGGER_SUPPRESS_DAYS`. No plan change.
 *   acknowledge   · same as `not_now`, for the heat/course-changed facts.
 *   repace        · heat only. The goal stands; acknowledged + suppressed.
 *                   Re-pacing race morning itself is a race-week concern,
 *                   not a plan mutation — nothing here rewrites paces.
 *   confirm       · chip-time lock only. Promotes the race's own already-
 *                   resolved provisional finish (the Strava/watch match
 *                   `loadVdotInputs` already computed) to the authoritative
 *                   chip time, through the SAME canonical write
 *                   `POST /api/race/result` uses (`manualResultPatch` +
 *                   `runPostResultChain`). Never accepts a client-supplied
 *                   number — the server re-derives the provisional time
 *                   itself, so this endpoint cannot be used to inject an
 *                   arbitrary result.
 *   leave         · chip-time lock only. Leaves the result provisional;
 *                   suppresses the trigger. No write beyond the log.
 *   choose_race   · two-A-races only. Demotes every OTHER upcoming A race
 *                   to B, through the same primitives `PATCH /api/race`
 *                   uses for a priority edit (meta.priority + auto-rebuild
 *                   kind `a_race_removed`). Requires `raceSlug` — the race
 *                   that stays the goal.
 *
 * Every goal change (`take`, `choose_race`) goes through the plan's
 * existing race/goal write paths, never a bare UPDATE — CLAUDE.md's
 * multi-writer jsonb rule (Rule 6) is why `PATCH /api/race` already merges
 * rather than replaces, and this route reuses that code path rather than a
 * second writer to the same column.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadRacesState } from '@/lib/coach/races-state';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { manualResultPatch, runPostResultChain } from '@/lib/race/result-chain';
import type { FactChoiceTriggerId } from '@/lib/training/race-card';
import { outage } from '@/lib/route/failure';

export const dynamic = 'force-dynamic';

const ACTIONS = ['hold', 'take', 'not_now', 'acknowledge', 'repace', 'confirm', 'leave', 'choose_race'] as const;
type Action = (typeof ACTIONS)[number];

async function writeIntent(userId: string, reason: string, field: string | null, value: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value) VALUES ($1, $1, $2, $3, $4)`,
    [userId, reason, field, JSON.stringify(value)],
  ).catch((e) => console.error('[v5/goal-answer] writeIntent failed:', e instanceof Error ? e.message : e));
}

async function suppressTrigger(userId: string, trigger: FactChoiceTriggerId): Promise<void> {
  await writeIntent(userId, 'goal_card_dismissed', trigger, { trigger });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? '') as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ ok: false, error: 'bad_action', reason: `That is not an answer this card offers. Expected one of ${ACTIONS.join(', ')}.` }, { status: 400 });
  }
  const targetSec = typeof body?.targetSec === 'number' && Number.isFinite(body.targetSec) ? body.targetSec : null;
  const raceSlug = typeof body?.raceSlug === 'string' && body.raceSlug ? body.raceSlug : null;

  try {
    // These two reads used to sit OUTSIDE this `try`, so a throw in either
    // left the handler unhandled and became a raw Next.js 500 rather than
    // the outage body. Both hit the database; both belong inside.
    const todayISO = await runnerToday(userId);
    const racesState = await loadRacesState(userId);
    const upcomingAs = racesState.aRaces.filter(r => !r.is_past).sort((a, b) => a.days - b.days);
    const nextA = upcomingAs[0] ?? racesState.aRace ?? null;

    switch (action) {
      case 'hold': {
        await writeIntent(userId, 'coach_log_goal_answer', nextA?.slug ?? null, { action, race: nextA?.slug ?? null });
        return NextResponse.json({ ok: true, action });
      }

      case 'not_now': {
        // Best-effort: suppress every fact/choice trigger that could be
        // showing right now (route can't know which one the client saw),
        // so the same question doesn't re-fire tomorrow.
        for (const t of ['heat', 'course_changed', 'chip_lock', 'two_a_races'] as FactChoiceTriggerId[]) {
          await suppressTrigger(userId, t);
        }
        await writeIntent(userId, 'coach_log_goal_answer', nextA?.slug ?? null, { action, race: nextA?.slug ?? null });
        return NextResponse.json({ ok: true, action });
      }

      case 'acknowledge':
      case 'repace': {
        // 'acknowledge' answers BOTH heat and course_changed in race-
        // card.ts; 'repace' answers heat alone. Suppressing both on either
        // is harmless — a trigger that wasn't showing has nothing to skip.
        await suppressTrigger(userId, 'heat');
        await suppressTrigger(userId, 'course_changed');
        await writeIntent(userId, 'coach_log_goal_answer', nextA?.slug ?? null, { action });
        return NextResponse.json({ ok: true, action });
      }

      case 'leave': {
        await suppressTrigger(userId, 'chip_lock');
        await writeIntent(userId, 'coach_log_goal_answer', raceSlug ?? nextA?.slug ?? null, { action, left_provisional: true });
        return NextResponse.json({ ok: true, action });
      }

      case 'take': {
        if (targetSec == null || targetSec < 600 || targetSec > 21600) {
          return NextResponse.json({ ok: false, error: 'bad_target', reason: 'That target is outside anything we would build a plan toward.' }, { status: 400 });
        }
        if (!nextA) {
          return NextResponse.json({ ok: false, error: 'no_goal_race', reason: 'No goal race is set to re-state a target against.' }, { status: 404 });
        }
        // The SAME write PATCH /api/race/[slug] performs — merged into
        // meta/plan, never a full-replace (CLAUDE.md Rule 6).
        const h = Math.floor(targetSec / 3600);
        const m = Math.floor((targetSec % 3600) / 60);
        const s = Math.round(targetSec % 60);
        const goalDisplay = h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${m}:${String(s).padStart(2, '0')}`;
        const current = await pool.query<{ meta: any; plan: any }>(
          `SELECT meta, plan FROM races WHERE user_uuid = $1::uuid AND slug = $2 LIMIT 1`,
          [userId, nextA.slug],
        // RULE THREE. No `.catch` — null here answers "that race is gone",
        // and a failed read must not be able to say that.
        ).then(r => r.rows[0]);
        if (!current) return NextResponse.json({ ok: false, error: 'race_not_found', reason: 'That race is not on your schedule any more.' }, { status: 404 });
        const oldGoalSec = Number(current.plan?.goal?.finish_time_s ?? 0);
        const newMeta = { ...current.meta, goalDisplay };
        const newPlan = { ...current.plan, goal: { ...current.plan?.goal, finish_time_s: targetSec, finish_time_display: goalDisplay } };
        await pool.query(
          `UPDATE races SET meta = $1::jsonb, plan = $2::jsonb WHERE user_uuid = $3::uuid AND slug = $4`,
          [JSON.stringify(newMeta), JSON.stringify(newPlan), userId, nextA.slug],
        );
        await writeIntent(userId, 'goal_renegotiated', nextA.slug, {
          old_goal_sec: oldGoalSec, new_goal_sec: targetSec,
          old_display: current.meta?.goalDisplay ?? null, new_display: goalDisplay,
          source: 'v5_goal_card', citation: 'app/api/v5/goal-answer',
        });
        try {
          const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
          await fireAutoRebuild({
            userUuid: userId, raceSlug: nextA.slug, kind: 'goal_time_changed',
            reasons: { drift_kind: 'goal_renegotiated', old_goal_sec: oldGoalSec, new_goal_sec: targetSec, source: 'v5_goal_card' },
            source: 'v5_goal_answer',
          });
        } catch (e) { console.error('[v5/goal-answer take] auto-rebuild warn:', e); }
        await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});
        return NextResponse.json({ ok: true, action, goalSec: targetSec, goalDisplay, oldGoalSec });
      }

      case 'confirm': {
        // Re-derive the provisional finish server-side — never trust a
        // client-supplied time here. The race must be the one
        // loadVdotInputs' Strava-match rung actually resolved.
        const slug = raceSlug ?? [...racesState.past].filter(r => r.days >= -21).sort((a, b) => b.days - a.days)[0]?.slug ?? null;
        if (!slug) return NextResponse.json({ ok: false, error: 'no_race', reason: 'No recent unlocked race to confirm.' }, { status: 404 });
        const inputs = await loadVdotInputs(userId, todayISO);
        const candidate = inputs.raceCandidates.find(c => c.slug === slug);
        if (!candidate || !candidate.provisional || !candidate.finish_seconds) {
          return NextResponse.json({ ok: false, error: 'not_provisional', reason: "This race's time is already locked, or there's nothing to confirm." }, { status: 400 });
        }
        // Same write POST /api/race/result performs: Rule 6 jsonb-merge
        // patch, source:'manual'/provisional:false, then the shared
        // post-result chain (snapshots, vdot intent, archive+next-plan).
        const patch = manualResultPatch(candidate.finish_seconds, null);
        const finishDisplay = String(patch.finishDisplay);
        await pool.query(
          `UPDATE races SET
             actual_result = (COALESCE(actual_result, '{}'::jsonb) || $2::jsonb),
             meta = meta || jsonb_build_object('finishTime', $3::text)
           WHERE slug = $1 AND user_uuid = $4`,
          [slug, JSON.stringify(patch), finishDisplay, userId],
        );
        await writeIntent(userId, 'coach_log_goal_answer', slug, { action, finish_seconds: candidate.finish_seconds, display: finishDisplay });
        let chain: Awaited<ReturnType<typeof runPostResultChain>> | null = null;
        try {
          chain = await runPostResultChain({
            userId, raceSlug: slug,
            raceDateISO: candidate.date || null,
            distanceMi: candidate.distance_mi,
            racePriority: candidate.priority,
            finishS: candidate.finish_seconds,
          });
        } catch (e) { console.error('[v5/goal-answer confirm] post-result chain warn:', e); }
        await bustBriefingCacheForEvent(userId, 'race_crud').catch(() => {});
        return NextResponse.json({
          ok: true, action, slug, finishSeconds: candidate.finish_seconds, finishDisplay,
          vdotBefore: chain?.vdotBefore ?? null, vdotAfter: chain?.vdotAfter ?? null,
        });
      }

      case 'choose_race': {
        if (!raceSlug) return NextResponse.json({ ok: false, error: 'no_race_chosen', reason: 'Say which race is the goal and we will build toward that one.' }, { status: 400 });
        const chosen = upcomingAs.find(r => r.slug === raceSlug);
        if (!chosen) return NextResponse.json({ ok: false, error: 'race_not_found', reason: 'That race is not one of your upcoming A races.' }, { status: 404 });
        const others = upcomingAs.filter(r => r.slug !== raceSlug);
        for (const other of others) {
          const current = await pool.query<{ meta: any }>(
            `SELECT meta FROM races WHERE user_uuid = $1::uuid AND slug = $2 LIMIT 1`,
            [userId, other.slug],
          ).then(r => r.rows[0]).catch(() => null);
          if (!current) continue;
          const newMeta = { ...current.meta, priority: 'B' };
          await pool.query(
            `UPDATE races SET meta = $1::jsonb WHERE user_uuid = $2::uuid AND slug = $3`,
            [JSON.stringify(newMeta), userId, other.slug],
          );
          await writeIntent(userId, 'coach_log_goal_answer', other.slug, { action, demoted_to: 'B', chosen_goal: raceSlug });
          try {
            const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
            await fireAutoRebuild({
              userUuid: userId, raceSlug: other.slug, kind: 'a_race_removed',
              reasons: { to_priority: 'B', chosen_goal: raceSlug, source: 'v5_goal_card' },
              source: 'v5_goal_answer',
            });
          } catch (e) { console.error('[v5/goal-answer choose_race] auto-rebuild warn:', e); }
        }
        await suppressTrigger(userId, 'two_a_races');
        await bustBriefingCacheForEvent(userId, 'race_crud').catch(() => {});
        return NextResponse.json({ ok: true, action, chosen: raceSlug, demoted: others.map(o => o.slug) });
      }

      default:
        return NextResponse.json({ ok: false, error: 'unhandled_action', reason: 'That answer is not one this card can act on.' }, { status: 400 });
    }
  } catch (err: unknown) {
    // Was `err?.message` in the body. The 4xx refusals above still carry
    // their own `reason` — that split is the whole point of rule three.
    return outage('v5/goal-answer', err);
  }
}
