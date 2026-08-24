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
 *     histAvg:            '0-5' | '5-15' | '15-25' | '25-35' | '35+' | '45+' | null,
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
import { requireUserId } from '@/lib/auth/session';
import { dayKeyInTz } from '@/lib/runtime/day-key';
import { deriveOnboardingComplete, isRefusal } from '@/lib/onboarding/complete-inputs';
import { seedMaintenancePlanFromOnboarding } from '@/lib/plan/seed-from-onboarding';
import { generatePlan } from '@/lib/plan/generate';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { distanceMiFromLabel } from '@/lib/race/distance'; // 2026-07-06 · P1-17 · shared label→mi parser

// The validators and the derivation moved to lib/onboarding/complete-inputs.ts
// (2026-08-24, byte-identical) so the front door can be walked with no
// database, no session and no HTTP. This route is the only production caller;
// `lib/onboarding/_onboarding_e2e.test.ts` is the other one.

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // ── Validate + derive ────────────────────────────────────────────
  // Every validator, every fallback and every derivation lives in
  // lib/onboarding/complete-inputs.ts. `timezone` is read here first only
  // because `dayKeyInTz` needs it to resolve the runner's own today, which
  // the start-date clamp measures against.
  //
  // dayKeyInTz carries the same UTC fallback for an unparseable zone, but
  // keeps the "which day is it for this runner" question in one place
  // (lib/runtime/day-key.ts) instead of an inline try/catch per caller.
  const tzForToday = typeof body.timezone === 'string' && body.timezone.length > 0
    ? body.timezone : 'UTC';
  const todayInTz = dayKeyInTz(new Date(), tzForToday);
  const derived = deriveOnboardingComplete(body, todayInTz);
  if (isRefusal(derived)) {
    return NextResponse.json({ error: derived.error }, { status: derived.status });
  }
  const {
    distance, isCoached, isRace, date, time, name, timezone, connectionsSkipped,
    ttDistance, ttTime, ttTimeSeconds, weeklyMi, weeklyFreq,
    histAvg, histLong, histYears, experienceLevel, raceHistory,
    histAvgMi, histLongMi, birthday, sex, heightCm, ageNum,
    longRunDay, restDay, startDate,
  } = derived;
  // The user_settings patch merged into profile.user_settings (jsonb).
  const settingsPatch: Record<string, unknown> = { coached_externally: isCoached };
  if (longRunDay) { settingsPatch.long_run_day = longRunDay; settingsPatch.rest_day = restDay; }
  if (ttTimeSeconds != null) settingsPatch.tt_goal_time_seconds = ttTimeSeconds;
  // ── Atomic onboarding write (txn) ────────────────────────────────
  //
  // Pass-4 fix: previously the users + profile + user_prefs writes were
  // three independent pool.query calls. A network blip between them
  // could leave a runner with users set but no profile, or profile
  // without user_prefs — exactly the half-onboarded state that crashed
  // /today (audit Q-4 in OPEN_QUESTIONS.md).
  //
  // Now: single connection, BEGIN, all three writes, COMMIT. Either all
  // succeed or none. Idempotent — re-running just upserts.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // onboarding_complete = TRUE is what the sign-in redirect keys off
    // ('/today' vs '/onboarding' in /api/auth/email + /api/auth/apple).
    // Before 2026-06-10 nothing ever set it — a finished runner bounced
    // back into the deck on every fresh login.
    await client.query(
      `UPDATE users SET
          -- 2026-08-17 · fill-only: an iOS-synced timezone is never
          -- clobbered by the web deck's detected value. Changing tz later
          -- is a Settings action, not a re-onboarding side effect.
          timezone = COALESCE(NULLIF(timezone, ''), $1),
          name = COALESCE(NULLIF(name, ''), $2),
          age = COALESCE(age, $3),
          sex = COALESCE(sex, $4),
          onboarding_complete = TRUE,
          updated_at = NOW()
        WHERE id = $5`,
      [timezone, name, ageNum, sex, userId]
    );

    // user_prefs · row creation if missing. Defaults match what the
    // plan generator falls back to when prefs are absent (Sun/Tue+Thu/Sat).
    // Onboarding doesn't currently ASK for these; we create the row so
    // the first plan + the Settings UI both have a real row to read +
    // edit.
    //
    // 2026-06-10 fix: the PK is the LEGACY user_id text column (DEFAULT
    // 'me') — there is NO unique constraint on user_uuid, so the old
    // ON CONFLICT (user_uuid) threw "no unique or exclusion constraint"
    // for EVERY new onboarder. Set user_id = uuid-as-text and conflict
    // on the real PK.
    // long-run/rest day reflect the runner's pick (default sun/sat). Both
    // the text day-key columns and the int dow columns are written so the
    // Settings UI and any reader stay consistent. The generator itself
    // reads user_settings.long_run_day (jsonb · written above).
    const lrdKey = longRunDay ?? 'sun';
    const restKey = restDay ?? 'sat';
    const lrdDow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(lrdKey);
    const restDow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(restKey);
    await client.query(
      `INSERT INTO user_prefs (user_id, user_uuid, long_run_day, long_run_dow, quality_days, quality_dows, rest_day, rest_dow, units, updated_at)
       VALUES ($1::text, $1::uuid, $2, $3, 'tue,thu', '2,4', $4, $5, 'imperial', NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, lrdKey, lrdDow, restKey, restDow]
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    return NextResponse.json({
      error: 'onboarding atomic txn failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }

  // ── Upsert profile (still inside txn) ────────────────────────────
  // The PATCH at /api/profile is gated by an ALLOWED set that doesn't
  // include the new onboarding columns. Going direct to the DB keeps
  // that surface untouched and lets this endpoint stay specific.
  try {
    // profile.goal_race_distance has a CHECK allowing only the original
    // five values · coached mode stores 'none' there (true: no race goal
    // owned by Faff) and carries its identity in user_settings.
    const goalDistanceForProfile = isCoached ? 'none' : distance;
    const update = await client.query(
      `UPDATE profile SET
          goal_race_distance      = $1,
          goal_race_date          = $2,
          goal_race_time          = $3,
          -- $4 is the onboarding "name" field, which native sends as the RACE
          -- name (default "Goal Race") — NOT the person. Signup already set the
          -- real full_name, so preserve it and only fall back to $4 when the
          -- profile somehow has none. (Was: full_name = $4, which clobbered the
          -- runner's name → the coach would address them as "Goal Race".)
          full_name               = COALESCE(NULLIF(full_name, ''), $4),
          -- 2026-08-17 · fill-only, same rule as users.timezone above.
          timezone                = COALESCE(NULLIF(timezone, ''), $5),
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
          age                     = COALESCE(age, $18),
          race_history            = $19::jsonb,
          user_settings           = user_settings || $20::jsonb,
          -- 2026-06-21 · incoming experience WINS (write-once was wrong here).
          -- COALESCE(experience_level, $21) was copied from the physiology
          -- guards above (birthday/sex/height/age — correctly write-once), but
          -- experience is a field a runner must be able to correct: a re-
          -- onboarding runner who fixes "advanced" → "beginner" was stuck at
          -- advanced and handed the interval machine (workflow MAJOR). Keep the
          -- existing value only when the new payload omits it ($21 IS NULL).
          experience_level        = COALESCE($21, experience_level)
        WHERE user_uuid = $14
        RETURNING user_uuid`,
      [
        goalDistanceForProfile, date, time, name, timezone, connectionsSkipped,
        ttDistance, ttTime, weeklyMi, weeklyFreq,
        histAvgMi, histLongMi, histYears,
        userId,
        birthday, sex, heightCm, ageNum,
        // 2026-06-03 · race history JSONB · always written (may be []).
        // Stamps the runner's self-reported PRs · voice-band reads from
        // profile.race_history alongside the races table.
        JSON.stringify(raceHistory.map((e) => ({ ...e, source: 'self_reported' }))),
        // Rule 6 discipline: field-level jsonb merge — coached_externally
        // (always written true/false so re-onboarding coached→race clears
        // it) + long_run_day/rest_day when picked. Other user_settings
        // keys are never clobbered.
        JSON.stringify(settingsPatch),
        experienceLevel,
      ]
    );

    if (update.rowCount === 0) {
      // No row yet — first-ever onboarder. Insert one. user_id (the
      // LEGACY text PK, DEFAULT 'me') must be set to the uuid-as-text
      // or this collides with the legacy 'me' row (2026-06-10 fix —
      // same landmine as /api/auth/signup's profile insert).
      await client.query(
        `INSERT INTO profile (
            user_id, user_uuid,
            goal_race_distance, goal_race_date, goal_race_time,
            full_name, timezone,
            onboarding_completed_at, onboarded_at,
            connections_skipped,
            tt_goal_distance, tt_goal_time,
            weekly_mileage_target, weekly_frequency,
            history_avg_weekly_mi, history_longest_recent_mi, history_years_running,
            birthday, sex, height_cm, age,
            race_history,
            user_settings,
            experience_level
          ) VALUES (
            $1::text, $1::uuid, $2, $3, $4, $5, $6, NOW(), NOW(), $7,
            $8, $9, $10, $11, $12, $13, $14,
            $15::date, $16, $17, $18,
            $19::jsonb,
            $20::jsonb,
            $21
          )`,
        [
          userId, goalDistanceForProfile, date, time, name, timezone, connectionsSkipped,
          ttDistance, ttTime, weeklyMi, weeklyFreq,
          histAvgMi, histLongMi, histYears,
          birthday, sex, heightCm, ageNum,
          JSON.stringify(raceHistory.map((e) => ({ ...e, source: 'self_reported' }))),
          JSON.stringify(settingsPatch),
          experienceLevel,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    return NextResponse.json({
      error: 'onboarding persist failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  } finally {
    client.release();
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
    | { ok: boolean; mode?: 'race-prep' | 'maintenance' | 'coached' | 'none'; race_slug?: string; plan_id?: string; weeks_generated?: number; peak_mpw?: number; error?: string }
    | null = null;
  if (isCoached) {
    // Coached mode: Faff authors NOTHING. No races row, no training_plans
    // row. The runner's coach owns the prescription; Faff tracks runs,
    // readiness, and health. Surfaces read the plan-less state +
    // profile.user_settings.coached_externally.
    seedPlan = { ok: true, mode: 'coached' };
  } else if (isRace) {
    try {
      const distanceLabel = raceDistanceLabel(distance);
      const raceName = `My ${distanceLabel}`;
      // 2026-06-05 · backend audit P0-8 fix · slug was global ("my-5k-
      // 2026-08-15") · two users picking the same default race
      // overwrote each other's row + bled meta into the wrong plan.
      // 2026-08-17 · made ATOMIC (mirrors POST /api/race): the SELECT
      // precheck swallowed its own errors (.catch → rows:[]) and raced the
      // write — either path let the unconditional DO UPDATE merge this
      // runner's meta into ANOTHER user's row. The upsert below now carries
      // the ownership guard itself; rowCount 0 means the slug is foreign-
      // owned and we retry once with the userId suffix. First runner to
      // claim a name keeps clean URLs; subsequent runners get
      // "my-5k-2026-08-15-abcdef12".
      let slug = slugify(`${raceName}-${date}`);
      const meta = {
        name: raceName,
        date,                                   // YYYY-MM-DD (required on race path)
        distanceLabel,                          // "5K" | "10K" | "Half Marathon" | "Marathon"
        // 2026-07-06 · P1-17 · distanceMi was never written on the onboarding
        // path (mirrors the POST /api/race fix) — without it execution-plan,
        // pacing, and fueling all 404/skip for every onboarded race. Null is
        // stripped by jsonb_strip_nulls below (Rule 6: no clobber).
        distanceMi: distanceMiFromLabel(distanceLabel),
        priority: 'A',                          // onboarding goal race is THE A-race
        goalDisplay: normalizeGoalDisplay(time, distance), // canonical H:MM:SS (or null)
        location: null,
      };
      // Mirror POST /api/race exactly (idempotent on slug → re-onboarding
      // updates the same row instead of duplicating). Rule 6 guard: never
      // full-replace meta — re-onboarding after the race must not erase
      // finishTime/bib/goalSafeDisplay that PATCH wrote onto this blob.
      //
      // 2026-06-10 persona-suite catch: races.plan + races.gpx_text are
      // NOT NULL with no defaults — omitting them failed EVERY race-path
      // onboarding ("null value in column plan"). plan seeds the goal
      // when the runner typed one (goal-gap reads plan.goal.finish_time_s)
      // else {}; gpx_text '' until a course exists. On conflict the
      // existing plan wins unless it's still the empty seed (Rule 6).
      const goalSec = (() => {
        const m = (meta.goalDisplay ?? '').match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
        return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
      })();
      const planSeed = goalSec ? { goal: { finish_time_s: goalSec } } : {};
      // Ownership-guarded upsert · DO UPDATE only touches a row THIS user
      // owns (same-user re-onboarding stays idempotent, Rule 6 merge
      // intact); a foreign-owned slug filters to rowCount 0 → suffix retry.
      // Plain DO NOTHING was rejected: it would duplicate the race on
      // every same-user re-onboarding.
      // 2026-08-17 · races composite-PK prep · mirrors POST /api/race:
      // conflict target (slug, user_uuid); ownership WHERE kept as
      // belt-and-braces (redundant under a composite target, still
      // load-bearing pre-migration); 23505 mapped to rowCount 0 so the
      // suffix retry fires the same way before and after the PK swap,
      // while races_pkey (slug) still coexists with races_slug_user_uniq.
      const claimSlug = (s: string) => pool.query(
        `INSERT INTO races (slug, user_uuid, meta, plan, gpx_text)
         VALUES ($1, $2, $3, $4::jsonb, '')
         ON CONFLICT (slug, user_uuid) DO UPDATE
           SET meta = races.meta || jsonb_strip_nulls(EXCLUDED.meta),
               plan = CASE WHEN races.plan = '{}'::jsonb THEN EXCLUDED.plan ELSE races.plan END
         WHERE races.user_uuid = EXCLUDED.user_uuid`,
        [s, userId, meta, JSON.stringify(planSeed)]
      ).catch((e: unknown) => {
        if ((e as { code?: string } | null)?.code === '23505') return { rowCount: 0, rows: [] };
        throw e;
      });
      if ((await claimSlug(slug)).rowCount === 0) {
        slug = `${slug}-${userId.slice(0, 8)}`;
        if ((await claimSlug(slug)).rowCount === 0) {
          // Suffixed slug also foreign-owned (8-hex uuid-prefix collision) —
          // refuse rather than merge into someone else's row.
          throw new Error(`race slug unavailable: ${slug}`);
        }
      }
      // Canonical race-prep generator. Best-effort: returns ok:false with
      // a reason for edge runways (<2wks / >1yr / <3wks) — the race row
      // still stands, and lifecycle authors the plan once it's in range.
      // The runner picked their start day (defaults to today). The plan's
      // week 0 anchors there — startAnchor:'today' is the fallback when
      // no explicit date was sent (legacy clients).
      const result = await generatePlan({ userId, raceSlug: slug, startAnchor: 'today', startDateISO: startDate ?? undefined });
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
  } else if (ttDistance) {
    // Transitional: a TT goal still arriving in the onboarding payload (older
    // clients that collect a goal at onboarding) → seed the goal build. The new
    // flow removes goal entry from onboarding; the goal is set later via
    // /api/profile/goal, which generates the plan. Kept so older builds work.
    try {
      const result = await seedMaintenancePlanFromOnboarding({
        userId,
        startDateISO: startDate ?? undefined,
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
  } else {
    // NEW FLOW: no race AND no goal at onboarding → author NOTHING. The runner
    // lands on the empty TODAY ("add a race or goal to start a plan"); a plan
    // is generated when they add a race (/api/race) or a goal
    // (/api/profile/goal). No more quiet consistency-maintenance plan.
    seedPlan = { ok: true, mode: 'none' };
  }

  return NextResponse.json({
    success: true,
    redirect: '/onboarding?step=done',
    ...(seedPlan ? { plan: seedPlan } : {}),
  });
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
