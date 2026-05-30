/**
 * POST /api/onboarding/complete
 *
 * Lilian onboarding (locked 2026-05-28) · final write.
 * Called when the runner taps "Start training" on step 3. Persists
 * every answer collected through the URL-driven flow into the
 * profile table (columns added in migrations 115 + 118).
 *
 * Body:
 *   {
 *     distance:           '5k' | '10k' | 'half' | 'marathon' | 'none',
 *     date:               'YYYY-MM-DD' | null,
 *     time:               'HH:MM:SS'   | null,
 *
 *     // Step 1b · no-race-only (silently ignored on race paths).
 *     ttDistance:         '1mi' | '5k' | '10k' | null,
 *     ttTime:             string | null,   // bucketed range chip value
 *     weeklyMi:           15 | 25 | 35 | 45 | 55 | null,
 *     weeklyFreq:         3 | 4 | 5 | 6 | null,
 *     histAvg:            '0-5' | '5-15' | '15-25' | '25-35' | '35+' | null,
 *     histLong:           '0-3' | '3-6' | '6-10' | '10+' | null,
 *     histYears:          '<1' | '1-3' | '3-7' | '7+' | null,
 *
 *     name:               string,
 *     timezone:           'America/Los_Angeles' | ...,
 *     connectionsSkipped: boolean,
 *   }
 *
 * Returns:
 *   { success: true, redirect: '/onboarding?step=done' }
 *
 * Persistence on the legacy `onboarded_at` column is kept in sync so the
 * existing OnboardingFlow / profile-state code paths keep working.
 *
 * ────────────────────────────────────────────────────────────────────
 * PLAN-GEN HANDOFF · NO-RACE PATH (Phase 16.5 · documentation only)
 * ────────────────────────────────────────────────────────────────────
 * The canonical plan-builder lives at legacy/web/coach/plan-builder.ts:
 *
 *   buildPlan({
 *     state:  CoachState,      // realtime VDOT / volume / readiness
 *     prefs:  {
 *       longRunDow, qualityDows, restDow,
 *       level?: 'beginner' | 'intermediate' | 'advanced',
 *     },
 *     race?:  { id, name, dateISO, distanceMi, priority },
 *     todayISO?, planId?, userId?,
 *   }) → Plan
 *
 * When `race` is omitted, the builder emits a MAINTENANCE plan
 * (16-week flat aerobic, 1 quality/week). It currently auto-derives
 * the runner's level from `state.volume.weeklyAvg4w` via
 * `autoDetectLevel()` and pulls peak-volume targets from
 * doctrine/plan_templates.ts.
 *
 * The new fields below are what the no-race path captures. Mapping:
 *
 *   weekly_mileage_target  → BuildPlanInputs.prefs.weeklyMiTarget *
 *   weekly_frequency       → drives prefs.qualityDows.length + restDow
 *   tt_goal_distance/time  → biases the QUALITY mix (mile/5K time-trial =
 *                            VO2max-leaning; 10K = threshold-leaning)
 *   history_avg_weekly_mi  → seed for state.volume.weeklyAvg4w when Strava
 *                            isn't connected; floor for auto-detected level
 *   history_longest_recent_mi → floor for peakLongRunMi (so a 12mi-long
 *                            history doesn't get a 6mi-long plan)
 *   history_years_running  → coarse advanced/intermediate/beginner hint;
 *                            7+ years lifts the auto-detected level by one
 *
 * (*) The builder doesn't yet read a `weeklyMiTarget` from prefs — it
 * sizes by autoDetectLevel + doctrineTemplate peakVolume. Wiring this
 * properly is the Phase 17 plan-gen task and is intentionally out of
 * scope for this endpoint. For now we just persist the runner's answers
 * so the builder can pick them up once the contract is extended.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';
import {
  HIST_AVG_MIDPOINTS,
  HIST_LONG_MIDPOINTS,
  type HistAvg,
  type HistLong,
  type HistYears,
  type TTDistance,
  type WeeklyMileage,
  type WeeklyFrequency,
} from '@/lib/onboarding/state';
import { seedMaintenancePlanFromOnboarding } from '@/lib/plan/seed-from-onboarding';
import { generatePlan } from '@/lib/plan/generate';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const VALID_DISTANCES = new Set(['5k', '10k', 'half', 'marathon', 'none']);
const VALID_TT_DISTANCES = new Set<TTDistance>(['1mi', '5k', '10k']);
const VALID_WEEKLY_MI = new Set<WeeklyMileage>([15, 25, 35, 45, 55]);
const VALID_FREQ = new Set<WeeklyFrequency>([3, 4, 5, 6]);
const VALID_HIST_AVG = new Set<HistAvg>(['0-5', '5-15', '15-25', '25-35', '35+']);
const VALID_HIST_LONG = new Set<HistLong>(['0-3', '3-6', '6-10', '10+']);
const VALID_HIST_YEARS = new Set<HistYears>(['<1', '1-3', '3-7', '7+']);

export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const userId = await userIdFromRequest(req);

  // ── Validate inputs ──────────────────────────────────────────────
  const distance = typeof body.distance === 'string' && VALID_DISTANCES.has(body.distance)
    ? body.distance : null;
  if (!distance) {
    return NextResponse.json({ error: 'distance is required' }, { status: 400 });
  }

  const isRace = distance !== 'none';
  const date: string | null = isRace && isValidDate(body.date) ? body.date : null;
  if (isRace && !date) {
    return NextResponse.json({ error: 'race date is required when a race distance is picked' }, { status: 400 });
  }

  const time: string | null = isValidTime(body.time) ? body.time : null;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const timezone = typeof body.timezone === 'string' && body.timezone.length > 0
    ? body.timezone : null;
  if (!timezone) {
    return NextResponse.json({ error: 'timezone is required' }, { status: 400 });
  }

  const connectionsSkipped = Boolean(body.connectionsSkipped);

  // ── Step 1b · no-race fields ────────────────────────────────────
  // Only persist these on the no-race path. We don't HARD-fail when
  // they're missing (the runner could be on a race path) — null is fine.
  const ttDistance = !isRace && typeof body.ttDistance === 'string'
      && VALID_TT_DISTANCES.has(body.ttDistance as TTDistance)
    ? (body.ttDistance as TTDistance) : null;
  const ttTime = !isRace && ttDistance && typeof body.ttTime === 'string'
      && body.ttTime.length > 0 && body.ttTime.length <= 32
    ? body.ttTime : null;
  const weeklyMi = !isRace && Number.isFinite(Number(body.weeklyMi))
      && VALID_WEEKLY_MI.has(Number(body.weeklyMi) as WeeklyMileage)
    ? (Number(body.weeklyMi) as WeeklyMileage) : null;
  const weeklyFreq = !isRace && Number.isFinite(Number(body.weeklyFreq))
      && VALID_FREQ.has(Number(body.weeklyFreq) as WeeklyFrequency)
    ? (Number(body.weeklyFreq) as WeeklyFrequency) : null;
  const histAvg = !isRace && typeof body.histAvg === 'string'
      && VALID_HIST_AVG.has(body.histAvg as HistAvg)
    ? (body.histAvg as HistAvg) : null;
  const histLong = !isRace && typeof body.histLong === 'string'
      && VALID_HIST_LONG.has(body.histLong as HistLong)
    ? (body.histLong as HistLong) : null;
  const histYears = !isRace && typeof body.histYears === 'string'
      && VALID_HIST_YEARS.has(body.histYears as HistYears)
    ? (body.histYears as HistYears) : null;

  // Convert chip ranges → integer midpoints for the DB (history_* columns).
  // The original chip strings are still recoverable from the bucket order
  // if we ever want them back; for plan-gen we only need a numeric seed.
  const histAvgMi = histAvg ? HIST_AVG_MIDPOINTS[histAvg] : null;
  const histLongMi = histLong ? HIST_LONG_MIDPOINTS[histLong] : null;

  // ── Sync users.timezone (canonical) + users.name + sex/age ───────
  // The data plan §2 names users.timezone as the canonical timezone
  // column (read by state-loader, briefing time logic). Without this
  // mirror, the onboarding runner's tz lives in profile.timezone only
  // and the coach engine never sees it — Q-07 in OPEN_QUESTIONS.md.
  //
  // 2026-05-30 pass-4: also accept birthday / sex / height_cm from the
  // onboarding body. Per docs/ONBOARDING_AUDIT.md T2-physiology, these
  // SHOULD be asked at onboarding (not as a separate profile edit weeks
  // later). UI form upgrades coming; backend accepts them now so the
  // form can wire any time without another API change.
  const birthday = typeof body.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.birthday)
    ? body.birthday : null;
  const sex = typeof body.sex === 'string' && /^(M|F|m|f|male|female)$/i.test(body.sex)
    ? (body.sex.toUpperCase().startsWith('M') ? 'M' : 'F') : null;
  const heightCm = Number.isFinite(Number(body.height_cm))
    && Number(body.height_cm) >= 120 && Number(body.height_cm) <= 230
    ? Number(body.height_cm) : null;
  const ageNum = birthday ? (() => {
    const b = new Date(birthday + 'T12:00:00Z');
    if (isNaN(b.getTime())) return null;
    const now = new Date();
    let a = now.getUTCFullYear() - b.getUTCFullYear();
    const before = now.getUTCMonth() < b.getUTCMonth() ||
      (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
    if (before) a--;
    return (a >= 13 && a <= 100) ? a : null;
  })() : null;
  try {
    await pool.query(
      `UPDATE users SET
          timezone = $1,
          name = COALESCE(NULLIF(name, ''), $2),
          age = COALESCE(age, $3),
          sex = COALESCE(sex, $4)
        WHERE id = $5`,
      [timezone, name, ageNum, sex, userId]
    );
  } catch {
    // Non-fatal — the profile write below still proceeds.
  }

  // ── Upsert profile ───────────────────────────────────────────────
  // The PATCH at /api/profile is gated by an ALLOWED set that doesn't
  // include the new onboarding columns. Going direct to the DB keeps
  // that surface untouched and lets this endpoint stay specific.
  try {
    const update = await pool.query(
      `UPDATE profile SET
          goal_race_distance      = $1,
          goal_race_date          = $2,
          goal_race_time          = $3,
          full_name               = $4,
          timezone                = $5,
          onboarding_completed_at = NOW(),
          onboarded_at            = COALESCE(onboarded_at, NOW()),
          connections_skipped     = $6,
          tt_goal_distance        = $7,
          tt_goal_time            = $8,
          weekly_mileage_target   = $9,
          weekly_frequency        = $10,
          history_avg_weekly_mi   = $11,
          history_longest_recent_mi = $12,
          history_years_running   = $13,
          birthday                = COALESCE(birthday, $15::date),
          sex                     = COALESCE(sex, $16),
          height_cm               = COALESCE(height_cm, $17),
          age                     = COALESCE(age, $18)
        WHERE user_uuid = $14
        RETURNING user_uuid`,
      [
        distance, date, time, name, timezone, connectionsSkipped,
        ttDistance, ttTime, weeklyMi, weeklyFreq,
        histAvgMi, histLongMi, histYears,
        userId,
        birthday, sex, heightCm, ageNum,
      ]
    );

    if (update.rowCount === 0) {
      // No row yet — first-ever onboarder. Insert one.
      await pool.query(
        `INSERT INTO profile (
            user_uuid,
            goal_race_distance, goal_race_date, goal_race_time,
            full_name, timezone,
            onboarding_completed_at, onboarded_at,
            connections_skipped,
            tt_goal_distance, tt_goal_time,
            weekly_mileage_target, weekly_frequency,
            history_avg_weekly_mi, history_longest_recent_mi, history_years_running,
            birthday, sex, height_cm, age
          ) VALUES (
            $1, $2, $3, $4, $5, $6, NOW(), NOW(), $7,
            $8, $9, $10, $11, $12, $13, $14,
            $15::date, $16, $17, $18
          )`,
        [
          userId, distance, date, time, name, timezone, connectionsSkipped,
          ttDistance, ttTime, weeklyMi, weeklyFreq,
          histAvgMi, histLongMi, histYears,
          birthday, sex, heightCm, ageNum,
        ]
      );
    }
  } catch (err: any) {
    return NextResponse.json({
      error: 'onboarding persist failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }

  // ── Seed the runner's first plan ───────────────────────────────
  // Both paths get a usable plan on day 1; the next lifecycle rebuild
  // (via the iPhone / Watch path which reaches legacy buildPlan)
  // upgrades it with full doctrine (VDOT-derived paces, adaptive
  // strength, workout_spec emission).
  //
  // RACE path — A-race goal: write a `races` row (so the anchor exists
  // for the countdown, goal-pace derivation, and /races), then author a
  // full periodized race-prep plan via the canonical web-v2 generator
  // (lib/plan/generate.ts — BASE→QUALITY→RACE-SPECIFIC→TAPER, every
  // block cited to /Research/). Previously the race path wrote
  // goal_race_* to the profile and assumed "lifecycle picks it up" —
  // but nothing ever created the race row, so the runner hit a dead
  // end: no race on the calendar, no plan. This closes that gap.
  //
  // NO-RACE path — maintenance: there's no race anchor to pull off
  // later, so seed a 16-week maintenance plan from the captured goals
  // via the thin maintenance seeder (mirrors the canonical maintenance
  // branch).
  //
  // Best-effort for BOTH: a seeding failure never blocks onboarding —
  // the runner still lands on the success page, and the next briefing
  // pull rebuilds via lifecycle. We surface the outcome in the response
  // payload so the caller can log issues in dev.
  let seedPlan:
    | { ok: boolean; mode?: 'race-prep' | 'maintenance'; race_slug?: string; plan_id?: string; weeks_generated?: number; peak_mpw?: number; error?: string }
    | null = null;
  if (isRace) {
    try {
      const distanceLabel = raceDistanceLabel(distance);
      const raceName = `My ${distanceLabel}`;
      const slug = slugify(`${raceName}-${date}`);
      const meta = {
        name: raceName,
        date,                                   // YYYY-MM-DD (required on race path)
        distanceLabel,                          // "5K" | "10K" | "Half Marathon" | "Marathon"
        priority: 'A',                          // onboarding goal race is THE A-race
        goalDisplay: normalizeGoalDisplay(time, distance), // canonical H:MM:SS (or null)
        location: null,
      };
      // Mirror POST /api/race exactly (idempotent on slug → re-onboarding
      // updates the same row instead of duplicating).
      await pool.query(
        `INSERT INTO races (slug, user_uuid, meta)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET meta = EXCLUDED.meta`,
        [slug, userId, meta]
      );
      // Canonical race-prep generator. Best-effort: returns ok:false with
      // a reason for edge runways (<2wks / >1yr / <3wks) — the race row
      // still stands, and lifecycle authors the plan once it's in range.
      const result = await generatePlan({ userId, raceSlug: slug });
      seedPlan = {
        ok: result.ok,
        mode: 'race-prep',
        race_slug: slug,
        plan_id: result.plan_id,
        weeks_generated: result.weeks_generated,
        error: result.ok ? undefined : result.reason,
      };
      await bustBriefingCacheForEvent(userId, 'race_crud').catch(() => {});
    } catch (err: any) {
      seedPlan = { ok: false, mode: 'race-prep', error: err?.message ?? String(err) };
    }
  } else {
    try {
      const result = await seedMaintenancePlanFromOnboarding({
        userId,
        goals: {
          ttDistance,
          ttTimeBucket: ttTime,
          weeklyMiTarget: weeklyMi,
          weeklyFrequency: weeklyFreq,
          historyAvg: histAvg,
          historyLong: histLong,
          historyYears: histYears,
        },
      });
      seedPlan = {
        ok: result.ok,
        mode: 'maintenance',
        plan_id: result.plan_id,
        weeks_generated: result.weeks_generated,
        peak_mpw: result.peak_mpw,
      };
    } catch (err: any) {
      seedPlan = { ok: false, mode: 'maintenance', error: err?.message ?? String(err) };
    }
  }

  return NextResponse.json({
    success: true,
    redirect: '/onboarding?step=done',
    ...(seedPlan ? { plan: seedPlan } : {}),
  });
}

function isValidDate(v: any): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function isValidTime(v: any): v is string {
  return typeof v === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(v);
}

/** Slug for the races row. Mirrors POST /api/race's slugify exactly so
 *  the two creation paths produce identical keys (idempotent re-runs). */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Onboarding distance code → race `meta.distanceLabel`. The label is
 *  chosen so distanceMiOf() in lib/plan/generate.ts (and the prescription
 *  + glance-state goal queries) resolve the right mileage by keyword:
 *  "Marathon" (not "half") → 26.2, "Half Marathon" → 13.1, etc. */
function raceDistanceLabel(distance: string): string {
  switch (distance) {
    case '5k':       return '5K';
    case '10k':      return '10K';
    case 'half':     return 'Half Marathon';
    case 'marathon': return 'Marathon';
    default:         return distance.toUpperCase();
  }
}

/** Normalize a runner-typed goal time into the canonical H:MM:SS the
 *  downstream parsers require (parseGoalSeconds wants three colon-parts).
 *  The goal-time input is free text, so disambiguate two-part times by
 *  distance: a 5K/10K "22:30" is MM:SS → 0:22:30; a half/marathon
 *  "1:35" is H:MM → 1:35:00. Unparseable → null (race still created,
 *  just without a goal pace, which degrades to by-feel honestly). */
function normalizeGoalDisplay(time: string | null, distance: string): string | null {
  if (!time) return null;
  const t = time.trim();
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(t)) return t;          // already H:MM:SS
  const two = t.match(/^(\d{1,2}):(\d{2})$/);
  if (two) {
    const isShort = distance === '5k' || distance === '10k';
    return isShort
      ? `0:${two[1].padStart(2, '0')}:${two[2]}`           // MM:SS → 0:MM:SS
      : `${two[1]}:${two[2]}:00`;                          // H:MM  → H:MM:00
  }
  return null;
}
