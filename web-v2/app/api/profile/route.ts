/**
 * PATCH /api/profile  { height_cm?, ... }
 *
 * §8.6 closed loop: profile gap input → writes profile.<field> →
 * coach_intents row 'profile_field_added' → next surface read shows
 * the new value directly (no LLM regen — fact-reciter reads state on
 * demand).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireUserId } from '@/lib/auth/session';
import { setBiologicalSex, normalizeSex } from '@/lib/coach/biological-sex';
// 2026-05-28 LLM rip (Cardinal Rule #1, PROJECT.md):
// generateBriefing deleted. The fact-reciter is deterministic +
// cheap, so there's no warm-fan-out to kick off — the next surface
// read just builds facts from current DB state.

const ALLOWED = new Set([
  'height_cm', 'sex', 'age', 'city', 'full_name',
  'birthday', 'lthr', 'experience_level',
  // hrmax_observed removed (Cluster 3) — column cleared in Cluster 2 DDL;
  // sovereign max HR override path is users.max_hr_override, not this column.
  // P29 alias — iPhone settings sheet sends 'gender' for clarity, server
  // still stores as 'sex' for backwards compat. Both accepted.
  'gender',
  // P30 — onboarding real persistence.
  'strava_connected_at', 'health_connected_at', 'onboarded_at', 'notification_token',
  // P34 — cross-training opt-in.
  'cross_training_modes',
  // P35 — per-user toggles.
  'strava_auto_push', 'phone_hr_alerts',
  // P36 — editable from iPhone Profile settings.
  'weekly_mileage_target',
]);

// When LTHR is set manually, also stamp lthr_set_at + lthr_method.
function decorateUpdates(updates: Record<string, any>): Record<string, any> {
  const out = { ...updates };
  if ('lthr' in updates) {
    out.lthr_set_at = new Date().toISOString();
    if (!('lthr_method' in updates)) out.lthr_method = 'manual';
  }
  return out;
}

/**
 * GET /api/profile — readable shape for the iPhone settings sheet + any
 * other client. Returns the editable + identity fields, plus connection
 * timestamps so onboarding/UI can render a real "connected" state.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    const r = await pool.query(
      `SELECT full_name, sex, sex AS gender, age, city, height_cm,
              birthday::text AS birthday, lthr, hrmax,
              rhr, experience_level, lthr_method, lthr_set_at,
              strava_connected_at, health_connected_at, onboarded_at,
              cross_training_modes,
              strava_auto_push, strava_push_privacy, strava_push_title_format,
              weekly_mileage_target
         FROM profile
        WHERE user_uuid = $1
        LIMIT 1`,
      [userId],
    );
    if (r.rowCount === 0) {
      // No row yet — return empty defaults so iPhone settings sheet
      // doesn't break on first install.
      return NextResponse.json({});
    }
    return NextResponse.json(r.rows[0]);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const updates: Record<string, any> = {};
  for (const k of Object.keys(body)) {
    if (k === 'user_id') continue;
    if (!ALLOWED.has(k)) {
      return NextResponse.json({ error: `Field not allowed: ${k}` }, { status: 400 });
    }
    // gender → sex column alias (P29). Store on the legacy `sex` column.
    if (k === 'gender') {
      updates.sex = body[k];
    } else {
      updates[k] = body[k];
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No allowed fields in body' }, { status: 400 });
  }

  // 2026-06-01 · biological_sex doctrine. When sex/gender is part of
  // the patch, route through setBiologicalSex() so BOTH users.sex (with
  // its M/F constraint) AND profile.sex (freetext) are kept in sync.
  // The direct UPDATE below only touches profile · without this branch
  // iPhone agent reading users.sex would see a stale value.
  if ('sex' in updates) {
    const norm = normalizeSex(updates.sex);
    await setBiologicalSex(userId, norm);
    // Strip from `updates` so the profile UPDATE below doesn't double-write.
    delete updates.sex;
  }
  const decorated = decorateUpdates(updates);
  if (Object.keys(decorated).length === 0) {
    // Only sex was patched · we wrote it via setBiologicalSex. Skip the
    // empty UPDATE and proceed to the coach_intents + cache-bust block.
    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, 'profile_field_added', 'sex', $2)`,
      [userId, String(body.sex ?? body.gender ?? '')],
    );
    await bustBriefingCacheForEvent(userId, 'profile_edit');
    return NextResponse.json({ ok: true, updated: { sex: body.sex ?? body.gender } });
  }
  // Build dynamic UPDATE
  const cols = Object.keys(decorated);
  const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const values = cols.map((c) => decorated[c]);

  try {
    const res = await pool.query(
      `UPDATE profile SET ${setClauses}
       WHERE user_uuid = $1
       RETURNING ${cols.join(', ')}`,
      [userId, ...values]
    );
    if (res.rowCount === 0) {
      // No profile row yet for this user — insert one.
      const insertCols = ['user_uuid', ...cols];
      const insertVals = [userId, ...values];
      const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
      await pool.query(
        `INSERT INTO profile (${insertCols.join(', ')}) VALUES (${placeholders})`,
        insertVals
      );
    }

    // Log a coach_intent per field so the voice acknowledges once.
    for (const [k, v] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
         VALUES ($1, $1, 'profile_field_added', $2, $3)`,
        [userId, k, String(v)]
      );
    }

    // Profile edits change zones + paces; bust the in-process memos.
    // The next /today + /plan fact reads pick up changes directly from
    // the loaders — no LLM regen to kick off.
    await bustBriefingCacheForEvent(userId, 'profile_edit');

    return NextResponse.json({ ok: true, updated: updates });
  } catch (err: any) {
    return NextResponse.json({
      error: 'profile update failed', detail: err.message,
    }, { status: 500 });
  }
}
