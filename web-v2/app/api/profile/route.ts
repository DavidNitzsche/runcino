/**
 * PATCH /api/profile  { height_cm?, ... }
 *
 * §8.6 closed loop: profile gap input → writes profile.<field> →
 * coach_intents row 'profile_field_added' → next briefing acknowledges once.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCache } from '@/lib/coach/cache';
import { generateBriefing } from '@/lib/coach/engine';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

const ALLOWED = new Set(['height_cm', 'sex', 'age', 'city']);

export async function PATCH(req: NextRequest) {
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const userId = body.user_id ?? DAVID_USER_ID;
  const updates: Record<string, any> = {};
  for (const k of Object.keys(body)) {
    if (k === 'user_id') continue;
    if (!ALLOWED.has(k)) {
      return NextResponse.json({ error: `Field not allowed: ${k}` }, { status: 400 });
    }
    updates[k] = body[k];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No allowed fields in body' }, { status: 400 });
  }

  // Build dynamic UPDATE
  const cols = Object.keys(updates);
  const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const values = cols.map((c) => updates[c]);

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
        `INSERT INTO coach_intents (user_id, reason, field, value)
         VALUES ($1, 'profile_field_added', $2, $3)`,
        [userId, k, String(v)]
      );
    }

    // Bust briefing cache + warm next briefing in background.
    await bustBriefingCache(userId);
    void generateBriefing(userId, 'today').catch(() => {});
    void generateBriefing(userId, 'training').catch(() => {});

    return NextResponse.json({ ok: true, updated: updates });
  } catch (err: any) {
    return NextResponse.json({
      error: 'profile update failed', detail: err.message,
    }, { status: 500 });
  }
}
