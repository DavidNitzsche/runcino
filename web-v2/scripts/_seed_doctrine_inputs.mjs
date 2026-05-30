/**
 * Seed input-doctrine rows from docs/ONBOARDING_AUDIT.md.
 *
 * Adds 4 system-doctrine rows covering the input-tiers + fallback-ladder
 * rules that govern what the coach needs and where it comes from.
 *
 * Idempotent via ON CONFLICT (slug) DO UPDATE.
 */
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const articles = [
  {
    slug: 'doctrine-input-tiers',
    title: 'Input tiers — what the coach needs per runner',
    body: `Every runner is described by six tiers of input. The contract is fixed: every signed-up user — David, the next runner, the 1000th — should arrive at first coaching with the same inputs filled. The PATH to fill them differs (Apple Health auto-fills some; manual entry fills others), but the SET of fields the coach reads is fixed.\n\n<strong>T1 · Identity</strong> — required at onboarding · gates plan generation, briefing greeting, time-aware UX. Fields: name, email, timezone, user UUID.\n\n<strong>T2 · Physiology</strong> — required for accurate coaching · gates HR zones, age-grading, cadence thresholds. Fields: age (from birthday), sex, height_cm, experience_level. <em>Without these the coach hedges or defers.</em>\n\n<strong>T3 · Connected-source data</strong> — auto when Apple Health / Strava connected; manual fallback when not. Fields: max_hr, resting_hr, LTHR, sleep, HRV, weight, VO2 max, HR recovery, cadence, run power, etc. Today only max_hr / resting_hr / LTHR have real manual fallbacks; the rest are gap-cards waiting to surface.\n\n<strong>T4 · Volume + history</strong> — required for plan generation. Fields: weekly_mileage_target, weekly_frequency, history_avg_weekly_mi, history_longest_recent_mi, history_years_running. Asked as chip-bucketed values; converted to integer midpoints.\n\n<strong>T5 · Schedule + units</strong> — required before first plan. Fields: long_run_dow, quality_dows, rest_dow, units (distance / pace / temp), briefing_time. Defaults exist (Sun/Tue+Thu/Sat, imperial) so onboarding doesn't HAVE to ask, but the first plan respects whatever is set.\n\n<strong>T6 · Pro features</strong> — optional. Fields: fuel_brand, fuel_target_g_per_hr, cross_training_modes, strava_writeback, notification_prefs per-category. The coach reads these when set; defaults to none.\n\nFull audit + fallback ladders in <code>docs/ONBOARDING_AUDIT.md</code>.`,
    citations: [
      { kind: 'doctrine', path: 'docs/ONBOARDING_AUDIT.md' },
      { kind: 'code', path: 'web-v2/app/api/onboarding/complete/route.ts' },
      { kind: 'code', path: 'web-v2/lib/coach/profile-state.ts' },
    ],
  },
  {
    slug: 'doctrine-fallback-ladder',
    title: 'Physiology fallback ladder — manual → auto → formula → gap',
    body: `For every physiology field (max HR, resting HR, LTHR, weight, etc.), the resolution order is:\n\n<strong>1. MANUAL OVERRIDE.</strong> <code>users.max_hr_override</code> / <code>users.resting_hr_override</code> / <code>profile.lthr</code> / <code>profile.height_cm</code> set explicitly via Settings or onboarding. Wins everything else.\n\n<strong>2. AUTO from CONNECTOR.</strong> When Apple Health is connected, <code>health_samples</code> samples auto-ratchet <code>users.max_hr</code> and roll into <code>users.resting_hr</code> (60d avg). LTHR auto-derives from race <code>meta.avgHrBpm</code> for half-marathon-distance races (HM avg HR ≈ LTHR per <code>Research/03</code>).\n\n<strong>3. POPULATION FORMULA.</strong> Last-resort estimate: <code>220 - age</code> for max HR; defaults to null otherwise. Always wrapped in a hedge ("hard to call zones without a verified max HR yet").\n\n<strong>4. PROFILE_GAP CARD.</strong> When even the formula doesn't apply, the coach surfaces a profile_gap card on TODAY asking the runner to fill in the missing input. Example: no <code>height_cm</code> → <code>cadence_experiment</code> topic suppressed; profile_gap card surfaces asking for height with a one-line explainer of why it matters.\n\nThe contract: <strong>the coaching engine never crashes for missing inputs.</strong> Every code path has a fallback, defers gracefully, or surfaces a gap card. New connector providers (Garmin, Coros, Polar, Whoop, Oura) plug into the same ladder as Apple Health.`,
    citations: [
      { kind: 'doctrine', path: 'docs/ONBOARDING_AUDIT.md', section: 'The fallback ladder' },
      { kind: 'code', path: 'web-v2/lib/coach/profile-state.ts', function: 'max_hr resolution chain' },
      { kind: 'code', path: 'web-v2/lib/training/zones.ts', function: 'estimateLTHR, estimateMaxHRFromLTHR' },
    ],
  },
  {
    slug: 'doctrine-apple-health-optional',
    title: 'Apple Health is recommended, not required',
    body: `Apple Health is the highest-quality biometric source. When connected, it auto-flows ~12-19 sample types (sleep_hours, hrv, resting_hr, max_hr, vo2_max, body_mass, body_fat_pct, lean_mass, run_power, cadence, ground_contact_time, vertical_ratio, vertical_oscillation, stride_length, spo2, respiratory_rate, wrist_temp, hr_recovery, active_energy).\n\nBut the system <strong>must work without it.</strong> Web-only users (no iOS app) cannot connect HealthKit. The coach should never assume Apple Health is present.\n\nToday's manual-fallback coverage:\n- max_hr: manual via <code>max_hr_override</code> ✓\n- resting_hr: manual via <code>resting_hr_override</code> ✓\n- LTHR: manual via <code>profile.lthr</code> ✓\n- weight: NO manual path (GAP)\n- sleep: NO manual path (GAP — readiness Sleep pillar degrades)\n- HRV: NO manual path (GAP — readiness HRV pillar degrades)\n- VO2 max: NO manual path (wellness-only signal; OK to be null)\n- HR recovery, cadence, run power, GCT, vertical osc, stride length: NO manual path (form/topic cards suppress when missing)\n\nThe coaching engine handles these gaps via the fallback ladder + profile_gap cards. The recommended fix for sleep/HRV: add lightweight daily check-in fields so a web-only user can volunteer "8h, felt good" without an Apple Watch.`,
    citations: [
      { kind: 'doctrine', path: 'docs/ONBOARDING_AUDIT.md', section: 'T3 Connected-source data' },
      { kind: 'code', path: 'web-v2/app/api/ingest/health/route.ts' },
    ],
  },
  {
    slug: 'doctrine-onboarding-min-set',
    title: 'Onboarding minimum — what the coach needs before first session',
    body: `The minimum set of inputs to coach a runner safely:\n\n<strong>Tier 1 (identity):</strong> name, email, timezone.\n\n<strong>Tier 2 (physiology):</strong> birthday (or age), sex, experience_level. Height_cm is recommended but suppresses cadence cards rather than blocking the plan.\n\n<strong>Tier 4 (volume):</strong> at least ONE of: connected Strava with 4+ weeks of activity, OR onboarding history chips (history_avg_weekly_mi + history_longest_recent_mi). Without one of these, the plan-builder falls back to the conservative beginner ramp regardless of self-reported experience.\n\n<strong>Goal:</strong> a race (distance + date) OR a maintenance mode anchor. Time is optional — defaults to "by feel" prescriptions until VDOT computes.\n\nWhat the coach <strong>does</strong> when one of these is missing:\n- Missing physiology → hedges every prescription, surfaces profile_gap cards, falls back to %MHR zones instead of LTHR\n- Missing volume → defaults to beginner ramp (3-4 days/week, 20mpw peak); flags the assumption in TODAY voice\n- Missing goal → maintenance mode, 16-week flat aerobic plan, 1 quality/week, no race countdown\n\nWhat the coach <strong>never</strong> does: prescribe specific HR zones without a verified anchor (max_hr OR LTHR OR a race-derived estimate). Better to defer than to publish wrong numbers.`,
    citations: [
      { kind: 'doctrine', path: 'docs/ONBOARDING_AUDIT.md', section: 'Step 1 to Step 5' },
      { kind: 'code', path: 'web-v2/lib/plan/seed-from-onboarding.ts' },
      { kind: 'code', path: 'web-v2/lib/plan/generate.ts' },
    ],
  },
];

try {
  for (const a of articles) {
    await pool.query(
      `INSERT INTO learn_articles (slug, title, eyebrow, body_md, citations_json, related_slugs, updated_ts)
       VALUES ($1, $2, 'SYSTEM DOCTRINE', $3, $4::jsonb, $5, NOW())
       ON CONFLICT (slug) DO UPDATE
       SET title = EXCLUDED.title, eyebrow = 'SYSTEM DOCTRINE',
           body_md = EXCLUDED.body_md, citations_json = EXCLUDED.citations_json,
           updated_ts = NOW()`,
      [a.slug, a.title, a.body, JSON.stringify(a.citations), []]
    );
    console.log(`✓ ${a.slug.padEnd(40)} ${a.title}`);
  }
  const counts = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM learn_articles WHERE eyebrow='SYSTEM DOCTRINE'`
  )).rows[0].n;
  console.log(`\nTotal SYSTEM DOCTRINE rows: ${counts}`);
} catch (e) { console.error(e); process.exit(1); }
finally { await pool.end(); }
