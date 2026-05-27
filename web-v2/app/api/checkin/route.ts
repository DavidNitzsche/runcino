/**
 * POST /api/checkin   { rating, briefing_id?, surface?, note? }
 *
 * Closed loop §8.1: reply chip → check_ins row → next briefing reads recent
 * check-ins and adjusts voice + plan accordingly.
 *
 * Invalidates the briefing cache for this user so the next /api/briefing
 * call regenerates against the new state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { generateCheckinReply, pickCannedReply } from '@/lib/coach/checkin-reply';
import { loadCoachState } from '@/lib/coach/state-loader';
import { readCachedBriefing } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const VALID_RATINGS = ['solid', 'tired', 'wrecked'] as const;
type Rating = typeof VALID_RATINGS[number];

interface CheckinBody {
  rating?: string;
  briefing_id?: string;
  surface?: string;
  note?: string;
  user_id?: string;
  // P34 — expanded check-in (all optional)
  energy?: number;                 // 1-10 self-reported
  soreness?: string[];             // ["calves", "quads", "hips"...]
  mood?: 'great' | 'good' | 'flat' | 'low';
  sleep_quality?: number;          // 1-10
  // #150 — new post-run shape (kind='post_run')
  kind?: 'post_run' | 'pre_run' | 'rest_day';
  workout_kind?: 'quality' | 'easy' | 'long' | 'race' | 'recovery';
  execution?: string;              // type-aware: nailed/grinded/missed/chatty/.../crushed_goal/...
  body?: 'fresh' | 'worked' | 'cooked';
  niggle?: string | null;
  run_id?: string | null;
}

/**
 * Map the new post-run execution+body chips onto the legacy
 * solid/tired/wrecked rating so existing coach logic still works.
 * The richer signal is also persisted in extras for new doctrine.
 *
 * 2026-05-27 phantom-TIRED fix. Original mapping conflated "how the run
 * executed" with "how the runner feels." Tapping CONTROLLED, NOT CHATTY
 * on an easy day = describes pace (slightly above conversation), NOT
 * fatigue — but it was silently writing TIRED. Same trap with the body
 * chip WORKED, which is the normal state after every run. Result: David
 * was reading "yesterday's check-in was TIRED" in coach voice without
 * ever having tapped anything that meant "I feel tired."
 *
 * New principle: a chip maps to TIRED/WRECKED ONLY when it semantically
 * means the runner is signaling fatigue or under-recovery. Neutral
 * descriptions of pace/effort stay SOLID.
 */
function ratingFromPostRun(execution?: string, body?: string): Rating | null {
  // Execution maps directly when present. Body falls through when no execution.
  const exec = (execution ?? '').toLowerCase();
  //
  // 2026-05-27 second pass on the chip→rating mapping after David's
  // pushback: "I dont know if I would say STRUGGLE. It was a speed day.
  // It was hard. I fucking did it." Doctrine clarified —
  //
  //   SOLID    = "I completed the prescribed work." Includes nailing
  //              the workout AND grinding through a hard session you
  //              still finished. GRINDED IT OUT and FADED LATE both
  //              count as completed work, not fatigue signals.
  //
  //   TIRED    = "I couldn't do what the workout asked." HAD TO PUSH
  //              on an easy day, missed the reps on a quality day,
  //              walled on the long, missed the race goal. Real fatigue
  //              indicators because the prescribed work didn't happen.
  //
  //   WRECKED  = "Body is wrecked." Only body=cooked. The execution row
  //              tops out at TIRED — even bailing on a workout doesn't
  //              auto-promote to WRECKED unless the runner explicitly
  //              flags their body state.
  //
  if (['nailed', 'chatty', 'controlled', 'grinded', 'strong', 'faded',
       'crushed_goal', 'on_goal'].includes(exec)) return 'solid';
  if (['pushed', 'missed', 'walled', 'missed_goal'].includes(exec)) return 'tired';

  // Recovery day — no execution; body alone drives the rating.
  // WORKED is the baseline post-run state (legs feel the work) — NOT a
  // fatigue signal. Only COOKED counts as a real "I feel wrecked" tap.
  if (body === 'fresh' || body === 'worked') return 'solid';
  if (body === 'cooked') return 'wrecked';
  return null;
}

export async function POST(req: NextRequest) {
  let body: CheckinBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Two intake shapes:
  //  (a) legacy: { rating: solid|tired|wrecked, ... }
  //  (b) #150:   { kind: 'post_run', execution, body, niggle? }
  // Derive a legacy rating from the new shape so downstream code is unchanged.
  let rating = body.rating?.toLowerCase();
  if (!rating && body.kind === 'post_run') {
    const derived = ratingFromPostRun(body.execution, body.body);
    rating = derived ?? undefined;
  }
  if (!rating || !VALID_RATINGS.includes(rating as Rating)) {
    return NextResponse.json({ error: 'rating must be one of solid|tired|wrecked (or post_run shape with execution+body)' }, { status: 400 });
  }

  const userId = body.user_id ?? DAVID_USER_ID;
  const surface = body.surface ?? 'today';

  // P34 — build the optional 'extras' jsonb from any expanded fields.
  // Stays null if the caller only sent rating/note (back-compat).
  // #150 — also persist the new two-axis signal (execution + body + niggle)
  // so coach doctrine can read it when the chips were used.
  const extras: Record<string, any> = {};
  if (body.energy != null) extras.energy = body.energy;
  if (Array.isArray(body.soreness) && body.soreness.length > 0) extras.soreness = body.soreness;
  if (body.mood) extras.mood = body.mood;
  if (body.sleep_quality != null) extras.sleep_quality = body.sleep_quality;
  if (body.kind) extras.kind = body.kind;
  if (body.workout_kind) extras.workout_kind = body.workout_kind;
  if (body.execution) extras.execution = body.execution;
  if (body.body) extras.body_state = body.body;
  if (body.niggle && body.niggle.trim()) extras.niggle = body.niggle.trim();
  if (body.run_id) extras.run_id = body.run_id;
  const extrasJson = Object.keys(extras).length > 0 ? JSON.stringify(extras) : null;

  // Insert the check-in. We need the id back so we can patch in the
  // coach_reply once the slim LLM call returns.
  let insertedId: string | null = null;
  try {
    const r = await pool.query(
      `INSERT INTO check_ins (user_id, rating, briefing_id, surface, note, ts, extras)
       VALUES ($1, $2, $3, $4, $5, now(), $6::jsonb)
       RETURNING id`,
      [userId, rating, body.briefing_id ?? null, surface, body.note ?? null, extrasJson]
    );
    insertedId = String(r.rows[0]?.id ?? '');
  } catch (err: any) {
    return NextResponse.json({
      error: 'check-in insert failed',
      detail: err.message,
      hint: 'Did you apply web-v2/db/migrations/100_check_ins.sql?',
    }, { status: 500 });
  }

  // P-CHECKIN-REPLY 2026-05-27: removed the full-brief cache bust +
  // background regen. Submitting a check-in now generates an inline
  // 1-2 sentence reply from the coach instead of trashing the morning
  // brief and waiting 15-20s for a full LLM regen. The next natural
  // regen (day rollover, run ingest) folds the check-in into the
  // morning voice normally.
  // 2026-05-27 David's call: "if this is the reply, thats fine but
  // then we dont need to call in the API or LLM it can just be canned
  // responses." Generic acknowledgments don't earn an LLM call. Reserve
  // the LLM for the case where the runner wrote a NIGGLE — that's
  // unpredictable free text and worth a contextual response.
  //
  // Path A (default, ~95%+ of check-ins): chip-only → canned reply
  //   keyed on (workout_kind, execution, body). Instant, free,
  //   deterministic, on-voice. No LLM call.
  //
  // Path B: niggle present → LLM reply with full context. Costs
  //   ~$0.005-0.01, takes ~3-5s, but addresses the runner's actual
  //   words. This is where the model earns its keep.
  let coachReply: string | null = null;
  const hasNiggle = Boolean(body.niggle && body.niggle.trim());
  if (!hasNiggle) {
    coachReply = pickCannedReply(
      body.workout_kind ?? null,
      body.execution ?? null,
      body.body ?? null,
    );
  }
  if (coachReply == null) {
    // Either had a niggle (Path B) OR the canned matrix didn't have a
    // line for this combo (rare fallback) — call the LLM.
    try {
      const state = await loadCoachState(userId);
      const cached = await readCachedBriefing(userId, 'today').catch(() => null);
      coachReply = await generateCheckinReply({
        runner: state.profile?.full_name?.split(' ')[0] ?? 'David',
        today: state.today,
        todayWorkout: state.todayWorkout ? {
          type: state.todayWorkout.type,
          mi: state.todayWorkout.mi,
          label: state.todayWorkout.label,
        } : null,
        checkIn: {
          kind: body.kind ?? 'post_run',
          workout_kind: body.workout_kind ?? null,
          execution: body.execution ?? null,
          body: body.body ?? null,
          niggle: body.niggle ?? null,
        },
        todayBriefLead: (cached as any)?.lead ?? null,
      });
    } catch (e: any) {
      console.error('[checkin-reply] failed:', e?.message ?? e);
      coachReply = null;
    }
  }

  // Persist the reply onto the check-in row so a page refresh can show
  // it again, and so the next brief regen can see "what we said last time."
  if (coachReply && insertedId) {
    try {
      await pool.query(
        `UPDATE check_ins
            SET extras = COALESCE(extras, '{}'::jsonb) || jsonb_build_object('coach_reply', $1::text)
          WHERE id = $2`,
        [coachReply, insertedId]
      );
    } catch (e: any) {
      console.error('[checkin] failed to persist reply:', e?.message ?? e);
    }
  }

  return NextResponse.json({
    ok: true,
    rating,
    coach_reply: coachReply,
    recorded_at: new Date().toISOString(),
  });
}
