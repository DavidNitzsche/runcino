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
import { setRunnerTimezone } from '@/lib/runtime/runner-tz';
import { rebuildActivePlanForPrefs } from '@/lib/plan/auto-rebuild';

// A plan-shaping edit re-runs generatePlan inline (same path as the race
// hooks), which can take a few seconds. Give the route headroom.
export const maxDuration = 120;
// 2026-05-28 LLM rip (Cardinal Rule #1, PROJECT.md):
// generateBriefing deleted. The fact-reciter is deterministic +
// cheap, so there's no warm-fan-out to kick off — the next surface
// read just builds facts from current DB state.

// Fields written to the `profile` table.
const PROFILE_ALLOWED = new Set([
  'height_cm', 'sex', 'age', 'city', 'full_name',
  'birthday', 'lthr', 'experience_level',
  // P29 alias — iPhone settings sheet sends 'gender'; stored on `sex`.
  'gender',
  // P30 — onboarding real persistence.
  'strava_connected_at', 'health_connected_at', 'onboarded_at', 'notification_token',
  // P34 — cross-training opt-in.
  'cross_training_modes',
  // P35 — per-user toggles.
  'strava_auto_push', 'phone_hr_alerts',
  // P36 — editable from iPhone Profile settings.
  'weekly_mileage_target',
  // 2026-06-12 settings consolidation — weekly_frequency (plan days/week,
  // previously onboarding-only) + weight_kg (new column, HealthKit auto-fill).
  'weekly_frequency', 'weight_kg',
]);

// Fields written to the `users` table (sovereign physiology + race fuel).
// hrmax_observed / profile.hrmax are deprecated (Cluster 3); the sovereign
// max-HR path is users.max_hr_override, resolved by loadEffectiveMaxHr.
const USERS_ALLOWED = new Set([
  'max_hr_override', 'resting_hr_override',
  'fuel_brand', 'fuel_gel_carbs_g', 'fuel_target_g_per_hr',
]);

// Editing any of these reshapes the training plan → fire a rebuild.
const PLAN_SHAPING = new Set([
  'weekly_frequency', 'experience_level', 'weekly_mileage_target', 'cross_training_modes',
]);

/**
 * Coerce + bounds-check a single field. Returns the value to store. Throws
 * Error(message) on invalid input so the caller can 400. `null`/`''` are
 * accepted for the optional override / fuel / frequency fields → "clear".
 */
function validateField(key: string, raw: any): any {
  const intIn = (lo: number, hi: number): number | null => {
    if (raw === null || raw === '') return null;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${key} must be an integer ${lo}-${hi}`);
    return n;
  };
  const numIn = (lo: number, hi: number): number | null => {
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${key} must be ${lo}-${hi}`);
    return n;
  };
  switch (key) {
    case 'weekly_frequency':     return intIn(1, 7);
    case 'weight_kg':            return numIn(20, 300);
    case 'max_hr_override':      return intIn(100, 230);
    case 'resting_hr_override':  return intIn(25, 120);
    case 'lthr':                 return intIn(80, 220);
    case 'fuel_gel_carbs_g':     return intIn(0, 100);
    case 'fuel_target_g_per_hr': return intIn(0, 150);
    case 'fuel_brand':           return raw == null || raw === '' ? null : String(raw).slice(0, 80);
    default:                     return raw;
  }
}

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
      `SELECT p.full_name, p.sex, p.sex AS gender, p.age, p.city, p.height_cm,
              p.birthday::text AS birthday, p.lthr, p.hrmax,
              p.rhr, p.experience_level, p.lthr_method, p.lthr_set_at,
              p.strava_connected_at, p.health_connected_at, p.onboarded_at,
              p.cross_training_modes,
              p.strava_auto_push, p.strava_push_privacy, p.strava_push_title_format,
              p.weekly_mileage_target,
              -- 2026-06-12 settings consolidation
              p.weekly_frequency, p.weight_kg, p.timezone,
              COALESCE(p.user_settings->>'tz_mode', 'auto') AS tz_mode,
              u.email,
              u.max_hr_override, u.resting_hr_override,
              u.fuel_brand, u.fuel_gel_carbs_g, u.fuel_target_g_per_hr
         FROM profile p
         LEFT JOIN users u ON u.id = p.user_uuid
        WHERE p.user_uuid = $1
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

  // Partition incoming keys by destination: profile table, users table,
  // or the timezone handler. Validate + coerce each as we go.
  const profileUpdates: Record<string, any> = {};
  const usersUpdates: Record<string, any> = {};
  let tzValue: string | undefined;            // requested IANA tz ('' / null → unset)
  let tzMode: 'auto' | 'manual' | undefined;  // requested mode
  const changedPlanShaping: string[] = [];

  try {
    for (const k of Object.keys(body)) {
      if (k === 'user_id') continue;
      if (k === 'timezone') {
        tzValue = body[k] == null || body[k] === '' ? undefined : String(body[k]);
        tzMode = tzMode ?? 'manual'; // pinning a tz implies manual unless tz_mode says otherwise
        continue;
      }
      if (k === 'tz_mode') {
        const m = String(body[k]);
        if (m !== 'auto' && m !== 'manual') {
          return NextResponse.json({ error: 'tz_mode must be auto|manual' }, { status: 400 });
        }
        tzMode = m;
        continue;
      }
      if (USERS_ALLOWED.has(k)) { usersUpdates[k] = validateField(k, body[k]); continue; }
      if (PROFILE_ALLOWED.has(k)) {
        const v = validateField(k, body[k]);
        // gender → sex column alias (P29). Store on the legacy `sex` column.
        if (k === 'gender') profileUpdates.sex = v;
        else profileUpdates[k] = v;
        if (PLAN_SHAPING.has(k)) changedPlanShaping.push(k);
        continue;
      }
      return NextResponse.json({ error: `Field not allowed: ${k}` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'invalid field value' }, { status: 400 });
  }

  const hasTz = tzValue !== undefined || tzMode !== undefined;
  if (Object.keys(profileUpdates).length === 0 && Object.keys(usersUpdates).length === 0 && !hasTz) {
    return NextResponse.json({ error: 'No allowed fields in body' }, { status: 400 });
  }

  // Everything we actually changed → coach_intents log + ack payload.
  const acked: Record<string, any> = {};

  try {
    // 1 · sex → setBiologicalSex (keeps users.sex M/F + profile.sex in sync).
    if ('sex' in profileUpdates) {
      await setBiologicalSex(userId, normalizeSex(profileUpdates.sex));
      acked.sex = profileUpdates.sex;
      delete profileUpdates.sex;
    }

    // 2 · profile-table updates (dynamic UPDATE, insert the row if missing).
    const decorated = decorateUpdates(profileUpdates);
    if (Object.keys(decorated).length > 0) {
      const cols = Object.keys(decorated);
      const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const values = cols.map((c) => decorated[c]);
      const res = await pool.query(
        `UPDATE profile SET ${setClauses} WHERE user_uuid = $1 RETURNING user_uuid`,
        [userId, ...values],
      );
      if (res.rowCount === 0) {
        const insertCols = ['user_uuid', ...cols];
        const insertVals = [userId, ...values];
        const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
        await pool.query(
          `INSERT INTO profile (${insertCols.join(', ')}) VALUES (${placeholders})`,
          insertVals,
        );
      }
      for (const k of Object.keys(profileUpdates)) acked[k] = profileUpdates[k];
    }

    // 3 · users-table updates (max-HR / resting-HR override, race fuel).
    if (Object.keys(usersUpdates).length > 0) {
      const decoratedUsers: Record<string, any> = { ...usersUpdates };
      if ('max_hr_override' in usersUpdates) decoratedUsers.max_hr_updated_at = new Date().toISOString();
      const cols = Object.keys(decoratedUsers);
      const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const values = cols.map((c) => decoratedUsers[c]);
      await pool.query(`UPDATE users SET ${setClauses} WHERE id = $1`, [userId, ...values]);
      for (const k of Object.keys(usersUpdates)) acked[k] = usersUpdates[k];
    }

    // 4 · timezone (manual override / mode flip). Only-a-tz defaults to manual.
    if (hasTz) {
      await setRunnerTimezone(userId, tzValue ?? null, tzMode ?? 'manual');
      if (tzValue !== undefined) acked.timezone = tzValue;
      if (tzMode !== undefined) acked.tz_mode = tzMode;
    }

    // 5 · coach_intents per changed field (voice acknowledges once).
    for (const [k, v] of Object.entries(acked)) {
      await pool.query(
        `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
         VALUES ($1, $1, 'profile_field_added', $2, $3)`,
        [userId, k, String(v ?? '')],
      ).catch(() => {});
    }

    // 6 · profile edits change zones + paces; bust the in-process memos.
    await bustBriefingCacheForEvent(userId, 'profile_edit');

    // 7 · plan-shaping change → rebuild the active race-prep OR goal-mode
    //     plan inline (2026-07-06 · P1-16), same generatePlan path as the
    //     race hooks. Failure is isolated so the settings save still succeeds.
    let replanned = false;
    if (changedPlanShaping.length > 0) {
      const r = await rebuildActivePlanForPrefs(userId, changedPlanShaping).catch(() => ({ ok: false }));
      replanned = !!r.ok;
    }

    return NextResponse.json({ ok: true, updated: acked, replanned });
  } catch (err: any) {
    return NextResponse.json({ error: 'profile update failed', detail: err.message }, { status: 500 });
  }
}
