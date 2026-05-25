/**
 * test-daily-briefing.mjs · End-to-end test of the new daily briefing
 * against David's REAL prod state.
 *
 * Loads today's state from production Postgres, picks the notable
 * thing, runs the LLM, prints the result. NO writes — pure read +
 * Anthropic API call.
 *
 * Run: cd web && node scripts/test-daily-briefing.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2];
}

const USER_ID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TZ = 'America/Los_Angeles';
const TZ_OFFSET_H = -7;

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL || 'postgresql://postgres:gMqZjWTFIvUzuoFnYIVJbgtijtChNvUL@crossover.proxy.rlwy.net:20769/railway',
  ssl: { rejectUnauthorized: false },
});

// ── Load real state ───────────────────────────────────────────────────

function todayInTz() {
  // Current LA wall-clock date
  const ms = Date.now() + TZ_OFFSET_H * 3600000;
  return new Date(ms).toISOString().slice(0, 10);
}

function localHourInTz() {
  const ms = Date.now() + TZ_OFFSET_H * 3600000;
  return new Date(ms).getUTCHours();
}

async function loadState() {
  const today = todayInTz();
  const localHour = localHourInTz();

  // ── Plan: training_plans + plan_weeks + plan_workouts join ──
  // Active plan may have user_uuid NULL (orphan from pre-per-user migration).
  // Match by uuid OR by legacy 'me' user_id when uuid is null.
  const planRowQ = await pool.query(`
    SELECT id, mode, race_id, goal_iso, authored_iso FROM training_plans
    WHERE (user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me'))
      AND archived_iso IS NULL
    ORDER BY authored_iso DESC LIMIT 1
  `, [USER_ID]);
  const planRow = planRowQ.rows[0];

  let currentWeek = null;
  let prevWeek = null;
  let todayDay = null;
  let plan = null;
  if (planRow) {
    // Load phases so we can label weeks by phase NAME, not phase UUID.
    const phasesQ = await pool.query(`
      SELECT label, start_week_idx, end_week_idx FROM plan_phases
      WHERE plan_id = $1 ORDER BY start_week_idx
    `, [planRow.id]);
    const phases = phasesQ.rows;
    const labelForWeekIdx = (idx) => {
      const ph = phases.find((p) => idx >= p.start_week_idx && idx <= p.end_week_idx);
      return ph?.label || 'BASE';
    };

    const weeksQ = await pool.query(`
      SELECT id, week_idx, week_start_iso, phase_id, is_cutback, is_peak, is_race_week
      FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx
    `, [planRow.id]);
    const workoutsQ = await pool.query(`
      SELECT week_id, date_iso, dow, type, distance_mi, pace_target_s_per_mi, duration_min, is_quality, is_long, sub_label
      FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso
    `, [planRow.id]);

    // Group workouts by week_id
    const workoutsByWeek = new Map();
    for (const w of workoutsQ.rows) {
      if (!workoutsByWeek.has(w.week_id)) workoutsByWeek.set(w.week_id, []);
      workoutsByWeek.get(w.week_id).push({
        date: w.date_iso,
        dow: w.dow,
        type: w.type,
        label: w.sub_label || (w.type === 'rest' ? 'REST' : w.type.toUpperCase()),
        distanceMi: Number(w.distance_mi) || 0,
        isRest: w.type === 'rest' || Number(w.distance_mi) === 0,
        paceTargetSPerMi: w.pace_target_s_per_mi ? Number(w.pace_target_s_per_mi) : null,
        durationMin: w.duration_min ? Number(w.duration_min) : null,
      });
    }

    const weeks = weeksQ.rows.map((w) => {
      const days = (workoutsByWeek.get(w.id) || []).sort((a, b) => a.date.localeCompare(b.date));
      const startDate = w.week_start_iso;
      const endDate = days.length > 0 ? days[days.length - 1].date : startDate;
      const plannedMi = days.reduce((s, d) => s + (d.distanceMi || 0), 0);
      return {
        idx: w.week_idx,
        phase: labelForWeekIdx(w.week_idx),
        startDate,
        endDate,
        plannedMi: Math.round(plannedMi * 10) / 10,
        isCutback: w.is_cutback,
        isPeak: w.is_peak,
        isRaceWeek: w.is_race_week,
        days,
      };
    });

    plan = { weeks, mode: planRow.mode };
    for (let i = 0; i < weeks.length; i++) {
      if (weeks[i].days.some((d) => d.date === today)) {
        currentWeek = weeks[i];
        prevWeek = weeks[i - 1] ?? null;
        todayDay = currentWeek.days.find((d) => d.date === today);
        break;
      }
    }
    if (!currentWeek && weeks.length > 0) {
      currentWeek = weeks[weeks.length - 1];
      prevWeek = weeks[weeks.length - 2] ?? null;
    }
  }

  // ── Today's actual run ──
  // Need both raw `data` and `detail` (the latter has cadence + form data).
  const todayRunQ = await pool.query(`
    SELECT id, data, detail FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND (data->>'startLocal') >= $2
      AND (data->>'startLocal') < $3
      AND NOT (data ? 'mergedIntoId')
    ORDER BY (data->>'distanceMi')::numeric DESC LIMIT 1
  `, [USER_ID, today, addDays(today, 1)]);
  let actualToday = null;
  if (todayRunQ.rows[0]) {
    const r = todayRunQ.rows[0];
    actualToday = { ...r.data };
    // Cadence comes from health_samples (Apple Health per-mile) when
    // Strava's avgCadence is null. Average all cadence samples taken on today.
    if (actualToday.avgCadence == null) {
      const cadenceQ = await pool.query(`
        SELECT AVG(value)::numeric AS avg_cadence
        FROM health_samples
        WHERE user_id = $1 AND sample_type = 'cadence'
          AND sample_date = $2::date
      `, [USER_ID, today]).catch(() => ({ rows: [] }));
      const avgCad = Number(cadenceQ.rows[0]?.avg_cadence);
      if (avgCad > 0) actualToday.avgCadence = avgCad;
    }
  }

  // ── This week banked (unmerged) ──
  const bankedQ = await pool.query(`
    SELECT SUM((data->>'distanceMi')::numeric) AS mi
    FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND (data->>'startLocal') >= $2
      AND (data->>'startLocal') < $3
      AND NOT (data ? 'mergedIntoId')
  `, [USER_ID, currentWeek?.startDate || today, addDays(currentWeek?.endDate || today, 1)]);
  const bankedMi = Number(bankedQ.rows[0]?.mi) || 0;

  // ── Last week banked + longest ──
  let lastBankedMi = null;
  if (prevWeek) {
    const r = await pool.query(`
      SELECT (data->>'distanceMi')::numeric AS mi, (data->>'paceSPerMi')::numeric AS pace
      FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'startLocal') >= $2
        AND (data->>'startLocal') < $3
        AND NOT (data ? 'mergedIntoId')
      ORDER BY mi DESC
    `, [USER_ID, prevWeek.startDate, addDays(prevWeek.endDate, 1)]);
    const runs = r.rows.map((x) => ({ mi: Number(x.mi) || 0, pace: Number(x.pace) || 0 }));
    const total = runs.reduce((s, x) => s + x.mi, 0);
    const longest = runs[0]?.mi || 0;
    const longestPace = runs[0]?.pace || 0;
    lastBankedMi = { mi: total, longest, longestPace };
  }

  // ── Recovery from health_samples ──
  // user_id is uuid. Sample types: sleep_hours, hrv, resting_hr.
  // Take the most-recent value of each within the last 2 days.
  const recQ = await pool.query(`
    SELECT DISTINCT ON (sample_type) sample_type, value, recorded_at
    FROM health_samples
    WHERE user_id = $1
      AND sample_type IN ('sleep_hours','hrv','resting_hr')
      AND recorded_at >= ($2::date - interval '2 days')
    ORDER BY sample_type, recorded_at DESC
  `, [USER_ID, today]).catch((e) => { console.error('health_samples err:', e.message); return { rows: [] }; });
  const recMap = Object.fromEntries(recQ.rows.map((r) => [r.sample_type, Number(r.value)]));
  const recovery = {
    sleepHoursLastNight: recMap.sleep_hours ?? null,
    hrvMs: recMap.hrv ?? null,
    hrvBaselineMs: null,
    restingHrBpm: recMap.resting_hr ?? null,
    restingHrBaselineBpm: null,
  };

  // ── Check-in for today ──
  const ciCols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='daily_checkin' ORDER BY ordinal_position`);
  const ciColNames = ciCols.rows.map((r) => r.column_name);
  const ciUserCol = ciColNames.includes('user_uuid') ? 'user_uuid' : 'user_id';
  const ciDateCol = ciColNames.includes('date') ? 'date' : ciColNames.includes('checkin_date') ? 'checkin_date' : ciColNames.includes('day') ? 'day' : null;
  const checkIn = ciDateCol
    ? await pool.query(`SELECT * FROM daily_checkin WHERE ${ciUserCol} = $1 AND ${ciDateCol} = $2 LIMIT 1`, [USER_ID, today])
        .then((r) => r.rows[0] ?? null).catch(() => null)
    : null;

  // ── Next race: prefer the plan's own race (the one the runner is
  //     actively training for), regardless of priority label in races.
  let nextA = null;
  if (planRow?.race_id) {
    const r = await pool.query(`SELECT slug, meta FROM races WHERE slug = $1 LIMIT 1`, [planRow.race_id]);
    if (r.rows[0]) nextA = { name: r.rows[0].meta?.name || r.rows[0].slug, date: r.rows[0].meta?.date, priority: r.rows[0].meta?.priority };
  }
  if (!nextA) {
    const racesQ = await pool.query(`SELECT slug, meta FROM races WHERE user_uuid = $1 OR user_uuid IS NULL`, [USER_ID]);
    const races = racesQ.rows
      .map((r) => ({ name: r.meta?.name || r.slug, date: r.meta?.date, priority: r.meta?.priority }))
      .filter((r) => r.date && r.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    nextA = races.find((r) => r.priority === 'A') ?? races[0] ?? null;
  }

  // ── Profile baselines ──
  const profQ = await pool.query(`SELECT full_name, hrmax, rhr FROM profile WHERE user_uuid = $1 LIMIT 1`, [USER_ID]).catch(() => ({ rows: [] }));
  const profile = profQ.rows[0] ?? {};

  return {
    today,
    localHour,
    plan,
    currentWeek,
    prevWeek,
    todayDay,
    actualToday,
    bankedMi,
    lastBanked: lastBankedMi,
    recovery,
    checkIn,
    nextRace: nextA,
    profile,
  };
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function pickRecovery(samples) {
  // Look for sleep, HRV, RHR — most-recent values
  const find = (typeMatch) => samples.find((s) => s.sample_type && typeMatch.test(s.sample_type));
  const sleep = find(/sleep/i);
  const hrv = find(/hrv|heart.*rate.*variability/i);
  const rhr = find(/resting.*heart.*rate|^rhr/i);
  return {
    sleepHoursLastNight: sleep ? Number(sleep.value) / 3600 : null,
    hrvMs: hrv ? Number(hrv.value) : null,
    hrvBaselineMs: null,
    restingHrBpm: rhr ? Number(rhr.value) : null,
    restingHrBaselineBpm: null,
  };
}

// ── Notable thing (inline since we're outside Next runtime) ───────────

function pickNotable(actual, workout, baselines, weather) {
  if (!actual || !workout) return null;
  const isEasy = ['easy', 'recovery', 'long'].includes(workout.type);
  const isQuality = ['quality', 'race'].includes(workout.type);

  if (actual.avgCadence != null && baselines.cadenceEasy != null && baselines.cadenceEasy > 0) {
    const delta = actual.avgCadence - baselines.cadenceEasy;
    if (isEasy && delta <= -8) {
      return {
        text: `Cadence was a bit low today, around ${Math.round(actual.avgCadence)} spm (your easy baseline is ~${Math.round(baselines.cadenceEasy)}). For easy that's actually fine — usually means you're relaxed.`,
        kind: 'cadence-low',
      };
    }
    if (isEasy && delta >= 8) {
      return {
        text: `Cadence ran high today, ${Math.round(actual.avgCadence)} spm vs your easy baseline ~${Math.round(baselines.cadenceEasy)}. On easy that usually means you were pushing harder than the plan called for.`,
        kind: 'cadence-high',
      };
    }
  }
  if (isEasy && actual.avgHr != null && baselines.avgHrEasy != null) {
    if (actual.avgHr - baselines.avgHrEasy >= 10) {
      return {
        text: `Avg HR was ${actual.avgHr} bpm today, well above your easy baseline (~${baselines.avgHrEasy}). Could be heat, could be under-recovery — worth a check tomorrow.`,
        kind: 'hr-high-for-easy',
      };
    }
  }
  if (weather && (weather.isHot || (weather.tempF != null && weather.tempF >= 75) || (weather.humidityPct != null && weather.humidityPct >= 80))) {
    return {
      text: `Conditions were tough — ${weather.tempF != null ? Math.round(weather.tempF) + '°F' : ''}${weather.humidityPct != null ? ' / ' + Math.round(weather.humidityPct) + '% humidity' : ''}. That bends HR up and pace down on any easy or long run; today's effort is honest.`,
      kind: 'conditions-warm',
    };
  }
  return null;
}

// ── Build user message + call LLM (mirror of daily-briefing.ts) ──────

function fmtPace(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}/mi`; }
function fmtTime(s) { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; }
function dowName(iso) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(iso + 'T12:00:00Z').getUTCDay()]; }

function classify(s) {
  if (s.actualToday && s.todayDay && !s.todayDay.isRest && s.todayDay.distanceMi > 0) {
    const pct = s.actualToday.distanceMi / s.todayDay.distanceMi;
    if (pct >= 0.9) return 'post-run';
    if (pct >= 0.5) return 'partial';
    return 'skipped';
  }
  if (!s.todayDay || s.todayDay.isRest || s.todayDay.distanceMi === 0) return 'rest';
  return 'pre-run';
}

function buildUserMessage(s, stateKind) {
  const lines = [];
  lines.push(`RUNNER: David.`);
  lines.push(s.nextRace ? `NEXT A-RACE: ${s.nextRace.name} in ${daysBetween(s.today, s.nextRace.date)} days.` : `NEXT A-RACE: none.`);
  lines.push('');

  const hour = s.localHour;
  const tod = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 22 ? 'evening' : 'late night';
  lines.push(`TODAY: ${dowName(s.today)}, ${s.today}, ${tod} (local hour ${hour}).`);
  lines.push('');

  if (s.todayDay && !s.todayDay.isRest && s.todayDay.distanceMi > 0) {
    lines.push(`PLAN FOR TODAY: ${s.todayDay.label} — ${s.todayDay.type}, ${s.todayDay.distanceMi} mi.`);
  } else lines.push(`PLAN FOR TODAY: rest day.`);

  if (s.actualToday) {
    const a = s.actualToday;
    lines.push(`ACTUAL: ${Number(a.distanceMi).toFixed(2)} mi · ${fmtTime(a.movingTimeS)} · ${fmtPace(a.paceSPerMi)}` +
      (a.avgHr ? ` · avg HR ${a.avgHr}` : '') +
      (a.avgCadence ? ` · cadence ${Math.round(a.avgCadence)} spm` : ''));
  } else lines.push(`ACTUAL: nothing logged yet today.`);
  lines.push('');

  if (s.notable) {
    lines.push(`COACH OBSERVATION TO MENTION (the ONE thing worth saying about this run): ${s.notable.text}`);
    lines.push('');
  } else if (stateKind === 'post-run' || stateKind === 'partial') {
    lines.push(`COACH OBSERVATION: nothing notable in the run data — talk meta-pattern or week shape instead.`);
    lines.push('');
  }

  const phaseLabel = s.currentWeek?.phase || 'BASE';
  const phaseWeekIdx = s.plan?.weeks
    ? s.plan.weeks.filter(w => w.phase === phaseLabel).findIndex(w => w === s.currentWeek) + 1
    : 1;
  lines.push(`THIS WEEK SO FAR: ${s.bankedMi.toFixed(1)} of ${s.currentWeek?.plannedMi || '?'} mi planned (${phaseLabel.toLowerCase()} phase week ${phaseWeekIdx})`);

  if (s.currentWeek?.days) {
    const upcoming = s.currentWeek.days.filter(d => d.date > s.today).map(d => {
      const day = dowName(d.date).slice(0, 3);
      if (d.isRest || d.distanceMi === 0) return `${day} rest`;
      return `${day} ${d.type} ${d.distanceMi}mi`;
    });
    if (upcoming.length) lines.push(`REST OF THIS WEEK: ${upcoming.join(' · ')}`);
    else lines.push(`REST OF THIS WEEK: nothing — today is the last planned session of the week.`);
  }
  // Always tell the LLM what's coming next regardless of week boundary —
  // first 3 non-rest workouts ahead (anchored to the plan, not invented).
  if (s.plan?.weeks) {
    const upcomingAll = [];
    for (const w of s.plan.weeks) {
      for (const d of w.days) {
        if (d.date > s.today && !d.isRest && d.distanceMi > 0) upcomingAll.push(d);
        if (upcomingAll.length >= 3) break;
      }
      if (upcomingAll.length >= 3) break;
    }
    if (upcomingAll.length > 0) {
      lines.push(`NEXT 3 SESSIONS AFTER TODAY: ${upcomingAll.map(d => `${d.date} (${dowName(d.date).slice(0,3)}) ${d.type} ${d.distanceMi}mi`).join(' · ')}`);
    }
  }
  lines.push('');

  if (s.lastBanked) {
    lines.push(`LAST WEEK: ran ${Math.round(s.lastBanked.mi)} of ${s.prevWeek?.plannedMi || '?'} mi planned${s.lastBanked.longest ? ` · longest ${Number(s.lastBanked.longest).toFixed(1)}mi${s.lastBanked.longestPace ? ' at ' + fmtPace(s.lastBanked.longestPace) : ''}` : ''}`);
    lines.push('');
  }

  if (s.recovery) {
    const r = [];
    if (s.recovery.sleepHoursLastNight) r.push(`sleep ${s.recovery.sleepHoursLastNight.toFixed(1)}h`);
    if (s.recovery.hrvMs) r.push(`HRV ${s.recovery.hrvMs.toFixed(0)}ms`);
    if (s.recovery.restingHrBpm) r.push(`RHR ${s.recovery.restingHrBpm}`);
    if (r.length) { lines.push(`RECOVERY: ${r.join(' · ')}`); lines.push(''); }
  }

  if (s.checkIn) {
    const ci = [];
    if (s.checkIn.energy != null) ci.push(`energy ${s.checkIn.energy}/5`);
    if (s.checkIn.soreness != null) ci.push(`soreness ${s.checkIn.soreness}/5`);
    if (s.checkIn.stress != null) ci.push(`stress ${s.checkIn.stress}/5`);
    if (ci.length) { lines.push(`CHECK-IN: ${ci.join(' · ')}`); lines.push(''); }
  }

  lines.push(`STATE: ${stateKind.toUpperCase()}. Write the coach's voice for the TODAY page. Plain prose, paragraph breaks where natural. No headings.`);
  return lines.join('\n');
}

function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }

async function main() {
  const state = await loadState();

  // Notable thing
  const baselines = { cadenceEasy: 175, avgHrEasy: 145 };  // TODO: pull from real profile data
  const weather = null;
  const notable = pickNotable(state.actualToday, state.todayDay, baselines, weather);
  state.notable = notable;
  const stateKind = classify(state);

  console.log('━'.repeat(76));
  console.log('STATE LOADED FROM PROD');
  console.log('━'.repeat(76));
  console.log('today:', state.today, '· localHour:', state.localHour, '· stateKind:', stateKind);
  console.log('plan:', state.plan ? `${state.plan.weeks?.length || 0} weeks` : 'none');
  console.log('currentWeek:', state.currentWeek ? `${state.currentWeek.phase} · ${state.currentWeek.plannedMi}mi planned · ${state.currentWeek.startDate} → ${state.currentWeek.endDate}` : 'none');
  console.log('todayDay:', state.todayDay ? `${state.todayDay.label} · ${state.todayDay.type} · ${state.todayDay.distanceMi}mi` : 'rest');
  console.log('actualToday:', state.actualToday ? `${state.actualToday.distanceMi}mi · ${fmtPace(state.actualToday.paceSPerMi)} · HR ${state.actualToday.avgHr} · cadence ${state.actualToday.avgCadence}` : 'none');
  console.log('bankedMi this week:', state.bankedMi.toFixed(1));
  console.log('lastBanked:', state.lastBanked ? `${state.lastBanked.mi.toFixed(1)}mi (longest ${state.lastBanked.longest.toFixed(1)}mi)` : 'none');
  console.log('recovery:', JSON.stringify(state.recovery));
  console.log('checkIn:', state.checkIn);
  console.log('nextRace:', state.nextRace);
  console.log('notable:', notable ? notable.kind + ': ' + notable.text : 'none');
  console.log();

  console.log('━'.repeat(76));
  console.log('USER MESSAGE TO LLM');
  console.log('━'.repeat(76));
  const userMsg = buildUserMessage(state, stateKind);
  console.log(userMsg);
  console.log();

  console.log('━'.repeat(76));
  console.log('LLM OUTPUT');
  console.log('━'.repeat(76));
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const systemPrompt = readFileSync(join(__dirname, '..', 'coach', 'prompts', 'daily-briefing.md'), 'utf-8');
  const t0 = Date.now();
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMsg }],
  });
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  console.log();
  console.log(text);
  console.log();
  console.log(`  · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${resp.usage.input_tokens} in / ${resp.usage.output_tokens} out · cache=${resp.usage.cache_read_input_tokens || 0}r/${resp.usage.cache_creation_input_tokens || 0}w`);

  await pool.end();
}

main().catch((e) => { console.error('ERROR:', e.message, e.stack); pool.end(); process.exit(1); });
