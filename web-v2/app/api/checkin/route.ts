/**
 * POST /api/checkin   { rating, briefing_id?, surface?, note?, ... }
 *
 * Closed loop §8.1: reply chip → check_ins row → next surface read
 * picks up the rating + note via loadCoachState's `recentCheckIns`.
 *
 * 2026-05-28 LLM rip (Cardinal Rule #1, PROJECT.md):
 *   - extractCheckin (Anthropic free-text → ExtractedSignals) → GONE.
 *     We persist the runner's raw note verbatim. The reader sees what
 *     they wrote on the next surface load.
 *   - generateContextualReply / generateCheckinReply (slim Anthropic
 *     reply for niggle text / unknown chip combos) → GONE. The canned
 *     reply matrix (deterministic) is the only voice.
 *   - readCachedBriefing (LLM-era brief cache) → GONE. There is no
 *     cache; fact-reciter is cheap enough to re-build on every read.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import {
  pickCannedReply,
  defaultReply,
  niggleAckReply,
} from '@/lib/coach/checkin-reply-canned';

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
  execution?: string;
  body?: 'fresh' | 'worked' | 'cooked';
  niggle?: string | null;
  run_id?: string | null;
}

/**
 * Map post-run execution+body chips onto the legacy solid/tired/wrecked
 * rating. See git history before 2026-05-28 for the chip-mapping doctrine.
 *
 *   SOLID   = completed the prescribed work (incl. grinding through)
 *   TIRED   = couldn't do what the workout asked
 *   WRECKED = body=cooked (the only auto-wrecked trigger)
 */
function ratingFromPostRun(execution?: string, body?: string): Rating | null {
  const exec = (execution ?? '').toLowerCase();
  if (['nailed', 'chatty', 'controlled', 'grinded', 'strong', 'faded',
       'crushed_goal', 'on_goal'].includes(exec)) return 'solid';
  if (['pushed', 'missed', 'walled', 'missed_goal'].includes(exec)) return 'tired';

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

  // Three intake shapes:
  //  (a) legacy: { rating: solid|tired|wrecked, ... }
  //  (b) #150:   { kind: 'post_run', execution, body, niggle? }
  //  (c) text-only: { kind: 'post_run', niggle: <text> } — defaults to
  //      'solid' since there's no LLM to refine the rating from text.
  //      The text itself is what the runner re-reads on the next surface.
  let rating = body.rating?.toLowerCase();
  if (!rating && body.kind === 'post_run') {
    const derived = ratingFromPostRun(body.execution, body.body);
    rating = derived ?? undefined;
  }
  const textPresent = Boolean((body.niggle ?? body.note ?? '').trim());
  if (!rating && textPresent) {
    rating = 'solid';
  }
  if (!rating || !VALID_RATINGS.includes(rating as Rating)) {
    return NextResponse.json({
      error: 'check-in needs at least one of: rating, execution+body chips, or free text',
    }, { status: 400 });
  }

  const userId = body.user_id ?? DAVID_USER_ID;
  const surface = body.surface ?? 'today';

  // P34 — build the optional 'extras' jsonb from any expanded fields.
  // Stays null if the caller only sent rating/note (back-compat).
  // #150 — also persist the two-axis signal (execution + body + niggle).
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

  // Insert the check-in.
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

  // Reply: niggle text → ack with snippet; chip-only → canned matrix
  // line, falling through to defaultReply when no entry fits.
  const noteText = (body.niggle ?? body.note ?? '').trim();
  const hasText = noteText.length > 0;
  const coachReply: string = hasText
    ? niggleAckReply(noteText)
    : (pickCannedReply(
        body.workout_kind ?? null,
        body.execution ?? null,
        body.body ?? null,
      ) ?? defaultReply(body.workout_kind ?? null));

  // Persist the reply + the raw note onto the row so a page refresh
  // can rehydrate them, and the next surface read can show the note.
  if (insertedId) {
    try {
      const patch: Record<string, any> = { coach_reply: coachReply };
      if (hasText) patch.note = noteText;
      await pool.query(
        `UPDATE check_ins
            SET extras = COALESCE(extras, '{}'::jsonb) || $1::jsonb
          WHERE id = $2`,
        [JSON.stringify(patch), insertedId],
      );
    } catch (e: any) {
      console.error('[checkin] failed to persist extras:', e?.message ?? e);
    }
  }

  return NextResponse.json({
    ok: true,
    rating,
    coach_reply: coachReply,
    recorded_at: new Date().toISOString(),
  });
}
