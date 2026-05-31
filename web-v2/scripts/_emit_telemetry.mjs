/**
 * _emit_telemetry.mjs · live system telemetry report.
 *
 * Scans production read-only and emits docs/SYSTEM_TELEMETRY.html with a
 * snapshot of what the coach is seeing, what data came in clean vs.
 * degraded, what's missing, and what plain-English signals David should
 * watch.
 *
 * Run: node web-v2/scripts/_emit_telemetry.mjs
 * Output: docs/SYSTEM_TELEMETRY.html
 *
 * Designed to be safe to run on a daily cron · all queries are read-only.
 * Sections:
 *   1. System health (cron last-fire, queue depths)
 *   2. Data flow integrity (last 30d runs — completeness checklist)
 *   3. Coach activity (last 14d intents/proposals/actions/briefings)
 *   4. Plan state (active plan + recent adaptations)
 *   5. Health data quality (samples by source, suspect values)
 *   6. What's missing (RPE gaps, weather gaps, unmatched workouts)
 *   7. Plain-English signals David should watch
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT = path.join(REPO_ROOT, 'docs', 'SYSTEM_TELEMETRY.html');

const env = fs.readFileSync(path.join(REPO_ROOT, 'web-v2', '.env.local'), 'utf8')
  .split('\n').reduce((a,l) => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, ''); return a; }, {});

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// ── Helpers ────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtDate = (d) => d == null ? '—' : new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const fmtDuration = (sec) => {
  if (sec == null) return '—';
  const s = Math.round(sec);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
};
const fmtRelative = (d) => {
  if (d == null) return 'never';
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};
const tone = (status) => {
  if (status === 'good') return 'tone-good';
  if (status === 'warn') return 'tone-warn';
  if (status === 'bad') return 'tone-bad';
  return 'tone-neutral';
};
const checkmark = (b) => b ? '<span class="tone-good">✓</span>' : '<span class="tone-bad">✗</span>';

// ── Section runners ────────────────────────────────────────────────────

async function sectionSystemHealth() {
  const cronRoutes = ['run-adaptations', 'enrich-weather', 'snapshot-projections', 'notifications', 'keep-warm', 'refresh-briefings', 'promote-courses'];

  // last_adapted_at on David's active plan
  const plan = (await pool.query(
    `SELECT id, mode, race_id, goal_iso, last_adapted_at, authored_iso
       FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [DAVID],
  )).rows[0];

  // projection snapshots — count by source
  const projBySource = (await pool.query(
    `SELECT source, COUNT(*) AS n, MAX(snapshot_date) AS last
       FROM projection_snapshots
      WHERE user_uuid = $1
      GROUP BY source ORDER BY 1`,
    [DAVID],
  )).rows;

  // weather enrichment freshness · "has_gps" matches the route-integrity definition
  const weatherFreshness = (await pool.query(
    `SELECT MAX(weather_enriched_at) AS last_enrich,
            COUNT(*) FILTER (WHERE data->>'weather' IS NOT NULL) AS enriched,
            COUNT(*) FILTER (
              WHERE (data->>'routePolyline' IS NOT NULL AND length(data->>'routePolyline') > 0)
                 OR (data ? 'startLatLng' AND jsonb_typeof(data->'startLatLng') = 'array')
                 OR (data ? 'startLat' AND data ? 'startLng')
            ) AS has_gps,
            COUNT(*) AS total
       FROM runs
      WHERE user_uuid = $1`,
    [DAVID],
  )).rows[0];

  // notifications pending queue depth
  let notifQueue = { pending: 0, oldest: null };
  try {
    const r = (await pool.query(
      `SELECT COUNT(*) FILTER (WHERE processed_at IS NULL) AS pending,
              MIN(fire_at) FILTER (WHERE processed_at IS NULL) AS oldest
         FROM notifications_pending WHERE user_uuid = $1`,
      [DAVID],
    )).rows[0];
    notifQueue = r;
  } catch {
    // table may have user_id not user_uuid; soft-skip
  }

  return { plan, projBySource, weatherFreshness, notifQueue, cronRoutes };
}

async function sectionRunIntegrity() {
  // Last 30d runs · completeness columns
  const runs = (await pool.query(
    `SELECT
         id::text                                              AS id,
         data->>'name'                                          AS name,
         COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS date_iso,
         (data->>'distanceMi')::numeric                         AS distance_mi,
         (data->>'movingTimeS')::numeric                        AS moving_s,
         data->>'avgHr'                                         AS avg_hr,
         (
           -- Garmin / device path stores the route as an encoded polyline string.
           -- Strava-direct path stores it as data.startLatLng = [lat, lng] array.
           -- Either is fine · this run has GPS if the runner has a route to see.
           (data->>'routePolyline' IS NOT NULL AND length(data->>'routePolyline') > 0)
           OR (data ? 'startLatLng' AND jsonb_typeof(data->'startLatLng') = 'array')
           OR (data ? 'startLat' AND data ? 'startLng')
         )                                                       AS has_gps,
         data->>'weather' IS NOT NULL                           AS has_weather,
         data ? 'splits'                                        AS has_splits,
         data ? 'hrSamples'                                     AS has_hr_samples,
         weather_enriched_at                                    AS weather_attempt,
         shoe_id IS NOT NULL                                    AS has_shoe
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'date')::date >= CURRENT_DATE - 30
      ORDER BY (data->>'date')::date DESC
      LIMIT 15`,
    [DAVID],
  )).rows;

  // Plan workout match — any plan_workouts within ±1d of each run
  for (const r of runs) {
    const m = (await pool.query(
      `SELECT pw.id, pw.type, pw.distance_mi, pw.date_iso, pw.sub_label
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1
          AND tp.archived_iso IS NULL
          AND pw.date_iso::date BETWEEN $2::date - 1 AND $2::date + 1
        ORDER BY ABS(pw.date_iso::date - $2::date)
        LIMIT 1`,
      [DAVID, r.date_iso],
    )).rows[0];
    r.matched_plan = m || null;

    // RPE logged?
    const rpe = (await pool.query(
      `SELECT rpe, logged_at FROM post_run_rpe WHERE user_uuid = $1 AND activity_id = $2 LIMIT 1`,
      [DAVID, r.id],
    )).rows[0];
    r.rpe = rpe || null;
  }

  return { runs };
}

async function sectionCoachActivity() {
  // coach_intents by reason in last 14d
  const intents = (await pool.query(
    `SELECT reason, COUNT(*) AS n, MAX(ts) AS last_ts
       FROM coach_intents
      WHERE user_uuid = $1
        AND ts >= NOW() - INTERVAL '14 days'
      GROUP BY reason ORDER BY MAX(ts) DESC`,
    [DAVID],
  )).rows;

  // coach_intents log · last 10 rows
  const intentsRecent = (await pool.query(
    `SELECT reason, field, value, ts, acknowledged_at
       FROM coach_intents
      WHERE user_uuid = $1
      ORDER BY ts DESC LIMIT 10`,
    [DAVID],
  )).rows;

  // coach_proposals · status breakdown
  let proposals = [];
  try {
    proposals = (await pool.query(
      `SELECT id, proposal_type, status, created_at, responded_at, expires_at
         FROM coach_proposals
        WHERE user_uuid = $1
        ORDER BY created_at DESC LIMIT 10`,
      [DAVID],
    )).rows;
  } catch {}

  // coach_actions · any historical?
  let actions = [];
  try {
    actions = (await pool.query(
      `SELECT action_type, mode, trigger, created_at
         FROM coach_actions
        WHERE user_uuid = $1
        ORDER BY created_at DESC LIMIT 10`,
      [DAVID],
    )).rows;
  } catch {}

  // briefings · what surfaces are being rendered
  const briefingsRecent = (await pool.query(
    `SELECT surface, mode, generated_at
       FROM briefings
      WHERE user_uuid = $1
      ORDER BY generated_at DESC LIMIT 10`,
    [DAVID],
  )).rows;

  return { intents, intentsRecent, proposals, actions, briefingsRecent };
}

async function sectionPlanState() {
  const plan = (await pool.query(
    `SELECT id, mode, race_id, goal_iso, last_adapted_at, authored_iso, adaptation_log
       FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [DAVID],
  )).rows[0];

  let mutations = [];
  try {
    mutations = (await pool.query(
      `SELECT pm.workout_id, pm.ts, pm.reason, pm.trigger_kind, pm.changed_fields, pm.status, pw.date_iso, pw.type
         FROM plan_mutations pm
         JOIN plan_workouts pw ON pw.id = pm.workout_id
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1
          AND pm.ts >= NOW() - INTERVAL '30 days'
        ORDER BY pm.ts DESC LIMIT 10`,
      [DAVID],
    )).rows;
  } catch {}

  // Upcoming 14 days of plan_workouts
  const upcoming = (await pool.query(
    `SELECT pw.id, pw.date_iso, pw.type, pw.distance_mi, pw.is_quality, pw.is_long, pw.sub_label,
            pw.original_date_iso, pw.original_type, pw.original_distance_mi,
            (pw.date_iso != pw.original_date_iso OR pw.type != pw.original_type OR pw.distance_mi != pw.original_distance_mi) AS modified
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.date_iso::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 13
      ORDER BY pw.date_iso::date`,
    [DAVID],
  )).rows;

  return { plan, mutations, upcoming };
}

async function sectionHealthDataQuality() {
  // Samples in last 14d by type + source
  const samplesByType = (await pool.query(
    `SELECT sample_type, source, COUNT(*) AS n,
            MIN(value) AS min_v, AVG(value) AS avg_v, MAX(value) AS max_v,
            MIN(sample_date) AS first, MAX(sample_date) AS last
       FROM health_samples
      WHERE (user_uuid = $1 OR user_id = $1)
        AND sample_date >= CURRENT_DATE - 14
      GROUP BY sample_type, source
      ORDER BY sample_type, source`,
    [DAVID],
  )).rows;

  // Sleep coverage — how many of last 14 days have a sleep sample
  const sleepCoverage = (await pool.query(
    `WITH days AS (
       SELECT generate_series(CURRENT_DATE - 13, CURRENT_DATE, '1 day'::interval)::date AS d
     )
     SELECT d, EXISTS (
       SELECT 1 FROM health_samples
        WHERE (user_uuid = $1 OR user_id = $1)
          AND sample_type IN ('sleep_hours', 'asleep', 'time_asleep')
          AND sample_date = d
     ) AS has_sample
     FROM days ORDER BY d`,
    [DAVID],
  )).rows;

  // RHR baseline + recent
  const rhr14d = (await pool.query(
    `SELECT AVG(value) AS baseline, COUNT(*) AS n_samples
       FROM health_samples
      WHERE (user_uuid = $1 OR user_id = $1)
        AND sample_type IN ('resting_hr', 'resting_heart_rate')
        AND sample_date >= CURRENT_DATE - 14`,
    [DAVID],
  )).rows[0];

  // Suspect values
  const suspects = (await pool.query(
    `SELECT sample_type, value, source, sample_date
       FROM health_samples
      WHERE (user_uuid = $1 OR user_id = $1)
        AND sample_date >= CURRENT_DATE - 30
        AND (
          (sample_type IN ('resting_hr','resting_heart_rate') AND (value > 100 OR value < 30)) OR
          (sample_type = 'sleep_hours' AND (value > 14 OR value < 1)) OR
          (sample_type = 'hrv_ms' AND (value > 200 OR value < 5))
        )
      ORDER BY sample_date DESC LIMIT 5`,
    [DAVID],
  )).rows;

  return { samplesByType, sleepCoverage, rhr14d, suspects };
}

async function sectionWhatsMissing() {
  // Last 14d runs without RPE
  const runsNoRPE = (await pool.query(
    `SELECT sa.id::text AS id,
            COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) AS date_iso,
            sa.data->>'name' AS name,
            (sa.data->>'distanceMi')::numeric AS distance_mi
       FROM runs sa
      WHERE sa.user_uuid = $1
        AND NOT (sa.data ? 'mergedIntoId')
        AND (sa.data->>'date')::date >= CURRENT_DATE - 14
        AND NOT EXISTS (
          SELECT 1 FROM post_run_rpe rpe
           WHERE rpe.user_uuid = $1 AND rpe.activity_id = sa.id::text
        )
      ORDER BY (sa.data->>'date')::date DESC LIMIT 10`,
    [DAVID],
  )).rows;

  // Runs without weather despite having GPS
  const runsNoWeather = (await pool.query(
    `SELECT id::text AS id,
            COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS date_iso,
            data->>'name' AS name,
            weather_enriched_at IS NOT NULL AS attempted
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'date')::date >= CURRENT_DATE - 14
        AND (
          (data->>'routePolyline' IS NOT NULL AND length(data->>'routePolyline') > 0)
          OR (data ? 'startLatLng' AND jsonb_typeof(data->'startLatLng') = 'array')
          OR (data ? 'startLat' AND data ? 'startLng')
        )
        AND data->>'weather' IS NULL
      ORDER BY (data->>'date')::date DESC LIMIT 10`,
    [DAVID],
  )).rows;

  // Plan quality workouts in last 14d without a matching strava_activity
  const skippedQuality = (await pool.query(
    `SELECT pw.id, pw.date_iso, pw.type, pw.sub_label, pw.distance_mi
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.is_quality
        AND pw.date_iso::date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 1
        AND NOT EXISTS (
          SELECT 1 FROM runs sa
           WHERE sa.user_uuid = $1
             AND NOT (sa.data ? 'mergedIntoId')
             AND (sa.data->>'date')::date BETWEEN pw.date_iso::date - 1 AND pw.date_iso::date + 1
             AND (sa.data->>'distanceMi')::numeric >= GREATEST(pw.distance_mi * 0.7, 3)
        )
      ORDER BY pw.date_iso::date DESC`,
    [DAVID],
  )).rows;

  return { runsNoRPE, runsNoWeather, skippedQuality };
}

// ── HTML render ────────────────────────────────────────────────────────

function renderHtml(d) {
  const now = new Date().toISOString();
  const plan = d.systemHealth.plan;
  const wx = d.systemHealth.weatherFreshness;
  const lastAdaptedRel = fmtRelative(plan?.last_adapted_at);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>System Telemetry · Faff</title>
<meta name="viewport" content="width=900">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#0a0c10; --ink:#f6f7f8; --mute:#8a90a0;
    --line:rgba(255,255,255,0.08); --card:#11141a; --card2:#1a1d24;
    --good:#14C08C; --warn:#F5C518; --bad:#F43F5E;
    --active:#4F8FF7; --learn:#B084FF;
  }
  html,body{background:var(--bg);color:var(--ink);font-family:'Inter',sans-serif;margin:0;padding:0;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1180px;margin:0 auto;padding:48px 28px 96px;}
  h1{font-family:'Oswald',sans-serif;font-weight:700;font-size:54px;letter-spacing:-0.5px;margin:0;line-height:.92;text-transform:uppercase;}
  h1 .sub{color:var(--learn);}
  .lede{color:var(--mute);margin-top:12px;font-size:14px;max-width:760px;line-height:1.55;}
  .stamp{display:inline-block;padding:3px 10px;border-radius:4px;font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;background:rgba(176,132,255,0.18);color:#d4baff;margin-top:10px;font-family:'JetBrains Mono',monospace;}
  h2{font-family:'Oswald',sans-serif;font-weight:600;font-size:28px;letter-spacing:.3px;margin:48px 0 12px;border-bottom:1px solid var(--line);padding-bottom:8px;text-transform:uppercase;}
  h2 .num{font-size:14px;color:var(--mute);margin-right:12px;font-family:'JetBrains Mono',monospace;font-weight:400;letter-spacing:.4px;}
  h3{font-family:'Inter',sans-serif;font-size:11px;font-weight:700;color:var(--learn);letter-spacing:1.4px;text-transform:uppercase;margin:24px 0 8px;}
  p{color:rgba(246,247,248,0.9);line-height:1.6;margin:0 0 12px;font-size:14px;}
  code{background:rgba(255,255,255,0.06);padding:1px 6px;border-radius:4px;font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--active);}
  table{width:100%;border-collapse:collapse;margin:10px 0 22px;font-size:13px;background:var(--card);border-radius:10px;overflow:hidden;border:1px solid var(--line);}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top;}
  th{font-size:10.5px;font-weight:700;color:var(--mute);text-transform:uppercase;letter-spacing:1.2px;background:var(--card2);}
  td.mono{font-family:'JetBrains Mono',monospace;font-size:12px;}
  td.right{text-align:right;}
  td.num{font-family:'Oswald',sans-serif;font-weight:600;}
  .tone-good{color:var(--good);font-weight:700;}
  .tone-warn{color:var(--warn);font-weight:700;}
  .tone-bad{color:var(--bad);font-weight:700;}
  .tone-neutral{color:var(--mute);}
  .pill{display:inline-block;padding:2px 8px;border-radius:5px;font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;}
  .pill.good{background:rgba(20,192,140,0.18);color:#8ee4c3;}
  .pill.warn{background:rgba(245,197,24,0.18);color:#ffde7a;}
  .pill.bad{background:rgba(244,63,94,0.18);color:#ffb3bd;}
  .pill.neutral{background:rgba(255,255,255,0.06);color:var(--mute);}
  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0;}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;}
  .stat .n{font-family:'Oswald',sans-serif;font-weight:700;font-size:28px;color:var(--ink);line-height:1;}
  .stat .l{font-size:10.5px;color:var(--mute);text-transform:uppercase;letter-spacing:1.2px;margin-top:6px;}
  .stat.good .n{color:var(--good);}
  .stat.warn .n{color:var(--warn);}
  .stat.bad .n{color:var(--bad);}
  .stat.neutral .n{color:var(--learn);}
  .signal{background:rgba(176,132,255,0.06);border:1px solid rgba(176,132,255,0.30);border-radius:12px;padding:18px 22px;margin:12px 0;font-size:14px;}
  .signal strong{color:var(--learn);}
  .signal.warn{background:rgba(245,197,24,0.06);border-color:rgba(245,197,24,0.30);}
  .signal.warn strong{color:var(--warn);}
  .signal.bad{background:rgba(244,63,94,0.06);border-color:rgba(244,63,94,0.30);}
  .signal.bad strong{color:var(--bad);}
  .signal.good{background:rgba(20,192,140,0.06);border-color:rgba(20,192,140,0.30);}
  .signal.good strong{color:var(--good);}
  .empty{padding:18px;background:rgba(255,255,255,0.02);border:1px dashed var(--line);border-radius:8px;color:var(--mute);font-style:italic;font-size:13.5px;margin:8px 0;}
  hr{border:0;border-top:1px solid var(--line);margin:32px 0;}
</style>
</head>
<body>
<div class="wrap">

<h1>System.<br><span class="sub">Telemetry.</span></h1>
<p class="lede">
  Live snapshot of what the coach is seeing, what data flowed in clean vs.
  degraded, what's missing, and what's worth your attention. Re-run
  <code>node web-v2/scripts/_emit_telemetry.mjs</code> any time to refresh.
</p>
<div class="stamp">Generated ${now}</div>

<!-- ─────────── 1. SYSTEM HEALTH ─────────── -->
<h2><span class="num">01</span>System health</h2>

<div class="stat-grid">
  <div class="stat ${plan?.last_adapted_at ? 'good' : 'bad'}">
    <div class="n">${esc(lastAdaptedRel)}</div>
    <div class="l">Last adaptation tick</div>
  </div>
  <div class="stat ${Number(wx.enriched) / Math.max(1, Number(wx.has_gps)) >= 0.95 ? 'good' : 'warn'}">
    <div class="n">${wx.enriched}/${wx.has_gps}</div>
    <div class="l">Weather coverage (of GPS-having runs)</div>
  </div>
  <div class="stat ${d.systemHealth.projBySource.find(s => s.source === 'cron-daily')?.n > 0 ? 'good' : 'warn'}">
    <div class="n">${d.systemHealth.projBySource.find(s => s.source === 'cron-daily')?.n ?? 0}</div>
    <div class="l">Projection snapshots (cron-daily)</div>
  </div>
  <div class="stat ${Number(d.systemHealth.notifQueue.pending ?? 0) === 0 ? 'good' : 'warn'}">
    <div class="n">${d.systemHealth.notifQueue.pending ?? '—'}</div>
    <div class="l">Notifications pending</div>
  </div>
</div>

<h3>Active plan</h3>
<table>
<tr><th>Plan ID</th><th>Mode</th><th>Race</th><th>Goal date</th><th>Authored</th><th>Last adapted</th></tr>
<tr>
  <td class="mono">${esc((plan?.id ?? '').slice(0, 18))}…</td>
  <td>${esc(plan?.mode)}</td>
  <td><code>${esc(plan?.race_id)}</code></td>
  <td>${esc(plan?.goal_iso)}</td>
  <td>${esc(fmtDate(plan?.authored_iso))}</td>
  <td class="${plan?.last_adapted_at ? 'tone-good' : 'tone-bad'}">${esc(fmtDate(plan?.last_adapted_at))}</td>
</tr>
</table>

<!-- ─────────── 2. RUN INTEGRITY ─────────── -->
<h2><span class="num">02</span>Run data integrity · last 15 runs</h2>
<p>
  For each recent run · did the backend see what it needed? GPS, HR samples, splits,
  weather enrichment, shoe attribution, plan match, RPE log.
</p>

<table>
<tr>
  <th>Date</th><th>Name</th><th class="right">mi</th><th class="right">time</th>
  <th>GPS</th><th>HR</th><th>splits</th><th>weather</th><th>shoe</th><th>plan match</th><th>RPE</th>
</tr>
${d.runIntegrity.runs.map(r => `
<tr>
  <td class="mono">${esc(r.date_iso)}</td>
  <td>${esc((r.name || '').slice(0, 28))}</td>
  <td class="right num">${r.distance_mi ? Number(r.distance_mi).toFixed(1) : '—'}</td>
  <td class="right mono">${fmtDuration(r.moving_s)}</td>
  <td>${checkmark(r.has_gps)}</td>
  <td>${checkmark(r.has_hr_samples || r.avg_hr)}</td>
  <td>${checkmark(r.has_splits)}</td>
  <td>${r.has_weather ? checkmark(true) : (r.weather_attempt ? '<span class="tone-warn">tried</span>' : checkmark(false))}</td>
  <td>${checkmark(r.has_shoe)}</td>
  <td>${r.matched_plan ? `<span class="tone-good">${esc(r.matched_plan.type)}</span>` : '<span class="tone-neutral">no</span>'}</td>
  <td>${r.rpe ? `<span class="tone-good">${r.rpe.rpe}/10</span>` : checkmark(false)}</td>
</tr>`).join('')}
</table>

<!-- ─────────── 3. COACH ACTIVITY ─────────── -->
<h2><span class="num">03</span>Coach activity · last 14 days</h2>

<h3>Intents written by reason</h3>
${d.coachActivity.intents.length === 0
  ? '<div class="empty">No coach_intents written in the last 14 days. The adaptation cron may have fired but found nothing to act on, or it may not have fired at all. Check last_adapted_at above.</div>'
  : `<table>
<tr><th>Reason</th><th class="right">n</th><th>Latest</th></tr>
${d.coachActivity.intents.map(i => `
<tr><td><code>${esc(i.reason)}</code></td><td class="right num">${i.n}</td><td class="mono">${esc(fmtDate(i.last_ts))}</td></tr>`).join('')}
</table>`}

<h3>Recent intents · last 10 rows</h3>
${d.coachActivity.intentsRecent.length === 0
  ? '<div class="empty">No coach_intents in history.</div>'
  : `<table>
<tr><th>When</th><th>Reason</th><th>Field</th><th>Value (preview)</th><th>Acked</th></tr>
${d.coachActivity.intentsRecent.map(i => `
<tr>
  <td class="mono">${esc(fmtDate(i.ts))}</td>
  <td><code>${esc(i.reason)}</code></td>
  <td class="mono">${esc((i.field ?? '').slice(0, 24))}</td>
  <td class="mono">${esc((i.value ?? '').slice(0, 60))}${(i.value ?? '').length > 60 ? '…' : ''}</td>
  <td>${i.acknowledged_at ? checkmark(true) : '<span class="tone-neutral">no</span>'}</td>
</tr>`).join('')}
</table>`}

<h3>Coach proposals (injury / illness · propose-only)</h3>
${d.coachActivity.proposals.length === 0
  ? '<div class="empty">No coach_proposals ever fired for this user. (Expected · would only fire on niggle ≥ 7/10, active sick episode, or active injury.)</div>'
  : `<table>
<tr><th>Type</th><th>Status</th><th>Created</th><th>Responded</th><th>Expires</th></tr>
${d.coachActivity.proposals.map(p => `
<tr>
  <td><code>${esc(p.proposal_type)}</code></td>
  <td><span class="pill ${p.status === 'accepted' ? 'good' : p.status === 'rejected' ? 'bad' : p.status === 'expired' ? 'warn' : 'neutral'}">${esc(p.status)}</span></td>
  <td class="mono">${esc(fmtDate(p.created_at))}</td>
  <td class="mono">${esc(fmtDate(p.responded_at))}</td>
  <td class="mono">${esc(fmtDate(p.expires_at))}</td>
</tr>`).join('')}
</table>`}

<h3>Briefings rendered · last 10</h3>
${d.coachActivity.briefingsRecent.length === 0
  ? '<div class="empty">No briefings cached. Either the fact-reciter is being called inline (no cache) or no surface has been hit.</div>'
  : `<table>
<tr><th>Surface</th><th>Mode</th><th>Generated</th></tr>
${d.coachActivity.briefingsRecent.map(b => `
<tr>
  <td><code>${esc(b.surface)}</code></td>
  <td>${esc(b.mode)}</td>
  <td class="mono">${esc(fmtDate(b.generated_at))}</td>
</tr>`).join('')}
</table>`}

<!-- ─────────── 4. PLAN STATE ─────────── -->
<h2><span class="num">04</span>Plan state · next 14 days</h2>

${d.planState.mutations.length > 0 ? `<h3>Recent plan mutations · last 30 days</h3>
<table>
<tr><th>When</th><th>Workout date</th><th>Type</th><th>Reason</th><th>Trigger</th><th>Changed</th><th>Status</th></tr>
${d.planState.mutations.map(m => `
<tr>
  <td class="mono">${esc(fmtDate(m.ts))}</td>
  <td class="mono">${esc(m.date_iso)}</td>
  <td>${esc(m.type)}</td>
  <td>${esc(m.reason)}</td>
  <td><code>${esc(m.trigger_kind)}</code></td>
  <td class="mono">${esc(JSON.stringify(m.changed_fields ?? {}).slice(0, 50))}…</td>
  <td>${esc(m.status)}</td>
</tr>`).join('')}
</table>` : '<h3>Plan mutations · last 30 days</h3><div class="empty">No plan mutations recorded · the plan is running as authored.</div>'}

<h3>Upcoming workouts (highlights modified rows)</h3>
<table>
<tr><th>Date</th><th>Type</th><th class="right">mi</th><th>Label</th><th>Status</th></tr>
${d.planState.upcoming.map(w => `
<tr>
  <td class="mono">${esc(w.date_iso)}</td>
  <td>${esc(w.type)}${w.is_quality ? ' <span class="pill warn">Q</span>' : ''}${w.is_long ? ' <span class="pill neutral">L</span>' : ''}</td>
  <td class="right num">${w.distance_mi ? Number(w.distance_mi).toFixed(1) : '—'}</td>
  <td>${esc(w.sub_label ?? '')}</td>
  <td>${w.modified ? '<span class="tone-warn">modified</span>' : '<span class="tone-neutral">as authored</span>'}</td>
</tr>`).join('')}
</table>

<!-- ─────────── 5. HEALTH DATA ─────────── -->
<h2><span class="num">05</span>Health data quality · last 14 days</h2>

<h3>Samples by type and source</h3>
${d.healthQuality.samplesByType.length === 0
  ? '<div class="empty">No health samples in the last 14 days. Apple Health + Strava sync may be stale.</div>'
  : `<table>
<tr><th>Type</th><th>Source</th><th class="right">n</th><th class="right">avg</th><th class="right">range</th><th>span</th></tr>
${d.healthQuality.samplesByType.map(s => `
<tr>
  <td><code>${esc(s.sample_type)}</code></td>
  <td>${esc(s.source)}</td>
  <td class="right num">${s.n}</td>
  <td class="right num">${Number(s.avg_v).toFixed(1)}</td>
  <td class="right mono">${Number(s.min_v).toFixed(1)} – ${Number(s.max_v).toFixed(1)}</td>
  <td class="mono">${esc(s.first?.toString().slice(0,10))} → ${esc(s.last?.toString().slice(0,10))}</td>
</tr>`).join('')}
</table>`}

<h3>Sleep coverage · last 14 days</h3>
<table>
<tr><th>Date</th><th>Sample?</th></tr>
${d.healthQuality.sleepCoverage.map(s => `
<tr><td class="mono">${esc(s.d?.toString().slice(0,10))}</td><td>${s.has_sample ? checkmark(true) : checkmark(false)}</td></tr>`).join('')}
</table>

<h3>RHR baseline · last 14 days</h3>
<p>
  Avg: <strong>${d.healthQuality.rhr14d.baseline ? Number(d.healthQuality.rhr14d.baseline).toFixed(1) + ' bpm' : '—'}</strong>
  · samples: <strong>${d.healthQuality.rhr14d.n_samples}</strong>
  ${d.healthQuality.rhr14d.n_samples < 7 ? '<span class="tone-warn">· fewer than 7 = baseline-unstable · RHR-spike detector may be noisy</span>' : ''}
</p>

${d.healthQuality.suspects.length > 0 ? `<h3>Suspect values (physiologically improbable)</h3>
<table>
<tr><th>Type</th><th>Value</th><th>Source</th><th>Date</th></tr>
${d.healthQuality.suspects.map(s => `
<tr><td><code>${esc(s.sample_type)}</code></td><td class="tone-bad">${esc(s.value)}</td><td>${esc(s.source)}</td><td class="mono">${esc(s.sample_date?.toString().slice(0,10))}</td></tr>`).join('')}
</table>` : ''}

<!-- ─────────── 6. WHAT'S MISSING ─────────── -->
<h2><span class="num">06</span>What's missing · gaps the coach can't fill</h2>

<h3>Recent runs without RPE</h3>
${d.whatsMissing.runsNoRPE.length === 0
  ? '<div class="empty"><span class="tone-good">All last-14d runs have RPE logged.</span></div>'
  : `<p>RPE feeds the adaptation engine. Without it, missed-key-workout and quality-tolerance signals are degraded.</p>
<table>
<tr><th>Date</th><th>Run</th><th class="right">mi</th></tr>
${d.whatsMissing.runsNoRPE.map(r => `
<tr><td class="mono">${esc(r.date_iso)}</td><td>${esc((r.name ?? '').slice(0, 36))}</td><td class="right num">${r.distance_mi ? Number(r.distance_mi).toFixed(1) : '—'}</td></tr>`).join('')}
</table>`}

<h3>Runs with GPS but no weather</h3>
${d.whatsMissing.runsNoWeather.length === 0
  ? '<div class="empty"><span class="tone-good">All last-14d GPS-having runs got weather data.</span></div>'
  : `<p>Heat adjustment and "hotter than usual" context degrade for these runs.</p>
<table>
<tr><th>Date</th><th>Name</th><th>Enrichment</th></tr>
${d.whatsMissing.runsNoWeather.map(r => `
<tr><td class="mono">${esc(r.date_iso)}</td><td>${esc((r.name ?? '').slice(0, 36))}</td><td>${r.attempted ? '<span class="tone-warn">tried, failed</span>' : '<span class="tone-neutral">not attempted</span>'}</td></tr>`).join('')}
</table>`}

<h3>Quality workouts that look unmatched</h3>
${d.whatsMissing.skippedQuality.length === 0
  ? '<div class="empty"><span class="tone-good">No unmatched quality workouts in the last 14 days.</span></div>'
  : `<p>These are planned quality sessions with no Strava activity within ±1 day at ≥70% of target distance. May indicate skipped sessions, treadmill runs not syncing, or activities not yet uploaded.</p>
<table>
<tr><th>Date</th><th>Type</th><th class="right">target mi</th><th>Label</th></tr>
${d.whatsMissing.skippedQuality.map(w => `
<tr><td class="mono">${esc(w.date_iso)}</td><td>${esc(w.type)}</td><td class="right num">${Number(w.distance_mi).toFixed(1)}</td><td>${esc(w.sub_label ?? '')}</td></tr>`).join('')}
</table>`}

<!-- ─────────── 7. SIGNALS ─────────── -->
<h2><span class="num">07</span>Signals worth watching</h2>

${[
  plan?.last_adapted_at && (Date.now() - new Date(plan.last_adapted_at).getTime()) < 86400000 * 2
    ? { tone: 'good', text: `<strong>Adaptation cron is firing.</strong> last_adapted_at moved within the last 2 days. The 9 detectors are running daily.` }
    : { tone: 'bad', text: `<strong>Adaptation cron may be stale.</strong> last_adapted_at hasn't moved in &gt; 2 days. Check the run-adaptations GH workflow.` },

  d.systemHealth.projBySource.find(s => s.source === 'cron-daily')?.n > 0
    ? { tone: 'good', text: `<strong>Projection snapshots are firing.</strong> The trend chart will have data.` }
    : { tone: 'warn', text: `<strong>Projection snapshots have not run via cron yet.</strong> Once the snapshot-projections workflow fires, your projection trend will populate.` },

  d.coachActivity.intents.length === 0
    ? { tone: 'warn', text: `<strong>No coach_intents in the last 14 days.</strong> Possible reasons: (a) the adaptation cron is firing but finding nothing to act on (healthy state · most likely for you right now), or (b) intents are being written under a column we're not reading. Look at the Latest intents column above.` }
    : { tone: 'good', text: `<strong>Coach is talking</strong> · ${d.coachActivity.intents.length} distinct intent reason${d.coachActivity.intents.length === 1 ? '' : 's'} fired in the last 14 days.` },

  d.whatsMissing.runsNoRPE.length > 0
    ? { tone: 'warn', text: `<strong>${d.whatsMissing.runsNoRPE.length} recent run${d.whatsMissing.runsNoRPE.length === 1 ? '' : 's'} without RPE.</strong> Surfacing an RPE prompt in DayDetailModal or post-run drawer would feed the adaptation engine richer signal.` }
    : null,

  d.healthQuality.rhr14d.n_samples < 7
    ? { tone: 'warn', text: `<strong>RHR baseline thin</strong> · only ${d.healthQuality.rhr14d.n_samples} samples in the last 14 days. The rhr-spike detector compares 3-day avg to 14-day baseline; with so few samples the baseline is noisy. Sleep + recovery surfaces may flag false positives.` }
    : { tone: 'good', text: `<strong>RHR baseline solid</strong> · ${d.healthQuality.rhr14d.n_samples} samples in 14 days. rhr-spike detector has a stable baseline to compare against.` },

  Number(wx.enriched) / Math.max(1, Number(wx.has_gps)) >= 0.95
    ? { tone: 'good', text: `<strong>Weather coverage healthy</strong> · ${wx.enriched}/${wx.has_gps} GPS-having runs enriched.` }
    : { tone: 'warn', text: `<strong>Weather coverage degraded</strong> · only ${wx.enriched}/${wx.has_gps} GPS-having runs enriched. Check the enrich-weather workflow and lib/weather/openmeteo.ts.` },
].filter(Boolean).map(s => `<div class="signal ${s.tone}">${s.text}</div>`).join('')}

<hr>
<p style="color:var(--mute);font-size:12.5px;text-align:center;">
  <strong style="color:var(--ink);">SYSTEM_TELEMETRY.html</strong><br>
  Generated by <code>web-v2/scripts/_emit_telemetry.mjs</code> · re-run any time to refresh<br>
  Read-only queries · safe to run anytime · doesn't mutate state
</p>

</div>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('Scanning production state...');
  const data = {
    systemHealth: await sectionSystemHealth(),
    runIntegrity: await sectionRunIntegrity(),
    coachActivity: await sectionCoachActivity(),
    planState: await sectionPlanState(),
    healthQuality: await sectionHealthDataQuality(),
    whatsMissing: await sectionWhatsMissing(),
  };
  const html = renderHtml(data);
  fs.writeFileSync(OUTPUT, html);
  console.log(`✓ Wrote ${OUTPUT}`);
  console.log(`  Active plan last_adapted_at: ${data.systemHealth.plan?.last_adapted_at ?? 'NULL'}`);
  console.log(`  Last 15 runs: ${data.runIntegrity.runs.length}`);
  console.log(`  Coach intents (14d): ${data.coachActivity.intents.length}`);
  console.log(`  Runs without RPE: ${data.whatsMissing.runsNoRPE.length}`);
  console.log(`  Runs with GPS but no weather: ${data.whatsMissing.runsNoWeather.length}`);
  console.log(`  Unmatched quality workouts: ${data.whatsMissing.skippedQuality.length}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => pool.end());
